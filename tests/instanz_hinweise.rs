//! Hinweise über den Hub (LLH-1495, Change `lc02103g-bruecke-web-push`, Specs
//! `benachrichtigungen` und `web-push`): zwei Instanzen im selben Testprozess, je mit eigener DB,
//! eigenem Live-Verteiler, eigenem Test-Push-Dienst und eigenem HTTP-Server auf Loopback.

mod common;
mod instanz_hilfen;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use common::relais::{oeffnen, relais_doppel, RelaisDoppel};
use instanz_hilfen::*;
use lifeline_hub::benachrichtigung::{
    self, Adressat, Anlass, BenachrichtigungArt as Art, BenachrichtigungBezugTyp as Typ, Bezug,
};
use lifeline_hub::live::LiveHub;
use lifeline_hub::web_push::krypto::{b64, entschluesseln, Schluessel};
use lifeline_hub::web_push::{repo as push_repo, WebPush};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::mpsc;

// ── Welt ────────────────────────────────────────────────────────────────────────────────────

struct Seite {
    i: Instanz,
    live: LiveHub,
    /// Basis-URL und Empfang des Test-Push-Dienstes dieser Instanz.
    dienst: Option<(String, mpsc::UnboundedReceiver<Vec<u8>>)>,
    /// Relais-Doppel für iOS-Push dieser Instanz (LLH-2040).
    relais: Option<RelaisDoppel>,
}

/// Ein Test-Push-Dienst auf Loopback, der jede Anfrage meldet und mit 201 antwortet.
async fn push_dienst() -> (String, mpsc::UnboundedReceiver<Vec<u8>>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let app = axum::Router::new().fallback(move |req: Request<Body>| {
        let tx = tx.clone();
        async move {
            let rumpf = to_bytes(req.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec();
            let _ = tx.send(rumpf);
            StatusCode::CREATED
        }
    });
    let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = lauscher.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(lauscher, app).await.unwrap() });
    (format!("http://{adresse}"), rx)
}

async fn seite(web_push: bool) -> Seite {
    seite_mit(web_push, false).await
}

/// Wie [`seite`], dazu auf Wunsch iOS-Push an ein Relais-Doppel.
async fn seite_mit(web_push: bool, ios_push: bool) -> Seite {
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
    let relais = if ios_push {
        let r = relais_doppel().await;
        live.ios_push_einrichten(r.ios_push(&pool));
        Some(r)
    } else {
        None
    };
    let dienst = if web_push {
        live.web_push_einrichten(
            WebPush::einrichten_fuer_test(&pool, &["127.0.0.1", "push.example.org"], false)
                .await
                .unwrap(),
        );
        Some(push_dienst().await)
    } else {
        None
    };
    Seite {
        i: instanz_aus(app, pool).await,
        live,
        dienst,
        relais,
    }
}

/// Ein Abo eines Browsers direkt im Speicher (die Route nimmt kein `http`), mit eigener Sitzung.
struct Browser {
    schluessel: Schluessel,
    auth: [u8; 16],
}

impl Seite {
    async fn abo(&self, benutzer: i64) -> Browser {
        let b = Browser {
            schluessel: Schluessel::erzeugen().unwrap(),
            auth: [7u8; 16],
        };
        let token = lifeline_hub::auth::session::anlegen(
            &self.i.pool,
            benutzer,
            None,
            lifeline_hub::auth::provider::Anmeldeweg::Passwort,
        )
        .await
        .unwrap();
        let basis = &self.dienst.as_ref().expect("Push an").0;
        push_repo::anmelden(
            &self.i.pool,
            benutzer,
            &lifeline_hub::auth::session::hash_token(&token),
            &format!("{basis}/geraet-{benutzer}"),
            &b64(b.schluessel.oeffentlich()),
            &b64(&b.auth),
            &push_repo::Wahl::default(),
        )
        .await
        .unwrap();
        b
    }

    /// Die nächste Push-Nachricht dieses Dienstes, entschlüsselt.
    async fn push(&mut self, b: &Browser) -> Value {
        let rx = &mut self.dienst.as_mut().expect("Push an").1;
        let rumpf = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("Push kommt an")
            .unwrap();
        serde_json::from_slice(&entschluesseln(&rumpf, &b.schluessel, &b.auth).unwrap()).unwrap()
    }

    /// Ein iOS-Gerät für `benutzer` direkt im Speicher, mit eigener Sitzung; liefert seinen
    /// Schlüssel.
    async fn ios_geraet(&self, benutzer: i64) -> [u8; 32] {
        let schluessel = [benutzer as u8; 32];
        let sitzung = lifeline_hub::auth::session::anlegen(
            &self.i.pool,
            benutzer,
            None,
            lifeline_hub::auth::provider::Anmeldeweg::Passwort,
        )
        .await
        .unwrap();
        lifeline_hub::ios_push::repo::anmelden(
            &self.i.pool,
            benutzer,
            &lifeline_hub::auth::session::hash_token(&sitzung),
            &lifeline_hub::ios_push::repo::Eingabe {
                kennung: &format!("6f1c2a64-3b1e-4a55-9c1d-{benutzer:012x}"),
                token: &format!("{benutzer:064x}"),
                umgebung: "production",
                schluessel: &b64(&schluessel),
                wahl: &push_repo::Wahl::default(),
            },
        )
        .await
        .unwrap();
        schluessel
    }

    /// Das Relais-Doppel dieser Instanz.
    fn relais(&mut self) -> &mut RelaisDoppel {
        self.relais.as_mut().expect("iOS-Push an")
    }

    /// Kein Push innerhalb einer Sekunde.
    async fn kein_push(&mut self) {
        let rx = &mut self.dienst.as_mut().expect("Push an").1;
        let r = tokio::time::timeout(Duration::from_secs(1), rx.recv()).await;
        assert!(r.is_err(), "unerwarteter Push");
    }
}

struct Welt {
    hub: Seite,
    elw: Seite,
    /// Gemeinsames Konto: am Hub angelegt, an den ELW verteilt.
    erika_hub: i64,
    erika_elw: i64,
    /// Einsatz am ELW und sein Spiegel am Hub.
    einsatz: i64,
    spiegel: i64,
}

async fn abgleichen(elw: &Instanz) {
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
        .await
        .unwrap();
}

/// Hub und ELW gekoppelt und gemeldet; Erika ist am ELW Führungspersonal eines Einsatzes, den der
/// ELW führt und der Hub spiegelt. Ihre Aufnahme hat schon einen Hinweis am Hub erzeugt.
async fn welt(hub_push: bool, elw_push: bool) -> Welt {
    welt_mit((hub_push, false), (elw_push, false)).await
}

/// Wie [`welt`], je Seite mit `(Web Push, iOS-Push)`.
async fn welt_mit(hub_push: (bool, bool), elw_push: (bool, bool)) -> Welt {
    let hub = seite_mit(hub_push.0, hub_push.1).await;
    let elw = seite_mit(elw_push.0, elw_push.1).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    melden(&elw.i).await;
    let (s, v) = common::anfrage_json(
        &hub.i.app,
        "POST",
        "/api/users",
        &hub.i.admin,
        Some(&json!({"anzeigename": "Erika", "benutzername": "erika",
                     "passwort": "erikapw12345", "org_rolle": "keine"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let erika_hub = v["id"].as_i64().unwrap();
    melden(&elw.i).await;
    let erika_elw = lokale_id(&elw.i, "benutzer", "benutzername", "erika").await;
    let einsatz = common::einsatz_anlegen_mit(&elw.i.app, &elw.i.admin, "Hochwasser").await;
    common::rolle_setzen(
        &elw.i.app,
        &elw.i.admin,
        einsatz,
        erika_elw,
        "fuehrungspersonal",
    )
    .await;
    abgleichen(&elw.i).await;
    let spiegel: i64 = eine(&hub.i.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;
    Welt {
        hub,
        elw,
        erika_hub,
        erika_elw,
        einsatz,
        spiegel,
    }
}

/// Die Benachrichtigungen einer Instanz: (Empfänger, Einsatz, Art, Bezug, quittiert).
async fn hinweise(i: &Instanz) -> Vec<(i64, i64, String, i64, bool)> {
    sqlx::query_as(
        "SELECT benutzer_id, einsatz_id, art, bezug_id, quittiert_at IS NOT NULL \
         FROM benachrichtigung ORDER BY id",
    )
    .fetch_all(&i.pool)
    .await
    .unwrap()
}

async fn ausgang(elw: &Instanz) -> i64 {
    eine(&elw.pool, "SELECT COUNT(*) FROM hinweis_ausgang").await
}

/// Ein Hinweis am ELW an Erika zum Einsatz (Hinweis-Stufe, ohne eigene Zeile als Bezug).
async fn aufnahme_an_erika(w: &Welt) {
    benachrichtigung::melden(
        &w.elw.i.pool,
        &w.elw.live,
        Anlass::neu(
            w.einsatz,
            Art::EinsatzAufnahme,
            Bezug::neu(Typ::Einsatz, w.einsatz),
        )
        .von(1)
        .an(Adressat::Nutzer(w.erika_elw)),
    )
    .await;
}

// ── Fähigkeiten (Aufgabe 1.2) ───────────────────────────────────────────────────────────────

async fn faehigkeiten(elw: &Instanz) -> (bool, bool) {
    sqlx::query_as("SELECT gegenueber_hinweise, gegenueber_web_push FROM instanz_kopplung LIMIT 1")
        .fetch_one(&elw.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn meldeantwort_nennt_hinweise_und_web_push_des_hubs() {
    let hub = seite(true).await;
    let elw = seite(false).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    melden(&elw.i).await;
    assert_eq!(faehigkeiten(&elw.i).await, (true, true));
}

/// LLH-1817 (design.md D7): Beide Seiten nennen die Einsatzrolle „Mitarbeit“, die meldende in
/// ihrer Anfrage, die erreichte in ihrer Antwort; jede hält fest, was das Gegenüber kann.
#[tokio::test]
async fn meldende_und_erreichte_seite_speichern_die_faehigkeit() {
    let hub = seite(false).await;
    let elw = seite(false).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    for i in [&hub.i, &elw.i] {
        exec(
            &i.pool,
            "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 0",
        )
        .await;
    }
    melden(&elw.i).await;
    for (name, i) in [("Hub", &hub.i), ("ELW", &elw.i)] {
        let mitarbeit: bool = eine(
            &i.pool,
            "SELECT gegenueber_rolle_mitarbeit FROM instanz_kopplung LIMIT 1",
        )
        .await;
        assert!(mitarbeit, "{name} kennt die Fähigkeit des Gegenübers");
    }
}

#[tokio::test]
async fn hub_ohne_push_meldet_keinen_push() {
    let hub = seite(false).await;
    let elw = seite(false).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    melden(&elw.i).await;
    assert_eq!(faehigkeiten(&elw.i).await, (true, false));
}

// ── Sperre des Push-Relais am Hub (LLH-2074) ─────────────────────────────────────────────────

const SPERRE_SEIT: &str = "2026-11-23 08:15:00";

/// Der Hub wird vom Relais gesperrt (`403`), wie `ios_push::repo::relais_gesperrt_setzen` es
/// festhält.
async fn hub_sperren(hub: &Instanz) {
    exec(
        &hub.pool,
        &format!(
            "INSERT INTO ios_push_relais (id, server_id, geheimnis, gesperrt_at) \
             VALUES (1, 's', 'g', '{SPERRE_SEIT}') \
             ON CONFLICT(id) DO UPDATE SET gesperrt_at = excluded.gesperrt_at"
        ),
    )
    .await;
}

async fn sperre_am_elw(elw: &Instanz) -> Option<String> {
    eine(
        &elw.pool,
        "SELECT gegenueber_ios_push_gesperrt_seit FROM instanz_kopplung LIMIT 1",
    )
    .await
}

#[tokio::test]
async fn gesperrter_hub_meldet_seine_sperre_an_den_elw() {
    let hub = seite_mit(false, true).await;
    let elw = seite(false).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    melden(&elw.i).await;
    assert_eq!(sperre_am_elw(&elw.i).await, None, "vor der Sperre");
    hub_sperren(&hub.i).await;
    melden(&elw.i).await;
    assert_eq!(sperre_am_elw(&elw.i).await.as_deref(), Some(SPERRE_SEIT));
    exec(&hub.i.pool, "UPDATE ios_push_relais SET gesperrt_at = NULL").await;
    melden(&elw.i).await;
    assert_eq!(sperre_am_elw(&elw.i).await, None, "die Sperre ist gefallen");
}

/// Ein Hub mit kaputtem oder überlangem Zeitwert (Review LLH-2074): die Sperre gilt trotzdem, der
/// ELW speichert sie aber nur im kanonischen Format (ADR-0012), als „jetzt“, und behält einen schon
/// gespeicherten Wert, statt ihn bei jeder Meldung neu zu setzen.
#[tokio::test]
async fn ungueltige_sperrzeit_vom_hub_gilt_als_sperre_im_kanonischen_format() {
    let hub = seite_mit(false, true).await;
    let elw = seite(false).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    for kaputt in ["kaputt".to_string(), "x".repeat(10_000)] {
        exec(
            &elw.i.pool,
            "UPDATE instanz_kopplung SET gegenueber_ios_push_gesperrt_seit = NULL",
        )
        .await;
        exec(
            &hub.i.pool,
            &format!(
                "INSERT INTO ios_push_relais (id, server_id, geheimnis, gesperrt_at) \
                 VALUES (1, 's', 'g', '{kaputt}') \
                 ON CONFLICT(id) DO UPDATE SET gesperrt_at = excluded.gesperrt_at"
            ),
        )
        .await;
        melden(&elw.i).await;
        let gespeichert = sperre_am_elw(&elw.i).await.expect("Sperre gilt");
        assert!(
            lifeline_hub::zeit::parse_streng(&gespeichert).is_some(),
            "kanonisch: {gespeichert:.40}"
        );
        exec(
            &elw.i.pool,
            "UPDATE instanz_kopplung SET gegenueber_ios_push_gesperrt_seit = '2026-11-23 06:00:00'",
        )
        .await;
        melden(&elw.i).await;
        assert_eq!(
            sperre_am_elw(&elw.i).await.as_deref(),
            Some("2026-11-23 06:00:00"),
            "ein gespeicherter Wert bleibt"
        );
    }
}

/// Ohne `--ios-push` zählt eine alte Zeile des Relais nicht: der Hub bietet den Kanal gar nicht an.
#[tokio::test]
async fn hub_ohne_ios_push_meldet_keine_sperre() {
    let hub = seite(false).await;
    let elw = seite(false).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    hub_sperren(&hub.i).await;
    melden(&elw.i).await;
    assert_eq!(sperre_am_elw(&elw.i).await, None);
}

/// Ein Lage-Snapshot friert die Sperre nicht ein (LLH-2086): sie ist ein Zustand der Kopplung,
/// kein Teil des Lagebilds, wie die Führung je Einsatz.
#[tokio::test]
async fn lage_snapshot_friert_die_sperre_des_hubs_nicht_ein() {
    let w = welt_mit((false, true), (false, false)).await;
    hub_sperren(&w.hub.i).await;
    melden(&w.elw.i).await;
    let elw = &w.elw.i;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "GET",
        &format!("/api/incidents/{}", w.einsatz),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["ios_push_hub_gesperrt"].is_array(), "Vorbedingung: {v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/incidents/{}/situation-snapshots", w.einsatz),
        &elw.admin,
        Some(&json!({"bezeichnung": "Stand 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let daten: String = eine(&elw.pool, "SELECT daten FROM lage_snapshot").await;
    let daten: Value = serde_json::from_str(&daten).unwrap();
    assert!(daten["einsatz"].is_object(), "{daten}");
    assert!(
        daten["einsatz"].get("ios_push_hub_gesperrt").is_none(),
        "gespeicherter Stand: {daten}"
    );
}

/// Der ELW zeigt die Sperre am gelieferten Einsatz (Detail und Liste gleich) und an der
/// Kopplung; ein Spiegel zeigt nichts. Fällt die Sperre, fällt die Anzeige.
#[tokio::test]
async fn gesperrter_hub_zeigt_die_sperre_am_einsatz_und_an_der_kopplung() {
    let w = welt_mit((false, true), (false, false)).await;
    hub_sperren(&w.hub.i).await;
    melden(&w.elw.i).await;
    let hub_name: String = eine(
        &w.elw.i.pool,
        "SELECT gegenueber_name FROM instanz_kopplung LIMIT 1",
    )
    .await;
    let erwartet = json!([{"hub_name": hub_name, "since": SPERRE_SEIT}]);
    let elw = &w.elw.i;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "GET",
        &format!("/api/incidents/{}", w.einsatz),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ios_push_hub_gesperrt"], erwartet, "Detail");
    let (_, liste) =
        common::anfrage_json(&elw.app, "GET", "/api/incidents", &elw.admin, None).await;
    let eintrag = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == json!(w.einsatz))
        .expect("Einsatz in der Liste");
    assert_eq!(eintrag["ios_push_hub_gesperrt"], erwartet, "Liste");
    let (s, u) =
        common::anfrage_json(&elw.app, "GET", "/api/admin/instance", &elw.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{u}");
    assert_eq!(
        u["kopplungen"][0]["gegenueber_ios_push_gesperrt_seit"],
        json!(SPERRE_SEIT)
    );
    // Ein Spiegel zeigt die Sperre nie (`e.spiegel = 0` in der Spalte): Hinweise eines Spiegels
    // reisen nicht über diese Kopplung. Am Hub prüfte das nichts, denn dort ist die Kopplung
    // `wird_gemeldet` (LLH-2086); deshalb derselbe Einsatz am ELW, kurz als Spiegel markiert.
    let als_spiegel = |wert: i64| {
        format!(
            "UPDATE einsatz SET spiegel = {wert} WHERE id = {}",
            w.einsatz
        )
    };
    exec(&elw.pool, &als_spiegel(1)).await;
    let (s, spiegel) = common::anfrage_json(
        &elw.app,
        "GET",
        &format!("/api/incidents/{}", w.einsatz),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{spiegel}");
    assert!(
        spiegel.get("ios_push_hub_gesperrt").is_none(),
        "Spiegel am ELW: {spiegel}"
    );
    exec(&elw.pool, &als_spiegel(0)).await;
    let hub = &w.hub.i;
    exec(&hub.pool, "UPDATE ios_push_relais SET gesperrt_at = NULL").await;
    melden(elw).await;
    let (_, v) = common::anfrage_json(
        &elw.app,
        "GET",
        &format!("/api/incidents/{}", w.einsatz),
        &elw.admin,
        None,
    )
    .await;
    assert!(
        v.get("ios_push_hub_gesperrt").is_none(),
        "Sperre gefallen: {v}"
    );
}

// ── Hinweise am Hub (Aufgaben 2.2, 3.3, 3.4) ────────────────────────────────────────────────

/// Spec `benachrichtigungen`, „Hinweise zu einem Einsatz des ELW entstehen auch am Hub“: die
/// Aufnahme am ELW erreicht das gemeinsame Konto am Hub, im Spiegel, mit Kennungen des Hubs.
#[tokio::test]
async fn aufnahme_am_elw_erreicht_das_gemeinsame_konto_am_hub() {
    let w = welt(false, false).await;
    let am_hub = hinweise(&w.hub.i).await;
    assert!(
        am_hub.contains(&(
            w.erika_hub,
            w.spiegel,
            "einsatz_aufnahme".into(),
            w.spiegel,
            false
        )),
        "{am_hub:?}"
    );
    assert_eq!(ausgang(&w.elw.i).await, 0, "quittiert und gelöscht");
    // Am ELW bleibt alles wie ohne Kopplung.
    assert!(hinweise(&w.elw.i).await.contains(&(
        w.erika_elw,
        w.einsatz,
        "einsatz_aufnahme".into(),
        w.einsatz,
        false
    )));
}

/// Der Auslöser bekommt am Hub nichts, wenn er ein gemeinsames Konto ist.
#[tokio::test]
async fn der_ausloeser_bekommt_auch_am_hub_nichts() {
    let w = welt(false, false).await;
    let vorher = hinweise(&w.hub.i).await.len();
    benachrichtigung::melden(
        &w.elw.i.pool,
        &w.elw.live,
        Anlass::neu(
            w.einsatz,
            Art::EinsatzAufnahme,
            Bezug::neu(Typ::Einsatz, w.einsatz),
        )
        .von(w.erika_elw)
        .an(Adressat::Nutzer(w.erika_elw)),
    )
    .await;
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 0, "angenommen");
    assert_eq!(hinweise(&w.hub.i).await.len(), vorher);
}

/// „Ein Hinweis kommt am Hub einmal …“: eine verlorene Antwort lässt den ELW denselben Anlass
/// erneut senden; der Hub legt keine zweite Benachrichtigung an.
#[tokio::test]
async fn ein_wiederholter_anlass_ergibt_eine_benachrichtigung() {
    let w = welt(false, false).await;
    aufnahme_an_erika(&w).await;
    let zeile: (i64, i64, i64, String, String) = sqlx::query_as(
        "SELECT id, kopplung_org_id, einsatz_id, daten, erstellt_at FROM hinweis_ausgang",
    )
    .fetch_one(&w.elw.i.pool)
    .await
    .unwrap();
    abgleichen(&w.elw.i).await;
    let nach_erstem = hinweise(&w.hub.i).await.len();
    sqlx::query(
        "INSERT INTO hinweis_ausgang (id, kopplung_org_id, einsatz_id, daten, erstellt_at) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(zeile.0)
    .bind(zeile.1)
    .bind(zeile.2)
    .bind(&zeile.3)
    .bind(&zeile.4)
    .execute(&w.elw.i.pool)
    .await
    .unwrap();
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 0);
    assert_eq!(hinweise(&w.hub.i).await.len(), nach_erstem);
}

/// „… und höchstens 12 Stunden spät“: ein alter Anlass geht nicht mehr hinaus.
#[tokio::test]
async fn ein_anlass_aelter_als_12_stunden_erreicht_den_hub_nicht() {
    let w = welt(false, false).await;
    let vorher = hinweise(&w.hub.i).await.len();
    aufnahme_an_erika(&w).await;
    let alt = lifeline_hub::zeit::formatiere_utc(chrono::Utc::now() - chrono::Duration::hours(13));
    sqlx::query("UPDATE hinweis_ausgang SET erstellt_at = ?")
        .bind(alt)
        .execute(&w.elw.i.pool)
        .await
        .unwrap();
    abgleichen(&w.elw.i).await;
    assert_eq!(hinweise(&w.hub.i).await.len(), vorher);
}

/// „Objekt noch nicht gespiegelt“: der Hub stellt den Anlass zurück, bis die Zeile da ist.
#[tokio::test]
async fn ein_anlass_wartet_auf_seine_zeile() {
    let w = welt(false, false).await;
    let p1 = common::person_anlegen(
        &w.elw.i.app,
        &w.elw.i.admin,
        w.einsatz,
        r#"{"name":"Eins"}"#,
    )
    .await;
    abgleichen(&w.elw.i).await;
    let naechste = p1 + 1;
    benachrichtigung::melden(
        &w.elw.i.pool,
        &w.elw.live,
        Anlass::neu(
            w.einsatz,
            Art::SichtungEins,
            Bezug::neu(Typ::Person, naechste),
        )
        .an(Adressat::Nutzer(w.erika_elw)),
    )
    .await;
    abgleichen(&w.elw.i).await;
    assert_eq!(
        ausgang(&w.elw.i).await,
        1,
        "zurückgestellt, nicht quittiert"
    );
    let p2 = common::person_anlegen(
        &w.elw.i.app,
        &w.elw.i.admin,
        w.einsatz,
        r#"{"name":"Zwei"}"#,
    )
    .await;
    assert_eq!(p2, naechste);
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 0);
    let p2_hub = lokale_id_herkunft(&w.hub.i, "einsatz_person", p2).await;
    assert!(hinweise(&w.hub.i)
        .await
        .iter()
        .any(|h| h.0 == w.erika_hub && h.2 == "sichtung_eins" && h.3 == p2_hub));
}

async fn lokale_id_herkunft(i: &Instanz, tabelle: &str, fremd: i64) -> i64 {
    let l: String = sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM spiegel_herkunft WHERE art = ? AND fremder_schluessel = ?",
    )
    .bind(tabelle)
    .bind(fremd.to_string())
    .fetch_one(&i.pool)
    .await
    .unwrap();
    l.parse().unwrap()
}

/// Spec `benachrichtigungen`, „Für alle erledigt gilt auch am Hub“.
#[tokio::test]
async fn erledigt_am_elw_quittiert_am_hub() {
    let w = welt(false, false).await;
    let offen = |h: &Vec<(i64, i64, String, i64, bool)>| {
        h.iter()
            .filter(|h| h.0 == w.erika_hub && h.2 == "einsatz_aufnahme" && !h.4)
            .count()
    };
    assert_eq!(offen(&hinweise(&w.hub.i).await), 1);
    benachrichtigung::erledigen(
        &w.elw.i.pool,
        &w.elw.live,
        w.einsatz,
        Art::EinsatzAufnahme,
        Typ::Einsatz,
        &[w.einsatz],
    )
    .await;
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 0);
    assert_eq!(offen(&hinweise(&w.hub.i).await), 0);
}

// ── Push (Aufgaben 2.2, 3.5) ────────────────────────────────────────────────────────────────

/// Spec `web-push`, „Ein gekoppelter ELW pusht über den Hub“, Szenario „Hub mit Push“: der ELW
/// pusht nicht, der Hub pusht mit seinen Kennungen.
#[tokio::test]
async fn hub_mit_push_pusht_statt_des_elw() {
    let mut w = welt(true, true).await;
    let am_elw = w.elw.abo(w.erika_elw).await;
    let am_hub = w.hub.abo(w.erika_hub).await;
    aufnahme_an_erika(&w).await;
    w.elw.kein_push().await;
    let _ = am_elw;
    abgleichen(&w.elw.i).await;
    let n = w.hub.push(&am_hub).await;
    assert_eq!(n["einsatz_id"], w.spiegel);
    assert_eq!(n["art"], "einsatz_aufnahme");
    let id = n["benachrichtigung_id"].as_i64().unwrap();
    let zeile: i64 = eine(
        &w.hub.i.pool,
        &format!("SELECT benutzer_id FROM benachrichtigung WHERE id = {id}"),
    )
    .await;
    assert_eq!(zeile, w.erika_hub, "Kennung des Hubs");
}

/// Szenario „Hub ohne Push“: der ELW pusht wie ohne Kopplung.
#[tokio::test]
async fn hub_ohne_push_laesst_den_elw_pushen() {
    let mut w = welt(false, true).await;
    let am_elw = w.elw.abo(w.erika_elw).await;
    aufnahme_an_erika(&w).await;
    let n = w.elw.push(&am_elw).await;
    assert_eq!(n["einsatz_id"], w.einsatz);
}

/// Szenario „Entkoppelt“: nach dem Widerruf der Org pusht der ELW wieder an das alte Abo.
#[tokio::test]
async fn nach_dem_widerruf_pusht_der_elw_wieder() {
    let mut w = welt(true, true).await;
    let am_elw = w.elw.abo(w.erika_elw).await;
    let vorher = ausgang(&w.elw.i).await;
    exec(
        &w.elw.i.pool,
        "UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-12T00:00:00Z'",
    )
    .await;
    aufnahme_an_erika(&w).await;
    let n = w.elw.push(&am_elw).await;
    assert_eq!(n["einsatz_id"], w.einsatz);
    assert_eq!(ausgang(&w.elw.i).await, vorher, "nichts mehr für den Hub");
}

// ── Push-Einstellung am ELW (Aufgabe 5.1) ───────────────────────────────────────────────────

fn abo_body(endpoint: &str) -> String {
    let s = Schluessel::erzeugen().unwrap();
    json!({"endpoint": endpoint, "p256dh": b64(s.oeffentlich()), "auth": b64(&[5u8; 16])})
        .to_string()
}

/// Eine Sitzung am ELW für ein Konto (ohne Anmeldung: das Passwort reist nur mit bestätigter
/// Plattenverschlüsselung).
async fn sitzung(i: &Instanz, benutzer: i64) -> String {
    let token = lifeline_hub::auth::session::anlegen(
        &i.pool,
        benutzer,
        None,
        lifeline_hub::auth::provider::Anmeldeweg::Passwort,
    )
    .await
    .unwrap();
    format!("{}={token}", lifeline_hub::auth::session::SESSION_COOKIE)
}

/// Spec `web-push`, „Push-Einstellung am gekoppelten ELW verweist auf den Hub“: für ein Konto,
/// das der Hub kennt.
#[tokio::test]
async fn der_gekoppelte_elw_verweist_auf_den_hub_und_lehnt_neue_abos_ab() {
    let w = welt(true, true).await;
    let erika = sitzung(&w.elw.i, w.erika_elw).await;
    let (s, v) = common::anfrage(&w.elw.i.app, "GET", "/api/web-push", &erika, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ueber_hub"]["adresse"], w.hub.i.adresse.as_str());
    assert!(v["ueber_hub"]["name"]
        .as_str()
        .is_some_and(|n| !n.is_empty()));
    let (s, v) = common::anfrage(
        &w.elw.i.app,
        "PUT",
        "/api/web-push/subscription",
        &erika,
        Some(&abo_body("https://push.example.org/neu")),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let abos: i64 = eine(&w.elw.i.pool, "SELECT COUNT(*) FROM web_push_abo").await;
    assert_eq!(abos, 0, "nichts gespeichert");
    // Der Hub selbst zeigt seinen Schalter wie bisher.
    let (s, v) = common::anfrage(&w.hub.i.app, "GET", "/api/web-push", &w.hub.i.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("ueber_hub").is_none(), "{v}");
}

/// Bietet der Hub keinen Push an, bleibt der Schalter am ELW.
#[tokio::test]
async fn ohne_push_am_hub_bleibt_der_schalter_am_elw() {
    let w = welt(false, true).await;
    // Erika stammt vom Hub: ohne Push am Hub bleibt ihr trotzdem der Schalter am ELW.
    let erika = sitzung(&w.elw.i, w.erika_elw).await;
    let (s, v) = common::anfrage(&w.elw.i.app, "GET", "/api/web-push", &erika, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("ueber_hub").is_none(), "{v}");
    let (s, v) = common::anfrage(
        &w.elw.i.app,
        "PUT",
        "/api/web-push/subscription",
        &erika,
        Some(&abo_body("https://push.example.org/neu")),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
}

// ── Nachzüge aus dem Review ─────────────────────────────────────────────────────────────────

/// „Für alle erledigt“ zu einer Zeile, die am Hub noch fehlt, wartet wie der Melde-Anlass; danach
/// ist der Hinweis am Hub quittiert, nicht 24 Stunden offen.
#[tokio::test]
async fn erledigt_wartet_auf_die_zeile_wie_der_hinweis() {
    let w = welt(false, false).await;
    let p1 = common::person_anlegen(
        &w.elw.i.app,
        &w.elw.i.admin,
        w.einsatz,
        r#"{"name":"Eins"}"#,
    )
    .await;
    abgleichen(&w.elw.i).await;
    let naechste = p1 + 1;
    benachrichtigung::melden(
        &w.elw.i.pool,
        &w.elw.live,
        Anlass::neu(w.einsatz, Art::Meldung, Bezug::neu(Typ::Person, naechste))
            .an(Adressat::Nutzer(w.erika_elw)),
    )
    .await;
    benachrichtigung::erledigen(
        &w.elw.i.pool,
        &w.elw.live,
        w.einsatz,
        Art::Meldung,
        Typ::Person,
        &[naechste],
    )
    .await;
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 2, "beide zurückgestellt");
    let p2 = common::person_anlegen(
        &w.elw.i.app,
        &w.elw.i.admin,
        w.einsatz,
        r#"{"name":"Zwei"}"#,
    )
    .await;
    assert_eq!(p2, naechste);
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 0);
    let p2_hub = lokale_id_herkunft(&w.hub.i, "einsatz_person", p2).await;
    let am_hub: Vec<_> = hinweise(&w.hub.i)
        .await
        .into_iter()
        .filter(|h| h.0 == w.erika_hub && h.2 == "meldung" && h.3 == p2_hub)
        .collect();
    assert_eq!(am_hub.len(), 1, "{am_hub:?}");
    assert!(am_hub[0].4, "quittiert");
}

/// Die Kenntnisnahme reist auch, wenn am ELW keine offene Zeile mehr steht, aber nur mit
/// Meldungen dieses Einsatzes, die wirklich gesehen sind: eine fremde Kennung hielte das Erledigt
/// am Hub 12 Stunden fest.
#[tokio::test]
async fn die_kenntnisnahme_reist_nur_mit_gesehenen_meldungen_des_einsatzes() {
    let w = welt(false, false).await;
    let (s, lm) = common::anfrage_json(
        &w.elw.i.app,
        "POST",
        &format!("/api/incidents/{}/reports", w.einsatz),
        &w.elw.i.admin,
        Some(&json!({
            "absender": "Florian Nord 1", "meldeweg": "funk", "meldungsart": "lagemeldung",
            "prioritaet": "dringend", "inhalt": "Brand unter Kontrolle",
            "ereigniszeit": "2026-06-12 09:00:00", "lat": 51.4, "lon": 10.4
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{lm}");
    let mid = lm["id"].as_i64().unwrap();
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 0);
    let (s, v) = common::anfrage_json(
        &w.elw.i.app,
        "POST",
        &format!("/api/incidents/{}/situation/seen", w.einsatz),
        &w.elw.i.admin,
        Some(&json!({ "meldung_ids": [mid, 99_999] })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let daten: String = eine(
        &w.elw.i.pool,
        "SELECT daten FROM hinweis_ausgang WHERE daten LIKE '%\"erledigen\":true%' \
         ORDER BY id DESC LIMIT 1",
    )
    .await;
    let v: Value = serde_json::from_str(&daten).unwrap();
    assert_eq!(v["bezug_typ"], "lage_uebernahme");
    assert_eq!(v["bezug_ids"], json!([mid]), "nur die gesehene Meldung");
    abgleichen(&w.elw.i).await;
    assert_eq!(ausgang(&w.elw.i).await, 0, "am Hub angenommen");
}

/// Scheitert das Vormerken, pusht der ELW selbst: nichts geht still verloren.
#[tokio::test]
async fn scheitert_das_vormerken_pusht_der_elw() {
    let mut w = welt(true, true).await;
    let am_elw = w.elw.abo(w.erika_elw).await;
    exec(&w.elw.i.pool, "DROP TABLE hinweis_ausgang").await;
    aufnahme_an_erika(&w).await;
    let n = w.elw.push(&am_elw).await;
    assert_eq!(n["einsatz_id"], w.einsatz);
}

/// Adressat Einsatzleitung: am Hub die Einsatzleitung des Spiegels.
#[tokio::test]
async fn die_einsatzleitung_am_hub_wird_erreicht() {
    let w = welt(false, false).await;
    common::rolle_setzen(
        &w.elw.i.app,
        &w.elw.i.admin,
        w.einsatz,
        w.erika_elw,
        "einsatzleitung",
    )
    .await;
    abgleichen(&w.elw.i).await;
    let vorher = hinweise(&w.hub.i).await.len();
    benachrichtigung::melden(
        &w.elw.i.pool,
        &w.elw.live,
        Anlass::neu(
            w.einsatz,
            Art::Lagebericht,
            Bezug::neu(Typ::Einsatz, w.einsatz),
        )
        .an(Adressat::Einsatzleitung),
    )
    .await;
    abgleichen(&w.elw.i).await;
    let neu: Vec<_> = hinweise(&w.hub.i).await.into_iter().skip(vorher).collect();
    assert!(
        neu.iter()
            .any(|h| h.0 == w.erika_hub && h.2 == "lagebericht"),
        "{neu:?}"
    );
}

/// Ein Konto, das nur am ELW besteht, kennt der Hub nicht: der ELW zeigt ihm den Schalter und
/// pusht ihm selbst (Entscheidung 12.11.2026, Spec `web-push`, Szenario „Konto nur am ELW“).
#[tokio::test]
async fn ein_konto_nur_am_elw_bekommt_den_push_vom_elw() {
    let mut w = welt(true, true).await;
    // Der Admin des ELW ist ein eigenes Konto des ELW.
    let (s, v) = common::anfrage(&w.elw.i.app, "GET", "/api/web-push", &w.elw.i.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("ueber_hub").is_none(), "{v}");
    let (s, v) = common::anfrage(
        &w.elw.i.app,
        "PUT",
        "/api/web-push/subscription",
        &w.elw.i.admin,
        Some(&abo_body("https://push.example.org/admin")),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    let spontan = konto(&w.elw.i, "spontan").await;
    let am_elw = w.elw.abo(spontan).await;
    common::rolle_setzen(
        &w.elw.i.app,
        &w.elw.i.admin,
        w.einsatz,
        spontan,
        "fuehrungspersonal",
    )
    .await;
    // Die Aufnahme an das ELW-Konto: der ELW pusht selbst.
    let n = w.elw.push(&am_elw).await;
    assert_eq!(n["art"], "einsatz_aufnahme");
    assert_eq!(n["einsatz_id"], w.einsatz);
    // Ein Hinweis an Erika (Konto vom Hub) geht nicht vom ELW hinaus.
    let _erika = w.elw.abo(w.erika_elw).await;
    aufnahme_an_erika(&w).await;
    w.elw.kein_push().await;
}

// ── iOS-Push je Kanal (LLH-2040, Aufgabe 7) ──────────────────────────────────────────────────

async fn faehigkeit_ios(elw: &Instanz) -> bool {
    eine(
        &elw.pool,
        "SELECT gegenueber_ios_push FROM instanz_kopplung LIMIT 1",
    )
    .await
}

/// Spec `ios-apns-alarme`, „Kopplung je Kanal“: der ELW lässt den Push an ein Konto vom Hub nur
/// in dem Kanal aus, den der Hub selbst anbietet; im anderen pusht er wie ohne Kopplung.
#[tokio::test]
async fn elw_ueberspringt_hub_konten_nur_im_kanal_den_der_hub_kann() {
    // Hub mit Web Push, ohne iOS: der ELW pusht iOS selbst, Web Push nicht.
    let mut w = welt_mit((true, false), (true, true)).await;
    assert_eq!(faehigkeiten(&w.elw.i).await, (true, true));
    assert!(!faehigkeit_ios(&w.elw.i).await);
    let _web = w.elw.abo(w.erika_elw).await;
    let schluessel = w.elw.ios_geraet(w.erika_elw).await;
    aufnahme_an_erika(&w).await;
    let r = w.elw.relais().naechste().await;
    let n = r["nachrichten"].as_array().unwrap();
    assert_eq!(n.len(), 1);
    let (_, k) = oeffnen(n[0]["nutzlast"].as_str().unwrap(), &schluessel);
    assert_eq!(k["e"], w.einsatz);
    w.elw.kein_push().await;

    // Hub mit iOS, ohne Web Push: umgekehrt. Den iOS-Push übernimmt der Hub mit seinen Kennungen.
    let mut w = welt_mit((false, true), (true, true)).await;
    assert_eq!(faehigkeiten(&w.elw.i).await, (true, false));
    assert!(faehigkeit_ios(&w.elw.i).await);
    let web = w.elw.abo(w.erika_elw).await;
    w.elw.ios_geraet(w.erika_elw).await;
    let am_hub = w.hub.ios_geraet(w.erika_hub).await;
    aufnahme_an_erika(&w).await;
    let n = w.elw.push(&web).await;
    assert_eq!(n["einsatz_id"], w.einsatz);
    w.elw.relais().keine().await;
    abgleichen(&w.elw.i).await;
    let r = w.hub.relais().naechste().await;
    let n = r["nachrichten"].as_array().unwrap();
    assert_eq!(n.len(), 1);
    let (_, k) = oeffnen(n[0]["nutzlast"].as_str().unwrap(), &am_hub);
    assert_eq!(k["e"], w.spiegel, "Kennung des Hubs");
}

/// Kann der Hub iOS-Push, verweist der ELW ein Konto vom Hub dorthin und nimmt kein Gerät an;
/// kann er es nicht, bleibt der Schalter am ELW, auch wenn der Hub Web Push anbietet.
#[tokio::test]
async fn elw_lehnt_ios_anmeldung_fuer_hub_konto_mit_422_ab_wenn_der_hub_ios_kann() {
    const KENNUNG: &str = "6f1c2a64-3b1e-4a55-9c1d-0d3b5a7e9f10";
    let anmeldung = json!({
        "kennung": KENNUNG,
        "token": "ab".repeat(32),
        "umgebung": "production",
        "schluessel": b64(&[3u8; 32]),
    })
    .to_string();
    let uri = format!("/api/ios-push?kennung={KENNUNG}");

    let w = welt_mit((false, true), (false, true)).await;
    let erika = sitzung(&w.elw.i, w.erika_elw).await;
    let (s, v) = common::anfrage(&w.elw.i.app, "GET", &uri, &erika, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ueber_hub"]["adresse"], w.hub.i.adresse.as_str());
    let (s, v) = common::anfrage(
        &w.elw.i.app,
        "PUT",
        "/api/ios-push/registration",
        &erika,
        Some(&anmeldung),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let zahl: i64 = eine(&w.elw.i.pool, "SELECT COUNT(*) FROM ios_push_anmeldung").await;
    assert_eq!(zahl, 0, "nichts gespeichert");
    // Ein Konto nur am ELW meldet sich dort an.
    let (s, v) = common::anfrage(&w.elw.i.app, "GET", &uri, &w.elw.i.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("ueber_hub").is_none(), "{v}");

    // Hub mit Web Push, ohne iOS: der iOS-Schalter bleibt am ELW.
    let w = welt_mit((true, false), (false, true)).await;
    let erika = sitzung(&w.elw.i, w.erika_elw).await;
    let (s, v) = common::anfrage(&w.elw.i.app, "GET", &uri, &erika, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("ueber_hub").is_none(), "{v}");
    let (s, v) = common::anfrage(
        &w.elw.i.app,
        "PUT",
        "/api/ios-push/registration",
        &erika,
        Some(&anmeldung),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
}
