//! Anmeldung eines Fremdsystems an der öffentlichen API (LLH-1652, ADR-0022, Spec
//! `maschinenzugang`, design.md D3, D8): der Extractor [`MachineClient`].
//!
//! Jede Anfrage trägt `Authorization: Machine <jws>` (Profil `signatur::MACHINE`). Geprüft wird
//! vor dem Handler, in dieser Reihenfolge: Sperre der Quelle, Kopf, Zugang, Body, Signatur und
//! Bindung, Zustand, Drosselung, Wiederholung, Scope. Jede gescheiterte Anmeldung antwortet 401
//! ohne Grund; der Grund steht am Zugang (Seite „Anbindungen“), sofern der Zugang bekannt ist.

use super::drossel;
use super::error::{ApiError, ErrorCode};
use super::scope::{AblehnungGrund, Scope, ZugangZustand};
use super::zugang::{self, Zugang};
use crate::app::AppState;
use crate::auth::rate_limit;
use crate::extract::PeerIp;
use crate::instanz::identitaet::{self, parse_oeffentlich, Identitaet};
use crate::instanz::signatur::{self, MachineAblehnung, MachineAnfrage, MACHINE, UHR_TOLERANZ_S};
use axum::body::Bytes;
use axum::extract::{FromRequest, FromRequestParts, MatchedPath, Request};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{TimeZone, Utc};
use serde::Serialize;

/// Was eine Route an Rechten verlangt. Jede Route mit [`MachineClient`] trägt genau eine davon als
/// Request-Extension (per `.layer(Extension(…))` am `routes!`); fehlt sie, lehnt der Extractor mit
/// 500 ab statt die Route offen zu lassen (design.md D8, fail closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopeAnforderung {
    /// Jeder angemeldete Zugang (etwa `GET /api/v1/me`).
    Keine,
    Scope(Scope),
}

/// Ein angemeldetes Fremdsystem.
#[derive(Debug)]
pub struct MachineClient {
    pub zugang: Zugang,
    pub claims: MachineAnfrage,
    pub body: Bytes,
    /// Serverzeit minus `iat` der Anfrage in Sekunden: positiv, wenn die Uhr des Fremdsystems
    /// nachgeht.
    pub clock_offset_s: i64,
    identitaet: Identitaet,
}

impl MachineClient {
    /// JSON-Antwort mit Antwortsignatur im Kopf `Lifeline-Signature` (design.md D3): an diesen
    /// Zugang gerichtet und über `req` an die `jti` der Anfrage gebunden.
    pub fn antwort<T: Serialize>(&self, status: StatusCode, wert: &T) -> Response {
        let body = serde_json::to_vec(wert).expect("Antwort ist serialisierbar");
        let signatur = signatur::sign_machine_antwort(
            &self.identitaet,
            &self.zugang.id,
            &self.claims.jti,
            status.as_u16(),
            &body,
            Utc::now().timestamp(),
        );
        let mut resp = (
            status,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            body,
        )
            .into_response();
        if let Ok(wert) = HeaderValue::from_str(&signatur) {
            resp.headers_mut().insert(MACHINE.antwort_kopf, wert);
        }
        resp
    }
}

/// Höchstlänge einer `jti`; sie landet in `maschine_jti`.
pub const JTI_MAX: usize = 64;

/// Liest den `kid` aus dem Kopf eines Tokens, ohne `alg` und `typ` zu prüfen. Nur, um einem
/// bekannten Zugang den Grund einer Ablehnung zuzuordnen; geprüft wird damit nichts.
fn kid_ohne_pruefung(token: &str) -> Option<String> {
    let teil = token.split('.').next()?;
    if teil.len() > 1024 {
        return None;
    }
    let bytes = crate::instanz::basis32::parse_b64(teil)?;
    let wert: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    wert.get("kid")?.as_str().map(str::to_string)
}

fn unauthorized() -> Response {
    ApiError::new(ErrorCode::Unauthorized, "Anmeldung fehlgeschlagen").into_response()
}

fn rate_limited(retry_after_s: u64) -> Response {
    ApiError::rate_limited(retry_after_s).into_response()
}

fn intern(e: impl std::fmt::Display) -> Response {
    tracing::error!("Maschinenzugang: {e}");
    ApiError::from_code(ErrorCode::InternalError).into_response()
}

/// Lehnt eine Anfrage eines bekannten Zugangs ab und hält den Grund am Zugang fest.
async fn ablehnen(
    state: &AppState,
    zugang: &Zugang,
    grund: AblehnungGrund,
    abweichung_s: Option<i64>,
) -> Response {
    tracing::info!(zugang = %zugang.id, grund = grund.as_str(), "Anfrage eines Fremdsystems abgelehnt");
    if let Err(e) = zugang::ablehnung_festhalten(
        &state.pool,
        &zugang.id,
        grund,
        abweichung_s,
        &crate::zeit::jetzt(),
    )
    .await
    {
        tracing::warn!("Ablehnungsgrund nicht gespeichert: {e}");
    }
    unauthorized()
}

/// Prüft das Token gegen den bereitstehenden neuen Schlüssel, dann gegen den gebundenen. Liefert
/// die Claims und, falls der neue Schlüssel gilt, ihn zum Übernehmen.
fn verify_mit_schluesseln(
    zugang: &Zugang,
    token: &str,
    eigene: &str,
    methode: &str,
    pfad: &str,
    body: &[u8],
    jetzt: i64,
) -> Result<(MachineAnfrage, Option<String>), MachineAblehnung> {
    let mut letzter = MachineAblehnung {
        fehler: signatur::SignaturError::Signatur,
        abweichung_s: None,
    };
    let kandidaten = [
        (zugang.schluessel_neu.as_deref(), true),
        (zugang.schluessel.as_deref(), false),
    ];
    for (schluessel, ist_neu) in kandidaten {
        let Some(text) = schluessel else { continue };
        let Some(key) = parse_oeffentlich(text) else {
            continue;
        };
        match signatur::verify_machine_anfrage(
            token, &key, &zugang.id, eigene, methode, pfad, body, jetzt,
        ) {
            Ok(c) => return Ok((c, ist_neu.then(|| text.to_string()))),
            // Ein Fehler hinter der Signatur ist aussagekräftiger als „Signatur“ eines anderen
            // Schlüssels: er behält Vorrang.
            Err(a) if a.fehler != signatur::SignaturError::Signatur => letzter = a,
            Err(a) if letzter.fehler == signatur::SignaturError::Signatur => letzter = a,
            Err(_) => {}
        }
    }
    Err(letzter)
}

impl FromRequest<AppState> for MachineClient {
    type Rejection = Response;

    async fn from_request(req: Request, state: &AppState) -> Result<Self, Self::Rejection> {
        let (mut parts, body) = req.into_parts();
        let PeerIp(peer_ip) = match PeerIp::from_request_parts(&mut parts, state).await {
            Ok(p) => p,
            Err(never) => match never {},
        };

        // 1. Quelle gesperrt (Zähler für Maschinen, nie die Anmeldesperre).
        if let Some(ip) = peer_ip {
            if let rate_limit::Sperre::Gesperrt { zeile } = rate_limit::maschine::sperre(ip) {
                if let Some(still) = zeile {
                    tracing::warn!(%ip, still, "Maschinenwege für diese Quelle gesperrt");
                }
                return Err(rate_limited(60));
            }
        }

        // 2. Kopf und Token.
        let Some(token) = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix(MACHINE.schema))
            .and_then(|v| v.strip_prefix(' '))
            .map(str::to_string)
        else {
            return Err(unauthorized());
        };
        // Bei falschem `alg` oder `typ` den `kid` trotzdem lesen: ein bekannter Zugang bekommt
        // dann seinen Grund („form“), ein unbekannter zählt wie jeder unbekannte.
        let (kid, kopf_gilt) = match signatur::parse_kopf(&token, MACHINE.typ_anfrage) {
            Ok(kopf) => (kopf.kid, true),
            Err(_) => match kid_ohne_pruefung(&token) {
                Some(kid) => (kid, false),
                None => return Err(unauthorized()),
            },
        };

        // 3. Zugang.
        let geladen = {
            let mut conn = state.pool.acquire().await.map_err(intern)?;
            zugang::laden(&mut conn, &kid).await.map_err(intern)?
        };
        let Some(zugang) = geladen else {
            if let Some(ip) = peer_ip {
                rate_limit::maschine::fehlversuch(ip);
            }
            tracing::debug!(kid = %kid, "Anfrage mit unbekanntem Maschinenzugang");
            return Err(unauthorized());
        };
        if !kopf_gilt {
            return Err(ablehnen(state, &zugang, AblehnungGrund::Form, None).await);
        }

        // 4. Body, höchstens bis zur Grenze der öffentlichen API.
        let body = axum::body::to_bytes(body, crate::app::PUBLIC_API_BODY_MAX)
            .await
            .map_err(|_| ApiError::from_code(ErrorCode::PayloadTooLarge).into_response())?;

        // 5. Signatur und Bindung an Instanz, Methode, Pfad, Body und Zeit.
        let identitaet = identitaet::load_or_create(&state.pool)
            .await
            .map_err(intern)?;
        let pfad = parts
            .uri
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or_else(|| parts.uri.path())
            .to_string();
        let jetzt = Utc::now().timestamp();
        let (claims, neuer_schluessel) = match verify_mit_schluesseln(
            &zugang,
            &token,
            &identitaet.kennung,
            parts.method.as_str(),
            &pfad,
            &body,
            jetzt,
        ) {
            Ok(x) => x,
            Err(a) => {
                let grund = if zugang.schluessel.is_none() && zugang.schluessel_neu.is_none() {
                    AblehnungGrund::KeinSchluessel
                } else {
                    AblehnungGrund::aus_signatur(&a.fehler)
                };
                return Err(ablehnen(state, &zugang, grund, a.abweichung_s).await);
            }
        };

        // Die `jti` wird gespeichert: höchstens 64 Zeichen (Referenz-Clients: 22).
        if claims.jti.is_empty() || claims.jti.len() > JTI_MAX {
            return Err(ablehnen(state, &zugang, AblehnungGrund::Form, None).await);
        }

        // 6. Zustand: aktiv, nicht abgelaufen, Org nicht meldend gekoppelt.
        let jetzt_text = crate::zeit::jetzt();
        if zugang.zustand == ZugangZustand::Widerrufen {
            return Err(ablehnen(state, &zugang, AblehnungGrund::Widerrufen, None).await);
        }
        if zugang.is_abgelaufen(&jetzt_text) {
            return Err(ablehnen(state, &zugang, AblehnungGrund::Abgelaufen, None).await);
        }
        let hub = {
            let mut conn = state.pool.acquire().await.map_err(intern)?;
            zugang::hub_fuer_org(&mut conn, zugang.org_id)
                .await
                .map_err(intern)?
        };
        if hub.is_some() {
            return Err(ablehnen(state, &zugang, AblehnungGrund::InstanzGekoppelt, None).await);
        }

        // 7. Drosselung je Zugang, vor dem Wiederholschutz: eine gedrosselte Anfrage verbraucht
        // ihre `jti` nicht.
        if let Err(warten) = drossel::try_take(&zugang.id) {
            return Err(rate_limited(drossel::retry_after_s(warten)));
        }

        // 8. Wiederholung.
        let Some(bis) = Utc
            .timestamp_opt(claims.exp.saturating_add(UHR_TOLERANZ_S), 0)
            .single()
            .map(crate::zeit::formatiere_utc)
        else {
            return Err(ablehnen(state, &zugang, AblehnungGrund::Uhr, None).await);
        };
        if !zugang::remember_jti(&state.pool, &zugang.id, &claims.jti, &bis)
            .await
            .map_err(intern)?
        {
            return Err(ablehnen(state, &zugang, AblehnungGrund::Wiederholung, None).await);
        }
        if let Some(neu) = neuer_schluessel {
            zugang::schluessel_neu_uebernehmen(&state.pool, &zugang.id, &neu)
                .await
                .map_err(intern)?;
        }

        // 9. Scope der Route; ohne Angabe fail closed.
        match parts.extensions.get::<ScopeAnforderung>().copied() {
            None => {
                return Err(intern(format!(
                    "Route ohne Scope-Angabe: {}",
                    parts.uri.path()
                )))
            }
            Some(ScopeAnforderung::Scope(s)) if !zugang.has_scope(s) => {
                return Err(ApiError::new(
                    ErrorCode::MissingScope,
                    format!("Dem Zugang fehlt das Recht „{}“.", s.as_str()),
                )
                .into_response());
            }
            Some(_) => {}
        }

        // 10. Abruf zählen (Routen-Vorlage, nie der konkrete Pfad).
        let route = parts
            .extensions
            .get::<MatchedPath>()
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| parts.uri.path().to_string());
        if let Err(e) = zugang::abruf_zaehlen(&state.pool, &zugang.id, &route, &jetzt_text).await {
            tracing::warn!("Abruf eines Maschinenzugangs nicht gezählt: {e}");
        }

        Ok(MachineClient {
            clock_offset_s: jetzt.saturating_sub(claims.iat),
            zugang,
            claims,
            body,
            identitaet,
        })
    }
}
