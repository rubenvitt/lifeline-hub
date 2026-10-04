//! Kopplungscode (LFH-892, design.md D3): 8 Zeichen aus Crockfords Base32 ohne Verwechsler
//! (kein I, L, O, U), in der DB nur als SHA-256.

use argon2::password_hash::rand_core::{OsRng, RngCore};

/// Alphabet des Codes (Crockford-Base32).
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// Länge des Codes in Zeichen.
pub const LAENGE: usize = 8;

/// Erzeugt einen neuen, zufälligen Code.
pub fn neu() -> String {
    let mut bytes = [0u8; LAENGE];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|b| ALPHABET[(*b & 0x1f) as usize] as char)
        .collect()
}

/// Bringt eine Eingabe in die Normalform: Leerzeichen und Bindestriche fallen weg,
/// Kleinbuchstaben werden groß, die Verwechsler O→0 und I/L→1 werden aufgelöst (Crockford).
/// `None`, wenn danach nicht genau [`LAENGE`] Zeichen des Alphabets übrig sind.
pub fn normalisiere(eingabe: &str) -> Option<String> {
    let mut aus = String::with_capacity(LAENGE);
    for c in eingabe.chars() {
        let c = match c.to_ascii_uppercase() {
            ' ' | '-' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        if !c.is_ascii() || !ALPHABET.contains(&(c as u8)) {
            return None;
        }
        aus.push(c);
    }
    (aus.len() == LAENGE).then_some(aus)
}

/// SHA-256-Hex des normalisierten Codes.
pub fn hash(code: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(code.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neuer_code_ist_normalform() {
        for _ in 0..200 {
            let c = neu();
            assert_eq!(c.len(), LAENGE);
            assert_eq!(normalisiere(&c).as_deref(), Some(c.as_str()));
        }
    }

    #[test]
    fn normalisiert_eingabe() {
        assert_eq!(normalisiere("abcd-efgh").as_deref(), Some("ABCDEFGH"));
        assert_eq!(normalisiere(" o1il 2345 ").as_deref(), Some("01112345"));
        assert_eq!(normalisiere("ABCDEFG"), None, "zu kurz");
        assert_eq!(normalisiere("ABCDEFGHJ"), None, "zu lang");
        assert_eq!(normalisiere("ABCDEFGU"), None, "U gehört nicht dazu");
        assert_eq!(normalisiere("ÄBCDEFGH"), None);
    }

    #[test]
    fn hash_ist_stabil_und_unterscheidet() {
        assert_eq!(hash("ABCDEFGH"), hash("ABCDEFGH"));
        assert_ne!(hash("ABCDEFGH"), hash("ABCDEFGJ"));
        assert_eq!(hash("ABCDEFGH").len(), 64);
    }
}
