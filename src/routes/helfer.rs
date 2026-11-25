//! Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, ADR-0098).
//!
//! - Routen der Leitung am Einsatz unter `/api/incidents/{id}/helpers…`. Recht wie beim Koppeln:
//!   [`EinsatzLeitungszugriff`] (Einsatzleitung, nur aktiver Einsatz). Der Pfadparameter heißt
//!   `{id}`, weil `EinsatzKontext` den Einsatz unter diesem Namen liest.
//! - Öffentliche Wege der App vor der Anmeldung: Zielliste und Einlösen
//!   (`/api/devices/helpers/…`), gedrosselt wie `/api/devices/pair`.
//! - Bestätigen, Ablehnen, Abmelden und Verlängern durch die Leitung
//!   (`/api/incidents/{id}/helpers/{gid}/…`, `…/helpers/revoke` für alle).
//! - Der eigene Zustand der Helfer-Kopplung (`/api/devices/me`) und das Senden der Position
//!   (`/api/devices/me/position`), nur mit [`HelferSitzung`]; die Schranke der Routenliste steht
//!   in `CurrentUser` (`crate::geraet::darf_route`).
//! - Jede Änderung an einer Helfer-Kopplung meldet `helfer` an die Einsatzleitung
//!   (`LiveHub::publiziere_helfer`), nur mit Kennungen.

use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SichererTransport, SESSION_COOKIE};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::EinsatzLeitungszugriff;
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::geraet::repo::{self as geraet_repo, NeueHelferKopplung};
use crate::geraet::{Funktionsansicht, GeraetKontext, PROVIDER};
use crate::helfer::anmeldung::{self, HelferZielliste, HelferZustand, ZielEingabe};
use crate::helfer::bestaetigung::{self, Bestaetigt, Bestaetigung};
use crate::helfer::einladung::{self, HelferEinladungAnzeige};
use crate::helfer::position::{self, Abweisung};
use crate::helfer::{self, HelferAnzeige};
use crate::ortung::{self, Ortungsziel};
use axum::extract::{FromRequestParts, State};
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
    /// „Ortung im Einsatz“ der Organisation; aus: keine Einladung möglich.
    pub tracking_enabled: bool,
    /// „Auch Personen orten“ der Organisation; die Leitung ordnet nur dann Personen zu.
    pub person_tracking_allowed: bool,
}

/// Baut die Übersicht eines Einsatzes samt Ortungsfreigabe der Organisation.
async fn baue_uebersicht(
    state: &AppState,
    einsatz_id: i64,
    org_id: i64,
) -> Result<HelferUebersicht, AppError> {
    let ortung = crate::org::einstellungen::ortung_der_org(&state.pool, org_id).await?;
    Ok(HelferUebersicht {
        invitation: einladung::gueltige(&state.pool, einsatz_id).await?,
        helpers: helfer::liste(&state.pool, einsatz_id).await?,
        tracking_enabled: ortung.im_einsatz,
        person_tracking_allowed: ortung.personen,
    })
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
    Ok(Json(
        baue_uebersicht(&state, einsatz_id, ctx.einsatz.org_id).await?,
    ))
}

/// POST /api/incidents/{id}/helpers/invitations — neue Einladung; ersetzt eine gültige alte.
/// 403, wenn die Ortung der Organisation aus ist; 400 bei einer Gültigkeit über 72 h; 409 an
/// einem Spiegel.
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
    /// Pflicht; fehlt es, ist das 400 (ein fremdes 422).
    #[serde(default)]
    pub target: Option<ZielEingabe>,
    /// „Mich als Person orten“; wird still `false`, wenn die Organisation es nicht erlaubt.
    #[serde(default)]
    pub track_person: bool,
}

/// Body von `POST /api/devices/helpers/targets`: der Code steht im Body, nicht in der Adresse,
/// damit er in keinem Zugriffsprotokoll landet (Spec „Scannen“: er steht im Fragment).
#[derive(Debug, Deserialize)]
pub struct ZieleBody {
    pub code: String,
}

/// Wert von `reason` im 422, wenn die Einladung [`einladung::EINLOESUNGEN_MAX`] erreicht hat.
pub const GRUND_EINLADUNG_AUSGESCHOEPFT: &str = "invitation_exhausted";

/// Die ausgeschöpfte Einladung als 422 mit Grund; jeder andere Fehler bleibt, wie er ist.
fn ausgeschoepft(e: AppError) -> Result<Response, AppError> {
    match e {
        AppError::UnprocessableEntity(m) if m == einladung::AUSGESCHOEPFT => Ok(abgewiesen(
            StatusCode::UNPROCESSABLE_ENTITY,
            &m,
            GRUND_EINLADUNG_AUSGESCHOEPFT,
        )),
        e => Err(e),
    }
}

/// 429, solange die Quelle ihre gelungenen Einlösungen im Fenster aufgebraucht hat
/// (`rate_limit::helfer_einloesung`).
fn fordere_einloesung_frei(peer_ip: Option<IpAddr>) -> Result<(), AppError> {
    match peer_ip {
        Some(ip) if crate::auth::rate_limit::helfer_einloesung::ist_gesperrt(ip) => {
            Err(AppError::TooManyRequests(
                "Zu viele Anmeldungen von dieser Adresse. Bitte später erneut versuchen.".into(),
            ))
        }
        _ => Ok(()),
    }
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

/// Welche Sitzung das Cookie beim Einlösen trägt.
enum AlteSitzung {
    /// Keine gültige, oder die eines anderen Geräts: sie bleibt, wie sie ist, das neue Cookie
    /// ersetzt sie im Gerät.
    Keine,
    /// Ein Personenkonto (409 `person_session`).
    Person,
    /// Eine laufende Helfer-Kopplung dieses Geräts: das neue Einlösen meldet sie ab, sonst hielte
    /// sie ihren Platz als Ortungsgerät und ihre Person bis zum Ablauf fest.
    Helfer(GeraetKontext, i64),
}

async fn alte_sitzung(state: &AppState, jar: &CookieJar) -> Result<AlteSitzung, AppError> {
    let Some(cookie) = jar.get(SESSION_COOKIE) else {
        return Ok(AlteSitzung::Keine);
    };
    match session::sitzung_aus_token(&state.pool, cookie.value()).await {
        Ok((benutzer, Some(g), _)) if g.ansicht == Funktionsansicht::Helfer => {
            Ok(AlteSitzung::Helfer(g, benutzer.id))
        }
        Ok((_, Some(_), _)) | Err(AppError::Unauthorized) => Ok(AlteSitzung::Keine),
        Ok((benutzer, None, _)) => Ok(
            if geraet_repo::ist_geraetekonto(&state.pool, benutzer.id).await? {
                AlteSitzung::Keine
            } else {
                AlteSitzung::Person
            },
        ),
        Err(e) => Err(e),
    }
}

/// POST /api/devices/helpers/targets `{code}` — Einheiten und Fahrzeuge des Einsatzes der
/// Einladung (Name, Rufname, taktisches Zeichen), keine Personen. Löst den Code nicht ein.
/// 401 bei ungültigem Code, gedrosselt wie das Einlösen; 422 `{reason: "invitation_exhausted"}`.
pub async fn ziele(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<ZieleBody>,
) -> Result<Response, AppError> {
    fordere_nicht_gesperrt(peer_ip)?;
    let (_, einsatz_id, org_id) = match einladung::einladung_pruefen(&state.pool, &body.code).await
    {
        Ok(t) => t,
        Err(AppError::Unauthorized) => {
            fehlversuch(&state, peer_ip).await;
            return Err(AppError::Unauthorized);
        }
        Err(e) => return ausgeschoepft(e),
    };
    let ortung = crate::org::einstellungen::ortung_der_org(&state.pool, org_id).await?;
    if !ortung.im_einsatz {
        return Err(AppError::Forbidden);
    }
    Ok(Json(HelferZielliste {
        targets: anmeldung::zielliste(&state.pool, einsatz_id).await?,
        person_tracking_allowed: ortung.personen,
    })
    .into_response())
}

/// POST /api/devices/helpers/redeem — löst eine Helfer-Einladung ein: Helfer-Kopplung im Zustand
/// `unbestaetigt` (2 h), Gerätekonto und Sitzung. 201 mit Set-Cookie und [`HelferZustand`].
///
/// 401 Code ungültig (gedrosselt); 403 Ortung der Organisation aus; 409
/// `{reason: "person_session"}` mit einer Personensitzung im Cookie; 400 Name leer oder zu lang,
/// Ziel fehlt; 422 Ziel fremd, `{reason: "invitation_exhausted"}` Einladung ausgeschöpft; 429
/// gesperrt (Fehlversuche) oder zu viele Einlösungen der Quelle. Ein abgewiesenes Einlösen zählt
/// nicht als Einlösung.
pub async fn einloesen(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    SichererTransport(secure): SichererTransport,
    jar: CookieJar,
    JsonBody(body): JsonBody<EinloesenBody>,
) -> Result<Response, AppError> {
    fordere_nicht_gesperrt(peer_ip)?;
    fordere_einloesung_frei(peer_ip)?;
    let alt = alte_sitzung(&state, &jar).await?;
    if matches!(alt, AlteSitzung::Person) {
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
            let abgemeldet = match &alt {
                AlteSitzung::Helfer(g, konto) => abmelden_tx(conn, g, *konto).await?,
                AlteSitzung::Keine | AlteSitzung::Person => None,
            };
            Ok((neu, token, einsatz_id, abgemeldet))
        }),
        Err(e) => Err(e),
    };
    let (neu, token, einsatz_id, abgemeldet) = match ergebnis {
        Ok(wert) => wert,
        Err(AppError::Unauthorized) => {
            fehlversuch(&state, peer_ip).await;
            return Err(AppError::Unauthorized);
        }
        Err(e) => return ausgeschoepft(e),
    };
    if let Some(ip) = peer_ip {
        crate::auth::rate_limit::helfer_einloesung::vermerke(ip);
    }
    if let Some(a) = &abgemeldet {
        melde_abgemeldet(&state, a);
    }
    tracing::info!(kopplung_id = neu.kopplung_id, peer_ip = ?peer_ip, "Helfer angemeldet");
    state.live.publiziere_helfer(einsatz_id, neu.kopplung_id);
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

/// PUT /api/devices/me — Ziel ändern, nur im Zustand `unbestaetigt` (sonst 409); 400 ohne Ziel,
/// 422 bei einem fremden.
pub async fn ziel_aendern(
    State(state): State<AppState>,
    HelferSitzung(g): HelferSitzung,
    JsonBody(body): JsonBody<ZielAendernBody>,
) -> Result<Json<HelferZustand>, AppError> {
    crate::write_retry!(&state.pool, |conn| {
        let ziel = anmeldung::pruefe_ziel(conn, g.einsatz_id, body.target).await?;
        geraet_repo::helfer_ziel_setzen(conn, g.kopplung_id, ziel).await
    })?;
    state.live.publiziere_helfer(g.einsatz_id, g.kopplung_id);
    Ok(Json(anmeldung::zustand(&state.pool, g.kopplung_id).await?))
}

// ---------- Position senden (Helfer-Sitzung) ----------

/// Wert von `reason` im 403 einer Sendung, wenn „Ortung im Einsatz“ der Organisation aus ist.
pub const GRUND_ORTUNG_AUS: &str = "tracking_off";

/// Body von `PUT /api/devices/me/position`: eine Position (`lat`, `lon`, `recorded_at`) oder
/// `paused`.
#[derive(Debug, Deserialize)]
pub struct PositionBody {
    #[serde(default)]
    pub lat: Option<f64>,
    #[serde(default)]
    pub lon: Option<f64>,
    /// Genauigkeit in Metern; angenommen, aber nicht gespeichert.
    #[serde(default)]
    pub accuracy_m: Option<f64>,
    /// Zeitpunkt der Messung am Gerät, RFC 3339.
    #[serde(default)]
    pub recorded_at: Option<String>,
    /// `true` pausiert die Ortung, `false` setzt sie fort; dann ohne Koordinate.
    #[serde(default)]
    pub paused: Option<bool>,
}

/// Antwort von `PUT /api/devices/me/position`.
#[derive(Debug, Serialize, ToSchema)]
pub struct PositionAntwort {
    /// Mindestens ein Ziel hat die Position übernommen; `false` bei einer älteren als der
    /// gespeicherten, während einer Pause und beim Pausieren selbst.
    pub stored: bool,
    /// Uhrzeit des Servers (UTC, `%Y-%m-%d %H:%M:%S`).
    pub server_time: String,
}

/// Abweisung mit Grund (`{error, reason}`), wie `tracker_taken` beim Bestätigen.
fn abgewiesen(status: StatusCode, meldung: &str, grund: &str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": meldung, "reason": grund })),
    )
        .into_response()
}

/// Prüft eine Position vor der Transaktion: ein fehlendes Feld und ein Zeitpunkt, der kein
/// RFC 3339 ist, sind 400 (das Feld für sich, `src/AGENTS.md`, Statuscode-Konvention); eine
/// Koordinate außerhalb des Bereichs ist 422 (`pruefe_koordinate`, Spec „Fehlerwerte“).
fn pruefe_position(body: &PositionBody) -> Result<(f64, f64, String), AppError> {
    let (Some(lat), Some(lon), Some(zeitpunkt)) = (body.lat, body.lon, body.recorded_at.as_deref())
    else {
        return Err(AppError::Validation(
            "Erwartet lat, lon und recorded_at oder paused".into(),
        ));
    };
    chrono::DateTime::parse_from_rfc3339(zeitpunkt).map_err(|_| {
        AppError::Validation("recorded_at muss ein Zeitpunkt nach RFC 3339 sein".into())
    })?;
    crate::routes::support::pruefe_koordinate(Some(lat), Some(lon), "lat", "lon")?;
    Ok((lat, lon, zeitpunkt.to_string()))
}

/// PUT /api/devices/me/position — die Helfer-App sendet ihre Position oder pausiert.
///
/// - 200 `{stored, server_time}`; geschrieben wird an das Ziel nur als Ortungsgerät, an die
///   Person nur mit Zuordnung und „Auch Personen orten“ (Quelle `helfer`, Zeitpunkt geklemmt).
/// - `{paused: true}` setzt `pausiert_at` und löscht die Personenposition, `{paused: false}`
///   setzt fort.
/// - 401 Sitzung ungültig (beendet, Einsatz beendet); 403 `{reason: "tracking_off"}` Ortung der
///   Organisation aus, `"no_role"` weder Ortungsgerät noch Person, `"target_removed"` Ziel
///   aufgelöst oder weg; 409 `{reason: "unconfirmed"}` noch nicht bestätigt, nichts gespeichert;
///   400 Feld fehlt oder Zeitpunkt kein RFC 3339; 422 Koordinate außerhalb des Bereichs.
pub async fn position_senden(
    State(state): State<AppState>,
    HelferSitzung(g): HelferSitzung,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Response, AppError> {
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(g.einsatz_id)
        .fetch_one(&state.pool)
        .await?;
    // Vor der Schreibtransaktion: die Org-Einstellung liegt auf einer eigenen Verbindung.
    let ortung = crate::org::einstellungen::ortung_der_org(&state.pool, org_id).await?;
    if !ortung.im_einsatz {
        return Ok(abgewiesen(
            StatusCode::FORBIDDEN,
            "Die Ortung ist für diese Organisation ausgeschaltet",
            GRUND_ORTUNG_AUS,
        ));
    }
    let einsatz_id = g.einsatz_id;
    let kopplung_id = g.kopplung_id;
    let antwort = |stored| {
        Json(PositionAntwort {
            stored,
            server_time: crate::zeit::jetzt(),
        })
        .into_response()
    };

    if let Some(pausiert) = body.paused {
        let person = crate::write_retry!(&state.pool, |conn| {
            position::pausieren(conn, kopplung_id, pausiert).await
        })?;
        state.live.publiziere_helfer(einsatz_id, kopplung_id);
        if let Some(pid) = person {
            ortung::publiziere(&state, einsatz_id, Ortungsziel::Person(pid));
        }
        return Ok(antwort(false));
    }

    let (lat, lon, zeitpunkt) = pruefe_position(&body)?;
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        position::senden(
            conn,
            einsatz_id,
            kopplung_id,
            ortung.personen,
            lat,
            lon,
            &zeitpunkt,
        )
        .await
    })?;
    let gesendet = match ergebnis {
        Ok(gesendet) => gesendet,
        Err(a @ Abweisung::Unbestaetigt) => {
            return Ok(abgewiesen(
                StatusCode::CONFLICT,
                "Die Leitung hat die Anmeldung noch nicht bestätigt",
                a.grund(),
            ))
        }
        Err(a @ Abweisung::KeineRolle) => {
            return Ok(abgewiesen(
                StatusCode::FORBIDDEN,
                "Dieses Gerät ortet weder ein Ziel noch eine Person",
                a.grund(),
            ))
        }
        Err(a @ Abweisung::ZielEntfernt) => {
            return Ok(abgewiesen(
                StatusCode::FORBIDDEN,
                "Das Ziel gibt es nicht mehr",
                a.grund(),
            ))
        }
    };
    for ziel in &gesendet.geaendert {
        ortung::publiziere(&state, einsatz_id, *ziel);
    }
    if gesendet.gespeichert {
        state
            .live
            .publiziere_helfer_position(einsatz_id, kopplung_id);
    }
    Ok(antwort(gesendet.gespeichert))
}

// ---------- Bestätigen, Ablehnen, Entfernen (Leitung) ----------

/// Wert von `reason` im 409 des Bestätigens, wenn das Ziel schon ein Ortungsgerät hat; `holder`
/// nennt dessen Kopplung (Spec Helfer-App, „Ein Ortungsgerät je Ziel“).
pub const GRUND_ORTUNGSGERAET_BELEGT: &str = "tracker_taken";

/// Wert von `reason` im 422 des Bestätigens mit Person, wenn die Kraft „Mich als Person orten“
/// nicht gewählt hat (Spec Helfer-App, „Bestätigen“: die Einwilligung der Kraft gilt).
pub const GRUND_PERSON_NICHT_GEWUENSCHT: &str = "person_not_requested";

/// Warum das Bestätigen nichts geschrieben hat.
enum NichtBestaetigt {
    Belegt(i64),
    PersonNichtGewuenscht,
}

#[derive(Debug, Deserialize)]
pub struct BestaetigenBody {
    /// Korrigiertes Ziel; fehlt es, bleibt das gewählte.
    #[serde(default)]
    pub target: Option<ZielEingabe>,
    /// Kraft in `einsatz_personal`; nur mit „Auch Personen orten“ der Organisation.
    #[serde(default)]
    pub person_id: Option<i64>,
    pub is_tracker: bool,
    /// Das bisherige Ortungsgerät des Ziels verliert die Rolle an diesen Helfer.
    #[serde(default)]
    pub replace: bool,
}

/// POST /api/incidents/{id}/helpers/{gid}/confirm — bestätigt einen wartenden Helfer (`aktiv`,
/// 72 h ab jetzt) oder ändert Ziel, Person und Ortungsrolle eines aktiven. ETB-Eintrag.
///
/// 404 fremd; 409 abgelehnt oder beendet, oder `{reason: "tracker_taken", holder}`, wenn das Ziel
/// schon ein Ortungsgerät hat und `replace` fehlt; 422 Ziel oder Person fremd, Person ohne
/// Personenortung der Organisation, `{reason: "person_not_requested"}` Person, obwohl die Kraft
/// keine Personenortung gewählt hat.
pub async fn bestaetigen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, kopplung_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<BestaetigenBody>,
) -> Result<Response, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let personen_erlaubt =
        crate::org::einstellungen::ortung_der_org(&state.pool, ctx.einsatz.org_id)
            .await?
            .personen;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let von = ctx.benutzer.id;
    let leitung = &ctx.benutzer.anzeigename;
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        let stand = bestaetigung::stand(conn, einsatz_id, kopplung_id).await?;
        let ziel = match body.target {
            Some(t) => anmeldung::pruefe_ziel(conn, einsatz_id, Some(t)).await?,
            None => stand.ziel().ok_or_else(|| {
                AppError::UnprocessableEntity("Bitte eine Einheit oder ein Fahrzeug wählen".into())
            })?,
        };
        let eingabe = Bestaetigung {
            ziel,
            person_id: body.person_id,
            personen_erlaubt,
            ortungsgeraet: body.is_tracker,
            ersetzen: body.replace,
            von,
        };
        match bestaetigung::bestaetigen(conn, &stand, eingabe).await? {
            Bestaetigt::Belegt { halter } => Ok(Err(NichtBestaetigt::Belegt(halter))),
            Bestaetigt::PersonNichtGewuenscht => Ok(Err(NichtBestaetigt::PersonNichtGewuenscht)),
            Bestaetigt::Ja {
                erstmals,
                ziel_name,
                person_name,
                ersetzt,
                alte_person,
            } => {
                let text = bestaetigung::etb_text(
                    &stand.anzeigename,
                    leitung,
                    erstmals,
                    &ziel_name,
                    person_name.as_deref(),
                    body.is_tracker,
                    ersetzt.as_deref(),
                );
                let etb_id =
                    crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await?;
                Ok(Ok((etb_id, alte_person)))
            }
        }
    })?;
    let (etb_id, alte_person) = match ergebnis {
        Ok(wert) => wert,
        Err(NichtBestaetigt::Belegt(halter)) => {
            return Ok((
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "error": "Das Ziel hat schon ein Ortungsgerät",
                    "reason": GRUND_ORTUNGSGERAET_BELEGT,
                    "holder": halter,
                })),
            )
                .into_response())
        }
        Err(NichtBestaetigt::PersonNichtGewuenscht) => {
            return Ok(abgewiesen(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Die Kraft hat keine Ortung als Person gewählt",
                GRUND_PERSON_NICHT_GEWUENSCHT,
            ))
        }
    };
    state.live.publiziere(einsatz_id, etb_id);
    state.live.publiziere_helfer(einsatz_id, kopplung_id);
    if let Some(pid) = alte_person {
        ortung::publiziere(&state, einsatz_id, Ortungsziel::Person(pid));
    }
    Ok(Json(helfer::laden(&state.pool, einsatz_id, kopplung_id).await?).into_response())
}

/// POST /api/incidents/{id}/helpers/{gid}/reject — lehnt einen wartenden Helfer ab: `abgelehnt`,
/// Sitzungen weg, ETB-Eintrag. 404 fremd; 409, wenn er nicht mehr wartet.
pub async fn ablehnen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, kopplung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<HelferAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let von = ctx.benutzer.id;
    let leitung = &ctx.benutzer.anzeigename;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        let stand = bestaetigung::stand(conn, einsatz_id, kopplung_id).await?;
        if !geraet_repo::helfer_ablehnen(conn, kopplung_id, von).await? {
            return Err(AppError::Conflict(
                "Nur eine wartende Anmeldung lässt sich ablehnen".into(),
            ));
        }
        let text = format!("Helfer „{}“ abgelehnt von {leitung}.", stand.anzeigename);
        crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await
    })?;
    state.live.melde_kopplung_ende(kopplung_id);
    state.live.publiziere(einsatz_id, etb_id);
    state.live.publiziere_helfer(einsatz_id, kopplung_id);
    Ok(Json(
        helfer::laden(&state.pool, einsatz_id, kopplung_id).await?,
    ))
}

/// Beendet eine Helfer-Kopplung (ein Schritt der Transaktion): Widerruf wie beim Gerät; die
/// gemeinsame Endstelle löscht die Position einer zugeordneten Person (Spec „Personenposition“,
/// `helfer::ende`). Liefert, ob beendet wurde.
async fn helfer_beenden(
    conn: &mut sqlx::SqliteConnection,
    kopplung_id: i64,
    von: i64,
) -> Result<bool, AppError> {
    geraet_repo::widerrufen(conn, kopplung_id, von).await
}

/// Live nach dem Ende einer Kopplung, die vielleicht eine Helfer-Kopplung ist (nach dem Commit):
/// `helfer` an die Leitung und, mit Person, deren Ereignis der Lagekarte. Für Wege, die nicht
/// wissen, ob sie einen Helfer beendet haben (Einheit auflösen). Ein Lesefehler steht nur im Log:
/// geschrieben ist schon alles.
pub(crate) async fn melde_helfer_ende(state: &AppState, einsatz_id: i64, kopplung_id: i64) {
    let zeile: Result<Option<Option<i64>>, sqlx::Error> = sqlx::query_scalar(
        "SELECT person_id FROM geraet_kopplung WHERE id = ? AND ansicht = 'helfer'",
    )
    .bind(kopplung_id)
    .fetch_optional(&state.pool)
    .await;
    match zeile {
        Ok(Some(person_id)) => {
            state.live.publiziere_helfer(einsatz_id, kopplung_id);
            if let Some(pid) = person_id {
                ortung::publiziere(state, einsatz_id, Ortungsziel::Person(pid));
            }
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(error = %e, kopplung_id, "Helfer-Ende nicht gemeldet"),
    }
}

/// Live nach [`helfer::ende::raeume_abgelaufene`] (nach dem Commit).
fn melde_geraeumt(state: &AppState, geraeumt: &[helfer::ende::Geraeumt]) {
    for g in geraeumt {
        state.live.publiziere_helfer(g.einsatz_id, g.kopplung_id);
        ortung::publiziere(state, g.einsatz_id, Ortungsziel::Person(g.person_id));
    }
}

/// Ergebnis von [`abmelden_tx`]: ETB-Eintrag, Einsatz und Person der abgemeldeten Kopplung.
struct Abgemeldet {
    etb_id: i64,
    einsatz_id: i64,
    kopplung_id: i64,
    person_id: Option<i64>,
}

/// Die Kraft meldet sich ab (ein Schritt der Transaktion): Kopplung beendet wie ein Widerruf durch
/// das Gerät selbst, Ereignis `abgemeldet`, Personenposition gelöscht, ETB-Eintrag unter dem
/// Gerätekonto. `None`, wenn die Kopplung schon beendet war.
async fn abmelden_tx(
    conn: &mut sqlx::SqliteConnection,
    g: &GeraetKontext,
    geraetekonto: i64,
) -> Result<Option<Abgemeldet>, AppError> {
    let stand = bestaetigung::stand(conn, g.einsatz_id, g.kopplung_id).await?;
    if !geraet_repo::abmelden(conn, g.kopplung_id, geraetekonto).await? {
        return Ok(None);
    }
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, g.einsatz_id)
        .await?
        .etb_startwert();
    let text = format!("Helfer „{}“ hat sich abgemeldet.", stand.anzeigename);
    let etb_id =
        crate::etb::system_audit_tx(conn, g.einsatz_id, geraetekonto, startwert, &text).await?;
    Ok(Some(Abgemeldet {
        etb_id,
        einsatz_id: g.einsatz_id,
        kopplung_id: g.kopplung_id,
        person_id: stand.person_id,
    }))
}

/// Live nach [`abmelden_tx`] (nach dem Commit).
fn melde_abgemeldet(state: &AppState, a: &Abgemeldet) {
    state.live.melde_kopplung_ende(a.kopplung_id);
    state.live.publiziere(a.einsatz_id, a.etb_id);
    state.live.publiziere_helfer(a.einsatz_id, a.kopplung_id);
    if let Some(pid) = a.person_id {
        ortung::publiziere(state, a.einsatz_id, Ortungsziel::Person(pid));
    }
}

/// `POST /api/auth/logout` mit der Sitzung einer Helfer-Kopplung (Spec Helfer-App, „Enden“):
/// beendet die Kopplung, bevor der Logout die Sitzung löscht. Der Platz als Ortungsgerät wird
/// frei, die Person verschwindet von der Karte, die Leitung sieht das Ende live.
pub(crate) async fn abmelden_durch_geraet(
    state: &AppState,
    g: &GeraetKontext,
    geraetekonto: i64,
) -> Result<(), AppError> {
    let abgemeldet = crate::write_retry!(&state.pool, |conn| {
        abmelden_tx(conn, g, geraetekonto).await
    })?;
    if let Some(a) = abgemeldet {
        melde_abgemeldet(state, &a);
    }
    Ok(())
}

/// POST /api/incidents/{id}/helpers/{gid}/revoke — meldet einen Helfer ab: Sitzungen weg,
/// Position der Person gelöscht, ETB-Eintrag. Idempotent; 404 fremd.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, kopplung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<HelferAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let von = ctx.benutzer.id;
    let leitung = &ctx.benutzer.anzeigename;
    let beendet = crate::write_retry!(&state.pool, |conn| {
        let stand = bestaetigung::stand(conn, einsatz_id, kopplung_id).await?;
        if !helfer_beenden(conn, kopplung_id, von).await? {
            return Ok(None);
        }
        let text = format!("Helfer „{}“ abgemeldet von {leitung}.", stand.anzeigename);
        let etb_id = crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await?;
        Ok(Some((etb_id, stand.person_id)))
    })?;
    state.live.melde_kopplung_ende(kopplung_id);
    if let Some((etb_id, person_id)) = beendet {
        state.live.publiziere(einsatz_id, etb_id);
        state.live.publiziere_helfer(einsatz_id, kopplung_id);
        if let Some(pid) = person_id {
            ortung::publiziere(&state, einsatz_id, Ortungsziel::Person(pid));
        }
    }
    Ok(Json(
        helfer::laden(&state.pool, einsatz_id, kopplung_id).await?,
    ))
}

/// POST /api/incidents/{id}/helpers/revoke — meldet alle laufenden Helfer des Einsatzes ab, mit
/// einem Sammeleintrag im ETB. Liefert die Übersicht.
pub async fn alle_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
) -> Result<Json<HelferUebersicht>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let von = ctx.benutzer.id;
    let leitung = &ctx.benutzer.anzeigename;
    let (beendet, etb_id, geraeumt) = crate::write_retry!(&state.pool, |conn| {
        // Abgelaufene beendet niemand mehr; ihre Personenposition geht hier mit.
        let geraeumt = helfer::ende::raeume_abgelaufene(conn, Some(einsatz_id)).await?;
        let offen: Vec<(i64, Option<i64>)> = sqlx::query_as(
            "SELECT id, person_id FROM geraet_kopplung \
             WHERE einsatz_id = ? AND ansicht = 'helfer' AND widerrufen_at IS NULL \
               AND laeuft_ab_at > datetime('now') ORDER BY id",
        )
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
        let mut beendet = Vec::new();
        for (id, person_id) in offen {
            if helfer_beenden(conn, id, von).await? {
                beendet.push((id, person_id));
            }
        }
        let etb_id = if beendet.is_empty() {
            None
        } else {
            let text = format!("{} Helfer abgemeldet von {leitung}.", beendet.len());
            Some(crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await?)
        };
        Ok((beendet, etb_id, geraeumt))
    })?;
    melde_geraeumt(&state, &geraeumt);
    for (id, person_id) in &beendet {
        state.live.melde_kopplung_ende(*id);
        state.live.publiziere_helfer(einsatz_id, *id);
        if let Some(pid) = person_id {
            ortung::publiziere(&state, einsatz_id, Ortungsziel::Person(*pid));
        }
    }
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    Ok(Json(
        baue_uebersicht(&state, einsatz_id, ctx.einsatz.org_id).await?,
    ))
}

/// POST /api/incidents/{id}/helpers/{gid}/extend — neues Ende eines bestätigten Helfers, wie
/// `POST /api/incidents/{id}/devices/{gid}/extend` (höchstens 72 h ab jetzt). 404 fremd; 409,
/// wenn er nicht aktiv ist.
pub async fn verlaengern(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, kopplung_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<crate::routes::geraet::VerlaengernBody>,
) -> Result<Json<HelferAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ende = crate::routes::geraet::ende_aus(Some(&body.laeuft_ab_at))?;
    let von = ctx.benutzer.id;
    crate::write_retry!(&state.pool, |conn| {
        let stand = bestaetigung::stand(conn, einsatz_id, kopplung_id).await?;
        if !stand.ist_aktiv() {
            return Err(AppError::Conflict(
                "Nur ein bestätigter Helfer lässt sich verlängern".into(),
            ));
        }
        geraet_repo::verlaengern(conn, kopplung_id, &ende, von).await
    })?;
    state.live.publiziere_helfer(einsatz_id, kopplung_id);
    Ok(Json(
        helfer::laden(&state.pool, einsatz_id, kopplung_id).await?,
    ))
}
