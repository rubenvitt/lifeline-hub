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
    sqlx::query_as::<_, EtbBaustein>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM etb_baustein WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Nur aktive Bausteine der Org (`aktiv = 1`), sortiert nach `sortier`, dann `id`.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<EtbBaustein>, AppError> {
    sqlx::query_as::<_, EtbBaustein>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM etb_baustein \
         WHERE org_id = ? AND aktiv = 1 ORDER BY sortier, id"
    )))
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

/// Teil-Patch der editierbaren Felder (LFH-306, Tri-State): die äußere `Option` sagt
/// „im Patch enthalten?" — `None` lässt die Spalte unverändert. Bei den nullable Spalten
/// `meldeweg`/`veranlassung` trägt der Wert selbst noch eine `Option`: `Some(None)` setzt
/// sie auf NULL.
#[derive(Debug, Default)]
pub struct BausteinPatch<'a> {
    pub label: Option<&'a str>,
    pub typ: Option<&'a str>,
    pub inhalt: Option<&'a str>,
    pub meldeweg: Option<Option<&'a str>>,
    pub veranlassung: Option<Option<&'a str>>,
    pub sortier: Option<i64>,
}

/// Teil-Patch der editierbaren Felder (org-scoped), setzt `aktualisiert_at`.
/// `NotFound` bei fremder/unbekannter id, `Conflict` bei Label-Dublette.
///
/// Flag/Wert-Paare statt COALESCE (LFH-266/F12, Vorlage `personal/status_repo.rs`): erst so
/// lassen sich `meldeweg`/`veranlassung` über die API wieder auf NULL setzen, und ein nicht
/// gesendetes Feld fasst seine Spalte nicht an. Die Parameter sind nummeriert, weil eine um
/// eine Position verschobene Bind-Kette gleichtypige Nachbarspalten (`label`↔`typ`↔`inhalt`,
/// `meldeweg`↔`veranlassung`) STILL vertauschen würde — abgesichert von
/// `patche_setzt_jede_spalte_an_ihren_platz` in `tests/etb_baustein.rs`.
pub async fn patche(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: BausteinPatch<'_>,
) -> Result<EtbBaustein, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE etb_baustein SET \
            label = CASE WHEN ?1 IS NULL THEN label ELSE ?2 END, \
            typ = CASE WHEN ?3 IS NULL THEN typ ELSE ?4 END, \
            inhalt = CASE WHEN ?5 IS NULL THEN inhalt ELSE ?6 END, \
            meldeweg = CASE WHEN ?7 IS NULL THEN meldeweg ELSE ?8 END, \
            veranlassung = CASE WHEN ?9 IS NULL THEN veranlassung ELSE ?10 END, \
            sortier = CASE WHEN ?11 IS NULL THEN sortier ELSE ?12 END, \
            aktualisiert_at = datetime('now') \
         WHERE id = ?13 AND org_id = ?14",
    )
    .bind(patch.label.map(|_| 1_i64))
    .bind(patch.label)
    .bind(patch.typ.map(|_| 1_i64))
    .bind(patch.typ)
    .bind(patch.inhalt.map(|_| 1_i64))
    .bind(patch.inhalt)
    .bind(patch.meldeweg.map(|_| 1_i64))
    .bind(patch.meldeweg.and_then(|v| v))
    .bind(patch.veranlassung.map(|_| 1_i64))
    .bind(patch.veranlassung.and_then(|v| v))
    .bind(patch.sortier.map(|_| 1_i64))
    .bind(patch.sortier)
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
