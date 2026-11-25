//! Zustellung von Aufträgen an die Helfer-App (Stufe 2, ADR-0104). Vorerst nur die Schnittstelle;
//! die Zustellung folgt.

use crate::app::AppState;

/// Meldet den Helfer-Apps eines Auftrags eine Änderung (Quittung, Aufhebung).
pub async fn notify_changed(_state: &AppState, _einsatz_id: i64, _auftrag_id: i64) {}
