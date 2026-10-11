//! Einmalpasswort mit Änderungszwang (LFH-1121, Spec `konto-einmalpasswort`).
//!
//! Zwei Teile:
//! - [`erzeuge_einmalpasswort`]: das Passwort, das die Administration einer Person vergibt.
//! - Der kurzlebige Zwischenzustand zwischen einem Passwort-Login auf ein Konto unter
//!   Änderungszwang und `POST /api/auth/passwort/festlegen`. Dasselbe Muster wie
//!   `totp/state.rs`: Der Client bekommt nur einen hochentropischen Schlüssel im HttpOnly-Cookie
//!   `passwort_wechsel`, nie die `benutzer_id`. Bis zum Festlegen gibt es keine Sitzung, also
//!   übernimmt kein Tab und kein Offline-Schnappschuss die Person (Design D1).
//!
//! Der Eintrag hält neben der `benutzer_id` den Passwort-Hash zum Zeitpunkt der Prüfung. Das
//! Festlegen schreibt nur, solange dieser Hash noch gilt: Hat die Administration dazwischen ein
//! neues Einmalpasswort vergeben, führt nur noch das neue zu einer Sitzung (Design D3, Schritt 7).
//!
//! **!Send-Disziplin** wie `totp/state.rs`: dieses Modul enthält kein `.await`, jeder Guard ist
//! bei der Rückkehr freigegeben.

use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use argon2::password_hash::rand_core::{OsRng, RngCore};

use crate::auth::ablauf_speicher::{BegrenzterAblaufSpeicher, Voll};

/// Zeichenvorrat des Einmalpassworts: Kleinbuchstaben und Ziffern ohne die leicht verwechselbaren
/// `0 o 1 l i` (31 Zeichen).
const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

/// Drei Gruppen zu je vier Zeichen: 12 Zeichen aus 31, rund 59 Bit.
const GRUPPEN: usize = 3;
const GRUPPENLAENGE: usize = 4;

/// Erzeugt ein Einmalpasswort der Form `xxxx-xxxx-xxxx` aus [`ALPHABET`] (Design D5). Die
/// Bindestriche gehören zum Passwort, damit es sich so abtippen lässt, wie es dasteht.
///
/// Zufall aus `OsRng`; Bytes ab dem größten Vielfachen der Alphabetlänge werden verworfen, damit
/// jedes Zeichen gleich wahrscheinlich ist.
pub fn erzeuge_einmalpasswort() -> String {
    let grenze = (256 / ALPHABET.len() * ALPHABET.len()) as u8;
    let mut zeichen = Vec::with_capacity(GRUPPEN * GRUPPENLAENGE);
    let mut puffer = [0u8; 32];
    while zeichen.len() < GRUPPEN * GRUPPENLAENGE {
        OsRng.fill_bytes(&mut puffer);
        for &b in puffer.iter().filter(|&&b| b < grenze) {
            if zeichen.len() == GRUPPEN * GRUPPENLAENGE {
                break;
            }
            zeichen.push(ALPHABET[usize::from(b) % ALPHABET.len()]);
        }
    }
    zeichen
        .chunks(GRUPPENLAENGE)
        .map(|g| std::str::from_utf8(g).expect("ASCII-Alphabet"))
        .collect::<Vec<_>>()
        .join("-")
}

/// Lebensdauer eines Zwischenschritts. Länger als beim TOTP-Code (5 min): die Person denkt sich
/// hier ein neues Passwort aus.
const TTL: Duration = Duration::from_secs(10 * 60);

/// Höchstzahl offener Zwischenschritte, wie beim TOTP-Speicher. Wachsen kann er nur mit richtigem
/// Passwort, gebremst durch die KDF; darüber antwortet der Login mit 503.
pub const OBERGRENZE: usize = 10_000;

/// Was ein offener Zwischenschritt festhält.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offen {
    pub benutzer_id: i64,
    /// `passwort_hash` des Kontos zum Zeitpunkt der Passwortprüfung.
    pub passwort_hash: String,
    /// `true`, wenn vor dem Zwischenschritt der zweite Faktor bestanden wurde. Dessen Erfolg hat
    /// die Anmeldung schon protokolliert; das Festlegen schreibt dann nur `passwort_geaendert`.
    pub nach_zweitfaktor: bool,
}

static STORE: LazyLock<Mutex<BegrenzterAblaufSpeicher<Offen>>> =
    LazyLock::new(|| Mutex::new(neuer_speicher()));

fn neuer_speicher() -> BegrenzterAblaufSpeicher<Offen> {
    BegrenzterAblaufSpeicher::neu(TTL, OBERGRENZE)
}

fn store() -> MutexGuard<'static, BegrenzterAblaufSpeicher<Offen>> {
    STORE.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// Legt einen Zwischenschritt unter `key` ab, mit frischem Ablauf. Bei [`OBERGRENZE`] offenen
/// Schritten wird nicht eingefügt ([`Voll`]).
pub fn speichere(key: String, offen: Offen) -> Result<(), Voll> {
    store().einfuegen(key, offen, Instant::now())
}

/// Entnimmt den Zwischenschritt zu `key` **einmalig**; unbekannt oder abgelaufen ergibt `None`.
pub fn entnehme(key: &str) -> Option<Offen> {
    store().entnehmen(key, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offen(id: i64) -> Offen {
        Offen {
            benutzer_id: id,
            passwort_hash: format!("hash-{id}"),
            nach_zweitfaktor: false,
        }
    }

    #[test]
    fn einmalpasswort_hat_drei_vierergruppen_aus_dem_alphabet() {
        for _ in 0..200 {
            let pw = erzeuge_einmalpasswort();
            let gruppen: Vec<&str> = pw.split('-').collect();
            assert_eq!(gruppen.len(), 3, "{pw}");
            for g in gruppen {
                assert_eq!(g.len(), 4, "{pw}");
                assert!(g.bytes().all(|b| ALPHABET.contains(&b)), "{pw}");
            }
            assert!(
                !pw.contains(['0', 'o', '1', 'l', 'i']),
                "keine verwechselbaren Zeichen: {pw}"
            );
            crate::routes::benutzer::pruefe_passwort_laenge(&pw)
                .expect("passt in die Grenzen eines neuen Passworts");
        }
    }

    #[test]
    fn alphabet_ohne_verwechselbare_zeichen() {
        assert_eq!(ALPHABET.len(), 31);
        assert!(!ALPHABET.iter().any(|b| b"0o1li".contains(b)));
    }

    #[test]
    fn zwei_einmalpasswoerter_unterscheiden_sich() {
        let a = erzeuge_einmalpasswort();
        let b = erzeuge_einmalpasswort();
        assert_ne!(a, b);
    }

    #[test]
    fn alle_zeichen_kommen_vor() {
        let mut gesehen = std::collections::HashSet::new();
        for _ in 0..500 {
            gesehen.extend(erzeuge_einmalpasswort().bytes().filter(|&b| b != b'-'));
        }
        assert_eq!(gesehen.len(), ALPHABET.len(), "kein Zeichen fällt aus");
    }

    #[test]
    fn speichere_dann_entnehme_einmalig() {
        let key = "pw-wechsel-einmalig".to_string();
        speichere(key.clone(), offen(7)).unwrap();
        assert_eq!(entnehme(&key), Some(offen(7)));
        assert_eq!(entnehme(&key), None);
    }

    #[test]
    fn unbekannter_key_liefert_none() {
        assert_eq!(entnehme("pw-wechsel-unbekannt"), None);
    }

    #[test]
    fn abgelaufener_eintrag_liefert_none() {
        let mut s = neuer_speicher();
        let jetzt = Instant::now();
        s.einfuegen("k".into(), offen(1), jetzt).unwrap();
        assert_eq!(s.entnehmen("k", jetzt + TTL + Duration::from_secs(1)), None);
    }

    /// Am eigenen Speicher statt am prozessweiten: der ist mit den übrigen Tests geteilt.
    #[test]
    fn der_schritt_ueber_der_obergrenze_wird_abgewiesen() {
        let mut s = neuer_speicher();
        let jetzt = Instant::now();
        for n in 0..OBERGRENZE {
            s.einfuegen(format!("k{n}"), offen(1), jetzt).unwrap();
        }
        assert_eq!(s.einfuegen("zuviel".into(), offen(1), jetzt), Err(Voll));
    }
}
