//! Herstellerneutrale Drohnenquelle (LLH-2105): der Vertrag, den Karte und Videofenster kennen
//! ([`vertrag`]), und die reine Übersetzung der Suchlage-Schnittstelle in ihn ([`suchlage`]).
//! Nichts hieraus kommt in die Datenbank; der Stand lebt nur im Arbeitsspeicher.

pub mod art;
pub mod karte;
pub mod repo;
pub mod store;
pub mod suchlage;
pub mod vertrag;

pub use store::Store;

/// Ob eine Adapterart einen Drohnenvertrag hat, also Drohnenbild liefert und je Einsatz
/// zuschaltbar ist.
pub fn is_drohnen_art(code: &str) -> bool {
    code == "suchlage"
}
