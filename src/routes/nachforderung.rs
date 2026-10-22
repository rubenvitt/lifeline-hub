use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Nachforderungen;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::nachforderung::{
    repo, NachforderungAnzeige, NachforderungStatus, PRIO_NORMAL, STATUS_ABGELEHNT,
    STATUS_EINGETROFFEN, STATUS_ZURUECKGEZOGEN,
};
use crate::routes::support::{self, hoechstens, optional_max, pflicht_max};
use crate::zeit::jetzt;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;

use serde::Deserialize;

/// SSE-Notify: Nachforderungen des Einsatzes haben sich geändert (Tag `nachforderung`,
/// auf der EINEN bestehenden /etb/stream-Verbindung).
pub(super) fn sse(state: &AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Nachforderung);
}

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
fn parse_zeit(roh: &str) -> Result<String, AppError> {
    crate::zeit::normalisiere_eingabe(roh)
        .ok_or_else(|| AppError::Validation("Ungültiger Zeitpunkt".into()))
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/nachforderungen — listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Nachforderungen>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<NachforderungAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let status = params
        .status
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(s) = status {
        if !crate::nachforderung::status_gueltig(s) {
            return Err(AppError::Validation("Ungültiger Status-Filter".into()));
        }
    }
    Ok(Json(repo::list(&state.pool, einsatz_id, status).await?))
}

/// GET /api/einsaetze/{id}/nachforderungen/arten — übliche Arten der Organisation für
/// Schnellwahl und Vorschläge (LLH-1379, design.md D1–D6). Dieselbe Tür wie die Liste; gezählt
/// wird nur über andere Einsätze der Einsatz-Org, deren Nachforderungen der Benutzer selbst lesen
/// darf. Keine Geräteroute (D3).
pub async fn arten(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Nachforderungen>,
) -> Result<Json<Vec<crate::nachforderung::arten::NachforderungArtUeblich>>, AppError> {
    if ctx.geraet.is_some() {
        // Netz unter der Routenschranke: ein Gerät hat in anderen Einsätzen keine Rolle.
        return Err(AppError::Forbidden);
    }
    Ok(Json(
        crate::nachforderung::arten::uebliche_arten(&state.pool, &ctx.benutzer, &ctx.einsatz)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct NeueNachforderung {
    pub art: String,
    /// Details/Zweck, optional (LLH-1089 design.md D1); leer = ohne.
    #[serde(default)]
    pub bezeichnung: Option<String>,
    pub anzahl: Option<i64>,
    pub adressat_kategorie: String,
    pub adressat_bezeichnung: Option<String>,
    pub begruendung: Option<String>,
    pub prioritaet: Option<String>,
    /// Ereigniszeit der Anforderung (UTC); leer = jetzt.
    pub angefordert_at: Option<String>,
    /// Betreuungsstelle, für die angefordert wird (LLH-1082); fehlt = einsatzweit.
    #[serde(default)]
    pub betreuungsstelle_id: Option<i64>,
    /// Ziel (Meldeort, LLH-1089 design.md D5): höchstens eines der drei.
    #[serde(default)]
    pub ziel_br_id: Option<i64>,
    #[serde(default)]
    pub ziel_abschnitt_id: Option<i64>,
    #[serde(default)]
    pub ziel_text: Option<String>,
    /// Bedarfszeit „benötigt bis“ (UTC); leer = sofort.
    #[serde(default)]
    pub benoetigt_bis: Option<String>,
}

/// LLH-1089 (design.md D8): ein Ziel aus Raum oder Abschnitt wird wie die Betreuungsstelle
/// geprüft — 403 ohne Lesezugriff auf das Modul des Ziels (VOR jedem Lesen), 404 bei fremdem oder
/// unbekanntem Ziel, 409 bei aufgelöstem oder storniertem Raum. Ein Freitext braucht nichts.
/// Der PATCH (LLH-1097 D9) ruft sie für ein geändertes Ziel.
pub(crate) async fn pruefe_ziel(
    state: &AppState,
    ctx: &EinsatzSchreibzugriff<Nachforderungen>,
    ziel_br_id: Option<i64>,
    ziel_abschnitt_id: Option<i64>,
) -> Result<(), AppError> {
    if let Some(br_id) = ziel_br_id {
        ctx.fordere_zielmodul::<crate::einsatz::modul::Bereitstellungsraeume>(&state.pool)
            .await?;
        let br =
            crate::bereitstellungsraum::repo::laden(&state.pool, ctx.einsatz.id, br_id).await?;
        if br.storniert_at.is_some()
            || br.status == crate::bereitstellungsraum::BrStatus::Aufgeloest
        {
            return Err(AppError::Conflict(
                "Der Bereitstellungsraum ist aufgelöst".into(),
            ));
        }
    }
    if let Some(abschnitt_id) = ziel_abschnitt_id {
        ctx.fordere_zielmodul::<crate::einsatz::modul::Einsatzabschnitte>(&state.pool)
            .await?;
        crate::einsatzabschnitt::repo::check_im_einsatz(&state.pool, ctx.einsatz.id, abschnitt_id)
            .await?;
    }
    Ok(())
}

/// LLH-1082 (design.md D2): ein Bezug auf eine Betreuungsstelle wird in fester Reihenfolge
/// geprüft, wie der Verbleib (LFH-674) — 403 ohne Lesezugriff auf das Modul Betreuung (VOR jedem
/// Lesen der Stelle, sonst verrieten 404/409 ihre Existenz), 404 bei fremder oder unbekannter
/// Stelle, 409 bei stornierter. Eine geschlossene Stelle ist zulässig.
async fn pruefe_betreuungsstelle(
    state: &AppState,
    ctx: &EinsatzSchreibzugriff<Nachforderungen>,
    stelle_id: i64,
) -> Result<(), AppError> {
    ctx.fordere_modul_zugriff(
        &state.pool,
        <crate::einsatz::modul::Betreuung as crate::einsatz::modul::ModulMarker>::KEY
            .expect("Betreuung ist an ein Modul gebunden"),
    )
    .await?;
    let stelle =
        crate::betreuung::repo::stelle_laden(&state.pool, ctx.einsatz.id, stelle_id).await?;
    if stelle.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Die Betreuungsstelle ist storniert".into(),
        ));
    }
    Ok(())
}

/// POST /api/einsaetze/{id}/nachforderungen — Nachforderung absetzen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Nachforderungen>,
    JsonBody(req): JsonBody<NeueNachforderung>,
) -> Result<(StatusCode, Json<NachforderungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let art = pflicht_max(&req.art, "Art", crate::nachforderung::ART_MAX)?;
    let bezeichnung = optional_max(
        req.bezeichnung.clone(),
        "Details",
        crate::nachforderung::BEZEICHNUNG_MAX,
    )?;
    let ziel_text = optional_max(
        req.ziel_text.clone(),
        "Ziel",
        crate::nachforderung::ZIEL_TEXT_MAX,
    )?;
    // Adressat und Begründung werden An und Veranlassung des ETB-Eintrags (LFH-937, D2).
    if let Some(a) = trimme(&req.adressat_bezeichnung) {
        hoechstens(a, "Adressat", crate::etb::PARTEI_MAX)?;
    }
    if let Some(b) = trimme(&req.begruendung) {
        hoechstens(b, "Begründung", crate::etb::PARTEI_MAX)?;
    }
    if let Some(a) = req.anzahl {
        if a < 1 {
            return Err(AppError::Validation("Anzahl muss mindestens 1 sein".into()));
        }
    }
    let prioritaet = req
        .prioritaet
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(PRIO_NORMAL);
    if !crate::nachforderung::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let adressat = req.adressat_kategorie.trim();
    if !crate::nachforderung::adressat_kategorie_gueltig(adressat) {
        return Err(AppError::Validation("Ungültige Adressat-Kategorie".into()));
    }
    let angefordert = match trimme(&req.angefordert_at) {
        Some(a) => parse_zeit(a)?,
        None => jetzt(),
    };
    let benoetigt_bis = trimme(&req.benoetigt_bis).map(parse_zeit).transpose()?;
    // Der Zusammenhang (422) nach allen Feldprüfungen (400).
    let ziele = usize::from(req.ziel_br_id.is_some())
        + usize::from(req.ziel_abschnitt_id.is_some())
        + usize::from(ziel_text.is_some());
    if ziele > 1 {
        return Err(AppError::UnprocessableEntity(
            "Höchstens ein Ziel: Bereitstellungsraum, Einsatzabschnitt oder Ort".into(),
        ));
    }
    // Beide Zeiten sind normalisiert ('YYYY-MM-DD HH:MM:SS', UTC): der Textvergleich ordnet sie.
    if benoetigt_bis
        .as_deref()
        .is_some_and(|b| b < angefordert.as_str())
    {
        return Err(AppError::UnprocessableEntity(
            "„Benötigt bis“ liegt vor der Anforderung".into(),
        ));
    }
    if let Some(stelle_id) = req.betreuungsstelle_id {
        pruefe_betreuungsstelle(&state, &ctx, stelle_id).await?;
    }
    pruefe_ziel(&state, &ctx, req.ziel_br_id, req.ziel_abschnitt_id).await?;

    let n = repo::create(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        repo::NachforderungDaten {
            art: &art,
            bezeichnung: bezeichnung.as_deref(),
            anzahl: req.anzahl,
            adressat_kategorie: adressat,
            adressat_bezeichnung: trimme(&req.adressat_bezeichnung),
            begruendung: trimme(&req.begruendung),
            prioritaet,
            angefordert_at: &angefordert,
            betreuungsstelle_id: req.betreuungsstelle_id,
            ziel_br_id: req.ziel_br_id,
            ziel_abschnitt_id: req.ziel_abschnitt_id,
            ziel_text: ziel_text.as_deref(),
            benoetigt_bis: benoetigt_bis.as_deref(),
        },
    )
    .await?;

    // Erzeugte ETB-Meldung in den Live-Feed (wie Auftrag/Meldung) + nachforderung-Event.
    if let Some(etb_id) = n.etb_nachforderung_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(n)))
}

/// Gemeinsamer Vorlauf für Nachforderungs-Aktionen: Cross-Einsatz-Schutz (die Gates laufen
/// im Extractor).
async fn fordere_bearbeitbar(
    state: &AppState,
    einsatz_id: i64,
    nachforderung_id: i64,
) -> Result<(), AppError> {
    if !repo::belongs_to_einsatz(&state.pool, nachforderung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct StatusReq {
    pub status: String,
}

/// POST /api/einsaetze/{id}/nachforderungen/{nid}/status — Bedarfs-Status weiterschalten.
pub async fn status(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Nachforderungen>,
    PfadParam((_eid, nachforderung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<StatusReq>,
) -> Result<Json<NachforderungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    fordere_bearbeitbar(&state, einsatz_id, nachforderung_id).await?;
    let neu = req.status.trim();
    // Ablehnung und Zurückziehen haben je einen eigenen Pfad (mit Grund) — hier sauber abweisen
    // statt im Repo auf 400 zu fallen.
    if neu == STATUS_ABGELEHNT {
        return Err(AppError::UnprocessableEntity(
            "Ablehnung erfolgt über den /ablehnen-Endpoint".into(),
        ));
    }
    if neu == STATUS_ZURUECKGEZOGEN {
        return Err(AppError::UnprocessableEntity(
            "Zurückziehen erfolgt über den /zurueckziehen-Endpoint".into(),
        ));
    }
    let aktuell = repo::load(&state.pool, nachforderung_id).await?;
    if !crate::nachforderung::uebergang_erlaubt(aktuell.status.as_str(), neu) {
        return Err(AppError::UnprocessableEntity(format!(
            "Übergang {} → {neu} nicht erlaubt",
            aktuell.status.as_str()
        )));
    }
    // Was übernommen ist, ist da (LLH-1226, design.md D9): keine Rücknahme mit Materialposten.
    if aktuell.status.as_str() == STATUS_EINGETROFFEN
        && repo::has_material(&state.pool, nachforderung_id).await?
    {
        return Err(AppError::UnprocessableEntity(
            "Aus der Nachforderung ist Material übernommen".into(),
        ));
    }
    // Ebenso mit übernommenen Einheiten (LLH-1383, design.md D8).
    if aktuell.status.as_str() == STATUS_EINGETROFFEN
        && repo::has_einheiten(&state.pool, nachforderung_id).await?
    {
        return Err(AppError::UnprocessableEntity(
            "Aus der Nachforderung sind Einheiten übernommen".into(),
        ));
    }
    // Optimistische Sperre gegen TOCTOU: UPDATE greift nur bei unverändertem Bestandsstatus.
    // Der Wechsel schreibt im selben Commit seinen ETB-Eintrag (LLH-1104 D6).
    let Some(etb_id) = repo::update_status(
        &state.pool,
        nachforderung_id,
        ctx.benutzer.id,
        neu,
        aktuell.status.as_str(),
        &jetzt(),
    )
    .await?
    else {
        return Err(AppError::UnprocessableEntity(
            "Status wurde zwischenzeitlich geändert".into(),
        ));
    };
    let n = repo::load(&state.pool, nachforderung_id).await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse(&state, einsatz_id);
    // Das UPDATE hat den Status geändert (sonst 422 oben): Ersteller und S4 erfahren den Status,
    // den DIESE Anfrage gesetzt hat, nicht den inzwischen gelesenen.
    if let Some(gesetzt) = NachforderungStatus::parse(neu) {
        crate::nachforderung::benachrichtigung::status_gewechselt(
            &state.pool,
            &state.live,
            einsatz_id,
            nachforderung_id,
            gesetzt,
            n.erstellt_von_id,
            ctx.benutzer.id,
        )
        .await;
    }
    Ok(Json(n))
}

#[derive(Debug, Deserialize)]
pub struct AblehnenReq {
    pub grund: Option<String>,
}

/// POST /api/einsaetze/{id}/nachforderungen/{nid}/ablehnen — Abzweig „abgelehnt".
pub async fn ablehnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Nachforderungen>,
    PfadParam((_eid, nachforderung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<AblehnenReq>,
) -> Result<Json<NachforderungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    fordere_bearbeitbar(&state, einsatz_id, nachforderung_id).await?;
    let aktuell = repo::load(&state.pool, nachforderung_id).await?;
    if !crate::nachforderung::uebergang_erlaubt(aktuell.status.as_str(), STATUS_ABGELEHNT) {
        return Err(AppError::UnprocessableEntity(
            "Nachforderung kann in diesem Zustand nicht abgelehnt werden".into(),
        ));
    }
    let Some(etb_id) = repo::lehne_ab(
        &state.pool,
        nachforderung_id,
        ctx.benutzer.id,
        trimme(&req.grund),
        aktuell.status.as_str(),
        &jetzt(),
    )
    .await?
    else {
        return Err(AppError::UnprocessableEntity(
            "Status wurde zwischenzeitlich geändert".into(),
        ));
    };
    let n = repo::load(&state.pool, nachforderung_id).await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse(&state, einsatz_id);
    crate::nachforderung::benachrichtigung::status_gewechselt(
        &state.pool,
        &state.live,
        einsatz_id,
        nachforderung_id,
        NachforderungStatus::Abgelehnt,
        n.erstellt_von_id,
        ctx.benutzer.id,
    )
    .await;
    Ok(Json(n))
}

/// „Wer“ der Zusage (LLH-1097 design.md D2): getrimmt, leere fallen weg, höchstens
/// `ZUSAGE_RUFNAMEN_MAX` Einträge (gezählt vor dem Entdoppeln) mit je höchstens
/// `ZUSAGE_RUFNAME_MAX` Zeichen (400), entdoppelt in Eingabefolge.
fn pruefe_rufnamen(roh: &[String]) -> Result<Vec<String>, AppError> {
    if roh.len() > crate::nachforderung::ZUSAGE_RUFNAMEN_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {} Rufnamen",
            crate::nachforderung::ZUSAGE_RUFNAMEN_MAX
        )));
    }
    let mut rufnamen: Vec<String> = Vec::with_capacity(roh.len());
    for r in roh.iter().map(|r| r.trim()).filter(|r| !r.is_empty()) {
        hoechstens(r, "Rufname", crate::nachforderung::ZUSAGE_RUFNAME_MAX)?;
        if !rufnamen.iter().any(|x| x == r) {
            rufnamen.push(r.to_string());
        }
    }
    Ok(rufnamen)
}

#[derive(Debug, Deserialize)]
pub struct ZusageReq {
    /// Zugesagte Menge; fehlt = die angeforderte Anzahl (D1).
    #[serde(default)]
    pub anzahl: Option<i64>,
    /// „Wer“: Rufnamen oder freie Angaben (D2).
    #[serde(default)]
    pub rufnamen: Vec<String>,
    /// Voraussichtliches Eintreffen (UTC, D3); leer = ohne.
    #[serde(default)]
    pub eintreffen_erwartet_at: Option<String>,
}

/// POST /api/einsaetze/{id}/nachforderungen/{nid}/zusage — Zusage mit Menge, Rufnamen und
/// voraussichtlichem Eintreffen erfassen; eine Teilzusage teilt den Rest ab (LLH-1097 D1–D5).
pub async fn zusage(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Nachforderungen>,
    PfadParam((_eid, nachforderung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<ZusageReq>,
) -> Result<Json<NachforderungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if req.anzahl.is_some_and(|a| a < 1) {
        return Err(AppError::Validation("Anzahl muss mindestens 1 sein".into()));
    }
    let rufnamen = pruefe_rufnamen(&req.rufnamen)?;
    let eta = trimme(&req.eintreffen_erwartet_at)
        .map(parse_zeit)
        .transpose()?;
    // Den Zusammenhang (422) und den Bezug (404) prüft das Repo an der Zeile, in der Transaktion.
    let ergebnis = repo::sage_zu(
        &state.pool,
        einsatz_id,
        nachforderung_id,
        ctx.benutzer.id,
        &repo::ZusageDaten {
            anzahl: req.anzahl,
            rufnamen: &rufnamen,
            eintreffen_erwartet_at: eta.as_deref(),
        },
        &jetzt(),
    )
    .await?;
    let n = repo::load(&state.pool, nachforderung_id).await?;
    state.live.publiziere(einsatz_id, ergebnis.etb_id);
    sse(&state, einsatz_id);
    crate::nachforderung::benachrichtigung::status_gewechselt(
        &state.pool,
        &state.live,
        einsatz_id,
        nachforderung_id,
        NachforderungStatus::Zugesagt,
        n.erstellt_von_id,
        ctx.benutzer.id,
    )
    .await;
    Ok(Json(n))
}

#[derive(Debug, Deserialize)]
pub struct ZurueckziehenReq {
    pub grund: Option<String>,
}

/// POST /api/einsaetze/{id}/nachforderungen/{nid}/zurueckziehen — die eigene Führung zieht eine
/// offene Nachforderung zurück (terminal, LLH-1097 D8). Keine Benachrichtigung.
pub async fn zurueckziehen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Nachforderungen>,
    PfadParam((_eid, nachforderung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<ZurueckziehenReq>,
) -> Result<Json<NachforderungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let grund = optional_max(
        req.grund,
        "Grund",
        crate::nachforderung::ZURUECKZIEHEN_GRUND_MAX,
    )?;
    fordere_bearbeitbar(&state, einsatz_id, nachforderung_id).await?;
    let aktuell = repo::load(&state.pool, nachforderung_id).await?;
    if !crate::nachforderung::uebergang_erlaubt(aktuell.status.as_str(), STATUS_ZURUECKGEZOGEN) {
        return Err(AppError::UnprocessableEntity(
            "Nachforderung kann in diesem Zustand nicht zurückgezogen werden".into(),
        ));
    }
    let Some(etb_id) = repo::ziehe_zurueck(
        &state.pool,
        nachforderung_id,
        ctx.benutzer.id,
        grund.as_deref(),
        aktuell.status.as_str(),
        &jetzt(),
    )
    .await?
    else {
        return Err(AppError::UnprocessableEntity(
            "Status wurde zwischenzeitlich geändert".into(),
        ));
    };
    let n = repo::load(&state.pool, nachforderung_id).await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse(&state, einsatz_id);
    Ok(Json(n))
}

/// PATCH-Body (LLH-1097 D9): jedes Feld fehlt = unverändert. Steht eines der drei Zielfelder im
/// Body, ersetzt er das ganze Ziel (fehlende werden leer).
#[derive(Debug, Deserialize)]
pub struct PatchNachforderung {
    #[serde(default)]
    pub anzahl: Option<i64>,
    #[serde(default)]
    pub prioritaet: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    pub bezeichnung: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    pub ziel_br_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    pub ziel_abschnitt_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    pub ziel_text: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    pub eintreffen_erwartet_at: Option<Option<String>>,
    #[serde(default)]
    pub rufnamen: Option<Vec<String>>,
}

/// PATCH /api/einsaetze/{id}/nachforderungen/{nid} — eine offene Nachforderung bearbeiten:
/// Anzahl, Ziel, Priorität, Details; in zugesagt/unterwegs auch Wer und Eintreffen (D9). Die Art
/// bleibt. Ohne wirksame Änderung 200 mit dem Stand, ohne ETB.
pub async fn bearbeiten(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Nachforderungen>,
    PfadParam((_eid, nachforderung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<PatchNachforderung>,
) -> Result<Json<NachforderungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // 400: die Felder für sich, mit denselben Grenzen wie beim Anlegen.
    if req.anzahl.is_some_and(|a| a < 1) {
        return Err(AppError::Validation("Anzahl muss mindestens 1 sein".into()));
    }
    let prioritaet = req
        .prioritaet
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    if prioritaet.is_some_and(|p| !crate::nachforderung::prioritaet_gueltig(p)) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let bezeichnung = support::optional_max_tri(
        req.bezeichnung,
        "Details",
        crate::nachforderung::BEZEICHNUNG_MAX,
    )?;
    let ziel_text =
        support::optional_max_tri(req.ziel_text, "Ziel", crate::nachforderung::ZIEL_TEXT_MAX)?;
    let eta = support::trimme_tri(req.eintreffen_erwartet_at)
        .map(|e| e.as_deref().map(parse_zeit).transpose())
        .transpose()?;
    let rufnamen = req.rufnamen.as_deref().map(pruefe_rufnamen).transpose()?;
    // 422: der Zusammenhang; dann der Bezug des neuen Ziels (403/404/409), nur wenn es sich ändert.
    let ziel_im_body =
        req.ziel_br_id.is_some() || req.ziel_abschnitt_id.is_some() || ziel_text.is_some();
    let ziel = ziel_im_body.then(|| repo::Ziel {
        br_id: req.ziel_br_id.flatten(),
        abschnitt_id: req.ziel_abschnitt_id.flatten(),
        text: ziel_text.as_ref().and_then(|t| t.as_deref()),
    });
    if let Some(z) = ziel {
        let ziele = usize::from(z.br_id.is_some())
            + usize::from(z.abschnitt_id.is_some())
            + usize::from(z.text.is_some());
        if ziele > 1 {
            return Err(AppError::UnprocessableEntity(
                "Höchstens ein Ziel: Bereitstellungsraum, Einsatzabschnitt oder Ort".into(),
            ));
        }
    }
    fordere_bearbeitbar(&state, einsatz_id, nachforderung_id).await?;
    if let Some(z) = ziel {
        pruefe_ziel(&state, &ctx, z.br_id, z.abschnitt_id).await?;
    }
    let etb_id = repo::aktualisiere(
        &state.pool,
        einsatz_id,
        nachforderung_id,
        ctx.benutzer.id,
        &repo::Aenderung {
            anzahl: req.anzahl,
            prioritaet,
            bezeichnung: bezeichnung.as_ref().map(|b| b.as_deref()),
            ziel,
            eintreffen_erwartet_at: eta.as_ref().map(|e| e.as_deref()),
            rufnamen: rufnamen.as_deref(),
        },
    )
    .await?;
    let n = repo::load(&state.pool, nachforderung_id).await?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
        sse(&state, einsatz_id);
    }
    Ok(Json(n))
}
