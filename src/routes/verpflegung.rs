//! Routen des Fachmoduls Verpflegung (LFH-634): Zeitfenster mit Bedarf, Ausgaben dagegen.
//!
//! Gates strukturell über `EinsatzLesezugriff<Verpflegung>` (alle Einsatzmitglieder inkl.
//! Beobachter) bzw. `EinsatzSchreibzugriff<Verpflegung>` (Schreibrecht, aktiver Einsatz,
//! Modul). Ausnahme ist „Ausgabe erfassen“ mit `EinsatzSchreibfreigabe` (LFH-688): ihr
//! Replay-Lookup läuft vor `fordere_aktiv`. Ein abgeschlossener Einsatz ist damit 409 aus `fordere_aktiv` im Extractor — wie bei
//! Ablösung und Betreuung, NICHT über `fordere_aktiv_in_tx` (design.md D4). Bodies nur über
//! `JsonBody`, Sub-IDs nur über `PfadParam`.
//!
//! **Statuscodes** (design.md D4, src/AGENTS.md „Statuscode-Konvention“):
//! - **400** — das Feld für sich: fehlendes Pflichtfeld, leere Bezeichnung, negativer
//!   Bedarfsteil oder Kostform, Menge ≤ 0, unlesbarer Zeitpunkt.
//! - **404** — fremdes Zeitfenster, fremde Ausgabe, fremde Nachforderung.
//! - **422** — der Zusammenhang: Ende nicht nach Beginn, Sonderkost über Gesamtbedarf bzw.
//!   Menge, Löschen mit gültiger Ausgabe, zweite Rücknahme.
//!
//! Die fachlichen Prüfungen liegen im Repo; die Route liest JSON, normalisiert die Zeitpunkte
//! (`etb::normalisiere_zeit`), lädt ETB-Startwert und Org-Zeitzone und öffnet die Transaktion —
//! dieselbe Arbeitsteilung wie in `routes/betreuung.rs`.
//!
//! **Live** nach dem Commit (design.md D5/D6): zuerst der ETB-Kurzruf je Eintrag, dann
//! `LiveEvent::Verpflegung` mit `{einsatz_id}` — keine Mengen, Bezeichnungen oder Freitexte.
//! Ein Ändern ohne wirksame Änderung (leere `etb_ids`) publiziert nichts. Ausgabe und Rücknahme
//! schreiben keinen ETB-Eintrag und publizieren nur das Modul-Ereignis.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;

use serde::Deserialize;

use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibfreigabe, EinsatzSchreibzugriff};
use crate::einsatz::modul::Verpflegung;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::verpflegung::repo::{self, AusgabeEingabe, ZeitfensterAenderung, ZeitfensterEingabe};
use crate::verpflegung::{
    AusgabeErgebnis, SonderkostEingabe, VerpflegungAnzeige, ZeitfensterAnzeige,
};

/// Nach dem Commit: ETB-Kurzruf je Eintrag, dann das Modul-Ereignis mit Kennungen only.
fn publiziere(state: &AppState, einsatz_id: i64, etb_ids: &[i64]) {
    for etb_id in etb_ids {
        state.live.publiziere(einsatz_id, *etb_id);
    }
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Verpflegung);
}

/// Normalisiert einen übergebenen Zeitpunkt auf das Drahtformat (UTC). Unlesbar → 400.
fn zeit(s: &str) -> Result<String, AppError> {
    crate::etb::normalisiere_zeit(s.trim())
}

fn zeit_opt(s: Option<String>) -> Result<Option<String>, AppError> {
    s.as_deref().map(zeit).transpose()
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/verpflegung — alle Zeitfenster nach Beginn, je mit Deckung und
/// Ausgaben.
pub async fn uebersicht(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Verpflegung>,
) -> Result<Json<VerpflegungAnzeige>, AppError> {
    Ok(Json(repo::liste(&state.pool, ctx.einsatz.id).await?))
}

// ── Zeitfenster ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ZeitfensterAnlegen {
    bezeichnung: String,
    /// ISO mit Zone oder `YYYY-MM-DD HH:MM:SS` (UTC). Pflicht: fehlt es, scheitert der Body am
    /// Extractor (400).
    von_at: String,
    bis_at: String,
    bedarf_kraefte: i64,
    bedarf_betreute: i64,
    /// Fehlt = 0.
    #[serde(default)]
    bedarf_weitere: Option<i64>,
    /// Fehlt, oder fehlende Kostform = 0.
    #[serde(default)]
    sonderkost: Option<SonderkostEingabe>,
}

/// POST /api/einsaetze/{id}/verpflegung/zeitfenster
pub async fn zeitfenster_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    JsonBody(req): JsonBody<ZeitfensterAnlegen>,
) -> Result<(StatusCode, Json<ZeitfensterAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = ZeitfensterEingabe {
        bezeichnung: req.bezeichnung,
        von_at: zeit(&req.von_at)?,
        bis_at: zeit(&req.bis_at)?,
        bedarf_kraefte: req.bedarf_kraefte,
        bedarf_betreute: req.bedarf_betreute,
        bedarf_weitere: req.bedarf_weitere.unwrap_or(0),
        sonderkost: req.sonderkost.unwrap_or_default(),
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = repo::zeitzone(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::zeitfenster_anlegen_tx(conn, einsatz_id, benutzer_id, startwert, tz, &eingabe).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids);
    Ok((
        StatusCode::CREATED,
        Json(repo::zeitfenster_laden(&state.pool, einsatz_id, g.id).await?),
    ))
}

/// Teiländerung: jedes fehlende Feld bleibt unverändert, auch je Kostform.
#[derive(Debug, Deserialize)]
pub struct ZeitfensterAendern {
    #[serde(default)]
    bezeichnung: Option<String>,
    #[serde(default)]
    von_at: Option<String>,
    #[serde(default)]
    bis_at: Option<String>,
    #[serde(default)]
    bedarf_kraefte: Option<i64>,
    #[serde(default)]
    bedarf_betreute: Option<i64>,
    #[serde(default)]
    bedarf_weitere: Option<i64>,
    #[serde(default)]
    sonderkost: Option<SonderkostEingabe>,
}

/// PATCH /api/einsaetze/{id}/verpflegung/zeitfenster/{zid}
pub async fn zeitfenster_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<ZeitfensterAendern>,
) -> Result<Json<ZeitfensterAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let aenderung = ZeitfensterAenderung {
        bezeichnung: req.bezeichnung,
        von_at: zeit_opt(req.von_at)?,
        bis_at: zeit_opt(req.bis_at)?,
        bedarf_kraefte: req.bedarf_kraefte,
        bedarf_betreute: req.bedarf_betreute,
        bedarf_weitere: req.bedarf_weitere,
        sonderkost: req.sonderkost.unwrap_or_default(),
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = repo::zeitzone(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::zeitfenster_aendern_tx(
            conn,
            einsatz_id,
            zid,
            benutzer_id,
            startwert,
            tz,
            &aenderung,
        )
        .await
    })?;
    // Leerlauf-Riegel: ohne wirksame Änderung weder ETB noch Ereignis.
    if !g.etb_ids.is_empty() {
        publiziere(&state, einsatz_id, &g.etb_ids);
    }
    Ok(Json(
        repo::zeitfenster_laden(&state.pool, einsatz_id, g.id).await?,
    ))
}

/// DELETE /api/einsaetze/{id}/verpflegung/zeitfenster/{zid} — 422, solange eine gültige
/// Ausgabe daran hängt.
pub async fn zeitfenster_loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = repo::zeitzone(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::zeitfenster_loeschen_tx(conn, einsatz_id, zid, benutzer_id, startwert, tz).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids);
    Ok(StatusCode::NO_CONTENT)
}

// ── Ausgaben ────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AusgabeErfassen {
    /// Fehlt/leer = jetzt.
    #[serde(default)]
    zeitpunkt_at: Option<String>,
    /// Pflicht, > 0.
    menge: i64,
    #[serde(default)]
    ort: Option<String>,
    /// Fehlt, oder fehlende Kostform = 0.
    #[serde(default)]
    sonderkost: Option<SonderkostEingabe>,
    /// Nachforderung desselben Einsatzes, sonst 404.
    #[serde(default)]
    nachforderung_id: Option<i64>,
    #[serde(default)]
    bemerkung: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue (LFH-688): leer = fehlend, > 64 Zeichen = 400.
    #[serde(default)]
    client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/verpflegung/zeitfenster/{zid}/ausgaben — ohne ETB-Eintrag.
///
/// Idempotent über `client_id` (LFH-688, design.md D2): Reihenfolge wie `routes/meldung.rs`
/// — Gates im Extractor (Org, Schreibrecht, Modul), Queue-Besitzer, Replay-Lookup, ERST DANN
/// `fordere_aktiv`. Ein gespeicherter Replay kommt so auch nach dem Einsatzende zurück; ein
/// Replay publiziert nichts (D5).
pub async fn ausgabe_erfassen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Verpflegung>,
    headers: HeaderMap,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<AusgabeErfassen>,
) -> Result<(StatusCode, Json<AusgabeErgebnis>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = req
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    if client_id.as_ref().is_some_and(|cid| cid.len() > 64) {
        return Err(AppError::Validation(
            "client_id zu lang (max. 64 Zeichen)".into(),
        ));
    }
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = repo::laden_nach_client_id(&state.pool, einsatz_id, cid).await? {
            let a = repo::replay_am_zeitfenster(replay, zid)?;
            return antwort(&state, einsatz_id, a).await;
        }
    }
    ctx.fordere_aktiv()?;
    let zeitpunkt_at = match req.zeitpunkt_at.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => zeit(s)?,
        _ => crate::zeit::jetzt(),
    };
    // Die Nachforderung muss zu DIESEM Einsatz gehören; der FK sichert nur, dass es sie gibt.
    // Vor der Transaktion: die Prüfung nimmt den Pool, und Nachforderungen werden nicht
    // gelöscht oder umgehängt.
    if let Some(nid) = req.nachforderung_id {
        if !crate::nachforderung::repo::gehoert_zu_einsatz(&state.pool, nid, einsatz_id).await? {
            return Err(AppError::NotFound);
        }
    }
    let eingabe = AusgabeEingabe {
        zeitpunkt_at,
        menge: req.menge,
        ort: req.ort,
        bemerkung: req.bemerkung,
        sonderkost: req.sonderkost.unwrap_or_default(),
        nachforderung_id: req.nachforderung_id,
        client_id,
    };
    let benutzer_id = ctx.benutzer.id;
    let a = crate::write_retry!(&state.pool, |conn| {
        repo::ausgabe_erfassen_tx(conn, einsatz_id, zid, benutzer_id, &eingabe).await
    })?;
    antwort(&state, einsatz_id, a).await
}

/// 201 mit Ausgabe und Zeitfenster danach; das Modul-Ereignis nur, wenn wirklich geschrieben
/// wurde (ein Replay publiziert nichts, design.md D5).
async fn antwort(
    state: &AppState,
    einsatz_id: i64,
    a: repo::AusgabeGeschrieben,
) -> Result<(StatusCode, Json<AusgabeErgebnis>), AppError> {
    if a.neu {
        publiziere(state, einsatz_id, &[]);
    }
    Ok((
        StatusCode::CREATED,
        Json(AusgabeErgebnis {
            ausgabe_id: a.ausgabe_id,
            zeitfenster: repo::zeitfenster_laden(&state.pool, einsatz_id, a.zeitfenster_id).await?,
        }),
    ))
}

/// POST /api/einsaetze/{id}/verpflegung/ausgaben/{aid}/zuruecknehmen — endgültig, ohne
/// ETB-Eintrag; 422 beim zweiten Mal.
pub async fn ausgabe_zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
) -> Result<Json<AusgabeErgebnis>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let benutzer_id = ctx.benutzer.id;
    let a = crate::write_retry!(&state.pool, |conn| {
        repo::ausgabe_zuruecknehmen_tx(conn, einsatz_id, aid, benutzer_id).await
    })?;
    publiziere(&state, einsatz_id, &[]);
    Ok(Json(AusgabeErgebnis {
        ausgabe_id: a.ausgabe_id,
        zeitfenster: repo::zeitfenster_laden(&state.pool, einsatz_id, a.zeitfenster_id).await?,
    }))
}
