use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "einsatzabschnitte";
use crate::einsatzabschnitt::repo::{self as abschnitt_repo, AbschnittDaten};
use crate::einsatzabschnitt::EinsatzabschnittAnzeige;
use crate::error::AppError;
use crate::routes::support::trimme;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::Stream;

/// SSE-Notify (Lage-Karte): Abschnitt (Fläche/Symbol) hat sich geändert.
fn sse_abschnitt(state: &AppState, einsatz_id: i64, aid: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "abschnitt_id": aid }).to_string();
    state.live.publiziere_event(einsatz_id, "abschnitt", data);
}

/// GET /api/einsaetze/{id}/abschnitte — flache Liste (Baum baut das FE). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzabschnittAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    Ok(Json(abschnitt_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AbschnittBody {
    pub name: String,
    pub ueber_abschnitt_id: Option<i64>,
    pub leiter_id: Option<i64>,
    pub bemerkung: Option<String>,
    pub kommunikationsmittel: Option<String>,
    pub erreichbarkeit: Option<String>,
    #[serde(default)]
    pub sortier: i64,
    /// Sprechgruppen-IDs; `Some` ersetzt die Zuordnung vollständig, `None` lässt sie unverändert.
    pub sprechgruppe_ids: Option<Vec<i64>>,
}

/// POST /api/einsaetze/{id}/abschnitte — anlegen. Schreibrecht + aktiv. ETB-Eintrag.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AbschnittBody>,
) -> Result<(StatusCode, Json<EinsatzabschnittAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let bemerkung = trimme(body.bemerkung);
    let mittel = trimme(body.kommunikationsmittel);
    let erreichbar = trimme(body.erreichbarkeit);
    let mut anzeige = abschnitt_repo::anlegen(
        &state.pool,
        einsatz_id,
        AbschnittDaten {
            name: &name,
            ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id,
            bemerkung: bemerkung.as_deref(),
            kommunikationsmittel: mittel.as_deref(),
            erreichbarkeit: erreichbar.as_deref(),
            sortier: body.sortier,
        },
    )
    .await?;
    if let Some(ids) = body.sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(
            &state.pool,
            einsatz.org_id,
            einsatz_id,
            anzeige.id,
            &ids,
        )
        .await?;
        anzeige = abschnitt_repo::laden(&state.pool, einsatz_id, anzeige.id).await?;
    }
    super::etb_system_degradiert(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Abschnitt «{}» angelegt", anzeige.name),
    )
    .await?;
    sse_abschnitt(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid} — Vollersatz editierbarer Felder (kein ETB-Eintrag).
/// Kein ETB-Eintrag (reine Korrektur; Auflösen ist die sinntragende Aktion).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
    Json(body): Json<AbschnittBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let bemerkung = trimme(body.bemerkung);
    let mittel = trimme(body.kommunikationsmittel);
    let erreichbar = trimme(body.erreichbarkeit);
    let mut anzeige = abschnitt_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        aid,
        AbschnittDaten {
            name: &name,
            ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id,
            bemerkung: bemerkung.as_deref(),
            kommunikationsmittel: mittel.as_deref(),
            erreichbarkeit: erreichbar.as_deref(),
            sortier: body.sortier,
        },
    )
    .await?;
    if let Some(ids) = body.sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(
            &state.pool,
            einsatz.org_id,
            einsatz_id,
            aid,
            &ids,
        )
        .await?;
        anzeige = abschnitt_repo::laden(&state.pool, einsatz_id, aid).await?;
    }
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(Json(anzeige))
}

/// DELETE /api/einsaetze/{id}/abschnitte/{aid} — auflösen (Reparenting). ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let vorher = abschnitt_repo::laden(&state.pool, einsatz_id, aid).await?;
    // F06/LFH-244 Tier-A: Auflösen (Reparenting + Freigaben + DELETE) + System-ETB-Eintrag
    // atomar in EINER Tx (BEGIN IMMEDIATE + Retry). ETB-Text aus dem VOR der Tx geladenen
    // `vorher` (Name unverändert). SSE erst nach dem Commit (Reinheits-Kontrakt).
    let text = format!("Abschnitt «{}» aufgelöst", vorher.name);
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        abschnitt_repo::loese_auf_tx(conn, einsatz_id, aid).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct FlaecheBody {
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub flaeche_geojson: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid}/flaeche — Lage-Pflege, KEIN ETB.
pub async fn flaeche(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, aid)): Path<(i64, i64)>,
    Json(body): Json<FlaecheBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    if let Some(Some(gj)) = &body.flaeche_geojson {
        let v: serde_json::Value = serde_json::from_str(gj).map_err(|_| {
            AppError::UnprocessableEntity("flaeche_geojson ist kein gültiges JSON".into())
        })?;
        if v.get("type").and_then(|t| t.as_str()) != Some("Polygon") {
            return Err(AppError::UnprocessableEntity(
                "flaeche_geojson muss ein GeoJSON-Polygon sein".into(),
            ));
        }
    }

    let nachher = abschnitt_repo::aktualisiere_flaeche(
        &state.pool,
        einsatz_id,
        aid,
        abschnitt_repo::FlaechePatch {
            flaeche_geojson: body.flaeche_geojson.as_ref().map(|o| o.as_deref()),
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(Json(nachher))
}

/// GET /api/einsaetze/{id}/abschnitte/stream — SSE-Stream (ganzer Einsatz-Kanal).
/// Nur Lesezugriff; das Frontend filtert per Event-Name (`abschnitt`).
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = crate::routes::support::sse_event_stream(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
