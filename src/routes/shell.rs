//! Hüllen-Vertrag `GET /api/shell` (LLH-1978, Spec `huellen-vertrag`, design.md D4).
//!
//! Eine App-Hülle (iOS, später Desktop) fragt hier ohne Anmeldung, welche Server-Version läuft
//! und welchen Hüllen-Vertrag der Server spricht. Die Antwort braucht keine Datenbank und
//! antwortet deshalb auch bei gestörter DB mit 200; Erreichbarkeit prüft die Hülle über das
//! Laden der Oberfläche, nicht über diesen Endpunkt.
//!
//! Seit LLH-1980 nennt die Antwort außerdem die Assets, die die Oberfläche ohne Server braucht;
//! die iOS-Hülle wärmt sie vor und startet damit auch ohne erreichbaren Server.

use std::sync::LazyLock;

use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

/// Version des Vertrags zwischen Server und App-Hülle.
///
/// Bruchregel: der Wert steigt **nur**, wenn eine Hülle, die den bisherigen Wert kennt, mit
/// diesem Server nicht mehr richtig arbeiten kann. Eine Erweiterung, die ältere Hüllen nicht
/// stört (etwa ein neues Feld in [`ShellInfo`] oder eine neue, optionale Fähigkeit), lässt ihn
/// unverändert. Bestehende Felder werden nie umbenannt, entfernt oder umgedeutet.
pub const SHELL_CONTRACT: u32 = 1;

/// Antwort von `GET /api/shell`. Felder kommen nur hinzu (Spec `huellen-vertrag`).
#[derive(Debug, Serialize, ToSchema)]
pub struct ShellInfo {
    /// Laufende Anwendungsversion, dieselbe wie in `GET /api/health`.
    pub version: String,
    /// Hüllen-Vertrag des Servers, eine ganze Zahl ≥ 1 ([`SHELL_CONTRACT`]).
    pub shell_contract: u32,
    /// Pfade relativ zur Wurzel (ohne führenden `/`), die die Oberfläche ohne Server braucht:
    /// alles unter `assets/` außer den Doku-Bildern, sortiert (LLH-1980). Die iOS-Hülle holt sie
    /// nach jedem Online-Laden in den Cache ihres Webviews. Ohne eingebettetes Frontend leer.
    pub assets: Vec<String>,
}

/// Die Liste ändert sich nur mit dem Binary; einmal je Prozess gelesen.
static OFFLINE_ASSETS: LazyLock<Vec<String>> = LazyLock::new(crate::static_files::offline_assets);

/// `GET /api/shell`: anonym, ohne Datenbank.
pub async fn load_shell() -> Json<ShellInfo> {
    Json(ShellInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        shell_contract: SHELL_CONTRACT,
        assets: OFFLINE_ASSETS.clone(),
    })
}
