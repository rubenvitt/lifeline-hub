use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup};

// ---------- Harness ----------

async fn setup_mit_pool() -> (axum::Router, sqlx::SqlitePool) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let app = build_router(AppState {
        pool: pool.clone(),
        live: LiveHub::new(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (app, pool)
}

// ---------- Tests ----------

#[tokio::test]
async fn seed_liefert_fuenf_aktive_bausteine() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 5);
    assert_eq!(json[0]["label"], "Lage unverändert");
    assert_eq!(json[0]["typ"], "lage");
}

#[tokio::test]
async fn admin_crud_und_typ_validierung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(
        anfrage(&app, "GET", "/api/etb-bausteine", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &erika,
            Some(r#"{"typ":"meldung","label":"X","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"system","label":"S","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"berichtigung","label":"B","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"M","inhalt":"x","meldeweg":"brieftaube"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"   ","inhalt":"x"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    let (status, json) = anfrage(&app, "POST", "/api/etb-bausteine", &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Räumung {abschnitt} anordnen.","meldeweg":"funk","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["label"], "Räumung anordnen");
    assert_eq!(json["meldeweg"], "funk");
    let id = json["id"].as_i64().unwrap();

    let (status, json) = anfrage(&app, "PATCH", &format!("/api/etb-bausteine/{id}"), &admin,
        Some(r#"{"typ":"anordnung","label":"Räumung anordnen","inhalt":"Sofort räumen.","sortier":60}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["inhalt"], "Sofort räumen.");
    assert!(
        json["meldeweg"].is_null(),
        "PATCH ohne meldeweg muss das Feld leeren (Full-Replace)"
    );

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            "/api/etb-bausteine/9999",
            &admin,
            Some(r#"{"typ":"meldung","label":"Z","inhalt":"z"}"#)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn label_konflikt_auch_gegen_deaktivierten_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/etb-bausteine",
        &admin,
        Some(r#"{"typ":"lage","label":"Eigenlabel","inhalt":"a"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"b"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );

    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/etb-bausteine/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/etb-bausteine", &admin, None).await;
    assert!(!liste
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["label"] == "Eigenlabel"));

    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/etb-bausteine",
            &admin,
            Some(r#"{"typ":"meldung","label":"Eigenlabel","inhalt":"c"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn org_isolation_liste_trennt_orgs() {
    use lifeline_hub::etb_baustein::repo::{self, BausteinDaten};
    let (_app, pool) = setup_mit_pool().await;

    let org_a: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let org_b: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Org B') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();

    repo::anlegen(
        &pool,
        org_b,
        BausteinDaten {
            label: "Nur-B",
            typ: "meldung",
            inhalt: "b",
            meldeweg: None,
            veranlassung: None,
            sortier: 1,
        },
    )
    .await
    .unwrap();

    let liste_a = repo::liste(&pool, org_a).await.unwrap();
    assert!(!liste_a.iter().any(|b| b.label == "Nur-B"));
    let liste_b = repo::liste(&pool, org_b).await.unwrap();
    assert!(liste_b.iter().any(|b| b.label == "Nur-B"));

    let b_id = liste_b.iter().find(|b| b.label == "Nur-B").unwrap().id;
    assert!(matches!(
        repo::laden(&pool, org_a, b_id).await,
        Err(lifeline_hub::error::AppError::NotFound)
    ));
}
