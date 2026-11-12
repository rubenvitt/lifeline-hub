//! Maschinenzugang für Fremdsysteme (LLH-1652, Spec `maschinenzugang`): Verwaltung unter
//! `/api/admin/anbindungen`, Aufräumen im Purge-Lauf. Die Anmeldung unter `/api/v1/` prüfen die
//! Tests weiter unten, sobald das v1-Gerüst steht.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage_json, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_pool};

const LISTE: &str = "/api/admin/anbindungen";

async fn anlegen(app: &axum::Router, admin: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "POST", LISTE, admin, Some(&body)).await
}

async fn letzte_aktion(pool: &sqlx::SqlitePool) -> (String, String, Option<String>) {
    sqlx::query_as("SELECT aktion, ziel, detail FROM admin_audit ORDER BY id DESC LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn anlegen_zeigt_den_code_einmal_und_schreibt_die_admin_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anlegen(
        &app,
        &admin,
        json!({ "name": " Alarm-Adapter Wache 1 ", "scopes": ["alarmmeldungen:write", "alarmmeldungen:write"] }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"].as_str().unwrap();
    assert_eq!(code.len(), 19, "Vierergruppen: {code}");
    assert_eq!(v["zugang"]["name"], "Alarm-Adapter Wache 1");
    assert_eq!(v["zugang"]["scopes"], json!(["alarmmeldungen:write"]));
    assert_eq!(v["zugang"]["zustand"], "wartet");
    assert!(v["zugang"]["fingerabdruck"].is_null());

    // Der Code steht nirgends sonst: nicht in der Liste, nicht in der Datenbank, nicht im Audit.
    let (s, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste["zugaenge"].as_array().unwrap().len(), 1);
    assert!(!liste.to_string().contains(code));
    assert!(liste["gesperrt_grund"].is_null());
    let normal = code.replace('-', "");
    let gespeichert: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM maschinenzugang_code WHERE suche = ? OR k_einloeser = ?",
    )
    .bind(&normal)
    .bind(&normal)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(gespeichert, 0, "nur Ableitungen gespeichert");

    let (aktion, ziel, detail) = letzte_aktion(&pool).await;
    assert_eq!(aktion, "maschinenzugang_angelegt");
    assert_eq!(ziel, "Alarm-Adapter Wache 1");
    let detail = detail.unwrap();
    assert!(!detail.contains(&normal) && !detail.contains(code));
    assert!(detail.contains("alarmmeldungen:write"));
}

#[tokio::test]
async fn eingabe_wird_geprueft() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    for body in [
        json!({ "name": "x", "scopes": ["alles:write"] }),
        json!({ "name": "x", "scopes": [] }),
        json!({ "name": "  ", "scopes": ["lage:read"] }),
        json!({ "name": "x".repeat(81), "scopes": ["lage:read"] }),
        json!({ "name": "x", "scopes": ["lage:read"], "gueltig_bis": "2001-01-01 00:00" }),
        json!({ "name": "x", "scopes": ["lage:read"], "gueltig_bis": "morgen" }),
    ] {
        let (s, v) = anlegen(&app, &admin, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }
    let (s, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "x", "scopes": ["lage:read"], "gueltig_bis": "2099-01-01T12:00" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["zugang"]["gueltig_bis"], "2099-01-01 12:00:00");
}

#[tokio::test]
async fn nur_der_system_admin_schreibt_und_nur_in_der_eigenen_org() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "Adapter", "scopes": ["lage:read"] }),
    )
    .await;
    let id = v["zugang"]["id"].as_str().unwrap().to_string();

    benutzer_anlegen(&app, &admin, "erika", "fuehrungskraft").await;
    let fk = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) = anlegen(&app, &fk, json!({ "name": "x", "scopes": ["lage:read"] })).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/widerrufen"), &fk, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Ein Admin einer anderen Org sieht den Zugang nicht und erreicht ihn nicht.
    let (org2, uid2) = fremde_org_anlegen(&pool, "Fremde Org", "fremd", "fremdpw12", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(uid2)
        .execute(&pool)
        .await
        .unwrap();
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let (s, liste) = anfrage_json(&app, "GET", LISTE, &fremd, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    assert_eq!(liste["zugaenge"], json!([]), "Org {org2} sieht nichts");
    for (methode, pfad, body) in [
        (
            "PATCH",
            format!("{LISTE}/{id}"),
            Some(json!({ "name": "y", "scopes": ["lage:read"] })),
        ),
        ("POST", format!("{LISTE}/{id}/code"), None),
        ("POST", format!("{LISTE}/{id}/widerrufen"), None),
    ] {
        let (s, v) = anfrage_json(&app, methode, &pfad, &fremd, body.as_ref()).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {pfad}: {v}");
    }
}

#[tokio::test]
async fn aendern_neuer_code_und_widerruf() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "Adapter", "scopes": ["lage:read"] }),
    )
    .await;
    let id = v["zugang"]["id"].as_str().unwrap().to_string();
    let erster_code = v["code"].as_str().unwrap().to_string();

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "name": "Adapter 2", "scopes": ["lage:read", "events:read"] })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["scopes"], json!(["lage:read", "events:read"]));
    let (aktion, _, detail) = letzte_aktion(&pool).await;
    assert_eq!(aktion, "maschinenzugang_geaendert");
    assert!(detail.unwrap().contains("scopes_vorher"));

    // Unverändert gespeichert: keine zweite Spur.
    let vorher: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit")
        .fetch_one(&pool)
        .await
        .unwrap();
    anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "name": "Adapter 2", "scopes": ["events:read", "lage:read"] })),
    )
    .await;
    let nachher: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(vorher, nachher);

    let (s, v) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/code"), &admin, None).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_ne!(v["code"], json!(erster_code));
    assert_eq!(
        letzte_aktion(&pool).await.0,
        "maschinenzugang_code_ausgestellt"
    );
    let offen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM maschinenzugang_code WHERE zugang_id = ? AND eingeloest_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(offen, 1, "nur der jüngste Code ist offen");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/widerrufen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zustand"], "widerrufen");
    assert!(v["widerrufen_at"].is_string());
    assert_eq!(letzte_aktion(&pool).await.0, "maschinenzugang_widerrufen");

    // Idempotent ohne zweite Spur; danach weder ändern noch neuer Code.
    let vorher: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/widerrufen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let nachher: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(vorher, nachher);
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "name": "x", "scopes": ["lage:read"] })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/code"), &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let offen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM maschinenzugang_code WHERE zugang_id = ? AND eingeloest_at IS NULL",
    )
    .bind(&id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(offen, 0, "Widerruf verwirft offene Codes");
}

/// Konzept D8: Meldet sich diese Instanz für die Org bei einem Hub, gehören Anbindungen dorthin.
#[tokio::test]
async fn am_gekoppelten_elw_ist_anlegen_gesperrt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "vorher", "scopes": ["lage:read"] }),
    )
    .await;
    let id = v["zugang"]["id"].as_str().unwrap().to_string();

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

    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    let grund = liste["gesperrt_grund"].as_str().unwrap();
    assert!(
        grund.contains("Hub Kreis") && grund.contains("https://hub.example"),
        "{grund}"
    );
    let (s, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "neu", "scopes": ["lage:read"] }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    let (s, _) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/code"), &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    // Widerrufen bleibt möglich.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/widerrufen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

/// Der Purge-Lauf räumt `jti`, verfallene Codes und alte Abrufe (Phase C).
#[tokio::test]
async fn purge_lauf_raeumt_alte_zeilen_des_maschinenzugangs() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "Adapter", "scopes": ["lage:read"] }),
    )
    .await;
    let id = v["zugang"]["id"].as_str().unwrap().to_string();
    for (jti, bis) in [
        ("alt", "2000-01-01 00:00:00"),
        ("neu", "2999-01-01 00:00:00"),
    ] {
        sqlx::query("INSERT INTO maschine_jti (zugang_id, jti, bis) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(jti)
            .bind(bis)
            .execute(&pool)
            .await
            .unwrap();
    }
    sqlx::query(
        "INSERT INTO maschine_abruf (zugang_id, route, tag, anzahl, erster_at, letzter_at) \
         VALUES (?, '/api/v1/me', '2000-01-01', 1, '2000-01-01 00:00:00', '2000-01-01 00:00:00')",
    )
    .bind(&id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE maschinenzugang_code SET laeuft_ab_at = '2000-01-01 00:00:00'")
        .execute(&pool)
        .await
        .unwrap();

    let live = lifeline_hub::live::LiveHub::new();
    lifeline_hub::einsatz::purge_scheduler::tick_einmal(&pool, &live, chrono::Utc::now()).await;

    let zaehle = |t: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {t}")))
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(zaehle("maschine_jti").await, 1);
    assert_eq!(zaehle("maschine_abruf").await, 0);
    assert_eq!(zaehle("maschinenzugang_code").await, 0);
    assert_eq!(zaehle("maschinenzugang").await, 1, "Zugänge bleiben");
}
