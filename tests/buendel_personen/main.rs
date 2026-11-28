//! Bündel „personen“ (LLH-2150): Personen, Tiere, Schäden, UHS, Anhänge und Eingabegrenzen.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../anhang.rs"]
mod anhang;
#[path = "../anhang_metadaten.rs"]
mod anhang_metadaten;
#[path = "../anhang_vorschau.rs"]
mod anhang_vorschau;
#[path = "../eingabegrenzen_auftrag.rs"]
mod eingabegrenzen_auftrag;
#[path = "../eingabegrenzen_etb.rs"]
mod eingabegrenzen_etb;
#[path = "../eingabegrenzen_geometrie.rs"]
mod eingabegrenzen_geometrie;
#[path = "../eingabegrenzen_listen.rs"]
mod eingabegrenzen_listen;
#[path = "../eingabegrenzen_spiegel.rs"]
mod eingabegrenzen_spiegel;
#[path = "../eingabegrenzen_stab_schaden.rs"]
mod eingabegrenzen_stab_schaden;
#[path = "../patienten_uebergabe.rs"]
mod patienten_uebergabe;
#[path = "../person_anhang.rs"]
mod person_anhang;
#[path = "../person_anlass.rs"]
mod person_anlass;
#[path = "../person_aufnahme_uhs.rs"]
mod person_aufnahme_uhs;
#[path = "../person_auswahl.rs"]
mod person_auswahl;
#[path = "../person_einheit_meldung.rs"]
mod person_einheit_meldung;
#[path = "../person_leichter_fall.rs"]
mod person_leichter_fall;
#[path = "../person_massnahme.rs"]
mod person_massnahme;
#[path = "../person_transport.rs"]
mod person_transport;
#[path = "../person_verlauf.rs"]
mod person_verlauf;
#[path = "../person_verletzung.rs"]
mod person_verletzung;
#[path = "../schaden_anhang.rs"]
mod schaden_anhang;
#[path = "../schaden_blaettern.rs"]
mod schaden_blaettern;
#[path = "../tier_anhang.rs"]
mod tier_anhang;
#[path = "../uhs_anhang.rs"]
mod uhs_anhang;
#[path = "../uhs_plan.rs"]
mod uhs_plan;
#[path = "../uhs_staerke.rs"]
mod uhs_staerke;
