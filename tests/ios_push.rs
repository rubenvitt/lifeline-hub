//! iOS-Push über das Relais (LLH-2040): die Routen der Anmeldung und ihre Lebensdauer an Sitzung
//! und Konto. Versand und Relais haben eigene Tests; hier wird nichts gesendet.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::ios_push::krypto::nachweis;
use lifeline_hub::ios_push::IosPush;
use lifeline_hub::web_push::krypto::b64;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, setup_mit_pool_und_live};

const KENNUNG: &str = "6f1c2a64-3b1e-4a55-9c1d-0d3b5a7e9f10";
const KENNUNG_2: &str = "0a8f3a6e-52a4-4d0b-8a3c-6b1f6c2d9e11";
const TOKEN: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TOKEN_2: &str = "ff00ee11dd22cc33bb44aa5599668877ff00ee11dd22cc33bb44aa5599668877";

fn schluessel() -> [u8; 32] {
    [7u8; 32]
}

fn body(kennung: &str, token: &str) -> Value {
    json!({
        "kennung": kennung,
        "token": token,
        "umgebung": "sandbox",
        "schluessel": b64(&schluessel()),
        "inhalt": true,
        "stumm": ["lagebericht", "quatsch"],
    })
}

async fn mit_ios_push() -> (axum::Router, sqlx::SqlitePool) {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    live.ios_push_einrichten(
        IosPush::einrichten_fuer_test(pool.clone(), "http://127.0.0.1:9".parse().unwrap()).unwrap(),
    );
    (app, pool)
}

async fn anmelden(app: &axum::Router, cookie: &str, kennung: &str, token: &str) -> StatusCode {
    anfrage(
        app,
        "PUT",
        "/api/ios-push/anmeldung",
        cookie,
        Some(&body(kennung, token).to_string()),
    )
    .await
    .0
}

async fn zahl(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM ios_push_anmeldung")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn oeffentlich_abmelden(app: &axum::Router, kennung: &str, nachweis: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/ios-push/abmelden")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "kennung": kennung, "nachweis": nachweis }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn ohne_schalter_404() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    assert!(live.ios_push().is_none());
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let uri = format!("/api/ios-push?kennung={KENNUNG}");
    assert_eq!(
        anfrage(&app, "GET", &uri, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NOT_FOUND
    );
    let del = json!({ "kennung": KENNUNG }).to_string();
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            "/api/ios-push/anmeldung",
            &admin,
            Some(&del)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG, "x").await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn geraetekonto_403() {
    let (app, _pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        Some(r#"{"ansicht":"lagemonitor","bezeichnung":"Monitor"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/geraete/koppeln")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let geraet = resp.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert_eq!(
        anmelden(&app, &geraet, KENNUNG, TOKEN).await,
        StatusCode::FORBIDDEN
    );
    let uri = format!("/api/ios-push?kennung={KENNUNG}");
    assert_eq!(
        anfrage(&app, "GET", &uri, &geraet, None).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn anmelden_stand_abmelden() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let uri = format!("/api/ios-push?kennung={KENNUNG}");

    let (s, v) = anfrage(&app, "GET", &uri, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["eingeschaltet"], true);
    assert_eq!(v["angemeldet"], false);
    assert_eq!(v["inhalt"], false);
    assert_eq!(v["stumm"], json!([]));
    assert_eq!(v["relais_gesperrt"], false);

    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    let (_, v) = anfrage(&app, "GET", &uri, &admin, None).await;
    assert_eq!(v["angemeldet"], true);
    assert_eq!(v["inhalt"], true);
    assert_eq!(v["stumm"], json!(["lagebericht"]));

    // Erneut anmelden ersetzt, es bleibt eine Zeile.
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(zahl(&pool).await, 1);

    // Ein anderer Nutzer sieht die Anmeldung nicht.
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    let (_, v) = anfrage(&app, "GET", &uri, &marlene, None).await;
    assert_eq!(v["angemeldet"], false);

    // Abmelden ist idempotent.
    let del = json!({ "kennung": KENNUNG }).to_string();
    for _ in 0..2 {
        let (s, _) = anfrage(
            &app,
            "DELETE",
            "/api/ios-push/anmeldung",
            &admin,
            Some(&del),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
    }
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn validierung_400_je_feld() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ok = body(KENNUNG, TOKEN);
    let faelle: Vec<(&str, Value)> = vec![
        ("kennung", json!("kein-uuid")),
        ("token", json!("zz")),
        ("token", json!("ab".repeat(33) + "g")),
        ("token", json!("ab")),
        ("token", json!("ab".repeat(101))),
        ("umgebung", json!("test")),
        ("schluessel", json!("!!!")),
        ("schluessel", json!(b64(&[1u8; 16]))),
        ("stumm", json!(vec!["lagebericht"; 200])),
    ];
    for (feld, wert) in faelle {
        let mut b = ok.clone();
        b[feld] = wert.clone();
        let (s, v) = anfrage(
            &app,
            "PUT",
            "/api/ios-push/anmeldung",
            &admin,
            Some(&b.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld} = {wert}: {v}");
    }
    let (s, _) = anfrage(&app, "GET", "/api/ios-push?kennung=kein-uuid", &admin, None).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn abmelden_ohne_sitzung_immer_204_und_nur_mit_nachweis_wirksam() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );

    // Falscher Nachweis und unbekannte Kennung: 204, nichts ändert sich.
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG, "falsch").await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG_2, "egal").await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(zahl(&pool).await, 1);

    // Richtiger Nachweis löscht.
    let n = nachweis(&schluessel(), KENNUNG);
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG, &n).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn logout_loescht_die_anmeldung_dieser_sitzung() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene1 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene2 = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene1, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene2, KENNUNG_2, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    let (s, _) = anfrage(&app, "POST", "/api/auth/logout", &marlene1, None).await;
    assert!(s.is_success(), "{s}");
    let kennungen: Vec<String> = sqlx::query_scalar("SELECT kennung FROM ios_push_anmeldung")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(kennungen, vec![KENNUNG_2.to_string()]);
}

#[tokio::test]
async fn sitzungen_beenden_alle_loescht_alle_anmeldungen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene1 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene2 = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene1, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene2, KENNUNG_2, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    // Ein Admin beendet alle Sitzungen: auch deren Anmeldungen gehen.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{marlene_id}/sitzungen/beenden"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn eine_sitzung_beenden_loescht_nur_deren_anmeldung() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene1 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene2 = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene1, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene2, KENNUNG_2, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/auth/sitzungen", &marlene2, None).await;
    let fremde = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["aktuell"] == false)
        .unwrap()["kennung"]
        .as_str()
        .unwrap()
        .to_string();
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{fremde}"),
        &marlene2,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let kennungen: Vec<String> = sqlx::query_scalar("SELECT kennung FROM ios_push_anmeldung")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(kennungen, vec![KENNUNG_2.to_string()]);

    // „Andere beenden“ lässt die der eigenen Sitzung stehen.
    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/auth/sitzungen/andere-beenden",
        &marlene2,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(zahl(&pool).await, 1);
}

#[tokio::test]
async fn deaktivieren_loescht_die_anmeldungen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{marlene_id}/deaktivieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn ablauf_der_sitzung_laesst_anmeldung_und_versand_bestehen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    sqlx::query("UPDATE session SET expires_at = datetime('now', '-1 hour')")
        .execute(&pool)
        .await
        .unwrap();
    lifeline_hub::auth::session::purge_abgelaufene(&pool)
        .await
        .unwrap();
    assert_eq!(zahl(&pool).await, 1, "Ablauf löscht die Anmeldung nicht");
    let hash: Option<String> =
        sqlx::query_scalar("SELECT session_token_hash FROM ios_push_anmeldung")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(hash.is_none(), "Sitzungsbindung fällt weg");
    let a = lifeline_hub::ios_push::repo::anmeldungen_von(
        &pool,
        &[
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'marlene'")
                .fetch_one(&pool)
                .await
                .unwrap(),
        ],
    )
    .await
    .unwrap();
    assert_eq!(a.len(), 1, "der Versand findet die Anmeldung weiter");
}
