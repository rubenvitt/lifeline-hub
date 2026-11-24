//! Copernicus-Aktivierungen vor 2023 (LLH-2022): kuratierter Katalog und Vector Packages.
//!
//! Die Liste und die Detail-Schnittstelle des Dashboards beginnen bei EMSR656 (März 2023). Für
//! ältere Lagen wie das Ahrtal (EMSR517) führt `copernicus_altbestand.json` die Gebiete und
//! Produkte mit der Adresse ihres Vector Package; die Ebenen liest [`read_vector_package`] aus
//! dem ZIP. Nur mit „Ältere Aktivierungen“ (`archiv`).
//!
//! Herleitung: `docs/superpowers/specs/2026-11-24-pjfe442j-copernicus-aeltere-aktivierungen-design.md`,
//! ADR-0098. Pflege eines Eintrags: `docs/fachebenen-quellen.md`, Abschnitt „Copernicus EMS“.

use crate::karte::copernicus::{format_zeitpunkt, Details, Gebiet, Produkt};
use crate::karte::typen::Bbox;
use serde_json::Value;
use std::sync::OnceLock;

/// Nur von hier lädt der Altbestand Vector Packages (ADR-0098); gilt auch für die Adresse nach
/// Weiterleitungen.
pub(crate) const PAKET_BASIS: &str =
    "https://cems-mapping-website.s3.eu-west-1.amazonaws.com/static/activations/";

/// Der Katalog als `Details`, einmal gelesen. Ein Formatfehler ist ein Fehler im Repo, den
/// `liest_den_katalog_mit_emsr517` fängt; zur Laufzeit bricht er deshalb laut ab.
pub(crate) fn load_katalog() -> &'static [Details] {
    static KATALOG: OnceLock<Vec<Details>> = OnceLock::new();
    KATALOG.get_or_init(|| {
        let roh: Value = serde_json::from_str(include_str!("copernicus_altbestand.json"))
            .expect("copernicus_altbestand.json ist kein JSON");
        parse_katalog(&roh).expect("copernicus_altbestand.json hat ein ungültiges Format")
    })
}

/// Liest den Katalog. `None` bei einem Formatbruch: kein Array, eine Aktivierung ohne Code oder
/// ohne Gebiete, ein Gebiet ohne Rechteck oder Produkte, ein Produkt ohne ZIP.
pub(crate) fn parse_katalog(v: &Value) -> Option<Vec<Details>> {
    v.as_array()?
        .iter()
        .map(|a| {
            let text = |k: &str| a.get(k).and_then(Value::as_str).map(str::to_string);
            let gebiete: Vec<Gebiet> = a
                .get("gebiete")?
                .as_array()?
                .iter()
                .map(parse_gebiet)
                .collect::<Option<_>>()?;
            if gebiete.is_empty() {
                return None;
            }
            Some(Details {
                code: text("code")?,
                name: text("name").unwrap_or_default(),
                kategorie: text("kategorie").unwrap_or_default(),
                sensibel: false,
                gebiete,
            })
        })
        .collect()
}

fn parse_gebiet(g: &Value) -> Option<Gebiet> {
    let h: Vec<f64> = g
        .get("huelle")?
        .as_array()?
        .iter()
        .map(Value::as_f64)
        .collect::<Option<_>>()?;
    let [west, sued, ost, nord] = h.as_slice() else {
        return None;
    };
    let huelle = Bbox {
        west: *west,
        sued: *sued,
        ost: *ost,
        nord: *nord,
    };
    let produkte: Vec<Produkt> = g
        .get("produkte")?
        .as_array()?
        .iter()
        .map(parse_produkt)
        .collect::<Option<_>>()?;
    if produkte.is_empty() {
        return None;
    }
    Some(Gebiet {
        nummer: g.get("nummer")?.as_u64()?,
        name: g
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        umriss: rechteck(&huelle),
        huelle,
        produkte,
    })
}

fn parse_produkt(p: &Value) -> Option<Produkt> {
    Some(Produkt {
        typ: p.get("typ")?.as_str()?.to_string(),
        monitoring: p.get("monitoring").and_then(Value::as_u64).unwrap_or(0),
        version: p.get("version").and_then(Value::as_u64).unwrap_or(0),
        fertig: true,
        // Die ZIPs nennen keine Aufnahmezeit maschinenlesbar; es zählt die Lieferung.
        aufnahme: None,
        sensor: None,
        geliefert: p
            .get("geliefert")
            .and_then(Value::as_str)
            .and_then(format_zeitpunkt),
        ebenen: Vec::new(),
        zip: Some(p.get("zip")?.as_str()?.to_string()),
    })
}

/// Rechteck als GeoJSON-Polygon: Umriss, bis das ZIP den genauen liefert, und Ersatz, wenn es
/// fehlt.
pub(crate) fn rechteck(b: &Bbox) -> Value {
    serde_json::json!({
        "type": "Polygon",
        "coordinates": [[
            [b.west, b.sued], [b.ost, b.sued], [b.ost, b.nord], [b.west, b.nord], [b.west, b.sued]
        ]]
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn liest_den_katalog_mit_emsr517() {
        let k = load_katalog();
        assert_eq!(k.len(), 1);
        let d = &k[0];
        assert_eq!(d.code, "EMSR517");
        assert!(!d.sensibel);
        assert_eq!(d.gebiete.len(), 17);
        let ahr = d.gebiete.iter().find(|g| g.nummer == 15).unwrap();
        assert_eq!(ahr.name, "Bad Neuenahr-Ahrweiler");
        assert!(ahr.huelle.west < 6.8 && ahr.huelle.ost > 7.28);
        assert_eq!(ahr.umriss["type"], "Polygon");
        let stufen: Vec<_> = ahr
            .produkte
            .iter()
            .map(|p| (p.typ.as_str(), p.monitoring, p.version))
            .collect();
        assert_eq!(stufen, [("GRA", 0, 1), ("GRA", 1, 3)]);
        let p = &ahr.produkte[1];
        assert!(p.fertig && p.ebenen.is_empty() && p.aufnahme.is_none());
        assert_eq!(p.geliefert.as_deref(), Some("2021-08-11 12:48:47"));
    }

    #[test]
    fn jede_zip_adresse_liegt_unter_dem_festen_praefix() {
        for d in load_katalog() {
            for g in &d.gebiete {
                for p in &g.produkte {
                    let zip = p.zip.as_deref().unwrap();
                    assert!(zip.starts_with(PAKET_BASIS), "{zip}");
                    assert!(zip.ends_with("_vector.zip"), "{zip}");
                }
            }
        }
    }

    #[test]
    fn kein_code_doppelt_und_jedes_gebiet_hat_produkte() {
        let k = load_katalog();
        let mut codes: Vec<_> = k.iter().map(|d| d.code.as_str()).collect();
        codes.sort();
        codes.dedup();
        assert_eq!(codes.len(), k.len());
        assert!(k
            .iter()
            .flat_map(|d| &d.gebiete)
            .all(|g| !g.produkte.is_empty()));
    }

    #[test]
    fn katalog_ohne_gebiete_ist_formatbruch() {
        assert_eq!(parse_katalog(&json!([{ "code": "X" }])), None);
        assert_eq!(parse_katalog(&json!({ "code": "X" })), None);
    }
}
