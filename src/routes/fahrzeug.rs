use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::fahrzeug::repo::{self, FahrzeugDaten};
use crate::fahrzeug::{FahrzeugAnzeige, FahrzeugVorschlaege};
use crate::staerke::Staerke;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Body für Anlegen + Vollersatz-PATCH (gleiche editierbaren Felder).
#[derive(Debug, Deserialize)]
pub struct FahrzeugBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub traegerorganisation: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub standort: Option<String>,
    pub fms_issi: Option<String>,
    #[serde(default)]
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke_fuehrer: Option<i64>,
    pub staerke_unterfuehrer: Option<i64>,
    pub staerke_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
}

/// Trimmt einen optionalen String und verwirft ihn, wenn er leer ist.
fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Owned, validierte Felder; `FahrzeugDaten` borgt daraus.
struct Normalisiert {
    funkrufname: String,
    fahrzeugtyp: Option<String>,
    traegerorganisation: Option<String>,
    kennzeichen: Option<String>,
    opta: Option<String>,
    standort: Option<String>,
    fms_issi: Option<String>,
    sondersignal: bool,
    tragenkapazitaet: Option<i64>,
    staerke: Option<Staerke>,
    bemerkung: Option<String>,
}

impl Normalisiert {
    fn daten(&self) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname: &self.funkrufname,
            fahrzeugtyp: self.fahrzeugtyp.as_deref(),
            traegerorganisation: self.traegerorganisation.as_deref(),
            kennzeichen: self.kennzeichen.as_deref(),
            opta: self.opta.as_deref(),
            standort: self.standort.as_deref(),
            fms_issi: self.fms_issi.as_deref(),
            sondersignal: self.sondersignal,
            tragenkapazitaet: self.tragenkapazitaet,
            staerke: self.staerke,
            bemerkung: self.bemerkung.as_deref(),
        }
    }
}

fn normalisiere(body: FahrzeugBody) -> Result<Normalisiert, AppError> {
    let funkrufname = body.funkrufname.trim().to_string();
    if funkrufname.is_empty() {
        return Err(AppError::Validation(
            "Funkrufname darf nicht leer sein".into(),
        ));
    }
    let staerke = Staerke::aus_optionen(
        body.staerke_fuehrer,
        body.staerke_unterfuehrer,
        body.staerke_mannschaft,
    )
    .map_err(AppError::Validation)?;
    Ok(Normalisiert {
        funkrufname,
        fahrzeugtyp: trimme(body.fahrzeugtyp),
        traegerorganisation: trimme(body.traegerorganisation),
        kennzeichen: trimme(body.kennzeichen),
        opta: trimme(body.opta),
        standort: trimme(body.standort),
        fms_issi: trimme(body.fms_issi),
        sondersignal: body.sondersignal,
        tragenkapazitaet: body.tragenkapazitaet,
        staerke,
        bemerkung: trimme(body.bemerkung),
    })
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    #[serde(default)]
    pub nur_im_dienst: bool,
}

/// GET /api/fahrzeuge — alle eingeloggten Nutzer (eigene Org).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<FahrzeugAnzeige>>, AppError> {
    let fahrzeuge = repo::liste(&state.pool, benutzer.org_id, params.nur_im_dienst).await?;
    Ok(Json(fahrzeuge.iter().map(|f| f.anzeige()).collect()))
}

/// GET /api/fahrzeug-vorschlaege — abgeleitete AutoComplete-Vorschläge (eigene Org)
/// für Fahrzeugtyp, Trägerorganisation und Standort.
pub async fn vorschlaege(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<FahrzeugVorschlaege>, AppError> {
    Ok(Json(repo::vorschlaege(&state.pool, benutzer.org_id).await?))
}

/// POST /api/fahrzeuge — Admin. Dublette Funkrufname → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<FahrzeugBody>,
) -> Result<(StatusCode, Json<FahrzeugAnzeige>), AppError> {
    let n = normalisiere(body)?;
    let f = repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(f.anzeige())))
}

/// PATCH /api/fahrzeuge/{id} — Admin, Vollersatz. NotFound bei fremder/unbek. id.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<FahrzeugBody>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let n = normalisiere(body)?;
    let f = repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(f.anzeige()))
}

/// POST /api/fahrzeuge/{id}/ausser-dienst — Admin (Soft-Delete).
pub async fn ausser_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let f = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, false).await?;
    Ok(Json(f.anzeige()))
}

/// POST /api/fahrzeuge/{id}/in-dienst — Admin (Reaktivierung; Conflict bei Namenskollision).
pub async fn in_dienst(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<FahrzeugAnzeige>, AppError> {
    let f = repo::setze_dienststatus(&state.pool, benutzer.org_id, id, true).await?;
    Ok(Json(f.anzeige()))
}
