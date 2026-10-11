use super::{ExterneStelle, ExterneStelleArt};
use crate::error::AppError;
use crate::write_retry;
use sqlx::{SqliteConnection, SqlitePool};

const COLUMNS: &str = "id, bezeichnung, art, rufnummer, funkrufname, aktiv, zustaendig";

/// Sortierung nach design.md D2: Gruppen in der Reihenfolge von [`ExterneStelleArt::ALLE`], darin
/// die zuständige Leitstelle vorn, dann alphabetisch.
const ORDER_BY: &str = "ORDER BY CASE art \
        WHEN 'leitstelle' THEN 0 WHEN 'polizei' THEN 1 WHEN 'behoerde' THEN 2 \
        WHEN 'hilfsorganisation' THEN 3 ELSE 4 END, \
     zustaendig DESC, bezeichnung COLLATE NOCASE, id";

/// Felder einer neuen Stelle, schon getrimmt und geprüft.
#[derive(Debug)]
pub struct NeueStelle<'a> {
    pub bezeichnung: &'a str,
    pub art: ExterneStelleArt,
    pub rufnummer: Option<&'a str>,
    pub funkrufname: Option<&'a str>,
    pub zustaendig: bool,
}

/// Teil-Patch (Tri-State): äußere `Option` = „im Patch?“; bei `rufnummer`/`funkrufname` setzt
/// `Some(None)` NULL.
#[derive(Debug, Default)]
pub struct StellePatch<'a> {
    pub bezeichnung: Option<&'a str>,
    pub art: Option<ExterneStelleArt>,
    pub rufnummer: Option<Option<&'a str>>,
    pub funkrufname: Option<Option<&'a str>>,
    pub aktiv: Option<bool>,
    pub zustaendig: Option<bool>,
}

fn map_bezeichnung_conflict<T>(e: AppError) -> Result<T, AppError> {
    if let AppError::Database(sqlx::Error::Database(db)) = &e {
        if db.is_unique_violation() && db.message().contains("bezeichnung") {
            return Err(AppError::Conflict(
                "Eine externe Stelle mit dieser Bezeichnung gibt es schon".into(),
            ));
        }
    }
    Err(e)
}

const NUR_LEITSTELLE: &str = "Zuständig kann nur eine Stelle der Art Leitstelle sein";
const NUR_AKTIV: &str = "Zuständig kann nur eine aktive Stelle sein";

/// Alle Stellen der Organisation, mit `nur_aktive` ohne die inaktiven; sortiert nach D2.
pub async fn list(
    pool: &SqlitePool,
    org_id: i64,
    nur_aktive: bool,
) -> Result<Vec<ExterneStelle>, AppError> {
    let filter = if nur_aktive { "AND aktiv = 1" } else { "" };
    sqlx::query_as::<_, ExterneStelle>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM org_externe_stelle WHERE org_id = ? {filter} {ORDER_BY}"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Eine Stelle der Organisation, auch inaktiv; `NotFound` bei fremder oder unbekannter id.
pub async fn load(pool: &SqlitePool, org_id: i64, id: i64) -> Result<ExterneStelle, AppError> {
    let mut conn = pool.acquire().await?;
    load_conn(&mut conn, org_id, id).await
}

async fn load_conn(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<ExterneStelle, AppError> {
    sqlx::query_as::<_, ExterneStelle>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM org_externe_stelle WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Nimmt allen übrigen Stellen der Organisation die Markierung „zuständig“.
async fn clear_zustaendig(
    conn: &mut SqliteConnection,
    org_id: i64,
    ausser: Option<i64>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE org_externe_stelle SET zustaendig = 0, aktualisiert_at = datetime('now') \
         WHERE org_id = ?1 AND zustaendig = 1 AND (?2 IS NULL OR id <> ?2)",
    )
    .bind(org_id)
    .bind(ausser)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Legt eine Stelle an (aktiv). Mit `zustaendig` nur bei Art Leitstelle (sonst 422); die bisherige
/// Markierung entfällt in derselben Transaktion. Doppelte Bezeichnung → `Conflict`.
pub async fn create(
    pool: &SqlitePool,
    org_id: i64,
    daten: NeueStelle<'_>,
) -> Result<ExterneStelle, AppError> {
    if daten.zustaendig && daten.art != ExterneStelleArt::Leitstelle {
        return Err(AppError::UnprocessableEntity(NUR_LEITSTELLE.into()));
    }
    let ergebnis = write_retry!(pool, |conn| {
        if daten.zustaendig {
            clear_zustaendig(conn, org_id, None).await?;
        }
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO org_externe_stelle \
                (org_id, bezeichnung, art, rufnummer, funkrufname, zustaendig) \
             VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(org_id)
        .bind(daten.bezeichnung)
        .bind(daten.art.as_str())
        .bind(daten.rufnummer)
        .bind(daten.funkrufname)
        .bind(daten.zustaendig)
        .fetch_one(&mut *conn)
        .await?;
        load_conn(conn, org_id, id).await
    });
    ergebnis.or_else(map_bezeichnung_conflict)
}

/// Teil-Patch einer Stelle der Organisation (`NotFound` bei fremder oder unbekannter id).
///
/// Die Markierung „zuständig“ wird am Zustand NACH dem Patch geprüft (design.md D3): eine
/// zuständige Stelle muss aktiv und Leitstelle sein, sonst 422. `aktiv: false` nimmt die
/// Markierung mit; zusammen mit `zustaendig: true` ist es 422. Wird eine Stelle zuständig,
/// verliert die bisherige die Markierung in derselben Transaktion.
pub async fn update(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: StellePatch<'_>,
) -> Result<ExterneStelle, AppError> {
    let ergebnis = write_retry!(pool, |conn| {
        let bisher = load_conn(conn, org_id, id).await?;
        let aktiv = patch.aktiv.unwrap_or(bisher.aktiv);
        let art = patch.art.unwrap_or(bisher.art);
        if patch.zustaendig == Some(true) && !aktiv {
            return Err(AppError::UnprocessableEntity(NUR_AKTIV.into()));
        }
        let zustaendig = aktiv && patch.zustaendig.unwrap_or(bisher.zustaendig);
        if zustaendig && art != ExterneStelleArt::Leitstelle {
            return Err(AppError::UnprocessableEntity(NUR_LEITSTELLE.into()));
        }
        if zustaendig && !bisher.zustaendig {
            clear_zustaendig(conn, org_id, Some(id)).await?;
        }
        // Flag/Wert-Paare wie in `etb_baustein::repo::patche`: ein nicht gesendetes Feld bleibt,
        // `Some(None)` leert. Nummerierte Parameter gegen still vertauschte Nachbarn.
        sqlx::query(
            "UPDATE org_externe_stelle SET \
                bezeichnung = CASE WHEN ?1 IS NULL THEN bezeichnung ELSE ?2 END, \
                art = ?3, \
                rufnummer = CASE WHEN ?4 IS NULL THEN rufnummer ELSE ?5 END, \
                funkrufname = CASE WHEN ?6 IS NULL THEN funkrufname ELSE ?7 END, \
                aktiv = ?8, \
                zustaendig = ?9, \
                aktualisiert_at = datetime('now') \
             WHERE id = ?10 AND org_id = ?11",
        )
        .bind(patch.bezeichnung.map(|_| 1_i64))
        .bind(patch.bezeichnung)
        .bind(art.as_str())
        .bind(patch.rufnummer.map(|_| 1_i64))
        .bind(patch.rufnummer.and_then(|v| v))
        .bind(patch.funkrufname.map(|_| 1_i64))
        .bind(patch.funkrufname.and_then(|v| v))
        .bind(aktiv)
        .bind(zustaendig)
        .bind(id)
        .bind(org_id)
        .execute(&mut *conn)
        .await?;
        load_conn(conn, org_id, id).await
    });
    ergebnis.or_else(map_bezeichnung_conflict)
}
