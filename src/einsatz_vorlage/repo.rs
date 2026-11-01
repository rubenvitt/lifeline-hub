//! Lesen und Schreiben der Einsatz-Vorlagen (LLH-1375). Jede Abfrage ist auf die Organisation
//! geschnitten; eine fremde oder unbekannte id ist `NotFound`. Schreibwege laufen als
//! Pool-Fassung in `write_retry!`, die `_tx`-Fassungen nehmen die Verbindung des Aufrufers
//! (`bootstrap_admin`, `einsatz::repo::anlegen_tx`).

use super::{EinsatzVorlage, EINSATZ_VORLAGE_STARTLISTE};
use crate::einsatz::modul::MODUL_KEYS;
use crate::einsatz::Einsatzart;
use crate::error::AppError;
use crate::write_retry;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

/// Felder einer Vorlage beim Anlegen und beim Vollersatz, schon geprüft: Bezeichnung getrimmt
/// und nicht leer, Module bekannt, ausblendbar und entdoppelt. Ob das Schichtmodell zur
/// Organisation gehört, prüft das Schreiben selbst ([`check_schichtmodell_tx`]).
#[derive(Debug, Clone, Copy)]
pub struct VorlageDaten<'a> {
    pub bezeichnung: &'a str,
    pub einsatzart: Option<Einsatzart>,
    pub schichtmodell_id: Option<i64>,
    pub ausgeblendet: &'a [&'a str],
}

/// Ein Schichtmodell an der Vorlage muss eines der eigenen Organisation sein (LLH-1313,
/// design.md D2); fremd oder unbekannt ist ein Feldfehler (400), wie eine fremde Vorlage am
/// Stichwort-Vorschlag. Läuft in der Schreibtransaktion, damit das Modell nicht dazwischen fällt.
async fn check_schichtmodell_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    schichtmodell_id: Option<i64>,
) -> Result<(), AppError> {
    let Some(id) = schichtmodell_id else {
        return Ok(());
    };
    let vorhanden: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM schichtmodell WHERE id = ? AND org_id = ?)",
    )
    .bind(id)
    .bind(org_id)
    .fetch_one(&mut *conn)
    .await?;
    if vorhanden {
        Ok(())
    } else {
        Err(AppError::Validation("Unbekanntes Schichtmodell".into()))
    }
}

const BEZEICHNUNG_DOPPELT: &str = "Eine Einsatz-Vorlage mit dieser Bezeichnung gibt es schon";

/// Zweite Bezeichnung derselben Organisation → `Conflict` (wie Stichworte und
/// Einheiten-Vorlagen).
fn map_bezeichnung_conflict<T>(e: AppError) -> Result<T, AppError> {
    if let AppError::Database(sqlx::Error::Database(db)) = &e {
        if db.is_unique_violation() && db.message().contains("einsatz_vorlage.bezeichnung") {
            return Err(AppError::Conflict(BEZEICHNUNG_DOPPELT.into()));
        }
    }
    Err(e)
}

/// Modulschlüssel als JSON-Array für `json_each(?)`.
fn json_keys(keys: &[&str]) -> Result<String, AppError> {
    serde_json::to_string(keys)
        .map_err(|e| AppError::Internal(format!("Modulschlüssel serialisieren: {e}")))
}

/// Ordnet Modulschlüssel wie `MODUL_KEYS`; ein nicht (mehr) bekannter Schlüssel kommt ans Ende.
fn sort_keys(keys: &mut [String]) {
    keys.sort_by_key(|k| {
        (
            MODUL_KEYS
                .iter()
                .position(|m| m == k)
                .unwrap_or(MODUL_KEYS.len()),
            k.clone(),
        )
    });
}

type KopfZeile = (i64, String, Option<String>, Option<i64>, i64);

/// Spalten der Kopfzeile in der Reihenfolge von [`KopfZeile`].
const KOPF_SPALTEN: &str = "id, bezeichnung, einsatzart, schichtmodell_id, sortier";

fn build(kopf: KopfZeile, mut ausgeblendet: Vec<String>) -> EinsatzVorlage {
    let (id, bezeichnung, einsatzart, schichtmodell_id, sortier) = kopf;
    sort_keys(&mut ausgeblendet);
    EinsatzVorlage {
        id,
        bezeichnung,
        // Die Spalte trägt einen CHECK auf die vier Werte; ein unlesbarer Wert fiele weg.
        einsatzart: einsatzart.as_deref().and_then(Einsatzart::parse),
        schichtmodell_id,
        ausgeblendet,
        sortier,
    }
}

/// Alle Vorlagen der Organisation, geordnet nach `sortier`, dann Bezeichnung.
pub async fn list(pool: &SqlitePool, org_id: i64) -> Result<Vec<EinsatzVorlage>, AppError> {
    let mut conn = pool.acquire().await?;
    list_tx(&mut conn, org_id).await
}

/// [`list`] auf der Verbindung des Aufrufers.
pub async fn list_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Vec<EinsatzVorlage>, AppError> {
    let koepfe: Vec<KopfZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {KOPF_SPALTEN} FROM einsatz_vorlage \
         WHERE org_id = ? ORDER BY sortier, bezeichnung, id"
    )))
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let module: Vec<(i64, String)> = sqlx::query_as(
        "SELECT a.vorlage_id, a.modul_key FROM einsatz_vorlage_modul_aus a \
         JOIN einsatz_vorlage v ON v.id = a.vorlage_id WHERE v.org_id = ?",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut je_vorlage: HashMap<i64, Vec<String>> = HashMap::new();
    for (vorlage_id, key) in module {
        je_vorlage.entry(vorlage_id).or_default().push(key);
    }
    Ok(koepfe
        .into_iter()
        .map(|kopf| {
            let module = je_vorlage.remove(&kopf.0).unwrap_or_default();
            build(kopf, module)
        })
        .collect())
}

/// Eine Vorlage der Organisation; `None` bei fremder oder unbekannter id.
pub async fn load_for_org(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
) -> Result<Option<EinsatzVorlage>, AppError> {
    let mut conn = pool.acquire().await?;
    load_for_org_tx(&mut conn, org_id, id).await
}

/// [`load_for_org`] auf der Verbindung des Aufrufers.
pub async fn load_for_org_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<Option<EinsatzVorlage>, AppError> {
    let kopf: Option<KopfZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {KOPF_SPALTEN} FROM einsatz_vorlage WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(kopf) = kopf else {
        return Ok(None);
    };
    let module: Vec<String> =
        sqlx::query_scalar("SELECT modul_key FROM einsatz_vorlage_modul_aus WHERE vorlage_id = ?")
            .bind(id)
            .fetch_all(&mut *conn)
            .await?;
    Ok(Some(build(kopf, module)))
}

/// Ersetzt die ausgeblendeten Module einer Vorlage durch genau diese Menge (eine Anweisung je
/// Schritt, unabhängig von der Zahl der Module).
async fn replace_module_tx(
    conn: &mut SqliteConnection,
    vorlage_id: i64,
    ausgeblendet: &[&str],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_vorlage_modul_aus WHERE vorlage_id = ?")
        .bind(vorlage_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT OR IGNORE INTO einsatz_vorlage_modul_aus (vorlage_id, modul_key) \
         SELECT ?, value FROM json_each(?)",
    )
    .bind(vorlage_id)
    .bind(json_keys(ausgeblendet)?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Legt eine Vorlage am Ende der Liste an (`sortier` = höchster Wert + 10) und liefert ihre id.
/// Bezeichnung doppelt in der Organisation → `Conflict`, fremdes Schichtmodell → `Validation`.
pub async fn create_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    daten: &VorlageDaten<'_>,
    sortier: Option<i64>,
) -> Result<i64, AppError> {
    check_schichtmodell_tx(conn, org_id, daten.schichtmodell_id).await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_vorlage (org_id, bezeichnung, einsatzart, schichtmodell_id, sortier) \
         VALUES (?1, ?2, ?3, ?4, COALESCE(?5, \
                 (SELECT COALESCE(MAX(sortier), 0) + 10 FROM einsatz_vorlage WHERE org_id = ?1))) \
         RETURNING id",
    )
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.einsatzart.map(|a| a.as_str()))
    .bind(daten.schichtmodell_id)
    .bind(sortier)
    .fetch_one(&mut *conn)
    .await
    .map_err(AppError::from)
    .or_else(map_bezeichnung_conflict)?;
    replace_module_tx(conn, id, daten.ausgeblendet).await?;
    Ok(id)
}

/// [`create_tx`] in einer eigenen Transaktion; liefert die angelegte Vorlage.
pub async fn create(
    pool: &SqlitePool,
    org_id: i64,
    daten: VorlageDaten<'_>,
) -> Result<EinsatzVorlage, AppError> {
    write_retry!(pool, |conn| {
        let id = create_tx(conn, org_id, &daten, None).await?;
        load_for_org_tx(conn, org_id, id)
            .await?
            .ok_or_else(|| AppError::Internal("Angelegte Einsatz-Vorlage fehlt".into()))
    })
}

/// Vollersatz einer Vorlage: Bezeichnung, Einsatzart, Schichtmodell und Modulmenge. `sortier`
/// bleibt. Fremde oder unbekannte id → `NotFound`, Bezeichnung doppelt → `Conflict`, fremdes
/// Schichtmodell → `Validation`.
pub async fn update(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: VorlageDaten<'_>,
) -> Result<EinsatzVorlage, AppError> {
    write_retry!(pool, |conn| {
        check_schichtmodell_tx(conn, org_id, daten.schichtmodell_id).await?;
        let n = sqlx::query(
            "UPDATE einsatz_vorlage SET bezeichnung = ?, einsatzart = ?, schichtmodell_id = ?, \
                    geaendert_at = datetime('now') \
             WHERE id = ? AND org_id = ?",
        )
        .bind(daten.bezeichnung)
        .bind(daten.einsatzart.map(|a| a.as_str()))
        .bind(daten.schichtmodell_id)
        .bind(id)
        .bind(org_id)
        .execute(&mut *conn)
        .await
        .map_err(AppError::from)
        .or_else(map_bezeichnung_conflict)?
        .rows_affected();
        if n == 0 {
            return Err(AppError::NotFound);
        }
        replace_module_tx(conn, id, daten.ausgeblendet).await?;
        load_for_org_tx(conn, org_id, id)
            .await?
            .ok_or(AppError::NotFound)
    })
}

/// Löscht eine Vorlage der Organisation samt Modulmenge (CASCADE); ein Stichwort-Vorschlag, der
/// auf sie zeigt, verliert die Kopplung (SET NULL). Fremde oder unbekannte id → `NotFound`.
pub async fn delete(pool: &SqlitePool, org_id: i64, id: i64) -> Result<(), AppError> {
    let n = sqlx::query("DELETE FROM einsatz_vorlage WHERE id = ? AND org_id = ?")
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Die Vorlage `vorlage_id` für einen neuen Einsatz der Organisation `org_id`: ausgeblendete
/// Module und Schichtmodell. Eine fremde oder unbekannte Vorlage ist ein Feldfehler (400): die
/// Anlage scheitert, ohne dass ein Einsatz entsteht (Spec `einsatz-vorlagen`, „Fremde Vorlage“).
pub async fn load_for_anlage_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    vorlage_id: i64,
) -> Result<EinsatzVorlage, AppError> {
    load_for_org_tx(conn, org_id, vorlage_id)
        .await?
        .ok_or_else(|| AppError::Validation("Unbekannte Einsatz-Vorlage".into()))
}

/// Legt die Startliste [`EINSATZ_VORLAGE_STARTLISTE`] für eine neue Organisation an
/// (`bootstrap_admin`).
pub async fn seed_startliste_tx(conn: &mut SqliteConnection, org_id: i64) -> Result<(), AppError> {
    for start in EINSATZ_VORLAGE_STARTLISTE {
        let ausgeblendet = start.ausgeblendet();
        create_tx(
            conn,
            org_id,
            &VorlageDaten {
                bezeichnung: start.bezeichnung,
                einsatzart: Some(start.einsatzart),
                schichtmodell_id: None,
                ausgeblendet: &ausgeblendet,
            },
            Some(start.sortier),
        )
        .await?;
    }
    Ok(())
}
