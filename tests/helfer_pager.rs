//! Helfer-App Stufe 2 (Pager, Spec `docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md`,
//! ADR-0107): Aufträge an die Helfer-App, Quittung, Push-Anmeldung und Zustellung.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage_json, einsatz_anlegen, login_cookie};

// ---------- Aufbau ----------

/// Antwort eines Gerätewegs.
struct Antwort {
    status: StatusCode,
    body: Value,
}

/// Anfrage mit einem Gerätecookie (oder ohne).
async fn geraet(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: Option<&str>,
    body: Option<Value>,
) -> (Antwort, Option<String>) {
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
    (
        Antwort {
            status,
            body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        },
        cookie,
    )
}

/// Ein Einsatz mit Ortung, zwei Einheiten, einem Fahrzeug, einem Abschnitt und einer Einladung.
pub struct Lage {
    pub app: axum::Router,
    pub pool: sqlx::SqlitePool,
    pub live: lifeline_hub::live::LiveHub,
    pub admin: String,
    pub einsatz: i64,
    pub einheit: i64,
    pub einheit_f: i64,
    pub fahrzeug: i64,
    pub abschnitt: i64,
    pub code: String,
}

pub async fn lage() -> Lage {
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    lage_auf(app, pool, live).await
}

pub async fn lage_auf(
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: lifeline_hub::live::LiveHub,
) -> Lage {
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        "/api/org-settings",
        &admin,
        Some(&json!({"ortung_im_einsatz": true, "ortung_personen": true})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let einheit = common::einheit_bilden(&app, &admin, einsatz, "San-Trupp 2").await;
    let einheit_f = common::einheit_bilden(&app, &admin, einsatz, "San-Trupp 3").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&json!({"adhoc": {"funkrufname": "Rotkreuz 10/83-1", "fahrzeugtyp": "RTW"}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let fahrzeug = v["id"].as_i64().unwrap();
    let abschnitt: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/helpers/invitations"),
        &admin,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"].as_str().unwrap().to_string();
    Lage {
        app,
        pool,
        live,
        admin,
        einsatz,
        einheit,
        einheit_f,
        fahrzeug,
        abschnitt,
        code,
    }
}

/// Meldet einen Helfer an (unbestätigt); liefert Kennung der Kopplung und Cookie.
pub async fn anmelden(l: &Lage, kind: &str, id: i64, name: &str) -> (i64, String) {
    let (a, cookie) = geraet(
        &l.app,
        "POST",
        "/api/devices/helpers/redeem",
        None,
        Some(json!({
            "code": l.code,
            "display_name": name,
            "target": {"kind": kind, "id": id},
            "track_person": true,
        })),
    )
    .await;
    assert_eq!(a.status, StatusCode::CREATED, "{}", a.body);
    let gid: i64 = sqlx::query_scalar(
        "SELECT id FROM geraet_kopplung WHERE ansicht = 'helfer' ORDER BY id DESC LIMIT 1",
    )
    .fetch_one(&l.pool)
    .await
    .unwrap();
    (gid, cookie.unwrap())
}

/// Bestätigt einen Helfer (ohne Ortungsrolle, optional mit Person).
pub async fn bestaetigen(l: &Lage, gid: i64, person: Option<i64>) {
    let mut body = json!({"is_tracker": false});
    if let Some(p) = person {
        body["person_id"] = json!(p);
    }
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/incidents/{}/helpers/{gid}/confirm", l.einsatz),
        &l.admin,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Ein bestätigter Helfer; liefert Kennung der Kopplung und Cookie.
pub async fn helfer(l: &Lage, kind: &str, id: i64, name: &str) -> (i64, String) {
    let (gid, cookie) = anmelden(l, kind, id, name).await;
    bestaetigen(l, gid, None).await;
    (gid, cookie)
}

/// Erteilt einen Auftrag an die Empfänger; liefert ID und Antwort.
pub async fn erteilen(l: &Lage, text: &str, empfaenger: Value) -> (i64, Value) {
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/incidents/{}/tasks", l.einsatz),
        &l.admin,
        Some(&json!({"auftrag_text": text, "empfaenger": empfaenger})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (v["id"].as_i64().unwrap(), v)
}

fn an_einheit(id: i64) -> Value {
    json!({"empfaenger_typ": "einheit", "einheit_id": id})
}

/// Die Aufträge der Helfer-App.
async fn meine_auftraege(l: &Lage, cookie: &str) -> Antwort {
    geraet(&l.app, "GET", "/api/devices/me/tasks", Some(cookie), None)
        .await
        .0
}

async fn quittieren(l: &Lage, cookie: &str, auftrag: i64, empf: i64) -> Antwort {
    geraet(
        &l.app,
        "POST",
        &format!("/api/devices/me/tasks/{auftrag}/recipients/{empf}/acknowledge"),
        Some(cookie),
        None,
    )
    .await
    .0
}

fn texte(a: &Antwort) -> Vec<String> {
    a.body["tasks"]
        .as_array()
        .unwrap_or_else(|| panic!("{}", a.body))
        .iter()
        .map(|t| t["text"].as_str().unwrap().to_string())
        .collect()
}

/// Empfängerzeile des Auftrags `auftrag` an `einheit_id`.
async fn zeile(pool: &sqlx::SqlitePool, auftrag: i64) -> i64 {
    sqlx::query_scalar("SELECT id FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id")
        .bind(auftrag)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ---------- Aufträge lesen ----------

#[tokio::test]
async fn bestaetigter_helfer_sieht_auftraege_an_seine_einheit() {
    let l = lage().await;
    let (_, cookie) = helfer(&l, "unit", l.einheit, "Max M.").await;
    erteilen(&l, "An E", json!([an_einheit(l.einheit)])).await;
    erteilen(&l, "An F", json!([an_einheit(l.einheit_f)])).await;
    erteilen(
        &l,
        "An Abschnitt",
        json!([{"empfaenger_typ": "abschnitt", "abschnitt_id": l.abschnitt}]),
    )
    .await;
    let a = meine_auftraege(&l, &cookie).await;
    assert_eq!(a.status, StatusCode::OK, "{}", a.body);
    assert_eq!(texte(&a), vec!["An E"]);
    let r = &a.body["tasks"][0]["recipients"][0];
    assert_eq!(r["kind"], "unit", "{r}");
    assert!(r["acknowledged_at"].is_null(), "{r}");
}

#[tokio::test]
async fn helfer_mit_fahrzeug_sieht_auftraege_ans_fahrzeug() {
    let l = lage().await;
    let (_, cookie) = helfer(&l, "vehicle", l.fahrzeug, "RTW").await;
    erteilen(
        &l,
        "An RTW",
        json!([{"empfaenger_typ": "fahrzeug", "fahrzeug_id": l.fahrzeug}]),
    )
    .await;
    erteilen(&l, "An E", json!([an_einheit(l.einheit)])).await;
    let a = meine_auftraege(&l, &cookie).await;
    assert_eq!(texte(&a), vec!["An RTW"]);
    assert_eq!(a.body["tasks"][0]["recipients"][0]["kind"], "vehicle");
}

#[tokio::test]
async fn zugeordnete_person_sieht_auftrag_an_sich() {
    let l = lage().await;
    let person = common::stammpersonal_disponieren(&l.app, &l.admin, l.einsatz, "Erika M.").await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit_f, "Erika").await;
    bestaetigen(&l, gid, Some(person)).await;
    erteilen(
        &l,
        "An Erika",
        json!([{"empfaenger_typ": "person", "person_id": person}]),
    )
    .await;
    let a = meine_auftraege(&l, &cookie).await;
    assert_eq!(texte(&a), vec!["An Erika"]);
    assert_eq!(a.body["tasks"][0]["recipients"][0]["kind"], "person");
}

#[tokio::test]
async fn unbestaetigter_helfer_bekommt_403() {
    let l = lage().await;
    let (_, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let a = meine_auftraege(&l, &cookie).await;
    assert_eq!(a.status, StatusCode::FORBIDDEN, "{}", a.body);
    assert_eq!(a.body["reason"], "not_confirmed", "{}", a.body);
}

#[tokio::test]
async fn neueste_auftraege_zuerst_aufgehobene_bleiben_markiert() {
    let l = lage().await;
    let (_, cookie) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (alt, _) = erteilen(&l, "Alt", json!([an_einheit(l.einheit)])).await;
    sqlx::query("UPDATE auftrag SET erteilt_at = datetime('now', '-5 minutes') WHERE id = ?")
        .bind(alt)
        .execute(&l.pool)
        .await
        .unwrap();
    let (neu, _) = erteilen(&l, "Neu", json!([an_einheit(l.einheit)])).await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/incidents/{}/tasks/{neu}/void", l.einsatz),
        &l.admin,
        Some(&json!({"grund": "erledigt sich"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let a = meine_auftraege(&l, &cookie).await;
    assert_eq!(texte(&a), vec!["Neu", "Alt"]);
    assert!(a.body["tasks"][0]["cancelled_at"].is_string(), "{}", a.body);
    assert!(a.body["tasks"][1]["cancelled_at"].is_null(), "{}", a.body);
}

// ---------- Quittung ----------

#[tokio::test]
async fn quittung_aus_der_app_schreibt_die_empfaengerzeile() {
    let l = lage().await;
    let (gid, cookie) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    let empf = zeile(&l.pool, auftrag).await;
    let a = quittieren(&l, &cookie, auftrag, empf).await;
    assert_eq!(a.status, StatusCode::OK, "{}", a.body);
    assert_eq!(a.body["text"], "Zelt 3");
    assert!(
        a.body["recipients"][0]["acknowledged_at"].is_string(),
        "{}",
        a.body
    );
    assert_eq!(a.body["recipients"][0]["acknowledged_by"], "Max M.");
    let (von, konto): (Option<i64>, i64) = sqlx::query_as(
        "SELECT ae.quittiert_von_id, gk.benutzer_id FROM auftrag_empfaenger ae, geraet_kopplung gk \
         WHERE ae.id = ? AND gk.id = ?",
    )
    .bind(empf)
    .bind(gid)
    .fetch_one(&l.pool)
    .await
    .unwrap();
    assert_eq!(von, Some(konto));
    let quittiert: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung WHERE art = 'auftrag_quittiert'")
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert_eq!(quittiert, 1, "der Ersteller erfährt die Quittung");
}

#[tokio::test]
async fn fremde_zeile_ist_404() {
    let l = lage().await;
    let (_, cookie) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (auftrag, _) = erteilen(&l, "An F", json!([an_einheit(l.einheit_f)])).await;
    let empf = zeile(&l.pool, auftrag).await;
    let a = quittieren(&l, &cookie, auftrag, empf).await;
    assert_eq!(a.status, StatusCode::NOT_FOUND, "{}", a.body);
}

#[tokio::test]
async fn aufgehobener_auftrag_ist_422() {
    let l = lage().await;
    let (_, cookie) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (auftrag, _) = erteilen(&l, "Weg", json!([an_einheit(l.einheit)])).await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/incidents/{}/tasks/{auftrag}/void", l.einsatz),
        &l.admin,
        Some(&json!({"grund": "Lage geändert"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let empf = zeile(&l.pool, auftrag).await;
    let a = quittieren(&l, &cookie, auftrag, empf).await;
    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.body);
}

#[tokio::test]
async fn zweiter_helfer_sieht_uebernommen_von() {
    let l = lage().await;
    let (_, h1) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (_, h2) = helfer(&l, "unit", l.einheit, "Lisa K.").await;
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    let empf = zeile(&l.pool, auftrag).await;
    let erste = quittieren(&l, &h1, auftrag, empf).await;
    assert_eq!(erste.status, StatusCode::OK, "{}", erste.body);
    let zeit = erste.body["recipients"][0]["acknowledged_at"].clone();
    let zweite = quittieren(&l, &h2, auftrag, empf).await;
    assert_eq!(zweite.status, StatusCode::OK, "{}", zweite.body);
    assert_eq!(zweite.body["recipients"][0]["acknowledged_by"], "Max M.");
    assert_eq!(zweite.body["recipients"][0]["acknowledged_at"], zeit);
}

#[tokio::test]
async fn helfer_darf_nicht_die_auftraege_des_einsatzes() {
    let l = lage().await;
    let (_, cookie) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (a, _) = geraet(
        &l.app,
        "GET",
        &format!("/api/incidents/{}/tasks", l.einsatz),
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::FORBIDDEN, "{}", a.body);
}

// ---------- Push-Anmeldung ----------

fn push_body(token: &str) -> Value {
    json!({
        "registration_id": "0b7e4e0a-3c1d-4f2a-9a55-1d2f6a7c8e90",
        "token": token,
        "environment": "sandbox",
        "key": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
    })
}

async fn push_anmelden(l: &Lage, cookie: &str, token: &str) -> Antwort {
    geraet(
        &l.app,
        "PUT",
        "/api/devices/me/push",
        Some(cookie),
        Some(push_body(token)),
    )
    .await
    .0
}

async fn push_token(pool: &sqlx::SqlitePool, gid: i64) -> Option<String> {
    sqlx::query_scalar("SELECT token FROM helfer_push_anmeldung WHERE kopplung_id = ?")
        .bind(gid)
        .fetch_optional(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn push_anmeldung_ersetzt_die_vorige() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let a = push_anmelden(&l, &cookie, "ab12").await;
    assert_eq!(a.status, StatusCode::NO_CONTENT, "{}", a.body);
    push_anmelden(&l, &cookie, "cd34").await;
    assert_eq!(push_token(&l.pool, gid).await.as_deref(), Some("cd34"));
    let (a, _) = geraet(
        &l.app,
        "DELETE",
        "/api/devices/me/push",
        Some(&cookie),
        None,
    )
    .await;
    assert_eq!(a.status, StatusCode::NO_CONTENT, "{}", a.body);
    assert_eq!(push_token(&l.pool, gid).await, None);
}

#[tokio::test]
async fn push_anmeldung_mit_kurzem_schluessel_ist_400() {
    let l = lage().await;
    let (_, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    let mut body = push_body("ab12");
    body["key"] = json!("AQEB");
    let (a, _) = geraet(
        &l.app,
        "PUT",
        "/api/devices/me/push",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(a.status, StatusCode::BAD_REQUEST, "{}", a.body);
    let mut body = push_body("ab12");
    body["environment"] = json!("test");
    let (a, _) = geraet(
        &l.app,
        "PUT",
        "/api/devices/me/push",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(a.status, StatusCode::BAD_REQUEST, "{}", a.body);
}

/// Ein bestätigter Helfer mit Push-Anmeldung.
async fn helfer_mit_push(l: &Lage, name: &str) -> (i64, String) {
    let (gid, cookie) = helfer(l, "unit", l.einheit, name).await;
    let a = push_anmelden(l, &cookie, "ab12").await;
    assert_eq!(a.status, StatusCode::NO_CONTENT, "{}", a.body);
    (gid, cookie)
}

async fn leitung_post(l: &Lage, pfad: &str) {
    let (s, v) = anfrage_json(&l.app, "POST", pfad, &l.admin, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
}

#[tokio::test]
async fn push_anmeldung_endet_mit_dem_widerruf() {
    let l = lage().await;
    let (gid, _) = helfer_mit_push(&l, "Max M.").await;
    leitung_post(
        &l,
        &format!("/api/incidents/{}/helpers/{gid}/revoke", l.einsatz),
    )
    .await;
    assert_eq!(push_token(&l.pool, gid).await, None);
}

#[tokio::test]
async fn push_anmeldung_endet_mit_der_ablehnung() {
    let l = lage().await;
    let (gid, cookie) = anmelden(&l, "unit", l.einheit, "Max M.").await;
    push_anmelden(&l, &cookie, "ab12").await;
    leitung_post(
        &l,
        &format!("/api/incidents/{}/helpers/{gid}/reject", l.einsatz),
    )
    .await;
    assert_eq!(push_token(&l.pool, gid).await, None);
}

#[tokio::test]
async fn push_anmeldung_endet_mit_dem_abmelden() {
    let l = lage().await;
    let (gid, cookie) = helfer_mit_push(&l, "Max M.").await;
    let (a, _) = geraet(&l.app, "POST", "/api/auth/logout", Some(&cookie), None).await;
    assert!(a.status.is_success(), "{}", a.body);
    assert_eq!(push_token(&l.pool, gid).await, None);
}

#[tokio::test]
async fn push_anmeldung_endet_mit_alle_entfernen() {
    let l = lage().await;
    let (gid, _) = helfer_mit_push(&l, "Max M.").await;
    leitung_post(&l, &format!("/api/incidents/{}/helpers/revoke", l.einsatz)).await;
    assert_eq!(push_token(&l.pool, gid).await, None);
}

#[tokio::test]
async fn push_anmeldung_endet_mit_dem_einsatz() {
    let l = lage().await;
    let (gid, _) = helfer_mit_push(&l, "Max M.").await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/incidents/{}/close", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(push_token(&l.pool, gid).await, None);
}

#[tokio::test]
async fn push_anmeldung_endet_mit_dem_ablauf() {
    let l = lage().await;
    let (gid, _) = helfer_mit_push(&l, "Max M.").await;
    sqlx::query(
        "UPDATE geraet_kopplung SET laeuft_ab_at = datetime('now', '-1 minute') WHERE id = ?",
    )
    .bind(gid)
    .execute(&l.pool)
    .await
    .unwrap();
    lifeline_hub::geraet::ablauf::raeume_helfer(&l.pool, &l.live)
        .await
        .unwrap();
    assert_eq!(push_token(&l.pool, gid).await, None);
}

// ---------- Zustellung (helfer::pager) ----------

use common::relais::{relais_doppel, RelaisDoppel};

const HELFER_BUNDLE: &str = "dev.rubeen.lifeline.helfer";

/// Eine Lage mit iOS-Push an ein Relais-Doppel.
async fn lage_mit_relais() -> (Lage, RelaisDoppel) {
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    let relais = relais_doppel().await;
    live.ios_push_einrichten(relais.ios_push(&pool));
    (lage_auf(app, pool, live).await, relais)
}

/// Ein bestätigter Helfer mit eigenem Token (`n` als Hex, 64 Zeichen).
async fn pager(l: &Lage, kind: &str, id: i64, name: &str, n: u8) -> (i64, String) {
    let (gid, cookie) = helfer(l, kind, id, name).await;
    let mut body = push_body(&format!("{n:02x}").repeat(32));
    body["key"] = json!(lifeline_hub::web_push::krypto::b64(&[n; 32]));
    let (a, _) = geraet(
        &l.app,
        "PUT",
        "/api/devices/me/push",
        Some(&cookie),
        Some(body),
    )
    .await;
    assert_eq!(a.status, StatusCode::NO_CONTENT, "{}", a.body);
    (gid, cookie)
}

fn tokens(nachrichten: &Value) -> Vec<String> {
    let mut t: Vec<String> = nachrichten["nachrichten"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["token"].as_str().unwrap().to_string())
        .collect();
    t.sort();
    t
}

fn token(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

async fn gesendet(pool: &sqlx::SqlitePool, auftrag: i64) -> Vec<Option<i64>> {
    sqlx::query_scalar(
        "SELECT helfer_gesendet FROM auftrag_empfaenger WHERE auftrag_id = ? ORDER BY id",
    )
    .bind(auftrag)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn auftrag_an_einheit_geht_an_alle_bestaetigten_helfer() {
    let (l, mut relais) = lage_mit_relais().await;
    pager(&l, "unit", l.einheit, "Max M.", 1).await;
    pager(&l, "unit", l.einheit, "Lisa K.", 2).await;
    // Ein unbestätigter Helfer derselben Einheit bekommt nichts.
    let (_, cookie) = anmelden(&l, "unit", l.einheit, "Neu").await;
    let mut body = push_body(&token(3));
    body["key"] = json!(lifeline_hub::web_push::krypto::b64(&[3; 32]));
    geraet(
        &l.app,
        "PUT",
        "/api/devices/me/push",
        Some(&cookie),
        Some(body),
    )
    .await;

    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    let n = relais.naechste().await;
    assert_eq!(tokens(&n), vec![token(1), token(2)]);
    for m in n["nachrichten"].as_array().unwrap() {
        assert_eq!(m["thema"], HELFER_BUNDLE, "{m}");
        assert_eq!(m["stufe"], "alarm", "{m}");
    }
    relais.keine().await;
    assert_eq!(gesendet(&l.pool, auftrag).await, vec![Some(2)]);
}

#[tokio::test]
async fn pausierter_helfer_bekommt_auftraege() {
    let (l, mut relais) = lage_mit_relais().await;
    let (gid, _) = pager(&l, "unit", l.einheit, "Max M.", 1).await;
    sqlx::query("UPDATE geraet_kopplung SET pausiert_at = datetime('now') WHERE id = ?")
        .bind(gid)
        .execute(&l.pool)
        .await
        .unwrap();
    erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    assert_eq!(tokens(&relais.naechste().await), vec![token(1)]);
}

#[tokio::test]
async fn helfer_mit_einheit_und_person_bekommt_eine_nachricht() {
    let (l, mut relais) = lage_mit_relais().await;
    let person = common::stammpersonal_disponieren(&l.app, &l.admin, l.einsatz, "Erika M.").await;
    let (gid, _) = anmelden(&l, "unit", l.einheit, "Erika").await;
    bestaetigen(&l, gid, Some(person)).await;
    // Push-Anmeldung direkt (Kopplung bestätigt, Cookie nicht nötig).
    lifeline_hub::helfer::push::save_registration(
        &l.pool,
        &lifeline_hub::helfer::push::HelferPushAnmeldung {
            kopplung_id: gid,
            kennung: "0b7e4e0a-3c1d-4f2a-9a55-1d2f6a7c8e90".into(),
            token: token(1),
            umgebung: lifeline_hub::ios_push::relais::Umgebung::Sandbox,
            schluessel: [1; 32],
        },
    )
    .await
    .unwrap();
    let (auftrag, _) = erteilen(
        &l,
        "Zelt 3",
        json!([an_einheit(l.einheit), {"empfaenger_typ": "person", "person_id": person}]),
    )
    .await;
    assert_eq!(tokens(&relais.naechste().await), vec![token(1)]);
    relais.keine().await;
    assert_eq!(gesendet(&l.pool, auftrag).await, vec![Some(1), Some(1)]);
}

#[tokio::test]
async fn nach_einsatzende_wird_nichts_zugestellt() {
    let (l, mut relais) = lage_mit_relais().await;
    pager(&l, "unit", l.einheit, "Max M.", 1).await;
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    relais.naechste().await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/incidents/{}/close", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Neue Zeile ohne Zustellung, dann die Zustellung direkt: nichts geht hinaus.
    sqlx::query("UPDATE auftrag_empfaenger SET helfer_gesendet = NULL WHERE auftrag_id = ?")
        .bind(auftrag)
        .execute(&l.pool)
        .await
        .unwrap();
    let ziele = lifeline_hub::helfer::pager::resolve(&l.pool, l.einsatz, auftrag)
        .await
        .unwrap();
    assert!(ziele.is_empty(), "{ziele:?}");
    relais.keine().await;
}

#[tokio::test]
async fn widerrufener_helfer_bekommt_nichts() {
    let (l, mut relais) = lage_mit_relais().await;
    let (gid, _) = pager(&l, "unit", l.einheit, "Max M.", 1).await;
    pager(&l, "unit", l.einheit, "Lisa K.", 2).await;
    leitung_post(
        &l,
        &format!("/api/incidents/{}/helpers/{gid}/revoke", l.einsatz),
    )
    .await;
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    assert_eq!(tokens(&relais.naechste().await), vec![token(2)]);
    assert_eq!(gesendet(&l.pool, auftrag).await, vec![Some(1)]);
}

#[tokio::test]
async fn auftrag_ohne_helfer_zaehlt_null() {
    let (l, mut relais) = lage_mit_relais().await;
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    relais.keine().await;
    assert_eq!(gesendet(&l.pool, auftrag).await, vec![Some(0)]);
}

#[tokio::test]
async fn berichtigung_stellt_nur_neu_betroffenen_zu() {
    let (l, mut relais) = lage_mit_relais().await;
    pager(&l, "unit", l.einheit, "Max M.", 1).await;
    pager(&l, "unit", l.einheit_f, "Lisa K.", 2).await;
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    assert_eq!(tokens(&relais.naechste().await), vec![token(1)]);
    let (s, v) = anfrage_json(
        &l.app,
        "PATCH",
        &format!("/api/incidents/{}/tasks/{auftrag}", l.einsatz),
        &l.admin,
        Some(&json!({"empfaenger": [an_einheit(l.einheit), an_einheit(l.einheit_f)]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(tokens(&relais.naechste().await), vec![token(2)]);
    relais.keine().await;
    assert_eq!(gesendet(&l.pool, auftrag).await, vec![Some(1), Some(1)]);
}

#[tokio::test]
async fn nutzlast_ist_entschluesselbar() {
    let (l, mut relais) = lage_mit_relais().await;
    pager(&l, "unit", l.einheit, "Max M.", 1).await;
    let (auftrag, _) = erteilen(
        &l,
        "Verletzte Person, Zelt 3",
        json!([an_einheit(l.einheit)]),
    )
    .await;
    let n = relais.naechste().await;
    let umschlag = n["nachrichten"][0]["nutzlast"].as_str().unwrap();
    let (kennung, nonce, chiffrat) =
        lifeline_hub::ios_push::krypto::umschlag_lesen(umschlag).unwrap();
    assert_eq!(kennung, "0b7e4e0a-3c1d-4f2a-9a55-1d2f6a7c8e90");
    let klar =
        lifeline_hub::ios_push::krypto::entschluesseln(&[1; 32], &kennung, &nonce, &chiffrat)
            .unwrap();
    let k: Value = serde_json::from_slice(&klar).unwrap();
    assert_eq!(k["art"], "auftrag", "{k}");
    assert_eq!(k["t"], auftrag, "{k}");
    assert_eq!(k["e"], l.einsatz, "{k}");
    assert_eq!(k["titel"], "San-Trupp 2", "{k}");
    assert_eq!(k["text"], "Verletzte Person, Zelt 3", "{k}");
    assert!(n["nachrichten"][0]["kollaps"].is_string());
}

#[tokio::test]
async fn ungueltiges_token_loescht_die_anmeldung() {
    let (l, mut relais) = lage_mit_relais().await;
    let (gid, _) = pager(&l, "unit", l.einheit, "Max M.", 1).await;
    *relais.ergebnis.lock().unwrap() = "token_ungueltig";
    erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    relais.naechste().await;
    for _ in 0..50 {
        if push_token(&l.pool, gid).await.is_none() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("Anmeldung mit ungültigem Token blieb stehen");
}

#[tokio::test]
async fn live_ereignis_nur_im_strom_der_betroffenen_kopplung() {
    let l = lage().await;
    let (_, h1) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (_, h3) = helfer(&l, "unit", l.einheit_f, "Lisa K.").await;
    let mut strom_h1 = common::live_oeffnen(&l.app, &h1, l.einsatz)
        .await
        .into_body();
    let mut strom_h3 = common::live_oeffnen(&l.app, &h3, l.einsatz)
        .await
        .into_body();
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    let d = std::time::Duration::from_millis(800);
    let text_h1 = common::sse_lesen_fuer(&mut strom_h1, d).await;
    let text_h3 = common::sse_lesen_fuer(&mut strom_h3, d).await;
    assert!(
        text_h1.contains("event: helfer_auftrag")
            && text_h1.contains(&format!("\"task_id\":{auftrag}")),
        "{text_h1}"
    );
    assert!(!text_h3.contains("helfer_auftrag"), "{text_h3}");
    // Der Einsatz-Feed der Einheitenansicht kennt das Ereignis nicht (es ist kein LiveEvent).
    assert!(!text_h1.contains("event: auftrag\n"), "{text_h1}");
}

#[tokio::test]
async fn quittung_meldet_den_anderen_helfern_live() {
    let l = lage().await;
    let (_, h1) = helfer(&l, "unit", l.einheit, "Max M.").await;
    let (_, h2) = helfer(&l, "unit", l.einheit, "Lisa K.").await;
    let (auftrag, _) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    let mut strom_h2 = common::live_oeffnen(&l.app, &h2, l.einsatz)
        .await
        .into_body();
    let d = std::time::Duration::from_millis(300);
    common::sse_lesen_fuer(&mut strom_h2, d).await;
    let empf = zeile(&l.pool, auftrag).await;
    quittieren(&l, &h1, auftrag, empf).await;
    let text = common::sse_lesen_fuer(&mut strom_h2, std::time::Duration::from_millis(800)).await;
    assert!(text.contains("event: helfer_auftrag"), "{text}");
}

// ---------- Leitung ----------

#[tokio::test]
async fn auftragsdetail_zeigt_helfer_gesendet_und_quittierenden_helfer() {
    let l = lage().await;
    let (_, h1) = helfer(&l, "unit", l.einheit, "Max M.").await;
    helfer(&l, "unit", l.einheit, "Lisa K.").await;
    let (auftrag, v) = erteilen(&l, "Zelt 3", json!([an_einheit(l.einheit)])).await;
    // Die Antwort des Erteilens entsteht vor der Zustellung; das Detail zählt.
    assert!(
        v["empfaenger"][0].get("quittiert_von_helfer").is_none(),
        "{v}"
    );
    let empf = zeile(&l.pool, auftrag).await;
    quittieren(&l, &h1, auftrag, empf).await;
    let (s, d) = anfrage_json(
        &l.app,
        "GET",
        &format!("/api/incidents/{}/tasks/{auftrag}", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{d}");
    assert_eq!(d["empfaenger"][0]["helfer_gesendet"], 2, "{d}");
    assert_eq!(d["empfaenger"][0]["quittiert_von_helfer"], "Max M.", "{d}");
}

// ---------- Weitere Wege zum Auftrag (Review) ----------

async fn post_admin(l: &Lage, pfad: String, body: Value) -> Value {
    let (s, v) = anfrage_json(&l.app, "POST", &pfad, &l.admin, Some(&body)).await;
    assert!(s.is_success(), "{pfad}: {s} {v}");
    v
}

#[tokio::test]
async fn auftraege_aus_etb_chat_und_meldung_gehen_an_die_helfer_app() {
    let (l, mut relais) = lage_mit_relais().await;
    pager(&l, "unit", l.einheit, "Max M.", 1).await;
    let e = l.einsatz;
    let auftrag = json!({"auftrag_text": "Zelt 3", "empfaenger": [an_einheit(l.einheit)]});

    let etb = post_admin(
        &l,
        format!("/api/incidents/{e}/etb"),
        json!({"von": "ELW 1", "an": "ELW 1", "typ": "meldung", "inhalt": "Deich km12"}),
    )
    .await;
    post_admin(
        &l,
        format!("/api/incidents/{e}/etb/{}/task", etb["id"]),
        auftrag.clone(),
    )
    .await;
    assert_eq!(
        tokens(&relais.naechste().await),
        vec![token(1)],
        "aus dem ETB"
    );

    let meldung = post_admin(
        &l,
        format!("/api/incidents/{e}/reports"),
        json!({"absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
               "inhalt": "Deich km12", "ereigniszeit": "2026-06-12 09:00:00"}),
    )
    .await;
    post_admin(
        &l,
        format!("/api/incidents/{e}/reports/{}/task", meldung["id"]),
        auftrag.clone(),
    )
    .await;
    assert_eq!(
        tokens(&relais.naechste().await),
        vec![token(1)],
        "aus der Meldung"
    );

    let (_, kanaele) = anfrage_json(
        &l.app,
        "GET",
        &format!("/api/incidents/{e}/chat/channels"),
        &l.admin,
        None,
    )
    .await;
    let nachricht = post_admin(
        &l,
        format!(
            "/api/incidents/{e}/chat/channels/{}/messages",
            kanaele[0]["id"]
        ),
        json!({"inhalt": "Deich sichern"}),
    )
    .await;
    post_admin(
        &l,
        format!(
            "/api/incidents/{e}/chat/messages/{}/promote-to-task",
            nachricht["id"]
        ),
        auftrag,
    )
    .await;
    assert_eq!(
        tokens(&relais.naechste().await),
        vec![token(1)],
        "aus dem Chat"
    );

    let offen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auftrag_empfaenger WHERE helfer_gesendet IS NULL")
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert_eq!(offen, 0, "jede Zeile ist gezählt");
}

#[tokio::test]
async fn berichtigung_meldet_entfernten_empfaengern_live() {
    let l = lage().await;
    helfer(&l, "unit", l.einheit, "Max M.").await;
    let (_, h2) = helfer(&l, "unit", l.einheit_f, "Lisa K.").await;
    let (auftrag, _) = erteilen(
        &l,
        "Zelt 3",
        json!([an_einheit(l.einheit), an_einheit(l.einheit_f)]),
    )
    .await;
    let mut strom = common::live_oeffnen(&l.app, &h2, l.einsatz)
        .await
        .into_body();
    common::sse_lesen_fuer(&mut strom, std::time::Duration::from_millis(300)).await;
    let (s, v) = anfrage_json(
        &l.app,
        "PATCH",
        &format!("/api/incidents/{}/tasks/{auftrag}", l.einsatz),
        &l.admin,
        Some(&json!({"empfaenger": [an_einheit(l.einheit)]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let text = common::sse_lesen_fuer(&mut strom, std::time::Duration::from_millis(800)).await;
    assert!(
        text.contains(&format!("\"task_id\":{auftrag}")),
        "der entfernte Helfer lädt neu: {text}"
    );
    let a = meine_auftraege(&l, &h2).await;
    assert!(texte(&a).is_empty(), "{}", a.body);
}
