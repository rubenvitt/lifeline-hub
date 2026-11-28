//! Rücknahme eines Materialstatuswechsels (LLH-1986, Design
//! `docs/superpowers/specs/2026-11-22-hau6f7rm-status-ruecknahme-handstatus-design.md`).

use axum::http::StatusCode;
use serde_json::Value;

use crate::common;
use common::*;

/// Ein Stamm-Verbrauchsgut mit Menge 10 im Einsatz; liefert (app, pool, admin, einsatz, em).
async fn welt() -> (axum::Router, sqlx::SqlitePool, String, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, mat) = anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Decke","kategorie":"Betreuung","art":"verbrauchsgut"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{mat}");
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{},"menge":10}}"#, mat["id"])),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let em = json["id"].as_i64().unwrap();
    (app, pool, admin, einsatz, em)
}

async fn patch(app: &axum::Router, c: &str, einsatz: i64, em: i64, body: &str) -> Value {
    let (s, json) = anfrage(
        app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/material/{em}"),
        c,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    json
}

async fn zuruecknehmen(
    app: &axum::Router,
    c: &str,
    einsatz: i64,
    em: i64,
    beleg: &Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/material/{em}/status/undo"),
        c,
        Some(&beleg.to_string()),
    )
    .await
}

#[tokio::test]
async fn materialstatus_zuruecknehmen_stellt_status_her() {
    let (app, _pool, admin, einsatz, em) = welt().await;
    let wechsel = patch(&app, &admin, einsatz, em, r#"{"status":"defekt"}"#).await;
    let beleg = wechsel["status_ruecknahme"].clone();
    assert_eq!(beleg["vorher_status"], "einsatzbereit", "{wechsel}");
    assert_eq!(beleg["status"], "defekt");
    assert!(beleg["gesetzt_at"].is_string(), "{beleg}");
    assert_eq!(
        wechsel["bezeichnung"], "Decke",
        "die Anzeige steht flach in der Antwort"
    );

    let (s, json) = zuruecknehmen(&app, &admin, einsatz, em, &beleg).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status"], "einsatzbereit");
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.starts_with("Material «Decke»: Statuswechsel «")
                && t.ends_with("» zurückgenommen")),
        "{etb:?}"
    );
    let (s, json) = zuruecknehmen(&app, &admin, einsatz, em, &beleg).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(json["grund"], "veraltet", "{json}");
}

#[tokio::test]
async fn materialstatus_gleicher_status_ohne_beleg() {
    let (app, _pool, admin, einsatz, em) = welt().await;
    let json = patch(&app, &admin, einsatz, em, r#"{"status":"einsatzbereit"}"#).await;
    assert!(json.get("status_ruecknahme").is_none(), "{json}");
    let json = patch(&app, &admin, einsatz, em, r#"{"menge":12}"#).await;
    assert!(json.get("status_ruecknahme").is_none(), "{json}");
}

/// Nach einer Mengenänderung stellte die Rücknahme einen Stand her, den es so nie gab.
#[tokio::test]
async fn materialstatus_nach_mengenaenderung_409() {
    let (app, _pool, admin, einsatz, em) = welt().await;
    let wechsel = patch(&app, &admin, einsatz, em, r#"{"status":"defekt"}"#).await;
    patch(&app, &admin, einsatz, em, r#"{"menge":12}"#).await;
    let (s, json) = zuruecknehmen(&app, &admin, einsatz, em, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    let (_, zeile) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/material"),
        &admin,
        None,
    )
    .await;
    let z = zeile
        .as_array()
        .unwrap()
        .iter()
        .find(|z| z["id"] == em)
        .unwrap();
    assert_eq!(z["status"], "defekt");
}

#[tokio::test]
async fn materialstatus_nach_artwechsel_409() {
    let (app, _pool, admin, einsatz, em) = welt().await;
    let wechsel = patch(&app, &admin, einsatz, em, r#"{"status":"defekt"}"#).await;
    patch(&app, &admin, einsatz, em, r#"{"art":"geraet","menge":1}"#).await;
    let (s, json) = zuruecknehmen(&app, &admin, einsatz, em, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
}

#[tokio::test]
async fn materialstatus_nach_aufteilen_409_und_teilzeile_ohne_beleg() {
    let (app, pool, admin, einsatz, em) = welt().await;
    let wechsel = patch(&app, &admin, einsatz, em, r#"{"status":"defekt"}"#).await;
    let (s, teil) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/material/{em}/split"),
        &admin,
        Some(r#"{"menge":3}"#),
    )
    .await;
    assert!(s.is_success(), "{teil}");
    let (s, json) = zuruecknehmen(&app, &admin, einsatz, em, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    let ohne_beleg: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_material WHERE einsatz_id = ? AND status_gesetzt_von IS NULL",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        ohne_beleg, 2,
        "keine der beiden Zeilen hält den Wechsel noch"
    );
}

#[tokio::test]
async fn materialstatus_andere_person_409() {
    let (app, _pool, admin, einsatz, em) = welt().await;
    let wechsel = patch(&app, &admin, einsatz, em, r#"{"status":"defekt"}"#).await;
    let id = benutzer_anlegen(&app, &admin, "fritz", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
    let fritz = login_cookie(&app, "fritz", "fritzpw1").await;
    let (s, json) = zuruecknehmen(&app, &fritz, einsatz, em, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_ne!(json["grund"], "veraltet", "{json}");
}

#[tokio::test]
async fn materialstatus_nach_elf_minuten_409() {
    let (app, pool, admin, einsatz, em) = welt().await;
    let wechsel = patch(&app, &admin, einsatz, em, r#"{"status":"defekt"}"#).await;
    let alt: String = sqlx::query_scalar(
        "UPDATE einsatz_material SET status_gesetzt_at = datetime('now', '-11 minutes') \
         WHERE id = ? RETURNING status_gesetzt_at",
    )
    .bind(em)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut beleg = wechsel["status_ruecknahme"].clone();
    beleg["gesetzt_at"] = alt.into();
    let (s, json) = zuruecknehmen(&app, &admin, einsatz, em, &beleg).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_ne!(json["grund"], "veraltet", "{json}");
}

/// Status und Menge im selben PATCH: die Rücknahme stellte den alten Status mit der neuen Menge
/// her, einen Stand, den es nie gab. Also kein Beleg und nichts gemerkt.
#[tokio::test]
async fn materialstatus_mit_mengenaenderung_im_selben_patch_ohne_beleg() {
    let (app, pool, admin, einsatz, em) = welt().await;
    let json = patch(
        &app,
        &admin,
        einsatz,
        em,
        r#"{"status":"defekt","menge":12}"#,
    )
    .await;
    assert!(json.get("status_ruecknahme").is_none(), "{json}");
    let von: Option<i64> =
        sqlx::query_scalar("SELECT status_gesetzt_von FROM einsatz_material WHERE id = ?")
            .bind(em)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(von, None);
}
