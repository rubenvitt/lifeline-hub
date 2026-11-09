//! Instanzkopplung (LLH-1490): zwei Lifeline-Hub-Instanzen, etwa ein ELW und ein öffentlicher Hub,
//! erkennen einander über je ein Ed25519-Schlüsselpaar, koppeln sich per Einmal-Code eines
//! Org-Admins und sprechen nur über signierte Nachrichten. Herleitung:
//! `openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md`
//! (D1–D12), Konzept
//! `docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`.
//!
//! Das Protokoll unterscheidet nicht zwischen Hub und ELW (Entscheidung 13): eine Kopplung kennt
//! nur ihre Richtung, also welche Seite sich meldet ([`InstanzKopplungRichtung`]).

pub mod basis32;
pub mod code;
pub mod extractor;
pub mod fuehrung;
pub mod identitaet;
pub mod melden;
pub mod repo;
pub mod signatur;
pub mod stammdaten;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Protokollversion dieser Instanz (design.md D5). Wer sie erhöht, hält die vorige im Code, bis
/// die übernächste kommt; das Schema von Melden bleibt über alle Versionen nur additiv.
pub const PROTOKOLL: u32 = 1;

/// Was zwei Instanzen mit den Protokollversionen `eigen` und `fremd` miteinander tun dürfen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protokollfenster {
    /// Abstand höchstens eins: alles.
    Voll,
    /// Abstand größer: nur Melden und Status; `veraltet` ist die ältere Seite.
    NurMelden { veraltet: Seite },
}

/// Welche Seite einer Kopplung gemeint ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Seite {
    Eigen,
    Gegenueber,
}

/// Protokollfenster N/N−1 (design.md D5).
pub fn protokollfenster(eigen: u32, fremd: u32) -> Protokollfenster {
    if eigen.abs_diff(fremd) <= 1 {
        Protokollfenster::Voll
    } else if eigen < fremd {
        Protokollfenster::NurMelden {
            veraltet: Seite::Eigen,
        }
    } else {
        Protokollfenster::NurMelden {
            veraltet: Seite::Gegenueber,
        }
    }
}

wire_enum! {
    /// Richtung einer Kopplung aus Sicht dieser Instanz (design.md D6). Die einlösende Seite meldet
    /// sich, die ausstellende wird gemeldet und baut nie selbst eine Verbindung auf.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InstanzKopplungRichtung {
        /// Diese Instanz meldet sich beim Gegenüber (sie hat dessen Code eingelöst).
        MeldetSich => "meldet_sich",
        /// Das Gegenüber meldet sich hier (es hat einen Code dieser Instanz eingelöst).
        WirdGemeldet => "wird_gemeldet",
    }
}

wire_enum! {
    /// Zustand einer Kopplung (design.md D6, D9).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InstanzKopplungZustand {
        /// Code eingelöst, die erste Meldung des Gegenübers steht noch aus (nur ausstellende Seite).
        Angebahnt => "angebahnt",
        Aktiv => "aktiv",
        /// Hier widerrufen: keine Org-Zuordnung mehr gültig.
        Widerrufen => "widerrufen",
        /// Das Gegenüber hat widerrufen und es signiert mitgeteilt.
        VomGegenueberWiderrufen => "vom_gegenueber_widerrufen",
    }
}

static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Setzt den Namen dieser Instanz einmal beim Start (`Config::instanz_anzeigename`).
pub fn set_name(name: String) {
    let _ = NAME.set(name);
}

/// Name dieser Instanz, wie gekoppelte Instanzen ihn anzeigen; ungesetzt (Tests) „Lifeline Hub“.
pub fn name() -> &'static str {
    NAME.get().map(String::as_str).unwrap_or("Lifeline Hub")
}

/// Softwarestand, den diese Instanz beim Koppeln und Melden nennt.
pub fn softwarestand() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Kennung einer Org über Instanzgrenzen (design.md D6): `organisation.id` ist nur lokal
/// eindeutig, darum mit der Instanzkennung davor.
pub fn org_kennung(instanz_kennung: &str, org_id: i64) -> String {
    format!("{instanz_kennung}/{org_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gleicher_stand_und_ein_stand_abstand_sind_voll() {
        assert_eq!(protokollfenster(3, 3), Protokollfenster::Voll);
        assert_eq!(protokollfenster(3, 2), Protokollfenster::Voll);
        assert_eq!(protokollfenster(2, 3), Protokollfenster::Voll);
    }

    #[test]
    fn zwei_staende_abstand_ist_nur_melden_mit_der_veralteten_seite() {
        assert_eq!(
            protokollfenster(3, 1),
            Protokollfenster::NurMelden {
                veraltet: Seite::Gegenueber
            }
        );
        assert_eq!(
            protokollfenster(1, 3),
            Protokollfenster::NurMelden {
                veraltet: Seite::Eigen
            }
        );
    }

    #[test]
    fn org_kennung_traegt_die_instanz() {
        assert_eq!(org_kennung("abc", 7), "abc/7");
    }
}
