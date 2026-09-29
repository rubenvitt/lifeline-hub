//! HTTP-Routen für die Präferenzen des angemeldeten Benutzers (LFH-391).
//!
//! GET /api/benutzer-einstellungen              — eigenes Fach lesen.
//! PUT /api/benutzer-einstellungen/{schluessel} — einen Schlüssel setzen (UPSERT).
//!
//! **Berechtigung ist die Sitzung selbst:** die `benutzer_id` stammt ausschließlich aus
//! [`CurrentUser`], nie aus Pfad oder Body. Es gibt keinen Endpunkt für ein fremdes Fach; die
//! Trennung ist strukturell.
//!
//! Alle Ablehnungen bewerten ein Feld isoliert (unbekannter Schlüssel, leerer Wert, Überlänge)
//! → jeweils 400, nie 422.

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

/// PUT-Body: der neue Wert des adressierten Schlüssels. Kein `Option<String>`: ein fehlendes
/// Feld ist keine Löschgeste, sondern eine kaputte Anfrage (400).
#[derive(Debug, Deserialize)]
pub struct WertUpdate {
    pub wert: String,
}

/// GET /api/benutzer-einstellungen — die eigenen Präferenzen. Ohne gespeicherte Zeile
/// `{"eintraege":{}}` ohne `geaendert_at` — kein 404, „noch nie geschrieben“ ist beim ersten
/// Login der Normalfall.
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<BenutzerEinstellungenAnzeige>, AppError> {
    Ok(Json(repo::laden(&state.pool, benutzer.id).await?))
}

/// PUT /api/benutzer-einstellungen/{schluessel} — einen Schlüssel setzen (UPSERT). Antwortet mit
/// dem vollen neuen Stand, damit der Aufrufer keinen zweiten Request braucht.
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
