//! Begrenzter Speicher mit Ablauf für die Anmelde-Zeremonien (LFH-919): OIDC-`state`,
//! WebAuthn-Zwischenzustand, Einmalcode der Desktop-Hülle und TOTP-Pending-Key.
//!
//! **Feste Obergrenze:** ist der Speicher voll, wird nicht eingefügt; der Aufrufer bekommt
//! [`Voll`] und antwortet mit 503 bzw. 429. Verdrängt wird bewusst nicht: ein offener Anmeldeablauf
//! einer anderen Person ginge sonst still verloren.
//!
//! **Gedrosselter Aufräumlauf:** Abgelaufenes wird beim Einfügen eines neuen Schlüssels geräumt,
//! aber höchstens alle [`AUFRAEUM_PAUSE`]. Ein Lauf geht über den ganzen Speicher; unter einer
//! Anfrageflut lief er vorher bei jedem Einfügen, unter dem prozessweiten Lock.
//!
//! **Ein Eintrag je Besitzer** (optional, [`BegrenzterAblaufSpeicher::einfuegen_ersetzend`]):
//! ein neuer Eintrag desselben Besitzers macht den alten ungültig. So belegt ein Konto höchstens
//! einen Platz, gleich wie oft es ausstellt.
//!
//! Die Zeit kommt von außen, damit Tests Fristen ohne Warten überspringen. Kein `.await` unter
//! dem Lock des Aufrufers (`!Send`-Disziplin wie in `oidc/state.rs`).

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Mindestabstand zweier Aufräumläufe.
pub const AUFRAEUM_PAUSE: Duration = Duration::from_secs(1);

/// Der Speicher ist voll; es wurde nicht eingefügt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Voll;

struct Eintrag<V> {
    wert: V,
    ablauf: Instant,
    besitzer: Option<i64>,
}

pub struct BegrenzterAblaufSpeicher<V> {
    eintraege: HashMap<String, Eintrag<V>>,
    /// Besitzer → sein einziger Schlüssel, nur für [`Self::einfuegen_ersetzend`].
    je_besitzer: HashMap<i64, String>,
    ttl: Duration,
    obergrenze: usize,
    /// Frühester Zeitpunkt des nächsten Aufräumlaufs.
    naechste_raeumung: Option<Instant>,
    #[cfg(test)]
    raeumungen: usize,
}

impl<V> BegrenzterAblaufSpeicher<V> {
    pub fn neu(ttl: Duration, obergrenze: usize) -> Self {
        Self {
            eintraege: HashMap::new(),
            je_besitzer: HashMap::new(),
            ttl,
            obergrenze,
            naechste_raeumung: None,
            #[cfg(test)]
            raeumungen: 0,
        }
    }

    /// Speichert `wert` unter `schluessel` mit Ablauf `jetzt + ttl`; ein vorhandener Eintrag
    /// desselben Schlüssels wird überschrieben und belegt keinen neuen Platz.
    pub fn einfuegen(&mut self, schluessel: String, wert: V, jetzt: Instant) -> Result<(), Voll> {
        self.einfuegen_mit(schluessel, wert, None, jetzt)
    }

    /// Wie [`Self::einfuegen`], aber höchstens ein Eintrag je `besitzer`: ein vorhandener
    /// Eintrag dieses Besitzers wird vorher entfernt. Deshalb scheitert der Ersatz nie an der
    /// Obergrenze.
    pub fn einfuegen_ersetzend(
        &mut self,
        besitzer: i64,
        schluessel: String,
        wert: V,
        jetzt: Instant,
    ) -> Result<(), Voll> {
        if let Some(alt) = self.je_besitzer.remove(&besitzer) {
            self.eintraege.remove(&alt);
        }
        self.einfuegen_mit(schluessel, wert, Some(besitzer), jetzt)
    }

    fn einfuegen_mit(
        &mut self,
        schluessel: String,
        wert: V,
        besitzer: Option<i64>,
        jetzt: Instant,
    ) -> Result<(), Voll> {
        if !self.eintraege.contains_key(&schluessel) {
            self.raeumen_falls_faellig(jetzt);
            if self.eintraege.len() >= self.obergrenze {
                return Err(Voll);
            }
        }
        let ablauf = jetzt + self.ttl;
        let alt = self.eintraege.insert(
            schluessel.clone(),
            Eintrag {
                wert,
                ablauf,
                besitzer,
            },
        );
        if let Some(b) = alt.and_then(|e| e.besitzer) {
            self.besitzer_loesen(b, &schluessel);
        }
        if let Some(b) = besitzer {
            self.je_besitzer.insert(b, schluessel);
        }
        Ok(())
    }

    /// Entnimmt den Eintrag zu `schluessel` **einmalig**; unbekannt, schon entnommen oder
    /// abgelaufen → `None`. Ein abgelaufener Eintrag ist danach ebenfalls weg.
    pub fn entnehmen(&mut self, schluessel: &str, jetzt: Instant) -> Option<V> {
        let eintrag = self.eintraege.remove(schluessel)?;
        if let Some(b) = eintrag.besitzer {
            self.besitzer_loesen(b, schluessel);
        }
        (jetzt < eintrag.ablauf).then_some(eintrag.wert)
    }

    /// Anzahl der Einträge, abgelaufene eingeschlossen, die noch kein Lauf geräumt hat.
    pub fn len(&self) -> usize {
        self.eintraege.len()
    }

    pub fn is_empty(&self) -> bool {
        self.eintraege.is_empty()
    }

    pub fn enthaelt(&self, schluessel: &str) -> bool {
        self.eintraege.contains_key(schluessel)
    }

    /// Test-Hook für Integrationstests: eine kleine Obergrenze ist mit wenigen Anfragen erreicht.
    #[doc(hidden)]
    pub fn obergrenze_setzen(&mut self, obergrenze: usize) {
        self.obergrenze = obergrenze;
    }

    /// Test-Hook: Eintrag mit vorgegebener Ablaufzeit, ohne Obergrenze und ohne Aufräumlauf.
    #[doc(hidden)]
    pub fn einfuegen_mit_ablauf(&mut self, schluessel: String, wert: V, ablauf: Instant) {
        let alt = self.eintraege.insert(
            schluessel.clone(),
            Eintrag {
                wert,
                ablauf,
                besitzer: None,
            },
        );
        if let Some(b) = alt.and_then(|e| e.besitzer) {
            self.besitzer_loesen(b, &schluessel);
        }
    }

    /// Entfernt den Besitzer-Verweis nur, wenn er noch auf `schluessel` zeigt.
    fn besitzer_loesen(&mut self, besitzer: i64, schluessel: &str) {
        if self.je_besitzer.get(&besitzer).map(String::as_str) == Some(schluessel) {
            self.je_besitzer.remove(&besitzer);
        }
    }

    fn raeumen_falls_faellig(&mut self, jetzt: Instant) {
        if self.naechste_raeumung.is_some_and(|t| jetzt < t) {
            return;
        }
        let je_besitzer = &mut self.je_besitzer;
        self.eintraege.retain(|schluessel, e| {
            let laeuft = jetzt < e.ablauf;
            if !laeuft {
                if let Some(b) = e.besitzer {
                    if je_besitzer.get(&b) == Some(schluessel) {
                        je_besitzer.remove(&b);
                    }
                }
            }
            laeuft
        });
        self.naechste_raeumung = Some(jetzt + AUFRAEUM_PAUSE);
        #[cfg(test)]
        {
            self.raeumungen += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TTL: Duration = Duration::from_secs(60);

    fn speicher(obergrenze: usize) -> BegrenzterAblaufSpeicher<u32> {
        BegrenzterAblaufSpeicher::neu(TTL, obergrenze)
    }

    #[test]
    fn einfuegen_und_einmal_entnehmen() {
        let mut s = speicher(4);
        let jetzt = Instant::now();
        s.einfuegen("a".into(), 1, jetzt).unwrap();
        assert_eq!(s.entnehmen("a", jetzt), Some(1));
        assert_eq!(s.entnehmen("a", jetzt), None);
        assert!(s.is_empty());
    }

    #[test]
    fn abgelaufener_eintrag_liefert_none_und_ist_weg() {
        let mut s = speicher(4);
        let jetzt = Instant::now();
        s.einfuegen("a".into(), 1, jetzt).unwrap();
        assert_eq!(s.entnehmen("a", jetzt + TTL), None);
        assert!(s.is_empty());
    }

    #[test]
    fn obergrenze_weist_den_naechsten_neuen_schluessel_ab() {
        let mut s = speicher(3);
        let jetzt = Instant::now();
        for n in 0..3 {
            s.einfuegen(format!("k{n}"), n, jetzt).unwrap();
        }
        assert_eq!(s.einfuegen("k3".into(), 3, jetzt), Err(Voll));
        assert_eq!(s.len(), 3);
        assert!(!s.enthaelt("k3"));
    }

    #[test]
    fn ueberschreiben_eines_vorhandenen_schluessels_geht_auch_voll() {
        let mut s = speicher(2);
        let jetzt = Instant::now();
        s.einfuegen("a".into(), 1, jetzt).unwrap();
        s.einfuegen("b".into(), 2, jetzt).unwrap();
        s.einfuegen("a".into(), 9, jetzt).unwrap();
        assert_eq!(s.entnehmen("a", jetzt), Some(9));
    }

    #[test]
    fn abgelaufenes_wird_vor_dem_abweisen_geraeumt() {
        let mut s = speicher(3);
        let start = Instant::now();
        for n in 0..3 {
            s.einfuegen(format!("alt{n}"), n, start).unwrap();
        }
        let spaeter = start + TTL;
        s.einfuegen("neu".into(), 7, spaeter).unwrap();
        assert_eq!(s.len(), 1, "die drei abgelaufenen sind geräumt");
        assert!(s.enthaelt("neu"));
    }

    #[test]
    fn aufraeumlauf_hoechstens_einmal_je_pause() {
        let mut s = speicher(10_000);
        let start = Instant::now();
        for n in 0..1_000u32 {
            // Tausend Einfügungen innerhalb einer Pause: genau ein Lauf.
            s.einfuegen(
                format!("k{n}"),
                n,
                start + Duration::from_micros(u64::from(n)),
            )
            .unwrap();
        }
        assert_eq!(s.raeumungen, 1);

        s.einfuegen("nach-pause".into(), 0, start + AUFRAEUM_PAUSE)
            .unwrap();
        assert_eq!(s.raeumungen, 2, "nach der Pause darf wieder geräumt werden");
    }

    #[test]
    fn voll_und_in_der_pause_weist_ohne_neuen_lauf_ab() {
        let mut s = speicher(2);
        let jetzt = Instant::now();
        s.einfuegen("a".into(), 1, jetzt).unwrap();
        s.einfuegen("b".into(), 2, jetzt).unwrap();
        for _ in 0..100 {
            assert_eq!(s.einfuegen("c".into(), 3, jetzt), Err(Voll));
        }
        assert_eq!(
            s.raeumungen, 1,
            "eine Flut auf den vollen Speicher räumt nicht jedes Mal"
        );
    }

    #[test]
    fn ersetzend_macht_den_alten_eintrag_des_besitzers_ungueltig() {
        let mut s = speicher(4);
        let jetzt = Instant::now();
        s.einfuegen_ersetzend(7, "erster".into(), 1, jetzt).unwrap();
        s.einfuegen_ersetzend(7, "zweiter".into(), 2, jetzt)
            .unwrap();
        assert_eq!(s.entnehmen("erster", jetzt), None);
        assert_eq!(s.entnehmen("zweiter", jetzt), Some(2));
        assert!(s.je_besitzer.is_empty(), "Entnehmen löst den Besitzer");
    }

    #[test]
    fn ersetzend_belegt_je_besitzer_nur_einen_platz_auch_wenn_voll() {
        let mut s = speicher(2);
        let jetzt = Instant::now();
        s.einfuegen_ersetzend(1, "a1".into(), 1, jetzt).unwrap();
        s.einfuegen_ersetzend(2, "b1".into(), 2, jetzt).unwrap();
        for n in 0..50 {
            s.einfuegen_ersetzend(1, format!("a{}", n + 2), n, jetzt)
                .expect("der Ersatz scheitert nicht an der Obergrenze");
        }
        assert_eq!(s.len(), 2);
        assert_eq!(s.einfuegen_ersetzend(3, "c1".into(), 3, jetzt), Err(Voll));
        assert!(s.enthaelt("b1"), "ein anderer Besitzer bleibt unberührt");
    }

    #[test]
    fn aufraeumlauf_loest_auch_die_besitzer_abgelaufener_eintraege() {
        let mut s = speicher(4);
        let start = Instant::now();
        s.einfuegen_ersetzend(1, "a".into(), 1, start).unwrap();
        s.einfuegen_ersetzend(2, "b".into(), 2, start).unwrap();
        s.einfuegen("x".into(), 3, start + TTL).unwrap();
        assert_eq!(s.len(), 1);
        assert!(s.je_besitzer.is_empty());
    }

    #[test]
    fn ueberschreiben_eines_besitzer_schluessels_ohne_besitzer_loest_ihn() {
        let mut s = speicher(4);
        let jetzt = Instant::now();
        s.einfuegen_ersetzend(1, "a".into(), 1, jetzt).unwrap();
        s.einfuegen("a".into(), 2, jetzt).unwrap();
        assert!(s.je_besitzer.is_empty());
        s.einfuegen_ersetzend(1, "b".into(), 3, jetzt).unwrap();
        assert_eq!(
            s.entnehmen("a", jetzt),
            Some(2),
            "der fremde Eintrag bleibt"
        );
    }
}
