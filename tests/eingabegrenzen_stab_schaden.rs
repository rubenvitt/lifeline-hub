//! LFH-937: Freitexte von Infotelefon und Schaden (Spec `eingabegrenzen`, design.md D6). Je
//! Feld: `max` geht durch, `max+1` ist 400 mit dem Feldnamen; die bestehende 422 (Rückruf ohne
//! Nummer) bleibt. Das Presse-Log ist mit dem Modul Stab entfallen (i6k6mzed).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage_json, einsatz_anlegen, login_cookie, setup};

fn x(n: usize) -> String {
    "x".repeat(n)
}

async fn post(app: &axum::Router, c: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "POST", uri, c, Some(&body)).await
}

async fn patch(app: &axum::Router, c: &str, uri: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "PATCH", uri, c, Some(&body)).await
}

fn fehler_beginnt_mit(j: &Value, feld: &str) -> bool {
    j["error"].as_str().unwrap_or_default().starts_with(feld)
}

#[tokio::test]
async fn infotelefon_notiz_name_rueckruf() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let uri = format!("/api/einsaetze/{e}/stab/infotelefon");
    let anruf = |notiz: String, name: String, rueckruf: String| {
        json!({ "anliegen": "hinweis", "notiz": notiz, "anrufer_name": name,
                "rueckruf": rueckruf, "rueckruf_noetig": true })
    };

    let (s, j) = post(&app, &admin, &uri, anruf(x(2_000), x(200), x(200))).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    for (body, feld) in [
        (anruf(x(2_001), "N".into(), "1".into()), "Notiz"),
        (anruf("n".into(), x(201), "1".into()), "Anrufername"),
        (anruf("n".into(), "N".into(), x(201)), "Rückruf"),
    ] {
        let (s, j) = post(&app, &admin, &uri, body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}");
        assert!(fehler_beginnt_mit(&j, feld), "{feld}: {j:?}");
    }
    // Rückruf nötig ohne Nummer bleibt der Zusammenhang.
    let (s, _) = post(
        &app,
        &admin,
        &uri,
        json!({ "anliegen": "hinweis", "rueckruf_noetig": true }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn schaden_ort_beschreibung_kontakt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let uri = format!("/api/einsaetze/{e}/schaeden");
    let schaden = |ort: String, beschreibung: String| json!({ "typ": "sachschaden", "ausmass": "gering", "ort": ort, "beschreibung": beschreibung });

    let (s, j) = post(&app, &admin, &uri, schaden(x(500), x(8_000))).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let sid = j["id"].as_i64().unwrap();
    let mut mit_kontakt = schaden("Ort".into(), "B".into());
    mit_kontakt["geschaedigt_kontakt"] = json!(x(500));
    let (s, j) = post(&app, &admin, &uri, mit_kontakt.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");

    mit_kontakt["geschaedigt_kontakt"] = json!(x(501));
    for (body, feld) in [
        (schaden(x(501), "B".into()), "Ort"),
        (schaden("Ort".into(), x(8_001)), "Beschreibung"),
        (mit_kontakt, "Geschädigt-Kontakt"),
    ] {
        let (s, j) = post(&app, &admin, &uri, body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}");
        assert!(fehler_beginnt_mit(&j, feld), "{feld}: {j:?}");
    }

    let sid_uri = format!("{uri}/{sid}");
    for (body, feld) in [
        (json!({ "ort": x(501) }), "Ort"),
        (json!({ "beschreibung": x(8_001) }), "Beschreibung"),
        (
            json!({ "geschaedigt_kontakt": x(501) }),
            "Geschädigt-Kontakt",
        ),
        // Feldfehler vor dem Koordinaten-Zusammenhang (halbes lat/lon-Paar wäre 422).
        (
            json!({ "lat": 52.0, "beschreibung": x(8_001) }),
            "Beschreibung",
        ),
    ] {
        let (s, j) = patch(&app, &admin, &sid_uri, body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}");
        assert!(fehler_beginnt_mit(&j, feld), "{feld}: {j:?}");
    }
    let (s, _) = patch(&app, &admin, &sid_uri, json!({ "lat": 52.0 })).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Gegenprobe: halbes Paar"
    );
    let (s, j) = anfrage_json(&app, "GET", &sid_uri, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(j["ort"], x(500), "unverändert");
}
