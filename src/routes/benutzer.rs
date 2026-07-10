use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::auth::{
    password, BenutzerAnzeige, OrgRolle, SystemRolle, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
};
use crate::error::AppError;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Mindestlänge für Passwörter (siehe Plan-Design-Entscheidungen).
const PASSWORT_MIN_LEN: usize = 8;

#[derive(Debug, Deserialize)]
pub struct NeuerBenutzer {
    pub anzeigename: String,
    pub benutzername: String,
    pub passwort: String,
    /// 'admin' oder 'keiner'; fehlt das Feld, gilt 'keiner'.
    pub system_rolle: Option<String>,
    /// 'fuehrungskraft' oder 'keine'; fehlt das Feld, gilt 'keine'.
    pub org_rolle: Option<String>,
}

/// GET /api/benutzer — Liste aller Benutzer (ohne Passwort-Hashes). Admin-only.
pub async fn liste(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<BenutzerAnzeige>>, AppError> {
    let benutzer = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer ORDER BY id",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(benutzer))
}

/// POST /api/benutzer — neuen Benutzer anlegen. Admin-only.
pub async fn anlegen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(req): Json<NeuerBenutzer>,
) -> Result<(StatusCode, Json<BenutzerAnzeige>), AppError> {
    if req.benutzername.trim().is_empty() {
        return Err(AppError::Validation("Benutzername darf nicht leer sein".into()));
    }
    if req.anzeigename.trim().is_empty() {
        return Err(AppError::Validation("Anzeigename darf nicht leer sein".into()));
    }
    if req.passwort.len() < PASSWORT_MIN_LEN {
        return Err(AppError::Validation(format!(
            "Passwort muss mindestens {PASSWORT_MIN_LEN} Zeichen haben"
        )));
    }
    let rolle = req.system_rolle.as_deref().unwrap_or(ROLLE_KEINER);
    if SystemRolle::parse(rolle).is_none() {
        return Err(AppError::Validation(
            "system_rolle muss 'admin' oder 'keiner' sein".into(),
        ));
    }

    let org_rolle = req.org_rolle.as_deref().unwrap_or(ORG_ROLLE_KEINE);
    if OrgRolle::parse(org_rolle).is_none() {
        return Err(AppError::Validation(
            "org_rolle muss 'fuehrungskraft' oder 'keine' sein".into(),
        ));
    }

    let hash = password::hash(&req.passwort)?;
    // Single-Org in T1: alle Benutzer gehören zur (einzigen) Organisation.
    let org_id: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Internal("Keine Organisation vorhanden".into()))?;

    let ergebnis = sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind(req.anzeigename.trim())
    .bind(req.benutzername.trim())
    .bind(&hash)
    .bind(rolle)
    .bind(org_rolle)
    .execute(&state.pool)
    .await;

    if let Err(sqlx::Error::Database(db_err)) = &ergebnis {
        if db_err.is_unique_violation() {
            return Err(AppError::Conflict("Benutzername ist bereits vergeben".into()));
        }
    }
    let id = ergebnis?.last_insert_rowid();

    let angelegt = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(angelegt)))
}

/// POST /api/benutzer/{id}/deaktivieren — Benutzer deaktivieren + Sessions löschen.
/// Verweigert die Deaktivierung des letzten aktiven Admins. Admin-only.
pub async fn deaktivieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<BenutzerAnzeige>, AppError> {
    let ziel = sqlx::query_as::<_, crate::auth::Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    // Letzten aktiven Admin schützen.
    if ziel.ist_admin() && ziel.aktiv {
        let aktive_admins: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM benutzer WHERE system_rolle = ? AND aktiv = 1",
        )
        .bind(ROLLE_ADMIN)
        .fetch_one(&state.pool)
        .await?;
        if aktive_admins <= 1 {
            return Err(AppError::Conflict(
                "Der letzte aktive Admin kann nicht deaktiviert werden".into(),
            ));
        }
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM session WHERE benutzer_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let aktualisiert = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(aktualisiert))
}
