//! Einwurf-Zugang für Absender ohne Signatur (LLH-1654, ADR-0023, Spec `einwurf-zugang`):
//! Verwaltung unter `/api/admin/einwurf-zugaenge` und die Einwurf-Routen unter
//! `/api/v1/einwurf/{schluessel}/…`, durch den ganzen Router.
//!
//! Der Zähler für Maschinen und die Drossel gelten prozessweit; jeder Test, der sie berührt,
//! nimmt eine eigene Quelladresse bzw. einen eigenen Zugang.

use std::net::SocketAddr;

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, HeaderMap, Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage_json, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_optionen,
    setup_mit_pool,
};

const LISTE: &str = "/api/admin/einwurf-zugaenge";

/// Der Router der meisten Tests: Einwürfe auch ohne TLS, weil `oneshot` keine Verbindung hat.
/// Die TLS-Pflicht selbst prüfen eigene Tests mit den Vorgabe-Optionen.
const OHNE_TLS: RouterOptionen = RouterOptionen {
    demo_daten: false,
    zulassungs_budget: None,
    heic_decoder_verzeichnis: None,
    tls: false,
    einwurf_allow_http: true,
};

async fn setup() -> (axum::Router, sqlx::SqlitePool, String) {
    let (app, pool) = setup_mit_optionen(OHNE_TLS).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    (app, pool, admin)
}

/// Legt einen Zugang an und liefert (Kennung, Schlüssel).
async fn zugang(app: &axum::Router, admin: &str, name: &str, scope: &str) -> (String, String) {
    let (s, v) = anfrage_json(
        app,
        "POST",
        LISTE,
        admin,
        Some(&json!({ "name": name, "scope": scope })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (
        v["zugang"]["id"].as_str().unwrap().to_string(),
        v["schluessel"].as_str().unwrap().to_string(),
    )
}

struct Antwort {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Antwort {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    fn code(&self) -> String {
        self.json()["code"].as_str().unwrap_or_default().to_string()
    }
}

/// Ein Einwurf, wie ein Absender ihn schickt.
#[derive(Default)]
struct Einwurf<'a> {
    methode: &'a str,
    /// `(Content-Type, Body)`.
    body: Option<(&'a str, Vec<u8>)>,
    quelle: Option<&'a str>,
    kopf: Vec<(&'a str, &'a str)>,
}

async fn sende(app: &axum::Router, pfad: &str, e: Einwurf<'_>) -> Antwort {
    let mut req = Request::builder()
        .method(if e.methode.is_empty() {
            "GET"
        } else {
            e.methode
        })
        .uri(pfad);
    for (name, wert) in &e.kopf {
        req = req.header(*name, *wert);
    }
    let body = match e.body {
        Some((typ, bytes)) => {
            if !typ.is_empty() {
                req = req.header(header::CONTENT_TYPE, typ);
            }
            Body::from(bytes)
        }
        None => Body::empty(),
    };
    let mut req = req.body(body).unwrap();
    if let Some(quelle) = e.quelle {
        let adresse: SocketAddr = quelle.parse().unwrap();
        req.extensions_mut().insert(ConnectInfo(adresse));
    }
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    Antwort {
        status,
        headers,
        body,
    }
}

async fn einwerfen(app: &axum::Router, schluessel: &str, rest: &str) -> Antwort {
    sende(
        app,
        &format!("/api/v1/einwurf/{schluessel}/{rest}"),
        Einwurf::default(),
    )
    .await
}

async fn anzahl(pool: &sqlx::SqlitePool, tabelle: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM {tabelle}"
    )))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn spur(pool: &sqlx::SqlitePool) -> Vec<(String, String, Option<String>)> {
    sqlx::query_as(
        "SELECT aktion, ziel, detail FROM admin_audit WHERE aktion LIKE 'einwurf_zugang_%' \
         ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn org_koppeln(pool: &sqlx::SqlitePool) {
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap();
    let kopplung: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand) VALUES ('hub-ew', 'X', 'Hub Kreis', 'meldet_sich', \
         'https://hub.example', 'aktiv') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name) \
         VALUES (?, ?, 'hub-ew/1', 'Kreis')",
    )
    .bind(kopplung)
    .bind(org)
    .execute(pool)
    .await
    .unwrap();
}

// ── Verwaltung ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn anlegen_gibt_den_schluessel_einmal_aus_und_schreibt_die_admin_spur() {
    let (app, pool, admin) = setup().await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        LISTE,
        &admin,
        Some(&json!({ "name": " BOSWatch Wache 1 ", "scope": "alarmmeldungen:write" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let schluessel = v["schluessel"].as_str().unwrap();
    assert!(schluessel.starts_with("llh_ew_"));
    assert_eq!(schluessel.len(), 50);
    assert_eq!(v["zugang"]["name"], "BOSWatch Wache 1");
    assert_eq!(v["zugang"]["scope"], "alarmmeldungen:write");
    assert_eq!(v["zugang"]["is_abgelaufen"], false);
    assert!(v["zugang"]["widerrufen_at"].is_null());
    assert!(v["zugang"]["zuletzt_genutzt_at"].is_null());

    // Der Schlüssel steht nirgends sonst: nicht in der Liste, nicht in der Datenbank, nicht in
    // der Spur. Gespeichert ist nur sein SHA-256.
    let hash = lifeline_hub::public_api::einwurf::hash(schluessel);
    let (s, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste["zugaenge"].as_array().unwrap().len(), 1);
    let text = liste.to_string();
    assert!(
        !text.contains(schluessel) && !text.contains(&hash),
        "{text}"
    );
    assert!(liste["gesperrt_grund"].is_null());
    assert_eq!(liste["transport"], "http", "Schalter gesetzt");
    let gespeichert: String = sqlx::query_scalar("SELECT schluessel_hash FROM einwurf_zugang")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(gespeichert, hash);

    let eintraege = spur(&pool).await;
    assert_eq!(eintraege.len(), 1);
    let (aktion, ziel, detail) = &eintraege[0];
    assert_eq!(aktion, "einwurf_zugang_angelegt");
    assert_eq!(ziel, "BOSWatch Wache 1");
    let detail = detail.as_deref().unwrap();
    assert!(detail.contains("alarmmeldungen:write"));
    assert!(!detail.contains(schluessel) && !detail.contains(&hash));
}

#[tokio::test]
async fn eingabe_wird_geprueft() {
    let (app, _pool, admin) = setup().await;
    for body in [
        json!({ "name": "x", "scope": "lage:read" }),
        json!({ "name": "x", "scope": "alles:write" }),
        json!({ "name": "x", "scope": "" }),
        json!({ "name": "  ", "scope": "positionen:write" }),
        json!({ "name": "x".repeat(81), "scope": "positionen:write" }),
        json!({ "name": "x", "scope": "positionen:write", "gueltig_bis": "2001-01-01 00:00" }),
    ] {
        let (s, v) = anfrage_json(&app, "POST", LISTE, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }
    let (s, v) = anfrage_json(
        &app,
        "POST",
        LISTE,
        &admin,
        Some(&json!({ "name": "OsmAnd", "scope": "positionen:write",
            "gueltig_bis": "2099-01-01T12:00" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["zugang"]["gueltig_bis"], "2099-01-01 12:00:00");
}

#[tokio::test]
async fn nur_der_system_admin_schreibt_und_nur_in_der_eigenen_org() {
    let (app, pool, admin) = setup().await;
    let (id, _) = zugang(&app, &admin, "Adapter", "alarmmeldungen:write").await;

    benutzer_anlegen(&app, &admin, "erika", "fuehrungskraft").await;
    let fk = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) = anfrage_json(
        &app,
        "POST",
        LISTE,
        &fk,
        Some(&json!({ "name": "x", "scope": "alarmmeldungen:write" })),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    for aktion in ["schluessel", "widerrufen"] {
        let (s, _) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/{aktion}"), &fk, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{aktion}");
    }
    // Lesen darf, wer die Verwaltung sieht.
    let (s, liste) = anfrage_json(&app, "GET", LISTE, &fk, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    assert_eq!(liste["zugaenge"].as_array().unwrap().len(), 1);

    // Ein Admin einer anderen Org sieht den Zugang nicht und erreicht ihn nicht.
    let (_org2, uid2) =
        fremde_org_anlegen(&pool, "Fremde Org", "fremd", "fremdpw12", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(uid2)
        .execute(&pool)
        .await
        .unwrap();
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let (s, liste) = anfrage_json(&app, "GET", LISTE, &fremd, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    assert!(liste["zugaenge"].as_array().unwrap().is_empty());
    for aktion in ["schluessel", "widerrufen"] {
        let (s, _) = anfrage_json(
            &app,
            "POST",
            &format!("{LISTE}/{id}/{aktion}"),
            &fremd,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{aktion}");
    }
    assert_eq!(spur(&pool).await.len(), 1, "nur das Anlegen");
}

#[tokio::test]
async fn wechsel_gibt_einen_neuen_schluessel_und_der_alte_gilt_sofort_nicht_mehr() {
    let (app, pool, admin) = setup().await;
    let (id, alt) = zugang(&app, &admin, "FE2", "alarmmeldungen:write").await;
    assert_eq!(
        einwerfen(&app, &alt, "alarmmeldung?text=a").await.status,
        StatusCode::NO_CONTENT
    );

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/schluessel"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let neu = v["schluessel"].as_str().unwrap().to_string();
    assert_ne!(neu, alt);
    assert_eq!(v["zugang"]["id"], id.as_str());
    assert_eq!(v["zugang"]["name"], "FE2");
    assert!(v["zugang"]["schluessel_gewechselt_at"].is_string());

    assert_eq!(
        einwerfen(&app, &alt, "alarmmeldung?text=b").await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        einwerfen(&app, &neu, "alarmmeldung?text=b").await.status,
        StatusCode::NO_CONTENT
    );

    let eintraege = spur(&pool).await;
    assert_eq!(eintraege.len(), 2);
    assert_eq!(eintraege[1].0, "einwurf_zugang_schluessel_gewechselt");
    let detail = eintraege[1].2.as_deref().unwrap();
    assert!(!detail.contains(&neu) && !detail.contains(&alt));
}

#[tokio::test]
async fn widerruf_wirkt_sofort_und_schreibt_die_spur_einmal() {
    let (app, pool, admin) = setup().await;
    let (id, schluessel) = zugang(&app, &admin, "Divera", "alarmmeldungen:write").await;
    assert_eq!(
        einwerfen(&app, &schluessel, "alarmmeldung?text=a")
            .await
            .status,
        StatusCode::NO_CONTENT
    );

    let widerrufen = format!("{LISTE}/{id}/widerrufen");
    let (s, v) = anfrage_json(&app, "POST", &widerrufen, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["widerrufen_at"].is_string());
    assert_eq!(v["widerrufen_von_name"], "Administrator");

    let antwort = einwerfen(&app, &schluessel, "alarmmeldung?text=b").await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);
    assert_eq!(antwort.code(), "unauthorized");
    assert_eq!(anzahl(&pool, "alarmmeldung").await, 1, "nichts gespeichert");

    // Der zweite Widerruf ist ohne Wirkung und ohne Eintrag; ein Wechsel ist 409.
    let (s, _) = anfrage_json(&app, "POST", &widerrufen, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/schluessel"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let aktionen: Vec<String> = spur(&pool).await.into_iter().map(|e| e.0).collect();
    assert_eq!(
        aktionen,
        vec!["einwurf_zugang_angelegt", "einwurf_zugang_widerrufen"]
    );
}

#[tokio::test]
async fn gekoppelter_elw_nimmt_keine_einwuerfe_an() {
    let (app, pool, admin) = setup().await;
    let (id, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let (zweiter, _) = zugang(&app, &admin, "FE2", "alarmmeldungen:write").await;
    org_koppeln(&pool).await;

    let (s, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        liste["gesperrt_grund"]
            .as_str()
            .unwrap()
            .contains("Hub Kreis"),
        "{liste}"
    );
    let (s, _) = anfrage_json(
        &app,
        "POST",
        LISTE,
        &admin,
        Some(&json!({ "name": "neu", "scope": "alarmmeldungen:write" })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/schluessel"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let antwort = einwerfen(&app, &schluessel, "alarmmeldung?text=a").await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);
    assert_eq!(anzahl(&pool, "alarmmeldung").await, 0);

    // Widerrufen bleibt möglich.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{zweiter}/widerrufen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

// ── Einwurf: Anmeldung über den Schlüssel ───────────────────────────────────────────────────

#[tokio::test]
async fn einwurf_landet_in_der_ablage_und_liest_nichts() {
    let (app, pool, admin) = setup().await;
    let (id, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;

    let antwort = einwerfen(
        &app,
        &schluessel,
        "alarmmeldung?ric=1234567&subric=a&text=B2%20Wohnung",
    )
    .await;
    assert_eq!(antwort.status, StatusCode::NO_CONTENT);
    assert!(antwort.body.is_empty(), "kein Body");
    assert_eq!(antwort.headers[header::CACHE_CONTROL], "no-store");

    let (org, zugang_id, rohdaten): (i64, String, String) =
        sqlx::query_as("SELECT org_id, zugang_id, rohdaten FROM alarmmeldung")
            .fetch_one(&pool)
            .await
            .unwrap();
    let admin_org: i64 =
        sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((org, zugang_id.as_str()), (admin_org, id.as_str()));
    assert_eq!(
        serde_json::from_str::<Value>(&rohdaten).unwrap(),
        json!({ "abfrage": [["ric", "1234567"], ["subric", "a"], ["text", "B2 Wohnung"]] })
    );
    assert_eq!(
        anzahl(&pool, "einsatz").await,
        0,
        "ein Einwurf legt keinen Einsatz an"
    );

    // Die Wiederholung bekommt dieselbe Antwort und legt keinen zweiten Eintrag an.
    let wieder = einwerfen(
        &app,
        &schluessel,
        "alarmmeldung?ric=1234567&subric=a&text=B2%20Wohnung",
    )
    .await;
    assert_eq!(wieder.status, StatusCode::NO_CONTENT);
    assert!(wieder.body.is_empty());
    let (eintraege, erneut): (i64, i64) =
        sqlx::query_as("SELECT COUNT(*), SUM(erneut_empfangen_anzahl) FROM alarmmeldung")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((eintraege, erneut), (1, 1));

    // Die Verwaltung zeigt „zuletzt genutzt“.
    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert!(
        liste["zugaenge"][0]["zuletzt_genutzt_at"].is_string(),
        "{liste}"
    );
}

#[tokio::test]
async fn post_wird_in_jedem_format_roh_abgelegt() {
    let (app, pool, admin) = setup().await;
    let (_, schluessel) = zugang(&app, &admin, "Divera", "alarmmeldungen:write").await;
    let pfad = format!("/api/v1/einwurf/{schluessel}/alarmmeldung");
    let json_body = r#"{"external_id": "LS-1", "stichwort": "RD 2"}"#;
    for (typ, body) in [
        ("application/json", json_body.as_bytes().to_vec()),
        (
            "application/x-www-form-urlencoded",
            b"external_id=LS-2&text=Brand".to_vec(),
        ),
        ("application/json", b"{kaputt".to_vec()),
        (
            "text/xml",
            b"<alarm><stichwort>B2</stichwort></alarm>".to_vec(),
        ),
    ] {
        let antwort = sende(
            &app,
            &pfad,
            Einwurf {
                methode: "POST",
                body: Some((typ, body)),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(antwort.status, StatusCode::NO_CONTENT, "{typ}");
    }
    let zeilen: Vec<(Option<String>, String)> =
        sqlx::query_as("SELECT external_id, rohdaten FROM alarmmeldung ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    let kennungen: Vec<Option<&str>> = zeilen.iter().map(|z| z.0.as_deref()).collect();
    assert_eq!(kennungen, vec![Some("LS-1"), Some("LS-2"), None, None]);
    let erste: Value = serde_json::from_str(&zeilen[0].1).unwrap();
    assert_eq!(erste["body"], json_body, "der Body bleibt Text");
}

#[tokio::test]
async fn leerer_und_zu_grosser_einwurf_werden_abgelehnt() {
    let (app, pool, admin) = setup().await;
    let (_, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let pfad = format!("/api/v1/einwurf/{schluessel}/alarmmeldung");

    let leer = sende(&app, &pfad, Einwurf::default()).await;
    assert_eq!(leer.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(leer.code(), "unprocessable");

    let gross = sende(
        &app,
        &pfad,
        Einwurf {
            methode: "POST",
            body: Some(("text/plain", vec![b'x'; 17 * 1024])),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(gross.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(gross.code(), "payload_too_large");

    let lange_abfrage = format!("{pfad}?text={}", "x".repeat(8 * 1024));
    let antwort = sende(&app, &lange_abfrage, Einwurf::default()).await;
    assert_eq!(antwort.status, StatusCode::PAYLOAD_TOO_LARGE);

    let kein_utf8 = sende(
        &app,
        &pfad,
        Einwurf {
            methode: "POST",
            body: Some(("text/plain", vec![0xff, 0xfe])),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(kein_utf8.status, StatusCode::BAD_REQUEST);
    assert_eq!(kein_utf8.code(), "invalid_field");

    assert_eq!(anzahl(&pool, "alarmmeldung").await, 0);
    // Eine Fehlerantwort trägt nur `error` und `code`.
    let schluessel_felder: Vec<String> = leer.json().as_object().unwrap().keys().cloned().collect();
    assert_eq!(schluessel_felder, vec!["code", "error"]);
}

#[tokio::test]
async fn unbekannter_und_abgelaufener_schluessel_sind_401() {
    let (app, pool, admin) = setup().await;
    let (id, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;

    let unbekannt = lifeline_hub::public_api::einwurf::neuer_schluessel();
    for falsch in [unbekannt.as_str(), "llh_ew_kurz", "irgendwas"] {
        let antwort = einwerfen(&app, falsch, "alarmmeldung?text=a").await;
        assert_eq!(antwort.status, StatusCode::UNAUTHORIZED, "{falsch}");
        assert_eq!(antwort.code(), "unauthorized");
        assert!(
            !String::from_utf8_lossy(&antwort.body).contains(falsch),
            "die Antwort wiederholt den Schlüssel nicht"
        );
    }

    sqlx::query("UPDATE einwurf_zugang SET gueltig_bis = '2020-01-01 00:00:00' WHERE id = ?")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();
    let antwort = einwerfen(&app, &schluessel, "alarmmeldung?text=a").await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);
    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(liste["zugaenge"][0]["is_abgelaufen"], true);
    assert_eq!(anzahl(&pool, "alarmmeldung").await, 0);
}

#[tokio::test]
async fn ein_zugang_schreibt_nur_fuer_seinen_zweck() {
    let (app, pool, admin) = setup().await;
    let (_, alarm) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let (_, ortung) = zugang(&app, &admin, "OsmAnd", "positionen:write").await;

    let antwort = einwerfen(&app, &alarm, "position?id=a&lat=1&lon=2").await;
    assert_eq!(antwort.status, StatusCode::FORBIDDEN);
    assert_eq!(antwort.code(), "missing_scope");
    let antwort = einwerfen(&app, &ortung, "alarmmeldung?text=a").await;
    assert_eq!(antwort.status, StatusCode::FORBIDDEN);
    assert_eq!(antwort.code(), "missing_scope");
    assert_eq!(anzahl(&pool, "alarmmeldung").await, 0);
    assert_eq!(anzahl(&pool, "position_letzte").await, 0);
}

#[tokio::test]
async fn es_gibt_keinen_leseweg_ueber_den_schluessel() {
    let (app, _pool, admin) = setup().await;
    let (_, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    einwerfen(&app, &schluessel, "alarmmeldung?text=a").await;

    for pfad in [
        format!("/api/v1/einwurf/{schluessel}"),
        format!("/api/v1/einwurf/{schluessel}/"),
        format!("/api/v1/einwurf/{schluessel}/alarmmeldungen"),
        format!("/api/v1/einwurf/{schluessel}/alarmmeldung/1"),
        "/api/v1/einwurf".to_string(),
    ] {
        let antwort = sende(&app, &pfad, Einwurf::default()).await;
        assert_eq!(antwort.status, StatusCode::NOT_FOUND, "{pfad}");
    }
    for methode in ["DELETE", "PUT", "PATCH"] {
        let antwort = sende(
            &app,
            &format!("/api/v1/einwurf/{schluessel}/alarmmeldung"),
            Einwurf {
                methode,
                ..Default::default()
            },
        )
        .await;
        assert_eq!(antwort.status, StatusCode::METHOD_NOT_ALLOWED, "{methode}");
    }

    // Der Schlüssel gilt an keiner anderen Route als Anmeldung (Spec `maschinenzugang`).
    let bearer = format!("Bearer {schluessel}");
    let machine = format!("Machine {schluessel}");
    for kopf in [bearer.as_str(), machine.as_str()] {
        let antwort = sende(
            &app,
            "/api/v1/me",
            Einwurf {
                kopf: vec![("authorization", kopf)],
                ..Default::default()
            },
        )
        .await;
        assert_eq!(antwort.status, StatusCode::UNAUTHORIZED, "{kopf}");
    }
    let antwort = sende(
        &app,
        &format!("/api/v1/me?schluessel={schluessel}"),
        Einwurf::default(),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);
    // Auch die Verwaltung der eigenen Oberfläche nimmt ihn nicht.
    let antwort = sende(
        &app,
        LISTE,
        Einwurf {
            kopf: vec![("authorization", bearer.as_str())],
            ..Default::default()
        },
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);
}

// ── Einwurf: TLS-Pflicht ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ohne_tls_und_ohne_schalter_ist_jeder_einwurf_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(liste["transport"], "keiner");

    let pfad = format!("/api/v1/einwurf/{schluessel}/alarmmeldung?text=a");
    let antwort = sende(&app, &pfad, Einwurf::default()).await;
    assert_eq!(antwort.status, StatusCode::FORBIDDEN);
    assert_eq!(antwort.code(), "tls_required");
    assert_eq!(antwort.headers[header::CACHE_CONTROL], "no-store");

    // Ein Kopf von einer Gegenstelle, die kein vertrauter Proxy ist, zählt nicht (in Tests ist
    // die Proxy-Liste leer).
    let antwort = sende(
        &app,
        &pfad,
        Einwurf {
            quelle: Some("198.51.100.201:4000"),
            kopf: vec![("x-forwarded-proto", "https")],
            ..Default::default()
        },
    )
    .await;
    assert_eq!(antwort.status, StatusCode::FORBIDDEN);
    assert_eq!(antwort.code(), "tls_required");

    // Vor der Suche: auch ein unbekannter Schlüssel bekommt 403, nicht 401, und zählt nirgends.
    let quelle: SocketAddr = "198.51.100.202:4000".parse().unwrap();
    for _ in 0..12 {
        let unbekannt = lifeline_hub::public_api::einwurf::neuer_schluessel();
        let antwort = sende(
            &app,
            &format!("/api/v1/einwurf/{unbekannt}/alarmmeldung?text=a"),
            Einwurf {
                quelle: Some("198.51.100.202:4000"),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(antwort.status, StatusCode::FORBIDDEN);
    }
    assert_eq!(
        lifeline_hub::auth::rate_limit::maschine::sperre(quelle.ip()),
        lifeline_hub::auth::rate_limit::Sperre::Frei
    );
    assert_eq!(anzahl(&pool, "alarmmeldung").await, 0);
}

#[tokio::test]
async fn mit_eigenem_tls_wird_der_einwurf_angenommen() {
    let (app, _pool) = setup_mit_optionen(RouterOptionen {
        tls: true,
        ..Default::default()
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(liste["transport"], "tls");
    assert_eq!(
        einwerfen(&app, &schluessel, "alarmmeldung?text=a")
            .await
            .status,
        StatusCode::NO_CONTENT
    );
}

// ── Einwurf: Drosselung und Zähler ──────────────────────────────────────────────────────────

#[tokio::test]
async fn der_31_einwurf_wird_gedrosselt() {
    let (app, pool, admin) = setup().await;
    let (_, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let (_, anderer) = zugang(&app, &admin, "FE2", "alarmmeldungen:write").await;
    for i in 0..30 {
        let antwort = einwerfen(&app, &schluessel, &format!("alarmmeldung?text={i}")).await;
        assert_eq!(antwort.status, StatusCode::NO_CONTENT, "Einwurf {}", i + 1);
    }
    let antwort = einwerfen(&app, &schluessel, "alarmmeldung?text=zu-viel").await;
    assert_eq!(antwort.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(antwort.code(), "rate_limited");
    let warten: u64 = antwort.headers[header::RETRY_AFTER]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!(warten >= 1);
    assert_eq!(
        anzahl(&pool, "alarmmeldung").await,
        30,
        "der 31. ist nicht gespeichert"
    );
    // Je Zugang getrennt.
    assert_eq!(
        einwerfen(&app, &anderer, "alarmmeldung?text=a")
            .await
            .status,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn zehn_unbekannte_schluessel_sperren_die_quelle_nur_auf_den_maschinenwegen() {
    let (app, _pool, admin) = setup().await;
    let (_, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let quelle = "198.51.100.211:5000";
    let von = |pfad: String| {
        let app = app.clone();
        async move {
            sende(
                &app,
                &pfad,
                Einwurf {
                    quelle: Some(quelle),
                    ..Default::default()
                },
            )
            .await
        }
    };
    for _ in 0..10 {
        let unbekannt = lifeline_hub::public_api::einwurf::neuer_schluessel();
        let antwort = von(format!("/api/v1/einwurf/{unbekannt}/alarmmeldung?text=a")).await;
        assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);
    }
    // Auch mit gültigem Schlüssel ist die Quelle jetzt gesperrt.
    let antwort = von(format!("/api/v1/einwurf/{schluessel}/alarmmeldung?text=a")).await;
    assert_eq!(antwort.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(antwort.code(), "rate_limited");
    assert!(antwort.headers.contains_key(header::RETRY_AFTER));
    // Die Anmeldung von Menschen bleibt von dieser Adresse möglich.
    let ip = quelle.parse::<SocketAddr>().unwrap().ip();
    assert!(!lifeline_hub::auth::rate_limit::ist_gesperrt(ip));
    // Eine andere Quelle ist nicht betroffen.
    assert_eq!(
        einwerfen(&app, &schluessel, "alarmmeldung?text=a")
            .await
            .status,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn widerrufene_schluessel_zaehlen_nicht_im_maschinenzaehler() {
    let (app, _pool, admin) = setup().await;
    let (id, alt) = zugang(&app, &admin, "BOSWatch alt", "alarmmeldungen:write").await;
    let (_, gueltig) = zugang(&app, &admin, "BOSWatch neu", "alarmmeldungen:write").await;
    anfrage_json(
        &app,
        "POST",
        &format!("{LISTE}/{id}/widerrufen"),
        &admin,
        None,
    )
    .await;
    let quelle = "198.51.100.212:5000";
    for _ in 0..12 {
        let antwort = sende(
            &app,
            &format!("/api/v1/einwurf/{alt}/alarmmeldung?text=a"),
            Einwurf {
                quelle: Some(quelle),
                ..Default::default()
            },
        )
        .await;
        assert_eq!(antwort.status, StatusCode::UNAUTHORIZED);
    }
    // Derselbe Absender hinter derselben Adresse mit dem neuen Schlüssel: geht.
    let antwort = sende(
        &app,
        &format!("/api/v1/einwurf/{gueltig}/alarmmeldung?text=a"),
        Einwurf {
            quelle: Some(quelle),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(antwort.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn tagesgrenze_der_ablage_ergibt_429() {
    let (app, pool, admin) = setup().await;
    let (id, schluessel) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    sqlx::query(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000) \
         INSERT INTO alarmmeldung (org_id, zugang_id, inhalt_hash, rohdaten, empfangen_at) \
         SELECT (SELECT org_id FROM einwurf_zugang WHERE id = ?1), ?1, 'h' || i, '{}', \
                datetime('now', '-1 minute') FROM n",
    )
    .bind(&id)
    .execute(&pool)
    .await
    .unwrap();
    let antwort = einwerfen(&app, &schluessel, "alarmmeldung?text=zu-viel").await;
    assert_eq!(antwort.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(antwort.headers[header::RETRY_AFTER], "3600");
    assert_eq!(anzahl(&pool, "alarmmeldung").await, 5000);
}

// ── Einwurf: Position ───────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn position_haengt_an_der_kennung_und_ersetzt_ohne_verlauf() {
    let (app, pool, admin) = setup().await;
    let (id, schluessel) = zugang(&app, &admin, "OsmAnd ELW", "positionen:write").await;
    let jetzt = chrono::Utc::now().timestamp();

    let antwort = einwerfen(
        &app,
        &schluessel,
        &format!(
            "position?id=elw1&lat=52.1&lon=9.3&timestamp={}&speed=12",
            jetzt - 60
        ),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::NO_CONTENT);
    assert!(antwort.body.is_empty());

    // Eine jüngere Position ersetzt; eine ältere wird nicht übernommen, antwortet aber 204.
    let juenger = format!("position?id=elw1&lat=52.2&lon=9.4&timestamp={}", jetzt - 30);
    assert_eq!(
        einwerfen(&app, &schluessel, &juenger).await.status,
        StatusCode::NO_CONTENT
    );
    let aelter = format!(
        "position?id=elw1&lat=50.0&lon=8.0&timestamp={}",
        jetzt - 300
    );
    assert_eq!(
        einwerfen(&app, &schluessel, &aelter).await.status,
        StatusCode::NO_CONTENT
    );

    let zeilen: Vec<(String, String, f64, f64)> =
        sqlx::query_as("SELECT zugang_id, kennung, lat, lon FROM position_letzte")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        zeilen,
        vec![(id, "elw1".to_string(), 52.2, 9.4)],
        "eine Zeile, kein Verlauf"
    );

    // POST mit Formular und eine zweite Kennung.
    let antwort = sende(
        &app,
        &format!("/api/v1/einwurf/{schluessel}/position"),
        Einwurf {
            methode: "POST",
            body: Some((
                "application/x-www-form-urlencoded",
                b"deviceid=fw2&lat=-33.9&lon=151.2".to_vec(),
            )),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(antwort.status, StatusCode::NO_CONTENT);
    assert_eq!(anzahl(&pool, "position_letzte").await, 2);
    assert_eq!(anzahl(&pool, "einsatz").await, 0);
}

#[tokio::test]
async fn ungueltige_position_wird_abgelehnt() {
    let (app, pool, admin) = setup().await;
    let (_, schluessel) = zugang(&app, &admin, "OsmAnd", "positionen:write").await;
    for abfrage in [
        "",
        "?lat=1&lon=2",
        "?id=a&lat=123&lon=2",
        "?id=a&lat=1&lon=2&timestamp=gestern",
    ] {
        let antwort = einwerfen(&app, &schluessel, &format!("position{abfrage}")).await;
        assert_eq!(antwort.status, StatusCode::BAD_REQUEST, "{abfrage}");
        assert_eq!(antwort.code(), "invalid_field");
    }
    let zukunft = chrono::Utc::now().timestamp() + 30 * 60;
    let antwort = einwerfen(
        &app,
        &schluessel,
        &format!("position?id=a&lat=1&lon=2&timestamp={zukunft}"),
    )
    .await;
    assert_eq!(antwort.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(antwort.code(), "unprocessable");
    assert_eq!(anzahl(&pool, "position_letzte").await, 0);
}

#[tokio::test]
async fn die_201_kennung_wird_abgelehnt() {
    let (app, pool, admin) = setup().await;
    let (id, schluessel) = zugang(&app, &admin, "Flotte", "positionen:write").await;
    sqlx::query(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200) \
         INSERT INTO position_letzte (org_id, zugang_id, kennung, lat, lon, gemessen_at, \
         empfangen_at, rohdaten) SELECT (SELECT org_id FROM einwurf_zugang WHERE id = ?1), ?1, \
         'k' || i, 1, 2, '2020-01-01 00:00:00', datetime('now'), '{}' FROM n",
    )
    .bind(&id)
    .execute(&pool)
    .await
    .unwrap();
    let antwort = einwerfen(&app, &schluessel, "position?id=neu&lat=1&lon=2").await;
    assert_eq!(antwort.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anzahl(&pool, "position_letzte").await, 200);
    // Eine bekannte Kennung geht weiter.
    assert_eq!(
        einwerfen(&app, &schluessel, "position?id=k7&lat=5&lon=6")
            .await
            .status,
        StatusCode::NO_CONTENT
    );
}

// ── Löschfristen im Purge-Lauf ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn purge_lauf_loescht_die_ablage_nach_frist() {
    let (app, pool, admin) = setup().await;
    let (_, alarm) = zugang(&app, &admin, "BOSWatch", "alarmmeldungen:write").await;
    let (_, ortung) = zugang(&app, &admin, "OsmAnd", "positionen:write").await;
    einwerfen(&app, &alarm, "alarmmeldung?text=alt").await;
    einwerfen(&app, &alarm, "alarmmeldung?text=jung").await;
    einwerfen(&app, &ortung, "position?id=alt&lat=1&lon=2").await;
    einwerfen(&app, &ortung, "position?id=jung&lat=1&lon=2").await;
    sqlx::query(
        "UPDATE alarmmeldung SET empfangen_at = datetime('now', '-8 days'), \
         erneut_empfangen_anzahl = 1, erneut_empfangen_at = datetime('now') \
         WHERE rohdaten LIKE '%alt%'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE alarmmeldung SET empfangen_at = datetime('now', '-6 days') \
         WHERE rohdaten LIKE '%jung%'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE position_letzte SET empfangen_at = datetime('now', '-25 hours') \
         WHERE kennung = 'alt'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE position_letzte SET empfangen_at = datetime('now', '-23 hours') \
         WHERE kennung = 'jung'",
    )
    .execute(&pool)
    .await
    .unwrap();

    lifeline_hub::einsatz::purge_scheduler::tick_einmal(
        &pool,
        &lifeline_hub::live::LiveHub::new(),
        chrono::Utc::now(),
    )
    .await;

    let rest: Vec<String> = sqlx::query_scalar("SELECT rohdaten FROM alarmmeldung")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rest.len(), 1, "{rest:?}");
    assert!(rest[0].contains("jung"));
    let kennungen: Vec<String> = sqlx::query_scalar("SELECT kennung FROM position_letzte")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(kennungen, vec!["jung".to_string()]);
    // Die Zugänge bleiben.
    assert_eq!(anzahl(&pool, "einwurf_zugang").await, 2);
}
