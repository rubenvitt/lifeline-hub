//! Integrationstests der UHS-Anhänge (LFH-758, Spec `uhs-anhaenge`): je Spec-Szenario ein Test
//! über die Routen `/api/einsaetze/{id}/uhs/{uid}/anhaenge…` — Ablegen, Allowlist und Größe,
//! Rechte über das Modul Unfallhilfsstellen, Zugehörigkeit zu Einsatz und UHS, Lebenszyklus,
//! Entfernen, Download mit ETag, pseudonyme ETB-Spur, Live-Verteilung und das Lese-Audit samt
//! Einsicht für die Einsatzleitung.
//!
//! Die Abschottung gegen generische Routen, Chat und ETB steht in `tests/anhang.rs`,
//! `tests/etb_anhang.rs`, `tests/dokument.rs` und `tests/anhang_metadaten.rs` (als ablegende
//! Person, LFH-117 D12); die Scan-Reihenfolge im eigenen Binary `tests/uhs_anhang_scan.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

fn pfad(einsatz: i64, uhs: i64) -> String {
    format!("/api/einsaetze/{einsatz}/uhs/{uhs}/anhaenge")
}

/// Multipart-POST mit beliebig vielen Datei-Feldern `datei` (auch keinem).
async fn ablegen_mehrere(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    cookie: &str,
    dateien: &[(&str, &[u8])],
) -> (StatusCode, Value) {
    let b = "LFHUHSBOUNDARY";
    let mut body = Vec::new();
    // Ein Textfeld ohne Dateinamen wird ignoriert — steht hier, damit „kein Datei-Feld“ nicht
    // mit „leerer Body“ zusammenfällt.
    body.extend_from_slice(
        format!("--{b}\r\nContent-Disposition: form-data; name=\"notiz\"\r\n\r\negal\r\n")
            .as_bytes(),
    );
    for (dateiname, daten) in dateien {
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
                .uri(pfad(einsatz, uhs))
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

async fn ablegen(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    cookie: &str,
    name: &str,
    daten: &[u8],
) -> (StatusCode, Value) {
    ablegen_mehrere(app, einsatz, uhs, cookie, &[(name, daten)]).await
}

/// Legt ab und liefert die Linker-id.
async fn abgelegt(app: &axum::Router, einsatz: i64, uhs: i64, cookie: &str, name: &str) -> i64 {
    let (s, v) = ablegen(app, einsatz, uhs, cookie, name, MINI_JPEG).await;
    assert_eq!(s, StatusCode::CREATED, "Ablage {name}: {v}");
    v["id"].as_i64().unwrap()
}

async fn download(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    id: i64,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .uri(format!("{}/{id}/datei", pfad(einsatz, uhs)))
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

async fn entfernen(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    id: i64,
    cookie: &str,
) -> StatusCode {
    anfrage(
        app,
        "DELETE",
        &format!("{}/{id}", pfad(einsatz, uhs)),
        cookie,
        None,
    )
    .await
    .0
}

async fn liste(app: &axum::Router, einsatz: i64, uhs: i64, cookie: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", &pfad(einsatz, uhs), cookie, None).await
}

/// Legt eine UHS an; die erste eines Einsatzes heißt „BHP 50“, jede weitere zählt hoch
/// (Bezeichnungen sind je Einsatz eindeutig).
async fn uhs_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (_, l) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        None,
    )
    .await;
    let n = l.as_array().map_or(0, Vec::len);
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&format!(
            r#"{{"typ":"behandlungsplatz","bezeichnung":"BHP {}","standort":"Turnhalle Nord"}}"#,
            50 + n
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
    let uhs = uhs_anlegen(&app, &admin, einsatz).await;
    (app, pool, admin, einsatz, uhs)
}

/// (anhang, linker, etb) im Einsatz — jede Abweisung darf keine der drei Zahlen ändern.
async fn stand(pool: &sqlx::SqlitePool, einsatz: i64) -> (i64, i64, i64) {
    let zaehle = |sql: &'static str| async move {
        sqlx::query_scalar::<_, i64>(sql)
            .bind(einsatz)
            .fetch_one(pool)
            .await
            .unwrap()
    };
    (
        zaehle("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?").await,
        zaehle("SELECT COUNT(*) FROM uhs_anhang WHERE einsatz_id = ?").await,
        zaehle("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?").await,
    )
}

/// Inhalte aller ETB-Einträge des Einsatzes (direkt aus der DB, unabhängig von Rechten).
async fn etb_inhalte(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
        .bind(einsatz)
        .fetch_all(pool)
        .await
        .unwrap()
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

async fn override_uhs(app: &axum::Router, admin: &str, einsatz: i64, body: &str) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/unfallhilfsstellen"),
        admin,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override: {v}");
}

async fn einsatz_abschliessen(app: &axum::Router, admin: &str, einsatz: i64) {
    let (s, _) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        admin,
        None,
    )
    .await;
    assert!(s.is_success(), "abschliessen: {s}");
}

// ---------------------------- Ablegen und Liste ----------------------------

#[tokio::test]
async fn foto_ablegen_ist_201_und_steht_in_der_liste() {
    let (app, _pool, admin, einsatz, uhs) = start().await;
    let (s, v) = ablegen(&app, einsatz, uhs, &admin, "liege3.jpg", &[7u8; 2048]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["dateiname"], "liege3.jpg");
    assert_eq!(v["mime"], "image/jpeg");
    assert_eq!(v["groesse"], 2048);
    assert_eq!(v["uhs_id"], uhs);
    assert!(v["abgelegt_von_name"].is_string(), "{v}");
    assert!(v["abgelegt_at"].is_string(), "{v}");
    let obj = v.as_object().unwrap();
    assert!(
        !obj.contains_key("anhang_id"),
        "keine anhang_id auf dem Wire"
    );
    assert!(!obj.contains_key("daten"), "keine Bytes auf dem Wire");

    let (s, l) = liste(&app, einsatz, uhs, &admin).await;
    assert_eq!(s, StatusCode::OK);
    let l = l.as_array().unwrap();
    assert_eq!(l.len(), 1);
    assert_eq!(l[0]["id"], v["id"]);
}

#[tokio::test]
async fn heic_und_pdf_werden_angenommen() {
    let (app, _pool, admin, einsatz, uhs) = start().await;
    let (s, v) = ablegen(&app, einsatz, uhs, &admin, "IMG_0412.HEIC", b"heic").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["mime"], "image/heic");
    let (s, v) = ablegen(&app, einsatz, uhs, &admin, "grundriss_halle.pdf", b"%PDF").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["mime"], "application/pdf");
}

#[tokio::test]
async fn abweisungen_mit_400_speichern_nichts() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let vorher = stand(&pool, einsatz).await;
    let zu_gross = vec![1u8; 25 * 1024 * 1024 + 1];
    let faelle: Vec<(&str, Vec<(&str, &[u8])>)> = vec![
        ("xlsx", vec![("patientenliste.xlsx", b"PK")]),
        // In der Dokumenten-Liste erlaubt, an UHS nicht (LFH-21 design.md D3).
        ("tiff", vec![("scan.tiff", b"II*")]),
        ("gif", vec![("anim.gif", b"GIF89a")]),
        ("leer", vec![("leer.jpg", b"")]),
        ("25 MiB + 1", vec![("gross.jpg", &zu_gross)]),
        ("ohne Datei", vec![]),
        ("zwei Dateien", vec![("a.jpg", b"A"), ("b.jpg", b"B")]),
    ];
    for (fall, dateien) in faelle {
        let (s, v) = ablegen_mehrere(&app, einsatz, uhs, &admin, &dateien).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{fall}: {v}");
        if fall == "xlsx" {
            assert!(
                v["error"].as_str().unwrap().contains("nicht erlaubt"),
                "Meldung nennt den Typ: {v}"
            );
        }
        if fall == "zwei Dateien" {
            assert_eq!(v["error"], "Genau eine Datei je Ablage");
        }
        assert_eq!(
            stand(&pool, einsatz).await,
            vorher,
            "{fall}: nichts gespeichert"
        );
    }
}

/// Code-Review C2: die Datei kommt im Feld `datei` (API-Vertrag, wie die Dokumentenablage).
/// Eine Datei unter einem anderen Feldnamen ist 400 und speichert nichts — sonst nähme die
/// Route still einen Vertrag an, den niemand dokumentiert hat.
#[tokio::test]
async fn datei_unter_fremdem_feldnamen_ist_400() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let vorher = stand(&pool, einsatz).await;
    let b = "LFHUHSFELD";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{b}\r\nContent-Disposition: form-data; name=\"foto\"; filename=\"dach.jpg\"\r\n\
             Content-Type: image/jpeg\r\n\r\nBILD\r\n--{b}--\r\n"
        )
        .as_bytes(),
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(pfad(einsatz, uhs))
                .header(header::COOKIE, admin.as_str())
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
    let v: Value =
        serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(status, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(v["error"], "Die Datei gehört in das Feld „datei“");
    assert_eq!(stand(&pool, einsatz).await, vorher, "nichts gespeichert");
}

// ------------------------------- Rechte -------------------------------

#[tokio::test]
async fn beobachter_liest_und_laedt_herunter_schreibt_aber_nicht() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(liste(&app, einsatz, uhs, &erika).await.0, StatusCode::OK);
    let (s, h, bytes) = download(&app, einsatz, uhs, id, &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, MINI_JPEG);
    assert!(h[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .starts_with("attachment"));
    assert!(h.contains_key(header::ETAG));
    let (s, _) = ablegen(&app, einsatz, uhs, &erika, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &erika).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn gesperrtes_modul_unfallhilfsstellen_ist_403() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    assert_eq!(
        liste(&app, einsatz, uhs, &frieda).await.0,
        StatusCode::OK,
        "Vorbedingung: sichtbar liest sie"
    );
    override_uhs(
        &app,
        &admin,
        einsatz,
        r#"{"sichtbar":false,"benoetigte_rolle":null}"#,
    )
    .await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        liste(&app, einsatz, uhs, &frieda).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        download(&app, einsatz, uhs, id, &frieda, None).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = ablegen(&app, einsatz, uhs, &frieda, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &frieda).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn fremde_organisation_ist_403() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        liste(&app, einsatz, uhs, &fremd).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        download(&app, einsatz, uhs, id, &fremd, None).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = ablegen(&app, einsatz, uhs, &fremd, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &fremd).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        stand(&pool, einsatz).await,
        vorher,
        "nichts gespeichert, kein ETB"
    );
}

#[tokio::test]
async fn abgeschlossener_einsatz_schreibt_409_liest_weiter() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;
    einsatz_abschliessen(&app, &admin, einsatz).await;
    let vorher = stand(&pool, einsatz).await;

    let (s, _) = ablegen(&app, einsatz, uhs, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &admin).await,
        StatusCode::CONFLICT
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
    assert_eq!(liste(&app, einsatz, uhs, &admin).await.0, StatusCode::OK);
    assert_eq!(
        download(&app, einsatz, uhs, id, &admin, None).await.0,
        StatusCode::OK
    );
}

// ------------------------- Zugehörigkeit -------------------------

#[tokio::test]
async fn uhs_eines_fremden_einsatzes_ist_404() {
    let (app, pool, admin, einsatz, _uhs) = start().await;
    let anderer_einsatz = einsatz_anlegen(&app, &admin).await;
    let fremde_uhs = uhs_anlegen(&app, &admin, anderer_einsatz).await;
    let id = abgelegt(&app, anderer_einsatz, fremde_uhs, &admin, "liege3.jpg").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        liste(&app, einsatz, fremde_uhs, &admin).await.0,
        StatusCode::NOT_FOUND
    );
    let (s, _) = ablegen(&app, einsatz, fremde_uhs, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        download(&app, einsatz, fremde_uhs, id, &admin, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        entfernen(&app, einsatz, fremde_uhs, id, &admin).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn anhang_ueber_eine_andere_uhs_ist_404() {
    let (app, pool, admin, einsatz, s1) = start().await;
    let s2 = uhs_anlegen(&app, &admin, einsatz).await;
    let id = abgelegt(&app, einsatz, s1, &admin, "liege3.jpg").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        download(&app, einsatz, s2, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        entfernen(&app, einsatz, s2, id, &admin).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(stand(&pool, einsatz).await, vorher, "nichts geändert");
    assert_eq!(
        liste(&app, einsatz, s1, &admin)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

// ---------------------------- Lebenszyklus ----------------------------

#[tokio::test]
async fn stornierte_uhs_ist_409_beim_schreiben_und_bleibt_lesbar() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;
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

    let (s, _) = ablegen(&app, einsatz, uhs, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &admin).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        stand(&pool, einsatz).await,
        vorher,
        "weder Datei noch Linker noch ETB"
    );
    let (s, l) = liste(&app, einsatz, uhs, &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        l.as_array().unwrap().len(),
        1,
        "der Anhang bleibt in der Liste"
    );
    assert_eq!(
        download(&app, einsatz, uhs, id, &admin, None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn aktive_und_aufgeloeste_uhs_nehmen_dateien_an() {
    let (app, _pool, admin, einsatz, u1) = start().await;
    for status in ["aktiv", "aufgeloest"] {
        let (s, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/uhs/{u1}/status"),
            &admin,
            Some(&format!(r#"{{"status":"{status}"}}"#)),
        )
        .await;
        assert!(s.is_success(), "{status}: {s} {v}");
        abgelegt(&app, einsatz, u1, &admin, &format!("{status}.jpg")).await;
    }
}

// ------------------------------ Entfernen ------------------------------

#[tokio::test]
async fn entfernen_ist_204_danach_weg_und_zweites_entfernen_404() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;

    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &admin).await,
        StatusCode::NO_CONTENT
    );
    let (_, l) = liste(&app, einsatz, uhs, &admin).await;
    assert!(l.as_array().unwrap().is_empty(), "{l}");
    assert_eq!(
        download(&app, einsatz, uhs, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    let nach_erstem = stand(&pool, einsatz).await;
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &admin).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        stand(&pool, einsatz).await,
        nach_erstem,
        "kein zweiter ETB-Eintrag"
    );
    assert_eq!(
        nach_erstem.0, 1,
        "die Datei bleibt gespeichert (Beweissicherung)"
    );
}

#[tokio::test]
async fn download_traegt_anlage_und_etag_und_antwortet_304() {
    let (app, _pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "Halle Süd.jpg").await;
    let (s, h, bytes) = download(&app, einsatz, uhs, id, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, MINI_JPEG);
    let cd = h[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(cd.starts_with("attachment"), "{cd}");
    assert!(cd.contains("filename*=UTF-8''Halle%20S%C3%BCd.jpg"), "{cd}");
    let etag = h[header::ETAG].to_str().unwrap().to_string();

    let (s, _, bytes) = download(&app, einsatz, uhs, id, &admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty(), "304 ohne Inhalt");
}

// --------------------------- ETB-Spur (4.3) ---------------------------

#[tokio::test]
async fn etb_nachweis_nennt_nummer_und_art_nie_den_dateinamen() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let vorher = etb_inhalte(&pool, einsatz).await;
    abgelegt(&app, einsatz, uhs, &admin, "Patient_Mueller_Liege3.jpg").await;

    let nachher = etb_inhalte(&pool, einsatz).await;
    assert_eq!(nachher.len(), vorher.len() + 1, "genau ein neuer Eintrag");
    assert_eq!(nachher.last().unwrap(), "UHS BHP 50: Foto abgelegt");
    let typ: String = sqlx::query_scalar(
        "SELECT typ FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(typ, "system");
    for inhalt in &nachher {
        assert!(
            !inhalt.contains("Mueller")
                && !inhalt.contains("Liege3")
                && !inhalt.contains("Turnhalle"),
            "Dateiname im ETB: {inhalt:?}"
        );
    }
}

#[tokio::test]
async fn etb_nachweis_fuer_pdf_beim_ablegen_und_entfernen() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let (s, v) = ablegen(&app, einsatz, uhs, &admin, "grundriss_halle.pdf", b"%PDF").await;
    assert_eq!(s, StatusCode::CREATED);
    let id = v["id"].as_i64().unwrap();
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &admin).await,
        StatusCode::NO_CONTENT
    );
    let inhalte = etb_inhalte(&pool, einsatz).await;
    let n = inhalte.len();
    assert_eq!(
        inhalte[n - 2..],
        ["UHS BHP 50: PDF abgelegt", "UHS BHP 50: PDF entfernt"]
    );
}

// ------------------------------- Live (4.3) -------------------------------

/// Spec „Live-Verteilung der UHS-Anhänge“: ein Leser mit Modul Unfallhilfsstellen bekommt
/// `uhs` und `etb`, einer ohne kein `uhs`; die Nutzlast trägt nur Kennungen, keinen Dateinamen.
#[tokio::test]
async fn live_uhs_und_etb_ohne_dateinamen_uhs_nur_mit_modulrecht() {
    let (app, _pool, admin, einsatz, uhs) = start().await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    // Nur Führungskräfte der Organisation sehen die UHS.
    override_uhs(
        &app,
        &admin,
        einsatz,
        r#"{"sichtbar":true,"benoetigte_rolle":"fuehrungskraft"}"#,
    )
    .await;
    assert_eq!(
        liste(&app, einsatz, uhs, &frieda).await.0,
        StatusCode::FORBIDDEN,
        "Vorbedingung: Frieda ohne Modulrecht"
    );
    assert_eq!(
        liste(&app, einsatz, uhs, &gustav).await.0,
        StatusCode::OK,
        "Vorbedingung: Gustav mit Modulrecht"
    );

    let feed_gustav = live_oeffnen(&app, &gustav, einsatz).await;
    let feed_frieda = live_oeffnen(&app, &frieda, einsatz).await;
    abgelegt(&app, einsatz, uhs, &admin, "Patient_Mueller_Liege3.jpg").await;

    let bei_gustav = sse_anfang_lesen(feed_gustav.into_body(), 400).await;
    let bei_frieda = sse_anfang_lesen(feed_frieda.into_body(), 400).await;
    assert!(bei_gustav.contains("event: uhs"), "{bei_gustav:?}");
    assert!(bei_gustav.contains("event: etb"), "{bei_gustav:?}");
    assert!(
        bei_frieda.contains("event: etb"),
        "Friedas Feed läuft (sonst bewiese das Fehlen nichts): {bei_frieda:?}"
    );
    assert!(
        !bei_frieda.contains("event: uhs"),
        "ohne Modulrecht kein uhs: {bei_frieda:?}"
    );
    for feed in [&bei_gustav, &bei_frieda] {
        for zeile in feed.lines().filter(|z| z.starts_with("data:")) {
            assert!(
                !zeile.contains("Mueller") && !zeile.contains("Liege3") && !zeile.contains(".jpg"),
                "Dateiname im Broadcast: {zeile:?}"
            );
        }
    }
}

// ------------------------- Lese-Audit (Gruppe 4) -------------------------

/// Protokollzeilen des Einsatzes: (anhang_id, ablage, benutzer, fassung), älteste zuerst.
async fn audit(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<(i64, String, String, String)> {
    sqlx::query_as(
        "SELECT z.anhang_id, z.ablage, b.benutzername, z.fassung FROM anhang_zugriff_audit z \
         JOIN benutzer b ON b.id = z.benutzer_id WHERE z.einsatz_id = ? ORDER BY z.id",
    )
    .bind(einsatz)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn anhang_id_von(pool: &sqlx::SqlitePool, linker: i64) -> i64 {
    sqlx::query_scalar("SELECT anhang_id FROM uhs_anhang WHERE id = ?")
        .bind(linker)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn download_original(
    app: &axum::Router,
    einsatz: i64,
    uhs: i64,
    id: i64,
    cookie: &str,
) -> StatusCode {
    anfrage(
        app,
        "GET",
        &format!("{}/{id}/datei?fassung=original", pfad(einsatz, uhs)),
        cookie,
        None,
    )
    .await
    .0
}

async fn zugriffe(app: &axum::Router, einsatz: i64, uhs: i64, cookie: &str) -> (StatusCode, Value) {
    anfrage(
        app,
        "GET",
        &format!("{}/zugriffe", pfad(einsatz, uhs)),
        cookie,
        None,
    )
    .await
}

#[tokio::test]
async fn download_wird_vor_der_antwort_protokolliert_auch_bei_304() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "grundriss.jpg").await;
    let aid = anhang_id_von(&pool, id).await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    assert!(
        audit(&pool, einsatz).await.is_empty(),
        "Ablegen protokolliert nichts"
    );

    let (s, h, _) = download(&app, einsatz, uhs, id, &frieda, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        audit(&pool, einsatz).await,
        vec![(
            aid,
            "UHS BHP 50".into(),
            "frieda".into(),
            "bereinigt".into()
        )]
    );
    let etag = h[header::ETAG].to_str().unwrap().to_string();
    let (s, _, _) = download(&app, einsatz, uhs, id, &frieda, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert_eq!(
        audit(&pool, einsatz).await.len(),
        2,
        "auch 304 steht im Protokoll"
    );

    assert_eq!(liste(&app, einsatz, uhs, &frieda).await.0, StatusCode::OK);
    assert_eq!(
        audit(&pool, einsatz).await.len(),
        2,
        "die Liste protokolliert nichts"
    );
}

#[tokio::test]
async fn original_abruf_steht_im_protokoll_und_im_etb() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;
    let aid = anhang_id_von(&pool, id).await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;

    assert_eq!(
        download_original(&app, einsatz, uhs, id, &frieda).await,
        StatusCode::FORBIDDEN
    );
    assert!(
        audit(&pool, einsatz).await.is_empty(),
        "abgewiesenes Original: kein Eintrag"
    );

    assert_eq!(
        download_original(&app, einsatz, uhs, id, &admin).await,
        StatusCode::OK
    );
    assert_eq!(
        audit(&pool, einsatz).await,
        vec![(aid, "UHS BHP 50".into(), "admin".into(), "original".into())]
    );
    let vermerk = etb_inhalte(&pool, einsatz).await.pop().unwrap();
    assert!(
        vermerk.contains("Originaldatei") && vermerk.contains("UHS BHP 50"),
        "{vermerk}"
    );
    assert!(
        !vermerk.contains("liege3"),
        "kein Dateiname im Vermerk: {vermerk}"
    );
}

#[tokio::test]
async fn abgewiesene_downloads_protokollieren_nichts() {
    let (app, pool, admin, einsatz, u1) = start().await;
    let u2 = uhs_anlegen(&app, &admin, einsatz).await;
    let id = abgelegt(&app, einsatz, u1, &admin, "plan.jpg").await;
    let entfernt = abgelegt(&app, einsatz, u1, &admin, "alt.jpg").await;
    assert_eq!(
        entfernen(&app, einsatz, u1, entfernt, &admin).await,
        StatusCode::NO_CONTENT
    );
    let aid = anhang_id_von(&pool, id).await;

    // Andere UHS, entfernter Anhang, generischer Pfad: 404.
    assert_eq!(
        download(&app, einsatz, u2, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        download(&app, einsatz, u1, entfernt, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/anhaenge/{aid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "generischer Download");
    // Modul gesperrt: 403.
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    override_uhs(
        &app,
        &admin,
        einsatz,
        r#"{"sichtbar":false,"benoetigte_rolle":null}"#,
    )
    .await;
    assert_eq!(
        download(&app, einsatz, u1, id, &frieda, None).await.0,
        StatusCode::FORBIDDEN
    );
    assert!(audit(&pool, einsatz).await.is_empty());
}

/// Fail-closed: lässt sich die Protokollzeile nicht schreiben, gehen keine Bytes hinaus.
#[tokio::test]
async fn ohne_protokolleintrag_keine_auslieferung() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let id = abgelegt(&app, einsatz, uhs, &admin, "liege3.jpg").await;
    sqlx::query(
        "CREATE TRIGGER audit_gesperrt BEFORE INSERT ON anhang_zugriff_audit \
         BEGIN SELECT RAISE(ABORT, 'gesperrt'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (s, h, bytes) = download(&app, einsatz, uhs, id, &admin, None).await;
    assert!(s.is_server_error(), "{s}");
    assert!(!h.contains_key(header::CONTENT_DISPOSITION));
    assert!(
        !bytes.windows(MINI_JPEG.len()).any(|w| w == MINI_JPEG),
        "keine Dateibytes"
    );
}

#[tokio::test]
async fn einsicht_nur_fuer_die_einsatzleitung_und_selbst_ohne_protokoll() {
    let (app, pool, admin, einsatz, uhs) = start().await;
    let fremde = {
        let anderer = einsatz_anlegen(&app, &admin).await;
        (anderer, uhs_anlegen(&app, &admin, anderer).await)
    };
    let id = abgelegt(&app, einsatz, uhs, &admin, "grundriss_halle.pdf").await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    assert_eq!(
        download(&app, einsatz, uhs, id, &frieda, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        entfernen(&app, einsatz, uhs, id, &admin).await,
        StatusCode::NO_CONTENT
    );

    let (s, v) = zugriffe(&app, einsatz, uhs, &admin).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let z = v.as_array().unwrap();
    assert_eq!(z.len(), 1, "der entfernte Anhang bleibt im Protokoll: {v}");
    assert_eq!(z[0]["anhang_id"], id);
    assert_eq!(z[0]["dateiname"], "grundriss_halle.pdf");
    assert_eq!(z[0]["benutzer_name"], "frieda");
    assert_eq!(z[0]["fassung"], "bereinigt");
    assert!(z[0]["zugriff_at"].is_string());
    assert_eq!(
        audit(&pool, einsatz).await.len(),
        1,
        "die Einsicht protokolliert nichts"
    );

    assert_eq!(
        zugriffe(&app, einsatz, uhs, &frieda).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        zugriffe(&app, einsatz, uhs, &erika).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        zugriffe(&app, einsatz, fremde.1, &admin).await.0,
        StatusCode::NOT_FOUND,
        "UHS eines anderen Einsatzes"
    );
}
