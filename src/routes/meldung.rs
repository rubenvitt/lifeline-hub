use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_modul_zugriff, fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::einsatz::modul_override;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "meldungen";
use crate::error::AppError;
use crate::meldung::{
    repo, MeldungAnzeige, ART_SOFORTMELDUNG, ART_SONSTIGE, BESTAETIGUNG_FRIST_DEFAULT_MIN,
    PRIO_NORMAL, PRIO_SOFORT, RICHTUNG_INTERN,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{Duration, NaiveDateTime};
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Meldungen des Einsatzes haben sich geändert (Tag `meldung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "meldung",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// SSE-Notify: unübersehbares Sofort-Highlight (Tag `sofortmeldung`, LFH-97). Läuft über
/// dieselbe eine EventSource pro Einsatz; der Client löst Alarm (visuell + Ton) aus.
fn sse_sofort(state: &AppState, einsatz_id: i64, meldung_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "sofortmeldung",
        serde_json::json!({ "einsatz_id": einsatz_id, "meldung_id": meldung_id }).to_string(),
    );
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub richtung: Option<String>,
}

/// GET /api/einsaetze/{id}/meldungen — Posteingang listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<MeldungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    let status = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = status {
        if !crate::meldung::status_gueltig(s) {
            return Err(AppError::Validation("Ungültiger Status-Filter".into()));
        }
    }
    let richtung = params.richtung.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(r) = richtung {
        if !crate::meldung::richtung_gueltig(r) {
            return Err(AppError::Validation("Ungültiger Richtungs-Filter".into()));
        }
    }
    Ok(Json(repo::liste(&state.pool, einsatz_id, status, richtung, &jetzt()).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueMeldung {
    pub absender: String,
    pub empfaenger: Option<String>,
    pub meldeweg: String,
    pub inhalt: String,
    pub meldungsart: Option<String>,
    pub prioritaet: Option<String>,
    /// Richtung intern/extern (LFH-87); Default 'intern'.
    pub richtung: Option<String>,
    /// Ereigniszeit (UTC, ISO-8601 oder SQLite-Format). Pflicht (Funk-Realität: ≠ Erfassung).
    pub ereigniszeit: String,
    /// Sofortmeldung & Eskalation (LFH-97): Bestätigungspflicht erzwingen. `None` → aus
    /// Sofort-Klassifikation abgeleitet (Sofortmeldung/Priorität sofort impliziert Pflicht).
    pub bestaetigung_pflicht: Option<bool>,
    /// Optionales Override der Default-Bestätigungsfrist (Minuten ab Eingang).
    pub bestaetigung_frist_min: Option<i64>,
}

/// POST /api/einsaetze/{id}/meldungen — Meldung erfassen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeueMeldung>,
) -> Result<(StatusCode, Json<MeldungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    // Mindestfelder: Absender, Inhalt, Meldeweg.
    let absender = req.absender.trim();
    let inhalt = req.inhalt.trim();
    if absender.is_empty() {
        return Err(AppError::Validation("Absender darf nicht leer sein".into()));
    }
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }
    if crate::meldung::MeldeWeg::parse(req.meldeweg.trim()).is_none() {
        return Err(AppError::Validation("Ungültiger Meldeweg".into()));
    }
    let meldungsart = req
        .meldungsart
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(ART_SONSTIGE);
    if !crate::meldung::meldungsart_gueltig(meldungsart) {
        return Err(AppError::Validation("Ungültige Meldungsart".into()));
    }
    let prioritaet = req
        .prioritaet
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(PRIO_NORMAL);
    if !crate::meldung::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let richtung = req.richtung.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(RICHTUNG_INTERN);
    if !crate::meldung::richtung_gueltig(richtung) {
        return Err(AppError::Validation("Ungültige Richtung".into()));
    }
    // Ereigniszeit normalisieren (ISO-8601/SQLite → SQLite-Format), wie ETB.
    let ereigniszeit = crate::etb::normalisiere_zeit(req.ereigniszeit.trim())?;
    let eingang = jetzt();

    // Sofortmeldung & Eskalation (LFH-97): Sofort impliziert Bestätigungspflicht; explizites
    // Flag überstimmt. Frist = Eingang + (Override||Default) Minuten, nur bei Pflicht.
    let ist_sofort = meldungsart == ART_SOFORTMELDUNG || prioritaet == PRIO_SOFORT;
    let pflicht = req.bestaetigung_pflicht.unwrap_or(ist_sofort);
    let frist_min = req.bestaetigung_frist_min.unwrap_or(BESTAETIGUNG_FRIST_DEFAULT_MIN);
    if pflicht && frist_min <= 0 {
        return Err(AppError::Validation("Bestätigungsfrist muss positiv sein".into()));
    }
    let frist_at: Option<String> = if pflicht {
        // `eingang` ist im DB-Format; bei (theoretisch unmöglichem) Parse-Fehler defensiv keine
        // Frist statt 500 (vgl. patch-xor: 422/None statt Panik).
        NaiveDateTime::parse_from_str(&eingang, "%Y-%m-%d %H:%M:%S")
            .ok()
            .map(|n| (n + Duration::minutes(frist_min)).format("%Y-%m-%d %H:%M:%S").to_string())
    } else {
        None
    };

    let m = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::MeldungDaten {
            absender,
            empfaenger: trimme(&req.empfaenger),
            meldeweg: req.meldeweg.trim(),
            inhalt,
            meldungsart,
            prioritaet,
            richtung,
            ereigniszeit: &ereigniszeit,
            eingang_at: &eingang,
            bestaetigung_pflicht: pflicht,
            bestaetigung_frist_at: frist_at.as_deref(),
        },
    )
    .await?;

    // Nachfass/Eskalation: bei Bestätigungspflicht eine Auto-Frist-Erinnerung anlegen
    // (idempotent, quelle='auto_frist'). Der Scheduler-Tick eskaliert bei Fristablauf und
    // re-highlightet; Bestätigen schließt sie wieder. Erstes reales Wiring von anlegen_aus_frist.
    if pflicht {
        if let Some(frist) = frist_at.as_deref() {
            let titel = format!("Sofortmeldung #{} unbestätigt", m.lfd_nr);
            crate::erinnerung::repo::anlegen_aus_frist(
                &state.pool,
                einsatz_id,
                benutzer.id,
                crate::kommunikation::OBJEKT_MELDUNG,
                m.id,
                &titel,
                frist,
                &eingang,
            )
            .await?;
        }
    }

    // Dual-Publish (wie Auftrag): erzeugte ETB-Meldung in den Live-Feed + meldung-Event.
    if let Some(etb_id) = m.etb_meldung_id {
        if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse(&state, einsatz_id);
    // Unübersehbares Sofort-Highlight (AK1): eigener Tag auf derselben Verbindung.
    if ist_sofort {
        sse_sofort(&state, einsatz_id, m.id);
    }
    Ok((StatusCode::CREATED, Json(m)))
}

/// Gemeinsamer Vorlauf für Meldungs-Aktionen: Gates + Cross-Einsatz-Schutz.
/// Gibt `org_id` zurück (für kommunikation_status-Schreibpfade).
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    meldung_id: i64,
) -> Result<i64, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, benutzer)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, meldung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(einsatz.org_id)
}

#[derive(Debug, Deserialize)]
pub struct StatusReq {
    pub status: String,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/status — NUR den Triage-Status setzen.
/// Die Bearbeiter-Zuweisung läuft über `zuweisen` (getrennte Achse).
pub async fn status(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
    Json(req): Json<StatusReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;
    let status = req.status.trim();
    if !crate::meldung::status_gueltig(status) {
        return Err(AppError::Validation("Ungültiger Status".into()));
    }
    let jetzt = jetzt();
    repo::setze_status(&state.pool, meldung_id, status, &jetzt).await?;
    let m = repo::laden(&state.pool, meldung_id, &jetzt).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/bestaetigen — Sofortmeldung aktiv bestätigen
/// (LFH-97). Setzt die Quittungs-Achse (Zeitstempel + Person) und schließt die Nachfass-
/// Erinnerung; der Triage-Status bleibt unberührt. Doppel-Bestätigung → 422.
pub async fn bestaetigen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;
    let now = jetzt();
    // Atomar einmalig (kein read-then-write/TOCTOU): nur die Erst-Bestätigung gewinnt.
    if !repo::bestaetige(&state.pool, org_id, einsatz_id, meldung_id, benutzer.id, &now).await? {
        return Err(AppError::UnprocessableEntity("Meldung ist bereits bestätigt".into()));
    }
    let m = repo::laden(&state.pool, meldung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

#[derive(Debug, Deserialize)]
pub struct ZuweisenReq {
    /// `Some(id)` weist zu, `null`/None gibt frei.
    pub bearbeiter_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/zuweisen — Bearbeiter zuweisen/freigeben (LFH-94).
pub async fn zuweisen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
    Json(req): Json<ZuweisenReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;
    // Bearbeiter (falls gesetzt) muss Einsatz-Mitglied sein (Cross-Einsatz-Schutz).
    if let Some(bid) = req.bearbeiter_id {
        if einsatz_repo::rolle_von(&state.pool, einsatz_id, bid).await?.is_none() {
            return Err(AppError::Validation("Bearbeiter ist kein Einsatz-Mitglied".into()));
        }
    }
    repo::weise_bearbeiter(&state.pool, meldung_id, req.bearbeiter_id).await?;
    let m = repo::laden(&state.pool, meldung_id, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

#[derive(Debug, Deserialize)]
pub struct LagerelevantReq {
    pub text: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/lagerelevant — an die Lage übergeben (LFH-95).
pub async fn lagerelevant(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
    Json(req): Json<LagerelevantReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;
    // Default-Text = Meldungsinhalt, falls kein eigener Lage-Text gegeben.
    let aktuell = repo::laden(&state.pool, meldung_id, &jetzt()).await?;
    let text = req
        .text
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or(aktuell.inhalt);
    let geo = match (req.lat, req.lon) {
        (Some(a), Some(o)) => Some((a, o)),
        (None, None) => None,
        _ => return Err(AppError::Validation("lat und lon nur gemeinsam".into())),
    };
    repo::als_lagerelevant(&state.pool, einsatz_id, meldung_id, benutzer.id, &text, geo).await?;
    let m = repo::laden(&state.pool, meldung_id, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/auftrag — aus einer eingegangenen Meldung direkt
/// einen Auftrag/Befehl erteilen (Meldung→Auftrag, LFH-113). Erzeugt einen formalen Auftrag
/// (inkl. ETB-Anordnung, Pattern B) und setzt den Rückbezug `meldung.auftrag_id` first-write-wins.
/// Auftragsfelder durchlaufen dieselbe Validierung wie POST /auftraege (geteilt, kein zweiter Pfad).
/// Schreibrecht + aktiv + Cross-Einsatz-Schutz über `fordere_bearbeitbar` (wie die anderen Mutationen).
pub async fn auftrag_erteilen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
    Json(req): Json<crate::routes::auftrag::NeuerAuftrag>,
) -> Result<(StatusCode, Json<MeldungAnzeige>), AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;

    // Gleiche Validierung wie POST /auftraege (geteilt) → kein zweiter, ungeprüfter Pfad.
    let now = jetzt();
    let validiert =
        crate::routes::auftrag::validiere_neuen_auftrag(&state.pool, einsatz_id, &req, &now).await?;
    let auftrag_id = repo::erteile_auftrag_tx(
        &state.pool, einsatz_id, meldung_id, benutzer.id, validiert.daten(),
    )
    .await?;

    // ETB-Anordnung entstand im selben Commit → ETB-Live-Event + Auftrag-Board + meldung-Tag (SSE-Parität).
    if let Ok(detail) = crate::auftrag::repo::laden(&state.pool, auftrag_id, &now).await {
        if let Some(etb_id) = detail.auftrag.etb_anordnung_id {
            if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
                if let Ok(json) = serde_json::to_string(&etb) {
                    state.live.publiziere(einsatz_id, json);
                }
            }
        }
    }
    state.live.publiziere_event(
        einsatz_id,
        "auftrag",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
    sse(&state, einsatz_id);

    let m = repo::laden(&state.pool, meldung_id, &now).await?;
    Ok((StatusCode::CREATED, Json(m)))
}

/// GET /api/einsaetze/{id}/lage/meldungen — Lageobjekte aus Meldungen (Lese-Oberfläche, LFH-95).
pub async fn lage_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<crate::meldung::LageMeldungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, "lagemeldungen", &benutzer)?;
    Ok(Json(repo::liste_lage_meldungen(&state.pool, einsatz_id).await?))
}
