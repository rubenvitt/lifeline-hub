//! Helfer-App Stufe 2 (Pager, Spec `docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md`,
//! ADR-0104): Aufträge an die Helfer-App, Quittung, Push-Anmeldung und Zustellung.

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
    assert!(a.body["recipients"][0]["acknowledged_at"].is_string(), "{}", a.body);
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
    let quittiert: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM benachrichtigung WHERE art = 'auftrag_quittiert'",
    )
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
