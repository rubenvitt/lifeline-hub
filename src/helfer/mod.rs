//! Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, ADR-0101):
//! Helfende melden sich per Einsatz-QR selbst an und senden ihre Position an ein Ziel (Einheit
//! oder Fahrzeug, optional die Person).
//!
//! - [`einladung`]: die Helfer-Einladung der Leitung (Code, Gültigkeit, Widerruf, Einlösen).
//! - [`anmeldung`]: Zielliste, Prüfung des Ziels und der eigene Zustand des Geräts.
//! - [`bestaetigung`]: Bestätigen durch die Leitung, Ziel, Person und Ortungsgerät.
//! - [`position`]: Position senden und pausieren.
//! - [`ende`]: die Personenposition endet mit der Kopplung, auf jedem Weg.
//! - Die Helfer-Kopplung ist eine Zeile in `geraet_kopplung` mit `ansicht = 'helfer'`
//!   (Migration 0377); [`liste`] zeigt sie der Leitung.

pub mod anmeldung;
pub mod bestaetigung;
pub mod einladung;
pub mod ende;
pub mod position;
pub mod push;

use crate::error::AppError;
use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use utoipa::ToSchema;

wire_enum! {
    /// Zustand einer Helfer-Kopplung. `unbestaetigt`, `aktiv` und `abgelehnt` stehen in
    /// `geraet_kopplung.helfer_zustand` (CHECK in Migration 0377); `beendet` leitet der Server
    /// ab (widerrufen oder abgelaufen). Im Text heißt `unbestaetigt` „wartet“.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum HelferStatus {
        /// Angemeldet, die Leitung hat noch nicht bestätigt.
        Unbestaetigt => "unbestaetigt",
        /// Bestätigt.
        Aktiv => "aktiv",
        /// Von der Leitung abgelehnt.
        Abgelehnt => "abgelehnt",
        /// Widerrufen, abgemeldet oder abgelaufen.
        Beendet => "beendet",
    }
}

wire_enum! {
    /// Art des Ziels einer Helfer-Kopplung.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum HelferZielArt {
        /// Eine Einheit des Einsatzes (`einsatz_einheit`).
        Einheit => "unit",
        /// Ein Fahrzeug des Einsatzes (`einsatz_fahrzeug`).
        Fahrzeug => "vehicle",
    }
}

/// Ziel einer Helfer-Kopplung.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferZiel {
    pub kind: HelferZielArt,
    pub id: i64,
    /// Name der Einheit bzw. Funkrufname des Fahrzeugs.
    pub name: String,
}

/// Zugeordnete Person (Kraft in `einsatz_personal`); setzt nur die Leitung.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferPerson {
    pub id: i64,
    pub name: String,
}

/// Eine Helfer-Kopplung, wie die Leitung sie sieht.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferAnzeige {
    /// Kennung der Kopplung (`geraet_kopplung.id`).
    pub id: i64,
    /// Name, den die Kraft beim Anmelden eingegeben hat.
    pub display_name: String,
    pub state: HelferStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<HelferZiel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person: Option<HelferPerson>,
    /// Die Kraft hat „Mich als Person orten“ gewählt.
    pub person_requested: bool,
    /// Das Gerät schreibt die Position seines Ziels („Ortungsgerät“).
    pub is_tracker: bool,
    /// Die Kraft hat die Ortung pausiert.
    pub paused: bool,
    /// Zeitpunkt der letzten Position, die dieses Gerät geschrieben hat (Quelle `helfer`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_position_at: Option<String>,
    pub expires_at: String,
    pub created_at: String,
}

/// Rohzeile von [`liste`].
#[derive(sqlx::FromRow)]
struct HelferZeile {
    id: i64,
    anzeigename: Option<String>,
    bezeichnung: String,
    helfer_zustand: Option<String>,
    beendet: bool,
    einheit_id: Option<i64>,
    einheit_name: Option<String>,
    fahrzeug_id: Option<i64>,
    fahrzeug_name: Option<String>,
    person_id: Option<i64>,
    person_name: Option<String>,
    person_gewuenscht: bool,
    ortungsgeraet: bool,
    pausiert: bool,
    ziel_position_at: Option<String>,
    person_position_at: Option<String>,
    laeuft_ab_at: String,
    erstellt_at: String,
}

/// Alle Helfer-Kopplungen eines Einsatzes, älteste zuerst, auch beendete und abgelehnte (der
/// Client wählt, was er zeigt).
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<HelferAnzeige>, AppError> {
    auswahl(pool, einsatz_id, None).await
}

/// Eine Helfer-Kopplung des Einsatzes; fremd oder andere Ansicht → 404.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    kopplung_id: i64,
) -> Result<HelferAnzeige, AppError> {
    auswahl(pool, einsatz_id, Some(kopplung_id))
        .await?
        .pop()
        .ok_or(AppError::NotFound)
}

async fn auswahl(
    pool: &SqlitePool,
    einsatz_id: i64,
    kopplung_id: Option<i64>,
) -> Result<Vec<HelferAnzeige>, AppError> {
    let zeilen: Vec<HelferZeile> = sqlx::query_as(concat!(
        "SELECT gk.id, gk.anzeigename, gk.bezeichnung, gk.helfer_zustand, \
                (gk.widerrufen_at IS NOT NULL OR gk.laeuft_ab_at <= datetime('now')) AS beendet, \
                gk.einheit_id, ee.name AS einheit_name, \
                gk.fahrzeug_id, ",
        crate::fahrzeug::funkrufname_anzeige_sql!("ef"),
        " AS fahrzeug_name, \
                gk.person_id, COALESCE(p.name, ep.snap_name) AS person_name, \
                gk.person_gewuenscht <> 0 AS person_gewuenscht, \
                gk.ortungsgeraet <> 0 AS ortungsgeraet, \
                gk.pausiert_at IS NOT NULL AS pausiert, \
                CASE WHEN gk.ortungsgeraet <> 0 THEN \
                    COALESCE(CASE WHEN ee.position_quelle = 'helfer' THEN ee.position_aktualisiert_at END, \
                             CASE WHEN ef.position_quelle = 'helfer' THEN ef.position_aktualisiert_at END) \
                END AS ziel_position_at, \
                CASE WHEN ep.position_quelle = 'helfer' THEN ep.position_aktualisiert_at END \
                    AS person_position_at, \
                gk.laeuft_ab_at, gk.erstellt_at \
         FROM geraet_kopplung gk \
         LEFT JOIN einsatz_einheit ee ON ee.id = gk.einheit_id \
         LEFT JOIN einsatz_fahrzeug ef ON ef.id = gk.fahrzeug_id \
         LEFT JOIN einsatz_personal ep ON ep.id = gk.person_id \
         LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE gk.einsatz_id = ?1 AND gk.ansicht = 'helfer' AND (?2 IS NULL OR gk.id = ?2) \
         ORDER BY gk.erstellt_at, gk.id"
    ))
    .bind(einsatz_id)
    .bind(kopplung_id)
    .fetch_all(pool)
    .await?;
    zeilen.into_iter().map(anzeige).collect()
}

fn anzeige(z: HelferZeile) -> Result<HelferAnzeige, AppError> {
    let gespeichert = z
        .helfer_zustand
        .as_deref()
        .and_then(HelferStatus::parse)
        .ok_or_else(|| {
            AppError::Internal(format!("Helfer-Kopplung {} ohne gültigen Zustand", z.id))
        })?;
    let state = if z.beendet && gespeichert != HelferStatus::Abgelehnt {
        HelferStatus::Beendet
    } else {
        gespeichert
    };
    let target = match (z.einheit_id, z.fahrzeug_id) {
        (Some(id), _) => Some(HelferZiel {
            kind: HelferZielArt::Einheit,
            id,
            name: z.einheit_name.unwrap_or_default(),
        }),
        (None, Some(id)) => Some(HelferZiel {
            kind: HelferZielArt::Fahrzeug,
            id,
            name: z.fahrzeug_name.unwrap_or_default(),
        }),
        (None, None) => None,
    };
    let person = z.person_id.map(|id| HelferPerson {
        id,
        name: z.person_name.unwrap_or_default(),
    });
    let last_position_at = match (z.ziel_position_at, z.person_position_at) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    };
    Ok(HelferAnzeige {
        id: z.id,
        display_name: z.anzeigename.unwrap_or(z.bezeichnung),
        state,
        target,
        person,
        person_requested: z.person_gewuenscht,
        is_tracker: z.ortungsgeraet,
        paused: z.pausiert,
        last_position_at,
        expires_at: z.laeuft_ab_at,
        created_at: z.erstellt_at,
    })
}
