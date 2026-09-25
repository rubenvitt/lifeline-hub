pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Zonen-Typ (Schema-Anker für die OpenAPI-Union, LFH-120; TS: `ZoneTyp`). Wire == `typ`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LageZoneTyp {
    Gefahrengebiet,
    Absperrbereich,
    Absperrgrenze,
    Sperrgebiet,
    FreieSkizze,
    /// Fläche eines Evakuierungsbezirks (LFH-673). Nur Polygon; optional einem Bezirk des
    /// Fachmoduls Betreuung zugeordnet (`evakuierungsbezirk_id`, n : 1).
    Evakuierungsbezirk,
}
impl LageZoneTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            LageZoneTyp::Gefahrengebiet => "gefahrengebiet",
            LageZoneTyp::Absperrbereich => "absperrbereich",
            LageZoneTyp::Absperrgrenze => "absperrgrenze",
            LageZoneTyp::Sperrgebiet => "sperrgebiet",
            LageZoneTyp::FreieSkizze => "freie_skizze",
            LageZoneTyp::Evakuierungsbezirk => "evakuierungsbezirk",
        }
    }
    pub fn parse(s: &str) -> Option<LageZoneTyp> {
        match s {
            "gefahrengebiet" => Some(LageZoneTyp::Gefahrengebiet),
            "absperrbereich" => Some(LageZoneTyp::Absperrbereich),
            "absperrgrenze" => Some(LageZoneTyp::Absperrgrenze),
            "sperrgebiet" => Some(LageZoneTyp::Sperrgebiet),
            "freie_skizze" => Some(LageZoneTyp::FreieSkizze),
            "evakuierungsbezirk" => Some(LageZoneTyp::Evakuierungsbezirk),
            _ => None,
        }
    }
}
impl TryFrom<String> for LageZoneTyp {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        LageZoneTyp::parse(&s).ok_or_else(|| format!("Ungültiger LageZoneTyp: {s}"))
    }
}

/// Geometrie-Typ (GeoJSON-Geometry-`type`) — Validierungs-Enum für den Request-Guard.
/// Bewusst OHNE Serialize/ToSchema: das DTO-Feld `geometrie_typ` bleibt `String` (kein
/// OpenAPI-Anker → Typisierung wäre kein Codegen-No-Op).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometrieTyp {
    Polygon,
    LineString,
}
impl GeometrieTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            GeometrieTyp::Polygon => "Polygon",
            GeometrieTyp::LineString => "LineString",
        }
    }
    pub fn parse(s: &str) -> Option<GeometrieTyp> {
        match s {
            "Polygon" => Some(GeometrieTyp::Polygon),
            "LineString" => Some(GeometrieTyp::LineString),
            _ => None,
        }
    }
}

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
/// Statuscodes nach der Konvention aus CLAUDE.md: ein unbekannter Enum-Wert scheitert am Feld
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
    if LageZoneTyp::parse(typ).is_none() {
        return Err(AppError::Validation(format!(
            "Unbekannter Zonen-Typ: {}",
            typ
        )));
    }
    if GeometrieTyp::parse(geometrie_typ).is_none() {
        return Err(AppError::Validation(format!(
            "Unbekannter Geometrie-Typ: {}",
            geometrie_typ
        )));
    }
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
