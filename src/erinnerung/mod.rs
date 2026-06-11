pub mod faelligkeit;
pub mod repo;
pub mod scheduler;

use serde::Serialize;

/// Öffentliche Darstellung einer Erinnerung. `ist_faellig` wird pro Read aus
/// `faellig_at <= jetzt` berechnet (nicht persistiert) — die Fälligkeit ist
/// damit unabhängig davon korrekt, ob/wann der Scheduler-Tick lief.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ErinnerungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub titel: String,
    pub beschreibung: Option<String>,
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
    pub empfaenger_funktion: Option<String>,
    pub bezug_typ: Option<String>,
    pub bezug_id: Option<i64>,
    pub quelle: String,
    pub status: String,
    pub erledigt_at: Option<String>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    /// Abgeleitet: `faellig_at <= jetzt` zum Zeitpunkt der Abfrage.
    pub ist_faellig: bool,
    // Geteilte Kommunikations-Achsen (LFH-84) per LEFT JOIN; Default für Zeilen
    // ohne kommunikation_status-Eintrag: Vollzug 'offen', Quittung NULL.
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
}

pub const STATUS_OFFEN: &str = "offen";
pub const STATUS_ERLEDIGT: &str = "erledigt";
pub const STATUS_QUITTIERT: &str = "quittiert";
pub const QUELLE_MANUELL: &str = "manuell";
pub const QUELLE_AUTO_FRIST: &str = "auto_frist";
