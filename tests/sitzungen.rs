//! Sitzungsliste und Beenden ohne Deaktivieren über den echten Router (LFH-1092).
//!
//! Spec: `/mnt/project-files/lfh-1092/specs/sitzungsverwaltung/spec.md`. Die Unit-Tests in
//! `auth::session` prüfen Liste und Löschen isoliert; hier stehen Rechte, Statuscodes, Spur und
//! das sofortige Ende offener Live-Ströme.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use std::time::Duration;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, fremde_org_anlegen, login_cookie,
    setup_mit_pool, setup_mit_pool_und_live,
};

const FIREFOX: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
const IPAD: &str = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 \
                    (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/// Anmeldung mit Passwort und `User-Agent`; liefert das Cookie.
async fn anmelden(app: &axum::Router, name: &str, passwort: &str, ua: &str) -> String {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::USER_AGENT, ua)
                .body(Body::from(
                    json!({"benutzername": name, "passwort": passwort}).to_string(),
                ))
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

async fn liste(app: &axum::Router, cookie: &str, uri: &str) -> Vec<Value> {
    let (s, v) = anfrage(app, "GET", uri, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v.as_array().unwrap().clone()
}

/// Kennung der Sitzung mit diesem Gerät.
fn kennung(liste: &[Value], geraet: &str) -> String {
    liste
        .iter()
        .find(|s| s["geraet"] == geraet)
        .unwrap_or_else(|| panic!("{geraet} fehlt in {liste:?}"))["kennung"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn me(app: &axum::Router, cookie: &str) -> StatusCode {
    anfrage(app, "GET", "/api/auth/me", cookie, None).await.0
}

async fn benutzer_id(pool: &sqlx::SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Ereignis, Benutzer der Anmeldespur.
async fn anmeldespur(pool: &sqlx::SqlitePool) -> Vec<(String, Option<String>)> {
    sqlx::query_as(
        "SELECT ereignis, benutzername FROM auth_audit WHERE ereignis = 'sitzung_beendet' ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Aktion, Akteur, Ziel, Detail der Admin-Spur.
async fn adminspur(
    pool: &sqlx::SqlitePool,
) -> Vec<(String, Option<String>, String, Option<String>)> {
    sqlx::query_as(
        "SELECT aktion, akteur_name, ziel, detail FROM admin_audit \
         WHERE aktion = 'sitzung_beendet' ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Konto-Zustand, der beim Beenden unberührt bleiben muss.
async fn konto(pool: &sqlx::SqlitePool, id: i64) -> (i64, String, i64) {
    sqlx::query_as("SELECT aktiv, passwort_hash, totp_aktiviert FROM benutzer WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ---------- selbst ----------

#[tokio::test]
async fn liste_zeigt_geraet_und_markiert_die_aktuelle() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let firefox = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let _ipad = anmelden(&app, "marlene", "marlenepw1", IPAD).await;

    let sitzungen = liste(&app, &firefox, "/api/auth/sitzungen").await;
    assert_eq!(sitzungen.len(), 2, "{sitzungen:?}");
    let aktuell: Vec<(&str, bool)> = sitzungen
        .iter()
        .map(|s| {
            (
                s["geraet"].as_str().unwrap(),
                s["aktuell"].as_bool().unwrap(),
            )
        })
        .collect();
    assert!(aktuell.contains(&("Firefox · Windows", true)));
    assert!(aktuell.contains(&("Safari · iPadOS", false)));
    for s in &sitzungen {
        assert_eq!(s["kennung"].as_str().unwrap().len(), 32);
        assert!(s["angemeldet_at"].is_string() && s["zuletzt_gesehen_at"].is_string());
        assert!(s.get("token_hash").is_none());
    }
}

#[tokio::test]
async fn ohne_user_agent_fehlt_das_geraet() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let sitzungen = liste(&app, &admin, "/api/auth/sitzungen").await;
    assert_eq!(sitzungen.len(), 1);
    assert!(
        sitzungen[0].as_object().unwrap().get("geraet").is_none(),
        "unbekannt heißt: Feld fehlt"
    );
}

#[tokio::test]
async fn eine_eigene_beenden_laesst_das_konto_unveraendert() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let firefox = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let ipad = anmelden(&app, "marlene", "marlenepw1", IPAD).await;
    let vorher = konto(&pool, marlene_id).await;

    // Die iPad-Sitzung entstand per SSO; die Spur nennt diesen Weg, nicht „passwort“ (LFH-1152).
    sqlx::query("UPDATE session SET anmeldeweg = 'oidc' WHERE geraet = 'Safari · iPadOS'")
        .execute(&pool)
        .await
        .unwrap();
    let k = kennung(
        &liste(&app, &firefox, "/api/auth/sitzungen").await,
        "Safari · iPadOS",
    );
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{k}"),
        &firefox,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["beendet"], 1);
    let weg: String =
        sqlx::query_scalar("SELECT provider FROM auth_audit WHERE ereignis = 'sitzung_beendet'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(weg, "oidc");

    assert_eq!(me(&app, &ipad).await, StatusCode::UNAUTHORIZED);
    assert_eq!(me(&app, &firefox).await, StatusCode::OK);
    assert_eq!(
        konto(&pool, marlene_id).await,
        vorher,
        "aktiv, Passwort, Zweitfaktor unverändert"
    );
    anmelden(&app, "marlene", "marlenepw1", IPAD).await;
    assert_eq!(
        anmeldespur(&pool).await,
        vec![("sitzung_beendet".to_string(), Some("marlene".to_string()))]
    );

    // Schon beendet: 404, kein zweiter Eintrag.
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{k}"),
        &firefox,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(anmeldespur(&pool).await.len(), 1);
}

/// Eine Sitzung von vor LFH-1152 kennt ihren Weg nicht: ihr Beenden schreibt `unbekannt`.
#[tokio::test]
async fn beenden_einer_sitzung_ohne_anmeldeweg_schreibt_unbekannt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let firefox = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    anmelden(&app, "marlene", "marlenepw1", IPAD).await;
    sqlx::query("UPDATE session SET anmeldeweg = NULL WHERE geraet = 'Safari · iPadOS'")
        .execute(&pool)
        .await
        .unwrap();

    let k = kennung(
        &liste(&app, &firefox, "/api/auth/sitzungen").await,
        "Safari · iPadOS",
    );
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{k}"),
        &firefox,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let weg: String =
        sqlx::query_scalar("SELECT provider FROM auth_audit WHERE ereignis = 'sitzung_beendet'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(weg, "unbekannt");
}

/// Die Spur schlägt nie nach außen durch: das Beenden ist schon geschehen, wenn sie schreibt.
#[tokio::test]
async fn fehlende_spur_verhindert_das_beenden_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let firefox = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let ipad = anmelden(&app, "marlene", "marlenepw1", IPAD).await;
    sqlx::query(
        "CREATE TRIGGER spur_sperren BEFORE INSERT ON auth_audit \
         BEGIN SELECT RAISE(ABORT, 'Spur gesperrt'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let k = kennung(
        &liste(&app, &firefox, "/api/auth/sitzungen").await,
        "Safari · iPadOS",
    );
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{k}"),
        &firefox,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(me(&app, &ipad).await, StatusCode::UNAUTHORIZED);
    assert!(anmeldespur(&pool).await.is_empty());
}

#[tokio::test]
async fn die_aktuelle_ist_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let k = liste(&app, &admin, "/api/auth/sitzungen").await[0]["kennung"]
        .as_str()
        .unwrap()
        .to_string();
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{k}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(me(&app, &admin).await, StatusCode::OK);
    assert!(anmeldespur(&pool).await.is_empty());
}

#[tokio::test]
async fn fremde_kennung_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let k_admin = liste(&app, &admin, "/api/auth/sitzungen").await[0]["kennung"]
        .as_str()
        .unwrap()
        .to_string();

    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{k_admin}"),
        &marlene,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::NOT_FOUND,
        "die Kennung eines anderen Kontos gibt es für marlene nicht"
    );
    assert_eq!(me(&app, &admin).await, StatusCode::OK);
}

#[tokio::test]
async fn alle_anderen_beenden_schreibt_je_sitzung_einen_eintrag() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let ich = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let andere = [
        anmelden(&app, "marlene", "marlenepw1", IPAD).await,
        anmelden(&app, "marlene", "marlenepw1", IPAD).await,
        anmelden(&app, "marlene", "marlenepw1", FIREFOX).await,
    ];

    let (s, v) = anfrage(
        &app,
        "POST",
        "/api/auth/sitzungen/andere-beenden",
        &ich,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["beendet"], 3);
    for c in &andere {
        assert_eq!(me(&app, c).await, StatusCode::UNAUTHORIZED);
    }
    assert_eq!(me(&app, &ich).await, StatusCode::OK);
    assert_eq!(
        me(&app, &admin).await,
        StatusCode::OK,
        "andere Konten bleiben"
    );
    assert_eq!(anmeldespur(&pool).await.len(), 3);
    assert_eq!(liste(&app, &ich, "/api/auth/sitzungen").await.len(), 1);

    // Nichts mehr zu beenden: 200 mit 0, kein Eintrag.
    let (s, v) = anfrage(
        &app,
        "POST",
        "/api/auth/sitzungen/andere-beenden",
        &ich,
        None,
    )
    .await;
    assert_eq!((s, v["beendet"].as_u64()), (StatusCode::OK, Some(0)));
    assert_eq!(anmeldespur(&pool).await.len(), 3);
}

#[tokio::test]
async fn schreiben_traegt_die_bindung_an_den_erwarteten_benutzer() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sitzungen/andere-beenden")
                .header(header::COOKIE, &admin)
                .header("x-erwarteter-benutzer-id", "999")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::PRECONDITION_FAILED);
}

#[tokio::test]
async fn ohne_sitzung_ist_401() {
    let (app, _pool) = setup_mit_pool().await;
    for (m, uri) in [
        ("GET", "/api/auth/sitzungen"),
        ("POST", "/api/auth/sitzungen/andere-beenden"),
        ("DELETE", "/api/auth/sitzungen/00"),
        ("GET", "/api/benutzer/1/sitzungen"),
    ] {
        let (s, _) = anfrage(&app, m, uri, "lifeline_sid=unsinn", None).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "{m} {uri}");
    }
}

// ---------- Admin ----------

#[tokio::test]
async fn admin_sieht_und_beendet_sitzungen_einer_person() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let firefox = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let ipad = anmelden(&app, "marlene", "marlenepw1", IPAD).await;
    let vorher = konto(&pool, marlene_id).await;
    let uri = format!("/api/benutzer/{marlene_id}/sitzungen");

    let sitzungen = liste(&app, &admin, &uri).await;
    assert_eq!(sitzungen.len(), 2);
    assert!(
        sitzungen.iter().all(|s| s["aktuell"] == false),
        "keine ist die des Admins"
    );

    let k = kennung(&sitzungen, "Safari · iPadOS");
    let (s, v) = anfrage(&app, "DELETE", &format!("{uri}/{k}"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(me(&app, &ipad).await, StatusCode::UNAUTHORIZED);
    assert_eq!(me(&app, &firefox).await, StatusCode::OK);

    let spur = adminspur(&pool).await;
    assert_eq!(spur.len(), 1);
    assert_eq!(spur[0].1.as_deref(), Some("admin"));
    assert_eq!(spur[0].2, "marlene");
    // Strukturiert (LFH-1152): die Verwaltung zeigt die Anmeldezeit in Zone und Format der
    // Organisation, deshalb liegt sie hier als UTC-Wert und nicht als fertiger Text.
    let detail: Value = serde_json::from_str(spur[0].3.as_deref().unwrap()).unwrap();
    assert_eq!(detail["geraet"], "Safari · iPadOS");
    assert!(
        detail["angemeldet_at"].as_str().unwrap().starts_with("20"),
        "{detail}"
    );
    assert!(anmeldespur(&pool).await.is_empty(), "keine Selbst-Spur");

    let (s, v) = anfrage(&app, "POST", &format!("{uri}/beenden"), &admin, None).await;
    assert_eq!((s, v["beendet"].as_u64()), (StatusCode::OK, Some(1)));
    assert_eq!(me(&app, &firefox).await, StatusCode::UNAUTHORIZED);
    assert_eq!(me(&app, &admin).await, StatusCode::OK);
    assert_eq!(adminspur(&pool).await.len(), 2);
    assert_eq!(
        konto(&pool, marlene_id).await,
        vorher,
        "marlene bleibt aktiv, Passwort unverändert"
    );
    anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
}

#[tokio::test]
async fn admin_am_eigenen_konto_behaelt_die_aktuelle() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let zweite = anmelden(&app, "admin", "startpw12", IPAD).await;
    let admin_id = benutzer_id(&pool, "admin").await;
    let uri = format!("/api/benutzer/{admin_id}/sitzungen");

    let sitzungen = liste(&app, &admin, &uri).await;
    let eigene = sitzungen
        .iter()
        .find(|s| s["aktuell"] == true)
        .expect("markiert");
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{uri}/{}", eigene["kennung"].as_str().unwrap()),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (s, v) = anfrage(&app, "POST", &format!("{uri}/beenden"), &admin, None).await;
    assert_eq!((s, v["beendet"].as_u64()), (StatusCode::OK, Some(1)));
    assert_eq!(me(&app, &zweite).await, StatusCode::UNAUTHORIZED);
    assert_eq!(me(&app, &admin).await, StatusCode::OK);
}

#[tokio::test]
async fn admin_einer_fremden_organisation_bekommt_404() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, fremd_id) = fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw12", "keine").await;
    let fremd = anmelden(&app, "fremd", "fremdpw12", FIREFOX).await;
    let uri = format!("/api/benutzer/{fremd_id}/sitzungen");
    let k = liste(&app, &fremd, "/api/auth/sitzungen").await[0]["kennung"]
        .as_str()
        .unwrap()
        .to_string();

    for (m, u) in [
        ("GET", uri.clone()),
        ("POST", format!("{uri}/beenden")),
        ("DELETE", format!("{uri}/{k}")),
    ] {
        let (s, _) = anfrage(&app, m, &u, &admin, None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{m} {u}");
    }
    assert_eq!(me(&app, &fremd).await, StatusCode::OK);
    assert!(adminspur(&pool).await.is_empty());
}

#[tokio::test]
async fn ohne_adminrolle_ist_403() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "fuehrungskraft").await;
    let marlene = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/benutzer/{marlene_id}/sitzungen"),
        &marlene,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unbekanntes_konto_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, _) = anfrage(&app, "GET", "/api/benutzer/9999/sitzungen", &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ---------- Geräte ----------

async fn geraet_koppeln(app: &axum::Router, admin: &str, einsatz: i64) -> (i64, String) {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        admin,
        Some(&json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let kopplung_id = v["kopplung"]["id"].as_i64().unwrap();
    let code = v["code"]["code"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/geraete/koppeln")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    (kopplung_id, cookie)
}

#[tokio::test]
async fn geraetesitzungen_bleiben_aussen_vor() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (kopplung_id, geraet) = geraet_koppeln(&app, &admin, einsatz).await;
    let konto_id: i64 = sqlx::query_scalar("SELECT benutzer_id FROM geraet_kopplung WHERE id = ?")
        .bind(kopplung_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    // Das Gerät selbst erreicht die Routen nicht.
    let (s, _) = anfrage(&app, "GET", "/api/auth/sitzungen", &geraet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    // Ein Admin sieht das Gerätekonto nicht als Person.
    for (m, u) in [
        ("GET", format!("/api/benutzer/{konto_id}/sitzungen")),
        (
            "POST",
            format!("/api/benutzer/{konto_id}/sitzungen/beenden"),
        ),
    ] {
        let (s, _) = anfrage(&app, m, &u, &admin, None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{m} {u}");
    }
    // Alle anderen Sitzungen des Admins beenden lässt das Gerät gekoppelt.
    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/auth/sitzungen/andere-beenden",
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me(&app, &geraet).await, StatusCode::OK);
}

// ---------- Live-Strom ----------

async fn strom_oeffnen(app: &axum::Router, cookie: &str, uri: &str) -> Body {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.into_body()
}

/// Liest den Strom, bis er endet (`true`) oder `frist` lang offen bleibt (`false`).
async fn strom_endet(body: &mut Body, frist: Duration) -> bool {
    use http_body_util::BodyExt;
    let ende = tokio::time::Instant::now() + frist;
    loop {
        let rest = ende.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(rest, std::pin::Pin::new(&mut *body).frame()).await {
            Err(_) => return false,
            Ok(None) | Ok(Some(Err(_))) => return true,
            Ok(Some(Ok(_))) => {}
        }
    }
}

#[tokio::test]
async fn offener_strom_endet_mit_seiner_sitzung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let verloren = anmelden(&app, "admin", "startpw12", IPAD).await;
    let k = kennung(
        &liste(&app, &admin, "/api/auth/sitzungen").await,
        "Safari · iPadOS",
    );

    let feed = format!("/api/einsaetze/{einsatz}/live");
    let mut einsatz_strom = strom_oeffnen(&app, &verloren, &feed).await;
    let mut org_strom = strom_oeffnen(&app, &verloren, "/api/live").await;
    let mut eigener = strom_oeffnen(&app, &admin, &feed).await;
    assert!(!strom_endet(&mut einsatz_strom, Duration::from_millis(300)).await);

    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sitzungen/{k}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    assert!(
        strom_endet(&mut einsatz_strom, Duration::from_secs(3)).await,
        "der Einsatz-Strom der beendeten Sitzung endet sofort"
    );
    assert!(
        strom_endet(&mut org_strom, Duration::from_secs(3)).await,
        "der Org-Strom auch"
    );
    assert!(
        !strom_endet(&mut eigener, Duration::from_millis(300)).await,
        "der Strom einer anderen Sitzung desselben Kontos läuft weiter"
    );
    // Der Neuaufbau bekommt 401.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&feed)
                .header(header::COOKIE, &verloren)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let _ = to_bytes(resp.into_body(), usize::MAX).await;
}

#[tokio::test]
async fn logout_und_deaktivieren_beenden_offene_stroeme() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "fuehrungskraft").await;

    // Logout
    let marlene = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let mut strom = strom_oeffnen(&app, &marlene, "/api/live").await;
    let (s, _) = anfrage(&app, "POST", "/api/auth/logout", &marlene, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(
        strom_endet(&mut strom, Duration::from_secs(3)).await,
        "Logout"
    );

    // Deaktivieren
    let marlene = anmelden(&app, "marlene", "marlenepw1", FIREFOX).await;
    let mut strom = strom_oeffnen(&app, &marlene, "/api/live").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{marlene_id}/deaktivieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        strom_endet(&mut strom, Duration::from_secs(3)).await,
        "Deaktivieren"
    );
}
