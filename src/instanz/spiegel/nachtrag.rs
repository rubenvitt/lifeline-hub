//! Mitarbeit nach einer Rückgabe an eine ältere Instanz nachtragen (LLH-2007, Design
//! `docs/superpowers/specs/2026-11-22-s110uic4-mitarbeit-nachtrag-fuehrer-design.md`).
//!
//! Ein Führer ohne die Einsatzrolle `mitarbeit` bekommt sie als `beobachter`, und der Spiegel
//! hält seine `mitarbeit` gegen das zurückkommende `beobachter` fest
//! (`uebernehmen::keep_mitarbeit`). Rüstet der Führer auf, holt dieses Modul die Rolle dort nach:
//!
//! - **Spiegel:** beim Wechsel der Fähigkeit 0 → 1 die festgehaltenen Mitarbeiten vormerken, im
//!   Abgleich schicken, quittierte löschen.
//! - **Führer:** einen Nachtrag nur unter den Bedingungen aus D4 annehmen, sonst die Zeile neu
//!   ins Log legen, damit der Spiegel dem Führer folgt.

use serde::{Deserialize, Serialize};

/// Höchstzahl Nachträge und Quittungen je Paket.
pub const NACHTRAEGE_MAX: usize = 500;
/// Längster Schlüssel einer Mitgliedschaft in Byte (`[<Einsatz>,<Konto>]` braucht höchstens 43).
pub const SCHLUESSEL_BYTES_MAX: usize = 64;

/// Ein Nachtrag im Paket, mit den Kennungen des Spiegels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MitarbeitNachtrag {
    /// Kennung der Ausgangszeile; der Führer quittiert sie.
    pub id: i64,
    /// Einsatz beim Führer (`einsatz.kennung` dort).
    pub kennung: String,
    /// Schlüssel der Mitgliedschaft beim Spiegel.
    pub schluessel: String,
    /// Schlüssel der Mitgliedschaft beim Führer, wenn der Spiegel ihn kennt (Herkunft der Zeile).
    #[serde(default)]
    pub gegen: Option<String>,
}
