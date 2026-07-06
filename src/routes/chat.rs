use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::chat::repo;
use crate::chat::{BezugTyp, ChatKanalAnzeige, ChatNachrichtAnzeige};
use crate::einsatz::berechtigung::{fordere_modul_zugriff_laden, fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "chat";
use crate::error::AppError;
// Vokabular modulübergreifend über das Kommunikations-Fundament referenziert
// (LFH-84) statt direkt aus `etb` — Single Source of Truth bleibt `etb`.
use crate::kommunikation::EtbTyp;
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
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
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
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
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
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;

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
    /// IDs zuvor hochgeladener Anhänge (über POST .../anhaenge). Optional; beim
    /// Bearbeiten ignoriert. Eine Nachricht ohne Text ist zulässig, wenn sie
    /// mindestens einen Anhang trägt.
    #[serde(default)]
    pub anhang_ids: Vec<i64>,
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
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() && req.anhang_ids.is_empty() {
        return Err(AppError::Validation("Nachricht braucht Text oder einen Anhang".into()));
    }

    // Doppelte IDs deduplizieren: ein Client darf denselben Anhang zweimal nennen,
    // ohne dass die Join-Tabellen-PK (nachricht_id, anhang_id) verletzt wird (sonst
    // 500 statt einer sauberen Verknüpfung). Reihenfolge egal — Anzeige sortiert per id.
    let mut anhang_ids = req.anhang_ids;
    anhang_ids.sort_unstable();
    anhang_ids.dedup();

    // Nachricht + Anhang-Verknüpfung atomar; fremde/unbekannte Anhänge → Rollback.
    let nachricht = repo::anlegen_mit_anhaengen(
        &state.pool, einsatz_id, benutzer.id, kanal_id, inhalt, &anhang_ids,
    ).await?;
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
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
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

// ---- Sachbezug (LFH-103) ----

#[derive(Debug, Deserialize)]
pub struct BezugBody {
    pub typ: String,
    pub ziel_id: i64,
}

/// PUT /api/einsaetze/{id}/chat/nachrichten/{mid}/bezug — polymorphen Sachbezug
/// setzen/ändern. Schreibrecht + aktiv (nicht nur Autor, anders als Bearbeiten);
/// der Typ ist server-validiert, das Ziel muss zum Einsatz gehören (im Repo geprüft).
pub async fn bezug_setzen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
    Json(req): Json<BezugBody>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let typ = BezugTyp::parse(&req.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger Bezug-Typ".into()))?;
    let nachricht =
        repo::bezug_setzen(&state.pool, einsatz_id, nachricht_id, typ, req.ziel_id).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok(Json(nachricht))
}

/// DELETE /api/einsaetze/{id}/chat/nachrichten/{mid}/bezug — Sachbezug lösen.
/// Schreibrecht + aktiv.
pub async fn bezug_loeschen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let nachricht = repo::bezug_loesen(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok(Json(nachricht))
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
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
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

/// POST /api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-auftrag — Nachricht → Auftrag (LFH-101).
/// Schreibrecht + aktiv. Erzeugt aus der Nachricht einen formalen Auftrag (inkl. ETB-Anordnung,
/// Pattern B) und markiert die Nachricht als „heraufgestuft zu Auftrag". Auftragsfelder (Empfänger,
/// Priorität …) kommen aus dem Request und durchlaufen dieselbe Validierung wie POST /auftraege.
pub async fn heraufstufen_auftrag(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, nachricht_id)): Path<(i64, i64)>,
    Json(req): Json<crate::auftrag::NeuerAuftrag>,
) -> Result<(StatusCode, Json<ChatNachrichtAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    // Gleiche Validierung wie POST /auftraege (geteilt) → kein zweiter, ungeprüfter Pfad.
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let validiert =
        crate::auftrag::validiere_neuen_auftrag(&state.pool, einsatz_id, &req, &now, None).await?;
    let auftrag_id = repo::heraufstufen_zu_auftrag(
        &state.pool, einsatz_id, nachricht_id, benutzer.id, validiert.daten(),
    )
    .await?;

    // ETB-Anordnung entstand im selben Commit → ETB-Live-Event + Auftrag-Board aktualisieren.
    if let Ok(detail) = crate::auftrag::repo::laden(&state.pool, auftrag_id, &now).await {
        if let Some(etb_id) = detail.auftrag.etb_anordnung_id {
            if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
                state.live.publiziere(einsatz_id, als_json(&etb, einsatz_id));
            }
        }
    }
    state.live.publiziere_event(
        einsatz_id,
        "auftrag",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
    let nachricht = repo::laden(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id, als_json(&nachricht, einsatz_id));
    Ok((StatusCode::CREATED, Json(nachricht)))
}
