//! Gemeinsamer Kommunikations-Unterbau (LFH-84): geteilte Zustellungs- und
//! Status-Mechanik (Quittung vs. Vollzug — sauber getrennt) für die
//! Kommunikations-Module (Chat, Erinnerung, künftig Aufträge/Meldungen).
pub mod repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Vokabular-Re-Export: Single Source of Truth bleibt das ETB-Modul. Module
/// referenzieren `kommunikation::{EtbTyp, MeldeWeg}` statt eigene Vokabulare zu
/// definieren. (Funkrufname lebt fachlich an `einheit`/`fahrzeug` und wird dort
/// referenziert — kein Enum zum Re-Export.)
pub use crate::etb::{EtbTyp, MeldeWeg};

/// Objekttyp für die polymorphe Referenz `(objekt_typ, objekt_id)`.
pub const OBJEKT_CHAT_NACHRICHT: &str = "chat_nachricht";
pub const OBJEKT_ERINNERUNG: &str = "erinnerung";
pub const OBJEKT_AUFTRAG: &str = "auftrag";
pub const OBJEKT_MELDUNG: &str = "meldung";
/// Auto-Fristen einer Ablösungsschicht (LFH-635): zur Fälligkeit und 30 min vorher. Zwei
/// Bezugstypen statt einer Frist mit zwei Zeitpunkten — so deckt der partielle UNIQUE-Index
/// `idx_erinnerung_auto_bezug` beide ab, ohne dass man ihn anfasst.
pub const OBJEKT_ABLOESUNG: &str = "abloesung";
pub const OBJEKT_ABLOESUNG_VORWARNUNG: &str = "abloesung_vorwarnung";

/// Vollzug-Achse (Achse 2): Bearbeitungszustand eines Objekts.
pub const VOLLZUG_OFFEN: &str = "offen";
pub const VOLLZUG_IN_ARBEIT: &str = "in_arbeit";
pub const VOLLZUG_VOLLZOGEN: &str = "vollzogen";

wire_enum! {
    /// Geteilte Priorität für Auftrag/Meldung/Nachforderung (Schema-Anker für die OpenAPI-Union,
    /// LFH-120; TS: `AuftragPrioritaet`/`MeldungPrioritaet`/`NachforderungPrioritaet`). Wire == `prioritaet`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Prioritaet {
        Sofort => "sofort",
        Dringend => "dringend",
        Normal => "normal",
    }
    try_from = |s| format!("Ungültige Prioritaet: {s}");
}

wire_enum! {
    /// Geteilte Richtung für Auftrag/Meldung (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `richtung`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Richtung {
        Intern => "intern",
        Extern => "extern",
    }
    try_from = |s| format!("Ungültige Richtung: {s}");
}

wire_enum! {
    /// Geteilte externe Adressat-Kategorie für Nachforderung (`adressat_kategorie`) und Auftrag
    /// (`extern_kategorie`) (Schema-Anker für die OpenAPI-Union, LFH-120).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AdressatKategorie {
        Leitstelle => "leitstelle",
        NachbarEa => "nachbar_ea",
        Uebergeordnet => "uebergeordnet",
        AndereBos => "andere_bos",
    }
}

// Nullable Spalte in `AuftragEmpfaengerAnzeige.extern_kategorie`, non-null in
// `NachforderungAnzeige.adressat_kategorie` — einheitlicher Decode-Mechanismus über
// beide Verwendungen (Type/Decode direkt auf dem Enum, statt gemischt mit
// `#[sqlx(try_from = …)]`, vgl. `TierStatus` in `src/tier/mod.rs`). sqlx' Blanket-Impl
// für `Option<T>` bildet NULL → `None` transparent ab.
impl<DB: sqlx::Database> sqlx::Type<DB> for AdressatKategorie
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for AdressatKategorie
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        AdressatKategorie::parse(s)
            .ok_or_else(|| format!("Ungültige AdressatKategorie: {s}").into())
    }
}

wire_enum! {
    #[wire(ohne_serde)]
    /// Phase einer Kommunikationsliste (LFH-940): `offen` ungeblättert in fachlicher Ordnung,
    /// `abgeschlossen` seitenweise ([`Seite`]). Nur Anfrage-Parameter, nie in einer Antwort.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum ListenPhase {
        Offen => "offen",
        Abgeschlossen => "abgeschlossen",
    }
}

/// Vorgabe der Seitengröße abgeschlossener Listen; dieselbe Zahl wie im ETB.
pub const SEITE_STANDARD: i64 = crate::etb::repo::STANDARD_LIMIT;
/// Obergrenze der Seitengröße; größere Werte werden geklemmt, nicht abgelehnt (wie im ETB).
pub const SEITE_MAX: i64 = crate::etb::repo::MAX_LIMIT;

/// Cursor einer abgeschlossenen Liste: der Ordnungszeitpunkt und die Kennung des letzten
/// gelesenen Eintrags. Die Kennung bricht den Gleichstand, sonst fielen Einträge mit demselben
/// Zeitstempel zwischen zwei Seiten heraus oder kämen doppelt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZeitCursor {
    pub zeit: String,
    pub id: i64,
}

/// Eine angeforderte Seite einer abgeschlossenen Liste.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seite {
    pub vor: Option<ZeitCursor>,
    pub limit: i64,
}

/// Liest Phase, Cursor und Seitengröße aus den Anfrage-Parametern (LFH-940).
///
/// Unbekannte Phase → 400 (das Feld für sich). Ein halber Cursor oder Cursor/`limit` ohne
/// `phase=abgeschlossen` → 422 (der Zusammenhang, `src/AGENTS.md`, Statuscode-Konvention).
/// `limit` wird auf `[1, SEITE_MAX]` geklemmt. Ohne `phase=abgeschlossen` ist die Seite `None`.
pub fn phase_und_seite(
    phase: Option<&str>,
    vor_zeit: Option<&str>,
    vor_id: Option<i64>,
    limit: Option<i64>,
) -> Result<(Option<ListenPhase>, Option<Seite>), crate::error::AppError> {
    use crate::error::AppError;
    let phase = crate::routes::support::parse_enum_opt(
        ListenPhase::parse,
        phase.map(str::trim).filter(|p| !p.is_empty()),
        "Ungültige Phase",
    )?;
    let vor_zeit = vor_zeit.map(str::trim).filter(|z| !z.is_empty());
    let vor = match (vor_zeit, vor_id) {
        (Some(zeit), Some(id)) => Some(ZeitCursor {
            zeit: zeit.to_string(),
            id,
        }),
        (None, None) => None,
        _ => {
            return Err(AppError::UnprocessableEntity(
                "vor_zeit und vor_id gehören zusammen".into(),
            ))
        }
    };
    if phase != Some(ListenPhase::Abgeschlossen) {
        if vor.is_some() || limit.is_some() {
            return Err(AppError::UnprocessableEntity(
                "Blättern nur mit phase=abgeschlossen".into(),
            ));
        }
        return Ok((phase, None));
    }
    let limit = limit.unwrap_or(SEITE_STANDARD).clamp(1, SEITE_MAX);
    Ok((phase, Some(Seite { vor, limit })))
}

/// Geteilter Status eines Objekts: beide Achsen getrennt. `quittiert_at` ist die
/// Quittungs-Achse, `vollzug_status`/`vollzogen_at` die Vollzugs-Achse — beide
/// unabhängig setzbar.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct KommunikationStatus {
    pub objekt_typ: String,
    pub objekt_id: i64,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_und_seite_prueft_den_zusammenhang() {
        use crate::error::AppError;
        assert_eq!(
            phase_und_seite(None, None, None, None).unwrap(),
            (None, None)
        );
        assert_eq!(
            phase_und_seite(Some("offen"), None, None, None).unwrap(),
            (Some(ListenPhase::Offen), None)
        );
        assert!(matches!(
            phase_und_seite(Some("alle"), None, None, None),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            phase_und_seite(
                Some("abgeschlossen"),
                Some("2026-10-01 10:00:00"),
                None,
                None
            ),
            Err(AppError::UnprocessableEntity(_))
        ));
        assert!(matches!(
            phase_und_seite(Some("offen"), None, None, Some(5)),
            Err(AppError::UnprocessableEntity(_))
        ));
        let (_, seite) = phase_und_seite(Some("abgeschlossen"), None, None, Some(5000)).unwrap();
        assert_eq!(seite.unwrap().limit, SEITE_MAX);
        let (_, seite) = phase_und_seite(Some("abgeschlossen"), None, None, Some(0)).unwrap();
        assert_eq!(seite.unwrap().limit, 1);
        let (_, seite) = phase_und_seite(
            Some("abgeschlossen"),
            Some("2026-10-01 10:00:00"),
            Some(7),
            None,
        )
        .unwrap();
        let seite = seite.unwrap();
        assert_eq!(seite.limit, SEITE_STANDARD);
        assert_eq!(
            seite.vor,
            Some(ZeitCursor {
                zeit: "2026-10-01 10:00:00".into(),
                id: 7
            })
        );
    }

    #[test]
    fn vollzug_konstanten_sind_eindeutig() {
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN);
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_IN_ARBEIT);
    }

    #[test]
    fn vokabular_wird_aus_etb_referenziert() {
        assert_eq!(
            EtbTyp::Meldung.as_str(),
            crate::etb::EtbTyp::Meldung.as_str()
        );
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }

    #[test]
    fn objekt_typen_sind_eindeutig() {
        assert_ne!(OBJEKT_CHAT_NACHRICHT, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_CHAT_NACHRICHT);
        assert_ne!(OBJEKT_MELDUNG, OBJEKT_AUFTRAG);
        assert_ne!(OBJEKT_MELDUNG, OBJEKT_CHAT_NACHRICHT);
        assert_ne!(OBJEKT_MELDUNG, OBJEKT_ERINNERUNG);
    }
}
