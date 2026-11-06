//! Programmpunkte der Veranstaltung (LLH-1570, Change `n7row3f9-ablaufplan-marken`, Spec
//! `ablaufplan`): Bezeichnung und Zeitpunkt am Einsatz, etwa „Einlass“ 18:00 oder „Feuerwerk“
//! 22:30. Sie stehen als Marken im Überblick und auf dem Lagemonitor, bis ihr Zeitpunkt erreicht
//! ist.
//!
//! Bewusst keine Quelle der Erinnerung (design.md D1): ein Programmpunkt hat keinen Status,
//! keinen Zähler, löst im Planer nichts aus, benachrichtigt nicht und schreibt nichts ins ETB.
//! Gelesen wird er mit dem Einsatz (kein Modul), geschrieben mit den Rechten der Kopfdaten
//! (`EinsatzVerwaltungszugriff`, D3).

pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Höchstlänge der Bezeichnung nach dem Trimmen (`src/AGENTS.md`, „Eingabegrenzen“).
pub const PROGRAMMPUNKT_BEZEICHNUNG_MAX: usize = 100;

/// Höchstzahl der Programmpunkte je Einsatz. Ein Veranstaltungsprogramm hat ein bis zwei
/// Dutzend Punkte; mehr ist kein Ablaufplan mehr, sondern ein Fahrplan.
pub const PROGRAMMPUNKTE_MAX: i64 = 50;

/// So viele anstehende Programmpunkte trägt der Lagemonitor (design.md D4).
pub const MONITOR_ANZAHL: i64 = 3;

/// Ein Programmpunkt, wie ihn Einsatzdaten und Überblick lesen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, sqlx::FromRow, ToSchema)]
pub struct Programmpunkt {
    pub id: i64,
    pub bezeichnung: String,
    /// Zeitpunkt (UTC, `YYYY-MM-DD HH:MM:SS`).
    pub zeitpunkt_at: String,
}
