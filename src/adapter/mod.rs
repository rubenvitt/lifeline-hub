//! Adapter-Rahmen (LLH-1632/LLH-2017, ADR-0077, Design-Doc
//! `docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md`).
//!
//! Eine Anbindung an ein Fremdsystem, die Lifeline Hub selbst abruft (Divera, HiOrg, Postfach …),
//! ist ein Adapter einer [`art::AdapterArt`]. Der Rahmen trägt, was alle brauchen: Geheimnisse
//! nur verschlüsselt ([`geheimnis`]), einen Abruf im Hintergrund mit Wartezeit nach Fehlern
//! ([`lauf`], [`zustand`]), einen Weg nach draußen mit Zielschutz ([`ziel`]) und den Zustand je
//! Adapter für die Verwaltung (`routes::adapter`). Regeln: `src/AGENTS.md`, „Adapter“.

pub mod art;
pub mod geheimnis;
pub mod lauf;
pub mod live;
pub mod repo;
pub mod ziel;
pub mod zustand;

/// Was Routen und Lauf vom Rahmen brauchen: den Geheimnisspeicher und die bekannten Arten.
/// Vorgabe: kein Schlüssel, die Arten dieses Builds.
#[derive(Clone, Debug, Default)]
pub struct Rahmen {
    pub speicher: geheimnis::Geheimnisspeicher,
    pub arten: art::Verzeichnis,
}

impl Rahmen {
    pub fn new(speicher: geheimnis::Geheimnisspeicher, arten: art::Verzeichnis) -> Self {
        Rahmen { speicher, arten }
    }
}
