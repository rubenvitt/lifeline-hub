mod gemeinsam;
use axum::{
    body::Body,
    http::{header, HeaderMap, Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use push_relais::{
    api::{router, RelaisState},
    speicher::{self, Pruefung},
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

/// Eine bei Apple (dem Doppel) angekommene Anfrage.
#[derive(Clone, Debug)]
struct Erfasst {
    pfad: String,
    koepfe: HeaderMap,
    rumpf: Value,
}

struct Doppel {
    basis: String,
    erfasst: Arc<Mutex<Vec<Erfasst>>>,
}

/// Lokaler APNs-Ersatz (h2c); antwortet mit `status` und `antwort`.
async fn doppel(status: u16, antwort: &'static str) -> Doppel {
    let erfasst: Arc<Mutex<Vec<Erfasst>>> = Arc::default();
    let sammler = erfasst.clone();
    let app = Router::new().fallback(move |req: Request<Body>| {
        let sammler = sammler.clone();
        async move {
            let (teile, body) = req.into_parts();
            let bytes = body.collect().await.unwrap().to_bytes();
            sammler.lock().unwrap().push(Erfasst {
                pfad: teile.uri.path().to_string(),
                koepfe: teile.headers,
                rumpf: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            });
            (StatusCode::from_u16(status).unwrap(), antwort)
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let basis = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Doppel { basis, erfasst }
}

/// APNs-Ersatz (h2c), der Anfragen an Token aus `haengen` nie beantwortet und alle übrigen mit
/// 200 zustellt.
async fn doppel_haengt_bei(haengen: &'static [&'static str]) -> Doppel {
    let erfasst: Arc<Mutex<Vec<Erfasst>>> = Arc::default();
    let sammler = erfasst.clone();
    let app = Router::new().fallback(move |req: Request<Body>| {
        let sammler = sammler.clone();
        async move {
            let pfad = req.uri().path().to_string();
            if haengen.iter().any(|t| pfad.contains(t)) {
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            }
            sammler.lock().unwrap().push(Erfasst {
                pfad,
                koepfe: req.headers().clone(),
                rumpf: Value::Null,
            });
            (StatusCode::OK, "")
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let basis = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Doppel { basis, erfasst }
}

async fn aufbau(basis: &str, limit: u32) -> (Router, SqlitePool, String) {
    let pool = speicher::oeffnen(":memory:").await.unwrap();
    let zugang = speicher::registrieren(&pool, None, "1.0.0").await.unwrap();
    let bearer = format!("Bearer {}.{}", zugang.server_id, zugang.geheimnis);
    let app = router(RelaisState::neu(
        pool.clone(),
        10,
        false,
        gemeinsam::apns_client(basis),
        limit,
    ));
    (app, pool, bearer)
}

fn senden_anfrage(bearer: Option<&str>, body: Value) -> Request<Body> {
    let mut b = Request::post("/v1/senden").header(header::CONTENT_TYPE, "application/json");
    if let Some(bearer) = bearer {
        b = b.header(header::AUTHORIZATION, bearer);
    }
    b.body(Body::from(body.to_string())).unwrap()
}

fn nachricht(stufe: &str, umgebung: &str) -> Value {
    json!({ "token": "ab12cd34", "umgebung": umgebung, "stufe": stufe, "nutzlast": "eyJrIjoiMSJ9" })
}

async fn json_antwort(antwort: axum::response::Response) -> Value {
    let bytes = antwort.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn jetzt() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[tokio::test]
async fn alarm_geht_zeitkritisch_mit_rueckfalltitel_an_apple() {
    let d = doppel(200, "").await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    let antwort = app
        .oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": [nachricht("alarm", "production")] }),
        ))
        .await
        .unwrap();
    assert_eq!(antwort.status(), StatusCode::OK);
    assert_eq!(
        json_antwort(antwort).await,
        json!({ "ergebnisse": ["zugestellt"] })
    );
    let e = d.erfasst.lock().unwrap();
    assert_eq!(e.len(), 1);
    assert_eq!(e[0].pfad, "/3/device/ab12cd34");
    let k = &e[0].koepfe;
    assert_eq!(k["apns-topic"], "dev.rubeen.lifeline.ios");
    assert_eq!(k["apns-push-type"], "alert");
    assert_eq!(k["apns-priority"], "10");
    let ablauf: i64 = k["apns-expiration"].to_str().unwrap().parse().unwrap();
    assert!((ablauf - (jetzt() + 43200)).abs() < 30);
    let auth = k["authorization"].to_str().unwrap();
    let jwt = auth.strip_prefix("bearer ").unwrap();
    assert_eq!(jwt.split('.').count(), 3);
    let aps = &e[0].rumpf["aps"];
    assert_eq!(aps["alert"]["title"], "Alarm");
    assert_eq!(aps["interruption-level"], "time-sensitive");
    assert_eq!(aps["mutable-content"], 1);
    assert_eq!(aps["sound"], "default");
    assert_eq!(e[0].rumpf["l"], "eyJrIjoiMSJ9");
}

#[tokio::test]
async fn hinweis_geht_mit_active_und_eigenem_titel() {
    let d = doppel(200, "").await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    app.oneshot(senden_anfrage(
        Some(&bearer),
        json!({ "nachrichten": [nachricht("hinweis", "production")] }),
    ))
    .await
    .unwrap();
    let e = d.erfasst.lock().unwrap();
    let aps = &e[0].rumpf["aps"];
    assert_eq!(aps["alert"]["title"], "Neue Benachrichtigung");
    assert_eq!(aps["interruption-level"], "active");
}

#[tokio::test]
async fn kollaps_wird_zu_apns_collapse_id() {
    let d = doppel(200, "").await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    let mut mit = nachricht("alarm", "production");
    mit["kollaps"] = json!("abc123");
    let mut ohne = nachricht("alarm", "production");
    ohne["token"] = json!("ef56");
    app.oneshot(senden_anfrage(
        Some(&bearer),
        json!({ "nachrichten": [mit, ohne] }),
    ))
    .await
    .unwrap();
    // Die Anfragen laufen nebenläufig: zuordnen über das Token im Pfad.
    let e = d.erfasst.lock().unwrap();
    let an = |token: &str| {
        e.iter()
            .find(|x| x.pfad == format!("/3/device/{token}"))
            .unwrap()
    };
    assert_eq!(an("ab12cd34").koepfe["apns-collapse-id"], "abc123");
    assert!(an("ef56").koepfe.get("apns-collapse-id").is_none());
}

#[tokio::test]
async fn sandbox_geht_an_die_sandbox_basis() {
    let sandbox = doppel(200, "").await;
    let produktiv = doppel(200, "").await;
    let mut cfg = gemeinsam::config(&produktiv.basis);
    cfg.apns_basis_sandbox = sandbox.basis.clone();
    let pool = speicher::oeffnen(":memory:").await.unwrap();
    let zugang = speicher::registrieren(&pool, None, "1").await.unwrap();
    let bearer = format!("Bearer {}.{}", zugang.server_id, zugang.geheimnis);
    let app = router(RelaisState::neu(
        pool,
        10,
        false,
        push_relais::apns::ApnsClient::neu(&cfg).unwrap(),
        600,
    ));
    app.oneshot(senden_anfrage(
        Some(&bearer),
        json!({ "nachrichten": [nachricht("alarm", "sandbox")] }),
    ))
    .await
    .unwrap();
    assert_eq!(sandbox.erfasst.lock().unwrap().len(), 1);
    assert_eq!(produktiv.erfasst.lock().unwrap().len(), 0);
}

async fn ergebnis_bei(status: u16, antwort: &'static str) -> Value {
    let d = doppel(status, antwort).await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    let a = app
        .oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": [nachricht("alarm", "production")] }),
        ))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::OK);
    json_antwort(a).await["ergebnisse"][0].clone()
}

#[tokio::test]
async fn apple_410_und_bad_device_token_werden_token_ungueltig() {
    assert_eq!(
        ergebnis_bei(410, r#"{"reason":"Unregistered"}"#).await,
        "token_ungueltig"
    );
    assert_eq!(
        ergebnis_bei(400, r#"{"reason":"BadDeviceToken"}"#).await,
        "token_ungueltig"
    );
    assert_eq!(
        ergebnis_bei(400, r#"{"reason":"PayloadEmpty"}"#).await,
        "fehler"
    );
}

#[tokio::test]
async fn apple_429_wird_gedrosselt() {
    assert_eq!(
        ergebnis_bei(429, r#"{"reason":"TooManyRequests"}"#).await,
        "gedrosselt"
    );
}

#[tokio::test]
async fn apple_500_wird_fehler() {
    assert_eq!(ergebnis_bei(500, "").await, "fehler");
}

#[tokio::test]
async fn ohne_bearer_401_gesperrt_403() {
    let d = doppel(200, "").await;
    let (app, pool, bearer) = aufbau(&d.basis, 600).await;
    let body = json!({ "nachrichten": [nachricht("alarm", "production")] });

    let a = app
        .clone()
        .oneshot(senden_anfrage(None, body.clone()))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(json_antwort(a).await, json!({ "fehler": "unbekannt" }));

    let a = app
        .clone()
        .oneshot(senden_anfrage(Some("Bearer falsch.falsch"), body.clone()))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::UNAUTHORIZED);

    let id = bearer
        .strip_prefix("Bearer ")
        .unwrap()
        .split('.')
        .next()
        .unwrap();
    speicher::sperren(&pool, id).await.unwrap();
    let a = app
        .oneshot(senden_anfrage(Some(&bearer), body))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::FORBIDDEN);
    assert_eq!(json_antwort(a).await, json!({ "fehler": "gesperrt" }));
    assert!(d.erfasst.lock().unwrap().is_empty());
    let _ = Pruefung::Gesperrt;
}

#[tokio::test]
async fn mehr_als_100_nachrichten_400() {
    let d = doppel(200, "").await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    let viele: Vec<Value> = (0..101).map(|_| nachricht("alarm", "production")).collect();
    let a = app
        .clone()
        .oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": viele }),
        ))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::BAD_REQUEST);
    let mut gross = nachricht("alarm", "production");
    gross["nutzlast"] = json!("a".repeat(4097));
    let a = app
        .oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": [gross] }),
        ))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::BAD_REQUEST);
    assert!(d.erfasst.lock().unwrap().is_empty());
}

#[tokio::test]
async fn limit_je_server_429() {
    let d = doppel(200, "").await;
    let (app, _, bearer) = aufbau(&d.basis, 3).await;
    let zwei = json!({ "nachrichten": [nachricht("alarm", "production"), nachricht("alarm", "production")] });
    let a = app
        .clone()
        .oneshot(senden_anfrage(Some(&bearer), zwei.clone()))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::OK);
    let a = app
        .oneshot(senden_anfrage(Some(&bearer), zwei))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(d.erfasst.lock().unwrap().len(), 2);
}

#[derive(Clone, Default)]
struct Puffer(Arc<Mutex<Vec<u8>>>);
impl std::io::Write for Puffer {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Puffer {
    type Writer = Puffer;
    fn make_writer(&'a self) -> Puffer {
        self.clone()
    }
}

#[tokio::test]
async fn log_enthaelt_weder_token_noch_nutzlast() {
    // Globaler Abonnent: ein threadlokaler würde vom Zwischenspeicher der Aufrufstellen
    // ausgebremst, den parallel laufende Tests ohne Abonnent füllen. Andere Tests schreiben
    // mit, aber nie die eindeutigen Werte dieses Tests.
    static PUFFER: std::sync::OnceLock<Puffer> = std::sync::OnceLock::new();
    let puffer = PUFFER
        .get_or_init(|| {
            let p = Puffer::default();
            tracing::subscriber::set_global_default(
                tracing_subscriber::fmt()
                    .with_writer(p.clone())
                    .with_max_level(tracing::Level::TRACE)
                    .finish(),
            )
            .unwrap();
            p
        })
        .clone();
    // Erster Lauf: Doppel antwortet, zweiter: Doppel nicht erreichbar (Fehlerpfad).
    let d = doppel(200, "").await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    let mut n = nachricht("alarm", "production");
    n["token"] = json!("deadbeef0123456789");
    n["nutzlast"] = json!("GEHEIMENUTZLAST");
    let body = json!({ "nachrichten": [n] });
    app.oneshot(senden_anfrage(Some(&bearer), body.clone()))
        .await
        .unwrap();
    let (app2, _, bearer2) = aufbau("http://127.0.0.1:9", 600).await;
    app2.oneshot(senden_anfrage(Some(&bearer2), body))
        .await
        .unwrap();

    let log = String::from_utf8(puffer.0.lock().unwrap().clone()).unwrap();
    assert!(log.contains("senden"), "Log war leer: {log}");
    assert!(!log.contains("deadbeef0123456789"));
    assert!(!log.contains("GEHEIMENUTZLAST"));
}

fn nachrichten_mit_token(anzahl: usize) -> Vec<Value> {
    (0..anzahl)
        .map(|i| {
            let mut n = nachricht("alarm", "production");
            n["token"] = json!(format!("ab{i:04}"));
            n
        })
        .collect()
}

/// Review B-I1: eine hängende Anfrage bei Apple hält die übrigen des Aufrufs nicht auf. Vorher
/// ging das Relais die Nachrichten der Reihe nach durch und wartete 10 s auf jede; der Server gibt
/// dem ganzen Aufruf aber nur begrenzt Zeit, und der Rest des Stapels ging verloren.
#[tokio::test]
async fn haengende_apns_anfrage_haelt_die_uebrigen_nicht_auf() {
    let d = doppel_haengt_bei(&["ab0003"]).await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    let start = std::time::Instant::now();
    let a = tokio::time::timeout(
        std::time::Duration::from_secs(25),
        app.oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": nachrichten_mit_token(20) }),
        )),
    )
    .await
    .expect("Aufruf endet")
    .unwrap();
    let dauer = start.elapsed();
    assert_eq!(a.status(), StatusCode::OK);
    let ergebnisse = json_antwort(a).await["ergebnisse"].clone();
    let erwartet: Vec<&str> = (0..20)
        .map(|i| if i == 3 { "fehler" } else { "zugestellt" })
        .collect();
    assert_eq!(ergebnisse, json!(erwartet), "Reihenfolge wie die Eingabe");
    assert_eq!(d.erfasst.lock().unwrap().len(), 19);
    // Frist je Anfrage bei Apple (5 s) plus Spielraum; der Server wartet 30 s.
    assert!(
        dauer < std::time::Duration::from_secs(8),
        "dauerte {dauer:?}"
    );
}

/// Review B-I1: hängt Apple ganz, endet der Aufruf mit der Gesamtfrist des Relais, und jede
/// nicht zugestellte Nachricht ist `fehler`.
#[tokio::test]
async fn gesamtfrist_beendet_den_aufruf_mit_fehlern() {
    let d = doppel_haengt_bei(&["ab"]).await;
    let pool = speicher::oeffnen(":memory:").await.unwrap();
    let zugang = speicher::registrieren(&pool, None, "1").await.unwrap();
    let bearer = format!("Bearer {}.{}", zugang.server_id, zugang.geheimnis);
    let app = router(
        RelaisState::neu(pool, 10, false, gemeinsam::apns_client(&d.basis), 600)
            .mit_gesamtfrist(std::time::Duration::from_secs(1)),
    );
    let start = std::time::Instant::now();
    let a = tokio::time::timeout(
        std::time::Duration::from_secs(25),
        app.oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": nachrichten_mit_token(100) }),
        )),
    )
    .await
    .expect("Aufruf endet")
    .unwrap();
    let dauer = start.elapsed();
    assert_eq!(a.status(), StatusCode::OK);
    let ergebnisse = json_antwort(a).await["ergebnisse"].clone();
    assert_eq!(ergebnisse, json!(vec!["fehler"; 100]));
    assert!(
        dauer < std::time::Duration::from_secs(3),
        "dauerte {dauer:?}"
    );
}

/// Review B-I2/M2: was Apple ohnehin ablehnt, weist das Relais früh ab. Der ganze Push darf bei
/// Apple 4096 Byte haben (samt `aps` und Rückfalltitel), die Kollaps-Kennung 64 Byte; ein Token
/// hat höchstens 200 Hex-Zeichen. Der Körper eines Aufrufs ist passend zu 100 Nachrichten
/// begrenzt.
#[tokio::test]
async fn felder_die_apple_ablehnt_werden_frueh_abgewiesen() {
    let d = doppel(200, "").await;
    let (app, _, bearer) = aufbau(&d.basis, 600).await;
    let status = |nachricht: Value| {
        let app = app.clone();
        let bearer = bearer.clone();
        async move {
            app.oneshot(senden_anfrage(
                Some(&bearer),
                json!({ "nachrichten": [nachricht] }),
            ))
            .await
            .unwrap()
            .status()
        }
    };
    let mut gross = nachricht("hinweis", "production");
    gross["nutzlast"] = json!("a".repeat(4000));
    assert_eq!(status(gross).await, StatusCode::BAD_REQUEST);
    let mut kollaps = nachricht("alarm", "production");
    kollaps["kollaps"] = json!("k".repeat(65));
    assert_eq!(status(kollaps).await, StatusCode::BAD_REQUEST);
    let mut kollaps = nachricht("alarm", "production");
    kollaps["kollaps"] = json!("a b");
    assert_eq!(status(kollaps).await, StatusCode::BAD_REQUEST);
    let mut riesig = nachricht("alarm", "production");
    riesig["nutzlast"] = json!("a".repeat(600 * 1024));
    assert_eq!(status(riesig).await, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(d.erfasst.lock().unwrap().is_empty());

    let mut lang = nachricht("alarm", "production");
    lang["token"] = json!("ab".repeat(101));
    let a = app
        .clone()
        .oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": [lang] }),
        ))
        .await
        .unwrap();
    assert_eq!(
        json_antwort(a).await,
        json!({ "ergebnisse": ["token_ungueltig"] })
    );
    assert!(d.erfasst.lock().unwrap().is_empty());

    // Was passt, geht weiter hinaus: 100 Nachrichten mit größter Nutzlast und längstem Token.
    let passend: Vec<Value> = (0..100)
        .map(|_| {
            let mut n = nachricht("hinweis", "production");
            n["token"] = json!("ab".repeat(100));
            n["kollaps"] = json!("k".repeat(64));
            n["nutzlast"] = json!("a".repeat(3900));
            n
        })
        .collect();
    let a = app
        .oneshot(senden_anfrage(
            Some(&bearer),
            json!({ "nachrichten": passend }),
        ))
        .await
        .unwrap();
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(d.erfasst.lock().unwrap().len(), 100);
}
