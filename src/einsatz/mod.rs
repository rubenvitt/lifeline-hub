pub mod berechtigung;
pub mod repo;

use serde::Serialize;

/// Einsatz-Rolle: voller Zugriff + Einsatz-Administration (anlegen/abschließen/Personen).
pub const EINSATZ_ROLLE_LEITUNG: &str = "einsatzleitung";
/// Einsatz-Rolle: voller Lese-/Schreibzugriff im Einsatz, keine Administration.
pub const EINSATZ_ROLLE_FUEHRUNG: &str = "fuehrungspersonal";
/// Einsatz-Rolle: nur lesend.
pub const EINSATZ_ROLLE_BEOBACHTER: &str = "beobachter";

/// Status eines aktiven Einsatzes.
pub const STATUS_AKTIV: &str = "aktiv";
/// Status eines abgeschlossenen (read-only) Einsatzes.
pub const STATUS_ABGESCHLOSSEN: &str = "abgeschlossen";

/// Grobklasse eines Einsatzes (DB-Spalte `einsatzart`, CHECK-validiert).
pub const EINSATZART_REALEINSATZ: &str = "realeinsatz";
pub const EINSATZART_UEBUNG: &str = "uebung";
pub const EINSATZART_SANITAETSDIENST: &str = "sanitaetsdienst";
pub const EINSATZART_BEREITSTELLUNG: &str = "bereitstellung";

/// Alle gültigen Einsatzarten (Reihenfolge = UI-Reihenfolge).
pub const EINSATZARTEN: [&str; 4] = [
    EINSATZART_REALEINSATZ,
    EINSATZART_UEBUNG,
    EINSATZART_SANITAETSDIENST,
    EINSATZART_BEREITSTELLUNG,
];

/// Ob `s` eine gültige Einsatzart ist (für die Eingabe-Validierung).
pub fn ist_gueltige_einsatzart(s: &str) -> bool {
    EINSATZARTEN.contains(&s)
}

/// Rolle einer Person innerhalb eines konkreten Einsatzes.
/// Wird als TEXT in der DB gespeichert und manuell konvertiert (kein sqlx-Enum-Decode).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EinsatzRolle {
    Einsatzleitung,
    Fuehrungspersonal,
    Beobachter,
}

impl EinsatzRolle {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            EinsatzRolle::Einsatzleitung => EINSATZ_ROLLE_LEITUNG,
            EinsatzRolle::Fuehrungspersonal => EINSATZ_ROLLE_FUEHRUNG,
            EinsatzRolle::Beobachter => EINSATZ_ROLLE_BEOBACHTER,
        }
    }

    /// Parst einen gespeicherten/übergebenen Rollenstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<EinsatzRolle> {
        match s {
            EINSATZ_ROLLE_LEITUNG => Some(EinsatzRolle::Einsatzleitung),
            EINSATZ_ROLLE_FUEHRUNG => Some(EinsatzRolle::Fuehrungspersonal),
            EINSATZ_ROLLE_BEOBACHTER => Some(EinsatzRolle::Beobachter),
            _ => None,
        }
    }

    /// Ob diese Rolle die Einsatzleitung ist (einzige Rolle mit Einsatz-Administration).
    pub fn ist_einsatzleitung(&self) -> bool {
        matches!(self, EinsatzRolle::Einsatzleitung)
    }

    /// Ob diese Rolle ETB-Einträge erfassen/berichtigen darf
    /// (Einsatzleitung und Führungspersonal; Beobachter ist nur lesend).
    pub fn darf_schreiben(&self) -> bool {
        matches!(
            self,
            EinsatzRolle::Einsatzleitung | EinsatzRolle::Fuehrungspersonal
        )
    }
}

/// Interner Einsatz-Datensatz (alle Spalten der Tabelle `einsatz`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Einsatz {
    pub id: i64,
    pub org_id: i64,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    pub begonnen_at: String,
    pub abgeschlossen_at: Option<String>,
    pub abgeschlossen_von: Option<i64>,
    pub einsatzart: String,
    pub einsatznummer_intern: Option<String>,
    pub angelegt_at: String,
    pub leitstellen_nr: Option<String>,
    pub einsatzort: Option<String>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<String>,
    pub sachverhalt: Option<String>,
    pub anzahl_betroffene_initial: Option<i64>,
}

impl Einsatz {
    /// Ob der Einsatz noch aktiv (beschreibbar) ist.
    pub fn ist_aktiv(&self) -> bool {
        self.status == STATUS_AKTIV
    }

    /// API-Darstellung inkl. der Einsatz-Rolle des abfragenden Benutzers
    /// (`None`, wenn dieser kein Mitglied ist).
    pub fn anzeige(&self, meine_rolle: Option<String>) -> EinsatzAnzeige {
        EinsatzAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung.clone(),
            stichwort: self.stichwort.clone(),
            status: self.status.clone(),
            begonnen_at: self.begonnen_at.clone(),
            abgeschlossen_at: self.abgeschlossen_at.clone(),
            abgeschlossen_von: self.abgeschlossen_von,
            einsatzart: self.einsatzart.clone(),
            einsatznummer_intern: self.einsatznummer_intern.clone(),
            angelegt_at: self.angelegt_at.clone(),
            leitstellen_nr: self.leitstellen_nr.clone(),
            einsatzort: self.einsatzort.clone(),
            einsatzort_lat: self.einsatzort_lat,
            einsatzort_lon: self.einsatzort_lon,
            meldende_stelle: self.meldende_stelle.clone(),
            sachverhalt: self.sachverhalt.clone(),
            anzahl_betroffene_initial: self.anzahl_betroffene_initial,
            meine_rolle,
        }
    }
}

/// Öffentliche Einsatz-Darstellung für API-Antworten (ohne `org_id`),
/// inklusive der Rolle des abfragenden Benutzers.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    pub begonnen_at: String,
    pub abgeschlossen_at: Option<String>,
    pub abgeschlossen_von: Option<i64>,
    pub einsatzart: String,
    pub einsatznummer_intern: Option<String>,
    pub angelegt_at: String,
    pub leitstellen_nr: Option<String>,
    pub einsatzort: Option<String>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<String>,
    pub sachverhalt: Option<String>,
    pub anzahl_betroffene_initial: Option<i64>,
    pub meine_rolle: Option<String>,
}

/// Mitglied eines Einsatzes für API-Antworten (mit Benutzer-Klartext, ohne Hash).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MitgliedAnzeige {
    pub benutzer_id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    pub einsatz_rolle: String,
    pub zugewiesen_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rolle_parse_und_as_str_roundtrip() {
        for s in [
            EINSATZ_ROLLE_LEITUNG,
            EINSATZ_ROLLE_FUEHRUNG,
            EINSATZ_ROLLE_BEOBACHTER,
        ] {
            assert_eq!(EinsatzRolle::parse(s).unwrap().as_str(), s);
        }
    }

    #[test]
    fn rolle_parse_unbekannt_ist_none() {
        assert!(EinsatzRolle::parse("chef").is_none());
    }

    #[test]
    fn ist_einsatzleitung_nur_fuer_leitung() {
        assert!(EinsatzRolle::Einsatzleitung.ist_einsatzleitung());
        assert!(!EinsatzRolle::Fuehrungspersonal.ist_einsatzleitung());
        assert!(!EinsatzRolle::Beobachter.ist_einsatzleitung());
    }

    #[test]
    fn darf_schreiben_nur_leitung_und_fuehrung() {
        assert!(EinsatzRolle::Einsatzleitung.darf_schreiben());
        assert!(EinsatzRolle::Fuehrungspersonal.darf_schreiben());
        assert!(!EinsatzRolle::Beobachter.darf_schreiben());
    }

    #[test]
    fn einsatz_ist_aktiv_spiegelt_status() {
        let mut e = Einsatz {
            id: 1,
            org_id: 1,
            bezeichnung: "Lage".into(),
            stichwort: None,
            status: STATUS_AKTIV.into(),
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
            einsatzart: EINSATZART_REALEINSATZ.into(),
            einsatznummer_intern: None,
            angelegt_at: "2026-05-23".into(),
            leitstellen_nr: None,
            einsatzort: None,
            einsatzort_lat: None,
            einsatzort_lon: None,
            meldende_stelle: None,
            sachverhalt: None,
            anzahl_betroffene_initial: None,
        };
        assert!(e.ist_aktiv());
        e.status = STATUS_ABGESCHLOSSEN.into();
        assert!(!e.ist_aktiv());
    }
}
