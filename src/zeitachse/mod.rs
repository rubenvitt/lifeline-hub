//! Kräfte-Zeitachse (LFH-552): Alarmierung, Eintreffen, Ablösung und Entlassung je Einheit und
//! je Person im Einsatz.
//!
//! **Ein Ereignisprotokoll, append-only** (`einsatz_kraft_zeitachse`, Muster `br_belegung`):
//! ein Ereignis wird nie geändert, nur gestrichen. Die Zeitpunkte entstehen überwiegend aus
//! markierten Statuswechseln (`zeitachse_marke` am Katalog) und dem Fan-out der Einheit auf ihre
//! Personen, von Hand nur als Nachtrag oder Streichung.
//!
//! **Einsatzperioden werden beim Lesen gebildet** ([`perioden`]); Einsatzdauer und Ruhezeit
//! rechnet der Client gegen seine Uhr. Nichts davon wird gespeichert, und es gibt keine
//! Grenzwerte.
//!
//! Spec: `openspec/changes/lfh-552-kraefte-zeitachse/`

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

pub mod perioden;
pub mod repo;

wire_enum! {
    /// Art eines Ereignisses. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum ZeitachseArt {
        Alarmierung => "alarmierung",
        Eintreffen => "eintreffen",
        /// Nur aus dem Vollzug einer Ablösung (LFH-635), nie als Nachtrag.
        Abloesung => "abloesung",
        Entlassung => "entlassung",
    }
    try_from = |s| format!("Ungültige Zeitachsen-Art: {s}");
}

impl ZeitachseArt {
    /// Beendet eine Einsatzperiode.
    pub fn ist_ende(self) -> bool {
        matches!(self, Self::Abloesung | Self::Entlassung)
    }

    /// Wort für ETB-Texte: „eingetroffen", „alarmiert" …
    pub fn partizip(self) -> &'static str {
        match self {
            Self::Alarmierung => "alarmiert",
            Self::Eintreffen => "eingetroffen",
            Self::Abloesung => "abgelöst",
            Self::Entlassung => "entlassen",
        }
    }
}

wire_enum! {
    /// Herkunft eines Ereignisses. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum ZeitachseQuelle {
        /// Aus einem Wechsel auf einen Status mit Zeitachsen-Marke.
        Status => "status",
        /// Fan-out: mitgeschrieben vom Ereignis der Einheit der Person.
        Einheit => "einheit",
        /// Aus dem Vollzug einer Ablösung.
        Abloesung => "abloesung",
        /// Von Hand nachgetragen.
        Nachtrag => "nachtrag",
    }
    try_from = |s| format!("Ungültige Zeitachsen-Quelle: {s}");
}

wire_enum! {
    /// Zeitachsen-Marke eines Status-Katalogeintrags. Wire == `as_str()`. Keine `abloesung`:
    /// die entsteht nur aus dem Vollzug.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum ZeitachseMarke {
        Alarmierung => "alarmierung",
        Eintreffen => "eintreffen",
        Entlassung => "entlassung",
    }
    try_from = |s| format!("Ungültige Zeitachsen-Marke: {s}");
}

impl ZeitachseMarke {
    pub fn art(self) -> ZeitachseArt {
        match self {
            Self::Alarmierung => ZeitachseArt::Alarmierung,
            Self::Eintreffen => ZeitachseArt::Eintreffen,
            Self::Entlassung => ZeitachseArt::Entlassung,
        }
    }
}

/// Eine Einsatzperiode einer Kraft. Offen, solange `ende_at` fehlt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Einsatzperiode {
    /// Zeitpunkt des Ankers: die Alarmierung, ohne sie das Eintreffen.
    pub beginn_at: String,
    /// `alarmierung` oder `eintreffen`.
    pub anker: ZeitachseArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eintreffen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ende_at: Option<String>,
    /// `abloesung` oder `entlassung`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ende_art: Option<ZeitachseArt>,
}

/// Ein Ereignis, wie es die Zeitachse einer Kraft zeigt — auch gestrichen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ZeitachseEreignis {
    pub id: i64,
    pub art: ZeitachseArt,
    pub zeitpunkt_at: String,
    pub quelle: ZeitachseQuelle,
    /// Fan-out: das Ereignis der Einheit, aus dem dieses entstand.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ursprung_id: Option<i64>,
    /// Fan-out: Name der Einheit („über Einheit «…»").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ursprung_einheit_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    pub erfasst_von: i64,
    pub erfasst_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gestrichen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gestrichen_von: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streichgrund: Option<String>,
}

/// Zeitachse einer Kraft: alle Ereignisse nach Zeit (gestrichene eingeschlossen) und die
/// Perioden aus den nicht gestrichenen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ZeitachseAnzeige {
    pub ereignisse: Vec<ZeitachseEreignis>,
    pub perioden: Vec<Einsatzperiode>,
}

/// Perioden einer Einheit — Zeile der Liste für das Meldebild. Nur Einheiten mit Ereignissen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinheitPerioden {
    pub einheit_id: i64,
    pub perioden: Vec<Einsatzperiode>,
}

/// Perioden einer Person — Zeile der Liste für die Personal-Seite. Nur Personen mit
/// Ereignissen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PersonPerioden {
    pub personal_id: i64,
    pub perioden: Vec<Einsatzperiode>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_parse_rund() {
        for a in ZeitachseArt::ALLE {
            assert_eq!(ZeitachseArt::parse(a.as_str()), Some(a));
        }
        for q in ZeitachseQuelle::ALLE {
            assert_eq!(ZeitachseQuelle::parse(q.as_str()), Some(q));
        }
        for m in ZeitachseMarke::ALLE {
            assert_eq!(ZeitachseMarke::parse(m.as_str()), Some(m));
            assert_eq!(
                m.art().as_str(),
                m.as_str(),
                "Marke und Art teilen den Wire-Wert"
            );
        }
        assert_eq!(ZeitachseMarke::parse("abloesung"), None);
        assert_eq!(ZeitachseMarke::parse("pause"), None);
    }

    #[test]
    fn ende_arten() {
        assert!(ZeitachseArt::Abloesung.ist_ende());
        assert!(ZeitachseArt::Entlassung.ist_ende());
        assert!(!ZeitachseArt::Alarmierung.ist_ende());
        assert!(!ZeitachseArt::Eintreffen.ist_ende());
    }
}
