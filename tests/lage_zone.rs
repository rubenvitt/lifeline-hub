//! L-3 Gefahren- & Absperrzonen — Backend-Integrationstests.
//!
//! Deckt ab: CRUD + ETB-Wortlaut («eingerichtet/geändert/aufgehoben»), 400 bei unbekanntem
//! typ/geometrie_typ und 422 beim Geometrie-Klassen-Mismatch (POST und PATCH, LFH-305),
//! ETB-Regeln (notiz/farbe schreiben KEINEN ETB, label/typ schon), SSE-Event
//! `lage_zone` bei POST/PATCH/DELETE und reguläre Org-Isolation (Fremd-Nutzer ohne
//! Mitgliedschaft, org_rolle="keine").
//!
//! Harness 1:1 aus tests/einsatzabschnitt.rs (+ etb.rs); `setup()` liefert zusätzlich
//! den LiveHub-Klon (teilt den inneren Arc mit dem AppState), damit der SSE-Test direkt
//! via `live.abonniere(einsatz_id)` mithören kann.

use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::{LiveHub, LiveNachricht};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::broadcast::Receiver;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie};

const POLY: &str =
    r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
const LINE: &str = r#"{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}"#;

async fn setup() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool,
        live: live.clone(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, live)
}

/// Fremder Nutzer ohne Einsatz-Mitgliedschaft und ohne höhere Berechtigung
/// (org_rolle="keine") — liefert dessen Login-Cookie. Vorbild: Org-Isolations-Test
/// in tests/einsatzabschnitt.rs (`fremde_org_kann_abschnitte_nicht_lesen_oder_schreiben`).
async fn fremder_nutzer(app: &axum::Router, admin: &str) -> String {
    benutzer_anlegen(app, admin, "fremd", "keine").await;
    login_cookie(app, "fremd", "fremdpw1").await
}

async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

async fn recv_until_tag(
    rx: &mut Receiver<LiveNachricht>,
    tag: &str,
    timeout: Duration,
) -> LiveNachricht {
    loop {
        let n = tokio::time::timeout(timeout, rx.recv())
            .await
            .unwrap_or_else(|_| panic!("Timeout: kein '{tag}'-Event empfangen"))
            .expect("Broadcast-Kanal geschlossen");
        if n.event.as_str() == tag {
            return n;
        }
    }
}

#[tokio::test]
async fn anlegen_setzt_zone_und_schreibt_etb_eingerichtet() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let body = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Chemie Halle 3"}).to_string();
    let (status, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["typ"], "gefahrengebiet");
    assert_eq!(z["geometrie_typ"], "Polygon");

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|i| i == "Gefahrengebiet «Chemie Halle 3» eingerichtet"),
        "ETB: {etb:?}"
    );
}

/// Trennlinie der Statuscode-Konvention an einer Stelle: b1 scheitert am Feld selbst
/// (unbekannter Enum-Wert) → 400; b2 und b3 haben lauter gültige Felder und scheitern erst
/// am Zusammenhang (Typ passt nicht zur Geometrie-Klasse bzw. geometrie.type widerspricht
/// dem deklarierten geometrie_typ) → 422. Beide Hälften bewusst in EINEM Test, damit die
/// Datei nicht pauschal auf einen der beiden Codes gekippt wird (LFH-305).
#[tokio::test]
async fn ungueltiger_typ_ist_400_kombination_bleibt_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let b1 = json!({"typ":"quatsch","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/zonen"),
            &admin,
            Some(&b1)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );

    let b2 = json!({"typ":"absperrgrenze","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/zonen"),
            &admin,
            Some(&b2)
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let b3 = json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":LINE}).to_string();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/zonen"),
            &admin,
            Some(&b3)
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

/// `geometrie_typ` war bis LFH-305 ungetestet — der Wert scheitert für sich (unbekannte
/// Enum-Variante), also 400. Der Positiv-Zweig sichert ab, dass der 400 wirklich aus der
/// Enum-Prüfung kommt und nicht aus einem vorgelagerten Gate (Auth/Einsatz-Zugriff).
#[tokio::test]
async fn unbekannter_geometrie_typ_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let u = format!("/api/einsaetze/{einsatz}/zonen");

    let schlecht =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Quatsch","geometrie":POLY}).to_string();
    let (status, body) = anfrage(&app, "POST", &u, &admin, Some(&schlecht)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body:?}");

    let gut =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (status, body) = anfrage(&app, "POST", &u, &admin, Some(&gut)).await;
    assert!(status.is_success(), "Positiv-Zweig: {status} {body:?}");
}

/// PATCH-Pendant zu `ungueltiger_typ_ist_400_kombination_bleibt_422`, bis LFH-305
/// ungetestet. Abgrenzung zu `patch_typ_inkompatibel_zur_geometrie_ist_422`: dort ist der
/// Typ gültig und passt nur nicht zur gespeicherten Geometrie (Zusammenhang → 422), hier
/// ist der Wert selbst keine bekannte Variante (Feld isoliert → 400).
#[tokio::test]
async fn patch_unbekannter_typ_ist_400() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    let u = format!("/api/einsaetze/{einsatz}/zonen/{zid}");

    let (status, antwort) = anfrage(&app, "PATCH", &u, &admin, Some(r#"{"typ":"quatsch"}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");

    // Positiv-Zweig: derselbe Aufruf mit gültigem, geometrie-kompatiblem Typ geht durch.
    let (status, antwort) =
        anfrage(&app, "PATCH", &u, &admin, Some(r#"{"typ":"freie_skizze"}"#)).await;
    assert_eq!(status, StatusCode::OK, "Positiv-Zweig: {antwort:?}");
}

#[tokio::test]
async fn patch_typ_oder_label_schreibt_etb_geaendert_notiz_und_farbe_nicht() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body = json!({"typ":"freie_skizze","geometrie_typ":"Polygon","geometrie":POLY,"label":"A","farbe":"#00ff00"}).to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    let basis = system_etb_inhalte(&app, &admin, einsatz).await.len();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        Some(r#"{"notiz":"egal"}"#),
    )
    .await;
    assert_eq!(
        system_etb_inhalte(&app, &admin, einsatz).await.len(),
        basis,
        "notiz darf keinen ETB erzeugen"
    );

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        Some(r##"{"farbe":"#ff0000"}"##),
    )
    .await;
    assert_eq!(
        system_etb_inhalte(&app, &admin, einsatz).await.len(),
        basis,
        "farbe darf keinen ETB erzeugen"
    );

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        Some(r#"{"label":"B"}"#),
    )
    .await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        etb.len(),
        basis + 1,
        "label-Änderung muss genau einen ETB erzeugen"
    );
    assert!(
        etb.iter().any(|i| i == "Freie Skizze «B» geändert"),
        "ETB: {etb:?}"
    );
}

#[tokio::test]
async fn patch_typ_weg_von_freie_skizze_nullt_farbe() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Freie Skizze (Polygon) mit Farbe; gefahrengebiet ist ebenfalls Polygon → Typ-Wechsel zulässig.
    let body =
        json!({"typ":"freie_skizze","geometrie_typ":"Polygon","geometrie":POLY,"farbe":"#00ff00"})
            .to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    assert_eq!(z["farbe"], "#00ff00");

    let (status, nach) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        Some(r#"{"typ":"gefahrengebiet"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{nach:?}");
    assert_eq!(nach["typ"], "gefahrengebiet");
    assert!(
        nach["farbe"].is_null(),
        "farbe muss beim Wechsel weg von freie_skizze genullt werden: {nach:?}"
    );
}

#[tokio::test]
async fn patch_typ_inkompatibel_zur_geometrie_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"absperrgrenze","geometrie_typ":"LineString","geometrie":LINE}).to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        Some(r#"{"typ":"gefahrengebiet"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn delete_schreibt_etb_aufgehoben() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"sperrgebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Tor 2"})
            .to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(|i| i == "Sperrgebiet «Tor 2» aufgehoben"),
        "ETB: {etb:?}"
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn sse_feuert_bei_post_patch_delete() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let n = recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
    let zid = z["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        Some(r#"{"label":"X"}"#),
    )
    .await;
    recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;

    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        None,
    )
    .await;
    recv_until_tag(&mut rx, "lage_zone", Duration::from_secs(1)).await;
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_kann_zonen_nicht_lesen_oder_schreiben() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    let fremd_c = fremder_nutzer(&app, &admin).await;

    let get = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &fremd_c,
        None,
    )
    .await
    .0;
    assert!(
        matches!(get, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "GET: {get}"
    );
    let post = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &fremd_c,
        Some(&body),
    )
    .await
    .0;
    assert!(
        matches!(post, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "POST: {post}"
    );
    let patch = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &fremd_c,
        Some(r#"{"label":"x"}"#),
    )
    .await
    .0;
    assert!(
        matches!(patch, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "PATCH: {patch}"
    );
    let del = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &fremd_c,
        None,
    )
    .await
    .0;
    assert!(
        matches!(del, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "DELETE: {del}"
    );
}

#[tokio::test]
async fn anlegen_gefahrengebiet_erzeugt_gruppe() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY,"label":"Nord"})
            .to_string();
    let (status, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert!(
        z["gefahrengebiet_id"].is_i64(),
        "gefahrengebiet-Zone bekommt eine Gruppe: {z:?}"
    );
    let (_, gebiete) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(gebiete.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn merge_haengt_zone_um_und_raeumt_leere_gruppe_auf() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let (_, b) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let ziel = b["gefahrengebiet_id"].as_i64().unwrap();
    let a_id = a["id"].as_i64().unwrap();

    let patch = json!({"gefahrengebiet_id": ziel}).to_string();
    let (status, a2) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"),
        &admin,
        Some(&patch),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{a2:?}");
    assert_eq!(a2["gefahrengebiet_id"], ziel);
    // Nur noch EIN Gebiet (Quellgruppe von A aufgeräumt), mit beiden Zonen.
    let (_, gebiete) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete"),
        &admin,
        None,
    )
    .await;
    let arr = gebiete.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["zonen_ids"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn merge_zone_adoptiert_ziel_matrix() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let (_, b) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let ziel = b["gefahrengebiet_id"].as_i64().unwrap();
    let a_id = a["id"].as_i64().unwrap();
    // Ziel-Matrix (B) hat eine Bewertung.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{ziel}/matrix/bewertung"),
        &admin,
        Some(
            &json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch"})
                .to_string(),
        ),
    )
    .await;
    // A umhängen → A liest jetzt B's Matrix.
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"),
        &admin,
        Some(&json!({"gefahrengebiet_id": ziel}).to_string()),
    )
    .await;
    let (_, matrix) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{ziel}/matrix"),
        &admin,
        None,
    )
    .await;
    assert_eq!(matrix.as_array().unwrap().len(), 1);
    assert_eq!(matrix[0]["warnstufe"], "hoch");
}

#[tokio::test]
async fn split_legt_neue_gruppe_an() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let (_, b) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let ziel = b["gefahrengebiet_id"].as_i64().unwrap();
    let a_id = a["id"].as_i64().unwrap();
    let alt_a = a["gefahrengebiet_id"].as_i64().unwrap();
    // A in B mergen …
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"),
        &admin,
        Some(&json!({"gefahrengebiet_id": ziel}).to_string()),
    )
    .await;
    // … dann A wieder abspalten (null → neue Gruppe).
    let (status, a2) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"),
        &admin,
        Some(&json!({"gefahrengebiet_id": null}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{a2:?}");
    let neu = a2["gefahrengebiet_id"].as_i64().unwrap();
    assert_ne!(neu, ziel, "neue eigene Gruppe");
    assert_ne!(
        neu, alt_a,
        "und nicht die ursprüngliche (aufgeräumte) Gruppe"
    );
    let (_, gebiete) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(gebiete.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn delete_letzter_zone_entfernt_gebiet_und_matrix() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    let gid = z["gefahrengebiet_id"].as_i64().unwrap();
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete/{gid}/matrix/bewertung"),
        &admin,
        Some(
            &json!({"gefahrentyp":"brand","schutzobjekt":"menschen","warnstufe":"hoch"})
                .to_string(),
        ),
    )
    .await;
    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/zonen/{zid}"),
        &admin,
        None,
    )
    .await;
    let (_, gebiete) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/gefahrengebiete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        gebiete.as_array().unwrap().len(),
        0,
        "Gebiet (und Matrix) mit der letzten Zone weg"
    );
}

#[tokio::test]
async fn merge_ziel_aus_fremdem_einsatz_ist_notfound() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, za) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{a}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let (_, zb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{b}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let za_id = za["id"].as_i64().unwrap();
    let gid_b = zb["gefahrengebiet_id"].as_i64().unwrap();
    // Zone aus A auf Gruppe aus B umhängen → abgewiesen.
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{a}/zonen/{za_id}"),
        &admin,
        Some(&json!({"gefahrengebiet_id": gid_b}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn gefahrengebiet_id_an_nicht_gefahrengebiet_zone_ist_422() {
    let (app, _live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let gbody =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, g) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&gbody),
    )
    .await;
    let gid = g["gefahrengebiet_id"].as_i64().unwrap();
    let abody =
        json!({"typ":"absperrbereich","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&abody),
    )
    .await;
    let aid = a["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{aid}"),
        &admin,
        Some(&json!({"gefahrengebiet_id": gid}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn merge_feuert_gefahr_event() {
    let (app, live) = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let body =
        json!({"typ":"gefahrengebiet","geometrie_typ":"Polygon","geometrie":POLY}).to_string();
    let (_, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let (_, b) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/zonen"),
        &admin,
        Some(&body),
    )
    .await;
    let ziel = b["gefahrengebiet_id"].as_i64().unwrap();
    let a_id = a["id"].as_i64().unwrap();
    let mut rx = live.abonniere(einsatz);
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/zonen/{a_id}"),
        &admin,
        Some(&json!({"gefahrengebiet_id": ziel}).to_string()),
    )
    .await;
    let n = recv_until_tag(&mut rx, "gefahr", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["gefahrengebiet_id"], ziel);
}
