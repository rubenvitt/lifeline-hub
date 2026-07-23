use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

mod common;
use common::{benutzer_anlegen, login_cookie};

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
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, pool)
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
async fn liste_blendet_fremde_org_fuer_fuehrungskraft_aus() {
    // LFH-115: Eine Org-Führungskraft sieht in GET /api/einsaetze NUR Einsätze der
    // eigenen Org (auch ohne Mitgliedschaft) — fremde-Org-Einsätze werden über
    // liste_fuer → darf_lesen(r.org_id) → darf_fremdeinsatz_lesen ausgeblendet.
    let (app, pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    // Eigener Einsatz (Org 1), den die Führungskraft sehen soll (sie ist NICHT Mitglied).
    einsatz_anlegen(&app, &admin, "Eigene Lage").await;

    // Fremde Org 2 mit eigenem Einsatz (bootstrap_admin nicht ein 2. Mal → rohes SQL).
    let org2: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Fremd-Orga') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO einsatz (org_id, bezeichnung, status) VALUES (?, 'Fremd-Lage', 'aktiv')",
    )
    .bind(org2)
    .execute(&pool)
    .await
    .unwrap();

    // Org-Führungskraft in Org 1 (via admin angelegt).
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze")
                .header(header::COOKIE, frieda)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    let liste = json.as_array().unwrap();
    assert_eq!(
        liste.len(),
        1,
        "Führungskraft sieht nur die eigene Org, nicht die fremde"
    );
    assert_eq!(liste[0]["bezeichnung"], "Eigene Lage");
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
    assert_eq!(
        detail_status(&app, &admin, einsatz_id).await,
        StatusCode::OK
    );
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
    assert!(
        nr_a.ends_with("-001"),
        "erste Nummer endet auf -001: {nr_a}"
    );
    assert!(
        nr_b.ends_with("-002"),
        "zweite Nummer endet auf -002: {nr_b}"
    );
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
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
    let (status, _) =
        einstellungen_put(&app, &admin, id, json!({ "basemap_modus": "satellit" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn einstellungen_put_zoom_ausserhalb_bereich_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    // Zoom > 28 → 400.
    let (status, _) = einstellungen_put(&app, &admin, id, json!({ "karten_zoom_start": 99 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Zoom < 0 → 400.
    let (status, _) = einstellungen_put(&app, &admin, id, json!({ "karten_zoom_start": -1 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// org_defaults in GET /einstellungen enthält kein geaendert_von (Audit-Leak-Schutz).
#[tokio::test]
async fn einstellungen_get_org_defaults_ohne_audit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    let (status, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(status, StatusCode::OK);

    // org_defaults muss vorhanden sein (auch wenn alle Felder null).
    assert!(
        v["org_defaults"].is_object(),
        "org_defaults fehlt in Antwort"
    );
    // Audit-Felder dürfen NICHT im org_defaults-Objekt auftauchen (Sicherheitsanforderung).
    assert!(
        v["org_defaults"].get("geaendert_von").is_none(),
        "geaendert_von darf nicht in org_defaults serialisiert werden"
    );
    assert!(
        v["org_defaults"].get("geaendert_at").is_none(),
        "geaendert_at darf nicht in org_defaults serialisiert werden"
    );
}

#[tokio::test]
async fn geloescht_at_tombstone_sperrt_detail_export_stream_403() {
    // LFH-135: ein gesetzter geloescht_at-Tombstone sperrt den Lesezugriff über
    // fordere_lesezugriff in ALLEN Routen — auch für den System-Admin (höhere
    // Berechtigung). Geprüft an Detail, Personen-Export und Personen-Stream.
    let (app, pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    // Vor dem Tombstone: Detail ist lesbar.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{id}"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Tombstone direkt in der DB setzen (Soft-Delete des Purge-Schedulers).
    sqlx::query("UPDATE einsatz SET geloescht_at = '2026-01-01 00:00:00' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

    for uri in [
        format!("/api/einsaetze/{id}"),
        format!("/api/einsaetze/{id}/personen/export"),
        format!("/api/einsaetze/{id}/live"),
    ] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(&uri)
                    .header(header::COOKIE, admin.clone())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::FORBIDDEN,
            "Tombstone muss {uri} sperren (auch für Admin)"
        );
    }
}

#[tokio::test]
async fn einstellungen_put_retention_dauer_persistiert_validiert_und_hebt_auf() {
    // LFH-135: Aufbewahrungs-Dauer-Politik über PUT setzen, validieren, aufheben.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    // Gültige Dauer persistiert.
    let (status, v) =
        einstellungen_put(&app, &admin, id, json!({ "retention_dauer_tage": 365 })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["retention_dauer_tage"], 365);
    let (_, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(v["retention_dauer_tage"], 365);

    // Ungültige Dauer (0 = Instant-Purge) → 400.
    let (status, _) =
        einstellungen_put(&app, &admin, id, json!({ "retention_dauer_tage": 0 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Zu groß → 400.
    let (status, _) =
        einstellungen_put(&app, &admin, id, json!({ "retention_dauer_tage": 3651 })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // null hebt die Politik auf (Vollersatz-PUT).
    let (status, v) =
        einstellungen_put(&app, &admin, id, json!({ "retention_dauer_tage": null })).await;
    assert_eq!(status, StatusCode::OK);
    assert!(v["retention_dauer_tage"].is_null());
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

    let (status, _) =
        einstellungen_put(&app, &admin, id, json!({ "basemap_modus": "online" })).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn einstellungen_put_anzeige_konventionen_speichert_und_liest_zurueck() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    let (status, v) = einstellungen_put(
        &app,
        &admin,
        id,
        json!({
            "zeitzone": "Europe/Berlin",
            "zeitformat": "12h",
            "einheiten": "imperial",
            "koordinatenformat": "mgrs"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["zeitzone"], "Europe/Berlin");
    assert_eq!(v["zeitformat"], "12h");
    assert_eq!(v["einheiten"], "imperial");
    assert_eq!(v["koordinatenformat"], "mgrs");

    // GET liest die Konventionen zurück.
    let (_, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(v["zeitzone"], "Europe/Berlin");
    assert_eq!(v["koordinatenformat"], "mgrs");
}

#[tokio::test]
async fn einstellungen_put_ungueltige_konventionen_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    let (status, _) = einstellungen_put(&app, &admin, id, json!({ "zeitformat": "48h" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = einstellungen_put(&app, &admin, id, json!({ "einheiten": "nautisch" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) =
        einstellungen_put(&app, &admin, id, json!({ "koordinatenformat": "gauss" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Leere/blanke Zeitzone wird via bereinige zu „unset" (None) → 200, nicht 400.
    let (status, _) = einstellungen_put(&app, &admin, id, json!({ "zeitzone": "   " })).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn einstellungen_konventionen_fuer_nicht_mitglied_sind_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Org-Isolation: Nicht-Mitglied darf weder lesen noch schreiben.
    let (status, _) = einstellungen_get(&app, &erika, id).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) =
        einstellungen_put(&app, &erika, id, json!({ "koordinatenformat": "utm" })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// --- Verhalten & Automatik: Nummernkreise + Default-Fristen (LFH-133) ---

/// Fügt direkt einen ETB-Eintrag in die DB ein (umgeht die API), um den
/// ETB-Nummernkreis-Freeze isoliert zu testen.
async fn etb_eintrag_direkt(pool: &SqlitePool, einsatz_id: i64) {
    sqlx::query(
        "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
         SELECT ?, 1, 'meldung', 'x', (SELECT id FROM benutzer LIMIT 1), '2026-06-19 09:00:00'",
    )
    .bind(einsatz_id)
    .execute(pool)
    .await
    .unwrap();
}

/// Fügt direkt einen Auftrag ein (ohne ETB-Anordnung), um den Auftrags-Freeze
/// unabhängig vom ETB-Kreis zu testen.
async fn auftrag_direkt(pool: &SqlitePool, einsatz_id: i64) {
    sqlx::query(
        "INSERT INTO auftrag (einsatz_id, lfd_nr, auftrag_text, erteilt_at, erstellt_von_id) \
         SELECT ?, 1, 'x', '2026-06-19 09:00:00', (SELECT id FROM benutzer LIMIT 1)",
    )
    .bind(einsatz_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn einstellungen_verhalten_speichert_und_liest_zurueck() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    let (status, v) = einstellungen_put(
        &app,
        &admin,
        id,
        json!({
            "etb_nummer_praefix": "EB-", "etb_nummer_start": 100,
            "meldung_nummer_praefix": "M-", "meldung_nummer_start": 5,
            "auftrag_nummer_praefix": "A-", "auftrag_nummer_start": 10,
            "meldung_bestaetigung_frist_min": 30, "auftrag_quittierung_frist_min": 45,
            "auto_etb_eintraege": false
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["etb_nummer_praefix"], "EB-");
    assert_eq!(v["etb_nummer_start"], 100);
    assert_eq!(v["auftrag_nummer_start"], 10);
    assert_eq!(v["meldung_bestaetigung_frist_min"], 30);
    assert_eq!(v["auto_etb_eintraege"], 0);
    // Ohne vergebene Nummern: nichts eingefroren.
    assert_eq!(v["etb_nummer_eingefroren"], false);

    let (_, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(v["meldung_nummer_praefix"], "M-");
    assert_eq!(v["auftrag_quittierung_frist_min"], 45);
}

#[tokio::test]
async fn einstellungen_verhalten_ungueltig_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    let (s, _) = einstellungen_put(
        &app,
        &admin,
        id,
        json!({ "etb_nummer_praefix": "123456789" }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Präfix > 8 Zeichen");
    let (s, _) = einstellungen_put(&app, &admin, id, json!({ "etb_nummer_praefix": "EB#" })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Präfix mit ungültigem Zeichen");
    let (s, _) = einstellungen_put(&app, &admin, id, json!({ "etb_nummer_start": 0 })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Startwert 0");
    let (s, _) = einstellungen_put(
        &app,
        &admin,
        id,
        json!({ "meldung_bestaetigung_frist_min": 0 }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Frist 0");
    let (s, _) = einstellungen_put(
        &app,
        &admin,
        id,
        json!({ "auftrag_quittierung_frist_min": 99999 }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Frist > 1 Woche");
}

#[tokio::test]
async fn einstellungen_freeze_409_je_nummernkreis_und_xor() {
    let (app, pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();

    // Erste ETB-Nummer vergeben → ETB-Kreis eingefroren, Auftrags-Kreis frei.
    etb_eintrag_direkt(&pool, id).await;

    let (_, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(v["etb_nummer_eingefroren"], true);
    assert_eq!(v["auftrag_nummer_eingefroren"], false);

    // Änderung am eingefrorenen ETB-Kreis → 409.
    let (s, _) = einstellungen_put(&app, &admin, id, json!({ "etb_nummer_start": 5 })).await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "geänderter Startwert bei vergebener Nummer → 409"
    );
    let (s, _) = einstellungen_put(&app, &admin, id, json!({ "etb_nummer_praefix": "EB-" })).await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "geändertes Präfix bei vergebener Nummer → 409"
    );

    // Freier Auftrags-Kreis bleibt änderbar (Kreise sind getrennt).
    let (s, _) = einstellungen_put(&app, &admin, id, json!({ "auftrag_nummer_start": 7 })).await;
    assert_eq!(
        s,
        StatusCode::OK,
        "anderer (freier) Nummernkreis bleibt setzbar"
    );

    // XOR: unveränderter ETB-Wert (weiterhin null) sperrt sich NICHT selbst aus.
    let (s, _) = einstellungen_put(
        &app,
        &admin,
        id,
        json!({ "etb_nummer_praefix": null, "etb_nummer_start": null, "zeitformat": "12h" }),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::OK,
        "unveränderter Vollersatz-PUT darf trotz Freeze durch"
    );
}

#[tokio::test]
async fn einstellungen_freeze_ist_org_isoliert() {
    let (app, pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, ea) = einsatz_anlegen(&app, &admin, "Lage A").await;
    let (_, eb) = einsatz_anlegen(&app, &admin, "Lage B").await;
    let id_a = ea["id"].as_i64().unwrap();
    let id_b = eb["id"].as_i64().unwrap();

    // Einträge NUR im fremden Einsatz B.
    etb_eintrag_direkt(&pool, id_b).await;
    auftrag_direkt(&pool, id_b).await;

    // Einsatz A bleibt frei — Freeze ist strikt per einsatz_id.
    let (_, v) = einstellungen_get(&app, &admin, id_a).await;
    assert_eq!(v["etb_nummer_eingefroren"], false);
    assert_eq!(v["auftrag_nummer_eingefroren"], false);
    let (s, _) = einstellungen_put(&app, &admin, id_a, json!({ "etb_nummer_start": 5 })).await;
    assert_eq!(
        s,
        StatusCode::OK,
        "fremder Einsatz mit Einträgen darf A nicht einfrieren"
    );
}

#[tokio::test]
async fn einstellungen_get_enthalt_org_defaults() {
    let (app, pool) = setup_with_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, einsatz) = einsatz_anlegen(&app, &admin, "Lage").await;
    let id = einsatz["id"].as_i64().unwrap();
    let org_id = einsatz["org_id"].as_i64().unwrap();

    // Org-Default setzen: zeitzone = Europe/Berlin für die korrekte org_id.
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (?, ?) \
         ON CONFLICT(org_id) DO UPDATE SET zeitzone = excluded.zeitzone",
    )
    .bind(org_id)
    .bind("Europe/Berlin")
    .execute(&pool)
    .await
    .unwrap();

    // Einsatz-zeitzone bleibt NULL (kein Override gesetzt).
    let (status, v) = einstellungen_get(&app, &admin, id).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        v["zeitzone"].is_null(),
        "Einsatz-Override zeitzone muss null sein, war: {:?}",
        v["zeitzone"]
    );
    assert_eq!(
        v["org_defaults"]["zeitzone"], "Europe/Berlin",
        "Org-Default zeitzone muss unter org_defaults erscheinen"
    );
}

// ---------- LFH-306: Teil-PATCH der Kopfdaten mit Tri-State ----------

/// Setzt alle zwölf Kopffelder auf distinkte Werte; liefert die id.
async fn einsatz_mit_vollen_kopfdaten(app: &axum::Router, admin: &str) -> i64 {
    let (_, json) = einsatz_anlegen(app, admin, "Alt").await;
    let id = json["id"].as_i64().unwrap();
    let mut body = basis_kopf("Lage Nord");
    body["stichwort"] = json!("H1");
    body["einsatzart"] = json!("uebung");
    body["einsatznummer_intern"] = json!("EN-4711");
    body["leitstellen_nr"] = json!("LS-42");
    body["einsatzort"] = json!("Hauptstraße 1");
    body["einsatzort_lat"] = json!(52.5);
    body["einsatzort_lon"] = json!(13.4);
    body["meldende_stelle"] = json!("Leitstelle Mitte");
    body["sachverhalt"] = json!("Meldebild");
    body["anzahl_betroffene_initial"] = json!(5);
    body["begonnen_at"] = json!("2026-05-20 10:00:00");
    let (status, _) = patch_kopf(app, admin, id, body).await;
    assert_eq!(status, StatusCode::OK);
    id
}

/// **Der unterscheidende Test der Route.** Der Marker-Verschiebe-Aufruf der Lagekarte
/// sendet nur noch lat/lon — die übrigen zehn Felder müssen unangetastet bleiben.
/// Unter dem alten Vollersatz war dieser Request gar nicht möglich (fehlende Pflichtfelder
/// → Deserialisierungsfehler), und der Read-Modify-Write-Ersatz schrieb den veralteten
/// Kopfstand des Clients zurück — inklusive der PII-Felder `sachverhalt`/`meldende_stelle`.
#[tokio::test]
async fn patch_nur_koordinate_laesst_die_uebrigen_felder_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_mit_vollen_kopfdaten(&app, &admin).await;

    let (status, a) = patch_kopf(
        &app,
        &admin,
        id,
        json!({"einsatzort_lat": 48.1, "einsatzort_lon": 11.6}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(a["einsatzort_lat"], 48.1);
    assert_eq!(a["einsatzort_lon"], 11.6);
    assert_eq!(a["bezeichnung"], "Lage Nord");
    assert_eq!(a["stichwort"], "H1");
    assert_eq!(a["einsatzart"], "uebung");
    assert_eq!(a["leitstellen_nr"], "LS-42");
    assert_eq!(a["einsatzort"], "Hauptstraße 1");
    assert_eq!(a["meldende_stelle"], "Leitstelle Mitte");
    assert_eq!(a["sachverhalt"], "Meldebild");
    assert_eq!(a["anzahl_betroffene_initial"], 5);
    assert_eq!(a["begonnen_at"], "2026-05-20 10:00:00");
    assert_eq!(a["einsatznummer_intern"], "EN-4711", "Nummer bleibt");
}

/// Grenzt gegen den vorigen ab: `null` leert genau die gesendeten Felder — und trennt die
/// drei Ortsfelder voneinander (`einsatzort` weg, Koordinate bleibt).
#[tokio::test]
async fn patch_einsatzort_null_loescht_ort_aber_nicht_koordinate() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_mit_vollen_kopfdaten(&app, &admin).await;

    let (status, a) = patch_kopf(&app, &admin, id, json!({"einsatzort": null})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(a["einsatzort"].is_null());
    assert_eq!(a["einsatzort_lat"], 52.5, "Koordinate unberührt");
    assert_eq!(a["einsatzort_lon"], 13.4);
    assert_eq!(a["sachverhalt"], "Meldebild", "PII-Nachbarfeld unberührt");
}

/// Statuscode-Konvention (LFH-305): vorhandenes-aber-leeres Pflichtfeld → 400, absentes
/// geht durch. Der Kontrast ist die Aussage.
#[tokio::test]
async fn patch_leere_bezeichnung_ist_400_ohne_bezeichnung_bleibt_sie_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_mit_vollen_kopfdaten(&app, &admin).await;

    assert_eq!(
        patch_kopf(&app, &admin, id, json!({"bezeichnung": "   "}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    // Unbekannte Einsatzart bleibt 400 — aber nur, wenn das Feld gesendet wurde.
    assert_eq!(
        patch_kopf(&app, &admin, id, json!({"einsatzart": "quatsch"}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, a) = patch_kopf(&app, &admin, id, json!({"stichwort": "H2"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(a["bezeichnung"], "Lage Nord");
    assert_eq!(a["einsatzart"], "uebung");
    assert_eq!(a["stichwort"], "H2");
}

/// `begonnen_at` war das einzige NOT-NULL-Pflichtfeld ohne Default: ohne das Feld gab es
/// vorher einen Deserialisierungsfehler. Jetzt ist absent legal — und die Alarmzeit darf
/// dabei NICHT auf 'now' springen.
#[tokio::test]
async fn patch_ohne_begonnen_at_behaelt_die_alarmzeit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_mit_vollen_kopfdaten(&app, &admin).await;

    let (status, a) = patch_kopf(&app, &admin, id, json!({"stichwort": "H2"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(a["begonnen_at"], "2026-05-20 10:00:00");
}

/// Der Vollbody-Weg bleibt unverändert gültig: `EinsatzdatenPage` speichert bewusst alle
/// Kopffelder atomar, und ein explizites `null` muss dort weiterhin leeren.
#[tokio::test]
async fn vollbody_patch_verhaelt_sich_weiter_wie_vollersatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_mit_vollen_kopfdaten(&app, &admin).await;

    let (status, a) = patch_kopf(&app, &admin, id, basis_kopf("Zurückgesetzt")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(a["bezeichnung"], "Zurückgesetzt");
    assert_eq!(a["einsatzart"], "realeinsatz");
    assert!(a["stichwort"].is_null());
    assert!(a["leitstellen_nr"].is_null());
    assert!(a["einsatzort"].is_null());
    assert!(a["einsatzort_lat"].is_null());
    assert!(a["meldende_stelle"].is_null());
    assert!(a["sachverhalt"].is_null());
    assert!(a["anzahl_betroffene_initial"].is_null());
    assert_eq!(a["begonnen_at"], "2026-05-25 08:00:00");
}
