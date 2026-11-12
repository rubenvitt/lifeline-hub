//! Nachbereitungsfrist über die HTTP-Routen (LLH-1494, Spec `aufbewahrung`, design.md D1).
//!
//! Org-Vorgabe → Abschluss setzt `nachbereitung_bis` mit ETB-Eintrag; `PUT …/nachbereitung` mit
//! den Rechten des Frist-PUT, 422 am aktiven und 409 am übergebenen Einsatz. Die Fachlogik pinnen die
//! Repo-Tests in `src/einsatz/nachbereitung.rs`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool,
};

async fn abschliessen(app: &axum::Router, cookie: &str, id: i64) -> Value {
    let (status, body) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn nachbereitung(
    app: &axum::Router,
    cookie: &str,
    id: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "PUT",
        &format!("/api/einsaetze/{id}/nachbereitung"),
        cookie,
        Some(&body),
    )
    .await
}

#[tokio::test]
async fn abschluss_setzt_nachbereitung_aus_der_org_vorgabe() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, body) = anfrage_json(
        &app,
        "PUT",
        "/api/org-einstellungen",
        &admin,
        Some(&json!({ "nachbereitung_tage": 30 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = einsatz_anlegen(&app, &admin).await;
    let einsatz = abschliessen(&app, &admin, id).await;

    let abgeschlossen = chrono::NaiveDateTime::parse_from_str(
        einsatz["abgeschlossen_at"].as_str().unwrap(),
        "%Y-%m-%d %H:%M:%S",
    )
    .unwrap();
    let erwartet = (abgeschlossen + chrono::Duration::days(30))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    assert_eq!(einsatz["nachbereitung_bis"], erwartet.as_str());
    let etb: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
         AND inhalt LIKE 'Nachbereitung bis %'",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(etb, 1);
}

#[tokio::test]
async fn ohne_vorgabe_fehlt_das_feld() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_anlegen(&app, &admin).await;
    let einsatz = abschliessen(&app, &admin, id).await;
    assert!(
        einsatz.get("nachbereitung_bis").is_none(),
        "fehlt statt null: {einsatz}"
    );
}

#[tokio::test]
async fn einsatzleitung_aendert_beobachter_ist_403_aktiv_ist_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let id = einsatz_anlegen(&app, &frieda).await;
    let beob = benutzer_anlegen(&app, &admin, "bertold", "keine").await;
    rolle_setzen(&app, &frieda, id, beob, "beobachter").await;
    let bert = login_cookie(&app, "bertold", "bertoldpw1").await;

    let (status, _) = nachbereitung(
        &app,
        &frieda,
        id,
        json!({ "nachbereitung_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "aktiver Einsatz");

    abschliessen(&app, &frieda, id).await;
    let (status, _) = nachbereitung(
        &app,
        &bert,
        id,
        json!({ "nachbereitung_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = nachbereitung(
        &app,
        &frieda,
        id,
        json!({ "nachbereitung_bis": "2099-01-01T00:00:00Z" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["nachbereitung_bis"], "2099-01-01 00:00:00");

    let (status, body) =
        nachbereitung(&app, &admin, id, json!({ "nachbereitung_bis": null })).await;
    assert_eq!(status, StatusCode::OK, "Admin der Einsatz-Org: {body}");
    assert!(body.get("nachbereitung_bis").is_none(), "{body}");

    let texte: Vec<String> = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND inhalt LIKE 'Nachbereitungsfrist%' \
         ORDER BY id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(texte.len(), 2, "{texte:?}");
    assert_eq!(texte[1], "Nachbereitungsfrist aufgehoben");

    sqlx::query("UPDATE einsatz SET geloescht_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = nachbereitung(
        &app,
        &admin,
        id,
        json!({ "nachbereitung_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "vorgemerkt");
}

#[tokio::test]
async fn der_kopf_nennt_die_wartende_verwahrung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_anlegen(&app, &admin).await;
    let einsatz = abschliessen(&app, &admin, id).await;
    assert!(einsatz.get("verwahrung").is_none(), "{einsatz}");

    sqlx::query(
        "INSERT INTO einsatz_verwahrung (einsatz_id, gegenstelle, grund, quittiert_at) \
         VALUES (?, 'Hub Kreis', '1 Anhang fehlt', datetime('now'))",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, body) =
        anfrage_json(&app, "GET", &format!("/api/einsaetze/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["verwahrung"],
        json!({ "gegenstelle": "Hub Kreis", "grund": "1 Anhang fehlt" })
    );
}

#[tokio::test]
async fn fehlendes_feld_ist_400_und_hebt_nichts_auf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_anlegen(&app, &admin).await;
    abschliessen(&app, &admin, id).await;
    let (status, _) = nachbereitung(
        &app,
        &admin,
        id,
        json!({ "nachbereitung_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = nachbereitung(&app, &admin, id, json!({})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, body) =
        nachbereitung(&app, &admin, id, json!({ "nachbereitung_bis": null })).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.get("nachbereitung_bis").is_none(),
        "aufgehoben: {body}"
    );
}
