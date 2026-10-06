//! Kurzlebiger, prozessweiter Speicher der Einmalcodes (LFH-818): Code → (Benutzer, `challenge`).
//! Muster und `!Send`-Disziplin wie `auth/oidc/state.rs`: kein `.await` unter dem Lock.
//!
//! **Ein offener Code je Person** (LFH-919): ein neuer Code macht den vorigen derselben Person
//! ungültig. Dazu höchstens [`OBERGRENZE`] Codes insgesamt; darüber stellt `app-code` keinen aus
//! und antwortet mit 429. Der Preis: Meldet dasselbe Konto zwei Macs in derselben Minute an,
//! scheitert die erste Einlösung mit 401 und muss neu bestätigt werden. Das Fenster zwischen
//! Bestätigen und Einlösen dauert Sekunden; anders als beim TOTP-Login (`totp/state.rs`) liegt
//! zwischen den beiden Schritten keine Eingabe der Person.

use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::auth::ablauf_speicher::{BegrenzterAblaufSpeicher, Voll};

/// Frist eines Codes ab Ausstellung. „Bestätigt → App löst ein“ dauert Sekunden.
pub const TTL: Duration = Duration::from_secs(60);

/// Höchstzahl offener Codes. Je Person gibt es nur einen, die Grenze greift also erst bei so
/// vielen Personen, die in derselben Minute die Mac-App anmelden.
pub const OBERGRENZE: usize = 1_024;

static STORE: LazyLock<Mutex<BegrenzterAblaufSpeicher<CodeEintrag>>> =
    LazyLock::new(|| Mutex::new(neuer_speicher()));

fn neuer_speicher() -> BegrenzterAblaufSpeicher<CodeEintrag> {
    BegrenzterAblaufSpeicher::neu(TTL, OBERGRENZE)
}

fn store() -> MutexGuard<'static, BegrenzterAblaufSpeicher<CodeEintrag>> {
    STORE.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Woran ein Code gebunden ist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeEintrag {
    pub benutzer_id: i64,
    pub challenge: String,
}

/// Form eines Codes: 64 Hex-Zeichen in Kleinschreibung (`session::neuer_token`).
pub fn code_gueltig(code: &str) -> bool {
    code.len() == 64 && code.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

/// Speichert `eintrag` unter `code` mit Ablauf [`TTL`]. Ein offener Code derselben Person
/// wird dabei ungültig; bei [`OBERGRENZE`] offenen Codes anderer Personen wird nicht eingefügt
/// ([`Voll`]).
pub fn speichere(code: String, eintrag: CodeEintrag) -> Result<(), Voll> {
    store().einfuegen_ersetzend(eintrag.benutzer_id, code, eintrag, Instant::now())
}

/// Entnimmt den Eintrag zu `code` **einmalig**; unbekannt, verbraucht oder abgelaufen → `None`.
pub fn entnehme(code: &str) -> Option<CodeEintrag> {
    store().entnehmen(code, Instant::now())
}

/// Test-Hook: Eintrag mit vorgegebener Ablaufzeit (auch für Integrationstests, daher nicht
/// `cfg(test)`; `doc(hidden)`, kein Aufrufer im Produktcode).
#[doc(hidden)]
pub fn speichere_mit_ablauf(code: String, eintrag: CodeEintrag, ablauf: Instant) {
    store().einfuegen_mit_ablauf(code, eintrag, ablauf);
}

/// Test-Hook: lässt nur noch Platz für `platz` weitere Einträge (`None`: zurück auf die
/// [`OBERGRENZE`]), damit ein Integrationstest die Grenze mit wenigen Anfragen erreicht. Nicht
/// `cfg(test)`, kein Aufrufer im Produktcode. Der Speicher ist prozessweit: nur in einem
/// Test-Binary aufrufen, dessen Tests nacheinander laufen (`NACHEINANDER` in
/// `tests/anmelde_start_grenzen.rs`, `tests/app_anmeldung.rs`).
#[doc(hidden)]
pub fn platz_fuer_tests(platz: Option<usize>) {
    let mut store = store();
    let grenze = platz.map_or(OBERGRENZE, |p| store.len() + p);
    store.obergrenze_setzen(grenze);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eintrag() -> CodeEintrag {
        CodeEintrag {
            benutzer_id: 7,
            challenge: "c".repeat(43),
        }
    }

    #[test]
    fn speichern_und_einmal_entnehmen() {
        speichere("code-einmal".into(), eintrag()).unwrap();
        assert_eq!(entnehme("code-einmal"), Some(eintrag()));
        assert_eq!(entnehme("code-einmal"), None);
    }

    #[test]
    fn unbekannter_code_liefert_none() {
        assert_eq!(entnehme("code-gibt-es-nicht"), None);
    }

    #[test]
    fn abgelaufener_code_liefert_none_und_ist_danach_weg() {
        speichere_mit_ablauf("code-alt".into(), eintrag(), Instant::now());
        assert_eq!(entnehme("code-alt"), None);
        assert!(!store().enthaelt("code-alt"));
    }

    #[test]
    fn ein_neuer_code_macht_den_vorigen_derselben_person_ungueltig() {
        let person = CodeEintrag {
            benutzer_id: 4711,
            challenge: "c".repeat(43),
        };
        speichere("code-person-erster".into(), person.clone()).unwrap();
        speichere("code-person-zweiter".into(), person.clone()).unwrap();
        assert_eq!(entnehme("code-person-erster"), None);
        assert_eq!(entnehme("code-person-zweiter"), Some(person));
    }

    /// Am eigenen Speicher statt am prozessweiten: der ist mit den übrigen Tests geteilt.
    #[test]
    fn ueber_der_obergrenze_wird_kein_code_ausgestellt() {
        let mut s = neuer_speicher();
        let jetzt = Instant::now();
        for n in 0..OBERGRENZE {
            let e = CodeEintrag {
                benutzer_id: n as i64,
                challenge: String::new(),
            };
            s.einfuegen_ersetzend(e.benutzer_id, format!("k{n}"), e, jetzt)
                .unwrap();
        }
        let neu = CodeEintrag {
            benutzer_id: -1,
            challenge: String::new(),
        };
        assert_eq!(
            s.einfuegen_ersetzend(-1, "zuviel".into(), neu, jetzt),
            Err(Voll)
        );
        let wieder = CodeEintrag {
            benutzer_id: 0,
            challenge: String::new(),
        };
        assert_eq!(
            s.einfuegen_ersetzend(0, "ersatz".into(), wieder, jetzt),
            Ok(()),
            "wer schon einen Code hat, bekommt auch bei voller Liste einen neuen"
        );
    }

    #[test]
    fn code_form() {
        assert!(code_gueltig(&"0a".repeat(32)));
        assert!(!code_gueltig(&"0a".repeat(31)));
        assert!(!code_gueltig(&"0A".repeat(32)));
        assert!(!code_gueltig(&"0g".repeat(32)));
        assert!(!code_gueltig(""));
    }

    #[test]
    fn frist_ist_sechzig_sekunden() {
        assert_eq!(TTL, Duration::from_secs(60));
    }
}
