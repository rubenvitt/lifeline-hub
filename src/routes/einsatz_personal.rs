use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "personal";
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::personal::disposition_repo::{self, AdhocDaten};
use crate::personal::status_repo;
use crate::personal::{EinsatzPersonalAnzeige, FuehrungskraftKarte};
use crate::routes::support::trimme;
use crate::staerke::StaerkePosition;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Person-Disposition hat sich geändert. Nutzt das bestehende
/// `person`-Event-Tag (kein neues `personal`-Tag, sonst bricht der Frontend-Filter).
fn sse_personal(state: &AppState, einsatz_id: i64, ep_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "person_id": ep_id }).to_string();
    state.live.publiziere_event(einsatz_id, "person", data);
}

/// Schreibt einen automatischen System-ETB-Eintrag und publiziert ihn live
/// (wie `routes::einsatz_fahrzeug::etb_system`).
async fn etb_system(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    inhalt: &str,
) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

/// Personen-Bezeichnung für ETB-Texte: Name, optional mit Funktion in Klammern.
fn person_bezeichnung(a: &EinsatzPersonalAnzeige) -> String {
    match a.funktion.as_deref() {
        Some(f) if !f.is_empty() => format!("{} ({})", a.name, f),
        _ => a.name.clone(),
    }
}

/// Validiert eine optionale Stärke-Position gegen das Enum (leer/None erlaubt).
fn pruefe_position(p: &Option<String>) -> Result<(), AppError> {
    if let Some(s) = p.as_deref() {
        if StaerkePosition::parse(s).is_none() {
            return Err(AppError::Validation("Ungültige Stärke-Position".into()));
        }
    }
    Ok(())
}

/// GET /api/einsaetze/{id}/personal — disponiertes Personal (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzPersonalAnzeige>>, AppError> {
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
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub name: String,
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    pub staerke_position: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub personal_id: Option<i64>,
    pub staerke_position: Option<String>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/personal — Stamm-Person disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzPersonalAnzeige>), AppError> {
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

    let ep_id = match (body.personal_id, body.adhoc) {
        (Some(personal_id), None) => {
            pruefe_position(&body.staerke_position)?;
            disposition_repo::disponiere_stamm(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                personal_id,
                body.staerke_position.as_deref(),
                benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let name = adhoc.name.trim().to_string();
            if name.is_empty() {
                return Err(AppError::Validation("Name darf nicht leer sein".into()));
            }
            pruefe_position(&adhoc.staerke_position)?;
            let funktion = trimme(adhoc.funktion);
            let traeger = trimme(adhoc.traegerorganisation);
            let position = trimme(adhoc.staerke_position);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                AdhocDaten {
                    name: &name,
                    funktion: funktion.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                    staerke_position: position.as_deref(),
                },
                benutzer.id,
            )
            .await?
        }
        (None, None) => {
            return Err(AppError::Validation(
                "Entweder personal_id (Stamm) oder adhoc angeben".into(),
            ))
        }
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "Entweder personal_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Person «{}» disponiert", person_bezeichnung(&anzeige)),
    )
    .await?;
    sse_personal(&state, einsatz_id, ep_id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    /// Tri-State (LFH-4): fehlend = unverändert, `null` = Override entfernen, Wert = setzen.
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub staerke_position: Option<Option<String>>,
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/personal/{ep_id} — Status, Stärke-Position und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ep_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzPersonalAnzeige>, AppError> {
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

    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }
    // staerke_position ist Tri-State; nur ein konkret gesetzter Wert wird validiert.
    if let Some(Some(pos)) = &body.staerke_position {
        if StaerkePosition::parse(pos).is_none() {
            return Err(AppError::Validation("Ungültige Stärke-Position".into()));
        }
    }

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    // Bemerkung: gesetzt (auch "") → setzen; absent/null → unverändert (COALESCE).
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        ep_id,
        body.status_id,
        body.staerke_position.as_ref().map(|o| o.as_deref()),
        bemerkung,
    )
    .await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;

    if vorher.status_id != nachher.status_id {
        let alt = vorher.status_label.as_deref().unwrap_or("—");
        let neu = nachher.status_label.as_deref().unwrap_or("—");
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!("Person «{}»: Status «{}» → «{}»", nachher.name, alt, neu),
        )
        .await?;
    }
    sse_personal(&state, einsatz_id, ep_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/personal/{ep_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ep_id)): Path<(i64, i64)>,
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

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ep_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, ep_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person «{}» aus dem Einsatz entfernt",
            person_bezeichnung(&anzeige)
        ),
    )
    .await?;
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct PositionBody {
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub lat: Option<Option<f64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub lon: Option<Option<f64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/personal/{ep_id}/position — reine Lage-Pflege, KEIN ETB.
/// Liefert die Karten-Sicht; Repo 404t Nicht-Führungskräfte (gewollt, Merge-Design).
pub async fn position(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ep_id)): Path<(i64, i64)>,
    Json(body): Json<PositionBody>,
) -> Result<Json<FuehrungskraftKarte>, AppError> {
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

    // Effektivzustand für die Paar-Validierung: vorhandene lat/lon (404 falls fremd).
    let vorher: (Option<f64>, Option<f64>) =
        sqlx::query_as("SELECT lat, lon FROM einsatz_personal WHERE id = ? AND einsatz_id = ?")
            .bind(ep_id)
            .bind(einsatz_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    let eff_lat = match body.lat {
        Some(o) => o,
        None => vorher.0,
    };
    let eff_lon = match body.lon {
        Some(o) => o,
        None => vorher.1,
    };
    if eff_lat.is_some() != eff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
        ));
    }
    if let Some(la) = eff_lat {
        if !(-90.0..=90.0).contains(&la) {
            return Err(AppError::UnprocessableEntity(
                "lat muss zwischen -90 und 90 liegen".into(),
            ));
        }
    }
    if let Some(lo) = eff_lon {
        if !(-180.0..=180.0).contains(&lo) {
            return Err(AppError::UnprocessableEntity(
                "lon muss zwischen -180 und 180 liegen".into(),
            ));
        }
    }

    let nachher = disposition_repo::aktualisiere_position(
        &state.pool,
        einsatz_id,
        ep_id,
        disposition_repo::PositionPatch {
            lat: body.lat,
            lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_personal(&state, einsatz_id, ep_id);
    Ok(Json(nachher))
}

/// GET /api/einsaetze/{id}/karte/fuehrungskraefte — nur Einheits-/Abschnittsführung.
pub async fn karte_fuehrungskraefte(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<FuehrungskraftKarte>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        "lagekarte",
        &benutzer,
    )
    .await?;
    Ok(Json(
        disposition_repo::liste_fuehrungskraefte(&state.pool, einsatz_id).await?,
    ))
}
