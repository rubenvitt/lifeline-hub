//! Fristen je Datenkategorie über die HTTP-Routen (LFH-749, Spec `aufbewahrung-kategorien`).
//!
//! `PUT /api/einsaetze/{id}/aufbewahrungsfrist/{kategorie}`: Rechte und je Antwort ein Fall,
//! jeder Fehlerfall ohne Änderung an Kategorie-Zeile und ETB. Die Fachlogik (Karenz,
//! Wiederherstellen, Zustand) pinnen die Repo-Tests in `src/einsatz/aufbewahrung_kategorie.rs`.

use axum::http::StatusCode;
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::{
    anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool,
};

async fn org_vorgabe(app: &axum::Router, admin: &str, liste: Value) {
    let (status, body) = anfrage_json(
        app,
        "PUT",
        "/api/org-einstellungen",
        admin,
        Some(&json!({ "aufbewahrung_kategorien": liste })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn abschliessen(app: &axum::Router, cookie: &str, id: i64) {
    let (status, body) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn kategorie_frist(
    app: &axum::Router,
    cookie: &str,
    id: i64,
    kategorie: &str,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "PUT",
        &format!("/api/einsaetze/{id}/aufbewahrungsfrist/{kategorie}"),
        cookie,
        Some(&body),
    )
    .await
}

/// Stand von Kategorie-Zeilen und ETB-Zahl, um „ändert nichts“ zu belegen.
async fn stand(pool: &SqlitePool, id: i64) -> (Vec<(String, Option<String>, Option<String>)>, i64) {
    let zeilen = sqlx::query_as(
        "SELECT kategorie, frist_bis, vorgemerkt_at FROM einsatz_aufbewahrung_kategorie \
         WHERE einsatz_id = ? ORDER BY kategorie",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap();
    let etb: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
    (zeilen, etb)
}

fn vor_tagen(tage: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::days(tage))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Admin, Einsatz mit Org-Vorgabe `personenauskunft` (30 Tage), abgeschlossen.
async fn abgeschlossener_einsatz(app: &axum::Router) -> (String, i64) {
    let admin = login_cookie(app, "admin", "startpw12").await;
    org_vorgabe(
        app,
        &admin,
        json!([{ "kategorie": "personenauskunft", "dauer_tage": 30,
                 "rechtsgrundlage": "§ 46 Abs. 5 BHKG NRW" }]),
    )
    .await;
    let id = einsatz_anlegen(app, &admin).await;
    abschliessen(app, &admin, id).await;
    (admin, id)
}

/// Spec „Verlängern wegen Ermittlungsverfahren“: Antwort ist die Kategorie-Liste mit neuer
/// Frist und Zustand; die Einsatzleitung (ohne Admin) darf, ein Beobachter nicht.
#[tokio::test]
async fn einsatzleitung_verlaengert_beobachter_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    org_vorgabe(
        &app,
        &admin,
        json!([{ "kategorie": "anhaenge", "dauer_tage": 30, "rechtsgrundlage": "RG" }]),
    )
    .await;
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let id = einsatz_anlegen(&app, &frieda).await;
    let beob = benutzer_anlegen(&app, &admin, "bertold", "keine").await;
    rolle_setzen(&app, &frieda, id, beob, "beobachter").await;
    let bert = login_cookie(&app, "bertold", "bertoldpw1").await;
    abschliessen(&app, &frieda, id).await;

    let vorher = stand(&pool, id).await;
    let (status, _) = kategorie_frist(
        &app,
        &bert,
        id,
        "anhaenge",
        json!({ "retention_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(stand(&pool, id).await, vorher);

    let (status, liste) = kategorie_frist(
        &app,
        &frieda,
        id,
        "anhaenge",
        json!({ "retention_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{liste}");
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 3, "alle drei Kategorien");
    let anhaenge = liste.iter().find(|k| k["kategorie"] == "anhaenge").unwrap();
    assert_eq!(anhaenge["frist_bis"], "2099-01-01 00:00:00");
    assert_eq!(anhaenge["zustand"], "frist_laeuft");
    assert_eq!(anhaenge["rechtsgrundlage"], "RG");
    let behandlung = liste
        .iter()
        .find(|k| k["kategorie"] == "behandlung")
        .unwrap();
    assert_eq!(behandlung["zustand"], "ohne_frist");
}

#[tokio::test]
async fn fehlerfaelle_aendern_nichts() {
    let (app, pool) = setup_mit_pool().await;
    let (admin, id) = abgeschlossener_einsatz(&app).await;
    let vorher = stand(&pool, id).await;

    let faelle = [
        (
            "einsatzkraefte",
            json!({ "retention_bis": "2099-01-01 00:00:00" }),
            StatusCode::BAD_REQUEST,
        ),
        // Erste Frist ohne Rechtsgrundlage.
        (
            "behandlung",
            json!({ "retention_bis": "2099-01-01 00:00:00", "bestaetigt": true }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        // Verkürzung ohne Bestätigung (Frist steht ~30 Tage in der Zukunft).
        (
            "personenauskunft",
            json!({ "retention_bis": "2026-01-02 00:00:00" }),
            StatusCode::CONFLICT,
        ),
    ];
    for (kategorie, body, erwartet) in faelle {
        let (status, v) = kategorie_frist(&app, &admin, id, kategorie, body.clone()).await;
        assert_eq!(status, erwartet, "{kategorie} {body}: {v}");
        assert_eq!(stand(&pool, id).await, vorher, "{kategorie} {body}");
    }

    // Kategorie nach ihrer Karenz → 409.
    sqlx::query("UPDATE einsatz_aufbewahrung_kategorie SET vorgemerkt_at = ? WHERE einsatz_id = ?")
        .bind(vor_tagen(31))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let vorher = stand(&pool, id).await;
    let (status, _) = kategorie_frist(
        &app,
        &admin,
        id,
        "personenauskunft",
        json!({ "retention_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(stand(&pool, id).await, vorher);
}

#[tokio::test]
async fn einsatz_zustand_aktiv_vorgemerkt_geschwaerzt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = json!({ "retention_bis": "2099-01-01 00:00:00", "bestaetigt": true,
                       "rechtsgrundlage": "RG" });

    let aktiv = einsatz_anlegen(&app, &admin).await;
    let (status, _) = kategorie_frist(&app, &admin, aktiv, "anhaenge", body.clone()).await;
    assert_eq!(status, StatusCode::CONFLICT, "aktiv");

    abschliessen(&app, &admin, aktiv).await;
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind(vor_tagen(1))
        .bind(aktiv)
        .execute(&pool)
        .await
        .unwrap();
    let vorher = stand(&pool, aktiv).await;
    let (status, _) = kategorie_frist(&app, &admin, aktiv, "anhaenge", body.clone()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "vorgemerkt");
    assert_eq!(stand(&pool, aktiv).await, vorher);

    sqlx::query("UPDATE einsatz SET geschwaerzt_at = ? WHERE id = ?")
        .bind(vor_tagen(0))
        .bind(aktiv)
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = kategorie_frist(&app, &admin, aktiv, "anhaenge", body).await;
    assert_eq!(status, StatusCode::CONFLICT, "geschwärzt");
    assert_eq!(stand(&pool, aktiv).await, vorher);
}

async fn kategorien_lesen(app: &axum::Router, cookie: &str, id: i64) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "GET",
        &format!("/api/einsaetze/{id}/aufbewahrung-kategorien"),
        cookie,
        None,
    )
    .await
}

fn finde<'a>(liste: &'a Value, kategorie: &str) -> &'a Value {
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["kategorie"] == kategorie)
        .unwrap()
}

/// Spec „Aktiver Einsatz“: an einem aktiven Einsatz steht die Dauer der Org-Vorgabe samt
/// Rechtsgrundlage, die übrigen Kategorien folgen der Einsatz-Frist; kein Zustand.
#[tokio::test]
async fn aktiver_einsatz_zeigt_die_vorgabe() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    org_vorgabe(
        &app,
        &admin,
        json!([{ "kategorie": "personenauskunft", "dauer_tage": 0,
                 "rechtsgrundlage": "§ 46 Abs. 5 BHKG NRW" }]),
    )
    .await;
    let id = einsatz_anlegen(&app, &admin).await;
    let beob = benutzer_anlegen(&app, &admin, "bertold", "keine").await;
    rolle_setzen(&app, &admin, id, beob, "beobachter").await;
    let bert = login_cookie(&app, "bertold", "bertoldpw1").await;

    let (status, liste) = kategorien_lesen(&app, &bert, id).await;
    assert_eq!(status, StatusCode::OK, "{liste}");
    let auskunft = finde(&liste, "personenauskunft");
    assert_eq!(auskunft["dauer_tage_vorgabe"], 0);
    assert_eq!(auskunft["rechtsgrundlage"], "§ 46 Abs. 5 BHKG NRW");
    assert!(auskunft.get("zustand").is_none());
    let behandlung = finde(&liste, "behandlung");
    assert!(behandlung.get("dauer_tage_vorgabe").is_none());
    assert!(behandlung.get("frist_bis").is_none());
}

/// Spec „Gemischte Zustände“ über die Einsatz-Route und „Kategorien in der Akte“ über die
/// Archiv-Route.
#[tokio::test]
async fn gemischte_zustaende_am_einsatz_und_in_der_akte() {
    let (app, pool) = setup_mit_pool().await;
    let (admin, id) = abgeschlossener_einsatz(&app).await;
    // personenauskunft: seit 3 Tagen vorgemerkt; anhaenge: künftige Frist; behandlung: keine.
    sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = ?, vorgemerkt_at = ? \
         WHERE einsatz_id = ? AND kategorie = 'personenauskunft'",
    )
    .bind(vor_tagen(3))
    .bind(vor_tagen(3))
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, _) = kategorie_frist(
        &app,
        &admin,
        id,
        "anhaenge",
        json!({ "retention_bis": "2099-01-01 00:00:00", "bestaetigt": true,
                "rechtsgrundlage": "§ 32b Abs. 3 NKatSG" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, liste) = kategorien_lesen(&app, &admin, id).await;
    assert_eq!(status, StatusCode::OK, "{liste}");
    assert_eq!(finde(&liste, "personenauskunft")["zustand"], "vorgemerkt");
    assert!(finde(&liste, "personenauskunft")["karenz_ende"].is_string());
    assert_eq!(finde(&liste, "anhaenge")["zustand"], "frist_laeuft");
    assert_eq!(finde(&liste, "behandlung")["zustand"], "ohne_frist");

    // Archivakte: dieselben Kategorien; nach Schwärzung der Personenauskunft mit Zeitpunkt
    // und Rechtsgrundlage.
    sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET geschwaerzt_at = ? \
         WHERE einsatz_id = ? AND kategorie = 'personenauskunft'",
    )
    .bind(vor_tagen(0))
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, akte) = anfrage_json(
        &app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{akte}");
    let kategorien = &akte["kategorien"];
    let auskunft = finde(kategorien, "personenauskunft");
    assert_eq!(auskunft["zustand"], "geschwaerzt");
    assert!(auskunft["geschwaerzt_at"].is_string());
    assert_eq!(auskunft["rechtsgrundlage"], "§ 46 Abs. 5 BHKG NRW");
    assert_eq!(finde(kategorien, "anhaenge")["zustand"], "frist_laeuft");
    assert_eq!(finde(kategorien, "behandlung")["zustand"], "ohne_frist");
}

/// Spec „Admin einer fremden Organisation“ (Org-Schnitt wie LFH-753): der System-Admin einer
/// anderen Organisation ohne Mitgliedschaft darf keine Kategorie-Frist ändern.
#[tokio::test]
async fn admin_einer_fremden_org_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let (_, id) = abgeschlossener_einsatz(&app).await;
    let (_, fremd) =
        common::fremde_org_anlegen(&pool, "Fremd", "fremdadmin", "fremdpw12", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(fremd)
        .execute(&pool)
        .await
        .unwrap();
    let fremd_cookie = login_cookie(&app, "fremdadmin", "fremdpw12").await;
    let vorher = stand(&pool, id).await;

    let (status, _) = kategorie_frist(
        &app,
        &fremd_cookie,
        id,
        "personenauskunft",
        json!({ "retention_bis": "2099-01-01 00:00:00" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(stand(&pool, id).await, vorher);
}
