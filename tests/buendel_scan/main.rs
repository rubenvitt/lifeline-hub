//! Bündel „scan“ (LLH-2150): Upload-Scan; alle setzen dieselbe Scan-Konfiguration (`init_scan_config`, clamd 127.0.0.1:1, fail-closed).
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../karte_hintergrundbild_scan.rs"]
mod karte_hintergrundbild_scan;
#[path = "../organisation_logo_scan.rs"]
mod organisation_logo_scan;
#[path = "../person_anhang_scan.rs"]
mod person_anhang_scan;
#[path = "../schaden_anhang_scan.rs"]
mod schaden_anhang_scan;
#[path = "../tier_anhang_scan.rs"]
mod tier_anhang_scan;
#[path = "../uhs_anhang_scan.rs"]
mod uhs_anhang_scan;
#[path = "../uhs_plan_scan.rs"]
mod uhs_plan_scan;
