use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einheit::repo::{self as einheit_repo, EinheitDaten};
use crate::einheit::{mitglied_repo, EinheitAnzeige};
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::staerke::Staerke;
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

/// SSE-Notify (Lage-Karte): Einheit hat sich geändert. Frontend filtert per Event-Name.
fn sse_einheit(state: &AppState, einsatz_id: i64, einheit_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "einheit_id": einheit_id }).to_string();
    state.live.publiziere_event(einsatz_id, "einheit", data);
}

/// SSE-Notify (Lage-Karte): betroffenes Fahrzeug aktualisieren (z.B. bei Zuordnung/Freigabe).
/// Lokaler Spiegel von `routes::einsatz_fahrzeug::sse_fahrzeug` (gleiche Payload), um
/// Cross-Modul-Sichtbarkeit zu vermeiden.
fn sse_fahrzeug(state: &AppState, einsatz_id: i64, ef_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "fahrzeug_id": ef_id }).to_string();
    state.live.publiziere_event(einsatz_id, "fahrzeug", data);
}

/// SSE-Notify (Lage-Karte): betroffene Person aktualisieren (z.B. bei Zuordnung/Freigabe).
/// Lokaler Spiegel von `routes::einsatz_personal::sse_personal` (Tag `person`, gleiche Payload).
fn sse_personal(state: &AppState, einsatz_id: i64, ep_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "person_id": ep_id }).to_string();
    state.live.publiziere_event(einsatz_id, "person", data);
}

/// SSE-Notify (Meldebild): betroffenes Material aktualisieren (z.B. bei Zuordnung/Freigabe).
/// Lokaler Spiegel von `routes::einsatz_material::sse_material` (Tag `material`, gleiche Payload).
fn sse_material(state: &AppState, einsatz_id: i64, em_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "material_id": em_id }).to_string();
    state.live.publiziere_event(einsatz_id, "material", data);
}

async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool, einsatz_id, benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM, inhalt, von: None, an: None, meldeweg: None,
            veranlassung: None, ereigniszeit: None, erfasst_lokal_at: None, berichtigt_eintrag_id: None,
        },
    ).await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Holt den Einsatz + Rolle und prüft Schreibrecht + aktiv. Liefert den Einsatz.
async fn schreib_gate(state: &AppState, einsatz_id: i64, benutzer_id: i64) -> Result<crate::einsatz::Einsatz, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer_id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    Ok(einsatz)
}

/// Lädt nur den Einheiten-Namen (für ETB-Texte); `NotFound`, falls nicht zum Einsatz.
async fn einheit_name(state: &AppState, einsatz_id: i64, eid: i64) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>("SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(eid).bind(einsatz_id)
        .fetch_optional(&state.pool).await?
        .ok_or(AppError::NotFound)
}

/// GET /api/einsaetze/{id}/einheiten — Liste (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinheitAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(einheit_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct EinheitBody {
    pub name: String,
    pub abschnitt_id: Option<i64>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub fuehrer_id: Option<i64>,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

/// POST /api/einsaetze/{id}/einheiten — Einheit bilden. ETB-Eintrag.
pub async fn bilden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<EinheitBody>,
) -> Result<(StatusCode, Json<EinheitAnzeige>), AppError> {
    let einsatz = schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    Staerke::aus_optionen(body.soll_fuehrer, body.soll_unterfuehrer, body.soll_mannschaft).map_err(AppError::Validation)?;
    let bemerkung = trimme(body.bemerkung);
    let anzeige = einheit_repo::anlegen(
        &state.pool, einsatz_id, einsatz.org_id,
        EinheitDaten {
            name: &name, abschnitt_id: body.abschnitt_id, ueber_einheit_id: body.ueber_einheit_id,
            typ_id: body.typ_id, soll_fuehrer: body.soll_fuehrer, soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
        benutzer.id,
    ).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}» gebildet", anzeige.name)).await?;
    sse_einheit(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH /api/einsaetze/{id}/einheiten/{eid} — Vollersatz inkl. authoritativem fuehrer_id.
/// Führer-Wechsel und Abschnitts-Zuordnungs-Änderung schreiben je einen ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid)): Path<(i64, i64)>,
    Json(body): Json<EinheitBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz = schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    Staerke::aus_optionen(body.soll_fuehrer, body.soll_unterfuehrer, body.soll_mannschaft).map_err(AppError::Validation)?;
    let bemerkung = trimme(body.bemerkung);

    let vorher = einheit_repo::laden(&state.pool, einsatz_id, eid).await?;
    // Führer-Gültigkeit VOR jeglichem Write prüfen, damit ein ungültiger Führer
    // (Nicht-Mitglied) kein Teil-Update der übrigen Felder hinterlässt.
    if vorher.fuehrer_id != body.fuehrer_id {
        einheit_repo::pruefe_fuehrer(&state.pool, einsatz_id, eid, body.fuehrer_id).await?;
    }
    let nachher = einheit_repo::aktualisiere(
        &state.pool, einsatz_id, einsatz.org_id, eid,
        EinheitDaten {
            name: &name, abschnitt_id: body.abschnitt_id, ueber_einheit_id: body.ueber_einheit_id,
            typ_id: body.typ_id, soll_fuehrer: body.soll_fuehrer, soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft, bemerkung: bemerkung.as_deref(), sortier: body.sortier,
        },
    ).await?;

    // Führer authoritativ setzen (Mitgliedschaft bereits geprüft) + ETB bei Änderung.
    if vorher.fuehrer_id != body.fuehrer_id {
        einheit_repo::setze_fuehrer(&state.pool, einsatz_id, eid, body.fuehrer_id).await?;
    }
    // Endgültige Anzeige (inkl. neu aufgelöstem Führer-Namen).
    let final_anzeige = einheit_repo::laden(&state.pool, einsatz_id, eid).await?;

    if vorher.fuehrer_id != body.fuehrer_id {
        let inhalt = match (&vorher.fuehrer_name, &final_anzeige.fuehrer_name) {
            (None, Some(neu)) => format!("Einheit «{}»: Einheitsführer «{}» gesetzt", final_anzeige.name, neu),
            (Some(alt), Some(neu)) => format!("Einheit «{}»: Einheitsführer «{}» → «{}»", final_anzeige.name, alt, neu),
            (Some(alt), None) => format!("Einheit «{}»: Einheitsführer «{}» entfernt", final_anzeige.name, alt),
            (None, None) => String::new(),
        };
        if !inhalt.is_empty() {
            etb_system(&state, einsatz_id, benutzer.id, &inhalt).await?;
        }
    }
    if vorher.abschnitt_id != nachher.abschnitt_id {
        let inhalt = match &nachher.abschnitt_name {
            Some(a) => format!("Einheit «{}»: Abschnitt «{}» zugeordnet", nachher.name, a),
            None => format!("Einheit «{}»: Abschnittszuordnung aufgehoben", nachher.name),
        };
        etb_system(&state, einsatz_id, benutzer.id, &inhalt).await?;
    }
    sse_einheit(&state, einsatz_id, eid);
    Ok(Json(final_anzeige))
}

/// DELETE /api/einsaetze/{id}/einheiten/{eid} — auflösen. ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let name = einheit_name(&state, einsatz_id, eid).await?;
    einheit_repo::loese_auf(&state.pool, einsatz_id, eid).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}» aufgelöst", name)).await?;
    sse_einheit(&state, einsatz_id, eid);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/personal/{ep_id} — Person zuordnen. ETB-Eintrag.
pub async fn personal_zuordnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ep_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let person = mitglied_repo::ordne_personal_zu(&state.pool, einsatz_id, eid, ep_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: «{}» zugeordnet", einheit, person)).await?;
    sse_einheit(&state, einsatz_id, eid);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/personal/{ep_id} — Person freigeben. ETB-Eintrag.
pub async fn personal_freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ep_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let person = mitglied_repo::gib_personal_frei(&state.pool, einsatz_id, eid, ep_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: «{}» freigegeben", einheit, person)).await?;
    sse_einheit(&state, einsatz_id, eid);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/fahrzeug/{ef_id} — Fahrzeug zuordnen. ETB-Eintrag.
pub async fn fahrzeug_zuordnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ef_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let fz = mitglied_repo::ordne_fahrzeug_zu(&state.pool, einsatz_id, eid, ef_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Fahrzeug «{}» zugeordnet", einheit, fz)).await?;
    sse_einheit(&state, einsatz_id, eid);
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/fahrzeug/{ef_id} — Fahrzeug freigeben. ETB-Eintrag.
pub async fn fahrzeug_freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, ef_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let fz = mitglied_repo::gib_fahrzeug_frei(&state.pool, einsatz_id, eid, ef_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Fahrzeug «{}» freigegeben", einheit, fz)).await?;
    sse_einheit(&state, einsatz_id, eid);
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/material/{em_id} — Material zuordnen. ETB-Eintrag.
pub async fn material_zuordnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, em_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let (bez, menge) = mitglied_repo::ordne_material_zu(&state.pool, einsatz_id, eid, em_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Material «{}» (×{}) zugeordnet", einheit, bez, menge)).await?;
    sse_einheit(&state, einsatz_id, eid);
    sse_material(&state, einsatz_id, em_id);
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/material/{em_id} — Material freigeben. ETB-Eintrag.
pub async fn material_freigeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, eid, em_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, einsatz_id, benutzer.id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    let (bez, menge) = mitglied_repo::gib_material_frei(&state.pool, einsatz_id, eid, em_id).await?;
    etb_system(&state, einsatz_id, benutzer.id, &format!("Einheit «{}»: Material «{}» (×{}) freigegeben", einheit, bez, menge)).await?;
    sse_einheit(&state, einsatz_id, eid);
    sse_material(&state, einsatz_id, em_id);
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

/// PATCH /api/einsaetze/{id}/einheiten/{eid}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, einheit_id)): Path<(i64, i64)>,
    Json(body): Json<PositionBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = einheit_repo::laden(&state.pool, einsatz_id, einheit_id).await?; // 404 falls fremd
    let eff_lat = match body.lat { Some(o) => o, None => vorher.lat };
    let eff_lon = match body.lon { Some(o) => o, None => vorher.lon };
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

    let nachher = einheit_repo::aktualisiere_position(
        &state.pool,
        einsatz_id,
        einheit_id,
        einheit_repo::PositionPatch {
            lat: body.lat,
            lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_einheit(&state, einsatz_id, einheit_id);
    Ok(Json(nachher))
}

/// GET /api/einsaetze/{id}/einheiten/stream — SSE-Stream (ganzer Einsatz-Kanal).
/// Nur Lesezugriff; das Frontend filtert per Event-Name (`einheit`).
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
