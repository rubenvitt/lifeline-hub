//! Verletzungen einer Person am Körperschema (LLH-1113, Change `y18v58dt-pat-kern`, Spec
//! `personen-verletzungen`, design.md D1/D4/D5).
//!
//! `person_verletzung` ist anhängend: wo (Ansicht, Region, Lage), was (Art, Schwere) und wann.
//! Eine Verletzung wird nie geändert, nur genau einmal aufgehoben: das bedingte UPDATE
//! ([`aufheben_tx`]) trifft bei einem zweiten, auch einem gleichzeitigen Aufheben keine Zeile
//! mehr (409, Muster `src/storno.rs`).

use crate::error::AppError;
use crate::geraet::bestaetigung::Bestaetigung;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

wire_enum! {
    /// Ansicht des Körperschemas.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VerletzungAnsicht {
        Vorn => "vorn",
        Hinten => "hinten",
    }
}

wire_enum! {
    /// Körperregion aus dem festen Katalog, Seiten aus Sicht des Patienten. String = CHECK in
    /// `migrations/0221_person_verletzung.sql`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum KoerperRegion {
        Kopf => "kopf",
        Gesicht => "gesicht",
        Hals => "hals",
        Thorax => "thorax",
        Abdomen => "abdomen",
        Becken => "becken",
        Ruecken => "ruecken",
        Wirbelsaeule => "wirbelsaeule",
        Gesaess => "gesaess",
        OberarmL => "oberarm_l",
        OberarmR => "oberarm_r",
        UnterarmL => "unterarm_l",
        UnterarmR => "unterarm_r",
        HandL => "hand_l",
        HandR => "hand_r",
        OberschenkelL => "oberschenkel_l",
        OberschenkelR => "oberschenkel_r",
        UnterschenkelL => "unterschenkel_l",
        UnterschenkelR => "unterschenkel_r",
        FussL => "fuss_l",
        FussR => "fuss_r",
    }
}

impl KoerperRegion {
    /// Ob es die Region in der Ansicht gibt (Spec `personen-verletzungen`): Rücken, Wirbelsäule
    /// und Gesäß nur hinten, Gesicht, Thorax, Abdomen und Becken nur vorn, alles andere in beiden.
    pub const fn gibt_es_in(self, ansicht: VerletzungAnsicht) -> bool {
        match self {
            KoerperRegion::Ruecken | KoerperRegion::Wirbelsaeule | KoerperRegion::Gesaess => {
                matches!(ansicht, VerletzungAnsicht::Hinten)
            }
            KoerperRegion::Gesicht
            | KoerperRegion::Thorax
            | KoerperRegion::Abdomen
            | KoerperRegion::Becken => matches!(ansicht, VerletzungAnsicht::Vorn),
            _ => true,
        }
    }
}

wire_enum! {
    /// Art der Verletzung aus dem festen Katalog.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VerletzungArt {
        WundeBlutung => "wunde_blutung",
        FrakturVerdacht => "fraktur_verdacht",
        Verbrennung => "verbrennung",
        PrellungSchwellung => "prellung_schwellung",
        Amputation => "amputation",
        Schmerz => "schmerz",
        Sonstige => "sonstige",
    }
}

wire_enum! {
    /// Schwere einer Verletzung, optional.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VerletzungSchwere {
        Leicht => "leicht",
        Mittel => "mittel",
        Schwer => "schwer",
    }
}

/// Eine Verletzung (1:1 zu `person_verletzung`); eine aufgehobene trägt `aufgehoben_at`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct VerletzungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    #[schema(value_type = VerletzungAnsicht)]
    pub ansicht: String,
    #[schema(value_type = KoerperRegion)]
    pub region: String,
    #[schema(value_type = VerletzungArt)]
    pub art: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<VerletzungSchwere>)]
    pub schwere: Option<String>,
    /// Lage, je 0 bis 1 normiert auf die Ansicht; nur als Paar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    /// Erfassungszeit; ohne Netz vorgemerkt die Zeit am Gerät, gekappt.
    pub zeitpunkt_at: String,
    /// Wann die Verletzung beim Server ankam.
    pub erfasst_at: String,
    pub erfasst_von: i64,
    /// Namentliche Bestätigung am Gerät (LFH-1046).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bestaetigt_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aufgehoben_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aufgehoben_von_id: Option<i64>,
}

const SELECT_VERLETZUNG: &str = "\
    SELECT id, einsatz_id, person_id, ansicht, region, art, schwere, x, y, notiz, zeitpunkt_at, \
           erfasst_at, erfasst_von, bestaetigt_name, aufgehoben_at, aufgehoben_von_id \
    FROM person_verletzung";

/// Eine neue Verletzung; Katalog, Paare und Lage geprüft, Notiz getrimmt und begrenzt.
#[derive(Debug)]
pub struct NeueVerletzung<'a> {
    pub ansicht: VerletzungAnsicht,
    pub region: KoerperRegion,
    pub art: VerletzungArt,
    pub schwere: Option<VerletzungSchwere>,
    pub lage: Option<(f64, f64)>,
    pub notiz: Option<&'a str>,
    /// Erfassungszeit, bereits über `support::erfassungszeitpunkt` gekappt.
    pub zeitpunkt_at: &'a str,
    pub client_id: Option<&'a str>,
    /// Bereits über [`crate::geraet::bestaetigung::aufloesen`] geprüft.
    pub bestaetigung: Option<&'a Bestaetigung>,
}

/// Legt eine Verletzung an. Kommt dieselbe `client_id` im Einsatz ein zweites Mal, liefert sie
/// die gespeicherte (unter `BEGIN IMMEDIATE` auch bei zwei gleichzeitigen Übertragungen eine).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    neu: &NeueVerletzung<'_>,
    erfasst_von: i64,
) -> Result<VerletzungAnzeige, AppError> {
    crate::write_retry!(pool, |conn| {
        if let Some(cid) = neu.client_id {
            if let Some(replay) = nach_client_id(&mut *conn, einsatz_id, cid).await? {
                return Ok(replay);
            }
        }
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO person_verletzung (einsatz_id, person_id, ansicht, region, art, \
                schwere, x, y, notiz, zeitpunkt_at, erfasst_at, erfasst_von, \
                bestaetigt_personal_id, bestaetigt_name, client_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%S','now'), ?, ?, ?, \
                ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(person_id)
        .bind(neu.ansicht.as_str())
        .bind(neu.region.as_str())
        .bind(neu.art.as_str())
        .bind(neu.schwere.map(|s| s.as_str()))
        .bind(neu.lage.map(|(x, _)| x))
        .bind(neu.lage.map(|(_, y)| y))
        .bind(neu.notiz)
        .bind(neu.zeitpunkt_at)
        .bind(erfasst_von)
        .bind(neu.bestaetigung.map(|b| b.personal_id))
        .bind(neu.bestaetigung.map(|b| b.name.as_str()))
        .bind(neu.client_id)
        .fetch_one(&mut *conn)
        .await?;
        laden_tx(conn, einsatz_id, person_id, id).await
    })
}

/// Hebt eine Verletzung genau einmal auf (design.md D1). Fremd oder unbekannt 404, schon
/// aufgehoben 409.
pub async fn aufheben(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
    von: i64,
) -> Result<VerletzungAnzeige, AppError> {
    crate::write_retry!(pool, |conn| {
        aufheben_tx(conn, einsatz_id, person_id, id, von).await
    })
}

/// [`aufheben`] auf einer offenen Verbindung: die Bedingung `aufgehoben_at IS NULL` steht im
/// UPDATE selbst.
pub async fn aufheben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
    von: i64,
) -> Result<VerletzungAnzeige, AppError> {
    let betroffen = sqlx::query(
        "UPDATE person_verletzung SET aufgehoben_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            aufgehoben_von_id = ? \
         WHERE id = ? AND einsatz_id = ? AND person_id = ? AND aufgehoben_at IS NULL",
    )
    .bind(von)
    .bind(id)
    .bind(einsatz_id)
    .bind(person_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    let verletzung = laden_tx(conn, einsatz_id, person_id, id).await?;
    if betroffen == 0 {
        return Err(AppError::Conflict(
            "Die Verletzung ist schon aufgehoben".into(),
        ));
    }
    Ok(verletzung)
}

/// Die schon gespeicherte Verletzung zu einer `client_id` im Einsatz (Replay der Offline-Queue).
pub async fn nach_client_id(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<VerletzungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, VerletzungAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_VERLETZUNG} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(executor)
        .await?,
    )
}

async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    id: i64,
) -> Result<VerletzungAnzeige, AppError> {
    sqlx::query_as::<_, VerletzungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_VERLETZUNG} WHERE id = ? AND einsatz_id = ? AND person_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Verletzungen einer Person in Erfassungsfolge (die Nummer am Körperschema folgt ihr, auch
/// über aufgehobene hinweg, design.md D13), aufgehobene eingeschlossen.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<VerletzungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, VerletzungAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_VERLETZUNG} WHERE einsatz_id = ? AND person_id = ? ORDER BY id"
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Die Paare aus Ansicht und Region nach der Spec `personen-verletzungen`.
    #[test]
    fn region_gibt_es_nur_in_ihrer_ansicht() {
        use KoerperRegion as R;
        use VerletzungAnsicht::{Hinten, Vorn};
        for r in [R::Ruecken, R::Wirbelsaeule, R::Gesaess] {
            assert!(r.gibt_es_in(Hinten) && !r.gibt_es_in(Vorn), "{r:?}");
        }
        for r in [R::Gesicht, R::Thorax, R::Abdomen, R::Becken] {
            assert!(r.gibt_es_in(Vorn) && !r.gibt_es_in(Hinten), "{r:?}");
        }
        let nur_eine = [
            R::Ruecken,
            R::Wirbelsaeule,
            R::Gesaess,
            R::Gesicht,
            R::Thorax,
            R::Abdomen,
            R::Becken,
        ];
        for r in KoerperRegion::ALLE
            .into_iter()
            .filter(|r| !nur_eine.contains(r))
        {
            assert!(r.gibt_es_in(Vorn) && r.gibt_es_in(Hinten), "{r:?}");
        }
    }
}
