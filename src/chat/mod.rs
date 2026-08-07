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

// Nullable Spalte (`bezug_typ`) — Type/Decode direkt auf dem Enum, statt
// `#[sqlx(try_from = …)]` (Orphan-Rule auf `Option<Enum>`), gleiches Muster wie
// `MeldeWeg` (`src/etb/mod.rs`); sqlx' Blanket-Impl für `Option<T>` bildet NULL →
// `None` ab.
impl<DB: sqlx::Database> sqlx::Type<DB> for BezugTyp
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for BezugTyp
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        BezugTyp::parse(s).ok_or_else(|| format!("Ungültiger BezugTyp: {s}").into())
    }
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
