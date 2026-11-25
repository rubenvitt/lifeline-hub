//! Vertrag „Veranstaltungen-Abruf v1“ (LLH-2097, `docs/schnittstellen/veranstaltungen-abruf.md`):
//! liest die Antwort der liefernden Anwendung und prüft sie mit ihren Grenzen. Eine ungültige
//! Zeile verwirft den ganzen Abruf: ein halber Stand wäre schlimmer als der alte.

use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::adapter::zustand::AdapterFehler;
use crate::wire_enum::wire_enum;
use crate::zeit;

/// Die Fassung des Vertrags, die diese Art spricht.
pub const FASSUNG: i64 = 1;
/// Höchstzahl der Veranstaltungen einer Antwort.
pub const ANZAHL_MAX: usize = 500;
pub const ID_MAX: usize = 64;
pub const NAME_MAX: usize = 120;
pub const ORT_MAX: usize = 120;
pub const VERANSTALTER_MAX: usize = 120;
pub const BEMERKUNG_MAX: usize = 2000;

wire_enum! {
    /// Art einer Veranstaltung. Einen unbekannten Wert nimmt Lifeline als `sonstiges`
    /// (vorwärtsverträglich).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
    pub enum VeranstaltungsArt {
        Sanitaetsdienst => "sanitaetsdienst",
        Betreuung => "betreuung",
        Uebung => "uebung",
        Sonstiges => "sonstiges",
    }
    sqlx = |s| format!("Ungültige VeranstaltungsArt: {s}");
}

wire_enum! {
    /// Status einer Veranstaltung. `entfernt` liefert keine Quelle; Lifeline setzt ihn, wenn eine
    /// Veranstaltung aus der Lieferung fällt, ohne abgesagt zu sein (`repo::uebernehmen`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
    pub enum VeranstaltungsStatus {
        Angefragt => "angefragt",
        Zugesagt => "zugesagt",
        Abgesagt => "abgesagt",
        Entfernt => "entfernt",
    }
    sqlx = |s| format!("Ungültiger VeranstaltungsStatus: {s}");
}

/// Eine geprüfte Veranstaltung, Zeitpunkte in `zeit::FORMAT`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Veranstaltung {
    pub extern_id: String,
    pub name: String,
    pub art: VeranstaltungsArt,
    pub status: VeranstaltungsStatus,
    pub ort: String,
    pub veranstalter: String,
    pub bemerkung: String,
    pub beginn_at: String,
    pub ende_at: String,
}

impl Veranstaltung {
    /// SHA-256 (hex) über den Inhalt; der Änderungszeitpunkt der Quelle zählt nicht.
    pub fn fingerabdruck(&self) -> String {
        let teile = [
            self.extern_id.as_str(),
            self.name.as_str(),
            self.art.as_str(),
            self.status.as_str(),
            self.ort.as_str(),
            self.veranstalter.as_str(),
            self.bemerkung.as_str(),
            self.beginn_at.as_str(),
            self.ende_at.as_str(),
        ];
        let json = serde_json::to_string(&teile).expect("Liste von Texten ist serialisierbar");
        Sha256::digest(json.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}

#[derive(Deserialize)]
struct RohAntwort {
    veranstaltungen: Vec<RohVeranstaltung>,
}

/// Eine Zeile, wie sie kommt. Unbekannte Felder werden übergangen (vorwärtsverträglich);
/// `geaendert` liest Lifeline nicht.
#[derive(Deserialize)]
struct RohVeranstaltung {
    id: Option<String>,
    name: Option<String>,
    art: Option<String>,
    status: Option<String>,
    ort: Option<String>,
    veranstalter: Option<String>,
    bemerkung: Option<String>,
    beginn: Option<String>,
    ende: Option<String>,
}

/// Liest eine Antwort. `VersionUnbekannt` bei einer anderen `fassung`, sonst `AntwortUngueltig`
/// bei jedem Verstoß.
pub fn parse(rumpf: &[u8]) -> Result<Vec<Veranstaltung>, AdapterFehler> {
    let wert: Value = serde_json::from_slice(rumpf).map_err(|_| AdapterFehler::AntwortUngueltig)?;
    let fassung = wert
        .get("fassung")
        .and_then(Value::as_i64)
        .ok_or(AdapterFehler::AntwortUngueltig)?;
    if fassung != FASSUNG {
        return Err(AdapterFehler::VersionUnbekannt);
    }
    let roh: RohAntwort =
        serde_json::from_value(wert).map_err(|_| AdapterFehler::AntwortUngueltig)?;
    if roh.veranstaltungen.len() > ANZAHL_MAX {
        return Err(AdapterFehler::AntwortUngueltig);
    }
    let mut liste = Vec::with_capacity(roh.veranstaltungen.len());
    let mut gesehen = std::collections::HashSet::new();
    for zeile in roh.veranstaltungen {
        let v = check_zeile(zeile).ok_or(AdapterFehler::AntwortUngueltig)?;
        // Eine Kennung zweimal ließe offen, welcher Stand gilt.
        if !gesehen.insert(v.extern_id.clone()) {
            return Err(AdapterFehler::AntwortUngueltig);
        }
        liste.push(v);
    }
    Ok(liste)
}

/// Ein Text mit Grenze in Zeichen, getrimmt; fehlend heißt leer.
fn text(roh: Option<String>, max: usize) -> Option<String> {
    let t = roh.unwrap_or_default().trim().to_string();
    (t.chars().count() <= max).then_some(t)
}

/// Ein Pflichttext mit Grenze, nach dem Trimmen nicht leer.
fn pflicht(roh: Option<String>, max: usize) -> Option<String> {
    text(Some(roh?), max).filter(|t| !t.is_empty())
}

/// Ein Zeitpunkt nach RFC 3339 (`2026-11-28T07:00:00Z`, ein Versatz wird nach UTC umgerechnet)
/// oder schon in `zeit::FORMAT`; geliefert in `zeit::FORMAT`, Jahr in `zeit::JAHRE`.
pub fn parse_zeitpunkt(roh: &str) -> Option<String> {
    let roh = roh.trim();
    let utc = DateTime::parse_from_rfc3339(roh)
        .map(|t| t.with_timezone(&Utc))
        .ok()
        .or_else(|| zeit::parse_streng(roh).map(|t| t.and_utc()))?;
    zeit::JAHRE
        .contains(&utc.year())
        .then(|| zeit::formatiere_utc(utc))
}

fn check_zeile(z: RohVeranstaltung) -> Option<Veranstaltung> {
    let beginn_at = parse_zeitpunkt(z.beginn.as_deref()?)?;
    let ende_at = parse_zeitpunkt(z.ende.as_deref()?)?;
    // Gleiches Format, gleiche Länge: die Textfolge ist die Zeitfolge.
    if ende_at <= beginn_at {
        return None;
    }
    let status = match VeranstaltungsStatus::parse(z.status?.trim())? {
        VeranstaltungsStatus::Entfernt => return None,
        s => s,
    };
    let art = VeranstaltungsArt::parse(z.art?.trim()).unwrap_or(VeranstaltungsArt::Sonstiges);
    Some(Veranstaltung {
        extern_id: pflicht(z.id, ID_MAX)?,
        name: pflicht(z.name, NAME_MAX)?,
        art,
        status,
        ort: text(z.ort, ORT_MAX)?,
        veranstalter: text(z.veranstalter, VERANSTALTER_MAX)?,
        bemerkung: text(z.bemerkung, BEMERKUNG_MAX)?,
        beginn_at,
        ende_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn zeile() -> Value {
        json!({
            "id": "V1StGXR8_Z5jdHi6B-myT",
            "name": "Stadtfest",
            "art": "sanitaetsdienst",
            "status": "zugesagt",
            "ort": "Marktplatz",
            "veranstalter": "Stadtmarketing",
            "beginn": "2026-11-28T07:00:00Z",
            "ende": "2026-11-28T21:00:00Z",
            "bemerkung": "",
            "geaendert": "2026-11-24T19:12:00Z"
        })
    }

    fn antwort(zeilen: Vec<Value>) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "fassung": 1,
            "stand": "2026-11-25T08:00:00Z",
            "veranstaltungen": zeilen
        }))
        .unwrap()
    }

    fn mit(feld: &str, wert: Value) -> Vec<u8> {
        let mut z = zeile();
        z[feld] = wert;
        antwort(vec![z])
    }

    fn ohne(feld: &str) -> Vec<u8> {
        let mut z = zeile();
        z.as_object_mut().unwrap().remove(feld);
        antwort(vec![z])
    }

    #[test]
    fn gueltige_antwort_wird_gelesen() {
        let liste = parse(&antwort(vec![zeile()])).unwrap();
        assert_eq!(
            liste,
            vec![Veranstaltung {
                extern_id: "V1StGXR8_Z5jdHi6B-myT".into(),
                name: "Stadtfest".into(),
                art: VeranstaltungsArt::Sanitaetsdienst,
                status: VeranstaltungsStatus::Zugesagt,
                ort: "Marktplatz".into(),
                veranstalter: "Stadtmarketing".into(),
                bemerkung: String::new(),
                beginn_at: "2026-11-28 07:00:00".into(),
                ende_at: "2026-11-28 21:00:00".into(),
            }]
        );
        assert!(parse(&antwort(vec![])).unwrap().is_empty());
    }

    #[test]
    fn fehlendes_pflichtfeld_verwirft_den_abruf() {
        for feld in ["id", "name", "art", "status", "beginn", "ende"] {
            assert_eq!(
                parse(&ohne(feld)),
                Err(AdapterFehler::AntwortUngueltig),
                "{feld}"
            );
        }
        // Freitexte dürfen fehlen und heißen dann leer.
        for feld in ["ort", "veranstalter", "bemerkung", "geaendert"] {
            assert!(parse(&ohne(feld)).is_ok(), "{feld}");
        }
        assert_eq!(
            parse(&mit("name", json!("   "))),
            Err(AdapterFehler::AntwortUngueltig)
        );
        assert_eq!(
            parse(&mit("name", json!(17))),
            Err(AdapterFehler::AntwortUngueltig)
        );
    }

    #[test]
    fn zu_langer_text_verwirft_den_abruf() {
        for (feld, max) in [
            ("id", ID_MAX),
            ("name", NAME_MAX),
            ("ort", ORT_MAX),
            ("veranstalter", VERANSTALTER_MAX),
            ("bemerkung", BEMERKUNG_MAX),
        ] {
            assert!(parse(&mit(feld, json!("ä".repeat(max)))).is_ok(), "{feld}");
            assert_eq!(
                parse(&mit(feld, json!("ä".repeat(max + 1)))),
                Err(AdapterFehler::AntwortUngueltig),
                "{feld}"
            );
        }
    }

    #[test]
    fn eine_ungueltige_zeile_verwirft_alle() {
        let mut kaputt = zeile();
        kaputt["id"] = json!("zwei");
        kaputt["ende"] = json!("gestern");
        assert_eq!(
            parse(&antwort(vec![zeile(), kaputt])),
            Err(AdapterFehler::AntwortUngueltig)
        );
    }

    #[test]
    fn andere_fassung_ist_unbekannt() {
        let mut v: Value = serde_json::from_slice(&antwort(vec![zeile()])).unwrap();
        v["fassung"] = json!(2);
        assert_eq!(
            parse(&serde_json::to_vec(&v).unwrap()),
            Err(AdapterFehler::VersionUnbekannt)
        );
        // Ohne Fassung oder kein JSON: ungültig.
        assert_eq!(
            parse(br#"{"veranstaltungen": []}"#),
            Err(AdapterFehler::AntwortUngueltig)
        );
        assert_eq!(parse(b"<html>"), Err(AdapterFehler::AntwortUngueltig));
    }

    #[test]
    fn ende_muss_nach_dem_beginn_liegen() {
        assert_eq!(
            parse(&mit("ende", json!("2026-11-28T07:00:00Z"))),
            Err(AdapterFehler::AntwortUngueltig)
        );
        assert_eq!(
            parse(&mit("ende", json!("2026-11-28T06:59:59Z"))),
            Err(AdapterFehler::AntwortUngueltig)
        );
    }

    #[test]
    fn unbekannte_art_wird_sonstiges() {
        let liste = parse(&mit("art", json!("konzert"))).unwrap();
        assert_eq!(liste[0].art, VeranstaltungsArt::Sonstiges);
    }

    #[test]
    fn unbekannter_oder_entfernter_status_verwirft_den_abruf() {
        for s in ["verschoben", "entfernt", ""] {
            assert_eq!(
                parse(&mit("status", json!(s))),
                Err(AdapterFehler::AntwortUngueltig),
                "{s}"
            );
        }
        let liste = parse(&mit("status", json!("abgesagt"))).unwrap();
        assert_eq!(liste[0].status, VeranstaltungsStatus::Abgesagt);
    }

    #[test]
    fn doppelte_kennung_verwirft_den_abruf() {
        assert_eq!(
            parse(&antwort(vec![zeile(), zeile()])),
            Err(AdapterFehler::AntwortUngueltig)
        );
    }

    #[test]
    fn mehr_als_500_eintraege_verwerfen_den_abruf() {
        let zeilen = |n: usize| {
            (0..n)
                .map(|i| {
                    let mut z = zeile();
                    z["id"] = json!(format!("v{i}"));
                    z
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(
            parse(&antwort(zeilen(ANZAHL_MAX))).unwrap().len(),
            ANZAHL_MAX
        );
        assert_eq!(
            parse(&antwort(zeilen(ANZAHL_MAX + 1))),
            Err(AdapterFehler::AntwortUngueltig)
        );
    }

    #[test]
    fn zeitpunkte_werden_nach_utc_im_kanonischen_format_gelesen() {
        assert_eq!(
            parse_zeitpunkt("2026-11-28T07:00:00Z").as_deref(),
            Some("2026-11-28 07:00:00")
        );
        assert_eq!(
            parse_zeitpunkt("2026-11-28T08:00:00.250+01:00").as_deref(),
            Some("2026-11-28 07:00:00")
        );
        assert_eq!(
            parse_zeitpunkt("2026-11-28 07:00:00").as_deref(),
            Some("2026-11-28 07:00:00")
        );
        for schlecht in [
            "2026-11-28",
            "2026-11-28T07:00:00",
            "0226-11-28T07:00:00Z",
            "",
        ] {
            assert_eq!(parse_zeitpunkt(schlecht), None, "{schlecht}");
        }
    }

    #[test]
    fn fingerabdruck_folgt_dem_inhalt() {
        let a = parse(&antwort(vec![zeile()])).unwrap().remove(0);
        let mut b = zeile();
        b["geaendert"] = json!("2026-11-25T00:00:00Z");
        let b = parse(&antwort(vec![b])).unwrap().remove(0);
        assert_eq!(a.fingerabdruck(), b.fingerabdruck());
        assert_eq!(a.fingerabdruck().len(), 64);
        let c = parse(&mit("status", json!("abgesagt"))).unwrap().remove(0);
        assert_ne!(a.fingerabdruck(), c.fingerabdruck());
    }
}
