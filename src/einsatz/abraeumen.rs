//! Abräumen eines Einsatzes nach Verwahrung oder Lebensende (LLH-1494, Change
//! `tkky2noy-archiv-nachbereitung`, design.md D6, D7).
//!
//! Abgeräumt wird ein Einsatz, den diese Instanz nicht mehr halten soll:
//! - **verwahrt**: ein eigener Einsatz, den die verwahrende Gegenstelle angenommen hat (D4);
//! - **spiegel**: ein Spiegel, dessen Führer den Einsatz nicht mehr hat, oder an der meldenden
//!   Seite nach der Nachbereitung (D5).
//!
//! Wer das Abräumen beschließt, setzt in seiner Transaktion den Merker [`vormerken`]
//! (`einsatz_abraeumen`); [`ausfuehren`] löscht nach dem Commit. Ein Absturz dazwischen lässt den
//! Merker stehen, und Phase R des Purge-Laufs holt nach ([`vorgemerkte`]).
//!
//! Gelöscht wird wie bei der endgültigen Löschung (`skelett_loeschung`): Datei-Inhalte einzeln
//! (LFH-905), dann eine Transaktion mit Protokollzeile und `DELETE FROM einsatz`, dessen Kaskade
//! den Rest nimmt, zuletzt der Rückschrieb des WAL. Gelöscht wird über
//! `instanz::spiegel::loeschen_unter_merker`, damit die Schutz-Trigger eines Spiegels das Löschen
//! nicht abbrechen (der Merker gehört nach ADR-0018 dem Spiegel-Modul).

use crate::error::AppError;
use crate::wire_enum::wire_enum;
use sqlx::{SqliteConnection, SqlitePool};

wire_enum! {
    #[wire(ohne_serde)]
    /// Warum ein Einsatz abgeräumt wird; zugleich die Art seiner Zeile im Löschprotokoll.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum AbraeumArt {
        Verwahrt => "verwahrt",
        Spiegel => "spiegel",
    }
}

/// Merkt den Einsatz zum Abräumen vor, in der Transaktion des Aufrufers. Ein schon gesetzter
/// Merker bleibt, wie er ist.
pub async fn vormerken(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    art: AbraeumArt,
    gegenstelle: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO einsatz_abraeumen (einsatz_id, art, gegenstelle) VALUES (?, ?, ?) \
         ON CONFLICT(einsatz_id) DO NOTHING",
    )
    .bind(einsatz_id)
    .bind(art.as_str())
    .bind(gegenstelle)
    .execute(conn)
    .await?;
    Ok(())
}

/// Alle vorgemerkten Einsätze (Phase R holt sie nach).
pub async fn vorgemerkte(pool: &SqlitePool) -> Result<Vec<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT einsatz_id FROM einsatz_abraeumen ORDER BY einsatz_id")
            .fetch_all(pool)
            .await?,
    )
}

/// Von welchen Spiegeln ein Einsatz `e` fällig ist, mit `sp`/`k` für die Gegenstelle; `?1` ist
/// der Status „abgeschlossen“, `?2` der Zeitpunkt. Auswahl und Vormerken prüfen dieselbe
/// Bedingung, das Vormerken erneut in seiner Schreibtransaktion.
const FAELLIGER_SPIEGEL: &str = "FROM einsatz e \
       JOIN einsatz_spiegel sp ON sp.einsatz_id = e.id \
       JOIN instanz_kopplung_org ko ON ko.id = sp.kopplung_org_id \
       JOIN instanz_kopplung k ON k.id = ko.kopplung_id \
     WHERE k.richtung = 'meldet_sich' AND e.status = ?1 \
       AND sp.beendet_at IS NULL AND ko.widerrufen_at IS NULL \
       AND e.nachbereitung_bis GLOB \
           '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]' \
       AND ?2 >= e.nachbereitung_bis \
       AND NOT EXISTS (SELECT 1 FROM spiegel_antrag a WHERE a.einsatz_id = e.id \
                       AND a.zustand IN ('ausstehend', 'zugestellt')) \
       AND NOT EXISTS (SELECT 1 FROM einsatz_abraeumen m WHERE m.einsatz_id = e.id)";

/// Spiegel an der meldenden Seite, deren Nachbereitung zu `jetzt` abgelaufen ist (D5), mit dem
/// Namen der Gegenstelle. Ausgenommen sind Spiegel mit einem Antrag, der noch aussteht oder
/// zugestellt ist: die Antwort des Führers soll ankommen, und ein beendeter Spiegel (Widerruf):
/// er bleibt ohne Kopplung lesbar, kein Führer meldet mehr sein Ende. Ein Spiegel am Hub
/// (erreichte Seite) ist nie dabei; er endet über Verwahrung oder Lebensende.
pub async fn faellige_spiegel(
    pool: &SqlitePool,
    jetzt: &str,
) -> Result<Vec<(i64, String)>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT e.id, k.gegenueber_name {FAELLIGER_SPIEGEL} ORDER BY e.id"
    )))
    .bind(super::STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .fetch_all(pool)
    .await?)
}

/// Merkt einen fälligen Spiegel vor, nur wenn er in dieser Transaktion noch fällig ist: ein
/// Widerruf, ein Ende oder ein neuer Antrag zwischen Auswahl und Vormerken lässt ihn stehen.
/// Liefert, ob vorgemerkt wurde.
async fn spiegel_vormerken(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let r = sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO einsatz_abraeumen (einsatz_id, art, gegenstelle) \
         SELECT e.id, ?3, k.gegenueber_name {FAELLIGER_SPIEGEL} AND e.id = ?4"
    )))
    .bind(super::STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .bind(AbraeumArt::Spiegel.as_str())
    .bind(einsatz_id)
    .execute(conn)
    .await?;
    Ok(r.rows_affected() > 0)
}

/// Phase R des Purge-Laufs: merkt fällige Spiegel der meldenden Seite vor (D5) und räumt jeden
/// vorgemerkten Einsatz ab, auch einen, dessen Abräumen nach der Quittung scheiterte. Liefert
/// die Zahl abgeräumter Einsätze.
pub async fn phase_r(pool: &SqlitePool, jetzt: &str) -> usize {
    match faellige_spiegel(pool, jetzt).await {
        Ok(faellig) => {
            for (id, _) in faellig {
                let ergebnis =
                    crate::write_retry!(pool, |conn| { spiegel_vormerken(conn, id, jetzt).await });
                match ergebnis {
                    Ok(true) => tracing::warn!(
                        einsatz_id = id,
                        "Purge Phase R: Spiegel nach der Nachbereitung zum Abräumen vorgemerkt"
                    ),
                    Ok(false) => {}
                    Err(e) => {
                        tracing::error!(
                            einsatz_id = id,
                            "Purge Phase R: Vormerken gescheitert: {e}"
                        )
                    }
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase R: Abfrage fehlgeschlagen: {e}"),
    }
    alle_vorgemerkten(pool).await
}

/// Löscht die Datei-Inhalte eines vorgemerkten Einsatzes einzeln, je Zeile eine Transaktion
/// (wie `schwaerzung_nachlauf::entferne_vorgesehene`): die Schreibsperre hält höchstens für
/// einen Inhalt.
async fn dateien_einzeln(pool: &SqlitePool, einsatz_id: i64) -> Result<(), AppError> {
    for tabelle in super::schwaerzung_nachlauf::EINZELN_GELOESCHT {
        let ids: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT id FROM {tabelle} WHERE einsatz_id = ? ORDER BY id"
        )))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;
        let sql = format!(
            "DELETE FROM {tabelle} WHERE id = ? AND EXISTS \
             (SELECT 1 FROM einsatz_abraeumen a WHERE a.einsatz_id = {tabelle}.einsatz_id)"
        );
        for id in ids {
            crate::write_retry!(pool, |conn| {
                crate::instanz::spiegel::loeschen_unter_merker(conn, &sql, id).await?;
                Ok(())
            })?;
        }
    }
    Ok(())
}

/// Räumt einen vorgemerkten Einsatz ab (UNUMKEHRBAR): Datei-Inhalte, dann Protokollzeile und
/// Einsatz in einer Transaktion, dann der WAL. `Ok(false)`, wenn kein Merker (mehr) steht.
///
/// Die Protokollzeile (D7) übernimmt nur Retain-Spalten des Kopfes. `verwahrt` trägt die Nummer
/// (sie bleibt gesperrt) und, soweit auffindbar, den Akteur aus der Kette des Purge-Audits;
/// `spiegel` trägt keine Nummer, die gehört dem Führer. Beide sperren die ID.
pub async fn ausfuehren(pool: &SqlitePool, einsatz_id: i64) -> Result<bool, AppError> {
    let gesetzt: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM einsatz_abraeumen WHERE einsatz_id = ?)")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?;
    if !gesetzt {
        return Ok(false);
    }
    dateien_einzeln(pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let geloescht = crate::write_retry!(pool, |conn| {
        let merker: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT art, gegenstelle FROM einsatz_abraeumen WHERE einsatz_id = ?")
                .bind(einsatz_id)
                .fetch_optional(&mut *conn)
                .await?;
        let Some((art, gegenstelle)) = merker else {
            return Ok(false);
        };
        let verwahrt = art == AbraeumArt::Verwahrt.as_str();
        let akteur = if verwahrt {
            super::repo::ermittle_system_akteur(&mut *conn, einsatz_id).await?
        } else {
            None
        };
        sqlx::query(
            "INSERT INTO aufbewahrung_loeschprotokoll (org_id, einsatz_id, art, gegenstelle, \
                einsatznummer_intern, nummer_jahr, nummer_lfd, abgeschlossen_at, geschwaerzt_at, \
                geloescht_at, akteur_id) \
             SELECT org_id, id, ?2, ?3, \
                CASE WHEN ?4 THEN einsatznummer_intern END, CASE WHEN ?4 THEN nummer_jahr END, \
                CASE WHEN ?4 THEN nummer_lfd END, abgeschlossen_at, geschwaerzt_at, ?5, ?6 \
             FROM einsatz WHERE id = ?1",
        )
        .bind(einsatz_id)
        .bind(&art)
        .bind(&gegenstelle)
        .bind(verwahrt)
        .bind(&jetzt)
        .bind(akteur)
        .execute(&mut *conn)
        .await?;
        crate::db::fk_pruefung_sicherstellen(&mut *conn, "Abräumen").await?;
        let n = crate::instanz::spiegel::loeschen_unter_merker(
            conn,
            "DELETE FROM einsatz WHERE id = ?",
            einsatz_id,
        )
        .await?;
        if n != 1 {
            return Err(AppError::Internal(format!(
                "Abräumen von Einsatz {einsatz_id}: {n} Zeilen statt 1"
            )));
        }
        Ok(true)
    })?;
    if geloescht {
        match crate::db::wal_zurueckschreiben(pool).await {
            Ok(true) => {}
            Ok(false) => tracing::info!(
                einsatz_id,
                "Abräumen: WAL-Rückschrieb aufgehalten, der Purge-Lauf holt nach"
            ),
            Err(e) => tracing::warn!(einsatz_id, "Abräumen: WAL-Rückschrieb gescheitert: {e}"),
        }
    }
    Ok(geloescht)
}

/// [`ausfuehren`] für jeden vorgemerkten Einsatz, Fehler nur geloggt (der nächste Lauf holt nach).
/// Liefert die Zahl abgeräumter Einsätze.
pub async fn alle_vorgemerkten(pool: &SqlitePool) -> usize {
    let ids = match vorgemerkte(pool).await {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!("Abräumen: Merker nicht lesbar: {e}");
            return 0;
        }
    };
    let mut n = 0;
    for id in ids {
        match ausfuehren(pool, id).await {
            Ok(true) => n += 1,
            Ok(false) => {}
            Err(e) => tracing::warn!(einsatz_id = id, "Abräumen gescheitert: {e}"),
        }
    }
    n
}

#[cfg(test)]
mod tests;
