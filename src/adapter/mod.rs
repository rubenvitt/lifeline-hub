//! Adapter-Rahmen (LLH-1632/LLH-2017, ADR-0077, Design-Doc
//! `docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md`).
//!
//! Eine Anbindung an ein Fremdsystem, die Lifeline Hub selbst abruft (Divera, HiOrg, Postfach …),
//! ist ein Adapter einer [`art::AdapterArt`]. Der Rahmen trägt, was alle brauchen: Geheimnisse
//! nur verschlüsselt ([`geheimnis`]), einen Abruf im Hintergrund mit Wartezeit nach Fehlern
//! ([`lauf`], [`zustand`]), einen Weg nach draußen mit Zielschutz ([`ziel`]) und den Zustand je
//! Adapter für die Verwaltung (`routes::adapter`). Regeln: `src/AGENTS.md`, „Adapter“.

pub mod art;
pub mod arten;
pub mod geheimnis;
pub mod lauf;
pub mod live;
pub mod matrix;
pub mod matrix_art;
pub mod repo;
pub mod sipgate;
pub mod sipgate_fax_art;
pub mod threema;
pub mod smtp;
pub mod smtp_art;
pub mod ziel;
pub mod zustand;

/// Was Routen und Lauf vom Rahmen brauchen: den Geheimnisspeicher, die bekannten Arten und die
/// Matrix-Clients des Prozesses (LLH-2094; dieselben, die die Art `matrix` hält, damit Lauf und
/// Ausgangskorb einen Client je Anbindung teilen). Vorgabe: kein Schlüssel, keine Arten,
/// Matrix-Speicher unter dem Temp-Verzeichnis.
#[derive(Clone, Debug, Default)]
pub struct Rahmen {
    pub speicher: geheimnis::Geheimnisspeicher,
    pub arten: art::Verzeichnis,
    pub matrix: std::sync::Arc<matrix::Clients>,
}

impl Rahmen {
    /// Ohne eigene Matrix-Clients (Tests ohne Matrix-Art).
    pub fn new(speicher: geheimnis::Geheimnisspeicher, arten: art::Verzeichnis) -> Self {
        Rahmen {
            speicher,
            arten,
            matrix: Default::default(),
        }
    }

    /// Mit den Matrix-Clients, die auch die Art `matrix` in `arten` hält.
    pub fn mit_matrix(
        speicher: geheimnis::Geheimnisspeicher,
        arten: art::Verzeichnis,
        matrix: std::sync::Arc<matrix::Clients>,
    ) -> Self {
        Rahmen {
            speicher,
            arten,
            matrix,
        }
    }
}
