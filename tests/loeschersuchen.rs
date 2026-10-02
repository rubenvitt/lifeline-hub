//! Löschersuchen nach Art. 17 über die Archiv-Routen (LFH-751, Spec
//! `aufbewahrung-loeschersuchen` und `aufbewahrung-archiv`): Zugriff, Statuscodes, Rücknahme,
//! pseudonyme Suche und der Zustand `schwaerzung_beantragt`.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, person_anlegen,
    rolle_setzen,
};

struct Lage {
    app: axum::Router,
    pool: SqlitePool,
    admin: String,
    leit: String,
    einsatz: i64,
    nummer: String,
    person: i64,
}

/// Abgeschlossener Einsatz mit Einsatzleitung und der Betroffenen „Erika Mustermann“.
async fn lage() -> Lage {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let leit_id = benutzer_anlegen(&app, &admin, "leitung", "keine").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, einsatz, leit_id, "einsatzleitung").await;
    let person = person_anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Mustermann","vorname":"Erika","melder_kontakt":"0171 2345678"}"#,
    )
    .await;
    // Freitext, der die Person nur erwähnt — bleibt nach dem Personen-Vollzug stehen.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        Some(&json!({"typ": "meldung", "inhalt": "Frau Mustermann an RTW übergeben"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "etb: {v}");
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "abschliessen: {v}");
    let nummer: String =
        sqlx::query_scalar("SELECT einsatznummer_intern FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    let leit = login_cookie(&app, "leitung", "leitungpw1").await;
    Lage {
        app,
        pool,
        admin,
        leit,
        einsatz,
        nummer,
        person,
    }
}

fn antraege_uri(e: i64) -> String {
    format!("/api/aufbewahrung/einsaetze/{e}/schwaerzungsantraege")
}

fn personen_antrag(id: i64, bestaetigung: &str) -> Value {
    json!({
        "ziel": {"art": "betroffene", "id": id},
        "aktenzeichen": "DS-2026-014",
        "bestaetigung": bestaetigung,
    })
}

async fn antrag_anzahl(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM schwaerzung_antrag")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn antrag_stellen_zugriff_und_statuscodes() {
    let l = lage().await;
    let uri = antraege_uri(l.einsatz);

    // Einsatzleitung und fremde Organisation: 403, nichts angelegt.
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.leit,
        Some(&personen_antrag(l.person, "R-001")),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&l.app, "GET", &uri, &l.leit, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Form → 400.
    for body in [
        json!({"ziel": {"art": "nachbar", "id": 1}, "aktenzeichen": "A", "bestaetigung": "R-001"}),
        json!({"ziel": {"art": "betroffene"}, "aktenzeichen": "A", "bestaetigung": "R-001"}),
        json!({"ziel": {"art": "einsatz", "id": 1}, "aktenzeichen": "A", "bestaetigung": "x"}),
        json!({"ziel": {"art": "betroffene", "id": l.person}, "aktenzeichen": "  ", "bestaetigung": "R-001"}),
        json!({"ziel": {"art": "betroffene", "id": l.person}, "aktenzeichen": "x".repeat(65), "bestaetigung": "R-001"}),
        json!({"ziel": {"art": "betroffene", "id": l.person}, "aktenzeichen": "A", "bestaetigung": " "}),
        json!({"ziel": {"art": "betroffene", "id": l.person}, "bestaetigung": "R-001"}),
    ] {
        let (s, v) = anfrage_json(&l.app, "POST", &uri, &l.admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }
    // Zusammenhang → 422, unbekannte Person → 404.
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&personen_antrag(l.person, "R-002")),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&personen_antrag(999_999, "R-001")),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(antrag_anzahl(&l.pool).await, 0);

    // Erfolg → 201; die Person trägt danach unveränderte Angaben.
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&personen_antrag(l.person, "R-001")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["ziel_art"], "betroffene");
    assert_eq!(v["ziel_kennung"], "R-001");
    assert_eq!(v["stand"], "offen");
    assert_eq!(v["zuruecknehmbar"], true);
    assert!(v["faellig_at"].as_str().unwrap() > v["beantragt_at"].as_str().unwrap());
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM einsatz_person WHERE id = ?")
        .bind(l.person)
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!(name.as_deref(), Some("Mustermann"));
    // Doppelt → 409.
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&personen_antrag(l.person, "R-001")),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn aktiver_und_geschwaerzter_einsatz_sind_409() {
    let l = lage().await;
    let aktiv = einsatz_anlegen(&l.app, &l.admin).await;
    let einsatz_antrag =
        |n: &str| json!({"ziel": {"art": "einsatz"}, "aktenzeichen": "DS-1", "bestaetigung": n});
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &antraege_uri(aktiv),
        &l.admin,
        Some(&einsatz_antrag("x")),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "aktiv");
    sqlx::query("UPDATE einsatz SET geloescht_at = datetime('now'), geschwaerzt_at = datetime('now') WHERE id = ?")
        .bind(l.einsatz)
        .execute(&l.pool)
        .await
        .unwrap();
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &antraege_uri(l.einsatz),
        &l.admin,
        Some(&einsatz_antrag(&l.nummer)),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "geschwärzt");
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/aufbewahrung/einsaetze/{}/personensuche", l.einsatz),
        &l.admin,
        Some(&json!({"suchtext": "Mustermann"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "Suche im geschwärzten Einsatz");
}

#[tokio::test]
async fn einsatz_antrag_zustand_und_ruecknahme() {
    let l = lage().await;
    let uri = antraege_uri(l.einsatz);
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&json!({"ziel": {"art": "einsatz"}, "aktenzeichen": "DS-2026-015", "bestaetigung": l.nummer})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let aid = v["id"].as_i64().unwrap();
    let faellig = v["faellig_at"].clone();

    let (_, ue) = anfrage(&l.app, "GET", "/api/aufbewahrung", &l.admin, None).await;
    let zeile = ue
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["einsatz_id"] == l.einsatz)
        .unwrap();
    assert_eq!(zeile["zustand"], "schwaerzung_beantragt");
    assert_eq!(zeile["antrag_faellig_at"], faellig);
    let (_, akte) = anfrage(
        &l.app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{}", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(akte["zustand"], "schwaerzung_beantragt");

    // Rücknahme: 404 unbekannt, 200, dann 409; Zustand wieder aus der Frist.
    let rueck = |a: i64| format!("{uri}/{a}/zuruecknehmen");
    let (s, _) = anfrage(&l.app, "POST", &rueck(999_999), &l.admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&l.app, "POST", &rueck(aid), &l.leit, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, liste) = anfrage(&l.app, "POST", &rueck(aid), &l.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    assert_eq!(liste[0]["stand"], "zurueckgenommen");
    assert_eq!(liste[0]["zuruecknehmbar"], false);
    let (s, _) = anfrage(&l.app, "POST", &rueck(aid), &l.admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (_, ue) = anfrage(&l.app, "GET", "/api/aufbewahrung", &l.admin, None).await;
    let zeile = ue
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["einsatz_id"] == l.einsatz)
        .unwrap();
    assert_ne!(zeile["zustand"], "schwaerzung_beantragt");
    assert!(!zeile.as_object().unwrap().contains_key("antrag_faellig_at"));

    // ETB-Spur: zwei System-Einträge mit Aktenzeichen, ohne Namen.
    let texte: Vec<String> = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND inhalt LIKE '%DS-2026-015%'",
    )
    .bind(l.einsatz)
    .fetch_all(&l.pool)
    .await
    .unwrap();
    assert_eq!(texte.len(), 2, "{texte:?}");
    assert!(texte
        .iter()
        .all(|t| !t.contains("Mustermann") && !t.contains("Erika")));
}

#[tokio::test]
async fn personensuche_pseudonym_ohne_cache_und_nur_fuer_den_admin() {
    let l = lage().await;
    let uri = format!("/api/aufbewahrung/einsaetze/{}/personensuche", l.einsatz);
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.leit,
        Some(&json!({"suchtext": "Mustermann"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&json!({"suchtext": " ab "})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let req = Request::builder()
        .method("POST")
        .uri(&uri)
        .header(header::COOKIE, l.admin.clone())
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"suchtext":"mustermann erika"}"#))
        .unwrap();
    let resp = l.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(
        !text.contains("Mustermann") && !text.contains("Erika"),
        "{text}"
    );
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v[0]["art"], "betroffene");
    assert_eq!(v[0]["kennung"], "R-001");
    assert_eq!(v[0]["id"], l.person);

    let (_, v) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&json!({"suchtext": "0171-2345678"})),
    )
    .await;
    assert_eq!(v.as_array().unwrap().len(), 1);
    let (_, v) = anfrage_json(
        &l.app,
        "POST",
        &uri,
        &l.admin,
        Some(&json!({"suchtext": "Muster"})),
    )
    .await;
    assert_eq!(v.as_array().unwrap().len(), 0, "kein Teilwort-Treffer");
}

/// Ende zu Ende (Aufgabe 7.4): Antrag über die Route, Purge-Lauf 24 Stunden später, dann die
/// ETB-Spur (Antrag und Vollzug mit Aktenzeichen und `R-001`, ohne Namen), die geschwärzte
/// Person, die Kennzeichnung im Register und der unveränderte ETB-Wortlaut mit dem Namen.
#[tokio::test]
async fn personen_antrag_bis_zum_vollzug() {
    let l = lage().await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &antraege_uri(l.einsatz),
        &l.admin,
        Some(&personen_antrag(l.person, "R-001")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let faellig = lifeline_hub::zeit::parse_utc(v["faellig_at"].as_str().unwrap()).unwrap();
    let live = lifeline_hub::live::LiveHub::new();
    assert_eq!(
        lifeline_hub::einsatz::purge_scheduler::tick_einmal(
            &l.pool,
            &live,
            faellig - chrono::Duration::seconds(1)
        )
        .await,
        0
    );
    assert_eq!(
        lifeline_hub::einsatz::purge_scheduler::tick_einmal(&l.pool, &live, faellig).await,
        1
    );

    let (name, vorname, kontakt, nr): (Option<String>, Option<String>, Option<String>, i64) =
        sqlx::query_as(
            "SELECT name, vorname, melder_kontakt, registrier_nr FROM einsatz_person WHERE id = ?",
        )
        .bind(l.person)
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!((name, vorname, kontakt, nr), (None, None, None, 1));

    let spur: Vec<String> = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND inhalt LIKE '%DS-2026-014%' \
         ORDER BY lfd_nr",
    )
    .bind(l.einsatz)
    .fetch_all(&l.pool)
    .await
    .unwrap();
    assert_eq!(spur.len(), 2, "{spur:?}");
    assert!(spur.iter().all(|t| t.contains("R-001")));
    assert!(spur
        .iter()
        .all(|t| !t.contains("Mustermann") && !t.contains("Erika")));
    let wortlaut: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? \
           AND inhalt = 'Frau Mustermann an RTW übergeben'",
    )
    .bind(l.einsatz)
    .fetch_one(&l.pool)
    .await
    .unwrap();
    assert_eq!(wortlaut, 1, "Erwähnung im ETB-Wortlaut bleibt");

    let (_, akte) = anfrage(
        &l.app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{}", l.einsatz),
        &l.admin,
        None,
    )
    .await;
    assert!(
        akte["personen"][0]["auf_antrag_geschwaerzt_at"].is_string(),
        "{akte}"
    );
    let (_, liste) = anfrage(&l.app, "GET", &antraege_uri(l.einsatz), &l.admin, None).await;
    assert_eq!(liste[0]["stand"], "vollzogen");
}
