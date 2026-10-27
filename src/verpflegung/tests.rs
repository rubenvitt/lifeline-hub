//! Reine Bausteine des Fachmoduls Verpflegung (LFH-634): Zeitraum in Ortszeit, ETB-Texte,
//! Sonderkost-Prüfung. Die Zeitpunkte sind ABSOLUT (UTC) angegeben, nicht als Rundreise — ein
//! Fehler, der beide Richtungen um denselben Betrag verschiebt, bliebe sonst grün.

use super::*;
use crate::einsatz::nummer::ZEITZONE_VORGABE;
use crate::zeitdarstellung::wirksame_zone;
use crate::zeitdarstellung::{Zeitdarstellung, Zeitstil};
use axum::http::StatusCode;

fn utc(s: &str) -> DateTime<Utc> {
    crate::zeit::parse_utc(s).unwrap()
}

fn berlin(von: &str, bis: &str) -> String {
    zeitraum_text(
        utc(von),
        utc(bis),
        Zeitstil::new(ZEITZONE_VORGABE, Zeitdarstellung::Taktisch),
    )
}

// ── zeitraum_text ───────────────────────────────────────────────────────────────────────────

/// Spec „Zeitraum in Ortszeit“: 10:00–11:30 UTC am 24.09. ist 12:00–13:30 in Berlin (MESZ).
#[test]
fn zeitraum_in_ortszeit_nicht_utc() {
    assert_eq!(
        berlin("2026-09-24 10:00:00", "2026-09-24 11:30:00"),
        "241200sep26–1330"
    );
}

/// Sommerzeitbeginn 29.03.2026, 01:00 UTC: davor +1, danach +2 — beidseits der Grenze.
#[test]
fn sommerzeitbeginn_beidseits_der_grenze() {
    assert_eq!(
        berlin("2026-03-28 10:00:00", "2026-03-28 11:00:00"),
        "281100mrz26–1200",
        "Tag davor: MEZ (+1)"
    );
    assert_eq!(
        berlin("2026-03-29 00:30:00", "2026-03-29 01:30:00"),
        "290130mrz26–0330",
        "über die Grenze: die Stunde 02:xx gibt es nicht"
    );
    assert_eq!(
        berlin("2026-03-30 10:00:00", "2026-03-30 11:00:00"),
        "301200mrz26–1300",
        "Tag danach: MESZ (+2)"
    );
}

/// Sommerzeitende 25.10.2026, 01:00 UTC: die Stunde 02:xx gibt es zweimal.
#[test]
fn sommerzeitende_beidseits_der_grenze() {
    assert_eq!(
        berlin("2026-10-24 10:00:00", "2026-10-24 11:00:00"),
        "241200okt26–1300",
        "Tag davor: MESZ (+2)"
    );
    assert_eq!(
        berlin("2026-10-25 00:30:00", "2026-10-25 01:30:00"),
        "250230okt26–0230",
        "00:30 UTC und 01:30 UTC sind beide 02:30 Ortszeit"
    );
    assert_eq!(
        berlin("2026-10-26 10:00:00", "2026-10-26 11:00:00"),
        "261100okt26–1200",
        "Tag danach: MEZ (+1)"
    );
}

/// Über Mitternacht entscheidet das ORTSdatum, nicht das UTC-Datum.
#[test]
fn ueber_mitternacht_nach_ortsdatum() {
    assert_eq!(
        berlin("2026-09-24 21:30:00", "2026-09-24 22:30:00"),
        "242330sep26–250030sep26",
        "UTC ein Tag, Ortszeit zwei Tage → beide Daten"
    );
    assert_eq!(
        berlin("2026-09-24 22:30:00", "2026-09-24 23:30:00"),
        "250030sep26–0130",
        "UTC ein Tag, Ortszeit ein (anderer) Tag → ein Datum"
    );
    assert_eq!(
        berlin("2026-09-24 20:00:00", "2026-09-25 04:00:00"),
        "242200sep26–250600sep26"
    );
}

#[test]
fn andere_zeitzone_und_rueckfall() {
    let ny = wirksame_zone(Some("America/New_York"), None);
    assert_eq!(
        zeitraum_text(
            utc("2026-09-24 16:00:00"),
            utc("2026-09-24 17:30:00"),
            Zeitstil::new(ny, Zeitdarstellung::DatumUhrzeit)
        ),
        "24.09.26 12:00–13:30"
    );
    assert_eq!(wirksame_zone(None, None), ZEITZONE_VORGABE);
    assert_eq!(
        wirksame_zone(Some("Mars/Olympus"), None),
        ZEITZONE_VORGABE,
        "unbekannte Zone fällt auf Berlin"
    );
}

// ── Drahtformat ─────────────────────────────────────────────────────────────────────────────

#[test]
fn draht_lesen_verlangt_gepolsterte_utc_form() {
    assert_eq!(
        draht_lesen("von_at", "2026-09-24 10:00:00").unwrap(),
        utc("2026-09-24 10:00:00")
    );
    for kaputt in ["2026-9-24 10:00:00", "gestern", "", "2026-09-24T10:00:00Z"] {
        assert_eq!(
            draht_lesen("von_at", kaputt).unwrap_err().status(),
            StatusCode::BAD_REQUEST,
            "{kaputt:?}"
        );
    }
}

// ── Sonderkost ──────────────────────────────────────────────────────────────────────────────

#[test]
fn sonderkost_negative_kostform_ist_400() {
    let sk = Sonderkost {
        ohne_schwein: -1,
        ..Sonderkost::default()
    };
    let e = sk.pruefen().unwrap_err();
    assert_eq!(e.status(), StatusCode::BAD_REQUEST);
    assert!(e.to_string().contains("ohne_schwein"), "{e}");
    assert!(Sonderkost::default().pruefen().is_ok());
}

#[test]
fn sonderkost_eingabe_legt_sich_ueber_den_bestand() {
    let basis = Sonderkost {
        vegetarisch: 12,
        vegan: 3,
        ..Sonderkost::default()
    };
    let eingabe = SonderkostEingabe {
        vegan: Some(5),
        ..SonderkostEingabe::default()
    };
    assert_eq!(
        eingabe.ueber(&basis),
        Sonderkost {
            vegetarisch: 12,
            vegan: 5,
            ..Sonderkost::default()
        },
        "fehlende Felder bleiben"
    );
    assert_eq!(eingabe.ueber(&Sonderkost::default()).summe(), 5);
}

// ── ETB-Texte ───────────────────────────────────────────────────────────────────────────────

fn bedarf(kraefte: i64, betreute: i64, weitere: i64, sonderkost: Sonderkost) -> Bedarf {
    Bedarf {
        kraefte,
        betreute,
        weitere,
        gesamt: kraefte + betreute + weitere,
        sonderkost,
    }
}

#[test]
fn etb_angelegt_nennt_zeitraum_bedarf_aufteilung_und_sonderkost() {
    let b = bedarf(
        180,
        70,
        0,
        Sonderkost {
            vegetarisch: 12,
            vegan: 3,
            ..Sonderkost::default()
        },
    );
    assert_eq!(
        etb_text::angelegt("Mittag", "241200sep26–1330", &b, None, &[]),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 angelegt: Bedarf 250 EP (180 Kräfte, \
         70 Betreute), davon 15 Sonderkost."
    );
    assert_eq!(
        etb_text::angelegt(
            "Nacht",
            "242300sep26–250100sep26",
            &bedarf(0, 0, 0, Sonderkost::default()),
            None,
            &[]
        ),
        "Verpflegung ‚Nacht‘ 242300sep26–250100sep26 angelegt: Bedarf 0 EP."
    );
}

/// Spec „Bedarf geändert“: 250 → 270 nennt Bezeichnung, Zeitraum, 270 EP und den Vorwert 250.
#[test]
fn etb_geaendert_nennt_neuen_und_alten_gesamtbedarf() {
    let b = bedarf(180, 90, 0, Sonderkost::default());
    let a = etb_text::Aenderungen {
        gesamt_vorher: Some(250),
        ..Default::default()
    };
    assert_eq!(
        etb_text::geaendert("Mittag", "241200sep26–1330", &b, &a),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 geändert: Bedarf 270 EP (vorher 250)."
    );
}

#[test]
fn etb_geaendert_ohne_neuen_gesamtbedarf_nennt_ihn_im_kopf() {
    let b = bedarf(180, 70, 0, Sonderkost::default());
    let a = etb_text::Aenderungen {
        bezeichnung_vorher: Some("Mittagessen"),
        zeitraum_vorher: Some("241130sep26–1300"),
        ..Default::default()
    };
    assert_eq!(
        etb_text::geaendert("Mittag", "241200sep26–1330", &b, &a),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 (Bedarf 250 EP) geändert: Bezeichnung \
         (vorher ‚Mittagessen‘), Zeitraum (vorher 241130sep26–1300)."
    );
    let a = etb_text::Aenderungen {
        aufteilung: true,
        sonderkost_vorher: Some(0),
        ..Default::default()
    };
    let b = bedarf(
        200,
        50,
        0,
        Sonderkost {
            vegan: 4,
            ..Sonderkost::default()
        },
    );
    assert_eq!(
        etb_text::geaendert("Mittag", "241200sep26–1330", &b, &a),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 (Bedarf 250 EP) geändert: Aufteilung \
         (200 Kräfte, 50 Betreute), Sonderkost 4 (vorher 0)."
    );
    assert!(!a.leer());
    assert!(etb_text::Aenderungen::default().leer());
}

#[test]
fn etb_geloescht_nennt_zeitraum_und_bedarf() {
    assert_eq!(
        etb_text::geloescht(
            "Mittag",
            "241200sep26–1330",
            &bedarf(180, 70, 0, Sonderkost::default())
        ),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 gelöscht (Bedarf 250 EP)."
    );
}

// ── Verpflegungsstellen (LLH-1040) ──────────────────────────────────────────────────────────

fn namen(n: &[&str]) -> Vec<String> {
    n.iter().map(|s| s.to_string()).collect()
}

/// design.md D7: Art und Stellen hängen nur an, wenn gesetzt.
#[test]
fn etb_angelegt_nennt_art_und_stellen_nur_wenn_gesetzt() {
    let b = bedarf(
        180,
        70,
        0,
        Sonderkost {
            vegan: 15,
            ..Sonderkost::default()
        },
    );
    let stellen = namen(&["Feldküche BR Sportplatz", "Ausgabe Turnhalle Nord"]);
    assert_eq!(
        etb_text::angelegt(
            "Mittag",
            "241200sep26–1330",
            &b,
            Some(Verpflegungsart::Warm),
            &stellen
        ),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 angelegt: Bedarf 250 EP (180 Kräfte, \
         70 Betreute), davon 15 Sonderkost; warm; an ‚Feldküche BR Sportplatz‘, \
         ‚Ausgabe Turnhalle Nord‘."
    );
    assert_eq!(
        etb_text::angelegt(
            "Getränke",
            "241200sep26–1330",
            &bedarf(120, 0, 0, Sonderkost::default()),
            Some(Verpflegungsart::Getraenke),
            &[]
        ),
        "Verpflegung ‚Getränke‘ 241200sep26–1330 angelegt: Bedarf 120 EP (120 Kräfte); \
         Getränke."
    );
    assert_eq!(
        etb_text::angelegt(
            "Mittag",
            "241200sep26–1330",
            &bedarf(10, 0, 0, Sonderkost::default()),
            None,
            &namen(&["Zuführung Deich"])
        ),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 angelegt: Bedarf 10 EP (10 Kräfte); an \
         ‚Zuführung Deich‘."
    );
}

#[test]
fn etb_geaendert_nennt_art_und_stellen_jetzt_und_vorher() {
    let b = bedarf(180, 70, 0, Sonderkost::default());
    let jetzt = namen(&["A", "B"]);
    let vorher = namen(&["A"]);
    let a = etb_text::Aenderungen {
        art: Some((Some(Verpflegungsart::Kalt), Some(Verpflegungsart::Warm))),
        stellen: Some((&jetzt, &vorher)),
        ..Default::default()
    };
    assert!(!a.leer());
    assert_eq!(
        etb_text::geaendert("Mittag", "241200sep26–1330", &b, &a),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 (Bedarf 250 EP) geändert: Art kalt \
         (vorher warm), Stellen ‚A‘, ‚B‘ (vorher ‚A‘)."
    );
    let a = etb_text::Aenderungen {
        art: Some((None, Some(Verpflegungsart::Getraenke))),
        stellen: Some((&[], &vorher)),
        ..Default::default()
    };
    assert_eq!(
        etb_text::geaendert("Mittag", "241200sep26–1330", &b, &a),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 (Bedarf 250 EP) geändert: Art ohne Angabe \
         (vorher Getränke), Stellen keine (vorher ‚A‘)."
    );
    let a = etb_text::Aenderungen {
        art: Some((Some(Verpflegungsart::Warm), None)),
        stellen: Some((&vorher, &[])),
        ..Default::default()
    };
    assert_eq!(
        etb_text::geaendert("Mittag", "241200sep26–1330", &b, &a),
        "Verpflegung ‚Mittag‘ 241200sep26–1330 (Bedarf 250 EP) geändert: Art warm \
         (vorher ohne Angabe), Stellen ‚A‘ (vorher keine)."
    );
}

/// design.md D7, Muster `bereitstellungsraum::etb_text_status`.
#[test]
fn etb_stelle_status_in_betrieb_aufgeloest_und_geplant_ohne_text() {
    use stelle::{VerpflegungsstelleArt as Art, VerpflegungsstelleStatus as St};
    assert_eq!(
        etb_text::stelle_status("Feldküche BR Sportplatz", Art::Feldkueche, St::Aktiv).as_deref(),
        Some("Verpflegungsstelle ‚Feldküche BR Sportplatz‘ (Feldküche) in Betrieb genommen.")
    );
    assert_eq!(
        etb_text::stelle_status("Ausgabe Turnhalle Nord", Art::Ausgabestelle, St::Aufgeloest)
            .as_deref(),
        Some("Verpflegungsstelle ‚Ausgabe Turnhalle Nord‘ (Ausgabestelle) aufgelöst.")
    );
    assert_eq!(
        etb_text::stelle_status("Zuführung Deich", Art::Zufuehrung, St::Geplant),
        None
    );
}

/// design.md D5: 21 Einträge sind 400, auch wenn sie entdoppelt weniger wären; danach
/// entdoppelt in der Reihenfolge des ersten Auftretens.
#[test]
fn stelle_ids_grenze_vor_dem_entdoppeln() {
    assert_eq!(dedupe_stelle_ids(&[3, 3, 4]).unwrap(), vec![3, 4]);
    assert_eq!(dedupe_stelle_ids(&[]).unwrap(), Vec::<i64>::new());
    let zwanzig: Vec<i64> = (1..=20).collect();
    assert_eq!(dedupe_stelle_ids(&zwanzig).unwrap(), zwanzig);
    assert_eq!(
        dedupe_stelle_ids(&[7; 21]).unwrap_err().status(),
        StatusCode::BAD_REQUEST
    );
}
