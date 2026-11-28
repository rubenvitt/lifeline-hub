//! Ende-zu-Ende-Verschlüsselung für das Threema Gateway (LLH-2096, Design-Doc
//! `docs/superpowers/specs/2026-11-28-gq6qs7tg-ausgang-threema-design.md`, Abschnitt 4).
//!
//! Eine Nachricht ist Typbyte + Nutzlast + Padding nach PKCS#7 (zufällig 1–255 Bytes, so dass
//! Nutzlast und Padding mindestens 32 Bytes lang sind), verschlüsselt mit `crypto_box` (X25519,
//! XSalsa20-Poly1305) aus dem privaten Schlüssel der Anbindung und dem öffentlichen Schlüssel des
//! Empfängers, Nonce 24 Bytes zufällig. Ein Dateiblob wird mit `crypto_secretbox` unter einem
//! zufälligen Schlüssel je Datei und der festen Nonce `0x00…01` verschlüsselt, wie es das
//! Protokoll vorschreibt. Keine eigene Primitive über die Bibliotheksaufrufe hinaus; Schlüssel
//! liegen nur im Speicher und werden beim Drop genullt.

use crypto_box::aead::generic_array::GenericArray;
use crypto_box::aead::Aead;
use crypto_box::{PublicKey, SalsaBox, SecretKey};
use crypto_secretbox::{KeyInit, XSalsa20Poly1305};
use serde_json::json;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Höchstlänge eines Textes je Nachricht in Bytes (UTF-8, vor dem Verschlüsseln).
pub const TEXT_MAX: usize = 3500;

/// Typbyte einer Textnachricht.
const TYP_TEXT: u8 = 0x01;
/// Typbyte einer Dateinachricht.
const TYP_DATEI: u8 = 0x17;
/// Mindestlänge von Nutzlast und Padding zusammen.
const MIN_LAENGE: usize = 32;
/// Feste Nonce für den Blob einer Datei.
const DATEI_NONCE: [u8; 24] = {
    let mut n = [0u8; 24];
    n[23] = 1;
    n
};

/// Warum Verschlüsseln nicht ging. Trägt nie Schlüssel oder Inhalt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KryptoFehler {
    /// Kein Zufall vom Betriebssystem.
    Zufall,
    /// Die Bibliothek hat abgelehnt.
    Verschluesseln,
}

/// Der private Schlüssel einer Gateway-ID (32 Bytes); genullt beim Drop, nie ausgegeben.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct PrivaterSchluessel([u8; 32]);

impl std::fmt::Debug for PrivaterSchluessel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PrivaterSchluessel(…)")
    }
}

impl PrivaterSchluessel {
    /// Aus rohen Bytes (Tests, abgeleitete Schlüssel).
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        PrivaterSchluessel(bytes)
    }
}

/// Fehlertext für einen unlesbaren privaten Schlüssel (für die Oberfläche).
pub const PRIVATER_SCHLUESSEL_UNGUELTIG: &str =
    "Der private Schlüssel hat 64 Hex-Zeichen (wahlweise mit „private:“ davor)";

/// Liest einen privaten Schlüssel: getrimmt, wahlweise mit dem Präfix `private:` aus dem Werkzeug
/// von Threema, 64 Hex-Zeichen in beliebiger Schreibung.
pub fn parse_privater_schluessel(s: &str) -> Result<PrivaterSchluessel, &'static str> {
    let s = s.trim();
    let s = s.strip_prefix("private:").unwrap_or(s);
    let mut bytes = hex_decode(s).ok_or(PRIVATER_SCHLUESSEL_UNGUELTIG)?;
    let arr: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| PRIVATER_SCHLUESSEL_UNGUELTIG)?;
    bytes.zeroize();
    Ok(PrivaterSchluessel(arr))
}

/// Speicherform eines privaten Schlüssels: 64 Hex-Zeichen klein, ohne Präfix.
pub fn normalize_privater_schluessel(s: &str) -> Result<String, &'static str> {
    let p = parse_privater_schluessel(s)?;
    Ok(hex_encode(&p.0))
}

/// Der öffentliche Schlüssel zu einem privaten.
pub fn oeffentlicher_schluessel(p: &PrivaterSchluessel) -> [u8; 32] {
    *SecretKey::from(p.0).public_key().as_bytes()
}

/// Ein öffentlicher Schlüssel aus 64 Hex-Zeichen (Antwort des Gateways, gemerkter Schlüssel).
pub fn parse_oeffentlich_hex(s: &str) -> Option<[u8; 32]> {
    hex_decode(s.trim())?.as_slice().try_into().ok()
}

/// Was in einer Nachricht steht.
#[derive(Debug, Clone, Copy)]
pub enum Inhalt<'a> {
    Text(&'a str),
    /// Eine hochgeladene Datei; `schluessel` ist der Blob-Schlüssel aus [`verschluessele_blob`].
    Datei {
        blob_id: &'a str,
        schluessel: &'a [u8; 32],
        mime: &'a str,
        name: &'a str,
        groesse: usize,
    },
}

/// Eine verschlüsselte Nachricht für `send_e2e`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verschluesselt {
    pub nonce: [u8; 24],
    pub box_: Vec<u8>,
}

/// Typbyte und Nutzlast einer Nachricht.
fn klartext(inhalt: &Inhalt<'_>) -> (u8, Vec<u8>) {
    match inhalt {
        Inhalt::Text(t) => (TYP_TEXT, t.as_bytes().to_vec()),
        Inhalt::Datei {
            blob_id,
            schluessel,
            mime,
            name,
            groesse,
        } => {
            // `j: 1` zeigt die Datei als Bild; `i` ist dasselbe für ältere Apps.
            let j = json!({
                "b": blob_id,
                "k": hex_encode(&schluessel[..]),
                "m": mime,
                "n": name,
                "s": groesse,
                "j": 1,
                "i": 1,
            });
            (TYP_DATEI, j.to_string().into_bytes())
        }
    }
}

/// Wie viel Padding eine Nutzlast der Länge `laenge` bekommt, aus einem Zufallsbyte: 1–255, und
/// mindestens so viel, dass Nutzlast und Padding [`MIN_LAENGE`] erreichen.
fn padding_laenge(laenge: usize, zufall: u8) -> u8 {
    let min = MIN_LAENGE.saturating_sub(laenge).max(1);
    let p = (zufall as usize % 255) + 1;
    p.max(min) as u8
}

/// Verschlüsselt eine Nachricht mit zufälliger Nonce und zufälligem Padding.
pub fn verschluesseln(
    inhalt: &Inhalt<'_>,
    von: &PrivaterSchluessel,
    an: &[u8; 32],
) -> Result<Verschluesselt, KryptoFehler> {
    let mut zufall = [0u8; 25];
    getrandom::fill(&mut zufall).map_err(|_| KryptoFehler::Zufall)?;
    let mut nonce = [0u8; 24];
    nonce.copy_from_slice(&zufall[..24]);
    verschluesseln_mit(inhalt, von, an, nonce, zufall[24])
}

/// Wie [`verschluesseln`], mit gegebener Nonce und gegebenem Zufallsbyte für das Padding.
fn verschluesseln_mit(
    inhalt: &Inhalt<'_>,
    von: &PrivaterSchluessel,
    an: &[u8; 32],
    nonce: [u8; 24],
    pad_zufall: u8,
) -> Result<Verschluesselt, KryptoFehler> {
    let (typ, nutzlast) = klartext(inhalt);
    let pad = padding_laenge(nutzlast.len(), pad_zufall);
    let mut daten = Vec::with_capacity(1 + nutzlast.len() + pad as usize);
    daten.push(typ);
    daten.extend_from_slice(&nutzlast);
    daten.extend(std::iter::repeat_n(pad, pad as usize));
    let geheim = SecretKey::from(von.0);
    let kiste = SalsaBox::new(&PublicKey::from(*an), &geheim);
    let ergebnis = kiste.encrypt(GenericArray::from_slice(&nonce), daten.as_slice());
    daten.zeroize();
    let box_ = ergebnis.map_err(|_| KryptoFehler::Verschluesseln)?;
    Ok(Verschluesselt { nonce, box_ })
}

/// Verschlüsselt den Inhalt einer Datei für `upload_blob`: liefert den zufälligen Blob-Schlüssel
/// und das Chiffrat (feste Nonce `0x00…01`).
pub fn verschluessele_blob(bytes: &[u8]) -> Result<([u8; 32], Vec<u8>), KryptoFehler> {
    let mut schluessel = [0u8; 32];
    getrandom::fill(&mut schluessel).map_err(|_| KryptoFehler::Zufall)?;
    let kiste = XSalsa20Poly1305::new(GenericArray::from_slice(&schluessel));
    let chiffrat = kiste
        .encrypt(GenericArray::from_slice(&DATEI_NONCE), bytes)
        .map_err(|_| KryptoFehler::Verschluesseln)?;
    Ok((schluessel, chiffrat))
}

/// Hex klein.
pub fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}

/// Hex in beliebiger Schreibung; `None` bei ungerader Länge oder fremden Zeichen.
pub fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paar(n: u8) -> (PrivaterSchluessel, [u8; 32]) {
        let p = PrivaterSchluessel::from_bytes([n; 32]);
        let o = oeffentlicher_schluessel(&p);
        (p, o)
    }

    /// Öffnet eine Nachricht als Empfänger und liefert (Typ, Nutzlast, Padding-Länge).
    fn oeffnen(
        v: &Verschluesselt,
        empfaenger: &PrivaterSchluessel,
        absender: &[u8; 32],
    ) -> (u8, Vec<u8>, u8) {
        let kiste = SalsaBox::new(&PublicKey::from(*absender), &SecretKey::from(empfaenger.0));
        let klar = kiste
            .decrypt(GenericArray::from_slice(&v.nonce), v.box_.as_slice())
            .expect("entschlüsselbar");
        let pad = *klar.last().unwrap();
        assert!((1..=255).contains(&pad));
        let ende = klar.len() - pad as usize;
        assert!(klar[ende..].iter().all(|b| *b == pad), "PKCS#7");
        (klar[0], klar[1..ende].to_vec(), pad)
    }

    #[test]
    fn text_laesst_sich_mit_dem_gegenschluessel_oeffnen() {
        let (a, a_pub) = paar(1);
        let (b, b_pub) = paar(2);
        let v = verschluesseln(&Inhalt::Text("Hallo"), &a, &b_pub).unwrap();
        let (typ, nutzlast, pad) = oeffnen(&v, &b, &a_pub);
        assert_eq!(typ, 0x01);
        assert_eq!(nutzlast, b"Hallo");
        assert!(nutzlast.len() + pad as usize >= 32);
    }

    #[test]
    fn kurzer_text_wird_auf_mindestens_32_bytes_aufgefuellt() {
        let (a, a_pub) = paar(1);
        let (b, b_pub) = paar(2);
        for z in [0u8, 1, 254, 255] {
            let v = verschluesseln_mit(&Inhalt::Text(""), &a, &b_pub, [7; 24], z).unwrap();
            let (_, nutzlast, pad) = oeffnen(&v, &b, &a_pub);
            assert!(nutzlast.len() + pad as usize >= 32, "zufall {z}");
        }
    }

    #[test]
    fn datei_traegt_das_json_mit_j_eins() {
        let (a, a_pub) = paar(1);
        let (b, b_pub) = paar(2);
        let k = [9u8; 32];
        let inhalt = Inhalt::Datei {
            blob_id: "0123456789abcdef0123456789abcdef",
            schluessel: &k,
            mime: "image/png",
            name: "anlage-1.png",
            groesse: 1234,
        };
        let v = verschluesseln(&inhalt, &a, &b_pub).unwrap();
        let (typ, nutzlast, _) = oeffnen(&v, &b, &a_pub);
        assert_eq!(typ, 0x17);
        let j: serde_json::Value = serde_json::from_slice(&nutzlast).unwrap();
        assert_eq!(j["b"], "0123456789abcdef0123456789abcdef");
        assert_eq!(j["k"], "09".repeat(32));
        assert_eq!(j["m"], "image/png");
        assert_eq!(j["n"], "anlage-1.png");
        assert_eq!(j["s"], 1234);
        assert_eq!(j["j"], 1);
    }

    #[test]
    fn blob_ist_mit_fester_nonce_entschluesselbar() {
        let (k, c) = verschluessele_blob(b"PNG-Inhalt").unwrap();
        let mut nonce = [0u8; 24];
        nonce[23] = 1;
        let klar = XSalsa20Poly1305::new(GenericArray::from_slice(&k))
            .decrypt(GenericArray::from_slice(&nonce), c.as_slice())
            .unwrap();
        assert_eq!(klar, b"PNG-Inhalt");
        let (k2, _) = verschluessele_blob(b"PNG-Inhalt").unwrap();
        assert_ne!(k, k2, "Schlüssel je Datei neu");
    }

    #[test]
    fn nonce_ist_je_nachricht_neu() {
        let (a, _) = paar(1);
        let (_, b_pub) = paar(2);
        let x = verschluesseln(&Inhalt::Text("x"), &a, &b_pub).unwrap();
        let y = verschluesseln(&Inhalt::Text("x"), &a, &b_pub).unwrap();
        assert_ne!(x.nonce, y.nonce);
    }

    #[test]
    fn privater_schluessel_wird_gelesen() {
        let hex = "ab".repeat(32);
        for roh in [
            hex.clone(),
            format!("private:{hex}"),
            hex.to_uppercase(),
            format!("{hex}\n"),
        ] {
            assert_eq!(normalize_privater_schluessel(&roh).unwrap(), hex, "{roh:?}");
        }
        for roh in ["ab".repeat(31) + "a", "zz".repeat(32), String::new()] {
            assert_eq!(
                normalize_privater_schluessel(&roh),
                Err(PRIVATER_SCHLUESSEL_UNGUELTIG),
                "{roh:?}"
            );
        }
    }

    #[test]
    fn hex_nimmt_kein_vorzeichen() {
        assert_eq!(hex_decode("+a"), None);
        assert!(normalize_privater_schluessel(&"+a".repeat(32)).is_err());
        assert_eq!(hex_decode("0aFF"), Some(vec![0x0a, 0xff]));
    }

    #[test]
    fn debug_zeigt_keinen_schluessel() {
        let p = PrivaterSchluessel::from_bytes([0xab; 32]);
        assert!(!format!("{p:?}").contains("ab"));
    }

    #[test]
    fn fester_vektor() {
        let (a, _) = paar(1);
        let (_, b_pub) = paar(2);
        let v = verschluesseln_mit(&Inhalt::Text("Lage"), &a, &b_pub, [3; 24], 0).unwrap();
        assert_eq!(hex_encode(&v.box_), FESTER_VEKTOR);
    }

    /// Beim ersten grünen Lauf erzeugt und festgeschrieben: schlägt an, wenn sich Format,
    /// Padding oder Bibliothek still ändern.
    const FESTER_VEKTOR: &str =
        "fdc1a57acf8834514ebfbc0ae8c457b3e2671e684e0a26b2381c3a6b66b6dce7d646bca9740816f84a47af5a6e79662f0e";
}
