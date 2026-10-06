pub mod repo;

use crate::routes::support::parse_enum;
use crate::wire_enum::wire_enum;
use serde::Serialize;
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
impl LageZoneTyp {}

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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
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
