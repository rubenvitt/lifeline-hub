//! Herstellerneutrale Drohnenquelle (LLH-2105): der Vertrag, den Karte und Videofenster kennen
//! ([`vertrag`]), und die reine Übersetzung der Suchlage-Schnittstelle in ihn ([`suchlage`]).
//! Nichts hieraus kommt in die Datenbank; der Stand lebt nur im Arbeitsspeicher.

pub mod art;
pub mod karte;
pub mod repo;
pub mod store;
pub mod suchlage;
pub mod vertrag;
pub mod video;

pub use store::Store;

/// Ob eine Adapterart einen Drohnenvertrag hat, also Drohnenbild liefert und je Einsatz
/// zuschaltbar ist.
pub fn is_drohnen_art(code: &str) -> bool {
    code == "suchlage"
}

/// Ob `s` ein sicheres einzelnes Pfadsegment ist: `[A-Za-z0-9._-]+`, aber nicht `.` oder `..`.
/// Gilt für alles aus der Quelle, das in einen Abruf-Pfad eingesetzt wird.
pub fn is_safe_segment(s: &str) -> bool {
    s != "."
        && s != ".."
        && !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::is_safe_segment;

    #[test]
    fn sicheres_segment() {
        for ok in ["RC-TEST-1", "a.b_c-d", "x..y", "index.m3u8", "...", "7"] {
            assert!(is_safe_segment(ok), "{ok}");
        }
        for schlecht in [
            "", ".", "..", "../x", "a/b", "a\\b", "a?b", "a#b", "a b", "a%2fb", "ä", "a\0b", "a\nb",
        ] {
            assert!(!is_safe_segment(schlecht), "{schlecht:?}");
        }
    }
}
