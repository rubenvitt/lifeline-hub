//! Präsenz an Einzelangaben melden und beenden (LLH-1946, Entwurf
//! `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`, D4).
//!
//! Zwei Routen, weil jeder Handler genau einen Gate-Typ trägt (ADR-0005): Einsatzkopf und
//! Führungsstelle mit dem Gate ihres PATCH (`EinsatzVerwaltungszugriff`), die Einheit mit
//! `EinsatzSchreibzugriff<Einheiten>`. Geräte stehen in keiner Routenliste und bekommen 403.
//! Nichts wird gespeichert; ein Spiegel lehnt deshalb nicht über seine Schutz-Trigger ab, dort
//! öffnet aber auch keine Eingabe.

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzSchreibzugriff, EinsatzVerwaltungszugriff};
use crate::einsatz::modul::Einheiten;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::praesenz::{pruefe_meldung, PraesenzEintrag, PraesenzObjekt};
use axum::extract::State;
use axum::http::StatusCode;
use serde::Deserialize;

/// PUT `…/praesenz` (Einsatzkopf, Führungsstelle).
#[derive(Debug, Deserialize)]
pub struct PraesenzEinsatzBody {
    pub objekt: PraesenzObjekt,
    pub felder: Vec<String>,
    pub fenster: String,
}

/// PUT `…/units/{eid}/presence`.
#[derive(Debug, Deserialize)]
pub struct PraesenzFeldBody {
    pub felder: Vec<String>,
    pub fenster: String,
}

/// DELETE auf beiden Pfaden: beendet die Präsenz des Fensters an genau diesen Angaben. Mit den
/// Angaben, damit ein spätes DELETE eines geschlossenen Feldes nicht das neu geöffnete beendet.
/// Den Body des PUT daneben zu schicken genügt.
pub type PraesenzEinsatzEndeBody = PraesenzEinsatzBody;
pub type PraesenzFeldEndeBody = PraesenzFeldBody;

/// PUT /api/einsaetze/{id}/praesenz — beginnt oder verlängert die Präsenz eines Fensters an
/// Angaben von Einsatzkopf oder Führungsstelle. 204.
pub async fn einsatz_melden(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    JsonBody(body): JsonBody<PraesenzEinsatzBody>,
) -> Result<StatusCode, AppError> {
    if body.objekt == PraesenzObjekt::Einheit {
        return Err(AppError::Validation(
            "objekt: eine Einheit meldet über ihre eigene Route".into(),
        ));
    }
    pruefe_meldung(body.objekt, &body.felder, &body.fenster)?;
    state.live.praesenz_setzen(
        ctx.einsatz.id,
        PraesenzEintrag {
            objekt: body.objekt,
            einheit_id: None,
            felder: body.felder,
            benutzer_id: ctx.benutzer.id,
            von: ctx.benutzer.anzeigename.clone(),
            fenster: body.fenster,
        },
    )?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/praesenz — idempotent, 204; Body wie beim PUT.
pub async fn einsatz_beenden(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    JsonBody(body): JsonBody<PraesenzEinsatzEndeBody>,
) -> Result<StatusCode, AppError> {
    state.live.praesenz_entfernen(
        ctx.einsatz.id,
        &PraesenzEintrag {
            objekt: body.objekt,
            einheit_id: None,
            felder: body.felder,
            benutzer_id: ctx.benutzer.id,
            von: String::new(),
            fenster: body.fenster,
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /api/einsaetze/{id}/units/{eid}/presence — Präsenz an Angaben einer Einheit. Eine
/// Einheit eines anderen Einsatzes ist 404, eine aufgelöste 409 (wie der PATCH daneben).
pub async fn einheit_melden(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_id, eid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PraesenzFeldBody>,
) -> Result<StatusCode, AppError> {
    pruefe_meldung(PraesenzObjekt::Einheit, &body.felder, &body.fenster)?;
    let mut conn = state.pool.acquire().await?;
    crate::einheit::repo::require_aktiv_tx(&mut conn, ctx.einsatz.id, eid).await?;
    drop(conn);
    state.live.praesenz_setzen(
        ctx.einsatz.id,
        PraesenzEintrag {
            objekt: PraesenzObjekt::Einheit,
            einheit_id: Some(eid),
            felder: body.felder,
            benutzer_id: ctx.benutzer.id,
            von: ctx.benutzer.anzeigename.clone(),
            fenster: body.fenster,
        },
    )?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/units/{eid}/presence — idempotent, 204; Body wie beim PUT.
pub async fn einheit_beenden(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_id, eid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PraesenzFeldEndeBody>,
) -> Result<StatusCode, AppError> {
    state.live.praesenz_entfernen(
        ctx.einsatz.id,
        &PraesenzEintrag {
            objekt: PraesenzObjekt::Einheit,
            einheit_id: Some(eid),
            felder: body.felder,
            benutzer_id: ctx.benutzer.id,
            von: String::new(),
            fenster: body.fenster,
        },
    );
    Ok(StatusCode::NO_CONTENT)
}
