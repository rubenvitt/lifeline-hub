//! Katalog der Führungsfunktionen (LFH-549).
//!
//! GET /api/fuehrungsfunktionen — wirksamer Katalog der eigenen Org, jeder Angemeldete.
//! PUT /api/org-fuehrungsfunktionen/{funktion} — Label/S7-Schalter setzen, nur system_rolle=admin.
//!
//! `org_id` stammt stets aus dem eingeloggten Benutzer, nie aus dem Body (Org-Isolation).

use axum::extract::State;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::fuehrung::{repo, Fuehrungsfunktion, FuehrungsfunktionAnzeige, LABEL_MAX};

/// GET /api/fuehrungsfunktionen
pub async fn katalog(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<FuehrungsfunktionAnzeige>>, AppError> {
    let mut conn = state.pool.acquire().await?;
    let karte = repo::labelkarte(&mut conn, benutzer.org_id).await?;
    Ok(Json(karte.katalog()))
}

#[derive(Debug, Deserialize)]
pub struct FunktionSetzen {
    /// Leer oder fehlend = Standardlabel.
    #[serde(default)]
    label: Option<String>,
    /// Nur für `s7`; fehlend = unverändert.
    #[serde(default)]
    aktiv: Option<bool>,
}

/// PUT /api/org-fuehrungsfunktionen/{funktion} — liefert den neuen wirksamen Katalog.
pub async fn setzen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(rohwert): PfadParam<String>,
    JsonBody(req): JsonBody<FunktionSetzen>,
) -> Result<Json<Vec<FuehrungsfunktionAnzeige>>, AppError> {
    let funktion = Fuehrungsfunktion::parse(&rohwert)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Führungsfunktion '{rohwert}'")))?;
    let label = req
        .label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty());
    if let Some(l) = label {
        if l.chars().count() > LABEL_MAX {
            return Err(AppError::Validation(format!(
                "label darf höchstens {LABEL_MAX} Zeichen lang sein"
            )));
        }
    }
    if req.aktiv.is_some() && funktion != Fuehrungsfunktion::S7 {
        return Err(AppError::UnprocessableEntity(
            "Nur S7 lässt sich ein- und ausschalten".into(),
        ));
    }
    let mut conn = state.pool.acquire().await?;
    repo::setzen(
        &mut conn,
        benutzer.org_id,
        funktion,
        label,
        req.aktiv,
        benutzer.id,
    )
    .await?;
    let karte = repo::labelkarte(&mut conn, benutzer.org_id).await?;
    Ok(Json(karte.katalog()))
}
