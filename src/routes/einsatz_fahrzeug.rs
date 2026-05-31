use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::fahrzeug::disposition_repo::{self, AdhocDaten};
use crate::fahrzeug::status_repo;
use crate::fahrzeug::EinsatzFahrzeugAnzeige;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Liest ein optional-nullable Feld so, dass JSON-`null` zu `Some(None)` und
/// fehlendes Feld zu `None` wird (Tri-State, wie in `routes::einsatz_uhs`).
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// SSE-Notify (Lage-Karte): Fahrzeug-Disposition hat sich geändert.
fn sse_fahrzeug(state: &AppState, einsatz_id: i64, ef_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "fahrzeug_id": ef_id }).to_string();
    state.live.publiziere_event(einsatz_id, "fahrzeug", data);
}

/// Schreibt einen automatischen System-ETB-Eintrag für die handelnde Person und
/// publiziert ihn live (wie `routes::etb::erfassen`). Bewusst sequentiell nach der
/// Disposition (Entscheidung 4 der Spec: ETB = zusätzliche, append-only Spur).
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/fahrzeuge — disponierte Fahrzeuge (aufgelöst). Nur Mitglieder/höhere Berechtigung.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzFahrzeugAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub fahrzeug_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/fahrzeuge — Stamm-Fahrzeug disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzFahrzeugAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let ef_id = match (body.fahrzeug_id, body.adhoc) {
        (Some(fahrzeug_id), None) => {
            disposition_repo::disponiere_stamm(
                &state.pool, einsatz_id, einsatz.org_id, fahrzeug_id, benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let funkrufname = adhoc.funkrufname.trim().to_string();
            if funkrufname.is_empty() {
                return Err(AppError::Validation("Funkrufname darf nicht leer sein".into()));
            }
            let fahrzeugtyp = trimme(adhoc.fahrzeugtyp);
            let kennzeichen = trimme(adhoc.kennzeichen);
            let opta = trimme(adhoc.opta);
            let traeger = trimme(adhoc.traegerorganisation);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                AdhocDaten {
                    funkrufname: &funkrufname,
                    fahrzeugtyp: fahrzeugtyp.as_deref(),
                    kennzeichen: kennzeichen.as_deref(),
                    opta: opta.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                },
                benutzer.id,
            )
            .await?
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder fahrzeug_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Fahrzeug «{}» disponiert", anzeige.funkrufname),
    )
    .await?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id} — Status und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Status muss (aktiv) zur Org gehören.
    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    // Bemerkung im Body gesetzt (auch "") → setzen (leer = löschen); absent/null →
    // unverändert lassen (COALESCE im Repo). Daher NICHT über `trimme` zu None kollabieren,
    // sonst ließe sich eine Bemerkung nie löschen.
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(&state.pool, einsatz_id, ef_id, body.status_id, bemerkung)
        .await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;

    if vorher.status_id != nachher.status_id {
        let alt = vorher.status_label.as_deref().unwrap_or("—");
        let neu = nachher.status_label.as_deref().unwrap_or("—");
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Fahrzeug «{}»: Status «{}» → «{}»", nachher.funkrufname, alt, neu),
        )
        .await?;
    }
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/fahrzeuge/{ef_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, ef_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Fahrzeug «{}» aus dem Einsatz entfernt", anzeige.funkrufname),
    )
    .await?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct PositionBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
    Json(body): Json<PositionBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Effektivzustand für die Paar-Validierung: vorhandene lat/lon (404 falls fremd).
    let vorher: (Option<f64>, Option<f64>) = sqlx::query_as(
        "SELECT lat, lon FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let eff_lat = match body.lat { Some(o) => o, None => vorher.0 };
    let eff_lon = match body.lon { Some(o) => o, None => vorher.1 };
    if eff_lat.is_some() != eff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
        ));
    }
    if let Some(la) = eff_lat {
        if !(-90.0..=90.0).contains(&la) {
            return Err(AppError::UnprocessableEntity("lat muss zwischen -90 und 90 liegen".into()));
        }
    }
    if let Some(lo) = eff_lon {
        if !(-180.0..=180.0).contains(&lo) {
            return Err(AppError::UnprocessableEntity("lon muss zwischen -180 und 180 liegen".into()));
        }
    }

    let nachher = disposition_repo::aktualisiere_position(
        &state.pool,
        einsatz_id,
        ef_id,
        disposition_repo::PositionPatch {
            lat: body.lat,
            lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
        einsatz.ist_aktiv(),
    )
    .await?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(nachher))
}

/// GET /api/einsaetze/{id}/fahrzeuge/stream — SSE-Stream (ganzer Einsatz-Kanal).
/// Nur Lesezugriff; das Frontend filtert per Event-Name (`fahrzeug`).
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
