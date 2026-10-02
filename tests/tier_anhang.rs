//! Integrationstests der Tier-Anhänge (LFH-758, Spec `tier-anhaenge`): je Spec-Szenario ein
//! Test über die Routen `/api/einsaetze/{id}/tiere/{tid}/anhaenge…` — Ablegen, Allowlist und
//! Größe, Rechte über das Modul Tiere, Zugehörigkeit zu Einsatz und Tier, Lebenszyklus,
//! Entfernen, Download mit ETag, pseudonyme ETB-Spur und Live-Verteilung.
//!
//! Die Abschottung gegen generische Routen, Chat und ETB steht in `tests/anhang.rs`,
//! `tests/etb_anhang.rs`, `tests/dokument.rs` und `tests/anhang_metadaten.rs` (als ablegende
//! Person, LFH-117 D12); die Scan-Reihenfolge im eigenen Binary `tests/tier_anhang_scan.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

fn pfad(einsatz: i64, tier: i64) -> String {
    format!("/api/einsaetze/{einsatz}/tiere/{tier}/anhaenge")
}

/// Multipart-POST mit beliebig vielen Datei-Feldern `datei` (auch keinem).
async fn ablegen_mehrere(
    app: &axum::Router,
    einsatz: i64,
    tier: i64,
    cookie: &str,
    dateien: &[(&str, &[u8])],
) -> (StatusCode, Value) {
    let b = "LFHTIERBOUNDARY";
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
                .uri(pfad(einsatz, tier))
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
    tier: i64,
    cookie: &str,
    name: &str,
    daten: &[u8],
) -> (StatusCode, Value) {
    ablegen_mehrere(app, einsatz, tier, cookie, &[(name, daten)]).await
}

/// Legt ab und liefert die Linker-id.
async fn abgelegt(app: &axum::Router, einsatz: i64, tier: i64, cookie: &str, name: &str) -> i64 {
    let (s, v) = ablegen(app, einsatz, tier, cookie, name, MINI_JPEG).await;
    assert_eq!(s, StatusCode::CREATED, "Ablage {name}: {v}");
    v["id"].as_i64().unwrap()
}

async fn download(
    app: &axum::Router,
    einsatz: i64,
    tier: i64,
    id: i64,
    cookie: &str,
    if_none_match: Option<&str>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let mut req = Request::builder()
        .uri(format!("{}/{id}/datei", pfad(einsatz, tier)))
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
    tier: i64,
    id: i64,
    cookie: &str,
) -> StatusCode {
    anfrage(
        app,
        "DELETE",
        &format!("{}/{id}", pfad(einsatz, tier)),
        cookie,
        None,
    )
    .await
    .0
}

async fn liste(app: &axum::Router, einsatz: i64, tier: i64, cookie: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", &pfad(einsatz, tier), cookie, None).await
}

async fn tier_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/tiere"),
        cookie,
        Some(r#"{"spezies":"hund","rufname":"Bello","halter_kontakt":"Müller, 0171 1234567"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Tier anlegen: {v}");
    v["id"].as_i64().unwrap()
}

async fn start() -> (axum::Router, sqlx::SqlitePool, String, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let tier = tier_anlegen(&app, &admin, einsatz).await;
    (app, pool, admin, einsatz, tier)
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
        zaehle("SELECT COUNT(*) FROM einsatz_tier_anhang WHERE einsatz_id = ?").await,
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

async fn override_tiere(app: &axum::Router, admin: &str, einsatz: i64, body: &str) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/tiere"),
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
    let (app, _pool, admin, einsatz, tier) = start().await;
    let (s, v) = ablegen(&app, einsatz, tier, &admin, "hund.jpg", &[7u8; 2048]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["dateiname"], "hund.jpg");
    assert_eq!(v["mime"], "image/jpeg");
    assert_eq!(v["groesse"], 2048);
    assert_eq!(v["tier_id"], tier);
    assert!(v["abgelegt_von_name"].is_string(), "{v}");
    assert!(v["abgelegt_at"].is_string(), "{v}");
    let obj = v.as_object().unwrap();
    assert!(
        !obj.contains_key("anhang_id"),
        "keine anhang_id auf dem Wire"
    );
    assert!(!obj.contains_key("daten"), "keine Bytes auf dem Wire");

    let (s, l) = liste(&app, einsatz, tier, &admin).await;
    assert_eq!(s, StatusCode::OK);
    let l = l.as_array().unwrap();
    assert_eq!(l.len(), 1);
    assert_eq!(l[0]["id"], v["id"]);
}

#[tokio::test]
async fn heic_und_pdf_werden_angenommen() {
    let (app, _pool, admin, einsatz, tier) = start().await;
    let (s, v) = ablegen(&app, einsatz, tier, &admin, "IMG_0412.HEIC", b"heic").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["mime"], "image/heic");
    let (s, v) = ablegen(&app, einsatz, tier, &admin, "impfpass.pdf", b"%PDF").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["mime"], "application/pdf");
}

#[tokio::test]
async fn abweisungen_mit_400_speichern_nichts() {
    let (app, pool, admin, einsatz, tier) = start().await;
    let vorher = stand(&pool, einsatz).await;
    let zu_gross = vec![1u8; 25 * 1024 * 1024 + 1];
    let faelle: Vec<(&str, Vec<(&str, &[u8])>)> = vec![
        ("xlsx", vec![("liste.xlsx", b"PK")]),
        // In der Dokumenten-Liste erlaubt, an Tieren nicht (LFH-21 design.md D3).
        ("tiff", vec![("scan.tiff", b"II*")]),
        ("gif", vec![("anim.gif", b"GIF89a")]),
        ("leer", vec![("leer.jpg", b"")]),
        ("25 MiB + 1", vec![("gross.jpg", &zu_gross)]),
        ("ohne Datei", vec![]),
        ("zwei Dateien", vec![("a.jpg", b"A"), ("b.jpg", b"B")]),
    ];
    for (fall, dateien) in faelle {
        let (s, v) = ablegen_mehrere(&app, einsatz, tier, &admin, &dateien).await;
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
    let (app, pool, admin, einsatz, tier) = start().await;
    let vorher = stand(&pool, einsatz).await;
    let b = "LFHTIERFELD";
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
                .uri(pfad(einsatz, tier))
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
    let (app, pool, admin, einsatz, tier) = start().await;
    let id = abgelegt(&app, einsatz, tier, &admin, "hund.jpg").await;
    let erika = mitglied(&app, &admin, einsatz, "erika", "beobachter").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(liste(&app, einsatz, tier, &erika).await.0, StatusCode::OK);
    let (s, h, bytes) = download(&app, einsatz, tier, id, &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, MINI_JPEG);
    assert!(h[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .starts_with("attachment"));
    assert!(h.contains_key(header::ETAG));
    let (s, _) = ablegen(&app, einsatz, tier, &erika, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, tier, id, &erika).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn gesperrtes_modul_tiere_ist_403() {
    let (app, pool, admin, einsatz, tier) = start().await;
    let id = abgelegt(&app, einsatz, tier, &admin, "hund.jpg").await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    assert_eq!(
        liste(&app, einsatz, tier, &frieda).await.0,
        StatusCode::OK,
        "Vorbedingung: sichtbar liest sie"
    );
    override_tiere(
        &app,
        &admin,
        einsatz,
        r#"{"sichtbar":false,"benoetigte_rolle":null}"#,
    )
    .await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        liste(&app, einsatz, tier, &frieda).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        download(&app, einsatz, tier, id, &frieda, None).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = ablegen(&app, einsatz, tier, &frieda, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, tier, id, &frieda).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn fremde_organisation_ist_403() {
    let (app, pool, admin, einsatz, tier) = start().await;
    let id = abgelegt(&app, einsatz, tier, &admin, "hund.jpg").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        liste(&app, einsatz, tier, &fremd).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        download(&app, einsatz, tier, id, &fremd, None).await.0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = ablegen(&app, einsatz, tier, &fremd, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        entfernen(&app, einsatz, tier, id, &fremd).await,
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
    let (app, pool, admin, einsatz, tier) = start().await;
    let id = abgelegt(&app, einsatz, tier, &admin, "hund.jpg").await;
    einsatz_abschliessen(&app, &admin, einsatz).await;
    let vorher = stand(&pool, einsatz).await;

    let (s, _) = ablegen(&app, einsatz, tier, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        entfernen(&app, einsatz, tier, id, &admin).await,
        StatusCode::CONFLICT
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
    assert_eq!(liste(&app, einsatz, tier, &admin).await.0, StatusCode::OK);
    assert_eq!(
        download(&app, einsatz, tier, id, &admin, None).await.0,
        StatusCode::OK
    );
}

// ------------------------- Zugehörigkeit -------------------------

#[tokio::test]
async fn tier_eines_fremden_einsatzes_ist_404() {
    let (app, pool, admin, einsatz, _tier) = start().await;
    let anderer_einsatz = einsatz_anlegen(&app, &admin).await;
    let fremdes_tier = tier_anlegen(&app, &admin, anderer_einsatz).await;
    let id = abgelegt(&app, anderer_einsatz, fremdes_tier, &admin, "hund.jpg").await;
    let vorher = stand(&pool, einsatz).await;

    assert_eq!(
        liste(&app, einsatz, fremdes_tier, &admin).await.0,
        StatusCode::NOT_FOUND
    );
    let (s, _) = ablegen(&app, einsatz, fremdes_tier, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        download(&app, einsatz, fremdes_tier, id, &admin, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        entfernen(&app, einsatz, fremdes_tier, id, &admin).await,
        StatusCode::NOT_FOUND
    );
    assert_eq!(stand(&pool, einsatz).await, vorher);
}

#[tokio::test]
async fn anhang_ueber_ein_anderes_tier_ist_404() {
    let (app, pool, admin, einsatz, s1) = start().await;
    let s2 = tier_anlegen(&app, &admin, einsatz).await;
    let id = abgelegt(&app, einsatz, s1, &admin, "hund.jpg").await;
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
async fn storniertes_tier_ist_409_beim_schreiben_und_bleibt_lesbar() {
    let (app, pool, admin, einsatz, tier) = start().await;
    let id = abgelegt(&app, einsatz, tier, &admin, "hund.jpg").await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/tiere/{tier}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "stornieren");
    let vorher = stand(&pool, einsatz).await;

    let (s, _) = ablegen(&app, einsatz, tier, &admin, "x.jpg", b"x").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        entfernen(&app, einsatz, tier, id, &admin).await,
        StatusCode::CONFLICT
    );
    assert_eq!(
        stand(&pool, einsatz).await,
        vorher,
        "weder Datei noch Linker noch ETB"
    );
    let (s, l) = liste(&app, einsatz, tier, &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        l.as_array().unwrap().len(),
        1,
        "der Anhang bleibt in der Liste"
    );
    assert_eq!(
        download(&app, einsatz, tier, id, &admin, None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn vermisstes_und_abgeschlossenes_tier_nehmen_dateien_an() {
    let (app, _pool, admin, einsatz, t1) = start().await;
    let t2 = tier_anlegen(&app, &admin, einsatz).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/tiere/{t1}/status"),
        &admin,
        Some(r#"{"status":"vermisst"}"#),
    )
    .await;
    assert!(s.is_success(), "vermisst: {s}");
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/tiere/{t2}/status"),
        &admin,
        Some(r#"{"status":"abgeschlossen","abschluss_grund":"uebergabe_tierheim"}"#),
    )
    .await;
    assert!(s.is_success(), "abschließen: {s}");

    abgelegt(&app, einsatz, t1, &admin, "suchfoto.jpg").await;
    abgelegt(&app, einsatz, t2, &admin, "uebergabe_tierheim.jpg").await;
}

// ------------------------------ Entfernen ------------------------------

#[tokio::test]
async fn entfernen_ist_204_danach_weg_und_zweites_entfernen_404() {
    let (app, pool, admin, einsatz, tier) = start().await;
    let id = abgelegt(&app, einsatz, tier, &admin, "hund.jpg").await;

    assert_eq!(
        entfernen(&app, einsatz, tier, id, &admin).await,
        StatusCode::NO_CONTENT
    );
    let (_, l) = liste(&app, einsatz, tier, &admin).await;
    assert!(l.as_array().unwrap().is_empty(), "{l}");
    assert_eq!(
        download(&app, einsatz, tier, id, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    let nach_erstem = stand(&pool, einsatz).await;
    assert_eq!(
        entfernen(&app, einsatz, tier, id, &admin).await,
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
    let (app, _pool, admin, einsatz, tier) = start().await;
    let id = abgelegt(&app, einsatz, tier, &admin, "Hund Süd.jpg").await;
    let (s, h, bytes) = download(&app, einsatz, tier, id, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(bytes, MINI_JPEG);
    let cd = h[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(cd.starts_with("attachment"), "{cd}");
    assert!(cd.contains("filename*=UTF-8''Hund%20S%C3%BCd.jpg"), "{cd}");
    let etag = h[header::ETAG].to_str().unwrap().to_string();

    let (s, _, bytes) = download(&app, einsatz, tier, id, &admin, Some(&etag)).await;
    assert_eq!(s, StatusCode::NOT_MODIFIED);
    assert!(bytes.is_empty(), "304 ohne Inhalt");
}

// --------------------------- ETB-Spur (4.3) ---------------------------

#[tokio::test]
async fn etb_nachweis_nennt_nummer_und_art_nie_den_dateinamen() {
    let (app, pool, admin, einsatz, tier) = start().await;
    let vorher = etb_inhalte(&pool, einsatz).await;
    abgelegt(&app, einsatz, tier, &admin, "Müller_Bello.jpg").await;

    let nachher = etb_inhalte(&pool, einsatz).await;
    assert_eq!(nachher.len(), vorher.len() + 1, "genau ein neuer Eintrag");
    assert_eq!(nachher.last().unwrap(), "Tier T-001: Foto abgelegt");
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
            !inhalt.contains("Müller") && !inhalt.contains("Bello"),
            "Dateiname im ETB: {inhalt:?}"
        );
    }
}

#[tokio::test]
async fn etb_nachweis_fuer_pdf_beim_ablegen_und_entfernen() {
    let (app, pool, admin, einsatz, tier) = start().await;
    let (s, v) = ablegen(&app, einsatz, tier, &admin, "impfpass.pdf", b"%PDF").await;
    assert_eq!(s, StatusCode::CREATED);
    let id = v["id"].as_i64().unwrap();
    assert_eq!(
        entfernen(&app, einsatz, tier, id, &admin).await,
        StatusCode::NO_CONTENT
    );
    let inhalte = etb_inhalte(&pool, einsatz).await;
    let n = inhalte.len();
    assert_eq!(
        inhalte[n - 2..],
        ["Tier T-001: PDF abgelegt", "Tier T-001: PDF entfernt"]
    );
}

// ------------------------------- Live (4.3) -------------------------------

/// Spec „Live-Verteilung der Tier-Anhänge“: ein Leser mit Modul Tiere bekommt `tier` und
/// `etb`, einer ohne kein `tier`; die Nutzlast trägt nur Kennungen, keinen Dateinamen.
#[tokio::test]
async fn live_tier_und_etb_ohne_dateinamen_tier_nur_mit_modulrecht() {
    let (app, _pool, admin, einsatz, tier) = start().await;
    let frieda = mitglied(&app, &admin, einsatz, "frieda", "fuehrungspersonal").await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    // Nur Führungskräfte der Organisation sehen die Tiere.
    override_tiere(
        &app,
        &admin,
        einsatz,
        r#"{"sichtbar":true,"benoetigte_rolle":"fuehrungskraft"}"#,
    )
    .await;
    assert_eq!(
        liste(&app, einsatz, tier, &frieda).await.0,
        StatusCode::FORBIDDEN,
        "Vorbedingung: Frieda ohne Modulrecht"
    );
    assert_eq!(
        liste(&app, einsatz, tier, &gustav).await.0,
        StatusCode::OK,
        "Vorbedingung: Gustav mit Modulrecht"
    );

    let feed_gustav = live_oeffnen(&app, &gustav, einsatz).await;
    let feed_frieda = live_oeffnen(&app, &frieda, einsatz).await;
    abgelegt(&app, einsatz, tier, &admin, "Müller_Bello.jpg").await;

    let bei_gustav = sse_anfang_lesen(feed_gustav.into_body(), 400).await;
    let bei_frieda = sse_anfang_lesen(feed_frieda.into_body(), 400).await;
    assert!(bei_gustav.contains("event: tier"), "{bei_gustav:?}");
    assert!(bei_gustav.contains("event: etb"), "{bei_gustav:?}");
    assert!(
        bei_frieda.contains("event: etb"),
        "Friedas Feed läuft (sonst bewiese das Fehlen nichts): {bei_frieda:?}"
    );
    assert!(
        !bei_frieda.contains("event: tier"),
        "ohne Modulrecht kein tier: {bei_frieda:?}"
    );
    for feed in [&bei_gustav, &bei_frieda] {
        for zeile in feed.lines().filter(|z| z.starts_with("data:")) {
            assert!(
                !zeile.contains("Müller") && !zeile.contains("Bello") && !zeile.contains(".jpg"),
                "Dateiname im Broadcast: {zeile:?}"
            );
        }
    }
}
