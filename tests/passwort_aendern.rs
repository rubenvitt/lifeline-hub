//! Self-Service-Passwortwechsel (LFH-471): `POST /api/auth/passwort`.
//!
//! Gepinnt sind die vier Zusagen des Tickets: Wechsel mit Alt-Passwort und Anmeldung mit dem
//! neuen, 422 bei falschem Alt-Passwort, 400 bei zu kurzem neuen, und die eigene Sitzung
//! überlebt, während alle übrigen Sitzungen desselben Benutzers enden.

use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup, setup_mit_pool};

const PFAD: &str = "/api/auth/passwort";

/// Status eines Anmeldeversuchs, ohne Cookie.
async fn login_status(app: &axum::Router, benutzername: &str, passwort: &str) -> StatusCode {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    anfrage(app, "POST", "/api/auth/login", "", Some(&body))
        .await
        .0
}

fn wechsel(alt: &str, neu: &str) -> String {
    format!(r#"{{"altes_passwort":"{alt}","neues_passwort":"{neu}"}}"#)
}

/// Legt eine Nicht-Admin-Benutzerin an und meldet sie an. `benutzer_anlegen` vergibt das
/// Passwort `<name>pw1`.
async fn nutzerin(app: &axum::Router) -> String {
    let admin = login_cookie(app, "admin", "startpw12").await;
    benutzer_anlegen(app, &admin, "nutzerin", "keine").await;
    login_cookie(app, "nutzerin", "nutzerinpw1").await
}

#[tokio::test]
async fn wechsel_mit_altem_passwort_und_danach_anmeldung_mit_dem_neuen() {
    let app = setup().await;
    let cookie = nutzerin(&app).await;

    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("nutzerinpw1", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(
        login_status(&app, "nutzerin", "ganzneu1234").await,
        StatusCode::OK
    );
    assert_eq!(
        login_status(&app, "nutzerin", "nutzerinpw1").await,
        StatusCode::UNAUTHORIZED,
        "das alte Passwort darf nach dem Wechsel nicht mehr tragen"
    );
}

/// Falsches Alt-Passwort ist ein Zustandsfehler (422, wie „Code ungültig" bei TOTP), kein 401:
/// die Sitzung ist gültig, und ein 401 ließe die Sitzungswache des Frontends abmelden.
#[tokio::test]
async fn falsches_altes_passwort_ist_422_und_aendert_nichts() {
    let app = setup().await;
    let cookie = nutzerin(&app).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("daneben123", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(json["error"].is_string(), "Fehlerumschlag erwartet: {json}");

    assert_eq!(
        login_status(&app, "nutzerin", "nutzerinpw1").await,
        StatusCode::OK
    );
    assert_eq!(
        login_status(&app, "nutzerin", "ganzneu1234").await,
        StatusCode::UNAUTHORIZED
    );
    // Die eigene Sitzung bleibt: ein Tippfehler meldet niemanden ab.
    let (status, _) = anfrage(&app, "GET", "/api/auth/me", &cookie, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn zu_kurzes_neues_passwort_ist_400_und_aendert_nichts() {
    let app = setup().await;
    let cookie = nutzerin(&app).await;

    // Sieben Zeichen: eins unter `PASSWORT_MIN_LEN`.
    let (status, json) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("nutzerinpw1", "kurz123")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        json["error"].as_str().unwrap_or_default().contains('8'),
        "die Meldung nennt die Mindestlänge: {json}"
    );

    assert_eq!(
        login_status(&app, "nutzerin", "nutzerinpw1").await,
        StatusCode::OK
    );
}

/// Die Mindestlänge gilt ab genau acht Zeichen — dieselbe Grenze wie beim Anlegen.
#[tokio::test]
async fn neues_passwort_mit_genau_acht_zeichen_ist_erlaubt() {
    let app = setup().await;
    let cookie = nutzerin(&app).await;

    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("nutzerinpw1", "acht8888")),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn leeres_altes_passwort_ist_400() {
    let app = setup().await;
    let cookie = nutzerin(&app).await;

    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fehlendes_feld_ist_400() {
    let app = setup().await;
    let cookie = nutzerin(&app).await;

    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(r#"{"neues_passwort":"ganzneu1234"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Sitzungsfrage (LFH-471): die eigene Sitzung trägt den Folge-Request, alle anderen Sitzungen
/// desselben Benutzers sind beendet — ein Wechsel nach einem verratenen Passwort soll auch die
/// Sitzung dessen beenden, der es benutzt hat.
#[tokio::test]
async fn eigene_sitzung_ueberlebt_andere_sitzungen_enden() {
    let app = setup().await;
    let cookie = nutzerin(&app).await;
    let zweites_geraet = login_cookie(&app, "nutzerin", "nutzerinpw1").await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("nutzerinpw1", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, json) = anfrage(&app, "GET", "/api/auth/me", &cookie, None).await;
    assert_eq!(status, StatusCode::OK, "derselbe Cookie trägt weiter");
    assert_eq!(json["benutzername"], "nutzerin");

    let (status, _) = anfrage(&app, "GET", "/api/auth/me", &zweites_geraet, None).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "die übrigen Sitzungen des Benutzers enden"
    );

    // Fremde Sitzungen sind nicht betroffen.
    let (status, _) = anfrage(&app, "GET", "/api/auth/me", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn ohne_sitzung_ist_401() {
    let app = setup().await;
    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        "",
        Some(&wechsel("startpw12", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// Ist der Passwort-Provider abgeschaltet, gibt es auch keinen Passwortwechsel — dieselbe
/// Durchsetzung wie beim Login, nicht nur ein ausgeblendeter Abschnitt.
#[tokio::test]
async fn deaktivierter_passwort_provider_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES ('passwort', 0) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = 0",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("startpw12", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// Ein SSO-only-Konto hat kein lokales Passwort; ein „altes Passwort" kann es nicht nennen,
/// also kann es sich auf diesem Weg auch keines setzen.
#[tokio::test]
async fn sso_only_konto_kann_kein_passwort_setzen() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = nutzerin(&app).await;
    sqlx::query("UPDATE benutzer SET passwort_hash = ? WHERE benutzername = 'nutzerin'")
        .bind(lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY)
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = anfrage(
        &app,
        "POST",
        PFAD,
        &cookie,
        Some(&wechsel("irgendwas1", "ganzneu1234")),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let hash: String =
        sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'nutzerin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(hash, lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY);
}
