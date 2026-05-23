pub mod bootstrap;
pub mod password;
pub mod session;

use serde::Serialize;

/// Wert der System-Rolle für Administratoren (serverweite Verwaltung).
pub const ROLLE_ADMIN: &str = "admin";
/// Wert der System-Rolle für reguläre Benutzer ohne Admin-Rechte.
pub const ROLLE_KEINER: &str = "keiner";

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
    pub aktiv: bool,
    pub erstellt_at: String,
}

impl Benutzer {
    /// Ob dieser Benutzer die System-Rolle Admin hat.
    pub fn ist_admin(&self) -> bool {
        self.system_rolle == ROLLE_ADMIN
    }

    /// Sichere, serialisierbare Darstellung ohne Passwort-Hash.
    pub fn anzeige(&self) -> BenutzerAnzeige {
        BenutzerAnzeige {
            id: self.id,
            anzeigename: self.anzeigename.clone(),
            benutzername: self.benutzername.clone(),
            system_rolle: self.system_rolle.clone(),
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
    pub aktiv: bool,
    pub erstellt_at: String,
}
