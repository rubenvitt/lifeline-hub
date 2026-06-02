use super::EtbBaustein;
use crate::error::AppError;
use sqlx::SqlitePool;

const SPALTEN: &str = "id, label, typ, inhalt, meldeweg, veranlassung, sortier";

/// Editierbare Katalog-Felder eines ETB-Bausteins. `typ` ist bereits gegen die
/// gültigen Baustein-Typen validiert; `meldeweg`/`veranlassung` sind optional.
#[derive(Debug)]
pub struct BausteinDaten<'a> {
    pub label: &'a str,
    pub typ: &'a str,
    pub inhalt: &'a str,
    pub meldeweg: Option<&'a str>,
    pub veranlassung: Option<&'a str>,
    pub sortier: i64,
}

fn label_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Ein Baustein mit diesem Label existiert bereits".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt einen Baustein der Org (ignoriert `aktiv`, bleibt referenzierbar);
/// `NotFound` bei fremder/unbekannter id.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<EtbBaustein, AppError> {
    sqlx::query_as::<_, EtbBaustein>(&format!(
        "SELECT {SPALTEN} FROM etb_baustein WHERE id = ? AND org_id = ?"
    ))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Nur aktive Bausteine der Org (`aktiv = 1`), sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<EtbBaustein>, AppError> {
    sqlx::query_as::<_, EtbBaustein>(&format!(
        "SELECT {SPALTEN} FROM etb_baustein \
         WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    ))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen Baustein an. Dublette `label` je Org → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: BausteinDaten<'_>,
) -> Result<EtbBaustein, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO etb_baustein \
            (org_id, label, typ, inhalt, meldeweg, veranlassung, sortier) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.label)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(daten.sortier)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return label_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped), setzt `aktualisiert_at`.
/// `NotFound` bei fremder/unbekannter id, `Conflict` bei Label-Dublette.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: BausteinDaten<'_>,
) -> Result<EtbBaustein, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE etb_baustein SET \
            label = ?, typ = ?, inhalt = ?, meldeweg = ?, veranlassung = ?, sortier = ?, \
            aktualisiert_at = datetime('now') \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.label)
    .bind(daten.typ)
    .bind(daten.inhalt)
    .bind(daten.meldeweg)
    .bind(daten.veranlassung)
    .bind(daten.sortier)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return label_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Deaktiviert einen Baustein (Soft-Delete `aktiv = 0`, setzt `aktualisiert_at`);
/// bleibt über `laden` referenzierbar. `NotFound` bei fremder/unbekannter id.
pub async fn deaktivieren(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let resultat = sqlx::query(
        "UPDATE etb_baustein SET aktiv = 0, aktualisiert_at = datetime('now') \
         WHERE id = ? AND org_id = ?",
    )
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
