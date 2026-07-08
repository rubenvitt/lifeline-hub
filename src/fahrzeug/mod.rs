pub mod besatzung_repo;
pub mod disposition_repo;
pub mod repo;
pub mod status_repo;

use crate::staerke::Staerke;
use serde::Serialize;
use utoipa::ToSchema;

// Geteilte Konstanten/Validierung leben jetzt neutral in `crate::katalog` und werden
// hier re-exportiert, damit Bestandscode (crate::fahrzeug::KATEGORIE_*, super::*) gilt.
pub use crate::katalog::{
    ist_gueltige_kategorie, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST,
    KATEGORIE_GEBUNDEN, KATEGORIE_NICHT_VERFUEGBAR, KATEGORIE_VERFUEGBAR,
};

/// Default-Status-Katalog je neu angelegter Organisation
/// (label, kategorie, fms_anker, sortier). **Muss mit dem Seed in
/// `migrations/0008_fahrzeug_status.sql` übereinstimmen.** bootstrap_admin
/// iteriert diese Liste für neue Orgs.
pub const STATUS_STARTLISTE: [(&str, &str, i64, i64); 10] = [
    ("1 – Frei auf Funk", KATEGORIE_VERFUEGBAR, 1, 10),
    ("2 – Frei auf Wache", KATEGORIE_VERFUEGBAR, 2, 20),
    ("3 – Auf Anfahrt", KATEGORIE_GEBUNDEN, 3, 30),
    ("4 – Am Einsatzort", KATEGORIE_GEBUNDEN, 4, 40),
    ("5 – Sprechwunsch", KATEGORIE_GEBUNDEN, 5, 50),
    ("6 – Nicht einsatzbereit", KATEGORIE_NICHT_VERFUEGBAR, 6, 60),
    ("7 – Gebunden (Transport)", KATEGORIE_GEBUNDEN, 7, 70),
    ("8 – Bedingt einsatzbereit", KATEGORIE_GEBUNDEN, 8, 80),
    ("9 – Fremdanmeldung", KATEGORIE_GEBUNDEN, 9, 90),
    ("0 – Prio. Sprechwunsch", KATEGORIE_GEBUNDEN, 0, 100),
];

/// Interner Fahrzeug-Datensatz (alle Spalten von `fahrzeug`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Fahrzeug {
    pub id: i64,
    pub org_id: i64,
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub traegerorganisation: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub standort: Option<String>,
    pub fms_issi: Option<String>,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke_fuehrer: Option<i64>,
    pub staerke_unterfuehrer: Option<i64>,
    pub staerke_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

impl Fahrzeug {
    /// Soll-Stärke als optionaler `Staerke` (alle drei gesetzt → Some, sonst None).
    pub fn staerke(&self) -> Option<Staerke> {
        match (self.staerke_fuehrer, self.staerke_unterfuehrer, self.staerke_mannschaft) {
            (Some(f), Some(u), Some(m)) => Some(Staerke::neu(f as u16, u as u16, m as u16)),
            _ => None,
        }
    }

    /// Serialisierbare Anzeige (mit aufgelöster Stärke).
    pub fn anzeige(&self) -> FahrzeugAnzeige {
        FahrzeugAnzeige {
            id: self.id,
            funkrufname: self.funkrufname.clone(),
            fahrzeugtyp: self.fahrzeugtyp.clone(),
            traegerorganisation: self.traegerorganisation.clone(),
            kennzeichen: self.kennzeichen.clone(),
            opta: self.opta.clone(),
            standort: self.standort.clone(),
            fms_issi: self.fms_issi.clone(),
            sondersignal: self.sondersignal,
            tragenkapazitaet: self.tragenkapazitaet,
            staerke: self.staerke(),
            bemerkung: self.bemerkung.clone(),
            dienststatus: self.dienststatus.clone(),
            angelegt_at: self.angelegt_at.clone(),
        }
    }
}

/// Öffentliche Fahrzeug-Darstellung (ohne `org_id`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FahrzeugAnzeige {
    pub id: i64,
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub traegerorganisation: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub standort: Option<String>,
    pub fms_issi: Option<String>,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke: Option<Staerke>,
    pub bemerkung: Option<String>,
    #[schema(value_type = crate::katalog::Dienststatus)]
    pub dienststatus: String,
    pub angelegt_at: String,
}

/// Abgeleitete AutoComplete-Vorschläge für die Stamm-Felder (DISTINCT, org-weit).
/// Speist die Comboboxen im Fahrzeug-Formular mit bereits verwendeten Werten.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FahrzeugVorschlaege {
    pub fahrzeugtyp: Vec<String>,
    pub traegerorganisation: Vec<String>,
    pub standort: Vec<String>,
}

/// Status-Katalog-Eintrag (org-weit). `aktiv` wird nicht serialisiert
/// (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct FahrzeugStatus {
    pub id: i64,
    pub label: String,
    #[schema(value_type = crate::katalog::StatusKategorie)]
    pub kategorie: String,
    pub farbe: Option<String>,
    pub fms_anker: Option<i64>,
    pub sortier: i64,
}

/// Aufgelöste Dispositions-Anzeige: Identität nach der Auflösungsregel
/// (Live aus dem Stamm bei aktivem Einsatz + Fahrzeug in Dienst, sonst Snapshot)
/// plus aufgelöster Status.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinsatzFahrzeugAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externes Fahrzeug (kein Stamm-Bezug).
    pub fahrzeug_id: Option<i64>,
    /// Zugeordnete Einheit (K&M‑3); `None` = freie, nicht zugeordnete Kraft.
    pub einheit_id: Option<i64>,
    pub ist_adhoc: bool,
    pub funkrufname: String,
    pub kennzeichen: Option<String>,
    pub fahrzeugtyp: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
    pub status_id: Option<i64>,
    pub status_label: Option<String>,
    #[schema(value_type = Option<crate::katalog::StatusKategorie>)]
    pub status_kategorie: Option<String>,
    pub status_farbe: Option<String>,
    pub bemerkung: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    /// BR‑1: aktuell bereitgestellter Bereitstellungsraum (NULL = in keinem BR).
    pub aktueller_br_id: Option<i64>,
    /// Soll-Besatzung (taktische Soll-Stärke) aus dem Stamm-Fahrzeug (LFH-9); `None` für
    /// Ad-hoc-Fahrzeuge oder unvollständig gepflegte Soll-Stärke. Das Ist berechnet das
    /// Frontend aus den Besatzungs-Positionen (orthogonal, keine Backend-Aggregation).
    pub soll_besatzung: Option<Staerke>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fahrzeug() -> Fahrzeug {
        Fahrzeug {
            id: 1,
            org_id: 1,
            funkrufname: "Florian 1".into(),
            fahrzeugtyp: Some("LF 20".into()),
            traegerorganisation: None,
            kennzeichen: None,
            opta: None,
            standort: None,
            fms_issi: None,
            sondersignal: true,
            tragenkapazitaet: None,
            staerke_fuehrer: Some(0),
            staerke_unterfuehrer: Some(1),
            staerke_mannschaft: Some(8),
            bemerkung: None,
            dienststatus: DIENSTSTATUS_IN_DIENST.into(),
            angelegt_at: "2026-05-26 10:00:00".into(),
        }
    }

    #[test]
    fn staerke_aufgeloest_wenn_vollstaendig() {
        let f = fahrzeug();
        let s = f.staerke().unwrap();
        assert_eq!(s.anzeige(), "0/1/8//9");
        assert_eq!(f.anzeige().staerke, Some(s));
    }

    #[test]
    fn staerke_none_wenn_unvollstaendig() {
        let mut f = fahrzeug();
        f.staerke_unterfuehrer = None;
        assert_eq!(f.staerke(), None);
        assert_eq!(f.anzeige().staerke, None);
    }

    #[test]
    fn kategorie_validierung() {
        assert!(ist_gueltige_kategorie("gebunden"));
        assert!(!ist_gueltige_kategorie("irgendwas"));
    }

    #[test]
    fn startliste_deckt_alle_kategorien_ab() {
        assert_eq!(STATUS_STARTLISTE.len(), 10);
        assert!(STATUS_STARTLISTE.iter().all(|(_, k, _, _)| ist_gueltige_kategorie(k)));
    }
}
