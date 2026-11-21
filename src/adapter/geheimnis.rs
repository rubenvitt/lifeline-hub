//! Geheimnisspeicher der Adapter (LLH-2017, ADR-0077, Design-Doc „Geheimnisspeicher“).
//!
//! Ein Geheimnis (Accesskey, API-Key, Passwort) liegt nur als age-Chiffrat in
//! `adapter_geheimnis`, verschlüsselt an den Empfänger des privaten Schlüssels aus
//! `LIFELINE_GEHEIMNIS_SCHLUESSEL`. Jede Zeile trägt den Fingerabdruck dieses Empfängers; so ist
//! erkennbar, ob ein Chiffrat zum geladenen Schlüssel passt, ohne es zu öffnen. Klartext gibt es
//! nur als [`SecretString`] im Lauf, direkt vor einem Abruf; die API liest keine Geheimnisse.
//!
//! Ver- und Entschlüsseln rechnen; Aufrufer im async-Kontext rufen es über `spawn_blocking`
//! (wie ADR-0051).

use std::fmt;
use std::str::FromStr;
use std::sync::Arc;

use age::secrecy::{ExposeSecret, SecretString};
use sha2::{Digest, Sha256};

/// Höchstlänge eines Geheimnisses in Zeichen (gespiegelt in `frontend/src/api/eingabegrenzen.ts`).
pub const GEHEIMNIS_MAX: usize = 4096;

/// Der private Schlüssel des Speichers, wie er aus der Umgebung kommt. `Debug` zeigt ihn nie.
#[derive(Clone)]
pub struct GeheimnisSchluessel(age::x25519::Identity);

impl fmt::Debug for GeheimnisSchluessel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("\"***\"")
    }
}

/// Warum ein Wert kein Schlüssel für den Speicher ist. Nennt den Wert nie.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchluesselFehler(pub &'static str);

impl fmt::Display for SchluesselFehler {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl FromStr for GeheimnisSchluessel {
    type Err = SchluesselFehler;

    fn from_str(wert: &str) -> Result<Self, Self::Err> {
        let wert = wert.trim();
        if wert.is_empty() {
            return Err(SchluesselFehler("leer"));
        }
        if wert.to_ascii_lowercase().starts_with("age1") {
            return Err(SchluesselFehler(
                "das ist ein öffentlicher age-Schlüssel; hier steht der private \
                 (AGE-SECRET-KEY-1…, aus age-keygen)",
            ));
        }
        age::x25519::Identity::from_str(wert)
            .map(GeheimnisSchluessel)
            .map_err(|_| {
                SchluesselFehler("kein privater age-Schlüssel (AGE-SECRET-KEY-1…, aus age-keygen)")
            })
    }
}

impl GeheimnisSchluessel {
    /// Ein frischer Schlüssel (für Tests und Werkzeuge).
    pub fn generate() -> Self {
        GeheimnisSchluessel(age::x25519::Identity::generate())
    }

    /// Der Schlüssel in der Form, in der er in die Umgebung gehört (für Tests und Werkzeuge).
    pub fn to_secret_string(&self) -> SecretString {
        self.0.to_string()
    }
}

/// Fingerabdruck eines Empfängers: die ersten 16 Hex-Zeichen von SHA-256 über `age1…`.
pub fn fingerabdruck_von(empfaenger: &age::x25519::Recipient) -> String {
    Sha256::digest(empfaenger.to_string().as_bytes())
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Ein Geheimnis ließ sich nicht öffnen: anderer Schlüssel, kein Schlüssel oder kaputt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unlesbar;

/// Ohne Schlüssel lässt sich nichts verschlüsseln.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeinSchluessel;

/// Der Speicher: der geladene Schlüssel oder keiner. Billig zu klonen.
#[derive(Clone, Default)]
pub struct Geheimnisspeicher(Option<Arc<Geladen>>);

struct Geladen {
    identitaet: age::x25519::Identity,
    empfaenger: age::x25519::Recipient,
    fingerabdruck: String,
}

impl fmt::Debug for Geheimnisspeicher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.fingerabdruck() {
            Some(fp) => write!(f, "Geheimnisspeicher({fp})"),
            None => f.write_str("Geheimnisspeicher(ohne Schlüssel)"),
        }
    }
}

impl Geheimnisspeicher {
    pub fn new(schluessel: Option<GeheimnisSchluessel>) -> Self {
        Geheimnisspeicher(schluessel.map(|GeheimnisSchluessel(identitaet)| {
            let empfaenger = identitaet.to_public();
            let fingerabdruck = fingerabdruck_von(&empfaenger);
            Arc::new(Geladen {
                identitaet,
                empfaenger,
                fingerabdruck,
            })
        }))
    }

    /// Fingerabdruck des geladenen Schlüssels; `None` ohne Schlüssel.
    pub fn fingerabdruck(&self) -> Option<&str> {
        self.0.as_deref().map(|g| g.fingerabdruck.as_str())
    }

    pub fn has_schluessel(&self) -> bool {
        self.0.is_some()
    }

    /// Verschlüsselt an den eigenen Empfänger; liefert Chiffrat und Fingerabdruck.
    pub fn encrypt(&self, wert: &SecretString) -> Result<(Vec<u8>, String), KeinSchluessel> {
        let g = self.0.as_deref().ok_or(KeinSchluessel)?;
        let chiffrat = age::encrypt(&g.empfaenger, wert.expose_secret().as_bytes())
            .map_err(|_| KeinSchluessel)?;
        Ok((chiffrat, g.fingerabdruck.clone()))
    }

    /// Öffnet ein Chiffrat, wenn sein Fingerabdruck zum geladenen Schlüssel passt.
    pub fn decrypt(&self, chiffrat: &[u8], fingerabdruck: &str) -> Result<SecretString, Unlesbar> {
        let g = self.0.as_deref().ok_or(Unlesbar)?;
        if g.fingerabdruck != fingerabdruck {
            return Err(Unlesbar);
        }
        let klartext = age::decrypt(&g.identitaet, chiffrat).map_err(|_| Unlesbar)?;
        String::from_utf8(klartext)
            .map(SecretString::from)
            .map_err(|_| Unlesbar)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wert(s: &str) -> SecretString {
        SecretString::from(s.to_string())
    }

    #[test]
    fn rundreise_mit_demselben_schluessel() {
        let speicher = Geheimnisspeicher::new(Some(GeheimnisSchluessel::generate()));
        let (chiffrat, fp) = speicher.encrypt(&wert("accesskey-123")).unwrap();
        assert!(!chiffrat
            .windows(b"accesskey-123".len())
            .any(|w| w == b"accesskey-123"));
        let zurueck = speicher.decrypt(&chiffrat, &fp).unwrap();
        assert_eq!(zurueck.expose_secret(), "accesskey-123");
    }

    #[test]
    fn fremder_schluessel_oeffnet_nichts() {
        let a = Geheimnisspeicher::new(Some(GeheimnisSchluessel::generate()));
        let b = Geheimnisspeicher::new(Some(GeheimnisSchluessel::generate()));
        let (chiffrat, fp) = a.encrypt(&wert("x")).unwrap();
        assert_eq!(b.decrypt(&chiffrat, &fp).unwrap_err(), Unlesbar);
        // Auch mit „passendem“ Fingerabdruck öffnet ein fremder Schlüssel nichts.
        let fp_b = b.fingerabdruck().unwrap().to_string();
        assert_eq!(b.decrypt(&chiffrat, &fp_b).unwrap_err(), Unlesbar);
    }

    #[test]
    fn ohne_schluessel_weder_schreiben_noch_lesen() {
        let leer = Geheimnisspeicher::default();
        assert!(!leer.has_schluessel());
        assert_eq!(leer.encrypt(&wert("x")), Err(KeinSchluessel));
        assert_eq!(
            leer.decrypt(b"egal", "0000000000000000").unwrap_err(),
            Unlesbar
        );
    }

    #[test]
    fn fingerabdruck_ist_stabil_und_kurz() {
        let s = GeheimnisSchluessel::generate();
        let a = Geheimnisspeicher::new(Some(s.clone()));
        let b = Geheimnisspeicher::new(Some(s));
        assert_eq!(a.fingerabdruck(), b.fingerabdruck());
        let fp = a.fingerabdruck().unwrap();
        assert_eq!(fp.len(), 16);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn debug_zeigt_keinen_schluessel() {
        let s = GeheimnisSchluessel::generate();
        let text = s.to_secret_string().expose_secret().to_string();
        assert!(!format!("{s:?}").contains(&text));
        let speicher = Geheimnisspeicher::new(Some(s));
        assert!(!format!("{speicher:?}").contains(&text));
    }

    #[test]
    fn parser_nimmt_nur_private_schluessel_und_nennt_den_wert_nie() {
        let s = GeheimnisSchluessel::generate();
        let text = s.to_secret_string().expose_secret().to_string();
        assert!(format!("  {text}\n").parse::<GeheimnisSchluessel>().is_ok());

        let oeffentlich = age::x25519::Identity::generate().to_public().to_string();
        let f = oeffentlich.parse::<GeheimnisSchluessel>().unwrap_err();
        assert!(f.0.contains("öffentlicher"), "{f}");
        assert!(!f.to_string().contains(&oeffentlich));

        let f = "AGE-SECRET-KEY-1kaputt"
            .parse::<GeheimnisSchluessel>()
            .unwrap_err();
        assert!(!f.to_string().contains("kaputt"));
        assert!("".parse::<GeheimnisSchluessel>().is_err());
    }
}
