#![allow(dead_code)]

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, build_router_mit, AppState, RouterOptionen};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::Value;
use std::time::Duration;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

pub async fn setup() -> axum::Router {
    setup_mit_pool().await.0
}

/// Wie `setup()`, liefert zusätzlich den (isolierten) Pool zurück — für Tests, die neben dem
/// Router auch direkten DB-Zugriff brauchen (z. B. eine `auth_provider`-Override-Zeile schreiben,
/// siehe `tests/auth.rs`s OIDC-Enforcement-Tests).
pub async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let (router, pool, _live) = setup_mit_pool_und_live().await;
    (router, pool)
}

/// Wie [`setup_mit_pool`], stellt zusaetzlich den geteilten LiveHub fuer Assertions auf
/// post-commit SSE-Publikationen bereit.
pub async fn setup_mit_pool_und_live() -> (axum::Router, sqlx::SqlitePool, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(test_state(&pool, &live));
    (router, pool, live)
}

/// Wie [`setup_mit_pool`], mit abweichendem `AppState` (eigenes `karten_dir`,
/// Fachebenen-Attrappe, karten-service).
pub async fn setup_mit_state(
    anpassen: impl FnOnce(&mut AppState),
) -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let mut state = test_state(&pool, &LiveHub::new());
    anpassen(&mut state);
    (build_router(state), pool)
}

/// Wie [`setup`], liefert zusätzlich den geteilten LiveHub.
pub async fn setup_mit_live() -> (axum::Router, LiveHub) {
    let (router, _pool, live) = setup_mit_pool_und_live().await;
    (router, live)
}

/// Wie [`setup_mit_pool`], aber mit gesetzten Router-Optionen (LFH-690: `demo_daten`).
/// Die Optionen reisen am Router, nicht im `AppState` — ein Test kann „aus“ und „an“ damit
/// im selben Binary nebeneinander prüfen.
pub async fn setup_mit_optionen(opt: RouterOptionen) -> (axum::Router, sqlx::SqlitePool) {
    let (router, pool, _live) = setup_mit_optionen_und_live(opt).await;
    (router, pool)
}

/// Wie [`setup_mit_optionen`], stellt zusätzlich den geteilten LiveHub bereit (LFH-690: das
/// `lagged`-Signal nach Entfernen und Neu-Import).
pub async fn setup_mit_optionen_und_live(
    opt: RouterOptionen,
) -> (axum::Router, sqlx::SqlitePool, LiveHub) {
    setup_mit_optionen_auf(db::test_pool().await, opt).await
}

/// Wie [`setup_mit_optionen_und_live`], aber auf einem mitgebrachten Pool — etwa
/// `db::test_pool_datei()` für Messungen mit Produktions-Parität (WAL, mehrere Verbindungen).
pub async fn setup_mit_optionen_auf(
    pool: sqlx::SqlitePool,
    opt: RouterOptionen,
) -> (axum::Router, sqlx::SqlitePool, LiveHub) {
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router_mit(test_state(&pool, &live), opt);
    (router, pool, live)
}

/// Der Test-`AppState` aller Setups. Abweichende Felder setzt [`setup_mit_state`] oder ein
/// Struct-Update (`AppState { karten_dir, ..test_state(..) }`).
pub fn test_state(pool: &sqlx::SqlitePool, live: &LiveHub) -> AppState {
    AppState {
        pool: pool.clone(),
        live: live.clone(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    }
}

/// Legt eine ZWEITE Organisation samt Benutzer an — die Voraussetzung für jeden
/// Cross-Org-Test (F05/LFH-232).
///
/// `bootstrap_admin` ist bewusst einmalig (es bricht ab, sobald ein Benutzer existiert),
/// deshalb geht die Fremd-Org direkt über SQL. Ohne diesen Helfer ist die Mandanten-Grenze
/// grundsätzlich unbeweisbar: mit nur einer Organisation ist jeder Org-Check trivial erfüllt,
/// und genau deshalb konnten die Lücken so lange unbemerkt bleiben.
///
/// Liefert `(org_id, benutzer_id)`. `org_rolle` ist z. B. `"fuehrungskraft"` oder `"keine"`,
/// `system_rolle` `"keiner"` (ein zweiter `admin` wäre serverweit berechtigt und würde
/// Org-Isolation gerade NICHT testen).
pub async fn fremde_org_anlegen(
    pool: &sqlx::SqlitePool,
    org_name: &str,
    benutzername: &str,
    passwort: &str,
    org_rolle: &str,
) -> (i64, i64) {
    let org_id: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) \
         VALUES (?, 'hilfsorganisation') RETURNING id",
    )
    .bind(org_name)
    .fetch_one(pool)
    .await
    .expect("Fremd-Org anlegen");

    let hash = lifeline_hub::auth::password::hash(passwort).expect("Passwort hashen");
    let benutzer_id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                               system_rolle, org_rolle) \
         VALUES (?, ?, ?, ?, 'keiner', ?) RETURNING id",
    )
    .bind(org_id)
    .bind(benutzername)
    .bind(benutzername)
    .bind(&hash)
    .bind(org_rolle)
    .fetch_one(pool)
    .await
    .expect("Fremd-Org-Benutzer anlegen");

    (org_id, benutzer_id)
}

pub async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
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
    assert_eq!(resp.status(), StatusCode::OK);
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

/// Admin legt einen Nicht-Admin-Benutzer an; gibt dessen id zurück.
pub async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    name: &str,
    org_rolle: &str,
) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_i64()
        .unwrap()
}

/// Generischer Request-Helfer: liefert (Status, JSON-Body).
pub async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Wie [`anfrage`], mit einem `serde_json::Value` als Body.
pub async fn anfrage_json(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    let body = body.map(Value::to_string);
    anfrage(app, methode, uri, cookie, body.as_deref()).await
}

/// Wie [`anfrage`], aber mit dem Besitz-Nachweis eines Offline-Queue-Eintrags.
pub async fn anfrage_mit_offline_queue_benutzer(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
    benutzer_id: i64,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string())
        .header("X-Offline-Queue-Benutzer-Id", benutzer_id.to_string());
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

pub async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    einsatz_anlegen_mit(app, cookie, "Lage").await
}

/// Wie [`einsatz_anlegen`], mit eigener Bezeichnung.
pub async fn einsatz_anlegen_mit(app: &axum::Router, cookie: &str, bezeichnung: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(&format!(r#"{{"bezeichnung":"{bezeichnung}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "einsatz_anlegen: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Legt eine betroffene Person (`…/personen`) mit dem gegebenen JSON-Body an; liefert ihre id.
pub async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Legt eine Stamm-Person (`/api/personal`) an; liefert deren id.
pub async fn stammpersonal_anlegen(app: &axum::Router, admin: &str, name: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Legt eine Stamm-Person an und disponiert sie in den Einsatz; liefert die
/// `einsatz_personal.id`.
pub async fn stammpersonal_disponieren(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
) -> i64 {
    let pid = stammpersonal_anlegen(app, cookie, name).await;
    let (status, dispo) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&format!(r#"{{"personal_id":{pid}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    dispo["id"].as_i64().unwrap()
}

/// Bildet eine Einheit im Einsatz; liefert ihre id.
pub async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "einheit_bilden: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Seedet (via GET) und liefert die id der Standardansicht des Einsatzes (LFH-320).
pub async fn standard_ansicht_id(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (status, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karten-ansichten"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "karten-ansichten GET: {v:?}");
    v[0]["id"].as_i64().unwrap()
}

/// Legt eine zweite, benannte Kartenansicht an und liefert ihre id (LFH-320).
pub async fn karten_ansicht_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
) -> i64 {
    let (status, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/karten-ansichten"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "karten-ansicht anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

/// Weist einem Benutzer eine Einsatz-Rolle zu (durch die Einsatzleitung).
pub async fn rolle_setzen(
    app: &axum::Router,
    leit_cookie: &str,
    einsatz: i64,
    benutzer_id: i64,
    rolle: &str,
) {
    let (status, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit_cookie,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

/// Zählt ETB-Einträge mit typ='system'.
pub async fn system_etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .count()
}

/// Die Inhalte der ETB-Einträge mit typ='system'.
pub async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

/// Liest vom Live-Kanal, bis ein Event mit `tag` kommt; Timeout oder geschlossener Kanal
/// lassen den Test scheitern.
pub async fn recv_until_tag(
    rx: &mut Receiver<LiveNachricht>,
    tag: &str,
    timeout: Duration,
) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv())
            .await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event.as_str() == tag {
            return n;
        }
    }
}

/// Öffnet `/live` für `cookie` und liefert die Response (Body bleibt offen).
pub async fn live_oeffnen(app: &axum::Router, cookie: &str, eid: i64) -> axum::response::Response {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{eid}/live"))
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp
}

/// Liest den Anfang eines OFFENEN SSE-Stroms: sammelt Frames, bis für `stille_ms` nichts
/// mehr kommt. `to_bytes` scheidet aus — ein Live-Feed endet nie von selbst.
pub async fn sse_anfang_lesen(body: Body, stille_ms: u64) -> String {
    use http_body_util::BodyExt;
    let mut body = body;
    let mut gelesen = String::new();
    while let Ok(Some(Ok(frame))) = tokio::time::timeout(
        Duration::from_millis(stille_ms),
        std::pin::Pin::new(&mut body).frame(),
    )
    .await
    {
        if let Some(daten) = frame.data_ref() {
            gelesen.push_str(&String::from_utf8_lossy(daten));
        }
    }
    gelesen
}

/// LFH-21: legt per direktem SQL einen Schaden (S-00n) samt Anhang und Linker
/// `einsatz_schaden_anhang` an und liefert die `anhang.id`. **Hochgeladen von `admin`** —
/// die Abschottungstests laufen als die ablegende Person (design.md D12): als jemand anderes
/// wären sie auch ohne Registereintrag grün, weil ein ungebundener Anhang für Fremde ohnehin
/// 404 ist.
pub async fn schaden_anhang(pool: &sqlx::SqlitePool, einsatz: i64) -> i64 {
    let von: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap();
    let schaden: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_schaden \
           (einsatz_id, registrier_nr, typ, ausmass, ort, erfasst_von, geaendert_von) \
         VALUES (?, (SELECT COALESCE(MAX(registrier_nr), 0) + 1 FROM einsatz_schaden \
                     WHERE einsatz_id = ?), 'sachschaden', 'gering', 'Hauptstr. 1', ?, ?) \
         RETURNING id",
    )
    .bind(einsatz)
    .bind(einsatz)
    .bind(von)
    .bind(von)
    .fetch_one(pool)
    .await
    .unwrap();
    let aid: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'dach.jpg', 'image/jpeg', 3, 'deadbeef', ?, ?) RETURNING id",
    )
    .bind(einsatz)
    .bind(b"ABC".as_slice())
    .bind(von)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_schaden_anhang (einsatz_id, schaden_id, anhang_id, abgelegt_von_id) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz)
    .bind(schaden)
    .bind(aid)
    .bind(von)
    .execute(pool)
    .await
    .unwrap();
    aid
}

/// Multipart-POST mit Datei (Feld `datei`) und beliebigen Textfeldern; `datei = None` lässt das
/// Dateifeld weg.
pub async fn multipart_post(
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

/// Ein gültiges JPEG ohne Metadaten (LFH-747): läuft bytegleich durch die Bereinigung der
/// Auslieferung. Testdaten mit Bild-Endung brauchen echte Bildbytes, sonst antwortet der
/// Download mit 422 (`src/AGENTS.md`, „Anhänge“).
pub const MINI_JPEG: &[u8] = b"\xFF\xD8\
\xFF\xC0\x00\x0B\x08\x00\x10\x00\x10\x01\x01\x11\x00\
\xFF\xDA\x00\x08\x01\x01\x00\x00\x3F\x00\
JPEGDATEN\
\xFF\xD9";

/// Ein gültiges PNG ohne Metadaten (LFH-747), Gegenstück zu [`MINI_JPEG`]. Die CRCs prüft die
/// Bereinigung nicht; die Bytes laufen unverändert durch.
pub const MINI_PNG: &[u8] = b"\x89PNG\r\n\x1a\n\
\x00\x00\x00\x0DIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90\x77\x53\xDE\
\x00\x00\x00\x07IDATPNGDATA\x00\x00\x00\x00\
\x00\x00\x00\x00IEND\xAE\x42\x60\x82";
