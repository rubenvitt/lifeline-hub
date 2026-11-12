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

/// Hält die Herkunft einer übernommenen Zeile fest, samt Ursprungskennung (LLH-1497, design.md
/// D5): die gelieferte, sonst `<Kennung der Quelle>/<fremder Schlüssel>` (eine Quelle mit
/// Protokoll 2 liefert keine und hat die Zeile selbst angelegt).
pub async fn save(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    org_id: i64,
    art: StammdatenArt,
    fremd: &str,
    lokal: &str,
    ursprung: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO stammdaten_herkunft \
         (kopplung_org_id, org_id, art, fremder_schluessel, lokaler_schluessel, ursprung) \
         VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, \
             (SELECT k.gegenueber_kennung FROM instanz_kopplung_org o \
               JOIN instanz_kopplung k ON k.id = o.kopplung_id WHERE o.id = ?1) || '/' || ?4)) \
         ON CONFLICT (kopplung_org_id, art, fremder_schluessel) \
         DO UPDATE SET lokaler_schluessel = excluded.lokaler_schluessel, \
                       ursprung = excluded.ursprung",
    )
    .bind(kopplung_org_id)
    .bind(org_id)
    .bind(art.as_str())
    .bind(fremd)
    .bind(lokal)
    .bind(ursprung)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ursprungskennung einer Zeile dieser Instanz (LLH-1497, design.md D5): die gespeicherte, wenn
/// sie übernommen ist, sonst die eigene Instanz mit dem lokalen Schlüssel.
pub async fn ursprung(
    conn: &mut SqliteConnection,
    org_id: i64,
    art: StammdatenArt,
    lokal: &str,
) -> Result<String, AppError> {
    let gespeichert: Option<Option<String>> = sqlx::query_scalar(
        "SELECT ursprung FROM stammdaten_herkunft \
         WHERE org_id = ? AND art = ? AND lokaler_schluessel = ? ORDER BY id LIMIT 1",
    )
    .bind(org_id)
    .bind(art.as_str())
    .bind(lokal)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(Some(u)) = gespeichert {
        return Ok(u);
    }
    let ich: String = sqlx::query_scalar("SELECT kennung FROM instanz_identitaet")
        .fetch_one(&mut *conn)
        .await?;
    Ok(format!("{ich}/{lokal}"))
}

/// Lokaler Schlüssel der Zeile einer Org mit dieser Ursprungskennung (LLH-1497, design.md D5):
/// eigenes Präfix → die lokale Zeile selbst (wenn es sie in der Org gibt, prüft der Aufrufer),
/// sonst die übernommene Zeile mit diesem Ursprung.
pub async fn find_nach_ursprung(
    conn: &mut SqliteConnection,
    org_id: i64,
    art: StammdatenArt,
    ursprung: &str,
) -> Result<Option<String>, AppError> {
    let ich: String = sqlx::query_scalar("SELECT kennung FROM instanz_identitaet")
        .fetch_one(&mut *conn)
        .await?;
    if let Some(lokal) = ursprung
        .strip_prefix(ich.as_str())
        .and_then(|r| r.strip_prefix('/'))
    {
        return Ok(Some(lokal.to_string()));
    }
    Ok(sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM stammdaten_herkunft \
         WHERE org_id = ? AND art = ? AND ursprung = ? ORDER BY id LIMIT 1",
    )
    .bind(org_id)
    .bind(art.as_str())
    .bind(ursprung)
    .fetch_optional(&mut *conn)
    .await?)
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
/// diese Instanz sich meldet (D3), und nur über eine Kopplung, die Stammdaten trägt (LLH-1497:
/// `traegt(Fluss::Stammdaten)`, eine Direktkopplung vor Ort nie). `None`, wenn die Org keine Quelle
/// hat.
pub async fn find_quelle(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT MIN(o.id) FROM instanz_kopplung_org o \
         JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE o.org_id = ? AND o.widerrufen_at IS NULL \
           AND k.richtung = 'meldet_sich' AND k.zustand = 'aktiv' AND k.art = 'standard'",
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
