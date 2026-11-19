//! Übersicht der Verwaltung (LLH-1820, Entwurf
//! `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`).
//!
//! `GET /api/verwaltung/bereitschaft` zählt den Bestand der eigenen Organisation. Er liefert nur
//! Zahlen und keine Namen, denn die Übersicht sehen auch Führungskräfte, die die Benutzerliste
//! nicht lesen dürfen. Ob etwas „fehlt“, wertet der Client (`frontend/src/admin/bereitschaft.ts`).

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::error::AppError;

/// Bestand der Bereitschaft. Demo-Zeilen (`demo_herkunft`, LFH-733) zählen nicht zum Bestand.
/// Sie stehen getrennt in den `*_demo`-Feldern.
#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct Bereitschaft {
    /// Aktive Personenkonten der Org, ohne Geräte-, Stellvertreter- und Archivkonten.
    pub benutzer: i64,
    /// Fahrzeuge im Dienst.
    pub fahrzeuge: i64,
    pub fahrzeuge_demo: i64,
    /// Personal im Dienst.
    pub personal: i64,
    pub personal_demo: i64,
    /// Aktive Einheiten-Vorlagen.
    pub einheit_vorlagen: i64,
    pub einheit_vorlagen_demo: i64,
    pub einsatz_vorlagen: i64,
}

/// Unterabfrage für einen Bestand mit Demo-Marke: `demo` wählt Demo- oder eigene Zeilen.
fn zaehle(tabelle: &str, bedingung: &str, demo: bool) -> String {
    let nicht = if demo { "" } else { "NOT " };
    format!(
        "(SELECT COUNT(*) FROM {tabelle} x WHERE x.org_id = ?1 AND {bedingung} AND {nicht}EXISTS \
           (SELECT 1 FROM demo_herkunft d WHERE d.tabelle = '{tabelle}' AND d.datensatz_id = x.id))"
    )
}

/// GET /api/verwaltung/bereitschaft — nur mit Zugang zur Verwaltung (`darf_admin_bereich`).
pub async fn bereitschaft(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Bereitschaft>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let fahrzeug = "x.dienststatus = 'in_dienst'";
    let personal = "x.dienststatus = 'in_dienst'";
    let vorlage = "x.aktiv = 1";
    let sql = format!(
        "SELECT \
           (SELECT COUNT(*) FROM benutzer b WHERE b.org_id = ?1 AND b.aktiv = 1 AND {} AND {}) \
             AS benutzer, \
           {} AS fahrzeuge, {} AS fahrzeuge_demo, \
           {} AS personal, {} AS personal_demo, \
           {} AS einheit_vorlagen, {} AS einheit_vorlagen_demo, \
           (SELECT COUNT(*) FROM einsatz_vorlage WHERE org_id = ?1) AS einsatz_vorlagen",
        crate::geraet::repo::OHNE_GERAETEKONTEN,
        crate::instanz::spiegel::OHNE_STELLVERTRETER,
        zaehle("fahrzeug", fahrzeug, false),
        zaehle("fahrzeug", fahrzeug, true),
        zaehle("personal", personal, false),
        zaehle("personal", personal, true),
        zaehle("einheit_vorlage", vorlage, false),
        zaehle("einheit_vorlage", vorlage, true),
    );
    let stand = sqlx::query_as::<_, Bereitschaft>(sqlx::AssertSqlSafe(sql))
        .bind(benutzer.org_id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(stand))
}
