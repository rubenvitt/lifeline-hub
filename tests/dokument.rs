//! Integrationstests der Dokumentenablage (LFH-632).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/dokumente")
}

/// Multipart mit Datei + beliebigen Textfeldern. `datei = None` lässt das Dateifeld weg.
async fn ablegen(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    datei: Option<(&str, &[u8])>,
    felder: &[(&str, &str)],
) -> (StatusCode, Value) {
    multipart_post(app, &pfad(einsatz), cookie, datei, felder).await
}

async fn multipart_post(
    app: &axum::Router,
    uri: &str,
    cookie: &str,
    datei: Option<(&str, &[u8])>,
    felder: &[(&str, &str)],
) -> (StatusCode, Value) {
    let b = "LFHDOKBOUNDARY";
    let mut body = Vec::new();
    for (name, wert) in felder {
        body.extend_from_slice(
            format!("--{b}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{wert}\r\n")
                .as_bytes(),
        );
    }
    if let Some((dateiname, daten)) = datei {
        body.extend_from_slice(format!(
            "--{b}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"{dateiname}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        ).as_bytes());
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

async fn datei_laden(
    app: &axum::Router,
    einsatz: i64,
    did: i64,
    cookie: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("{}/{did}/datei", pfad(einsatz)))
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

const PDF: (&str, &[u8]) = ("lageplan.pdf", b"%PDF-1.4 inhalt");

const STANDARD: &[(&str, &str)] = &[("titel", "Lageplan Nord"), ("kategorie", "lagekarte_plan")];

async fn start() -> (axum::Router, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

async fn etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json.as_array().cloned().unwrap_or_default()
}

async fn abschnitt_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

// ---------- Ablegen, Liste, Download ----------

#[tokio::test]
async fn ablegen_listet_und_laedt_herunter() {
    let (app, admin, einsatz) = start().await;
    let (status, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["kategorie"], "lagekarte_plan");
    assert_eq!(json["titel"], "Lageplan Nord");
    assert_eq!(json["dateiname"], "lageplan.pdf");
    assert_eq!(json["mime"], "application/pdf");
    assert_eq!(json["groesse"], 15);
    assert!(json["abgelegt_von_name"].is_string(), "{json:?}");
    let did = json["id"].as_i64().unwrap();

    let (status, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["id"], did);

    let (status, headers, bytes) = datei_laden(&app, einsatz, did, &admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF.1);
    assert!(headers[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .starts_with("attachment"));
    assert!(headers.contains_key(header::ETAG));
}

#[tokio::test]
async fn download_revalidiert_mit_304() {
    let (app, admin, einsatz) = start().await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    let (_, headers, _) = datei_laden(&app, einsatz, did, &admin).await;
    let etag = headers[header::ETAG].to_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("{}/{did}/datei", pfad(einsatz)))
                .header(header::COOKIE, &admin)
                .header(header::IF_NONE_MATCH, &etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn ablegen_schreibt_system_etb_eintrag() {
    let (app, admin, einsatz) = start().await;
    let (status, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CREATED);
    let eintraege = etb(&app, &admin, einsatz).await;
    let treffer: Vec<&Value> = eintraege
        .iter()
        .filter(|e| {
            e["typ"] == "system"
                && e["inhalt"].as_str().is_some_and(|i| {
                    i.contains("Dokument abgelegt: Lageplan Nord (Lagekarte/Plan)")
                })
        })
        .collect();
    assert_eq!(treffer.len(), 1, "{eintraege:?}");
    assert_eq!(json["etb_eintrag_id"], treffer[0]["id"]);
}

// ---------- Validierung ----------

async fn erwarte_status(
    felder: &[(&str, &str)],
    datei: Option<(&str, &[u8])>,
    erwartet: StatusCode,
) {
    let (app, admin, einsatz) = start().await;
    let (status, json) = ablegen(&app, einsatz, &admin, datei, felder).await;
    assert_eq!(status, erwartet, "{json:?}");
}

#[tokio::test]
async fn unbekannte_kategorie_ist_400() {
    erwarte_status(
        &[("titel", "X"), ("kategorie", "geheim")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn fehlender_titel_ist_400() {
    erwarte_status(
        &[("kategorie", "befehl")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn leerer_titel_ist_400() {
    erwarte_status(
        &[("titel", "   "), ("kategorie", "befehl")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn titel_ueber_200_zeichen_ist_400() {
    let lang = "ä".repeat(201);
    erwarte_status(
        &[("titel", &lang), ("kategorie", "befehl")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn titel_mit_200_zeichen_ist_erlaubt() {
    let genau = "ä".repeat(200);
    erwarte_status(
        &[("titel", &genau), ("kategorie", "befehl")],
        Some(PDF),
        StatusCode::CREATED,
    )
    .await;
}

#[tokio::test]
async fn fehlende_datei_ist_400() {
    erwarte_status(STANDARD, None, StatusCode::BAD_REQUEST).await;
}

#[tokio::test]
async fn unerlaubter_typ_ist_400() {
    erwarte_status(STANDARD, Some(("x.exe", b"MZ")), StatusCode::BAD_REQUEST).await;
}

#[tokio::test]
async fn unbekannter_bezug_typ_ist_400() {
    erwarte_status(
        &[
            ("titel", "X"),
            ("kategorie", "befehl"),
            ("bezug_typ", "fahrzeug"),
            ("bezug_id", "1"),
        ],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn bezug_typ_ohne_id_ist_422() {
    erwarte_status(
        &[
            ("titel", "X"),
            ("kategorie", "befehl"),
            ("bezug_typ", "abschnitt"),
        ],
        Some(PDF),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
}

#[tokio::test]
async fn bezug_id_ohne_typ_ist_422() {
    erwarte_status(
        &[("titel", "X"), ("kategorie", "befehl"), ("bezug_id", "1")],
        Some(PDF),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
}

// ---------- Bezug ----------

#[tokio::test]
async fn bezug_auf_abschnitt_wird_gespeichert() {
    let (app, admin, einsatz) = start().await;
    let aid = abschnitt_anlegen(&app, &admin, einsatz, "Abschnitt Nord").await;
    let aid_s = aid.to_string();
    let (status, json) = ablegen(
        &app,
        einsatz,
        &admin,
        Some(PDF),
        &[
            ("titel", "Plan"),
            ("kategorie", "lagekarte_plan"),
            ("bezug_typ", "abschnitt"),
            ("bezug_id", &aid_s),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["bezug_abschnitt_id"], aid);
    assert_eq!(json["bezug_abschnitt_name"], "Abschnitt Nord");
    let obj = json.as_object().unwrap();
    assert!(!obj.contains_key("bezug_einheit_id"), "{json:?}");
    assert!(!obj.contains_key("bezug_etb_eintrag_id"), "{json:?}");
}

#[tokio::test]
async fn bezug_auf_fremden_abschnitt_ist_400() {
    let (app, admin, einsatz_a) = start().await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let fremd = abschnitt_anlegen(&app, &admin, einsatz_b, "Fremd").await;
    let fremd_s = fremd.to_string();
    let (status, json) = ablegen(
        &app,
        einsatz_a,
        &admin,
        Some(PDF),
        &[
            ("titel", "Plan"),
            ("kategorie", "befehl"),
            ("bezug_typ", "abschnitt"),
            ("bezug_id", &fremd_s),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    // Keine Teil-Anlage: die Transaktion rollt Anhang und ETB-Eintrag mit zurück.
    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz_a), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

// ---------- MIME-Allowlist ----------

#[tokio::test]
async fn heic_und_tiff_sind_erlaubt() {
    let (app, admin, einsatz) = start().await;
    for (datei, mime) in [("foto.heic", "image/heic"), ("scan.tiff", "image/tiff")] {
        let (status, json) = ablegen(
            &app,
            einsatz,
            &admin,
            Some((datei, b"x")),
            &[("titel", datei), ("kategorie", "foto")],
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{datei}: {json:?}");
        assert_eq!(json["mime"], mime);
    }
}

#[tokio::test]
async fn chat_allowlist_bleibt_ohne_heic() {
    let (app, admin, einsatz) = start().await;
    let (status, json) = multipart_post(
        &app,
        &format!("/api/einsaetze/{einsatz}/anhaenge"),
        &admin,
        Some(("foto.heic", b"x")),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
}

// ---------- Isolation, Löschen ----------

#[tokio::test]
async fn dokument_aus_fremdem_einsatz_ist_404() {
    let (app, admin, einsatz_a) = start().await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let (_, json) = ablegen(&app, einsatz_b, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();

    let (status, _, _) = datei_laden(&app, einsatz_a, did, &admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{did}", pfad(einsatz_a)),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Das Dokument in B ist unberührt.
    let (status, _, _) = datei_laden(&app, einsatz_b, did, &admin).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn entfernen_ist_soft_delete() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    let loeschpfad = format!("{}/{did}", pfad(einsatz));

    let (status, _) = anfrage(&app, "DELETE", &loeschpfad, &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
    let (status, _, _) = datei_laden(&app, einsatz, did, &admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(&app, "DELETE", &loeschpfad, &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let eintraege = etb(&app, &admin, einsatz).await;
    assert!(
        eintraege.iter().any(|e| e["typ"] == "system"
            && e["inhalt"]
                .as_str()
                .is_some_and(|i| i.contains("Dokument entfernt: Lageplan Nord (Lagekarte/Plan)"))),
        "{eintraege:?}"
    );
    let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(anhaenge, 1, "Soft-Delete lässt die Bytes stehen");
}

// ---------- Rechte ----------

#[tokio::test]
async fn beobachter_darf_lesen_nicht_ablegen() {
    let (app, admin, einsatz) = start().await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (status, _) = anfrage(&app, "GET", &pfad(einsatz), &beob_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = datei_laden(&app, einsatz, did, &beob_cookie).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = ablegen(&app, einsatz, &beob_cookie, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{did}", pfad(einsatz)),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ablegen_ist_409() {
    let (app, admin, einsatz) = start().await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "abschliessen: {status}");
    let (status, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
}

#[tokio::test]
async fn fremde_org_ist_403_oder_404() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _) = anfrage(&app, "GET", &pfad(einsatz), &fremd, None).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "GET-Liste: {status}"
    );
    let (status, _, _) = datei_laden(&app, einsatz, did, &fremd).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "Download: {status}"
    );
    let (status, _) = ablegen(&app, einsatz, &fremd, Some(PDF), STANDARD).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "POST: {status}"
    );
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{did}", pfad(einsatz)),
        &fremd,
        None,
    )
    .await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "DELETE: {status}"
    );
}
