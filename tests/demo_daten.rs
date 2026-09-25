//! LFH-690: Demo-Daten zur Laufzeit — Freischaltung und Rechte der Endpunkte.
//!
//! Spec: `openspec/changes/lfh-690-demo-daten-laufzeit-import/specs/demo-daten/spec.md`,
//! Anforderungen „Freischaltung per Umgebungsvariable“ und „Nur der System-Admin, nur die
//! eigene Organisation“; Herleitung in `design.md` D1–D3.

mod common;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use serde_json::Value;
use tower::ServiceExt;

/// Alle Demo-Endpunkte als `(Methode, Pfad)`.
const ENDPUNKTE: &[(&str, &str)] = &[
    ("GET", "/api/demo-daten"),
    ("POST", "/api/demo-daten"),
    ("DELETE", "/api/demo-daten"),
    ("POST", "/api/demo-daten/neu"),
];

/// Ein garantiert nicht registrierter `/api/`-Pfad als Vergleichsmaßstab.
const UNBEKANNT: &str = "/api/gibt-es-garantiert-nicht";

/// Antwort in Rohform: Status, Content-Type und Body-Bytes.
async fn roh(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: Option<&str>,
) -> (StatusCode, String, Vec<u8>) {
    let mut req = Request::builder().method(methode).uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c.to_string());
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let ct = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<fehlt>")
        .to_string();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, ct, bytes)
}

/// Ohne Freischaltung ist jeder Demo-Pfad von einem unbekannten `/api/`-Pfad nicht zu
/// unterscheiden: 404, gleicher Content-Type, gleicher Body — anonym wie als Admin, bei jeder
/// Methode. Ein 401/403/405 verriete, dass der Pfad existiert.
#[tokio::test]
async fn ohne_freischaltung_antworten_alle_demo_pfade_wie_ein_unbekannter_pfad() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen::default()).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    for cookie in [None, Some(admin.as_str())] {
        let wer = if cookie.is_some() { "Admin" } else { "anonym" };
        for (methode, pfad) in ENDPUNKTE {
            let (ref_status, ref_ct, ref_body) = roh(&app, methode, UNBEKANNT, cookie).await;
            assert_eq!(
                ref_status,
                StatusCode::NOT_FOUND,
                "Vergleichspfad muss 404 sein"
            );

            let (status, ct, body) = roh(&app, methode, pfad, cookie).await;
            assert!(
                ![
                    StatusCode::UNAUTHORIZED,
                    StatusCode::FORBIDDEN,
                    StatusCode::METHOD_NOT_ALLOWED
                ]
                .contains(&status),
                "[{wer}] {methode} {pfad}: {status} verrät den Pfad"
            );
            assert_eq!(status, ref_status, "[{wer}] {methode} {pfad}: Status");
            assert_eq!(ct, ref_ct, "[{wer}] {methode} {pfad}: Content-Type");
            assert_eq!(
                body,
                ref_body,
                "[{wer}] {methode} {pfad}: Body {:?}",
                String::from_utf8_lossy(&body)
            );
            let json: Value = serde_json::from_slice(&body).expect("Body ist JSON");
            assert!(json["error"].is_string(), "Envelope mit `error`: {json}");
        }
    }
}

/// Mit Freischaltung: anonym 401 auf jedem Endpunkt.
#[tokio::test]
async fn mit_freischaltung_anonym_401() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    for (methode, pfad) in ENDPUNKTE {
        let (status, _ct, _body) = roh(&app, methode, pfad, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{methode} {pfad}");
    }
}

/// Mit Freischaltung: eine Führungskraft (Zugang zur Verwaltung, aber kein System-Admin)
/// bekommt auf jedem Endpunkt 403.
#[tokio::test]
async fn mit_freischaltung_fuehrungskraft_403() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    common::benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = common::login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    for (methode, pfad) in ENDPUNKTE {
        let (status, _ct, _body) = roh(&app, methode, pfad, Some(&fk)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
}

/// Mit Freischaltung: der Admin bekommt den Status „nicht importiert“ ohne Kopf und ohne
/// Bericht. Die Felder sind abwesend, nicht `null` (LFH-265).
#[tokio::test]
async fn mit_freischaltung_admin_status_nicht_importiert() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    let (status, v) = common::anfrage(&app, "GET", "/api/demo-daten", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v["importiert"], Value::Bool(false));
    let o = v.as_object().expect("Objekt");
    assert!(!o.contains_key("import"), "import muss ABSENT sein: {v}");
    assert!(!o.contains_key("bericht"), "bericht muss ABSENT sein: {v}");
}

/// Mit Freischaltung: die schreibenden Endpunkte sind bis Block 5 Platzhalter und melden
/// 422 im Envelope — kein Stub darf still „Erfolg“ melden.
#[tokio::test]
async fn mit_freischaltung_schreibende_endpunkte_sind_noch_422() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    for (methode, pfad) in ENDPUNKTE.iter().filter(|(m, _)| *m != "GET") {
        let (status, v) = common::anfrage(&app, methode, pfad, &admin, None).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{methode} {pfad}: {v}"
        );
        assert!(v["error"].is_string(), "{methode} {pfad}: {v}");
    }
}

/// `build_router` ist die Vorgabe „aus“: ohne Optionen gibt es keinen Demo-Pfad.
#[tokio::test]
async fn build_router_ohne_optionen_hat_keinen_demo_pfad() {
    let app = common::setup().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (status, _ct, _body) = roh(&app, "GET", "/api/demo-daten", Some(&admin)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Importiert direkt über `importieren_tx` gegen den Pool des Test-States (die HTTP-Route
/// kommt in Block 5). `write_retry!` ist außerhalb des Crates nicht nutzbar (seine Helfer in
/// `tx` sind crate-privat); `BEGIN IMMEDIATE` plus Commit ist derselbe Transaktionsmodus ohne
/// Retry, und in diesem Test schreibt niemand nebenher. `jetzt` ist die echte Uhr, damit die
/// Lese-Endpunkte „überfällig“ gegen ihre eigene Zeit rechnen.
async fn demo_importieren(pool: &sqlx::SqlitePool) -> (i64, chrono::NaiveDateTime) {
    let (org, admin_id): (i64, i64) =
        sqlx::query_as("SELECT org_id, id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(pool)
            .await
            .unwrap();
    let jetzt = chrono::Utc::now().naive_utc();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let erg = lifeline_hub::demo::import::importieren_tx(&mut tx, org, admin_id, jetzt)
        .await
        .expect("importieren");
    tx.commit().await.unwrap();
    (erg.einsatz_id, jetzt)
}

/// Liste eines Lese-Endpunkts des Demo-Einsatzes, als der importierende Admin gelesen. Ein
/// Modul, das eine Org-Vorgabe ausblendet, antwortet 403 und fällt hier auf.
async fn liste(app: &axum::Router, cookie: &str, einsatz: i64, pfad: &str) -> Vec<Value> {
    let (status, v) = common::anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}{pfad}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{pfad}: {v}");
    v.as_array()
        .unwrap_or_else(|| panic!("{pfad}: keine Liste: {v}"))
        .clone()
}

/// LFH-690 Task 4.3: nach dem Import trägt jedes Modul des Demo-Einsatzes Datensätze, gelesen
/// über die echten GET-Endpunkte als der importierende Admin. Dazu die Spec-Szenarien
/// „Überblick zeigt die Lage“ (Übung in der Einsatzliste, Lagekennzahl `evakuiert`, keine
/// `pegel`), „Sichtung nach BBK“ und „Einzige Mitgliedschaft“ über die API.
#[tokio::test]
async fn import_ist_je_modul_ueber_die_lese_endpunkte_sichtbar() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (e, jetzt) = demo_importieren(&pool).await;

    // Überblick zeigt die Lage.
    let (status, einsatz) =
        common::anfrage(&app, "GET", &format!("/api/einsaetze/{e}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{einsatz}");
    assert_eq!(einsatz["einsatzart"], "uebung");
    assert_eq!(einsatz["lagekennzahlen"], serde_json::json!(["evakuiert"]));
    let (status, alle) = common::anfrage(&app, "GET", "/api/einsaetze", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let in_liste: Vec<&Value> = alle
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["id"] == e)
        .collect();
    assert_eq!(in_liste.len(), 1);
    assert_eq!(in_liste[0]["einsatzart"], "uebung");
    assert_eq!(
        in_liste[0]["lagekennzahlen"],
        serde_json::json!(["evakuiert"])
    );

    // Einzige Mitgliedschaft.
    let mitglieder = liste(&app, &admin, e, "/mitglieder").await;
    assert_eq!(mitglieder.len(), 1, "{mitglieder:?}");

    // Je Modul die Zahl aus dem Drehbuch.
    for (pfad, n) in [
        ("/abschnitte", 4),
        ("/einheiten", 5),
        ("/fahrzeuge", 8),
        ("/personal", 12),
        ("/personen", 12),
        ("/uhs", 1),
        ("/bereitstellungsraeume", 1),
        ("/zonen", 2),
        ("/gefahrengebiete", 2),
        ("/meldungen", 8),
        ("/auftraege", 5),
        ("/befehle", 1),
        ("/lageberichte", 1),
        ("/erinnerungen", 3),
    ] {
        assert_eq!(liste(&app, &admin, e, pfad).await.len(), n, "{pfad}");
    }
    assert!(!liste(&app, &admin, e, "/etb").await.is_empty());

    // Betreuung: ein Bezirk, eine Stelle.
    let (status, betreuung) = common::anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/betreuung"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{betreuung}");
    assert_eq!(betreuung["bezirke"].as_array().unwrap().len(), 1);
    assert_eq!(betreuung["stellen"].as_array().unwrap().len(), 1);

    // Sichtung nach BBK: jede Kategorie SK I–IV mindestens einmal.
    let personen = liste(&app, &admin, e, "/personen").await;
    for sk in ["sk1", "sk2", "sk3", "sk4"] {
        assert!(
            personen.iter().any(|p| p["aktuelle_sichtung"] == sk),
            "{sk} fehlt"
        );
    }

    // Rückmeldungen: fünf Einheiten, genau eine überfällig (Frist gegen die echte Uhr).
    let (status, rm) = common::anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/meldungen/rueckmeldungen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rm}");
    let einheiten = rm["einheiten"].as_array().unwrap();
    assert_eq!(einheiten.len(), 5, "{rm}");
    let jetzt = jetzt.format("%Y-%m-%d %H:%M:%S").to_string();
    let ueberfaellig = einheiten
        .iter()
        .filter(|r| r["faellig_at"].as_str().unwrap() < jetzt.as_str())
        .count();
    assert_eq!(ueberfaellig, 1, "{rm}");

    // Befehl und Lagebericht freigegeben.
    assert_eq!(
        liste(&app, &admin, e, "/befehle").await[0]["status"],
        "freigegeben"
    );
    assert_eq!(
        liste(&app, &admin, e, "/lageberichte").await[0]["status"],
        "freigegeben"
    );
}
