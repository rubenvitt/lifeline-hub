//! Unterschriftsschlüssel der Org-Admins (LLH-1490, Spec `org-admin-unterschrift`, design.md D7,
//! D8): ein Passkey nur zum Unterschreiben, getrennt von jedem Anmeldeweg. Gekoppelte Instanzen
//! bekommen die öffentlichen Schlüssel der Org und können damit eine Erklärung einem Menschen
//! zuordnen, statt dem Server zu glauben, der sie überbringt (Konzept, Entscheidung 9).
//!
//! Vertrauenskette: den Grundstock liefert die Kopplung (der Code bindet ihn). Jeden weiteren
//! Schlüssel nimmt eine gekoppelte Instanz nur an, wenn ein ihr schon bekannter Schlüssel derselben
//! Org ihn gegengezeichnet hat; einen Widerruf nimmt sie ohne Gegenzeichnung an, er schränkt nur
//! ein.

pub mod pruefen;
pub mod repo;
pub mod zeremonie;

use crate::wire_enum::wire_enum;
use pruefen::UnterschriftAssertion;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

static RP: std::sync::OnceLock<(String, String)> = std::sync::OnceLock::new();

/// Setzt RP-ID und Herkunft dieser Instanz einmal beim Start, wenn Passkeys eingerichtet sind.
/// Ein Unterschriftsschlüssel trägt beides, damit eine andere Instanz seine Unterschrift prüfen
/// kann.
pub fn set_rp(rp_id: String, origin: String) {
    let _ = RP.set((rp_id, origin));
}

/// RP-ID und Herkunft; `None`, wenn Passkeys hier nicht eingerichtet sind.
pub fn rp() -> Option<(&'static str, &'static str)> {
    RP.get().map(|(a, b)| (a.as_str(), b.as_str()))
}

/// Der einzige angenommene Algorithmus (ES256, P-256); `webauthn-rs` bietet bei Passkeys sonst
/// nur RS256 an.
pub const ALG_ES256: &str = "es256";
/// `typ` einer Erklärung, mit der ein Admin einen neuen Schlüssel gegenzeichnet.
pub const TYP_AUFNAHME: &str = "unterschriftsschluessel-aufnahme";

wire_enum! {
    /// Woher ein Unterschriftsschlüssel stammt.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum UnterschriftSchluesselHerkunft {
        /// An dieser Instanz registriert.
        Lokal => "lokal",
        /// Von einer gekoppelten Instanz übernommen.
        Gegenueber => "gegenueber",
    }
}

wire_enum! {
    /// Zustand eines Unterschriftsschlüssels.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum UnterschriftSchluesselZustand {
        /// Registriert, die Gegenzeichnung eines bekannten Admins steht aus; wird nicht verteilt.
        WartetAufGegenzeichnung => "wartet_auf_gegenzeichnung",
        Gueltig => "gueltig",
        Widerrufen => "widerrufen",
    }
}

/// Eine Gegenzeichnung: die Erklärung (wörtlich, ihr SHA-256 ist die Challenge), die UnterschriftAssertion und
/// welcher Schlüssel unterschrieben hat.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Gegenzeichnung {
    pub erklaerung: String,
    pub assertion: UnterschriftAssertion,
    pub unterzeichner_credential_id: String,
}

/// Inhalt einer Aufnahme-Erklärung (design.md D7). Als JSON in fester Feldreihenfolge; geprüft
/// wird gegen den wörtlichen Text, nicht gegen eine Neuserialisierung.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AufnahmeErklaerung {
    pub typ: String,
    /// Org-Kennung über Instanzgrenzen (`<instanzkennung>/<org_id>` der registrierenden Instanz).
    pub org: String,
    pub credential_id: String,
    /// SHA-256 des neuen Schlüssels (Bytes des SEC1-Punkts), Base64url.
    pub schluessel_hash: String,
    pub fingerabdruck: String,
    pub inhaber: String,
    pub zeitpunkt: String,
}

/// Ein Schlüssel, wie er an gekoppelte Instanzen geht (Grundstock beim Koppeln, Nachlieferung
/// beim Melden). `id` ist die id an der registrierenden Instanz.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnterschriftSchluesselLieferung {
    pub id: i64,
    pub benutzer_name: String,
    pub credential_id: String,
    pub alg: String,
    pub schluessel: String,
    pub rp_id: String,
    pub origin: String,
    pub bezeichnung: String,
    pub zustand: UnterschriftSchluesselZustand,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gegenzeichnung: Option<Gegenzeichnung>,
    pub stand: i64,
}

/// Ein Schlüssel, wie die Admin-Seite ihn zeigt.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct UnterschriftSchluesselAnzeige {
    pub id: i64,
    pub benutzer_name: String,
    pub bezeichnung: String,
    pub fingerabdruck: String,
    pub zustand: UnterschriftSchluesselZustand,
    pub herkunft: UnterschriftSchluesselHerkunft,
    /// Gehört dem anfragenden Admin.
    pub eigen: bool,
    pub erstellt_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widerrufen_at: Option<String>,
    /// Bei `herkunft = gegenueber`: Name der Org dort.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fremde_org_name: Option<String>,
    /// Bei einer Gegenzeichnung: wer gegengezeichnet hat.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gegengezeichnet_von: Option<String>,
}
