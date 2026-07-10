use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::katalog::Betriebsart;
use crate::sprechgruppe::repo as sg_repo;
use crate::sprechgruppe::{Sprechgruppe, SprechgruppeAnzeige};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

// ---------------------------------------------------------------------------
// Request-Bodies
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct KatalogBody {
    pub bezeichnung: String,
    pub betriebsart: String,
    pub hinweis: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

#[derive(Debug, Deserialize)]
pub struct EinsatzLokalBody {
    pub bezeichnung: String,
    pub betriebsart: String,
    pub hinweis: Option<String>,
}

// ---------------------------------------------------------------------------
// Normalisierte / validierte Repräsentation (Katalog)
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct NormalisierterKatalog {
    bezeichnung: String,
    betriebsart: String,
    hinweis: Option<String>,
    sortier: i64,
}

impl NormalisierterKatalog {
    fn daten(&self) -> sg_repo::KatalogDaten<'_> {
        sg_repo::KatalogDaten {
            bezeichnung: &self.bezeichnung,
            betriebsart: &self.betriebsart,
            hinweis: self.hinweis.as_deref(),
            sortier: self.sortier,
        }
    }
}

/// Trimmt `bezeichnung` (leer → `Validation`), prüft `betriebsart` via
/// `ist_gueltige_betriebsart` (ungültig → `Validation`), trimmt `hinweis`
/// (leer → `None`).
fn normalisiere_katalog(body: KatalogBody) -> Result<NormalisierterKatalog, AppError> {
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    if Betriebsart::parse(&body.betriebsart).is_none() {
        return Err(AppError::Validation(format!(
            "Ungültige Betriebsart «{}» — erlaubt: TMO, DMO",
            body.betriebsart
        )));
    }
    let hinweis = body.hinweis.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Ok(NormalisierterKatalog { bezeichnung, betriebsart: body.betriebsart, hinweis, sortier: body.sortier })
}

// ---------------------------------------------------------------------------
// Normalisierung einsatz-lokal
// ---------------------------------------------------------------------------

struct NormalisierterLokal {
    bezeichnung: String,
    betriebsart: String,
    hinweis: Option<String>,
}

fn normalisiere_lokal(body: EinsatzLokalBody) -> Result<NormalisierterLokal, AppError> {
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    if Betriebsart::parse(&body.betriebsart).is_none() {
        return Err(AppError::Validation(format!(
            "Ungültige Betriebsart «{}» — erlaubt: TMO, DMO",
            body.betriebsart
        )));
    }
    let hinweis = body.hinweis.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Ok(NormalisierterLokal { bezeichnung, betriebsart: body.betriebsart, hinweis })
}

// ---------------------------------------------------------------------------
// Query-Struct für Katalog-Liste
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ListeQuery {
    pub nur_aktive: Option<bool>,
}

// ---------------------------------------------------------------------------
// Handler: Katalog
// ---------------------------------------------------------------------------

/// GET /api/sprechgruppen — aktive Katalog-Einträge der eigenen Org.
/// Query-Param `nur_aktive` (default: true). Alle eingeloggten Nutzer.
pub async fn liste_katalog(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(q): Query<ListeQuery>,
) -> Result<Json<Vec<SprechgruppeAnzeige>>, AppError> {
    let nur_aktive = q.nur_aktive.unwrap_or(true);
    let sgs = sg_repo::liste_katalog(&state.pool, benutzer.org_id, nur_aktive).await?;
    Ok(Json(sgs.iter().map(Sprechgruppe::anzeige).collect()))
}

/// POST /api/sprechgruppen — Admin. Dublette → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<KatalogBody>,
) -> Result<(StatusCode, Json<SprechgruppeAnzeige>), AppError> {
    let n = normalisiere_katalog(body)?;
    let sg = sg_repo::anlegen_katalog(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(sg.anzeige())))
}

/// PATCH /api/sprechgruppen/{id} — Admin, Vollersatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<KatalogBody>,
) -> Result<Json<SprechgruppeAnzeige>, AppError> {
    let n = normalisiere_katalog(body)?;
    let sg = sg_repo::aktualisiere_katalog(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(sg.anzeige()))
}

/// POST /api/sprechgruppen/{id}/deaktivieren — Admin (Soft-Delete).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    sg_repo::deaktiviere(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Handler: Einsatz-scoped
// ---------------------------------------------------------------------------

/// GET /api/einsaetze/{einsatz_id}/sprechgruppen — aktiver Katalog + einsatz-lokal.
/// Lesezugriff erforderlich; kein Modul-Key (Sprechgruppen sind modulübergreifend).
pub async fn liste_fuer_einsatz(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<SprechgruppeAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    // org_id kommt vom Einsatz, nicht vom Aufrufer (Cross-Org-Zugriff möglich).
    let sgs = sg_repo::liste_fuer_einsatz(&state.pool, einsatz.org_id, einsatz_id).await?;
    Ok(Json(sgs.iter().map(Sprechgruppe::anzeige).collect()))
}

/// POST /api/einsaetze/{einsatz_id}/sprechgruppen — einsatz-lokale Sprechgruppe anlegen.
/// Schreibrecht + aktiver Einsatz; kein Modul-Key.
pub async fn anlegen_einsatz_lokal(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<EinsatzLokalBody>,
) -> Result<(StatusCode, Json<SprechgruppeAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    let n = normalisiere_lokal(body)?;
    // org_id kommt vom Einsatz, nicht vom Aufrufer (Cross-Org-Zugriff möglich).
    let sg = sg_repo::anlegen_einsatz_lokal(
        &state.pool,
        einsatz.org_id,
        einsatz_id,
        &n.bezeichnung,
        &n.betriebsart,
        n.hinweis.as_deref(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(sg.anzeige())))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalisiere_leere_bezeichnung_ist_validation() {
        let b = KatalogBody { bezeichnung: "  ".into(), betriebsart: "TMO".into(), hinweis: None, sortier: 0 };
        assert!(matches!(normalisiere_katalog(b).unwrap_err(), AppError::Validation(_)));
    }

    #[test]
    fn normalisiere_ungueltige_betriebsart_ist_validation() {
        let b = KatalogBody { bezeichnung: "412".into(), betriebsart: "XX".into(), hinweis: None, sortier: 0 };
        assert!(matches!(normalisiere_katalog(b).unwrap_err(), AppError::Validation(_)));
    }

    #[test]
    fn normalisiere_ok_trimmt() {
        let b = KatalogBody { bezeichnung: " 412 ".into(), betriebsart: "TMO".into(), hinweis: Some("  ".into()), sortier: 0 };
        let n = normalisiere_katalog(b).unwrap();
        assert_eq!(n.bezeichnung, "412");
        assert_eq!(n.hinweis, None);
    }
}
