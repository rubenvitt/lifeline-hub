//! Leichte Fälle in einem Schritt (LLH-1572, Change `o1igsr0s-leichte-faelle`): die Anlage nimmt
//! Maßnahmen und die Entlassung in derselben Transaktion mit (design.md D1), an der UHS mit
//! Eintritt und Austritt zur Erfassungszeit (D6) und mit EINEM ETB-Eintrag (D7).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup_mit_pool, system_etb_inhalte};

async fn anlegen(app: &axum::Router, cookie: &str, e: i64, body: Value) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        cookie,
        Some(&body.to_string()),
    )
    .await
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

/// Eine aktive UHS „UHS Bühne“.
async fn uhs_anlegen(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let (s, uhs) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/uhs"),
        cookie,
        Some(r#"{"typ":"behandlungsplatz","bezeichnung":"UHS Bühne"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{uhs}");
    let u = uhs["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/uhs/{u}/status"),
        cookie,
        Some(r#"{"status":"aktiv"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    u
}

/// Zeilen je Tabelle des leichten Falls: Personen, Maßnahmen, Verbleibe, Belegungen, ETB.
async fn zeilen(pool: &sqlx::SqlitePool) -> (i64, i64, i64, i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM einsatz_person), (SELECT COUNT(*) FROM person_massnahme), \
         (SELECT COUNT(*) FROM person_verbleib), (SELECT COUNT(*) FROM person_uhs_belegung), \
         (SELECT COUNT(*) FROM etb_eintrag)",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn leichter_fall_legt_person_massnahmen_und_entlassung_in_einem_schritt_an() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anlegen(
        &app,
        &admin,
        e,
        json!({
            "status": "betroffen",
            "anlass": "allergie",
            "massnahmen": ["kuehlung", "betreuung_gespraech"],
            "entlassen": true,
            "antreff_ort": "Bühne 2",
            "client_id": "lf-1",
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    // Die Antwort trägt schon den neuen Stand: entlassen und abgeschlossen, ohne Sichtung.
    assert_eq!(v["status"], "betroffen");
    assert_eq!(v["aktuelle_verbleib_art"], "entlassung");
    assert_eq!(v["versorgung"], "abgeschlossen");
    assert_eq!(v["anlass"], "allergie");
    assert!(v["aktuelle_sichtung"].is_null(), "{v}");
    assert!(
        v["registrier_nr"].as_i64().unwrap() > 0,
        "immer mit Registriernummer"
    );
    let p = v["id"].as_i64().unwrap();

    let d = detail(&app, &admin, e, p).await;
    let mut arten: Vec<&str> = d["massnahmen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["art"].as_str().unwrap())
        .collect();
    arten.sort_unstable();
    assert_eq!(arten, ["betreuung_gespraech", "kuehlung"]);
    for m in d["massnahmen"].as_array().unwrap() {
        assert_eq!(m["zeitpunkt_at"], v["erfasst_at"], "zur Erfassungszeit");
    }
    let verbleib = d["verbleib"].as_array().unwrap();
    assert_eq!(verbleib.len(), 1, "{d}");
    assert_eq!(verbleib[0]["art"], "entlassung");
    assert_eq!(verbleib[0]["zeitpunkt_at"], v["erfasst_at"]);

    // EIN ETB-Eintrag, pseudonym, ohne Anlass und Maßnahmen.
    let etb = system_etb_inhalte(&app, &admin, e).await;
    let reg = format!("R-{:03}", v["registrier_nr"].as_i64().unwrap());
    let zur_person: Vec<&String> = etb.iter().filter(|t| t.contains(&reg)).collect();
    assert_eq!(
        zur_person,
        [&format!("Person {reg} versorgt und entlassen")],
        "{etb:?}"
    );

    // Ein Replay derselben client_id legt nichts doppelt an.
    let vorher = zeilen(&pool).await;
    let (s, w) = anlegen(
        &app,
        &admin,
        e,
        json!({
            "status": "betroffen",
            "anlass": "allergie",
            "massnahmen": ["kuehlung", "betreuung_gespraech"],
            "entlassen": true,
            "client_id": "lf-1",
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{w}");
    assert_eq!(w["id"], v["id"]);
    assert_eq!(zeilen(&pool).await, vorher, "Replay schreibt nichts");
}

#[tokio::test]
async fn leichter_fall_an_der_uhs_tritt_zur_erfassungszeit_ein_und_aus() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let u = uhs_anlegen(&app, &admin, e).await;
    // Der Einsatz läuft seit einer Stunde: die vorgemerkte Erfassungszeit liegt in ihm.
    sqlx::query("UPDATE einsatz SET begonnen_at = datetime('now', '-1 hour') WHERE id = ?")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    let erfasst = (chrono::Utc::now() - chrono::Duration::minutes(20))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let (s, v) = anlegen(
        &app,
        &admin,
        e,
        json!({
            "status": "betroffen",
            "anlass": "hitze_kaelte",
            "massnahmen": ["lagerung"],
            "entlassen": true,
            "uhs_id": u,
            "zeitpunkt_at": erfasst,
            "client_id": "lf-uhs",
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert!(v["aktuelle_uhs_id"].is_null(), "ausgetreten: {v}");
    assert_eq!(v["versorgung"], "abgeschlossen");
    assert_eq!(v["erfasst_at"], erfasst.as_str());
    let p = v["id"].as_i64().unwrap();

    let bewegungen: Vec<(String, String)> = sqlx::query_as(
        "SELECT art, zeitpunkt_at FROM person_uhs_belegung WHERE person_id = ? ORDER BY id",
    )
    .bind(p)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        bewegungen,
        [
            ("eintritt".to_string(), erfasst.clone()),
            ("austritt".to_string(), erfasst.clone())
        ],
        "Eintritt und Austritt zur Erfassungszeit, nicht zur Übertragung"
    );

    let etb = system_etb_inhalte(&app, &admin, e).await;
    let reg = format!("R-{:03}", v["registrier_nr"].as_i64().unwrap());
    let zur_person: Vec<&String> = etb.iter().filter(|t| t.contains(&reg)).collect();
    assert_eq!(
        zur_person,
        [&format!(
            "Person {reg}: in UHS Bühne versorgt und entlassen"
        )],
        "EIN Eintrag statt Aufnahme, Entlassung und Austritt: {etb:?}"
    );
}

#[tokio::test]
async fn ohne_entlassen_gehen_massnahmen_mit_einer_normalen_anlage() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anlegen(&app, &admin, e, json!({"massnahmen": ["wundversorgung"]})).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert!(v["aktuelle_verbleib_art"].is_null(), "{v}");
    assert_eq!(v["status"], "erfasst");
    let p = v["id"].as_i64().unwrap();
    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["massnahmen"][0]["art"], "wundversorgung");
    let etb = system_etb_inhalte(&app, &admin, e).await;
    let reg = format!("R-{:03}", v["registrier_nr"].as_i64().unwrap());
    assert!(
        etb.contains(&format!("Person {reg} erfasst")),
        "der gewohnte Eintrag: {etb:?}"
    );
}

#[tokio::test]
async fn unbrauchbare_angaben_werden_abgewiesen_ohne_etwas_zu_schreiben() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let vorher = zeilen(&pool).await;
    for (body, erwartet) in [
        (
            json!({"massnahmen": ["tourniquet"], "entlassen": true}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"massnahmen": ["kuehlung", "kuehlung"], "entlassen": true}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"status": "vermisst", "entlassen": true}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({"status": "vermisst", "massnahmen": ["lagerung"]}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, v) = anlegen(&app, &admin, e, body.clone()).await;
        assert_eq!(s, erwartet, "{body}: {v}");
    }
    assert_eq!(zeilen(&pool).await, vorher);
}

#[tokio::test]
async fn entlassen_ohne_status_legt_betroffen_an() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for body in [
        json!({"anlass": "sonstiges", "entlassen": true}),
        json!({"status": "erfasst", "anlass": "sonstiges", "entlassen": true}),
    ] {
        let (s, v) = anlegen(&app, &admin, e, body.clone()).await;
        assert_eq!(s, StatusCode::CREATED, "{body}: {v}");
        assert_eq!(v["status"], "betroffen", "{body}: {v}");
        assert_eq!(v["aktuelle_verbleib_art"], "entlassung");
    }
}
