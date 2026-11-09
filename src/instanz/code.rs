//! Kopplungscode der Instanzkopplung (design.md D2): 16 Zeichen Crockford-Base32 (80 Bit), 15
//! Minuten gültig, einmalig. Aus dem Code leitet HKDF-SHA256 drei Werte ab: `suche` geht über
//! die Leitung und findet den Datensatz, `k_einloeser` und `k_aussteller` binden die
//! öffentlichen Schlüssel beider Seiten an den Code. Der Code selbst geht nie über die Leitung.

use super::basis32::{b64, ALPHABET};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

/// Länge des Codes in Zeichen.
pub const LAENGE: usize = 16;
/// Gültigkeit in Minuten.
pub const GUELTIG_MINUTEN: i64 = 15;
/// Salz der Ableitung; trägt die Fassung des Verfahrens.
const SALZ: &[u8] = b"lifeline-instanzkopplung/1";

/// Erzeugt einen neuen, zufälligen Code in Normalform (ohne Trennzeichen).
pub fn generate() -> String {
    let mut bytes = [0u8; LAENGE];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|b| ALPHABET[(*b & 0x1f) as usize] as char)
        .collect()
}

/// Zur Anzeige in Vierergruppen: `ABCD-EFGH-JKMN-PQRS`.
pub fn format_anzeige(code: &str) -> String {
    code.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).expect("ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

/// Normalform wie `geraet::code::normalisiere`, aber mit [`LAENGE`] Zeichen.
pub fn normalize(eingabe: &str) -> Option<String> {
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

/// Die drei aus einem Code abgeleiteten Werte.
#[derive(Clone, PartialEq, Eq)]
pub struct Ableitung {
    /// Tabellenschlüssel, Base64url (geht über die Leitung).
    pub suche: String,
    /// Schlüssel des Prüfwerts der einlösenden Seite.
    pub k_einloeser: [u8; 32],
    /// Schlüssel des Prüfwerts der ausstellenden Seite.
    pub k_aussteller: [u8; 32],
}

impl std::fmt::Debug for Ableitung {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ableitung")
            .field("suche", &self.suche)
            .finish_non_exhaustive()
    }
}

/// Leitet aus einem normalisierten Code die drei Werte ab.
pub fn derive(code: &str) -> Ableitung {
    let (prk, _) = Hkdf::<Sha256>::extract(Some(SALZ), code.as_bytes());
    Ableitung {
        suche: b64(&expand_block(&prk, b"suche")),
        k_einloeser: expand_block(&prk, b"einloeser"),
        k_aussteller: expand_block(&prk, b"aussteller"),
    }
}

/// HKDF-Expand (RFC 5869, Abschnitt 2.3) für genau einen Block: `T(1) = HMAC(PRK, info ‖ 0x01)`,
/// dieselben Bytes wie `Hkdf::expand` mit 32 Byte Länge. Ohne vorbelegten Ausgabepuffer, den
/// CodeQL sonst als festen Schlüssel liest (`rust/hard-coded-cryptographic-value`).
pub(crate) fn expand_block(prk: &[u8], info: &[u8]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(prk).expect("jede Länge");
    mac.update(info);
    mac.update(&[1]);
    mac.finalize().into_bytes().into()
}

/// Was die einlösende Seite bindet: `suche`, ihre Kennung, ihren Schlüssel, die Org, an die sie
/// koppelt, ihren Namen und die `jti` der Anfrage. Längenpräfixe, damit keine zwei Belegungen
/// dasselbe Transkript ergeben.
pub fn transkript_einloeser(
    suche: &str,
    kennung: &str,
    schluessel_b64: &str,
    org_kennung: &str,
    org_name: &str,
    name: &str,
    jti: &str,
) -> Vec<u8> {
    let mut t = b"einloeser".to_vec();
    for teil in [
        suche,
        kennung,
        schluessel_b64,
        org_kennung,
        org_name,
        name,
        jti,
    ] {
        t.extend_from_slice(&(teil.len() as u32).to_be_bytes());
        t.extend_from_slice(teil.as_bytes());
    }
    t
}

/// Was die ausstellende Seite bindet: das Transkript der einlösenden Seite und ihre eigene
/// Kennung und ihren Schlüssel.
pub fn transkript_aussteller(transkript_e: &[u8], kennung: &str, schluessel_b64: &str) -> Vec<u8> {
    let mut t = b"aussteller".to_vec();
    t.extend_from_slice(&(transkript_e.len() as u32).to_be_bytes());
    t.extend_from_slice(transkript_e);
    for teil in [kennung, schluessel_b64] {
        t.extend_from_slice(&(teil.len() as u32).to_be_bytes());
        t.extend_from_slice(teil.as_bytes());
    }
    t
}

/// HMAC-SHA256 über `transkript` als Base64url.
pub fn pruefwert(schluessel: &[u8; 32], transkript: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(schluessel).expect("jede Länge");
    mac.update(transkript);
    b64(&mac.finalize().into_bytes())
}

/// Prüft einen Prüfwert in konstanter Zeit.
pub fn is_pruefwert_valid(schluessel: &[u8; 32], transkript: &[u8], erhalten: &str) -> bool {
    let Some(bytes) = super::basis32::parse_b64(erhalten) else {
        return false;
    };
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(schluessel).expect("jede Länge");
    mac.update(transkript);
    mac.verify_slice(&bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neuer_code_ist_normalform_mit_80_bit() {
        for _ in 0..200 {
            let c = generate();
            assert_eq!(c.len(), LAENGE);
            assert_eq!(normalize(&c).as_deref(), Some(c.as_str()));
            assert_eq!(normalize(&format_anzeige(&c)).as_deref(), Some(c.as_str()));
        }
    }

    #[test]
    fn normalisiert_eingabe() {
        assert_eq!(
            normalize("abcd-efgh jkmn-pqrs").as_deref(),
            Some("ABCDEFGHJKMNPQRS")
        );
        assert_eq!(normalize("ABCDEFGH"), None, "Gerätecode ist zu kurz");
        assert_eq!(normalize("ABCDEFGHJKMNPQRSU"), None);
        assert_eq!(format_anzeige("ABCDEFGHJKMNPQRS"), "ABCD-EFGH-JKMN-PQRS");
    }

    #[test]
    fn ableitung_ist_stabil_und_trennt_die_werte() {
        let a = derive("ABCDEFGHJKMNPQRS");
        let b = derive("ABCDEFGHJKMNPQRS");
        let c = derive("ABCDEFGHJKMNPQRT");
        assert_eq!(a, b);
        assert_ne!(a.suche, c.suche);
        assert_ne!(a.k_einloeser, a.k_aussteller);
        assert_eq!(a.suche.len(), 43);
    }

    #[test]
    fn ableitung_gleicht_hkdf_expand_byte_fuer_byte() {
        let code = "ABCDEFGHJKMNPQRS";
        let hk = Hkdf::<Sha256>::new(Some(SALZ), code.as_bytes());
        let mut erwartet = [[1u8; 32]; 3];
        for (info, puffer) in [b"suche".as_slice(), b"einloeser", b"aussteller"]
            .into_iter()
            .zip(erwartet.iter_mut())
        {
            hk.expand(info, puffer).expect("32 Byte passen");
        }
        let a = derive(code);
        assert_eq!(a.suche, b64(&erwartet[0]));
        assert_eq!(a.k_einloeser, erwartet[1]);
        assert_eq!(a.k_aussteller, erwartet[2]);
    }

    #[test]
    fn pruefwert_scheitert_an_ausgetauschtem_schluessel_und_anderem_code() {
        let a = derive("ABCDEFGHJKMNPQRS");
        let t = transkript_einloeser(
            &a.suche,
            "elw",
            "SCHLUESSEL_ELW",
            "elw/1",
            "Org",
            "ELW",
            "j",
        );
        let p = pruefwert(&a.k_einloeser, &t);
        assert!(is_pruefwert_valid(&a.k_einloeser, &t, &p));
        let getauscht = transkript_einloeser(
            &a.suche,
            "elw",
            "SCHLUESSEL_MITTE",
            "elw/1",
            "Org",
            "ELW",
            "j",
        );
        assert!(!is_pruefwert_valid(&a.k_einloeser, &getauscht, &p));
        let anderer = derive("ABCDEFGHJKMNPQRT");
        assert!(!is_pruefwert_valid(&anderer.k_einloeser, &t, &p));
        assert!(
            !is_pruefwert_valid(&a.k_aussteller, &t, &p),
            "Seiten getrennt"
        );
        assert!(!is_pruefwert_valid(&a.k_einloeser, &t, "kaputt!"));
    }

    #[test]
    fn transkript_ist_eindeutig_trotz_verschobener_grenzen() {
        assert_ne!(
            transkript_einloeser("ab", "c", "d", "e", "f", "g", "h"),
            transkript_einloeser("a", "bc", "d", "e", "f", "g", "h")
        );
    }

    #[test]
    fn debug_zeigt_keine_schluessel() {
        let a = derive("ABCDEFGHJKMNPQRS");
        let text = format!("{a:?}");
        assert!(!text.contains("k_einloeser"));
    }
}
