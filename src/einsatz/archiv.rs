//! Archiv am Ende der Nachbereitung (LLH-1494, K1, K3, K6, design.md D9).
//!
//! Die verwahrende Instanz legt einen abgeschlossenen Einsatz am Ende seiner Nachbereitung als
//! age-verschlüsselte Blöcke ab und schwärzt danach ihren Klartext, ohne Karenz. Verwahrend ist
//! eine Instanz, deren Org sich bei keiner anderen meldet: der Hub, oder ein ELW ohne Kopplung. Ein
//! ELW, der sich meldet, übergibt den Einsatz stattdessen dem Hub (Teil 1, `instanz::spiegel`).
//!
//! Voraussetzungen: Die Org hat geprüfte Archiv-Empfänger (`org::archiv_empfaenger`), und die
//! Aufbewahrung endet nach der Nachbereitung oder ist unbegrenzt. Sonst gilt die Aufbewahrung wie
//! bisher.
//!
//! Blöcke (K3): je Fristende einer Kategorie ein Block, in dem die früher endenden Kategorien
//! schon geschwärzt sind ([`bauen::plane_bloecke`]). Ein Block geht mit seiner Frist
//! ([`abgelaufene_bloecke_loeschen`]); das Skelett wartet in Phase D auf den letzten.

pub mod bauen;

use crate::einsatz::aufbewahrung_kategorie as kategorie;
use crate::einsatz::STATUS_ABGESCHLOSSEN;
use crate::error::AppError;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Kandidaten zum Archivieren (Bind 1: Status, 2: jetzt). Wie die Übergabe an der meldenden Seite
/// (`spiegel::lebensende::faellige_verwahrungen`): kein Spiegel, nicht vorgemerkt, nicht
/// geschwärzt, kein offenes Löschersuchen, kein Demo-Einsatz, nicht beim Abräumen.
const FAELLIG: &str = "FROM einsatz e \
     WHERE e.spiegel = 0 AND e.status = ?1 \
       AND e.geloescht_at IS NULL AND e.geschwaerzt_at IS NULL \
       AND e.nachbereitung_bis GLOB \
           '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]' \
       AND ?2 >= e.nachbereitung_bis \
       AND (e.retention_bis IS NULL OR e.retention_bis > ?2) \
       AND EXISTS (SELECT 1 FROM org_archiv_empfaenger r \
                   WHERE r.org_id = e.org_id AND r.geprueft_at IS NOT NULL) \
       AND NOT EXISTS (SELECT 1 FROM instanz_kopplung_org ko \
                       JOIN instanz_kopplung k ON k.id = ko.kopplung_id \
                       WHERE ko.org_id = e.org_id AND k.richtung = 'meldet_sich' \
                         AND ko.widerrufen_at IS NULL) \
       AND NOT EXISTS (SELECT 1 FROM demo_import d WHERE d.einsatz_id = e.id) \
       AND NOT EXISTS (SELECT 1 FROM einsatz_abraeumen m WHERE m.einsatz_id = e.id) \
       AND NOT EXISTS (SELECT 1 FROM einsatz_archiv a WHERE a.einsatz_id = e.id) \
       AND NOT EXISTS (SELECT 1 FROM schwaerzung_antrag s WHERE s.einsatz_id = e.id \
                       AND s.zurueckgenommen_at IS NULL AND s.vollzogen_at IS NULL)";

/// Einsätze, die zu `jetzt` zu archivieren sind.
pub async fn faellige(pool: &SqlitePool, jetzt: &str) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT e.id {FAELLIG} ORDER BY e.id"
    )))
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .fetch_all(pool)
    .await?)
}

async fn ist_faellig(
    conn: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT EXISTS (SELECT 1 {FAELLIG} AND e.id = ?3)"
    )))
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .bind(einsatz_id)
    .fetch_one(conn)
    .await?)
}

async fn stand(
    conn: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
) -> Result<Option<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT MAX(stand) FROM einsatz_aenderung WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(conn)
            .await?,
    )
}

/// Archiviert einen fälligen Einsatz und schwärzt ihn (IRREVERSIBEL für den Klartext). Die Blöcke
/// entstehen außerhalb der Schreibsperre; Ablage und Schwärzung folgen in einer Transaktion, die
/// prüft, dass sich der Einsatz inzwischen nicht geändert hat. `false` = nichts zu tun oder
/// inzwischen geändert (der nächste Lauf baut neu).
pub async fn archivieren(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<bool, AppError> {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    if !ist_faellig(pool, einsatz_id, &jetzt_s).await? {
        return Ok(false);
    }
    let (org_id, retention_bis): (i64, Option<String>) =
        sqlx::query_as("SELECT org_id, retention_bis FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?;
    let empfaenger = crate::org::archiv_empfaenger::gepruefte(pool, org_id).await?;
    if empfaenger.is_empty() {
        return Ok(false);
    }
    let stand_vorher = stand(pool, einsatz_id).await?;
    let offene: Vec<bauen::OffeneKategorie> = kategorie::laden(pool, einsatz_id)
        .await?
        .into_iter()
        .filter(|k| k.geschwaerzt_at.is_none())
        .filter_map(|k| {
            k.frist_bis.map(|frist_bis| bauen::OffeneKategorie {
                kategorie: k.kategorie,
                frist_bis,
            })
        })
        .collect();
    let plaene = bauen::plane_bloecke(&offene, retention_bis.as_deref(), &jetzt_s);

    let schluessel: Vec<age::x25519::Recipient> =
        empfaenger.iter().map(|(r, _)| r.clone()).collect();
    let fingerabdruecke = serde_json::to_string(
        &empfaenger
            .iter()
            .map(|(_, f)| f.as_str())
            .collect::<Vec<_>>(),
    )
    .map_err(|e| AppError::Internal(format!("Archiv: {e}")))?;
    let voll = bauen::vollkopie(pool, einsatz_id).await?;
    let mut bloecke = Vec::with_capacity(plaene.len());
    for plan in plaene {
        bloecke.push(bauen::baue_block(&voll, einsatz_id, plan, &schluessel, jetzt).await?);
    }
    drop(voll);

    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let grund = format!(
        "Nachbereitung abgelaufen; archiviert in {} {} an {} {}",
        bloecke.len(),
        if bloecke.len() == 1 {
            "Block"
        } else {
            "Blöcken"
        },
        empfaenger.len(),
        if empfaenger.len() == 1 {
            "Archiv-Schlüssel"
        } else {
            "Archiv-Schlüssel der Organisation"
        }
    );
    let archiviert = crate::write_retry!(pool, |conn| {
        if stand(&mut *conn, einsatz_id).await? != stand_vorher
            || !ist_faellig(&mut *conn, einsatz_id, &jetzt_s).await?
        {
            return Ok(false);
        }
        if !super::repo::schwaerze_nach_archiv_tx(
            &mut *conn,
            einsatz_id,
            etb_startwert,
            &jetzt_s,
            &grund,
        )
        .await?
        {
            return Ok(false);
        }
        for b in &bloecke {
            sqlx::query(
                "INSERT INTO einsatz_archiv (einsatz_id, block, gueltig_bis, \
                    empfaenger_fingerabdruecke, groesse, sha256, inhalt, angelegt_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(einsatz_id)
            .bind(b.plan.block)
            .bind(b.plan.gueltig_bis.as_deref())
            .bind(&fingerabdruecke)
            .bind(b.inhalt.len() as i64)
            .bind(&b.sha256)
            .bind(&b.inhalt)
            .bind(&jetzt_s)
            .execute(&mut *conn)
            .await?;
        }
        Ok(true)
    })?;
    if archiviert {
        tracing::warn!(
            einsatz_id,
            bloecke = bloecke.len(),
            "Purge Phase N: Einsatz archiviert und geschwärzt (Nachbereitung abgelaufen)"
        );
        super::schwaerzung_nachlauf::nachlaufen(pool, einsatz_id).await;
    }
    Ok(archiviert)
}

/// Löscht Blöcke, deren Frist zu `jetzt` abgelaufen ist, je mit einem ETB-Eintrag am Skelett.
/// Liefert die Zahl gelöschter Blöcke.
pub async fn abgelaufene_bloecke_loeschen(
    pool: &SqlitePool,
    jetzt: &str,
) -> Result<usize, AppError> {
    let faellig: Vec<(i64, i64, i64)> = sqlx::query_as(
        "SELECT id, einsatz_id, block FROM einsatz_archiv \
         WHERE gueltig_bis IS NOT NULL AND gueltig_bis <= ? ORDER BY einsatz_id, block",
    )
    .bind(jetzt)
    .fetch_all(pool)
    .await?;
    let mut anzahl = 0;
    for (id, einsatz_id, block) in faellig {
        let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
        let geloescht = crate::write_retry!(pool, |conn| {
            let r = sqlx::query(
                "DELETE FROM einsatz_archiv WHERE id = ? AND gueltig_bis IS NOT NULL \
                 AND gueltig_bis <= ?",
            )
            .bind(id)
            .bind(jetzt)
            .execute(&mut *conn)
            .await?;
            if r.rows_affected() == 0 {
                return Ok(false);
            }
            super::repo::system_audit_tx(
                &mut *conn,
                einsatz_id,
                etb_startwert,
                &format!("Archiv: Block {block} nach Ablauf seiner Frist gelöscht."),
            )
            .await?;
            Ok(true)
        })?;
        if geloescht {
            tracing::warn!(
                einsatz_id,
                block,
                "Purge: Archivblock nach Fristablauf gelöscht"
            );
            anzahl += 1;
        }
    }
    Ok(anzahl)
}

/// Löscht alle Blöcke eines Einsatzes (Löschersuchen für den ganzen Einsatz, K8). Liefert die
/// Zahl gelöschter Blöcke.
pub async fn alle_loeschen_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
) -> Result<u64, AppError> {
    Ok(
        sqlx::query("DELETE FROM einsatz_archiv WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .execute(conn)
            .await?
            .rows_affected(),
    )
}

/// Das Archiv eines Einsatzes in der Archivakte.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ArchivAngabe {
    /// Zeitpunkt der Archivierung (UTC).
    pub archiviert_at: String,
    /// Der Block, den ein Download jetzt liefert.
    pub block: i64,
    /// Bis wann dieser Block gilt; `None` = so lange wie der Einsatz.
    pub gueltig_bis: Option<String>,
    /// Zahl der noch vorhandenen Blöcke.
    pub bloecke: i64,
    /// Größe des Blocks in Bytes.
    pub groesse: i64,
    /// Fingerabdrücke der Schlüssel, die den Block öffnen.
    pub fingerabdruecke: Vec<String>,
}

/// Der gültige Block: der mit der frühesten Frist, die noch nicht abgelaufen ist.
const GUELTIG: &str = "FROM einsatz_archiv WHERE einsatz_id = ?1 \
     AND (gueltig_bis IS NULL OR gueltig_bis > ?2) \
     ORDER BY gueltig_bis IS NULL, gueltig_bis, block LIMIT 1";

/// Angaben zum Archiv eines Einsatzes; `None` ohne gültigen Block.
pub async fn angabe(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<Option<ArchivAngabe>, AppError> {
    let zeile: Option<(String, i64, Option<String>, i64, String)> =
        sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT angelegt_at, block, gueltig_bis, groesse, empfaenger_fingerabdruecke {GUELTIG}"
        )))
        .bind(einsatz_id)
        .bind(jetzt)
        .fetch_optional(pool)
        .await?;
    let Some((archiviert_at, block, gueltig_bis, groesse, fingerabdruecke)) = zeile else {
        return Ok(None);
    };
    let bloecke: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_archiv WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?;
    Ok(Some(ArchivAngabe {
        archiviert_at,
        block,
        gueltig_bis,
        bloecke,
        groesse,
        fingerabdruecke: serde_json::from_str(&fingerabdruecke).unwrap_or_default(),
    }))
}

/// Der gültige Block zum Herunterladen: `(block, inhalt)`.
pub async fn gueltiger_block(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<Option<(i64, Vec<u8>)>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT block, inhalt {GUELTIG}"
    )))
    .bind(einsatz_id)
    .bind(jetzt)
    .fetch_optional(pool)
    .await?)
}

#[cfg(test)]
mod tests;
