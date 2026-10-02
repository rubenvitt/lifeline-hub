//! Ende-zu-Ende-Nachweis für LFH-23: ein Einsatz mit Person, Tier und Schaden entsteht über die
//! API, wird abgeschlossen und durchläuft den Purge über Frist und Karenz. Geprüft wird die
//! ETB-Spur, die Fremdschlüssel, die Pseudonyme und die Lesbarkeit der Archivakte durch den
//! Admin — während der Karenz und nach der Schwärzung.
//!
//! **Ausnahmeliste (Annahme A2, entschieden in LFH-752):** Einige System-Einträge übernehmen
//! einen Wert, den die Schwärzungs-Registry in der Quellzeile als Scrub führt, in ihren Wortlaut.
//! Im ETB bleibt er als Führungsdokumentation erhalten (G_ETB), auch über die Schwärzung hinweg.
//! Diese Stellen stehen abschließend in [`AUSNAHMEN_SYSTEM_ETB`]; eine neue solche Stelle ohne
//! Eintrag ist ein Fehler. LFH-752 hat je Gruppe entschieden: Werte von Betroffenen (Schaden,
//! Person, Tier, Belegung) und Dokumenttitel stehen in neuen Einträgen nicht mehr, Einsatzkräfte,
//! Lagestruktur, Führungsmodule und Enum-Labels bleiben bewusst. Die Liste wird nie länger um
//! eine gesperrte Spalte ([`GESPERRT`]); ältere ETB-Einträge behalten ihren Wortlaut.
//! Herleitung: `openspec/changes/lfh-752-system-etb-ohne-scrub-werte/design.md`.

use axum::http::StatusCode;
use chrono::{Duration, NaiveDateTime, Utc};
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie};

/// Eine Stelle, die einen Scrub-Wert in den Wortlaut eines ETB-Eintrags übernimmt.
struct Ausnahme {
    /// Datei und Funktion des Schreibwegs (Zeilennummern driften, Funktionsnamen nicht).
    datei: &'static str,
    funktion: &'static str,
    /// Scrub-Spalte der Quellzeile (`tabelle.spalte`) laut `schwaerzung_registry`.
    spalte: &'static str,
    /// Warum der Wert bewusst im ETB bleibt (LFH-752).
    gruppe: Gruppe,
    begruendung: &'static str,
}

/// Die Gruppen, deren Scrub-Werte LFH-752 bewusst im ETB-Wortlaut behält. Werte von Betroffenen
/// und Dokumenttitel haben keine Gruppe: sie gehören nie in die Liste ([`GESPERRT`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Gruppe {
    /// Wer wann in welcher Funktion eingesetzt war — Kern der Führungsdokumentation.
    Einsatzkraft,
    /// Bezeichnungen der Lagestruktur (Zonen, Gebiete, Bezirke, Stellen), Streichgrund.
    Lagestruktur,
    /// Führungsmodule nach Linie A (LFH-701): der Wortlaut ist der Eintrag.
    Fuehrungsmodul,
    /// Enum-Label ohne Personenbezug, Scrub nur wegen Zeilenlöschung.
    EnumLabel,
}

/// Spalten, die nie in die Ausnahmeliste dürfen (Spec `aufbewahrung`, „Ausnahmeliste wird nicht
/// länger“): `tabelle` exakt oder mit `*` als Präfix, `spalte` exakt oder `*` für alle.
const GESPERRT: &[(&str, &str)] = &[
    ("einsatz_schaden*", "*"),
    ("einsatz_person", "*"),
    ("person_*", "*"),
    ("einsatz_tier", "*"),
    ("einsatz_dokument", "titel"),
];

fn ist_gesperrt(spalte: &str) -> bool {
    let (t, s) = spalte.split_once('.').unwrap();
    GESPERRT.iter().any(|(gt, gs)| {
        let tabelle = match gt.strip_suffix('*') {
            Some(praefix) => t.starts_with(praefix),
            None => t == *gt,
        };
        tabelle && (*gs == "*" || s == *gs)
    })
}

/// Ergebnis einer vollständigen DURCHSICHT aller ETB-Schreibwege (`etb::system_audit_tx`,
/// `etb::repo::anlegen_tx`, `routes::etb_system_degradiert` samt Wrappern), zweimal
/// systematisch gegen jede Scrub-Spalte abgeglichen. Der Nutzerfreitext des ETB selbst
/// (`routes/etb.rs::erfassen`) ist keine Übernahme und steht nicht hier.
///
/// **Die Vollständigkeit ist eine Durchsicht, kein Guard.** Maschinell gehalten sind nur der
/// Wert, den der Ablauf unten pflanzt, und der Selbsttest (Funktion existiert, Spalte ist Scrub,
/// Spalte ist nicht gesperrt). Eine NEUE Übernahme bemerkt kein Test — wer einen ETB-Text aus
/// einer Scrub-Spalte baut, trägt ihn mit Gruppe hier ein; ein Wert aus [`GESPERRT`] gehört gar
/// nicht in den Wortlaut (LFH-752).
const AUSNAHMEN_SYSTEM_ETB: &[Ausnahme] = &[
    // --- Einsatzkräfte: wer wann in welcher Funktion eingesetzt war (Name, Funktion, Besetzung
    // ad-hoc externer Kräfte und des Stabs). Bewusst behalten, LFH-752 D2. ---
    Ausnahme {
        datei: "src/routes/einsatz_personal.rs",
        funktion: "disponieren",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Name und Funktion ad-hoc externer Kräfte (personal_id IS NULL)",
    },
    Ausnahme {
        datei: "src/routes/einsatz_personal.rs",
        funktion: "aktualisieren",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Name ad-hoc externer Kräfte beim Statuswechsel",
    },
    Ausnahme {
        datei: "src/routes/zeitachse.rs",
        funktion: "nachtragen",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Name ad-hoc externer Kräfte im Nachtrag der Zeitachse (kraft_name_tx)",
    },
    Ausnahme {
        datei: "src/routes/zeitachse.rs",
        funktion: "streichen",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Name ad-hoc externer Kräfte in der Streichung der Zeitachse",
    },
    Ausnahme {
        datei: "src/routes/einsatz_personal.rs",
        funktion: "entfernen",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Name und Funktion ad-hoc externer Kräfte beim Entfernen",
    },
    Ausnahme {
        datei: "src/routes/einsatz_einheit.rs",
        funktion: "aktualisieren",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "alter und neuer Einheitsführer, wenn ad-hoc extern",
    },
    Ausnahme {
        datei: "src/routes/einsatz_einheit.rs",
        funktion: "personal_zuordnen",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "zugeordnete ad-hoc externe Kraft",
    },
    Ausnahme {
        datei: "src/routes/einsatz_einheit.rs",
        funktion: "personal_freigeben",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "freigegebene ad-hoc externe Kraft",
    },
    Ausnahme {
        datei: "src/routes/einsatz_fahrzeug.rs",
        funktion: "besatzung_zuordnen",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Besatzungsmitglied, wenn ad-hoc extern",
    },
    Ausnahme {
        datei: "src/routes/einsatz_fahrzeug.rs",
        funktion: "besatzung_freigeben",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "freigegebenes Besatzungsmitglied, wenn ad-hoc extern",
    },
    Ausnahme {
        datei: "src/stab/repo.rs",
        funktion: "setzen",
        spalte: "einsatz_stabsfunktion.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Besetzung einer Stabsfunktion (neu und vorher), ohne Zeilenfilter",
    },
    Ausnahme {
        datei: "src/stab/repo.rs",
        funktion: "entfernen",
        spalte: "einsatz_stabsfunktion.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "vorheriger Inhaber einer Stabsfunktion",
    },
    Ausnahme {
        datei: "src/auftrag/repo.rs",
        funktion: "anlegen_tx",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Feld `an` des Anordnungs-Eintrags nennt eine ad-hoc externe Empfängerperson",
    },
    Ausnahme {
        datei: "src/routes/einsatz_personal.rs",
        funktion: "disponieren",
        spalte: "einsatz_personal.snap_funktion",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Funktion ad-hoc externer Kräfte über etb_text_disponiert, „Name (Funktion)“",
    },
    Ausnahme {
        datei: "src/routes/einsatz_personal.rs",
        funktion: "entfernen",
        spalte: "einsatz_personal.snap_funktion",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Funktion ad-hoc externer Kräfte über person_bezeichnung",
    },
    Ausnahme {
        datei: "src/stab/repo.rs",
        funktion: "setzen",
        spalte: "einsatz_stabsfunktion.bezeichnung",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Name/Stelle einer externen oder rückwärtigen Besetzung (neu und vorher) über zustand_text",
    },
    Ausnahme {
        datei: "src/stab/repo.rs",
        funktion: "entfernen",
        spalte: "einsatz_stabsfunktion.bezeichnung",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "Name/Stelle der vorherigen externen oder rückwärtigen Besetzung",
    },
    Ausnahme {
        datei: "src/stab/repo.rs",
        funktion: "setzen",
        spalte: "einsatz_personal.snap_name",
        gruppe: Gruppe::Einsatzkraft,
        begruendung: "neuer Inhaber über snap_name_von, wenn ad-hoc extern (derselbe Wert wie einsatz_stabsfunktion.snap_name)",
    },
    // --- Lagestruktur: Bezeichnungen der Ordnung des Raums und der Betreuung (Zonen, Gebiete,
    // Bezirke, Stellen) und der Streichgrund der Kräfte-Zeitachse. Bewusst behalten, LFH-752. ---
    Ausnahme {
        datei: "src/routes/zeitachse.rs",
        funktion: "streichen",
        spalte: "einsatz_kraft_zeitachse.streichgrund",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Streichgrund im ETB-Eintrag der Streichung",
    },
    Ausnahme {
        datei: "src/routes/lage_zone.rs",
        funktion: "anlegen",
        spalte: "lage_zone.label",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Zonen-Label (Präzedenz LFH-60 Welle A)",
    },
    Ausnahme {
        datei: "src/routes/lage_zone.rs",
        funktion: "aktualisieren",
        spalte: "lage_zone.label",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "neues Zonen-Label",
    },
    Ausnahme {
        datei: "src/routes/lage_zone.rs",
        funktion: "aufloesen",
        spalte: "lage_zone.label",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "altes Zonen-Label",
    },
    Ausnahme {
        datei: "src/routes/gefahr.rs",
        funktion: "bewerten",
        spalte: "gefahrengebiet.label",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Gebietslabel beim Warnstufenwechsel",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "bezirk_anlegen_tx",
        spalte: "evakuierungsbezirk.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung des Evakuierungsbezirks",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "stelle_anlegen_tx",
        spalte: "betreuungsstelle.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung der Betreuungsstelle",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "bezirk_aendern_tx",
        spalte: "evakuierungsbezirk.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung des Evakuierungsbezirks (bei Umbenennung auch die alte)",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "bezirk_stornieren_tx",
        spalte: "evakuierungsbezirk.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung des Evakuierungsbezirks",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "stand_melden_tx",
        spalte: "evakuierungsbezirk.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung des Evakuierungsbezirks",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "stand_zuruecknehmen_tx",
        spalte: "evakuierungsbezirk.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung des Evakuierungsbezirks",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "stelle_aendern_tx",
        spalte: "betreuungsstelle.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung der Betreuungsstelle (bei Umbenennung auch die alte)",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "stelle_stornieren_tx",
        spalte: "betreuungsstelle.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung der Betreuungsstelle",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "belegung_melden_tx",
        spalte: "betreuungsstelle.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung der Betreuungsstelle",
    },
    Ausnahme {
        datei: "src/betreuung/repo.rs",
        funktion: "belegung_zuruecknehmen_tx",
        spalte: "betreuungsstelle.bezeichnung",
        gruppe: Gruppe::Lagestruktur,
        begruendung: "Bezeichnung der Betreuungsstelle",
    },
    // --- Führungsmodule (LFH-701, Linie A): Der Wortlaut IST der ETB-Eintrag. Die Freitexte der
    // Modulzeilen werden geschwärzt, die Führungsdokumentation steht im ETB. ---
    Ausnahme {
        datei: "src/routes/chat.rs",
        funktion: "heraufstufen",
        spalte: "chat_nachricht.inhalt",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "heraufgestufte Chat-Nachricht im Wortlaut (vom Menschen ausgelöst, LFH-290)",
    },
    Ausnahme {
        datei: "src/meldung/repo.rs",
        funktion: "anlegen_mit_client_id_tx",
        spalte: "meldung.absender",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Absender als `von` der Auto-ETB-Meldung",
    },
    Ausnahme {
        datei: "src/meldung/repo.rs",
        funktion: "anlegen_mit_client_id_tx",
        spalte: "meldung.empfaenger",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Empfänger als `an` der Auto-ETB-Meldung",
    },
    Ausnahme {
        datei: "src/meldung/repo.rs",
        funktion: "anlegen_mit_client_id_tx",
        spalte: "meldung.inhalt",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Meldungswortlaut als `inhalt` der Auto-ETB-Meldung",
    },
    Ausnahme {
        datei: "src/auftrag/repo.rs",
        funktion: "anlegen_tx",
        spalte: "auftrag.auftrag_text",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Auftragstext als `inhalt` der Auto-ETB-Anordnung",
    },
    Ausnahme {
        datei: "src/auftrag/repo.rs",
        funktion: "anlegen_tx",
        spalte: "auftrag_empfaenger.snap_anzeige",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Empfänger-Snapshots verkettet als `an` der Anordnung",
    },
    Ausnahme {
        datei: "src/auftrag/repo.rs",
        funktion: "anlegen_tx",
        spalte: "auftrag_empfaenger.funktion_text",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Funktionsbezeichnung über den Empfänger-Snapshot in `an`",
    },
    Ausnahme {
        datei: "src/auftrag/repo.rs",
        funktion: "anlegen_tx",
        spalte: "auftrag_empfaenger.extern_bezeichnung",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Klartext der externen Stelle über den Empfänger-Snapshot in `an`",
    },
    Ausnahme {
        datei: "src/auftrag/repo.rs",
        funktion: "melde_vollzug_tx",
        spalte: "auftrag.vollzugsmeldung",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Vollzugsmeldung als `inhalt` einer ETB-Meldung",
    },
    Ausnahme {
        datei: "src/nachforderung/repo.rs",
        funktion: "anlegen_tx",
        spalte: "nachforderung.art",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Bedarfsart (Freitext) im `inhalt` der Anforderung",
    },
    Ausnahme {
        datei: "src/nachforderung/repo.rs",
        funktion: "anlegen_tx",
        spalte: "nachforderung.bezeichnung",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Bedarf im `inhalt` der Anforderung („Nachforderung: …× … — …“)",
    },
    Ausnahme {
        datei: "src/nachforderung/repo.rs",
        funktion: "anlegen_tx",
        spalte: "nachforderung.adressat_bezeichnung",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Adressat als `an` der Anforderung",
    },
    Ausnahme {
        datei: "src/nachforderung/repo.rs",
        funktion: "anlegen_tx",
        spalte: "nachforderung.begruendung",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Begründung als `veranlassung` der Anforderung",
    },
    Ausnahme {
        datei: "src/vorlagendokument/repo.rs",
        funktion: "freigeben_tx",
        spalte: "lagebericht.titel",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Titel als Überschrift des Freigabe-Snapshots",
    },
    Ausnahme {
        datei: "src/vorlagendokument/repo.rs",
        funktion: "freigeben_tx",
        spalte: "lagebericht.abschnitte",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Abschnittstexte als Markdown im Freigabe-Snapshot",
    },
    Ausnahme {
        datei: "src/vorlagendokument/repo.rs",
        funktion: "freigeben_tx",
        spalte: "befehl.titel",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Titel als Überschrift des Freigabe-Snapshots",
    },
    Ausnahme {
        datei: "src/vorlagendokument/repo.rs",
        funktion: "freigeben_tx",
        spalte: "befehl.abschnitte",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Abschnittstexte als Markdown im Freigabe-Snapshot",
    },
    Ausnahme {
        datei: "src/vorlagendokument/repo.rs",
        funktion: "freigeben_tx",
        spalte: "pressemitteilung.titel",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Titel als Überschrift des Freigabe-Snapshots",
    },
    Ausnahme {
        datei: "src/vorlagendokument/repo.rs",
        funktion: "freigeben_tx",
        spalte: "pressemitteilung.abschnitte",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Abschnittstexte als Markdown im Freigabe-Snapshot",
    },
    Ausnahme {
        datei: "src/stab/repo.rs",
        funktion: "lagebesprechung_abschliessen",
        spalte: "einsatz_lagebesprechung.entschluss",
        gruppe: Gruppe::Fuehrungsmodul,
        begruendung: "Entschluss im ETB-Eintrag (Entscheidung) der Lagebesprechung",
    },
    // --- Enum-Labels ohne Personenbezug, Scrub nur, weil die Quellzeile ganz gelöscht wird. ---
    Ausnahme {
        datei: "src/dokument/repo.rs",
        funktion: "ablegen",
        spalte: "einsatz_dokument.kategorie",
        gruppe: Gruppe::EnumLabel,
        begruendung: "Kategorie als Enum-Label, kein Personenbezug; Scrub nur, weil die Zeile gelöscht wird",
    },
    Ausnahme {
        datei: "src/dokument/repo.rs",
        funktion: "entfernen",
        spalte: "einsatz_dokument.kategorie",
        gruppe: Gruppe::EnumLabel,
        begruendung: "Kategorie als Enum-Label, kein Personenbezug; Scrub nur, weil die Zeile gelöscht wird",
    },
    Ausnahme {
        datei: "src/dokument/repo.rs",
        funktion: "aendern",
        spalte: "einsatz_dokument.kategorie",
        gruppe: Gruppe::EnumLabel,
        begruendung: "Kategorie als Enum-Label (alt und neu), kein Personenbezug; Scrub nur, weil die Zeile gelöscht wird",
    },
];

/// Die Liste darf nicht verrotten: jede Fundstelle nennt eine Datei, in der die Funktion
/// existiert, und eine Spalte, die die Registry als Scrub führt.
#[test]
fn ausnahmeliste_zeigt_auf_existierende_scrub_stellen() {
    use lifeline_hub::einsatz::schwaerzung_registry::{klassifikation_von, Klassifikation};
    for a in AUSNAHMEN_SYSTEM_ETB {
        let quelle =
            std::fs::read_to_string(a.datei).unwrap_or_else(|_| panic!("{} fehlt", a.datei));
        // `fn name(` oder generisch `fn name<` (etwa `snapshot_freigeben_tx<T: …>`).
        assert!(
            quelle.contains(&format!("fn {}(", a.funktion))
                || quelle.contains(&format!("fn {}<", a.funktion)),
            "{}: Funktion {} nicht gefunden",
            a.datei,
            a.funktion
        );
        let (t, s) = a.spalte.split_once('.').unwrap();
        assert!(
            matches!(klassifikation_von(t, s), Some(Klassifikation::Scrub(_))),
            "{} ist keine Scrub-Spalte — gehört nicht in die Ausnahmeliste",
            a.spalte
        );
        assert!(
            !ist_gesperrt(a.spalte),
            "{} ({}::{}, {:?}) ist gesperrt: Werte von Betroffenen und Dokumenttitel gehören \
             nicht in den ETB-Wortlaut (LFH-752)",
            a.spalte,
            a.datei,
            a.funktion,
            a.gruppe
        );
        assert!(!a.begruendung.is_empty());
    }
}

/// Die Sperrliste greift auf die gemeinten Spalten und nur auf diese.
#[test]
fn sperrliste_trifft_betroffene_und_dokumenttitel() {
    for gesperrt in [
        "einsatz_schaden.ort",
        "einsatz_schaden.uebergeben_an",
        "einsatz_schaden_anhang.titel",
        "einsatz_person.aktuelles_verbleib_ziel",
        "person_verbleib.ziel",
        "person_uhs_belegung.notiz",
        "einsatz_tier.halter_kontakt",
        "einsatz_dokument.titel",
    ] {
        assert!(ist_gesperrt(gesperrt), "{gesperrt} muss gesperrt sein");
    }
    for frei in [
        "einsatz_personal.snap_name",
        "einsatz_dokument.kategorie",
        "lage_zone.label",
        "meldung.inhalt",
    ] {
        assert!(!ist_gesperrt(frei), "{frei} darf nicht gesperrt sein");
    }
}

// ─────────────────────────────── gepflanzte Werte ───────────────────────────────

/// Werte, die in KEINEM ETB-Eintrag und in keiner Archiv-Antwort stehen dürfen.
const GEHEIM: &[&str] = &[
    // Einsatzkopf
    "Marktplatz-Musterstadt-1",
    "Anrufer-Kowalski",
    "Sachverhalt-GEHEIM-7",
    // Person
    "Mustermann",
    "Erika",
    "1961-02-03",
    "Lindenweg-7",
    "Kellerraum-Nord",
    "Melder-0171-4711",
    "Insulinpflichtig",
    "stark-unterkuehlt",
    "Sichtungsnotiz-XYZ",
    "RTW-Florian-83",
    "Verbleibnotiz-QRS",
    // Tier
    "Halterin-0172-9999",
    "CHIP-276098106012345",
    "Scheune-Hof-Brandt",
    "Tiernotiz-bissig",
    "Tierheim-Sued-ABC",
    // Schaden
    "Dachschaden-Beschreibung",
    "Eigentuemer-0173-1234",
    // Bis LFH-752 Ausnahmen, seitdem nicht mehr im Wortlaut: Schadensort, Übergabe-Adressat,
    // Verbleib-Ziel.
    "Birkenallee-9",
    "Dachdecker-Ruehl",
    "Klinikum-Nordstadt",
];

/// Werte der Ausnahmeliste, die dieser Ablauf berührt: `(wert, erwarteter Textbaustein
/// des einen zugehörigen System-Eintrags)`.
const AUSNAHME_WERTE: &[(&str, &str)] = &[("Sperrzone-Lindenplatz", "eingerichtet")];

fn zeit(s: &str) -> chrono::DateTime<Utc> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .unwrap()
        .and_utc()
}

async fn ok(app: &axum::Router, cookie: &str, methode: &str, uri: &str, body: Value) -> Value {
    let (s, v) = anfrage(app, methode, uri, cookie, Some(&body.to_string())).await;
    assert!(s.is_success(), "{methode} {uri} → {s}: {v}");
    v
}

struct Etb {
    id: i64,
    lfd_nr: i64,
    typ: String,
    text: String,
    berichtigt: Option<i64>,
}

async fn etb_zeilen(pool: &SqlitePool, e: i64) -> Vec<Etb> {
    let zeilen: Vec<(
        i64,
        i64,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<i64>,
    )> = sqlx::query_as(
        "SELECT id, lfd_nr, typ, inhalt, von, an, veranlassung, berichtigt_eintrag_id \
             FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr",
    )
    .bind(e)
    .fetch_all(pool)
    .await
    .unwrap();
    zeilen
        .into_iter()
        .map(|(id, lfd_nr, typ, inhalt, von, an, ver, b)| Etb {
            id,
            lfd_nr,
            typ,
            text: format!(
                "{inhalt}\n{}\n{}\n{}",
                von.unwrap_or_default(),
                an.unwrap_or_default(),
                ver.unwrap_or_default()
            ),
            berichtigt: b,
        })
        .collect()
}

fn alle_gepflanzten() -> impl Iterator<Item = &'static str> {
    GEHEIM
        .iter()
        .copied()
        .chain(AUSNAHME_WERTE.iter().map(|(w, _)| *w))
}

/// Inhalt ALLER Scrub-Spalten aller Registry-Tabellen, eingegrenzt auf den Einsatz genau wie
/// die Schwärzung (Scoping und Zeilenfilter aus `schwaerzung_registry::TABELLEN`), als ein
/// Text. Tabellen- und Spaltennamen sind Registry-Konstanten, nie Eingaben.
async fn scrub_inhalt(pool: &SqlitePool, einsatz_id: i64) -> String {
    use lifeline_hub::einsatz::schwaerzung_registry::{Klassifikation, Scoping, TABELLEN};
    let mut text = String::new();
    for regel in TABELLEN {
        let basis = match regel.scoping {
            Scoping::SelbstId => "id = ?".to_string(),
            Scoping::EinsatzId => "einsatz_id = ?".to_string(),
            Scoping::UeberParent { fk, parent } => {
                format!("{fk} IN (SELECT id FROM {parent} WHERE einsatz_id = ?)")
            }
        };
        let bedingung = match regel.zeilenfilter {
            Some(f) => format!("{basis} AND ({f})"),
            None => basis,
        };
        for spalte in regel.spalten {
            if !matches!(spalte.klassifikation, Klassifikation::Scrub(_)) {
                continue;
            }
            let werte: Vec<Option<Vec<u8>>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT CAST({} AS BLOB) FROM {} WHERE {bedingung}",
                spalte.spalte, regel.tabelle
            )))
            .bind(einsatz_id)
            .fetch_all(pool)
            .await
            .unwrap_or_else(|e| panic!("{}.{}: {e}", regel.tabelle, spalte.spalte));
            for w in werte.into_iter().flatten() {
                text.push_str(&String::from_utf8_lossy(&w));
                text.push('\n');
            }
        }
    }
    text
}

/// Die Prüfungen, die während der Karenz UND nach der Schwärzung gelten.
async fn pruefe_skelett(
    app: &axum::Router,
    pool: &SqlitePool,
    admin: &str,
    e: i64,
    berichtigt: i64,
) -> (Value, Vec<Value>) {
    // Fremdschlüssel intakt.
    let fk: Vec<(String, i64, String, i64)> = sqlx::query_as("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap();
    assert!(fk.is_empty(), "foreign_key_check: {fk:?}");

    // ETB lückenlos, Berichtigung intakt.
    let etb = etb_zeilen(pool, e).await;
    let nrn: Vec<i64> = etb.iter().map(|x| x.lfd_nr).collect();
    let erwartet: Vec<i64> = (1..=etb.len() as i64).collect();
    assert_eq!(nrn, erwartet, "lfd_nr lückenlos");
    let korrektur = etb
        .iter()
        .find(|x| x.typ == "berichtigung")
        .expect("Berichtigung da");
    assert_eq!(korrektur.berichtigt, Some(berichtigt));
    assert!(etb
        .iter()
        .any(|x| x.id == berichtigt && x.text.contains("Erstmeldung Lage")));

    // Kein Geheimwert im ETB, Ausnahmewerte genau im zugehörigen System-Eintrag.
    for w in GEHEIM {
        let treffer: Vec<i64> = etb
            .iter()
            .filter(|x| x.text.contains(w))
            .map(|x| x.lfd_nr)
            .collect();
        assert!(treffer.is_empty(), "„{w}“ im ETB (lfd_nr {treffer:?})");
    }
    for (w, baustein) in AUSNAHME_WERTE {
        let treffer: Vec<&Etb> = etb.iter().filter(|x| x.text.contains(w)).collect();
        assert_eq!(treffer.len(), 1, "Ausnahme „{w}“ genau einmal im ETB");
        assert_eq!(
            treffer[0].typ, "system",
            "Ausnahme „{w}“ nur im System-Eintrag"
        );
        assert!(
            treffer[0].text.contains(baustein),
            "„{w}“ im falschen Eintrag: {}",
            treffer[0].text
        );
    }

    // Registriernummern erhalten.
    for (tabelle, anzahl) in [
        ("einsatz_person", 1),
        ("einsatz_tier", 1),
        ("einsatz_schaden", 1),
    ] {
        // Tabellenname ist eine Test-Konstante, kein Eingabewert.
        let nrn: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT registrier_nr FROM {tabelle} WHERE einsatz_id = ? ORDER BY registrier_nr"
        )))
        .bind(e)
        .fetch_all(pool)
        .await
        .unwrap();
        assert_eq!(
            nrn,
            (1..=anzahl).collect::<Vec<i64>>(),
            "{tabelle}.registrier_nr"
        );
    }

    // Archivakte und Archiv-ETB lesbar, ohne Geheim- und (im Kopf/Register) Ausnahmewerte.
    let (s, akte) = anfrage(
        app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{e}"),
        admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{akte}");
    let akte_text = akte.to_string();
    for w in GEHEIM.iter().chain(AUSNAHME_WERTE.iter().map(|(w, _)| w)) {
        assert!(
            !akte_text.contains(w),
            "„{w}“ in der Archivakte: {akte_text}"
        );
    }
    assert_eq!(akte["personen"][0]["registrier_anzeige"], "R-001");
    assert_eq!(akte["personen"][0]["aktuelle_sichtung"], "sk2");
    assert_eq!(akte["tiere"][0]["registrier_anzeige"], "T-001");
    assert_eq!(akte["schaeden"][0]["registrier_anzeige"], "S-001");
    let (s, archiv_etb) = anfrage(
        app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{e}/etb?limit=500"),
        admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let etb_text = archiv_etb.to_string();
    for w in GEHEIM {
        assert!(!etb_text.contains(w), "„{w}“ im Archiv-ETB");
    }
    assert_eq!(
        archiv_etb.as_array().unwrap().len(),
        etb.len(),
        "Archiv-ETB vollständig"
    );

    // Reguläre Routen bleiben dem Admin gesperrt.
    for uri in [
        format!("/api/einsaetze/{e}"),
        format!("/api/einsaetze/{e}/etb"),
        format!("/api/einsaetze/{e}/personen"),
        format!("/api/einsaetze/{e}/tiere"),
        format!("/api/einsaetze/{e}/schaeden"),
        format!("/api/einsaetze/{e}/live"),
    ] {
        let (s, _) = anfrage(app, "GET", &uri, admin, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{uri}");
    }
    (akte, archiv_etb.as_array().unwrap().clone())
}

/// Die Akte ohne die beiden Angaben, die sich durch die Schwärzung ändern MÜSSEN.
fn ohne_tombstone(mut akte: Value) -> Value {
    akte["kopf"]
        .as_object_mut()
        .unwrap()
        .remove("geschwaerzt_at");
    akte.as_object_mut().unwrap().remove("zustand");
    akte
}

#[tokio::test]
async fn ak3_person_tier_schaden_ueber_frist_und_karenz() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let basis = format!("/api/einsaetze/{e}");

    // 1. Dauer vor dem Abschluss (danach sind die Einstellungen eingefroren) + Kopf-PII.
    ok(
        &app,
        &admin,
        "PUT",
        &format!("{basis}/einstellungen"),
        json!({ "retention_dauer_tage": 1 }),
    )
    .await;
    ok(
        &app,
        &admin,
        "PATCH",
        &basis,
        json!({
            "einsatzort": "Marktplatz-Musterstadt-1",
            "meldende_stelle": "Anrufer-Kowalski",
            "sachverhalt": "Sachverhalt-GEHEIM-7"
        }),
    )
    .await;

    // 2. Person mit Identität, Sichtung, Statuswechsel, Transport.
    let p = ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/personen"),
        json!({
            "name": "Mustermann", "vorname": "Erika", "geburtsdatum": "1961-02-03",
            "herkunft_adresse": "Lindenweg-7", "antreff_ort": "Kellerraum-Nord",
            "melder_kontakt": "Melder-0171-4711", "notiz": "Insulinpflichtig",
            "zustand": "stark-unterkuehlt"
        }),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/personen/{p}/sichtung"),
        json!({ "kategorie": "sk2", "notiz": "Sichtungsnotiz-XYZ" }),
    )
    .await;
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/personen/{p}/verbleib"),
        json!({ "art": "transport", "ziel": "Klinikum-Nordstadt", "transportmittel": "RTW-Florian-83", "notiz": "Verbleibnotiz-QRS" }),
    )
    .await;
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/personen/{p}/status"),
        json!({ "status": "abgemeldet" }),
    )
    .await;

    // Tier mit Halterkontakt und Kennzeichnung, Abschluss mit Ziel.
    let t = ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/tiere"),
        json!({
            "spezies": "hund", "halter_kontakt": "Halterin-0172-9999",
            "kennzeichnung": "CHIP-276098106012345", "antreff_ort": "Scheune-Hof-Brandt",
            "notiz": "Tiernotiz-bissig"
        }),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/tiere/{t}/status"),
        json!({ "status": "abgeschlossen", "abschluss_grund": "uebergabe_tierheim", "abschluss_ziel": "Tierheim-Sued-ABC" }),
    )
    .await;

    // Schaden mit Ort, Beschreibung, Kontakt; übergeben und abgeschlossen.
    let sid = ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/schaeden"),
        json!({
            "typ": "sachschaden", "ausmass": "mittel", "ort": "Birkenallee-9",
            "beschreibung": "Dachschaden-Beschreibung", "geschaedigt_kontakt": "Eigentuemer-0173-1234"
        }),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/schaeden/{sid}/uebergeben"),
        json!({ "uebergeben_an": "Dachdecker-Ruehl" }),
    )
    .await;
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/schaeden/{sid}/abschliessen"),
        json!({ "abschluss_grund": "behoben" }),
    )
    .await;

    // Zone mit Label: ein bewusst behaltener Wert (Gruppe Lagestruktur, LFH-752).
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/zonen"),
        json!({
            "typ": "absperrbereich", "geometrie_typ": "Polygon", "label": "Sperrzone-Lindenplatz",
            "geometrie": r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#
        }),
    )
    .await;

    // Freier Eintrag und seine Berichtigung.
    let erst = ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/etb"),
        json!({ "typ": "meldung", "inhalt": "Erstmeldung Lage" }),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/etb"),
        json!({ "typ": "berichtigung", "inhalt": "Korrektur der Erstmeldung", "berichtigt_eintrag_id": erst }),
    )
    .await;

    // 3. Abschluss → Frist aus der Dauer.
    ok(
        &app,
        &admin,
        "POST",
        &format!("{basis}/abschliessen"),
        json!({}),
    )
    .await;
    let frist: String = sqlx::query_scalar("SELECT retention_bis FROM einsatz WHERE id = ?")
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();

    // 4. Vormerkung und Prüfung während der Karenz.
    assert_eq!(
        lifeline_hub::einsatz::purge_scheduler::tick_einmal(
            &pool,
            &lifeline_hub::live::LiveHub::new(),
            zeit(&frist) + Duration::seconds(1)
        )
        .await,
        1
    );
    let (akte_vorher, _) = pruefe_skelett(&app, &pool, &admin, e, erst).await;
    assert_eq!(akte_vorher["zustand"], "vorgemerkt");
    // Während der Karenz stehen die Personendaten noch in der DB — die Akte liest sie nicht.
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM einsatz_person WHERE id = ?")
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        name.as_deref(),
        Some("Mustermann"),
        "Vorbedingung: noch nicht geschwärzt"
    );

    // Vorbedingung der Quellzeilen-Prüfung nach der Schwärzung: jeder gepflanzte Wert steht
    // JETZT in einer Scrub-Spalte, die der Scan liest. Fehlt einer, könnte die spätere
    // Abwesenheit nicht rot werden.
    let vorher = scrub_inhalt(&pool, e).await;
    for w in alle_gepflanzten() {
        assert!(
            vorher.contains(w),
            "Vorbedingung: „{w}“ steht vor der Schwärzung in keiner Scrub-Spalte, die der Scan liest"
        );
    }

    // 5. Schwärzung nach der Karenz, dieselben Prüfungen.
    let geloescht: String = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        lifeline_hub::einsatz::purge_scheduler::tick_einmal(
            &pool,
            &lifeline_hub::live::LiveHub::new(),
            zeit(&geloescht) + Duration::days(30)
        )
        .await,
        1
    );
    let (akte_nachher, archiv_etb) = pruefe_skelett(&app, &pool, &admin, e, erst).await;
    assert_eq!(akte_nachher["zustand"], "geschwaerzt");
    assert_eq!(
        ohne_tombstone(akte_vorher),
        ohne_tombstone(akte_nachher),
        "Archivakte trägt vor und nach der Schwärzung dieselben Felder"
    );

    // Die Quellzeilen tragen die Werte nicht mehr: JEDE Scrub-Spalte JEDER Registry-Tabelle
    // des Einsatzes wird gelesen, nicht eine Handliste. Dass die Prüfung für jeden Wert rot
    // werden KANN, belegt die Vorbedingung oben (derselbe Scan fand jeden Wert vorher).
    let nachher = scrub_inhalt(&pool, e).await;
    for w in alle_gepflanzten() {
        assert!(!nachher.contains(w), "„{w}“ überlebt in einer Scrub-Spalte");
    }

    // Archiv-ETB (Typ System) mit Frist, Vormerkung und Schwärzung.
    let system: Vec<String> = archiv_etb
        .iter()
        .filter(|x| x["typ"] == "system")
        .map(|x| x["inhalt"].as_str().unwrap().to_string())
        .collect();
    for baustein in [
        "Aufbewahrungsfrist automatisch gesetzt",
        "zur Löschung vorgemerkt",
        "PII-Schwärzung durchgeführt",
    ] {
        assert!(
            system.iter().any(|x| x.contains(baustein)),
            "System-Eintrag „{baustein}“ fehlt"
        );
    }
    let (s, nur_system) = anfrage(
        &app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{e}/etb?typ=system&limit=500"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(nur_system.as_array().unwrap().len(), system.len());
}
