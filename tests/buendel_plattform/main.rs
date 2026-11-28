//! Bündel „plattform“ (LLH-2150): Adapter, öffentliche API, Fehlervertrag und Wächter.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../adapter_testart/mod.rs"]
#[allow(dead_code)]
mod adapter_testart;

#[path = "../adapter_admin.rs"]
mod adapter_admin;
#[path = "../adapter_lauf.rs"]
mod adapter_lauf;
#[path = "../adapter_live.rs"]
mod adapter_live;
#[path = "../adapter_matrix.rs"]
mod adapter_matrix;
#[path = "../adapter_schluesselwechsel.rs"]
mod adapter_schluesselwechsel;
#[path = "../adapter_sipgate.rs"]
mod adapter_sipgate;
#[path = "../adapter_smtp.rs"]
mod adapter_smtp;
#[path = "../anbindungen_webhook.rs"]
mod anbindungen_webhook;
#[path = "../anfrageprotokoll.rs"]
mod anfrageprotokoll;
#[path = "../anmelde_audit_guard.rs"]
mod anmelde_audit_guard;
#[path = "../antwortkompression.rs"]
mod antwortkompression;
#[path = "../ausgehend_kennung_guard.rs"]
mod ausgehend_kennung_guard;
#[path = "../body_limit.rs"]
mod body_limit;
#[path = "../client_fehler.rs"]
mod client_fehler;
#[path = "../cross_org.rs"]
mod cross_org;
#[path = "../enum_wire_kontrakt.rs"]
mod enum_wire_kontrakt;
#[path = "../env_config_guard.rs"]
mod env_config_guard;
#[path = "../externe_stelle.rs"]
mod externe_stelle;
#[path = "../externe_stelle_kanal.rs"]
mod externe_stelle_kanal;
#[path = "../fehler_vertrag.rs"]
mod fehler_vertrag;
#[path = "../geraet_routen_guard.rs"]
mod geraet_routen_guard;
#[path = "../health.rs"]
mod health;
#[path = "../json_extractor_guard.rs"]
mod json_extractor_guard;
#[path = "../live_feed.rs"]
mod live_feed;
#[path = "../path_extractor_guard.rs"]
mod path_extractor_guard;
#[path = "../public_api.rs"]
mod public_api;
#[path = "../public_api_einsaetze.rs"]
mod public_api_einsaetze;
#[path = "../public_api_events.rs"]
mod public_api_events;
#[path = "../public_api_lage.rs"]
mod public_api_lage;
#[path = "../public_api_webhook.rs"]
mod public_api_webhook;
#[path = "../schutzkoepfe.rs"]
mod schutzkoepfe;
#[path = "../shell.rs"]
mod shell;
#[path = "../sqlite_version.rs"]
mod sqlite_version;
#[path = "../stammdaten_live_guard.rs"]
mod stammdaten_live_guard;
#[path = "../testprogramme_guard.rs"]
mod testprogramme_guard;
#[path = "../tls_smoke.rs"]
mod tls_smoke;
#[path = "../versionsstand.rs"]
mod versionsstand;
#[path = "../zulassung_guard.rs"]
mod zulassung_guard;
