//! Bündel „kraefte“ (LLH-2150): Kräfte, Ablösung, Schichtplan, Stab, Planung, Betreuung und Stammdaten.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../abloesung.rs"]
mod abloesung;
#[path = "../abloesung_hinweise.rs"]
mod abloesung_hinweise;
#[path = "../betreuung.rs"]
mod betreuung;
#[path = "../betreuung_registrierung.rs"]
mod betreuung_registrierung;
#[path = "../fahrzeug.rs"]
mod fahrzeug;
#[path = "../fahrzeug_status.rs"]
mod fahrzeug_status;
#[path = "../fernmeldewesen.rs"]
mod fernmeldewesen;
#[path = "../fuehrungsfunktionen.rs"]
mod fuehrungsfunktionen;
#[path = "../fuehrungsstelle.rs"]
mod fuehrungsstelle;
#[path = "../fuehrungsstelle_konflikt.rs"]
mod fuehrungsstelle_konflikt;
#[path = "../helfer.rs"]
mod helfer;
#[path = "../helfer_pager.rs"]
mod helfer_pager;
#[path = "../infotelefon_zaehler.rs"]
mod infotelefon_zaehler;
#[path = "../kraefte_disposition.rs"]
mod kraefte_disposition;
#[path = "../kraefte_zeitachse.rs"]
mod kraefte_zeitachse;
#[path = "../material.rs"]
mod material;
#[path = "../material_status_ruecknahme.rs"]
mod material_status_ruecknahme;
#[path = "../personal.rs"]
mod personal;
#[path = "../personal_status.rs"]
mod personal_status;
#[path = "../planung.rs"]
mod planung;
#[path = "../planung_programmpunkt.rs"]
mod planung_programmpunkt;
#[path = "../planung_uebernahme.rs"]
mod planung_uebernahme;
#[path = "../programmpunkt.rs"]
mod programmpunkt;
#[path = "../qualifikation.rs"]
mod qualifikation;
#[path = "../qualifikation_soll.rs"]
mod qualifikation_soll;
#[path = "../schichtplan.rs"]
mod schichtplan;
#[path = "../schichtplan_buendel.rs"]
mod schichtplan_buendel;
#[path = "../schichtplan_export.rs"]
mod schichtplan_export;
#[path = "../schichtplan_import.rs"]
mod schichtplan_import;
#[path = "../schichtplan_kopplung.rs"]
mod schichtplan_kopplung;
#[path = "../schichtplan_wechsel.rs"]
mod schichtplan_wechsel;
#[path = "../sprechgruppe_einzelzuordnung.rs"]
mod sprechgruppe_einzelzuordnung;
#[path = "../sprechgruppe_katalog.rs"]
mod sprechgruppe_katalog;
#[path = "../sprechgruppe_katalogname.rs"]
mod sprechgruppe_katalogname;
#[path = "../stab_fernmeldeskizze.rs"]
mod stab_fernmeldeskizze;
#[path = "../stab_infotelefon.rs"]
mod stab_infotelefon;
#[path = "../stab_kommunikationsplan.rs"]
mod stab_kommunikationsplan;
#[path = "../stammdaten_abruf.rs"]
mod stammdaten_abruf;
#[path = "../stammdaten_eingang.rs"]
mod stammdaten_eingang;
#[path = "../stichwort.rs"]
mod stichwort;
#[path = "../unterkunft_richtwerte.rs"]
mod unterkunft_richtwerte;
#[path = "../verbleib_angaben.rs"]
mod verbleib_angaben;
#[path = "../verbleib_betreuungsstelle.rs"]
mod verbleib_betreuungsstelle;
#[path = "../verpflegung.rs"]
mod verpflegung;
