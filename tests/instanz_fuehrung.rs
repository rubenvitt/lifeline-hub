//! Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`): zwei echte Instanzen im selben
//! Testprozess, je mit eigener DB und eigenem HTTP-Server auf Loopback. „Hub“ stellt den Code aus,
//! „ELW“ löst ihn ein und meldet sich. Beide haben den Schalter `LIFELINE_FUEHRUNG` an, außer im
//! Test dazu.

mod common;

use axum::http::StatusCode;
use lifeline_hub::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use lifeline_hub::auth::unterschrift::repo as unterschrift;
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
    elw_meldet(&elw).await;
    let f = fuehrung(&elw, e).await;
    assert_eq!(f["fuehrend"], true, "der ELW gibt nie still ab");
    assert_eq!(f["offen"]["grund"], "ELW ohne Verbindung seit 40 min");
    assert_eq!(f["offen"]["epoche"], 2);
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
    assert!(v["bruch_at"].as_str().is_some());
    let verlauf = v["verlauf"].as_array().unwrap();
    let letzter = verlauf.last().unwrap();
    assert_eq!(letzter["art"], "bestaetigt");
    assert!(letzter["bruch_at"].as_str().is_some());
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

// ── Gleichstand ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn gleichstand_entscheidet_die_groessere_kennung_an_beiden_seiten() {
    let (hub, elw) = gekoppelt().await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    elw_meldet(&elw).await;
    let akte_elw = fremde(&elw).await[0]["id"].as_i64().unwrap();
    // Ohne Verbindung: der ELW übernimmt gegen den Hub (Zähler 2) …
    sqlx::query("UPDATE instanz_kopplung SET gegenueber_adresse = 'http://127.0.0.1:9'")
        .execute(&elw.pool)
        .await
        .unwrap();
    let (s, _) = post(
        &elw,
        &format!("/api/admin/instanz/fuehrung/{akte_elw}/notuebernahme"),
        json!({"grund": "Hub weg"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // … und am Hub entsteht unabhängig davon ebenfalls eine Epoche mit Zähler 2.
    let stand: i64 = sqlx::query_scalar(
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1 \
         RETURNING fuehrung_stand",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE einsatz_fuehrung SET epoche_zaehler = 2, epoche_instanz = ?, stand = ? \
         WHERE einsatz_id = ?",
    )
    .bind(&hub.kennung)
    .bind(stand)
    .bind(h)
    .execute(&hub.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE instanz_kopplung SET gegenueber_adresse = ?")
        .bind(&hub.adresse)
        .execute(&elw.pool)
        .await
        .unwrap();
    elw_meldet(&elw).await;
    elw_meldet(&elw).await;
    let am_hub = fuehrung(&hub, h).await;
    let am_elw = &fuehrung(&elw, einsatz_der_akte(&elw, akte_elw).await).await;
    assert_eq!(
        am_hub["fuehrer_kennung"], am_elw["fuehrer_kennung"],
        "beide Seiten einig: {am_hub} / {am_elw}"
    );
    assert_eq!(am_hub["epoche"], am_elw["epoche"]);
    if elw.kennung > hub.kennung {
        // (2, ELW) ist größer: der Hub nimmt sie an.
        assert_eq!(am_hub["fuehrer_kennung"], elw.kennung);
        assert_eq!(am_hub["epoche"], 2);
    } else {
        // (2, Hub) ist größer, aber ohne Unterschrift: der ELW verwirft sie und führt mit 3.
        assert_eq!(am_hub["fuehrer_kennung"], elw.kennung);
        assert_eq!(am_hub["epoche"], 3);
        assert_eq!(am_elw["art"], "verworfen");
    }
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

#[tokio::test]
async fn ein_elw_nimmt_einem_anderen_elw_die_fuehrung_nicht() {
    let (hub, elw1) = gekoppelt().await;
    // Zweiter ELW derselben Hub-Org.
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
