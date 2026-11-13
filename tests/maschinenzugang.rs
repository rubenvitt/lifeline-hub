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

// ── Anmeldung unter /api/v1/ ────────────────────────────────────────────────────────────────

use common::maschine::{angebunden, einloesen, jetzt, schluessel, senden, signiert};
use lifeline_machine_client::{prepare_redeem, Credentials};
use std::net::SocketAddr;

async fn zugang_zeile(app: &axum::Router, admin: &str, id: &str) -> Value {
    let (_, liste) = anfrage_json(app, "GET", LISTE, admin, None).await;
    liste["zugaenge"]
        .as_array()
        .unwrap()
        .iter()
        .find(|z| z["id"] == id)
        .cloned()
        .unwrap()
}

#[tokio::test]
async fn code_einloesen_und_signiert_me_abrufen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let key = schluessel(1);
    let cred = angebunden(
        &app,
        &admin,
        json!(["events:read", "lage:read"]),
        &key,
        "198.51.100.10",
    )
    .await;

    let (s, h, v) = signiert(
        &app,
        &cred,
        "GET",
        "/api/v1/me",
        jetzt(),
        "jti-1",
        "198.51.100.10",
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zugang_id"], json!(cred.zugang_id));
    assert_eq!(v["scopes"], json!(["lage:read", "events:read"]));
    assert!(v["org"]["name"].is_string());
    assert!(v["server_time_at"].as_str().unwrap().len() == 19);
    assert!(v["clock_offset_s"].as_i64().unwrap().abs() < 5);
    assert_eq!(h.get("cache-control").unwrap(), "no-store");
    // Die Antwortsignatur gilt mit dem Schlüssel aus dem Einlösen und nennt die Anfrage; geprüft
    // wird über die Rohbytes des Bodys.
    assert!(h.get("lifeline-signature").is_some());
    let auth = cred
        .sign_request("GET", "/api/v1/me", b"", jetzt(), "jti-2")
        .unwrap();
    let (s, h, roh) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", auth)),
        vec![],
        "198.51.100.10",
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let signatur = h.get("lifeline-signature").unwrap().to_str().unwrap();
    let c = cred
        .verify_response(signatur, "jti-2", 200, &roh, jetzt())
        .unwrap();
    assert_eq!(c.req, "jti-2");
    assert!(cred
        .verify_response(signatur, "jti-1", 200, &roh, jetzt())
        .is_err());

    // Zustand, Fingerabdruck, Nutzung und Spur.
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["zustand"], "aktiv");
    assert_eq!(z["fingerabdruck"], json!(cred.fingerprint().unwrap()));
    assert!(z["zuletzt_genutzt_at"].is_string());
    let (aktion, _, detail) = letzte_aktion(&pool).await;
    assert_eq!(aktion, "maschinenzugang_schluessel_gebunden");
    assert!(detail.unwrap().contains(&cred.fingerprint().unwrap()));
    let (anzahl, route): (i64, String) =
        sqlx::query_as("SELECT anzahl, route FROM maschine_abruf WHERE zugang_id = ?")
            .bind(&cred.zugang_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((anzahl, route.as_str()), (2, "/api/v1/me"));

    // Der Schlüssel ist auch öffentlich abrufbar.
    let (s, _, b) = senden(
        &app,
        "GET",
        "/api/v1/instanz/jwks.json",
        None,
        vec![],
        "198.51.100.10",
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let jwks: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(jwks["keys"][0]["x"], json!(cred.instanz_public_key));
    assert_eq!(jwks["keys"][0]["kid"], json!(cred.instanz_id));
}

#[tokio::test]
async fn code_gilt_einmal_und_ein_falscher_pruefwert_laesst_ihn_offen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "x", "scopes": ["lage:read"] }),
    )
    .await;
    let code = v["code"].as_str().unwrap().to_string();

    // Falscher Prüfwert: 401, der Code bleibt einlösbar.
    let (d, mut anfrage) = prepare_redeem(&code, &schluessel(2)).unwrap();
    let _ = d;
    anfrage.proof = "AAAA".into();
    let (s, _, b) = senden(
        &app,
        "POST",
        "/api/v1/zugang/redeem",
        None,
        serde_json::to_vec(&anfrage).unwrap(),
        "198.51.100.20",
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let fehler: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(fehler["code"], "unauthorized");

    assert_eq!(
        einloesen(&app, &code, &schluessel(2), "198.51.100.20")
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        einloesen(&app, &code, &schluessel(3), "198.51.100.20")
            .await
            .0,
        StatusCode::UNAUTHORIZED,
        "zweites Einlösen"
    );
}

#[tokio::test]
async fn abgelaufener_code_gilt_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "x", "scopes": ["lage:read"] }),
    )
    .await;
    sqlx::query("UPDATE maschinenzugang_code SET laeuft_ab_at = '2000-01-01 00:00:00'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        einloesen(
            &app,
            v["code"].as_str().unwrap(),
            &schluessel(4),
            "198.51.100.21"
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn bindung_an_body_pfad_methode_und_wiederholung() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.30";
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(5), ip).await;

    // Anderer Pfad als signiert.
    let auth = cred
        .sign_request("GET", "/api/v1/me?x=1", b"", jetzt(), "a")
        .unwrap();
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", auth)),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    // Andere Methode.
    let auth = cred
        .sign_request("POST", "/api/v1/me", b"", jetzt(), "b")
        .unwrap();
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", auth)),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    // Anderer Body.
    let auth = cred
        .sign_request("GET", "/api/v1/me", b"{}", jetzt(), "c")
        .unwrap();
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", auth)),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    // Andere Instanz (aud).
    let mut fremd = cred.clone();
    fremd.instanz_id = "andere-instanz".into();
    assert_eq!(
        signiert(&app, &fremd, "GET", "/api/v1/me", jetzt(), "d", ip)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["letzte_ablehnung"]["grund"], "ziel");

    // Wiederholung desselben JWS.
    let auth = cred
        .sign_request("GET", "/api/v1/me", b"", jetzt(), "e")
        .unwrap();
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", auth.clone())),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", auth)),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["letzte_ablehnung"]["grund"], "wiederholung");
}

#[tokio::test]
async fn falsche_uhr_401_ohne_grund_der_admin_sieht_die_abweichung() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.40";
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(6), ip).await;
    let (s, _, v) = signiert(&app, &cred, "GET", "/api/v1/me", jetzt() - 420, "u1", ip).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(v["code"], "unauthorized");
    assert!(!v.to_string().contains("Uhr"), "kein Grund nach außen: {v}");
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["letzte_ablehnung"]["grund"], "uhr");
    let abw = z["letzte_ablehnung"]["abweichung_s"].as_i64().unwrap();
    assert!((-425..=-415).contains(&abw), "{abw}");

    // Eine falsche Uhr eines bekannten Zugangs sperrt weder die Quelle noch die Anmeldung.
    for i in 0..12 {
        signiert(
            &app,
            &cred,
            "GET",
            "/api/v1/me",
            jetzt() - 420,
            &format!("u{i}x"),
            ip,
        )
        .await;
    }
    assert!(!lifeline_hub::auth::rate_limit::ist_gesperrt(
        ip.parse().unwrap()
    ));
    assert_eq!(
        signiert(&app, &cred, "GET", "/api/v1/me", jetzt(), "ok", ip)
            .await
            .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn unbekannte_zugaenge_sperren_nur_die_maschinenwege_der_quelle() {
    let (app, _pool) = setup_mit_pool().await;
    let ip = "198.51.100.50";
    let fremd = Credentials {
        zugang_id: "00000000-0000-0000-0000-000000000000".into(),
        instanz_id: "x".into(),
        base_url: "http://test".into(),
        private_key: lifeline_machine_client::b64(&[9u8; 32]),
        public_key: String::new(),
        instanz_public_key: String::new(),
    };
    for i in 0..10 {
        let (s, _, _) = signiert(
            &app,
            &fremd,
            "GET",
            "/api/v1/me",
            jetzt(),
            &format!("f{i}"),
            ip,
        )
        .await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }
    let (s, h, v) = signiert(&app, &fremd, "GET", "/api/v1/me", jetzt(), "f10", ip).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(v["code"], "rate_limited");
    assert!(h.get("retry-after").is_some());
    assert!(!lifeline_hub::auth::rate_limit::ist_gesperrt(
        ip.parse().unwrap()
    ));
}

#[tokio::test]
async fn fehlender_scope_403_widerruf_und_ablauf_401() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.60";
    let cred = angebunden(
        &app,
        &admin,
        json!(["alarmmeldungen:write"]),
        &schluessel(7),
        ip,
    )
    .await;
    assert_eq!(
        signiert(&app, &cred, "GET", "/api/v1/me", jetzt(), "s1", ip)
            .await
            .0,
        StatusCode::OK
    );

    // Ablauf: gültig bis in der Vergangenheit.
    sqlx::query("UPDATE maschinenzugang SET gueltig_bis = '2000-01-01 00:00:00' WHERE id = ?")
        .bind(&cred.zugang_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        signiert(&app, &cred, "GET", "/api/v1/me", jetzt(), "s2", ip)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["is_abgelaufen"], true);
    sqlx::query("UPDATE maschinenzugang SET gueltig_bis = NULL WHERE id = ?")
        .bind(&cred.zugang_id)
        .execute(&pool)
        .await
        .unwrap();

    // Widerruf wirkt sofort.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{}/widerrufen", cred.zugang_id),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _, v) = signiert(&app, &cred, "GET", "/api/v1/me", jetzt(), "s3", ip).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(v["code"], "unauthorized");
}

/// Der Scope einer Route wird geprüft, und eine Route ohne Scope-Angabe bleibt zu (fail closed).
#[tokio::test]
async fn scope_pruefung_und_route_ohne_angabe() {
    use axum::Extension;
    use lifeline_hub::public_api::machine::{MachineClient, ScopeAnforderung};
    use lifeline_hub::public_api::scope::Scope;
    let (_app, pool) = setup_mit_pool().await;
    let state = common::test_state(&pool, &lifeline_hub::live::LiveHub::new());
    async fn ok(client: MachineClient) -> StatusCode {
        let _ = client.zugang;
        StatusCode::NO_CONTENT
    }
    let probe = axum::Router::new()
        .route(
            "/api/v1/probe/lage",
            axum::routing::get(ok).layer(Extension(ScopeAnforderung::Scope(Scope::LageRead))),
        )
        .route("/api/v1/probe/offen", axum::routing::get(ok))
        .with_state(state.clone());
    let app = lifeline_hub::app::build_router(state);
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.70";
    let cred = angebunden(
        &app,
        &admin,
        json!(["alarmmeldungen:write"]),
        &schluessel(8),
        ip,
    )
    .await;

    let (s, _, _) = signiert(
        &probe,
        &cred,
        "GET",
        "/api/v1/probe/lage",
        jetzt(),
        "p1",
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _, _) = signiert(
        &probe,
        &cred,
        "GET",
        "/api/v1/probe/offen",
        jetzt(),
        "p2",
        ip,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::INTERNAL_SERVER_ERROR,
        "ohne Scope-Angabe nie offen"
    );
}

#[tokio::test]
async fn kein_bearer_und_keine_sitzung_unter_v1() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Die Form eines früheren Lagemonitor-Schlüssels (LLH-1484, entfernt mit LLH-1638).
    let lm = "llh_lm_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string();
    let ip = "198.51.100.80";
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", format!("Bearer {lm}"))),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("cookie", admin.clone())),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // Umgekehrt nimmt die Oberfläche keinen Maschinen-Kopf an.
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(9), ip).await;
    let auth = cred
        .sign_request("GET", "/api/einsaetze", b"", jetzt(), "m")
        .unwrap();
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/einsaetze",
        Some(("authorization", auth)),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn schluesselwechsel_ueber_einen_neuen_code() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.90";
    let alt = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(10), ip).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{}/code", alt.zugang_id),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, neu) = einloesen(&app, v["code"].as_str().unwrap(), &schluessel(11), ip).await;
    assert_eq!(s, StatusCode::OK);
    let neu = neu.unwrap();
    assert_eq!(neu.zugang_id, alt.zugang_id);
    let z = zugang_zeile(&app, &admin, &alt.zugang_id).await;
    assert_eq!(z["fingerabdruck_neu"], json!(neu.fingerprint().unwrap()));
    let (_, _, detail) = letzte_aktion(&pool).await;
    assert!(detail.unwrap().contains("fingerabdruck_vorher"));

    // Der alte gilt, bis der neue signiert; danach nicht mehr.
    assert_eq!(
        signiert(&app, &alt, "GET", "/api/v1/me", jetzt(), "w1", ip)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        signiert(&app, &neu, "GET", "/api/v1/me", jetzt(), "w2", ip)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        signiert(&app, &alt, "GET", "/api/v1/me", jetzt(), "w3", ip)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let z = zugang_zeile(&app, &admin, &alt.zugang_id).await;
    assert_eq!(z["fingerabdruck"], json!(neu.fingerprint().unwrap()));
    assert!(z["fingerabdruck_neu"].is_null());
}

#[tokio::test]
async fn drosselung_je_zugang_ohne_verbrauchte_jti() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.100";
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(12), ip).await;
    // Senden bis zur ersten 429: mindestens 60 gehen durch (der Vorrat), und unter Last füllt sich
    // höchstens einer je Sekunde nach.
    let mut ok = 0;
    let mut gedrosselt = None;
    for i in 0..200 {
        let iat = jetzt();
        let jti = format!("d{i}");
        let (s, h, v) = signiert(&app, &cred, "GET", "/api/v1/me", iat, &jti, ip).await;
        if s == StatusCode::TOO_MANY_REQUESTS {
            assert_eq!(v["code"], "rate_limited");
            let retry: u64 = h
                .get("retry-after")
                .unwrap()
                .to_str()
                .unwrap()
                .parse()
                .unwrap();
            assert!(retry >= 1);
            gedrosselt = Some((iat, jti));
            break;
        }
        assert_eq!(s, StatusCode::OK, "{i}: {v}");
        ok += 1;
    }
    assert!(ok >= 60, "{ok}");
    let (iat, jti) = gedrosselt.expect("nach dem Vorrat kommt 429");
    // Dieselbe `jti` nach der Wartezeit: nicht als Wiederholung abgewiesen.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let (s, _, _) = signiert(&app, &cred, "GET", "/api/v1/me", iat, &jti, ip).await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn gekoppelter_elw_lehnt_vorhandene_zugaenge_ab() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.110";
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(13), ip).await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let k: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand) VALUES ('hub-2', 'X', 'Hub', 'meldet_sich', \
         'https://hub.example', 'aktiv') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name) \
         VALUES (?, ?, 'hub-2/1', 'Kreis')",
    )
    .bind(k)
    .bind(org)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        signiert(&app, &cred, "GET", "/api/v1/me", jetzt(), "g1", ip)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["letzte_ablehnung"]["grund"], "instanz_gekoppelt");
}

/// Kommando und Referenz-Client gegen einen echten Server (6.3): einlösen, Schlüsseldatei
/// schreiben, `me` mit geprüfter Antwortsignatur.
#[tokio::test]
async fn kommando_loest_ein_und_ruft_me_und_lage_gegen_einen_echten_server() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "CLI", "scopes": ["lage:read"] }),
    )
    .await;
    let code = v["code"].as_str().unwrap().to_string();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = format!("http://{}", listener.local_addr().unwrap());
    let server = app.clone();
    tokio::spawn(async move {
        axum::serve(
            listener,
            server.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let client = reqwest::Client::new();
    let cred = lifeline_machine_client::redeem(&client, &adresse, &code)
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let pfad = dir.path().join("zugang.json");
    lifeline_hub::public_api::kommando::write_schluesseldatei(&pfad, &cred).unwrap();
    assert!(lifeline_hub::public_api::kommando::write_schluesseldatei(&pfad, &cred).is_err());

    let gelesen: Credentials =
        serde_json::from_str(&std::fs::read_to_string(&pfad).unwrap()).unwrap();
    let me = lifeline_machine_client::me(&client, &gelesen, jetzt())
        .await
        .unwrap();
    assert_eq!(me["zugang_id"], json!(cred.zugang_id));
    assert_eq!(me["name"], "CLI");

    // Lage (LLH-1638): ohne Freigabe `einsatz: null`; nach der Freigabe der Einsatz, die Karte
    // nur ohne `none`. Die Abfrage steht im signierten Pfad.
    let lage = lifeline_machine_client::lage(&client, &gelesen, Some("none"), jetzt())
        .await
        .unwrap();
    assert!(lage["einsatz"].is_null(), "{lage}");
    let einsatz = common::einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let (s, v) = common::anfrage(
        &app,
        "PUT",
        &format!(
            "/api/einsaetze/{einsatz}/anbindungen/{}/freigabe",
            cred.zugang_id
        ),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let lage = lifeline_machine_client::lage(&client, &gelesen, Some("none"), jetzt())
        .await
        .unwrap();
    assert_eq!(lage["einsatz"]["bezeichnung"], "Stadtfest");
    assert!(lage.get("karte").is_none());
    let lage = lifeline_machine_client::lage(&client, &gelesen, None, jetzt())
        .await
        .unwrap();
    assert_eq!(lage["karte"]["type"], "FeatureCollection");
    let etag = lage["karte_etag"].as_str().unwrap().to_string();
    let lage = lifeline_machine_client::lage(&client, &gelesen, Some(&etag), jetzt())
        .await
        .unwrap();
    assert!(lage.get("karte").is_none(), "unveränderte Karte bleibt weg");
    assert!(
        lifeline_machine_client::lage(&client, &gelesen, Some("a b"), jetzt())
            .await
            .is_err(),
        "ein Wert, der nicht in die Abfrage passt, wird nicht gesendet"
    );
}

// ── Befunde des Reviews vor dem PR ──────────────────────────────────────────────────────────

#[tokio::test]
async fn aendern_nur_gesendete_felder_mit_konfliktpruefung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "A", "scopes": ["lage:read"] }),
    )
    .await;
    let id = v["zugang"]["id"].as_str().unwrap().to_string();
    let stand = v["zugang"]["geaendert_at"].as_str().unwrap().to_string();

    // Admin B entzieht ein Recht; Admin A ändert danach mit dem alten Stand nur den Namen → 409,
    // statt das Recht still zurückzusetzen.
    let (s, b) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "scopes": ["events:read"], "basis_geaendert_at": stand })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    sqlx::query("UPDATE maschinenzugang SET geaendert_at = '2026-01-01 00:00:00' WHERE id = ?")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "name": "A neu", "basis_geaendert_at": stand })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    // Nur der Name, mit aktuellem Stand: Scopes bleiben, wie sie sind.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "name": "A neu", "basis_geaendert_at": "2026-01-01 00:00:00" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        (v["name"].as_str(), &v["scopes"]),
        (Some("A neu"), &json!(["events:read"]))
    );
}

#[tokio::test]
async fn abgelaufener_zugang_laesst_sich_umbenennen_und_verlaengern() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "alt", "scopes": ["lage:read"] }),
    )
    .await;
    let id = v["zugang"]["id"].as_str().unwrap().to_string();
    sqlx::query("UPDATE maschinenzugang SET gueltig_bis = '2000-01-01 00:00:00' WHERE id = ?")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "name": "neu" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["is_abgelaufen"], true);
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "gueltig_bis": null })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["gueltig_bis"].is_null());
    assert_eq!(v["is_abgelaufen"], false);
    // Ansicht per Deeplink.
    let (s, v) = anfrage_json(&app, "GET", &format!("{LISTE}/{id}"), &admin, None).await;
    assert_eq!((s, v["name"].as_str()), (StatusCode::OK, Some("neu")));
}

#[tokio::test]
async fn gescheiterte_einloesungen_fuellen_den_maschinenzaehler() {
    let (app, _pool) = setup_mit_pool().await;
    let ip = "198.51.100.120";
    for i in 0..10u8 {
        let (s, _) = einloesen(&app, "ZZZZ-ZZZZ-ZZZZ-ZZZZ", &schluessel(40 + i), ip).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }
    let (s, _) = einloesen(&app, "ZZZZ-ZZZZ-ZZZZ-ZZZZ", &schluessel(60), ip).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
    assert!(!lifeline_hub::auth::rate_limit::ist_gesperrt(
        ip.parse().unwrap()
    ));
}

#[tokio::test]
async fn einloesen_am_gekoppelten_elw_laesst_den_code_offen_und_nennt_den_grund() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = anlegen(
        &app,
        &admin,
        json!({ "name": "x", "scopes": ["lage:read"] }),
    )
    .await;
    let id = v["zugang"]["id"].as_str().unwrap().to_string();
    let code = v["code"].as_str().unwrap().to_string();
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let k: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand) VALUES ('hub-3', 'X', 'Hub', 'meldet_sich', \
         'https://hub.example', 'aktiv') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name) \
         VALUES (?, ?, 'hub-3/1', 'Kreis')",
    )
    .bind(k)
    .bind(org)
    .execute(&pool)
    .await
    .unwrap();
    let ip = "198.51.100.130";
    assert_eq!(
        einloesen(&app, &code, &schluessel(70), ip).await.0,
        StatusCode::UNAUTHORIZED
    );
    let z = zugang_zeile(&app, &admin, &id).await;
    assert_eq!(z["letzte_ablehnung"]["grund"], "instanz_gekoppelt");
    // Endet die Kopplung, ist der Code noch einlösbar.
    sqlx::query("UPDATE instanz_kopplung SET zustand = 'widerrufen' WHERE id = ?")
        .bind(k)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        einloesen(&app, &code, &schluessel(70), ip).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn zu_lange_jti_und_falscher_typ_eines_bekannten_zugangs() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.140";
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(71), ip).await;
    let lang = "x".repeat(65);
    assert_eq!(
        signiert(&app, &cred, "GET", "/api/v1/me", jetzt(), &lang, ip)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["letzte_ablehnung"]["grund"], "form");

    // Kopf mit fremdem `typ`, aber bekanntem `kid`.
    let auth = cred
        .sign_request("GET", "/api/v1/me", b"", jetzt(), "t1")
        .unwrap();
    let jws = auth.strip_prefix("Machine ").unwrap();
    let rest = &jws[jws.find('.').unwrap()..];
    let kopf = lifeline_machine_client::b64(
        format!(
            r#"{{"alg":"EdDSA","typ":"lifeline-instanz+jwt","kid":"{}"}}"#,
            cred.zugang_id
        )
        .as_bytes(),
    );
    sqlx::query("UPDATE maschinenzugang SET letzte_ablehnung_grund = NULL WHERE id = ?")
        .bind(&cred.zugang_id)
        .execute(&_pool)
        .await
        .unwrap();
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/v1/me",
        Some(("authorization", format!("Machine {kopf}{rest}"))),
        vec![],
        ip,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let z = zugang_zeile(&app, &admin, &cred.zugang_id).await;
    assert_eq!(z["letzte_ablehnung"]["grund"], "form");
}

/// design.md D8: Jede Route mit Sicherheitsschema `machine` im v1-Dokument trägt eine
/// Scope-Angabe; ohne sie endete ein gültig signierter Aufruf mit 500.
#[tokio::test]
async fn jede_route_mit_maschinenanmeldung_traegt_eine_scope_angabe() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = "198.51.100.150";
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(72), ip).await;
    let dok = serde_json::to_value(lifeline_hub::public_api::openapi()).unwrap();
    let mut geprueft = 0;
    for (pfad, ops) in dok["paths"].as_object().unwrap() {
        for (methode, op) in ops.as_object().unwrap() {
            let maschine = op["security"]
                .as_array()
                .is_some_and(|l| l.iter().any(|s| s.get("machine").is_some()));
            if !maschine {
                continue;
            }
            let konkret = pfad.replace('{', "").replace('}', "");
            let m = methode.to_uppercase();
            let (s, _, v) = signiert(
                &app,
                &cred,
                &m,
                &konkret,
                jetzt(),
                &format!("g{geprueft}"),
                ip,
            )
            .await;
            assert_ne!(s, StatusCode::INTERNAL_SERVER_ERROR, "{m} {pfad}: {v}");
            geprueft += 1;
        }
    }
    assert!(geprueft >= 1, "mindestens GET /api/v1/me");
}
