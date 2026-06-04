pub mod repo;

use serde::Serialize;

/// 13 Gefahrentypen (verbatim aus bluelight-hub; lowercase-snake wie lage_zone.typ).
pub const GEFAHRENTYPEN: [&str; 13] = [
    "atemgifte", "angstreaktion", "ausbreitung", "atomare_strahlung", "chemische_stoffe",
    "erkrankung_verletzung", "explosion", "elektrizitaet", "einsturz", "absturz", "brand",
    "durchbruch", "ertrinken",
];

/// 5 Schutzobjekte.
pub const SCHUTZOBJEKTE: [&str; 5] = [
    "menschen", "tiere", "umwelt", "sachwerte", "einsatzkraefte",
];

/// 5 Warnstufen (`keine` = effektiv keine Bewertung).
pub const WARNSTUFEN: [&str; 5] = ["keine", "niedrig", "mittel", "hoch", "akut"];

/// Aufgelöste Matrix-Zelle (einsatz-skopiert). Die Liste enthält nur Zellen mit
/// `warnstufe != 'keine'`; das Frontend rendert das 13×5-Raster aus den Katalogen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GefahrBewertungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
    pub aktualisiert_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}

/// Ob `(typ, objekt)` eine fachlich gültige Kombination ist (verbatim aus BLH).
/// Ungültig: sachwerte×{angstreaktion,atemgifte,erkrankung_verletzung,ertrinken},
/// umwelt×{angstreaktion,erkrankung_verletzung,ertrinken}.
pub fn kombination_gueltig(typ: &str, objekt: &str) -> bool {
    !matches!(
        (objekt, typ),
        ("sachwerte", "angstreaktion" | "atemgifte" | "erkrankung_verletzung" | "ertrinken")
            | ("umwelt", "angstreaktion" | "erkrankung_verletzung" | "ertrinken")
    )
}

/// Sprechendes Label eines Gefahrentyps (für den ETB-Wortlaut).
pub fn gefahrentyp_label(typ: &str) -> &'static str {
    match typ {
        "atemgifte" => "Atemgifte",
        "angstreaktion" => "Angstreaktion",
        "ausbreitung" => "Ausbreitung",
        "atomare_strahlung" => "Atomare Strahlung",
        "chemische_stoffe" => "Chemische Stoffe",
        "erkrankung_verletzung" => "Erkrankung/Verletzung",
        "explosion" => "Explosion",
        "elektrizitaet" => "Elektrizität",
        "einsturz" => "Einsturz",
        "absturz" => "Absturz",
        "brand" => "Brand",
        "durchbruch" => "Durchbruch",
        "ertrinken" => "Ertrinken",
        _ => "Gefahr",
    }
}

/// Sprechendes Label eines Schutzobjekts (für den ETB-Wortlaut).
pub fn schutzobjekt_label(objekt: &str) -> &'static str {
    match objekt {
        "menschen" => "Menschen",
        "tiere" => "Tiere",
        "umwelt" => "Umwelt",
        "sachwerte" => "Sachwerte",
        "einsatzkraefte" => "Einsatzkräfte",
        _ => "Schutzobjekt",
    }
}
