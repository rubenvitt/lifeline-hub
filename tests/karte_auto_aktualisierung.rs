//! LFH-993: Automatische Aktualisierung der Offline-Karten — „Jetzt aktualisieren“, Status- und
//! Einstellungs-Endpunkt. Spec `offline-karten-aktualisierung`.
//!
//! Katalog und Lader kommen aus `auto_aktualisierung::testhilfen`: Der prozessweite
//! Manifest-Cache lässt sich nicht je Test befüllen, und der SSRF-Guard verwehrt Downloads von
//! Loopback-Adressen. Der echte In-Place-Tausch ist in `src/routes/karte.rs` und im Wächter-Modul
//! belegt.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use axum::response::Response;
use lifeline_hub::app::AppState;
use lifeline_hub::config::OfflineKatalogEintrag;
use lifeline_hub::karte::auto_aktualisierung::testhilfen::{AufzeichnenderLader, FesterKatalog};
use lifeline_hub::karte::auto_aktualisierung::{AutoAktualisierung, Einstellung};
use lifeline_hub::karte::registry::repo;
use std::sync::Arc;
use tower::ServiceExt;

mod common;
use common::login_cookie;

/// Testaufbau mit festem Katalog und aufzeichnendem Lader.
struct Aufbau {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    state: AppState,
    katalog: Arc<FesterKatalog>,
    lader: Arc<AufzeichnenderLader>,
    admin: String,
}

async fn aufbau_mit(anpassen: impl FnOnce(&mut AppState)) -> Aufbau {
    let katalog = Arc::new(FesterKatalog::default());
    let lader = Arc::new(AufzeichnenderLader::default());
    let auto = AutoAktualisierung::mit(Einstellung::default(), katalog.clone(), lader.clone());
    let mut gefangen = None;
    let (app, pool) = common::setup_mit_state(|s| {
        s.karten_dir = lifeline_hub::db::test_karten_dir();
        s.auto_aktualisierung = auto;
        anpassen(s);
        gefangen = Some(s.clone());
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    Aufbau {
        app,
        pool,
        state: gefangen.expect("State angepasst"),
        katalog,
        lader,
        admin,
    }
}

async fn aufbau() -> Aufbau {
    aufbau_mit(|_| {}).await
}

async fn anfrage(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<&str>,
) -> Response {
    let mut b = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    let rumpf = match body {
        Some(j) => {
            b = b.header(header::CONTENT_TYPE, "application/json");
            Body::from(j.to_string())
        }
        None => Body::empty(),
    };
    app.clone().oneshot(b.body(rumpf).unwrap()).await.unwrap()
}

async fn json(res: Response) -> serde_json::Value {
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
}

const SHA_ALT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_NEU: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/// Eine heruntergeladene, bereite Karte (gemanagter Pfad) mit datierter Quell-URL.
async fn heruntergeladene_karte(pool: &sqlx::SqlitePool, name: &str, slug: &str) -> i64 {
    let k = repo::neue_download_karte(
        pool,
        &repo::OfflineDownloadEingabe {
            name: name.into(),
            quell_url: format!("https://cdn.example/maps/{slug}.20260701.shortbread.mbtiles"),
            lizenz: "© OpenStreetMap contributors (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            format: "pbf".into(),
            sortier: 0,
        },
    )
    .await
    .unwrap();
    repo::markiere_bereit(pool, k.id, &format!("karte-{}.mbtiles", k.id), 10, SHA_ALT)
        .await
        .unwrap();
    k.id
}

/// Ein lieferbarer Katalogeintrag mit neuerem Stand.
fn neuer_eintrag(name: &str, slug: &str) -> OfflineKatalogEintrag {
    OfflineKatalogEintrag {
        name: name.into(),
        url: format!("https://cdn.example/maps/{slug}.20261001.shortbread.mbtiles"),
        region: "DE".into(),
        groesse: 10,
        lizenz: "© OpenStreetMap contributors (ODbL)".into(),
        kachel_schema: "shortbread".into(),
        quelle: "t".into(),
        sha256: Some(SHA_NEU.into()),
        gruppe: None,
    }
}

// ===== Task 3.3: Listenfeld `aktualisierbar` =====

#[tokio::test]
async fn liste_kennzeichnet_aktualisierbare_karten() {
    let a = aufbau().await;
    let geladen = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    let res = anfrage(
        &a.app,
        "POST",
        "/api/karte/offline-karten",
        Some(&a.admin),
        Some(r#"{"name":"Eigen","pfad":"eigen.mbtiles","lizenz":"© OSM"}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let registriert = json(res).await["id"].as_i64().unwrap();

    let liste = json(
        anfrage(
            &a.app,
            "GET",
            "/api/karte/offline-karten",
            Some(&a.admin),
            None,
        )
        .await,
    )
    .await;
    let feld = |id: i64| {
        liste
            .as_array()
            .unwrap()
            .iter()
            .find(|k| k["id"] == id)
            .unwrap()["aktualisierbar"]
            .clone()
    };
    assert_eq!(feld(geladen), true, "heruntergeladen mit Quell-URL");
    assert_eq!(feld(registriert), false, "registriert");
}
