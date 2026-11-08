//! Routen des Schichtplans eines Einsatzes (LLH-1552, Spec `kraefte-schichtplan`): Blöcke an
//! Einheiten, UHS und der Zeile „Pause“, Helfer des Plans, „Schichten erzeugen“ und die
//! Grenzwerte des Dienst-Befunds. Pfade unter `/api/einsaetze/{id}/abloesungen/schichtplan`.
//!
//! Gates wie die Ablösung (`EinsatzLesezugriff<Abloesung>`, `EinsatzSchreibzugriff<Abloesung>`).
//! Nach den Feldprüfungen (400) verlangt der Handler die Zusatzmodule: Einheiten für einen
//! Einheiten-Posten, Unfallhilfsstellen für einen UHS-Posten, Personal sobald Personen oder
//! Helfer geschrieben werden (403). Lesen ohne Personal liefert keine Namen (`personen: null`).
//! Jeder wirksame Schreibweg veröffentlicht `LiveEvent::Abloesung`; ETB nur für „Schichten
//! erzeugen“ und geänderte Grenzwerte. Geänderte Grenzwerte melden zusätzlich `Einheit` und
//! `Personal`, weil die Kräfte-Zeitachse sie auch ohne das Modul Ablösung einstuft (LLH-730).

use axum::extract::{Multipart, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::abloesung::schichtplan::repo::{
    self, BlockEingabe, BlockPatch, HelferEingabe, HelferPatch,
};
use crate::abloesung::schichtplan::uebernahme::{
    self, repo::Rechte, Entscheidungen, ImportErgebnis, ImportMeldung, ImportVorschau, PlanPaket,
    ENTSCHEIDUNGEN_MAX,
};
use crate::abloesung::schichtplan::vollzug::{
    self, PlanWechselAnzeige, WechselArt, WechselEingabe, WechselVorlage, WechselWirkung,
};
use crate::abloesung::schichtplan::{
    zerlegung, PlanHelferAnzeige, PlanPerson, PlanPersonEingabe, Posten, PostenEingabe,
    SchichtplanAnzeige, BLOCK_MIN_MINUTEN, HELFER_QUALIFIKATIONEN_MAX, HELFER_TELEFON_MAX,
    HELFER_TEXT_MAX, MAX_DIENST_BEREICH, MIN_RUHE_BEREICH, NOTIZ_MAX, PLAN_PERSONEN_MAX,
    SOLL_ANZAHL_MAX,
};
use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzKontext, EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Abloesung, Einheiten, Personal, Unfallhilfsstellen};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::personal::quali_soll::{self, QualiSollEingabe};
use crate::routes::support;
use crate::zeit::jetzt;

/// Nach einem wirksamen Schreibweg: ETB-Kurzruf (falls ein Satz entstand) und Listen-Refresh.
fn publiziere(state: &AppState, einsatz_id: i64, etb_id: Option<i64>) {
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    super::abloesung::sse(state, einsatz_id);
}

/// Ob der Benutzer die Personen des Plans sehen darf (Freigabe Personal).
async fn mit_personen(state: &AppState, ctx: &EinsatzKontext) -> Result<bool, AppError> {
    match ctx.fordere_zielmodul::<Personal>(&state.pool).await {
        Ok(()) => Ok(true),
        Err(AppError::Forbidden) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Das Zusatzmodul eines Postens (403 ohne Freigabe). Die Pause braucht keins.
async fn fordere_posten_modul(
    state: &AppState,
    ctx: &EinsatzKontext,
    posten: Posten,
) -> Result<(), AppError> {
    match posten {
        Posten::Einheit(_) => ctx.fordere_zielmodul::<Einheiten>(&state.pool).await,
        Posten::Uhs(_) => {
            ctx.fordere_zielmodul::<Unfallhilfsstellen>(&state.pool)
                .await
        }
        Posten::Pause => Ok(()),
    }
}

async fn plan(state: &AppState, ctx: &EinsatzKontext) -> Result<SchichtplanAnzeige, AppError> {
    let mit = mit_personen(state, ctx).await?;
    repo::laden(
        &state.pool,
        ctx.einsatz.id,
        ctx.einsatz.org_id,
        mit,
        &jetzt(),
    )
    .await
}

/// Ein Zeitpunkt des Plans: normalisiert, im Jahresbereich, auf dem 5-Minuten-Raster (400).
pub(crate) fn planzeit(wert: &str, was: &str) -> Result<String, AppError> {
    let normal = crate::zeit::im_jahresbereich(crate::etb::normalisiere_zeit(wert.trim())?, was)?;
    let t = crate::zeit::parse_utc(&normal)
        .ok_or_else(|| AppError::Validation(format!("Ungültiger Zeitpunkt '{wert}'")))?;
    if !zerlegung::im_raster(t) {
        return Err(AppError::Validation(format!(
            "{was}: volle {} Minuten",
            crate::abloesung::schichtplan::RASTER_MINUTEN
        )));
    }
    Ok(normal)
}

/// Beginn und Ende eines Blocks als Feldprüfung (400): Raster, 10 min bis 24 h.
pub(crate) fn zeitraum(von: &str, bis: &str) -> Result<(String, String), AppError> {
    let (von, bis) = (planzeit(von, "Beginn")?, planzeit(bis, "Ende")?);
    let (a, b) = (
        crate::zeit::parse_utc(&von).ok_or_else(|| AppError::Validation("Beginn".into()))?,
        crate::zeit::parse_utc(&bis).ok_or_else(|| AppError::Validation("Ende".into()))?,
    );
    zerlegung::pruefe_zeitraum(a, b)?;
    Ok((von, bis))
}

/// Personen eines Blocks von außen: höchstens [`PLAN_PERSONEN_MAX`] vor dem Entdoppeln (400),
/// entdoppelt in ihrer Reihenfolge.
fn personen(liste: Vec<PlanPersonEingabe>) -> Result<Vec<PlanPerson>, AppError> {
    if liste.len() > PLAN_PERSONEN_MAX {
        return Err(AppError::Validation(format!(
            "personen: höchstens {PLAN_PERSONEN_MAX} Personen"
        )));
    }
    let personen: Vec<PlanPerson> = liste.into_iter().map(PlanPerson::from).collect();
    Ok(crate::kraefte_disposition::dedupe(&personen, |p| *p))
}

pub(crate) fn soll_anzahl(wert: Option<Option<i64>>) -> Result<Option<Option<i64>>, AppError> {
    if let Some(Some(n)) = wert {
        if !(1..=SOLL_ANZAHL_MAX).contains(&n) {
            return Err(AppError::Validation(format!(
                "soll_anzahl: 1 bis {SOLL_ANZAHL_MAX}"
            )));
        }
    }
    Ok(wert)
}

/// Qualifikationen eines Helfers: höchstens [`HELFER_QUALIFIKATIONEN_MAX`] vor dem Entdoppeln.
pub(crate) fn qualifikationen(ids: &[i64]) -> Result<Vec<i64>, AppError> {
    if ids.len() > HELFER_QUALIFIKATIONEN_MAX {
        return Err(AppError::Validation(format!(
            "qualifikationen: höchstens {HELFER_QUALIFIKATIONEN_MAX}"
        )));
    }
    Ok(crate::kraefte_disposition::dedupe(ids, |id| *id))
}

pub(crate) fn grenzwert(
    wert: Option<Option<i64>>,
    feld: &str,
    bereich: std::ops::RangeInclusive<i64>,
) -> Result<Option<Option<i64>>, AppError> {
    if let Some(Some(n)) = wert {
        if !bereich.contains(&n) {
            return Err(AppError::Validation(format!(
                "{feld}: {} bis {} Minuten",
                bereich.start(),
                bereich.end()
            )));
        }
    }
    Ok(wert)
}

/// GET /api/einsaetze/{id}/abloesungen/schichtplan
pub async fn lesen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Abloesung>,
) -> Result<Json<SchichtplanAnzeige>, AppError> {
    Ok(Json(plan(&state, &ctx).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockAnlegen {
    posten: PostenEingabe,
    von: String,
    bis: String,
    /// Fehlt = Vorgabe des Postens, `null` = kein Soll.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    soll_anzahl: Option<Option<i64>>,
    /// Fehlt = Vorgabe des Postens, `null` oder `[]` = kein Soll.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    quali_soll: Option<Option<Vec<QualiSollEingabe>>>,
    #[serde(default)]
    personen: Vec<PlanPersonEingabe>,
    #[serde(default)]
    notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/abloesungen/schichtplan/bloecke — liefert den ganzen Plan.
pub async fn block_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    JsonBody(req): JsonBody<BlockAnlegen>,
) -> Result<(StatusCode, Json<SchichtplanAnzeige>), AppError> {
    let posten = Posten::from(req.posten);
    let (von, bis) = zeitraum(&req.von, &req.bis)?;
    let eingabe = BlockEingabe {
        posten,
        von,
        bis,
        soll_anzahl: soll_anzahl(req.soll_anzahl)?,
        quali_soll: quali_soll::form_tri(req.quali_soll)?,
        personen: personen(req.personen)?,
        notiz: support::optional_max(req.notiz, "notiz", NOTIZ_MAX)?,
    };
    fordere_posten_modul(&state, &ctx, posten).await?;
    if !eingabe.personen.is_empty() {
        ctx.fordere_zielmodul::<Personal>(&state.pool).await?;
    }
    repo::block_anlegen(
        &state.pool,
        ctx.einsatz.id,
        ctx.benutzer.id,
        &eingabe,
        &jetzt(),
    )
    .await?;
    publiziere(&state, ctx.einsatz.id, None);
    Ok((StatusCode::CREATED, Json(plan(&state, &ctx).await?)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockAendern {
    version: Option<i64>,
    #[serde(default)]
    posten: Option<PostenEingabe>,
    #[serde(default)]
    von: Option<String>,
    #[serde(default)]
    bis: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    soll_anzahl: Option<Option<i64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    quali_soll: Option<Option<Vec<QualiSollEingabe>>>,
    /// Die ganze Liste; fehlt = unverändert.
    #[serde(default)]
    personen: Option<Vec<PlanPersonEingabe>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    notiz: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/abloesungen/schichtplan/bloecke/{bid} — Zeit, Posten (Verschieben
/// in eine andere Zeile), Soll, Personen, Notiz; CAS über `version` (409).
pub async fn block_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<BlockAendern>,
) -> Result<Json<SchichtplanAnzeige>, AppError> {
    let version = req
        .version
        .ok_or_else(|| AppError::Validation("version fehlt".into()))?;
    let (von, bis) = match (req.von.as_deref(), req.bis.as_deref()) {
        (Some(v), Some(b)) => {
            let (v, b) = zeitraum(v, b)?;
            (Some(v), Some(b))
        }
        (v, b) => (
            v.map(|v| planzeit(v, "Beginn")).transpose()?,
            b.map(|b| planzeit(b, "Ende")).transpose()?,
        ),
    };
    let patch = BlockPatch {
        version,
        posten: req.posten.map(Posten::from),
        von,
        bis,
        soll_anzahl: soll_anzahl(req.soll_anzahl)?,
        quali_soll: quali_soll::form_tri(req.quali_soll)?,
        personen: req.personen.map(personen).transpose()?,
        notiz: support::optional_max_tri(req.notiz, "notiz", NOTIZ_MAX)?,
    };
    let bisher = repo::posten_von(&state.pool, ctx.einsatz.id, bid).await?;
    fordere_posten_modul(&state, &ctx, bisher).await?;
    if let Some(neu) = patch.posten {
        fordere_posten_modul(&state, &ctx, neu).await?;
    }
    if patch.personen.is_some() {
        ctx.fordere_zielmodul::<Personal>(&state.pool).await?;
    }
    repo::block_aendern(
        &state.pool,
        ctx.einsatz.id,
        bid,
        ctx.benutzer.id,
        &patch,
        &jetzt(),
    )
    .await?;
    publiziere(&state, ctx.einsatz.id, None);
    Ok(Json(plan(&state, &ctx).await?))
}

#[derive(Debug, Deserialize)]
pub struct VersionParams {
    #[serde(default)]
    version: Option<i64>,
}

/// DELETE /api/einsaetze/{id}/abloesungen/schichtplan/bloecke/{bid}?version=… (409 bei
/// veraltetem Stand). Einen belegten Block löscht nur, wer Personal darf (403).
pub async fn block_loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
    Query(params): Query<VersionParams>,
) -> Result<StatusCode, AppError> {
    let version = params
        .version
        .ok_or_else(|| AppError::Validation("version fehlt".into()))?;
    let posten = repo::posten_von(&state.pool, ctx.einsatz.id, bid).await?;
    fordere_posten_modul(&state, &ctx, posten).await?;
    // Ein belegter Block nimmt mit dem Löschen Einteilungen weg: das verlangt Personal, geprüft
    // in der Transaktion gegen den Stand von `version`.
    let darf_personen = mit_personen(&state, &ctx).await?;
    repo::block_loeschen(
        &state.pool,
        ctx.einsatz.id,
        bid,
        ctx.benutzer.id,
        version,
        darf_personen,
        &jetzt(),
    )
    .await?;
    publiziere(&state, ctx.einsatz.id, None);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Erzeugen {
    posten: PostenEingabe,
    von: String,
    bis: String,
    /// Länge je Schicht; fehlt = Schichtmodell des Einsatzes.
    #[serde(default)]
    laenge_minuten: Option<i64>,
}

/// POST /api/einsaetze/{id}/abloesungen/schichtplan/erzeugen — füllt den Zeitraum am Posten mit
/// Schichten (alles oder nichts, ein ETB-Satz). Liefert den ganzen Plan.
pub async fn erzeugen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    JsonBody(req): JsonBody<Erzeugen>,
) -> Result<(StatusCode, Json<SchichtplanAnzeige>), AppError> {
    let posten = Posten::from(req.posten);
    let von = planzeit(&req.von, "Beginn")?;
    let bis = planzeit(&req.bis, "Ende")?;
    // Ein Zeitraum unter der Mindestlänge ergäbe einen zu kurzen Block; länger als 24 h darf er
    // sein, er wird zerlegt.
    let dauer = crate::zeit::parse_utc(&bis)
        .zip(crate::zeit::parse_utc(&von))
        .map(|(b, v)| (b - v).num_minutes());
    if !dauer.is_some_and(|m| m >= BLOCK_MIN_MINUTEN) {
        return Err(AppError::Validation(format!(
            "Der Zeitraum dauert mindestens {BLOCK_MIN_MINUTEN} Minuten"
        )));
    }
    let laenge = req
        .laenge_minuten
        .map(zerlegung::pruefe_laenge)
        .transpose()?;
    fordere_posten_modul(&state, &ctx, posten).await?;
    let (_ids, etb_id) = repo::erzeugen(
        &state.pool,
        ctx.einsatz.id,
        ctx.benutzer.id,
        posten,
        &von,
        &bis,
        laenge,
        &jetzt(),
    )
    .await?;
    publiziere(&state, ctx.einsatz.id, Some(etb_id));
    Ok((StatusCode::CREATED, Json(plan(&state, &ctx).await?)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grenzwerte {
    /// Tri-State: fehlt = unverändert, `null` = Vorgabe (720 min).
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    max_dienst_minuten: Option<Option<i64>>,
    /// Tri-State: fehlt = unverändert, `null` = Vorgabe (480 min).
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    min_ruhe_minuten: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/abloesungen/schichtplan/grenzwerte — Grenzwerte des
/// Dienst-Befunds. Liefert den ganzen Plan (die Befunde ändern sich mit).
pub async fn grenzwerte_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    JsonBody(req): JsonBody<Grenzwerte>,
) -> Result<Json<SchichtplanAnzeige>, AppError> {
    let max = grenzwert(
        req.max_dienst_minuten,
        "max_dienst_minuten",
        MAX_DIENST_BEREICH,
    )?;
    let ruhe = grenzwert(req.min_ruhe_minuten, "min_ruhe_minuten", MIN_RUHE_BEREICH)?;
    let etb_id = repo::grenzwerte_setzen(
        &state.pool,
        ctx.einsatz.id,
        ctx.benutzer.id,
        max,
        ruhe,
        &jetzt(),
    )
    .await?;
    if etb_id.is_some() {
        publiziere(&state, ctx.einsatz.id, etb_id);
        // Dieselben Werte stuft die Kräfte-Zeitachse in Meldebild und Personalliste ein (LLH-730).
        // `abloesung` erreicht nur Leser des Moduls Ablösung; `einheit` und `personal` frischen
        // die Grenzwerte (Prefix der Kräfte-Zeitachse im Client) auch für alle anderen auf.
        state
            .live
            .publiziere_einsatz(ctx.einsatz.id, crate::live::LiveEvent::Einheit);
        state
            .live
            .publiziere_einsatz(ctx.einsatz.id, crate::live::LiveEvent::Personal);
    }
    Ok(Json(plan(&state, &ctx).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HelferAnlegen {
    name: String,
    #[serde(default)]
    telefon: Option<String>,
    #[serde(default)]
    organisation: Option<String>,
    #[serde(default)]
    qualifikationen: Vec<i64>,
}

/// POST /api/einsaetze/{id}/abloesungen/schichtplan/helfer
pub async fn helfer_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    JsonBody(req): JsonBody<HelferAnlegen>,
) -> Result<(StatusCode, Json<PlanHelferAnzeige>), AppError> {
    let eingabe = HelferEingabe {
        name: support::pflicht_max(&req.name, "name", HELFER_TEXT_MAX)?,
        telefon: support::optional_max(req.telefon, "telefon", HELFER_TELEFON_MAX)?,
        organisation: support::optional_max(req.organisation, "organisation", HELFER_TEXT_MAX)?,
        qualifikationen: qualifikationen(&req.qualifikationen)?,
    };
    ctx.fordere_zielmodul::<Personal>(&state.pool).await?;
    let helfer =
        repo::helfer_anlegen(&state.pool, ctx.einsatz.id, ctx.benutzer.id, &eingabe).await?;
    publiziere(&state, ctx.einsatz.id, None);
    Ok((StatusCode::CREATED, Json(helfer)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HelferAendern {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    telefon: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    organisation: Option<Option<String>>,
    #[serde(default)]
    qualifikationen: Option<Vec<i64>>,
}

/// PATCH /api/einsaetze/{id}/abloesungen/schichtplan/helfer/{hid}
pub async fn helfer_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, hid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<HelferAendern>,
) -> Result<Json<PlanHelferAnzeige>, AppError> {
    let patch = HelferPatch {
        name: support::pflicht_max_tri(req.name.as_deref(), "name", HELFER_TEXT_MAX)?,
        telefon: support::optional_max_tri(req.telefon, "telefon", HELFER_TELEFON_MAX)?,
        organisation: support::optional_max_tri(req.organisation, "organisation", HELFER_TEXT_MAX)?,
        qualifikationen: req
            .qualifikationen
            .as_deref()
            .map(qualifikationen)
            .transpose()?,
    };
    ctx.fordere_zielmodul::<Personal>(&state.pool).await?;
    let helfer = repo::helfer_aendern(&state.pool, ctx.einsatz.id, hid, &patch).await?;
    publiziere(&state, ctx.einsatz.id, None);
    Ok(Json(helfer))
}

/// DELETE /api/einsaetze/{id}/abloesungen/schichtplan/helfer/{hid} — nimmt den Helfer aus allen
/// Blöcken.
pub async fn helfer_loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, hid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    ctx.fordere_zielmodul::<Personal>(&state.pool).await?;
    repo::helfer_loeschen(&state.pool, ctx.einsatz.id, hid, ctx.benutzer.id, &jetzt()).await?;
    publiziere(&state, ctx.einsatz.id, None);
    Ok(StatusCode::NO_CONTENT)
}

/// Live nach einem Wechsel oder seiner Rücknahme: ETB, Plan und Ablösung, UHS und Kräfte.
fn publiziere_wechsel(state: &AppState, einsatz_id: i64, wirkung: &WechselWirkung) {
    publiziere(state, einsatz_id, Some(wirkung.etb_id));
    for uhs_id in crate::kraefte_disposition::dedupe(&wirkung.uhs, |id| *id) {
        super::einsatz_uhs::sse_uhs(state, einsatz_id, uhs_id);
    }
    for ep_id in crate::kraefte_disposition::dedupe(&wirkung.personen, |id| *id) {
        super::einsatz_personal::sse_personal(state, einsatz_id, ep_id);
    }
}

/// Die Module eines Wechsels: Personal immer (er nennt und ändert Kräfte), an der UHS dazu
/// Unfallhilfsstellen (403).
async fn fordere_wechsel_module(
    state: &AppState,
    ctx: &EinsatzKontext,
    art: WechselArt,
) -> Result<(), AppError> {
    if art == WechselArt::Uhs {
        ctx.fordere_zielmodul::<Unfallhilfsstellen>(&state.pool)
            .await?;
    }
    ctx.fordere_zielmodul::<Personal>(&state.pool).await
}

/// GET /api/einsaetze/{id}/abloesungen/schichtplan/bloecke/{bid}/wechsel — der nächste Wechsel
/// eines UHS- oder Pausenblocks zum Vorbelegen (LLH-1555). Nennt Personen: Personal, an der UHS
/// dazu Unfallhilfsstellen (403); ein Block an einer Einheit ist 422.
pub async fn wechsel_vorlage(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Abloesung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
) -> Result<Json<WechselVorlage>, AppError> {
    let art = match repo::posten_von(&state.pool, ctx.einsatz.id, bid).await? {
        Posten::Uhs(_) => WechselArt::Uhs,
        _ => WechselArt::PauseBeginn,
    };
    fordere_wechsel_module(&state, &ctx, art).await?;
    Ok(Json(
        vollzug::vorlage(&state.pool, ctx.einsatz.id, bid).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WechselVollziehen {
    /// `uhs` | `pause_beginn` | `pause_ende`; als `String`, damit ein unbekannter Wert eine
    /// benannte 400 liefert.
    art: String,
    /// Nur an der UHS; fehlt = jetzt.
    #[serde(default)]
    vollzogen_at: Option<String>,
    /// Nur an der UHS: Personen aus dem Plan, die kommen.
    #[serde(default)]
    kommen: Vec<PlanPersonEingabe>,
    /// Nur an der UHS: Kräfte des Einsatzes, die gehen.
    #[serde(default)]
    gehen: Vec<i64>,
}

/// Der Body eines Wechsels als Eingabe (400 bei falscher Art, Feldern an der Pause oder zu vielen
/// Personen).
fn wechsel_eingabe(req: WechselVollziehen, jetzt: &str) -> Result<WechselEingabe, AppError> {
    let art = WechselArt::parse(&req.art).ok_or_else(|| {
        AppError::Validation(format!("Ungültige Art eines Wechsels: {}", req.art))
    })?;
    if art != WechselArt::Uhs
        && (req.vollzogen_at.is_some() || !req.kommen.is_empty() || !req.gehen.is_empty())
    {
        return Err(AppError::Validation(
            "vollzogen_at, kommen und gehen gelten nur an der UHS".into(),
        ));
    }
    Ok(match art {
        WechselArt::Uhs => {
            if req.gehen.len() > PLAN_PERSONEN_MAX {
                return Err(AppError::Validation(format!(
                    "gehen: höchstens {PLAN_PERSONEN_MAX} Personen"
                )));
            }
            let vollzogen_at = match req.vollzogen_at.as_deref().map(str::trim) {
                Some(s) if !s.is_empty() => {
                    crate::zeit::im_jahresbereich(crate::etb::normalisiere_zeit(s)?, "Vollzug")?
                }
                _ => jetzt.to_string(),
            };
            WechselEingabe::Uhs {
                vollzogen_at,
                kommen: personen(req.kommen)?,
                gehen: crate::kraefte_disposition::dedupe(&req.gehen, |id| *id),
            }
        }
        WechselArt::PauseBeginn => WechselEingabe::PauseBeginn,
        WechselArt::PauseEnde => WechselEingabe::PauseEnde,
    })
}

/// POST /api/einsaetze/{id}/abloesungen/schichtplan/bloecke/{bid}/wechsel — vollzieht den
/// Wechsel an der UHS, Beginn oder Ende der Pause (LLH-1555, design.md D6/D7). 409, wenn er
/// schon vollzogen ist; 422, wenn der Posten nicht passt, kein Status als Pause gekennzeichnet
/// ist oder die Pause nicht begonnen hat.
pub async fn wechsel_vollziehen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, bid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<WechselVollziehen>,
) -> Result<(StatusCode, Json<PlanWechselAnzeige>), AppError> {
    let jetzt = jetzt();
    let eingabe = wechsel_eingabe(req, &jetzt)?;
    repo::posten_von(&state.pool, ctx.einsatz.id, bid).await?;
    fordere_wechsel_module(&state, &ctx, eingabe.art()).await?;
    let (anzeige, wirkung) = vollzug::vollziehen(
        &state.pool,
        ctx.einsatz.id,
        bid,
        ctx.benutzer.id,
        &eingabe,
        &jetzt,
    )
    .await?;
    publiziere_wechsel(&state, ctx.einsatz.id, &wirkung);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// POST /api/einsaetze/{id}/abloesungen/schichtplan/wechsel/{wid}/zuruecknehmen — legt zurück,
/// was noch den Stand des Wechsels trägt (409, wenn schon zurückgenommen).
pub async fn wechsel_zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, wid)): PfadParam<(i64, i64)>,
) -> Result<Json<PlanWechselAnzeige>, AppError> {
    let art = vollzug::art_von(&state.pool, ctx.einsatz.id, wid).await?;
    fordere_wechsel_module(&state, &ctx, art).await?;
    let (anzeige, wirkung) =
        vollzug::zuruecknehmen(&state.pool, ctx.einsatz.id, wid, ctx.benutzer.id, &jetzt()).await?;
    publiziere_wechsel(&state, ctx.einsatz.id, &wirkung);
    Ok(Json(anzeige))
}

// ---------------------------------------------------------------------------------------------
// Schichtplan einlesen (LLH-1556)
// ---------------------------------------------------------------------------------------------

/// Die Teile einer Einlese-Anfrage: `datei` (die Tabelle) und optional `entscheidungen` (JSON).
/// Ein anderes Feld, eine zweite Datei oder ungültiges JSON ist 400.
async fn lies_einlese_anfrage(
    multipart: &mut Multipart,
) -> Result<(Vec<u8>, Entscheidungen), AppError> {
    let mut datei: Option<Vec<u8>> = None;
    let mut entscheidungen: Option<Entscheidungen> = None;
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        match feld.name() {
            Some("datei") => {
                if datei.is_some() {
                    return Err(AppError::Validation("Genau eine Datei".into()));
                }
                let bytes = feld.bytes().await.map_err(|e| {
                    AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}"))
                })?;
                datei = Some(bytes.to_vec());
            }
            Some("entscheidungen") => {
                if entscheidungen.is_some() {
                    return Err(AppError::Validation("entscheidungen doppelt".into()));
                }
                let text = feld
                    .text()
                    .await
                    .map_err(|e| AppError::Validation(format!("entscheidungen: {e}")))?;
                let e: Entscheidungen = serde_json::from_str(&text)
                    .map_err(|e| AppError::Validation(format!("entscheidungen: {e}")))?;
                if e.posten.len() > ENTSCHEIDUNGEN_MAX || e.personen.len() > ENTSCHEIDUNGEN_MAX {
                    return Err(AppError::Validation(format!(
                        "entscheidungen: höchstens {ENTSCHEIDUNGEN_MAX} je Art"
                    )));
                }
                entscheidungen = Some(e);
            }
            andere => {
                return Err(AppError::Validation(format!(
                    "Unbekanntes Feld '{}'",
                    andere.unwrap_or_default()
                )))
            }
        }
    }
    let datei = datei.ok_or_else(|| AppError::Validation("Keine Datei im Upload".into()))?;
    Ok((datei, entscheidungen.unwrap_or_default()))
}

/// Ob ein Modul freigegeben ist (403 heißt nein).
async fn darf<M: crate::einsatz::modul::ModulMarker>(
    state: &AppState,
    ctx: &EinsatzKontext,
) -> Result<bool, AppError> {
    match ctx.fordere_zielmodul::<M>(&state.pool).await {
        Ok(()) => Ok(true),
        Err(AppError::Forbidden) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Gemeinsamer Anfang beider Einlese-Routen: Personal (403), Anfrage und Datei lesen (400),
/// Rechte für Posten.
async fn einlesen_vorbereiten(
    state: &AppState,
    ctx: &EinsatzKontext,
    multipart: &mut Multipart,
) -> Result<(PlanPaket, Vec<ImportMeldung>, Entscheidungen, Rechte), AppError> {
    // Die Vorschau zeigt Namen: ohne Personal nichts lesen (403 vor der Datei).
    ctx.fordere_zielmodul::<Personal>(&state.pool).await?;
    let (datei, entscheidungen) = lies_einlese_anfrage(multipart).await?;
    let stil = crate::zeitdarstellung::zeitstil_laden(&state.pool, ctx.einsatz.id).await?;
    // Entpacken und Parsen (XLSX bis 2 MiB, 5.000 Zeilen) außerhalb der Async-Worker.
    let zone = stil.zone;
    let (paket, meldungen) =
        tokio::task::spawn_blocking(move || uebernahme::datei::lies_paket(&datei, zone))
            .await
            .map_err(|e| AppError::Internal(format!("Einlesen der Schichtplan-Datei: {e}")))??;
    let rechte = Rechte {
        einheiten: darf::<Einheiten>(state, ctx).await?,
        uhs: darf::<Unfallhilfsstellen>(state, ctx).await?,
    };
    Ok((paket, meldungen, entscheidungen, rechte))
}

/// POST /api/einsaetze/{id}/abloesungen/schichtplan/import/vorschau — Multipart mit `datei` und
/// optional `entscheidungen`. Gleicht ab und schreibt nichts; Fehler stehen in der Antwort (200).
/// Eine unlesbare Datei ist 400.
pub async fn import_vorschau(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    mut multipart: Multipart,
) -> Result<Json<ImportVorschau>, AppError> {
    let (paket, meldungen, entscheidungen, rechte) =
        einlesen_vorbereiten(&state, &ctx, &mut multipart).await?;
    Ok(Json(
        uebernahme::repo::vorschau(
            &state.pool,
            ctx.einsatz.id,
            ctx.einsatz.org_id,
            &paket,
            meldungen,
            &entscheidungen,
            rechte,
        )
        .await?,
    ))
}

/// POST /api/einsaetze/{id}/abloesungen/schichtplan/import — wie die Vorschau, schreibt aber in
/// EINER Transaktion (alles oder nichts). Fehler der Planung: 422 mit Zeilen der Datei; ein
/// neuer Posten ohne Freigabe seines Moduls: 403. Ein zweiter Lauf derselben Datei ändert
/// nichts (kein ETB, kein Live-Ereignis). Liefert die Zählung und den ganzen Plan.
pub async fn import_uebernehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    mut multipart: Multipart,
) -> Result<Json<ImportErgebnis>, AppError> {
    let (paket, meldungen, entscheidungen, rechte) =
        einlesen_vorbereiten(&state, &ctx, &mut multipart).await?;
    let einsatz_id = ctx.einsatz.id;
    let geschrieben = uebernahme::repo::uebernehmen(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        ctx.benutzer.id,
        &paket,
        &meldungen,
        &entscheidungen,
        rechte,
        &jetzt(),
    )
    .await?;
    if geschrieben.zaehlung.aenderungen > 0 {
        for etb_id in &geschrieben.etb_ids {
            state.live.publiziere(einsatz_id, *etb_id);
        }
        for id in &geschrieben.einheit_ids {
            super::einsatz_einheit::sse_einheit(&state, einsatz_id, *id);
        }
        for id in &geschrieben.uhs_ids {
            super::einsatz_uhs::sse_uhs(&state, einsatz_id, *id);
        }
        super::abloesung::sse(&state, einsatz_id);
    }
    Ok(Json(ImportErgebnis {
        zaehlung: geschrieben.zaehlung,
        plan: plan(&state, &ctx).await?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planzeit_verlangt_raster() {
        assert_eq!(
            planzeit("2026-11-06 10:00:00", "Beginn").unwrap(),
            "2026-11-06 10:00:00"
        );
        assert_eq!(
            planzeit("2026-11-06 10:03:00", "Beginn")
                .unwrap_err()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn zeitraum_grenzen_sind_400() {
        for (von, bis) in [
            ("2026-11-06 10:00:00", "2026-11-06 10:05:00"),
            ("2026-11-06 10:00:00", "2026-11-07 10:05:00"),
            ("2026-11-06 10:00:00", "2026-11-06 09:00:00"),
        ] {
            assert_eq!(
                zeitraum(von, bis).unwrap_err().status(),
                StatusCode::BAD_REQUEST,
                "{von}–{bis}"
            );
        }
        assert!(zeitraum("2026-11-06 10:00:00", "2026-11-06 10:10:00").is_ok());
        assert!(zeitraum("2026-11-06 10:00:00", "2026-11-07 10:00:00").is_ok());
    }

    #[test]
    fn personen_begrenzt_und_entdoppelt() {
        let viele: Vec<PlanPersonEingabe> = (0..=PLAN_PERSONEN_MAX as i64)
            .map(|i| PlanPersonEingabe::Stamm { personal_id: i })
            .collect();
        assert_eq!(
            personen(viele).unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            personen(vec![
                PlanPersonEingabe::Stamm { personal_id: 1 },
                PlanPersonEingabe::Helfer { helfer_id: 1 },
                PlanPersonEingabe::Stamm { personal_id: 1 },
            ])
            .unwrap(),
            vec![PlanPerson::Stamm(1), PlanPerson::Helfer(1)]
        );
    }

    #[test]
    fn grenzwerte_ausserhalb_sind_400() {
        assert!(grenzwert(Some(Some(59)), "x", MAX_DIENST_BEREICH).is_err());
        assert!(grenzwert(Some(Some(1441)), "x", MAX_DIENST_BEREICH).is_err());
        assert!(grenzwert(Some(Some(-1)), "x", MIN_RUHE_BEREICH).is_err());
        assert_eq!(
            grenzwert(Some(None), "x", MIN_RUHE_BEREICH).unwrap(),
            Some(None)
        );
        assert_eq!(
            grenzwert(Some(Some(0)), "x", MIN_RUHE_BEREICH).unwrap(),
            Some(Some(0))
        );
    }
}
