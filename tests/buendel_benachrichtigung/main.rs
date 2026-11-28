//! Bündel „benachrichtigung“ (LLH-2150): Benachrichtigungen, Push und Präsenz.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../benachrichtigung.rs"]
mod benachrichtigung;
#[path = "../benachrichtigung_alarme.rs"]
mod benachrichtigung_alarme;
#[path = "../benachrichtigung_auftrag.rs"]
mod benachrichtigung_auftrag;
#[path = "../benachrichtigung_chat.rs"]
mod benachrichtigung_chat;
#[path = "../benachrichtigung_gefahr.rs"]
mod benachrichtigung_gefahr;
#[path = "../benachrichtigung_kraefte.rs"]
mod benachrichtigung_kraefte;
#[path = "../benachrichtigung_lagebesprechung.rs"]
mod benachrichtigung_lagebesprechung;
#[path = "../benachrichtigung_meldung.rs"]
mod benachrichtigung_meldung;
#[path = "../benachrichtigung_nachforderung.rs"]
mod benachrichtigung_nachforderung;
#[path = "../benachrichtigung_org.rs"]
mod benachrichtigung_org;
#[path = "../benachrichtigung_rueckmeldung.rs"]
mod benachrichtigung_rueckmeldung;
#[path = "../benachrichtigung_sichtung.rs"]
mod benachrichtigung_sichtung;
#[path = "../benachrichtigung_verfuegbar.rs"]
mod benachrichtigung_verfuegbar;
#[path = "../benachrichtigung_vermisst.rs"]
mod benachrichtigung_vermisst;
#[path = "../benachrichtigung_verteiler.rs"]
mod benachrichtigung_verteiler;
#[path = "../benachrichtigung_vorgabe.rs"]
mod benachrichtigung_vorgabe;
#[path = "../ios_push.rs"]
mod ios_push;
#[path = "../praesenz_live.rs"]
mod praesenz_live;
#[path = "../web_push.rs"]
mod web_push;
