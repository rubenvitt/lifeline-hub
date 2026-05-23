use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SESSION_COOKIE};
use crate::auth::password;
use crate::error::AppError;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub benutzername: String,
    pub passwort: String,
}

/// Baut das Session-Cookie. Bewusst OHNE `Secure`, damit der Betrieb über
/// HTTP im vertrauenswürdigen LAN (ELW) funktioniert (siehe Spec Abschnitt 14).
fn session_cookie(token: String) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/")
        .build()
}

/// POST /api/auth/login — prüft Anmeldedaten, legt Session an, setzt Cookie.
pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<crate::auth::BenutzerAnzeige>), AppError> {
    let benutzer = sqlx::query_as::<_, crate::auth::Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
    )
    .bind(&req.benutzername)
    .fetch_optional(&state.pool)
    .await?;

    let benutzer = match benutzer {
        Some(b) if password::verifizieren(&req.passwort, &b.passwort_hash) => b,
        Some(_) => return Err(AppError::Unauthorized),
        None => {
            // Wegwerf-Hash, um die Antwortzeit anzugleichen (User-Enumeration-Schutz).
            let _ = password::hash(&req.passwort);
            return Err(AppError::Unauthorized);
        }
    };

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token));
    Ok((jar, Json(benutzer.anzeige())))
}

/// POST /api/auth/logout — löscht die Session und entfernt das Cookie.
pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AppError> {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        session::loeschen(&state.pool, cookie.value()).await?;
    }
    let jar = jar.remove(Cookie::build((SESSION_COOKIE, "")).path("/").build());
    Ok((jar, StatusCode::NO_CONTENT))
}

/// GET /api/auth/me — liefert den aktuell angemeldeten Benutzer.
pub async fn me(CurrentUser(benutzer): CurrentUser) -> Json<crate::auth::BenutzerAnzeige> {
    Json(benutzer.anzeige())
}
