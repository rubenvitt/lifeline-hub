//! Ablösung von Einheiten im Einsatz (LFH-635).
//!
//! **Eine Zeile = eine Schicht einer Einheit**: Einsatzbeginn + Rhythmus → Fälligkeit,
//! geplante ablösende Einheit, Vollzug. Je Einheit läuft höchstens eine Schicht. Der
//! Rhythmus kommt als Vorgabe vom Einsatzabschnitt (`rhythmus_quelle = abschnitt`) oder als
//! eigener Wert der Einheit (`einheit`).
//!
//! **Die Einstufung wird beim Lesen berechnet**, nicht gespeichert: sie hängt an der Uhr, und
//! ein verpasster Scheduler-Tick darf sie nicht verfälschen. Der Erinnerungs-Scheduler liefert
//! nur den einmaligen Hinweis (Vorwarnung 30 min vorher, Fälligkeit).
//!
//! Spec: `openspec/changes/lfh-635-fachmodul-abloesung/`

use crate::wire_enum::wire_enum;
use crate::zeit;
use serde::Serialize;
use utoipa::ToSchema;

pub mod repo;

/// Vorwarnzeit vor der Fälligkeit (Minuten). Entspricht `KNAPP_MINUTEN` im Überblick; in v1
/// bewusst nicht einstellbar (design.md, Non-Goals).
pub const VORWARNUNG_MINUTEN: i64 = 30;

/// Obergrenze eines Rhythmus: 7 Tage in Minuten (DB-CHECK in `0114_abloesung.sql`).
pub const RHYTHMUS_MAX_MINUTEN: i64 = 10_080;

wire_enum! {
    /// Status einer Schicht. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AbloesungStatus {
        /// Die Einheit ist im Einsatz, die Ablösung steht aus.
        Laufend => "laufend",
        /// Die Ablösung ist vollzogen.
        Abgeloest => "abgeloest",
    }
    try_from = |s| format!("Ungültiger Ablösungsstatus: {s}");
}

wire_enum! {
    /// Herkunft des Rhythmus einer Schicht. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum RhythmusQuelle {
        /// Folgt der Vorgabe des Abschnitts und wandert mit, wenn sie sich ändert.
        Abschnitt => "abschnitt",
        /// Eigener Wert der Schicht; eine Änderung der Abschnittsvorgabe lässt ihn stehen.
        Einheit => "einheit",
    }
    try_from = |s| format!("Ungültige Rhythmusquelle: {s}");
}

wire_enum! {
    /// Einstufung einer laufenden Schicht gegen die aktuelle Zeit. Höchstens drei Stufen
    /// (EEMUA 191/ISA-18.2: ≤ 3 Eskalationsstufen). Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Einstufung {
        Planmaessig => "planmaessig",
        /// Fälligkeit höchstens [`VORWARNUNG_MINUTEN`] entfernt.
        Vorwarnung => "vorwarnung",
        /// Fälligkeit erreicht oder überschritten.
        Ueberfaellig => "ueberfaellig",
    }
}

/// Fälligkeit = Beginn + Rhythmus. `None` bei unparsbarem Beginn.
pub fn faelligkeit(beginn_at: &str, rhythmus_minuten: i64) -> Option<String> {
    zeit::plus_minuten(beginn_at, rhythmus_minuten)
}

/// Zeitpunkt der Vorwarnung = Fälligkeit − [`VORWARNUNG_MINUTEN`].
pub fn vorwarnzeit(faellig_at: &str) -> Option<String> {
    zeit::plus_minuten(faellig_at, -VORWARNUNG_MINUTEN)
}

/// Einstufung einer laufenden Schicht (rein, deterministisch testbar). Eine unparsbare
/// Fälligkeit gilt defensiv als überfällig: sie soll auffallen, nicht verschwinden.
pub fn einstufung(faellig_at: &str, jetzt: &str) -> Einstufung {
    match (zeit::parse(faellig_at), zeit::parse(jetzt)) {
        (Some(f), Some(j)) => {
            if f <= j {
                Einstufung::Ueberfaellig
            } else if f - j <= chrono::Duration::minutes(VORWARNUNG_MINUTEN) {
                Einstufung::Vorwarnung
            } else {
                Einstufung::Planmaessig
            }
        }
        _ => Einstufung::Ueberfaellig,
    }
}

/// Rhythmus als Text für ETB-Einträge: „6 h", „6 h 30 min", „45 min".
pub fn rhythmus_text(minuten: i64) -> String {
    let (h, m) = (minuten / 60, minuten % 60);
    match (h, m) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m} min"),
    }
}

/// Öffentliche Darstellung einer Schicht.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AbloesungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub einheit_id: i64,
    pub einheit_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_name: Option<String>,
    pub beginn_at: String,
    pub rhythmus_minuten: i64,
    pub rhythmus_quelle: RhythmusQuelle,
    pub faellig_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abloesende_einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abloesende_einheit_name: Option<String>,
    pub status: AbloesungStatus,
    /// Nur bei laufenden Schichten; berechnet gegen die Zeit der Abfrage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einstufung: Option<Einstufung>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vollzogen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vollzogen_von_id: Option<i64>,
    /// Die abgelöste Schicht, aus deren Vollzug diese hervorging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vorgaenger_id: Option<i64>,
    /// Die Folgeschicht, die beim Vollzug dieser Schicht entstand.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folgeschicht_id: Option<i64>,
    /// Der Vollzug lässt sich zurücknehmen: abgelöst, und eine Folgeschicht ist entweder
    /// nicht vorhanden oder noch unberührt (laufend).
    pub ruecknehmbar: bool,
    pub angelegt_at: String,
}

/// Rhythmus-Vorgabe eines Einsatzabschnitts.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AbloesungVorgabeAnzeige {
    pub abschnitt_id: i64,
    pub abschnitt_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rhythmus_minuten: Option<i64>,
    /// Laufende Schichten mit Einsatzstelle in diesem Abschnitt.
    pub laufende_schichten: i64,
}

/// Antwort auf einen Vollzug: die abgelöste Schicht und — mit ablösender Einheit — die
/// Folgeschicht.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AbloesungVollzugAnzeige {
    pub abgeloest: AbloesungAnzeige,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folgeschicht: Option<AbloesungAnzeige>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faelligkeit_ist_beginn_plus_rhythmus() {
        assert_eq!(
            faelligkeit("2026-09-22 09:30:00", 360).as_deref(),
            Some("2026-09-22 15:30:00")
        );
        assert_eq!(
            faelligkeit("2026-09-22 22:00:00", 180).as_deref(),
            Some("2026-09-23 01:00:00"),
            "über Mitternacht"
        );
        assert_eq!(faelligkeit("kaputt", 60), None);
    }

    #[test]
    fn vorwarnzeit_liegt_30_min_davor() {
        assert_eq!(
            vorwarnzeit("2026-09-22 15:30:00").as_deref(),
            Some("2026-09-22 15:00:00")
        );
    }

    /// Grenzfälle, die das Frontend (`abloesung/einstufung.ts`) identisch prüft.
    #[test]
    fn einstufung_grenzfaelle() {
        let f = "2026-09-22 15:30:00";
        assert_eq!(
            einstufung(f, "2026-09-22 15:30:00"),
            Einstufung::Ueberfaellig,
            "genau fällig"
        );
        assert_eq!(
            einstufung(f, "2026-09-22 15:31:00"),
            Einstufung::Ueberfaellig
        );
        assert_eq!(einstufung(f, "2026-09-22 15:29:59"), Einstufung::Vorwarnung);
        assert_eq!(
            einstufung(f, "2026-09-22 15:00:00"),
            Einstufung::Vorwarnung,
            "genau 30 min"
        );
        assert_eq!(
            einstufung(f, "2026-09-22 14:59:59"),
            Einstufung::Planmaessig,
            "30 min + 1 s"
        );
        assert_eq!(einstufung("kaputt", f), Einstufung::Ueberfaellig);
    }

    #[test]
    fn rhythmus_text_liest_sich() {
        assert_eq!(rhythmus_text(360), "6 h");
        assert_eq!(rhythmus_text(390), "6 h 30 min");
        assert_eq!(rhythmus_text(45), "45 min");
    }

    #[test]
    fn enums_parse_rund() {
        for s in [AbloesungStatus::Laufend, AbloesungStatus::Abgeloest] {
            assert_eq!(AbloesungStatus::parse(s.as_str()), Some(s));
        }
        for q in [RhythmusQuelle::Abschnitt, RhythmusQuelle::Einheit] {
            assert_eq!(RhythmusQuelle::parse(q.as_str()), Some(q));
        }
        assert_eq!(AbloesungStatus::parse("offen"), None);
    }
}
