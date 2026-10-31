//! Routen des Fachmoduls Betreuung (LFH-639): Betreuungsstellen mit Belegungsmeldungen und die
//! Kopfzahl „in Betreuung“. Die Evakuierungsbezirke sind seit LLH-1034 ein eigenes Modul
//! (`routes/evakuierung.rs`); Tabellen und Repo teilen beide.
//!
//! Gates strukturell über `EinsatzLesezugriff<Betreuung>` (alle Einsatzmitglieder inkl.
//! Beobachter) bzw. `EinsatzSchreibzugriff<Betreuung>` (Schreibrecht, aktiver Einsatz, Modul).
//! Die Melde-Route nimmt `EinsatzSchreibfreigabe<Betreuung>` und prüft den aktiven
//! Einsatz selbst, NACH dem Replay-Lookup ihrer `client_id` (LFH-675, design.md D2): eine
//! offline erfasste und schon gespeicherte Meldung kommt auch nach Einsatzende zurück, solange
//! der Einsatz lesbar ist (Lese-Gate im Extractor, LFH-769).
//! Bodies nur über `JsonBody`, Sub-IDs nur über `PfadParam`.
//!
//! **Statuscodes** nach der Konvention in `src/error.rs` (src/AGENTS.md „Statuscode-Konvention“,
//! design.md D3):
//! - **400** — das Feld für sich: fehlendes Pflichtfeld, unbekannter Enum-Wert, leere
//!   Bezeichnung, Plangröße/Kapazität < 1, Anzahl < 0, Zeitpunkt unlesbar oder mehr als
//!   [`support::ZUKUNFT_TOLERANZ_SEKUNDEN`] in der Zukunft, `client_id` länger als 64 Zeichen.
//! - **404** — fremdes oder unbekanntes Objekt, Abschnitt eines anderen Einsatzes.
//! - **409** — nur der Lebenszyklus (storniert) und die doppelte Bezeichnung. Es gibt KEIN
//!   CAS und damit keinen Überschreiben-Dialog: die zweite 409-Quelle aus LFH-299/300 kann
//!   hier nicht entstehen.
//! - **422** — ein umkehrbarer Zustand verbietet die Aktion: belegte Stelle schließen,
//!   geschlossene Stelle belegen, Belegungsmeldung an geschlossener Stelle zurücknehmen,
//!   bereits zurückgenommene Meldung erneut zurücknehmen, `client_id` einer Meldung an einer
//!   anderen Stelle (LFH-675).
//!
//! Die fachlichen Prüfungen liegen im Repo; die Route liest JSON, Enums und Zeitpunkte und
//! öffnet die Transaktion. Zeiten werden hier normalisiert (`etb::normalisiere_zeit`), nie im
//! Repo — dieselbe Arbeitsteilung wie in `routes/abloesung.rs`.
//!
//! **Live** nach dem Commit (design.md D5): jeder ETB-Eintrag als ETB-Kurzruf, danach
//! `LiveEvent::Betreuung` mit Kennungen only (`{einsatz_id, stelle_id}`) — keine Anzahlen,
//! Bezeichnungen oder Freitexte. Ein PATCH ohne wirksame Änderung (Leerlauf-Riegel im Repo,
//! leere `etb_ids`) publiziert nichts.

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use chrono::Utc;
use serde::de::IgnoredAny;
use serde::Deserialize;

use crate::app::AppState;
use crate::betreuung::repo::{self, BelegungEingabe, StelleAenderung, StelleEingabe};
use crate::betreuung::{
    enum_wert, BelegungKopfzahl, BelegungVerlaufEintrag, BetreuungUebersicht,
    BetreuungsstelleAnzeige, StelleMeldungAnzeige, StelleNamentlich, KONTAKTWEG_MAX, LEITUNG_MAX,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibfreigabe, EinsatzSchreibzugriff};
use crate::einsatz::modul::Betreuung;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle::{self, Sicht};
use crate::geraet::Bindungsart;
use crate::live::LiveEvent;
use crate::routes::support::{self, optional_max, optional_max_tri};

/// Nach dem Commit: ETB-Kurzruf je Eintrag, dann das Modul-Ereignis mit Kennungen only.
pub(super) fn publiziere(state: &AppState, einsatz_id: i64, etb_ids: &[i64], stelle_id: i64) {
    for etb_id in etb_ids {
        state.live.publiziere(einsatz_id, *etb_id);
    }
    let nutzlast = serde_json::json!({ "einsatz_id": einsatz_id, "stelle_id": stelle_id });
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Betreuung, nutzlast.to_string());
}

/// Wie [`publiziere`], aber nur nach einer wirksamen Änderung (Leerlauf-Riegel: ein PATCH
/// ohne neuen Wert schreibt keinen ETB-Eintrag und soll auch niemanden neu laden lassen).
/// Wirksam ist auch eine Änderung ohne ETB-Eintrag — die Verortung einer Stelle
/// (`still_geaendert`, LFH-673 design.md D3).
fn publiziere_wirksam(state: &AppState, einsatz_id: i64, g: &repo::Geschrieben) {
    if !g.etb_ids.is_empty() || g.still_geaendert {
        publiziere(state, einsatz_id, &g.etb_ids, g.id);
    }
}

fn enum_opt<T: TryFrom<String, Error = String>>(s: Option<String>) -> Result<Option<T>, AppError> {
    s.as_deref().map(enum_wert).transpose()
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/betreuung — nicht stornierte Stellen mit aktueller Meldung. Die eine
/// Quelle für Modulseite und Modulzähler; die Bezirke liefert seit LLH-1034 `GET …/evakuierung`.
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
    // Stellenbindung (LFH-1041): ein Gerät sieht nur seine Betreuungsstelle.
    let sicht = stelle::sicht(ctx.geraet.as_ref(), Bindungsart::Betreuungsstelle);
    if sicht != Sicht::Alle {
        uebersicht.stellen.retain(|s| sicht.sieht(s.id));
    }
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
                .filter(|(stelle_id, _)| sicht.sieht(*stelle_id))
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
        _ => crate::zeit::jetzt(),
    };
    Ok(Json(
        repo::kopfzahl(&state.pool, ctx.einsatz.id, &stichtag).await?,
    ))
}

/// GET /api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen — die ganze Belegungsreihe der
/// Stelle (LFH-676), wie [`stand_verlauf`]; auch an einer geschlossenen Stelle.
pub async fn belegung_verlauf(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Betreuung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<BelegungVerlaufEintrag>>, AppError> {
    stelle::fordere_stelle(ctx.geraet.as_ref(), Bindungsart::Betreuungsstelle, sid)?;
    Ok(Json(
        repo::belegung_verlauf(&state.pool, ctx.einsatz.id, sid).await?,
    ))
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
    /// Leitung und Kontaktweg (LLH-1044), Freitext bis [`LEITUNG_MAX`] bzw.
    /// [`KONTAKTWEG_MAX`] Zeichen.
    #[serde(default)]
    leitung: Option<String>,
    #[serde(default)]
    kontaktweg: Option<String>,
    /// Alter Name von `kontaktweg` (bis LLH-1419): im Body (auch `null`) → 400.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    erreichbarkeit: Option<Option<IgnoredAny>>,
    /// Koordinate aus dem Ortsfeld des Standorts (LLH-1121). Halbes Paar oder Wert außerhalb
    /// des Bereichs → **422**, wie beim Ändern ([`StelleAendern::lat`]).
    #[serde(default)]
    lat: Option<f64>,
    #[serde(default)]
    lon: Option<f64>,
}

/// POST /api/einsaetze/{id}/betreuung/stellen
pub async fn stelle_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Betreuung>,
    JsonBody(req): JsonBody<StelleAnlegen>,
) -> Result<(StatusCode, Json<BetreuungsstelleAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    support::lehne_alten_feldnamen_ab(
        req.erreichbarkeit.is_some(),
        "erreichbarkeit",
        "kontaktweg",
    )?;
    let eingabe = StelleEingabe {
        bezeichnung: req.bezeichnung,
        art: enum_wert(&req.art)?,
        abschnitt_id: req.abschnitt_id,
        kapazitaet_personen: req.kapazitaet_personen,
        standort: req.standort,
        notiz: req.notiz,
        leitung: optional_max(req.leitung, "Leitung", LEITUNG_MAX)?,
        kontaktweg: optional_max(req.kontaktweg, "Kontakt", KONTAKTWEG_MAX)?,
        lat: req.lat,
        lon: req.lon,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::stelle_anlegen_tx(conn, einsatz_id, benutzer_id, startwert, &eingabe).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, g.id);
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
    /// Tri-State wie `notiz` (LLH-1044).
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    leitung: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    kontaktweg: Option<Option<String>>,
    /// Alter Name von `kontaktweg` (bis LLH-1419): im Body (auch `null`) → 400.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    erreichbarkeit: Option<Option<IgnoredAny>>,
    /// Koordinate auf der Lagekarte (LFH-673), tri-state je Wert: fehlt = unverändert,
    /// `null` = entfernen. Halbes Paar oder Wert außerhalb des Bereichs → **422**, wie an der
    /// UHS (`einsatz_uhs.rs`, von src/AGENTS.md als legitimes 422 geführt): das Paar ist ein
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
    support::lehne_alten_feldnamen_ab(
        req.erreichbarkeit.is_some(),
        "erreichbarkeit",
        "kontaktweg",
    )?;
    let eingabe = StelleAenderung {
        bezeichnung: req.bezeichnung,
        art: enum_opt(req.art)?,
        abschnitt_id: req.abschnitt_id,
        kapazitaet_personen: req.kapazitaet_personen,
        status: enum_opt(req.status)?,
        standort: req.standort,
        notiz: req.notiz,
        // Feldgrenze vor jedem 422 des Zusammenhangs (src/AGENTS.md, Eingabegrenzen).
        leitung: optional_max_tri(req.leitung, "Leitung", LEITUNG_MAX)?,
        kontaktweg: optional_max_tri(req.kontaktweg, "Kontakt", KONTAKTWEG_MAX)?,
        lat: req.lat,
        lon: req.lon,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::stelle_aendern_tx(conn, einsatz_id, sid, benutzer_id, startwert, &eingabe).await
    })?;
    publiziere_wirksam(&state, einsatz_id, &g);
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
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let (g, geloest) = crate::write_retry!(&state.pool, |conn| {
        repo::stelle_stornieren_tx(conn, einsatz_id, sid, benutzer_id, startwert).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids, g.id);
    // Gelöste Stellenbezüge (LLH-1082, design.md D3): die Nachforderungsliste lädt neu.
    if !geloest.is_empty() {
        state
            .live
            .publiziere_einsatz(einsatz_id, crate::live::LiveEvent::Nachforderung);
    }
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
    stelle::fordere_stelle(ctx.geraet.as_ref(), Bindungsart::Betreuungsstelle, sid)?;
    support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = support::parse_client_id(req.client_id.as_deref())?;
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
        zeitpunkt_at: support::meldezeitpunkt(req.zeitpunkt_at.as_deref(), Utc::now())?,
        client_id,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::belegung_melden_tx(conn, einsatz_id, sid, benutzer_id, startwert, &eingabe).await
    })?;
    if m.neu {
        publiziere(&state, einsatz_id, &[m.etb_id], m.objekt_id);
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
    // Stellenbindung (LFH-1041): die Meldung einer fremden Stelle gibt es für das Gerät nicht.
    if ctx.geraet.is_some() {
        let sid = repo::stelle_der_belegung(&state.pool, einsatz_id, mid)
            .await?
            .ok_or(AppError::NotFound)?;
        stelle::fordere_stelle(ctx.geraet.as_ref(), Bindungsart::Betreuungsstelle, sid)?;
    }
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let m = crate::write_retry!(&state.pool, |conn| {
        repo::belegung_zuruecknehmen_tx(conn, einsatz_id, mid, benutzer_id, startwert).await
    })?;
    publiziere(&state, einsatz_id, &[m.etb_id], m.objekt_id);
    Ok(Json(StelleMeldungAnzeige {
        meldung_id: m.meldung_id,
        stelle: repo::stelle_laden(&state.pool, einsatz_id, m.objekt_id).await?,
    }))
}
