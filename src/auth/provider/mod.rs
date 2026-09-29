//! Auth-Provider-Fundament (LFH-57): Login-Wege als serverweit an-/abschaltbare
//! Provider. Alle Flows münden weiterhin in `session::anlegen`.
pub mod password;
pub mod registry;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Stabile Provider-IDs (Primärschlüssel/Override-Key in `auth_provider`).
pub const ID_PASSWORT: &str = "passwort";
pub const ID_DEV: &str = "dev";
/// OIDC/SSO-Provider (LFH-41, Increment 3). JIT-provisionierte Konten sind bewusst NICHT
/// admin-tauglich (siehe `registry`s `ProviderId::ist_admin_tauglich`, Lockout-Schutz-MUST).
pub const ID_OIDC: &str = "oidc";
/// App-eigener Passkey/WebAuthn-Provider (LFH-275, Increment 4). Enrollment läuft
/// authentifiziert (bestehendes Konto), Login ist danach passwortlos möglich. Bewusst NICHT
/// admin-tauglich (siehe `registry`s `ProviderId::ist_admin_tauglich`) — Passwort bleibt der
/// garantierte Admin-Weg, bis Admin-Linking/Policy das ändert (LFH-277).
pub const ID_WEBAUTHN: &str = "webauthn";

wire_enum! {
    /// Art eines Auth-Providers — bestimmt, wie das Frontend den Login rendert.
    /// Wire == snake_case (Enum-Wire-Kontrakt).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AuthProviderTyp {
        /// Lokaler Benutzername+Passwort-Login (heutiger Flow).
        Passwort => "passwort",
        /// Dev-Schnellanmeldung (nur mit Cargo-Feature `dev-seeds`).
        Dev => "dev",
        /// OIDC/SSO-Login gegen einen externen Identity-Provider (LFH-41, Increment 3).
        Oidc => "oidc",
        /// App-eigener Passkey/WebAuthn-Login (LFH-275, Increment 4).
        Webauthn => "webauthn",
    }
}

/// Öffentliche Darstellung eines Providers für die Login-UI (`GET /api/auth/providers`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AuthProviderAnzeige {
    /// Stabile ID (z.B. "passwort", "dev").
    pub id: String,
    pub typ: AuthProviderTyp,
    /// Menschenlesbarer Anzeigename für Buttons/Labels.
    pub anzeigename: String,
    pub aktiviert: bool,
}
