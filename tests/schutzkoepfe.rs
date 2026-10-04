//! Schutzköpfe an jeder Antwort (LFH-797, Spec `http-schutzkoepfe`).
//!
//! Die Schicht in `app.rs` setzt `X-Content-Type-Options: nosniff`, wo die Route ihn nicht schon
//! setzt. Geprüft wird an Antworten, die heute keine Route selbst versieht (JSON, 401, 404 unter
//! `/api/`, 405, Frontend-Fallback), und an einem Anhang-Download, dessen Route den Kopf selbst
//! setzt: dort steht er genau einmal. Der Download des Karten-Hintergrundbilds steht in
//! `tests/karte_hintergrundbild.rs` (eigener Upload-Harness).

use axum::body::Body;
use axum::http::{header, HeaderMap, Request, StatusCode};
use tower::ServiceExt;

mod common;
use common::{einsatz_anlegen, login_cookie, schaden_anhang, setup, setup_mit_pool};

async fn kopf(app: &axum::Router, uri: &str, cookie: Option<&str>) -> (StatusCode, HeaderMap) {
    let mut req = Request::builder().method("GET").uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    (resp.status(), resp.headers().clone())
}

/// Genau ein `X-Content-Type-Options`, und zwar `nosniff`.
fn nosniff_genau_einmal(headers: &HeaderMap) {
    let werte: Vec<_> = headers
        .get_all(header::X_CONTENT_TYPE_OPTIONS)
        .iter()
        .collect();
    assert_eq!(werte, ["nosniff"], "X-Content-Type-Options: {werte:?}");
}

#[tokio::test]
async fn json_antwort_traegt_nosniff() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, h) = kopf(&app, "/api/auth/me", Some(&admin)).await;
    assert_eq!(s, StatusCode::OK);
    nosniff_genau_einmal(&h);
}

#[tokio::test]
async fn fehlerantwort_ohne_anmeldung_traegt_nosniff() {
    let app = setup().await;
    let (s, h) = kopf(&app, "/api/auth/me", None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    nosniff_genau_einmal(&h);
}

#[tokio::test]
async fn unbekannte_api_route_traegt_nosniff() {
    let app = setup().await;
    let (s, h) = kopf(&app, "/api/gibt-es-nicht", None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    nosniff_genau_einmal(&h);
}

/// Der Frontend-Fallback (`static_files::serve`). Im Test ist `frontend/dist` leer, die Antwort
/// ist also seine 404 — der Kopf hängt an jeder Antwort des Fallbacks. Den passenden
/// Content-Type je Endung sichern die Unit-Tests in `src/static_files.rs`.
#[tokio::test]
async fn frontend_fallback_traegt_nosniff() {
    let app = setup().await;
    let (_, h) = kopf(&app, "/", None).await;
    nosniff_genau_einmal(&h);
}

/// Der 405-Fallback (`methode_nicht_erlaubt`) liegt innerhalb der Schicht.
#[tokio::test]
async fn methode_nicht_erlaubt_traegt_nosniff() {
    let app = setup().await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/auth/me")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
    nosniff_genau_einmal(resp.headers());
}

/// `anhang_antwort` setzt `nosniff` selbst; die Schicht darf ihn nicht verdoppeln.
#[tokio::test]
async fn anhang_download_traegt_nosniff_genau_einmal() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = schaden_anhang(&pool, einsatz).await;
    // Kein Bild: die bereinigte Fassung reicht die Bytes unverändert durch (sonst 422 für die
    // drei Bytes des Fixture-„JPEG“).
    sqlx::query("UPDATE anhang SET mime = 'text/plain' WHERE id = ?")
        .bind(aid)
        .execute(&pool)
        .await
        .unwrap();
    let sid: i64 =
        sqlx::query_scalar("SELECT schaden_id FROM einsatz_schaden_anhang WHERE anhang_id = ?")
            .bind(aid)
            .fetch_one(&pool)
            .await
            .unwrap();

    let (s, h) = kopf(
        &app,
        &format!("/api/einsaetze/{einsatz}/schaeden/{sid}/anhaenge/{aid}/datei"),
        Some(&admin),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    nosniff_genau_einmal(&h);
}
