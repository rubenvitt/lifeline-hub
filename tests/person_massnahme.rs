//! Maßnahmen am Patienten (LLH-1324, Change `y18v58dt-pat-kern`, Spec `personen-massnahmen`,
//! design.md D1/D5): fester Katalog mit Uhrzeit, Aufheben genau einmal (auch bei gleichzeitigen
//! Anfragen), kein ETB, das Live-Ereignis nennt nur Einsatz und Person.

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, fremde_org_anlegen, login_cookie, person_anlegen,
    rolle_setzen, setup_mit_optionen_auf, setup_mit_pool, setup_mit_pool_und_live,
    system_etb_inhalte,
};

fn zeit(versatz_sek: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(versatz_sek))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage(app, "POST", pfad, cookie, Some(&body.to_string())).await
}

fn pfad(e: i64, p: i64) -> String {
    format!("/api/einsaetze/{e}/personen/{p}/massnahmen")
}

fn aufheben_pfad(e: i64, p: i64, m: &Value) -> String {
    format!("{}/{}/aufheben", pfad(e, p), m["id"])
}

async fn detail(app: &axum::Router, cookie: &str, e: i64, p: i64) -> Value {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

#[tokio::test]
async fn massnahme_mit_uhrzeit_und_ohne() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    sqlx::query("UPDATE einsatz_person SET erfasst_at = ? WHERE id = ?")
        .bind(zeit(-3600))
        .bind(p)
        .execute(&pool)
        .await
        .unwrap();
    let um = zeit(-1500);
    let (s, tq) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"art": "blutstillung", "zeitpunkt_at": um}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{tq}");
    assert_eq!(tq["art"], "blutstillung");
    assert_eq!(
        tq["zeitpunkt_at"],
        um.as_str(),
        "die Uhrzeit der Durchführung"
    );
    assert!(tq["erfasst_at"].as_str().unwrap() > um.as_str(), "{tq}");
    assert!(tq["erfasst_von"].is_i64());
    assert!(tq.get("aufgehoben_at").is_none());

    let (s, o2) = post(&app, &admin, &pfad(e, p), json!({"art": "sauerstoff"})).await;
    assert_eq!(s, StatusCode::CREATED, "{o2}");
    assert_eq!(
        o2["zeitpunkt_at"], o2["erfasst_at"],
        "ohne Uhrzeit gilt die Erfassung"
    );

    let d = detail(&app, &admin, e, p).await;
    let arten: Vec<&str> = d["massnahmen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["art"].as_str().unwrap())
        .collect();
    assert_eq!(arten, ["sauerstoff", "blutstillung"], "jüngste zuerst");
}

#[tokio::test]
async fn katalog_400_storniert_409_vermisst_422() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    for body in [
        json!({"art": "tourniquet"}),
        json!({}),
        json!({"art": "zugang", "zeitpunkt_at": zeit(600)}),
    ] {
        let (s, v) = post(&app, &admin, &pfad(e, p), body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    assert!(detail(&app, &admin, e, p).await["massnahmen"]
        .as_array()
        .unwrap()
        .is_empty());

    let storniert = person_anlegen(&app, &admin, e, "{}").await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{storniert}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, v) = post(&app, &admin, &pfad(e, storniert), json!({"art": "zugang"})).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");

    for status in ["vermisst", "abgemeldet"] {
        let p = person_anlegen(&app, &admin, e, "{}").await;
        let (s, _) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/personen/{p}/status"),
            &admin,
            Some(&json!({"status": status}).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let (s, v) = post(&app, &admin, &pfad(e, p), json!({"art": "zugang"})).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{status}: {v}");
    }
}

#[tokio::test]
async fn beobachter_darf_nicht_und_fremde_org_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (_, m) = post(&app, &admin, &pfad(e, p), json!({"art": "infusion"})).await;
    let beob = benutzer_anlegen(&app, &admin, "beobacht", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob = login_cookie(&app, "beobacht", "beobachtpw1").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    for cookie in [&beob, &fremd] {
        let (s, v) = post(&app, cookie, &pfad(e, p), json!({"art": "zugang"})).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
        let (s, v) = post(&app, cookie, &aufheben_pfad(e, p, &m), json!({})).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    }
    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["massnahmen"].as_array().unwrap().len(), 1);
    assert!(d["massnahmen"][0].get("aufgehoben_at").is_none());
}

#[tokio::test]
async fn aufheben_genau_einmal_und_nur_an_der_eigenen_person() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let andere = person_anlegen(&app, &admin, e, "{}").await;
    let (_, m) = post(&app, &admin, &pfad(e, p), json!({"art": "infusion"})).await;

    let (s, v) = post(&app, &admin, &aufheben_pfad(e, andere, &m), json!({})).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "an einer anderen Person: {v}");
    let (s, v) = post(
        &app,
        &admin,
        &format!("{}/999999/aufheben", pfad(e, p)),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");

    let (s, v) = post(&app, &admin, &aufheben_pfad(e, p, &m), json!({})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(
        v["aufgehoben_at"].is_string() && v["aufgehoben_von_id"].is_i64(),
        "{v}"
    );
    let (s, v2) = post(&app, &admin, &aufheben_pfad(e, p, &m), json!({})).await;
    assert_eq!(s, StatusCode::CONFLICT, "zweites Aufheben: {v2}");

    let d = detail(&app, &admin, e, p).await;
    assert_eq!(
        d["massnahmen"][0]["aufgehoben_at"], v["aufgehoben_at"],
        "das Detail liefert die aufgehobene Maßnahme als solche"
    );
    assert!(
        system_etb_inhalte(&app, &admin, e)
            .await
            .iter()
            .all(|i| !i.contains("Maßnahme") && !i.contains("infusion")),
        "kein ETB"
    );
}

/// Zwei Arbeitsplätze heben dieselbe Maßnahme gleichzeitig auf (Datei-Pool mit WAL und mehreren
/// Verbindungen): genau eine gelingt, die andere ist 409.
#[tokio::test]
async fn gleichzeitiges_aufheben_gelingt_genau_einmal() {
    let (_dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, _pool, _live) =
        setup_mit_optionen_auf(pool, lifeline_hub::app::RouterOptionen::default()).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    for _ in 0..5 {
        let (_, m) = post(&app, &admin, &pfad(e, p), json!({"art": "analgesie"})).await;
        let ziel = aufheben_pfad(e, p, &m);
        let ((s1, v1), (s2, v2)) = tokio::join!(
            post(&app, &admin, &ziel, json!({})),
            post(&app, &admin, &ziel, json!({}))
        );
        let mut status = [s1, s2];
        status.sort();
        assert_eq!(status, [StatusCode::OK, StatusCode::CONFLICT], "{v1} {v2}");
    }
}

/// Das Rennen deterministisch: eine andere Verbindung hat die Maßnahme schon aufgehoben, aber noch
/// nicht festgeschrieben. Die Anfrage wartet an der Schreibsperre und trifft danach im bedingten
/// UPDATE keine Zeile mehr (409), statt auf einen vorab gelesenen Stand zu vertrauen.
#[tokio::test]
async fn aufheben_hinter_der_schreibsperre_ist_409() {
    let (_dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, pool, _live) =
        setup_mit_optionen_auf(pool, lifeline_hub::app::RouterOptionen::default()).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (_, m) = post(&app, &admin, &pfad(e, p), json!({"art": "zugang"})).await;

    let mut gewinner = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    sqlx::query(
        "UPDATE person_massnahme SET aufgehoben_at = '2026-10-18 10:00:00', \
            aufgehoben_von_id = erfasst_von WHERE id = ?",
    )
    .bind(m["id"].as_i64().unwrap())
    .execute(&mut *gewinner)
    .await
    .unwrap();
    let ziel = aufheben_pfad(e, p, &m);
    let anfrage = post(&app, &admin, &ziel, json!({}));
    tokio::pin!(anfrage);
    assert!(
        tokio::time::timeout(Duration::from_millis(500), &mut anfrage)
            .await
            .is_err(),
        "die Anfrage wartet an der Schreibsperre"
    );
    gewinner.commit().await.unwrap();
    let (s, v) = anfrage.await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
}

#[tokio::test]
async fn leak_probe_weder_etb_noch_live_kanal_nennt_die_massnahme() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let etb_vorher = system_etb_inhalte(&app, &admin, e).await;
    let mut rx = live.abonniere(e);
    let (s, m) = post(&app, &admin, &pfad(e, p), json!({"art": "analgesie"})).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = post(&app, &admin, &aufheben_pfad(e, p, &m), json!({})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        system_etb_inhalte(&app, &admin, e).await,
        etb_vorher,
        "kein ETB-Eintrag"
    );
    let mut personen = 0;
    while let Ok(n) = rx.try_recv() {
        assert!(!n.data.contains("analgesie"), "Live-Leak: {}", n.data);
        assert_ne!(n.event.as_str(), "etb", "kein ETB-Ereignis");
        if n.event.as_str() == "person" {
            let v: Value = serde_json::from_str(&n.data).unwrap();
            assert_eq!(
                v.as_object().unwrap().len(),
                2,
                "nur Einsatz und Person: {v}"
            );
            personen += 1;
        }
    }
    assert_eq!(personen, 2, "je ein Ereignis für Erfassen und Aufheben");
}

#[tokio::test]
async fn replay_derselben_client_id_legt_eine_massnahme_an() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let andere = person_anlegen(&app, &admin, e, "{}").await;
    let body = json!({"art": "immobilisation", "client_id": "m-1"});
    let (s1, v1) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    let (s2, v2) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    assert_eq!(
        (s1, s2),
        (StatusCode::CREATED, StatusCode::CREATED),
        "{v1} {v2}"
    );
    assert_eq!(v1["id"], v2["id"]);
    assert_eq!(
        detail(&app, &admin, e, p).await["massnahmen"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let (s, v) = post(&app, &admin, &pfad(e, andere), body.clone()).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, replay) = post(&app, &admin, &pfad(e, p), body).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "Replay vor dem Aktiv-Gate: {replay}"
    );
    assert_eq!(replay["id"], v1["id"]);
    let (s, _) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"art": "zugang", "client_id": "m-2"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = post(&app, &admin, &aufheben_pfad(e, p, &v1), json!({})).await;
    assert_eq!(s, StatusCode::CONFLICT, "abgeschlossen: kein Aufheben");
}
