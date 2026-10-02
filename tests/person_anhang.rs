//! Integrationstests der Personen-Anhänge (LFH-757): je Spec-Szenario ein Test über die Routen
//! `/api/einsaetze/{id}/personen/{pid}/anhaenge…` — Ablegen, Allowlist und Größe, Rechte über das
//! Modul Personen, Zugehörigkeit zu Einsatz und Person, Lebenszyklus, Entfernen, Download mit
//! ETag, **Lese-Audit je Download**, pseudonyme ETB-Spur und Live-Verteilung.
//!
//! Die Abschottung gegen generische Routen, Chat und ETB steht in `tests/anhang.rs`,
//! `tests/etb_anhang.rs` und `tests/dokument.rs` (als ablegende Person, D12); die
//! Scan-Reihenfolge im eigenen Binary `tests/person_anhang_scan.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

fn pfad(einsatz: i64, person: i64) -> String {
    format!("/api/einsaetze/{einsatz}/personen/{person}/anhaenge")
}

/// Multipart-POST mit beliebig vielen Datei-Feldern `datei` (auch keinem).
async fn ablegen_mehrere(
    app: &axum::Router,
    einsatz: i64,
    person: i64,
    cookie: &str,
    dateien: &[(&str, &[u8])],
) -> (StatusCode, Value) {
    let b = "LFHPERSONBOUNDARY";
    let mut body = Vec::new();
    // Ein Textfeld ohne Dateinamen wird ignoriert — „kein Datei-Feld“ ist so nicht „leerer Body“.
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
                .uri(pfad(einsatz, person))
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
    person: i64,
    cookie: &str,
    name: &str,
    daten: &[u8],
) -> (StatusCode, Value) {
    ablegen_mehrere(app, einsatz, person, cookie, &[(name, daten)]).await
}

/// Legt ein echtes JPEG ab und liefert die Linker-id.
async fn abgelegt(app: &axum::Router, einsatz: i64, person: i64, cookie: &str, name: &str) -> i64 {
    let (s, v) = ablegen(app, einsatz, person, cookie, name, MINI_JPEG).await;
    assert_eq!(s, StatusCode::CREATED, "Ablage {name}: {v}");
    v["id"].as_i64().unwrap()
}

async fn download_mit(
    app: &axum::Router,
    uri: String,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder().uri(uri).header(header::COOKIE, cookie);
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

async fn download(
    app: &axum::Router,
    einsatz: i64,
    person: i64,
    id: i64,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    download_mit(
        app,
        format!("{}/{id}/datei", pfad(einsatz, person)),
        cookie,
        if_none_match,
    )
    .await
}

async fn entfernen(
    app: &axum::Router,
    einsatz: i64,
    person: i64,
    id: i64,
    cookie: &str,
) -> StatusCode {
    anfrage(
        app,
        "DELETE",
        &format!("{}/{id}", pfad(einsatz, person)),
        cookie,
        None,
    )
    .await
    .0
}

async fn liste(app: &axum::Router, einsatz: i64, person: i64, cookie: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", &pfad(einsatz, person), cookie, None).await
}

async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Person anlegen: {v}");
    v["id"].as_i64().unwrap()
}

async fn start() -> (axum::Router, sqlx::SqlitePool, String, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Müller","vorname":"Erika"}"#,
    )
    .await;
    (app, pool, admin, einsatz, person)
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
        zaehle("SELECT COUNT(*) FROM einsatz_person_anhang WHERE einsatz_id = ?").await,
        zaehle("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?").await,
    )
}

/// Alle Zeilen des Zugriffsprotokolls einer Person: `(benutzername, art)`, älteste zuerst.
async fn audit(pool: &sqlx::SqlitePool, person: i64) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT b.benutzername, a.art FROM person_zugriff_audit a \
         JOIN benutzer b ON b.id = a.benutzer_id WHERE a.person_id = ? ORDER BY a.id",
    )
    .bind(person)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn audit_anhang(pool: &sqlx::SqlitePool, person: i64) -> usize {
    audit(pool, person)
        .await
        .into_iter()
        .filter(|(_, art)| art == "anhang")
        .count()
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

async fn override_personen(app: &axum::Router, admin: &str, einsatz: i64, body: &str) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/personen"),
        admin,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override: {v}");
}

async fn stornieren(app: &axum::Router, admin: &str, einsatz: i64, person: i64) {
    let (s, _) = anfrage(
        app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/personen/{person}"),
        admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "stornieren");
}

// ---------------------------- Ablegen und Liste ----------------------------

#[tokio::test]
async fn foto_ablegen_ist_201_und_steht_in_der_liste() {
    let (app, _pool, admin, einsatz, person) = start().await;
    let (s, v) = ablegen(
        &app,
        einsatz,
        person,
        &admin,
        "verletzung.jpg",
        &[7u8; 2048],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["dateiname"], "verletzung.jpg");
    assert_eq!(v["mime"], "image/jpeg");
    assert_eq!(v["groesse"], 2048);
    assert_eq!(v["person_id"], person);
    assert!(v["abgelegt_von_name"].is_string(), "{v}");
    assert!(v["abgelegt_at"].is_string(), "{v}");
    let obj = v.as_object().unwrap();
    assert!(
        !obj.contains_key("anhang_id"),
        "keine anhang_id auf dem Wire"
    );
    assert!(!obj.contains_key("daten"), "keine Bytes auf dem Wire");

    let (s, l) = liste(&app, einsatz, person, &admin).await;
    assert_eq!(s, StatusCode::OK);
    let l = l.as_array().unwrap();
    assert_eq!(l.len(), 1);
    assert_eq!(l[0]["id"], v["id"]);
}

#[tokio::test]
async fn heic_und_pdf_werden_angenommen() {
    let (app, _pool, admin, einsatz, person) = start().await;
    let (s, v) = ablegen(&app, einsatz, person, &admin, "IMG_0412.HEIC", b"heic").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["mime"], "image/heic");
    let (s, v) = ablegen(&app, einsatz, person, &admin, "protokoll.pdf", b"%PDF").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["mime"], "application/pdf");
}

#[tokio::test]
async fn abweisungen_mit_400_speichern_nichts() {
    let (app, pool, admin, einsatz, person) = start().await;
    let vorher = stand(&pool, einsatz).await;
    let zu_gross = vec![1u8; 25 * 1024 * 1024 + 1];
    let faelle: Vec<(&str, Vec<(&str, &[u8])>)> = vec![
        ("xlsx", vec![("liste.xlsx", b"PK")]),
        ("tiff", vec![("scan.tiff", b"II*")]),
        ("leer", vec![("leer.jpg", b"")]),
        ("25 MiB + 1", vec![("gross.jpg", &zu_gross)]),
        ("ohne Datei", vec![]),
        ("zwei Dateien", vec![("a.jpg", b"A"), ("b.jpg", b"B")]),
    ];
    for (fall, dateien) in faelle {
        let (s, v) = ablegen_mehrere(&app, einsatz, person, &admin, &dateien).await;
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

// ------------------------------- Rechte -------------------------------

#[tokio::test]
async fn beobachter_liest_und_laedt_herunter_schreibt_aber_nicht() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(liste(&app, einsatz, person, &erika).await.0, StatusCode::OK);
    let (s, h, bytes) = download(&app, einsatz, person, id, &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, MINI_JPEG);
    assert!(h[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .starts_with("attachment"));
    assert!(h.contains_key(header::ETAG));
    let (s, _) = ablegen(&app, einsatz, person, &erika, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, person, id, &erika).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn gesperrtes_modul_personen_ist_403_ohne_audit() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    assert_eq!(
        liste(&app, einsatz, person, &frieda).await.0,
        StatusCode::OK,
        "Vorbedingung: sichtbar liest sie"
    );
    override_personen(
        &app,
        &admin,
        einsatz,
        r#"{"sichtbar":false,"benoetigte_rolle":null}"#,
    )
    .await;
    let vorher = stand(&pool, einsatz).await;
    let audit_vorher = audit(&pool, person).await;

    assert_eq!(
        liste(&app, einsatz, person, &frieda).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        download(&app, einsatz, person, id, &frieda, None).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = ablegen(&app, einsatz, person, &frieda, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, person, id, &frieda).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
    assert_eq!(
        audit(&pool, person).await,
        audit_vorher,
        "kein Protokolleintrag"
    );
}

#[tokio::test]
async fn fremde_organisation_ist_403() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let vorher = stand(&pool, einsatz).await;
    let audit_vorher = audit(&pool, person).await;

    assert_eq!(
        liste(&app, einsatz, person, &fremd).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        download(&app, einsatz, person, id, &fremd, None).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = ablegen(&app, einsatz, person, &fremd, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, person, id, &fremd).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
    assert_eq!(audit(&pool, person).await, audit_vorher);
}

#[tokio::test]
async fn abgeschlossener_einsatz_schreibt_409_liest_weiter() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "abschliessen: {s}");
    let vorher = stand(&pool, einsatz).await;

    let (s, _) = ablegen(&app, einsatz, person, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        entfernen(&app, einsatz, person, id, &admin).await,
        StatusCode::CONFLICT
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
    assert_eq!(liste(&app, einsatz, person, &admin).await.0, StatusCode::OK);
    assert_eq!(
        download(&app, einsatz, person, id, &admin, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        audit_anhang(&pool, person).await,
        1,
        "auch im Nachlauf wird protokolliert"
    );
}

// ------------------------- Zugehörigkeit -------------------------

#[tokio::test]
async fn person_eines_fremden_einsatzes_ist_404() {
    let (app, pool, admin, einsatz, _person) = start().await;
    let anderer_einsatz = einsatz_anlegen(&app, &admin).await;
    let fremde = person_anlegen(&app, &admin, anderer_einsatz, "{}").await;
    let id = abgelegt(&app, anderer_einsatz, fremde, &admin, "foto.jpg").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        liste(&app, einsatz, fremde, &admin).await.0,
        StatusCode::NOT_FOUND
    );
    let (s, _) = ablegen(&app, einsatz, fremde, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        download(&app, einsatz, fremde, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        entfernen(&app, einsatz, fremde, id, &admin).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
    assert_eq!(
        audit_anhang(&pool, fremde).await,
        0,
        "kein Protokolleintrag"
    );
}

#[tokio::test]
async fn anhang_ueber_eine_andere_person_ist_404_ohne_audit() {
    let (app, pool, admin, einsatz, p1) = start().await;
    let p2 = person_anlegen(&app, &admin, einsatz, "{}").await;
    let id = abgelegt(&app, einsatz, p1, &admin, "verletzung.jpg").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        download(&app, einsatz, p2, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        entfernen(&app, einsatz, p2, id, &admin).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(stand(&pool, einsatz).await, vorher, "nichts geändert");
    assert_eq!(audit_anhang(&pool, p1).await, 0);
    assert_eq!(audit_anhang(&pool, p2).await, 0);
    assert_eq!(
        liste(&app, einsatz, p1, &admin)
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
async fn stornierte_person_ist_409_beim_schreiben_und_bleibt_lesbar() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    stornieren(&app, &admin, einsatz, person).await;
    let vorher = stand(&pool, einsatz).await;

    let (s, _) = ablegen(&app, einsatz, person, &admin, "x.jpg", MINI_JPEG).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        entfernen(&app, einsatz, person, id, &admin).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        stand(&pool, einsatz).await,
        vorher,
        "weder Datei noch Linker noch ETB"
    );
    let (s, l) = liste(&app, einsatz, person, &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        l.as_array().unwrap().len(),
        1,
        "der Anhang bleibt in der Liste"
    );
    assert_eq!(
        download(&app, einsatz, person, id, &admin, None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn vermisste_person_nimmt_ein_foto_an() {
    let (app, _pool, admin, einsatz, _person) = start().await;
    let vermisst = person_anlegen(&app, &admin, einsatz, r#"{"status":"vermisst"}"#).await;
    abgelegt(&app, einsatz, vermisst, &admin, "identifikation.jpg").await;
}

// ------------------------------ Entfernen ------------------------------

#[tokio::test]
async fn entfernen_ist_204_danach_weg_und_zweites_entfernen_404() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;

    assert_eq!(
        entfernen(&app, einsatz, person, id, &admin).await,
        StatusCode::NO_CONTENT
    );
    let (_, l) = liste(&app, einsatz, person, &admin).await;
    assert!(l.as_array().unwrap().is_empty(), "{l}");
    assert_eq!(
        download(&app, einsatz, person, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        audit_anhang(&pool, person).await,
        0,
        "404 protokolliert nicht"
    );
    let nach_erstem = stand(&pool, einsatz).await;
    assert_eq!(
        entfernen(&app, einsatz, person, id, &admin).await,
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
    let (app, _pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "Arm links.jpg").await;
    let (s, h, bytes) = download(&app, einsatz, person, id, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, MINI_JPEG);
    let cd = h[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(cd.starts_with("attachment"), "{cd}");
    assert!(cd.contains("filename*=UTF-8''Arm%20links.jpg"), "{cd}");
    let etag = h[header::ETAG].to_str().unwrap().to_string();

    let (s, _, bytes) = download(&app, einsatz, person, id, &admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty(), "304 ohne Inhalt");
}

// --------------------------- Lese-Audit (3.3) ---------------------------

#[tokio::test]
async fn jeder_download_schreibt_eine_zeile_anhang_auch_304() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    assert_eq!(
        audit_anhang(&pool, person).await,
        0,
        "Ablegen protokolliert nicht"
    );

    let (s, h, _) = download(&app, einsatz, person, id, &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        audit(&pool, person).await.last().unwrap(),
        &("erika".to_string(), "anhang".to_string()),
        "die abrufende Person steht im Protokoll"
    );
    let etag = h[header::ETAG].to_str().unwrap().to_string();
    let (s, _, _) = download(&app, einsatz, person, id, &erika, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert_eq!(
        audit_anhang(&pool, person).await,
        2,
        "auch der Abruf aus dem Browser-Cache ist ein Zugriff"
    );
}

// LFH-757 × LFH-759: die Vorschau-Fassungen laufen über dieselbe Route und dieselbe Reihenfolge
// (Audit vor `anhang_antwort`) — auch ein Vorschaubild zeigt die Person, also ist es ein Zugriff.
// Die Personen-Detailseite fordert keins an (`ErfassungsAnhaenge`, `vorschau={false}`).
#[tokio::test]
async fn vorschau_fassungen_sind_ebenfalls_protokollierte_zugriffe() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    let basis = format!("{}/{id}/datei", pfad(einsatz, person));
    for (n, fassung) in [(1, "vorschau"), (2, "grossansicht")] {
        let (s, _, _) =
            download_mit(&app, format!("{basis}?fassung={fassung}"), &admin, None).await;
        assert_ne!(
            s,
            StatusCode::BAD_REQUEST,
            "{fassung} ist eine bekannte Fassung"
        );
        assert_eq!(
            audit_anhang(&pool, person).await,
            n,
            "{fassung} schreibt eine Zeile"
        );
    }
}

#[tokio::test]
async fn liste_schreibt_keinen_protokolleintrag() {
    let (app, pool, admin, einsatz, person) = start().await;
    abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    let vorher = audit(&pool, person).await;
    for _ in 0..3 {
        assert_eq!(liste(&app, einsatz, person, &admin).await.0, StatusCode::OK);
    }
    assert_eq!(audit(&pool, person).await, vorher);
}

#[tokio::test]
async fn original_durch_einsatzleitung_protokolliert_und_vermerkt() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "Erika_Mueller.jpg").await;
    let (s, h, bytes) = download_mit(
        &app,
        format!("{}/{id}/datei?fassung=original", pfad(einsatz, person)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, MINI_JPEG, "das Original bytegleich");
    assert!(!h.contains_key(header::ETAG));
    assert_eq!(audit_anhang(&pool, person).await, 1);
    let vermerk = etb_inhalte(&pool, einsatz).await.pop().unwrap();
    assert!(
        vermerk.contains("Originaldatei") && vermerk.contains("Person R-001"),
        "{vermerk}"
    );
    assert!(
        !vermerk.contains("Erika") && !vermerk.contains("Mueller"),
        "{vermerk}"
    );
}

#[tokio::test]
async fn abgewiesene_downloads_schreiben_keinen_protokolleintrag() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    let etb_vorher = etb_inhalte(&pool, einsatz).await.len();

    // 403: Original ohne Leitung — auch kein ETB-Vermerk.
    let (s, _, _) = download_mit(
        &app,
        format!("{}/{id}/datei?fassung=original", pfad(einsatz, person)),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    // 400: unbekannte Fassung.
    let (s, _, _) = download_mit(
        &app,
        format!("{}/{id}/datei?fassung=roh", pfad(einsatz, person)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // 404: entfernt.
    assert_eq!(
        entfernen(&app, einsatz, person, id, &admin).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        download(&app, einsatz, person, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );

    assert_eq!(audit_anhang(&pool, person).await, 0);
    assert_eq!(
        etb_inhalte(&pool, einsatz).await.len(),
        etb_vorher + 1,
        "nur der Entfernen-Nachweis, kein Original-Vermerk"
    );
}

/// Spec: „Kann der Eintrag nicht geschrieben werden, MUST das System nichts ausliefern.“ Ein
/// Trigger lässt jedes INSERT der Art `anhang` scheitern.
#[tokio::test]
async fn ohne_protokolleintrag_keine_auslieferung() {
    let (app, pool, admin, einsatz, person) = start().await;
    let id = abgelegt(&app, einsatz, person, &admin, "verletzung.jpg").await;
    sqlx::query(
        "CREATE TRIGGER audit_kaputt BEFORE INSERT ON person_zugriff_audit \
         WHEN NEW.art = 'anhang' BEGIN SELECT RAISE(ABORT, 'audit kaputt'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (s, h, bytes) = download(&app, einsatz, person, id, &admin, None).await;
    assert!(s.is_server_error(), "{s}");
    assert!(!h.contains_key(header::CONTENT_DISPOSITION));
    assert!(
        !bytes.windows(9).any(|w| w == b"JPEGDATEN"),
        "keine Dateibytes ohne Protokolleintrag"
    );
}

// --------------------------- ETB-Spur (3.4) ---------------------------

#[tokio::test]
async fn etb_nachweis_nennt_nummer_und_art_nie_namen_oder_dateinamen() {
    let (app, pool, admin, einsatz, person) = start().await;
    let vorher = etb_inhalte(&pool, einsatz).await;
    abgelegt(&app, einsatz, person, &admin, "Erika_Mueller_Ausweis.jpg").await;

    let nachher = etb_inhalte(&pool, einsatz).await;
    assert_eq!(nachher.len(), vorher.len() + 1, "genau ein neuer Eintrag");
    assert_eq!(nachher.last().unwrap(), "Person R-001: Foto abgelegt");
    let typ: String = sqlx::query_scalar(
        "SELECT typ FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(typ, "system");
    for inhalt in &nachher {
        for wort in ["Müller", "Mueller", "Erika", "Ausweis"] {
            assert!(!inhalt.contains(wort), "{wort} im ETB: {inhalt:?}");
        }
    }
}

#[tokio::test]
async fn etb_nachweis_fuer_pdf_beim_ablegen_und_entfernen() {
    let (app, pool, admin, einsatz, person) = start().await;
    let (s, v) = ablegen(&app, einsatz, person, &admin, "protokoll.pdf", b"%PDF").await;
    assert_eq!(s, StatusCode::CREATED);
    let id = v["id"].as_i64().unwrap();
    assert_eq!(
        entfernen(&app, einsatz, person, id, &admin).await,
        StatusCode::NO_CONTENT
    );
    let inhalte = etb_inhalte(&pool, einsatz).await;
    let n = inhalte.len();
    assert_eq!(
        inhalte[n - 2..],
        ["Person R-001: PDF abgelegt", "Person R-001: PDF entfernt"]
    );
}

#[tokio::test]
async fn abweisungen_schreiben_keinen_etb_eintrag() {
    let (app, pool, admin, einsatz, person) = start().await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    let andere = einsatz_anlegen(&app, &admin).await;
    let vorher = etb_inhalte(&pool, einsatz).await.len();
    assert_eq!(
        ablegen(&app, einsatz, person, &admin, "liste.xlsx", b"PK")
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        ablegen(&app, einsatz, person, &erika, "x.jpg", MINI_JPEG)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        ablegen(&app, andere, person, &admin, "x.jpg", MINI_JPEG)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    stornieren(&app, &admin, einsatz, person).await;
    let nach_storno = etb_inhalte(&pool, einsatz).await.len();
    assert_eq!(nach_storno, vorher + 1, "nur der Storno-Eintrag");
    assert_eq!(
        ablegen(&app, einsatz, person, &admin, "x.jpg", MINI_JPEG)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(etb_inhalte(&pool, einsatz).await.len(), nach_storno);
}

// ------------------------------- Live (3.4) -------------------------------

/// Spec „Live-Verteilung“: ein Leser mit Modul Personen bekommt `person` und `etb`, einer ohne
/// kein `person`; die Nutzlast trägt nur Kennungen, keinen Dateinamen.
#[tokio::test]
async fn live_person_und_etb_ohne_dateinamen_person_nur_mit_modulrecht() {
    let (app, _pool, admin, einsatz, person) = start().await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    override_personen(
        &app,
        &admin,
        einsatz,
        r#"{"sichtbar":true,"benoetigte_rolle":"fuehrungskraft"}"#,
    )
    .await;
    assert_eq!(
        liste(&app, einsatz, person, &frieda).await.0,
        StatusCode::FORBIDDEN,
        "Vorbedingung: Frieda ohne Modulrecht"
    );
    assert_eq!(
        liste(&app, einsatz, person, &gustav).await.0,
        StatusCode::OK,
        "Vorbedingung: Gustav mit Modulrecht"
    );

    let feed_gustav = live_oeffnen(&app, &gustav, einsatz).await;
    let feed_frieda = live_oeffnen(&app, &frieda, einsatz).await;
    abgelegt(&app, einsatz, person, &admin, "Erika_Mueller.jpg").await;

    let bei_gustav = sse_anfang_lesen(feed_gustav.into_body(), 400).await;
    let bei_frieda = sse_anfang_lesen(feed_frieda.into_body(), 400).await;
    assert!(bei_gustav.contains("event: person"), "{bei_gustav:?}");
    assert!(bei_gustav.contains("event: etb"), "{bei_gustav:?}");
    assert!(
        bei_frieda.contains("event: etb"),
        "Friedas Feed läuft (sonst bewiese das Fehlen nichts): {bei_frieda:?}"
    );
    assert!(
        !bei_frieda.contains("event: person"),
        "ohne Modulrecht kein person: {bei_frieda:?}"
    );
    for feed in [&bei_gustav, &bei_frieda] {
        for zeile in feed.lines().filter(|z| z.starts_with("data:")) {
            assert!(
                !zeile.contains("Erika") && !zeile.contains("Mueller") && !zeile.contains(".jpg"),
                "Dateiname im Broadcast: {zeile:?}"
            );
        }
    }
}
