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
