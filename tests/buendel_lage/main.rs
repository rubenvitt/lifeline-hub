//! Bündel „lage“ (LLH-2150): Lagekarte, Lage, Orte, Drohne und Fremdquellen.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../drohne_foto.rs"]
mod drohne_foto;
#[path = "../drohne_karte.rs"]
mod drohne_karte;
#[path = "../drohne_lagemonitor.rs"]
mod drohne_lagemonitor;
#[path = "../drohne_quellen.rs"]
mod drohne_quellen;
#[path = "../drohne_store.rs"]
mod drohne_store;
#[path = "../drohne_video.rs"]
mod drohne_video;
#[path = "../freies_zeichen.rs"]
mod freies_zeichen;
#[path = "../gefahr.rs"]
mod gefahr;
#[path = "../geraet_kopplung.rs"]
mod geraet_kopplung;
#[path = "../karte_auto_aktualisierung.rs"]
mod karte_auto_aktualisierung;
#[path = "../karte_fremdebene.rs"]
mod karte_fremdebene;
#[path = "../karte_fremdebene_url.rs"]
mod karte_fremdebene_url;
#[path = "../karte_hintergrundbild.rs"]
mod karte_hintergrundbild;
#[path = "../karte_ort_suche.rs"]
mod karte_ort_suche;
#[path = "../karten_ansicht.rs"]
mod karten_ansicht;
#[path = "../lage_snapshot.rs"]
mod lage_snapshot;
#[path = "../lage_taktik.rs"]
mod lage_taktik;
#[path = "../lage_zone.rs"]
mod lage_zone;
#[path = "../lagekennzahl_wahl.rs"]
mod lagekennzahl_wahl;
#[path = "../ort_suche.rs"]
mod ort_suche;
#[path = "../ort_suche_offline.rs"]
mod ort_suche_offline;
#[path = "../ort_vorschau.rs"]
mod ort_vorschau;
#[path = "../ortung.rs"]
mod ortung;
#[path = "../pegel.rs"]
mod pegel;
#[path = "../rechner_api.rs"]
mod rechner_api;
#[path = "../transfer_grenzen.rs"]
mod transfer_grenzen;
#[path = "../verdichtung_fixture.rs"]
mod verdichtung_fixture;
#[path = "../wetter.rs"]
mod wetter;
