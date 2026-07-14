use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SESSION_COOKIE};
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
    let benutzer =
        crate::auth::provider::password::anmelden(&state.pool, &req.benutzername, &req.passwort)
            .await?;

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

/// GET /api/auth/providers — verfügbare Login-Provider (öffentlich, für die Login-UI).
pub async fn providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct ProviderSchaltenRequest {
    pub aktiviert: bool,
}

/// PUT /api/auth/providers/{id} — Provider an/aus. Admin-only. Guard gegen Aussperren.
pub async fn provider_schalten(
    State(state): State<AppState>,
    _admin: crate::auth::session::AdminUser,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<ProviderSchaltenRequest>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    crate::auth::provider::registry::schalten(&state.pool, &id, req.aktiviert).await?;
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}
