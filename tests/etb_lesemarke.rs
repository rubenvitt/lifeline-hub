//! ETB-Lesemarke je Benutzer und Einsatz (LFH-611): „14 neue Einträge seit Ihrer letzten
//! Sichtung um 13:04 · alle als gesichtet markieren" (Neuentwurf S4).
//!
//! Die Marke vergleicht über `lfd_nr`, nicht über eine Zeit: `lfd_nr` wächst je Einsatz
//! streng mit dem EINGANG, `ereigniszeit` kann nachgetragen sein. Ein Zeitschnitt ließe einen
//! nachgetragenen Eintrag still unter die Marke rutschen — `nachgetragener_eintrag_zaehlt_als_neu`
//! pinnt genau das.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

fn marke_uri(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/etb/lesemarke")
}

async fn erfassen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> i64 {
    let (status, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "erfassen: {v:?}");
    v["lfd_nr"].as_i64().unwrap()
}

async fn meldung(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    erfassen(
        app,
        cookie,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Lage unverändert"}"#,
    )
    .await
}

async fn marke(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, v) = anfrage(app, "GET", &marke_uri(einsatz), cookie, None).await;
    assert_eq!(status, StatusCode::OK, "lesemarke GET: {v:?}");
    v
}

async fn setzen(app: &axum::Router, cookie: &str, einsatz: i64, bis: i64) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &marke_uri(einsatz),
        cookie,
        Some(&format!(r#"{{"bis_lfd_nr":{bis}}}"#)),
    )
    .await
}

/// Admin legt den Einsatz an und schreibt; `erika` liest als Beobachterin.
async fn aufbau() -> (axum::Router, String, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    (app, admin, erika, einsatz)
}

#[tokio::test]
async fn ohne_marke_zaehlt_alles_fremde_und_traegt_keine_sichtung() {
    let (app, admin, erika, einsatz) = aufbau().await;
    // Die Anlage selbst schreibt Systemeinträge des Admins — die zählen für Erika mit.
    let vorher = marke(&app, &erika, einsatz).await["neue_anzahl"]
        .as_i64()
        .unwrap();
    let hoechste = meldung(&app, &admin, einsatz).await;

    let v = marke(&app, &erika, einsatz).await;
    assert_eq!(v["neue_anzahl"].as_i64().unwrap(), vorher + 1);
    assert_eq!(v["hoechste_lfd_nr"].as_i64().unwrap(), hoechste);
    // Presence, nicht `== Null`: ein fehlender Key und `null` sind über den Index-Zugriff
    // nicht zu unterscheiden (CLAUDE.md, Optionalität ehrlich machen).
    let obj = v.as_object().unwrap();
    assert!(!obj.contains_key("gesichtet_lfd_nr"), "{v:?}");
    assert!(!obj.contains_key("gesichtet_at"), "{v:?}");
}

#[tokio::test]
async fn eigene_eintraege_zaehlen_nie_als_neu() {
    let (app, admin, _erika, einsatz) = aufbau().await;
    meldung(&app, &admin, einsatz).await;
    meldung(&app, &admin, einsatz).await;
    // Alles im Einsatz stammt vom Admin (Anlage + zwei Meldungen) — für ihn ist nichts neu.
    assert_eq!(
        marke(&app, &admin, einsatz).await["neue_anzahl"].as_i64(),
        Some(0)
    );
}

#[tokio::test]
async fn setzen_zaehlt_nur_was_danach_kam() {
    let (app, admin, erika, einsatz) = aufbau().await;
    let bis = meldung(&app, &admin, einsatz).await;

    let (status, v) = setzen(&app, &erika, einsatz, bis).await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
    assert_eq!(v["gesichtet_lfd_nr"].as_i64(), Some(bis));
    assert!(v["gesichtet_at"].as_str().is_some(), "{v:?}");
    assert_eq!(v["neue_anzahl"].as_i64(), Some(0));

    meldung(&app, &admin, einsatz).await;
    meldung(&app, &admin, einsatz).await;
    let v = marke(&app, &erika, einsatz).await;
    assert_eq!(v["neue_anzahl"].as_i64(), Some(2));
    assert_eq!(v["gesichtet_lfd_nr"].as_i64(), Some(bis));
}

#[tokio::test]
async fn marke_ist_je_benutzer() {
    let (app, admin, erika, einsatz) = aufbau().await;
    let bis = meldung(&app, &admin, einsatz).await;
    let otto_id = benutzer_anlegen(&app, &admin, "ottmar", "keine").await;
    rolle_setzen(&app, &admin, einsatz, otto_id, "beobachter").await;
    let otto = login_cookie(&app, "ottmar", "ottmarpw1").await;

    let otto_vorher = marke(&app, &otto, einsatz).await["neue_anzahl"]
        .as_i64()
        .unwrap();
    setzen(&app, &erika, einsatz, bis).await;

    assert_eq!(
        marke(&app, &erika, einsatz).await["neue_anzahl"].as_i64(),
        Some(0)
    );
    // Erikas Sichtung verschiebt Ottos Marke nicht.
    let otto_v = marke(&app, &otto, einsatz).await;
    assert_eq!(otto_v["neue_anzahl"].as_i64(), Some(otto_vorher));
    assert!(!otto_v.as_object().unwrap().contains_key("gesichtet_lfd_nr"));
}

#[tokio::test]
async fn marke_ist_je_einsatz() {
    let (app, admin, _erika, einsatz) = aufbau().await;
    let bis = meldung(&app, &admin, einsatz).await;
    let zweiter = einsatz_anlegen(&app, &admin).await;
    setzen(&app, &admin, einsatz, bis).await;

    // Die Sichtung im ersten Einsatz taucht im zweiten nicht auf.
    let v = marke(&app, &admin, zweiter).await;
    assert!(
        !v.as_object().unwrap().contains_key("gesichtet_lfd_nr"),
        "{v:?}"
    );
}

#[tokio::test]
async fn marke_laeuft_nie_rueckwaerts() {
    let (app, admin, erika, einsatz) = aufbau().await;
    let frueh = meldung(&app, &admin, einsatz).await;
    let spaet = meldung(&app, &admin, einsatz).await;

    setzen(&app, &erika, einsatz, spaet).await;
    let gesetzt_at = marke(&app, &erika, einsatz).await["gesichtet_at"].clone();
    // Die Zeit hat Sekundenauflösung: ohne Abstand wäre ein fälschlich neu geschriebenes
    // `gesichtet_at` vom alten nicht zu unterscheiden.
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

    // Ein verspäteter Request eines zweiten Tabs mit älterem Stand dreht die Marke nicht
    // zurück — und behauptet auch keine neuere Sichtung.
    let (status, v) = setzen(&app, &erika, einsatz, frueh).await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
    assert_eq!(v["gesichtet_lfd_nr"].as_i64(), Some(spaet));
    assert_eq!(v["gesichtet_at"], gesetzt_at);
}

#[tokio::test]
async fn nachgetragener_eintrag_zaehlt_als_neu() {
    let (app, admin, erika, einsatz) = aufbau().await;
    let bis = meldung(&app, &admin, einsatz).await;
    setzen(&app, &erika, einsatz, bis).await;

    // Ereigniszeit weit VOR der Sichtung, Eingang danach: das ist neu für Erika.
    erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Nachtrag","ereigniszeit":"2020-01-01T08:00:00Z"}"#,
    )
    .await;
    assert_eq!(
        marke(&app, &erika, einsatz).await["neue_anzahl"].as_i64(),
        Some(1)
    );
}

#[tokio::test]
async fn beobachter_darf_setzen_auch_im_abgeschlossenen_einsatz() {
    let (app, admin, erika, einsatz) = aufbau().await;
    let bis = meldung(&app, &admin, einsatz).await;
    let (status, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "abschliessen: {status} {v:?}");
    let hoechste = marke(&app, &erika, einsatz).await["hoechste_lfd_nr"]
        .as_i64()
        .unwrap();
    assert!(hoechste >= bis);

    // Die eigene Lesemarke ist kein Schreibzugriff auf den Einsatz: weder Schreibrecht noch
    // aktiver Status sind nötig.
    let (status, v) = setzen(&app, &erika, einsatz, hoechste).await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
    assert_eq!(v["neue_anzahl"].as_i64(), Some(0));
}

#[tokio::test]
async fn nichtmitglied_ist_403() {
    let (app, admin, _erika, einsatz) = aufbau().await;
    let bis = meldung(&app, &admin, einsatz).await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _) = anfrage(&app, "GET", &marke_uri(einsatz), &fremd, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = setzen(&app, &fremd, einsatz, bis).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unbekannter_einsatz_ist_404() {
    let (app, admin, _erika, _einsatz) = aufbau().await;
    let (status, _) = anfrage(&app, "GET", &marke_uri(9999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn fehlende_oder_nicht_positive_marke_ist_400() {
    let (app, _admin, erika, einsatz) = aufbau().await;
    let (status, _) = anfrage(&app, "POST", &marke_uri(einsatz), &erika, Some("{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = setzen(&app, &erika, einsatz, 0).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn marke_ueber_dem_hoechsten_eintrag_ist_422() {
    let (app, admin, erika, einsatz) = aufbau().await;
    let hoechste = meldung(&app, &admin, einsatz).await;
    // Das Feld für sich ist gültig; erst der Zustand des Einsatzes verbietet es — eine
    // Sichtung von Einträgen, die es noch nicht gibt.
    let (status, v) = setzen(&app, &erika, einsatz, hoechste + 1).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{v:?}");
}

/// Das Paar zum Modul-Gate: vorher liest Erika ihre Marke, nach dem Ausblenden des
/// ETB-Moduls weder lesend noch setzend — sonst verriete die Zahl fremde Einträge eines
/// Moduls, das ihr entzogen ist.
#[tokio::test]
async fn ausgeblendetes_etb_modul_sperrt_lesemarke() {
    let (app, admin, erika, einsatz) = aufbau().await;
    let bis = meldung(&app, &admin, einsatz).await;
    let (status, _) = anfrage(&app, "GET", &marke_uri(einsatz), &erika, None).await;
    assert_eq!(status, StatusCode::OK, "vor dem Ausblenden lesbar");

    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/etb"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override setzen: {status} {json:?}");

    let (status, _) = anfrage(&app, "GET", &marke_uri(einsatz), &erika, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Lesen gesperrt");
    let (status, _) = setzen(&app, &erika, einsatz, bis).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Setzen gesperrt");
}
