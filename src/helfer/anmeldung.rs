//! Anmelden einer Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`,
//! „Ablauf“, Schritte 2–3, und „Server“): Zielliste vor dem Einlösen, Prüfung des Ziels und der
//! eigene Zustand der Helfer-Kopplung (`GET /api/devices/me`).
//!
//! Vor der Bestätigung sieht das Gerät nur Namen und Rufnamen von Einheiten und Fahrzeugen des
//! Einsatzes, keine Personen und keine Lage.

use super::{HelferPerson, HelferStatus, HelferZiel, HelferZielArt};
use crate::error::AppError;
use crate::geraet::repo::HelferZielSpalte;
use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Längster Anzeigename in Zeichen (wie die Gerätebezeichnung).
pub const ANZEIGENAME_MAX: usize = crate::geraet::BEZEICHNUNG_MAX;

wire_enum! {
    /// Warum eine Helfer-Kopplung endet. Jedes Ende ist für das Gerät 401, auch die Ablehnung:
    /// sie löscht die Sitzungen (`routes::helfer::ablehnen`). Die App nennt den Grund aus der
    /// letzten bekannten Antwort selbst; `rejected` liefert `GET /api/devices/me` nur für eine
    /// abgelehnte Kopplung, die noch eine Sitzung hätte.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum HelferEndeGrund {
        /// Der Einsatz ist beendet.
        EinsatzBeendet => "incident_closed",
        /// Die Leitung hat die Kopplung widerrufen.
        Widerrufen => "revoked",
        /// Die Kopplung ist abgelaufen.
        Abgelaufen => "expired",
        /// Die Leitung hat die Anmeldung abgelehnt.
        Abgelehnt => "rejected",
        /// Die Kraft hat sich abgemeldet.
        Abgemeldet => "signed_out",
    }
}

/// Ziel, wie es die App beim Anmelden und beim Ändern schickt.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct ZielEingabe {
    pub kind: HelferZielArt,
    pub id: i64,
}

/// Der Einsatz einer Helfer-Kopplung, nur Kennung und Bezeichnung.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferEinsatz {
    pub id: i64,
    pub name: String,
}

/// Der eigene Zustand einer Helfer-Kopplung (`GET /api/devices/me`, Antwort auf das Einlösen).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferZustand {
    /// `beendet` kommt hier nicht vor: nach dem Ende ist die Sitzung ungültig (401).
    pub state: HelferStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<HelferEndeGrund>,
    pub incident: HelferEinsatz,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<HelferZiel>,
    /// Die Person, die die Leitung zugeordnet hat; fehlt vor der Bestätigung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person: Option<HelferPerson>,
    /// Das Gerät schreibt die Position seines Ziels.
    pub is_tracker: bool,
    pub paused: bool,
    /// Ablauf der Kopplung (UTC, `%Y-%m-%d %H:%M:%S`).
    pub expires_at: String,
    /// Uhrzeit des Servers in derselben Form, für Restzeiten auf dem Gerät.
    pub server_time: String,
}

/// Ein wählbares Ziel vor dem Einlösen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferZielOption {
    pub kind: HelferZielArt,
    pub id: i64,
    /// Name der Einheit bzw. Funkrufname des Fahrzeugs.
    pub name: String,
    /// Eigener Funkrufname der Einheit; fehlt beim Fahrzeug (der Name ist sein Rufname).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_sign: Option<String>,
    /// Taktisches Zeichen: Fachaufgabe (`tz_fachaufgabe`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sign_function: Option<String>,
    /// Taktisches Zeichen: Organisation (`tz_organisation`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sign_organization: Option<String>,
}

/// Antwort von `POST /api/devices/helpers/targets`: Einheiten und Fahrzeuge des Einsatzes, ohne
/// Personen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferZielliste {
    pub targets: Vec<HelferZielOption>,
    /// Ob die Organisation „Auch Personen orten“ erlaubt; sonst blendet die App das Häkchen aus.
    pub person_tracking_allowed: bool,
}

/// Prüft den Anzeigenamen (422 leer oder länger als [`ANZEIGENAME_MAX`]) und liefert ihn
/// getrimmt.
pub fn pruefe_anzeigename(name: &str) -> Result<String, AppError> {
    // Das Feld für sich: leer oder zu lang ist 400 (`src/AGENTS.md`, Statuscode-Konvention und
    // Eingabegrenzen).
    crate::routes::support::pflicht_max(name, "Der Name", ANZEIGENAME_MAX)
}

/// Prüft ein Ziel gegen den Einsatz: eine nicht aufgelöste Einheit oder ein nicht beendetes
/// Fahrzeug dieses Einsatzes. Fehlt das Ziel → 400 (Pflichtfeld), gehört es nicht dazu → 422.
pub async fn pruefe_ziel(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ziel: Option<ZielEingabe>,
) -> Result<HelferZielSpalte, AppError> {
    let ziel = ziel.ok_or_else(|| {
        AppError::Validation("Bitte eine Einheit oder ein Fahrzeug wählen".into())
    })?;
    let (sql, spalte) = match ziel.kind {
        HelferZielArt::Einheit => (
            "SELECT EXISTS (SELECT 1 FROM einsatz_einheit \
             WHERE id = ? AND einsatz_id = ? AND aufgeloest_at IS NULL)",
            HelferZielSpalte::Einheit(ziel.id),
        ),
        HelferZielArt::Fahrzeug => (
            "SELECT EXISTS (SELECT 1 FROM einsatz_fahrzeug \
             WHERE id = ? AND einsatz_id = ? AND beendet_als IS NULL)",
            HelferZielSpalte::Fahrzeug(ziel.id),
        ),
    };
    let gibt_es: bool = sqlx::query_scalar(sql)
        .bind(ziel.id)
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    if gibt_es {
        Ok(spalte)
    } else {
        Err(AppError::UnprocessableEntity(
            "Das Ziel gehört nicht zu diesem Einsatz".into(),
        ))
    }
}

#[derive(sqlx::FromRow)]
struct OptionZeile {
    id: i64,
    name: String,
    call_sign: Option<String>,
    tz_fachaufgabe: Option<String>,
    tz_organisation: Option<String>,
}

/// Die wählbaren Ziele des Einsatzes: Einheiten, dann Fahrzeuge, je nach Name.
pub async fn zielliste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<HelferZielOption>, AppError> {
    let einheiten: Vec<OptionZeile> = sqlx::query_as(
        "SELECT id, name, funkrufname AS call_sign, tz_fachaufgabe, tz_organisation \
         FROM einsatz_einheit WHERE einsatz_id = ? AND aufgeloest_at IS NULL \
         ORDER BY name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let fahrzeuge: Vec<OptionZeile> = sqlx::query_as(concat!(
        "SELECT ef.id, ",
        crate::fahrzeug::funkrufname_anzeige_sql!("ef"),
        " AS name, NULL AS call_sign, ef.tz_fachaufgabe, ef.tz_organisation \
         FROM einsatz_fahrzeug ef WHERE ef.einsatz_id = ? AND ef.beendet_als IS NULL \
         ORDER BY name COLLATE NOCASE, ef.id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let option = |kind| {
        move |z: OptionZeile| HelferZielOption {
            kind,
            id: z.id,
            name: z.name,
            call_sign: z.call_sign,
            sign_function: z.tz_fachaufgabe,
            sign_organization: z.tz_organisation,
        }
    };
    Ok(einheiten
        .into_iter()
        .map(option(HelferZielArt::Einheit))
        .chain(fahrzeuge.into_iter().map(option(HelferZielArt::Fahrzeug)))
        .collect())
}

#[derive(sqlx::FromRow)]
struct ZustandZeile {
    helfer_zustand: Option<String>,
    einsatz_id: i64,
    einsatz_name: String,
    einheit_id: Option<i64>,
    einheit_name: Option<String>,
    fahrzeug_id: Option<i64>,
    fahrzeug_name: Option<String>,
    person_id: Option<i64>,
    person_name: Option<String>,
    ortungsgeraet: bool,
    pausiert: bool,
    laeuft_ab_at: String,
    server_time: String,
}

/// Der eigene Zustand einer (gültigen) Helfer-Kopplung. Eine fremde Ansicht oder unbekannte
/// Kopplung → 404.
pub async fn zustand(pool: &SqlitePool, kopplung_id: i64) -> Result<HelferZustand, AppError> {
    let z: ZustandZeile = sqlx::query_as(concat!(
        "SELECT gk.helfer_zustand, e.id AS einsatz_id, e.bezeichnung AS einsatz_name, \
                gk.einheit_id, ee.name AS einheit_name, gk.fahrzeug_id, ",
        crate::fahrzeug::funkrufname_anzeige_sql!("ef"),
        " AS fahrzeug_name, \
                gk.person_id, COALESCE(p.name, ep.snap_name) AS person_name, \
                gk.ortungsgeraet <> 0 AS ortungsgeraet, gk.pausiert_at IS NOT NULL AS pausiert, \
                gk.laeuft_ab_at, datetime('now') AS server_time \
         FROM geraet_kopplung gk \
         JOIN einsatz e ON e.id = gk.einsatz_id \
         LEFT JOIN einsatz_einheit ee ON ee.id = gk.einheit_id \
         LEFT JOIN einsatz_fahrzeug ef ON ef.id = gk.fahrzeug_id \
         LEFT JOIN einsatz_personal ep ON ep.id = gk.person_id \
         LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE gk.id = ? AND gk.ansicht = 'helfer'"
    ))
    .bind(kopplung_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let state = z
        .helfer_zustand
        .as_deref()
        .and_then(HelferStatus::parse)
        .ok_or_else(|| {
            AppError::Internal(format!(
                "Helfer-Kopplung {kopplung_id} ohne gültigen Zustand"
            ))
        })?;
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
    Ok(HelferZustand {
        state,
        reason: (state == HelferStatus::Abgelehnt).then_some(HelferEndeGrund::Abgelehnt),
        incident: HelferEinsatz {
            id: z.einsatz_id,
            name: z.einsatz_name,
        },
        target,
        person: z.person_id.map(|id| HelferPerson {
            id,
            name: z.person_name.unwrap_or_default(),
        }),
        is_tracker: z.ortungsgeraet,
        paused: z.pausiert,
        expires_at: z.laeuft_ab_at,
        server_time: z.server_time,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anzeigename_wird_getrimmt_und_begrenzt() {
        assert_eq!(pruefe_anzeigename("  Max M. ").unwrap(), "Max M.");
        assert!(matches!(
            pruefe_anzeigename("   "),
            Err(AppError::Validation(_))
        ));
        assert!(pruefe_anzeigename(&"ä".repeat(60)).is_ok());
        assert!(matches!(
            pruefe_anzeigename(&"ä".repeat(61)),
            Err(AppError::Validation(_))
        ));
    }
}
