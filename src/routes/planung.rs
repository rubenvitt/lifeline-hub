//! Routen der Vorplanung ohne Einsatz (LLH-1585, Spec `vorplanung`, design.md D6). Pfade unter
//! `/api/planungen`.
//!
//! Gate: das Recht, Einsätze anzulegen, in der eigenen Organisation (`planung::zugriff`): ohne
//! Recht 403, eine fremde oder unbekannte Planung 404. Feldfehler 400, Zusammenhang und fremde
//! Kennungen 422, veralteter Stand und doppelte Bezeichnung 409. Jeder wirksame Schreibweg
//! meldet das Org-Ereignis `planung` an die Planer der Organisation. Kein ETB: es gibt keinen
//! Einsatz.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::abloesung::schichtplan::repo::{HelferEingabe, HelferPatch};
use crate::abloesung::schichtplan::uebernahme::{Entscheidungen, ENTSCHEIDUNGEN_MAX};
use crate::abloesung::schichtplan::{
    zerlegung, PlanHelferAnzeige, PlanPerson, BLOCK_MIN_MINUTEN, HELFER_TELEFON_MAX,
    HELFER_TEXT_MAX, MAX_DIENST_BEREICH, MIN_RUHE_BEREICH, NOTIZ_MAX, PLAN_PERSONEN_MAX,
};
use crate::app::AppState;
use crate::einsatz::Einsatzart;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::personal::quali_soll::{self, QualiSollEingabe};
use crate::planung::repo::{
    self, BlockEingabe, BlockPatch, Herkunft, KopfEingabe, KopfPatch, PostenEingabe, PostenPatch,
};
use crate::planung::zugriff::{Planer, PlanungsZugriff};
use crate::planung::{programm, uebernahme};
use crate::planung::{
    PlanungAnzeige, PlanungListeneintrag, PlanungPostenArt, PlanungUebernahmeErgebnis,
    PlanungUebernahmeVorschau, ABSCHNITT_MAX, BEZEICHNUNG_MAX, ORT_MAX, POSTEN_MAX,
};
use crate::programmpunkt::{Programmpunkt, PROGRAMMPUNKT_BEZEICHNUNG_MAX};
use crate::routes::abloesung_schichtplan::{
    grenzwert, planzeit, qualifikationen, soll_anzahl, zeitraum,
};
use crate::routes::programmpunkt::{parse_zeitpunkt, NeuerProgrammpunkt, ProgrammpunktPatch};
use crate::routes::support;
use crate::uhs::UhsTyp;
use crate::zeit::jetzt;

/// Nach einem wirksamen Schreibweg: das Org-Ereignis an die Planer.
fn melde(state: &AppState, org_id: i64, planung_id: i64) {
    state.live.publiziere_planung(org_id, planung_id);
}

async fn planung(state: &AppState, z: &PlanungsZugriff) -> Result<PlanungAnzeige, AppError> {
    repo::laden(&state.pool, z.benutzer.org_id, z.planung_id).await
}

/// GET /api/planungen/{id}/export — die Planung als Excel-Mappe (LLH-1557, design.md D5): wer
/// die Planung lesen darf. Helfer der Planung sind immer sichtbar (keine Modulsperre).
pub async fn export(
    State(state): State<AppState>,
    z: PlanungsZugriff,
) -> Result<axum::response::Response, AppError> {
    let plan = crate::abloesung::schichtplan::ausgabe::repo::planung(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        &jetzt(),
    )
    .await?;
    crate::routes::abloesung_schichtplan::mappe_antwort(plan).await
}

/// Ein Zeitpunkt des Zeitraums einer Planung: normalisiert, im Jahresbereich (400).
fn planungszeit(wert: &str, was: &str) -> Result<String, AppError> {
    crate::zeit::im_jahresbereich(crate::etb::normalisiere_zeit(wert.trim())?, was)
}

fn einsatzart(wert: &str) -> Result<Einsatzart, AppError> {
    Einsatzart::parse(wert.trim())
        .ok_or_else(|| AppError::Validation("Ungültige Einsatzart".into()))
}

/// Eine Person einer Planung: Stamm-Personal oder ein Helfer der Planung. Eine andere Art ist
/// 400 (Ad-hoc-Kräfte gibt es ohne Einsatz nicht).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "art", rename_all = "lowercase", deny_unknown_fields)]
pub enum PersonEingabe {
    Stamm { personal_id: i64 },
    Helfer { helfer_id: i64 },
}

/// Personen eines Blocks: höchstens [`PLAN_PERSONEN_MAX`] vor dem Entdoppeln (400).
fn personen(liste: Vec<PersonEingabe>) -> Result<Vec<PlanPerson>, AppError> {
    if liste.len() > PLAN_PERSONEN_MAX {
        return Err(AppError::Validation(format!(
            "personen: höchstens {PLAN_PERSONEN_MAX} Personen"
        )));
    }
    let personen: Vec<PlanPerson> = liste
        .into_iter()
        .map(|p| match p {
            PersonEingabe::Stamm { personal_id } => PlanPerson::Stamm(personal_id),
            PersonEingabe::Helfer { helfer_id } => PlanPerson::Helfer(helfer_id),
        })
        .collect();
    Ok(crate::kraefte_disposition::dedupe(&personen, |p| *p))
}

fn schichtlaenge(wert: Option<Option<i64>>) -> Result<Option<Option<i64>>, AppError> {
    match wert {
        Some(Some(m)) => Ok(Some(Some(zerlegung::pruefe_laenge(m).map_err(|_| {
            AppError::Validation(format!(
                "schichtlaenge_minuten: {BLOCK_MIN_MINUTEN} bis 1440 in Schritten von 5"
            ))
        })?))),
        andere => Ok(andere),
    }
}

// ---------------------------------------------------------------------------------------------
// Planung
// ---------------------------------------------------------------------------------------------

/// GET /api/planungen — die Planungen der eigenen Organisation mit Kennzahlen.
pub async fn liste(
    State(state): State<AppState>,
    Planer(benutzer): Planer,
) -> Result<Json<Vec<PlanungListeneintrag>>, AppError> {
    Ok(Json(
        repo::liste(&state.pool, benutzer.org_id, chrono::Utc::now()).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanungAnlegen {
    bezeichnung: String,
    /// Fehlt = Sanitätsdienst.
    #[serde(default)]
    einsatzart: Option<String>,
    #[serde(default)]
    ort: Option<String>,
    #[serde(default)]
    ort_lat: Option<f64>,
    #[serde(default)]
    ort_lon: Option<f64>,
    von: String,
    bis: String,
    #[serde(default)]
    max_dienst_minuten: Option<i64>,
    #[serde(default)]
    min_ruhe_minuten: Option<i64>,
}

/// POST /api/planungen — legt eine Planung an (201, ganze Planung). Bezeichnung doppelt 409.
pub async fn anlegen(
    State(state): State<AppState>,
    Planer(benutzer): Planer,
    JsonBody(req): JsonBody<PlanungAnlegen>,
) -> Result<(StatusCode, Json<PlanungAnzeige>), AppError> {
    let von = planungszeit(&req.von, "Beginn")?;
    let bis = planungszeit(&req.bis, "Ende")?;
    repo::pruefe_zeitraum(&von, &bis)?;
    let eingabe = KopfEingabe {
        bezeichnung: support::pflicht_max(&req.bezeichnung, "bezeichnung", BEZEICHNUNG_MAX)?,
        einsatzart: match req.einsatzart.as_deref() {
            Some(a) => einsatzart(a)?,
            None => Einsatzart::Sanitaetsdienst,
        },
        ort: support::optional_max(req.ort, "ort", ORT_MAX)?,
        koordinate: super::einsatz::pruefe_koordinate(
            req.ort_lat.map(Some),
            req.ort_lon.map(Some),
        )?,
        von,
        bis,
        max_dienst: grenzwert(
            req.max_dienst_minuten.map(Some),
            "max_dienst_minuten",
            MAX_DIENST_BEREICH,
        )?
        .flatten(),
        min_ruhe: grenzwert(
            req.min_ruhe_minuten.map(Some),
            "min_ruhe_minuten",
            MIN_RUHE_BEREICH,
        )?
        .flatten(),
    };
    let id = repo::anlegen(&state.pool, benutzer.org_id, benutzer.id, &eingabe).await?;
    melde(&state, benutzer.org_id, id);
    Ok((
        StatusCode::CREATED,
        Json(repo::laden(&state.pool, benutzer.org_id, id).await?),
    ))
}

/// GET /api/planungen/{id}
pub async fn lesen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
) -> Result<Json<PlanungAnzeige>, AppError> {
    Ok(Json(planung(&state, &z).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanungAendern {
    version: Option<i64>,
    #[serde(default)]
    bezeichnung: Option<String>,
    #[serde(default)]
    einsatzart: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    ort: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    ort_lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    ort_lon: Option<Option<f64>>,
    #[serde(default)]
    von: Option<String>,
    #[serde(default)]
    bis: Option<String>,
    /// Tri-State: fehlt = unverändert, `null` = Vorgabe (720 min).
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    max_dienst_minuten: Option<Option<i64>>,
    /// Tri-State: fehlt = unverändert, `null` = Vorgabe (480 min).
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    min_ruhe_minuten: Option<Option<i64>>,
}

/// PATCH /api/planungen/{id} — Kopf, CAS über `version` (409).
pub async fn aendern(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<PlanungAendern>,
) -> Result<Json<PlanungAnzeige>, AppError> {
    let version = req
        .version
        .ok_or_else(|| AppError::Validation("version fehlt".into()))?;
    let von = req
        .von
        .as_deref()
        .map(|v| planungszeit(v, "Beginn"))
        .transpose()?;
    let bis = req
        .bis
        .as_deref()
        .map(|b| planungszeit(b, "Ende"))
        .transpose()?;
    if let (Some(v), Some(b)) = (&von, &bis) {
        repo::pruefe_zeitraum(v, b)?;
    }
    let koordinate = match (req.ort_lat, req.ort_lon) {
        (None, None) => None,
        (lat, lon) => Some(super::einsatz::pruefe_koordinate(lat, lon)?),
    };
    let patch = KopfPatch {
        version,
        bezeichnung: support::pflicht_max_tri(
            req.bezeichnung.as_deref(),
            "bezeichnung",
            BEZEICHNUNG_MAX,
        )?,
        einsatzart: req.einsatzart.as_deref().map(einsatzart).transpose()?,
        ort: support::optional_max_tri(req.ort, "ort", ORT_MAX)?,
        koordinate,
        von,
        bis,
        max_dienst: grenzwert(
            req.max_dienst_minuten,
            "max_dienst_minuten",
            MAX_DIENST_BEREICH,
        )?,
        min_ruhe: grenzwert(req.min_ruhe_minuten, "min_ruhe_minuten", MIN_RUHE_BEREICH)?,
    };
    repo::aendern(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        z.benutzer.id,
        &patch,
        &jetzt(),
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(Json(planung(&state, &z).await?))
}

/// DELETE /api/planungen/{id} — samt Posten, Blöcken und Helfern (204).
pub async fn loeschen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
) -> Result<StatusCode, AppError> {
    repo::loeschen(&state.pool, z.benutzer.org_id, z.planung_id).await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// Posten
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostenAnlegen {
    bezeichnung: String,
    #[serde(default)]
    abschnitt: Option<String>,
    art: String,
    /// Nur bei `art = einheit`, höchstens eins von Vorlage und Fahrzeug.
    #[serde(default)]
    einheit_vorlage_id: Option<i64>,
    #[serde(default)]
    fahrzeug_id: Option<i64>,
    /// Pflicht bei `art = uhs`.
    #[serde(default)]
    uhs_typ: Option<String>,
    #[serde(default)]
    schichtlaenge_minuten: Option<i64>,
    /// Fehlt = Soll der Vorlage bzw. des Fahrzeugs, `null` = kein Soll.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    soll_anzahl: Option<Option<i64>>,
    /// Fehlt = Qualifikationssoll der Vorlage, `null` oder `[]` = keins.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    quali_soll: Option<Option<Vec<QualiSollEingabe>>>,
}

fn herkunft(req: &PostenAnlegen) -> Result<Herkunft, AppError> {
    let art = PlanungPostenArt::parse(req.art.trim())
        .ok_or_else(|| AppError::Validation("art: einheit oder uhs".into()))?;
    match (
        art,
        req.einheit_vorlage_id,
        req.fahrzeug_id,
        req.uhs_typ.as_deref(),
    ) {
        (PlanungPostenArt::Einheit, None, None, None) => Ok(Herkunft::Frei),
        (PlanungPostenArt::Einheit, Some(v), None, None) => Ok(Herkunft::Vorlage(v)),
        (PlanungPostenArt::Einheit, None, Some(f), None) => Ok(Herkunft::Fahrzeug(f)),
        (PlanungPostenArt::Einheit, Some(_), Some(_), _) => Err(AppError::Validation(
            "Höchstens eins von einheit_vorlage_id und fahrzeug_id".into(),
        )),
        (PlanungPostenArt::Einheit, _, _, Some(_)) => {
            Err(AppError::Validation("uhs_typ nur bei art = uhs".into()))
        }
        (PlanungPostenArt::Uhs, None, None, Some(t)) => UhsTyp::parse(t.trim())
            .map(Herkunft::Uhs)
            .ok_or_else(|| AppError::Validation("Ungültiger uhs_typ".into())),
        (PlanungPostenArt::Uhs, None, None, None) => {
            Err(AppError::Validation("uhs_typ fehlt".into()))
        }
        (PlanungPostenArt::Uhs, _, _, _) => Err(AppError::Validation(
            "Eine UHS hat keine Vorlage und kein Fahrzeug".into(),
        )),
    }
}

/// POST /api/planungen/{id}/posten — am Ende der Reihenfolge (201, ganze Planung). Höchstens
/// [`POSTEN_MAX`] je Planung (422), Bezeichnung in der Planung doppelt 409.
pub async fn posten_anlegen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<PostenAnlegen>,
) -> Result<(StatusCode, Json<PlanungAnzeige>), AppError> {
    let eingabe = PostenEingabe {
        herkunft: herkunft(&req)?,
        bezeichnung: support::pflicht_max(&req.bezeichnung, "bezeichnung", BEZEICHNUNG_MAX)?,
        abschnitt: support::optional_max(req.abschnitt, "abschnitt", ABSCHNITT_MAX)?,
        schichtlaenge: schichtlaenge(req.schichtlaenge_minuten.map(Some))?.flatten(),
        soll_anzahl: soll_anzahl(req.soll_anzahl)?,
        quali_soll: quali_soll::form_tri(req.quali_soll)?,
    };
    repo::posten_anlegen(&state.pool, z.benutzer.org_id, z.planung_id, &eingabe).await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok((StatusCode::CREATED, Json(planung(&state, &z).await?)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostenAendern {
    #[serde(default)]
    bezeichnung: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    abschnitt: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    schichtlaenge_minuten: Option<Option<i64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    soll_anzahl: Option<Option<i64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    quali_soll: Option<Option<Vec<QualiSollEingabe>>>,
}

/// PATCH /api/planungen/{id}/posten/{pid} — Bezeichnung, Abschnitt, Schichtlänge, Soll; die
/// Herkunft bleibt. Bestehende Blöcke behalten ihr Soll.
pub async fn posten_aendern(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, pid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<PostenAendern>,
) -> Result<Json<PlanungAnzeige>, AppError> {
    let patch = PostenPatch {
        bezeichnung: support::pflicht_max_tri(
            req.bezeichnung.as_deref(),
            "bezeichnung",
            BEZEICHNUNG_MAX,
        )?,
        abschnitt: support::optional_max_tri(req.abschnitt, "abschnitt", ABSCHNITT_MAX)?,
        schichtlaenge: schichtlaenge(req.schichtlaenge_minuten)?,
        soll_anzahl: soll_anzahl(req.soll_anzahl)?,
        quali_soll: quali_soll::form_tri(req.quali_soll)?,
    };
    repo::posten_aendern(&state.pool, z.benutzer.org_id, z.planung_id, pid, &patch).await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(Json(planung(&state, &z).await?))
}

#[derive(Debug, Deserialize)]
pub struct PostenLoeschenParams {
    #[serde(default)]
    mit_bloecken: bool,
}

/// DELETE /api/planungen/{id}/posten/{pid}?mit_bloecken=true — samt seinen Blöcken; sind darin
/// Personen eingeteilt, nur mit `mit_bloecken` (422 sonst).
pub async fn posten_loeschen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, pid)): PfadParam<(i64, i64)>,
    Query(params): Query<PostenLoeschenParams>,
) -> Result<StatusCode, AppError> {
    repo::posten_loeschen(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        pid,
        params.mit_bloecken,
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reihenfolge {
    posten_ids: Vec<i64>,
}

/// PUT /api/planungen/{id}/posten/reihenfolge — die ganze Reihenfolge (jeder Posten genau
/// einmal, 422 sonst).
pub async fn reihenfolge(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<Reihenfolge>,
) -> Result<Json<PlanungAnzeige>, AppError> {
    if req.posten_ids.len() > POSTEN_MAX as usize {
        return Err(AppError::Validation(format!(
            "posten_ids: höchstens {POSTEN_MAX}"
        )));
    }
    repo::reihenfolge(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        &req.posten_ids,
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(Json(planung(&state, &z).await?))
}

// ---------------------------------------------------------------------------------------------
// Blöcke
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockAnlegen {
    /// Der Posten; `null` oder fehlt = die Pause.
    #[serde(default)]
    posten_id: Option<i64>,
    von: String,
    bis: String,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    soll_anzahl: Option<Option<i64>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    quali_soll: Option<Option<Vec<QualiSollEingabe>>>,
    #[serde(default)]
    personen: Vec<PersonEingabe>,
    #[serde(default)]
    notiz: Option<String>,
}

/// POST /api/planungen/{id}/bloecke — liefert die ganze Planung (201).
pub async fn block_anlegen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<BlockAnlegen>,
) -> Result<(StatusCode, Json<PlanungAnzeige>), AppError> {
    let (von, bis) = zeitraum(&req.von, &req.bis)?;
    let eingabe = BlockEingabe {
        posten_id: req.posten_id,
        von,
        bis,
        soll_anzahl: soll_anzahl(req.soll_anzahl)?,
        quali_soll: quali_soll::form_tri(req.quali_soll)?,
        personen: personen(req.personen)?,
        notiz: support::optional_max(req.notiz, "notiz", NOTIZ_MAX)?,
    };
    repo::block_anlegen(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        z.benutzer.id,
        &eingabe,
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok((StatusCode::CREATED, Json(planung(&state, &z).await?)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlockAendern {
    version: Option<i64>,
    /// Tri-State: fehlt = unverändert, `null` = in die Pause.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    posten_id: Option<Option<i64>>,
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
    personen: Option<Vec<PersonEingabe>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    notiz: Option<Option<String>>,
}

/// PATCH /api/planungen/{id}/bloecke/{bid} — CAS über `version` (409).
pub async fn block_aendern(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, bid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<BlockAendern>,
) -> Result<Json<PlanungAnzeige>, AppError> {
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
        posten: req.posten_id,
        von,
        bis,
        soll_anzahl: soll_anzahl(req.soll_anzahl)?,
        quali_soll: quali_soll::form_tri(req.quali_soll)?,
        personen: req.personen.map(personen).transpose()?,
        notiz: support::optional_max_tri(req.notiz, "notiz", NOTIZ_MAX)?,
    };
    repo::block_aendern(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        bid,
        z.benutzer.id,
        &patch,
        &jetzt(),
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(Json(planung(&state, &z).await?))
}

#[derive(Debug, Deserialize)]
pub struct VersionParams {
    #[serde(default)]
    version: Option<i64>,
}

/// DELETE /api/planungen/{id}/bloecke/{bid}?version=… (409 bei veraltetem Stand).
pub async fn block_loeschen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, bid)): PfadParam<(i64, i64)>,
    Query(params): Query<VersionParams>,
) -> Result<StatusCode, AppError> {
    let version = params
        .version
        .ok_or_else(|| AppError::Validation("version fehlt".into()))?;
    repo::block_loeschen(&state.pool, z.benutzer.org_id, z.planung_id, bid, version).await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Erzeugen {
    /// Der Posten; `null` oder fehlt = die Pause (dann ist `laenge_minuten` Pflicht).
    #[serde(default)]
    posten_id: Option<i64>,
    von: String,
    bis: String,
    /// Länge je Schicht; fehlt = Schichtlänge des Postens.
    #[serde(default)]
    laenge_minuten: Option<i64>,
}

/// POST /api/planungen/{id}/erzeugen — füllt den Zeitraum am Posten mit Schichten (alles oder
/// nichts). Ohne Länge und ohne Schichtlänge des Postens 422. Liefert die ganze Planung (201).
pub async fn erzeugen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<Erzeugen>,
) -> Result<(StatusCode, Json<PlanungAnzeige>), AppError> {
    let von = planzeit(&req.von, "Beginn")?;
    let bis = planzeit(&req.bis, "Ende")?;
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
    repo::erzeugen(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        z.benutzer.id,
        req.posten_id,
        &von,
        &bis,
        laenge,
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok((StatusCode::CREATED, Json(planung(&state, &z).await?)))
}

// ---------------------------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------------------------

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

/// POST /api/planungen/{id}/helfer (201, der Helfer).
pub async fn helfer_anlegen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<HelferAnlegen>,
) -> Result<(StatusCode, Json<PlanHelferAnzeige>), AppError> {
    let eingabe = HelferEingabe {
        name: support::pflicht_max(&req.name, "name", HELFER_TEXT_MAX)?,
        telefon: support::optional_max(req.telefon, "telefon", HELFER_TELEFON_MAX)?,
        organisation: support::optional_max(req.organisation, "organisation", HELFER_TEXT_MAX)?,
        qualifikationen: qualifikationen(&req.qualifikationen)?,
    };
    let helfer = repo::helfer_anlegen(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        z.benutzer.id,
        &eingabe,
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
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

/// PATCH /api/planungen/{id}/helfer/{hid}
pub async fn helfer_aendern(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, hid)): PfadParam<(i64, i64)>,
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
    let helfer =
        repo::helfer_aendern(&state.pool, z.benutzer.org_id, z.planung_id, hid, &patch).await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(Json(helfer))
}

/// DELETE /api/planungen/{id}/helfer/{hid} — nimmt den Helfer aus allen Blöcken.
pub async fn helfer_loeschen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, hid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    repo::helfer_loeschen(&state.pool, z.benutzer.org_id, z.planung_id, hid).await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// Programmpunkte (LLH-1583)
// ---------------------------------------------------------------------------------------------

/// POST /api/planungen/{id}/programmpunkte (201, der Programmpunkt). Grenzen wie am Einsatz:
/// Bezeichnung Pflicht und höchstens 100 Zeichen, Zeitpunkt im Jahresbereich (400), höchstens 50
/// je Planung (422).
pub async fn programmpunkt_anlegen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<NeuerProgrammpunkt>,
) -> Result<(StatusCode, Json<Programmpunkt>), AppError> {
    let bezeichnung = support::pflicht_max(
        &req.bezeichnung,
        "Bezeichnung",
        PROGRAMMPUNKT_BEZEICHNUNG_MAX,
    )?;
    let zeitpunkt = parse_zeitpunkt(&req.zeitpunkt_at)?;
    let p = programm::anlegen(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        z.benutzer.id,
        &bezeichnung,
        &zeitpunkt,
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok((StatusCode::CREATED, Json(p)))
}

/// PATCH /api/planungen/{id}/programmpunkte/{pid} — Bezeichnung und/oder Zeitpunkt.
pub async fn programmpunkt_aendern(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, pid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<ProgrammpunktPatch>,
) -> Result<Json<Programmpunkt>, AppError> {
    let bezeichnung = support::pflicht_max_tri(
        req.bezeichnung.as_deref(),
        "Bezeichnung",
        PROGRAMMPUNKT_BEZEICHNUNG_MAX,
    )?;
    let zeitpunkt = req
        .zeitpunkt_at
        .as_deref()
        .map(parse_zeitpunkt)
        .transpose()?;
    let p = programm::aendern(
        &state.pool,
        z.benutzer.org_id,
        z.planung_id,
        pid,
        bezeichnung.as_deref(),
        zeitpunkt.as_deref(),
    )
    .await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(Json(p))
}

/// DELETE /api/planungen/{id}/programmpunkte/{pid} (204).
pub async fn programmpunkt_loeschen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    PfadParam((_id, pid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    programm::loeschen(&state.pool, z.benutzer.org_id, z.planung_id, pid).await?;
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------------------------
// Übernahme (LLH-1587)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UebernahmeAnfrage {
    ziel: uebernahme::Ziel,
    /// Die Wahl in der Vorschau je Schlüssel; fehlt ein Schlüssel, gilt der Vorschlag.
    #[serde(default)]
    entscheidungen: Entscheidungen,
    /// Der Stand aus der Vorschau (LLH-1610): Pflicht beim Übernehmen (400 sonst), in der
    /// Vorschau ohne Bedeutung.
    #[serde(default)]
    stand: Option<i64>,
}

/// Entscheidungen je Art höchstens [`ENTSCHEIDUNGEN_MAX`] (400), wie beim Einlesen einer Datei.
fn check_entscheidungen(e: Entscheidungen) -> Result<Entscheidungen, AppError> {
    if e.posten.len() > ENTSCHEIDUNGEN_MAX || e.personen.len() > ENTSCHEIDUNGEN_MAX {
        return Err(AppError::Validation(format!(
            "entscheidungen: höchstens {ENTSCHEIDUNGEN_MAX} je Art"
        )));
    }
    Ok(e)
}

/// POST /api/planungen/{id}/uebernahme/vorschau — gleicht die Planung mit dem Ziel ab und
/// schreibt nichts; Fehler stehen in der Antwort (200). Ein laufender Einsatz: fremd oder
/// unbekannt 404, ohne Schreibrecht, Ablösung oder Personal 403, abgeschlossen 409. Eine schon
/// übernommene Planung 409. Die Antwort trägt den Stand der Planung (LLH-1610).
pub async fn uebernahme_vorschau(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<UebernahmeAnfrage>,
) -> Result<Json<PlanungUebernahmeVorschau>, AppError> {
    let e = check_entscheidungen(req.entscheidungen)?;
    let v = uebernahme::vorschau(&state.pool, &z.benutzer, z.planung_id, req.ziel, &e).await?;
    Ok(Json(PlanungUebernahmeVorschau {
        vorschau: v.vorschau,
        stand: v.stand,
    }))
}

/// POST /api/planungen/{id}/uebernahme — wie die Vorschau, schreibt aber in EINER Transaktion:
/// neuer Einsatz (wenn gewählt), Plan des Einsatzes und Vermerk an der Planung. Danach ist die
/// Planung schreibgeschützt, ein zweiter Aufruf 409. Fehler des Abgleichs 422 (Zeilen). Ohne
/// `stand` 400; hat sich die Planung seit der Vorschau geändert, 409 (LLH-1610).
pub async fn uebernehmen(
    State(state): State<AppState>,
    z: PlanungsZugriff,
    JsonBody(req): JsonBody<UebernahmeAnfrage>,
) -> Result<Json<PlanungUebernahmeErgebnis>, AppError> {
    let stand = req
        .stand
        .ok_or_else(|| AppError::Validation("stand fehlt".into()))?;
    let e = check_entscheidungen(req.entscheidungen)?;
    let u = uebernahme::uebernehmen(&state.pool, &z.benutzer, z.planung_id, req.ziel, &e, stand)
        .await?;
    if u.neu {
        super::einsatz::publish_neuer_einsatz(&state, u.einsatz_id, z.benutzer.id).await;
    }
    super::abloesung_schichtplan::publish_uebernahme(&state, u.einsatz_id, &u.geschrieben);
    melde(&state, z.benutzer.org_id, z.planung_id);
    Ok(Json(PlanungUebernahmeErgebnis {
        einsatz_id: u.einsatz_id,
        einsatz_neu: u.neu,
        zaehlung: u.geschrieben.zaehlung,
        planung: planung(&state, &z).await?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zu_viele_entscheidungen_sind_400() {
        let mut e = Entscheidungen::default();
        for i in 0..=ENTSCHEIDUNGEN_MAX {
            e.personen.insert(
                format!("p{i}"),
                crate::abloesung::schichtplan::uebernahme::PersonEntscheidung::Neu,
            );
        }
        assert_eq!(
            check_entscheidungen(e).unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
    }

    fn posten(json: serde_json::Value) -> Result<Herkunft, AppError> {
        herkunft(&serde_json::from_value(json).unwrap())
    }

    #[test]
    fn herkunft_passt_zur_art() {
        let b = "Streife";
        assert_eq!(
            posten(serde_json::json!({"bezeichnung": b, "art": "einheit"})).unwrap(),
            Herkunft::Frei
        );
        assert_eq!(
            posten(serde_json::json!({"bezeichnung": b, "art": "einheit", "fahrzeug_id": 3}))
                .unwrap(),
            Herkunft::Fahrzeug(3)
        );
        assert_eq!(
            posten(
                serde_json::json!({"bezeichnung": b, "art": "uhs", "uhs_typ": "behandlungsplatz"})
            )
            .unwrap(),
            Herkunft::Uhs(UhsTyp::Behandlungsplatz)
        );
        for falsch in [
            serde_json::json!({"bezeichnung": b, "art": "einheit", "fahrzeug_id": 3, "einheit_vorlage_id": 1}),
            serde_json::json!({"bezeichnung": b, "art": "einheit", "uhs_typ": "sonstige"}),
            serde_json::json!({"bezeichnung": b, "art": "uhs"}),
            serde_json::json!({"bezeichnung": b, "art": "uhs", "uhs_typ": "sonstige", "fahrzeug_id": 1}),
            serde_json::json!({"bezeichnung": b, "art": "pause"}),
        ] {
            assert_eq!(
                posten(falsch.clone()).unwrap_err().status(),
                StatusCode::BAD_REQUEST,
                "{falsch}"
            );
        }
    }

    #[test]
    fn ad_hoc_kraft_gibt_es_in_der_planung_nicht() {
        let fehler = serde_json::from_value::<PersonEingabe>(
            serde_json::json!({"art": "einsatz", "einsatz_personal_id": 1}),
        );
        assert!(fehler.is_err());
    }

    #[test]
    fn schichtlaenge_im_raster() {
        assert!(schichtlaenge(Some(Some(180))).is_ok());
        assert!(schichtlaenge(Some(Some(7))).is_err());
        assert!(schichtlaenge(Some(Some(1445))).is_err());
        assert_eq!(schichtlaenge(Some(None)).unwrap(), Some(None));
    }
}
