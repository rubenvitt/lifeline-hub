//! Speicher von Web Push (LLH-1223, design.md D2/D3, `migrations/0203_web_push.sql`).

use super::krypto::{b64, b64_lesen, KryptoFehler, Schluessel};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Liest das Schlüsselpaar der Instanz oder erzeugt es beim ersten Aufruf. Zwei gleichzeitige
/// Erstaufrufe schreiben nicht zwei Paare: `INSERT OR IGNORE` auf die eine Zeile, danach liest
/// jeder, was gewonnen hat.
pub async fn schluessel_laden_oder_erzeugen(pool: &SqlitePool) -> anyhow::Result<Schluessel> {
    if let Some(s) = schluessel_laden(pool).await? {
        return Ok(s);
    }
    let neu = Schluessel::erzeugen()?;
    sqlx::query(
        "INSERT OR IGNORE INTO web_push_schluessel (id, privat, oeffentlich) VALUES (1, ?, ?)",
    )
    .bind(b64(&neu.pkcs8()?))
    .bind(b64(neu.oeffentlich()))
    .execute(pool)
    .await?;
    schluessel_laden(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Web-Push-Schlüssel nach dem Anlegen nicht lesbar"))
}

async fn schluessel_laden(pool: &SqlitePool) -> anyhow::Result<Option<Schluessel>> {
    let privat: Option<String> =
        sqlx::query_scalar("SELECT privat FROM web_push_schluessel WHERE id = 1")
            .fetch_optional(pool)
            .await?;
    let Some(privat) = privat else {
        return Ok(None);
    };
    let der = b64_lesen(&privat)
        .ok_or_else(|| KryptoFehler("gespeicherter Web-Push-Schlüssel ist kein Base64".into()))?;
    Ok(Some(Schluessel::aus_pkcs8(&der)?))
}

/// Ein Abo, wie der Versand es braucht.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Abo {
    pub id: i64,
    pub benutzer_id: i64,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

/// Meldet das Abo eines Browsers für die Sitzung `token_hash` an. Gibt es den Endpunkt schon
/// (dasselbe Browserprofil nach neuer Anmeldung oder mit einem anderen Nutzer), gehört er danach
/// dieser Sitzung und diesem Nutzer, mit den neuen Schlüsseln.
pub async fn anmelden(
    pool: &SqlitePool,
    benutzer_id: i64,
    token_hash: &str,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO web_push_abo (benutzer_id, session_token_hash, endpoint, p256dh, auth) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(endpoint) DO UPDATE SET benutzer_id = excluded.benutzer_id, \
             session_token_hash = excluded.session_token_hash, p256dh = excluded.p256dh, \
             auth = excluded.auth",
    )
    .bind(benutzer_id)
    .bind(token_hash)
    .bind(endpoint)
    .bind(p256dh)
    .bind(auth)
    .execute(pool)
    .await?;
    Ok(())
}

/// Meldet das Abo der Sitzung ab (idempotent).
pub async fn abmelden(pool: &SqlitePool, token_hash: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM web_push_abo WHERE session_token_hash = ?")
        .bind(token_hash)
        .execute(pool)
        .await?;
    Ok(())
}

/// Hat die Sitzung ein Abo?
pub async fn hat_abo(pool: &SqlitePool, token_hash: &str) -> Result<bool, AppError> {
    let ja: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM web_push_abo WHERE session_token_hash = ?)",
    )
    .bind(token_hash)
    .fetch_one(pool)
    .await?;
    Ok(ja)
}

/// Alle Abos dieser Nutzer, in einer Abfrage.
pub async fn abos_von(pool: &SqlitePool, benutzer_ids: &[i64]) -> Result<Vec<Abo>, AppError> {
    if benutzer_ids.is_empty() {
        return Ok(Vec::new());
    }
    let liste = serde_json::to_string(benutzer_ids).expect("Zahlenliste serialisierbar");
    let abos = sqlx::query_as::<_, Abo>(
        "SELECT id, benutzer_id, endpoint, p256dh, auth FROM web_push_abo \
         WHERE benutzer_id IN (SELECT value FROM json_each(?)) ORDER BY id",
    )
    .bind(liste)
    .fetch_all(pool)
    .await?;
    Ok(abos)
}

/// Löscht ein Abo, das der Push-Dienst als erloschen meldet. Nur, wenn es noch denselben
/// Endpunkt hat: ein zwischenzeitlich umgehängtes Abo bleibt.
pub async fn erloschen(pool: &SqlitePool, id: i64, endpoint: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM web_push_abo WHERE id = ? AND endpoint = ?")
        .bind(id)
        .bind(endpoint)
        .execute(pool)
        .await?;
    Ok(())
}
