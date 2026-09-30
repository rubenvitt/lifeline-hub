//! Das Live-Ereignis des Einsatzkopfs `einsatz` (LFH-555).
//!
//! Wer es feuert, wann es ausbleibt, was es trägt. Wer es empfängt (Modul-Filter des Feeds),
//! prüft `modul_override.rs`. Spec: `openspec/specs/einsatzkopf-live/`, Herleitung
//! `openspec/changes/archive/2026-09-30-lfh-555-einsatzkopf-live/design.md`.

use axum::http::StatusCode;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use tokio::sync::broadcast::Receiver;

mod common;
use common::*;

/// Leert den Empfänger und liefert alle bis hierher publizierten Nachrichten.
fn eingegangen(rx: &mut Receiver<LiveNachricht>) -> Vec<LiveNachricht> {
    let mut alle = Vec::new();
    while let Ok(n) = rx.try_recv() {
        alle.push(n);
    }
    alle
}

fn kopf_events(nachrichten: &[LiveNachricht]) -> Vec<&LiveNachricht> {
    nachrichten
        .iter()
        .filter(|n| n.event == LiveEvent::Einsatz)
        .collect()
}

fn anzahl(nachrichten: &[LiveNachricht], event: LiveEvent) -> usize {
    nachrichten.iter().filter(|n| n.event == event).count()
}

fn besprechungen_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/lagebesprechungen")
}

/// Schliesst eine Lagebesprechung mit dem gegebenen Rumpf ab (Vorbedingung: 201).
async fn besprechung(app: &axum::Router, cookie: &str, einsatz: i64, rumpf: &str) {
    let (status, json) = anfrage(
        app,
        "POST",
        &besprechungen_pfad(einsatz),
        cookie,
        Some(rumpf),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Vorbedingung: {json:?}");
}

// ---------- Kopfdaten, Abschluss, Frist ----------

#[tokio::test]
async fn patch_der_kopfdaten_feuert_einsatz_nur_mit_der_kennung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(r#"{"naechste_lagebesprechung_at":"2026-09-30 18:00:00","sachverhalt":"Geheim"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let alle = eingegangen(&mut rx);
    let kopf = kopf_events(&alle);
    assert_eq!(kopf.len(), 1, "genau ein `einsatz`-Ereignis: {alle:?}");
    assert_eq!(
        kopf[0].data,
        format!(r#"{{"einsatz_id":{einsatz}}}"#),
        "die Nutzlast trägt nur die Kennung, keine Kopfdaten"
    );
}

#[tokio::test]
async fn abgelehnter_patch_feuert_nichts() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(r#"{"bezeichnung":"   "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(kopf_events(&eingegangen(&mut rx)).is_empty());
}

#[tokio::test]
async fn abschluss_des_einsatzes_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(kopf_events(&eingegangen(&mut rx)).len(), 1);
}

#[tokio::test]
async fn frist_setzen_feuert_einsatz_unveraendert_nicht() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pfad = format!("/api/einsaetze/{einsatz}/aufbewahrungsfrist");
    let rumpf = r#"{"retention_bis":"2099-01-01 00:00:00","bestaetigt":true}"#;

    let mut rx = live.abonniere(einsatz);
    let (status, json) = anfrage(&app, "PUT", &pfad, &admin, Some(rumpf)).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(kopf_events(&eingegangen(&mut rx)).len(), 1);

    // Dieselbe Frist noch einmal: 200 ohne UPDATE, also auch ohne Ereignis.
    let (status, _) = anfrage(&app, "PUT", &pfad, &admin, Some(rumpf)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(kopf_events(&eingegangen(&mut rx)).is_empty());
}

// ---------- Lagebesprechung (design.md D3) ----------

#[tokio::test]
async fn lagebesprechung_mit_neuem_termin_feuert_einsatz_neben_stab_und_etb() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#,
    )
    .await;

    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1);
    assert_eq!(anzahl(&alle, LiveEvent::Etb), 1);
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 1, "{alle:?}");
}

#[tokio::test]
async fn lagebesprechung_ohne_terminaenderung_feuert_kein_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#,
    )
    .await;

    // (a) Derselbe Termin noch einmal, in anderer Schreibweise desselben Zeitpunkts.
    let mut rx = live.abonniere(einsatz);
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"B","abgehalten_at":"2026-09-12 11:00:00","naechste_at":"2026-09-12T12:00:00Z"}"#,
    )
    .await;
    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1, "Vorbedingung: {alle:?}");
    assert_eq!(
        anzahl(&alle, LiveEvent::Einsatz),
        0,
        "derselbe Termin verrät Kopf-Lesern ohne Stab-Recht keine Besprechung: {alle:?}"
    );

    // (b) Ohne den Schlüssel `naechste_at`: der Termin bleibt, kein Kopf-Ereignis.
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"C","abgehalten_at":"2026-09-12 11:30:00"}"#,
    )
    .await;
    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1, "Vorbedingung: {alle:?}");
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 0, "{alle:?}");

    // Der Termin steht unverändert am Einsatz.
    let (_, kopf) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(kopf["naechste_lagebesprechung_at"], "2026-09-12 12:00:00");
}

#[tokio::test]
async fn lagebesprechung_die_den_termin_aufhebt_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#,
    )
    .await;

    let mut rx = live.abonniere(einsatz);
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"B","abgehalten_at":"2026-09-12 11:00:00","naechste_at":null}"#,
    )
    .await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 1);

    // Schon leer und wieder `null`: keine Änderung, kein Ereignis.
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"C","abgehalten_at":"2026-09-12 11:30:00","naechste_at":null}"#,
    )
    .await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 0);
}

// ---------- Bewusst nicht live (design.md D5) ----------

#[tokio::test]
async fn besetzung_eines_sachgebiets_feuert_kein_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/stab/besetzung/s2"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert!(status.is_success(), "Vorbedingung: {status} {json:?}");

    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1, "Vorbedingung: {alle:?}");
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 0, "{alle:?}");
}
