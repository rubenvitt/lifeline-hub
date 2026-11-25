//! Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, ADR-0098):
//! Helfer-Einladung, Anmeldung und Bestätigung durch die Leitung.

use axum::http::StatusCode;
use lifeline_hub::error::AppError;
use lifeline_hub::helfer::einladung::einladung_einloesen;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
};

// ---------- Helfer ----------

/// Schaltet „Ortung im Einsatz“ der Organisation ein (Org-Admin).
async fn ortung_einschalten(app: &axum::Router, admin: &str) {
    let (s, v) = anfrage_json(
        app,
        "PUT",
        "/api/org-settings",
        admin,
        Some(&json!({"ortung_im_einsatz": true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn einladen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/helpers/invitations"),
        cookie,
        Some(&body),
    )
    .await
}

async fn einloesen(pool: &sqlx::SqlitePool, code: &str) -> Result<(i64, i64, i64), AppError> {
    let mut conn = pool.acquire().await.unwrap();
    einladung_einloesen(&mut conn, code).await
}

// ---------- Einladung ----------

#[tokio::test]
async fn leitung_legt_helfer_einladung_an_und_neue_ersetzt_alte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, erste) = einladen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{erste}");
    let code1 = erste["code"].as_str().unwrap().to_string();
    assert_eq!(code1.len(), 8, "{erste}");
    assert!(erste["id"].is_i64(), "{erste}");
    assert!(erste["expires_at"].is_string(), "{erste}");
    // Vorgabe 4 h.
    let ab = chrono::NaiveDateTime::parse_from_str(
        erste["expires_at"].as_str().unwrap(),
        "%Y-%m-%d %H:%M:%S",
    )
    .unwrap();
    let minuten = (ab - chrono::Utc::now().naive_utc()).num_minutes();
    assert!((238..=240).contains(&minuten), "Vorgabe 240 min: {minuten}");

    // Mehrfach einlösbar, zählt hoch.
    let (eid, e_einsatz, org) = einloesen(&pool, &code1).await.expect("erste Einlösung");
    assert_eq!(eid, erste["id"].as_i64().unwrap());
    assert_eq!(e_einsatz, einsatz);
    assert_eq!(org, 1);
    einloesen(&pool, &code1).await.expect("zweite Einlösung");
    let n: i64 = sqlx::query_scalar("SELECT einloesungen FROM helfer_einladung WHERE id = ?")
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 2);

    // Übersicht zeigt die gültige Einladung ohne Code.
    let (s, uebersicht) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/helpers"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{uebersicht}");
    assert_eq!(uebersicht["invitation"]["id"], erste["id"], "{uebersicht}");
    assert!(
        !uebersicht["invitation"]
            .as_object()
            .unwrap()
            .contains_key("code"),
        "kein Code in der Übersicht: {uebersicht}"
    );
    assert_eq!(uebersicht["helpers"], json!([]));

    // Eine neue ersetzt die alte.
    let (s, zweite) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 60})).await;
    assert_eq!(s, StatusCode::CREATED, "{zweite}");
    let code2 = zweite["code"].as_str().unwrap().to_string();
    assert_ne!(code1, code2);
    assert!(
        matches!(einloesen(&pool, &code1).await, Err(AppError::Unauthorized)),
        "alte Einladung ist ersetzt"
    );
    einloesen(&pool, &code2).await.expect("neue Einladung gilt");

    // Widerruf: 204, danach 401 beim Einlösen und keine Einladung in der Übersicht.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!(
            "/api/incidents/{einsatz}/helpers/invitations/{}/revoke",
            zweite["id"]
        ),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(matches!(
        einloesen(&pool, &code2).await,
        Err(AppError::Unauthorized)
    ));
    let (_, uebersicht) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/helpers"),
        &admin,
        None,
    )
    .await;
    assert!(
        !uebersicht.as_object().unwrap().contains_key("invitation"),
        "{uebersicht}"
    );

    // Ein falscher Code ist 401.
    assert!(matches!(
        einloesen(&pool, "ZZZZZZZZ").await,
        Err(AppError::Unauthorized)
    ));
}

#[tokio::test]
async fn einladung_endet_mit_dem_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = einladen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        einloesen(&pool, v["code"].as_str().unwrap()).await,
        Err(AppError::Unauthorized)
    ));
}

#[tokio::test]
async fn ohne_ortung_der_org_keine_einladung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = einladen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM helfer_einladung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn fuehrungspersonal_darf_keine_einladung_anlegen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fp = benutzer_anlegen(&app, &admin, "fuehrung", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let fp = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (s, _) = einladen(&app, &fp, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/helpers"),
        &fp,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM helfer_einladung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn einladung_gilt_hoechstens_72_stunden() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, v) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 10000})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let (s, v) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 0})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM helfer_einladung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let (s, v) = einladen(&app, &admin, einsatz, json!({"valid_minutes": 4320})).await;
    assert_eq!(s, StatusCode::CREATED, "72 h genau: {v}");
}

#[tokio::test]
async fn fremde_einladung_ist_404_beim_widerruf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let (_, v) = einladen(&app, &admin, a, json!({})).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{b}/helpers/invitations/{}/revoke", v["id"]),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ---------- Einlösen ----------

struct Antwort {
    status: StatusCode,
    cookie: Option<String>,
    body: Value,
}

/// Anfrage an einen öffentlichen Helfer-Weg, optional mit einem Cookie.
async fn oeffentlich(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> Antwort {
    use axum::body::{to_bytes, Body};
    use axum::http::{header, Request};
    use tower::ServiceExt;
    let mut req = Request::builder().method(methode).uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string());
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    Antwort {
        status,
        cookie,
        body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
}

async fn redeem(app: &axum::Router, cookie: Option<&str>, body: Value) -> Antwort {
    oeffentlich(
        app,
        "POST",
        "/api/devices/helpers/redeem",
        cookie,
        Some(body),
    )
    .await
}

/// Ein Einsatz mit Ortung, einer Einheit, einem Fahrzeug und einer Einladung.
struct Lage {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: lifeline_hub::live::LiveHub,
    admin: String,
    einsatz: i64,
    einheit: i64,
    fahrzeug: i64,
    code: String,
}

async fn lage() -> Lage {
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    ortung_einschalten(&app, &admin).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let einheit = common::einheit_bilden(&app, &admin, einsatz, "San-Trupp 2").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/vehicles"),
        &admin,
        Some(&json!({"adhoc": {"funkrufname": "Rotkreuz 10/83-1", "fahrzeugtyp": "RTW"}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let fahrzeug = v["id"].as_i64().unwrap();
    let (s, v) = einladen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"].as_str().unwrap().to_string();
    Lage {
        app,
        pool,
        live,
        admin,
        einsatz,
        einheit,
        fahrzeug,
        code,
    }
}

fn anmeldung(code: &str, kind: &str, id: i64) -> Value {
    json!({
        "code": code,
        "display_name": "Max M., San-Trupp 2",
        "target": {"kind": kind, "id": id},
        "track_person": true,
    })
}

async fn helfer_kopplungen(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM geraet_kopplung WHERE ansicht = 'helfer'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn helfer_loest_einladung_ein_und_ist_unbestaetigt() {
    let l = lage().await;

    // Die Zielliste vor dem Einlösen: Einheiten und Fahrzeuge, keine Personen.
    let a = oeffentlich(
        &l.app,
        "GET",
        &format!("/api/devices/helpers/targets?code={}", l.code),
        None,
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::OK, "{}", a.body);
    let ziele = a.body["targets"].as_array().unwrap();
    assert!(
        ziele
            .iter()
            .any(|z| z["kind"] == "unit" && z["id"] == l.einheit && z["name"] == "San-Trupp 2"),
        "{}",
        a.body
    );
    assert!(
        ziele.iter().any(|z| z["kind"] == "vehicle"
            && z["id"] == l.fahrzeug
            && z["name"] == "Rotkreuz 10/83-1"),
        "{}",
        a.body
    );
    assert_eq!(a.body["person_tracking_allowed"], false, "{}", a.body);
    assert!(a.body.get("persons").is_none());
    // Die Zielliste zählt keine Einlösung.
    let n: i64 = sqlx::query_scalar("SELECT einloesungen FROM helfer_einladung")
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);

    let a = redeem(&l.app, None, anmeldung(&l.code, "unit", l.einheit)).await;
    assert_eq!(a.status, StatusCode::CREATED, "{}", a.body);
    let cookie = a.cookie.expect("Set-Cookie");
    assert_eq!(a.body["state"], "unbestaetigt", "{}", a.body);
    assert!(a.body.get("reason").is_none(), "{}", a.body);
    assert_eq!(a.body["incident"]["id"], l.einsatz, "{}", a.body);
    assert!(a.body["incident"]["name"].is_string(), "{}", a.body);
    assert_eq!(a.body["target"]["kind"], "unit");
    assert_eq!(a.body["target"]["id"], l.einheit);
    assert_eq!(a.body["target"]["name"], "San-Trupp 2");
    assert_eq!(a.body["is_tracker"], false);
    assert_eq!(a.body["paused"], false);
    assert!(a.body["server_time"].is_string(), "{}", a.body);

    // Ablauf 2 h; „Auch Personen orten“ ist aus, also wird track_person still false.
    let (ansicht, zustand, minuten, gewuenscht, einladung): (String, String, i64, bool, i64) =
        sqlx::query_as(
            "SELECT ansicht, helfer_zustand, \
                    CAST((julianday(laeuft_ab_at) - julianday('now')) * 1440 AS INTEGER), \
                    person_gewuenscht <> 0, einladung_id FROM geraet_kopplung",
        )
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!(ansicht, "helfer");
    assert_eq!(zustand, "unbestaetigt");
    assert!((118..=120).contains(&minuten), "2 h: {minuten}");
    assert!(!gewuenscht);
    assert!(einladung > 0);

    // Der eigene Zustand mit dem Cookie der Kopplung.
    let (s, v) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["state"], "unbestaetigt");
    assert_eq!(v["target"]["id"], l.einheit);

    // Die Leitung sieht den wartenden Helfer.
    let (_, v) = anfrage(
        &l.app,
        "GET",
        &format!("/api/incidents/{}/helpers", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(v["helpers"][0]["state"], "unbestaetigt", "{v}");
    assert_eq!(v["helpers"][0]["display_name"], "Max M., San-Trupp 2");
    // In der Geräteliste der Einsatzleitung steht der Helfer nicht ein zweites Mal.
    let (_, v) = anfrage(
        &l.app,
        "GET",
        &format!("/api/einsaetze/{}/devices", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(v["kopplungen"], json!([]), "{v}");
    assert!(
        !v["ansichten"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["ansicht"] == "helfer"),
        "{v}"
    );
}

#[tokio::test]
async fn mit_personenortung_bleibt_der_wunsch_stehen() {
    let l = lage().await;
    let (s, v) = anfrage_json(
        &l.app,
        "PUT",
        "/api/org-settings",
        &l.admin,
        Some(&json!({"ortung_im_einsatz": true, "ortung_personen": true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let a = oeffentlich(
        &l.app,
        "GET",
        &format!("/api/devices/helpers/targets?code={}", l.code),
        None,
        None,
    )
    .await;
    assert_eq!(a.body["person_tracking_allowed"], true, "{}", a.body);
    let a = redeem(&l.app, None, anmeldung(&l.code, "vehicle", l.fahrzeug)).await;
    assert_eq!(a.status, StatusCode::CREATED, "{}", a.body);
    let gewuenscht: bool = sqlx::query_scalar("SELECT person_gewuenscht <> 0 FROM geraet_kopplung")
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert!(gewuenscht);
}

#[tokio::test]
async fn zwei_geraete_loesen_dieselbe_einladung_ein() {
    let l = lage().await;
    let a = redeem(&l.app, None, anmeldung(&l.code, "unit", l.einheit)).await;
    assert_eq!(a.status, StatusCode::CREATED, "{}", a.body);
    let b = redeem(&l.app, None, anmeldung(&l.code, "vehicle", l.fahrzeug)).await;
    assert_eq!(b.status, StatusCode::CREATED, "{}", b.body);
    assert_ne!(a.cookie, b.cookie);
    let zustaende: Vec<String> = sqlx::query_scalar(
        "SELECT helfer_zustand FROM geraet_kopplung WHERE ansicht = 'helfer' ORDER BY id",
    )
    .fetch_all(&l.pool)
    .await
    .unwrap();
    assert_eq!(zustaende, ["unbestaetigt", "unbestaetigt"]);
    // Zwei Gerätekonten, je eines je Kopplung.
    let konten: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT benutzer_id) FROM geraet_kopplung WHERE ansicht = 'helfer'",
    )
    .fetch_one(&l.pool)
    .await
    .unwrap();
    assert_eq!(konten, 2);
    // Die Sitzung des ersten Geräts gilt weiter.
    let (s, _) = anfrage(&l.app, "GET", "/api/devices/me", &a.cookie.unwrap(), None).await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn personensitzung_kann_nicht_einloesen() {
    let l = lage().await;
    let a = redeem(
        &l.app,
        Some(&l.admin),
        anmeldung(&l.code, "unit", l.einheit),
    )
    .await;
    assert_eq!(a.status, StatusCode::CONFLICT, "{}", a.body);
    assert_eq!(a.body["reason"], "person_session", "{}", a.body);
    assert!(a.cookie.is_none());
    assert_eq!(helfer_kopplungen(&l.pool).await, 0);
    // Die Personensitzung bleibt bestehen.
    let (s, _) = anfrage(&l.app, "GET", "/api/auth/me", &l.admin, None).await;
    assert_eq!(s, StatusCode::OK);

    // Die Sitzung eines anderen Helfers ersetzt das Einlösen dagegen ohne Rückfrage.
    let erster = redeem(&l.app, None, anmeldung(&l.code, "unit", l.einheit)).await;
    let zweiter = redeem(
        &l.app,
        erster.cookie.as_deref(),
        anmeldung(&l.code, "unit", l.einheit),
    )
    .await;
    assert_eq!(zweiter.status, StatusCode::CREATED, "{}", zweiter.body);
    assert_eq!(helfer_kopplungen(&l.pool).await, 2);
}

#[tokio::test]
async fn ziel_aus_fremdem_einsatz_ist_422() {
    let l = lage().await;
    let anderer = einsatz_anlegen(&l.app, &l.admin).await;
    let fremde_einheit = common::einheit_bilden(&l.app, &l.admin, anderer, "Fremd").await;

    let a = redeem(&l.app, None, anmeldung(&l.code, "unit", fremde_einheit)).await;
    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.body);
    let a = redeem(&l.app, None, anmeldung(&l.code, "vehicle", l.einheit + 999)).await;
    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.body);
    let mut ohne_ziel = anmeldung(&l.code, "unit", l.einheit);
    ohne_ziel.as_object_mut().unwrap().remove("target");
    let a = redeem(&l.app, None, ohne_ziel).await;
    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.body);
    let mut leer = anmeldung(&l.code, "unit", l.einheit);
    leer["display_name"] = json!("   ");
    let a = redeem(&l.app, None, leer).await;
    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.body);
    let mut lang = anmeldung(&l.code, "unit", l.einheit);
    lang["display_name"] = json!("x".repeat(61));
    let a = redeem(&l.app, None, lang).await;
    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.body);

    assert_eq!(helfer_kopplungen(&l.pool).await, 0);
    let n: i64 = sqlx::query_scalar("SELECT einloesungen FROM helfer_einladung")
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "ein abgewiesenes Einlösen zählt nicht");
}

#[tokio::test]
async fn falscher_code_ist_401_auch_fuer_die_zielliste() {
    let l = lage().await;
    let a = redeem(&l.app, None, anmeldung("ZZZZZZZZ", "unit", l.einheit)).await;
    assert_eq!(a.status, StatusCode::UNAUTHORIZED, "{}", a.body);
    let a = oeffentlich(
        &l.app,
        "GET",
        "/api/devices/helpers/targets?code=ZZZZZZZZ",
        None,
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::UNAUTHORIZED, "{}", a.body);
    assert_eq!(helfer_kopplungen(&l.pool).await, 0);
}

#[tokio::test]
async fn helfer_darf_keine_lage_lesen() {
    let l = lage().await;
    let a = redeem(&l.app, None, anmeldung(&l.code, "unit", l.einheit)).await;
    let cookie = a.cookie.unwrap();
    for pfad in [
        format!("/api/einsaetze/{}/units", l.einsatz),
        format!("/api/einsaetze/{}/vehicles", l.einsatz),
        format!("/api/einsaetze/{}/persons", l.einsatz),
        format!("/api/einsaetze/{}", l.einsatz),
        format!("/api/incidents/{}/helpers", l.einsatz),
        "/api/organization".to_string(),
    ] {
        let (s, v) = anfrage(&l.app, "GET", &pfad, &cookie, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{pfad}: {v}");
    }
    // Der eigene Anmeldestatus bleibt erreichbar.
    let (s, v) = anfrage(&l.app, "GET", "/api/auth/me", &cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["geraet"]["ansicht"], "helfer", "{v}");
}

#[tokio::test]
async fn unbestaetigte_kopplung_laeuft_nach_zwei_stunden_ab() {
    let l = lage().await;
    let a = redeem(&l.app, None, anmeldung(&l.code, "unit", l.einheit)).await;
    let cookie = a.cookie.unwrap();
    let (s, _) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    sqlx::query("UPDATE geraet_kopplung SET laeuft_ab_at = datetime('now', '-1 minute')")
        .execute(&l.pool)
        .await
        .unwrap();
    let (s, _) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn ziel_aendern_nur_unbestaetigt() {
    let l = lage().await;
    let a = redeem(&l.app, None, anmeldung(&l.code, "unit", l.einheit)).await;
    let cookie = a.cookie.unwrap();

    let (s, v) = anfrage_json(
        &l.app,
        "PUT",
        "/api/devices/me",
        &cookie,
        Some(&json!({"target": {"kind": "vehicle", "id": l.fahrzeug}})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["target"]["kind"], "vehicle", "{v}");
    assert_eq!(v["target"]["id"], l.fahrzeug, "{v}");
    let (einheit, fahrzeug): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT einheit_id, fahrzeug_id FROM geraet_kopplung")
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert_eq!((einheit, fahrzeug), (None, Some(l.fahrzeug)));

    // Ein fremdes Ziel ist 422.
    let anderer = einsatz_anlegen(&l.app, &l.admin).await;
    let fremd = common::einheit_bilden(&l.app, &l.admin, anderer, "Fremd").await;
    let (s, v) = anfrage_json(
        &l.app,
        "PUT",
        "/api/devices/me",
        &cookie,
        Some(&json!({"target": {"kind": "unit", "id": fremd}})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    // Nach der Bestätigung setzt nur die Leitung ein neues Ziel.
    sqlx::query("UPDATE geraet_kopplung SET helfer_zustand = 'aktiv'")
        .execute(&l.pool)
        .await
        .unwrap();
    let (s, v) = anfrage_json(
        &l.app,
        "PUT",
        "/api/devices/me",
        &cookie,
        Some(&json!({"target": {"kind": "unit", "id": l.einheit}})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    let fahrzeug: Option<i64> = sqlx::query_scalar("SELECT fahrzeug_id FROM geraet_kopplung")
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!(fahrzeug, Some(l.fahrzeug));
    let (s, v) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["state"], "aktiv");
}

// ---------- Bestätigen, Ablehnen, Entfernen (Leitung) ----------

/// Meldet einen Helfer an; liefert Kennung der Kopplung und Cookie des Geräts.
async fn anmelden(l: &Lage, kind: &str, id: i64, name: &str) -> (i64, String) {
    let mut body = anmeldung(&l.code, kind, id);
    body["display_name"] = json!(name);
    let a = redeem(&l.app, None, body).await;
    assert_eq!(a.status, StatusCode::CREATED, "{}", a.body);
    let gid: i64 = sqlx::query_scalar(
        "SELECT id FROM geraet_kopplung WHERE ansicht = 'helfer' ORDER BY id DESC LIMIT 1",
    )
    .fetch_one(&l.pool)
    .await
    .unwrap();
    (gid, a.cookie.unwrap())
}

async fn leitung(l: &Lage, pfad: &str, body: Option<Value>) -> (StatusCode, Value) {
    anfrage_json(
        &l.app,
        "POST",
        &format!("/api/incidents/{}/helpers{pfad}", l.einsatz),
        &l.admin,
        body.as_ref(),
    )
    .await
}

async fn bestaetigen(l: &Lage, gid: i64, body: Value) -> (StatusCode, Value) {
    leitung(l, &format!("/{gid}/confirm"), Some(body)).await
}

async fn ist_ortungsgeraet(pool: &sqlx::SqlitePool, gid: i64) -> bool {
    sqlx::query_scalar("SELECT ortungsgeraet <> 0 FROM geraet_kopplung WHERE id = ?")
        .bind(gid)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn personenortung_einschalten(l: &Lage) {
    let (s, v) = anfrage_json(
        &l.app,
        "PUT",
        "/api/org-settings",
        &l.admin,
        Some(&json!({"ortung_im_einsatz": true, "ortung_personen": true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

#[tokio::test]
async fn bestaetigung_macht_aktiv_und_schreibt_etb() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;

    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["id"], gid, "{v}");
    assert_eq!(v["state"], "aktiv", "{v}");
    assert_eq!(v["is_tracker"], true, "{v}");
    assert_eq!(v["target"]["id"], l.einheit, "{v}");

    // 72 h ab der Bestätigung, die Sitzung des Geräts endet mit.
    let (minuten, sitzung_gleich, bestaetigt): (i64, bool, bool) = sqlx::query_as(
        "SELECT CAST((julianday(gk.laeuft_ab_at) - julianday('now')) * 1440 AS INTEGER), \
                (SELECT s.expires_at FROM session s WHERE s.kopplung_id = gk.id) = gk.laeuft_ab_at, \
                gk.bestaetigt_at IS NOT NULL AND gk.bestaetigt_von IS NOT NULL \
         FROM geraet_kopplung gk WHERE gk.id = ?",
    )
    .bind(gid)
    .fetch_one(&l.pool)
    .await
    .unwrap();
    assert!(
        (72 * 60 - 2..=72 * 60).contains(&minuten),
        "72 h: {minuten}"
    );
    assert!(sitzung_gleich, "Sitzung endet mit der Kopplung");
    assert!(bestaetigt);
    let spur: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM geraet_kopplung_ereignis WHERE kopplung_id = ? AND ereignis = 'bestaetigt'",
    )
    .bind(gid)
    .fetch_one(&l.pool)
    .await
    .unwrap();
    assert_eq!(spur, 1);

    let etb = common::system_etb_inhalte(&l.app, &l.admin, l.einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.starts_with("Helfer „Max M.“ für San-Trupp 2 bestätigt von ")),
        "{etb:?}"
    );

    // Das Gerät sieht den neuen Zustand.
    let (s, v) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["state"], "aktiv", "{v}");
    assert_eq!(v["is_tracker"], true, "{v}");

    // Ein fremder Helfer ist 404.
    let (s, _) = bestaetigen(&l, gid + 100, json!({"is_tracker": false})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn zweites_ortungsgeraet_fuer_dieselbe_einheit_ist_409() {
    let l = lage().await;
    let (a, _) = anmelden(&l, "unit", l.einheit, "A").await;
    let (b, _) = anmelden(&l, "unit", l.einheit, "B").await;
    let (s, v) = bestaetigen(&l, a, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let (s, v) = bestaetigen(&l, b, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["reason"], "tracker_taken", "{v}");
    assert_eq!(v["holder"], a, "{v}");
    let zustand: String =
        sqlx::query_scalar("SELECT helfer_zustand FROM geraet_kopplung WHERE id = ?")
            .bind(b)
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert_eq!(zustand, "unbestaetigt", "nichts geschrieben");

    // Ohne Ortungsrolle geht es.
    let (s, v) = bestaetigen(&l, b, json!({"is_tracker": false})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["is_tracker"], false, "{v}");
    assert!(ist_ortungsgeraet(&l.pool, a).await);

    // Ein abgelaufenes Ortungsgerät hält die Rolle nicht fest.
    sqlx::query(
        "UPDATE geraet_kopplung SET laeuft_ab_at = datetime('now', '-1 minute') WHERE id = ?",
    )
    .bind(a)
    .execute(&l.pool)
    .await
    .unwrap();
    let (s, v) = bestaetigen(&l, b, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["is_tracker"], true, "{v}");
}

#[tokio::test]
async fn zwei_parallele_bestaetigungen_ergeben_ein_ortungsgeraet() {
    let l = lage().await;
    let (a, _) = anmelden(&l, "vehicle", l.fahrzeug, "A").await;
    let (b, _) = anmelden(&l, "vehicle", l.fahrzeug, "B").await;
    let ((sa, va), (sb, vb)) = tokio::join!(
        bestaetigen(&l, a, json!({"is_tracker": true})),
        bestaetigen(&l, b, json!({"is_tracker": true})),
    );
    let mut status = [sa, sb];
    status.sort();
    assert_eq!(
        status,
        [StatusCode::OK, StatusCode::CONFLICT],
        "{va} / {vb}"
    );
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM geraet_kopplung WHERE ansicht = 'helfer' AND ortungsgeraet = 1",
    )
    .fetch_one(&l.pool)
    .await
    .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn ersetzen_uebertraegt_die_ortungsrolle() {
    let l = lage().await;
    let (a, _) = anmelden(&l, "unit", l.einheit, "A").await;
    let (b, _) = anmelden(&l, "unit", l.einheit, "B").await;
    let (s, _) = bestaetigen(&l, a, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = bestaetigen(&l, b, json!({"is_tracker": true, "replace": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["is_tracker"], true, "{v}");
    assert!(!ist_ortungsgeraet(&l.pool, a).await, "A verliert die Rolle");
    let etb = common::system_etb_inhalte(&l.app, &l.admin, l.einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Helfer „B“") && t.contains("„A“")),
        "{etb:?}"
    );

    // Derselbe Weg rückt die Rolle bei einem schon aktiven Helfer nach; das Ende bleibt.
    let ende_vorher: String =
        sqlx::query_scalar("SELECT laeuft_ab_at FROM geraet_kopplung WHERE id = ?")
            .bind(a)
            .fetch_one(&l.pool)
            .await
            .unwrap();
    let (s, v) = bestaetigen(&l, a, json!({"is_tracker": true, "replace": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_ortungsgeraet(&l.pool, a).await);
    assert!(!ist_ortungsgeraet(&l.pool, b).await);
    assert_eq!(v["expires_at"], ende_vorher, "{v}");
}

#[tokio::test]
async fn ablehnen_beendet_die_sitzung() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let mut ende = l.live.abonniere_kopplung_ende();

    let (s, v) = leitung(&l, &format!("/{gid}/reject"), None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["state"], "abgelehnt", "{v}");
    assert_eq!(ende.try_recv().unwrap(), gid, "Live: Kopplung endet");
    let (s, _) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let etb = common::system_etb_inhalte(&l.app, &l.admin, l.einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.starts_with("Helfer „Max M.“ abgelehnt von ")),
        "{etb:?}"
    );

    // Abgelehnt ist abgelehnt: kein zweites Ablehnen, kein Bestätigen.
    let (s, _) = leitung(&l, &format!("/{gid}/reject"), None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = bestaetigen(&l, gid, json!({"is_tracker": false})).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn entfernen_loescht_personenposition() {
    let l = lage().await;
    personenortung_einschalten(&l).await;
    let person = common::stammpersonal_disponieren(&l.app, &l.admin, l.einsatz, "Erika M.").await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Erika").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": true, "person_id": person})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["person"]["id"], person, "{v}");
    for (tabelle, id) in [("einsatz_personal", person), ("einsatz_einheit", l.einheit)] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {tabelle} SET lat = 50.1, lon = 8.6, position_quelle = 'helfer', \
             position_aktualisiert_at = datetime('now') WHERE id = ?"
        )))
        .bind(id)
        .execute(&l.pool)
        .await
        .unwrap();
    }

    let (s, v) = leitung(&l, &format!("/{gid}/revoke"), None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["state"], "beendet", "{v}");
    let (lat, quelle): (Option<f64>, Option<String>) =
        sqlx::query_as("SELECT lat, position_quelle FROM einsatz_personal WHERE id = ?")
            .bind(person)
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert_eq!(lat, None, "Person nicht mehr auf der Karte");
    assert_eq!(
        quelle.as_deref(),
        Some("helfer"),
        "Quelle bleibt als Hinweis"
    );
    let einheit_lat: Option<f64> =
        sqlx::query_scalar("SELECT lat FROM einsatz_einheit WHERE id = ?")
            .bind(l.einheit)
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert_eq!(
        einheit_lat,
        Some(50.1),
        "Einheit behält den letzten Lagestand"
    );
    let (s, _) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let etb = common::system_etb_inhalte(&l.app, &l.admin, l.einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.starts_with("Helfer „Erika“ abgemeldet von ")),
        "{etb:?}"
    );
}

#[tokio::test]
async fn alle_abmelden_beendet_alle_helfer() {
    let l = lage().await;
    let (a, ca) = anmelden(&l, "unit", l.einheit, "A").await;
    let (_b, cb) = anmelden(&l, "vehicle", l.fahrzeug, "B").await;
    let (s, _) = bestaetigen(&l, a, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = leitung(&l, "/revoke", None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let zustaende: Vec<&str> = v["helpers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["state"].as_str().unwrap())
        .collect();
    assert_eq!(zustaende, ["beendet", "beendet"], "{v}");
    for c in [ca, cb] {
        let (s, _) = anfrage(&l.app, "GET", "/api/devices/me", &c, None).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }
    let etb = common::system_etb_inhalte(&l.app, &l.admin, l.einsatz).await;
    assert_eq!(
        etb.iter()
            .filter(|t| t.starts_with("2 Helfer abgemeldet von "))
            .count(),
        1,
        "{etb:?}"
    );
}

#[tokio::test]
async fn person_nur_mit_personenortung_der_org() {
    let l = lage().await;
    let person = common::stammpersonal_disponieren(&l.app, &l.admin, l.einsatz, "Erika M.").await;
    let (gid, _) = anmelden(&l, "unit", l.einheit, "Erika").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": false, "person_id": person})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    personenortung_einschalten(&l).await;
    let anderer = einsatz_anlegen(&l.app, &l.admin).await;
    let fremd = common::stammpersonal_disponieren(&l.app, &l.admin, anderer, "Fremd").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": false, "person_id": fremd})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": false, "person_id": person})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["person"]["id"], person, "{v}");
}

#[tokio::test]
async fn leitung_verlaengert_einen_helfer() {
    let l = lage().await;
    let (gid, _) = anmelden(&l, "unit", l.einheit, "A").await;
    let ende = lifeline_hub::zeit::formatiere_utc(chrono::Utc::now() + chrono::Duration::hours(10));
    // Unbestätigt: erst bestätigen.
    let (s, _) = leitung(
        &l,
        &format!("/{gid}/extend"),
        Some(json!({"laeuft_ab_at": ende})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = bestaetigen(&l, gid, json!({"is_tracker": false})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = leitung(
        &l,
        &format!("/{gid}/extend"),
        Some(json!({"laeuft_ab_at": ende})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["expires_at"], ende, "{v}");
}

/// 30 Minuten vor dem Ablauf einer bestätigten Helfer-Kopplung schreibt der Takt einen Hinweis
/// ins ETB, genau einmal; unbestätigte und beendete melden nichts.
#[tokio::test]
async fn bestaetigter_helfer_warnt_30_minuten_vor_ablauf() {
    use lifeline_hub::geraet::ablauf::AblaufFenster;
    let l = lage().await;
    let (a, _) = anmelden(&l, "unit", l.einheit, "A").await;
    let (_b, _) = anmelden(&l, "vehicle", l.fahrzeug, "B").await;
    let (s, _) = bestaetigen(&l, a, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK);
    let jetzt = chrono::Utc::now();
    let ende = lifeline_hub::zeit::formatiere_utc(jetzt + chrono::Duration::minutes(30));
    sqlx::query("UPDATE geraet_kopplung SET laeuft_ab_at = ? WHERE ansicht = 'helfer'")
        .bind(&ende)
        .execute(&l.pool)
        .await
        .unwrap();
    let vorher = common::system_etb_inhalte(&l.app, &l.admin, l.einsatz)
        .await
        .len();

    let takt = chrono::Duration::seconds(30);
    let mut fenster = AblaufFenster::ab(jetzt - takt * 2);
    fenster.takt(&l.pool, &l.live, jetzt - takt).await.unwrap();
    assert_eq!(
        common::system_etb_inhalte(&l.app, &l.admin, l.einsatz)
            .await
            .len(),
        vorher,
        "vor der Warnzeit"
    );
    fenster.takt(&l.pool, &l.live, jetzt).await.unwrap();
    fenster.takt(&l.pool, &l.live, jetzt + takt).await.unwrap();
    let etb = common::system_etb_inhalte(&l.app, &l.admin, l.einsatz).await;
    assert_eq!(etb.len(), vorher + 1, "{etb:?}");
    assert!(
        etb.iter().any(|t| t.contains("„A“") && t.contains("endet")),
        "{etb:?}"
    );
    assert!(
        !etb.iter().any(|t| t.contains("„B“") && t.contains("endet")),
        "{etb:?}"
    );
}

// ---------- Position senden (Helfer-Sitzung) ----------

/// `PUT /api/devices/me/position` mit dem Cookie des Geräts.
async fn senden(l: &Lage, cookie: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(
        &l.app,
        "PUT",
        "/api/devices/me/position",
        cookie,
        Some(&body),
    )
    .await
}

fn punkt(lat: f64, lon: f64) -> Value {
    json!({"lat": lat, "lon": lon, "accuracy_m": 8.5, "recorded_at": chrono::Utc::now().to_rfc3339()})
}

/// `lat` und `position_quelle` einer Zeile in `einsatz_einheit`, `einsatz_fahrzeug` oder
/// `einsatz_personal`.
async fn position_von(
    pool: &sqlx::SqlitePool,
    tabelle: &str,
    id: i64,
) -> (Option<f64>, Option<String>) {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT lat, position_quelle FROM {tabelle} WHERE id = ?"
    )))
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Ein bestätigter Helfer an der Einheit, als Ortungsgerät und mit Person (Personenortung an).
async fn helfer_mit_person(l: &Lage) -> (i64, String, i64) {
    personenortung_einschalten(l).await;
    let person = common::stammpersonal_disponieren(&l.app, &l.admin, l.einsatz, "Erika M.").await;
    let (gid, cookie) = anmelden(l, "unit", l.einheit, "Erika").await;
    let (s, v) = bestaetigen(l, gid, json!({"is_tracker": true, "person_id": person})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    (gid, cookie, person)
}

/// Sammelt die bisher verteilten Live-Ereignisse mit Namen `tag`.
fn ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>,
    tag: &str,
) -> Vec<Value> {
    let mut alle = Vec::new();
    while let Ok(n) = rx.try_recv() {
        if n.event.as_str() == tag {
            alle.push(serde_json::from_str(&n.data).unwrap());
        }
    }
    alle
}

#[tokio::test]
async fn unbestaetigt_antwortet_409_ohne_speichern() {
    let l = lage().await;
    let (_gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["reason"], "unconfirmed", "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        None
    );
}

#[tokio::test]
async fn ortungsgeraet_schreibt_an_einheit_mit_quelle_helfer() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    sqlx::query("UPDATE geraet_kopplung SET letzter_zugriff_at = NULL WHERE id = ?")
        .bind(gid)
        .execute(&l.pool)
        .await
        .unwrap();
    let mut rx = l.live.abonniere(l.einsatz);

    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["stored"], true, "{v}");
    assert!(v["server_time"].is_string(), "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await,
        (Some(50.1), Some("helfer".into()))
    );
    let zugriff: Option<String> =
        sqlx::query_scalar("SELECT letzter_zugriff_at FROM geraet_kopplung WHERE id = ?")
            .bind(gid)
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert!(zugriff.is_some(), "letzter Zugriff gesetzt");
    let helfer_live = ereignisse(&mut rx, "helfer");
    assert_eq!(
        helfer_live,
        vec![json!({"einsatz_id": l.einsatz, "helfer_id": gid})],
        "Leitung sieht die erste Position, nur mit Kennungen"
    );

    // Die zweite Position innerhalb von 30 s schreibt, meldet der Leitung aber nichts Neues;
    // die Lagekarte bekommt jede.
    let (s, v) = senden(&l, &cookie, punkt(50.2, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["stored"], true, "{v}");
    let mut rx2 = l.live.abonniere(l.einsatz);
    let (s, _) = senden(&l, &cookie, punkt(50.3, 8.6)).await;
    assert_eq!(s, StatusCode::OK);
    assert!(ereignisse(&mut rx, "helfer").is_empty(), "gedrosselt");
    assert_eq!(ereignisse(&mut rx2, "einheit").len(), 1, "Lagekarte live");

    // Ein älterer Zeitpunkt wird verworfen.
    let (s, v) = senden(
        &l,
        &cookie,
        json!({"lat": 1.0, "lon": 1.0, "recorded_at": "2020-01-01T00:00:00Z"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["stored"], false, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        Some(50.3)
    );

    // Die Leitung sieht den Zeitpunkt der letzten Position.
    let (s, v) = anfrage(
        &l.app,
        "GET",
        &format!("/api/incidents/{}/helpers", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["helpers"][0]["last_position_at"].is_string(), "{v}");
}

#[tokio::test]
async fn ohne_ortungsrolle_nur_person() {
    let l = lage().await;
    personenortung_einschalten(&l).await;
    let person = common::stammpersonal_disponieren(&l.app, &l.admin, l.einsatz, "Erika M.").await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Erika").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": false, "person_id": person})).await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["stored"], true, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_personal", person).await,
        (Some(50.1), Some("helfer".into()))
    );
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        None,
        "ohne Ortungsrolle bleibt die Einheit unberührt"
    );
}

#[tokio::test]
async fn ohne_rolle_und_person_403() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": false})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["reason"], "no_role", "{v}");
}

#[tokio::test]
async fn geloeschtes_ziel_403_target_removed() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = datetime('now') WHERE id = ?")
        .bind(l.einheit)
        .execute(&l.pool)
        .await
        .unwrap();
    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["reason"], "target_removed", "{v}");

    // Ebenso, wenn das Fahrzeug ganz weg ist (Verweis auf NULL).
    let (gid, cookie) = anmelden(&l, "vehicle", l.fahrzeug, "Fahrer").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    sqlx::query("UPDATE geraet_kopplung SET fahrzeug_id = NULL WHERE id = ?")
        .bind(gid)
        .execute(&l.pool)
        .await
        .unwrap();
    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["reason"], "target_removed", "{v}");
}

#[tokio::test]
async fn org_schalter_aus_403_und_personen_geloescht() {
    let l = lage().await;
    let (_gid, cookie, person) = helfer_mit_person(&l).await;
    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_personal", person).await.0,
        Some(50.1)
    );

    // „Auch Personen orten“ aus: die Person verschwindet von der Karte, die Einheit bleibt, und
    // eine neue Position geht nur noch an die Einheit.
    let (s, v) = anfrage_json(
        &l.app,
        "PUT",
        "/api/org-settings",
        &l.admin,
        Some(&json!({"ortung_im_einsatz": true, "ortung_personen": false})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_personal", person).await.0,
        None
    );
    let (s, v) = senden(&l, &cookie, punkt(50.2, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_personal", person).await.0,
        None,
        "keine Personenposition ohne Personenortung"
    );
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        Some(50.2)
    );

    // Ortung ganz aus: 403 mit Grund, nichts geschrieben.
    personenortung_einschalten(&l).await;
    let (s, _) = senden(&l, &cookie, punkt(50.3, 8.6)).await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage_json(
        &l.app,
        "PUT",
        "/api/org-settings",
        &l.admin,
        Some(&json!({"ortung_im_einsatz": false})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_personal", person).await.0,
        None,
        "Personenposition beim Ausschalten gelöscht"
    );
    let (s, v) = senden(&l, &cookie, punkt(50.4, 8.6)).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["reason"], "tracking_off", "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        Some(50.3)
    );
}

#[tokio::test]
async fn pausieren_loescht_personenposition() {
    let l = lage().await;
    let (gid, cookie, person) = helfer_mit_person(&l).await;
    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut rx = l.live.abonniere(l.einsatz);

    let (s, v) = senden(&l, &cookie, json!({"paused": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_personal", person).await,
        (None, Some("helfer".into())),
        "Person weg, Quelle bleibt"
    );
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        Some(50.1),
        "Einheit behält den letzten Stand"
    );
    assert_eq!(
        ereignisse(&mut rx, "helfer"),
        vec![json!({"einsatz_id": l.einsatz, "helfer_id": gid})]
    );
    let (s, v) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["paused"], true, "{v}");

    // Pausiert schreibt eine verspätete Position nichts.
    let (s, v) = senden(&l, &cookie, punkt(50.2, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["stored"], false, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        Some(50.1)
    );

    // Fortsetzen.
    let (s, v) = senden(&l, &cookie, json!({"paused": false})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (_, v) = anfrage(&l.app, "GET", "/api/devices/me", &cookie, None).await;
    assert_eq!(v["paused"], false, "{v}");
    let (s, v) = senden(&l, &cookie, punkt(50.3, 8.6)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["stored"], true, "{v}");
    assert_eq!(
        position_von(&l.pool, "einsatz_personal", person).await.0,
        Some(50.3)
    );
}

#[tokio::test]
async fn einsatz_beendet_401() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = anfrage(
        &l.app,
        "POST",
        &format!("/api/einsaetze/{}/close", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = senden(&l, &cookie, punkt(50.1, 8.6)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "{v}");
}

#[tokio::test]
async fn unplausible_koordinate_422() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let (s, v) = bestaetigen(&l, gid, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for body in [
        punkt(91.0, 8.6),
        punkt(50.1, 181.0),
        json!({"lat": 50.1, "lon": 8.6, "recorded_at": "gestern"}),
        json!({"lat": 50.1, "lon": 8.6}),
    ] {
        let (s, v) = senden(&l, &cookie, body.clone()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body} → {v}");
    }
    assert_eq!(
        position_von(&l.pool, "einsatz_einheit", l.einheit).await.0,
        None
    );
}

#[tokio::test]
async fn leitung_hoert_helfer_live() {
    let l = lage().await;
    let mut rx = l.live.abonniere(l.einsatz);
    let (gid, _cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let erwartet = json!({"einsatz_id": l.einsatz, "helfer_id": gid});
    assert_eq!(
        ereignisse(&mut rx, "helfer"),
        vec![erwartet.clone()],
        "Einlösen"
    );
    let (s, _) = bestaetigen(&l, gid, json!({"is_tracker": true})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        ereignisse(&mut rx, "helfer"),
        vec![erwartet.clone()],
        "Bestätigen"
    );
    let ende = chrono::Utc::now() + chrono::TimeDelta::hours(10);
    let (s, v) = leitung(
        &l,
        &format!("/{gid}/extend"),
        Some(json!({"laeuft_ab_at": ende.format("%Y-%m-%d %H:%M:%S").to_string()})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        ereignisse(&mut rx, "helfer"),
        vec![erwartet.clone()],
        "Verlängern"
    );
    let (s, _) = leitung(&l, &format!("/{gid}/revoke"), None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ereignisse(&mut rx, "helfer"), vec![erwartet], "Abmelden");

    let (b, _) = anmelden(&l, "unit", l.einheit, "B").await;
    let (s, _) = leitung(&l, &format!("/{b}/reject"), None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        ereignisse(&mut rx, "helfer").len(),
        2,
        "Einlösen und Ablehnen"
    );
    let (c, _) = anmelden(&l, "unit", l.einheit, "C").await;
    let _ = ereignisse(&mut rx, "helfer");
    let (s, _) = leitung(&l, "/revoke", None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        ereignisse(&mut rx, "helfer"),
        vec![json!({"einsatz_id": l.einsatz, "helfer_id": c})],
        "alle abmelden"
    );
}
