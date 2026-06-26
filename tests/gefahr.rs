use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::broadcast::Receiver;
use tower::ServiceExt;

async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool,
        live: live.clone(),
        karten_dir: std::env::temp_dir(), fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    });
    (router, live)
}

async fn login_cookie(app: &axum::Router, benutzername: &str, passwort: &str) -> String {
    let body = format!(r#"{{"benutzername":"{benutzername}","passwort":"{passwort}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

async fn benutzer_anlegen(app: &axum::Router, admin: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let (status, json) = anfrage(app, "POST", "/api/benutzer", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn anfrage(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(methode)
        .uri(uri)
        .header(header::COOKIE, cookie.to_string());
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/einsaetze",
        cookie,
        Some(r#"{"bezeichnung":"Lage"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn rolle_setzen(app: &axum::Router, leit: &str, einsatz: i64, benutzer_id: i64, rolle: &str) {
    let (status, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        leit,
        Some(&format!(r#"{{"einsatz_rolle":"{rolle}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

async fn recv_until_tag(
    rx: &mut Receiver<LiveNachricht>,
    tag: &str,
    timeout: Duration,
) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv())
            .await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event == tag {
            return n;
        }
    }
}

fn bewertung(typ: &str, objekt: &str, warn: &str) -> String {
    json!({"gefahrentyp": typ, "schutzobjekt": objekt, "warnstufe": warn}).to_string()
}

const POLY: &str =
    r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;

/// Zeichnet eine gefahrengebiet-Zone und liefert die automatisch erzeugte Gebiets-id.
async fn gefahrengebiet_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    label: &str,
) -> i64 {
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":label})
            .to_string();
    let (status, z) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    z["gefahrengebiet_id"].as_i64().unwrap()
}

#[tokio::test]
async fn matrix_leer_dann_put_dann_upsert() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix");

    let (_, leer) = anfrage(&app, "GET", &u, &admin, None).await;
    assert_eq!(leer.as_array().unwrap().len(), 0);

    let (status, z) = anfrage(
        &app,
        "PUT",
        &format!("{u}/bewertung"),
        &admin,
        Some(&bewertung("brand", "menschen", "hoch")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{z:?}");
    assert_eq!(z["warnstufe"], "hoch");
    assert_eq!(z["gefahrengebiet_id"], gid);

    anfrage(
        &app,
        "PUT",
        &format!("{u}/bewertung"),
        &admin,
        Some(&bewertung("brand", "menschen", "akut")),
    )
    .await;
    let (_, liste2) = anfrage(&app, "GET", &u, &admin, None).await;
    assert_eq!(
        liste2.as_array().unwrap().len(),
        1,
        "UPSERT, keine zweite Zeile"
    );
    assert_eq!(liste2[0]["warnstufe"], "akut");
}

#[tokio::test]
async fn keine_leert_die_zelle() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix");
    anfrage(
        &app,
        "PUT",
        &format!("{u}/bewertung"),
        &admin,
        Some(&bewertung("brand", "menschen", "hoch")),
    )
    .await;
    anfrage(
        &app,
        "PUT",
        &format!("{u}/bewertung"),
        &admin,
        Some(&bewertung("brand", "menschen", "keine")),
    )
    .await;
    let (_, liste) = anfrage(&app, "GET", &u, &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn ungueltiger_enum_und_kombination_sind_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung");
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &u,
            &admin,
            Some(&bewertung("quatsch", "menschen", "hoch"))
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &u,
            &admin,
            Some(&bewertung("brand", "quatsch", "hoch"))
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &u,
            &admin,
            Some(&bewertung("brand", "menschen", "quatsch"))
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &u,
            &admin,
            Some(&bewertung("atemgifte", "sachwerte", "hoch"))
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn etb_bei_warnstufenwechsel_nicht_bei_reiner_beschreibung() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let u = format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung");

    anfrage(
        &app,
        "PUT",
        &u,
        &admin,
        Some(&bewertung("brand", "menschen", "hoch")),
    )
    .await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|i| i == "Gefahr «Brand» für «Menschen» in «Nord» auf Warnstufe «hoch» gesetzt."),
        "ETB: {etb:?}"
    );
    let basis = etb.len();

    let nur_beschreibung = json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch","beschreibung":"Dachstuhl"}).to_string();
    anfrage(&app, "PUT", &u, &admin, Some(&nur_beschreibung)).await;
    assert_eq!(
        system_etb_inhalte(&app, &admin, einsatz).await.len(),
        basis,
        "Beschreibung allein darf keinen ETB erzeugen"
    );

    anfrage(
        &app,
        "PUT",
        &u,
        &admin,
        Some(&bewertung("brand", "menschen", "keine")),
    )
    .await;
    let etb2 = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(etb2.len(), basis + 1);
    assert!(
        etb2.iter()
            .any(|i| i == "Gefahr «Brand» für «Menschen» in «Nord» aufgehoben."),
        "ETB: {etb2:?}"
    );
}

#[tokio::test]
async fn sse_feuert_bei_put() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let mut rx = live.abonniere(einsatz);
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"),
        &admin,
        Some(&bewertung("brand", "menschen", "hoch")),
    )
    .await;
    let n = recv_until_tag(&mut rx, "gefahr", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
    assert_eq!(v["gefahrengebiet_id"], gid);
}

#[tokio::test]
async fn gebiete_liste_zeigt_zonen_und_hoechste_warnstufe() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"),
        &admin,
        Some(&bewertung("brand", "menschen", "mittel")),
    )
    .await;

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete"),
        &admin,
        None,
    )
    .await;
    let arr = liste.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["id"], gid);
    assert_eq!(arr[0]["label"], "Nord");
    assert_eq!(arr[0]["hoechste_warnstufe"], "mittel");
    assert_eq!(arr[0]["zonen_ids"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn fremdes_einsatz_gid_ist_notfound() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let gid_a = gefahrengebiet_anlegen(&app, &admin, a, "Nord").await;
    // gid aus Einsatz A über Einsatz B abfragen → NotFound (Ownership-Gate).
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{b}/gefahrengebiete/{gid_a}/matrix"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn berechtigung_beobachter_liest_schreibt_nicht() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix"),
            &erika_c,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"),
            &erika_c,
            Some(&bewertung("brand", "menschen", "hoch"))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_abgewiesen() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let get = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix"),
        &fremd,
        None,
    )
    .await
    .0;
    assert!(
        matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "GET: {get}"
    );
}

#[tokio::test]
async fn umbenennen_setzt_label_und_fremdes_gid_ist_404() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gid = gefahrengebiet_anlegen(&app, &admin, einsatz, "Nord").await;
    let (status, g) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}"),
        &admin,
        Some(&json!({"label":"Süd"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{g:?}");
    assert_eq!(g["label"], "Süd");
    // Fremder Einsatz → Ownership-Gate.
    let b = einsatz_anlegen(&app, &admin).await;
    let (s2, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{b}/gefahrengebiete/{gid}"),
        &admin,
        Some(&json!({"label":"X"}).to_string()),
    )
    .await;
    assert_eq!(s2, StatusCode::NOT_FOUND);
}
