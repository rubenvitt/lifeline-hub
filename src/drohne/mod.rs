//! Herstellerneutrale Drohnenquelle (LLH-2105): der Vertrag, den Karte und Videofenster kennen
//! ([`vertrag`]), und die reine Übersetzung der Suchlage-Schnittstelle in ihn ([`suchlage`]).
//! Nichts hieraus kommt in die Datenbank; der Stand lebt nur im Arbeitsspeicher.

pub mod suchlage;
pub mod vertrag;
