//! HTTP-Routen für die org-weiten Einstellungen (admin-einstellungen, Task 4 + 5).
//!
//! GET  /api/org-einstellungen — Lesen: system_rolle=admin ODER org_rolle=fuehrungskraft.
//! PUT  /api/org-einstellungen — Schreiben: nur system_rolle=admin (sonst 403).
//!
//! GET  /api/org-modul-einstellungen — Lesen: admin ODER fuehrungskraft.
//! PUT  /api/org-modul-einstellungen/:modul_key — Schreiben: nur system_rolle=admin (sonst 403).
//!
//! `org_id` stammt stets aus dem eingeloggten Benutzer; nie aus dem Body (Org-Isolation).

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einsatz::einstellungen::{
    ist_gueltige_frist_min, ist_gueltige_geocoder_url, ist_gueltige_retention_dauer,
    ist_gueltige_zeitzone, ist_gueltiges_einheiten_system, ist_gueltiges_koordinatenformat,
    ist_gueltiges_nummer_praefix, ist_gueltiges_zeitformat,
};
use crate::einsatz::modul::{ist_gueltige_benoetigte_rolle, ist_gueltiger_modul_key};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::org::einstellungen::{self, OrgEinstellungenAnzeige, OrgEinstellungenDaten};
use crate::org::modul_einstellung;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use std::collections::HashMap;

/// PUT-Body für org-weite Einstellungen. Felder spiegeln `EinstellungenUpdate` (Einsatz)
/// ohne einsatzspezifische Felder (kein standard_modul, basemap_modus, karten_zoom_start,
/// fachebenen_sichtbar, keine Nummern-Startwerte).
#[derive(Debug, Deserialize)]
pub struct OrgEinstellungenUpdate {
    pub zeitzone: Option<String>,
    pub zeitformat: Option<String>,
    pub einheiten: Option<String>,
    pub koordinatenformat: Option<String>,
    // Aufbewahrung.
    pub retention_dauer_tage: Option<i64>,
    // Nummernkreis-Präfixe (display-only).
    pub etb_nummer_praefix: Option<String>,
    pub meldung_nummer_praefix: Option<String>,
    pub auftrag_nummer_praefix: Option<String>,
    // Default-Fristen.
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    /// Auto-ETB-Dual-Publish: `false` schaltet ab (gespeichert als 0), `true`/fehlend = an.
    /// Identisch mit `EinstellungenUpdate.auto_etb_eintraege` — bool auf Draht, i64 intern.
    pub auto_etb_eintraege: Option<bool>,
    /// Geocoder-Basis-URL (nur http/https); serverseitig für Ort-Vorschau (Task 9).
    pub geocoder_url: Option<String>,
}

/// GET /api/org-einstellungen — Org-weite Einstellungen lesen.
/// Berechtigung: system_rolle=admin ODER org_rolle=fuehrungskraft.
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<OrgEinstellungenAnzeige>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let einst = einstellungen::laden_oder_default(&state.pool, benutzer.org_id).await?;
    Ok(Json(einst.anzeige()))
}

/// PUT /api/org-einstellungen — Org-weite Einstellungen setzen (Vollersatz).
/// Berechtigung: nur system_rolle=admin (fuehrungskraft → 403).
pub async fn setzen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(req): JsonBody<OrgEinstellungenUpdate>,
) -> Result<Json<OrgEinstellungenAnzeige>, AppError> {
    // Anzeige-Konventionen: bereinigen + Whitelist (400 bei Fehler).
    let zeitzone = bereinige(req.zeitzone);
    if let Some(z) = zeitzone.as_deref() {
        if !ist_gueltige_zeitzone(z) {
            return Err(AppError::Validation("Ungültige zeitzone".into()));
        }
    }
    let zeitformat = bereinige(req.zeitformat);
    if let Some(f) = zeitformat.as_deref() {
        if !ist_gueltiges_zeitformat(f) {
            return Err(AppError::Validation("Ungültiges zeitformat".into()));
        }
    }
    let einheiten = bereinige(req.einheiten);
    if let Some(e) = einheiten.as_deref() {
        if !ist_gueltiges_einheiten_system(e) {
            return Err(AppError::Validation("Ungültiges einheiten-System".into()));
        }
    }
    let koordinatenformat = bereinige(req.koordinatenformat);
    if let Some(k) = koordinatenformat.as_deref() {
        if !ist_gueltiges_koordinatenformat(k) {
            return Err(AppError::Validation("Ungültiges koordinatenformat".into()));
        }
    }

    // Nummernkreis-Präfixe: bereinigen + Whitelist.
    let etb_nummer_praefix = bereinige(req.etb_nummer_praefix);
    let meldung_nummer_praefix = bereinige(req.meldung_nummer_praefix);
    let auftrag_nummer_praefix = bereinige(req.auftrag_nummer_praefix);
    for p in [
        &etb_nummer_praefix,
        &meldung_nummer_praefix,
        &auftrag_nummer_praefix,
    ] {
        if let Some(v) = p.as_deref() {
            if !ist_gueltiges_nummer_praefix(v) {
                return Err(AppError::Validation(
                    "Ungültiges Nummern-Präfix (max. 8 Zeichen, nur A-Z a-z 0-9 - _ / Leerzeichen)"
                        .into(),
                ));
            }
        }
    }

    // Default-Fristen validieren (400).
    for f in [
        req.meldung_bestaetigung_frist_min,
        req.auftrag_quittierung_frist_min,
    ] {
        if let Some(v) = f {
            if !ist_gueltige_frist_min(v) {
                return Err(AppError::Validation(
                    "Default-Frist muss zwischen 1 und 10080 Minuten liegen".into(),
                ));
            }
        }
    }

    // Aufbewahrungs-Dauer validieren (400): nur ein gesetzter Wert; None = keine Politik.
    if let Some(v) = req.retention_dauer_tage {
        if !ist_gueltige_retention_dauer(v) {
            return Err(AppError::Validation(
                "Aufbewahrungs-Dauer muss zwischen 1 und 3650 Tagen liegen".into(),
            ));
        }
    }

    // Geocoder-URL validieren (400): nur http/https zulässig.
    let geocoder_url = bereinige(req.geocoder_url);
    if let Some(u) = geocoder_url.as_deref() {
        if !ist_gueltige_geocoder_url(u) {
            return Err(AppError::Validation(
                "Ungültige Geocoder-URL (nur http/https)".into(),
            ));
        }
    }

    let gespeichert = einstellungen::speichern(
        &state.pool,
        benutzer.org_id,
        benutzer.id,
        OrgEinstellungenDaten {
            zeitzone: zeitzone.as_deref(),
            zeitformat: zeitformat.as_deref(),
            einheiten: einheiten.as_deref(),
            koordinatenformat: koordinatenformat.as_deref(),
            retention_dauer_tage: req.retention_dauer_tage,
            etb_nummer_praefix: etb_nummer_praefix.as_deref(),
            meldung_nummer_praefix: meldung_nummer_praefix.as_deref(),
            auftrag_nummer_praefix: auftrag_nummer_praefix.as_deref(),
            meldung_bestaetigung_frist_min: req.meldung_bestaetigung_frist_min,
            auftrag_quittierung_frist_min: req.auftrag_quittierung_frist_min,
            // bool → 0/1; None bleibt None (= Default an).
            auto_etb_eintraege: req.auto_etb_eintraege.map(i64::from),
            geocoder_url: geocoder_url.as_deref(),
        },
    )
    .await?;
    Ok(Json(gespeichert.anzeige()))
}

/// Trimmt und filtert leere Strings (None bei leerem Wert).
fn bereinige(feld: Option<String>) -> Option<String> {
    feld.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

// ── Modul-Rollen-Defaults (Task 5) ──────────────────────────────────────────

/// PUT-Body für einen Modul-Rollen-Default.
#[derive(Debug, serde::Deserialize)]
pub struct ModulRolleUpdate {
    /// `None` = freier Zugang (keine Rolle erforderlich), `Some(rolle)` = Pflichtrolle.
    pub benoetigte_rolle: Option<String>,
}

/// GET /api/org-modul-einstellungen — Alle Modul-Rollen-Defaults lesen.
/// Berechtigung: system_rolle=admin ODER org_rolle=fuehrungskraft.
/// Antwort: `{ <modul_key>: <rolle|null> }` — sparse (nur gesetzte Keys).
pub async fn modul_einstellungen_lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<HashMap<String, Option<String>>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let map = modul_einstellung::laden_alle(&state.pool, benutzer.org_id).await?;
    Ok(Json(map))
}

/// PUT /api/org-modul-einstellungen/:modul_key — Rollen-Default für ein Modul setzen.
/// Berechtigung: nur system_rolle=admin (fuehrungskraft → 403).
/// Validierung: modul_key muss bekannt sein; benoetigte_rolle None (frei) oder gültige Rolle.
pub async fn modul_einstellung_setzen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(modul_key): Path<String>,
    JsonBody(req): JsonBody<ModulRolleUpdate>,
) -> Result<(), AppError> {
    // Modul-Key validieren (400 bei unbekanntem Key).
    if !ist_gueltiger_modul_key(&modul_key) {
        return Err(AppError::Validation(format!(
            "Unbekannter modul_key '{modul_key}'"
        )));
    }

    // Rolle bereinigen (Leerstring → None = frei) und validieren.
    let rolle = bereinige(req.benoetigte_rolle);
    if let Some(r) = rolle.as_deref() {
        if !ist_gueltige_benoetigte_rolle(r) {
            return Err(AppError::Validation(format!(
                "Ungültige benoetigte_rolle '{r}' (erlaubt: admin, fuehrungskraft)"
            )));
        }
    }

    modul_einstellung::setzen(
        &state.pool,
        benutzer.org_id,
        &modul_key,
        rolle.as_deref(),
        benutzer.id,
    )
    .await?;
    Ok(())
}
