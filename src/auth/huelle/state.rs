//! Kurzlebiger, prozessweiter Speicher der Einmalcodes (LFH-818): Code → (Benutzer, `challenge`).
//! Muster und `!Send`-Disziplin wie `auth/oidc/state.rs`: kein `.await` unter dem Lock.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Frist eines Codes ab Ausstellung. „Bestätigt → App löst ein“ dauert Sekunden.
pub const TTL: Duration = Duration::from_secs(60);

static STORE: LazyLock<Mutex<HashMap<String, (CodeEintrag, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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

/// Speichert `eintrag` unter `code` mit Ablauf [`TTL`]; räumt vorher Abgelaufenes weg.
pub fn speichere(code: String, eintrag: CodeEintrag) {
    let jetzt = Instant::now();
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.retain(|_, (_, ablauf)| *ablauf > jetzt);
    store.insert(code, (eintrag, jetzt + TTL));
}

/// Entnimmt den Eintrag zu `code` **einmalig**; unbekannt, verbraucht oder abgelaufen → `None`.
pub fn entnehme(code: &str) -> Option<CodeEintrag> {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    let (eintrag, ablauf) = store.remove(code)?;
    drop(store);
    (Instant::now() < ablauf).then_some(eintrag)
}

/// Test-Hook: Eintrag mit vorgegebener Ablaufzeit (auch für Integrationstests, daher nicht
/// `cfg(test)`; `doc(hidden)`, kein Aufrufer im Produktcode).
#[doc(hidden)]
pub fn speichere_mit_ablauf(code: String, eintrag: CodeEintrag, ablauf: Instant) {
    let mut store = STORE.lock().unwrap_or_else(|poison| poison.into_inner());
    store.insert(code, (eintrag, ablauf));
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
        speichere("code-einmal".into(), eintrag());
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
        let store = STORE.lock().unwrap_or_else(|p| p.into_inner());
        assert!(!store.contains_key("code-alt"));
    }

    #[test]
    fn speichern_raeumt_abgelaufene_weg() {
        speichere_mit_ablauf("code-raeumen-alt".into(), eintrag(), Instant::now());
        speichere("code-raeumen-neu".into(), eintrag());
        let store = STORE.lock().unwrap_or_else(|p| p.into_inner());
        assert!(!store.contains_key("code-raeumen-alt"));
        assert!(store.contains_key("code-raeumen-neu"));
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
