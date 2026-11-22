//! Geheimnisspeicher der Adapter (LLH-2017, ADR-0077, Design-Doc „Geheimnisspeicher“).
//!
//! Ein Geheimnis (Accesskey, API-Key, Passwort) liegt nur als age-Chiffrat in
//! `adapter_geheimnis`, verschlüsselt an den Empfänger des privaten Schlüssels aus
//! `LIFELINE_GEHEIMNIS_SCHLUESSEL`. Jede Zeile trägt den Fingerabdruck dieses Empfängers; so ist
//! erkennbar, ob ein Chiffrat zum geladenen Schlüssel passt, ohne es zu öffnen. Der Schlüssel kommt
//! aus der Umgebung oder einer Datei (`…_DATEI`); für einen Schlüsselwechsel liest der Speicher
//! zusätzlich mit dem alten (`…_ALT`, LLH-2025), schreibt aber nur mit dem neuen. Klartext gibt es
//! nur als [`SecretString`] im Lauf, direkt vor einem Abruf; die API liest keine Geheimnisse.
//!
//! Ver- und Entschlüsseln rechnen; Aufrufer im async-Kontext rufen es über `spawn_blocking`
//! (wie ADR-0051).

use std::fmt;
use std::path::Path;
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

/// Liest den Schlüssel aus dem Inhalt einer Schlüsseldatei im Format von `age-keygen -o`
/// (LLH-2025): leere Zeilen und Kommentare (`#`) zählen nicht, genau eine Zeile muss der private
/// Schlüssel sein. Der Fehler nennt keinen Inhalt.
pub fn parse_schluesseldatei(inhalt: &str) -> Result<GeheimnisSchluessel, SchluesselFehler> {
    let mut zeilen = inhalt
        .lines()
        .map(str::trim)
        .filter(|z| !z.is_empty() && !z.starts_with('#'));
    let zeile = zeilen
        .next()
        .ok_or(SchluesselFehler("keine Schlüsselzeile in der Datei"))?;
    if zeilen.next().is_some() {
        return Err(SchluesselFehler(
            "mehr als eine Schlüsselzeile in der Datei",
        ));
    }
    zeile.parse()
}

/// Liest eine Schlüsseldatei (`…_DATEI`, LLH-2025). Pfad und Rolle nennt der Aufrufer.
pub fn read_schluesseldatei(pfad: &Path) -> Result<GeheimnisSchluessel, SchluesselFehler> {
    let inhalt =
        std::fs::read_to_string(pfad).map_err(|_| SchluesselFehler("Datei nicht lesbar"))?;
    parse_schluesseldatei(&inhalt)
}

/// Der Modus einer Schlüsseldatei, wenn Gruppe oder andere darauf zugreifen dürfen (Unix);
/// sonst `None`. Folgt Symlinks wie das Lesen selbst.
pub fn offener_modus(pfad: &Path) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let modus = std::fs::metadata(pfad).ok()?.permissions().mode() & 0o777;
        (modus & 0o077 != 0).then_some(modus)
    }
    #[cfg(not(unix))]
    {
        let _ = pfad;
        None
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

/// Der Speicher: der geladene Schlüssel oder keiner, für einen Schlüsselwechsel (LLH-2025)
/// zusätzlich der alte. Gelesen wird mit dem Schlüssel des passenden Fingerabdrucks,
/// geschrieben nur mit dem neuen. Billig zu klonen.
#[derive(Clone, Default)]
pub struct Geheimnisspeicher {
    neu: Option<Arc<Geladen>>,
    alt: Option<Arc<Geladen>>,
}

struct Geladen {
    identitaet: age::x25519::Identity,
    empfaenger: age::x25519::Recipient,
    fingerabdruck: String,
}

impl Geladen {
    fn aus(GeheimnisSchluessel(identitaet): GeheimnisSchluessel) -> Arc<Self> {
        let empfaenger = identitaet.to_public();
        let fingerabdruck = fingerabdruck_von(&empfaenger);
        Arc::new(Geladen {
            identitaet,
            empfaenger,
            fingerabdruck,
        })
    }
}

impl fmt::Debug for Geheimnisspeicher {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.fingerabdruck(), self.fingerabdruck_alt()) {
            (Some(fp), Some(alt)) => write!(f, "Geheimnisspeicher({fp}, alt {alt})"),
            (Some(fp), None) => write!(f, "Geheimnisspeicher({fp})"),
            _ => f.write_str("Geheimnisspeicher(ohne Schlüssel)"),
        }
    }
}

impl Geheimnisspeicher {
    pub fn new(schluessel: Option<GeheimnisSchluessel>) -> Self {
        Geheimnisspeicher {
            neu: schluessel.map(Geladen::aus),
            alt: None,
        }
    }

    /// Der Speicher während eines Schlüsselwechsels: schreibt mit `neu`, liest zusätzlich, was
    /// an `alt` verschlüsselt ist. Derselbe Schlüssel zweimal ist ein Bedienfehler.
    pub fn new_wechsel(
        neu: GeheimnisSchluessel,
        alt: GeheimnisSchluessel,
    ) -> Result<Self, SchluesselFehler> {
        let neu = Geladen::aus(neu);
        let alt = Geladen::aus(alt);
        if neu.fingerabdruck == alt.fingerabdruck {
            return Err(SchluesselFehler("alter und neuer Schlüssel sind derselbe"));
        }
        Ok(Geheimnisspeicher {
            neu: Some(neu),
            alt: Some(alt),
        })
    }

    /// Fingerabdruck des (neuen) Schlüssels; `None` ohne Schlüssel.
    pub fn fingerabdruck(&self) -> Option<&str> {
        self.neu.as_deref().map(|g| g.fingerabdruck.as_str())
    }

    /// Fingerabdruck des alten Schlüssels während eines Wechsels.
    pub fn fingerabdruck_alt(&self) -> Option<&str> {
        self.alt.as_deref().map(|g| g.fingerabdruck.as_str())
    }

    pub fn has_schluessel(&self) -> bool {
        self.neu.is_some()
    }

    /// Verschlüsselt an den Empfänger des neuen Schlüssels; liefert Chiffrat und Fingerabdruck.
    pub fn encrypt(&self, wert: &SecretString) -> Result<(Vec<u8>, String), KeinSchluessel> {
        let g = self.neu.as_deref().ok_or(KeinSchluessel)?;
        let chiffrat = age::encrypt(&g.empfaenger, wert.expose_secret().as_bytes())
            .map_err(|_| KeinSchluessel)?;
        Ok((chiffrat, g.fingerabdruck.clone()))
    }

    /// Öffnet ein Chiffrat mit dem Schlüssel, dessen Fingerabdruck passt (neu oder alt).
    pub fn decrypt(&self, chiffrat: &[u8], fingerabdruck: &str) -> Result<SecretString, Unlesbar> {
        let g = [self.neu.as_deref(), self.alt.as_deref()]
            .into_iter()
            .flatten()
            .find(|g| g.fingerabdruck == fingerabdruck)
            .ok_or(Unlesbar)?;
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

        let neu = GeheimnisSchluessel::generate();
        let alt = GeheimnisSchluessel::generate();
        let text_neu = neu.to_secret_string().expose_secret().to_string();
        let text_alt = alt.to_secret_string().expose_secret().to_string();
        let w = Geheimnisspeicher::new_wechsel(neu, alt).unwrap();
        let debug = format!("{w:?}");
        assert!(!debug.contains(&text_neu) && !debug.contains(&text_alt));
        assert!(debug.contains(w.fingerabdruck().unwrap()));
        assert!(debug.contains(w.fingerabdruck_alt().unwrap()));
    }

    #[test]
    fn wechsel_liest_alte_und_neue_chiffrate() {
        let a = GeheimnisSchluessel::generate();
        let b = GeheimnisSchluessel::generate();
        let nur_a = Geheimnisspeicher::new(Some(a.clone()));
        let nur_b = Geheimnisspeicher::new(Some(b.clone()));
        let (ca, fa) = nur_a.encrypt(&wert("alt-geheim")).unwrap();
        let (cb, fb) = nur_b.encrypt(&wert("neu-geheim")).unwrap();

        let w = Geheimnisspeicher::new_wechsel(b, a).unwrap();
        assert_eq!(w.decrypt(&ca, &fa).unwrap().expose_secret(), "alt-geheim");
        assert_eq!(w.decrypt(&cb, &fb).unwrap().expose_secret(), "neu-geheim");
        assert_eq!(w.fingerabdruck(), nur_b.fingerabdruck());
        assert_eq!(w.fingerabdruck_alt(), Some(fa.as_str()));
        assert!(w.has_schluessel());
        // Ein fremder Fingerabdruck bleibt unlesbar.
        assert_eq!(w.decrypt(&ca, "0000000000000000").unwrap_err(), Unlesbar);
    }

    #[test]
    fn wechsel_schreibt_nur_mit_dem_neuen() {
        let a = GeheimnisSchluessel::generate();
        let b = GeheimnisSchluessel::generate();
        let nur_a = Geheimnisspeicher::new(Some(a.clone()));
        let nur_b = Geheimnisspeicher::new(Some(b.clone()));
        let w = Geheimnisspeicher::new_wechsel(b, a).unwrap();
        let (c, fp) = w.encrypt(&wert("x")).unwrap();
        assert_eq!(Some(fp.as_str()), nur_b.fingerabdruck());
        assert_eq!(nur_a.decrypt(&c, &fp).unwrap_err(), Unlesbar);
        assert_eq!(nur_b.decrypt(&c, &fp).unwrap().expose_secret(), "x");
    }

    #[test]
    fn wechsel_mit_gleichem_schluessel_ist_fehler() {
        let a = GeheimnisSchluessel::generate();
        let f = Geheimnisspeicher::new_wechsel(a.clone(), a).unwrap_err();
        assert!(f.to_string().contains("derselbe"), "{f}");
    }

    fn schluesseltext(s: &GeheimnisSchluessel) -> String {
        s.to_secret_string().expose_secret().to_string()
    }

    #[test]
    fn schluesseldatei_im_format_von_age_keygen() {
        let s = GeheimnisSchluessel::generate();
        let oeffentlich = s.0.to_public().to_string();
        let inhalt = format!(
            "# created: 2026-11-22T10:00:00+01:00\n# public key: {oeffentlich}\n{}\n",
            schluesseltext(&s)
        );
        let gelesen = parse_schluesseldatei(&inhalt).unwrap();
        assert_eq!(
            Geheimnisspeicher::new(Some(gelesen)).fingerabdruck(),
            Geheimnisspeicher::new(Some(s)).fingerabdruck()
        );
    }

    #[test]
    fn schluesseldatei_mit_crlf_und_leerzeichen() {
        let s = GeheimnisSchluessel::generate();
        let inhalt = format!("# x\r\n{}  \r\n\r\n", schluesseltext(&s));
        assert!(parse_schluesseldatei(&inhalt).is_ok());
    }

    #[test]
    fn schluesseldatei_ohne_oder_mit_zwei_schluesseln() {
        let f = parse_schluesseldatei("# nur ein Kommentar\n\n").unwrap_err();
        assert!(f.0.contains("keine"), "{f}");

        let a = schluesseltext(&GeheimnisSchluessel::generate());
        let b = schluesseltext(&GeheimnisSchluessel::generate());
        let f = parse_schluesseldatei(&format!("{a}\n{b}\n")).unwrap_err();
        assert!(f.0.contains("mehr als eine"), "{f}");
        assert!(!f.to_string().contains(&a) && !f.to_string().contains(&b));
    }

    #[test]
    fn schluesseldatei_mit_kaputtem_schluessel_nennt_ihn_nicht() {
        let f = parse_schluesseldatei("AGE-SECRET-KEY-1kaputt\n").unwrap_err();
        assert!(!f.to_string().contains("kaputt"), "{f}");
    }

    #[test]
    fn fehlende_schluesseldatei_ist_nicht_lesbar() {
        let pfad = std::env::temp_dir().join("lifeline-gibt-es-nicht-z211l8p5.key");
        let f = read_schluesseldatei(&pfad).unwrap_err();
        assert!(f.0.contains("nicht lesbar"), "{f}");
    }

    #[cfg(unix)]
    #[test]
    fn offene_rechte_werden_erkannt() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("geheimnis.key");
        std::fs::write(&pfad, schluesseltext(&GeheimnisSchluessel::generate())).unwrap();
        std::fs::set_permissions(&pfad, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(offener_modus(&pfad), None);
        assert!(read_schluesseldatei(&pfad).is_ok());
        std::fs::set_permissions(&pfad, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(offener_modus(&pfad), Some(0o644));
    }

    #[test]
    fn ohne_wechsel_kein_alter_fingerabdruck() {
        let s = Geheimnisspeicher::new(Some(GeheimnisSchluessel::generate()));
        assert_eq!(s.fingerabdruck_alt(), None);
        assert_eq!(Geheimnisspeicher::default().fingerabdruck_alt(), None);
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
