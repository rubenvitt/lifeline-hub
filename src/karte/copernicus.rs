//! Fachebene Copernicus EMS Rapid Mapping (LLH-1200).
//!
//! Drei Stufen, jede mit eigenem Cache-Eintrag: die Liste der öffentlichen Aktivierungen, die
//! Details je Aktivierung (Gebiete, Produkte, Ebenen-URLs) und das GeoJSON je Ebene. Eine Antwort
//! gilt einem Kartenausschnitt; sie zeigt je Auswertungsgebiet, das den Ausschnitt schneidet, den
//! jüngsten fertigen Stand je Produktart und den Umriss des Gebiets.
//!
//! Herleitung: `docs/superpowers/specs/2026-11-21-wqafyn8u-copernicus-ems-fachebene-design.md`.
//! Lizenz, Takt und Grenzen: `docs/fachebenen-quellen.md`, Abschnitt „Copernicus EMS“.

use crate::error::AppError;
use crate::karte::typen::{Bbox, FachebeneAntwort};
use crate::karte::{cache, quellen, FachebenenState};
use chrono::NaiveDateTime;
use futures::stream::{self, StreamExt};
use serde_json::Value;
use sqlx::SqlitePool;
use std::future::Future;
use std::time::Duration;

/// Server-TTL der Antwort, der Liste und der Details laufender Aktivierungen.
pub(crate) const COPERNICUS_TTL: Duration = Duration::from_secs(1800);

/// Größte Spanne eines Ausschnitts in Grad je Achse (wie Energie). Das Frontend bremst mit
/// derselben Zahl.
pub(crate) const COPERNICUS_MAX_SPANNE_GRAD: f64 = 3.0;

/// TTL der Details einer abgeschlossenen Aktivierung; unter dem Cache-Deckel von 48 h.
const COPERNICUS_TTL_ABGESCHLOSSEN: Duration = Duration::from_secs(24 * 3600);

/// TTL einer Ebenen-Datei. Die Version steht im Dateinamen, der Inhalt ändert sich nicht.
const COPERNICUS_EBENE_TTL: Duration = Duration::from_secs(24 * 3600);

/// Wartefrist eines kalten Abrufs (Liste, Details, bis zu [`MAX_EBENEN`] Dateien). Deutlich
/// unter den 15 s, nach denen der Client abbricht (`frontend/src/api/client.ts`): sonst käme
/// `offline` erst, wenn der Client schon „Server nicht erreichbar“ meldet. Wie Energie.
const COPERNICUS_WARTE: Duration = Duration::from_secs(10);

/// Obergrenze der normalisierten Features je Antwort in Byte. Fachebenen-Antworten gehen
/// ungepackt hinaus (`src/AGENTS.md`, „Antwortkompression“); 6 MiB kommen auch über eine
/// schmale Funkverbindung, bevor der Client nach 15 s abbricht. Darüber trägt das Gebiet
/// `gekuerzt`.
const MAX_ANTWORT_BYTES: usize = 6 * 1024 * 1024;

/// Nur von hier lädt die Ebene GeoJSON: die URLs stehen in fremdem JSON.
const EBENEN_BASIS: &str = "https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com/";

/// Tiefste Verschachtelung einer WKT-Geometrie (MULTIPOLYGON: Polygone, Ringe, Punkte).
const WKT_MAX_TIEFE: usize = 3;

/// Gleichzeitige Abrufe von Ebenen-Dateien.
const PARALLEL: usize = 6;

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
pub(crate) fn parse_liste(v: &Value) -> Option<Vec<Aktivierung>> {
    let ergebnisse = v.get("results")?.as_array()?;
    Some(
        ergebnisse
            .iter()
            .filter_map(|a| {
                Some(Aktivierung {
                    code: a.get("code")?.as_str()?.to_string(),
                    mittelpunkt: a
                        .get("centroid")
                        .and_then(Value::as_str)
                        .and_then(parse_wkt_punkt),
                    letzte_aenderung: a
                        .get("lastUpdate")
                        .and_then(Value::as_str)
                        .and_then(parse_zeit),
                    abgeschlossen: a.get("closed").and_then(Value::as_bool).unwrap_or(false),
                    produkte: a.get("n_products").and_then(Value::as_u64).unwrap_or(0),
                })
            })
            .collect(),
    )
}

/// `POINT (lon lat)` → `(lon, lat)`.
pub(crate) fn parse_wkt_punkt(s: &str) -> Option<(f64, f64)> {
    let g = parse_wkt_geometrie(s)?;
    if g["type"] != "Point" {
        return None;
    }
    let k = g["coordinates"].as_array()?;
    Some((k.first()?.as_f64()?, k.get(1)?.as_f64()?))
}

/// WKT `POINT`, `POLYGON` oder `MULTIPOLYGON` → GeoJSON-Geometrie. Andere Typen und kaputte
/// Klammern → `None`.
pub(crate) fn parse_wkt_geometrie(s: &str) -> Option<Value> {
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
    let koordinaten = parse_wkt_gruppe(&mut rest, 0)?;
    if !rest.trim().is_empty() {
        return None;
    }
    // Eine Gruppe von Punkten ist ein Array von [lon, lat]; ein POINT hat genau einen.
    let koordinaten = if tiefe == 0 {
        koordinaten.as_array()?.first()?.clone()
    } else {
        koordinaten
    };
    if wkt_depth(&koordinaten) != tiefe + 1 {
        return None;
    }
    Some(serde_json::json!({ "type": geojson_typ, "coordinates": koordinaten }))
}

/// Verschachtelungstiefe eines Koordinaten-Arrays: `[lon, lat]` hat 1.
fn wkt_depth(v: &Value) -> usize {
    match v.as_array().and_then(|a| a.first()) {
        Some(erstes) if erstes.is_array() => 1 + wkt_depth(erstes),
        Some(_) => 1,
        None => 0,
    }
}

/// Liest `( … )` ab `rest`: entweder Untergruppen `((…), (…))` oder Punkte `x y, x y`. Die
/// Tiefe wird VOR dem Abstieg geprüft: fremdes WKT mit Tausenden `(` liefe sonst über den Stack
/// des Workers, und das ist keine Panik, sondern das Ende des Prozesses.
fn parse_wkt_gruppe(rest: &mut &str, tiefe: usize) -> Option<Value> {
    *rest = rest.trim_start().strip_prefix('(')?;
    if rest.trim_start().starts_with('(') {
        if tiefe + 1 >= WKT_MAX_TIEFE {
            return None;
        }
        let mut teile = Vec::new();
        loop {
            teile.push(parse_wkt_gruppe(rest, tiefe + 1)?);
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
pub(crate) fn bounding_box(geometrie: &Value) -> Option<Bbox> {
    fn collect_bbox(v: &Value, h: &mut Option<Bbox>) {
        let Some(a) = v.as_array() else { return };
        if let [x, y, ..] = a.as_slice() {
            if let (Some(x), Some(y)) = (x.as_f64(), y.as_f64()) {
                let b = h.get_or_insert(Bbox {
                    west: x,
                    sued: y,
                    ost: x,
                    nord: y,
                });
                b.west = b.west.min(x);
                b.ost = b.ost.max(x);
                b.sued = b.sued.min(y);
                b.nord = b.nord.max(y);
                return;
            }
        }
        for teil in a {
            collect_bbox(teil, h);
        }
    }
    let mut h = None;
    collect_bbox(geometrie.get("coordinates")?, &mut h);
    h
}

/// Schneiden sich zwei Rechtecke? Berührung zählt.
pub(crate) fn intersects(a: &Bbox, b: &Bbox) -> bool {
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
pub(crate) fn select_kandidaten<'a>(
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
        .filter(|a| archiv || !a.abgeschlossen || a.letzte_aenderung.is_some_and(|t| t >= grenze))
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
pub(crate) fn parse_ebenen_art(name: &str) -> Option<EbenenArt> {
    let datei = name.rsplit('/').next()?;
    let teile: Vec<&str> = datei.split('_').collect();
    let version = teile.iter().rposition(|t| {
        t.len() > 1 && t.starts_with('v') && t[1..].bytes().all(|b| b.is_ascii_digit())
    })?;
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
    fn wire_value(self) -> &'static str {
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
pub(crate) fn klasse_of(art: Option<EbenenArt>, props: &Value) -> &'static str {
    let text = |k: &str| props.get(k).and_then(Value::as_str).unwrap_or("").trim();
    match art {
        None => "gebiet",
        Some(EbenenArt::Beobachtet) => "beobachtet",
        Some(EbenenArt::MaxAusdehnung) => "max_ausdehnung",
        Some(EbenenArt::NichtAusgewertet) => "nicht_ausgewertet",
        Some(EbenenArt::Wassertiefe) => tiefe_klasse_of(text("value")),
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
fn tiefe_klasse_of(wert: &str) -> &'static str {
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
fn parse_zeit(s: &str) -> Option<NaiveDateTime> {
    use chrono::Timelike;
    // Ein angehängtes `Z` sagt nur, was ohnehin gilt (UTC).
    let roh = s.trim().trim_end_matches('Z');
    let t = NaiveDateTime::parse_from_str(roh, "%Y-%m-%dT%H:%M:%S%.f").ok()?;
    // Auf Sekunden: das Wire-Format kennt keine Bruchteile.
    t.with_nanosecond(0)
}

pub(crate) fn format_zeitpunkt(s: &str) -> Option<String> {
    parse_zeit(s).map(crate::zeit::formatiere)
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
pub(crate) fn parse_details(v: &Value) -> Option<Details> {
    let a = v.get("results")?.as_array()?.first()?;
    let text = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let gebiete = a
        .get("aois")
        .and_then(Value::as_array)
        .map(|aois| aois.iter().filter_map(parse_gebiet).collect())
        .unwrap_or_default();
    Some(Details {
        code: a.get("code")?.as_str()?.to_string(),
        name: text("name"),
        kategorie: text("category"),
        sensibel: a.get("sensitive").and_then(Value::as_bool).unwrap_or(false),
        gebiete,
    })
}

fn parse_gebiet(aoi: &Value) -> Option<Gebiet> {
    let umriss = parse_wkt_geometrie(aoi.get("extent")?.as_str()?)?;
    let huelle = bounding_box(&umriss)?;
    Some(Gebiet {
        nummer: aoi.get("number").and_then(Value::as_u64).unwrap_or(0),
        name: aoi
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        umriss,
        huelle,
        produkte: aoi
            .get("products")
            .and_then(Value::as_array)
            .map(|p| p.iter().filter_map(parse_produkt).collect())
            .unwrap_or_default(),
    })
}

fn parse_produkt(p: &Value) -> Option<Produkt> {
    let version = p.get("version");
    let feld = |k: &str| version.and_then(|v| v.get(k));
    // Jüngstes Bild: seine Aufnahme ist der Stand des Produkts, sein Sensor steht daneben.
    let juengstes = p
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let zeit = parse_zeit(b.get("acquisitionTime")?.as_str()?)?;
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
            let art = parse_ebenen_art(l.get("name")?.as_str()?)?;
            let url = l.get("json")?.as_str()?;
            url.starts_with(EBENEN_BASIS)
                .then(|| (art, url.to_string()))
        })
        .collect();
    Some(Produkt {
        typ: p.get("type")?.as_str()?.to_string(),
        monitoring: p
            .get("monitoringNumber")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        version: feld("number").and_then(Value::as_u64).unwrap_or(0),
        fertig: feld("statusCode").and_then(Value::as_str) == Some("F"),
        aufnahme: juengstes.map(|(zeit, _)| crate::zeit::formatiere(zeit)),
        sensor: juengstes.and_then(|(_, sensor)| sensor.map(str::to_string)),
        geliefert: feld("deliveryTime")
            .and_then(Value::as_str)
            .and_then(format_zeitpunkt),
        ebenen,
    })
}

/// Je Produktart der jüngste fertige Stand mit Ebenen: höchste Monitoring-Nummer, dann höchste
/// Version. Die erste Abschätzung (FEP) nur, solange es keine Abgrenzung (DEL) gibt. Reihenfolge
/// nach Produktart.
pub(crate) fn select_produkte(g: &Gebiet) -> Vec<&Produkt> {
    let mut je_typ: std::collections::BTreeMap<&str, &Produkt> = Default::default();
    for p in g
        .produkte
        .iter()
        .filter(|p| p.fertig && !p.ebenen.is_empty())
    {
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
fn herkunft_props(d: &Details, g: &Gebiet, p: &Produkt) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    m.insert("emsr".into(), d.code.clone().into());
    m.insert("aktivierung".into(), d.name.clone().into());
    m.insert("kategorie".into(), d.kategorie.clone().into());
    m.insert("gebiet".into(), g.name.clone().into());
    m.insert("produkt".into(), p.typ.clone().into());
    m.insert("monitoring".into(), p.monitoring.into());
    m.insert("version".into(), p.version.into());
    for (k, v) in [
        ("aufnahme", &p.aufnahme),
        ("sensor", &p.sensor),
        ("geliefert", &p.geliefert),
    ] {
        if let Some(v) = v {
            m.insert(k.into(), v.clone().into());
        }
    }
    m
}

/// Features einer Ebene der Quelle → einheitliche Features der Fachebene. Ohne Geometrie fällt
/// ein Feature weg; ohne `features`-Liste ist das Ergebnis leer.
pub(crate) fn normalize_ebene(
    fc: &Value,
    art: EbenenArt,
    d: &Details,
    g: &Gebiet,
    p: &Produkt,
) -> Vec<Value> {
    let basis = herkunft_props(d, g, p);
    fc.get("features")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|f| {
            let geometrie = f.get("geometry").filter(|g| g.is_object())?;
            let roh = f.get("properties").cloned().unwrap_or(Value::Null);
            let mut props = basis.clone();
            props.insert("art".into(), art.wire_value().into());
            props.insert("klasse".into(), klasse_of(Some(art), &roh).into());
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
        Some(p) => herkunft_props(d, g, p),
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
    props.insert("klasse".into(), klasse_of(None, &Value::Null).into());
    props.insert("unvollstaendig".into(), unvollstaendig.into());
    props.insert("gekuerzt".into(), gekuerzt.into());
    serde_json::json!({ "type": "Feature", "geometry": g.umriss, "properties": props })
}

/// Liste der öffentlichen Aktivierungen (ab EMSR656, März 2023).
pub(crate) const LISTE_URL: &str =
    "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=500";

/// Details einer Aktivierung; die EMSR-Nummer wird angehängt. Ein Pfad des Dashboard-Backends ohne
/// Stabilitätszusage: bricht er, ist die Ebene `offline`.
pub(crate) const DETAIL_URL: &str =
    "https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=";

/// Höchstzahl der Ebenen-Dateien je Antwort; darüber trägt das Gebiet `gekuerzt`.
pub(crate) const MAX_EBENEN: usize = 40;

/// Grenzen einer Antwort, in Tests kleiner.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Grenzen {
    pub ebenen: usize,
    pub bytes: usize,
}

impl Grenzen {
    pub(crate) const STANDARD: Grenzen = Grenzen {
        ebenen: MAX_EBENEN,
        bytes: MAX_ANTWORT_BYTES,
    };
}

/// Ergebnis von [`build_antwort`]: `vollstaendig` ist falsch, wenn eine Aktivierung ohne Details
/// blieb oder eine Ebene fehlt. Dann wird die Antwort ausgeliefert, aber nicht gespeichert: der
/// nächste Abruf versucht es erneut, statt 30 min eine Lücke ohne Marke zu zeigen.
pub(crate) struct Gebaut {
    pub antwort: FachebeneAntwort,
    pub vollstaendig: bool,
}

/// Baut die Antwort für einen Ausschnitt. `fetch` lädt eine URL als JSON (im Betrieb
/// `quellen::hole_json`, in Tests ein Stub). `None`, wenn die Liste fehlt oder keine einzige
/// Aktivierung ihre Details liefert: dann ist die Ebene `offline`.
pub(crate) async fn build_antwort<H, Fut>(
    pool: &SqlitePool,
    fetch: H,
    bbox: Bbox,
    archiv: bool,
    jetzt: NaiveDateTime,
    grenzen: Grenzen,
) -> Option<Gebaut>
where
    H: Fn(String) -> Fut + Send + Sync,
    Fut: Future<Output = Result<Value, String>> + Send,
{
    let liste_roh = load_teilstand(
        pool,
        "copernicus-teil:liste",
        COPERNICUS_TTL,
        &fetch,
        LISTE_URL,
        |v| parse_liste(v).is_some(),
    )
    .await?;
    let liste = parse_liste(&liste_roh)?;
    let kandidaten = select_kandidaten(&liste, &bbox, jetzt, archiv);

    let fetch = &fetch;
    // Eigene Werte statt Referenzen in den Futures: sonst verlangt `Send` für den gespawnten
    // Abruf eine Lebensdauer, die der Compiler nicht beweisen kann.
    let auftraege: Vec<(String, Duration)> = kandidaten
        .iter()
        .map(|a| {
            let ttl = if a.abgeschlossen {
                COPERNICUS_TTL_ABGESCHLOSSEN
            } else {
                COPERNICUS_TTL
            };
            (a.code.clone(), ttl)
        })
        .collect();
    let geladen: Vec<Option<Details>> = stream::iter(auftraege)
        .map(|(code, ttl)| async move {
            let schluessel = format!("copernicus-teil:akt:{code}");
            let url = format!("{DETAIL_URL}{code}");
            // Nur Details zur erfragten Aktivierung taugen; eine fremde Antwort läge sonst
            // unter dem falschen Schlüssel.
            let is_valid_detail = |v: &Value| parse_details(v).is_some_and(|d| d.code == code);
            load_teilstand(pool, &schluessel, ttl, fetch, &url, is_valid_detail)
                .await
                .as_ref()
                .and_then(parse_details)
                .filter(|d| d.code == code)
        })
        .buffered(PARALLEL)
        .collect()
        .await;
    let details: Vec<Details> = geladen.into_iter().flatten().collect();
    // Keine einzige Aktivierung lieferte Details: die Quelle ist gestört, nicht leer.
    if !kandidaten.is_empty() && details.is_empty() {
        return None;
    }
    let mut vollstaendig = details.len() == kandidaten.len();

    // Gebiete im Ausschnitt mit ihren gewählten Produkten, und die Ebenen, die zu holen sind.
    struct Treffer {
        details: usize,
        gebiet: usize,
        gewaehlt: Vec<Produkt>,
        gekuerzt: bool,
        unvollstaendig: bool,
    }
    let mut treffer: Vec<Treffer> = Vec::new();
    let mut auftraege: Vec<(usize, Produkt, EbenenArt, String)> = Vec::new();
    for (di, d) in details.iter().enumerate().filter(|(_, d)| !d.sensibel) {
        for (gi, g) in d.gebiete.iter().enumerate() {
            if !intersects(&g.huelle, &bbox) {
                continue;
            }
            let gewaehlt: Vec<Produkt> = select_produkte(g).into_iter().cloned().collect();
            let mut gekuerzt = false;
            for p in &gewaehlt {
                for (art, url) in &p.ebenen {
                    if auftraege.len() < grenzen.ebenen {
                        auftraege.push((treffer.len(), p.clone(), *art, url.clone()));
                    } else {
                        gekuerzt = true;
                    }
                }
            }
            treffer.push(Treffer {
                details: di,
                gebiet: gi,
                gewaehlt,
                gekuerzt,
                unvollstaendig: false,
            });
        }
    }

    let geholt: Vec<_> = stream::iter(auftraege)
        .map(|(ti, p, art, url)| async move {
            let schluessel = format!("copernicus-teil:ebene:{url}");
            let roh = load_teilstand(pool, &schluessel, COPERNICUS_EBENE_TTL, fetch, &url, |v| {
                v.get("features").is_some_and(Value::is_array)
            })
            .await;
            (ti, p, art, roh)
        })
        .buffered(PARALLEL)
        .collect()
        .await;

    let mut features = Vec::new();
    let mut bytes = 0usize;
    for (ti, p, art, roh) in &geholt {
        let t = &treffer[*ti];
        let d = &details[t.details];
        let Some(fc) = roh else {
            treffer[*ti].unvollstaendig = true;
            vollstaendig = false;
            continue;
        };
        let neu = normalize_ebene(fc, *art, d, &d.gebiete[t.gebiet], p);
        let groesse: usize = neu
            .iter()
            .map(|f| serde_json::to_vec(f).map_or(0, |b| b.len()))
            .sum();
        if bytes + groesse > grenzen.bytes {
            treffer[*ti].gekuerzt = true;
            continue;
        }
        bytes += groesse;
        features.extend(neu);
    }

    // Umrisse zuerst; die Reihenfolge im Array ist für die Karte belanglos, im Inspector stehen
    // die Gebiete so vorn.
    let mut alle = Vec::with_capacity(treffer.len() + features.len());
    let mut stand: Option<String> = None;
    for t in &treffer {
        let d = &details[t.details];
        let gewaehlt: Vec<&Produkt> = t.gewaehlt.iter().collect();
        alle.push(gebiet_feature(
            d,
            &d.gebiete[t.gebiet],
            &gewaehlt,
            t.unvollstaendig,
            t.gekuerzt,
        ));
        for p in &t.gewaehlt {
            if p.aufnahme > stand {
                stand = p.aufnahme.clone();
            }
        }
    }
    alle.extend(features);
    Some(Gebaut {
        antwort: FachebeneAntwort::ok(
            "copernicus",
            COPERNICUS_ATTRIB,
            stand,
            serde_json::json!({ "type": "FeatureCollection", "features": alle }),
        ),
        vollstaendig,
    })
}

/// Ein Teilstand (Liste, Details oder Ebene): frisch aus dem Cache, sonst holen und, wenn `is_valid`,
/// speichern. Scheitert der Abruf oder is_valid die Antwort nicht, gilt der alte Stand, solange der
/// Cache ihn hält (48 h). Eine untaugliche Antwort wird nie gespeichert, sonst überschriebe ein
/// Formatbruch einen brauchbaren Stand.
async fn load_teilstand<H, Fut>(
    pool: &SqlitePool,
    schluessel: &str,
    ttl: Duration,
    fetch: &H,
    url: &str,
    is_valid: impl Fn(&Value) -> bool,
) -> Option<Value>
where
    H: Fn(String) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let alt: Option<(Value, i64)> = cache::eintrag_wert(pool, schluessel).await;
    if let Some((v, alter)) = &alt {
        if *alter < ttl.as_secs() as i64 {
            return Some(v.clone());
        }
    }
    match fetch(url.to_string()).await {
        Ok(v) if is_valid(&v) => {
            cache::setze_wert(pool, schluessel, &v).await;
            Some(v)
        }
        Ok(_) => {
            tracing::warn!("Copernicus: unbrauchbare Antwort von {url}, alter Stand bleibt");
            alt.map(|(v, _)| v)
        }
        Err(e) => {
            tracing::warn!("Copernicus: Abruf {url} fehlgeschlagen: {e}");
            alt.map(|(v, _)| v)
        }
    }
}

/// Ist der Ausschnitt klein genug? Geprüft wie bei Energie, mit eigener Grenze.
pub(crate) fn check_bbox(bbox: &Bbox) -> Result<(), String> {
    if bbox.ost - bbox.west > COPERNICUS_MAX_SPANNE_GRAD
        || bbox.nord - bbox.sued > COPERNICUS_MAX_SPANNE_GRAD
    {
        return Err("bbox zu groß — weiter hineinzoomen".to_string());
    }
    Ok(())
}

/// `GET /api/karte/fachebenen/copernicus?bbox=…[&archiv=1]`. Kalt wartet die Anfrage höchstens
/// [`COPERNICUS_WARTE`] und antwortet sonst `offline`; der Abruf läuft weiter und füllt den
/// Cache für den nächsten Poll (Aufwärmtakt im Frontend). Eine unvollständige Antwort geht hinaus,
/// wird aber nicht gespeichert.
pub async fn fetch_copernicus(
    s: &FachebenenState,
    pool: &SqlitePool,
    bbox_roh: &str,
    archiv: bool,
) -> Result<FachebeneAntwort, AppError> {
    let bbox = Bbox::parse(bbox_roh).map_err(AppError::Validation)?;
    check_bbox(&bbox).map_err(AppError::Validation)?;
    let key = bbox.cache_key_mit(if archiv {
        "copernicus-archiv"
    } else {
        "copernicus"
    });
    let (client, p, k) = (s.client.clone(), pool.clone(), key.clone());
    let antwort = quellen::liefere_geloest(
        pool,
        &s.inflight,
        &key,
        COPERNICUS_TTL,
        tokio::time::Instant::now() + COPERNICUS_WARTE,
        move || async move {
            let fetch = move |url: String| {
                let c = client.clone();
                async move { quellen::hole_json(&c, &url).await }
            };
            let jetzt = chrono::Utc::now().naive_utc();
            let gebaut = build_antwort(&p, fetch, bbox, archiv, jetzt, Grenzen::STANDARD).await?;
            if gebaut.vollstaendig {
                cache::setze(&p, &k, &gebaut.antwort).await;
            }
            Some(gebaut.antwort)
        },
    )
    .await;
    Ok(antwort.unwrap_or_else(|| FachebeneAntwort::offline("copernicus", COPERNICUS_ATTRIB)))
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
        let liste = parse_liste(&serde_json::from_str(LISTE).unwrap()).unwrap();
        let emsr728 = liste.iter().find(|a| a.code == "EMSR728").unwrap();
        assert_eq!(emsr728.mittelpunkt, Some((10.890198, 48.973487)));
        assert!(emsr728.abgeschlossen);
        assert_eq!(emsr728.produkte, 37);
        assert_eq!(emsr728.letzte_aenderung, Some(t("2024-09-04 15:58:13")));
    }

    #[test]
    fn liste_ohne_ergebnisse_ist_formatbruch() {
        assert_eq!(parse_liste(&json!({ "detail": "nope" })), None);
    }

    #[test]
    fn liest_wkt() {
        assert_eq!(parse_wkt_punkt("POINT (7.5 50.25)"), Some((7.5, 50.25)));
        assert_eq!(parse_wkt_punkt("POLYGON ((1 2, 3 4))"), None);
        let g = parse_wkt_geometrie("POLYGON ((1 2, 3 2, 3 5, 1 2))").unwrap();
        assert_eq!(g["type"], "Polygon");
        assert_eq!(
            g["coordinates"],
            json!([[[1.0, 2.0], [3.0, 2.0], [3.0, 5.0], [1.0, 2.0]]])
        );
        let h = bounding_box(&g).unwrap();
        assert_eq!((h.west, h.sued, h.ost, h.nord), (1.0, 2.0, 3.0, 5.0));
        let m = parse_wkt_geometrie("MULTIPOLYGON (((1 2, 3 2, 1 2)), ((5 6, 7 6, 5 6)))").unwrap();
        assert_eq!(m["type"], "MultiPolygon");
        assert_eq!(bounding_box(&m).unwrap().ost, 7.0);
        assert_eq!(parse_wkt_geometrie("POLYGON ((1 2, 3"), None);
        assert_eq!(parse_wkt_geometrie("LINESTRING (1 2, 3 4)"), None);
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
            codes(select_kandidaten(&liste, &stuttgart(), jetzt, false)),
            ["LAEUFT", "JUNG"]
        );
        assert_eq!(
            codes(select_kandidaten(&liste, &stuttgart(), jetzt, true)),
            ["ALT", "LAEUFT", "JUNG", "ZU_ALT"]
        );
    }

    #[test]
    fn genau_dreissig_tage_gelten_noch() {
        let jetzt = t("2026-11-21 12:00:00");
        let liste = vec![akt("GRENZE", 9.5, 48.8, "2026-10-22 12:00:00", true, 1)];
        assert_eq!(
            select_kandidaten(&liste, &stuttgart(), jetzt, false).len(),
            1
        );
    }

    #[test]
    fn erkennt_die_ebenenart_am_namen() {
        let n = |s: &str| {
            parse_ebenen_art(&format!(
                "EMSR728/AOI01/DEL_PRODUCT/EMSR728_AOI01_DEL_PRODUCT_{s}_v2_VT"
            ))
        };
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
        let tiefe = |v: &str| klasse_of(Some(Wassertiefe), &json!({ "value": v }));
        assert_eq!(tiefe("Below 0.50"), "tiefe_gering");
        assert_eq!(tiefe("0.50 - 1.00"), "tiefe_mittel");
        assert_eq!(tiefe("1.00 - 2.00"), "tiefe_hoch");
        assert_eq!(tiefe("Above 2.00"), "tiefe_hoch");
        assert_eq!(tiefe("?"), "unbekannt");
        let schaden = |d: &str| klasse_of(Some(SchadenVerkehr), &json!({ "damage_gra": d }));
        assert_eq!(schaden("Destroyed"), "zerstoert");
        assert_eq!(schaden("Damaged"), "beschaedigt");
        assert_eq!(schaden("Possibly damaged"), "schaden_moeglich");
        assert_eq!(schaden("No visible damage"), "kein_schaden");
        assert_eq!(schaden("966"), "unbekannt");
        assert_eq!(klasse_of(Some(SchadenGebaeude), &json!({})), "unbekannt");
        assert_eq!(klasse_of(Some(Beobachtet), &json!({})), "beobachtet");
        assert_eq!(klasse_of(Some(MaxAusdehnung), &json!({})), "max_ausdehnung");
        assert_eq!(
            klasse_of(Some(NichtAusgewertet), &json!({})),
            "nicht_ausgewertet"
        );
        assert_eq!(klasse_of(None, &json!({})), "gebiet");
    }

    const EMSR728: &str = include_str!("testdaten/copernicus-emsr728.json");
    const EBENE_TIEFE: &str = include_str!("testdaten/copernicus-ebene-tiefe.json");
    const EBENE_VERKEHR: &str = include_str!("testdaten/copernicus-ebene-verkehr.json");

    fn emsr728() -> Details {
        parse_details(&serde_json::from_str(EMSR728).unwrap()).unwrap()
    }

    #[test]
    fn liest_die_details() {
        let d = emsr728();
        assert_eq!(
            (d.code.as_str(), d.name.as_str()),
            ("EMSR728", "Flood in Germany")
        );
        assert_eq!(d.kategorie, "Flood");
        assert!(!d.sensibel);
        assert_eq!(d.gebiete.len(), 2);
        let g1 = &d.gebiete[0];
        assert_eq!((g1.nummer, g1.name.as_str()), (1, "Stuttgart"));
        assert_eq!(g1.umriss["type"], "Polygon");
        assert!(
            g1.huelle.west < 9.0 && g1.huelle.ost > 9.5,
            "{:?}",
            g1.huelle
        );
        let erst = g1
            .produkte
            .iter()
            .find(|p| p.typ == "DEL" && p.monitoring == 0)
            .unwrap();
        assert_eq!(erst.version, 2);
        assert!(erst.fertig);
        assert_eq!(erst.aufnahme.as_deref(), Some("2024-06-01 05:43:00"));
        // Version 2 wurde am 04.06. neu geliefert, nach den Aufnahmen vom 01.06.
        assert_eq!(
            erst.geliefert.as_deref().map(|s| &s[..10]),
            Some("2024-06-04")
        );
        let arten: Vec<_> = erst.ebenen.iter().map(|(a, _)| *a).collect();
        assert_eq!(arten, [EbenenArt::Wassertiefe, EbenenArt::Beobachtet]);
        assert!(erst.ebenen[0]
            .1
            .starts_with("https://rapidmapping-viewer.s3."));
        assert!(erst.ebenen[0].1.ends_with("_floodDepthA_v2.json"));
    }

    #[test]
    fn details_ohne_ergebnis_sind_formatbruch() {
        assert_eq!(parse_details(&json!({ "count": 0, "results": [] })), None);
        assert_eq!(
            parse_details(&json!({ "detail": "Authentication credentials were not provided." })),
            None
        );
    }

    #[test]
    fn rechtecke_schneiden_sich() {
        let a = Bbox::parse("0,0,2,2").unwrap();
        assert!(intersects(&a, &Bbox::parse("1,1,3,3").unwrap()));
        assert!(
            intersects(&a, &Bbox::parse("2,2,3,3").unwrap()),
            "Berührung zählt"
        );
        assert!(!intersects(&a, &Bbox::parse("2.1,0,3,2").unwrap()));
        assert!(!intersects(&a, &Bbox::parse("0,2.1,2,3").unwrap()));
    }

    #[test]
    fn waehlt_je_art_den_juengsten_fertigen_stand() {
        let d = emsr728();
        // Gebiet 1: DEL v2 (Erstprodukt), MONIT01..02 fertig, MONIT03/04 nicht fertig und ohne
        // Ebenen → MONIT02.
        let g1: Vec<_> = select_produkte(&d.gebiete[0])
            .iter()
            .map(|p| (p.typ.clone(), p.monitoring))
            .collect();
        assert_eq!(g1, [("DEL".to_string(), 2)]);
        let g9: Vec<_> = select_produkte(&d.gebiete[1])
            .iter()
            .map(|p| p.typ.clone())
            .collect();
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
            ebenen: vec![(
                EbenenArt::Beobachtet,
                format!("{typ}{monitoring}v{version}"),
            )],
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
        let w: Vec<_> = select_produkte(&g)
            .iter()
            .map(|p| (p.typ.clone(), p.version))
            .collect();
        assert_eq!(w, [("DEL".to_string(), 3)]);
        g.produkte = vec![produkt("FEP", 0, 1, true), produkt("GRA", 0, 1, true)];
        let w: Vec<_> = select_produkte(&g).iter().map(|p| p.typ.clone()).collect();
        assert_eq!(w, ["FEP", "GRA"]);
        // Ohne Ebenen zählt ein Produkt nicht.
        let mut leer = produkt("DEL", 5, 1, true);
        leer.ebenen.clear();
        g.produkte = vec![produkt("FEP", 0, 1, true), leer];
        let w: Vec<_> = select_produkte(&g).iter().map(|p| p.typ.clone()).collect();
        assert_eq!(w, ["FEP"]);
    }

    #[test]
    fn normalisiert_eine_ebene() {
        let d = emsr728();
        let g = &d.gebiete[0];
        let p = select_produkte(g)[0];
        let fc: Value = serde_json::from_str(EBENE_TIEFE).unwrap();
        let f = normalize_ebene(&fc, EbenenArt::Wassertiefe, &d, g, p);
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
        let f = normalize_ebene(
            &fc,
            EbenenArt::SchadenVerkehr,
            &d,
            g9,
            select_produkte(g9)[0],
        );
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
        assert_eq!(
            normalize_ebene(&fc, EbenenArt::Beobachtet, &d, g, &g.produkte[0]).len(),
            1
        );
        assert!(normalize_ebene(
            &json!({ "x": 1 }),
            EbenenArt::Beobachtet,
            &d,
            g,
            &g.produkte[0]
        )
        .is_empty());
    }

    /// Abnahme (LLH-1200): Die Überflutungsflächen von EMSR728 liegen lagerichtig im Umriss von
    /// Gebiet 1 (Stuttgart), in lon/lat-Reihenfolge, nicht vertauscht.
    #[test]
    fn ueberflutungsflaechen_liegen_lagerichtig() {
        let d = emsr728();
        let g = &d.gebiete[0];
        let fc: Value = serde_json::from_str(EBENE_TIEFE).unwrap();
        let f = normalize_ebene(&fc, EbenenArt::Wassertiefe, &d, g, select_produkte(g)[0]);
        assert!(!f.is_empty());
        for feature in &f {
            let h = bounding_box(&feature["geometry"]).unwrap();
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
        let gewaehlt = select_produkte(g);
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

    // ------------------------------------------------------------------ Abruf (Stufe 3)

    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    /// Stub für `fetch`: bekannte URLs aus den Testdaten, Ebenen nach ihrer Art, alles andere
    /// scheitert. Zählt jeden Abruf.
    #[derive(Clone, Default)]
    struct Quelle {
        aufrufe: Arc<Mutex<Vec<String>>>,
        fehlt: Arc<Mutex<Vec<String>>>,
        ersetzt: Arc<Mutex<HashMap<String, Value>>>,
    }

    impl Quelle {
        fn fetch(
            &self,
        ) -> impl Fn(String) -> std::future::Ready<Result<Value, String>> + Send + Sync {
            let q = self.clone();
            move |url: String| {
                q.aufrufe.lock().unwrap().push(url.clone());
                let antwort = if q
                    .fehlt
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|f| url.contains(f.as_str()))
                {
                    Err("HTTP 503".to_string())
                } else if let Some(v) = q.ersetzt.lock().unwrap().get(&url) {
                    Ok(v.clone())
                } else if url == LISTE_URL {
                    Ok(serde_json::from_str(LISTE).unwrap())
                } else if url == format!("{DETAIL_URL}EMSR728") {
                    Ok(serde_json::from_str(EMSR728).unwrap())
                } else if url.ends_with(".json") && url.contains("floodDepth") {
                    Ok(serde_json::from_str(EBENE_TIEFE).unwrap())
                } else if url.ends_with(".json") && url.contains("transportation") {
                    Ok(serde_json::from_str(EBENE_VERKEHR).unwrap())
                } else if url.ends_with(".json") {
                    Ok(json!({ "type": "FeatureCollection", "features": [
                        { "type": "Feature", "properties": { "notation": "Flooded area" },
                          "geometry": { "type": "Polygon", "coordinates": [[[9.2, 48.8], [9.21, 48.8], [9.21, 48.81], [9.2, 48.8]]] } }
                    ]}))
                } else {
                    Err("HTTP 404".to_string())
                };
                std::future::ready(antwort)
            }
        }
        fn count(&self, teil: &str) -> usize {
            self.aufrufe
                .lock()
                .unwrap()
                .iter()
                .filter(|u| u.contains(teil))
                .count()
        }
    }

    fn heute() -> NaiveDateTime {
        t("2026-11-21 12:00:00")
    }

    #[tokio::test]
    async fn zeigt_emsr728_im_archiv_ueber_stuttgart() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        let a = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap()
        .antwort;
        assert_eq!(a.quelle, "copernicus");
        assert_eq!(a.status, crate::karte::typen::FachebeneStatus::Ok);
        assert_eq!(a.attribution, COPERNICUS_ATTRIB);
        // Nur Gebiet 1 (Stuttgart) schneidet den Ausschnitt, gezeigt wird MONIT02.
        assert_eq!(a.stand.as_deref(), Some("2024-06-03 17:16:00"));
        let f = a.features["features"].as_array().unwrap();
        let gebiete: Vec<_> = f
            .iter()
            .filter(|f| f["properties"]["art"] == "gebiet")
            .collect();
        assert_eq!(gebiete.len(), 1);
        assert_eq!(gebiete[0]["properties"]["gebiet"], "Stuttgart");
        assert_eq!(gebiete[0]["properties"]["unvollstaendig"], false);
        assert!(f.iter().any(|f| f["properties"]["klasse"] == "tiefe_hoch"));
        assert!(f.iter().any(|f| f["properties"]["art"] == "max_ausdehnung"));
        // Gebiet 9 (Bogen) liegt außerhalb: keine Schadensebene geholt.
        assert_eq!(q.count("transportation"), 0);
        // EMSR920 ist Kandidat (Archiv, 290 km), seine Details fehlen im Stub: kein Abbruch.
        assert_eq!(q.count("code=EMSR920"), 1);
    }

    #[tokio::test]
    async fn ohne_archiv_ist_die_ebene_leer_ohne_detailabruf() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        let a = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            false,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap()
        .antwort;
        assert_eq!(a.status, crate::karte::typen::FachebeneStatus::Leer);
        assert_eq!(q.count("code="), 0);
    }

    #[tokio::test]
    async fn ohne_liste_offline() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        q.fehlt
            .lock()
            .unwrap()
            .push("public-activations-info".into());
        assert!(build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD
        )
        .await
        .is_none());
    }

    #[tokio::test]
    async fn ohne_jede_details_offline() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        q.fehlt.lock().unwrap().push("code=".into());
        assert!(build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD
        )
        .await
        .is_none());
    }

    #[tokio::test]
    async fn fehlende_ebene_macht_das_gebiet_unvollstaendig() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        q.fehlt.lock().unwrap().push("floodDepth".into());
        let a = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap()
        .antwort;
        let f = a.features["features"].as_array().unwrap();
        let gebiet = f
            .iter()
            .find(|f| f["properties"]["art"] == "gebiet")
            .unwrap();
        assert_eq!(gebiet["properties"]["unvollstaendig"], true);
        assert!(!f.iter().any(|f| f["properties"]["art"] == "wassertiefe"));
        assert!(f.iter().any(|f| f["properties"]["art"] == "beobachtet"));
    }

    #[tokio::test]
    async fn obergrenze_kuerzt_und_markiert() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        let a = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen {
                ebenen: 1,
                ..Grenzen::STANDARD
            },
        )
        .await
        .unwrap()
        .antwort;
        let f = a.features["features"].as_array().unwrap();
        let gebiet = f
            .iter()
            .find(|f| f["properties"]["art"] == "gebiet")
            .unwrap();
        assert_eq!(gebiet["properties"]["gekuerzt"], true);
        assert_eq!(q.count(".json"), 1);
    }

    #[tokio::test]
    async fn teilstaende_kommen_aus_dem_cache() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap();
        let ebenen = q.count(".json");
        build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap();
        assert_eq!(q.count(LISTE_URL), 1, "Liste frisch im Cache");
        assert_eq!(q.count("code=EMSR728"), 1, "Details frisch im Cache");
        assert_eq!(q.count(".json"), ebenen, "Ebenen frisch im Cache");
    }

    #[tokio::test]
    async fn scheitert_der_abruf_gilt_der_alte_teilstand() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap();
        // Alle Teilstände altern über jede TTL, dann fällt die Quelle aus.
        sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = gespeichert_at - 90000")
            .execute(&pool)
            .await
            .unwrap();
        q.fehlt.lock().unwrap().push("https://".into());
        let a = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap()
        .antwort;
        assert_eq!(a.status, crate::karte::typen::FachebeneStatus::Ok);
    }

    #[tokio::test]
    async fn sensible_aktivierung_bleibt_draussen() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        let mut d: Value = serde_json::from_str(EMSR728).unwrap();
        d["results"][0]["sensitive"] = json!(true);
        q.ersetzt
            .lock()
            .unwrap()
            .insert(format!("{DETAIL_URL}EMSR728"), d);
        let a = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap()
        .antwort;
        assert_eq!(a.status, crate::karte::typen::FachebeneStatus::Leer);
    }

    #[tokio::test]
    async fn kaputte_details_werden_nicht_gespeichert() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        q.ersetzt
            .lock()
            .unwrap()
            .insert(format!("{DETAIL_URL}EMSR728"), json!({ "detail": "nope" }));
        let _ = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await;
        let gespeichert: Option<(Value, i64)> =
            crate::karte::cache::eintrag_wert(&pool, "copernicus-teil:akt:EMSR728").await;
        assert!(gespeichert.is_none());
    }

    #[test]
    fn tiefes_wkt_endet_ohne_absturz() {
        // 100 000 `(` passen weit unter den Deckel von 16 MiB; ohne Grenze vor dem Abstieg liefe
        // der Stack des Workers über.
        let tief = format!("MULTIPOLYGON {}", "(".repeat(100_000));
        assert_eq!(parse_wkt_geometrie(&tief), None);
        assert_eq!(parse_wkt_geometrie("POLYGON ((((1 2, 3 4))))"), None);
        assert!(parse_wkt_geometrie("MULTIPOLYGON (((1 2, 3 2, 1 2)))").is_some());
    }

    #[test]
    fn ebenen_nur_vom_bekannten_host() {
        let mut v: Value = serde_json::from_str(EMSR728).unwrap();
        let ebene = &mut v["results"][0]["aois"][0]["products"][0]["layers"][0];
        ebene["json"] =
            json!("https://beispiel.invalid/EMSR728_AOI01_DEL_PRODUCT_floodDepthA_v2.json");
        let d = parse_details(&v).unwrap();
        let erst = d.gebiete[0]
            .produkte
            .iter()
            .find(|p| p.typ == "DEL" && p.monitoring == 0)
            .unwrap();
        let arten: Vec<_> = erst.ebenen.iter().map(|(a, _)| *a).collect();
        assert_eq!(arten, [EbenenArt::Beobachtet]);
    }

    #[test]
    fn zeitpunkt_mit_z_gilt() {
        assert_eq!(
            format_zeitpunkt("2024-06-01T05:06:00Z").as_deref(),
            Some("2024-06-01 05:06:00")
        );
    }

    #[tokio::test]
    async fn teilausfall_ist_nicht_vollstaendig() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        // Ohne Archiv: nur EMSR728 wäre Kandidat, wenn es laufend wäre. Mit Archiv fehlen die
        // Details von EMSR920 im Stub.
        let mit_luecke = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap();
        assert!(!mit_luecke.vollstaendig);
        let ohne = build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            false,
            heute(),
            Grenzen::STANDARD,
        )
        .await
        .unwrap();
        assert!(ohne.vollstaendig);
    }

    #[tokio::test]
    async fn bytebudget_kuerzt_und_markiert() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        let grenzen = Grenzen {
            bytes: 1,
            ..Grenzen::STANDARD
        };
        let a = build_antwort(&pool, q.fetch(), stuttgart(), true, heute(), grenzen)
            .await
            .unwrap()
            .antwort;
        let f = a.features["features"].as_array().unwrap();
        assert!(f.iter().all(|f| f["properties"]["art"] == "gebiet"));
        assert_eq!(f[0]["properties"]["gekuerzt"], true);
    }

    #[tokio::test]
    async fn fremde_details_werden_nicht_genommen() {
        let pool = crate::db::test_pool().await;
        let q = Quelle::default();
        let mut fremd: Value = serde_json::from_str(EMSR728).unwrap();
        fremd["results"][0]["code"] = json!("EMSR999");
        q.ersetzt
            .lock()
            .unwrap()
            .insert(format!("{DETAIL_URL}EMSR728"), fremd);
        // Weder EMSR728 (fremde Antwort) noch EMSR920 (fehlt) liefern Details: offline.
        assert!(build_antwort(
            &pool,
            q.fetch(),
            stuttgart(),
            true,
            heute(),
            Grenzen::STANDARD
        )
        .await
        .is_none());
    }

    #[test]
    fn zeitpunkte_im_wire_format() {
        assert_eq!(
            format_zeitpunkt("2024-06-01T05:06:00").as_deref(),
            Some("2024-06-01 05:06:00")
        );
        assert_eq!(
            format_zeitpunkt("2024-09-04T15:58:13.172773").as_deref(),
            Some("2024-09-04 15:58:13")
        );
        assert_eq!(format_zeitpunkt("gestern"), None);
    }
}
