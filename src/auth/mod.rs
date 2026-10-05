pub mod audit;
pub mod benutzername;
pub mod bootstrap;
pub mod huelle;
pub mod oidc;
pub mod password;
pub mod provider;
pub mod rate_limit;
pub mod session;
pub mod totp;
pub mod webauthn;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Wert der System-Rolle für Administratoren (serverweite Verwaltung).
pub const ROLLE_ADMIN: &str = SystemRolle::Admin.as_str();
/// Wert der System-Rolle für reguläre Benutzer ohne Admin-Rechte.
pub const ROLLE_KEINER: &str = SystemRolle::Keiner.as_str();

/// Org-weite Rolle, die das Anlegen von Einsätzen erlaubt (orthogonal zu `system_rolle`).
pub const ORG_ROLLE_FUEHRUNGSKRAFT: &str = OrgRolle::Fuehrungskraft.as_str();
/// Org-weite Rolle ohne besondere Befugnisse (Default).
pub const ORG_ROLLE_KEINE: &str = OrgRolle::Keine.as_str();

/// Sentinel-`passwort_hash` für SSO-only-Benutzer (JIT-provisioniert via OIDC, LFH-41
/// Increment 3): bewusst KEIN `$argon2`-PHC-String, damit `password::verifizieren`
/// dagegen sicher `false` liefert (kein lokaler Passwort-Login für SSO-Konten möglich).
/// „Sentinel statt Migration": KEINE `passwort_hash`-nullable-Spalte, KEIN `benutzer`-
/// Tabellen-Rebuild (40 FK-Abhängige) — der bestehende NOT-NULL-Text-Spaltentyp bleibt.
///
/// Weil der Wert nicht parsbar ist, kehrte `verifizieren` früher ohne jeden Argon2-Lauf
/// zurück — und die Antwortzeit verriet damit, welche Konten SSO-only sind. Der Zweig brennt
/// seit LFH-310 einen Wegwerf-Hash; wer hier etwas ändert, liest die Begründung an
/// [`password::verifizieren`] mit.
pub const PASSWORT_HASH_SSO_ONLY: &str = "!sso-kein-lokales-passwort";

wire_enum! {
    /// System-Rolle (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `system_rolle`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum SystemRolle {
        Admin => "admin",
        Keiner => "keiner",
    }
    try_from = |s| format!("Ungültige SystemRolle: {s}");
}

wire_enum! {
    /// Org-weite Rolle (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `org_rolle`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum OrgRolle {
        Fuehrungskraft => "fuehrungskraft",
        Keine => "keine",
    }
    try_from = |s| format!("Ungültige OrgRolle: {s}");
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
    ///
    /// `totp_aktiviert` kommt bewusst als Parameter vom Aufrufer, NICHT aus `self`:
    /// `Benutzer`s FromRow-Query-Feldliste ist an mehreren unabhängigen Stellen (Session-
    /// Auflösung, Passwort-/OIDC-/WebAuthn-Login) dupliziert (Memory:
    /// sqlx-09-sqlsafestr-query-as) und trägt bewusst KEINE `totp_*`-Spalten — ein neues Feld
    /// hier hätte alle diese SELECTs anfassen müssen (LFH-43 Task 6). Aufrufer, die den
    /// MFA-Status bereits kennen (z. B. `login`s Branch-Bool, `totp_finish`s Erfolgsfall) oder
    /// ihn gezielt nachladen (`me`), reichen ihn hier durch.
    pub fn anzeige(&self, totp_aktiviert: bool) -> BenutzerAnzeige {
        BenutzerAnzeige {
            id: self.id,
            org_id: self.org_id,
            anzeigename: self.anzeigename.clone(),
            benutzername: self.benutzername.clone(),
            system_rolle: self.system_rolle,
            org_rolle: self.org_rolle,
            aktiv: self.aktiv,
            erstellt_at: self.erstellt_at.clone(),
            totp_aktiviert,
            passwort_gesetzt: self.passwort_hash != PASSWORT_HASH_SSO_ONLY,
        }
    }
}

/// Öffentliche Benutzerdarstellung (ohne Passwort-Hash) für API-Antworten.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct BenutzerAnzeige {
    pub id: i64,
    /// Organisation des Benutzers (LFH-753): der Client spiegelt damit Rechte, die an der
    /// Einsatz-Org hängen (Frist nur für den Admin der Einsatz-Org).
    pub org_id: i64,
    pub anzeigename: String,
    pub benutzername: String,
    #[sqlx(try_from = "String")]
    pub system_rolle: SystemRolle,
    #[sqlx(try_from = "String")]
    pub org_rolle: OrgRolle,
    pub aktiv: bool,
    pub erstellt_at: String,
    /// MFA-Status (LFH-43, Increment 5 Task 6): `true`, wenn der Nutzer TOTP als zweiten Faktor
    /// aktiviert hat. Zeigt sowohl der Admin-Benutzerliste als auch dem eigenen Profil
    /// (`GET /api/auth/me`) den Status an.
    pub totp_aktiviert: bool,
    // Herleitung: `anzeige()` vergleicht den Hash mit `PASSWORT_HASH_SSO_ONLY`, die SQL-Abfragen
    // in `routes::benutzer` tun es mit gebundenem Sentinel (`ANZEIGE_SPALTEN`). Der `///`-Text
    // landet im API-Vertrag (openapi.json), deshalb steht das hier und nicht dort.
    /// `true`, wenn das Konto ein lokales Passwort hat; ein SSO-only-Konto hat keins (LFH-828).
    /// Das Profil bietet den Passwortwechsel nur dann an. Hash und Sentinel verlassen den Server
    /// nie.
    pub passwort_gesetzt: bool,
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
