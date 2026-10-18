//! Namentliche Bestätigung am Gerät (LFH-1046, Spec `geraete-kopplung`).
//!
//! Ein UHS-Gerät kann bei Sichtung und Verbleib eine Person aus dem Personal des Einsatzes als
//! Bestätigende angeben. Die Angabe ist ein Datenfeld am Schritt, keine Anmeldung: sie legt keine
//! Sitzung an, ändert die Gerätesitzung nicht und gewährt nichts über die Ansicht hinaus.
//! Eine Person bestätigt durch ihre eigene Anmeldung; schickt sie das Feld, ist das 422.

use crate::error::AppError;
use crate::geraet::GeraetKontext;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Die aufgelöste Bestätigung: Kennung der Dispositionszeile und Namensschnappschuss.
#[derive(Debug, Clone)]
pub struct Bestaetigung {
    pub personal_id: i64,
    pub name: String,
}

/// Ein Eintrag der Auswahlliste „Bestätigt von“.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct Bestaetiger {
    /// Kennung in `einsatz_personal`.
    pub id: i64,
    pub name: String,
    /// Qualifikation (Snapshot).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funktion: Option<String>,
    /// Einsatzfunktion (LLH-1239); das Etikett nennt sie vor der Qualifikation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzfunktion: Option<String>,
}

/// Prüft eine angegebene Bestätigung und löst den Namen auf. Ohne Angabe `None`. Eine Angabe
/// ohne Gerätesitzung oder mit einer Kennung außerhalb des Einsatzes ist 422 (Zusammenhang,
/// `src/AGENTS.md`, Statuscode-Konvention).
///
/// `erfasst_at` ist die Erfassungszeit des Schritts (LLH-1138, design.md D7): eine inzwischen
/// entlassene Kraft bestätigt weiter, wenn sie laut Kräfte-Zeitachse zu dieser Zeit eingesetzt
/// war ([`eingesetzt_zur`]). Lässt sich das nicht bestimmen (keine Einsatzperiode in der
/// Zeitachse) oder fehlt die Zeit, gilt der Rückfall „aktiv jetzt“. Eine stornierte Kraft war
/// nie eingesetzt und bestätigt nie.
pub async fn aufloesen(
    pool: &SqlitePool,
    geraet: Option<&GeraetKontext>,
    einsatz_id: i64,
    personal_id: Option<i64>,
    erfasst_at: Option<&str>,
) -> Result<Option<Bestaetigung>, AppError> {
    let Some(personal_id) = personal_id else {
        return Ok(None);
    };
    if geraet.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Eine Bestätigung gibt es nur an einem gekoppelten Gerät".into(),
        ));
    }
    let zeile: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT snap_name, beendet_als FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(personal_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    let (name, ende) = zeile.ok_or_else(|| {
        AppError::UnprocessableEntity("Die bestätigende Person gehört nicht zum Einsatz".into())
    })?;
    // Eine entlassene oder stornierte Kraft bestätigt nichts mehr (409, LLH-1079) — außer die
    // entlassene war zur Erfassungszeit eingesetzt (D7).
    if let Some(als) = ende {
        let damals = match erfasst_at {
            Some(t) if als == crate::entlassung::BeendetAls::Entlassen.as_str() => {
                let zeitachse = crate::zeitachse::repo::laden(
                    pool,
                    einsatz_id,
                    crate::zeitachse::repo::Kraft::Person(personal_id),
                )
                .await?;
                eingesetzt_zur(&zeitachse.perioden, t)
            }
            _ => None,
        };
        // Rückfall „aktiv jetzt“: nicht bestimmbar heißt wie bisher abgelehnt.
        if damals != Some(true) {
            return Err(crate::personal::disposition_repo::beendet_conflict(&als));
        }
    }
    Ok(Some(Bestaetigung { personal_id, name }))
}

/// Ob eine Kraft zur Zeit `t` eingesetzt war: eine ihrer Einsatzperioden umfasst `t` (ab dem
/// Beginn, bis vor das Ende: mit der Entlassung ist sie nicht mehr eingesetzt; eine offene Periode
/// reicht bis jetzt). `None`, wenn die Zeitachse keine
/// Periode kennt oder `t` unlesbar ist: dann lässt sich die Einsatzzeit nicht bestimmen.
pub fn eingesetzt_zur(perioden: &[crate::zeitachse::Einsatzperiode], t: &str) -> Option<bool> {
    let t = crate::zeit::parse(t)?;
    if perioden.is_empty() {
        return None;
    }
    let mut bestimmt = false;
    for p in perioden {
        let Some(beginn) = crate::zeit::parse(&p.beginn_at) else {
            continue;
        };
        let ende = match p.ende_at.as_deref() {
            None => None,
            Some(e) => match crate::zeit::parse(e) {
                Some(e) => Some(e),
                None => continue,
            },
        };
        bestimmt = true;
        if beginn <= t && ende.is_none_or(|e| t < e) {
            return Some(true);
        }
    }
    bestimmt.then_some(false)
}

/// Das Personal des Einsatzes für die Auswahl, nach Name sortiert.
pub async fn auswahl(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<Bestaetiger>, AppError> {
    Ok(sqlx::query_as::<_, Bestaetiger>(
        "SELECT id, snap_name AS name, snap_funktion AS funktion, einsatzfunktion \
         FROM einsatz_personal \
         WHERE einsatz_id = ? AND beendet_at IS NULL ORDER BY snap_name COLLATE NOCASE, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zeitachse::{Einsatzperiode, ZeitachseArt};

    fn periode(beginn: &str, ende: Option<&str>) -> Einsatzperiode {
        Einsatzperiode {
            beginn_at: beginn.into(),
            anker: ZeitachseArt::Eintreffen,
            eintreffen_at: Some(beginn.into()),
            ende_at: ende.map(Into::into),
            ende_art: ende.map(|_| ZeitachseArt::Entlassung),
        }
    }

    #[test]
    fn eingesetzt_zur_prueft_jede_periode_mit_grenzen() {
        let p = [
            periode("2026-10-18 08:00:00", Some("2026-10-18 10:00:00")),
            periode("2026-10-18 12:00:00", None),
        ];
        assert_eq!(eingesetzt_zur(&p, "2026-10-18 09:00:00"), Some(true));
        assert_eq!(eingesetzt_zur(&p, "2026-10-18 09:59:59"), Some(true));
        assert_eq!(
            eingesetzt_zur(&p, "2026-10-18 10:00:00"),
            Some(false),
            "mit der Entlassung nicht mehr"
        );
        assert_eq!(
            eingesetzt_zur(&p, "2026-10-18 08:00:00"),
            Some(true),
            "Beginn zählt"
        );
        assert_eq!(
            eingesetzt_zur(&p, "2026-10-18 11:00:00"),
            Some(false),
            "Pause"
        );
        assert_eq!(eingesetzt_zur(&p, "2026-10-18 07:59:59"), Some(false));
        assert_eq!(
            eingesetzt_zur(&p, "2026-10-18 13:00:00"),
            Some(true),
            "offen"
        );
    }

    #[test]
    fn eingesetzt_zur_ohne_periode_ist_unbestimmt() {
        assert_eq!(eingesetzt_zur(&[], "2026-10-18 09:00:00"), None);
        let p = [periode("2026-10-18 08:00:00", None)];
        assert_eq!(eingesetzt_zur(&p, "gestern"), None, "unlesbare Zeit");
    }
}
