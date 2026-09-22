//! Transportzusicherungen des Live-Feeds `GET /api/einsaetze/{id}/live` (LFH-624).
//!
//! Die Sichtbarkeitsregeln des Feeds (Modul-Filter, Replay) prüft `modul_override.rs`;
//! hier steht, WANN und WIE die Verbindung ihr erstes Byte liefert.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

mod common;
use common::{einsatz_anlegen, login_cookie, setup};

/// Der Feed schickt sein erstes Byte **sofort**, nicht erst mit dem Keep-Alive.
///
/// Gemessen: direkt am Backend standen die Header nach 1,6 ms, durch den Vite-Dev-Proxy
/// erst nach 15,0 s. `http-proxy-3` setzt Status und Header nur und schickt sie mit dem
/// ersten Body-Byte, und das war ohne Ereignis der Keep-Alive-Kommentar nach
/// `KeepAlive::default()` = 15 s. So lange stand die Kopfleiste auf „VERBINDE", weil
/// `EventSource.onopen` die Header braucht. Jeder Proxy, der bis zum ersten Byte puffert,
/// verhält sich so.
///
/// Das erste Frame besteht **nur aus Kommentarzeilen** (`:`): der Browser verwirft es,
/// und ohne `id:`-Zeile bleibt die `Last-Event-ID` des Reconnect-Resyncs, wie sie war.
/// Deshalb wird jede Zeile geprüft und nicht bloß der Anfang: ein Kommentar, an dem ein
/// `.id(…)` oder `.event(…)` hängt, beginnt ebenfalls mit `:` und fiele sonst durch.
#[tokio::test]
async fn live_feed_sendet_sein_erstes_byte_sofort() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;

    let feed = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{eid}/live"))
                .header(header::COOKIE, admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(feed.status(), StatusCode::OK);

    let mut body = feed.into_body();
    // Eine Sekunde liegt weit unter den 15 s des Keep-Alive und lässt Luft gegen Last.
    let frame = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        std::pin::Pin::new(&mut body).frame(),
    )
    .await
    .expect("ohne Ereignis muss der Feed trotzdem sofort ein erstes Frame schicken")
    .expect("Stream darf nicht enden")
    .expect("Frame ohne Fehler");
    let erstes = String::from_utf8_lossy(frame.data_ref().expect("Datenframe")).into_owned();

    assert!(
        erstes.lines().any(|z| z.starts_with(':')),
        "das erste Frame trägt einen SSE-Kommentar, war: {erstes:?}"
    );
    assert!(
        erstes.lines().all(|z| z.is_empty() || z.starts_with(':')),
        "das erste Frame trägt nur Kommentarzeilen, kein id:/event:/data:, war: {erstes:?}"
    );
}
