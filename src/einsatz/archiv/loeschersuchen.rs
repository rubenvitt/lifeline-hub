//! Löschersuchen für eine Person im Archiv vollziehen (LLH-1712, Change
//! `xlrgl4du-loeschersuchen-person-im-archiv`, design.md D1, D2, D4, D5).
//!
//! Der Server hat nur die öffentlichen Archiv-Schlüssel der Org. Einen Personen-Antrag an einem
//! archivierten Einsatz lässt der Purge-Lauf deshalb offen (`aufbewahrung::antrag::faellige`);
//! der Befehl `lifeline-hub archiv loeschersuchen --identitaet …` vollzieht ihn mit einem
//! privaten Schlüssel:
//!
//! 1. **Bauen** ohne Schreibsperre: jeden Block entschlüsseln, migrieren, die Personen der
//!    fälligen Anträge schwärzen (`scrubbe_person`, wie am Einsatz), `VACUUM`, an die geprüften
//!    Schlüssel der Org neu verschlüsseln.
//! 2. **Ablegen** in einer Transaktion: Stehen die Anträge noch offen und die Blöcke unverändert,
//!    ersetzt der Lauf Inhalt, `sha256`, Größe und Fingerabdrücke jedes Blocks (Nummer und Frist
//!    bleiben), merkt eingespielte Kopien der alten Blöcke zum Abräumen vor und schreibt
//!    Anträge, ETB-Einträge und Admin-Spur. Sonst ändert er nichts; der nächste Aufruf baut neu.
//!
//! Der neue `sha256` sperrt ältere Downloads an dieser Installation (`einspielen::hier_geloescht`).

use super::bauen;
use crate::auth::admin_audit::{self, AdminAktion, Ziel};
use crate::backup::verschluesselung::Schluessel;
use crate::einsatz::schwaerzung_person::{scrubbe_person, PersonenArt};
use crate::error::AppError;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

/// Wer vollzieht, in der Admin-Spur.
const BEFEHL: &str = "Befehl archiv loeschersuchen";

/// Ein fälliger Personen-Antrag.
#[derive(Debug, Clone, Copy)]
struct Antrag {
    id: i64,
    art: PersonenArt,
    person_id: i64,
}

/// Was ein Lauf an einem Einsatz vollzogen hat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Vollzogen {
    pub einsatz_id: i64,
    /// Einsatznummer bzw. `#<id>`.
    pub einsatz_kennung: String,
    /// Kennungen der Personen (`R-042`, `EK-17`, `IT-5`).
    pub personen: Vec<String>,
    /// Zahl der neu gebauten Blöcke.
    pub bloecke: usize,
}

/// Einsätze mit fälligen Personen-Anträgen und Archiv, aufsteigend.
pub async fn faellige_einsaetze(
    pool: &SqlitePool,
    jetzt: DateTime<Utc>,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT s.einsatz_id FROM schwaerzung_antrag s \
         WHERE s.ziel_art NOT IN ('einsatz', 'medienkontakt') \
           AND s.zurueckgenommen_at IS NULL AND s.vollzogen_at IS NULL AND s.faellig_at <= ? \
           AND EXISTS (SELECT 1 FROM einsatz_archiv a WHERE a.einsatz_id = s.einsatz_id) \
         ORDER BY s.einsatz_id",
    )
    .bind(crate::zeit::formatiere_utc(jetzt))
    .fetch_all(pool)
    .await?)
}

async fn faellige_antraege(
    conn: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    jetzt_s: &str,
) -> Result<Vec<Antrag>, AppError> {
    let zeilen: Vec<(i64, String, Option<i64>)> = sqlx::query_as(
        "SELECT id, ziel_art, ziel_id FROM schwaerzung_antrag \
         WHERE einsatz_id = ? AND ziel_art NOT IN ('einsatz', 'medienkontakt') \
           AND zurueckgenommen_at IS NULL AND vollzogen_at IS NULL AND faellig_at <= ? \
         ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(jetzt_s)
    .fetch_all(conn)
    .await?;
    zeilen
        .into_iter()
        .map(|(id, art, ziel_id)| {
            let art = PersonenArt::parse(&art)
                .ok_or_else(|| AppError::Internal(format!("Antrag {id}: Zielart {art}")))?;
            let person_id =
                ziel_id.ok_or_else(|| AppError::Internal(format!("Antrag {id} ohne ziel_id")))?;
            Ok(Antrag { id, art, person_id })
        })
        .collect()
}

/// Ein neu gebauter Block.
struct NeuerBlock {
    zeile: i64,
    alt_sha256: String,
    datei: bauen::Zwischendatei,
    groesse: i64,
    sha256: String,
}

/// Die neu gebauten Blöcke eines Einsatzes, bereit zur Ablage.
pub(super) struct Bau {
    einsatz_id: i64,
    org_id: i64,
    einsatz_kennung: String,
    antraege: Vec<Antrag>,
    bloecke: Vec<NeuerBlock>,
    fingerabdruecke: String,
    jetzt_s: String,
}

/// Vollzieht die fälligen Personen-Anträge eines archivierten Einsatzes. `Ok(None)`, wenn es
/// nichts zu tun gibt oder sich Antrag oder Archiv während des Baus geändert haben (dann baut
/// der nächste Aufruf neu). Ein Schlüssel, der einen Block nicht öffnet, und eine Org ohne
/// geprüften Archiv-Schlüssel sind Fehler; beides ändert nichts.
pub async fn vollziehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    schluessel: &Schluessel,
    jetzt: DateTime<Utc>,
) -> Result<Option<Vollzogen>, AppError> {
    match neu_bauen(pool, einsatz_id, schluessel, jetzt).await? {
        Some(bau) => ablegen(pool, bau).await,
        None => Ok(None),
    }
}

/// Schritt 1, ohne Schreibsperre: alle Blöcke neu bauen.
pub(super) async fn neu_bauen(
    pool: &SqlitePool,
    einsatz_id: i64,
    schluessel: &Schluessel,
    jetzt: DateTime<Utc>,
) -> Result<Option<Bau>, AppError> {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let antraege = faellige_antraege(pool, einsatz_id, &jetzt_s).await?;
    if antraege.is_empty() {
        return Ok(None);
    }
    let alte: Vec<(i64, i64, String, Vec<u8>)> = sqlx::query_as(
        "SELECT id, block, sha256, inhalt FROM einsatz_archiv WHERE einsatz_id = ? ORDER BY block",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    if alte.is_empty() {
        return Ok(None);
    }
    let (org_id, nummer): (i64, Option<String>) =
        sqlx::query_as("SELECT org_id, einsatznummer_intern FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?;
    let empfaenger = crate::org::archiv_empfaenger::gepruefte(pool, org_id).await?;
    if empfaenger.is_empty() {
        return Err(AppError::Validation(
            "Die Organisation hat keinen geprüften Archiv-Schlüssel; die Blöcke lassen sich \
             nicht neu verschlüsseln."
                .into(),
        ));
    }
    let schluessel_neu: Vec<age::x25519::Recipient> =
        empfaenger.iter().map(|(r, _)| r.clone()).collect();
    let fingerabdruecke = serde_json::to_string(
        &empfaenger
            .iter()
            .map(|(_, f)| f.as_str())
            .collect::<Vec<_>>(),
    )
    .map_err(|e| AppError::Internal(format!("Archiv: {e}")))?;

    let verzeichnis = bauen::verzeichnis(pool).await?;
    let mut bloecke = Vec::with_capacity(alte.len());
    for (zeile, block, alt_sha256, inhalt) in alte {
        let teil = format!("{}{block}", bauen::TEIL_LOESCHERSUCHEN);
        let klar = bauen::entschluesseln(&inhalt, schluessel, &verzeichnis, einsatz_id, &teil)
            .map_err(|e| match e {
                AppError::Validation(m) => AppError::Validation(format!("Block {block}: {m}")),
                andere => andere,
            })?;
        drop(inhalt);
        let archiv = bauen::oeffnen(klar.pfad(), false).await?;
        let geschwaerzt = schwaerzen(&archiv, einsatz_id, &antraege).await;
        archiv.close().await;
        geschwaerzt.map_err(|e| match e {
            AppError::Validation(m) => AppError::Validation(format!("Block {block}: {m}")),
            andere => AppError::Internal(format!("Archiv: Block {block}: {andere}")),
        })?;
        let (datei, groesse, sha256) = bauen::verschluesseln(
            klar,
            &verzeichnis,
            einsatz_id,
            &format!("{teil}-age"),
            &schluessel_neu,
        )
        .await?;
        bloecke.push(NeuerBlock {
            zeile,
            alt_sha256,
            datei,
            groesse,
            sha256,
        });
    }
    Ok(Some(Bau {
        einsatz_id,
        org_id,
        einsatz_kennung: crate::aufbewahrung::antrag::einsatz_kennung(
            nummer.as_deref(),
            einsatz_id,
        ),
        antraege,
        bloecke,
        fingerabdruecke,
        jetzt_s,
    }))
}

/// Schritt 2, in einer Transaktion: prüfen, dass Anträge und Archiv noch dem Stand des Baus
/// entsprechen, dann ersetzen und die Spur schreiben. `Ok(None)`, wenn nicht.
pub(super) async fn ablegen(pool: &SqlitePool, bau: Bau) -> Result<Option<Vollzogen>, AppError> {
    let Bau {
        einsatz_id,
        org_id,
        einsatz_kennung,
        antraege,
        bloecke,
        fingerabdruecke,
        jetzt_s,
    } = bau;
    let inhalte = bloecke
        .iter()
        .map(|b| {
            std::fs::read(b.datei.pfad())
                .map_err(|e| AppError::Internal(format!("Archiv: neuer Block lesen: {e}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let anzahl = bloecke.len();
    let personen = crate::write_retry!(pool, |conn| {
        // Erst prüfen, dann schreiben: unter BEGIN IMMEDIATE schreibt niemand dazwischen.
        let jetzt_offen = faellige_antraege(&mut *conn, einsatz_id, &jetzt_s).await?;
        let gleich = jetzt_offen.len() == antraege.len()
            && jetzt_offen.iter().zip(&antraege).all(|(a, b)| a.id == b.id);
        if !gleich {
            return Ok(None);
        }
        let zeilen: Vec<(i64, String)> = sqlx::query_as(
            "SELECT id, sha256 FROM einsatz_archiv WHERE einsatz_id = ? ORDER BY block",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        let unveraendert = zeilen.len() == bloecke.len()
            && zeilen
                .iter()
                .zip(&bloecke)
                .all(|((id, sha), b)| *id == b.zeile && *sha == b.alt_sha256);
        if !unveraendert {
            return Ok(None);
        }
        let alte_sha: Vec<String> = bloecke.iter().map(|b| b.alt_sha256.clone()).collect();
        super::kopien_vormerken_tx(&mut *conn, &alte_sha).await?;
        for (b, inhalt) in bloecke.iter().zip(&inhalte) {
            sqlx::query(
                "UPDATE einsatz_archiv SET sha256 = ?, groesse = ?, inhalt = ?, \
                    empfaenger_fingerabdruecke = ? WHERE id = ?",
            )
            .bind(&b.sha256)
            .bind(b.groesse)
            .bind(inhalt.as_slice())
            .bind(&fingerabdruecke)
            .bind(b.zeile)
            .execute(&mut *conn)
            .await?;
        }
        let mut personen = Vec::with_capacity(antraege.len());
        for a in &antraege {
            personen.push(
                crate::aufbewahrung::antrag::im_archiv_vollzogen_tx(
                    &mut *conn,
                    a.id,
                    etb_startwert,
                    &jetzt_s,
                    anzahl,
                )
                .await?,
            );
        }
        admin_audit::schreibe_ohne_akteur_tx(
            &mut *conn,
            AdminAktion::ArchivPersonGeschwaerzt,
            org_id,
            BEFEHL,
            Ziel::Archiv(&einsatz_kennung),
        )
        .await?;
        Ok(Some(personen))
    })?;
    drop(bloecke);
    let Some(personen) = personen else {
        return Ok(None);
    };
    // Die alten Blöcke auch aus dem Write-Ahead-Log (LFH-725, wie nach einer Schwärzung).
    if let Err(e) = crate::db::wal_zurueckschreiben(pool).await {
        tracing::warn!(
            einsatz_id,
            "Archiv: WAL nach dem Löschersuchen nicht zurückgeschrieben: {e}"
        );
    }
    tracing::warn!(
        einsatz_id,
        bloecke = anzahl,
        antraege = personen.len(),
        "Archiv: Löschersuchen für Personen in allen Blöcken vollzogen"
    );
    Ok(Some(Vollzogen {
        einsatz_id,
        einsatz_kennung,
        personen,
        bloecke: anzahl,
    }))
}

/// Schwärzt die Personen der Anträge in einer entschlüsselten Archivdatei: migrieren, Scrub wie
/// am Einsatz (mit Fremdschlüsseln, damit Verknüpfungen zu gelöschten Dateien mitgehen),
/// `VACUUM`.
async fn schwaerzen(
    archiv: &SqlitePool,
    einsatz_id: i64,
    antraege: &[Antrag],
) -> Result<(), AppError> {
    super::einspielen::migrieren(archiv).await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(archiv)
        .await?;
    let mut tx = archiv.begin().await?;
    for a in antraege {
        scrubbe_person(&mut *tx, einsatz_id, a.art, a.person_id).await?;
    }
    sqlx::query("DELETE FROM einsatz_aenderung")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    sqlx::query("VACUUM").execute(archiv).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
