use crate::auth::{
    ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
};

/// Ein Seed-Benutzer. **Interne** Struktur — bewusst NICHT `Serialize`:
/// `system_rolle`/`org_rolle` dürfen nicht über den Dev-Endpoint nach außen.
/// Für die Endpoint-Antwort gibt es den separaten `DevBenutzerResponse`-Typ.
pub struct DevBenutzer {
    pub benutzername: &'static str,
    /// Einheitliches Klartext-Dev-Passwort (siehe SEED_PASSWORT).
    pub passwort: &'static str,
    pub anzeigename: &'static str,
    pub system_rolle: &'static str,
    pub org_rolle: &'static str,
    /// Menschenlesbares Rollen-Label, nur für die Anzeige im Login-Picker.
    pub rolle_anzeige: &'static str,
    pub aktiv: bool,
}

/// Einheitliches Dev-Passwort für alle Seed-Benutzer.
pub const SEED_PASSWORT: &str = "dev";

/// Source of Truth für Seeding UND /api/dev/users. Nur hier gepflegt.
pub const SEED_BENUTZER: &[DevBenutzer] = &[
    DevBenutzer {
        benutzername: "admin",
        passwort: SEED_PASSWORT,
        anzeigename: "Administrator",
        system_rolle: ROLLE_ADMIN,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Admin",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "leitung",
        passwort: SEED_PASSWORT,
        anzeigename: "Führungskraft",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_FUEHRUNGSKRAFT,
        rolle_anzeige: "Führungskraft",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "mitglied",
        passwort: SEED_PASSWORT,
        anzeigename: "Einsatzkraft",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Benutzer",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "inaktiv",
        passwort: SEED_PASSWORT,
        anzeigename: "Gesperrtes Konto",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Benutzer",
        aktiv: false,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_benutzer_enthaelt_erwartete_konten() {
        let namen: Vec<&str> = SEED_BENUTZER.iter().map(|b| b.benutzername).collect();
        assert!(namen.contains(&"admin"));
        assert!(namen.contains(&"leitung"));
        assert!(namen.contains(&"mitglied"));
        assert!(namen.contains(&"inaktiv"));
        // Einheitliches Dev-Passwort für alle.
        assert!(SEED_BENUTZER.iter().all(|b| b.passwort == "dev"));
        // 'inaktiv' ist nicht aktiv (Test der Login-Sperre).
        let inaktiv = SEED_BENUTZER
            .iter()
            .find(|b| b.benutzername == "inaktiv")
            .unwrap();
        assert!(!inaktiv.aktiv);
    }
}
