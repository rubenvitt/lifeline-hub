//! Zeitdarstellung in Servertexten (LLH-1061, Spec `zeitdarstellung`, Entscheidung E4): ETB-Sätze
//! und Hinweistexte, die der Server fertig schreibt, nennen Zeitpunkte in der Darstellung von
//! Einsatz bzw. Organisation, Vorgabe taktisch — nie in der Wahl eines Geräts, denn der Server
//! kennt kein Gerät, und ein ETB-Eintrag ist ein Dokument der Führungsstelle wie ein Ausdruck.
//! Geschriebene Einträge bleiben, wie sie sind (Alteinträge, E4).
//!
//! Zone und Darstellung eines Einsatzes lädt nur [`zeitstil_laden`] (LLH-1443): beide Einsatz vor
//! Organisation vor Vorgabe, so dass Verpflegung, Zeitachse, Auftragsfrist, Nachforderung,
//! Ablösung und Hinweise dieselbe Ortszeit nennen, die die Oberfläche des Einsatzes zeigt.
//!
//! Das Gegenstück im Client ist `frontend/src/anzeige/zeitDarstellung.ts`; beide schreiben die
//! Rolle „Zeitpunkt“ gleich (`101430okt26` bzw. `10.10.26 14:30`) und die Rolle „Uhrzeit“
//! (`1430` bzw. `14:30`). Die Rolle „kurz“ gibt es hier nicht: ein gespeicherter Text weiß nicht,
//! an welchem Tag er gelesen wird.

use chrono::{DateTime, Datelike, Utc};
use chrono_tz::Tz;
use sqlx::{Executor, Sqlite};

use crate::einsatz::nummer::ZEITZONE_VORGABE;
use crate::error::AppError;

pub use crate::einsatz::einstellungen::Zeitdarstellung;

/// Die Vorgabe, wenn weder Einsatz noch Organisation etwas wählen (E3).
pub const ZEITDARSTELLUNG_VORGABE: Zeitdarstellung = Zeitdarstellung::Taktisch;

/// Monatskürzel der vollen DTG (E1): klein, ohne Umlaut. Dieselbe Liste wie `MONATE_DTG` im
/// Client.
pub const MONATE_DTG: [&str; 12] = [
    "jan", "feb", "mrz", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez",
];

/// Wirksame Darstellung: Einsatz vor Organisation vor Vorgabe. Ein leerer oder unbekannter Wert
/// zählt als nicht gesetzt.
pub fn wirksame_darstellung(einsatz: Option<&str>, org: Option<&str>) -> Zeitdarstellung {
    let lies = |s: Option<&str>| s.map(str::trim).and_then(Zeitdarstellung::parse);
    lies(einsatz)
        .or_else(|| lies(org))
        .unwrap_or(ZEITDARSTELLUNG_VORGABE)
}

/// Wirksame Zone der Servertexte: die erste gültige aus der Zone des Einsatzes und der der
/// Organisation, sonst [`ZEITZONE_VORGABE`] — dieselbe Folge wie die Anzeigezone im Client
/// (Einsatz vor Organisation) und die Wechselzeiten der Ablösung (Spec `kraefte-abloesung`).
/// Jeder Name wird für sich gelesen: eine ungültige Einsatzzone („MEZ“) verdrängt keine gültige
/// der Organisation; ein leerer Name zählt als nicht gesetzt (LLH-1443).
pub fn wirksame_zone(einsatz: Option<&str>, org: Option<&str>) -> Tz {
    [einsatz, org]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .find_map(|name| {
            let zone = name.parse::<Tz>().ok();
            if zone.is_none() {
                tracing::warn!(zeitzone = name, "Unbekannte Zeitzone übergangen");
            }
            zone
        })
        .unwrap_or(ZEITZONE_VORGABE)
}

/// Die eine Quelle für Zone und Darstellung der Servertexte eines Einsatzes (LLH-1443): Zone
/// nach [`wirksame_zone`], Darstellung nach [`wirksame_darstellung`], beide Einsatz vor
/// Organisation vor Vorgabe. Nimmt den Pool (vor der Transaktion zu laden, wie der
/// ETB-`startwert`) oder die Verbindung der Transaktion, die den Text schreibt. Ein unbekannter
/// Einsatz bekommt die Vorgaben; die Prüfung, ob es ihn gibt, liegt beim Aufrufer.
pub async fn zeitstil_laden<'c, E>(exec: E, einsatz_id: i64) -> Result<Zeitstil, AppError>
where
    E: Executor<'c, Database = Sqlite>,
{
    type Zeile = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let zeile: Option<Zeile> = sqlx::query_as(
        "SELECT es.zeitzone, oe.zeitzone, es.zeitdarstellung, oe.zeitdarstellung \
         FROM einsatz e \
         LEFT JOIN einsatz_einstellungen es ON es.einsatz_id = e.id \
         LEFT JOIN org_einstellungen oe ON oe.org_id = e.org_id \
         WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(exec)
    .await?;
    let (zone_einsatz, zone_org, darstellung_einsatz, darstellung_org) = zeile.unwrap_or_default();
    Ok(Zeitstil::new(
        wirksame_zone(zone_einsatz.as_deref(), zone_org.as_deref()),
        wirksame_darstellung(darstellung_einsatz.as_deref(), darstellung_org.as_deref()),
    ))
}

/// Zone und Darstellung, in denen ein Servertext Zeitpunkte nennt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Zeitstil {
    pub zone: Tz,
    pub darstellung: Zeitdarstellung,
}

impl Zeitstil {
    pub const fn new(zone: Tz, darstellung: Zeitdarstellung) -> Self {
        Self { zone, darstellung }
    }

    /// Rolle „Zeitpunkt“: volle DTG `101430okt26` bzw. `10.10.26 14:30`, in der Zone.
    pub fn zeitpunkt(&self, t: DateTime<Utc>) -> String {
        let o = t.with_timezone(&self.zone);
        match self.darstellung {
            Zeitdarstellung::Taktisch => format!(
                "{}{}{}",
                o.format("%d%H%M"),
                MONATE_DTG[o.month0() as usize],
                o.format("%y")
            ),
            Zeitdarstellung::DatumUhrzeit => o.format("%d.%m.%y %H:%M").to_string(),
        }
    }

    /// Rolle „Uhrzeit“, nur wo der Tag aus dem Zusammenhang feststeht: `1430` bzw. `14:30`.
    pub fn uhrzeit(&self, t: DateTime<Utc>) -> String {
        let o = t.with_timezone(&self.zone);
        match self.darstellung {
            Zeitdarstellung::Taktisch => o.format("%H%M").to_string(),
            Zeitdarstellung::DatumUhrzeit => o.format("%H:%M").to_string(),
        }
    }

    /// Ein Zeitpunkt im Drahtformat als Rolle „Zeitpunkt“; Unlesbares erscheint roh.
    pub fn zeitpunkt_text(&self, wire: &str) -> String {
        match crate::zeit::parse_utc(wire) {
            Some(t) => self.zeitpunkt(t),
            None => wire.to_string(),
        }
    }

    /// Ein Zeitraum: der Anfang als Zeitpunkt, das Ende am selben ORTStag nur als Uhrzeit
    /// (`241200sep26–1330` bzw. `24.09.26 12:00–13:30`), an einem anderen Tag wieder als
    /// Zeitpunkt (`242200sep26–250200sep26`).
    pub fn zeitraum(&self, von: DateTime<Utc>, bis: DateTime<Utc>) -> String {
        let gleicher_tag = von.with_timezone(&self.zone).date_naive()
            == bis.with_timezone(&self.zone).date_naive();
        let ende = if gleicher_tag {
            self.uhrzeit(bis)
        } else {
            self.zeitpunkt(bis)
        };
        format!("{}–{ende}", self.zeitpunkt(von))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAKTISCH: Zeitstil = Zeitstil::new(ZEITZONE_VORGABE, Zeitdarstellung::Taktisch);
    const DATUM: Zeitstil = Zeitstil::new(ZEITZONE_VORGABE, Zeitdarstellung::DatumUhrzeit);

    fn utc(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    /// Spec `zeitdarstellung`, „Taktisch“ und „Datum und Uhrzeit“: 10.10.2026 14:30 Ortszeit.
    #[test]
    fn zeitpunkt_in_beiden_darstellungen() {
        let t = utc("2026-10-10 12:30:00");
        assert_eq!(TAKTISCH.zeitpunkt(t), "101430okt26");
        assert_eq!(DATUM.zeitpunkt(t), "10.10.26 14:30");
        assert_eq!(TAKTISCH.uhrzeit(t), "1430");
        assert_eq!(DATUM.uhrzeit(t), "14:30");
    }

    /// Spec „Monatswechsel“ und „Jahreswechsel“: die Zone entscheidet über Tag, Monat und Jahr.
    #[test]
    fn monats_und_jahreswechsel_in_der_zone() {
        assert_eq!(
            TAKTISCH.zeitpunkt(utc("2026-10-31 23:30:00")),
            "010030nov26"
        );
        assert_eq!(
            TAKTISCH.zeitpunkt(utc("2026-12-31 23:15:00")),
            "010015jan27"
        );
        assert_eq!(
            DATUM.zeitpunkt(utc("2026-12-31 23:15:00")),
            "01.01.27 00:15"
        );
    }

    /// Spec „Sommerzeitgrenze“.
    #[test]
    fn sommerzeitgrenze() {
        assert_eq!(
            TAKTISCH.zeitpunkt(utc("2026-03-29 00:30:00")),
            "290130mrz26"
        );
        assert_eq!(
            TAKTISCH.zeitpunkt(utc("2026-03-29 01:30:00")),
            "290330mrz26"
        );
    }

    #[test]
    fn alle_zwoelf_monatskuerzel() {
        let kuerzel: Vec<String> = (1..=12)
            .map(|m| TAKTISCH.zeitpunkt(utc(&format!("2026-{m:02}-15 10:00:00")))[6..9].to_string())
            .collect();
        assert_eq!(kuerzel, MONATE_DTG);
    }

    #[test]
    fn unlesbarer_zeitpunkt_erscheint_roh() {
        assert_eq!(TAKTISCH.zeitpunkt_text("gestern"), "gestern");
        assert_eq!(
            TAKTISCH.zeitpunkt_text("2026-10-10 12:30:00"),
            "101430okt26"
        );
    }

    #[test]
    fn zeitraum_am_selben_ortstag_endet_mit_der_uhrzeit() {
        let (von, bis) = (utc("2026-09-24 10:00:00"), utc("2026-09-24 11:30:00"));
        assert_eq!(TAKTISCH.zeitraum(von, bis), "241200sep26–1330");
        assert_eq!(DATUM.zeitraum(von, bis), "24.09.26 12:00–13:30");
    }

    /// Über Mitternacht entscheidet das ORTSdatum, nicht das UTC-Datum.
    #[test]
    fn zeitraum_ueber_mitternacht_nach_ortsdatum() {
        assert_eq!(
            TAKTISCH.zeitraum(utc("2026-09-24 21:30:00"), utc("2026-09-24 22:30:00")),
            "242330sep26–250030sep26",
            "UTC ein Tag, Ortszeit zwei Tage"
        );
        assert_eq!(
            DATUM.zeitraum(utc("2026-09-24 21:30:00"), utc("2026-09-24 22:30:00")),
            "24.09.26 23:30–25.09.26 00:30"
        );
        assert_eq!(
            TAKTISCH.zeitraum(utc("2026-09-24 22:30:00"), utc("2026-09-24 23:30:00")),
            "250030sep26–0130",
            "UTC ein Tag, Ortszeit ein anderer Tag"
        );
    }

    #[test]
    fn einsatz_vor_organisation_vor_vorgabe() {
        use Zeitdarstellung::*;
        assert_eq!(wirksame_darstellung(None, None), Taktisch);
        assert_eq!(
            wirksame_darstellung(None, Some("datum_uhrzeit")),
            DatumUhrzeit
        );
        assert_eq!(
            wirksame_darstellung(Some("taktisch"), Some("datum_uhrzeit")),
            Taktisch
        );
        assert_eq!(
            wirksame_darstellung(Some("datum_uhrzeit"), Some("taktisch")),
            DatumUhrzeit
        );
        assert_eq!(
            wirksame_darstellung(Some(""), Some("datum_uhrzeit")),
            DatumUhrzeit,
            "leer am Einsatz heißt Vorgabe der Organisation"
        );
        assert_eq!(
            wirksame_darstellung(Some("24h"), Some("12h")),
            Taktisch,
            "Altwerte zählen nicht"
        );
    }

    #[test]
    fn zone_einsatz_vor_organisation_vor_vorgabe() {
        use chrono_tz::{America::New_York, Asia::Tokyo};
        assert_eq!(wirksame_zone(None, None), ZEITZONE_VORGABE);
        assert_eq!(wirksame_zone(None, Some("America/New_York")), New_York);
        assert_eq!(
            wirksame_zone(Some("Asia/Tokyo"), Some("America/New_York")),
            Tokyo
        );
        assert_eq!(
            wirksame_zone(Some("  "), Some("America/New_York")),
            New_York,
            "leer am Einsatz heißt Zone der Organisation"
        );
        assert_eq!(
            wirksame_zone(Some("MEZ"), Some("America/New_York")),
            New_York,
            "eine ungültige Einsatzzone verdrängt keine gültige der Organisation"
        );
        assert_eq!(
            wirksame_zone(Some("MEZ"), Some("Kein/Ort")),
            ZEITZONE_VORGABE
        );
        assert_eq!(wirksame_zone(Some(" Asia/Tokyo "), None), Tokyo);
    }

    async fn einsatz(pool: &sqlx::SqlitePool) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'E') RETURNING id")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// LLH-1443: Zone und Darstellung aller Servertexte kommen aus einer Abfrage, beide Einsatz
    /// vor Organisation vor Vorgabe — auch über die Verbindung einer Transaktion.
    #[tokio::test]
    async fn zeitstil_laden_nimmt_den_einsatz_vor_der_organisation() {
        use chrono_tz::{America::New_York, Asia::Tokyo};
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        let stil = |pool: sqlx::SqlitePool| async move { zeitstil_laden(&pool, e).await.unwrap() };

        assert_eq!(
            stil(pool.clone()).await,
            Zeitstil::new(ZEITZONE_VORGABE, Zeitdarstellung::Taktisch)
        );
        sqlx::query(
            "INSERT INTO org_einstellungen (org_id, zeitzone, zeitdarstellung) \
             VALUES (1, 'America/New_York', 'datum_uhrzeit')",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            stil(pool.clone()).await,
            Zeitstil::new(New_York, Zeitdarstellung::DatumUhrzeit)
        );
        sqlx::query(
            "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone, zeitdarstellung) \
             VALUES (?, 'Asia/Tokyo', 'taktisch')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            stil(pool.clone()).await,
            Zeitstil::new(Tokyo, Zeitdarstellung::Taktisch)
        );

        let mut tx = pool.begin().await.unwrap();
        assert_eq!(
            zeitstil_laden(&mut *tx, e).await.unwrap(),
            Zeitstil::new(Tokyo, Zeitdarstellung::Taktisch),
            "in der Transaktion dieselbe Quelle"
        );
        tx.rollback().await.unwrap();

        sqlx::query("UPDATE einsatz_einstellungen SET zeitzone = 'MEZ' WHERE einsatz_id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(stil(pool.clone()).await.zone, New_York);
    }
}
