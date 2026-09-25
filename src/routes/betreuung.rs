//! Routen des Fachmoduls Betreuung (LFH-639): Evakuierungsbezirke mit Standmeldungen,
//! Betreuungsstellen mit Belegungsmeldungen und die Kopfzahl „in Betreuung“.
//!
//! Gates strukturell über `EinsatzLesezugriff<Betreuung>` (alle Einsatzmitglieder inkl.
//! Beobachter) bzw. `EinsatzSchreibzugriff<Betreuung>` (Schreibrecht, aktiver Einsatz, Modul).
//! Die zwei Melde-Routen nehmen `EinsatzSchreibfreigabe<Betreuung>` und prüfen den aktiven
//! Einsatz selbst, NACH dem Replay-Lookup ihrer `client_id` (LFH-675, design.md D2): eine
//! offline erfasste und schon gespeicherte Meldung kommt auch nach Einsatzende zurück.
//! Bodies nur über `JsonBody`, Sub-IDs nur über `PfadParam`.
//!
//! **Statuscodes** nach der Konvention in `src/error.rs` (CLAUDE.md „Statuscode-Konvention“,
//! design.md D3):
//! - **400** — das Feld für sich: fehlendes Pflichtfeld, unbekannter Enum-Wert, leere
//!   Bezeichnung, Plangröße/Kapazität < 1, Anzahl < 0, Zeitpunkt unlesbar oder mehr als
//!   [`ZUKUNFT_TOLERANZ_SEKUNDEN`] in der Zukunft, `client_id` länger als 64 Zeichen.
//! - **404** — fremdes oder unbekanntes Objekt, Abschnitt eines anderen Einsatzes.
//! - **409** — nur der Lebenszyklus (storniert) und die doppelte Bezeichnung. Es gibt KEIN
//!   CAS und damit keinen Überschreiben-Dialog: die zweite 409-Quelle aus LFH-299/300 kann
//!   hier nicht entstehen.
//! - **422** — ein umkehrbarer Zustand verbietet die Aktion: belegte Stelle schließen,
//!   geschlossene Stelle belegen, Belegungsmeldung an geschlossener Stelle zurücknehmen,
//!   bereits zurückgenommene Meldung erneut zurücknehmen, `client_id` einer Meldung an einem
//!   anderen Bezirk bzw. einer anderen Stelle (LFH-675).
//!
//! Die fachlichen Prüfungen liegen im Repo; die Route liest JSON, Enums und Zeitpunkte und
//! öffnet die Transaktion. Zeiten werden hier normalisiert (`etb::normalisiere_zeit`), nie im
//! Repo — dieselbe Arbeitsteilung wie in `routes/abloesung.rs`.
//!
//! **Live** nach dem Commit (design.md D5): jeder ETB-Eintrag als ETB-Kurzruf, danach
//! `LiveEvent::Betreuung` mit Kennungen only (`{einsatz_id, bezirk_id}` bzw.
//! `{einsatz_id, stelle_id}`) — keine Anzahlen, Bezeichnungen oder Freitexte. Ein PATCH ohne
//! wirksame Änderung (Leerlauf-Riegel im Repo, leere `etb_ids`) publiziert nichts.

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Deserialize;

use crate::app::AppState;
use crate::betreuung::repo::{
    self, BelegungEingabe, BezirkAenderung, BezirkEingabe, StandEingabe, StelleAenderung,
    StelleEingabe,
};
use crate::betreuung::{
    enum_wert, BelegungKopfzahl, BelegungVerlaufEintrag, BetreuungUebersicht,
    BetreuungsstelleAnzeige, BezirkMeldungAnzeige, EvakuierungsbezirkAnzeige, StandVerlaufEintrag,
    StelleMeldungAnzeige, StelleNamentlich,
};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibfreigabe, EinsatzSchreibzugriff};
use crate::einsatz::modul::Betreuung;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::routes::support;

/// Toleranz für Uhrenversatz zwischen Erfassungsgerät und Server (design.md D2). Ein
/// Zeitpunkt, der weiter in der Zukunft liegt, ist für sich unbrauchbar → 400.
pub const ZUKUNFT_TOLERANZ_SEKUNDEN: i64 = 60;

const DRAHT: &str = "%Y-%m-%d %H:%M:%S";

fn draht(t: DateTime<Utc>) -> String {
    t.format(DRAHT).to_string()
}

/// Meldezeitpunkt: fehlt/leer → `jetzt`, sonst normalisiert (400 bei Unlesbarem) und höchstens
/// [`ZUKUNFT_TOLERANZ_SEKUNDEN`] nach `jetzt` (sonst 400). Gespeichert wird `min(zeitpunkt,
/// jetzt)` (LFH-680, design.md D2): die Toleranz fängt Uhrenversatz ab, übernimmt ihn aber
/// nicht — sonst wäre eine Meldung sofort „aktuell“ und fehlte bis zu 60 s in der Kopfzahl
/// „jetzt“. `jetzt` ist injiziert, damit die Grenze ohne Uhr prüfbar ist.
fn meldezeitpunkt(eingabe: Option<&str>, jetzt: DateTime<Utc>) -> Result<String, AppError> {
    let zeit = match eingabe.map(str::trim) {
        Some(s) if !s.is_empty() => crate::etb::normalisiere_zeit(s)?,
        _ => return Ok(draht(jetzt)),
    };
    let t = NaiveDateTime::parse_from_str(&zeit, DRAHT)
        .map_err(|_| AppError::Validation(format!("Ungültiger Zeitpunkt '{zeit}'")))?
        .and_utc();
    if (t - jetzt).num_seconds() > ZUKUNFT_TOLERANZ_SEKUNDEN {
        return Err(AppError::Validation(format!(
            "Zeitpunkt {zeit} liegt in der Zukunft (Toleranz {ZUKUNFT_TOLERANZ_SEKUNDEN} s)"
        )));
    }
    Ok(draht(t.min(jetzt)))
}

/// Worauf ein Live-Ereignis zeigt. Nur die Kennung geht auf den Draht.
#[derive(Clone, Copy)]
enum Objekt {
    Bezirk(i64),
    Stelle(i64),
}

/// Nach dem Commit: ETB-Kurzruf je Eintrag, dann das Modul-Ereignis mit Kennungen only.
fn publiziere(state: &AppState, einsatz_id: i64, etb_ids: &[i64], objekt: Objekt) {
    for etb_id in etb_ids {
        state.live.publiziere(einsatz_id, *etb_id);
    }
    let nutzlast = match objekt {
        Objekt::Bezirk(id) => serde_json::json!({ "einsatz_id": einsatz_id, "bezirk_id": id }),
        Objekt::Stelle(id) => serde_json::json!({ "einsatz_id": einsatz_id, "stelle_id": id }),
    };
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Betreuung, nutzlast.to_string());
}

/// Wie [`publiziere`], aber nur nach einer wirksamen Änderung (Leerlauf-Riegel: ein PATCH
/// ohne neuen Wert schreibt keinen ETB-Eintrag und soll auch niemanden neu laden lassen).
/// Wirksam ist auch eine Änderung ohne ETB-Eintrag — die Verortung einer Stelle
/// (`still_geaendert`, LFH-673 design.md D3).
fn publiziere_wirksam(state: &AppState, einsatz_id: i64, g: &repo::Geschrieben, objekt: Objekt) {
    if !g.etb_ids.is_empty() || g.still_geaendert {
        publiziere(state, einsatz_id, &g.etb_ids, objekt);
    }
}

async fn startwert(state: &AppState, einsatz_id: i64) -> Result<i64, AppError> {
    Ok(
        crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
            .await?
            .etb_startwert(),
    )
}

fn enum_opt<T: TryFrom<String, Error = String>>(s: Option<String>) -> Result<Option<T>, AppError> {
    s.as_deref().map(enum_wert).transpose()
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/betreuung — nicht stornierte Bezirke und Stellen mit aktueller
/// Meldung. Die eine Quelle für Modulseite, Modulzähler und Kennzahl.
///
/// LFH-674 (design.md D4): „davon namentlich“ je Stelle steht nur für Lesende, die zusätzlich
/// das Modul Personen sehen dürfen — dieselbe Rangfolge-Auswertung wie der Modulzähler, nur
/// für einen Key. Ohne dieses Recht fehlt das Feld, statt 0 zu behaupten. Die Zahl wird hier
/// gerechnet und nicht in `repo::uebersicht`, weil deren zweiter Konsument der gesicherte
/// Lagestand ist.
pub async fn uebersicht(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Betreuung>,
) -> Result<Json<BetreuungUebersicht>, AppError> {
    let mut uebersicht = repo::uebersicht(&state.pool, ctx.einsatz.id).await?;
    // Ein 403 heißt „keine Auskunft“; jeder andere Fehler (DB) bleibt ein Fehler, statt still
    // als fehlendes Recht durchzugehen.
    let personen_erlaubt = match ctx.fordere_modul_zugriff(&state.pool, "personen").await {
        Ok(()) => true,
        Err(AppError::Forbidden) => false,
        Err(e) => return Err(e),
    };
    if personen_erlaubt {
        uebersicht.namentlich = Some(
            crate::person::repo::namentlich_je_stelle(&state.pool, ctx.einsatz.id)
                .await?
                .into_iter()
                .map(|(stelle_id, anzahl)| StelleNamentlich { stelle_id, anzahl })
                .collect(),
        );
    }
    Ok(Json(uebersicht))
}

#[derive(Debug, Deserialize)]
pub struct KopfzahlParams {
    /// Stichtag; fehlt = jetzt. ISO mit Zone oder `YYYY-MM-DD HH:MM:SS` (UTC).
    #[serde(default)]
    zeitpunkt: Option<String>,
}

/// GET /api/einsaetze/{id}/betreuung/belegung?zeitpunkt= — Kopfzahl „in Betreuung“ zum
/// Stichtag (LFH-634). Ein Stichtag in der Zukunft ist erlaubt: er liefert den heutigen Stand.
pub async fn kopfzahl(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Betreuung>,
    Query(params): Query<KopfzahlParams>,
) -> Result<Json<BelegungKopfzahl>, AppError> {
    let stichtag = match params.zeitpunkt.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => crate::etb::normalisiere_zeit(s)?,
        _ => draht(Utc::now()),
    };
    Ok(Json(
        repo::kopfzahl(&state.pool, ctx.einsatz.id, &stichtag).await?,
    ))
}

/// GET /api/einsaetze/{id}/betreuung/bezirke/{bid}/staende — die ganze Standreihe des
/// Bezirks samt zurückgenommener Meldungen (LFH-676). Auch ein stornierter Bezirk liefert sie:
/// 409 steht in diesem Modul für Lebenszyklus-AKTIONEN, Lesen ist keine. Fremd/unbekannt → 404.
pub async fn stand_verlauf(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Betreuung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<StandVerlaufEintrag>>, AppError> {
    Ok(Json(
        repo::stand_verlauf(&state.pool, ctx.einsatz.id, bid).await?,
    ))
}

/// GET /api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen — die ganze Belegungsreihe der
/// Stelle (LFH-676), wie [`stand_verlauf`]; auch an einer geschlossenen Stelle.
pub async fn belegung_verlauf(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Betreuung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<BelegungVerlaufEintrag>>, AppError> {
    Ok(Json(
        repo::belegung_verlauf(&state.pool, ctx.einsatz.id, sid).await?,
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
    #[serde(default)]
    notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/betreuung/bezirke
pub async fn bezirk_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    JsonBody(req): JsonBody<BezirkAnlegen>,
) -> Result<(StatusCode, Json<EvakuierungsbezirkAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = BezirkEingabe {
        bezeichnung: req.bezeichnung,
        abschnitt_id: req.abschnitt_id,
        plan_personen: req.plan_personen,
        plan_erhebung: enum_wert(&req.plan_erhebung)?,
        sammelstelle: req.sammelstelle,
        notiz: req.notiz,
    };
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::bezirk_anlegen_tx(conn, einsatz_id, benutzer_id, startwert, &eingabe).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, Objekt::Bezirk(g.id));
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
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    notiz: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/betreuung/bezirke/{bid}
pub async fn bezirk_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
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
        notiz: req.notiz,
    };
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::bezirk_aendern_tx(conn, einsatz_id, bid, benutzer_id, startwert, &eingabe).await
    })?;
    publiziere_wirksam(&state, einsatz_id, &g, Objekt::Bezirk(g.id));
    Ok(Json(
        repo::bezirk_laden(&state.pool, einsatz_id, g.id).await?,
    ))
}

/// POST /api/einsaetze/{id}/betreuung/bezirke/{bid}/stornieren — Fehlanlage; liefert den
/// Bezirk mit gesetztem `storniert_at`.
pub async fn bezirk_stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<EvakuierungsbezirkAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let (g, geloeste_zonen) = crate::write_retry!(&state.pool, |conn| {
        repo::bezirk_stornieren_tx(conn, einsatz_id, bid, benutzer_id, startwert).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, Objekt::Bezirk(g.id));
    // LFH-673: die Karte zeichnet die gelösten Flächen jetzt ohne Bezirk.
    for zid in geloeste_zonen {
        super::lage_zone::sse_zone(&state, einsatz_id, zid);
    }
    Ok(Json(
        repo::bezirk_laden(&state.pool, einsatz_id, g.id).await?,
    ))
}

/// Höchstlänge einer `client_id` — wie bei Meldung und Person (`routes/meldung.rs`).
const CLIENT_ID_MAX: usize = 64;

/// Idempotenzschlüssel der Offline-Queue (LFH-675): getrimmt, leer heißt fehlend, zu lang ist
/// für sich unbrauchbar → 400.
fn client_id(roh: Option<&str>) -> Result<Option<String>, AppError> {
    match roh.map(str::trim).filter(|s| !s.is_empty()) {
        Some(cid) if cid.len() > CLIENT_ID_MAX => Err(AppError::Validation(format!(
            "client_id zu lang (max. {CLIENT_ID_MAX} Zeichen)"
        ))),
        cid => Ok(cid.map(str::to_owned)),
    }
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

/// POST /api/einsaetze/{id}/betreuung/bezirke/{bid}/staende
///
/// Mit `client_id` idempotent (LFH-675): ein Replay liefert die gespeicherte Meldung (201),
/// ohne Zeile, ETB-Eintrag oder Live-Ereignis — auch am inzwischen stornierten Bezirk und nach
/// Einsatzende. Ein Schlüssel, der an einem anderen Bezirk hängt, ist 422.
pub async fn stand_melden(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Betreuung>,
    headers: HeaderMap,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<StandMelden>,
) -> Result<(StatusCode, Json<BezirkMeldungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = client_id(req.client_id.as_deref())?;
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
        zeitpunkt_at: meldezeitpunkt(req.zeitpunkt_at.as_deref(), Utc::now())?,
        client_id,
    };
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    // Die Transaktion sucht den Schlüssel noch einmal: zwei Flushes, die beide am Vorab-Lookup
    // vorbeikamen, entscheidet `BEGIN IMMEDIATE` — der zweite ist dann ein Replay (`neu: false`).
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::stand_melden_tx(conn, einsatz_id, bid, benutzer_id, startwert, &eingabe).await
    })?;
    if m.neu {
        publiziere(&state, einsatz_id, &[m.etb_id], Objekt::Bezirk(m.objekt_id));
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

async fn stelle_meldung(
    state: &AppState,
    einsatz_id: i64,
    m: repo::Gemeldet,
) -> Result<StelleMeldungAnzeige, AppError> {
    Ok(StelleMeldungAnzeige {
        meldung_id: m.meldung_id,
        stelle: repo::stelle_laden(&state.pool, einsatz_id, m.objekt_id).await?,
    })
}

/// POST /api/einsaetze/{id}/betreuung/staende/{sid}/zuruecknehmen
pub async fn stand_zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    PfadParam((_eid, stand_id)): PfadParam<(i64, i64)>,
) -> Result<Json<BezirkMeldungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::stand_zuruecknehmen_tx(conn, einsatz_id, stand_id, benutzer_id, startwert).await
    })?;
    publiziere(&state, einsatz_id, &[m.etb_id], Objekt::Bezirk(m.objekt_id));
    Ok(Json(BezirkMeldungAnzeige {
        meldung_id: m.meldung_id,
        bezirk: repo::bezirk_laden(&state.pool, einsatz_id, m.objekt_id).await?,
    }))
}

// ── Stellen ─────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StelleAnlegen {
    bezeichnung: String,
    /// `anlaufstelle` | `betreuungsstelle` | `betreuungsplatz` | `notunterkunft`.
    art: String,
    #[serde(default)]
    abschnitt_id: Option<i64>,
    #[serde(default)]
    kapazitaet_personen: Option<i64>,
    #[serde(default)]
    standort: Option<String>,
    #[serde(default)]
    notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/betreuung/stellen
pub async fn stelle_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    JsonBody(req): JsonBody<StelleAnlegen>,
) -> Result<(StatusCode, Json<BetreuungsstelleAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = StelleEingabe {
        bezeichnung: req.bezeichnung,
        art: enum_wert(&req.art)?,
        abschnitt_id: req.abschnitt_id,
        kapazitaet_personen: req.kapazitaet_personen,
        standort: req.standort,
        notiz: req.notiz,
    };
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::stelle_anlegen_tx(conn, einsatz_id, benutzer_id, startwert, &eingabe).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, Objekt::Stelle(g.id));
    Ok((
        StatusCode::CREATED,
        Json(repo::stelle_laden(&state.pool, einsatz_id, g.id).await?),
    ))
}

#[derive(Debug, Deserialize)]
pub struct StelleAendern {
    #[serde(default)]
    bezeichnung: Option<String>,
    #[serde(default)]
    art: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    abschnitt_id: Option<Option<i64>>,
    /// Tri-State: fehlt = unverändert, `null` = keine Kapazität mehr.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    kapazitaet_personen: Option<Option<i64>>,
    /// `vorbereitet` | `in_betrieb` | `geschlossen`.
    #[serde(default)]
    status: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    standort: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    notiz: Option<Option<String>>,
    /// Koordinate auf der Lagekarte (LFH-673), tri-state je Wert: fehlt = unverändert,
    /// `null` = entfernen. Halbes Paar oder Wert außerhalb des Bereichs → **422**, wie an der
    /// UHS (`einsatz_uhs.rs`, von CLAUDE.md als legitimes 422 geführt): das Paar ist ein
    /// Zusammenhang zweier Felder. Bewusste Abweichung von der 400-Linie für Feldfehler
    /// dieses Moduls (LFH-639 D3), damit alle Verortungswege gleich antworten.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    lon: Option<Option<f64>>,
}

/// PATCH /api/einsaetze/{id}/betreuung/stellen/{sid}
pub async fn stelle_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<StelleAendern>,
) -> Result<Json<BetreuungsstelleAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = StelleAenderung {
        bezeichnung: req.bezeichnung,
        art: enum_opt(req.art)?,
        abschnitt_id: req.abschnitt_id,
        kapazitaet_personen: req.kapazitaet_personen,
        status: enum_opt(req.status)?,
        standort: req.standort,
        notiz: req.notiz,
        lat: req.lat,
        lon: req.lon,
    };
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::stelle_aendern_tx(conn, einsatz_id, sid, benutzer_id, startwert, &eingabe).await
    })?;
    publiziere_wirksam(&state, einsatz_id, &g, Objekt::Stelle(g.id));
    Ok(Json(
        repo::stelle_laden(&state.pool, einsatz_id, g.id).await?,
    ))
}

/// POST /api/einsaetze/{id}/betreuung/stellen/{sid}/stornieren
pub async fn stelle_stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
) -> Result<Json<BetreuungsstelleAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::stelle_stornieren_tx(conn, einsatz_id, sid, benutzer_id, startwert).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, Objekt::Stelle(g.id));
    Ok(Json(
        repo::stelle_laden(&state.pool, einsatz_id, g.id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct BelegungMelden {
    belegt: i64,
    /// Fehlt = jetzt; offline vorgemerkt: der Erfassungszeitpunkt (wie [`StandMelden`]).
    #[serde(default)]
    zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue (LFH-675).
    #[serde(default)]
    client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen
///
/// Idempotent wie [`stand_melden`]: ein Replay kommt auch an der inzwischen geschlossenen
/// Stelle zurück; eine NEUE Meldung dort bleibt 422.
pub async fn belegung_melden(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Betreuung>,
    headers: HeaderMap,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<BelegungMelden>,
) -> Result<(StatusCode, Json<StelleMeldungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = client_id(req.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some(replay) = repo::belegung_nach_client_id(&state.pool, einsatz_id, cid).await? {
            let m = repo::replay_am_objekt(replay, sid, "einer anderen Betreuungsstelle")?;
            return Ok((
                StatusCode::CREATED,
                Json(stelle_meldung(&state, einsatz_id, m).await?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let eingabe = BelegungEingabe {
        belegt: req.belegt,
        zeitpunkt_at: meldezeitpunkt(req.zeitpunkt_at.as_deref(), Utc::now())?,
        client_id,
    };
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::belegung_melden_tx(conn, einsatz_id, sid, benutzer_id, startwert, &eingabe).await
    })?;
    if m.neu {
        publiziere(&state, einsatz_id, &[m.etb_id], Objekt::Stelle(m.objekt_id));
    }
    Ok((
        StatusCode::CREATED,
        Json(stelle_meldung(&state, einsatz_id, m).await?),
    ))
}

/// POST /api/einsaetze/{id}/betreuung/belegungen/{mid}/zuruecknehmen
pub async fn belegung_zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    PfadParam((_eid, mid)): PfadParam<(i64, i64)>,
) -> Result<Json<StelleMeldungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = startwert(&state, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::belegung_zuruecknehmen_tx(conn, einsatz_id, mid, benutzer_id, startwert).await
    })?;
    publiziere(&state, einsatz_id, &[m.etb_id], Objekt::Stelle(m.objekt_id));
    Ok(Json(StelleMeldungAnzeige {
        meldung_id: m.meldung_id,
        stelle: repo::stelle_laden(&state.pool, einsatz_id, m.objekt_id).await?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, DRAHT).unwrap().and_utc()
    }

    #[test]
    fn zukunft_bis_60_s_toleriert_und_auf_jetzt_geklemmt_ab_61_s_400() {
        let jetzt = t("2026-09-23 12:00:00");
        // LFH-680: toleriert heißt nicht übernommen. Gespeichert wird `jetzt`, sonst wäre die
        // Meldung sofort „aktuell“, fehlte aber bis zu 60 s in der Kopfzahl „jetzt“.
        assert_eq!(
            meldezeitpunkt(Some("2026-09-23 12:01:00"), jetzt).unwrap(),
            "2026-09-23 12:00:00"
        );
        assert_eq!(
            meldezeitpunkt(Some("2026-09-23 12:00:01"), jetzt).unwrap(),
            "2026-09-23 12:00:00"
        );
        assert_eq!(
            meldezeitpunkt(Some("2026-09-23 12:01:01"), jetzt)
                .unwrap_err()
                .status(),
            StatusCode::BAD_REQUEST
        );
        // Mit Zone: 14:01:01+02:00 ist 12:01:01 UTC, also 61 s voraus.
        assert_eq!(
            meldezeitpunkt(Some("2026-09-23T14:01:01+02:00"), jetzt)
                .unwrap_err()
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            meldezeitpunkt(Some("2026-09-23T14:00:00+02:00"), jetzt).unwrap(),
            "2026-09-23 12:00:00",
            "normalisiert auf UTC"
        );
    }

    #[test]
    fn fehlender_zeitpunkt_ist_jetzt_unlesbarer_400() {
        let jetzt = t("2026-09-23 12:00:00");
        assert_eq!(meldezeitpunkt(None, jetzt).unwrap(), "2026-09-23 12:00:00");
        assert_eq!(
            meldezeitpunkt(Some("  "), jetzt).unwrap(),
            "2026-09-23 12:00:00"
        );
        assert_eq!(
            meldezeitpunkt(Some("gestern"), jetzt).unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
        // Vergangenheit ist erlaubt (nachgetragene Meldung).
        assert_eq!(
            meldezeitpunkt(Some("2026-09-22 09:30:00"), jetzt).unwrap(),
            "2026-09-22 09:30:00"
        );
    }
}
