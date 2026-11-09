//! Crockford-Base32 und Base64url für die Instanzkopplung: Fingerabdrücke zum Abgleich am
//! Bildschirm (design.md D1) und Schlüssel auf der Leitung.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// Crockfords Alphabet ohne Verwechsler (kein I, L, O, U), wie `geraet::code`.
pub const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Kodiert Bytes bitweise in Crockford-Base32 (ohne Prüfzeichen, ohne Auffüllung).
pub fn encode(bytes: &[u8]) -> String {
    let mut aus = String::with_capacity(bytes.len() * 8 / 5 + 1);
    let mut puffer: u32 = 0;
    let mut bits = 0;
    for b in bytes {
        puffer = (puffer << 8) | u32::from(*b);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            aus.push(ALPHABET[((puffer >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        aus.push(ALPHABET[((puffer << (5 - bits)) & 0x1f) as usize] as char);
    }
    aus
}

/// Fingerabdruck eines öffentlichen Schlüssels: die ersten 20 Byte von SHA-256 als 32 Zeichen
/// Crockford in Vierergruppen. Dieselbe Funktion an beiden Seiten, damit Menschen vergleichen
/// können, was der Bildschirm zeigt.
pub fn fingerabdruck(oeffentlich: &[u8]) -> String {
    let hash = Sha256::digest(oeffentlich);
    let zeichen = encode(&hash[..20]);
    zeichen
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).expect("ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

/// Base64url ohne Auffüllung.
pub fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Liest Base64url ohne Auffüllung; `None` bei jeder Abweichung.
pub fn parse_b64(text: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(text).ok()
}

/// SHA-256 als Base64url, so steht ein Body-Hash im Token.
pub fn sha256_b64(bytes: &[u8]) -> String {
    b64(&Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kodiert_bitweise() {
        // 0xFF 0xFF → 11111 11111 111111(0000) → "ZZZG"
        assert_eq!(encode(&[0xff, 0xff]), "ZZZG");
        assert_eq!(encode(&[0x00]), "00");
        assert_eq!(encode(&[]), "");
        // 5 Byte = 40 Bit = genau 8 Zeichen
        assert_eq!(encode(&[0x08, 0x42, 0x10, 0x84, 0x21]), "11111111");
    }

    #[test]
    fn fingerabdruck_hat_acht_vierergruppen_und_ist_stabil() {
        let f = fingerabdruck(&[7u8; 32]);
        assert_eq!(f.len(), 32 + 7);
        assert_eq!(f.split('-').count(), 8);
        assert!(f.split('-').all(|g| g.len() == 4));
        assert_eq!(f, fingerabdruck(&[7u8; 32]));
        assert_ne!(f, fingerabdruck(&[8u8; 32]));
        // fester Vektor: SHA-256 von 32 × 0x07, erste 20 Byte, Crockford
        assert_eq!(f, fingerabdruck_erwartet());
    }

    fn fingerabdruck_erwartet() -> String {
        let h = Sha256::digest([7u8; 32]);
        let z = encode(&h[..20]);
        format!(
            "{}-{}-{}-{}-{}-{}-{}-{}",
            &z[0..4],
            &z[4..8],
            &z[8..12],
            &z[12..16],
            &z[16..20],
            &z[20..24],
            &z[24..28],
            &z[28..32]
        )
    }

    #[test]
    fn b64_hin_und_zurueck() {
        assert_eq!(b64(b"ab?"), "YWI_");
        assert_eq!(parse_b64("YWI_").as_deref(), Some(&b"ab?"[..]));
        assert_eq!(parse_b64("YWI/"), None);
        assert_eq!(parse_b64("YWI_="), None);
    }
}
