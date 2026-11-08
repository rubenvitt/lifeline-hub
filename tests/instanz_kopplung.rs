//! Instanzkopplung (LLH-1490, Specs `instanz-kopplung` und `org-admin-unterschrift`): zwei echte
//! Instanzen im selben Testprozess, je mit eigener DB und eigenem HTTP-Server auf Loopback. „Hub“
//! stellt den Code aus, „ELW“ löst ihn ein und meldet sich.

mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use lifeline_hub::auth::unterschrift::repo as unterschrift;
use lifeline_hub::instanz::identitaet::{self, Identitaet};
use lifeline_hub::instanz::signatur::{self, AnfrageDraft};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower::ServiceExt;

const RP: &str = "hub.example.org";
const ORIGIN: &str = "https://hub.example.org";

struct Instanz {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    adresse: String,
    admin: String,
    server: tokio::task::JoinHandle<()>,
}

impl Instanz {
    /// Hält den Server an: die Instanz ist danach nicht mehr erreichbar.
    async fn stoppen(&mut self) {
        let server = std::mem::replace(&mut self.server, tokio::spawn(async {}));
        server.abort();
        let _ = server.await;
    }
}

async fn instanz() -> Instanz {
    instanz_mit(false).await
}

/// Eine Instanz mit eigenem Server. `mit_adressen`: der Server reicht die Gegenstelle durch, damit
/// die IP-Sperre greift (nur der Test dafür, sie ist prozessweit).
async fn instanz_mit(mit_adressen: bool) -> Instanz {
    lifeline_hub::auth::unterschrift::set_rp(RP.into(), ORIGIN.into());
    let (app, pool) = common::setup_mit_pool().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = format!("http://{}", listener.local_addr().unwrap());
    let router = app.clone();
    let server = tokio::spawn(async move {
        if mit_adressen {
            axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        } else {
            axum::serve(listener, router).await.unwrap();
        }
    });
    Instanz {
        app,
        pool,
        adresse,
        admin,
        server,
    }
}

/// Registriert für den Admin (id 1, Org 1) einen Unterschriftsschlüssel direkt im Speicher (ohne
/// Browser-Zeremonie, die braucht einen echten Authenticator).
async fn schluessel(i: &Instanz, p: &SoftwarePasskey, bezeichnung: &str) -> i64 {
    let mut conn = i.pool.acquire().await.unwrap();
    let oeff = p.oeffentlich();
    unterschrift::create_lokal(
        &mut conn,
        &unterschrift::NeuerSchluessel {
            org_id: 1,
            benutzer_id: 1,
            benutzer_name: "Admin",
            credential_id: &p.credential_id,
            schluessel: &oeff,
            rp_id: RP,
            origin: ORIGIN,
            bezeichnung,
        },
    )
    .await
    .unwrap()
}

async fn code(hub: &Instanz) -> String {
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["code"].as_str().unwrap().to_string()
}

async fn einloesen(elw: &Instanz, adresse: &str, code: &str) -> (StatusCode, Value) {
    common::anfrage_json(
        &elw.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw.admin,
        Some(&json!({"adresse": adresse, "code": code})),
    )
    .await
}

async fn uebersicht(i: &Instanz) -> Value {
    let (s, v) = common::anfrage(&i.app, "GET", "/api/admin/instanz", &i.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

/// Eine zweite Org mit eigenem Admin (Passwort `<name>pw1`).
async fn org_admin(pool: &sqlx::SqlitePool, org: &str, name: &str) -> (i64, i64) {
    let (org_id, id) =
        common::fremde_org_anlegen(pool, org, name, &format!("{name}pw1"), "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    (org_id, id)
}

/// Hub mit Schlüssel, ELW gekoppelt.
async fn gekoppelt() -> (Instanz, Instanz) {
    let hub = instanz().await;
    let elw = instanz().await;
    schluessel(&hub, &SoftwarePasskey::new("a", [1u8; 32]), "Stick A").await;
    let c = code(&hub).await;
    let (s, v) = einloesen(&elw, &hub.adresse, &c).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (hub, elw)
}

async fn aktionen(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT aktion FROM admin_audit ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn koppeln_tauscht_schluessel_und_meldet_sich() {
    let (hub, elw) = gekoppelt().await;
    let hub_u = uebersicht(&hub).await;
    let elw_u = uebersicht(&elw).await;

    let k_elw = &elw_u["kopplungen"][0];
    assert_eq!(k_elw["richtung"], "meldet_sich");
    assert_eq!(k_elw["zustand"], "aktiv");
    assert_eq!(k_elw["gegenueber_fingerabdruck"], hub_u["fingerabdruck"]);
    assert_eq!(k_elw["gegenueber_adresse"], hub.adresse.as_str());
    assert_eq!(k_elw["org"]["fremde_org_name"], "Test-Orga");

    // Die erste Meldung hat die Kopplung am Hub aktiv gemacht.
    let k_hub = &hub_u["kopplungen"][0];
    assert_eq!(k_hub["richtung"], "wird_gemeldet");
    assert_eq!(k_hub["zustand"], "aktiv");
    assert_eq!(k_hub["gegenueber_fingerabdruck"], elw_u["fingerabdruck"]);
    assert!(k_hub["zuletzt_gesehen_at"].is_string());
    assert!(k_hub.get("gegenueber_adresse").is_none());

    // Der ELW kennt den Unterschriftsschlüssel des Hub-Admins.
    let fremde: Vec<&Value> = elw_u["schluessel"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["herkunft"] == "gegenueber")
        .collect();
    assert_eq!(fremde.len(), 1);
    assert_eq!(
        fremde[0]["fingerabdruck"],
        hub_u["schluessel"][0]["fingerabdruck"]
    );
    assert_eq!(fremde[0]["zustand"], "gueltig");

    assert!(aktionen(&hub.pool)
        .await
        .contains(&"instanz_code_eingeloest".to_string()));
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"instanz_gekoppelt".to_string()));
    let akteur: Option<i64> = sqlx::query_scalar(
        "SELECT akteur_id FROM admin_audit WHERE aktion = 'instanz_code_eingeloest'",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert_eq!(akteur, None, "vom Gegenüber ausgelöst, ohne Person");
}

#[tokio::test]
async fn code_nur_fuer_admin_mit_unterschriftsschluessel() {
    let hub = instanz().await;
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(v["error"]
        .as_str()
        .unwrap()
        .contains("Unterschriftsschlüssel"));

    common::benutzer_anlegen(&hub.app, &hub.admin, "helfer", "keine").await;
    let helfer = common::login_cookie(&hub.app, "helfer", "helferpw1").await;
    let (s, _) = common::anfrage(&hub.app, "POST", "/api/admin/instanz/codes", &helfer, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &helfer, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn code_gilt_einmal_und_nicht_abgelaufen() {
    let hub = instanz().await;
    let elw = instanz().await;
    let elw2 = instanz().await;
    schluessel(&hub, &SoftwarePasskey::new("a", [1u8; 32]), "Stick").await;
    let c = code(&hub).await;
    assert_eq!(
        einloesen(&elw, &hub.adresse, &c).await.0,
        StatusCode::CREATED
    );
    let (s, v) = einloesen(&elw2, &hub.adresse, &c).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    let c = code(&hub).await;
    sqlx::query("UPDATE instanz_kopplungscode SET laeuft_ab_at = '2000-01-01 00:00:00' WHERE eingeloest_at IS NULL")
        .execute(&hub.pool)
        .await
        .unwrap();
    let (s, _) = einloesen(&elw2, &hub.adresse, &c).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        uebersicht(&elw2).await["kopplungen"]
            .as_array()
            .unwrap()
            .len(),
        0
    );

    // Falsche Form
    let (s, _) = einloesen(&elw2, &hub.adresse, "ABCD").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = einloesen(&elw2, "http://hub.example.org", &c).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "http nur für Loopback");
}

#[tokio::test]
async fn zweite_org_erweitert_die_kopplung() {
    let (hub, elw) = gekoppelt().await;
    // Zweite Org am Hub mit eigenem Admin und Schlüssel
    let (org_hub2, _) = org_admin(&hub.pool, "DRK KV Süd", "hubsued").await;
    let hub_sued = common::login_cookie(&hub.app, "hubsued", "hubsuedpw1").await;
    let id_sued: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'hubsued'")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    {
        let p = SoftwarePasskey::new("sued", [3u8; 32]);
        let oeff = p.oeffentlich();
        let mut conn = hub.pool.acquire().await.unwrap();
        unterschrift::create_lokal(
            &mut conn,
            &unterschrift::NeuerSchluessel {
                org_id: org_hub2,
                benutzer_id: id_sued,
                benutzer_name: "Süd",
                credential_id: "sued",
                schluessel: &oeff,
                rp_id: RP,
                origin: ORIGIN,
                bezeichnung: "Stick",
            },
        )
        .await
        .unwrap();
    }
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/codes",
        &hub_sued,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let c = v["code"].as_str().unwrap().to_string();
    // Zweite Org am ELW
    org_admin(&elw.pool, "DRK Süd", "elwsued").await;
    let elw_sued = common::login_cookie(&elw.app, "elwsued", "elwsuedpw1").await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw_sued,
        Some(&json!({"adresse": hub.adresse, "code": c})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["org"]["fremde_org_name"], "DRK KV Süd");

    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM instanz_kopplung")
        .fetch_one(&elw.pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "eine Kopplung je Instanzpaar");
    let n: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM instanz_kopplung_org WHERE widerrufen_at IS NULL")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(n, 2);
    // Jede Org sieht nur ihre Zuordnung.
    assert_eq!(
        uebersicht(&elw).await["kopplungen"][0]["org"]["fremde_org_name"],
        "Test-Orga"
    );
}

/// Ein Proxy zwischen ELW und Hub, der den Schlüssel in der Anfrage oder der Antwort austauscht.
async fn mitte(ziel: String, anfrage_tauschen: bool) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = format!("http://{}", listener.local_addr().unwrap());
    let fremd = Identitaet::from_parts("mitte", [42u8; 32]).oeffentlich_b64();
    let app = axum::Router::new().route(
        "/api/instanz/koppeln",
        axum::routing::post(move |body: axum::body::Bytes| {
            let ziel = ziel.clone();
            let fremd = fremd.clone();
            async move {
                let mut v: Value = serde_json::from_slice(&body).unwrap();
                if anfrage_tauschen {
                    v["schluessel"] = json!(fremd);
                }
                let resp = reqwest::Client::new()
                    .post(format!("{ziel}/api/instanz/koppeln"))
                    .json(&v)
                    .send()
                    .await
                    .unwrap();
                let status = resp.status().as_u16();
                let kopf = resp
                    .headers()
                    .get("lifeline-instanz-antwort")
                    .map(|h| h.to_str().unwrap().to_string());
                let mut antwort: Value = resp.json().await.unwrap_or(Value::Null);
                if !anfrage_tauschen && status == 200 {
                    antwort["schluessel"] = json!(fremd);
                }
                let mut r = axum::response::Response::builder().status(status);
                if let Some(k) = kopf {
                    r = r.header("lifeline-instanz-antwort", k);
                }
                r.body(Body::from(antwort.to_string())).unwrap()
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    adresse
}

#[tokio::test]
async fn angreifer_in_der_mitte_faellt_auf() {
    let hub = instanz().await;
    let elw = instanz().await;
    schluessel(&hub, &SoftwarePasskey::new("a", [1u8; 32]), "Stick").await;

    // Schlüssel des ELW in der Anfrage getauscht: der Hub lehnt ab.
    let c = code(&hub).await;
    let proxy = mitte(hub.adresse.clone(), true).await;
    let (s, v) = einloesen(&elw, &proxy, &c).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM instanz_kopplung")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);

    // Schlüssel des Hubs in der Antwort getauscht: der ELW lehnt ab.
    let c = code(&hub).await;
    let proxy = mitte(hub.adresse.clone(), false).await;
    let (s, v) = einloesen(&elw, &proxy, &c).await;
    assert_eq!(s, StatusCode::BAD_GATEWAY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Prüfwert"), "{v}");
    assert_eq!(
        uebersicht(&elw).await["kopplungen"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    // Am Hub bleibt nur eine angebahnte Kopplung, die ohne erste Meldung verfällt.
    let zustand: String = sqlx::query_scalar("SELECT zustand FROM instanz_kopplung")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    assert_eq!(zustand, "angebahnt");
    lifeline_hub::instanz::repo::discard_angebahnte(&hub.pool, "2999-01-01 00:00:00")
        .await
        .unwrap();
    let zustand: String = sqlx::query_scalar("SELECT zustand FROM instanz_kopplung")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    assert_eq!(zustand, "widerrufen");
}

#[tokio::test]
async fn durchprobieren_sperrt_die_quelle() {
    let hub = instanz_mit(true).await;
    let elw = instanz().await;
    schluessel(&hub, &SoftwarePasskey::new("a", [1u8; 32]), "Stick").await;
    for _ in 0..10 {
        let (s, _) = einloesen(&elw, &hub.adresse, "AAAA-AAAA-AAAA-AAAA").await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    }
    let c = code(&hub).await;
    let (s, v) = einloesen(&elw, &hub.adresse, &c).await;
    assert_eq!(s, StatusCode::TOO_MANY_REQUESTS, "{v}");
}

// ── Signierte Anfragen ───────────────────────────────────────────────────────────────────────

/// Die Identität des ELW, wie sie in seiner DB steht.
async fn identitaet_von(i: &Instanz) -> Identitaet {
    identitaet::load_or_create(&i.pool).await.unwrap()
}

async fn melden_roh(
    hub: &Instanz,
    absender: &Identitaet,
    ziel: &str,
    body: &[u8],
    gesendet: &[u8],
    pfad: &str,
) -> StatusCode {
    let (token, _) = signatur::sign_anfrage(
        absender,
        &AnfrageDraft {
            ziel_kennung: ziel,
            methode: "POST",
            pfad,
            body,
        },
        chrono::Utc::now().timestamp(),
    );
    hub.app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/instanz/melden")
                .header(header::AUTHORIZATION, format!("Instanz {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(gesendet.to_vec()))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

fn meldung(protokoll: u32) -> Vec<u8> {
    json!({"name": "ELW", "softwarestand": "9.9.9", "protokoll": protokoll, "orgs": []})
        .to_string()
        .into_bytes()
}

#[tokio::test]
async fn melden_nur_signiert_einmalig_und_unveraendert() {
    let (hub, elw) = gekoppelt().await;
    let elw_i = identitaet_von(&elw).await;
    let hub_k = identitaet_von(&hub).await.kennung;
    let body = meldung(1);

    // Ohne Token
    let resp = hub
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/instanz/melden")
                .body(Body::from(body.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    assert_eq!(
        melden_roh(&hub, &elw_i, &hub_k, &body, &body, "/api/instanz/melden").await,
        StatusCode::OK
    );
    // Veränderter Body
    let mut anders = body.clone();
    anders.push(b' ');
    assert_eq!(
        melden_roh(&hub, &elw_i, &hub_k, &body, &anders, "/api/instanz/melden").await,
        StatusCode::UNAUTHORIZED
    );
    // Anderer Pfad im Token
    assert_eq!(
        melden_roh(&hub, &elw_i, &hub_k, &body, &body, "/api/instanz/anders").await,
        StatusCode::UNAUTHORIZED
    );
    // Anderes Ziel
    assert_eq!(
        melden_roh(
            &hub,
            &elw_i,
            "andere-instanz",
            &body,
            &body,
            "/api/instanz/melden"
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
    // Unbekannte Instanz
    let fremd = Identitaet::from_parts("unbekannt", [77u8; 32]);
    assert_eq!(
        melden_roh(&hub, &fremd, &hub_k, &body, &body, "/api/instanz/melden").await,
        StatusCode::UNAUTHORIZED
    );

    // Wiederholung derselben Anfrage
    let (token, _) = signatur::sign_anfrage(
        &elw_i,
        &AnfrageDraft {
            ziel_kennung: &hub_k,
            methode: "POST",
            pfad: "/api/instanz/melden",
            body: &body,
        },
        chrono::Utc::now().timestamp(),
    );
    let senden = || {
        hub.app.clone().oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/instanz/melden")
                .header(header::AUTHORIZATION, format!("Instanz {token}"))
                .body(Body::from(body.clone()))
                .unwrap(),
        )
    };
    assert_eq!(senden().await.unwrap().status(), StatusCode::OK);
    assert_eq!(senden().await.unwrap().status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn zu_alter_stand_zeigt_update_noetig() {
    let (hub, elw) = gekoppelt().await;
    let elw_i = identitaet_von(&elw).await;
    let hub_k = identitaet_von(&hub).await.kennung;
    let body = meldung(lifeline_hub::instanz::PROTOKOLL + 2);
    assert_eq!(
        melden_roh(&hub, &elw_i, &hub_k, &body, &body, "/api/instanz/melden").await,
        StatusCode::OK
    );
    assert_eq!(
        uebersicht(&hub).await["kopplungen"][0]["protokoll"],
        "update_hier"
    );
}

#[tokio::test]
async fn meldung_ueber_der_listengrenze_ist_400() {
    let (hub, elw) = gekoppelt().await;
    let elw_i = identitaet_von(&elw).await;
    let hub_k = identitaet_von(&hub).await.kennung;
    let orgs: Vec<Value> = (0..=lifeline_hub::instanz::melden::ORGS_MAX)
        .map(|i| json!({"org": format!("x/{i}"), "unterschrift_stand": 0}))
        .collect();
    let body = json!({"name": "ELW", "softwarestand": "9.9.9", "protokoll": 1, "orgs": orgs})
        .to_string()
        .into_bytes();
    assert_eq!(
        melden_roh(&hub, &elw_i, &hub_k, &body, &body, "/api/instanz/melden").await,
        StatusCode::BAD_REQUEST
    );
}

// ── Widerruf ─────────────────────────────────────────────────────────────────────────────────

async fn widerrufen(i: &Instanz) -> Value {
    let id = uebersicht(i).await["kopplungen"][0]["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &i.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{id}/widerrufen"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

async fn elw_meldet(elw: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::melden::run_durchlauf(&elw.pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn hub_widerruft_und_elw_erfaehrt_es_beim_melden() {
    let (hub, elw) = gekoppelt().await;
    assert_eq!(widerrufen(&hub).await["zustand"], "widerrufen");
    elw_meldet(&elw).await;
    let k = &uebersicht(&elw).await["kopplungen"][0];
    assert_eq!(k["zustand"], "vom_gegenueber_widerrufen");
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"instanz_kopplung_vom_gegenueber_widerrufen".to_string()));
    let gemeldet: Option<String> =
        sqlx::query_scalar("SELECT widerruf_gemeldet_at FROM instanz_kopplung_org")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert!(gemeldet.is_some());
    // Danach meldet sich der ELW nicht mehr.
    let faellig =
        lifeline_hub::instanz::repo::list_faellige_meldungen(&elw.pool, "2999-01-01 00:00:00")
            .await
            .unwrap();
    assert!(faellig.is_empty());
}

#[tokio::test]
async fn elw_widerruft_und_hub_erfaehrt_es_sofort() {
    let (hub, elw) = gekoppelt().await;
    let w = widerrufen(&elw).await;
    assert_eq!(w["zustand"], "widerrufen", "{w}");
    let u = uebersicht(&hub).await;
    assert_eq!(
        u["kopplungen"][0]["zustand"], "vom_gegenueber_widerrufen",
        "{w}\n{u}"
    );
}

#[tokio::test]
async fn elw_widerruft_ohne_netz() {
    let (mut hub, elw) = gekoppelt().await;
    hub.stoppen().await;
    assert_eq!(widerrufen(&elw).await["zustand"], "widerrufen");
    assert_eq!(uebersicht(&hub).await["kopplungen"][0]["zustand"], "aktiv");
}

#[tokio::test]
async fn ausfall_des_gegenuebers_steht_an_der_kopplung() {
    let (mut hub, elw) = gekoppelt().await;
    hub.stoppen().await;
    elw_meldet(&elw).await;
    let k = &uebersicht(&elw).await["kopplungen"][0];
    assert!(
        k["letzter_fehler"]
            .as_str()
            .unwrap()
            .contains("nicht erreichbar"),
        "{k}"
    );
    assert_eq!(k["zustand"], "aktiv");
}

#[tokio::test]
async fn instanz_ohne_kopplung_meldet_nichts() {
    let i = instanz().await;
    lifeline_hub::instanz::melden::run_durchlauf(&i.pool)
        .await
        .unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM instanz_kopplung")
        .fetch_one(&i.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

// ── Unterschriftsschlüssel ───────────────────────────────────────────────────────────────────

async fn gegenzeichnen(hub: &Instanz, id: i64, mit: &SoftwarePasskey) -> (StatusCode, Value) {
    let (s, start) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/admin/instanz/unterschrift/{id}/gegenzeichnen/start"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{start}");
    let erklaerung = start["erklaerung"].as_str().unwrap();
    let assertion = mit.sign(erklaerung, ORIGIN, RP, 0x05);
    common::anfrage_json(
        &hub.app,
        "POST",
        &format!("/api/admin/instanz/unterschrift/{id}/gegenzeichnen/abschluss"),
        &hub.admin,
        Some(&json!({"zeremonie": start["zeremonie"], "assertion": assertion})),
    )
    .await
}

fn gueltige_fremde(u: &Value) -> Vec<String> {
    u["schluessel"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["herkunft"] == "gegenueber" && s["zustand"] == "gueltig")
        .map(|s| s["fingerabdruck"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn neuer_schluessel_braucht_gegenzeichnung_und_wird_nachgeliefert() {
    let (hub, elw) = gekoppelt().await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let id_b = schluessel(&hub, &b, "Stick B").await;
    let hub_u = uebersicht(&hub).await;
    let zeile_b = hub_u["schluessel"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id_b)
        .unwrap()
        .clone();
    assert_eq!(zeile_b["zustand"], "wartet_auf_gegenzeichnung");

    // Ein wartender Schlüssel geht nicht hinaus.
    elw_meldet(&elw).await;
    assert_eq!(gueltige_fremde(&uebersicht(&elw).await).len(), 1);

    // Mit dem eigenen, noch wartenden Schlüssel kann man nicht gegenzeichnen.
    let (s, _) = gegenzeichnen(&hub, id_b, &b).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, v) = gegenzeichnen(&hub, id_b, &a).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zustand"], "gueltig");

    elw_meldet(&elw).await;
    let fremde = gueltige_fremde(&uebersicht(&elw).await);
    assert_eq!(fremde.len(), 2);
    assert!(fremde.contains(&zeile_b["fingerabdruck"].as_str().unwrap().to_string()));
    assert!(aktionen(&hub.pool)
        .await
        .contains(&"unterschrift_gegengezeichnet".to_string()));
}

#[tokio::test]
async fn untergeschobener_schluessel_wird_am_elw_verworfen() {
    let (hub, elw) = gekoppelt().await;
    // Ein kompromittierter Hub schreibt einen gültigen Schlüssel ohne Gegenzeichnung.
    sqlx::query(
        "INSERT INTO unterschrift_schluessel (org_id, herkunft, benutzer_id, benutzer_name, \
         credential_id, alg, schluessel, rp_id, origin, bezeichnung, fingerabdruck, zustand, stand) \
         VALUES (1, 'lokal', 1, 'Mallory', 'boese', 'es256', ?, ?, ?, 'boese', 'X', 'gueltig', 99)",
    )
    .bind(SoftwarePasskey::new("boese", [9u8; 32]).oeffentlich())
    .bind(RP)
    .bind(ORIGIN)
    .execute(&hub.pool)
    .await
    .unwrap();
    elw_meldet(&elw).await;
    let u = uebersicht(&elw).await;
    assert_eq!(gueltige_fremde(&u).len(), 1);
    assert!(
        u["kopplungen"][0]["hinweis"]
            .as_str()
            .unwrap()
            .contains("abgelehnt"),
        "{u}"
    );
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"unterschrift_abgelehnt".to_string()));
}

#[tokio::test]
async fn letzter_schluessel_bleibt_solange_gekoppelt_und_widerruf_wandert() {
    let (hub, elw) = gekoppelt().await;
    let id_a: i64 =
        sqlx::query_scalar("SELECT id FROM unterschrift_schluessel WHERE credential_id = 'a'")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    let pfad = format!("/api/admin/instanz/unterschrift/{id_a}/widerrufen");
    let (s, v) = common::anfrage(&hub.app, "POST", &pfad, &hub.admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");

    // Mit einem zweiten, gegengezeichneten Schlüssel geht es; der Widerruf erreicht den ELW.
    let id_b = schluessel(&hub, &SoftwarePasskey::new("b", [2u8; 32]), "B").await;
    assert_eq!(
        gegenzeichnen(&hub, id_b, &SoftwarePasskey::new("a", [1u8; 32]))
            .await
            .0,
        StatusCode::OK
    );
    let (s, v) = common::anfrage(&hub.app, "POST", &pfad, &hub.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zustand"], "widerrufen");
    elw_meldet(&elw).await;
    let u = uebersicht(&elw).await;
    let widerrufen = u["schluessel"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["herkunft"] == "gegenueber" && s["zustand"] == "widerrufen")
        .count();
    assert_eq!(widerrufen, 1);
    assert_eq!(gueltige_fremde(&u).len(), 1);
}

#[tokio::test]
async fn deaktivieren_widerruft_die_schluessel_des_kontos() {
    let hub = instanz().await;
    // Zweiter Admin, damit der erste deaktiviert werden darf.
    common::benutzer_anlegen(&hub.app, &hub.admin, "zweit", "keine").await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'zweit'")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(id)
        .execute(&hub.pool)
        .await
        .unwrap();
    {
        let p = SoftwarePasskey::new("z", [4u8; 32]);
        let oeff = p.oeffentlich();
        let mut conn = hub.pool.acquire().await.unwrap();
        unterschrift::create_lokal(
            &mut conn,
            &unterschrift::NeuerSchluessel {
                org_id: 1,
                benutzer_id: id,
                benutzer_name: "zweit",
                credential_id: "z",
                schluessel: &oeff,
                rp_id: RP,
                origin: ORIGIN,
                bezeichnung: "Z",
            },
        )
        .await
        .unwrap();
    }
    let (s, _) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/benutzer/{id}/deaktivieren"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let zustand: String =
        sqlx::query_scalar("SELECT zustand FROM unterschrift_schluessel WHERE credential_id = 'z'")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(zustand, "widerrufen");
    assert!(aktionen(&hub.pool)
        .await
        .contains(&"unterschrift_widerrufen".to_string()));
}

#[tokio::test]
async fn registrieren_nur_fuer_admins() {
    let hub = instanz().await;
    common::benutzer_anlegen(&hub.app, &hub.admin, "helfer", "keine").await;
    let helfer = common::login_cookie(&hub.app, "helfer", "helferpw1").await;
    let (s, _) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/unterschrift/registrieren/start",
        &helfer,
        Some(r#"{"bezeichnung":"Stick"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

// ── Befunde aus dem Review (08.11.2026) ──────────────────────────────────────────────────────

/// Löst einen Code am Hub direkt ein, als `als` (Kennung) mit dem Schlüssel `schluessel_von`,
/// ohne danach zu melden. Liefert den Status.
async fn koppeln_roh(
    hub: &Instanz,
    code: &str,
    als: &str,
    schluessel_von: &Identitaet,
    org: (&str, &str),
) -> StatusCode {
    use lifeline_hub::instanz::code as kcode;
    let c = kcode::normalize(code).unwrap();
    let a = kcode::derive(&c);
    let schluessel = schluessel_von.oeffentlich_b64();
    let t = kcode::transkript_einloeser(
        &a.suche,
        als,
        &schluessel,
        org.0,
        org.1,
        "Angreifer",
        "j-roh",
    );
    let body = json!({
        "suche": a.suche, "jti": "j-roh", "protokoll": 1, "kennung": als, "schluessel": schluessel,
        "name": "Angreifer", "softwarestand": "1", "org": {"kennung": org.0, "name": org.1},
        "pruefwert": kcode::pruefwert(&a.k_einloeser, &t),
    });
    hub.app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/instanz/koppeln")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// Org Y am Hub mit eigenem Admin und Schlüssel; liefert einen Code dieser Org.
async fn code_org_y(hub: &Instanz) -> String {
    let (org_y, id_y) = org_admin(&hub.pool, "Org Y", "yadmin").await;
    {
        let p = SoftwarePasskey::new("y", [6u8; 32]);
        let oeff = p.oeffentlich();
        let mut conn = hub.pool.acquire().await.unwrap();
        unterschrift::create_lokal(
            &mut conn,
            &unterschrift::NeuerSchluessel {
                org_id: org_y,
                benutzer_id: id_y,
                benutzer_name: "Y",
                credential_id: "y",
                schluessel: &oeff,
                rp_id: RP,
                origin: ORIGIN,
                bezeichnung: "Y",
            },
        )
        .await
        .unwrap();
    }
    let y = common::login_cookie(&hub.app, "yadmin", "yadminpw1").await;
    let (s, v) = common::anfrage(&hub.app, "POST", "/api/admin/instanz/codes", &y, None).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["code"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn fremder_schluessel_unter_bekannter_kennung_wird_abgelehnt() {
    let (hub, elw) = gekoppelt().await;
    let elw_i = identitaet_von(&elw).await;
    let schluessel_vorher: String =
        sqlx::query_scalar("SELECT gegenueber_schluessel FROM instanz_kopplung")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    let c = code_org_y(&hub).await;
    let angreifer = Identitaet::from_parts("egal", [99u8; 32]);
    let s = koppeln_roh(&hub, &c, &elw_i.kennung, &angreifer, ("m/1", "M")).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let schluessel_nachher: String =
        sqlx::query_scalar("SELECT gegenueber_schluessel FROM instanz_kopplung")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(schluessel_vorher, schluessel_nachher);
}

#[tokio::test]
async fn unbestaetigte_org_zuordnung_verfaellt() {
    let (hub, elw) = gekoppelt().await;
    let elw_i = identitaet_von(&elw).await;
    let c = code_org_y(&hub).await;
    // Der echte ELW löst ein, verwirft aber die Antwort (meldet die Org nie).
    let s = koppeln_roh(&hub, &c, &elw_i.kennung, &elw_i, ("elw/9", "Org ELW Y")).await;
    assert_eq!(s, StatusCode::OK);
    lifeline_hub::instanz::repo::discard_angebahnte(&hub.pool, "2999-01-01 00:00:00")
        .await
        .unwrap();
    let aktiv: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM instanz_kopplung_org WHERE widerrufen_at IS NULL")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(
        aktiv, 1,
        "nur die bestätigte Zuordnung der ersten Org bleibt"
    );
    assert_eq!(uebersicht(&hub).await["kopplungen"][0]["zustand"], "aktiv");
}

#[tokio::test]
async fn alter_offener_widerruf_zerstoert_die_neue_kopplung_nicht() {
    let (hub, elw) = gekoppelt().await;
    // ELW widerruft ohne Netz: Zeile bleibt ungemeldet.
    sqlx::query("UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-08 10:00:00'")
        .execute(&elw.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE instanz_kopplung SET zustand = 'widerrufen'")
        .execute(&elw.pool)
        .await
        .unwrap();
    // Der Hub-Admin widerruft ebenfalls, dann wird neu gekoppelt.
    widerrufen(&hub).await;
    let c = code(&hub).await;
    let (s, v) = einloesen(&elw, &hub.adresse, &c).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["zustand"], "aktiv", "{v}");
    elw_meldet(&elw).await;
    assert_eq!(
        uebersicht(&hub).await["kopplungen"][0]["org"].get("widerrufen_at"),
        None
    );
    assert_eq!(uebersicht(&elw).await["kopplungen"][0]["zustand"], "aktiv");
}

#[tokio::test]
async fn schluessel_einer_widerrufenen_zuordnung_gelten_nicht_mehr() {
    let (hub, elw) = gekoppelt().await;
    widerrufen(&hub).await;
    elw_meldet(&elw).await;
    assert!(gueltige_fremde(&uebersicht(&elw).await).is_empty());
}
