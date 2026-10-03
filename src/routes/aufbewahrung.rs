//! Archiv-Namensraum der Aufbewahrung (LFH-23).
//!
//! | Methode | Pfad | Zweck |
//! |---|---|---|
//! | GET  | `/api/aufbewahrung` | Übersicht der eigenen Organisation |
//! | GET  | `/api/aufbewahrung/einsaetze/{id}` | Archivakte: Kopf, Zustand, Register |
//! | GET  | `/api/aufbewahrung/einsaetze/{id}/etb` | Archiv-ETB (`typ`, `before_lfd_nr`, `limit`) |
//! | POST | `/api/aufbewahrung/einsaetze/{id}/wiederherstellen` | Wiederherstellen |
//! | GET  | `/api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege` | Anträge (Art. 17, LFH-751) |
//! | POST | `/api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege` | Antrag stellen |
//! | POST | `/api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege/{aid}/zuruecknehmen` | Rücknahme |
//! | POST | `/api/aufbewahrung/einsaetze/{id}/personensuche` | Pseudonyme Suche (liest nur) |
//!
//! **Die Lesesperre der regulären Einsatz-Routen bleibt unberührt** — eine Ausnahme in
//! `darf_lesen` gäbe Personen mit Namen, Anhänge und Export wieder frei. Jeder Handler nimmt
//! `AdminUser`; Nicht-GET sind nur Wiederherstellen, Antrag, Rücknahme und die Suche (POST nur
//! wegen des Bodys, sie schreibt nicht). Beides hält `archiv_namensraum_nur_lesend_und_admin`
//! in `tests/aufbewahrung.rs` fest.

use crate::app::AppState;
use crate::aufbewahrung::antrag::{self, AntragZiel, AntragZielArt, SchwaerzungsantragAnzeige};
use crate::aufbewahrung::repo::{self, ArchivEtbFilter, KopfZeile};
use crate::aufbewahrung::suche::{self, PersonTrefferAnzeige};
use crate::aufbewahrung::{
    fordere_archivzugriff, ArchivAkteAnzeige, ArchivEtbEintragAnzeige, AufbewahrungEintragAnzeige,
};
use crate::auth::session::AdminUser;
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::etb::EtbTyp;
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::deserialize_optional_field;
use axum::extract::{Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;

/// Lädt den Kopf und prüft den Archivzugriff: 404 unbekannt, 403 fremde Org, 409 aktiv.
async fn archivkopf(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<KopfZeile, AppError> {
    let kopf = repo::kopf_laden(&state.pool, einsatz_id)
        .await?
        .ok_or(AppError::NotFound)?;
    fordere_archivzugriff(benutzer, kopf.org_id, &kopf.status)?;
    Ok(kopf)
}

/// GET /api/aufbewahrung — alle abgeschlossenen Einsätze der eigenen Organisation mit
/// ihrem Aufbewahrungszustand. Die Organisation kommt aus dem Benutzer, nie aus der Anfrage.
pub async fn uebersicht(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
) -> Result<Json<Vec<AufbewahrungEintragAnzeige>>, AppError> {
    Ok(Json(
        repo::uebersicht(&state.pool, benutzer.org_id, Utc::now()).await?,
    ))
}

/// GET /api/aufbewahrung/einsaetze/{id} — pseudonyme Archivakte (Retain-Projektion).
pub async fn akte(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Json<ArchivAkteAnzeige>, AppError> {
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    Ok(Json(repo::akte(&state.pool, &kopf, Utc::now()).await?))
}

#[derive(Debug, Deserialize)]
pub struct ArchivEtbParams {
    /// Eintragstyp-Filter; ein unbekannter Wert ist 400.
    pub typ: Option<String>,
    /// Cursor: nur Einträge mit `lfd_nr` kleiner als dieser Wert.
    pub before_lfd_nr: Option<i64>,
    /// Seitengröße (Vorgabe `etb::repo::STANDARD_LIMIT`, geklemmt auf `[1, MAX_LIMIT]`).
    pub limit: Option<i64>,
}

/// GET /api/aufbewahrung/einsaetze/{id}/etb — Archiv-ETB im Wortlaut, neueste zuerst.
pub async fn etb(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    Query(params): Query<ArchivEtbParams>,
) -> Result<Json<Vec<ArchivEtbEintragAnzeige>>, AppError> {
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    let typ = match params
        .typ
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(t) => Some(
            EtbTyp::parse(t)
                .ok_or_else(|| AppError::Validation("Ungültiger Eintragstyp im Filter".into()))?,
        ),
        None => None,
    };
    let limit = params
        .limit
        .unwrap_or(crate::etb::repo::STANDARD_LIMIT)
        .clamp(1, crate::etb::repo::MAX_LIMIT);
    Ok(Json(
        repo::etb(
            &state.pool,
            kopf.id,
            ArchivEtbFilter {
                typ,
                before_lfd_nr: params.before_lfd_nr,
                limit,
            },
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct Wiederherstellen {
    /// Neue Aufbewahrungsfrist — **Pflichtfeld**: Zeitpunkt in der Zukunft oder ausdrücklich `null`
    /// für unbegrenzt. Fehlt es (400), merkte der nächste Purge-Lauf den Einsatz sofort wieder vor.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub retention_bis: Option<Option<String>>,
}

/// POST /api/aufbewahrung/einsaetze/{id}/wiederherstellen — Löschvormerkung während der
/// Karenz aufheben und neue Frist setzen, mit ETB-Audit des Admins. 400 Feld fehlt oder
/// unlesbar, 422 Frist nicht in der Zukunft oder Einsatz nicht vorgemerkt, 409 Karenz
/// abgelaufen oder geschwärzt.
pub async fn wiederherstellen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(req): JsonBody<Wiederherstellen>,
) -> Result<Json<ArchivAkteAnzeige>, AppError> {
    archivkopf(&state, &benutzer, einsatz_id).await?;
    let Some(frist_roh) = req.retention_bis else {
        return Err(AppError::Validation(
            "retention_bis fehlt — eine neue Frist oder null (unbegrenzt) ist Pflicht".into(),
        ));
    };
    let neue_frist = match frist_roh.as_deref().map(str::trim) {
        None => None,
        Some("") => {
            return Err(AppError::Validation(
                "retention_bis ist leer — eine neue Frist oder null (unbegrenzt) ist Pflicht"
                    .into(),
            ))
        }
        Some(s) => Some(crate::etb::normalisiere_zeit(s)?),
    };
    let jetzt = Utc::now();
    if let Some(f) = neue_frist.as_deref() {
        if crate::einsatz::berechtigung::retention_abgelaufen(Some(f), jetzt) {
            return Err(AppError::UnprocessableEntity(
                "Die neue Aufbewahrungsfrist muss in der Zukunft liegen".into(),
            ));
        }
    }
    crate::einsatz::repo::wiederherstellen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        benutzer.org_id,
        neue_frist.as_deref(),
        jetzt,
    )
    .await?;
    // Der Einsatz erscheint wieder in den Listen seiner Leser (LFH-734).
    crate::live::org::einsatzliste_melden(&state.pool, &state.live, einsatz_id, &[]).await;
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    Ok(Json(repo::akte(&state.pool, &kopf, Utc::now()).await?))
}

// ---------- Löschersuchen nach Art. 17 (LFH-751) ----------

/// Ziel eines Antrags im Request: `art` ist `einsatz` oder eine Personenart, `id` fehlt beim
/// Einsatz und ist bei einer Person Pflicht.
#[derive(Debug, Deserialize)]
pub struct AntragZielEingabe {
    pub art: String,
    pub id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct NeuerSchwaerzungsantrag {
    pub ziel: AntragZielEingabe,
    /// Aktenzeichen des Löschersuchens, nach dem Trimmen 1 bis 64 Zeichen, ohne Namen.
    pub aktenzeichen: String,
    /// Eingetippte Kennung: Einsatznummer bzw. `R-042`, `EK-17`, `IT-5`, `MK-3`.
    pub bestaetigung: String,
}

/// Formprüfung des Ziels (400): bekannte Art, `id` genau bei einer Person.
fn ziel_aus(eingabe: &AntragZielEingabe) -> Result<AntragZiel, AppError> {
    let art = AntragZielArt::parse(eingabe.art.trim())
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Zielart {}", eingabe.art)))?;
    match (art.person(), eingabe.id) {
        (None, None) => Ok(AntragZiel::Einsatz),
        (None, Some(_)) => Err(AppError::Validation(
            "Ein Einsatz-Antrag nennt keine ziel.id".into(),
        )),
        (Some(_), None) => Err(AppError::Validation(
            "Ein Personen-Antrag braucht ziel.id".into(),
        )),
        (Some(p), Some(id)) => Ok(AntragZiel::Person(p, id)),
    }
}

/// GET /api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege — alle Anträge des Einsatzes,
/// neueste zuerst.
pub async fn antraege(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Json<Vec<SchwaerzungsantragAnzeige>>, AppError> {
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    Ok(Json(antrag::liste(&state.pool, kopf.id, Utc::now()).await?))
}

/// POST /api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege — Löschersuchen stellen (201).
/// 400 Form (Zielart, `ziel.id`, Aktenzeichen, leere Bestätigung), 404 Person nicht in diesem
/// Einsatz, 422 Bestätigung falsch oder Stammkraft, 409 aktiv, geschwärzt oder schon ein
/// offener bzw. vollzogener Antrag. Schwärzt NICHT: das tut der Purge-Lauf nach 24 Stunden.
pub async fn antrag_stellen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(req): JsonBody<NeuerSchwaerzungsantrag>,
) -> Result<(StatusCode, Json<SchwaerzungsantragAnzeige>), AppError> {
    archivkopf(&state, &benutzer, einsatz_id).await?;
    let ziel = ziel_aus(&req.ziel)?;
    let aktenzeichen = antrag::pruefe_aktenzeichen(&req.aktenzeichen)?;
    if req.bestaetigung.trim().is_empty() {
        return Err(AppError::Validation("bestaetigung fehlt".into()));
    }
    let jetzt = Utc::now();
    let id = antrag::stellen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        benutzer.org_id,
        ziel,
        &aktenzeichen,
        &req.bestaetigung,
        jetzt,
    )
    .await?;
    let angelegt = antrag::liste(&state.pool, einsatz_id, jetzt)
        .await?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| AppError::Internal(format!("Antrag {id} nach dem Anlegen nicht lesbar")))?;
    Ok((StatusCode::CREATED, Json(angelegt)))
}

/// POST /api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege/{aid}/zuruecknehmen — Rücknahme
/// innerhalb von 24 Stunden. 404 unbekannt, 409 vollzogen, zurückgenommen oder zu spät.
pub async fn antrag_zuruecknehmen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam((einsatz_id, antrag_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<SchwaerzungsantragAnzeige>>, AppError> {
    archivkopf(&state, &benutzer, einsatz_id).await?;
    let jetzt = Utc::now();
    antrag::zuruecknehmen(&state.pool, einsatz_id, antrag_id, benutzer.id, jetzt).await?;
    Ok(Json(antrag::liste(&state.pool, einsatz_id, jetzt).await?))
}

#[derive(Debug, Deserialize)]
pub struct Personensuche {
    /// Name oder Rufnummer, mindestens 3 Zeichen. Steht im Body, damit er in keinem
    /// Zugriffsprotokoll landet; er wird nicht geloggt.
    pub suchtext: String,
}

/// POST /api/aufbewahrung/einsaetze/{id}/personensuche — pseudonyme Suche nach Name oder
/// Rufnummer. Liest nur (POST nur wegen des Bodys). 400 Suchtext zu kurz, 409 geschwärzt.
pub async fn personensuche(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(req): JsonBody<Personensuche>,
) -> Result<impl IntoResponse, AppError> {
    let kopf = archivkopf(&state, &benutzer, einsatz_id).await?;
    if req.suchtext.trim().chars().count() < suche::MIN_SUCHTEXT {
        return Err(AppError::Validation(format!(
            "Suchtext braucht mindestens {} Zeichen",
            suche::MIN_SUCHTEXT
        )));
    }
    if kopf.geschwaerzt_at.is_some() {
        return Err(AppError::Conflict(
            "Einsatz ist geschwärzt — es gibt keine Namen mehr zu suchen".into(),
        ));
    }
    let treffer: Vec<PersonTrefferAnzeige> =
        suche::personensuche(&state.pool, kopf.id, req.suchtext.trim()).await?;
    Ok((
        [(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(treffer),
    ))
}
