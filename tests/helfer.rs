//! Helfer-App (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, ADR-0098):
//! Helfer-Einladung durch die Leitung.

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
    admin: String,
    einsatz: i64,
    einheit: i64,
    fahrzeug: i64,
    code: String,
}

async fn lage() -> Lage {
    let (app, pool) = setup_mit_pool().await;
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
