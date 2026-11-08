//! Routen des Schichtplans eines Einsatzes (LLH-1552, Spec `kraefte-schichtplan`): Blöcke an
//! Einheiten, UHS und der Zeile „Pause“, Helfer des Plans, „Schichten erzeugen“ und die
//! Grenzwerte des Dienst-Befunds. Pfade unter `/api/einsaetze/{id}/abloesungen/schichtplan`.
//!
//! Gates wie die Ablösung (`EinsatzLesezugriff<Abloesung>`, `EinsatzSchreibzugriff<Abloesung>`).
//! Nach den Feldprüfungen (400) verlangt der Handler die Zusatzmodule: Einheiten für einen
//! Einheiten-Posten, Unfallhilfsstellen für einen UHS-Posten, Personal sobald Personen oder
//! Helfer geschrieben werden (403). Lesen ohne Personal liefert keine Namen (`personen: null`).
//! Jeder wirksame Schreibweg veröffentlicht `LiveEvent::Abloesung`; ETB nur für „Schichten
//! erzeugen“ und geänderte Grenzwerte.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::abloesung::schichtplan::repo::{
    self, BlockEingabe, BlockPatch, HelferEingabe, HelferPatch,
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
fn planzeit(wert: &str, was: &str) -> Result<String, AppError> {
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
fn zeitraum(von: &str, bis: &str) -> Result<(String, String), AppError> {
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

fn soll_anzahl(wert: Option<Option<i64>>) -> Result<Option<Option<i64>>, AppError> {
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
fn qualifikationen(ids: &[i64]) -> Result<Vec<i64>, AppError> {
    if ids.len() > HELFER_QUALIFIKATIONEN_MAX {
        return Err(AppError::Validation(format!(
            "qualifikationen: höchstens {HELFER_QUALIFIKATIONEN_MAX}"
        )));
    }
    Ok(crate::kraefte_disposition::dedupe(ids, |id| *id))
}

fn grenzwert(
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
