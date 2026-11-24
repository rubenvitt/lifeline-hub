//! Mitarbeit nach einem Führungswechsel an eine ältere Instanz nachtragen (LLH-2007, Design
//! `docs/superpowers/specs/2026-11-22-s110uic4-mitarbeit-nachtrag-fuehrer-design.md`): zwei echte
//! Instanzen mit Führung im selben Testprozess, Rückgabe und Notübernahme über die Routen.
//!
//! „Älter“ heißt hier: Die Instanzen nennen die Fähigkeit `rolle_mitarbeit` nicht
//! (`melden::rolle_mitarbeit_fuer_tests(false)`), bis sie „aufgerüstet“ werden. Der Schalter gilt
//! prozessweit, deshalb ein eigenes Test-Binary und die Tests nacheinander.

mod common;

use axum::http::StatusCode;
use lifeline_hub::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use lifeline_hub::auth::unterschrift::repo as unterschrift;
use lifeline_hub::instanz::melden::rolle_mitarbeit_fuer_tests;
use serde_json::{json, Value};

const RP: &str = "hub.example.org";
const ORIGIN: &str = "https://hub.example.org";

static NACHEINANDER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
    let (app, pool) = common::setup_mit_pool().await;
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

/// Hub mit Unterschriftsschlüssel stellt den Code aus, der ELW löst ihn ein und meldet sich
/// künftig.
async fn gekoppelt() -> (Instanz, Instanz) {
    let hub = instanz().await;
    let elw = instanz().await;
    // Eine Kopplung verlangt einen Admin-Schlüssel der Org (wie `tests/instanz_fuehrung.rs`).
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

/// Nur melden (Fähigkeiten, Stammdaten, Akten), ohne Abgleich der Einsätze.
async fn melden(elw: &Instanz) {
    sqlx::query("UPDATE instanz_kopplung SET naechste_meldung_at = NULL")
        .execute(&elw.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::melden::run_durchlauf(&elw.pool)
        .await
        .unwrap();
}

/// Zwei Runden Abgleich der Einsätze, vom ELW aus.
async fn abgleichen(elw: &Instanz) {
    for _ in 0..2 {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    }
}

async fn elw_meldet(elw: &Instanz) {
    melden(elw).await;
    abgleichen(elw).await;
}

async fn post(i: &Instanz, pfad: &str, body: Value) -> (StatusCode, Value) {
    common::anfrage_json(&i.app, "POST", pfad, &i.admin, Some(&body)).await
}

/// Konto „Erika“ am Hub; der ELW bekommt es mit den Stammdaten. Liefert (Hub, ELW).
async fn erika(hub: &Instanz, elw: &Instanz) -> (i64, i64) {
    let (s, v) = common::anfrage_json(
        &hub.app,
        "POST",
        "/api/users",
        &hub.admin,
        Some(&json!({"anzeigename": "Erika", "benutzername": "erika",
                     "passwort": "erika-pw-12345", "org_rolle": "keine"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let am_hub = v["id"].as_i64().unwrap();
    melden(elw).await;
    let am_elw: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'erika'")
        .fetch_one(&elw.pool)
        .await
        .unwrap();
    (am_hub, am_elw)
}

async fn mitglied(i: &Instanz, einsatz: i64, benutzer: i64, rolle: &str, stelle: Option<&str>) {
    let (s, v) = common::anfrage(
        &i.app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/members/{benutzer}"),
        &i.admin,
        Some(
            &json!({"einsatz_rolle": rolle, "fuehrungsfunktion": null, "fuehrungsstelle": stelle})
                .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Die Rolle von Erika in dem (einzigen) Einsatz einer Instanz.
async fn rolle(i: &Instanz) -> String {
    sqlx::query_scalar(
        "SELECT m.einsatz_rolle FROM einsatz_mitgliedschaft m \
         JOIN benutzer b ON b.id = m.benutzer_id WHERE b.benutzername = 'erika'",
    )
    .fetch_one(&i.pool)
    .await
    .unwrap()
}

async fn ausgang(i: &Instanz) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM mitarbeit_nachtrag")
        .fetch_one(&i.pool)
        .await
        .unwrap()
}

/// Der ELW (neu) führt mit Erika als Mitarbeit und gibt die Führung an den älteren Hub zurück.
/// Danach führt der Hub mit `beobachter`, der ELW hält `mitarbeit` fest.
async fn rueckgabe_an_den_alten_hub() -> (Instanz, Instanz, i64) {
    rolle_mitarbeit_fuer_tests(false);
    let (hub, elw) = gekoppelt().await;
    let (_, erika_elw) = erika(&hub, &elw).await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    mitglied(&elw, e, erika_elw, "mitarbeit", None).await;
    elw_meldet(&elw).await;
    assert_eq!(
        rolle(&hub).await,
        "beobachter",
        "der ältere Hub kennt die Rolle nicht"
    );
    let (s, v) = post(
        &elw,
        &format!("/api/einsaetze/{e}/command/hand-over"),
        json!({"an": hub.kennung}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    elw_meldet(&elw).await;
    assert_eq!(rolle(&hub).await, "beobachter");
    assert_eq!(
        rolle(&elw).await,
        "mitarbeit",
        "der ELW hält die Mitarbeit fest"
    );
    let hub_einsatz: i64 = sqlx::query_scalar("SELECT id FROM einsatz WHERE spiegel = 0")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    (hub, elw, hub_einsatz)
}

#[tokio::test]
async fn rueckgabe_an_alte_instanz_traegt_mitarbeit_nach() {
    let _nacheinander = NACHEINANDER.lock().await;
    let (hub, elw, _) = rueckgabe_an_den_alten_hub().await;
    // Beide rüsten auf.
    rolle_mitarbeit_fuer_tests(true);
    elw_meldet(&elw).await;
    assert_eq!(
        rolle(&hub).await,
        "mitarbeit",
        "der Hub trägt die Mitarbeit nach"
    );
    assert_eq!(rolle(&elw).await, "mitarbeit");
    assert_eq!(ausgang(&elw).await, 0, "quittiert");
    // Weitere Abgleiche ändern nichts mehr.
    elw_meldet(&elw).await;
    assert_eq!(rolle(&hub).await, "mitarbeit");
    assert_eq!(rolle(&elw).await, "mitarbeit");
}

#[tokio::test]
async fn bearbeitung_nach_dem_aufruesten_bleibt_und_der_spiegel_folgt() {
    let _nacheinander = NACHEINANDER.lock().await;
    let (hub, elw, hub_einsatz) = rueckgabe_an_den_alten_hub().await;
    rolle_mitarbeit_fuer_tests(true);
    // Melden lehrt beide Seiten die Fähigkeit; vor dem Abgleich wählt die Einsatzleitung am Hub
    // bewusst Beobachter (mit Führungsstelle).
    melden(&elw).await;
    let erika_hub: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'erika'")
        .fetch_one(&hub.pool)
        .await
        .unwrap();
    // Der Admin des Hubs ist Einsatzleitung des Einsatzes, den der Hub jetzt führt.
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, 1, 'einsatzleitung')",
    )
    .bind(hub_einsatz)
    .execute(&hub.pool)
    .await
    .unwrap();
    mitglied(
        &hub,
        hub_einsatz,
        erika_hub,
        "beobachter",
        Some("Abschnitt Nord"),
    )
    .await;
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    assert_eq!(rolle(&hub).await, "beobachter", "die bewusste Wahl bleibt");
    assert_eq!(
        rolle(&elw).await,
        "beobachter",
        "der Spiegel folgt dem Führer"
    );
    assert_eq!(ausgang(&elw).await, 0, "quittiert");
}

/// Umgekehrt: Der Hub (neu) führt, der ältere ELW übernimmt per Notübernahme. Der Nachtrag reist
/// dann in der Antwort, der ELW nimmt ihn als meldende Seite an.
#[tokio::test]
async fn notuebernahme_durch_alte_instanz_traegt_mitarbeit_nach() {
    let _nacheinander = NACHEINANDER.lock().await;
    rolle_mitarbeit_fuer_tests(false);
    let (hub, elw) = gekoppelt().await;
    let (erika_hub, _) = erika(&hub, &elw).await;
    let h = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    mitglied(&hub, h, erika_hub, "mitarbeit", None).await;
    elw_meldet(&elw).await;
    assert_eq!(rolle(&elw).await, "beobachter");
    let (s, v) = common::anfrage(
        &elw.app,
        "GET",
        "/api/admin/instance/command",
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let akte = v[0]["id"].as_i64().unwrap();
    let (s, v) = post(
        &elw,
        &format!("/api/admin/instance/command/{akte}/emergency-takeover"),
        json!({"grund": "Hub nicht erreichbar"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    elw_meldet(&elw).await;
    elw_meldet(&elw).await;
    assert_eq!(
        rolle(&elw).await,
        "beobachter",
        "der ältere ELW führt mit Beobachter"
    );
    assert_eq!(
        rolle(&hub).await,
        "mitarbeit",
        "der Hub hält die Mitarbeit fest"
    );
    rolle_mitarbeit_fuer_tests(true);
    elw_meldet(&elw).await;
    assert_eq!(
        rolle(&elw).await,
        "mitarbeit",
        "der ELW trägt die Mitarbeit nach"
    );
    assert_eq!(rolle(&hub).await, "mitarbeit");
    assert_eq!(ausgang(&hub).await, 0, "quittiert");
}
