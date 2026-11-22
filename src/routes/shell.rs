//! Hüllen-Vertrag `GET /api/shell` (LLH-1978, Spec `huellen-vertrag`, design.md D4).
//!
//! Eine App-Hülle (iOS, später Desktop) fragt hier ohne Anmeldung, welche Server-Version läuft
//! und welchen Hüllen-Vertrag der Server spricht. Die Antwort braucht keine Datenbank und
//! antwortet deshalb auch bei gestörter DB mit 200; Erreichbarkeit prüft die Hülle über das
//! Laden der Oberfläche, nicht über diesen Endpunkt.

use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

/// Version des Vertrags zwischen Server und App-Hülle.
///
/// Bruchregel: der Wert steigt **nur**, wenn eine Hülle, die den bisherigen Wert kennt, mit
/// diesem Server nicht mehr richtig arbeiten kann. Eine Erweiterung, die ältere Hüllen nicht
/// stört (etwa ein neues Feld in [`ShellInfo`] oder eine neue, optionale Fähigkeit), lässt ihn
/// unverändert. Bestehende Felder werden nie umbenannt, entfernt oder umgedeutet.
///
/// Verlauf: 1 mit LLH-1978; 2 mit LLH-1979, weil der Login-Pfad der Hüllen von
/// `/api/auth/app-code/einloesen` zu `/api/auth/app-code/redeem` wurde (ADR-0082).
pub const SHELL_CONTRACT: u32 = 2;

/// Antwort von `GET /api/shell`. Felder kommen nur hinzu (Spec `huellen-vertrag`).
#[derive(Debug, Serialize, ToSchema)]
pub struct ShellInfo {
    /// Laufende Anwendungsversion, dieselbe wie in `GET /api/health`.
    pub version: String,
    /// Hüllen-Vertrag des Servers, eine ganze Zahl ≥ 1 ([`SHELL_CONTRACT`]).
    pub shell_contract: u32,
}

/// `GET /api/shell`: anonym, ohne Datenbank.
pub async fn load_shell() -> Json<ShellInfo> {
    Json(ShellInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        shell_contract: SHELL_CONTRACT,
    })
}
