//! LFH-170 Freie taktische Zeichen — Backend-Integrationstests.
//!
//! Deckt ab: CRUD (POST→GET→PATCH→DELETE), Teil-Patch-Semantik (LFH-306: absentes Feld
//! unverändert, `null` leert, lat/lon unverändert), Zeichenbeschreibung `zeichen_spec` (LFH-836;
//! seit LLH-1160 die einzige Form: fehlend, leer oder ungültig 400, alter Body 400, Altzeilen als
//! Hülle aus Migration 0190), 404 für fremden Einsatz bzw. fremde zeichen-id, Gate-Matrix (GET
//! braucht Lesezugriff+Modul; POST/PATCH/DELETE Schreibrecht+aktiv+Modul; Org-Isolation),
//! SSE-Event `freies_zeichen` (Wire-Tag + Payload load-bearing für das Frontend).
//!
//! Harness aus tests/common; `setup_mit_live()` liefert zusätzlich den LiveHub-Klon
//! (teilt den inneren Arc mit dem AppState), damit der SSE-Test direkt mithören kann.

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, karten_ansicht_anlegen, login_cookie,
    recv_until_tag, setup_mit_live, setup_mit_pool, standard_ansicht_id,
};

/// Ausgaben von `serializeAnySpec` aus `@einsatzzeichen/core` 5.2.0 (per Node erzeugt).
const STELLE_SANITAET: &str =
    r#"{"v":1,"spec":{"bodyMarks":["medical-service"],"kind":"post","organization":"feuerwehr"}}"#;
const DREHLEITER: &str =
    r#"{"v":1,"freestanding":{"kind":"pictogram","pictogram":"capability.rescue-aerial-ladder"}}"#;

/// Die Altspalten vor LLH-1160; seitdem stehen sie in keiner Antwort mehr.
const ALTFELDER: [&str; 7] = [
    "grundzeichen",
    "organisation",
    "fachaufgabe",
    "symbol",
    "einheit",
    "funktion",
    "farbe",
];

/// Fremder Nutzer ohne Einsatz-Mitgliedschaft und ohne höhere Berechtigung (org_rolle="keine").
async fn fremder_nutzer(app: &axum::Router, admin: &str) -> String {
    benutzer_anlegen(app, admin, "fremd", "keine").await;
    login_cookie(app, "fremd", "fremdpw1").await
}

fn neu_body() -> String {
    json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": STELLE_SANITAET, "label": "A"}).to_string()
}

/// Ein PATCH-Body, der nur die Zeichenbeschreibung ändert.
fn spec_patch() -> String {
    json!({"zeichen_spec": DREHLEITER}).to_string()
}

async fn anzahl_zeichen(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    liste(app, cookie, einsatz).await.as_array().unwrap().len()
}

async fn liste(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{liste:?}");
    liste
}

/// Legt ein Zeichen mit Zeichenbeschreibung an und liefert die Antwort.
async fn spec_zeichen_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, spec: &str) -> Value {
    let (status, z) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        cookie,
        Some(&json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": spec, "label": "BHP"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    z
}

/// Keine Antwort trägt mehr ein Feld der Altform.
fn ohne_altfelder(z: &Value) {
    for feld in ALTFELDER {
        assert!(z.get(feld).is_none(), "{feld} entfallen: {z:?}");
    }
}

#[tokio::test]
async fn anlegen_und_liste() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["zeichen_spec"], STELLE_SANITAET);
    assert_eq!(z["label"], "A");
    assert_eq!(z["lat"], 50.1);
    assert_eq!(z["lon"], 8.6);
    ohne_altfelder(&z);

    let liste = liste(&app, &admin, einsatz).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
    assert_eq!(liste[0]["zeichen_spec"], STELLE_SANITAET);
}

/// Ein Zeichen ohne Zeichenbeschreibung ist ein FORMALER Fehler → 400 (LFH-267/F22, Spec
/// `lagekarte-freie-zeichen`): der Body beschreibt für sich kein Zeichen.
///
/// Umbenannt aus `fehlendes_grundzeichen_ist_400` (LFH-836). Seit LLH-1160 ist `zeichen_spec`
/// die einzige Form; `null` gilt wie nicht gesendet.
#[tokio::test]
async fn ohne_zeichenform_ist_400() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for body in [
        json!({"lat": 50.1, "lon": 8.6}),
        json!({"lat": 50.1, "lon": 8.6, "label": "A"}),
        json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": null, "grundzeichen": null}),
    ] {
        let (status, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
            &admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {v:?}");
        assert_eq!(v["error"], "zeichen_spec fehlt", "{body}");
    }
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);
}

/// Auch eine vorhandene, aber leere Zeichenbeschreibung ist ein FORMALER Fehler → 400 (F22-B),
/// beim Anlegen wie beim Ändern. Umbenannt aus `leeres_grundzeichen_ist_400` (LFH-836).
///
/// Der Body ist strukturell gültig, der Extractor lässt ihn durch; erst die
/// Handler-Validierung lehnt den Whitespace-only-Wert ab.
#[tokio::test]
async fn leere_zeichenform_ist_400() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": "  "}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{v:?}");
    assert_eq!(v["error"], "zeichen_spec darf nicht leer sein");
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);

    let z = spec_zeichen_anlegen(&app, &admin, einsatz, STELLE_SANITAET).await;
    let zid = z["id"].as_i64().unwrap();
    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"zeichen_spec": "  "}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{v:?}");
    assert_eq!(
        liste(&app, &admin, einsatz).await[0]["zeichen_spec"],
        STELLE_SANITAET
    );
}

// ===== LFH-836: Zeichenbeschreibung, LLH-1160: Ende des Übergangs =====

/// Spec „Zeichen mit Grundzeichen anlegen“ und „Freistehendes Piktogramm anlegen“: die
/// Beschreibung kommt beim Lesen unverändert zurück.
#[tokio::test]
async fn spec_anlegen_und_lesen() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for spec in [STELLE_SANITAET, DREHLEITER] {
        let z = spec_zeichen_anlegen(&app, &admin, einsatz, spec).await;
        assert_eq!(z["zeichen_spec"], spec, "{z:?}");
        assert_eq!(z["label"], "BHP");
        ohne_altfelder(&z);
    }
    let liste = liste(&app, &admin, einsatz).await;
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 2);
    assert_eq!(liste[0]["zeichen_spec"], STELLE_SANITAET);
    assert_eq!(liste[1]["zeichen_spec"], DREHLEITER);
}

/// Spec „Veralteter Client sendet das alte Format“ (LLH-1160): Grundzeichen oder ein Overlay-Wert
/// der Altform → 400 mit Hinweis, allein oder neben einer Zeichenbeschreibung, beim Anlegen wie
/// beim Ändern. Es entsteht nichts und es ändert sich nichts; nichts wird still verworfen.
#[tokio::test]
async fn altes_format_ist_400() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for body in [
        json!({"lat": 50.1, "lon": 8.6, "grundzeichen": "person"}),
        json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": STELLE_SANITAET, "grundzeichen": "person"}),
        json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": STELLE_SANITAET, "organisation": "thw"}),
        json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": STELLE_SANITAET, "farbe": "#ff0000"}),
    ] {
        let (status, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
            &admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {v:?}");
        assert!(
            v["error"].as_str().unwrap().contains("alte Format"),
            "Meldung nennt den Grund: {v:?}"
        );
    }
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);

    let z = spec_zeichen_anlegen(&app, &admin, einsatz, STELLE_SANITAET).await;
    let zid = z["id"].as_i64().unwrap();
    for body in [
        json!({"grundzeichen": "fahrzeug", "organisation": "thw"}),
        json!({"organisation": "thw", "label": "X"}),
        json!({"zeichen_spec": DREHLEITER, "grundzeichen": "person"}),
        json!({"symbol": "kran"}),
    ] {
        let (status, v) = anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
            &admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {v:?}");
    }
    let liste = liste(&app, &admin, einsatz).await;
    assert_eq!(liste[0]["zeichen_spec"], STELLE_SANITAET, "unverändert");
    assert_eq!(liste[0]["label"], "BHP", "auch die Bezeichnung nicht");
}

/// Spec „Unbekannter Wert“ und „Beschriftung in der Beschreibung“: 400 mit Pfad, kein Zeichen;
/// beim PATCH bleibt die gespeicherte Beschreibung. Die Hülle der Altzeilen (Migration 0190)
/// nimmt der Server von außen nicht an.
#[tokio::test]
async fn ungueltige_spec_ist_400() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for (spec, erwartet) in [
        (
            r#"{"v":1,"spec":{"kind":"post","organization":"gibt-es-nicht"}}"#,
            "$.spec.organization",
        ),
        (
            r#"{"v":1,"spec":{"designation":"ELW 1","kind":"vehicle-land"}}"#,
            "„label“",
        ),
        (r#"{"v":2,"spec":{"kind":"post"}}"#, "$.v"),
        ("kein json", "kein gültiges JSON"),
        (r#"{"v":1,"alt":{"grundzeichen":"person"}}"#, "$.alt"),
    ] {
        let (status, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
            &admin,
            Some(&json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": spec}).to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{spec}: {v:?}");
        let meldung = v["error"].as_str().unwrap();
        assert!(meldung.starts_with("zeichen_spec: "), "{meldung}");
        assert!(meldung.contains(erwartet), "{meldung}");
    }
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);

    let z = spec_zeichen_anlegen(&app, &admin, einsatz, STELLE_SANITAET).await;
    let zid = z["id"].as_i64().unwrap();
    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"zeichen_spec": r#"{"v":1,"spec":{"kind":"raumschiff"}}"#}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{v:?}");
    assert_eq!(
        liste(&app, &admin, einsatz).await[0]["zeichen_spec"],
        STELLE_SANITAET,
        "unverändert"
    );
}

/// Spec „Altzeichen wird geändert“ (LLH-1160): eine Altzeile trägt nach Migration 0190 ihre
/// Altwerte als Hülle in `zeichen_spec` und kommt so beim Lesen zurück. Eine Umbenennung lässt
/// die Hülle stehen, erst eine neue Zeichenbeschreibung ersetzt sie; Bezeichnung und Position
/// bleiben.
#[tokio::test]
async fn altzeile_bleibt_huelle_bis_zur_neuen_beschreibung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let huelle =
        r##"{"v":1,"alt":{"grundzeichen":"fahrzeug","organisation":"thw","farbe":"#ff0000"}}"##;
    let zid: i64 = sqlx::query_scalar(
        "INSERT INTO freies_zeichen (einsatz_id, lat, lon, zeichen_spec, label, erstellt_von) \
         VALUES (?, 50.1, 8.6, ?, 'A', (SELECT id FROM benutzer LIMIT 1)) RETURNING id",
    )
    .bind(einsatz)
    .bind(huelle)
    .fetch_one(&pool)
    .await
    .unwrap();

    let z = &liste(&app, &admin, einsatz).await[0];
    assert_eq!(z["zeichen_spec"], huelle, "Hülle kommt unverändert zurück");
    ohne_altfelder(z);

    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"label": "B"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["zeichen_spec"], huelle, "Umbenennung lässt die Hülle");
    assert_eq!(n["label"], "B");

    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"zeichen_spec": STELLE_SANITAET}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["zeichen_spec"], STELLE_SANITAET);
    assert_eq!(n["label"], "B", "Bezeichnung bleibt");
    assert_eq!(n["lat"], 50.1);
}

/// Ein PATCH ohne Zeichenbeschreibung (nur Bezeichnung oder Ansicht) lässt die gespeicherte Form
/// unberührt — auch ein Body, der die Altfelder als `null` mitschickt (gilt als nicht gesendet).
#[tokio::test]
async fn patch_nur_bezeichnung_laesst_form_unberuehrt() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let z = spec_zeichen_anlegen(&app, &admin, einsatz, DREHLEITER).await;
    let zid = z["id"].as_i64().unwrap();
    let aid = standard_ansicht_id(&app, &admin, einsatz).await;

    for (body, label) in [
        (json!({"label": "DLK 23"}), Some("DLK 23")),
        (json!({"ansicht_id": aid}), Some("DLK 23")),
        (
            json!({
                "grundzeichen": null, "organisation": null, "fachaufgabe": null,
                "symbol": null, "einheit": null, "funktion": null, "farbe": null,
                "label": "DLK 1"
            }),
            Some("DLK 1"),
        ),
        (json!({"label": null}), None),
    ] {
        let (status, n) = anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
            &admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}: {n:?}");
        assert_eq!(n["zeichen_spec"], DREHLEITER, "Form unberührt: {body}");
        assert_eq!(n["label"].as_str(), label, "{body}");
        ohne_altfelder(&n);
    }
}

/// Migriert von `crud_whole_spec_haelt_lat_lon` (LFH-306): ein Teil-PATCH fasst nur die
/// gesendeten Felder an. lat/lon bleiben unverschiebbar.
#[tokio::test]
async fn crud_teil_patch_haelt_lat_lon() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    // Teil-PATCH: nur die Beschreibung; die Bezeichnung bleibt stehen.
    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&spec_patch()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["zeichen_spec"], DREHLEITER);
    assert_eq!(n["label"], "A", "nicht gesendet → bleibt");
    // lat/lon nicht verschiebbar.
    assert_eq!(n["lat"], 50.1);
    assert_eq!(n["lon"], 8.6);

    // DELETE → Liste leer.
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);
}

#[tokio::test]
async fn patch_und_delete_fremder_einsatz_oder_id_ist_404() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;

    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{a}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    // Zeichen aus A über Einsatz B ansprechen → 404.
    let patch = spec_patch();
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{b}/freie-zeichen/{zid}"),
            &admin,
            Some(&patch)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{b}/freie-zeichen/{zid}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );

    // Unbekannte zeichen-id im richtigen Einsatz → 404.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{a}/freie-zeichen/999999"),
            &admin,
            Some(&patch)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn org_isolation_fremder_nutzer_kann_nicht_lesen_oder_schreiben() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    let fremd_c = fremder_nutzer(&app, &admin).await;

    let get = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
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
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &fremd_c,
        Some(&neu_body()),
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
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &fremd_c,
        Some(&spec_patch()),
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
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
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
async fn sse_feuert_bei_post_patch_delete() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();
    let n = recv_until_tag(&mut rx, "freies_zeichen", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["einsatz_id"], einsatz);
    assert_eq!(v["zeichen_id"], zid);

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&spec_patch()),
    )
    .await;
    recv_until_tag(&mut rx, "freies_zeichen", Duration::from_secs(1)).await;

    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        None,
    )
    .await;
    recv_until_tag(&mut rx, "freies_zeichen", Duration::from_secs(1)).await;
}

#[tokio::test]
async fn abgeschlossener_einsatz_blockt_schreibrouten() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Zeichen anlegen, solange der Einsatz noch aktiv ist (für den PATCH/DELETE-Pfad).
    let (_, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await;
    let zid = z["id"].as_i64().unwrap();

    // Einsatz direkt in DB abschließen (Test-Shortcut, umgeht die Abschluss-Route mit
    // Nachlauffrist-Effekten — wir wollen nur `fordere_aktiv` prüfen). Muster: tests/einsatz_uhs.rs.
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
         abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();

    // `fordere_aktiv` läuft vor der Zeichen-id-Auflösung → POST/PATCH/DELETE liefern alle 409
    // (kein 404), obwohl der Admin Schreibrecht + Modul-Zugriff hat: der Abschluss ist der
    // einzige greifende Gate.
    let post = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&neu_body()),
    )
    .await
    .0;
    assert_eq!(
        post,
        StatusCode::CONFLICT,
        "POST auf abgeschlossenem Einsatz → 409"
    );

    let patch = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&spec_patch()),
    )
    .await
    .0;
    assert_eq!(
        patch,
        StatusCode::CONFLICT,
        "PATCH auf abgeschlossenem Einsatz → 409"
    );

    let del = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        None,
    )
    .await
    .0;
    assert_eq!(
        del,
        StatusCode::CONFLICT,
        "DELETE auf abgeschlossenem Einsatz → 409"
    );
}

// ---------- B (LFH-320): Ansichts-Zugehörigkeit ----------

async fn zeichen_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ansicht_id: Option<i64>,
) -> i64 {
    let mut body = json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": DREHLEITER});
    if let Some(a) = ansicht_id {
        body["ansicht_id"] = json!(a);
    }
    let (s, z) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "zeichen_anlegen: {z:?}");
    z["id"].as_i64().unwrap()
}

/// POST mit `ansicht_id` stempelt die Zugehörigkeit des freien Zeichens.
#[tokio::test]
async fn anlegen_mit_ansicht_id_stempelt_zugehoerigkeit() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = standard_ansicht_id(&app, &admin, einsatz).await;

    let (s, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&json!({"lat":50.1,"lon":8.6,"zeichen_spec":DREHLEITER,"ansicht_id":aid}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["ansicht_id"], aid, "ansicht_id gestempelt: {z:?}");
}

/// `?ansicht=X` liefert die X-Zeichen und die NULL-Zeichen, NICHT die von Y (Negativ-
/// Assertion, Mutationsprobe-Ziel).
#[tokio::test]
async fn liste_ansicht_filtert_fremde_aus_haelt_null() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let x = standard_ansicht_id(&app, &admin, einsatz).await;
    let y = karten_ansicht_anlegen(&app, &admin, einsatz, "Y").await;

    let zx = zeichen_anlegen(&app, &admin, einsatz, Some(x)).await;
    let zy = zeichen_anlegen(&app, &admin, einsatz, Some(y)).await;
    let znull = zeichen_anlegen(&app, &admin, einsatz, None).await;

    let (s, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen?ansicht={x}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{liste:?}");
    let ids: Vec<i64> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|z| z["id"].as_i64().unwrap())
        .collect();
    assert!(ids.contains(&zx), "X-Zeichen sichtbar: {ids:?}");
    assert!(ids.contains(&znull), "NULL-Zeichen sichtbar: {ids:?}");
    assert!(
        !ids.contains(&zy),
        "Y-Zeichen NICHT sichtbar auf X: {ids:?}"
    );
}

/// LFH-738: Eine `ansicht_id` aus einem ANDEREN Einsatz wird abgelehnt, beim Anlegen wie im
/// PATCH, mit 404 wie eine unbekannte id (kein Existenz-Orakel).
#[tokio::test]
async fn fremde_ansicht_id_ist_404() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let eigene = standard_ansicht_id(&app, &admin, einsatz).await;
    let fremde = standard_ansicht_id(&app, &admin, anderer).await;

    for aid in [fremde, 999_999_999] {
        let (s, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
            &admin,
            Some(
                &json!({"lat":50.1,"lon":8.6,"zeichen_spec":DREHLEITER,"ansicht_id":aid})
                    .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "POST ansicht_id={aid}: {v:?}");
    }

    let zid = zeichen_anlegen(&app, &admin, einsatz, Some(eigene)).await;
    for aid in [fremde, 999_999_999] {
        let (s, v) = anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
            &admin,
            Some(&json!({"ansicht_id": aid}).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "PATCH ansicht_id={aid}: {v:?}");
    }

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    let zeichen = liste.as_array().unwrap();
    assert_eq!(zeichen.len(), 1, "kein Zeichen angelegt: {zeichen:?}");
    assert_eq!(
        zeichen[0]["ansicht_id"], eigene,
        "Zuordnung unverändert: {zeichen:?}"
    );
}
