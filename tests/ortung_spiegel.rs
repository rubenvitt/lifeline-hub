//! Fahrzeugortung in gespiegelten Einsätzen (LLH-2119, Entwurf
//! `docs/superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md`): Der Hub
//! beantwortet die Ortungsanfragen im Abgleich, nur für angefragte Kennungen und ohne
//! Koordinaten in der Kandidatenliste. Zwei echte Instanzen im selben Prozess, wie in
//! `instanz_fuehrung.rs`.

mod common;

use axum::http::{Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use lifeline_hub::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use lifeline_hub::auth::unterschrift::repo as unterschrift;
use lifeline_hub::instanz::repo::KopplungZeile;
use lifeline_hub::instanz::spiegel::paket::{
    RemoteTrackingCandidates, RemoteTrackingRequest, SpiegelPaket,
};
use lifeline_hub::instanz::{identitaet, org_kennung};
use lifeline_hub::ortung::{fern, uebernahme};
use serde_json::json;
use tower::ServiceExt;

const RP: &str = "hub.example.org";
const ORIGIN: &str = "https://hub.example.org";

struct Instanz {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    adresse: String,
    admin: String,
    kennung: String,
    _server: tokio::task::JoinHandle<()>,
}

async fn instanz() -> Instanz {
    lifeline_hub::auth::unterschrift::set_rp(RP.into(), ORIGIN.into());
    let opt = RouterOptionen {
        demo_daten: false,
        zulassungs_budget: None,
        heic_decoder_verzeichnis: None,
        tls: false,
        einwurf_allow_http: true,
    };
    let (app, pool, _live) = common::setup_mit_optionen_und_live(opt).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = format!("http://{}", listener.local_addr().unwrap());
    let router = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    lifeline_hub::instanz::fuehrung::save_schalter(&pool, true)
        .await
        .unwrap();
    let kennung = identitaet::load_or_create(&pool).await.unwrap().kennung;
    Instanz {
        app,
        pool,
        adresse,
        admin,
        kennung,
        _server: server,
    }
}

/// Hub und ELW gekoppelt (Org 1 am Hub ist abgebildet).
async fn gekoppelt() -> (Instanz, Instanz) {
    let hub = instanz().await;
    let elw = instanz().await;
    let p = SoftwarePasskey::new("a", [1u8; 32]);
    let oeff = p.oeffentlich();
    {
        let mut conn = hub.pool.acquire().await.unwrap();
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
                bezeichnung: "Stick A",
            },
        )
        .await
        .unwrap();
    }
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instance/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        "/api/admin/instance/redeem",
        &elw.admin,
        Some(&json!({"adresse": hub.adresse, "code": v["code"]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (hub, elw)
}

async fn abgleichen(elw: &Instanz) {
    for _ in 0..2 {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    }
}

async fn schalter_setzen(pool: &sqlx::SqlitePool, org: i64, an: bool) {
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, ortung_im_einsatz) VALUES (?1, ?2) \
         ON CONFLICT(org_id) DO UPDATE SET ortung_im_einsatz = ?2",
    )
    .bind(org)
    .bind(i64::from(an))
    .execute(pool)
    .await
    .unwrap();
}

/// Ein Einwurf-Zugang des Hubs mit `positionen:write`: (ID, Schlüssel).
async fn zugang_anlegen(hub: &Instanz, name: &str) -> (String, String) {
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/intake-credentials",
        &hub.admin,
        Some(&format!(
            r#"{{"name":"{name}","scope":"positionen:write"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (
        v["zugang"]["id"].as_str().unwrap().to_string(),
        v["schluessel"].as_str().unwrap().to_string(),
    )
}

/// Ein Positions-Einwurf über die echte Route.
async fn einwerfen(hub: &Instanz, schluessel: &str, kennung: &str, lat: f64, lon: f64) {
    let resp = hub
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/intake/{schluessel}/position?id={kennung}&lat={lat}&lon={lon}"
                ))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(resp.status().is_success(), "{}", resp.status());
}

/// Hub mit Zugang und Einwürfen für `fkw1` und `fkw2`, Org-Schalter an; dazu die Kopplungszeile
/// und die Org-Kennung der Abbildung.
struct Aufbau {
    hub: Instanz,
    elw: Instanz,
    kopplung: KopplungZeile,
    org: String,
    zugang: String,
}

async fn aufbau() -> Aufbau {
    let (hub, elw) = gekoppelt().await;
    schalter_setzen(&hub.pool, 1, true).await;
    let (zugang, schluessel) = zugang_anlegen(&hub, "Tracker").await;
    einwerfen(&hub, &schluessel, "fkw1", 48.1, 11.5).await;
    einwerfen(&hub, &schluessel, "fkw2", 49.2, 12.6).await;
    let kopplung = {
        let mut conn = hub.pool.acquire().await.unwrap();
        lifeline_hub::instanz::repo::find_kopplung(&mut conn, &elw.kennung)
            .await
            .unwrap()
            .expect("Kopplung am Hub")
    };
    let org = org_kennung(&hub.kennung, 1);
    Aufbau {
        hub,
        elw,
        kopplung,
        org,
        zugang,
    }
}

async fn antworten(
    a: &Aufbau,
    anfrage: SpiegelPaket,
) -> (
    Vec<lifeline_hub::instanz::spiegel::paket::RemoteTrackingPosition>,
    Vec<RemoteTrackingCandidates>,
) {
    let eigen = identitaet::load_or_create(&a.hub.pool).await.unwrap();
    fern::answer_hub(&a.hub.pool, &eigen, &a.kopplung, &anfrage).await
}

fn anfrage(org: &str, zugang: &str, geraet: &str) -> RemoteTrackingRequest {
    RemoteTrackingRequest {
        org: org.into(),
        access_id: zugang.into(),
        device_id: geraet.into(),
    }
}

fn paket_mit(requests: Vec<RemoteTrackingRequest>) -> SpiegelPaket {
    SpiegelPaket {
        tracking_requests: requests,
        ..Default::default()
    }
}

#[tokio::test]
async fn hub_liefert_position_nur_fuer_angefragte_kennung() {
    let a = aufbau().await;
    let (positionen, _) = antworten(&a, paket_mit(vec![anfrage(&a.org, &a.zugang, "fkw1")])).await;
    assert_eq!(positionen.len(), 1, "{positionen:?}");
    let p = &positionen[0];
    assert_eq!(
        (p.org.as_str(), p.access_id.as_str(), p.device_id.as_str()),
        (a.org.as_str(), a.zugang.as_str(), "fkw1")
    );
    assert_eq!((p.lat, p.lon), (48.1, 11.5));
    assert!(!p.measured_at.is_empty());
    assert!(positionen.iter().all(|p| p.device_id != "fkw2"));
}

#[tokio::test]
async fn hub_liefert_nichts_fuer_ungueltigen_zugang() {
    let a = aufbau().await;
    let pool = &a.hub.pool;
    // Je Fall ein eigener Zugang mit eigener Kennung, damit die Fälle sich nicht stören.
    let neuer_zugang = |id: &'static str, scope: &'static str, org: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "INSERT INTO einwurf_zugang (id, org_id, name, scope, schluessel_hash, angelegt_at) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(org)
            .bind(id)
            .bind(scope)
            .bind(format!("hash-{id}"))
            .bind(lifeline_hub::zeit::jetzt())
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO position_letzte (org_id, zugang_id, kennung, lat, lon, gemessen_at, \
                 empfangen_at, rohdaten) VALUES (?, ?, 'fkw1', 1.0, 2.0, ?, ?, '{}')",
            )
            .bind(org)
            .bind(id)
            .bind(lifeline_hub::zeit::jetzt())
            .bind(lifeline_hub::zeit::jetzt())
            .execute(&pool)
            .await
            .unwrap();
        }
    };
    let fremde_org: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) VALUES ('Fremd', 'hilfsorganisation') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    neuer_zugang("z-widerrufen", "positionen:write", 1).await;
    sqlx::query("UPDATE einwurf_zugang SET widerrufen_at = ? WHERE id = 'z-widerrufen'")
        .bind(lifeline_hub::zeit::jetzt())
        .execute(pool)
        .await
        .unwrap();
    neuer_zugang("z-abgelaufen", "positionen:write", 1).await;
    sqlx::query("UPDATE einwurf_zugang SET gueltig_bis = datetime('now', '-1 hours') WHERE id = 'z-abgelaufen'")
        .execute(pool)
        .await
        .unwrap();
    neuer_zugang("z-alarm", "alarmmeldungen:write", 1).await;
    neuer_zugang("z-fremd", "positionen:write", fremde_org).await;

    let faelle: Vec<(&str, RemoteTrackingRequest)> = vec![
        (
            "widerrufener Zugang",
            anfrage(&a.org, "z-widerrufen", "fkw1"),
        ),
        (
            "abgelaufener Zugang",
            anfrage(&a.org, "z-abgelaufen", "fkw1"),
        ),
        (
            "Zugang mit alarmmeldungen:write",
            anfrage(&a.org, "z-alarm", "fkw1"),
        ),
        (
            "Zugang einer fremden Org",
            anfrage(&a.org, "z-fremd", "fkw1"),
        ),
        (
            "nicht abgebildete Org",
            anfrage(&org_kennung(&a.hub.kennung, 9), &a.zugang, "fkw1"),
        ),
    ];
    for (name, req) in faelle {
        let (positionen, _) = antworten(&a, paket_mit(vec![req])).await;
        assert!(positionen.is_empty(), "{name}: {positionen:?}");
    }

    // Gegenprobe: derselbe Zugang liefert, solange alles gilt; dann schaltet der Schalter ab.
    let (ok, _) = antworten(&a, paket_mit(vec![anfrage(&a.org, &a.zugang, "fkw1")])).await;
    assert_eq!(ok.len(), 1);
    schalter_setzen(&a.hub.pool, 1, false).await;
    let (aus, _) = antworten(&a, paket_mit(vec![anfrage(&a.org, &a.zugang, "fkw1")])).await;
    assert!(aus.is_empty(), "Org-Schalter aus: {aus:?}");
}

#[tokio::test]
async fn kandidaten_ohne_koordinaten() {
    let a = aufbau().await;
    let anfrage = SpiegelPaket {
        tracking_candidates_wanted: vec![a.org.clone()],
        ..Default::default()
    };
    let (_, kandidaten) = antworten(&a, anfrage).await;
    assert_eq!(kandidaten.len(), 1, "{kandidaten:?}");
    let k = &kandidaten[0];
    assert_eq!(k.org, a.org);
    assert!(k.tracking_enabled);
    let mut kennungen: Vec<&str> = k.items.iter().map(|i| i.device_id.as_str()).collect();
    kennungen.sort_unstable();
    assert_eq!(kennungen, ["fkw1", "fkw2"]);
    assert!(k
        .items
        .iter()
        .all(|i| i.access_id == a.zugang && !i.access_name.is_empty()));
    let json = serde_json::to_string(k).unwrap();
    assert!(
        !json.contains("\"lat\"") && !json.contains("\"lon\""),
        "{json}"
    );
}

#[tokio::test]
async fn fehler_im_hub_teil_laesst_abgleich_leben() {
    let a = aufbau().await;
    sqlx::query("DROP TABLE position_letzte")
        .execute(&a.hub.pool)
        .await
        .unwrap();
    // Auch die Anfrage selbst ist fehlerfrei: leere Listen statt Fehler.
    let roh = SpiegelPaket {
        tracking_requests: vec![anfrage(&a.org, &a.zugang, "fkw1")],
        tracking_candidates_wanted: vec![a.org.clone()],
        ..Default::default()
    };
    let (p, k) = antworten(&a, roh).await;
    assert!(p.is_empty() && k.is_empty());
    // Der ganze Hub-Abgleich gelingt trotzdem und trägt leere Ortungsfelder.
    let eigen = identitaet::load_or_create(&a.hub.pool).await.unwrap();
    let live = lifeline_hub::live::LiveHub::default();
    let paket = SpiegelPaket {
        tracking_requests: vec![anfrage(&a.org, &a.zugang, "fkw1")],
        tracking_candidates_wanted: vec![a.org.clone()],
        ..Default::default()
    };
    let antwort = lifeline_hub::instanz::spiegel::abgleich::handle_abgleich(
        &a.hub.pool,
        &live,
        None,
        &eigen,
        &a.kopplung,
        &paket,
    )
    .await
    .expect("Abgleich gelingt");
    assert!(antwort.tracking_positions.is_empty() && antwort.tracking_candidates.is_empty());
    // Der volle Abgleich vom ELW aus läuft ebenfalls durch.
    common::einsatz_anlegen(&a.elw.app, &a.elw.admin).await;
    abgleichen(&a.elw).await;
}

#[test]
fn aelteres_paket_ohne_felder_wird_gelesen() {
    let p: SpiegelPaket = serde_json::from_str(r#"{"staende":[],"lieferungen":[]}"#).unwrap();
    assert!(p.tracking_requests.is_empty());
    assert!(p.tracking_candidates_wanted.is_empty());
    assert!(p.tracking_positions.is_empty());
    assert!(p.tracking_candidates.is_empty());
}

// ── ELW fragt an und übernimmt (Task 3) ──────────────────────────────────────────────────────

/// Das ELW führt einen Einsatz mit einem disponierten Fahrzeug; die Kopplung zeigt per SQL auf
/// `fkw1` des Hub-Zugangs (die Route kommt später). (Einsatz, Einsatzfahrzeug, Kopplung am ELW).
async fn elw_mit_gekoppeltem_fahrzeug(a: &Aufbau) -> (i64, i64, KopplungZeile) {
    schalter_setzen(&a.elw.pool, 1, true).await;
    let einsatz = common::einsatz_anlegen(&a.elw.app, &a.elw.admin).await;
    let (s, v) = common::anfrage(
        &a.elw.app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &a.elw.admin,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1","traegerorganisation":"Feuerwehr"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ef = v["id"].as_i64().unwrap();
    let kopplung = {
        let mut conn = a.elw.pool.acquire().await.unwrap();
        lifeline_hub::instanz::repo::find_kopplung(&mut conn, &a.hub.kennung)
            .await
            .unwrap()
            .expect("Kopplung am ELW")
    };
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, instanz_kopplung_id, \
         fremder_zugang_id, zugang_name, kennung, gekoppelt_at, gekoppelt_von) \
         VALUES (?, ?, 1, ?, ?, 'Tracker', 'fkw1', ?, 1)",
    )
    .bind(ef)
    .bind(einsatz)
    .bind(kopplung.id)
    .bind(&a.zugang)
    .bind(lifeline_hub::zeit::jetzt())
    .execute(&a.elw.pool)
    .await
    .unwrap();
    (einsatz, ef, kopplung)
}

async fn position_am_elw(a: &Aufbau, ef: i64) -> (Option<f64>, Option<f64>, Option<String>) {
    sqlx::query_as("SELECT lat, lon, position_quelle FROM einsatz_fahrzeug WHERE id = ?")
        .bind(ef)
        .fetch_one(&a.elw.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn elw_bekommt_position_vom_hub() {
    let a = aufbau().await;
    let (_, ef, _) = elw_mit_gekoppeltem_fahrzeug(&a).await;
    abgleichen(&a.elw).await;
    assert_eq!(
        position_am_elw(&a, ef).await,
        (Some(48.1), Some(11.5), Some("einwurf".into()))
    );
    // Der Spiegel am Hub folgt mit dem nächsten Abgleich.
    abgleichen(&a.elw).await;
    let am_hub: Vec<(Option<f64>, Option<f64>)> = sqlx::query_as(
        "SELECT ef.lat, ef.lon FROM einsatz_fahrzeug ef JOIN einsatz e ON e.id = ef.einsatz_id \
         WHERE e.spiegel = 1",
    )
    .fetch_all(&a.hub.pool)
    .await
    .unwrap();
    assert_eq!(am_hub, vec![(Some(48.1), Some(11.5))]);
}

#[tokio::test]
async fn zweite_lieferung_binnen_15s_wird_gedrosselt() {
    let a = aufbau().await;
    let (_, ef, _) = elw_mit_gekoppeltem_fahrzeug(&a).await;
    abgleichen(&a.elw).await;
    sqlx::query(
        "UPDATE position_letzte SET lat = 50.0, lon = 13.0, \
         gemessen_at = strftime('%Y-%m-%d %H:%M:%S', gemessen_at, '+5 seconds') \
         WHERE kennung = 'fkw1'",
    )
    .execute(&a.hub.pool)
    .await
    .unwrap();
    abgleichen(&a.elw).await;
    assert_eq!(
        position_am_elw(&a, ef).await,
        (Some(48.1), Some(11.5), Some("einwurf".into()))
    );
    assert!(!uebernahme::is_nachlauf_vorgemerkt(&a.elw.pool, ef));
}

#[tokio::test]
async fn aelterer_hub_ohne_felder() {
    let a = aufbau().await;
    let (_, ef, kopplung) = elw_mit_gekoppeltem_fahrzeug(&a).await;
    fern::apply_answer(&a.elw.pool, &kopplung, &SpiegelPaket::default()).await;
    assert_eq!(position_am_elw(&a, ef).await, (None, None, None));
}

#[tokio::test]
async fn wunsch_liefert_kandidaten_in_den_puffer() {
    let a = aufbau().await;
    let (_, _, kopplung) = elw_mit_gekoppeltem_fahrzeug(&a).await;
    assert!(fern::cached_candidates(&a.elw.pool, kopplung.id, 1).is_none());
    fern::wish_candidates(&a.elw.pool, kopplung.id, 1);
    abgleichen(&a.elw).await;
    let (_, k) = fern::cached_candidates(&a.elw.pool, kopplung.id, 1).expect("Puffer gesetzt");
    assert!(k.tracking_enabled);
    assert!(k.items.iter().any(|i| i.device_id == "fkw1"), "{k:?}");
}

// ── Routen am ELW (Task 4) ───────────────────────────────────────────────────────────────────

/// Das ELW führt einen Einsatz mit einem disponierten Fahrzeug, ohne Kopplung.
/// (Einsatz, Einsatzfahrzeug, Kopplung am ELW).
async fn elw_mit_fahrzeug(a: &Aufbau, name: &str) -> (i64, i64, KopplungZeile) {
    schalter_setzen(&a.elw.pool, 1, true).await;
    let einsatz = common::einsatz_anlegen(&a.elw.app, &a.elw.admin).await;
    let ef = fahrzeug_dazu(a, einsatz, name).await;
    let kopplung = {
        let mut conn = a.elw.pool.acquire().await.unwrap();
        lifeline_hub::instanz::repo::find_kopplung(&mut conn, &a.hub.kennung)
            .await
            .unwrap()
            .expect("Kopplung am ELW")
    };
    fern::clear_candidates(&a.elw.pool, kopplung.id, 1);
    (einsatz, ef, kopplung)
}

async fn fahrzeug_dazu(a: &Aufbau, einsatz: i64, name: &str) -> i64 {
    let (s, v) = common::anfrage(
        &a.elw.app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &a.elw.admin,
        Some(&format!(
            r#"{{"adhoc":{{"funkrufname":"{name}","traegerorganisation":"Feuerwehr"}}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

fn tracking_pfad(einsatz: i64, ef: i64) -> String {
    format!("/api/incidents/{einsatz}/vehicles/{ef}/tracking")
}

async fn koppeln_am_elw(
    a: &Aufbau,
    einsatz: i64,
    ef: i64,
    kennung: &str,
) -> (StatusCode, serde_json::Value) {
    common::anfrage_json(
        &a.elw.app,
        "PUT",
        &tracking_pfad(einsatz, ef),
        &a.elw.admin,
        Some(&json!({"access_id": a.zugang, "device_id": kennung})),
    )
    .await
}

/// Wartet, bis der Hub-Teil im Puffer des ELW steht (zwei Abgleiche).
async fn kandidaten_holen(a: &Aufbau, einsatz: i64, ef: i64) -> serde_json::Value {
    let pfad = format!("{}/candidates", tracking_pfad(einsatz, ef));
    let (s, v) = common::anfrage(&a.elw.app, "GET", &pfad, &a.elw.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["pending"], true, "{v}");
    abgleichen(&a.elw).await;
    let (s, v) = common::anfrage(&a.elw.app, "GET", &pfad, &a.elw.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

#[tokio::test]
async fn kandidaten_vom_hub_mit_pending() {
    let a = aufbau().await;
    let (einsatz, ef, _) = elw_mit_fahrzeug(&a, "FW Extern 1").await;
    let pfad = format!("{}/candidates", tracking_pfad(einsatz, ef));
    let (s, v) = common::anfrage(&a.elw.app, "GET", &pfad, &a.elw.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["pending"], true, "{v}");
    assert_eq!(v["candidates"], json!([]), "{v}");
    abgleichen(&a.elw).await;
    let (s, v) = common::anfrage(&a.elw.app, "GET", &pfad, &a.elw.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["pending"], false, "{v}");
    assert_eq!(v["tracking_enabled"], true, "{v}");
    let fkw1 = v["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["device_id"] == "fkw1")
        .unwrap_or_else(|| panic!("fkw1 fehlt: {v}"));
    assert_eq!(fkw1["via_hub"], true);
    assert_eq!(fkw1["coupled"], false);
    assert_eq!(fkw1["access_id"], a.zugang.as_str());
    assert_eq!(fkw1["access_name"], "Tracker");
}

#[tokio::test]
async fn koppeln_an_hub_kennung() {
    let a = aufbau().await;
    let (einsatz, ef, _) = elw_mit_fahrzeug(&a, "FW Extern 1").await;
    kandidaten_holen(&a, einsatz, ef).await;
    let (s, v) = koppeln_am_elw(&a, einsatz, ef, "fkw1").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let etb = common::system_etb_inhalte(&a.elw.app, &a.elw.admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t == "Ortung gekoppelt: FW Extern 1 (Tracker / fkw1)"),
        "{etb:?}"
    );
    let (s, v) = common::anfrage(
        &a.elw.app,
        "GET",
        &tracking_pfad(einsatz, ef),
        &a.elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["access_name"], "Tracker");
    assert_eq!(v["device_id"], "fkw1");
    // Die Position kommt mit dem nächsten Abgleich.
    abgleichen(&a.elw).await;
    assert_eq!(
        position_am_elw(&a, ef).await,
        (Some(48.1), Some(11.5), Some("einwurf".into()))
    );
    // Danach steht die Kennung als gekoppelt in der Liste.
    let v = kandidaten_holen_ohne_pending(&a, einsatz, ef).await;
    let fkw1 = v["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["device_id"] == "fkw1")
        .unwrap();
    assert_eq!(fkw1["coupled"], true);
}

async fn kandidaten_holen_ohne_pending(a: &Aufbau, einsatz: i64, ef: i64) -> serde_json::Value {
    let pfad = format!("{}/candidates", tracking_pfad(einsatz, ef));
    let (_, v) = common::anfrage(&a.elw.app, "GET", &pfad, &a.elw.admin, None).await;
    v
}

#[tokio::test]
async fn koppeln_nicht_im_puffer_422() {
    let a = aufbau().await;
    let (einsatz, ef, _) = elw_mit_fahrzeug(&a, "FW Extern 1").await;
    kandidaten_holen(&a, einsatz, ef).await;
    let (s, v) = koppeln_am_elw(&a, einsatz, ef, "fkw9").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

#[tokio::test]
async fn koppeln_ohne_puffer_422() {
    let a = aufbau().await;
    let (einsatz, ef, _) = elw_mit_fahrzeug(&a, "FW Extern 1").await;
    let (s, v) = koppeln_am_elw(&a, einsatz, ef, "fkw1").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

#[tokio::test]
async fn doppelt_gekoppelt_409() {
    let a = aufbau().await;
    let (einsatz, ef, _) = elw_mit_fahrzeug(&a, "FW Extern 1").await;
    let ef2 = fahrzeug_dazu(&a, einsatz, "FW Extern 2").await;
    kandidaten_holen(&a, einsatz, ef).await;
    let (s, v) = koppeln_am_elw(&a, einsatz, ef, "fkw1").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = koppeln_am_elw(&a, einsatz, ef2, "fkw1").await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
}

#[tokio::test]
async fn ruecknahme_stellt_hub_kopplung_her() {
    let a = aufbau().await;
    let (einsatz, ef, kopplung) = elw_mit_fahrzeug(&a, "FW Extern 1").await;
    kandidaten_holen(&a, einsatz, ef).await;
    let (s, v) = koppeln_am_elw(&a, einsatz, ef, "fkw1").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = common::anfrage(
        &a.elw.app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down"),
        &a.elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let vorzustand = v["vorzustand"].clone();
    assert_eq!(vorzustand["ortung"]["instanz_kopplung_id"], kopplung.id);
    assert_eq!(vorzustand["ortung"]["zugang_name"], "Tracker");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ortung_kopplung")
        .fetch_one(&a.elw.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    // Der Puffer ist verfallen; die Rücknahme prüft ihn nicht.
    fern::clear_candidates(&a.elw.pool, kopplung.id, 1);
    let (s, v) = common::anfrage(
        &a.elw.app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down/undo"),
        &a.elw.admin,
        Some(&vorzustand.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ausgelassen"], json!([]), "{v}");
    let (s, v) = common::anfrage(
        &a.elw.app,
        "GET",
        &tracking_pfad(einsatz, ef),
        &a.elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["access_name"], "Tracker");
    assert_eq!(v["device_id"], "fkw1");
}

#[tokio::test]
async fn ohne_hub_bleibt_alles_lokal() {
    let inst = instanz().await;
    schalter_setzen(&inst.pool, 1, true).await;
    let einsatz = common::einsatz_anlegen(&inst.app, &inst.admin).await;
    let (zugang, schluessel) = zugang_anlegen(&inst, "Lokal").await;
    einwerfen(&inst, &schluessel, "lok1", 48.1, 11.5).await;
    let (s, v) = common::anfrage(
        &inst.app,
        "GET",
        &format!("/api/incidents/{einsatz}/vehicles/1/tracking/candidates"),
        &inst.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["pending"], false, "{v}");
    let c = &v["candidates"][0];
    assert_eq!(c["device_id"], "lok1", "{v}");
    assert_eq!(c["access_id"], zugang.as_str());
    assert_eq!(c["via_hub"], false);
}
