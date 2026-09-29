pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Gefahrentyp (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `gefahrentyp`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Gefahrentyp {
        Atemgifte => "atemgifte",
        Angstreaktion => "angstreaktion",
        Ausbreitung => "ausbreitung",
        AtomareStrahlung => "atomare_strahlung",
        ChemischeStoffe => "chemische_stoffe",
        ErkrankungVerletzung => "erkrankung_verletzung",
        Explosion => "explosion",
        Elektrizitaet => "elektrizitaet",
        Einsturz => "einsturz",
        Absturz => "absturz",
        Brand => "brand",
        Durchbruch => "durchbruch",
        Ertrinken => "ertrinken",
    }
    try_from = |s| format!("Ungültiger Gefahrentyp: {s}");
}

wire_enum! {
    /// Schutzobjekt (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `schutzobjekt`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Schutzobjekt {
        Menschen => "menschen",
        Tiere => "tiere",
        Umwelt => "umwelt",
        Sachwerte => "sachwerte",
        Einsatzkraefte => "einsatzkraefte",
    }
    try_from = |s| format!("Ungültiges Schutzobjekt: {s}");
}

wire_enum! {
    /// Warnstufe (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `warnstufe`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Warnstufe {
        Keine => "keine",
        Niedrig => "niedrig",
        Mittel => "mittel",
        Hoch => "hoch",
        Akut => "akut",
    }
    try_from = |s| format!("Ungültige Warnstufe: {s}");
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

// ── System-ETB-Wortlaute (LFH-690) ──────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein
// importierter Einsatz dieselben ETB-Texte trägt wie ein echter.

/// System-ETB bei geänderter Warnstufe einer Bewertung. `gefahrentyp`/`schutzobjekt` sind die
/// Wire-Werte, `gebiet_label` das Label des Gefahrengebiets (ohne Label «Gefahrengebiet #id»).
/// Warnstufe `keine` heißt „aufgehoben“, jede andere nennt den Wire-Wert. Ob überhaupt
/// geschrieben wird (nur bei Änderung), entscheidet der Aufrufer.
pub fn etb_text_bewertung(
    gefahrentyp: &str,
    schutzobjekt: &str,
    gebiet_label: Option<&str>,
    gebiet_id: i64,
    warnstufe: Warnstufe,
) -> String {
    let g = gefahrentyp_label(gefahrentyp);
    let o = schutzobjekt_label(schutzobjekt);
    let gname = gebiet_label
        .map(str::to_string)
        .unwrap_or_else(|| format!("Gefahrengebiet #{gebiet_id}"));
    if warnstufe == Warnstufe::Keine {
        format!("Gefahr «{g}» für «{o}» in «{gname}» aufgehoben.")
    } else {
        format!(
            "Gefahr «{g}» für «{o}» in «{gname}» auf Warnstufe «{}» gesetzt.",
            warnstufe.as_str()
        )
    }
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn bewertung_gesetzt_aufgehoben_und_ohne_label() {
        assert_eq!(
            etb_text_bewertung(
                "ertrinken",
                "menschen",
                Some("Deich Nord"),
                3,
                Warnstufe::Hoch
            ),
            "Gefahr «Ertrinken» für «Menschen» in «Deich Nord» auf Warnstufe «hoch» gesetzt."
        );
        assert_eq!(
            etb_text_bewertung(
                "ertrinken",
                "menschen",
                Some("Deich Nord"),
                3,
                Warnstufe::Keine
            ),
            "Gefahr «Ertrinken» für «Menschen» in «Deich Nord» aufgehoben."
        );
        assert_eq!(
            etb_text_bewertung("einsturz", "einsatzkraefte", None, 7, Warnstufe::Akut),
            "Gefahr «Einsturz» für «Einsatzkräfte» in «Gefahrengebiet #7» auf Warnstufe «akut» gesetzt."
        );
    }
}
