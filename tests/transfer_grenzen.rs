//! LFH-938: Grenzen der großen Transfers über die echten Routen.
//!
//! * Alle Upload-Routen teilen EINE Upload-Grenze: sind ihre Plätze von Uploads auf
//!   verschiedenen Routen belegt, bekommt ein Upload auf einer weiteren Route sofort 503.
//! * ETB- und Schaden-Upload laufen nicht mehr unter dem Zeitbudget: ein gedrosselter Upload,
//!   der fortlaufend Daten liefert, wird angenommen, auch wenn er länger dauert als das Budget.
//!
//! Mechanik (Leerlauf-Frist, Download-Platz im Body) belegen die Unit-Tests in
//! `src/transfer.rs`; die Vollständigkeit der Ausnahmeliste `tests/zulassung_guard.rs`.

use axum::body::{to_bytes, Body, Bytes};
use axum::http::{header, Request, StatusCode};
use futures::StreamExt;
use lifeline_hub::app::RouterOptionen;
use lifeline_hub::transfer::MAX_GLEICHZEITIGE_UPLOADS;
use std::time::Duration;
use tower::ServiceExt;

mod common;
use common::{einsatz_anlegen, login_cookie, setup_mit_optionen, MINI_JPEG, MINI_PNG};

const GRENZE: &str = "LFHTRANSFERGRENZE";

/// Ein vollständiger Multipart-Body mit einer Datei im Feld `datei`.
fn multipart(dateiname: &str, daten: &[u8]) -> Vec<u8> {
    let mut body = format!(
        "--{GRENZE}\r\nContent-Disposition: form-data; name=\"datei\"; \
         filename=\"{dateiname}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(daten);
    body.extend_from_slice(format!("\r\n--{GRENZE}--\r\n").as_bytes());
    body
}

fn post(uri: &str, cookie: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::COOKIE, cookie)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={GRENZE}"),
        )
        .body(body)
        .unwrap()
}

/// Ein Body, der `stuecke` mit `pause` dazwischen liefert: ein Upload über eine langsame
/// Funkstrecke, der nie stockt.
fn gedrosselt(daten: Vec<u8>, stuecke: usize, pause: Duration) -> Body {
    let groesse = daten.len().div_ceil(stuecke);
    let teile: Vec<Bytes> = daten.chunks(groesse).map(Bytes::copy_from_slice).collect();
    let strom = futures::stream::unfold(teile.into_iter(), move |mut rest| async move {
        let teil = rest.next()?;
        tokio::time::sleep(pause).await;
        Some((Ok::<_, std::io::Error>(teil), rest))
    });
    Body::from_stream(strom)
}

/// Ein Body, der den Kopf des Datei-Felds liefert und dann offen bleibt, solange der Sender
/// lebt: der Handler wartet im Lesen und hält seinen Platz. Sobald der Handler den Kopf liest,
/// meldet der Body das über `liest` — erst dann hält er sicher einen Platz.
fn haengend(
    liest: tokio::sync::mpsc::UnboundedSender<()>,
) -> (tokio::sync::mpsc::Sender<Bytes>, Body) {
    let (tx, rx) = tokio::sync::mpsc::channel::<Bytes>(1);
    let kopf = Bytes::from(format!(
        "--{GRENZE}\r\nContent-Disposition: form-data; name=\"datei\"; \
         filename=\"foto.jpg\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    ));
    let strom = futures::stream::once(async move {
        let _ = liest.send(());
        Ok::<_, std::io::Error>(kopf)
    })
    .chain(futures::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|b| (Ok(b), rx))
    }));
    (tx, Body::from_stream(strom))
}

async fn schaden_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = common::anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/schaeden"),
        cookie,
        Some(r#"{"typ":"sachschaden","ausmass":"gering","ort":"Hauptstr. 1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Schaden anlegen: {v}");
    v["id"].as_i64().unwrap()
}

async fn status_und_text(antwort: axum::response::Response) -> (StatusCode, String) {
    let status = antwort.status();
    let bytes = to_bytes(antwort.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8_lossy(&bytes).into_owned())
}

/// Akzeptanz: „über alle fünf Upload-Routen hinweg nur eine Grenze“. Die Plätze werden auf
/// vier verschiedenen Routen belegt; der Upload auf der fünften bekommt sofort 503. Mit einer
/// Grenze je Route liefe er durch.
#[tokio::test]
async fn eine_upload_grenze_ueber_alle_upload_routen() {
    assert_eq!(
        MAX_GLEICHZEITIGE_UPLOADS, 4,
        "der Test belegt genau vier Routen"
    );
    let (app, _pool) = setup_mit_optionen(RouterOptionen::default()).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let schaden = schaden_anlegen(&app, &admin, einsatz).await;

    let belegend = [
        format!("/api/einsaetze/{einsatz}/anhaenge"),
        format!("/api/einsaetze/{einsatz}/etb/anhaenge"),
        format!("/api/einsaetze/{einsatz}/schaeden/{schaden}/anhaenge"),
        format!("/api/einsaetze/{einsatz}/karte/hintergrundbilder"),
    ];
    let (liest_tx, mut liest) = tokio::sync::mpsc::unbounded_channel();
    let mut halten = Vec::new();
    let mut laufend = Vec::new();
    for uri in &belegend {
        let (tx, body) = haengend(liest_tx.clone());
        halten.push(tx);
        laufend.push((
            uri.clone(),
            tokio::spawn(app.clone().oneshot(post(uri, &admin, body))),
        ));
    }
    // Warten, bis jeder hängende Upload im Handler liest, also seinen Platz hält.
    for _ in &belegend {
        tokio::time::timeout(Duration::from_secs(10), liest.recv())
            .await
            .expect("jeder hängende Upload erreicht seinen Handler")
            .unwrap();
    }
    for (uri, aufgabe) in &laufend {
        assert!(
            !aufgabe.is_finished(),
            "{uri}: der Upload muss im Lesen hängen und seinen Platz halten"
        );
    }

    let dokumente = format!("/api/einsaetze/{einsatz}/dokumente");
    let dokument_hochladen = || {
        app.clone().oneshot(post(
            &dokumente,
            &admin,
            Body::from(multipart("plan.png", MINI_PNG)),
        ))
    };
    let antwort = dokument_hochladen().await.unwrap();
    assert_eq!(
        antwort
            .headers()
            .get(header::RETRY_AFTER)
            .map(|v| v.to_str().unwrap().to_string()),
        Some("5".into())
    );
    let (status, text) = status_und_text(antwort).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{text}");
    assert!(text.contains("Uploads"), "eigene Meldung: {text}");

    // Abgebrochene Uploads geben ihre Plätze zurück; das Aufräumen läuft nebenläufig, also bis
    // zu einer Frist wiederholen statt fest zu warten.
    for (_, aufgabe) in laufend {
        aufgabe.abort();
    }
    drop(halten);
    let frist = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let (status, text) = status_und_text(dokument_hochladen().await.unwrap()).await;
        if status != StatusCode::SERVICE_UNAVAILABLE {
            break;
        }
        assert!(
            tokio::time::Instant::now() < frist,
            "nach dem Abbruch ist wieder Platz: {text}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Enges Budget für die Drosseltests; der Upload braucht ein Vielfaches davon.
const ENGES_BUDGET: Duration = Duration::from_millis(250);
const STUECKE: usize = 8;
const PAUSE: Duration = Duration::from_millis(100);

async fn mit_engem_budget() -> (axum::Router, String, i64) {
    let (app, _pool) = setup_mit_optionen(RouterOptionen {
        zulassungs_budget: Some(ENGES_BUDGET),
        ..Default::default()
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

/// Akzeptanz L24: ein ETB-Upload, der länger als das Budget überträgt, aber fortlaufend Daten
/// liefert, wird angenommen.
#[tokio::test]
async fn gedrosselter_etb_upload_ueberlebt_das_budget() {
    let (app, admin, einsatz) = mit_engem_budget().await;
    let antwort = app
        .clone()
        .oneshot(post(
            &format!("/api/einsaetze/{einsatz}/etb/anhaenge"),
            &admin,
            gedrosselt(multipart("foto.jpg", MINI_JPEG), STUECKE, PAUSE),
        ))
        .await
        .unwrap();
    let (status, text) = status_und_text(antwort).await;
    assert_eq!(status, StatusCode::CREATED, "{text}");
}

#[tokio::test]
async fn gedrosselter_schaden_upload_ueberlebt_das_budget() {
    let (app, admin, einsatz) = mit_engem_budget().await;
    let schaden = schaden_anlegen(&app, &admin, einsatz).await;
    let antwort = app
        .clone()
        .oneshot(post(
            &format!("/api/einsaetze/{einsatz}/schaeden/{schaden}/anhaenge"),
            &admin,
            gedrosselt(multipart("foto.jpg", MINI_JPEG), STUECKE, PAUSE),
        ))
        .await
        .unwrap();
    let (status, text) = status_und_text(antwort).await;
    assert_eq!(status, StatusCode::CREATED, "{text}");
}

/// Gegenprobe: dieselbe Drosselung auf einem geregelten Upload (Logo, 1 MiB) endet im Budget.
/// Ohne sie bewiesen die beiden Tests oben nichts über das Budget.
#[tokio::test]
async fn gedrosselter_geregelter_upload_endet_im_budget() {
    let (app, admin, _einsatz) = mit_engem_budget().await;
    let antwort = app
        .clone()
        .oneshot(post(
            "/api/organisation/logo",
            &admin,
            gedrosselt(multipart("logo.png", MINI_PNG), STUECKE, PAUSE),
        ))
        .await
        .unwrap();
    let (status, text) = status_und_text(antwort).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{text}");
    assert!(text.contains("Zeitbudget"), "{text}");
}
