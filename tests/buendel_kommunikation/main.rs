//! Bündel „kommunikation“ (LLH-2150): ETB, Meldungen, Aufträge, Befehle, Nachforderungen, Dokumente und Ausgang.
//!
//! Ein Testprogramm für alle Dateien unten statt eines je Datei. Neue Datei, Zuschnitt und
//! Ausnahmen: `src/AGENTS.md`, „Integrationstests in Bündeln“.

#[path = "../common/mod.rs"]
mod common;

#[path = "../adapter_testart/mod.rs"]
#[allow(dead_code)]
mod adapter_testart;

#[path = "../auftrag.rs"]
mod auftrag;
#[path = "../auftrag_aufheben.rs"]
mod auftrag_aufheben;
#[path = "../auftrag_berichtigen.rs"]
mod auftrag_berichtigen;
#[path = "../auftrag_blaettern.rs"]
mod auftrag_blaettern;
#[path = "../auftrag_erteilen_freigabe.rs"]
mod auftrag_erteilen_freigabe;
#[path = "../auftrag_ziel_koordinate.rs"]
mod auftrag_ziel_koordinate;
#[path = "../ausgang_lauf.rs"]
mod ausgang_lauf;
#[path = "../ausgang_matrix.rs"]
mod ausgang_matrix;
#[path = "../ausgang_routen.rs"]
mod ausgang_routen;
#[path = "../befehl.rs"]
mod befehl;
#[path = "../befehl_quittung.rs"]
mod befehl_quittung;
#[path = "../chat.rs"]
mod chat;
#[path = "../chat_meldungseingang.rs"]
mod chat_meldungseingang;
#[path = "../dokument.rs"]
mod dokument;
#[path = "../dokument_anlage.rs"]
mod dokument_anlage;
#[path = "../dokument_startinhalt.rs"]
mod dokument_startinhalt;
#[path = "../dokument_verteiler.rs"]
mod dokument_verteiler;
#[path = "../einwurf.rs"]
mod einwurf;
#[path = "../erinnerung.rs"]
mod erinnerung;
#[path = "../erinnerung_blaettern.rs"]
mod erinnerung_blaettern;
#[path = "../etb.rs"]
mod etb;
#[path = "../etb_anhang.rs"]
mod etb_anhang;
#[path = "../etb_anzahl.rs"]
mod etb_anzahl;
#[path = "../etb_baustein.rs"]
mod etb_baustein;
#[path = "../etb_lesemarke.rs"]
mod etb_lesemarke;
#[path = "../etb_meldungseingang.rs"]
mod etb_meldungseingang;
#[path = "../etb_nachlauf.rs"]
mod etb_nachlauf;
#[path = "../etb_zaehler.rs"]
mod etb_zaehler;
#[path = "../lagebericht.rs"]
mod lagebericht;
#[path = "../lagebesprechung.rs"]
mod lagebesprechung;
#[path = "../lagebesprechung_ics.rs"]
mod lagebesprechung_ics;
#[path = "../lagemeldung_gesehen.rs"]
mod lagemeldung_gesehen;
#[path = "../meldung.rs"]
mod meldung;
#[path = "../meldung_berichtigung.rs"]
mod meldung_berichtigung;
#[path = "../meldung_blaettern.rs"]
mod meldung_blaettern;
#[path = "../meldung_korrektur.rs"]
mod meldung_korrektur;
#[path = "../meldung_rueckmeldung.rs"]
mod meldung_rueckmeldung;
#[path = "../nachforderung.rs"]
mod nachforderung;
#[path = "../nachforderung_arten.rs"]
mod nachforderung_arten;
#[path = "../nachforderung_betreuungsstelle.rs"]
mod nachforderung_betreuungsstelle;
#[path = "../nachforderung_einheit.rs"]
mod nachforderung_einheit;
#[path = "../nachforderung_erwartet.rs"]
mod nachforderung_erwartet;
#[path = "../nachforderung_person.rs"]
mod nachforderung_person;
#[path = "../nachforderung_ziel.rs"]
mod nachforderung_ziel;
