use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt; // stellt `oneshot` bereit

mod common;
use common::{anfrage, login_cookie, setup};

/// Legt über die Admin-Benutzerverwaltung einen normalen Nutzer
/// (`system_rolle = 'keiner'`) an.
async fn nicht_admin_anlegen(app: &axum::Router, admin_cookie: &str) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie)
                .body(Body::from(
                    r#"{"anzeigename":"Erika","benutzername":"erika","passwort":"erikapw1"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn get_liefert_bootstrap_default_hilfsorganisation() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "GET", "/api/organisation", &admin_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["tz_organisation"], "hilfsorganisation");
    assert_eq!(json["name"], "Test-Orga");
}

#[tokio::test]
async fn patch_als_admin_setzt_org_default() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/organisation")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.clone())
                .body(Body::from(r#"{"tz_organisation":"feuerwehr"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Danach liefert GET den neuen Wert.
    let (status, json) = anfrage(&app, "GET", "/api/organisation", &admin_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["tz_organisation"], "feuerwehr");
}

/// `tz_organisation` wird gegen die ERLAUBTE_ORG-Allowlist geprüft — enum-artig, scheitert
/// am Feld selbst → 400 (LFH-305). Bis dahin war diese Stelle ungetestet; die Datei hatte
/// überhaupt keinen Fehlerfall außer 403. Der Positiv-Zweig belegt, dass der 400 aus der
/// Allowlist kommt und nicht aus der Admin-Prüfung davor.
#[tokio::test]
async fn patch_unbekannte_organisation_ist_400() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &admin_cookie,
        Some(r#"{"tz_organisation":"quatsch"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &admin_cookie,
        Some(r#"{"tz_organisation":"feuerwehr"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Positiv-Zweig: {antwort:?}");
}

#[tokio::test]
async fn patch_als_nicht_admin_ist_403() {
    let app = setup().await;
    let admin_cookie = login_cookie(&app, "admin", "startpw12").await;
    nicht_admin_anlegen(&app, &admin_cookie).await;

    let erika_cookie = login_cookie(&app, "erika", "erikapw1").await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/api/organisation")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, erika_cookie)
                .body(Body::from(r#"{"tz_organisation":"feuerwehr"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// --- Name der Organisation (LFH-22, design.md D7) -------------------------------------

/// Liest den aktuellen Namen über die Route (dieselbe Sicht wie das Frontend).
async fn org_name(app: &axum::Router, cookie: &str) -> String {
    let (status, json) = anfrage(app, "GET", "/api/organisation", cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    json["name"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn patch_name_benennt_um_und_folgender_get_liefert_ihn() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &admin,
        Some(r#"{"name":"  DRK Kreisverband Musterstadt  "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["name"], "DRK Kreisverband Musterstadt", "getrimmt");
    // Der Name allein lässt die taktische Vorgabe stehen.
    assert_eq!(json["tz_organisation"], "hilfsorganisation");
    assert_eq!(org_name(&app, &admin).await, "DRK Kreisverband Musterstadt");
}

/// 120 Zeichen sind die Grenze — gezählt in Zeichen, nicht in Bytes: 120 × „ä" sind
/// 240 Bytes und müssen angenommen werden, 121 Zeichen nicht.
#[tokio::test]
async fn patch_name_grenze_zaehlt_zeichen_nicht_bytes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let genau = "ä".repeat(120);
    let body = format!(r#"{{"name":"{genau}"}}"#);
    let (status, json) = anfrage(&app, "PATCH", "/api/organisation", &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(org_name(&app, &admin).await, genau);
}

#[tokio::test]
async fn patch_name_leer_oder_zu_lang_ist_400_und_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let zu_lang = format!(r#"{{"name":"{}"}}"#, "a".repeat(121));
    for body in [r#"{"name":"   "}"#, r#"{"name":""}"#, zu_lang.as_str()] {
        let (status, json) = anfrage(&app, "PATCH", "/api/organisation", &admin, Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {json:?}");
        assert_eq!(org_name(&app, &admin).await, "Test-Orga", "{body}");
    }
}

/// Ein ungültiger Name neben einer gültigen Vorgabe darf die Vorgabe NICHT halb
/// übernehmen: erst prüfen, dann schreiben.
#[tokio::test]
async fn patch_ungueltiger_name_schreibt_auch_die_vorgabe_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, _) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &admin,
        Some(r#"{"name":"   ","tz_organisation":"feuerwehr"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, json) = anfrage(&app, "GET", "/api/organisation", &admin, None).await;
    assert_eq!(json["tz_organisation"], "hilfsorganisation");
    assert_eq!(json["name"], "Test-Orga");
}

#[tokio::test]
async fn patch_nur_vorgabe_laesst_den_namen_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &admin,
        Some(r#"{"tz_organisation":"thw"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["tz_organisation"], "thw");
    assert_eq!(json["name"], "Test-Orga");
}

#[tokio::test]
async fn patch_ohne_aenderbares_feld_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "PATCH", "/api/organisation", &admin, Some("{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
}

#[tokio::test]
async fn patch_name_als_nicht_admin_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    nicht_admin_anlegen(&app, &admin).await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (status, _) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &erika,
        Some(r#"{"name":"Gekapert"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(org_name(&app, &admin).await, "Test-Orga");
}

/// Der Konfigurationsname ist nur Anfangswert: ein zweiter Bootstrap-Lauf (Neustart) lässt
/// den gepflegten Namen stehen.
#[tokio::test]
async fn zweiter_bootstrap_laesst_gepflegten_namen_stehen() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, _) = anfrage(
        &app,
        "PATCH",
        "/api/organisation",
        &admin,
        Some(r#"{"name":"Gepflegter Name"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    lifeline_hub::auth::bootstrap::bootstrap_admin(
        &pool,
        "Konfig-Name",
        "admin",
        Some("startpw12"),
    )
    .await
    .unwrap();
    assert_eq!(org_name(&app, &admin).await, "Gepflegter Name");
}
