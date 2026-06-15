use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use std::time::Duration;
use tower::ServiceExt;

/// Router + Bootstrap-Admin (admin / startpw12); liefert zusätzlich den LiveHub,
/// damit Tests direkt am Broadcast-Kanal lauschen können.
async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool,
        live: live.clone(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    (router, live)
}

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
    assert_eq!(resp.status(), StatusCode::OK, "Login muss klappen");
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

async fn benutzer_anlegen(
    app: &axum::Router,
    admin_cookie: &str,
    benutzername: &str,
    org_rolle: &str,
) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{benutzername}","benutzername":"{benutzername}","passwort":"{benutzername}pw1","org_rolle":"{org_rolle}"}}"#
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

async fn einsatz_anlegen(app: &axum::Router, cookie: &str, bezeichnung: &str) -> i64 {
    let body = format!(r#"{{"bezeichnung":"{bezeichnung}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/einsaetze")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
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

/// Erfasst einen Eintrag mit gegebenem JSON-Body; liefert (Status, JSON).
async fn eintrag_erfassen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    body: &str,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// Ruft die ETB-Liste mit optionalem Query-String ab; liefert (Status, JSON).
async fn etb_abrufen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    query: &str,
) -> (StatusCode, Value) {
    let uri = if query.is_empty() {
        format!("/api/einsaetze/{einsatz_id}/etb")
    } else {
        format!("/api/einsaetze/{einsatz_id}/etb?{query}")
    };
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// POST mit Cookie + JSON-Body; liefert (Status, JSON).
async fn post_json(
    app: &axum::Router,
    cookie: &str,
    uri: &str,
    body: &str,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

/// Weist `benutzer_id` die Rolle in `einsatz` zu (PUT mitglieder).
async fn rolle_zuweisen(app: &axum::Router, admin: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.to_string())
                .body(Body::from(format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "Rollenzuweisung muss klappen");
}

/// Minimal valider Auftrags-Body (ein Funktions-Empfänger), wie in tests/meldung.rs.
fn auftrag_body(text: &str) -> String {
    format!(
        r#"{{"auftrag_text":"{text}","empfaenger":[{{"empfaenger_typ":"funktion","funktion_text":"S3"}}]}}"#,
    )
}

#[tokio::test]
async fn etb_auftrag_beobachter_ist_403() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let (_, etb) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"Lage"}"#).await;
    let etb_id = etb["id"].as_i64().unwrap();

    let beob_id = benutzer_anlegen(&app, &admin, "beobi", "keine").await;
    rolle_zuweisen(&app, &admin, einsatz, beob_id, "beobachter").await;
    let beob = login_cookie(&app, "beobi", "beobipw1").await;

    let (status, _) = post_json(
        &app, &beob,
        &format!("/api/einsaetze/{einsatz}/etb/{etb_id}/auftrag"),
        &auftrag_body("X"),
    ).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Beobachter darf keinen Auftrag erteilen");
}

#[tokio::test]
async fn etb_auftrag_cross_einsatz_ist_404() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin, "Lage A").await;
    let b = einsatz_anlegen(&app, &admin, "Lage B").await;
    let (_, etb) = eintrag_erfassen(&app, &admin, a, r#"{"typ":"meldung","inhalt":"Lage"}"#).await;
    let etb_id_a = etb["id"].as_i64().unwrap();

    // Quell-Eintrag aus Einsatz A über Einsatz B ansprechen → 404.
    let (status, _) = post_json(
        &app, &admin,
        &format!("/api/einsaetze/{b}/etb/{etb_id_a}/auftrag"),
        &auftrag_body("X"),
    ).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn etb_auftrag_happy_path_setzt_quellbezug() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let (_, etb) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"Brand Halle 3"}"#).await;
    let quell_id = etb["id"].as_i64().unwrap();

    let (status, json) = post_json(
        &app, &admin,
        &format!("/api/einsaetze/{einsatz}/etb/{quell_id}/auftrag"),
        &auftrag_body("Riegelstellung aufbauen"),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    // AuftragDetail flacht AuftragAnzeige ein → Felder liegen top-level.
    assert_eq!(json["quell_etb_eintrag_id"], quell_id, "Quellbezug zeigt auf den auslösenden Eintrag");
    let etb_anordnung_id = json["etb_anordnung_id"].as_i64();
    assert!(etb_anordnung_id.is_some(), "Auftrag erzeugt eine eigene ETB-Anordnung");
    assert_ne!(
        json["quell_etb_eintrag_id"].as_i64(), etb_anordnung_id,
        "Quell-Eintrag und selbst erzeugte Anordnung sind verschiedene Einträge"
    );
}

#[tokio::test]
async fn etb_auftrag_mehrfach_aus_einem_eintrag_erlaubt() {
    // Anders als Meldung→Auftrag (1:1, 409): aus einem ETB-Eintrag dürfen mehrere
    // Aufträge erteilt werden — kein Rückverweis-Lock am Eintrag.
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let (_, etb) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"Mehrere Aufträge"}"#).await;
    let quell_id = etb["id"].as_i64().unwrap();
    let uri = format!("/api/einsaetze/{einsatz}/etb/{quell_id}/auftrag");

    let (s1, _) = post_json(&app, &admin, &uri, &auftrag_body("erster")).await;
    assert_eq!(s1, StatusCode::CREATED);
    let (s2, _) = post_json(&app, &admin, &uri, &auftrag_body("zweiter")).await;
    assert_eq!(s2, StatusCode::CREATED, "zweite Erteilung aus demselben Eintrag → erneut 201");

    let (_, liste) = get_auftraege(&app, &admin, einsatz).await;
    assert_eq!(liste.as_array().unwrap().len(), 2, "beide Aufträge liegen im Auftrag-Modul");
}

/// Liest die Auftragsliste des Einsatzes (GET, kein Body).
async fn get_auftraege(app: &axum::Router, cookie: &str, einsatz: i64) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/auftraege"))
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn einsatzleitung_erfasst_eintrag() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, json) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Deich instabil"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["lfd_nr"], 1);
    assert_eq!(json["typ"], "meldung");
    assert_eq!(json["inhalt"], "Deich instabil");
    assert_eq!(json["erfasser_name"], "Administrator");
    assert!(!json["received_at"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn beobachter_darf_nicht_erfassen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    // Erika als Beobachterin zuweisen.
    let zuweisung = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz}/mitglieder/{erika_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.clone())
                .body(Body::from(r#"{"einsatz_rolle":"beobachter"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        zuweisung.status(),
        StatusCode::OK,
        "Beobachter-Rolle muss gesetzt werden, sonst testet der Test den Nicht-Mitglied-Pfad"
    );

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) =
        eintrag_erfassen(&app, &erika, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nicht_mitglied_darf_nicht_erfassen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;

    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) =
        eintrag_erfassen(&app, &fremd, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn system_typ_wird_abgelehnt() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"system","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn leerer_inhalt_wird_abgelehnt() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"   "}"#).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn berichtigung_verknuepft_und_validiert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (_, original) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Falsch"}"#,
    )
    .await;
    let original_id = original["id"].as_i64().unwrap();

    // Gültige Berichtigung.
    let body = format!(
        r#"{{"typ":"berichtigung","inhalt":"Korrektur","berichtigt_eintrag_id":{original_id}}}"#
    );
    let (status, json) = eintrag_erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["berichtigt_eintrag_id"], original_id);

    // Berichtigung ohne Verweis → 400.
    let (status, _) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"berichtigung","inhalt":"X"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn berichtigt_eintrag_id_ohne_berichtigungstyp_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let (_, e1) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"A"}"#).await;
    let id = e1["id"].as_i64().unwrap();

    let body = format!(r#"{{"typ":"meldung","inhalt":"B","berichtigt_eintrag_id":{id}}}"#);
    let (status, _) = eintrag_erfassen(&app, &admin, einsatz, &body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn erfassen_in_abgeschlossenem_einsatz_ist_409() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let (status, _) =
        eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"X"}"#).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn erfassen_ohne_session_ist_401() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"typ":"meldung","inhalt":"X"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn erfasster_eintrag_wird_live_publiziert() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let mut rx = live.abonniere(einsatz);
    let (status, _) = eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Live-Test"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let nachricht = tokio::time::timeout(Duration::from_secs(1), rx.recv())
        .await
        .expect("Broadcast muss innerhalb 1s ankommen")
        .expect("Broadcast-Kanal liefert Nachricht");
    assert_eq!(nachricht.event, "etb");
    let value: Value = serde_json::from_str(&nachricht.data).unwrap();
    assert_eq!(value["inhalt"], "Live-Test");
}

#[tokio::test]
async fn liste_zeigt_eintraege_neueste_zuerst() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"erster"}"#,
    )
    .await;
    eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"zweiter"}"#,
    )
    .await;

    let (status, json) = etb_abrufen(&app, &admin, einsatz, "").await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 2);
    assert_eq!(liste[0]["lfd_nr"], 2);
    assert_eq!(liste[1]["lfd_nr"], 1);
}

#[tokio::test]
async fn liste_nur_fuer_mitglieder() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _) = etb_abrufen(&app, &fremd, einsatz, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_nicht_mitglied_darf_etb_lesen() {
    // Höhere Berechtigung (System-Admin) darf das ETB jedes Einsatzes lesen,
    // auch ohne Mitgliedschaft. Eine Führungskraft legt den Einsatz an.
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let einsatz = einsatz_anlegen(&app, &frieda, "Friedas Lage").await;
    eintrag_erfassen(
        &app,
        &frieda,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Test"}"#,
    )
    .await;

    // admin ist KEIN Mitglied dieses Einsatzes, darf das ETB aber lesen.
    let (status, json) = etb_abrufen(&app, &admin, einsatz, "").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Admin (höhere Berechtigung) muss fremdes ETB lesen dürfen"
    );
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn admin_nicht_mitglied_darf_stream_abonnieren() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let einsatz = einsatz_anlegen(&app, &frieda, "Friedas Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "Admin (höhere Berechtigung) muss fremden Stream abonnieren dürfen"
    );
}

#[tokio::test]
async fn beobachter_darf_lesen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Test"}"#,
    )
    .await;
    let beob_id = benutzer_anlegen(&app, &admin, "beobi", "keine").await;

    let zuweisung = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz}/mitglieder/{beob_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.clone())
                .body(Body::from(r#"{"einsatz_rolle":"beobachter"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(zuweisung.status(), StatusCode::OK);

    let beob = login_cookie(&app, "beobi", "beobipw1").await;
    let (status, json) = etb_abrufen(&app, &beob, einsatz, "").await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Beobachter muss das ETB lesen dürfen"
    );
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn liste_volltextsuche_filtert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Deich bricht"}"#,
    )
    .await;
    eintrag_erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Lage ruhig"}"#,
    )
    .await;

    let (status, json) = etb_abrufen(&app, &admin, einsatz, "q=Deich").await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert!(liste[0]["inhalt"].as_str().unwrap().contains("Deich"));
}

#[tokio::test]
async fn liste_typ_filter() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"meldung","inhalt":"m"}"#).await;
    eintrag_erfassen(&app, &admin, einsatz, r#"{"typ":"anordnung","inhalt":"a"}"#).await;

    let (status, json) = etb_abrufen(&app, &admin, einsatz, "typ=anordnung").await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["typ"], "anordnung");
}

#[tokio::test]
async fn liste_cursor_pagination() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    for i in 1..=3 {
        let body = format!(r#"{{"typ":"meldung","inhalt":"e{i}"}}"#);
        eintrag_erfassen(&app, &admin, einsatz, &body).await;
    }

    let (_, seite1) = etb_abrufen(&app, &admin, einsatz, "limit=1").await;
    assert_eq!(seite1[0]["lfd_nr"], 3);

    let (_, seite2) = etb_abrufen(&app, &admin, einsatz, "limit=1&before_lfd_nr=3").await;
    assert_eq!(seite2[0]["lfd_nr"], 2);
}

#[tokio::test]
async fn liste_ungueltiger_typ_filter_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let (status, _) = etb_abrufen(&app, &admin, einsatz, "typ=unsinn").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn stream_fuer_mitglied_liefert_event_stream() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(
        content_type.starts_with("text/event-stream"),
        "SSE muss text/event-stream sein, war: {content_type}"
    );
    // Body bleibt offen (Live-Stream) — wir lesen ihn nicht und beenden den Test.
}

#[tokio::test]
async fn stream_fuer_beobachter_ist_200() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beobi", "keine").await;

    let zuweisung = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz}/mitglieder/{beob_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.clone())
                .body(Body::from(r#"{"einsatz_rolle":"beobachter"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(zuweisung.status(), StatusCode::OK);

    let beob = login_cookie(&app, "beobi", "beobipw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .header(header::COOKIE, beob)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "Beobachter muss den Stream abonnieren dürfen"
    );
}

#[tokio::test]
async fn stream_fuer_nicht_mitglied_ist_403() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .header(header::COOKIE, fremd)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn stream_unbekannter_einsatz_ist_404() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze/999/etb/stream")
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn stream_ohne_session_ist_401() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin, "Lage").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/etb/stream"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
