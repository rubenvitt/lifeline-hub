//! Auth-Provider-Fundament (LFH-57): Login-Wege als serverweit an-/abschaltbare
//! Provider. Alle Flows münden weiterhin in `session::anlegen`.
pub mod password;
pub mod registry;

use serde::Serialize;
use utoipa::ToSchema;

/// Stabile Provider-IDs (Primärschlüssel/Override-Key in `auth_provider`).
pub const ID_PASSWORT: &str = "passwort";
pub const ID_DEV: &str = "dev";

/// Art eines Auth-Providers — bestimmt, wie das Frontend den Login rendert.
/// Wire == snake_case (Enum-Wire-Kontrakt).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthProviderTyp {
    /// Lokaler Benutzername+Passwort-Login (heutiger Flow).
    Passwort,
    /// Dev-Schnellanmeldung (nur mit Cargo-Feature `dev-seeds`).
    Dev,
}

impl AuthProviderTyp {
    /// Wire-/DB-Stringrepräsentation. MUSS dem serde-Wire entsprechen (enum_wire_kontrakt).
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthProviderTyp::Passwort => "passwort",
            AuthProviderTyp::Dev => "dev",
        }
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
