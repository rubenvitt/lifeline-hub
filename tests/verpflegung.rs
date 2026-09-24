//! Integrationstests des Fachmoduls Verpflegung (LFH-634): Statuscodes je Endpunkt, ein
//! Durchstich Anlegen → Ausgabe → Rücknahme → Löschen mit ETB-Zählung je Schritt, die Rechte
//! (Beobachter, ausgeblendetes Modul, abgeschlossener Einsatz), der Nachforderungsverweis ohne
//! Datenleck und die Live-Verteilung nur an Leser mit Modulrecht.
//!
//! Die Fachlogik der Schreibpfade prüft `src/verpflegung/repo/tests.rs`; hier geht es um das,
//! was erst die Route leistet: Body-Extraktion, Zeit-Normalisierung, Gates, Live.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/verpflegung")
}

/// „Mittag“ am 24.09., 10:00–11:30 UTC (12:00–13:30 in Berlin), 180 Kräfte, 70 Betreute.
const MITTAG: &str = r#"{"bezeichnung":"Mittag","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:30:00Z","bedarf_kraefte":180,"bedarf_betreute":70}"#;

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

/// ETB-Einträge des Einsatzes, die von Verpflegung stammen — chronologisch (die Liste der
/// Route kommt neueste zuerst).
async fn verpflegungs_etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    etb_eintraege(app, cookie, einsatz)
        .await
        .into_iter()
        .rev()
        .filter(|e| {
            e["inhalt"]
                .as_str()
                .is_some_and(|i| i.starts_with("Verpflegung "))
        })
        .map(|e| {
            assert_eq!(e["typ"], "system", "{e:?}");
            e["inhalt"].as_str().unwrap().to_string()
        })
        .collect()
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
        vec!["Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 angelegt: Bedarf 250 EP (180 Kräfte, 70 Betreute), davon 15 Sonderkost."]
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
        "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 geändert: Bedarf 270 EP (vorher 250)."
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
    let (s, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u["zeitfenster"].as_array().unwrap().len(), 0);
}

// ── Live-Verteilung ─────────────────────────────────────────────────────────────────────────

/// Liest den Anfang eines offenen SSE-Stroms, bis für `stille_ms` nichts mehr kommt
/// (Muster `tests/betreuung.rs`).
async fn sse_anfang_lesen(body: Body, stille_ms: u64) -> String {
    use http_body_util::BodyExt;
    let mut body = body;
    let mut gelesen = String::new();
    while let Ok(Some(Ok(frame))) = tokio::time::timeout(
        std::time::Duration::from_millis(stille_ms),
        std::pin::Pin::new(&mut body).frame(),
    )
    .await
    {
        if let Some(daten) = frame.data_ref() {
            gelesen.push_str(&String::from_utf8_lossy(daten));
        }
    }
    gelesen
}

async fn live_oeffnen(app: &axum::Router, cookie: &str, eid: i64) -> axum::response::Response {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{eid}/live"))
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp
}

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
