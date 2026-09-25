//! Befehle — Backend-Integrationstests.
//!
//! Angelegt mit LFH-305: der PATCH-Handler prüft die Abschnitts-Schlüssel gegen die feste
//! Schlüsselmenge der Vorlage — enum-artig, also 400 nach der Statuscode-Konvention. Diese
//! Stelle war bis dahin vollständig ungetestet, es gab gar keine `tests/befehl*.rs`.
//! Harness 1:1 aus tests/lagebericht.rs, dessen Handler baugleich ist.

use axum::http::StatusCode;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

/// Legt einen Befehls-Entwurf aus der Vorlage `befehl_lad` an (Abschnitte: lage, auftrag,
/// durchfuehrung) und liefert dessen id.
async fn befehl_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (status, b) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/befehle"),
        cookie,
        Some(r#"{"vorlage":"befehl_lad","titel":"Erstbefehl"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{b:?}");
    b["id"].as_i64().unwrap()
}

/// Der Schlüssel wird gegen die Schlüsselmenge der Vorlage geprüft und scheitert für sich
/// genommen → 400. Der Positiv-Zweig mit einem gültigen Schlüssel belegt, dass der 400
/// wirklich aus dieser Prüfung kommt und nicht aus einem vorgelagerten Gate (Schreibrecht,
/// Modul-Zugriff, Entwurfs-Status).
#[tokio::test]
async fn patch_unbekannter_abschnitts_schluessel_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let bid = befehl_anlegen(&app, &admin, einsatz).await;
    let u = format!("/api/einsaetze/{einsatz}/befehle/{bid}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"quatsch","text":"x"}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"lage","text":"Hochwasser steigt."}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Positiv-Zweig: {antwort:?}");
}

/// Charakterisierung der Freigabe (LFH-690): Antwort, ETB-Snapshot und die beiden
/// 422-Wortlaute sind byte-genau gepinnt. Der Handler rendert seit LFH-690 über
/// `befehl::repo::freigeben_tx` auf der Verbindung; der Snapshot muss dabei derselbe bleiben.
#[tokio::test]
async fn freigabe_schreibt_gerenderten_snapshot_byte_genau_ins_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, b) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/befehle"),
        &admin,
        Some(
            r#"{"vorlage":"befehl_lad","titel":"Befehl 10:00","zeitstand":"2026-06-02 10:00:00"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{b:?}");
    let bid = b["id"].as_i64().unwrap();
    let u = format!("/api/einsaetze/{einsatz}/befehle/{bid}");

    // Leerer Befehl: Struktur vollständig (Skelett), aber ohne Text → 422 mit Wortlaut.
    let (s, antwort) = anfrage(&app, "POST", &format!("{u}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{antwort:?}");
    assert_eq!(
        antwort["error"],
        "Der Befehl ist leer und kann nicht freigegeben werden"
    );

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(
            r#"{"abschnitte":[{"schluessel":"lage","text":"Hochwasser steigt."},{"schluessel":"auftrag","text":"  Deich sichern. "},{"schluessel":"durchfuehrung","text":""}]}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, frei) = anfrage(&app, "POST", &format!("{u}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{frei:?}");
    assert_eq!(frei["status"], "freigegeben");
    assert_eq!(frei["id"], bid);
    assert_eq!(frei["zeitstand"], "2026-06-02 10:00:00");
    assert!(frei["freigegeben_von_id"].is_i64());
    assert!(frei["freigegeben_at"].is_string());
    let etb_id = frei["etb_eintrag_id"].as_i64().expect("etb_eintrag_id");

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let anordnungen: Vec<&serde_json::Value> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "anordnung")
        .collect();
    assert_eq!(anordnungen.len(), 1);
    let e = anordnungen[0];
    assert_eq!(e["id"], etb_id);
    assert_eq!(e["befehl_id"], bid);
    assert_eq!(e["ereigniszeit"], "2026-06-02 10:00:00");
    assert_eq!(
        e["inhalt"],
        "# Befehl 10:00\n\n_Zeitstand: 2026-06-02 10:00:00_\n\n## Lage\nHochwasser steigt.\n\n## Auftrag\nDeich sichern.\n\n## Durchführung\n_(keine Angabe)_\n"
    );

    // Zweite Freigabe: 422 mit dem Wortlaut der Status-Prüfung, kein zweiter Snapshot.
    let (s, antwort) = anfrage(&app, "POST", &format!("{u}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{antwort:?}");
    assert_eq!(antwort["error"], "Befehl ist bereits freigegeben");
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let n = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "anordnung")
        .count();
    assert_eq!(n, 1);
}
