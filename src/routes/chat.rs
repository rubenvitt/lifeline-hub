use crate::app::AppState;
use crate::chat::repo;
use crate::chat::{BezugTyp, ChatKanalAnzeige, ChatNachrichtAnzeige};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Auftraege, Chat, Etb, ModulMarker};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::routes::support::pflicht;
// Vokabular modulübergreifend über das Kommunikations-Fundament referenziert
// (LFH-84) statt direkt aus `etb` — Single Source of Truth bleibt `etb`.
use crate::kommunikation::EtbTyp;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify: der Chat des Einsatzes hat sich geändert. Event-Tag `chat`.
/// Das Frontend invalidiert daraufhin Kanal- und Nachrichten-Queries.
fn sse_chat(state: &AppState, einsatz_id: i64, data: String) {
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Chat, data);
}

/// Live-Payload einer Chat-Nachricht — **ID-only** (F01/LFH-227). Vorher ging die
/// komplette `ChatNachrichtAnzeige` (inkl. `inhalt` und `autor_name`) über den
/// einsatzweiten Broadcast; der Inhalt gehört hinter den `chat`-GET, der die
/// Modul-Berechtigung prüft. Das Frontend invalidiert ohnehin nur.
fn nachricht_ids(n: &ChatNachrichtAnzeige) -> String {
    serde_json::json!({
        "einsatz_id": n.einsatz_id,
        "kanal_id": n.kanal_id,
        "nachricht_id": n.id,
    })
    .to_string()
}

/// Live-Payload eines Chat-Kanals — ID-only, siehe [`nachricht_ids`].
fn kanal_ids(einsatz_id: i64, kanal_id: i64) -> String {
    serde_json::json!({ "einsatz_id": einsatz_id, "kanal_id": kanal_id }).to_string()
}

// ---- Kanäle ----

/// GET /api/einsaetze/{id}/chat/kanaele — Kanäle listen (Default wird sichergestellt).
pub async fn kanaele_liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Chat>,
) -> Result<Json<Vec<ChatKanalAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        repo::liste_kanaele(&state.pool, einsatz_id, ctx.benutzer.id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct NeuerKanal {
    pub name: String,
    pub beschreibung: Option<String>,
}

/// POST /api/einsaetze/{id}/chat/kanaele — Kanal anlegen. Schreibrecht + aktiv.
pub async fn kanal_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Chat>,
    JsonBody(req): JsonBody<NeuerKanal>,
) -> Result<(StatusCode, Json<ChatKanalAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let name = pflicht(&req.name, "Kanalname")?;
    let beschreibung = req
        .beschreibung
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let kanal = repo::kanal_anlegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &name,
        beschreibung,
    )
    .await?;
    sse_chat(&state, einsatz_id, kanal_ids(einsatz_id, kanal.id));
    Ok((StatusCode::CREATED, Json(kanal)))
}

/// POST /api/einsaetze/{id}/chat/kanaele/{kid}/gelesen — aktuellen Kanal persistent
/// für den angemeldeten Benutzer als gelesen markieren. Auch Beobachter dürfen lesen.
pub async fn kanal_gelesen_markieren(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Chat>,
    PfadParam((_eid, kanal_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let jetzt = crate::zeit::jetzt();
    repo::kanal_gelesen_markieren(
        &state.pool,
        ctx.einsatz.org_id,
        einsatz_id,
        kanal_id,
        ctx.benutzer.id,
        &jetzt,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
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
    ctx: EinsatzLesezugriff<Chat>,
    PfadParam((_eid, kanal_id)): PfadParam<(i64, i64)>,
    Query(params): Query<NachrichtenParams>,
) -> Result<Json<Vec<ChatNachrichtAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Cross-Einsatz-Schutz: Kanal muss zu diesem Einsatz gehören.
    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let limit = params
        .limit
        .unwrap_or(repo::STANDARD_LIMIT)
        .clamp(1, repo::MAX_LIMIT);
    let filter = repo::NachrichtFilter {
        kanal_id,
        before_id: params.before_id,
        limit,
    };
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
    ctx: EinsatzSchreibzugriff<Chat>,
    PfadParam((_eid, kanal_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<NeueNachricht>,
) -> Result<(StatusCode, Json<ChatNachrichtAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    if !repo::gehoert_kanal_zu_einsatz(&state.pool, kanal_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() && req.anhang_ids.is_empty() {
        return Err(AppError::Validation(
            "Nachricht braucht Text oder einen Anhang".into(),
        ));
    }

    // Doppelte IDs deduplizieren: ein Client darf denselben Anhang zweimal nennen,
    // ohne dass die Join-Tabellen-PK (nachricht_id, anhang_id) verletzt wird (sonst
    // 500 statt einer sauberen Verknüpfung). Reihenfolge egal — Anzeige sortiert per id.
    let mut anhang_ids = req.anhang_ids;
    anhang_ids.sort_unstable();
    anhang_ids.dedup();

    // Nachricht + Anhang-Verknüpfung atomar; fremde/unbekannte Anhänge → Rollback.
    let nachricht = repo::anlegen_mit_anhaengen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        kanal_id,
        inhalt,
        &anhang_ids,
    )
    .await?;
    sse_chat(&state, einsatz_id, nachricht_ids(&nachricht));
    Ok((StatusCode::CREATED, Json(nachricht)))
}

/// Verifiziert die Autorenschaft der Nachricht (die Gates laufen im Extractor).
/// Gemeinsamer Vorlauf von Bearbeiten/Löschen.
async fn fordere_autor(
    state: &AppState,
    benutzer_id: i64,
    einsatz_id: i64,
    nachricht_id: i64,
) -> Result<(), AppError> {
    // Cross-Einsatz-Schutz + Existenz.
    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // Nur der Autor darf bearbeiten/löschen (auch die Einsatzleitung nicht fremd).
    match repo::autor_von(&state.pool, nachricht_id).await? {
        Some(autor) if autor == benutzer_id => Ok(()),
        Some(_) => Err(AppError::Forbidden),
        None => Err(AppError::NotFound),
    }
}

/// PATCH /api/einsaetze/{id}/chat/nachrichten/{mid} — eigene Nachricht bearbeiten.
pub async fn nachricht_bearbeiten(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Chat>,
    PfadParam((_eid, nachricht_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<NeueNachricht>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    fordere_autor(&state, ctx.benutzer.id, einsatz_id, nachricht_id).await?;
    let inhalt = pflicht(&req.inhalt, "Nachricht")?;
    let nachricht = repo::bearbeiten(&state.pool, nachricht_id, &inhalt).await?;
    sse_chat(&state, einsatz_id, nachricht_ids(&nachricht));
    Ok(Json(nachricht))
}

/// DELETE /api/einsaetze/{id}/chat/nachrichten/{mid} — eigene Nachricht soft-löschen.
pub async fn nachricht_loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Chat>,
    PfadParam((_eid, nachricht_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    fordere_autor(&state, ctx.benutzer.id, einsatz_id, nachricht_id).await?;
    repo::loeschen(&state.pool, nachricht_id).await?;
    sse_chat(
        &state,
        einsatz_id,
        serde_json::json!({ "einsatz_id": einsatz_id, "nachricht_id": nachricht_id }).to_string(),
    );
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
    ctx: EinsatzSchreibzugriff<Chat>,
    PfadParam((_eid, nachricht_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<BezugBody>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let typ = BezugTyp::parse(&req.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger Bezug-Typ".into()))?;
    let nachricht =
        repo::bezug_setzen(&state.pool, einsatz_id, nachricht_id, typ, req.ziel_id).await?;
    sse_chat(&state, einsatz_id, nachricht_ids(&nachricht));
    Ok(Json(nachricht))
}

/// DELETE /api/einsaetze/{id}/chat/nachrichten/{mid}/bezug — Sachbezug lösen.
/// Schreibrecht + aktiv.
pub async fn bezug_loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Chat>,
    PfadParam((_eid, nachricht_id)): PfadParam<(i64, i64)>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    let nachricht = repo::bezug_loesen(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id, nachricht_ids(&nachricht));
    Ok(Json(nachricht))
}

// ---- Heraufstufen ----

#[derive(Debug, Deserialize)]
pub struct HeraufstufenBody {
    pub typ: String,
    /// Optionaler überarbeiteter Text; fehlt er, wird der Nachrichtentext genutzt.
    pub inhalt: Option<String>,
    /// Anhänge der Nachricht, die als Kopie an den ETB-Eintrag gehen (LFH-700). Fehlt das
    /// Feld oder ist es leer, wird keine Datei übernommen: Das ETB ist unveränderlich, also
    /// entscheidet die Person im Dialog, nicht eine Vorgabe „alle".
    #[serde(default)]
    pub anhang_ids: Vec<i64>,
}

/// POST /api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-etb — Nachricht → ETB.
/// Schreibrecht + aktiv + Freigabe des Moduls `etb`. Server erzwingt die zulässigen ETB-Typen.
pub async fn heraufstufen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Chat>,
    PfadParam((_eid, nachricht_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<HeraufstufenBody>,
) -> Result<Json<ChatNachrichtAnzeige>, AppError> {
    // Das Heraufstufen schreibt ins ETB, also gilt dessen Modulfreigabe (Spec `modul-freigabe`,
    // LFH-904): Chat-Schreibrecht allein ist kein Weg am gesperrten Tagebuch vorbei. 403 vor 404.
    fordere_zielmodul::<Etb>(&state, &ctx).await?;
    let einsatz_id = ctx.einsatz.id;
    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    // Server-seitige Typ-Allowlist: kein 'system' (Modul-reserviert) und keine
    // 'berichtigung' (bräuchte berichtigt_eintrag_id; semantisch unzulässig hier).
    let typ =
        EtbTyp::parse(&req.typ).ok_or_else(|| AppError::Validation("Ungültiger ETB-Typ".into()))?;
    if !typ.darf_client_erfassen() || typ.ist_berichtigung() {
        return Err(AppError::Validation(
            "Für die Heraufstufung sind nur meldung/anordnung/lage/entscheidung zulässig".into(),
        ));
    }

    // Wie Chat-Senden und ETB-Erfassen: doppelte IDs gelten als eine, die Grenze ist die des
    // ETB-Eintrags (keine zweite Zahl).
    let mut anhang_ids = req.anhang_ids;
    anhang_ids.sort_unstable();
    anhang_ids.dedup();
    if anhang_ids.len() > crate::routes::etb::MAX_ANHAENGE_JE_EINTRAG {
        return Err(AppError::Validation(format!(
            "Höchstens {} Anhänge je Eintrag",
            crate::routes::etb::MAX_ANHAENGE_JE_EINTRAG
        )));
    }

    // Quellnachricht laden: liefert Ereigniszeit (Snapshot) + Fallback-Inhalt.
    let quelle = repo::laden(&state.pool, nachricht_id).await?;
    let inhalt = req
        .inhalt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        // Eine Nachricht nur mit Anhang trägt `""`: kein Fallback, sonst entstünde ein leerer,
        // unveränderlicher ETB-Eintrag (LFH-700).
        .or_else(|| quelle.inhalt.clone().filter(|s| !s.trim().is_empty()))
        .ok_or_else(|| AppError::Validation("Kein Inhalt zum Heraufstufen".into()))?;

    let etb_id = repo::heraufstufen_zu_etb(
        &state.pool,
        einsatz_id,
        nachricht_id,
        ctx.benutzer.id,
        typ.as_str(),
        &inhalt,
        &quelle.erstellt_at,
        &anhang_ids,
    )
    .await?;

    // Beide Events publizieren (wie lagebericht::freigeben): ETB-Eintrag + Chat-Update.
    state.live.publiziere(einsatz_id, etb_id);
    let nachricht = repo::laden(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id, nachricht_ids(&nachricht));
    Ok(Json(nachricht))
}

/// POST /api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-auftrag — Nachricht → Auftrag (LFH-101).
/// Schreibrecht + aktiv. Erzeugt aus der Nachricht einen formalen Auftrag (inkl. ETB-Anordnung,
/// Pattern B) und markiert die Nachricht als „heraufgestuft zu Auftrag". Auftragsfelder (Empfänger,
/// Priorität …) kommen aus dem Request und durchlaufen dieselbe Validierung wie POST /auftraege.
pub async fn heraufstufen_auftrag(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Chat>,
    PfadParam((_eid, nachricht_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<crate::auftrag::NeuerAuftrag>,
) -> Result<(StatusCode, Json<ChatNachrichtAnzeige>), AppError> {
    // Wie POST /auftraege: die Freigabe von `auftraege`, nicht zusätzlich die des ETB — die
    // ETB-Anordnung ist dort wie hier Nebeneffekt (Spec `modul-freigabe`, LFH-904).
    fordere_zielmodul::<Auftraege>(&state, &ctx).await?;
    let einsatz_id = ctx.einsatz.id;
    if !repo::gehoert_nachricht_zu_einsatz(&state.pool, nachricht_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }

    // Gleiche Validierung wie POST /auftraege (geteilt) → kein zweiter, ungeprüfter Pfad.
    let now = crate::zeit::jetzt();
    let validiert =
        crate::auftrag::validiere_neuen_auftrag(&state.pool, einsatz_id, &req, &now, None).await?;
    let auftrag_id = repo::heraufstufen_zu_auftrag(
        &state.pool,
        einsatz_id,
        nachricht_id,
        ctx.benutzer.id,
        validiert.daten(),
    )
    .await?;

    // ETB-Anordnung entstand im selben Commit → ETB-Live-Event + Auftrag-Board aktualisieren.
    if let Ok(detail) = crate::auftrag::repo::laden(&state.pool, auftrag_id, &now).await {
        if let Some(etb_id) = detail.auftrag.etb_anordnung_id {
            state.live.publiziere(einsatz_id, etb_id);
        }
    }
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Auftrag);
    let nachricht = repo::laden(&state.pool, nachricht_id).await?;
    sse_chat(&state, einsatz_id, nachricht_ids(&nachricht));
    Ok((StatusCode::CREATED, Json(nachricht)))
}

/// Modulfreigabe des Moduls, in das ein Heraufstufen schreibt (LFH-904). Der Extractor prüft nur
/// das Chat-Modul; das Zielmodul kommt als Marker, damit kein Key als Literal driftet.
async fn fordere_zielmodul<M: ModulMarker>(
    state: &AppState,
    ctx: &EinsatzSchreibzugriff<Chat>,
) -> Result<(), AppError> {
    let key = M::KEY.expect("Zielmodul des Heraufstufens ist an ein Modul gebunden");
    ctx.fordere_modul_zugriff(&state.pool, key).await
}
