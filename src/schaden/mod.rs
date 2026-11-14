pub mod anhang;
pub mod repo;

/// Höchstlänge von Ort und Geschädigt-Kontakt eines Schadens (LFH-937, design.md D6). Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const ORT_MAX: usize = 500;
/// Höchstlänge der Beschreibung eines Schadens (LFH-937, design.md D6).
pub const BESCHREIBUNG_MAX: usize = 8_000;

use crate::gefahr::Gefahrentyp;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

// ---------- Status ----------

wire_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum SchadenStatus {
        Offen => "offen",
        Uebergeben => "uebergeben",
        Abgeschlossen => "abgeschlossen",
    }
    sqlx = |s| format!("Ungültiger SchadenStatus: {s}");
}

// ---------- Typ ----------

wire_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum SchadenTyp {
        Sachschaden => "sachschaden",
        Verkehrshindernis => "verkehrshindernis",
        Infrastruktur => "infrastruktur",
        Umweltschaden => "umweltschaden",
        Tierkadaver => "tierkadaver",
        Sonstige => "sonstige",
    }
    sqlx = |s| format!("Ungültiger SchadenTyp: {s}");
}

impl SchadenTyp {
    /// Beschriftung im ETB-Text, dieselbe wie `TYP_LABEL` in
    /// `frontend/src/pages/schaeden/schadenHelfer.tsx` (LFH-1144: das ETB nennt keine Schlüssel).
    pub fn etb_label(&self) -> &'static str {
        match self {
            SchadenTyp::Sachschaden => "Sachschaden",
            SchadenTyp::Verkehrshindernis => "Verkehrshindernis",
            SchadenTyp::Infrastruktur => "Infrastruktur",
            SchadenTyp::Umweltschaden => "Umweltschaden",
            SchadenTyp::Tierkadaver => "Tierkadaver",
            SchadenTyp::Sonstige => "Sonstige",
        }
    }
}

// ---------- Ausmaß ----------

wire_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Ausmass {
        Gering => "gering",
        Mittel => "mittel",
        Gross => "gross",
        Katastrophal => "katastrophal",
    }
    sqlx = |s| format!("Ungültiges Ausmaß: {s}");
}

impl Ausmass {
    /// Beschriftung im ETB-Text, dieselbe wie `schadenAusmass` in
    /// `frontend/src/theme/statusFarben.ts` (LFH-1144).
    pub fn etb_label(&self) -> &'static str {
        match self {
            Ausmass::Gering => "gering",
            Ausmass::Mittel => "mittel",
            Ausmass::Gross => "groß",
            Ausmass::Katastrophal => "katastrophal",
        }
    }
}

// ---------- Schadensgrad ----------

wire_enum! {
    /// Schadensgrad nach DV 102, Kap. 5.8.4 (LLH-1115, design.md D1/D3). Das Kartenzeichen bildet
    /// erst der Client (`frontend/src/zeichen/fachobjektZeichen.ts`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Schadensgrad {
        Angeschlagen => "angeschlagen",
        Teilzerstoert => "teilzerstoert",
        Zerstoert => "zerstoert",
    }
    sqlx = |s| format!("Ungültiger Schadensgrad: {s}");
}

impl Schadensgrad {
    /// Wort im ETB-Text, dasselbe wie `SCHADENSGRAD_LABEL` in
    /// `frontend/src/pages/schaeden/schadenHelfer.tsx` (DV 102: „Total zerstört“).
    pub fn etb_label(&self) -> &'static str {
        match self {
            Schadensgrad::Angeschlagen => "angeschlagen",
            Schadensgrad::Teilzerstoert => "teilzerstört",
            Schadensgrad::Zerstoert => "total zerstört",
        }
    }
}

// ---------- Abschlussgrund ----------

wire_enum! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    #[schema(as = SchadenAbschlussGrund)]
    pub enum AbschlussGrund {
        Behoben => "behoben",
        KeinHandlungsbedarf => "kein_handlungsbedarf",
        Abgewiesen => "abgewiesen",
    }
    sqlx = |s| format!("Ungültiger Abschlussgrund: {s}");
}

impl AbschlussGrund {
    /// Beschriftung im ETB-Text, dieselbe wie `ABSCHLUSS_LABEL` in
    /// `frontend/src/pages/schaeden/schadenHelfer.tsx` (LFH-1144).
    pub fn etb_label(&self) -> &'static str {
        match self {
            AbschlussGrund::Behoben => "behoben",
            AbschlussGrund::KeinHandlungsbedarf => "kein Handlungsbedarf",
            AbschlussGrund::Abgewiesen => "abgewiesen",
        }
    }
}

// ---------- Status-Übergänge ----------

/// Erlaubte Status-Übergänge der Schaden-Maschine. Keine Rückwärts-Übergänge,
/// `abgeschlossen` ist terminal. Fehleingaben werden storniert, nicht zurückgerollt.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use SchadenStatus::*;
    let (Some(von), Some(nach)) = (SchadenStatus::parse(von), SchadenStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Offen => matches!(nach, Uebergeben | Abgeschlossen),
        Uebergeben => matches!(nach, Abgeschlossen),
        Abgeschlossen => false,
    }
}

/// Anzeige der Registriernummer: `S-007`.
pub fn registrier_anzeige(nr: i64) -> String {
    format!("S-{nr:03}")
}

// ---------- Anzeige-DTO ----------

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct SchadenAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: SchadenStatus,
    pub typ: SchadenTyp,
    pub ausmass: Ausmass,
    /// Gefahrenart im Vokabular der Gefahrengebiete (LLH-1115); fehlt = keine Angabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gefahrenart: Option<Gefahrentyp>,
    /// Schadensgrad nach DV 102, 5.8.4 (LLH-1115); fehlt = keine Angabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schadensgrad: Option<Schadensgrad>,
    pub ort: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub beschreibung: String,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<String>,
    pub geschaedigt_personal_id: Option<i64>,
    pub geschaedigt_organisation_id: Option<i64>,
    pub uebergeben_an: Option<String>,
    pub uebergeben_at: Option<String>,
    pub abschluss_grund: Option<AbschlussGrund>,
    pub abschluss_at: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
    pub storniert_von: Option<i64>,
    // Read-only Join-Felder (Geschädigt-Auflösung über einsatz_person):
    pub geschaedigt_registrier_nr: Option<i64>,
    pub geschaedigt_storniert_at: Option<String>,
    // Read-only Join-Felder (Geschädigt-Auflösung über einsatz_personal / organisation):
    pub geschaedigt_personal_name: Option<String>, // einsatz_personal.snap_name
    pub geschaedigt_organisation_name: Option<String>, // organisation.name
}

/// Schadenmarker für Lagekarte und Lage-Dashboard (LFH-931, `listen-projektion`): nur, was
/// Marker, Inspector und Kennzahl brauchen. Ort, Beschreibung und Geschädigte fehlen bewusst.
/// Optionale Felder wie in [`SchadenAnzeige`] als `null`: der Client leitet einen Marker auch
/// aus einer nachgeladenen vollen Zeile ab.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct SchadenMarker {
    pub id: i64,
    pub registrier_nr: i64,
    pub status: SchadenStatus,
    pub typ: SchadenTyp,
    pub ausmass: Ausmass,
    /// Bestimmt mit dem Schadensgrad das Kartenzeichen (LLH-1115); fehlt = keine Angabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gefahrenart: Option<Gefahrentyp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schadensgrad: Option<Schadensgrad>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// Zahl der Schäden gesamt und je Status zu einem Filter (LFH-1075, `schaden-liste-blaettern`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct SchadenKennzahlen {
    pub gesamt: i64,
    pub offen: i64,
    pub uebergeben: i64,
    pub abgeschlossen: i64,
}

/// Schadenauswahl für Auswahlfelder und Sprungpalette (LFH-1075, `listen-projektion`): ohne
/// Beschreibung und ohne Angaben zu Geschädigten; `frei` sagt, ob kein Geschädigter gesetzt ist.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct SchadenAuswahl {
    pub id: i64,
    pub registrier_nr: i64,
    pub status: SchadenStatus,
    pub typ: SchadenTyp,
    pub ausmass: Ausmass,
    pub ort: String,
    pub frei: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["offen", "uebergeben", "abgeschlossen"] {
            assert_eq!(SchadenStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(SchadenStatus::parse("quatsch").is_none());
    }

    #[test]
    fn typ_und_ausmass_roundtrip() {
        for s in [
            "sachschaden",
            "verkehrshindernis",
            "infrastruktur",
            "umweltschaden",
            "tierkadaver",
            "sonstige",
        ] {
            assert_eq!(SchadenTyp::parse(s).unwrap().as_str(), s);
        }
        for s in ["gering", "mittel", "gross", "katastrophal"] {
            assert_eq!(Ausmass::parse(s).unwrap().as_str(), s);
        }
    }

    #[test]
    fn schadensgrad_roundtrip_und_worte_nach_dv_102() {
        for s in ["angeschlagen", "teilzerstoert", "zerstoert"] {
            assert_eq!(Schadensgrad::parse(s).unwrap().as_str(), s);
        }
        assert!(Schadensgrad::parse("kaputt").is_none());
        assert_eq!(Schadensgrad::Teilzerstoert.etb_label(), "teilzerstört");
        assert_eq!(Schadensgrad::Zerstoert.etb_label(), "total zerstört");
    }

    #[test]
    fn abschlussgrund_roundtrip() {
        for s in ["behoben", "kein_handlungsbedarf", "abgewiesen"] {
            assert_eq!(AbschlussGrund::parse(s).unwrap().as_str(), s);
        }
        assert!(AbschlussGrund::parse("uebergabe").is_none());
    }

    #[test]
    fn etb_labels_sind_die_woerter_der_oberflaeche() {
        assert_eq!(SchadenTyp::Umweltschaden.etb_label(), "Umweltschaden");
        assert_eq!(
            SchadenTyp::Verkehrshindernis.etb_label(),
            "Verkehrshindernis"
        );
        assert_eq!(Ausmass::Gross.etb_label(), "groß");
        assert_eq!(Ausmass::Katastrophal.etb_label(), "katastrophal");
        assert_eq!(
            AbschlussGrund::KeinHandlungsbedarf.etb_label(),
            "kein Handlungsbedarf"
        );
        assert_eq!(AbschlussGrund::Behoben.etb_label(), "behoben");
    }

    #[test]
    fn uebergaenge_vorwaerts_erlaubt() {
        assert!(darf_uebergehen("offen", "uebergeben"));
        assert!(darf_uebergehen("offen", "abgeschlossen"));
        assert!(darf_uebergehen("uebergeben", "abgeschlossen"));
    }

    #[test]
    fn uebergaenge_rueckwaerts_und_terminal_verboten() {
        assert!(!darf_uebergehen("uebergeben", "offen"));
        assert!(!darf_uebergehen("abgeschlossen", "offen"));
        assert!(!darf_uebergehen("abgeschlossen", "uebergeben"));
        assert!(!darf_uebergehen("offen", "offen"));
        assert!(!darf_uebergehen("quatsch", "offen"));
    }

    #[test]
    fn registrier_anzeige_dreistellig() {
        assert_eq!(registrier_anzeige(7), "S-007");
        assert_eq!(registrier_anzeige(123), "S-123");
    }
}
