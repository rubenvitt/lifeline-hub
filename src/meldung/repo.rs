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
    pub richtung: &'a str,
    pub ereigniszeit: &'a str,
    pub eingang_at: &'a str,
    /// Sofortmeldung & Eskalation (LFH-97): aktive Bestätigungspflicht.
    pub bestaetigung_pflicht: bool,
    /// Absolute Bestätigungsfrist (UTC), nur bei Pflicht gesetzt.
    pub bestaetigung_frist_at: Option<&'a str>,
}

/// SELECT-Projektion inkl. Bearbeitername (LEFT JOIN benutzer), Herkunfts-Rückverweis
/// (Subquery lage_meldung), Bestätigungs-Achse (LEFT JOIN kommunikation_status, objekt_typ
/// ='meldung') und abgeleiteten Feldern. Reihenfolge der Spalten = Struct (FromRow positional).
///
/// `ist_ueberfaellig` ist eine computed column mit `jetzt`-Vergleich → ihr `?` steht textuell
/// VOR der WHERE-Klausel; alle Aufrufer binden `jetzt` als ERSTEN Parameter (Muster erinnerung).
const ANZEIGE_SELECT: &str =
    "SELECT m.id, m.einsatz_id, m.lfd_nr, m.absender, m.empfaenger, m.meldeweg, m.inhalt, \
            m.meldungsart, m.prioritaet, m.richtung, m.status, m.bearbeiter_id, b.anzeigename AS bearbeiter_name, \
            m.lagerelevant, m.ereigniszeit, m.eingang_at, m.etb_meldung_id, m.auftrag_id, \
            m.erfasst_von_id, m.erstellt_at, \
            (SELECT lm.id FROM lage_meldung lm WHERE lm.meldung_id = m.id) AS lage_meldung_id, \
            (m.status != 'erledigt') AS ist_offen, \
            m.erledigt_at, \
            m.bestaetigung_pflicht, m.bestaetigung_frist_at, m.eskaliert, \
            ks.quittiert_at AS bestaetigt_at, ks.quittiert_von_id AS bestaetigt_von_id, \
            qb.anzeigename AS bestaetigt_von_name, \
            (ks.quittiert_at IS NOT NULL) AS ist_bestaetigt, \
            (m.bestaetigung_pflicht = 1 AND ks.quittiert_at IS NULL \
             AND m.bestaetigung_frist_at IS NOT NULL AND m.bestaetigung_frist_at <= ?) AS ist_ueberfaellig \
     FROM meldung m \
     LEFT JOIN benutzer b ON b.id = m.bearbeiter_id \
     LEFT JOIN kommunikation_status ks ON ks.objekt_typ = 'meldung' AND ks.objekt_id = m.id \
     LEFT JOIN benutzer qb ON qb.id = ks.quittiert_von_id";

/// Lädt eine Meldung als Anzeige. `NotFound`, wenn unbekannt.
/// Bind-Reihenfolge: zuerst `jetzt` (computed `ist_ueberfaellig`), dann `id` (WHERE).
pub async fn laden(pool: &SqlitePool, id: i64, jetzt: &str) -> Result<MeldungAnzeige, AppError> {
    sqlx::query_as::<_, MeldungAnzeige>(&format!("{ANZEIGE_SELECT} WHERE m.id = ?"))
        .bind(jetzt)
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
    debug_assert!(super::richtung_gueltig(daten.richtung));
    let mut tx = pool.begin().await?;

    // lfd_nr atomar je Einsatz (Muster etb/repo.rs).
    let meldung_id: i64 = sqlx::query_scalar(
        "INSERT INTO meldung \
           (einsatz_id, lfd_nr, absender, empfaenger, meldeweg, inhalt, meldungsart, \
            prioritaet, richtung, ereigniszeit, eingang_at, bestaetigung_pflicht, bestaetigung_frist_at, \
            erfasst_von_id) \
         SELECT ?, COALESCE(MAX(lfd_nr), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? \
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
    .bind(daten.richtung)
    .bind(daten.ereigniszeit)
    .bind(daten.eingang_at)
    .bind(daten.bestaetigung_pflicht)
    .bind(daten.bestaetigung_frist_at)
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
    // `eingang_at` ist der Erfassungszeitpunkt = „jetzt" für die frisch erzeugte Meldung;
    // ist_ueberfaellig ist hier ohnehin false (Frist liegt in der Zukunft).
    laden(pool, meldung_id, daten.eingang_at).await
}

/// Listet Meldungen eines Einsatzes (optional Status-Filter). Sortierung:
/// Priorität (sofort→normal), eskalierte zuerst, dann neueste Ereigniszeit, dann lfd_nr.
/// Bind-Reihenfolge: zuerst `jetzt` (computed `ist_ueberfaellig`), dann WHERE-Parameter.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
    richtung_filter: Option<&str>,
    jetzt: &str,
) -> Result<Vec<MeldungAnzeige>, AppError> {
    let mut q = format!("{ANZEIGE_SELECT} WHERE m.einsatz_id = ?");
    if status_filter.is_some() {
        q.push_str(" AND m.status = ?");
    }
    if richtung_filter.is_some() {
        q.push_str(" AND m.richtung = ?");
    }
    q.push_str(
        " ORDER BY CASE m.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
          m.eskaliert DESC, m.ereigniszeit DESC, m.lfd_nr DESC",
    );
    // Bind-Reihenfolge = textuelle ?-Reihenfolge: jetzt, einsatz_id, [status], [richtung].
    let mut query = sqlx::query_as::<_, MeldungAnzeige>(&q).bind(jetzt).bind(einsatz_id);
    if let Some(s) = status_filter {
        query = query.bind(s);
    }
    if let Some(r) = richtung_filter {
        query = query.bind(r);
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

/// Setzt NUR den Triage-Status (LFH-94). Die Bearbeiter-Zuweisung ist eine
/// getrennte Achse (`weise_bearbeiter`) — ein Statuswechsel darf eine bestehende
/// Zuweisung nicht stillschweigend überschreiben (vgl. patch-xor-effektivzustand).
pub async fn setze_status(
    pool: &SqlitePool,
    id: i64,
    status: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    debug_assert!(super::status_gueltig(status));
    // Erledigt-Stempel (LFH-113): first-write-wins — nur beim Übergang nach 'erledigt'
    // und nur solange noch NULL (COALESCE). Wird der Status später zurückgesetzt, bleibt
    // erledigt_at erhalten; ein erneutes Erledigen überschreibt den ersten Stempel nicht.
    sqlx::query(
        "UPDATE meldung SET status = ?, \
         erledigt_at = CASE WHEN ? = 'erledigt' THEN COALESCE(erledigt_at, ?) ELSE erledigt_at END \
         WHERE id = ?",
    )
    .bind(status)
    .bind(status)
    .bind(jetzt)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Setzt/entfernt die Bearbeiter-Zuweisung (LFH-94), unabhängig vom Status.
/// `Some(id)` weist zu, `None` gibt frei. Der Aufrufer hat die Mitgliedschaft
/// des Bearbeiters geprüft (Cross-Einsatz-Schutz).
pub async fn weise_bearbeiter(
    pool: &SqlitePool,
    id: i64,
    bearbeiter_id: Option<i64>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE meldung SET bearbeiter_id = ? WHERE id = ?")
        .bind(bearbeiter_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Bestätigt eine Sofortmeldung (LFH-97): setzt die Quittungs-Achse (kommunikation_status,
/// objekt_typ='meldung') **atomar einmalig** und schließt eine etwaige offene Auto-Frist-
/// Erinnerung des Bezugs (stoppt Nachfass/Eskalation). Liefert `true`, wenn DIESER Aufruf
/// bestätigt hat; `false`, wenn bereits bestätigt war (→ Handler antwortet 422, ohne TOCTOU).
/// Der Triage-`status` bleibt unangetastet (eigene Achse, vgl. patch-xor-effektivzustand);
/// ein etwaiges `eskaliert`-Flag wird mit der Bestätigung zurückgesetzt (Daten-Hygiene + Sortierung).
pub async fn bestaetige(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let frisch = crate::kommunikation::repo::quittiere_einmalig(
        pool,
        org_id,
        einsatz_id,
        crate::kommunikation::OBJEKT_MELDUNG,
        meldung_id,
        von_id,
        jetzt,
    )
    .await?;
    if !frisch {
        return Ok(false);
    }
    crate::erinnerung::repo::schliesse_offene_auto(
        pool,
        crate::kommunikation::OBJEKT_MELDUNG,
        meldung_id,
        jetzt,
    )
    .await?;
    // Eskalations-Residuum löschen: nach Bestätigung ist die Meldung nicht mehr „eskaliert".
    sqlx::query("UPDATE meldung SET eskaliert = 0 WHERE id = ?")
        .bind(meldung_id)
        .execute(pool)
        .await?;
    Ok(true)
}

/// Setzt das Eskalations-Flag — aber NUR wenn die Meldung bestätigungspflichtig, ihre Frist
/// überschritten und sie noch unbestätigt ist und noch nicht eskaliert war. Liefert `true`,
/// wenn dieser Aufruf frisch eskaliert hat (→ genau ein Re-Highlight). Der `eskaliert = 0`-Guard
/// macht es One-Shot; aufgerufen ausschließlich aus dem Erinnerungs-Tick (kein eigener Timer).
pub async fn setze_eskaliert(pool: &SqlitePool, meldung_id: i64, jetzt: &str) -> Result<bool, AppError> {
    let rows = sqlx::query(
        "UPDATE meldung SET eskaliert = 1 \
         WHERE id = ? AND bestaetigung_pflicht = 1 AND eskaliert = 0 \
           AND bestaetigung_frist_at IS NOT NULL AND bestaetigung_frist_at <= ? \
           AND NOT EXISTS ( \
             SELECT 1 FROM kommunikation_status ks \
             WHERE ks.objekt_typ = 'meldung' AND ks.objekt_id = meldung.id \
               AND ks.quittiert_at IS NOT NULL)",
    )
    .bind(meldung_id)
    .bind(jetzt)
    .execute(pool)
    .await?;
    Ok(rows.rows_affected() > 0)
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

/// Erteilt aus einer eingegangenen Meldung einen Auftrag (LFH-113) — in EINEM Commit:
/// legt den Auftrag inkl. seiner ETB-Anordnung an (`auftrag::repo::anlegen_tx`, Pattern B,
/// wie Chat→Auftrag LFH-101) und setzt den Rückverweis `meldung.auftrag_id`. First-write-wins:
/// ist die Meldung bereits mit einem Auftrag verknüpft → `Conflict` (vor der Auftrags-Anlage
/// geprüft, sodass kein verwaister Auftrag entsteht). `daten` ist bereits vom Handler validiert
/// (Auftragstext + >=1 Empfänger, Slots/Zugehörigkeit geprüft). Liefert die neue `auftrag_id`.
pub async fn erteile_auftrag_tx(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
    erteiler_id: i64,
    daten: crate::auftrag::repo::AuftragDaten<'_>,
) -> Result<i64, AppError> {
    let mut tx = pool.begin().await?;

    // Guard: schon mit einem Auftrag verknüpft? (Sperrt Doppel-Verknüpfung; first-write-wins.)
    // Meldung kennt kein Soft-Delete (nur erledigt_at/status) → nur auftrag_id prüfen.
    let auftrag_vorhanden: Option<Option<i64>> =
        sqlx::query_scalar("SELECT auftrag_id FROM meldung WHERE id = ?")
            .bind(meldung_id)
            .fetch_optional(&mut *tx)
            .await?;
    let auftrag_vorhanden = auftrag_vorhanden.ok_or(AppError::NotFound)?;
    if auftrag_vorhanden.is_some() {
        return Err(AppError::Conflict(
            "Aus dieser Meldung wurde bereits ein Auftrag erteilt".into(),
        ));
    }

    let auftrag_id =
        crate::auftrag::repo::anlegen_tx(&mut tx, einsatz_id, erteiler_id, &daten).await?;

    sqlx::query("UPDATE meldung SET auftrag_id = ? WHERE id = ?")
        .bind(auftrag_id)
        .bind(meldung_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(auftrag_id)
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
            richtung: "intern",
            ereigniszeit: ereignis,
            eingang_at: eingang,
            bestaetigung_pflicht: false,
            bestaetigung_frist_at: None,
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
        assert!(matches!(laden(&pool, 999, "2026-06-12 10:00:00").await.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn liste_liefert_meldungen_sortiert_nach_prio() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("normal", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let d = daten("sofort", "2026-06-12 08:00:00", "2026-06-12 08:00:00");
        let sofort = MeldungDaten { prioritaet: crate::meldung::PRIO_SOFORT, ..d };
        anlegen(&pool, e, b, sofort).await.unwrap();
        let liste = liste(&pool, e, None, None, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].inhalt, "sofort", "sofort vor normal trotz älterer Ereigniszeit");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("A", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let liste_neu = liste(&pool, e, Some("neu"), None, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(liste_neu.len(), 1);
        let liste_erledigt = liste(&pool, e, Some("erledigt"), None, "2026-06-12 10:00:00").await.unwrap();
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
    async fn setze_status_fuehrt_nur_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        setze_status(&pool, m.id, crate::meldung::STATUS_IN_BEARBEITUNG, "2026-06-12 09:30:00").await.unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.status, "in_bearbeitung");
        // ist_offen = status != 'erledigt' → in_bearbeitung bleibt offen.
        assert!(nach.ist_offen);
        // Noch nicht erledigt → kein Erledigt-Stempel.
        assert!(nach.erledigt_at.is_none());
    }

    #[tokio::test]
    async fn weise_bearbeiter_setzt_und_gibt_frei() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        weise_bearbeiter(&pool, m.id, Some(b)).await.unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.bearbeiter_id, Some(b));
        assert_eq!(nach.bearbeiter_name.as_deref(), Some("Leit"));
        // Freigeben.
        weise_bearbeiter(&pool, m.id, None).await.unwrap();
        assert_eq!(laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap().bearbeiter_id, None);
    }

    #[tokio::test]
    async fn statuswechsel_loescht_die_zuweisung_nicht() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        weise_bearbeiter(&pool, m.id, Some(b)).await.unwrap();
        // Reiner Statuswechsel darf den Bearbeiter NICHT clobbern (Regression #2/#3).
        setze_status(&pool, m.id, crate::meldung::STATUS_ERLEDIGT, "2026-06-12 09:30:00").await.unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.status, "erledigt");
        assert_eq!(nach.bearbeiter_id, Some(b), "Zuweisung bleibt über Statuswechsel erhalten");
    }

    #[tokio::test]
    async fn erledigt_ist_nicht_mehr_offen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        setze_status(&pool, m.id, crate::meldung::STATUS_ERLEDIGT, "2026-06-12 09:30:00").await.unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nach.status, "erledigt");
        assert!(!nach.ist_offen);
        // Übergang nach 'erledigt' setzt den Erledigt-Stempel (LFH-113).
        assert_eq!(nach.erledigt_at.as_deref(), Some("2026-06-12 09:30:00"));
    }

    #[tokio::test]
    async fn erledigt_at_ist_first_write_wins() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        // Erstes Erledigen setzt den Stempel.
        setze_status(&pool, m.id, crate::meldung::STATUS_ERLEDIGT, "2026-06-12 09:30:00").await.unwrap();
        assert_eq!(
            laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap().erledigt_at.as_deref(),
            Some("2026-06-12 09:30:00"),
        );
        // Zurücksetzen (z. B. wieder in Bearbeitung) darf den Stempel NICHT löschen.
        setze_status(&pool, m.id, crate::meldung::STATUS_IN_BEARBEITUNG, "2026-06-12 09:40:00").await.unwrap();
        assert_eq!(
            laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap().erledigt_at.as_deref(),
            Some("2026-06-12 09:30:00"),
            "Erledigt-Stempel bleibt über ein Zurücksetzen erhalten",
        );
        // Erneutes Erledigen darf den ersten Stempel NICHT überschreiben (first-write-wins).
        setze_status(&pool, m.id, crate::meldung::STATUS_ERLEDIGT, "2026-06-12 09:50:00").await.unwrap();
        assert_eq!(
            laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap().erledigt_at.as_deref(),
            Some("2026-06-12 09:30:00"),
            "erneutes Erledigen behält den ersten Stempel",
        );
    }

    #[tokio::test]
    async fn als_lagerelevant_setzt_flag_und_erzeugt_lageobjekt_mit_herkunft() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Brücke gesperrt", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        let lage_id = als_lagerelevant(&pool, e, m.id, b, "Brücke gesperrt", None).await.unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
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

    /// Hilfsdaten für eine bestätigungspflichtige Sofortmeldung mit absoluter Frist.
    fn daten_pflicht<'a>(inhalt: &'a str, eingang: &'a str, frist: &'a str) -> MeldungDaten<'a> {
        MeldungDaten {
            bestaetigung_pflicht: true,
            bestaetigung_frist_at: Some(frist),
            ..daten(inhalt, eingang, eingang)
        }
    }

    #[tokio::test]
    async fn anlegen_speichert_bestaetigungspflicht_und_frist() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        assert!(m.bestaetigung_pflicht);
        assert_eq!(m.bestaetigung_frist_at.as_deref(), Some("2026-06-12 09:05:00"));
        assert!(!m.eskaliert);
        assert!(!m.ist_bestaetigt, "frisch angelegt → unbestätigt");
        assert!(m.bestaetigt_at.is_none());
    }

    #[tokio::test]
    async fn ist_ueberfaellig_wird_aus_jetzt_abgeleitet() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        // Vor Frist: nicht überfällig.
        let vor = laden(&pool, m.id, "2026-06-12 09:04:00").await.unwrap();
        assert!(!vor.ist_ueberfaellig);
        // Nach Frist + unbestätigt: überfällig.
        let nach = laden(&pool, m.id, "2026-06-12 09:06:00").await.unwrap();
        assert!(nach.ist_ueberfaellig);
    }

    #[tokio::test]
    async fn bestaetige_setzt_quittung_ohne_status_clobber() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        // Bearbeiter + Status gesetzt — dürfen über die Bestätigung NICHT verloren gehen.
        weise_bearbeiter(&pool, m.id, Some(b)).await.unwrap();
        setze_status(&pool, m.id, crate::meldung::STATUS_IN_BEARBEITUNG, "2026-06-12 09:05:30").await.unwrap();

        bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00").await.unwrap();
        let nach = laden(&pool, m.id, "2026-06-12 09:07:00").await.unwrap();
        assert!(nach.ist_bestaetigt);
        assert_eq!(nach.bestaetigt_at.as_deref(), Some("2026-06-12 09:06:00"));
        assert_eq!(nach.bestaetigt_von_id, Some(b));
        assert_eq!(nach.bestaetigt_von_name.as_deref(), Some("Leit"));
        assert!(!nach.ist_ueberfaellig, "bestätigt → nicht mehr überfällig");
        assert_eq!(nach.status, "in_bearbeitung", "Triage-Status bleibt unberührt");
        assert_eq!(nach.bearbeiter_id, Some(b), "Zuweisung bleibt erhalten");
    }

    #[tokio::test]
    async fn bestaetige_schliesst_offene_auto_erinnerung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        crate::erinnerung::repo::anlegen_aus_frist(
            &pool, e, b, crate::kommunikation::OBJEKT_MELDUNG, m.id, "Nachfass", "2026-06-12 09:05:00", "2026-06-12 09:00:00",
        ).await.unwrap();

        bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00").await.unwrap();
        // Keine offene Auto-Erinnerung für den Bezug mehr.
        let offen: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM erinnerung WHERE quelle='auto_frist' AND status='offen' AND bezug_typ=? AND bezug_id=?",
        ).bind(crate::kommunikation::OBJEKT_MELDUNG).bind(m.id).fetch_optional(&pool).await.unwrap();
        assert!(offen.is_none(), "Bestätigung schließt die Nachfass-Erinnerung");
    }

    #[tokio::test]
    async fn setze_eskaliert_nur_ueberfaellig_unbestaetigt_und_one_shot() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        // Vor Frist: keine Eskalation.
        assert!(!setze_eskaliert(&pool, m.id, "2026-06-12 09:04:00").await.unwrap());
        // Nach Frist + unbestätigt: frische Eskalation (true).
        assert!(setze_eskaliert(&pool, m.id, "2026-06-12 09:06:00").await.unwrap());
        assert!(laden(&pool, m.id, "2026-06-12 09:06:00").await.unwrap().eskaliert);
        // Erneut: One-Shot, kein Doppel-Highlight.
        assert!(!setze_eskaliert(&pool, m.id, "2026-06-12 09:07:00").await.unwrap());
    }

    #[tokio::test]
    async fn bestaetige_einmalig_erste_gewinnt_kein_overwrite() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let b2: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Zwei','zwei','h') RETURNING id").fetch_one(&pool).await.unwrap();
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        // Erste Bestätigung gewinnt (true), zweite (anderer Bestätiger, später) ist No-op (false).
        assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00").await.unwrap());
        assert!(!bestaetige(&pool, 1, e, m.id, b2, "2026-06-12 09:08:00").await.unwrap());
        let nach = laden(&pool, m.id, "2026-06-12 09:09:00").await.unwrap();
        assert_eq!(nach.bestaetigt_at.as_deref(), Some("2026-06-12 09:06:00"), "Erst-Quittung bleibt");
        assert_eq!(nach.bestaetigt_von_id, Some(b), "Erst-Bestätiger bleibt (kein last-writer-wins)");
    }

    #[tokio::test]
    async fn bestaetige_setzt_eskaliert_zurueck() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        assert!(setze_eskaliert(&pool, m.id, "2026-06-12 09:06:00").await.unwrap());
        assert!(laden(&pool, m.id, "2026-06-12 09:06:00").await.unwrap().eskaliert);
        // Bestätigung räumt das Eskalations-Residuum ab.
        assert!(bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:07:00").await.unwrap());
        assert!(!laden(&pool, m.id, "2026-06-12 09:07:00").await.unwrap().eskaliert);
    }

    #[tokio::test]
    async fn setze_eskaliert_nicht_nach_bestaetigung() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten_pflicht("Sofort", "2026-06-12 09:00:00", "2026-06-12 09:05:00")).await.unwrap();
        bestaetige(&pool, 1, e, m.id, b, "2026-06-12 09:06:00").await.unwrap();
        // Trotz überschrittener Frist: bestätigt → keine Eskalation.
        assert!(!setze_eskaliert(&pool, m.id, "2026-06-12 09:07:00").await.unwrap());
        assert!(!laden(&pool, m.id, "2026-06-12 09:07:00").await.unwrap().eskaliert);
    }

    /// Baut minimale, valide Auftragsdaten (ein Funktions-Empfänger, keine DB-Lookups nötig).
    fn auftrag_daten(text: &str) -> crate::auftrag::repo::AuftragDaten<'_> {
        crate::auftrag::repo::AuftragDaten {
            auftrag_text: text,
            absicht: None,
            lage: None,
            ort: None,
            zeit: None,
            mittel: None,
            verbindung: None,
            sicherheit: None,
            prioritaet: "normal",
            richtung: "intern",
            frist_at: None,
            erteilt_at: "2026-06-12 10:00:00",
            empfaenger: vec![crate::auftrag::repo::EmpfaengerEingabe {
                empfaenger_typ: "funktion".into(),
                abschnitt_id: None,
                einheit_id: None,
                person_id: None,
                fahrzeug_id: None,
                funktion_text: Some("S4".into()),
                extern_kategorie: None,
                extern_bezeichnung: None,
            }],
        }
    }

    #[tokio::test]
    async fn erteile_auftrag_legt_auftrag_an_und_setzt_rueckverweis() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("Tank fordern", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();

        let auftrag_id =
            erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("Tank fordern")).await.unwrap();

        // Auftrag landet im Auftrag-Modul, ETB-Anordnung entsteht im selben Commit (Pattern B).
        let detail = crate::auftrag::repo::laden(&pool, auftrag_id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(detail.auftrag.auftrag_text, "Tank fordern");
        assert!(detail.auftrag.etb_anordnung_id.is_some(), "ETB-Anordnung im selben Commit erzeugt");
        assert_eq!(detail.empfaenger.len(), 1);

        // Rückverweis an der Meldung ist gesetzt.
        let nachher = laden(&pool, m.id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nachher.auftrag_id, Some(auftrag_id));
    }

    #[tokio::test]
    async fn erteile_auftrag_doppelt_ist_konflikt_und_legt_keinen_zweiten_auftrag_an() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let m = anlegen(&pool, e, b, daten("X", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("erster")).await.unwrap();

        let zweimal = erteile_auftrag_tx(&pool, e, m.id, b, auftrag_daten("zweiter")).await;
        assert!(matches!(zweimal.unwrap_err(), AppError::Conflict(_)));

        // Kein verwaister Auftrag: die zweite (abgewiesene) Anlage darf nichts hinterlassen.
        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auftrag WHERE einsatz_id = ?")
            .bind(e).fetch_one(&pool).await.unwrap();
        assert_eq!(anzahl, 1, "abgewiesene Doppel-Erteilung legt keinen zweiten Auftrag an (transaktional)");
    }

    #[tokio::test]
    async fn erteile_auftrag_unbekannte_meldung_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let ergebnis = erteile_auftrag_tx(&pool, e, 999, b, auftrag_daten("x")).await;
        assert!(matches!(ergebnis.unwrap_err(), AppError::NotFound));
    }

    #[tokio::test]
    async fn richtung_default_intern_und_filter_extern() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        // Default 'intern' über den daten()-Helper.
        let m_int = anlegen(&pool, e, b, daten("intern-m", "2026-06-12 09:00:00", "2026-06-12 09:00:00")).await.unwrap();
        assert_eq!(m_int.richtung, "intern");
        let extern_m = MeldungDaten { richtung: "extern", ..daten("extern-m", "2026-06-12 09:01:00", "2026-06-12 09:01:00") };
        anlegen(&pool, e, b, extern_m).await.unwrap();

        assert_eq!(liste(&pool, e, None, None, "2026-06-12 10:00:00").await.unwrap().len(), 2);
        let nur_extern = liste(&pool, e, None, Some("extern"), "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(nur_extern.len(), 1);
        assert_eq!(nur_extern[0].richtung, "extern");
        assert_eq!(nur_extern[0].inhalt, "extern-m");
    }
}
