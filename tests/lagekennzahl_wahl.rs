//! Gewählte Lagekennzahlen am Einsatz (LLH-1371): „Nachforderungen offen“ auf Lageplatz B.
//!
//! Spec `openspec/specs/lage-dashboard-kennzahlreihe/spec.md`, Requirement „Wahl von
//! ‚Nachforderungen offen‘“. Herleitung `/mnt/project-files/llh-1021/llh-1371/design.md` D1–D5.
//!
//! Die Wahl ist eine bewusste Entscheidung mit eigenem Datensatz (`einsatz_lagekennzahl_wahl`),
//! nie die Zahl der offenen Nachforderungen. Sie steht in `lagekennzahlen` von Detail UND Liste.

use axum::http::StatusCode;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/lagekennzahl-wahl")
}

async fn waehle(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> (StatusCode, Value) {
    anfrage(app, "PUT", &pfad(einsatz), cookie, Some(body)).await
}

/// `lagekennzahlen` aus Detail- und Listenantwort, Vorhandensein per `contains_key`.
async fn lagekennzahlen(app: &axum::Router, cookie: &str, einsatz: i64) -> (Value, Value) {
    let (status, detail) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{detail:?}");
    assert!(detail.as_object().unwrap().contains_key("lagekennzahlen"));
    let (status, liste) = anfrage(app, "GET", "/api/einsaetze", cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{liste:?}");
    let zeile = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(einsatz))
        .expect("Einsatz in der Liste")
        .clone();
    assert!(zeile.as_object().unwrap().contains_key("lagekennzahlen"));
    (
        detail["lagekennzahlen"].clone(),
        zeile["lagekennzahlen"].clone(),
    )
}

fn eingegangen(rx: &mut Receiver<LiveNachricht>) -> Vec<LiveNachricht> {
    let mut alle = Vec::new();
    while let Ok(n) = rx.try_recv() {
        alle.push(n);
    }
    alle
}

fn kopf_anzahl(nachrichten: &[LiveNachricht]) -> usize {
    nachrichten
        .iter()
        .filter(|n| n.event == LiveEvent::Einsatz)
        .count()
}

#[tokio::test]
async fn waehlen_und_abwaehlen_schaltet_die_lagekennzahl_in_detail_und_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let leer = json!([]);
    let gewaehlt = json!(["nachforderungen"]);

    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (leer.clone(), leer.clone()),
        "ohne Wahl kein Auslöser"
    );

    let (status, antwort) =
        waehle(&app, &admin, einsatz, r#"{"gewaehlt":["nachforderungen"]}"#).await;
    assert_eq!(status, StatusCode::OK, "{antwort:?}");
    assert_eq!(antwort, json!({ "gewaehlt": ["nachforderungen"] }));
    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (gewaehlt.clone(), gewaehlt.clone())
    );

    // Ein anderer Einsatz bleibt unberührt.
    let anderer = einsatz_anlegen(&app, &admin).await;
    assert_eq!(
        lagekennzahlen(&app, &admin, anderer).await,
        (leer.clone(), leer.clone())
    );

    let (status, antwort) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":[]}"#).await;
    assert_eq!(status, StatusCode::OK, "{antwort:?}");
    assert_eq!(antwort, json!({ "gewaehlt": [] }));
    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (leer.clone(), leer)
    );
}

#[tokio::test]
async fn doppelte_wahl_ist_idempotent() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for _ in 0..2 {
        let (status, antwort) = waehle(
            &app,
            &admin,
            einsatz,
            r#"{"gewaehlt":["nachforderungen","nachforderungen"]}"#,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{antwort:?}");
        assert_eq!(antwort, json!({ "gewaehlt": ["nachforderungen"] }));
    }
}

/// Die Wahl ist ein Auslöser NEBEN Pegel und Evakuierung; die Ausgabe folgt der
/// Deklarationsreihenfolge, nicht der Reihenfolge der Entscheidungen.
#[tokio::test]
async fn wahl_steht_neben_der_evakuierung_in_fester_reihenfolge() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":["nachforderungen"]}"#).await;
    assert_eq!(status, StatusCode::OK);
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/evakuierung/bezirke"),
        &admin,
        Some(r#"{"bezeichnung":"Nord","plan_personen":100,"plan_erhebung":"geschaetzt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Vorbedingung: {json:?}");
    let erwartet = json!(["evakuiert", "nachforderungen"]);
    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (erwartet.clone(), erwartet)
    );
}

#[tokio::test]
async fn nicht_waehlbare_oder_unbekannte_kennzahl_ist_400_und_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zu_viele = format!(
        r#"{{"gewaehlt":[{}]}}"#,
        vec![r#""nachforderungen""#; 9].join(",")
    );
    for body in [
        r#"{"gewaehlt":["pegel"]}"#,
        r#"{"gewaehlt":["evakuiert"]}"#,
        r#"{"gewaehlt":["quatsch"]}"#,
        r#"{"gewaehlt":["nachforderungen","pegel"]}"#,
        r#"{"gewaehlt":"nachforderungen"}"#,
        r#"{}"#,
        zu_viele.as_str(),
    ] {
        let (status, json) = waehle(&app, &admin, einsatz, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {json:?}");
    }
    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (json!([]), json!([]))
    );
}

#[tokio::test]
async fn beobachter_liest_die_wahl_aber_waehlt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (status, _) = waehle(
        &app,
        &beob_cookie,
        einsatz,
        r#"{"gewaehlt":["nachforderungen"]}"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (json!([]), json!([]))
    );

    // Lesen darf er: die Wahl der Einsatzleitung steht auch in seinem Kopf.
    let (status, _) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":["nachforderungen"]}"#).await;
    assert_eq!(status, StatusCode::OK);
    let (status, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["lagekennzahlen"], json!(["nachforderungen"]));
}

#[tokio::test]
async fn fremde_org_wird_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) = waehle(&app, &fremd, einsatz, r#"{"gewaehlt":["nachforderungen"]}"#).await;
    assert!(
        status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
        "erwartet 403/404, war {status}"
    );
    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (json!([]), json!([]))
    );
}

#[tokio::test]
async fn abgeschlossener_einsatz_nimmt_keine_wahl_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Vorbedingung: {json:?}");
    let (status, _) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":["nachforderungen"]}"#).await;
    assert!(
        status.is_client_error(),
        "abgeschlossen: kein Schreiben, war {status}"
    );
    assert_eq!(
        lagekennzahlen(&app, &admin, einsatz).await,
        (json!([]), json!([]))
    );
}

/// LFH-855: `einsatz` fällt nur, wenn sich die Menge der aktiven Lagekennzahlen ändert.
#[tokio::test]
async fn umschalten_meldet_den_kopf_gleichbleibender_stand_nicht() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, _) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":[]}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(kopf_anzahl(&eingegangen(&mut rx)), 0, "leer bleibt leer");

    let (status, _) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":["nachforderungen"]}"#).await;
    assert_eq!(status, StatusCode::OK);
    let alle = eingegangen(&mut rx);
    assert_eq!(kopf_anzahl(&alle), 1, "{alle:?}");
    let kopf = alle.iter().find(|n| n.event == LiveEvent::Einsatz).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&kopf.data).unwrap(),
        json!({ "einsatz_id": einsatz })
    );

    let (status, _) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":["nachforderungen"]}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        kopf_anzahl(&eingegangen(&mut rx)),
        0,
        "dieselbe Wahl noch einmal"
    );

    let (status, _) = waehle(&app, &admin, einsatz, r#"{"gewaehlt":[]}"#).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        kopf_anzahl(&eingegangen(&mut rx)),
        1,
        "abwählen schaltet zurück"
    );
}
