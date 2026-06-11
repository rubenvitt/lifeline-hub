use crate::app::AppState;
use crate::auftrag::{repo, AuftragDetail, EMPF_ABSCHNITT, EMPF_EINHEIT, EMPF_FAHRZEUG, EMPF_FUNKTION, EMPF_PERSON, PRIO_NORMAL};
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Aufträge des Einsatzes haben sich geändert (Tag `auftrag`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "auftrag",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
fn parse_zeit(roh: &str) -> Result<String, AppError> {
    let roh = roh.trim().replace('T', " ");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&roh, fmt) {
            return Ok(n.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    Err(AppError::Validation("Ungültiger Zeitpunkt".into()))
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/auftraege — Aufträge listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<AuftragDetail>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let filter = (params.abschnitt_id.is_some() || params.einheit_id.is_some()).then_some(
        repo::EmpfaengerFilter {
            abschnitt_id: params.abschnitt_id,
            einheit_id: params.einheit_id,
        },
    );
    let liste = repo::liste(
        &state.pool,
        einsatz_id,
        params.status.as_deref(),
        filter.as_ref(),
        &jetzt(),
    )
    .await?;
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct EmpfaengerEingabeReq {
    pub empfaenger_typ: String,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NeuerAuftrag {
    pub auftrag_text: String,
    pub absicht: Option<String>,
    pub lage: Option<String>,
    pub ort: Option<String>,
    pub zeit: Option<String>,
    pub mittel: Option<String>,
    pub verbindung: Option<String>,
    pub sicherheit: Option<String>,
    pub prioritaet: Option<String>,
    pub frist_at: Option<String>,
    /// Optional: Erteilzeitpunkt (mündlich/per Funk nachträglich). Default = jetzt.
    pub erteilt_at: Option<String>,
    pub empfaenger: Vec<EmpfaengerEingabeReq>,
}

/// Prüft Slot-Konsistenz + Einsatz-Zugehörigkeit einer Empfänger-Zeile.
async fn validiere_empfaenger(
    pool: &sqlx::SqlitePool,
    einsatz_id: i64,
    req: &EmpfaengerEingabeReq,
) -> Result<repo::EmpfaengerEingabe, AppError> {
    let belegt = [
        req.abschnitt_id.is_some(),
        req.einheit_id.is_some(),
        req.person_id.is_some(),
        req.fahrzeug_id.is_some(),
        trimme(&req.funktion_text).is_some(),
    ]
    .iter()
    .filter(|b| **b)
    .count();
    if belegt != 1 {
        return Err(AppError::Validation("Empfänger braucht genau ein Ziel".into()));
    }

    async fn gehoert(
        pool: &sqlx::SqlitePool,
        tab: &str,
        id: i64,
        einsatz_id: i64,
    ) -> Result<bool, AppError> {
        let q = format!("SELECT 1 FROM {tab} WHERE id = ? AND einsatz_id = ?");
        Ok(sqlx::query_scalar::<_, i64>(&q)
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?
            .is_some())
    }

    let typ = match req.empfaenger_typ.as_str() {
        EMPF_ABSCHNITT => {
            let id = req.abschnitt_id.ok_or_else(|| AppError::Validation("abschnitt_id fehlt".into()))?;
            if !gehoert(pool, "einsatzabschnitt", id, einsatz_id).await? {
                return Err(AppError::Validation("Abschnitt gehört nicht zum Einsatz".into()));
            }
            EMPF_ABSCHNITT
        }
        EMPF_EINHEIT => {
            let id = req.einheit_id.ok_or_else(|| AppError::Validation("einheit_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_einheit", id, einsatz_id).await? {
                return Err(AppError::Validation("Einheit gehört nicht zum Einsatz".into()));
            }
            EMPF_EINHEIT
        }
        EMPF_PERSON => {
            let id = req.person_id.ok_or_else(|| AppError::Validation("person_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_personal", id, einsatz_id).await? {
                return Err(AppError::Validation("Person gehört nicht zum Einsatz".into()));
            }
            EMPF_PERSON
        }
        EMPF_FAHRZEUG => {
            let id = req.fahrzeug_id.ok_or_else(|| AppError::Validation("fahrzeug_id fehlt".into()))?;
            if !gehoert(pool, "einsatz_fahrzeug", id, einsatz_id).await? {
                return Err(AppError::Validation("Fahrzeug gehört nicht zum Einsatz".into()));
            }
            EMPF_FAHRZEUG
        }
        EMPF_FUNKTION => {
            if trimme(&req.funktion_text).is_none() {
                return Err(AppError::Validation("funktion_text fehlt".into()));
            }
            EMPF_FUNKTION
        }
        _ => return Err(AppError::Validation("Ungültiger Empfänger-Typ".into())),
    };

    Ok(repo::EmpfaengerEingabe {
        empfaenger_typ: typ.to_string(),
        abschnitt_id: req.abschnitt_id,
        einheit_id: req.einheit_id,
        person_id: req.person_id,
        fahrzeug_id: req.fahrzeug_id,
        funktion_text: trimme(&req.funktion_text).map(str::to_string),
    })
}

/// POST /api/einsaetze/{id}/auftraege — Auftrag anlegen + zustellen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeuerAuftrag>,
) -> Result<(StatusCode, Json<AuftragDetail>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Akzeptanzkriterium: nur absendbar mit Auftragstext UND mindestens einem Empfänger.
    let text = req.auftrag_text.trim();
    if text.is_empty() {
        return Err(AppError::Validation("Auftragstext darf nicht leer sein".into()));
    }
    if req.empfaenger.is_empty() {
        return Err(AppError::Validation("Mindestens ein Empfänger ist erforderlich".into()));
    }
    let prioritaet = req.prioritaet.as_deref().unwrap_or(PRIO_NORMAL);
    if !crate::auftrag::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let frist = match trimme(&req.frist_at) {
        Some(f) => Some(parse_zeit(f)?),
        None => None,
    };
    let now = jetzt();
    let erteilt = match trimme(&req.erteilt_at) {
        Some(e) => parse_zeit(e)?,
        None => now.clone(),
    };

    let mut empfaenger = Vec::with_capacity(req.empfaenger.len());
    for r in &req.empfaenger {
        empfaenger.push(validiere_empfaenger(&state.pool, einsatz_id, r).await?);
    }

    let d = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::AuftragDaten {
            auftrag_text: text,
            absicht: trimme(&req.absicht),
            lage: trimme(&req.lage),
            ort: trimme(&req.ort),
            zeit: trimme(&req.zeit),
            mittel: trimme(&req.mittel),
            verbindung: trimme(&req.verbindung),
            sicherheit: trimme(&req.sicherheit),
            prioritaet,
            frist_at: frist.as_deref(),
            erteilt_at: &erteilt,
            empfaenger,
        },
        &now,
    )
    .await?;

    // ETB-Anordnung wurde im selben Commit erzeugt → ETB-Live-Event mitschicken.
    if let Some(etb_id) = d.auftrag.etb_anordnung_id {
        if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(d)))
}

/// Gemeinsamer Vorlauf für Auftrags-Aktionen: Gates + Cross-Einsatz-Schutz.
/// Gibt `org_id` zurück (für kommunikation_status-Schreibpfade).
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    auftrag_id: i64,
) -> Result<i64, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, auftrag_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(einsatz.org_id)
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren — Quittung (Achse 1).
pub async fn quittieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, auftrag_id, empfaenger_id)): Path<(i64, i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, auftrag_id).await?;
    if !repo::empfaenger_gehoert_zu_auftrag(&state.pool, empfaenger_id, auftrag_id).await? {
        return Err(AppError::NotFound);
    }
    repo::quittiere_empfaenger(&state.pool, empfaenger_id, benutzer.id, &jetzt()).await?;
    let d = repo::laden(&state.pool, auftrag_id, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}

#[derive(Debug, Deserialize)]
pub struct VollzugReq {
    /// 'in_arbeit' | 'vollzogen'.
    pub status: String,
    pub vollzugsmeldung: Option<String>,
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/vollzug — Bearbeitungsfortschritt (Achse 2).
pub async fn vollzug(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, auftrag_id)): Path<(i64, i64)>,
    Json(req): Json<VollzugReq>,
) -> Result<Json<AuftragDetail>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, auftrag_id).await?;
    let now = jetzt();
    match req.status.as_str() {
        "in_arbeit" => {
            repo::setze_in_arbeit(&state.pool, org_id, einsatz_id, auftrag_id, benutzer.id, &now).await?;
        }
        "vollzogen" => {
            let text = req
                .vollzugsmeldung
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::Validation("Vollzugsmeldung darf nicht leer sein".into()))?;
            let etb_id = repo::melde_vollzug(&state.pool, org_id, einsatz_id, auftrag_id, benutzer.id, text, &now).await?;
            if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
                if let Ok(json) = serde_json::to_string(&etb) {
                    state.live.publiziere(einsatz_id, json);
                }
            }
        }
        _ => return Err(AppError::Validation("Ungültiger Vollzug-Status".into())),
    }
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}

/// POST /api/einsaetze/{id}/auftraege/{aid}/abnehmen — Führung nimmt Vollzug ab.
pub async fn abnehmen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, auftrag_id)): Path<(i64, i64)>,
) -> Result<Json<AuftragDetail>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, auftrag_id).await?;
    let now = jetzt();
    let aktuell = repo::laden(&state.pool, auftrag_id, &now).await?;
    if aktuell.auftrag.vollzug_status != "vollzogen" {
        return Err(AppError::UnprocessableEntity(
            "Nur vollzogene Aufträge können abgenommen werden".into(),
        ));
    }
    repo::nimm_ab(&state.pool, auftrag_id, benutzer.id, &now).await?;
    let d = repo::laden(&state.pool, auftrag_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(d))
}
