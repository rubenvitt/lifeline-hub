//! Integrationstests für GET/PUT /api/benutzer-einstellungen (LFH-391 · Etappe D).
//!
//! Der Speicher ist ein Schlüssel/Wert-Fach **je Benutzer** — kein Org-, kein Einsatzbezug.
//! Getestet wird deshalb vor allem, was ihn von einer globalen Tabelle unterscheidet:
//! die Sitzungspflicht, die Trennung zweier Benutzer und der Wegfall beim Löschen.
//!
//! Statuscode-Konvention (LFH-267): jeder Fehlerfall hier bewertet **ein Feld isoliert**
//! (unbekannter Schlüssel, leerer Wert, Überlänge) → 400, nie 422.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup, setup_mit_pool};

const PFAD: &str = "/api/benutzer-einstellungen";
const ZULETZT: &str = "/api/benutzer-einstellungen/zuletzt_befehle";

/// GET ohne Cookie — der Sitzungsextraktor muss vor allem anderen greifen.
async fn get_ohne_cookie(app: &axum::Router, uri: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// PUT ohne Cookie.
async fn put_ohne_cookie(app: &axum::Router, uri: &str, body: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// Prüft die **Anwesenheit** eines Keys — `json["x"] == Null` unterscheidet einen fehlenden
/// Key nicht von einem `null`-Wert (serde_json indexiert beides auf `Null`).
fn hat_key(json: &Value, key: &str) -> bool {
    json.as_object()
        .expect("Antwort ist ein JSON-Objekt")
        .contains_key(key)
}

// ── Sitzungspflicht ─────────────────────────────────────────────────────────

#[tokio::test]
async fn lesen_ohne_sitzung_ist_401() {
    let app = setup().await;
    assert_eq!(get_ohne_cookie(&app, PFAD).await, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn setzen_ohne_sitzung_ist_401() {
    let app = setup().await;
    assert_eq!(
        put_ohne_cookie(&app, ZULETZT, r#"{"wert":"[\"a\"]"}"#).await,
        StatusCode::UNAUTHORIZED,
        "ohne Sitzung darf kein fremdes Fach beschrieben werden"
    );
}

/// Der unbekannte Schlüssel darf die 401 NICHT überholen — sonst verriete die Antwort
/// einem Unangemeldeten, welche Schlüssel der Server kennt.
#[tokio::test]
async fn setzen_ohne_sitzung_ist_401_auch_bei_unbekanntem_schluessel() {
    let app = setup().await;
    assert_eq!(
        put_ohne_cookie(
            &app,
            "/api/benutzer-einstellungen/gibts_nicht",
            r#"{"wert":"x"}"#
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

// ── Vorgabe + Roundtrip ─────────────────────────────────────────────────────

#[tokio::test]
async fn vorgabe_ist_leer_und_ohne_zeitstempel() {
    let app = setup().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "GET", PFAD, &cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["eintraege"],
        serde_json::json!({}),
        "ohne gespeicherte Präferenz ist die Map leer"
    );
    // Norm (CLAUDE.md): `Option<T>` im Response-DTO wird bei `None` WEGGELASSEN, nicht
    // als `null` geschickt — sonst kann der Client `absent` und `null` nicht trennen.
    assert!(
        !hat_key(&json, "geaendert_at"),
        "geaendert_at muss fehlen, solange nichts gespeichert ist — war: {json}"
    );
}

#[tokio::test]
async fn setzen_dann_lesen_liefert_den_wert_zurueck() {
    let app = setup().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, put_json) = anfrage(
        &app,
        "PUT",
        ZULETZT,
        &cookie,
        Some(r#"{"wert":"[\"modul:etb\",\"aktion:neuer-einsatz\"]"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "PUT antwortet mit dem neuen Stand");
    assert_eq!(
        put_json["eintraege"]["zuletzt_befehle"],
        Value::String(r#"["modul:etb","aktion:neuer-einsatz"]"#.into())
    );
    assert!(
        hat_key(&put_json, "geaendert_at"),
        "nach dem Schreiben trägt die Antwort einen Zeitstempel — war: {put_json}"
    );

    let (status, get_json) = anfrage(&app, "GET", PFAD, &cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        get_json["eintraege"], put_json["eintraege"],
        "GET liefert byte-gleich, was PUT quittiert hat"
    );
}

/// UPSERT: der zweite Schreibvorgang ersetzt, er legt keine zweite Zeile an.
#[tokio::test]
async fn zweites_setzen_ersetzt_statt_zu_stapeln() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    anfrage(&app, "PUT", ZULETZT, &cookie, Some(r#"{"wert":"[\"a\"]"}"#)).await;
    let (_, json) = anfrage(&app, "PUT", ZULETZT, &cookie, Some(r#"{"wert":"[\"b\"]"}"#)).await;

    assert_eq!(
        json["eintraege"]["zuletzt_befehle"],
        Value::String(r#"["b"]"#.into())
    );
    let zeilen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer_einstellungen")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(zeilen, 1, "UPSERT darf keine zweite Zeile anlegen");
}

// ── Validierung (alles 400: das Feld scheitert isoliert) ────────────────────

#[tokio::test]
async fn ueberlanger_wert_ist_400() {
    let app = setup().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let zu_lang = "x".repeat(lifeline_hub::benutzer_einstellungen::WERT_MAX_LAENGE + 1);
    let (status, _) = anfrage(
        &app,
        "PUT",
        ZULETZT,
        &cookie,
        Some(&format!(r#"{{"wert":"{zu_lang}"}}"#)),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "ein zu langer Wert scheitert am Feld selbst, nicht am Zusammenhang → 400"
    );
}

/// Gegenprobe zur Überlänge: genau auf der Grenze wird angenommen. Ohne sie wäre eine
/// Schranke von 0 ebenfalls grün.
#[tokio::test]
async fn wert_auf_der_laengengrenze_wird_angenommen() {
    let app = setup().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let genau = "x".repeat(lifeline_hub::benutzer_einstellungen::WERT_MAX_LAENGE);
    let (status, _) = anfrage(
        &app,
        "PUT",
        ZULETZT,
        &cookie,
        Some(&format!(r#"{{"wert":"{genau}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn unbekannter_schluessel_ist_400() {
    let app = setup().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        "/api/benutzer-einstellungen/theme",
        &cookie,
        Some(r#"{"wert":"dunkel"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        json["error"].as_str().unwrap_or_default().contains("theme"),
        "die Meldung nennt den abgelehnten Schlüssel — war: {json}"
    );
}

#[tokio::test]
async fn leerer_wert_ist_400() {
    let app = setup().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, _) = anfrage(&app, "PUT", ZULETZT, &cookie, Some(r#"{"wert":"   "}"#)).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "ein vorhandenes, aber leeres Pflichtfeld ist 400 (LFH-267)"
    );
}

#[tokio::test]
async fn fehlendes_wert_feld_ist_400() {
    let app = setup().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "PUT", ZULETZT, &cookie, Some(r#"{}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        json["error"].as_str().is_some(),
        "auch die Extractor-Rejection trägt den {{error}}-Envelope — war: {json}"
    );
}

// ── Trennung zweier Benutzer ────────────────────────────────────────────────

#[tokio::test]
async fn zwei_benutzer_sehen_einander_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "berta", "fuehrungskraft").await;
    let berta = login_cookie(&app, "berta", "bertapw1").await;

    anfrage(
        &app,
        "PUT",
        ZULETZT,
        &admin,
        Some(r#"{"wert":"[\"admin-befehl\"]"}"#),
    )
    .await;

    // Berta sieht ihr eigenes (leeres) Fach, nicht das des Admins.
    let (status, berta_json) = anfrage(&app, "GET", PFAD, &berta, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(berta_json["eintraege"], serde_json::json!({}));

    // Bertas Schreibvorgang überschreibt das Fach des Admins nicht.
    anfrage(
        &app,
        "PUT",
        ZULETZT,
        &berta,
        Some(r#"{"wert":"[\"berta-befehl\"]"}"#),
    )
    .await;
    let (_, admin_json) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(
        admin_json["eintraege"]["zuletzt_befehle"],
        Value::String(r#"["admin-befehl"]"#.into()),
        "das Fach des Admins bleibt unberührt"
    );
}

// ── Cascade ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn loeschen_des_benutzers_raeumt_seine_einstellungen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let berta_id = benutzer_anlegen(&app, &admin, "berta", "fuehrungskraft").await;
    let berta = login_cookie(&app, "berta", "bertapw1").await;

    anfrage(&app, "PUT", ZULETZT, &berta, Some(r#"{"wert":"[\"x\"]"}"#)).await;
    let vorher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer_einstellungen WHERE benutzer_id = ?")
            .bind(berta_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(vorher, 1, "Vorbedingung: die Zeile existiert");

    sqlx::query("DELETE FROM benutzer WHERE id = ?")
        .bind(berta_id)
        .execute(&pool)
        .await
        .expect("Benutzer löschen darf nicht an einer FK-Sperre scheitern");

    let nachher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer_einstellungen WHERE benutzer_id = ?")
            .bind(berta_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        nachher, 0,
        "ON DELETE CASCADE: eine Präferenz ohne Benutzer hat keinen Leser mehr"
    );
}
