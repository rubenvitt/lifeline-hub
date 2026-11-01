//! Routen der Ablösung (LFH-635): Schichten von Einheiten, Rhythmus-Vorgabe je Abschnitt,
//! Vollzug mit Folgeschicht und Rücknahme.
//!
//! Gates strukturell über `EinsatzLesezugriff<Abloesung>` (alle Einsatzmitglieder inkl.
//! Beobachter) bzw. `EinsatzSchreibzugriff<Abloesung>` (Schreibrecht, aktiver Einsatz, Modul).
//! Zeiten werden hier normalisiert (`etb::normalisiere_zeit`, 400 bei Unparsbarem), nie im
//! Repo — dieselbe Arbeitsteilung wie im Bestand.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::abloesung::repo::{
    self, AenderungEingabe, BeginnEingabe, EinsatzVorgabeInput, VollzugEingabe, VollzugWirkung,
};
use crate::abloesung::{
    AbloesungAnzeige, AbloesungArt, AbloesungEinsatzVorgabeAnzeige, AbloesungStatus,
    AbloesungVerbleib, AbloesungVollzugAnzeige, AbloesungVorgabeAnzeige, ABLOESER_MAX,
    BESATZUNG_MAX, RHYTHMUS_MAX_MINUTEN,
};
use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::{Abloesung, Bereitstellungsraeume, Einheiten};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::routes::support;
use crate::schichtmodell::WerteBody;
use crate::zeit::jetzt;

/// Listen-Refresh für Ablösungs-Leser. Ohne `art` — nur der Scheduler setzt `art` und löst
/// damit den Hinweis in der AlarmZentrale aus (Muster wie `erinnerung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Abloesung);
}

/// Nach einem wirksamen Schreibvorgang: ETB-Kurzruf (der Eintrag entstand im selben Commit)
/// und Listen-Refresh.
fn publiziere(state: &AppState, einsatz_id: i64, etb_id: Option<i64>) {
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse(state, einsatz_id);
}

/// Nach einem Schreibweg der Kräfte-Zeitachse, dessen Kopplung die Ablösung geändert hat
/// (LLH-1128: Schicht mit dem Eintreffen begonnen, mit der Entlassung beendet, nach gestrichener
/// Entlassung wieder laufend; LLH-1131: Planung der ablösenden Einheit entfallen): Kurzruf je
/// ETB-Eintrag und Listen-Refresh, wie beim Beginnen von Hand. Danach die Hinweise zur
/// ablösenden Einheit (`abloesung::hinweis`) über `benachrichtigung::melden`; ein Fehler dort
/// lässt den Schreibweg nicht scheitern. Ohne beides nichts.
pub(crate) async fn publish_kopplung(
    state: &AppState,
    einsatz_id: i64,
    etb_ids: &[i64],
    hinweise: &[crate::benachrichtigung::Anlass],
) {
    if !etb_ids.is_empty() {
        for etb_id in etb_ids {
            state.live.publiziere(einsatz_id, *etb_id);
        }
        sse(state, einsatz_id);
    }
    for anlass in hinweise {
        crate::benachrichtigung::melden(&state.pool, &state.live, anlass.clone()).await;
    }
}

/// Vollzug und Rücknahme ändern die Zeitachse der Einheit, ihrer erbenden Untereinheiten und per
/// Fan-out die ihrer Personen, mit der Abschnittsübergabe auch Einheiten, mit dem
/// Besatzungswechsel Personen und ihre Einheiten (LLH-1150); deren Leser mit nur Einheiten- oder
/// Personalrecht erreicht `abloesung` nicht (LLH-1189). Je Einheit und je Person ein Ereignis.
/// Dazu je berührtem Bereitstellungsraum `bereitstellungsraum` (LLH-1308) und die Wirkung der
/// Kopplung (eine entfallene Planung der entlassenen Einheit).
async fn publish_zeitachse(state: &AppState, einsatz_id: i64, wirkung: VollzugWirkung) {
    for br_id in crate::kraefte_disposition::dedupe(&wirkung.raeume, |id| *id) {
        super::einsatz_bereitstellungsraum::sse_br(state, einsatz_id, br_id);
    }
    publish_kopplung(
        state,
        einsatz_id,
        &wirkung.kopplung.etb,
        &wirkung.kopplung.anlaesse,
    )
    .await;
    let mut gemeldet: Vec<i64> = Vec::new();
    let mut personen = wirkung.personen;
    for (einheit_id, beruehrt) in wirkung.zeitachse {
        super::einsatz_einheit::sse_einheit(state, einsatz_id, einheit_id);
        gemeldet.push(einheit_id);
        personen.extend(beruehrt.personen);
    }
    for einheit_id in crate::kraefte_disposition::dedupe(&wirkung.einheiten, |id| *id) {
        if !gemeldet.contains(&einheit_id) {
            super::einsatz_einheit::sse_einheit(state, einsatz_id, einheit_id);
        }
    }
    for ep_id in crate::kraefte_disposition::dedupe(&personen, |id| *id) {
        super::einsatz_personal::sse_personal(state, einsatz_id, ep_id);
    }
}

/// Eine Liste von Ablösern von außen (LLH-1132, `src/AGENTS.md`, „Eingabegrenzen“): mehr als
/// [`ABLOESER_MAX`], gezählt vor dem Entdoppeln → 400; liefert sie entdoppelt in ihrer
/// Reihenfolge. Leer ist erlaubt (ohne ablösende Einheit bzw. Planung aufheben).
fn check_abloeser(ids: &[i64]) -> Result<Vec<i64>, AppError> {
    if ids.len() > ABLOESER_MAX {
        return Err(AppError::Validation(format!(
            "abloeser_ids: höchstens {ABLOESER_MAX} Einheiten"
        )));
    }
    Ok(crate::kraefte_disposition::dedupe(ids, |id| *id))
}

/// Ablöser aus der Liste oder der Einzelangabe (Bestand). Beide zugleich → 422 (Feld-
/// Kombination).
fn abloeser_aus(
    liste: Option<Vec<i64>>,
    einzeln: Option<Option<i64>>,
) -> Result<Option<Vec<i64>>, AppError> {
    match (liste, einzeln) {
        (Some(_), Some(_)) => Err(AppError::UnprocessableEntity(
            "Entweder abloeser_ids oder abloesende_einheit_id, nicht beides".into(),
        )),
        (Some(l), None) => Ok(Some(check_abloeser(&l)?)),
        (None, Some(e)) => Ok(Some(e.into_iter().collect())),
        (None, None) => Ok(None),
    }
}

/// Ein Rhythmus außerhalb von 1..=7 Tagen scheitert am Feld isoliert → 400 (LFH-267).
fn pruefe_rhythmus(minuten: i64) -> Result<i64, AppError> {
    if minuten <= 0 || minuten > RHYTHMUS_MAX_MINUTEN {
        return Err(AppError::Validation(format!(
            "rhythmus_minuten muss zwischen 1 und {RHYTHMUS_MAX_MINUTEN} liegen"
        )));
    }
    Ok(minuten)
}

/// Optionale Zeitangabe: fehlt/leer → `None`, sonst normalisiert; 400 bei Unparsbarem und bei
/// einem Jahr außerhalb von [`crate::zeit::JAHRE`] (LFH-1060: Beginn und Vollzug werden zur
/// Fälligkeit, ein Jahr am Rand ließ deren Minutenrechnung panicken, ein Tippfehler alarmierte
/// sofort).
fn zeit(eingabe: Option<String>, was: &str) -> Result<Option<String>, AppError> {
    match eingabe.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => Ok(Some(crate::zeit::im_jahresbereich(
            crate::etb::normalisiere_zeit(s)?,
            was,
        )?)),
        _ => Ok(None),
    }
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `laufend` | `abgeloest` | `beendet`; fehlt = alle. Als `String`, damit ein unbekannter
    /// Wert eine benannte 400 liefert.
    #[serde(default)]
    status: Option<String>,
}

/// GET /api/einsaetze/{id}/abloesungen
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Abloesung>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<AbloesungAnzeige>>, AppError> {
    let status = match params.status.as_deref() {
        None | Some("") => None,
        Some(s) => Some(AbloesungStatus::parse(s).ok_or_else(|| {
            AppError::Validation(format!(
                "Unbekannter Status '{s}' (erlaubt: laufend, abgeloest, beendet)"
            ))
        })?),
    };
    Ok(Json(
        repo::liste(&state.pool, ctx.einsatz.id, status, &jetzt()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct Beginnen {
    einheit_id: i64,
    #[serde(default)]
    beginn_at: Option<String>,
    #[serde(default)]
    rhythmus_minuten: Option<i64>,
}

/// POST /api/einsaetze/{id}/abloesungen — Schicht beginnen.
pub async fn beginnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    JsonBody(req): JsonBody<Beginnen>,
) -> Result<(StatusCode, Json<AbloesungAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let jetzt = jetzt();
    let rhythmus_minuten = req.rhythmus_minuten.map(pruefe_rhythmus).transpose()?;
    // Ohne Beginn: das Eintreffen der offenen Einsatzperiode, sonst jetzt (Repo, LFH-552).
    let beginn_at = zeit(req.beginn_at, "Beginn")?;
    let (anzeige, etb_id) = repo::beginnen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &BeginnEingabe {
            einheit_id: req.einheit_id,
            beginn_at,
            rhythmus_minuten,
        },
        &jetzt,
    )
    .await?;
    publiziere(&state, einsatz_id, Some(etb_id));
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct Aendern {
    #[serde(default)]
    beginn_at: Option<String>,
    /// Tri-State: fehlt = unverändert, `null` = zurück zur Abschnittsvorgabe.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    rhythmus_minuten: Option<Option<i64>>,
    /// Tri-State: fehlt = unverändert, `null` = Planung aufheben. Bestand neben
    /// `abloeser_ids`: plant genau einen Ablöser.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    abloesende_einheit_id: Option<Option<i64>>,
    /// Die geplanten Ablöser in ihrer Reihenfolge (LLH-1132); fehlt = unverändert, `[]` =
    /// Planung aufheben.
    #[serde(default)]
    abloeser_ids: Option<Vec<i64>>,
}

/// PATCH /api/einsaetze/{id}/abloesungen/{aid}
pub async fn aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<Aendern>,
) -> Result<Json<AbloesungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let rhythmus_minuten = match req.rhythmus_minuten {
        Some(Some(r)) => Some(Some(pruefe_rhythmus(r)?)),
        andere => andere,
    };
    let abloeser = abloeser_aus(req.abloeser_ids, req.abloesende_einheit_id)?;
    let eingabe = AenderungEingabe {
        beginn_at: zeit(req.beginn_at, "Beginn")?,
        rhythmus_minuten,
        abloeser,
    };
    let (anzeige, etb_id) = repo::aendern(
        &state.pool,
        einsatz_id,
        aid,
        ctx.benutzer.id,
        &eingabe,
        &jetzt(),
    )
    .await?;
    if etb_id.is_some() {
        publiziere(&state, einsatz_id, etb_id);
    }
    Ok(Json(anzeige))
}

#[derive(Debug, Deserialize)]
pub struct Vollziehen {
    #[serde(default)]
    vollzogen_at: Option<String>,
    /// Bestand neben `abloeser_ids`: genau ein Ablöser.
    #[serde(default)]
    abloesende_einheit_id: Option<i64>,
    /// Die Ablöser in ihrer Reihenfolge (LLH-1132, höchstens [`ABLOESER_MAX`]); fehlen beide
    /// Angaben, wird ohne ablösende Einheit vollzogen.
    #[serde(default)]
    abloeser_ids: Option<Vec<i64>>,
    /// Den Abschnitt der abgelösten Einheit an die Ablöser übergeben (LLH-1132). Verlangt die
    /// Freigabe des Moduls Einheiten, das die Unterstellung sonst schreibt.
    #[serde(default)]
    abschnitt_uebergeben: bool,
    /// `einheit` (Vorgabe) oder `besatzung` (LLH-1150). Als `String`, damit ein unbekannter Wert
    /// eine benannte 400 liefert.
    #[serde(default)]
    art: Option<String>,
    /// Beim Besatzungswechsel die neue Besatzung (`einsatz_personal.id`, höchstens
    /// [`BESATZUNG_MAX`]); Pflicht dort, sonst verboten.
    #[serde(default)]
    besatzung_ids: Option<Vec<i64>>,
    /// Was danach mit der abgelösten Einheit geschieht (LLH-1308): `ruhe` (Vorgabe),
    /// `bereitstellungsraum` oder `entlassen`. Als `String` für die benannte 400.
    #[serde(default)]
    verbleib: Option<String>,
    /// Der Raum genau beim Verbleib `bereitstellungsraum`.
    #[serde(default)]
    verbleib_br_id: Option<i64>,
}

/// Verbleib der abgelösten Einheit (LLH-1308, design.md D1): unbekannter Wert → 400; Raum ohne
/// Verbleib im Raum, Verbleib im Raum ohne Raum und ein anderer Verbleib als `ruhe` beim
/// Besatzungswechsel → 422.
fn vollzug_verbleib(
    verbleib: Option<&str>,
    br_id: Option<i64>,
    art: AbloesungArt,
) -> Result<(AbloesungVerbleib, Option<i64>), AppError> {
    let verbleib = match verbleib.map(str::trim) {
        None | Some("") => AbloesungVerbleib::Ruhe,
        Some(s) => AbloesungVerbleib::parse(s).ok_or_else(|| {
            AppError::Validation(format!(
                "Unbekannter Verbleib '{s}' (erlaubt: ruhe, bereitstellungsraum, entlassen)"
            ))
        })?,
    };
    if art == AbloesungArt::Besatzung && verbleib != AbloesungVerbleib::Ruhe {
        return Err(AppError::UnprocessableEntity(
            "Beim Besatzungswechsel bleibt die Einheit im Einsatz; einen Verbleib gibt es nicht"
                .into(),
        ));
    }
    match (verbleib, br_id) {
        (AbloesungVerbleib::Bereitstellungsraum, None) => Err(AppError::UnprocessableEntity(
            "verbleib_br_id fehlt: welcher Bereitstellungsraum?".into(),
        )),
        (AbloesungVerbleib::Bereitstellungsraum, Some(id)) => Ok((verbleib, Some(id))),
        (_, Some(_)) => Err(AppError::UnprocessableEntity(
            "verbleib_br_id gilt nur beim Verbleib bereitstellungsraum".into(),
        )),
        (v, None) => Ok((v, None)),
    }
}

/// Art und neue Besatzung eines Vollzugs (LLH-1150), erst die Felder für sich (400), dann der
/// Zusammenhang (422): unbekannte Art und mehr als [`BESATZUNG_MAX`] Personen (gezählt vor dem
/// Entdoppeln) → 400, ein Besatzungswechsel ohne neue Besatzung → 400; beim Besatzungswechsel
/// ablösende Einheiten oder „Abschnitt übergeben“ → 422, `besatzung_ids` ohne Besatzungswechsel
/// → 422. Liefert die Art und die neue Besatzung entdoppelt in ihrer Reihenfolge.
fn vollzug_art(
    art: Option<&str>,
    besatzung: Option<&[i64]>,
    abloeser: &[i64],
    abschnitt_uebergeben: bool,
) -> Result<(AbloesungArt, Vec<i64>), AppError> {
    let art = match art.map(str::trim) {
        None | Some("") => AbloesungArt::Einheit,
        Some(s) => AbloesungArt::parse(s).ok_or_else(|| {
            AppError::Validation(format!(
                "Unbekannte Art '{s}' (erlaubt: einheit, besatzung)"
            ))
        })?,
    };
    if besatzung.is_some_and(|b| b.len() > BESATZUNG_MAX) {
        return Err(AppError::Validation(format!(
            "besatzung_ids: höchstens {BESATZUNG_MAX} Personen"
        )));
    }
    match art {
        AbloesungArt::Besatzung => {
            let ids = crate::kraefte_disposition::dedupe(besatzung.unwrap_or_default(), |id| *id);
            if ids.is_empty() {
                return Err(AppError::Validation(
                    "besatzung_ids fehlt: ein Besatzungswechsel braucht die neue Besatzung".into(),
                ));
            }
            if !abloeser.is_empty() {
                return Err(AppError::UnprocessableEntity(
                    "Beim Besatzungswechsel bleibt die Einheit; ablösende Einheiten gibt es nicht"
                        .into(),
                ));
            }
            if abschnitt_uebergeben {
                return Err(AppError::UnprocessableEntity(
                    "Beim Besatzungswechsel bleibt der Abschnitt bei der Einheit".into(),
                ));
            }
            Ok((art, ids))
        }
        AbloesungArt::Einheit => {
            if besatzung.is_some() {
                return Err(AppError::UnprocessableEntity(
                    "besatzung_ids gilt nur beim Besatzungswechsel (art: besatzung)".into(),
                ));
            }
            Ok((art, Vec::new()))
        }
    }
}

/// POST /api/einsaetze/{id}/abloesungen/{aid}/vollzug
pub async fn vollziehen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<Vollziehen>,
) -> Result<Json<AbloesungVollzugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let jetzt = jetzt();
    let vollzogen_at = zeit(req.vollzogen_at, "Vollzug")?.unwrap_or_else(|| jetzt.clone());
    let abloeser =
        abloeser_aus(req.abloeser_ids, req.abloesende_einheit_id.map(Some))?.unwrap_or_default();
    let (art, besatzung) = vollzug_art(
        req.art.as_deref(),
        req.besatzung_ids.as_deref(),
        &abloeser,
        req.abschnitt_uebergeben,
    )?;
    // Abschnittsübergabe und Besatzungswechsel schreiben, was sonst das Modul Einheiten schreibt
    // (Unterstellung, Personalzuordnung).
    let (verbleib, verbleib_br_id) =
        vollzug_verbleib(req.verbleib.as_deref(), req.verbleib_br_id, art)?;
    if req.abschnitt_uebergeben || art == AbloesungArt::Besatzung {
        ctx.fordere_zielmodul::<Einheiten>(&state.pool).await?;
    }
    // Der Eintritt in einen Raum schreibt, was sonst das Modul Bereitstellungsräume schreibt
    // (LLH-1308). Der Abruf eines Ablösers aus dem Raum ist Folge des Vollzugs und verlangt
    // nichts (design.md D5).
    if verbleib == AbloesungVerbleib::Bereitstellungsraum {
        ctx.fordere_zielmodul::<Bereitstellungsraeume>(&state.pool)
            .await?;
    }
    let (anzeige, etb_id, wirkung) = repo::vollziehen(
        &state.pool,
        einsatz_id,
        aid,
        ctx.benutzer.id,
        &VollzugEingabe {
            vollzogen_at,
            abloeser,
            abschnitt_uebergeben: req.abschnitt_uebergeben,
            art,
            besatzung,
            verbleib,
            verbleib_br_id,
        },
        &jetzt,
    )
    .await?;
    publiziere(&state, einsatz_id, Some(etb_id));
    publish_zeitachse(&state, einsatz_id, wirkung).await;
    Ok(Json(anzeige))
}

/// POST /api/einsaetze/{id}/abloesungen/{aid}/vollzug/zuruecknehmen
pub async fn zuruecknehmen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
) -> Result<Json<AbloesungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (anzeige, etb_id, wirkung) =
        repo::zuruecknehmen(&state.pool, einsatz_id, aid, ctx.benutzer.id, &jetzt()).await?;
    publiziere(&state, einsatz_id, Some(etb_id));
    publish_zeitachse(&state, einsatz_id, wirkung).await;
    Ok(Json(anzeige))
}

/// GET /api/einsaetze/{id}/abloesungen/vorgaben
pub async fn vorgaben(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Abloesung>,
) -> Result<Json<Vec<AbloesungVorgabeAnzeige>>, AppError> {
    Ok(Json(repo::vorgaben(&state.pool, ctx.einsatz.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct VorgabeSetzen {
    /// `null` = Vorgabe entfernen. Das Feld ist Pflicht (fehlt → 400), damit ein leerer Body
    /// nicht still als „entfernen" gelesen wird — serde nähme ein fehlendes `Option` sonst
    /// als `None`, deshalb der Tri-State.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    rhythmus_minuten: Option<Option<i64>>,
}

/// PUT /api/einsaetze/{id}/abloesungen/vorgaben/{abschnitt_id}
pub async fn vorgabe_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    PfadParam((_eid, abschnitt_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<VorgabeSetzen>,
) -> Result<Json<Vec<AbloesungVorgabeAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let rhythmus = req
        .rhythmus_minuten
        .ok_or_else(|| AppError::Validation("rhythmus_minuten fehlt (null = entfernen)".into()))?
        .map(pruefe_rhythmus)
        .transpose()?;
    let etb_id = repo::vorgabe_setzen(
        &state.pool,
        einsatz_id,
        abschnitt_id,
        ctx.benutzer.id,
        rhythmus,
        &jetzt(),
    )
    .await?;
    if etb_id.is_some() {
        publiziere(&state, einsatz_id, etb_id);
    }
    Ok(Json(repo::vorgaben(&state.pool, einsatz_id).await?))
}

/// GET /api/einsaetze/{id}/abloesungen/schichtmodell — Vorgabe des Einsatzes (LLH-1122).
pub async fn read_einsatz_vorgabe(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Abloesung>,
) -> Result<Json<AbloesungEinsatzVorgabeAnzeige>, AppError> {
    Ok(Json(
        repo::load_einsatz_vorgabe(&state.pool, ctx.einsatz.id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct SetEinsatzVorgabe {
    /// Kopie dieses Schichtmodells der Organisation.
    #[serde(default)]
    schichtmodell_id: Option<i64>,
    /// Eigene Werte; `null` = Vorgabe entfernen. Tri-State, damit ein leerer Body nicht still
    /// als „entfernen“ gelesen wird.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    schichtmodell: Option<Option<WerteBody>>,
}

impl SetEinsatzVorgabe {
    /// Genau eine der beiden Angaben: keine → 400 (fehlender Pflichtwert), beide → 422
    /// (Feld-Kombination). Die Werte prüft `WerteBody::check` (400/422).
    fn into_input(self) -> Result<EinsatzVorgabeInput, AppError> {
        // Erst die Werte für sich (400), dann der Zusammenhang (422).
        let werte = match self.schichtmodell {
            Some(Some(w)) => Some(Some(w.check()?)),
            Some(None) => Some(None),
            None => None,
        };
        match (self.schichtmodell_id, werte) {
            (None, None) => Err(AppError::Validation(
                "schichtmodell_id oder schichtmodell fehlt (schichtmodell: null = entfernen)"
                    .into(),
            )),
            (Some(_), Some(_)) => Err(AppError::UnprocessableEntity(
                "Entweder ein Schichtmodell der Organisation (schichtmodell_id) oder eigene Werte \
                 (schichtmodell), nicht beides"
                    .into(),
            )),
            (Some(id), None) => Ok(EinsatzVorgabeInput::FromStammdaten(id)),
            (None, Some(None)) => Ok(EinsatzVorgabeInput::Remove),
            (None, Some(Some(w))) => Ok(EinsatzVorgabeInput::Werte(w)),
        }
    }
}

/// PUT /api/einsaetze/{id}/abloesungen/schichtmodell — Vorgabe des Einsatzes setzen, aus den
/// Stammdaten kopieren oder entfernen; Rechte wie die Abschnittsvorgabe. Laufende Schichten mit
/// Quelle `einsatz` wandern mit (Repo).
pub async fn set_einsatz_vorgabe(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Abloesung>,
    JsonBody(req): JsonBody<SetEinsatzVorgabe>,
) -> Result<Json<AbloesungEinsatzVorgabeAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = req.into_input()?;
    let etb_id =
        repo::set_einsatz_vorgabe(&state.pool, einsatz_id, ctx.benutzer.id, &eingabe, &jetzt())
            .await?;
    if etb_id.is_some() {
        publiziere(&state, einsatz_id, etb_id);
    }
    Ok(Json(
        repo::load_einsatz_vorgabe(&state.pool, einsatz_id).await?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rhythmus_ausserhalb_ist_400() {
        for r in [0, -5, RHYTHMUS_MAX_MINUTEN + 1] {
            assert_eq!(
                pruefe_rhythmus(r).unwrap_err().status(),
                StatusCode::BAD_REQUEST
            );
        }
        assert_eq!(pruefe_rhythmus(1).unwrap(), 1);
        assert_eq!(
            pruefe_rhythmus(RHYTHMUS_MAX_MINUTEN).unwrap(),
            RHYTHMUS_MAX_MINUTEN
        );
    }

    #[test]
    fn abloeser_liste_begrenzt_und_entdoppelt() {
        let neun: Vec<i64> = (1..=9).collect();
        assert_eq!(
            check_abloeser(&neun).unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
        // Gezählt vor dem Entdoppeln: acht Einträge mit Dubletten sind erlaubt.
        assert_eq!(
            check_abloeser(&[3, 1, 3, 2, 1, 4, 5, 6]).unwrap(),
            vec![3, 1, 2, 4, 5, 6]
        );
        assert_eq!(check_abloeser(&[]).unwrap(), Vec::<i64>::new());
        assert_eq!(
            abloeser_aus(Some(vec![1]), Some(Some(2)))
                .unwrap_err()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(abloeser_aus(None, Some(None)).unwrap(), Some(vec![]));
        assert_eq!(abloeser_aus(None, Some(Some(7))).unwrap(), Some(vec![7]));
        assert_eq!(abloeser_aus(None, None).unwrap(), None);
    }

    /// LLH-1150: erst das Feld (400), dann der Zusammenhang (422).
    #[test]
    fn vollzug_art_prueft_feld_vor_zusammenhang() {
        let code = |r: Result<(AbloesungArt, Vec<i64>), AppError>| r.unwrap_err().status();
        assert_eq!(
            vollzug_art(None, None, &[3], true).unwrap(),
            (AbloesungArt::Einheit, vec![]),
            "ohne Art die ganze Einheit"
        );
        assert_eq!(
            code(vollzug_art(Some("fahrzeug"), None, &[], false)),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            code(vollzug_art(Some("besatzung"), Some(&[]), &[], false)),
            StatusCode::BAD_REQUEST,
            "leere neue Besatzung"
        );
        assert_eq!(
            code(vollzug_art(Some("besatzung"), None, &[], false)),
            StatusCode::BAD_REQUEST,
            "fehlende neue Besatzung"
        );
        let viele: Vec<i64> = (1..=BESATZUNG_MAX as i64 + 1).collect();
        assert_eq!(
            code(vollzug_art(Some("besatzung"), Some(&viele), &[7], false)),
            StatusCode::BAD_REQUEST,
            "Grenze vor dem Zusammenhang"
        );
        let genau: Vec<i64> = (1..=BESATZUNG_MAX as i64).collect();
        assert_eq!(
            vollzug_art(Some("besatzung"), Some(&genau), &[], false)
                .unwrap()
                .1
                .len(),
            BESATZUNG_MAX
        );
        assert_eq!(
            code(vollzug_art(Some("besatzung"), Some(&[1]), &[7], false)),
            StatusCode::UNPROCESSABLE_ENTITY,
            "mit ablösender Einheit"
        );
        assert_eq!(
            code(vollzug_art(Some("besatzung"), Some(&[1]), &[], true)),
            StatusCode::UNPROCESSABLE_ENTITY,
            "mit Abschnittsübergabe"
        );
        assert_eq!(
            code(vollzug_art(Some("einheit"), Some(&[1]), &[], false)),
            StatusCode::UNPROCESSABLE_ENTITY,
            "neue Besatzung ohne Besatzungswechsel"
        );
        assert_eq!(
            vollzug_art(Some("besatzung"), Some(&[4, 2, 4]), &[], false).unwrap(),
            (AbloesungArt::Besatzung, vec![4, 2]),
            "entdoppelt in der Reihenfolge"
        );
    }

    #[test]
    fn unparsbare_zeit_ist_400() {
        assert_eq!(
            zeit(Some("gestern".into()), "Beginn").unwrap_err().status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(zeit(Some("  ".into()), "Beginn").unwrap(), None);
        assert_eq!(zeit(None, "Beginn").unwrap(), None);
    }

    #[test]
    fn zeit_ausserhalb_des_jahresbereichs_ist_400() {
        for roh in ["0226-09-22 09:30:00", "+262142-12-31 23:30:00"] {
            let err = zeit(Some(roh.into()), "Beginn").unwrap_err();
            assert_eq!(err.status(), StatusCode::BAD_REQUEST, "{roh}");
        }
        assert_eq!(
            zeit(Some("2026-09-22T09:30:00Z".into()), "Beginn").unwrap(),
            Some("2026-09-22 09:30:00".into())
        );
    }
}
