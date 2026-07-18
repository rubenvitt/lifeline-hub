//! Modul-Registry des Backends (LFH-132) — minimale Source of Truth für die
//! gültigen Modul-Keys, die nicht-ausblendbaren Module und das Rollen-Vokabular
//! der Override-Validierung.
//!
//! **Spiegel zur Frontend-`modulRegistry.ts`:** Die Key-Menge MUSS mit der FE-Registry
//! synchron bleiben (ein Test in `tests/einsatz.rs` fängt Drift). Das Backend braucht
//! nur die Keys + die ausblendbar-Eigenschaft — Labels/Icons/Routen bleiben rein FE.

/// Alle gültigen Modul-Keys (Spiegel der Frontend-`modulRegistry`-`key`-Werte).
/// Reihenfolge wie in der FE-Registry (Kategorie für Kategorie) — rein dokumentarisch.
pub const MODUL_KEYS: [&str; 25] = [
    // Führung
    "einsatzdaten",
    "einsatzabschnitte",
    "stab",
    // Kräfte & Mittel
    "einheiten",
    "personal",
    "fahrzeuge",
    "material",
    "bereitstellungsraeume",
    // Erfassung
    "etb",
    "personen",
    "unfallhilfsstellen",
    "tiere",
    "schaeden",
    // Lage
    "lage-dashboard",
    "lagekarte",
    "lageberichte",
    "kraefteuebersicht",
    "gefahrenzonen",
    "lagemeldungen",
    // Kommunikation
    "chat",
    "erinnerungen",
    "auftraege",
    "meldungen",
    "nachforderungen",
    // Einstellungen
    "einsatz-einstellungen",
];

/// Module, die nicht ausgeblendet werden dürfen (Selbst-Aussperr-Schutz): Stammdaten
/// und die Einstellungen selbst. Auf diesen Keys ignoriert der Guard ein `sichtbar=false`,
/// und die Setz-Route lehnt einen Ausblend-Versuch ab.
pub const NICHT_AUSBLENDBAR: [&str; 2] = ["einsatzdaten", "einsatz-einstellungen"];

/// Gültige Werte für `benoetigte_rolle` (System-/Org-Rolle, vgl. LFH-129).
pub const BENOETIGTE_ROLLEN: [&str; 2] = ["admin", "fuehrungskraft"];

/// Ob `key` ein in der Registry bekannter Modul-Key ist.
pub fn ist_gueltiger_modul_key(key: &str) -> bool {
    MODUL_KEYS.contains(&key)
}

/// Ob das Modul ausgeblendet werden darf (alle außer den nicht-ausblendbaren).
/// Defensiv auch für unbekannte Keys `true` — die Key-Gültigkeit prüft der Aufrufer separat.
pub fn ist_ausblendbar(key: &str) -> bool {
    !NICHT_AUSBLENDBAR.contains(&key)
}

/// Ob `rolle` ein gültiger `benoetigte_rolle`-Wert ist (für die Eingabe-Validierung).
pub fn ist_gueltige_benoetigte_rolle(rolle: &str) -> bool {
    BENOETIGTE_ROLLEN.contains(&rolle)
}

/// Registry-Default der benötigten Rolle eines Moduls. Heute hat KEIN Modul einen
/// Default (alle frei → `None`); die Funktion existiert, damit der Guard die
/// Präzedenz „Override sonst Registry-Default" explizit verdrahtet und ein künftiger
/// Default hier einen Platz hat (LFH-129).
pub fn registry_benoetigte_rolle(_key: &str) -> Option<&'static str> {
    None
}

/// Compile-time-Marker (LFH-230): bindet einen Einsatz-Gate-Extractor an einen
/// Modul-Key — oder an KEIN Modul-Gate ([`OhneModul`]). Der Extractor liest `KEY`
/// und erzwingt `fordere_modul_zugriff` genau dann, wenn `Some`.
pub trait ModulMarker {
    const KEY: Option<&'static str>;
}

/// Marker für modul-lose Gate-Routen (Einsatz-Kopfdaten, Anhänge): kein Modul-Gate.
pub struct OhneModul;
impl ModulMarker for OhneModul {
    const KEY: Option<&'static str> = None;
}

/// Erzeugt je Eintrag einen Marker-Typ + dessen `ModulMarker`-Impl und sammelt
/// alle (Typname, Key)-Paare in `MARKER_KEYS` — die Tabelle, die der Struktur-Guard
/// (`tests/einsatz_kontext_guard.rs`) liest, um den Marker einer Handler-Signatur
/// gegen die Pfad→Key-Registry zu prüfen. Neue Module: hier eine Zeile ergänzen.
macro_rules! modul_marker {
    ($($typ:ident => $key:literal),+ $(,)?) => {
        $(
            #[doc = concat!("Modul-Marker für den Key `", $key, "`.")]
            pub struct $typ;
            impl ModulMarker for $typ {
                const KEY: Option<&'static str> = Some($key);
            }
        )+
        /// (Marker-Typname → Modul-Key), inkl. `OhneModul`. Vom Guard gelesen.
        pub const MARKER_KEYS: &[(&str, Option<&str>)] = &[
            ("OhneModul", None),
            $((stringify!($typ), Some($key)),)+
        ];
    };
}

modul_marker! {
    Meldungen => "meldungen",
    Lagemeldungen => "lagemeldungen",
    Auftraege => "auftraege",
}

/// Pfad-Präfix (app.rs-Route) → erwarteter Modul-Key (LFH-230). `None` = modul-lose
/// Gate-Route. Der **längste** passende Präfix gewinnt (`…/lage/meldungen` ist ein
/// eigener Eintrag, kein Kind von `…/meldungen`). Wächst pro migriertem Modul; nur
/// nicht-DEFERRED-Routen (die der Guard prüft) müssen eingetragen sein. Der Guard
/// gleicht diese Tabelle gegen die Marker in den Handler-Signaturen ab.
pub const PFAD_KEY: &[(&str, Option<&str>)] = &[
    ("/api/einsaetze/{id}/lage/meldungen", Some("lagemeldungen")),
    ("/api/einsaetze/{id}/meldungen", Some("meldungen")),
    ("/api/einsaetze/{id}/auftraege", Some("auftraege")),
    ("/api/einsaetze/{id}/anhaenge", None),
];

/// Längster-Präfix-Match über [`PFAD_KEY`]. Äußeres `None` = Pfad nicht registriert;
/// `Some(inner)` = registriert (inner `None` = modul-lose Route). Segment-grenzen-sicher:
/// ein Präfix trifft nur bei Gleichheit oder wenn direkt danach `/` folgt — sonst würde
/// z. B. `…/meldungenarchiv` fälschlich als `…/meldungen`-Kind matchen.
pub fn key_fuer_pfad(pfad: &str) -> Option<Option<&'static str>> {
    PFAD_KEY
        .iter()
        .filter(|(prefix, _)| {
            pfad == *prefix
                || pfad
                    .strip_prefix(*prefix)
                    .is_some_and(|rest| rest.starts_with('/'))
        })
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, key)| *key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_sind_eindeutig() {
        let mut sortiert = MODUL_KEYS.to_vec();
        sortiert.sort_unstable();
        sortiert.dedup();
        assert_eq!(
            sortiert.len(),
            MODUL_KEYS.len(),
            "Modul-Keys müssen eindeutig sein"
        );
    }

    #[test]
    fn gueltiger_modul_key_erkennt_bekannte_und_unbekannte() {
        assert!(ist_gueltiger_modul_key("etb"));
        assert!(ist_gueltiger_modul_key("einsatz-einstellungen"));
        assert!(!ist_gueltiger_modul_key("gibtsnicht"));
        assert!(!ist_gueltiger_modul_key(""));
    }

    #[test]
    fn nicht_ausblendbare_module_sind_geschuetzt() {
        assert!(!ist_ausblendbar("einsatzdaten"));
        assert!(!ist_ausblendbar("einsatz-einstellungen"));
        assert!(ist_ausblendbar("etb"));
        assert!(ist_ausblendbar("chat"));
    }

    #[test]
    fn nicht_ausblendbare_sind_gueltige_keys() {
        for key in NICHT_AUSBLENDBAR {
            assert!(
                ist_gueltiger_modul_key(key),
                "{key} muss ein gültiger Modul-Key sein"
            );
        }
    }

    #[test]
    fn benoetigte_rolle_validierung() {
        assert!(ist_gueltige_benoetigte_rolle("admin"));
        assert!(ist_gueltige_benoetigte_rolle("fuehrungskraft"));
        assert!(!ist_gueltige_benoetigte_rolle("einsatzleitung"));
        assert!(!ist_gueltige_benoetigte_rolle(""));
    }

    #[test]
    fn marker_keys_sind_teilmenge_von_modul_keys() {
        for (typ, key) in MARKER_KEYS {
            if let Some(k) = key {
                assert!(
                    MODUL_KEYS.contains(k),
                    "Marker {typ} nutzt Key {k}, der nicht in MODUL_KEYS steht"
                );
            }
        }
    }

    #[test]
    fn marker_key_werte_stimmen() {
        assert_eq!(Meldungen::KEY, Some("meldungen"));
        assert_eq!(Lagemeldungen::KEY, Some("lagemeldungen"));
        assert_eq!(Auftraege::KEY, Some("auftraege"));
        assert_eq!(OhneModul::KEY, None);
    }

    #[test]
    fn pfad_key_laengster_praefix_gewinnt() {
        // Kind-Pfade erben den Modul-Key des Präfixes.
        assert_eq!(
            key_fuer_pfad("/api/einsaetze/{id}/meldungen"),
            Some(Some("meldungen"))
        );
        assert_eq!(
            key_fuer_pfad("/api/einsaetze/{id}/meldungen/{mid}/status"),
            Some(Some("meldungen"))
        );
        // Eigenständiger Lage-Pfad → eigener Key, NICHT "meldungen".
        assert_eq!(
            key_fuer_pfad("/api/einsaetze/{id}/lage/meldungen"),
            Some(Some("lagemeldungen"))
        );
        // Modul-lose Route: registriert, aber kein Key.
        assert_eq!(key_fuer_pfad("/api/einsaetze/{id}/anhaenge"), Some(None));
        assert_eq!(
            key_fuer_pfad("/api/einsaetze/{id}/anhaenge/{aid}"),
            Some(None)
        );
        // Noch DEFERRED / nicht registriert.
        assert_eq!(key_fuer_pfad("/api/einsaetze/{id}/personen"), None);
    }

    #[test]
    fn pfad_key_ignoriert_teil_segment_treffer() {
        // "meldungenarchiv" verlängert das Präfix "meldungen" als Text, ist aber
        // ein anderes Segment — darf NICHT als "meldungen"-Kind durchgehen.
        assert_eq!(key_fuer_pfad("/api/einsaetze/{id}/meldungenarchiv"), None);
    }
}
