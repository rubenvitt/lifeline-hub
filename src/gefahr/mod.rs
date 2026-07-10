pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Gefahrentyp (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `gefahrentyp`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Gefahrentyp {
    Atemgifte,
    Angstreaktion,
    Ausbreitung,
    AtomareStrahlung,
    ChemischeStoffe,
    ErkrankungVerletzung,
    Explosion,
    Elektrizitaet,
    Einsturz,
    Absturz,
    Brand,
    Durchbruch,
    Ertrinken,
}

impl Gefahrentyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            Gefahrentyp::Atemgifte => "atemgifte",
            Gefahrentyp::Angstreaktion => "angstreaktion",
            Gefahrentyp::Ausbreitung => "ausbreitung",
            Gefahrentyp::AtomareStrahlung => "atomare_strahlung",
            Gefahrentyp::ChemischeStoffe => "chemische_stoffe",
            Gefahrentyp::ErkrankungVerletzung => "erkrankung_verletzung",
            Gefahrentyp::Explosion => "explosion",
            Gefahrentyp::Elektrizitaet => "elektrizitaet",
            Gefahrentyp::Einsturz => "einsturz",
            Gefahrentyp::Absturz => "absturz",
            Gefahrentyp::Brand => "brand",
            Gefahrentyp::Durchbruch => "durchbruch",
            Gefahrentyp::Ertrinken => "ertrinken",
        }
    }
    pub fn parse(s: &str) -> Option<Gefahrentyp> {
        match s {
            "atemgifte" => Some(Gefahrentyp::Atemgifte),
            "angstreaktion" => Some(Gefahrentyp::Angstreaktion),
            "ausbreitung" => Some(Gefahrentyp::Ausbreitung),
            "atomare_strahlung" => Some(Gefahrentyp::AtomareStrahlung),
            "chemische_stoffe" => Some(Gefahrentyp::ChemischeStoffe),
            "erkrankung_verletzung" => Some(Gefahrentyp::ErkrankungVerletzung),
            "explosion" => Some(Gefahrentyp::Explosion),
            "elektrizitaet" => Some(Gefahrentyp::Elektrizitaet),
            "einsturz" => Some(Gefahrentyp::Einsturz),
            "absturz" => Some(Gefahrentyp::Absturz),
            "brand" => Some(Gefahrentyp::Brand),
            "durchbruch" => Some(Gefahrentyp::Durchbruch),
            "ertrinken" => Some(Gefahrentyp::Ertrinken),
            _ => None,
        }
    }
}
impl TryFrom<String> for Gefahrentyp {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Gefahrentyp::parse(&s).ok_or_else(|| format!("Ungültiger Gefahrentyp: {s}"))
    }
}

/// Schutzobjekt (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `schutzobjekt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Schutzobjekt {
    Menschen,
    Tiere,
    Umwelt,
    Sachwerte,
    Einsatzkraefte,
}

impl Schutzobjekt {
    pub fn as_str(&self) -> &'static str {
        match self {
            Schutzobjekt::Menschen => "menschen",
            Schutzobjekt::Tiere => "tiere",
            Schutzobjekt::Umwelt => "umwelt",
            Schutzobjekt::Sachwerte => "sachwerte",
            Schutzobjekt::Einsatzkraefte => "einsatzkraefte",
        }
    }
    pub fn parse(s: &str) -> Option<Schutzobjekt> {
        match s {
            "menschen" => Some(Schutzobjekt::Menschen),
            "tiere" => Some(Schutzobjekt::Tiere),
            "umwelt" => Some(Schutzobjekt::Umwelt),
            "sachwerte" => Some(Schutzobjekt::Sachwerte),
            "einsatzkraefte" => Some(Schutzobjekt::Einsatzkraefte),
            _ => None,
        }
    }
}
impl TryFrom<String> for Schutzobjekt {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Schutzobjekt::parse(&s).ok_or_else(|| format!("Ungültiges Schutzobjekt: {s}"))
    }
}

/// Warnstufe (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `warnstufe`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Warnstufe {
    Keine,
    Niedrig,
    Mittel,
    Hoch,
    Akut,
}

impl Warnstufe {
    pub fn as_str(&self) -> &'static str {
        match self {
            Warnstufe::Keine => "keine",
            Warnstufe::Niedrig => "niedrig",
            Warnstufe::Mittel => "mittel",
            Warnstufe::Hoch => "hoch",
            Warnstufe::Akut => "akut",
        }
    }
    pub fn parse(s: &str) -> Option<Warnstufe> {
        match s {
            "keine" => Some(Warnstufe::Keine),
            "niedrig" => Some(Warnstufe::Niedrig),
            "mittel" => Some(Warnstufe::Mittel),
            "hoch" => Some(Warnstufe::Hoch),
            "akut" => Some(Warnstufe::Akut),
            _ => None,
        }
    }
}
impl TryFrom<String> for Warnstufe {
    type Error = String;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Warnstufe::parse(&s).ok_or_else(|| format!("Ungültige Warnstufe: {s}"))
    }
}

/// Aufgelöste Matrix-Zelle (gefahrengebiet-skopiert). Die Liste enthält nur Zellen mit
/// `warnstufe != 'keine'`; das Frontend rendert das 13×5-Raster aus den Katalogen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct GefahrBewertungAnzeige {
    pub id: i64,
    pub gefahrengebiet_id: i64,
    pub gefahrentyp: Gefahrentyp,
    pub schutzobjekt: Schutzobjekt,
    pub warnstufe: Warnstufe,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
    pub aktualisiert_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}

/// Ein Gefahrengebiet (Gruppe aus 1..n gefahrengebiet-Zonen), trägt eine Matrix.
/// `zonen_ids`: zugehörige lage_zone-IDs. `hoechste_warnstufe`: stärkste gesetzte
/// Zelle der Matrix (Severity-Maximum), `keine` wenn nichts gesetzt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct GefahrengebietAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub label: Option<String>,
    pub zonen_ids: Vec<i64>,
    pub hoechste_warnstufe: Warnstufe,
}

/// Severity-Rang einer Warnstufe (für „höchste Warnstufe je Gebiet"). Lexikalisches
/// MAX wäre falsch (`akut` < `keine`), daher expliziter Rang.
pub fn warnstufe_von_rang(rang: i64) -> Warnstufe {
    match rang {
        4 => Warnstufe::Akut,
        3 => Warnstufe::Hoch,
        2 => Warnstufe::Mittel,
        1 => Warnstufe::Niedrig,
        _ => Warnstufe::Keine,
    }
}

/// Ob `(typ, objekt)` eine fachlich gültige Kombination ist (verbatim aus BLH).
/// Ungültig: sachwerte×{angstreaktion,atemgifte,erkrankung_verletzung,ertrinken},
/// umwelt×{angstreaktion,erkrankung_verletzung,ertrinken}.
pub fn kombination_gueltig(typ: &str, objekt: &str) -> bool {
    !matches!(
        (objekt, typ),
        (
            "sachwerte",
            "angstreaktion" | "atemgifte" | "erkrankung_verletzung" | "ertrinken"
        ) | (
            "umwelt",
            "angstreaktion" | "erkrankung_verletzung" | "ertrinken"
        )
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
