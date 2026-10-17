//! Routen des Fachmoduls Verpflegung (LFH-634): Zeitfenster mit Bedarf, Ausgaben dagegen.
//!
//! Gates strukturell über `EinsatzLesezugriff<Verpflegung>` (alle Einsatzmitglieder inkl.
//! Beobachter) bzw. `EinsatzSchreibzugriff<Verpflegung>` (Schreibrecht, aktiver Einsatz,
//! Modul). Für diese Schreibrouten ist ein abgeschlossener Einsatz 409 aus `fordere_aktiv` im
//! Extractor — wie bei Ablösung, NICHT über `fordere_aktiv_in_tx` (design.md D4). Ausnahme ist
//! „Ausgabe erfassen“ mit `EinsatzSchreibfreigabe` (LFH-688): ihr Replay-Lookup läuft vor
//! `fordere_aktiv` im Handler. Bodies nur über `JsonBody`, Sub-IDs nur über `PfadParam`.
//!
//! **Statuscodes** (design.md D4, src/AGENTS.md „Statuscode-Konvention“):
//! - **400** — das Feld für sich: fehlendes Pflichtfeld, leere Bezeichnung, negativer
//!   Bedarfsteil oder Kostform, Menge ≤ 0, unlesbarer Zeitpunkt, Freitext über seiner Grenze
//!   (`*_MAX`, LLH-1040 D10), unbekannte Art, Verpflegungsart oder Status, mehr als
//!   `STELLEN_JE_ZEITFENSTER_MAX` Stellen, keine oder mehr als `AUS_VORLAGE_MAX` Zeitfenster
//!   eines Tages.
//! - **404** — fremdes Zeitfenster, fremde Ausgabe, fremde Nachforderung, fremde
//!   Verpflegungsstelle im Pfad, fremder Abschnitt, fremde oder unbekannte Empfänger-Einheit bzw.
//!   Empfänger-Abschnitt einer Ausgabe (LLH-1055 D2). Für ein an eine Verpflegungsstelle
//!   gebundenes Gerät (LLH-1048) auch ein Zeitfenster, das nur fremden Stellen zugeordnet ist, und
//!   eine Ausgabe, die nicht an seiner Stelle gebucht ist.
//! - **403** — ein Gerät bucht auf eine Nachforderung (LFH-1044); ein an eine Stelle gebundenes
//!   Gerät nennt eine andere Verpflegungsstelle (LLH-1048, ohne Angabe setzt der Server seine).
//! - **409** — stornierte Verpflegungsstelle im Pfad (Ändern, Status, Storno), Bezeichnung einer
//!   Stelle schon vergeben, Ausgabe an einer aufgelösten Stelle (LLH-1040 D3) oder an eine
//!   aufgelöste Einheit (LLH-1055 D2) mit einem Zeitpunkt nicht vor der Auflösung.
//! - **422** — der Zusammenhang: Ende nicht nach Beginn, Sonderkost über Gesamtbedarf bzw.
//!   Menge, Löschen mit gültiger Ausgabe, zweite Rücknahme, unzulässiger Statusübergang einer
//!   Stelle, Storno einer nicht geplanten Stelle oder einer Stelle mit Ausgabe, halbe Koordinate,
//!   Verweis im Body (Ausgabe, Zuordnung) auf eine fremde, unbekannte oder stornierte Stelle,
//!   neue Zuordnung einer aufgelösten Stelle, Ausgabe mit Einheit und Abschnitt zugleich
//!   (höchstens ein Empfänger, LLH-1055); beim Tag aus der Vorlage Tagesgrenzen nicht 23
//!   bis 25 Stunden auseinander, Beginn außerhalb des Tages, Bezeichnung doppelt in der Anfrage.
//!
//! **Tag aus der Vorlage** (LLH-1058, design.md D3): `POST …/zeitfenster/aus-vorlage` legt die
//! übergebenen Zeitfenster eines Tages in EINER Transaktion an, gleiches Gate wie das
//! Einzelanlegen. Die Route liest alle Zeitpunkte, prüft die Anzahl (`AUS_VORLAGE_MAX`) und je
//! Fenster Bezeichnung und Art (400, vor jedem 422 auch eines anderen Fensters); den Rest prüft
//! `repo::zeitfenster_aus_vorlage_tx`. Ein am Tag schon vorhandenes gleichnamiges Fenster wird
//! übersprungen. 201, wenn mindestens eins entsteht, sonst 200 ohne ETB und ohne Ereignis; die
//! Zeitfenster sind keiner Stelle zugeordnet, der Body kennt keine.
//!
//! Die fachlichen Prüfungen liegen im Repo; die Route liest JSON, normalisiert die Zeitpunkte
//! (`etb::normalisiere_zeit`), lädt ETB-Startwert und Org-Zeitzone und öffnet die Transaktion —
//! dieselbe Arbeitsteilung wie in `routes/betreuung.rs`.
//!
//! **Live** nach dem Commit (design.md D5/D6): zuerst der ETB-Kurzruf je Eintrag, dann
//! `LiveEvent::Verpflegung` mit `{einsatz_id}` — keine Mengen, Bezeichnungen oder Freitexte.
//! Ein Ändern ohne wirksame Änderung (leere `etb_ids`) publiziert nichts. Ausgabe und Rücknahme
//! schreiben keinen ETB-Eintrag und publizieren nur das Modul-Ereignis. Die Stellen (LLH-1040)
//! publizieren dasselbe Ereignis; nur ihr Statuswechsel schreibt ETB.

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
use crate::geraet::stelle::{self, Sicht};
use crate::geraet::{Bindungsart, GeraetKontext};
use crate::live::LiveEvent;
use crate::routes::support::{
    deserialize_optional_field, optional_max, parse_enum, parse_enum_opt, pflicht_max,
};
use crate::verpflegung::repo::{
    self, AusgabeEingabe, StelleAenderung, StelleEingabe, ZeitfensterAenderung, ZeitfensterEingabe,
};
use crate::verpflegung::stelle::{
    VerpflegungsstelleAnzeige, VerpflegungsstelleArt, VerpflegungsstelleStatus,
};
use crate::verpflegung::{
    self, dedupe_stelle_ids, stellensicht, AusgabeErgebnis, SonderkostEingabe, VerpflegungAnzeige,
    VerpflegungTagErgebnis, Verpflegungsart, ZeitfensterAnzeige,
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

/// Verpflegungsart von außen; unbekannt → 400.
fn parse_verpflegungsart(s: Option<&str>) -> Result<Option<Verpflegungsart>, AppError> {
    parse_enum_opt(
        Verpflegungsart::parse,
        s,
        "Unbekannte Verpflegungsart (erlaubt: warm, kalt, getraenke)",
    )
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/verpflegung — alle Zeitfenster nach Beginn, je mit Deckung und
/// Ausgaben, dazu die Stellen und die Empfängerliste (LLH-1055 D3, auch ohne Modul `einheiten`).
pub async fn uebersicht(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Verpflegung>,
) -> Result<Json<VerpflegungAnzeige>, AppError> {
    let eigene = eigene_stelle(ctx.geraet.as_ref())?;
    let v = repo::liste(&state.pool, ctx.einsatz.id).await?;
    Ok(Json(match eigene {
        Some(sid) => stellensicht::verpflegung(v, sid),
        None => v,
    }))
}

/// Die Verpflegungsstelle eines daran gebundenen Geräts (LLH-1048); `None` für eine Person und
/// das einsatzweite Gerät. Jedes andere Gerät erreicht diese Routen nicht (Routenliste); sähe es
/// sie doch, kennte es keine Stelle: 403.
fn eigene_stelle(geraet: Option<&GeraetKontext>) -> Result<Option<i64>, AppError> {
    match stelle::sicht_wahlweise(geraet, Bindungsart::Verpflegungsstelle) {
        Sicht::Alle => Ok(None),
        Sicht::Nur(id) => Ok(Some(id)),
        Sicht::Keine => Err(AppError::Forbidden),
    }
}

/// Lädt ein Zeitfenster für die Antwort, für ein gebundenes Gerät in seiner Sicht.
async fn zeitfenster_fuer(
    state: &AppState,
    einsatz_id: i64,
    zeitfenster_id: i64,
    eigene: Option<i64>,
) -> Result<ZeitfensterAnzeige, AppError> {
    let z = repo::zeitfenster_laden(&state.pool, einsatz_id, zeitfenster_id).await?;
    Ok(match eigene {
        Some(sid) => stellensicht::zeitfenster(z, sid),
        None => z,
    })
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
    /// `warm`, `kalt`, `getraenke`; fehlt = ohne Angabe (LLH-1040 D8).
    #[serde(default)]
    verpflegungsart: Option<String>,
    /// Zugeordnete Stellen; fehlt oder leer = einsatzweit (LLH-1040 D5).
    #[serde(default)]
    stelle_ids: Option<Vec<i64>>,
}

/// POST /api/einsaetze/{id}/verpflegung/zeitfenster
pub async fn zeitfenster_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    JsonBody(req): JsonBody<ZeitfensterAnlegen>,
) -> Result<(StatusCode, Json<ZeitfensterAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // 400 vor jeder Abfrage (D5): Grenze der Stellenliste, gezählt vor dem Entdoppeln.
    let stelle_ids = dedupe_stelle_ids(req.stelle_ids.as_deref().unwrap_or_default())?;
    let eingabe = ZeitfensterEingabe {
        bezeichnung: req.bezeichnung,
        von_at: zeit(&req.von_at)?,
        bis_at: zeit(&req.bis_at)?,
        bedarf_kraefte: req.bedarf_kraefte,
        bedarf_betreute: req.bedarf_betreute,
        bedarf_weitere: req.bedarf_weitere.unwrap_or(0),
        sonderkost: req.sonderkost.unwrap_or_default(),
        verpflegungsart: parse_verpflegungsart(req.verpflegungsart.as_deref())?,
        stelle_ids,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = repo::zeitzone(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::create_zeitfenster_tx(conn, einsatz_id, benutzer_id, startwert, tz, &eingabe).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids);
    Ok((
        StatusCode::CREATED,
        Json(repo::zeitfenster_laden(&state.pool, einsatz_id, g.id).await?),
    ))
}

/// Ein Zeitfenster der Anfrage „Tag aus der Vorlage“: die Felder des Einzelanlegens ohne
/// Stellen (die Zuordnung geschieht danach an der Karte, design.md D3).
#[derive(Debug, Deserialize)]
pub struct TagZeitfenster {
    bezeichnung: String,
    von_at: String,
    bis_at: String,
    bedarf_kraefte: i64,
    bedarf_betreute: i64,
    #[serde(default)]
    bedarf_weitere: Option<i64>,
    #[serde(default)]
    sonderkost: Option<SonderkostEingabe>,
    #[serde(default)]
    verpflegungsart: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TagAusVorlage {
    /// Grenzen des Tages in der Anzeigezone (00:00 bis 00:00 des Folgetags), wie `von_at`.
    tag_von_at: String,
    tag_bis_at: String,
    zeitfenster: Vec<TagZeitfenster>,
}

/// POST /api/einsaetze/{id}/verpflegung/zeitfenster/aus-vorlage — legt die Zeitfenster eines
/// Tages an (LLH-1058). 201 mit angelegten und übersprungenen; 200, wenn alles übersprungen ist.
pub async fn zeitfenster_aus_vorlage(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    JsonBody(req): JsonBody<TagAusVorlage>,
) -> Result<(StatusCode, Json<VerpflegungTagErgebnis>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // 400 vor jedem 422, auch eines anderen Fensters (design.md D3, Spec `eingabegrenzen`).
    let tag_von_at = zeit(&req.tag_von_at)?;
    let tag_bis_at = zeit(&req.tag_bis_at)?;
    if req.zeitfenster.is_empty() {
        return Err(AppError::Validation(
            "zeitfenster darf nicht leer sein".into(),
        ));
    }
    if req.zeitfenster.len() > verpflegung::AUS_VORLAGE_MAX {
        return Err(AppError::Validation(format!(
            "zeitfenster darf höchstens {} Einträge haben, waren {}",
            verpflegung::AUS_VORLAGE_MAX,
            req.zeitfenster.len()
        )));
    }
    let fenster = req
        .zeitfenster
        .into_iter()
        .enumerate()
        .map(|(i, f)| {
            let label = f.bezeichnung.clone();
            let eingabe = || -> Result<ZeitfensterEingabe, AppError> {
                Ok(ZeitfensterEingabe {
                    bezeichnung: pflicht_max(
                        &f.bezeichnung,
                        "bezeichnung",
                        verpflegung::ZEITFENSTER_BEZEICHNUNG_MAX,
                    )?,
                    von_at: zeit(&f.von_at)?,
                    bis_at: zeit(&f.bis_at)?,
                    bedarf_kraefte: f.bedarf_kraefte,
                    bedarf_betreute: f.bedarf_betreute,
                    bedarf_weitere: f.bedarf_weitere.unwrap_or(0),
                    sonderkost: f.sonderkost.unwrap_or_default(),
                    verpflegungsart: parse_verpflegungsart(f.verpflegungsart.as_deref())?,
                    stelle_ids: Vec::new(),
                })
            };
            eingabe().map_err(|e| repo::label_error(i, &label, e))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = repo::zeitzone(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::zeitfenster_aus_vorlage_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            tz,
            &tag_von_at,
            &tag_bis_at,
            &fenster,
        )
        .await
    })?;
    // Ohne angelegtes Fenster weder ETB noch Ereignis (Spec „Alles schon angelegt“).
    if g.angelegt.is_empty() {
        return Ok((
            StatusCode::OK,
            Json(VerpflegungTagErgebnis {
                angelegt: Vec::new(),
                uebersprungen: g.uebersprungen,
            }),
        ));
    }
    publiziere(&state, einsatz_id, &g.etb_ids);
    // Die angelegten in der Reihenfolge der Anfrage, aus EINER Lesung des Moduls.
    let mut alle = repo::liste(&state.pool, einsatz_id).await?.zeitfenster;
    let angelegt = g
        .angelegt
        .iter()
        .filter_map(|id| {
            alle.iter()
                .position(|z| z.id == *id)
                .map(|i| alle.swap_remove(i))
        })
        .collect();
    Ok((
        StatusCode::CREATED,
        Json(VerpflegungTagErgebnis {
            angelegt,
            uebersprungen: g.uebersprungen,
        }),
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
    /// Tri-State: fehlt = unverändert, `null` = leeren.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    verpflegungsart: Option<Option<String>>,
    /// Fehlt = unverändert; eine Liste ersetzt die Zuordnung, `[]` leert sie.
    #[serde(default)]
    stelle_ids: Option<Vec<i64>>,
}

/// PATCH /api/einsaetze/{id}/verpflegung/zeitfenster/{zid}
pub async fn zeitfenster_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<ZeitfensterAendern>,
) -> Result<Json<ZeitfensterAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // 400 vor jeder Abfrage (D5).
    let stelle_ids = req
        .stelle_ids
        .as_deref()
        .map(dedupe_stelle_ids)
        .transpose()?;
    let verpflegungsart = req
        .verpflegungsart
        .map(|a| parse_verpflegungsart(a.as_deref()))
        .transpose()?;
    let aenderung = ZeitfensterAenderung {
        bezeichnung: req.bezeichnung,
        von_at: zeit_opt(req.von_at)?,
        bis_at: zeit_opt(req.bis_at)?,
        bedarf_kraefte: req.bedarf_kraefte,
        bedarf_betreute: req.bedarf_betreute,
        bedarf_weitere: req.bedarf_weitere,
        sonderkost: req.sonderkost.unwrap_or_default(),
        verpflegungsart,
        stelle_ids,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let tz = repo::zeitzone(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::update_zeitfenster_tx(
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
        repo::delete_zeitfenster_tx(conn, einsatz_id, zid, benutzer_id, startwert, tz).await
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
    /// Verpflegungsstelle desselben Einsatzes (LLH-1040 D3); fremd, unbekannt oder storniert 422,
    /// aufgelöst 409 (außer mit einem Zeitpunkt vor der Auflösung).
    #[serde(default)]
    verpflegungsstelle_id: Option<i64>,
    /// Empfänger-Einheit desselben Einsatzes (LLH-1055 D2); fremd oder unbekannt 404, aufgelöst
    /// 409 (außer mit einem Zeitpunkt vor der Auflösung). Mit `abschnitt_id` zusammen 422.
    #[serde(default)]
    einheit_id: Option<i64>,
    /// Empfänger-Abschnitt desselben Einsatzes (Zuführung, LLH-1055 D2); fremd oder unbekannt 404.
    #[serde(default)]
    abschnitt_id: Option<i64>,
    /// Idempotenzschlüssel der Offline-Queue (LFH-688): leer = fehlend, > 64 Zeichen = 400.
    #[serde(default)]
    client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/verpflegung/zeitfenster/{zid}/ausgaben — ohne ETB-Eintrag.
///
/// Idempotent über `client_id` (LFH-688, design.md D2): Reihenfolge wie `routes/meldung.rs`
/// — Gates im Extractor (Org, Schreibrecht, Modul, Lesezugriff), Queue-Besitzer, Replay-Lookup,
/// ERST DANN `fordere_aktiv`. Ein gespeicherter Replay kommt so auch nach dem Einsatzende
/// zurück, solange der Einsatz lesbar ist (LFH-769); ein Replay publiziert nichts (D5).
pub async fn ausgabe_erfassen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Verpflegung>,
    headers: HeaderMap,
    PfadParam((_eid, zid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<AusgabeErfassen>,
) -> Result<(StatusCode, Json<AusgabeErgebnis>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let eigene = eigene_stelle(ctx.geraet.as_ref())?;
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
            return antwort(&state, einsatz_id, a, eigene).await;
        }
    }
    ctx.fordere_aktiv()?;
    // Grenzen erst NACH dem Replay-Lookup (design.md D10): eine vor der Grenze gespeicherte
    // Ausgabe käme sonst beim erneuten Senden mit 400 zurück und fiele in den
    // Wiederherstellungsbereich, obwohl sie längst gebucht ist.
    let ort = optional_max(req.ort, "ort", verpflegung::ORT_MAX)?;
    let bemerkung = optional_max(req.bemerkung, "bemerkung", verpflegung::BEMERKUNG_MAX)?;
    let zeitpunkt_at = match req.zeitpunkt_at.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => zeit(s)?,
        _ => crate::zeit::jetzt(),
    };
    // Nachforderungen liegen außerhalb jeder Geräteansicht (LFH-1044): ein Gerät bucht nie auf
    // eine, sonst verriete 404 gegen 201, welche es gibt.
    if req.nachforderung_id.is_some() && ctx.geraet.is_some() {
        return Err(AppError::Forbidden);
    }
    // Die Nachforderung muss zu DIESEM Einsatz gehören; der FK sichert nur, dass es sie gibt.
    // Vor der Transaktion: die Prüfung nimmt den Pool, und Nachforderungen werden nicht
    // gelöscht oder umgehängt.
    if let Some(nid) = req.nachforderung_id {
        if !crate::nachforderung::repo::belongs_to_einsatz(&state.pool, nid, einsatz_id).await? {
            return Err(AppError::NotFound);
        }
    }
    // Ein an eine Stelle gebundenes Gerät bucht an ihr (LLH-1048): ohne Angabe setzt der Server
    // sie, eine andere ist 403 — nach Replay, Grenzen und Nachforderung, vor jeder Abfrage.
    let verpflegungsstelle_id = stelle::ziel_stelle_wahlweise(
        ctx.geraet.as_ref(),
        Bindungsart::Verpflegungsstelle,
        req.verpflegungsstelle_id,
    )?;
    let eingabe = AusgabeEingabe {
        zeitpunkt_at,
        menge: req.menge,
        ort,
        bemerkung,
        sonderkost: req.sonderkost.unwrap_or_default(),
        nachforderung_id: req.nachforderung_id,
        verpflegungsstelle_id,
        einheit_id: req.einheit_id,
        abschnitt_id: req.abschnitt_id,
        client_id,
    };
    let benutzer_id = ctx.benutzer.id;
    let a = crate::write_retry!(&state.pool, |conn| {
        if let Some(sid) = eigene {
            // Replay zuerst (wie in `ausgabe_erfassen_tx`): eine schon gebuchte Ausgabe kommt
            // auch zurück, wenn das Zeitfenster inzwischen nicht mehr an der Stelle gilt.
            if let Some(cid) = eingabe.client_id.as_deref() {
                if let Some(r) = repo::laden_nach_client_id(&mut *conn, einsatz_id, cid).await? {
                    return repo::replay_am_zeitfenster(r, zid);
                }
            }
            // Ein Zeitfenster nur fremder Stellen gibt es für das Gerät nicht (404).
            repo::check_zeitfenster_an_stelle_tx(conn, einsatz_id, zid, sid).await?;
        }
        repo::ausgabe_erfassen_tx(conn, einsatz_id, zid, benutzer_id, &eingabe).await
    })?;
    antwort(&state, einsatz_id, a, eigene).await
}

/// 201 mit Ausgabe und Zeitfenster danach (für ein gebundenes Gerät in seiner Sicht); das
/// Modul-Ereignis nur, wenn wirklich geschrieben wurde (ein Replay publiziert nichts, design.md
/// D5).
async fn antwort(
    state: &AppState,
    einsatz_id: i64,
    a: repo::AusgabeGeschrieben,
    eigene: Option<i64>,
) -> Result<(StatusCode, Json<AusgabeErgebnis>), AppError> {
    if a.neu {
        publiziere(state, einsatz_id, &[]);
    }
    Ok((
        StatusCode::CREATED,
        Json(AusgabeErgebnis {
            ausgabe_id: a.ausgabe_id,
            zeitfenster: zeitfenster_fuer(state, einsatz_id, a.zeitfenster_id, eigene).await?,
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
    let eigene = eigene_stelle(ctx.geraet.as_ref())?;
    let a = crate::write_retry!(&state.pool, |conn| {
        // Ein gebundenes Gerät nimmt nur Ausgaben seiner Stelle zurück; andere sieht es nicht
        // (404, LLH-1048).
        if let Some(sid) = eigene {
            repo::check_ausgabe_an_stelle_tx(conn, einsatz_id, aid, sid).await?;
        }
        repo::ausgabe_zuruecknehmen_tx(conn, einsatz_id, aid, benutzer_id).await
    })?;
    publiziere(&state, einsatz_id, &[]);
    Ok(Json(AusgabeErgebnis {
        ausgabe_id: a.ausgabe_id,
        zeitfenster: zeitfenster_fuer(&state, einsatz_id, a.zeitfenster_id, eigene).await?,
    }))
}

// ── Verpflegungsstellen (LLH-1040) ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StelleAnlegen {
    bezeichnung: String,
    /// `feldkueche`, `ausgabestelle`, `zufuehrung`; unbekannt → 400.
    art: String,
    #[serde(default)]
    standort: Option<String>,
    #[serde(default)]
    lat: Option<f64>,
    #[serde(default)]
    lon: Option<f64>,
    #[serde(default)]
    abschnitt_id: Option<i64>,
}

fn parse_stelle_art(s: &str) -> Result<VerpflegungsstelleArt, AppError> {
    parse_enum(
        VerpflegungsstelleArt::parse,
        s,
        "Unbekannte Art der Verpflegungsstelle (erlaubt: feldkueche, ausgabestelle, zufuehrung)",
    )
}

/// POST /api/einsaetze/{id}/verpflegung/stellen — legt eine Stelle `geplant` an, ohne ETB.
pub async fn create_stelle(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    JsonBody(req): JsonBody<StelleAnlegen>,
) -> Result<(StatusCode, Json<VerpflegungsstelleAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = StelleEingabe {
        bezeichnung: req.bezeichnung,
        art: parse_stelle_art(&req.art)?,
        standort: req.standort,
        lat: req.lat,
        lon: req.lon,
        abschnitt_id: req.abschnitt_id,
    };
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::create_stelle_tx(conn, einsatz_id, benutzer_id, &eingabe).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids);
    Ok((
        StatusCode::CREATED,
        Json(repo::load_stelle(&state.pool, einsatz_id, g.id).await?),
    ))
}

/// Teiländerung: jedes fehlende Feld bleibt; `standort`, `lat`, `lon`, `abschnitt_id` leert
/// `null`.
#[derive(Debug, Deserialize)]
pub struct StelleAendern {
    #[serde(default)]
    bezeichnung: Option<String>,
    #[serde(default)]
    art: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    standort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    abschnitt_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/verpflegung/stellen/{sid} — ohne ETB; auch eine aufgelöste Stelle.
pub async fn update_stelle(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<StelleAendern>,
) -> Result<Json<VerpflegungsstelleAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let aenderung = StelleAenderung {
        bezeichnung: req.bezeichnung,
        art: req.art.as_deref().map(parse_stelle_art).transpose()?,
        standort: req.standort,
        lat: req.lat,
        lon: req.lon,
        abschnitt_id: req.abschnitt_id,
    };
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::update_stelle_tx(conn, einsatz_id, sid, &aenderung).await
    })?;
    if g.geaendert {
        publiziere(&state, einsatz_id, &g.etb_ids);
    }
    Ok(Json(repo::load_stelle(&state.pool, einsatz_id, sid).await?))
}

#[derive(Debug, Deserialize)]
pub struct StelleStatus {
    /// `aktiv` oder `aufgeloest`; unbekannt → 400, unzulässiger Übergang → 422.
    status: String,
}

/// POST /api/einsaetze/{id}/verpflegung/stellen/{sid}/status — ETB bei `aktiv` und
/// `aufgeloest` in derselben Transaktion.
pub async fn update_stelle_status(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<StelleStatus>,
) -> Result<Json<VerpflegungsstelleAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let nach = parse_enum(
        VerpflegungsstelleStatus::parse,
        &req.status,
        "Unbekannter Status der Verpflegungsstelle (erlaubt: geplant, aktiv, aufgeloest)",
    )?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::update_stelle_status_tx(conn, einsatz_id, sid, benutzer_id, startwert, nach).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids);
    Ok(Json(repo::load_stelle(&state.pool, einsatz_id, sid).await?))
}

/// DELETE /api/einsaetze/{id}/verpflegung/stellen/{sid} — Storno einer geplanten Stelle ohne
/// Ausgabe, ohne ETB.
pub async fn stelle_stornieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Verpflegung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let benutzer_id = ctx.benutzer.id;
    let g = crate::write_retry!(&state.pool, |conn| {
        repo::stelle_stornieren_tx(conn, einsatz_id, sid, benutzer_id).await
    })?;
    publiziere(&state, einsatz_id, &g.etb_ids);
    Ok(StatusCode::NO_CONTENT)
}
