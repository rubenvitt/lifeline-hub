//! Gerätekopplung (LFH-892): Verwaltung durch die Einsatzleitung, Einlösen des Codes,
//! Durchsetzung an der Sitzung und sofortiger Widerruf.
//!
//! Spec: `openspec/specs/geraete-kopplung/spec.md`.

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::time::Duration;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einheit_bilden, einsatz_anlegen, einsatz_anlegen_mit,
    login_cookie, plan_hochladen, png_bytes, rolle_setzen, setup_mit_pool_und_live,
    system_etb_inhalte,
};

// ---------- Helfer ----------

struct Antwort {
    status: StatusCode,
    cookie: Option<String>,
    body: Value,
}

/// `POST /api/geraete/koppeln` ohne Sitzung, optional von einer festen Adresse.
async fn koppeln(app: &axum::Router, code: &str, peer: Option<SocketAddr>) -> Antwort {
    let mut req = Request::builder()
        .method("POST")
        .uri("/api/geraete/koppeln")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    if let Some(p) = peer {
        req.extensions_mut().insert(ConnectInfo(p));
    }
    let resp = app.clone().oneshot(req).await.unwrap();
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

/// Legt eine aktive UHS an.
async fn uhs_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    uhs
}

async fn anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        cookie,
        Some(&body),
    )
    .await
}

/// Kopplung anlegen (201) und `(kopplung_id, code)` liefern.
async fn kopplung(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> (i64, String) {
    let (s, v) = anlegen(app, cookie, einsatz, body).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (
        v["kopplung"]["id"].as_i64().unwrap(),
        v["code"]["code"].as_str().unwrap().to_string(),
    )
}

/// Ein gekoppeltes UHS-Tablet: `(kopplung_id, geräte-cookie)`.
async fn tablet(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64) -> (i64, String) {
    let (id, code) = kopplung(
        app,
        cookie,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    (id, a.cookie.expect("Sitzungscookie"))
}

async fn me(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", "/api/auth/me", cookie, None).await
}

async fn widerrufen(app: &axum::Router, cookie: &str, einsatz: i64, id: i64) {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/widerrufen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["status"], "widerrufen");
}

async fn geraetekonto(pool: &sqlx::SqlitePool, kopplung_id: i64) -> (i64, String) {
    sqlx::query_as(
        "SELECT b.id, b.benutzername FROM geraet_kopplung gk JOIN benutzer b ON b.id = gk.benutzer_id \
         WHERE gk.id = ?",
    )
    .bind(kopplung_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

// ---------- Verwaltung ----------

#[tokio::test]
async fn fuehrungspersonal_darf_nicht_koppeln() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fp = benutzer_anlegen(&app, &admin, "fuehrung", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let fp = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (s, _) = anlegen(
        &app,
        &fp,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM geraet_kopplung")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(anzahl, 0, "keine Kopplung entstanden");
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &fp,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Übersicht nur für die Einsatzleitung"
    );
}

#[tokio::test]
async fn anlegen_prueft_eingaben() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;

    let faelle = [
        json!({"ansicht": "uhs-tablet", "bezeichnung": "Tablet 1"}),
        json!({"ansicht": "lagemonitor", "uhs_id": uhs, "bezeichnung": "Monitor"}),
        json!({"ansicht": "kiosk", "bezeichnung": "X"}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "  "}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "x".repeat(61)}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "M", "laeuft_ab_at": "2020-01-01 00:00"}),
        json!({"ansicht": "lagemonitor", "bezeichnung": "M", "laeuft_ab_at": "unsinn"}),
    ];
    for body in faelle {
        let (s, v) = anlegen(&app, &admin, einsatz, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }

    // Über 72 Stunden ab jetzt.
    let zu_weit = (chrono::Utc::now() + chrono::Duration::hours(73))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let (s, _) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "M", "laeuft_ab_at": zu_weit}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn uhs_eines_anderen_einsatzes_ist_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Anderer").await;
    let fremde_uhs = uhs_anlegen(&app, &admin, anderer, "UHS Süd").await;

    let (s, _) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": fremde_uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ---------- Weitere Stellen (LFH-1040) ----------

/// Alle Ansichten des Katalogs sind koppelbar; die Übersicht bietet sie in Bedienreihenfolge an,
/// mit der Art ihrer Stelle.
#[tokio::test]
async fn uebersicht_bietet_alle_ansichten() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["ansichten"],
        json!([
            {"ansicht": "uhs-tablet", "stellenart": "uhs"},
            {"ansicht": "uhs-laptop", "stellenart": "uhs"},
            {"ansicht": "lagemonitor", "stellenart": null},
            {"ansicht": "betreuungsstelle", "stellenart": "betreuungsstelle"},
            {"ansicht": "bereitstellungsraum", "stellenart": "bereitstellungsraum"},
            {"ansicht": "einsatzabschnitt", "stellenart": "einsatzabschnitt"},
            {"ansicht": "verpflegung", "stellenart": null},
        ])
    );
}

/// `stelle_id` bindet wie das bisherige `uhs_id`; Übersicht und Selbstsicht tragen beides.
#[tokio::test]
async fn stelle_id_bindet_wie_uhs_id() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;

    let (s, v) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "uhs-laptop", "stelle_id": uhs, "bezeichnung": "Laptop"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["kopplung"]["uhs_id"], uhs);
    assert_eq!(v["kopplung"]["stelle_id"], uhs);
    assert_eq!(v["kopplung"]["stelle"], "UHS Nord");

    let a = koppeln(&app, v["code"]["code"].as_str().unwrap(), None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    let (s, ich) = me(&app, &a.cookie.unwrap()).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ich["geraet"]["stelle_id"], uhs);
    assert_eq!(ich["geraet"]["uhs_id"], uhs);
}

/// Wird der Abschnitt eines Abschnittsgeräts aufgelöst, endet die Kopplung wie bei einem
/// Widerruf: die nächste Anfrage ist 401, das ETB nennt das Gerät. Die Ansicht ist noch nicht
/// koppelbar; die Kopplung entsteht deshalb direkt im Repository.
#[tokio::test]
async fn aufgeloester_abschnitt_beendet_seine_kopplung() {
    use lifeline_hub::geraet::repo::{self, NeueKopplung};
    use lifeline_hub::geraet::{Bindungsart, Funktionsansicht, Stelle};

    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        Some(r#"{"name":"EA Nord"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let abschnitt = v["id"].as_i64().unwrap();
    let (admin_id, org_id): (i64, i64) =
        sqlx::query_as("SELECT id, org_id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let kopplung_id = repo::anlegen(
        &mut conn,
        NeueKopplung {
            einsatz_id: einsatz,
            org_id,
            ansicht: Funktionsansicht::Einsatzabschnitt,
            stelle: Some(Stelle {
                art: Bindungsart::Einsatzabschnitt,
                id: abschnitt,
            }),
            stelle_name: Some("EA Nord"),
            bezeichnung: "Tablet EA",
            laeuft_ab_at: "2099-01-01 00:00:00",
            von: admin_id,
        },
    )
    .await
    .unwrap();
    let (code, _) = repo::code_ausstellen(&mut conn, kopplung_id, admin_id)
        .await
        .unwrap();
    drop(conn);
    let a = koppeln(&app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    let geraet = a.cookie.unwrap();
    let (s, ich) = me(&app, &geraet).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ich["geraet"]["stelle_id"], abschnitt);
    assert_eq!(ich["geraet"]["stelle"], "EA Nord");
    assert_eq!(ich["geraet"]["uhs_id"], Value::Null);

    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/abschnitte/{abschnitt}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");

    let (s, _) = me(&app, &geraet).await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "das Gerät verliert sofort jeden Zugriff"
    );
    let widerrufen: Option<String> =
        sqlx::query_scalar("SELECT widerrufen_at FROM geraet_kopplung WHERE id = ?")
            .bind(kopplung_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(widerrufen.is_some(), "Kopplung widerrufen");
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(|t| t.contains("EA Nord · Tablet EA")
            && t.contains("widerrufen")
            && t.contains("aufgelöst")),
        "ETB nennt das Gerät: {etb:?}"
    );
}

// ---------- Abschnittsgerät (LFH-1043) ----------

const ZONE_POLY: &str =
    r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;

async fn abschnitt_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    ueber: Option<i64>,
) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&json!({"name": name, "ueber_abschnitt_id": ueber})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

async fn einheit_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    abschnitt: i64,
) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&json!({"name": name, "abschnitt_id": abschnitt})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// Ein Auftrag an die Empfänger; liefert die Antwort (mit Empfängerzeilen).
async fn auftrag_an(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    text: &str,
    empfaenger: Value,
) -> Value {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/auftraege"),
        cookie,
        Some(&json!({"auftrag_text": text, "empfaenger": empfaenger})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v
}

/// Nord ⊃ Nord-Ost, daneben Süd; je eine Einheit darin.
struct AbschnittsLage {
    einsatz: i64,
    nord: i64,
    ost: i64,
    sued: i64,
    zug_nord: i64,
    zug_ost: i64,
    zug_sued: i64,
}

async fn abschnittslage(app: &axum::Router, admin: &str) -> AbschnittsLage {
    let einsatz = einsatz_anlegen(app, admin).await;
    let nord = abschnitt_anlegen(app, admin, einsatz, "EA Nord", None).await;
    let ost = abschnitt_anlegen(app, admin, einsatz, "UA Nord-Ost", Some(nord)).await;
    let sued = abschnitt_anlegen(app, admin, einsatz, "EA Süd", None).await;
    AbschnittsLage {
        einsatz,
        nord,
        ost,
        sued,
        zug_nord: einheit_anlegen(app, admin, einsatz, "1. Zug", nord).await,
        zug_ost: einheit_anlegen(app, admin, einsatz, "2. Zug", ost).await,
        zug_sued: einheit_anlegen(app, admin, einsatz, "3. Zug", sued).await,
    }
}

/// Ein an `abschnitt` gekoppeltes Abschnittsgerät: `(kopplung_id, geräte-cookie)`.
async fn abschnittsgeraet(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    abschnitt: i64,
) -> (i64, String) {
    let (id, code) = kopplung(
        app,
        admin,
        einsatz,
        json!({"ansicht": "einsatzabschnitt", "stelle_id": abschnitt, "bezeichnung": "Tablet EA"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    (id, a.cookie.expect("Sitzungscookie"))
}

fn namen(v: &Value, feld: &str) -> Vec<String> {
    let mut n: Vec<String> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x[feld].as_str().unwrap().to_string())
        .collect();
    n.sort();
    n
}

#[tokio::test]
async fn abschnittsgeraet_sieht_nur_seinen_teilbaum() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let l = abschnittslage(&app, &admin).await;
    let (_, geraet) = abschnittsgeraet(&app, &admin, l.einsatz, l.nord).await;
    let basis = format!("/api/einsaetze/{}", l.einsatz);

    let (s, v) = anfrage(&app, "GET", &format!("{basis}/abschnitte"), &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(namen(&v, "name"), ["EA Nord", "UA Nord-Ost"]);
    let (s, v) = anfrage(&app, "GET", &format!("{basis}/einheiten"), &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(namen(&v, "name"), ["1. Zug", "2. Zug"]);

    // Einsatzweite Zähler bekommt das Gerät nicht.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("{basis}/modul-zaehler"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for modul in ["einheiten", "einsatzabschnitte", "auftraege", "meldungen"] {
        assert!(v.get(modul).is_none(), "kein Zähler {modul}: {v}");
    }

    // Umgehängt: Nord-Ost unter Süd → das Gerät verliert den Ast sofort.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{basis}/abschnitte/{}", l.ost),
        &admin,
        Some(&json!({"ueber_abschnitt_id": l.sued})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (_, v) = anfrage(&app, "GET", &format!("{basis}/einheiten"), &geraet, None).await;
    assert_eq!(namen(&v, "name"), ["1. Zug"]);

    // Nicht gelistet: 403.
    for (m, p) in [
        ("GET", format!("{basis}/etb")),
        ("GET", format!("{basis}/personen")),
        ("GET", format!("{basis}/uhs")),
        ("GET", format!("{basis}/personal")),
        ("PATCH", format!("{basis}/abschnitte/{}", l.nord)),
        ("PUT", format!("{basis}/einheiten/{}/status", l.zug_nord)),
        ("POST", format!("{basis}/auftraege")),
    ] {
        let (s, _) = anfrage(&app, m, &p, &geraet, Some("{}")).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{m} {p}");
    }
}

#[tokio::test]
async fn abschnittsgeraet_quittiert_und_meldet_nur_eigene_auftraege() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let l = abschnittslage(&app, &admin).await;
    let (_, geraet) = abschnittsgeraet(&app, &admin, l.einsatz, l.nord).await;
    let basis = format!("/api/einsaetze/{}/auftraege", l.einsatz);

    let an_ost = auftrag_an(
        &app,
        &admin,
        l.einsatz,
        "Deich sichern",
        json!([{"empfaenger_typ": "abschnitt", "abschnitt_id": l.ost}]),
    )
    .await;
    let an_sued = auftrag_an(
        &app,
        &admin,
        l.einsatz,
        "Straße sperren",
        json!([{"empfaenger_typ": "einheit", "einheit_id": l.zug_sued}]),
    )
    .await;
    let gemischt = auftrag_an(
        &app,
        &admin,
        l.einsatz,
        "Sandsäcke füllen",
        json!([
            {"empfaenger_typ": "abschnitt", "abschnitt_id": l.sued},
            {"empfaenger_typ": "einheit", "einheit_id": l.zug_ost},
        ]),
    )
    .await;
    let id = |v: &Value| v["id"].as_i64().unwrap();
    let zeile = |v: &Value, schluessel: &str, wert: i64| {
        v["empfaenger"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e[schluessel] == wert)
            .unwrap()["id"]
            .as_i64()
            .unwrap()
    };

    let (s, v) = anfrage(&app, "GET", &basis, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut texte: Vec<&str> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["auftrag_text"].as_str().unwrap())
        .collect();
    texte.sort();
    assert_eq!(texte, ["Deich sichern", "Sandsäcke füllen"]);

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{basis}/{}", id(&an_ost)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{basis}/{}", id(&an_sued)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremder Auftrag");

    // Quittung: die Zeile der eigenen Einheit ja, die von Süd nicht.
    let quittieren = |aid: i64, zid: i64| format!("{basis}/{aid}/empfaenger/{zid}/quittieren");
    let (s, v) = anfrage(
        &app,
        "POST",
        &quittieren(id(&gemischt), zeile(&gemischt, "einheit_id", l.zug_ost)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = anfrage(
        &app,
        "POST",
        &quittieren(id(&gemischt), zeile(&gemischt, "abschnitt_id", l.sued)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde Empfängerzeile");
    let (s, _) = anfrage(
        &app,
        "POST",
        &quittieren(id(&an_sued), zeile(&an_sued, "einheit_id", l.zug_sued)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremder Auftrag");

    // Vollzug: eigener Auftrag ja, fremder 404, abnehmen gar nicht.
    let vollzug = |aid: i64| format!("{basis}/{aid}/vollzug");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &vollzug(id(&an_ost)),
        &geraet,
        Some(&json!({"status": "vollzogen", "vollzugsmeldung": "Deich gesichert"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &vollzug(id(&an_sued)),
        &geraet,
        Some(&json!({"status": "in_arbeit"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{basis}/{}/abnehmen", id(&an_ost)),
        &geraet,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abschnittsgeraet_meldet_mit_eigenem_absender() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let l = abschnittslage(&app, &admin).await;
    let (_, geraet) = abschnittsgeraet(&app, &admin, l.einsatz, l.nord).await;
    let meldungen = format!("/api/einsaetze/{}/meldungen", l.einsatz);
    let meldung = |bezug: Value| {
        let mut m = json!({
            "absender": "EA Nord",
            "meldeweg": "persoenlich",
            "inhalt": "Lage ruhig",
            "ereigniszeit": "2026-10-08 10:00:00",
        });
        m.as_object_mut()
            .unwrap()
            .extend(bezug.as_object().unwrap().clone());
        m
    };

    let (s, v) = anfrage_json(&app, "POST", &meldungen, &geraet, Some(&meldung(json!({})))).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(
        v["abschnitt_id"], l.nord,
        "ohne Angabe der eigene Abschnitt"
    );
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &meldungen,
        &geraet,
        Some(&meldung(json!({"abschnitt_id": l.ost}))),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["abschnitt_id"], l.ost, "Unterabschnitt bleibt");
    for bezug in [
        json!({"abschnitt_id": l.sued}),
        json!({"einheit_id": l.zug_sued}),
    ] {
        let (s, v) = anfrage_json(&app, "POST", &meldungen, &geraet, Some(&meldung(bezug))).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    }
    let _ = l.zug_nord;
}

#[tokio::test]
async fn abschnittsgeraet_sieht_gefahrenzonen_aber_keine_bezirke() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let l = abschnittslage(&app, &admin).await;
    let (_, geraet) = abschnittsgeraet(&app, &admin, l.einsatz, l.nord).await;
    let zonen = format!("/api/einsaetze/{}/zonen", l.einsatz);
    for typ in ["absperrbereich", "evakuierungsbezirk", "freie_skizze"] {
        let (s, v) = anfrage_json(
            &app,
            "POST",
            &zonen,
            &admin,
            Some(&json!({"typ": typ, "geometrie_typ": "Polygon", "geometrie": ZONE_POLY})),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{typ}: {v}");
    }
    let (s, v) = anfrage(&app, "GET", &zonen, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(namen(&v, "typ"), ["absperrbereich"]);
    let (_, v) = anfrage(&app, "GET", &zonen, &admin, None).await;
    assert_eq!(
        v.as_array().unwrap().len(),
        3,
        "die Einsatzleitung sieht alle"
    );
}

/// Widerruf beendet auch ein Abschnittsgerät sofort.
#[tokio::test]
async fn widerrufenes_abschnittsgeraet_verliert_jeden_zugriff() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let l = abschnittslage(&app, &admin).await;
    let (id, geraet) = abschnittsgeraet(&app, &admin, l.einsatz, l.nord).await;
    let einheiten = format!("/api/einsaetze/{}/einheiten", l.einsatz);
    let (s, _) = anfrage(&app, "GET", &einheiten, &geraet, None).await;
    assert_eq!(s, StatusCode::OK);
    widerrufen(&app, &admin, l.einsatz, id).await;
    let (s, _) = anfrage(&app, "GET", &einheiten, &geraet, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn kein_koppeln_am_abgeschlossenen_einsatz() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

// ---------- Code ----------

#[tokio::test]
async fn code_einloesen_gibt_eine_geraetesitzung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    assert_eq!(code.len(), 8);

    // Kleinschreibung und Bindestrich stören nicht.
    let eingabe = format!("{}-{}", &code[..4], &code[4..]).to_lowercase();
    let a = koppeln(&app, &eingabe, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    assert_eq!(a.body["ansicht"], "uhs-tablet");
    let geraet = a.cookie.unwrap();

    let (s, v) = me(&app, &geraet).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["geraet"]["kopplung_id"], id);
    assert_eq!(v["geraet"]["einsatz_id"], einsatz);
    assert_eq!(v["geraet"]["uhs_id"], uhs);
    assert_eq!(v["geraet"]["stelle"], "UHS Nord");
    assert_eq!(v["geraet"]["bezeichnung"], "Tablet 1");
    assert_eq!(v["anzeigename"], "UHS Nord · Tablet 1");

    // Eine Person sieht `geraet: null`.
    let (_, v) = me(&app, &admin).await;
    assert!(v["geraet"].is_null());

    // Die Übersicht zeigt die Kopplung als aktiv.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["kopplungen"][0]["status"], "aktiv");
    assert!(v["kopplungen"][0]["gekoppelt_at"].is_string());
}

#[tokio::test]
async fn code_gilt_nur_einmal() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    assert_eq!(koppeln(&app, &code, None).await.status, StatusCode::OK);
    let zweites = koppeln(&app, &code, None).await;
    assert_eq!(zweites.status, StatusCode::UNAUTHORIZED);
    assert!(zweites.cookie.is_none());
    let sitzungen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session WHERE kopplung_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sitzungen, 1, "keine zweite Sitzung");
}

#[tokio::test]
async fn falscher_und_abgelaufener_code_antworten_gleich() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    sqlx::query("UPDATE geraet_kopplungscode SET laeuft_ab_at = datetime('now', '-1 minute')")
        .execute(&pool)
        .await
        .unwrap();

    let abgelaufen = koppeln(&app, &code, None).await;
    let unbekannt = koppeln(&app, "ZZZZZZZZ", None).await;
    let unform = koppeln(&app, "kurz", None).await;
    for a in [&abgelaufen, &unbekannt, &unform] {
        assert_eq!(a.status, StatusCode::UNAUTHORIZED);
        assert!(a.cookie.is_none());
    }
    assert_eq!(abgelaufen.body, unbekannt.body);
    assert_eq!(unbekannt.body, unform.body);
}

#[tokio::test]
async fn zu_viele_fehlversuche_sperren_die_adresse() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    // Eigene Adresse, damit parallele Tests die globale Sperre nicht teilen.
    let peer: SocketAddr = "203.0.113.92:40000".parse().unwrap();
    for i in 0..10 {
        let a = koppeln(&app, "ZZZZZZZZ", Some(peer)).await;
        assert_eq!(a.status, StatusCode::UNAUTHORIZED, "Versuch {i}");
    }
    let a = koppeln(&app, &code, Some(peer)).await;
    assert_eq!(
        a.status,
        StatusCode::TOO_MANY_REQUESTS,
        "auch für einen richtigen Code"
    );
    // Der Code ist nicht verbraucht: von einer anderen Adresse gilt er.
    let frei: SocketAddr = "203.0.113.93:40000".parse().unwrap();
    assert_eq!(
        koppeln(&app, &code, Some(frei)).await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn neuer_code_beendet_das_alte_geraet() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, erstes) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/code"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Bis zur Einlösung arbeitet das alte Gerät weiter.
    assert_eq!(me(&app, &erstes).await.0, StatusCode::OK);

    let zweites = koppeln(&app, v["code"]["code"].as_str().unwrap(), None).await;
    assert_eq!(zweites.status, StatusCode::OK);
    assert_eq!(me(&app, &erstes).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(me(&app, &zweites.cookie.unwrap()).await.0, StatusCode::OK);
}

// ---------- Ende der Kopplung ----------

#[tokio::test]
async fn abgelaufene_kopplung_ist_401() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, geraet) = tablet(&app, &admin, einsatz, uhs).await;
    assert_eq!(me(&app, &geraet).await.0, StatusCode::OK);

    sqlx::query(
        "UPDATE geraet_kopplung SET laeuft_ab_at = datetime('now', '-1 minute') WHERE id = ?",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(me(&app, &geraet).await.0, StatusCode::UNAUTHORIZED);
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(v["kopplungen"][0]["status"], "abgelaufen");
}

#[tokio::test]
async fn verlaengern_hebt_das_ende_an() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, _) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    let ende = (chrono::Utc::now() + chrono::Duration::hours(48))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/verlaengern"),
        &admin,
        Some(&json!({"laeuft_ab_at": ende})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["laeuft_ab_at"], ende);

    let zu_weit = (chrono::Utc::now() + chrono::Duration::hours(80))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete/{id}/verlaengern"),
        &admin,
        Some(&json!({"laeuft_ab_at": zu_weit})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn einsatzabschluss_beendet_jede_kopplung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;
    let mut strom = live_geraet(&app, &geraet, einsatz).await;

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        strom_endet(&mut strom).await,
        "Live-Kanal endet mit dem Abschluss"
    );
    assert_eq!(me(&app, &geraet).await.0, StatusCode::UNAUTHORIZED);
}

/// Öffnet den Live-Kanal eines Geräts und liefert den offenen Body.
async fn live_geraet(app: &axum::Router, cookie: &str, einsatz: i64) -> Body {
    let resp = common::live_oeffnen(app, cookie, einsatz).await;
    resp.into_body()
}

/// Liest den Strom, bis er endet (`true`) oder 3 s lang offen bleibt (`false`). Gelesene
/// Ereignisnamen landen in `ereignisse`.
async fn strom_lesen(body: &mut Body, ereignisse: &mut Vec<String>, frist: Duration) -> bool {
    use http_body_util::BodyExt;
    let ende = tokio::time::Instant::now() + frist;
    loop {
        let rest = ende.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(rest, std::pin::Pin::new(&mut *body).frame()).await {
            Err(_) => return false,
            Ok(None) => return true,
            Ok(Some(Err(_))) => return true,
            Ok(Some(Ok(frame))) => {
                if let Some(daten) = frame.data_ref() {
                    for zeile in String::from_utf8_lossy(daten).lines() {
                        if let Some(name) = zeile.strip_prefix("event:") {
                            ereignisse.push(name.trim().to_string());
                        }
                    }
                }
            }
        }
    }
}

async fn strom_endet(body: &mut Body) -> bool {
    strom_lesen(body, &mut Vec::new(), Duration::from_secs(3)).await
}

#[tokio::test]
async fn widerruf_schliesst_den_offenen_kanal_und_sperrt_die_naechste_anfrage() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, geraet) = tablet(&app, &admin, einsatz, uhs).await;
    let (_, monitor_code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    let monitor = koppeln(&app, &monitor_code, None).await.cookie.unwrap();

    let mut strom = live_geraet(&app, &geraet, einsatz).await;
    let mut monitor_strom = live_geraet(&app, &monitor, einsatz).await;
    // Der Strom ist offen, solange niemand widerruft.
    assert!(!strom_lesen(&mut strom, &mut Vec::new(), Duration::from_millis(300)).await);

    widerrufen(&app, &admin, einsatz, id).await;
    assert!(
        strom_endet(&mut strom).await,
        "der Server schließt den Kanal"
    );
    assert_eq!(me(&app, &geraet).await.0, StatusCode::UNAUTHORIZED);

    // Das andere Gerät arbeitet weiter.
    assert!(
        !strom_lesen(
            &mut monitor_strom,
            &mut Vec::new(),
            Duration::from_millis(300)
        )
        .await,
        "der Kanal des Monitors bleibt offen"
    );
    assert_eq!(me(&app, &monitor).await.0, StatusCode::OK);

    // Ein zweiter Widerruf ändert nichts und schreibt keinen zweiten Eintrag.
    widerrufen(&app, &admin, einsatz, id).await;
    let widerrufe = system_etb_inhalte(&app, &admin, einsatz)
        .await
        .into_iter()
        .filter(|t| t.contains("widerrufen"))
        .count();
    assert_eq!(widerrufe, 1);
}

#[tokio::test]
async fn live_kanal_des_tablets_traegt_kein_etb() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let mut tablet_strom = live_geraet(&app, &geraet, einsatz).await;
    let mut admin_strom = live_geraet(&app, &admin, einsatz).await;
    let etb_id: i64 = sqlx::query_scalar("SELECT MAX(id) FROM etb_eintrag WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    live.publiziere(einsatz, etb_id);

    let mut beim_admin = Vec::new();
    strom_lesen(
        &mut admin_strom,
        &mut beim_admin,
        Duration::from_millis(500),
    )
    .await;
    assert!(
        beim_admin.iter().any(|e| e == "etb"),
        "Gegenprobe: {beim_admin:?}"
    );
    let mut beim_tablet = Vec::new();
    strom_lesen(
        &mut tablet_strom,
        &mut beim_tablet,
        Duration::from_millis(500),
    )
    .await;
    assert!(!beim_tablet.iter().any(|e| e == "etb"), "{beim_tablet:?}");
}

// ---------- Schranke ----------

#[tokio::test]
async fn geraet_erreicht_nur_gelistete_routen_seines_einsatzes() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Anderer").await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Einsatzkopf ist gelistet");

    for (methode, uri) in [
        ("GET", format!("/api/einsaetze/{einsatz}/etb")),
        ("GET", format!("/api/einsaetze/{einsatz}/geraete")),
        ("GET", "/api/einsaetze".to_string()),
        ("GET", "/api/benutzer".to_string()),
        ("POST", format!("/api/einsaetze/{einsatz}/abschliessen")),
        ("GET", "/api/live".to_string()),
    ] {
        let (s, _) = anfrage(&app, methode, &uri, &geraet, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {uri}");
    }

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{anderer}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "anderer Einsatz");
}

#[tokio::test]
async fn modulfreigaben_des_geraets_folgen_der_ansicht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-freigaben"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Antwort: Modul-Key → Freigabe.
    let sichtbar: Vec<&String> = v
        .as_object()
        .unwrap()
        .iter()
        .filter(|(_, f)| f["sichtbar"] == true)
        .map(|(k, _)| k)
        .collect();
    assert!(!sichtbar.is_empty(), "{v}");
    for m in sichtbar {
        assert!(
            ["unfallhilfsstellen", "personen"].contains(&m.as_str()),
            "Modul {m} gehört nicht zum Tablet: {v}"
        );
    }
}

#[tokio::test]
async fn modulfreigabe_sperrt_zusaetzlich() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (_, geraet) = tablet(&app, &admin, einsatz, uhs).await;

    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/personen"),
        &admin,
        Some(&json!({"sichtbar": true, "benoetigte_rolle": "fuehrungskraft"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-freigaben"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(v["personen"]["zugriff"], false, "{v}");
    assert_eq!(v["unfallhilfsstellen"]["zugriff"], true, "{v}");

    // Die Kopplungsmaske nennt die Sperre vorab.
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        None,
    )
    .await;
    let tablet = v["sperren"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["ansicht"] == "uhs-tablet")
        .unwrap();
    assert_eq!(tablet["gesperrte_module"], json!(["personen"]));
}

// ---------- Gerätekonto ----------

#[tokio::test]
async fn geraetekonto_ist_keine_person() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, _) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"}),
    )
    .await;
    let (konto, benutzername) = geraetekonto(&pool, id).await;

    let (s, v) = anfrage(&app, "GET", "/api/benutzer", &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        v.as_array().unwrap().iter().all(|b| b["id"] != konto),
        "Benutzerliste ohne Gerätekonto: {v}"
    );
    for (methode, uri, body) in [
        (
            "PATCH",
            format!("/api/benutzer/{konto}"),
            Some(r#"{"anzeigename":"X"}"#),
        ),
        ("POST", format!("/api/benutzer/{konto}/deaktivieren"), None),
        ("POST", format!("/api/benutzer/{konto}/totp/reset"), None),
        (
            "PUT",
            format!("/api/einsaetze/{einsatz}/mitglieder/{konto}"),
            Some(r#"{"einsatz_rolle":"fuehrungspersonal"}"#),
        ),
    ] {
        let (s, v) = anfrage(&app, methode, &uri, &admin, body).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {uri}: {v}");
    }

    // Passwortanmeldung scheitert wie mit falschem Passwort.
    let falsch = anfrage(
        &app,
        "POST",
        "/api/auth/login",
        "",
        Some(&json!({"benutzername": "admin", "passwort": "falsch"}).to_string()),
    )
    .await;
    let geraet = anfrage(
        &app,
        "POST",
        "/api/auth/login",
        "",
        Some(&json!({"benutzername": benutzername, "passwort": "irgendwas"}).to_string()),
    )
    .await;
    assert_eq!(geraet.0, StatusCode::UNAUTHORIZED);
    assert_eq!(geraet, falsch);
}

// ---------- Audit ----------

#[tokio::test]
async fn kopplung_ist_auditiert() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;
    let (id, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "uhs-tablet", "uhs_id": uhs, "bezeichnung": "Tablet 1"}),
    )
    .await;
    let (konto, _) = geraetekonto(&pool, id).await;
    let peer: SocketAddr = "203.0.113.94:40000".parse().unwrap();
    sqlx::query("DELETE FROM auth_audit")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        koppeln(&app, "ZZZZZZZZ", Some(peer)).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        koppeln(&app, &code, Some(peer)).await.status,
        StatusCode::OK
    );
    widerrufen(&app, &admin, einsatz, id).await;

    let audit: Vec<(String, String, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT ereignis, provider, benutzer_id, peer_ip FROM auth_audit ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let ip = Some("203.0.113.94".to_string());
    assert_eq!(
        audit,
        [
            (
                "login_fehlgeschlagen".into(),
                "geraetecode".into(),
                None,
                ip.clone()
            ),
            ("login_ok".into(), "geraetecode".into(), Some(konto), ip),
        ]
    );

    let spur: Vec<String> = sqlx::query_scalar(
        "SELECT ereignis FROM geraet_kopplung_ereignis WHERE kopplung_id = ? ORDER BY id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        spur,
        ["angelegt", "code_ausgestellt", "eingeloest", "widerrufen"]
    );

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let system: Vec<(&str, &str)> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| {
            (
                e["inhalt"].as_str().unwrap(),
                e["erfasser_name"].as_str().unwrap(),
            )
        })
        .collect();
    let finde = |wort: &str| {
        system
            .iter()
            .find(|(t, _)| t.contains("UHS Nord · Tablet 1") && t.contains(wort))
            .unwrap_or_else(|| panic!("kein ETB-Eintrag „{wort}“: {system:?}"))
    };
    finde("angelegt");
    assert_eq!(
        finde("gekoppelt").1,
        "UHS Nord · Tablet 1",
        "Erfasser ist das Gerät"
    );
    assert!(finde("widerrufen").0.contains("widerrufen von"));
}

// ---------- Stellenbindung (Subtask UHS-Tablet) ----------

/// Zwei aktive UHS und ein Tablet der ersten: `(einsatz, nord, sued, tablet-cookie)`.
async fn zwei_uhs_mit_tablet(app: &axum::Router, admin: &str) -> (i64, i64, i64, String) {
    let einsatz = einsatz_anlegen(app, admin).await;
    let nord = uhs_anlegen(app, admin, einsatz, "UHS Nord").await;
    let sued = uhs_anlegen(app, admin, einsatz, "UHS Süd").await;
    let (_, geraet) = tablet(app, admin, einsatz, nord).await;
    (einsatz, nord, sued, geraet)
}

/// Person mit Eintritt in `uhs` (Aufnahme in einem Schritt), angelegt von `cookie`.
async fn person_in(app: &axum::Router, cookie: &str, einsatz: i64, uhs: Option<i64>) -> Value {
    let mut body = json!({"name": "Muster", "vorname": "Max"});
    if let Some(u) = uhs {
        body["uhs_id"] = json!(u);
    }
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v
}

#[tokio::test]
async fn tablet_kennt_nur_die_eigene_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ids: Vec<i64> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![nord], "UHS-Liste nur mit der eigenen UHS");

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["material"], json!([]), "Das Tablet liest kein Material");

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{sued}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde UHS");

    // Der Personenzähler zählt den ganzen Einsatz und fehlt deshalb am Tablet.
    person_in(&app, &admin, einsatz, Some(sued)).await;
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-zaehler"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("personen").is_none(), "{v}");
}

#[tokio::test]
async fn tablet_setzt_verfuegbarkeit_aber_bearbeitet_den_grundriss_nicht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let platz = |uhs: i64| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            let (s, v) = anfrage_json(
                &app,
                "POST",
                &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze"),
                &admin,
                Some(&json!({"typ": "bett", "bezeichnung": "B1"})),
            )
            .await;
            assert_eq!(s, StatusCode::CREATED, "{v}");
            v["id"].as_i64().unwrap()
        }
    };
    let platz_nord = platz(nord).await;
    let platz_sued = platz(sued).await;

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}/plaetze"),
        &geraet,
        Some(&json!({"typ": "bett", "bezeichnung": "B2"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Grundriss bearbeiten: {v}");

    let verfuegbarkeit = |uhs: i64, pid: i64| {
        format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze/{pid}/verfuegbarkeit")
    };
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &verfuegbarkeit(nord, platz_nord),
        &geraet,
        Some(&json!({"verfuegbarkeit": "gesperrt"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "eigene UHS: {v}");
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &verfuegbarkeit(sued, platz_sued),
        &geraet,
        Some(&json!({"verfuegbarkeit": "gesperrt"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde UHS");
}

#[tokio::test]
async fn aufnahme_am_tablet_steht_im_eingang_der_eigenen_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;

    // Ohne Angabe bucht der Server in die eigene UHS, im selben Schritt.
    let p = person_in(&app, &geraet, einsatz, None).await;
    assert_eq!(p["aktuelle_uhs_id"], json!(nord), "{p}");
    assert_eq!(
        p["aktueller_platz_id"],
        Value::Null,
        "Eingang ohne Platz: {p}"
    );

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        v.as_array().unwrap().iter().any(|x| x["id"] == p["id"]),
        "in der Patientenliste des Tablets: {v}"
    );

    // Eine andere UHS lässt das Tablet nicht zu.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        Some(&json!({"name": "Fremd", "uhs_id": sued})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
}

#[tokio::test]
async fn aufnahme_scheitert_ganz_wenn_der_eintritt_scheitert() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}/status"),
        &admin,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let vorher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        Some(&json!({"name": "Muster"})),
    )
    .await;
    assert!(
        s.is_client_error(),
        "aufgelöste UHS nimmt niemanden auf: {s} {v}"
    );
    let nachher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(nachher, vorher, "keine Person ohne Eintritt");
}

#[tokio::test]
async fn person_der_anderen_uhs_ist_fuer_das_tablet_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let fremd = person_in(&app, &admin, einsatz, Some(sued)).await;
    let ohne = person_in(&app, &admin, einsatz, None).await;

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(liste, json!([]), "keine fremde Person in der Liste");

    for p in [&fremd, &ohne] {
        let pid = p["id"].as_i64().unwrap();
        let basis = format!("/api/einsaetze/{einsatz}/personen/{pid}");
        for (methode, uri, body) in [
            ("GET", basis.clone(), None),
            ("PATCH", basis.clone(), Some(json!({"name": "X"}))),
            (
                "POST",
                format!("{basis}/sichtung"),
                Some(json!({"kategorie": "sk2"})),
            ),
            (
                "POST",
                format!("{basis}/verbleib"),
                Some(json!({"art": "entlassung"})),
            ),
            (
                "POST",
                format!("{basis}/notizen"),
                Some(json!({"text": "x"})),
            ),
            (
                "POST",
                format!("{basis}/uhs-belegung"),
                Some(json!({"art": "austritt"})),
            ),
        ] {
            let (s, v) = anfrage_json(&app, methode, &uri, &geraet, body.as_ref()).await;
            assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {uri}: {v}");
        }
    }
}

#[tokio::test]
async fn tablet_bucht_nicht_in_eine_fremde_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let p = person_in(&app, &geraet, einsatz, None).await;
    let pid = p["id"].as_i64().unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &geraet,
        Some(&json!({"art": "wechsel", "uhs_id": sued})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Wechsel in die UHS Süd: {v}");

    // Die Einsatzleitung verlegt die Person; danach nimmt das Tablet sie nicht mehr heraus.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &admin,
        Some(&json!({"art": "wechsel", "uhs_id": sued})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &geraet,
        Some(&json!({"art": "austritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Austritt aus der UHS Süd: {v}");
}

#[tokio::test]
async fn tablet_traegt_den_verbleib_nach_dem_austritt_ein() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let p = person_in(&app, &geraet, einsatz, None).await;
    let pid = p["id"].as_i64().unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/uhs-belegung"),
        &geraet,
        Some(&json!({"art": "austritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Austritt aus der eigenen UHS: {v}");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/verbleib"),
        &geraet,
        Some(&json!({"art": "transport", "ziel": "KH Mitte"})),
    )
    .await;
    assert!(s.is_success(), "Verbleib nach Austritt: {s} {v}");
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["abgleiche"], json!([]), "kein Abgleich am Gerät");
}

// ---------- UHS-Laptop (Subtask LFH-1025) ----------

/// Ein gekoppelter UHS-Laptop: Geräte-Cookie.
async fn laptop(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64) -> String {
    let (_, code) = kopplung(
        app,
        cookie,
        einsatz,
        json!({"ansicht": "uhs-laptop", "uhs_id": uhs, "bezeichnung": "Laptop 1"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    a.cookie.expect("Sitzungscookie")
}

#[tokio::test]
async fn laptop_bearbeitet_grundriss_und_stammdaten_der_eigenen_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let geraet = laptop(&app, &admin, einsatz, nord).await;
    let plaetze = |uhs: i64| format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plaetze");

    // Platz anlegen: Laptop ja, Tablet nein, fremde UHS 404.
    let neu = json!({"typ": "bett", "bezeichnung": "B1"});
    let (s, v) = anfrage_json(&app, "POST", &plaetze(nord), &geraet, Some(&neu)).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let platz = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(&app, "POST", &plaetze(nord), &tablet, Some(&neu)).await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Tablet bearbeitet den Grundriss nicht"
    );
    let (s, _) = anfrage_json(&app, "POST", &plaetze(sued), &geraet, Some(&neu)).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde UHS");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{}/bulk", plaetze(nord)),
        &geraet,
        Some(&json!({"typ": "bett", "menge": 2})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/{platz}", plaetze(nord)),
        &geraet,
        Some(&json!({"bezeichnung": "Liege 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{platz}", plaetze(nord)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    // Stammdaten der eigenen UHS, nicht der fremden.
    let stamm = json!({"standort": "Halle 2"});
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}"),
        &geraet,
        Some(&stamm),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["standort"], "Halle 2");
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/uhs/{sued}"),
        &geraet,
        Some(&stamm),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde UHS");
}

#[tokio::test]
async fn laptop_wechselt_den_uhs_status_nicht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, _sued, _tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let geraet = laptop(&app, &admin, einsatz, nord).await;

    let verboten: [(&str, String, Option<Value>); 4] = [
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/uhs/{nord}/status"),
            Some(json!({"status": "aufgeloest"})),
        ),
        (
            "DELETE",
            format!("/api/einsaetze/{einsatz}/uhs/{nord}"),
            None,
        ),
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/uhs"),
            Some(json!({"typ": "behandlungsplatz", "bezeichnung": "UHS West"})),
        ),
        (
            "GET",
            format!("/api/einsaetze/{einsatz}/uhs/{nord}/anhaenge/zugriffe"),
            None,
        ),
    ];
    for (methode, pfad, body) in verboten {
        let (s, v) = anfrage_json(&app, methode, &pfad, &geraet, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {pfad}: {v}");
    }
}

#[tokio::test]
async fn laptop_liest_material_und_anhaenge_der_eigenen_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let geraet = laptop(&app, &admin, einsatz, nord).await;

    let (s, v) = anfrage_json(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(&json!({"bezeichnung": "Wolldecke", "kategorie": "Betreuung"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&json!({"material_id": v["id"], "menge": 20})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{}", v["id"]),
        &admin,
        Some(&json!({"uhs_id": nord})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let detail = format!("/api/einsaetze/{einsatz}/uhs/{nord}");
    let (s, v) = anfrage(&app, "GET", &detail, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["material"].as_array().unwrap().len(), 1, "{v}");
    let (_, v) = anfrage(&app, "GET", &detail, &tablet, None).await;
    assert_eq!(v["material"], json!([]), "Tablet liest kein Material");

    let anhaenge = |uhs: i64| format!("/api/einsaetze/{einsatz}/uhs/{uhs}/anhaenge");
    let (s, v) = anfrage(&app, "GET", &anhaenge(nord), &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = anfrage(&app, "GET", &anhaenge(sued), &geraet, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremde UHS");
    let (s, _) = anfrage(&app, "GET", &anhaenge(nord), &tablet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Tablet liest keine Anhänge");
}

/// Status eines `GET` auf das Plan-Bild (ohne JSON-Antwort).
async fn plan_bild_status(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz}/uhs/{uhs}/plan/bild"))
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// LFH-999: das Tablet sieht den Plan seiner UHS, ändert ihn aber nicht; der Laptop setzt ihn.
#[tokio::test]
async fn tablet_sieht_den_plan_laptop_setzt_ihn() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let geraet = laptop(&app, &admin, einsatz, nord).await;
    let bild = png_bytes(40, 30);

    let (s, v) = plan_hochladen(&app, einsatz, nord, &geraet, "halle.png", &bild).await;
    assert_eq!(s, StatusCode::OK, "Laptop setzt den Plan: {v}");
    let (s, v) = plan_hochladen(&app, einsatz, sued, &admin, "halle.png", &bild).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = plan_hochladen(&app, einsatz, sued, &geraet, "halle.png", &bild).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Laptop: fremde UHS");

    assert_eq!(
        plan_bild_status(&app, &tablet, einsatz, nord).await,
        StatusCode::OK
    );
    assert_eq!(
        plan_bild_status(&app, &tablet, einsatz, sued).await,
        StatusCode::NOT_FOUND,
        "fremde UHS"
    );
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}"),
        &tablet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["plan"]["bild_breite"], 40, "Detail trägt den Plan: {v}");

    let (s, _) = plan_hochladen(&app, einsatz, nord, &tablet, "halle.png", &bild).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Tablet hinterlegt nicht");
    let plan = format!("/api/einsaetze/{einsatz}/uhs/{nord}/plan");
    let (s, _) = anfrage(&app, "PATCH", &plan, &tablet, Some(r#"{"x":20}"#)).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Tablet ändert nicht");
    let (s, _) = anfrage(&app, "DELETE", &plan, &tablet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Tablet entfernt nicht");
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{plan}/aus-anhang"),
        &tablet,
        Some(r#"{"anhang_id":1}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Tablet übernimmt nicht");
    let (s, v) = anfrage(&app, "PATCH", &plan, &geraet, Some(r#"{"x":20}"#)).await;
    assert_eq!(s, StatusCode::OK, "Laptop ändert: {v}");
}

#[tokio::test]
async fn laptop_meldet_und_liest_nur_eigene_meldungen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, _sued, tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let geraet = laptop(&app, &admin, einsatz, nord).await;
    let meldungen = format!("/api/einsaetze/{einsatz}/meldungen");
    let meldung = |inhalt: &str| {
        json!({
            "absender": "UHS Nord",
            "meldeweg": "persoenlich",
            "inhalt": inhalt,
            "ereigniszeit": "2026-10-04 10:00:00",
        })
    };

    let (s, v) = anfrage_json(&app, "POST", &meldungen, &admin, Some(&meldung("Lage"))).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &meldungen,
        &geraet,
        Some(&meldung("Decken knapp")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let (s, v) = anfrage(&app, "GET", &meldungen, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let inhalte: Vec<&str> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["inhalt"].as_str().unwrap())
        .collect();
    assert_eq!(inhalte, vec!["Decken knapp"], "nur die eigene Meldung");

    let (s, _) = anfrage(&app, "GET", &meldungen, &tablet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Tablet liest keine Meldungen");
}

/// LFH-940, D5: die Gerätebindung steht im SQL, nicht hinter dem LIMIT. Sonst wäre die erste
/// Seite der Abgeschlossenen für das Gerät leer, obwohl es eigene erledigte Meldungen hat.
#[tokio::test]
async fn laptop_blaettert_nur_durch_eigene_abgeschlossene_meldungen() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, _sued, _tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let geraet = laptop(&app, &admin, einsatz, nord).await;
    let meldungen = format!("/api/einsaetze/{einsatz}/meldungen");
    let meldung = |inhalt: String| {
        json!({
            "absender": "UHS Nord",
            "meldeweg": "persoenlich",
            "inhalt": inhalt,
            "ereigniszeit": "2026-10-04 10:00:00",
        })
    };
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &meldungen,
        &geraet,
        Some(&meldung("Eigene".into())),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let eigene = v["id"].as_i64().unwrap();
    for i in 0..3 {
        let (s, v) = anfrage_json(
            &app,
            "POST",
            &meldungen,
            &admin,
            Some(&meldung(format!("Fremd {i}"))),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    // Die eigene ist am frühesten erledigt und läge ohne Bindung im SQL nicht auf Seite 1.
    sqlx::query(
        "UPDATE meldung SET status = 'erledigt', \
         erledigt_at = CASE WHEN id = ? THEN '2026-10-04 11:00:00' ELSE '2026-10-04 12:00:00' END \
         WHERE einsatz_id = ?",
    )
    .bind(eigene)
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("{meldungen}?phase=abgeschlossen&limit=1"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let seite: Vec<i64> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_i64().unwrap())
        .collect();
    assert_eq!(
        seite,
        vec![eigene],
        "erste Seite des Geräts trägt seine Meldung"
    );
}

async fn lagemonitor(app: &axum::Router, cookie: &str, einsatz: i64) -> String {
    let (_, code) = kopplung(
        app,
        cookie,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor Stab"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    a.cookie.expect("Sitzungscookie")
}

#[tokio::test]
async fn lagemonitor_antwort_traegt_keine_personen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let monitor = lagemonitor(&app, &admin, einsatz).await;
    for _ in 0..3 {
        person_in(&app, &admin, einsatz, Some(nord)).await;
    }
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &admin,
        Some(&json!({"name": "Vermisstfrau", "vorname": "Vera", "status": "vermisst"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let lagebild = format!("/api/einsaetze/{einsatz}/lagemonitor");

    let (s, v) = anfrage(&app, "GET", &lagebild, &monitor, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Spec `lagemonitor`, „Belegung einer UHS“: drei Personen in der UHS Nord → 3.
    let uhs = v["uhs"].as_array().unwrap();
    let zahl = |id: i64| uhs.iter().find(|u| u["id"] == id).unwrap()["belegt"].clone();
    assert_eq!(zahl(nord), json!(3));
    assert_eq!(zahl(sued), json!(0));
    assert_eq!(v["betroffene"]["gesamt"], json!(4));
    assert_eq!(v["betroffene"]["vermisst"], json!(1));
    // Keine Namen und keine Personenkennungen in der Antwort.
    let text = v.to_string();
    for name in ["Muster", "Max", "Vermisstfrau", "Vera"] {
        assert!(!text.contains(name), "Name {name} in der Antwort: {text}");
    }
    for schluessel in ["person_id", "personen", "registrier_nr", "name", "vorname"] {
        assert!(
            !text.contains(&format!("\"{schluessel}\"")),
            "Feld {schluessel} in der Antwort: {text}"
        );
    }

    // Auch der Einsatzkopf trägt keine Freitexte, die Personen nennen können.
    let kopf = format!("/api/einsaetze/{einsatz}");
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &kopf,
        &admin,
        Some(&json!({
            "sachverhalt": "Herr Muster gestürzt",
            "meldende_stelle": "Frau Vera",
            "einsatzort": "Musterweg 3, bei Familie Muster",
            "einsatzort_lat": 52.5,
            "einsatzort_lon": 13.4,
        })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = anfrage(&app, "GET", &kopf, &monitor, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(
        v["sachverhalt"].is_null() && v["meldende_stelle"].is_null() && v["einsatzort"].is_null(),
        "{v}"
    );
    // Die Karte braucht nur den Punkt.
    assert_eq!(v["einsatzort_lat"], json!(52.5), "{v}");
    let (_, v) = anfrage(&app, "GET", &kopf, &admin, None).await;
    assert_eq!(
        v["sachverhalt"],
        json!("Herr Muster gestürzt"),
        "Personen sehen ihn"
    );

    // Nur der Lagemonitor: Person und Tablet bekommen das verdichtete Lagebild nicht.
    let (s, _) = anfrage(&app, "GET", &lagebild, &admin, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Person");
    let (s, _) = anfrage(&app, "GET", &lagebild, &tablet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Tablet");

    // Der Monitor liest keine Personen und keine UHS-Detailseite und schreibt nichts.
    for (m, pfad, body) in [
        ("GET", format!("/api/einsaetze/{einsatz}/personen"), None),
        ("GET", format!("/api/einsaetze/{einsatz}/uhs/{nord}"), None),
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/personen"),
            Some(json!({"name": "X"})),
        ),
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/uhs/{nord}/status"),
            Some(json!({"status": "aufgeloest"})),
        ),
    ] {
        let (s, _) = anfrage_json(&app, m, &pfad, &monitor, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{m} {pfad}");
    }
}

// ---------- Bediener am Gerät (LFH-1046) ----------

/// Ad-hoc-Kraft im Einsatz; liefert die Kennung in `einsatz_personal`.
async fn kraft(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&json!({"adhoc": {"name": name, "funktion": "Notärztin"}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// POST mit Geräte-Cookie; liefert Status, Body und ob die Antwort ein Cookie setzt.
async fn post_roh(
    app: &axum::Router,
    cookie: &str,
    uri: &str,
    body: Value,
) -> (StatusCode, Value, bool) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let setzt_cookie = resp.headers().contains_key(header::SET_COOKIE);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        setzt_cookie,
    )
}

/// System-Einträge des ETB als `(inhalt, erfasser_name)`.
async fn system_etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<(String, String)> {
    let (_, etb) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    etb.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| {
            (
                e["inhalt"].as_str().unwrap().to_string(),
                e["erfasser_name"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[tokio::test]
async fn bestaetigte_sichtung_nennt_geraet_stelle_und_person() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let aerztin = kraft(&app, &admin, einsatz, "Dr. A. Muster").await;
    let p = person_in(&app, &geraet, einsatz, None).await;
    let pid = p["id"].as_i64().unwrap();

    let (s, v, setzt_cookie) = post_roh(
        &app,
        &geraet,
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/sichtung"),
        json!({"kategorie": "sk2", "bestaetigt_personal_id": aerztin}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["bestaetigt_name"], "Dr. A. Muster");
    assert!(!setzt_cookie, "Die Bestätigung legt keine Sitzung an");

    let etb = system_etb(&app, &admin, einsatz).await;
    let eintrag = etb
        .iter()
        .find(|(t, _)| t.contains("Sichtung SK II"))
        .unwrap_or_else(|| panic!("{etb:?}"));
    assert!(
        eintrag.0.ends_with(", bestätigt: Dr. A. Muster"),
        "{eintrag:?}"
    );
    assert_eq!(eintrag.1, "UHS Nord · Tablet 1", "Erfasser ist das Gerät");

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["sichtungen"][0]["bestaetigt_name"], "Dr. A. Muster");
}

#[tokio::test]
async fn bestaetigter_verbleib_und_erst_sichtung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let aerztin = kraft(&app, &admin, einsatz, "Dr. A. Muster").await;

    let (s, p) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        Some(&json!({"sichtung": "sk1", "bestaetigt_personal_id": aerztin})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    let pid = p["id"].as_i64().unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/verbleib"),
        &geraet,
        Some(&json!({"art": "transport", "bestaetigt_personal_id": aerztin})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["bestaetigt_name"], "Dr. A. Muster");

    let etb = system_etb(&app, &admin, einsatz).await;
    for wort in ["Sichtung SK I", "abtransportiert"] {
        let eintrag = etb
            .iter()
            .find(|(t, _)| t.contains(wort))
            .unwrap_or_else(|| panic!("{wort}: {etb:?}"));
        assert!(
            eintrag.0.ends_with(", bestätigt: Dr. A. Muster"),
            "{eintrag:?}"
        );
        assert_eq!(eintrag.1, "UHS Nord · Tablet 1");
    }

    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(v["sichtungen"][0]["bestaetigt_name"], "Dr. A. Muster");
    assert_eq!(v["verbleib"][0]["bestaetigt_name"], "Dr. A. Muster");

    // Ohne Erst-Sichtung gibt es nichts zu bestätigen.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        Some(&json!({"bestaetigt_personal_id": aerztin})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn sichtung_ohne_bestaetigung_bleibt_wie_bisher() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let pid = person_in(&app, &geraet, einsatz, None).await["id"]
        .as_i64()
        .unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/sichtung"),
        &geraet,
        Some(&json!({"kategorie": "sk3"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert!(v.get("bestaetigt_name").is_none(), "{v}");
    let etb = system_etb(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|(t, e)| t.ends_with("Sichtung SK III") && e == "UHS Nord · Tablet 1"),
        "{etb:?}"
    );
}

#[tokio::test]
async fn bestaetigung_prueft_einsatz_und_sitzungsart() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let fremde_kraft = kraft(&app, &admin, anderer, "Fremd").await;
    let eigene_kraft = kraft(&app, &admin, einsatz, "Eigen").await;
    let pid = person_in(&app, &geraet, einsatz, None).await["id"]
        .as_i64()
        .unwrap();
    let anzahl = || async {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM person_sichtung WHERE person_id = ?")
            .bind(pid)
            .fetch_one(&pool)
            .await
            .unwrap()
    };

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/sichtung"),
        &geraet,
        Some(&json!({"kategorie": "sk2", "bestaetigt_personal_id": fremde_kraft})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Personal eines anderen Einsatzes"
    );
    assert_eq!(anzahl().await, 0, "keine Sichtung gespeichert");

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/sichtung"),
        &admin,
        Some(&json!({"kategorie": "sk2", "bestaetigt_personal_id": eigene_kraft})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Personensitzung");
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/verbleib"),
        &admin,
        Some(&json!({"art": "vor_ort", "bestaetigt_personal_id": eigene_kraft})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Personensitzung, Verbleib"
    );
    assert_eq!(anzahl().await, 0);
}

#[tokio::test]
async fn bestaetigung_erweitert_die_rechte_des_geraets_nicht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let aerztin = kraft(&app, &admin, einsatz, "Dr. A. Muster").await;
    let pid = person_in(&app, &geraet, einsatz, None).await["id"]
        .as_i64()
        .unwrap();
    let (s, _, _) = post_roh(
        &app,
        &geraet,
        &format!("/api/einsaetze/{einsatz}/personen/{pid}/sichtung"),
        json!({"kategorie": "sk2", "bestaetigt_personal_id": aerztin}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    // Außerhalb der Ansicht weiter 403, die fremde UHS weiter 404, das Gerät bleibt das Gerät.
    for (methode, pfad) in [
        ("GET", format!("/api/einsaetze/{einsatz}/etb")),
        ("GET", format!("/api/einsaetze/{einsatz}/personal")),
        ("GET", format!("/api/einsaetze/{einsatz}/personen/export")),
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/uhs/{nord}/status"),
        ),
    ] {
        let (s, v) = anfrage(&app, methode, &pfad, &geraet, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {pfad}: {v}");
    }
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{sued}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, v) = me(&app, &geraet).await;
    assert_eq!(s, StatusCode::OK);
    assert!(!v["geraet"].is_null(), "weiter eine Gerätesitzung: {v}");
}

#[tokio::test]
async fn auswahl_der_bestaetigenden_nur_fuer_uhs_geraete() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _nord, _sued, geraet) = zwei_uhs_mit_tablet(&app, &admin).await;
    kraft(&app, &admin, einsatz, "Zander").await;
    kraft(&app, &admin, einsatz, "Dr. A. Muster").await;
    let pfad = format!("/api/einsaetze/{einsatz}/personen/bestaetiger");

    let (s, v) = anfrage(&app, "GET", &pfad, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let namen: Vec<&str> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["name"].as_str().unwrap())
        .collect();
    assert_eq!(namen, ["Dr. A. Muster", "Zander"]);
    assert_eq!(v[0]["funktion"], "Notärztin");

    let (s, _) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Personensitzung");

    let (_, code) = kopplung(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "lagemonitor", "bezeichnung": "Wand"}),
    )
    .await;
    let monitor = koppeln(&app, &code, None).await.cookie.unwrap();
    let (s, _) = anfrage(&app, "GET", &pfad, &monitor, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Lagemonitor");
}

// ---------- Bereitstellungsraum (LFH-1042) ----------

/// Legt einen BR an (`geplant`); mit `aktiv` setzt die Einsatzleitung ihn in Betrieb.
async fn br_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str, aktiv: bool) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume"),
        cookie,
        Some(&json!({"bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let br = v["id"].as_i64().unwrap();
    if aktiv {
        let (s, v) = anfrage_json(
            app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/status"),
            cookie,
            Some(&json!({"status": "aktiv"})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }
    br
}

/// Ein gekoppeltes BR-Gerät: `(kopplung_id, geräte-cookie)`.
async fn br_geraet(app: &axum::Router, cookie: &str, einsatz: i64, br: i64) -> (i64, String) {
    let (id, code) = kopplung(
        app,
        cookie,
        einsatz,
        json!({"ansicht": "bereitstellungsraum", "stelle_id": br, "bezeichnung": "Tablet BR"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    (id, a.cookie.expect("Sitzungscookie"))
}

async fn belegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    br: i64,
    einheit: i64,
    art: &str,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/belegung"),
        cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit, "art": art})),
    )
    .await
}

/// Das BR-Gerät kennt nur seinen Raum: Liste nur der eigene, ein fremder ist 404.
#[tokio::test]
async fn br_geraet_kennt_nur_den_eigenen_raum() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sportplatz = br_anlegen(&app, &admin, einsatz, "BR Sportplatz", true).await;
    let schule = br_anlegen(&app, &admin, einsatz, "BR Schule", true).await;
    let (_, geraet) = br_geraet(&app, &admin, einsatz, sportplatz).await;

    let (s, ich) = me(&app, &geraet).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ich["geraet"]["stelle"], "BR Sportplatz");

    let liste = format!("/api/einsaetze/{einsatz}/bereitstellungsraeume");
    let (s, v) = anfrage(&app, "GET", &liste, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ids: Vec<i64> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![sportplatz], "nur der eigene Raum");
    let (_, v) = anfrage(&app, "GET", &liste, &admin, None).await;
    assert_eq!(v.as_array().unwrap().len(), 2, "die Person sieht beide");

    let (s, v) = anfrage(&app, "GET", &format!("{liste}/{sportplatz}"), &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["bezeichnung"], "BR Sportplatz");
    let (s, _) = anfrage(&app, "GET", &format!("{liste}/{schule}"), &geraet, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremder Raum");
}

/// Anmelden (Eintritt, Wechsel herein) und Abmelden (Austritt) im eigenen Raum; in einen
/// fremden Raum bucht das Gerät nicht (404, wie beim Lesen).
#[tokio::test]
async fn br_geraet_meldet_kraefte_im_eigenen_raum_an_und_ab() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sportplatz = br_anlegen(&app, &admin, einsatz, "BR Sportplatz", true).await;
    let schule = br_anlegen(&app, &admin, einsatz, "BR Schule", true).await;
    let (_, geraet) = br_geraet(&app, &admin, einsatz, sportplatz).await;
    let lf = einheit_bilden(&app, &admin, einsatz, "LF Nord").await;
    let rtw = einheit_bilden(&app, &admin, einsatz, "RTW 1").await;
    let detail = format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{sportplatz}");

    let (s, v) = belegen(&app, &geraet, einsatz, sportplatz, lf, "eintritt").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (_, v) = anfrage(&app, "GET", &detail, &geraet, None).await;
    assert_eq!(v["einheiten"][0]["name"], "LF Nord", "{v}");

    // Ein Wechsel herein trägt den eigenen Raum als Ziel.
    let (s, v) = belegen(&app, &admin, einsatz, schule, rtw, "eintritt").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = belegen(&app, &geraet, einsatz, sportplatz, rtw, "wechsel").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    // In einen fremden Raum bucht das Gerät nichts, weder hinein noch hinaus.
    let (s, _) = belegen(&app, &geraet, einsatz, schule, lf, "wechsel").await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Wechsel hinaus");
    let (s, _) = belegen(&app, &geraet, einsatz, schule, lf, "eintritt").await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremder Raum");

    let (s, v) = belegen(&app, &geraet, einsatz, sportplatz, lf, "austritt").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (_, v) = anfrage(&app, "GET", &detail, &geraet, None).await;
    let namen: Vec<&str> = v["einheiten"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(namen, vec!["RTW 1"], "LF Nord ist abgerückt");

    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t == "LF Nord verlässt Bereitstellungsraum BR Sportplatz"),
        "{etb:?}"
    );
}

/// Das Gerät nimmt seinen Raum in Betrieb; auflösen, stornieren, anlegen und ändern bleibt bei
/// der Einsatzleitung.
#[tokio::test]
async fn br_geraet_nimmt_den_raum_in_betrieb_aber_loest_ihn_nicht_auf() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sportplatz = br_anlegen(&app, &admin, einsatz, "BR Sportplatz", false).await;
    let (_, geraet) = br_geraet(&app, &admin, einsatz, sportplatz).await;
    let raum = format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{sportplatz}");

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{raum}/status"),
        &geraet,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "auflösen aus geplant");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{raum}/status"),
        &geraet,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["status"], "aktiv");
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t == "Bereitstellungsraum BR Sportplatz in Betrieb genommen"),
        "{etb:?}"
    );

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{raum}/status"),
        &geraet,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "auflösen");

    for (m, pfad, body) in [
        ("DELETE", raum.clone(), None),
        ("PATCH", raum.clone(), Some(json!({"notiz": "x"}))),
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/bereitstellungsraeume"),
            Some(json!({"bezeichnung": "BR Neu"})),
        ),
    ] {
        let (s, _) = anfrage_json(&app, m, &pfad, &geraet, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{m} {pfad}");
    }
    let (_, v) = anfrage(&app, "GET", &raum, &admin, None).await;
    assert_eq!(v["status"], "aktiv", "nichts aufgelöst");
}

/// Die Kräfte des Einsatzes liest das Gerät als Liste, ändern und abrufen kann es sie nicht; den
/// Rest des Einsatzes (ETB, Personen, Einsatzabschnitte) erreicht es nicht.
#[tokio::test]
async fn br_geraet_liest_die_kraefteliste_und_sonst_nichts() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sportplatz = br_anlegen(&app, &admin, einsatz, "BR Sportplatz", true).await;
    let (_, geraet) = br_geraet(&app, &admin, einsatz, sportplatz).await;
    let lf = einheit_bilden(&app, &admin, einsatz, "LF Nord").await;

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v[0]["name"], "LF Nord");
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    for (m, pfad, body) in [
        (
            "PATCH",
            format!("/api/einsaetze/{einsatz}/einheiten/{lf}"),
            Some(json!({"name": "LF Süd"})),
        ),
        (
            "PATCH",
            format!("/api/einsaetze/{einsatz}/einheiten/{lf}/position"),
            Some(json!({"lat": 52.5, "lon": 13.4})),
        ),
        ("GET", format!("/api/einsaetze/{einsatz}/etb"), None),
        ("GET", format!("/api/einsaetze/{einsatz}/personen"), None),
        ("GET", format!("/api/einsaetze/{einsatz}/abschnitte"), None),
        ("GET", format!("/api/einsaetze/{einsatz}/uhs"), None),
    ] {
        let (s, _) = anfrage_json(&app, m, &pfad, &geraet, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{m} {pfad}");
    }

    // Modulfreigaben und Zähler folgen der Ansicht; ein gebundenes Gerät bekommt keine
    // einsatzweiten Zähler, auch nicht für die Kräfteliste, die es liest.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-zaehler"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["einheiten"].is_null(), "{v}");
    assert!(
        v["meldungen"].is_null(),
        "kein einsatzweiter Meldungszähler: {v}"
    );
    assert!(v["personen"].is_null(), "{v}");
}

/// Meldungen an die Einsatzleitung wie am UHS-Laptop: anlegen und nur die eigenen lesen.
#[tokio::test]
async fn br_geraet_meldet_und_liest_nur_eigene_meldungen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sportplatz = br_anlegen(&app, &admin, einsatz, "BR Sportplatz", true).await;
    let (_, geraet) = br_geraet(&app, &admin, einsatz, sportplatz).await;
    let meldungen = format!("/api/einsaetze/{einsatz}/meldungen");
    let meldung = |inhalt: &str| {
        json!({
            "absender": "BR Sportplatz",
            "meldeweg": "persoenlich",
            "inhalt": inhalt,
            "ereigniszeit": "2026-10-08 10:00:00",
        })
    };

    let (s, v) = anfrage_json(&app, "POST", &meldungen, &admin, Some(&meldung("Lage"))).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &meldungen,
        &geraet,
        Some(&meldung("Raum voll")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage(&app, "GET", &meldungen, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let inhalte: Vec<&str> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["inhalt"].as_str().unwrap())
        .collect();
    assert_eq!(inhalte, vec!["Raum voll"], "nur die eigene Meldung");
}

/// Ein widerrufenes BR-Gerät verliert sofort jeden Zugriff.
#[tokio::test]
async fn widerrufenes_br_geraet_verliert_den_raum() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sportplatz = br_anlegen(&app, &admin, einsatz, "BR Sportplatz", true).await;
    let (id, geraet) = br_geraet(&app, &admin, einsatz, sportplatz).await;
    let raum = format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{sportplatz}");
    let (s, _) = anfrage(&app, "GET", &raum, &geraet, None).await;
    assert_eq!(s, StatusCode::OK);

    widerrufen(&app, &admin, einsatz, id).await;
    let (s, _) = anfrage(&app, "GET", &raum, &geraet, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

/// Der Live-Kanal des BR-Geräts trägt die Änderungen am Raum, aber kein ETB: eine Anmeldung durch
/// die Einsatzleitung erreicht das Tablet, ihr ETB-Eintrag nicht.
#[tokio::test]
async fn live_kanal_des_br_geraets_traegt_den_raum_ohne_etb() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sportplatz = br_anlegen(&app, &admin, einsatz, "BR Sportplatz", true).await;
    let (_, geraet) = br_geraet(&app, &admin, einsatz, sportplatz).await;
    let lf = einheit_bilden(&app, &admin, einsatz, "LF Nord").await;

    let mut br_strom = live_geraet(&app, &geraet, einsatz).await;
    let mut admin_strom = live_geraet(&app, &admin, einsatz).await;
    let (s, v) = belegen(&app, &admin, einsatz, sportplatz, lf, "eintritt").await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let mut beim_admin = Vec::new();
    strom_lesen(
        &mut admin_strom,
        &mut beim_admin,
        Duration::from_millis(500),
    )
    .await;
    assert!(
        beim_admin.iter().any(|e| e == "etb"),
        "Gegenprobe: {beim_admin:?}"
    );
    let mut beim_br = Vec::new();
    strom_lesen(&mut br_strom, &mut beim_br, Duration::from_millis(500)).await;
    assert!(
        beim_br.iter().any(|e| e == "bereitstellungsraum"),
        "{beim_br:?}"
    );
    assert!(!beim_br.iter().any(|e| e == "etb"), "{beim_br:?}");
}

// ---------- Kräfte der UHS (LFH-1045) ----------

/// Ad-hoc-Kraft im Einsatz (ohne UHS), disponiert von der Leitung; liefert die `ep_id`.
async fn uhs_kraft(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&json!({"adhoc": {"name": name, "staerke_position": "mannschaft"}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// Die Stärke der UHS aus dem Detail, wie die Leitung sie sieht.
async fn uhs_staerke(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64) -> Value {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v["staerke"].clone()
}

#[tokio::test]
async fn laptop_pflegt_die_kraefte_nur_der_eigenen_uhs() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let geraet = laptop(&app, &admin, einsatz, nord).await;
    let kraefte = |uhs: i64| format!("/api/einsaetze/{einsatz}/uhs/{uhs}/kraefte");
    let frei = uhs_kraft(&app, &admin, einsatz, "Freie Kraft").await;
    let bei_sued = uhs_kraft(&app, &admin, einsatz, "Kraft Süd").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/{bei_sued}", kraefte(sued)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Leitung ordnet der UHS Süd zu");

    // Auswahl: nur Kräfte ohne UHS.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("{}/verfuegbar", kraefte(nord)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ids: Vec<i64> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![frei], "{v}");

    // Freie Kraft zuordnen: Erfolg, Stärke der eigenen UHS steigt.
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("{}/{frei}", kraefte(nord)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        uhs_staerke(&app, &geraet, einsatz, nord).await,
        json!({"fuehrer": 0, "unterfuehrer": 0, "mannschaft": 1})
    );
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(detail["kraefte"][0]["name"], "Freie Kraft", "{detail}");

    // Eine Kraft der UHS Süd holt der Laptop nicht zu sich.
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/{bei_sued}", kraefte(nord)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        uhs_staerke(&app, &admin, einsatz, sued).await["mannschaft"],
        json!(1),
        "bleibt an der UHS Süd"
    );

    // Fremde UHS: lesen und ändern 404.
    for (methode, pfad, body) in [
        ("GET", format!("{}/verfuegbar", kraefte(sued)), None),
        ("PUT", format!("{}/{frei}", kraefte(sued)), None),
        ("DELETE", format!("{}/{bei_sued}", kraefte(sued)), None),
        (
            "POST",
            kraefte(sued),
            Some(json!({"name": "Spontan"}).to_string()),
        ),
    ] {
        let (s, _) = anfrage(&app, methode, &pfad, &geraet, body.as_deref()).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {pfad}");
    }

    // Ad hoc an der eigenen UHS erfassen, dann lösen.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &kraefte(nord),
        &geraet,
        Some(&json!({"name": "Spontanhelfer", "funktion": "Sanitäter", "staerke_position": "mannschaft"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let spontan = v["id"].as_i64().unwrap();
    assert_eq!(
        uhs_staerke(&app, &admin, einsatz, nord).await["mannschaft"],
        json!(2)
    );
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{spontan}", kraefte(nord)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    // Eine ganze Einheit zuordnen bleibt der Leitung.
    let einheit = common::einheit_bilden(&app, &admin, einsatz, "SEG 1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/einheit/{einheit}", kraefte(nord)),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Das Tablet erreicht keine dieser Routen und sieht keine Kräfte im Detail.
    for (methode, pfad, body) in [
        ("GET", format!("{}/verfuegbar", kraefte(nord)), None),
        ("PUT", format!("{}/{frei}", kraefte(nord)), None),
        ("DELETE", format!("{}/{frei}", kraefte(nord)), None),
        (
            "POST",
            kraefte(nord),
            Some(json!({"name": "Spontan"}).to_string()),
        ),
    ] {
        let (s, _) = anfrage(&app, methode, &pfad, &tablet, body.as_deref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "Tablet {methode} {pfad}");
    }
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}"),
        &tablet,
        None,
    )
    .await;
    assert_eq!(detail["kraefte"], json!([]), "{detail}");
}

#[tokio::test]
async fn lagemonitor_zeigt_kraefte_je_uhs_nur_als_zahl() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, _tablet) = zwei_uhs_mit_tablet(&app, &admin).await;
    let monitor = lagemonitor(&app, &admin, einsatz).await;
    for name in ["Kraftmann", "Kraftfrau", "Kraftkind", "Kraftopa"] {
        let ep = uhs_kraft(&app, &admin, einsatz, name).await;
        let (s, _) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/uhs/{nord}/kraefte/{ep}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
    }
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lagemonitor"),
        &monitor,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let uhs = v["uhs"].as_array().unwrap();
    let zahl = |id: i64| uhs.iter().find(|u| u["id"] == id).unwrap()["kraefte"].clone();
    assert_eq!(zahl(nord), json!(4));
    assert_eq!(zahl(sued), json!(0));
    let text = v.to_string();
    assert!(!text.contains("Kraft"), "Name in der Antwort: {text}");
    assert!(!text.contains("\"funktion\""), "{text}");
}

// ---------- Betreuungsstelle (LFH-1041) ----------

/// Legt eine Betreuungsstelle in Betrieb an.
async fn betreuungsstelle_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bez: &str,
) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/betreuung/stellen"),
        cookie,
        Some(&json!({"bezeichnung": bez, "art": "notunterkunft", "kapazitaet_personen": 80})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let stelle = v["id"].as_i64().unwrap();
    let (s, v) = anfrage_json(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/betreuung/stellen/{stelle}"),
        cookie,
        Some(&json!({"status": "in_betrieb"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    stelle
}

/// Zwei Betreuungsstellen und ein Gerät an der ersten: `(einsatz, nord, sued, kopplung, gerät)`.
async fn zwei_stellen_mit_geraet(app: &axum::Router, admin: &str) -> (i64, i64, i64, i64, String) {
    let einsatz = einsatz_anlegen(app, admin).await;
    let nord = betreuungsstelle_anlegen(app, admin, einsatz, "NU Turnhalle Nord").await;
    let sued = betreuungsstelle_anlegen(app, admin, einsatz, "NU Schule Süd").await;
    let (id, code) = kopplung(
        app,
        admin,
        einsatz,
        json!({"ansicht": "betreuungsstelle", "stelle_id": nord, "bezeichnung": "Tablet NU"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    (einsatz, nord, sued, id, a.cookie.expect("Sitzungscookie"))
}

async fn belegung_melden(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    stelle: i64,
    belegt: i64,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/betreuung/stellen/{stelle}/belegungen"),
        cookie,
        Some(&json!({"belegt": belegt})),
    )
    .await
}

/// Person mit Verbleib „Notunterkunft“ an `stelle`, angelegt von der Einsatzleitung.
async fn person_in_stelle(app: &axum::Router, admin: &str, einsatz: i64, stelle: i64) -> i64 {
    let person = person_in(app, admin, einsatz, None).await["id"]
        .as_i64()
        .unwrap();
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{person}/verbleib"),
        admin,
        Some(&json!({"art": "notunterkunft", "betreuungsstelle_id": stelle})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    person
}

#[tokio::test]
async fn betreuungsstelle_kennt_nur_die_eigene_stelle() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, _, geraet) = zwei_stellen_mit_geraet(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/betreuung/bezirke"),
        &admin,
        Some(
            &json!({"bezeichnung": "Uferstraße", "plan_personen": 40, "plan_erhebung": "gezaehlt"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/betreuung"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ids: Vec<i64> = v["stellen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|st| st["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![nord], "nur die eigene Stelle");
    assert_eq!(v["bezirke"], json!([]), "keine Bezirke");

    // Melden und Meldeverlauf: eigene Stelle ja, fremde 404.
    let (s, v) = belegung_melden(&app, &geraet, einsatz, nord, 12).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let eigene_meldung = v["meldung_id"].as_i64().unwrap();
    let (s, _) = belegung_melden(&app, &geraet, einsatz, sued, 3).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Meldung an fremde Stelle");
    for (stelle, erwartet) in [(nord, StatusCode::OK), (sued, StatusCode::NOT_FOUND)] {
        let (s, v) = anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/betreuung/stellen/{stelle}/belegungen"),
            &geraet,
            None,
        )
        .await;
        assert_eq!(s, erwartet, "Meldeverlauf {stelle}: {v}");
    }

    // Zurücknehmen: die Meldung einer fremden Stelle gibt es für das Gerät nicht.
    let (s, v) = belegung_melden(&app, &admin, einsatz, sued, 5).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let fremde_meldung = v["meldung_id"].as_i64().unwrap();
    for (meldung, erwartet) in [
        (fremde_meldung, StatusCode::NOT_FOUND),
        (eigene_meldung, StatusCode::OK),
    ] {
        let (s, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/betreuung/belegungen/{meldung}/zuruecknehmen"),
            &geraet,
            None,
        )
        .await;
        assert_eq!(s, erwartet, "Rücknahme {meldung}: {v}");
    }

    // Kopfzahl, Bezirke und Stammdaten der Stelle bleiben verboten.
    for (m, p, body) in [
        (
            "GET",
            format!("/api/einsaetze/{einsatz}/betreuung/belegung"),
            None,
        ),
        (
            "PATCH",
            format!("/api/einsaetze/{einsatz}/betreuung/stellen/{nord}"),
            Some(json!({"status": "geschlossen"})),
        ),
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/betreuung/stellen"),
            Some(json!({"bezeichnung": "NU West", "art": "notunterkunft"})),
        ),
        (
            "POST",
            format!("/api/einsaetze/{einsatz}/betreuung/stellen/{nord}/stornieren"),
            None,
        ),
    ] {
        let (s, v) = anfrage_json(&app, m, &p, &geraet, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{m} {p}: {v}");
    }

    // Die Zähler zählen den ganzen Einsatz und fehlen deshalb am Gerät.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/modul-zaehler"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for modul in ["betreuung", "personen", "meldungen"] {
        assert!(v.get(modul).is_none(), "{modul}: {v}");
    }
}

#[tokio::test]
async fn aufnahme_an_der_betreuungsstelle_bringt_in_die_eigene_stelle() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, _, geraet) = zwei_stellen_mit_geraet(&app, &admin).await;
    let (s, v) = belegung_melden(&app, &admin, einsatz, nord, 40).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let aufgenommen = person_in(&app, &geraet, einsatz, None).await;
    assert_eq!(aufgenommen["status"], "betroffen", "{aufgenommen}");
    assert_eq!(aufgenommen["aktuelle_verbleib_art"], "notunterkunft");
    assert_eq!(aufgenommen["aktuelle_verbleib_betreuungsstelle_id"], nord);
    let aufgenommen = aufgenommen["id"].as_i64().unwrap();

    // Eine Person der anderen Stelle sieht das Gerät nicht.
    let fremd = person_in_stelle(&app, &admin, einsatz, sued).await;
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ids: Vec<i64> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_i64().unwrap())
        .collect();
    assert_eq!(ids, vec![aufgenommen]);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{fremd}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Person der anderen Stelle");

    // Die Mengenmeldung bleibt führend; die Aufnahme steht nur in „davon namentlich“.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/betreuung"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["stellen"][0]["belegung"]["belegt"], 40, "{v}");
    assert_eq!(v["namentlich"], json!([{"stelle_id": nord, "anzahl": 1}]));

    // Keine Erst-Sichtung, keine UHS, keine vermisste Person.
    for body in [
        json!({"name": "A", "sichtung": "SK3"}),
        json!({"name": "B", "uhs_id": 1}),
    ] {
        let (s, v) = anfrage_json(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/personen"),
            &geraet,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{body}: {v}");
    }
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &geraet,
        Some(&json!({"name": "C", "status": "vermisst"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    // Sichtung über die eigene Route gibt es am Gerät ebenfalls nicht.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen/{aufgenommen}/sichtung"),
        &geraet,
        Some(&json!({"kategorie": "SK3"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn betreuungsstelle_bringt_in_keine_fremde_notunterkunft() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, sued, _, geraet) = zwei_stellen_mit_geraet(&app, &admin).await;
    let person = person_in_stelle(&app, &admin, einsatz, nord).await;
    let verbleib = |body: Value| {
        let app = app.clone();
        let geraet = geraet.clone();
        async move {
            anfrage_json(
                &app,
                "POST",
                &format!("/api/einsaetze/{einsatz}/personen/{person}/verbleib"),
                &geraet,
                Some(&body),
            )
            .await
        }
    };

    let (s, v) = verbleib(json!({"art": "notunterkunft", "betreuungsstelle_id": sued})).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "fremde Stelle: {v}");
    let (s, v) = verbleib(json!({"art": "notunterkunft", "ziel": "Turnhalle Ost"})).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Notunterkunft ohne Stelle: {v}");
    let (s, v) = verbleib(json!({"art": "notunterkunft", "betreuungsstelle_id": nord})).await;
    assert_eq!(s, StatusCode::CREATED, "eigene Stelle: {v}");
    let (s, v) = verbleib(json!({"art": "entlassung"})).await;
    assert_eq!(s, StatusCode::CREATED, "Entlassung: {v}");

    // Nach der Entlassung sieht das Gerät die Person weiterhin, wie die UHS nach dem Austritt.
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen/{person}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

#[tokio::test]
async fn widerrufene_betreuungsstelle_verliert_jeden_zugriff() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, nord, _, kopplung_id, geraet) = zwei_stellen_mit_geraet(&app, &admin).await;
    let (s, _) = belegung_melden(&app, &geraet, einsatz, nord, 1).await;
    assert_eq!(s, StatusCode::CREATED);

    widerrufen(&app, &admin, einsatz, kopplung_id).await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/betreuung"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = belegung_melden(&app, &geraet, einsatz, nord, 2).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

// ---------- Verpflegung (LFH-1044) ----------

/// Ein gekoppeltes Verpflegungsgerät (einsatzweit, ohne Stelle): `(kopplung_id, geräte-cookie)`.
async fn verpflegungsgeraet(app: &axum::Router, cookie: &str, einsatz: i64) -> (i64, String) {
    let (id, code) = kopplung(
        app,
        cookie,
        einsatz,
        json!({"ansicht": "verpflegung", "bezeichnung": "Ausgabe Deich"}),
    )
    .await;
    let a = koppeln(app, &code, None).await;
    assert_eq!(a.status, StatusCode::OK, "{:?}", a.body);
    (id, a.cookie.expect("Sitzungscookie"))
}

/// Legt das Zeitfenster „Mittag“ mit 250 EP Bedarf an; liefert seine Kennung.
async fn mittag(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/verpflegung/zeitfenster"),
        cookie,
        Some(&json!({
            "bezeichnung": "Mittag",
            "von_at": "2026-10-08T12:00:00Z",
            "bis_at": "2026-10-08T13:30:00Z",
            "bedarf_kraefte": 180,
            "bedarf_betreute": 70,
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// Sammelt alle Objektschlüssel einer Antwort, rekursiv.
fn schluessel(v: &Value, alle: &mut Vec<String>) {
    match v {
        Value::Object(o) => {
            for (k, w) in o {
                alle.push(k.clone());
                schluessel(w, alle);
            }
        }
        Value::Array(a) => a.iter().for_each(|w| schluessel(w, alle)),
        _ => {}
    }
}

/// Das Verpflegungsgerät ist einsatzweit: eine Stelle lehnt die Kopplung ab, ohne Stelle koppelt
/// es mit der Rolle zum Schreiben.
#[tokio::test]
async fn verpflegungsgeraet_ist_an_keine_stelle_gebunden() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = uhs_anlegen(&app, &admin, einsatz, "UHS Nord").await;

    let (s, v) = anlegen(
        &app,
        &admin,
        einsatz,
        json!({"ansicht": "verpflegung", "stelle_id": uhs, "bezeichnung": "Ausgabe"}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");

    let (_, geraet) = verpflegungsgeraet(&app, &admin, einsatz).await;
    let (s, ich) = me(&app, &geraet).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ich["geraet"]["ansicht"], "verpflegung");
    assert!(ich["geraet"]["stelle_id"].is_null(), "{ich}");
}

/// Das Gerät liest Zeitfenster mit Deckung, bucht Portionen und nimmt eine Buchung zurück; das
/// Planen der Zeitfenster bleibt bei der Führung. Die Antwort trägt keine Namen.
#[tokio::test]
async fn verpflegungsgeraet_bucht_und_nimmt_zurueck_aber_plant_nicht() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zf = mittag(&app, &admin, einsatz).await;
    let (_, geraet) = verpflegungsgeraet(&app, &admin, einsatz).await;
    let basis = format!("/api/einsaetze/{einsatz}/verpflegung");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{basis}/zeitfenster/{zf}/ausgaben"),
        &admin,
        Some(&json!({"menge": 100, "ort": "Küche"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{basis}/zeitfenster/{zf}/ausgaben"),
        &geraet,
        Some(&json!({"menge": 40, "ort": "Deich"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ausgabe = v["ausgabe_id"].as_i64().unwrap();
    assert_eq!(v["zeitfenster"]["ausgegeben"]["gesamt"], 140, "{v}");
    assert_eq!(v["zeitfenster"]["fehlmenge"]["gesamt"], 110, "{v}");

    let (s, v) = anfrage(&app, "GET", &basis, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zeitfenster"][0]["bezeichnung"], "Mittag");
    assert_eq!(v["zeitfenster"][0]["ausgaben"].as_array().unwrap().len(), 2);
    // Keine Namen und keine Urheber, weder der Person noch des Geräts.
    let anzeigename: String =
        sqlx::query_scalar("SELECT anzeigename FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let text = v.to_string();
    assert!(!text.contains(&anzeigename), "Name in der Antwort: {text}");
    let mut alle = Vec::new();
    schluessel(&v, &mut alle);
    assert!(
        !alle
            .iter()
            .any(|k| k.contains("name") || k.contains("_von") || k.contains("benutzer")),
        "{alle:?}"
    );

    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("{basis}/ausgaben/{ausgabe}/zuruecknehmen"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zeitfenster"]["ausgegeben"]["gesamt"], 100, "{v}");

    // Nachforderungen liegen außerhalb der Ansicht: auch keine Buchung auf eine (sonst verriete
    // 404 gegen 201, welche es gibt).
    let (s, nf) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/nachforderungen"),
        &admin,
        Some(&json!({
            "art": "Verpflegung",
            "bezeichnung": "Verpflegung 60 EP",
            "anzahl": 60,
            "adressat_kategorie": "leitstelle",
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{nf}");
    let nid = nf["id"].as_i64().unwrap();
    for n in [nid, nid + 1000] {
        let (s, v) = anfrage_json(
            &app,
            "POST",
            &format!("{basis}/zeitfenster/{zf}/ausgaben"),
            &geraet,
            Some(&json!({"menge": 5, "nachforderung_id": n})),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "Nachforderung {n}: {v}");
    }
    let (_, v) = anfrage(&app, "GET", &basis, &admin, None).await;
    assert_eq!(v["zeitfenster"][0]["ausgegeben"]["gesamt"], 100, "{v}");

    for (m, pfad, body) in [
        (
            "POST",
            format!("{basis}/zeitfenster"),
            Some(json!({
                "bezeichnung": "Abend",
                "von_at": "2026-10-08T18:00:00Z",
                "bis_at": "2026-10-08T19:00:00Z",
                "bedarf_kraefte": 10,
                "bedarf_betreute": 0,
            })),
        ),
        (
            "PATCH",
            format!("{basis}/zeitfenster/{zf}"),
            Some(json!({"bedarf_kraefte": 1})),
        ),
        ("DELETE", format!("{basis}/zeitfenster/{zf}"), None),
    ] {
        let (s, _) = anfrage_json(&app, m, &pfad, &geraet, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{m} {pfad}");
    }
    let (_, v) = anfrage(&app, "GET", &basis, &admin, None).await;
    assert_eq!(
        v["zeitfenster"].as_array().unwrap().len(),
        1,
        "nichts geplant"
    );
    assert_eq!(v["zeitfenster"][0]["bedarf"]["gesamt"], 250);
}

/// Personal, Betreuung, Nachforderungen, Personen und ETB erreicht das Gerät nicht; Modulzähler
/// und Freigaben folgen der Ansicht, ohne einsatzweiten Meldungs- oder Personenzähler.
#[tokio::test]
async fn verpflegungsgeraet_liest_kein_personal_und_keine_nachforderungen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    mittag(&app, &admin, einsatz).await;
    let (_, geraet) = verpflegungsgeraet(&app, &admin, einsatz).await;
    let e = format!("/api/einsaetze/{einsatz}");

    for (m, pfad, body) in [
        ("GET", format!("{e}/personal"), None),
        ("GET", format!("{e}/betreuung"), None),
        ("GET", format!("{e}/nachforderungen"), None),
        (
            "POST",
            format!("{e}/nachforderungen"),
            Some(json!({
                "art": "Verpflegung",
                "bezeichnung": "Essensportionen",
                "anzahl": 20,
                "adressat_kategorie": "leitstelle",
            })),
        ),
        ("GET", format!("{e}/personen"), None),
        ("GET", format!("{e}/etb"), None),
        ("GET", format!("{e}/uhs"), None),
        ("GET", format!("{e}/einheiten"), None),
        ("GET", format!("{e}/lagemonitor"), None),
    ] {
        let (s, _) = anfrage_json(&app, m, &pfad, &geraet, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{m} {pfad}");
    }

    let (s, v) = anfrage(&app, "GET", &format!("{e}/modul-freigaben"), &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["verpflegung"]["zugriff"], true, "{v}");
    assert_eq!(v["meldungen"]["zugriff"], true, "{v}");
    assert_eq!(v["nachforderungen"]["zugriff"], false, "{v}");
    assert_eq!(v["personal"]["zugriff"], false, "{v}");

    let (s, v) = anfrage(&app, "GET", &format!("{e}/modul-zaehler"), &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(
        v["meldungen"].is_null(),
        "kein einsatzweiter Meldungszähler: {v}"
    );
    assert!(v["personen"].is_null(), "{v}");
    assert!(v["personal"].is_null(), "{v}");
}

/// Eine Unterdeckung meldet das Gerät der Einsatzleitung; es liest nur die eigenen Meldungen.
#[tokio::test]
async fn verpflegungsgeraet_meldet_und_liest_nur_eigene_meldungen() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, geraet) = verpflegungsgeraet(&app, &admin, einsatz).await;
    let meldungen = format!("/api/einsaetze/{einsatz}/meldungen");
    let meldung = |inhalt: &str| {
        json!({
            "absender": "Verpflegung · Ausgabe Deich",
            "meldeweg": "persoenlich",
            "inhalt": inhalt,
            "prioritaet": "sofort",
            "ereigniszeit": "2026-10-08 12:30:00",
        })
    };

    let (s, v) = anfrage_json(&app, "POST", &meldungen, &admin, Some(&meldung("Lage"))).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &meldungen,
        &geraet,
        Some(&meldung("Unterdeckung Mittag: 20 EP fehlen")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let mid = v["id"].as_i64().unwrap();

    // Die Einsatzleitung nimmt die Meldung an sich und bestätigt sie: ihr Name erreicht das
    // Gerät trotzdem nicht.
    let (admin_id, anzeigename): (i64, String) =
        sqlx::query_as("SELECT id, anzeigename FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{meldungen}/{mid}/zuweisen"),
        &admin,
        Some(&json!({"bearbeiter_id": admin_id})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("{meldungen}/{mid}/bestaetigen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["bestaetigt_von_name"], anzeigename.as_str(), "{v}");

    let (s, v) = anfrage(&app, "GET", &meldungen, &geraet, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let liste = v.as_array().unwrap();
    let inhalte: Vec<&str> = liste
        .iter()
        .map(|m| m["inhalt"].as_str().unwrap())
        .collect();
    assert_eq!(inhalte, vec!["Unterdeckung Mittag: 20 EP fehlen"]);
    assert_eq!(liste[0]["ist_bestaetigt"], true, "{v}");
    assert!(liste[0]["bearbeiter_name"].is_null(), "{v}");
    assert!(liste[0]["bestaetigt_von_name"].is_null(), "{v}");
    assert!(
        !v.to_string().contains(&anzeigename),
        "Name in der Antwort: {v}"
    );
}

/// Der Einsatzkopf kommt beim Verpflegungsgerät ohne Freitexte, die Personen nennen können
/// (wie beim Lagemonitor).
#[tokio::test]
async fn verpflegungsgeraet_liest_den_einsatzkopf_ohne_personenbezug() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(&json!({
            "sachverhalt": "Anrufer Max Muster meldet Wasser im Keller",
            "meldende_stelle": "Max Muster",
            "einsatzort": "Deichstraße 4",
        })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (_, geraet) = verpflegungsgeraet(&app, &admin, einsatz).await;
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["sachverhalt"].is_null(), "{v}");
    assert!(v["meldende_stelle"].is_null(), "{v}");
    assert!(v["einsatzort"].is_null(), "{v}");
    assert!(!v.to_string().contains("Muster"), "{v}");
}

/// Ein widerrufenes Verpflegungsgerät verliert sofort jeden Zugriff.
#[tokio::test]
async fn widerrufenes_verpflegungsgeraet_verliert_jeden_zugriff() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zf = mittag(&app, &admin, einsatz).await;
    let (id, geraet) = verpflegungsgeraet(&app, &admin, einsatz).await;
    let basis = format!("/api/einsaetze/{einsatz}/verpflegung");
    let (s, _) = anfrage(&app, "GET", &basis, &geraet, None).await;
    assert_eq!(s, StatusCode::OK);

    widerrufen(&app, &admin, einsatz, id).await;
    let (s, _) = anfrage(&app, "GET", &basis, &geraet, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{basis}/zeitfenster/{zf}/ausgaben"),
        &geraet,
        Some(&json!({"menge": 5})),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

/// Der Live-Kanal des Verpflegungsgeräts trägt Verpflegung, aber kein ETB: das Anlegen eines
/// Zeitfensters (mit ETB-Eintrag) erreicht das Gerät nur als Verpflegungsereignis.
#[tokio::test]
async fn live_kanal_des_verpflegungsgeraets_traegt_verpflegung_ohne_etb() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, geraet) = verpflegungsgeraet(&app, &admin, einsatz).await;

    let mut geraet_strom = live_geraet(&app, &geraet, einsatz).await;
    let mut admin_strom = live_geraet(&app, &admin, einsatz).await;
    mittag(&app, &admin, einsatz).await;

    let mut beim_admin = Vec::new();
    strom_lesen(
        &mut admin_strom,
        &mut beim_admin,
        Duration::from_millis(500),
    )
    .await;
    assert!(
        beim_admin.iter().any(|e| e == "etb"),
        "Gegenprobe: {beim_admin:?}"
    );
    let mut beim_geraet = Vec::new();
    strom_lesen(
        &mut geraet_strom,
        &mut beim_geraet,
        Duration::from_millis(500),
    )
    .await;
    assert!(
        beim_geraet.iter().any(|e| e == "verpflegung"),
        "{beim_geraet:?}"
    );
    assert!(!beim_geraet.iter().any(|e| e == "etb"), "{beim_geraet:?}");
}
