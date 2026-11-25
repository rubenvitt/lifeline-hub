//! HTTP-Integrationstests der Fremdebenen-Routen (LLH-2099), Entwurf
//! `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md`, Abschnitt „Routen“.
//!
//! Abdeckung: Hochladen → Liste → Daten (ETag, 304, ungepackt), PATCH, DELETE; Beobachter darf
//! lesen, aber nicht hochladen; Ablehnungen mit `grund`; Farbvergabe; `url` nur für Schreibende;
//! Live-Ereignis `karte_fremdebene`. Der Virenfund steht in `tests/karte_fremdebene_scan.rs`
//! (eigenes Binary, weil `init_scan_config` prozessweit gilt).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, recv_until_tag,
    rolle_setzen, setup, setup_mit_pool, setup_mit_pool_und_live,
};

const ZWEI_PUNKTE: &str = r#"{"type":"FeatureCollection","features":[
  {"type":"Feature","properties":{"name":"A"},"geometry":{"type":"Point","coordinates":[9.1,50.1]}},
  {"type":"Feature","properties":{"name":"B"},"geometry":{"type":"Point","coordinates":[9.2,50.2]}}
]}"#;

fn basis(einsatz: i64) -> String {
    format!("/api/incidents/{einsatz}/map/foreign-layers")
}

/// Multipart mit Textfeldern und optional einer Datei im Feld `file`.
fn multipart(boundary: &str, felder: &[(&str, &str)], datei: Option<(&str, &[u8])>) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, wert) in felder {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{wert}\r\n"
            )
            .as_bytes(),
        );
    }
    if let Some((dateiname, daten)) = datei {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{dateiname}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(daten);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

async fn hochladen(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    felder: &[(&str, &str)],
    datei: Option<(&str, &[u8])>,
) -> (StatusCode, Value) {
    let boundary = "LLHFREMDBND";
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(basis(einsatz))
                .header(header::COOKIE, cookie)
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(multipart(boundary, felder, datei)))
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

async fn daten(
    app: &axum::Router,
    einsatz: i64,
    ebene: i64,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method("GET")
        .uri(format!("{}/{ebene}/data", basis(einsatz)))
        .header(header::COOKIE, cookie)
        .header(header::ACCEPT_ENCODING, "gzip, br");
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

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[tokio::test]
async fn hochladen_liste_daten_und_304() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, ebene) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "  Suchgebiete  ")],
        Some(("gebiete.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{ebene}");
    assert_eq!(ebene["name"], "Suchgebiete");
    assert_eq!(ebene["source"], "datei");
    assert_eq!(ebene["color"], "fremd-1");
    assert_eq!(ebene["feature_count"], 2);
    assert_eq!(ebene["dropped_count"], 0);
    let o = ebene.as_object().unwrap();
    assert!(
        !o.contains_key("url") && !o.contains_key("url_host"),
        "{ebene}"
    );
    let id = ebene["id"].as_i64().unwrap();

    let (s, liste) = anfrage(&app, "GET", &basis(einsatz), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);
    assert_eq!(liste[0]["id"], id);

    let (s, h, body) = daten(&app, einsatz, id, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h[header::CONTENT_TYPE], "application/geo+json");
    assert!(
        h.get(header::CONTENT_ENCODING).is_none(),
        "Antwort mit ETag bleibt ungepackt: {h:?}"
    );
    let etag = h[header::ETAG].to_str().unwrap().to_string();
    assert_eq!(etag, format!("\"{}\"", hex(&Sha256::digest(&body))));
    let geo: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(geo["type"], "FeatureCollection");
    assert_eq!(geo["features"].as_array().unwrap().len(), 2);

    let (s, h, body) = daten(&app, einsatz, id, &admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert_eq!(h[header::ETAG].to_str().unwrap(), etag);
    assert!(body.is_empty());
}

#[tokio::test]
async fn farbe_wird_vergeben_oder_gewaehlt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let datei = Some(("a.geojson", ZWEI_PUNKTE.as_bytes()));

    let (_, a) = hochladen(&app, einsatz, &admin, &[("name", "A")], datei).await;
    assert_eq!(a["color"], "fremd-1");
    let (_, b) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "B"), ("color", "fremd-3")],
        datei,
    )
    .await;
    assert_eq!(b["color"], "fremd-3");
    let (_, c) = hochladen(&app, einsatz, &admin, &[("name", "C")], datei).await;
    assert_eq!(c["color"], "fremd-2", "erster freier Schlüssel");

    let (s, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "D"), ("color", "rot")],
        datei,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
}

#[tokio::test]
async fn name_aus_der_datei_und_grenze() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let kml = br#"<?xml version="1.0"?><kml><Document><name>Flugspur Heli</name>
      <Placemark><Point><coordinates>9.1,50.1</coordinates></Point></Placemark></Document></kml>"#;
    let (s, v) = hochladen(&app, einsatz, &admin, &[], Some(("spur.kml", kml))).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["name"], "Flugspur Heli", "Namensvorschlag der Datei");

    let (s, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[],
        Some(("gebiete.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(
        v["name"], "gebiete",
        "ohne Vorschlag der Dateiname ohne Endung"
    );

    let lang = "x".repeat(121);
    let (s, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", &lang)],
        Some(("a.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
}

#[tokio::test]
async fn genau_eine_quelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, _) = hochladen(&app, einsatz, &admin, &[("name", "A")], None).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "weder Datei noch URL");

    let (s, _) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "A"), ("url", "https://example.org/a.kml")],
        Some(("a.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Datei und URL zugleich");

    // Die URL-Ebene selbst prüft `tests/karte_fremdebene_url.rs`.
    let (_, liste) = anfrage(&app, "GET", &basis(einsatz), &admin, None).await;
    assert!(liste.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn ablehnungen_tragen_den_grund() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "A")],
        Some(("a.txt", b"Das ist keine Geodatei.")),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(v["grund"], "unlesbar", "{v}");

    let dtd = br#"<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "x">]><kml/>"#;
    let (s, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "A")],
        Some(("a.kml", dtd)),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(v["grund"], "dtd", "{v}");

    let gross = vec![b' '; 10 * 1024 * 1024 + 1];
    let (s, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "A")],
        Some(("a.geojson", &gross)),
    )
    .await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(v["grund"], "zu_gross", "{v}");

    let (_, liste) = anfrage(&app, "GET", &basis(einsatz), &admin, None).await;
    assert!(liste.as_array().unwrap().is_empty(), "nichts gespeichert");
}

#[tokio::test]
async fn patch_und_delete() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "A")],
        Some(("a.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    let id = v["id"].as_i64().unwrap();
    let pfad = format!("{}/{id}", basis(einsatz));

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"name": " Neu ", "color": "fremd-4"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["name"], "Neu");
    assert_eq!(v["color"], "fremd-4");

    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"color": "blau"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage_json(&app, "PATCH", &pfad, &admin, Some(&json!({"name": "  "}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, _) = anfrage(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = daten(&app, einsatz, id, &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (_, liste) = anfrage(&app, "GET", &basis(einsatz), &admin, None).await;
    assert!(liste.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn ebene_eines_anderen_einsatzes_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let (_, v) = hochladen(
        &app,
        a,
        &admin,
        &[("name", "A")],
        Some(("a.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    let id = v["id"].as_i64().unwrap();
    let (s, _, _) = daten(&app, b, id, &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &format!("{}/{id}", basis(b)), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn beobachter_liest_aber_laedt_nicht_hoch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beo_id = benutzer_anlegen(&app, &admin, "beobachter1", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo_id, "beobachter").await;
    let beo = login_cookie(&app, "beobachter1", "beobachter1pw1").await;
    let datei = Some(("a.geojson", ZWEI_PUNKTE.as_bytes()));

    let (s, _) = hochladen(&app, einsatz, &beo, &[("name", "A")], datei).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    let (_, v) = hochladen(&app, einsatz, &admin, &[("name", "A")], datei).await;
    let id = v["id"].as_i64().unwrap();
    let (s, liste) = anfrage(&app, "GET", &basis(einsatz), &beo, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);
    let (s, _, _) = daten(&app, einsatz, id, &beo, None).await;
    assert_eq!(s, StatusCode::OK);

    let pfad = format!("{}/{id}", basis(einsatz));
    let (s, _) = anfrage_json(&app, "PATCH", &pfad, &beo, Some(&json!({"name": "X"}))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "DELETE", &pfad, &beo, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

/// Entwurf, „URL mit Geheimnis im Query“: die volle `url` nur mit Schreibrecht.
#[tokio::test]
async fn url_nur_fuer_schreibende() {
    use lifeline_hub::karte_fremdebene::einlesen::read_datei;
    use lifeline_hub::karte_fremdebene::{repo, FremdebeneQuelle};

    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beo_id = benutzer_anlegen(&app, &admin, "beobachter1", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo_id, "beobachter").await;
    let beo = login_cookie(&app, "beobachter1", "beobachter1pw1").await;

    let normiert = read_datei(ZWEI_PUNKTE.as_bytes()).unwrap();
    let url = "https://daten.example.org/lage.kml?token=geheim";
    repo::anlegen(
        &pool,
        einsatz,
        1,
        "Lage extern",
        FremdebeneQuelle::Url,
        Some(url),
        "fremd-1",
        &normiert,
    )
    .await
    .unwrap();

    let (_, liste) = anfrage(&app, "GET", &basis(einsatz), &admin, None).await;
    assert_eq!(liste[0]["url"], url);
    assert_eq!(liste[0]["url_host"], "daten.example.org");

    let (_, liste) = anfrage(&app, "GET", &basis(einsatz), &beo, None).await;
    assert!(
        !liste[0].as_object().unwrap().contains_key("url"),
        "Leser sehen die volle Adresse nicht: {liste}"
    );
    assert_eq!(liste[0]["url_host"], "daten.example.org");
}

#[tokio::test]
async fn live_ereignis_bei_jeder_aenderung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);
    let warten = Duration::from_secs(2);

    let (_, v) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "A")],
        Some(("a.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    recv_until_tag(&mut rx, "karte_fremdebene", warten).await;

    let pfad = format!("{}/{}", basis(einsatz), v["id"]);
    let (s, _) = anfrage_json(&app, "PATCH", &pfad, &admin, Some(&json!({"name": "B"}))).await;
    assert_eq!(s, StatusCode::OK);
    recv_until_tag(&mut rx, "karte_fremdebene", warten).await;

    let (s, _) = anfrage(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    recv_until_tag(&mut rx, "karte_fremdebene", warten).await;
}

// ---------- Fremdebenen im gesicherten Stand (LLH-2130) ----------

async fn stand_daten(
    app: &axum::Router,
    einsatz: i64,
    stand: i64,
    sha: &str,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/incidents/{einsatz}/situation-snapshots/{stand}/foreign-layers/{sha}/data"
        ))
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

/// Legt einen Stand an; liefert seine ID und die Hashes seiner Fremdebenen.
async fn stand_sichern(app: &axum::Router, einsatz: i64, cookie: &str) -> (i64, Vec<String>) {
    let (s, dok) = anfrage_json(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/situation-snapshots"),
        cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{dok}");
    let hashes = dok["daten"]["fremdebenen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["sha256"].as_str().unwrap().to_string())
        .collect();
    (dok["id"].as_i64().unwrap(), hashes)
}

#[tokio::test]
async fn stand_route_liefert_eingefrorenen_inhalt_und_304() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, ebene) = hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "Gebiete")],
        Some(("g.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    let (_, live_h, live) = daten(&app, einsatz, ebene["id"].as_i64().unwrap(), &admin, None).await;
    let (stand, hashes) = stand_sichern(&app, einsatz, &admin).await;
    assert_eq!(hashes.len(), 1);

    let (s, h, body) = stand_daten(&app, einsatz, stand, &hashes[0], &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h[header::CONTENT_TYPE], "application/geo+json");
    assert_eq!(body, live);
    let etag = h[header::ETAG].to_str().unwrap().to_string();
    assert_eq!(etag, live_h[header::ETAG].to_str().unwrap());

    let (s, _, body) = stand_daten(&app, einsatz, stand, &hashes[0], &admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(body.is_empty());
}

#[tokio::test]
async fn fremder_hash_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let datei = Some(("g.geojson", ZWEI_PUNKTE.as_bytes()));
    hochladen(&app, einsatz, &admin, &[("name", "A")], datei).await;
    let (leer, _) = stand_sichern(&app, anderer, &admin).await;
    let (stand, hashes) = stand_sichern(&app, einsatz, &admin).await;

    // Derselbe Inhalt über einen Stand, der ihn nicht nennt, und über einen anderen Einsatz.
    let (s, _, _) = stand_daten(&app, anderer, leer, &hashes[0], &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _, _) = stand_daten(&app, anderer, stand, &hashes[0], &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _, _) = stand_daten(&app, einsatz, stand, "kein-hash", &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn beobachter_liest_stand_fremdebene() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    hochladen(
        &app,
        einsatz,
        &admin,
        &[("name", "A")],
        Some(("g.geojson", ZWEI_PUNKTE.as_bytes())),
    )
    .await;
    let (stand, hashes) = stand_sichern(&app, einsatz, &admin).await;
    let beo_id = benutzer_anlegen(&app, &admin, "beobachter-stand", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo_id, "beobachter").await;
    let beo = login_cookie(&app, "beobachter-stand", "beobachter-standpw1").await;

    let (s, _, _) = stand_daten(&app, einsatz, stand, &hashes[0], &beo, None).await;
    assert_eq!(s, StatusCode::OK);
}
