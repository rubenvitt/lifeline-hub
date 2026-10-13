//! Lagebesprechung eines Einsatzes (LLH-1111): Termin der nächsten Besprechung, Abschluss mit
//! Entschluss und Verlauf — ein eigenes Modul unter Führung, unabhängig vom Stab.
//!
//! Bis LLH-1111 hing alles am Modul Stab (LFH-46, `src/stab/`). Die Lagebesprechung gehört aber
//! zum Führungsvorgang (FwDV 100, 3.3.3.2) und findet auch ohne Stab statt (Führungsstufe B/C).
//! Herleitung: `openspec/changes/archive/2026-10-13-llj8s2rt-lagebesprechung-eigenes-modul/design.md`.
//!
//! **Eine Terminwahrheit:** `einsatz.naechste_lagebesprechung_at`. Der Einsatzkopf liest sie für
//! alle Mitglieder (LFH-555), geschrieben wird sie nur über dieses Modul (Termin-Endpunkt oder
//! Abschluss, D3).

use serde::Serialize;
use utoipa::ToSchema;

pub mod repo;

/// Höchstlänge des Entschlusses (LLH-1111, design.md D10), wie der Auftragstext. Nicht die
/// ETB-Grenze selbst: der Snapshot setzt Nummer, Zeit und Termin davor und muss danach noch in
/// [`crate::etb::INHALT_MAX`] passen.
pub const ENTSCHLUSS_MAX: usize = 10_000;

/// Eine abgeschlossene Lagebesprechung.
///
/// Der Entschluss steht zusätzlich im ETB (`typ='entscheidung'`, `etb_eintrag_id`); die Zeile
/// trägt Nummer, Zeitpunkt und den **Snapshot** des beim Abschluss gesetzten Termins.
/// `naechste_at` ist damit Beweiswert, **keine** zweite lebende Terminwahrheit — die bleibt
/// `einsatz.naechste_lagebesprechung_at` (LFH-46, Entscheidung 11).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LagebesprechungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub lfd_nr: i64,
    pub abgehalten_at: String,
    pub entschluss: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naechste_at: Option<String>,
    pub etb_eintrag_id: i64,
    pub erfasst_von_id: i64,
    pub erfasst_at: String,
}

/// Stand der Lagebesprechung eines Einsatzes: nächster Termin, Zahl und letzte Besprechung.
///
/// `naechste_lagebesprechung_at` kommt aus `einsatz` und wird hier **mitgeliefert**. Kein zweiter
/// Speicherort: ändert sich der Termin, frischt das Live-Ereignis `einsatz` Kopf und diesen
/// Stand gemeinsam auf (LFH-555).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct LagebesprechungStand {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naechste_lagebesprechung_at: Option<String>,
    pub anzahl_lagebesprechungen: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzte_lagebesprechung: Option<LagebesprechungAnzeige>,
}

/// Rendert den ETB-Snapshot einer Lagebesprechung (LFH-46, Abschnitt 9.1 der Spec).
///
/// **Deterministisch**: zweimal gerufen ist das Ergebnis gleich — der Text ist ein
/// beweissichernder ETB-Inhalt, keine Anzeige. Leere Angaben werden ausgelassen statt als
/// „—" gerendert („nur Neuerungen"); ohne Termin steht ausdrücklich „kein Termin", weil das
/// eine Aussage ist und keine fehlende Angabe.
///
/// Die Zeiten gehen als bereits normalisierte UTC-Strings herein (`etb::normalisiere_zeit`
/// läuft in der Route) — dieselbe Arbeitsteilung wie bei `lagebericht::render_snapshot`.
pub fn render_snapshot(
    lfd_nr: i64,
    abgehalten_at: &str,
    entschluss: &str,
    naechste_at: Option<&str>,
) -> String {
    let mut out = format!("Lagebesprechung Nr. {lfd_nr} ({abgehalten_at})\n");
    out.push_str(&format!("Entschluss: {}\n", entschluss.trim()));
    out.push_str(&format!(
        "Nächste Lagebesprechung: {}",
        naechste_at.unwrap_or("kein Termin")
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_ist_deterministisch() {
        let a = render_snapshot(
            3,
            "2026-09-12 14:30:00",
            "Lage unverändert",
            Some("2026-09-12 16:30:00"),
        );
        let b = render_snapshot(
            3,
            "2026-09-12 14:30:00",
            "Lage unverändert",
            Some("2026-09-12 16:30:00"),
        );
        assert_eq!(a, b, "zweimal rendern muss gleich sein");
        assert!(a.contains("Lagebesprechung Nr. 3 (2026-09-12 14:30:00)"));
        assert!(a.contains("Entschluss: Lage unverändert"));
        assert!(a.contains("Nächste Lagebesprechung: 2026-09-12 16:30:00"));
    }

    /// „kein Termin" ist eine AUSSAGE, keine fehlende Angabe — sie gehört in den Beleg.
    #[test]
    fn snapshot_ohne_termin_sagt_kein_termin() {
        let t = render_snapshot(1, "2026-09-12 08:00:00", "Abschnitte bilden", None);
        assert!(t.contains("Nächste Lagebesprechung: kein Termin"), "{t}");
    }

    #[test]
    fn snapshot_trimmt_den_entschluss() {
        let t = render_snapshot(1, "2026-09-12 08:00:00", "  Maßnahmen fortführen  ", None);
        assert!(t.contains("Entschluss: Maßnahmen fortführen\n"), "{t}");
    }
}
