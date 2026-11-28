//! `POST /api/v1/report-suggestions` (LLH-2112): ein Maschinenzugang mit `meldungen:write` reicht
//! einen kurzen Text als unbestätigten Vorschlag für den freigegebenen Einsatz ein. Ein
//! Vorschlag ist weder Meldung noch ETB-Eintrag.

use axum::http::StatusCode;
use lifeline_machine_client::Credentials;
use serde_json::{json, Value};

mod common;
use common::maschine::{angebunden, angebunden_als, jetzt, schluessel, signiert_mit_body};
use common::{einsatz_anlegen_mit, login_cookie, setup_mit_pool};

const PFAD: &str = "/api/v1/report-suggestions";
const IP: &str = "198.51.100.7";

/// Gibt den Einsatz für den Zugang frei, an der Einsatzleitung vorbei.
async fn freigeben(pool: &sqlx::SqlitePool, cred: &Credentials, einsatz: i64) {
    sqlx::query("DELETE FROM maschinenzugang_freigabe WHERE zugang_id = ?")
        .bind(&cred.zugang_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO maschinenzugang_freigabe (zugang_id, einsatz_id) VALUES (?, ?)")
        .bind(&cred.zugang_id)
        .bind(einsatz)
        .execute(pool)
        .await
        .unwrap();
}

fn koerper(external_id: &str) -> Value {
    json!({
        "text": "Verletzte Person am Nordtor",
        "external_id": external_id,
        "source": { "adapter": "funk-gateway", "sender_id": "unit-7", "signed": true }
    })
}

async fn einreichen(
    app: &axum::Router,
    cred: &Credentials,
    body: &Value,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let jti = uuid::Uuid::new_v4().simple().to_string();
    signiert_mit_body(
        app,
        cred,
        "POST",
        PFAD,
        serde_json::to_vec(body).unwrap(),
        jetzt(),
        &jti,
        IP,
    )
    .await
}

async fn zaehle(pool: &sqlx::SqlitePool, tabelle: &str, einsatz: i64) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM {tabelle} WHERE einsatz_id = ?"
    )))
    .bind(einsatz)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn ohne_freigabe_lehnt_die_route_mit_incident_not_released_ab() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["meldungen:write"]), &schluessel(1), IP).await;
    let (s, _, v) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["code"], "incident_not_released");
}

#[tokio::test]
async fn mit_freigabe_entsteht_ein_vorschlag_und_kein_etb_eintrag() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["meldungen:write"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;
    let meldungen = zaehle(&pool, "meldung", einsatz).await;
    let etb = zaehle(&pool, "etb_eintrag", einsatz).await;

    let (s, kopf, v) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["status"], "offen");
    assert!(v["id"].is_i64() && v["received_at"].is_string(), "{v}");
    assert!(kopf.contains_key(lifeline_machine_client::RESPONSE_HEADER));
    assert_eq!(zaehle(&pool, "meldung", einsatz).await, meldungen);
    assert_eq!(zaehle(&pool, "etb_eintrag", einsatz).await, etb);
    assert_eq!(zaehle(&pool, "meldung_vorschlag", einsatz).await, 1);
}

#[tokio::test]
async fn dieselbe_external_id_liefert_200_und_denselben_vorschlag() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["meldungen:write"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;
    let (s1, _, erst) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s1, StatusCode::CREATED, "{erst}");
    let (s2, _, zweit) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s2, StatusCode::OK, "{zweit}");
    assert_eq!(erst["id"], zweit["id"]);
    assert_eq!(zaehle(&pool, "meldung_vorschlag", einsatz).await, 1);
}

#[tokio::test]
async fn dieselbe_external_id_zweier_zugaenge_ergibt_zwei_vorschlaege() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let a = angebunden_als(
        &app,
        &admin,
        "A",
        json!(["meldungen:write"]),
        &schluessel(1),
        IP,
    )
    .await;
    let b = angebunden_als(
        &app,
        &admin,
        "B",
        json!(["meldungen:write"]),
        &schluessel(2),
        IP,
    )
    .await;
    freigeben(&pool, &a, einsatz).await;
    freigeben(&pool, &b, einsatz).await;
    let (sa, _, va) = einreichen(&app, &a, &koerper("gleich")).await;
    let (sb, _, vb) = einreichen(&app, &b, &koerper("gleich")).await;
    assert_eq!((sa, sb), (StatusCode::CREATED, StatusCode::CREATED));
    assert_ne!(va["id"], vb["id"]);
    assert_eq!(zaehle(&pool, "meldung_vorschlag", einsatz).await, 2);
}

#[tokio::test]
async fn am_spiegel_lehnt_die_route_mit_fuehrung_elsewhere_ab() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["meldungen:write"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;
    // Unter dem Merker der Übernahme, wie jede Übergabe.
    let mut tx = pool.begin().await.unwrap();
    for sql in [
        "INSERT INTO spiegel_uebernahme (id) VALUES (1)".to_string(),
        format!("INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES ({einsatz}, 'x/{einsatz}')"),
        "DELETE FROM spiegel_uebernahme".to_string(),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    let (s, _, v) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["code"], "fuehrung_elsewhere");
}

#[tokio::test]
async fn ungueltige_felder_sind_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["meldungen:write"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;

    let mut leer = koerper("a-1");
    leer["text"] = json!("   ");
    let mut lang = koerper("a-2");
    lang["text"] = json!("x".repeat(lifeline_hub::etb::INHALT_MAX + 1));
    let mut gross = koerper("a-3");
    gross["source"]["adapter"] = json!("Funk");
    let mut ohne_signed = koerper("a-4");
    ohne_signed["source"]
        .as_object_mut()
        .unwrap()
        .remove("signed");
    let mut ohne_id = koerper("a-5");
    ohne_id.as_object_mut().unwrap().remove("external_id");
    let mut id_lang = koerper(&"i".repeat(129));
    id_lang["text"] = json!("ok");
    let mut kennung_leer = koerper("a-6");
    kennung_leer["source"]["sender_id"] = json!("");

    for body in [
        leer,
        lang,
        gross,
        ohne_signed,
        ohne_id,
        id_lang,
        kennung_leer,
    ] {
        let (s, _, v) = einreichen(&app, &cred, &body).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body} -> {v}");
        assert_eq!(v["code"], "unprocessable");
    }
    assert_eq!(zaehle(&pool, "meldung_vorschlag", einsatz).await, 0);
}

#[tokio::test]
async fn ohne_scope_ist_403_missing_scope() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;
    let (s, _, v) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["code"], "missing_scope");
}

#[tokio::test]
async fn nach_wechsel_der_freigabe_landet_der_neue_vorschlag_im_neuen_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let alt = einsatz_anlegen_mit(&app, &admin, "Alt").await;
    let neu = einsatz_anlegen_mit(&app, &admin, "Neu").await;
    let cred = angebunden(&app, &admin, json!(["meldungen:write"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, alt).await;
    let (s, _, _) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s, StatusCode::CREATED);
    freigeben(&pool, &cred, neu).await;
    let (s, _, _) = einreichen(&app, &cred, &koerper("a-2")).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(zaehle(&pool, "meldung_vorschlag", alt).await, 1);
    assert_eq!(zaehle(&pool, "meldung_vorschlag", neu).await, 1);
    let offen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM meldung_vorschlag WHERE einsatz_id = ? AND status = 'offen'",
    )
    .bind(alt)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(offen, 1, "der alte Vorschlag bleibt im alten Einsatz offen");
}

/// LLH-2112, Review I2: Ist das Modul „Meldungen“ im freigegebenen Einsatz ausgeblendet, sähe
/// niemand den Vorschlag. Die Route lehnt ab, damit die Brücke puffert.
#[tokio::test]
async fn bei_ausgeblendetem_modul_meldungen_lehnt_die_route_ab() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["meldungen:write"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;
    sqlx::query(
        "INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar) \
         VALUES (?, 'meldungen', 0)",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    let (s, _, v) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["code"], "incident_not_released");
    assert!(v["error"].as_str().unwrap().contains("Meldungen"), "{v}");
    assert_eq!(zaehle(&pool, "meldung_vorschlag", einsatz).await, 0);

    // Wieder eingeblendet, kommt derselbe Vorschlag an.
    sqlx::query("DELETE FROM einsatz_modul_override WHERE einsatz_id = ?")
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _, v) = einreichen(&app, &cred, &koerper("a-1")).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}
