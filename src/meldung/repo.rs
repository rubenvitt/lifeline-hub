use crate::error::AppError;
use sqlx::SqlitePool;

use super::{meldungsart_gueltig, prioritaet_gueltig, LageMeldungAnzeige, MeldungAnzeige};

/// Validierte Eingabe für eine neue Meldung (Handler hat getrimmt/normalisiert).
#[derive(Debug)]
pub struct MeldungDaten<'a> {
    pub absender: &'a str,
    pub empfaenger: Option<&'a str>,
    pub meldeweg: &'a str,
    pub inhalt: &'a str,
    pub meldungsart: &'a str,
    pub prioritaet: &'a str,
    pub ereigniszeit: &'a str,
    pub eingang_at: &'a str,
}

/// SELECT-Projektion inkl. Bearbeitername (LEFT JOIN benutzer), Herkunfts-Rückverweis
/// (Subquery lage_meldung) und abgeleiteten Feldern. Reihenfolge der Spalten = Struct.
const ANZEIGE_SELECT: &str =
    "SELECT m.id, m.einsatz_id, m.lfd_nr, m.absender, m.empfaenger, m.meldeweg, m.inhalt, \
            m.meldungsart, m.prioritaet, m.status, m.bearbeiter_id, b.anzeigename AS bearbeiter_name, \
            m.lagerelevant, m.ereigniszeit, m.eingang_at, m.etb_meldung_id, m.auftrag_id, \
            m.erfasst_von_id, m.erstellt_at, \
            (SELECT lm.id FROM lage_meldung lm WHERE lm.meldung_id = m.id) AS lage_meldung_id, \
            (m.status != 'erledigt') AS ist_offen \
     FROM meldung m LEFT JOIN benutzer b ON b.id = m.bearbeiter_id";

/// Lädt eine Meldung als Anzeige. `NotFound`, wenn unbekannt.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<MeldungAnzeige, AppError> {
    sqlx::query_as::<_, MeldungAnzeige>(&format!("{ANZEIGE_SELECT} WHERE m.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt eine Meldung an und erzeugt im selben Commit den ETB-Eintrag (typ='meldung',
/// Pattern B mit beidseitigem Backlink). `lfd_nr` atomar (COALESCE(MAX)+1 pro Einsatz).
/// `daten` ist vom Handler validiert (Pflichtfelder, Vokabular, Zeit normalisiert).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: MeldungDaten<'_>,
) -> Result<MeldungAnzeige, AppError> {
    debug_assert!(prioritaet_gueltig(daten.prioritaet));
    debug_assert!(meldungsart_gueltig(daten.meldungsart));
    let mut tx = pool.begin().await?;

    // lfd_nr atomar je Einsatz (Muster etb/repo.rs).
    let meldung_id: i64 = sqlx::query_scalar(
        "INSERT INTO meldung \
           (einsatz_id, lfd_nr, absender, empfaenger, meldeweg, inhalt, meldungsart, \
            prioritaet, ereigniszeit, eingang_at, erfasst_von_id) \
         SELECT ?, COALESCE(MAX(lfd_nr), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? \
         FROM meldung WHERE einsatz_id = ? \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.absender)
    .bind(daten.empfaenger)
    .bind(daten.meldeweg)
    .bind(daten.inhalt)
    .bind(daten.meldungsart)
    .bind(daten.prioritaet)
    .bind(daten.ereigniszeit)
    .bind(daten.eingang_at)
    .bind(erfasser_id)
    .bind(einsatz_id)
    .fetch_one(&mut *tx)
    .await?;

    // ETB-Meldung (Pattern B) im selben Commit. Nachrichtenvordruck-Felder mappen
    // direkt: von=absender, an=empfaenger, meldeweg, inhalt, ereigniszeit.
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        erfasser_id,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_MELDUNG,
            inhalt: daten.inhalt,
            von: Some(daten.absender),
            an: daten.empfaenger,
            meldeweg: Some(daten.meldeweg),
            veranlassung: None,
            ereigniszeit: Some(daten.ereigniszeit),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    sqlx::query("UPDATE etb_eintrag SET meldung_id = ? WHERE id = ?")
        .bind(meldung_id)
        .bind(etb_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE meldung SET etb_meldung_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(meldung_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    laden(pool, meldung_id).await
}

/// Listet Meldungen eines Einsatzes (optional Status-Filter). Sortierung:
/// Priorität (sofort→normal), dann neueste Ereigniszeit zuerst, dann lfd_nr.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
) -> Result<Vec<MeldungAnzeige>, AppError> {
    let mut q = format!("{ANZEIGE_SELECT} WHERE m.einsatz_id = ?");
    if status_filter.is_some() {
        q.push_str(" AND m.status = ?");
    }
    q.push_str(
        " ORDER BY CASE m.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
          m.ereigniszeit DESC, m.lfd_nr DESC",
    );
    let mut query = sqlx::query_as::<_, MeldungAnzeige>(&q).bind(einsatz_id);
    if let Some(s) = status_filter {
        query = query.bind(s);
    }
    query.fetch_all(pool).await.map_err(Into::into)
}

/// Cross-Einsatz-Schutz: gehört die Meldung zum Einsatz?
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM meldung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Setzt den Triage-Status und den Bearbeiter (LFH-94). `bearbeiter_id` wird
/// übernommen wie geliefert: `Some(id)` setzt/ändert, `None` entfernt eine
/// bestehende Zuweisung (Sichten ohne Bearbeiter ist erlaubt).
pub async fn setze_status(
    pool: &SqlitePool,
    id: i64,
    status: &str,
    bearbeiter_id: Option<i64>,
) -> Result<(), AppError> {
    debug_assert!(super::status_gueltig(status));
    sqlx::query("UPDATE meldung SET status = ?, bearbeiter_id = ? WHERE id = ?")
        .bind(status)
        .bind(bearbeiter_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Übergibt eine Meldung an die Lage (LFH-95): setzt `lagerelevant=1` und legt
/// (idempotent, UNIQUE meldung_id) ein Lageobjekt an. Geo optional (Meldung hat oft
/// keine Koordinaten). `text` = Lage-Notiz (Default: Meldungsinhalt). Atomar (Tx):
/// ein Teilfehler rollt Flag und Lageobjekt gemeinsam zurück. Liefert die Lageobjekt-id.
pub async fn als_lagerelevant(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    text: &str,
    geo: Option<(f64, f64)>,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE meldung SET lagerelevant = 1 WHERE id = ?")
        .bind(meldung_id)
        .execute(&mut *tx)
        .await?;
    let (lat, lon) = match geo {
        Some((a, o)) => (Some(a), Some(o)),
        None => (None, None),
    };
    let lage_id: i64 = sqlx::query_scalar(
        "INSERT INTO lage_meldung (einsatz_id, meldung_id, text, lat, lon, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT(meldung_id) DO UPDATE SET text = excluded.text \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(meldung_id)
    .bind(text)
    .bind(lat)
    .bind(lon)
    .bind(von_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(lage_id)
}

/// Listet Lageobjekte eines Einsatzes inkl. Herkunft (Quell-Meldung). Neueste zuerst.
pub async fn liste_lage_meldungen(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LageMeldungAnzeige>, AppError> {
    sqlx::query_as::<_, LageMeldungAnzeige>(
        "SELECT lm.id, lm.einsatz_id, lm.meldung_id, lm.text, lm.lat, lm.lon, \
                lm.erstellt_von_id, lm.erstellt_at, \
                m.lfd_nr AS meldung_lfd_nr, m.absender AS meldung_absender \
         FROM lage_meldung lm JOIN meldung m ON m.id = lm.meldung_id \
         WHERE lm.einsatz_id = ? ORDER BY lm.id DESC",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meldung::{ART_SOFORTMELDUNG, PRIO_NORMAL};

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Leit','leit','h') RETURNING id").fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    fn daten<'a>(inhalt: &'a str, ereignis: &'a str, eingang: &'a str) -> MeldungDaten<'a> {
        MeldungDaten {
            absender: "Florian Nord 1",
            empfaenger: Some("ELW 1"),
            meldeweg: "funk",
            inhalt,
            meldungsart: ART_SOFORTMELDUNG,
            prioritaet: PRIO_NORMAL,
            ereigniszeit: ereignis,
            eingang_at: eingang,
        }
    }

    #[tokio::test]
    async fn anlegen_speichert_meldung_mit_default_status_neu() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Deich instabil", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        assert_eq!(m.lfd_nr, 1);
        assert_eq!(m.absender, "Florian Nord 1");
        assert_eq!(m.empfaenger.as_deref(), Some("ELW 1"));
        assert_eq!(m.status, "neu");
        assert!(m.ist_offen);
        assert!(!m.lagerelevant);
        assert_eq!(m.ereigniszeit, "2026-06-12 09:00:00");
        assert_eq!(m.eingang_at, "2026-06-12 09:05:00");
        assert!(m.etb_meldung_id.is_some(), "ETB-Meldung wird erzeugt");
        assert!(m.lage_meldung_id.is_none());
    }

    #[tokio::test]
    async fn anlegen_erzeugt_etb_meldung_mit_backlink_und_feldmapping() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Lage ruhig", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let etb_id = m.etb_meldung_id.unwrap();
        let (typ, von, an, weg, backlink): (String, Option<String>, Option<String>, Option<String>, i64) =
            sqlx::query_as("SELECT typ, von, an, meldeweg, meldung_id FROM etb_eintrag WHERE id = ?")
                .bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(von.as_deref(), Some("Florian Nord 1"));
        assert_eq!(an.as_deref(), Some("ELW 1"));
        assert_eq!(weg.as_deref(), Some("funk"));
        assert_eq!(backlink, m.id);
    }

    #[tokio::test]
    async fn lfd_nr_zaehlt_pro_einsatz_hoch() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m1 = anlegen(&pool, e, b, daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let m2 = anlegen(&pool, e, b, daten("B", "2026-06-12 09:01:00", "2026-06-12 09:01:00")).await.unwrap();
        assert_eq!(m1.lfd_nr, 1);
        assert_eq!(m2.lfd_nr, 2);
    }

    #[tokio::test]
    async fn laden_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(laden(&pool, 999).await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn liste_liefert_meldungen_sortiert_nach_prio() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("normal", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let d = daten("sofort", "2026-06-12 08:00:00", "2026-06-12 08:00:00");
        let sofort = MeldungDaten { prioritaet: crate::meldung::PRIO_SOFORT, ..d };
        anlegen(&pool, e, b, sofort).await.unwrap();
        let liste = liste(&pool, e, None).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].inhalt, "sofort", "sofort vor normal trotz älterer Ereigniszeit");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let liste_neu = liste(&pool, e, Some("neu")).await.unwrap();
        assert_eq!(liste_neu.len(), 1);
        let liste_erledigt = liste(&pool, e, Some("erledigt")).await.unwrap();
        assert!(liste_erledigt.is_empty());
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        assert!(gehoert_zu_einsatz(&pool, m.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, m.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn setze_status_fuehrt_workflow_und_bearbeiter() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        setze_status(&pool, m.id, crate::meldung::STATUS_IN_BEARBEITUNG, Some(b)).await.unwrap();
        let nach = laden(&pool, m.id).await.unwrap();
        assert_eq!(nach.status, "in_bearbeitung");
        // ist_offen = status != 'erledigt' → in_bearbeitung bleibt offen.
        assert!(nach.ist_offen);
        assert_eq!(nach.bearbeiter_id, Some(b));
        assert_eq!(nach.bearbeiter_name.as_deref(), Some("Leit"));
    }

    #[tokio::test]
    async fn erledigt_ist_nicht_mehr_offen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        setze_status(&pool, m.id, crate::meldung::STATUS_ERLEDIGT, None).await.unwrap();
        let nach = laden(&pool, m.id).await.unwrap();
        assert_eq!(nach.status, "erledigt");
        assert!(!nach.ist_offen);
    }

    #[tokio::test]
    async fn als_lagerelevant_setzt_flag_und_erzeugt_lageobjekt_mit_herkunft() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Brücke gesperrt", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let lage_id = als_lagerelevant(&pool, e, m.id, b, "Brücke gesperrt", None).await.unwrap();
        let nach = laden(&pool, m.id).await.unwrap();
        assert!(nach.lagerelevant);
        assert_eq!(nach.lage_meldung_id, Some(lage_id));
        let liste = liste_lage_meldungen(&pool, e).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].meldung_lfd_nr, m.lfd_nr);
        assert_eq!(liste[0].meldung_absender, "Florian Nord 1");
        assert_eq!(liste[0].text, "Brücke gesperrt");
    }

    #[tokio::test]
    async fn als_lagerelevant_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let id1 = als_lagerelevant(&pool, e, m.id, b, "erste", None).await.unwrap();
        let id2 = als_lagerelevant(&pool, e, m.id, b, "zweite", None).await.unwrap();
        assert_eq!(id1, id2, "UNIQUE meldung_id → ein Lageobjekt");
        assert_eq!(liste_lage_meldungen(&pool, e).await.unwrap().len(), 1);
    }
}
