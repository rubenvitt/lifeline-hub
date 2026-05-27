pub mod audit_repo;
pub mod repo;

use serde::Serialize;

/// Administrative Status-Maschine einer Person (E‑1). E‑2 ergänzt die
/// medizinische Sichtungskategorie SK I–IV als separates Attribut auf
/// `betroffen` — diese Maschine bleibt unangetastet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PersonStatus {
    Erfasst,
    Vermisst,
    Betroffen,
    Verstorben,
    Abgemeldet,
}

impl PersonStatus {
    /// DB-/API-Stringrepräsentation. **Muss exakt dem CHECK-Constraint in
    /// `migrations/0020_einsatz_person.sql` entsprechen.**
    pub fn as_str(&self) -> &'static str {
        match self {
            PersonStatus::Erfasst => "erfasst",
            PersonStatus::Vermisst => "vermisst",
            PersonStatus::Betroffen => "betroffen",
            PersonStatus::Verstorben => "verstorben",
            PersonStatus::Abgemeldet => "abgemeldet",
        }
    }

    pub fn parse(s: &str) -> Option<PersonStatus> {
        match s {
            "erfasst" => Some(PersonStatus::Erfasst),
            "vermisst" => Some(PersonStatus::Vermisst),
            "betroffen" => Some(PersonStatus::Betroffen),
            "verstorben" => Some(PersonStatus::Verstorben),
            "abgemeldet" => Some(PersonStatus::Abgemeldet),
            _ => None,
        }
    }
}

/// Optionale Geschlechtsangabe. `unbekannt` ist ein erstklassiger Wert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Geschlecht {
    Maennlich,
    Weiblich,
    Divers,
    Unbekannt,
}

impl Geschlecht {
    pub fn as_str(&self) -> &'static str {
        match self {
            Geschlecht::Maennlich => "maennlich",
            Geschlecht::Weiblich => "weiblich",
            Geschlecht::Divers => "divers",
            Geschlecht::Unbekannt => "unbekannt",
        }
    }

    pub fn parse(s: &str) -> Option<Geschlecht> {
        match s {
            "maennlich" => Some(Geschlecht::Maennlich),
            "weiblich" => Some(Geschlecht::Weiblich),
            "divers" => Some(Geschlecht::Divers),
            "unbekannt" => Some(Geschlecht::Unbekannt),
            _ => None,
        }
    }
}

/// Ob ein Status-Übergang `von → nach` erlaubt ist. Unbekannte Werte und
/// gleichbleibender Status sind nie erlaubt. Übergänge aus terminalen Zuständen
/// (`verstorben`/`abgemeldet`) zurück in aktive sind erlaubt — als Korrektur
/// einer Fehleingabe; das Schreibrecht prüft die Route.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use PersonStatus::*;
    let (Some(von), Some(nach)) = (PersonStatus::parse(von), PersonStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Erfasst => matches!(nach, Vermisst | Betroffen | Verstorben | Abgemeldet),
        Vermisst => matches!(nach, Betroffen | Verstorben | Abgemeldet),
        Betroffen => matches!(nach, Vermisst | Verstorben | Abgemeldet),
        // Terminal: nur Korrektur zurück in aktive Zustände.
        Verstorben | Abgemeldet => matches!(nach, Erfasst | Vermisst | Betroffen),
    }
}

/// Stabile, nicht-identifizierende Anzeige der Registriernummer (z. B. `R-042`).
pub fn registrier_anzeige(nr: i64) -> String {
    format!("R-{nr:03}")
}

/// Serialisierbarer Personen-Datensatz (1:1 zur Tabelle `einsatz_person`; kein
/// `org_id`, da einsatz-scoped). Direkt aus der Zeile lesbar — kein Stamm-Join,
/// kein Snapshot wie bei Material.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PersonAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: String,
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<String>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["erfasst", "vermisst", "betroffen", "verstorben", "abgemeldet"] {
            assert_eq!(PersonStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(PersonStatus::parse("unsinn").is_none());
    }

    #[test]
    fn geschlecht_roundtrip() {
        for g in ["maennlich", "weiblich", "divers", "unbekannt"] {
            assert_eq!(Geschlecht::parse(g).unwrap().as_str(), g);
        }
        assert!(Geschlecht::parse("x").is_none());
    }

    #[test]
    fn erlaubte_uebergaenge() {
        assert!(darf_uebergehen("erfasst", "vermisst"));
        assert!(darf_uebergehen("erfasst", "betroffen"));
        assert!(darf_uebergehen("erfasst", "verstorben"));
        assert!(darf_uebergehen("erfasst", "abgemeldet"));
        assert!(darf_uebergehen("vermisst", "betroffen"));
        assert!(darf_uebergehen("betroffen", "vermisst"));
        assert!(darf_uebergehen("vermisst", "verstorben"));
        assert!(darf_uebergehen("betroffen", "verstorben"));
        assert!(darf_uebergehen("vermisst", "abgemeldet"));
        // Korrektur aus terminalen Zuständen zurück in aktive:
        assert!(darf_uebergehen("verstorben", "betroffen"));
        assert!(darf_uebergehen("abgemeldet", "erfasst"));
    }

    #[test]
    fn verbotene_uebergaenge() {
        assert!(!darf_uebergehen("erfasst", "erfasst"));
        assert!(!darf_uebergehen("betroffen", "betroffen"));
        assert!(!darf_uebergehen("vermisst", "erfasst"));
        assert!(!darf_uebergehen("betroffen", "erfasst"));
        assert!(!darf_uebergehen("verstorben", "abgemeldet"));
        assert!(!darf_uebergehen("abgemeldet", "verstorben"));
        assert!(!darf_uebergehen("erfasst", "quatsch"));
        assert!(!darf_uebergehen("quatsch", "betroffen"));
    }

    #[test]
    fn registrier_anzeige_formatiert_mit_fuehrenden_nullen() {
        assert_eq!(registrier_anzeige(42), "R-042");
        assert_eq!(registrier_anzeige(7), "R-007");
        assert_eq!(registrier_anzeige(1234), "R-1234");
    }
}
