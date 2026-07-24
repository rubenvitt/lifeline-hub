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
}
impl LageZoneTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            LageZoneTyp::Gefahrengebiet => "gefahrengebiet",
            LageZoneTyp::Absperrbereich => "absperrbereich",
            LageZoneTyp::Absperrgrenze => "absperrgrenze",
            LageZoneTyp::Sperrgebiet => "sperrgebiet",
            LageZoneTyp::FreieSkizze => "freie_skizze",
        }
    }
    pub fn parse(s: &str) -> Option<LageZoneTyp> {
        match s {
            "gefahrengebiet" => Some(LageZoneTyp::Gefahrengebiet),
            "absperrbereich" => Some(LageZoneTyp::Absperrbereich),
            "absperrgrenze" => Some(LageZoneTyp::Absperrgrenze),
            "sperrgebiet" => Some(LageZoneTyp::Sperrgebiet),
            "freie_skizze" => Some(LageZoneTyp::FreieSkizze),
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
            "gefahrengebiet" | "absperrbereich" | "sperrgebiet" | "freie_skizze"
        ),
        "LineString" => matches!(typ, "absperrgrenze" | "freie_skizze"),
        _ => false,
    }
}
