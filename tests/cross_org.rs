//! Cross-Org-Smokes: die Mandanten-Grenze (`org_id`) gegen eine echte zweite
//! Organisation (F05/LFH-232).
//!
//! Bis LFH-232 gab es keinen Test mit mehr als EINER Organisation — jeder Org-Check war
//! damit trivial erfüllt und die Lücken blieben unsichtbar. Diese Suite baut über
//! `common::fremde_org_anlegen` eine zweite Org und prüft die zwei Chokepoints, an denen
//! eine org-fremde Einsatz-Mitgliedschaft überhaupt entstehen kann (die einzigen zwei
//! produktiven INSERTs in `einsatz_mitgliedschaft`):
//!
//! 1. **Einsatz-Anlage** — der Ersteller wird Einsatzleitung; gehört der Einsatz zur
//!    falschen Org, ist die Mitgliedschaft sofort cross-org.
//! 2. **`mitglied_setzen`** — eine Einsatzleitung trägt Mitglieder ein.
//!
//! Sind beide zu, ist die gesamte Einsatz-Fläche geschlossen: `darf_lesen` gibt für
//! Nicht-Mitglieder nur über `darf_fremdeinsatz_lesen` frei (org-geprüft, LFH-115), und
//! für Mitglieder gibt es dann keine org-fremden Mitgliedschaften mehr.
//!
//! **Invariante:** der System-Admin bleibt bewusst serverweit berechtigt
//! (`Benutzer::darf_fremdeinsatz_lesen` prüft `ist_admin()` zuerst). Org-Scope beschränkt
//! ausschließlich Nicht-Admins — ein pauschaler Org-Check überall bräche den Admin-Pfad.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::{einsatz_anlegen, fremde_org_anlegen, login_cookie, setup_mit_pool};

/// Org-Id eines Einsatzes direkt aus der DB (die API zeigt sie nicht immer).
async fn org_id_von_einsatz(pool: &sqlx::SqlitePool, einsatz_id: i64) -> i64 {
    sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_one(pool)
        .await
        .expect("Einsatz muss existieren")
}

/// Ein Einsatz gehört zur Organisation SEINES ERSTELLERS — nicht zur ersten Organisation
/// der Tabelle. `repo::anlegen` nahm `SELECT id FROM organisation ORDER BY id LIMIT 1`;
/// sobald eine zweite Org existiert, landete jeder ihrer Einsätze in Org 1, und der
/// Ersteller wurde als org-fremde Einsatzleitung eingetragen.
#[tokio::test]
async fn einsatz_gehoert_zur_org_des_erstellers() {
    let (app, pool) = setup_mit_pool().await;
    let (fremde_org, _fid) = fremde_org_anlegen(
        &pool,
        "Zweite Orga",
        "fremdlei",
        "fremdpw12",
        "fuehrungskraft",
    )
    .await;
    let fremd = login_cookie(&app, "fremdlei", "fremdpw12").await;

    let eid = einsatz_anlegen(&app, &fremd).await;

    assert_eq!(
        org_id_von_einsatz(&pool, eid).await,
        fremde_org,
        "der Einsatz muss zur Org seines Erstellers gehören, sonst ist der Ersteller \
         sofort ein org-fremdes Mitglied"
    );
}

/// Eine Einsatzleitung darf KEINEN org-fremden Benutzer ins Team holen. Sonst umgeht die
/// Mitgliedschaft die Org-Isolation von `darf_fremdeinsatz_lesen` (LFH-115) vollständig:
/// `darf_lesen` prüft bei vorhandener Rolle die Org nicht mehr.
#[tokio::test]
async fn mitglied_setzen_lehnt_org_fremden_benutzer_ab() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;

    let (_org2, fremd_id) =
        fremde_org_anlegen(&pool, "Zweite Orga", "fremdling", "fremdpw12", "keine").await;

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{eid}/mitglieder/{fremd_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.clone())
                .body(Body::from(r#"{"einsatz_rolle":"fuehrungspersonal"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        resp.status() == StatusCode::NOT_FOUND || resp.status() == StatusCode::FORBIDDEN,
        "org-fremder Benutzer darf nicht ins Einsatz-Team, war: {}",
        resp.status()
    );

    let ist_mitglied: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(eid)
    .bind(fremd_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        ist_mitglied, 0,
        "es darf keine cross-org-Mitgliedschaft geben"
    );
}

/// Der Kern-Effekt: ohne Mitgliedschaft und ohne passende Org sieht eine fremde
/// Org-Führungskraft den Einsatz nicht — weder im Detail noch in der Liste.
#[tokio::test]
async fn fremde_org_fuehrungskraft_sieht_einsatz_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;

    fremde_org_anlegen(
        &pool,
        "Zweite Orga",
        "fremdchef",
        "fremdpw12",
        "fuehrungskraft",
    )
    .await;
    let fremd = login_cookie(&app, "fremdchef", "fremdpw12").await;

    let detail = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{eid}"))
                .header(header::COOKIE, fremd.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        detail.status() == StatusCode::FORBIDDEN || detail.status() == StatusCode::NOT_FOUND,
        "fremde Org-Führungskraft darf den Einsatz nicht lesen, war: {}",
        detail.status()
    );

    let liste = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/einsaetze")
                .header(header::COOKIE, fremd)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(liste.status(), StatusCode::OK);
    let bytes = to_bytes(liste.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        json.as_array().map(|a| a.len()),
        Some(0),
        "die Einsatzliste einer fremden Org muss leer sein, war: {json}"
    );
}
