//! Personenauswahl der Einsatzleitung (LFH-1141, Spec `einsatz-zugriff`):
//! `GET /api/einsaetze/{id}/mitglieder/auswahl` bietet genau die Personen an, die
//! `PUT /api/einsaetze/{id}/mitglieder/{benutzer_id}` aufnimmt — ohne Systemrolle, ohne fremde
//! Organisationen, nur mit Kennung und Anzeigename.

use axum::http::StatusCode;
use serde_json::Value;
use sqlx::SqlitePool;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, fremde_org_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
};

fn auswahl_uri(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/mitglieder/auswahl")
}

/// Die Kennungen der Auswahl, in Antwortreihenfolge.
fn kennungen(json: &Value) -> Vec<i64> {
    json.as_array()
        .expect("Auswahl ist ein Array")
        .iter()
        .map(|e| e["benutzer_id"].as_i64().unwrap())
        .collect()
}

/// Legt ein Gerätekonto der Org 1 an, gekoppelt an `einsatz` (LFH-892). Direkt über SQL: der
/// Kopplungsweg gehört nicht zu dem, was hier geprüft wird.
async fn geraetekonto_anlegen(pool: &SqlitePool, einsatz: i64) -> i64 {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
                               org_rolle) \
         VALUES (1, 'Lagemonitor', 'geraet-lagemonitor', 'x', 'keiner', 'keine') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, bezeichnung, \
                                      erstellt_von, laeuft_ab_at) \
         VALUES (?, ?, 'lagemonitor', 'Monitor', 1, datetime('now', '+1 day'))",
    )
    .bind(einsatz)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    id
}

/// Ein Einsatz, den die Führungskraft `leitung` (ohne Systemrolle) angelegt hat, also leitet. Der
/// Admin hat darin keine Rolle. Liefert (app, pool, admin-cookie, leitungs-cookie, einsatz,
/// leitungs-id).
async fn einsatz_mit_leitung_ohne_systemrolle(
) -> (axum::Router, SqlitePool, String, String, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let leitung_id = benutzer_anlegen(&app, &admin, "lennart", "fuehrungskraft").await;
    let leitung = login_cookie(&app, "lennart", "lennartpw1").await;
    let einsatz = einsatz_anlegen(&app, &leitung).await;
    (app, pool, admin, leitung, einsatz, leitung_id)
}

#[tokio::test]
async fn einsatzleitung_ohne_systemrolle_bekommt_genau_die_aufnehmbaren() {
    let (app, pool, admin, leitung, einsatz, leitung_id) =
        einsatz_mit_leitung_ohne_systemrolle().await;
    // Aufnehmbar: zwei aktive Personen der Org ohne Mitgliedschaft (Sortierung nach Name).
    let zora = benutzer_anlegen(&app, &admin, "zorana", "keine").await;
    let berta = benutzer_anlegen(&app, &admin, "bertha", "keine").await;
    // Nicht aufnehmbar: ein Mitglied, ein deaktiviertes Konto, ein Gerätekonto, eine fremde Org.
    let mitglied = benutzer_anlegen(&app, &admin, "maxim", "keine").await;
    rolle_setzen(&app, &leitung, einsatz, mitglied, "beobachter").await;
    let inaktiv = benutzer_anlegen(&app, &admin, "irene", "keine").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/benutzer/{inaktiv}/deaktivieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let geraet = geraetekonto_anlegen(&pool, einsatz).await;
    let (_, fremd) = fremde_org_anlegen(&pool, "Fremd", "fritz", "fritzpw12", "keine").await;

    let (status, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), &leitung, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    // Der Admin (Org 1, aktiv, ohne Rolle in diesem Einsatz) ist ebenfalls aufnehmbar.
    let ids = kennungen(&json);
    assert_eq!(ids, vec![1, berta, zora], "{json:?}");
    for ausgeschlossen in [leitung_id, mitglied, inaktiv, geraet, fremd] {
        assert!(
            !ids.contains(&ausgeschlossen),
            "{ausgeschlossen} in {json:?}"
        );
    }
}

#[tokio::test]
async fn system_admin_mit_einsatzleitung_sieht_keine_fremde_org() {
    let (app, pool, admin, leitung, einsatz, _) = einsatz_mit_leitung_ohne_systemrolle().await;
    rolle_setzen(&app, &leitung, einsatz, 1, "einsatzleitung").await;
    let bertha = benutzer_anlegen(&app, &admin, "bertha", "keine").await;
    let (_, fremd) = fremde_org_anlegen(&pool, "Fremd", "fritz", "fritzpw12", "keine").await;

    let (status, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(kennungen(&json), vec![bertha], "{json:?}");
    assert!(!kennungen(&json).contains(&fremd));
}

#[tokio::test]
async fn auswahl_traegt_nur_kennung_und_anzeigename() {
    let (app, _pool, admin, leitung, einsatz, _) = einsatz_mit_leitung_ohne_systemrolle().await;
    let berta = benutzer_anlegen(&app, &admin, "bertha", "keine").await;

    let (status, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), &leitung, None).await;
    assert_eq!(status, StatusCode::OK);
    let eintrag = json
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["benutzer_id"] == berta)
        .expect("bertha angeboten");
    let mut felder: Vec<&str> = eintrag
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    felder.sort_unstable();
    assert_eq!(felder, ["anzeigename", "benutzer_id"]);
    assert_eq!(eintrag["anzeigename"], "bertha");
}

#[tokio::test]
async fn jeder_angebotene_eintrag_laesst_sich_aufnehmen() {
    // Auswahl und Schreibweg halten dieselbe Menge (LFH-1141, design.md D2).
    let (app, pool, admin, leitung, einsatz, _) = einsatz_mit_leitung_ohne_systemrolle().await;
    benutzer_anlegen(&app, &admin, "bertha", "keine").await;
    benutzer_anlegen(&app, &admin, "zorana", "keine").await;
    geraetekonto_anlegen(&pool, einsatz).await;
    fremde_org_anlegen(&pool, "Fremd", "fritz", "fritzpw12", "keine").await;

    let (_, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), &leitung, None).await;
    let ids = kennungen(&json);
    assert!(!ids.is_empty());
    for id in ids {
        rolle_setzen(&app, &leitung, einsatz, id, "fuehrungspersonal").await;
    }
    let (status, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), &leitung, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json, Value::Array(vec![]), "alle aufgenommen: leer");
}

#[tokio::test]
async fn ohne_einsatzleitung_keine_auswahl() {
    let (app, _pool, admin, leitung, einsatz, _) = einsatz_mit_leitung_ohne_systemrolle().await;
    let fp = benutzer_anlegen(&app, &admin, "fredo", "keine").await;
    let beo = benutzer_anlegen(&app, &admin, "beate", "keine").await;
    rolle_setzen(&app, &leitung, einsatz, fp, "fuehrungspersonal").await;
    rolle_setzen(&app, &leitung, einsatz, beo, "beobachter").await;
    let fp = login_cookie(&app, "fredo", "fredopw1").await;
    let beo = login_cookie(&app, "beate", "beatepw1").await;
    // Führungskraft der Org ohne Rolle liest den Einsatz, verwaltet aber nicht.
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let fk = login_cookie(&app, "frieda", "friedapw1").await;

    for (wer, cookie) in [
        ("Führungspersonal", &fp),
        ("Beobachter", &beo),
        ("System-Admin ohne Rolle", &admin),
        ("Führungskraft ohne Rolle", &fk),
    ] {
        let (status, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), cookie, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{wer}: {json:?}");
    }
}

#[tokio::test]
async fn fremde_org_bekommt_keine_auswahl() {
    let (app, pool, _admin, _leitung, einsatz, _) = einsatz_mit_leitung_ohne_systemrolle().await;
    fremde_org_anlegen(&pool, "Fremd", "fritz", "fritzpw12", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fritz", "fritzpw12").await;

    let (status, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), &fremd, None).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "{status}: {json:?}"
    );
    assert!(json.as_array().is_none(), "keine Liste: {json:?}");
}

#[tokio::test]
async fn abgeschlossener_einsatz_verweigert_die_auswahl() {
    let (app, _pool, admin, leitung, einsatz, _) = einsatz_mit_leitung_ohne_systemrolle().await;
    benutzer_anlegen(&app, &admin, "bertha", "keine").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &leitung,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = anfrage(&app, "GET", &auswahl_uri(einsatz), &leitung, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
}
