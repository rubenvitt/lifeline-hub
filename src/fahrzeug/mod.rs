pub mod disposition_repo;
pub mod repo;
pub mod status_repo;

use crate::staerke::Staerke;
use serde::Serialize;

/// Dienststatus im Stamm: aktiv vs. außer Dienst (Soft-Delete).
pub const DIENSTSTATUS_IN_DIENST: &str = "in_dienst";
pub const DIENSTSTATUS_AUSSER_DIENST: &str = "ausser_dienst";

/// Semantik-Kategorie eines Status-Katalog-Eintrags (feste App-Logik).
pub const KATEGORIE_VERFUEGBAR: &str = "verfuegbar";
pub const KATEGORIE_GEBUNDEN: &str = "gebunden";
pub const KATEGORIE_NICHT_VERFUEGBAR: &str = "nicht_verfuegbar";

/// Default-Status-Katalog je neu angelegter Organisation
/// (label, kategorie, fms_anker, sortier). **Muss mit dem Seed in
/// `migrations/0008_fahrzeug_status.sql` übereinstimmen.** bootstrap_admin
/// iteriert diese Liste für neue Orgs.
pub const STATUS_STARTLISTE: [(&str, &str, i64, i64); 8] = [
    ("einsatzbereit", KATEGORIE_VERFUEGBAR, 1, 10),
    ("disponiert", KATEGORIE_GEBUNDEN, 3, 20),
    ("anfahrt", KATEGORIE_GEBUNDEN, 3, 30),
    ("vor_ort", KATEGORIE_GEBUNDEN, 4, 40),
    ("transport", KATEGORIE_GEBUNDEN, 7, 50),
    ("am_ziel", KATEGORIE_GEBUNDEN, 8, 60),
    ("zurück", KATEGORIE_GEBUNDEN, 1, 70),
    ("außer Dienst", KATEGORIE_NICHT_VERFUEGBAR, 6, 80),
];

/// Ob `s` eine gültige Status-Kategorie ist (Eingabe-Validierung).
pub fn ist_gueltige_kategorie(s: &str) -> bool {
    matches!(s, KATEGORIE_VERFUEGBAR | KATEGORIE_GEBUNDEN | KATEGORIE_NICHT_VERFUEGBAR)
}

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
#[derive(Debug, Clone, Serialize)]
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
    pub dienststatus: String,
    pub angelegt_at: String,
}

/// Abgeleitete AutoComplete-Vorschläge für die Stamm-Felder (DISTINCT, org-weit).
/// Speist die Comboboxen im Fahrzeug-Formular mit bereits verwendeten Werten.
#[derive(Debug, Clone, Serialize)]
pub struct FahrzeugVorschlaege {
    pub fahrzeugtyp: Vec<String>,
    pub traegerorganisation: Vec<String>,
    pub standort: Vec<String>,
}

/// Status-Katalog-Eintrag (org-weit). `aktiv` wird nicht serialisiert
/// (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FahrzeugStatus {
    pub id: i64,
    pub label: String,
    pub kategorie: String,
    pub farbe: Option<String>,
    pub fms_anker: Option<i64>,
    pub sortier: i64,
}

/// Aufgelöste Dispositions-Anzeige: Identität nach der Auflösungsregel
/// (Live aus dem Stamm bei aktivem Einsatz + Fahrzeug in Dienst, sonst Snapshot)
/// plus aufgelöster Status.
#[derive(Debug, Clone, Serialize)]
pub struct EinsatzFahrzeugAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externes Fahrzeug (kein Stamm-Bezug).
    pub fahrzeug_id: Option<i64>,
    pub ist_adhoc: bool,
    pub funkrufname: String,
    pub kennzeichen: Option<String>,
    pub fahrzeugtyp: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
    pub status_id: Option<i64>,
    pub status_label: Option<String>,
    pub status_kategorie: Option<String>,
    pub status_farbe: Option<String>,
    pub bemerkung: Option<String>,
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
        assert_eq!(s.anzeige(), "0/1/8/9");
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
        assert_eq!(STATUS_STARTLISTE.len(), 8);
        assert!(STATUS_STARTLISTE.iter().all(|(_, k, _, _)| ist_gueltige_kategorie(k)));
    }
}
