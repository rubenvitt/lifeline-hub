//! Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`): zwei echte Instanzen im selben
//! Testprozess, je mit eigener DB und eigenem HTTP-Server auf Loopback. „Hub“ stellt den Code aus,
//! „ELW“ löst ihn ein und meldet sich. Beide haben den Schalter `LIFELINE_FUEHRUNG` an, außer im
//! Test dazu.

mod common;

use axum::http::StatusCode;
use lifeline_hub::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use lifeline_hub::auth::unterschrift::repo as unterschrift;
use lifeline_hub::instanz::fuehrung::repo::AKTE_GEWECHSELT;
use serde_json::{json, Value};

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

async fn instanz(fuehrung: bool) -> Instanz {
    lifeline_hub::auth::unterschrift::set_rp(RP.into(), ORIGIN.into());
    let (app, pool) = common::setup_mit_pool().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = format!("http://{}", listener.local_addr().unwrap());
    let router = app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    lifeline_hub::instanz::fuehrung::save_schalter(&pool, fuehrung)
        .await
        .unwrap();
    let kennung = lifeline_hub::instanz::identitaet::load_or_create(&pool)
        .await
        .unwrap()
        .kennung;
    Instanz {
        app,
        pool,
        adresse,
        admin,
        kennung,
        _server: server,
    }
}

fn passkey() -> SoftwarePasskey {
    SoftwarePasskey::new("a", [1u8; 32])
}

/// Hub mit Unterschriftsschlüssel von Admin A, ELW gekoppelt (der Schlüssel gilt am ELW als
/// Grundstock).
async fn gekoppelt_mit(hub_an: bool, elw_an: bool) -> (Instanz, Instanz) {
    let hub = instanz(hub_an).await;
    let elw = instanz(elw_an).await;
    let p = passkey();
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
        "/api/admin/instanz/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw.admin,
        Some(&json!({"adresse": hub.adresse, "code": v["code"]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (hub, elw)
}

async fn gekoppelt() -> (Instanz, Instanz) {
    gekoppelt_mit(true, true).await
}

/// Der ELW meldet sich und gleicht danach die Einsätze ab (zwei Runden: erst danach kennt der
/// Führer den Stand des Spiegels). Seit LLH-1641 hängt die Führung am Spiegel: Übergabe und
/// Anfrage brauchen ein abgeglichenes Gegenüber, eine Notübernahme den Einsatz als Spiegel.
async fn elw_meldet(elw: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::melden::run_durchlauf(&elw.pool)
        .await
        .unwrap();
    abgleichen(elw).await;
}

/// Zwei Runden Abgleich der Einsätze, vom ELW aus.
async fn abgleichen(elw: &Instanz) {
    for _ in 0..2 {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    }
}

async fn fuehrung(i: &Instanz, einsatz: i64) -> Value {
    let (s, v) = common::anfrage(
        &i.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/fuehrung"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

/// Die Akten des Gegenübers an einer Instanz (Seite „Instanzkopplung“).
async fn fremde(i: &Instanz) -> Vec<Value> {
    let (s, v) =
        common::anfrage(&i.app, "GET", "/api/admin/instanz/fuehrung", &i.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v.as_array().unwrap().clone()
}

async fn post(i: &Instanz, pfad: &str, body: Value) -> (StatusCode, Value) {
    common::anfrage_json(&i.app, "POST", pfad, &i.admin, Some(&body)).await
}

async fn etb(i: &Instanz, einsatz: i64) -> (StatusCode, Value) {
    post(
        i,
        &format!("/api/einsaetze/{einsatz}/etb"),
        json!({"von": "ELW 1", "an": "ELW 1", "typ": "meldung", "inhalt": "Lage erkundet",
               "anhang_ids": [], "client_id": uuid::Uuid::new_v4().to_string()}),
    )
    .await
}

/// Am Spiegel (eine andere Instanz führt) schützt der Trigger jeden Schreibweg mit 409; eine
/// beantragbare Erfassung wird zum Antrag (LLH-1641: nur der Spiegel sperrt).
async fn ist_spiegel_mit_antraegen(i: &Instanz, einsatz: i64) {
    let (s, v) = common::anfrage_json(
        &i.app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &i.admin,
        Some(&json!({"bezeichnung": "Anders"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Spiegel"), "{v}");
    let (s, v) = etb(i, einsatz).await;
    assert_eq!(
        s,
        StatusCode::ACCEPTED,
        "Antrag an die führende Instanz: {v}"
    );
}

/// Der Einsatz einer Akte an dieser Instanz (eigener oder Spiegel).
async fn einsatz_der_akte(i: &Instanz, akte: i64) -> i64 {
    sqlx::query_scalar("SELECT einsatz_id FROM einsatz_fuehrung WHERE id = ?")
        .bind(akte)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

async fn aktionen(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT aktion FROM admin_audit ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

/// Die Führungseinträge der Admin-Spur: Aktion, ob eine Person dieser Instanz handelte, Grund.
async fn spur_fuehrung(pool: &sqlx::SqlitePool) -> Vec<(String, bool, String)> {
    let rows: Vec<(String, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT aktion, akteur_id, detail FROM admin_audit WHERE aktion LIKE 'fuehrung_%' \
         ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    rows.into_iter()
        .map(|(aktion, akteur, detail)| {
            let grund = detail
                .and_then(|d| serde_json::from_str::<Value>(&d).ok())
                .and_then(|d| d["grund"].as_str().map(str::to_string))
                .unwrap_or_default();
            (aktion, akteur.is_some(), grund)
        })
        .collect()
}

async fn benachrichtigungen(pool: &sqlx::SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT art FROM benachrichtigung ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

/// ELW-Einsatz, an den Hub gemeldet: (Einsatz-ID am ELW, Akten-ID am Hub).
async fn elw_einsatz(hub: &Instanz, elw: &Instanz) -> (i64, i64) {
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    elw_meldet(elw).await;
    let akte = fremde(hub).await[0]["id"].as_i64().unwrap();
    (e, akte)
}

/// Notübernahme am Hub mit Unterschrift von Admin A.
async fn hub_uebernimmt_mit_unterschrift(hub: &Instanz, akte: i64, grund: &str) -> Value {
    let (s, start) = post(
        hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/start"),
        json!({"grund": grund}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{start}");
    let assertion = passkey().sign(start["erklaerung"].as_str().unwrap(), ORIGIN, RP, 0x05);
    let (s, v) = post(
        hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/abschluss"),
        json!({"zeremonie": start["zeremonie"], "assertion": assertion}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

// ── Schalter ─────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ohne_schalter_fliesst_nichts_und_die_routen_sind_404() {
    let (hub, elw) = gekoppelt_mit(true, false).await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    elw_meldet(&elw).await;
    assert!(
        fremde(&hub).await.is_empty(),
        "ELW ohne Schalter schickt nichts"
    );
    let (s, _) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}/fuehrung"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, kopf) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(!kopf.as_object().unwrap().contains_key("fuehrung"));
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
}

#[tokio::test]
async fn hub_ohne_schalter_nimmt_nichts_an() {
    let (hub, elw) = gekoppelt_mit(false, true).await;
    common::einsatz_anlegen(&elw.app, &elw.admin).await;
    elw_meldet(&elw).await;
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fuehrung")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

/// Die Admin-Routen der Akten des Gegenübers sind ohne Schalter 404, auch wenn aus der Zeit mit
/// Schalter eine Akte da ist (LLH-1677, Punkt 5).
#[tokio::test]
async fn ohne_schalter_sind_die_akten_des_gegenuebers_404() {
    let (hub, elw) = gekoppelt().await;
    common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akte = fremde(&elw).await[0]["id"].as_i64().unwrap();
    lifeline_hub::instanz::fuehrung::save_schalter(&elw.pool, false)
        .await
        .unwrap();
    let (s, v) = common::anfrage(
        &elw.app,
        "GET",
        "/api/admin/instanz/fuehrung",
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Liste: {v}");
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Akte: {v}");
}

// ── Akte und Austausch ───────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn neuer_einsatz_am_elw_erscheint_am_hub_mit_epoche_eins() {
    let (hub, elw) = gekoppelt().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true);
    assert_eq!(f["epoche"], 1);
    assert_eq!(f["gegenueber"][0]["kennung"], hub.kennung);
    elw_meldet(&elw).await;
    let akten = fremde(&hub).await;
    assert_eq!(akten.len(), 1);
    assert_eq!(akten[0]["fuehrer_kennung"], elw.kennung);
    assert_eq!(akten[0]["epoche"], 1);
    assert_eq!(akten[0]["bezeichnung"], "Lage");
    assert_eq!(akten[0]["fuehrend"], false);
    // Der Kopf am ELW nennt die Führung.
    let (_, kopf) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(kopf["fuehrung"]["fuehrend"], true);
    assert_eq!(kopf["fuehrung"]["epoche"], 1);
}

#[tokio::test]
async fn hundertzwanzig_akten_gehen_in_mehreren_meldungen() {
    let (hub, elw) = gekoppelt().await;
    for i in 0..120 {
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?)")
            .bind(format!("Einsatz {i}"))
            .execute(&elw.pool)
            .await
            .unwrap();
    }
    elw_meldet(&elw).await;
    assert_eq!(fremde(&hub).await.len(), 50, "höchstens 50 je Meldung");
    let naechste: Option<String> =
        sqlx::query_scalar("SELECT naechste_meldung_at FROM instanz_kopplung")
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    let jetzt = lifeline_hub::zeit::jetzt();
    assert!(
        naechste.as_deref().is_some_and(|n| n <= jetzt.as_str()),
        "bei Rest gleich wieder melden: {naechste:?}"
    );
    elw_meldet(&elw).await;
    elw_meldet(&elw).await;
    assert_eq!(fremde(&hub).await.len(), 120);
}

// ── Übergabe und Anfrage ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn elw_uebergibt_zur_verwahrung_und_schreibt_danach_nicht_mehr() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let (s, _) = post(&elw, &format!("/api/einsaetze/{e}/abschliessen"), json!({})).await;
    assert!(s.is_success(), "{s}");
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "der Hub hat den Abschluss noch nicht: {v}"
    );
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .starts_with("Abgleich läuft noch"),
        "{v}"
    );
    abgleichen(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "auch nach dem Abschluss: {v}");
    assert_eq!(v["fuehrend"], false);
    assert_eq!(v["epoche"], 2);
    elw_meldet(&elw).await;
    let a = fuehrung(&hub, einsatz_der_akte(&hub, akte).await).await;
    assert_eq!(a["id"], akte, "eine Akte für Spiegel und Führung");
    assert_eq!(a["fuehrer_kennung"], hub.kennung);
    assert_eq!(a["fuehrend"], true);
    assert_eq!(a["epoche"], 2);
    assert_eq!(a["art"], "uebergabe");
}

#[tokio::test]
async fn nach_uebergabe_ist_schreiben_409_und_lesen_bleibt() {
    let (hub, elw) = gekoppelt().await;
    let (e, _) = elw_einsatz(&hub, &elw).await;
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    ist_spiegel_mit_antraegen(&elw, e).await;
    let (s, _) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, kopf) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(kopf["fuehrung"]["fuehrend"], false);
    // Übergeben kann nur, wer führt.
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn fuehrungspersonal_bedient_die_fuehrung_nicht() {
    let (hub, elw) = gekoppelt().await;
    let (e, _) = elw_einsatz(&hub, &elw).await;
    common::mitglied_mit_funktion(&elw.app, &elw.admin, e, "Fü", "fuehrer", "s2").await;
    let cookie = common::login_cookie(&elw.app, "fuehrer", "fuehrerpw1").await;
    let (s, _) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        &cookie,
        Some(&json!({"an": hub.kennung})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}/fuehrung"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "lesen darf, wer den Einsatz liest");
}

/// Ein gekoppelter Lagemonitor am Einsatz: das Cookie seiner Gerätesitzung.
async fn lagemonitor(i: &Instanz, einsatz: i64) -> String {
    use tower::ServiceExt;
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &i.admin,
        Some(&json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap().to_string();
    let resp = i
        .app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/geraete/koppeln")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers()
        .get(axum::http::header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .expect("Sitzungscookie")
        .to_string()
}

/// LLH-1676 (Spec `instanz-fuehrung`, „Den Verlauf der Führung lesen nur Personen“): ein
/// Gerätekonto, das den Einsatz lesen darf, bekommt den Verlauf mit Namen und Gründen nicht; ein
/// Beobachter liest ihn. Getragen von der Routenliste der Geräte (`geraet::darf_route`).
#[tokio::test]
async fn den_verlauf_lesen_personen_aber_keine_geraete() {
    let (_hub, elw) = gekoppelt().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let pfad = format!("/api/einsaetze/{e}/fuehrung");

    let geraet = lagemonitor(&elw, e).await;
    let (s, _) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}"),
        &geraet,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "das Gerät liest den Einsatz");
    let (s, v) = common::anfrage(&elw.app, "GET", &pfad, &geraet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");

    let id = common::benutzer_anlegen(&elw.app, &elw.admin, "beobachter", "keine").await;
    common::funktion_setzen(&elw.app, &elw.admin, e, id, "beobachter", None).await;
    let beob = common::login_cookie(&elw.app, "beobachter", "beobachterpw1").await;
    let (s, v) = common::anfrage(&elw.app, "GET", &pfad, &beob, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["verlauf"][0]["art"], "angelegt");
}

/// LLH-1676 (Spec `instanz-fuehrung`, Szenario „Einsatzleitung ohne Admin-Rolle“): die
/// Einsatzleitung bedient die Führung, unterschreiben kann sie nicht; das Paneel bietet ihr die
/// Unterschrift deshalb nicht an.
#[tokio::test]
async fn unterschrift_der_einsatzleitung_ohne_admin_rolle_ist_403() {
    let (_hub, elw) = gekoppelt().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let id = common::benutzer_anlegen(&elw.app, &elw.admin, "leitung", "keine").await;
    common::funktion_setzen(&elw.app, &elw.admin, e, id, "einsatzleitung", None).await;
    let leitung = common::login_cookie(&elw.app, "leitung", "leitungpw1").await;
    let (s, v) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}/fuehrung"),
        &leitung,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/fuehrung/notuebernahme/start"),
        &leitung,
        Some(&json!({"grund": "ohne Verbindung"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
}

/// Macht ein Konto am Spiegel zur Einsatzleitung, an jedem Schreibweg vorbei: die
/// Mitglieder-Verwaltung prüft die Org im SQL und der Spiegelschutz sperrt jedes andere
/// Schreiben, also unter dem Merker der Übernahme.
async fn einsatzleitung_am_spiegel(i: &Instanz, einsatz: i64, benutzer: i64) {
    let mut tx = i.pool.begin().await.unwrap();
    sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, 'einsatzleitung')",
    )
    .bind(einsatz)
    .bind(benutzer)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

/// LLH-1705 (Spec `instanz-fuehrung`, „Unterschreiben MUST nur ein Admin der Org“): Der Admin
/// einer anderen Org bedient als Einsatzleitung die Führung des Spiegels, unterschreiben kann er
/// nicht. Der ELW prüfte seine Unterschrift gegen die Schlüssel der Einsatz-Org und verwürfe die
/// Übernahme erst, nachdem der Hub schon geführt hat. Gegenprobe: der Admin der Einsatz-Org
/// beginnt die Unterschrift an derselben Route.
#[tokio::test]
async fn unterschrift_eines_admins_einer_anderen_org_ist_403() {
    let (hub, elw) = gekoppelt().await;
    let (_, akte) = elw_einsatz(&hub, &elw).await;
    let spiegel = einsatz_der_akte(&hub, akte).await;
    let (org_b, admin_b) = common::fremde_org_anlegen(
        &hub.pool,
        "Fremde Org",
        "orgbadmin",
        "orgbadminpw1",
        "keine",
    )
    .await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(admin_b)
        .execute(&hub.pool)
        .await
        .unwrap();
    // Mit eigenem gültigem Schlüssel: am Schlüssel scheitert der Aufruf nicht.
    let p = SoftwarePasskey::new("b", [2u8; 32]);
    {
        let mut conn = hub.pool.acquire().await.unwrap();
        unterschrift::create_lokal(
            &mut conn,
            &unterschrift::NeuerSchluessel {
                org_id: org_b,
                benutzer_id: admin_b,
                benutzer_name: "orgbadmin",
                credential_id: &p.credential_id,
                schluessel: &p.oeffentlich(),
                rp_id: RP,
                origin: ORIGIN,
                bezeichnung: "Stick B",
            },
        )
        .await
        .unwrap();
    }
    einsatzleitung_am_spiegel(&hub, spiegel, admin_b).await;
    let fremd = common::login_cookie(&hub.app, "orgbadmin", "orgbadminpw1").await;
    let (s, v) = common::anfrage(
        &hub.app,
        "GET",
        &format!("/api/einsaetze/{spiegel}"),
        &fremd,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["meine_rolle"], "einsatzleitung", "{v}");
    assert_eq!(
        v["org_id"], 1,
        "der Einsatz gehört der gekoppelten Org: {v}"
    );
    assert_ne!(org_b, 1);
    // Die Führung bedient er: Die Code-Route hinter demselben Gate lehnt nur die Eingabe ab.
    // Formal ungültig muss der Code sein, einen wohlgeformten nähme der Hub an und führte.
    let (s, v) = common::anfrage_json(
        &hub.app,
        "POST",
        &format!("/api/einsaetze/{spiegel}/fuehrung/notuebernahme/code"),
        &fremd,
        Some(&json!({"grund": "ohne Verbindung", "code": "kaputt"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    let start = format!("/api/einsaetze/{spiegel}/fuehrung/notuebernahme/start");
    let (s, v) = common::anfrage_json(
        &hub.app,
        "POST",
        &start,
        &fremd,
        Some(&json!({"grund": "ohne Verbindung"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");

    let (s, v) = post(&hub, &start, json!({"grund": "ohne Verbindung"})).await;
    assert_eq!(s, StatusCode::OK, "Admin der Einsatz-Org: {v}");
    assert!(v["zeremonie"].is_string(), "{v}");
}

/// LLH-1705: Der Abschluss prüft dasselbe wie der Start. Verliert ein Konto die Admin-Rolle
/// zwischen Start und Abschluss, trägt seine Unterschrift nicht mehr, auch wenn es als
/// Einsatzleitung die Führung weiter bedient.
#[tokio::test]
async fn abschluss_der_unterschrift_ohne_admin_rolle_ist_403() {
    let (hub, elw) = gekoppelt().await;
    let (_, akte) = elw_einsatz(&hub, &elw).await;
    let spiegel = einsatz_der_akte(&hub, akte).await;
    einsatzleitung_am_spiegel(&hub, spiegel, 1).await;
    let pfad = format!("/api/einsaetze/{spiegel}/fuehrung/notuebernahme");
    let (s, start) = post(
        &hub,
        &format!("{pfad}/start"),
        json!({"grund": "ohne Verbindung"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{start}");
    let assertion = passkey().sign(start["erklaerung"].as_str().unwrap(), ORIGIN, RP, 0x05);

    sqlx::query("UPDATE benutzer SET system_rolle = 'keiner' WHERE id = 1")
        .execute(&hub.pool)
        .await
        .unwrap();
    let (s, v) = post(
        &hub,
        &format!("{pfad}/abschluss"),
        json!({"zeremonie": start["zeremonie"], "assertion": assertion}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    let a = fuehrung(&hub, spiegel).await;
    assert_eq!(a["fuehrend"], false, "der Hub hat nicht übernommen: {a}");
    assert_eq!(a["fuehrer_kennung"], elw.kennung);
}

#[tokio::test]
async fn elw_fragt_an_und_uebernimmt_bei_ankunft() {
    let (hub, elw) = gekoppelt().await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akte = fremde(&elw).await[0]["id"].as_i64().unwrap();
    assert_eq!(fremde(&elw).await[0]["fuehrer_kennung"], hub.kennung);
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["anfrage_offen"], true);
    elw_meldet(&elw).await;
    let s = einsatz_der_akte(&elw, akte).await;
    let a = fuehrung(&elw, s).await;
    assert_eq!(a["fuehrend"], true, "{a}");
    assert_eq!(a["epoche"], 2);
    assert_eq!(a["anfrage_offen"], false);
    let f = fuehrung(&hub, h).await;
    assert_eq!(f["fuehrend"], false);
    assert_eq!(f["fuehrer_kennung"], elw.kennung);
    assert_eq!(f["art"], "anfrage");
    ist_spiegel_mit_antraegen(&hub, h).await;
    // Ohne Merker: am früheren Spiegel greift kein Schutz-Trigger mehr.
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         SELECT ?, id, 'einsatzleitung' FROM benutzer WHERE benutzername = 'admin' \
         AND id NOT IN (SELECT benutzer_id FROM spiegel_konto)",
    )
    .bind(s)
    .execute(&elw.pool)
    .await
    .expect("der Einsatz ist am ELW kein Spiegel mehr");
    let (st, v) = etb(&elw, s).await;
    assert_eq!(
        st,
        StatusCode::CREATED,
        "der ELW schreibt seinen früheren Spiegel: {v}"
    );
}

#[tokio::test]
async fn anfrage_nur_von_einem_admin_der_org() {
    let (hub, elw) = gekoppelt().await;
    common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akte = fremde(&elw).await[0]["id"].as_i64().unwrap();
    common::benutzer_anlegen(&elw.app, &elw.admin, "fkraft", "fuehrungskraft").await;
    let cookie = common::login_cookie(&elw.app, "fkraft", "fkraftpw1").await;
    let (s, _) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/admin/instanz/fuehrung/{akte}/anfragen"),
        &cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = post(
        &elw,
        "/api/admin/instanz/fuehrung/99999/anfragen",
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Der Admin einer anderen Org derselben Instanz sieht die Akte nicht und kann sie nicht
/// anfragen: 404 wie für eine unbekannte Akte (LLH-1677, Punkt 1, `dienst::load_fremde`).
#[tokio::test]
async fn akte_einer_anderen_org_ist_404() {
    let (hub, elw) = gekoppelt().await;
    common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akte = fremde(&elw).await[0]["id"].as_i64().unwrap();
    let (org_b, admin_b) = common::fremde_org_anlegen(
        &elw.pool,
        "Fremde Org",
        "orgbadmin",
        "orgbadminpw1",
        "keine",
    )
    .await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(admin_b)
        .execute(&elw.pool)
        .await
        .unwrap();
    assert_ne!(org_b, 1);
    let cookie = common::login_cookie(&elw.app, "orgbadmin", "orgbadminpw1").await;
    let (s, v) = common::anfrage(
        &elw.app,
        "GET",
        "/api/admin/instanz/fuehrung",
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v, json!([]), "die Liste der fremden Org bleibt leer");
    for pfad in ["anfragen", "notuebernahme"] {
        let (s, v) = common::anfrage_json(
            &elw.app,
            "POST",
            &format!("/api/admin/instanz/fuehrung/{akte}/{pfad}"),
            &cookie,
            Some(&json!({"grund": "Probe"})),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{pfad}: {v}");
    }
    let f = &fremde(&elw).await[0];
    assert_eq!(f["anfrage_offen"], false, "nichts hat die Akte verändert");
    assert_eq!(f["fuehrer_kennung"], hub.kennung);
}

// ── Gegenprobe über die Kennung (LLH-1862) ───────────────────────────────────────────────────
//
// `einsatz_fuehrung.id` ist `INTEGER PRIMARY KEY` ohne `AUTOINCREMENT`: SQLite vergibt die größte
// ID nach dem Löschen neu. Die Tests ändern die Kennung unter der ID; das ist derselbe Zustand wie
// Löschen und Neuanlage.

/// Setzt unter `akte` einen anderen Einsatz, wie ihn eine Neuanlage unter der alten ID brächte.
async fn anderer_einsatz_unter(i: &Instanz, akte: i64, kennung: &str) {
    sqlx::query("UPDATE einsatz_fuehrung SET kennung = ? WHERE id = ?")
        .bind(kennung)
        .bind(akte)
        .execute(&i.pool)
        .await
        .unwrap();
}

fn mit_kennung(pfad: &str, kennung: &str) -> String {
    let q = form_urlencoded::Serializer::new(String::new())
        .append_pair("kennung", kennung)
        .finish();
    format!("{pfad}?{q}")
}

/// Der Dialog „Führung …“ schickt die Kennung der Akte, die er zeigt. Liegt unter der ID
/// inzwischen ein anderer Einsatz, lehnt jede Bedienroute mit 409 ab und ändert nichts; mit der
/// passenden Kennung und ohne Kennung geht sie wie bisher.
#[tokio::test]
async fn bedienung_einer_akte_unter_neu_vergebener_id_ist_409() {
    let (hub, elw) = gekoppelt().await;
    common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let f = &fremde(&elw).await[0];
    let akte = f["id"].as_i64().unwrap();
    let gezeigt = f["kennung"].as_str().unwrap().to_string();
    let neu = format!("{}/999", hub.kennung);
    anderer_einsatz_unter(&elw, akte, &neu).await;

    for (pfad, body) in [
        ("uebergeben", json!({"an": hub.kennung})),
        ("code", json!({"an": hub.kennung})),
        ("anfragen", json!({})),
        ("notuebernahme", json!({"grund": "Funkausfall"})),
        ("notuebernahme/start", json!({"grund": "Funkausfall"})),
        (
            "notuebernahme/code",
            json!({"grund": "Funkausfall", "code": "AAAA"}),
        ),
        ("bestaetigen", json!({})),
        ("widersprechen", json!({})),
    ] {
        let (s, v) = post(
            &elw,
            &mit_kennung(
                &format!("/api/admin/instanz/fuehrung/{akte}/{pfad}"),
                &gezeigt,
            ),
            body,
        )
        .await;
        // Der Text unterscheidet die Gegenprobe von den 409 der Regeln (Führung liegt beim
        // Gegenüber, keine Übernahme wartet), die hier sonst auch anschlügen.
        assert_eq!(s, StatusCode::CONFLICT, "{pfad}: {v}");
        assert_eq!(v["error"], AKTE_GEWECHSELT, "{pfad}: {v}");
    }
    let f = &fremde(&elw).await[0];
    assert_eq!(f["anfrage_offen"], false, "nichts angefragt");
    assert_eq!(f["kennung"], neu.as_str());

    let (s, v) = post(
        &elw,
        &mit_kennung(
            &format!("/api/admin/instanz/fuehrung/{akte}/anfragen"),
            &neu,
        ),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "passende Kennung: {v}");
    assert_eq!(v["anfrage_offen"], true);
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "ohne Kennung wie bisher: {v}");
}

/// Zwischen dem Laden in der Route und der Schreibtransaktion kann die Akte wechseln: Jeder Dienst
/// prüft die Kennung in seiner Transaktion selbst, vor seinen Regeln.
#[tokio::test]
async fn dienst_prueft_die_kennung_in_seiner_transaktion() {
    use lifeline_hub::error::AppError;
    use lifeline_hub::instanz::fuehrung::dienst;
    use lifeline_hub::instanz::fuehrung::erklaerung::{
        FuehrungBeweis, NotuebernahmeErklaerung, TYP_NOTUEBERNAHME,
    };
    use lifeline_hub::instanz::fuehrung::repo::AkteRef;
    use lifeline_hub::instanz::fuehrung::Epoche;

    let (hub, elw) = gekoppelt().await;
    common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let f = &fremde(&elw).await[0];
    let akte = f["id"].as_i64().unwrap();
    let gezeigt = f["kennung"].as_str().unwrap().to_string();
    let r = AkteRef {
        id: akte,
        kennung: &gezeigt,
    };
    anderer_einsatz_unter(&elw, akte, &format!("{}/999", hub.kennung)).await;

    let ist_gewechselt = |name: &str, r: Result<(), AppError>| match r {
        Err(AppError::Conflict(t)) => assert_eq!(t, AKTE_GEWECHSELT, "{name}"),
        anders => panic!("{name}: erwartet 409, war {anders:?}"),
    };
    let p = &elw.pool;
    ist_gewechselt(
        "uebergeben",
        dienst::uebergeben(p, r, &hub.kennung, "Erika")
            .await
            .map(drop),
    );
    ist_gewechselt(
        "code_abgeben",
        dienst::code_abgeben(p, r, &hub.kennung, "Erika")
            .await
            .map(drop),
    );
    ist_gewechselt("anfragen", dienst::anfragen(p, r).await.map(drop));
    ist_gewechselt(
        "notuebernahme_gegen_erreichte",
        dienst::notuebernahme_gegen_erreichte(p, r, "Probe", "Erika")
            .await
            .map(drop),
    );
    ist_gewechselt(
        "build_erklaerung_gegen_meldende",
        dienst::build_erklaerung_gegen_meldende(p, r, "Probe", "Erika")
            .await
            .map(drop),
    );
    ist_gewechselt(
        "notuebernahme_mit_code",
        dienst::notuebernahme_mit_code(p, r, "Probe", "ABCD-EFGH-JKLM-NPQR", "Erika")
            .await
            .map(drop),
    );
    ist_gewechselt(
        "bestaetigen",
        dienst::bestaetigen(p, r, "Erika").await.map(drop),
    );
    ist_gewechselt(
        "widersprechen",
        dienst::widersprechen(p, r, "Erika").await.map(drop),
    );
    // Die Erklärung nennt die gezeigte Akte; Inhalt und Beweis zählen nicht, die Kennung scheitert
    // vorher.
    let e = NotuebernahmeErklaerung {
        typ: TYP_NOTUEBERNAHME.into(),
        einsatz: gezeigt.clone(),
        org: "org".into(),
        epoche_alt: Epoche::neu(1, &hub.kennung),
        epoche_neu: Epoche::neu(2, &elw.kennung),
        fuehrer_alt: hub.kennung.clone(),
        fuehrer_neu: elw.kennung.clone(),
        grund: "Probe".into(),
        zeitpunkt: "2026-11-13 12:00:00".into(),
        unterzeichner: "Erika".into(),
    };
    let beweis = FuehrungBeweis::Code {
        pruefwert: "p".into(),
    };
    ist_gewechselt(
        "notuebernahme_gegen_meldende",
        dienst::notuebernahme_gegen_meldende(p, r, &e, &beweis, "Erika")
            .await
            .map(drop),
    );
    let f = &fremde(&elw).await[0];
    assert_eq!(f["anfrage_offen"], false, "nichts angefragt: {f}");
    assert_eq!(
        f["fuehrer_kennung"], hub.kennung,
        "Führung unverändert: {f}"
    );
}

/// Eine Unterschrift gilt dem Einsatz ihrer Erklärung. Liegt unter der ID der Zeremonie beim
/// Abschluss ein anderer Einsatz, übernimmt der Hub ihn nicht, auch wenn Epoche und Führer gleich
/// sind.
#[tokio::test]
async fn unterschrift_fuer_einen_anderen_einsatz_unter_derselben_id_wird_abgelehnt() {
    let (hub, elw) = gekoppelt().await;
    let (_, akte) = elw_einsatz(&hub, &elw).await;
    let (s, start) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/start"),
        json!({"grund": "Funkausfall"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{start}");
    anderer_einsatz_unter(&hub, akte, &format!("{}/999", elw.kennung)).await;
    let assertion = passkey().sign(start["erklaerung"].as_str().unwrap(), ORIGIN, RP, 0x05);
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/abschluss"),
        json!({"zeremonie": start["zeremonie"], "assertion": assertion}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    let f = &fremde(&hub).await[0];
    assert_eq!(f["fuehrend"], false, "der Hub hat nicht übernommen: {f}");
    assert_eq!(f["fuehrer_kennung"], elw.kennung);
}

#[tokio::test]
async fn notuebernahme_gegen_den_hub_nimmt_er_ohne_rueckfrage_an() {
    let (hub, elw) = gekoppelt().await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akte = fremde(&elw).await[0]["id"].as_i64().unwrap();
    let (s, _) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme"),
        json!({"grund": " "}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Grund Pflicht");
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme"),
        json!({"grund": "Hub nicht erreichbar"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], true);
    elw_meldet(&elw).await;
    let f = fuehrung(&hub, h).await;
    assert_eq!(f["fuehrer_kennung"], elw.kennung);
    assert_eq!(f["art"], "notuebernahme");
    assert!(aktionen(&hub.pool)
        .await
        .contains(&"fuehrung_notuebernahme".to_string()));
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"fuehrung_notuebernahme".to_string()));
}

// ── Notübernahme gegen den ELW ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn notuebernahme_mit_unterschrift_wartet_am_elw_auf_bestaetigung() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let v = hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ohne Verbindung seit 40 min").await;
    assert_eq!(v["fuehrend"], true);
    assert_eq!(v["epoche"], 2);
    // Drei Meldetakte, bevor jemand entscheidet (LLH-1671): Die offene Übernahme pendelt nicht,
    // die Bruchstelle bleibt die letzte Meldung vor der ersten, es gibt genau eine
    // Benachrichtigung. Die Meldezeit wird je Takt gesetzt, sonst lägen alle in derselben Sekunde.
    const BRUCH: &str = "2026-01-01 10:00:00";
    let stand_am_hub = || async {
        sqlx::query_scalar::<_, i64>("SELECT stand FROM einsatz_fuehrung WHERE id = ?")
            .bind(akte)
            .fetch_one(&hub.pool)
            .await
            .unwrap()
    };
    let mut stand_nach_erster = 0;
    for (takt, zuletzt) in [BRUCH, "2026-01-01 10:01:00", "2026-01-01 10:02:00"]
        .into_iter()
        .enumerate()
    {
        sqlx::query("UPDATE instanz_kopplung SET zuletzt_gesehen_at = ?")
            .bind(zuletzt)
            .execute(&elw.pool)
            .await
            .unwrap();
        elw_meldet(&elw).await;
        match takt {
            0 => stand_nach_erster = stand_am_hub().await,
            1 => {
                assert_eq!(
                    stand_am_hub().await,
                    stand_nach_erster,
                    "der Hub schickt seine Akte nicht neu, weil der ELW sie offen hält"
                );
                // Der Hub schickt dieselbe Übernahme doch noch einmal mit neuem Stand und
                // geändertem Kopf (etwa nach einer Änderung der Bezeichnung am Hub).
                let stand: i64 = sqlx::query_scalar(
                    "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
                     RETURNING fuehrung_stand",
                )
                .fetch_one(&hub.pool)
                .await
                .unwrap();
                sqlx::query(
                    "UPDATE einsatz_fuehrung SET stand = ?, bezeichnung = bezeichnung || ' (neu)' \
                     WHERE id = ?",
                )
                .bind(stand)
                .bind(akte)
                .execute(&hub.pool)
                .await
                .unwrap();
            }
            _ => {}
        }
    }
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true, "der ELW gibt nie still ab");
    assert_eq!(f["offen"]["grund"], "ELW ohne Verbindung seit 40 min");
    assert_eq!(f["offen"]["epoche"], 2);
    assert_eq!(
        f["offen"]["bruch_at"], BRUCH,
        "die Bruchstelle wandert nicht mit jeder Meldung"
    );
    assert_eq!(
        benachrichtigungen(&elw.pool)
            .await
            .iter()
            .filter(|a| *a == "fuehrung_uebernommen")
            .count(),
        1,
        "eine offene Übernahme meldet sich einmal, nicht je Meldetakt"
    );
    assert!(f["offen"]["unterzeichner"].as_str().is_some());
    let (s, _) = etb(&elw, e).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "bis zur Entscheidung schreibt der ELW weiter"
    );
    let (_, kopf) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(kopf["fuehrung"]["offen"], true);
    assert!(benachrichtigungen(&elw.pool)
        .await
        .contains(&"fuehrung_uebernommen".to_string()));

    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], false);
    assert_eq!(v["bruch_at"], BRUCH);
    let verlauf = v["verlauf"].as_array().unwrap();
    let letzter = verlauf.last().unwrap();
    assert_eq!(letzter["art"], "bestaetigt");
    assert_eq!(letzter["bruch_at"], BRUCH);
    ist_spiegel_mit_antraegen(&elw, e).await;
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"fuehrung_notuebernahme".to_string()));
    elw_meldet(&elw).await;
    let a = fuehrung(&hub, einsatz_der_akte(&hub, akte).await).await;
    assert_eq!(a["art"], "bestaetigt");
    // Ohne offene Übernahme ist Bestätigen 409.
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn offene_uebernahme_behaelt_ihre_bruchstelle_bei_neuer_erklaerung_derselben_epoche() {
    // Kommt zur offenen Epoche eine andere, gültig unterschriebene Erklärung, gilt die neue,
    // aber die Bruchstelle gehört der Übernahme und bleibt (LLH-1671).
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "erste Erklärung").await;
    const BRUCH: &str = "2026-01-01 10:00:00";
    let melde_mit = |zuletzt: &'static str| {
        let elw = &elw;
        async move {
            sqlx::query("UPDATE instanz_kopplung SET zuletzt_gesehen_at = ?")
                .bind(zuletzt)
                .execute(&elw.pool)
                .await
                .unwrap();
            elw_meldet(elw).await;
        }
    };
    melde_mit(BRUCH).await;
    assert_eq!(fuehrung(&elw, e).await["offen"]["bruch_at"], BRUCH);

    let text: String = sqlx::query_scalar("SELECT erklaerung FROM einsatz_fuehrung WHERE id = ?")
        .bind(akte)
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    let mut erklaerung: Value = serde_json::from_str(&text).unwrap();
    erklaerung["grund"] = json!("zweite Erklärung");
    let text = erklaerung.to_string();
    let assertion = passkey().sign(&text, ORIGIN, RP, 0x05);
    let beweis = json!({"art": "unterschrift", "assertion": assertion}).to_string();
    let stand: i64 = sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz_fuehrung SET erklaerung = ?, beweis = ?, stand = ? WHERE id = ?")
        .bind(&text)
        .bind(&beweis)
        .bind(stand)
        .bind(akte)
        .execute(&hub.pool)
        .await
        .unwrap();
    melde_mit("2026-01-01 10:01:00").await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["offen"]["grund"], "zweite Erklärung", "{f}");
    assert_eq!(f["offen"]["epoche"], 2);
    assert_eq!(
        f["offen"]["bruch_at"], BRUCH,
        "dieselbe Epoche behält ihre Bruchstelle"
    );
}

#[tokio::test]
async fn widerrufener_schluessel_verwirft_die_offene_uebernahme_beim_naechsten_eingang() {
    // Der Schlüssel von A wird am Hub widerrufen, während die Übernahme am ELW offen ist
    // (LLH-1671). Die Meldung, mit der der Widerruf ankommt, verwirft sie wie bei Ankunft.
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    elw_meldet(&elw).await;
    assert_eq!(fuehrung(&elw, e).await["offen"]["epoche"], 2);
    // A wird am Hub widerrufen; dafür braucht die Org einen zweiten, gegengezeichneten Schlüssel.
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let oeff_b = b.oeffentlich();
    let id_b = {
        let mut conn = hub.pool.acquire().await.unwrap();
        unterschrift::create_lokal(
            &mut conn,
            &unterschrift::NeuerSchluessel {
                org_id: 1,
                benutzer_id: 1,
                benutzer_name: "Admin",
                credential_id: &b.credential_id,
                schluessel: &oeff_b,
                rp_id: RP,
                origin: ORIGIN,
                bezeichnung: "Stick B",
            },
        )
        .await
        .unwrap()
    };
    let (s, start) = post(
        &hub,
        &format!("/api/admin/instanz/unterschrift/{id_b}/gegenzeichnen/start"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{start}");
    let assertion = passkey().sign(start["erklaerung"].as_str().unwrap(), ORIGIN, RP, 0x05);
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/unterschrift/{id_b}/gegenzeichnen/abschluss"),
        json!({"zeremonie": start["zeremonie"], "assertion": assertion}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let id_a: i64 =
        sqlx::query_scalar("SELECT id FROM unterschrift_schluessel WHERE credential_id = 'a'")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/unterschrift/{id_a}/widerrufen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Genau eine Meldung: Der Widerruf kommt mit ihr und verwirft im selben Takt.
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert!(f["offen"].is_null(), "{f}");
    assert_eq!(f["fuehrend"], true);
    assert_eq!(f["art"], "verworfen");
    assert_eq!(f["epoche"], 3);
    assert!(benachrichtigungen(&elw.pool)
        .await
        .contains(&"fuehrung_ungueltig".to_string()));
    elw_meldet(&elw).await;
    let a = &fremde(&hub).await[0];
    assert_eq!(a["fuehrer_kennung"], elw.kennung);
    assert_eq!(a["art"], "verworfen");
}

#[tokio::test]
async fn bestaetigen_mit_widerrufenem_schluessel_ist_409() {
    // Der Widerruf kommt zwischen Anzeige und Klick: Bestätigen gibt die Führung nicht ab
    // (LLH-1671).
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    elw_meldet(&elw).await;
    sqlx::query("UPDATE unterschrift_schluessel SET zustand = 'widerrufen'")
        .execute(&elw.pool)
        .await
        .unwrap();
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Unterschrift"), "{v}");
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true);
    assert_eq!(f["offen"]["epoche"], 2, "die Entscheidung bleibt offen");
}

#[tokio::test]
async fn widerspruch_heisst_rueckuebernahme() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/widersprechen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], true);
    assert_eq!(v["epoche"], 3);
    assert!(v["offen"].is_null());
    elw_meldet(&elw).await;
    let a = &fremde(&hub).await[0];
    assert_eq!(a["fuehrer_kennung"], elw.kennung);
    assert_eq!(a["epoche"], 3);
    assert_eq!(a["art"], "widerspruch");
    let (_, u) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
    assert!(
        u["kopplungen"][0]["hinweis"]
            .as_str()
            .unwrap()
            .contains("widersprochen"),
        "{u}"
    );
    assert!(aktionen(&hub.pool)
        .await
        .contains(&"fuehrung_widerspruch".to_string()));
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"fuehrung_widerspruch".to_string()));
}

/// Die Bruchstelle ist die letzte erfolgreiche Meldung vor der Übernahme, nicht der Zeitpunkt der
/// Meldung, die sie bringt und nicht der des Bestätigens (Spec „Die meldende Seite gibt nie
/// still ab“, LLH-1677, Punkt 6).
#[tokio::test]
async fn bruchstelle_ist_die_letzte_meldung_vor_der_uebernahme() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ohne Verbindung").await;
    // Fester, alter Zeitpunkt: weder „jetzt“ noch der Zeitpunkt dieser Meldung trifft ihn zufällig.
    let zuletzt = "2026-01-01 08:00:00";
    sqlx::query("UPDATE instanz_kopplung SET zuletzt_gesehen_at = ?")
        .bind(zuletzt)
        .execute(&elw.pool)
        .await
        .unwrap();
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["bruch_at"], zuletzt, "{v}");
    let letzter = v["verlauf"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(letzter["art"], "bestaetigt");
    assert_eq!(letzter["bruch_at"], zuletzt, "{letzter}");
}

/// Eine offene Übernahme am ELW, deren Epoche danach an der Akte per SQL verändert wird.
async fn offen_am_elw() -> (Instanz, Instanz, i64) {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    elw_meldet(&elw).await;
    assert!(fuehrung(&elw, e).await["offen"].is_object());
    (hub, elw, e)
}

async fn bestaetigen_ist_409_geaendert(elw: &Instanz, e: i64) {
    let (s, v) = post(
        elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(
        v["error"], "Die Führung hat sich inzwischen geändert.",
        "{v}"
    );
    let f = fuehrung(elw, e).await;
    assert_eq!(f["fuehrend"], true, "nichts übernommen");
}

/// Bestätigen gilt nur dem Stand, gegen den die Übernahme erklärt wurde: hat sich die Epoche der
/// Akte seither geändert, ist es 409 (LLH-1677, Punkt 4). Erste Hälfte der Bedingung: die Akte
/// steht schon auf der Epoche der Übernahme (2, Hub) oder darüber (3, ELW). Ohne lesbare
/// Erklärung greift nur sie.
#[tokio::test]
async fn bestaetigen_nach_epoche_ueber_der_uebernahme_ist_409() {
    for gleich in [true, false] {
        let (hub, elw, e) = offen_am_elw().await;
        let offen: String =
            sqlx::query_scalar("SELECT offen FROM einsatz_fuehrung WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&elw.pool)
                .await
                .unwrap();
        let mut offen: Value = serde_json::from_str(&offen).unwrap();
        assert_eq!(
            offen["epoche"],
            json!({"zaehler": 2, "instanz": hub.kennung})
        );
        offen["erklaerung"] = Value::Null;
        let (zaehler, instanz) = if gleich {
            (2, hub.kennung.clone())
        } else {
            (3, elw.kennung.clone())
        };
        sqlx::query(
            "UPDATE einsatz_fuehrung SET epoche_zaehler = ?, epoche_instanz = ?, offen = ? \
             WHERE einsatz_id = ?",
        )
        .bind(zaehler)
        .bind(instanz)
        .bind(offen.to_string())
        .bind(e)
        .execute(&elw.pool)
        .await
        .unwrap();
        bestaetigen_ist_409_geaendert(&elw, e).await;
    }
}

/// Zweite Hälfte: die Epoche der Akte liegt weiter unter der Übernahme, ist aber nicht mehr die,
/// gegen die erklärt wurde.
#[tokio::test]
async fn bestaetigen_nach_anderer_alter_epoche_ist_409() {
    let (_hub, elw, e) = offen_am_elw().await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["epoche"], 1);
    sqlx::query("UPDATE einsatz_fuehrung SET epoche_instanz = 'dritte' WHERE einsatz_id = ?")
        .bind(e)
        .execute(&elw.pool)
        .await
        .unwrap();
    bestaetigen_ist_409_geaendert(&elw, e).await;
}

#[tokio::test]
async fn uebernahme_ohne_gueltigen_beweis_wird_verworfen_mit_alarm() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    // Ein kompromittierter Hub erklärt sich ohne Unterschrift zum Führer.
    let stand: i64 = sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE einsatz_fuehrung SET epoche_zaehler = 2, epoche_instanz = ?, fuehrer_kennung = ?, \
         art = 'notuebernahme', stand = ? WHERE id = ?",
    )
    .bind(&hub.kennung)
    .bind(&hub.kennung)
    .bind(stand)
    .bind(akte)
    .execute(&hub.pool)
    .await
    .unwrap();
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true);
    assert_eq!(
        f["epoche"], 3,
        "der ELW führt mit der nächsten Epoche weiter"
    );
    assert_eq!(f["art"], "verworfen");
    assert!(f["offen"].is_null());
    assert!(benachrichtigungen(&elw.pool)
        .await
        .contains(&"fuehrung_ungueltig".to_string()));
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"fuehrung_verworfen".to_string()));
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    elw_meldet(&elw).await;
    let a = &fremde(&hub).await[0];
    assert_eq!(a["fuehrer_kennung"], elw.kennung);
    assert_eq!(a["art"], "verworfen");
}

#[tokio::test]
async fn unterschrift_eines_wartenden_schluessels_traegt_nicht() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    // Der Schlüssel von A wartet am ELW (etwa nachgeliefert, noch nicht bestätigt).
    sqlx::query("UPDATE unterschrift_schluessel SET zustand = 'wartet_auf_bestaetigung'")
        .execute(&elw.pool)
        .await
        .unwrap();
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["art"], "verworfen");
    assert_eq!(f["fuehrend"], true);
}

/// Eine gültig unterschriebene Erklärung trägt nur die Übernahme, zu der sie passt: je Feld
/// (Einsatz, Org, neue und alte Epoche, neuer und alter Führer) eine Abweichung, jede mit
/// gültiger Unterschrift über genau den abweichenden Text. Der ELW verwirft alle mit „passt
/// nicht“ und nicht an der Unterschrift (LLH-1677, Punkt 2, `austausch::check_unterschrift`).
#[tokio::test]
async fn unterschriebene_erklaerung_mit_abweichendem_feld_wird_verworfen() {
    type Abweichung = (&'static str, fn(&mut Value, &str, &str));
    let abweichungen: [Abweichung; 6] = [
        ("einsatz", |v, _, anderer| v["einsatz"] = json!(anderer)),
        ("org", |v, _, _| {
            v["org"] = json!(format!("{}-fremd", v["org"].as_str().unwrap()))
        }),
        ("epoche_neu", |v, _, _| {
            v["epoche_neu"]["zaehler"] = json!(3)
        }),
        ("fuehrer_neu", |v, _, _| v["fuehrer_neu"] = json!("dritte")),
        ("fuehrer_alt", |v, _, _| v["fuehrer_alt"] = json!("dritte")),
        ("epoche_alt", |v, hub, _| {
            v["epoche_alt"]["instanz"] = json!(hub)
        }),
    ];
    let (hub, elw) = gekoppelt().await;
    let mut einsaetze = Vec::new();
    for _ in &abweichungen {
        einsaetze.push(common::einsatz_anlegen(&elw.app, &elw.admin).await);
    }
    elw_meldet(&elw).await;
    let akten = fremde(&hub).await;
    let mut kennungen = Vec::new();
    for e in &einsaetze {
        kennungen.push(
            fuehrung(&elw, *e).await["kennung"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    let akte_von = |kennung: &str| {
        akten
            .iter()
            .find(|a| a["kennung"] == kennung)
            .unwrap_or_else(|| panic!("Akte {kennung} fehlt am Hub"))["id"]
            .as_i64()
            .unwrap()
    };
    for (i, (feld, aendern)) in abweichungen.iter().enumerate() {
        let akte = akte_von(&kennungen[i]);
        hub_uebernimmt_mit_unterschrift(&hub, akte, feld).await;
        let text: String =
            sqlx::query_scalar("SELECT erklaerung FROM einsatz_fuehrung WHERE id = ?")
                .bind(akte)
                .fetch_one(&hub.pool)
                .await
                .unwrap();
        let mut v: Value = serde_json::from_str(&text).unwrap();
        let anderer = &kennungen[(i + 1) % kennungen.len()];
        aendern(&mut v, &hub.kennung, anderer);
        let neu = v.to_string();
        assert_ne!(
            v,
            serde_json::from_str::<Value>(&text).unwrap(),
            "{feld}: die Abweichung ändert die Erklärung"
        );
        let assertion = passkey().sign(&neu, ORIGIN, RP, 0x05);
        sqlx::query("UPDATE einsatz_fuehrung SET erklaerung = ?, beweis = ? WHERE id = ?")
            .bind(&neu)
            .bind(json!({"art": "unterschrift", "assertion": assertion}).to_string())
            .bind(akte)
            .execute(&hub.pool)
            .await
            .unwrap();
    }
    elw_meldet(&elw).await;
    for (i, (feld, _)) in abweichungen.iter().enumerate() {
        let f = fuehrung(&elw, einsaetze[i]).await;
        assert_eq!(f["art"], "verworfen", "{feld}: {f}");
        assert_eq!(f["fuehrend"], true, "{feld}");
        let grund = f["verlauf"].as_array().unwrap().last().unwrap()["grund"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(
            grund.contains("passt nicht zur Übernahme"),
            "{feld}: verworfen am Feldvergleich, nicht an der Unterschrift: {grund}"
        );
    }
}

#[tokio::test]
async fn notuebernahme_ohne_eigenen_schluessel_und_ohne_code_ist_409() {
    let (hub, elw) = gekoppelt().await;
    let (_, akte) = elw_einsatz(&hub, &elw).await;
    sqlx::query("UPDATE unterschrift_schluessel SET zustand = 'widerrufen'")
        .execute(&hub.pool)
        .await
        .unwrap();
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/start"),
        json!({"grund": "Probe"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Code"));
    // Gegen die meldende Seite geht es nicht ohne Beweis.
    let (s, _) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme"),
        json!({"grund": "Probe"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

// ── Abgabecode ───────────────────────────────────────────────────────────────────────────────

async fn code_am_elw(hub: &Instanz, elw: &Instanz, e: i64) -> String {
    let (s, v) = post(
        elw,
        &format!("/api/einsaetze/{e}/fuehrung/code"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrung"]["fuehrend"], false);
    assert_eq!(v["fuehrung"]["art"], "code_abgabe");
    v["code"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn abgabe_per_code_und_eingabe_am_hub() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let code = code_am_elw(&hub, &elw, e).await;
    assert_eq!(code.len(), 19, "Vierergruppen: {code}");
    // Ab dem Code schreibt der ELW nicht mehr; was er erfasst, wird Antrag an den Hub.
    ist_spiegel_mit_antraegen(&elw, e).await;
    let gespeichert: Option<String> =
        sqlx::query_scalar("SELECT abgabe_schluessel FROM einsatz_fuehrung WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert!(gespeichert.is_some_and(|g| !g.contains(&code.replace('-', ""))));
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": code.to_lowercase()}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], true);
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], false);
    assert_eq!(f["fuehrer_kennung"], hub.kennung);
    assert!(benachrichtigungen(&elw.pool).await.is_empty(), "kein Alarm");
    let letzter = f["verlauf"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(letzter["grund"], "per Funk");

    // Admin-Spur auf beiden Seiten (LLH-1674): am Hub die Eingabe durch die Person, am ELW das
    // Erzeugen durch die Person und die Annahme, ausgelöst vom Hub.
    let hub_spur = spur_fuehrung(&hub.pool).await;
    assert_eq!(hub_spur.len(), 1, "{hub_spur:?}");
    assert_eq!(hub_spur[0].0, "fuehrung_notuebernahme");
    assert!(hub_spur[0].1, "die Person am Hub handelt");
    assert!(hub_spur[0].2.contains("mit Code: per Funk"), "{hub_spur:?}");
    let elw_spur = spur_fuehrung(&elw.pool).await;
    assert_eq!(elw_spur.len(), 2, "{elw_spur:?}");
    assert!(elw_spur
        .iter()
        .all(|(aktion, _, _)| aktion == "fuehrung_notuebernahme"));
    assert!(elw_spur[0].1, "das Erzeugen geht auf die Person am ELW");
    assert!(elw_spur[0].2.contains("Abgabecode"), "{elw_spur:?}");
    assert!(!elw_spur[1].1, "die Annahme löst der Hub aus");
    assert!(elw_spur[1].2.contains("mit Code: per Funk"), "{elw_spur:?}");
    // Eine weitere Meldung schreibt keinen zweiten Eintrag.
    elw_meldet(&elw).await;
    assert_eq!(spur_fuehrung(&elw.pool).await.len(), 2);
}

/// Klemmt am ELW das Festhalten des Meldeversuchs, gilt die ganze Meldung nicht (LLH-1674): Eine
/// verworfene Übernahme ohne Alarm und Admin-Spur darf nicht entstehen. Die nächste Meldung holt
/// alles nach.
#[tokio::test]
async fn klemmender_meldeversuch_laesst_keine_uebernahme_ohne_spur() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    code_am_elw(&hub, &elw, e).await;
    let (s, _) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": "ABCD-EFGH-JKMN-PQRS"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TRIGGER klemmt BEFORE UPDATE OF fehlversuche ON instanz_kopplung \
         BEGIN SELECT RAISE(ABORT, 'klemmt'); END",
    )
    .execute(&elw.pool)
    .await
    .unwrap();
    let r = lifeline_hub::instanz::melden::run_durchlauf(&elw.pool).await;
    assert!(r.is_err(), "der Meldeversuch klemmt");
    let f = fuehrung(&elw, e).await;
    assert_eq!(
        f["art"] == "verworfen",
        aktionen(&elw.pool)
            .await
            .contains(&"fuehrung_verworfen".to_string()),
        "verworfen nur mit Admin-Spur: {f}"
    );
    sqlx::query("DROP TRIGGER klemmt")
        .execute(&elw.pool)
        .await
        .unwrap();
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["art"], "verworfen");
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"fuehrung_verworfen".to_string()));
    assert!(benachrichtigungen(&elw.pool)
        .await
        .contains(&"fuehrung_ungueltig".to_string()));
}

#[tokio::test]
async fn falscher_code_wirft_die_fuehrung_an_den_elw_zurueck() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    code_am_elw(&hub, &elw, e).await;
    let (s, _) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": "ABCD-EFGH-JKMN-PQRS"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "der Hub kann den Code nicht prüfen");
    let (s, _) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": "ABCD-EFGH-JKMN-PQRT"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "führt schon");
    let (s, _) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": "kurz"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "kein Code");
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true);
    assert_eq!(f["art"], "verworfen");
    assert!(benachrichtigungen(&elw.pool)
        .await
        .contains(&"fuehrung_ungueltig".to_string()));
}

/// Ein neuer Code macht den vorigen ungültig (Spec „Code zur Abgabe erzeugt die meldende Seite“,
/// LLH-1677, Punkt 3). Einen zweiten Code gibt es nur, wenn der ELW wieder führt, also auf einer
/// neuen Epoche; die Regel tragen das Verwerfen (es löscht den Schlüssel) und die Bindung des
/// Schlüssels an die Epoche. Ablauf: Code 1, der Hub tippt falsch, der ELW verwirft und führt
/// wieder, gleicht ab und erzeugt Code 2. Danach gibt der Hub Code 1 oder Code 2 ein.
async fn nach_zweitem_code(erster_gilt: bool) -> (Instanz, Instanz, i64) {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let erster = code_am_elw(&hub, &elw, e).await;
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "vertippt", "code": "ABCD-EFGH-JKMN-PQRS"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    assert_eq!(fuehrung(&elw, e).await["fuehrend"], true, "verworfen");
    let schluessel: Option<String> =
        sqlx::query_scalar("SELECT abgabe_schluessel FROM einsatz_fuehrung WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert!(
        schluessel.is_none(),
        "das Verwerfen löscht den Schlüssel von Code 1"
    );
    elw_meldet(&elw).await;
    let a = fuehrung(&hub, einsatz_der_akte(&hub, akte).await).await;
    assert_eq!(
        a["fuehrer_kennung"], elw.kennung,
        "der Hub kennt den neuen Stand"
    );
    let zweiter = code_am_elw(&hub, &elw, e).await;
    assert_ne!(erster, zweiter);
    let eingabe = if erster_gilt { erster } else { zweiter };
    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": "per Funk", "code": eingabe}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    (hub, elw, e)
}

#[tokio::test]
async fn der_erste_code_traegt_nach_einem_zweiten_nicht_mehr() {
    let (_hub, elw, e) = nach_zweitem_code(true).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true, "{f}");
    assert_eq!(f["art"], "verworfen");
    // Geprüft gegen den Schlüssel von Code 2 auf dessen Epoche, nicht an einer fremden Epoche.
    let grund = f["verlauf"].as_array().unwrap().last().unwrap()["grund"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(grund.contains("Code passt nicht"), "{grund}");
}

#[tokio::test]
async fn der_zweite_code_traegt() {
    let (hub, elw, e) = nach_zweitem_code(false).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], false, "{f}");
    assert_eq!(f["fuehrer_kennung"], hub.kennung);
    let letzter = f["verlauf"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(letzter["grund"], "per Funk");
}

// ── Zwei ELW an einem Hub (LLH-1669) ─────────────────────────────────────────────────────────
//
// Zwei Notübernahmen mit demselben Zähler entstehen nur zwischen zwei Instanzen, die beide nicht
// führen, also nur mit mindestens drei Instanzen (Change `faq7l7m4-zwei-elw-unterlegene-seite`,
// design.md, Context). Der Hub behält die zuerst angenommene Führung (D1); die unterlegene ELW hält
// die Führung des Dritten offen (D2, D3); führt der Hub mit der Epoche eines Dritten, entscheidet
// ihre Einsatzleitung (D7).

/// Eine weitere ELW derselben Hub-Org.
async fn weiterer_elw(hub: &Instanz) -> Instanz {
    let elw = instanz(true).await;
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw.admin,
        Some(&json!({"adresse": hub.adresse, "code": v["code"]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    elw
}

/// Die ELW erreicht den Hub nicht mehr (auch der Anstoß nach einer Bedienung läuft ins Leere).
async fn ohne_verbindung(elw: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET gegenueber_adresse = 'http://127.0.0.1:9'")
        .execute(&elw.pool)
        .await
        .unwrap();
}

async fn wieder_verbunden(elw: &Instanz, hub: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET gegenueber_adresse = ?")
        .bind(&hub.adresse)
        .execute(&elw.pool)
        .await
        .unwrap();
}

/// Die einzige Akte an einer ELW (der Einsatz des Hubs) und ihr Einsatz dort.
async fn akte_und_einsatz(elw: &Instanz) -> (i64, i64) {
    let akte = fremde(elw).await[0]["id"].as_i64().unwrap();
    (akte, einsatz_der_akte(elw, akte).await)
}

/// Notübernahme gegen den Hub; danach ist der Admin Einsatzleitung (der Einsatz ist hier kein
/// Spiegel mehr), damit ihn der Hinweis „Führung übernommen“ erreicht.
async fn notuebernahme_gegen_hub(elw: &Instanz, akte: i64) {
    let (s, v) = post(
        elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme"),
        json!({"grund": "Hub nicht erreichbar"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], true);
    mitglied_werden(elw, einsatz_der_akte(elw, akte).await).await;
}

/// Die ELW fragt die Führung beim Hub an und bekommt sie mit der nächsten Meldung.
async fn anfragen_und_melden(elw: &Instanz, akte: i64) {
    let (s, v) = post(
        elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(elw).await;
}

/// Die ELW gibt die Führung an den Hub zurück und meldet sich.
async fn an_hub_zurueck(elw: &Instanz, hub: &Instanz, einsatz: i64) {
    abgleichen(elw).await;
    let (s, v) = post(
        elw,
        &format!("/api/einsaetze/{einsatz}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(elw).await;
}

struct ZweiElw {
    hub: Instanz,
    /// Die ELW mit der größeren Kennung: ihre Epoche (2, gross) ist die größere.
    gross: Instanz,
    klein: Instanz,
    h: i64,
    e_gross: i64,
    e_klein: i64,
}

/// Der Hub führt einen eigenen Einsatz mit (1, Hub); beide ELW kennen ihn und erklären ohne
/// Verbindung die Notübernahme, (2, gross) und (2, klein). Die Rollen hängen an den Kennungen,
/// damit jeder Test denselben Zweig nimmt.
async fn zwei_notuebernahmen() -> ZweiElw {
    let (hub, elw1) = gekoppelt().await;
    let elw2 = weiterer_elw(&hub).await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw1).await;
    elw_meldet(&elw2).await;
    let (gross, klein) = if elw1.kennung > elw2.kennung {
        (elw1, elw2)
    } else {
        (elw2, elw1)
    };
    let mut einsaetze = Vec::new();
    for elw in [&gross, &klein] {
        let (akte, e) = akte_und_einsatz(elw).await;
        ohne_verbindung(elw).await;
        notuebernahme_gegen_hub(elw, akte).await;
        wieder_verbunden(elw, &hub).await;
        einsaetze.push(e);
    }
    ZweiElw {
        hub,
        gross,
        klein,
        h,
        e_gross: einsaetze[0],
        e_klein: einsaetze[1],
    }
}

fn anzahl(arten: &[String], art: &str) -> usize {
    arten.iter().filter(|a| *a == art).count()
}

/// Die ELW führt noch, hält aber die Führung der anderen offen und schreibt weiter. Weitere
/// Meldetakte ändern daran nichts: genau ein Hinweis, keine fremden Angaben im Band.
async fn haelt_konflikt_offen(elw: &Instanz, einsatz: i64, epoche_hub: i64) {
    elw_meldet(elw).await;
    elw_meldet(elw).await;
    let f = fuehrung(elw, einsatz).await;
    assert_eq!(f["fuehrend"], true, "sie gibt nie still ab: {f}");
    assert_eq!(f["offen"]["konflikt"], true, "{f}");
    assert_eq!(f["offen"]["epoche"], epoche_hub, "{f}");
    assert!(
        f["offen"]["grund"].is_null() && f["offen"]["unterzeichner"].is_null(),
        "Grund und Unterzeichner gehören der anderen ELW: {f}"
    );
    let (_, kopf) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(kopf["fuehrung"]["offen"], true, "{kopf}");
    let (s, v) = etb(elw, einsatz).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "bis zur Bestätigung schreibt sie: {v}"
    );
    let arten = benachrichtigungen(&elw.pool).await;
    assert_eq!(
        anzahl(&arten, "fuehrung_uebernommen"),
        1,
        "ein Hinweis, auch über mehrere Meldetakte: {arten:?}"
    );
    assert_eq!(anzahl(&arten, "fuehrung_ungueltig"), 0, "{arten:?}");
    assert!(!aktionen(&elw.pool)
        .await
        .contains(&"fuehrung_verworfen".to_string()));
}

#[tokio::test]
async fn zwei_elw_die_spaetere_mit_groesserer_epoche_haelt_die_fuehrung_der_anderen_offen() {
    let z = zwei_notuebernahmen().await;
    elw_meldet(&z.klein).await;
    elw_meldet(&z.gross).await;
    elw_meldet(&z.gross).await;
    let am_hub = fuehrung(&z.hub, z.h).await;
    assert_eq!(
        am_hub["fuehrer_kennung"], z.klein.kennung,
        "wer zuerst kommt"
    );
    assert_eq!(am_hub["epoche"], 2);
    haelt_konflikt_offen(&z.gross, z.e_gross, 2).await;
    let f = fuehrung(&z.klein, z.e_klein).await;
    assert_eq!(f["fuehrend"], true);
    assert!(f["offen"].is_null(), "{f}");
}

#[tokio::test]
async fn zwei_elw_die_spaetere_mit_kleinerer_epoche_haelt_die_fuehrung_der_anderen_offen() {
    let z = zwei_notuebernahmen().await;
    elw_meldet(&z.gross).await;
    elw_meldet(&z.klein).await;
    elw_meldet(&z.klein).await;
    let am_hub = fuehrung(&z.hub, z.h).await;
    assert_eq!(
        am_hub["fuehrer_kennung"], z.gross.kennung,
        "wer zuerst kommt"
    );
    haelt_konflikt_offen(&z.klein, z.e_klein, 2).await;
}

/// Der Hub hat über Anfragen an ELW 1 abgegeben und steht dabei bei (4, Hub); ELW 2 kennt nur
/// (1, Hub) und erklärt ohne Verbindung (2, ELW 2).
/// Ergebnis: (Hub, ELW 1, ELW 2, Einsatz am Hub, Einsatz an ELW 1, Einsatz an ELW 2).
async fn uebergabe_an_elw1_und_notuebernahme_von_elw2() -> (Instanz, Instanz, Instanz, i64, i64, i64)
{
    let (hub, elw1) = gekoppelt().await;
    let elw2 = weiterer_elw(&hub).await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw1).await;
    elw_meldet(&elw2).await;
    let (akte1, e1) = akte_und_einsatz(&elw1).await;
    let (akte2, e2) = akte_und_einsatz(&elw2).await;
    anfragen_und_melden(&elw1, akte1).await;
    an_hub_zurueck(&elw1, &hub, e1).await;
    anfragen_und_melden(&elw1, akte1).await;
    let am_hub = fuehrung(&hub, h).await;
    assert_eq!(am_hub["fuehrer_kennung"], elw1.kennung);
    assert_eq!(am_hub["epoche"], 4);
    ohne_verbindung(&elw2).await;
    notuebernahme_gegen_hub(&elw2, akte2).await;
    wieder_verbunden(&elw2, &hub).await;
    elw_meldet(&elw2).await;
    elw_meldet(&elw2).await;
    (hub, elw1, elw2, h, e1, e2)
}

#[tokio::test]
async fn nach_der_uebergabe_an_elw_1_haelt_elw_2_ihre_fuehrung_offen_ohne_alarm() {
    let (hub, elw1, elw2, h, _, e2) = uebergabe_an_elw1_und_notuebernahme_von_elw2().await;
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], elw1.kennung);
    let f = fuehrung(&elw2, e2).await;
    assert_ne!(f["art"], "verworfen", "{f}");
    haelt_konflikt_offen(&elw2, e2, 4).await;
}

#[tokio::test]
async fn der_konflikt_erlischt_wenn_der_hub_keinen_dritten_mehr_nennt() {
    let (hub, elw1, elw2, h, e1, e2) = uebergabe_an_elw1_und_notuebernahme_von_elw2().await;
    let vorher = fuehrung(&elw2, e2).await;
    assert_eq!(vorher["offen"]["konflikt"], true);
    an_hub_zurueck(&elw1, &hub, e1).await;
    elw_meldet(&elw2).await;
    // Der Konflikt ist weg; der Hub führt jetzt selbst mit der Epoche von ELW 1, und darüber
    // entscheidet die Einsatzleitung (D7): Bestätigen oder Widersprechen.
    let f = fuehrung(&elw2, e2).await;
    assert_eq!(f["fuehrend"], true);
    assert_eq!(f["offen"]["konflikt"], false, "{f}");
    assert_eq!(f["offen"]["epoche"], 5, "{f}");
    // Eine größere Epoche bekommt ihre eigene Bruchstelle (LLH-1671).
    assert!(
        f["offen"]["bruch_at"].as_str().is_some() && vorher["offen"]["bruch_at"].as_str().is_some(),
        "{f}"
    );
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], hub.kennung);
}

#[tokio::test]
async fn eine_kopplung_zur_fuehrenden_elw_macht_den_konflikt_nicht_zur_uebernahme() {
    let (_hub, elw1, elw2, _h, _e1, e2) = uebergabe_an_elw1_und_notuebernahme_von_elw2().await;
    // ELW 1 koppelt sich zusätzlich bei ELW 2 (meldet sich dort); ELW 2 erreicht sie nicht.
    {
        let p = SoftwarePasskey::new("b", [2u8; 32]);
        let oeff = p.oeffentlich();
        let mut conn = elw2.pool.acquire().await.unwrap();
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
                bezeichnung: "Stick B",
            },
        )
        .await
        .unwrap();
    }
    let (s, v) = common::anfrage(
        &elw2.app,
        "POST",
        "/api/admin/instanz/codes",
        &elw2.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = common::anfrage_json(
        &elw1.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw1.admin,
        Some(&json!({"adresse": elw2.adresse, "code": v["code"]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let f = fuehrung(&elw2, e2).await;
    assert_eq!(
        f["offen"]["konflikt"], true,
        "der Hub nennt einen Dritten: {f}"
    );
    let (s, v) = post(
        &elw2,
        &format!("/api/einsaetze/{e2}/fuehrung/widersprechen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    // Der Widerruf dieser zusätzlichen Kopplung räumt den Konflikt mit dem Hub nicht ab.
    let (_, u) = common::anfrage(&elw2.app, "GET", "/api/admin/instanz", &elw2.admin, None).await;
    let k = u["kopplungen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["gegenueber_kennung"] == elw1.kennung)
        .unwrap_or_else(|| panic!("Kopplung zu ELW 1: {u}"))["id"]
        .as_i64()
        .unwrap();
    let (s, v) = post(
        &elw2,
        &format!("/api/admin/instanz/kopplungen/{k}/widerrufen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(fuehrung(&elw2, e2).await["offen"]["konflikt"], true);
}

#[tokio::test]
async fn der_widerruf_der_kopplung_raeumt_den_konflikt_ab() {
    let (_hub, _elw1, elw2, _h, _e1, e2) = uebergabe_an_elw1_und_notuebernahme_von_elw2().await;
    assert_eq!(fuehrung(&elw2, e2).await["offen"]["konflikt"], true);
    let (_, u) = common::anfrage(&elw2.app, "GET", "/api/admin/instanz", &elw2.admin, None).await;
    let id = u["kopplungen"][0]["id"].as_i64().unwrap();
    let (s, v) = post(
        &elw2,
        &format!("/api/admin/instanz/kopplungen/{id}/widerrufen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let f = fuehrung(&elw2, e2).await;
    assert!(
        f["offen"].is_null(),
        "ohne Kopplung kein Konflikt mehr: {f}"
    );
    assert_eq!(f["fuehrend"], true);
}

/// Der Hub führt selbst, mit der Epoche (3, A), weil A ihm die Führung zurückgab; B kennt nur
/// (1, Hub) und erklärt ohne Verbindung (2, B). Ergebnis: (Hub, B, Einsatz am Hub, an B).
async fn hub_fuehrt_mit_der_epoche_einer_anderen_elw() -> (Instanz, Instanz, i64, i64) {
    let (hub, a) = gekoppelt().await;
    let b = weiterer_elw(&hub).await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&a).await;
    elw_meldet(&b).await;
    let (akte_a, e_a) = akte_und_einsatz(&a).await;
    let (akte_b, e_b) = akte_und_einsatz(&b).await;
    ohne_verbindung(&b).await;
    anfragen_und_melden(&a, akte_a).await;
    an_hub_zurueck(&a, &hub, e_a).await;
    let am_hub = fuehrung(&hub, h).await;
    assert_eq!(am_hub["fuehrer_kennung"], hub.kennung);
    assert_eq!(am_hub["epoche"], 3);
    notuebernahme_gegen_hub(&b, akte_b).await;
    wieder_verbunden(&b, &hub).await;
    for _ in 0..3 {
        elw_meldet(&b).await;
    }
    (hub, b, h, e_b)
}

#[tokio::test]
async fn fuehrt_der_hub_mit_der_epoche_einer_anderen_elw_haelt_die_elw_offen_ohne_alarm() {
    let (hub, b, h, e_b) = hub_fuehrt_mit_der_epoche_einer_anderen_elw().await;
    let am_hub = fuehrung(&hub, h).await;
    assert_eq!(
        am_hub["fuehrer_kennung"], hub.kennung,
        "nichts still: {am_hub}"
    );
    assert_eq!(am_hub["epoche"], 3);
    let f = fuehrung(&b, e_b).await;
    assert_eq!(f["fuehrend"], true, "{f}");
    assert_eq!(
        f["offen"]["konflikt"], false,
        "der Hub ist kein Dritter: {f}"
    );
    assert_eq!(f["offen"]["epoche"], 3);
    let arten = benachrichtigungen(&b.pool).await;
    assert_eq!(anzahl(&arten, "fuehrung_uebernommen"), 1, "{arten:?}");
    assert_eq!(anzahl(&arten, "fuehrung_ungueltig"), 0, "{arten:?}");
    assert!(!aktionen(&b.pool)
        .await
        .contains(&"fuehrung_verworfen".to_string()));
}

#[tokio::test]
async fn widerspricht_die_elw_der_fuehrung_des_hubs_nimmt_er_ihre_naechste_epoche_an() {
    let (hub, b, h, e_b) = hub_fuehrt_mit_der_epoche_einer_anderen_elw().await;
    let (s, v) = post(
        &b,
        &format!("/api/einsaetze/{e_b}/fuehrung/widersprechen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["epoche"], 4);
    elw_meldet(&b).await;
    let am_hub = fuehrung(&hub, h).await;
    assert_eq!(am_hub["fuehrer_kennung"], b.kennung, "{am_hub}");
    assert_eq!(am_hub["epoche"], 4);
}

#[tokio::test]
async fn bestaetigt_die_elw_die_fuehrung_des_hubs_wird_sie_spiegel() {
    let (hub, b, h, e_b) = hub_fuehrt_mit_der_epoche_einer_anderen_elw().await;
    let (s, v) = post(
        &b,
        &format!("/api/einsaetze/{e_b}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], false);
    assert_eq!(v["fuehrer_kennung"], hub.kennung);
    assert!(ist_spiegel(&b, e_b).await);
    let spur: String =
        sqlx::query_scalar("SELECT detail FROM admin_audit ORDER BY id DESC LIMIT 1")
            .fetch_one(&b.pool)
            .await
            .unwrap();
    assert!(
        spur.contains("Übernahme durch") && !spur.contains("Notübernahme durch"),
        "der Hub hat nichts gegen B erklärt: {spur}"
    );
    elw_meldet(&b).await;
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], hub.kennung);
}

// ── Der Hub holt sich die Führung von einer anderen ELW zurück (LLH-1707) ─────────────────────
//
// Change `d12cmcx1-hub-epoche-gegen-dritten`: Richtet sich die Erklärung der Akte des Hubs gegen
// eine andere ELW, hält die ELW sie ohne Alarm offen wie bei D7 der Change `faq7l7m4`.

/// Wie der Hub die Führung von ELW 1 zurückholt.
#[derive(Clone, Copy)]
enum Zurueckholen {
    /// Unterschriebene Notübernahme gegen ELW 1.
    Notuebernahme,
    /// Widerruf der Kopplung zu ELW 1 am Hub.
    Widerruf,
}

/// Drei Instanzen, der Hub führt einen eigenen Einsatz mit (1, Hub), beide ELW kennen ihn. Mit
/// `elw2_erklaert` erklärt ELW 2 ohne Verbindung die Notübernahme (2, ELW 2). ELW 1 übernimmt am Hub
/// per Notübernahme mit (2, ELW 1), dann holt der Hub die Führung auf dem Weg `weg` mit (3, Hub)
/// zurück. Ergebnis: (Hub, ELW 2, Einsatz am Hub, Einsatz an ELW 2); ELW 2 hat sich noch nicht
/// gemeldet, seit der Hub zurückgeholt hat.
async fn hub_holt_von_elw1_zurueck(
    weg: Zurueckholen,
    elw2_erklaert: bool,
) -> (Instanz, Instanz, i64, i64) {
    let (hub, elw1) = gekoppelt().await;
    let elw2 = weiterer_elw(&hub).await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw1).await;
    elw_meldet(&elw2).await;
    let (akte1, _) = akte_und_einsatz(&elw1).await;
    let (akte2, e2) = akte_und_einsatz(&elw2).await;
    if elw2_erklaert {
        ohne_verbindung(&elw2).await;
        notuebernahme_gegen_hub(&elw2, akte2).await;
    }
    notuebernahme_gegen_hub(&elw1, akte1).await;
    elw_meldet(&elw1).await;
    let am_hub = fuehrung(&hub, h).await;
    assert_eq!(am_hub["fuehrer_kennung"], elw1.kennung, "{am_hub}");
    assert_eq!(am_hub["epoche"], 2);
    if !elw2_erklaert {
        // ELW 2 führt nicht und kennt die Akte über den Hub mit ELW 1 als Führer.
        elw_meldet(&elw2).await;
        let f = fuehrung(&elw2, e2).await;
        assert_eq!(f["fuehrer_kennung"], elw1.kennung, "{f}");
        assert_eq!(f["epoche"], 2);
    }
    match weg {
        Zurueckholen::Notuebernahme => {
            let akte = am_hub["id"].as_i64().unwrap();
            hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW 1 ohne Verbindung").await;
        }
        Zurueckholen::Widerruf => {
            let (_, u) =
                common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
            let id = u["kopplungen"]
                .as_array()
                .unwrap()
                .iter()
                .find(|k| k["gegenueber_kennung"] == elw1.kennung.as_str())
                .unwrap()["id"]
                .as_i64()
                .unwrap();
            let (s, v) = post(
                &hub,
                &format!("/api/admin/instanz/kopplungen/{id}/widerrufen"),
                json!({}),
            )
            .await;
            assert_eq!(s, StatusCode::OK, "{v}");
        }
    }
    let am_hub = fuehrung(&hub, h).await;
    assert_eq!(am_hub["fuehrer_kennung"], hub.kennung, "{am_hub}");
    assert_eq!(am_hub["epoche"], 3);
    if elw2_erklaert {
        wieder_verbunden(&elw2, &hub).await;
    }
    (hub, elw2, h, e2)
}

/// ELW 2 meldet sich mehrmals und hält die Akte des Hubs offen: kein Konflikt, keine Angaben der
/// Erklärung gegen ELW 1, ein Hinweis, kein Alarm, und sie schreibt weiter.
async fn haelt_den_hub_offen_ohne_alarm(hub: &Instanz, elw2: &Instanz, h: i64, e2: i64) {
    for _ in 0..3 {
        elw_meldet(elw2).await;
    }
    let am_hub = fuehrung(hub, h).await;
    assert_eq!(am_hub["fuehrer_kennung"], hub.kennung, "{am_hub}");
    assert_eq!(am_hub["epoche"], 3);
    let f = fuehrung(elw2, e2).await;
    assert_eq!(f["fuehrend"], true, "sie gibt nie still ab: {f}");
    assert_ne!(f["art"], "verworfen", "{f}");
    assert_eq!(
        f["offen"]["konflikt"], false,
        "der Hub ist kein Dritter: {f}"
    );
    assert_eq!(f["offen"]["epoche"], 3, "{f}");
    assert!(
        f["offen"]["grund"].is_null() && f["offen"]["unterzeichner"].is_null(),
        "die Erklärung richtet sich gegen ELW 1: {f}"
    );
    let arten = benachrichtigungen(&elw2.pool).await;
    assert_eq!(anzahl(&arten, "fuehrung_uebernommen"), 1, "{arten:?}");
    assert_eq!(anzahl(&arten, "fuehrung_ungueltig"), 0, "{arten:?}");
    assert!(!aktionen(&elw2.pool)
        .await
        .contains(&"fuehrung_verworfen".to_string()));
    let (s, v) = etb(elw2, e2).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "bis zur Entscheidung schreibt sie: {v}"
    );
}

#[tokio::test]
async fn holt_der_hub_per_notuebernahme_gegen_elw_1_zurueck_haelt_elw_2_offen_ohne_alarm() {
    let (hub, elw2, h, e2) = hub_holt_von_elw1_zurueck(Zurueckholen::Notuebernahme, true).await;
    haelt_den_hub_offen_ohne_alarm(&hub, &elw2, h, e2).await;
}

#[tokio::test]
async fn holt_der_hub_per_widerruf_von_elw_1_zurueck_haelt_elw_2_offen_ohne_alarm() {
    let (hub, elw2, h, e2) = hub_holt_von_elw1_zurueck(Zurueckholen::Widerruf, true).await;
    haelt_den_hub_offen_ohne_alarm(&hub, &elw2, h, e2).await;
}

#[tokio::test]
async fn bestaetigt_elw_2_die_zurueckgeholte_fuehrung_des_hubs_wird_sie_spiegel() {
    let (hub, elw2, h, e2) = hub_holt_von_elw1_zurueck(Zurueckholen::Notuebernahme, true).await;
    haelt_den_hub_offen_ohne_alarm(&hub, &elw2, h, e2).await;
    let (s, v) = post(
        &elw2,
        &format!("/api/einsaetze/{e2}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], false);
    assert_eq!(v["fuehrer_kennung"], hub.kennung);
    assert_eq!(v["epoche"], 3);
    assert!(ist_spiegel(&elw2, e2).await);
    let spur: String =
        sqlx::query_scalar("SELECT detail FROM admin_audit ORDER BY id DESC LIMIT 1")
            .fetch_one(&elw2.pool)
            .await
            .unwrap();
    assert!(
        !spur.contains("Notübernahme durch"),
        "der Hub hat nichts gegen ELW 2 erklärt: {spur}"
    );
    elw_meldet(&elw2).await;
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], hub.kennung);
}

#[tokio::test]
async fn widerspricht_elw_2_der_zurueckgeholten_fuehrung_nimmt_der_hub_ihre_naechste_epoche_an() {
    let (hub, elw2, h, e2) = hub_holt_von_elw1_zurueck(Zurueckholen::Notuebernahme, true).await;
    haelt_den_hub_offen_ohne_alarm(&hub, &elw2, h, e2).await;
    let (s, v) = post(
        &elw2,
        &format!("/api/einsaetze/{e2}/fuehrung/widersprechen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["epoche"], 4);
    elw_meldet(&elw2).await;
    let am_hub = fuehrung(&hub, h).await;
    assert_eq!(am_hub["fuehrer_kennung"], elw2.kennung, "{am_hub}");
    assert_eq!(am_hub["epoche"], 4);
    let f = fuehrung(&elw2, e2).await;
    assert_eq!(f["epoche"], 4);
    assert!(f["offen"].is_null(), "{f}");
}

#[tokio::test]
async fn ein_dritter_elw_sieht_den_widerruf_im_verlauf_ohne_unterzeichner() {
    let (hub, elw2, _h, e2) = hub_holt_von_elw1_zurueck(Zurueckholen::Widerruf, false).await;
    elw_meldet(&elw2).await;
    let f = fuehrung(&elw2, e2).await;
    assert_eq!(f["fuehrend"], false, "{f}");
    assert_eq!(f["epoche"], 3, "{f}");
    assert_eq!(f["fuehrer_kennung"], hub.kennung, "{f}");
    let verlauf = f["verlauf"].as_array().unwrap();
    assert!(
        verlauf.iter().any(|v| v["epoche_zaehler"] == 2),
        "ELW 2 kannte die Führung von ELW 1 vor dem Widerruf: {f}"
    );
    let letzter = verlauf
        .iter()
        .max_by_key(|v| v["epoche_zaehler"].as_i64())
        .unwrap()
        .clone();
    assert_eq!(letzter["epoche_zaehler"], 3, "{f}");
    assert_eq!(letzter["grund"], "Kopplung widerrufen", "{f}");
    assert!(
        letzter["unterzeichner"].is_null(),
        "niemand hat unterschrieben: {f}"
    );
}

#[tokio::test]
async fn bestaetigen_des_konflikts_macht_die_unterlegene_elw_zum_spiegel() {
    let z = zwei_notuebernahmen().await;
    elw_meldet(&z.klein).await;
    elw_meldet(&z.gross).await;
    let (s, v) = post(
        &z.gross,
        &format!("/api/einsaetze/{}/fuehrung/bestaetigen", z.e_gross),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], false);
    assert_eq!(v["fuehrer_kennung"], z.klein.kennung);
    assert_eq!(
        v["epoche"], 2,
        "der Stand des Hubs gilt, auch wenn er kleiner ist"
    );
    assert!(v["offen"].is_null(), "{v}");
    assert!(v["bruch_at"].as_str().is_some(), "{v}");
    let letzter = v["verlauf"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(letzter["art"], "bestaetigt", "{letzter}");
    assert!(
        letzter["grund"]
            .as_str()
            .unwrap()
            .contains("hat am Hub nicht gegriffen"),
        "{letzter}"
    );
    assert!(ist_spiegel(&z.gross, z.e_gross).await);
    let spur: String =
        sqlx::query_scalar("SELECT detail FROM admin_audit ORDER BY id DESC LIMIT 1")
            .fetch_one(&z.gross.pool)
            .await
            .unwrap();
    assert!(
        spur.contains("Notübernahme hat am Hub nicht gegriffen")
            && !spur.contains("Hub nicht erreichbar"),
        "kein Grund der anderen ELW in der eigenen Spur: {spur}"
    );
    // Ruhiger Takt: niemand ändert danach noch etwas an der Akte.
    elw_meldet(&z.gross).await;
    elw_meldet(&z.klein).await;
    elw_meldet(&z.gross).await;
    let am_hub = fuehrung(&z.hub, z.h).await;
    assert_eq!(am_hub["fuehrer_kennung"], z.klein.kennung);
    assert_eq!(am_hub["epoche"], 2);
    let f = fuehrung(&z.gross, z.e_gross).await;
    assert_eq!(f["fuehrend"], false);
    assert_eq!(f["epoche"], 2);
    assert!(f["offen"].is_null(), "{f}");
}

#[tokio::test]
async fn widerspruch_gegen_den_dritten_ist_422() {
    let z = zwei_notuebernahmen().await;
    elw_meldet(&z.gross).await;
    elw_meldet(&z.klein).await;
    let (s, v) = post(
        &z.klein,
        &format!("/api/einsaetze/{}/fuehrung/widersprechen", z.e_klein),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let f = fuehrung(&z.klein, z.e_klein).await;
    assert_eq!(f["offen"]["konflikt"], true, "bleibt offen: {f}");
}

// ── Befunde aus dem Review ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn nach_dem_widerruf_holt_der_elw_seinen_einsatz_zurueck() {
    let (hub, elw) = gekoppelt().await;
    let (e, _) = elw_einsatz(&hub, &elw).await;
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    ist_spiegel_mit_antraegen(&elw, e).await;
    let (_, u) = common::anfrage(&elw.app, "GET", "/api/admin/instanz", &elw.admin, None).await;
    let id = u["kopplungen"][0]["id"].as_i64().unwrap();
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/kopplungen/{id}/widerrufen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = etb(&elw, e).await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "nach dem Widerruf schreibt der ELW wieder"
    );
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true);
    assert_eq!(f["epoche"], 3);
}

#[tokio::test]
async fn ueberhoehte_epoche_wird_nicht_uebernommen() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let stand: i64 = sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz_fuehrung SET epoche_zaehler = ?, stand = ? WHERE id = ?")
        .bind(i64::MAX)
        .bind(stand)
        .bind(akte)
        .execute(&hub.pool)
        .await
        .unwrap();
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["epoche"], 1, "über der Grenze verworfen");
    // Die Kopplung lebt weiter: eine Übergabe geht noch durch.
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

// ── Befunde aus dem Review von CodeRabbit (PR #1243) ─────────────────────────────────────────

#[tokio::test]
async fn widerruf_raeumt_eine_offene_uebernahme() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    elw_meldet(&elw).await;
    assert!(fuehrung(&elw, e).await["offen"].is_object());
    let (_, u) = common::anfrage(&elw.app, "GET", "/api/admin/instanz", &elw.admin, None).await;
    let id = u["kopplungen"][0]["id"].as_i64().unwrap();
    let (s, _) = post(
        &elw,
        &format!("/api/admin/instanz/kopplungen/{id}/widerrufen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let f = fuehrung(&elw, e).await;
    assert!(
        f["offen"].is_null(),
        "offene Übernahme verfällt mit der Kopplung"
    );
    assert_eq!(f["fuehrend"], true);
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
}

/// Zweiter ELW derselben Hub-Org, am Hub gekoppelt.
async fn zweiter_elw(hub: &Instanz) -> Instanz {
    let elw2 = instanz(true).await;
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = common::anfrage_json(
        &elw2.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw2.admin,
        Some(&json!({"adresse": hub.adresse, "code": v["code"]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    elw2
}

#[tokio::test]
async fn ein_elw_nimmt_einem_anderen_elw_die_fuehrung_nicht() {
    let (hub, elw1) = gekoppelt().await;
    let elw2 = zweiter_elw(&hub).await;
    // Der Hub führt einen eigenen Einsatz und gibt ihn auf Anfrage an ELW 2.
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw2).await;
    let akte2 = fremde(&elw2).await[0]["id"].as_i64().unwrap();
    let (s, _) = post(
        &elw2,
        &format!("/api/admin/instanz/fuehrung/{akte2}/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    elw_meldet(&elw2).await;
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], elw2.kennung);
    // ELW 1 kennt die Akte und beansprucht sie mit einer hohen Epoche für sich.
    elw_meldet(&elw1).await;
    let stand: i64 = sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&elw1.pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE einsatz_fuehrung SET epoche_zaehler = 9, epoche_instanz = ?, \
         fuehrer_kennung = ?, fuehrer_name = 'ELW 1', stand = ?",
    )
    .bind(&elw1.kennung)
    .bind(&elw1.kennung)
    .bind(stand)
    .execute(&elw1.pool)
    .await
    .unwrap();
    elw_meldet(&elw1).await;
    let f = fuehrung(&hub, h).await;
    assert_eq!(f["fuehrer_kennung"], elw2.kennung, "ELW 2 führt weiter");
}

/// LLH-1673: Eine Anfrage gilt nur dem Stand, den sie sah. Überholt sie ein Wechsel, den das
/// Gegenüber liefert (hier: Übergabe an ELW 2 und zurück), verfällt der Merker; der Hub gibt
/// danach nicht ohne Menschen ab.
#[tokio::test]
async fn ein_ueberholter_anfrage_merker_gibt_die_fuehrung_nicht_ab() {
    let (hub, elw1) = gekoppelt().await;
    let elw2 = zweiter_elw(&hub).await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw1).await;
    elw_meldet(&elw2).await;
    let akte1 = fremde(&elw1).await[0]["id"].as_i64().unwrap();
    let akte2 = fremde(&elw2).await[0]["id"].as_i64().unwrap();
    // ELW 1 fragt auf Epoche 1 an, meldet aber erst, als der Hub schon an ELW 2 gegeben hat.
    let (s, v) = post(
        &elw1,
        &format!("/api/admin/instanz/fuehrung/{akte1}/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["anfrage_offen"], true);
    let (s, _) = post(
        &elw2,
        &format!("/api/admin/instanz/fuehrung/{akte2}/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    elw_meldet(&elw2).await;
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], elw2.kennung);
    // Die Anfrage auf den alten Stand wird nicht erfüllt; ELW 1 sieht die Übergabe an ELW 2.
    elw_meldet(&elw1).await;
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], elw2.kennung);
    // ELW 2 gibt regulär an den Hub zurück.
    let e2 = einsatz_der_akte(&elw2, akte2).await;
    let (s, v) = post(
        &elw2,
        &format!("/api/einsaetze/{e2}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw2).await;
    let f = fuehrung(&hub, h).await;
    assert_eq!(f["fuehrend"], true, "{f}");
    assert_eq!(f["epoche"], 3);
    // ELW 1 bekommt die Rückgabe weitergereicht und meldet mehrmals.
    for _ in 0..3 {
        elw_meldet(&elw1).await;
    }
    let f = fuehrung(&hub, h).await;
    assert_eq!(
        f["fuehrer_kennung"], hub.kennung,
        "der Hub führt weiter: {f}"
    );
    assert_eq!(f["epoche"], 3);
    let e1 = einsatz_der_akte(&elw1, akte1).await;
    let a = fuehrung(&elw1, e1).await;
    assert_eq!(a["fuehrer_kennung"], hub.kennung, "{a}");
    assert_eq!(a["anfrage_offen"], false, "der Merker ist verfallen: {a}");
}

// ── Führung auf dem Spiegel (LLH-1641) ───────────────────────────────────────────────────────

/// Der Admin der Instanz wird Einsatzleitung, direkt in der DB und ohne Merker: geht nur, wenn
/// der Einsatz hier kein Spiegel ist (sonst bricht der Schutz-Trigger ab).
async fn mitglied_werden(i: &Instanz, einsatz: i64) {
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         SELECT ?, id, 'einsatzleitung' FROM benutzer WHERE benutzername = 'admin' \
         AND id NOT IN (SELECT benutzer_id FROM spiegel_konto)",
    )
    .bind(einsatz)
    .execute(&i.pool)
    .await
    .expect("der Einsatz ist hier kein Spiegel");
}

async fn ist_spiegel(i: &Instanz, einsatz: i64) -> bool {
    sqlx::query_scalar("SELECT spiegel = 1 FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

/// Laufende Nummern des ETB, aufsteigend.
async fn etb_nummern(i: &Instanz, einsatz: i64) -> Vec<i64> {
    sqlx::query_scalar("SELECT lfd_nr FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr")
        .bind(einsatz)
        .fetch_all(&i.pool)
        .await
        .unwrap()
}

/// Ein Konto, das der Hub vergibt und der ELW mit den Stammdaten bekommt; am ELW mit dem
/// Passwort des Admins, weil das eigene ohne bestätigte Platte nicht mitkommt. (ID am ELW, Cookie
/// am ELW.)
async fn gemeinsames_konto(hub: &Instanz, elw: &Instanz, name: &str) -> (i64, String) {
    let (s, v) = post(
        hub,
        "/api/benutzer",
        json!({"anzeigename": name, "benutzername": name, "passwort": format!("{name}pw12345")}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    elw_meldet(elw).await;
    sqlx::query(
        "UPDATE benutzer SET passwort_hash = (SELECT passwort_hash FROM benutzer \
         WHERE benutzername = 'admin'), passwort_wechsel_pflicht = 0 WHERE benutzername = ?",
    )
    .bind(name)
    .execute(&elw.pool)
    .await
    .unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
        .bind(name)
        .fetch_one(&elw.pool)
        .await
        .unwrap();
    (id, common::login_cookie(&elw.app, name, "startpw12").await)
}

#[tokio::test]
async fn nach_der_uebergabe_schreibt_der_hub_und_der_elw_stellt_antraege() {
    let (hub, elw) = gekoppelt().await;
    let (erika_elw, erika) = gemeinsames_konto(&hub, &elw, "erika").await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    common::rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "fuehrungspersonal").await;
    elw_meldet(&elw).await;
    let akte = fremde(&hub).await[0]["id"].as_i64().unwrap();
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    assert!(
        ist_spiegel(&hub, h).await,
        "vor der Übergabe spiegelt der Hub"
    );
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await, "der ELW spiegelt sofort");
    elw_meldet(&elw).await;
    assert!(!ist_spiegel(&hub, h).await, "der Hub führt");
    mitglied_werden(&hub, h).await;
    let (s, v) = etb(&hub, h).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    // Am ELW wird Erikas Erfassung zum Antrag; der Hub führt ihn genau einmal aus.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &erika,
        Some(
            &json!({"von": "ELW 1", "an": "EL", "typ": "meldung", "inhalt": "Vom ELW",
                     "anhang_ids": [], "client_id": "c-1"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    let antraege: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT zustand, grund FROM spiegel_antrag")
            .fetch_all(&elw.pool)
            .await
            .unwrap();
    let am_hub = etb_nummern(&hub, h).await;
    assert_eq!(
        am_hub.len(),
        3,
        "ELW-Eintrag, Hub-Eintrag, Antrag: {am_hub:?} {antraege:?}"
    );
    assert_eq!(
        etb_nummern(&elw, e).await,
        am_hub,
        "der Spiegel holt alles nach"
    );
    assert!(
        antraege.iter().all(|(z, _)| z == "uebernommen"),
        "{antraege:?}"
    );
    abgleichen(&elw).await;
    assert_eq!(etb_nummern(&hub, h).await.len(), 3, "kein zweites Mal");
}

#[tokio::test]
async fn uebergabe_ohne_abgleich_ist_409() {
    let (hub, elw) = gekoppelt().await;
    let (e, _) = elw_einsatz(&hub, &elw).await;
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(!ist_spiegel(&elw, e).await);
}

/// Die Aufbewahrungsfrist und die Frist einer Datenkategorie lassen sich am Spiegel nicht setzen;
/// die Sperre tragen die Schutz-Trigger des Spiegels (LLH-1677, Punkt 7). Die Kategorie-Tabelle
/// wird nicht gespiegelt; dort bricht der Trigger am ETB-Eintrag derselben Transaktion ab.
#[tokio::test]
async fn fristen_am_spiegel_sind_409() {
    let (hub, elw) = gekoppelt().await;
    let (e, _) = elw_einsatz(&hub, &elw).await;
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    code_am_elw(&hub, &elw, e).await;
    assert!(ist_spiegel(&elw, e).await);
    let bis = (chrono::Utc::now() + chrono::Duration::days(400))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    for (pfad, body) in [
        (
            format!("/api/einsaetze/{e}/aufbewahrungsfrist"),
            json!({"retention_bis": bis, "bestaetigt": true}),
        ),
        (
            format!("/api/einsaetze/{e}/aufbewahrungsfrist/personenauskunft"),
            json!({"retention_bis": bis, "rechtsgrundlage": "Probe", "bestaetigt": true}),
        ),
    ] {
        let (s, v) = common::anfrage_json(&elw.app, "PUT", &pfad, &elw.admin, Some(&body)).await;
        assert_eq!(s, StatusCode::CONFLICT, "{pfad}: {v}");
        assert!(
            v["error"].as_str().unwrap_or_default().contains("Spiegel"),
            "{pfad}: {v}"
        );
    }
}

#[tokio::test]
async fn notuebernahme_am_hub_macht_den_spiegel_beschreibbar() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    assert!(ist_spiegel(&hub, h).await);
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    assert!(!ist_spiegel(&hub, h).await, "der Hub schreibt sofort");
    mitglied_werden(&hub, h).await;
    let (s, v) = etb(&hub, h).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    // Der ELW schreibt bis zur Entscheidung weiter; was der Hub nicht kennt, wird Bruchstelle.
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await);
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    let am_hub = etb_nummern(&hub, h).await;
    assert_eq!(
        am_hub.len(),
        2,
        "ELW-Eintrag vor der Übernahme und Hub-Eintrag: {am_hub:?}"
    );
    assert_eq!(
        etb_nummern(&elw, e).await,
        am_hub,
        "keine Doppelten am Spiegel"
    );
    let gesichert: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert!(gesichert >= 1, "der eigene Eintrag ist gesichert");
    let (_, kopf) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}"),
        &elw.admin,
        None,
    )
    .await;
    assert!(
        kopf["spiegel"]["bruchstelle"].as_i64().unwrap() >= 1,
        "{kopf}"
    );
    assert_eq!(bruch_offen(&elw, e).await, 0, "geklärt");
}

/// Eine Meldung nach dem Bruch und ihr ETB-Eintrag zeigen aufeinander. Beide verlassen den
/// Spiegel trotzdem, und die Bruchstelle kommt zu Ende (Befund aus LLH-1646).
#[tokio::test]
async fn meldung_nach_dem_bruch_verlaesst_den_spiegel() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    abgleichen(&elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;

    let (s, m) = post(
        &elw,
        &format!("/api/einsaetze/{e}/meldungen"),
        json!({"absender": "Florian Nord 1", "meldeweg": "funk", "inhalt": "Deich instabil",
               "ereigniszeit": "2026-06-12 09:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen(&elw).await;
    abgleichen(&elw).await;

    assert_eq!(bruch_offen(&elw, e).await, 0, "geklärt");
    let offen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ? AND entfernt = 0",
    )
    .bind(e)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    assert_eq!(offen, 0, "Meldung und ETB-Eintrag sind entfernt");
    let meldungen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meldung WHERE einsatz_id = ?")
        .bind(e)
        .fetch_one(&elw.pool)
        .await
        .unwrap();
    assert_eq!(meldungen, 0, "die Meldung liegt nicht mehr am Spiegel");
}

async fn bruchstellen_zeilen(i: &Instanz, einsatz: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

/// Schwärzt der Führer, räumt der Spiegel beim nächsten Abgleich seine ganze Bruchstelle, auch
/// eine noch offene (LLH-1649). Ohne Schwärzung bleibt sie.
#[tokio::test]
async fn schwaerzung_beim_fuehrer_raeumt_die_bruchstelle_am_spiegel() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    // Was der ELW danach schreibt, kennt der Hub nicht: Es wird Bruchstelle.
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await);
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    let gesichert = bruchstellen_zeilen(&elw, e).await;
    assert!(gesichert >= 1, "der eigene Eintrag ist gesichert");
    // Ein Abgleich ohne Schwärzung lässt sie stehen.
    abgleichen(&elw).await;
    assert_eq!(bruchstellen_zeilen(&elw, e).await, gesichert);

    // Noch eine ungeklärte Zeile, die der Führer nie beurteilt hat: offene Bruchstelle.
    sqlx::query(
        "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, daten, \
         gesichert_at) VALUES (?, 'einsatz_person', '987654', 1, '{\"name\":\"Muster\"}', \
         '2026-11-11 12:00:00')",
    )
    .bind(e)
    .execute(&elw.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz_spiegel SET bruch_offen = 1 WHERE einsatz_id = ?")
        .bind(e)
        .execute(&elw.pool)
        .await
        .unwrap();

    // Löschersuchen je Person beim Führer.
    let mut tx = hub.pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_person::scrubbe_person(
        &mut tx,
        h,
        lifeline_hub::einsatz::schwaerzung_person::PersonenArt::Betroffene,
        987_654,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    abgleichen(&elw).await;
    assert_eq!(bruchstellen_zeilen(&elw, e).await, 0, "Bruchstelle geräumt");
    assert_eq!(
        bruch_offen(&elw, e).await,
        0,
        "der Spiegel fragt nicht mehr"
    );
    let marke = |i: &Instanz, einsatz: i64| {
        let pool = i.pool.clone();
        async move {
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT schwaerzung_marke FROM einsatz WHERE id = ?",
            )
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let am_hub = marke(&hub, h).await;
    assert!(am_hub.is_some());
    assert_eq!(marke(&elw, e).await, am_hub, "die Marke kam mit dem Kopf");
    // Eine zweite Schwärzung erneuert die Marke, und der Spiegel übernimmt die neue.
    let mut tx = hub.pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_person::scrubbe_person(
        &mut tx,
        h,
        lifeline_hub::einsatz::schwaerzung_person::PersonenArt::Betroffene,
        987_653,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    abgleichen(&elw).await;
    let neu = marke(&hub, h).await;
    assert_ne!(neu, am_hub, "die Marke ist neu");
    assert_eq!(marke(&elw, e).await, neu, "der Spiegel hat die neue Marke");
    let (_, kopf) = common::anfrage(
        &elw.app,
        "GET",
        &format!("/api/einsaetze/{e}"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(kopf["spiegel"]["bruchstelle"].as_i64(), Some(0), "{kopf}");
}

/// Schwärzen beide Seiten während der Trennung, räumt der alte Führer seine Bruchstelle mit
/// dem ersten Abgleich als Spiegel: Die Marken unterscheiden sich, auch wenn jede Seite genau
/// einmal schwärzt (Review #1284).
#[tokio::test]
async fn schwaerzung_auf_beiden_seiten_der_trennung_raeumt_die_bruchstelle() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    for (i, einsatz, person) in [(&hub, h, 987_654), (&elw, e, 987_655)] {
        let mut tx = i.pool.begin().await.unwrap();
        lifeline_hub::einsatz::schwaerzung_person::scrubbe_person(
            &mut tx,
            einsatz,
            lifeline_hub::einsatz::schwaerzung_person::PersonenArt::Betroffene,
            person,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
    }
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await);
    assert!(
        bruchstellen_zeilen(&elw, e).await >= 1,
        "der eigene Eintrag ist gesichert"
    );
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert_eq!(bruchstellen_zeilen(&elw, e).await, 0, "Bruchstelle geräumt");
    assert_eq!(
        bruch_offen(&elw, e).await,
        0,
        "der Spiegel fragt nicht mehr"
    );
}

/// Schwärzt nur der alte Führer während der Trennung, bleibt seine Bruchstelle: Sie ist schon
/// geschwärzt gesichert, und ein Führer ohne Marke überschreibt die eigene nicht (Review #1284).
#[tokio::test]
async fn eigene_schwaerzung_in_der_trennung_laesst_die_bruchstelle_stehen() {
    eigene_schwaerzung_in_der_trennung(false).await;
}

/// Wie oben, aber der neue Führer bringt die ältere Marke von vor der Trennung: Sie ist hier
/// bekannt, also hat er seither nicht geschwärzt (Review #1284).
#[tokio::test]
async fn eigene_schwaerzung_in_der_trennung_mit_aelterer_marke_laesst_die_bruchstelle_stehen() {
    eigene_schwaerzung_in_der_trennung(true).await;
}

async fn eigene_schwaerzung_in_der_trennung(vorher_geschwaerzt: bool) {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let elw_schwaerzt = |person: i64| {
        let pool = elw.pool.clone();
        async move {
            let mut tx = pool.begin().await.unwrap();
            lifeline_hub::einsatz::schwaerzung_person::scrubbe_person(
                &mut tx,
                e,
                lifeline_hub::einsatz::schwaerzung_person::PersonenArt::Betroffene,
                person,
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
        }
    };
    if vorher_geschwaerzt {
        elw_schwaerzt(987_654).await;
    }
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    let am_hub: Option<String> =
        sqlx::query_scalar("SELECT schwaerzung_marke FROM einsatz WHERE id = ?")
            .bind(h)
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(
        am_hub.is_some(),
        vorher_geschwaerzt,
        "die Marke kam beim Hub an"
    );
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    elw_schwaerzt(987_655).await;
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await);
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert!(
        bruchstellen_zeilen(&elw, e).await >= 1,
        "der eigene Eintrag bleibt gesichert"
    );
    let mit_kopie: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ? AND daten IS NOT NULL",
    )
    .bind(e)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    assert!(mit_kopie >= 1, "mit Inhalt");
}

async fn bruch_offen(i: &Instanz, einsatz: i64) -> i64 {
    sqlx::query_scalar("SELECT bruch_offen FROM einsatz_spiegel WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

/// Mehr als `BRUCH_MAX` gesicherte Zeilen klären sich über mehrere Runden; geschlossen wird
/// erst, wenn keine ungefragte mehr übrig ist (Review LLH-1641).
#[tokio::test]
async fn eine_grosse_bruchstelle_klaert_sich_ueber_mehrere_runden() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    abgleichen(&elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await);
    // Zeilen, die der Hub nicht kennt (und die es hier nicht mehr gibt): jede muss gefragt werden.
    let zahl = lifeline_hub::instanz::spiegel::paket::BRUCH_MAX + 50;
    for n in 0..zahl {
        sqlx::query(
            "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, gesichert_at) \
             VALUES (?, 'etb_eintrag', ?, 1, '2026-11-11 12:00:00')",
        )
        .bind(e)
        .bind(format!("{}", 900_000 + n))
        .execute(&elw.pool)
        .await
        .unwrap();
    }
    sqlx::query("UPDATE einsatz_spiegel SET bruch_offen = 1 WHERE einsatz_id = ?")
        .bind(e)
        .execute(&elw.pool)
        .await
        .unwrap();
    for _ in 0..3 {
        abgleichen(&elw).await;
    }
    let ungeklaert: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ? AND entfernt = 0 \
         AND schluessel >= '900000'",
    )
    .bind(e)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    assert_eq!(ungeklaert, 0, "jede Zeile ist gefragt und entfernt");
    assert_eq!(bruch_offen(&elw, e).await, 0);
}

/// Eine ganze Seite, an der noch Verweise späterer Zeilen hängen, blockiert die Bruchstelle
/// nicht: Sie wird zurückgestellt, die späteren Seiten laufen durch, dann geht sie (Review
/// LLH-1641).
#[tokio::test]
async fn verweise_von_spaeteren_seiten_blockieren_die_bruchstelle_nicht() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    abgleichen(&elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await);
    // Eine volle Seite Einheiten, jede mit einer Einsatzkraft darin; die Kräfte sortieren
    // dahinter und kommen erst auf der zweiten Seite.
    let zahl = lifeline_hub::instanz::spiegel::paket::BRUCH_MAX;
    let mut tx = elw.pool.begin().await.unwrap();
    sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    for n in 0..zahl {
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
        )
        .bind(e)
        .bind(format!("Zug {n}"))
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        let kraft: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id) VALUES (?, ?, ?) \
             RETURNING id",
        )
        .bind(e)
        .bind(format!("Kraft {n}"))
        .bind(einheit)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        for (art, id) in [("einsatz_einheit", einheit), ("einsatz_personal", kraft)] {
            sqlx::query(
                "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, \
                 gesichert_at) VALUES (?, ?, ?, 1, '2026-11-11 12:00:00')",
            )
            .bind(e)
            .bind(art)
            .bind(id.to_string())
            .execute(&mut *tx)
            .await
            .unwrap();
        }
    }
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz_spiegel SET bruch_offen = 1 WHERE einsatz_id = ?")
        .bind(e)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    for _ in 0..4 {
        abgleichen(&elw).await;
    }
    let einheiten: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert_eq!(einheiten, 0, "die Einheiten gehen nach ihren Kräften");
    let ungeklaert: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ? AND entfernt = 0",
    )
    .bind(e)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    assert_eq!(ungeklaert, 0);
    assert_eq!(bruch_offen(&elw, e).await, 0);
}

/// Ein Schlüssel aus der Bruchstelle, den SQLite inzwischen in einem anderen Einsatz neu
/// vergeben hat, löscht dort nichts: Geräumt wird nur im Einsatz der Bruchstelle (Review
/// LLH-1641).
#[tokio::test]
async fn bruchstelle_raeumt_nur_im_eigenen_einsatz() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    abgleichen(&elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(ist_spiegel(&elw, e).await);
    // Ein zweiter Einsatz, den der ELW selbst führt, mit einer Einheit.
    let anderer = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Zweiter Einsatz").await;
    assert!(!ist_spiegel(&elw, anderer).await);
    let einheit: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Fremder Zug') RETURNING id",
    )
    .bind(anderer)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    // Die Bruchstelle des Spiegels nennt dieselbe Kennung, als hätte SQLite sie neu vergeben.
    sqlx::query(
        "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, gesichert_at) \
         VALUES (?, 'einsatz_einheit', ?, 1, '2026-11-11 12:00:00')",
    )
    .bind(e)
    .bind(einheit.to_string())
    .execute(&elw.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz_spiegel SET bruch_offen = 1 WHERE einsatz_id = ?")
        .bind(e)
        .execute(&elw.pool)
        .await
        .unwrap();
    for _ in 0..2 {
        abgleichen(&elw).await;
    }
    let bleibt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit WHERE id = ?")
        .bind(einheit)
        .fetch_one(&elw.pool)
        .await
        .unwrap();
    assert_eq!(bleibt, 1, "die Einheit des anderen Einsatzes bleibt");
    assert_eq!(bruch_offen(&elw, e).await, 0, "geklärt");
}

#[tokio::test]
async fn rueckuebergabe_bringt_keine_doppelten() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    abgleichen(&elw).await;
    let (s, _) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    elw_meldet(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    mitglied_werden(&hub, h).await;
    let (s, _) = etb(&hub, h).await;
    assert_eq!(s, StatusCode::CREATED);
    abgleichen(&elw).await;
    let (s, v) = post(
        &hub,
        &format!("/api/einsaetze/{h}/fuehrung/uebergeben"),
        json!({"an": elw.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    assert!(!ist_spiegel(&elw, e).await, "der ELW führt wieder");
    assert!(ist_spiegel(&hub, h).await);
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    abgleichen(&elw).await;
    let am_elw = etb_nummern(&elw, e).await;
    assert_eq!(am_elw, vec![1, 2, 3], "{am_elw:?}");
    assert_eq!(etb_nummern(&hub, h).await, am_elw);
}

#[tokio::test]
async fn ein_offener_antrag_am_spiegel_wird_beim_wechsel_genau_einmal_ausgefuehrt() {
    let (hub, elw) = gekoppelt().await;
    let (erika_elw, _) = gemeinsames_konto(&hub, &elw, "erika").await;
    sqlx::query("UPDATE benutzer SET passwort_wechsel_pflicht = 0")
        .execute(&hub.pool)
        .await
        .unwrap();
    let erika = common::login_cookie(&hub.app, "erika", "erikapw12345").await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    common::rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "fuehrungspersonal").await;
    elw_meldet(&elw).await;
    let akte = fremde(&hub).await[0]["id"].as_i64().unwrap();
    let h = einsatz_der_akte(&hub, akte).await;

    // Am Hub (noch Spiegel) beantragt Erika einen Eintrag; bevor er beim ELW ankommt, wechselt
    // die Führung.
    let (s, v) = common::anfrage_json(
        &hub.app,
        "POST",
        &format!("/api/einsaetze/{h}/etb"),
        &erika,
        Some(
            &json!({"von": "Stab", "an": "EL", "typ": "meldung", "inhalt": "Vom Stab",
                     "anhang_ids": [], "client_id": "c-1"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    for _ in 0..2 {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&hub.pool, Some(&hub.app), true)
            .await
            .unwrap();
        abgleichen(&elw).await;
    }
    let am_hub = etb_nummern(&hub, h).await;
    assert_eq!(am_hub, vec![1], "der Antrag steht genau einmal am Hub");
    assert_eq!(etb_nummern(&elw, e).await, am_hub);
    let offen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM spiegel_antrag")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    assert_eq!(offen, 0, "ausgeführt und erledigt");
}

/// Anträge ohne eigene Erfassung gehen beim Wechsel nicht verloren (Review LLH-1641): der
/// ETB-Antrag einer Freigabe (`etb_beantragen_tx`) und ein Antrag aus der Zeit vor LLH-1641
/// (`daten_lokal` leer, keine Kennungen darin).
#[tokio::test]
async fn antraege_ohne_eigene_erfassung_werden_beim_wechsel_ausgefuehrt() {
    let (hub, elw) = gekoppelt().await;
    let (erika_elw, _) = gemeinsames_konto(&hub, &elw, "erika").await;
    sqlx::query("UPDATE benutzer SET passwort_wechsel_pflicht = 0")
        .execute(&hub.pool)
        .await
        .unwrap();
    let erika = common::login_cookie(&hub.app, "erika", "erikapw12345").await;
    let erika_hub: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'erika'")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    common::rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "fuehrungspersonal").await;
    elw_meldet(&elw).await;
    let akte = fremde(&hub).await[0]["id"].as_i64().unwrap();
    let h = einsatz_der_akte(&hub, akte).await;

    let (s, v) = common::anfrage_json(
        &hub.app,
        "POST",
        &format!("/api/einsaetze/{h}/etb"),
        &erika,
        Some(
            &json!({"von": "Stab", "an": "EL", "typ": "meldung", "inhalt": "Alter Antrag",
                     "anhang_ids": [], "client_id": "c-alt"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    sqlx::query("UPDATE spiegel_antrag SET daten_lokal = NULL")
        .execute(&hub.pool)
        .await
        .unwrap();
    let mut conn = hub.pool.acquire().await.unwrap();
    lifeline_hub::instanz::spiegel::antrag::etb_beantragen_tx(
        &mut conn,
        h,
        erika_hub,
        lifeline_hub::etb::EtbTyp::Meldung,
        "Lagebild freigegeben",
        "Stab",
        "EL",
    )
    .await
    .unwrap();
    drop(conn);

    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    for _ in 0..2 {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&hub.pool, Some(&hub.app), true)
            .await
            .unwrap();
        abgleichen(&elw).await;
    }
    assert_eq!(
        etb_nummern(&hub, h).await.len(),
        2,
        "beide Anträge stehen am Hub"
    );
    let offen: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT zustand, grund FROM spiegel_antrag")
            .fetch_all(&hub.pool)
            .await
            .unwrap();
    assert!(offen.is_empty(), "ausgeführt und erledigt: {offen:?}");
}

#[tokio::test]
async fn ein_anhang_den_der_neue_fuehrer_nicht_hat_kommt_vom_alten() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    // Vier Stücke: eine Runde Abgleich bringt nur die Metadaten.
    let n = 3 * 256 * 1024 + 1000;
    let bytes: Vec<u8> = (0..n).map(|i| (i * 7 % 251) as u8).collect();
    sqlx::query(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'foto.bin', 'application/octet-stream', ?, 'x', ?, 1)",
    )
    .bind(e)
    .bind(n as i64)
    .bind(&bytes)
    .execute(&elw.pool)
    .await
    .unwrap();
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
        .await
        .unwrap();
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::melden::run_durchlauf(&elw.pool)
        .await
        .unwrap();
    let h = einsatz_der_akte(&hub, akte).await;
    assert!(!ist_spiegel(&hub, h).await, "der Hub führt");
    let (hub_id, laenge): (i64, i64) =
        sqlx::query_as("SELECT id, length(daten) FROM anhang WHERE einsatz_id = ?")
            .bind(h)
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert!((laenge as usize) < n, "noch nicht vollständig: {laenge}");
    let f = lifeline_hub::instanz::spiegel::anhang::pruefe_vorhanden(
        &hub.pool,
        "anhang",
        &hub_id.to_string(),
    )
    .await;
    assert!(
        matches!(f, Err(lifeline_hub::error::AppError::Conflict(ref t)) if t == lifeline_hub::instanz::spiegel::anhang::WIRD_GEHOLT),
        "{f:?}"
    );
    for _ in 0..4 {
        abgleichen(&elw).await;
    }
    let am_hub: Vec<u8> = sqlx::query_scalar("SELECT daten FROM anhang WHERE id = ?")
        .bind(hub_id)
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    assert_eq!(am_hub, bytes, "vom ELW geholt");
}

// ── Bruchstelle nachreichen (LLH-1646) ───────────────────────────────────────────────────────

/// Notübernahme am Hub, danach schreibt Erika (ein Konto, das beide kennen) am ELW einen
/// ETB-Eintrag und eine Meldung, der ELW bestätigt und wird Spiegel. (Hub, ELW, Einsatz am ELW,
/// Einsatz am Hub, Erikas Cookie am ELW.)
async fn bruch_nach_notuebernahme() -> (Instanz, Instanz, i64, i64, String) {
    let (hub, elw) = gekoppelt().await;
    let (erika_elw, erika) = gemeinsames_konto(&hub, &elw, "erika").await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    common::rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "fuehrungspersonal").await;
    elw_meldet(&elw).await;
    let akte = fremde(&hub).await[0]["id"].as_i64().unwrap();
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CREATED);
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    mitglied_werden(&hub, h).await;
    let (s, v) = etb(&hub, h).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &erika,
        Some(
            &json!({"von": "ELW 1", "an": "EL", "typ": "lage", "inhalt": "Nach dem Bruch",
                     "ereigniszeit": "2026-11-11 09:30:00", "anhang_ids": [],
                     "client_id": "bruch-etb-1"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen"),
        &erika,
        Some(
            &json!({"absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
                     "inhalt": "Deich hält", "ereigniszeit": "2026-11-11 09:40:00",
                     "client_id": "bruch-meldung-1"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert!(ist_spiegel(&elw, e).await);
    // Meldung und ETB-Eintrag zeigen aufeinander; die Bruchstelle kommt trotzdem zu Ende.
    assert_eq!(bruch_offen(&elw, e).await, 0, "geklärt");
    (hub, elw, e, h, erika)
}

async fn bruchstelle(i: &Instanz, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, v) = common::anfrage(
        &i.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/bruchstelle"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v.as_array().unwrap().clone()
}

async fn band_zaehlt(i: &Instanz, einsatz: i64) -> i64 {
    let (_, kopf) = common::anfrage(
        &i.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &i.admin,
        None,
    )
    .await;
    kopf["spiegel"]["bruchstelle"].as_i64().unwrap()
}

async fn etb_inhalte(i: &Instanz, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr")
        .bind(einsatz)
        .fetch_all(&i.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn nach_der_notuebernahme_reicht_der_elw_genau_einmal_nach() {
    let (hub, elw, e, h, erika) = bruch_nach_notuebernahme().await;
    let liste = bruchstelle(&elw, &erika, e).await;
    assert_eq!(
        liste.len(),
        2,
        "ETB-Eintrag und Meldung, je eine Erfassung: {liste:?}"
    );
    assert_eq!(band_zaehlt(&elw, e).await, 2);
    let etb_bruch = liste
        .iter()
        .find(|l| l["tabelle"] == "etb_eintrag")
        .unwrap();
    let meldung = liste.iter().find(|l| l["tabelle"] == "meldung").unwrap();
    assert_eq!(etb_bruch["antrag_art"], "etb");
    assert_eq!(etb_bruch["kurz"], "Nach dem Bruch");
    assert_eq!(meldung["antrag_art"], "meldung");
    assert_eq!(meldung["folgen"], 1, "ihr ETB-Eintrag zählt nicht extra");

    // Stellen, zweimal: derselbe Antrag.
    let pfad = format!(
        "/api/einsaetze/{e}/bruchstelle/{}/antrag",
        etb_bruch["id"].as_i64().unwrap()
    );
    let (s, v1) = common::anfrage_json(&elw.app, "POST", &pfad, &erika, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v1}");
    let (s, v2) = common::anfrage_json(&elw.app, "POST", &pfad, &erika, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v2}");
    assert_eq!(v1["antrag"]["id"], v2["antrag"]["id"]);
    assert_eq!(band_zaehlt(&elw, e).await, 1);

    // „Alle stellen“ nimmt die Meldung.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/bruchstelle/antraege"),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["gestellt"], 1, "{v}");
    assert_eq!(band_zaehlt(&elw, e).await, 0);
    assert!(bruchstelle(&elw, &erika, e).await.is_empty());

    abgleichen(&elw).await;
    abgleichen(&elw).await;
    let am_hub = etb_inhalte(&hub, h).await;
    assert_eq!(
        am_hub.iter().filter(|i| *i == "Nach dem Bruch").count(),
        1,
        "genau einmal: {am_hub:?}"
    );
    assert_eq!(
        am_hub.iter().filter(|i| *i == "Deich hält").count(),
        1,
        "der ETB-Eintrag der Meldung einmal: {am_hub:?}"
    );
    let meldungen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM meldung WHERE einsatz_id = ? AND inhalt = 'Deich hält'",
    )
    .bind(h)
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert_eq!(meldungen, 1);
    async fn ereigniszeit(pool: &sqlx::SqlitePool, einsatz: i64) -> String {
        sqlx::query_scalar(
            "SELECT ereigniszeit FROM etb_eintrag WHERE einsatz_id = ? AND inhalt = 'Nach dem Bruch'",
        )
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap()
    }
    let damals = ereigniszeit(&elw.pool, e).await;
    let zeit = ereigniszeit(&hub.pool, h).await;
    assert!(damals.starts_with("2026-11-11"), "am ELW erfasst: {damals}");
    assert_eq!(zeit, damals, "Ereigniszeit von damals, auf die Sekunde");
    assert_eq!(
        etb_inhalte(&elw, e).await,
        am_hub,
        "der Spiegel holt die nachgereichten Einträge"
    );

    // Ein weiterer Abgleich und ein erneutes Stellen ändern nichts.
    let (s, v3) = common::anfrage_json(&elw.app, "POST", &pfad, &erika, Some(&json!({}))).await;
    assert!(
        s == StatusCode::ACCEPTED || s == StatusCode::CONFLICT,
        "kein zweiter Antrag: {s}"
    );
    if s == StatusCode::ACCEPTED {
        assert_eq!(
            v3["antrag"]["id"], v1["antrag"]["id"],
            "kein zweiter Antrag: {v3}"
        );
    }
    abgleichen(&elw).await;
    assert_eq!(etb_inhalte(&hub, h).await, am_hub);
}

#[tokio::test]
async fn verworfen_und_abgelehnt_bestimmen_den_zaehler() {
    let (hub, elw, e, h, erika) = bruch_nach_notuebernahme().await;
    let liste = bruchstelle(&elw, &erika, e).await;
    let id = |tabelle: &str| {
        liste.iter().find(|l| l["tabelle"] == tabelle).unwrap()["id"]
            .as_i64()
            .unwrap()
    };
    let (etb_id, meldung_id) = (id("etb_eintrag"), id("meldung"));

    // Verwerfen.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/bruchstelle/{meldung_id}/verwerfen"),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    assert_eq!(band_zaehlt(&elw, e).await, 1);

    // Ein Antrag, den der Hub ablehnt (ohne „von“), macht den Eintrag wieder offen.
    sqlx::query("UPDATE einsatz_bruchstelle SET daten = json_set(daten, '$.von', '') WHERE id = ?")
        .bind(etb_id)
        .execute(&elw.pool)
        .await
        .unwrap();
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/bruchstelle/{etb_id}/antrag"),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    assert_eq!(band_zaehlt(&elw, e).await, 0);
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    let zustand: String = sqlx::query_scalar("SELECT zustand FROM spiegel_antrag WHERE id = ?")
        .bind(v["antrag"]["id"].as_i64().unwrap())
        .fetch_one(&elw.pool)
        .await
        .unwrap();
    assert_eq!(zustand, "abgelehnt");
    assert_eq!(band_zaehlt(&elw, e).await, 1, "wieder offen");

    // Richtig gestellt geht er durch, mit derselben client_id, und ersetzt den abgelehnten.
    sqlx::query(
        "UPDATE einsatz_bruchstelle SET daten = json_set(daten, '$.von', 'ELW 1') WHERE id = ?",
    )
    .bind(etb_id)
    .execute(&elw.pool)
    .await
    .unwrap();
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/bruchstelle/{etb_id}/antrag"),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert_eq!(
        etb_inhalte(&hub, h)
            .await
            .iter()
            .filter(|i| *i == "Nach dem Bruch")
            .count(),
        1
    );
    let antraege: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM spiegel_antrag WHERE client_id = 'bruch-etb-1'")
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert!(antraege <= 1, "der abgelehnte ist ersetzt");
    assert_eq!(band_zaehlt(&elw, e).await, 0);
}

#[tokio::test]
async fn ohne_schreibrecht_kein_nachreichen() {
    let (_hub, elw, e, _h, erika) = bruch_nach_notuebernahme().await;
    let id = bruchstelle(&elw, &erika, e).await[0]["id"]
        .as_i64()
        .unwrap();
    // Die Mitgliedschaft ist gespiegelt: ändern nur unter dem Merker der Übernahme.
    let mut conn = elw.pool.acquire().await.unwrap();
    sqlx::query("INSERT INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE einsatz_mitgliedschaft SET einsatz_rolle = 'beobachter' WHERE einsatz_id = ? \
         AND benutzer_id = (SELECT id FROM benutzer WHERE benutzername = 'erika')",
    )
    .bind(e)
    .execute(&mut *conn)
    .await
    .unwrap();
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);
    for pfad in [
        format!("/api/einsaetze/{e}/bruchstelle/{id}/antrag"),
        format!("/api/einsaetze/{e}/bruchstelle/{id}/verwerfen"),
        format!("/api/einsaetze/{e}/bruchstelle/antraege"),
    ] {
        let (s, v) = common::anfrage_json(&elw.app, "POST", &pfad, &erika, Some(&json!({}))).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{pfad}: {v}");
    }
    assert_eq!(band_zaehlt(&elw, e).await, 2);
}

// ── Personen samt Verlauf nachreichen (LLH-1657) ─────────────────────────────────────────────

/// Wie [`bruch_nach_notuebernahme`], nur schreibt Erika nach dem Bruch Personen: eine neue Person
/// mit Erst-Sichtung und PAT-Nummer, an ihr eine zweite Sichtung und eine Maßnahme, die sie wieder
/// aufhebt, und eine Sichtung an einer Person, die der Hub schon kennt. (Hub, ELW, Einsatz am
/// ELW, Einsatz am Hub, Erikas Cookie am ELW.)
async fn bruch_mit_personen() -> (Instanz, Instanz, i64, i64, String) {
    let (hub, elw) = gekoppelt().await;
    let (erika_elw, erika) = gemeinsames_konto(&hub, &elw, "erika").await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    common::rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "fuehrungspersonal").await;
    let bekannt = common::person_anlegen(&elw.app, &erika, e, r#"{"name":"Bekannt"}"#).await;
    elw_meldet(&elw).await;
    let akte = fremde(&hub).await[0]["id"].as_i64().unwrap();
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    mitglied_werden(&hub, h).await;

    let schreibe = |pfad: String, body: Value| {
        let (app, erika) = (elw.app.clone(), erika.clone());
        async move {
            let (s, v) = common::anfrage_json(&app, "POST", &pfad, &erika, Some(&body)).await;
            assert_eq!(s, StatusCode::CREATED, "{pfad}: {v}");
            v
        }
    };
    let neu = schreibe(
        format!("/api/einsaetze/{e}/personen"),
        json!({"name": "Muster", "vorname": "Max", "sichtung": "sk2", "pat_nummer": "PAT-77",
               "client_id": "bruch-person-1"}),
    )
    .await;
    let p = neu["id"].as_i64().unwrap();
    schreibe(
        format!("/api/einsaetze/{e}/personen/{p}/sichtung"),
        json!({"kategorie": "sk1", "client_id": "bruch-sichtung-1"}),
    )
    .await;
    let m = schreibe(
        format!("/api/einsaetze/{e}/personen/{p}/massnahmen"),
        json!({"art": "blutstillung", "client_id": "bruch-massnahme-1"}),
    )
    .await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!(
            "/api/einsaetze/{e}/personen/{p}/massnahmen/{}/aufheben",
            m["id"].as_i64().unwrap()
        ),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    schreibe(
        format!("/api/einsaetze/{e}/personen/{bekannt}/sichtung"),
        json!({"kategorie": "sk3", "client_id": "bruch-sichtung-bekannt"}),
    )
    .await;

    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert!(ist_spiegel(&elw, e).await);
    assert_eq!(bruch_offen(&elw, e).await, 0, "geklärt");
    (hub, elw, e, h, erika)
}

/// Die Personen eines Einsatzes mit Namen (Name, Kennung).
async fn personen_mit_namen(i: &Instanz, einsatz: i64, name: &str) -> Vec<i64> {
    sqlx::query_scalar("SELECT id FROM einsatz_person WHERE einsatz_id = ? AND name = ?")
        .bind(einsatz)
        .bind(name)
        .fetch_all(&i.pool)
        .await
        .unwrap()
}

async fn sichtungen(i: &Instanz, person: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT kategorie FROM person_sichtung WHERE person_id = ? ORDER BY id")
        .bind(person)
        .fetch_all(&i.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn person_samt_verlauf_kommt_genau_einmal_an_der_richtigen_person_an() {
    let (hub, elw, e, h, erika) = bruch_mit_personen().await;
    let liste = bruchstelle(&elw, &erika, e).await;
    let person = liste
        .iter()
        .find(|l| l["tabelle"] == "einsatz_person")
        .unwrap_or_else(|| panic!("die neue Person ist eine Erfassung: {liste:?}"));
    assert_eq!(person["antrag_art"], "person", "{person}");
    assert_eq!(person["kurz"], "Muster, Max");
    assert!(
        person["folgen"].as_i64().unwrap() >= 3,
        "Sichtungen und Maßnahme hängen an ihr: {person}"
    );
    let sichtung_bekannt = liste
        .iter()
        .find(|l| l["tabelle"] == "person_sichtung")
        .unwrap_or_else(|| {
            panic!("die Sichtung an der bekannten Person steht für sich: {liste:?}")
        });
    assert_eq!(sichtung_bekannt["antrag_art"], "sichtung");
    assert_eq!(sichtung_bekannt["kurz"], "SK III");
    let vorher = band_zaehlt(&elw, e).await;

    // Die Person stellen, zweimal: derselbe Antrag. Die Zeile bleibt, bis die Kette durch ist.
    let pfad = format!(
        "/api/einsaetze/{e}/bruchstelle/{}/antrag",
        person["id"].as_i64().unwrap()
    );
    let (s, v1) = common::anfrage_json(&elw.app, "POST", &pfad, &erika, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v1}");
    let (s, v2) = common::anfrage_json(&elw.app, "POST", &pfad, &erika, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v2}");
    assert_eq!(v1["antrag"]["id"], v2["antrag"]["id"]);
    assert_eq!(band_zaehlt(&elw, e).await, vorher - 1);
    let wartend = bruchstelle(&elw, &erika, e).await;
    let zeile = wartend.iter().find(|l| l["id"] == person["id"]).unwrap();
    assert_eq!(zeile["nachgereicht"], true, "{zeile}");
    assert!(zeile["folgen_offen"].as_i64().unwrap() >= 3, "{zeile}");
    assert!(
        zeile.get("antrag_art").is_none(),
        "nicht noch einmal stellbar"
    );

    // Die bekannte Person: Sichtung sofort stellbar.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!(
            "/api/einsaetze/{e}/bruchstelle/{}/antrag",
            sichtung_bekannt["id"].as_i64().unwrap()
        ),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");

    // Antrag der Person → Quittung → Person zurück → Kette stellt → Hub führt aus.
    for _ in 0..4 {
        abgleichen(&elw).await;
    }

    let am_hub = personen_mit_namen(&hub, h, "Muster").await;
    assert_eq!(am_hub.len(), 1, "genau einmal");
    let neu = am_hub[0];
    assert_eq!(
        sichtungen(&hub, neu).await,
        ["sk2", "sk1"],
        "beide Sichtungen an der neuen Person"
    );
    let (pat, status): (Option<String>, String) =
        sqlx::query_as("SELECT pat_nummer, status FROM einsatz_person WHERE id = ?")
            .bind(neu)
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(pat.as_deref(), Some("PAT-77"), "K2");
    assert_eq!(
        status, "betroffen",
        "Status wie am ELW, mit der Anlage übernommen"
    );
    let massnahmen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM person_massnahme WHERE person_id = ? AND art = 'blutstillung'",
    )
    .bind(neu)
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert_eq!(massnahmen, 1, "K4: auch die aufgehobene geht mit");
    let notizen: Vec<String> =
        sqlx::query_scalar("SELECT text FROM person_verlaufsnotiz WHERE person_id = ?")
            .bind(neu)
            .fetch_all(&hub.pool)
            .await
            .unwrap();
    assert_eq!(notizen.len(), 1, "eine Nachreich-Notiz: {notizen:?}");
    assert!(
        notizen[0].starts_with("Als R-002 erfasst, nach der Notübernahme nachgereicht."),
        "K3: {notizen:?}"
    );
    assert!(
        notizen[0].contains("Aufgehoben: Maßnahme Blutstillung"),
        "K4: {notizen:?}"
    );
    let bekannt = personen_mit_namen(&hub, h, "Bekannt").await;
    assert_eq!(
        sichtungen(&hub, bekannt[0]).await,
        ["sk3"],
        "an der bekannten Person"
    );

    // Liste leer, Band null; ein weiterer Durchlauf und ein erneutes Stellen ändern nichts.
    assert!(
        bruchstelle(&elw, &erika, e).await.is_empty(),
        "{:?}",
        bruchstelle(&elw, &erika, e).await
    );
    assert_eq!(band_zaehlt(&elw, e).await, 0);
    let (s, _) = common::anfrage_json(&elw.app, "POST", &pfad, &erika, Some(&json!({}))).await;
    assert!(
        s == StatusCode::ACCEPTED || s == StatusCode::CONFLICT,
        "{s}"
    );
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert_eq!(personen_mit_namen(&hub, h, "Muster").await.len(), 1);
    assert_eq!(sichtungen(&hub, neu).await.len(), 2);
    let notizen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM person_verlaufsnotiz WHERE person_id = ?")
            .bind(neu)
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(notizen, 1);
}

#[tokio::test]
async fn ein_abgelehnter_eintrag_der_kette_kommt_als_eigene_zeile_zurueck() {
    let (hub, elw, e, h, erika) = bruch_mit_personen().await;
    // Die Maßnahme so verfälschen, dass der Hub sie ablehnt (unbekannte Art: 400).
    sqlx::query(
        "UPDATE einsatz_bruchstelle SET daten = json_set(daten, '$.art', 'unbekannt') \
         WHERE einsatz_id = ? AND art = 'person_massnahme'",
    )
    .bind(e)
    .execute(&elw.pool)
    .await
    .unwrap();
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/bruchstelle/antraege"),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["gestellt"], 2, "Person und Sichtung der bekannten: {v}");
    for _ in 0..5 {
        abgleichen(&elw).await;
    }
    let neu = personen_mit_namen(&hub, h, "Muster").await;
    assert_eq!(neu.len(), 1);
    assert_eq!(
        sichtungen(&hub, neu[0]).await,
        ["sk2", "sk1"],
        "der Rest der Kette"
    );
    let liste = bruchstelle(&elw, &erika, e).await;
    assert_eq!(liste.len(), 1, "nur die Maßnahme ist zurück: {liste:?}");
    assert_eq!(liste[0]["tabelle"], "person_massnahme");
    assert!(liste[0]["grund"].as_str().is_some(), "{liste:?}");
    assert_eq!(band_zaehlt(&elw, e).await, 1);
}

// ── Zustandsfehler des Stellens sind 422 (LLH-1701) ──────────────────────────────────────────

async fn bruch_stellen(i: &Instanz, cookie: &str, einsatz: i64, bruch: i64) -> (StatusCode, Value) {
    common::anfrage_json(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bruchstelle/{bruch}/antrag"),
        cookie,
        Some(&json!({})),
    )
    .await
}

/// Eine Person an einer Meldung der Bruchstelle geht erst, wenn die Meldung beim Führer ist. Bis
/// dahin antwortet das Stellen mit 422 (der Zustand, `src/AGENTS.md`, Statuscode-Konvention),
/// und „Alle stellen“ lässt sie mit Grund offen.
#[tokio::test]
async fn eine_person_wartet_mit_422_auf_ihre_meldung() {
    let (hub, elw) = gekoppelt().await;
    let (erika_elw, erika) = gemeinsames_konto(&hub, &elw, "erika").await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    common::rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "fuehrungspersonal").await;
    elw_meldet(&elw).await;
    let akte = fremde(&hub).await[0]["id"].as_i64().unwrap();
    abgleichen(&elw).await;
    let h = einsatz_der_akte(&hub, akte).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ausgefallen").await;
    mitglied_werden(&hub, h).await;

    let (s, m) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen"),
        &erika,
        Some(
            &json!({"absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
                     "inhalt": "Eine Verletzte am Deich", "ereigniszeit": "2026-11-11 09:40:00",
                     "client_id": "bruch-meldung-422"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    let (s, p) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &erika,
        Some(&json!({"name": "Muster", "meldung_id": m["id"], "client_id": "bruch-person-422"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    let person_lokal = p["id"].as_i64().unwrap();

    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/bestaetigen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert!(ist_spiegel(&elw, e).await);

    let liste = bruchstelle(&elw, &erika, e).await;
    let id_von = |tabelle: &str| {
        liste
            .iter()
            .find(|l| l["tabelle"] == tabelle)
            .unwrap_or_else(|| panic!("{tabelle} ist eine Erfassung: {liste:?}"))["id"]
            .as_i64()
            .unwrap()
    };
    let (meldung, person) = (id_von("meldung"), id_von("einsatz_person"));

    // Die Meldung ist noch offen: erst sie stellen oder verwerfen.
    let (s, v) = bruch_stellen(&elw, &erika, e, person).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["error"], "Bezug ist nicht nachgereicht.");

    // Gestellt, aber noch nicht zurück: Die Person wartet auf sie.
    let (s, v) = bruch_stellen(&elw, &erika, e, meldung).await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    let (s, v) = bruch_stellen(&elw, &erika, e, person).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["error"], "Bezug noch nicht beim Führer.");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/bruchstelle/antraege"),
        &erika,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "„Alle stellen“ bricht nicht ab: {v}");
    assert_eq!(v["gestellt"], 0, "{v}");
    assert_eq!(
        v["offen"],
        json!([{"id": person, "grund": "Bezug noch nicht beim Führer."}]),
        "{v}"
    );

    // Dieselbe Meldung aus der Antragsroute: eine Erfassung an der Person, die der Führer noch
    // nicht kennt.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/personen/{person_lokal}/sichtung"),
        &erika,
        Some(&json!({"kategorie": "sk2", "client_id": "bruch-sichtung-422"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["error"], "Bezug noch nicht beim Führer.");

    // Ist die Meldung zurück, geht die Person, mit ihr.
    for _ in 0..3 {
        abgleichen(&elw).await;
    }
    let (s, v) = bruch_stellen(&elw, &erika, e, person).await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    for _ in 0..3 {
        abgleichen(&elw).await;
    }
    let an_meldung: Vec<Option<i64>> =
        sqlx::query_scalar("SELECT meldung_id FROM einsatz_person WHERE einsatz_id = ?")
            .bind(h)
            .fetch_all(&hub.pool)
            .await
            .unwrap();
    assert_eq!(an_meldung.len(), 1, "genau einmal");
    assert!(an_meldung[0].is_some(), "an ihrer Meldung");
}

/// Läuft die Kette, solange die gestellte Person noch nicht zurück ist (der Takt läuft jede
/// Sekunde), wartet sie: Kein Eintrag löst sich mit Grund, und kommt die Person, geht der Rest.
#[tokio::test]
async fn die_kette_wartet_bis_die_person_zurueck_ist() {
    let (hub, elw, e, h, erika) = bruch_mit_personen().await;
    let liste = bruchstelle(&elw, &erika, e).await;
    let person = liste
        .iter()
        .find(|l| l["tabelle"] == "einsatz_person")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let (s, v) = bruch_stellen(&elw, &erika, e, person).await;
    assert_eq!(s, StatusCode::ACCEPTED, "{v}");
    let vorher = bruchstelle(&elw, &erika, e).await;

    // Der Antrag ist noch nicht beim Führer, die Person also nicht zurück.
    let geaendert = lifeline_hub::instanz::spiegel::bruchstelle::ketten_fortsetzen(&elw.pool)
        .await
        .unwrap();
    assert!(geaendert.is_empty(), "nichts gestellt, nichts gelöst");
    let wartend = bruchstelle(&elw, &erika, e).await;
    assert_eq!(wartend, vorher, "die Kette hängt unverändert an der Person");
    let zeile = wartend.iter().find(|l| l["id"] == person).unwrap();
    assert!(zeile["folgen_offen"].as_i64().unwrap() >= 3, "{zeile}");
    let mit_grund: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ? AND grund IS NOT NULL",
    )
    .bind(e)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    assert_eq!(mit_grund, 0, "kein Eintrag hat sich mit Grund gelöst");

    for _ in 0..4 {
        abgleichen(&elw).await;
    }
    let am_hub = personen_mit_namen(&hub, h, "Muster").await;
    assert_eq!(am_hub.len(), 1);
    assert_eq!(
        sichtungen(&hub, am_hub[0]).await,
        ["sk2", "sk1"],
        "die Kette hat nach der Rückkehr gestellt"
    );
}

#[tokio::test]
async fn was_sich_nicht_nachreichen_laesst_antwortet_422() {
    let (_hub, elw, e, _h, erika) = bruch_nach_notuebernahme().await;
    // Eine Meldung an einem Auftrag reicht sich nicht nach.
    sqlx::query(
        "UPDATE einsatz_bruchstelle SET daten = json_set(daten, '$.auftrag_id', 1) \
         WHERE einsatz_id = ? AND art = 'meldung'",
    )
    .bind(e)
    .execute(&elw.pool)
    .await
    .unwrap();
    let meldung: i64 = sqlx::query_scalar(
        "SELECT id FROM einsatz_bruchstelle WHERE einsatz_id = ? AND art = 'meldung'",
    )
    .bind(e)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    let (s, v) = bruch_stellen(&elw, &erika, e, meldung).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["error"], "Lässt sich nicht als Antrag stellen.");
    assert_eq!(band_zaehlt(&elw, e).await, 2, "nichts gestellt");
}

// ── Grenzen und Budgets (LLH-1672) ───────────────────────────────────────────────────────────

async fn hinweis(i: &Instanz) -> Option<String> {
    sqlx::query_scalar("SELECT hinweis FROM instanz_kopplung")
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

async fn letzter_fehler(i: &Instanz) -> Option<String> {
    sqlx::query_scalar("SELECT letzter_fehler FROM instanz_kopplung")
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

async fn staende(i: &Instanz) -> (i64, i64, i64) {
    sqlx::query_as(
        "SELECT k.fuehrung_gesendet_bis, k.fuehrung_empfangen_bis, i.fuehrung_stand \
         FROM instanz_kopplung k, instanz_identitaet i",
    )
    .fetch_one(&i.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn lange_bezeichnung_haelt_das_melden_nicht_auf() {
    let (hub, elw) = gekoppelt().await;
    // 80 KB Bezeichnung: ungekürzt sprengte sie jede Meldung (Rumpf höchstens 64 KiB).
    common::einsatz_anlegen_mit(&elw.app, &elw.admin, &"ü".repeat(40_000)).await;
    elw_meldet(&elw).await;
    assert_eq!(letzter_fehler(&elw).await, None);
    let akten = fremde(&hub).await;
    assert_eq!(
        akten.len(),
        1,
        "die Akte kommt an, nicht still übersprungen"
    );
    // Die Akte kam gekürzt (Unit-Test `kopf_wird_beim_bauen_gekuerzt`); angezeigt wird der Kopf
    // des Spiegels, und der trägt den ganzen Einsatz.
    assert_eq!(akten[0]["fuehrer_kennung"], elw.kennung);
}

#[tokio::test]
async fn zu_grosse_akte_wird_uebersprungen_und_haelt_den_rest_nicht_auf() {
    let (hub, elw) = gekoppelt().await;
    let (e, _) = elw_einsatz(&hub, &elw).await;
    // Eine Akte, die das Gegenüber nicht annähme (Erklärung weit über der Grenze), soll weder
    // die Meldung sprengen noch die Akten danach aufhalten, und nicht still verschwinden.
    let stand: i64 = sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz_fuehrung SET erklaerung = ?, stand = ? WHERE einsatz_id = ?")
        .bind("x".repeat(70_000))
        .bind(stand)
        .bind(e)
        .execute(&elw.pool)
        .await
        .unwrap();
    common::einsatz_anlegen(&elw.app, &elw.admin).await;
    elw_meldet(&elw).await;
    assert_eq!(
        letzter_fehler(&elw).await,
        None,
        "die Meldung selbst geht durch"
    );
    let h = hinweis(&elw).await.unwrap_or_default();
    assert!(h.contains("zu groß"), "Hinweis mit Grund: {h:?}");
    assert_eq!(
        fremde(&hub).await.len(),
        2,
        "die Akte danach ist angekommen"
    );
    let (gesendet, _, _) = staende(&elw).await;
    assert!(
        gesendet > stand,
        "der Stand rückt über die übersprungene Akte"
    );
}

#[tokio::test]
async fn quittung_ueber_dem_eigenen_stand_wird_gekappt() {
    let (hub, elw) = gekoppelt().await;
    elw_einsatz(&hub, &elw).await;
    // Ein fehlerhafter Hub quittiert einen Stand, den der ELW nie vergeben hat.
    sqlx::query("UPDATE instanz_kopplung SET fuehrung_empfangen_bis = ?")
        .bind(i64::MAX)
        .execute(&hub.pool)
        .await
        .unwrap();
    elw_meldet(&elw).await;
    let (gesendet, _, stand) = staende(&elw).await;
    assert!(gesendet <= stand, "ELW kappt: {gesendet} über {stand}");
    // Der Hub arbeitet wieder korrekt: neue Akten des ELW fließen wieder.
    sqlx::query("UPDATE instanz_kopplung SET fuehrung_empfangen_bis = 0")
        .execute(&hub.pool)
        .await
        .unwrap();
    common::einsatz_anlegen(&elw.app, &elw.admin).await;
    elw_meldet(&elw).await;
    assert_eq!(fremde(&hub).await.len(), 2, "die neue Akte des ELW ist da");
}

#[tokio::test]
async fn unplausibler_stand_zaehlt_nicht_fuer_die_quittung() {
    let (hub, elw) = gekoppelt().await;
    common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    sqlx::query("UPDATE einsatz_fuehrung SET stand = ?")
        .bind(i64::MAX)
        .execute(&hub.pool)
        .await
        .unwrap();
    elw_meldet(&elw).await;
    let (_, empfangen, _) = staende(&elw).await;
    assert!(empfangen < i64::MAX, "nicht aufs Maximum gesetzt");
    // Schon der Hub schickt sie nicht (dieselben Grenzen wie beim Empfänger), aber nicht still.
    let h = hinweis(&hub).await.unwrap_or_default();
    assert!(h.contains("geht nicht an"), "nicht still: {h:?}");
}

#[tokio::test]
async fn hub_legt_keine_akte_unter_fremdem_praefix_an() {
    let (hub, elw) = gekoppelt().await;
    elw_einsatz(&hub, &elw).await;
    let stand: i64 = sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_fuehrung (kennung, org_id, bezeichnung, status, epoche_zaehler, \
         epoche_instanz, fuehrer_kennung, fuehrer_name, art, stand, geaendert_at) \
         VALUES ('fremd/99', 1, 'Fremd', 'aktiv', 1, ?, ?, 'ELW', 'angelegt', ?, '2026-11-12 10:00:00')",
    )
    .bind(&elw.kennung)
    .bind(&elw.kennung)
    .bind(stand)
    .execute(&elw.pool)
    .await
    .unwrap();
    elw_meldet(&elw).await;
    let akten = fremde(&hub).await;
    assert_eq!(
        akten.len(),
        1,
        "nur die Akte unter dem Präfix des ELW: {akten:?}"
    );
    let h = hinweis(&hub).await.unwrap_or_default();
    assert!(h.contains("fremd/99"), "Hinweis am Hub: {h:?}");
}

#[tokio::test]
async fn ueberhoehte_quittung_laesst_ungesendete_akten_nicht_fallen() {
    let (hub, elw) = gekoppelt().await;
    elw_einsatz(&hub, &elw).await;
    // Der Hub quittiert zu viel (fehlerhaft, oder der ELW kam aus einer Sicherung zurück).
    sqlx::query("UPDATE instanz_kopplung SET fuehrung_empfangen_bis = ?")
        .bind(i64::MAX)
        .execute(&hub.pool)
        .await
        .unwrap();
    for i in 0..120 {
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?)")
            .bind(format!("Einsatz {i}"))
            .execute(&elw.pool)
            .await
            .unwrap();
    }
    for _ in 0..4 {
        elw_meldet(&elw).await;
    }
    assert_eq!(
        fremde(&hub).await.len(),
        121,
        "quittiert ist nur, was hinausging"
    );
}

#[tokio::test]
async fn hub_lehnt_ungueltige_akten_mit_hinweis_ab_und_quittiert_nur_plausible_staende() {
    // Ein fehlerhaftes Gegenüber, an der Prüfung des Senders vorbei: die Meldung direkt an den
    // Hub, wie sie über die Leitung käme.
    let (hub, elw) = gekoppelt().await;
    elw_einsatz(&hub, &elw).await;
    let identitaet = lifeline_hub::instanz::identitaet::load_or_create(&hub.pool)
        .await
        .unwrap();
    let kopplung_id: i64 = sqlx::query_scalar("SELECT id FROM instanz_kopplung")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    let kopplung = lifeline_hub::instanz::repo::load_kopplung(&hub.pool, kopplung_id)
        .await
        .unwrap();
    let (_, vorher, _) = staende(&hub).await;
    let akte = |nr: i64, bezeichnung: String, stand: i64| {
        json!({
            "kennung": format!("{}/x{nr}", elw.kennung),
            "org": format!("{}/1", hub.kennung), "bezeichnung": bezeichnung,
            "status": "aktiv", "epoche": {"zaehler": 1, "instanz": elw.kennung},
            "fuehrer": elw.kennung, "fuehrer_name": "ELW", "art": "angelegt", "stand": stand
        })
    };
    let anfrage: lifeline_hub::instanz::melden::MeldenAnfrage = serde_json::from_value(json!({
        "name": "ELW", "softwarestand": "1", "protokoll": lifeline_hub::instanz::PROTOKOLL,
        "orgs": [{"org": format!("{}/1", hub.kennung), "unterschrift_stand": 0}],
        "fuehrung": [
            akte(1, "x".repeat(501), vorher + 10),
            akte(2, "Lage".into(), i64::MAX),
        ],
        "fuehrung_bis": 0
    }))
    .unwrap();
    // Ohne Web Push am Hub, wie die Route es dann übergibt (`state.live.web_push().is_some()`).
    lifeline_hub::instanz::melden::handle_meldung(
        &hub.pool,
        &identitaet,
        &kopplung,
        &anfrage,
        false,
    )
    .await
    .unwrap();
    assert_eq!(fremde(&hub).await.len(), 1, "keine der beiden angelegt");
    let h = hinweis(&hub).await.unwrap_or_default();
    assert!(h.contains("ungültige Führungsakte"), "nicht still: {h:?}");
    let (_, empfangen, _) = staende(&hub).await;
    assert_eq!(
        empfangen,
        vorher + 10,
        "quittiert bis zum plausiblen Stand, nicht bis i64::MAX"
    );
}

#[tokio::test]
async fn lauter_uebersprungene_akten_loesen_keine_sofortige_meldung_aus() {
    let (hub, elw) = gekoppelt().await;
    elw_meldet(&elw).await;
    // Mehr als eine Nachricht voll Akten am Hub, die alle nicht hinausgehen (Erklärung über der
    // Grenze): Ohne gesendete Akte ist „es bleibt mehr“ kein Grund, sofort wieder zu melden.
    for i in 0..=50 {
        let stand: i64 = sqlx::query_scalar(
            "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
             RETURNING fuehrung_stand",
        )
        .fetch_one(&hub.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fuehrung (kennung, org_id, bezeichnung, status, epoche_zaehler, \
             epoche_instanz, fuehrer_kennung, fuehrer_name, art, erklaerung, stand, geaendert_at) \
             VALUES (?, 1, 'Lage', 'aktiv', 1, ?, ?, 'Hub', 'angelegt', ?, ?, \
             '2026-11-12 10:00:00')",
        )
        .bind(format!("{}/y{i}", hub.kennung))
        .bind(&hub.kennung)
        .bind(&hub.kennung)
        .bind("x".repeat(5000))
        .bind(stand)
        .execute(&hub.pool)
        .await
        .unwrap();
    }
    elw_meldet(&elw).await;
    let naechste: Option<String> =
        sqlx::query_scalar("SELECT naechste_meldung_at FROM instanz_kopplung")
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    let jetzt = lifeline_hub::zeit::jetzt();
    assert!(
        naechste.as_deref().is_some_and(|n| n > jetzt.as_str()),
        "nicht sofort wieder: {naechste:?}"
    );
    let h = hinweis(&hub).await.unwrap_or_default();
    assert!(h.contains("geht nicht an"), "{h:?}");
}

// ── Nach dem Zurückspielen einer Sicherung (LLH-1708) ────────────────────────────────────────
//
// Change `xi5ugyt8-fuehrung-stand-nach-restore`. Das Zurückspielen wird nachgestellt, soweit es
// den Austausch betrifft: Zähler und Stände der Kopplung bekommen den Wert der Sicherung, und was
// erst danach ankam, fehlt. Damit die Zeitachse eines echten Ausfalls in eine Sekunde passt,
// liegen die verlorenen Stände in der Vergangenheit (`jetzt_s() - 1000`).

fn jetzt_s() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Setzt Zähler und Stände der Kopplung einer Instanz auf den Stand einer Sicherung.
async fn zurueckspielen(i: &Instanz, stand: i64, gesendet: i64, empfangen: i64) {
    sqlx::query("UPDATE instanz_identitaet SET fuehrung_stand = ?")
        .bind(stand)
        .execute(&i.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE instanz_kopplung SET fuehrung_gesendet_bis = ?, fuehrung_empfangen_bis = ?",
    )
    .bind(gesendet)
    .bind(empfangen)
    .execute(&i.pool)
    .await
    .unwrap();
}

/// Kennt `i` die Akte des Einsatzes `einsatz` der Instanz `ursprung`? (Kennung
/// `<Instanz>/<Einsatz-ID>-<Zufall>`.)
async fn has_akte(i: &Instanz, ursprung: &Instanz, einsatz: i64) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM einsatz_fuehrung WHERE kennung LIKE ?")
        .bind(format!("{}/{einsatz}-%", ursprung.kennung))
        .fetch_one(&i.pool)
        .await
        .unwrap()
        == 1
}

/// Die Akten der neuen Einsätze entstehen sonst erst in der Meldung (`ensure_akten`); hier
/// vorher, wie wenn jemand die Führung oder die Seite „Instanzkopplung“ öffnet.
async fn akten_anlegen(i: &Instanz) {
    fremde(i).await;
}

/// Nur die Meldung, ohne Abgleich der Einsätze: Die Akte bleibt beim Gegenüber ohne Spiegel.
async fn nur_melden(elw: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::melden::run_durchlauf(&elw.pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn zurueckgespielt_hub_neue_einsaetze_erreichen_den_elw() {
    let (hub, elw) = gekoppelt().await;
    // Vor dem Ausfall hatte der ELW Akten des Hubs bis E übernommen; die Sicherung des Hubs
    // stammt von kurz vor E (D1: die Uhr ist seitdem weitergelaufen).
    let e = jetzt_s() - 1000;
    zurueckspielen(&elw, 0, 0, e).await;
    zurueckspielen(&hub, e - 1, e - 1, 0).await;
    // Zwei Einsätze vor der ersten Meldung: Ohne Uhr bekäme der erste den Stand E und ginge nie
    // hinaus, und der zweite höbe den Zähler über E, sodass auch das Netz (D3) nichts sähe.
    let a = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    let b = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    akten_anlegen(&hub).await;
    nur_melden(&elw).await;
    assert!(
        has_akte(&elw, &hub, a).await,
        "der erste Einsatz nach dem Zurückspielen"
    );
    assert!(has_akte(&elw, &hub, b).await);
}

#[tokio::test]
async fn zurueckgespielt_hub_bekommt_die_verlorene_akte_des_elw_erneut() {
    let (hub, elw) = gekoppelt().await;
    let vor = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    assert!(has_akte(&hub, &elw, vor).await);
    // Sicherung des Hubs: Er hatte den ELW bis hier übernommen.
    let (stand, gesendet, empfangen): (i64, i64, i64) = sqlx::query_as(
        "SELECT i.fuehrung_stand, k.fuehrung_gesendet_bis, k.fuehrung_empfangen_bis \
         FROM instanz_identitaet i, instanz_kopplung k",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert!(empfangen > 0);
    let nach = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    assert!(has_akte(&hub, &elw, nach).await);
    // Der Hub spielt die Sicherung zurück: die Akte von danach ist weg.
    zurueckspielen(&hub, stand, gesendet, empfangen).await;
    sqlx::query("DELETE FROM einsatz_fuehrung WHERE kennung LIKE ?")
        .bind(format!("{}/{nach}-%", elw.kennung))
        .execute(&hub.pool)
        .await
        .unwrap();
    // Erste Meldung: Der Hub quittiert weniger, der ELW setzt seinen Sendestand zurück (D2).
    nur_melden(&elw).await;
    nur_melden(&elw).await;
    assert!(
        has_akte(&hub, &elw, nach).await,
        "die verlorene Akte kommt erneut"
    );
}

#[tokio::test]
async fn quittung_null_eines_gegenuebers_ohne_schalter_sendet_nicht_erneut() {
    let (_hub, elw) = gekoppelt_mit(false, true).await;
    common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let gesendet = jetzt_s() + 5;
    sqlx::query("UPDATE instanz_kopplung SET fuehrung_gesendet_bis = ?")
        .bind(gesendet)
        .execute(&elw.pool)
        .await
        .unwrap();
    nur_melden(&elw).await;
    let (g, _, _) = staende(&elw).await;
    assert_eq!(g, gesendet, "0 ist kein Rückschritt");
}

#[tokio::test]
async fn zurueckgespielt_hub_mit_nachgehender_uhr_holt_das_netz() {
    let (hub, elw) = gekoppelt().await;
    // Die verlorenen Stände liegen über der Uhr des Hubs (seine Uhr geht nach): D1 greift nicht.
    let e = jetzt_s() + 10_000;
    zurueckspielen(&elw, 0, 0, e).await;
    zurueckspielen(&hub, 3, 3, 0).await;
    let a = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    akten_anlegen(&hub).await;
    nur_melden(&elw).await;
    assert!(has_akte(&elw, &hub, a).await, "das Netz (D3) stempelt neu");
    let (_, _, stand) = staende(&hub).await;
    assert!(stand > e, "der Zähler liegt über der Quittung: {stand}");
    let h = hinweis(&hub).await.unwrap_or_default();
    assert!(h.contains("erneut"), "{h:?}");
}

#[tokio::test]
async fn unplausible_quittung_hebt_den_zaehler_nicht() {
    let (hub, elw) = gekoppelt().await;
    let riesig = 1_i64 << 40;
    zurueckspielen(&elw, 0, 0, riesig).await;
    nur_melden(&elw).await;
    let (_, _, stand) = staende(&hub).await;
    assert!(stand < 1 << 39, "{stand}");
}

#[tokio::test]
async fn zurueckgespielt_elw_akten_fliessen_in_beide_richtungen() {
    let (hub, elw) = gekoppelt().await;
    let vor = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    assert!(has_akte(&hub, &elw, vor).await);
    // Der ELW spielt zurück; vor dem Ausfall lief seine Uhr vor, der Hub hat Stände bis E.
    let e = jetzt_s() + 10_000;
    sqlx::query("UPDATE instanz_kopplung SET fuehrung_empfangen_bis = ?")
        .bind(e)
        .execute(&hub.pool)
        .await
        .unwrap();
    zurueckspielen(&elw, 3, 0, 0).await;
    let neu = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    assert!(has_akte(&hub, &elw, neu).await, "ELW → Hub");
    let (_, _, stand) = staende(&elw).await;
    assert!(stand >= e, "der ELW hebt seinen Zähler (D3): {stand}");
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    nur_melden(&elw).await;
    assert!(has_akte(&elw, &hub, h).await, "Hub → ELW");
}

#[tokio::test]
async fn zurueckgespielt_hub_verlorene_akte_kommt_auch_wenn_der_elw_inzwischen_aenderte() {
    // Review B1, design.md D5: Die erste Meldung nach dem Zurückspielen trägt schon eine neue Akte;
    // ohne den Sendestand in der Meldung quittierte der Hub sie, und die verlorene käme nie.
    let (hub, elw) = gekoppelt().await;
    let vor = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    let (stand, gesendet, empfangen): (i64, i64, i64) = sqlx::query_as(
        "SELECT i.fuehrung_stand, k.fuehrung_gesendet_bis, k.fuehrung_empfangen_bis \
         FROM instanz_identitaet i, instanz_kopplung k",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    let nach = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    zurueckspielen(&hub, stand, gesendet, empfangen).await;
    sqlx::query("DELETE FROM einsatz_fuehrung WHERE kennung LIKE ?")
        .bind(format!("{}/{nach}-%", elw.kennung))
        .execute(&hub.pool)
        .await
        .unwrap();
    // Während des Ausfalls arbeitet der ELW weiter.
    let waehrend = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    nur_melden(&elw).await;
    assert!(has_akte(&hub, &elw, vor).await);
    assert!(has_akte(&hub, &elw, waehrend).await);
    assert!(
        has_akte(&hub, &elw, nach).await,
        "die verlorene Akte kommt erneut"
    );
}

#[tokio::test]
async fn antwort_hebt_den_zaehler_des_elw_genau_bis_zur_grenze() {
    // Review B6: Die meldende Seite hebt ihren Zähler auf eine Quittung bis `STAND_RAISE_MAX`,
    // darüber nicht.
    use lifeline_hub::instanz::fuehrung::austausch::STAND_RAISE_MAX;
    let (hub, elw) = gekoppelt().await;
    let quittiert = |wert: i64| {
        let pool = hub.pool.clone();
        async move {
            sqlx::query("UPDATE instanz_kopplung SET fuehrung_empfangen_bis = ?")
                .bind(wert)
                .execute(&pool)
                .await
                .unwrap();
        }
    };
    quittiert(STAND_RAISE_MAX + 1).await;
    nur_melden(&elw).await;
    let (_, _, stand) = staende(&elw).await;
    assert!(stand < STAND_RAISE_MAX, "{stand}");
    quittiert(STAND_RAISE_MAX).await;
    nur_melden(&elw).await;
    let (_, _, stand) = staende(&elw).await;
    assert_eq!(stand, STAND_RAISE_MAX);
    assert!(hinweis(&elw)
        .await
        .unwrap_or_default()
        .contains("zurückgespielt"));
}

#[tokio::test]
async fn zurueckgespielt_hub_erkennt_den_rueckschritt_auch_nach_verlorener_antwort() {
    // Zweiter Review, Befund B-1: Erreicht die Antwort mit der alten Quittung den ELW nicht, muss
    // die nächste Meldung den Rückschritt wieder zeigen; sonst kämen die verlorenen Akten nie.
    let (hub, elw) = gekoppelt().await;
    common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    let (stand, gesendet, empfangen): (i64, i64, i64) = sqlx::query_as(
        "SELECT i.fuehrung_stand, k.fuehrung_gesendet_bis, k.fuehrung_empfangen_bis \
         FROM instanz_identitaet i, instanz_kopplung k",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    let nach = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    nur_melden(&elw).await;
    zurueckspielen(&hub, stand, gesendet, empfangen).await;
    sqlx::query("DELETE FROM einsatz_fuehrung WHERE kennung LIKE ?")
        .bind(format!("{}/{nach}-%", elw.kennung))
        .execute(&hub.pool)
        .await
        .unwrap();
    common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let (elw_gesendet, _, _) = staende(&elw).await;
    nur_melden(&elw).await;
    // Die Antwort ging verloren: Der ELW behält seinen Sendestand.
    sqlx::query("UPDATE instanz_kopplung SET fuehrung_gesendet_bis = ?")
        .bind(elw_gesendet)
        .execute(&elw.pool)
        .await
        .unwrap();
    nur_melden(&elw).await;
    nur_melden(&elw).await;
    assert!(
        has_akte(&hub, &elw, nach).await,
        "die verlorene Akte kommt trotzdem erneut"
    );
}

// ── Einsatznummer beim Führungswechsel (LLH-1703, Spec `einsatznummer`) ──────────────────────

async fn nummer(i: &Instanz, einsatz: i64) -> String {
    sqlx::query_scalar("SELECT einsatznummer_intern FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

/// Dieselbe Nummer mit einer anderen laufenden Nummer (`E-2026-0001`, 3 → `E-2026-0003`).
fn mit_lfd(nummer: &str, lfd: u32) -> String {
    let (kopf, _) = nummer.rsplit_once('-').unwrap();
    format!("{kopf}-{lfd:04}")
}

/// Systemeinträge im ETB, die eine Umnummerierung festhalten.
async fn nummer_eintraege(i: &Instanz, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
         AND inhalt LIKE 'Neue Einsatznummer %' ORDER BY id",
    )
    .bind(einsatz)
    .fetch_all(&i.pool)
    .await
    .unwrap()
}

/// Fehler der letzten Meldung des ELW.
async fn meldefehler(elw: &Instanz) -> Option<String> {
    sqlx::query_scalar("SELECT letzter_fehler FROM instanz_kopplung")
        .fetch_one(&elw.pool)
        .await
        .unwrap()
}

/// Die empfangende Seite einer Übergabe wird im Abgleich zum Führer: Trägt sie die Nummer schon
/// selbst, bekommt der übernommene Einsatz eine freie, und die Meldung läuft weiter.
#[tokio::test]
async fn uebergabe_an_den_hub_bei_gleicher_einsatznummer() {
    let (hub, elw) = gekoppelt().await;
    let eigen = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let alt = nummer(&elw, e).await;
    assert_eq!(nummer(&hub, eigen).await, alt, "beide Seiten zählen ab 1");
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    assert_eq!(meldefehler(&elw).await, None, "die Meldung läuft durch");
    let h = einsatz_der_akte(&hub, akte).await;
    assert!(!ist_spiegel(&hub, h).await, "der Hub führt den Einsatz");
    let neu = mit_lfd(&alt, 2);
    assert_eq!(nummer(&hub, h).await, neu, "freie Nummer am Hub");
    assert_eq!(nummer(&hub, eigen).await, alt, "der eigene behält seine");
    let eintraege = nummer_eintraege(&hub, h).await;
    assert_eq!(eintraege.len(), 1, "{eintraege:?}");
    assert!(
        eintraege[0].contains(&neu) && eintraege[0].contains(&alt),
        "{eintraege:?}"
    );
    elw_meldet(&elw).await;
    assert_eq!(meldefehler(&elw).await, None);
    assert_eq!(
        nummer(&hub, h).await,
        neu,
        "eine zweite Meldung ändert nichts"
    );
    assert_eq!(nummer_eintraege(&hub, h).await.len(), 1);
    assert_eq!(nummer(&elw, e).await, neu, "der Spiegel am ELW folgt");
}

/// Gibt der ELW seinen ersten Einsatz ab und legt einen neuen an, trägt der wieder dieselbe
/// Nummer (Spiegel zählen nicht mit). Holt der ELW den ersten zurück, stoßen beide aufeinander.
#[tokio::test]
async fn anfrage_des_elw_bei_gleicher_einsatznummer() {
    let (hub, elw) = gekoppelt().await;
    let (e, _) = elw_einsatz(&hub, &elw).await;
    let alt = nummer(&elw, e).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    assert!(ist_spiegel(&elw, e).await);
    let zweiter = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    assert_eq!(
        nummer(&elw, zweiter).await,
        alt,
        "Voraussetzung: die Nummer des Spiegels ist wieder vergeben"
    );
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/anfragen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    assert_eq!(meldefehler(&elw).await, None, "die Meldung läuft durch");
    let a = fuehrung(&elw, e).await;
    assert_eq!(a["fuehrend"], true, "{a}");
    let neu = mit_lfd(&alt, 2);
    assert_eq!(nummer(&elw, e).await, neu, "freie Nummer am ELW");
    assert_eq!(nummer(&elw, zweiter).await, alt, "der neue behält seine");
    let eintraege = nummer_eintraege(&elw, e).await;
    assert_eq!(eintraege.len(), 1, "{eintraege:?}");
    assert!(
        eintraege[0].contains(&neu) && eintraege[0].contains(&alt),
        "{eintraege:?}"
    );
}

#[tokio::test]
async fn freie_nummer_bleibt_beim_fuehrungswechsel() {
    let (hub, elw) = gekoppelt().await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    let h = einsatz_der_akte(&hub, akte).await;
    assert!(!ist_spiegel(&hub, h).await);
    assert_eq!(nummer(&hub, h).await, nummer(&elw, e).await);
    assert!(nummer_eintraege(&hub, h).await.is_empty());
}

/// Widerspricht der ELW einer Notübernahme, fällt der Hub zum Spiegel zurück. Mit dem nächsten
/// Kopf des ELW trägt der Einsatz dort wieder dessen Nummer (ein Spiegel ist von der
/// Eindeutigkeit ausgenommen); der Systemeintrag zur Nummer ist eine Änderung, die der ELW nicht
/// kennt, und liegt in der Bruchstelle. Dass diese Bruchstelle danach nicht geklärt wird, ist
/// LLH-1854 und hier nicht geprüft.
#[tokio::test]
async fn nach_widerspruch_traegt_der_hub_spiegel_wieder_die_nummer_des_elw() {
    let (hub, elw) = gekoppelt().await;
    let eigen = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    let (e, akte) = elw_einsatz(&hub, &elw).await;
    let alt = nummer(&elw, e).await;
    hub_uebernimmt_mit_unterschrift(&hub, akte, "Probe").await;
    let h = einsatz_der_akte(&hub, akte).await;
    assert_eq!(nummer(&hub, h).await, mit_lfd(&alt, 2), "umnummeriert");
    elw_meldet(&elw).await;
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/fuehrung/widersprechen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        nummer(&elw, e).await,
        alt,
        "der ELW führt weiter mit seiner"
    );
    // Der ELW ändert den Kopf: Der Abgleich bringt ihn zum Hub.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/einsaetze/{e}"),
        &elw.admin,
        Some(&json!({"leitstellen_nr": "L-4711"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for _ in 0..2 {
        elw_meldet(&elw).await;
        assert_eq!(meldefehler(&elw).await, None, "die Meldung läuft durch");
    }
    assert!(ist_spiegel(&hub, h).await, "der Hub spiegelt wieder");
    assert_eq!(nummer(&hub, h).await, alt, "Nummer des ELW");
    assert_eq!(nummer(&hub, eigen).await, alt, "der eigene unberührt");
    let gesichert: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ? AND art = 'etb_eintrag'",
    )
    .bind(h)
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert_eq!(gesichert, 1, "der Systemeintrag zur Nummer ist gesichert");
}

// ── Größe der Erklärung (LLH-1702) ───────────────────────────────────────────────────────────

/// Größte Erklärung, die das Gegenüber an einer Akte annimmt (`austausch::ERKLAERUNG_MAX`, dort
/// nicht öffentlich). Die Tests rechnen bewusst mit der Zahl der Spec `instanz-fuehrung`: ändert
/// jemand die Konstante, fällt der Unterschied hier auf.
const ERKLAERUNG_BYTES: usize = 4096;

/// Byte eines Texts in JSON, ohne die Anführungszeichen (Steuerzeichen als `\u00XX`).
fn json_bytes(s: &str) -> usize {
    serde_json::to_string(s).unwrap().len() - 2
}

/// Ein Grund, der in JSON genau `bytes` Byte braucht: Steuerzeichen (je sechs Byte) zwischen
/// ASCII-Rändern, damit das Trimmen des Servers nichts wegnimmt. Höchstens 500 Zeichen.
fn grund_mit_bytes(bytes: usize) -> String {
    let steuer = bytes.saturating_sub(500).div_ceil(5);
    let ascii = bytes - steuer * 6;
    assert!(
        ascii >= 2 && steuer + ascii <= 500,
        "{bytes} Byte passen nicht in einen Grund"
    );
    let g = format!("a{}{}", "\u{1}".repeat(steuer), "b".repeat(ascii - 1));
    assert_eq!(json_bytes(&g), bytes);
    g
}

async fn set_anzeigename(i: &Instanz, name: &str) {
    sqlx::query("UPDATE benutzer SET anzeigename = ? WHERE benutzername = 'admin'")
        .bind(name)
        .execute(&i.pool)
        .await
        .unwrap();
}

async fn erklaerung_der_akte(i: &Instanz, akte: i64) -> Option<String> {
    sqlx::query_scalar("SELECT erklaerung FROM einsatz_fuehrung WHERE id = ?")
        .bind(akte)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

async fn verlauf_zahl(i: &Instanz, akte: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fuehrung_verlauf WHERE fuehrung_id = ?")
        .bind(akte)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

/// Spec „Die Erklärung einer Notübernahme passt in die Grenze des Gegenübers“, gegen die
/// erreichte Seite: ein Byte über der Grenze ist 422 und ändert nichts, genau an der Grenze gilt
/// die Übernahme und der Hub nimmt die Akte an. Die Länge der übrigen Erklärung liest der Test
/// an einer ersten Übernahme ab (zweiter Einsatz, gleiche Epoche, gleich lange Kennung).
#[tokio::test]
async fn erklaerung_ueber_der_grenze_ist_422_und_genau_an_der_grenze_gilt_sie() {
    let (hub, elw) = gekoppelt().await;
    // Ein Name aus Steuerzeichen an der Namensgrenze: ohne ihn reichte kein Grund an die 4096.
    set_anzeigename(&elw, &"\u{1}".repeat(lifeline_hub::auth::ANZEIGENAME_MAX)).await;
    common::einsatz_anlegen(&hub.app, &hub.admin).await;
    let h2 = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akten = fremde(&elw).await;
    assert_eq!(akten.len(), 2);
    // Beide Seiten nennen die Akte bei derselben Kennung; `ziel` ist die Akte von `h2`.
    let kennung = fuehrung(&hub, h2).await["kennung"].clone();
    let ist_ziel = |a: &&Value| a["kennung"] == kennung;
    let ziel = akten
        .iter()
        .find(ist_ziel)
        .expect("Akte des zweiten Einsatzes");
    let sonde = akten.iter().find(|a| !ist_ziel(a)).unwrap();
    let (sonde_id, ziel_id) = (sonde["id"].as_i64().unwrap(), ziel["id"].as_i64().unwrap());
    assert_eq!(
        sonde["kennung"].as_str().unwrap().len(),
        ziel["kennung"].as_str().unwrap().len(),
        "sonst stimmt die abgelesene Länge nicht"
    );

    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{sonde_id}/notuebernahme"),
        json!({"grund": "Sonde"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let rest = erklaerung_der_akte(&elw, sonde_id).await.unwrap().len() - json_bytes("Sonde");

    let vorher = verlauf_zahl(&elw, ziel_id).await;
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{ziel_id}/notuebernahme"),
        json!({"grund": grund_mit_bytes(ERKLAERUNG_BYTES + 1 - rest)}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Grund kürzen"), "{v}");
    let danach = fremde(&elw).await;
    let akte = danach.iter().find(|a| a["id"] == ziel_id).unwrap();
    assert_eq!(akte["fuehrer_kennung"], hub.kennung, "Führung bleibt");
    assert_eq!(akte["fuehrend"], false);
    assert_eq!(erklaerung_der_akte(&elw, ziel_id).await, None);
    assert_eq!(verlauf_zahl(&elw, ziel_id).await, vorher, "kein Eintrag");

    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{ziel_id}/notuebernahme"),
        json!({"grund": grund_mit_bytes(ERKLAERUNG_BYTES - rest)}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["fuehrend"], true);
    assert_eq!(
        erklaerung_der_akte(&elw, ziel_id).await.unwrap().len(),
        ERKLAERUNG_BYTES
    );
    elw_meldet(&elw).await;
    let f = fuehrung(&hub, h2).await;
    assert_eq!(
        f["fuehrer_kennung"], elw.kennung,
        "der Hub nimmt die Akte an"
    );
    assert_eq!(f["art"], "notuebernahme");
}

/// Ein Konto mit Bestandsnamen weit über der Grenze kann im Notfall übernehmen: die Erklärung
/// nennt die ersten 200 Zeichen, und die Akte kommt beim Hub an (vor LLH-1702 blieb sie liegen,
/// und beide Seiten hielten sich für die führende Instanz).
#[tokio::test]
async fn langer_bestandsname_wird_in_der_erklaerung_gekuerzt_und_der_hub_nimmt_an() {
    let (hub, elw) = gekoppelt().await;
    let max = lifeline_hub::auth::ANZEIGENAME_MAX;
    let name = format!("{}{}", "Ä".repeat(max), "x".repeat(3000 - max));
    set_anzeigename(&elw, &name).await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akte = fremde(&elw).await[0]["id"].as_i64().unwrap();
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme"),
        json!({"grund": "Hub ohne Verbindung"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let erklaerung: Value =
        serde_json::from_str(&erklaerung_der_akte(&elw, akte).await.unwrap()).unwrap();
    assert_eq!(erklaerung["unterzeichner"], "Ä".repeat(max));
    elw_meldet(&elw).await;
    assert_eq!(fuehrung(&hub, h).await["fuehrer_kennung"], elw.kennung);
}

/// Dasselbe am Hub: was der Admin unterschreibt, nennt schon den gekürzten Namen.
#[tokio::test]
async fn langer_bestandsname_am_hub_steht_gekuerzt_in_der_erklaerung_zur_unterschrift() {
    let (hub, elw) = gekoppelt().await;
    let max = lifeline_hub::auth::ANZEIGENAME_MAX;
    set_anzeigename(
        &hub,
        &format!("{}{}", "Ä".repeat(max), "x".repeat(3000 - max)),
    )
    .await;
    let (_, akte) = elw_einsatz(&hub, &elw).await;
    let v = hub_uebernimmt_mit_unterschrift(&hub, akte, "ELW ohne Verbindung seit 40 min").await;
    assert_eq!(v["fuehrend"], true);
    let erklaerung: Value =
        serde_json::from_str(&erklaerung_der_akte(&hub, akte).await.unwrap()).unwrap();
    assert_eq!(erklaerung["unterzeichner"], "Ä".repeat(max));
}

/// Gegen die meldende Seite: mit Unterschrift antwortet schon der Beginn mit 422 (nichts liegt
/// zum Unterschreiben vor), mit Code der Aufruf selbst; die Führung bleibt beim ELW. Genau an
/// der Grenze geht die Unterschrift durch.
#[tokio::test]
async fn zu_grosse_erklaerung_am_hub_ist_422_vor_unterschrift_und_mit_code() {
    let (hub, elw) = gekoppelt().await;
    set_anzeigename(&hub, &"\u{1}".repeat(lifeline_hub::auth::ANZEIGENAME_MAX)).await;
    let (_, akte) = elw_einsatz(&hub, &elw).await;
    let start = format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/start");

    let (s, sonde) = post(&hub, &start, json!({"grund": "Sonde"})).await;
    assert_eq!(s, StatusCode::OK, "{sonde}");
    let rest = sonde["erklaerung"].as_str().unwrap().len() - json_bytes("Sonde");
    let zu_gross = grund_mit_bytes(ERKLAERUNG_BYTES + 1 - rest);
    let vorher = verlauf_zahl(&hub, akte).await;

    let (s, v) = post(&hub, &start, json!({"grund": zu_gross})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Grund kürzen"), "{v}");

    let (s, v) = post(
        &hub,
        &format!("/api/admin/instanz/fuehrung/{akte}/notuebernahme/code"),
        json!({"grund": zu_gross, "code": "2345 6789 ABCD EFGH"}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Grund kürzen"), "{v}");

    let f = &fremde(&hub).await[0];
    assert_eq!(f["fuehrer_kennung"], elw.kennung, "Führung bleibt beim ELW");
    assert_eq!(verlauf_zahl(&hub, akte).await, vorher, "kein Eintrag");

    let v = hub_uebernimmt_mit_unterschrift(&hub, akte, &grund_mit_bytes(ERKLAERUNG_BYTES - rest))
        .await;
    assert_eq!(v["fuehrend"], true);
    assert_eq!(
        erklaerung_der_akte(&hub, akte).await.unwrap().len(),
        ERKLAERUNG_BYTES
    );
}

/// Der Vollzug prüft den endgültigen Text selbst (design.md D4 der Change
/// `a13nxa2k-notuebernahme-erklaerung-begrenzen`): Über die Routen erreicht ihn kein zu großer
/// Text, weil schon das Bauen ablehnt und die Kennungen gleich lang sind. Deshalb direkt, mit
/// einer Erklärung, die nach dem Bauen gewachsen ist.
#[tokio::test]
async fn vollzug_gegen_die_meldende_seite_lehnt_eine_zu_grosse_erklaerung_selbst_ab() {
    use lifeline_hub::error::AppError;
    use lifeline_hub::instanz::fuehrung::dienst;
    use lifeline_hub::instanz::fuehrung::erklaerung::FuehrungBeweis;
    use lifeline_hub::instanz::fuehrung::repo::AkteRef;

    let (hub, elw) = gekoppelt().await;
    let (_, akte) = elw_einsatz(&hub, &elw).await;
    let kennung = fremde(&hub).await[0]["kennung"]
        .as_str()
        .unwrap()
        .to_string();
    let ref_ = AkteRef {
        id: akte,
        kennung: &kennung,
    };
    let mut e = dienst::build_erklaerung_gegen_meldende(&hub.pool, ref_, "Sonde", "Erika")
        .await
        .unwrap();
    e.grund = "g".repeat(ERKLAERUNG_BYTES);
    let vorher = verlauf_zahl(&hub, akte).await;

    let ergebnis = dienst::notuebernahme_gegen_meldende(
        &hub.pool,
        ref_,
        &e,
        &FuehrungBeweis::Code {
            pruefwert: "p".into(),
        },
        "Erika",
    )
    .await;
    assert!(
        matches!(ergebnis, Err(AppError::UnprocessableEntity(_))),
        "erwartet 422"
    );
    let f = &fremde(&hub).await[0];
    assert_eq!(f["fuehrer_kennung"], elw.kennung, "Führung bleibt beim ELW");
    assert_eq!(erklaerung_der_akte(&hub, akte).await, None);
    assert_eq!(verlauf_zahl(&hub, akte).await, vorher, "kein Eintrag");
}

// ── Akten ohne Spiegel enden mit dem Einsatz beim Gegenüber (LLH-1699) ───────────────────────
//
// Change `h7shm5au-loeschsignal-spiegellose-akten`: Wer eine Akte ohne lokalen Einsatz hält, nennt
// ihre Kennung im Abgleich; das Gegenüber meldet `geloescht` nur mit Beleg (Löschprotokoll oder
// Löschvermerk). Die erreichte Seite reicht das Ende an weitere meldende Seiten weiter (D4), der
// Widerruf entfernt die Akten des widerrufenen Gegenübers (D5).

async fn abschliessen(i: &Instanz, einsatz: i64) {
    let (s, v) = common::anfrage(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Ein Einsatz an `i`, abgeschlossen vor dem ersten Abgleich: Kein Gegenüber spiegelt ihn, es
/// bekommt nur die Akte. Liefert Einsatz und Kennung.
async fn abgeschlossen_ohne_spiegel(i: &Instanz) -> (i64, String) {
    let e = common::einsatz_anlegen(&i.app, &i.admin).await;
    abschliessen(i, e).await;
    // Die Akte (und mit ihr die Kennung) entsteht beim Lesen der Führung.
    fuehrung(i, e).await;
    let kennung: String = sqlx::query_scalar("SELECT kennung FROM einsatz WHERE id = ?")
        .bind(e)
        .fetch_one(&i.pool)
        .await
        .unwrap();
    (e, kennung)
}

/// Löscht einen eigenen Einsatz so, wie es die Aufbewahrung tut: Protokollzeile, Vermerk, weg.
async fn endgueltig_loeschen(i: &Instanz, einsatz: i64) {
    use lifeline_hub::einsatz::abraeumen::{self, AbraeumArt};
    let mut tx = i.pool.begin().await.unwrap();
    abraeumen::vormerken(&mut tx, einsatz, AbraeumArt::Verwahrt, None)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(abraeumen::ausfuehren(&i.pool, None, einsatz).await.unwrap());
}

/// Kennungen unter „Einsätze beim Gegenüber“ an einer Instanz.
async fn beim_gegenueber(i: &Instanz) -> Vec<String> {
    let mut k: Vec<String> = fremde(i)
        .await
        .iter()
        .map(|a| a["kennung"].as_str().unwrap().to_string())
        .collect();
    k.sort();
    k
}

async fn hat_spiegel(i: &Instanz, kennung: &str) -> bool {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM einsatz WHERE kennung = ?)")
        .bind(kennung)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

async fn vermerkt(i: &Instanz, kennung: &str) -> bool {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM fuehrung_loeschvermerk WHERE kennung = ?)")
        .bind(kennung)
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn akte_ohne_spiegel_am_elw_endet_wenn_der_hub_den_einsatz_loescht() {
    let (hub, elw) = gekoppelt().await;
    let (e, k) = abgeschlossen_ohne_spiegel(&hub).await;
    let (_, bleibt) = abgeschlossen_ohne_spiegel(&hub).await;
    elw_meldet(&elw).await;
    let mut beide = vec![k.clone(), bleibt.clone()];
    beide.sort();
    assert_eq!(beim_gegenueber(&elw).await, beide);
    assert!(!hat_spiegel(&elw, &k).await, "nie gespiegelt");

    // Solange der Hub den Einsatz hält, bleibt die Akte.
    abgleichen(&elw).await;
    assert_eq!(beim_gegenueber(&elw).await, beide);

    endgueltig_loeschen(&hub, e).await;
    abgleichen(&elw).await;

    assert_eq!(
        beim_gegenueber(&elw).await,
        vec![bleibt],
        "nur der gelöschte Einsatz fällt heraus"
    );
    assert!(vermerkt(&elw, &k).await, "der ELW hält das Ende fest");
}

#[tokio::test]
async fn akte_ohne_spiegel_am_hub_endet_wenn_der_elw_den_einsatz_loescht() {
    let (hub, elw) = gekoppelt().await;
    let (e, k) = abgeschlossen_ohne_spiegel(&elw).await;
    let (_, bleibt) = abgeschlossen_ohne_spiegel(&elw).await;
    elw_meldet(&elw).await;
    let mut beide = vec![k.clone(), bleibt.clone()];
    beide.sort();
    assert_eq!(beim_gegenueber(&hub).await, beide);
    assert!(!hat_spiegel(&hub, &k).await, "nie gespiegelt");

    endgueltig_loeschen(&elw, e).await;
    abgleichen(&elw).await;

    assert_eq!(beim_gegenueber(&hub).await, vec![bleibt]);
    assert!(vermerkt(&hub, &k).await, "der Hub hält das Ende fest");
}

/// Eine Instanz, die aus einer Sicherung zurückkehrt, kennt den Einsatz nicht mehr, hat aber auch
/// keinen Beleg für sein Ende: Sie meldet nichts, die Akte beim Gegenüber bleibt.
#[tokio::test]
async fn akte_ohne_spiegel_bleibt_wenn_dem_gegenueber_der_beleg_fehlt() {
    let (hub, elw) = gekoppelt().await;
    let (e, k) = abgeschlossen_ohne_spiegel(&hub).await;
    elw_meldet(&elw).await;
    assert_eq!(beim_gegenueber(&elw).await, vec![k.clone()]);

    // Der Einsatz fehlt am Hub ohne Löschprotokoll und ohne Vermerk.
    sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(e)
        .execute(&hub.pool)
        .await
        .unwrap();
    assert!(!hat_spiegel(&hub, &k).await);
    abgleichen(&elw).await;

    assert_eq!(beim_gegenueber(&elw).await, vec![k]);
}

/// Hub mit zwei ELW; „ELW 1“ führt einen abgeschlossenen Einsatz, den der Hub und „ELW 2“ nur als
/// Akte kennen. Liefert (Hub, ELW 1, ELW 2, Einsatz an ELW 1, Kennung).
async fn zwei_elw_mit_akte_von_elw1() -> (Instanz, Instanz, Instanz, i64, String) {
    let (hub, elw1) = gekoppelt().await;
    let elw2 = weiterer_elw(&hub).await;
    let (e, k) = abgeschlossen_ohne_spiegel(&elw1).await;
    elw_meldet(&elw1).await;
    elw_meldet(&elw2).await;
    assert_eq!(beim_gegenueber(&hub).await, vec![k.clone()]);
    assert_eq!(
        beim_gegenueber(&elw2).await,
        vec![k.clone()],
        "der Hub reicht die Akte weiter"
    );
    assert!(!hat_spiegel(&elw2, &k).await);
    (hub, elw1, elw2, e, k)
}

#[tokio::test]
async fn zwei_elw_loescht_die_eine_verliert_auch_die_andere_die_akte_ueber_den_hub() {
    let (hub, elw1, elw2, e, k) = zwei_elw_mit_akte_von_elw1().await;

    endgueltig_loeschen(&elw1, e).await;
    // Solange der Hub die Akte hält, belegt er nichts.
    abgleichen(&elw2).await;
    assert_eq!(beim_gegenueber(&elw2).await, vec![k.clone()]);

    abgleichen(&elw1).await;
    assert!(beim_gegenueber(&hub).await.is_empty(), "erst der Hub");
    assert!(vermerkt(&hub, &k).await);
    abgleichen(&elw2).await;
    assert!(beim_gegenueber(&elw2).await.is_empty(), "dann ELW 2");
}

/// Der Hub spiegelt den Einsatz der „ELW 1“, „ELW 2“ kennt ihn nur als Akte. Löscht „ELW 1“ ihn,
/// räumt der Hub seinen Spiegel ab und hält das Ende fest; „ELW 2“ verliert die Akte.
#[tokio::test]
async fn zwei_elw_loescht_die_eine_einen_am_hub_gespiegelten_einsatz_verliert_die_andere_die_akte()
{
    let (hub, elw1) = gekoppelt().await;
    let elw2 = weiterer_elw(&hub).await;
    let e = common::einsatz_anlegen(&elw1.app, &elw1.admin).await;
    elw_meldet(&elw1).await;
    abschliessen(&elw1, e).await;
    elw_meldet(&elw1).await;
    let k: String = sqlx::query_scalar("SELECT kennung FROM einsatz WHERE id = ?")
        .bind(e)
        .fetch_one(&elw1.pool)
        .await
        .unwrap();
    assert!(hat_spiegel(&hub, &k).await, "am Hub gespiegelt");
    elw_meldet(&elw2).await;
    assert_eq!(beim_gegenueber(&elw2).await, vec![k.clone()]);
    assert!(!hat_spiegel(&elw2, &k).await);

    endgueltig_loeschen(&elw1, e).await;
    abgleichen(&elw1).await;
    assert!(!hat_spiegel(&hub, &k).await, "Spiegel am Hub abgeräumt");
    assert!(vermerkt(&hub, &k).await);
    abgleichen(&elw2).await;

    assert!(beim_gegenueber(&elw2).await.is_empty());
}

/// Der Hub übernimmt einen Einsatz der „ELW 1“ zur Verwahrung und löscht ihn später endgültig.
/// Die Kennung beginnt mit der der ELW 1; den Beleg für „ELW 2“ trägt der Löschvermerk.
#[tokio::test]
async fn zwei_elw_loescht_der_hub_einen_verwahrten_einsatz_verliert_die_andere_die_akte() {
    let (hub, elw1) = gekoppelt().await;
    let elw2 = weiterer_elw(&hub).await;
    let e = common::einsatz_anlegen(&elw1.app, &elw1.admin).await;
    elw_meldet(&elw1).await;
    abschliessen(&elw1, e).await;
    elw_meldet(&elw1).await;
    let k: String = sqlx::query_scalar("SELECT kennung FROM einsatz WHERE id = ?")
        .bind(e)
        .fetch_one(&elw1.pool)
        .await
        .unwrap();
    assert!(k.starts_with(&format!("{}/", elw1.kennung)));
    sqlx::query("UPDATE einsatz SET nachbereitung_bis = '2000-01-01 00:00:00' WHERE id = ?")
        .bind(e)
        .execute(&elw1.pool)
        .await
        .unwrap();
    abgleichen(&elw1).await;
    let (am_hub, spiegel): (i64, bool) =
        sqlx::query_as("SELECT id, spiegel FROM einsatz WHERE kennung = ?")
            .bind(&k)
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert!(!spiegel, "am Hub verwahrt: ein eigener Einsatz");
    assert!(!hat_spiegel(&elw1, &k).await, "am ELW 1 abgeräumt");
    elw_meldet(&elw2).await;
    assert_eq!(beim_gegenueber(&elw2).await, vec![k.clone()]);
    assert!(!hat_spiegel(&elw2, &k).await);

    endgueltig_loeschen(&hub, am_hub).await;
    abgleichen(&elw2).await;

    assert!(
        beim_gegenueber(&elw2).await.is_empty(),
        "Beleg trotz fremdem Präfix"
    );
}

async fn kopplung_widerrufen(i: &Instanz, gegenueber: &Instanz) {
    let id: i64 =
        sqlx::query_scalar("SELECT id FROM instanz_kopplung WHERE gegenueber_kennung = ?")
            .bind(&gegenueber.kennung)
            .fetch_one(&i.pool)
            .await
            .unwrap();
    let (s, v) = post(
        i,
        &format!("/api/admin/instanz/kopplungen/{id}/widerrufen"),
        json!({}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

#[tokio::test]
async fn widerruf_einer_von_zwei_elw_entfernt_ihre_akten_am_hub_und_an_der_anderen() {
    let (hub, elw1, elw2, _e, k1) = zwei_elw_mit_akte_von_elw1().await;
    let (_, k2) = abgeschlossen_ohne_spiegel(&elw2).await;
    elw_meldet(&elw2).await;
    let mut beide = vec![k1.clone(), k2.clone()];
    beide.sort();
    assert_eq!(beim_gegenueber(&hub).await, beide);

    kopplung_widerrufen(&hub, &elw1).await;

    assert_eq!(
        beim_gegenueber(&hub).await,
        vec![k2],
        "nur noch die Einsätze der ELW 2"
    );
    assert!(vermerkt(&hub, &k1).await);
    abgleichen(&elw2).await;
    assert!(
        beim_gegenueber(&elw2).await.is_empty(),
        "ELW 2 verliert die Akte der widerrufenen ELW 1"
    );
}

/// Nach Widerruf und neuer Kopplung legt das Gegenüber seine Akten neu auf; der alte Vermerk
/// belegt nichts mehr, solange die Akte wieder steht.
#[tokio::test]
async fn nach_neuer_kopplung_stehen_die_akten_wieder_und_bleiben() {
    let (hub, elw1, elw2, _e, k1) = zwei_elw_mit_akte_von_elw1().await;
    kopplung_widerrufen(&hub, &elw1).await;
    abgleichen(&elw2).await;
    assert!(beim_gegenueber(&hub).await.is_empty());
    assert!(beim_gegenueber(&elw2).await.is_empty());
    // ELW 1 erfährt den Widerruf mit ihrer nächsten Meldung und koppelt neu.
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw1.pool)
        .await
        .unwrap();
    let _ = lifeline_hub::instanz::melden::run_durchlauf(&elw1.pool).await;
    let zustand: String = sqlx::query_scalar("SELECT zustand FROM instanz_kopplung")
        .fetch_one(&elw1.pool)
        .await
        .unwrap();
    assert_eq!(zustand, "vom_gegenueber_widerrufen");
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        "/api/admin/instanz/codes",
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = common::anfrage_json(
        &elw1.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw1.admin,
        Some(&json!({"adresse": hub.adresse, "code": v["code"]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    elw_meldet(&elw1).await;
    assert_eq!(beim_gegenueber(&hub).await, vec![k1.clone()]);
    assert!(vermerkt(&hub, &k1).await, "der alte Vermerk steht noch");
    elw_meldet(&elw2).await;
    assert_eq!(beim_gegenueber(&elw2).await, vec![k1.clone()]);

    // Der Vermerk belegt nichts, solange der Hub die Akte wieder hält.
    abgleichen(&elw2).await;
    abgleichen(&elw1).await;
    assert_eq!(beim_gegenueber(&elw2).await, vec![k1.clone()]);
    assert_eq!(beim_gegenueber(&hub).await, vec![k1]);
}
