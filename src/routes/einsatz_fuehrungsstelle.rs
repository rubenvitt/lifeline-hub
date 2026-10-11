//! Die eigene Führungsstelle eines Einsatzes (LFH-849): `GET`/`PATCH
//! /api/einsaetze/{id}/fuehrungsstelle`.
//!
//! Lesen mit dem Einsatz (kein Modul), Schreiben mit den Rechten der Kopfdaten. Eine Änderung
//! meldet das Ereignis `einsatz` über `routes::einsatz::kopf_geaendert` (Spec `einsatzkopf-live`).
//! Herleitung: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D2, D3).
//! Der Einsatzleiter (LFH-1199) schreibt bei einem Wechsel zusätzlich einen Übergabe-Eintrag ins
//! ETB und meldet ihn nach dem Commit: `openspec/changes/lfh-1199-einsatzleiter-angabe/design.md`
//! (D2, D3).

use crate::app::AppState;
use crate::einsatz::fuehrungsstelle::{
    self, EinsatzleiterArt, EinsatzleiterEingabe, FuehrungsstelleAnzeige, FuehrungsstellePatch,
    Schreiber, EINSATZLEITER_NAME_MAX,
};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzVerwaltungszugriff};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::{deserialize_optional_field, pruefe_kommunikationsmittel, trimme_tri};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// PATCH-Body, Tri-State je Feld: absent = unverändert, `null`/`""` = leeren.
#[derive(Debug, Deserialize)]
pub struct FuehrungsstellePatchBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub rufname: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kommunikationsmittel: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub erreichbarkeit: Option<Option<String>>,
    /// Ersetzt die Zuordnung vollständig; `null` oder `[]` leert sie, absent lässt sie
    /// unverändert.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub sprechgruppe_ids: Option<Option<Vec<i64>>>,
    /// Dispositionszeilen, die die Führungsstelle tragen (LFH-1106); ersetzt wie
    /// `sprechgruppe_ids`.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub fahrzeug_ids: Option<Option<Vec<i64>>>,
    /// Der Einsatzleiter (LFH-1199); `null` leert ihn.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub einsatzleiter: Option<Option<EinsatzleiterBody>>,
}

/// Ein neuer Einsatzleiter: `personal` mit `personal_id` oder `extern` mit `name`; `seit` fehlt =
/// jetzt.
#[derive(Debug, Deserialize)]
pub struct EinsatzleiterBody {
    pub art: String,
    #[serde(default)]
    pub personal_id: Option<i64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub seit: Option<String>,
}

/// Der geprüfte Einsatzleiter: Art und Name einzeln 400, Zusammenhänge 422 (`src/AGENTS.md`,
/// Statuscode-Konvention). Die Zugehörigkeit der Person prüft die Transaktion.
struct CheckedEinsatzleiter {
    art: EinsatzleiterArt,
    personal_id: Option<i64>,
    name: Option<String>,
    seit: String,
}

fn check_einsatzleiter(body: EinsatzleiterBody) -> Result<CheckedEinsatzleiter, AppError> {
    let art = EinsatzleiterArt::try_from(body.art).map_err(AppError::Validation)?;
    let name_gesendet = body.name.is_some();
    let name = body
        .name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    if let Some(n) = &name {
        crate::routes::support::hoechstens(n, "Name des Einsatzleiters", EINSATZLEITER_NAME_MAX)?;
    }
    let jetzt = crate::zeit::jetzt();
    let seit = match body
        .seit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // Ein Tippfehler im Jahr landete sonst als Ereigniszeit im ETB (LFH-924).
        Some(roh) => crate::zeit::im_jahresbereich(crate::etb::normalisiere_zeit(roh)?, "seit")?,
        None => jetzt.clone(),
    };
    match art {
        EinsatzleiterArt::Personal => {
            if body.personal_id.is_none() {
                return Err(AppError::Validation("personal_id fehlt".into()));
            }
            if name_gesendet {
                return Err(AppError::UnprocessableEntity(
                    "Eine Person trägt ihren Namen aus dem Personal, keinen Freitext".into(),
                ));
            }
        }
        EinsatzleiterArt::Extern => {
            if body.personal_id.is_some() {
                return Err(AppError::UnprocessableEntity(
                    "Ein externer Einsatzleiter hat keine Person aus dem Personal".into(),
                ));
            }
            if name.is_none() {
                return Err(AppError::Validation(
                    "Name des externen Einsatzleiters fehlt".into(),
                ));
            }
        }
    }
    // Uhrabweichung wie die Zeitachse.
    let grenze = crate::zeit::plus_minuten(&jetzt, crate::routes::zeitachse::UHRENTOLERANZ_MINUTEN)
        .unwrap_or_else(|| jetzt.clone());
    if seit > grenze {
        return Err(AppError::UnprocessableEntity(
            "„seit“ liegt in der Zukunft".into(),
        ));
    }
    Ok(CheckedEinsatzleiter {
        art,
        personal_id: body.personal_id,
        name,
        seit,
    })
}

/// GET /api/einsaetze/{id}/fuehrungsstelle — ohne erfasste Angaben alles leer (200).
pub async fn lesen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<FuehrungsstelleAnzeige>, AppError> {
    Ok(Json(
        fuehrungsstelle::load(&state.pool, ctx.einsatz.id).await?,
    ))
}

/// PATCH /api/einsaetze/{id}/fuehrungsstelle — echter Teil-Patch. Prüfungen vor dem Schreiben,
/// das Schreiben in EINER Transaktion: ein Fehler speichert nichts teilweise.
pub async fn aendern(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    JsonBody(body): JsonBody<FuehrungsstellePatchBody>,
) -> Result<Json<FuehrungsstelleAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Liste vor jedem Schreiben begrenzen (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
    let ids: Option<Vec<i64>> = body
        .sprechgruppe_ids
        .map(Option::unwrap_or_default)
        .map(crate::sprechgruppe::normalisiere_ids)
        .transpose()?;
    let fahrzeug_ids: Option<Vec<i64>> = body
        .fahrzeug_ids
        .map(Option::unwrap_or_default)
        .map(fuehrungsstelle::normalisiere_fahrzeug_ids)
        .transpose()?;
    let rufname = trimme_tri(body.rufname);
    let mittel = trimme_tri(body.kommunikationsmittel);
    pruefe_kommunikationsmittel(mittel.as_ref().and_then(|v| v.as_deref()))?;
    let erreichbarkeit = trimme_tri(body.erreichbarkeit);
    let einsatzleiter: Option<Option<CheckedEinsatzleiter>> = body
        .einsatzleiter
        .map(|e| e.map(check_einsatzleiter).transpose())
        .transpose()?;
    // Ein leerer Patch ändert nichts: keine Zeile, kein Ereignis.
    if rufname.is_none()
        && mittel.is_none()
        && erreichbarkeit.is_none()
        && ids.is_none()
        && fahrzeug_ids.is_none()
        && einsatzleiter.is_none()
    {
        return Ok(Json(fuehrungsstelle::load(&state.pool, einsatz_id).await?));
    }
    if let Some(ids) = &ids {
        crate::sprechgruppe::repo::pruefe_zuordenbar(
            &state.pool,
            ctx.einsatz.org_id,
            einsatz_id,
            ids,
        )
        .await?;
    }
    if let Some(ids) = &fahrzeug_ids {
        fuehrungsstelle::pruefe_fahrzeuge(&state.pool, einsatz_id, ids).await?;
    }
    let patch = FuehrungsstellePatch {
        rufname: rufname.as_ref().map(|v| v.as_deref()),
        kommunikationsmittel: mittel.as_ref().map(|v| v.as_deref()),
        erreichbarkeit: erreichbarkeit.as_ref().map(|v| v.as_deref()),
        sprechgruppe_ids: ids.as_deref(),
        fahrzeug_ids: fahrzeug_ids.as_deref(),
        einsatzleiter: einsatzleiter.as_ref().map(|e| {
            e.as_ref()
                .map(|e| match (e.art, e.personal_id, e.name.as_deref()) {
                    (EinsatzleiterArt::Personal, Some(personal_id), _) => {
                        EinsatzleiterEingabe::Personal {
                            personal_id,
                            seit: &e.seit,
                        }
                    }
                    (_, _, name) => EinsatzleiterEingabe::Extern {
                        name: name.unwrap_or_default(),
                        seit: &e.seit,
                    },
                })
        }),
    };
    let schreiber = Schreiber {
        benutzer_id: ctx.benutzer.id,
        etb_startwert: crate::einsatz::einstellungen::etb_startwert(&state.pool, einsatz_id)
            .await?,
    };
    let (anzeige, etb_id) = crate::write_retry!(&state.pool, |conn| {
        fuehrungsstelle::patch_tx(conn, einsatz_id, schreiber, &patch).await
    })?;
    // Erst nach dem Commit (Reinheits-Kontrakt), wie jeder `einsatz`-Emitter; der Übergabe-Eintrag
    // braucht seinen eigenen Kurzruf, sonst bliebe das ETB anderer Schirme still veraltet.
    crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    Ok(Json(anzeige))
}

/// PUT /api/einsaetze/{id}/fuehrungsstelle/sprechgruppen/{sg} — eine Sprechgruppe zuordnen
/// (LFH-893, design.md D5). Idempotent; dieselbe Prüfung, Zuordnung und Live-Wirkung (`einsatz`)
/// wie der PATCH mit `sprechgruppe_ids`, kein ETB.
pub async fn sprechgruppe_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    PfadParam((_eid, sg)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ziel = crate::sprechgruppe::repo::Zuordnungsziel::Fuehrungsstelle(einsatz_id);
    if crate::sprechgruppe::repo::einzeln_zuordnen(
        &state.pool,
        ctx.einsatz.org_id,
        einsatz_id,
        ziel,
        sg,
    )
    .await?
    {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/fuehrungsstelle/sprechgruppen/{sg} — Zuordnung lösen, idempotent.
pub async fn sprechgruppe_loesen(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    PfadParam((_eid, sg)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ziel = crate::sprechgruppe::repo::Zuordnungsziel::Fuehrungsstelle(einsatz_id);
    if crate::sprechgruppe::repo::einzeln_loesen(&state.pool, einsatz_id, ziel, sg).await? {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    Ok(StatusCode::NO_CONTENT)
}
