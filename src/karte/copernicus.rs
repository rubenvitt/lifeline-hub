//! Fachebene Copernicus EMS Rapid Mapping (LLH-1200).
//!
//! Drei Stufen, jede mit eigenem Cache-Eintrag: die Liste der öffentlichen Aktivierungen, die
//! Details je Aktivierung (Gebiete, Produkte, Ebenen-URLs) und das GeoJSON je Ebene. Eine Antwort
//! gilt einem Kartenausschnitt; sie zeigt je Auswertungsgebiet, das den Ausschnitt schneidet, den
//! jüngsten fertigen Stand je Produktart und den Umriss des Gebiets.
//!
//! Herleitung: `docs/superpowers/specs/2026-11-21-wqafyn8u-copernicus-ems-fachebene-design.md`.
//! Lizenz, Takt und Grenzen: `docs/fachebenen-quellen.md`, Abschnitt „Copernicus EMS“.

use crate::karte::typen::Bbox;
use chrono::NaiveDateTime;
use serde_json::Value;
use std::time::Duration;

/// Server-TTL der Antwort, der Liste und der Details laufender Aktivierungen.
pub(crate) const COPERNICUS_TTL: Duration = Duration::from_secs(1800);

/// Größte Spanne eines Ausschnitts in Grad je Achse (wie Energie). Das Frontend bremst mit
/// derselben Zahl.
pub(crate) const COPERNICUS_MAX_SPANNE_GRAD: f64 = 3.0;

pub(crate) const COPERNICUS_ATTRIB: &str =
    "© European Union, Copernicus Emergency Management Service";

/// Aktivierung aus der öffentlichen Liste.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Aktivierung {
    pub code: String,
    pub mittelpunkt: Option<(f64, f64)>,
    pub letzte_aenderung: Option<NaiveDateTime>,
    pub abgeschlossen: bool,
    pub produkte: u64,
}

/// Art einer Ebene, aus dem Ebenennamen der Quelle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EbenenArt {
    Beobachtet,
    MaxAusdehnung,
    Wassertiefe,
    NichtAusgewertet,
    SchadenGebaeude,
    SchadenVerkehr,
}

/// Liest die öffentliche Liste. `None`, wenn `results` fehlt: ein Formatbruch, nicht „leer“.
pub(crate) fn lies_liste(v: &Value) -> Option<Vec<Aktivierung>> {
    let ergebnisse = v.get("results")?.as_array()?;
    Some(
        ergebnisse
            .iter()
            .filter_map(|a| {
                Some(Aktivierung {
                    code: a.get("code")?.as_str()?.to_string(),
                    mittelpunkt: a.get("centroid").and_then(Value::as_str).and_then(wkt_punkt),
                    letzte_aenderung: a
                        .get("lastUpdate")
                        .and_then(Value::as_str)
                        .and_then(lies_zeit),
                    abgeschlossen: a.get("closed").and_then(Value::as_bool).unwrap_or(false),
                    produkte: a.get("n_products").and_then(Value::as_u64).unwrap_or(0),
                })
            })
            .collect(),
    )
}

/// `POINT (lon lat)` → `(lon, lat)`.
pub(crate) fn wkt_punkt(s: &str) -> Option<(f64, f64)> {
    let g = wkt_geometrie(s)?;
    if g["type"] != "Point" {
        return None;
    }
    let k = g["coordinates"].as_array()?;
    Some((k.first()?.as_f64()?, k.get(1)?.as_f64()?))
}

/// WKT `POINT`, `POLYGON` oder `MULTIPOLYGON` → GeoJSON-Geometrie. Andere Typen und kaputte
/// Klammern → `None`.
pub(crate) fn wkt_geometrie(s: &str) -> Option<Value> {
    let s = s.trim();
    let klammer = s.find('(')?;
    let typ = s[..klammer].trim().to_ascii_uppercase();
    let (geojson_typ, tiefe) = match typ.as_str() {
        "POINT" => ("Point", 0),
        "POLYGON" => ("Polygon", 2),
        "MULTIPOLYGON" => ("MultiPolygon", 3),
        _ => return None,
    };
    let mut rest = &s[klammer..];
    let koordinaten = lies_wkt_gruppe(&mut rest)?;
    if !rest.trim().is_empty() {
        return None;
    }
    // Eine Gruppe von Punkten ist ein Array von [lon, lat]; ein POINT hat genau einen.
    let koordinaten = if tiefe == 0 {
        koordinaten.as_array()?.first()?.clone()
    } else {
        koordinaten
    };
    if wkt_tiefe(&koordinaten) != tiefe + 1 {
        return None;
    }
    Some(serde_json::json!({ "type": geojson_typ, "coordinates": koordinaten }))
}

/// Verschachtelungstiefe eines Koordinaten-Arrays: `[lon, lat]` hat 1.
fn wkt_tiefe(v: &Value) -> usize {
    match v.as_array().and_then(|a| a.first()) {
        Some(erstes) if erstes.is_array() => 1 + wkt_tiefe(erstes),
        Some(_) => 1,
        None => 0,
    }
}

/// Liest `( … )` ab `rest`: entweder Untergruppen `((…), (…))` oder Punkte `x y, x y`.
fn lies_wkt_gruppe(rest: &mut &str) -> Option<Value> {
    *rest = rest.trim_start().strip_prefix('(')?;
    if rest.trim_start().starts_with('(') {
        let mut teile = Vec::new();
        loop {
            teile.push(lies_wkt_gruppe(rest)?);
            let r = rest.trim_start();
            if let Some(weiter) = r.strip_prefix(',') {
                *rest = weiter;
            } else {
                *rest = r.strip_prefix(')')?;
                return Some(Value::Array(teile));
            }
        }
    }
    let ende = rest.find(')')?;
    let punkte = rest[..ende]
        .split(',')
        .map(|p| {
            let zahlen: Vec<f64> = p
                .split_whitespace()
                .map(|z| z.parse::<f64>().ok())
                .collect::<Option<_>>()?;
            match zahlen.as_slice() {
                [x, y, ..] if x.is_finite() && y.is_finite() => Some(serde_json::json!([x, y])),
                _ => None,
            }
        })
        .collect::<Option<Vec<_>>>()?;
    *rest = &rest[ende + 1..];
    Some(Value::Array(punkte))
}

/// Rechteck um alle Koordinaten einer GeoJSON-Geometrie.
pub(crate) fn huelle(geometrie: &Value) -> Option<Bbox> {
    fn sammle(v: &Value, h: &mut Option<Bbox>) {
        let Some(a) = v.as_array() else { return };
        if let [x, y, ..] = a.as_slice() {
            if let (Some(x), Some(y)) = (x.as_f64(), y.as_f64()) {
                let b = h.get_or_insert(Bbox { west: x, sued: y, ost: x, nord: y });
                b.west = b.west.min(x);
                b.ost = b.ost.max(x);
                b.sued = b.sued.min(y);
                b.nord = b.nord.max(y);
                return;
            }
        }
        for teil in a {
            sammle(teil, h);
        }
    }
    let mut h = None;
    sammle(geometrie.get("coordinates")?, &mut h);
    h
}

/// Schneiden sich zwei Rechtecke? Berührung zählt.
pub(crate) fn schneidet(a: &Bbox, b: &Bbox) -> bool {
    a.west <= b.ost && a.ost >= b.west && a.sued <= b.nord && a.nord >= b.sued
}

/// Ohne Archiv zählen laufende Aktivierungen und solche, die höchstens so viele Tage zuvor zuletzt
/// geändert wurden.
const ZEITFENSTER_TAGE: i64 = 30;

/// Vorauswahl über den Mittelpunkt: Er liegt oft weit von den Gebieten (EMSR728: Stuttgart rund
/// 140 km davon), deshalb großzügig.
const VORAUSWAHL_RADIUS_M: f64 = 500_000.0;

/// Kandidaten für einen Ausschnitt: mit Produkten, im Zeitfenster (außer mit `archiv`) und mit
/// dem Mittelpunkt höchstens [`VORAUSWAHL_RADIUS_M`] vom Ausschnitt entfernt. Reihenfolge der
/// Liste.
pub(crate) fn waehle_kandidaten<'a>(
    liste: &'a [Aktivierung],
    bbox: &Bbox,
    jetzt: NaiveDateTime,
    archiv: bool,
) -> Vec<&'a Aktivierung> {
    let umgebung = bbox.erweitert_um_m(VORAUSWAHL_RADIUS_M);
    let grenze = jetzt - chrono::Duration::days(ZEITFENSTER_TAGE);
    liste
        .iter()
        .filter(|a| a.produkte > 0)
        .filter(|a| {
            archiv || !a.abgeschlossen || a.letzte_aenderung.is_some_and(|t| t >= grenze)
        })
        .filter(|a| {
            a.mittelpunkt.is_some_and(|(lon, lat)| {
                (umgebung.west..=umgebung.ost).contains(&lon)
                    && (umgebung.sued..=umgebung.nord).contains(&lat)
            })
        })
        .collect()
}

/// Ebenenart aus einem Ebenennamen wie `…_DEL_PRODUCT_floodDepthA_v2_VT`. Der Teil vor der
/// Version, ohne den letzten Buchstaben (A/L/P = Fläche, Linie, Punkt).
pub(crate) fn ebenen_art(name: &str) -> Option<EbenenArt> {
    let datei = name.rsplit('/').next()?;
    let teile: Vec<&str> = datei.split('_').collect();
    let version = teile
        .iter()
        .rposition(|t| t.len() > 1 && t.starts_with('v') && t[1..].bytes().all(|b| b.is_ascii_digit()))?;
    let teil = teile.get(version.checked_sub(1)?)?;
    let stamm = teil.strip_suffix(['A', 'L', 'P'])?;
    match stamm {
        "observedEvent" => Some(EbenenArt::Beobachtet),
        "maximumFloodExtent" => Some(EbenenArt::MaxAusdehnung),
        "floodDepth" => Some(EbenenArt::Wassertiefe),
        "notAnalysed" => Some(EbenenArt::NichtAusgewertet),
        "builtUp" => Some(EbenenArt::SchadenGebaeude),
        "transportation" => Some(EbenenArt::SchadenVerkehr),
        _ => None,
    }
}

impl EbenenArt {
    /// Wire-Wort von `art`.
    fn wort(self) -> &'static str {
        match self {
            EbenenArt::Beobachtet => "beobachtet",
            EbenenArt::MaxAusdehnung => "max_ausdehnung",
            EbenenArt::Wassertiefe => "wassertiefe",
            EbenenArt::NichtAusgewertet => "nicht_ausgewertet",
            EbenenArt::SchadenGebaeude => "schaden_gebaeude",
            EbenenArt::SchadenVerkehr => "schaden_verkehr",
        }
    }
}

/// Wire-Wort von `klasse` (gepinnt in `bildet_die_copernicus_klassen_ab` und im Frontend in
/// `theme/statusFarben.test.ts`). `None` ist der Gebietsumriss.
pub(crate) fn klasse(art: Option<EbenenArt>, props: &Value) -> &'static str {
    let text = |k: &str| props.get(k).and_then(Value::as_str).unwrap_or("").trim();
    match art {
        None => "gebiet",
        Some(EbenenArt::Beobachtet) => "beobachtet",
        Some(EbenenArt::MaxAusdehnung) => "max_ausdehnung",
        Some(EbenenArt::NichtAusgewertet) => "nicht_ausgewertet",
        Some(EbenenArt::Wassertiefe) => tiefe_klasse(text("value")),
        Some(EbenenArt::SchadenGebaeude | EbenenArt::SchadenVerkehr) => {
            match text("damage_gra").to_ascii_lowercase().as_str() {
                "destroyed" => "zerstoert",
                "damaged" => "beschaedigt",
                "possibly damaged" => "schaden_moeglich",
                "no visible damage" => "kein_schaden",
                _ => "unbekannt",
            }
        }
    }
}

/// Wassertiefe wie „Below 0.50“, „0.50 - 1.00“, „1.00 - 2.00“ oder „Above 2.00“: die erste Zahl
/// ist die Untergrenze.
fn tiefe_klasse(wert: &str) -> &'static str {
    if wert.to_ascii_lowercase().starts_with("below") {
        return "tiefe_gering";
    }
    let erste = wert
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|t| !t.is_empty())
        .and_then(|t| t.parse::<f64>().ok());
    match erste {
        Some(m) if m < 0.5 => "tiefe_gering",
        Some(m) if m < 1.0 => "tiefe_mittel",
        Some(_) => "tiefe_hoch",
        None => "unbekannt",
    }
}

/// Zeitpunkt der Quelle (`2024-06-01T05:06:00`, auch mit Sekundenbruchteil) als UTC im
/// `zeit::FORMAT` (ADR-0012). Die Quelle nennt Zeiten in UTC ohne Zone.
fn lies_zeit(s: &str) -> Option<NaiveDateTime> {
    use chrono::Timelike;
    let t = NaiveDateTime::parse_from_str(s.trim(), "%Y-%m-%dT%H:%M:%S%.f").ok()?;
    // Auf Sekunden: das Wire-Format kennt keine Bruchteile.
    t.with_nanosecond(0)
}

pub(crate) fn zeitpunkt(s: &str) -> Option<String> {
    lies_zeit(s).map(crate::zeit::formatiere)
}

/// Ein Produkt eines Gebiets, mit den Ebenen, die die Fachebene zeigt.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Produkt {
    /// `DEL` (Abgrenzung), `GRA` (Schadensklassen) oder `FEP` (erste Abschätzung).
    pub typ: String,
    pub monitoring: u64,
    pub version: u64,
    /// `version.statusCode == "F"`: geliefert.
    pub fertig: bool,
    /// Jüngste Aufnahmezeit der Bilder, `zeit::FORMAT`.
    pub aufnahme: Option<String>,
    /// Sensor des jüngsten Bildes.
    pub sensor: Option<String>,
    pub geliefert: Option<String>,
    /// Bekannte Ebenen im Format `vt`: Art und URL des GeoJSON.
    pub ebenen: Vec<(EbenenArt, String)>,
}

/// Auswertungsgebiet (AOI) einer Aktivierung.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Gebiet {
    pub nummer: u64,
    pub name: String,
    pub umriss: Value,
    pub huelle: Bbox,
    pub produkte: Vec<Produkt>,
}

/// Details einer Aktivierung.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Details {
    pub code: String,
    pub name: String,
    pub kategorie: String,
    pub sensibel: bool,
    pub gebiete: Vec<Gebiet>,
}

/// Liest die Details einer Aktivierung. `None` ohne Ergebnis (auch bei 403 „Authentication
/// credentials were not provided“, das die Quelle für alte Aktivierungen liefert).
pub(crate) fn lies_details(v: &Value) -> Option<Details> {
    let a = v.get("results")?.as_array()?.first()?;
    let text = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let gebiete = a
        .get("aois")
        .and_then(Value::as_array)
        .map(|aois| aois.iter().filter_map(lies_gebiet).collect())
        .unwrap_or_default();
    Some(Details {
        code: a.get("code")?.as_str()?.to_string(),
        name: text("name"),
        kategorie: text("category"),
        sensibel: a.get("sensitive").and_then(Value::as_bool).unwrap_or(false),
        gebiete,
    })
}

fn lies_gebiet(aoi: &Value) -> Option<Gebiet> {
    let umriss = wkt_geometrie(aoi.get("extent")?.as_str()?)?;
    let huelle = huelle(&umriss)?;
    Some(Gebiet {
        nummer: aoi.get("number").and_then(Value::as_u64).unwrap_or(0),
        name: aoi.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
        umriss,
        huelle,
        produkte: aoi
            .get("products")
            .and_then(Value::as_array)
            .map(|p| p.iter().filter_map(lies_produkt).collect())
            .unwrap_or_default(),
    })
}

fn lies_produkt(p: &Value) -> Option<Produkt> {
    let version = p.get("version");
    let feld = |k: &str| version.and_then(|v| v.get(k));
    // Jüngstes Bild: seine Aufnahme ist der Stand des Produkts, sein Sensor steht daneben.
    let juengstes = p
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let zeit = lies_zeit(b.get("acquisitionTime")?.as_str()?)?;
            Some((zeit, b.get("sensorName").and_then(Value::as_str)))
        })
        .max_by_key(|(zeit, _)| *zeit);
    let ebenen = p
        .get("layers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|l| l.get("format").and_then(Value::as_str) == Some("vt"))
        .filter_map(|l| {
            let art = ebenen_art(l.get("name")?.as_str()?)?;
            let url = l.get("json")?.as_str()?;
            url.starts_with("https://").then(|| (art, url.to_string()))
        })
        .collect();
    Some(Produkt {
        typ: p.get("type")?.as_str()?.to_string(),
        monitoring: p.get("monitoringNumber").and_then(Value::as_u64).unwrap_or(0),
        version: feld("number").and_then(Value::as_u64).unwrap_or(0),
        fertig: feld("statusCode").and_then(Value::as_str) == Some("F"),
        aufnahme: juengstes.map(|(zeit, _)| crate::zeit::formatiere(zeit)),
        sensor: juengstes.and_then(|(_, sensor)| sensor.map(str::to_string)),
        geliefert: feld("deliveryTime").and_then(Value::as_str).and_then(zeitpunkt),
        ebenen,
    })
}

/// Je Produktart der jüngste fertige Stand mit Ebenen: höchste Monitoring-Nummer, dann höchste
/// Version. Die erste Abschätzung (FEP) nur, solange es keine Abgrenzung (DEL) gibt. Reihenfolge
/// nach Produktart.
pub(crate) fn waehle_produkte(g: &Gebiet) -> Vec<&Produkt> {
    let mut je_typ: std::collections::BTreeMap<&str, &Produkt> = Default::default();
    for p in g.produkte.iter().filter(|p| p.fertig && !p.ebenen.is_empty()) {
        let besser = je_typ
            .get(p.typ.as_str())
            .is_none_or(|b| (p.monitoring, p.version) > (b.monitoring, b.version));
        if besser {
            je_typ.insert(&p.typ, p);
        }
    }
    if je_typ.contains_key("DEL") {
        je_typ.remove("FEP");
    }
    je_typ.into_values().collect()
}

/// Gemeinsame Herkunftsfelder jedes Features eines Produkts.
fn herkunft(d: &Details, g: &Gebiet, p: &Produkt) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    m.insert("emsr".into(), d.code.clone().into());
    m.insert("aktivierung".into(), d.name.clone().into());
    m.insert("kategorie".into(), d.kategorie.clone().into());
    m.insert("gebiet".into(), g.name.clone().into());
    m.insert("produkt".into(), p.typ.clone().into());
    m.insert("monitoring".into(), p.monitoring.into());
    m.insert("version".into(), p.version.into());
    for (k, v) in [("aufnahme", &p.aufnahme), ("sensor", &p.sensor), ("geliefert", &p.geliefert)] {
        if let Some(v) = v {
            m.insert(k.into(), v.clone().into());
        }
    }
    m
}

/// Features einer Ebene der Quelle → einheitliche Features der Fachebene. Ohne Geometrie fällt
/// ein Feature weg; ohne `features`-Liste ist das Ergebnis leer.
pub(crate) fn normalisiere_ebene(
    fc: &Value,
    art: EbenenArt,
    d: &Details,
    g: &Gebiet,
    p: &Produkt,
) -> Vec<Value> {
    let basis = herkunft(d, g, p);
    fc.get("features")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|f| {
            let geometrie = f.get("geometry").filter(|g| g.is_object())?;
            let roh = f.get("properties").cloned().unwrap_or(Value::Null);
            let mut props = basis.clone();
            props.insert("art".into(), art.wort().into());
            props.insert("klasse".into(), klasse(Some(art), &roh).into());
            let beschreibung = ["obj_desc", "info", "notation"]
                .iter()
                .filter_map(|k| roh.get(*k).and_then(Value::as_str))
                .map(str::trim)
                .find(|t| !t.is_empty() && *t != "Not Applicable");
            if let Some(b) = beschreibung {
                props.insert("beschreibung".into(), b.into());
            }
            Some(serde_json::json!({
                "type": "Feature",
                "geometry": geometrie,
                "properties": props,
            }))
        })
        .collect()
}

/// Umriss eines Gebiets als Feature, mit der Herkunft des jüngsten gezeigten Produkts und den
/// Marken `unvollstaendig` (eine Ebene fehlt) und `gekuerzt` (Obergrenze der Dateien erreicht).
pub(crate) fn gebiet_feature(
    d: &Details,
    g: &Gebiet,
    gewaehlt: &[&Produkt],
    unvollstaendig: bool,
    gekuerzt: bool,
) -> Value {
    let juengstes = gewaehlt.iter().max_by(|a, b| a.aufnahme.cmp(&b.aufnahme));
    let mut props = match juengstes {
        Some(p) => herkunft(d, g, p),
        None => {
            let mut m = serde_json::Map::new();
            m.insert("emsr".into(), d.code.clone().into());
            m.insert("aktivierung".into(), d.name.clone().into());
            m.insert("kategorie".into(), d.kategorie.clone().into());
            m.insert("gebiet".into(), g.name.clone().into());
            m
        }
    };
    props.insert("art".into(), "gebiet".into());
    props.insert("klasse".into(), klasse(None, &Value::Null).into());
    props.insert("unvollstaendig".into(), unvollstaendig.into());
    props.insert("gekuerzt".into(), gekuerzt.into());
    serde_json::json!({ "type": "Feature", "geometry": g.umriss, "properties": props })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const LISTE: &str = include_str!("testdaten/copernicus-liste.json");

    fn t(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    /// Ausschnitt um Stuttgart, Gebiet 1 von EMSR728.
    fn stuttgart() -> Bbox {
        Bbox::parse("9.10,48.70,9.40,48.90").unwrap()
    }

    #[test]
    fn liest_die_liste() {
        let liste = lies_liste(&serde_json::from_str(LISTE).unwrap()).unwrap();
        let emsr728 = liste.iter().find(|a| a.code == "EMSR728").unwrap();
        assert_eq!(emsr728.mittelpunkt, Some((10.890198, 48.973487)));
        assert!(emsr728.abgeschlossen);
        assert_eq!(emsr728.produkte, 37);
        assert_eq!(emsr728.letzte_aenderung, Some(t("2024-09-04 15:58:13")));
    }

    #[test]
    fn liste_ohne_ergebnisse_ist_formatbruch() {
        assert_eq!(lies_liste(&json!({ "detail": "nope" })), None);
    }

    #[test]
    fn liest_wkt() {
        assert_eq!(wkt_punkt("POINT (7.5 50.25)"), Some((7.5, 50.25)));
        assert_eq!(wkt_punkt("POLYGON ((1 2, 3 4))"), None);
        let g = wkt_geometrie("POLYGON ((1 2, 3 2, 3 5, 1 2))").unwrap();
        assert_eq!(g["type"], "Polygon");
        assert_eq!(g["coordinates"], json!([[[1.0, 2.0], [3.0, 2.0], [3.0, 5.0], [1.0, 2.0]]]));
        let h = huelle(&g).unwrap();
        assert_eq!((h.west, h.sued, h.ost, h.nord), (1.0, 2.0, 3.0, 5.0));
        let m = wkt_geometrie("MULTIPOLYGON (((1 2, 3 2, 1 2)), ((5 6, 7 6, 5 6)))").unwrap();
        assert_eq!(m["type"], "MultiPolygon");
        assert_eq!(huelle(&m).unwrap().ost, 7.0);
        assert_eq!(wkt_geometrie("POLYGON ((1 2, 3"), None);
        assert_eq!(wkt_geometrie("LINESTRING (1 2, 3 4)"), None);
    }

    fn akt(code: &str, lon: f64, lat: f64, geaendert: &str, zu: bool, n: u64) -> Aktivierung {
        Aktivierung {
            code: code.into(),
            mittelpunkt: Some((lon, lat)),
            letzte_aenderung: Some(t(geaendert)),
            abgeschlossen: zu,
            produkte: n,
        }
    }

    #[test]
    fn waehlt_kandidaten_nach_zeit_raum_und_produkten() {
        let jetzt = t("2026-11-21 12:00:00");
        let liste = vec![
            // fern im Mittelpunkt (140 km), alt und abgeschlossen
            akt("ALT", 10.89, 48.97, "2024-09-04 15:58:13", true, 37),
            // laufend, in der Nähe
            akt("LAEUFT", 9.5, 48.8, "2026-01-01 00:00:00", false, 3),
            // abgeschlossen, vor 10 Tagen geändert
            akt("JUNG", 9.5, 48.8, "2026-11-11 00:00:00", true, 2),
            // abgeschlossen, genau vor 31 Tagen
            akt("ZU_ALT", 9.5, 48.8, "2026-10-21 11:59:59", true, 2),
            // ohne Produkte
            akt("LEER", 9.5, 48.8, "2026-11-20 00:00:00", false, 0),
            // zu weit weg (Portugal)
            akt("FERN", -7.5, 40.4, "2026-11-20 00:00:00", false, 5),
        ];
        let codes = |v: Vec<&Aktivierung>| v.iter().map(|a| a.code.clone()).collect::<Vec<_>>();
        assert_eq!(
            codes(waehle_kandidaten(&liste, &stuttgart(), jetzt, false)),
            ["LAEUFT", "JUNG"]
        );
        assert_eq!(
            codes(waehle_kandidaten(&liste, &stuttgart(), jetzt, true)),
            ["ALT", "LAEUFT", "JUNG", "ZU_ALT"]
        );
    }

    #[test]
    fn genau_dreissig_tage_gelten_noch() {
        let jetzt = t("2026-11-21 12:00:00");
        let liste = vec![akt("GRENZE", 9.5, 48.8, "2026-10-22 12:00:00", true, 1)];
        assert_eq!(waehle_kandidaten(&liste, &stuttgart(), jetzt, false).len(), 1);
    }

    #[test]
    fn erkennt_die_ebenenart_am_namen() {
        let n = |s: &str| ebenen_art(&format!("EMSR728/AOI01/DEL_PRODUCT/EMSR728_AOI01_DEL_PRODUCT_{s}_v2_VT"));
        assert_eq!(n("observedEventA"), Some(EbenenArt::Beobachtet));
        assert_eq!(n("observedEventL"), Some(EbenenArt::Beobachtet));
        assert_eq!(n("maximumFloodExtentA"), Some(EbenenArt::MaxAusdehnung));
        assert_eq!(n("floodDepthA"), Some(EbenenArt::Wassertiefe));
        assert_eq!(n("notAnalysedA"), Some(EbenenArt::NichtAusgewertet));
        assert_eq!(n("builtUpP"), Some(EbenenArt::SchadenGebaeude));
        assert_eq!(n("transportationL"), Some(EbenenArt::SchadenVerkehr));
        // Modell statt Beobachtung und Referenzdaten bleiben draußen.
        assert_eq!(n("modelledEventA"), None);
        assert_eq!(n("naturalLandUseA"), None);
    }

    /// Wire-Wörter von `klasse`; das Frontend pinnt dieselben (`theme/statusFarben.test.ts`).
    #[test]
    fn bildet_die_copernicus_klassen_ab() {
        use EbenenArt::*;
        let tiefe = |v: &str| klasse(Some(Wassertiefe), &json!({ "value": v }));
        assert_eq!(tiefe("Below 0.50"), "tiefe_gering");
        assert_eq!(tiefe("0.50 - 1.00"), "tiefe_mittel");
        assert_eq!(tiefe("1.00 - 2.00"), "tiefe_hoch");
        assert_eq!(tiefe("Above 2.00"), "tiefe_hoch");
        assert_eq!(tiefe("?"), "unbekannt");
        let schaden = |d: &str| klasse(Some(SchadenVerkehr), &json!({ "damage_gra": d }));
        assert_eq!(schaden("Destroyed"), "zerstoert");
        assert_eq!(schaden("Damaged"), "beschaedigt");
        assert_eq!(schaden("Possibly damaged"), "schaden_moeglich");
        assert_eq!(schaden("No visible damage"), "kein_schaden");
        assert_eq!(schaden("966"), "unbekannt");
        assert_eq!(klasse(Some(SchadenGebaeude), &json!({})), "unbekannt");
        assert_eq!(klasse(Some(Beobachtet), &json!({})), "beobachtet");
        assert_eq!(klasse(Some(MaxAusdehnung), &json!({})), "max_ausdehnung");
        assert_eq!(klasse(Some(NichtAusgewertet), &json!({})), "nicht_ausgewertet");
        assert_eq!(klasse(None, &json!({})), "gebiet");
    }

    const EMSR728: &str = include_str!("testdaten/copernicus-emsr728.json");
    const EBENE_TIEFE: &str = include_str!("testdaten/copernicus-ebene-tiefe.json");
    const EBENE_VERKEHR: &str = include_str!("testdaten/copernicus-ebene-verkehr.json");

    fn emsr728() -> Details {
        lies_details(&serde_json::from_str(EMSR728).unwrap()).unwrap()
    }

    #[test]
    fn liest_die_details() {
        let d = emsr728();
        assert_eq!((d.code.as_str(), d.name.as_str()), ("EMSR728", "Flood in Germany"));
        assert_eq!(d.kategorie, "Flood");
        assert!(!d.sensibel);
        assert_eq!(d.gebiete.len(), 2);
        let g1 = &d.gebiete[0];
        assert_eq!((g1.nummer, g1.name.as_str()), (1, "Stuttgart"));
        assert_eq!(g1.umriss["type"], "Polygon");
        assert!(g1.huelle.west < 9.0 && g1.huelle.ost > 9.5, "{:?}", g1.huelle);
        let erst = g1
            .produkte
            .iter()
            .find(|p| p.typ == "DEL" && p.monitoring == 0)
            .unwrap();
        assert_eq!(erst.version, 2);
        assert!(erst.fertig);
        assert_eq!(erst.aufnahme.as_deref(), Some("2024-06-01 05:43:00"));
        // Version 2 wurde am 04.06. neu geliefert, nach den Aufnahmen vom 01.06.
        assert_eq!(erst.geliefert.as_deref().map(|s| &s[..10]), Some("2024-06-04"));
        let arten: Vec<_> = erst.ebenen.iter().map(|(a, _)| *a).collect();
        assert_eq!(arten, [EbenenArt::Wassertiefe, EbenenArt::Beobachtet]);
        assert!(erst.ebenen[0].1.starts_with("https://rapidmapping-viewer.s3."));
        assert!(erst.ebenen[0].1.ends_with("_floodDepthA_v2.json"));
    }

    #[test]
    fn details_ohne_ergebnis_sind_formatbruch() {
        assert_eq!(lies_details(&json!({ "count": 0, "results": [] })), None);
        assert_eq!(lies_details(&json!({ "detail": "Authentication credentials were not provided." })), None);
    }

    #[test]
    fn rechtecke_schneiden_sich() {
        let a = Bbox::parse("0,0,2,2").unwrap();
        assert!(schneidet(&a, &Bbox::parse("1,1,3,3").unwrap()));
        assert!(schneidet(&a, &Bbox::parse("2,2,3,3").unwrap()), "Berührung zählt");
        assert!(!schneidet(&a, &Bbox::parse("2.1,0,3,2").unwrap()));
        assert!(!schneidet(&a, &Bbox::parse("0,2.1,2,3").unwrap()));
    }

    #[test]
    fn waehlt_je_art_den_juengsten_fertigen_stand() {
        let d = emsr728();
        // Gebiet 1: DEL v2 (Erstprodukt), MONIT01..02 fertig, MONIT03/04 nicht fertig und ohne
        // Ebenen → MONIT02.
        let g1: Vec<_> = waehle_produkte(&d.gebiete[0])
            .iter()
            .map(|p| (p.typ.clone(), p.monitoring))
            .collect();
        assert_eq!(g1, [("DEL".to_string(), 2)]);
        let g9: Vec<_> = waehle_produkte(&d.gebiete[1]).iter().map(|p| p.typ.clone()).collect();
        assert_eq!(g9, ["GRA"]);
    }

    fn produkt(typ: &str, monitoring: u64, version: u64, fertig: bool) -> Produkt {
        Produkt {
            typ: typ.into(),
            monitoring,
            version,
            fertig,
            aufnahme: None,
            sensor: None,
            geliefert: None,
            ebenen: vec![(EbenenArt::Beobachtet, format!("{typ}{monitoring}v{version}"))],
        }
    }

    #[test]
    fn hoehere_version_und_fep_nur_ohne_del() {
        let mut g = emsr728().gebiete.remove(0);
        g.produkte = vec![
            produkt("FEP", 0, 1, true),
            produkt("DEL", 0, 1, true),
            produkt("DEL", 0, 3, true),
            produkt("DEL", 0, 4, false),
        ];
        let w: Vec<_> = waehle_produkte(&g).iter().map(|p| (p.typ.clone(), p.version)).collect();
        assert_eq!(w, [("DEL".to_string(), 3)]);
        g.produkte = vec![produkt("FEP", 0, 1, true), produkt("GRA", 0, 1, true)];
        let w: Vec<_> = waehle_produkte(&g).iter().map(|p| p.typ.clone()).collect();
        assert_eq!(w, ["FEP", "GRA"]);
        // Ohne Ebenen zählt ein Produkt nicht.
        let mut leer = produkt("DEL", 5, 1, true);
        leer.ebenen.clear();
        g.produkte = vec![produkt("FEP", 0, 1, true), leer];
        let w: Vec<_> = waehle_produkte(&g).iter().map(|p| p.typ.clone()).collect();
        assert_eq!(w, ["FEP"]);
    }

    #[test]
    fn normalisiert_eine_ebene() {
        let d = emsr728();
        let g = &d.gebiete[0];
        let p = waehle_produkte(g)[0];
        let fc: Value = serde_json::from_str(EBENE_TIEFE).unwrap();
        let f = normalisiere_ebene(&fc, EbenenArt::Wassertiefe, &d, g, p);
        assert_eq!(f.len(), 5);
        let pr = &f[0]["properties"];
        assert_eq!(pr["art"], "wassertiefe");
        assert_eq!(pr["klasse"], "tiefe_mittel");
        assert_eq!(pr["emsr"], "EMSR728");
        assert_eq!(pr["aktivierung"], "Flood in Germany");
        assert_eq!(pr["kategorie"], "Flood");
        assert_eq!(pr["gebiet"], "Stuttgart");
        assert_eq!(pr["produkt"], "DEL");
        assert_eq!(pr["monitoring"], 2);
        assert_eq!(pr["version"], 1);
        assert_eq!(pr["aufnahme"], "2024-06-03 17:16:00");
        assert_eq!(pr["beschreibung"], "Estimated Flood Depth");
        assert_eq!(f[4]["properties"]["klasse"], "tiefe_hoch");
        assert_eq!(f[0]["type"], "Feature");
        assert_eq!(f[0]["geometry"]["type"], "Polygon");

        let fc: Value = serde_json::from_str(EBENE_VERKEHR).unwrap();
        let g9 = &d.gebiete[1];
        let f = normalisiere_ebene(&fc, EbenenArt::SchadenVerkehr, &d, g9, waehle_produkte(g9)[0]);
        assert_eq!(f[0]["properties"]["art"], "schaden_verkehr");
        assert_eq!(f[0]["properties"]["klasse"], "schaden_moeglich");
        assert_eq!(f[0]["properties"]["beschreibung"], "21120-Primary Road");
        assert_eq!(f[0]["geometry"]["type"], "LineString");
    }

    #[test]
    fn feature_ohne_geometrie_faellt_weg() {
        let d = emsr728();
        let g = &d.gebiete[0];
        let fc = json!({ "type": "FeatureCollection", "features": [
            { "type": "Feature", "properties": {}, "geometry": null },
            { "type": "Feature", "properties": {} },
            { "type": "Feature", "properties": {}, "geometry": { "type": "Point", "coordinates": [9.2, 48.8] } }
        ]});
        assert_eq!(normalisiere_ebene(&fc, EbenenArt::Beobachtet, &d, g, &g.produkte[0]).len(), 1);
        assert!(normalisiere_ebene(&json!({ "x": 1 }), EbenenArt::Beobachtet, &d, g, &g.produkte[0]).is_empty());
    }

    /// Abnahme (LLH-1200): Die Überflutungsflächen von EMSR728 liegen lagerichtig im Umriss von
    /// Gebiet 1 (Stuttgart), in lon/lat-Reihenfolge, nicht vertauscht.
    #[test]
    fn ueberflutungsflaechen_liegen_lagerichtig() {
        let d = emsr728();
        let g = &d.gebiete[0];
        let fc: Value = serde_json::from_str(EBENE_TIEFE).unwrap();
        let f = normalisiere_ebene(&fc, EbenenArt::Wassertiefe, &d, g, waehle_produkte(g)[0]);
        assert!(!f.is_empty());
        for feature in &f {
            let h = huelle(&feature["geometry"]).unwrap();
            assert!(
                h.west >= g.huelle.west && h.ost <= g.huelle.ost,
                "Länge außerhalb von Gebiet 1: {h:?}"
            );
            assert!(
                h.sued >= g.huelle.sued && h.nord <= g.huelle.nord,
                "Breite außerhalb von Gebiet 1: {h:?}"
            );
            // Stuttgart liegt bei rund 9° Ost, 48,8° Nord.
            assert!((8.9..9.6).contains(&h.west) && (48.5..49.0).contains(&h.sued));
        }
    }

    #[test]
    fn gebiet_als_umriss_mit_marken() {
        let d = emsr728();
        let g = &d.gebiete[0];
        let gewaehlt = waehle_produkte(g);
        let f = gebiet_feature(&d, g, &gewaehlt, true, false);
        assert_eq!(f["geometry"]["type"], "Polygon");
        let pr = &f["properties"];
        assert_eq!(pr["art"], "gebiet");
        assert_eq!(pr["klasse"], "gebiet");
        assert_eq!(pr["gebiet"], "Stuttgart");
        assert_eq!(pr["emsr"], "EMSR728");
        assert_eq!(pr["aufnahme"], "2024-06-03 17:16:00");
        assert_eq!(pr["produkt"], "DEL");
        assert_eq!(pr["unvollstaendig"], true);
        assert_eq!(pr["gekuerzt"], false);
    }

    #[test]
    fn zeitpunkte_im_wire_format() {
        assert_eq!(zeitpunkt("2024-06-01T05:06:00").as_deref(), Some("2024-06-01 05:06:00"));
        assert_eq!(
            zeitpunkt("2024-09-04T15:58:13.172773").as_deref(),
            Some("2024-09-04 15:58:13")
        );
        assert_eq!(zeitpunkt("gestern"), None);
    }
}
