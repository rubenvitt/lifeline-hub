use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "material";
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::material::disposition_repo::{self, AdhocDaten};
use crate::material::{EinsatzMaterialAnzeige, MaterialStatus};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Schreibt einen automatischen System-ETB-Eintrag und publiziert ihn live
/// (identisch zu `routes::einsatz_fahrzeug::etb_system`).
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

/// SSE-Notify (Lage-Karte/Meldebild): Material-Disposition hat sich geändert.
/// Wird unbedingt nach jeder Mutation gesendet — auch bei reinen Bemerkungs-/
/// UHS-Zuordnungs-Änderungen, die keinen ETB-Eintrag schreiben (LFH-66).
fn sse_material(state: &AppState, einsatz_id: i64, em_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "material_id": em_id }).to_string();
    state.live.publiziere_event(einsatz_id, "material", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/material — disponiertes Material (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzMaterialAnzeige>>, AppError> {
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
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub material_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
    pub menge: Option<i64>,
}

/// POST /api/einsaetze/{id}/material — Stamm-Material disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag (inkl. Menge).
pub async fn disponieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzMaterialAnzeige>), AppError> {
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

    let menge = body.menge.unwrap_or(1);
    if menge < 1 {
        return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
    }

    let em_id = match (body.material_id, body.adhoc) {
        (Some(material_id), None) => {
            disposition_repo::disponiere_stamm(
                &state.pool,
                einsatz_id,
                einsatz.org_id,
                material_id,
                menge,
                benutzer.id,
            )
            .await?
        }
        (None, Some(adhoc)) => {
            let bezeichnung = adhoc.bezeichnung.trim().to_string();
            if bezeichnung.is_empty() {
                return Err(AppError::Validation(
                    "Bezeichnung darf nicht leer sein".into(),
                ));
            }
            let kategorie = trimme(adhoc.kategorie);
            let bestandsnummer = trimme(adhoc.bestandsnummer);
            let traeger = trimme(adhoc.traegerorganisation);
            disposition_repo::disponiere_adhoc(
                &state.pool,
                einsatz_id,
                AdhocDaten {
                    bezeichnung: &bezeichnung,
                    kategorie: kategorie.as_deref(),
                    bestandsnummer: bestandsnummer.as_deref(),
                    traegerorganisation: traeger.as_deref(),
                },
                menge,
                benutzer.id,
            )
            .await?
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder material_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Material «{}» (×{}) disponiert",
            anzeige.bezeichnung, anzeige.menge
        ),
    )
    .await?;
    sse_material(&state, einsatz_id, em_id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub menge: Option<i64>,
    pub status: Option<String>,
    pub bemerkung: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uhs_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/material/{em_id} — Menge und/oder Status und/oder Bemerkung.
/// Mengen-Änderung und Status-Wechsel schreiben je einen ETB-Eintrag; eine reine
/// Bemerkungsänderung schreibt keinen.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, em_id)): Path<(i64, i64)>,
    Json(body): Json<DispoPatchBody>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
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

    if let Some(menge) = body.menge {
        if menge < 1 {
            return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
        }
    }
    // Status validieren (festes Enum). Ungültig → Validation.
    let status = match &body.status {
        Some(s) => {
            let parsed = MaterialStatus::parse(s)
                .ok_or_else(|| AppError::Validation("Unbekannter Status".into()))?;
            Some(parsed.as_str())
        }
        None => None,
    };

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;
    // Bemerkung: im Body gesetzt (auch "") → setzen (leer = löschen); absent/null →
    // unverändert (COALESCE). Daher NICHT über `trimme` zu None kollabieren lassen.
    let bemerkung = body.bemerkung.as_deref().map(str::trim);
    disposition_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        em_id,
        body.menge,
        status,
        bemerkung,
        body.uhs_id,
    )
    .await?;
    let nachher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;

    if vorher.menge != nachher.menge {
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!(
                "Material «{}»: Menge {} → {}",
                nachher.bezeichnung, vorher.menge, nachher.menge
            ),
        )
        .await?;
    }
    if vorher.status != nachher.status {
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!(
                "Material «{}»: Status «{}» → «{}»",
                nachher.bezeichnung,
                vorher.status.as_str(),
                nachher.status.as_str()
            ),
        )
        .await?;
    }
    sse_material(&state, einsatz_id, em_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/material/{em_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, em_id)): Path<(i64, i64)>,
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

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;
    disposition_repo::entferne(&state.pool, einsatz_id, em_id).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Material «{}» aus dem Einsatz entfernt",
            anzeige.bezeichnung
        ),
    )
    .await?;
    sse_material(&state, einsatz_id, em_id);
    Ok(StatusCode::NO_CONTENT)
}
