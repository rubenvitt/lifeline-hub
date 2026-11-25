//! Adapterart „Stammdaten-Abruf“ (LLH-1194, Vertrag `docs/schnittstellen/stammdaten-abruf.md`).
//!
//! Ruft eine Adresse mit Zugangsschlüssel ab, die Stammdaten im JSON-Gegenstück der Stammdaten-Datei
//! liefert (heute: Personal mit Qualifikationen aus einer Mitgliederverwaltung). Übernimmt nie
//! selbst: die zweite Phase legt nur einen Schnappschuss ab (`stammdaten_eingang::schnappschuss`),
//! den ein Admin im Stammdaten-Eingang bestätigt (G1). Kein Name einer Fremdanwendung (G4).

use age::secrecy::ExposeSecret;
use futures::future::BoxFuture;
use sqlx::SqliteConnection;

use crate::adapter::art::{AdapterArt, Fehlschlag, Feld, FeldTyp, Platz, Uebernahme};
use crate::adapter::repo::Adapter;
use crate::adapter::ziel::AbrufKontext;
use crate::adapter::zustand::AdapterFehler;
use crate::error::AppError;
use crate::stammdaten_eingang::json::{self, JsonFehler, KOERPER_MAX};
use crate::stammdaten_eingang::schnappschuss::{self, Anzahl, FELD_HERKUNFT};

pub const CODE: &str = "stammdaten_abruf";
const FELD_ADRESSE: &str = "adresse";
const PLATZ_SCHLUESSEL: &str = "schluessel";

pub struct StammdatenAbruf;

/// Das abgeholte Paket für die zweite Phase: Körper, Fingerabdruck, Zählung.
struct Abgeholt {
    koerper: String,
    fingerabdruck: String,
    anzahl: Anzahl,
}

impl Uebernahme for Abgeholt {
    fn anzahl(&self) -> i64 {
        self.anzahl.fahrzeuge + self.anzahl.personal + self.anzahl.qualifikationen
    }

    fn uebernehmen<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        adapter: &'a Adapter,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            let neu = schnappschuss::ablegen(
                conn,
                &adapter.id,
                adapter.org_id,
                &self.koerper,
                &self.fingerabdruck,
                &self.anzahl,
                &crate::zeit::jetzt(),
            )
            .await?;
            Ok(i64::from(neu))
        })
    }
}

fn von_json(f: JsonFehler) -> Fehlschlag {
    Fehlschlag::new(match f {
        JsonFehler::ZuGross => AdapterFehler::ZuGross,
        _ => AdapterFehler::AntwortUngueltig,
    })
}

impl AdapterArt for StammdatenAbruf {
    fn code(&self) -> &'static str {
        CODE
    }
    fn bezeichnung(&self) -> &'static str {
        "Stammdaten-Abruf"
    }
    fn plaetze(&self) -> &'static [Platz] {
        &[Platz {
            name: PLATZ_SCHLUESSEL,
            bezeichnung: "Zugangsschlüssel",
            pflicht: true,
        }]
    }
    fn felder(&self) -> &'static [Feld] {
        &[
            Feld {
                name: FELD_ADRESSE,
                bezeichnung: "Adresse",
                typ: FeldTyp::Url,
                pflicht: true,
                max: 2048,
            },
            Feld {
                name: FELD_HERKUNFT,
                bezeichnung: "Herkunft",
                typ: FeldTyp::Text,
                pflicht: true,
                max: crate::abloesung::schichtplan::uebernahme::HERKUNFT_MAX,
            },
        ]
    }
    fn intervall_min_s(&self) -> i64 {
        3600
    }
    fn intervall_vorschlag_s(&self) -> i64 {
        21600
    }

    fn abrufen<'a>(
        &'a self,
        k: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let adresse = k
                .einstellung_text(FELD_ADRESSE)
                .ok_or(Fehlschlag::new(AdapterFehler::EinstellungUngueltig))?;
            let schluessel = k
                .geheimnis(PLATZ_SCHLUESSEL)
                .ok_or(Fehlschlag::new(AdapterFehler::GeheimnisFehlt))?;
            let anfrage = k
                .get(adresse)?
                .bearer_auth(schluessel.expose_secret())
                .header(reqwest::header::ACCEPT, "application/json");
            let antwort = k.send(anfrage).await?;
            let koerper = k.read_text(antwort, KOERPER_MAX).await?;
            Ok(Box::new(verarbeite(koerper)?) as Box<dyn Uebernahme>)
        })
    }
}

/// Der Körper einer Antwort → das Paket der zweiten Phase. Eine unbrauchbare Antwort ist ein
/// Fehlschlag (kein Schnappschuss); ein mangelhafter Eintrag nicht (er wird Meldung der Vorschau).
fn verarbeite(koerper: String) -> Result<Abgeholt, Fehlschlag> {
    let (paket, _, _) = json::lies_paket(koerper.as_bytes()).map_err(von_json)?;
    Ok(Abgeholt {
        fingerabdruck: json::fingerabdruck(&paket),
        anzahl: Anzahl::von(&paket),
        koerper,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brauchbarer_koerper_zaehlt_die_eintraege() {
        let a = verarbeite(r#"{"personal":[{"name":"A"},{"kennung":"x"},{"name":"B"}]}"#.into())
            .unwrap();
        assert_eq!(
            a.anzahl,
            Anzahl {
                fahrzeuge: 0,
                personal: 2,
                qualifikationen: 0
            }
        );
        assert_eq!(a.anzahl(), 2);
        assert_eq!(a.fingerabdruck.len(), 64);
    }

    #[test]
    fn unbrauchbare_antwort_ist_ein_fehlschlag() {
        assert_eq!(
            verarbeite("<html>".into()).err().unwrap().art,
            AdapterFehler::AntwortUngueltig
        );
        assert_eq!(
            verarbeite("[]".into()).err().unwrap().art,
            AdapterFehler::AntwortUngueltig
        );
        assert_eq!(
            verarbeite(" ".repeat(KOERPER_MAX + 1)).err().unwrap().art,
            AdapterFehler::ZuGross
        );
    }

    #[test]
    fn felder_und_platz_der_art() {
        let a = StammdatenAbruf;
        assert_eq!(a.code(), "stammdaten_abruf");
        assert_eq!(a.intervall_vorschlag_s(), 21600);
        assert_eq!(a.intervall_min_s(), 3600);
        assert_eq!(
            a.felder().iter().map(|f| f.name).collect::<Vec<_>>(),
            vec!["adresse", "herkunft"]
        );
        assert!(a.plaetze().iter().all(|p| p.pflicht));
    }
}
