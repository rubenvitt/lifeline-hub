//! Herstellerneutrale Drohnenquelle (LLH-2105): der Vertrag, den Karte und Videofenster kennen
//! ([`vertrag`]), und die reine Übersetzung der Suchlage-Schnittstelle in ihn ([`suchlage`]).
//! Nichts hieraus kommt in die Datenbank; der Stand lebt nur im Arbeitsspeicher.

pub mod repo;
pub mod store;
pub mod suchlage;
pub mod vertrag;

pub use store::Store;
