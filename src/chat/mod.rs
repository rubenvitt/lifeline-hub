pub mod erwaehnung;
pub mod repo;

use crate::anhang::AnhangAnzeige;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Name des Default-Kanals, der pro Einsatz garantiert existiert.
pub const DEFAULT_KANAL_NAME: &str = "Allgemein";

wire_enum! {
    /// Typ des polymorphen Sachbezugs einer Nachricht (LFH-103). Code-validiert (kein
    /// DB-CHECK, analog `auftrag.prioritaet`/`meldung.status`); die Codes sind die
    /// Modulnamen der referenzierbaren Domänenobjekte. Bewusst getrennt von der
    /// Heraufstufung (`etb_eintrag_id`/`auftrag_id`): ein Bezug verweist auf ein
    /// bestehendes Objekt, eine Heraufstufung erzeugt eines.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BezugTyp {
        Schaden => "schaden",
        Uhs => "uhs",
        Person => "person",
        Lagebericht => "lagebericht",
        Meldung => "meldung",
        Auftrag => "auftrag",
    }
    sqlx = |s| format!("Ungültiger BezugTyp: {s}");
}

/// Öffentliche Darstellung eines Chat-Kanals.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ChatKanalAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub name: String,
    pub beschreibung: Option<String>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    pub archiviert_at: Option<String>,
    /// Zeitpunkt der jüngsten Nachricht im Kanal (UTC-Wireformat), falls vorhanden.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzte_nachricht_at: Option<String>,
    /// Ungelesene, nicht selbst verfasste Nachrichten für den aktuell angemeldeten Benutzer.
    pub ungelesen_anzahl: i64,
}

/// Öffentliche Darstellung einer Chat-Nachricht. `inhalt` ist `None`, wenn die
/// Nachricht gelöscht wurde (Tombstone) — der Text wird dann nicht ausgeliefert.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
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
    pub bezug_typ: Option<BezugTyp>,
    pub bezug_id: Option<i64>,
    /// Angehängte Dateien (Metadaten, ohne Bytes). Wird nicht aus der
    /// Nachrichten-Zeile gelesen (`sqlx(skip)`), sondern vom Repo nachgeladen.
    #[sqlx(skip)]
    pub anhaenge: Vec<AnhangAnzeige>,
}
