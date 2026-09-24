//! Reine Bausteine des Fachmoduls Verpflegung (LFH-634): Zeitraum in Ortszeit, ETB-Texte,
//! Sonderkost-Prüfung. Die Zeitpunkte sind ABSOLUT (UTC) angegeben, nicht als Rundreise — ein
//! Fehler, der beide Richtungen um denselben Betrag verschiebt, bliebe sonst grün.

use super::*;
use crate::einsatz::nummer::{zone_oder_vorgabe, ZEITZONE_VORGABE};
use axum::http::StatusCode;

fn utc(s: &str) -> DateTime<Utc> {
    chrono::NaiveDateTime::parse_from_str(s, DRAHT)
        .unwrap()
        .and_utc()
}

fn berlin(von: &str, bis: &str) -> String {
    zeitraum_text(utc(von), utc(bis), ZEITZONE_VORGABE)
}

// ── zeitraum_text ───────────────────────────────────────────────────────────────────────────

/// Spec „Zeitraum in Ortszeit“: 10:00–11:30 UTC am 24.09. ist 12:00–13:30 in Berlin (MESZ).
#[test]
fn zeitraum_in_ortszeit_nicht_utc() {
    assert_eq!(
        berlin("2026-09-24 10:00:00", "2026-09-24 11:30:00"),
        "24.09. 12:00–13:30"
    );
}

/// Sommerzeitbeginn 29.03.2026, 01:00 UTC: davor +1, danach +2 — beidseits der Grenze.
#[test]
fn sommerzeitbeginn_beidseits_der_grenze() {
    assert_eq!(
        berlin("2026-03-28 10:00:00", "2026-03-28 11:00:00"),
        "28.03. 11:00–12:00",
        "Tag davor: MEZ (+1)"
    );
    assert_eq!(
        berlin("2026-03-29 00:30:00", "2026-03-29 01:30:00"),
        "29.03. 01:30–03:30",
        "über die Grenze: die Stunde 02:xx gibt es nicht"
    );
    assert_eq!(
        berlin("2026-03-30 10:00:00", "2026-03-30 11:00:00"),
        "30.03. 12:00–13:00",
        "Tag danach: MESZ (+2)"
    );
}

/// Sommerzeitende 25.10.2026, 01:00 UTC: die Stunde 02:xx gibt es zweimal.
#[test]
fn sommerzeitende_beidseits_der_grenze() {
    assert_eq!(
        berlin("2026-10-24 10:00:00", "2026-10-24 11:00:00"),
        "24.10. 12:00–13:00",
        "Tag davor: MESZ (+2)"
    );
    assert_eq!(
        berlin("2026-10-25 00:30:00", "2026-10-25 01:30:00"),
        "25.10. 02:30–02:30",
        "00:30 UTC und 01:30 UTC sind beide 02:30 Ortszeit"
    );
    assert_eq!(
        berlin("2026-10-26 10:00:00", "2026-10-26 11:00:00"),
        "26.10. 11:00–12:00",
        "Tag danach: MEZ (+1)"
    );
}

/// Über Mitternacht entscheidet das ORTSdatum, nicht das UTC-Datum.
#[test]
fn ueber_mitternacht_nach_ortsdatum() {
    assert_eq!(
        berlin("2026-09-24 21:30:00", "2026-09-24 22:30:00"),
        "24.09. 23:30–25.09. 00:30",
        "UTC ein Tag, Ortszeit zwei Tage → beide Daten"
    );
    assert_eq!(
        berlin("2026-09-24 22:30:00", "2026-09-24 23:30:00"),
        "25.09. 00:30–01:30",
        "UTC ein Tag, Ortszeit ein (anderer) Tag → ein Datum"
    );
    assert_eq!(
        berlin("2026-09-24 20:00:00", "2026-09-25 04:00:00"),
        "24.09. 22:00–25.09. 06:00"
    );
}

#[test]
fn andere_org_zeitzone_und_rueckfall() {
    let ny = zone_oder_vorgabe(Some("America/New_York"));
    assert_eq!(
        zeitraum_text(utc("2026-09-24 16:00:00"), utc("2026-09-24 17:30:00"), ny),
        "24.09. 12:00–13:30"
    );
    assert_eq!(zone_oder_vorgabe(None), ZEITZONE_VORGABE);
    assert_eq!(
        zone_oder_vorgabe(Some("Mars/Olympus")),
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
        etb_text::angelegt("Mittag", "24.09. 12:00–13:30", &b),
        "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 angelegt: Bedarf 250 EP (180 Kräfte, \
         70 Betreute), davon 15 Sonderkost."
    );
    assert_eq!(
        etb_text::angelegt(
            "Nacht",
            "24.09. 23:00–25.09. 01:00",
            &bedarf(0, 0, 0, Sonderkost::default())
        ),
        "Verpflegung ‚Nacht‘ 24.09. 23:00–25.09. 01:00 angelegt: Bedarf 0 EP."
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
        etb_text::geaendert("Mittag", "24.09. 12:00–13:30", &b, &a),
        "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 geändert: Bedarf 270 EP (vorher 250)."
    );
}

#[test]
fn etb_geaendert_ohne_neuen_gesamtbedarf_nennt_ihn_im_kopf() {
    let b = bedarf(180, 70, 0, Sonderkost::default());
    let a = etb_text::Aenderungen {
        bezeichnung_vorher: Some("Mittagessen"),
        zeitraum_vorher: Some("24.09. 11:30–13:00"),
        ..Default::default()
    };
    assert_eq!(
        etb_text::geaendert("Mittag", "24.09. 12:00–13:30", &b, &a),
        "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 (Bedarf 250 EP) geändert: Bezeichnung \
         (vorher ‚Mittagessen‘), Zeitraum (vorher 24.09. 11:30–13:00)."
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
        etb_text::geaendert("Mittag", "24.09. 12:00–13:30", &b, &a),
        "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 (Bedarf 250 EP) geändert: Aufteilung \
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
            "24.09. 12:00–13:30",
            &bedarf(180, 70, 0, Sonderkost::default())
        ),
        "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 gelöscht (Bedarf 250 EP)."
    );
}
