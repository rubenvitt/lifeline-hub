//! Routen des Moduls Evakuierung (LLH-1034, Fachlogik LFH-639): Evakuierungsbezirke mit
//! Standmeldungen. Bis LLH-1034 lagen sie unter `…/betreuung/bezirke…` im Modul Betreuung; sie
//! sind umgezogen, nicht doppelt geführt. Tabellen und Repo teilen sie weiter mit den
//! Betreuungsstellen (`crate::betreuung`).
//!
//! Gates strukturell über `EinsatzLesezugriff<Evakuierung>` bzw.
//! `EinsatzSchreibzugriff<Evakuierung>`. Die Melde-Route nimmt `EinsatzSchreibfreigabe` und
//! prüft den aktiven Einsatz selbst, NACH dem Replay-Lookup ihrer `client_id` (LFH-675,
//! design.md D2): eine offline erfasste und schon gespeicherte Meldung kommt auch nach
//! Einsatzende zurück, solange der Einsatz lesbar ist (Lese-Gate im Extractor, LFH-769). Eine vor
//! dem Umzug vorgemerkte Meldung trägt keinen Pfad, der Client baut ihn beim Senden neu.
//! Bodies nur über `JsonBody`, Sub-IDs nur über `PfadParam`.
//!
//! **Statuscodes** wie im Modul Betreuung (`routes/betreuung.rs`, src/AGENTS.md
//! „Statuscode-Konvention“): 400 Feld, 404 fremd/unbekannt, 409 Lebenszyklus (storniert) und
//! doppelte Bezeichnung, 422 Rücknahme einer zurückgenommenen Meldung, `client_id` eines
//! anderen Bezirks und eine halbe oder unmögliche Koordinate der Sammelstelle (LLH-1121).
//!
//! **Live** nach dem Commit: jeder ETB-Eintrag als ETB-Kurzruf, danach `LiveEvent::Evakuierung`
//! mit Kennungen only (`{einsatz_id, bezirk_id}`). Ein PATCH ohne wirksame Änderung publiziert
//! nichts.
//!
//! **Lagekennzahl** (LFH-855): Anlegen, Ändern und Stornieren eines Bezirks lesen die
//! Lagekennzahlen des Einsatzes vor und nach dem Repo-Aufruf in derselben Transaktion. Schaltet
//! `evakuiert` um, meldet die Route nach dem Commit zusätzlich den Einsatzkopf (`einsatz`,
//! [`kopf_bei_umschalten`]). Standmeldungen schalten ihn nie.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::Utc;
use serde::Deserialize;

use crate::app::AppState;
use crate::betreuung::repo::{self, BezirkAenderung, BezirkEingabe, StandEingabe};
use crate::betreuung::{
    enum_wert, BezirkMeldungAnzeige, EvakuierungUebersicht, EvakuierungsbezirkAnzeige,
    StandVerlaufEintrag,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibfreigabe, EinsatzSchreibzugriff};
use crate::einsatz::lagekennzahl;
use crate::einsatz::modul::Evakuierung;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::routes::support;

/// Nach dem Commit: ETB-Kurzruf je Eintrag, dann das Modul-Ereignis mit Kennungen only.
pub(super) fn publiziere(state: &AppState, einsatz_id: i64, etb_ids: &[i64], bezirk_id: i64) {
    for etb_id in etb_ids {
        state.live.publiziere(einsatz_id, *etb_id);
    }
    let nutzlast = serde_json::json!({ "einsatz_id": einsatz_id, "bezirk_id": bezirk_id });
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Evakuierung, nutzlast.to_string());
}

/// Wie [`publiziere`], aber nur nach einer wirksamen Änderung (Leerlauf-Riegel: ein PATCH
/// ohne neuen Wert schreibt keinen ETB-Eintrag und soll auch niemanden neu laden lassen).
fn publiziere_wirksam(state: &AppState, einsatz_id: i64, g: &repo::Geschrieben) {
    if !g.etb_ids.is_empty() || g.still_geaendert {
        publiziere(state, einsatz_id, &g.etb_ids, g.id);
    }
}

/// Nach dem Commit: den Einsatzkopf melden, wenn die Bezirksänderung eine Lagekennzahl
/// umgeschaltet hat (LFH-855). Der Kopf zeigt `lagekennzahlen` jedem Leser, auch ohne Modul
/// Evakuierung — das ungegatete `einsatz` verrät also nichts darüber hinaus, und eine Änderung
/// ohne Umschalten bleibt für ihn unsichtbar.
async fn kopf_bei_umschalten(state: &AppState, einsatz_id: i64, umgeschaltet: bool) {
    if umgeschaltet {
        crate::routes::einsatz::kopf_geaendert(state, einsatz_id).await;
    }
}

fn enum_opt<T: TryFrom<String, Error = String>>(s: Option<String>) -> Result<Option<T>, AppError> {
    s.as_deref().map(enum_wert).transpose()
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/evakuierung — nicht stornierte Bezirke mit aktueller Meldung. Die eine
/// Quelle für Modulseite, Modulzähler und Kennzahl „Evakuiert“. Gekoppelte Geräte erreichen die
/// Route nie (keine Funktionsansicht führt sie, `geraet::Funktionsansicht::routen`).
pub async fn uebersicht(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Evakuierung>,
) -> Result<Json<EvakuierungUebersicht>, AppError> {
    Ok(Json(EvakuierungUebersicht {
        bezirke: repo::bezirke(&state.pool, ctx.einsatz.id).await?,
    }))
}

/// GET /api/einsaetze/{id}/evakuierung/bezirke/{bid}/staende — die ganze Standreihe des
/// Bezirks samt zurückgenommener Meldungen (LFH-676). Auch ein stornierter Bezirk liefert sie:
/// 409 steht in diesem Modul für Lebenszyklus-AKTIONEN, Lesen ist keine. Fremd/unbekannt → 404.
pub async fn stand_verlauf(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Evakuierung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<StandVerlaufEintrag>>, AppError> {
    Ok(Json(
        repo::stand_verlauf(&state.pool, ctx.einsatz.id, bid).await?,
    ))
}

// ── Bezirke ─────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct BezirkAnlegen {
    bezeichnung: String,
    #[serde(default)]
    abschnitt_id: Option<i64>,
    /// Pflicht: fehlt es, scheitert der Body am Extractor (400).
    plan_personen: i64,
    /// `gezaehlt` | `geschaetzt`. Als `String`, damit ein unbekannter Wert eine benannte 400
    /// liefert.
    plan_erhebung: String,
    #[serde(default)]
    sammelstelle: Option<String>,
    /// Koordinate der Sammelstelle (LLH-1121), aus dem Ortsfeld. Halbes Paar oder Wert außerhalb
    /// des Bereichs → **422**, wie bei der Koordinate einer Betreuungsstelle (LFH-673): das Paar
    /// ist ein Zusammenhang zweier Felder.
    #[serde(default)]
    sammelstelle_lat: Option<f64>,
    #[serde(default)]
    sammelstelle_lon: Option<f64>,
    #[serde(default)]
    notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/evakuierung/bezirke
pub async fn bezirk_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Evakuierung>,
    JsonBody(req): JsonBody<BezirkAnlegen>,
) -> Result<(StatusCode, Json<EvakuierungsbezirkAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = BezirkEingabe {
        bezeichnung: req.bezeichnung,
        abschnitt_id: req.abschnitt_id,
        plan_personen: req.plan_personen,
        plan_erhebung: enum_wert(&req.plan_erhebung)?,
        sammelstelle: req.sammelstelle,
        sammelstelle_lat: req.sammelstelle_lat,
        sammelstelle_lon: req.sammelstelle_lon,
        notiz: req.notiz,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let (g, umgeschaltet) = crate::write_retry!(&state.pool, |conn| {
        let vorher = lagekennzahl::lesen(conn, einsatz_id).await?;
        let g = repo::bezirk_anlegen_tx(conn, einsatz_id, benutzer_id, startwert, &eingabe).await?;
        Ok((g, lagekennzahl::lesen(conn, einsatz_id).await? != vorher))
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, g.id);
    kopf_bei_umschalten(&state, einsatz_id, umgeschaltet).await;
    Ok((
        StatusCode::CREATED,
        Json(repo::bezirk_laden(&state.pool, einsatz_id, g.id).await?),
    ))
}

#[derive(Debug, Deserialize)]
pub struct BezirkAendern {
    #[serde(default)]
    bezeichnung: Option<String>,
    /// Tri-State: fehlt = unverändert, `null` = Abschnitt lösen.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    abschnitt_id: Option<Option<i64>>,
    #[serde(default)]
    plan_personen: Option<i64>,
    #[serde(default)]
    plan_erhebung: Option<String>,
    #[serde(default)]
    raeumung: Option<String>,
    /// Tri-State: fehlt = unverändert, `null` = leeren.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    sammelstelle: Option<Option<String>>,
    /// Tri-State je Wert (LLH-1121): fehlt = unverändert, `null` = entfernen; gegen den Bestand
    /// als Paar geprüft (422).
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    sammelstelle_lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    sammelstelle_lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    notiz: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/evakuierung/bezirke/{bid}
pub async fn bezirk_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Evakuierung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<BezirkAendern>,
) -> Result<Json<EvakuierungsbezirkAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = BezirkAenderung {
        bezeichnung: req.bezeichnung,
        abschnitt_id: req.abschnitt_id,
        plan_personen: req.plan_personen,
        plan_erhebung: enum_opt(req.plan_erhebung)?,
        raeumung: enum_opt(req.raeumung)?,
        sammelstelle: req.sammelstelle,
        sammelstelle_lat: req.sammelstelle_lat,
        sammelstelle_lon: req.sammelstelle_lon,
        notiz: req.notiz,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let (g, umgeschaltet) = crate::write_retry!(&state.pool, |conn| {
        let vorher = lagekennzahl::lesen(conn, einsatz_id).await?;
        let g = repo::bezirk_aendern_tx(conn, einsatz_id, bid, benutzer_id, startwert, &eingabe)
            .await?;
        Ok((g, lagekennzahl::lesen(conn, einsatz_id).await? != vorher))
    })?;
    publiziere_wirksam(&state, einsatz_id, &g);
    kopf_bei_umschalten(&state, einsatz_id, umgeschaltet).await;
    Ok(Json(
        repo::bezirk_laden(&state.pool, einsatz_id, g.id).await?,
    ))
}

/// POST /api/einsaetze/{id}/evakuierung/bezirke/{bid}/stornieren — Fehlanlage; liefert den
/// Bezirk mit gesetztem `storniert_at`.
pub async fn bezirk_stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Evakuierung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<EvakuierungsbezirkAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let ((g, geloeste_zonen), umgeschaltet) = crate::write_retry!(&state.pool, |conn| {
        let vorher = lagekennzahl::lesen(conn, einsatz_id).await?;
        let r = repo::bezirk_stornieren_tx(conn, einsatz_id, bid, benutzer_id, startwert).await?;
        Ok((r, lagekennzahl::lesen(conn, einsatz_id).await? != vorher))
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, g.id);
    kopf_bei_umschalten(&state, einsatz_id, umgeschaltet).await;
    // LFH-673: die Karte zeichnet die gelösten Flächen jetzt ohne Bezirk.
    for zid in geloeste_zonen {
        super::lage_zone::sse_zone(&state, einsatz_id, zid);
    }
    Ok(Json(
        repo::bezirk_laden(&state.pool, einsatz_id, g.id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct StandMelden {
    evakuiert: i64,
    /// `gezaehlt` | `geschaetzt`.
    erhebung: String,
    /// Fehlt = jetzt. Eine offline vorgemerkte Meldung trägt hier ihren Erfassungszeitpunkt
    /// (design.md D6), sonst stempelte der Flush die Sendezeit.
    #[serde(default)]
    zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue (LFH-675).
    #[serde(default)]
    client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/evakuierung/bezirke/{bid}/staende
///
/// Mit `client_id` idempotent (LFH-675): ein Replay liefert die gespeicherte Meldung (201),
/// ohne Zeile, ETB-Eintrag oder Live-Ereignis — auch am inzwischen stornierten Bezirk und nach
/// Einsatzende. Ein Schlüssel, der an einem anderen Bezirk hängt, ist 422.
pub async fn stand_melden(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Evakuierung>,
    headers: HeaderMap,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<StandMelden>,
) -> Result<(StatusCode, Json<BezirkMeldungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = support::parse_client_id(req.client_id.as_deref())?;
    // Vorab-Lookup nach den Gates, vor der Aktiv-Prüfung und der Validierung: der Replay
    // bewertet den Body nicht, maßgeblich ist allein der Schlüssel (Muster `routes/meldung.rs`).
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = repo::stand_nach_client_id(&state.pool, einsatz_id, cid).await? {
            let m = repo::replay_am_objekt(replay, bid, "einem anderen Evakuierungsbezirk")?;
            return Ok((
                StatusCode::CREATED,
                Json(bezirk_meldung(&state, einsatz_id, m).await?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let eingabe = StandEingabe {
        evakuiert: req.evakuiert,
        erhebung: enum_wert(&req.erhebung)?,
        zeitpunkt_at: support::meldezeitpunkt(req.zeitpunkt_at.as_deref(), Utc::now())?,
        client_id,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    // Die Transaktion sucht den Schlüssel noch einmal: zwei Flushes, die beide am Vorab-Lookup
    // vorbeikamen, entscheidet `BEGIN IMMEDIATE` — der zweite ist dann ein Replay (`neu: false`).
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::stand_melden_tx(conn, einsatz_id, bid, benutzer_id, startwert, &eingabe).await
    })?;
    if m.neu {
        publiziere(&state, einsatz_id, &[m.etb_id], m.objekt_id);
    }
    Ok((
        StatusCode::CREATED,
        Json(bezirk_meldung(&state, einsatz_id, m).await?),
    ))
}

async fn bezirk_meldung(
    state: &AppState,
    einsatz_id: i64,
    m: repo::Gemeldet,
) -> Result<BezirkMeldungAnzeige, AppError> {
    Ok(BezirkMeldungAnzeige {
        meldung_id: m.meldung_id,
        bezirk: repo::bezirk_laden(&state.pool, einsatz_id, m.objekt_id).await?,
    })
}

/// POST /api/einsaetze/{id}/evakuierung/staende/{sid}/zuruecknehmen
pub async fn stand_zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Evakuierung>,
    PfadParam((_eid, stand_id)): PfadParam<(i64, i64)>,
) -> Result<Json<BezirkMeldungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::stand_zuruecknehmen_tx(conn, einsatz_id, stand_id, benutzer_id, startwert).await
    })?;
    publiziere(&state, einsatz_id, &[m.etb_id], m.objekt_id);
    Ok(Json(BezirkMeldungAnzeige {
        meldung_id: m.meldung_id,
        bezirk: repo::bezirk_laden(&state.pool, einsatz_id, m.objekt_id).await?,
    }))
}
