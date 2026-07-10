pub mod disposition_repo;
pub mod qualifikation_repo;
pub mod repo;
pub mod status_repo;

use crate::katalog::{
    StatusKategorie, KATEGORIE_GEBUNDEN, KATEGORIE_NICHT_VERFUEGBAR, KATEGORIE_VERFUEGBAR,
};
use serde::Serialize;
use utoipa::ToSchema;

/// Default-Qualifikations-Katalog je neu angelegter Organisation (label, sortier).
/// **Muss mit dem Seed in `migrations/0011_qualifikation.sql` übereinstimmen.**
pub const QUALIFIKATION_STARTLISTE: [(&str, i64); 9] = [
    ("Sanitäter", 10),
    ("Rettungssanitäter", 20),
    ("Notfallsanitäter", 30),
    ("Notarzt", 40),
    ("Truppführer", 50),
    ("Gruppenführer", 60),
    ("Zugführer", 70),
    ("Maschinist", 80),
    ("Sprechfunker", 90),
];

/// Default-Personal-Status-Katalog je neu angelegter Organisation
/// (label, kategorie, sortier). **Muss mit dem Seed in
/// `migrations/0012_personal_status.sql` übereinstimmen.**
pub const PERSONAL_STATUS_STARTLISTE: [(&str, &str, i64); 6] = [
    ("verfügbar", KATEGORIE_VERFUEGBAR, 10),
    ("alarmiert", KATEGORIE_GEBUNDEN, 20),
    ("auf Anfahrt", KATEGORIE_GEBUNDEN, 30),
    ("im Einsatz", KATEGORIE_GEBUNDEN, 40),
    ("Pause", KATEGORIE_NICHT_VERFUEGBAR, 50),
    ("abgemeldet", KATEGORIE_NICHT_VERFUEGBAR, 60),
];

/// Interner Personal-Datensatz (alle Spalten von `personal`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Personal {
    pub id: i64,
    pub org_id: i64,
    pub benutzer_id: Option<i64>,
    pub name: String,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    pub dienststatus: String,
    pub angelegt_at: String,
}

/// Aufgelöste Qualifikation einer Person (id + label), inkl. deaktivierter
/// Zuordnungen (deaktivierte Qualifikation bleibt in der Anzeige sichtbar).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct QualifikationRef {
    pub id: i64,
    pub label: String,
}

/// Öffentliche Personal-Darstellung (ohne `org_id`), inkl. aufgelöster Qualifikationen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PersonalAnzeige {
    pub id: i64,
    pub benutzer_id: Option<i64>,
    pub name: String,
    pub personalnummer: Option<String>,
    pub traegerorganisation: Option<String>,
    pub telefon: Option<String>,
    #[schema(value_type = Option<crate::staerke::StaerkePosition>)]
    pub staerke_position: Option<String>,
    pub bemerkung: Option<String>,
    #[schema(value_type = crate::katalog::Dienststatus)]
    pub dienststatus: String,
    pub angelegt_at: String,
    pub qualifikationen: Vec<QualifikationRef>,
}

/// Abgeleitete AutoComplete-Vorschläge für die Trägerorganisation (DISTINCT, org-weit).
/// Bewusst nur ein Feld (anders als FahrzeugVorschlaege mit drei Feldern).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PersonalVorschlaege {
    pub traegerorganisation: Vec<String>,
}

/// Qualifikations-Katalog-Eintrag (org-weit). `aktiv` wird nicht serialisiert
/// (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct Qualifikation {
    pub id: i64,
    pub label: String,
    pub sortier: i64,
}

/// Personal-Status-Katalog-Eintrag (org-weit). Schema wie `FahrzeugStatus` minus `fms_anker`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct PersonalStatus {
    pub id: i64,
    pub label: String,
    pub kategorie: StatusKategorie,
    pub farbe: Option<String>,
    pub sortier: i64,
}

/// Aufgelöste Dispositions-Anzeige: Identität nach der Auflösungsregel (Live aus dem
/// Stamm bei aktivem Einsatz + Person in Dienst, sonst Snapshot), aufgelöste
/// Stärke-Position (Dispo-Override vor Stamm-Default) und aufgelöster Status.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinsatzPersonalAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// `None` = Ad-hoc-externe Person (kein Stamm-Bezug).
    pub personal_id: Option<i64>,
    /// Zugeordnete Einheit (K&M‑3); `None` = freie, nicht zugeordnete Kraft.
    pub einheit_id: Option<i64>,
    /// Fahrzeug, dessen Besatzung die Kraft ist (LFH-9); `None` = keinem Fahrzeug zugeteilt.
    /// Unabhängig von `einheit_id` (orthogonale Zuordnung).
    pub fahrzeug_id: Option<i64>,
    pub ist_adhoc: bool,
    pub name: String,
    /// Qualifikationen/Funktion als flacher Text (Live recomposed oder Snapshot).
    pub funktion: Option<String>,
    pub traegerorganisation: Option<String>,
    #[schema(value_type = Option<crate::staerke::StaerkePosition>)]
    pub staerke_position: Option<String>,
    pub status_id: Option<i64>,
    pub status_label: Option<String>,
    pub status_kategorie: Option<StatusKategorie>,
    pub status_farbe: Option<String>,
    pub bemerkung: Option<String>,
    pub disponiert_at: String,
    pub disponiert_von: Option<i64>,
}

/// Schlanke Karten-Sicht einer Führungskraft (Einheits- oder Abschnittsführung).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct FuehrungskraftKarte {
    pub id: i64,            // einsatz_personal.id
    pub einsatz_id: i64,
    pub name: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    pub ist_einheitsfuehrer: bool,
    pub ist_abschnittsleiter: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::katalog::ist_gueltige_kategorie;

    #[test]
    fn startlisten_konsistent() {
        assert_eq!(QUALIFIKATION_STARTLISTE.len(), 9);
        assert_eq!(PERSONAL_STATUS_STARTLISTE.len(), 6);
        // Jede Seed-Kategorie ist gültig, und es gibt mindestens einen 'gebunden'-Status
        // (Initial-Status der Disposition).
        assert!(PERSONAL_STATUS_STARTLISTE.iter().all(|(_, k, _)| ist_gueltige_kategorie(k)));
        assert!(PERSONAL_STATUS_STARTLISTE.iter().any(|(_, k, _)| *k == KATEGORIE_GEBUNDEN));
    }
}
