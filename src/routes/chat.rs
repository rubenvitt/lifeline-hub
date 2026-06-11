use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::chat::repo;
use crate::chat::{ChatKanalAnzeige, ChatNachrichtAnzeige};
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::EtbTyp;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: der Chat des Einsatzes hat sich geändert. Event-Tag `chat`.
/// Das Frontend invalidiert daraufhin Kanal- und Nachrichten-Queries.
fn sse_chat(state: &AppState, einsatz_id: i64, data: String) {
    state.live.publiziere_event(einsatz_id, "chat", data);
}

/// Serialisiert eine Anzeige für den Live-Push; bei Serialisierungsfehler wird
/// ein minimales Fallback-Event gesendet (das Frontend invalidiert ohnehin nur).
fn als_json<T: serde::Serialize>(wert: &T, einsatz_id: i64) -> String {
    serde_json::to_string(wert)
        .unwrap_or_else(|_| serde_json::json!({ "einsatz_id": einsatz_id }).to_string())
}

// ---- Kanäle ----

/// GET /api/einsaetze/{id}/chat/kanaele — Kanäle listen (Default wird sichergestellt).
pub async fn kanaele_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<ChatKanalAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(repo::liste_kanaele(&state.pool, einsatz_id, benutzer.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeuerKanal {
    pub name: String,
    pub beschreibung: Option<String>,
}

/// POST /api/einsaetze/{id}/chat/kanaele — Kanal anlegen. Schreibrecht + aktiv.
pub async fn kanal_anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeuerKanal>,
) -> Result<(StatusCode, Json<ChatKanalAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Kanalname darf nicht leer sein".into()));
    }
    let beschreibung = req.beschreibung.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let kanal = repo::kanal_anlegen(&state.pool, einsatz_id, benutzer.id, name, beschreibung).await?;
    sse_chat(&state, einsatz_id, als_json(&kanal, einsatz_id));
    Ok((StatusCode::CREATED, Json(kanal)))
}

// ---- Nachrichten ----

#[derive(Debug, Deserialize)]
pub struct NachrichtenParams {
    pub before_id: Option<i64>,
    pub limit: Option<i64>,
}

/// GET /api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten — Nachrichten eines Kanals.
/// Lesezugriff (inkl. Beobachter). Cursor über `before_id`.
pub async fn nachrichten_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, kanal_id)): Path<(i64, i64)>,
    Query(params): Query<NachrichtenParams>,
) -> Result<Json<Vec<ChatNachrichtAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    // Cross-Einsatz-Schutz: Kanal muss zu diesem Einsatz gehören.
    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let limit = params.limit.unwrap_or(repo::STANDARD_LIMIT).clamp(1, repo::MAX_LIMIT);
    let filter = repo::NachrichtFilter { kanal_id, before_id: params.before_id, limit };
    Ok(Json(repo::abfrage(&state.pool, einsatz_id, &filter).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueNachricht {
    pub inhalt: String,
}

/// POST /api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten — Nachricht senden.
/// Schreibrecht + aktiv. Cross-Einsatz-Schutz auf den Kanal.
pub async fn nachricht_erfassen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, kanal_id)): Path<(i64, i64)>,
    Json(req): Json<NeueNachricht>,
) -> Result<(StatusCode, Json<ChatNachrichtAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Nachricht darf nicht leer sein".into()));
    }

    let nachricht = repo::anlegen(&state.pool, einsatz_id, benutzer.id,
        repo::NachrichtDaten { kanal_id, inhalt }).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok((StatusCode::CREATED, Json(nachricht)))
}

/// Lädt Einsatz + verifiziert Schreibrecht/Aktiv + Autorenschaft der Nachricht.
/// Gemeinsamer Vorlauf von Bearbeiten/Löschen. Liefert nichts (nur Gates).
async fn fordere_autor(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    nachricht_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Cross-Einsatz-Schutz + Existenz.
    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // Nur der Autor darf bearbeiten/löschen (auch die Einsatzleitung nicht fremd).
    match repo::autor_von(&state.pool, nachricht_id).await? {
        Some(autor) if autor == benutzer.id => Ok(()),
        Some(_) => Err(AppError::Forbidden),
        None => Err(AppError::NotFound),
    }
}

/// PATCH /api/einsaetze/{id}/chat/nachrichten/{mid} — eigene Nachricht bearbeiten.
pub async fn nachricht_bearbeiten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
    Json(req): Json<NeueNachricht>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    fordere_autor(&state, &benutzer, einsatz_id, nachricht_id).await?;
    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Nachricht darf nicht leer sein".into()));
    }
    let nachricht = repo::bearbeiten(&state.pool, nachricht_id, inhalt).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok(Json(nachricht))
}

/// DELETE /api/einsaetze/{id}/chat/nachrichten/{mid} — eigene Nachricht soft-löschen.
pub async fn nachricht_loeschen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    fordere_autor(&state, &benutzer, einsatz_id, nachricht_id).await?;
    repo::loeschen(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id,
        serde_json::json!({ "einsatz_id": einsatz_id, "nachricht_id": nachricht_id }).to_string());
    Ok(StatusCode::NO_CONTENT)
}

// ---- Heraufstufen ----

#[derive(Debug, Deserialize)]
pub struct HeraufstufenBody {
    pub typ: String,
    /// Optionaler überarbeiteter Text; fehlt er, wird der Nachrichtentext genutzt.
    pub inhalt: Option<String>,
}

/// POST /api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-etb — Nachricht → ETB.
/// Schreibrecht + aktiv. Server erzwingt die zulässigen ETB-Typen.
pub async fn heraufstufen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
    Json(req): Json<HeraufstufenBody>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    // Server-seitige Typ-Allowlist: kein 'system' (Modul-reserviert) und keine
    // 'berichtigung' (bräuchte berichtigt_eintrag_id; semantisch unzulässig hier).
    let typ = EtbTyp::parse(&req.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger ETB-Typ".into()))?;
    if !typ.darf_client_erfassen() || typ.ist_berichtigung() {
        return Err(AppError::Validation(
            "Für die Heraufstufung sind nur meldung/anordnung/lage/entscheidung zulässig".into(),
        ));
    }

    // Quellnachricht laden: liefert Ereigniszeit (Snapshot) + Fallback-Inhalt.
    let quelle = repo::laden(&state.pool, nachricht_id).await?;
    let inhalt = req
        .inhalt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| quelle.inhalt.clone())
        .ok_or_else(|| AppError::Validation("Kein Inhalt zum Heraufstufen".into()))?;

    let etb_id = repo::heraufstufen_zu_etb(
        &state.pool, einsatz_id, nachricht_id, benutzer.id, typ.as_str(), &inhalt, &quelle.erstellt_at,
    ).await?;

    // Beide Events publizieren (wie lagebericht::freigeben): ETB-Eintrag + Chat-Update.
    if let Ok(etb_anzeige) = crate::etb::repo::laden(&state.pool, etb_id).await {
        if let Ok(json) = serde_json::to_string(&etb_anzeige) {
            state.live.publiziere(einsatz_id, json);
        }
    }
    let nachricht = repo::laden(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok(Json(nachricht))
}
