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

wire_enum! {
    /// Anmeldeweg eines Eintrags der Anmeldespur (`auth_audit.provider`) und einer Sitzung
    /// (`session.anmeldeweg`, LFH-1152). Geschlossen, damit ein neuer Weg den Typecheck des
    /// Zugangsprotokolls bricht, statt dort roh zu erscheinen (Schema-Anker, LFH-120).
    // Die `&str`-Konstanten der Wege bleiben; der Test unten hält sie mit dem Enum gleich.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Anmeldeweg {
        Passwort => "passwort",
        Dev => "dev",
        Oidc => "oidc",
        Webauthn => "webauthn",
        /// Anmeldung, die mit dem Zweitfaktor abschließt ([`crate::auth::totp::PROVIDER`]).
        Totp => "totp",
        /// Code-Einlösung eines gekoppelten Geräts ([`crate::geraet::PROVIDER`]).
        Geraetecode => "geraetecode",
        /// Anmeldung der macOS-Hülle über den Systembrowser ([`crate::auth::huelle::PROVIDER`]).
        Systembrowser => "systembrowser",
        /// Der Weg ist nicht bekannt: Abmeldung oder Beenden einer Sitzung, die vor LFH-1152
        /// angelegt wurde und sich ihren Weg deshalb nicht gemerkt hat.
        Unbekannt => "unbekannt",
    }
}

impl Anmeldeweg {
    /// Liest einen gespeicherten Anmeldeweg; fehlt er oder ist er fremd, [`Anmeldeweg::Unbekannt`].
    pub fn aus_gespeichert(wert: Option<&str>) -> Anmeldeweg {
        wert.and_then(Anmeldeweg::parse)
            .unwrap_or(Anmeldeweg::Unbekannt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Jede Kennung, die ein Anmeldeweg in die Spur schreibt, ist ein [`Anmeldeweg`] (LFH-1152).
    /// Fehlt hier eine, stünde sie im Zugangsprotokoll roh.
    #[test]
    fn jede_geschriebene_kennung_ist_ein_anmeldeweg() {
        for kennung in [
            ID_PASSWORT,
            ID_DEV,
            ID_OIDC,
            ID_WEBAUTHN,
            crate::auth::totp::PROVIDER,
            crate::geraet::PROVIDER,
            crate::auth::huelle::PROVIDER,
        ] {
            assert!(
                Anmeldeweg::parse(kennung).is_some(),
                "Anmeldeweg `{kennung}` fehlt im Enum"
            );
        }
    }

    #[test]
    fn fehlender_oder_fremder_weg_ist_unbekannt() {
        assert_eq!(Anmeldeweg::aus_gespeichert(None), Anmeldeweg::Unbekannt);
        assert_eq!(
            Anmeldeweg::aus_gespeichert(Some("faxgeraet")),
            Anmeldeweg::Unbekannt
        );
        assert_eq!(
            Anmeldeweg::aus_gespeichert(Some("webauthn")),
            Anmeldeweg::Webauthn
        );
    }
}
