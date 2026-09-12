use crate::error::AppError;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

/// Hasht ein Klartext-Passwort mit Argon2id (OWASP-Defaultparameter)
/// und liefert den PHC-String (inkl. eingebettetem Salt).
pub fn hash(passwort: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(passwort.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("Passwort-Hashing fehlgeschlagen: {e}")))
}

/// Brennt einen Wegwerf-Hash, dessen Ergebnis niemanden interessiert — er kostet nur Zeit.
///
/// Zweck ist ausschließlich die **Angleichung der Antwortzeit**: jeder Weg durch den Login
/// soll genau einen Argon2-Lauf kosten, damit die Dauer der Antwort nichts darüber verrät,
/// ob ein Konto existiert und welche Art von Konto es ist. Zwei Stellen rufen ihn — der
/// `None`-Arm des Providers (unbekannter Benutzername) und der Parse-Fehler-Zweig von
/// [`verifizieren`] (SSO-only-Sentinel, kaputter Hash).
///
/// Er steht bewusst als eigene Funktion da, damit beide Stellen **denselben** Lauf brennen:
/// zwei getrennt gepflegte Wegwerf-Läufe könnten auseinanderdriften, und genau diese Drift
/// war das Loch aus LFH-310.
pub(crate) fn wegwerf_lauf(passwort: &str) {
    let _ = hash(passwort);
}

/// Prüft ein Klartext-Passwort gegen einen gespeicherten PHC-Hash.
/// Liefert `false` bei Nichtübereinstimmung oder unparsbarem Hash.
///
/// **Der Parse-Fehler-Zweig kehrt nicht sofort zurück** (LFH-310): der SSO-only-Sentinel aus
/// LFH-41 ist bewusst kein PHC-String, der Parse scheitert also schon vor jedem Argon2-Lauf.
/// Ohne Ausgleich antwortete ein Anmeldeversuch gegen ein SSO-only-Konto in ~0 ms, einer
/// gegen einen erfundenen Benutzernamen dagegen nach dem vollen Wegwerf-Hash des Providers —
/// womit sich genau die per SSO angebundenen Konten aufzählen ließen. Der Zweig brennt
/// deshalb denselben Wegwerf-Lauf, bevor er `false` liefert.
pub fn verifizieren(passwort: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(passwort.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => {
            wegwerf_lauf(passwort);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_unterscheidet_sich_vom_klartext_und_ist_phc() {
        let h = hash("geheim123").unwrap();
        assert_ne!(h, "geheim123");
        assert!(h.starts_with("$argon2id$"), "PHC-String erwartet, war: {h}");
    }

    #[test]
    fn verifizieren_akzeptiert_korrektes_passwort() {
        let h = hash("geheim123").unwrap();
        assert!(verifizieren("geheim123", &h));
    }

    #[test]
    fn verifizieren_lehnt_falsches_passwort_ab() {
        let h = hash("geheim123").unwrap();
        assert!(!verifizieren("falsch", &h));
    }

    #[test]
    fn verifizieren_lehnt_kaputten_hash_ab() {
        assert!(!verifizieren("egal", "kein-gueltiger-hash"));
    }

    #[test]
    fn verifizieren_lehnt_sso_only_sentinel_ab() {
        // LFH-41: der Sentinel ist bewusst kein PHC-String — `verifizieren` muss dagegen
        // sicher `false` liefern (kein lokaler Passwort-Login für SSO-only-Konten).
        assert!(!verifizieren("egal", crate::auth::PASSWORT_HASH_SSO_ONLY));
    }

    /// LFH-310: ein unparsbarer Hash darf nicht schneller antworten als eine echte Prüfung —
    /// sonst verrät die Antwortzeit, dass ein Konto existiert und SSO-only ist.
    ///
    /// Geprüft werden **beide** Wege in diesen Zweig: der Sentinel aus LFH-41 ist der Fall,
    /// der im Bestand vorkommt, aber die Zusicherung hängt am Zweig, nicht an der Konstante.
    ///
    /// Gemessen wird je Seite der **schnellste** von drei Läufen, nicht der Mittelwert: eine
    /// Störung (Scheduling, parallel laufende Tests) kann einen Lauf nur VERLANGSAMEN, das
    /// Minimum kommt der reinen Rechenzeit also am nächsten. Der Deckel ist bewusst ein
    /// **Verhältnis** und kein Millisekunden-Literal — die Lücke, die der Test fängt, ist
    /// sechs Größenordnungen breit (gemessen im Debug-Build vor dem Fix: 515 ms echte Prüfung
    /// gegen 141 ns Parse-Fehler), das Verhältnis zweier gleich teurer Läufe schwankt um 1.
    #[test]
    fn unparsbarer_hash_kostet_dieselbe_groessenordnung_wie_eine_echte_pruefung() {
        let echter_hash = hash("geheim123").unwrap();
        let schnellster = |gespeichert: &str| {
            (0..3)
                .map(|_| {
                    let start = std::time::Instant::now();
                    assert!(!verifizieren("falsch", gespeichert));
                    start.elapsed()
                })
                .min()
                .unwrap()
        };

        let echte_pruefung = schnellster(&echter_hash);

        for unparsbar in [crate::auth::PASSWORT_HASH_SSO_ONLY, "kein-gueltiger-hash"] {
            let gemessen = schnellster(unparsbar);
            assert!(
                gemessen * 4 >= echte_pruefung,
                "`{unparsbar}` muss KDF-Arbeit brennen: echte Prüfung {echte_pruefung:?}, \
                 unparsbarer Hash {gemessen:?} — so weit darunter liegt nur ein Zweig, der \
                 ohne Argon2 zurückkehrt (Timing-Orakel, LFH-310)"
            );
        }
    }

    #[test]
    fn zwei_hashes_desselben_passworts_unterscheiden_sich() {
        // Unterschiedliche Salts → unterschiedliche Hashes.
        assert_ne!(hash("gleich").unwrap(), hash("gleich").unwrap());
    }
}
