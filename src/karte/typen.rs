//! Antwort-Umschlag des Fachebenen-Aggregators und Hilfsbuilder.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use utoipa::ToSchema;

// Kontrakt-Typen des karten-service aus dem geteilten Crate `karten-katalog`, re-exportiert
// für die ToSchema-Registrierung in `src/api_doc.rs` und die typisierte Deserialisierung im
// Proxy. `JobStatus` bleibt unregistriert: datentragend (`Failed(String)`) und in `BuildJob`
// inline (`#[schema(inline)]`), so braucht es keinen `enum_wire_kontrakt`-Pin.
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
    /// Datenstand der QUELLE, wo sie einen liefert (KRITIS: Extrakt, Energie: MaStR-Abzug,
    /// Luftqualität: jüngster Messzeitpunkt). Nicht der Abruf — der steht in `abgerufen`.
    pub stand: Option<String>,
    /// Zeitpunkt (RFC 3339, UTC), zu dem das System den ausgelieferten Stand bei der Quelle
    /// geholt hat (LFH-591). Reist im Cache-JSON mit, ein veralteter Stand behält also seinen
    /// Abrufzeitpunkt. Fehlt bei `offline`; Einträge von davor füllt `karte::cache` nach.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abgerufen: Option<String>,
    /// GeoJSON FeatureCollection. Laufzeittyp bleibt `Value` (die Normalisierer bauen sie per
    /// `json!`); `GeoJsonFeatureCollection` ist der Schema-Anker (LFH-265), belegt durch die
    /// `from_value`-Tests in `karte::normalisierung`.
    #[schema(value_type = GeoJsonFeatureCollection)]
    pub features: Value,
}

/// Zeitpunkt als RFC 3339 in UTC auf Sekunden — die Form von `FachebeneAntwort.abgerufen`.
pub fn zeitpunkt_utc(t: chrono::DateTime<chrono::Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Leere FeatureCollection.
pub fn leere_collection() -> Value {
    json!({ "type": "FeatureCollection", "features": [] })
}

impl FachebeneAntwort {
    /// Erfolg mit Features. `status` wird automatisch `leer`, wenn 0 Features. `abgerufen` ist
    /// jetzt: jede Quelle baut ihre Antwort direkt nach dem Abruf über diesen Konstruktor.
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
            abgerufen: Some(zeitpunkt_utc(chrono::Utc::now())),
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
            abgerufen: None,
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
    /// Cache-Schlüssel der KRITIS-Ebene, byte-gleich `kritis:<bbox>` — ein anderer Schlüssel ließe
    /// den Bestand seinen Cache verlieren.
    pub fn cache_key(&self) -> String {
        self.cache_key_mit("kritis")
    }
    /// Cache-Schlüssel `<praefix>:<bbox>`, auf 2 Nachkommastellen (≈1 km) gerundet gegen
    /// Cache-Streuung.
    pub fn cache_key_mit(&self, praefix: &str) -> String {
        format!(
            "{praefix}:{:.2},{:.2},{:.2},{:.2}",
            self.west, self.sued, self.ost, self.nord
        )
    }
    /// Um `meter` in jede Richtung erweiterter Ausschnitt, auf den gültigen Bereich begrenzt. Die
    /// Breite rechnet mit dem Erdradius von [`haversine_m`], damit Rand und Abstandsmessung
    /// dieselbe Erde meinen. Die Länge teilt durch den Kosinus der POLNÄHEREN Kante, damit der Rand
    /// nirgends zu schmal ist. Direkt konstruiert statt über [`Bbox::parse`].
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
    /// Ein Rand von 2 km: Breite ~0,018°, Länge bei 51,6° N ~0,029° (eher etwas mehr als nötig).
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
        // Ein 1°-Ausschnitt darf wachsen.
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
    /// Der Extrakt-Bestand beantwortet jede Ausschnittgröße.
    #[test]
    fn akzeptiert_ganz_deutschland_und_die_welt() {
        assert!(Bbox::parse("5.0,47.0,15.0,55.0").is_ok());
        assert!(Bbox::parse("-180,-90,180,90").is_ok());
    }
    /// Der KRITIS-Schlüssel bleibt byte-gleich; geprüft gegen ein handgeschriebenes Literal, nicht
    /// gegen `cache_key_mit("kritis")`.
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
        // Genau 1.0 Grad je Richtung → Ok.
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

    /// LFH-591: ein Stand mit Daten nennt, wann er bei der Quelle geholt wurde.
    #[test]
    fn ok_traegt_den_abrufzeitpunkt() {
        let vorher = chrono::Utc::now().timestamp();
        let a = FachebeneAntwort::ok("dwd", "X", None, leere_collection());
        let abgerufen = a.abgerufen.expect("abgerufen gesetzt");
        let t = chrono::DateTime::parse_from_rfc3339(&abgerufen).expect("RFC 3339");
        assert!(abgerufen.ends_with('Z'), "UTC: {abgerufen}");
        assert!(
            (vorher - 1..=vorher + 5).contains(&t.timestamp()),
            "{abgerufen}"
        );
    }

    /// LFH-591, LFH-265: `offline` hat keinen Stand, das Feld fehlt statt `null` zu sein.
    #[test]
    fn offline_ohne_abrufzeitpunkt_auf_dem_draht() {
        let a = FachebeneAntwort::offline("nina", "BBK");
        assert_eq!(a.abgerufen, None);
        let v = serde_json::to_value(&a).unwrap();
        assert!(!v.as_object().unwrap().contains_key("abgerufen"), "{v}");
    }

    /// Einträge von vor LFH-591 tragen das Feld nicht und müssen lesbar bleiben.
    #[test]
    fn umschlag_ohne_abrufzeitpunkt_ist_lesbar() {
        let a: FachebeneAntwort = serde_json::from_value(json!({
            "quelle": "dwd", "status": "ok", "attribution": "X",
            "features": leere_collection()
        }))
        .unwrap();
        assert_eq!(a.abgerufen, None);
    }

    #[test]
    fn status_serialisiert_lowercase() {
        assert_eq!(
            serde_json::to_string(&FachebeneStatus::Offline).unwrap(),
            "\"offline\""
        );
    }
}
