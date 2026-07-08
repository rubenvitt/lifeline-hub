pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Erlaubte Typen (Reihenfolge wie Typ-Katalog der Spec).
pub const TYPEN: [&str; 5] = [
    "gefahrengebiet",
    "absperrbereich",
    "absperrgrenze",
    "sperrgebiet",
    "freie_skizze",
];

/// Erlaubte Geometrie-Typen (GeoJSON-Geometry-`type`).
pub const GEOMETRIE_TYPEN: [&str; 2] = ["Polygon", "LineString"];

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

/// Eine freie Lage-Zone (Gefahren-/Absperrzone). Eigenständige Entität — kein Fachobjekt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct LageZoneAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    #[schema(value_type = LageZoneTyp)]
    pub typ: String,
    pub geometrie_typ: String,
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
    pub gefahrengebiet_id: Option<i64>,
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
