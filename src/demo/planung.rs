//! Demo-Planung einer Lage (LLH-1585, design.md D8): eine Vorplanung ohne Einsatz aus dem
//! Demo-Personal, mit Posten, Schichten aus der Schichtlänge, Einteilung, zwei Helfern, einem
//! Befund „doppelt“ und einer Lücke zum Zeigen. Markiert über `demo_herkunft` (Art `planung`);
//! das Entfernen räumt sie vor den Stammdaten, die sie einteilt.
//!
//! Der Zeitraum liegt am **Samstag nach dem Importtag** in der Zone der Organisation: eine
//! Planung liegt vor dem Einsatz. Eine Planung derselben Bezeichnung in der Organisation wird
//! mitbenutzt, nicht ersetzt (die Bezeichnung ist eindeutig).

use std::collections::BTreeMap;

use chrono::{Datelike, Duration, NaiveDateTime, NaiveTime, TimeZone, Utc, Weekday};
use sqlx::SqliteConnection;

use super::stammdaten::StammdatenErgebnis;
use super::DemoStammdatenArt;
use crate::abloesung::schichtplan::repo::HelferEingabe;
use crate::abloesung::schichtplan::zerlegung::{self, Teilung};
use crate::abloesung::schichtplan::PlanPerson;
use crate::einsatz::Einsatzart;
use crate::error::AppError;
use crate::planung::repo;
use crate::uhs::UhsTyp;

/// Woraus ein Posten der Demo-Planung bei der Übernahme wird.
#[derive(Debug, Clone, Copy)]
pub enum PostenHerkunft {
    Frei,
    /// Stamm-Fahrzeug über seinen Szenario-Schlüssel; das Soll kommt aus seiner Sollbesatzung.
    Fahrzeug(&'static str),
    Uhs(UhsTyp),
}

/// Ein Posten der Demo-Planung. Die Schichten entstehen aus der Schichtlänge über
/// `[von_stunde, bis_stunde)` am Planungstag (24 = Mitternacht danach).
#[derive(Debug, Clone, Copy)]
pub struct PlanungPostenVorlage {
    pub schluessel: &'static str,
    pub bezeichnung: &'static str,
    pub abschnitt: Option<&'static str>,
    pub herkunft: PostenHerkunft,
    pub schichtlaenge_min: i64,
    /// `None` = das Soll der Herkunft (Fahrzeug).
    pub soll_anzahl: Option<i64>,
    /// Qualifikation (Label) und Anzahl.
    pub quali_soll: &'static [(&'static str, i64)],
    pub von_stunde: u32,
    pub bis_stunde: u32,
}

/// Ein Helfer der Demo-Planung.
#[derive(Debug, Clone, Copy)]
pub struct PlanungHelferVorlage {
    pub schluessel: &'static str,
    pub name: &'static str,
    pub organisation: &'static str,
    pub qualifikationen: &'static [&'static str],
}

/// Eine Person einer Einteilung über ihren Szenario-Schlüssel.
#[derive(Debug, Clone, Copy)]
pub enum PlanungPerson {
    Stamm(&'static str),
    Helfer(&'static str),
}

/// Die Personen eines Blocks: am Posten (`None` = Pause) ab der Stunde `ab_stunde`. Ein Block
/// der Pause entsteht dabei, `bis_stunde` gilt nur für sie.
#[derive(Debug, Clone, Copy)]
pub struct PlanungEinteilung {
    pub posten: Option<&'static str>,
    pub ab_stunde: u32,
    pub bis_stunde: u32,
    pub personen: &'static [PlanungPerson],
}

/// Die Demo-Planung einer Lage.
#[derive(Debug, Clone, Copy)]
pub struct PlanungVorlage {
    pub bezeichnung: &'static str,
    pub ort: &'static str,
    pub von_stunde: u32,
    pub bis_stunde: u32,
    pub posten: &'static [PlanungPostenVorlage],
    pub helfer: &'static [PlanungHelferVorlage],
    pub einteilung: &'static [PlanungEinteilung],
}

impl PlanungVorlage {
    /// Die Qualifikations-Labels, die Posten und Helfer brauchen.
    pub fn qualifikationen(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.posten
            .iter()
            .flat_map(|p| p.quali_soll.iter().map(|(l, _)| *l))
            .chain(
                self.helfer
                    .iter()
                    .flat_map(|h| h.qualifikationen.iter().copied()),
            )
    }
}

/// Der Samstag nach dem Importtag in `zone` (nie der Importtag selbst).
pub fn planungstag(jetzt: NaiveDateTime, zone: chrono_tz::Tz) -> chrono::NaiveDate {
    let heute = zone.from_utc_datetime(&jetzt).date_naive();
    let mut tag = heute + Duration::days(1);
    while tag.weekday() != Weekday::Sat {
        tag += Duration::days(1);
    }
    tag
}

/// Die Stunde `stunde` (0 bis 24) am Planungstag in `zone`, als UTC.
fn zeitpunkt(
    tag: chrono::NaiveDate,
    stunde: u32,
    zone: chrono_tz::Tz,
) -> Result<chrono::DateTime<Utc>, AppError> {
    let (tag, stunde) = if stunde >= 24 {
        (tag + Duration::days(1), stunde - 24)
    } else {
        (tag, stunde)
    };
    let lokal = tag.and_time(NaiveTime::from_hms_opt(stunde, 0, 0).unwrap_or_default());
    zone.from_local_datetime(&lokal)
        .earliest()
        .map(|t| t.with_timezone(&Utc))
        .ok_or_else(|| AppError::Internal(format!("Demo-Planung: {lokal} gibt es in {zone} nicht")))
}

fn quali_soll_json(
    ids: &BTreeMap<&'static str, i64>,
    soll: &[(&'static str, i64)],
) -> Result<Option<String>, AppError> {
    if soll.is_empty() {
        return Ok(None);
    }
    let eintraege: Vec<serde_json::Value> = soll
        .iter()
        .map(|(label, anzahl)| {
            ids.get(label)
                .map(|q| serde_json::json!({ "q": q, "n": anzahl }))
                .ok_or_else(|| AppError::Internal(format!("Demo-Planung: Qualifikation {label}")))
        })
        .collect::<Result<_, _>>()?;
    Ok(Some(serde_json::Value::Array(eintraege).to_string()))
}

/// Planung und Benutzer, unter denen die Blöcke der Demo-Planung entstehen.
struct Ziel {
    org_id: i64,
    planung_id: i64,
    admin_id: i64,
}

impl Ziel {
    /// Ein Block am Posten (Schlüssel, Kennung) oder in der Pause, mit den Personen seiner
    /// Einteilung (die damit verbraucht ist).
    async fn block_tx(
        &self,
        conn: &mut SqliteConnection,
        einteilung: &mut BTreeMap<(Option<&'static str>, i64), Vec<PlanPerson>>,
        posten: Option<(&'static str, i64)>,
        von: chrono::DateTime<Utc>,
        bis: chrono::DateTime<Utc>,
    ) -> Result<(), AppError> {
        let personen = einteilung
            .remove(&(posten.map(|p| p.0), von.timestamp()))
            .unwrap_or_default();
        repo::block_anlegen_tx(
            conn,
            self.org_id,
            self.planung_id,
            self.admin_id,
            &repo::BlockEingabe {
                posten_id: posten.map(|p| p.1),
                von: crate::zeit::formatiere_utc(von),
                bis: crate::zeit::formatiere_utc(bis),
                soll_anzahl: None,
                quali_soll: None,
                personen,
                notiz: None,
            },
        )
        .await?;
        Ok(())
    }
}

/// Legt die Demo-Planung an oder benutzt eine gleichnamige mit. Liefert `(angelegt,
/// mitbenutzt)` für den Bericht. Die Funktion committet nicht.
pub async fn planung_importieren_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    import_id: i64,
    admin_id: i64,
    jetzt: NaiveDateTime,
    vorlage: &PlanungVorlage,
    stamm: &StammdatenErgebnis,
) -> Result<(i64, i64), AppError> {
    let vorhanden: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM planung WHERE org_id = ? AND bezeichnung = ? COLLATE NOCASE",
    )
    .bind(org_id)
    .bind(vorlage.bezeichnung)
    .fetch_optional(&mut *conn)
    .await?;
    if vorhanden.is_some() {
        return Ok((0, 1));
    }

    let zone_name: Option<String> =
        sqlx::query_scalar("SELECT zeitzone FROM org_einstellungen WHERE org_id = ?")
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?
            .flatten();
    let zone = crate::zeitdarstellung::wirksame_zone(None, zone_name.as_deref());
    let tag = planungstag(jetzt, zone);
    let um = |stunde: u32| zeitpunkt(tag, stunde, zone);

    let mut quali_ids = BTreeMap::new();
    for label in vorlage.qualifikationen() {
        if !quali_ids.contains_key(label) {
            quali_ids.insert(
                label,
                super::katalog::qualifikation_tx(conn, org_id, label).await?,
            );
        }
    }

    // Geschrieben wird über die Wege der Routen (`planung::repo::*_tx`), mit ihren Prüfungen.
    let planung_id = repo::anlegen_tx(
        conn,
        org_id,
        admin_id,
        &repo::KopfEingabe {
            bezeichnung: vorlage.bezeichnung.to_string(),
            einsatzart: Einsatzart::Sanitaetsdienst,
            ort: Some(vorlage.ort.to_string()),
            koordinate: None,
            von: crate::zeit::formatiere_utc(um(vorlage.von_stunde)?),
            bis: crate::zeit::formatiere_utc(um(vorlage.bis_stunde)?),
            max_dienst: None,
            min_ruhe: None,
        },
    )
    .await?;
    sqlx::query("INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) VALUES (?, ?, ?)")
        .bind(import_id)
        .bind(DemoStammdatenArt::Planung.as_str())
        .bind(planung_id)
        .execute(&mut *conn)
        .await?;

    let mut helfer = BTreeMap::new();
    for h in vorlage.helfer {
        let qualifikationen: Vec<i64> = h
            .qualifikationen
            .iter()
            .filter_map(|l| quali_ids.get(l).copied())
            .collect();
        let neu = repo::helfer_anlegen_tx(
            conn,
            org_id,
            planung_id,
            admin_id,
            &HelferEingabe {
                name: h.name.to_string(),
                telefon: None,
                organisation: Some(h.organisation.to_string()),
                qualifikationen,
            },
        )
        .await?;
        helfer.insert(h.schluessel, neu.id);
    }

    // Die Einteilung je Block: Posten (oder Pause) und Beginn.
    let mut einteilung: BTreeMap<(Option<&'static str>, i64), Vec<PlanPerson>> = BTreeMap::new();
    for e in vorlage.einteilung {
        let mut personen = Vec::with_capacity(e.personen.len());
        for person in e.personen {
            personen.push(match person {
                PlanungPerson::Stamm(s) => PlanPerson::Stamm(stamm.personal(s)?),
                PlanungPerson::Helfer(s) => {
                    PlanPerson::Helfer(helfer.get(s).copied().ok_or_else(|| {
                        AppError::Internal(format!("Demo-Planung: kein Helfer {s}"))
                    })?)
                }
            });
        }
        einteilung.insert((e.posten, um(e.ab_stunde)?.timestamp()), personen);
    }
    let ziel = Ziel {
        org_id,
        planung_id,
        admin_id,
    };

    // Posten und ihre Schichten aus der Schichtlänge; das Soll kommt bei `None` aus der Herkunft.
    for p in vorlage.posten {
        let herkunft = match p.herkunft {
            PostenHerkunft::Frei => repo::Herkunft::Frei,
            PostenHerkunft::Fahrzeug(s) => repo::Herkunft::Fahrzeug(stamm.fahrzeug(s)?),
            PostenHerkunft::Uhs(t) => repo::Herkunft::Uhs(t),
        };
        let posten_id = repo::posten_anlegen_tx(
            conn,
            org_id,
            planung_id,
            &repo::PostenEingabe {
                bezeichnung: p.bezeichnung.to_string(),
                abschnitt: p.abschnitt.map(str::to_string),
                herkunft,
                schichtlaenge: Some(p.schichtlaenge_min),
                soll_anzahl: p.soll_anzahl.map(Some),
                quali_soll: Some(quali_soll_json(&quali_ids, p.quali_soll)?),
            },
        )
        .await?;
        let teile = zerlegung::zerlege(
            um(p.von_stunde)?,
            um(p.bis_stunde)?,
            &Teilung::Laenge(p.schichtlaenge_min),
        )?;
        for (a, b) in teile {
            ziel.block_tx(conn, &mut einteilung, Some((p.schluessel, posten_id)), a, b)
                .await?;
        }
    }
    // Die Pause entsteht nur aus der Einteilung.
    for e in vorlage.einteilung.iter().filter(|e| e.posten.is_none()) {
        ziel.block_tx(
            conn,
            &mut einteilung,
            None,
            um(e.ab_stunde)?,
            um(e.bis_stunde)?,
        )
        .await?;
    }
    if let Some(((posten, _), _)) = einteilung.iter().next() {
        return Err(AppError::Internal(format!(
            "Demo-Planung: Einteilung ohne Block an {}",
            posten.unwrap_or("Pause")
        )));
    }
    Ok((1, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn um(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    #[test]
    fn planungstag_ist_der_naechste_samstag() {
        let berlin = chrono_tz::Europe::Berlin;
        // Sonntag, 8.11.2026 → Samstag, 14.11.
        assert_eq!(
            planungstag(um("2026-11-08 09:00:00"), berlin).to_string(),
            "2026-11-14"
        );
        // Samstag selbst → eine Woche später.
        assert_eq!(
            planungstag(um("2026-11-14 09:00:00"), berlin).to_string(),
            "2026-11-21"
        );
        // Freitag 23:30 UTC ist in Berlin schon Samstag → der nächste.
        assert_eq!(
            planungstag(um("2026-11-13 23:30:00"), berlin).to_string(),
            "2026-11-21"
        );
    }

    #[test]
    fn mitternacht_ist_stunde_24() {
        let berlin = chrono_tz::Europe::Berlin;
        let tag = chrono::NaiveDate::from_ymd_opt(2026, 11, 14).unwrap();
        assert_eq!(
            crate::zeit::formatiere_utc(zeitpunkt(tag, 24, berlin).unwrap()),
            "2026-11-14 23:00:00"
        );
        assert_eq!(
            crate::zeit::formatiere_utc(zeitpunkt(tag, 10, berlin).unwrap()),
            "2026-11-14 09:00:00"
        );
    }
}
