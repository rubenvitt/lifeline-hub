//! Integrationstests der Bild-Anlagen an Lagebericht und Befehl (LFH-1028, Spec
//! `dokument-anlagen`) über die Routen `/api/einsaetze/{id}/{lageberichte|befehle}/{did}/anlagen…`:
//! Anfügen im Entwurf, Sperre nach der Freigabe, Dateityp, Felder, Rechte, Download in den
//! Fassungen, Abschottung gegen die generische Route und der Freigabe-Snapshot im ETB.
//!
//! Die Repo-Regeln (Höchstzahl, Fortschreiben, Schwärzung) stehen in
//! `src/vorlagendokument/anlage.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

/// Ein Dokumentpfad je Art: Präfix und Anlege-Body eines freigabefähigen Entwurfs.
struct Art {
    praefix: &'static str,
    anlegen: &'static str,
}

const LAGEBERICHT: Art = Art {
    praefix: "lageberichte",
    anlegen: r#"{"vorlage":"freitext","titel":"Lage 12:00","abschnitte":[{"schluessel":"text","text":"Ruhig"}]}"#,
};

const BEFEHL: Art = Art {
    praefix: "befehle",
    anlegen: r#"{"vorlage":"befehl_lad","titel":"Befehl 1","abschnitte":[{"schluessel":"lage","text":"L"},{"schluessel":"auftrag","text":"A"},{"schluessel":"durchfuehrung","text":"D"}]}"#,
};

fn pfad(art: &Art, einsatz: i64, dok: i64) -> String {
    format!("/api/einsaetze/{einsatz}/{}/{dok}/anlagen", art.praefix)
}

/// Multipart-POST mit Textfeldern und höchstens einer Datei.
async fn hochladen(
    app: &axum::Router,
    uri: &str,
    cookie: &str,
    felder: &[(&str, &str)],
    datei: Option<(&str, &[u8])>,
) -> (StatusCode, Value) {
    let b = "LFHANLAGEBOUNDARY";
    let mut body = Vec::new();
    for (name, wert) in felder {
        body.extend_from_slice(
            format!("--{b}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{wert}\r\n")
                .as_bytes(),
        );
    }
    if let Some((dateiname, daten)) = datei {
        body.extend_from_slice(
            format!(
                "--{b}\r\nContent-Disposition: form-data; name=\"datei\"; \
                 filename=\"{dateiname}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(daten);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{b}--\r\n").as_bytes());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
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
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

const SKIZZE: &[(&str, &str)] = &[
    ("art", "fernmeldeskizze"),
    ("titel", "Fernmeldeskizze"),
    ("stand_at", "2026-10-08 12:15:00"),
];

async fn skizze_anfuegen(
    app: &axum::Router,
    art: &Art,
    einsatz: i64,
    dok: i64,
    cookie: &str,
) -> (StatusCode, Value) {
    // Ein dekodierbares Bild: die Vorschau-Fassung rechnet es um.
    let png = png_bytes(64, 48);
    hochladen(
        app,
        &pfad(art, einsatz, dok),
        cookie,
        SKIZZE,
        Some(("fernmeldeskizze.png", &png)),
    )
    .await
}

async fn get_bytes(app: &axum::Router, uri: &str, cookie: &str) -> (StatusCode, Vec<u8>) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, bytes)
}

async fn start(art: &Art) -> (axum::Router, sqlx::SqlitePool, String, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/{}", art.praefix),
        &admin,
        Some(art.anlegen),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Dokument anlegen: {v}");
    let dok = v["id"].as_i64().unwrap();
    (app, pool, admin, einsatz, dok)
}

/// (anhang, linker) im Einsatz — eine Abweisung darf keine der beiden Zahlen ändern.
async fn stand(pool: &sqlx::SqlitePool, einsatz: i64) -> (i64, i64) {
    let anhang: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap();
    let linker: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM lagebericht_anlage WHERE einsatz_id = ?1) + \
                (SELECT COUNT(*) FROM befehl_anlage WHERE einsatz_id = ?1)",
    )
    .bind(einsatz)
    .fetch_one(pool)
    .await
    .unwrap();
    (anhang, linker)
}

async fn anfuegen_liste_download_fall(art: &Art) {
    let (app, _pool, admin, einsatz, dok) = start(art).await;
    let (s, v) = skizze_anfuegen(&app, art, einsatz, dok, &admin).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["nummer"], 1);
    assert_eq!(v["art"], "fernmeldeskizze");
    assert_eq!(v["titel"], "Fernmeldeskizze");
    assert_eq!(v["stand_at"], "2026-10-08 12:15:00");
    assert_eq!(v["mime"], "image/png");
    assert_eq!(v["dokument_id"], dok);
    assert!(!v.as_object().unwrap().contains_key("anhang_id"), "{v}");
    let id = v["id"].as_i64().unwrap();

    let (s, l) = anfrage(&app, "GET", &pfad(art, einsatz, dok), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(l.as_array().unwrap().len(), 1);
    assert_eq!(l[0]["id"], id);

    let datei = format!("{}/{id}/datei", pfad(art, einsatz, dok));
    let (s, bytes) = get_bytes(&app, &datei, &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert!(bytes.starts_with(b"\x89PNG"), "bereinigte Fassung ist PNG");
    let (s, _) = get_bytes(&app, &format!("{datei}?fassung=vorschau"), &admin).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = get_bytes(&app, &format!("{datei}?fassung=original"), &admin).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{id}", pfad(art, einsatz, dok)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, l) = anfrage(&app, "GET", &pfad(art, einsatz, dok), &admin, None).await;
    assert!(l.as_array().unwrap().is_empty());
    let (s, _) = get_bytes(&app, &datei, &admin).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn anfuegen_liste_download_und_entfernen() {
    anfuegen_liste_download_fall(&LAGEBERICHT).await;
    anfuegen_liste_download_fall(&BEFEHL).await;
}

async fn freigabe_fall(art: &Art) {
    let (app, pool, admin, einsatz, dok) = start(art).await;
    let (s, v) = skizze_anfuegen(&app, art, einsatz, dok, &admin).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = v["id"].as_i64().unwrap();
    let (s, d) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/{}/{dok}/freigeben", art.praefix),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{d}");
    let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
        .bind(d["etb_eintrag_id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        inhalt.ends_with("## Anlagen\n1. Fernmeldeskizze, Stand 2026-10-08 12:15:00\n"),
        "{inhalt}"
    );

    let vorher = stand(&pool, einsatz).await;
    let (s, _) = skizze_anfuegen(&app, art, einsatz, dok, &admin).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{id}", pfad(art, einsatz, dok)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn nach_der_freigabe_422_und_der_etb_nennt_die_anlage() {
    freigabe_fall(&LAGEBERICHT).await;
    freigabe_fall(&BEFEHL).await;
}

#[tokio::test]
async fn svg_pdf_und_fehlende_felder_werden_ohne_rest_abgewiesen() {
    let (app, pool, admin, einsatz, dok) = start(&BEFEHL).await;
    let uri = pfad(&BEFEHL, einsatz, dok);
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
    for (felder, datei) in [
        (SKIZZE, Some(("skizze.svg", &svg[..]))),
        (SKIZZE, Some(("skizze.pdf", &b"%PDF-1.4"[..]))),
        (SKIZZE, None),
        (&SKIZZE[1..], Some(("skizze.png", MINI_PNG))),
        (
            &[
                ("art", "lagekarte"),
                ("titel", "X"),
                ("stand_at", "2026-10-08 12:15:00"),
            ][..],
            Some(("skizze.png", MINI_PNG)),
        ),
        (
            &[
                ("art", "fernmeldeskizze"),
                ("titel", "  "),
                ("stand_at", "2026-10-08 12:15:00"),
            ][..],
            Some(("skizze.png", MINI_PNG)),
        ),
        (
            &[
                ("art", "fernmeldeskizze"),
                ("titel", "X"),
                ("stand_at", "gestern"),
            ][..],
            Some(("skizze.png", MINI_PNG)),
        ),
        (
            &[
                ("art", "fernmeldeskizze"),
                ("titel", "X"),
                ("stand_at", "2026-10-08 12:15:00"),
                ("notiz", "egal"),
            ][..],
            Some(("skizze.png", MINI_PNG)),
        ),
    ] {
        let (s, v) = hochladen(&app, &uri, &admin, felder, datei).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{felder:?} {v}");
    }
    assert_eq!(stand(&pool, einsatz).await, (0, 0));
}

#[tokio::test]
async fn beobachter_liest_aber_fuegt_nicht_an() {
    let (app, pool, admin, einsatz, dok) = start(&LAGEBERICHT).await;
    let (s, v) = skizze_anfuegen(&app, &LAGEBERICHT, einsatz, dok, &admin).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (s, l) = anfrage(&app, "GET", &pfad(&LAGEBERICHT, einsatz, dok), &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(l.as_array().unwrap().len(), 1);
    let vorher = stand(&pool, einsatz).await;
    let (s, _) = skizze_anfuegen(&app, &LAGEBERICHT, einsatz, dok, &erika).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{}", pfad(&LAGEBERICHT, einsatz, dok), v["id"]),
        &erika,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn anlage_ist_ueber_die_generische_route_weder_lad_noch_loeschbar() {
    let (app, pool, admin, einsatz, dok) = start(&BEFEHL).await;
    let (s, v) = skizze_anfuegen(&app, &BEFEHL, einsatz, dok, &admin).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let anhang_id: i64 = sqlx::query_scalar("SELECT anhang_id FROM befehl_anlage WHERE id = ?")
        .bind(v["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
    let generisch = format!("/api/einsaetze/{einsatz}/anhaenge/{anhang_id}");
    let (s, _) = get_bytes(&app, &generisch, &admin).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &generisch, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(stand(&pool, einsatz).await, (1, 1));
}

#[tokio::test]
async fn fremdes_dokument_und_fremder_einsatz_sind_404() {
    let (app, _pool, admin, einsatz, dok) = start(&LAGEBERICHT).await;
    let (s, v) = skizze_anfuegen(&app, &LAGEBERICHT, einsatz, dok, &admin).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = v["id"].as_i64().unwrap();
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(&app, "GET", &pfad(&LAGEBERICHT, anderer, dok), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = get_bytes(
        &app,
        &format!("{}/{id}/datei", pfad(&LAGEBERICHT, anderer, dok)),
        &admin,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Dieselbe Zahl als Befehl gelesen: kein Befehl dieser id, also 404.
    let (s, _) = anfrage(&app, "GET", &pfad(&BEFEHL, einsatz, dok), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
