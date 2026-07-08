pub mod repo;

use crate::error::AppError;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// Eintragstyp: Meldung.
pub const TYP_MELDUNG: &str = "meldung";
/// Eintragstyp: Anordnung.
pub const TYP_ANORDNUNG: &str = "anordnung";
/// Eintragstyp: Lage.
pub const TYP_LAGE: &str = "lage";
/// Eintragstyp: Entscheidung.
pub const TYP_ENTSCHEIDUNG: &str = "entscheidung";
/// Eintragstyp: System (automatisch durch spätere Module; in T1 nicht client-erfassbar).
pub const TYP_SYSTEM: &str = "system";
/// Eintragstyp: Berichtigung (verweist auf den berichtigten Eintrag).
pub const TYP_BERICHTIGUNG: &str = "berichtigung";

/// Eintragstyp eines ETB-Eintrags. Wird als TEXT in der DB gespeichert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EtbTyp {
    Meldung,
    Anordnung,
    Lage,
    Entscheidung,
    System,
    Berichtigung,
}

impl EtbTyp {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            EtbTyp::Meldung => TYP_MELDUNG,
            EtbTyp::Anordnung => TYP_ANORDNUNG,
            EtbTyp::Lage => TYP_LAGE,
            EtbTyp::Entscheidung => TYP_ENTSCHEIDUNG,
            EtbTyp::System => TYP_SYSTEM,
            EtbTyp::Berichtigung => TYP_BERICHTIGUNG,
        }
    }

    /// Parst einen Typstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<EtbTyp> {
        match s {
            TYP_MELDUNG => Some(EtbTyp::Meldung),
            TYP_ANORDNUNG => Some(EtbTyp::Anordnung),
            TYP_LAGE => Some(EtbTyp::Lage),
            TYP_ENTSCHEIDUNG => Some(EtbTyp::Entscheidung),
            TYP_SYSTEM => Some(EtbTyp::System),
            TYP_BERICHTIGUNG => Some(EtbTyp::Berichtigung),
            _ => None,
        }
    }

    /// Ob dieser Typ eine Berichtigung ist (erfordert `berichtigt_eintrag_id`).
    pub fn ist_berichtigung(&self) -> bool {
        matches!(self, EtbTyp::Berichtigung)
    }

    /// Ob dieser Typ in T1 manuell vom Client erfasst werden darf.
    /// `system` ist Modulen vorbehalten und daher nicht client-erfassbar.
    pub fn darf_client_erfassen(&self) -> bool {
        !matches!(self, EtbTyp::System)
    }
}

/// Meldeweg eines Eintrags (optional).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MeldeWeg {
    Funk,
    Telefon,
    Persoenlich,
    Sonstige,
}

impl MeldeWeg {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            MeldeWeg::Funk => "funk",
            MeldeWeg::Telefon => "telefon",
            MeldeWeg::Persoenlich => "persoenlich",
            MeldeWeg::Sonstige => "sonstige",
        }
    }

    /// Parst einen Meldeweg-String; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<MeldeWeg> {
        match s {
            "funk" => Some(MeldeWeg::Funk),
            "telefon" => Some(MeldeWeg::Telefon),
            "persoenlich" => Some(MeldeWeg::Persoenlich),
            "sonstige" => Some(MeldeWeg::Sonstige),
            _ => None,
        }
    }
}

/// Normalisiert eine vom Client gelieferte Zeitangabe auf das SQLite-Format
/// `YYYY-MM-DD HH:MM:SS` (UTC). Akzeptiert RFC3339/ISO-8601 (z.B.
/// `2026-05-23T10:00:00Z`, wie von JS `Date.toISOString()` erzeugt) sowie das
/// SQLite-Format selbst. So bleibt die String-Sortierung nach `ereigniszeit`
/// konsistent. `Validation` (400) bei unbekanntem Format.
pub fn normalisiere_zeit(eingabe: &str) -> Result<String, AppError> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(eingabe) {
        return Ok(dt
            .with_timezone(&Utc)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string());
    }
    if let Ok(ndt) = NaiveDateTime::parse_from_str(eingabe, "%Y-%m-%d %H:%M:%S") {
        return Ok(ndt.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    Err(AppError::Validation(
        "Ungültiges Zeitformat (erwartet ISO-8601)".into(),
    ))
}

/// Öffentliche Darstellung eines ETB-Eintrags für API-Antworten und SSE.
/// `erfasser_name` ist der Anzeigename des Erfassers (per JOIN ermittelt).
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct EtbEintragAnzeige {
    pub id: i64,
    pub lfd_nr: i64,
    pub typ: String,
    pub inhalt: String,
    pub von: Option<String>,
    pub an: Option<String>,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    pub erfasser_id: i64,
    pub erfasser_name: String,
    pub ereigniszeit: String,
    pub received_at: String,
    pub erfasst_lokal_at: Option<String>,
    pub berichtigt_eintrag_id: Option<i64>,
    /// Gesetzt, wenn dieser Eintrag der Freigabe-Snapshot eines Lageberichts ist
    /// (Timeline-Badge + Rückverlinkung). Sonst `None`.
    pub lagebericht_id: Option<i64>,
    /// Rückverweis auf den auslösenden Auftrag (LFH-52), falls aus Auftrag/Vollzug erzeugt.
    pub auftrag_id: Option<i64>,
    /// Gesetzt, wenn dieser Eintrag der Freigabe-Snapshot eines Befehls ist (LFH-64). Sonst `None`.
    pub befehl_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typ_roundtrip() {
        for s in [
            TYP_MELDUNG,
            TYP_ANORDNUNG,
            TYP_LAGE,
            TYP_ENTSCHEIDUNG,
            TYP_SYSTEM,
            TYP_BERICHTIGUNG,
        ] {
            assert_eq!(EtbTyp::parse(s).unwrap().as_str(), s);
        }
        assert!(EtbTyp::parse("unsinn").is_none());
    }

    #[test]
    fn system_ist_nicht_client_erfassbar() {
        assert!(!EtbTyp::System.darf_client_erfassen());
        assert!(EtbTyp::Meldung.darf_client_erfassen());
        assert!(EtbTyp::Berichtigung.darf_client_erfassen());
    }

    #[test]
    fn berichtigung_erkannt() {
        assert!(EtbTyp::Berichtigung.ist_berichtigung());
        assert!(!EtbTyp::Meldung.ist_berichtigung());
    }

    #[test]
    fn meldeweg_roundtrip() {
        for w in [
            MeldeWeg::Funk,
            MeldeWeg::Telefon,
            MeldeWeg::Persoenlich,
            MeldeWeg::Sonstige,
        ] {
            assert_eq!(MeldeWeg::parse(w.as_str()).unwrap(), w);
        }
        assert!(MeldeWeg::parse("brieftaube").is_none());
    }

    #[test]
    fn normalisiere_rfc3339_nach_sqlite() {
        assert_eq!(
            normalisiere_zeit("2026-05-23T10:00:00Z").unwrap(),
            "2026-05-23 10:00:00"
        );
        assert_eq!(
            normalisiere_zeit("2026-05-23T12:00:00+02:00").unwrap(),
            "2026-05-23 10:00:00"
        );
    }

    #[test]
    fn normalisiere_akzeptiert_sqlite_format() {
        assert_eq!(
            normalisiere_zeit("2026-05-23 10:00:00").unwrap(),
            "2026-05-23 10:00:00"
        );
    }

    #[test]
    fn normalisiere_lehnt_unsinn_ab() {
        assert!(matches!(
            normalisiere_zeit("gestern").unwrap_err(),
            AppError::Validation(_)
        ));
    }
}
