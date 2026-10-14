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
use crate::routes::support::{deserialize_optional_field, trimme, trimme_tri, AnsichtFilter};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::de::IgnoredAny;
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

/// Felder des alten Bodys (Grundzeichen mit Overlays, vor LFH-836). Der Übergang ist mit LLH-1160
/// beendet: ein gesetzter Wert → 400 statt stillem Verwerfen, damit ein veralteter Client nicht
/// glaubt, er habe geschrieben. `null` gilt als nicht gesendet.
#[derive(Debug, Default, Deserialize)]
pub struct AltesFormat {
    grundzeichen: Option<IgnoredAny>,
    organisation: Option<IgnoredAny>,
    fachaufgabe: Option<IgnoredAny>,
    symbol: Option<IgnoredAny>,
    einheit: Option<IgnoredAny>,
    funktion: Option<IgnoredAny>,
    farbe: Option<IgnoredAny>,
}

impl AltesFormat {
    /// 400, sobald ein Feld der Altform einen Wert trägt.
    ///
    /// 400 und nicht 422: der Body ist für sich unbrauchbar, unabhängig vom gespeicherten Zeichen
    /// (`src/AGENTS.md`, Statuscode-Konvention).
    fn ablehnen(&self) -> Result<(), AppError> {
        let gesendet = [
            &self.grundzeichen,
            &self.organisation,
            &self.fachaufgabe,
            &self.symbol,
            &self.einheit,
            &self.funktion,
            &self.farbe,
        ]
        .iter()
        .any(|o| o.is_some());
        if gesendet {
            return Err(AppError::Validation(
                "Das alte Format (grundzeichen mit Overlays) wird nicht mehr angenommen; \
                 zeichen_spec senden"
                    .into(),
            ));
        }
        Ok(())
    }
}

/// POST-Body. Die Form steht allein in `zeichen_spec` (LFH-836, seit LLH-1160 Pflicht); fehlt sie
/// oder kommt der alte Body, → 400.
#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub lat: f64,
    pub lon: f64,
    /// Kanonische Zeichenbeschreibung (`serializeAnySpec`), geprüft durch
    /// [`pruefe_zeichen_spec`].
    pub zeichen_spec: Option<String>,
    pub label: Option<String>,
    /// Ansichts-Zugehörigkeit (LFH-320): das FE sendet die aktive Ansicht; absent/NULL =
    /// auf allen Ansichten sichtbar.
    pub ansicht_id: Option<i64>,
    #[serde(flatten)]
    pub alt: AltesFormat,
}

/// POST /api/einsaetze/{id}/freie-zeichen — anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    JsonBody(body): JsonBody<AnlegenBody>,
) -> Result<(StatusCode, Json<FreiesZeichenAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    body.alt.ablehnen()?;
    let zeichen_spec = match &body.zeichen_spec {
        Some(spec) => pruefe_zeichen_spec(spec)?,
        None => return Err(AppError::Validation("zeichen_spec fehlt".into())),
    };
    let label = trimme(body.label.clone());
    // Ansicht muss zu diesem Einsatz gehören (LFH-738), sonst 404.
    crate::karten_ansicht::repo::pruefe_zugehoerig(&state.pool, einsatz_id, body.ansicht_id)
        .await?;

    let z = zeichen_repo::anlegen(
        &state.pool,
        einsatz_id,
        ZeichenNeu {
            lat: body.lat,
            lon: body.lon,
            zeichen_spec: &zeichen_spec,
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
/// Bewusst getrennt von [`AnlegenBody`]: der POST verlangt die Form, der PATCH nicht.
///
/// `zeichen_spec` ist **nicht** Tri-State: absent oder `null` = unverändert, ein vorhandener
/// leerer Wert bleibt 400. Ein Patch ohne Zeichenbeschreibung (nur Bezeichnung oder Ansicht)
/// lässt die gespeicherte Form stehen. Der alte Body → 400 (LLH-1160).
#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub zeichen_spec: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
    /// Verschieben/Freigeben (LFH-320): absent = unverändert, `null` = auf alle Ansichten.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ansicht_id: Option<Option<i64>>,
    #[serde(flatten)]
    pub alt: AltesFormat,
}

/// PATCH /api/einsaetze/{id}/freie-zeichen/{zid} — echter Teil-Patch (LFH-306): Feld absent
/// = unverändert, `null`/`""` bei der Bezeichnung = leeren. lat/lon sind NICHT verschiebbar
/// (v1). Schreibrecht + aktiv.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<FreiesZeichenAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    body.alt.ablehnen()?;
    let label = trimme_tri(body.label);
    // Nur eine GESENDETE Beschreibung wird geprüft: ein absentes Feld ist schlicht kein Wunsch,
    // ein vorhandenes leeres bleibt 400.
    let zeichen_spec = body
        .zeichen_spec
        .as_deref()
        .map(pruefe_zeichen_spec)
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
