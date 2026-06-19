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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_sind_eindeutig() {
        let mut sortiert = MODUL_KEYS.to_vec();
        sortiert.sort_unstable();
        sortiert.dedup();
        assert_eq!(sortiert.len(), MODUL_KEYS.len(), "Modul-Keys müssen eindeutig sein");
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
            assert!(ist_gueltiger_modul_key(key), "{key} muss ein gültiger Modul-Key sein");
        }
    }

    #[test]
    fn benoetigte_rolle_validierung() {
        assert!(ist_gueltige_benoetigte_rolle("admin"));
        assert!(ist_gueltige_benoetigte_rolle("fuehrungskraft"));
        assert!(!ist_gueltige_benoetigte_rolle("einsatzleitung"));
        assert!(!ist_gueltige_benoetigte_rolle(""));
    }
}
