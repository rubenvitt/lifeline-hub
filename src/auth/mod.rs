pub mod bootstrap;
pub mod password;
pub mod provider;
pub mod session;

use serde::Serialize;
use utoipa::ToSchema;

/// Wert der System-Rolle für Administratoren (serverweite Verwaltung).
pub const ROLLE_ADMIN: &str = "admin";
/// Wert der System-Rolle für reguläre Benutzer ohne Admin-Rechte.
pub const ROLLE_KEINER: &str = "keiner";

/// Org-weite Rolle, die das Anlegen von Einsätzen erlaubt (orthogonal zu `system_rolle`).
pub const ORG_ROLLE_FUEHRUNGSKRAFT: &str = "fuehrungskraft";
/// Org-weite Rolle ohne besondere Befugnisse (Default).
pub const ORG_ROLLE_KEINE: &str = "keine";

/// Sentinel-`passwort_hash` für SSO-only-Benutzer (JIT-provisioniert via OIDC, LFH-41
/// Increment 3): bewusst KEIN `$argon2`-PHC-String, damit `password::verifizieren`
/// dagegen sicher `false` liefert (kein lokaler Passwort-Login für SSO-Konten möglich).
/// „Sentinel statt Migration": KEINE `passwort_hash`-nullable-Spalte, KEIN `benutzer`-
/// Tabellen-Rebuild (40 FK-Abhängige) — der bestehende NOT-NULL-Text-Spaltentyp bleibt.
pub const PASSWORT_HASH_SSO_ONLY: &str = "!sso-kein-lokales-passwort";

/// System-Rolle (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `system_rolle`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SystemRolle {
    Admin,
    Keiner,
}

impl SystemRolle {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            SystemRolle::Admin => ROLLE_ADMIN,
            SystemRolle::Keiner => ROLLE_KEINER,
        }
    }

    /// Parst einen gespeicherten/übergebenen Rollenwert; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<SystemRolle> {
        match s {
            ROLLE_ADMIN => Some(SystemRolle::Admin),
            ROLLE_KEINER => Some(SystemRolle::Keiner),
            _ => None,
        }
    }
}

impl TryFrom<String> for SystemRolle {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        SystemRolle::parse(&s).ok_or_else(|| format!("Ungültige SystemRolle: {s}"))
    }
}

/// Org-weite Rolle (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `org_rolle`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OrgRolle {
    Fuehrungskraft,
    Keine,
}

impl OrgRolle {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            OrgRolle::Fuehrungskraft => ORG_ROLLE_FUEHRUNGSKRAFT,
            OrgRolle::Keine => ORG_ROLLE_KEINE,
        }
    }

    /// Parst einen gespeicherten/übergebenen Rollenwert; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<OrgRolle> {
        match s {
            ORG_ROLLE_FUEHRUNGSKRAFT => Some(OrgRolle::Fuehrungskraft),
            ORG_ROLLE_KEINE => Some(OrgRolle::Keine),
            _ => None,
        }
    }
}

impl TryFrom<String> for OrgRolle {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        OrgRolle::parse(&s).ok_or_else(|| format!("Ungültige OrgRolle: {s}"))
    }
}

/// Interner Benutzer-Datensatz inklusive Passwort-Hash.
/// Wird NICHT direkt serialisiert — für API-Antworten `anzeige()` verwenden.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Benutzer {
    pub id: i64,
    pub org_id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    pub passwort_hash: String,
    #[sqlx(try_from = "String")]
    pub system_rolle: SystemRolle,
    #[sqlx(try_from = "String")]
    pub org_rolle: OrgRolle,
    pub aktiv: bool,
    pub erstellt_at: String,
}

impl Benutzer {
    /// Ob dieser Benutzer die System-Rolle Admin hat.
    pub fn ist_admin(&self) -> bool {
        self.system_rolle == SystemRolle::Admin
    }

    /// Ob dieser Benutzer Einsätze anlegen darf: System-Admin ODER org-weite Führungskraft.
    ///
    /// Bewusst getrennt von [`Self::ist_hoehere_berechtigung`], auch wenn das Prädikat
    /// heute identisch ist: „anlegen" und „erweiterter Lesezugriff" sind verschiedene
    /// Konzepte. Würde der erweiterte Lesezugriff künftig auf weitere Rollen ausgedehnt,
    /// soll das nicht automatisch das Anlegerecht aufweichen (und umgekehrt).
    pub fn darf_einsatz_anlegen(&self) -> bool {
        self.ist_admin() || self.org_rolle == OrgRolle::Fuehrungskraft
    }

    /// Ob dieser Benutzer den Admin-Bereich sehen darf (Stammdaten + globale
    /// Einstellungen lesen): System-Admin ODER org-weite Führungskraft.
    ///
    /// Bewusst eigenständig — „Admin-Bereich lesen" und „Einsatz anlegen" sind
    /// verschiedene Konzepte, auch wenn das Prädikat heute identisch ist.
    pub fn darf_admin_bereich(&self) -> bool {
        self.ist_admin() || self.org_rolle == OrgRolle::Fuehrungskraft
    }

    /// Höhere Berechtigung mit erweitertem Einsatz-Zugriff: System-Admin oder
    /// org-weite Führungskraft. Darf u.a. abgeschlossene Einsätze auch nach der
    /// DSGVO-Schonfrist lesen. Der org-übergreifende Lesezugriff auf FREMDE Einsätze
    /// ist bewusst NICHT mehr an dieses Prädikat gebunden, sondern an
    /// [`Self::darf_fremdeinsatz_lesen`] (Org-Isolation, LFH-115): serverweit nur der
    /// System-Admin, die org-weite Führungskraft dagegen nur innerhalb der eigenen Org.
    ///
    /// Bewusst eigenständig (siehe [`Self::darf_einsatz_anlegen`]); keine Delegation,
    /// damit sich die beiden Berechtigungsmengen unabhängig entwickeln können.
    pub fn ist_hoehere_berechtigung(&self) -> bool {
        self.ist_admin() || self.org_rolle == OrgRolle::Fuehrungskraft
    }

    /// Ob dieser Benutzer einen Einsatz einer (möglicherweise fremden) Organisation
    /// ohne Mitgliedschaft lesen darf (LFH-115, Org-Isolation):
    /// - System-Admin (serverweite Verwaltung): IMMER, auch org-übergreifend.
    /// - Org-weite Führungskraft: NUR wenn der Einsatz zur eigenen Organisation gehört
    ///   (`self.org_id == einsatz_org_id`).
    /// - Alle anderen: nie (Zugriff läuft dann über die Mitgliedschaft).
    ///
    /// Chokepoint für den Cross-Org-Lesezugriff; wird aus [`crate::einsatz::berechtigung::darf_lesen`]
    /// heraus aufgerufen, nachdem die DSGVO-Hard-Blocks (Tombstone/Aufbewahrungsfrist) geprüft sind.
    pub fn darf_fremdeinsatz_lesen(&self, einsatz_org_id: i64) -> bool {
        self.ist_admin()
            || (self.org_rolle == OrgRolle::Fuehrungskraft && self.org_id == einsatz_org_id)
    }

    /// Sichere, serialisierbare Darstellung ohne Passwort-Hash.
    pub fn anzeige(&self) -> BenutzerAnzeige {
        BenutzerAnzeige {
            id: self.id,
            anzeigename: self.anzeigename.clone(),
            benutzername: self.benutzername.clone(),
            system_rolle: self.system_rolle,
            org_rolle: self.org_rolle,
            aktiv: self.aktiv,
            erstellt_at: self.erstellt_at.clone(),
        }
    }
}

/// Öffentliche Benutzerdarstellung (ohne Passwort-Hash) für API-Antworten.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct BenutzerAnzeige {
    pub id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    #[sqlx(try_from = "String")]
    pub system_rolle: SystemRolle,
    #[sqlx(try_from = "String")]
    pub org_rolle: OrgRolle,
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
            system_rolle: SystemRolle::parse(system_rolle).unwrap(),
            org_rolle: OrgRolle::parse(org_rolle).unwrap(),
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

    #[test]
    fn admin_ist_hoehere_berechtigung() {
        assert!(benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE).ist_hoehere_berechtigung());
    }

    #[test]
    fn fuehrungskraft_ist_hoehere_berechtigung() {
        assert!(benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT).ist_hoehere_berechtigung());
    }

    #[test]
    fn normaler_benutzer_ist_keine_hoehere_berechtigung() {
        assert!(!benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE).ist_hoehere_berechtigung());
    }

    // --- darf_fremdeinsatz_lesen: Org-Isolation beim Lesen (LFH-115) ---
    // benutzer_mit(...) hat org_id = 1; variiert wird der einsatz_org_id-Parameter.

    #[test]
    fn admin_darf_fremdeinsatz_lesen() {
        // System-Admin ist serverweit: liest auch Einsätze fremder Organisationen.
        assert!(benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE).darf_fremdeinsatz_lesen(2));
    }

    #[test]
    fn fuehrungskraft_darf_eigenen_org_einsatz_lesen() {
        // Org-Führungskraft (org_id=1) darf Einsätze der eigenen Org auch ohne Mitgliedschaft lesen.
        assert!(benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT).darf_fremdeinsatz_lesen(1));
    }

    #[test]
    fn fuehrungskraft_darf_fremden_org_einsatz_nicht_lesen() {
        // Die geschlossene Lücke: Führungskraft aus Org 1 darf Einsatz aus Org 2 NICHT lesen.
        assert!(!benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT).darf_fremdeinsatz_lesen(2));
    }

    #[test]
    fn normaler_benutzer_darf_keinen_fremdeinsatz_lesen() {
        assert!(!benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE).darf_fremdeinsatz_lesen(1));
    }
}
