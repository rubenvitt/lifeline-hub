use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::freies_zeichen::repo::{self as zeichen_repo, ZeichenNeu, ZeichenPatch};
use crate::freies_zeichen::FreiesZeichenAnzeige;
use crate::live::LiveEvent;
use crate::routes::support::{deserialize_optional_field, trimme, trimme_tri};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Modul-Key dieses Route-Moduls (LFH-132) — freie Zeichen leben auf der Lage-Karte.
const MODUL_KEY: &str = "lagekarte";

/// SSE-Notify (Lage-Karte): ein freies Zeichen hat sich geändert. Event-Tag `freies_zeichen`.
/// Der Wire-Tag ist load-bearing — das Frontend filtert exakt darauf.
fn sse_zeichen(state: &AppState, einsatz_id: i64, id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "zeichen_id": id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::FreiesZeichen, data);
}

/// GET /api/einsaetze/{id}/freie-zeichen — Liste aller freien Zeichen. Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<FreiesZeichenAnzeige>>, AppError> {
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
    Ok(Json(zeichen_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub lat: f64,
    pub lon: f64,
    pub grundzeichen: String,
    pub organisation: Option<String>,
    pub fachaufgabe: Option<String>,
    pub symbol: Option<String>,
    pub einheit: Option<String>,
    pub funktion: Option<String>,
    pub farbe: Option<String>,
    pub label: Option<String>,
}

/// POST /api/einsaetze/{id}/freie-zeichen — anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    JsonBody(body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<FreiesZeichenAnzeige>), AppError> {
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

    let grundzeichen = grundzeichen_pflicht(&body.grundzeichen)?;
    let organisation = trimme(body.organisation.clone());
    let fachaufgabe = trimme(body.fachaufgabe.clone());
    let symbol = trimme(body.symbol.clone());
    let einheit = trimme(body.einheit.clone());
    let funktion = trimme(body.funktion.clone());
    let farbe = trimme(body.farbe.clone());
    let label = trimme(body.label.clone());

    let z = zeichen_repo::anlegen(
        &state.pool,
        einsatz_id,
        ZeichenNeu {
            lat: body.lat,
            lon: body.lon,
            grundzeichen: &grundzeichen,
            organisation: organisation.as_deref(),
            fachaufgabe: fachaufgabe.as_deref(),
            symbol: symbol.as_deref(),
            einheit: einheit.as_deref(),
            funktion: funktion.as_deref(),
            farbe: farbe.as_deref(),
            label: label.as_deref(),
            erstellt_von: benutzer.id,
        },
    )
    .await?;

    sse_zeichen(&state, einsatz_id, z.id);
    Ok((StatusCode::CREATED, Json(z)))
}

/// PATCH-Body (LFH-306, Tri-State): **jedes** Feld ist optional — absent = unverändert.
/// Bewusst getrennt von [`AnlegenBody`]: der POST muss sein Pflicht-`grundzeichen`
/// weiterhin strukturell erzwingen (fehlendes Feld → 400 schon im Extractor, siehe
/// `fehlendes_grundzeichen_ist_400`).
///
/// `grundzeichen` ist NOT NULL und daher **nicht** Tri-State: absent = unverändert, ein
/// vorhandener leerer Wert bleibt 400 (`grundzeichen_pflicht`). Die sieben Overlay-Felder
/// sind nullable und tragen den vollen Tri-State — vor LFH-306 nullte ein Patch, der sie
/// wegließ, sie stillschweigend mit.
#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub grundzeichen: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub organisation: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub symbol: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub einheit: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub funktion: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub farbe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/freie-zeichen/{zid} — echter Teil-Patch (LFH-306): Feld absent
/// = unverändert, `null`/`""` bei den Overlays = leeren. lat/lon sind NICHT verschiebbar
/// (v1). Schreibrecht + aktiv.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<FreiesZeichenAnzeige>, AppError> {
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

    // Nur GESENDETE Felder werden geprüft: ein absentes `grundzeichen` ist schlicht kein
    // Wunsch, ein vorhandenes leeres bleibt 400.
    let grundzeichen = match &body.grundzeichen {
        Some(g) => Some(grundzeichen_pflicht(g)?),
        None => None,
    };
    let organisation = trimme_tri(body.organisation);
    let fachaufgabe = trimme_tri(body.fachaufgabe);
    let symbol = trimme_tri(body.symbol);
    let einheit = trimme_tri(body.einheit);
    let funktion = trimme_tri(body.funktion);
    let farbe = trimme_tri(body.farbe);
    let label = trimme_tri(body.label);

    let z = zeichen_repo::patche(
        &state.pool,
        einsatz_id,
        zid,
        ZeichenPatch {
            grundzeichen: grundzeichen.as_deref(),
            organisation: organisation.as_ref().map(|v| v.as_deref()),
            fachaufgabe: fachaufgabe.as_ref().map(|v| v.as_deref()),
            symbol: symbol.as_ref().map(|v| v.as_deref()),
            einheit: einheit.as_ref().map(|v| v.as_deref()),
            funktion: funktion.as_ref().map(|v| v.as_deref()),
            farbe: farbe.as_ref().map(|v| v.as_deref()),
            label: label.as_ref().map(|v| v.as_deref()),
        },
    )
    .await?;

    sse_zeichen(&state, einsatz_id, zid);
    Ok(Json(z))
}

/// DELETE /api/einsaetze/{id}/freie-zeichen/{zid} — aufheben (Hard-Delete). Schreibrecht + aktiv.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
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

    zeichen_repo::loese_auf(&state.pool, einsatz_id, zid).await?;
    sse_zeichen(&state, einsatz_id, zid);
    Ok(StatusCode::NO_CONTENT)
}

/// `grundzeichen` ist Pflicht: nach Trim non-empty, sonst 400. Liefert den getrimmten Wert.
///
/// 400 und nicht 422, weil das Feld ISOLIERT unbrauchbar ist — die Konvention bewertet mit
/// 422 erst den Zusammenhang (Feld-Kombination, Objekt-Zustand). Siehe CLAUDE.md, Abschnitt
/// „Backend — Statuscode-Konvention".
fn grundzeichen_pflicht(roh: &str) -> Result<String, AppError> {
    let g = roh.trim();
    if g.is_empty() {
        return Err(AppError::Validation(
            "grundzeichen darf nicht leer sein".into(),
        ));
    }
    Ok(g.to_string())
}
