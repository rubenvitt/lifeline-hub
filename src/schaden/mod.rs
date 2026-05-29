pub mod repo;

use serde::Serialize;

// ---------- Status ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SchadenStatus {
    Offen,
    Uebergeben,
    Abgeschlossen,
}

impl SchadenStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchadenStatus::Offen => "offen",
            SchadenStatus::Uebergeben => "uebergeben",
            SchadenStatus::Abgeschlossen => "abgeschlossen",
        }
    }

    pub fn parse(s: &str) -> Option<SchadenStatus> {
        match s {
            "offen" => Some(SchadenStatus::Offen),
            "uebergeben" => Some(SchadenStatus::Uebergeben),
            "abgeschlossen" => Some(SchadenStatus::Abgeschlossen),
            _ => None,
        }
    }
}

// ---------- Typ ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SchadenTyp {
    Sachschaden,
    Verkehrshindernis,
    Infrastruktur,
    Umweltschaden,
    Tierkadaver,
    Sonstige,
}

impl SchadenTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchadenTyp::Sachschaden => "sachschaden",
            SchadenTyp::Verkehrshindernis => "verkehrshindernis",
            SchadenTyp::Infrastruktur => "infrastruktur",
            SchadenTyp::Umweltschaden => "umweltschaden",
            SchadenTyp::Tierkadaver => "tierkadaver",
            SchadenTyp::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<SchadenTyp> {
        match s {
            "sachschaden" => Some(SchadenTyp::Sachschaden),
            "verkehrshindernis" => Some(SchadenTyp::Verkehrshindernis),
            "infrastruktur" => Some(SchadenTyp::Infrastruktur),
            "umweltschaden" => Some(SchadenTyp::Umweltschaden),
            "tierkadaver" => Some(SchadenTyp::Tierkadaver),
            "sonstige" => Some(SchadenTyp::Sonstige),
            _ => None,
        }
    }
}

// ---------- Ausmaß ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Ausmass {
    Gering,
    Mittel,
    Gross,
    Katastrophal,
}

impl Ausmass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Ausmass::Gering => "gering",
            Ausmass::Mittel => "mittel",
            Ausmass::Gross => "gross",
            Ausmass::Katastrophal => "katastrophal",
        }
    }

    pub fn parse(s: &str) -> Option<Ausmass> {
        match s {
            "gering" => Some(Ausmass::Gering),
            "mittel" => Some(Ausmass::Mittel),
            "gross" => Some(Ausmass::Gross),
            "katastrophal" => Some(Ausmass::Katastrophal),
            _ => None,
        }
    }
}

// ---------- Abschlussgrund ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AbschlussGrund {
    Behoben,
    KeinHandlungsbedarf,
    Abgewiesen,
}

impl AbschlussGrund {
    pub fn as_str(&self) -> &'static str {
        match self {
            AbschlussGrund::Behoben => "behoben",
            AbschlussGrund::KeinHandlungsbedarf => "kein_handlungsbedarf",
            AbschlussGrund::Abgewiesen => "abgewiesen",
        }
    }

    pub fn parse(s: &str) -> Option<AbschlussGrund> {
        match s {
            "behoben" => Some(AbschlussGrund::Behoben),
            "kein_handlungsbedarf" => Some(AbschlussGrund::KeinHandlungsbedarf),
            "abgewiesen" => Some(AbschlussGrund::Abgewiesen),
            _ => None,
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

/// Ort-Kurzform für die pseudonyme ETB-Spur (max. 40 Zeichen, char-sicher).
pub fn ort_kurz(ort: &str) -> String {
    let mut kurz: String = ort.trim().chars().take(40).collect();
    if ort.trim().chars().count() > 40 {
        kurz.push('…');
    }
    kurz
}

// ---------- Anzeige-DTO ----------

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SchadenAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: String,
    pub typ: String,
    pub ausmass: String,
    pub ort: String,
    pub beschreibung: String,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<String>,
    pub uebergeben_an: Option<String>,
    pub uebergeben_at: Option<String>,
    pub abschluss_grund: Option<String>,
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
        for s in ["sachschaden", "verkehrshindernis", "infrastruktur", "umweltschaden", "tierkadaver", "sonstige"] {
            assert_eq!(SchadenTyp::parse(s).unwrap().as_str(), s);
        }
        for s in ["gering", "mittel", "gross", "katastrophal"] {
            assert_eq!(Ausmass::parse(s).unwrap().as_str(), s);
        }
    }

    #[test]
    fn abschlussgrund_roundtrip() {
        for s in ["behoben", "kein_handlungsbedarf", "abgewiesen"] {
            assert_eq!(AbschlussGrund::parse(s).unwrap().as_str(), s);
        }
        assert!(AbschlussGrund::parse("uebergabe").is_none());
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
    fn registrier_und_ort_kurz() {
        assert_eq!(registrier_anzeige(7), "S-007");
        assert_eq!(registrier_anzeige(123), "S-123");
        assert_eq!(ort_kurz("Hauptstr. 17"), "Hauptstr. 17");
        let lang = "A".repeat(50);
        assert_eq!(ort_kurz(&lang).chars().count(), 41); // 40 + Ellipsis
    }
}
