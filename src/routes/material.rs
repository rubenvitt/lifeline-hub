use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::material::repo::{self, MaterialDaten, MaterialPatch};
use crate::material::MaterialAnzeige;
use crate::routes::support::{deserialize_optional_field, trimme, trimme_tri};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für das Anlegen (POST). Bewusst getrennt vom PATCH-Body: der POST muss seine
/// Pflichtfelder strukturell erzwingen (fehlende `bezeichnung` → 400 schon im Extractor).
#[derive(Debug, Deserialize)]
pub struct MaterialBody {
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub standort: Option<String>,
    pub bemerkung: Option<String>,
}

/// Owned, validierte Felder; `MaterialDaten` borgt daraus.
struct Normalisiert {
    bezeichnung: String,
    kategorie: Option<String>,
    bestandsnummer: Option<String>,
    traegerorganisation: Option<String>,
    standort: Option<String>,
    bemerkung: Option<String>,
}

impl Normalisiert {
    fn daten(&self) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung: &self.bezeichnung,
            kategorie: self.kategorie.as_deref(),
            bestandsnummer: self.bestandsnummer.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            standort: self.standort.as_deref(),
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: MaterialBody) -> Result<Normalisiert, AppError> {
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation(
            "Bezeichnung darf nicht leer sein".into(),
        ));
    }
    Ok(Normalisiert {
        bezeichnung,
        kategorie: trimme(body.kategorie),
        bestandsnummer: trimme(body.bestandsnummer),
        traegerorganisation: trimme(body.traegerorganisation),
        standort: trimme(body.standort),
        bemerkung: trimme(body.bemerkung),
    })
}

/// PATCH-Body (LFH-306, Tri-State): **jedes** Feld ist optional — absent = unverändert,
/// `null`/`""` = leeren. Alle fünf Zusatzfelder liegen auf nullable Spalten und tragen
/// deshalb den Tri-State-Deserializer; `bezeichnung` (NOT NULL) ist ein schlichtes
/// `Option<String>` **ohne** `#[serde(default)]` — ein `default` machte aus „nicht gesendet"
/// ein „auf Leerstring setzen", also genau den stillen Spalten-Reset, den LFH-306 beseitigt.
#[derive(Debug, Deserialize)]
pub struct PatchMaterial {
    pub bezeichnung: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kategorie: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bestandsnummer: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub traegerorganisation: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
}

/// Owned, validierte Patch-Felder; `MaterialPatch` borgt daraus.
struct PatchNormalisiert {
    bezeichnung: Option<String>,
    kategorie: Option<Option<String>>,
    bestandsnummer: Option<Option<String>>,
    traegerorganisation: Option<Option<String>>,
    standort: Option<Option<String>>,
    bemerkung: Option<Option<String>>,
}

impl PatchNormalisiert {
    fn patch(&self) -> MaterialPatch<'_> {
        MaterialPatch {
            bezeichnung: self.bezeichnung.as_deref(),
            kategorie: self.kategorie.as_ref().map(|v| v.as_deref()),
            bestandsnummer: self.bestandsnummer.as_ref().map(|v| v.as_deref()),
            traegerorganisation: self.traegerorganisation.as_ref().map(|v| v.as_deref()),
            standort: self.standort.as_ref().map(|v| v.as_deref()),
            bemerkung: self.bemerkung.as_ref().map(|v| v.as_deref()),
        }
    }
}

/// Prüft nur die **gesendeten** Felder. Ein vorhandenes, aber leeres Pflichtfeld ist 400
/// (Statuscode-Konvention LFH-305), ein absentes ist schlicht kein Wunsch — die Prüfung darf
/// nicht auf den Absent-Zweig durchschlagen, sonst wäre jeder Teil-Patch abgelehnt.
fn normalisiere_patch(body: PatchMaterial) -> Result<PatchNormalisiert, AppError> {
    let bezeichnung = match body.bezeichnung {
        Some(b) => {
            let b = b.trim().to_string();
            if b.is_empty() {
                return Err(AppError::Validation(
                    "Bezeichnung darf nicht leer sein".into(),
                ));
            }
            Some(b)
        }
        None => None,
    };
    Ok(PatchNormalisiert {
        bezeichnung,
        kategorie: trimme_tri(body.kategorie),
        bestandsnummer: trimme_tri(body.bestandsnummer),
        traegerorganisation: trimme_tri(body.traegerorganisation),
        standort: trimme_tri(body.standort),
        bemerkung: trimme_tri(body.bemerkung),
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/material — alle eingeloggten Nutzer (eigene Org).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<MaterialAnzeige>>, AppError> {
    let material = repo::liste(&state.pool, benutzer.org_id, params.nur_im_dienst).await?;
    Ok(Json(material.iter().map(|m| m.anzeige()).collect()))
}

/// GET /api/material-kategorien — abgeleitete Kategorie-Vorschläge (eigene Org).
pub async fn kategorien(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<String>>, AppError> {
    Ok(Json(repo::kategorien(&state.pool, benutzer.org_id).await?))
}

/// POST /api/material — Admin. Dublette Bestandsnummer → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<MaterialBody>,
) -> Result<(StatusCode, Json<MaterialAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let m = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(m.anzeige())))
}

/// PATCH /api/material/{id} — Admin, echter Teil-Patch (LFH-306): Feld absent =
/// unverändert, `null`/`""` = leeren. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<PatchMaterial>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let n = normalisiere_patch(body)?;
    let m = repo::patche(&state.pool, benutzer.org_id, id, n.patch()).await?;
    Ok(Json(m.anzeige()))
}

/// POST /api/material/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let m = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(m.anzeige()))
}

/// POST /api/material/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Nummernkollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<MaterialAnzeige>, AppError> {
    let m = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(m.anzeige()))
}
