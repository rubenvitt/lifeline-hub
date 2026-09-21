//! Liest die KRITIS-Objekte aus einer `.osm.pbf`-Datei.
//!
//! OSM speichert Koordinaten nur an Nodes. Damit auch Flächenobjekte (ein Klinikgelände als
//! Way, eine Schule als Multipolygon-Relation) einen Punkt bekommen, läuft der Leser in bis
//! zu drei Durchläufen über die Datei:
//!
//! 1. getaggte Nodes → direkt ein Objekt; getaggte Ways → Node-Referenzen merken; getaggte
//!    Relations → Member merken (Ways und Nodes).
//! 2. nur falls Relations Ways referenzieren: deren Node-Referenzen merken.
//! 3. Koordinaten aller gemerkten Node-IDs einsammeln.
//!
//! Punkt eines Ways/einer Relation ist die **Mitte der Bounding-Box** seiner Nodes — das,
//! was Overpass mit `out center` lieferte. Die Punkte liegen damit dort, wo sie vor LFH-83
//! lagen. Verschachtelte Relations (Relation als Member) werden nicht aufgelöst.
//!
//! Synchron und CPU-lastig: der Aufrufer läuft in `spawn_blocking`. Die Durchläufe selbst
//! verteilen sich über `par_map_reduce` auf alle Kerne.

use crate::karte::normalisierung::{ist_kritis_tag, kritis_properties};
use osmpbf::{Element, ElementReader, RelMemberType};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Ein KRITIS-Objekt als Punkt, bereit für den Bestand.
#[derive(Debug, Clone, PartialEq)]
pub struct KritisObjekt {
    /// `node`, `way` oder `relation` — zusammen mit `osm_id` eindeutig.
    pub osm_typ: &'static str,
    pub osm_id: i64,
    pub lon: f64,
    pub lat: f64,
    /// Kategorie-Wort (`krankenhaus`, `pflege`, …); steckt auch in `properties`.
    pub kategorie: String,
    /// Flache Feature-Properties aus [`kritis_properties`].
    pub properties: Value,
}

/// Ein getaggtes Flächenobjekt, dessen Punkt erst nach Durchlauf 3 feststeht.
struct Offen {
    osm_typ: &'static str,
    osm_id: i64,
    properties: Value,
    nodes: Vec<i64>,
    ways: Vec<i64>,
}

#[derive(Default)]
struct Durchlauf1 {
    fertig: Vec<KritisObjekt>,
    offen: Vec<Offen>,
}

impl Durchlauf1 {
    fn vereine(mut self, mut b: Durchlauf1) -> Durchlauf1 {
        self.fertig.append(&mut b.fertig);
        self.offen.append(&mut b.offen);
        self
    }
}

/// Properties aus einem Tag-Iterator — `None`, wenn kein KRITIS-Tag dabei ist. Der billige
/// Vorfilter läuft zuerst, damit für die übergroße Mehrheit der Objekte keine Map entsteht.
fn properties_aus<'a>(tags: impl Iterator<Item = (&'a str, &'a str)> + Clone) -> Option<Value> {
    if !tags.clone().any(|(k, v)| ist_kritis_tag(k, v)) {
        return None;
    }
    let map: HashMap<&str, &str> = tags.collect();
    kritis_properties(|k| map.get(k).copied())
}

fn kategorie(p: &Value) -> String {
    p["kategorie"].as_str().unwrap_or("kritis").to_string()
}

fn punkt(osm_typ: &'static str, osm_id: i64, lon: f64, lat: f64, p: Value) -> KritisObjekt {
    KritisObjekt {
        osm_typ,
        osm_id,
        lon,
        lat,
        kategorie: kategorie(&p),
        properties: p,
    }
}

/// Liest alle KRITIS-Objekte aus `pfad`, sortiert nach (`osm_typ`, `osm_id`).
pub fn lies_extrakt(pfad: &Path) -> Result<Vec<KritisObjekt>, osmpbf::Error> {
    // ---- Durchlauf 1
    let d1 = ElementReader::from_path(pfad)?.par_map_reduce(
        |el| {
            let mut d = Durchlauf1::default();
            match el {
                Element::Node(n) => {
                    if let Some(p) = properties_aus(n.tags()) {
                        d.fertig.push(punkt("node", n.id(), n.lon(), n.lat(), p));
                    }
                }
                Element::DenseNode(n) => {
                    if let Some(p) = properties_aus(n.tags()) {
                        d.fertig.push(punkt("node", n.id(), n.lon(), n.lat(), p));
                    }
                }
                Element::Way(w) => {
                    if let Some(p) = properties_aus(w.tags()) {
                        d.offen.push(Offen {
                            osm_typ: "way",
                            osm_id: w.id(),
                            properties: p,
                            nodes: w.refs().collect(),
                            ways: Vec::new(),
                        });
                    }
                }
                Element::Relation(r) => {
                    if let Some(p) = properties_aus(r.tags()) {
                        let mut o = Offen {
                            osm_typ: "relation",
                            osm_id: r.id(),
                            properties: p,
                            nodes: Vec::new(),
                            ways: Vec::new(),
                        };
                        for m in r.members() {
                            match m.member_type {
                                RelMemberType::Node => o.nodes.push(m.member_id),
                                RelMemberType::Way => o.ways.push(m.member_id),
                                RelMemberType::Relation => {}
                            }
                        }
                        d.offen.push(o);
                    }
                }
            }
            d
        },
        Durchlauf1::default,
        Durchlauf1::vereine,
    )?;
    let Durchlauf1 { mut fertig, offen } = d1;

    // ---- Durchlauf 2: Node-Referenzen der Ways, die Relations als Member nennen.
    let gesuchte_ways: HashSet<i64> = offen.iter().flat_map(|o| o.ways.iter().copied()).collect();
    let way_nodes: HashMap<i64, Vec<i64>> = if gesuchte_ways.is_empty() {
        HashMap::new()
    } else {
        ElementReader::from_path(pfad)?.par_map_reduce(
            |el| match el {
                Element::Way(w) if gesuchte_ways.contains(&w.id()) => {
                    HashMap::from([(w.id(), w.refs().collect::<Vec<_>>())])
                }
                _ => HashMap::new(),
            },
            HashMap::new,
            |mut a, b| {
                a.extend(b);
                a
            },
        )?
    };

    // ---- Durchlauf 3: Koordinaten aller gebrauchten Nodes.
    let knoten_von = |o: &Offen| -> Vec<i64> {
        let mut v = o.nodes.clone();
        for w in &o.ways {
            if let Some(n) = way_nodes.get(w) {
                v.extend_from_slice(n);
            }
        }
        v
    };
    let gesuchte_nodes: HashSet<i64> = offen.iter().flat_map(knoten_von).collect();
    let koordinaten: HashMap<i64, (f64, f64)> = if gesuchte_nodes.is_empty() {
        HashMap::new()
    } else {
        ElementReader::from_path(pfad)?.par_map_reduce(
            |el| {
                let (id, lon, lat) = match el {
                    Element::Node(n) => (n.id(), n.lon(), n.lat()),
                    Element::DenseNode(n) => (n.id(), n.lon(), n.lat()),
                    _ => return HashMap::new(),
                };
                if gesuchte_nodes.contains(&id) {
                    HashMap::from([(id, (lon, lat))])
                } else {
                    HashMap::new()
                }
            },
            HashMap::new,
            |mut a, b| {
                a.extend(b);
                a
            },
        )?
    };

    for o in &offen {
        let mut bbox: Option<(f64, f64, f64, f64)> = None;
        for id in knoten_von(o) {
            if let Some(&(lon, lat)) = koordinaten.get(&id) {
                bbox = Some(match bbox {
                    None => (lon, lat, lon, lat),
                    Some((w, s, e, n)) => (w.min(lon), s.min(lat), e.max(lon), n.max(lat)),
                });
            }
        }
        // Ohne eine einzige auflösbare Koordinate (Extrakt-Rand, kaputte Referenz) gibt es
        // keinen Punkt — lieber weglassen als bei 0/0 im Golf von Guinea zeichnen.
        if let Some((w, s, e, n)) = bbox {
            fertig.push(punkt(
                o.osm_typ,
                o.osm_id,
                (w + e) / 2.0,
                (s + n) / 2.0,
                o.properties.clone(),
            ));
        }
    }

    fertig.sort_by(|a, b| (a.osm_typ, a.osm_id).cmp(&(b.osm_typ, b.osm_id)));
    Ok(fertig)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<KritisObjekt> {
        let pfad = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/kritis/mini.osm.pbf");
        lies_extrakt(&pfad).expect("Fixture lesbar")
    }

    fn nahe(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    /// Node, Way und Relation werden Objekte; fremd getaggte und ungetaggte nicht.
    #[test]
    fn liest_node_way_und_relation() {
        let o = fixture();
        let ids: Vec<(&str, i64)> = o.iter().map(|o| (o.osm_typ, o.osm_id)).collect();
        assert_eq!(ids, vec![("node", 1), ("relation", 1000), ("way", 100)]);
    }

    #[test]
    fn node_behaelt_koordinate_und_properties() {
        let o = fixture();
        let k = o.iter().find(|o| o.osm_typ == "node").unwrap();
        assert!(nahe(k.lon, 6.95) && nahe(k.lat, 50.94));
        assert_eq!(k.kategorie, "krankenhaus");
        assert_eq!(k.properties["titel"], "Uniklinik");
        assert_eq!(k.properties["adresse"], "Kerpener Str. 62, 50937 Köln");
        assert_eq!(k.properties["notaufnahme"], "ja");
    }

    /// Way-Punkt = Mitte der Bounding-Box (wie Overpass `out center`), nicht Mittel der Nodes
    /// — der geschlossene Ring wiederholt den ersten Node, ein Mittelwert läge daneben.
    #[test]
    fn way_punkt_ist_bbox_mitte() {
        let o = fixture();
        let w = o.iter().find(|o| o.osm_typ == "way").unwrap();
        assert!(nahe(w.lon, 7.1) && nahe(w.lat, 51.2), "{} {}", w.lon, w.lat);
        assert_eq!(w.kategorie, "strom");
        assert_eq!(w.properties["titel"], "Umspannwerk");
    }

    #[test]
    fn relation_punkt_ueber_member_way() {
        let o = fixture();
        let r = o.iter().find(|o| o.osm_typ == "relation").unwrap();
        assert!(nahe(r.lon, 8.2) && nahe(r.lat, 52.1), "{} {}", r.lon, r.lat);
        assert_eq!(r.kategorie, "schule");
        assert_eq!(r.properties["titel"], "Gesamtschule");
    }

    #[test]
    fn fehlende_datei_ist_fehler() {
        assert!(lies_extrakt(Path::new("/gibt/es/nicht.osm.pbf")).is_err());
    }
}
