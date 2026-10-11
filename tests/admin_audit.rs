//! Admin-Spur über den echten Router (LFH-1005).
//!
//! Die Unit-Tests in `auth::admin_audit` prüfen Schreiben und Purge isoliert. Hier steht die
//! Frage, die im Betrieb zählt: hinterlässt jede Admin-Aktion am Zugang, die über die API
//! hereinkommt, genau einen Eintrag mit handelnder Person, Ziel und Zeitpunkt — und eine
//! abgewiesene keinen?

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use std::net::SocketAddr;
use tower::ServiceExt;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup_mit_pool};

/// Aktion, Akteur, Ziel-Benutzer, Ziel, Detail, IP und ob ein Zeitpunkt gesetzt ist.
type Zeile = (
    String,
    Option<String>,
    Option<i64>,
    String,
    Option<String>,
    Option<String>,
    bool,
);

async fn spur(pool: &sqlx::SqlitePool) -> Vec<Zeile> {
    sqlx::query_as(
        "SELECT aktion, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip, \
                zeitpunkt IS NOT NULL AND zeitpunkt >= datetime('now', '-1 minute') \
         FROM admin_audit ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn leeren(pool: &sqlx::SqlitePool) {
    sqlx::query("DELETE FROM admin_audit")
        .execute(pool)
        .await
        .unwrap();
}

fn zeile(aktion: &str, ziel_id: Option<i64>, ziel: &str, detail: Option<&str>) -> Zeile {
    (
        aktion.to_string(),
        Some("admin".to_string()),
        ziel_id,
        ziel.to_string(),
        detail.map(str::to_string),
        None,
        true,
    )
}

/// Legt `marlene` an und leert danach die Spur, damit der Test nur seine eigene Aktion sieht.
async fn marlene_anlegen(app: &axum::Router, pool: &sqlx::SqlitePool, admin: &str) -> i64 {
    let id = benutzer_anlegen(app, admin, "marlene", "keine").await;
    leeren(pool).await;
    id
}

#[tokio::test]
async fn benutzer_anlegen_steht_in_der_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let id = benutzer_anlegen(&app, &admin, "marlene", "fuehrungskraft").await;

    assert_eq!(
        spur(&pool).await,
        vec![zeile(
            "benutzer_angelegt",
            Some(id),
            "marlene",
            Some(r#"{"system_rolle":"keiner","org_rolle":"fuehrungskraft"}"#),
        )]
    );
}

#[tokio::test]
async fn deaktivieren_steht_in_der_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = marlene_anlegen(&app, &pool, &admin).await;

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{id}/deaktivieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(
        spur(&pool).await,
        vec![zeile("benutzer_deaktiviert", Some(id), "marlene", None)]
    );
}

#[tokio::test]
async fn zweitfaktor_zuruecksetzen_steht_mit_quell_ip_in_der_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = marlene_anlegen(&app, &pool, &admin).await;

    // Mit `ConnectInfo` wie der echte Server, damit die IP in der Spur ankommt.
    let mut req = Request::builder()
        .method("POST")
        .uri(format!("/api/benutzer/{id}/totp/reset"))
        .header(header::COOKIE, &admin)
        .body(Body::empty())
        .unwrap();
    let peer: SocketAddr = "203.0.113.31:50000".parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(peer));
    let status = app.clone().oneshot(req).await.unwrap().status();
    assert_eq!(status, StatusCode::OK);

    let mut erwartet = zeile("zweitfaktor_zurueckgesetzt", Some(id), "marlene", None);
    erwartet.5 = Some("203.0.113.31".to_string());
    assert_eq!(spur(&pool).await, vec![erwartet]);
}

#[tokio::test]
async fn anmeldeweg_schalten_steht_in_der_spur() {
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(true);
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    for aktiviert in [false, true] {
        let (status, _) = anfrage(
            &app,
            "PUT",
            "/api/auth/providers/oidc",
            &admin,
            Some(&format!(r#"{{"aktiviert":{aktiviert}}}"#)),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    assert_eq!(
        spur(&pool).await,
        vec![
            zeile("anmeldeweg_deaktiviert", None, "oidc", None),
            zeile("anmeldeweg_aktiviert", None, "oidc", None),
        ]
    );
}

#[tokio::test]
async fn bearbeiten_mit_rollenwechsel_steht_in_der_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = marlene_anlegen(&app, &pool, &admin).await;

    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/benutzer/{id}"),
        &admin,
        Some(r#"{"system_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(
        spur(&pool).await,
        vec![zeile(
            "rolle_geaendert",
            Some(id),
            "marlene",
            Some(r#"{"system_rolle_vorher":"keiner","system_rolle":"admin"}"#),
        )]
    );
}

/// Deaktivieren und Reaktivieren per PATCH sind dieselben Aktionen wie über die eigene Route;
/// ein PATCH, der Rolle und Zustand zugleich ändert, schreibt je Aktion einen Eintrag.
#[tokio::test]
async fn bearbeiten_mit_aktiv_wechsel_steht_in_der_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = marlene_anlegen(&app, &pool, &admin).await;

    for body in [
        r#"{"aktiv":false,"org_rolle":"fuehrungskraft"}"#,
        r#"{"aktiv":true}"#,
    ] {
        let (status, _) = anfrage(
            &app,
            "PATCH",
            &format!("/api/benutzer/{id}"),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    assert_eq!(
        spur(&pool).await,
        vec![
            zeile(
                "rolle_geaendert",
                Some(id),
                "marlene",
                Some(r#"{"org_rolle_vorher":"keine","org_rolle":"fuehrungskraft"}"#),
            ),
            zeile("benutzer_deaktiviert", Some(id), "marlene", None),
            zeile("benutzer_reaktiviert", Some(id), "marlene", None),
        ]
    );
}

#[tokio::test]
async fn bearbeiten_ohne_zugangsaenderung_schreibt_nichts() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = marlene_anlegen(&app, &pool, &admin).await;

    // Anzeigename, dazu unveränderte Rolle und unveränderter Zustand, wie ein Formular sie
    // mitschickt.
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/benutzer/{id}"),
        &admin,
        Some(
            r#"{"anzeigename":"Max M.","system_rolle":"keiner","org_rolle":"keine","aktiv":true}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    assert!(spur(&pool).await.is_empty());
}

#[tokio::test]
async fn abgewiesene_aktion_schreibt_nichts() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();

    // Letzter aktiver Admin: 409.
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{admin_id}/deaktivieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Unbekanntes Konto: 404.
    let (status, _) = anfrage(&app, "POST", "/api/benutzer/9999/totp/reset", &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Nicht-Admin: 403.
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    leeren(&pool).await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{admin_id}/totp/reset"),
        &marlene,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    assert!(spur(&pool).await.is_empty());
}

/// Eine klemmende Audit-Tabelle verhindert die Aktion nicht: im Vorfall muss der Admin den
/// Zweitfaktor eines Kontos nehmen können, auch wenn die Spur gerade nicht schreibbar ist.
#[tokio::test]
async fn audit_fehler_verhindert_die_aktion_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = marlene_anlegen(&app, &pool, &admin).await;
    sqlx::query("UPDATE benutzer SET totp_aktiviert = 1, totp_secret = 'x' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TRIGGER admin_audit_klemmt BEFORE INSERT ON admin_audit \
         BEGIN SELECT RAISE(ABORT, 'klemmt'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{id}/totp/reset"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["totp_aktiviert"], false);
    assert!(spur(&pool).await.is_empty());
}
