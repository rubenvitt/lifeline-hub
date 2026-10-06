//! LFH-937: Zuordnungslisten von außen (Spec `eingabegrenzen`, design.md D5) — Sprechgruppen je
//! Abschnitt, Einheit und Führungsstelle sowie Qualifikationen je Person: entdoppelt, begrenzt,
//! vor jedem Schreiben geprüft; die fremde Sprechgruppe bleibt 422.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, anfrage_json, einheit_bilden, einsatz_anlegen, fremde_org_anlegen, login_cookie,
    setup_mit_pool,
};

async fn sprechgruppen(app: &axum::Router, cookie: &str, e: i64, n: usize) -> Vec<i64> {
    let mut ids = Vec::with_capacity(n);
    for i in 0..n {
        let (s, j) = anfrage_json(
            app,
            "POST",
            &format!("/api/einsaetze/{e}/sprechgruppen"),
            cookie,
            Some(&json!({ "bezeichnung": format!("SG {i}"), "betriebsart": "DMO" })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
        ids.push(j["id"].as_i64().unwrap());
    }
    ids
}

async fn abschnitt(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let (s, j) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/abschnitte"),
        cookie,
        Some(&json!({ "name": "Nord" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    j["id"].as_i64().unwrap()
}

async fn zeilen(pool: &sqlx::SqlitePool, tabelle: &str, spalte: &str, id: i64) -> Vec<i64> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT sprechgruppe_id FROM {tabelle} WHERE {spalte} = ? ORDER BY sprechgruppe_id"
    )))
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn patch(app: &axum::Router, cookie: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "PATCH", uri, cookie, Some(&body)).await
}

#[tokio::test]
async fn dubletten_werden_an_jedem_ziel_zu_einer_zuordnung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppen(&app, &admin, e, 2).await;
    let liste = json!([sg[1], sg[0], sg[0], sg[1], sg[0]]);
    let erwartet = vec![sg[0], sg[1]];

    let aid = abschnitt(&app, &admin, e).await;
    let (s, j) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/abschnitte/{aid}"),
        json!({ "sprechgruppe_ids": liste }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(
        zeilen(&pool, "einsatzabschnitt_sprechgruppe", "abschnitt_id", aid).await,
        erwartet
    );

    let eid = einheit_bilden(&app, &admin, e, "Zug 1").await;
    let (s, j) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/einheiten/{eid}"),
        json!({ "sprechgruppe_ids": liste }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(
        zeilen(&pool, "einsatz_einheit_sprechgruppe", "einheit_id", eid).await,
        erwartet
    );

    let (s, j) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/fuehrungsstelle"),
        json!({ "sprechgruppe_ids": liste }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(
        zeilen(&pool, "einsatz_fuehrungsstelle_sprechgruppe", "einsatz_id", e).await,
        erwartet
    );
}

#[tokio::test]
async fn zweiunddreissig_gehen_dreiunddreissig_sind_400() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppen(&app, &admin, e, 33).await;

    // Anlegen mit voller Liste und Ersetzen durch eine kleinere: beide Anweisungen greifen.
    let (s, j) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschnitte"),
        &admin,
        Some(&json!({ "name": "Voll", "sprechgruppe_ids": &sg[..32] })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let aid = j["id"].as_i64().unwrap();
    assert_eq!(
        zeilen(&pool, "einsatzabschnitt_sprechgruppe", "abschnitt_id", aid)
            .await
            .len(),
        32
    );
    let (s, _) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/abschnitte/{aid}"),
        json!({ "sprechgruppe_ids": [sg[5], sg[32]] }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        zeilen(&pool, "einsatzabschnitt_sprechgruppe", "abschnitt_id", aid).await,
        vec![sg[5], sg[32]]
    );

    // 33 verschiedene: 400 an Abschnitt (POST), Einheit (POST, PATCH) und Führungsstelle.
    let (s, j) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschnitte"),
        &admin,
        Some(&json!({ "name": "Zu viel", "sprechgruppe_ids": sg })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    assert_eq!(j["error"], "Höchstens 32 Sprechgruppen je Zuordnung");
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten"),
        &admin,
        Some(&json!({ "name": "Zug 9", "sprechgruppe_ids": sg })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let eid = einheit_bilden(&app, &admin, e, "Zug 1").await;
    let (s, _) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/einheiten/{eid}"),
        json!({ "sprechgruppe_ids": sg }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/fuehrungsstelle"),
        json!({ "sprechgruppe_ids": sg }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Die Abschnitts-Änderung speichert einen Lagewechsel vor der Zuordnung (LFH-608). Eine zu
/// lange Liste ist ein Feldfehler und wird vorher abgelehnt: kein Lagewechsel, kein ETB.
#[tokio::test]
async fn zu_lange_liste_verhindert_auch_den_lagewechsel() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppen(&app, &admin, e, 33).await;
    let aid = abschnitt(&app, &admin, e).await;
    let (_, etb_vorher) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;

    let (s, _) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/abschnitte/{aid}"),
        json!({ "lagezustand": "kritisch", "sprechgruppe_ids": sg }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let lage: Option<String> =
        sqlx::query_scalar("SELECT lagezustand FROM einsatzabschnitt WHERE id = ?")
            .bind(aid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(lage, None);
    let (_, etb) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}/etb"), &admin, None).await;
    assert_eq!(etb.as_array().unwrap().len(), etb_vorher.as_array().unwrap().len());
}

#[tokio::test]
async fn fremde_sprechgruppe_bleibt_422_mit_der_id() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let eigen = sprechgruppen(&app, &admin, e, 1).await[0];
    let (fremde_org, _) = fremde_org_anlegen(&pool, "Fremd", "fremd", "startpw12", "keine").await;
    let fremd: i64 = sqlx::query_scalar(
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart) VALUES (?, 'Fremd', 'DMO') \
         RETURNING id",
    )
    .bind(fremde_org)
    .fetch_one(&pool)
    .await
    .unwrap();
    let aid = abschnitt(&app, &admin, e).await;

    let (s, j) = patch(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/abschnitte/{aid}"),
        json!({ "sprechgruppe_ids": [eigen, fremd, fremd] }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    assert_eq!(
        j["error"],
        format!("Sprechgruppe {fremd} ist für diese Organisation/diesen Einsatz nicht zuordenbar")
    );
    assert!(zeilen(&pool, "einsatzabschnitt_sprechgruppe", "abschnitt_id", aid)
        .await
        .is_empty());
}

async fn qualifikationen(app: &axum::Router, admin: &str, n: usize) -> Vec<i64> {
    let mut ids = Vec::with_capacity(n);
    for i in 0..n {
        let (s, j) = anfrage_json(
            app,
            "POST",
            "/api/qualifikationen",
            admin,
            Some(&json!({ "label": format!("Q {i}"), "sortier": i })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
        ids.push(j["id"].as_i64().unwrap());
    }
    ids
}

async fn qualifikations_zeilen(pool: &sqlx::SqlitePool, personal_id: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM personal_qualifikation WHERE personal_id = ?")
        .bind(personal_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn qualifikationen_entdoppelt_und_auf_64_begrenzt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let q = qualifikationen(&app, &admin, 65).await;

    let mit_dubletten: Vec<i64> = q[..64].iter().chain(q[..64].iter()).copied().collect();
    let (s, p) = anfrage_json(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(&json!({ "name": "Thomas", "qualifikation_ids": mit_dubletten })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p:?}");
    let pid = p["id"].as_i64().unwrap();
    assert_eq!(qualifikations_zeilen(&pool, pid).await, 64);

    let (s, j) = anfrage_json(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(&json!({ "name": "Zu viel", "qualifikation_ids": q })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    assert_eq!(j["error"], "Höchstens 64 Qualifikationen je Person");

    let (s, _) = patch(
        &app,
        &admin,
        &format!("/api/personal/{pid}"),
        json!({ "qualifikation_ids": q }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(qualifikations_zeilen(&pool, pid).await, 64, "unverändert");

    // Ersetzen per PATCH, fremde IDs bleiben still ignoriert (bestehendes Verhalten).
    let (s, j) = patch(
        &app,
        &admin,
        &format!("/api/personal/{pid}"),
        json!({ "qualifikation_ids": [q[0], q[0], 999_999] }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(qualifikations_zeilen(&pool, pid).await, 1);
}
