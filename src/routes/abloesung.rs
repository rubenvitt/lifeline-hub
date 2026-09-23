//! Routen der Ablösung (LFH-635): Schichten von Einheiten, Rhythmus-Vorgabe je Abschnitt,
//! Vollzug mit Folgeschicht und Rücknahme.
//!
//! Gates strukturell über `EinsatzLesezugriff<Abloesung>` (alle Einsatzmitglieder inkl.
//! Beobachter) bzw. `EinsatzSchreibzugriff<Abloesung>` (Schreibrecht, aktiver Einsatz, Modul).
//! Zeiten werden hier normalisiert (`etb::normalisiere_zeit`, 400 bei Unparsbarem), nie im
//! Repo — dieselbe Arbeitsteilung wie im Bestand.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::abloesung::repo::{self, AenderungEingabe, BeginnEingabe};
use crate::abloesung::{
    AbloesungAnzeige, AbloesungStatus, AbloesungVollzugAnzeige, AbloesungVorgabeAnzeige,
    RHYTHMUS_MAX_MINUTEN,
};
use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Abloesung;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::routes::support;

/// Aktuelle Server-Zeit im SQLite-Format.
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Listen-Refresh für Ablösungs-Leser. Ohne `art` — nur der Scheduler setzt `art` und löst
/// damit den Hinweis in der AlarmZentrale aus (Muster wie `erinnerung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Abloesung,
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// Nach einem wirksamen Schreibvorgang: ETB-Kurzruf (der Eintrag entstand im selben Commit)
/// und Listen-Refresh.
fn publiziere(state: &AppState, einsatz_id: i64, etb_id: Option<i64>) {
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse(state, einsatz_id);
}

/// Ein Rhythmus außerhalb von 1..=7 Tagen scheitert am Feld isoliert → 400 (LFH-267).
fn pruefe_rhythmus(minuten: i64) -> Result<i64, AppError> {
    if minuten <= 0 || minuten > RHYTHMUS_MAX_MINUTEN {
        return Err(AppError::Validation(format!(
            "rhythmus_minuten muss zwischen 1 und {RHYTHMUS_MAX_MINUTEN} liegen"
        )));
    }
    Ok(minuten)
}

/// Optionale Zeitangabe: fehlt/leer → `None`, sonst normalisiert (400 bei Unparsbarem).
fn zeit(eingabe: Option<String>) -> Result<Option<String>, AppError> {
    match eingabe.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => Ok(Some(crate::etb::normalisiere_zeit(s)?)),
        _ => Ok(None),
    }
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `laufend` | `abgeloest`; fehlt = alle. Als `String`, damit ein unbekannter Wert eine
    /// benannte 400 liefert.
    #[serde(default)]
    status: Option<String>,
}

/// GET /api/einsaetze/{id}/abloesungen
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Abloesung>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<AbloesungAnzeige>>, AppError> {
    let status = match params.status.as_deref() {
        None | Some("") => None,
        Some(s) => Some(AbloesungStatus::parse(s).ok_or_else(|| {
            AppError::Validation(format!(
                "Unbekannter Status '{s}' (erlaubt: laufend, abgeloest)"
            ))
        })?),
    };
    Ok(Json(
        repo::liste(&state.pool, ctx.einsatz.id, status, &jetzt()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct Beginnen {
    einheit_id: i64,
    #[serde(default)]
    beginn_at: Option<String>,
    #[serde(default)]
    rhythmus_minuten: Option<i64>,
}

/// POST /api/einsaetze/{id}/abloesungen — Schicht beginnen.
pub async fn beginnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    JsonBody(req): JsonBody<Beginnen>,
) -> Result<(StatusCode, Json<AbloesungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let jetzt = jetzt();
    let rhythmus_minuten = req.rhythmus_minuten.map(pruefe_rhythmus).transpose()?;
    let beginn_at = zeit(req.beginn_at)?.unwrap_or_else(|| jetzt.clone());
    let (anzeige, etb_id) = repo::beginnen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &BeginnEingabe {
            einheit_id: req.einheit_id,
            beginn_at,
            rhythmus_minuten,
        },
        &jetzt,
    )
    .await?;
    publiziere(&state, einsatz_id, Some(etb_id));
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct Aendern {
    #[serde(default)]
    beginn_at: Option<String>,
    /// Tri-State: fehlt = unverändert, `null` = zurück zur Abschnittsvorgabe.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    rhythmus_minuten: Option<Option<i64>>,
    /// Tri-State: fehlt = unverändert, `null` = Planung aufheben.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    abloesende_einheit_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/abloesungen/{aid}
pub async fn aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<Aendern>,
) -> Result<Json<AbloesungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let rhythmus_minuten = match req.rhythmus_minuten {
        Some(Some(r)) => Some(Some(pruefe_rhythmus(r)?)),
        andere => andere,
    };
    let eingabe = AenderungEingabe {
        beginn_at: zeit(req.beginn_at)?,
        rhythmus_minuten,
        abloesende_einheit_id: req.abloesende_einheit_id,
    };
    let (anzeige, etb_id) = repo::aendern(
        &state.pool,
        einsatz_id,
        aid,
        ctx.benutzer.id,
        &eingabe,
        &jetzt(),
    )
    .await?;
    if etb_id.is_some() {
        publiziere(&state, einsatz_id, etb_id);
    }
    Ok(Json(anzeige))
}

#[derive(Debug, Deserialize)]
pub struct Vollziehen {
    #[serde(default)]
    vollzogen_at: Option<String>,
    #[serde(default)]
    abloesende_einheit_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/abloesungen/{aid}/vollzug
pub async fn vollziehen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<Vollziehen>,
) -> Result<Json<AbloesungVollzugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let jetzt = jetzt();
    let vollzogen_at = zeit(req.vollzogen_at)?.unwrap_or_else(|| jetzt.clone());
    let (anzeige, etb_id) = repo::vollziehen(
        &state.pool,
        einsatz_id,
        aid,
        ctx.benutzer.id,
        &vollzogen_at,
        req.abloesende_einheit_id,
        &jetzt,
    )
    .await?;
    publiziere(&state, einsatz_id, Some(etb_id));
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/abloesungen/{aid}/vollzug/zuruecknehmen
pub async fn zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
) -> Result<Json<AbloesungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (anzeige, etb_id) =
        repo::zuruecknehmen(&state.pool, einsatz_id, aid, ctx.benutzer.id, &jetzt()).await?;
    publiziere(&state, einsatz_id, Some(etb_id));
    Ok(Json(anzeige))
}

/// GET /api/einsaetze/{id}/abloesungen/vorgaben
pub async fn vorgaben(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Abloesung>,
) -> Result<Json<Vec<AbloesungVorgabeAnzeige>>, AppError> {
    Ok(Json(repo::vorgaben(&state.pool, ctx.einsatz.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct VorgabeSetzen {
    /// `null` = Vorgabe entfernen. Das Feld ist Pflicht (fehlt → 400), damit ein leerer Body
    /// nicht still als „entfernen" gelesen wird — serde nähme ein fehlendes `Option` sonst
    /// als `None`, deshalb der Tri-State.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    rhythmus_minuten: Option<Option<i64>>,
}

/// PUT /api/einsaetze/{id}/abloesungen/vorgaben/{abschnitt_id}
pub async fn vorgabe_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, abschnitt_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<VorgabeSetzen>,
) -> Result<Json<Vec<AbloesungVorgabeAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let rhythmus = req
        .rhythmus_minuten
        .ok_or_else(|| AppError::Validation("rhythmus_minuten fehlt (null = entfernen)".into()))?
        .map(pruefe_rhythmus)
        .transpose()?;
    let etb_id = repo::vorgabe_setzen(
        &state.pool,
        einsatz_id,
        abschnitt_id,
        ctx.benutzer.id,
        rhythmus,
        &jetzt(),
    )
    .await?;
    if etb_id.is_some() {
        publiziere(&state, einsatz_id, etb_id);
    }
    Ok(Json(repo::vorgaben(&state.pool, einsatz_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rhythmus_ausserhalb_ist_400() {
        for r in [0, -5, RHYTHMUS_MAX_MINUTEN + 1] {
            assert_eq!(
                pruefe_rhythmus(r).unwrap_err().status(),
                StatusCode::BAD_REQUEST
            );
        }
        assert_eq!(pruefe_rhythmus(1).unwrap(), 1);
        assert_eq!(
            pruefe_rhythmus(RHYTHMUS_MAX_MINUTEN).unwrap(),
            RHYTHMUS_MAX_MINUTEN
        );
    }

    #[test]
    fn unparsbare_zeit_ist_400() {
        assert_eq!(
            zeit(Some("gestern".into())).unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(zeit(Some("  ".into())).unwrap(), None);
        assert_eq!(zeit(None).unwrap(), None);
    }
}
