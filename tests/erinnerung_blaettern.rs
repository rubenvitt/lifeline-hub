//! Erinnerungen: ohne Parameter nur offene, Abgeschlossene seitenweise, Kennzahlen (LFH-940).

use axum::http::StatusCode;
use serde_json::Value;
use std::collections::HashSet;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup_mit_pool};

async fn anlegen(app: &axum::Router, cookie: &str, e: i64, n: usize) -> Vec<i64> {
    let mut ids = Vec::new();
    for i in 0..n {
        let (s, v) = anfrage(
            app,
            "POST",
            &format!("/api/einsaetze/{e}/erinnerungen"),
            cookie,
            Some(&format!(
                r#"{{"titel":"Erinnerung {i}","faellig_at":"2026-10-01 10:00"}}"#
            )),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        ids.push(v["id"].as_i64().unwrap());
    }
    ids
}

async fn erledigen(pool: &sqlx::SqlitePool, ids: &[i64], zeit: impl Fn(usize) -> String) {
    for (i, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE erinnerung SET status = 'erledigt', erledigt_at = ? WHERE id = ?")
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

#[tokio::test]
async fn ohne_parameter_nur_offene_ausdruecklich_alle() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 5).await;
    erledigen(&pool, &alle[..3], |i| format!("2026-10-01 11:0{i}:00")).await;
    let basis = format!("/api/einsaetze/{e}/erinnerungen");

    let (s, v) = anfrage(&app, "GET", &basis, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(ids(&v), alle[3..].to_vec(), "Vorgabe: nur offene");
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("{basis}?nur_offen=false"),
        &admin,
        None,
    )
    .await;
    assert_eq!(ids(&v).len(), 5, "ausdrücklich alle");
    let (_, v) = anfrage(&app, "GET", &format!("{basis}?phase=offen"), &admin, None).await;
    assert_eq!(ids(&v), alle[3..].to_vec());
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{basis}?phase=abgeschlossen&nur_offen=false"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (s, k) = anfrage(&app, "GET", &format!("{basis}/kennzahlen"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{k}");
    assert_eq!(k, serde_json::json!({"offen": 2, "abgeschlossen": 3}));
}

#[tokio::test]
async fn abgeschlossene_seitenweise_ohne_duplikat_und_luecke() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let alle = anlegen(&app, &admin, e, 13).await;
    erledigen(&pool, &alle, |i| format!("2026-10-01 11:{:02}:00", i / 3)).await;
    let basis = format!("/api/einsaetze/{e}/erinnerungen?phase=abgeschlossen&limit=4");

    let (_, v) = anfrage(&app, "GET", &basis, &admin, None).await;
    assert_eq!(ids(&v)[0], alle[12], "zuletzt erledigt zuerst");

    let mut gesehen = Vec::new();
    let mut pfad = basis.clone();
    for _ in 0..10 {
        let (s, v) = anfrage(&app, "GET", &pfad, &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let seite = v.as_array().unwrap().clone();
        if seite.is_empty() {
            break;
        }
        gesehen.extend(seite.iter().map(|m| m["id"].as_i64().unwrap()));
        let letzte = seite.last().unwrap();
        let zeit = letzte["erledigt_at"].as_str().unwrap().replace(' ', "%20");
        pfad = format!("{basis}&vor_zeit={zeit}&vor_id={}", letzte["id"]);
    }
    assert_eq!(gesehen.len(), 13, "{gesehen:?}");
    assert_eq!(gesehen.iter().collect::<HashSet<_>>().len(), 13);
}
