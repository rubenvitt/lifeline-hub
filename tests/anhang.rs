use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

async fn default_kanal(app: &axum::Router, einsatz: i64, cookie: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json.as_array().unwrap()[0]["id"].as_i64().unwrap()
}

/// Lädt eine Datei per multipart/form-data hoch und gibt (Status, JSON) zurück.
async fn upload(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    dateiname: &str,
    content_type: &str,
    daten: &[u8],
) -> (StatusCode, Value) {
    let boundary = "LFHTESTBOUNDARY";
    let mut body = Vec::new();
    body.extend_from_slice(format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"{dateiname}\"\r\nContent-Type: {content_type}\r\n\r\n"
    ).as_bytes());
    body.extend_from_slice(daten);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/anhaenge"))
                .header(header::COOKIE, cookie)
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Lädt einen Anhang herunter: (Status, Header, Bytes).
async fn download(
    app: &axum::Router,
    einsatz: i64,
    anhang_id: i64,
    cookie: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{einsatz}/anhaenge/{anhang_id}"))
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, headers, bytes)
}

/// AK: Eine Nachricht kann optional einen Anhang tragen, der hoch- und wieder
/// herunterladbar ist. Voller Round-Trip.
#[tokio::test]
async fn anhang_roundtrip_hoch_und_runterladen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let inhalt = b"%PDF-1.4 Lagekarte";
    let (s, up) = upload(&app, einsatz, &admin, "lage.pdf", "application/pdf", inhalt).await;
    assert_eq!(s, StatusCode::CREATED);
    let anhang_id = up.as_array().unwrap()[0]["id"].as_i64().unwrap();
    assert_eq!(up[0]["mime"], "application/pdf");
    assert_eq!(up[0]["groesse"].as_i64().unwrap(), inhalt.len() as i64);

    // Nachricht mit Anhang senden.
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(&format!(
            r#"{{"inhalt":"siehe Anhang","anhang_ids":[{anhang_id}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(m["anhaenge"].as_array().unwrap().len(), 1);
    assert_eq!(m["anhaenge"][0]["dateiname"], "lage.pdf");

    // Liste zeigt den Anhang ebenfalls.
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        liste.as_array().unwrap()[0]["anhaenge"][0]["id"]
            .as_i64()
            .unwrap(),
        anhang_id
    );

    // Download liefert exakt die Bytes + korrekte Header.
    let (s, headers, bytes) = download(&app, einsatz, anhang_id, &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, inhalt);
    assert_eq!(
        headers.get(header::CONTENT_TYPE).unwrap(),
        "application/pdf"
    );
    assert!(headers
        .get(header::CONTENT_DISPOSITION)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("lage.pdf"));
}

/// Anhang-only-Nachricht (kein Text) ist zulässig.
#[tokio::test]
async fn anhang_only_nachricht_ohne_text() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (_, up) = upload(&app, einsatz, &admin, "foto.png", "image/png", b"PNGDATA").await;
    let aid = up[0]["id"].as_i64().unwrap();

    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(&format!(r#"{{"inhalt":"","anhang_ids":[{aid}]}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(m["anhaenge"].as_array().unwrap().len(), 1);
}

/// Weder Text noch Anhang → 400.
#[tokio::test]
async fn leere_nachricht_ohne_anhang_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(r#"{"inhalt":"   ","anhang_ids":[]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Fremder Anhang (anderer Einsatz) darf nicht verknüpft werden → 400, keine Nachricht.
#[tokio::test]
async fn fremder_anhang_kann_nicht_verknuepft_werden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let kid_a = default_kanal(&app, einsatz_a, &admin).await;

    let (_, up) = upload(
        &app,
        einsatz_b,
        &admin,
        "geheim.pdf",
        "application/pdf",
        b"B-Daten",
    )
    .await;
    let aid_b = up[0]["id"].as_i64().unwrap();

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz_a}/chat/kanaele/{kid_a}/nachrichten"),
        &admin,
        Some(&format!(r#"{{"inhalt":"x","anhang_ids":[{aid_b}]}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Keine Nachricht im Kanal A (Rollback).
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz_a}/chat/kanaele/{kid_a}/nachrichten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

/// Download eines fremden Anhangs über den falschen Einsatz-Pfad → 404 (Ownership-Guard).
#[tokio::test]
async fn download_fremder_einsatz_ist_notfound() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;

    let (_, up) = upload(&app, einsatz_b, &admin, "b.pdf", "application/pdf", b"B").await;
    let aid_b = up[0]["id"].as_i64().unwrap();

    let (s, _, _) = download(&app, einsatz_a, aid_b, &admin).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Unerlaubter Dateityp → 400.
#[tokio::test]
async fn unerlaubter_dateityp_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, _) = upload(
        &app,
        einsatz,
        &admin,
        "schad.exe",
        "application/octet-stream",
        b"MZ...",
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Leere Datei → 400.
#[tokio::test]
async fn leere_datei_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, _) = upload(&app, einsatz, &admin, "leer.pdf", "application/pdf", b"").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Beobachter darf nicht hochladen (Schreibrecht nötig) → 403.
#[tokio::test]
async fn beobachter_darf_nicht_hochladen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (s, _) = upload(&app, einsatz, &erika, "f.pdf", "application/pdf", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

/// Mehrere Anhänge (n:m) an einer Nachricht: beide werden verknüpft, gelistet
/// und sind einzeln herunterladbar.
#[tokio::test]
async fn mehrere_anhaenge_an_einer_nachricht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (_, a1) = upload(&app, einsatz, &admin, "eins.pdf", "application/pdf", b"AAA").await;
    let (_, a2) = upload(&app, einsatz, &admin, "zwei.png", "image/png", b"BBBB").await;
    let id1 = a1[0]["id"].as_i64().unwrap();
    let id2 = a2[0]["id"].as_i64().unwrap();

    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(&format!(
            r#"{{"inhalt":"zwei Dateien","anhang_ids":[{id1},{id2}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let anhaenge = m["anhaenge"].as_array().unwrap();
    assert_eq!(anhaenge.len(), 2);

    // Beide einzeln herunterladbar mit den richtigen Bytes.
    let (s1, _, b1) = download(&app, einsatz, id1, &admin).await;
    let (s2, _, b2) = download(&app, einsatz, id2, &admin).await;
    assert_eq!((s1, s2), (StatusCode::OK, StatusCode::OK));
    assert_eq!(b1, b"AAA");
    assert_eq!(b2, b"BBBB");
}

/// Eine im Request doppelt genannte anhang_id wird dedupliziert (genau eine
/// Verknüpfung, kein 500 durch PK-Verletzung).
#[tokio::test]
async fn doppelte_anhang_id_wird_dedupliziert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (_, up) = upload(
        &app,
        einsatz,
        &admin,
        "doppelt.pdf",
        "application/pdf",
        b"X",
    )
    .await;
    let aid = up[0]["id"].as_i64().unwrap();

    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(&format!(
            r#"{{"inhalt":"doppelt","anhang_ids":[{aid},{aid}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(
        m["anhaenge"].as_array().unwrap().len(),
        1,
        "dedupliziert auf einen Anhang"
    );
}

/// Eine Datei über der Maximalgröße wird am Endpoint abgelehnt (400), bevor sie
/// das Body-Limit (26 MiB) erreicht.
#[tokio::test]
async fn zu_grosse_datei_abgelehnt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // MAX_GROESSE = 25 MiB; einen Byte darüber → pruefe_groesse lehnt mit 400 ab.
    let zu_gross = vec![0u8; 25 * 1024 * 1024 + 1];
    let (s, _) = upload(
        &app,
        einsatz,
        &admin,
        "gross.pdf",
        "application/pdf",
        &zu_gross,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}
