//! LFH-170 Freie taktische Zeichen — Backend-Integrationstests.
//!
//! Deckt ab: CRUD (POST→GET→PATCH→DELETE), Teil-Patch-Semantik (LFH-306: absentes Feld
//! unverändert, `null` leert, lat/lon unverändert), Zeichenbeschreibung `zeichen_spec` und
//! Übergang mit altem Body (LFH-836: genau eine Form, sonst 400; ungültige Beschreibung 400;
//! Altfelder ohne Grundzeichen an einem Spec-Zeichen 422), 404 für fremden
//! Einsatz bzw. fremde zeichen-id, Gate-Matrix (GET braucht Lesezugriff+Modul; POST/PATCH/
//! DELETE Schreibrecht+aktiv+Modul; Org-Isolation), SSE-Event `freies_zeichen` (Wire-Tag +
//! Payload load-bearing für das Frontend).
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

/// Fremder Nutzer ohne Einsatz-Mitgliedschaft und ohne höhere Berechtigung (org_rolle="keine").
async fn fremder_nutzer(app: &axum::Router, admin: &str) -> String {
    benutzer_anlegen(app, admin, "fremd", "keine").await;
    login_cookie(app, "fremd", "fremdpw1").await
}

fn neu_body() -> String {
    json!({
        "lat": 50.1, "lon": 8.6, "grundzeichen": "einheit",
        "organisation": "feuerwehr", "fachaufgabe": "brandbekaempfung",
        "einheit": "zug", "farbe": "#ff0000", "label": "A"
    })
    .to_string()
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
    assert_eq!(z["grundzeichen"], "einheit");
    assert_eq!(z["organisation"], "feuerwehr");
    assert_eq!(z["lat"], 50.1);
    assert_eq!(z["lon"], 8.6);
    assert!(z.get("zeichen_spec").is_none_or(Value::is_null), "{z:?}");

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

/// Ein Zeichen ohne jede Form ist ein FORMALER Fehler → 400 (LFH-267/F22, Spec
/// `lagekarte-freie-zeichen`). Statuscode-Referenz: das Gegenstück im Zusammenhang ist
/// `altfelder_ohne_grundzeichen_an_spec_zeichen_ist_422`.
///
/// Umbenannt aus `fehlendes_grundzeichen_ist_400` (LFH-836): seit der Zeichenbeschreibung ist
/// `grundzeichen` nur noch eine der zwei Formen und strukturell optional, der Body scheitert
/// deshalb nicht mehr am Extractor, sondern an der Handler-Prüfung „genau eine Form“ — weiterhin
/// mit 400, weil der Body für sich kein Zeichen beschreibt. Overlays allein sind keine Form.
#[tokio::test]
async fn ohne_zeichenform_ist_400() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for body in [
        json!({"lat": 50.1, "lon": 8.6}),
        json!({"lat": 50.1, "lon": 8.6, "organisation": "feuerwehr", "label": "A"}),
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
        assert!(
            v["error"].as_str().unwrap().contains("zeichen_spec"),
            "Meldung nennt das Feld: {v:?}"
        );
    }
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);
}

/// Auch eine vorhandene, aber leere Form ist ein FORMALER Fehler → 400 (F22-B), für beide
/// Formen. Umbenannt aus `leeres_grundzeichen_ist_400` (LFH-836).
///
/// Der Body ist strukturell gültig, der Extractor lässt ihn durch; erst die
/// Handler-Validierung lehnt den Whitespace-only-Wert ab. 422 bliebe der Fall, in dem erst der
/// ZUSAMMENHANG die Aktion verbietet (Objekt-Zustand), nicht das Feld für sich.
#[tokio::test]
async fn leere_zeichenform_ist_400() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for (body, feld) in [
        (
            json!({"lat": 50.1, "lon": 8.6, "grundzeichen": "   "}),
            "grundzeichen",
        ),
        (
            json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": "  "}),
            "zeichen_spec",
        ),
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
        assert_eq!(v["error"], format!("{feld} darf nicht leer sein"));
    }
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);
}

// ===== LFH-836: Zeichenbeschreibung und Übergang =====

/// Ausgaben von `serializeAnySpec` aus `@einsatzzeichen/core` 5.2.0 (per Node erzeugt).
const STELLE_SANITAET: &str =
    r#"{"v":1,"spec":{"bodyMarks":["medical-service"],"kind":"post","organization":"feuerwehr"}}"#;
const DREHLEITER: &str =
    r#"{"v":1,"freestanding":{"kind":"pictogram","pictogram":"capability.rescue-aerial-ladder"}}"#;

async fn anzahl_zeichen(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (status, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{liste:?}");
    liste.as_array().unwrap().len()
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

/// Die Altform eines Zeichens ist leer: weder Grundzeichen noch Overlays (Schlüssel fehlt oder
/// ist `null`).
fn altform_leer(z: &Value) {
    for feld in [
        "grundzeichen",
        "organisation",
        "fachaufgabe",
        "symbol",
        "einheit",
        "funktion",
        "farbe",
    ] {
        assert!(z.get(feld).is_none_or(Value::is_null), "{feld} leer: {z:?}");
    }
}

/// Spec „Zeichen mit Grundzeichen anlegen“ und „Freistehendes Piktogramm anlegen“: die
/// Beschreibung kommt beim Lesen unverändert zurück, die Altspalten bleiben leer.
#[tokio::test]
async fn spec_anlegen_und_lesen() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for spec in [STELLE_SANITAET, DREHLEITER] {
        let z = spec_zeichen_anlegen(&app, &admin, einsatz, spec).await;
        assert_eq!(z["zeichen_spec"], spec, "{z:?}");
        assert_eq!(z["label"], "BHP");
        altform_leer(&z);
    }
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 2);
    assert_eq!(liste[0]["zeichen_spec"], STELLE_SANITAET);
    assert_eq!(liste[1]["zeichen_spec"], DREHLEITER);
}

/// Spec „Veralteter Client legt an“: der alte Body bleibt gültig und trägt keine
/// Zeichenbeschreibung.
#[tokio::test]
async fn altformat_anlegen_bleibt_moeglich() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, z) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&json!({"lat": 50.1, "lon": 8.6, "grundzeichen": "person"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    assert_eq!(z["grundzeichen"], "person");
    assert!(z.get("zeichen_spec").is_none_or(Value::is_null), "{z:?}");
}

/// Spec „Beide Formate zugleich“: Zeichenbeschreibung und Altform in einem Body → 400, beim
/// Anlegen wie beim Ändern; es entsteht nichts und es ändert sich nichts.
#[tokio::test]
async fn beide_formen_ist_400() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for body in [
        json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": STELLE_SANITAET, "grundzeichen": "person"}),
        json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": STELLE_SANITAET, "organisation": "thw"}),
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
    }
    assert_eq!(anzahl_zeichen(&app, &admin, einsatz).await, 0);

    let z = spec_zeichen_anlegen(&app, &admin, einsatz, STELLE_SANITAET).await;
    let zid = z["id"].as_i64().unwrap();
    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"zeichen_spec": DREHLEITER, "grundzeichen": "person"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{v:?}");
    // Auch Spec plus ein Overlay-Wert der Altform ist „beide Formen“ (Review LFH-836).
    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"zeichen_spec": DREHLEITER, "organisation": "thw"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{v:?}");
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["zeichen_spec"], STELLE_SANITAET, "unverändert");
}

/// Spec „Unbekannter Wert“ und „Beschriftung in der Beschreibung“: 400 mit Pfad, kein Zeichen;
/// beim PATCH bleibt die gespeicherte Beschreibung.
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
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["zeichen_spec"], STELLE_SANITAET, "unverändert");
}

/// Spec „Altzeichen wird geändert“: ein PATCH mit Zeichenbeschreibung an einer Altzeile schreibt
/// die Beschreibung und leert die Altspalten; Bezeichnung und Ansicht bleiben.
#[tokio::test]
async fn patch_altzeile_mit_spec_schreibt_spec_und_leert_altspalten() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zid = zeichen_mit_allen_overlays(&app, &admin, einsatz).await;

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
    altform_leer(&n);
    assert_eq!(n["label"], "A", "Bezeichnung bleibt");
    assert_eq!(n["lat"], 50.1);
}

/// Umgekehrt: ein alter Body mit Grundzeichen an einem Spec-Zeichen schreibt die Altform und
/// leert die Zeichenbeschreibung (Übergang, design.md D4).
#[tokio::test]
async fn patch_spec_zeichen_mit_altem_body_schreibt_altform() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let z = spec_zeichen_anlegen(&app, &admin, einsatz, STELLE_SANITAET).await;
    let zid = z["id"].as_i64().unwrap();

    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"grundzeichen": "fahrzeug", "organisation": "thw"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["grundzeichen"], "fahrzeug");
    assert_eq!(n["organisation"], "thw");
    assert!(n.get("zeichen_spec").is_none_or(Value::is_null), "{n:?}");
    assert_eq!(n["label"], "BHP");
}

/// Ein PATCH ohne Zeichenfelder (nur Bezeichnung oder Ansicht) lässt die gespeicherte Form
/// unberührt — auch der Ganz-Body eines veralteten Clients, der an einem Spec-Zeichen
/// `grundzeichen: null` und lauter `null`-Overlays mitschickt.
#[tokio::test]
async fn patch_nur_bezeichnung_laesst_form_unberuehrt() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let z = spec_zeichen_anlegen(&app, &admin, einsatz, DREHLEITER).await;
    let zid = z["id"].as_i64().unwrap();
    let aid = standard_ansicht_id(&app, &admin, einsatz).await;

    for (body, label) in [
        (json!({"label": "DLK 23"}), "DLK 23"),
        (json!({"ansicht_id": aid}), "DLK 23"),
        (
            json!({
                "grundzeichen": null, "organisation": null, "fachaufgabe": null,
                "symbol": null, "einheit": null, "funktion": null, "farbe": null,
                "label": "DLK 1"
            }),
            "DLK 1",
        ),
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
        assert_eq!(n["label"], label);
        altform_leer(&n);
    }
}

/// Statuscode-Referenz (Zusammenhang, `src/AGENTS.md`): ein Overlay-Wert ohne Grundzeichen an
/// einem Zeichen, das als Zeichenbeschreibung gespeichert ist, ist für sich ein gültiges Feld —
/// erst der Zustand des Zeichens verbietet ihn → 422, und nichts ändert sich. Gegenstück zu
/// `ohne_zeichenform_ist_400`.
#[tokio::test]
async fn altfelder_ohne_grundzeichen_an_spec_zeichen_ist_422() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let z = spec_zeichen_anlegen(&app, &admin, einsatz, STELLE_SANITAET).await;
    let zid = z["id"].as_i64().unwrap();

    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"organisation": "thw", "label": "X"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v:?}");
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["zeichen_spec"], STELLE_SANITAET, "unverändert");
    assert_eq!(liste[0]["label"], "BHP", "auch die Bezeichnung nicht");
    altform_leer(&liste[0]);
}

/// Migriert von `crud_whole_spec_haelt_lat_lon` (LFH-306): derselbe Teil-Body, invertierte
/// Zusage. Vor LFH-306 nullte ein PATCH ohne `organisation`/`fachaufgabe`/… diese Overlays
/// still mit; jetzt fasst er nur die gesendeten Felder an. lat/lon bleiben unverschiebbar.
#[tokio::test]
async fn crud_teil_patch_haelt_lat_lon_und_overlays() {
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

    // Teil-PATCH: nur grundzeichen + symbol; alle anderen Overlays bleiben stehen.
    let patch = json!({"grundzeichen": "fahrzeug", "symbol": "kran"}).to_string();
    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&patch),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["grundzeichen"], "fahrzeug");
    assert_eq!(n["symbol"], "kran");
    assert_eq!(n["organisation"], "feuerwehr", "nicht gesendet → bleibt");
    assert_eq!(n["fachaufgabe"], "brandbekaempfung");
    assert_eq!(n["einheit"], "zug");
    assert_eq!(n["farbe"], "#ff0000");
    assert_eq!(n["label"], "A");
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
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

// ===== LFH-306: Teil-Patch — absent ≠ null =====

/// Anlege-Body mit ALLEN sieben Overlay-Feldern gesetzt (für die Teil-Patch-Tests).
fn neu_body_alle_overlays() -> String {
    json!({
        "lat": 50.1, "lon": 8.6, "grundzeichen": "einheit",
        "organisation": "feuerwehr", "fachaufgabe": "brandbekaempfung",
        "symbol": "kran", "einheit": "zug", "funktion": "zugtrupp",
        "farbe": "#ff0000", "label": "A"
    })
    .to_string()
}

/// Legt ein Zeichen mit allen sieben Overlays an und liefert dessen id.
async fn zeichen_mit_allen_overlays(app: &axum::Router, admin: &str, einsatz: i64) -> i64 {
    let (status, z) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        admin,
        Some(&neu_body_alle_overlays()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{z:?}");
    z["id"].as_i64().unwrap()
}

/// Der Kern von LFH-306: ein Patch, der nur `label` schickt, lässt alle sieben Overlays
/// stehen. Gegen HEAD fällt das hart durch — der Whole-Spec-Overwrite nullte sie mit.
///
/// Zwei Runden: erst MIT `grundzeichen` im Body (gegen HEAD deserialisierbar, damit die
/// Rotfärbung wirklich vom Overwrite kommt und nicht vom Extractor), dann der minimale
/// Body `{"label": …}` allein — der ist überhaupt erst seit LFH-306 zulässig.
#[tokio::test]
async fn patch_nur_label_laesst_overlays_stehen() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zid = zeichen_mit_allen_overlays(&app, &admin, einsatz).await;

    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"grundzeichen": "einheit", "label": "X"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["label"], "X");
    assert_eq!(n["organisation"], "feuerwehr", "Overlay unberührt: {n:?}");
    assert_eq!(n["fachaufgabe"], "brandbekaempfung");
    assert_eq!(n["symbol"], "kran");
    assert_eq!(n["einheit"], "zug");
    assert_eq!(n["funktion"], "zugtrupp");
    assert_eq!(n["farbe"], "#ff0000");
    assert_eq!(n["grundzeichen"], "einheit");

    // Minimalster Teil-Patch: nur `label`, ohne jedes weitere Feld.
    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"label": "Y"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["label"], "Y");
    assert_eq!(n["organisation"], "feuerwehr");
    assert_eq!(n["funktion"], "zugtrupp");
    assert_eq!(n["farbe"], "#ff0000");
}

/// Grenzt gegen `patch_nur_label_laesst_overlays_stehen` ab: `null` ist der Leerwunsch und
/// trifft GENAU das gesendete Feld — die übrigen sechs Overlays bleiben stehen.
#[tokio::test]
async fn patch_organisation_null_loescht_nur_diese() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zid = zeichen_mit_allen_overlays(&app, &admin, einsatz).await;

    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"grundzeichen": "einheit", "organisation": null}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert!(n["organisation"].is_null(), "null leert das Feld: {n:?}");
    assert_eq!(n["fachaufgabe"], "brandbekaempfung", "Nachbar unberührt");
    assert_eq!(n["symbol"], "kran");
    assert_eq!(n["einheit"], "zug");
    assert_eq!(n["funktion"], "zugtrupp");
    assert_eq!(n["farbe"], "#ff0000");
    assert_eq!(n["label"], "A");
}

/// Ein Patch OHNE `grundzeichen` lässt es stehen (statt am Extractor zu scheitern), ein Patch
/// mit LEEREM Wert bleibt 400 (Statuscode-Konvention, LFH-267/F22). Die POST-seitigen
/// Referenztests heißen seit LFH-836 `ohne_zeichenform_ist_400`/`leere_zeichenform_ist_400`.
#[tokio::test]
async fn patch_ohne_grundzeichen_behaelt_grundzeichen() {
    let (app, _live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zid = zeichen_mit_allen_overlays(&app, &admin, einsatz).await;

    let (status, n) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"label": "Z"}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{n:?}");
    assert_eq!(n["grundzeichen"], "einheit", "nicht gesendet → bleibt");
    assert_eq!(n["label"], "Z");

    // Vorhanden, aber leer → 400 (das Feld ist ISOLIERT unbrauchbar).
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen/{zid}"),
        &admin,
        Some(&json!({"grundzeichen": "   "}).to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
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
    let patch = json!({"grundzeichen": "fahrzeug"}).to_string();
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
        Some(&json!({"grundzeichen": "fahrzeug"}).to_string()),
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
        Some(&json!({"grundzeichen": "fahrzeug"}).to_string()),
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
        Some(&json!({"grundzeichen": "fahrzeug"}).to_string()),
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
    let mut body = json!({"lat": 50.1, "lon": 8.6, "grundzeichen": "einheit"});
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
        Some(&json!({"lat":50.1,"lon":8.6,"grundzeichen":"einheit","ansicht_id":aid}).to_string()),
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
                &json!({"lat":50.1,"lon":8.6,"grundzeichen":"einheit","ansicht_id":aid})
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
