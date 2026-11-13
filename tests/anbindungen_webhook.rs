//! Webhook einer Anbindung verwalten (LLH-1656, Spec `webhook-zustellung`, design.md D8):
//! Routen unter `/api/admin/anbindungen/{id}/webhook`, Rechte, Eingaben, Admin-Spur,
//! Wiederaufnahme und Testereignis.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage_json, benutzer_anlegen, login_cookie, setup_mit_pool};

const LISTE: &str = "/api/admin/anbindungen";

async fn anbindung(app: &axum::Router, admin: &str) -> String {
    let (s, v) = anfrage_json(
        app,
        "POST",
        LISTE,
        admin,
        Some(&json!({ "name": "Einsatzbuch", "scopes": ["events:read", "einsaetze:read"] })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["zugang"]["id"].as_str().unwrap().to_string()
}

fn pfad(id: &str) -> String {
    format!("{LISTE}/{id}/webhook")
}

async fn einrichten(app: &axum::Router, admin: &str, id: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "POST", &pfad(id), admin, Some(&body)).await
}

async fn spur(pool: &sqlx::SqlitePool) -> Vec<(String, String, Option<String>)> {
    sqlx::query_as("SELECT aktion, ziel, detail FROM admin_audit ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn einrichten_zeigt_den_webhook_und_schreibt_nur_den_host_in_die_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;

    let (s, w) = einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": " https://empfaenger.example/hook/geheim-token ", "arten": ["einsatz.created", "einsatz.closed", "einsatz.created"] }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{w}");
    assert_eq!(w["url"], "https://empfaenger.example/hook/geheim-token");
    assert_eq!(w["arten"], json!(["einsatz.created", "einsatz.closed"]));
    assert_eq!(w["lan_erlaubt"], false);
    // Der Zugang wartet noch auf das Einlösen: der Webhook ruht.
    assert_eq!(w["zustand"], "ruht");
    assert_eq!(w["ruht_grund"], "zugang_wartet");

    // In der Liste und der Ansicht steht er an der Anbindung.
    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(liste["zugaenge"][0]["webhook"]["id"], w["id"]);
    let (_, ansicht) = anfrage_json(&app, "GET", &format!("{LISTE}/{id}"), &admin, None).await;
    assert_eq!(ansicht["webhook"]["url"], w["url"]);

    let (aktion, ziel, detail) = spur(&pool).await.pop().unwrap();
    assert_eq!(aktion, "maschinenzugang_webhook_angelegt");
    assert_eq!(ziel, "Einsatzbuch");
    let detail = detail.unwrap();
    assert!(detail.contains("empfaenger.example"), "{detail}");
    assert!(
        !detail.contains("geheim-token"),
        "kein Pfad in der Spur: {detail}"
    );

    // Ein zweiter: 409.
    let (s, _) = einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://anderer.example/", "arten": ["einsatz.closed"] }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn eingaben_werden_geprueft() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    for body in [
        json!({ "url": "http://empfaenger.example/hook", "arten": ["einsatz.created"] }),
        json!({ "url": "https://nutzer:geheim@empfaenger.example/", "arten": ["einsatz.created"] }),
        json!({ "url": "https://localhost/hook", "arten": ["einsatz.created"] }),
        json!({ "url": "https://127.0.0.1/hook", "arten": ["einsatz.created"], "lan_erlaubt": true }),
        json!({ "url": "https://10.0.0.5/hook", "arten": ["einsatz.created"] }),
        json!({ "url": "https://empfaenger.example/", "arten": [] }),
        json!({ "url": "https://empfaenger.example/", "arten": ["alles"] }),
        json!({ "url": "  ", "arten": ["einsatz.created"] }),
        json!({ "url": format!("https://empfaenger.example/{}", "x".repeat(2048)), "arten": ["einsatz.created"] }),
    ] {
        let (s, v) = einrichten(&app, &admin, &id, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }
    let webhooks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschine_webhook")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(webhooks, 0);
}

#[tokio::test]
async fn lan_ausnahme_hat_eigene_eintraege_in_der_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    let (s, w) = einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://10.0.0.5/hook", "arten": ["einsatz.created"], "lan_erlaubt": true }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{w}");
    let aktionen: Vec<String> = spur(&pool).await.into_iter().map(|e| e.0).collect();
    assert!(aktionen.ends_with(&[
        "maschinenzugang_webhook_angelegt".to_string(),
        "maschinenzugang_webhook_lan_erlaubt".to_string()
    ]));

    // Ausnahme weg, Ziel bleibt im LAN: 400.
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &pfad(&id),
        &admin,
        Some(&json!({ "lan_erlaubt": false, "basis_geaendert_at": w["geaendert_at"] })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Ausnahme weg mit öffentlichem Ziel: zwei Einträge, geändert und entzogen.
    let (s, w2) = anfrage_json(
        &app,
        "PATCH",
        &pfad(&id),
        &admin,
        Some(&json!({
            "url": "https://empfaenger.example/hook",
            "lan_erlaubt": false,
            "basis_geaendert_at": w["geaendert_at"]
        })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{w2}");
    assert_eq!(w2["lan_erlaubt"], false);
    let aktionen: Vec<String> = spur(&pool).await.into_iter().map(|e| e.0).collect();
    assert!(aktionen.ends_with(&[
        "maschinenzugang_webhook_geaendert".to_string(),
        "maschinenzugang_webhook_lan_entzogen".to_string()
    ]));

    // Mit altem Stand: 409.
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &pfad(&id),
        &admin,
        Some(&json!({ "arten": ["einsatz.closed"], "basis_geaendert_at": w["geaendert_at"] })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn fuehrungskraft_liest_aber_schreibt_nicht() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://empfaenger.example/", "arten": ["einsatz.created"] }),
    )
    .await;
    benutzer_anlegen(&app, &admin, "erika", "fuehrungskraft").await;
    let fk = login_cookie(&app, "erika", "erikapw1").await;

    let (s, ansicht) = anfrage_json(&app, "GET", &format!("{LISTE}/{id}"), &fk, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(ansicht["webhook"]["id"].is_string());
    let (s, _) = anfrage_json(&app, "GET", &format!("{}/versuche", pfad(&id)), &fk, None).await;
    assert_eq!(s, StatusCode::OK);

    for (methode, p, body) in [
        (
            "POST",
            pfad(&id),
            Some(json!({ "url": "https://x.example/", "arten": ["einsatz.created"] })),
        ),
        (
            "PATCH",
            pfad(&id),
            Some(json!({ "arten": ["einsatz.closed"], "basis_geaendert_at": "x" })),
        ),
        ("DELETE", pfad(&id), None),
        ("POST", format!("{}/wieder-aufnehmen", pfad(&id)), None),
        ("POST", format!("{}/test", pfad(&id)), None),
    ] {
        let (s, _) = anfrage_json(&app, methode, &p, &fk, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {p}");
    }
}

/// Setzt den Webhook auf „angehalten“ mit dem Ereignis 5 als wartendem.
async fn anhalten(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "UPDATE maschine_webhook SET zustand = 'angehalten', angehalten_at = '2026-11-01 10:00:00', \
         fehler_seit = '2026-10-31 10:00:00', fehlversuche = 12, offen_id = 5, cursor = 4",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn wieder_aufnehmen_liefert_nach_solange_der_rueckstand_besteht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://empfaenger.example/", "arten": ["einsatz.created"] }),
    )
    .await;
    let weiter = format!("{}/wieder-aufnehmen", pfad(&id));

    // Nicht angehalten: 409.
    let (s, _) = anfrage_json(&app, "POST", &weiter, &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);

    // Rückstand noch da (Löschgrenze 0): Cursor bleibt, kein Verlust.
    anhalten(&pool).await;
    let (s, w) = anfrage_json(&app, "POST", &weiter, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{w}");
    assert_ne!(w["zustand"], "angehalten");
    assert!(w["verlust_at"].is_null());
    assert!(w["fehler_seit"].is_null());
    let cursor: i64 = sqlx::query_scalar("SELECT cursor FROM maschine_webhook")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cursor, 4);
    assert_eq!(
        spur(&pool).await.pop().unwrap().0,
        "maschinenzugang_webhook_wieder_aufgenommen"
    );

    // Rückstand gelöscht (Löschgrenze über dem wartenden Ereignis): Sprung und Hinweis.
    anhalten(&pool).await;
    sqlx::query("UPDATE maschine_ereignis_stand SET purged_until = 9")
        .execute(&pool)
        .await
        .unwrap();
    let (s, w) = anfrage_json(&app, "POST", &weiter, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{w}");
    assert!(w["verlust_at"].is_string());
    let (cursor, offen): (i64, Option<i64>) =
        sqlx::query_as("SELECT cursor, offen_id FROM maschine_webhook")
            .fetch_one(&pool)
            .await
            .unwrap();
    let head = lifeline_hub::public_api::events::hoechststand(&pool)
        .await
        .unwrap();
    assert_eq!(cursor, head);
    assert_eq!(offen, None);
}

#[tokio::test]
async fn testereignis_haelt_nur_den_verlauf_fest() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    // `.invalid` löst nie auf (RFC 6761): der Versuch scheitert ohne Verbindung.
    einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://empfaenger.invalid/hook", "arten": ["einsatz.created"] }),
    )
    .await;
    let vorher: (i64, String, Option<String>) =
        sqlx::query_as("SELECT cursor, zustand, naechster_versuch_at FROM maschine_webhook")
            .fetch_one(&pool)
            .await
            .unwrap();
    let eintraege = spur(&pool).await.len();

    let (s, e) = anfrage_json(&app, "POST", &format!("{}/test", pfad(&id)), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{e}");
    assert_eq!(e["erfolg"], false);
    assert!(e["fehler_art"].is_string());

    let nachher: (i64, String, Option<String>) =
        sqlx::query_as("SELECT cursor, zustand, naechster_versuch_at FROM maschine_webhook")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nachher, vorher);
    assert_eq!(
        spur(&pool).await.len(),
        eintraege,
        "kein Eintrag in der Spur"
    );

    let (s, verlauf) = anfrage_json(
        &app,
        "GET",
        &format!("{}/versuche", pfad(&id)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(verlauf.as_array().unwrap().len(), 1);
    assert_eq!(verlauf[0]["test"], true);
    assert_eq!(verlauf[0]["erfolg"], false);
}

#[tokio::test]
async fn entfernen_loescht_webhook_und_verlauf() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://empfaenger.example/", "arten": ["einsatz.created"] }),
    )
    .await;
    let (s, _) = anfrage_json(&app, "DELETE", &pfad(&id), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        spur(&pool).await.pop().unwrap().0,
        "maschinenzugang_webhook_entfernt"
    );
    let (s, _) = anfrage_json(
        &app,
        "GET",
        &format!("{}/versuche", pfad(&id)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage_json(&app, "DELETE", &pfad(&id), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn widerrufene_anbindung_bekommt_keinen_webhook() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/widerrufen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success());
    let (s, _) = einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://empfaenger.example/", "arten": ["einsatz.created"] }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn am_gekoppelten_elw_ist_einrichten_gesperrt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = anbindung(&app, &admin).await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let kopplung: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand) VALUES ('hub-1', 'X', 'Hub Kreis', 'meldet_sich', \
         'https://hub.example', 'aktiv') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name) \
         VALUES (?, ?, 'hub-1/1', 'Kreis')",
    )
    .bind(kopplung)
    .bind(org)
    .execute(&pool)
    .await
    .unwrap();
    let (s, v) = einrichten(
        &app,
        &admin,
        &id,
        json!({ "url": "https://empfaenger.example/", "arten": ["einsatz.created"] }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
}
