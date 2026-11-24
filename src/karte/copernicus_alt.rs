//! Copernicus-Aktivierungen vor 2023 (LLH-2022): kuratierter Katalog und Vector Packages.
//!
//! Die Liste und die Detail-Schnittstelle des Dashboards beginnen bei EMSR656 (März 2023). Für
//! ältere Lagen wie das Ahrtal (EMSR517) führt `copernicus_altbestand.json` die Gebiete und
//! Produkte mit der Adresse ihres Vector Package; die Ebenen liest [`read_vector_package`] aus
//! dem ZIP. Nur mit „Ältere Aktivierungen“ (`archiv`).
//!
//! Herleitung: `docs/superpowers/specs/2026-11-24-pjfe442j-copernicus-aeltere-aktivierungen-design.md`,
//! ADR-0098. Pflege eines Eintrags: `docs/fachebenen-quellen.md`, Abschnitt „Copernicus EMS“.

use crate::karte::copernicus::{
    format_zeitpunkt, parse_ebenen_art, Details, EbenenArt, Gebiet, Produkt,
};
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

/// Höchstzahl der Einträge im Verzeichnis eines Vector Package (EMSR517: höchstens 92).
pub(crate) const PAKET_MAX_EINTRAEGE: usize = 200;

/// Höchstens so viele Bytes entpackt je gebrauchtem Eintrag (EMSR517: höchstens 6,5 MB).
pub(crate) const PAKET_EINTRAG_MAX: usize = 16 * 1024 * 1024;

/// Höchstens so viele Bytes entpackt für alle gebrauchten Einträge zusammen (EMSR517:
/// höchstens 9,8 MB). Der Rest des ZIPs (Shapefiles, KMZ, Stile) wird nie entpackt.
pub(crate) const PAKET_ENTPACKT_MAX: usize = 32 * 1024 * 1024;

/// Properties, die `normalize_ebene` und `klasse_of` lesen; alles andere fällt vor dem
/// Speichern weg.
const BEHALTENE_FELDER: [&str; 5] = ["value", "damage_gra", "obj_desc", "info", "notation"];

/// Was ein Eintrag des ZIPs ist: Gebietsumriss, eine bekannte Ebene oder nichts davon.
enum Eintrag {
    Umriss,
    Ebene(EbenenArt),
}

fn classify_eintrag(name: &str) -> Option<Eintrag> {
    // Nur Dateien im Wurzelverzeichnis; `/` und `\` schließen auch `..` aus.
    if name.contains(['/', '\\']) || !name.ends_with(".json") {
        return None;
    }
    if name.contains("_areaOfInterestA_") {
        return Some(Eintrag::Umriss);
    }
    parse_ebenen_art(name).map(Eintrag::Ebene)
}

/// Liest ein Vector Package: `{"umriss": <Geometrie|null>, "ebenen": [{"art", "fc"}]}`.
/// Gelesen werden nur die JSON-Dateien des Gebietsumrisses und der bekannten Ebenenarten, mit
/// ZIP-Bombenschutz wie `pruefe_entpackt` in `src/abloesung/schichtplan/uebernahme/datei.rs`:
/// erst die angegebenen Größen, dann beim Lesen die echten (die Angabe kann lügen).
pub(crate) fn read_vector_package(bytes: &[u8]) -> Result<Value, String> {
    use std::io::Read;
    let mut archiv =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("kein ZIP: {e}"))?;
    if archiv.len() > PAKET_MAX_EINTRAEGE {
        return Err(format!("ZIP mit {} Einträgen", archiv.len()));
    }
    let mut gebraucht = Vec::new();
    let mut angegeben: u64 = 0;
    for i in 0..archiv.len() {
        let teil = archiv.by_index_raw(i).map_err(|e| e.to_string())?;
        let name = teil.name().map_err(|e| e.to_string())?;
        if let Some(art) = classify_eintrag(&name) {
            angegeben = angegeben.saturating_add(teil.size());
            gebraucht.push((i, art));
        }
    }
    if angegeben > PAKET_ENTPACKT_MAX as u64 {
        return Err("ZIP ist entpackt zu groß".into());
    }
    let mut umriss = Value::Null;
    let mut ebenen: Vec<(EbenenArt, Vec<Value>)> = Vec::new();
    let mut gelesen = 0usize;
    for (i, art) in gebraucht {
        let teil = archiv.by_index(i).map_err(|e| e.to_string())?;
        let mut roh = Vec::new();
        teil.take(PAKET_EINTRAG_MAX as u64 + 1)
            .read_to_end(&mut roh)
            .map_err(|e| e.to_string())?;
        gelesen += roh.len();
        if roh.len() > PAKET_EINTRAG_MAX || gelesen > PAKET_ENTPACKT_MAX {
            return Err("ZIP ist entpackt zu groß".into());
        }
        let fc: Value = serde_json::from_slice(&roh).map_err(|e| e.to_string())?;
        let features = fc.get("features").and_then(Value::as_array);
        match art {
            Eintrag::Umriss => {
                if let Some(g) = features
                    .and_then(|f| f.first())
                    .and_then(|f| f.get("geometry"))
                    .filter(|g| g.is_object())
                {
                    umriss = g.clone();
                }
            }
            Eintrag::Ebene(a) => {
                let schlank = features.into_iter().flatten().map(slim_feature);
                match ebenen.iter_mut().find(|(b, _)| *b == a) {
                    Some((_, liste)) => liste.extend(schlank),
                    None => ebenen.push((a, schlank.collect())),
                }
            }
        }
    }
    let ebenen: Vec<Value> = ebenen
        .into_iter()
        .map(|(a, features)| {
            serde_json::json!({
                "art": a.wire_value(),
                "fc": { "type": "FeatureCollection", "features": features },
            })
        })
        .collect();
    Ok(serde_json::json!({ "umriss": umriss, "ebenen": ebenen }))
}

/// Feature nur mit Geometrie und den Feldern aus [`BEHALTENE_FELDER`]: der Teilstand im Cache
/// bleibt so ein Bruchteil des ZIPs.
fn slim_feature(f: &Value) -> Value {
    let props: serde_json::Map<String, Value> = BEHALTENE_FELDER
        .iter()
        .filter_map(|k| Some((k.to_string(), f.get("properties")?.get(*k)?.clone())))
        .collect();
    serde_json::json!({
        "type": "Feature",
        "geometry": f.get("geometry").cloned().unwrap_or(Value::Null),
        "properties": props,
    })
}

/// Download-Deckel eines Vector Package (EMSR517: größtes ZIP 36,6 MB, AOI05 Bonn).
pub(crate) const DECKEL_PAKET: usize = 48 * 1024 * 1024;

/// Zeitgrenze eines Paket-Abrufs; über dem globalen Takt der Fachebenen, weil ein ZIP groß
/// ist. Der kalte Abruf läuft ohnehin von der Anfrage gelöst weiter.
const PAKET_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Liegt die Adresse unter [`PAKET_BASIS`]? Gilt vor dem Abruf und für die Adresse nach
/// Weiterleitungen.
pub(crate) fn is_paket_url(url: &str) -> bool {
    url.starts_with(PAKET_BASIS)
}

/// Holt ein Vector Package und liest es mit [`read_vector_package`] (in `spawn_blocking`).
pub(crate) async fn fetch_paket(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    if !is_paket_url(url) {
        return Err(format!("Adresse außerhalb des Altbestands: {url}"));
    }
    let resp = client
        .get(url)
        .timeout(PAKET_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !is_paket_url(resp.url().as_str()) {
        return Err(format!(
            "Weiterleitung auf eine fremde Adresse: {}",
            resp.url()
        ));
    }
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = crate::http_begrenzt::lies_begrenzt(resp, DECKEL_PAKET)
        .await
        .map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || read_vector_package(&bytes))
        .await
        .map_err(|e| e.to_string())?
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

    // ------------------------------------------------------------------ Vector Package

    const AHRTAL_ZIP: &[u8] = include_bytes!("testdaten/copernicus-emsr517-aoi15.zip");

    fn zip_mit(eintraege: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opt = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, inhalt) in eintraege {
            w.start_file(*name, opt).unwrap();
            w.write_all(inhalt).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn liest_das_ahrtal_paket() {
        let v = read_vector_package(AHRTAL_ZIP).unwrap();
        assert_eq!(v["umriss"]["type"], "Polygon");
        let mut arten: Vec<&str> = v["ebenen"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["art"].as_str().unwrap())
            .collect();
        arten.sort();
        assert_eq!(arten, ["beobachtet", "schaden_gebaeude", "schaden_verkehr"]);
        let gebaeude = v["ebenen"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["art"] == "schaden_gebaeude")
            .unwrap();
        let f = &gebaeude["fc"]["features"][0];
        assert_eq!(f["geometry"]["type"], "Point");
        assert!(f["properties"]["damage_gra"].is_string());
        assert!(f["properties"].get("or_src_id").is_none());
    }

    #[test]
    fn lehnt_ein_paket_mit_zu_grossem_eintrag_ab() {
        let mut gross = b"{\"type\":\"FeatureCollection\",\"features\":[]}".to_vec();
        gross.resize(PAKET_EINTRAG_MAX + 1, b' ');
        let zip = zip_mit(&[("X_observedEventA_r1_v1.json", &gross)]);
        assert!(read_vector_package(&zip).is_err());
    }

    #[test]
    fn lehnt_ein_paket_mit_luegender_groesse_ab() {
        // Das Verzeichnis meldet 10 Byte; entpackt sind es 17 MiB.
        let mut gross = b"{\"type\":\"FeatureCollection\",\"features\":[]}".to_vec();
        gross.resize(PAKET_EINTRAG_MAX + 1, b' ');
        let mut zip = zip_mit(&[("X_observedEventA_r1_v1.json", &gross)]);
        let echt = (gross.len() as u32).to_le_bytes();
        let falsch = 10u32.to_le_bytes();
        // Größe im lokalen Kopf (Offset 22) und im zentralen Verzeichnis (Offset 24) fälschen.
        for i in 0..zip.len().saturating_sub(4) {
            if zip[i..i + 4] == echt {
                zip[i..i + 4].copy_from_slice(&falsch);
            }
        }
        assert!(read_vector_package(&zip).is_err());
    }

    #[test]
    fn lehnt_zu_viele_eintraege_ab() {
        let namen: Vec<String> = (0..=PAKET_MAX_EINTRAEGE)
            .map(|i| format!("{i}.txt"))
            .collect();
        let eintraege: Vec<(&str, &[u8])> = namen.iter().map(|n| (n.as_str(), &b""[..])).collect();
        assert!(read_vector_package(&zip_mit(&eintraege)).is_err());
    }

    #[test]
    fn ignoriert_eintraege_in_unterordnern() {
        let fc = br#"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[7.1,50.5]}}]}"#;
        let zip = zip_mit(&[
            ("sub/X_observedEventA_r1_v1.json", fc),
            ("../X_builtUpP_r1_v1.json", fc),
        ]);
        let v = read_vector_package(&zip).unwrap();
        assert_eq!(v["ebenen"], json!([]));
        assert_eq!(v["umriss"], Value::Null);
    }

    #[test]
    fn kaputtes_zip_ist_ein_fehler() {
        assert!(read_vector_package(b"kein zip").is_err());
    }
}
