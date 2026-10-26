//! Integrationstests des Fachmoduls Verpflegung (LFH-634): Statuscodes je Endpunkt, ein
//! Durchstich Anlegen → Ausgabe → Rücknahme → Löschen mit ETB-Zählung je Schritt, die Rechte
//! (Beobachter, ausgeblendetes Modul, abgeschlossener Einsatz), der Nachforderungsverweis ohne
//! Datenleck und die Live-Verteilung nur an Leser mit Modulrecht.
//!
//! Die Fachlogik der Schreibpfade prüft `src/verpflegung/repo/tests.rs`; hier geht es um das,
//! was erst die Route leistet: Body-Extraktion, Zeit-Normalisierung, Gates, Live.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/verpflegung")
}

/// „Mittag“ am 24.09., 10:00–11:30 UTC (12:00–13:30 in Berlin), 180 Kräfte, 70 Betreute.
const MITTAG: &str = r#"{"bezeichnung":"Mittag","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:30:00Z","bedarf_kraefte":180,"bedarf_betreute":70}"#;

/// Eine Feldküche ohne Standort.
const FELDKUECHE: &str = r#"{"bezeichnung":"Feldküche BR Sportplatz","art":"feldkueche"}"#;

async fn zeitfenster(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("{}/zeitfenster", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Zeitfenster: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn ausgabe(app: &axum::Router, cookie: &str, einsatz: i64, zid: i64, body: &str) -> Value {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("{}/zeitfenster/{zid}/ausgaben", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Ausgabe: {json:?}");
    json
}

async fn etb_eintraege(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array().cloned().unwrap_or_default()
}

/// ETB-Einträge des Einsatzes, die von Verpflegung stammen (Zeitfenster und Stellen) — chronologisch (die Liste der
/// Route kommt neueste zuerst).
async fn verpflegungs_etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    etb_eintraege(app, cookie, einsatz)
        .await
        .into_iter()
        .rev()
        .filter(|e| {
            e["inhalt"].as_str().is_some_and(|i| {
                i.starts_with("Verpflegung ") || i.starts_with("Verpflegungsstelle ")
            })
        })
        .map(|e| {
            assert_eq!(e["typ"], "system", "{e:?}");
            e["inhalt"].as_str().unwrap().to_string()
        })
        .collect()
}

// ── Zeitzone (LLH-1443) ─────────────────────────────────────────────────────────────────────

/// Der Zeitraum im ETB steht in der Zone des Einsatzes, nicht in der der Organisation: 10:00
/// bis 11:30 UTC sind in Tokio 19:00–20:30, in New York 06:00–07:30.
#[tokio::test]
async fn zeitraum_steht_in_der_zone_des_einsatzes_nicht_der_organisation() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'America/New_York') \
         ON CONFLICT (org_id) DO UPDATE SET zeitzone = excluded.zeitzone",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone) VALUES (?, 'Asia/Tokyo') \
         ON CONFLICT (einsatz_id) DO UPDATE SET zeitzone = excluded.zeitzone",
    )
    .bind(e)
    .execute(&pool)
    .await
    .unwrap();
    zeitfenster(&app, &admin, e, MITTAG).await;
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await,
        vec!["Verpflegung ‚Mittag‘ 241900sep26–2030 angelegt: Bedarf 250 EP (180 Kräfte, 70 Betreute)."]
    );
}

// ── Durchstich ──────────────────────────────────────────────────────────────────────────────

/// Anlegen → Ausgabe → Rücknahme → Löschen. Nur Anlegen und Löschen schreiben ETB (D5), der
/// Zeitraum steht in Berliner Zeit (Spec „Zeitraum in Ortszeit“).
#[tokio::test]
async fn durchstich_anlegen_ausgabe_ruecknahme_loeschen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    // Anlegen mit ISO-Zeitpunkten → normalisiert gespeichert; Gesamtbedarf 250.
    let (s, zf) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster", pfad(e)),
        &admin,
        Some(
            r#"{"bezeichnung":"Mittag","von_at":"2026-09-24T12:00:00+02:00","bis_at":"2026-09-24T11:30:00Z","bedarf_kraefte":180,"bedarf_betreute":70,"sonderkost":{"vegetarisch":12,"vegan":3}}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{zf:?}");
    assert_eq!(zf["von_at"], "2026-09-24 10:00:00");
    assert_eq!(zf["bis_at"], "2026-09-24 11:30:00");
    assert_eq!(zf["bedarf"]["gesamt"], 250);
    assert_eq!(zf["bedarf"]["weitere"], 0);
    assert_eq!(zf["bedarf"]["sonderkost"]["vegetarisch"], 12);
    assert_eq!(
        zf["bedarf"]["sonderkost"]["ohne_schwein"], 0,
        "alle fünf Felder"
    );
    assert_eq!(zf["fehlmenge"]["gesamt"], 250);
    assert_eq!(zf["ausgaben"].as_array().unwrap().len(), 0);
    assert!(
        !zf.as_object().unwrap().contains_key("einstufung"),
        "keine Einstufung im DTO (D2): {zf:?}"
    );
    let zid = zf["id"].as_i64().unwrap();
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await,
        vec!["Verpflegung ‚Mittag‘ 241200sep26–1330 angelegt: Bedarf 250 EP (180 Kräfte, 70 Betreute), davon 15 Sonderkost."]
    );

    // Ausgabe 120 EP um 11:40 Ortszeit (vor Beginn), kein ETB.
    let a = ausgabe(
        &app,
        &admin,
        e,
        zid,
        r#"{"menge":120,"ort":"Verpflegungsstelle Deich","zeitpunkt_at":"2026-09-24T11:40:00+02:00"}"#,
    )
    .await;
    let aid = a["ausgabe_id"].as_i64().unwrap();
    assert_eq!(a["zeitfenster"]["ausgegeben"]["gesamt"], 120);
    assert_eq!(a["zeitfenster"]["fehlmenge"]["gesamt"], 130);
    assert_eq!(a["zeitfenster"]["ausgaben"][0]["id"], aid);
    assert_eq!(
        a["zeitfenster"]["ausgaben"][0]["zeitpunkt_at"],
        "2026-09-24 09:40:00"
    );
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), 1);

    // Rücknahme: ausgegeben sinkt um 120, die Ausgabe bleibt sichtbar; kein ETB.
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{}/ausgaben/{aid}/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert_eq!(r["ausgabe_id"], aid);
    assert_eq!(r["zeitfenster"]["ausgegeben"]["gesamt"], 0);
    assert!(r["zeitfenster"]["ausgaben"][0]["zurueckgenommen_at"].is_string());
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), 1);

    // Die Übersicht trägt denselben Stand.
    let (s, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u["zeitfenster"][0]["id"], zid);
    assert_eq!(u["zeitfenster"][0]["ausgegeben"]["gesamt"], 0);

    // Löschen: 204, ETB-Eintrag „gelöscht“, die Übersicht ist leer.
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/zeitfenster/{zid}", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let etb = verpflegungs_etb(&app, &admin, e).await;
    assert_eq!(etb.len(), 2, "{etb:?}");
    assert!(etb[1].contains("gelöscht"), "{etb:?}");
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"].as_array().unwrap().len(), 0);
}

/// Spec „Bedarf geändert“ über die Route, und der Leerlauf eines PATCH ohne neuen Wert.
#[tokio::test]
async fn patch_aendert_bedarf_und_leerlauf_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let uri = format!("{}/zeitfenster/{zid}", pfad(e));

    let (s, zf) = anfrage(
        &app,
        "PATCH",
        &uri,
        &admin,
        Some(r#"{"bedarf_betreute":90}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{zf:?}");
    assert_eq!(zf["bedarf"]["gesamt"], 270);
    assert_eq!(zf["fehlmenge"]["gesamt"], 270);
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await[1],
        "Verpflegung ‚Mittag‘ 241200sep26–1330 geändert: Bedarf 270 EP (vorher 250)."
    );

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &uri,
        &admin,
        Some(r#"{"bedarf_betreute":90,"von_at":"2026-09-24T10:00:00Z"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await.len(),
        2,
        "Leerlauf schreibt keinen ETB-Eintrag"
    );
}

// ── Statuscodes ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn statuscodes_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let neu = format!("{}/zeitfenster", pfad(e));
    let aus = format!("{}/zeitfenster/{zid}/ausgaben", pfad(e));
    let patch = format!("{}/zeitfenster/{zid}", pfad(e));

    for (methode, uri, body) in [
        // Spec „Leere Bezeichnung oder negativer Bedarf“
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"  ","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":1,"bedarf_betreute":0}"#,
        ),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":1,"bedarf_betreute":0}"#,
        ),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bedarf_kraefte":1,"bedarf_betreute":0}"#,
        ),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":1,"bedarf_betreute":0}"#,
        ),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"nachher","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":1,"bedarf_betreute":0}"#,
        ),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":-1,"bedarf_betreute":0}"#,
        ),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":1}"#,
        ),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":1,"bedarf_betreute":0,"bedarf_weitere":-3}"#,
        ),
        // Spec „Negative Anzahl einer Kostform“
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":1,"bedarf_betreute":0,"sonderkost":{"vegan":-1}}"#,
        ),
        (
            "PATCH",
            &patch,
            r#"{"sonderkost":{"saeugling_kleinkind":-1}}"#,
        ),
        ("PATCH", &patch, r#"{"bezeichnung":""}"#),
        ("PATCH", &patch, r#"{"bis_at":"bald"}"#),
        // Spec „Menge nicht positiv“
        ("POST", &aus, r#"{"menge":0}"#),
        ("POST", &aus, r#"{"menge":-5}"#),
        ("POST", &aus, r#"{"ort":"Deich"}"#),
        ("POST", &aus, r#"{"menge":5,"zeitpunkt_at":"gleich"}"#),
        (
            "POST",
            &aus,
            r#"{"menge":5,"sonderkost":{"diaet_allergenarm":-2}}"#,
        ),
        // Obergrenze je Zahlfeld (Review LFH-634): ohne sie lief die Summe zweier Ausgaben
        // über und verfälschte die Deckung dauerhaft.
        ("POST", &aus, r#"{"menge":100001}"#),
        ("POST", &aus, r#"{"menge":9223372036854775807}"#),
        ("POST", &aus, r#"{"menge":5,"sonderkost":{"vegan":100001}}"#),
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":100001,"bedarf_betreute":0}"#,
        ),
        ("PATCH", &patch, r#"{"bedarf_weitere":9223372036854775807}"#),
    ] {
        let (s, j) = anfrage(&app, methode, uri, &admin, Some(body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{methode} {body}: {j:?}");
        assert!(j["error"].is_string(), "{{error}}-Format: {j:?}");
    }
    // Nichts angelegt, nichts geändert.
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"].as_array().unwrap().len(), 1);
    assert_eq!(u["zeitfenster"][0]["ausgaben"].as_array().unwrap().len(), 0);
    assert_eq!(u["zeitfenster"][0]["bezeichnung"], "Mittag");
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), 1);
}

#[tokio::test]
async fn statuscodes_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(
        &app,
        &admin,
        e,
        r#"{"bezeichnung":"Mittag","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:30:00Z","bedarf_kraefte":180,"bedarf_betreute":70,"sonderkost":{"vegan":15}}"#,
    )
    .await;
    let neu = format!("{}/zeitfenster", pfad(e));
    let patch = format!("{}/zeitfenster/{zid}", pfad(e));
    let aus = format!("{}/zeitfenster/{zid}/ausgaben", pfad(e));

    for (methode, uri, body) in [
        // Spec „Ende nicht nach Beginn“ — Anlegen und Ändern (nur ein Zeitpunkt übergeben).
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T12:00:00+02:00","bedarf_kraefte":1,"bedarf_betreute":0}"#,
        ),
        ("PATCH", &patch, r#"{"bis_at":"2026-09-24T09:00:00Z"}"#),
        // Spec „Sonderkost übersteigt die Menge“ — Bedarf, Änderung des Bedarfs, Ausgabe.
        (
            "POST",
            &neu,
            r#"{"bezeichnung":"X","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:00:00Z","bedarf_kraefte":2,"bedarf_betreute":0,"sonderkost":{"vegan":2,"vegetarisch":1}}"#,
        ),
        (
            "PATCH",
            &patch,
            r#"{"bedarf_kraefte":5,"bedarf_betreute":5}"#,
        ),
        ("POST", &aus, r#"{"menge":10,"sonderkost":{"vegan":11}}"#),
    ] {
        let (s, j) = anfrage(&app, methode, uri, &admin, Some(body)).await;
        assert_eq!(
            s,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{methode} {body}: {j:?}"
        );
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(
        u["zeitfenster"].as_array().unwrap().len(),
        1,
        "nichts angelegt"
    );
    assert_eq!(
        u["zeitfenster"][0]["bedarf"]["gesamt"], 250,
        "nichts geändert"
    );
    assert_eq!(u["zeitfenster"][0]["bis_at"], "2026-09-24 11:30:00");

    // Spec „Löschen mit Ausgaben“ und „Zweite Rücknahme“.
    let a = ausgabe(&app, &admin, e, zid, r#"{"menge":10}"#).await;
    let aid = a["ausgabe_id"].as_i64().unwrap();
    let (s, _) = anfrage(&app, "DELETE", &patch, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let zurueck = format!("{}/ausgaben/{aid}/zuruecknehmen", pfad(e));
    let (s, _) = anfrage(&app, "POST", &zurueck, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "POST", &zurueck, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), 1);
}

/// Spec „Zeitfenster eines anderen Einsatzes“ und „Nachforderung eines anderen Einsatzes“.
#[tokio::test]
async fn statuscodes_404_fremder_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let fremd_zid = zeitfenster(&app, &admin, e2, MITTAG).await;
    let fremd_aid = ausgabe(&app, &admin, e2, fremd_zid, r#"{"menge":5}"#).await["ausgabe_id"]
        .as_i64()
        .unwrap();
    let (s, nf) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e2}/nachforderungen"),
        &admin,
        Some(r#"{"art":"Verpflegung","bezeichnung":"Verpflegung 60 EP","anzahl":60,"adressat_kategorie":"leitstelle"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{nf:?}");
    let fremd_nf = nf["id"].as_i64().unwrap();
    let eigene_zid = zeitfenster(&app, &admin, e, MITTAG).await;

    for (methode, uri, body) in [
        (
            "PATCH",
            format!("{}/zeitfenster/{fremd_zid}", pfad(e)),
            Some(r#"{"bedarf_betreute":90}"#),
        ),
        (
            "DELETE",
            format!("{}/zeitfenster/{fremd_zid}", pfad(e)),
            None,
        ),
        (
            "POST",
            format!("{}/zeitfenster/{fremd_zid}/ausgaben", pfad(e)),
            Some(r#"{"menge":5}"#),
        ),
        (
            "POST",
            format!("{}/ausgaben/{fremd_aid}/zuruecknehmen", pfad(e)),
            None,
        ),
        (
            "POST",
            format!("{}/zeitfenster/{eigene_zid}/ausgaben", pfad(e)),
            Some(&*format!(r#"{{"menge":5,"nachforderung_id":{fremd_nf}}}"#)),
        ),
        (
            "POST",
            format!("{}/zeitfenster/{eigene_zid}/ausgaben", pfad(e)),
            Some(r#"{"menge":5,"nachforderung_id":999999}"#),
        ),
    ] {
        let (s, j) = anfrage(&app, methode, &uri, &admin, body).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {uri}: {j:?}");
    }
    // Nichts angelegt oder verändert — auch im fremden Einsatz nicht.
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"][0]["ausgaben"].as_array().unwrap().len(), 0);
    let (_, u2) = anfrage(&app, "GET", &pfad(e2), &admin, None).await;
    assert_eq!(u2["zeitfenster"][0]["bedarf"]["gesamt"], 250);
    assert!(u2["zeitfenster"][0]["ausgaben"][0]
        .get("zurueckgenommen_at")
        .is_none());
}

// ── Nachforderung ───────────────────────────────────────────────────────────────────────────

/// Spec „Ausgabe mit Nachforderung“: die Ausgabe trägt NUR die Kennung — kein weiteres Feld
/// der Nachforderung —, und deren Status bleibt unverändert.
#[tokio::test]
async fn ausgabe_mit_nachforderung_traegt_nur_die_kennung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let (s, nf) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(r#"{"art":"Verpflegung","bezeichnung":"Kanarien-Lieferung 60 EP","anzahl":60,"adressat_kategorie":"leitstelle","begruendung":"Kanarien-Begründung"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{nf:?}");
    let nid = nf["id"].as_i64().unwrap();
    let status_vorher = nf["status"].clone();

    let a = ausgabe(
        &app,
        &admin,
        e,
        zid,
        &format!(r#"{{"menge":60,"nachforderung_id":{nid}}}"#),
    )
    .await;
    let x = &a["zeitfenster"]["ausgaben"][0];
    assert_eq!(x["nachforderung_id"], nid);
    let nachforderungs_felder: Vec<&String> = x
        .as_object()
        .unwrap()
        .keys()
        .filter(|k| k.contains("nachforderung"))
        .collect();
    assert_eq!(nachforderungs_felder, vec!["nachforderung_id"], "{x:?}");
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let text = u.to_string();
    for kanarienvogel in [
        "Kanarien-Lieferung",
        "Kanarien-Begründung",
        "leitstelle",
        "angefordert",
    ] {
        assert!(
            !text.contains(kanarienvogel),
            "{kanarienvogel:?} leakt: {text}"
        );
    }

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        None,
    )
    .await;
    let nachher = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == nid)
        .unwrap();
    assert_eq!(nachher["status"], status_vorher, "Status unverändert");
}

// ── Rechte ──────────────────────────────────────────────────────────────────────────────────

/// Spec „Beobachter liest“ und „Beobachter erfasst“.
#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    ausgabe(&app, &admin, e, zid, r#"{"menge":230}"#).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (s, u) = anfrage(&app, "GET", &pfad(e), &beob_cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u["zeitfenster"][0]["fehlmenge"]["gesamt"], 20);
    assert_eq!(u["zeitfenster"][0]["ausgaben"].as_array().unwrap().len(), 1);

    for (methode, uri, body) in [
        (
            "POST",
            format!("{}/zeitfenster/{zid}/ausgaben", pfad(e)),
            Some(r#"{"menge":5}"#),
        ),
        ("POST", format!("{}/zeitfenster", pfad(e)), Some(MITTAG)),
        (
            "PATCH",
            format!("{}/zeitfenster/{zid}", pfad(e)),
            Some(r#"{"bedarf_betreute":90}"#),
        ),
        ("DELETE", format!("{}/zeitfenster/{zid}", pfad(e)), None),
    ] {
        let (s, _) = anfrage(&app, methode, &uri, &beob_cookie, body).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {uri}");
    }
}

async fn override_setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    sichtbar: bool,
    rolle: Option<&str>,
) {
    let rolle = rolle.map_or("null".to_string(), |r| format!(r#""{r}""#));
    let (s, j) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/verpflegung"),
        cookie,
        Some(&format!(
            r#"{{"sichtbar":{sichtbar},"benoetigte_rolle":{rolle}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override: {j:?}");
}

/// Spec „Modul ausgeblendet“: 403 auf Lesen und Schreiben.
#[tokio::test]
async fn ausgeblendetes_modul_ist_403_fuer_mitglieder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: sichtbar liest sie");
    override_setzen(&app, &admin, e, false, None).await;
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster", pfad(e)),
        &frieda,
        Some(MITTAG),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &frieda,
        Some(FELDKUECHE),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Stelle anlegen");
}

/// Spec „Abgeschlossener Einsatz“: 409 aus dem Extractor, nichts angelegt; Lesen bleibt.
#[tokio::test]
async fn abgeschlossener_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Einsatz abschließen: {s}");
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster", pfad(e)),
        &admin,
        Some(MITTAG),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &admin,
        Some(FELDKUECHE),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "Stelle anlegen");
    let (s, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u["zeitfenster"].as_array().unwrap().len(), 0);
    assert_eq!(u["stellen"].as_array().unwrap().len(), 0);
}

// ── Live-Verteilung ─────────────────────────────────────────────────────────────────────────

/// Spec „Zweiter Client sieht die Ausgabe“ und „Leser ohne Modulrecht“: ein Leser MIT
/// Modulrecht bekommt `verpflegung` (auch bei einer Ausgabe ohne ETB), einer OHNE nicht. Die
/// Nutzlast trägt nur die Einsatz-Kennung.
#[tokio::test]
async fn live_ereignis_nur_an_leser_mit_modulrecht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, e, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    // Nur Führungskräfte der Organisation sehen die Verpflegung.
    override_setzen(&app, &admin, e, true, Some("fuehrungskraft")).await;
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Vorbedingung: Frieda ohne Modulrecht"
    );
    let (s, _) = anfrage(&app, "GET", &pfad(e), &gustav, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: Gustav mit Modulrecht");

    let feed_gustav = live_oeffnen(&app, &gustav, e).await;
    let feed_frieda = live_oeffnen(&app, &frieda, e).await;

    ausgabe(
        &app,
        &admin,
        e,
        zid,
        r#"{"menge":4711,"ort":"Kanarienhof","bemerkung":"Kanarienvogel"}"#,
    )
    .await;
    // Ein Ereignis, das Frieda sehen darf — sonst bewiese ein leerer Feed nichts.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{"name":"Muster","vorname":"Max"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let bei_gustav = sse_anfang_lesen(feed_gustav.into_body(), 400).await;
    let bei_frieda = sse_anfang_lesen(feed_frieda.into_body(), 400).await;
    assert!(
        bei_gustav.contains("event: verpflegung"),
        "Leser mit Modulrecht bekommt das Ereignis: {bei_gustav:?}"
    );
    assert!(
        bei_frieda.contains("event: person"),
        "Friedas Feed läuft: {bei_frieda:?}"
    );
    assert!(
        !bei_frieda.contains("event: verpflegung"),
        "Leser ohne Modulrecht bekommt es nicht: {bei_frieda:?}"
    );
    let daten: Vec<&str> = bei_gustav
        .lines()
        .filter(|z| z.starts_with("data:"))
        .collect();
    for kanarienvogel in ["Kanarien", "4711", "Mittag"] {
        assert!(
            daten.iter().all(|z| !z.contains(kanarienvogel)),
            "{kanarienvogel:?} gehört nicht in den Broadcast: {daten:?}"
        );
    }
}

#[tokio::test]
async fn ausgabe_ohne_zeitpunkt_gilt_zur_erfassung() {
    // Spec „Zeitpunkt fehlt“: der Vorgabewert entsteht in der Route, nicht im Repo.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let vorher = chrono::Utc::now() - chrono::Duration::seconds(1);
    for body in [r#"{"menge":7}"#, r#"{"menge":7,"zeitpunkt_at":"  "}"#] {
        let a = ausgabe(&app, &admin, e, zid, body).await;
        let aid = a["ausgabe_id"].as_i64().unwrap();
        let zp = a["zeitfenster"]["ausgaben"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"].as_i64() == Some(aid))
            .unwrap()["zeitpunkt_at"]
            .as_str()
            .unwrap()
            .to_string();
        let t = chrono::NaiveDateTime::parse_from_str(&zp, "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc();
        let nachher = chrono::Utc::now() + chrono::Duration::seconds(1);
        assert!(
            vorher <= t && t <= nachher,
            "{body}: {zp} liegt nicht bei jetzt"
        );
    }
}

#[tokio::test]
async fn leerlauf_patch_publiziert_kein_ereignis() {
    // D5: ein PATCH ohne Wertänderung schreibt weder ETB noch Live-Ereignis.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let bez = u["zeitfenster"][0]["bezeichnung"]
        .as_str()
        .unwrap()
        .to_string();

    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/zeitfenster/{zid}", pfad(e)),
        &admin,
        Some(&format!(r#"{{"bezeichnung":"{bez}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // Ein Ereignis, das sicher kommt — sonst bewiese ein leerer Feed nichts.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{"name":"Muster","vorname":"Max"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let text = sse_anfang_lesen(feed.into_body(), 400).await;
    assert!(text.contains("event: person"), "Feed läuft: {text:?}");
    assert!(
        !text.contains("event: verpflegung"),
        "Leerlauf-PATCH darf nichts publizieren: {text:?}"
    );
}

// ── Offline-Replay (LFH-688) ────────────────────────────────────────────────────────────────

fn ausgabe_body(menge: i64, client_id: &str) -> String {
    serde_json::json!({ "menge": menge, "client_id": client_id }).to_string()
}

/// Spec „Wiederholte Ausgabe“ über die Route: 201 mit derselben Kennung, genau eine Ausgabe,
/// die ausgegebene Menge steigt nicht. Ein leerer Schlüssel ist keiner.
#[tokio::test]
async fn replay_liefert_die_bestehende_ausgabe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let erst = ausgabe(&app, &admin, e, zid, &ausgabe_body(120, "v1")).await;
    let wieder = ausgabe(&app, &admin, e, zid, &ausgabe_body(120, " v1 ")).await;
    assert_eq!(wieder["ausgabe_id"], erst["ausgabe_id"]);
    assert_eq!(wieder["zeitfenster"]["ausgegeben"]["gesamt"], 120);
    assert_eq!(
        wieder["zeitfenster"]["ausgaben"].as_array().unwrap().len(),
        1
    );

    let a = ausgabe(&app, &admin, e, zid, &ausgabe_body(1, "  ")).await;
    let b = ausgabe(&app, &admin, e, zid, &ausgabe_body(1, "  ")).await;
    assert_ne!(
        a["ausgabe_id"], b["ausgabe_id"],
        "leer heißt: kein Schlüssel"
    );
}

/// Spec „Zu langer Schlüssel“: 400, nichts gespeichert.
#[tokio::test]
async fn client_id_zu_lang_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster/{zid}/ausgaben", pfad(e)),
        &admin,
        Some(&ausgabe_body(5, &"x".repeat(65))),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"][0]["ausgaben"].as_array().unwrap().len(), 0);
}

/// Spec „Replay nach Einsatzende“, „Neue Ausgabe nach Einsatzende“ und „Schlüssel eines
/// anderen Zeitfensters“.
#[tokio::test]
async fn replay_nach_abschluss_und_schluessel_eines_anderen_zeitfensters() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mittag = zeitfenster(&app, &admin, e, MITTAG).await;
    let abend = zeitfenster(&app, &admin, e, &MITTAG.replace("\"Mittag\"", "\"Abend\"")).await;
    let erst = ausgabe(&app, &admin, e, mittag, &ausgabe_body(120, "v4")).await;

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster/{abend}/ausgaben", pfad(e)),
        &admin,
        Some(&ausgabe_body(120, "v4")),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Einsatz abschließen: {s}");
    let url = format!("{}/zeitfenster/{mittag}/ausgaben", pfad(e));
    let (s, wieder) = anfrage(&app, "POST", &url, &admin, Some(&ausgabe_body(120, "v4"))).await;
    assert_eq!(s, StatusCode::CREATED, "{wieder:?}");
    assert_eq!(wieder["ausgabe_id"], erst["ausgabe_id"]);
    let (s, _) = anfrage(&app, "POST", &url, &admin, Some(&ausgabe_body(5, "v4-neu"))).await;
    assert_eq!(s, StatusCode::CONFLICT, "echter Insert bleibt gesperrt");
    let (s, _) = anfrage(&app, "POST", &url, &admin, Some(r#"{"menge":5}"#)).await;
    assert_eq!(s, StatusCode::CONFLICT, "ohne Schlüssel ebenfalls");
}

/// Spec „Beobachter ohne Schreibrecht“: die Gates laufen vor dem Replay-Lookup. Ein fremder
/// Queue-Besitzer ist 412.
#[tokio::test]
async fn gates_vor_dem_replay() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let url = format!("{}/zeitfenster/{zid}/ausgaben", pfad(e));
    ausgabe(&app, &admin, e, zid, &ausgabe_body(120, "v6")).await;

    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &url,
        &beob_cookie,
        Some(&ausgabe_body(120, "v6")),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(json.get("ausgabe_id").is_none(), "{json:?}");

    let (s, _) = anfrage_mit_offline_queue_benutzer(
        &app,
        "POST",
        &url,
        &admin,
        Some(&ausgabe_body(120, "v6")),
        i64::MAX,
    )
    .await;
    assert_eq!(s, StatusCode::PRECONDITION_FAILED);
}

/// Spec „Kein zweites Live-Ereignis beim Replay“ (design.md D5).
#[tokio::test]
async fn replay_verteilt_kein_live_ereignis() {
    use lifeline_hub::live::LiveEvent;
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let mut events = live.abonniere(e);

    ausgabe(&app, &admin, e, zid, &ausgabe_body(5, "v7")).await;
    let erstes = tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
        .await
        .expect("Erstausgabe verteilt live")
        .unwrap()
        .event;
    assert_eq!(erstes, LiveEvent::Verpflegung);

    ausgabe(&app, &admin, e, zid, &ausgabe_body(5, "v7")).await;
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(150), events.recv())
            .await
            .is_err(),
        "ein Replay verteilt nichts"
    );
}

// ── Eingabegrenzen (LLH-1040, design.md D10) ────────────────────────────────────────────────

/// Spec `eingabegrenzen` „Freitexte und Stellenlisten der Verpflegung sind begrenzt“: je Feld
/// 201 an der Grenze, 400 darüber, nichts geschrieben; die Grenze läuft vor dem 422 „Ende nicht
/// nach Beginn“.
#[tokio::test]
async fn grenzen_der_freitexte_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zf_body = |bez: &str| {
        serde_json::json!({
            "bezeichnung": bez,
            "von_at": "2026-09-24T10:00:00Z",
            "bis_at": "2026-09-24T11:30:00Z",
            "bedarf_kraefte": 10,
            "bedarf_betreute": 0,
        })
        .to_string()
    };
    let zf_url = format!("{}/zeitfenster", pfad(e));

    // Zeitfenster-Bezeichnung beim Anlegen: 200 geht, 201 nicht (Leerraum zählt nicht).
    let (s, _) = anfrage(
        &app,
        "POST",
        &zf_url,
        &admin,
        Some(&zf_body(&"m".repeat(201))),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, zf) = anfrage(
        &app,
        "POST",
        &zf_url,
        &admin,
        Some(&zf_body(&format!("  {}  ", "m".repeat(200)))),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{zf:?}");
    let zid = zf["id"].as_i64().unwrap();

    // 400 vor dem 422: zu lange Bezeichnung UND Ende vor Beginn.
    let (s, _) = anfrage(
        &app,
        "POST",
        &zf_url,
        &admin,
        Some(
            &serde_json::json!({
                "bezeichnung": "m".repeat(201),
                "von_at": "2026-09-24T11:00:00Z",
                "bis_at": "2026-09-24T10:00:00Z",
                "bedarf_kraefte": 10,
                "bedarf_betreute": 0,
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Grenze vor dem Zusammenhang");

    // Zeitfenster-Bezeichnung beim Ändern, auch vor dem 422.
    let zid_url = format!("{}/zeitfenster/{zid}", pfad(e));
    for body in [
        serde_json::json!({ "bezeichnung": "m".repeat(201) }),
        serde_json::json!({ "bezeichnung": "m".repeat(201), "bis_at": "2026-09-24T09:00:00Z" }),
    ] {
        let (s, _) = anfrage(&app, "PATCH", &zid_url, &admin, Some(&body.to_string())).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}");
    }
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &zid_url,
        &admin,
        Some(&serde_json::json!({ "bezeichnung": "n".repeat(200) }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    // Ort (500) und Bemerkung (2 000) einer Ausgabe.
    let aus_url = format!("{}/zeitfenster/{zid}/ausgaben", pfad(e));
    for (feld, max) in [("ort", 500), ("bemerkung", 2_000)] {
        let (s, _) = anfrage(
            &app,
            "POST",
            &aus_url,
            &admin,
            Some(&serde_json::json!({ "menge": 1, feld: "x".repeat(max + 1) }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld} über der Grenze");
        let (s, _) = anfrage(
            &app,
            "POST",
            &aus_url,
            &admin,
            Some(&serde_json::json!({ "menge": 1, feld: "x".repeat(max) }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{feld} an der Grenze");
    }
    // Vor dem 422 der Teilmenge.
    let (s, _) = anfrage(
        &app,
        "POST",
        &aus_url,
        &admin,
        Some(
            &serde_json::json!({ "menge": 1, "ort": "x".repeat(501), "sonderkost": { "vegan": 5 } })
                .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Grenze vor der Teilmenge");
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"].as_array().unwrap().len(), 1);
    assert_eq!(u["zeitfenster"][0]["ausgaben"].as_array().unwrap().len(), 2);
}

/// Spec `eingabegrenzen` „Replay einer alten Ausgabe mit langem Ort“: eine vor der Grenze
/// gespeicherte Ausgabe kommt beim erneuten Senden mit 201 zurück, nicht mit 400.
#[tokio::test]
async fn replay_vor_der_grenzpruefung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let lang = "o".repeat(600);
    let aid: i64 = sqlx::query_scalar(
        "INSERT INTO verpflegung_ausgabe \
            (einsatz_id, zeitfenster_id, zeitpunkt_at, menge, ort, erfasst_von_id, client_id) \
         VALUES (?, ?, '2026-09-24 10:10:00', 40, ?, 1, 'alt-1') RETURNING id",
    )
    .bind(e)
    .bind(zid)
    .bind(&lang)
    .fetch_one(&pool)
    .await
    .unwrap();
    let wieder = ausgabe(
        &app,
        &admin,
        e,
        zid,
        &serde_json::json!({ "menge": 40, "ort": lang, "client_id": "alt-1" }).to_string(),
    )
    .await;
    assert_eq!(wieder["ausgabe_id"], aid);
    assert_eq!(
        wieder["zeitfenster"]["ausgaben"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        wieder["zeitfenster"]["ausgaben"][0]["ort"]
            .as_str()
            .unwrap()
            .len(),
        600,
        "Bestand über der Grenze bleibt lesbar"
    );
}

// ── Verpflegungsstellen (LLH-1040) ──────────────────────────────────────────────────────────

/// Legt eine Stelle an (201) und liefert die Antwort.
async fn stelle_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> Value {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("{}/stellen", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Stelle: {json:?}");
    json
}

/// Eine Ausgabestelle mit dieser Bezeichnung; liefert die Kennung.
async fn stelle(app: &axum::Router, cookie: &str, einsatz: i64, bezeichnung: &str) -> i64 {
    let body = serde_json::json!({ "bezeichnung": bezeichnung, "art": "ausgabestelle" });
    stelle_anlegen(app, cookie, einsatz, &body.to_string()).await["id"]
        .as_i64()
        .unwrap()
}

async fn stelle_status(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    sid: i64,
    status: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("{}/stellen/{sid}/status", pfad(einsatz)),
        cookie,
        Some(&format!(r#"{{"status":"{status}"}}"#)),
    )
    .await
}

async fn stelle_patch(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    sid: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await
}

async fn stelle_storno(app: &axum::Router, cookie: &str, einsatz: i64, sid: i64) -> StatusCode {
    anfrage(
        app,
        "DELETE",
        &format!("{}/stellen/{sid}", pfad(einsatz)),
        cookie,
        None,
    )
    .await
    .0
}

/// „Mittag“ mit diesen Stellen.
fn mittag_an(stelle_ids: &[i64]) -> String {
    let mut body: Value = serde_json::from_str(MITTAG).unwrap();
    body["stelle_ids"] = serde_json::json!(stelle_ids);
    body.to_string()
}

async fn zf_patch(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    zid: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("{}/zeitfenster/{zid}", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await
}

async fn uebersicht(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (s, u) = anfrage(app, "GET", &pfad(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{u:?}");
    u
}

fn ids(v: &Value) -> Vec<i64> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_i64().unwrap())
        .collect()
}

/// Die Felder einer Stelle in der Antwort: keine Benutzerkennung (Spec `funktionsansichten`).
const STELLEN_FELDER: [&str; 11] = [
    "id",
    "bezeichnung",
    "art",
    "standort",
    "lat",
    "lon",
    "abschnitt_id",
    "status",
    "aufgeloest_at",
    "angelegt_at",
    // LLH-1048 Teil II: nur, ob ein Gerät gekoppelt ist, ohne Kopplung und Bezeichnung.
    "geraet_gekoppelt",
];

fn nur_erlaubte_felder(stelle: &Value) {
    for k in stelle.as_object().unwrap().keys() {
        assert!(
            STELLEN_FELDER.contains(&k.as_str()),
            "Feld {k:?} gehört nicht in die Stelle: {stelle:?}"
        );
    }
}

/// Spec „Stelle anlegen“, „Stelle in Betrieb nehmen“, „Stelle auflösen“, „Aufgelöste Stelle
/// bearbeiten“, „Geplante Stelle stornieren“: ETB nur bei Inbetriebnahme und Auflösung.
#[tokio::test]
async fn stelle_anlegen_in_betrieb_nehmen_aufloesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let s = stelle_anlegen(
        &app,
        &admin,
        e,
        r#"{"bezeichnung":"  Feldküche BR Sportplatz ","art":"feldkueche","standort":"Am Sportplatz 2","lat":52.37,"lon":9.73}"#,
    )
    .await;
    nur_erlaubte_felder(&s);
    assert_eq!(s["bezeichnung"], "Feldküche BR Sportplatz", "getrimmt");
    assert_eq!(s["art"], "feldkueche");
    assert_eq!(s["status"], "geplant");
    assert_eq!(s["standort"], "Am Sportplatz 2");
    assert_eq!(s["lat"], 52.37);
    assert!(s.get("aufgeloest_at").is_none(), "{s:?}");
    let sid = s["id"].as_i64().unwrap();
    assert!(
        verpflegungs_etb(&app, &admin, e).await.is_empty(),
        "Anlegen schreibt kein ETB"
    );

    let (st, g) = stelle_patch(&app, &admin, e, sid, r#"{"art":"ausgabestelle"}"#).await;
    assert_eq!(st, StatusCode::OK, "{g:?}");
    assert_eq!(g["art"], "ausgabestelle");
    let (st, g) = stelle_patch(&app, &admin, e, sid, r#"{"art":"feldkueche"}"#).await;
    assert_eq!(st, StatusCode::OK, "{g:?}");
    assert!(
        verpflegungs_etb(&app, &admin, e).await.is_empty(),
        "Ändern schreibt kein ETB"
    );

    let (st, a) = stelle_status(&app, &admin, e, sid, "aktiv").await;
    assert_eq!(st, StatusCode::OK, "{a:?}");
    assert_eq!(a["status"], "aktiv");
    assert!(a.get("aufgeloest_at").is_none());
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await,
        vec!["Verpflegungsstelle ‚Feldküche BR Sportplatz‘ (Feldküche) in Betrieb genommen."]
    );

    let (st, a) = stelle_status(&app, &admin, e, sid, "aufgeloest").await;
    assert_eq!(st, StatusCode::OK, "{a:?}");
    assert_eq!(a["status"], "aufgeloest");
    assert!(a["aufgeloest_at"].is_string(), "{a:?}");
    let etb = verpflegungs_etb(&app, &admin, e).await;
    assert_eq!(etb.len(), 2, "{etb:?}");
    assert_eq!(
        etb[1],
        "Verpflegungsstelle ‚Feldküche BR Sportplatz‘ (Feldküche) aufgelöst."
    );

    // Entscheid: eine aufgelöste Stelle bleibt bearbeitbar (Bezeichnung, Standort samt
    // Koordinate), ohne ETB; der Status bleibt endgültig.
    let (st, g) = stelle_patch(
        &app,
        &admin,
        e,
        sid,
        r#"{"bezeichnung":"Feldküche Sportplatz","standort":"Am Sportplatz 4","lat":52.38,"lon":9.74}"#,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{g:?}");
    assert_eq!(g["bezeichnung"], "Feldküche Sportplatz");
    assert_eq!(g["standort"], "Am Sportplatz 4");
    assert_eq!(g["lon"], 9.74);
    assert_eq!(g["status"], "aufgeloest");
    let (st, g) = stelle_patch(
        &app,
        &admin,
        e,
        sid,
        r#"{"standort":null,"lat":null,"lon":null}"#,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{g:?}");
    assert!(
        g.get("standort").is_none() && g.get("lat").is_none(),
        "{g:?}"
    );
    let (st, _) = stelle_status(&app, &admin, e, sid, "aktiv").await;
    assert_eq!(
        st,
        StatusCode::UNPROCESSABLE_ENTITY,
        "aufgelöst ist endgültig"
    );
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), 2);

    // Storno einer geplanten Stelle: 204, ohne ETB, aus der Übersicht verschwunden.
    let zweite = stelle(&app, &admin, e, "Zuführung Deich").await;
    assert_eq!(
        stelle_storno(&app, &admin, e, zweite).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), 2);
    let u = uebersicht(&app, &admin, e).await;
    let stellen = u["stellen"].as_array().unwrap();
    assert_eq!(stellen.len(), 1, "{u:?}");
    assert_eq!(stellen[0]["id"], sid);
    nur_erlaubte_felder(&stellen[0]);
}

/// Spec „Stelle eines anderen Einsatzes“: 404 auf jedem Schreibweg.
#[tokio::test]
async fn stelle_fremder_einsatz_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen_mit(&app, &admin, "Zweiter Einsatz").await;
    let fremd = stelle(&app, &admin, e1, "Ausgabe Turnhalle Nord").await;

    for sid in [fremd, 999_999] {
        let (s, _) = stelle_patch(&app, &admin, e2, sid, r#"{"bezeichnung":"Neu"}"#).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "PATCH {sid}");
        let (s, _) = stelle_status(&app, &admin, e2, sid, "aktiv").await;
        assert_eq!(s, StatusCode::NOT_FOUND, "Status {sid}");
        assert_eq!(
            stelle_storno(&app, &admin, e2, sid).await,
            StatusCode::NOT_FOUND,
            "DELETE {sid}"
        );
    }
    let u = uebersicht(&app, &admin, e1).await;
    assert_eq!(u["stellen"][0]["status"], "geplant", "unberührt");
    assert_eq!(u["stellen"][0]["bezeichnung"], "Ausgabe Turnhalle Nord");
    let u = uebersicht(&app, &admin, e2).await;
    assert_eq!(u["stellen"].as_array().unwrap().len(), 0);
}

/// Statuscodes der Stellenrouten: 400 je Feld, 201 an der Grenze, 422 Übergang und Kontext,
/// 409 doppelte Bezeichnung und stornierte Stelle.
#[tokio::test]
async fn stelle_statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let url = format!("{}/stellen", pfad(e));

    let b200 = "B".repeat(200);
    let s500 = "S".repeat(500);
    for (body, erwartet) in [
        (r#"{"bezeichnung":"X","art":"kantine"}"#.to_string(), 400),
        (r#"{"bezeichnung":"   ","art":"feldkueche"}"#.to_string(), 400),
        (
            serde_json::json!({ "bezeichnung": "B".repeat(201), "art": "feldkueche" }).to_string(),
            400,
        ),
        (
            serde_json::json!({ "bezeichnung": "X", "art": "feldkueche", "standort": "S".repeat(501) })
                .to_string(),
            400,
        ),
        (
            r#"{"bezeichnung":"X","art":"feldkueche","lat":52.3}"#.to_string(),
            422,
        ),
        (
            r#"{"bezeichnung":"X","art":"feldkueche","abschnitt_id":999999}"#.to_string(),
            404,
        ),
        (
            serde_json::json!({ "bezeichnung": b200, "art": "zufuehrung", "standort": s500 })
                .to_string(),
            201,
        ),
        (
            serde_json::json!({ "bezeichnung": format!(" {b200} "), "art": "feldkueche" })
                .to_string(),
            409,
        ),
    ] {
        let (s, j) = anfrage(&app, "POST", &url, &admin, Some(&body)).await;
        assert_eq!(s.as_u16(), erwartet, "{body}: {j:?}");
    }
    let u = uebersicht(&app, &admin, e).await;
    assert_eq!(
        u["stellen"].as_array().unwrap().len(),
        1,
        "nur die an der Grenze"
    );
    let sid = u["stellen"][0]["id"].as_i64().unwrap();

    // PATCH: dieselben Grenzen, 400 vor jedem 422.
    for (body, erwartet) in [
        (
            serde_json::json!({ "bezeichnung": "B".repeat(201) }).to_string(),
            400,
        ),
        (
            serde_json::json!({ "standort": "S".repeat(501) }).to_string(),
            400,
        ),
        (r#"{"bezeichnung":""}"#.to_string(), 400),
        (r#"{"art":"kantine"}"#.to_string(), 400),
        (r#"{"lon":9.7}"#.to_string(), 422),
        (r#"{"abschnitt_id":999999}"#.to_string(), 404),
    ] {
        let (s, j) = stelle_patch(&app, &admin, e, sid, &body).await;
        assert_eq!(s.as_u16(), erwartet, "PATCH {body}: {j:?}");
    }

    // Status: unbekannt 400, unzulässiger Übergang 422.
    let (s, _) = stelle_status(&app, &admin, e, sid, "in_betrieb").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = stelle_status(&app, &admin, e, sid, "geplant").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "geplant → geplant");
    let (s, _) = stelle_status(&app, &admin, e, sid, "aktiv").await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = stelle_status(&app, &admin, e, sid, "geplant").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "aktiv → geplant");
    assert_eq!(
        stelle_storno(&app, &admin, e, sid).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        "aktive Stelle wird aufgelöst, nicht storniert"
    );

    // Stornierte Stelle: 409 auf jedem Schreibweg.
    let weg = stelle(&app, &admin, e, "Zuführung Deich").await;
    assert_eq!(
        stelle_storno(&app, &admin, e, weg).await,
        StatusCode::NO_CONTENT
    );
    let (s, _) = stelle_patch(&app, &admin, e, weg, r#"{"bezeichnung":"Neu"}"#).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = stelle_status(&app, &admin, e, weg, "aktiv").await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        stelle_storno(&app, &admin, e, weg).await,
        StatusCode::CONFLICT
    );
}

/// Spec „Beobachter plant keine Stelle“: liest die Stellen, schreibt keine.
#[tokio::test]
async fn beobachter_plant_keine_stelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let u = uebersicht(&app, &beob_cookie, e).await;
    assert_eq!(u["stellen"][0]["id"], sid);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &beob_cookie,
        Some(FELDKUECHE),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "anlegen");
    let (s, _) = stelle_patch(&app, &beob_cookie, e, sid, r#"{"bezeichnung":"Neu"}"#).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "ändern");
    let (s, _) = stelle_status(&app, &beob_cookie, e, sid, "aktiv").await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Status");
    assert_eq!(
        stelle_storno(&app, &beob_cookie, e, sid).await,
        StatusCode::FORBIDDEN,
        "stornieren"
    );
    let u = uebersicht(&app, &admin, e).await;
    assert_eq!(u["stellen"][0]["status"], "geplant");
    assert_eq!(u["stellen"].as_array().unwrap().len(), 1);
}

/// Zählt die anstehenden `verpflegung`-Ereignisse am Abo und leert es.
fn verpflegung_ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>,
) -> usize {
    let mut n = 0;
    while let Ok(m) = rx.try_recv() {
        if m.event == lifeline_hub::live::LiveEvent::Verpflegung {
            n += 1;
        }
    }
    n
}

/// Spec „Live-Verteilung“: jeder Schreibweg einer Stelle verteilt genau ein `verpflegung`, ein
/// Leerlauf keines; nur Leser mit Modulrecht bekommen es, die Nutzlast trägt keine Inhalte.
#[tokio::test]
async fn live_ereignis_bei_stellen() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(e);

    let sid = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    assert_eq!(verpflegung_ereignisse(&mut rx), 1, "anlegen");
    let (s, _) = stelle_patch(&app, &admin, e, sid, r#"{"art":"feldkueche"}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(verpflegung_ereignisse(&mut rx), 1, "ändern");
    let (s, _) = stelle_patch(&app, &admin, e, sid, r#"{"art":"feldkueche"}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(verpflegung_ereignisse(&mut rx), 0, "Leerlauf");
    let (s, _) = stelle_status(&app, &admin, e, sid, "aktiv").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(verpflegung_ereignisse(&mut rx), 1, "Status");
    let weg = stelle(&app, &admin, e, "Zuführung Deich").await;
    verpflegung_ereignisse(&mut rx);
    assert_eq!(
        stelle_storno(&app, &admin, e, weg).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(verpflegung_ereignisse(&mut rx), 1, "stornieren");

    // Nur Leser mit Modulrecht (Muster `live_ereignis_nur_an_leser_mit_modulrecht`).
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, e, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    override_setzen(&app, &admin, e, true, Some("fuehrungskraft")).await;
    let feed_gustav = live_oeffnen(&app, &gustav, e).await;
    let feed_frieda = live_oeffnen(&app, &frieda, e).await;

    stelle_anlegen(
        &app,
        &admin,
        e,
        r#"{"bezeichnung":"Kanarienhof","art":"zufuehrung","standort":"Kanarienweg 4711"}"#,
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{"name":"Muster","vorname":"Max"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let bei_gustav = sse_anfang_lesen(feed_gustav.into_body(), 400).await;
    let bei_frieda = sse_anfang_lesen(feed_frieda.into_body(), 400).await;
    assert!(bei_gustav.contains("event: verpflegung"), "{bei_gustav:?}");
    assert!(bei_frieda.contains("event: person"), "{bei_frieda:?}");
    assert!(!bei_frieda.contains("event: verpflegung"), "{bei_frieda:?}");
    for kanarienvogel in ["Kanarien", "4711", "zufuehrung"] {
        assert!(
            bei_gustav
                .lines()
                .filter(|z| z.starts_with("data:"))
                .all(|z| !z.contains(kanarienvogel)),
            "{kanarienvogel:?} gehört nicht in den Broadcast: {bei_gustav:?}"
        );
    }
}

/// Spec „Verpflegungsart eines Zeitfensters“: anlegen, ändern, mit `null` leeren; unbekannt 400.
#[tokio::test]
async fn verpflegungsart_anlegen_aendern_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut body: Value = serde_json::from_str(MITTAG).unwrap();
    body["verpflegungsart"] = "warm".into();
    let zid = zeitfenster(&app, &admin, e, &body.to_string()).await;
    let u = uebersicht(&app, &admin, e).await;
    assert_eq!(u["zeitfenster"][0]["verpflegungsart"], "warm");

    let (s, z) = zf_patch(&app, &admin, e, zid, r#"{"verpflegungsart":"getraenke"}"#).await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert_eq!(z["verpflegungsart"], "getraenke");
    let (s, z) = zf_patch(&app, &admin, e, zid, r#"{"bedarf_betreute":71}"#).await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert_eq!(z["verpflegungsart"], "getraenke", "fehlt = bleibt");
    let (s, z) = zf_patch(&app, &admin, e, zid, r#"{"verpflegungsart":null}"#).await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert!(z.get("verpflegungsart").is_none(), "geleert: {z:?}");

    let (s, _) = zf_patch(&app, &admin, e, zid, r#"{"verpflegungsart":"lauwarm"}"#).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    body["verpflegungsart"] = "lauwarm".into();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster", pfad(e)),
        &admin,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let etb = verpflegungs_etb(&app, &admin, e).await;
    assert!(
        etb[0].ends_with("davon 0 Sonderkost; warm.") || etb[0].ends_with("; warm."),
        "{etb:?}"
    );
    assert!(
        etb.iter().any(|t| t.contains("Art Getränke (vorher warm)")),
        "{etb:?}"
    );
    assert!(
        etb.iter()
            .any(|t| t.contains("Art ohne Angabe (vorher Getränke)")),
        "{etb:?}"
    );
}

/// Spec „Zeitfenster mehreren Stellen zuordnen“, „Zuordnung ersetzen“, „Zuordnung leeren“.
#[tokio::test]
async fn zuordnung_setzen_ersetzen_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    let sport = stelle(&app, &admin, e, "Feldküche BR Sportplatz").await;
    let deich = stelle(&app, &admin, e, "Zuführung Deich").await;

    let zid = zeitfenster(&app, &admin, e, &mittag_an(&[sport, nord, sport])).await;
    let u = uebersicht(&app, &admin, e).await;
    let mut gesetzt = ids(&u["zeitfenster"][0]["stelle_ids"]);
    gesetzt.sort_unstable();
    let mut erwartet = vec![nord, sport];
    erwartet.sort_unstable();
    assert_eq!(gesetzt, erwartet, "entdoppelt");
    let je: Vec<Option<i64>> = u["zeitfenster"][0]["je_stelle"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["stelle_id"].as_i64())
        .collect();
    assert_eq!(je.len(), 2, "zugeordnete Stellen auch mit 0: {u:?}");

    let (s, z) = zf_patch(
        &app,
        &admin,
        e,
        zid,
        &format!(r#"{{"stelle_ids":[{deich}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert_eq!(ids(&z["stelle_ids"]), vec![deich]);

    let (s, z) = zf_patch(&app, &admin, e, zid, r#"{"stelle_ids":[]}"#).await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert!(ids(&z["stelle_ids"]).is_empty());
    assert!(z["je_stelle"].as_array().unwrap().is_empty());

    let (s, z) = zf_patch(&app, &admin, e, zid, r#"{"bedarf_betreute":71}"#).await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert!(ids(&z["stelle_ids"]).is_empty(), "fehlt = bleibt");
}

/// Statuscodes der Zuordnung: 400 vor jeder Abfrage, 422 für fremde, unbekannte, stornierte und
/// neu hinzukommende aufgelöste Stellen; eine schon zugeordnete aufgelöste bleibt.
#[tokio::test]
async fn zuordnung_statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Zweiter Einsatz").await;
    let fremd = stelle(&app, &admin, anderer, "Fremde Stelle").await;
    let nord = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    let alt = stelle(&app, &admin, e, "Alte Ausgabe").await;
    let weg = stelle(&app, &admin, e, "Zuführung Deich").await;
    assert_eq!(
        stelle_storno(&app, &admin, e, weg).await,
        StatusCode::NO_CONTENT
    );
    let zid = zeitfenster(&app, &admin, e, &mittag_an(&[alt])).await;
    assert_eq!(
        stelle_status(&app, &admin, e, alt, "aufgeloest").await.0,
        StatusCode::OK
    );
    let spaet = stelle(&app, &admin, e, "Späte Ausgabe").await;
    assert_eq!(
        stelle_status(&app, &admin, e, spaet, "aufgeloest").await.0,
        StatusCode::OK
    );

    // 21 Einträge: 400, auch wenn es die Kennungen nicht gibt, das Zeitfenster nicht gibt oder
    // sie doppelt sind (die Grenze zählt vor dem Entdoppeln).
    let einundzwanzig: Vec<i64> = (1_000_000..1_000_021).collect();
    let doppelt: Vec<i64> = std::iter::repeat_n(nord, 21).collect();
    for liste in [&einundzwanzig, &doppelt] {
        let (s, _) = anfrage(
            &app,
            "POST",
            &format!("{}/zeitfenster", pfad(e)),
            &admin,
            Some(&mittag_an(liste)),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "anlegen");
        let body = serde_json::json!({ "stelle_ids": liste }).to_string();
        let (s, _) = zf_patch(&app, &admin, e, zid, &body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "ändern");
        let (s, _) = zf_patch(&app, &admin, e, 999_999, &body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "vor dem 404 des Zeitfensters");
    }
    // Genau 20 verschiedene, alle unbekannt: über die Grenze hinaus, also 422.
    let zwanzig: Vec<i64> = (1_000_000..1_000_020).collect();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster", pfad(e)),
        &admin,
        Some(&mittag_an(&zwanzig)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "20 an der Grenze");

    for (sid, was) in [
        (fremd, "fremd"),
        (999_999, "unbekannt"),
        (weg, "storniert"),
        (spaet, "neu aufgelöst"),
    ] {
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("{}/zeitfenster", pfad(e)),
            &admin,
            Some(&mittag_an(&[nord, sid])),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "anlegen {was}: {j:?}");
        let (s, j) = zf_patch(
            &app,
            &admin,
            e,
            zid,
            &format!(r#"{{"stelle_ids":[{alt},{sid}]}}"#),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "ändern {was}: {j:?}");
    }
    let u = uebersicht(&app, &admin, e).await;
    assert_eq!(
        u["zeitfenster"].as_array().unwrap().len(),
        1,
        "nichts angelegt"
    );
    assert_eq!(
        ids(&u["zeitfenster"][0]["stelle_ids"]),
        vec![alt],
        "unverändert"
    );

    // Die schon zugeordnete aufgelöste Stelle bleibt, wenn eine weitere dazukommt.
    let (s, z) = zf_patch(
        &app,
        &admin,
        e,
        zid,
        &format!(r#"{{"stelle_ids":[{alt},{nord}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    let mut jetzt = ids(&z["stelle_ids"]);
    jetzt.sort_unstable();
    let mut erwartet = vec![alt, nord];
    erwartet.sort_unstable();
    assert_eq!(jetzt, erwartet);
}

/// Spec „Gleiche Zuordnung“: dieselbe Menge in anderer Reihenfolge ist ein Leerlauf — kein ETB,
/// kein Live-Ereignis.
#[tokio::test]
async fn zuordnung_leerlauf_ohne_etb_und_live() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    let b = stelle(&app, &admin, e, "Feldküche BR Sportplatz").await;
    let zid = zeitfenster(&app, &admin, e, &mittag_an(&[a, b])).await;
    let etb_vorher = verpflegungs_etb(&app, &admin, e).await.len();
    let mut rx = live.abonniere(e);

    let (s, z) = zf_patch(
        &app,
        &admin,
        e,
        zid,
        &format!(r#"{{"stelle_ids":[{b},{a},{b}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert_eq!(verpflegung_ereignisse(&mut rx), 0);
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), etb_vorher);

    // Gegenprobe: eine echte Änderung verteilt.
    let (s, _) = zf_patch(&app, &admin, e, zid, &format!(r#"{{"stelle_ids":[{a}]}}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(verpflegung_ereignisse(&mut rx), 1);
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await.len(),
        etb_vorher + 1
    );
}

/// Spec „Bestand ohne Stelle“: ein Zeitfenster ohne Zuordnung und eine Ausgabe ohne Stelle
/// sehen aus wie vor der Änderung, nur mit zwei leeren Listen.
#[tokio::test]
async fn bestand_ohne_stelle_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let a = ausgabe(&app, &admin, e, zid, r#"{"menge":120,"ort":"Deich"}"#).await;
    let z = &a["zeitfenster"];
    let mut felder: Vec<&str> = z.as_object().unwrap().keys().map(String::as_str).collect();
    felder.sort_unstable();
    assert_eq!(
        felder,
        vec![
            "angelegt_at",
            "ausgaben",
            "ausgegeben",
            "bedarf",
            "bezeichnung",
            "bis_at",
            "einsatz_id",
            "fehlmenge",
            "id",
            "je_stelle",
            "stelle_ids",
            // LLH-1048: nur für ein an eine Stelle gebundenes Gerät gefüllt.
            "verpflegt_anderswo",
            "von_at",
        ]
    );
    assert!(z["verpflegt_anderswo"].as_array().unwrap().is_empty());
    assert!(z["je_stelle"].as_array().unwrap().is_empty());
    assert!(z["stelle_ids"].as_array().unwrap().is_empty());
    assert_eq!(z["ausgegeben"]["gesamt"], 120);
    assert_eq!(z["fehlmenge"]["gesamt"], 130);
    assert!(z["ausgaben"][0].get("verpflegungsstelle_id").is_none());
    assert_eq!(z["ausgaben"][0]["ort"], "Deich");
    let u = uebersicht(&app, &admin, e).await;
    assert_eq!(&u["zeitfenster"][0], z);
    assert!(u["stellen"].as_array().unwrap().is_empty());
}

/// Spec „Einsatztagebuch“: Art und Stellen beim Anlegen und als „jetzt (vorher …)“.
#[tokio::test]
async fn zeitfenster_etb_nennt_stellen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    let sport = stelle(&app, &admin, e, "Feldküche BR Sportplatz").await;
    let mut body: Value = serde_json::from_str(&mittag_an(&[sport, nord])).unwrap();
    body["verpflegungsart"] = "warm".into();
    let zid = zeitfenster(&app, &admin, e, &body.to_string()).await;
    let (s, _) = zf_patch(&app, &admin, e, zid, r#"{"stelle_ids":[]}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await,
        vec![
            "Verpflegung ‚Mittag‘ 241200sep26–1330 angelegt: Bedarf 250 EP (180 Kräfte, 70 Betreute); warm; an ‚Ausgabe Turnhalle Nord‘, ‚Feldküche BR Sportplatz‘.",
            "Verpflegung ‚Mittag‘ 241200sep26–1330 (Bedarf 250 EP) geändert: Stellen keine (vorher ‚Ausgabe Turnhalle Nord‘, ‚Feldküche BR Sportplatz‘).",
        ]
    );
}

/// Spec „Ausgabe an einer Verpflegungsstelle“: fremd, unbekannt und storniert 422; aufgelöst mit
/// Zeitpunkt danach 409, davor 201; geplant 201; nicht zugeordnet 201. Das Ist je Stelle folgt.
#[tokio::test]
async fn ausgabe_an_stelle_statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Zweiter Einsatz").await;
    let fremd = stelle(&app, &admin, anderer, "Fremde Stelle").await;
    let nord = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    let sport = stelle(&app, &admin, e, "Feldküche BR Sportplatz").await;
    let weg = stelle(&app, &admin, e, "Zuführung Deich").await;
    let frei = stelle(&app, &admin, e, "Nicht zugeordnet").await;
    assert_eq!(
        stelle_storno(&app, &admin, e, weg).await,
        StatusCode::NO_CONTENT
    );
    let zid = zeitfenster(&app, &admin, e, &mittag_an(&[nord, sport])).await;
    assert_eq!(
        stelle_status(&app, &admin, e, sport, "aktiv").await.0,
        StatusCode::OK
    );
    assert_eq!(
        stelle_status(&app, &admin, e, sport, "aufgeloest").await.0,
        StatusCode::OK
    );
    let url = format!("{}/zeitfenster/{zid}/ausgaben", pfad(e));
    let an = |sid: i64, menge: i64, zeitpunkt: Option<&str>| {
        let mut b = serde_json::json!({ "menge": menge, "verpflegungsstelle_id": sid });
        if let Some(z) = zeitpunkt {
            b["zeitpunkt_at"] = z.into();
        }
        b.to_string()
    };

    for (sid, was) in [(fremd, "fremd"), (999_999, "unbekannt"), (weg, "storniert")] {
        let (s, j) = anfrage(&app, "POST", &url, &admin, Some(&an(sid, 5, None))).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{was}: {j:?}");
    }
    let (s, j) = anfrage(&app, "POST", &url, &admin, Some(&an(sport, 5, None))).await;
    assert_eq!(s, StatusCode::CONFLICT, "aufgelöst, Zeitpunkt jetzt: {j:?}");
    let (s, j) = anfrage(
        &app,
        "POST",
        &url,
        &admin,
        Some(&an(sport, 80, Some("2020-01-01T10:00:00Z"))),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "aufgelöst, Zeitpunkt davor: {j:?}");
    // geplant (nie in Betrieb genommen) nimmt an, ebenso eine nicht zugeordnete Stelle.
    ausgabe(&app, &admin, e, zid, &an(nord, 100, None)).await;
    ausgabe(&app, &admin, e, zid, &an(frei, 7, None)).await;
    let a = ausgabe(&app, &admin, e, zid, r#"{"menge":3}"#).await;
    let z = &a["zeitfenster"];
    assert_eq!(z["ausgegeben"]["gesamt"], 190);
    let je: Vec<(Option<i64>, i64)> = z["je_stelle"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            (
                x["stelle_id"].as_i64(),
                x["ausgegeben"]["gesamt"].as_i64().unwrap(),
            )
        })
        .collect();
    // Zugeordnete nach Bezeichnung, dann nicht zugeordnete mit Ausgabe, „ohne Stelle“ zuletzt.
    assert_eq!(
        je,
        vec![
            (Some(nord), 100),
            (Some(sport), 80),
            (Some(frei), 7),
            (None, 3)
        ]
    );
    let mit_stelle = z["ausgaben"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["verpflegungsstelle_id"].as_i64() == Some(nord))
        .count();
    assert_eq!(mit_stelle, 1);
}

/// Grenze der Auflösung (Spec „wenn ihr Zeitpunkt nicht vor der Auflösung liegt“): genau der
/// Zeitpunkt der Auflösung ist 409, eine Sekunde davor 201, deutlich danach 409 — deterministisch
/// über `aufgeloest_at` aus der Antwort der Statusroute, nicht über die Serveruhr.
#[tokio::test]
async fn ausgabe_an_stelle_grenze_der_aufloesung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Feldküche BR Sportplatz").await;
    let zid = zeitfenster(&app, &admin, e, &mittag_an(&[sid])).await;
    let (s, antwort) = stelle_status(&app, &admin, e, sid, "aufgeloest").await;
    assert_eq!(s, StatusCode::OK);
    let auf = chrono::NaiveDateTime::parse_from_str(
        antwort["aufgeloest_at"].as_str().unwrap(),
        "%Y-%m-%d %H:%M:%S",
    )
    .unwrap();
    let url = format!("{}/zeitfenster/{zid}/ausgaben", pfad(e));
    let an = |t: chrono::NaiveDateTime| {
        serde_json::json!({
            "menge": 5,
            "verpflegungsstelle_id": sid,
            "zeitpunkt_at": t.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        })
        .to_string()
    };
    for (t, erwartet, was) in [
        (auf, StatusCode::CONFLICT, "genau die Auflösung"),
        (
            auf - chrono::Duration::seconds(1),
            StatusCode::CREATED,
            "eine Sekunde davor",
        ),
        (
            auf + chrono::Duration::minutes(5),
            StatusCode::CONFLICT,
            "deutlich danach",
        ),
    ] {
        let (s, j) = anfrage(&app, "POST", &url, &admin, Some(&an(t))).await;
        assert_eq!(s, erwartet, "{was}: {j:?}");
    }
}

/// Spec „Replay vor der Zustandsprüfung“: Eine Ausgabe, die vor der Auflösung gebucht wurde,
/// kommt beim erneuten Senden mit derselben `client_id` als 201 zurück, ohne Live-Ereignis.
#[tokio::test]
async fn replay_nach_aufloesen_der_stelle() {
    use lifeline_hub::live::LiveEvent;
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Ausgabe Turnhalle Nord").await;
    let zid = zeitfenster(&app, &admin, e, &mittag_an(&[sid])).await;
    let body = serde_json::json!({ "menge": 40, "verpflegungsstelle_id": sid, "client_id": "r1" })
        .to_string();
    let erst = ausgabe(&app, &admin, e, zid, &body).await;
    assert_eq!(
        stelle_status(&app, &admin, e, sid, "aufgeloest").await.0,
        StatusCode::OK
    );

    let mut rx = live.abonniere(e);
    let wieder = ausgabe(&app, &admin, e, zid, &body).await;
    assert_eq!(wieder["ausgabe_id"], erst["ausgabe_id"]);
    assert_eq!(wieder["zeitfenster"]["ausgegeben"]["gesamt"], 40);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(150), rx.recv())
            .await
            .map(|n| n.unwrap().event != LiveEvent::Verpflegung)
            .unwrap_or(true),
        "ein Replay verteilt nichts"
    );
    // Gegenprobe: eine neue Ausgabe an der aufgelösten Stelle ist 409.
    let neu = serde_json::json!({ "menge": 40, "verpflegungsstelle_id": sid, "client_id": "r2" })
        .to_string();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster/{zid}/ausgaben", pfad(e)),
        &admin,
        Some(&neu),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

// ── Empfänger (LLH-1055) ────────────────────────────────────────────────────────────────────

/// Bildet eine Einheit mit beliebigem Body; liefert ihre id.
async fn einheit_mit(app: &axum::Router, cookie: &str, einsatz: i64, body: &Value) -> i64 {
    let (s, j) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Einheit: {j:?}");
    j["id"].as_i64().unwrap()
}

async fn abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt: {j:?}");
    j["id"].as_i64().unwrap()
}

/// Ordnet eine disponierte Kraft der Einheit zu.
async fn kraft_zuordnen(app: &axum::Router, cookie: &str, einsatz: i64, einheit: i64, ep: i64) {
    let (s, j) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/personal/{ep}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "Kraft zuordnen: {j:?}");
}

/// Löst eine Einheit auf (mit Spur bleibt sie stehen, ohne wird sie gelöscht).
async fn einheit_aufloesen(app: &axum::Router, cookie: &str, einsatz: i64, einheit: i64) {
    let (s, j) = anfrage(
        app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "Einheit auflösen: {j:?}");
}

/// Modul-Override für ein beliebiges Modul des Einsatzes.
async fn modul_override(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    modul: &str,
    sichtbar: bool,
    rolle: Option<&str>,
) {
    let rolle = rolle.map_or("null".to_string(), |r| format!(r#""{r}""#));
    let (s, j) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        cookie,
        Some(&format!(
            r#"{{"sichtbar":{sichtbar},"benoetigte_rolle":{rolle}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override {modul}: {j:?}");
}

/// Spec „Abholung durch eine Einheit“, „Zuführung an einen Abschnitt“: 201, die Ausgabe trägt
/// die Kennung ihres Empfängers und zählt in die ausgegebene Menge; kein ETB-Eintrag.
#[tokio::test]
async fn ausgabe_an_einheit_und_abschnitt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let gruppe = einheit_bilden(&app, &admin, e, "2. Gruppe").await;
    let deich = abschnitt(&app, &admin, e, "Deich").await;
    let etb_vorher = etb_eintraege(&app, &admin, e).await.len();

    let a = ausgabe(
        &app,
        &admin,
        e,
        zid,
        &serde_json::json!({ "menge": 9, "einheit_id": gruppe }).to_string(),
    )
    .await;
    let aid = a["ausgabe_id"].as_i64().unwrap();
    let z = ausgabe(
        &app,
        &admin,
        e,
        zid,
        &serde_json::json!({ "menge": 40, "abschnitt_id": deich }).to_string(),
    )
    .await;
    let zid_ausgabe = z["ausgabe_id"].as_i64().unwrap();
    assert_eq!(z["zeitfenster"]["ausgegeben"]["gesamt"], 49);
    let ausgaben = z["zeitfenster"]["ausgaben"].as_array().unwrap();
    let von = |id: i64| ausgaben.iter().find(|x| x["id"] == id).unwrap().clone();
    assert_eq!(von(aid)["einheit_id"], gruppe);
    assert!(!von(aid).as_object().unwrap().contains_key("abschnitt_id"));
    assert_eq!(von(zid_ausgabe)["abschnitt_id"], deich);
    assert!(!von(zid_ausgabe)
        .as_object()
        .unwrap()
        .contains_key("einheit_id"));
    assert_eq!(
        etb_eintraege(&app, &admin, e).await.len(),
        etb_vorher,
        "eine Ausgabe schreibt auch mit Empfänger kein ETB"
    );
}

/// Spec „Zwei Empfänger“, „Menge und zwei Empfänger fehlerhaft“, „Einheit eines anderen
/// Einsatzes“, „Abschnitt eines anderen Einsatzes“, „Aufgelöste Einheit“, „Vor der Auflösung
/// offline gebucht“ (design.md D2). Nichts Abgelehntes wird angelegt.
#[tokio::test]
async fn ausgabe_empfaenger_statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen_mit(&app, &admin, "Andere Lage").await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let url = format!("{}/zeitfenster/{zid}/ausgaben", pfad(e));
    let gruppe = einheit_bilden(&app, &admin, e, "2. Gruppe").await;
    let leer = einheit_bilden(&app, &admin, e, "Leere Gruppe").await;
    let deich = abschnitt(&app, &admin, e, "Deich").await;
    let fremde_einheit = einheit_bilden(&app, &admin, e2, "Fremde Gruppe").await;
    let fremder_abschnitt = abschnitt(&app, &admin, e2, "Fremder Abschnitt").await;
    let geloescht = einheit_bilden(&app, &admin, e, "Fehlanlage").await;
    einheit_aufloesen(&app, &admin, e, geloescht).await;

    let post = |body: Value| {
        let app = app.clone();
        let admin = admin.clone();
        let url = url.clone();
        async move { anfrage_json(&app, "POST", &url, &admin, Some(&body)).await }
    };
    for (body, erwartet, was) in [
        (
            serde_json::json!({ "menge": 9, "einheit_id": gruppe, "abschnitt_id": deich }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "zwei Empfänger",
        ),
        (
            serde_json::json!({ "menge": 0, "einheit_id": gruppe, "abschnitt_id": deich }),
            StatusCode::BAD_REQUEST,
            "zwei Empfänger mit Menge 0",
        ),
        (
            serde_json::json!({ "menge": 9, "einheit_id": fremde_einheit }),
            StatusCode::NOT_FOUND,
            "fremde Einheit",
        ),
        (
            serde_json::json!({ "menge": 9, "einheit_id": 999_999 }),
            StatusCode::NOT_FOUND,
            "unbekannte Einheit",
        ),
        (
            serde_json::json!({ "menge": 9, "abschnitt_id": fremder_abschnitt }),
            StatusCode::NOT_FOUND,
            "fremder Abschnitt",
        ),
        (
            serde_json::json!({ "menge": 9, "abschnitt_id": 999_999 }),
            StatusCode::NOT_FOUND,
            "unbekannter Abschnitt",
        ),
        (
            serde_json::json!({ "menge": 9, "einheit_id": geloescht }),
            StatusCode::NOT_FOUND,
            "gelöschte leere Einheit",
        ),
        (
            serde_json::json!({ "menge": 9, "einheit_id": "zwei" }),
            StatusCode::BAD_REQUEST,
            "falscher Typ",
        ),
    ] {
        let (s, j) = post(body).await;
        assert_eq!(s, erwartet, "{was}: {j:?}");
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(
        u["zeitfenster"][0]["ausgaben"].as_array().unwrap().len(),
        0,
        "nichts angelegt"
    );

    // Stärke 0 und ohne Eintreffen: angenommen.
    let (s, j) = post(serde_json::json!({ "menge": 3, "einheit_id": leer })).await;
    assert_eq!(s, StatusCode::CREATED, "Einheit mit Stärke 0: {j:?}");

    // Aufgelöst: die erste Ausgabe ist ihre Spur, die Einheit bleibt als aufgelöst stehen.
    let (s, _) = post(serde_json::json!({
        "menge": 9, "einheit_id": gruppe, "zeitpunkt_at": "2026-09-24T10:10:00Z"
    }))
    .await;
    assert_eq!(s, StatusCode::CREATED);
    einheit_aufloesen(&app, &admin, e, gruppe).await;
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let auf = u["empfaenger"]["einheiten"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == gruppe)
        .expect("aufgelöste Einheit mit Ausgabe steht in der Empfängerliste")["aufgeloest_at"]
        .as_str()
        .unwrap()
        .to_string();
    let auf = chrono::NaiveDateTime::parse_from_str(&auf, "%Y-%m-%d %H:%M:%S").unwrap();
    let um = |t: chrono::NaiveDateTime| {
        serde_json::json!({
            "menge": 9,
            "einheit_id": gruppe,
            "zeitpunkt_at": t.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        })
    };
    for (t, erwartet, was) in [
        (auf, StatusCode::CONFLICT, "genau die Auflösung"),
        (
            auf + chrono::Duration::minutes(10),
            StatusCode::CONFLICT,
            "aufgelöst danach",
        ),
        (
            auf - chrono::Duration::minutes(10),
            StatusCode::CREATED,
            "aufgelöst davor",
        ),
    ] {
        let (s, j) = post(um(t)).await;
        assert_eq!(s, erwartet, "{was}: {j:?}");
    }
}

/// Spec „Replay nach dem Auflösen“: Eine Ausgabe an eine Einheit, die danach aufgelöst wurde,
/// kommt mit derselben `client_id` als 201 mit der gespeicherten Ausgabe zurück, ohne
/// Live-Ereignis.
#[tokio::test]
async fn replay_mit_empfaenger_nach_aufloesen() {
    use lifeline_hub::live::LiveEvent;
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zid = zeitfenster(&app, &admin, e, MITTAG).await;
    let gruppe = einheit_bilden(&app, &admin, e, "2. Gruppe").await;
    let body =
        serde_json::json!({ "menge": 9, "einheit_id": gruppe, "client_id": "v6" }).to_string();
    let erst = ausgabe(&app, &admin, e, zid, &body).await;
    einheit_aufloesen(&app, &admin, e, gruppe).await;

    let mut rx = live.abonniere(e);
    let wieder = ausgabe(&app, &admin, e, zid, &body).await;
    assert_eq!(wieder["ausgabe_id"], erst["ausgabe_id"]);
    assert_eq!(wieder["zeitfenster"]["ausgegeben"]["gesamt"], 9);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(150), rx.recv())
            .await
            .map(|n| n.unwrap().event != LiveEvent::Verpflegung)
            .unwrap_or(true),
        "ein Replay verteilt nichts"
    );
    let neu =
        serde_json::json!({ "menge": 9, "einheit_id": gruppe, "client_id": "v7" }).to_string();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster/{zid}/ausgaben", pfad(e)),
        &admin,
        Some(&neu),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "Gegenprobe: neue Ausgabe nach der Auflösung"
    );
}

/// Spec „Keine Personenangaben“ (design.md D3): Die Empfängerliste trägt je Einheit genau die
/// Schlüssel der Projektion. Führer, Erreichbarkeit, Kommunikationsmittel, Bemerkung und
/// Mitglieder fehlen, und kein Personenname steht im Antworttext.
#[tokio::test]
async fn empfaengerliste_ohne_personenangaben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let deich = abschnitt(&app, &admin, e, "Deich").await;
    let fuehrer = stammpersonal_disponieren(&app, &admin, e, "Adalbert Zugführer").await;
    let mitglied = stammpersonal_disponieren(&app, &admin, e, "Mechthild Mitglied").await;
    let zug = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let gruppe = einheit_mit(
        &app,
        &admin,
        e,
        &serde_json::json!({
            "name": "2. Gruppe",
            "funkrufname": "Florian Hannover 2",
            "ueber_einheit_id": zug,
            "abschnitt_id": deich,
            "verbindungen": [{ "mittel": "mobil", "wert": "0171 4711815" }],
            "bemerkung": "Bemerkung Kanarienvogel",
        }),
    )
    .await;
    kraft_zuordnen(&app, &admin, e, gruppe, fuehrer).await;
    kraft_zuordnen(&app, &admin, e, gruppe, mitglied).await;
    let (s, j) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/einheiten/{gruppe}"),
        &admin,
        Some(&serde_json::json!({ "fuehrer_id": fuehrer })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Einheitsführer setzen: {j:?}");
    assert_eq!(j["fuehrer_name"], "Adalbert Zugführer", "Vorbedingung");
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten/{gruppe}/zeitachse"),
        &admin,
        Some(r#"{"art":"eintreffen","zeitpunkt_at":"2026-09-24T04:40:00Z"}"#),
    )
    .await;
    assert!(s.is_success(), "Eintreffen nachtragen: {j:?}");

    let (s, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let einheiten = u["empfaenger"]["einheiten"].as_array().unwrap();
    let g = einheiten.iter().find(|x| x["id"] == gruppe).unwrap();
    let mut schluessel: Vec<&str> = g.as_object().unwrap().keys().map(String::as_str).collect();
    schluessel.sort_unstable();
    assert_eq!(
        schluessel,
        [
            "abschnitt_id",
            "abschnitt_name",
            "eintreffen_at",
            "funkrufname",
            "id",
            "ist",
            "ist_kumuliert",
            "name",
            "ueber_einheit_id",
        ],
        "genau die Felder der Projektion (aufgeloest_at nur bei aufgelösten)"
    );
    assert_eq!(g["name"], "2. Gruppe");
    assert_eq!(g["ist"]["mannschaft"], 2);
    assert_eq!(g["eintreffen_at"], "2026-09-24 04:40:00");
    let abschnitte = u["empfaenger"]["abschnitte"].as_array().unwrap();
    assert_eq!(abschnitte.len(), 1);
    let mut schluessel: Vec<&str> = abschnitte[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    schluessel.sort_unstable();
    assert_eq!(schluessel, ["id", "name"]);
    let text = u["empfaenger"].to_string();
    for verboten in ["Adalbert", "Mechthild", "4711815", "mobil", "Kanarienvogel"] {
        assert!(!text.contains(verboten), "{verboten:?} in {text}");
    }
}

/// Spec „Leser ohne Modul Einheiten“: Wer die Verpflegung lesen darf, bekommt die Namen der
/// Einheiten in der Empfängerliste; die Einheitenliste bleibt ihm 403 (bewusste Ausnahme von D4).
#[tokio::test]
async fn empfaengerliste_ohne_modul_einheiten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    einheit_bilden(&app, &admin, e, "2. Gruppe").await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    modul_override(&app, &admin, e, "einheiten", true, Some("fuehrungskraft")).await;

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Einheitenliste bleibt verschlossen"
    );
    let (s, u) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u["empfaenger"]["einheiten"][0]["name"], "2. Gruppe");
}

/// Spec „Einheit geändert, Leser nur der Verpflegung“ und „Personal geändert, Leser nur der
/// Verpflegung“ (design.md D4): Ein Leser, der von den Kräften nur die Verpflegung sieht, bekommt
/// `einheit` und `abschnitt`, aber nicht `personal`.
#[tokio::test]
async fn live_einheit_erreicht_verpflegungsleser() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    for modul in ["einheiten", "lagekarte", "einsatzabschnitte", "personal"] {
        modul_override(&app, &admin, e, modul, true, Some("fuehrungskraft")).await;
    }
    let deich = abschnitt(&app, &admin, e, "Deich").await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/abschnitte"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Vorbedingung: keine Abschnitte");
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: Verpflegung lesbar");

    let feed_frieda = live_oeffnen(&app, &frieda, e).await;
    let feed_admin = live_oeffnen(&app, &admin, e).await;
    einheit_bilden(&app, &admin, e, "4. Gruppe").await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/abschnitte/{deich}"),
        &admin,
        Some(r#"{"name":"Deich Nord"}"#),
    )
    .await;
    assert!(s.is_success(), "Abschnitt umbenennen: {s}");
    stammpersonal_disponieren(&app, &admin, e, "Anna Kraft").await;

    let bei_frieda = sse_anfang_lesen(feed_frieda.into_body(), 400).await;
    let bei_admin = sse_anfang_lesen(feed_admin.into_body(), 400).await;
    assert!(
        bei_admin.contains("event: personal"),
        "Gegenprobe: das Personal-Ereignis wurde verteilt: {bei_admin:?}"
    );
    assert!(
        bei_frieda.contains("event: einheit"),
        "Verpflegungsleser bekommt `einheit`: {bei_frieda:?}"
    );
    assert!(
        bei_frieda.contains("event: abschnitt"),
        "Verpflegungsleser bekommt `abschnitt`: {bei_frieda:?}"
    );
    assert!(
        !bei_frieda.contains("event: personal"),
        "aber nicht `personal`: {bei_frieda:?}"
    );
}

// ── Verpflegungsplan der Organisation (LLH-1058) ────────────────────────────────────────────

const PLAN: &str = "/api/verpflegung-vorlagen";

async fn mahlzeit(app: &axum::Router, cookie: &str, body: &str) -> (StatusCode, Value) {
    anfrage(app, "POST", PLAN, cookie, Some(body)).await
}

async fn mahlzeit_patch(
    app: &axum::Router,
    cookie: &str,
    id: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(app, "PATCH", &format!("{PLAN}/{id}"), cookie, Some(body)).await
}

fn plan_namen(json: &Value) -> Vec<String> {
    json.as_array()
        .unwrap()
        .iter()
        .map(|v| v["bezeichnung"].as_str().unwrap().to_string())
        .collect()
}

/// Spec „Mahlzeit anlegen“, „Nachtverpflegung über Mitternacht“, „Einsatzkraft schreibt“:
/// Admin legt an (201, `0630` wird `06:30`), jedes Mitglied liest, ohne Admin 403.
#[tokio::test]
async fn verpflegungsplan_anlegen_lesen_und_rechte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (s, v) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":" Frühstück ","beginn":"0630","ende":"08:00","verpflegungsart":"warm"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["bezeichnung"], "Frühstück");
    assert_eq!(v["beginn"], "06:30");
    assert_eq!(v["ende"], "08:00");
    assert_eq!(v["folgetag"], false);
    assert_eq!(v["verpflegungsart"], "warm");
    assert_eq!(v["aktiv"], true);
    let fruehstueck = v["id"].as_i64().unwrap();
    let (s, v) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Nachtverpflegung","beginn":"23:00","ende":"01:00"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["folgetag"], true);
    assert!(
        !v.as_object().unwrap().contains_key("verpflegungsart"),
        "ohne Art kein Feld: {v}"
    );

    let (s, liste) = anfrage(&app, "GET", PLAN, &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(plan_namen(&liste), ["Frühstück", "Nachtverpflegung"]);

    let (s, _) = mahlzeit(
        &app,
        &erika,
        r#"{"bezeichnung":"Mittag","beginn":"12:00","ende":"13:30"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = mahlzeit_patch(&app, &erika, fruehstueck, r#"{"aktiv":false}"#).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PLAN}/{fruehstueck}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::METHOD_NOT_ALLOWED, "kein Löschen");
}

/// Spec „Unlesbare Uhrzeit“, „Ende gleich Beginn“, „Name doppelt“ und die Grenze aus
/// `eingabegrenzen`: 400, 422, 409; nichts angelegt.
#[tokio::test]
async fn verpflegungsplan_statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Mittag","beginn":"12:00","ende":"13:30"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let mittag = v["id"].as_i64().unwrap();
    let lang = "x".repeat(201);

    for (body, erwartet) in [
        (
            r#"{"bezeichnung":"   ","beginn":"06:30","ende":"08:00"}"#.to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (
            format!(r#"{{"bezeichnung":"{lang}","beginn":"06:30","ende":"08:00"}}"#),
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"Frühstück","beginn":"24:00","ende":"08:00"}"#.to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"Frühstück","beginn":"6.30 Uhr","ende":"08:00"}"#.to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"Frühstück","beginn":"06:30"}"#.to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"Frühstück","beginn":"06:30","ende":"08:00","verpflegungsart":"heiss"}"#
                .to_string(),
            StatusCode::BAD_REQUEST,
        ),
        // Ein 400 geht dem 422 vor.
        (
            format!(r#"{{"bezeichnung":"{lang}","beginn":"12:00","ende":"12:00"}}"#),
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"Frühstück","beginn":"12:00","ende":"1200"}"#.to_string(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            r#"{"bezeichnung":"mittag","beginn":"11:30","ende":"13:00"}"#.to_string(),
            StatusCode::CONFLICT,
        ),
    ] {
        let (s, v) = mahlzeit(&app, &admin, &body).await;
        assert_eq!(s, erwartet, "{body}: {v}");
    }
    for (body, erwartet) in [
        (r#"{"ende":"12:60"}"#, StatusCode::BAD_REQUEST),
        (r#"{"bezeichnung":""}"#, StatusCode::BAD_REQUEST),
        (r#"{"verpflegungsart":"heiss"}"#, StatusCode::BAD_REQUEST),
        (r#"{"ende":"12:00"}"#, StatusCode::UNPROCESSABLE_ENTITY),
    ] {
        let (s, v) = mahlzeit_patch(&app, &admin, mittag, body).await;
        assert_eq!(s, erwartet, "PATCH {body}: {v}");
    }
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("{PLAN}?nur_aktive=false"),
        &admin,
        None,
    )
    .await;
    assert_eq!(plan_namen(&liste), ["Mittag"], "nichts angelegt: {liste}");
    assert_eq!(liste[0]["ende"], "13:30", "nichts geändert");
}

/// Spec „Deaktivierte Mahlzeit“: fehlt ohne `nur_aktive=false`, erscheint mit als inaktiv, der
/// Name ist wieder frei; Art leeren mit `null`.
#[tokio::test]
async fn verpflegungsplan_deaktivieren_und_aktivieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Nachtverpflegung","beginn":"23:00","ende":"01:00","verpflegungsart":"kalt"}"#,
    )
    .await;
    let id = v["id"].as_i64().unwrap();
    let (s, v) = mahlzeit_patch(
        &app,
        &admin,
        id,
        r#"{"aktiv":false,"verpflegungsart":null}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["aktiv"], false);
    assert!(v.get("verpflegungsart").is_none(), "{v}");
    let (_, liste) = anfrage(&app, "GET", PLAN, &admin, None).await;
    assert_eq!(liste, serde_json::json!([]));
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("{PLAN}?nur_aktive=false"),
        &admin,
        None,
    )
    .await;
    assert_eq!(plan_namen(&liste), ["Nachtverpflegung"]);
    assert_eq!(liste[0]["aktiv"], false);

    let (s, _) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Nachtverpflegung","beginn":"22:30","ende":"00:30"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Name wieder frei");
    let (s, _) = mahlzeit_patch(&app, &admin, id, r#"{"aktiv":true}"#).await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "Reaktivieren gegen gleichnamige aktive"
    );
}

/// Mahlzeiten einer anderen Organisation gibt es nicht (404), die Liste zeigt sie nicht.
#[tokio::test]
async fn verpflegungsplan_fremde_org_ist_404() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, v) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Mittag","beginn":"12:00","ende":"13:30"}"#,
    )
    .await;
    let id = v["id"].as_i64().unwrap();
    fremde_org_anlegen(&pool, "Org B", "bert", "bertpw123", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE benutzername = 'bert'")
        .execute(&pool)
        .await
        .unwrap();
    let bert = login_cookie(&app, "bert", "bertpw123").await;
    let (s, liste) = anfrage(
        &app,
        "GET",
        &format!("{PLAN}?nur_aktive=false"),
        &bert,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste, serde_json::json!([]));
    let (s, _) = mahlzeit_patch(&app, &bert, id, r#"{"aktiv":false}"#).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = mahlzeit_patch(&app, &admin, id + 1000, r#"{"aktiv":false}"#).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Derselbe Name ist in der anderen Org frei.
    let (s, _) = mahlzeit(
        &app,
        &bert,
        r#"{"bezeichnung":"Mittag","beginn":"12:00","ende":"13:30"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
}

fn stammdaten_ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::org::OrgNachricht>,
    org_id: i64,
) -> usize {
    let mut n = 0;
    while let Ok(m) = rx.try_recv() {
        if m.event == lifeline_hub::live::org::OrgLiveEvent::Stammdaten {
            assert_eq!(m.org_id, org_id, "nur an die eigene Organisation");
            n += 1;
        }
    }
    n
}

/// Spec `org-live`, „Ereignis für die Stammdaten“: Anlegen und Deaktivieren melden
/// `stammdaten` an die eigene Organisation, Lesen und abgelehnte Anfragen nicht; das Schreiben
/// einer zweiten Organisation meldet an diese.
#[tokio::test]
async fn verpflegungsplan_meldet_stammdaten_nur_nach_erfolg() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let mut rx = live.abonniere_org();

    let (s, v) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Mittag","beginn":"12:00","ende":"13:30"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(stammdaten_ereignisse(&mut rx, org), 1, "POST");
    let id = v["id"].as_i64().unwrap();
    let (s, _) = mahlzeit_patch(&app, &admin, id, r#"{"aktiv":false}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(stammdaten_ereignisse(&mut rx, org), 1, "Deaktivieren");

    let (s, _) = anfrage(&app, "GET", PLAN, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(stammdaten_ereignisse(&mut rx, org), 0, "GET");
    let (s, _) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Abendessen","beginn":"18:00","ende":"19:30"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(stammdaten_ereignisse(&mut rx, org), 1, "POST Abendessen");
    for (s, fall) in [
        (
            mahlzeit(
                &app,
                &admin,
                r#"{"bezeichnung":"abendessen","beginn":"18:00","ende":"19:30"}"#,
            )
            .await
            .0,
            "409",
        ),
        (
            mahlzeit(
                &app,
                &admin,
                r#"{"bezeichnung":"Frühstück","beginn":"0630","ende":"0630"}"#,
            )
            .await
            .0,
            "422",
        ),
        (
            mahlzeit(
                &app,
                &admin,
                r#"{"bezeichnung":"","beginn":"06:30","ende":"08:00"}"#,
            )
            .await
            .0,
            "400",
        ),
        (
            mahlzeit_patch(&app, &erika, id, r#"{"aktiv":true}"#)
                .await
                .0,
            "403",
        ),
    ] {
        assert!(s.is_client_error(), "{fall}: {s}");
        assert_eq!(stammdaten_ereignisse(&mut rx, org), 0, "{fall}");
    }

    // Eine zweite Organisation: ihr Schreiben meldet an sie, nicht an die erste.
    let (org_b, _) = fremde_org_anlegen(&pool, "Org B", "bert", "bertpw123", "keine").await;
    assert_ne!(org_b, org);
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE benutzername = 'bert'")
        .execute(&pool)
        .await
        .unwrap();
    let bert = login_cookie(&app, "bert", "bertpw123").await;
    let (s, _) = mahlzeit(
        &app,
        &bert,
        r#"{"bezeichnung":"Mittag","beginn":"12:00","ende":"13:30"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(stammdaten_ereignisse(&mut rx, org_b), 1, "Org B");
}

// ── Tag aus der Vorlage (LLH-1058) ──────────────────────────────────────────────────────────

/// Der 11.10.2026 in Berlin, drei Fenster mit Bedarf (ISO-Zeitpunkte wie vom Client).
fn tag_body(fenster: &[Value]) -> String {
    serde_json::json!({
        "tag_von_at": "2026-10-10T22:00:00Z",
        "tag_bis_at": "2026-10-11T22:00:00Z",
        "zeitfenster": fenster,
    })
    .to_string()
}

fn tag_fenster(bezeichnung: &str, von: &str, bis: &str) -> Value {
    serde_json::json!({
        "bezeichnung": bezeichnung,
        "von_at": von,
        "bis_at": bis,
        "bedarf_kraefte": 186,
        "bedarf_betreute": 70,
        "bedarf_weitere": 4,
        "sonderkost": {"vegetarisch": 12},
    })
}

fn drei_tag_fenster() -> Vec<Value> {
    vec![
        tag_fenster("Frühstück", "2026-10-11T04:30:00Z", "2026-10-11T06:00:00Z"),
        tag_fenster("Mittag", "2026-10-11T10:00:00Z", "2026-10-11T11:30:00Z"),
        tag_fenster(
            "Abendessen",
            "2026-10-11T18:00:00+02:00",
            "2026-10-11T19:30:00+02:00",
        ),
    ]
}

async fn create_tag(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("{}/zeitfenster/aus-vorlage", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await
}

fn ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>,
) -> (usize, usize) {
    let (mut verpflegung, mut etb) = (0, 0);
    while let Ok(m) = rx.try_recv() {
        match m.event {
            lifeline_hub::live::LiveEvent::Verpflegung => verpflegung += 1,
            lifeline_hub::live::LiveEvent::Etb => etb += 1,
            _ => {}
        }
    }
    (verpflegung, etb)
}

/// AK „Je angelegtem Zeitfenster genau ein ETB-Eintrag wie beim Einzelanlegen“ und Spec „Drei
/// Zeitfenster für einen Tag“: 201, drei gewöhnliche Zeitfenster ohne Stelle; das ETB ist
/// dasselbe wie nach drei Einzelanlagen mit denselben Werten. Live: genau ein `verpflegung` und
/// je ETB-Eintrag ein ETB-Ereignis.
#[tokio::test]
async fn tag_aus_vorlage_etb_wie_einzeln_und_ein_live_ereignis() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(e);

    let mut fenster = drei_tag_fenster();
    fenster[1]["verpflegungsart"] = "warm".into();
    // Der Body kennt keine Stellen: ein mitgeschicktes Feld wirkt nicht.
    fenster[1]["stelle_ids"] = serde_json::json!([1]);
    let (s, v) = create_tag(&app, &admin, e, &tag_body(&fenster)).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let angelegt = v["angelegt"].as_array().unwrap();
    assert_eq!(angelegt.len(), 3, "{v}");
    assert_eq!(v["uebersprungen"], serde_json::json!([]));
    assert_eq!(angelegt[2]["bezeichnung"], "Abendessen");
    assert_eq!(angelegt[2]["von_at"], "2026-10-11 16:00:00");
    assert_eq!(angelegt[1]["verpflegungsart"], "warm");
    assert_eq!(angelegt[0]["bedarf"]["gesamt"], 260);
    for z in angelegt {
        assert_eq!(z["stelle_ids"], serde_json::json!([]), "{z}");
    }
    assert_eq!(ereignisse(&mut rx), (1, 3));

    for mut f in drei_tag_fenster() {
        if f["bezeichnung"] == "Mittag" {
            f["verpflegungsart"] = "warm".into();
        }
        zeitfenster(&app, &admin, e2, &f.to_string()).await;
    }
    let sammel = verpflegungs_etb(&app, &admin, e).await;
    assert_eq!(sammel.len(), 3);
    assert_eq!(sammel, verpflegungs_etb(&app, &admin, e2).await);
    assert_eq!(
        sammel[0],
        "Verpflegung ‚Frühstück‘ 110630okt26–0800 angelegt: Bedarf 260 EP (186 Kräfte, \
         70 Betreute, 4 weitere), davon 12 Sonderkost."
    );
}

/// `VerpflegungTagErgebnis`: die angelegten Zeitfenster stehen in der Reihenfolge der Anfrage,
/// nicht nach Beginn wie in der Liste des Moduls.
#[tokio::test]
async fn tag_aus_vorlage_antwort_in_der_reihenfolge_der_anfrage() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    // Weder nach Beginn noch umgekehrt: Abendessen, Frühstück, Mittag.
    let mut fenster = drei_tag_fenster();
    fenster.rotate_left(2);
    let (s, v) = create_tag(&app, &admin, e, &tag_body(&fenster)).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let namen: Vec<&str> = v["angelegt"]
        .as_array()
        .unwrap()
        .iter()
        .map(|z| z["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(namen, ["Abendessen", "Frühstück", "Mittag"]);
}

/// Spec „Gleichnamiges Zeitfenster am selben Tag“ und „Alles schon angelegt“: das Übersprungene
/// steht in der Antwort und bekommt keinen ETB-Eintrag; ohne angelegtes Fenster 200 ohne ETB und
/// ohne Live-Ereignis.
#[tokio::test]
async fn tag_aus_vorlage_ueberspringt_und_200_ohne_etb_und_live() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    zeitfenster(
        &app,
        &admin,
        e,
        &tag_fenster("Mittag", "2026-10-11T09:30:00Z", "2026-10-11T11:00:00Z").to_string(),
    )
    .await;
    let mut rx = live.abonniere(e);

    let mut fenster = drei_tag_fenster();
    fenster[1]["bezeichnung"] = "mittag".into();
    let (s, v) = create_tag(&app, &admin, e, &tag_body(&fenster)).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["angelegt"].as_array().unwrap().len(), 2);
    assert_eq!(v["uebersprungen"], serde_json::json!(["mittag"]));
    assert_eq!(verpflegungs_etb(&app, &admin, e).await.len(), 3);
    assert_eq!(ereignisse(&mut rx), (1, 2));

    let (s, v) = create_tag(&app, &admin, e, &tag_body(&drei_tag_fenster())).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["angelegt"], serde_json::json!([]));
    assert_eq!(
        v["uebersprungen"],
        serde_json::json!(["Frühstück", "Mittag", "Abendessen"])
    );
    assert_eq!(
        verpflegungs_etb(&app, &admin, e).await.len(),
        3,
        "kein neuer ETB-Eintrag"
    );
    assert_eq!(ereignisse(&mut rx), (0, 0), "kein Live-Ereignis");
}

/// Feldfehler sind 400 und gehen jedem 422 vor, auch eines anderen Fensters (Spec
/// `eingabegrenzen`, „Grenze vor dem Zusammenhang“, und „Feldfehler vor dem Zusammenhang“);
/// nichts angelegt, kein ETB.
#[tokio::test]
async fn tag_aus_vorlage_feldfehler_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let lang = "x".repeat(201);

    let mut faelle: Vec<(&str, String)> = Vec::new();
    let mut b: Value = serde_json::from_str(&tag_body(&drei_tag_fenster())).unwrap();
    b["tag_von_at"] = "gestern".into();
    faelle.push(("tag_von_at unlesbar", b.to_string()));
    let mut f = drei_tag_fenster();
    f[1]["von_at"] = "mittags".into();
    faelle.push(("von_at unlesbar", tag_body(&f)));
    let mut f = drei_tag_fenster();
    f[2]["bezeichnung"] = "  ".into();
    faelle.push(("leere Bezeichnung", tag_body(&f)));
    let mut f = drei_tag_fenster();
    f[0]["verpflegungsart"] = "heiss".into();
    faelle.push(("unbekannte Art", tag_body(&f)));
    let mut f = drei_tag_fenster();
    f[1]["bedarf_betreute"] = (-1).into();
    faelle.push(("negativer Bedarf", tag_body(&f)));
    let mut f = drei_tag_fenster();
    f[0]["von_at"] = "2026-10-12T04:30:00Z".into();
    f[0]["bis_at"] = "2026-10-12T06:00:00Z".into();
    f[2]["bezeichnung"] = lang.clone().into();
    faelle.push((
        "201 Zeichen im dritten, Beginn außerhalb im ersten",
        tag_body(&f),
    ));
    let mut f = drei_tag_fenster();
    f[0]["sonderkost"] = serde_json::json!({"vegetarisch": 999});
    f[2]["bezeichnung"] = "".into();
    faelle.push(("422 im ersten, leer im dritten", tag_body(&f)));
    let viele: Vec<Value> = (0..25)
        .map(|i| {
            tag_fenster(
                &format!("Mahlzeit {i}"),
                "2026-10-11T04:30:00Z",
                "2026-10-11T05:00:00Z",
            )
        })
        .collect();
    faelle.push(("25 Fenster", tag_body(&viele)));
    faelle.push(("leere Liste", tag_body(&[])));
    faelle.push((
        "ohne zeitfenster",
        r#"{"tag_von_at":"2026-10-10T22:00:00Z","tag_bis_at":"2026-10-11T22:00:00Z"}"#.into(),
    ));
    for (fall, body) in faelle {
        let (s, v) = create_tag(&app, &admin, e, &body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{fall}: {v}");
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"], serde_json::json!([]));
    assert!(verpflegungs_etb(&app, &admin, e).await.is_empty());
}

/// Der Zusammenhang ist 422 mit der Bezeichnung in der Meldung (Spec „Ein Zeitfenster
/// scheitert“, „Beginn außerhalb des Tages“).
#[tokio::test]
async fn tag_aus_vorlage_zusammenhang_ist_422_mit_bezeichnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut f = drei_tag_fenster();
    f[2]["sonderkost"] = serde_json::json!({"vegetarisch": 300});
    let (s, v) = create_tag(&app, &admin, e, &tag_body(&f)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Abendessen"), "{v}");
    let mut f = drei_tag_fenster();
    f[1]["von_at"] = "2026-10-11T22:00:00Z".into();
    f[1]["bis_at"] = "2026-10-11T23:00:00Z".into();
    let (s, v) = create_tag(&app, &admin, e, &tag_body(&f)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v["error"].as_str().unwrap().contains("Mittag"), "{v}");
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"], serde_json::json!([]));
    assert!(verpflegungs_etb(&app, &admin, e).await.is_empty());
}

/// Spec „Beobachter und abgeschlossener Einsatz“, dazu ausgeblendetes Modul und fremder Einsatz:
/// dieselben Rechte wie beim Einzelanlegen.
#[tokio::test]
async fn tag_aus_vorlage_rechte_wie_einzelanlegen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = tag_body(&drei_tag_fenster());

    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, _) = create_tag(&app, &beob_cookie, e, &body).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Beobachter");

    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    override_setzen(&app, &admin, e, false, None).await;
    let (s, _) = create_tag(&app, &frieda, e, &body).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Modul ausgeblendet");
    override_setzen(&app, &admin, e, true, None).await;

    fremde_org_anlegen(&pool, "Org B", "bert", "bertpw123", "keine").await;
    let bert = login_cookie(&app, "bert", "bertpw123").await;
    // Eine Person einer anderen Org: dieselbe Antwort wie beim Einzelanlegen.
    let (s, _) = create_tag(&app, &bert, e, &body).await;
    let (einzeln, _) = anfrage(
        &app,
        "POST",
        &format!("{}/zeitfenster", pfad(e)),
        &bert,
        Some(MITTAG),
    )
    .await;
    assert!(s.is_client_error(), "fremde Org: {s}");
    assert_eq!(s, einzeln, "fremde Org wie beim Einzelanlegen");
    let (s, _) = create_tag(&app, &admin, 999_999, &body).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "unbekannter Einsatz");

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Einsatz abschließen: {s}");
    let (s, _) = create_tag(&app, &admin, e, &body).await;
    assert_eq!(s, StatusCode::CONFLICT, "abgeschlossener Einsatz");
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["zeitfenster"], serde_json::json!([]));
}

/// Spec „Unabhängig nach dem Anlegen“: ein aus der Vorlage angelegtes Zeitfenster kennt seine
/// Mahlzeit nicht. Die Mahlzeit ändern oder deaktivieren lässt das Zeitfenster stehen und legt
/// nichts an; das Zeitfenster ändern lässt den Plan und die übrigen Zeitfenster stehen.
#[tokio::test]
async fn tag_aus_vorlage_unabhaengig_nach_dem_anlegen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = mahlzeit(
        &app,
        &admin,
        r#"{"bezeichnung":"Mittag","beginn":"12:00","ende":"13:30"}"#,
    )
    .await;
    let mid = m["id"].as_i64().unwrap();
    let (s, v) = create_tag(&app, &admin, e, &tag_body(&drei_tag_fenster())).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let vorher = uebersicht(&app, &admin, e).await["zeitfenster"].clone();
    assert_eq!(vorher.as_array().unwrap().len(), 3);

    let (s, _) = mahlzeit_patch(&app, &admin, mid, r#"{"beginn":"11:30","ende":"13:00"}"#).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = mahlzeit_patch(&app, &admin, mid, r#"{"aktiv":false}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        uebersicht(&app, &admin, e).await["zeitfenster"],
        vorher,
        "Plan ändern wirkt nicht auf angelegte Zeitfenster"
    );

    let mittag = vorher
        .as_array()
        .unwrap()
        .iter()
        .find(|z| z["bezeichnung"] == "Mittag")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let (s, _) = zf_patch(&app, &admin, e, mittag, r#"{"bedarf_betreute":71}"#).await;
    assert_eq!(s, StatusCode::OK);
    let nachher = uebersicht(&app, &admin, e).await["zeitfenster"].clone();
    for (a, b) in vorher
        .as_array()
        .unwrap()
        .iter()
        .zip(nachher.as_array().unwrap())
    {
        if a["id"] == mittag {
            assert_eq!(b["bedarf"]["betreute"], 71, "{b}");
        } else {
            assert_eq!(a, b, "andere Zeitfenster unverändert");
        }
    }
    let (_, plan) = anfrage(
        &app,
        "GET",
        &format!("{PLAN}?nur_aktive=false"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        (plan[0]["beginn"].as_str(), plan[0]["ende"].as_str()),
        (Some("11:30"), Some("13:00")),
        "Zeitfenster ändern wirkt nicht auf den Plan"
    );
}

/// LLH-1048: `verpflegt_anderswo` gibt es nur für ein an eine Verpflegungsstelle gebundenes Gerät
/// (Nachweis samt gepinnter Feldmenge: `tests/geraet_kopplung.rs`,
/// `verpflegungsgeraet_an_einer_stelle_sieht_und_bucht_nur_dort`). Eine Person sieht jede
/// Ausgabe einzeln, alle Zeitfenster und alle Stellen; das Feld steht immer da und ist für sie
/// leer, in der Übersicht wie in der Antwort auf eine Ausgabe.
#[tokio::test]
async fn person_sieht_alles_und_kein_verpflegt_anderswo() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let kueche = stelle(&app, &admin, e, "Feldküche").await;
    let turnhalle = stelle(&app, &admin, e, "Turnhalle").await;
    let zid = zeitfenster(&app, &admin, e, &mittag_an(&[kueche])).await;
    zeitfenster(&app, &admin, e, &mittag_an(&[turnhalle])).await;
    let gruppe = einheit_bilden(&app, &admin, e, "2. Gruppe").await;
    for sid in [kueche, turnhalle] {
        let body =
            serde_json::json!({"menge": 10, "verpflegungsstelle_id": sid, "einheit_id": gruppe});
        let a = ausgabe(&app, &admin, e, zid, &body.to_string()).await;
        assert_eq!(
            a["zeitfenster"]["verpflegt_anderswo"],
            serde_json::json!([])
        );
    }
    let u = uebersicht(&app, &admin, e).await;
    assert_eq!(u["zeitfenster"].as_array().unwrap().len(), 2);
    assert_eq!(u["stellen"].as_array().unwrap().len(), 2);
    let z = u["zeitfenster"]
        .as_array()
        .unwrap()
        .iter()
        .find(|z| z["id"] == zid)
        .unwrap();
    assert_eq!(z["ausgaben"].as_array().unwrap().len(), 2, "{z}");
    assert_eq!(z["je_stelle"].as_array().unwrap().len(), 2, "{z}");
    for z in u["zeitfenster"].as_array().unwrap() {
        assert_eq!(z["verpflegt_anderswo"], serde_json::json!([]), "{z}");
    }
}
