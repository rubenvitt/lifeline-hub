//! Hinweise über den Hub (LLH-1495, Change `lc02103g-bruecke-web-push`, Specs
//! `benachrichtigungen` und `web-push`): zwei Instanzen im selben Testprozess, je mit eigener DB,
//! eigenem Live-Verteiler, eigenem Test-Push-Dienst und eigenem HTTP-Server auf Loopback.

mod common;
mod instanz_hilfen;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
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
    let (app, pool, live) = common::setup_mit_pool_und_live().await;
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
    let hub = seite(hub_push).await;
    let elw = seite(elw_push).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    melden(&elw.i).await;
    let (s, v) = common::anfrage_json(
        &hub.i.app,
        "POST",
        "/api/benutzer",
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

#[tokio::test]
async fn hub_ohne_push_meldet_keinen_push() {
    let hub = seite(false).await;
    let elw = seite(false).await;
    schluessel(&hub.i).await;
    koppeln(&hub.i, &elw.i).await;
    melden(&elw.i).await;
    assert_eq!(faehigkeiten(&elw.i).await, (true, false));
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
        "/api/web-push/abo",
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
        "/api/web-push/abo",
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
        &format!("/api/einsaetze/{}/meldungen", w.einsatz),
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
        &format!("/api/einsaetze/{}/lage/gesehen", w.einsatz),
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
        "/api/web-push/abo",
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
