//! URL-Ebene der Fremdebenen (LLH-2100), Entwurf
//! `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md`, Abschnitte „URL-Ebene (C)“,
//! „LAN-Ziele“ und „Festlegungen nach dem Builder-Check“.
//!
//! Der echte Weg nach draußen erreicht kein lokales Ziel (Loopback ist immer gesperrt, einen
//! Schalter gibt es nicht). Deshalb ruft hier ein eingesetzter [`FremdebeneAbrufer`] ab, nach dem
//! Muster des `Zusteller` der Webhooks: er spielt ein Skript von Antworten ab und merkt sich, was
//! er bekam (URL, LAN-Entscheidung, Validatoren). Zielschutz und LAN-Entscheidung rechnet der
//! Produktionsweg; der echte `adapter::ziel::fetch_bedingt` ist in seinen Lib-Tests geprüft.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use futures::future::BoxFuture;
use lifeline_hub::adapter::ziel::BedingteAntwort;
use lifeline_hub::karte_fremdebene::abruf::{Abruf, Abrufer, FremdebeneAbrufer};
use lifeline_hub::karte_fremdebene::FremdebeneFehler;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, recv_until_tag,
    rolle_setzen, setup_mit_state,
};

const ZWEI_PUNKTE: &str = r#"{"type":"FeatureCollection","features":[
  {"type":"Feature","properties":{"name":"A"},"geometry":{"type":"Point","coordinates":[9.1,50.1]}},
  {"type":"Feature","properties":{"name":"B"},"geometry":{"type":"Point","coordinates":[9.2,50.2]}}
]}"#;

const EIN_PUNKT: &str = r#"{"type":"FeatureCollection","features":[
  {"type":"Feature","properties":{"name":"C"},"geometry":{"type":"Point","coordinates":[9.3,50.3]}}
]}"#;

const URL: &str = "https://geo.example.org/lage.geojson?token=geheim";
const LAST_MODIFIED: &str = "Wed, 21 Oct 2026 07:28:00 GMT";
const ALT: &str = "2000-01-01 00:00:00";

/// Abrufer für Tests: spielt Antworten ab, merkt sich jeden Aufruf. Ohne Skript antwortet er 304.
#[derive(Default)]
struct Doppel {
    skript: Mutex<VecDeque<Result<BedingteAntwort, FremdebeneFehler>>>,
    gesehen: Mutex<Vec<Abruf>>,
    /// So lange hält der nächste Abruf an (gleichzeitige Leser).
    warten: Mutex<Duration>,
}

impl Doppel {
    fn plane(&self, antwort: Result<BedingteAntwort, FremdebeneFehler>) {
        self.skript.lock().unwrap().push_back(antwort);
    }

    fn gesehen(&self) -> Vec<Abruf> {
        self.gesehen.lock().unwrap().clone()
    }

    fn anzahl(&self) -> usize {
        self.gesehen.lock().unwrap().len()
    }
}

impl FremdebeneAbrufer for Doppel {
    fn abrufen(&self, abruf: Abruf) -> BoxFuture<'_, Result<BedingteAntwort, FremdebeneFehler>> {
        Box::pin(async move {
            self.gesehen.lock().unwrap().push(abruf);
            let warten = *self.warten.lock().unwrap();
            if !warten.is_zero() {
                tokio::time::sleep(warten).await;
            }
            self.skript
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(nicht_geaendert()))
        })
    }
}

fn ok(inhalt: &str, etag: Option<&str>) -> Result<BedingteAntwort, FremdebeneFehler> {
    Ok(BedingteAntwort {
        status: 200,
        etag: etag.map(str::to_string),
        last_modified: Some(LAST_MODIFIED.into()),
        body: Some(inhalt.as_bytes().to_vec()),
    })
}

fn nicht_geaendert() -> BedingteAntwort {
    BedingteAntwort {
        status: 304,
        etag: None,
        last_modified: None,
        body: None,
    }
}

struct Umgebung {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    doppel: Arc<Doppel>,
    admin: String,
    einsatz: i64,
}

async fn umgebung() -> Umgebung {
    let live = LiveHub::new();
    let doppel = Arc::new(Doppel::default());
    let (app, pool) = setup_mit_state(|s| {
        s.live = live.clone();
        s.fremdebene_abrufer = Abrufer::mit(doppel.clone());
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    Umgebung {
        app,
        pool,
        live,
        doppel,
        admin,
        einsatz,
    }
}

fn basis(einsatz: i64) -> String {
    format!("/api/incidents/{einsatz}/map/foreign-layers")
}

/// POST multipart nur mit Textfeldern.
async fn anlegen(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    felder: &[(&str, &str)],
) -> (StatusCode, Value) {
    let boundary = "LLHFREMDURL";
    let mut body = String::new();
    for (name, wert) in felder {
        body.push_str(&format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{wert}\r\n"
        ));
    }
    body.push_str(&format!("--{boundary}--\r\n"));
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(basis(einsatz))
                .header(header::COOKIE, cookie)
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn daten(app: &axum::Router, einsatz: i64, ebene: i64, cookie: &str) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("{}/{ebene}/data", basis(einsatz)))
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Legt eine URL-Ebene an, deren erster Abruf `ZWEI_PUNKTE` mit ETag `"v1"` liefert.
async fn url_ebene(u: &Umgebung) -> i64 {
    u.doppel.plane(ok(ZWEI_PUNKTE, Some("\"v1\"")));
    let (s, v) = anlegen(&u.app, u.einsatz, &u.admin, &[("url", URL)]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// Rückt die Zeitstempel einer Ebene in die Vergangenheit: der nächste Leser holt nach.
async fn altern(pool: &sqlx::SqlitePool, ebene: i64) {
    sqlx::query("UPDATE karte_fremdebene SET versucht_at = ?, abgerufen_at = ? WHERE id = ?")
        .bind(ALT)
        .bind(ALT)
        .bind(ebene)
        .execute(pool)
        .await
        .unwrap();
}

async fn spalten(pool: &sqlx::SqlitePool, ebene: i64) -> (Option<String>, Option<String>, String) {
    sqlx::query_as(
        "SELECT e.quelle_etag, e.abgerufen_at, d.sha256 FROM karte_fremdebene e \
         JOIN karte_fremdebene_daten d ON d.ebene_id = e.id WHERE e.id = ?",
    )
    .bind(ebene)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn liste(u: &Umgebung, cookie: &str) -> Value {
    let (s, v) = anfrage(&u.app, "GET", &basis(u.einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    v
}

fn keine_live_meldung(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>,
) {
    while let Ok(n) = rx.try_recv() {
        assert_ne!(
            n.event.as_str(),
            "karte_fremdebene",
            "unerwartete Live-Meldung"
        );
    }
}

#[tokio::test]
async fn anlegen_mit_url_holt_sofort() {
    let u = umgebung().await;
    u.doppel.plane(ok(ZWEI_PUNKTE, Some("\"v1\"")));
    let (s, v) = anlegen(&u.app, u.einsatz, &u.admin, &[("url", URL)]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["source"], "url");
    assert_eq!(v["url"], URL, "Schreibende sehen die volle Adresse");
    assert_eq!(v["url_host"], "geo.example.org");
    assert_eq!(v["feature_count"], 2);
    assert_eq!(v["name"], "geo.example.org", "ohne Namen: der Host");
    assert!(v["fetched_at"].is_string(), "{v}");
    assert!(v.get("error").is_none(), "{v}");

    let gesehen = u.doppel.gesehen();
    assert_eq!(gesehen.len(), 1);
    assert_eq!(gesehen[0].url, URL);
    assert!(!gesehen[0].lan_erlaubt, "ohne Org-Schalter kein LAN");
    assert_eq!(
        (gesehen[0].etag.clone(), gesehen[0].last_modified.clone()),
        (None, None)
    );

    let id = v["id"].as_i64().unwrap();
    let (etag, _, _) = spalten(&u.pool, id).await;
    assert_eq!(etag.as_deref(), Some("\"v1\""));
    let (s, geo) = daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(geo["features"].as_array().unwrap().len(), 2);
    assert_eq!(u.doppel.anzahl(), 1, "gerade geholt: kein zweiter Abruf");

    // Tippfehler: das Ziel antwortet 404, die Anlage scheitert sofort und legt nichts an.
    u.doppel.plane(Err(FremdebeneFehler::Status));
    let (s, v) = anlegen(
        &u.app,
        u.einsatz,
        &u.admin,
        &[("url", "https://geo.example.org/lage.geojsn")],
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(v["grund"], "status");
    assert!(
        !v.to_string().contains("geo.example.org"),
        "die Adresse steht nie im Fehlertext: {v}"
    );
    // Inhalt, der sich nicht einlesen lässt, ebenso.
    u.doppel.plane(ok("<html>Fehler</html>", None));
    let (s, v) = anlegen(&u.app, u.einsatz, &u.admin, &[("url", URL)]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(v["grund"], "unlesbar");
    assert_eq!(liste(&u, &u.admin).await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn etag_304_aendert_nur_fetched_at() {
    let u = umgebung().await;
    let id = url_ebene(&u).await;
    let (_, _, sha_vorher) = spalten(&u.pool, id).await;
    altern(&u.pool, id).await;
    let mut rx = u.live.abonniere(u.einsatz);

    u.doppel.plane(Ok(nicht_geaendert()));
    let (s, geo) = daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(geo["features"].as_array().unwrap().len(), 2);

    let gesehen = u.doppel.gesehen();
    assert_eq!(gesehen.len(), 2);
    assert_eq!(gesehen[1].etag.as_deref(), Some("\"v1\""), "If-None-Match");
    assert_eq!(
        gesehen[1].last_modified.as_deref(),
        Some(LAST_MODIFIED),
        "If-Modified-Since"
    );

    let (etag, abgerufen, sha) = spalten(&u.pool, id).await;
    assert_eq!(
        etag.as_deref(),
        Some("\"v1\""),
        "304 behält die Validatoren"
    );
    assert_ne!(abgerufen.as_deref(), Some(ALT), "abgerufen_at rückt vor");
    assert_eq!(sha, sha_vorher, "Inhalt unverändert");
    keine_live_meldung(&mut rx);
}

#[tokio::test]
async fn neuer_inhalt_ersetzt_und_sendet_live() {
    let u = umgebung().await;
    let id = url_ebene(&u).await;
    altern(&u.pool, id).await;
    let mut rx = u.live.abonniere(u.einsatz);

    u.doppel.plane(ok(EIN_PUNKT, Some("\"v2\"")));
    let (s, geo) = daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(geo["features"].as_array().unwrap().len(), 1);
    recv_until_tag(&mut rx, "karte_fremdebene", Duration::from_secs(2)).await;

    let (etag, _, _) = spalten(&u.pool, id).await;
    assert_eq!(etag.as_deref(), Some("\"v2\""));
    assert_eq!(liste(&u, &u.admin).await[0]["feature_count"], 1);
}

#[tokio::test]
async fn fehler_behaelt_letzten_stand() {
    let u = umgebung().await;
    let id = url_ebene(&u).await;
    let (_, _, sha_vorher) = spalten(&u.pool, id).await;
    altern(&u.pool, id).await;

    u.doppel.plane(Err(FremdebeneFehler::Status));
    let (s, geo) = daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(s, StatusCode::OK, "der letzte Stand bleibt lesbar");
    assert_eq!(geo["features"].as_array().unwrap().len(), 2);

    let ebene = &liste(&u, &u.admin).await[0];
    assert_eq!(ebene["error"], "status");
    assert_eq!(ebene["fetched_at"], ALT, "kein erfolgreicher Abruf");
    assert_ne!(ebene["attempted_at"], ALT, "der Versuch zählt");
    let (_, _, sha) = spalten(&u.pool, id).await;
    assert_eq!(sha, sha_vorher);

    // Der nächste Erfolg räumt den Fehler ab.
    altern(&u.pool, id).await;
    u.doppel.plane(Ok(nicht_geaendert()));
    daten(&u.app, u.einsatz, id, &u.admin).await;
    assert!(liste(&u, &u.admin).await[0].get("error").is_none());
}

#[tokio::test]
async fn weiterleitung_wird_nicht_verfolgt() {
    let u = umgebung().await;
    u.doppel.plane(Err(FremdebeneFehler::Weiterleitung));
    let (s, v) = anlegen(&u.app, u.einsatz, &u.admin, &[("url", URL)]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(v["grund"], "weiterleitung");
    assert_eq!(
        u.doppel.anzahl(),
        1,
        "genau ein Abruf, kein zweiter zum neuen Ziel"
    );
    assert!(liste(&u, &u.admin).await.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn http_ohne_s_abgelehnt() {
    let u = umgebung().await;
    let (s, v) = anlegen(
        &u.app,
        u.einsatz,
        &u.admin,
        &[("url", "http://geo.example.org/lage.geojson")],
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(v["grund"], "abgelehnt");
    assert_eq!(u.doppel.anzahl(), 0, "vor dem Abruf abgelehnt");
}

#[tokio::test]
async fn lan_ziel_nur_mit_org_schalter() {
    let u = umgebung().await;
    let lan = "https://10.1.2.3/lage.geojson";
    let (s, v) = anlegen(&u.app, u.einsatz, &u.admin, &[("url", lan)]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(v["grund"], "ziel_intern");
    assert_eq!(u.doppel.anzahl(), 0);
    // Loopback bleibt auch mit Schalter gesperrt.
    let schalter = |an: bool| json!({ "fremdebenen_lan_erlaubt": an });
    let (s, _) = anfrage_json(
        &u.app,
        "PUT",
        "/api/org-settings",
        &u.admin,
        Some(&schalter(true)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anlegen(
        &u.app,
        u.einsatz,
        &u.admin,
        &[("url", "https://127.0.0.1/x")],
    )
    .await;
    assert_eq!(
        (s, v["grund"].clone()),
        (StatusCode::BAD_REQUEST, json!("ziel_intern"))
    );
    assert_eq!(u.doppel.anzahl(), 0);

    u.doppel.plane(ok(ZWEI_PUNKTE, None));
    let (s, v) = anlegen(&u.app, u.einsatz, &u.admin, &[("url", lan)]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert!(
        u.doppel.gesehen()[0].lan_erlaubt,
        "der Schalter reist zum Abruf"
    );
    let id = v["id"].as_i64().unwrap();

    // Abgeschaltet: der nächste Abruf scheitert mit `ziel_intern`, der Stand bleibt.
    let (s, _) = anfrage_json(
        &u.app,
        "PUT",
        "/api/org-settings",
        &u.admin,
        Some(&schalter(false)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    altern(&u.pool, id).await;
    let (s, geo) = daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(geo["features"].as_array().unwrap().len(), 2);
    assert_eq!(
        u.doppel.anzahl(),
        1,
        "ohne Schalter kein Abruf ins eigene Netz"
    );
    assert_eq!(liste(&u, &u.admin).await[0]["error"], "ziel_intern");
}

#[tokio::test]
async fn binnen_60_s_kein_zweiter_abruf() {
    let u = umgebung().await;
    let id = url_ebene(&u).await;
    daten(&u.app, u.einsatz, id, &u.admin).await;
    daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(u.doppel.anzahl(), 1);

    let setze = |sekunden: i64| {
        let pool = u.pool.clone();
        async move {
            sqlx::query(
                "UPDATE karte_fremdebene SET versucht_at = datetime('now', ?) WHERE id = ?",
            )
            .bind(format!("-{sekunden} seconds"))
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        }
    };
    setze(55).await;
    daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(u.doppel.anzahl(), 1, "55 s: noch frisch");

    setze(61).await;
    daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(u.doppel.anzahl(), 2, "61 s: nachgeholt");
}

#[tokio::test]
async fn gleichzeitige_leser_ein_abruf() {
    let u = umgebung().await;
    let id = url_ebene(&u).await;
    altern(&u.pool, id).await;
    *u.doppel.warten.lock().unwrap() = Duration::from_millis(300);
    u.doppel.plane(ok(EIN_PUNKT, Some("\"v2\"")));

    let (a, b) = tokio::join!(
        daten(&u.app, u.einsatz, id, &u.admin),
        daten(&u.app, u.einsatz, id, &u.admin)
    );
    assert_eq!((a.0, b.0), (StatusCode::OK, StatusCode::OK));
    assert_eq!(u.doppel.anzahl(), 2, "Anlage und genau ein Nachholen");
    // Beide Wartenden bekommen das Ergebnis des einen Abrufs.
    assert_eq!(a.1["features"].as_array().unwrap().len(), 1);
    assert_eq!(b.1["features"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn spiegel_und_abgeschlossen_holen_nicht() {
    let u = umgebung().await;
    let id = url_ebene(&u).await;
    altern(&u.pool, id).await;
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(u.einsatz)
        .execute(&u.pool)
        .await
        .unwrap();
    let (s, _) = daten(&u.app, u.einsatz, id, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        u.doppel.anzahl(),
        1,
        "abgeschlossen: der letzte Stand bleibt Teil der Akte"
    );

    // Spiegel: nur die führende Seite holt nach.
    let zweiter = einsatz_anlegen(&u.app, &u.admin).await;
    u.doppel.plane(ok(ZWEI_PUNKTE, None));
    let (s, v) = anlegen(&u.app, zweiter, &u.admin, &[("url", URL)]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id2 = v["id"].as_i64().unwrap();
    altern(&u.pool, id2).await;
    let mut tx = u.pool.begin().await.unwrap();
    for sql in [
        "INSERT INTO spiegel_uebernahme (id) VALUES (1)".to_string(),
        format!(
            "INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES ({zweiter}, 'x/{zweiter}')"
        ),
        "DELETE FROM spiegel_uebernahme".to_string(),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    let (s, _) = daten(&u.app, zweiter, id2, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u.doppel.anzahl(), 2, "am Spiegel kein Abruf");
}

#[tokio::test]
async fn beobachter_sieht_nur_url_host() {
    let u = umgebung().await;
    let beo_id = benutzer_anlegen(&u.app, &u.admin, "beobachter1", "keine").await;
    rolle_setzen(&u.app, &u.admin, u.einsatz, beo_id, "beobachter").await;
    let beo = login_cookie(&u.app, "beobachter1", "beobachter1pw1").await;

    let (s, _) = anlegen(&u.app, u.einsatz, &beo, &[("url", URL)]).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(u.doppel.anzahl(), 0);

    let id = url_ebene(&u).await;
    let l = liste(&u, &beo).await;
    assert!(
        !l[0].as_object().unwrap().contains_key("url"),
        "Leser sehen die volle Adresse nicht: {l}"
    );
    assert_eq!(l[0]["url_host"], "geo.example.org");
    assert!(!l.to_string().contains("token=geheim"));

    // Lesen holt auch für Beobachter nach; die Adresse bleibt ihnen verborgen.
    altern(&u.pool, id).await;
    let (s, _) = daten(&u.app, u.einsatz, id, &beo).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u.doppel.anzahl(), 2);
}
