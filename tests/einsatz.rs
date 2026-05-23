use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use serde_json::Value;
use tower::ServiceExt;

/// Router + DB mit Bootstrap-Admin (admin / startpw12).
async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState { pool })
}

/// Loggt sich ein und liefert das `name=value`-Cookie-Paar.
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

/// Admin legt einen Benutzer an; gibt dessen id zurück. `org_rolle`: z.B. "fuehrungskraft" oder "keine".
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
    assert_eq!(
        resp.status(),
        StatusCode::CREATED,
        "Benutzer anlegen muss klappen"
    );
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    json["id"].as_i64().unwrap()
}

/// Legt als gegebener Cookie-Inhaber einen Einsatz an und liefert (Status, JSON).
async fn einsatz_anlegen(
    app: &axum::Router,
    cookie: &str,
    bezeichnung: &str,
) -> (StatusCode, Value) {
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
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn normaler_benutzer_darf_keinen_einsatz_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = einsatz_anlegen(&app, &erika, "Verbotene Lage").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_legt_einsatz_an_und_wird_einsatzleitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = einsatz_anlegen(&app, &admin, "Sturmtief").await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["bezeichnung"], "Sturmtief");
    assert_eq!(json["status"], "aktiv");
    assert_eq!(json["meine_rolle"], "einsatzleitung");
}

#[tokio::test]
async fn fuehrungskraft_darf_einsatz_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;

    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (status, json) = einsatz_anlegen(&app, &frieda, "Frieda-Lage").await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["meine_rolle"], "einsatzleitung");
}

#[tokio::test]
async fn liste_zeigt_einsatz_mit_meiner_rolle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    einsatz_anlegen(&app, &admin, "Lage A").await;

    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze")
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["bezeichnung"], "Lage A");
    assert!(liste[0]["meine_rolle"].is_null());
}

#[tokio::test]
async fn detail_fuer_nicht_mitglied_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn detail_ohne_session_ist_401() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unbekannter_einsatz_detail_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze/999")
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn nur_einsatzleitung_kann_abschliessen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "abgeschlossen");
    assert!(!json["abgeschlossen_at"].is_null());

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn nicht_leitung_kann_nicht_abschliessen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

/// Setzt als Cookie-Inhaber die Rolle eines Ziel-Benutzers in einem Einsatz; liefert den Status.
async fn mitglied_setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    ziel_id: i64,
    rolle: &str,
) -> StatusCode {
    let body = format!(r#"{{"einsatz_rolle":"{rolle}"}}"#);
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder/{ziel_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn einsatzleitung_fuegt_mitglied_hinzu() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let status = mitglied_setzen(&app, &admin, einsatz_id, erika_id, "fuehrungspersonal").await;
    assert_eq!(status, StatusCode::OK);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["meine_rolle"], "fuehrungspersonal");
}

#[tokio::test]
async fn nicht_leitung_kann_keine_mitglieder_setzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let status = mitglied_setzen(&app, &erika, einsatz_id, erika_id, "beobachter").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mitglied_mit_ungueltiger_rolle_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let status = mitglied_setzen(&app, &admin, einsatz_id, erika_id, "haeuptling").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn mitglied_setzen_fuer_unbekannten_benutzer_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let status = mitglied_setzen(&app, &admin, einsatz_id, 999, "beobachter").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn letzte_einsatzleitung_kann_nicht_herabgestuft_werden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    // admin ist id=1 und einzige Einsatzleitung. Selbst-Herabstufung → 409.
    let status = mitglied_setzen(&app, &admin, einsatz_id, 1, "beobachter").await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn letzte_einsatzleitung_kann_nicht_entfernt_werden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let resp = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder/1"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn einsatzleitung_entfernt_mitglied() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    assert_eq!(
        mitglied_setzen(&app, &admin, einsatz_id, erika_id, "beobachter").await,
        StatusCode::OK
    );

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder/{erika_id}"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mitgliederliste_nur_fuer_mitglieder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder"))
                .header(header::COOKIE, erika)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_blockt_mitgliederaenderung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let status = mitglied_setzen(&app, &admin, einsatz_id, erika_id, "beobachter").await;
    assert_eq!(status, StatusCode::CONFLICT);
}
