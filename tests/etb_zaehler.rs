//! ETB-Zählung gesamt und je Typ (LFH-612, Neuentwurf S4: „412 Einträge", Bilanz-Leiste).
//!
//! Die tragende Zusicherung ist die **Parität mit der Liste**: der Kopf zeigt „n Treffer",
//! und n muss genau die Menge sein, die `GET …/etb` mit denselben Filtern seitenweise
//! liefert. Die Paritätstests laden die Liste deshalb vollständig über den Cursor und
//! vergleichen — ein Vergleich gegen eine handgerechnete Zahl bliebe grün, wenn Liste und
//! Zählung gemeinsam falsch lägen, aber nicht, wenn sie auseinanderlaufen.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

async fn erfassen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) {
    let (status, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "erfassen: {v:?}");
}

async fn typ_erfassen(app: &axum::Router, cookie: &str, einsatz: i64, typ: &str, inhalt: &str) {
    erfassen(
        app,
        cookie,
        einsatz,
        &format!(r#"{{"typ":"{typ}","inhalt":"{inhalt}"}}"#),
    )
    .await;
}

async fn zaehler(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    query: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb/zaehler{query}"),
        cookie,
        None,
    )
    .await
}

async fn zaehler_ok(app: &axum::Router, cookie: &str, einsatz: i64, query: &str) -> Value {
    let (status, v) = zaehler(app, cookie, einsatz, query).await;
    assert_eq!(status, StatusCode::OK, "zaehler{query}: {v:?}");
    v
}

/// Lädt die Liste mit `query` (beginnt mit `?` oder ist leer) seitenweise vollständig
/// (kleine Seiten, damit der Cursor wirklich blättert) und liefert die Anzahl.
async fn liste_vollstaendig(app: &axum::Router, cookie: &str, einsatz: i64, query: &str) -> i64 {
    let trenner = if query.is_empty() { "?" } else { "&" };
    let mut cursor: Option<i64> = None;
    let mut anzahl = 0;
    loop {
        let seite = match cursor {
            Some(c) => format!("{query}{trenner}limit=2&before_lfd_nr={c}"),
            None => format!("{query}{trenner}limit=2"),
        };
        let (status, v) = anfrage(
            app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/etb{seite}"),
            cookie,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "liste{seite}: {v:?}");
        let eintraege = v.as_array().unwrap();
        if eintraege.is_empty() {
            return anzahl;
        }
        anzahl += eintraege.len() as i64;
        cursor = eintraege.last().unwrap()["lfd_nr"].as_i64();
    }
}

fn summe_je_typ(v: &Value) -> i64 {
    v["je_typ"]
        .as_object()
        .unwrap()
        .values()
        .map(|n| n.as_i64().unwrap())
        .sum()
}

async fn aufbau() -> (axum::Router, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

#[tokio::test]
async fn zaehlt_je_typ_mit_null_fuer_leere_typen() {
    let (app, admin, einsatz) = aufbau().await;
    // Die Anlage selbst schreibt Systemeinträge — sie zählen mit, das ETB kennt kein Storno.
    let vorher = zaehler_ok(&app, &admin, einsatz, "").await;
    let system_vorher = vorher["je_typ"]["system"].as_i64().unwrap();
    assert_eq!(vorher["gesamt"].as_i64(), Some(system_vorher));

    for _ in 0..3 {
        typ_erfassen(&app, &admin, einsatz, "meldung", "Lage ruhig").await;
    }
    typ_erfassen(&app, &admin, einsatz, "anordnung", "Deich sichern").await;

    let v = zaehler_ok(&app, &admin, einsatz, "").await;
    assert_eq!(v["gesamt"].as_i64(), Some(system_vorher + 4));
    let je_typ = v["je_typ"].as_object().unwrap();
    assert_eq!(je_typ["meldung"].as_i64(), Some(3));
    assert_eq!(je_typ["anordnung"].as_i64(), Some(1));
    // Ein Typ ohne Einträge steht als 0 da — er fehlt nicht.
    for leer in ["lage", "entscheidung", "berichtigung"] {
        assert_eq!(
            je_typ.get(leer).and_then(Value::as_i64),
            Some(0),
            "{leer}: {v:?}"
        );
    }
    assert_eq!(summe_je_typ(&v), v["gesamt"].as_i64().unwrap());
}

#[tokio::test]
async fn gesamt_ist_mehr_als_eine_listenseite() {
    let (app, admin, einsatz) = aufbau().await;
    let vorher = zaehler_ok(&app, &admin, einsatz, "").await["gesamt"]
        .as_i64()
        .unwrap();
    for i in 0..105 {
        typ_erfassen(&app, &admin, einsatz, "meldung", &format!("Meldung {i}")).await;
    }
    let v = zaehler_ok(&app, &admin, einsatz, "").await;
    assert_eq!(v["gesamt"].as_i64(), Some(vorher + 105));
    // Seitenparameter sind keine Filtermerkmale und werden ignoriert.
    let mit_limit = zaehler_ok(&app, &admin, einsatz, "?limit=10&before_lfd_nr=5").await;
    assert_eq!(mit_limit["gesamt"], v["gesamt"]);
}

#[tokio::test]
async fn fremder_einsatz_zaehlt_nicht_mit() {
    let (app, admin, einsatz) = aufbau().await;
    let vorher = zaehler_ok(&app, &admin, einsatz, "").await["gesamt"]
        .as_i64()
        .unwrap();
    let zweiter = einsatz_anlegen(&app, &admin).await;
    typ_erfassen(&app, &admin, zweiter, "meldung", "Anderswo").await;
    assert_eq!(
        zaehler_ok(&app, &admin, einsatz, "").await["gesamt"].as_i64(),
        Some(vorher)
    );
}

#[tokio::test]
async fn zaehlung_folgt_jedem_filter_wie_die_liste() {
    let (app, admin, einsatz) = aufbau().await;
    // Zweiter Erfasser für den Erfasser-Filter.
    let karl_id = benutzer_anlegen(&app, &admin, "karla", "keine").await;
    rolle_setzen(&app, &admin, einsatz, karl_id, "fuehrungspersonal").await;
    let karl = login_cookie(&app, "karla", "karlapw1").await;

    erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Deich bricht","ereigniszeit":"2026-05-23T08:00:00Z"}"#,
    )
    .await;
    erfassen(
        &app,
        &admin,
        einsatz,
        r#"{"typ":"anordnung","inhalt":"Deich sichern","ereigniszeit":"2026-05-23T12:00:00Z"}"#,
    )
    .await;
    erfassen(
        &app,
        &karl,
        einsatz,
        r#"{"typ":"meldung","inhalt":"Pegel steigt","ereigniszeit":"2026-05-23T18:00:00Z"}"#,
    )
    .await;
    erfassen(
        &app,
        &karl,
        einsatz,
        r#"{"typ":"lage","inhalt":"Lage stabil","ereigniszeit":"2026-05-24T09:00:00Z"}"#,
    )
    .await;

    let faelle = [
        "".to_string(),
        "?q=Deich".to_string(),
        "?q=*".to_string(),
        "?q=%20%20".to_string(),
        "?typ=meldung".to_string(),
        // Grenzen inklusive: genau 12:00 und genau 18:00 gehören dazu.
        "?von=2026-05-23T12:00:00Z&bis=2026-05-23T18:00:00Z".to_string(),
        format!("?erfasser_id={karl_id}"),
        format!("?q=Deich&typ=anordnung&erfasser_id={karl_id}"),
        "?typ=meldung&von=2026-05-23T10:00:00Z".to_string(),
    ];
    for query in faelle {
        let v = zaehler_ok(&app, &admin, einsatz, &query).await;
        let liste = liste_vollstaendig(&app, &admin, einsatz, &query).await;
        assert_eq!(v["gesamt"].as_i64(), Some(liste), "Parität {query}: {v:?}");
        assert_eq!(summe_je_typ(&v), liste, "Σ je_typ {query}: {v:?}");
    }

    // Stichproben mit handgerechneten Zahlen — die Parität allein ließe gemeinsame Fehler durch.
    let v = zaehler_ok(&app, &admin, einsatz, "?q=Deich").await;
    assert_eq!(v["gesamt"].as_i64(), Some(2));
    assert_eq!(v["je_typ"]["meldung"].as_i64(), Some(1));
    assert_eq!(v["je_typ"]["anordnung"].as_i64(), Some(1));
    let v = zaehler_ok(
        &app,
        &admin,
        einsatz,
        "?von=2026-05-23T12:00:00Z&bis=2026-05-23T18:00:00Z",
    )
    .await;
    assert_eq!(v["gesamt"].as_i64(), Some(2), "Grenzen inklusive: {v:?}");
    let v = zaehler_ok(&app, &admin, einsatz, "?typ=meldung").await;
    assert_eq!(v["gesamt"].as_i64(), Some(2));
    assert_eq!(v["je_typ"]["anordnung"].as_i64(), Some(0));
    let v = zaehler_ok(&app, &admin, einsatz, &format!("?erfasser_id={karl_id}")).await;
    assert_eq!(v["gesamt"].as_i64(), Some(2));
}

/// Der Einheitenfilter aus LFH-616 kam parallel zu LFH-612 und läuft seit dem Merge durch
/// dieselbe Bedingung (`filter_bedingung`). Beide Zählungen — `zaehler` (LFH-612) und
/// `anzahl` (LFH-619) — müssen ihn tragen, sonst zeigt der Kopf bei gesetzter Einheit die
/// ungefilterte Zahl über einer gefilterten Liste.
#[tokio::test]
async fn einheitenfilter_zaehlt_wie_die_liste() {
    let (app, admin, einsatz) = aufbau().await;
    let mut ids = Vec::new();
    for name in ["1. Zug", "2. Zug"] {
        let (status, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/einheiten"),
            &admin,
            Some(&format!(r#"{{"name":"{name}"}}"#)),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "einheit: {v:?}");
        ids.push(v["id"].as_i64().unwrap());
    }
    let (zug, andere) = (ids[0], ids[1]);
    let (status, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/auftraege"),
        &admin,
        Some(&format!(
            r#"{{"auftrag_text":"Deich sichern","empfaenger":[{{"empfaenger_typ":"einheit","einheit_id":{zug}}}]}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "auftrag: {v:?}");
    for body in [
        r#"{"typ":"meldung","inhalt":"von-treffer","von":" 1. zug "}"#,
        r#"{"typ":"lage","inhalt":"an-treffer","an":"1. Zug"}"#,
        r#"{"typ":"meldung","inhalt":"andere","von":"2. Zug"}"#,
        r#"{"typ":"meldung","inhalt":"nur im Text: 1. Zug"}"#,
    ] {
        erfassen(&app, &admin, einsatz, body).await;
    }

    for query in [
        format!("?einheit_id={zug}"),
        format!("?einheit_id={andere}"),
        format!("?einheit_id={zug}&typ=meldung"),
    ] {
        let liste = liste_vollstaendig(&app, &admin, einsatz, &query).await;
        let v = zaehler_ok(&app, &admin, einsatz, &query).await;
        assert_eq!(v["gesamt"].as_i64(), Some(liste), "zaehler {query}: {v:?}");
        assert_eq!(summe_je_typ(&v), liste, "Σ je_typ {query}: {v:?}");
        let (status, a) = anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/etb/anzahl{query}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "anzahl {query}: {a:?}");
        assert_eq!(a["anzahl"].as_i64(), Some(liste), "anzahl {query}: {a:?}");
    }
    // Handgerechnet: Auftrag (Anordnung) + von-Treffer + an-Treffer. Die Parität allein ließe
    // einen Filter durch, der in Liste UND Zählung gleichermaßen fehlt.
    let v = zaehler_ok(&app, &admin, einsatz, &format!("?einheit_id={zug}")).await;
    assert_eq!(v["gesamt"].as_i64(), Some(3), "{v:?}");
    assert_eq!(v["je_typ"]["lage"].as_i64(), Some(1), "{v:?}");
}

#[tokio::test]
async fn unbekannter_typ_und_unlesbare_zeit_sind_400() {
    let (app, admin, einsatz) = aufbau().await;
    let (status, _) = zaehler(&app, &admin, einsatz, "?typ=unsinn").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = zaehler(&app, &admin, einsatz, "?von=gestern").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn beobachter_darf_zaehlen() {
    let (app, admin, einsatz) = aufbau().await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, v) = zaehler(&app, &erika, einsatz, "").await;
    assert_eq!(status, StatusCode::OK, "{v:?}");
}

#[tokio::test]
async fn ausgeblendetes_etb_modul_ist_403() {
    let (app, admin, einsatz) = aufbau().await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/etb"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override setzen: {status} {json:?}");

    let (status, _) = zaehler(&app, &erika, einsatz, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nichtmitglied_ist_403_und_unbekannter_einsatz_404() {
    let (app, admin, einsatz) = aufbau().await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) = zaehler(&app, &fremd, einsatz, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = zaehler(&app, &admin, 9999, "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
