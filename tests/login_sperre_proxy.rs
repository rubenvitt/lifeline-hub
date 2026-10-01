//! Login-Sperre hinter einem Reverse-Proxy (LFH-604).
//!
//! Hinter Traefik ist die TCP-Gegenstelle jeder Anfrage der Proxy selbst. Ohne Proxy-Liste
//! zählte die Sperre deshalb alle Fehlversuche auf eine Adresse, und zehn falsche Passwörter von
//! beliebiger Seite sperrten den Passwort-Login für alle. Mit `--trusted-proxies` kommt die
//! Client-Adresse aus `X-Forwarded-For`, aber nur, wenn die Gegenstelle in der Liste steht.
//!
//! Eigenes Test-Binary: die Proxy-Liste ist ein prozessweiter `OnceLock`, und in den übrigen
//! Test-Binaries soll sie ungesetzt bleiben (Default: Gegenstelle).

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use serde_json::json;
use std::net::SocketAddr;
use tower::ServiceExt;

mod common;
use common::setup;

/// Das Proxy-Netz dieses Test-Binaries. Jeder Test ruft das auf; der `OnceLock` nimmt nur den
/// ersten Wert, alle setzen denselben.
fn proxy_liste_setzen() {
    lifeline_hub::extract::init_vertraute_proxys(vec!["10.9.0.0/16".parse().unwrap()]);
}

/// POST `/api/auth/login` von `gegenstelle`, optional mit `X-Forwarded-For`.
async fn anmelden(
    app: &axum::Router,
    gegenstelle: &str,
    x_forwarded_for: Option<&str>,
    passwort: &str,
) -> StatusCode {
    let mut req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(xff) = x_forwarded_for {
        req = req.header("x-forwarded-for", xff);
    }
    let mut req = req
        .body(Body::from(
            json!({ "benutzername": "admin", "passwort": passwort }).to_string(),
        ))
        .unwrap();
    let peer: SocketAddr = gegenstelle.parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    app.clone().oneshot(req).await.unwrap().status()
}

#[tokio::test]
async fn hinter_dem_proxy_sperren_fehlversuche_nur_die_angreifende_adresse() {
    proxy_liste_setzen();
    let app = setup().await;
    let proxy = "10.9.0.2:41000";

    for i in 0..10 {
        let s = anmelden(&app, proxy, Some("203.0.113.50"), "falsch").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "Versuch {i}");
    }
    assert_eq!(
        anmelden(&app, proxy, Some("203.0.113.50"), "falsch").await,
        StatusCode::TOO_MANY_REQUESTS,
        "die angreifende Adresse ist gesperrt"
    );
    assert_eq!(
        anmelden(&app, proxy, Some("198.51.100.7"), "startpw12").await,
        StatusCode::OK,
        "eine andere Adresse hinter demselben Proxy meldet sich weiter an"
    );
}

#[tokio::test]
async fn gefaelschtes_x_forwarded_for_von_fremder_gegenstelle_wird_ignoriert() {
    proxy_liste_setzen();
    let app = setup().await;
    // Nicht im Proxy-Netz: der Header ist frei erfunden und darf die Sperre nicht umgehen.
    let fremd = "192.0.2.66:41000";

    for i in 0..10 {
        let erfunden = format!("198.51.100.{}", 100 + i);
        let s = anmelden(&app, fremd, Some(&erfunden), "falsch").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "Versuch {i}");
    }
    assert_eq!(
        anmelden(&app, fremd, Some("198.51.100.200"), "falsch").await,
        StatusCode::TOO_MANY_REQUESTS,
        "die Fehlversuche zählen auf die Gegenstelle, nicht auf den erfundenen Header"
    );
}

#[tokio::test]
async fn ein_vorangestellter_gefaelschter_eintrag_umgeht_die_sperre_nicht() {
    proxy_liste_setzen();
    let app = setup().await;
    let proxy = "10.9.0.3:41000";

    // Der Angreifer schickt selbst ein `X-Forwarded-For`, der Proxy hängt die echte Adresse an.
    // Von rechts gelesen ist der erste nicht vertrauenswürdige Eintrag die echte Adresse.
    for i in 0..10 {
        let kette = format!("198.51.100.{}, 203.0.113.60", 100 + i);
        let s = anmelden(&app, proxy, Some(&kette), "falsch").await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "Versuch {i}");
    }
    assert_eq!(
        anmelden(&app, proxy, Some("198.51.100.250, 203.0.113.60"), "falsch").await,
        StatusCode::TOO_MANY_REQUESTS
    );
}
