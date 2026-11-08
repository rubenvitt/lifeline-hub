//! Integrationstests des Informationstelefons (LFH-554) unter
//! `/api/einsaetze/{id}/stab/infotelefon`: Statuscodes, Rechte, Lebenszyklus, Live. Seit
//! i6k6mzed (design.md D3) ist es das eigene Modul `infotelefon`; der Pfad bleibt. Die
//! Fachlogik prüft `src/infotelefon/repo/tests.rs`.

use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

mod common;
use common::*;

fn pfad(e: i64) -> String {
    format!("/api/einsaetze/{e}/stab/infotelefon")
}

const RUECKRUF: &str = r#"{"anliegen":"vermisstensuche","notiz":"sucht Vater","anrufer_name":"K. Meyer","rueckruf":"0171 000000","rueckruf_noetig":true}"#;

#[tokio::test]
async fn anruf_erfassen_erledigen_oeffnen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (s, a) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(r#"{"anliegen":"auskunft_lage","notiz":"Sperrung B 3"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{a:?}");
    assert_eq!(a["status"], "erledigt", "ohne Rückruf erledigt");

    let (s, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    assert_eq!(s, StatusCode::CREATED, "{a:?}");
    assert_eq!(a["status"], "offen");
    let id = a["id"].as_i64().unwrap();

    let (s, a) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &admin,
        Some(r#"{"status":"erledigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{a:?}");
    assert_eq!(a["status"], "erledigt");
    assert!(a["erledigt_at"].is_string());

    let (s, a) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &admin,
        Some(r#"{"status":"offen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{a:?}");
    assert_eq!(a["status"], "offen");

    let (s, l) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(l.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn statuscodes_des_infotelefons() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;

    for (body, erwartet, fall) in [
        (
            r#"{"anliegen":"spende"}"#,
            StatusCode::BAD_REQUEST,
            "unbekanntes Anliegen",
        ),
        (
            r#"{"notiz":"x"}"#,
            StatusCode::BAD_REQUEST,
            "Anliegen fehlt",
        ),
        (
            r#"{"anliegen":"hinweis","eingang_at":"gestern"}"#,
            StatusCode::BAD_REQUEST,
            "unlesbare Uhrzeit",
        ),
        (
            r#"{"anliegen":"hinweis","rueckruf_noetig":true}"#,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Rückruf ohne Nummer",
        ),
    ] {
        let (s, _) = anfrage(&app, "POST", &pfad(e), &admin, Some(body)).await;
        assert_eq!(s, erwartet, "{fall}");
    }
    let (_, l) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert!(l.as_array().unwrap().is_empty(), "nichts angelegt");

    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &admin,
        Some(r#"{"status":"vergessen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(anderer)),
        &admin,
        Some(r#"{"status":"erledigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &format!("{}/{id}", pfad(e)), &admin, None).await;
    assert!(
        s == StatusCode::NOT_FOUND || s == StatusCode::METHOD_NOT_ALLOWED,
        "kein Löschen: {s}"
    );
}

#[tokio::test]
async fn beobachter_liest_aber_erfasst_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    let bid = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, bid, "beobachter").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;

    for uri in [
        pfad(e),
        format!("{}/zaehler", pfad(e)),
        format!("{}/{id}", pfad(e)),
    ] {
        let (s, _) = anfrage(&app, "GET", &uri, &beob, None).await;
        assert_eq!(s, StatusCode::OK, "{uri}");
    }
    let (s, _) = anfrage(&app, "POST", &pfad(e), &beob, Some(RUECKRUF)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", pfad(e)),
        &beob,
        Some(r#"{"status":"erledigt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

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
    let (s, _) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
}

/// Spec „Zwei Telefonplätze“: das Ereignis `infotelefon` trägt nur Kennungen.
#[tokio::test]
async fn live_ereignis_nur_mit_kennungen() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(e);
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let n = recv_until_tag(&mut rx, "infotelefon", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["anruf_id"], a["id"]);
    for pii in ["Meyer", "0171", "Vater"] {
        assert!(!n.data.contains(pii), "{pii} im Ereignis: {}", n.data);
    }
}

/// Spec „Einzelner Anruf“: für den Deeplink außerhalb der geladenen Seiten.
#[tokio::test]
async fn einzelner_anruf_und_fremder_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();

    let (s, d) = anfrage(&app, "GET", &format!("{}/{id}", pfad(e)), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{d:?}");
    assert_eq!(d, a, "dieselbe Darstellung wie beim Erfassen");
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/{id}", pfad(anderer)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Spec „Das Protokoll wird seitenweise geladen“: Statuscodes der Parameter.
#[tokio::test]
async fn parameter_der_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for (query, erwartet) in [
        ("?status=unsinn", StatusCode::BAD_REQUEST),
        (
            "?vor_zeit=2026-10-01%2010:00:00",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        ("?vor_id=3", StatusCode::UNPROCESSABLE_ENTITY),
        ("?status=offen&limit=5", StatusCode::OK),
        ("?status=", StatusCode::OK),
    ] {
        let (s, v) = anfrage(&app, "GET", &format!("{}{query}", pfad(e)), &admin, None).await;
        assert_eq!(s, erwartet, "{query}: {v:?}");
    }
}

// ---------- Eigenes Modul `infotelefon` (i6k6mzed, design.md D3) ----------

/// Setzt einen Modul-Override im Einsatz (Sichtbarkeit und benötigte Rolle).
async fn override_setzen(
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

/// Alle Routen des Informationstelefons mit Methode und Body, für einen vorhandenen Anruf.
fn alle_routen(e: i64, id: i64) -> Vec<(&'static str, String, Option<&'static str>)> {
    vec![
        ("GET", pfad(e), None),
        ("GET", format!("{}/zaehler", pfad(e)), None),
        ("GET", format!("{}/{id}", pfad(e)), None),
        ("POST", pfad(e), Some(RUECKRUF)),
        (
            "POST",
            format!("{}/{id}/status", pfad(e)),
            Some(r#"{"status":"erledigt"}"#),
        ),
    ]
}

/// Führungskraft mit Einsatzrolle Führungspersonal; liefert ihren Cookie.
async fn kraft(app: &axum::Router, admin: &str, e: i64, name: &str, org_rolle: &str) -> String {
    let id = benutzer_anlegen(app, admin, name, org_rolle).await;
    rolle_setzen(app, admin, e, id, "fuehrungspersonal").await;
    login_cookie(app, name, &format!("{name}pw1")).await
}

/// Spec `stab-infotelefon`, „Das Informationstelefon ist ein eigenes Modul“: ausgeblendet sind
/// alle Routen zu, auch die Zählung.
#[tokio::test]
async fn ausgeblendetes_infotelefon_sperrt_alle_routen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    let frieda = kraft(&app, &admin, e, "frieda", "fuehrungskraft").await;
    override_setzen(&app, &admin, e, "infotelefon", false, None).await;

    for (methode, uri, body) in alle_routen(e, id) {
        let (s, _) = anfrage(&app, methode, &uri, &frieda, body).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {uri}");
    }
}

/// Seine Freigabe hängt von keinem anderen Modul ab: das Modul Stab gibt es nicht mehr
/// (i6k6mzed), das Informationstelefon bleibt unter seinem alten Pfad nutzbar.
#[tokio::test]
async fn ohne_stab_bleibt_das_infotelefon_nutzbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    let frieda = kraft(&app, &admin, e, "frieda", "fuehrungskraft").await;

    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/stab"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::NOT_FOUND,
        "Vorbedingung: der Stab ist entfernt"
    );
    for (methode, uri, body) in alle_routen(e, id) {
        let (s, j) = anfrage(&app, methode, &uri, &frieda, body).await;
        assert!(s.is_success(), "{methode} {uri}: {s} {j:?}");
    }
}

/// Spec „Gesperrtes Modul“: auf eine Rolle beschränkt, 403 für alle anderen, auch beim Lesen.
#[tokio::test]
async fn auf_eine_rolle_beschraenkt_ist_403_fuer_andere() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    let frieda = kraft(&app, &admin, e, "frieda", "keine").await;
    let gustav = kraft(&app, &admin, e, "gustav", "fuehrungskraft").await;
    override_setzen(&app, &admin, e, "infotelefon", true, Some("fuehrungskraft")).await;

    for (methode, uri, body) in alle_routen(e, id) {
        let (s, _) = anfrage(&app, methode, &uri, &frieda, body).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "frieda {methode} {uri}");
        let (s, j) = anfrage(&app, methode, &uri, &gustav, body).await;
        assert!(s.is_success(), "gustav {methode} {uri}: {s} {j:?}");
    }
}

/// Spec „Live ohne Freigabe“: das Ereignis `infotelefon` erreicht nur Leser mit dem Recht
/// `infotelefon`; das Leserecht am Einsatz allein genügt nicht.
#[tokio::test]
async fn live_ereignis_nur_an_leser_mit_recht_infotelefon() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let frieda = kraft(&app, &admin, e, "frieda", "keine").await;
    let gustav = kraft(&app, &admin, e, "gustav", "fuehrungskraft").await;
    override_setzen(&app, &admin, e, "infotelefon", true, Some("fuehrungskraft")).await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: Frieda liest den Einsatz");
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Vorbedingung: Frieda ohne Recht");

    let feed_gustav = live_oeffnen(&app, &gustav, e).await;
    let feed_frieda = live_oeffnen(&app, &frieda, e).await;

    let (s, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    assert_eq!(s, StatusCode::CREATED, "{a:?}");
    // Ein Ereignis, das Frieda sehen darf, sonst bewiese ein leerer Feed nichts.
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
        bei_gustav.contains("event: infotelefon"),
        "Leser mit Recht bekommt das Ereignis: {bei_gustav:?}"
    );
    assert!(
        bei_frieda.contains("event: person"),
        "Friedas Feed läuft: {bei_frieda:?}"
    );
    assert!(
        !bei_frieda.contains("event: infotelefon"),
        "Leser ohne Recht bekommt kein Ereignis: {bei_frieda:?}"
    );
}

/// Fremde Organisation: 403 oder 404 auf jeder Route (wie `tests/cross_org.rs`), ohne Daten.
#[tokio::test]
async fn fremde_organisation_wird_auf_allen_routen_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, a) = anfrage(&app, "POST", &pfad(e), &admin, Some(RUECKRUF)).await;
    let id = a["id"].as_i64().unwrap();
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    for (methode, uri, body) in alle_routen(e, id) {
        let (s, j) = anfrage(&app, methode, &uri, &fremd, body).await;
        assert!(
            s == StatusCode::FORBIDDEN || s == StatusCode::NOT_FOUND,
            "{methode} {uri}: erwartet 403/404, war {s} {j:?}"
        );
        assert!(!j.to_string().contains("Meyer"), "keine Daten: {j:?}");
    }
}
