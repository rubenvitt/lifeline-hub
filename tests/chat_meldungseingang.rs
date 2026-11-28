//! Chat-Heraufstufung „Meldung“/„Lage“ legt den Vorgang im Meldungseingang an (y3zh5ymv D8, Spec
//! `meldungseingang`, „Chat-Heraufstufung von Meldung und Lage …“): mit `in_meldungseingang: true`
//! entstehen Eintrag und Meldung in EINER Transaktion, beidseitig verlinkt, ohne zweiten
//! ETB-Eintrag; ohne Feld wird nur protokolliert. Ohne Freigabe der Meldungen 403. Muster:
//! `tests/etb_meldungseingang.rs`.

use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

use crate::common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup, setup_mit_live,
    setup_mit_pool_und_live,
};

async fn lesen(app: &axum::Router, cookie: &str, pfad: &str) -> Vec<Value> {
    let (s, v) = anfrage(app, "GET", pfad, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v.as_array().unwrap().clone()
}

/// Sendet als `cookie` eine Nachricht in den Default-Kanal; liefert (Kanal-ID, Nachricht).
async fn nachricht(app: &axum::Router, einsatz: i64, cookie: &str, inhalt: &str) -> (i64, Value) {
    let kanaele = lesen(
        app,
        cookie,
        &format!("/api/incidents/{einsatz}/chat/channels"),
    )
    .await;
    let kid = kanaele[0]["id"].as_i64().unwrap();
    let (s, m) = anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/chat/channels/{kid}/messages"),
        cookie,
        Some(&format!(r#"{{"inhalt":"{inhalt}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    (kid, m)
}

async fn heraufstufen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    mid: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/chat/messages/{mid}/promote-to-etb"),
        cookie,
        Some(body),
    )
    .await
}

#[tokio::test]
async fn meldung_aus_dem_chat_legt_meldung_und_einen_eintrag_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Eine Person schreibt, eine ANDERE stuft herauf: nur so trennt der Test Absender und Erfasser.
    let frieda_id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, frieda_id, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (_, m) = nachricht(&app, e, &frieda, "Deich km12 instabil").await;
    let mid = m["id"].as_i64().unwrap();

    let (s, hoch) = heraufstufen(
        &app,
        &admin,
        e,
        mid,
        r#"{"typ":"meldung","inhalt":"Deich km 12 instabil, Sickerstelle","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{hoch}");
    let etb_id = hoch["etb_eintrag_id"].as_i64().unwrap();

    let etb = lesen(&app, &admin, &format!("/api/incidents/{e}/etb")).await;
    assert_eq!(
        etb.len(),
        1,
        "genau ein Eintrag, kein Auto-ETB der Meldung: {etb:?}"
    );
    let meldungen = lesen(&app, &admin, &format!("/api/incidents/{e}/reports")).await;
    assert_eq!(meldungen.len(), 1, "{meldungen:?}");
    let meldung = &meldungen[0];
    assert_eq!(meldung["meldungsart"], "sonstige");
    assert_eq!(
        meldung["absender"], m["autor_name"],
        "Absender ist, wer schrieb"
    );
    let (_, ich) = anfrage(&app, "GET", "/api/auth/me", &admin, None).await;
    assert_eq!(
        meldung["erfasst_von_id"], ich["id"],
        "erfasst hat, wer heraufstufte"
    );
    assert_ne!(meldung["erfasst_von_id"], frieda_id);
    assert_eq!(meldung["inhalt"], "Deich km 12 instabil, Sickerstelle");
    assert_eq!(meldung["meldeweg"], "sonstige");
    assert_eq!(meldung["status"], "neu");
    assert_eq!(meldung["prioritaet"], "normal");
    assert_eq!(meldung["ereigniszeit"], m["erstellt_at"]);
    assert_eq!(meldung["etb_meldung_id"], etb_id);
    assert_eq!(etb[0]["meldung_id"], meldung["id"]);
}

#[tokio::test]
async fn lage_aus_dem_chat_steht_in_den_lagemeldungen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = nachricht(&app, e, &admin, "Pegel steigt").await;

    let (s, v) = heraufstufen(
        &app,
        &admin,
        e,
        m["id"].as_i64().unwrap(),
        r#"{"typ":"lage","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let lage = lesen(
        &app,
        &admin,
        &format!("/api/incidents/{e}/situation/reports"),
    )
    .await;
    assert_eq!(lage.len(), 1, "{lage:?}");
    assert_eq!(lage[0]["meldungsart"], "lagemeldung");
}

#[tokio::test]
async fn ohne_feld_oder_mit_false_wird_nur_protokolliert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for body in [
        r#"{"typ":"meldung"}"#,
        r#"{"typ":"meldung","in_meldungseingang":false}"#,
    ] {
        let (_, m) = nachricht(&app, e, &admin, "Nur fürs Protokoll").await;
        let (s, v) = heraufstufen(&app, &admin, e, m["id"].as_i64().unwrap(), body).await;
        assert_eq!(s, StatusCode::OK, "{body}: {v}");
    }
    assert_eq!(
        lesen(&app, &admin, &format!("/api/incidents/{e}/etb"))
            .await
            .len(),
        2
    );
    assert!(lesen(&app, &admin, &format!("/api/incidents/{e}/reports"))
        .await
        .is_empty());
}

#[tokio::test]
async fn anordnung_mit_meldungseingang_ist_422_und_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = nachricht(&app, e, &admin, "Sandsäcke an km 12").await;
    let mid = m["id"].as_i64().unwrap();

    let (s, v) = heraufstufen(
        &app,
        &admin,
        e,
        mid,
        r#"{"typ":"anordnung","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(lesen(&app, &admin, &format!("/api/incidents/{e}/etb"))
        .await
        .is_empty());

    // Die Nachricht ist danach weiter heraufstufbar.
    let (s, v) = heraufstufen(&app, &admin, e, mid, r#"{"typ":"anordnung"}"#).await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

#[tokio::test]
async fn ohne_freigabe_der_meldungen_ist_403_und_nichts_entsteht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, id, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/incidents/{e}/module-overrides/meldungen"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (kid, m) = nachricht(&app, e, &frieda, "Deich km12 instabil").await;
    let mid = m["id"].as_i64().unwrap();

    let (s, _) = heraufstufen(
        &app,
        &frieda,
        e,
        mid,
        r#"{"typ":"meldung","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(lesen(&app, &admin, &format!("/api/incidents/{e}/etb"))
        .await
        .is_empty());
    assert!(lesen(&app, &admin, &format!("/api/incidents/{e}/reports"))
        .await
        .is_empty());
    let liste = lesen(
        &app,
        &admin,
        &format!("/api/incidents/{e}/chat/channels/{kid}/messages"),
    )
    .await;
    assert_eq!(liste[0]["etb_eintrag_id"], Value::Null, "kein Rückverweis");

    // Nur protokolliert geht es weiter: das ETB ist frei.
    let (s, v) = heraufstufen(&app, &frieda, e, mid, r#"{"typ":"meldung"}"#).await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

#[tokio::test]
async fn zweite_heraufstufung_ist_409_und_legt_keine_zweite_meldung_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = nachricht(&app, e, &admin, "Deich km12 instabil").await;
    let mid = m["id"].as_i64().unwrap();
    let body = r#"{"typ":"meldung","in_meldungseingang":true}"#;

    let (s, _) = heraufstufen(&app, &admin, e, mid, body).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = heraufstufen(&app, &admin, e, mid, body).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        lesen(&app, &admin, &format!("/api/incidents/{e}/reports"))
            .await
            .len(),
        1
    );
}

#[tokio::test]
async fn live_ereignisse_wie_eine_erfasste_meldung() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = nachricht(&app, e, &admin, "Deich km12 instabil").await;
    let mut rx = live.abonniere(e);

    let (s, v) = heraufstufen(
        &app,
        &admin,
        e,
        m["id"].as_i64().unwrap(),
        r#"{"typ":"meldung","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut tags = Vec::new();
    while let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        tags.push(n.event.as_str().to_string());
    }
    assert_eq!(tags.iter().filter(|t| *t == "etb").count(), 1, "{tags:?}");
    assert!(tags.iter().any(|t| t == "meldung"), "{tags:?}");
    assert!(tags.iter().any(|t| t == "chat"), "{tags:?}");
}

/// Review vor dem PR: Scheitert die Live-Zustellung nach dem Commit (etwa SQLITE_BUSY), bleibt die
/// Meldung ohne `live_published_at`. Ein zweiter Versuch endet am 409-Guard; er MUSS die Zustellung
/// nachholen, sonst gehen Live-Ereignisse und Hinweis für immer verloren (Spec `meldungseingang`,
/// „Die Meldung aus dem Chat übernimmt die Angaben der Nachricht“, Live wie eine erfasste).
#[tokio::test]
async fn zweiter_versuch_holt_eine_verlorene_zustellung_nach() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = nachricht(&app, e, &admin, "Deich km12 instabil").await;
    let mid = m["id"].as_i64().unwrap();
    let body = r#"{"typ":"meldung","in_meldungseingang":true}"#;
    let (s, _) = heraufstufen(&app, &admin, e, mid, body).await;
    assert_eq!(s, StatusCode::OK);
    // Die Zustellung gilt als gescheitert: der Marker steht wieder auf NULL.
    sqlx::query("UPDATE meldung SET live_published_at = NULL WHERE einsatz_id = ?")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    let mut rx = live.abonniere(e);

    let (s, _) = heraufstufen(&app, &admin, e, mid, body).await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "die Nachricht bleibt heraufgestuft"
    );

    let offen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM meldung WHERE einsatz_id = ? AND live_published_at IS NULL",
    )
    .bind(e)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(offen, 0, "die Zustellung ist nachgeholt");
    let mut tags = Vec::new();
    while let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        tags.push(n.event.as_str().to_string());
    }
    assert!(tags.iter().any(|t| t == "meldung"), "{tags:?}");
    assert_eq!(
        lesen(&app, &admin, &format!("/api/incidents/{e}/reports"))
            .await
            .len(),
        1
    );
}

/// Eine bereits zugestellte Meldung wird beim zweiten Versuch nicht noch einmal gemeldet.
#[tokio::test]
async fn zweiter_versuch_meldet_eine_zugestellte_meldung_nicht_noch_einmal() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = nachricht(&app, e, &admin, "Deich km12 instabil").await;
    let mid = m["id"].as_i64().unwrap();
    let body = r#"{"typ":"meldung","in_meldungseingang":true}"#;
    let (s, _) = heraufstufen(&app, &admin, e, mid, body).await;
    assert_eq!(s, StatusCode::OK);
    let mut rx = live.abonniere(e);

    let (s, _) = heraufstufen(&app, &admin, e, mid, body).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(
        matches!(
            rx.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ),
        "nichts zweimal publiziert"
    );
}
