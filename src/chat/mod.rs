pub mod repo;

use crate::anhang::AnhangAnzeige;
use serde::Serialize;
use utoipa::ToSchema;

/// Name des Default-Kanals, der pro Einsatz garantiert existiert.
pub const DEFAULT_KANAL_NAME: &str = "Allgemein";

/// Typ des polymorphen Sachbezugs einer Nachricht (LFH-103). Code-validiert (kein
/// DB-CHECK, analog `auftrag.prioritaet`/`meldung.status`); die Codes sind die
/// Modulnamen der referenzierbaren Domänenobjekte. Bewusst getrennt von der
/// Heraufstufung (`etb_eintrag_id`/`auftrag_id`): ein Bezug verweist auf ein
/// bestehendes Objekt, eine Heraufstufung erzeugt eines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BezugTyp {
    Schaden,
    Uhs,
    Person,
    Lagebericht,
    Meldung,
    Auftrag,
}

impl BezugTyp {
    /// Parst einen Code in den Typ; `None` bei unbekanntem Code (→ Validation im Handler).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "schaden" => Some(Self::Schaden),
            "uhs" => Some(Self::Uhs),
            "person" => Some(Self::Person),
            "lagebericht" => Some(Self::Lagebericht),
            "meldung" => Some(Self::Meldung),
            "auftrag" => Some(Self::Auftrag),
            _ => None,
        }
    }

    /// Stabiler Code für Persistenz und API.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Schaden => "schaden",
            Self::Uhs => "uhs",
            Self::Person => "person",
            Self::Lagebericht => "lagebericht",
            Self::Meldung => "meldung",
            Self::Auftrag => "auftrag",
        }
    }
}

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
    /// Polymorpher Sachbezug (LFH-103): Verweis auf ein bestehendes Domänenobjekt.
    /// `None`/`None`, wenn kein Bezug gesetzt ist (both-or-neither). `bezug_typ` ist
    /// ein [`BezugTyp`]-Code, `bezug_id` die Objekt-ID im selben Einsatz.
    pub bezug_typ: Option<String>,
    pub bezug_id: Option<i64>,
    /// Angehängte Dateien (Metadaten, ohne Bytes). Wird nicht aus der
    /// Nachrichten-Zeile gelesen (`sqlx(skip)`), sondern vom Repo nachgeladen.
    #[sqlx(skip)]
    pub anhaenge: Vec<AnhangAnzeige>,
}
