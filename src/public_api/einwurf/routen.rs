//! Die Einwurf-Routen unter `/api/v1/einwurf/{schluessel}/…` (Spec `einwurf-zugang`,
//! design.md D6 und D12). Die einzigen Routen der öffentlichen API ohne signierte Anfrage
//! (ADR-0023): Der Schlüssel im Pfad ist die Anmeldung, und sie schreiben nur.
//!
//! Jede Antwort ist 204 ohne Body oder ein Fehler mit `error` und `code`. Ob ein Einwurf neu
//! war oder eine Wiederholung, verrät die Antwort nicht.

use axum::body::to_bytes;
use axum::extract::{FromRequestParts, Request, State};
use axum::http::header::{ALLOW, CONTENT_TYPE};
use axum::http::request::Parts;
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};

use super::ablage::{self, AlarmErgebnis, Einwurf, PositionErgebnis};
use super::{EinwurfZugang, Transport};
use crate::app::AppState;
use crate::auth::rate_limit;
use crate::extract::{gegenstelle, is_tls_nachgewiesen, vertraute_proxys, PeerIp, PfadParam};
use crate::log_drossel::SammelzeileJe;
use crate::public_api::scope::Scope;
use crate::public_api::{drossel, zugang, ApiError, ErrorCode};

fn unauthorized() -> ApiError {
    ApiError::new(ErrorCode::Unauthorized, "Anmeldung fehlgeschlagen")
}

/// Prüft einen Einwurf, bevor sein Inhalt gelesen wird. Die Reihenfolge steht nur hier
/// (design.md D6):
///
/// 1. TLS-Nachweis, vor der Suche: eine Klartext-Anfrage ist kein Orakel für Schlüssel und zählt
///    nirgends.
/// 2. Sperre der Quelle im Zähler für Maschinen (nie die Anmeldesperre).
/// 3. Form des Schlüssels und Suche über den Hash; ein unbekannter zählt als Fehlversuch. Ein
///    durch einen Wechsel abgelöster Schlüssel ist bekannt und zählt nicht.
/// 4. Zustand: widerrufen, abgelaufen oder gekoppelter ELW. Zählt nicht, sonst sperrte ein
///    Absender mit altem Schlüssel die Wache hinter derselben Adresse aus.
/// 5. Zweck gegen die Route.
/// 6. Drossel je Zugang.
async fn check_einwurf(
    state: &AppState,
    parts: &mut Parts,
    schluessel: &str,
    zweck: Scope,
) -> Result<EinwurfZugang, ApiError> {
    let transport = parts
        .extensions
        .get::<Transport>()
        .copied()
        .unwrap_or_default();
    let verschluesselt = is_tls_nachgewiesen(
        transport.tls,
        gegenstelle(parts),
        &parts.headers,
        vertraute_proxys(),
    );
    if !verschluesselt && !transport.einwurf_allow_http {
        return Err(ApiError::from_code(ErrorCode::TlsRequired));
    }

    let PeerIp(peer_ip) = match PeerIp::from_request_parts(parts, state).await {
        Ok(p) => p,
        Err(never) => match never {},
    };
    if let Some(ip) = peer_ip {
        if let rate_limit::Sperre::Gesperrt { zeile } = rate_limit::maschine::sperre(ip) {
            if let Some(still) = zeile {
                tracing::warn!(%ip, still, "Maschinenwege für diese Quelle gesperrt");
            }
            return Err(ApiError::rate_limited(60));
        }
    }

    let gefunden = {
        let mut conn = state.pool.acquire().await?;
        super::find_by_schluessel(&mut conn, schluessel).await?
    };
    let Some(zugang) = gefunden else {
        let abgeloest = {
            let mut conn = state.pool.acquire().await?;
            super::is_abgeloest(&mut conn, schluessel).await?
        };
        if !abgeloest {
            if let Some(ip) = peer_ip {
                rate_limit::maschine::fehlversuch(ip);
            }
            tracing::debug!("Einwurf mit unbekanntem Schlüssel");
        }
        return Err(unauthorized());
    };

    let jetzt = crate::zeit::jetzt();
    if zugang.is_widerrufen() || zugang.is_abgelaufen(&jetzt) {
        return Err(unauthorized());
    }
    let hub = {
        let mut conn = state.pool.acquire().await?;
        zugang::hub_fuer_org(&mut conn, zugang.org_id).await?
    };
    if hub.is_some() {
        return Err(unauthorized());
    }

    if zugang.scope != zweck {
        return Err(ApiError::from_code(ErrorCode::MissingScope));
    }

    if let Err(warten) = drossel::try_take_einwurf(&zugang.id) {
        // Der Absender bekommt 429; viele wiederholen nicht. Damit der Betreiber es erfährt,
        // steht es im Log, als Sammelzeile: Wer den Schlüssel hat, löst sie je Aufruf aus. Je
        // Zugang gezählt, damit ein dauernd gedrosselter Zugang keinen anderen verdeckt.
        static GEDROSSELT: SammelzeileJe = SammelzeileJe::neu();
        if let Some(f) = GEDROSSELT.zaehlen(&zugang.id) {
            tracing::warn!(
                zugang = %zugang.id,
                anzahl = f.anzahl,
                seit_s = f.seit_s,
                "Einwürfe gedrosselt (mehr als 30 am Stück je Zugang), Sammelzeile"
            );
        }
        return Err(ApiError::rate_limited(drossel::retry_after_s(warten)));
    }
    Ok(zugang)
}

/// Nimmt einen Einwurf an, oder lehnt jede andere Methode als GET und POST ab.
async fn annehmen(state: AppState, schluessel: String, req: Request, zweck: Scope) -> Response {
    // axum reicht HEAD an den GET-Handler weiter. Ein Einwurf schreibt aber: `curl -I` oder ein
    // Link-Prüfer legte sonst eine Meldung an. Vor jeder Prüfung des Schlüssels, damit die
    // Antwort für jeden Schlüssel gleich ist.
    if req.method() != Method::GET && req.method() != Method::POST {
        let mut antwort = ApiError::from_code(ErrorCode::MethodNotAllowed).into_response();
        antwort
            .headers_mut()
            .insert(ALLOW, HeaderValue::from_static("GET, POST"));
        return antwort;
    }
    ablegen(state, schluessel, req, zweck).await.into_response()
}

/// Prüfen, Inhalt lesen, in die Ablage des Zwecks schreiben.
async fn ablegen(
    state: AppState,
    schluessel: String,
    req: Request,
    zweck: Scope,
) -> Result<StatusCode, ApiError> {
    let (mut parts, body) = req.into_parts();
    let zugang = check_einwurf(&state, &mut parts, &schluessel, zweck).await?;

    // Die v1-Schicht hat den Body schon bis 64 KiB gepuffert; hier gilt die engere Grenze.
    let body = to_bytes(body, ablage::BODY_MAX)
        .await
        .map_err(|_| ApiError::from_code(ErrorCode::PayloadTooLarge))?;
    let einwurf = Einwurf {
        abfrage: parts.uri.query().unwrap_or_default(),
        inhaltstyp: parts
            .headers
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        body: &body,
    };
    let jetzt = crate::zeit::jetzt();

    if zweck == Scope::PositionenWrite {
        let inhalt = ablage::position_inhalt(&einwurf, &jetzt)?;
        let ergebnis = crate::write_retry!(&state.pool, |conn| {
            let ergebnis = ablage::position_ablegen(&mut *conn, &zugang, &inhalt, &jetzt).await?;
            if ergebnis != PositionErgebnis::ZuVieleKennungen {
                super::nutzung_vermerken(&mut *conn, &zugang.id, &jetzt).await?;
            }
            Ok(ergebnis)
        })?;
        return match ergebnis {
            PositionErgebnis::Uebernommen | PositionErgebnis::Aelter => Ok(StatusCode::NO_CONTENT),
            PositionErgebnis::ZuVieleKennungen => Err(ApiError::new(
                ErrorCode::Unprocessable,
                format!(
                    "Dieser Zugang hält schon {} Kennungen.",
                    ablage::KENNUNGEN_JE_ZUGANG
                ),
            )),
        };
    }

    let inhalt = ablage::alarm_inhalt(&einwurf)?;
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        let ergebnis = ablage::alarmmeldung_ablegen(&mut *conn, &zugang, &inhalt, &jetzt).await?;
        if ergebnis != AlarmErgebnis::Tagesgrenze {
            super::nutzung_vermerken(&mut *conn, &zugang.id, &jetzt).await?;
        }
        Ok(ergebnis)
    })?;
    match ergebnis {
        AlarmErgebnis::Neu | AlarmErgebnis::Wiederholung => Ok(StatusCode::NO_CONTENT),
        AlarmErgebnis::Tagesgrenze => {
            // An der Grenze löst jeder Einwurf diese Stelle aus: Sammelzeile je Zugang.
            static VOLL: SammelzeileJe = SammelzeileJe::neu();
            if let Some(f) = VOLL.zaehlen(&zugang.id) {
                tracing::warn!(
                    zugang = %zugang.id,
                    grenze = ablage::ALARMMELDUNGEN_JE_TAG,
                    anzahl = f.anzahl,
                    seit_s = f.seit_s,
                    "Einwurf-Zugang hat die Tagesgrenze der Ablage erreicht, Sammelzeile"
                );
            }
            Err(ApiError::rate_limited(3600))
        }
    }
}

/// Eine Alarmmeldung per URL einwerfen (Absender, die nur GET können, etwa BOSWatch).
///
/// Die Abfrage wird unverändert abgelegt und nicht gedeutet. Erkannt werden nur `external_id`
/// und `message_id`: Mit ihnen ist eine Wiederholung dauerhaft idempotent. Ohne sie gilt
/// gleicher Inhalt desselben Zugangs zwei Minuten lang als Wiederholung. Wer POST kann, nimmt
/// POST: Bei GET stehen Schlüssel und Inhalt in der URL.
#[utoipa::path(
    get,
    path = "/api/v1/einwurf/{schluessel}/alarmmeldung",
    tag = "Einwurf",
    operation_id = "einwurf_alarmmeldung_get",
    params(
        ("schluessel" = String, Path, description = "Schlüssel des Einwurf-Zugangs (`llh_ew_…`). Er ist die Anmeldung; kein Kopf `Authorization`."),
        ("external_id" = Option<String>, Query, description = "Kennung des Alarms beim Absender, höchstens 200 Zeichen."),
        ("message_id" = Option<String>, Query, description = "Kennung dieser einen Meldung; bleibt bei einer Wiederholung gleich. Höchstens 200 Zeichen."),
    ),
    responses(
        (status = 204, description = "Angenommen: neu abgelegt oder als Wiederholung vermerkt. Kein Body."),
        (status = 400, description = "Kennung zu lang oder Body kein UTF-8 (`invalid_field`)", body = super::super::ApiErrorBody),
        (status = 401, description = "Schlüssel unbekannt, widerrufen oder abgelaufen", body = super::super::ApiErrorBody),
        (status = 403, description = "`tls_required`: nicht über TLS angekommen. `missing_scope`: der Zugang ist für Positionen.", body = super::super::ApiErrorBody),
        (status = 405, description = "Andere Methode als GET oder POST, auch HEAD; nichts wird abgelegt (`method_not_allowed`, Kopf `Allow: GET, POST`)", body = super::super::ApiErrorBody),
        (status = 413, description = "Abfrage über 8 KiB, Body über 16 KiB oder abgelegte Rohdaten über 48 KiB", body = super::super::ApiErrorBody),
        (status = 422, description = "Leerer Einwurf: weder Abfrage noch Body", body = super::super::ApiErrorBody),
        (status = 429, description = "Gedrosselt (30 je Minute und Zugang, 5 000 neue Meldungen je Tag) oder Quelle gesperrt; `Retry-After` nennt die Wartezeit", body = super::super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::super::ApiErrorBody),
    ),
)]
pub async fn alarmmeldung_get(
    State(state): State<AppState>,
    PfadParam(schluessel): PfadParam<String>,
    req: Request,
) -> Response {
    annehmen(state, schluessel, req, Scope::AlarmmeldungenWrite).await
}

/// Eine Alarmmeldung per POST einwerfen.
///
/// Der Body wird unverändert abgelegt, gleich in welchem Format (JSON, Formular, Text, XML),
/// und nicht gedeutet. `external_id` und `message_id` liest der Server aus einem JSON-Objekt
/// (oberste Ebene), aus Formularfeldern oder aus der Abfrage; der Body geht vor.
#[utoipa::path(
    post,
    path = "/api/v1/einwurf/{schluessel}/alarmmeldung",
    tag = "Einwurf",
    operation_id = "einwurf_alarmmeldung_post",
    params(
        ("schluessel" = String, Path, description = "Schlüssel des Einwurf-Zugangs (`llh_ew_…`). Er ist die Anmeldung; kein Kopf `Authorization`."),
    ),
    request_body(content = Object, content_type = "application/json", description = "Beliebiger Inhalt als UTF-8, höchstens 16 KiB. Auch `application/x-www-form-urlencoded`, `text/plain` oder XML."),
    responses(
        (status = 204, description = "Angenommen: neu abgelegt oder als Wiederholung vermerkt. Kein Body."),
        (status = 400, description = "Kennung zu lang oder Body kein UTF-8 (`invalid_field`)", body = super::super::ApiErrorBody),
        (status = 401, description = "Schlüssel unbekannt, widerrufen oder abgelaufen", body = super::super::ApiErrorBody),
        (status = 403, description = "`tls_required`: nicht über TLS angekommen. `missing_scope`: der Zugang ist für Positionen.", body = super::super::ApiErrorBody),
        (status = 405, description = "Andere Methode als GET oder POST, auch HEAD; nichts wird abgelegt (`method_not_allowed`, Kopf `Allow: GET, POST`)", body = super::super::ApiErrorBody),
        (status = 413, description = "Abfrage über 8 KiB, Body über 16 KiB oder abgelegte Rohdaten über 48 KiB", body = super::super::ApiErrorBody),
        (status = 422, description = "Leerer Einwurf: weder Abfrage noch Body", body = super::super::ApiErrorBody),
        (status = 429, description = "Gedrosselt (30 je Minute und Zugang, 5 000 neue Meldungen je Tag) oder Quelle gesperrt; `Retry-After` nennt die Wartezeit", body = super::super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::super::ApiErrorBody),
    ),
)]
pub async fn alarmmeldung_post(
    State(state): State<AppState>,
    PfadParam(schluessel): PfadParam<String>,
    req: Request,
) -> Response {
    annehmen(state, schluessel, req, Scope::AlarmmeldungenWrite).await
}

/// Eine Position per URL einwerfen (OsmAnd-Protokoll, auch Traccar-Client).
///
/// Je Zugang und Kennung hält der Server genau eine Position, ohne Verlauf. Eine Position mit
/// älterem Zeitstempel als die gespeicherte wird nicht übernommen und trotzdem mit 204
/// beantwortet. Weitere Felder (`speed`, `bearing`, `altitude`, `accuracy`, `batt` …) werden
/// mit der Position abgelegt und mit ihr ersetzt.
#[utoipa::path(
    get,
    path = "/api/v1/einwurf/{schluessel}/position",
    tag = "Einwurf",
    operation_id = "einwurf_position_get",
    params(
        ("schluessel" = String, Path, description = "Schlüssel des Einwurf-Zugangs (`llh_ew_…`). Er ist die Anmeldung; kein Kopf `Authorization`."),
        ("id" = String, Query, description = "Kennung des Absenders, höchstens 128 Zeichen. Auch `deviceid`."),
        ("lat" = f64, Query, description = "Breite in Grad (WGS 84), -90 bis 90."),
        ("lon" = f64, Query, description = "Länge in Grad (WGS 84), -180 bis 180."),
        ("timestamp" = Option<String>, Query, description = "Zeitpunkt der Messung: Unix-Sekunden, Unix-Millisekunden oder RFC 3339. Ohne ihn gilt der Empfang."),
    ),
    responses(
        (status = 204, description = "Angenommen: übernommen, oder nicht übernommen, weil die gespeicherte Position jünger ist. Kein Body."),
        (status = 400, description = "Kennung oder Koordinate fehlt oder ist ungültig, Zeitstempel unlesbar (`invalid_field`)", body = super::super::ApiErrorBody),
        (status = 401, description = "Schlüssel unbekannt, widerrufen oder abgelaufen", body = super::super::ApiErrorBody),
        (status = 403, description = "`tls_required`: nicht über TLS angekommen. `missing_scope`: der Zugang ist für Alarmmeldungen.", body = super::super::ApiErrorBody),
        (status = 405, description = "Andere Methode als GET oder POST, auch HEAD; nichts wird abgelegt (`method_not_allowed`, Kopf `Allow: GET, POST`)", body = super::super::ApiErrorBody),
        (status = 413, description = "Abfrage über 8 KiB oder Body über 16 KiB", body = super::super::ApiErrorBody),
        (status = 422, description = "Zeitstempel mehr als 5 Minuten in der Zukunft, oder der Zugang hält schon 200 Kennungen", body = super::super::ApiErrorBody),
        (status = 429, description = "Gedrosselt (30 je Minute und Zugang) oder Quelle gesperrt; `Retry-After` nennt die Wartezeit", body = super::super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::super::ApiErrorBody),
    ),
)]
pub async fn position_get(
    State(state): State<AppState>,
    PfadParam(schluessel): PfadParam<String>,
    req: Request,
) -> Response {
    annehmen(state, schluessel, req, Scope::PositionenWrite).await
}

/// Eine Position per POST einwerfen.
///
/// Die Felder `id` (oder `deviceid`), `lat`, `lon` und `timestamp` stehen in einem
/// Formular-Body, in einem flachen JSON-Objekt oder in der Abfrage; der Body geht vor.
#[utoipa::path(
    post,
    path = "/api/v1/einwurf/{schluessel}/position",
    tag = "Einwurf",
    operation_id = "einwurf_position_post",
    params(
        ("schluessel" = String, Path, description = "Schlüssel des Einwurf-Zugangs (`llh_ew_…`). Er ist die Anmeldung; kein Kopf `Authorization`."),
    ),
    request_body(content = Object, content_type = "application/json", description = "Flaches Objekt mit `id`, `lat`, `lon` und optional `timestamp`; auch als `application/x-www-form-urlencoded`. Höchstens 16 KiB."),
    responses(
        (status = 204, description = "Angenommen: übernommen, oder nicht übernommen, weil die gespeicherte Position jünger ist. Kein Body."),
        (status = 400, description = "Kennung oder Koordinate fehlt oder ist ungültig, Zeitstempel unlesbar (`invalid_field`)", body = super::super::ApiErrorBody),
        (status = 401, description = "Schlüssel unbekannt, widerrufen oder abgelaufen", body = super::super::ApiErrorBody),
        (status = 403, description = "`tls_required`: nicht über TLS angekommen. `missing_scope`: der Zugang ist für Alarmmeldungen.", body = super::super::ApiErrorBody),
        (status = 405, description = "Andere Methode als GET oder POST, auch HEAD; nichts wird abgelegt (`method_not_allowed`, Kopf `Allow: GET, POST`)", body = super::super::ApiErrorBody),
        (status = 413, description = "Abfrage über 8 KiB oder Body über 16 KiB", body = super::super::ApiErrorBody),
        (status = 422, description = "Zeitstempel mehr als 5 Minuten in der Zukunft, oder der Zugang hält schon 200 Kennungen", body = super::super::ApiErrorBody),
        (status = 429, description = "Gedrosselt (30 je Minute und Zugang) oder Quelle gesperrt; `Retry-After` nennt die Wartezeit", body = super::super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::super::ApiErrorBody),
    ),
)]
pub async fn position_post(
    State(state): State<AppState>,
    PfadParam(schluessel): PfadParam<String>,
    req: Request,
) -> Response {
    annehmen(state, schluessel, req, Scope::PositionenWrite).await
}
