//! Rechenfunktion und Feldprüfung der Schichtmodelle (LLH-1122). Zeiten in den Namen als
//! Wanduhrzeit Europe/Berlin; im Oktober 2026 gilt bis zum 25. die Sommerzeit (UTC+2).

use axum::http::StatusCode;
use chrono_tz::Tz;

use super::*;

const BERLIN: Tz = chrono_tz::Europe::Berlin;

fn u(s: &str) -> Uhrzeit {
    Uhrzeit::parse("t", s).unwrap()
}

fn zwoelf_stunden(mindestdauer_minuten: i64) -> Regel {
    Regel::Wechselzeiten {
        zeiten: vec![u("06:00"), u("18:00")],
        mindestdauer_minuten,
    }
}

/// Fälligkeit (UTC) und Dauer in Minuten für einen Beginn in UTC.
fn faellig(regel: &Regel, beginn_utc: &str, zone: Tz) -> (String, i64) {
    regel.faelligkeit(beginn_utc, zone).unwrap()
}

#[test]
fn beginn_1342_wechsel_0600_1800_mindestdauer_4h_ist_1800() {
    // 13:42 Sommerzeit = 11:42 UTC; 18:00 Sommerzeit = 16:00 UTC.
    assert_eq!(
        faellig(&zwoelf_stunden(240), "2026-10-16 11:42:00", BERLIN),
        ("2026-10-16 16:00:00".into(), 258)
    );
}

#[test]
fn beginn_1500_ist_0600_am_folgetag() {
    // 15:00 + 4 h = 19:00, der nächste Wechsel ist 06:00 am Folgetag (04:00 UTC).
    assert_eq!(
        faellig(&zwoelf_stunden(240), "2026-10-16 13:00:00", BERLIN),
        ("2026-10-17 04:00:00".into(), 900)
    );
}

#[test]
fn wechsel_genau_an_der_mindestdauer_zaehlt() {
    // 14:00 + 4 h = 18:00: die Schicht erreicht die Mindestdauer genau zum Wechsel.
    assert_eq!(
        faellig(&zwoelf_stunden(240), "2026-10-16 12:00:00", BERLIN).0,
        "2026-10-16 16:00:00"
    );
    // Eine Minute später reicht es nicht mehr.
    assert_eq!(
        faellig(&zwoelf_stunden(240), "2026-10-16 12:01:00", BERLIN).0,
        "2026-10-17 04:00:00"
    );
}

#[test]
fn ohne_mindestdauer_zaehlt_der_naechste_wechsel_echt_nach_beginn() {
    // Beginn genau zum Wechsel: der Wechsel selbst beendet die Schicht nicht.
    assert_eq!(
        faellig(&zwoelf_stunden(0), "2026-10-16 04:00:00", BERLIN).0,
        "2026-10-16 16:00:00"
    );
}

#[test]
fn beginn_mit_sekunden_kurz_vor_dem_wechsel_dauert_eine_minute() {
    assert_eq!(
        faellig(&zwoelf_stunden(0), "2026-10-16 03:59:30", BERLIN),
        ("2026-10-16 04:00:00".into(), 1)
    );
}

#[test]
fn zeitumstellung_ende_maerz_zaehlt_die_echte_dauer() {
    // 28.03.2026 18:00 MEZ (17:00 UTC) + 4 h → 29.03. 06:00 MESZ = 04:00 UTC: elf echte Stunden.
    assert_eq!(
        faellig(&zwoelf_stunden(240), "2026-03-28 17:00:00", BERLIN),
        ("2026-03-29 04:00:00".into(), 660)
    );
}

#[test]
fn zeitumstellung_ende_oktober_zaehlt_die_echte_dauer() {
    // 24.10.2026 18:00 MESZ (16:00 UTC) + 4 h → 25.10. 06:00 MEZ = 05:00 UTC: dreizehn Stunden.
    assert_eq!(
        faellig(&zwoelf_stunden(240), "2026-10-24 16:00:00", BERLIN),
        ("2026-10-25 05:00:00".into(), 780)
    );
}

#[test]
fn wechsel_in_der_luecke_der_umstellung_gilt_eine_stunde_spaeter() {
    // 02:30 gibt es am 29.03.2026 nicht; es gilt 03:30 MESZ = 01:30 UTC.
    let regel = Regel::Wechselzeiten {
        zeiten: vec![u("02:30")],
        mindestdauer_minuten: 60,
    };
    assert_eq!(
        faellig(&regel, "2026-03-28 21:00:00", BERLIN).0,
        "2026-03-29 01:30:00"
    );
}

#[test]
fn doppelte_wechselzeit_der_umstellung_gilt_beim_ersten_mal() {
    // 02:30 gibt es am 25.10.2026 zweimal; es gilt die erste (MESZ, 00:30 UTC).
    let regel = Regel::Wechselzeiten {
        zeiten: vec![u("02:30")],
        mindestdauer_minuten: 60,
    };
    assert_eq!(
        faellig(&regel, "2026-10-24 20:00:00", BERLIN).0,
        "2026-10-25 00:30:00"
    );
}

#[test]
fn die_zone_entscheidet_die_wanduhr() {
    // Derselbe Beginn in UTC: in UTC ist 18:00 schon 18:00 UTC.
    assert_eq!(
        faellig(&zwoelf_stunden(240), "2026-10-16 11:42:00", chrono_tz::UTC).0,
        "2026-10-16 18:00:00"
    );
}

#[test]
fn rhythmus_ist_beginn_plus_minuten() {
    assert_eq!(
        faellig(
            &Regel::Rhythmus { minuten: 360 },
            "2026-10-16 09:30:00",
            BERLIN
        ),
        ("2026-10-16 15:30:00".into(), 360)
    );
    assert_eq!(
        Regel::Rhythmus { minuten: 360 }.faelligkeit("kaputt", BERLIN),
        None
    );
}

/// LLH-1469: die Wechselzeiten folgen der Darstellung des Einsatzes (Rolle „Uhrzeit“), taktisch
/// `0600/1800`, „Datum und Uhrzeit“ `06:00/18:00`; der Rhythmus kennt keine Uhrzeit.
#[test]
fn text_liest_sich() {
    use crate::zeitdarstellung::Zeitdarstellung::{DatumUhrzeit, Taktisch};
    assert_eq!(
        Regel::Rhythmus { minuten: 720 }.text(Taktisch),
        "Rhythmus 12 h"
    );
    assert_eq!(
        Regel::Rhythmus { minuten: 720 }.text(DatumUhrzeit),
        "Rhythmus 12 h"
    );
    assert_eq!(
        zwoelf_stunden(240).text(Taktisch),
        "Wechsel 0600/1800, Mindestdauer 4 h"
    );
    assert_eq!(zwoelf_stunden(0).text(Taktisch), "Wechsel 0600/1800");
    assert_eq!(
        zwoelf_stunden(240).text(DatumUhrzeit),
        "Wechsel 06:00/18:00, Mindestdauer 4 h"
    );
    assert_eq!(zwoelf_stunden(0).text(DatumUhrzeit), "Wechsel 06:00/18:00");
}

fn body(typ: &str) -> WerteBody {
    WerteBody {
        bezeichnung: " 12-h-Schicht ".into(),
        typ: typ.into(),
        rhythmus_minuten: None,
        wechselzeiten: None,
        mindestdauer_minuten: None,
        vorwarnung_minuten: None,
        planungsvorlauf_minuten: None,
    }
}

fn status(b: &WerteBody) -> StatusCode {
    b.check().unwrap_err().status()
}

#[test]
fn rhythmus_mit_vorgaben() {
    let w = WerteBody {
        rhythmus_minuten: Some(360),
        ..body("rhythmus")
    }
    .check()
    .unwrap();
    assert_eq!(
        w,
        Werte {
            bezeichnung: "12-h-Schicht".into(),
            regel: Regel::Rhythmus { minuten: 360 },
            vorwarnung_minuten: 30,
            planungsvorlauf_minuten: 120,
        }
    );
}

#[test]
fn wechselzeiten_werden_sortiert_und_entdoppelt() {
    let w = WerteBody {
        wechselzeiten: Some(vec!["1800".into(), "06:00".into(), "18:00".into()]),
        mindestdauer_minuten: Some(240),
        vorwarnung_minuten: Some(45),
        ..body("wechselzeiten")
    }
    .check()
    .unwrap();
    assert_eq!(w.regel, zwoelf_stunden(240));
    assert_eq!(w.vorwarnung_minuten, 45);
}

#[test]
fn feldfehler_sind_400() {
    assert_eq!(
        status(&WerteBody {
            bezeichnung: "  ".into(),
            rhythmus_minuten: Some(60),
            ..body("rhythmus")
        }),
        StatusCode::BAD_REQUEST,
        "leere Bezeichnung"
    );
    assert_eq!(
        status(&WerteBody {
            rhythmus_minuten: Some(60),
            ..body("schicht")
        }),
        StatusCode::BAD_REQUEST,
        "unbekannter Typ"
    );
    assert_eq!(
        status(&body("rhythmus")),
        StatusCode::BAD_REQUEST,
        "Rhythmus fehlt"
    );
    for r in [0, 10_081] {
        assert_eq!(
            status(&WerteBody {
                rhythmus_minuten: Some(r),
                ..body("rhythmus")
            }),
            StatusCode::BAD_REQUEST,
            "Rhythmus {r}"
        );
    }
    assert_eq!(
        status(&WerteBody {
            mindestdauer_minuten: Some(60),
            ..body("wechselzeiten")
        }),
        StatusCode::BAD_REQUEST,
        "Wechselzeiten fehlen"
    );
    assert_eq!(
        status(&WerteBody {
            wechselzeiten: Some(vec![]),
            mindestdauer_minuten: Some(60),
            ..body("wechselzeiten")
        }),
        StatusCode::BAD_REQUEST,
        "leere Wechselzeiten"
    );
    assert_eq!(
        status(&WerteBody {
            wechselzeiten: Some(vec!["06:00".into()]),
            ..body("wechselzeiten")
        }),
        StatusCode::BAD_REQUEST,
        "Mindestdauer fehlt"
    );
    assert_eq!(
        status(&WerteBody {
            wechselzeiten: Some(vec!["25:00".into()]),
            mindestdauer_minuten: Some(60),
            ..body("wechselzeiten")
        }),
        StatusCode::BAD_REQUEST,
        "unlesbare Uhrzeit"
    );
    assert_eq!(
        status(&WerteBody {
            wechselzeiten: Some(vec!["06:00".into(); WECHSELZEITEN_MAX + 1]),
            mindestdauer_minuten: Some(60),
            ..body("wechselzeiten")
        }),
        StatusCode::BAD_REQUEST,
        "zu viele Wechselzeiten, gezählt vor dem Entdoppeln"
    );
    for (feld, wert) in [
        ("mindestdauer", 1_441),
        ("vorwarnung", 0),
        ("planung", 1_441),
    ] {
        let b = WerteBody {
            wechselzeiten: Some(vec!["06:00".into()]),
            mindestdauer_minuten: Some(if feld == "mindestdauer" { wert } else { 60 }),
            vorwarnung_minuten: (feld == "vorwarnung").then_some(wert),
            planungsvorlauf_minuten: (feld == "planung").then_some(wert),
            ..body("wechselzeiten")
        };
        assert_eq!(status(&b), StatusCode::BAD_REQUEST, "{feld} {wert}");
    }
}

#[test]
fn feld_des_anderen_typs_ist_422() {
    assert_eq!(
        status(&WerteBody {
            rhythmus_minuten: Some(60),
            wechselzeiten: Some(vec!["06:00".into()]),
            ..body("rhythmus")
        }),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        status(&WerteBody {
            rhythmus_minuten: Some(60),
            wechselzeiten: Some(vec!["06:00".into()]),
            mindestdauer_minuten: Some(0),
            ..body("wechselzeiten")
        }),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[test]
fn spalten_und_zeile_runden_sich() {
    let werte = Werte {
        bezeichnung: "Hochwasser".into(),
        regel: zwoelf_stunden(240),
        vorwarnung_minuten: 45,
        planungsvorlauf_minuten: 90,
    };
    let (typ, rhythmus, wechselzeiten, mindestdauer) = columns(&werte.regel);
    assert_eq!(wechselzeiten.as_deref(), Some(r#"["06:00","18:00"]"#));
    let zeile = WerteZeile {
        bezeichnung: werte.bezeichnung.clone(),
        typ: typ.into(),
        rhythmus_minuten: rhythmus,
        wechselzeiten,
        mindestdauer_minuten: mindestdauer,
        vorwarnung_minuten: 45,
        planungsvorlauf_minuten: 90,
    };
    assert_eq!(zeile.werte().unwrap(), werte);
}
