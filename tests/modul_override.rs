//! Integrationstests für die Modul-Sichtbarkeit & Berechtigungen pro Einsatz (LFH-132).

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::einsatz::modul::{MODUL_KEYS, NICHT_AUSBLENDBAR};
use lifeline_hub::live::LiveHub;
use serde_json::Value;
use std::collections::BTreeSet;
use tower::ServiceExt;

// ----------------------------- Test-Harness -----------------------------

async fn setup() -> axum::Router {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    build_router(AppState {
        pool,
        live: LiveHub::new(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
    })
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
    assert_eq!(resp.status(), StatusCode::OK, "Login muss klappen");
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

async fn benutzer_anlegen(app: &axum::Router, admin_cookie: &str, name: &str, org_rolle: &str) -> i64 {
    let body = format!(
        r#"{{"anzeigename":"{name}","benutzername":"{name}","passwort":"{name}pw1","org_rolle":"{org_rolle}"}}"#
    );
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/benutzer")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin_cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED, "Benutzer anlegen muss klappen");
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"].as_i64().unwrap()
}

async fn einsatz_anlegen(app: &axum::Router, cookie: &str, bezeichnung: &str) -> i64 {
    let body = format!(r#"{{"bezeichnung":"{bezeichnung}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/einsaetze")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<Value>(&bytes).unwrap()["id"].as_i64().unwrap()
}

/// Macht den Benutzer mit `ziel_id` zum Mitglied des Einsatzes mit `einsatz_rolle`.
async fn mitglied_setzen(
    app: &axum::Router,
    leitung_cookie: &str,
    einsatz_id: i64,
    ziel_id: i64,
    einsatz_rolle: &str,
) {
    let body = format!(r#"{{"einsatz_rolle":"{einsatz_rolle}"}}"#);
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz_id}/mitglieder/{ziel_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, leitung_cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "Mitglied setzen muss klappen");
}

/// PUT eines Modul-Overrides; liefert nur den Status.
async fn override_setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz_id: i64,
    modul_key: &str,
    sichtbar: bool,
    benoetigte_rolle: Option<&str>,
) -> StatusCode {
    let rolle_json = match benoetigte_rolle {
        Some(r) => format!(r#""{r}""#),
        None => "null".into(),
    };
    let body = format!(r#"{{"sichtbar":{sichtbar},"benoetigte_rolle":{rolle_json}}}"#);
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{einsatz_id}/modul-overrides/{modul_key}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// GET der Override-Map; liefert (Status, JSON-Objekt).
async fn overrides_laden(app: &axum::Router, cookie: &str, einsatz_id: i64) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{einsatz_id}/modul-overrides"))
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

/// GET-Status einer beliebigen Route.
async fn get_status(app: &axum::Router, cookie: &str, pfad: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(pfad)
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// POST-Status einer beliebigen Route mit JSON-Body.
async fn post_status(app: &axum::Router, cookie: &str, pfad: &str, body: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(pfad)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

// ----------------------------- Drift-Wächter -----------------------------

/// Source-of-Truth-Drift-Wächter: Die Backend-`MODUL_KEYS` müssen exakt mit den
/// `key`-Werten der Frontend-`modulRegistry.ts` übereinstimmen. Driftet eine Seite
/// (Modul hinzugefügt/entfernt/umbenannt, ohne die andere nachzuziehen), schlägt
/// dieser Test fehl — der Guard würde sonst auf einen unbekannten Key laufen oder
/// ein neues Modul ungeschützt lassen.
#[test]
fn backend_modul_keys_decken_frontend_registry() {
    let quelle = std::fs::read_to_string("frontend/src/einsatz/modulRegistry.ts")
        .expect("frontend/src/einsatz/modulRegistry.ts muss lesbar sein");

    // Nur den `modulRegistry`-Array-Block betrachten (die `kategorien`-Liste davor
    // hat ebenfalls `key:`-Felder, gehört aber nicht dazu).
    let start = quelle
        .find("export const modulRegistry")
        .expect("modulRegistry-Deklaration nicht gefunden");
    let block_ende = quelle[start..]
        .find("\n];")
        .map(|rel| start + rel)
        .expect("Ende des modulRegistry-Arrays nicht gefunden");
    let block = &quelle[start..block_ende];

    // `key: 'xyz'` aus dem Block extrahieren.
    let mut fe_keys = BTreeSet::new();
    for stueck in block.split("key:").skip(1) {
        let nach_quote = stueck.find('\'').expect("key ohne öffnendes '");
        let rest = &stueck[nach_quote + 1..];
        let ende = rest.find('\'').expect("key ohne schließendes '");
        fe_keys.insert(rest[..ende].to_string());
    }

    let be_keys: BTreeSet<String> = MODUL_KEYS.iter().map(|s| s.to_string()).collect();

    assert_eq!(
        be_keys, fe_keys,
        "Backend-MODUL_KEYS und Frontend-modulRegistry-Keys müssen synchron sein.\n\
         Nur Backend: {:?}\nNur Frontend: {:?}",
        be_keys.difference(&fe_keys).collect::<Vec<_>>(),
        fe_keys.difference(&be_keys).collect::<Vec<_>>(),
    );
}

// ----------------------------- Task 4: GET/PUT Override-Routen -----------------------------

#[tokio::test]
async fn admin_setzt_override_und_get_spiegelt_ihn() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;

    assert_eq!(
        override_setzen(&app, &admin, eid, "chat", false, None).await,
        StatusCode::OK
    );

    let (status, json) = overrides_laden(&app, &admin, eid).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["chat"]["sichtbar"], false);
    assert_eq!(json["chat"]["benoetigte_rolle"], Value::Null);
}

#[tokio::test]
async fn override_setzt_benoetigte_rolle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;

    assert_eq!(
        override_setzen(&app, &admin, eid, "etb", true, Some("fuehrungskraft")).await,
        StatusCode::OK
    );
    let (_, json) = overrides_laden(&app, &admin, eid).await;
    assert_eq!(json["etb"]["benoetigte_rolle"], "fuehrungskraft");
}

#[tokio::test]
async fn nicht_ausblendbares_modul_verstecken_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;

    for key in ["einsatzdaten", "einsatz-einstellungen"] {
        assert_eq!(
            override_setzen(&app, &admin, eid, key, false, None).await,
            StatusCode::BAD_REQUEST,
            "{key} darf nicht versteckt werden"
        );
    }
}

#[tokio::test]
async fn nicht_ausblendbares_modul_rollen_beschraenken_ist_400() {
    // Selbst-Aussperr-Schutz auf der Rollen-Dimension: einsatz-einstellungen darf
    // nicht rollen-beschränkt werden (sonst Aussperrung aus den Einstellungen).
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    for key in ["einsatzdaten", "einsatz-einstellungen"] {
        assert_eq!(
            override_setzen(&app, &admin, eid, key, true, Some("fuehrungskraft")).await,
            StatusCode::BAD_REQUEST,
            "{key} darf nicht rollen-beschränkt werden"
        );
    }
}

#[tokio::test]
async fn einsatzleitung_sperrt_sich_nicht_aus_einstellungen_aus() {
    // Selbst aus einem (defensiv ohnehin abgelehnten) Rollen-Override darf keine
    // Aussperrung folgen: eine nicht-admin Einsatzleitung erreicht die Einstellungen
    // und ihre Stammdaten immer.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    let lid = benutzer_anlegen(&app, &admin, "lotta", "keine").await;
    mitglied_setzen(&app, &admin, eid, lid, "einsatzleitung").await;
    let lotta = login_cookie(&app, "lotta", "lottapw1").await;

    // GET der Einstellungen + Stammdaten bleibt für die Einsatzleitung erreichbar.
    assert_eq!(
        get_status(&app, &lotta, &format!("/api/einsaetze/{eid}/einstellungen")).await,
        StatusCode::OK
    );
    assert_eq!(
        get_status(&app, &lotta, &format!("/api/einsaetze/{eid}")).await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn unbekannter_modul_key_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    assert_eq!(
        override_setzen(&app, &admin, eid, "gibtsnicht", true, None).await,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn ungueltige_benoetigte_rolle_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    assert_eq!(
        override_setzen(&app, &admin, eid, "etb", true, Some("einsatzleitung")).await,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn nicht_leitung_kann_keinen_override_setzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    let bid = benutzer_anlegen(&app, &admin, "berta", "keine").await;
    mitglied_setzen(&app, &admin, eid, bid, "beobachter").await;

    let berta = login_cookie(&app, "berta", "bertapw1").await;
    // Beobachter (kein Admin, keine Leitung) → 403.
    assert_eq!(
        override_setzen(&app, &berta, eid, "chat", false, None).await,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn override_get_fuer_nicht_mitglied_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _) = overrides_laden(&app, &fremd, eid).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn overrides_sind_pro_einsatz_isoliert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid_a = einsatz_anlegen(&app, &admin, "Lage A").await;
    let eid_b = einsatz_anlegen(&app, &admin, "Lage B").await;

    override_setzen(&app, &admin, eid_a, "chat", false, None).await;

    let (_, json_b) = overrides_laden(&app, &admin, eid_b).await;
    assert!(
        json_b.as_object().unwrap().is_empty(),
        "Einsatz B darf den Override von A nicht sehen"
    );
}

// ----------------------------- Task 5: Guard in Modul-Handlern (Muster ETB) -----------------------------

/// Richtet Einsatz + ein Führungspersonal-Mitglied "frieda" ein; liefert
/// (admin_cookie, frieda_cookie, einsatz_id). Frieda darf normal lesen+schreiben.
async fn etb_fixture(app: &axum::Router) -> (String, String, i64) {
    let admin = login_cookie(app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(app, &admin, "Lage").await;
    let fid = benutzer_anlegen(app, &admin, "frieda", "keine").await;
    mitglied_setzen(app, &admin, eid, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(app, "frieda", "friedapw1").await;
    (admin, frieda, eid)
}

#[tokio::test]
async fn verstecktes_etb_blockt_mitglied_auf_get_stream_und_post() {
    let app = setup().await;
    let (admin, frieda, eid) = etb_fixture(&app).await;

    // Vor dem Verstecken: Frieda darf lesen.
    assert_eq!(
        get_status(&app, &frieda, &format!("/api/einsaetze/{eid}/etb")).await,
        StatusCode::OK
    );

    // ETB ausblenden.
    assert_eq!(
        override_setzen(&app, &admin, eid, "etb", false, None).await,
        StatusCode::OK
    );

    // GET, Stream und POST des versteckten Moduls → 403 (auch SSE-Bypass dicht).
    assert_eq!(
        get_status(&app, &frieda, &format!("/api/einsaetze/{eid}/etb")).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        get_status(&app, &frieda, &format!("/api/einsaetze/{eid}/etb/stream")).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post_status(
            &app,
            &frieda,
            &format!("/api/einsaetze/{eid}/etb"),
            r#"{"typ":"meldung","inhalt":"Test"}"#
        )
        .await,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn verstecktes_etb_laesst_admin_durch() {
    let app = setup().await;
    let (admin, _frieda, eid) = etb_fixture(&app).await;
    override_setzen(&app, &admin, eid, "etb", false, None).await;

    // Admin-Mindest-Guard: trotz versteckt 200.
    assert_eq!(
        get_status(&app, &admin, &format!("/api/einsaetze/{eid}/etb")).await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn etb_rollen_schranke_blockt_normales_mitglied() {
    let app = setup().await;
    let (admin, frieda, eid) = etb_fixture(&app).await;

    // ETB sichtbar, aber Rolle fuehrungskraft erforderlich. Frieda hat org_rolle 'keine'.
    override_setzen(&app, &admin, eid, "etb", true, Some("fuehrungskraft")).await;
    assert_eq!(
        get_status(&app, &frieda, &format!("/api/einsaetze/{eid}/etb")).await,
        StatusCode::FORBIDDEN
    );

    // Eine org-weite Führungskraft (Mitglied) darf weiterhin.
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    mitglied_setzen(&app, &admin, eid, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    assert_eq!(
        get_status(&app, &gustav, &format!("/api/einsaetze/{eid}/etb")).await,
        StatusCode::OK
    );
}

// ----------------------------- Task 5: Guard-Abdeckung aller Modul-Gruppen -----------------------------

/// (modul_key, GET-Pfad-Suffix) je Modul-Gruppe. Pfade liefern für einen leeren
/// Einsatz normal 200; bei verstecktem Modul muss ein Mitglied 403 bekommen.
const MODUL_GET_PFADE: &[(&str, &str)] = &[
    ("chat", "chat/kanaele"),
    ("erinnerungen", "erinnerungen"),
    ("auftraege", "auftraege"),
    ("meldungen", "meldungen"),
    ("nachforderungen", "nachforderungen"),
    ("fahrzeuge", "fahrzeuge"),
    ("personal", "personal"),
    ("material", "material"),
    ("personen", "personen"),
    ("tiere", "tiere"),
    ("schaeden", "schaeden"),
    ("unfallhilfsstellen", "uhs"),
    ("bereitstellungsraeume", "bereitstellungsraeume"),
    ("einheiten", "einheiten"),
    ("einsatzabschnitte", "abschnitte"),
    ("lageberichte", "lageberichte"),
    ("gefahrenzonen", "gefahrengebiete"),
    ("lagekarte", "zonen"),
    ("lagekarte", "karte/fuehrungskraefte"),
    ("lagemeldungen", "lage/meldungen"),
];

/// Stream-Routen (SSE-Bypass-Schutz): bei verstecktem Modul → 403.
const MODUL_STREAM_PFADE: &[(&str, &str)] = &[
    ("fahrzeuge", "fahrzeuge/stream"),
    ("personen", "personen/stream"),
    ("tiere", "tiere/stream"),
    ("schaeden", "schaeden/stream"),
    ("unfallhilfsstellen", "uhs/stream"),
    ("einheiten", "einheiten/stream"),
    ("einsatzabschnitte", "abschnitte/stream"),
    ("lagekarte", "zonen/stream"),
];

/// Module ohne eigene daten-besitzende Backend-Routen (reine Aggregation/Sicht):
/// kein Guard-Pfad möglich, daher legitim NICHT in MODUL_GET_PFADE.
const OHNE_EIGENE_ROUTEN: &[&str] = &["stab", "lage-dashboard", "kraefteuebersicht"];
/// ETB ist das exemplarisch zuerst gegatete Modul mit eigenem dedizierten Guard-Test.
const SEPARAT_GETESTET: &[&str] = &["etb"];

/// Vollständigkeits-Wächter (Review LFH-132): koppelt die Guard-403-Abdeckung
/// datengetrieben an `MODUL_KEYS`. Jeder ausblendbare Key mit eigenen Routen MUSS
/// in `MODUL_GET_PFADE` einen 403-Nachweis haben. Verhindert, dass ein künftig in
/// beide Registries eingetragenes Modul (Drift-Test bleibt grün) ohne
/// serverseitigen Guard-Nachweis durchrutscht (SSE-/Route-Bypass). Ein neuer
/// ausblendbarer Key erzwingt damit automatisch einen Pfad-Eintrag oder eine
/// dokumentierte Ausnahme oben.
#[test]
fn jeder_ausblendbare_modul_key_ist_guard_abgedeckt() {
    let abgedeckt: BTreeSet<&str> = MODUL_GET_PFADE.iter().map(|(k, _)| *k).collect();
    let erwartet: BTreeSet<&str> = MODUL_KEYS
        .iter()
        .copied()
        .filter(|k| !NICHT_AUSBLENDBAR.contains(k))
        .filter(|k| !OHNE_EIGENE_ROUTEN.contains(k))
        .filter(|k| !SEPARAT_GETESTET.contains(k))
        .collect();
    assert_eq!(
        erwartet, abgedeckt,
        "Jeder ausblendbare Modul-Key mit eigenen Routen braucht einen 403-Nachweis in MODUL_GET_PFADE.\n\
         Fehlt im Guard-Test (ungeschützt?): {:?}\nIm Test, aber nicht (mehr) erwartet: {:?}",
        erwartet.difference(&abgedeckt).collect::<Vec<_>>(),
        abgedeckt.difference(&erwartet).collect::<Vec<_>>(),
    );
}

#[tokio::test]
async fn alle_modul_gruppen_gegated_get_baseline_und_versteckt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    mitglied_setzen(&app, &admin, eid, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    // Baseline: alle Pfade für das Mitglied sichtbar → 200.
    for (key, suffix) in MODUL_GET_PFADE {
        let st = get_status(&app, &frieda, &format!("/api/einsaetze/{eid}/{suffix}")).await;
        assert_eq!(st, StatusCode::OK, "Baseline {key} ({suffix}) muss 200 sein, war {st}");
    }

    // Alle eindeutigen Keys verstecken.
    let mut keys: Vec<&str> = MODUL_GET_PFADE.iter().map(|(k, _)| *k).collect();
    keys.sort_unstable();
    keys.dedup();
    for key in &keys {
        assert_eq!(
            override_setzen(&app, &admin, eid, key, false, None).await,
            StatusCode::OK
        );
    }

    // Mitglied → 403 auf jedem Pfad; Admin-Mindest-Guard → 200.
    for (key, suffix) in MODUL_GET_PFADE {
        let pfad = format!("/api/einsaetze/{eid}/{suffix}");
        assert_eq!(
            get_status(&app, &frieda, &pfad).await,
            StatusCode::FORBIDDEN,
            "verstecktes {key} ({suffix}) muss 403 fürs Mitglied sein"
        );
        assert_eq!(
            get_status(&app, &admin, &pfad).await,
            StatusCode::OK,
            "Admin muss {key} ({suffix}) trotz versteckt lesen"
        );
    }
}

#[tokio::test]
async fn versteckte_module_blocken_stream_routen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin, "Lage").await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    mitglied_setzen(&app, &admin, eid, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    for (key, suffix) in MODUL_STREAM_PFADE {
        override_setzen(&app, &admin, eid, key, false, None).await;
        assert_eq!(
            get_status(&app, &frieda, &format!("/api/einsaetze/{eid}/{suffix}")).await,
            StatusCode::FORBIDDEN,
            "verstecktes {key}: Stream {suffix} muss 403 sein (kein SSE-Bypass)"
        );
    }
}
