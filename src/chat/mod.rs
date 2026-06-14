pub mod repo;

use crate::anhang::AnhangAnzeige;
use serde::Serialize;

/// Name des Default-Kanals, der pro Einsatz garantiert existiert.
pub const DEFAULT_KANAL_NAME: &str = "Allgemein";

/// Öffentliche Darstellung eines Chat-Kanals.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ChatKanalAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub name: String,
    pub beschreibung: Option<String>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    pub archiviert_at: Option<String>,
}

/// Öffentliche Darstellung einer Chat-Nachricht. `inhalt` ist `None`, wenn die
/// Nachricht gelöscht wurde (Tombstone) — der Text wird dann nicht ausgeliefert.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ChatNachrichtAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub kanal_id: i64,
    pub autor_id: i64,
    pub autor_name: String,
    pub inhalt: Option<String>,
    pub erstellt_at: String,
    pub bearbeitet_at: Option<String>,
    pub geloescht_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
    pub auftrag_id: Option<i64>,
    /// Angehängte Dateien (Metadaten, ohne Bytes). Wird nicht aus der
    /// Nachrichten-Zeile gelesen (`sqlx(skip)`), sondern vom Repo nachgeladen.
    #[sqlx(skip)]
    pub anhaenge: Vec<AnhangAnzeige>,
}
