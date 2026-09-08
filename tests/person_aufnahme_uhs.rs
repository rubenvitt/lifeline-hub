//! LFH-458: atomare Aufnahme mit UHS, Offline-Replay und Rechte-Grenzen.
use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::live::{LiveEvent, LiveHub};
use serde_json::{json, Value};

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen};

async fn setup() -> (axum::Router, sqlx::SqlitePool, LiveHub, String, i64, i64) {
    let pool = lifeline_hub::db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let app = build_router(AppState {
        pool: pool.clone(),
        live: live.clone(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, uhs) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/uhs"),
        &admin,
        Some(r#"{"typ":"behandlungsplatz","bezeichnung":"BHP Mitte"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let u = uhs["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/uhs/{u}/status"),
        &admin,
        Some(r#"{"status":"aktiv"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    (app, pool, live, admin, e, u)
}

async fn aufnehmen(app: &axum::Router, cookie: &str, e: i64, body: Value) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn zeilen(pool: &sqlx::SqlitePool) -> (i64, i64, i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM einsatz_person), \
        (SELECT COUNT(*) FROM person_sichtung), (SELECT COUNT(*) FROM person_uhs_belegung), \
        (SELECT COUNT(*) FROM etb_eintrag)",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn aufnahme_antwort_verlauf_audit_und_live_sind_nach_commit_vollstaendig() {
    let (app, pool, live, admin, e, u) = setup().await;
    let mut rx = live.abonniere(e);
    let (s, person) = aufnehmen(
        &app,
        &admin,
        e,
        json!({
            "uhs_id": u, "sichtung": "sk2", "name": "GEHEIMER_NAME", "notiz": "GEHEIMER_BEFUND"
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(person["aktuelle_uhs_id"], u);
    assert!(person["aktueller_platz_id"].is_null());
    assert_eq!(person["status"], "betroffen");
    assert_eq!(person["aktuelle_sichtung"], "sk2");
    let p = person["id"].as_i64().unwrap();
    let belegt = lifeline_hub::uhs::belegung_repo::liste_je_person(&pool, e, p)
        .await
        .unwrap();
    assert_eq!(belegt.len(), 1);
    assert_eq!(belegt[0].uhs_id, u);
    assert_eq!(belegt[0].art.as_str(), "eintritt");
    assert!(belegt[0].platz_id.is_none());
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    assert!(etb
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["inhalt"] == "Person R-001: Aufnahme in BHP Mitte (Inbox)"));
    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        assert!(!event.data.contains("GEHEIMER"));
        if event.event == LiveEvent::Uhs {
            assert_eq!(
                serde_json::from_str::<Value>(&event.data).unwrap(),
                json!({"einsatz_id": e, "uhs_id": u})
            );
        }
        events.push(event.event);
    }
    assert!(events.contains(&LiveEvent::Uhs));
    assert!(events.contains(&LiveEvent::Person));
    assert!(events.contains(&LiveEvent::Etb));
    assert!(!etb.to_string().contains("GEHEIMER"));
}

#[tokio::test]
async fn aufnahme_belegungsfehler_rollt_person_sichtung_und_audit_zurueck() {
    let (app, pool, live, admin, e, u) = setup().await;
    // Fehler NACH Personen-INSERT und Erst-Sichtung, im eigentlichen Belegungs-Write.
    sqlx::query(
        "CREATE TRIGGER belegung_abbrechen BEFORE INSERT ON person_uhs_belegung \
        BEGIN SELECT RAISE(ABORT, 'erzwungener Belegungsfehler'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    let vorher = zeilen(&pool).await;
    let mut rx = live.abonniere(e);
    let (s, _) = aufnehmen(
        &app,
        &admin,
        e,
        json!({"uhs_id": u, "sichtung": "sk1", "client_id": "rollback"}),
    )
    .await;
    assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(zeilen(&pool).await, vorher);
    assert!(
        rx.try_recv().is_err(),
        "Rollback darf keine Live-Erfolgsmeldung senden"
    );
}

#[tokio::test]
async fn aufnahme_vermisst_inaktiv_unbekannt_und_fremder_einsatz_sind_abgewiesen() {
    let (app, pool, _, admin, e, u) = setup().await;
    let fremd = einsatz_anlegen(&app, &admin).await;
    let vorher = zeilen(&pool).await;
    for (einsatz, body, erwartet) in [
        (
            e,
            json!({"uhs_id": u, "status": "vermisst"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (e, json!({"uhs_id": 999999}), StatusCode::NOT_FOUND),
        (fremd, json!({"uhs_id": u}), StatusCode::NOT_FOUND),
    ] {
        let (s, _) = aufnehmen(&app, &admin, einsatz, body).await;
        assert_eq!(s, erwartet);
        assert_eq!(zeilen(&pool).await, vorher);
    }
    sqlx::query("UPDATE uhs SET status = 'geplant' WHERE id = ?")
        .bind(u)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _) = aufnehmen(&app, &admin, e, json!({"uhs_id": u})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(zeilen(&pool).await, vorher);
    sqlx::query("UPDATE uhs SET storniert_at = datetime('now') WHERE id = ?")
        .bind(u)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _) = aufnehmen(&app, &admin, e, json!({"uhs_id": u})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(zeilen(&pool).await, vorher);
}

#[tokio::test]
async fn aufnahme_replay_legt_belegung_nicht_doppelt_an_auch_nach_abschluss() {
    let (app, pool, live, admin, e, u) = setup().await;
    let body = json!({"uhs_id": u, "status": "betroffen", "client_id": "uhs-offline"});
    let (s, person) = aufnehmen(&app, &admin, e, body.clone()).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(person["aktuelle_uhs_id"], u);
    let vorher = zeilen(&pool).await;
    assert_eq!(vorher.2, 1);
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE uhs SET status = 'aufgeloest' WHERE id = ?")
        .bind(u)
        .execute(&pool)
        .await
        .unwrap();
    let mut rx = live.abonniere(e);
    let (s, replay) = aufnehmen(&app, &admin, e, body).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(replay, person);
    assert_eq!(zeilen(&pool).await, vorher);
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn aufnahme_replay_ergaenzt_keine_uhs_an_bestehender_person() {
    let (app, pool, _, admin, e, u) = setup().await;
    let (s, person) = aufnehmen(&app, &admin, e, json!({"client_id": "ohne-uhs"})).await;
    assert_eq!(s, StatusCode::CREATED);
    let vorher = zeilen(&pool).await;
    let (s, replay) = aufnehmen(
        &app,
        &admin,
        e,
        json!({"client_id": "ohne-uhs", "uhs_id": u}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(replay, person);
    assert_eq!(zeilen(&pool).await, vorher);
}

#[tokio::test]
async fn aufnahme_braucht_uhs_modulzugriff_auch_beim_replay() {
    let (app, pool, _, admin, e, u) = setup().await;
    let b = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, b, "fuehrungspersonal").await;
    let cookie = login_cookie(&app, "frieda", "friedapw1").await;
    let body = json!({"client_id": "rechte-replay", "uhs_id": u});
    assert_eq!(
        aufnehmen(&app, &cookie, e, body.clone()).await.0,
        StatusCode::CREATED
    );
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/unfallhilfsstellen"),
        &admin,
        Some(r#"{"sichtbar":false}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let vorher = zeilen(&pool).await;
    assert_eq!(
        aufnehmen(&app, &cookie, e, body).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        aufnehmen(&app, &cookie, e, json!({"uhs_id": u})).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(zeilen(&pool).await, vorher);
    assert_eq!(
        aufnehmen(&app, &cookie, e, json!({})).await.0,
        StatusCode::CREATED
    );
}
