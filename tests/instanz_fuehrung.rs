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

async fn elw_meldet(elw: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::melden::run_durchlauf(&elw.pool)
        .await
        .unwrap();
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
               "anhang_ids": []}),
    )
    .await
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
    assert_eq!(s, StatusCode::OK, "auch nach dem Abschluss: {v}");
    assert_eq!(v["fuehrend"], false);
    assert_eq!(v["epoche"], 2);
    elw_meldet(&elw).await;
    let h = fremde(&hub).await;
    let a = h.iter().find(|a| a["id"] == akte).unwrap();
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
    let (s, v) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(v["error"]
        .as_str()
        .unwrap()
        .starts_with("Führung liegt bei"));
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
    let a = &fremde(&elw).await[0];
    assert_eq!(a["fuehrend"], true, "{a}");
    assert_eq!(a["epoche"], 2);
    assert_eq!(a["anfrage_offen"], false);
    let f = fuehrung(&hub, h).await;
    assert_eq!(f["fuehrend"], false);
    assert_eq!(f["fuehrer_kennung"], elw.kennung);
    assert_eq!(f["art"], "anfrage");
    let (s, _) = etb(&hub, h).await;
    assert_eq!(s, StatusCode::CONFLICT, "der Hub schreibt nicht mehr");
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
    let (s, _) = etb(&elw, e).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(aktionen(&elw.pool)
        .await
        .contains(&"fuehrung_notuebernahme".to_string()));
    elw_meldet(&elw).await;
    let a = &fremde(&hub).await[0];
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
    let (s, _) = etb(&elw, e).await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "ab dem Code schreibt der ELW nicht mehr"
    );
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
    let am_elw = &fremde(&elw).await[0];
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
