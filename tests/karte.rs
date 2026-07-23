use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use axum::response::Response;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::config::default_offline_katalog;
use lifeline_hub::live::LiveHub;
use std::io::Write;
use tower::ServiceExt; // oneshot

mod common;
use common::login_cookie;

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
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
        karten_dir: lifeline_hub::db::test_karten_dir(),
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
    app.clone()
        .oneshot(builder.body(rumpf).unwrap())
        .await
        .unwrap()
}

async fn json(res: Response) -> serde_json::Value {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

// ===== /api/karte/offline/tiles/{z}/{x}/{y} + /api/karte/config (eingefrorener Frontend-Vertrag) =====

// ===== /api/karte/offline/tiles/{z}/{x}/{y} (MBTiles, LFH-195) =====

/// Schreibt eine Mini-MBTiles-Fixture: `tiles`-Tabelle mit genau einer Kachel bei
/// TMS (z=1, tile_column=0, tile_row=1) = XYZ (z=1, x=0, y=0). Eigener SCHREIBBARER Pool
/// (die Datei existiert noch nicht) — der Produktionscode liest sie nur read-only.
async fn schreibe_fixture_mbtiles(pfad: &std::path::Path, daten: &[u8]) {
    use sqlx::sqlite::SqliteConnectOptions;
    let opts = SqliteConnectOptions::new()
        .filename(pfad)
        .create_if_missing(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO tiles VALUES (1, 0, 1, ?1)")
        .bind(daten)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
}

/// Registriert + aktiviert eine Offline-Karte mit `pfad` (relativ zum `karten_dir`), sodass
/// `repo::aktive_offline_karte_pfad` sie liefert (Status wird von `registriere_offline_karte`
/// bereits als `bereit` angelegt).
async fn registriere_und_aktiviere(pool: &sqlx::SqlitePool, pfad: &str, format: &str) -> i64 {
    use lifeline_hub::karte::registry::repo;
    let karte = repo::registriere_offline_karte(
        pool,
        &repo::OfflineKarteEingabe {
            name: "Test-Shortbread".into(),
            pfad: pfad.into(),
            quell_url: None,
            lizenz: Some("© Test".into()),
            kachel_schema: "shortbread".into(),
            format: format.into(),
            sortier: 0,
        },
    )
    .await
    .unwrap();
    repo::aktiviere_offline_karte(pool, karte.id).await.unwrap();
    karte.id
}

#[tokio::test]
async fn offline_tiles_liefert_gzip_mvt_mit_tms_flip() {
    let pool = pool().await;
    let dir = tempfile::tempdir().unwrap();
    let dateiname = "karte-1.mbtiles";
    schreibe_fixture_mbtiles(&dir.path().join(dateiname), &[0xAB, 0xCD]).await;
    registriere_und_aktiviere(&pool, dateiname, "pbf").await;

    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
        karten_dir: dir.path().to_path_buf(),
    });

    // Vorhandene Kachel: XYZ (z=1,x=0,y=0) -> TMS row = (2^1-1)-0 = 1 -> Treffer.
    let req = Request::builder()
        .uri("/api/karte/offline/tiles/1/0/0")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/x-protobuf"
    );
    assert_eq!(res.headers().get(header::CONTENT_ENCODING).unwrap(), "gzip");
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], &[0xAB, 0xCD]);

    // Fehlende Kachel -> 204.
    let req = Request::builder()
        .uri("/api/karte/offline/tiles/1/1/1")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn offline_tiles_raster_liefert_png_ohne_gzip_und_config_meldet_raster() {
    // LFH-185: eine aktive Raster-Karte (format='png') wird als image/png OHNE Content-Encoding
    // serviert, und /config gröbert das Format zu 'raster' (Frontend-Style-Wahl).
    let pool = pool().await;
    let dir = tempfile::tempdir().unwrap();
    let dateiname = "karte-1.mbtiles";
    // Blob mit PNG-Signatur — der Inhalt ist für die Header-Logik irrelevant (die kommt aus der
    // DB-format-Spalte), die Signatur hält es aber ehrlich.
    let png: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01];
    schreibe_fixture_mbtiles(&dir.path().join(dateiname), png).await;
    registriere_und_aktiviere(&pool, dateiname, "png").await;

    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
        karten_dir: dir.path().to_path_buf(),
    });

    // Raster-Kachel: image/png, KEIN gzip, Blob round-trippt.
    let req = Request::builder()
        .uri("/api/karte/offline/tiles/1/0/0")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "image/png"
    );
    assert!(
        res.headers().get(header::CONTENT_ENCODING).is_none(),
        "Raster-Blob trägt KEIN Content-Encoding (nicht gzip)"
    );
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(&bytes[..], png);

    // /config meldet offline_format='raster'.
    let req = Request::builder()
        .uri("/api/karte/config")
        .body(Body::empty())
        .unwrap();
    let cfg = app.oneshot(req).await.unwrap();
    let v = json(cfg).await;
    assert_eq!(v["offline_format"].as_str(), Some("raster"));
}

#[tokio::test]
async fn offline_tiles_ohne_aktive_karte_liefert_204() {
    let pool = pool().await; // leere offline-Tabelle
    let app = app_mit_pool(pool);
    let req = Request::builder()
        .uri("/api/karte/offline/tiles/1/0/0")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn offline_tiles_ungueltiges_z_liefert_204_ohne_panic() {
    // z=99 würde `lies_tile`s `1i64 << z`-TMS-Flip absurd überlaufen lassen (Debug-Panic /
    // Release-Maskierung) — der Range-Guard muss VOR reader_fuer/lies_tile greifen. Mit einer
    // registrierten + aktiven Karte, damit der Guard tatsächlich geprüft wird (nicht nur der
    // frühere "keine aktive Karte"-204-Pfad).
    let pool = pool().await;
    let dir = tempfile::tempdir().unwrap();
    let dateiname = "karte-1.mbtiles";
    schreibe_fixture_mbtiles(&dir.path().join(dateiname), &[0xAB, 0xCD]).await;
    registriere_und_aktiviere(&pool, dateiname, "pbf").await;

    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
        karten_dir: dir.path().to_path_buf(),
    });
    let req = Request::builder()
        .uri("/api/karte/offline/tiles/99/0/0")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
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
    let req = Request::builder()
        .uri("/api/karte/config")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert_eq!(v["offline_verfuegbar"].as_bool(), Some(true));
    // offline_tiles_url ist jetzt REGION-ADRESSIERT (LFH-188, Kompat = erste sichtbare Region):
    // /api/karte/offline/{id}/tiles/{z}/{x}/{y}?v=<Token> — Token dynamisch, id dynamisch.
    let offline_tiles_url = v["offline_tiles_url"].as_str().unwrap();
    assert!(
        offline_tiles_url.starts_with("/api/karte/offline/")
            && offline_tiles_url.contains("/tiles/{z}/{x}/{y}?v="),
        "region-adressierte offline_tiles_url mit Cache-Bust-Token erwartet, war: {offline_tiles_url}"
    );
    // offline_regionen ist die Quelle der Wahrheit (LFH-188): genau die eine bereite Region, maxzoom 14.
    let regionen = v["offline_regionen"].as_array().unwrap();
    assert_eq!(regionen.len(), 1, "genau die eine bereite Region");
    assert_eq!(
        regionen[0]["maxzoom"].as_u64(),
        Some(14),
        "Regional-Pack maxzoom 14"
    );
    assert!(regionen[0]["tiles_url"]
        .as_str()
        .unwrap()
        .contains("/tiles/{z}/{x}/{y}?v="));
    assert_eq!(
        v["online_styles"][0]["url"].as_str(),
        Some("https://tiles.example/style.json")
    );
    assert_eq!(v["online_styles"][0]["typ"].as_str(), Some("vektor"));
}

/// Der statische `welt`-Tile-Pfad muss VOR der dynamischen `{karte_id}`-Route greifen (LFH-207) —
/// sonst würde „welt" am i64-Extractor scheitern (400) und die eingebettete Welt-Übersicht nie laden.
/// Ohne eingebettetes/extrahiertes Asset liefert der Handler `204` (Datei fehlt), NICHT `400`.
#[tokio::test]
async fn welt_tiles_route_greift_und_ist_204_ohne_asset() {
    let app = app_mit_pool(pool().await);
    let req = Request::builder()
        .uri("/api/karte/offline/welt/tiles/2/1/1")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(
        res.status(),
        StatusCode::NO_CONTENT,
        "welt-Route muss greifen (204 ohne Asset), nicht 400 am karte_id-Extractor"
    );
}

#[tokio::test]
async fn config_endpoint_blind_modus_ohne_konfiguration() {
    let pool = pool().await; // leere Registry → Karte startet blind
    let app = app_mit_pool(pool);
    let req = Request::builder()
        .uri("/api/karte/config")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert_eq!(v["offline_verfuegbar"].as_bool(), Some(false));
    assert!(v["offline_tiles_url"].is_null());
    assert!(v["online_styles"].as_array().unwrap().is_empty());
}

/// Wie `app_mit_pool`, aber mit konfiguriertem karten-service (URL+Token) — für den
/// `karten_bau_verfuegbar`-Test (LFH-203). Die URL zeigt absichtlich ins Leere (127.0.0.1:1):
/// der Config-Handler prüft nur Anwesenheit, ruft den Service NICHT auf.
fn app_mit_pool_und_karten_service(pool: sqlx::SqlitePool) -> axum::Router {
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: Some("http://127.0.0.1:1".into()),
        karten_service_token: Some("t".into()),
        karten_dir: lifeline_hub::db::test_karten_dir(),
    })
}

#[tokio::test]
async fn config_endpoint_meldet_karten_bau_verfuegbar_mit_service_konfiguration() {
    let pool = pool().await;
    let app = app_mit_pool_und_karten_service(pool);
    let req = Request::builder()
        .uri("/api/karte/config")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert_eq!(v["karten_bau_verfuegbar"].as_bool(), Some(true));
}

#[tokio::test]
async fn config_endpoint_meldet_karten_bau_nicht_verfuegbar_ohne_service_konfiguration() {
    let pool = pool().await;
    let app = app_mit_pool(pool); // Standard-Helfer: karten_service_url/-token beide None
    let req = Request::builder()
        .uri("/api/karte/config")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert_eq!(v["karten_bau_verfuegbar"].as_bool(), Some(false));
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
        let res = anfrage(
            &app,
            "POST",
            "/api/karte/offline-karten",
            Some(&cookie),
            Some(boese),
        )
        .await;
        assert_eq!(
            res.status(),
            StatusCode::BAD_REQUEST,
            "böser Pfad bei Registrierung abgelehnt: {boese}"
        );
    }
}

#[tokio::test]
async fn offline_tiles_lehnt_absoluten_pfad_in_db_ab() {
    // Defense-in-Depth: selbst wenn ein absoluter Pfad direkt in der DB landet (Umgehung der
    // Handler-Validierung), liefert offline_tiles() ihn NICHT über den unauthentifizierten
    // Endpunkt aus (kein Info-Leak/Blob-Zugriff auf beliebige Server-Dateien).
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
    let res = anfrage(&app, "GET", "/api/karte/offline/tiles/1/0/0", None, None).await;
    assert_eq!(
        res.status(),
        StatusCode::NO_CONTENT,
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
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/online-quellen",
        Some(&cookie),
        None,
    )
    .await;
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
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/online-quellen",
        Some(&cookie),
        None,
    )
    .await;
    assert!(json(res).await.as_array().unwrap().is_empty());
}

// ===== LFH-306: Online-Quellen-PATCH ist ein Teil-Patch =====

/// Legt eine Online-Quelle über die API an (erwartet 201) und liefert ihre id.
async fn online_quelle_anlegen(app: &axum::Router, cookie: &str, body: &str) -> i64 {
    let res = anfrage(
        app,
        "POST",
        "/api/karte/online-quellen",
        Some(cookie),
        Some(body),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    json(res).await["id"].as_i64().unwrap()
}

/// `proxy` hing am `#[serde(default = "default_proxy")]` (true): jeder PATCH ohne das Feld
/// schaltete eine bewusst DIREKT geladene Quelle zurück auf den Proxy und warf ihre
/// Kachel-Slots weg. Der schärfste Test dieser Route — gegen HEAD springt `proxy` auf true.
#[tokio::test]
async fn patch_ohne_proxy_behaelt_proxy_false() {
    let (app, cookie) = admin_app().await;
    let id = online_quelle_anlegen(
        &app,
        &cookie,
        r#"{"name":"Direkt","url":"https://tiles.example/liberty","typ":"vektor","attribution":"© OSM","proxy":false}"#,
    )
    .await;

    // Body mit allen früheren Pflichtfeldern, NUR `proxy` fehlt.
    let res = anfrage(
        &app,
        "PATCH",
        &format!("/api/karte/online-quellen/{id}"),
        Some(&cookie),
        Some(r#"{"name":"Direkt neu","url":"https://tiles.example/liberty","typ":"vektor","attribution":"© OSM"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let akt = json(res).await;
    assert_eq!(akt["name"], "Direkt neu");
    assert_eq!(
        akt["proxy"], false,
        "nicht gesendet → bleibt false (kein Rückfall auf den Anlege-Default): {akt:?}"
    );
}

/// Der sicherheitskritische Test dieser Route: `{"proxy":true}` OHNE `url` schaltet den
/// Server-seitigen Abruf einer bereits GESPEICHERTEN, internen URL scharf. Ohne
/// Effektivzustands-Prüfung ginge der Patch durch (die URL steht ja nicht im Body) — und der
/// Server holte fortan eine Loopback-Adresse. Muss 400 sein.
#[tokio::test]
async fn patch_proxy_true_prueft_gespeicherte_url_gegen_ssrf() {
    let (app, cookie) = admin_app().await;
    // Direkt geladene Quelle mit interner URL: beim Anlegen ungeprüft (proxy=false), weil
    // sie der Browser selbst lädt.
    let id = online_quelle_anlegen(
        &app,
        &cookie,
        r#"{"name":"Intern","url":"https://127.0.0.1/style.json","typ":"vektor","attribution":"© X","proxy":false}"#,
    )
    .await;

    let res = anfrage(
        &app,
        "PATCH",
        &format!("/api/karte/online-quellen/{id}"),
        Some(&cookie),
        Some(r#"{"proxy":true}"#),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "proxy=true auf gespeicherte interne URL muss am SSRF-Gate scheitern"
    );

    // Und die Quelle ist unverändert direkt geblieben.
    let liste = json(
        anfrage(
            &app,
            "GET",
            "/api/karte/online-quellen",
            Some(&cookie),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(liste[0]["proxy"], false, "abgelehnt ⇒ nichts geschrieben");
}

/// Attribution ist Lizenzauflage: ein PATCH OHNE das Feld ist zulässig, solange der
/// GESPEICHERTE Wert trägt. Grenzt gegen `patch_attribution_null_ist_400` ab.
#[tokio::test]
async fn patch_ohne_attribution_bleibt_gueltig() {
    let (app, cookie) = admin_app().await;
    let id = online_quelle_anlegen(
        &app,
        &cookie,
        r#"{"name":"A","url":"https://tiles.example/a","typ":"vektor","attribution":"© OSM","proxy":false}"#,
    )
    .await;

    let res = anfrage(
        &app,
        "PATCH",
        &format!("/api/karte/online-quellen/{id}"),
        Some(&cookie),
        Some(r#"{"name":"A2"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let akt = json(res).await;
    assert_eq!(akt["name"], "A2");
    assert_eq!(akt["attribution"], "© OSM", "unberührt: {akt:?}");
}

/// `null` (wie `""`) ist ein Leerwunsch — und der ist an der Pflicht-Attribution 400.
/// Ohne den Tri-State kollabierte `null` zu „nicht gesendet" und ginge still durch.
#[tokio::test]
async fn patch_attribution_null_ist_400() {
    let (app, cookie) = admin_app().await;
    let id = online_quelle_anlegen(
        &app,
        &cookie,
        r#"{"name":"A","url":"https://tiles.example/a","typ":"vektor","attribution":"© OSM","proxy":false}"#,
    )
    .await;

    for body in [r#"{"attribution":null}"#, r#"{"attribution":"   "}"#] {
        let res = anfrage(
            &app,
            "PATCH",
            &format!("/api/karte/online-quellen/{id}"),
            Some(&cookie),
            Some(body),
        )
        .await;
        assert_eq!(
            res.status(),
            StatusCode::BAD_REQUEST,
            "Attribution ist Pflicht: {body}"
        );
    }
}

/// `sortier` hing am `#[serde(default)]` (0): jeder PATCH ohne das Feld warf die
/// Reihenfolge auf 0 zurück. NOT-NULL-Spalte, fällt gegen HEAD hart durch.
#[tokio::test]
async fn patch_ohne_sortier_behaelt_sortier() {
    let (app, cookie) = admin_app().await;
    let id = online_quelle_anlegen(
        &app,
        &cookie,
        r#"{"name":"S","url":"https://tiles.example/s","typ":"vektor","attribution":"© OSM","sortier":7,"proxy":false}"#,
    )
    .await;

    let res = anfrage(
        &app,
        "PATCH",
        &format!("/api/karte/online-quellen/{id}"),
        Some(&cookie),
        Some(r#"{"name":"S neu","url":"https://tiles.example/s","typ":"vektor","attribution":"© OSM","proxy":false}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let akt = json(res).await;
    assert_eq!(akt["sortier"], 7, "nicht gesendet → bleibt: {akt:?}");
}

/// Die Proxy-Slots einer Quelle sind nur stale, wenn sich das Abrufziel ändern KANN — also
/// wenn `url` oder `proxy` im Patch stehen. Ein reiner Umbenenn-Patch warf den Kachel-Cache
/// vorher bedingungslos weg (HEAD ruft `slots_loeschen` unbedingt).
#[tokio::test]
async fn patch_ohne_url_und_proxy_loescht_keine_slots() {
    use lifeline_hub::karte::registry::repo;
    let pool = pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    insert_proxy_quelle(&pool, "Q", "https://x/style.json?key=K", "vektor", 1, 1, 0).await; // id 1
    sqlx::query("INSERT INTO karte_proxy_asset (quelle_id, upstream_url, art) VALUES (1, 'https://x/sprite?key=K', 'sprite')")
        .execute(&pool).await.unwrap(); // slot 1
    let app = app_mit_pool(pool.clone());
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let res = anfrage(
        &app,
        "PATCH",
        "/api/karte/online-quellen/1",
        Some(&cookie),
        Some(r#"{"name":"Q neu","sortier":3}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert!(
        repo::slot_aufloesen(&pool, 1, 1, "sprite")
            .await
            .unwrap()
            .is_some(),
        "Patch ohne url/proxy lässt die Slots stehen"
    );
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
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "Attribution ist Pflicht"
    );
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
    let res = anfrage(
        &app,
        "DELETE",
        "/api/karte/online-quellen/999",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn online_katalog_liefert_eintraege() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/online-quellen/katalog",
        Some(&cookie),
        None,
    )
    .await;
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
    // LFH-265: Regressionsnetz gegen ein versehentlich mitgezogenes Enum im FromRow-Pfad —
    // BEWUSST NICHT UNTERSCHEIDEND für den Schema-Anker `#[schema(value_type =
    // OfflineKarteStatus)]`: der ändert keinen Byte an der Serialisierung (`status` bleibt
    // `String`, alle Schreibpfade sind SQL-String-Literale). Die Unterscheidungskraft des
    // Ankers liegt im `wire_is!`-Block in tests/enum_wire_kontrakt.rs (kompiliert ohne das
    // Enum nicht) und im Typtest-Assert in frontend/src/api/kartenSchema.typetest.ts.
    assert_eq!(k["status"], "bereit");
    assert_eq!(k["aktiv_basemap"], false);
    assert_eq!(k["kachel_schema"], "shortbread"); // Default

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

    let res = anfrage(
        &app,
        "GET",
        "/api/karte/offline-karten",
        Some(&cookie),
        None,
    )
    .await;
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
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten/999/aktivieren",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn offline_loeschen_unbekannt_ist_404() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "DELETE",
        "/api/karte/offline-karten/999",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

// ===== Offline-Download-Manager (LFH-181) =====

#[tokio::test]
async fn offline_katalog_zeigt_nur_lieferbare() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/offline-karten/katalog",
        Some(&cookie),
        None,
    )
    .await;
    // Statische /katalog-Route gewinnt gegen /{id} (matchit-Priorität).
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    let liste = v.as_array().expect("Array");
    // LFH-201: der Download-Katalog zeigt NUR tatsächlich lieferbare Regionen (Pin + echte URL).
    // Im Test fehlt das Manifest (Fetch der TODO-Platzhalter-URL scheitert) → alle compiled-in
    // Platzhalter sind gefiltert → leer. Ungebaute Platzhalter dürfen nie als ladbar erscheinen.
    assert!(
        liste
            .iter()
            .all(|e| !e["url"].as_str().unwrap().contains("TODO")),
        "keine ungebauten TODO-Platzhalter im Download-Katalog"
    );
    assert!(
        liste.iter().all(|e| e["sha256"].as_str().is_some()),
        "nur gepinnte Einträge"
    );
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
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "Attribution ist Pflicht"
    );
}

#[tokio::test]
async fn offline_registrieren_ungueltiges_format_ist_400() {
    // LFH-185: nur pbf/png/jpg/webp; ein anderer Wert wird als 400 abgelehnt (nicht DB-CHECK-500).
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(r#"{"name":"X","pfad":"x.mbtiles","lizenz":"© Test","format":"gif"}"#),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "ungültiges Format → 400, kein DB-500"
    );
}

#[tokio::test]
async fn offline_download_interne_url_ist_400_ssrf() {
    let (app, cookie) = admin_app().await;
    // SSRF-Guard: interne IP / http müssen abgelehnt werden (kein Server-seitiger Fetch darauf).
    for url in [
        "http://example.test/de.pmtiles",      // kein https
        "https://169.254.169.254/latest/meta", // Cloud-Metadaten
        "https://127.0.0.1/de.pmtiles",        // Loopback
        "https://192.168.1.1/de.pmtiles",      // privates Netz
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
async fn offline_liste_bietet_kein_update_auf_ungebauten_platzhalter() {
    // LFH-206-Bugfix: eine real installierte Region, deren einziger Katalog-Treffer ein UNGEBAUTER
    // TODO-Platzhalter ist (leerer Katalog-Cache → nur compiled-in), darf NICHT „Update verfügbar"
    // melden — sonst lädt „Aktualisieren" eine nicht-ladbare URL (`https://TODO-karten-build-release/…`).
    // Genau das trat auf: Schweiz/NRW im compiled-in-Katalog boten sich nach Neustart als Platzhalter-
    // Update an. Die eigentliche Filterlogik (nur lieferbare Einträge) ist in `update_check_tests`
    // unit-getestet; dieser Handler-Test ist clean-env-deterministisch (in einer Dev-Env mit
    // erreichbarem Manifest kann ein echter Eintrag ein legitimes Update liefern — env-abhängig).
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(
            r#"{"name":"Deutschland (Shortbread)","pfad":"germany.mbtiles","lizenz":"© OSM",
                "quell_url":"https://example.test/germany.shortbread.alt.mbtiles"}"#,
        ),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);

    let liste = json(
        anfrage(
            &app,
            "GET",
            "/api/karte/offline-karten",
            Some(&cookie),
            None,
        )
        .await,
    )
    .await;
    let eintrag = &liste.as_array().unwrap()[0];
    assert_eq!(
        eintrag["update_verfuegbar"], false,
        "kein Update auf einen ungebauten Platzhalter"
    );
    assert!(eintrag["katalog_url"].is_null());
}

#[tokio::test]
async fn offline_liste_kein_update_bei_aktueller_katalog_quelle() {
    let (app, cookie) = admin_app().await;
    let katalog_url = default_offline_katalog()[0].url.clone();
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten",
        Some(&cookie),
        Some(&format!(
            r#"{{"name":"Deutschland (Shortbread)","pfad":"germany.mbtiles","lizenz":"© OSM",
                "quell_url":"{katalog_url}"}}"#
        )),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);

    let liste = json(
        anfrage(
            &app,
            "GET",
            "/api/karte/offline-karten",
            Some(&cookie),
            None,
        )
        .await,
    )
    .await;
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
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/online-quellen",
        Some(&frieda),
        None,
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::OK,
        "Führungskraft darf die Liste lesen"
    );

    // Schreiben bleibt verboten (nur system-admin).
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/online-quellen",
        Some(&frieda),
        Some(r#"{"name":"X","url":"https://x","typ":"vektor","attribution":"© X"}"#),
    )
    .await;
    assert_eq!(
        res.status(),
        StatusCode::FORBIDDEN,
        "Führungskraft darf nicht schreiben"
    );
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
        let body = format!(
            r#"{{"name":"P","url":"{url}","typ":"vektor","attribution":"© X","proxy":true}}"#
        );
        let res = anfrage(
            &app,
            "POST",
            "/api/karte/online-quellen",
            Some(&cookie),
            Some(&body),
        )
        .await;
        assert_eq!(
            res.status(),
            StatusCode::BAD_REQUEST,
            "proxy+intern abgelehnt: {url}"
        );
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
async fn online_anlegen_default_proxy_true() {
    // LFH-190: Proxy ist Default-an. Wird `proxy` im Body weggelassen ⇒ true (serverseitig
    // geproxt + gecacht).
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
    assert_eq!(
        json(res).await["proxy"],
        true,
        "Default ohne proxy-Feld ⇒ true (LFH-190)"
    );
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
    assert!(
        !roh.contains("api.maptiler.com"),
        "kein Upstream-Host (vektor)"
    );
    assert!(
        !roh.contains("stadiamaps.com"),
        "kein Upstream-Host (raster)"
    );

    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let styles = v["online_styles"].as_array().unwrap();
    assert_eq!(styles.len(), 3);
    // Vektor-proxy → /api/karte/proxy/{id}/style.json, Attribution erhalten.
    assert!(styles[0]["url"]
        .as_str()
        .unwrap()
        .starts_with("/api/karte/proxy/"));
    assert!(styles[0]["url"].as_str().unwrap().ends_with("/style.json"));
    assert_eq!(styles[0]["attribution"], "© MapTiler");
    // Raster-proxy → /api/karte/proxy/{id}/raster/{z}/{x}/{y}
    assert!(styles[1]["url"]
        .as_str()
        .unwrap()
        .ends_with("/raster/{z}/{x}/{y}"));
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
    let liste =
        json(anfrage(&app, "GET", "/api/karte/online-quellen", Some(&admin), None).await).await;
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
    let liste = json(
        anfrage(
            &app,
            "GET",
            "/api/karte/online-quellen",
            Some(&frieda),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(liste[0]["url"], "***", "Führungskraft sieht maskierte url");
    assert!(
        !liste[0]["url"].as_str().unwrap().contains("GEHEIM"),
        "kein Key für die Führungskraft"
    );
}

// ===== Proxy-Endpunkte: Ablehnung/Scoping (Happy-Path via Service-Loopback-Tests bewiesen) =====

async fn insert_proxy_quelle(
    pool: &sqlx::SqlitePool,
    name: &str,
    url: &str,
    typ: &str,
    aktiv: i64,
    proxy: i64,
    sortier: i64,
) {
    sqlx::query("INSERT INTO karte_online_quelle (name,url,typ,attribution,sortier,aktiv,proxy) VALUES (?,?,?,?,?,?,?)")
        .bind(name).bind(url).bind(typ).bind("© X").bind(sortier).bind(aktiv).bind(proxy)
        .execute(pool).await.unwrap();
}

#[tokio::test]
async fn proxy_style_unbekannte_id_ist_404() {
    let app = app_mit_pool(pool().await);
    // Route ist registriert → Handler-404 (JSON), nicht der SPA-HTML-Fallback.
    let res = anfrage(&app, "GET", "/api/karte/proxy/999/style.json", None, None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/json"
    );
}

#[tokio::test]
async fn proxy_style_proxy0_oder_inaktiv_ist_404() {
    let pool = pool().await;
    insert_proxy_quelle(&pool, "Direkt", "https://x/s.json", "vektor", 1, 0, 0).await; // id 1: proxy=0
    insert_proxy_quelle(
        &pool,
        "Inaktiv",
        "https://x/s.json?key=K",
        "vektor",
        0,
        1,
        1,
    )
    .await; // id 2: inaktiv
    let app = app_mit_pool(pool);
    for id in [1, 2] {
        let res = anfrage(
            &app,
            "GET",
            &format!("/api/karte/proxy/{id}/style.json"),
            None,
            None,
        )
        .await;
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "id {id} nicht proxybar"
        );
    }
}

#[tokio::test]
async fn proxy_style_interne_gespeicherte_url_ist_fehler() {
    let pool = pool().await;
    // proxy=1 mit interner url direkt in DB (umgeht validiere_online) → SSRF-Gate im Handler.
    insert_proxy_quelle(
        &pool,
        "Boese",
        "https://169.254.169.254/style.json",
        "vektor",
        1,
        1,
        0,
    )
    .await;
    let app = app_mit_pool(pool);
    let res = anfrage(&app, "GET", "/api/karte/proxy/1/style.json", None, None).await;
    assert!(
        res.status().is_server_error(),
        "SSRF-Gate vor Connect: {}",
        res.status()
    );
}

#[tokio::test]
async fn proxy_tile_art_mismatch_und_fremde_quelle_404() {
    let pool = pool().await;
    insert_proxy_quelle(&pool, "Q", "https://x/s.json?key=K", "vektor", 1, 1, 0).await; // id 1
    insert_proxy_quelle(&pool, "Q2", "https://y/s.json?key=K", "vektor", 1, 1, 1).await; // id 2
                                                                                         // Sprite-Slot (id 1) für quelle 1.
    sqlx::query("INSERT INTO karte_proxy_asset (quelle_id, upstream_url, art) VALUES (1, 'https://x/sprite?key=K', 'sprite')")
        .execute(&pool).await.unwrap();
    let app = app_mit_pool(pool);
    // Slot 1 ist 'sprite' → als Tile angefragt → 404 (art-Mismatch).
    let res = anfrage(&app, "GET", "/api/karte/proxy/1/tile/1/1/1/1", None, None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND, "art-Mismatch");
    // Slot 1 gehört quelle 1; unter quelle 2 angefragt → 404 (cross-quelle).
    let res = anfrage(&app, "GET", "/api/karte/proxy/2/tile/1/1/1/1", None, None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND, "fremde quelle");
}

#[tokio::test]
async fn proxy_raster_nicht_numerisches_z_ist_400() {
    let pool = pool().await;
    insert_proxy_quelle(
        &pool,
        "R",
        "https://x/{z}/{x}/{y}.png?key=K",
        "raster",
        1,
        1,
        0,
    )
    .await;
    let app = app_mit_pool(pool);
    let res = anfrage(&app, "GET", "/api/karte/proxy/1/raster/abc/1/1", None, None).await;
    assert_eq!(
        res.status(),
        StatusCode::BAD_REQUEST,
        "z nicht-numerisch → Path-Fehler"
    );
}

#[tokio::test]
async fn proxy_glyphs_ungueltiger_range_ist_400() {
    let pool = pool().await;
    insert_proxy_quelle(&pool, "G", "https://x/s.json?key=K", "vektor", 1, 1, 0).await;
    let app = app_mit_pool(pool);
    // range ohne Bindestrich → validiere_range schlägt fehl (vor slot_aufloesen) → 400.
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/proxy/1/glyphs/1/Arial/0_255",
        None,
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn online_patch_und_delete_purgen_proxy_slots() {
    use lifeline_hub::karte::registry::repo;
    let pool = pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    insert_proxy_quelle(&pool, "Q", "https://x/style.json?key=K", "vektor", 1, 1, 0).await; // id 1
    sqlx::query("INSERT INTO karte_proxy_asset (quelle_id, upstream_url, art) VALUES (1, 'https://x/sprite?key=K', 'sprite')")
        .execute(&pool).await.unwrap(); // slot 1
    let app = app_mit_pool(pool.clone());
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    // Slot existiert vor dem PATCH.
    assert!(repo::slot_aufloesen(&pool, 1, 1, "sprite")
        .await
        .unwrap()
        .is_some());
    // PATCH mit GEÄNDERTER url → Handler purged die (jetzt stale) Slots.
    let res = anfrage(
        &app, "PATCH", "/api/karte/online-quellen/1", Some(&cookie),
        Some(r#"{"name":"Q","url":"https://x/anders.json?key=K2","typ":"vektor","attribution":"© X","proxy":true}"#),
    ).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert!(
        repo::slot_aufloesen(&pool, 1, 1, "sprite")
            .await
            .unwrap()
            .is_none(),
        "PATCH (URL-Wechsel) purged stale Slots"
    );

    // Neuen Slot anlegen, dann DELETE → ebenfalls weg (Handler-Purge + CASCADE).
    sqlx::query("INSERT INTO karte_proxy_asset (quelle_id, upstream_url, art) VALUES (1, 'https://x/s2?key=K2', 'sprite')")
        .execute(&pool).await.unwrap();
    let slot2: i64 =
        sqlx::query_scalar("SELECT id FROM karte_proxy_asset WHERE quelle_id = 1 LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    let res = anfrage(
        &app,
        "DELETE",
        "/api/karte/online-quellen/1",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert!(
        repo::slot_aufloesen(&pool, 1, slot2, "sprite")
            .await
            .unwrap()
            .is_none(),
        "DELETE entfernt die Slots"
    );
}

#[tokio::test]
async fn proxy_tile_slot_auf_interne_adresse_ist_fehler_ssrf() {
    let pool = pool().await;
    insert_proxy_quelle(&pool, "S", "https://x/s.json?key=K", "vektor", 1, 1, 0).await;
    // Ein (z.B. von kompromittiertem Upstream eingeschleuster) Slot zeigt auf eine interne Adresse.
    sqlx::query("INSERT INTO karte_proxy_asset (quelle_id, upstream_url, art) VALUES (1, 'https://169.254.169.254/{z}/{x}/{y}', 'template')")
        .execute(&pool).await.unwrap();
    let app = app_mit_pool(pool);
    let res = anfrage(&app, "GET", "/api/karte/proxy/1/tile/1/1/1/1", None, None).await;
    assert!(
        res.status().is_server_error(),
        "SSRF-Gate blockt internen Slot: {}",
        res.status()
    );
}

// ===== POST /api/karte/offline-karten/bauen (Region-Bau-Trigger → karten-service, LFH-203/B2) =====

/// Wie `admin_app`, aber mit konfiguriertem karten-service (`url`+`token`) — für den
/// Bau-Trigger-Test braucht es EINE konkrete (Mock-)Adresse statt der toten `127.0.0.1:1` aus
/// `app_mit_pool_und_karten_service`.
async fn admin_app_mit_karten_service(url: &str, token: &str) -> (axum::Router, String) {
    let pool = pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let app = build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: Some(url.to_string()),
        karten_service_token: Some(token.to_string()),
        karten_dir: lifeline_hub::db::test_karten_dir(),
    });
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    (app, cookie)
}

/// Mini-Mock des zentralen karten-service (Muster: `download.rs::spawn_fixture`, `127.0.0.1:0`).
/// Beantwortet `POST /builds`, NACHDEM geprüft wurde, dass Bearer-Token und Body (`{"slug":..}`)
/// wie erwartet ankommen — falsche Werte lassen die Assertion in der Mock-Task panicken, der
/// Request bricht ab und der Test schlägt (indirekt, über den dadurch nicht-202-Status) fehl.
async fn spawn_karten_service_mock(
    erwartetes_token: &'static str,
    erwarteter_slug: &'static str,
) -> String {
    use axum::routing::post;
    use axum::Router;

    let mock = Router::new().route(
        "/builds",
        post(
            move |headers: axum::http::HeaderMap,
                  axum::Json(body): axum::Json<serde_json::Value>| async move {
                let auth = headers
                    .get(axum::http::header::AUTHORIZATION)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or_default();
                assert_eq!(
                    auth,
                    format!("Bearer {erwartetes_token}"),
                    "Bearer-Token weitergereicht"
                );
                assert_eq!(body["slug"], erwarteter_slug, "slug im Body weitergereicht");
                axum::Json(serde_json::json!({ "job_id": 7 }))
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, mock).await.unwrap();
    });
    format!("http://127.0.0.1:{}", addr.port())
}

#[tokio::test]
async fn offline_bauen_forwardet_an_karten_service_und_liefert_202() {
    let mock_url = spawn_karten_service_mock("t", "bayern").await;
    let (app, cookie) = admin_app_mit_karten_service(&mock_url, "t").await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten/bauen",
        Some(&cookie),
        Some(r#"{"slug":"bayern"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let v = json(res).await;
    assert_eq!(v["job_id"], 7);
}

#[tokio::test]
async fn offline_bauen_ohne_service_config_ist_501() {
    // Standard-Helfer: karten_service_url/-token beide None → Feature aus.
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten/bauen",
        Some(&cookie),
        Some(r#"{"slug":"bayern"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::NOT_IMPLEMENTED);
}

#[tokio::test]
async fn offline_bauen_lehnt_leeren_slug_ab() {
    // Service ist konfiguriert (URL zeigt absichtlich ins Leere) — die Validierung muss VOR dem
    // Netzwerk-Call greifen, sonst würde dieser Test einen echten (scheiternden) Call auslösen.
    let (app, cookie) = admin_app_mit_karten_service("http://127.0.0.1:1", "t").await;
    let res = anfrage(
        &app,
        "POST",
        "/api/karte/offline-karten/bauen",
        Some(&cookie),
        Some(r#"{"slug":""}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

// ===== GET /api/karte/offline-karten/baubare-regionen + /bau-status (Read-Proxies, LFH-203/B3) =====

#[tokio::test]
async fn baubare_regionen_ohne_service_config_liefert_leere_liste() {
    // Standard-Helfer: karten_service_url/-token beide None → Feature aus, aber lesend (kein 501
    // wie bei `bauen` — die Admin-UI-Liste soll einfach leer bleiben, kein Fehlerzustand).
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/offline-karten/baubare-regionen",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert!(
        v.as_array().unwrap().is_empty(),
        "leere Liste ohne Service-Konfiguration: {v:?}"
    );
}

#[tokio::test]
async fn bau_status_ohne_service_config_liefert_leere_liste() {
    let (app, cookie) = admin_app().await;
    let res = anfrage(
        &app,
        "GET",
        "/api/karte/offline-karten/bau-status",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert!(
        v.as_array().unwrap().is_empty(),
        "leere Liste ohne Service-Konfiguration: {v:?}"
    );
}

/// Mini-Mock des zentralen karten-service für die beiden Read-Proxies (Muster:
/// `spawn_karten_service_mock` oben, hier aber `GET /regions` + `GET /builds`). Prüft das
/// weitergereichte Bearer-Token und liefert realistische Service-Antworten — `/builds` insbesondere
/// mit VERSCHACHTELTEM `status`-Objekt (mirrort die reale karten-service-Serialisierung), damit der
/// Test echte Raw-Passthrough-Treue prüft statt eines geflachten Test-Fixtures.
async fn spawn_regionen_und_builds_mock(erwartetes_token: &'static str) -> String {
    use axum::routing::get;
    use axum::Router;

    fn pruefe_bearer(headers: &axum::http::HeaderMap, erwartetes_token: &str) {
        let auth = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        assert_eq!(
            auth,
            format!("Bearer {erwartetes_token}"),
            "Bearer-Token weitergereicht"
        );
    }

    let mock = Router::new()
        .route(
            "/regions",
            get(move |headers: axum::http::HeaderMap| async move {
                pruefe_bearer(&headers, erwartetes_token);
                axum::Json(serde_json::json!([
                    {"slug": "bayern", "name": "Bayern", "region": "DE-BY", "gruppe": "Bundesländer"}
                ]))
            }),
        )
        .route(
            "/builds",
            get(move |headers: axum::http::HeaderMap| async move {
                pruefe_bearer(&headers, erwartetes_token);
                axum::Json(serde_json::json!([
                    {
                        "id": 1,
                        "slug": "bayern",
                        "status": { "status": "building" },
                        "gestartet": "2026-01-01T00:00:00Z",
                        "beendet": null
                    }
                ]))
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, mock).await.unwrap();
    });
    format!("http://127.0.0.1:{}", addr.port())
}

#[tokio::test]
async fn baubare_regionen_und_bau_status_forwarden_service_antwort_roh() {
    let mock_url = spawn_regionen_und_builds_mock("t").await;
    let (app, cookie) = admin_app_mit_karten_service(&mock_url, "t").await;

    let regionen_res = anfrage(
        &app,
        "GET",
        "/api/karte/offline-karten/baubare-regionen",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(regionen_res.status(), StatusCode::OK);
    let regionen = json(regionen_res).await;
    assert_eq!(
        regionen[0]["slug"], "bayern",
        "Region unverändert durchgereicht: {regionen:?}"
    );

    let status_res = anfrage(
        &app,
        "GET",
        "/api/karte/offline-karten/bau-status",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(status_res.status(), StatusCode::OK);
    let status = json(status_res).await;
    // Verschachteltes status.status statt geflacht — Raw-Passthrough-Beweis (kein Reshape).
    assert_eq!(
        status[0]["status"]["status"], "building",
        "verschachtelter Build-Status unverändert durchgereicht: {status:?}"
    );
}
