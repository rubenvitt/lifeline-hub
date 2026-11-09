//! Erklärung einer Notübernahme und ihr Beweis (design.md D6, D8).
//!
//! Die Erklärung ist ein kanonischer JSON-Text (Feldreihenfolge der Struktur). Gegen die meldende
//! Seite trägt sie einen Beweis: die Passkey-Unterschrift eines Org-Admins über ihren SHA-256
//! (`auth::unterschrift::pruefen`) oder einen Prüfwert aus dem Abgabecode, den die meldende Seite
//! erzeugt hat. Der Code selbst geht nie über die Leitung: aus ihm entsteht per HKDF ein
//! Schlüssel, gebunden an Einsatzkennung und reservierte Epoche, und der Beweis ist
//! HMAC(Schlüssel, Hash der Erklärung).

use super::Epoche;
use crate::auth::unterschrift::pruefen::{self, UnterschriftAssertion};
use crate::instanz::basis32::{b64, parse_b64};
use crate::instanz::code;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// Typ und Fassung der Erklärung.
pub const TYP_NOTUEBERNAHME: &str = "lifeline-fuehrung-notuebernahme/1";
/// Salz der Ableitung aus dem Abgabecode; trägt die Fassung des Verfahrens.
const SALZ: &[u8] = b"lifeline-fuehrung/1";

/// Erklärung einer Notübernahme (Spec „Notübernahme gegen die meldende Seite braucht
/// Admin-Unterschrift oder Code“).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotuebernahmeErklaerung {
    pub typ: String,
    /// Einsatzkennung (`<Ursprung>/<Einsatz-ID>`).
    pub einsatz: String,
    /// Org-Schlüssel der erreichten Seite.
    pub org: String,
    pub epoche_alt: Epoche,
    pub epoche_neu: Epoche,
    pub fuehrer_alt: String,
    pub fuehrer_neu: String,
    pub grund: String,
    /// UTC, `zeit::FORMAT` (ADR-0012).
    pub zeitpunkt: String,
    /// Name der erklärenden Person.
    pub unterzeichner: String,
}

impl NotuebernahmeErklaerung {
    /// Der kanonische Text, über dessen Hash unterschrieben wird.
    pub fn to_text(&self) -> String {
        serde_json::to_string(self).expect("serialisierbar")
    }

    /// Liest eine Erklärung; `None`, wenn der Text keine ist oder einen fremden Typ trägt.
    pub fn parse(text: &str) -> Option<Self> {
        serde_json::from_str::<Self>(text)
            .ok()
            .filter(|e| e.typ == TYP_NOTUEBERNAHME)
    }
}

/// Beweis einer Notübernahme gegen die meldende Seite.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "art", rename_all = "snake_case")]
pub enum FuehrungBeweis {
    /// Passkey-Unterschrift eines Admins über den Hash der Erklärung.
    Unterschrift { assertion: UnterschriftAssertion },
    /// Prüfwert aus dem Abgabecode der meldenden Seite.
    Code { pruefwert: String },
}

/// Info der Ableitung: Einsatzkennung und reservierte Epoche, mit Längenpräfixen.
fn info(einsatz: &str, epoche: &Epoche) -> Vec<u8> {
    let mut t = b"abgabe".to_vec();
    for teil in [einsatz, &epoche.zaehler.to_string(), &epoche.instanz] {
        t.extend_from_slice(&(teil.len() as u32).to_be_bytes());
        t.extend_from_slice(teil.as_bytes());
    }
    t
}

/// Schlüssel aus einem normalisierten Abgabecode, gebunden an Einsatz und reservierte Epoche.
/// HKDF (RFC 5869) mit einem Block über `code::expand_block`: dieselben Bytes wie
/// `Hkdf::expand`, aber ohne vorbelegten Ausgabepuffer (`rust/hard-coded-cryptographic-value`).
pub fn abgabe_schluessel(code: &str, einsatz: &str, epoche: &Epoche) -> [u8; 32] {
    let (prk, _) = Hkdf::<Sha256>::extract(Some(SALZ), code.as_bytes());
    code::expand_block(&prk, &info(einsatz, epoche))
}

/// Gespeicherte Form des Schlüssels (Base64url).
pub fn schluessel_text(schluessel: &[u8; 32]) -> String {
    b64(schluessel)
}

/// Liest die gespeicherte Form zurück.
pub fn parse_schluessel(text: &str) -> Option<[u8; 32]> {
    parse_b64(text)?.try_into().ok()
}

/// Prüfwert des Codes über die Erklärung.
pub fn code_pruefwert(schluessel: &[u8; 32], erklaerung: &str) -> String {
    code::pruefwert(schluessel, &pruefen::erklaerung_hash(erklaerung))
}

/// Prüft den Prüfwert in konstanter Zeit.
pub fn is_code_pruefwert_valid(schluessel: &[u8; 32], erklaerung: &str, erhalten: &str) -> bool {
    code::is_pruefwert_valid(schluessel, &pruefen::erklaerung_hash(erklaerung), erhalten)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn erklaerung() -> NotuebernahmeErklaerung {
        NotuebernahmeErklaerung {
            typ: TYP_NOTUEBERNAHME.into(),
            einsatz: "elw/7".into(),
            org: "hub/1".into(),
            epoche_alt: Epoche::neu(2, "elw"),
            epoche_neu: Epoche::neu(3, "hub"),
            fuehrer_alt: "elw".into(),
            fuehrer_neu: "hub".into(),
            grund: "ELW ohne Verbindung seit 40 min".into(),
            zeitpunkt: "2026-11-09 14:32:00".into(),
            unterzeichner: "Admin A".into(),
        }
    }

    #[test]
    fn gleiche_eingabe_ergibt_denselben_text_und_hash() {
        let a = erklaerung().to_text();
        let b = erklaerung().to_text();
        assert_eq!(a, b);
        assert_eq!(pruefen::challenge(&a), pruefen::challenge(&b));
        assert_eq!(NotuebernahmeErklaerung::parse(&a), Some(erklaerung()));
    }

    #[test]
    fn jedes_feld_aendert_den_hash() {
        let basis = pruefen::challenge(&erklaerung().to_text());
        let varianten: Vec<Box<dyn Fn(&mut NotuebernahmeErklaerung)>> = vec![
            Box::new(|e| e.einsatz = "elw/8".into()),
            Box::new(|e| e.org = "hub/2".into()),
            Box::new(|e| e.epoche_alt.zaehler = 1),
            Box::new(|e| e.epoche_neu.instanz = "elw".into()),
            Box::new(|e| e.fuehrer_alt = "x".into()),
            Box::new(|e| e.fuehrer_neu = "x".into()),
            Box::new(|e| e.grund.push('!')),
            Box::new(|e| e.zeitpunkt = "2026-11-09 14:33:00".into()),
            Box::new(|e| e.unterzeichner = "Admin B".into()),
        ];
        for aendern in varianten {
            let mut e = erklaerung();
            aendern(&mut e);
            assert_ne!(pruefen::challenge(&e.to_text()), basis);
        }
    }

    #[test]
    fn fremder_typ_ist_keine_erklaerung() {
        let mut e = erklaerung();
        e.typ = "unterschriftsschluessel-aufnahme".into();
        assert_eq!(NotuebernahmeErklaerung::parse(&e.to_text()), None);
        assert_eq!(NotuebernahmeErklaerung::parse("kein json"), None);
    }

    #[test]
    fn abgabeschluessel_haengt_an_code_einsatz_und_epoche() {
        let e = Epoche::neu(3, "elw");
        let k = abgabe_schluessel("ABCDEFGHJKMNPQRS", "elw/7", &e);
        assert_eq!(k, abgabe_schluessel("ABCDEFGHJKMNPQRS", "elw/7", &e));
        assert_ne!(k, abgabe_schluessel("ABCDEFGHJKMNPQRT", "elw/7", &e));
        assert_ne!(k, abgabe_schluessel("ABCDEFGHJKMNPQRS", "elw/8", &e));
        assert_ne!(
            k,
            abgabe_schluessel("ABCDEFGHJKMNPQRS", "elw/7", &Epoche::neu(4, "elw"))
        );
        assert_eq!(parse_schluessel(&schluessel_text(&k)), Some(k));
    }

    #[test]
    fn abgabeschluessel_gleicht_hkdf_expand_byte_fuer_byte() {
        let e = Epoche::neu(3, "elw");
        let hk = Hkdf::<Sha256>::new(Some(SALZ), b"ABCDEFGHJKMNPQRS");
        let mut erwartet = [1u8; 32];
        hk.expand(&info("elw/7", &e), &mut erwartet)
            .expect("32 Byte passen");
        assert_eq!(abgabe_schluessel("ABCDEFGHJKMNPQRS", "elw/7", &e), erwartet);
    }

    #[test]
    fn pruefwert_bindet_die_erklaerung() {
        let k = abgabe_schluessel("ABCDEFGHJKMNPQRS", "elw/7", &Epoche::neu(3, "elw"));
        let text = erklaerung().to_text();
        let pw = code_pruefwert(&k, &text);
        assert!(is_code_pruefwert_valid(&k, &text, &pw));
        let mut andere = erklaerung();
        andere.grund = "anders".into();
        assert!(!is_code_pruefwert_valid(&k, &andere.to_text(), &pw));
        let falsch = abgabe_schluessel("ABCDEFGHJKMNPQRT", "elw/7", &Epoche::neu(3, "elw"));
        assert!(!is_code_pruefwert_valid(&falsch, &text, &pw));
    }
}
