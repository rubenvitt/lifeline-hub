use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SESSION_COOKIE};
use crate::error::AppError;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Redirect;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use openidconnect::core::CoreAuthenticationFlow;
use openidconnect::{CsrfToken, Nonce, PkceCodeChallenge, Scope};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub benutzername: String,
    pub passwort: String,
}

/// Baut das Session-Cookie. `Secure` folgt jetzt dem Transport (HTTPS → an,
/// HTTP → aus), gesteuert vom Aufrufer (siehe Spec Abschnitt 14). Pur, damit
/// beide Zweige ohne den prozessweiten OnceLock testbar sind — der Aufrufer
/// (`login`) liest `cookie_secure()`.
fn session_cookie(token: String, secure: bool) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
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
    let jar = jar.add(session_cookie(token, crate::auth::session::cookie_secure()));
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

#[derive(Debug, Deserialize)]
pub struct OidcStartQuery {
    von: Option<String>,
}

/// Ziel-Pfad nach erfolgreichem OIDC-Login: mirrort `LoginPage`s `zielPfad`
/// (Default `/einsaetze`), aber aus einem Query-Param statt Router-State — der
/// OIDC-Flow verlässt die SPA per echtem Browser-Redirect, React-Router-State
/// überlebt das nicht. Nur App-lokale Pfade (`/…`, kein `//…`) werden
/// übernommen, sonst der Default — schützt vor Open-Redirect über `?von=`.
fn ziel_pfad_aus_query(von: Option<String>) -> String {
    match von {
        Some(pfad) if pfad.starts_with('/') && !pfad.starts_with("//") => pfad,
        _ => "/einsaetze".to_string(),
    }
}

/// GET /api/auth/oidc/start — Authorization-Redirect zum konfigurierten OIDC-Provider
/// (PocketID, LFH-41). Enforcement über die Provider-Registry: ist `oidc` nicht gelistet
/// (nicht konfiguriert) oder deaktiviert, liefert dieser Handler `404` — genau wie ein
/// unbekannter Provider bei `provider_schalten`. Ein IdP-/Discovery-Fehler (unerreichbarer
/// Server, kaputte Metadaten) leakt NICHT als 500, sondern leitet zurück auf die Login-Seite
/// mit einem generischen Fehlerhinweis — der lokale Passwort-Login bleibt davon unberührt.
pub async fn oidc_start(
    State(state): State<AppState>,
    Query(query): Query<OidcStartQuery>,
) -> Result<Redirect, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    let oidc_aktiv = liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_OIDC && p.aktiviert);
    if !oidc_aktiv {
        return Err(AppError::NotFound);
    }

    let client = match crate::auth::oidc::oidc_client(crate::auth::oidc::oidc_settings()).await {
        Ok(client) => client,
        Err(_) => return Ok(Redirect::to("/login?fehler=oidc")),
    };

    let ziel_pfad = ziel_pfad_aus_query(query.von);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (auth_url, csrf, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    // Sync — kein Guard über ein `.await` hinweg (Plan-MUST „!Send"). `speichere` kehrt
    // zurück, bevor irgendein weiteres `.await` folgt (hier: gar keins mehr).
    crate::auth::oidc::state::speichere(
        csrf.secret().clone(),
        crate::auth::oidc::state::StateEintrag {
            nonce: nonce.secret().clone(),
            pkce_verifier: pkce_verifier.secret().clone(),
            ziel_pfad,
        },
    );

    Ok(Redirect::to(auth_url.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_cookie_secure_folgt_parameter() {
        // Diskriminierend: beide Zweige geprüft (kein OnceLock im Test).
        assert_eq!(session_cookie("t".into(), true).secure(), Some(true));
        assert_ne!(session_cookie("t".into(), false).secure(), Some(true));
    }
}
