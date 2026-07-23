use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::etb::MeldeWeg;
use crate::etb_baustein::repo::{self, BausteinDaten, BausteinPatch};
use crate::etb_baustein::{BausteinTyp, EtbBaustein};
use crate::extract::JsonBody;
use crate::routes::support::{deserialize_optional_field, trimme, trimme_tri};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct BausteinBody {
    pub label: String,
    pub typ: String,
    pub inhalt: String,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

struct Normalisiert {
    label: String,
    typ: String,
    inhalt: String,
    meldeweg: Option<String>,
    veranlassung: Option<String>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> BausteinDaten<'_> {
        BausteinDaten {
            label: &self.label,
            typ: &self.typ,
            inhalt: &self.inhalt,
            meldeweg: self.meldeweg.as_deref(),
            veranlassung: self.veranlassung.as_deref(),
            sortier: self.sortier,
        }
    }
}

fn normalisiere(body: BausteinBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    let inhalt = body.inhalt.trim().to_string();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }
    // Typ muss erfassbar (kein 'system') und keine 'berichtigung' sein.
    let typ = BausteinTyp::parse(&body.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger Baustein-Typ".into()))?;

    let meldeweg = trimme(body.meldeweg);
    if let Some(w) = &meldeweg {
        if MeldeWeg::parse(w).is_none() {
            return Err(AppError::Validation("Ungültiger Meldeweg".into()));
        }
    }

    Ok(Normalisiert {
        label,
        typ: typ.as_str().to_string(),
        inhalt,
        meldeweg,
        veranlassung: trimme(body.veranlassung),
        sortier: body.sortier,
    })
}

/// PATCH-Body (LFH-306, Tri-State): **jedes** Feld ist optional — absent = unverändert.
/// Bewusst getrennt von [`BausteinBody`]: der POST muss `label`/`typ`/`inhalt` weiterhin
/// strukturell erzwingen (fehlendes Feld → 400 schon im Extractor).
///
/// **Kein `#[serde(default)]` an `sortier`** — ein `default` auf einem NOT-NULL-Feld macht
/// aus „nicht gesendet" ein „auf 0 setzen", der stille Spalten-Reset, den LFH-306 beseitigt.
#[derive(Debug, Deserialize)]
pub struct PatchBaustein {
    pub label: Option<String>,
    pub typ: Option<String>,
    pub inhalt: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub meldeweg: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub veranlassung: Option<Option<String>>,
    pub sortier: Option<i64>,
}

struct PatchNormalisiert {
    label: Option<String>,
    typ: Option<String>,
    inhalt: Option<String>,
    meldeweg: Option<Option<String>>,
    veranlassung: Option<Option<String>>,
    sortier: Option<i64>,
}

impl PatchNormalisiert {
    fn patch(&self) -> BausteinPatch<'_> {
        BausteinPatch {
            label: self.label.as_deref(),
            typ: self.typ.as_deref(),
            inhalt: self.inhalt.as_deref(),
            meldeweg: self.meldeweg.as_ref().map(|v| v.as_deref()),
            veranlassung: self.veranlassung.as_ref().map(|v| v.as_deref()),
            sortier: self.sortier,
        }
    }
}

/// Trimmt ein gesendetes Pflichtfeld und lehnt es leer ab (400, LFH-305-Konvention);
/// ein absentes Feld ist schlicht kein Wunsch und passiert unangetastet.
fn pflicht_tri(wert: Option<String>, feld: &str) -> Result<Option<String>, AppError> {
    match wert {
        Some(w) => {
            let w = w.trim().to_string();
            if w.is_empty() {
                return Err(AppError::Validation(format!("{feld} darf nicht leer sein")));
            }
            Ok(Some(w))
        }
        None => Ok(None),
    }
}

/// Prüft nur die **gesendeten** Felder. Die Enum-Prüfungen (`typ`, `meldeweg`) dürfen nicht
/// auf den Absent-Zweig durchschlagen, sonst wäre jeder Teil-Patch abgelehnt. Bei `meldeweg`
/// gilt zusätzlich: `Some(None)` ist der Leerwunsch und hat keinen Wert zu validieren.
fn normalisiere_patch(body: PatchBaustein) -> Result<PatchNormalisiert, AppError> {
    let label = pflicht_tri(body.label, "Label")?;
    let inhalt = pflicht_tri(body.inhalt, "Inhalt")?;
    // Typ muss erfassbar (kein 'system') und keine 'berichtigung' sein — nur wenn gesendet.
    let typ = match body.typ {
        Some(t) => Some(
            BausteinTyp::parse(&t)
                .ok_or_else(|| AppError::Validation("Ungültiger Baustein-Typ".into()))?
                .as_str()
                .to_string(),
        ),
        None => None,
    };

    let meldeweg = trimme_tri(body.meldeweg);
    if let Some(Some(w)) = &meldeweg {
        if MeldeWeg::parse(w).is_none() {
            return Err(AppError::Validation("Ungültiger Meldeweg".into()));
        }
    }

    Ok(PatchNormalisiert {
        label,
        typ,
        inhalt,
        meldeweg,
        veranlassung: trimme_tri(body.veranlassung),
        sortier: body.sortier,
    })
}

/// GET /api/etb-bausteine — aktive Katalog-Einträge (eigene Org), für Schnellbausteine.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EtbBaustein>>, AppError> {
    Ok(Json(repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/etb-bausteine — Admin. Neuen Baustein anlegen.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<BausteinBody>,
) -> Result<(StatusCode, Json<EtbBaustein>), AppError> {
    let n = normalisiere(body)?;
    let b = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(b)))
}

/// PATCH /api/etb-bausteine/{id} — Admin, echter Teil-Patch (LFH-306):
/// Feld absent = unverändert, `null`/`""` bei `meldeweg`/`veranlassung` = leeren.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    JsonBody(body): JsonBody<PatchBaustein>,
) -> Result<Json<EtbBaustein>, AppError> {
    let n = normalisiere_patch(body)?;
    let b = repo::patche(&state.pool, benutzer.org_id, id, n.patch()).await?;
    Ok(Json(b))
}

/// POST /api/etb-bausteine/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
