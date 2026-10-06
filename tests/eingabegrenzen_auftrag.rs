//! LFH-937: Grenzen eines Auftrags (Spec `eingabegrenzen`, design.md D3/D4) — Empfängerzahl auf
//! allen vier Wegen, Entdoppeln, Textgrenzen und das gekappte ETB-An der Anordnung.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, einheit_bilden, einsatz_anlegen, login_cookie, setup, setup_mit_pool};

fn x(n: usize) -> String {
    "x".repeat(n)
}

fn funktion(text: &str) -> Value {
    json!({ "empfaenger_typ": "funktion", "funktion_text": text })
}

fn auftrag(text: &str, empfaenger: Vec<Value>) -> String {
    json!({ "auftrag_text": text, "empfaenger": empfaenger }).to_string()
}

/// `n` verschiedene Funktionsempfänger.
fn funktionen(n: usize) -> Vec<Value> {
    (0..n).map(|i| funktion(&format!("EA {i}"))).collect()
}

async fn auftraege_anzahl(app: &axum::Router, cookie: &str, e: i64) -> usize {
    let (s, j) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    j.as_array().unwrap().len()
}

async fn etb_eintrag_anlegen(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let body = json!({ "typ": "meldung", "inhalt": "Deich", "von": "A", "an": "B" });
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    j["id"].as_i64().unwrap()
}

async fn meldung_anlegen(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let body = json!({
        "absender": "A", "empfaenger": "B", "meldeweg": "funk", "inhalt": "Deich",
        "ereigniszeit": "2026-06-12 09:00:00"
    });
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    j["id"].as_i64().unwrap()
}

async fn chat_nachricht_anlegen(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let (_, k) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/chat/kanaele"),
        cookie,
        None,
    )
    .await;
    let kid = k[0]["id"].as_i64().unwrap();
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/chat/kanaele/{kid}/nachrichten"),
        cookie,
        Some(r#"{"inhalt":"Tank anfordern"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    j["id"].as_i64().unwrap()
}

/// Alle vier Wege, auf denen ein Auftrag entsteht.
async fn wege(app: &axum::Router, cookie: &str, e: i64) -> Vec<String> {
    let eid = etb_eintrag_anlegen(app, cookie, e).await;
    let mid = meldung_anlegen(app, cookie, e).await;
    let cid = chat_nachricht_anlegen(app, cookie, e).await;
    vec![
        format!("/api/einsaetze/{e}/auftraege"),
        format!("/api/einsaetze/{e}/etb/{eid}/auftrag"),
        format!("/api/einsaetze/{e}/meldungen/{mid}/auftrag"),
        format!("/api/einsaetze/{e}/chat/nachrichten/{cid}/heraufstufen-auftrag"),
    ]
}

#[tokio::test]
async fn einundfuenfzig_empfaenger_sind_auf_jedem_weg_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for uri in wege(&app, &admin, e).await {
        let (s, j) = anfrage(
            &app,
            "POST",
            &uri,
            &admin,
            Some(&auftrag("T", funktionen(51))),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{uri}: {j:?}");
        assert_eq!(j["error"], "Höchstens 50 Empfänger je Auftrag");
    }
    assert_eq!(auftraege_anzahl(&app, &admin, e).await, 0);

    for uri in wege(&app, &admin, e).await {
        let (s, j) = anfrage(
            &app,
            "POST",
            &uri,
            &admin,
            Some(&auftrag("T", funktionen(50))),
        )
        .await;
        assert!(s.is_success(), "{uri}: {s} {j:?}");
    }
    assert_eq!(auftraege_anzahl(&app, &admin, e).await, 4);
}

#[tokio::test]
async fn gleiche_empfaenger_werden_zu_einer_zeile() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, e, "Zug 1").await;
    let gleich = json!({ "empfaenger_typ": "einheit", "einheit_id": einheit });
    let body = auftrag(
        "Deich sichern",
        vec![
            gleich.clone(),
            funktion(" S3 "),
            gleich.clone(),
            funktion("S3"),
            gleich,
        ],
    );
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let zeilen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM auftrag_empfaenger WHERE auftrag_id = ?")
            .bind(j["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(zeilen, 2);
    let typen: Vec<&str> = j["empfaenger"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["empfaenger_typ"].as_str().unwrap())
        .collect();
    assert_eq!(
        typen,
        ["einheit", "funktion"],
        "erste Nennung und Reihenfolge bleiben"
    );
}

#[tokio::test]
async fn texte_des_auftrags_sind_begrenzt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let uri = format!("/api/einsaetze/{e}/auftraege");
    let extern_ = |b: &str| json!({ "empfaenger_typ": "extern", "extern_kategorie": "leitstelle", "extern_bezeichnung": b });
    let mit_feld = |feld: &str, wert: String| {
        let mut b = json!({ "auftrag_text": "T", "empfaenger": [funktion("S3")] });
        b[feld] = json!(wert);
        b.to_string()
    };

    let gut = [
        auftrag(&x(10_000), vec![funktion("S3")]),
        auftrag("T", vec![extern_(&x(200))]),
        mit_feld("absicht", x(2_000)),
        mit_feld("sicherheit", x(2_000)),
    ];
    for body in gut {
        let (s, j) = anfrage(&app, "POST", &uri, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
    }
    let vorher = auftraege_anzahl(&app, &admin, e).await;

    let schlecht = [
        (auftrag(&x(10_001), vec![funktion("S3")]), "Auftragstext"),
        (auftrag("T", vec![extern_(&x(201))]), "Externe Bezeichnung"),
        (mit_feld("absicht", x(2_001)), "Absicht"),
        (mit_feld("lage", x(2_001)), "Lage"),
        (mit_feld("ort", x(2_001)), "Ort"),
        (mit_feld("zeit", x(2_001)), "Zeit"),
        (mit_feld("mittel", x(2_001)), "Mittel"),
        (mit_feld("verbindung", x(2_001)), "Verbindung"),
        (mit_feld("sicherheit", x(2_001)), "Sicherheit"),
    ];
    for (body, feld) in schlecht {
        let (s, j) = anfrage(&app, "POST", &uri, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}");
        assert!(
            j["error"].as_str().unwrap().starts_with(feld),
            "{feld}: {j:?}"
        );
    }
    assert_eq!(auftraege_anzahl(&app, &admin, e).await, vorher);
}

#[tokio::test]
async fn etb_an_der_anordnung_ist_gekappt_und_die_empfaenger_vollstaendig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let empfaenger: Vec<Value> = (0..50).map(|i| funktion(&format!("{i:0>200}"))).collect();
    let (s, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        Some(&auftrag("Deich sichern", empfaenger)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{a:?}");
    assert_eq!(a["empfaenger"].as_array().unwrap().len(), 50);

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    let anordnung = etb
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["typ"] == "anordnung")
        .expect("ETB-Anordnung");
    let an = anordnung["an"].as_str().unwrap();
    assert!(an.chars().count() <= 500, "{}", an.chars().count());
    assert!(an.ends_with(" … und 48 weitere"), "{an}");
}
