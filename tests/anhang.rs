use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup, setup_mit_pool,
};

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

/// Sendet eine Nachricht (optional mit Anhängen) im Kanal und liefert deren id.
async fn nachricht_senden(
    app: &axum::Router,
    einsatz: i64,
    kid: i64,
    cookie: &str,
    anhang_ids: &[i64],
) -> i64 {
    let ids = anhang_ids
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let (s, m) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        cookie,
        Some(&format!(r#"{{"inhalt":"m","anhang_ids":[{ids}]}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "nachricht_senden: {m:?}");
    m["id"].as_i64().unwrap()
}

/// Soft-löscht eine Nachricht.
async fn nachricht_loeschen(app: &axum::Router, einsatz: i64, mid: i64, cookie: &str) {
    let (s, _) = anfrage(
        app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}"),
        cookie,
        None,
    )
    .await;
    assert!(s.is_success(), "nachricht_loeschen: {s}");
}

/// LFH-116: Nach Soft-Löschen der einzigen verknüpfenden Nachricht ist der
/// Anhang-Download gesperrt (404) — auch per Direkt-Deeplink am Frontend vorbei.
#[tokio::test]
async fn download_geloeschter_nachricht_gesperrt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (_, up) = upload(
        &app,
        einsatz,
        &admin,
        "geheim.pdf",
        "application/pdf",
        b"streng geheim",
    )
    .await;
    let aid = up.as_array().unwrap()[0]["id"].as_i64().unwrap();
    let mid = nachricht_senden(&app, einsatz, kid, &admin, &[aid]).await;

    let (s_vor, _, _) = download(&app, einsatz, aid, &admin).await;
    assert_eq!(s_vor, StatusCode::OK, "vor dem Löschen ladbar");

    nachricht_loeschen(&app, einsatz, mid, &admin).await;

    let (s_nach, _, _) = download(&app, einsatz, aid, &admin).await;
    assert_eq!(
        s_nach,
        StatusCode::NOT_FOUND,
        "Download gesperrt nach Soft-Löschen (LFH-116)"
    );
}

/// LFH-116: Ein verwaister Anhang (nie an eine Nachricht gehängt) bleibt ladbar —
/// Regressionswächter gegen Falsch-Sperre.
#[tokio::test]
async fn download_verwaister_anhang_bleibt_ladbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (_, up) = upload(
        &app,
        einsatz,
        &admin,
        "entwurf.pdf",
        "application/pdf",
        b"noch nicht gesendet",
    )
    .await;
    let aid = up.as_array().unwrap()[0]["id"].as_i64().unwrap();

    let (s, _, _) = download(&app, einsatz, aid, &admin).await;
    assert_eq!(s, StatusCode::OK, "verwaister Anhang bleibt ladbar");
}

/// LFH-116 (n:m): Hängt ein Anhang an zwei Nachrichten, bleibt er ladbar, solange
/// eine lebt; erst nach Löschen der LETZTEN verknüpfenden Nachricht → 404.
#[tokio::test]
async fn download_erst_nach_letzter_loeschung_gesperrt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    let (_, up) = upload(
        &app,
        einsatz,
        &admin,
        "geteilt.pdf",
        "application/pdf",
        b"an zwei nachrichten",
    )
    .await;
    let aid = up.as_array().unwrap()[0]["id"].as_i64().unwrap();
    let m1 = nachricht_senden(&app, einsatz, kid, &admin, &[aid]).await;
    let m2 = nachricht_senden(&app, einsatz, kid, &admin, &[aid]).await;

    nachricht_loeschen(&app, einsatz, m1, &admin).await;
    let (s_mitte, _, _) = download(&app, einsatz, aid, &admin).await;
    assert_eq!(
        s_mitte,
        StatusCode::OK,
        "noch eine lebende Nachricht → ladbar"
    );

    nachricht_loeschen(&app, einsatz, m2, &admin).await;
    let (s_ende, _, _) = download(&app, einsatz, aid, &admin).await;
    assert_eq!(
        s_ende,
        StatusCode::NOT_FOUND,
        "letzte verknüpfende Nachricht gelöscht → gesperrt"
    );
}

/// Löscht einen Anhang: (Status).
async fn delete_anhang(app: &axum::Router, einsatz: i64, aid: i64, cookie: &str) -> StatusCode {
    anfrage(
        app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/anhaenge/{aid}"),
        cookie,
        None,
    )
    .await
    .0
}

/// G06 (LFH-250): Einzel-Löschung eines Anhangs (Freigabepfad). Nach DELETE (204) ist
/// der Anhang weg → Download 404.
#[tokio::test]
async fn delete_entfernt_anhang() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (_, up) = upload(&app, einsatz, &admin, "weg.pdf", "application/pdf", b"weg").await;
    let aid = up[0]["id"].as_i64().unwrap();

    assert_eq!(
        delete_anhang(&app, einsatz, aid, &admin).await,
        StatusCode::NO_CONTENT
    );

    let (s, _, _) = download(&app, einsatz, aid, &admin).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "nach DELETE nicht mehr ladbar");
}

/// G06: DELETE über den falschen Einsatz-Pfad trifft nichts (Ownership) → 404; der
/// Anhang bleibt unter seinem echten Einsatz erhalten.
#[tokio::test]
async fn delete_fremder_einsatz_ist_notfound() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;

    let (_, up) = upload(&app, einsatz_b, &admin, "b.pdf", "application/pdf", b"B").await;
    let aid_b = up[0]["id"].as_i64().unwrap();

    assert_eq!(
        delete_anhang(&app, einsatz_a, aid_b, &admin).await,
        StatusCode::NOT_FOUND,
        "fremder Einsatz-Pfad trifft den Anhang nicht"
    );
    // Unter dem echten Einsatz weiterhin ladbar.
    let (s, _, _) = download(&app, einsatz_b, aid_b, &admin).await;
    assert_eq!(s, StatusCode::OK, "Anhang bleibt unter B erhalten");
}

/// G06: Beobachter (ohne Schreibrecht) darf nicht löschen → 403.
#[tokio::test]
async fn beobachter_darf_nicht_loeschen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (_, up) = upload(&app, einsatz, &admin, "x.pdf", "application/pdf", b"x").await;
    let aid = up[0]["id"].as_i64().unwrap();

    let beo = benutzer_anlegen(&app, &admin, "beata", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let bea = login_cookie(&app, "beata", "beatapw1").await;

    assert_eq!(
        delete_anhang(&app, einsatz, aid, &bea).await,
        StatusCode::FORBIDDEN,
        "Beobachter ohne Schreibrecht → 403"
    );
}

/// G06: Der Orphan-Sweep (LFH-250) verschont Anhänge, die an eine Nachricht gebunden
/// sind, und löscht nur die verwaisten (hochgeladen-nicht-gesendet) jenseits der Karenz.
/// Deckt die `NOT EXISTS`-Spare-Path über den echten Chat-Linker ab.
#[tokio::test]
async fn sweep_verschont_gebundene_anhaenge() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;

    // X wird an eine Nachricht gehängt (gebunden), Y bleibt verwaist.
    let (_, x) = upload(
        &app,
        einsatz,
        &admin,
        "gebunden.pdf",
        "application/pdf",
        b"X",
    )
    .await;
    let xid = x[0]["id"].as_i64().unwrap();
    nachricht_senden(&app, einsatz, kid, &admin, &[xid]).await;

    let (_, y) = upload(
        &app,
        einsatz,
        &admin,
        "verwaist.pdf",
        "application/pdf",
        b"Y",
    )
    .await;
    let yid = y[0]["id"].as_i64().unwrap();

    // jetzt weit in der Zukunft → beide älter als die Karenz; nur der verwaiste fällt.
    let jetzt = chrono::DateTime::parse_from_rfc3339("2099-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let geloescht = lifeline_hub::anhang::repo::sweep_verwaiste(&pool, jetzt)
        .await
        .unwrap();
    assert_eq!(geloescht, 1, "nur der verwaiste Anhang wird gelöscht");

    let (sx, _, _) = download(&app, einsatz, xid, &admin).await;
    assert_eq!(sx, StatusCode::OK, "gebundener Anhang verschont");
    let (sy, _, _) = download(&app, einsatz, yid, &admin).await;
    assert_eq!(sy, StatusCode::NOT_FOUND, "verwaister Anhang gelöscht");
}

/// Download mit optionalem `If-None-Match`: (Status, Header, Bytes).
async fn download_inm(
    app: &axum::Router,
    einsatz: i64,
    aid: i64,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method("GET")
        .uri(format!("/api/einsaetze/{einsatz}/anhaenge/{aid}"))
        .header(header::COOKIE, cookie);
    if let Some(etag) = if_none_match {
        req = req.header(header::IF_NONE_MATCH, etag);
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
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

/// G04 (LFH-258): Der Download trägt einen starken ETag (sha256) und `Cache-Control`
/// (private, immutable) — inhaltsadressiert, Bytes je id unveränderlich.
#[tokio::test]
async fn download_setzt_etag_und_cache_control() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, up) = upload(&app, einsatz, &admin, "c.pdf", "application/pdf", b"cache").await;
    let aid = up[0]["id"].as_i64().unwrap();

    let (s, headers, _) = download(&app, einsatz, aid, &admin).await;
    assert_eq!(s, StatusCode::OK);
    let etag = headers
        .get(header::ETAG)
        .expect("ETag gesetzt")
        .to_str()
        .unwrap();
    assert!(
        etag.starts_with('"') && etag.ends_with('"'),
        "starker ETag (quoted): {etag}"
    );
    assert_eq!(
        etag.trim_matches('"').len(),
        64,
        "sha256-Hex als ETag: {etag}"
    );
    let cc = headers
        .get(header::CACHE_CONTROL)
        .expect("Cache-Control gesetzt")
        .to_str()
        .unwrap();
    assert!(cc.contains("private"), "private (auth-gated): {cc}");
    assert!(cc.contains("immutable"), "immutable: {cc}");
}

/// G04: `If-None-Match` mit passendem ETag → 304 ohne Body (BLOB wird nicht gelesen);
/// mit unpassendem ETag → 200 mit vollem Body.
#[tokio::test]
async fn download_if_none_match_liefert_304() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, up) = upload(&app, einsatz, &admin, "c.pdf", "application/pdf", b"cache").await;
    let aid = up[0]["id"].as_i64().unwrap();

    let (_, headers, _) = download(&app, einsatz, aid, &admin).await;
    let etag = headers
        .get(header::ETAG)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    // Passender ETag → 304, leerer Body.
    let (s304, _, body304) = download_inm(&app, einsatz, aid, &admin, Some(&etag)).await;
    assert_eq!(s304, StatusCode::NOT_MODIFIED, "passender ETag → 304");
    assert!(body304.is_empty(), "304 ohne Body");

    // Unpassender ETag → 200 mit vollem Body.
    let (s200, _, body200) = download_inm(&app, einsatz, aid, &admin, Some("\"deadbeef\"")).await;
    assert_eq!(s200, StatusCode::OK, "unpassender ETag → 200");
    assert_eq!(body200, b"cache", "voller Body bei 200");
}

/// G04 (Defense-in-Depth): Der 304-Kurzschluss darf die Zugriffs-Guards NICHT umgehen.
/// Ein passender ETag über den FREMDEN Einsatz-Pfad muss am Ownership-Guard scheitern
/// (404), nicht 304 liefern — pinnt die Reihenfolge „Guard vor 304" gegen ein künftiges
/// Umsortieren (der Meta-/ETag-Read + 304 sitzen bewusst HINTER Ownership-/Tombstone-Guard).
#[tokio::test]
async fn download_304_umgeht_ownership_guard_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;

    let (_, up) = upload(&app, einsatz_b, &admin, "b.pdf", "application/pdf", b"B").await;
    let aid_b = up[0]["id"].as_i64().unwrap();

    // Gültigen ETag über den KORREKTEN Pfad holen.
    let (_, headers, _) = download(&app, einsatz_b, aid_b, &admin).await;
    let etag = headers
        .get(header::ETAG)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();

    // Passender ETag, aber über den fremden Einsatz-Pfad → 404 (Guard), NICHT 304.
    let (s, _, _) = download_inm(&app, einsatz_a, aid_b, &admin, Some(&etag)).await;
    assert_eq!(
        s,
        StatusCode::NOT_FOUND,
        "Ownership-Guard vor 304 — kein 304-Bypass des Zugriffsschutzes"
    );
}
