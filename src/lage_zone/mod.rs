pub mod repo;

use crate::routes::support::parse_enum;
use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

wire_enum! {
    /// Zonen-Typ (Schema-Anker für die OpenAPI-Union, LFH-120; TS: `ZoneTyp`). Wire == `typ`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum LageZoneTyp {
        Gefahrengebiet => "gefahrengebiet",
        Absperrbereich => "absperrbereich",
        Absperrgrenze => "absperrgrenze",
        Sperrgebiet => "sperrgebiet",
        FreieSkizze => "freie_skizze",
        /// Fläche eines Evakuierungsbezirks (LFH-673). Nur Polygon; optional einem Bezirk des
        /// Fachmoduls Betreuung zugeordnet (`evakuierungsbezirk_id`, n : 1).
        Evakuierungsbezirk => "evakuierungsbezirk",
    }
    try_from = |s| format!("Ungültiger LageZoneTyp: {s}");
}
impl LageZoneTyp {
    /// Ob die Zone eine Gefahr oder Sperre markiert (Gefahrengebiet, Absperrung, Sperrgebiet).
    /// Nur diese sieht ein Abschnittsgerät (LFH-1043, design.md D4); Evakuierungsbezirke und
    /// freie Skizzen nicht.
    pub fn ist_gefahrenzone(self) -> bool {
        matches!(
            self,
            LageZoneTyp::Gefahrengebiet
                | LageZoneTyp::Absperrbereich
                | LageZoneTyp::Absperrgrenze
                | LageZoneTyp::Sperrgebiet
        )
    }
}

wire_enum! {
    #[wire(ohne_serde)]
    /// Geometrie-Typ (GeoJSON-Geometry-`type`) — Validierungs-Enum für den Request-Guard.
    /// Bewusst OHNE Serialize/ToSchema: das DTO-Feld `geometrie_typ` bleibt `String` (kein
    /// OpenAPI-Anker → Typisierung wäre kein Codegen-No-Op).
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum GeometrieTyp {
        Polygon => "Polygon",
        LineString => "LineString",
    }
}
impl GeometrieTyp {}

/// Eine freie Lage-Zone (Gefahren-/Absperrzone). Eigenständige Entität — kein Fachobjekt.
// Kein `Eq`: die Kreisangaben sind Gleitkommazahlen (LLH-1043).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct LageZoneAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub typ: LageZoneTyp,
    pub geometrie_typ: String,
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
    pub gefahrengebiet_id: Option<i64>,
    /// Ansichts-Zugehörigkeit (LFH-320): `None` = auf allen Ansichten sichtbar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ansicht_id: Option<i64>,
    /// Zugeordneter Evakuierungsbezirk (LFH-673), nur an Zonen vom Typ `evakuierungsbezirk`.
    /// NUR die Kennung: Bezeichnung und Räumungszustand hängen am Modul Betreuung und kommen
    /// aus dessen Übersicht — die Zonenliste liest jeder Karten-Leser.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evakuierungsbezirk_id: Option<i64>,
    /// Kreis um einen Punkt (LLH-1043): Mitte (WGS84) und Radius in Metern. Alle drei gesetzt =
    /// die Geometrie ist die Kreisnäherung des Servers (64 Ecken); alle drei fehlen =
    /// freie Fläche oder Linie. Eine punktweise Bearbeitung der Geometrie entfernt sie.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kreis_mitte_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kreis_mitte_lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kreis_radius_m: Option<f64>,
    pub erstellt_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}

/// Sprechendes Typ-Label für den ETB-Wortlaut.
pub fn typ_label(typ: &str) -> &'static str {
    match typ {
        "gefahrengebiet" => "Gefahrengebiet",
        "absperrbereich" => "Absperrbereich",
        "absperrgrenze" => "Absperrgrenze",
        "sperrgebiet" => "Sperrgebiet",
        "freie_skizze" => "Freie Skizze",
        "evakuierungsbezirk" => "Evakuierungsbezirk",
        _ => "Zone",
    }
}

/// Ob `typ` zur Geometrieklasse `geometrie_typ` passt (Typ-Katalog der Spec).
/// Von POST (typ vs. übergebenem geometrie_typ) und PATCH (neuer typ vs. *gespeichertem*
/// geometrie_typ — Geometrie ist nicht änderbar) gemeinsam erzwungen.
pub fn geometrie_klasse_passt(typ: &str, geometrie_typ: &str) -> bool {
    match geometrie_typ {
        "Polygon" => matches!(
            typ,
            "gefahrengebiet"
                | "absperrbereich"
                | "sperrgebiet"
                | "freie_skizze"
                | "evakuierungsbezirk"
        ),
        "LineString" => matches!(typ, "absperrgrenze" | "freie_skizze"),
        _ => false,
    }
}

/// Prüft die Eingaben einer neuen Zone (statt DB-CHECK→500), rein und ohne Datenbank.
/// Statuscodes nach der Konvention aus src/AGENTS.md: ein unbekannter Enum-Wert scheitert am Feld
/// selbst → 400; unpassende Typ-Geometrie-Kombination und kaputtes/abweichendes GeoJSON
/// bewerten den Zusammenhang → 422.
///
/// Handler (`routes/lage_zone.rs`) und Demo-Import (LFH-690) rufen dieselbe Funktion, damit
/// ein Szenariofehler als Testfehler auffällt und nicht erst auf der Karte (design.md D5).
pub fn validiere_neu(
    typ: &str,
    geometrie_typ: &str,
    geometrie: &str,
) -> Result<(), crate::error::AppError> {
    use crate::error::AppError;
    // Größe vor jeder 422 und vor dem Parsen (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
    pruefe_geometrie_groesse(geometrie, "geometrie")?;
    parse_enum(
        LageZoneTyp::parse,
        typ,
        format!("Unbekannter Zonen-Typ: {}", typ),
    )?;
    parse_enum(
        GeometrieTyp::parse,
        geometrie_typ,
        format!("Unbekannter Geometrie-Typ: {}", geometrie_typ),
    )?;
    if !geometrie_klasse_passt(typ, geometrie_typ) {
        return Err(AppError::UnprocessableEntity(format!(
            "Typ {} ist mit Geometrie {} nicht zulässig",
            typ, geometrie_typ
        )));
    }
    // geometrie muss gültiges JSON und vom angegebenen geometrie_typ sein.
    let v: serde_json::Value = serde_json::from_str(geometrie)
        .map_err(|_| AppError::UnprocessableEntity("geometrie ist kein gültiges JSON".into()))?;
    if v.get("type").and_then(|t| t.as_str()) != Some(geometrie_typ) {
        return Err(AppError::UnprocessableEntity(
            "geometrie.type passt nicht zu geometrie_typ".into(),
        ));
    }
    pruefe_geometrie_struktur(&v, "geometrie")
}

/// Höchstgröße des Geometrie-Strings einer Zone oder Abschnittsfläche in Bytes (LFH-937,
/// design.md D7).
pub const GEOMETRIE_BYTES_MAX: usize = 256 * 1024;
/// Höchstzahl der Ringe eines Polygons (Außenring plus Löcher).
pub const RINGE_MAX: usize = 10;
/// Höchstzahl der Positionen einer Geometrie, über alle Ringe. Spiegel:
/// `frontend/src/api/eingabegrenzen.ts` (`GEOMETRIE_STUETZPUNKTE_MAX`).
pub const STUETZPUNKTE_MAX: usize = 5_000;

/// Erster Schritt der Geometrie-Prüfung (LFH-937, design.md D7): ein String über
/// [`GEOMETRIE_BYTES_MAX`] ist 400, noch bevor er geparst wird.
pub fn pruefe_geometrie_groesse(geometrie: &str, feld: &str) -> Result<(), crate::error::AppError> {
    if geometrie.len() > GEOMETRIE_BYTES_MAX {
        return Err(crate::error::AppError::Validation(format!(
            "{feld} darf höchstens {} KiB groß sein",
            GEOMETRIE_BYTES_MAX / 1024
        )));
    }
    Ok(())
}

/// Struktur einer schon als Polygon oder LineString erkannten Geometrie (LFH-937, design.md D7):
/// `coordinates` richtig verschachtelt, jede Position 2 oder 3 endliche Zahlen mit Länge in
/// [-180, 180] und Breite in [-90, 90], höchstens [`RINGE_MAX`] Ringe und
/// [`STUETZPUNKTE_MAX`] Positionen. Verstöße sind Feldfehler → 400. Typ und JSON prüft der
/// Aufrufer vorher (bestehende 422).
pub fn pruefe_geometrie_struktur(
    v: &serde_json::Value,
    feld: &str,
) -> Result<(), crate::error::AppError> {
    use crate::error::AppError;
    let fehler = |was: &str| AppError::Validation(format!("{feld}: {was}"));
    let coords = v
        .get("coordinates")
        .and_then(|c| c.as_array())
        .ok_or_else(|| fehler("coordinates fehlt oder ist keine Liste"))?;
    let ringe: Vec<&Vec<serde_json::Value>> = match v.get("type").and_then(|t| t.as_str()) {
        Some("Polygon") => {
            if coords.is_empty() || coords.len() > RINGE_MAX {
                return Err(fehler(&format!(
                    "ein Polygon braucht 1 bis {RINGE_MAX} Ringe"
                )));
            }
            coords
                .iter()
                .map(|r| {
                    r.as_array()
                        .ok_or_else(|| fehler("ein Ring ist keine Liste"))
                })
                .collect::<Result<_, _>>()?
        }
        Some("LineString") => vec![coords],
        _ => return Err(fehler("unbekannter Geometrietyp")),
    };
    let punkte: usize = ringe.iter().map(|r| r.len()).sum();
    if punkte > STUETZPUNKTE_MAX {
        return Err(fehler(&format!(
            "höchstens {STUETZPUNKTE_MAX} Stützpunkte, waren {punkte}"
        )));
    }
    for position in ringe.iter().flat_map(|r| r.iter()) {
        let zahlen: Option<Vec<f64>> = position
            .as_array()
            .filter(|p| p.len() == 2 || p.len() == 3)
            .and_then(|p| p.iter().map(|z| z.as_f64()).collect());
        let Some(zahlen) = zahlen.filter(|z| z.iter().all(|x| x.is_finite())) else {
            return Err(fehler("jede Position ist [Länge, Breite] aus Zahlen"));
        };
        if !(-180.0..=180.0).contains(&zahlen[0]) || !(-90.0..=90.0).contains(&zahlen[1]) {
            return Err(fehler("Koordinate außerhalb von WGS84"));
        }
    }
    Ok(())
}

// ── Kreis um einen Punkt (LLH-1043) ─────────────────────────────────────────────────

/// Höchster Radius eines Kreises in Metern. Spiegel: `frontend/src/api/eingabegrenzen.ts`
/// (`KREIS_RADIUS_M_MAX`), geprüft in `tests/eingabegrenzen_spiegel.rs`.
pub const KREIS_RADIUS_M_MAX: usize = 50_000;
/// Ecken der Polygon-Näherung eines Kreises (ohne Schlusspunkt). Spiegel: `KREIS_ECKEN` in
/// `frontend/src/pages/lagekarte/geo.ts` (die Vorschau rechnet dieselbe Näherung).
pub const KREIS_ECKEN: usize = 64;
/// Erdradius der Kreisrechnung in Metern — derselbe wie im Frontend (`geo.ts`, `ERD_RADIUS_M`).
const ERD_RADIUS_M: f64 = 6_371_000.0;

/// Ein Kreis: Mitte in WGS84 und Radius in Metern. Wire-Form im Anlege-Body (`kreis`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Kreis {
    pub mitte_lat: f64,
    pub mitte_lon: f64,
    pub radius_m: f64,
}

/// Radius für sich: endlich, größer 0, höchstens [`KREIS_RADIUS_M_MAX`] — sonst 400 (Feldfehler).
pub fn pruefe_radius(radius_m: f64) -> Result<(), crate::error::AppError> {
    if !radius_m.is_finite() || radius_m <= 0.0 || radius_m > KREIS_RADIUS_M_MAX as f64 {
        return Err(crate::error::AppError::Validation(format!(
            "Radius muss größer 0 und höchstens {} m sein",
            format_meter(KREIS_RADIUS_M_MAX as f64)
        )));
    }
    Ok(())
}

/// Ein Kreis für sich: Radius nach [`pruefe_radius`], Mitte endlich und in WGS84 — sonst 400.
pub fn pruefe_kreis(k: &Kreis) -> Result<(), crate::error::AppError> {
    pruefe_radius(k.radius_m)?;
    if !k.mitte_lat.is_finite()
        || !k.mitte_lon.is_finite()
        || !(-90.0..=90.0).contains(&k.mitte_lat)
        || !(-180.0..=180.0).contains(&k.mitte_lon)
    {
        return Err(crate::error::AppError::Validation(
            "Kreismitte außerhalb von WGS84".into(),
        ));
    }
    Ok(())
}

/// Prüft eine neue Kreiszone (statt `validiere_neu`): Kreis für sich 400, Typ ohne Fläche
/// (`absperrgrenze`) oder ein `geometrie_typ` außer Polygon 422 (Zusammenhang).
pub fn validiere_kreis_neu(
    typ: &str,
    geometrie_typ: Option<&str>,
    kreis: &Kreis,
) -> Result<(), crate::error::AppError> {
    use crate::error::AppError;
    parse_enum(
        LageZoneTyp::parse,
        typ,
        format!("Unbekannter Zonen-Typ: {}", typ),
    )?;
    pruefe_kreis(kreis)?;
    if let Some(g) = geometrie_typ {
        parse_enum(
            GeometrieTyp::parse,
            g,
            format!("Unbekannter Geometrie-Typ: {}", g),
        )?;
        if g != "Polygon" {
            return Err(AppError::UnprocessableEntity(
                "Ein Kreis ist eine Fläche (geometrie_typ Polygon)".into(),
            ));
        }
    }
    if !geometrie_klasse_passt(typ, "Polygon") {
        return Err(AppError::UnprocessableEntity(format!(
            "Typ {} ist als Kreis nicht zulässig",
            typ
        )));
    }
    Ok(())
}

/// Geodätische Polygon-Näherung eines Kreises auf der Kugel: [`KREIS_ECKEN`] Ecken im gleichen
/// Winkelabstand, Außenring gegen den Uhrzeigersinn (RFC 7946), geschlossen. Koordinaten auf 7
/// Nachkommastellen (≈ 1 cm). Liefert den GeoJSON-String der Geometrie.
pub fn kreis_polygon(mitte_lat: f64, mitte_lon: f64, radius_m: f64) -> String {
    let phi1 = mitte_lat.to_radians();
    let lambda1 = mitte_lon.to_radians();
    let delta = radius_m / ERD_RADIUS_M;
    let runde = |x: f64| (x * 1e7).round() / 1e7;
    let mut ring: Vec<[f64; 2]> = (0..KREIS_ECKEN)
        .map(|i| {
            // Peilung von Nord im Uhrzeigersinn, rückwärts gezählt → Ring gegen den Uhrzeigersinn.
            let theta = -(i as f64) * std::f64::consts::TAU / KREIS_ECKEN as f64;
            let phi2 = (phi1.sin() * delta.cos() + phi1.cos() * delta.sin() * theta.cos()).asin();
            let lambda2 = lambda1
                + (theta.sin() * delta.sin() * phi1.cos())
                    .atan2(delta.cos() - phi1.sin() * phi2.sin());
            // Länge in [-180, 180] zurückfalten (Kreise nahe der Datumsgrenze).
            let lon = (lambda2.to_degrees() + 540.0).rem_euclid(360.0) - 180.0;
            [runde(lon), runde(phi2.to_degrees())]
        })
        .collect();
    ring.push(ring[0]);
    serde_json::json!({ "type": "Polygon", "coordinates": [ring] }).to_string()
}

/// Meter als ganze Zahl mit deutschem Tausenderpunkt: „300 m“, „1.500 m“. Dieselbe Form zeigt das
/// Frontend (`formatRadius` in `geo.ts`).
pub fn format_meter(m: f64) -> String {
    let ganz = m.round() as i64;
    let ziffern = ganz.abs().to_string();
    let mut aus = String::new();
    for (i, c) in ziffern.chars().enumerate() {
        if i > 0 && (ziffern.len() - i).is_multiple_of(3) {
            aus.push('.');
        }
        aus.push(c);
    }
    format!("{}{aus} m", if ganz < 0 { "-" } else { "" })
}

/// ETB-Wortlaut der Anlage einer Kreiszone: „Absperrbereich «Nord» eingerichtet · Kreis r = 300 m“.
pub fn etb_text_kreis_eingerichtet(typ: &str, label: Option<&str>, radius_m: f64) -> String {
    format!(
        "{} · Kreis r = {}",
        etb_text(typ, label, "eingerichtet"),
        format_meter(radius_m)
    )
}

/// ETB-Wortlaut einer Radiusänderung: „Absperrbereich «Nord»: Radius 300 m → 500 m“.
pub fn etb_text_radius(typ: &str, label: Option<&str>, alt_m: f64, neu_m: f64) -> String {
    etb_text_kreis_geaendert(typ, label, Some((alt_m, neu_m)), None)
}

/// ETB-Wortlaut einer Kreisänderung (LLH-1344, design.md D1): Radius „alt → neu“ und/oder
/// „Mitte um 120 m versetzt“, beides in EINER Zeile („…: Radius 300 m → 500 m · Mitte um 120 m
/// versetzt“). Ohne Label steht nur das Typwort vor dem Doppelpunkt.
pub fn etb_text_kreis_geaendert(
    typ: &str,
    label: Option<&str>,
    radius: Option<(f64, f64)>,
    mitte_versatz_m: Option<f64>,
) -> String {
    let wer = match label {
        Some(l) => format!("{} «{}»", typ_label(typ), l),
        None => typ_label(typ).to_string(),
    };
    let mut teile = Vec::new();
    if let Some((alt, neu)) = radius {
        teile.push(format!(
            "Radius {} → {}",
            format_meter(alt),
            format_meter(neu)
        ));
    }
    if let Some(v) = mitte_versatz_m {
        teile.push(format!("Mitte um {} versetzt", format_meter(v)));
    }
    format!("{wer}: {}", teile.join(" · "))
}

/// Großkreisabstand (Haversine) zweier WGS84-Punkte in Metern, auf derselben Kugel wie
/// [`kreis_polygon`]. Trägt den Versatz der Mitte im ETB.
pub fn grosskreis_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * ERD_RADIUS_M * a.sqrt().min(1.0).asin()
}

#[cfg(test)]
mod kreis_tests {
    use super::*;

    /// Großkreisabstand (Haversine) in Metern, unabhängig von der Rechnung oben.
    fn abstand_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
        let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
        let dp = (lat2 - lat1).to_radians();
        let dl = (lon2 - lon1).to_radians();
        let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
        2.0 * ERD_RADIUS_M * a.sqrt().min(1.0).asin()
    }

    fn ring(geo: &str) -> Vec<(f64, f64)> {
        let v: serde_json::Value = serde_json::from_str(geo).unwrap();
        assert_eq!(v["type"], "Polygon");
        v["coordinates"][0]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap()))
            .collect()
    }

    /// Fläche in m² über eine lokale winkeltreue Näherung (Shoelace) — reicht für r ≤ 50 km.
    fn flaeche_m2(r: &[(f64, f64)], ref_lat: f64) -> f64 {
        let m = ERD_RADIUS_M * std::f64::consts::PI / 180.0;
        let c = ref_lat.to_radians().cos();
        let mut a = 0.0;
        for w in r.windows(2) {
            let (x0, y0) = (w[0].0 * m * c, w[0].1 * m);
            let (x1, y1) = (w[1].0 * m * c, w[1].1 * m);
            a += x0 * y1 - x1 * y0;
        }
        a / 2.0
    }

    /// AK LLH-1043: jede Ecke liegt höchstens 1 % neben dem Sollradius, auch bei 54° N, und die
    /// Fläche weicht höchstens 1 % von π r² ab. Ring geschlossen, gegen den Uhrzeigersinn.
    #[test]
    fn kreis_polygon_weicht_hoechstens_ein_prozent_ab() {
        for (lat, lon, r) in [
            (54.0, 9.5, 300.0),
            (54.0, 9.5, 50.0),
            (54.0, 9.5, 50_000.0),
            (51.3, 9.9, 1_000.0),
            (0.0, 179.999, 500.0),
        ] {
            let ecken = ring(&kreis_polygon(lat, lon, r));
            assert_eq!(ecken.len(), KREIS_ECKEN + 1, "64 Ecken + Schlusspunkt");
            assert_eq!(ecken.first(), ecken.last(), "geschlossen");
            for &(x, y) in &ecken {
                let d = abstand_m(lat, lon, y, x);
                assert!(
                    (d - r).abs() / r <= 0.01,
                    "{lat}/{lon} r={r}: Ecke bei {d} m"
                );
                assert!((-180.0..=180.0).contains(&x));
            }
            if lon.abs() < 179.0 {
                let a = flaeche_m2(&ecken, lat);
                let soll = std::f64::consts::PI * r * r;
                assert!(a > 0.0, "Außenring gegen den Uhrzeigersinn");
                assert!((a - soll).abs() / soll <= 0.01, "Fläche {a} statt {soll}");
            }
        }
        // Die Kreisnäherung besteht die Strukturprüfung jeder Zone.
        let geo = kreis_polygon(54.0, 9.5, 300.0);
        assert!(validiere_neu("absperrbereich", "Polygon", &geo).is_ok());
    }

    #[test]
    fn radius_grenzen_sind_400_und_linie_als_kreis_422() {
        let code = |r: Result<(), crate::error::AppError>| r.err().map(|e| e.status().as_u16());
        let k = |r: f64| Kreis {
            mitte_lat: 54.0,
            mitte_lon: 9.5,
            radius_m: r,
        };
        assert_eq!(code(pruefe_kreis(&k(300.0))), None);
        assert_eq!(code(pruefe_kreis(&k(50_000.0))), None);
        for r in [0.0, -1.0, 50_000.5, f64::NAN, f64::INFINITY] {
            assert_eq!(code(pruefe_kreis(&k(r))), Some(400), "{r}");
        }
        let ausserhalb = Kreis {
            mitte_lat: 91.0,
            ..k(300.0)
        };
        assert_eq!(code(pruefe_kreis(&ausserhalb)), Some(400));
        assert_eq!(
            code(validiere_kreis_neu("absperrgrenze", None, &k(300.0))),
            Some(422)
        );
        assert_eq!(
            code(validiere_kreis_neu(
                "absperrbereich",
                Some("LineString"),
                &k(300.0)
            )),
            Some(422)
        );
        assert_eq!(
            code(validiere_kreis_neu("quatsch", None, &k(300.0))),
            Some(400)
        );
        assert_eq!(
            code(validiere_kreis_neu(
                "gefahrengebiet",
                Some("Polygon"),
                &k(300.0)
            )),
            None
        );
    }

    #[test]
    fn etb_wortlaute_des_kreises() {
        assert_eq!(format_meter(300.0), "300 m");
        assert_eq!(format_meter(1_500.0), "1.500 m");
        assert_eq!(format_meter(50_000.0), "50.000 m");
        assert_eq!(format_meter(299.6), "300 m");
        assert_eq!(
            etb_text_kreis_eingerichtet("absperrbereich", Some("Nord"), 300.0),
            "Absperrbereich «Nord» eingerichtet · Kreis r = 300 m"
        );
        assert_eq!(
            etb_text_radius("absperrbereich", None, 300.0, 500.0),
            "Absperrbereich: Radius 300 m → 500 m"
        );
        assert_eq!(
            etb_text_radius("gefahrengebiet", Some("Werk"), 1_000.0, 300.0),
            "Gefahrengebiet «Werk»: Radius 1.000 m → 300 m"
        );
        // LLH-1344: Mitte allein und beides in einer Zeile.
        assert_eq!(
            etb_text_kreis_geaendert("absperrbereich", Some("Nord"), None, Some(120.4)),
            "Absperrbereich «Nord»: Mitte um 120 m versetzt"
        );
        assert_eq!(
            etb_text_kreis_geaendert("absperrbereich", None, Some((300.0, 500.0)), Some(1_234.0)),
            "Absperrbereich: Radius 300 m → 500 m · Mitte um 1.234 m versetzt"
        );
    }

    /// 0,001° Breite sind auf der Kugel R = 6 371 km rund 111,19 m.
    #[test]
    fn grosskreis_misst_einen_tausendstel_grad_breite() {
        let d = grosskreis_m(54.0, 9.5, 54.001, 9.5);
        assert!((d - 111.19).abs() < 0.01, "{d}");
        assert_eq!(grosskreis_m(54.0, 9.5, 54.0, 9.5), 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// LFH-673: der Bezirk ist eine Fläche — keine Linie, und das Typwort steht im ETB.
    #[test]
    fn evakuierungsbezirk_nur_als_flaeche_mit_eigenem_typwort() {
        assert!(geometrie_klasse_passt("evakuierungsbezirk", "Polygon"));
        assert!(!geometrie_klasse_passt("evakuierungsbezirk", "LineString"));
        assert_eq!(typ_label("evakuierungsbezirk"), "Evakuierungsbezirk");
        assert_eq!(
            LageZoneTyp::parse("evakuierungsbezirk"),
            Some(LageZoneTyp::Evakuierungsbezirk)
        );
    }

    fn ring(n: usize) -> String {
        // n Positionen auf einem Kreis um (9, 51), geschlossen.
        let mut p: Vec<String> = (0..n - 1)
            .map(|i| {
                let w = i as f64 / (n - 1) as f64 * std::f64::consts::TAU;
                format!("[{},{}]", 9.0 + 0.01 * w.cos(), 51.0 + 0.01 * w.sin())
            })
            .collect();
        p.push(p[0].clone());
        format!("[{}]", p.join(","))
    }

    fn polygon(ringe: &[String]) -> String {
        format!(
            r#"{{"type":"Polygon","coordinates":[{}]}}"#,
            ringe.join(",")
        )
    }

    fn status(geo: &str, g: &str) -> Option<u16> {
        validiere_neu("freie_skizze", g, geo)
            .err()
            .map(|e| e.status().as_u16())
    }

    /// LFH-937, design.md D7: Struktur und Grenzen sind 400, gültige Zeichnungen gehen durch.
    #[test]
    fn geometrie_grenzen_und_struktur() {
        assert_eq!(status(&polygon(&[ring(5_000)]), "Polygon"), None);
        assert_eq!(status(&polygon(&[ring(5_001)]), "Polygon"), Some(400));
        assert_eq!(
            status(&polygon(&[ring(4_000), ring(1_001)]), "Polygon"),
            Some(400)
        );
        let zehn: Vec<String> = (0..10).map(|_| ring(4)).collect();
        assert_eq!(status(&polygon(&zehn), "Polygon"), None);
        let elf: Vec<String> = (0..11).map(|_| ring(4)).collect();
        assert_eq!(status(&polygon(&elf), "Polygon"), Some(400));
        assert_eq!(
            status(r#"{"type":"Polygon","coordinates":[]}"#, "Polygon"),
            Some(400)
        );
        let linie = r#"{"type":"LineString","coordinates":[[9,51],[9.1,51.1,12.5]]}"#;
        assert_eq!(
            status(linie, "LineString"),
            None,
            "Höhe als dritte Zahl ist erlaubt"
        );
        for kaputt in [
            r#"{"type":"LineString","coordinates":[["a",51],[9,51]]}"#,
            r#"{"type":"LineString","coordinates":[["NaN",51],[9,51]]}"#,
            r#"{"type":"LineString","coordinates":[[181,51],[9,51]]}"#,
            r#"{"type":"LineString","coordinates":[[9,-90.5],[9,51]]}"#,
            r#"{"type":"LineString","coordinates":[[9],[9,51]]}"#,
            r#"{"type":"LineString","coordinates":[[9,51,1,2],[9,51]]}"#,
            r#"{"type":"LineString","coordinates":"x"}"#,
            r#"{"type":"LineString"}"#,
            r#"{"type":"Polygon","coordinates":[[9,51]]}"#,
        ] {
            let g = if kaputt.contains("Polygon") {
                "Polygon"
            } else {
                "LineString"
            };
            assert_eq!(status(kaputt, g), Some(400), "{kaputt}");
        }
    }

    #[test]
    fn geometrie_ueber_256_kib_ist_400_vor_dem_parsen() {
        // Kein gültiges JSON, aber zu groß: die Größe entscheidet zuerst (400, nicht 422).
        let gross = "x".repeat(GEOMETRIE_BYTES_MAX + 1);
        assert_eq!(status(&gross, "Polygon"), Some(400));
        assert_eq!(
            status(&"x".repeat(10), "Polygon"),
            Some(422),
            "kaputtes JSON bleibt 422"
        );
    }

    /// Die reine Prüfung aus dem Handler, Wortlaut und Code je Fall (LFH-690).
    #[test]
    fn validiere_neu_feld_400_zusammenhang_422() {
        let poly =
            r#"{"type":"Polygon","coordinates":[[[9.0,51.0],[9.1,51.0],[9.1,51.1],[9.0,51.0]]]}"#;
        assert!(validiere_neu("gefahrengebiet", "Polygon", poly).is_ok());
        let fall = |t: &str, g: &str, geo: &str| {
            let e = validiere_neu(t, g, geo).unwrap_err();
            (e.status().as_u16(), e.to_string())
        };
        assert_eq!(fall("unsinn", "Polygon", poly).0, 400);
        assert_eq!(fall("gefahrengebiet", "Punkt", poly).0, 400);
        let (code, text) = fall("absperrgrenze", "Polygon", poly);
        assert_eq!(code, 422);
        assert!(text.contains("Typ absperrgrenze ist mit Geometrie Polygon nicht zulässig"));
        let (code, text) = fall("gefahrengebiet", "Polygon", "{kaputt");
        assert_eq!(code, 422);
        assert!(text.contains("geometrie ist kein gültiges JSON"));
        let (code, text) = fall("gefahrengebiet", "Polygon", r#"{"type":"LineString"}"#);
        assert_eq!(code, 422);
        assert!(text.contains("geometrie.type passt nicht zu geometrie_typ"));
    }
}

// ── System-ETB-Wortlaute (LFH-690) ──────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein
// importierter Einsatz dieselben ETB-Texte trägt wie ein echter.

/// ETB-Wortlaut einer Lage-Zone: «<Typ-Label> «Label» <verb>» bzw. ohne Label
/// «<Typ-Label> <verb>». Verben im Betrieb: „eingerichtet“ (Anlegen), „geändert“,
/// „aufgehoben“.
pub fn etb_text(typ: &str, label: Option<&str>, verb: &str) -> String {
    match label {
        Some(l) => format!("{} «{}» {}", typ_label(typ), l, verb),
        None => format!("{} {}", typ_label(typ), verb),
    }
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn eingerichtet_mit_und_ohne_label() {
        assert_eq!(
            etb_text("gefahrengebiet", Some("Deich Nord"), "eingerichtet"),
            "Gefahrengebiet «Deich Nord» eingerichtet"
        );
        assert_eq!(
            etb_text("absperrbereich", None, "aufgehoben"),
            "Absperrbereich aufgehoben"
        );
    }
}
