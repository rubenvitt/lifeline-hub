use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::freies_zeichen::pruefung::pruefe_zeichen_spec;
use crate::freies_zeichen::repo::{self as zeichen_repo, ZeichenNeu, ZeichenPatch};
use crate::freies_zeichen::FreiesZeichenAnzeige;
use crate::live::LiveEvent;
use crate::routes::support::{
    deserialize_optional_field, pflicht, trimme, trimme_tri, AnsichtFilter,
};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): ein freies Zeichen hat sich geändert. Event-Tag `freies_zeichen`.
/// Der Wire-Tag ist load-bearing — das Frontend filtert exakt darauf.
fn sse_zeichen(state: &AppState, einsatz_id: i64, id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::FreiesZeichen, "zeichen_id", id);
}

/// GET /api/einsaetze/{id}/freie-zeichen — Liste aller freien Zeichen. Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    Query(filter): Query<AnsichtFilter>,
) -> Result<Json<Vec<FreiesZeichenAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        zeichen_repo::liste(&state.pool, einsatz_id, filter.ansicht).await?,
    ))
}

/// POST-Body. Genau eine Form (LFH-836, design.md D4): `zeichen_spec` (neu) ODER `grundzeichen`
/// mit Overlays (alter Body veralteter Clients, Übergang). Beides oder keines → 400.
#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub lat: f64,
    pub lon: f64,
    /// Kanonische Zeichenbeschreibung (`serializeAnySpec`), geprüft durch
    /// [`pruefe_zeichen_spec`].
    pub zeichen_spec: Option<String>,
    pub grundzeichen: Option<String>,
    pub organisation: Option<String>,
    pub fachaufgabe: Option<String>,
    pub symbol: Option<String>,
    pub einheit: Option<String>,
    pub funktion: Option<String>,
    pub farbe: Option<String>,
    pub label: Option<String>,
    /// Ansichts-Zugehörigkeit (LFH-320): das FE sendet die aktive Ansicht; absent/NULL =
    /// auf allen Ansichten sichtbar.
    pub ansicht_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/freie-zeichen — anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    JsonBody(body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<FreiesZeichenAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let organisation = trimme(body.organisation.clone());
    let fachaufgabe = trimme(body.fachaufgabe.clone());
    let symbol = trimme(body.symbol.clone());
    let einheit = trimme(body.einheit.clone());
    let funktion = trimme(body.funktion.clone());
    let farbe = trimme(body.farbe.clone());
    let label = trimme(body.label.clone());
    let altform = body.grundzeichen.is_some()
        || [
            &organisation,
            &fachaufgabe,
            &symbol,
            &einheit,
            &funktion,
            &farbe,
        ]
        .iter()
        .any(|o| o.is_some());
    let (zeichen_spec, grundzeichen) = match (&body.zeichen_spec, altform) {
        (Some(_), true) => return Err(beide_formen()),
        (Some(spec), false) => (Some(pruefe_zeichen_spec(spec)?), None),
        (None, true) => match &body.grundzeichen {
            Some(g) => (None, Some(grundzeichen_pflicht(g)?)),
            // Overlays ohne Grundzeichen sind keine Form.
            None => return Err(keine_form()),
        },
        (None, false) => return Err(keine_form()),
    };
    // Ansicht muss zu diesem Einsatz gehören (LFH-738), sonst 404.
    crate::karten_ansicht::repo::pruefe_zugehoerig(&state.pool, einsatz_id, body.ansicht_id)
        .await?;

    let z = zeichen_repo::anlegen(
        &state.pool,
        einsatz_id,
        ZeichenNeu {
            lat: body.lat,
            lon: body.lon,
            zeichen_spec: zeichen_spec.as_deref(),
            grundzeichen: grundzeichen.as_deref(),
            organisation: organisation.as_deref(),
            fachaufgabe: fachaufgabe.as_deref(),
            symbol: symbol.as_deref(),
            einheit: einheit.as_deref(),
            funktion: funktion.as_deref(),
            farbe: farbe.as_deref(),
            label: label.as_deref(),
            ansicht_id: body.ansicht_id,
            erstellt_von: ctx.benutzer.id,
        },
    )
    .await?;

    sse_zeichen(&state, einsatz_id, z.id);
    Ok((StatusCode::CREATED, Json(z)))
}

/// PATCH-Body (LFH-306, Tri-State): **jedes** Feld ist optional — absent = unverändert.
/// Bewusst getrennt von [`AnlegenBody`]: der POST verlangt genau eine Form, der PATCH keine.
///
/// Die Form (LFH-836, design.md D4): `zeichen_spec` setzt die Zeichenbeschreibung und leert die
/// Altform; `grundzeichen` setzt die Altform und leert die Beschreibung. Beide sind **nicht**
/// Tri-State: absent oder `null` = unverändert, ein vorhandener leerer Wert bleibt 400.
/// Zeichenbeschreibung zusammen mit `grundzeichen` oder einem Overlay-Wert → 400. Die sieben
/// Overlay-Felder sind nullable und tragen den vollen Tri-State — vor LFH-306 nullte ein Patch,
/// der sie wegließ, sie stillschweigend mit; ein `null`-Overlay ist mit jeder Form verträglich.
#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub zeichen_spec: Option<String>,
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
    /// Verschieben/Freigeben (LFH-320): absent = unverändert, `null` = auf alle Ansichten.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ansicht_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/freie-zeichen/{zid} — echter Teil-Patch (LFH-306): Feld absent
/// = unverändert, `null`/`""` bei den Overlays = leeren. lat/lon sind NICHT verschiebbar
/// (v1). Schreibrecht + aktiv.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<FreiesZeichenAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let organisation = trimme_tri(body.organisation);
    let fachaufgabe = trimme_tri(body.fachaufgabe);
    let symbol = trimme_tri(body.symbol);
    let einheit = trimme_tri(body.einheit);
    let funktion = trimme_tri(body.funktion);
    let farbe = trimme_tri(body.farbe);
    let label = trimme_tri(body.label);
    let overlay_werte = [
        &organisation,
        &fachaufgabe,
        &symbol,
        &einheit,
        &funktion,
        &farbe,
    ]
    .iter()
    .any(|o| matches!(o, Some(Some(_))));
    if body.zeichen_spec.is_some() && (body.grundzeichen.is_some() || overlay_werte) {
        return Err(beide_formen());
    }
    // Nur GESENDETE Felder werden geprüft: ein absentes Feld ist schlicht kein Wunsch, ein
    // vorhandenes leeres bleibt 400.
    let zeichen_spec = body
        .zeichen_spec
        .as_deref()
        .map(pruefe_zeichen_spec)
        .transpose()?;
    let grundzeichen = body
        .grundzeichen
        .as_deref()
        .map(grundzeichen_pflicht)
        .transpose()?;
    // Ansicht (LFH-738): nur das Setzen wird geprüft, `null` gibt auf alle Ansichten frei.
    crate::karten_ansicht::repo::pruefe_zugehoerig(
        &state.pool,
        einsatz_id,
        body.ansicht_id.flatten(),
    )
    .await?;

    let z = zeichen_repo::patche(
        &state.pool,
        einsatz_id,
        zid,
        ZeichenPatch {
            zeichen_spec: zeichen_spec.as_deref(),
            grundzeichen: grundzeichen.as_deref(),
            organisation: organisation.as_ref().map(|v| v.as_deref()),
            fachaufgabe: fachaufgabe.as_ref().map(|v| v.as_deref()),
            symbol: symbol.as_ref().map(|v| v.as_deref()),
            einheit: einheit.as_ref().map(|v| v.as_deref()),
            funktion: funktion.as_ref().map(|v| v.as_deref()),
            farbe: farbe.as_ref().map(|v| v.as_deref()),
            label: label.as_ref().map(|v| v.as_deref()),
            ansicht_id: body.ansicht_id,
        },
    )
    .await?;

    sse_zeichen(&state, einsatz_id, zid);
    Ok(Json(z))
}

/// DELETE /api/einsaetze/{id}/freie-zeichen/{zid} — aufheben (Hard-Delete). Schreibrecht + aktiv.
pub async fn aufloesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    zeichen_repo::loese_auf(&state.pool, einsatz_id, zid).await?;
    sse_zeichen(&state, einsatz_id, zid);
    Ok(StatusCode::NO_CONTENT)
}

/// `grundzeichen` ist in der Altform Pflicht: nach Trim non-empty, sonst 400. Liefert den
/// getrimmten Wert.
///
/// 400 und nicht 422, weil das Feld ISOLIERT unbrauchbar ist — die Konvention bewertet mit
/// 422 erst den Zusammenhang (Objekt-Zustand). Siehe src/AGENTS.md, Abschnitt
/// „Backend — Statuscode-Konvention".
fn grundzeichen_pflicht(roh: &str) -> Result<String, AppError> {
    let g = pflicht(roh, "grundzeichen")?;
    Ok(g.to_string())
}

/// Beide Formen in einem Body → 400 (Spec `lagekarte-freie-zeichen`, „Beide Formate zugleich“).
///
/// 400 und nicht 422: der Body beschreibt für sich kein eindeutiges Zeichen — wie ein falsch
/// geformtes Feld, unabhängig vom gespeicherten Zustand. 422 bleibt dem Zusammenhang mit dem
/// Zeichen vorbehalten (`repo::patche`: Overlays ohne Grundzeichen an einem Spec-Zeichen).
fn beide_formen() -> AppError {
    AppError::Validation(
        "Entweder zeichen_spec oder das alte Format (grundzeichen mit Overlays) senden, nicht beides"
            .into(),
    )
}

/// Keine Form beim Anlegen → 400, wie ein fehlendes Pflichtfeld.
fn keine_form() -> AppError {
    AppError::Validation("zeichen_spec fehlt (im alten Format: grundzeichen)".into())
}
