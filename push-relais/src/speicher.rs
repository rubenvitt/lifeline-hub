use anyhow::Result;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::str::FromStr;
use subtle::ConstantTimeEq;

pub struct Zugang {
    pub server_id: String,
    pub geheimnis: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pruefung {
    Gueltig,
    Unbekannt,
    Gesperrt,
}

/// Öffnet (und legt bei Bedarf an) die Datenbank und führt die Migrationen aus.
pub async fn oeffnen(pfad: &str) -> Result<SqlitePool> {
    let optionen = if pfad == ":memory:" {
        SqliteConnectOptions::from_str("sqlite::memory:")?
    } else {
        SqliteConnectOptions::new()
            .filename(pfad)
            .create_if_missing(true)
    };
    // In-Memory-DB gehört genau einer Verbindung.
    let max = if pfad == ":memory:" { 1 } else { 5 };
    let pool = SqlitePoolOptions::new()
        .max_connections(max)
        .connect_with(optionen)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

fn zufall_base64url() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_hex(geheimnis: &str) -> String {
    let digest = Sha256::digest(geheimnis.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub async fn registrieren(
    pool: &SqlitePool,
    kontakt: Option<&str>,
    version: &str,
) -> Result<Zugang> {
    let server_id = zufall_base64url();
    let geheimnis = zufall_base64url();
    // Zeit als RFC 3339 in UTC, von SQLite gesetzt.
    sqlx::query(
        "INSERT INTO server (id, geheimnis_hash, kontakt, version, erstellt_at) \
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
    )
    .bind(&server_id)
    .bind(hash_hex(&geheimnis))
    .bind(kontakt)
    .bind(version)
    .execute(pool)
    .await?;
    Ok(Zugang {
        server_id,
        geheimnis,
    })
}

pub async fn pruefen(pool: &SqlitePool, server_id: &str, geheimnis: &str) -> Result<Pruefung> {
    let zeile: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT geheimnis_hash, gesperrt_at FROM server WHERE id = ?")
            .bind(server_id)
            .fetch_optional(pool)
            .await?;
    let Some((gespeichert, gesperrt)) = zeile else {
        return Ok(Pruefung::Unbekannt);
    };
    let gleich: bool = gespeichert
        .as_bytes()
        .ct_eq(hash_hex(geheimnis).as_bytes())
        .into();
    if !gleich {
        return Ok(Pruefung::Unbekannt);
    }
    Ok(if gesperrt.is_some() {
        Pruefung::Gesperrt
    } else {
        Pruefung::Gueltig
    })
}

/// `true`, wenn der Server existiert.
pub async fn sperren(pool: &SqlitePool, server_id: &str) -> Result<bool> {
    Ok(sqlx::query(
        "UPDATE server SET gesperrt_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
    )
    .bind(server_id)
    .execute(pool)
    .await?
    .rows_affected()
        > 0)
}

/// `true`, wenn der Server existiert.
pub async fn entsperren(pool: &SqlitePool, server_id: &str) -> Result<bool> {
    Ok(
        sqlx::query("UPDATE server SET gesperrt_at = NULL WHERE id = ?")
            .bind(server_id)
            .execute(pool)
            .await?
            .rows_affected()
            > 0,
    )
}
