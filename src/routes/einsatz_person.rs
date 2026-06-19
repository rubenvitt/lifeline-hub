use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_modul_zugriff, fordere_aktiv, fordere_einsatzleitung, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::einsatz::modul_override;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "personen";
use crate::routes::einsatz_uhs;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::{darf_uebergehen, registrier_anzeige, repo, Geschlecht, PersonAnzeige, PersonStatus, Sichtungskategorie, VerbleibArt};
use crate::person::{abgleich_repo, audit_repo, sichtung_repo, verbleib_repo, verlaufsnotiz_repo};
use crate::person::abgleich_repo::AbgleichAnzeige;
use crate::person::audit_repo::ZugriffAnzeige;
use crate::person::sichtung_repo::SichtungAnzeige;
use crate::person::verbleib_repo::VerbleibAnzeige;
use crate::person::verlaufsnotiz_repo::NotizAnzeige;
use serde::Serialize;
use axum::response::{IntoResponse, Response};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Detail-Antwort: E‑1-Personenfelder (flatten) + E‑2-Verlauf-Arrays. Genau eine
/// Antwort, genau ein `detail`-Audit (Spec-Annahme „Lesen / Lese-Audit").
#[derive(Debug, Serialize)]
pub struct PersonDetail {
    #[serde(flatten)]
    pub person: PersonAnzeige,
    pub sichtungen: Vec<SichtungAnzeige>,
    pub notizen: Vec<NotizAnzeige>,
    pub verbleib: Vec<VerbleibAnzeige>,
    pub abgleiche: Vec<AbgleichAnzeige>,
}

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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
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

/// GET /api/einsaetze/{id}/personen/{pid} — Detail inkl. medizinischem Verlauf.
/// **Schreibt EINEN `detail`-Audit-Eintrag VOR der Verlauf-Anreicherung**
/// (auch wenn der Client abbricht). Die Verlauf-Listen sind eigene Reads ohne
/// zusätzliches Audit — der eine Audit-Eintrag steht für die gesamte Öffnung.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
) -> Result<Json<PersonDetail>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, Some(person_id), benutzer.id, "detail").await?;

    let sichtungen = sichtung_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let notizen = verlaufsnotiz_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let verbleib = verbleib_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;
    let abgleiche = abgleich_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?;

    Ok(Json(PersonDetail { person, sichtungen, notizen, verbleib, abgleiche }))
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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    if PersonStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Stornierte Person kann nicht geändert werden".into()));
    }
    if !darf_uebergehen(&vorher.status, &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status, body.status
        )));
    }
    repo::setze_status(&state.pool, einsatz_id, person_id, &body.status, benutzer.id).await?;

    // E‑3: bei verstorben/abgemeldet → UHS-Auto-Austritt (sequenziell, eigene ETB-Spur).
    if matches!(body.status.as_str(), "verstorben" | "abgemeldet") {
        let anlass = format!("durch Status-Wechsel zu {}", body.status);
        einsatz_uhs::auto_austritt(&state, einsatz_id, person_id, &anlass, benutzer.id).await?;
    }

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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict("Person ist bereits storniert".into()));
    }
    repo::storniere(&state.pool, einsatz_id, person_id, benutzer.id).await?;
    // E‑3: Storno → UHS-Auto-Austritt + Reservierungs-Cleanup (Repo schreibt nur ETB, wenn Austritt nötig).
    einsatz_uhs::auto_austritt(&state, einsatz_id, person_id, "durch Storno der Person", benutzer.id).await?;
    etb_system(
        &state, einsatz_id, benutzer.id,
        &format!("Person {} storniert", registrier_anzeige(person.registrier_nr)),
    ).await?;
    sse_person(&state, einsatz_id, person_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct SichtungBody {
    pub kategorie: String,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/sichtung — Sichtung erfassen.
/// Schreibberechtigt + aktiv. Hebt `erfasst→betroffen` (Annahme 5); bei
/// `vermisst`/`abgemeldet` → 422; bei storniert → 409. Sichtung=`tot` ändert
/// den Admin-Status NICHT (Annahme 4). Pseudonyme ETB-Spur + SSE.
pub async fn sichten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<SichtungBody>,
) -> Result<(StatusCode, Json<SichtungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    let kategorie = Sichtungskategorie::parse(&body.kategorie)
        .ok_or_else(|| AppError::Validation("Unbekannte Sichtungskategorie".into()))?;
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann nicht gesichtet werden".into(),
        ));
    }
    // Anwesenheit: betroffen|verstorben ok; erfasst → anheben; sonst 422.
    let hebe_auf_betroffen = match person.status.as_str() {
        "betroffen" | "verstorben" => false,
        "erfasst" => true,
        _ => {
            return Err(AppError::UnprocessableEntity(format!(
                "Person ist nicht anwesend (Status {})",
                person.status
            )))
        }
    };
    let notiz = trimme(body.notiz);

    let sichtung = sichtung_repo::erfassen(
        &state.pool,
        einsatz_id,
        person_id,
        kategorie.as_str(),
        notiz.as_deref(),
        benutzer.id,
        hebe_auf_betroffen,
    )
    .await?;

    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person {}: Sichtung {}",
            registrier_anzeige(person.registrier_nr),
            kategorie.etb_label()
        ),
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(sichtung)))
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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_einsatzleitung(rolle)?;
    // Existenz der Person sicherstellen (404 statt leerer Liste bei Tippfehler).
    repo::laden(&state.pool, einsatz_id, person_id).await?;
    Ok(Json(audit_repo::liste_je_person(&state.pool, einsatz_id, person_id).await?))
}

/// Einfaches CSV-Feld-Quoting (RFC 4180): in Anführungszeichen, innere `"` verdoppelt.
/// Entschärft zusätzlich Formel-Injektion (Excel/LibreOffice): Felder, die mit
/// =,+,-,@,Tab oder CR beginnen, werden mit einem führenden Apostroph neutralisiert.
fn csv_feld(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

    let personen = repo::liste(&state.pool, einsatz_id, None).await?;
    audit_repo::anlegen(&state.pool, einsatz_id, None, benutzer.id, "export").await?;

    let mut csv = String::from("registrier_nr;status;sichtung;name;vorname;geschlecht;alter;antreff_ort\n");
    for p in &personen {
        let alter = p.alter_geschaetzt.map(|a| a.to_string()).unwrap_or_default();
        csv.push_str(&format!(
            "{};{};{};{};{};{};{};{}\n",
            registrier_anzeige(p.registrier_nr),
            csv_feld(&p.status),
            csv_feld(p.aktuelle_sichtung.as_deref().unwrap_or("")),
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

#[derive(Debug, Deserialize)]
pub struct VerbleibBody {
    pub art: String,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/verbleib — Verbleib-Ereignis erfassen.
/// Schreibberechtigt + aktiv. Cache-Kurzform via `VerbleibArt::kurzform`. Pseudonyme ETB-Spur + SSE.
pub async fn verbleib(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<VerbleibBody>,
) -> Result<(StatusCode, Json<VerbleibAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    let art = VerbleibArt::parse(&body.art)
        .ok_or_else(|| AppError::Validation("Unbekannte Verbleib-Art".into()))?;
    if let Some(s) = &body.status {
        if !matches!(s.as_str(), "angemeldet" | "abtransportiert") {
            return Err(AppError::Validation("Unbekannter Verbleib-Status".into()));
        }
    }
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keinen Verbleib erhalten".into(),
        ));
    }
    let transportmittel = trimme(body.transportmittel);
    let ziel = trimme(body.ziel);
    let notiz = trimme(body.notiz);
    let kurzform = art.kurzform(ziel.as_deref());

    let verbleib = verbleib_repo::erfassen(
        &state.pool,
        einsatz_id,
        person_id,
        verbleib_repo::VerbleibDaten {
            art: art.as_str(),
            transportmittel: transportmittel.as_deref(),
            ziel: ziel.as_deref(),
            status: body.status.as_deref(),
            notiz: notiz.as_deref(),
        },
        &kurzform,
        benutzer.id,
    )
    .await?;

    // E‑3: bei transport/entlassung → UHS-Auto-Austritt (eigene ETB-Spur).
    if matches!(art, VerbleibArt::Transport | VerbleibArt::Entlassung) {
        let anlass = format!("durch Verbleib {}", art.as_str());
        einsatz_uhs::auto_austritt(&state, einsatz_id, person_id, &anlass, benutzer.id).await?;
    }

    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &format!(
            "Person {}: {}",
            registrier_anzeige(person.registrier_nr),
            art.etb_sachverhalt(ziel.as_deref())
        ),
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(verbleib)))
}

#[derive(Debug, Deserialize)]
pub struct NotizBody {
    pub text: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/notizen — append-only Befundnotiz.
/// Schreibberechtigt + aktiv. **KEIN ETB-Eintrag** (besondere Kategorie). SSE.
pub async fn notiz(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<NotizBody>,
) -> Result<(StatusCode, Json<NotizAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    let text = body.text.trim();
    if text.is_empty() {
        return Err(AppError::Validation("Notiztext darf nicht leer sein".into()));
    }
    let person = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte Person kann keine Notiz erhalten".into(),
        ));
    }
    let notiz = verlaufsnotiz_repo::anlegen(&state.pool, einsatz_id, person_id, text, benutzer.id).await?;
    // BEWUSST kein etb_system(): besondere Kategorie gehört NICHT in den ETB.
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(notiz)))
}

#[derive(Debug, Deserialize)]
pub struct AbgleichBody {
    pub gefunden_person_id: i64,
}

/// POST /api/einsaetze/{id}/personen/{pid}/abgleich — Verdachts-Link anlegen.
/// `pid` = vermisste Person. Schreibberechtigt + aktiver Einsatz. KEIN ETB; SSE für beide Personen.
pub async fn abgleich_anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<AbgleichBody>,
) -> Result<(StatusCode, Json<AbgleichAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    if body.gefunden_person_id == person_id {
        return Err(AppError::Validation(
            "Vermisste und gefundene Person müssen verschieden sein".into(),
        ));
    }
    let vermisst = repo::laden(&state.pool, einsatz_id, person_id).await?;
    if vermisst.storniert_at.is_some() || vermisst.status != "vermisst" {
        return Err(AppError::UnprocessableEntity(
            "Abgleich nur ausgehend von einer vermissten Person".into(),
        ));
    }
    // `repo::laden` schützt org-isoliert: NotFound (404), falls in fremdem Einsatz.
    let gefunden = repo::laden(&state.pool, einsatz_id, body.gefunden_person_id).await?;
    if gefunden.storniert_at.is_some() || !matches!(gefunden.status.as_str(), "betroffen" | "verstorben") {
        return Err(AppError::UnprocessableEntity(
            "Gefundene Person muss Status betroffen/verstorben haben".into(),
        ));
    }

    let abgleich = abgleich_repo::anlegen_verdacht(
        &state.pool,
        einsatz_id,
        person_id,
        body.gefunden_person_id,
        benutzer.id,
    )
    .await?;
    sse_person(&state, einsatz_id, person_id);
    sse_person(&state, einsatz_id, body.gefunden_person_id);
    Ok((StatusCode::CREATED, Json(abgleich)))
}

#[derive(Debug, Deserialize)]
pub struct EntscheidungBody {
    pub entscheidung: String,
}

/// POST /api/einsaetze/{id}/personen/{pid}/abgleich/{aid}/entscheidung — bestätigen
/// oder verwerfen. **Nur Einsatzleitung** (Annahme 8). Routing-Invariante:
/// `abgleich.vermisst_person_id == pid`, sonst `404`. Nur aus `verdacht` heraus
/// (sonst `409`). Bei `bestaetigt`: Vermisstmeldung → `abgemeldet` + pseudonyme
/// ETB-Spur. SSE für beide beteiligten Personen.
pub async fn abgleich_entscheiden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id, abgleich_id)): Path<(i64, i64, i64)>,
    Json(body): Json<EntscheidungBody>,
) -> Result<Json<AbgleichAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_einsatzleitung(rolle)?;
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;
    fordere_aktiv(&einsatz)?;

    if !matches!(body.entscheidung.as_str(), "bestaetigt" | "verworfen") {
        return Err(AppError::Validation(
            "Entscheidung muss 'bestaetigt' oder 'verworfen' sein".into(),
        ));
    }
    let abgleich = abgleich_repo::laden(&state.pool, einsatz_id, abgleich_id).await?;
    if abgleich.vermisst_person_id != person_id {
        // pid-Invariante verletzt: nicht der Pfad zu DIESEM Abgleich.
        return Err(AppError::NotFound);
    }
    if abgleich.status != "verdacht" {
        return Err(AppError::Conflict("Abgleich ist bereits entschieden".into()));
    }
    let entschieden = abgleich_repo::entscheide(
        &state.pool,
        einsatz_id,
        abgleich_id,
        &body.entscheidung,
        benutzer.id,
    )
    .await?;

    if body.entscheidung == "bestaetigt" {
        let vermisst = repo::laden(&state.pool, einsatz_id, abgleich.vermisst_person_id).await?;
        let gefunden = repo::laden(&state.pool, einsatz_id, abgleich.gefunden_person_id).await?;
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &format!(
                "Vermisstmeldung {} aufgeklärt — identisch mit {}",
                registrier_anzeige(vermisst.registrier_nr),
                registrier_anzeige(gefunden.registrier_nr)
            ),
        )
        .await?;
    }
    sse_person(&state, einsatz_id, abgleich.vermisst_person_id);
    sse_person(&state, einsatz_id, abgleich.gefunden_person_id);
    Ok(Json(entschieden))
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
    let overrides = modul_override::laden_alle(&state.pool, einsatz_id).await?;
    fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer)?;

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
