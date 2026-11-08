//! Kennzahlen der Liste (design.md D7, Spec `vorplanung`, „Liste der Planungen“).

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use super::*;
use crate::abloesung::schichtplan::pruefung::{pruefe, Block, Grundlage, PersonStand};
use crate::abloesung::schichtplan::{PlanPerson, Posten};

fn t(s: &str) -> DateTime<Utc> {
    crate::zeit::parse_utc(&format!("2026-11-14 {s}:00")).unwrap()
}

fn block(id: i64, posten: Posten, von: &str, bis: &str, soll: Option<i64>) -> Block {
    Block {
        id,
        posten,
        von: t(von),
        bis: t(bis),
        soll_anzahl: soll,
        quali_soll: Vec::new(),
        personen: Vec::new(),
        posten_aufgeloest: false,
    }
}

fn rechne(bloecke: &[Block]) -> PlanungKennzahlen {
    let katalog = HashMap::new();
    let personen: HashMap<PlanPerson, PersonStand> = HashMap::new();
    let ueber = HashMap::new();
    let ergebnis = pruefe(
        bloecke,
        &Grundlage {
            katalog: &katalog,
            personen: &personen,
            ueber_einheit: &ueber,
            grenzwerte: SchichtplanGrenzwerte::aus(None, None),
            jetzt: t("15:00"),
            mit_ist: false,
        },
    );
    kennzahlen(bloecke, &ergebnis)
}

/// Spec-Szenario „Kennzahlen“: zwei Blöcke mit Soll 2, drei Personen, eine davon doppelt.
#[test]
fn soll_ist_offen_konflikte_wie_im_szenario() {
    let mia = PlanPerson::Stamm(1);
    let mut a = block(1, Posten::Einheit(10), "14:00", "17:00", Some(2));
    a.personen = vec![mia, PlanPerson::Stamm(2)];
    let mut b = block(2, Posten::Einheit(20), "16:00", "20:00", Some(2));
    b.personen = vec![mia];
    assert_eq!(
        rechne(&[a, b]),
        PlanungKennzahlen {
            soll: 4,
            ist: 3,
            offen: 1,
            konflikte: 2,
        }
    );
}

/// Die Pause zählt nicht zum Soll; ein Überhang über das Soll zählt nicht als Ist.
#[test]
fn pause_ohne_soll_und_ist_hoechstens_bis_zum_soll() {
    let mut a = block(1, Posten::Einheit(10), "10:00", "12:00", Some(1));
    a.personen = vec![PlanPerson::Stamm(1), PlanPerson::Helfer(5)];
    let mut pause = block(2, Posten::Pause, "12:00", "13:00", None);
    pause.personen = vec![PlanPerson::Stamm(1)];
    assert_eq!(
        rechne(&[a, pause]),
        PlanungKennzahlen {
            soll: 1,
            ist: 1,
            offen: 0,
            konflikte: 0,
        }
    );
}

/// Ein Block an einem nicht verfügbaren Posten zählt als Konflikt.
#[test]
fn nicht_verfuegbarer_posten_ist_ein_konflikt() {
    let mut a = block(1, Posten::Einheit(10), "10:00", "12:00", None);
    a.posten_aufgeloest = true;
    assert_eq!(rechne(&[a]).konflikte, 1);
}
