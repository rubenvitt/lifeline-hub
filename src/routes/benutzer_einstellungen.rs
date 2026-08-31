//! HTTP-Routen für die Präferenzen des angemeldeten Benutzers (LFH-391 · Etappe D).
//!
//! GET /api/benutzer-einstellungen              — eigenes Fach lesen.
//! PUT /api/benutzer-einstellungen/{schluessel} — einen Schlüssel setzen (UPSERT).
//!
//! **Berechtigung ist die Sitzung selbst.** Es gibt keine Rollenprüfung: jeder angemeldete
//! Benutzer darf seine eigenen Präferenzen lesen und schreiben, und niemand kommt an ein
//! fremdes Fach — die `benutzer_id` stammt ausschließlich aus [`CurrentUser`], nie aus Pfad
//! oder Body. Es gibt bewusst KEINEN Endpunkt, der ein fremdes Fach adressieren könnte;
//! damit ist die Trennung strukturell und nicht bloß geprüft.
//!
//! Statuscode-Konvention (LFH-267): alle drei Ablehnungen bewerten **ein Feld isoliert** —
//! unbekannter Schlüssel (Pfad-Segment, wie ein unbekannter Enum-Wert), leerer Wert
//! (vorhandenes, aber leeres Pflichtfeld) und Überlänge → jeweils **400**, nie 422. Es gibt
//! hier keinen Zusammenhang zweier Felder und keinen Zustand, der etwas verböte.

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::benutzer_einstellungen::{
    ist_gueltiger_schluessel, repo, BenutzerEinstellungenAnzeige, WERT_MAX_LAENGE,
};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use axum::extract::State;
use axum::Json;
use serde::Deserialize;

/// PUT-Body: der neue Wert des adressierten Schlüssels.
///
/// Kein `Option<String>`: ein fehlendes Feld ist keine Löschgeste, sondern eine kaputte
/// Anfrage — der Extractor lehnt sie mit 400 im `{error}`-Envelope ab.
#[derive(Debug, Deserialize)]
pub struct WertUpdate {
    pub wert: String,
}

/// GET /api/benutzer-einstellungen — die Präferenzen des angemeldeten Benutzers.
/// Ohne gespeicherte Zeile: `{"eintraege":{}}` ohne `geaendert_at` (kein 404 — „noch nie
/// geschrieben" ist der Normalfall beim ersten Login, keine fehlende Ressource).
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<BenutzerEinstellungenAnzeige>, AppError> {
    Ok(Json(repo::laden(&state.pool, benutzer.id).await?))
}

/// PUT /api/benutzer-einstellungen/{schluessel} — einen Schlüssel setzen (UPSERT).
///
/// Antwortet mit dem **vollen** neuen Stand, nicht nur mit dem geschriebenen Schlüssel:
/// der Aufrufer hält damit nach jedem Schreibvorgang denselben Stand wie nach einem GET
/// und braucht keinen zweiten Request.
pub async fn setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(schluessel): PfadParam<String>,
    JsonBody(req): JsonBody<WertUpdate>,
) -> Result<Json<BenutzerEinstellungenAnzeige>, AppError> {
    if !ist_gueltiger_schluessel(&schluessel) {
        return Err(AppError::Validation(format!(
            "Unbekannter Einstellungs-Schlüssel '{schluessel}'"
        )));
    }

    let wert = req.wert.trim();
    if wert.is_empty() {
        return Err(AppError::Validation(
            "wert darf nicht leer sein (zum Leeren einer Liste '[]' senden)".into(),
        ));
    }
    if wert.chars().count() > WERT_MAX_LAENGE {
        return Err(AppError::Validation(format!(
            "wert ist zu lang (max. {WERT_MAX_LAENGE} Zeichen)"
        )));
    }

    repo::setzen(&state.pool, benutzer.id, &schluessel, wert).await?;
    Ok(Json(repo::laden(&state.pool, benutzer.id).await?))
}
