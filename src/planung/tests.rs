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

/// Scheitert die Löschung einer fälligen Planung, löscht der Lauf die übrigen weiter und meldet
/// die schon gelöschten; die gescheiterte bleibt für den nächsten Lauf.
#[tokio::test]
async fn purge_meldet_geloeschte_auch_wenn_eine_scheitert() {
    let pool = crate::db::test_pool().await;
    let org: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) VALUES ('Org', 'hilfsorganisation') \
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut ids = Vec::new();
    for name in ["A", "B", "C"] {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO planung (org_id, bezeichnung, von, bis) \
             VALUES (?, ?, '2026-01-10 08:00:00', '2026-01-10 18:00:00') RETURNING id",
        )
        .bind(org)
        .bind(name)
        .fetch_one(&pool)
        .await
        .unwrap();
        ids.push(id);
    }
    sqlx::query(
        "CREATE TRIGGER sperre_b BEFORE DELETE ON planung WHEN OLD.bezeichnung = 'B' \
         BEGIN SELECT RAISE(ABORT, 'gesperrt'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let weg = repo::purge_abgelaufene(&pool, t("15:00")).await.unwrap();
    assert_eq!(weg, vec![(org, ids[0]), (org, ids[2])]);
    let rest: Vec<i64> = sqlx::query_scalar("SELECT id FROM planung ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(
        rest,
        vec![ids[1]],
        "die gescheiterte bleibt für den nächsten Lauf"
    );
}
