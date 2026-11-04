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

use crate::zeitdarstellung::Zeitstil;

pub mod ankuendigung;
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
/// läuft in der Route) und stehen im Text in der Rolle „Zeitpunkt“ von Zone und Darstellung des
/// Einsatzes (`zeitdarstellung::zeitstil_laden`, LLH-1476) — wie bei `lagebericht::render_snapshot`.
pub fn render_snapshot(
    stil: &Zeitstil,
    lfd_nr: i64,
    abgehalten_at: &str,
    entschluss: &str,
    naechste_at: Option<&str>,
) -> String {
    let mut out = format!(
        "Lagebesprechung Nr. {lfd_nr} ({})\n",
        stil.zeitpunkt_text(abgehalten_at)
    );
    out.push_str(&format!("Entschluss: {}\n", entschluss.trim()));
    out.push_str(&format!(
        "Nächste Lagebesprechung: {}",
        naechste_at.map_or_else(|| "kein Termin".to_string(), |t| stil.zeitpunkt_text(t))
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::nummer::ZEITZONE_VORGABE;
    use crate::zeitdarstellung::Zeitdarstellung;

    const TAKTISCH: Zeitstil = Zeitstil::new(ZEITZONE_VORGABE, Zeitdarstellung::Taktisch);

    #[test]
    fn snapshot_ist_deterministisch() {
        let a = render_snapshot(
            &TAKTISCH,
            3,
            "2026-09-12 14:30:00",
            "Lage unverändert",
            Some("2026-09-12 16:30:00"),
        );
        let b = render_snapshot(
            &TAKTISCH,
            3,
            "2026-09-12 14:30:00",
            "Lage unverändert",
            Some("2026-09-12 16:30:00"),
        );
        assert_eq!(a, b, "zweimal rendern muss gleich sein");
        assert!(a.contains("Lagebesprechung Nr. 3 (121630sep26)"), "{a}");
        assert!(a.contains("Entschluss: Lage unverändert"));
        assert!(a.contains("Nächste Lagebesprechung: 121830sep26"), "{a}");
    }

    /// LLH-1476: Abhaltezeit und Termin in Zone und Darstellung des Einsatzes, nicht als
    /// UTC-Text — taktisch wie „Datum und Uhrzeit“.
    #[test]
    fn snapshot_nennt_die_zeiten_im_zeitstil_des_einsatzes() {
        use chrono_tz::Asia::Tokyo;
        let snapshot = |darstellung| {
            render_snapshot(
                &Zeitstil::new(Tokyo, darstellung),
                2,
                "2026-09-12 14:30:00",
                "Lage unverändert",
                Some("2026-09-12 16:30:00"),
            )
        };
        assert_eq!(
            snapshot(Zeitdarstellung::Taktisch),
            "Lagebesprechung Nr. 2 (122330sep26)\nEntschluss: Lage unverändert\n\
             Nächste Lagebesprechung: 130130sep26"
        );
        assert_eq!(
            snapshot(Zeitdarstellung::DatumUhrzeit),
            "Lagebesprechung Nr. 2 (12.09.26 23:30)\nEntschluss: Lage unverändert\n\
             Nächste Lagebesprechung: 13.09.26 01:30"
        );
    }

    /// „kein Termin" ist eine AUSSAGE, keine fehlende Angabe — sie gehört in den Beleg.
    #[test]
    fn snapshot_ohne_termin_sagt_kein_termin() {
        let t = render_snapshot(
            &TAKTISCH,
            1,
            "2026-09-12 08:00:00",
            "Abschnitte bilden",
            None,
        );
        assert!(t.contains("Nächste Lagebesprechung: kein Termin"), "{t}");
    }

    #[test]
    fn snapshot_trimmt_den_entschluss() {
        let t = render_snapshot(
            &TAKTISCH,
            1,
            "2026-09-12 08:00:00",
            "  Maßnahmen fortführen  ",
            None,
        );
        assert!(t.contains("Entschluss: Maßnahmen fortführen\n"), "{t}");
    }
}
