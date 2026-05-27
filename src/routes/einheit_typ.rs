use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einheit::typ_repo::{self, TypDaten};
use crate::einheit::EinheitTyp;
use crate::error::AppError;
use crate::staerke::Staerke;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct TypBody {
    pub label: String,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    #[serde(default)]
    pub sortier: i64,
}

#[derive(Debug)]
struct Normalisiert {
    label: String,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    sortier: i64,
}

impl Normalisiert {
    fn daten(&self) -> TypDaten<'_> {
        TypDaten {
            label: &self.label,
            soll_fuehrer: self.soll_fuehrer,
            soll_unterfuehrer: self.soll_unterfuehrer,
            soll_mannschaft: self.soll_mannschaft,
            sortier: self.sortier,
        }
    }
}

/// Trimmt das Label und validiert die Soll-Regel „alle drei oder keiner" über
/// `Staerke::aus_optionen` (mappt String-Fehler auf `Validation`).
fn normalisiere(body: TypBody) -> Result<Normalisiert, AppError> {
    let label = body.label.trim().to_string();
    if label.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    // Validierung der Vollständigkeit/Bereiche; Rückgabewert verwerfen wir, wir
    // speichern die rohen Optionen (durch aus_optionen als konsistent bestätigt).
    Staerke::aus_optionen(body.soll_fuehrer, body.soll_unterfuehrer, body.soll_mannschaft)
        .map_err(AppError::Validation)?;
    Ok(Normalisiert {
        label,
        soll_fuehrer: body.soll_fuehrer,
        soll_unterfuehrer: body.soll_unterfuehrer,
        soll_mannschaft: body.soll_mannschaft,
        sortier: body.sortier,
    })
}

/// GET /api/einheit-typen — aktive Katalog-Einträge der eigenen Org (für Auswahl).
/// Alle eingeloggten Nutzer.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinheitTyp>>, AppError> {
    Ok(Json(typ_repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/einheit-typen — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<TypBody>,
) -> Result<(StatusCode, Json<EinheitTyp>), AppError> {
    let n = normalisiere(body)?;
    let t = typ_repo::anlegen(&state.pool, benutzer.org_id, n.daten()).await?;
    Ok((StatusCode::CREATED, Json(t)))
}

/// PATCH /api/einheit-typen/{id} — Admin, Vollersatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<TypBody>,
) -> Result<Json<EinheitTyp>, AppError> {
    let n = normalisiere(body)?;
    let t = typ_repo::aktualisiere(&state.pool, benutzer.org_id, id, n.daten()).await?;
    Ok(Json(t))
}

/// POST /api/einheit-typen/{id}/deaktivieren — Admin (Soft-Delete).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    typ_repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(label: &str, soll: Option<(i64, i64, i64)>) -> TypBody {
        let (f, u, m) = match soll {
            Some((f, u, m)) => (Some(f), Some(u), Some(m)),
            None => (None, None, None),
        };
        TypBody { label: label.into(), soll_fuehrer: f, soll_unterfuehrer: u, soll_mannschaft: m, sortier: 0 }
    }

    #[test]
    fn normalisiere_leeres_label_ist_validation() {
        assert!(matches!(normalisiere(body("   ", None)).unwrap_err(), AppError::Validation(_)));
    }

    #[test]
    fn normalisiere_teilweise_soll_ist_validation() {
        let mut b = body("Zug", None);
        b.soll_fuehrer = Some(1); // nur einer gesetzt
        assert!(matches!(normalisiere(b).unwrap_err(), AppError::Validation(_)));
    }

    #[test]
    fn normalisiere_vollstaendig_ok() {
        assert!(normalisiere(body("Zug", Some((1, 3, 18)))).is_ok());
        assert!(normalisiere(body("Sonstige", None)).is_ok());
    }
}
