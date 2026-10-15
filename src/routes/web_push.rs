//! HTTP-Routen von Web Push (LLH-1223, design.md D3/D5; Spec `web-push`).
//!
//! GET    /api/web-push      — öffentlicher Schlüssel und ob diese Sitzung ein Abo hat
//! PUT    /api/web-push/abo  — Abo dieses Browsers für diese Sitzung anmelden (204)
//! DELETE /api/web-push/abo  — Abo dieser Sitzung abmelden (idempotent, 204)
//!
//! Ohne `--web-push` antworten alle drei 404 wie ein unbekannter Pfad. Das Abo hängt an der
//! Sitzung aus dem Cookie; Gerätesitzungen erreichen die Routen nicht (keine Routenliste, 403).

use crate::app::AppState;
use crate::auth::session::{hash_token, CurrentUser, SESSION_COOKIE};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::web_push::krypto::{b64_lesen, browser_schluessel, AUTH_LAENGE};
use crate::web_push::{endpunkt_pruefen, repo, WebPush};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Höchstlänge eines Endpunkts. Die Dienste liefern heute unter 600 Zeichen.
pub const ENDPOINT_MAX: usize = 2048;

/// Stand von Web Push für diese Sitzung.
#[derive(Debug, Serialize, ToSchema)]
pub struct WebPushStand {
    /// Öffentlicher Schlüssel der Instanz (Base64url, unkomprimierter P-256-Punkt) für
    /// `pushManager.subscribe({ applicationServerKey })`.
    pub schluessel: String,
    /// Diese Sitzung hat ein Abo.
    pub angemeldet: bool,
}

/// Abo eines Browsers, wie `PushSubscription.toJSON()` es liefert (`keys` flach gelegt).
#[derive(Debug, Deserialize)]
pub struct AboAnmeldung {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

fn web_push(state: &AppState) -> Result<&WebPush, AppError> {
    state.live.web_push().ok_or(AppError::NotFound)
}

/// Der Hash des Sitzungstokens; `CurrentUser` hat das Cookie schon geprüft.
fn sitzung(jar: &CookieJar) -> Result<String, AppError> {
    jar.get(SESSION_COOKIE)
        .map(|c| hash_token(c.value()))
        .ok_or(AppError::Unauthorized)
}

/// GET /api/web-push
pub async fn stand(
    State(state): State<AppState>,
    CurrentUser(_benutzer): CurrentUser,
    jar: CookieJar,
) -> Result<Json<WebPushStand>, AppError> {
    let wp = web_push(&state)?;
    let angemeldet = repo::hat_abo(&state.pool, &sitzung(&jar)?).await?;
    Ok(Json(WebPushStand {
        schluessel: wp.oeffentlicher_schluessel(),
        angemeldet,
    }))
}

/// PUT /api/web-push/abo — 400, wenn Endpunkt oder Schlüssel für sich nicht taugen (keine URL,
/// kein bekannter Push-Dienst, kein P-256-Punkt); dasselbe Browserprofil hängt sein Abo an
/// diese Sitzung um.
pub async fn anmelden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    jar: CookieJar,
    JsonBody(req): JsonBody<AboAnmeldung>,
) -> Result<StatusCode, AppError> {
    let wp = web_push(&state)?;
    let endpoint = req.endpoint.trim();
    if endpoint.chars().count() > ENDPOINT_MAX {
        return Err(AppError::Validation(format!(
            "Endpunkt darf höchstens {ENDPOINT_MAX} Zeichen lang sein"
        )));
    }
    endpunkt_pruefen(endpoint, wp.dienste()).map_err(|g| AppError::Validation(g.into()))?;
    let p256dh = b64_lesen(req.p256dh.trim())
        .ok_or_else(|| AppError::Validation("p256dh ist kein Base64url".into()))?;
    browser_schluessel(&p256dh)
        .map_err(|_| AppError::Validation("p256dh ist kein P-256-Schlüssel".into()))?;
    let auth = b64_lesen(req.auth.trim())
        .ok_or_else(|| AppError::Validation("auth ist kein Base64url".into()))?;
    if auth.len() != AUTH_LAENGE {
        return Err(AppError::Validation("auth muss 16 Byte lang sein".into()));
    }
    // Normalisiert speichern: ohne Auffüllung, wie der Versand sie liest.
    repo::anmelden(
        &state.pool,
        benutzer.id,
        &sitzung(&jar)?,
        endpoint,
        &crate::web_push::krypto::b64(&p256dh),
        &crate::web_push::krypto::b64(&auth),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/web-push/abo
pub async fn abmelden(
    State(state): State<AppState>,
    CurrentUser(_benutzer): CurrentUser,
    jar: CookieJar,
) -> Result<StatusCode, AppError> {
    web_push(&state)?;
    repo::abmelden(&state.pool, &sitzung(&jar)?).await?;
    Ok(StatusCode::NO_CONTENT)
}
