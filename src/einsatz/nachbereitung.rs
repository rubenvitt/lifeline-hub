//! Nachbereitungsfrist eines Einsatzes (LLH-1494, Change `tkky2noy-archiv-nachbereitung`,
//! design.md D1).
//!
//! Die Nachbereitung ist die Zeit nach dem Abschluss, in der Hub und ELW den Einsatz im Klartext
//! haben. Danach übergibt die meldende Instanz einen eigenen Einsatz der verwahrenden (D4) und
//! räumt einen Spiegel ab (D5). Der Abschluss setzt `einsatz.nachbereitung_bis` aus der
//! Org-Vorgabe `org_einstellungen.nachbereitung_tage`; Einsatzleitung und Admin der Einsatz-Org
//! ändern sie über `PUT /api/einsaetze/{id}/nachbereitung`. Ohne Wert passiert nichts Neues.
//!
//! Anders als bei der Aufbewahrungsfrist gibt es keinen Bestätigungsschritt: das Ende der
//! Nachbereitung löscht nichts, was nicht verwahrt ist.

use super::repo::{laden, MitEtbEintraegen};
use super::retention::berechne_retention_bis;
use crate::error::AppError;
use crate::zeitdarstellung::Zeitstil;
use sqlx::{SqliteConnection, SqlitePool};

/// Ein System-Eintrag im ETB des Einsatzes.
async fn etb_system(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    etb_startwert: i64,
    inhalt: &str,
) -> Result<i64, AppError> {
    crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        erfasser_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await
}

/// Setzt beim Abschluss `nachbereitung_bis = abgeschlossen_at + tage`, wenn der Einsatz noch
/// keine hat (eine gesetzte bleibt, etwa nach Wiedereröffnen), und schreibt den System-Eintrag.
/// Liefert die Kennung des ETB-Eintrags oder `None`, wenn nichts gesetzt wurde.
pub(super) async fn beim_abschluss(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    von_benutzer_id: i64,
    etb_startwert: i64,
    stil: &Zeitstil,
    tage: i64,
) -> Result<Option<i64>, AppError> {
    let (abgeschlossen_at, bis): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT abgeschlossen_at, nachbereitung_bis FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    if bis.is_some() {
        return Ok(None);
    }
    let Some(neu) = abgeschlossen_at
        .as_deref()
        .and_then(|a| berechne_retention_bis(a, tage))
    else {
        return Ok(None);
    };
    sqlx::query(
        "UPDATE einsatz SET nachbereitung_bis = ? WHERE id = ? AND nachbereitung_bis IS NULL",
    )
    .bind(&neu)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    let inhalt = format!(
        "Nachbereitung bis {} (Vorgabe {tage} Tage ab Abschluss)",
        stil.zeitpunkt_text(&neu)
    );
    let id = etb_system(conn, einsatz_id, von_benutzer_id, etb_startwert, &inhalt).await?;
    Ok(Some(id))
}

/// ETB-Text einer geänderten Nachbereitungsfrist mit altem und neuem Wert (Drahtformat) in Zone
/// und Darstellung des Einsatzes.
pub fn audit(stil: &Zeitstil, alt: Option<&str>, neu: Option<&str>) -> String {
    match (alt, neu) {
        (_, None) => "Nachbereitungsfrist aufgehoben".to_string(),
        (None, Some(neu)) => format!(
            "Nachbereitungsfrist gesetzt auf {}",
            stil.zeitpunkt_text(neu)
        ),
        (Some(a), Some(neu)) => format!(
            "Nachbereitungsfrist geändert von {} auf {}",
            stil.zeitpunkt_text(a),
            stil.zeitpunkt_text(neu)
        ),
    }
}

/// Warum die Nachbereitung dieses Einsatzes nicht (mehr) änderbar ist, oder `None`.
fn sperre(
    status: &str,
    geloescht_at: Option<&str>,
    geschwaerzt_at: Option<&str>,
    abraeumen: bool,
) -> Option<AppError> {
    if status != super::STATUS_ABGESCHLOSSEN {
        return Some(AppError::UnprocessableEntity(
            "Die Nachbereitung beginnt mit dem Abschluss".into(),
        ));
    }
    if abraeumen {
        return Some(AppError::Conflict(
            "Der Einsatz ist übergeben und wird hier abgeräumt".into(),
        ));
    }
    if geschwaerzt_at.is_some() {
        return Some(AppError::Conflict(
            "Einsatz ist geschwärzt — die Nachbereitung ist nicht mehr änderbar".into(),
        ));
    }
    if geloescht_at.is_some() {
        return Some(AppError::Conflict(
            "Einsatz ist zur Löschung vorgemerkt — die Nachbereitung ist nicht änderbar".into(),
        ));
    }
    None
}

/// Status, gelöscht, geschwärzt, Nachbereitung bis, Abräumen vorgemerkt.
type KopfZeile = (String, Option<String>, Option<String>, Option<String>, bool);

/// Setzt, ändert oder hebt die Nachbereitungsfrist auf, mit System-Eintrag im ETB, in einer
/// Transaktion. `neu` ist bereits normalisiert. Unverändert → kein UPDATE und kein Eintrag.
/// 422, solange der Einsatz läuft; 409, wenn er vorgemerkt, geschwärzt oder schon übergeben ist.
pub async fn setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    neu: Option<&str>,
) -> Result<MitEtbEintraegen, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let stil = crate::zeitdarstellung::zeitstil_laden(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    let zeile: Option<KopfZeile> = sqlx::query_as(
        "SELECT status, geloescht_at, geschwaerzt_at, nachbereitung_bis, \
                    EXISTS (SELECT 1 FROM einsatz_abraeumen a WHERE a.einsatz_id = einsatz.id) \
             FROM einsatz WHERE id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((status, geloescht_at, geschwaerzt_at, alt, abraeumen)) = zeile else {
        return Err(AppError::NotFound);
    };
    if let Some(e) = sperre(
        &status,
        geloescht_at.as_deref(),
        geschwaerzt_at.as_deref(),
        abraeumen,
    ) {
        return Err(e);
    }
    let mut etb_eintrag_ids = Vec::new();
    if alt.as_deref() != neu {
        sqlx::query("UPDATE einsatz SET nachbereitung_bis = ? WHERE id = ?")
            .bind(neu)
            .bind(einsatz_id)
            .execute(&mut *tx)
            .await?;
        let inhalt = audit(&stil, alt.as_deref(), neu);
        etb_eintrag_ids
            .push(etb_system(&mut tx, einsatz_id, erfasser_id, etb_startwert, &inhalt).await?);
    }
    tx.commit().await?;
    Ok(MitEtbEintraegen {
        einsatz: laden(pool, einsatz_id).await?,
        etb_eintrag_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::repo::{abschliessen, anlegen, NeuerEinsatzDaten};

    async fn test_anlegen(
        pool: &SqlitePool,
        bezeichnung: &str,
        _stichwort: Option<&str>,
        ersteller_id: i64,
    ) -> Result<crate::einsatz::Einsatz, AppError> {
        anlegen(
            pool,
            NeuerEinsatzDaten {
                bezeichnung,
                stichwort: None,
                einsatzart: None,
                begonnen_at: None,
                ort: Default::default(),
                vorlage_id: None,
            },
            ersteller_id,
        )
        .await
    }

    async fn benutzer(pool: &SqlitePool) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn org_nachbereitung(pool: &SqlitePool, tage: i64) {
        sqlx::query(
            "INSERT INTO org_einstellungen (org_id, nachbereitung_tage) VALUES (1, ?) \
             ON CONFLICT(org_id) DO UPDATE SET nachbereitung_tage = excluded.nachbereitung_tage",
        )
        .bind(tage)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn etb_texte(pool: &SqlitePool, einsatz_id: i64) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
               AND inhalt LIKE 'Nachbereitung%' ORDER BY id",
        )
        .bind(einsatz_id)
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn abschluss_setzt_nachbereitung_aus_org_vorgabe() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer(&pool).await;
        org_nachbereitung(&pool, 30).await;
        let e = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

        let ergebnis = abschliessen(&pool, e.id, leit).await.unwrap();
        let erwartet =
            berechne_retention_bis(ergebnis.einsatz.abgeschlossen_at.as_deref().unwrap(), 30)
                .unwrap();
        assert_eq!(
            ergebnis.einsatz.nachbereitung_bis.as_deref(),
            Some(erwartet.as_str())
        );
        let texte = etb_texte(&pool, e.id).await;
        assert_eq!(texte.len(), 1, "{texte:?}");
        assert!(
            texte[0].ends_with("(Vorgabe 30 Tage ab Abschluss)"),
            "{texte:?}"
        );
        assert_eq!(ergebnis.etb_eintrag_ids.len(), 1, "live gemeldet");
    }

    #[tokio::test]
    async fn abschluss_ohne_vorgabe_setzt_nichts() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer(&pool).await;
        let e = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

        let ergebnis = abschliessen(&pool, e.id, leit).await.unwrap();
        assert_eq!(ergebnis.einsatz.nachbereitung_bis, None);
        assert!(etb_texte(&pool, e.id).await.is_empty());
    }

    #[tokio::test]
    async fn abschluss_laesst_gesetzte_nachbereitung_stehen() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer(&pool).await;
        org_nachbereitung(&pool, 30).await;
        let e = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        sqlx::query("UPDATE einsatz SET nachbereitung_bis = '2030-01-01 00:00:00' WHERE id = ?")
            .bind(e.id)
            .execute(&pool)
            .await
            .unwrap();

        let ergebnis = abschliessen(&pool, e.id, leit).await.unwrap();
        assert_eq!(
            ergebnis.einsatz.nachbereitung_bis.as_deref(),
            Some("2030-01-01 00:00:00")
        );
        assert!(etb_texte(&pool, e.id).await.is_empty());
    }

    #[tokio::test]
    async fn setzen_aendert_mit_etb_und_unveraendert_ohne() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer(&pool).await;
        let e = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        abschliessen(&pool, e.id, leit).await.unwrap();

        let r = setzen(&pool, e.id, leit, Some("2030-01-01 00:00:00"))
            .await
            .unwrap();
        assert_eq!(
            r.einsatz.nachbereitung_bis.as_deref(),
            Some("2030-01-01 00:00:00")
        );
        assert_eq!(r.etb_eintrag_ids.len(), 1);

        let r = setzen(&pool, e.id, leit, Some("2030-01-01 00:00:00"))
            .await
            .unwrap();
        assert!(r.etb_eintrag_ids.is_empty(), "unverändert: kein Eintrag");

        let r = setzen(&pool, e.id, leit, None).await.unwrap();
        assert_eq!(r.einsatz.nachbereitung_bis, None);
        let texte = etb_texte(&pool, e.id).await;
        assert_eq!(texte.len(), 2, "{texte:?}");
        assert!(texte[0].starts_with("Nachbereitungsfrist gesetzt auf"));
        assert_eq!(texte[1], "Nachbereitungsfrist aufgehoben");
    }

    #[tokio::test]
    async fn setzen_sperrt_aktiv_vorgemerkt_geschwaerzt_und_abgeraeumt() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer(&pool).await;
        let e = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        let ist_409 =
            |r: Result<MitEtbEintraegen, AppError>| matches!(r, Err(AppError::Conflict(_)));

        assert!(
            matches!(
                setzen(&pool, e.id, leit, None).await,
                Err(AppError::UnprocessableEntity(_))
            ),
            "aktiv: 422"
        );
        abschliessen(&pool, e.id, leit).await.unwrap();

        for (sql, was) in [
            (
                "UPDATE einsatz SET geloescht_at = '2026-01-01 00:00:00' WHERE id = ?",
                "vorgemerkt",
            ),
            (
                "UPDATE einsatz SET geloescht_at = NULL, geschwaerzt_at = '2026-01-01 00:00:00' \
                 WHERE id = ?",
                "geschwärzt",
            ),
            (
                "UPDATE einsatz SET geschwaerzt_at = NULL WHERE id = ?",
                "nur zurückgesetzt",
            ),
        ] {
            sqlx::query(sql).bind(e.id).execute(&pool).await.unwrap();
            let r = setzen(&pool, e.id, leit, Some("2030-01-01 00:00:00")).await;
            if was == "nur zurückgesetzt" {
                assert!(r.is_ok(), "{was}");
            } else {
                assert!(ist_409(r), "{was}");
            }
        }

        sqlx::query("INSERT INTO einsatz_abraeumen (einsatz_id, art, gegenstelle) VALUES (?, 'verwahrt', 'Hub')")
            .bind(e.id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(ist_409(setzen(&pool, e.id, leit, None).await), "übergeben");
    }
}
