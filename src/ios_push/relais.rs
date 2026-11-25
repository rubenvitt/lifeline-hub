//! Wire-Typen des Push-Relais (`push-relais/src/api.rs`, `senden.rs`), hier gespiegelt: der
//! Server hängt nicht von der Relais-Crate ab.

use serde::{Deserialize, Serialize};

/// APNs-Umgebung des Geräte-Tokens.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Umgebung {
    Sandbox,
    Production,
}

/// Dringlichkeit: `Alarm` ist zeitkritisch, `Hinweis` aktiv.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Stufe {
    Alarm,
    Hinweis,
}

/// Eine Nachricht an ein Gerät. `nutzlast` ist der verschlüsselte Teil, Base64url.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelaisNachricht {
    pub token: String,
    pub umgebung: Umgebung,
    pub stufe: Stufe,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kollaps: Option<String>,
    pub nutzlast: String,
    /// Bundle-ID der Ziel-App (ADR-0106); ohne gilt die Lifeline-App des Relais.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thema: Option<String>,
}

/// Ergebnis je Nachricht.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RelaisErgebnis {
    Zugestellt,
    /// Das Gerät ist abgemeldet oder das Token falsch: die Anmeldung kann weg.
    TokenUngueltig,
    Gedrosselt,
    Fehler,
}

#[derive(Serialize)]
pub(super) struct RegistrierungAnfrage<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kontakt: Option<&'a str>,
    pub version: &'a str,
}

#[derive(Deserialize)]
pub(super) struct RegistrierungAntwort {
    pub server_id: String,
    pub geheimnis: String,
}

#[derive(Serialize)]
pub(super) struct SendenAnfrage<'a> {
    pub nachrichten: &'a [RelaisNachricht],
}

#[derive(Deserialize)]
pub(super) struct SendenAntwort {
    pub ergebnisse: Vec<RelaisErgebnis>,
}

/// Warum ein Aufruf des Relais scheiterte. Enthält nie Token oder Nutzlast.
#[derive(Debug)]
pub enum RelaisFehler {
    /// Das Relais hat diesen Server gesperrt; bis zu einem neuen Zugang kein Kontakt mehr.
    Gesperrt,
    /// Das Relais hat den Zugang auch nach neuer Registrierung abgewiesen.
    Abgewiesen,
    /// Minutenlimit des Relais erreicht (429).
    Gedrosselt,
    Antwort(String),
    Netz(String),
    Speicher(String),
}

impl std::fmt::Display for RelaisFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Gesperrt => f.write_str("das Relais hat diesen Server gesperrt"),
            Self::Abgewiesen => f.write_str("das Relais weist den Zugang ab"),
            Self::Gedrosselt => f.write_str("das Relais drosselt"),
            Self::Antwort(a) => write!(f, "unerwartete Antwort des Relais: {a}"),
            Self::Netz(a) => write!(f, "Relais nicht erreichbar: {a}"),
            Self::Speicher(a) => write!(f, "Speicherfehler: {a}"),
        }
    }
}

impl std::error::Error for RelaisFehler {}
