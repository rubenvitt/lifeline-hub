//! Meldungen nach Phase, seitenweise, Kennzahlen und Einzelabruf (LFH-940, Spec
//! `meldungen-blaettern`).

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::collections::HashSet;

mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen, login_cookie, setup_mit_pool};

fn meldung(inhalt: &str, richtung: &str) -> Value {
    json!({
        "absender": "Florian Nord 1",
        "meldeweg": "funk",
        "inhalt": inhalt,
        "richtung": richtung,
        "ereigniszeit": "2026-10-01 09:00:00",
    })
}

/// Legt `n` Meldungen an und liefert ihre ids in Anlagereihenfolge.
async fn anlegen(app: &axum::Router, cookie: &str, e: i64, n: usize, richtung: &str) -> Vec<i64> {
    let mut ids = Vec::with_capacity(n);
    for i in 0..n {
        let (s, v) = anfrage_json(
            app,
            "POST",
            &format!("/api/einsaetze/{e}/meldungen"),
            cookie,
            Some(&meldung(&format!("Meldung {i}"), richtung)),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        ids.push(v["id"].as_i64().unwrap());
    }
    ids
}

/// Setzt Meldungen direkt auf erledigt, mit gestaffeltem Erledigt-Zeitpunkt (Index = Minute).
async fn erledigen(pool: &sqlx::SqlitePool, ids: &[i64], zeit: impl Fn(usize) -> String) {
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE meldung SET status = 'erledigt', erledigt_at = ? WHERE id = ?")
            .bind(zeit(i))
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }
}

fn ids(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap_or_else(|| panic!("Liste erwartet: {v}"))
        .iter()
        .map(|m| m["id"].as_i64().unwrap())
        .collect()
}

async fn get(app: &axum::Router, cookie: &str, pfad: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", pfad, cookie, None).await
}

#[tokio::test]
async fn phase_trennt_offen_und_abgeschlossen_ohne_phase_bleibt_alles() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 5, "intern").await;
    erledigen(&pool, &alle[..3], |i| format!("2026-10-01 10:0{i}:00")).await;

    let basis = format!("/api/einsaetze/{e}/meldungen");
    let (s, v) = get(&app, &admin, &format!("{basis}?phase=offen")).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        ids(&v).into_iter().collect::<HashSet<_>>(),
        alle[3..].iter().copied().collect()
    );

    let (_, v) = get(&app, &admin, &format!("{basis}?phase=abgeschlossen")).await;
    assert_eq!(
        ids(&v),
        vec![alle[2], alle[1], alle[0]],
        "zuletzt erledigt oben"
    );

    let (_, v) = get(&app, &admin, &basis).await;
    assert_eq!(ids(&v).len(), 5, "ohne Phase wie bisher alles");
}

#[tokio::test]
async fn unbekannte_phase_ist_400_und_cursor_ohne_abgeschlossen_ist_422() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let basis = format!("/api/einsaetze/{e}/meldungen");

    let (s, _) = get(&app, &admin, &format!("{basis}?phase=alle")).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = get(&app, &admin, &format!("{basis}?phase=offen&limit=5")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = get(
        &app,
        &admin,
        &format!("{basis}?vor_id=3&vor_zeit=2026-10-01"),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = get(
        &app,
        &admin,
        &format!("{basis}?phase=abgeschlossen&vor_id=3"),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "halber Cursor");
}

#[tokio::test]
async fn erste_seite_hat_die_vorgabe_und_die_klemme_greift() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 105, "intern").await;
    erledigen(&pool, &alle, |i| {
        format!("2026-10-01 {:02}:{:02}:00", 10 + i / 60, i % 60)
    })
    .await;
    let basis = format!("/api/einsaetze/{e}/meldungen?phase=abgeschlossen");

    let (_, v) = get(&app, &admin, &basis).await;
    let seite = ids(&v);
    assert_eq!(seite.len(), 100, "Vorgabe 100");
    assert_eq!(seite[0], alle[104], "zuletzt erledigt zuerst");

    let (_, v) = get(&app, &admin, &format!("{basis}&limit=5000")).await;
    assert_eq!(ids(&v).len(), 105, "geklemmt auf 500, hier alle");
    let (_, v) = get(&app, &admin, &format!("{basis}&limit=0")).await;
    assert_eq!(ids(&v).len(), 1, "geklemmt auf 1");
}

#[tokio::test]
async fn folgeseiten_ohne_duplikat_und_luecke_auch_bei_gleichstand() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 23, "intern").await;
    // Je vier Meldungen teilen denselben Zeitpunkt; die Seitengrenze fällt mitten hinein.
    erledigen(&pool, &alle, |i| format!("2026-10-01 10:{:02}:00", i / 4)).await;
    // Altbestand ohne Stempel: zählt mit seiner Ereigniszeit (09:00) ganz unten.
    sqlx::query("UPDATE meldung SET erledigt_at = NULL WHERE id = ?")
        .bind(alle[0])
        .execute(&pool)
        .await
        .unwrap();

    let basis = format!("/api/einsaetze/{e}/meldungen?phase=abgeschlossen&limit=5");
    let mut gesehen = Vec::new();
    let mut pfad = basis.clone();
    for _ in 0..10 {
        let (s, v) = get(&app, &admin, &pfad).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let seite = v.as_array().unwrap().clone();
        if seite.is_empty() {
            break;
        }
        for m in &seite {
            gesehen.push(m["id"].as_i64().unwrap());
        }
        let letzte = seite.last().unwrap();
        let zeit = letzte["erledigt_at"]
            .as_str()
            .or(letzte["ereigniszeit"].as_str())
            .unwrap()
            .replace(' ', "%20");
        pfad = format!("{basis}&vor_zeit={zeit}&vor_id={}", letzte["id"]);
    }
    assert_eq!(gesehen.len(), 23, "keine Lücke, kein Duplikat: {gesehen:?}");
    assert_eq!(gesehen.iter().collect::<HashSet<_>>().len(), 23);
    assert_eq!(*gesehen.last().unwrap(), alle[0], "Altbestand zuletzt");
}

#[tokio::test]
async fn richtung_gilt_in_jeder_phase() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let intern = anlegen(&app, &admin, e, 2, "intern").await;
    let extern_ = anlegen(&app, &admin, e, 2, "extern").await;
    erledigen(&pool, &[intern[0], extern_[0]], |i| {
        format!("2026-10-01 10:0{i}:00")
    })
    .await;

    let basis = format!("/api/einsaetze/{e}/meldungen");
    let (_, v) = get(
        &app,
        &admin,
        &format!("{basis}?phase=offen&richtung=extern"),
    )
    .await;
    assert_eq!(ids(&v), vec![extern_[1]]);
    let (_, v) = get(
        &app,
        &admin,
        &format!("{basis}?phase=abgeschlossen&richtung=extern"),
    )
    .await;
    assert_eq!(ids(&v), vec![extern_[0]]);
}

/// Die Kennzahlen sind die Auszählung der Vollliste mit demselben Richtungsfilter.
fn auszaehlen(liste: &Value) -> Value {
    let mut k = json!({"unbearbeitet": 0, "in_arbeit": 0, "alarmiert": 0, "erledigt": 0});
    for m in liste.as_array().unwrap() {
        let feld = if m["status"] == "erledigt" {
            "erledigt"
        } else if m["status"] == "neu" {
            "unbearbeitet"
        } else {
            "in_arbeit"
        };
        k[feld] = json!(k[feld].as_i64().unwrap() + 1);
        let alarmiert = m["bestaetigung_pflicht"] == true
            && m["ist_bestaetigt"] == false
            && (m["ist_ueberfaellig"] == true || m["eskaliert"] == true);
        if alarmiert {
            k["alarmiert"] = json!(k["alarmiert"].as_i64().unwrap() + 1);
        }
    }
    k
}

#[tokio::test]
async fn kennzahlen_gleichen_der_auszaehlung_der_liste() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let intern = anlegen(&app, &admin, e, 4, "intern").await;
    let extern_ = anlegen(&app, &admin, e, 3, "extern").await;
    let basis = format!("/api/einsaetze/{e}/meldungen");
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{basis}/{}/status", intern[1]),
        &admin,
        Some(r#"{"status":"gesichtet"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    erledigen(&pool, &[intern[2], extern_[0]], |i| {
        format!("2026-10-01 10:0{i}:00")
    })
    .await;
    // Alarmiert quer zur Phase: eine offene überfällige und eine erledigte eskalierte Pflicht.
    sqlx::query(
        "UPDATE meldung SET bestaetigung_pflicht = 1, bestaetigung_frist_at = '2026-01-01 00:00:00' \
         WHERE id = ?",
    )
    .bind(intern[3])
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE meldung SET bestaetigung_pflicht = 1, eskaliert = 1 WHERE id = ?")
        .bind(intern[2])
        .execute(&pool)
        .await
        .unwrap();

    for richtung in ["", "intern", "extern"] {
        let q = if richtung.is_empty() {
            String::new()
        } else {
            format!("?richtung={richtung}")
        };
        let (s, k) = get(&app, &admin, &format!("{basis}/kennzahlen{q}")).await;
        assert_eq!(s, StatusCode::OK, "{k}");
        let (_, liste) = get(&app, &admin, &format!("{basis}{q}")).await;
        assert_eq!(k, auszaehlen(&liste), "Richtung „{richtung}“");
    }
    let (_, k) = get(&app, &admin, &format!("{basis}/kennzahlen")).await;
    assert_eq!(
        k,
        json!({"unbearbeitet": 4, "in_arbeit": 1, "alarmiert": 2, "erledigt": 2})
    );
    let (s, _) = get(&app, &admin, &format!("{basis}/kennzahlen?richtung=quer")).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn einzelabruf_liefert_die_meldung_und_einsatzfremd_404() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let eigene = anlegen(&app, &admin, e, 1, "intern").await[0];
    let fremde = anlegen(&app, &admin, anderer, 1, "intern").await[0];

    let (s, v) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen/{eigene}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["id"], eigene);
    assert_eq!(v["inhalt"], "Meldung 0");

    let (s, _) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen/{fremde}"),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen/999999"),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn modulzaehler_zaehlt_weiter_den_gesamtbestand() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 105, "intern").await;
    erledigen(&pool, &alle[..2], |i| format!("2026-10-01 10:0{i}:00")).await;

    let (s, z) = get(&app, &admin, &format!("/api/einsaetze/{e}/modul-zaehler")).await;
    assert_eq!(s, StatusCode::OK, "{z}");
    assert_eq!(z["meldungen"]["offen"], 103, "{z}");
}
