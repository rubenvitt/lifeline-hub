//! Bündel „einsatz“ (LLH-2150): Einsatz, Einheiten, Abschnitte, Archiv und Aufbewahrung.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../abschnitt_namenstraeger.rs"]
mod abschnitt_namenstraeger;
#[path = "../aenderungsvermerk_wege.rs"]
mod aenderungsvermerk_wege;
#[path = "../archiv_einspielen.rs"]
mod archiv_einspielen;
#[path = "../aufbewahrung.rs"]
mod aufbewahrung;
#[path = "../aufbewahrung_e2e.rs"]
mod aufbewahrung_e2e;
#[path = "../aufbewahrung_kategorie.rs"]
mod aufbewahrung_kategorie;
#[path = "../backup.rs"]
mod backup;
#[path = "../datentraeger.rs"]
mod datentraeger;
#[path = "../demo_daten.rs"]
mod demo_daten;
#[path = "../einheit_aus_vorlage.rs"]
mod einheit_aus_vorlage;
#[path = "../einheit_konflikt.rs"]
mod einheit_konflikt;
#[path = "../einheit_typ.rs"]
mod einheit_typ;
#[path = "../einheit_vorlage.rs"]
mod einheit_vorlage;
#[path = "../einsatz.rs"]
mod einsatz;
#[path = "../einsatz_abschluss.rs"]
mod einsatz_abschluss;
#[path = "../einsatz_anlegen_mitglieder.rs"]
mod einsatz_anlegen_mitglieder;
#[path = "../einsatz_archiv.rs"]
mod einsatz_archiv;
#[path = "../einsatz_bereitstellungsraum.rs"]
mod einsatz_bereitstellungsraum;
#[path = "../einsatz_einheit.rs"]
mod einsatz_einheit;
#[path = "../einsatz_fahrzeug.rs"]
mod einsatz_fahrzeug;
#[path = "../einsatz_fuehrungsstelle.rs"]
mod einsatz_fuehrungsstelle;
#[path = "../einsatz_funktion.rs"]
mod einsatz_funktion;
#[path = "../einsatz_kontext.rs"]
mod einsatz_kontext;
#[path = "../einsatz_kontext_guard.rs"]
mod einsatz_kontext_guard;
#[path = "../einsatz_kopf_konflikt.rs"]
mod einsatz_kopf_konflikt;
#[path = "../einsatz_live.rs"]
mod einsatz_live;
#[path = "../einsatz_material.rs"]
mod einsatz_material;
#[path = "../einsatz_mitglieder_auswahl.rs"]
mod einsatz_mitglieder_auswahl;
#[path = "../einsatz_person.rs"]
mod einsatz_person;
#[path = "../einsatz_personal.rs"]
mod einsatz_personal;
#[path = "../einsatz_schaden.rs"]
mod einsatz_schaden;
#[path = "../einsatz_tier.rs"]
mod einsatz_tier;
#[path = "../einsatz_uhs.rs"]
mod einsatz_uhs;
#[path = "../einsatz_verwaltungsrecht.rs"]
mod einsatz_verwaltungsrecht;
#[path = "../einsatz_vorlage.rs"]
mod einsatz_vorlage;
#[path = "../einsatzabschnitt.rs"]
mod einsatzabschnitt;
#[path = "../einsatzabschnitt_lage.rs"]
mod einsatzabschnitt_lage;
#[path = "../einsatzakte.rs"]
mod einsatzakte;
#[path = "../einsatzrolle_mitarbeit.rs"]
mod einsatzrolle_mitarbeit;
#[path = "../loeschersuchen.rs"]
mod loeschersuchen;
#[path = "../nachbereitung.rs"]
mod nachbereitung;
