pub mod bootstrap;
pub mod password;
pub mod session;

use serde::Serialize;

/// Wert der System-Rolle für Administratoren (serverweite Verwaltung).
pub const ROLLE_ADMIN: &str = "admin";
/// Wert der System-Rolle für reguläre Benutzer ohne Admin-Rechte.
pub const ROLLE_KEINER: &str = "keiner";

/// Org-weite Rolle, die das Anlegen von Einsätzen erlaubt (orthogonal zu `system_rolle`).
pub const ORG_ROLLE_FUEHRUNGSKRAFT: &str = "fuehrungskraft";
/// Org-weite Rolle ohne besondere Befugnisse (Default).
pub const ORG_ROLLE_KEINE: &str = "keine";

/// Interner Benutzer-Datensatz inklusive Passwort-Hash.
/// Wird NICHT direkt serialisiert — für API-Antworten `anzeige()` verwenden.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Benutzer {
    pub id: i64,
    pub org_id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    pub passwort_hash: String,
    pub system_rolle: String,
    pub org_rolle: String,
    pub aktiv: bool,
    pub erstellt_at: String,
}

impl Benutzer {
    /// Ob dieser Benutzer die System-Rolle Admin hat.
    pub fn ist_admin(&self) -> bool {
        self.system_rolle == ROLLE_ADMIN
    }

    /// Ob dieser Benutzer Einsätze anlegen darf: System-Admin ODER org-weite Führungskraft.
    pub fn darf_einsatz_anlegen(&self) -> bool {
        self.ist_admin() || self.org_rolle == ORG_ROLLE_FUEHRUNGSKRAFT
    }

    /// Sichere, serialisierbare Darstellung ohne Passwort-Hash.
    pub fn anzeige(&self) -> BenutzerAnzeige {
        BenutzerAnzeige {
            id: self.id,
            anzeigename: self.anzeigename.clone(),
            benutzername: self.benutzername.clone(),
            system_rolle: self.system_rolle.clone(),
            org_rolle: self.org_rolle.clone(),
            aktiv: self.aktiv,
            erstellt_at: self.erstellt_at.clone(),
        }
    }
}

/// Öffentliche Benutzerdarstellung (ohne Passwort-Hash) für API-Antworten.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct BenutzerAnzeige {
    pub id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    pub system_rolle: String,
    pub org_rolle: String,
    pub aktiv: bool,
    pub erstellt_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn benutzer_mit(system_rolle: &str, org_rolle: &str) -> Benutzer {
        Benutzer {
            id: 1,
            org_id: 1,
            anzeigename: "Test".into(),
            benutzername: "test".into(),
            passwort_hash: "h".into(),
            system_rolle: system_rolle.into(),
            org_rolle: org_rolle.into(),
            aktiv: true,
            erstellt_at: "2026-05-23".into(),
        }
    }

    #[test]
    fn admin_darf_einsatz_anlegen() {
        assert!(benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE).darf_einsatz_anlegen());
    }

    #[test]
    fn fuehrungskraft_darf_einsatz_anlegen() {
        assert!(benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT).darf_einsatz_anlegen());
    }

    #[test]
    fn normaler_benutzer_darf_nicht_anlegen() {
        assert!(!benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE).darf_einsatz_anlegen());
    }
}
