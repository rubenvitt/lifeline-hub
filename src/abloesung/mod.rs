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

use chrono::NaiveDateTime;
use serde::Serialize;
use utoipa::ToSchema;

pub mod repo;

/// Vorwarnzeit vor der Fälligkeit (Minuten). Entspricht `KNAPP_MINUTEN` im Überblick; in v1
/// bewusst nicht einstellbar (design.md, Non-Goals).
pub const VORWARNUNG_MINUTEN: i64 = 30;

/// Obergrenze eines Rhythmus: 7 Tage in Minuten (DB-CHECK in `0111_abloesung.sql`).
pub const RHYTHMUS_MAX_MINUTEN: i64 = 10_080;

/// Status einer Schicht. Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AbloesungStatus {
    /// Die Einheit ist im Einsatz, die Ablösung steht aus.
    Laufend,
    /// Die Ablösung ist vollzogen.
    Abgeloest,
}

impl AbloesungStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AbloesungStatus::Laufend => "laufend",
            AbloesungStatus::Abgeloest => "abgeloest",
        }
    }

    pub fn parse(s: &str) -> Option<AbloesungStatus> {
        match s {
            "laufend" => Some(AbloesungStatus::Laufend),
            "abgeloest" => Some(AbloesungStatus::Abgeloest),
            _ => None,
        }
    }
}

impl TryFrom<String> for AbloesungStatus {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        AbloesungStatus::parse(&s).ok_or_else(|| format!("Ungültiger Ablösungsstatus: {s}"))
    }
}

/// Herkunft des Rhythmus einer Schicht. Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RhythmusQuelle {
    /// Folgt der Vorgabe des Abschnitts und wandert mit, wenn sie sich ändert.
    Abschnitt,
    /// Eigener Wert der Schicht; eine Änderung der Abschnittsvorgabe lässt ihn stehen.
    Einheit,
}

impl RhythmusQuelle {
    pub fn as_str(&self) -> &'static str {
        match self {
            RhythmusQuelle::Abschnitt => "abschnitt",
            RhythmusQuelle::Einheit => "einheit",
        }
    }

    pub fn parse(s: &str) -> Option<RhythmusQuelle> {
        match s {
            "abschnitt" => Some(RhythmusQuelle::Abschnitt),
            "einheit" => Some(RhythmusQuelle::Einheit),
            _ => None,
        }
    }
}

impl TryFrom<String> for RhythmusQuelle {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        RhythmusQuelle::parse(&s).ok_or_else(|| format!("Ungültige Rhythmusquelle: {s}"))
    }
}

/// Einstufung einer laufenden Schicht gegen die aktuelle Zeit. Höchstens drei Stufen
/// (EEMUA 191/ISA-18.2: ≤ 3 Eskalationsstufen). Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Einstufung {
    Planmaessig,
    /// Fälligkeit höchstens [`VORWARNUNG_MINUTEN`] entfernt.
    Vorwarnung,
    /// Fälligkeit erreicht oder überschritten.
    Ueberfaellig,
}

impl Einstufung {
    pub fn as_str(&self) -> &'static str {
        match self {
            Einstufung::Planmaessig => "planmaessig",
            Einstufung::Vorwarnung => "vorwarnung",
            Einstufung::Ueberfaellig => "ueberfaellig",
        }
    }
}

/// Parst einen DB-Zeitstempel (`YYYY-MM-DD HH:MM:SS`, UTC).
pub fn parse_zeit(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok()
}

/// Formatiert einen Zeitpunkt im DB-Format.
pub fn fmt_zeit(t: NaiveDateTime) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Fälligkeit = Beginn + Rhythmus. `None` bei unparsbarem Beginn.
pub fn faelligkeit(beginn_at: &str, rhythmus_minuten: i64) -> Option<String> {
    parse_zeit(beginn_at).map(|b| fmt_zeit(b + chrono::Duration::minutes(rhythmus_minuten)))
}

/// Zeitpunkt der Vorwarnung = Fälligkeit − [`VORWARNUNG_MINUTEN`].
pub fn vorwarnzeit(faellig_at: &str) -> Option<String> {
    parse_zeit(faellig_at).map(|f| fmt_zeit(f - chrono::Duration::minutes(VORWARNUNG_MINUTEN)))
}

/// Einstufung einer laufenden Schicht (rein, deterministisch testbar). Eine unparsbare
/// Fälligkeit gilt defensiv als überfällig: sie soll auffallen, nicht verschwinden.
pub fn einstufung(faellig_at: &str, jetzt: &str) -> Einstufung {
    match (parse_zeit(faellig_at), parse_zeit(jetzt)) {
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
