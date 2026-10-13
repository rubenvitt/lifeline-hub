//! Zählung der Anrufe am Informationstelefon (LLH-732, Spec `stab-infotelefon`).
//!
//! Die tragende Zusicherung ist die **Parität mit der Liste**, wie bei `tests/etb_zaehler.rs`:
//! Die Tests laden die Liste über den Cursor vollständig und vergleichen sie mit der Zählung.
//! Ein Vergleich gegen eine handgerechnete Zahl bliebe grün, wenn Liste und Zählung gemeinsam
//! falsch lägen, aber nicht, wenn sie auseinanderlaufen.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup, setup_mit_pool};

fn pfad(e: i64) -> String {
    format!("/api/einsaetze/{e}/stab/infotelefon")
}

async fn erfassen(app: &axum::Router, cookie: &str, e: i64, body: &str) {
    let (s, v) = anfrage(app, "POST", &pfad(e), cookie, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "erfassen: {v:?}");
}

async fn zaehler(app: &axum::Router, cookie: &str, e: i64, query: &str) -> Value {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("{}/zaehler{query}", pfad(e)),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "zaehler{query}: {v:?}");
    v
}

/// Lädt die Liste mit `filter` (ohne führendes `&`) seitenweise vollständig.
async fn alle_seiten(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    filter: &str,
    limit: i64,
) -> Vec<Value> {
    let mut alle = Vec::new();
    let mut cursor = String::new();
    loop {
        let uri = format!("{}?limit={limit}{filter}{cursor}", pfad(e));
        let (s, v) = anfrage(app, "GET", &uri, cookie, None).await;
        assert_eq!(s, StatusCode::OK, "{uri}: {v:?}");
        let seite = v.as_array().unwrap().clone();
        let ende = (seite.len() as i64) < limit;
        if let Some(letzter) = seite.last() {
            cursor = format!(
                "&vor_zeit={}&vor_id={}",
                letzter["eingang_at"].as_str().unwrap().replace(' ', "%20"),
                letzter["id"]
            );
        }
        alle.extend(seite);
        if ende {
            return alle;
        }
    }
}

/// Zwei Anliegen mit gleichem Eingang, offene und erledigte gemischt, ein Nachtrag.
async fn bestand(app: &axum::Router, cookie: &str, e: i64) {
    for body in [
        r#"{"anliegen":"auskunft_lage","eingang_at":"2026-10-01T10:00:00Z"}"#,
        r#"{"anliegen":"auskunft_lage","eingang_at":"2026-10-01T10:00:00Z"}"#,
        r#"{"anliegen":"auskunft_lage","eingang_at":"2026-10-01T10:00:00Z","rueckruf":"1","rueckruf_noetig":true}"#,
        r#"{"anliegen":"hinweis","eingang_at":"2026-10-01T11:00:00Z"}"#,
        r#"{"anliegen":"vermisstensuche","eingang_at":"2026-10-01T11:00:00Z","rueckruf":"2","rueckruf_noetig":true}"#,
        r#"{"anliegen":"presse","eingang_at":"2026-10-01T09:00:00Z"}"#,
        r#"{"anliegen":"sonstiges"}"#,
    ] {
        erfassen(app, cookie, e, body).await;
    }
}

#[tokio::test]
async fn ungefilterte_zaehlung_mit_allen_anliegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    bestand(&app, &admin, e).await;

    let z = zaehler(&app, &admin, e, "").await;
    assert_eq!(z["gesamt"], 7);
    assert_eq!(z["offen"], 2);
    let je = z["je_anliegen"].as_object().unwrap();
    assert_eq!(je.len(), 7, "jedes Anliegen steht da: {je:?}");
    assert_eq!(je["auskunft_lage"], 3);
    assert_eq!(je["hilfeangebot"], 0);
    assert_eq!(je["beschwerde"], 0);
    let summe: i64 = je.values().map(|v| v.as_i64().unwrap()).sum();
    assert_eq!(summe, 7);
}

#[tokio::test]
async fn liste_und_zaehlung_stimmen_je_filter_ueberein() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    bestand(&app, &admin, e).await;

    for status in ["", "offen", "erledigt"] {
        let (filter, query) = if status.is_empty() {
            (String::new(), String::new())
        } else {
            (format!("&status={status}"), format!("?status={status}"))
        };
        let z = zaehler(&app, &admin, e, &query).await;
        for limit in [1, 2, 3, 100] {
            let liste = alle_seiten(&app, &admin, e, &filter, limit).await;
            assert_eq!(
                z["gesamt"].as_i64().unwrap(),
                liste.len() as i64,
                "status={status} limit={limit}"
            );
            let mut ids: Vec<i64> = liste.iter().map(|a| a["id"].as_i64().unwrap()).collect();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), liste.len(), "kein Anruf doppelt");
            let offen = liste.iter().filter(|a| a["status"] == "offen").count();
            assert_eq!(z["offen"].as_i64().unwrap(), offen as i64);
            for (anliegen, n) in z["je_anliegen"].as_object().unwrap() {
                let in_liste = liste.iter().filter(|a| a["anliegen"] == *anliegen).count();
                assert_eq!(n.as_i64().unwrap(), in_liste as i64, "{anliegen}");
            }
        }
    }
}

#[tokio::test]
async fn nur_offene_zaehlen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    bestand(&app, &admin, e).await;
    let z = zaehler(&app, &admin, e, "?status=offen").await;
    assert_eq!(z["gesamt"], 2);
    assert_eq!(z["offen"], 2);
    assert_eq!(z["je_anliegen"]["auskunft_lage"], 1);
    assert_eq!(z["je_anliegen"]["vermisstensuche"], 1);
}

#[tokio::test]
async fn seitenparameter_gehoeren_nicht_zum_filter() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    bestand(&app, &admin, e).await;
    let ohne = zaehler(&app, &admin, e, "").await;
    let mit = zaehler(
        &app,
        &admin,
        e,
        "?limit=1&vor_zeit=2026-10-01%2010:00:00&vor_id=1",
    )
    .await;
    assert_eq!(ohne, mit);
    // Ein halber Cursor ist nur an der Liste ein Fehler.
    let halb = zaehler(&app, &admin, e, "?vor_id=1").await;
    assert_eq!(ohne, halb);
}

#[tokio::test]
async fn unbekannter_status_ist_400_an_liste_und_zaehlung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for uri in [
        format!("{}?status=unsinn", pfad(e)),
        format!("{}/zaehler?status=unsinn", pfad(e)),
    ] {
        let (s, _) = anfrage(&app, "GET", &uri, &admin, None).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{uri}");
    }
}

#[tokio::test]
async fn andere_einsaetze_zaehlen_nicht_mit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    bestand(&app, &admin, anderer).await;
    erfassen(&app, &admin, e, r#"{"anliegen":"hinweis"}"#).await;
    let z = zaehler(&app, &admin, e, "").await;
    assert_eq!(z["gesamt"], 1);
    assert_eq!(z["offen"], 0);
}

/// Akzeptanzkriterium LLH-732: mit 2 000 Anrufen lädt die Liste ein Fenster, und die Zählung
/// nennt den ganzen Bestand.
#[tokio::test]
async fn zweitausend_anrufe_ein_fenster_und_die_volle_zahl() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let benutzer: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    // Direkt in die Tabelle: 2 000 POSTs kosteten den Test Sekunden ohne Mehrwert. Jeder
    // zehnte Anruf ist ein offener Rückruf, die Anliegen reihum.
    sqlx::query(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000) \
         INSERT INTO infotelefon_anruf \
            (einsatz_id, anliegen, rueckruf, status, eingang_at, angelegt_von_id) \
         SELECT ?, \
                CASE i % 7 WHEN 0 THEN 'vermisstensuche' WHEN 1 THEN 'auskunft_lage' \
                     WHEN 2 THEN 'hinweis' WHEN 3 THEN 'hilfeangebot' WHEN 4 THEN 'beschwerde' \
                     WHEN 5 THEN 'presse' ELSE 'sonstiges' END, \
                CASE WHEN i % 10 = 0 THEN '0171' END, \
                CASE WHEN i % 10 = 0 THEN 'offen' ELSE 'erledigt' END, \
                datetime('2026-10-01 00:00:00', '+' || i || ' minutes'), ? \
         FROM n",
    )
    .bind(e)
    .bind(benutzer)
    .execute(&pool)
    .await
    .unwrap();

    let (s, erste) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let erste = erste.as_array().unwrap();
    assert_eq!(erste.len(), 100, "ein Fenster, nicht die Vollliste");
    assert_eq!(
        erste[0]["eingang_at"], "2026-10-02 09:20:00",
        "jüngster zuerst"
    );

    let z = zaehler(&app, &admin, e, "").await;
    assert_eq!(z["gesamt"], 2000);
    assert_eq!(z["offen"], 200);
    let summe: i64 = z["je_anliegen"]
        .as_object()
        .unwrap()
        .values()
        .map(|v| v.as_i64().unwrap())
        .sum();
    assert_eq!(summe, 2000);
    assert_eq!(alle_seiten(&app, &admin, e, "", 500).await.len(), 2000);
}
