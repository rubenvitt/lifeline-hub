//! Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, ADR-0098).
//!
//! - Routen der Leitung am Einsatz unter `/api/incidents/{id}/helpers…`. Recht wie beim Koppeln:
//!   [`EinsatzLeitungszugriff`] (Einsatzleitung, nur aktiver Einsatz). Der Pfadparameter heißt
//!   `{id}`, weil `EinsatzKontext` den Einsatz unter diesem Namen liest.
//! - Öffentliche Wege der App vor der Anmeldung: Zielliste und Einlösen
//!   (`/api/devices/helpers/…`), gedrosselt wie `/api/devices/pair`.
//! - Der eigene Zustand der Helfer-Kopplung (`/api/devices/me`), nur mit [`HelferSitzung`]; die
//!   Schranke der Routenliste steht in `CurrentUser` (`crate::geraet::darf_route`).

use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SichererTransport, SESSION_COOKIE};
use crate::einsatz::kontext::EinsatzLeitungszugriff;
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::geraet::repo::{self as geraet_repo, NeueHelferKopplung};
use crate::geraet::{Funktionsansicht, GeraetKontext, PROVIDER};
use crate::helfer::anmeldung::{self, HelferZielliste, HelferZustand, ZielEingabe};
use crate::helfer::einladung::{self, HelferEinladungAnzeige};
use crate::helfer::{self, HelferAnzeige};
use axum::extract::{FromRequestParts, Query, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use utoipa::ToSchema;

/// Helfer-Übersicht der Leitung: die gültige Einladung (ohne Code) und alle Helfer-Kopplungen.
#[derive(Debug, Serialize, ToSchema)]
pub struct HelferUebersicht {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation: Option<HelferEinladungAnzeige>,
    pub helpers: Vec<HelferAnzeige>,
}

#[derive(Debug, Deserialize)]
pub struct NeueEinladungBody {
    /// Gültigkeit in Minuten; Vorgabe [`einladung::VORGABE_MINUTEN`].
    pub valid_minutes: Option<i64>,
}

/// Prüft „Ortung im Einsatz“ der Organisation (403, wenn aus).
async fn fordere_ortung(state: &AppState, org_id: i64) -> Result<(), AppError> {
    if crate::org::einstellungen::ortung_der_org(&state.pool, org_id)
        .await?
        .im_einsatz
    {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// GET /api/incidents/{id}/helpers — gültige Einladung und Helfer des Einsatzes.
pub async fn uebersicht(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
) -> Result<Json<HelferUebersicht>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(HelferUebersicht {
        invitation: einladung::gueltige(&state.pool, einsatz_id).await?,
        helpers: helfer::liste(&state.pool, einsatz_id).await?,
    }))
}

/// POST /api/incidents/{id}/helpers/invitations — neue Einladung; ersetzt eine gültige alte.
/// 403, wenn die Ortung der Organisation aus ist; 422 bei einer Gültigkeit über 72 h.
pub async fn einladung_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    JsonBody(body): JsonBody<NeueEinladungBody>,
) -> Result<(StatusCode, Json<HelferEinladungAnzeige>), AppError> {
    fordere_ortung(&state, ctx.einsatz.org_id).await?;
    let minuten = einladung::pruefe_minuten(body.valid_minutes)?;
    let einsatz_id = ctx.einsatz.id;
    let von = ctx.benutzer.id;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        einladung::anlegen(conn, einsatz_id, minuten, von).await
    })?;
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// POST /api/incidents/{id}/helpers/invitations/{einladung_id}/revoke — Einladung widerrufen.
/// Angemeldete Helfer betrifft das nicht. Idempotent; fremde Einladung 404.
pub async fn einladung_widerrufen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, einladung_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    crate::write_retry!(&state.pool, |conn| {
        einladung::widerrufen(conn, einsatz_id, einladung_id).await
    })?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Anmelden (öffentlich) ----------

/// Wert von `reason` im 409 des Einlösens mit einer Personensitzung im Cookie. Die Seite zeigt
/// dann „erst abmelden“ (Spec Helfer-App, „Eigenes Konto“).
pub const GRUND_PERSONENSITZUNG: &str = "person_session";

#[derive(Debug, Deserialize)]
pub struct EinloesenBody {
    pub code: String,
    pub display_name: String,
    /// Fehlt das Ziel, ist das 422 wie ein fremdes.
    #[serde(default)]
    pub target: Option<ZielEingabe>,
    /// „Mich als Person orten“; wird still `false`, wenn die Organisation es nicht erlaubt.
    #[serde(default)]
    pub track_person: bool,
}

#[derive(Debug, Deserialize)]
pub struct ZieleQuery {
    pub code: String,
}

/// 429, solange die Adresse nach Fehlversuchen gesperrt ist (wie `/api/devices/pair`).
fn fordere_nicht_gesperrt(peer_ip: Option<IpAddr>) -> Result<(), AppError> {
    match peer_ip {
        Some(ip) if crate::auth::rate_limit::ist_gesperrt(ip) => Err(AppError::TooManyRequests(
            "Zu viele fehlgeschlagene Versuche. Bitte kurz warten.".to_string(),
        )),
        _ => Ok(()),
    }
}

/// Zählt einen Fehlversuch mit ungültigem Code und schreibt ihn ins Anmelde-Audit.
async fn fehlversuch(state: &AppState, peer_ip: Option<IpAddr>) {
    if let Some(ip) = peer_ip {
        crate::auth::rate_limit::fehlversuch(ip, None);
    }
    tracing::warn!(peer_ip = ?peer_ip, "Helfer-Einladung abgewiesen");
    crate::auth::audit::schreibe(
        &state.pool,
        crate::auth::audit::AuditEintrag {
            ereignis: crate::auth::audit::Ereignis::LoginFehlgeschlagen,
            benutzername: None,
            benutzer_id: None,
            peer_ip: peer_ip.map(|ip| ip.to_string()),
            provider: PROVIDER,
        },
    )
    .await;
}

/// Ob das Cookie eine gültige Sitzung eines Personenkontos trägt. Die Sitzung eines Geräts
/// (etwa eines früheren Helfers) zählt nicht: sie bleibt, wie sie ist, das neue Cookie ersetzt
/// sie im Gerät.
async fn ist_personensitzung(state: &AppState, jar: &CookieJar) -> Result<bool, AppError> {
    let Some(cookie) = jar.get(SESSION_COOKIE) else {
        return Ok(false);
    };
    match session::sitzung_aus_token(&state.pool, cookie.value()).await {
        Ok((_, Some(_), _)) | Err(AppError::Unauthorized) => Ok(false),
        Ok((benutzer, None, _)) => {
            Ok(!geraet_repo::ist_geraetekonto(&state.pool, benutzer.id).await?)
        }
        Err(e) => Err(e),
    }
}

/// GET /api/devices/helpers/targets?code=… — Einheiten und Fahrzeuge des Einsatzes der
/// Einladung (Name, Rufname, taktisches Zeichen), keine Personen. Löst den Code nicht ein.
/// 401 bei ungültigem Code, gedrosselt wie das Einlösen.
pub async fn ziele(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    Query(q): Query<ZieleQuery>,
) -> Result<Json<HelferZielliste>, AppError> {
    fordere_nicht_gesperrt(peer_ip)?;
    let (_, einsatz_id, org_id) = match einladung::einladung_pruefen(&state.pool, &q.code).await {
        Ok(t) => t,
        Err(AppError::Unauthorized) => {
            fehlversuch(&state, peer_ip).await;
            return Err(AppError::Unauthorized);
        }
        Err(e) => return Err(e),
    };
    let ortung = crate::org::einstellungen::ortung_der_org(&state.pool, org_id).await?;
    if !ortung.im_einsatz {
        return Err(AppError::Forbidden);
    }
    Ok(Json(HelferZielliste {
        targets: anmeldung::zielliste(&state.pool, einsatz_id).await?,
        person_tracking_allowed: ortung.personen,
    }))
}

/// POST /api/devices/helpers/redeem — löst eine Helfer-Einladung ein: Helfer-Kopplung im Zustand
/// `unbestaetigt` (2 h), Gerätekonto und Sitzung. 201 mit Set-Cookie und [`HelferZustand`].
///
/// 401 Code ungültig (gedrosselt); 403 Ortung der Organisation aus; 409
/// `{reason: "person_session"}` mit einer Personensitzung im Cookie; 422 Ziel fremd oder leer,
/// Name leer oder zu lang. Ein abgewiesenes Einlösen zählt nicht als Einlösung.
pub async fn einloesen(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    SichererTransport(secure): SichererTransport,
    jar: CookieJar,
    JsonBody(body): JsonBody<EinloesenBody>,
) -> Result<Response, AppError> {
    fordere_nicht_gesperrt(peer_ip)?;
    if ist_personensitzung(&state, &jar).await? {
        return Ok((
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "Mit einem persönlichen Konto angemeldet. Bitte erst abmelden.",
                "reason": GRUND_PERSONENSITZUNG,
            })),
        )
            .into_response());
    }
    let anzeigename = anmeldung::pruefe_anzeigename(&body.display_name)?;
    let ip_text = peer_ip.map(|ip| ip.to_string());
    // Die Org-Einstellung vor der Schreibtransaktion lesen: sie liegt auf einer eigenen
    // Verbindung des Pools.
    let ortung = match einladung::einladung_pruefen(&state.pool, &body.code).await {
        Ok((_, _, org_id)) => crate::org::einstellungen::ortung_der_org(&state.pool, org_id).await,
        Err(e) => Err(e),
    };
    let ergebnis = match ortung {
        Ok(o) if !o.im_einsatz => Err(AppError::Forbidden),
        Ok(ortung) => crate::write_retry!(&state.pool, |conn| {
            let (einladung_id, einsatz_id, org_id) =
                einladung::einladung_einloesen(conn, &body.code).await?;
            let ziel = anmeldung::pruefe_ziel(conn, einsatz_id, body.target).await?;
            let einladung_von = einladung::ersteller(conn, einladung_id).await?;
            let neu = geraet_repo::anlegen_helfer(
                conn,
                NeueHelferKopplung {
                    einsatz_id,
                    org_id,
                    einladung_id,
                    einladung_von,
                    anzeigename: &anzeigename,
                    ziel,
                    person_gewuenscht: body.track_person && ortung.personen,
                },
                ip_text.as_deref(),
            )
            .await?;
            let token =
                session::anlegen_geraet(conn, neu.benutzer_id, neu.kopplung_id, &neu.laeuft_ab_at)
                    .await?;
            Ok((neu, token))
        }),
        Err(e) => Err(e),
    };
    let (neu, token) = match ergebnis {
        Ok(wert) => wert,
        Err(AppError::Unauthorized) => {
            fehlversuch(&state, peer_ip).await;
            return Err(AppError::Unauthorized);
        }
        Err(e) => return Err(e),
    };
    tracing::info!(kopplung_id = neu.kopplung_id, peer_ip = ?peer_ip, "Helfer angemeldet");
    crate::auth::audit::schreibe(
        &state.pool,
        crate::auth::audit::AuditEintrag {
            ereignis: crate::auth::audit::Ereignis::LoginOk,
            benutzername: None,
            benutzer_id: Some(neu.benutzer_id),
            peer_ip: ip_text,
            provider: PROVIDER,
        },
    )
    .await;
    let jar = jar.add(crate::routes::auth::session_cookie(token, secure));
    let zustand = anmeldung::zustand(&state.pool, neu.kopplung_id).await?;
    Ok((StatusCode::CREATED, jar, Json(zustand)).into_response())
}

// ---------- Eigener Zustand (Helfer-Sitzung) ----------

/// Extractor: eine gültige Sitzung einer Helfer-Kopplung. Zieht [`CurrentUser`] (Sitzung,
/// Routenliste der Ansicht); jede andere Sitzung, auch eine Person, ist 403.
pub struct HelferSitzung(pub GeraetKontext);

impl FromRequestParts<AppState> for HelferSitzung {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        CurrentUser::from_request_parts(parts, state).await?;
        match parts.extensions.get::<GeraetKontext>() {
            Some(g) if g.ansicht == Funktionsansicht::Helfer => Ok(HelferSitzung(g.clone())),
            _ => Err(AppError::Forbidden),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ZielAendernBody {
    #[serde(default)]
    pub target: Option<ZielEingabe>,
}

/// GET /api/devices/me — der eigene Zustand der Helfer-Kopplung. Nach dem Ende ist die Sitzung
/// ungültig (401).
pub async fn zustand(
    State(state): State<AppState>,
    HelferSitzung(g): HelferSitzung,
) -> Result<Json<HelferZustand>, AppError> {
    Ok(Json(anmeldung::zustand(&state.pool, g.kopplung_id).await?))
}

/// PUT /api/devices/me — Ziel ändern, nur im Zustand `unbestaetigt` (sonst 409); 422 bei einem
/// fremden oder fehlenden Ziel.
pub async fn ziel_aendern(
    State(state): State<AppState>,
    HelferSitzung(g): HelferSitzung,
    JsonBody(body): JsonBody<ZielAendernBody>,
) -> Result<Json<HelferZustand>, AppError> {
    crate::write_retry!(&state.pool, |conn| {
        let ziel = anmeldung::pruefe_ziel(conn, g.einsatz_id, body.target).await?;
        geraet_repo::helfer_ziel_setzen(conn, g.kopplung_id, ziel).await
    })?;
    Ok(Json(anmeldung::zustand(&state.pool, g.kopplung_id).await?))
}
