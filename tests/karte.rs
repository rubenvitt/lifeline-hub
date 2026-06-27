use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use axum::response::Response;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::live::LiveHub;
use std::io::Write;
use tower::ServiceExt; // oneshot

async fn pool() -> sqlx::SqlitePool {
    // db::test_pool() liefert einen bereits migrierten Test-Pool (wie alle tests/*.rs).
    lifeline_hub::db::test_pool().await
}

/// Baut den Router um einen vorhandenen Pool. `karten_dir` ist für die hier getesteten Pfade
/// belanglos (Tiles nutzen absolute Pfade bzw. den Traversal-Guard) → Wegwerf-Tempverzeichnis.
fn app_mit_pool(pool: sqlx::SqlitePool) -> axum::Router {
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_dir: std::env::temp_dir(),
    })
}

/// Bootstrappt eine Org + Admin und liefert (Router, Admin-Session-Cookie).
async fn admin_app() -> (axum::Router, String) {
    let pool = pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let app = app_mit_pool(pool);
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    (app, cookie)
}

/// Loggt sich ein und liefert das `name=value`-Cookie-Paar (wie tests/benutzer.rs).
async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "Login im Test muss klappen");
    resp.headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

/// Schickt eine Anfrage; `cookie`/`body` optional (JSON-Body setzt Content-Type).
async fn anfrage(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<&str>,
) -> Response {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        builder = builder.header(header::COOKIE, c);
    }
    let rumpf = match body {
        Some(j) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(j.to_string())
        }
        None => Body::empty(),
    };
    app.clone().oneshot(builder.body(rumpf).unwrap()).await.unwrap()
}

async fn json(res: Response) -> serde_json::Value {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

// ===== /api/karte/tiles.pmtiles + /api/karte/config (eingefrorener Frontend-Vertrag) =====

#[tokio::test]
async fn tiles_route_liefert_range_aus() {
    let pool = pool().await;
    // Karte liegt im verwalteten karten_dir; in der DB steht der RELATIVE Dateiname.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("de.pmtiles"), b"PMTILESDATA0123456789").unwrap();
    sqlx::query(
        "INSERT INTO karte_offline_karte (name, pfad, status, aktiv_basemap) \
         VALUES ('DE', 'de.pmtiles', 'bereit', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(), download_client: lifeline_hub::karte::download::download_client(), download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_dir: dir.path().to_path_buf(),
    });
    let req = Request::builder()
        .uri("/api/karte/tiles.pmtiles")
        .header("Range", "bytes=0-7")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT); // 206
    let bytes = axum::body::to_bytes(res.into_body(), 1024).await.unwrap();
    assert_eq!(&bytes[..], b"PMTILESD");
}

#[tokio::test]
async fn tiles_route_404_ohne_konfigurierten_pfad() {
    let pool = pool().await; // leere offline-Tabelle
    let app = app_mit_pool(pool);
    let req = Request::builder()
        .uri("/api/karte/tiles.pmtiles")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn config_endpoint_meldet_verfuegbarkeit() {
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO karte_online_quelle (name, url, typ, attribution, sortier, aktiv) \
         VALUES (?, ?, 'vektor', ?, 0, 1)",
    )
    .bind("Online")
    .bind("https://tiles.example/style.json")
    .bind("© Test")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO karte_offline_karte (name, pfad, status, aktiv_basemap) \
         VALUES ('DE', '/irrelevant.pmtiles', 'bereit', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app = app_mit_pool(pool);
    let req = Request::builder().uri("/api/karte/config").body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(true));
    // pmtiles_url trägt jetzt einen Cache-Bust-Token (?v=<sha256|geaendert_at>), damit die
    // pmtiles-Lib bei Karten-Wechsel nicht den alten Archiv-Aufbau unter gleicher URL cacht
    // (LFH-181). Token ist dynamisch → Präfix prüfen.
    let pmtiles_url = v["pmtiles_url"].as_str().unwrap();
    assert!(
        pmtiles_url.starts_with("/api/karte/tiles.pmtiles?v="),
        "pmtiles_url mit Cache-Bust-Token erwartet, war: {pmtiles_url}"
    );
    assert_eq!(v["online_styles"][0]["url"].as_str(), Some("https://tiles.example/style.json"));
    assert_eq!(v["online_styles"][0]["typ"].as_str(), Some("vektor"));
}

#[tokio::test]
async fn config_endpoint_blind_modus_ohne_konfiguration() {
    let pool = pool().await; // leere Registry → Karte startet blind
    let app = app_mit_pool(pool);
    let req = Request::builder().uri("/api/karte/config").body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(false));
    assert!(v["pmtiles_url"].is_null());
    assert!(v["online_styles"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn offline_registrieren_lehnt_absolute_und_traversal_pfade_ab() {
    // Pfade müssen relativ zum verwalteten karten_dir sein. Absolute/Traversal-Pfade würden über
    // den UNAUTHENTIFIZIERTEN Tile-Endpunkt beliebige Server-Dateien exponieren → schon bei der
    // Registrierung ablehnen (Primärschutz).
    let (app, cookie) = admin_app().await;
    for boese in [
        r#"{"name":"Abs","pfad":"/etc/passwd"}"#,
        r#"{"name":"Trav","pfad":"../geheim.pmtiles"}"#,
    ] {
        let res = anfrage(&app, "POST", "/api/karte/offline-karten", Some(&cookie), Some(boese)).await;
        assert_eq!(
            res.status(),
            StatusCode::BAD_REQUEST,
            "böser Pfad bei Registrierung abgelehnt: {boese}"
        );
    }
}

#[tokio::test]
async fn tiles_route_lehnt_absoluten_pfad_in_db_ab() {
    // Defense-in-Depth: selbst wenn ein absoluter Pfad direkt in der DB landet (Umgehung der
    // Handler-Validierung), liefert tiles() ihn NICHT über den unauthentifizierten Endpunkt aus.
    let pool = pool().await;
    let mut datei = tempfile::NamedTempFile::new().unwrap();
    datei.write_all(b"GEHEIM").unwrap();
    let abs = datei.path().to_string_lossy().to_string();
    sqlx::query(
        "INSERT INTO karte_offline_karte (name, pfad, status, aktiv_basemap) \
         VALUES (?, ?, 'bereit', 1)",
    )
    .bind("Boese")
    .bind(&abs)
    .execute(&pool)
    .await
    .unwrap();
    let app = app_mit_pool(pool);
    let res = anfrage(&app, "GET", "/api/karte/tiles.pmtiles", None, None).await;
    assert_eq!(
        res.status(),
        StatusCode::NOT_FOUND,
        "absoluter Pfad wird nicht ausgeliefert"
    );
    drop(datei);
}

// ===== /api/karte/fachebenen =====

#[tokio::test]
async fn fachebenen_unbekannte_quelle_ist_400() {
    let app = app_mit_pool(pool().await);
    let res = anfrage(&app, "GET", "/api/karte/fachebenen/gibtsnicht", None, None).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fachebenen_kritis_ohne_bbox_ist_400() {
    let app = app_mit_pool(pool().await);
    let res = anfrage(&app, "GET", "/api/karte/fachebenen/kritis", None, None).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ===== Admin-CRUD: Online-Quellen =====

#[tokio::test]
async fn online_crud_durchlauf() {
    let (app, cookie) = admin_app().await;

    // Anlegen → 201.
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"OFM","url":"https://tiles.example/liberty","typ":"vektor","attribution":"© OSM","sortier":3}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let angelegt = json(res).await;
    let id = angelegt["id"].as_i64().unwrap();
    assert_eq!(angelegt["name"], "OFM");
    assert_eq!(angelegt["sortier"], 3);
    assert_eq!(angelegt["aktiv"], true);

    // Liste → 200, enthält die Quelle.
    let res = anfrage(&app, "GET", "/api/karte/online-quellen", Some(&cookie), None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let liste = json(res).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);

    // Vollersatz-PATCH → 200.
    let res = anfrage(
        &app,
        "PATCH",
        &format!("/api/karte/online-quellen/{id}"),
        Some(&cookie),
        Some(r#"{"name":"Neu","url":"https://x/neu","typ":"raster","attribution":"© BKG","sortier":1,"aktiv":false}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let akt = json(res).await;
    assert_eq!(akt["name"], "Neu");
    assert_eq!(akt["typ"], "raster");
    assert_eq!(akt["aktiv"], false);

    // Löschen → 204, danach leer.
    let res = anfrage(
        &app,
        "DELETE",
        &format!("/api/karte/online-quellen/{id}"),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let res = anfrage(&app, "GET", "/api/karte/online-quellen", Some(&cookie), None).await;
    assert!(json(res).await.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn online_anlegen_ohne_attribution_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"X","url":"https://x","typ":"vektor"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST, "Attribution ist Pflicht");
}

#[tokio::test]
async fn online_anlegen_ungueltiger_typ_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"X","url":"https://x","typ":"wolke","attribution":"© X"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn online_anlegen_leerer_name_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"   ","url":"https://x","typ":"vektor","attribution":"© X"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn online_anlegen_whitespace_attribution_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"X","url":"https://x","typ":"vektor","attribution":"   "}"#),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "whitespace-only Attribution verletzt die Pflicht"
    );
}

#[tokio::test]
async fn online_anlegen_leere_url_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"X","url":"   ","typ":"vektor","attribution":"© X"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn online_aktualisieren_unbekannt_ist_404() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "PATCH",
        "/api/karte/online-quellen/999",
        Some(&cookie),
        Some(r#"{"name":"X","url":"https://x","typ":"vektor","attribution":"© X"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn online_loeschen_unbekannt_ist_404() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(&app, "DELETE", "/api/karte/online-quellen/999", Some(&cookie), None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn online_katalog_liefert_eintraege() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(&app, "GET", "/api/karte/online-quellen/katalog", Some(&cookie), None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    let liste = v.as_array().unwrap();
    assert!(!liste.is_empty(), "Katalog liefert Vorschläge");
    assert!(liste[0]["url"].is_string());
}

// ===== Admin-CRUD: Offline-Karten =====

#[tokio::test]
async fn offline_registrieren_aktivieren_loeschen() {
    let (app, cookie) = admin_app().await;

    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(r#"{"name":"DE","pfad":"de.pmtiles","lizenz":"© OpenStreetMap contributors (ODbL)"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let k = json(res).await;
    let id = k["id"].as_i64().unwrap();
    assert_eq!(k["status"], "bereit");
    assert_eq!(k["aktiv_basemap"], false);
    assert_eq!(k["kachel_schema"], "protomaps"); // Default

    let res = anfrage(
        &app,
        "POST",
        &format!("/api/karte/offline-karten/{id}/aktivieren"),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(json(res).await["aktiv_basemap"], true);

    let res = anfrage(&app, "GET", "/api/karte/offline-karten", Some(&cookie), None).await;
    assert_eq!(json(res).await.as_array().unwrap().len(), 1);

    let res = anfrage(
        &app,
        "DELETE",
        &format!("/api/karte/offline-karten/{id}"),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn offline_registrieren_ohne_pfad_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(r#"{"name":"DE","pfad":"  "}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn offline_registrieren_ohne_lizenz_ist_400() {
    // Attribution ist Pflicht (offline sichtbar) — Parität zu Download/Online-Quelle.
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(r#"{"name":"DE","pfad":"de.pmtiles"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn offline_aktivieren_unbekannt_ist_404() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(&app, "POST", "/api/karte/offline-karten/999/aktivieren", Some(&cookie), None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn offline_loeschen_unbekannt_ist_404() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(&app, "DELETE", "/api/karte/offline-karten/999", Some(&cookie), None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

// ===== Offline-Download-Manager (LFH-181) =====

#[tokio::test]
async fn offline_katalog_liefert_kuratierte_liste() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/offline-karten/katalog",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    let liste = v.as_array().expect("Array");
    assert_eq!(liste.len(), 18, "16 Bundesländer + AT + CH");
    // Statische /katalog-Route gewinnt gegen /{id} (matchit-Priorität).
    assert!(liste[0]["url"].as_str().unwrap().starts_with("https://"));
    assert!(!liste[0]["lizenz"].as_str().unwrap().is_empty());
    assert_eq!(liste[0]["kachel_schema"].as_str(), Some("protomaps"));
}

#[tokio::test]
async fn offline_katalog_ohne_session_ist_401() {
    let app = app_mit_pool(pool().await);
    let res = anfrage(&app, "GET", "/api/karte/offline-karten/katalog", None, None).await;
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn offline_download_ohne_lizenz_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten/download",
        Some(&cookie),
        Some(r#"{"name":"DE","url":"https://example.test/de.pmtiles","lizenz":"  "}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST, "Attribution ist Pflicht");
}

#[tokio::test]
async fn offline_download_interne_url_ist_400_ssrf() {
    let (app, cookie) = admin_app().await;
    // SSRF-Guard: interne IP / http müssen abgelehnt werden (kein Server-seitiger Fetch darauf).
    for url in [
        "http://example.test/de.pmtiles",       // kein https
        "https://169.254.169.254/latest/meta",  // Cloud-Metadaten
        "https://127.0.0.1/de.pmtiles",          // Loopback
        "https://192.168.1.1/de.pmtiles",        // privates Netz
    ] {
        let body = format!(r#"{{"name":"X","url":"{url}","lizenz":"© OSM"}}"#);
        let res = anfrage(
            &app,
            "POST",
            "/api/karte/offline-karten/download",
            Some(&cookie),
            Some(&body),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "abgelehnt: {url}");
    }
}

#[tokio::test]
async fn offline_abbrechen_ohne_laufenden_download_ist_404() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten/999/abbrechen",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn offline_liste_meldet_update_wenn_katalog_neuere_quelle_fuehrt() {
    let (app, cookie) = admin_app().await;
    // Installiert mit ALTER Quell-URL (anderes Datum), Name = Katalog-Name → Katalog ist neuer.
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(
            r#"{"name":"Deutschland – Bremen","pfad":"bremen.pmtiles","lizenz":"© OSM",
                "quell_url":"https://github.com/whitespring/project-nomad-maps-europe/releases/download/v1/de_bremen_20250101.pmtiles"}"#,
        ),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);

    let liste = json(anfrage(&app, "GET", "/api/karte/offline-karten", Some(&cookie), None).await).await;
    let eintrag = &liste.as_array().unwrap()[0];
    assert_eq!(eintrag["update_verfuegbar"], true);
    assert!(
        eintrag["katalog_url"].as_str().unwrap().contains("de_bremen_20260320"),
        "Katalog-URL zeigt auf den neueren Stand"
    );
}

#[tokio::test]
async fn offline_liste_kein_update_bei_aktueller_katalog_quelle() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(
            r#"{"name":"Deutschland – Bremen","pfad":"bremen.pmtiles","lizenz":"© OSM",
                "quell_url":"https://github.com/whitespring/project-nomad-maps-europe/releases/download/v1/de_bremen_20260320.pmtiles"}"#,
        ),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);

    let liste = json(anfrage(&app, "GET", "/api/karte/offline-karten", Some(&cookie), None).await).await;
    let eintrag = &liste.as_array().unwrap()[0];
    assert_eq!(eintrag["update_verfuegbar"], false);
    assert!(eintrag["katalog_url"].is_null());
}

// ===== AdminUser-Gate =====

#[tokio::test]
async fn online_quellen_ohne_session_ist_401() {
    let app = app_mit_pool(pool().await);
    let res = anfrage(&app, "GET", "/api/karte/online-quellen", None, None).await;
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn online_quellen_als_fuehrungskraft_read_only() {
    let (app, admin_cookie) = admin_app().await;
    // Admin legt eine Führungskraft an.
    let res = anfrage(
        &app,
        "POST",
        "/api/benutzer",
        Some(&admin_cookie),
        Some(r#"{"anzeigename":"Frieda","benutzername":"frieda","passwort":"friedapw1","org_rolle":"fuehrungskraft"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    // Lesen erlaubt (read-only-Einblick, Muster GlobalEinstellungen/org_einstellungen).
    let res = anfrage(&app, "GET", "/api/karte/online-quellen", Some(&frieda), None).await;
    assert_eq!(res.status(), StatusCode::OK, "Führungskraft darf die Liste lesen");

    // Schreiben bleibt verboten (nur system-admin).
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&frieda),
        Some(r#"{"name":"X","url":"https://x","typ":"vektor","attribution":"© X"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::FORBIDDEN, "Führungskraft darf nicht schreiben");
}

// ===== Proxy-Quellen-Validierung (LFH-182) =====

#[tokio::test]
async fn online_anlegen_proxy_interne_url_ist_400_ssrf() {
    let (app, cookie) = admin_app().await;
    // proxy=1 → Server holt selbst → SSRF-Vorabprüfung: kein http, keine internen Ziele.
    for url in [
        "http://example.test/style.json",
        "https://10.0.0.5/style.json?key=K",
        "https://169.254.169.254/style.json",
        "https://127.0.0.1/style.json",
    ] {
        let body =
            format!(r#"{{"name":"P","url":"{url}","typ":"vektor","attribution":"© X","proxy":true}}"#);
        let res = anfrage(&app, "POST", "/api/karte/online-quellen", Some(&cookie), Some(&body)).await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "proxy+intern abgelehnt: {url}");
    }
}

#[tokio::test]
async fn online_anlegen_proxy_gueltig_ist_201_mit_proxy_true() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"MapTiler","url":"https://api.maptiler.com/maps/streets/style.json?key=GEHEIM","typ":"vektor","attribution":"© MapTiler","proxy":true}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    assert_eq!(json(res).await["proxy"], true);
}

#[tokio::test]
async fn online_anlegen_default_proxy_false() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"OFM","url":"https://tiles.example/liberty","typ":"vektor","attribution":"© OSM"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    assert_eq!(json(res).await["proxy"], false, "Default ohne proxy-Feld");
}

#[tokio::test]
async fn online_anlegen_proxy_unbekannter_platzhalter_ist_400() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&cookie),
        Some(r#"{"name":"R","url":"https://h/{z}/{quadkey}.png","typ":"raster","attribution":"© X","proxy":true}"#),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "unbekannter Platzhalter {{quadkey}} fail-fast"
    );
}

#[tokio::test]
async fn config_proxy_quelle_gibt_relative_url_und_verbirgt_key() {
    let pool = pool().await;
    // proxy=1 Vektor (Key in url), proxy=1 Raster, proxy=0 direkt — frischer Pool → ids 1,2,3.
    sqlx::query("INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv,proxy) VALUES (?,?,?,?,?,?,?)")
        .bind("MapTiler").bind("https://api.maptiler.com/maps/streets/style.json?key=GEHEIM")
        .bind("vektor").bind("© MapTiler").bind(0).bind(1).bind(1)
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv,proxy) VALUES (?,?,?,?,?,?,?)")
        .bind("Stadia").bind("https://tiles.stadiamaps.com/{z}/{x}/{y}.png?api_key=GEHEIM2")
        .bind("raster").bind("© Stadia").bind(1).bind(1).bind(1)
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv,proxy) VALUES (?,?,?,?,?,?,?)")
        .bind("OFM").bind("https://tiles.example/liberty").bind("vektor").bind("© OSM").bind(2).bind(1).bind(0)
        .execute(&pool).await.unwrap();

    let app = app_mit_pool(pool);
    let res = anfrage(&app, "GET", "/api/karte/config", None, None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let roh = String::from_utf8(bytes.to_vec()).unwrap();
    // Weder Key noch Upstream-Host stehen IRGENDWO im öffentlichen config-Body.
    assert!(!roh.contains("GEHEIM"), "kein Key im config-Body: {roh}");
    assert!(!roh.contains("api.maptiler.com"), "kein Upstream-Host (vektor)");
    assert!(!roh.contains("stadiamaps.com"), "kein Upstream-Host (raster)");

    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let styles = v["online_styles"].as_array().unwrap();
    assert_eq!(styles.len(), 3);
    // Vektor-proxy → /api/karte/proxy/{id}/style.json, Attribution erhalten.
    assert!(styles[0]["url"].as_str().unwrap().starts_with("/api/karte/proxy/"));
    assert!(styles[0]["url"].as_str().unwrap().ends_with("/style.json"));
    assert_eq!(styles[0]["attribution"], "© MapTiler");
    // Raster-proxy → /api/karte/proxy/{id}/raster/{z}/{x}/{y}
    assert!(styles[1]["url"].as_str().unwrap().ends_with("/raster/{z}/{x}/{y}"));
    // proxy=0 → unverändert
    assert_eq!(styles[2]["url"], "https://tiles.example/liberty");
}

#[tokio::test]
async fn online_liste_maskiert_proxy_url_fuer_fuehrungskraft() {
    let (app, admin) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&admin),
        Some(r#"{"name":"MapTiler","url":"https://api.maptiler.com/maps/streets/style.json?key=GEHEIM","typ":"vektor","attribution":"© MapTiler","proxy":true}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);

    // Admin sieht die volle url (er hat sie eingegeben und muss sie editieren können).
    let liste = json(anfrage(&app, "GET", "/api/karte/online-quellen", Some(&admin), None).await).await;
    assert!(
        liste[0]["url"].as_str().unwrap().contains("GEHEIM"),
        "Admin sieht den Key voll"
    );

    // Führungskraft (darf_admin_bereich, !ist_admin) sieht die url maskiert.
    let res = anfrage(
        &app,
        "POST",
        "/api/benutzer",
        Some(&admin),
        Some(r#"{"anzeigename":"Frieda","benutzername":"frieda","passwort":"friedapw1","org_rolle":"fuehrungskraft"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let liste = json(anfrage(&app, "GET", "/api/karte/online-quellen", Some(&frieda), None).await).await;
    assert_eq!(liste[0]["url"], "***", "Führungskraft sieht maskierte url");
    assert!(
        !liste[0]["url"].as_str().unwrap().contains("GEHEIM"),
        "kein Key für die Führungskraft"
    );
}
