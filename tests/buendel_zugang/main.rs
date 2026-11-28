//! Bündel „zugang“ (LLH-2150): Anmeldung, Sitzungen, Benutzer, Organisation und Module.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../app_anmeldung.rs"]
mod app_anmeldung;
#[path = "../auth_audit.rs"]
mod auth_audit;
#[path = "../benutzer.rs"]
mod benutzer;
#[path = "../benutzer_einstellungen.rs"]
mod benutzer_einstellungen;
#[path = "../einmalpasswort.rs"]
mod einmalpasswort;
#[path = "../maschinenzugang.rs"]
mod maschinenzugang;
#[path = "../modul_freigaben.rs"]
mod modul_freigaben;
#[path = "../modul_override.rs"]
mod modul_override;
#[path = "../modul_zaehler.rs"]
mod modul_zaehler;
#[path = "../oidc_smoke.rs"]
mod oidc_smoke;
#[path = "../org_einstellungen.rs"]
mod org_einstellungen;
#[path = "../org_live.rs"]
mod org_live;
#[path = "../org_scope_guard.rs"]
mod org_scope_guard;
#[path = "../organisation_logo.rs"]
mod organisation_logo;
#[path = "../organisation_tz.rs"]
mod organisation_tz;
#[path = "../passwort_aendern.rs"]
mod passwort_aendern;
#[path = "../replay_lesesperre.rs"]
mod replay_lesesperre;
#[path = "../sitzung_benutzerwechsel.rs"]
mod sitzung_benutzerwechsel;
#[path = "../sitzungen.rs"]
mod sitzungen;
#[path = "../totp_einrichtung.rs"]
mod totp_einrichtung;
#[path = "../verwaltung_bereitschaft.rs"]
mod verwaltung_bereitschaft;
#[path = "../webauthn_smoke.rs"]
mod webauthn_smoke;
#[path = "../zugangsprotokoll.rs"]
mod zugangsprotokoll;
