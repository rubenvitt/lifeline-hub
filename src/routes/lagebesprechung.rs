//! Routen der Lagebesprechung (LLH-1111): Stand, Verlauf, Abschluss und Termin.
//!
//! Gates strukturell über die Extractor-Typen — `EinsatzLesezugriff<Lagebesprechung>` (alle
//! Einsatzmitglieder mit Freigabe des Moduls, inkl. Beobachter) bzw.
//! `EinsatzSchreibzugriff<Lagebesprechung>` (Einsatzleitung und Führungspersonal nach
//! Einsatzrolle, LFH-1118; enthält `fordere_aktiv`). Die Freigabe des Moduls Stab wirkt hier
//! nicht (Spec `lagebesprechung`, „Eigenes Modul mit eigener Freigabe“).

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Lagebesprechung;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::lagebesprechung::repo::{self, AbschlussEingabe};
use crate::lagebesprechung::{LagebesprechungAnzeige, LagebesprechungStand, ENTSCHLUSS_MAX};
use crate::live::LiveEvent;
use crate::routes::support::{self, pflicht_max};
use crate::zeit::jetzt;

fn sse(state: &AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Lagebesprechung);
}

/// GET /api/einsaetze/{id}/lagebesprechung — Stand (Termin, Zahl, letzte Besprechung).
pub async fn load(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagebesprechung>,
) -> Result<Json<LagebesprechungStand>, AppError> {
    Ok(Json(repo::load_stand(&state.pool, ctx.einsatz.id).await?))
}

/// GET /api/einsaetze/{id}/lagebesprechungen — Verlauf, absteigend.
pub async fn list(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagebesprechung>,
) -> Result<Json<Vec<LagebesprechungAnzeige>>, AppError> {
    Ok(Json(repo::list(&state.pool, ctx.einsatz.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct LagebesprechungAbschluss {
    entschluss: String,
    /// Zeitpunkt der Besprechung; fehlt = jetzt.
    #[serde(default)]
    abgehalten_at: Option<String>,
    /// **Tri-State**: Feld fehlt = Termin unverändert, `null` = Termin löschen, Wert = Termin
    /// setzen.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    naechste_at: Option<Option<String>>,
}

/// POST /api/einsaetze/{id}/lagebesprechungen — Lagebesprechung abschliessen.
///
/// Die Antwort wird **nach** dem Schreiben frisch geladen: die Quittung darf keinen Zustand
/// tragen, den es nie gab (LFH-340/C5).
pub async fn abschliessen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagebesprechung>,
    JsonBody(req): JsonBody<LagebesprechungAbschluss>,
) -> Result<(StatusCode, Json<LagebesprechungStand>), AppError> {
    let einsatz_id = ctx.einsatz.id;

    // Ein leeres Pflichtfeld scheitert am Feld ISOLIERT → 400 (LFH-267). „Lage unverändert,
    // Maßnahmen fortführen" ist ein gültiger Entschluss, ein leerer Eintrag vom Typ
    // `entscheidung` wäre semantisch leer. Die Grenze hält den Snapshot unter der ETB-Grenze
    // (design.md D10).
    let entschluss = pflicht_max(&req.entschluss, "entschluss", ENTSCHLUSS_MAX)?;

    // Nicht parsebare Zeit → 400 (Feld isoliert). `normalisiere_zeit` läuft in der ROUTE, nie
    // im Repo.
    let abgehalten_at = match req.abgehalten_at.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => crate::etb::normalisiere_zeit(s)?,
        _ => jetzt(),
    };
    let naechste_at = match support::trimme_tri(req.naechste_at) {
        Some(Some(s)) => Some(Some(crate::etb::normalisiere_zeit(&s)?)),
        Some(None) => Some(None),
        None => None,
    };

    // Ein Termin VOR der Besprechung ist ein Zusammenhang zweier Felder → 422.
    if let Some(Some(t)) = &naechste_at {
        if t.as_str() <= abgehalten_at.as_str() {
            return Err(AppError::UnprocessableEntity(
                "naechste_at muss nach abgehalten_at liegen".into(),
            ));
        }
    }

    let ergebnis = repo::abschliessen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &AbschlussEingabe {
            entschluss,
            abgehalten_at,
            naechste_at,
        },
    )
    .await?;

    let stand = repo::load_stand(&state.pool, einsatz_id).await?;
    // Der ETB-Eintrag entstand im selben Commit → ETB-Kurzruf mitschicken.
    state.live.publiziere(einsatz_id, ergebnis.etb_eintrag_id);
    sse(&state, einsatz_id);
    // Den Einsatzkopf nur bei geändertem Termin (LFH-555, design.md D3): `einsatz` erreicht auch
    // Leser ohne Freigabe der Lagebesprechung und darf ihnen nicht mehr sagen, als der Kopf-GET
    // ohnehin zeigt. Mit `einsatz` geht auch `einsatzliste` (LFH-734).
    if ergebnis.termin_geaendert {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    Ok((StatusCode::CREATED, Json(stand)))
}

#[derive(Debug, Deserialize)]
pub struct TerminSetzen {
    /// **Pflichtschlüssel**: Wert = Termin setzen, `null` = kein Termin. Fehlt der Schlüssel, ist
    /// der Aufruf leer → 400 (ein PUT ohne Wert wäre kein Setzen).
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    naechste_at: Option<Option<String>>,
}

/// PUT /api/einsaetze/{id}/lagebesprechung/termin — Termin ohne Abschluss setzen (LLH-1111,
/// design.md D3). Kein ETB-Eintrag: der Termin ist eine Wiedervorlage, keine Entscheidung.
pub async fn set_termin(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagebesprechung>,
    JsonBody(req): JsonBody<TerminSetzen>,
) -> Result<Json<LagebesprechungStand>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let termin = match support::trimme_tri(req.naechste_at) {
        Some(Some(s)) => Some(crate::etb::normalisiere_zeit(&s)?),
        Some(None) => None,
        None => {
            return Err(AppError::Validation(
                "naechste_at fehlt (Zeitpunkt oder null)".into(),
            ))
        }
    };

    let geaendert = repo::set_termin(&state.pool, einsatz_id, termin.as_deref()).await?;
    let stand = repo::load_stand(&state.pool, einsatz_id).await?;
    if geaendert {
        sse(&state, einsatz_id);
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    Ok(Json(stand))
}
