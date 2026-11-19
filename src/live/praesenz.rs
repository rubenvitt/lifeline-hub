//! Präsenz an Einzelangaben (LLH-1946, Entwurf
//! `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`, D1–D3): wer gerade
//! welche Angabe von Einsatzkopf, Führungsstelle oder Einheit offen hat.
//!
//! Nur im Speicher, nie in der Datenbank. Ein Eintrag lebt [`PRAESENZ_ABLAUF`] nach seinem letzten
//! Lebenszeichen; ein Fenster hat höchstens einen Eintrag. Die Grenzen verdrängen nie, sie lehnen
//! ab (Muster `auth::ablauf_speicher`). Verteilt wird über [`super::LiveHub`] am Replay-Ring vorbei.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::LiveEvent;
use crate::error::AppError;
use crate::wire_enum::wire_enum;

/// Ablauf nach dem letzten Lebenszeichen; der Client meldet sich alle 15 s.
pub const PRAESENZ_ABLAUF: Duration = Duration::from_secs(45);
/// Takt, in dem Abgelaufenes entfernt und verteilt wird.
pub const PRAESENZ_RAEUM_TAKT: Duration = Duration::from_secs(5);
/// Höchstens so viele Fenster je Benutzer (wie die Stromgrenze je Benutzer), darüber 429.
pub const JE_BENUTZER: usize = 16;
/// Höchstens so viele Einträge insgesamt, darüber 503.
pub const GESAMT: usize = 2000;
/// Höchstens so viele Felder je Eintrag (eine Eingabe bearbeitet selten mehr als zwei).
pub const MAX_FELDER: usize = 4;
/// Höchste Länge der Fensterkennung.
pub const MAX_FENSTER: usize = 64;

wire_enum! {
    /// Wessen Angabe bearbeitet wird; dieselben Werte wie `objekt_art` des Änderungsvermerks.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum PraesenzObjekt {
        Einsatz => "einsatz",
        Einheit => "einheit",
        Fuehrungsstelle => "fuehrungsstelle",
    }
}

impl PraesenzObjekt {
    /// Die Angaben, die der PATCH des Objekts schreibt (Vermerk-Feldnamen). Felder, die nur
    /// andere Wege setzen, stehen hier nicht.
    pub const fn felder(self) -> &'static [&'static str] {
        match self {
            PraesenzObjekt::Einsatz => &[
                "bezeichnung",
                "stichwort",
                "einsatzart",
                "leitstellen_nr",
                "einsatzort",
                "einsatzort_koordinate",
                "meldende_stelle",
                "sachverhalt",
                "anzahl_betroffene_initial",
                "begonnen_at",
            ],
            PraesenzObjekt::Einheit => &[
                "name",
                "typ_id",
                "funkrufname",
                "abschnitt_id",
                "ueber_einheit_id",
                "fuehrer_id",
                "soll",
                "quali_soll",
                "bemerkung",
                "verbindungen",
            ],
            PraesenzObjekt::Fuehrungsstelle => &[
                "art",
                "bezeichnung",
                "standort_adresse",
                "standort_koordinate",
                "rufname",
                "verbindungen",
                "fahrzeug_ids",
                "einsatzleiter",
            ],
        }
    }

    /// Das Ereignis, dessen Gate ein Eintrag dieses Objekts teilt (Entwurf D2): so offen wie das
    /// Objekt selbst im Live-Strom.
    pub const fn bezug(self) -> LiveEvent {
        match self {
            PraesenzObjekt::Einsatz | PraesenzObjekt::Fuehrungsstelle => LiveEvent::Einsatz,
            PraesenzObjekt::Einheit => LiveEvent::Einheit,
        }
    }
}

/// Ein Fenster, das gerade Angaben eines Objekts bearbeitet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PraesenzEintrag {
    pub objekt: PraesenzObjekt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    pub felder: Vec<String>,
    pub benutzer_id: i64,
    /// Anzeigename, wie `FeldVermerk.von`.
    pub von: String,
    /// Zufällige Kennung des Tabs.
    pub fenster: String,
}

/// Der ganze Präsenzstand eines Einsatzes; Daten des Ereignisses `praesenz`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PraesenzStand {
    pub einsatz_id: i64,
    pub eintraege: Vec<PraesenzEintrag>,
}

impl PraesenzStand {
    /// Nur die Einträge, deren Bezugsereignis diese Verbindung sehen darf (Gate je Eintrag).
    pub fn fuer(&self, erlaubt: &std::collections::HashSet<&'static str>) -> PraesenzStand {
        PraesenzStand {
            einsatz_id: self.einsatz_id,
            eintraege: self
                .eintraege
                .iter()
                .filter(|e| e.objekt.bezug().sichtbar_fuer(erlaubt))
                .cloned()
                .collect(),
        }
    }
}

/// Prüft eine Meldung vor dem Setzen: 1 bis [`MAX_FELDER`] bekannte Felder des Objekts, eine
/// Fensterkennung aus 1 bis [`MAX_FENSTER`] Zeichen `[A-Za-z0-9_-]`. Sonst 400.
pub fn pruefe_meldung(
    objekt: PraesenzObjekt,
    felder: &[String],
    fenster: &str,
) -> Result<(), AppError> {
    if felder.is_empty() || felder.len() > MAX_FELDER {
        return Err(AppError::Validation(format!(
            "felder: 1 bis {MAX_FELDER} Angaben"
        )));
    }
    if let Some(f) = felder
        .iter()
        .find(|f| !objekt.felder().contains(&f.as_str()))
    {
        return Err(AppError::Validation(format!(
            "felder: unbekannte Angabe {f}"
        )));
    }
    let fenster_ok = !fenster.is_empty()
        && fenster.len() <= MAX_FENSTER
        && fenster
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !fenster_ok {
        return Err(AppError::Validation("fenster: ungültige Kennung".into()));
    }
    Ok(())
}

/// Gleiche Meldung: dasselbe Fenster an denselben Angaben; der Anzeigename zählt nicht.
fn gleiche_meldung(a: &PraesenzEintrag, b: &PraesenzEintrag) -> bool {
    a.benutzer_id == b.benutzer_id
        && a.fenster == b.fenster
        && a.objekt == b.objekt
        && a.einheit_id == b.einheit_id
        && a.felder == b.felder
}

#[derive(Default)]
struct Zustand {
    /// Je Einsatz die Einträge mit ihrem letzten Lebenszeichen.
    einsaetze: HashMap<i64, Vec<(PraesenzEintrag, Instant)>>,
}

impl Zustand {
    fn anzahl(&self) -> usize {
        self.einsaetze.values().map(Vec::len).sum()
    }

    fn fenster_des_benutzers(&self, benutzer_id: i64) -> usize {
        self.einsaetze
            .values()
            .flatten()
            .filter(|(e, _)| e.benutzer_id == benutzer_id)
            .count()
    }

    /// Entfernt den Eintrag eines Fensters, wo immer er steht; liefert seinen Einsatz.
    fn nimm_fenster(&mut self, benutzer_id: i64, fenster: &str) -> Option<(i64, PraesenzEintrag)> {
        for (einsatz_id, liste) in self.einsaetze.iter_mut() {
            if let Some(i) = liste
                .iter()
                .position(|(e, _)| e.benutzer_id == benutzer_id && e.fenster == fenster)
            {
                let (e, _) = liste.remove(i);
                return Some((*einsatz_id, e));
            }
        }
        None
    }

    fn aufraeumen_leere(&mut self) {
        self.einsaetze.retain(|_, l| !l.is_empty());
    }

    fn stand(&self, einsatz_id: i64) -> PraesenzStand {
        PraesenzStand {
            einsatz_id,
            eintraege: self
                .einsaetze
                .get(&einsatz_id)
                .map(|l| l.iter().map(|(e, _)| e.clone()).collect())
                .unwrap_or_default(),
        }
    }
}

/// Der Präsenzspeicher eines Prozesses.
pub struct PraesenzSpeicher {
    zustand: Mutex<Zustand>,
    /// Ziel der geänderten Stände. Gesendet wird unter derselben Sperre, unter der der Stand sich
    /// ändert: so überholt ein älterer Stand nie einen neueren (Review 19.11.2026, Befund 1).
    /// `broadcast::send` blockiert nicht.
    melden: Option<tokio::sync::broadcast::Sender<PraesenzStand>>,
    je_benutzer: usize,
    gesamt: usize,
}

impl Default for PraesenzSpeicher {
    fn default() -> Self {
        Self::mit_grenzen(JE_BENUTZER, GESAMT)
    }
}

impl PraesenzSpeicher {
    /// Mit eigenen Grenzen (Tests stellen sie klein).
    pub fn mit_grenzen(je_benutzer: usize, gesamt: usize) -> Self {
        Self {
            zustand: Mutex::new(Zustand::default()),
            melden: None,
            je_benutzer,
            gesamt,
        }
    }

    /// Ein Speicher, der jeden geänderten Stand an `melden` sendet.
    pub fn mit_melden(melden: tokio::sync::broadcast::Sender<PraesenzStand>) -> Self {
        Self {
            melden: Some(melden),
            ..Self::default()
        }
    }

    /// Sendet den Stand eines Einsatzes; nur unter der Sperre aufrufen.
    fn melde(&self, z: &Zustand, einsatz_id: i64) {
        if let Some(tx) = &self.melden {
            // Ohne Abonnenten ist `send` ein Fehler ohne Folgen.
            let _ = tx.send(z.stand(einsatz_id));
        }
    }

    /// Beginnt oder verlängert den Eintrag des Fensters. `true`, wenn sich der Stand eines
    /// Einsatzes sichtbar geändert hat; ein bloßes Verlängern ist keine Änderung. Hatte das
    /// Fenster einen Eintrag in einem anderen Einsatz, verschwindet er dort (der Hub verteilt ihn
    /// über [`Self::setze_mit_vorgaenger`]).
    pub fn setze(
        &self,
        einsatz_id: i64,
        eintrag: PraesenzEintrag,
        jetzt: Instant,
    ) -> Result<bool, AppError> {
        self.setze_mit_vorgaenger(einsatz_id, eintrag, jetzt)
            .map(|(geaendert, _)| geaendert)
    }

    /// Wie [`Self::setze`]; nennt zusätzlich einen anderen Einsatz, aus dem der Eintrag des
    /// Fensters dabei verschwunden ist.
    pub fn setze_mit_vorgaenger(
        &self,
        einsatz_id: i64,
        eintrag: PraesenzEintrag,
        jetzt: Instant,
    ) -> Result<(bool, Option<i64>), AppError> {
        let mut z = self.zustand.lock().unwrap_or_else(|p| p.into_inner());
        let vorher = z.nimm_fenster(eintrag.benutzer_id, &eintrag.fenster);
        if vorher.is_none() {
            if z.fenster_des_benutzers(eintrag.benutzer_id) >= self.je_benutzer {
                return Err(AppError::TooManyRequests(
                    "Zu viele offene Bearbeitungen.".into(),
                ));
            }
            if z.anzahl() >= self.gesamt {
                return Err(AppError::ServiceUnavailable(
                    "Präsenz vorübergehend nicht verfügbar.".into(),
                ));
            }
        }
        let (geaendert, vorgaenger) = match &vorher {
            Some((alt_einsatz, alt)) if *alt_einsatz == einsatz_id => (*alt != eintrag, None),
            Some((alt_einsatz, _)) => (true, Some(*alt_einsatz)),
            None => (true, None),
        };
        z.einsaetze
            .entry(einsatz_id)
            .or_default()
            .push((eintrag, jetzt));
        z.aufraeumen_leere();
        if let Some(alt) = vorgaenger {
            self.melde(&z, alt);
        }
        if geaendert {
            self.melde(&z, einsatz_id);
        }
        Ok((geaendert, vorgaenger))
    }

    /// Beendet den Eintrag des Fensters in diesem Einsatz. `true`, wenn es einen gab. Beendet nur den Eintrag, der genau dieser Meldung entspricht (Fenster, Objekt, Einheit,
    /// Felder): ein spätes DELETE eines geschlossenen Feldes beendet nicht das neu geöffnete.
    pub fn entferne(&self, einsatz_id: i64, meldung: &PraesenzEintrag) -> bool {
        let mut z = self.zustand.lock().unwrap_or_else(|p| p.into_inner());
        let Some(liste) = z.einsaetze.get_mut(&einsatz_id) else {
            return false;
        };
        let vorher = liste.len();
        liste.retain(|(e, _)| !gleiche_meldung(e, meldung));
        let entfernt = liste.len() != vorher;
        z.aufraeumen_leere();
        if entfernt {
            self.melde(&z, einsatz_id);
        }
        entfernt
    }

    /// Entfernt alles, was seit [`PRAESENZ_ABLAUF`] kein Lebenszeichen gab; liefert die Einsätze,
    /// deren Stand sich dadurch geändert hat.
    pub fn raeume(&self, jetzt: Instant) -> Vec<i64> {
        let mut z = self.zustand.lock().unwrap_or_else(|p| p.into_inner());
        let mut geaendert = Vec::new();
        for (einsatz_id, liste) in z.einsaetze.iter_mut() {
            let vorher = liste.len();
            liste
                .retain(|(_, zuletzt)| jetzt.saturating_duration_since(*zuletzt) < PRAESENZ_ABLAUF);
            if liste.len() != vorher {
                geaendert.push(*einsatz_id);
            }
        }
        z.aufraeumen_leere();
        geaendert.sort_unstable();
        for einsatz_id in &geaendert {
            self.melde(&z, *einsatz_id);
        }
        geaendert
    }

    /// Der ganze Stand eines Einsatzes, ungefiltert.
    pub fn stand(&self, einsatz_id: i64) -> PraesenzStand {
        self.zustand
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .stand(einsatz_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::live::LiveEvent;
    use std::time::{Duration, Instant};

    fn eintrag(benutzer_id: i64, fenster: &str, feld: &str) -> PraesenzEintrag {
        PraesenzEintrag {
            objekt: PraesenzObjekt::Einsatz,
            einheit_id: None,
            felder: vec![feld.to_string()],
            benutzer_id,
            von: format!("Benutzer {benutzer_id}"),
            fenster: fenster.to_string(),
        }
    }

    #[test]
    fn setzen_meldet_neues_aber_nicht_das_verlaengern() {
        let s = PraesenzSpeicher::default();
        let t0 = Instant::now();
        assert!(s.setze(1, eintrag(7, "a", "leitstellen_nr"), t0).unwrap());
        assert!(!s
            .setze(
                1,
                eintrag(7, "a", "leitstellen_nr"),
                t0 + Duration::from_secs(10)
            )
            .unwrap());
        assert_eq!(s.stand(1).eintraege.len(), 1);
    }

    #[test]
    fn zweites_setzen_ersetzt_den_eintrag_des_fensters() {
        let s = PraesenzSpeicher::default();
        let t0 = Instant::now();
        s.setze(1, eintrag(7, "a", "leitstellen_nr"), t0).unwrap();
        assert!(s.setze(1, eintrag(7, "a", "stichwort"), t0).unwrap());
        let stand = s.stand(1);
        assert_eq!(stand.eintraege.len(), 1);
        assert_eq!(stand.eintraege[0].felder, vec!["stichwort".to_string()]);
    }

    #[test]
    fn ein_fenster_hat_auch_einsatzuebergreifend_nur_einen_eintrag() {
        let s = PraesenzSpeicher::default();
        let t0 = Instant::now();
        s.setze(1, eintrag(7, "a", "leitstellen_nr"), t0).unwrap();
        s.setze(2, eintrag(7, "a", "leitstellen_nr"), t0).unwrap();
        assert!(s.stand(1).eintraege.is_empty());
        assert_eq!(s.stand(2).eintraege.len(), 1);
    }

    #[test]
    fn raeumen_entfernt_abgelaufene_und_nennt_den_einsatz() {
        let s = PraesenzSpeicher::default();
        let t0 = Instant::now();
        s.setze(1, eintrag(7, "a", "leitstellen_nr"), t0).unwrap();
        assert!(s.raeume(t0 + Duration::from_secs(44)).is_empty());
        assert_eq!(s.raeume(t0 + Duration::from_secs(46)), vec![1]);
        assert!(s.stand(1).eintraege.is_empty());
    }

    #[test]
    fn entfernen_ist_idempotent() {
        let s = PraesenzSpeicher::default();
        let e = eintrag(7, "a", "leitstellen_nr");
        s.setze(1, e.clone(), Instant::now()).unwrap();
        assert!(s.entferne(1, &e));
        assert!(!s.entferne(1, &e));
        // Ein fremdes Konto beendet kein fremdes Fenster.
        s.setze(1, e.clone(), Instant::now()).unwrap();
        assert!(!s.entferne(1, &eintrag(8, "a", "leitstellen_nr")));
    }

    /// Schließen von A und Öffnen von B im selben Fenster laufen parallel: kommt das DELETE von A
    /// nach dem PUT von B an, bleibt B stehen (Review 19.11.2026, Befund 3).
    #[test]
    fn entfernen_trifft_nur_den_passenden_eintrag() {
        let s = PraesenzSpeicher::default();
        let b = eintrag(7, "a", "stichwort");
        s.setze(1, b.clone(), Instant::now()).unwrap();
        assert!(!s.entferne(1, &eintrag(7, "a", "leitstellen_nr")));
        let einheit = PraesenzEintrag {
            objekt: PraesenzObjekt::Einheit,
            einheit_id: Some(3),
            ..eintrag(7, "a", "stichwort")
        };
        assert!(!s.entferne(1, &einheit), "anderes Objekt");
        assert_eq!(s.stand(1).eintraege, vec![b]);
    }

    /// Verteilte Stände kommen in der Reihenfolge der Änderungen an: der zuletzt empfangene Stand
    /// eines Einsatzes ist sein Stand im Speicher (Review 19.11.2026, Befund 1).
    #[test]
    fn verteilte_staende_ueberholen_sich_nicht() {
        let hub = crate::live::LiveHub::new();
        let mut rx = hub.abonniere_praesenz();
        std::thread::scope(|sc| {
            for t in 0..8 {
                let hub = &hub;
                sc.spawn(move || {
                    let e = eintrag(t, "f", "stichwort");
                    for _ in 0..400 {
                        hub.praesenz_setzen(1, e.clone()).unwrap();
                        hub.praesenz_entfernen(1, &e);
                    }
                    if t % 2 == 0 {
                        hub.praesenz_setzen(1, e.clone()).unwrap();
                    }
                });
            }
        });
        let mut zuletzt = None;
        loop {
            match rx.try_recv() {
                Ok(s) => zuletzt = Some(s),
                Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
        let mut erhalten = zuletzt.expect("mindestens ein Stand").eintraege;
        let mut gespeichert = hub.praesenz_stand(1).eintraege;
        erhalten.sort_by_key(|e| e.benutzer_id);
        gespeichert.sort_by_key(|e| e.benutzer_id);
        assert_eq!(erhalten, gespeichert);
    }

    #[test]
    fn grenzen_je_benutzer_429_und_gesamt_503_ohne_verdraengen() {
        let s = PraesenzSpeicher::mit_grenzen(2, 3);
        let t0 = Instant::now();
        s.setze(1, eintrag(7, "a", "bezeichnung"), t0).unwrap();
        s.setze(1, eintrag(7, "b", "bezeichnung"), t0).unwrap();
        assert!(matches!(
            s.setze(1, eintrag(7, "c", "bezeichnung"), t0),
            Err(AppError::TooManyRequests(_))
        ));
        // Ein bestehendes Fenster darf weiter verlängern und wechseln.
        assert!(s.setze(1, eintrag(7, "a", "stichwort"), t0).is_ok());
        s.setze(1, eintrag(8, "x", "bezeichnung"), t0).unwrap();
        assert!(matches!(
            s.setze(1, eintrag(9, "y", "bezeichnung"), t0),
            Err(AppError::ServiceUnavailable(_))
        ));
        assert_eq!(s.stand(1).eintraege.len(), 3);
    }

    #[test]
    fn bezug_und_feldlisten() {
        assert_eq!(PraesenzObjekt::Einheit.bezug(), LiveEvent::Einheit);
        assert_eq!(PraesenzObjekt::Einsatz.bezug(), LiveEvent::Einsatz);
        assert_eq!(PraesenzObjekt::Fuehrungsstelle.bezug(), LiveEvent::Einsatz);
        assert!(PraesenzObjekt::Einsatz.felder().contains(&"leitstellen_nr"));
        assert!(PraesenzObjekt::Einsatz.felder().contains(&"begonnen_at"));
        assert!(PraesenzObjekt::Einsatz
            .felder()
            .contains(&"anzahl_betroffene_initial"));
        assert!(PraesenzObjekt::Einheit.felder().contains(&"bemerkung"));
        assert!(PraesenzObjekt::Fuehrungsstelle
            .felder()
            .contains(&"standort_koordinate"));
    }

    #[test]
    fn hub_verteilt_nur_aenderungen_und_den_verlassenen_einsatz() {
        let hub = crate::live::LiveHub::new();
        let mut rx = hub.abonniere_praesenz();
        hub.praesenz_setzen(1, eintrag(7, "a", "leitstellen_nr"))
            .unwrap();
        assert_eq!(rx.try_recv().unwrap().einsatz_id, 1);
        hub.praesenz_setzen(1, eintrag(7, "a", "leitstellen_nr"))
            .unwrap();
        assert!(rx.try_recv().is_err(), "Verlängern verteilt nichts");
        hub.praesenz_setzen(2, eintrag(7, "a", "leitstellen_nr"))
            .unwrap();
        let alt = rx.try_recv().unwrap();
        assert_eq!((alt.einsatz_id, alt.eintraege.len()), (1, 0));
        assert_eq!(rx.try_recv().unwrap().einsatz_id, 2);
        hub.praesenz_entfernen(2, &eintrag(7, "a", "leitstellen_nr"));
        assert!(rx.try_recv().unwrap().eintraege.is_empty());
        hub.praesenz_entfernen(2, &eintrag(7, "a", "leitstellen_nr"));
        assert!(rx.try_recv().is_err(), "nichts entfernt, nichts verteilt");
    }

    #[test]
    fn meldung_pruefen() {
        let gut = |f: &[&str], fenster: &str| {
            pruefe_meldung(
                PraesenzObjekt::Einsatz,
                &f.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                fenster,
            )
        };
        assert!(gut(&["einsatzort", "einsatzort_koordinate"], "f-1_A").is_ok());
        assert!(matches!(gut(&[], "f"), Err(AppError::Validation(_))));
        assert!(matches!(
            gut(
                &[
                    "bezeichnung",
                    "stichwort",
                    "einsatzart",
                    "sachverhalt",
                    "einsatzort"
                ],
                "f"
            ),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            gut(&["gibtsnicht"], "f"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            gut(&["bezeichnung"], ""),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            gut(&["bezeichnung"], "a b"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            gut(&["bezeichnung"], &"x".repeat(65)),
            Err(AppError::Validation(_))
        ));
    }
}
