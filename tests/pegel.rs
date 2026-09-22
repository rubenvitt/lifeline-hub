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
    setup_mit_pegel_basis("http://127.0.0.1:1").await
}

/// Eine PEGELONLINE-Basis, die Verbindungen annimmt und nie antwortet — ein Abruf dorthin
/// hängt bis zur 8-s-Frist, statt wie `127.0.0.1:1` sofort zu scheitern.
async fn stumme_basis() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let basis = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let mut offen = Vec::new();
        while let Ok((sock, _)) = listener.accept().await {
            offen.push(sock);
        }
    });
    basis
}

async fn setup_mit_pegel_basis(basis: &str) -> Umgebung {
    let pool = lifeline_hub::db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(AppState {
        pool: pool.clone(),
        live: lifeline_hub::live::LiveHub::new(),
        karten_dir: dir.path().to_path_buf(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu().mit_pegel_basis_url(basis),
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
async fn post_bei_voller_liste_neu_ist_422_bestand_bleibt_200() {
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
    // Der Body ist für sich gültig, abgelehnt wird am Zustand des Einsatzes → 422
    // (LFH-267). Ein PUT mit sechs Einträgen ist dagegen 400 (`feldfehler_sind_400`).
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "ein sechster ist zu viel"
    );

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

/// Abgelaufener Eintrag bei hängender Quelle: GET liefert den alten Stand SOFORT
/// (Stale-while-revalidate) und wartet nicht die 8-s-Frist des Abrufs ab. Mutationsprobe:
/// wartet `reihe_fuer` wieder auf den Abruf, reißt die Zeitschranke.
#[tokio::test]
async fn abgelaufener_cache_kommt_sofort_ohne_auf_den_abruf_zu_warten() {
    let basis = stumme_basis().await;
    let u = setup_mit_pegel_basis(&basis).await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let cache_pool = u.cache_pool().await;
    cache::setze_wert(&cache_pool, &format!("pegel:{A}"), &steigende_reihe()).await;
    sqlx::query("UPDATE fachebenen_cache SET gespeichert_at = unixepoch() - 7200")
        .execute(&cache_pool)
        .await
        .unwrap();

    let start = std::time::Instant::now();
    let (status, json) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(A, "Köln")),
    )
    .await;
    let (status_get, json_get) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    let dauer = start.elapsed();

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(status_get, StatusCode::OK);
    for j in [&json, &json_get] {
        assert_eq!(
            j[0]["messung"]["zeitpunkt"], "2026-09-22T09:15:00+02:00",
            "der alte Eintrag mit seinem ehrlichen Messzeitpunkt"
        );
    }
    assert!(
        dauer < std::time::Duration::from_secs(3),
        "die Antwort darf nicht auf den Abruf (Frist 8 s) warten: {dauer:?}"
    );
}

/// PUT und POST warten nie auf einen Abruf: ohne Cache-Eintrag antworten sie sofort ohne
/// Messung und stoßen den Abruf im Hintergrund an. Mutationsprobe: mit `Modus::Warten` in
/// den schreibenden Routen reißt die Zeitschranke (Frist 8 s).
#[tokio::test]
async fn put_und_post_warten_nicht_auf_den_abruf() {
    let basis = stumme_basis().await;
    let u = setup_mit_pegel_basis(&basis).await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;

    let start = std::time::Instant::now();
    let (status_post, json_post) = anfrage(
        &u.app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(&station(A, "Köln")),
    )
    .await;
    let (status_put, json_put) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(A, "Köln"), (B, "Bonn")])),
    )
    .await;
    let dauer = start.elapsed();

    assert_eq!(status_post, StatusCode::CREATED);
    assert_eq!(status_put, StatusCode::OK);
    assert!(!json_post[0].as_object().unwrap().contains_key("messung"));
    for eintrag in json_put.as_array().unwrap() {
        assert!(!eintrag.as_object().unwrap().contains_key("messung"));
    }
    assert!(
        dauer < std::time::Duration::from_secs(3),
        "schreibende Routen warten nicht: {dauer:?}"
    );
}

// ---------- Prognose (LFH-628) ----------

fn prognose_pfad(einsatz: i64, pegel_id: i64) -> String {
    format!("/api/einsaetze/{einsatz}/pegel/{pegel_id}/prognose")
}

const PROGNOSE: &str = r#"{"hoechststand_cm":709.6,"zeitpunkt":"2026-09-22T18:00:00+02:00"}"#;

/// Legt `[A, B]` fest und liefert die ids in dieser Reihenfolge.
async fn zwei_pegel(u: &Umgebung, cookie: &str, einsatz: i64) -> (i64, i64) {
    let (status, json) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        cookie,
        Some(&liste(&[(A, "Köln"), (B, "Bonn")])),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    (
        json[0]["id"].as_i64().unwrap(),
        json[1]["id"].as_i64().unwrap(),
    )
}

#[tokio::test]
async fn prognose_setzen_und_loeschen() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let (id_a, _) = zwei_pegel(&u, &admin, einsatz).await;

    let (status, json) = anfrage(
        &u.app,
        "PUT",
        &prognose_pfad(einsatz, id_a),
        &admin,
        Some(PROGNOSE),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let p = &json[0]["prognose"];
    assert_eq!(p["hoechststand_cm"], 710.0, "auf ganze cm gerundet");
    assert_eq!(p["zeitpunkt"], "2026-09-22 16:00:00", "UTC im Wire-Format");
    assert!(p["gesetzt_at"].is_string());
    assert!(
        !json[1].as_object().unwrap().contains_key("prognose"),
        "ohne Prognose fehlt der Schlüssel, statt null zu sein"
    );

    // Der GET trägt sie ebenso.
    let (_, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(json[0]["prognose"]["hoechststand_cm"], 710.0);

    // Löschen, und ein zweites Löschen ist kein Fehler.
    for _ in 0..2 {
        let (status, json) = anfrage(
            &u.app,
            "DELETE",
            &prognose_pfad(einsatz, id_a),
            &admin,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{json:?}");
        assert!(!json[0].as_object().unwrap().contains_key("prognose"));
    }
}

/// Der Vollersatz-PUT der Liste fasst die Prognose nicht an — sonst nullte jedes Umordnen
/// in den Einstellungen sie still. Fällt die Station aus der Liste, fällt die Prognose mit.
#[tokio::test]
async fn put_der_liste_laesst_die_prognose_stehen() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let (id_a, _) = zwei_pegel(&u, &admin, einsatz).await;
    anfrage(
        &u.app,
        "PUT",
        &prognose_pfad(einsatz, id_a),
        &admin,
        Some(PROGNOSE),
    )
    .await;

    let (_, json) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(B, "Bonn"), (A, "Köln")])),
    )
    .await;
    assert_eq!(uuids(&json), [B, A]);
    assert_eq!(
        json[1]["prognose"]["hoechststand_cm"], 710.0,
        "Umordnen hält sie"
    );

    anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(B, "Bonn")])),
    )
    .await;
    let (_, json) = anfrage(
        &u.app,
        "PUT",
        &pfad(einsatz),
        &admin,
        Some(&liste(&[(B, "Bonn"), (A, "Köln")])),
    )
    .await;
    assert!(
        !json[1].as_object().unwrap().contains_key("prognose"),
        "entfernt und neu festgelegt: eine neue Zeile ohne Prognose"
    );
}

#[tokio::test]
async fn prognose_feldfehler_400_fremder_pegel_404_beobachter_403() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let anderer = einsatz_anlegen(&u.app, &admin).await;
    let (id_a, _) = zwei_pegel(&u, &admin, einsatz).await;

    for body in [
        r#"{"hoechststand_cm":700,"zeitpunkt":"morgen"}"#,
        r#"{"hoechststand_cm":700,"zeitpunkt":""}"#,
        r#"{"hoechststand_cm":9999999,"zeitpunkt":"2026-09-22T18:00:00Z"}"#,
        r#"{"zeitpunkt":"2026-09-22T18:00:00Z"}"#,
    ] {
        let (status, json) = anfrage(
            &u.app,
            "PUT",
            &prognose_pfad(einsatz, id_a),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {json:?}");
    }

    // Ein Pegel, den es gibt — aber in einem anderen Einsatz.
    for methode in ["PUT", "DELETE"] {
        let body = (methode == "PUT").then_some(PROGNOSE);
        let (status, _) =
            anfrage(&u.app, methode, &prognose_pfad(anderer, id_a), &admin, body).await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "{methode} über fremden Einsatz"
        );
        let (status, _) = anfrage(
            &u.app,
            methode,
            &prognose_pfad(einsatz, 999_999),
            &admin,
            body,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{methode} unbekannter Pegel");
    }

    let beob = benutzer_anlegen(&u.app, &admin, "beobachter", "keine").await;
    rolle_setzen(&u.app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&u.app, "beobachter", "beobachterpw1").await;
    let (status, _) = anfrage(
        &u.app,
        "PUT",
        &prognose_pfad(einsatz, id_a),
        &beob_cookie,
        Some(PROGNOSE),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (_, json) = anfrage(&u.app, "GET", &pfad(einsatz), &admin, None).await;
    assert!(
        !json[0].as_object().unwrap().contains_key("prognose"),
        "nichts geschrieben"
    );
}

// ---------- Vorhersage-Reihe WV (LFH-628) ----------

/// Eine PEGELONLINE-Attrappe: `WV` für Station A, 404 für alle anderen. Beantwortet jede
/// Verbindung mit genau einer Antwort und zählt die Anfragen an die Reihe `WV` — nur die:
/// das Festlegen der Liste stößt im Hintergrund auch den Abruf der Messreihe `W` an, und der
/// landet zu einem unbestimmten Zeitpunkt.
async fn wv_basis(reihe: Value) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let basis = format!("http://{}", listener.local_addr().unwrap());
    let zaehler = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let z = zaehler.clone();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let reihe = reihe.clone();
            let z = z.clone();
            tokio::spawn(async move {
                let mut puffer = vec![0u8; 4096];
                let n = sock.read(&mut puffer).await.unwrap_or(0);
                let anfrage = String::from_utf8_lossy(&puffer[..n]).to_string();
                if anfrage.contains("/WV/") {
                    z.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
                let (status, body) = if anfrage.contains(&format!("/stations/{A}/WV/")) {
                    ("200 OK", reihe.to_string())
                } else {
                    ("404 Not Found", r#"{"status":404}"#.to_string())
                };
                let antwort = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(antwort.as_bytes()).await;
            });
        }
    });
    (basis, zaehler)
}

fn vorhersage_pfad(einsatz: i64, pegel_id: i64) -> String {
    format!("/api/einsaetze/{einsatz}/pegel/{pegel_id}/vorhersage")
}

#[tokio::test]
async fn vorhersage_hoechster_kuenftiger_wert_und_404_der_quelle_ist_keine_reihe() {
    let jetzt = chrono::Utc::now();
    let z = |h: i64| (jetzt + chrono::Duration::hours(h)).to_rfc3339();
    let reihe = serde_json::json!([
        { "initialized": z(-5), "timestamp": z(-3), "value": 999.0, "type": "forecast" },
        { "initialized": z(-5), "timestamp": z(2), "value": 700.0, "type": "forecast" },
        { "initialized": z(-5), "timestamp": z(6), "value": 710.0, "type": "forecast" },
        { "initialized": z(-5), "timestamp": z(50), "value": 705.0, "type": "estimate" }
    ]);
    let (basis, zaehler) = wv_basis(reihe).await;
    let u = setup_mit_pegel_basis(&basis).await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let (id_a, id_b) = zwei_pegel(&u, &admin, einsatz).await;
    let vorher = zaehler.load(std::sync::atomic::Ordering::SeqCst);

    let (status, json) =
        anfrage(&u.app, "GET", &vorhersage_pfad(einsatz, id_a), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let v = &json["vorhersage"];
    assert_eq!(
        v["hoechststand_cm"], 710.0,
        "der vergangene 999 zählt nicht"
    );
    assert_eq!(v["zeitpunkt"], z(6));
    assert_eq!(v["erstellt"], z(-5));
    assert_eq!(v["abschaetzung"], false);

    let (status, json) =
        anfrage(&u.app, "GET", &vorhersage_pfad(einsatz, id_b), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        serde_json::json!({}),
        "Station ohne WV: kein Fehler, kein Vorschlag"
    );

    // Beide Antworten liegen im Cache: ein zweiter Aufruf geht nicht mehr zur Quelle.
    let nach_erstem = zaehler.load(std::sync::atomic::Ordering::SeqCst);
    assert_eq!(nach_erstem - vorher, 2);
    anfrage(&u.app, "GET", &vorhersage_pfad(einsatz, id_a), &admin, None).await;
    anfrage(&u.app, "GET", &vorhersage_pfad(einsatz, id_b), &admin, None).await;
    assert_eq!(
        zaehler.load(std::sync::atomic::Ordering::SeqCst),
        nach_erstem,
        "auch „keine Reihe“ ist gecacht"
    );
}

#[tokio::test]
async fn vorhersage_ohne_quelle_und_cache_ist_502_fremder_pegel_404() {
    let u = setup_pegel().await;
    let admin = login_cookie(&u.app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&u.app, &admin).await;
    let anderer = einsatz_anlegen(&u.app, &admin).await;
    let (id_a, _) = zwei_pegel(&u, &admin, einsatz).await;

    let (status, json) =
        anfrage(&u.app, "GET", &vorhersage_pfad(einsatz, id_a), &admin, None).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{json:?}");
    let (status, _) = anfrage(&u.app, "GET", &vorhersage_pfad(anderer, id_a), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
