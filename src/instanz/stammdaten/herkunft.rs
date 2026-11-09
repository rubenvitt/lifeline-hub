//! Herkunft übernommener Zeilen an der meldenden Seite (design.md D3) und die Quelle einer Org.

use super::StammdatenArt;
use crate::error::AppError;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::BTreeMap;
use utoipa::ToSchema;

/// Lokaler Schlüssel einer Zeile aus dieser Org-Zuordnung, wenn es sie hier schon gibt.
pub async fn find_lokal(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    art: StammdatenArt,
    fremd: &str,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM stammdaten_herkunft \
         WHERE kopplung_org_id = ? AND art = ? AND fremder_schluessel = ?",
    )
    .bind(kopplung_org_id)
    .bind(art.as_str())
    .bind(fremd)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Ob eine lokale Zeile eine Herkunft hat („vom Hub“).
pub async fn has_herkunft(
    conn: &mut SqliteConnection,
    org_id: i64,
    art: StammdatenArt,
    lokal: &str,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM stammdaten_herkunft \
         WHERE org_id = ? AND art = ? AND lokaler_schluessel = ?)",
    )
    .bind(org_id)
    .bind(art.as_str())
    .bind(lokal)
    .fetch_one(&mut *conn)
    .await?)
}

pub async fn save(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    org_id: i64,
    art: StammdatenArt,
    fremd: &str,
    lokal: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO stammdaten_herkunft \
         (kopplung_org_id, org_id, art, fremder_schluessel, lokaler_schluessel) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT (kopplung_org_id, art, fremder_schluessel) \
         DO UPDATE SET lokaler_schluessel = excluded.lokaler_schluessel",
    )
    .bind(kopplung_org_id)
    .bind(org_id)
    .bind(art.as_str())
    .bind(fremd)
    .bind(lokal)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

pub async fn delete(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    art: StammdatenArt,
    fremd: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM stammdaten_herkunft \
         WHERE kopplung_org_id = ? AND art = ? AND fremder_schluessel = ?",
    )
    .bind(kopplung_org_id)
    .bind(art.as_str())
    .bind(fremd)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Nach dem Widerruf einer Org-Zuordnung gehören ihre Zeilen der Instanz (Spec, „Nach dem
/// Widerruf“).
pub async fn delete_fuer_zuordnung(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM stammdaten_herkunft WHERE kopplung_org_id = ?")
        .bind(kopplung_org_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

pub async fn load_merkmal(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    fremd: &str,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT geheimnis_merkmal FROM stammdaten_herkunft \
         WHERE kopplung_org_id = ? AND art = 'konto' AND fremder_schluessel = ?",
    )
    .bind(kopplung_org_id)
    .bind(fremd)
    .fetch_optional(&mut *conn)
    .await?
    .flatten())
}

pub async fn save_merkmal(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    fremd: &str,
    merkmal: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE stammdaten_herkunft SET geheimnis_merkmal = ? \
         WHERE kopplung_org_id = ? AND art = 'konto' AND fremder_schluessel = ?",
    )
    .bind(merkmal)
    .bind(kopplung_org_id)
    .bind(fremd)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Die Org-Zuordnung, aus der eine lokale Org ihre Stammdaten bezieht: die älteste aktive, in der
/// diese Instanz sich meldet (D3). `None`, wenn die Org keine Quelle hat.
pub async fn find_quelle(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT MIN(o.id) FROM instanz_kopplung_org o \
         JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE o.org_id = ? AND o.widerrufen_at IS NULL \
           AND k.richtung = 'meldet_sich' AND k.zustand = 'aktiv'",
    )
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Herkunft der Stammdaten einer Org für die Oberfläche (design.md D9).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct StammdatenHerkunftAnzeige {
    /// Name der Gegenstelle, aus der die Org ihre Stammdaten bezieht; ohne Quelle fehlt das Feld
    /// (dann gibt es weder „vom Hub“ noch „nur hier“).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quelle: Option<String>,
    /// Je Art (Wire-Wert von `StammdatenArt`) die lokalen Schlüssel der übernommenen Zeilen.
    pub vom_hub: BTreeMap<String, Vec<String>>,
    /// Nur für Admins und nur, wenn diese Instanz die Geheimnisse der Org verteilt: System-Admins
    /// ohne Anmelde-Passkey; ihre Geheimnisse gehen nicht hinaus (design.md D7).
    pub admins_ohne_passkey: Vec<i64>,
}

pub async fn load_anzeige(
    pool: &SqlitePool,
    org_id: i64,
    fuer_admin: bool,
) -> Result<StammdatenHerkunftAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    let quelle = match find_quelle(&mut conn, org_id).await? {
        Some(id) => {
            sqlx::query_scalar(
                "SELECT k.gegenueber_name FROM instanz_kopplung_org o \
             JOIN instanz_kopplung k ON k.id = o.kopplung_id WHERE o.id = ?",
            )
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?
        }
        None => None,
    };
    let zeilen: Vec<(String, String)> = sqlx::query_as(
        "SELECT art, lokaler_schluessel FROM stammdaten_herkunft WHERE org_id = ? \
         ORDER BY art, lokaler_schluessel",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut vom_hub: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (art, lokal) in zeilen {
        vom_hub.entry(art).or_default().push(lokal);
    }
    drop(conn);
    let admins_ohne_passkey =
        if fuer_admin && super::geheimnis::is_org_verteilend(pool, org_id).await? {
            sqlx::query_scalar(
                "SELECT b.id FROM benutzer b WHERE b.org_id = ? AND b.system_rolle = 'admin' \
             AND b.aktiv = 1 AND NOT EXISTS (SELECT 1 FROM webauthn_credential w \
               WHERE w.benutzer_id = b.id) ORDER BY b.id",
            )
            .bind(org_id)
            .fetch_all(pool)
            .await?
        } else {
            Vec::new()
        };
    Ok(StammdatenHerkunftAnzeige {
        quelle,
        vom_hub,
        admins_ohne_passkey,
    })
}
