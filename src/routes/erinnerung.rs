use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "erinnerungen";
use crate::erinnerung::{repo, ErinnerungAnzeige, STATUS_ERLEDIGT, STATUS_OFFEN, STATUS_QUITTIERT};
use crate::error::AppError;
use crate::kommunikation::{
    repo as krepo, OBJEKT_AUFTRAG, OBJEKT_ERINNERUNG, OBJEKT_MELDUNG, VOLLZUG_OFFEN,
    VOLLZUG_VOLLZOGEN,
};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Erinnerungen des Einsatzes haben sich geändert (Tag `erinnerung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Erinnerung,
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `true` → nur offene Erinnerungen.
    pub nur_offen: Option<bool>,
}

/// GET /api/einsaetze/{id}/erinnerungen — Erinnerungen listen (Lesezugriff).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<ErinnerungAnzeige>>, AppError> {
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
    let nur_offen = params.nur_offen.unwrap_or(false);
    Ok(Json(
        repo::liste(&state.pool, einsatz_id, nur_offen, &jetzt()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct NeueErinnerung {
    pub titel: String,
    pub beschreibung: Option<String>,
    /// 'YYYY-MM-DD HH:MM' oder mit Sekunden (UTC).
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
    pub empfaenger_funktion: Option<String>,
    /// Generischer Sachbezug (z. B. 'etb' + ETB-Eintrag-ID, LFH-106). Both-or-neither:
    /// beide gesetzt oder beide leer — kein FK, nur code-validiert.
    pub bezug_typ: Option<String>,
    pub bezug_id: Option<i64>,
}

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
/// Akzeptiert mit/ohne Sekunden; sonst `Validation`.
fn parse_faellig(roh: &str) -> Result<String, AppError> {
    let roh = roh.trim().replace('T', " ");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&roh, fmt) {
            return Ok(n.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    Err(AppError::Validation(
        "Ungültiger Fälligkeitszeitpunkt".into(),
    ))
}

/// POST /api/einsaetze/{id}/erinnerungen — Erinnerung anlegen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(req): JsonBody<NeueErinnerung>,
) -> Result<(StatusCode, Json<ErinnerungAnzeige>), AppError> {
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

    let titel = req.titel.trim();
    if titel.is_empty() {
        return Err(AppError::Validation("Titel darf nicht leer sein".into()));
    }
    if let Some(iv) = req.intervall_minuten {
        if iv <= 0 {
            return Err(AppError::Validation("Intervall muss positiv sein".into()));
        }
    }
    let faellig = parse_faellig(&req.faellig_at)?;
    let beschreibung = req
        .beschreibung
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let empfaenger = req
        .empfaenger_funktion
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Bezug both-or-neither (wie der Chat-Sachbezug): entweder beides oder nichts.
    let bezug_typ = req
        .bezug_typ
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match (bezug_typ, req.bezug_id) {
        (Some(typ), Some(id)) => {
            // Allowlist + einsatz-gescopter Existenz-Check (analog Chat-Sachbezug,
            // src/chat/repo.rs::ziel_gehoert_zu_einsatz). Schützt u. a. den Scheduler-
            // Pfad bezug_typ='meldung' → setze_eskaliert (nicht einsatz-gescopt) vor
            // Cross-Einsatz-Schreibzugriff. Unbekannter Typ → Validation (400);
            // fremdes/unbekanntes Ziel → NotFound (404, wie fordere_bearbeitbar).
            let gehoert = if typ == "etb" {
                crate::etb::repo::gehoert_zu_einsatz(&state.pool, id, einsatz_id).await?
            } else if typ == OBJEKT_MELDUNG {
                crate::meldung::repo::gehoert_zu_einsatz(&state.pool, id, einsatz_id).await?
            } else if typ == OBJEKT_AUFTRAG {
                crate::auftrag::repo::gehoert_zu_einsatz(&state.pool, id, einsatz_id).await?
            } else {
                return Err(AppError::Validation("Unbekannter bezug_typ".into()));
            };
            if !gehoert {
                return Err(AppError::NotFound);
            }
        }
        (None, None) => {}
        _ => {
            return Err(AppError::Validation(
                "Bezug erfordert bezug_typ und bezug_id zusammen".into(),
            ))
        }
    }

    let r = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::ErinnerungDaten {
            titel,
            beschreibung,
            faellig_at: &faellig,
            intervall_minuten: req.intervall_minuten,
            empfaenger_funktion: empfaenger,
            bezug_typ,
            bezug_id: req.bezug_id,
        },
        &jetzt(),
    )
    .await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(r)))
}

/// Gemeinsamer Vorlauf für Status-Übergänge: Gates + Cross-Einsatz-Schutz.
/// Gibt `org_id` des Einsatzes zurück (für kommunikation_status-Schreibpfad).
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    erinnerung_id: i64,
) -> Result<i64, AppError> {
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
    if !repo::gehoert_zu_einsatz(&state.pool, erinnerung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(einsatz.org_id)
}

/// POST /api/einsaetze/{id}/erinnerungen/{eid}/erledigen — Status → erledigt.
pub async fn erledigen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, erinnerung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let now = jetzt();
    repo::status_setzen(&state.pool, erinnerung_id, STATUS_ERLEDIGT, &now).await?;
    krepo::setze_vollzug(
        &state.pool,
        org_id,
        einsatz_id,
        OBJEKT_ERINNERUNG,
        erinnerung_id,
        VOLLZUG_VOLLZOGEN,
        benutzer.id,
        &now,
    )
    .await?;
    let r = repo::laden(&state.pool, erinnerung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}

/// POST /api/einsaetze/{id}/erinnerungen/{eid}/quittieren — Status → quittiert.
pub async fn quittieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, erinnerung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let now = jetzt();
    repo::status_setzen(&state.pool, erinnerung_id, STATUS_QUITTIERT, &now).await?;
    krepo::quittiere(
        &state.pool,
        org_id,
        einsatz_id,
        OBJEKT_ERINNERUNG,
        erinnerung_id,
        benutzer.id,
        &now,
    )
    .await?;
    let r = repo::laden(&state.pool, erinnerung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}

/// POST /api/einsaetze/{id}/erinnerungen/{eid}/oeffnen — Rücknahme von
/// Erledigt/Quittiert (LFH-343 · C8, Befund H50).
///
/// Der Gegenweg zur Direktaktion ohne Rückfrage: beide Knöpfe schalten seither mit
/// EINEM Klick, und der Rückgängig-Toast braucht einen Weg, den der Server annimmt.
/// Geräumt werden ALLE DREI Achsen — Triage-Status, Vollzug und Quittung. Bliebe eine
/// stehen, zeigte die Karte „offen" und trüge zugleich den Vollzugs- oder
/// Quittungsvermerk.
pub async fn oeffnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, erinnerung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let now = jetzt();
    let aktuell = repo::laden(&state.pool, erinnerung_id, &now).await?;
    if aktuell.status == STATUS_OFFEN {
        // Zustandsverletzung, kein Feldfehler → 422 (src/error.rs). Ein stiller
        // Erfolg wäre schlimmer: der Toast behauptete eine Rücknahme, die keine war.
        return Err(AppError::UnprocessableEntity(
            "Die Erinnerung ist bereits offen".into(),
        ));
    }
    repo::wieder_oeffnen(&state.pool, erinnerung_id, &now).await?;
    krepo::setze_vollzug(
        &state.pool,
        org_id,
        einsatz_id,
        OBJEKT_ERINNERUNG,
        erinnerung_id,
        VOLLZUG_OFFEN,
        benutzer.id,
        &now,
    )
    .await?;
    krepo::loesche_quittung(&state.pool, einsatz_id, OBJEKT_ERINNERUNG, erinnerung_id).await?;
    // NACH den beiden Achsen laden — sonst trüge die Antwort einen Zustand, den es
    // nie gab (dieselbe Regel wie bei der Sichtung in LFH-340/C5). Deshalb wird der
    // Rückgabewert von `wieder_oeffnen` oben verworfen.
    let r = repo::laden(&state.pool, erinnerung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}

#[cfg(test)]
mod tests {
    use crate::kommunikation::{repo as krepo, OBJEKT_ERINNERUNG, VOLLZUG_VOLLZOGEN};
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    // Spiegelt die Wirkung des erledigen-Handlers: Scheduler-Status 'erledigt'
    // UND geteilte Vollzugs-Achse 'vollzogen'.
    #[tokio::test]
    async fn erledigen_schreibt_vollzug_in_kommunikation_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = crate::erinnerung::repo::anlegen(
            &pool,
            e,
            b,
            crate::erinnerung::repo::ErinnerungDaten {
                titel: "X",
                beschreibung: None,
                faellig_at: "2026-06-11 10:00:00",
                intervall_minuten: None,
                empfaenger_funktion: None,
                bezug_typ: None,
                bezug_id: None,
            },
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

        crate::erinnerung::repo::status_setzen(
            &pool,
            r.id,
            crate::erinnerung::STATUS_ERLEDIGT,
            "2026-06-11 11:00:00",
        )
        .await
        .unwrap();
        krepo::setze_vollzug(
            &pool,
            1,
            e,
            OBJEKT_ERINNERUNG,
            r.id,
            VOLLZUG_VOLLZOGEN,
            b,
            "2026-06-11 11:00:00",
        )
        .await
        .unwrap();

        let s = krepo::lade_status(&pool, e, OBJEKT_ERINNERUNG, r.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(s.vollzug_status, VOLLZUG_VOLLZOGEN);
        let st: String = sqlx::query_scalar("SELECT status FROM erinnerung WHERE id = ?")
            .bind(r.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(st, "erledigt", "Scheduler-Treiber bleibt gesetzt");
    }
}
