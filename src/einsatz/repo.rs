use super::berechtigung::darf_lesen;
use super::{
    Einsatz, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige, EINSATZ_ROLLE_LEITUNG,
    STATUS_ABGESCHLOSSEN,
};
use crate::auth::Benutzer;
use crate::error::AppError;
use chrono::Utc;
use sqlx::SqlitePool;

/// Legt einen Einsatz an und macht den Ersteller in derselben Transaktion zur Einsatzleitung.
pub async fn anlegen(
    pool: &SqlitePool,
    bezeichnung: &str,
    stichwort: Option<&str>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    // Single-Org in T1: alle Einsätze gehören zur (einzigen) Organisation.
    let org_id: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Internal("Keine Organisation vorhanden".into()))?;

    let mut tx = pool.begin().await?;

    // Einsatznummer JJJJ-NNN: NNN je Organisation + Jahr fortlaufend, 3-stellig.
    // 'JJJJ-' ist 5 Zeichen lang → substr(..., 6) liefert den NNN-Teil.
    // Race-frei: WAL serialisiert Writer; der Unique-Index sichert zusätzlich ab.
    let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
        .fetch_one(&mut *tx)
        .await?;
    let praefix = format!("{jahr}-");
    let max_nr: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(CAST(substr(einsatznummer_intern, 6) AS INTEGER)) \
         FROM einsatz WHERE org_id = ? AND einsatznummer_intern LIKE ?",
    )
    .bind(org_id)
    .bind(format!("{praefix}%"))
    .fetch_one(&mut *tx)
    .await?;
    let einsatznummer = format!("{praefix}{:03}", max_nr.unwrap_or(0) + 1);

    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, stichwort, einsatznummer_intern, angelegt_at) \
         VALUES (?, ?, ?, ?, datetime('now')) RETURNING id",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(stichwort)
    .bind(&einsatznummer)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    laden(pool, einsatz_id).await
}

/// Lädt einen Einsatz; `AppError::NotFound`, wenn er nicht existiert.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Einsatz, AppError> {
    sqlx::query_as::<_, Einsatz>(
        "SELECT e.id, e.org_id, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, e.geloescht_at, \
                o.name AS org_name \
         FROM einsatz e \
         LEFT JOIN organisation o ON o.id = e.org_id \
         WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Liefert die Einsatz-Rolle eines Benutzers in einem Einsatz (`None` = kein Mitglied).
pub async fn rolle_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<EinsatzRolle>, AppError> {
    let rolle: Option<String> = sqlx::query_scalar(
        "SELECT einsatz_rolle FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    Ok(rolle.and_then(|s| EinsatzRolle::parse(&s)))
}

/// Alle für den Benutzer lesbaren Einsätze, annotiert mit dessen Rolle
/// (`meine_rolle`). Die DSGVO-Lese-Policy (`darf_lesen`) filtert Einsätze,
/// die der Benutzer nicht sehen darf, vor der Rückgabe heraus.
pub async fn liste_fuer(
    pool: &SqlitePool,
    benutzer: &Benutzer,
) -> Result<Vec<EinsatzAnzeige>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        org_id: i64,
        org_name: String,
        bezeichnung: String,
        stichwort: Option<String>,
        status: String,
        begonnen_at: String,
        abgeschlossen_at: Option<String>,
        abgeschlossen_von: Option<i64>,
        einsatzart: String,
        einsatznummer_intern: Option<String>,
        angelegt_at: String,
        leitstellen_nr: Option<String>,
        einsatzort: Option<String>,
        einsatzort_lat: Option<f64>,
        einsatzort_lon: Option<f64>,
        meldende_stelle: Option<String>,
        sachverhalt: Option<String>,
        anzahl_betroffene_initial: Option<i64>,
        retention_bis: Option<String>,
        meine_rolle: Option<String>,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT e.id, e.org_id, o.name AS org_name, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, \
                m.einsatz_rolle AS meine_rolle \
         FROM einsatz e \
         LEFT JOIN organisation o ON o.id = e.org_id \
         LEFT JOIN einsatz_mitgliedschaft m \
                ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         ORDER BY e.begonnen_at DESC, e.id DESC",
    )
    .bind(benutzer.id)
    .fetch_all(pool)
    .await?;

    let jetzt = Utc::now();
    Ok(rows
        .into_iter()
        .filter(|r| {
            darf_lesen(
                benutzer,
                &r.status,
                r.abgeschlossen_at.as_deref(),
                r.retention_bis.as_deref(),
                r.meine_rolle.as_deref().and_then(EinsatzRolle::parse),
                jetzt,
            )
        })
        .map(|r| EinsatzAnzeige {
            id: r.id,
            org_id: r.org_id,
            org_name: r.org_name,
            bezeichnung: r.bezeichnung,
            stichwort: r.stichwort,
            status: r.status,
            begonnen_at: r.begonnen_at,
            abgeschlossen_at: r.abgeschlossen_at,
            abgeschlossen_von: r.abgeschlossen_von,
            einsatzart: r.einsatzart,
            einsatznummer_intern: r.einsatznummer_intern,
            angelegt_at: r.angelegt_at,
            leitstellen_nr: r.leitstellen_nr,
            einsatzort: r.einsatzort,
            einsatzort_lat: r.einsatzort_lat,
            einsatzort_lon: r.einsatzort_lon,
            meldende_stelle: r.meldende_stelle,
            sachverhalt: r.sachverhalt,
            anzahl_betroffene_initial: r.anzahl_betroffene_initial,
            retention_bis: r.retention_bis,
            meine_rolle: r.meine_rolle,
        })
        .collect())
}

/// Schließt einen Einsatz ab (nur wenn aktuell `aktiv`) und lädt ihn neu.
/// Das `status = 'aktiv'`-Prädikat im WHERE schützt gegen Races; die fachliche
/// 409-Prüfung erfolgt zusätzlich im Handler.
pub async fn abschliessen(
    pool: &SqlitePool,
    einsatz_id: i64,
    von_benutzer_id: i64,
) -> Result<Einsatz, AppError> {
    sqlx::query(
        "UPDATE einsatz \
         SET status = ?, abgeschlossen_at = datetime('now'), abgeschlossen_von = ? \
         WHERE id = ? AND status = 'aktiv'",
    )
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(von_benutzer_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    laden(pool, einsatz_id).await
}

/// Setzt die Aufbewahrungsfrist (`retention_bis`) eines Einsatzes und schreibt in
/// derselben Transaktion einen ETB-System-Eintrag als Audit (LFH-130, ETB-Kopplung
/// Pattern B). `neue_frist = None` hebt die Frist auf (unbegrenzt). Der Audit-Text
/// wird vom Aufrufer gebildet (er kennt alten/neuen Wert). Die Verkürzungs-
/// Bestätigung ist Sache des Handlers.
pub async fn frist_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    neue_frist: Option<&str>,
    audit_inhalt: &str,
) -> Result<Einsatz, AppError> {
    let etb_startwert = super::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatz SET retention_bis = ? WHERE id = ?")
        .bind(neue_frist)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;
    crate::etb::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        erfasser_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_SYSTEM,
            inhalt: audit_inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    tx.commit().await?;
    laden(pool, einsatz_id).await
}

/// Editierbare Kopffelder für `aktualisiere_kopf`. Optional-Strings sind bereits
/// vom Handler getrimmt; leere Werte werden als `None` übergeben (→ NULL).
#[derive(Debug)]
pub struct KopfDaten<'a> {
    pub bezeichnung: &'a str,
    pub stichwort: Option<&'a str>,
    pub einsatzart: &'a str,
    pub einsatznummer_intern: Option<&'a str>,
    pub leitstellen_nr: Option<&'a str>,
    pub einsatzort: Option<&'a str>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<&'a str>,
    pub sachverhalt: Option<&'a str>,
    pub anzahl_betroffene_initial: Option<i64>,
    /// Bereits ins DB-Format normalisierte Alarmzeit.
    pub begonnen_at: &'a str,
}

/// Vollersatz der editierbaren Kopf-Spalten (ein atomares Speichern).
/// Nicht-editierbare Spalten (status, abgeschlossen_*, angelegt_at, org_id, id)
/// bleiben unberührt. Ein Verstoß gegen den Einsatznummer-Unique-Index ergibt
/// `Conflict` (409).
pub async fn aktualisiere_kopf(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: KopfDaten<'_>,
) -> Result<Einsatz, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE einsatz SET \
            bezeichnung = ?, stichwort = ?, einsatzart = ?, einsatznummer_intern = ?, \
            leitstellen_nr = ?, einsatzort = ?, einsatzort_lat = ?, einsatzort_lon = ?, \
            meldende_stelle = ?, sachverhalt = ?, anzahl_betroffene_initial = ?, begonnen_at = ? \
         WHERE id = ?",
    )
    .bind(daten.bezeichnung)
    .bind(daten.stichwort)
    .bind(daten.einsatzart)
    .bind(daten.einsatznummer_intern)
    .bind(daten.leitstellen_nr)
    .bind(daten.einsatzort)
    .bind(daten.einsatzort_lat)
    .bind(daten.einsatzort_lon)
    .bind(daten.meldende_stelle)
    .bind(daten.sachverhalt)
    .bind(daten.anzahl_betroffene_initial)
    .bind(daten.begonnen_at)
    .bind(einsatz_id)
    .execute(pool)
    .await;

    if let Err(sqlx::Error::Database(db_err)) = &ergebnis {
        if db_err.is_unique_violation() {
            return Err(AppError::Conflict(
                "Einsatznummer ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    ergebnis?;

    laden(pool, einsatz_id).await
}

/// Alle Mitglieder eines Einsatzes (mit Benutzer-Klartext), sortiert nach Zuweisung.
pub async fn mitglieder(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MitgliedAnzeige>, AppError> {
    sqlx::query_as::<_, MitgliedAnzeige>(
        "SELECT m.benutzer_id, b.anzeigename, b.benutzername, m.einsatz_rolle, m.zugewiesen_at \
         FROM einsatz_mitgliedschaft m \
         JOIN benutzer b ON b.id = m.benutzer_id \
         WHERE m.einsatz_id = ? \
         ORDER BY m.zugewiesen_at, m.benutzer_id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Setzt (oder aktualisiert) die Einsatz-Rolle eines Benutzers in einem Einsatz.
pub async fn setze_rolle(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    rolle: EinsatzRolle,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?) \
         ON CONFLICT(einsatz_id, benutzer_id) DO UPDATE SET einsatz_rolle = excluded.einsatz_rolle",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(rolle.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

/// Entfernt eine Mitgliedschaft (idempotent).
pub async fn entferne(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?")
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Anzahl der Einsatzleitungen in einem Einsatz (für den „letzte Leitung"-Schutz).
pub async fn zaehle_einsatzleitung(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND einsatz_rolle = ?",
    )
    .bind(einsatz_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::STATUS_ABGESCHLOSSEN;

    /// Legt Org (id=1) + einen Benutzer an und liefert dessen id.
    async fn benutzer_anlegen(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, ?, ?, 'h')",
        )
        .bind(name)
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = ?")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn anlegen_macht_ersteller_zur_einsatzleitung() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let einsatz = anlegen(&pool, "Hochwasser", Some("Deichbruch"), leit)
            .await
            .unwrap();
        assert_eq!(einsatz.bezeichnung, "Hochwasser");
        assert_eq!(einsatz.stichwort.as_deref(), Some("Deichbruch"));
        assert!(einsatz.ist_aktiv());

        let rolle = rolle_von(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(rolle, Some(EinsatzRolle::Einsatzleitung));
    }

    #[tokio::test]
    async fn rolle_von_fuer_nicht_mitglied_ist_none() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        assert_eq!(rolle_von(&pool, einsatz.id, fremd).await.unwrap(), None);
    }

    #[tokio::test]
    async fn abschliessen_setzt_status_und_von() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(abgeschlossen.status, STATUS_ABGESCHLOSSEN);
        assert!(abgeschlossen.abgeschlossen_at.is_some());
        assert_eq!(abgeschlossen.abgeschlossen_von, Some(leit));
        assert!(!abgeschlossen.ist_aktiv());
    }

    #[tokio::test]
    async fn frist_setzen_speichert_und_schreibt_etb_audit() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        assert_eq!(einsatz.retention_bis, None);

        let aktualisiert = frist_setzen(
            &pool,
            einsatz.id,
            leit,
            Some("2030-01-01 00:00:00"),
            "Aufbewahrungsfrist gesetzt auf 2030-01-01 00:00:00",
        )
        .await
        .unwrap();
        assert_eq!(
            aktualisiert.retention_bis.as_deref(),
            Some("2030-01-01 00:00:00")
        );

        // Genau ein ETB-System-Eintrag als Audit entstanden.
        let anzahl: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system'",
        )
        .bind(einsatz.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(anzahl, 1);
    }

    #[tokio::test]
    async fn frist_setzen_none_hebt_frist_auf() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        frist_setzen(&pool, einsatz.id, leit, Some("2030-01-01 00:00:00"), "set")
            .await
            .unwrap();

        let aufgehoben = frist_setzen(&pool, einsatz.id, leit, None, "aufgehoben")
            .await
            .unwrap();
        assert_eq!(aufgehoben.retention_bis, None);
    }

    #[tokio::test]
    async fn setze_rolle_legt_an_und_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Beobachter)
        );

        // Upsert: dieselbe (einsatz, benutzer)-Kombination aktualisiert die Rolle.
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Fuehrungspersonal)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Fuehrungspersonal)
        );
    }

    #[tokio::test]
    async fn entferne_loescht_mitgliedschaft() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        entferne(&pool, einsatz.id, erika).await.unwrap();
        assert_eq!(rolle_von(&pool, einsatz.id, erika).await.unwrap(), None);
    }

    #[tokio::test]
    async fn zaehle_einsatzleitung_zaehlt_nur_leitungen() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 1);

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Einsatzleitung)
            .await
            .unwrap();
        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 2);
    }

    /// Lädt den vollständigen `Benutzer`-Datensatz per id (für die Lese-Policy).
    async fn benutzer_laden(pool: &SqlitePool, id: i64) -> Benutzer {
        sqlx::query_as::<_, Benutzer>("SELECT * FROM benutzer WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn liste_fuer_annotiert_meine_rolle() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        // Ersteller sieht sich als Einsatzleitung.
        let leit_benutzer = benutzer_laden(&pool, leit).await;
        let fuer_leit = liste_fuer(&pool, &leit_benutzer).await.unwrap();
        assert_eq!(fuer_leit.len(), 1);
        assert_eq!(fuer_leit[0].id, einsatz.id);
        assert_eq!(fuer_leit[0].meine_rolle.as_deref(), Some(EINSATZ_ROLLE_LEITUNG));

        // Nicht-Mitglied ohne höhere Berechtigung sieht den Einsatz NICHT (DSGVO-Filter).
        let fremd_benutzer = benutzer_laden(&pool, fremd).await;
        let fuer_fremd = liste_fuer(&pool, &fremd_benutzer).await.unwrap();
        assert!(fuer_fremd.is_empty());
    }

    #[tokio::test]
    async fn anlegen_vergibt_fortlaufende_einsatznummer() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
            .fetch_one(&pool)
            .await
            .unwrap();

        let a = anlegen(&pool, "Lage A", None, leit).await.unwrap();
        let b = anlegen(&pool, "Lage B", None, leit).await.unwrap();
        assert_eq!(a.einsatznummer_intern.as_deref(), Some(format!("{jahr}-001").as_str()));
        assert_eq!(b.einsatznummer_intern.as_deref(), Some(format!("{jahr}-002").as_str()));

        // angelegt_at wurde gesetzt (nicht der '' Default).
        assert!(!a.angelegt_at.is_empty());
    }

    #[tokio::test]
    async fn anlegen_zaehlt_je_organisation_getrennt() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await; // legt Org id=1 an

        let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
            .fetch_one(&pool)
            .await
            .unwrap();

        // Zweite Organisation mit bereits hoher Nummer — darf Org 1 nicht beeinflussen.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Orga 2')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (2, 'Fremd', ?)")
            .bind(format!("{jahr}-009"))
            .execute(&pool)
            .await
            .unwrap();

        // anlegen nutzt Org 1 (ORDER BY id LIMIT 1) → beginnt bei 001.
        let a = anlegen(&pool, "Lage", None, leit).await.unwrap();
        assert_eq!(a.einsatznummer_intern.as_deref(), Some(format!("{jahr}-001").as_str()));
    }

    #[tokio::test]
    async fn aktualisiere_kopf_setzt_felder_und_leere_optionals_null() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Alt", None, leit).await.unwrap();

        let aktualisiert = aktualisiere_kopf(
            &pool,
            einsatz.id,
            KopfDaten {
                bezeichnung: "Neu",
                stichwort: Some("H1"),
                einsatzart: crate::einsatz::EINSATZART_UEBUNG,
                einsatznummer_intern: einsatz.einsatznummer_intern.as_deref(),
                leitstellen_nr: None,
                einsatzort: Some("Hauptstraße 1"),
                einsatzort_lat: Some(52.5),
                einsatzort_lon: Some(13.4),
                meldende_stelle: None,
                sachverhalt: Some("Mehrzeiliges\nMeldebild"),
                anzahl_betroffene_initial: Some(3),
                begonnen_at: "2026-05-25 08:00:00",
            },
        )
        .await
        .unwrap();

        assert_eq!(aktualisiert.bezeichnung, "Neu");
        assert_eq!(aktualisiert.einsatzart, "uebung");
        assert_eq!(aktualisiert.einsatzort.as_deref(), Some("Hauptstraße 1"));
        assert_eq!(aktualisiert.einsatzort_lat, Some(52.5));
        assert_eq!(aktualisiert.anzahl_betroffene_initial, Some(3));
        assert_eq!(aktualisiert.leitstellen_nr, None);
        assert_eq!(aktualisiert.begonnen_at, "2026-05-25 08:00:00");
        // angelegt_at bleibt unverändert (Audit-Spur).
        assert_eq!(aktualisiert.angelegt_at, einsatz.angelegt_at);
    }

    #[tokio::test]
    async fn aktualisiere_kopf_doppelte_nummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let a = anlegen(&pool, "A", None, leit).await.unwrap();
        let b = anlegen(&pool, "B", None, leit).await.unwrap();

        // b auf a's Nummer setzen → Unique-Verstoß → Conflict.
        let err = aktualisiere_kopf(
            &pool,
            b.id,
            KopfDaten {
                bezeichnung: "B",
                stichwort: None,
                einsatzart: crate::einsatz::EINSATZART_REALEINSATZ,
                einsatznummer_intern: a.einsatznummer_intern.as_deref(),
                leitstellen_nr: None,
                einsatzort: None,
                einsatzort_lat: None,
                einsatzort_lon: None,
                meldende_stelle: None,
                sachverhalt: None,
                anzahl_betroffene_initial: None,
                begonnen_at: &b.begonnen_at,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn liste_fuer_zeigt_admin_nicht_mitglied_fremden_einsatz() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let admin = benutzer_anlegen(&pool, "admin").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        // Admin zur höheren Berechtigung machen.
        sqlx::query("UPDATE benutzer SET system_rolle = ? WHERE id = ?")
            .bind(crate::auth::ROLLE_ADMIN)
            .bind(admin)
            .execute(&pool)
            .await
            .unwrap();

        // Admin ist KEIN Mitglied, sieht den Einsatz aber trotzdem (ohne Rolle).
        let admin_benutzer = benutzer_laden(&pool, admin).await;
        let fuer_admin = liste_fuer(&pool, &admin_benutzer).await.unwrap();
        assert_eq!(fuer_admin.len(), 1);
        assert_eq!(fuer_admin[0].id, einsatz.id);
        assert_eq!(fuer_admin[0].meine_rolle, None);
    }
}
