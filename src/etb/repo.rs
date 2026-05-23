use super::EtbEintragAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Eingabedaten für einen neuen ETB-Eintrag. Alle Werte sind bereits
/// validiert und normalisiert (Zeitformat, Pflichtfelder) — das ist Aufgabe
/// des Handlers. Das Repository vergibt `lfd_nr` und `received_at`.
#[derive(Debug)]
pub struct EintragDaten<'a> {
    pub typ: &'a str,
    pub inhalt: &'a str,
    pub von: Option<&'a str>,
    pub an: Option<&'a str>,
    pub meldeweg: Option<&'a str>,
    pub veranlassung: Option<&'a str>,
    /// `None` = Server vergibt `datetime('now')`.
    pub ereigniszeit: Option<&'a str>,
    pub erfasst_lokal_at: Option<&'a str>,
    pub berichtigt_eintrag_id: Option<i64>,
}

/// Legt einen ETB-Eintrag an und liefert ihn als Anzeige zurück.
///
/// `lfd_nr` wird in **einem** atomaren Statement vergeben:
/// `COALESCE(MAX(lfd_nr),0)+1` über alle Einträge desselben Einsatzes.
/// SQLite serialisiert im WAL-Modus alle Writer, daher ist dieses einzelne
/// Statement race-frei; `UNIQUE(einsatz_id, lfd_nr)` sichert zusätzlich ab.
/// `received_at` wird per Spalten-Default `datetime('now')` gesetzt.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: EintragDaten<'_>,
) -> Result<EtbEintragAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag \
            (einsatz_id, lfd_nr, typ, inhalt, von, an, meldeweg, veranlassung, \
             erfasser_id, ereigniszeit, erfasst_lokal_at, berichtigt_eintrag_id) \
         SELECT ?, COALESCE(MAX(lfd_nr), 0) + 1, ?, ?, ?, ?, ?, ?, ?, \
                COALESCE(?, datetime('now')), ?, ? \
         FROM etb_eintrag WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.von)
    .bind(daten.an)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(erfasser_id)
    .bind(daten.ereigniszeit)
    .bind(daten.erfasst_lokal_at)
    .bind(daten.berichtigt_eintrag_id)
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;

    laden(pool, id).await
}

/// Lädt einen einzelnen Eintrag als Anzeige (inkl. Erfasser-Name).
/// `NotFound`, wenn der Eintrag nicht existiert.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<EtbEintragAnzeige, AppError> {
    sqlx::query_as::<_, EtbEintragAnzeige>(
        "SELECT e.id, e.lfd_nr, e.typ, e.inhalt, e.von, e.an, e.meldeweg, e.veranlassung, \
                e.erfasser_id, b.anzeigename AS erfasser_name, e.ereigniszeit, e.received_at, \
                e.erfasst_lokal_at, e.berichtigt_eintrag_id \
         FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
         WHERE e.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Prüft, ob ein Eintrag mit `eintrag_id` zum angegebenen `einsatz_id` gehört.
/// Für die Validierung von Berichtigungs-Verweisen.
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    eintrag_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM etb_eintrag WHERE id = ? AND einsatz_id = ?")
            .bind(eintrag_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an;
    /// liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT OR IGNORE INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h')",
        )
        .execute(pool)
        .await
        .unwrap();
        let benutzer_id: i64 =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(pool)
                .await
                .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id)
    }

    fn daten(inhalt: &str) -> EintragDaten<'_> {
        EintragDaten {
            typ: "meldung",
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some("2026-05-23 10:00:00"),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        }
    }

    #[tokio::test]
    async fn lfd_nr_startet_bei_eins_und_zaehlt_hoch() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let e1 = anlegen(&pool, einsatz, benutzer, daten("Erste Meldung"))
            .await
            .unwrap();
        let e2 = anlegen(&pool, einsatz, benutzer, daten("Zweite Meldung"))
            .await
            .unwrap();
        assert_eq!(e1.lfd_nr, 1);
        assert_eq!(e2.lfd_nr, 2);
        assert_eq!(e1.erfasser_name, "Leitung");
        assert!(!e1.received_at.is_empty());
    }

    #[tokio::test]
    async fn lfd_nr_ist_pro_einsatz_unabhaengig() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz_a) = setup(&pool).await;
        let einsatz_b: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        anlegen(&pool, einsatz_a, benutzer, daten("A1")).await.unwrap();
        let b1 = anlegen(&pool, einsatz_b, benutzer, daten("B1"))
            .await
            .unwrap();
        assert_eq!(b1.lfd_nr, 1);
    }

    #[tokio::test]
    async fn ereigniszeit_default_wird_gesetzt_wenn_none() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let mut d = daten("Ohne Ereigniszeit");
        d.ereigniszeit = None;

        let e = anlegen(&pool, einsatz, benutzer, d).await.unwrap();
        // datetime('now') liefert das kanonische Format YYYY-MM-DD HH:MM:SS (19 Zeichen).
        assert_eq!(
            e.ereigniszeit.len(),
            19,
            "Server-Default muss kanonisches SQLite-Zeitformat sein"
        );
    }

    #[tokio::test]
    async fn berichtigung_verknuepft_originaleintrag() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let original = anlegen(&pool, einsatz, benutzer, daten("Tippfehler"))
            .await
            .unwrap();

        let mut korrektur = daten("Korrektur des Eintrags");
        korrektur.typ = "berichtigung";
        korrektur.berichtigt_eintrag_id = Some(original.id);
        let b = anlegen(&pool, einsatz, benutzer, korrektur).await.unwrap();

        assert_eq!(b.typ, "berichtigung");
        assert_eq!(b.berichtigt_eintrag_id, Some(original.id));
        assert_eq!(b.lfd_nr, 2);
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, benutzer, daten("X")).await.unwrap();

        assert!(gehoert_zu_einsatz(&pool, e.id, einsatz).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, e.id, 999).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }

    #[tokio::test]
    async fn laden_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(laden(&pool, 999).await.unwrap_err(), AppError::NotFound));
    }
}
