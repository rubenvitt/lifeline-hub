//! Archiv-Empfänger der Organisation (LLH-1494, K6, design.md D9).
//!
//! System-Admins hinterlegen öffentliche age-Schlüssel (`age1…`). An sie verschlüsselt die
//! verwahrende Instanz das Archiv eines Einsatzes (`einsatz::archiv`). Der private Schlüssel kommt
//! nie auf den Server: Wer ihn verliert, verliert das Archiv. Deshalb gilt ein Empfänger erst nach
//! der **Schlüsselprobe**. Der Server verschlüsselt einen achtstelligen Code an den Schlüssel, und
//! der Admin entschlüsselt ihn auf seinem Rechner (`age -d -i …`) und gibt ihn ein. Gespeichert
//! wird nur der Hash des Codes.

use crate::error::AppError;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::io::Write;
use utoipa::ToSchema;

/// Höchstzahl Empfänger je Org: jeder macht jedes Archiv etwas größer.
pub const EMPFAENGER_MAX: i64 = 10;

/// Längste Bezeichnung eines Empfängers in Zeichen.
pub const BEZEICHNUNG_MAX: usize = 100;

/// Fehlversuche, nach denen die Probe nicht mehr gilt.
pub const VERSUCHE_MAX: i64 = 5;

/// Ein Archiv-Empfänger, wie die Verwaltung ihn sieht. Der Schlüssel selbst steht nicht darin,
/// nur sein Fingerabdruck.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ArchivEmpfaengerAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    /// Kurzform des Schlüssels zum Vergleichen (`ab12:cd34:…`).
    pub fingerabdruck: String,
    /// Zeitpunkt der bestandenen Schlüsselprobe; ohne gilt der Empfänger noch nicht.
    pub geprueft_at: Option<String>,
    pub angelegt_at: String,
    /// Die Probe ist nach zu vielen Fehlversuchen gesperrt.
    pub gesperrt: bool,
}

/// Ein neu eingetragener Empfänger mit seiner Probe.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct NeuerArchivEmpfaenger {
    pub empfaenger: ArchivEmpfaengerAnzeige,
    /// Der Code, verschlüsselt an den Schlüssel (age, ASCII-Armor). Entschlüsseln mit
    /// `age -d -i <schluesseldatei>`.
    pub probe: String,
}

/// Liest einen öffentlichen age-Schlüssel. Ein privater Schlüssel wird abgewiesen, ohne dass er
/// in einer Meldung erscheint.
pub fn lies_empfaenger(text: &str) -> Result<age::x25519::Recipient, AppError> {
    let text = text.trim();
    if text.to_ascii_uppercase().starts_with("AGE-SECRET-KEY-") {
        return Err(AppError::Validation(
            "Das ist ein privater Schlüssel. Eingetragen wird nur der öffentliche (age1…).".into(),
        ));
    }
    text.parse::<age::x25519::Recipient>()
        .map_err(|_| AppError::Validation("Kein öffentlicher age-Schlüssel (age1…).".into()))
}

/// Fingerabdruck eines Empfängers: die ersten 16 Hex-Zeichen von SHA-256 über den Schlüssel, in
/// Vierergruppen.
pub fn fingerabdruck(empfaenger: &age::x25519::Recipient) -> String {
    let hash = Sha256::digest(empfaenger.to_string().as_bytes());
    let hex: String = hash.iter().take(8).map(|b| format!("{b:02x}")).collect();
    hex.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).expect("hex ist ASCII"))
        .collect::<Vec<_>>()
        .join(":")
}

fn code_hash(code: &str) -> String {
    Sha256::digest(code.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Ein zufälliger achtstelliger Code.
fn neuer_code() -> String {
    let mut bytes = [0u8; 8];
    OsRng.fill_bytes(&mut bytes);
    format!("{:08}", u64::from_le_bytes(bytes) % 100_000_000)
}

/// Verschlüsselt `code` an `empfaenger`, als ASCII-Armor.
fn verschluessele_probe(
    empfaenger: &age::x25519::Recipient,
    code: &str,
) -> Result<String, AppError> {
    let intern = |e: std::io::Error| AppError::Internal(format!("Schlüsselprobe: {e}"));
    let verschluesseler =
        age::Encryptor::with_recipients(std::iter::once(empfaenger as &dyn age::Recipient))
            .map_err(|e| AppError::Internal(format!("Schlüsselprobe: {e}")))?;
    let mut ausgabe = Vec::new();
    let armor =
        age::armor::ArmoredWriter::wrap_output(&mut ausgabe, age::armor::Format::AsciiArmor)
            .map_err(intern)?;
    let mut schreiber = verschluesseler.wrap_output(armor).map_err(intern)?;
    schreiber
        .write_all(format!("{code}\n").as_bytes())
        .map_err(intern)?;
    schreiber
        .finish()
        .and_then(|a| a.finish())
        .map_err(intern)?;
    String::from_utf8(ausgabe).map_err(|e| AppError::Internal(format!("Schlüsselprobe: {e}")))
}

type Roh = (i64, String, String, Option<String>, String, i64);

fn aus_roh(
    (id, bezeichnung, fingerabdruck, geprueft_at, angelegt_at, versuche): Roh,
) -> ArchivEmpfaengerAnzeige {
    ArchivEmpfaengerAnzeige {
        id,
        bezeichnung,
        fingerabdruck,
        gesperrt: geprueft_at.is_none() && versuche >= VERSUCHE_MAX,
        geprueft_at,
        angelegt_at,
    }
}

const SPALTEN: &str = "id, bezeichnung, fingerabdruck, geprueft_at, angelegt_at, probe_versuche";

/// Die Empfänger der Org, nach Anlage.
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<Vec<ArchivEmpfaengerAnzeige>, AppError> {
    let zeilen: Vec<Roh> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM org_archiv_empfaenger WHERE org_id = ? ORDER BY id"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().map(aus_roh).collect())
}

async fn eine(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
) -> Result<ArchivEmpfaengerAnzeige, AppError> {
    let zeile: Option<Roh> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM org_archiv_empfaenger WHERE org_id = ? AND id = ?"
    )))
    .bind(org_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    zeile.map(aus_roh).ok_or(AppError::NotFound)
}

/// Trägt einen Empfänger ein und liefert die Probe. Er gilt noch nicht.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    angelegt_von: i64,
    empfaenger: &str,
    bezeichnung: &str,
) -> Result<NeuerArchivEmpfaenger, AppError> {
    let schluessel = lies_empfaenger(empfaenger)?;
    let bezeichnung = bezeichnung.trim();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung fehlt.".into()));
    }
    if bezeichnung.chars().count() > BEZEICHNUNG_MAX {
        return Err(AppError::Validation(format!(
            "Bezeichnung höchstens {BEZEICHNUNG_MAX} Zeichen."
        )));
    }
    let fingerabdruck = fingerabdruck(&schluessel);
    let code = neuer_code();
    let probe = verschluessele_probe(&schluessel, &code)?;
    let hash = code_hash(&code);
    let id = crate::write_retry!(pool, |conn| {
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM org_archiv_empfaenger WHERE org_id = ?")
                .bind(org_id)
                .fetch_one(&mut *conn)
                .await?;
        if anzahl >= EMPFAENGER_MAX {
            return Err(AppError::Conflict(format!(
                "Höchstens {EMPFAENGER_MAX} Archiv-Schlüssel je Organisation."
            )));
        }
        let doppelt: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM org_archiv_empfaenger \
             WHERE org_id = ? AND fingerabdruck = ?)",
        )
        .bind(org_id)
        .bind(&fingerabdruck)
        .fetch_one(&mut *conn)
        .await?;
        if doppelt {
            return Err(AppError::Conflict(
                "Dieser Schlüssel ist schon eingetragen.".into(),
            ));
        }
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO org_archiv_empfaenger \
                (org_id, empfaenger, bezeichnung, fingerabdruck, probe_hash, angelegt_von) \
             VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(org_id)
        .bind(schluessel.to_string())
        .bind(bezeichnung)
        .bind(&fingerabdruck)
        .bind(&hash)
        .bind(angelegt_von)
        .fetch_one(&mut *conn)
        .await?;
        Ok(id)
    })?;
    Ok(NeuerArchivEmpfaenger {
        empfaenger: eine(pool, org_id, id).await?,
        probe,
    })
}

/// Prüft den eingegebenen Code. Richtig: der Empfänger gilt ab jetzt. Falsch: ein Fehlversuch;
/// nach [`VERSUCHE_MAX`] ist die Probe gesperrt, und der Schlüssel muss neu eingetragen werden.
pub async fn pruefen(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    code: &str,
) -> Result<ArchivEmpfaengerAnzeige, AppError> {
    let code: String = code.chars().filter(char::is_ascii_digit).collect();
    let jetzt = crate::zeit::jetzt();
    let richtig = crate::write_retry!(pool, |conn| {
        let zeile: Option<(Option<String>, Option<String>, i64)> = sqlx::query_as(
            "SELECT geprueft_at, probe_hash, probe_versuche FROM org_archiv_empfaenger \
             WHERE org_id = ? AND id = ?",
        )
        .bind(org_id)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some((geprueft_at, hash, versuche)) = zeile else {
            return Err(AppError::NotFound);
        };
        if geprueft_at.is_some() {
            return Ok(true);
        }
        if versuche >= VERSUCHE_MAX {
            return Err(AppError::Conflict(
                "Zu viele Fehlversuche. Schlüssel entfernen und neu eintragen.".into(),
            ));
        }
        if hash.as_deref() == Some(code_hash(&code).as_str()) {
            sqlx::query(
                "UPDATE org_archiv_empfaenger SET geprueft_at = ?, probe_hash = NULL WHERE id = ?",
            )
            .bind(&jetzt)
            .bind(id)
            .execute(&mut *conn)
            .await?;
            Ok(true)
        } else {
            sqlx::query(
                "UPDATE org_archiv_empfaenger SET probe_versuche = probe_versuche + 1 WHERE id = ?",
            )
            .bind(id)
            .execute(&mut *conn)
            .await?;
            Ok(false)
        }
    })?;
    if !richtig {
        return Err(AppError::Validation("Der Code stimmt nicht.".into()));
    }
    eine(pool, org_id, id).await
}

/// Entfernt einen Empfänger. Archive, die schon an ihn verschlüsselt sind, bleiben es.
pub async fn entfernen(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
) -> Result<ArchivEmpfaengerAnzeige, AppError> {
    let vorher = eine(pool, org_id, id).await?;
    crate::write_retry!(pool, |conn| {
        sqlx::query("DELETE FROM org_archiv_empfaenger WHERE org_id = ? AND id = ?")
            .bind(org_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })?;
    Ok(vorher)
}

/// Die geprüften Empfänger der Org mit Fingerabdruck. Ein Schlüssel, der sich nicht mehr lesen
/// lässt, fällt heraus (er kam nur geprüft hinein).
pub async fn gepruefte(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    org_id: i64,
) -> Result<Vec<(age::x25519::Recipient, String)>, AppError> {
    let zeilen: Vec<(String, String)> = sqlx::query_as(
        "SELECT empfaenger, fingerabdruck FROM org_archiv_empfaenger \
         WHERE org_id = ? AND geprueft_at IS NOT NULL ORDER BY id",
    )
    .bind(org_id)
    .fetch_all(executor)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|(e, f)| e.parse().ok().map(|r| (r, f)))
        .collect())
}

#[cfg(test)]
mod tests;
