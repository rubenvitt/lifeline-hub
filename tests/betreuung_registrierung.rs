//! Integrationstests der Registrierstelle (LLH-1612, Spec `betreuung-registrierung`): was erst
//! die Routen leisten — Body und Felder (400/422), Rechte (Module Betreuung und Personen, Gerät
//! nur an der eigenen Stelle), Replay vor dem Aktiv-Gate, Kostform-Zählung ohne Personenbezug,
//! Belegungsart an der Stelle und der Personen-PATCH der Kostform. Die Fachlogik der Schreibpfade
//! prüfen `src/betreuung/registrierung/tests.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::*;

fn b(e: i64) -> String {
    format!("/api/einsaetze/{e}/betreuung")
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage(app, "POST", pfad, cookie, Some(&body.to_string())).await
}

async fn stelle(app: &axum::Router, cookie: &str, e: i64, name: &str, art: &str) -> i64 {
    let (s, v) = post(
        app,
        cookie,
        &format!("{}/stellen", b(e)),
        json!({"bezeichnung": name, "art": "notunterkunft", "kapazitaet_personen": 150,
               "belegungsart": art}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["belegungsart"], art);
    v["id"].as_i64().unwrap()
}

fn familie(client_id: Option<&str>) -> Value {
    let mut body = json!({
        "personen": [
            {"name": "Weber", "vorname": "Anna", "kostform": "vegetarisch",
             "herkunft_adresse": "Lindenweg 3", "unvertraeglichkeiten": "Erdnüsse"},
            {"name": "Weber", "vorname": "Tom", "kostform": "normal", "geschlecht": "maennlich"},
            {"name": "Weber", "vorname": "Lea", "kostform": "saeugling_kleinkind",
             "geburtsdatum": "2025-03-01"}
        ]
    });
    if let Some(c) = client_id {
        body["client_id"] = json!(c);
    }
    body
}

fn reg(e: i64, sid: i64) -> String {
    format!("{}/stellen/{sid}/registrierungen", b(e))
}

async fn geraet(app: &axum::Router, admin: &str, e: i64, body: Value) -> String {
    let (s, v) = post(app, admin, &format!("/api/einsaetze/{e}/geraete"), body).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/geraete/koppeln")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let _ = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    cookie
}

/// Durchstich: registrieren, Liste, Kostformen, namentliche Belegung, abmelden.
#[tokio::test]
async fn durchstich_registrieren_liste_kostformen_abmelden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "namentlich").await;

    let (s, h) = post(&app, &admin, &reg(e, sid), familie(None)).await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    assert_eq!(h["nummer"], 1);
    let personen = h["personen"].as_array().unwrap();
    assert_eq!(personen.len(), 3);
    assert_eq!(personen[0]["kostform"], "vegetarisch");
    assert_eq!(personen[0]["unvertraeglichkeiten"], "Erdnüsse");
    assert_eq!(h["bezugsperson_id"], personen[0]["id"]);
    assert_eq!(h["bezugsperson_name"], "Weber, Anna");

    let (s, liste) = anfrage(&app, "GET", &reg(e, sid), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    assert_eq!(liste["haushalte"].as_array().unwrap().len(), 1);
    assert!(liste["ohne_haushalt"].as_array().unwrap().is_empty());

    let (s, k) = anfrage(&app, "GET", &format!("{}/kostformen", b(e)), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{k}");
    assert_eq!(
        k,
        json!({"registriert": 3, "normal": 1, "ohne_angabe": 0,
               "sonderkost": {"vegetarisch": 1, "vegan": 0, "ohne_schwein": 0,
                              "diaet_allergenarm": 0, "saeugling_kleinkind": 1}}),
        "Feldmenge gepinnt, ohne Personenbezug"
    );

    let (_, ue) = anfrage(&app, "GET", &b(e), &admin, None).await;
    assert_eq!(ue["stellen"][0]["belegung"]["belegt"], 3);
    let (_, verlauf) = anfrage(
        &app,
        "GET",
        &format!("{}/stellen/{sid}/belegungen", b(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(verlauf[0]["quelle"], "registrierung");

    let etb = system_etb_inhalte(&app, &admin, e).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Haushalt H-1 mit 3 Personen registriert")),
        "{etb:?}"
    );
    assert!(!etb
        .iter()
        .any(|t| t.contains("Weber") || t.contains("Erdnüsse")));

    // Handmeldung an der namentlichen Stelle: 409.
    let (s, _) = post(
        &app,
        &admin,
        &format!("{}/stellen/{sid}/belegungen", b(e)),
        json!({"belegt": 40}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let hid = h["id"].as_i64().unwrap();
    let (s, ab) = post(
        &app,
        &admin,
        &format!("{}/stellen/{sid}/abmeldungen", b(e)),
        json!({"haushalt_id": hid, "ziel": "zu Verwandten"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ab}");
    assert_eq!(ab["person_ids"].as_array().unwrap().len(), 3);
    let (_, ue) = anfrage(&app, "GET", &b(e), &admin, None).await;
    assert_eq!(ue["stellen"][0]["belegung"]["belegt"], 0);
}

/// 400 für das Feld für sich, 422 für den Zusammenhang.
#[tokio::test]
async fn felder_400_und_zusammenhang_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "gezaehlt").await;
    let eine = |p: Value| json!({ "personen": [p] });
    for (body, erwartet) in [
        (
            eine(json!({"name": "Weber", "kostform": "halal_streng"})),
            StatusCode::BAD_REQUEST,
        ),
        // Ohne die Pflicht-Kostform passt schon der Body nicht (400 des Extraktors).
        (eine(json!({"name": "Weber"})), StatusCode::BAD_REQUEST),
        (
            eine(json!({"name": "Weber", "kostform": "normal", "geschlecht": "x"})),
            StatusCode::BAD_REQUEST,
        ),
        (
            eine(json!({"name": "Weber", "kostform": "normal", "geburtsdatum": "01.02.2000"})),
            StatusCode::BAD_REQUEST,
        ),
        (
            eine(json!({"name": "Weber", "kostform": "normal",
                        "unvertraeglichkeiten": "x".repeat(201)})),
            StatusCode::BAD_REQUEST,
        ),
        (
            eine(json!({"name": "  ", "kostform": "normal"})),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (json!({"personen": []}), StatusCode::UNPROCESSABLE_ENTITY),
        (
            json!({"personen": vec![json!({"name": "A", "kostform": "normal"}); 31]}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, v) = post(&app, &admin, &reg(e, sid), body.clone()).await;
        assert_eq!(s, erwartet, "{body}: {v}");
    }
    let (s, _) = post(
        &app,
        &admin,
        &reg(e, sid + 999),
        eine(json!({"name": "Weber", "kostform": "normal"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = post(
        &app,
        &admin,
        &format!("{}/stellen/{sid}/abmeldungen", b(e)),
        json!({"haushalt_id": 1, "person_ids": [1]}),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Haushalt ODER Personen"
    );
}

/// Spec „Ohne Personenrecht“ und „Nur Betreuung“: Liste und Schreibwege 403, Zählung erlaubt.
#[tokio::test]
async fn ohne_personen_nur_die_zaehlung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "gezaehlt").await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/personen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anfrage(&app, "GET", &reg(e, sid), &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = post(&app, &frieda, &reg(e, sid), familie(None)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = post(
        &app,
        &frieda,
        &format!("{}/stellen/{sid}/abmeldungen", b(e)),
        json!({"haushalt_id": 1}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, k) = anfrage(&app, "GET", &format!("{}/kostformen", b(e)), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "{k}");
}

/// Spec „Gerät an fremder Stelle“: das Gerät registriert und liest nur an der eigenen Stelle.
#[tokio::test]
async fn geraet_nur_an_der_eigenen_stelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ost = stelle(&app, &admin, e, "Turnhalle Ost", "namentlich").await;
    let west = stelle(&app, &admin, e, "Weserstadion", "gezaehlt").await;
    let tablet = geraet(
        &app,
        &admin,
        e,
        json!({"ansicht": "betreuungsstelle", "stelle_id": ost, "bezeichnung": "Tablet NU"}),
    )
    .await;
    let (s, h) = post(&app, &tablet, &reg(e, ost), familie(None)).await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    let (s, _) = anfrage(&app, "GET", &reg(e, ost), &tablet, None).await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = post(&app, &tablet, &reg(e, west), familie(None)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "GET", &reg(e, west), &tablet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = post(
        &app,
        &tablet,
        &format!("{}/stellen/{west}/abmeldungen", b(e)),
        json!({"haushalt_id": h["id"]}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = post(
        &app,
        &tablet,
        &format!("{}/stellen/{ost}/abmeldungen", b(e)),
        json!({"person_ids": [h["personen"][1]["id"]]}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

/// Spec „Wiederholung nach Einsatzende“: derselbe Schlüssel liefert den angelegten Haushalt,
/// ein neuer Vorgang ist nach dem Ende gesperrt.
#[tokio::test]
async fn replay_nach_einsatzende() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "gezaehlt").await;
    let (s, erst) = post(&app, &admin, &reg(e, sid), familie(Some("r-1"))).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, zweit) = post(&app, &admin, &reg(e, sid), familie(Some("r-1"))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(zweit, erst, "Replay ohne zweiten Haushalt");

    let (s, ab) = post(
        &app,
        &admin,
        &format!("{}/stellen/{sid}/abmeldungen", b(e)),
        json!({"haushalt_id": erst["id"], "client_id": "a-1"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ab}");

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, wieder) = post(&app, &admin, &reg(e, sid), familie(Some("r-1"))).await;
    assert_eq!(s, StatusCode::CREATED, "{wieder}");
    assert_eq!(wieder["id"], erst["id"]);
    let (s, ab2) = post(
        &app,
        &admin,
        &format!("{}/stellen/{sid}/abmeldungen", b(e)),
        json!({"haushalt_id": erst["id"], "client_id": "a-1"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(ab2["person_ids"], ab["person_ids"]);
    let (s, _) = post(&app, &admin, &reg(e, sid), familie(Some("r-2"))).await;
    assert_eq!(s, StatusCode::CONFLICT, "neuer Vorgang nach dem Ende");
}

/// Spec „Kostform ändern“ / „Unbekannte Kostform“: der Personen-PATCH setzt Kostform und
/// Unverträglichkeiten feldweise; die Zählung folgt.
#[tokio::test]
async fn kostform_im_personen_patch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "gezaehlt").await;
    let (_, h) = post(&app, &admin, &reg(e, sid), familie(None)).await;
    let tom = h["personen"][1]["id"].as_i64().unwrap();
    let pfad = format!("/api/einsaetze/{e}/personen/{tom}");

    let (s, p) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"kostform": "ohne_schwein", "erwartet": {"kostform": "normal"}}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{p}");
    assert_eq!(p["kostform"], "ohne_schwein");
    assert_eq!(p["haushalt_nummer"], 1);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"kostform": "vegan", "erwartet": {"kostform": "normal"}}).to_string()),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "Feld-CAS greift auch für die Kostform"
    );
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"kostform": "halal_streng"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"unvertraeglichkeiten": "x".repeat(201)}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (_, k) = anfrage(&app, "GET", &format!("{}/kostformen", b(e)), &admin, None).await;
    assert_eq!(k["sonderkost"]["ohne_schwein"], 1);
    assert_eq!(k["normal"], 0);
}

/// Live (Spec „Registrierliste“: die Liste aktualisiert sich live): Registrieren verteilt das
/// Betreuungs-Ereignis mit der Stelle und je Person das Personen-Ereignis, ohne Namen oder
/// Kostform im Broadcast; ein Replay verteilt nichts.
#[tokio::test]
async fn registrieren_ist_live_ohne_namen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "namentlich").await;
    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, h) = post(&app, &admin, &reg(e, sid), familie(Some("live-1"))).await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    let roh = sse_anfang_lesen(feed.into_body(), 400).await;
    assert!(roh.contains("event: betreuung"), "{roh:?}");
    assert!(roh.contains(&format!(r#""stelle_id":{sid}"#)), "{roh:?}");
    assert!(roh.contains("event: person"), "{roh:?}");
    let daten: Vec<&str> = roh.lines().filter(|z| z.starts_with("data:")).collect();
    for kanarienvogel in ["Weber", "vegetarisch", "Erdnüsse", "Lindenweg"] {
        assert!(
            daten.iter().all(|z| !z.contains(kanarienvogel)),
            "{kanarienvogel:?} gehört nicht in den Broadcast: {daten:?}"
        );
    }

    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, _) = post(&app, &admin, &reg(e, sid), familie(Some("live-1"))).await;
    assert_eq!(s, StatusCode::CREATED);
    let roh = sse_anfang_lesen(feed.into_body(), 300).await;
    assert!(
        !roh.contains("event: betreuung"),
        "Replay verteilt nichts: {roh:?}"
    );
}

/// CodeRabbit-Befund (Review 5829810053): die Kostform-Zählung zählt auch an gezählten Stellen.
/// Kostform-PATCH, Verbleibwechsel und Storno einer Person dort verteilen deshalb `betreuung`,
/// auch ohne Belegungsmeldung; wer Verpflegung ohne Personenrecht führt, bekommt kein `person`.
/// Ein PATCH ohne Kostform verteilt kein `betreuung`.
#[tokio::test]
async fn kostform_zaehlung_ist_live_auch_an_gezaehlter_stelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "gezaehlt").await;
    let (_, h) = post(&app, &admin, &reg(e, sid), familie(None)).await;
    let anna = h["personen"][0]["id"].as_i64().unwrap();
    let tom = h["personen"][1]["id"].as_i64().unwrap();
    let person = |p: i64| format!("/api/einsaetze/{e}/personen/{p}");

    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &person(tom),
        &admin,
        Some(&json!({"notiz": "kommt spät"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let roh = sse_anfang_lesen(feed.into_body(), 300).await;
    assert!(roh.contains("event: person"), "{roh:?}");
    assert!(!roh.contains("event: betreuung"), "ohne Kostform: {roh:?}");

    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &person(tom),
        &admin,
        Some(&json!({"kostform": "vegan"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let roh = sse_anfang_lesen(feed.into_body(), 300).await;
    assert!(roh.contains("event: betreuung"), "Kostform: {roh:?}");

    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/verbleib", person(tom)),
        &admin,
        Some(&json!({"art": "transport", "ziel": "KH Mitte"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let roh = sse_anfang_lesen(feed.into_body(), 300).await;
    assert!(roh.contains("event: betreuung"), "Verbleibwechsel: {roh:?}");

    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, _) = anfrage(&app, "DELETE", &person(anna), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let roh = sse_anfang_lesen(feed.into_body(), 300).await;
    assert!(roh.contains("event: betreuung"), "Storno: {roh:?}");
}

/// Review-Befunde 3 und 4: der Storno einer Person führt die Belegung im selben Vorgang nach; an
/// einer geschlossenen namentlichen Stelle nimmt der Verbleib niemanden auf (422).
#[tokio::test]
async fn storno_fuehrt_nach_und_geschlossene_namentliche_stelle_nimmt_nicht_auf() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "namentlich").await;
    let (_, h) = post(&app, &admin, &reg(e, sid), familie(None)).await;
    let belegt = |ue: &Value| ue["stellen"][0]["belegung"]["belegt"].clone();
    let (_, ue) = anfrage(&app, "GET", &b(e), &admin, None).await;
    assert_eq!(belegt(&ue), 3);

    let tom = h["personen"][1]["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{tom}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, ue) = anfrage(&app, "GET", &b(e), &admin, None).await;
    assert_eq!(belegt(&ue), 2);

    let (s, _) = post(
        &app,
        &admin,
        &format!("{}/stellen/{sid}/abmeldungen", b(e)),
        json!({"haushalt_id": h["id"]}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", b(e)),
        &admin,
        Some(r#"{"status":"geschlossen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let neu = person_anlegen(&app, &admin, e, r#"{"name":"Schulz"}"#).await;
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{neu}/verbleib"),
        json!({"art": "notunterkunft", "betreuungsstelle_id": sid}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

/// CodeRabbit: `person_ids` von außen haben eine Grenze (400) und werden entdoppelt.
#[tokio::test]
async fn abmeldung_begrenzt_und_entdoppelt_die_personen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "gezaehlt").await;
    let (_, h) = post(&app, &admin, &reg(e, sid), familie(None)).await;
    let ab = format!("{}/stellen/{sid}/abmeldungen", b(e));
    let (s, _) = post(&app, &admin, &ab, json!({"person_ids": vec![1; 51]})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let tom = h["personen"][1]["id"].clone();
    let (s, v) = post(&app, &admin, &ab, json!({"person_ids": [tom, tom, tom]})).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["person_ids"], json!([tom]));
}

// ---------- Registrierliste drucken (LLH-1616, Change `iw8hjb93-registrierliste-drucken`) ----------

fn druck(e: i64, sid: i64) -> String {
    format!("{}/druck", reg(e, sid))
}

/// Einträge `registrierliste` im Zugriffsprotokoll je Person (`None` = listenweit).
async fn druck_eintraege(pool: &sqlx::SqlitePool, e: i64, person: Option<i64>) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM person_zugriff_audit \
         WHERE einsatz_id = ? AND art = 'registrierliste' AND person_id IS ?",
    )
    .bind(e)
    .bind(person)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn person_ids(liste: &Value) -> Vec<i64> {
    let mut ids: Vec<i64> = liste["haushalte"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|h| h["personen"].as_array().unwrap().iter())
        .chain(liste["ohne_haushalt"].as_array().unwrap().iter())
        .map(|p| p["id"].as_i64().unwrap())
        .collect();
    ids.sort();
    ids
}

/// Spec „Druck der Registrierliste wird je Person protokolliert“ und „Gesundheitsangaben nur auf
/// Wunsch“: je Person ein Eintrag, nur an dieser Stelle, Unverträglichkeiten nur mit Parameter.
#[tokio::test]
async fn druck_protokolliert_je_person_und_liefert_gesundheitsangaben_nur_auf_wunsch() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ost = stelle(&app, &admin, e, "Turnhalle Ost", "namentlich").await;
    let west = stelle(&app, &admin, e, "Weserstadion", "gezaehlt").await;
    let (s, h) = post(&app, &admin, &reg(e, ost), familie(None)).await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    let (s, fremd) = post(
        &app,
        &admin,
        &reg(e, west),
        json!({"personen": [{"name": "Kaya", "vorname": "Emre", "kostform": "vegan"}]}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{fremd}");
    let fremd_id = fremd["personen"][0]["id"].as_i64().unwrap();

    let (s, blatt) = anfrage(&app, "GET", &druck(e, ost), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{blatt}");
    assert_eq!(blatt["stelle_id"], ost);
    assert_eq!(blatt["haushalte"][0]["nummer"], 1);
    assert_eq!(
        blatt["haushalte"][0]["personen"][0]["kostform"],
        "vegetarisch"
    );
    assert!(
        !blatt.to_string().contains("unvertraeglichkeiten"),
        "ohne Wahl verlässt keine Gesundheitsangabe den Server: {blatt}"
    );
    let ids = person_ids(&blatt);
    assert_eq!(ids.len(), 3);
    for id in &ids {
        assert_eq!(druck_eintraege(&pool, e, Some(*id)).await, 1, "Person {id}");
    }
    assert_eq!(druck_eintraege(&pool, e, Some(fremd_id)).await, 0);
    assert_eq!(
        druck_eintraege(&pool, e, None).await,
        0,
        "kein listenweiter Eintrag"
    );

    // Neu laden: je Person ein weiterer Eintrag.
    let (s, _) = anfrage(&app, "GET", &druck(e, ost), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    for id in &ids {
        assert_eq!(druck_eintraege(&pool, e, Some(*id)).await, 2, "Person {id}");
    }

    // Bewusst gewählt: die Unverträglichkeit steht in der Zeile.
    let (s, mit) = anfrage(
        &app,
        "GET",
        &format!("{}?unvertraeglichkeiten=1", druck(e, ost)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{mit}");
    assert_eq!(
        mit["haushalte"][0]["personen"][0]["unvertraeglichkeiten"],
        "Erdnüsse"
    );
    for id in &ids {
        assert_eq!(druck_eintraege(&pool, e, Some(*id)).await, 3, "Person {id}");
    }

    // Die Bildschirmliste bleibt unprotokolliert.
    let (s, _) = anfrage(&app, "GET", &reg(e, ost), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(druck_eintraege(&pool, e, Some(ids[0])).await, 3);
}

/// Spec „Leere Stelle“: leere Liste, kein Eintrag. Unbekannte Stelle 404 ohne Eintrag.
#[tokio::test]
async fn druck_einer_leeren_oder_unbekannten_stelle_schreibt_nichts() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ost = stelle(&app, &admin, e, "Turnhalle Ost", "namentlich").await;

    let (s, blatt) = anfrage(&app, "GET", &druck(e, ost), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{blatt}");
    assert!(blatt["haushalte"].as_array().unwrap().is_empty());
    assert!(blatt["ohne_haushalt"].as_array().unwrap().is_empty());
    let (s, _) = anfrage(&app, "GET", &druck(e, ost + 999), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let alle: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(alle, 0);
}

/// Spec „Ohne Personenrecht“: 403, bevor etwas gelesen oder protokolliert wird.
#[tokio::test]
async fn druck_ohne_personenrecht_ist_403_ohne_eintrag() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "gezaehlt").await;
    let (s, _) = post(&app, &admin, &reg(e, sid), familie(None)).await;
    assert_eq!(s, StatusCode::CREATED);
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/personen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anfrage(&app, "GET", &druck(e, sid), &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(druck_eintraege(&pool, e, None).await, 0);
    let alle: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(alle, 0);
}

/// Spec „Protokoll nicht schreibbar“: scheitert der Eintrag der zweiten Person, geht keine Person
/// hinaus, und der Eintrag der ersten bleibt nicht stehen.
#[tokio::test]
async fn druck_ohne_vollstaendiges_protokoll_liefert_nichts_und_laesst_nichts_stehen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost", "namentlich").await;
    let (s, h) = post(&app, &admin, &reg(e, sid), familie(None)).await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    // Der erste Eintrag gelingt, der zweite scheitert (wie bei voller Platte mitten im Abruf).
    sqlx::query(
        "CREATE TRIGGER druck_audit_kaputt BEFORE INSERT ON person_zugriff_audit \
         WHEN NEW.art = 'registrierliste' \
          AND (SELECT COUNT(*) FROM person_zugriff_audit WHERE art = 'registrierliste') >= 1 \
         BEGIN SELECT RAISE(ABORT, 'kaputt'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (s, body) = anfrage(&app, "GET", &druck(e, sid), &admin, None).await;
    assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
    assert!(!body.to_string().contains("Weber"), "{body}");
    let alle: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(alle, 0, "kein Eintrag dieses Abrufs bleibt stehen");
}
