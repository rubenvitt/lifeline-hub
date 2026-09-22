//! Integrationstests der maßgeblichen Pegel (LFH-606).
//!
//! Spec: `docs/superpowers/specs/2026-09-22-lfh-606-pegel-kennzahl-design.md`, Abschnitt
//! „Backend".
//!
//! **Kein Test geht ins Netz.** Jeder Router hier bekommt eine PEGELONLINE-Basis, die sofort
//! mit ECONNREFUSED scheitert, und ein EIGENES `karten_dir` (Tempdir): der Nachschlage-Cache
//! ist je Pfad prozessweit memoisiert und liegt als Datei auf der Platte — mit dem geteilten
//! `std::env::temp_dir()` aus `common::setup` sickerten vorbefüllte Einträge in andere Tests
//! und in spätere Läufe.

use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::karte::cache;
use lifeline_hub::pegel::trend::Messpunkt;
use serde_json::Value;

mod common;
use common::*;

const A: &str = "a6ee8177-107b-47dd-bcfd-30960ccc6e9c";
const B: &str = "593647aa-9fea-43ec-a7d6-6476a76ae868";
const C: &str = "915d76e1-3bf9-4e37-9a9a-4d144cd771cc";
const D: &str = "70272185-b2b3-4178-96b8-43bea330dcae";
const E: &str = "1d26e504-7f9e-480a-b52c-5932be6549ab";
const F: &str = "47174d8f-1b8e-4599-8a59-b580dd55bc87";

struct Umgebung {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    dir: tempfile::TempDir,
}

impl Umgebung {
    /// Der Pool, den die Route für ihre Messungen auflöst — derselbe memoisierte Pool.
    async fn cache_pool(&self) -> sqlx::SqlitePool {
        lifeline_hub::cache_db::cache_pool(self.dir.path())
            .await
            .expect("Cache-DB im Tempdir")
    }
}

async fn setup_pegel() -> Umgebung {
    let pool = lifeline_hub::db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(AppState {
        pool: pool.clone(),
        live: lifeline_hub::live::LiveHub::new(),
        karten_dir: dir.path().to_path_buf(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu()
            .mit_pegel_basis_url("http://127.0.0.1:1"),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    Umgebung { app, pool, dir }
}

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/pegel")
}

fn station(uuid: &str, name: &str) -> String {
    format!(r#"{{"station_uuid":"{uuid}","name":"{name}","gewaesser":"WESER"}}"#)
}

fn liste(stationen: &[(&str, &str)]) -> String {
    let teile: Vec<String> = stationen.iter().map(|(u, n)| station(u, n)).collect();
    format!(r#"{{"stationen":[{}]}}"#, teile.join(","))
}

fn uuids(json: &Value) -> Vec<String> {
    json.as_array()
        .expect("Liste")
        .iter()
        .map(|p| p["station_uuid"].as_str().unwrap().to_string())
        .collect()
}

/// 10 cm/h steigend, jüngste Messung 110 cm um 09:15+02:00.
fn steigende_reihe() -> Vec<Messpunkt> {
    [
        ("2026-09-22T08:15:00+02:00", 100.0),
        ("2026-09-22T08:30:00+02:00", 102.5),
        ("2026-09-22T08:45:00+02:00", 105.0),
        ("2026-09-22T09:00:00+02:00", 107.5),
        ("2026-09-22T09:15:00+02:00", 110.0),
    ]
    .iter()
    .map(|(z, v)| Messpunkt {
        zeitpunkt: z.to_string(),
        wert_cm: *v,
    })
    .collect()
}

// ---------- Lesen und Rechte ----------

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let beob = benutzer_anlegen(&u.app, &admin, "beobachter", "keine").await;
    rolle_setzen(&u.app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&u.app, "beobachter", "beobachterpw1").await;

    let (status, json) = anfrage(&u.app, "GET", &pfad(einsatz), &beob_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json,
        serde_json::json!([]),
        "ohne Festlegung eine leere Liste"
    );

    let (status, _) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &beob_cookie,
        Some(&liste(&[(A, "Köln")])),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "PUT ohne Schreibrecht");
    let (status, _) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &beob_cookie,
        Some(&station(A, "Köln")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "POST ohne Schreibrecht");

    let (_, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(json, serde_json::json!([]), "nichts geschrieben");
}

/// Fremde Organisation: jede Route wird abgewiesen (403 oder 404, wie `tests/stab.rs`).
#[tokio::test]
async fn fremde_org_wird_auf_allen_routen_abgewiesen() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    fremde_org_anlegen(&u.pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&u.app, "fremd", "fremdpw1").await;

    for (methode, body) in [
        ("GET", None),
        ("PUT", Some(liste(&[(A, "Köln")]))),
        ("POST", Some(station(A, "Köln"))),
    ] {
        let (status, _) = anfrage(&u.app, methode, &pfad(einsatz), &fremd, body.as_deref()).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{methode}: erwartet 403/404, war {status}"
        );
    }
    let (_, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(json, serde_json::json!([]));

    let (status, _) = anfrage(&u.app, "GET", &pfad(999_999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ---------- Ersetzen ----------

#[tokio::test]
async fn put_ersetzt_ordnet_um_und_haelt_ids_stabil() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;

    let (status, json) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(A, "Köln"), (B, "Bonn"), (C, "Mainz")])),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(uuids(&json), [A, B, C]);
    let reihenfolgen: Vec<i64> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["reihenfolge"].as_i64().unwrap())
        .collect();
    assert_eq!(reihenfolgen, [0, 1, 2]);
    assert_eq!(json[0]["name"], "Köln");
    assert_eq!(json[0]["gewaesser"], "WESER");
    let id_a = json[0]["id"].as_i64().unwrap();

    // Umordnen und B entfernen; A behält seine id.
    let (status, json) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(C, "Mainz"), (A, "Köln (neu)")])),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(uuids(&json), [C, A]);
    assert_eq!(
        json[1]["id"].as_i64(),
        Some(id_a),
        "A bleibt dieselbe Zeile"
    );
    assert_eq!(json[1]["reihenfolge"], 1);
    assert_eq!(json[1]["name"], "Köln (neu)", "Snapshot aufgefrischt");

    // Der GET liefert dieselbe Reihenfolge.
    let (_, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(uuids(&json), [C, A]);

    // Leere Liste leert.
    let (status, json) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(r#"{"stationen":[]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json, serde_json::json!([]));
}

#[tokio::test]
async fn optionale_felder_fehlen_statt_null() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let (status, json) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&format!(r#"{{"station_uuid":"{A}","name":"Köln"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    let eintrag = json[0].as_object().unwrap();
    assert!(!eintrag.contains_key("gewaesser"), "{eintrag:?}");
    assert!(
        !eintrag.contains_key("messung"),
        "ohne Cache und ohne erreichbare Quelle fehlt die Messung: {eintrag:?}"
    );
}

#[tokio::test]
async fn doppelte_station_in_put_ist_422_nicht_409() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(A, "Köln")])),
    )
    .await;

    // Auch in anderer Schreibweise ist es dieselbe Station.
    let gross = A.to_uppercase();
    for body in [
        liste(&[(B, "Bonn"), (B, "Bonn")]),
        liste(&[(A, "Köln"), (&gross, "KÖLN")]),
    ] {
        let (status, json) = anfrage(&u.app, "PUT", &pfad(einsatz), &admin, Some(&body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    }
    let (_, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(uuids(&json), [A], "Bestand unverändert");
}

#[tokio::test]
async fn feldfehler_sind_400() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let lang = "x".repeat(201);

    let faelle: Vec<(&str, String)> = vec![
        ("PUT", liste(&[(A, "")])),
        ("PUT", liste(&[(A, "   ")])),
        ("PUT", liste(&[(A, &lang)])),
        ("PUT", liste(&[("keine-uuid", "Köln")])),
        (
            "PUT",
            liste(&[(A, "1"), (B, "2"), (C, "3"), (D, "4"), (E, "5"), (F, "6")]),
        ),
        ("PUT", r#"{"stationen":[{"station_uuid":"x"}]}"#.to_string()),
        ("PUT", r#"{}"#.to_string()),
        ("POST", station(A, "")),
        ("POST", station("a6ee8177107b47ddbcfd30960ccc6e9c", "Köln")),
        ("POST", station(A, &lang)),
        ("POST", format!(r#"{{"station_uuid":"{A}"}}"#)),
    ];
    for (methode, body) in faelle {
        let (status, json) = anfrage(&u.app, methode, &pfad(einsatz), &admin, Some(&body)).await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{methode} {body}: {json:?}"
        );
    }
    let (_, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(json, serde_json::json!([]));
}

// ---------- Anfügen ----------

#[tokio::test]
async fn post_fuegt_hinten_an_und_ist_idempotent() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;

    let (status, json) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(A, "Köln")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(uuids(&json), [A]);

    let (status, json) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(B, "Bonn")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(uuids(&json), [A, B]);
    assert_eq!(json[1]["reihenfolge"], 1);
    let vorher = json.clone();

    // Nochmals A (auch mit anderem Namen): 200 mit dem Bestand, nichts geändert.
    let (status, json) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(&A.to_uppercase(), "anders")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json, vorher);
}

#[tokio::test]
async fn post_bei_voller_liste_neu_ist_400_bestand_bleibt_200() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let (status, _) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(A, "1"), (B, "2"), (C, "3"), (D, "4"), (E, "5")])),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "genau fünf sind erlaubt");

    let (status, _) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(F, "6")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "ein sechster ist zu viel");

    // Die Vorhandensein-Prüfung geht der Obergrenze vor.
    let (status, json) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(C, "3")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(uuids(&json), [A, B, C, D, E]);
}

// ---------- Messung ----------

#[tokio::test]
async fn messung_aus_dem_cache_mit_trend() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let cache_pool = u.cache_pool().await;
    assert!(cache::setze_wert(&cache_pool, &format!("pegel:{A}"), &steigende_reihe()).await);
    // B: nur eine Messung — Messung ja, Trend nein.
    assert!(
        cache::setze_wert(
            &cache_pool,
            &format!("pegel:{B}"),
            &steigende_reihe()[4..].to_vec()
        )
        .await
    );

    anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(A, "Köln"), (B, "Bonn"), (C, "Mainz")])),
    )
    .await;
    let (status, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);

    let m = &json[0]["messung"];
    assert_eq!(m["wasserstand_cm"], 110.0);
    assert_eq!(m["zeitpunkt"], "2026-09-22T09:15:00+02:00");
    assert_eq!(m["trend_cm_pro_h"], 10.0);

    let m_b = json[1]["messung"].as_object().expect("B hat eine Messung");
    assert!(!m_b.contains_key("trend_cm_pro_h"), "{m_b:?}");

    assert!(
        !json[2].as_object().unwrap().contains_key("messung"),
        "C: kein Cache, Quelle aus → Messung fehlt"
    );
}

#[tokio::test]
async fn abgelaufener_cache_und_ausfall_liefert_den_alten_stand() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let cache_pool = u.cache_pool().await;
    cache::setze_wert(&cache_pool, &format!("pegel:{A}"), &steigende_reihe()).await;
    sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = unixepoch() - 7200")
        .execute(&cache_pool)
        .await
        .unwrap();

    let (status, json) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(A, "Köln")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        json[0]["messung"]["zeitpunkt"], "2026-09-22T09:15:00+02:00",
        "der alte Eintrag mit seinem ehrlichen Messzeitpunkt"
    );
}
