//! Integrationstests des UHS-Plans (LFH-999, Spec `uhs-plan`): Hochladen und Ersetzen, Formate,
//! Übernahme aus den Dateien der UHS mit genau einer Zeile im Lese-Audit, Anzeige ohne
//! Protokoll, ETB-Nachweis, Lage und Darstellung, Rechte, Storno und Live-Verteilung.
//!
//! Die Geräte (Tablet sieht, Laptop setzt) stehen in `tests/geraet_kopplung.rs`, der Scan im
//! eigenen Binary `tests/uhs_plan_scan.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

fn plan(einsatz: i64, uhs: i64) -> String {
    format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plan")
}

async fn uhs_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&format!(
            r#"{{"typ":"behandlungsplatz","bezeichnung":"{bez}"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "UHS anlegen: {v}");
    v["id"].as_i64().unwrap()
}

async fn start() -> (axum::Router, sqlx::SqlitePool, String, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "BHP 50").await;
    (app, pool, admin, einsatz, uhs)
}

async fn mitglied(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    name: &str,
    rolle: &str,
) -> String {
    let id = benutzer_anlegen(app, admin, name, "keine").await;
    rolle_setzen(app, admin, einsatz, id, rolle).await;
    login_cookie(app, name, &format!("{name}pw1")).await
}

async fn bild(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .uri(format!("{}/bild", plan(einsatz, uhs)))
        .header(header::COOKIE, cookie);
    if let Some(e) = if_none_match {
        req = req.header(header::IF_NONE_MATCH, e);
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

/// Legt einen UHS-Anhang ab und liefert die Linker-id.
async fn anhang_ablegen(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    cookie: &str,
    dateiname: &str,
    daten: &[u8],
) -> i64 {
    let b = "LFHANHANG";
    let mut body = format!(
        "--{b}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"{dateiname}\"\r\n\
         Content-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(daten);
    body.extend_from_slice(format!("\r\n--{b}--\r\n").as_bytes());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/uhs/{uhs}/anhaenge"))
                .header(header::COOKIE, cookie)
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={b}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "Anhang {dateiname}");
    let v: Value =
        serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
    v["id"].as_i64().unwrap()
}

async fn uebernehmen(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    cookie: &str,
    linker: i64,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("{}/aus-anhang", plan(einsatz, uhs)),
        cookie,
        Some(&format!(r#"{{"anhang_id":{linker}}}"#)),
    )
    .await
}

async fn zaehle(pool: &sqlx::SqlitePool, sql: &'static str, einsatz: i64) -> i64 {
    sqlx::query_scalar(sql)
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// (Pläne, ETB-Einträge, Audit-Zeilen) des Einsatzes.
async fn stand(pool: &sqlx::SqlitePool, einsatz: i64) -> (i64, i64, i64) {
    (
        zaehle(
            pool,
            "SELECT COUNT(*) FROM uhs_plan WHERE einsatz_id = ?",
            einsatz,
        )
        .await,
        zaehle(
            pool,
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            einsatz,
        )
        .await,
        zaehle(
            pool,
            "SELECT COUNT(*) FROM anhang_zugriff_audit WHERE einsatz_id = ?",
            einsatz,
        )
        .await,
    )
}

async fn etb_inhalte(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
        .bind(einsatz)
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn detail(app: &axum::Router, einsatz: i64, uhs: i64, cookie: &str) -> Value {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

// ------------------------------ Hochladen ------------------------------

#[tokio::test]
async fn hochladen_liefert_den_plan_und_steht_im_detail_und_im_etb() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    assert!(
        !detail(&app, einsatz, uhs, &admin)
            .await
            .as_object()
            .unwrap()
            .contains_key("plan"),
        "ohne Plan kein Schlüssel"
    );
    let (s, v) = plan_hochladen(
        &app,
        einsatz,
        uhs,
        &admin,
        "Halle_Familie_Mueller.png",
        &png_bytes(80, 60),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["mime"], "image/png");
    assert_eq!(
        (v["bild_breite"].as_i64(), v["bild_hoehe"].as_i64()),
        (Some(80), Some(60))
    );
    assert_eq!(
        (v["x"].as_i64(), v["y"].as_i64(), v["breite"].as_i64()),
        (Some(0), Some(0), Some(820))
    );
    assert_eq!(v["nacht_umkehren"], true);
    let d = detail(&app, einsatz, uhs, &admin).await;
    assert_eq!(d["plan"], v, "Detail trägt denselben Plan");

    let etb = etb_inhalte(&pool, einsatz).await;
    assert_eq!(etb.last().unwrap(), "UHS BHP 50: Plan hinterlegt");
    assert!(etb
        .iter()
        .all(|e| !e.contains("Mueller") && !e.contains(".png")));

    // Kein Anhang: die Dateien der UHS bleiben leer.
    let (_, l) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/anhaenge"),
        &admin,
        None,
    )
    .await;
    assert_eq!(l, Value::Array(vec![]));
}

#[tokio::test]
async fn ersetzen_haelt_einen_plan_und_die_lage() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(80, 60)).await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &plan(einsatz, uhs),
        &admin,
        Some(r#"{"x":40}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = plan_hochladen(
        &app,
        einsatz,
        uhs,
        &admin,
        "b.jpg",
        &bild_bytes(30, 30, image::ImageFormat::Jpeg),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        (v["mime"].as_str(), v["x"].as_i64()),
        (Some("image/jpeg"), Some(40))
    );
    assert_eq!(stand(&pool, einsatz).await.0, 1);
}

#[tokio::test]
async fn pdf_und_leere_datei_sind_400_ohne_spur() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let vorher = stand(&pool, einsatz).await;
    let (s, v) = plan_hochladen(&app, einsatz, uhs, &admin, "grundriss.pdf", b"%PDF-1.7").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(v["error"].as_str().unwrap().contains("PNG"), "{v}");
    let (s, _) = plan_hochladen(&app, einsatz, uhs, &admin, "leer.png", b"").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = plan_hochladen(&app, einsatz, uhs, &admin, "liste.xlsx", b"PK").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

// --------------------------- Anzeige ohne Protokoll ---------------------------

#[tokio::test]
async fn bild_ohne_protokoll_mit_etag_und_schutzkoepfen() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let (_, v) = plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(20, 10)).await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    let vorher = stand(&pool, einsatz).await;

    let mut etag = String::new();
    for cookie in [&admin, &erika, &frieda].iter().cycle().take(10) {
        let (s, h, bytes) = bild(&app, einsatz, uhs, cookie, None).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(h[header::CONTENT_TYPE], "image/png");
        assert!(h[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .starts_with("inline"));
        assert_eq!(h[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert!(h.contains_key(header::CONTENT_SECURITY_POLICY));
        assert!(bytes.starts_with(b"\x89PNG"));
        etag = h[header::ETAG].to_str().unwrap().to_string();
        assert!(etag.contains(v["sha256"].as_str().unwrap()));
    }
    let (s, _, bytes) = bild(&app, einsatz, uhs, &erika, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty());
    assert_eq!(stand(&pool, einsatz).await, vorher, "weder Audit noch ETB");
}

#[tokio::test]
async fn ohne_plan_ist_das_bild_404() {
    let (app, _pool, admin, einsatz, uhs) = start().await;
    assert_eq!(
        bild(&app, einsatz, uhs, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
}

// ------------------------- Übernahme aus den Dateien -------------------------

#[tokio::test]
async fn uebernahme_kopiert_mit_genau_einer_auditzeile() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let linker = anhang_ablegen(
        &app,
        einsatz,
        uhs,
        &admin,
        "grundriss_halle.png",
        &png_bytes(50, 40),
    )
    .await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    let (_, _, audit_vorher) = stand(&pool, einsatz).await;

    let (s, v) = uebernehmen(&app, einsatz, uhs, &frieda, linker).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        (v["bild_breite"].as_i64(), v["bild_hoehe"].as_i64()),
        (Some(50), Some(40))
    );
    let zeilen: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT z.ablage, b.benutzername, z.fassung FROM anhang_zugriff_audit z \
         JOIN benutzer b ON b.id = z.benutzer_id WHERE z.einsatz_id = ? ORDER BY z.id",
    )
    .bind(einsatz)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen.len() as i64, audit_vorher + 1);
    assert_eq!(
        zeilen.last().unwrap(),
        &("UHS BHP 50".into(), "frieda".into(), "bereinigt".into())
    );
    assert_eq!(
        etb_inhalte(&pool, einsatz).await.last().unwrap(),
        "UHS BHP 50: Plan hinterlegt"
    );

    // Anzeigen danach schreibt nichts mehr.
    for _ in 0..3 {
        assert_eq!(
            bild(&app, einsatz, uhs, &frieda, None).await.0,
            StatusCode::OK
        );
    }
    assert_eq!(stand(&pool, einsatz).await.2, audit_vorher + 1);

    // Anhang bleibt, und sein Entfernen lässt den Plan stehen.
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/anhaenge/{linker}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        bild(&app, einsatz, uhs, &frieda, None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn uebernahme_eines_pdf_ist_422_ohne_auditzeile() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let linker = anhang_ablegen(&app, einsatz, uhs, &admin, "grundriss_halle.pdf", b"%PDF").await;
    let vorher = stand(&pool, einsatz).await;
    let (s, v) = uebernehmen(&app, einsatz, uhs, &admin, linker).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Plan"), "{v}");
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn uebernahme_fremder_oder_entfernter_anhaenge_ist_404() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let pa = uhs_anlegen(&app, &admin, einsatz, "PA 1").await;
    let fremd = anhang_ablegen(&app, einsatz, pa, &admin, "pa.png", &png_bytes(8, 8)).await;
    let weg = anhang_ablegen(&app, einsatz, uhs, &admin, "weg.png", &png_bytes(8, 8)).await;
    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/anhaenge/{weg}"),
        &admin,
        None,
    )
    .await;
    let vorher = stand(&pool, einsatz).await;
    assert_eq!(
        uebernehmen(&app, einsatz, uhs, &admin, fremd).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        uebernehmen(&app, einsatz, uhs, &admin, weg).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

// ------------------------- Lage, Darstellung, Entfernen -------------------------

#[tokio::test]
async fn aendern_rastet_ein_ohne_etb_und_prueft_grenzen() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(80, 60)).await;
    let etb_vorher = stand(&pool, einsatz).await.1;
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &plan(einsatz, uhs),
        &admin,
        Some(r#"{"x":37,"breite":1204,"helligkeit":40,"kontrast":120,"nacht_umkehren":false}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        (v["x"].as_i64(), v["breite"].as_i64()),
        (Some(40), Some(1200))
    );
    assert_eq!(
        (v["helligkeit"].as_i64(), v["kontrast"].as_i64()),
        (Some(40), Some(120))
    );
    assert_eq!(v["nacht_umkehren"], false);
    assert_eq!(
        stand(&pool, einsatz).await.1,
        etb_vorher,
        "Lage schreibt kein ETB"
    );
    for falsch in [
        r#"{"breite":90}"#,
        r#"{"breite":5010}"#,
        r#"{"x":-10}"#,
        r#"{"helligkeit":101}"#,
        r#"{"kontrast":49}"#,
        r#"{"x":"links"}"#,
        r#"{"drehung":90}"#,
    ] {
        let (s, v) = anfrage(&app, "PATCH", &plan(einsatz, uhs), &admin, Some(falsch)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{falsch}: {v}");
    }
}

#[tokio::test]
async fn entfernen_mit_etb_und_danach_404() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(8, 8)).await;
    let (s, _) = anfrage(&app, "DELETE", &plan(einsatz, uhs), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        etb_inhalte(&pool, einsatz).await.last().unwrap(),
        "UHS BHP 50: Plan entfernt"
    );
    assert_eq!(stand(&pool, einsatz).await.0, 0);
    let (s, _) = anfrage(&app, "DELETE", &plan(einsatz, uhs), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &plan(einsatz, uhs),
        &admin,
        Some(r#"{"x":10}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ------------------------------ Rechte und Storno ------------------------------

#[tokio::test]
async fn beobachter_sieht_aber_schreibt_nicht() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(8, 8)).await;
    let linker = anhang_ablegen(&app, einsatz, uhs, &admin, "b.png", &png_bytes(8, 8)).await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    let vorher = stand(&pool, einsatz).await;
    assert_eq!(
        bild(&app, einsatz, uhs, &erika, None).await.0,
        StatusCode::OK
    );
    let (s, _) = plan_hochladen(&app, einsatz, uhs, &erika, "c.png", &png_bytes(8, 8)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &plan(einsatz, uhs),
        &erika,
        Some(r#"{"x":10}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "DELETE", &plan(einsatz, uhs), &erika, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        uebernehmen(&app, einsatz, uhs, &erika, linker).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn stornierte_uhs_ist_409_beim_schreiben_und_zeigt_den_plan() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(8, 8)).await;
    let linker = anhang_ablegen(&app, einsatz, uhs, &admin, "b.png", &png_bytes(8, 8)).await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "stornieren");
    let vorher = stand(&pool, einsatz).await;
    let (s, _) = plan_hochladen(&app, einsatz, uhs, &admin, "c.png", &png_bytes(8, 8)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &plan(einsatz, uhs),
        &admin,
        Some(r#"{"x":10}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(&app, "DELETE", &plan(einsatz, uhs), &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        uebernehmen(&app, einsatz, uhs, &admin, linker).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
    assert_eq!(
        bild(&app, einsatz, uhs, &admin, None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn uhs_eines_fremden_einsatzes_ist_404() {
    let (app, _pool, admin, einsatz, uhs) = start().await;
    plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(8, 8)).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    assert_eq!(
        bild(&app, anderer, uhs, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    let (s, _) = plan_hochladen(&app, anderer, uhs, &admin, "a.png", &png_bytes(8, 8)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ------------------------------ Live ------------------------------

#[tokio::test]
async fn schreibende_routen_melden_uhs_live() {
    let (app, _pool, admin, einsatz, uhs) = start().await;
    for (schritt, aktion) in ["hochladen", "aendern", "entfernen"].iter().enumerate() {
        let feed = live_oeffnen(&app, &admin, einsatz).await;
        match schritt {
            0 => {
                plan_hochladen(&app, einsatz, uhs, &admin, "a.png", &png_bytes(8, 8)).await;
            }
            1 => {
                anfrage(
                    &app,
                    "PATCH",
                    &plan(einsatz, uhs),
                    &admin,
                    Some(r#"{"x":10}"#),
                )
                .await;
            }
            _ => {
                anfrage(&app, "DELETE", &plan(einsatz, uhs), &admin, None).await;
            }
        }
        let gelesen = sse_anfang_lesen(feed.into_body(), 400).await;
        assert!(gelesen.contains("event: uhs"), "{aktion}: {gelesen:?}");
    }
}
