use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

/// Router + DB mit Bootstrap-Admin (admin / startpw12).
async fn setup() -> axum::Router {
    setup_with_pool().await.0
}

/// Wie `setup`, liefert zusätzlich den `SqlitePool`, damit Tests direkt am
/// DB-Zustand manipulieren können (z.B. Einsätze künstlich altern lassen).
async fn setup_with_pool() -> (axum::Router, SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let router = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    (router, pool)
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

    // Admin (Einsatzleitung) sieht den Einsatz mit seiner Rolle.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze")
                .header(header::COOKIE, admin.clone())
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
    assert_eq!(liste[0]["meine_rolle"], "einsatzleitung");
}

#[tokio::test]
async fn liste_blendet_einsatz_fuer_nicht_mitglied_aus() {
    // DSGVO-Filter: ein normaler Nicht-Mitglied-Benutzer sieht fremde Einsätze
    // nicht mehr in der Liste.
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
    assert!(json.as_array().unwrap().is_empty());
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

#[tokio::test]
async fn deaktivierten_benutzer_zuweisen_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;

    // Erika deaktivieren.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/benutzer/{erika_id}/deaktivieren"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Deaktivierten Benutzer einem Einsatz zuweisen → 409.
    let status = mitglied_setzen(&app, &admin, einsatz_id, erika_id, "beobachter").await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// Ruft das Einsatz-Detail als Cookie-Inhaber ab; liefert den Status.
async fn detail_status(app: &axum::Router, cookie: &str, einsatz_id: i64) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// Liefert die Anzahl der Einsätze in der Liste des Cookie-Inhabers.
async fn listen_groesse(app: &axum::Router, cookie: &str) -> usize {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    json.as_array().unwrap().len()
}

#[tokio::test]
async fn admin_nicht_mitglied_darf_fremden_einsatz_detail_lesen() {
    // Höhere Berechtigung (System-Admin) darf jeden Einsatz lesen, auch ohne
    // Mitgliedschaft. `meine_rolle` ist dann null.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    // Eine Führungskraft legt einen eigenen Einsatz an (admin ist dort kein Mitglied).
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (_, json) = einsatz_anlegen(&app, &frieda, "Friedas Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["bezeichnung"], "Friedas Lage");
    assert!(json["meine_rolle"].is_null());
}

#[tokio::test]
async fn abgeschlossener_einsatz_nach_frist_nur_fuer_einsatzleitung() {
    // Abgeschlossener Einsatz, künstlich auf >24h gealtert:
    // - Beobachter-Mitglied: 403 und nicht mehr in der Liste,
    // - Einsatzleitung: 200.
    let (app, pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let einsatz_id = json["id"].as_i64().unwrap();

    // Beobachter zuweisen.
    let beob_id = benutzer_anlegen(&app, &admin, "beobi", "keine").await;
    assert_eq!(
        mitglied_setzen(&app, &admin, einsatz_id, beob_id, "beobachter").await,
        StatusCode::OK
    );

    // Einsatz abschließen.
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

    // Künstlich auf >24h altern (außerhalb der Schonfrist).
    sqlx::query("UPDATE einsatz SET abgeschlossen_at = datetime('now','-25 hours') WHERE id = ?")
        .bind(einsatz_id)
        .execute(&pool)
        .await
        .unwrap();

    let beob = login_cookie(&app, "beobi", "beobipw1").await;

    // Beobachter: Detail 403 und nicht mehr in der Liste.
    assert_eq!(
        detail_status(&app, &beob, einsatz_id).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(listen_groesse(&app, &beob).await, 0);

    // Einsatzleitung (admin) darf den abgeschlossenen Einsatz weiterhin lesen.
    assert_eq!(detail_status(&app, &admin, einsatz_id).await, StatusCode::OK);
    assert_eq!(listen_groesse(&app, &admin).await, 1);
}

/// Vollständiger, gültiger Kopfdaten-Body; Tests überschreiben einzelne Keys.
fn basis_kopf(bezeichnung: &str) -> Value {
    json!({
        "bezeichnung": bezeichnung,
        "stichwort": null,
        "einsatzart": "realeinsatz",
        "einsatznummer_intern": null,
        "leitstellen_nr": null,
        "einsatzort": null,
        "einsatzort_lat": null,
        "einsatzort_lon": null,
        "meldende_stelle": null,
        "sachverhalt": null,
        "anzahl_betroffene_initial": null,
        "begonnen_at": "2026-05-25 08:00:00"
    })
}

/// PATCH der Kopfdaten als Cookie-Inhaber; liefert (Status, JSON).
async fn patch_kopf(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    body: Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/einsaetze/{einsatz_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
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
async fn einsatzleitung_patcht_kopfdaten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Alt").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Neu");
    body["einsatzart"] = json!("uebung");
    body["einsatzort"] = json!("Hauptstraße 1");
    body["anzahl_betroffene_initial"] = json!(5);

    let (status, antwort) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(antwort["bezeichnung"], "Neu");
    assert_eq!(antwort["einsatzart"], "uebung");
    assert_eq!(antwort["einsatzort"], "Hauptstraße 1");
    assert_eq!(antwort["anzahl_betroffene_initial"], 5);
}

#[tokio::test]
async fn admin_ohne_mitgliedschaft_darf_patchen_aber_kein_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (_, json) = einsatz_anlegen(&app, &frieda, "Friedas Lage").await;
    let id = json["id"].as_i64().unwrap();

    let (status, _) = patch_kopf(&app, &admin, id, basis_kopf("Vom Admin")).await;
    assert_eq!(status, StatusCode::OK);

    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{id}/etb"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin)
                .body(Body::from(r#"{"typ":"meldung","inhalt":"Test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn beobachter_darf_kopf_nicht_patchen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    assert_eq!(
        mitglied_setzen(&app, &admin, id, erika_id, "beobachter").await,
        StatusCode::OK
    );

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = patch_kopf(&app, &erika, id, basis_kopf("X")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nicht_mitglied_ohne_admin_darf_kopf_nicht_patchen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = patch_kopf(&app, &erika, id, basis_kopf("X")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patch_auf_abgeschlossenen_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{id}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let (status, _) = patch_kopf(&app, &admin, id, basis_kopf("X")).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn patch_leere_bezeichnung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let (status, _) = patch_kopf(&app, &admin, id, basis_kopf("   ")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_ungueltige_einsatzart_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Lage");
    body["einsatzart"] = json!("quatsch");
    let (status, _) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_negative_anzahl_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Lage");
    body["anzahl_betroffene_initial"] = json!(-1);
    let (status, _) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn patch_leere_optionals_werden_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();

    let mut body = basis_kopf("Lage");
    body["einsatzort"] = json!("   ");
    let (status, antwort) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::OK);
    assert!(antwort["einsatzort"].is_null());
}

#[tokio::test]
async fn patch_doppelte_einsatznummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    let (_, a) = einsatz_anlegen(&app, &frieda, "A").await;
    let (_, b) = einsatz_anlegen(&app, &frieda, "B").await;
    let nummer_a = a["einsatznummer_intern"].as_str().unwrap().to_string();
    let id_b = b["id"].as_i64().unwrap();

    let mut body = basis_kopf("B");
    body["einsatznummer_intern"] = json!(nummer_a);
    let (status, _) = patch_kopf(&app, &frieda, id_b, body).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn angelegt_at_bleibt_bei_patch_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = json["id"].as_i64().unwrap();
    let angelegt_vorher = json["angelegt_at"].as_str().unwrap().to_string();

    let mut body = basis_kopf("Lage");
    body["begonnen_at"] = json!("2026-05-20 10:00:00");
    let (status, antwort) = patch_kopf(&app, &admin, id, body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(antwort["begonnen_at"], "2026-05-20 10:00:00");
    assert_eq!(antwort["angelegt_at"], angelegt_vorher);
}

#[tokio::test]
async fn anlegen_vergibt_einsatznummer_im_format() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, a) = einsatz_anlegen(&app, &admin, "A").await;
    let (_, b) = einsatz_anlegen(&app, &admin, "B").await;
    let nr_a = a["einsatznummer_intern"].as_str().unwrap();
    let nr_b = b["einsatznummer_intern"].as_str().unwrap();
    assert!(nr_a.ends_with("-001"), "erste Nummer endet auf -001: {nr_a}");
    assert!(nr_b.ends_with("-002"), "zweite Nummer endet auf -002: {nr_b}");
}

/// PUT /api/einsaetze/{id}/aufbewahrungsfrist mit Cookie + JSON-Body.
async fn frist_setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    body: Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz_id}/aufbewahrungsfrist"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

async fn abschliessen(app: &axum::Router, cookie: &str, einsatz_id: i64) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{einsatz_id}/abschliessen"))
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn aufbewahrungsfrist_verkuerzung_ohne_bestaetigung_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, e) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = e["id"].as_i64().unwrap();

    // Setzen auf einen bislang unbegrenzten Einsatz = Verkürzung → ohne Bestätigung 409.
    let (status, _) = frist_setzen(
        &app,
        &admin,
        id,
        json!({ "retention_bis": "2030-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn aufbewahrungsfrist_mit_bestaetigung_setzt_wert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, e) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = e["id"].as_i64().unwrap();

    let (status, json) = frist_setzen(
        &app,
        &admin,
        id,
        json!({ "retention_bis": "2030-01-01 00:00:00", "bestaetigt": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["retention_bis"].as_str(), Some("2030-01-01 00:00:00"));
}

#[tokio::test]
async fn aufbewahrungsfrist_greift_erst_nach_abschluss_und_sperrt_dann_alle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, e) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = e["id"].as_i64().unwrap();

    // Frist in der Vergangenheit setzen (bestätigt). Solange aktiv → weiter lesbar.
    let (status, _) = frist_setzen(
        &app,
        &admin,
        id,
        json!({ "retention_bis": "2020-01-01 00:00:00", "bestaetigt": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail_status(&app, &admin, id).await, StatusCode::OK);

    // Nach Abschluss greift die abgelaufene Frist → gesperrt, auch für den Admin.
    assert_eq!(abschliessen(&app, &admin, id).await, StatusCode::OK);
    assert_eq!(detail_status(&app, &admin, id).await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn aufbewahrungsfrist_nicht_admin_einsatzleitung_darf_setzen() {
    // Erfolgs-Pfad ohne ist_admin()-Short-Circuit: reine Einsatzleitung (Führungskraft).
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (_, e) = einsatz_anlegen(&app, &frieda, "Frieda-Lage").await;
    let id = e["id"].as_i64().unwrap();

    let (status, json) = frist_setzen(
        &app,
        &frieda,
        id,
        json!({ "retention_bis": "2030-01-01 00:00:00", "bestaetigt": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["retention_bis"].as_str(), Some("2030-01-01 00:00:00"));
}

#[tokio::test]
async fn aufbewahrungsfrist_fremder_ohne_rolle_ist_403() {
    // Ablehn-Pfad: Nicht-Mitglied ohne höhere Berechtigung → fordere_einsatzleitung greift.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, e) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = e["id"].as_i64().unwrap();

    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = frist_setzen(
        &app,
        &erika,
        id,
        json!({ "retention_bis": "2030-01-01 00:00:00", "bestaetigt": true }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgelaufene_frist_sperrt_auch_personen_export() {
    // Belegt die transitive Sperre über den fordere_lesezugriff()-Chokepoint:
    // nicht nur das Einsatz-Detail, auch der Personen-CSV-Export wird 403.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, e) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = e["id"].as_i64().unwrap();

    let (status, _) = frist_setzen(
        &app,
        &admin,
        id,
        json!({ "retention_bis": "2020-01-01 00:00:00", "bestaetigt": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(abschliessen(&app, &admin, id).await, StatusCode::OK);

    let export_status = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{id}/personen/export"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status();
    assert_eq!(export_status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn aufbewahrungsfrist_verlaengern_und_aufheben_ohne_bestaetigung() {
    // Nicht-Verkürzung darf OHNE bestaetigt durchgehen (fängt ein zu striktes Gate
    // wie `if !bestaetigt` statt `if ist_fristverkuerzung && !bestaetigt`).
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, e) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = e["id"].as_i64().unwrap();

    // Ausgangsfrist setzen (Verkürzung von unbegrenzt → bestätigt).
    let (status, _) = frist_setzen(
        &app,
        &admin,
        id,
        json!({ "retention_bis": "2030-01-01 00:00:00", "bestaetigt": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Verlängern auf späteren Zeitpunkt OHNE bestaetigt → 200.
    let (status, json) = frist_setzen(
        &app,
        &admin,
        id,
        json!({ "retention_bis": "2031-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["retention_bis"].as_str(), Some("2031-01-01 00:00:00"));

    // Aufheben (null) OHNE bestaetigt → 200, Frist weg.
    let (status, json) = frist_setzen(&app, &admin, id, json!({ "retention_bis": null })).await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["retention_bis"].is_null());
}

// --- Einsatz-Einstellungen (LFH-131) ---

/// GET der Einstellungen eines Einsatzes.
async fn einstellungen_get(app: &axum::Router, cookie: &str, id: i64) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{id}/einstellungen"))
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

/// PUT der Einstellungen.
async fn einstellungen_put(
    app: &axum::Router,
    cookie: &str,
    id: i64,
    body: Value,
) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{id}/einstellungen"))
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

#[tokio::test]
async fn einstellungen_get_default_dann_put_speichert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    // GET → Defaults (alle null).
    let (status, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(status, StatusCode::OK);
    assert!(v["standard_modul"].is_null());
    assert!(v["fachebenen_sichtbar"].is_null());

    // PUT.
    let (status, v) = einstellungen_put(
        &app,
        &admin,
        id,
        json!({
            "standard_modul": "lagekarte",
            "basemap_modus": "offline",
            "karten_zoom_start": 12,
            "fachebenen_sichtbar": {"nina": true, "dwd": false, "pegelonline": false, "kritis": false}
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["standard_modul"], "lagekarte");
    assert_eq!(v["basemap_modus"], "offline");
    // fachebenen_sichtbar kommt als Objekt zurück (symmetrisch zur Eingabe).
    assert_eq!(v["fachebenen_sichtbar"]["nina"], true);

    // GET liefert die gespeicherten Werte.
    let (_, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(v["standard_modul"], "lagekarte");
}

#[tokio::test]
async fn einstellungen_put_ungueltiger_modus_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    // Validation-Fehler → 400 (Hauskonvention, wie bei ungültiger einsatzart).
    let (status, _) = einstellungen_put(&app, &admin, id, json!({ "basemap_modus": "satellit" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn einstellungen_put_auf_abgeschlossenem_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    // abschließen
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/einsaetze/{id}/abschliessen"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let (status, _) = einstellungen_put(&app, &admin, id, json!({ "basemap_modus": "online" })).await;
    assert_eq!(status, StatusCode::CONFLICT);
}
