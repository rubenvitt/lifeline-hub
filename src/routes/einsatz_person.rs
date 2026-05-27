use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_einsatzleitung, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::{darf_uebergehen, registrier_anzeige, repo, Geschlecht, PersonAnzeige, PersonStatus};
use crate::person::audit_repo;
use crate::person::audit_repo::ZugriffAnzeige;
use axum::response::{IntoResponse, Response};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Schreibt einen pseudonymen System-ETB-Eintrag (nur Registriernummer + Status)
/// und publiziert ihn als `etb`-SSE-Event.
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
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

/// Broadcastet ein dediziertes `person`-SSE-Event OHNE sensible Payload
/// (nur einsatz_id + person_id); Clients refetchen die Liste.
fn sse_person(state: &AppState, einsatz_id: i64, person_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "person_id": person_id }).to_string();
    state.live.publiziere_event(einsatz_id, "person", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Validiert ein optionales Geschlecht; `Validation`, falls gesetzt und unbekannt.
fn pruefe_geschlecht(g: &Option<String>) -> Result<(), AppError> {
    if let Some(g) = g {
        if Geschlecht::parse(g).is_none() {
            return Err(AppError::Validation("Unbekanntes Geschlecht".into()));
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/personen — Liste (optional `?status=`). NICHT auditiert.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<PersonAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    if let Some(s) = &params.status {
        if PersonStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter Status im Filter".into()));
        }
    }
    Ok(Json(repo::liste(&state.pool, einsatz_id, params.status.as_deref()).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<String>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen — Person anlegen (Status `erfasst`).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonymen ETB-Eintrag + SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<PersonAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    pruefe_geschlecht(&body.geschlecht)?;

    let name = trimme(body.name);
    let vorname = trimme(body.vorname);
    let geburtsdatum = trimme(body.geburtsdatum);
    let herkunft = trimme(body.herkunft_adresse);
    let antreff = trimme(body.antreff_ort);
    let melder = trimme(body.melder_kontakt);
    let notiz = trimme(body.notiz);

    let person = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::NeueDaten {
            name: name.as_deref(),
            vorname: vorname.as_deref(),
            geschlecht: body.geschlecht.as_deref(),
            geburtsdatum: geburtsdatum.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt,
            herkunft_adresse: herkunft.as_deref(),
            antreff_ort: antreff.as_deref(),
            melder_kontakt: melder.as_deref(),
            notiz: notiz.as_deref(),
        },
    )
    .await?;

    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!("Person {} erfasst", registrier_anzeige(person.registrier_nr)),
    )
    .await?;
    sse_person(&state, einsatz_id, person.id);
    Ok((StatusCode::CREATED, Json(person)))
}

/// GET /api/einsaetze/{id}/personen/{pid} — Detail. **Schreibt einen
/// `detail`-Audit-Eintrag VOR der Response** (auch wenn der Client abbricht).
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    // Existenz/Zugehörigkeit prüfen, BEVOR auditiert wird (kein Audit für 404).
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, Some(person_id), benutzer.id, "detail").await?;
    Ok(Json(person))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<String>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
}

/// PATCH /api/einsaetze/{id}/personen/{pid} — Identitäts-/Kontextfelder bearbeiten.
/// Schreibberechtigt + aktiver Einsatz. Kein ETB-Eintrag (E‑1-Felder sind keine
/// besondere Kategorie; aktueller Datensatz genügt).
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    pruefe_geschlecht(&body.geschlecht)?;

    let name = trimme(body.name);
    let vorname = trimme(body.vorname);
    let geburtsdatum = trimme(body.geburtsdatum);
    let herkunft = trimme(body.herkunft_adresse);
    let antreff = trimme(body.antreff_ort);
    let melder = trimme(body.melder_kontakt);
    let notiz = trimme(body.notiz);

    let person = repo::aktualisiere(
        &state.pool, einsatz_id, person_id, benutzer.id,
        repo::PatchDaten {
            name: name.as_deref(), vorname: vorname.as_deref(),
            geschlecht: body.geschlecht.as_deref(), geburtsdatum: geburtsdatum.as_deref(),
            alter_geschaetzt: body.alter_geschaetzt, herkunft_adresse: herkunft.as_deref(),
            antreff_ort: antreff.as_deref(), melder_kontakt: melder.as_deref(),
            notiz: notiz.as_deref(),
        },
    ).await?;
    sse_person(&state, einsatz_id, person.id);
    Ok(Json(person))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/status — validierter Status-Wechsel.
/// Unbekannter Zielstatus → 400; nicht erlaubter Übergang → 422. Schreibt
/// pseudonyme ETB-Spur + SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<StatusBody>,
) -> Result<Json<PersonAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if PersonStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if !darf_uebergehen(&vorher.status, &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status, body.status
        )));
    }
    repo::setze_status(&state.pool, einsatz_id, person_id, &body.status, benutzer.id).await?;

    etb_system(
        &state, einsatz_id, benutzer.id,
        &format!(
            "Person {}: {} → {}",
            registrier_anzeige(vorher.registrier_nr), vorher.status, body.status
        ),
    ).await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(Json(repo::laden(&state.pool, einsatz_id, person_id).await?))
}

/// DELETE /api/einsaetze/{id}/personen/{pid} — Stornieren (Soft-Delete).
/// Schreibberechtigt + aktiver Einsatz. Schreibt pseudonyme ETB-Spur + SSE.
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    repo::storniere(&state.pool, einsatz_id, person_id, benutzer.id).await?;
    etb_system(
        &state, einsatz_id, benutzer.id,
        &format!("Person {} storniert", registrier_anzeige(person.registrier_nr)),
    ).await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/einsaetze/{id}/personen/{pid}/audit — Lese-Audit der Person.
/// Nur Einsatzleitung. Selbst NICHT auditiert (kein detail-Eintrag).
pub async fn audit(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<Json<Vec<ZugriffAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_einsatzleitung(rolle)?;
    // Existenz der Person sicherstellen (404 statt leerer Liste bei Tippfehler).
    repo::laden(&state.pool, einsatz_id, person_id).await?;
    Ok(Json(audit_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?))
}

/// Einfaches CSV-Feld-Quoting (RFC 4180): in Anführungszeichen, innere `"` verdoppelt.
fn csv_feld(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// GET /api/einsaetze/{id}/personen/export — CSV aller (nicht-stornierten)
/// Personen. **Schreibt einen `export`-Audit-Eintrag** (person_id = NULL).
pub async fn export(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Response, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let personen = repo::liste(&state.pool, einsatz_id, None).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, None, benutzer.id, "export").await?;

    let mut csv = String::from("registrier_nr;status;name;vorname;geschlecht;alter;antreff_ort\n");
    for p in &personen {
        let alter = p.alter_geschaetzt.map(|a| a.to_string()).unwrap_or_default();
        csv.push_str(&format!(
            "{};{};{};{};{};{};{}\n",
            registrier_anzeige(p.registrier_nr),
            csv_feld(&p.status),
            csv_feld(p.name.as_deref().unwrap_or("")),
            csv_feld(p.vorname.as_deref().unwrap_or("")),
            csv_feld(p.geschlecht.as_deref().unwrap_or("")),
            alter,
            csv_feld(p.antreff_ort.as_deref().unwrap_or("")),
        ));
    }
    Ok((
        [(axum::http::header::CONTENT_TYPE, "text/csv; charset=utf-8")],
        csv,
    ).into_response())
}

/// GET /api/einsaetze/{id}/personen/stream — SSE-Stream des Einsatz-Kanals.
/// Der Client filtert clientseitig auf `person`-Events. Nur Lesezugriff.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
