//! Antwort-Umschlag des Fachebenen-Aggregators und Hilfsbuilder.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::ToSchema;

// LFH-323: Cross-Service-Kontrakt-Typen des karten-service (aus dem geteilten Crate
// `karten-katalog`). Hier re-exportiert, damit `src/api_doc.rs` sie mit ToSchema registriert und
// der Proxy in `routes/karte.rs` sie typisiert deserialisiert — statt roh als `serde_json::Value`.
// `JobStatus` bleibt bewusst UNregistriert: es ist datentragend (`Failed(String)`) und in
// `BuildJob` inline (`#[schema(inline)]`), damit weder ein `enum_wire_kontrakt`-Pin nötig noch der
// Inventar-Guard verletzt ist (siehe `karten-katalog`).
pub use karten_katalog::{BuildJob, RegionDto};

/// Status einer Fachebenen-Antwort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum FachebeneStatus {
    /// Daten vorhanden (frisch oder aus gültigem Cache).
    Ok,
    /// Quelle erreichbar, aber keine Features.
    Leer,
    /// Quelle/Netz nicht erreichbar; Ebene wird ausgegraut.
    Offline,
}

/// Geometrie eines GeoJSON-Features. Bewusst FLACH gehalten (LFH-265): `typ` bleibt `String`
/// statt Literal-Enum (spart zwei weitere ToSchema-Enums samt Wire-Pins und bricht keinen
/// Konsumenten), `coordinates` bleibt `Value` (Punkt/Linie/Polygon haben unterschiedliche Tiefe).
/// Zweck ist Nicht-Regression: ohne diesen Anker generiert utoipa für `FachebeneAntwort.features`
/// ein typloses Schema (`unknown` im Frontend).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GeoJsonGeometrie {
    #[serde(rename = "type")]
    pub typ: String,
    pub coordinates: Value,
}

/// Ein GeoJSON-Feature. `geometry` ist optional (NINA liefert Einträge ohne Geometrie),
/// `properties` sind flache Skalar-Properties (MapLibre stringifiziert Verschachteltes).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GeoJsonFeature {
    #[serde(rename = "type")]
    pub typ: String,
    pub geometry: Option<GeoJsonGeometrie>,
    pub properties: std::collections::HashMap<String, Value>,
}

/// Eine GeoJSON-FeatureCollection — der Schema-Anker für `FachebeneAntwort.features`.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct GeoJsonFeatureCollection {
    #[serde(rename = "type")]
    pub typ: String,
    pub features: Vec<GeoJsonFeature>,
}

/// Einheitlicher Umschlag für jede Fachebene.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct FachebeneAntwort {
    pub quelle: String,
    pub status: FachebeneStatus,
    pub attribution: String,
    pub stand: Option<String>,
    /// GeoJSON FeatureCollection. Laufzeittyp bleibt `Value` (die Normalisierer bauen sie per
    /// `json!`); `GeoJsonFeatureCollection` ist der Schema-Anker (LFH-265), belegt durch die
    /// `from_value`-Tests in `karte::normalisierung`.
    #[schema(value_type = GeoJsonFeatureCollection)]
    pub features: Value,
}

/// Leere FeatureCollection.
pub fn leere_collection() -> Value {
    json!({ "type": "FeatureCollection", "features": [] })
}

impl FachebeneAntwort {
    /// Erfolg mit Features. `status` wird automatisch `leer`, wenn 0 Features.
    pub fn ok(quelle: &str, attribution: &str, stand: Option<String>, features: Value) -> Self {
        let leer = features
            .get("features")
            .and_then(|f| f.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);
        FachebeneAntwort {
            quelle: quelle.to_string(),
            status: if leer {
                FachebeneStatus::Leer
            } else {
                FachebeneStatus::Ok
            },
            attribution: attribution.to_string(),
            stand,
            features,
        }
    }

    /// Quelle nicht erreichbar → leer + Offline-Status (HTTP bleibt 200).
    pub fn offline(quelle: &str, attribution: &str) -> Self {
        FachebeneAntwort {
            quelle: quelle.to_string(),
            status: FachebeneStatus::Offline,
            attribution: attribution.to_string(),
            stand: None,
            features: leere_collection(),
        }
    }
}

/// Bounding-Box in WGS84, Reihenfolge wie vom Frontend: west,sued,ost,nord.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bbox {
    pub west: f64,
    pub sued: f64,
    pub ost: f64,
    pub nord: f64,
}

impl Bbox {
    /// Parst "west,sued,ost,nord". Fehler → Err(Meldung).
    pub fn parse(s: &str) -> Result<Bbox, String> {
        let teile: Vec<f64> = s
            .split(',')
            .map(|t| t.trim().parse::<f64>())
            .collect::<Result<_, _>>()
            .map_err(|_| "bbox muss vier Zahlen sein".to_string())?;
        match teile.as_slice() {
            [west, sued, ost, nord] if west < ost && sued < nord => {
                if *sued < -90.0 || *nord > 90.0 || *west < -180.0 || *ost > 180.0 {
                    return Err("bbox-Koordinaten außerhalb des gültigen Bereichs".to_string());
                }
                Ok(Bbox {
                    west: *west,
                    sued: *sued,
                    ost: *ost,
                    nord: *nord,
                })
            }
            _ => Err("bbox ungültig (west,sued,ost,nord)".to_string()),
        }
    }
    /// Overpass erwartet sued,west,nord,ost.
    pub fn overpass(&self) -> String {
        format!("{},{},{},{}", self.sued, self.west, self.nord, self.ost)
    }
    /// Cache-Schlüssel der KRITIS-Ebene. Bleibt byte-gleich zum Stand vor LFH-81
    /// (`kritis:<bbox>`) — ein anderer Schlüssel ließe den Bestand seinen Cache verlieren.
    pub fn cache_key(&self) -> String {
        self.cache_key_mit("kritis")
    }
    /// Cache-Schlüssel `<praefix>:<bbox>`, auf 2 Nachkommastellen gerundet (≈1 km); das
    /// reduziert die Cache-Streuung. Das Präfix trennt die bbox-Ebenen voneinander.
    pub fn cache_key_mit(&self, praefix: &str) -> String {
        format!(
            "{praefix}:{:.2},{:.2},{:.2},{:.2}",
            self.west, self.sued, self.ost, self.nord
        )
    }
    /// Um `meter` in jede Richtung erweiterter Ausschnitt, auf den gültigen Bereich
    /// begrenzt. Die Breite rechnet mit dem Erdradius von [`haversine_m`], damit Rand und
    /// Abstandsmessung dieselbe Erde meinen. Die Länge teilt durch den Kosinus der
    /// POLNÄHEREN Kante: dort ist ein Längengrad am kürzesten, der Rand also nirgends zu
    /// schmal. Konstruiert direkt statt über [`Bbox::parse`], weil ein 1°-Ausschnitt mit
    /// Rand die 1°-Grenze überschreiten darf.
    ///
    /// [`haversine_m`]: crate::geocoding::peilung::haversine_m
    pub fn erweitert_um_m(&self, meter: f64) -> Bbox {
        let m_je_grad = crate::geocoding::peilung::ERDRADIUS_M.to_radians();
        let dlat = meter / m_je_grad;
        let sued = (self.sued - dlat).max(-90.0);
        let nord = (self.nord + dlat).min(90.0);
        let dlon = dlat / sued.abs().max(nord.abs()).to_radians().cos();
        Bbox {
            west: (self.west - dlon).max(-180.0),
            sued,
            ost: (self.ost + dlon).min(180.0),
            nord,
        }
    }
    /// Liegt der Punkt (Rand eingeschlossen) im Ausschnitt?
    pub fn enthaelt(&self, lon: f64, lat: f64) -> bool {
        lon >= self.west && lon <= self.ost && lat >= self.sued && lat <= self.nord
    }
}

#[cfg(test)]
mod bbox_tests {
    use super::*;
    #[test]
    fn parst_gueltige_bbox() {
        let b = Bbox::parse("6.0,50.0,7.0,51.0").unwrap();
        assert_eq!((b.west, b.sued, b.ost, b.nord), (6.0, 50.0, 7.0, 51.0));
    }
    /// Ein Rand von 2 km: in der Breite überall ~0,018°, in der Länge bei 51,6° N ~0,029°
    /// (Kosinus der POLNÄHEREN Kante, also eher etwas mehr als nötig).
    #[test]
    fn erweitert_um_meter_mit_breitenkorrektur() {
        let b = Bbox::parse("6.9,51.45,7.3,51.65").unwrap();
        let e = b.erweitert_um_m(2000.0);
        let dlat = 2000.0 / 111_194.93;
        assert!((b.sued - e.sued - dlat).abs() < 1e-4, "{e:?}");
        assert!((e.nord - b.nord - dlat).abs() < 1e-4, "{e:?}");
        let dlon = dlat / (51.65_f64 + dlat).to_radians().cos();
        assert!((b.west - e.west - dlon).abs() < 1e-4, "{e:?}");
        assert!((e.ost - b.ost - dlon).abs() < 1e-4, "{e:?}");
        // Ein 1°-Ausschnitt darf wachsen — `parse` hätte ihn als „zu groß" abgelehnt.
        let voll = Bbox::parse("6.0,51.0,7.0,52.0")
            .unwrap()
            .erweitert_um_m(6000.0);
        assert!(voll.ost - voll.west > 1.0);
    }
    #[test]
    fn erweitert_bleibt_im_gueltigen_bereich() {
        let b = Bbox::parse("179.5,89.5,180.0,90.0")
            .unwrap()
            .erweitert_um_m(6000.0);
        assert!(b.nord <= 90.0 && b.ost <= 180.0, "{b:?}");
        let b = Bbox::parse("-180.0,-90.0,-179.5,-89.5")
            .unwrap()
            .erweitert_um_m(6000.0);
        assert!(b.sued >= -90.0 && b.west >= -180.0, "{b:?}");
    }
    #[test]
    fn lehnt_vertauschte_grenzen_ab() {
        assert!(Bbox::parse("7.0,50.0,6.0,51.0").is_err());
    }
    #[test]
    fn lehnt_unvollstaendig_ab() {
        assert!(Bbox::parse("1,2,3").is_err());
    }
    #[test]
    fn lehnt_koordinaten_ausserhalb_range_ab() {
        // Lon > 180
        assert!(Bbox::parse("185.0,50.0,186.0,51.0").is_err());
        // Lat > 90
        assert!(Bbox::parse("6.0,91.0,7.0,92.0").is_err());
        // Lat < -90
        assert!(Bbox::parse("6.0,-91.0,7.0,-89.0").is_err());
        // Lon < -180
        assert!(Bbox::parse("-181.0,50.0,-179.0,51.0").is_err());
    }
    /// Bis LFH-83 war alles über 1° × 1° ein Fehler („weiter hineinzoomen"), weil jede bbox
    /// eine Overpass-Anfrage auslöste. Der Extrakt-Bestand beantwortet jede Größe.
    #[test]
    fn akzeptiert_ganz_deutschland_und_die_welt() {
        assert!(Bbox::parse("5.0,47.0,15.0,55.0").is_ok());
        assert!(Bbox::parse("-180,-90,180,90").is_ok());
    }
    /// LFH-81: das Präfix wird Parameter, der KRITIS-Schlüssel bleibt Byte für Byte, was er
    /// war. Geprüft gegen ein handgeschriebenes Literal — ein Vergleich gegen
    /// `cache_key_mit("kritis")` prüfte die Funktion gegen sich selbst.
    #[test]
    fn cache_schluessel_mit_praefix_und_kritis_byte_gleich() {
        let b = Bbox::parse("6.9,51.45,7.3,51.65").unwrap();
        assert_eq!(b.cache_key(), "kritis:6.90,51.45,7.30,51.65");
        assert_eq!(
            b.cache_key_mit("energie:osm"),
            "energie:osm:6.90,51.45,7.30,51.65"
        );
    }
    #[test]
    fn enthaelt_prueft_mit_rand() {
        let b = Bbox::parse("6.0,50.0,7.0,51.0").unwrap();
        assert!(b.enthaelt(6.5, 50.5));
        assert!(b.enthaelt(6.0, 51.0)); // Rand zählt dazu
        assert!(!b.enthaelt(7.01, 50.5));
        assert!(!b.enthaelt(6.5, 49.99));
    }
    #[test]
    fn akzeptiert_bbox_mit_genau_einem_grad_spanne() {
        // Genau 1.0 Grad in jeder Richtung (nicht > 1.0) → Ok
        let b = Bbox::parse("6.0,50.0,7.0,51.0").unwrap();
        assert_eq!(b.west, 6.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_mit_features_ist_ok() {
        let fc = json!({ "type": "FeatureCollection", "features": [ { "type": "Feature" } ] });
        let a = FachebeneAntwort::ok("dwd", "X", None, fc);
        assert_eq!(a.status, FachebeneStatus::Ok);
    }

    #[test]
    fn ok_ohne_features_ist_leer() {
        let a = FachebeneAntwort::ok("dwd", "X", None, leere_collection());
        assert_eq!(a.status, FachebeneStatus::Leer);
    }

    #[test]
    fn offline_hat_leere_collection() {
        let a = FachebeneAntwort::offline("nina", "BBK");
        assert_eq!(a.status, FachebeneStatus::Offline);
        assert_eq!(a.features["features"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn status_serialisiert_lowercase() {
        assert_eq!(
            serde_json::to_string(&FachebeneStatus::Offline).unwrap(),
            "\"offline\""
        );
    }
}
