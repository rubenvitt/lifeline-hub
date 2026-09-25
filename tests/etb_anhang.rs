//! LFH-117: Anhänge an ETB-Einträgen — Upload, Erfassen mit `anhang_ids`, Wire-Feld
//! `anhaenge` und Download über die ETB-Route.
//!
//! Eigene Datei statt `tests/etb.rs`: dessen `setup()` reicht den Pool nicht heraus, und
//! mehrere Fälle hier brauchen direkten DB-Zugriff (Bindung an Chat/Dokument, verbrauchte
//! Nummern, Verknüpfungszeilen).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use std::time::Duration;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool_und_live,
};

const ADMIN_PW: &str = "startpw12";

/// Lädt eine Datei über den ETB-Upload hoch; liefert (Status, JSON).
async fn etb_upload(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    dateiname: &str,
    daten: &[u8],
) -> (StatusCode, Value) {
    let boundary = "LFHETBBOUNDARY";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"datei\"; \
             filename=\"{dateiname}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(daten);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/etb/anhaenge"))
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

/// Lädt hoch und liefert die id der (einzigen) angelegten Datei.
async fn hochgeladen(app: &axum::Router, einsatz: i64, cookie: &str, name: &str) -> i64 {
    let (s, v) = etb_upload(app, einsatz, cookie, name, b"JPEGDATEN").await;
    assert_eq!(s, StatusCode::CREATED, "Upload {name}: {v}");
    v[0]["id"].as_i64().unwrap()
}

async fn erfassen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        Some(body),
    )
    .await
}

/// GET mit optionalem `If-None-Match`; liefert (Status, Header, Bytes).
async fn download(
    app: &axum::Router,
    pfad: &str,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method("GET")
        .uri(pfad)
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

fn anhang_ids(eintrag: &Value) -> Vec<i64> {
    eintrag["anhaenge"]
        .as_array()
        .expect("anhaenge ist eine Liste")
        .iter()
        .map(|a| a["id"].as_i64().unwrap())
        .collect()
}

async fn zaehle(pool: &sqlx::SqlitePool, sql: &'static str, id: i64) -> i64 {
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Beobachterin „erika" im Einsatz.
async fn beobachterin(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let id = benutzer_anlegen(app, admin, "erika", "keine").await;
    rolle_setzen(app, admin, einsatz, id, "beobachter").await;
    login_cookie(app, "erika", "erikapw1").await
}

/// Führungsperson „frieda" im Einsatz (schreibt, ist aber kein Admin).
async fn fuehrungsperson(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let id = benutzer_anlegen(app, admin, "frieda", "keine").await;
    rolle_setzen(app, admin, einsatz, id, "fuehrungspersonal").await;
    login_cookie(app, "frieda", "friedapw1").await
}

async fn etb_ausblenden(app: &axum::Router, admin: &str, einsatz: i64) {
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/etb"),
        admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

// ------------------------------- Upload -------------------------------

#[tokio::test]
async fn upload_nimmt_heic_an() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, v) = etb_upload(&app, einsatz, &admin, "IMG_0412.HEIC", b"heic").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v[0]["mime"], "image/heic");
    assert_eq!(v[0]["dateiname"], "IMG_0412.HEIC");
}

#[tokio::test]
async fn upload_weist_exe_ab() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, _) = etb_upload(&app, einsatz, &admin, "setup.exe", b"MZ").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(
        zaehle(
            &pool,
            "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?",
            einsatz
        )
        .await,
        0
    );
}

#[tokio::test]
async fn upload_beobachter_ist_403() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = beobachterin(&app, &admin, einsatz).await;

    let (s, _) = etb_upload(&app, einsatz, &erika, "a.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn upload_bei_gesperrtem_etb_ist_403() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frieda = fuehrungsperson(&app, &admin, einsatz).await;

    // Gegenprobe: vor dem Ausblenden darf sie hochladen.
    let (vorher, _) = etb_upload(&app, einsatz, &frieda, "a.jpg", b"x").await;
    assert_eq!(vorher, StatusCode::CREATED);
    etb_ausblenden(&app, &admin, einsatz).await;
    let (s, _) = etb_upload(&app, einsatz, &frieda, "a.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn upload_im_abgeschlossenen_einsatz_ist_409_wie_das_erfassen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "abschliessen: {s}");

    let (upload, _) = etb_upload(&app, einsatz, &admin, "a.jpg", b"x").await;
    let (erfassen_status, _) =
        erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"x"}"#).await;
    assert_eq!(erfassen_status, StatusCode::CONFLICT);
    assert_eq!(
        upload, erfassen_status,
        "Upload und Erfassen scheitern gleich"
    );
}

#[tokio::test]
async fn upload_ueber_zwei_mib_geht_durch() {
    // Beleg für das Body-Limit an der Route: ohne `DefaultBodyLimit` kappte axum bei 2 MiB.
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let gross = vec![0xFFu8; 3 * 1024 * 1024];
    let (s, v) = etb_upload(&app, einsatz, &admin, "scan.tiff", &gross).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v[0]["groesse"], 3 * 1024 * 1024);
}

// ------------------------------- Erfassen -------------------------------

#[tokio::test]
async fn erfassen_mit_zwei_anhaengen_traegt_beide() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = hochgeladen(&app, einsatz, &admin, "a.jpg").await;
    let b = hochgeladen(&app, einsatz, &admin, "b.jpg").await;

    let (s, v) = erfassen(
        &app,
        &admin,
        einsatz,
        &format!(r#"{{"typ":"meldung","inhalt":"Schadenstelle","anhang_ids":[{b},{a},{b}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(anhang_ids(&v), vec![a, b], "dedupliziert, aufsteigend");
    assert_eq!(v["anhaenge"][0]["dateiname"], "a.jpg");
    assert!(
        v["anhaenge"][0].get("daten").is_none(),
        "keine Bytes auf dem Wire"
    );

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    assert_eq!(anhang_ids(&liste[0]), vec![a, b]);
}

#[tokio::test]
async fn liste_traegt_den_schluessel_anhaenge_auch_leer() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"ohne"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    // Presence per `contains_key`: `v["anhaenge"] == Null` hielte einen FEHLENDEN Schlüssel
    // nicht von einem leeren auseinander.
    assert!(v.as_object().unwrap().contains_key("anhaenge"));
    assert_eq!(v["anhaenge"], serde_json::json!([]));

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let e = liste[0].as_object().unwrap();
    assert!(e.contains_key("anhaenge"));
    assert_eq!(e["anhaenge"], serde_json::json!([]));
}

#[tokio::test]
async fn fremder_anhang_ist_400_ohne_eintrag() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nachbar = einsatz_anlegen(&app, &admin).await;
    let fremd = hochgeladen(&app, nachbar, &admin, "fremd.jpg").await;

    let (s, v) = erfassen(
        &app,
        &admin,
        einsatz,
        &format!(r#"{{"typ":"meldung","inhalt":"x","anhang_ids":[{fremd}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(
        v["error"].as_str().unwrap().contains("Anhang"),
        "Wortlaut nennt den Anhang: {v}"
    );
    assert_eq!(
        zaehle(
            &pool,
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            einsatz
        )
        .await,
        0
    );
}

/// Testpaar 400 ↔ 422: dieselbe Datei ein zweites Mal genannt ist kein Feldfehler, sondern
/// ein Zustand — sie gehört schon einem Eintrag.
#[tokio::test]
async fn gebundener_anhang_ist_422() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = hochgeladen(&app, einsatz, &admin, "a.jpg").await;
    let body = format!(r#"{{"typ":"meldung","inhalt":"x","anhang_ids":[{a}]}}"#);

    let (erst, _) = erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(erst, StatusCode::CREATED);
    let (zweit, _) = erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(zweit, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        zaehle(
            &pool,
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            einsatz
        )
        .await,
        1
    );
}

#[tokio::test]
async fn leerer_inhalt_mit_anhang_ist_400() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = hochgeladen(&app, einsatz, &admin, "a.jpg").await;

    let (s, _) = erfassen(
        &app,
        &admin,
        einsatz,
        &format!(r#"{{"typ":"meldung","inhalt":"  ","anhang_ids":[{a}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn elf_anhaenge_sind_400_elf_doppelte_nicht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let elf: Vec<String> = (1..=11).map(|i| i.to_string()).collect();
    let (s, v) = erfassen(
        &app,
        &admin,
        einsatz,
        &format!(
            r#"{{"typ":"meldung","inhalt":"x","anhang_ids":[{}]}}"#,
            elf.join(",")
        ),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(v["error"].as_str().unwrap().contains("10"), "{v}");

    // Gegenprobe: elfmal DIESELBE Datei ist eine.
    let a = hochgeladen(&app, einsatz, &admin, "a.jpg").await;
    let doppelt = vec![a.to_string(); 11].join(",");
    let (s, v) = erfassen(
        &app,
        &admin,
        einsatz,
        &format!(r#"{{"typ":"meldung","inhalt":"x","anhang_ids":[{doppelt}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(anhang_ids(&v), vec![a]);
}

#[tokio::test]
async fn berichtigung_traegt_eigenen_anhang_grundeintrag_bleibt_ohne() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, grund) = erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Grund"}"#,
    )
    .await;
    let gid = grund["id"].as_i64().unwrap();
    let a = hochgeladen(&app, einsatz, &admin, "richtig.jpg").await;

    let (s, v) = erfassen(
        &app,
        &admin,
        einsatz,
        &format!(
            r#"{{"typ":"berichtigung","inhalt":"Richtig ist …","berichtigt_eintrag_id":{gid},"anhang_ids":[{a}]}}"#
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(anhang_ids(&v), vec![a]);

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let grund_neu = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == gid)
        .unwrap();
    assert_eq!(grund_neu["anhaenge"], serde_json::json!([]));
}

#[tokio::test]
async fn replay_nach_commit_liefert_bestand_samt_anhaengen_und_ein_live_ereignis() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = hochgeladen(&app, einsatz, &admin, "a.jpg").await;
    let mut rx = live.abonniere(einsatz);
    let body =
        format!(r#"{{"typ":"meldung","inhalt":"Foto","client_id":"cid-117","anhang_ids":[{a}]}}"#);

    let (s1, v1) = erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(s1, StatusCode::CREATED);
    let (s2, v2) = erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(
        s2,
        StatusCode::CREATED,
        "Replay ist kein 422, obwohl `a` gebunden ist"
    );
    assert_eq!(v1["id"], v2["id"]);
    assert_eq!(anhang_ids(&v2), vec![a]);

    let erstes = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .expect("ein Live-Ereignis")
        .expect("Kanal liefert");
    assert_eq!(erstes.event.as_str(), "etb");
    assert!(
        matches!(
            rx.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ),
        "genau ein etb-Ereignis"
    );
}

// ------------------------------- Download -------------------------------

/// Einsatz mit einem Eintrag samt Anhang; liefert (einsatz, eintrag_id, anhang_id).
async fn eintrag_mit_foto(app: &axum::Router, admin: &str) -> (i64, i64, i64) {
    let einsatz = einsatz_anlegen(app, admin).await;
    let (s, v) = etb_upload(app, einsatz, admin, "Lagefoto Süd.jpg", b"JPEGDATEN").await;
    assert_eq!(s, StatusCode::CREATED);
    let aid = v[0]["id"].as_i64().unwrap();
    let (s, e) = erfassen(
        app,
        admin,
        einsatz,
        &format!(r#"{{"typ":"meldung","inhalt":"Foto","anhang_ids":[{aid}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    (einsatz, e["id"].as_i64().unwrap(), aid)
}

fn pfad(einsatz: i64, eintrag: i64, anhang: i64) -> String {
    format!("/api/einsaetze/{einsatz}/etb/{eintrag}/anhaenge/{anhang}")
}

#[tokio::test]
async fn beobachter_laedt_den_anhang() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let (einsatz, eintrag, aid) = eintrag_mit_foto(&app, &admin).await;
    let erika = beobachterin(&app, &admin, einsatz).await;

    let (s, h, bytes) = download(&app, &pfad(einsatz, eintrag, aid), &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, b"JPEGDATEN");
    assert_eq!(h[header::CONTENT_TYPE], "image/jpeg");
    let cd = h[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(cd.contains("attachment"), "{cd}");
    assert!(cd.contains("Lagefoto%20S%C3%BCd.jpg"), "{cd}");
}

#[tokio::test]
async fn download_mit_passendem_etag_ist_304() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let (einsatz, eintrag, aid) = eintrag_mit_foto(&app, &admin).await;

    let (_, h, _) = download(&app, &pfad(einsatz, eintrag, aid), &admin, None).await;
    let etag = h[header::ETAG].to_str().unwrap().to_string();
    let (s, _, bytes) = download(&app, &pfad(einsatz, eintrag, aid), &admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty());
}

#[tokio::test]
async fn download_ueber_fremden_einsatz_ist_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let (_a, eintrag, aid) = eintrag_mit_foto(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;

    let (s, _, _) = download(&app, &pfad(b, eintrag, aid), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn download_an_falschem_eintrag_ist_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let (einsatz, eintrag, aid) = eintrag_mit_foto(&app, &admin).await;
    let (_, anderer) = erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"ohne"}"#,
    )
    .await;
    let anderer = anderer["id"].as_i64().unwrap();

    let (s, _, _) = download(&app, &pfad(einsatz, anderer, aid), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Gegenprobe: am richtigen Eintrag geht es.
    let (s, _, _) = download(&app, &pfad(einsatz, eintrag, aid), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn download_bei_gesperrtem_etb_ist_403() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let (einsatz, eintrag, aid) = eintrag_mit_foto(&app, &admin).await;
    let frieda = fuehrungsperson(&app, &admin, einsatz).await;
    let (vorher, _, _) = download(&app, &pfad(einsatz, eintrag, aid), &frieda, None).await;
    assert_eq!(vorher, StatusCode::OK);

    etb_ausblenden(&app, &admin, einsatz).await;
    let (s, _, _) = download(&app, &pfad(einsatz, eintrag, aid), &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn download_unbekannter_ids_ist_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let (einsatz, eintrag, aid) = eintrag_mit_foto(&app, &admin).await;

    for p in [
        pfad(einsatz, eintrag, 999_999),
        pfad(einsatz, 999_999, aid),
        pfad(999_999, eintrag, aid),
    ] {
        let (s, _, _) = download(&app, &p, &admin, None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{p}");
    }
}

#[tokio::test]
async fn freier_anhang_ist_ueber_die_etb_route_nicht_ladbar() {
    // Hochgeladen, aber nie erfasst: er hängt an keinem Eintrag, die Bindungsabfrage trifft
    // nichts — auch nicht über einen fremden Eintrag desselben Einsatzes.
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let (einsatz, eintrag, _aid) = eintrag_mit_foto(&app, &admin).await;
    let frei = hochgeladen(&app, einsatz, &admin, "frei.jpg").await;

    let (s, _, _) = download(&app, &pfad(einsatz, eintrag, frei), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
