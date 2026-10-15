//! Web Push bei geschlossenem Tab (LLH-1223, Change `hotzhx58-web-push`, Spec `web-push`): die
//! Routen, die Bindung an die Sitzung und der Versand an einen lokalen Test-Push-Dienst.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use lifeline_hub::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt as Art, BenachrichtigungBezugTyp as Typ, Bezug,
};
use lifeline_hub::live::LiveHub;
use lifeline_hub::web_push::krypto::{b64, entschluesseln, Schluessel};
use lifeline_hub::web_push::{repo, WebPush, PUSH_DIENSTE};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool_und_live,
};

const FCM: &str = "https://fcm.googleapis.com/fcm/send/geraet-1";

/// Ein gültiges Abo eines Browsers: Endpunkt, sein Schlüsselpaar und `auth`.
struct Browser {
    schluessel: Schluessel,
    auth: [u8; 16],
}

impl Browser {
    fn neu() -> Self {
        Browser {
            schluessel: Schluessel::erzeugen().unwrap(),
            auth: [3u8; 16],
        }
    }

    fn abo(&self, endpoint: &str) -> String {
        json!({
            "endpoint": endpoint,
            "p256dh": b64(self.schluessel.oeffentlich()),
            "auth": b64(&self.auth),
        })
        .to_string()
    }
}

async fn mit_web_push(
    dienste: &'static [&'static str],
) -> (axum::Router, sqlx::SqlitePool, LiveHub) {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    live.web_push_einrichten(
        WebPush::einrichten_fuer_test(&pool, dienste, false)
            .await
            .unwrap(),
    );
    (app, pool, live)
}

#[tokio::test]
async fn ohne_schalter_antworten_die_routen_404() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    assert!(live.web_push().is_none());
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = Browser::neu();
    assert_eq!(
        anfrage(&app, "GET", "/api/web-push", &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        anfrage(&app, "PUT", "/api/web-push/abo", &admin, Some(&b.abo(FCM)))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        anfrage(&app, "DELETE", "/api/web-push/abo", &admin, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn anmelden_und_abmelden_fuer_diese_sitzung() {
    let (app, pool, _live) = mit_web_push(PUSH_DIENSTE).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anfrage(&app, "GET", "/api/web-push", &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["angemeldet"], false);
    let schluessel =
        lifeline_hub::web_push::krypto::b64_lesen(v["schluessel"].as_str().unwrap()).unwrap();
    assert_eq!(schluessel.len(), 65);
    assert_eq!(schluessel[0], 0x04);

    let b = Browser::neu();
    let (s, v) = anfrage(&app, "PUT", "/api/web-push/abo", &admin, Some(&b.abo(FCM))).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    assert_eq!(
        anfrage(&app, "GET", "/api/web-push", &admin, None).await.1["angemeldet"],
        true
    );

    // Eine zweite Sitzung desselben Nutzers hat kein Abo.
    let zweite = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(
        anfrage(&app, "GET", "/api/web-push", &zweite, None).await.1["angemeldet"],
        false
    );

    for _ in 0..2 {
        assert_eq!(
            anfrage(&app, "DELETE", "/api/web-push/abo", &admin, None)
                .await
                .0,
            StatusCode::NO_CONTENT
        );
    }
    assert_eq!(
        anfrage(&app, "GET", "/api/web-push", &admin, None).await.1["angemeldet"],
        false
    );
    let zahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_push_abo")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(zahl, 0);
}

#[tokio::test]
async fn fremde_endpunkte_und_kaputte_schluessel_sind_400() {
    let (app, pool, _live) = mit_web_push(PUSH_DIENSTE).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = Browser::neu();
    let lang = format!("{FCM}/{}", "x".repeat(2100));
    let faelle = [
        b.abo("https://10.0.0.5/push"),
        b.abo("http://fcm.googleapis.com/fcm/send/x"),
        b.abo("https://fcm.googleapis.com:8443/fcm/send/x"),
        b.abo("https://intranet.local/push"),
        b.abo(&lang),
        json!({ "endpoint": FCM, "p256dh": "kein*base64", "auth": b64(&b.auth) }).to_string(),
        json!({ "endpoint": FCM, "p256dh": b64(&[4u8; 65]), "auth": b64(&b.auth) }).to_string(),
        json!({ "endpoint": FCM, "p256dh": b64(b.schluessel.oeffentlich()), "auth": b64(&[1u8; 8]) })
            .to_string(),
    ];
    for f in faelle {
        let (s, v) = anfrage(&app, "PUT", "/api/web-push/abo", &admin, Some(&f)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{f}: {v}");
    }
    let zahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_push_abo")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(zahl, 0);
}

/// Spec „Abo gilt für ein Gerät und eine Sitzung“: dasselbe Browserprofil mit einem anderen
/// Nutzer gehört danach nur ihm; Abmelden löscht das Abo.
#[tokio::test]
async fn abo_folgt_der_sitzung_und_faellt_beim_abmelden() {
    let (app, pool, _live) = mit_web_push(PUSH_DIENSTE).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let anna = login_cookie(&app, "annika", "annikapw1").await;
    let b = Browser::neu();

    assert_eq!(
        anfrage(&app, "PUT", "/api/web-push/abo", &admin, Some(&b.abo(FCM)))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anfrage(&app, "PUT", "/api/web-push/abo", &anna, Some(&b.abo(FCM)))
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anfrage(&app, "GET", "/api/web-push", &admin, None).await.1["angemeldet"],
        false
    );
    assert_eq!(
        anfrage(&app, "GET", "/api/web-push", &anna, None).await.1["angemeldet"],
        true
    );

    let (s, _) = anfrage(&app, "POST", "/api/auth/logout", &anna, None).await;
    assert!(s.is_success(), "{s}");
    let zahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_push_abo")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(zahl, 0, "Abo fällt mit der Sitzung");
}

#[tokio::test]
async fn geraetekonto_bekommt_kein_abo() {
    let (app, _pool, _live) = mit_web_push(PUSH_DIENSTE).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        Some(r#"{"ansicht":"lagemonitor","bezeichnung":"Monitor"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/geraete/koppeln")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let geraet = resp.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let b = Browser::neu();
    let (s, _) = anfrage(&app, "PUT", "/api/web-push/abo", &geraet, Some(&b.abo(FCM))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

// ---------- Versand an einen lokalen Test-Push-Dienst ----------

/// Was der Test-Push-Dienst empfangen hat.
#[derive(Debug)]
struct Empfang {
    pfad: String,
    kopf: HeaderMap,
    rumpf: Vec<u8>,
}

/// Startet einen Push-Dienst auf 127.0.0.1, der mit `status` antwortet (veränderbar) und jede
/// Anfrage meldet. Liefert seine Basis-URL.
async fn push_dienst(status: Arc<AtomicU16>) -> (String, mpsc::UnboundedReceiver<Empfang>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let app = axum::Router::new().fallback(move |req: Request<Body>| {
        let tx = tx.clone();
        let status = status.clone();
        async move {
            let pfad = req.uri().path().to_owned();
            let kopf = req.headers().clone();
            let rumpf = to_bytes(req.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec();
            let _ = tx.send(Empfang { pfad, kopf, rumpf });
            StatusCode::from_u16(status.load(Ordering::SeqCst)).unwrap()
        }
    });
    let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = lauscher.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(lauscher, app).await.unwrap() });
    (format!("http://{adresse}"), rx)
}

struct Versandwelt {
    pool: sqlx::SqlitePool,
    live: LiveHub,
    einsatz: i64,
    anna: i64,
    bert: i64,
    status: Arc<AtomicU16>,
    basis: String,
    empfang: mpsc::UnboundedReceiver<Empfang>,
}

async fn versandwelt() -> Versandwelt {
    let (app, pool, live) = mit_web_push(&["127.0.0.1"]).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    rolle_setzen(&app, &admin, einsatz, anna, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, bert, "fuehrungspersonal").await;
    let status = Arc::new(AtomicU16::new(201));
    let (basis, empfang) = push_dienst(status.clone()).await;
    Versandwelt {
        pool,
        live,
        einsatz,
        anna,
        bert,
        status,
        basis,
        empfang,
    }
}

impl Versandwelt {
    /// Legt ein Abo für `benutzer` direkt im Speicher an (die Route nimmt kein `http`), mit
    /// einer eigenen Sitzung.
    async fn abo(&self, benutzer: i64, pfad: &str, b: &Browser) {
        let token = lifeline_hub::auth::session::anlegen(
            &self.pool,
            benutzer,
            None,
            lifeline_hub::auth::provider::Anmeldeweg::Passwort,
        )
        .await
        .unwrap();
        repo::anmelden(
            &self.pool,
            benutzer,
            &lifeline_hub::auth::session::hash_token(&token),
            &format!("{}{pfad}", self.basis),
            &b64(b.schluessel.oeffentlich()),
            &b64(&b.auth),
        )
        .await
        .unwrap();
    }

    async fn naechster(&mut self) -> Empfang {
        tokio::time::timeout(Duration::from_secs(10), self.empfang.recv())
            .await
            .expect("Push innerhalb von 10 s")
            .unwrap()
    }

    async fn keiner(&mut self) {
        let r = tokio::time::timeout(Duration::from_millis(500), self.empfang.recv()).await;
        assert!(r.is_err(), "unerwarteter Push: {r:?}");
    }

    async fn melden_an(&self, art: Art, bezug: Typ, an: i64) -> Vec<i64> {
        melden(
            &self.pool,
            &self.live,
            Anlass::neu(self.einsatz, art, Bezug::neu(bezug, 1)).an(Adressat::Nutzer(an)),
        )
        .await
    }
}

/// Spec „Push an jedes Abo der Empfänger“: beide Geräte von A, keins von B; die Nutzlast trägt
/// nur Kennungen und ist für den Push-Dienst unlesbar.
#[tokio::test]
async fn alarm_geht_verschluesselt_an_jedes_abo_des_empfaengers() {
    let mut w = versandwelt().await;
    let handy = Browser::neu();
    let laptop = Browser::neu();
    let fremd = Browser::neu();
    w.abo(w.anna, "/anna-handy", &handy).await;
    w.abo(w.anna, "/anna-laptop", &laptop).await;
    w.abo(w.bert, "/bert", &fremd).await;

    let empfaenger = w.melden_an(Art::Sofortmeldung, Typ::Meldung, w.anna).await;
    assert_eq!(empfaenger, vec![w.anna]);

    let mut pfade = Vec::new();
    for _ in 0..2 {
        let e = w.naechster().await;
        assert_eq!(e.kopf["content-encoding"], "aes128gcm");
        assert_eq!(e.kopf["urgency"], "high");
        assert_eq!(e.kopf["ttl"], "43200");
        let vapid = e.kopf["authorization"].to_str().unwrap();
        assert!(vapid.starts_with("vapid t="), "{vapid}");
        let browser = if e.pfad == "/anna-handy" {
            &handy
        } else {
            &laptop
        };
        let klar = entschluesseln(&e.rumpf, &browser.schluessel, &browser.auth).unwrap();
        let v: Value = serde_json::from_slice(&klar).unwrap();
        assert_eq!(v["art"], "sofortmeldung");
        assert_eq!(v["stufe"], "alarm");
        assert_eq!(v["einsatz_id"], w.einsatz);
        assert!(v["benachrichtigung_id"].is_i64());
        assert!(
            v.get("titel").is_none() && v.get("detail").is_none(),
            "nur Kennungen: {v}"
        );
        assert!(!String::from_utf8_lossy(&e.rumpf).contains("sofortmeldung"));
        pfade.push(e.pfad);
    }
    pfade.sort();
    assert_eq!(pfade, ["/anna-handy", "/anna-laptop"]);
    w.keiner().await;
}

#[tokio::test]
async fn hinweis_geht_mit_normaler_dringlichkeit() {
    let mut w = versandwelt().await;
    let b = Browser::neu();
    w.abo(w.anna, "/anna", &b).await;
    w.melden_an(Art::AuftragErteilt, Typ::Auftrag, w.anna).await;
    let e = w.naechster().await;
    assert_eq!(e.kopf["urgency"], "normal");
}

/// Spec, „Abgeschaltete Hinweis-Art“: kein Push an die Geräte.
#[tokio::test]
async fn abgeschaltete_hinweis_art_sendet_nichts() {
    let mut w = versandwelt().await;
    let b = Browser::neu();
    w.abo(w.anna, "/anna", &b).await;
    sqlx::query(
        "INSERT INTO benutzer_einstellungen (benutzer_id, schluessel, wert, geaendert_at) \
         VALUES (?, 'benachrichtigungen_aus', '[\"gefahr\"]', datetime('now'))",
    )
    .bind(w.anna)
    .execute(&w.pool)
    .await
    .unwrap();
    assert!(w
        .melden_an(Art::Gefahr, Typ::Gefahrengebiet, w.anna)
        .await
        .is_empty());
    w.keiner().await;
}

/// Spec, „Erloschenes Abo“: 410 löscht das Abo, 500 nicht.
#[tokio::test]
async fn erloschenes_abo_wird_geloescht() {
    let mut w = versandwelt().await;
    let b = Browser::neu();
    w.abo(w.anna, "/anna", &b).await;

    w.status.store(500, Ordering::SeqCst);
    w.melden_an(Art::Sofortmeldung, Typ::Meldung, w.anna).await;
    w.naechster().await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(repo::abos_von(&w.pool, &[w.anna]).await.unwrap().len(), 1);

    w.status.store(410, Ordering::SeqCst);
    w.melden_an(Art::Sofortmeldung, Typ::Meldung, w.anna).await;
    w.naechster().await;
    for _ in 0..50 {
        if repo::abos_von(&w.pool, &[w.anna]).await.unwrap().is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("Abo nach 410 nicht gelöscht");
}

/// Spec, „Push-Dienst nicht erreichbar“: `melden` wartet nie auf den Push-Dienst.
#[tokio::test]
async fn haengender_push_dienst_haelt_melden_nicht_auf() {
    let w = versandwelt().await;
    let b = Browser::neu();
    // Ein Port, der annimmt, aber nie antwortet.
    let stumm = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = stumm.local_addr().unwrap();
    let token = lifeline_hub::auth::session::anlegen(
        &w.pool,
        w.anna,
        None,
        lifeline_hub::auth::provider::Anmeldeweg::Passwort,
    )
    .await
    .unwrap();
    repo::anmelden(
        &w.pool,
        w.anna,
        &lifeline_hub::auth::session::hash_token(&token),
        &format!("http://{adresse}/haengt"),
        &b64(b.schluessel.oeffentlich()),
        &b64(&b.auth),
    )
    .await
    .unwrap();
    let start = std::time::Instant::now();
    w.melden_an(Art::Sofortmeldung, Typ::Meldung, w.anna).await;
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "{:?}",
        start.elapsed()
    );
    drop(stumm);
}

// ── Speicher: das Abo hängt an der Sitzung ───────────────────────────────────────────────

async fn sitzung(pool: &sqlx::SqlitePool, benutzer: i64) -> String {
    lifeline_hub::auth::session::anlegen(
        pool,
        benutzer,
        None,
        lifeline_hub::auth::provider::Anmeldeweg::Passwort,
    )
    .await
    .unwrap()
}

async fn admin_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn abo_haengt_an_der_sitzung_und_faellt_mit_ihr() {
    let (_app, pool, _live) = setup_mit_pool_und_live().await;
    let benutzer = admin_id(&pool).await;
    let token = sitzung(&pool, benutzer).await;
    let hash = lifeline_hub::auth::session::hash_token(&token);
    repo::anmelden(&pool, benutzer, &hash, FCM, "p", "a")
        .await
        .unwrap();
    assert!(repo::hat_abo(&pool, &hash).await.unwrap());
    assert_eq!(repo::abos_von(&pool, &[benutzer]).await.unwrap().len(), 1);

    lifeline_hub::auth::session::loeschen(&pool, &token)
        .await
        .unwrap();
    assert!(!repo::hat_abo(&pool, &hash).await.unwrap());
    assert!(repo::abos_von(&pool, &[benutzer]).await.unwrap().is_empty());
}

#[tokio::test]
async fn gleicher_endpunkt_haengt_an_die_neue_sitzung_um() {
    let (_app, pool, _live) = setup_mit_pool_und_live().await;
    let benutzer = admin_id(&pool).await;
    let alt = lifeline_hub::auth::session::hash_token(&sitzung(&pool, benutzer).await);
    let neu = lifeline_hub::auth::session::hash_token(&sitzung(&pool, benutzer).await);
    repo::anmelden(&pool, benutzer, &alt, FCM, "p1", "a1")
        .await
        .unwrap();
    repo::anmelden(&pool, benutzer, &neu, FCM, "p2", "a2")
        .await
        .unwrap();
    assert!(!repo::hat_abo(&pool, &alt).await.unwrap());
    assert!(repo::hat_abo(&pool, &neu).await.unwrap());
    let abos = repo::abos_von(&pool, &[benutzer]).await.unwrap();
    assert_eq!(abos.len(), 1);
    assert_eq!(
        (abos[0].p256dh.as_str(), abos[0].auth.as_str()),
        ("p2", "a2")
    );

    // Ein erloschenes Abo fällt nur, solange es denselben Endpunkt hat.
    repo::erloschen(&pool, abos[0].id, "https://anders")
        .await
        .unwrap();
    assert!(repo::hat_abo(&pool, &neu).await.unwrap());
    repo::erloschen(&pool, abos[0].id, FCM).await.unwrap();
    assert!(!repo::hat_abo(&pool, &neu).await.unwrap());
}
