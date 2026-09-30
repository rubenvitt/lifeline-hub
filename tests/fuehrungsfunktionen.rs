//! Integrationstests des Funktionskatalogs (LFH-549).
//!
//! Spec: `openspec/changes/archive/2026-09-30-lfh-549-funktionskatalog/specs/fuehrungsfunktionen/spec.md`.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

const KATALOG: &str = "/api/fuehrungsfunktionen";

fn setzen_pfad(funktion: &str) -> String {
    format!("/api/org-fuehrungsfunktionen/{funktion}")
}

fn codes(json: &Value) -> Vec<String> {
    json.as_array()
        .unwrap()
        .iter()
        .map(|e| e["funktion"].as_str().unwrap().to_string())
        .collect()
}

fn eintrag<'a>(json: &'a Value, funktion: &str) -> &'a Value {
    json.as_array()
        .unwrap()
        .iter()
        .find(|e| e["funktion"] == funktion)
        .unwrap_or_else(|| panic!("{funktion} fehlt im Katalog"))
}

// ---------- Katalog ----------

#[tokio::test]
async fn katalog_in_reihenfolge_ohne_s7() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(&app, "GET", KATALOG, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        codes(&json),
        [
            "el",
            "s1",
            "s2",
            "s3",
            "s4",
            "s5",
            "s6",
            "fuehrungshilfspersonal",
            "fachberater"
        ]
    );
    let s3 = eintrag(&json, "s3");
    assert_eq!(s3["kuerzel"], "S3");
    assert_eq!(s3["label"], "Einsatz");
    assert_eq!(s3["art"], "sachgebiet");
    assert_eq!(s3["bezeichnung_pflicht"], false);
    let fb = eintrag(&json, "fachberater");
    assert!(
        !fb.as_object().unwrap().contains_key("kuerzel"),
        "Fachberater hat kein Kürzel"
    );
    assert_eq!(fb["bezeichnung_pflicht"], true);
    assert_eq!(fb["art"], "fachberater");
}

#[tokio::test]
async fn katalog_liest_auch_ohne_adminrecht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;

    let (status, _) = anfrage(&app, "GET", KATALOG, &helfer, None).await;
    assert_eq!(status, StatusCode::OK);
}

// ---------- Mandantenlabels ----------

#[tokio::test]
async fn thw_label_setzen_und_zuruecksetzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        &setzen_pfad("s4"),
        &admin,
        Some(r#"{"label":"Versorgung (Logistik)"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(eintrag(&json, "s4")["label"], "Versorgung (Logistik)");
    assert_eq!(eintrag(&json, "s4")["standard_label"], "Versorgung");

    let (_, json) = anfrage(
        &app,
        "PUT",
        &setzen_pfad("s4"),
        &admin,
        Some(r#"{"label":"  "}"#),
    )
    .await;
    assert_eq!(eintrag(&json, "s4")["label"], "Versorgung");
}

#[tokio::test]
async fn fremde_org_sieht_das_label_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw12", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;

    anfrage(
        &app,
        "PUT",
        &setzen_pfad("s5"),
        &admin,
        Some(r#"{"label":"Öffentlichkeitsarbeit"}"#),
    )
    .await;
    let (_, json) = anfrage(&app, "GET", KATALOG, &fremd, None).await;
    assert_eq!(eintrag(&json, "s5")["label"], "Presse- und Medienarbeit");
}

#[tokio::test]
async fn s7_einschalten_zeigt_es_im_katalog() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        &setzen_pfad("s7"),
        &admin,
        Some(r#"{"aktiv":true}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(codes(&json).contains(&"s7".to_string()));
}

#[tokio::test]
async fn aktiv_nur_fuer_s7_sonst_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &setzen_pfad("s4"),
        &admin,
        Some(r#"{"aktiv":false}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn nicht_admin_darf_kein_label_setzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fuehrer", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrer", "fuehrerpw1").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &setzen_pfad("s4"),
        &fk,
        Some(r#"{"label":"x"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unbekannter_code_und_zu_langes_label_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &setzen_pfad("s9"),
        &admin,
        Some(r#"{"label":"x"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let lang = "x".repeat(61);
    let (status, _) = anfrage(
        &app,
        "PUT",
        &setzen_pfad("s4"),
        &admin,
        Some(&format!(r#"{{"label":"{lang}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ---------- Empfänger: Auftrag, Erinnerung, Führungsstelle ----------

fn auftrag_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/auftraege")
}

fn erinnerung_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/erinnerungen")
}

fn besetzung_pfad(einsatz: i64, sachgebiet: &str) -> String {
    format!("/api/einsaetze/{einsatz}/stab/besetzung/{sachgebiet}")
}

async fn auftrag_an(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    empfaenger: Value,
) -> (StatusCode, Value) {
    let body = serde_json::json!({
        "auftrag_text": "Lage erkunden",
        "empfaenger": [empfaenger],
    })
    .to_string();
    anfrage(app, "POST", &auftrag_pfad(einsatz), cookie, Some(&body)).await
}

async fn stab_extern(app: &axum::Router, cookie: &str, einsatz: i64, sg: &str, name: &str) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &besetzung_pfad(einsatz, sg),
        cookie,
        Some(&format!(
            r#"{{"besetzung_art":"extern","bezeichnung":"{name}"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Besetzung setzen: {json:?}");
}

async fn erster_auftrag(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(app, "GET", &auftrag_pfad(einsatz), cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    json.as_array().unwrap()[0].clone()
}

#[tokio::test]
async fn auftrag_an_s3_mit_snapshot_ohne_person() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stab_extern(&app, &admin, einsatz, "s3", "Müller").await;

    let (status, json) = auftrag_an(
        &app,
        &admin,
        einsatz,
        serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s3"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    let e = &json["empfaenger"][0];
    assert_eq!(e["funktion"], "s3");
    assert_eq!(e["snap_anzeige"], "S3 Einsatz");
    assert!(
        e["funktion_text"].is_null(),
        "kein Text an einem Sachgebiet: {e:?}"
    );

    // Das `an` der ETB-Anordnung ist aus dem Snapshot gebaut — ohne den Namen.
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let anordnung = etb
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["an"].as_str().is_some_and(|a| a.contains("S3 Einsatz")))
        .unwrap_or_else(|| panic!("ETB-Anordnung an S3 fehlt: {etb:?}"));
    assert!(!anordnung["an"].as_str().unwrap().contains("Müller"));
}

/// Paar-Test (Akzeptanzkriterium LFH-549): der Snapshot bleibt, die Auflösung folgt der
/// Besetzung.
#[tokio::test]
async fn auftrag_an_s3_loest_zur_lesezeit_auf_die_aktuelle_besetzung_auf() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stab_extern(&app, &admin, einsatz, "s3", "Müller").await;
    let (status, _) = auftrag_an(
        &app,
        &admin,
        einsatz,
        serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s3"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let vorher = erster_auftrag(&app, &admin, einsatz).await;
    let e = &vorher["empfaenger"][0];
    assert_eq!(e["snap_anzeige"], "S3 Einsatz");
    assert_eq!(e["aktuelle_besetzung"]["zustand"], "extern");
    assert_eq!(e["aktuelle_besetzung"]["name"], "Müller");

    stab_extern(&app, &admin, einsatz, "s3", "Schulz").await;

    let nachher = erster_auftrag(&app, &admin, einsatz).await;
    let e = &nachher["empfaenger"][0];
    assert_eq!(e["snap_anzeige"], "S3 Einsatz", "Snapshot bleibt");
    assert_eq!(e["aktuelle_besetzung"]["name"], "Schulz", "Auflösung folgt");
}

#[tokio::test]
async fn nicht_vergeben_und_bei_der_einsatzleitung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    auftrag_an(
        &app,
        &admin,
        einsatz,
        serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s4"}),
    )
    .await;
    let a = erster_auftrag(&app, &admin, einsatz).await;
    let bes = &a["empfaenger"][0]["aktuelle_besetzung"];
    assert_eq!(bes["zustand"], "nicht_vergeben");
    assert!(!bes.as_object().unwrap().contains_key("name"));

    let (status, _) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s4"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let a = erster_auftrag(&app, &admin, einsatz).await;
    assert_eq!(
        a["empfaenger"][0]["aktuelle_besetzung"]["zustand"],
        "einsatzleitung"
    );
}

#[tokio::test]
async fn keine_aufloesung_fuer_freitext_el_und_fachberater() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stab_extern(&app, &admin, einsatz, "s3", "Müller").await;

    for (empf, snap) in [
        (
            serde_json::json!({"empfaenger_typ": "funktion", "funktion_text": "S3"}),
            "S3",
        ),
        (
            serde_json::json!({"empfaenger_typ": "funktion", "funktion": "el"}),
            "Einsatzleitung",
        ),
        (
            serde_json::json!({"empfaenger_typ": "funktion", "funktion": "fachberater", "funktion_text": "THW"}),
            "Fachberater: THW",
        ),
    ] {
        let (status, json) = auftrag_an(&app, &admin, einsatz, empf).await;
        assert_eq!(status, StatusCode::CREATED, "{json:?}");
        let e = &json["empfaenger"][0];
        assert_eq!(e["snap_anzeige"], snap);
        assert!(
            !e.as_object().unwrap().contains_key("aktuelle_besetzung"),
            "{snap}: keine Auflösung erwartet, {e:?}"
        );
    }
    // Freitext „S3“ bleibt Freitext — kein Rückschluss auf den Code.
    let (_, liste) = anfrage(&app, "GET", &auftrag_pfad(einsatz), &admin, None).await;
    let freitext = liste
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|a| a["empfaenger"].as_array().unwrap().clone())
        .find(|e| e["snap_anzeige"] == "S3")
        .unwrap();
    assert!(!freitext.as_object().unwrap().contains_key("funktion"));
}

#[tokio::test]
async fn auftrag_funktion_statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for (empf, erwartet) in [
        (
            serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s9"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            serde_json::json!({"empfaenger_typ": "funktion", "funktion": "fachberater"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s3", "funktion_text": "Müller"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s7"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (status, json) = auftrag_an(&app, &admin, einsatz, empf.clone()).await;
        assert_eq!(status, erwartet, "{empf} → {json:?}");
    }

    // S7 eingeschaltet → angenommen.
    anfrage(
        &app,
        "PUT",
        "/api/org-fuehrungsfunktionen/s7",
        &admin,
        Some(r#"{"aktiv":true}"#),
    )
    .await;
    let (status, json) = auftrag_an(
        &app,
        &admin,
        einsatz,
        serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s7"}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(
        json["empfaenger"][0]["snap_anzeige"],
        "S7 Psychosoziale Notfallversorgung"
    );
}

#[tokio::test]
async fn mandantenlabel_im_snapshot() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "PUT",
        "/api/org-fuehrungsfunktionen/s4",
        &admin,
        Some(r#"{"label":"Versorgung (Logistik)"}"#),
    )
    .await;
    let (_, json) = auftrag_an(
        &app,
        &admin,
        einsatz,
        serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s4"}),
    )
    .await;
    assert_eq!(
        json["empfaenger"][0]["snap_anzeige"],
        "S4 Versorgung (Logistik)"
    );
}

/// Ohne Freigabe des Stab-Moduls fehlt die Auflösung, der Snapshot bleibt.
#[tokio::test]
async fn ohne_stab_recht_keine_aufloesung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stab_extern(&app, &admin, einsatz, "s3", "Müller").await;
    auftrag_an(
        &app,
        &admin,
        einsatz,
        serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s3"}),
    )
    .await;

    let frieda = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    // Gegenprobe mit Recht: Auflösung da.
    let a = erster_auftrag(&app, &frieda, einsatz).await;
    assert_eq!(a["empfaenger"][0]["aktuelle_besetzung"]["name"], "Müller");

    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/stab"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let a = erster_auftrag(&app, &frieda, einsatz).await;
    let e = &a["empfaenger"][0];
    assert_eq!(e["snap_anzeige"], "S3 Einsatz");
    assert!(
        !e.as_object().unwrap().contains_key("aktuelle_besetzung"),
        "ohne Stab-Recht keine Besetzung: {e:?}"
    );
}

#[tokio::test]
async fn erinnerung_an_katalogwert_und_freitext() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stab_extern(&app, &admin, einsatz, "s2", "Müller").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &erinnerung_pfad(einsatz),
        &admin,
        Some(r#"{"titel":"Lage","faellig_at":"2030-01-01 10:00","empfaenger_funktion_code":"s2"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["empfaenger_funktion_code"], "s2");
    assert_eq!(json["empfaenger_anzeige"], "S2 Lage");
    assert_eq!(json["aktuelle_besetzung"]["name"], "Müller");

    let (status, json) = anfrage(
        &app,
        "POST",
        &erinnerung_pfad(einsatz),
        &admin,
        Some(r#"{"titel":"Frei","faellig_at":"2030-01-01 10:00","empfaenger_funktion":"S2"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(!json
        .as_object()
        .unwrap()
        .contains_key("empfaenger_funktion_code"));
    assert_eq!(json["empfaenger_anzeige"], "S2");
    assert!(!json.as_object().unwrap().contains_key("aktuelle_besetzung"));

    let (status, _) = anfrage(
        &app,
        "POST",
        &erinnerung_pfad(einsatz),
        &admin,
        Some(
            r#"{"titel":"x","faellig_at":"2030-01-01 10:00","empfaenger_funktion_code":"s3","empfaenger_funktion":"Müller"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Liste trägt die Anreicherung ebenso.
    let (_, liste) = anfrage(&app, "GET", &erinnerung_pfad(einsatz), &admin, None).await;
    let lage = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["titel"] == "Lage")
        .unwrap();
    assert_eq!(lage["aktuelle_besetzung"]["name"], "Müller");
}

#[tokio::test]
async fn fuehrungsstelle_als_katalogwert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frieda = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, frieda, "fuehrungspersonal").await;
    let mitglied_pfad = format!("/api/einsaetze/{einsatz}/mitglieder/{frieda}");

    let (status, json) = anfrage(
        &app,
        "PUT",
        &mitglied_pfad,
        &admin,
        Some(r#"{"einsatz_rolle":"fuehrungspersonal","fuehrungsfunktion":"fachberater","fuehrungsstelle":"THW"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let m = json
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["benutzer_id"] == frieda)
        .unwrap();
    assert_eq!(m["fuehrungsfunktion"], "fachberater");
    assert_eq!(m["fuehrungsstelle"], "THW");
    assert_eq!(m["fuehrungsstelle_anzeige"], "Fachberater: THW");

    // Die Vorbelegung am Einsatz der Person.
    let frieda_cookie = login_cookie(&app, "frieda", "friedapw1").await;
    let (_, e) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &frieda_cookie,
        None,
    )
    .await;
    assert_eq!(e["meine_fuehrungsstelle"], "Fachberater: THW");

    // Rollenwechsel ohne Feld behält die Stelle.
    rolle_setzen(&app, &admin, einsatz, frieda, "beobachter").await;
    let (_, e) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &frieda_cookie,
        None,
    )
    .await;
    assert_eq!(e["meine_fuehrungsstelle"], "Fachberater: THW");

    // S2 als Katalogwert → Vorbelegung ist das Kürzel, Liste zeigt das Label.
    let (_, json) = anfrage(
        &app,
        "PUT",
        &mitglied_pfad,
        &admin,
        Some(r#"{"einsatz_rolle":"fuehrungspersonal","fuehrungsfunktion":"s2","fuehrungsstelle":null}"#),
    )
    .await;
    let m = json
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["benutzer_id"] == frieda)
        .unwrap();
    assert_eq!(m["fuehrungsstelle_anzeige"], "S2 Lage");
    assert!(!m.as_object().unwrap().contains_key("fuehrungsstelle"));
    let (_, e) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &frieda_cookie,
        None,
    )
    .await;
    assert_eq!(e["meine_fuehrungsstelle"], "S2");

    // Leeren: beide null.
    let (_, json) = anfrage(
        &app,
        "PUT",
        &mitglied_pfad,
        &admin,
        Some(r#"{"einsatz_rolle":"fuehrungspersonal","fuehrungsfunktion":null,"fuehrungsstelle":null}"#),
    )
    .await;
    let m = json
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["benutzer_id"] == frieda)
        .unwrap();
    assert!(!m.as_object().unwrap().contains_key("fuehrungsfunktion"));
    assert!(!m
        .as_object()
        .unwrap()
        .contains_key("fuehrungsstelle_anzeige"));

    // Fachberater ohne Bezeichnung → 422.
    let (status, _) = anfrage(
        &app,
        "PUT",
        &mitglied_pfad,
        &admin,
        Some(r#"{"einsatz_rolle":"fuehrungspersonal","fuehrungsfunktion":"fachberater"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn mandantenlabel_in_kopf_und_system_etb() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "PUT",
        "/api/org-fuehrungsfunktionen/s4",
        &admin,
        Some(r#"{"label":"Versorgung (Logistik)"}"#),
    )
    .await;
    stab_extern(&app, &admin, einsatz, "s4", "Müller").await;
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|i| i.starts_with("S4 Versorgung (Logistik): Besetzung → Müller")),
        "{inhalte:?}"
    );
    let _ = pool;
}

/// Nach der Schwärzung liefert die Auflösung keinen Namen mehr; Snapshot und Code bleiben.
#[tokio::test]
async fn schwaerzung_nimmt_der_aufloesung_den_namen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    stab_extern(&app, &admin, einsatz, "s3", "Müller").await;
    auftrag_an(
        &app,
        &admin,
        einsatz,
        serde_json::json!({"empfaenger_typ": "funktion", "funktion": "s3"}),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &erinnerung_pfad(einsatz),
        &admin,
        Some(
            r#"{"titel":"x","faellig_at":"2030-01-01 10:00","empfaenger_funktion_code":"fachberater","empfaenger_funktion":"THW"}"#,
        ),
    )
    .await;

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    sqlx::query("UPDATE einsatz SET geloescht_at = '2020-01-01 00:00:00' WHERE id = ?")
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        lifeline_hub::einsatz::repo::schwaerze_einsatz(&pool, einsatz, "2030-01-01 00:00:00")
            .await
            .unwrap()
    );

    let aufl = {
        let mut conn = pool.acquire().await.unwrap();
        lifeline_hub::fuehrung::aufloesung::Aufloeser::laden(&mut conn, einsatz, true)
            .await
            .unwrap()
    };
    let bes = aufl
        .aufloesen(Some(lifeline_hub::fuehrung::Fuehrungsfunktion::S3))
        .unwrap();
    assert_eq!(bes.name, None, "Name nach der Schwärzung weg");

    let (snap, funktion): (String, Option<String>) = sqlx::query_as(
        "SELECT ae.snap_anzeige, ae.funktion FROM auftrag_empfaenger ae \
         JOIN auftrag a ON a.id = ae.auftrag_id WHERE a.einsatz_id = ?",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(snap, "S3 Einsatz");
    assert_eq!(funktion.as_deref(), Some("s3"));

    let (code, text): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT empfaenger_funktion_code, empfaenger_funktion FROM erinnerung \
         WHERE einsatz_id = ? AND titel IS NOT NULL AND quelle = 'manuell'",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(code.as_deref(), Some("fachberater"), "Code überlebt");
    assert_eq!(text, None, "Bezeichnung (Scrub) ist weg");
}
