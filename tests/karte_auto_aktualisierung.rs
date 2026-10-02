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

// ===== Nachgebauter karten-service =====

/// Stand des Mock-Dienstes: Jobs, angestoßene Bauten, baubare Regionen, Zeitplan.
#[derive(Clone, Default)]
struct Dienst {
    jobs: Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
    posts: Arc<std::sync::Mutex<Vec<String>>>,
}

impl Dienst {
    fn job(&self, id: u64, slug: &str, status: &str) {
        self.jobs.lock().unwrap().push(serde_json::json!({
            "id": id, "slug": slug, "status": {"status": status},
            "gestartet": "2026-10-02T03:00:00Z"
        }));
    }
    fn posts(&self) -> Vec<String> {
        self.posts.lock().unwrap().clone()
    }
}

/// Startet den Mock. `mit_zeitplan = false` bildet einen älteren Dienst ohne `/zeitplan` nach.
async fn dienst_starten(d: &Dienst, mit_zeitplan: bool) -> String {
    use axum::extract::State;
    use axum::routing::{get, post};
    use axum::Json;
    let mut app = axum::Router::new()
        .route(
            "/builds",
            post(
                |State(d): State<Dienst>, Json(b): Json<serde_json::Value>| async move {
                    let slug = b["slug"].as_str().unwrap().to_string();
                    let id = 100 + d.posts.lock().unwrap().len() as u64;
                    d.posts.lock().unwrap().push(slug.clone());
                    d.job(id, &slug, "queued");
                    (StatusCode::ACCEPTED, Json(serde_json::json!({ "job_id": id })))
                },
            )
            .get(|State(d): State<Dienst>| async move {
                Json(serde_json::Value::Array(d.jobs.lock().unwrap().clone()))
            }),
        )
        .route(
            "/regions",
            get(|| async {
                Json(serde_json::json!([
                    {"slug": "bremen", "name": "Bremen", "region": "DE-HB", "gruppe": "Bundesländer"},
                    {"slug": "hamburg", "name": "Hamburg", "region": "DE-HH", "gruppe": "Bundesländer"}
                ]))
            }),
        );
    if mit_zeitplan {
        app = app.route(
            "/zeitplan",
            get(|| async {
                Json(serde_json::json!({
                    "naechster_lauf": "2027-01-01T03:00:00+00:00",
                    "cron": "0 0 3 1 1,4,7,10 *"
                }))
            }),
        );
    }
    let app = app.with_state(d.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://127.0.0.1:{}", addr.port())
}

async fn aufbau_mit_dienst(url: String) -> Aufbau {
    aufbau_mit(move |s| {
        s.karten_service_url = Some(url);
        s.karten_service_token = Some("t".into());
    })
    .await
}

/// Ein Nicht-Admin derselben Organisation: `fuehrungskraft` liest den Admin-Bereich, `keine` nicht.
async fn nutzer(a: &Aufbau, name: &str, org_rolle: &str) -> String {
    common::benutzer_anlegen(&a.app, &a.admin, name, org_rolle).await;
    login_cookie(&a.app, name, &format!("{name}pw1")).await
}

fn jetzt_uri(id: i64) -> String {
    format!("/api/karte/offline-karten/{id}/jetzt-aktualisieren")
}

const STATUS_URI: &str = "/api/karte/offline-karten/aktualisierung";
const EINSTELLUNG_URI: &str = "/api/karte/offline-karten/aktualisierung/einstellung";

// ===== Task 5.1: POST …/{id}/jetzt-aktualisieren =====

#[tokio::test]
async fn jetzt_aktualisieren_nur_fuer_admins() {
    let a = aufbau().await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    let fk = nutzer(&a, "fuehrungskraft1", "fuehrungskraft").await;
    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&fk), None).await;
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn jetzt_aktualisieren_registrierte_karte_ist_422() {
    let a = aufbau().await;
    let res = anfrage(
        &a.app,
        "POST",
        "/api/karte/offline-karten",
        Some(&a.admin),
        Some(r#"{"name":"Eigen","pfad":"eigen.mbtiles","lizenz":"© OSM"}"#),
    )
    .await;
    let id = json(res).await["id"].as_i64().unwrap();
    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let res = anfrage(&a.app, "POST", &jetzt_uri(9999), Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn jetzt_aktualisieren_bei_laufendem_download_ist_422() {
    let a = aufbau().await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    assert!(lifeline_hub::karte::download::reserviere_fortschritt(
        &a.state.download_fortschritt,
        id,
        Arc::new(lifeline_hub::karte::download::Fortschritt::default()),
    ));
    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn jetzt_aktualisieren_laedt_vorhandenen_neueren_stand_ohne_bau() {
    let d = Dienst::default();
    let a = aufbau_mit_dienst(dienst_starten(&d, true).await).await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    a.katalog.setze(vec![neuer_eintrag("Bremen", "bremen")]);

    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;

    assert_eq!(res.status(), StatusCode::ACCEPTED);
    assert_eq!(json(res).await["phase"], "laedt");
    assert_eq!(a.lader.starts().len(), 1);
    assert!(d.posts().is_empty(), "kein Neubau");
}

#[tokio::test]
async fn jetzt_aktualisieren_stoesst_genau_einen_bau_an() {
    let d = Dienst::default();
    let a = aufbau_mit_dienst(dienst_starten(&d, true).await).await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;

    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;

    assert_eq!(res.status(), StatusCode::ACCEPTED);
    assert_eq!(json(res).await["phase"], "bau_wartet");
    assert_eq!(d.posts(), vec!["bremen".to_string()]);
    // Ein zweiter Anstoß, solange der Bau aussteht, ist ein Zustandsfehler.
    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(d.posts().len(), 1);
}

#[tokio::test]
async fn jetzt_aktualisieren_haengt_sich_an_laufenden_bau() {
    let d = Dienst::default();
    d.job(7, "bremen", "building");
    let a = aufbau_mit_dienst(dienst_starten(&d, true).await).await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;

    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;

    assert_eq!(res.status(), StatusCode::ACCEPTED);
    assert_eq!(json(res).await["phase"], "baut");
    assert!(d.posts().is_empty(), "kein zweiter Bau");
}

#[tokio::test]
async fn jetzt_aktualisieren_ohne_dienst_meldet_aktuell() {
    let a = aufbau().await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(json(res).await["phase"], "aktuell");
    assert!(a.lader.starts().is_empty());
}

#[tokio::test]
async fn jetzt_aktualisieren_unerreichbarer_dienst_ist_502() {
    let a = aufbau_mit_dienst("http://127.0.0.1:1".into()).await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::BAD_GATEWAY);
}

// ===== Task 5.2: GET …/aktualisierung =====

#[tokio::test]
async fn status_lesbar_fuer_fuehrungskraft_nicht_fuer_andere() {
    let a = aufbau().await;
    let fk = nutzer(&a, "fuehrungskraft1", "fuehrungskraft").await;
    let keine = nutzer(&a, "helferin1", "keine").await;
    assert_eq!(
        anfrage(&a.app, "GET", STATUS_URI, Some(&fk), None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        anfrage(&a.app, "GET", STATUS_URI, Some(&keine), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn status_ohne_dienst() {
    let a = aufbau().await;
    let v = json(anfrage(&a.app, "GET", STATUS_URI, Some(&a.admin), None).await).await;
    assert_eq!(v["automatisch"], true);
    assert_eq!(v["intervall_stunden"], 6);
    assert_eq!(v["bau_dienst"], "nicht_konfiguriert");
    assert!(v.get("naechster_bau_at").is_none());
    assert!(
        v.get("letzte_pruefung_at").is_none(),
        "vor der ersten Prüfung"
    );
}

#[tokio::test]
async fn status_unerreichbarer_dienst_bleibt_200() {
    let a = aufbau_mit_dienst("http://127.0.0.1:1".into()).await;
    let res = anfrage(&a.app, "GET", STATUS_URI, Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(json(res).await["bau_dienst"], "unerreichbar");
}

#[tokio::test]
async fn status_zeigt_geplanten_bau_und_naechsten_lauf() {
    let d = Dienst::default();
    d.job(3, "bremen", "building");
    let a = aufbau_mit_dienst(dienst_starten(&d, true).await).await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    heruntergeladene_karte(&a.pool, "Hamburg", "hamburg").await;

    let v = json(anfrage(&a.app, "GET", STATUS_URI, Some(&a.admin), None).await).await;

    assert_eq!(v["bau_dienst"], "erreichbar");
    assert_eq!(v["naechster_bau_at"], "2027-01-01T03:00:00+00:00");
    let karten = v["karten"].as_array().unwrap();
    assert_eq!(karten.len(), 1, "nur Karten mit Phase oder Fehler: {v}");
    assert_eq!(karten[0]["karte_id"], id);
    assert_eq!(karten[0]["phase"], "baut");
}

#[tokio::test]
async fn status_aelterer_dienst_ohne_zeitplan() {
    let d = Dienst::default();
    let a = aufbau_mit_dienst(dienst_starten(&d, false).await).await;
    let v = json(anfrage(&a.app, "GET", STATUS_URI, Some(&a.admin), None).await).await;
    assert_eq!(v["bau_dienst"], "erreichbar");
    assert!(v.get("naechster_bau_at").is_none());
}

#[tokio::test]
async fn status_nennt_laufenden_download_und_fehler() {
    let a = aufbau().await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    let andere = heruntergeladene_karte(&a.pool, "Hamburg", "hamburg").await;
    a.katalog.setze(vec![neuer_eintrag("Bremen", "bremen")]);
    anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;
    a.state
        .auto_aktualisierung
        .zustand()
        .fehler
        .insert(andere, "SHA256 stimmt nicht".into());

    let v = json(anfrage(&a.app, "GET", STATUS_URI, Some(&a.admin), None).await).await;

    let karte = |kid: i64| {
        v["karten"]
            .as_array()
            .unwrap()
            .iter()
            .find(|k| k["karte_id"] == kid)
            .cloned()
            .unwrap()
    };
    assert_eq!(karte(id)["phase"], "laedt");
    assert_eq!(karte(andere)["fehler"], "SHA256 stimmt nicht");
}

// ===== Task 5.3: PUT …/aktualisierung/einstellung =====

#[tokio::test]
async fn einstellung_nur_admin() {
    let a = aufbau().await;
    let fk = nutzer(&a, "fuehrungskraft1", "fuehrungskraft").await;
    let res = anfrage(
        &a.app,
        "PUT",
        EINSTELLUNG_URI,
        Some(&fk),
        Some(r#"{"automatisch":false,"intervall_stunden":6}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn einstellung_ausserhalb_des_bereichs_ist_400() {
    let a = aufbau().await;
    for h in [0, 169] {
        let res = anfrage(
            &a.app,
            "PUT",
            EINSTELLUNG_URI,
            Some(&a.admin),
            Some(&format!(
                r#"{{"automatisch":false,"intervall_stunden":{h}}}"#
            )),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "{h} h");
    }
    let v = json(anfrage(&a.app, "GET", STATUS_URI, Some(&a.admin), None).await).await;
    assert_eq!(v["automatisch"], true, "Einstellung unverändert");
    assert_eq!(v["intervall_stunden"], 6);
}

#[tokio::test]
async fn einstellung_wirkt_und_uebersteht_neustart() {
    let a = aufbau().await;
    let res = anfrage(
        &a.app,
        "PUT",
        EINSTELLUNG_URI,
        Some(&a.admin),
        Some(r#"{"automatisch":false,"intervall_stunden":12}"#),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK);
    let v = json(res).await;
    assert_eq!(v["automatisch"], false);
    assert_eq!(v["intervall_stunden"], 12);
    assert!(
        v.get("naechste_pruefung_at").is_none(),
        "aus: keine nächste Prüfung"
    );

    // Neustart: neuer AppState auf derselben DB, frischer Wächterzustand.
    let neu = lifeline_hub::app::build_router(AppState {
        auto_aktualisierung: AutoAktualisierung::mit(
            Einstellung::default(),
            Arc::new(FesterKatalog::default()),
            Arc::new(AufzeichnenderLader::default()),
        ),
        ..common::test_state(&a.pool, &lifeline_hub::live::LiveHub::new())
    });
    let admin = login_cookie(&neu, "admin", "startpw12").await;
    let v = json(anfrage(&neu, "GET", STATUS_URI, Some(&admin), None).await).await;
    assert_eq!(v["automatisch"], false);
    assert_eq!(v["intervall_stunden"], 12);
}

// ===== Review-Funde =====

#[tokio::test]
async fn jetzt_aktualisieren_fehlerhafte_karte_ist_422() {
    let d = Dienst::default();
    let a = aufbau_mit_dienst(dienst_starten(&d, true).await).await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    repo::setze_status(&a.pool, id, "fehler").await.unwrap();
    let res = anfrage(&a.app, "POST", &jetzt_uri(id), Some(&a.admin), None).await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        d.posts().is_empty(),
        "kein Bau für eine nicht bereite Karte"
    );
}

#[tokio::test]
async fn geloeschte_karte_vererbt_keinen_fehler() {
    let a = aufbau().await;
    let id = heruntergeladene_karte(&a.pool, "Bremen", "bremen").await;
    a.state
        .auto_aktualisierung
        .zustand()
        .fehler
        .insert(id, "SHA256 stimmt nicht".into());
    let res = anfrage(
        &a.app,
        "DELETE",
        &format!("/api/karte/offline-karten/{id}"),
        Some(&a.admin),
        None,
    )
    .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    // SQLite vergibt ohne AUTOINCREMENT die höchste id neu.
    let neu = heruntergeladene_karte(&a.pool, "Hamburg", "hamburg").await;
    assert_eq!(neu, id, "Vorbedingung: id wiederverwendet");

    let v = json(anfrage(&a.app, "GET", STATUS_URI, Some(&a.admin), None).await).await;
    assert!(
        v["karten"].as_array().unwrap().is_empty(),
        "kein geerbter Fehler: {v}"
    );
}
