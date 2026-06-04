pub mod repo;

use serde::Serialize;

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

/// Eine freie Lage-Zone (Gefahren-/Absperrzone). Eigenständige Entität — kein Fachobjekt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LageZoneAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub typ: String,
    pub geometrie_typ: String,
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
    pub gefahrentyp: Option<String>,
    pub schutzobjekt: Option<String>,
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

/// Prüft die optionale Gefahren-Zuordnung einer Zone:
/// - nur `typ='gefahrengebiet'` darf eine Zuordnung tragen,
/// - beide Felder gemeinsam gesetzt oder beide leer (kein Halb-Zustand),
/// - gültige Enums + gültige Kombination (delegiert an `gefahr::kombination_gueltig`).
pub fn gefahren_zuordnung_gueltig(
    typ_der_zone: &str,
    gefahrentyp: Option<&str>,
    schutzobjekt: Option<&str>,
) -> bool {
    match (gefahrentyp, schutzobjekt) {
        (None, None) => true,
        (Some(g), Some(o)) => {
            typ_der_zone == "gefahrengebiet"
                && crate::gefahr::GEFAHRENTYPEN.contains(&g)
                && crate::gefahr::SCHUTZOBJEKTE.contains(&o)
                && crate::gefahr::kombination_gueltig(g, o)
        }
        _ => false, // genau eines gesetzt → ungültig
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
