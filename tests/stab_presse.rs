//! Integrationstests der Presse- und Medienarbeit S5 (LFH-554): Presse-Log und
//! Pressemitteilungen unter `/api/einsaetze/{id}/stab/…`. Statuscodes je Endpunkt, die Freigabe
//! nur durch die Einsatzleitung (mit Paar-Test gegen Lagebericht und Befehl), der ETB-Snapshot,
//! die Rechte (Beobachter, ausgeblendeter Stab, abgeschlossener Einsatz) und die Live-Verteilung.
//!
//! Die Fachlogik der Schreibpfade prüft `src/presse/repo/tests.rs`.

use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

mod common;
use common::*;

fn kontakte(e: i64) -> String {
    format!("/api/einsaetze/{e}/stab/medienkontakte")
}

fn mitteilungen(e: i64) -> String {
    format!("/api/einsaetze/{e}/stab/pressemitteilungen")
}

const ANFRAGE: &str = r#"{"art":"anfrage","medium":"NDR 1","thema":"Zahl der Evakuierten","kontakt_name":"M. Beispiel","kontakt_erreichbarkeit":"+49 511 000000"}"#;

async fn kontakt(app: &axum::Router, cookie: &str, e: i64, body: &str) -> i64 {
    let (s, j) = anfrage(app, "POST", &kontakte(e), cookie, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    j["id"].as_i64().unwrap()
}

async fn mitteilung(app: &axum::Router, cookie: &str, e: i64) -> Value {
    let (s, j) = anfrage(
        app,
        "POST",
        &mitteilungen(e),
        cookie,
        Some(
            r#"{"vorlage":"erstinformation","titel":"Hochwasser Musterstadt","abschnitte":[{"schluessel":"sachverhalt","text":"Seit 06:00 Uhr Hochwasser."}]}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    j
}

/// Ein Führungspersonal-Mitglied im Einsatz.
async fn fuehrungspersonal(app: &axum::Router, admin: &str, e: i64) -> String {
    let id = benutzer_anlegen(app, admin, "frieda", "keine").await;
    rolle_setzen(app, admin, e, id, "fuehrungspersonal").await;
    login_cookie(app, "frieda", "friedapw1").await
}

async fn beobachter(app: &axum::Router, admin: &str, e: i64) -> String {
    let id = benutzer_anlegen(app, admin, "beobachter", "keine").await;
    rolle_setzen(app, admin, e, id, "beobachter").await;
    login_cookie(app, "beobachter", "beobachterpw1").await
}

// ── Presse-Log ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn anfrage_erfassen_und_beantworten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (s, k) = anfrage(
        &app,
        "POST",
        &kontakte(e),
        &admin,
        Some(
            r#"{"art":"anfrage","medium":"NDR 1","thema":"Evakuierte","eingang_at":"2026-09-30T14:00:00+02:00"}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{k:?}");
    assert_eq!(k["status"], "offen");
    assert_eq!(k["eingang_at"], "2026-09-30 12:00:00", "UTC normalisiert");
    assert!(
        !k.as_object().unwrap().contains_key("kontakt_name"),
        "ohne Ansprechperson fehlt das Feld: {k:?}"
    );
    let id = k["id"].as_i64().unwrap();

    let (s, k) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", kontakte(e)),
        &admin,
        Some(r#"{"status":"beantwortet","antwort":"240 Personen","freigabe_durch":"EL"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(k["status"], "beantwortet");
    assert_eq!(k["antwort"], "240 Personen");
    assert_eq!(k["freigabe_durch"], "EL");
    assert!(k["bearbeitet_at"].is_string());

    let (s, liste) = anfrage(&app, "GET", &kontakte(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);
    assert_eq!(
        system_etb_anzahl(&app, &admin, e).await,
        system_etb_anzahl(&app, &admin, einsatz_anlegen(&app, &admin).await).await,
        "das Presse-Log schreibt keinen ETB-Eintrag"
    );
}

#[tokio::test]
async fn statuscodes_des_presse_logs() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let id = kontakt(&app, &admin, e, ANFRAGE).await;
    let termin = kontakt(
        &app,
        &admin,
        e,
        r#"{"art":"termin","medium":"RTL","thema":"Dreh am Deich"}"#,
    )
    .await;

    for (body, erwartet, fall) in [
        (
            r#"{"art":"leserbrief","medium":"X","thema":"Y"}"#,
            StatusCode::BAD_REQUEST,
            "unbekannte Art",
        ),
        (
            r#"{"art":"anfrage","medium":"X","thema":"  "}"#,
            StatusCode::BAD_REQUEST,
            "leeres Thema",
        ),
        (
            r#"{"art":"anfrage","medium":"X"}"#,
            StatusCode::BAD_REQUEST,
            "Thema fehlt",
        ),
    ] {
        let (s, _) = anfrage(&app, "POST", &kontakte(e), &admin, Some(body)).await;
        assert_eq!(s, erwartet, "{fall}");
    }

    let status = |kid: i64, body: &'static str| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            anfrage(
                &app,
                "POST",
                &format!("{}/{kid}/status", kontakte(e)),
                &admin,
                Some(body),
            )
            .await
            .0
        }
    };
    assert_eq!(
        status(id, r#"{"status":"verschollen"}"#).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        status(id, r#"{"status":"beantwortet"}"#).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        "beantwortet ohne Antwort"
    );
    assert_eq!(
        status(termin, r#"{"status":"beantwortet","antwort":"x"}"#).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Termin → beantwortet"
    );

    // Bezug auf einen Entwurf ist 422, auf die freigegebene Mitteilung gelingt er.
    let pm = mitteilung(&app, &admin, e).await["id"].as_i64().unwrap();
    let mit_bezug =
        format!(r#"{{"status":"beantwortet","antwort":"siehe PM","pressemitteilung_id":{pm}}}"#);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", kontakte(e)),
        &admin,
        Some(&mit_bezug),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Entwurf als Bezug");

    // Fremder Einsatz: 404 auf Status und Stammangaben.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/status", kontakte(anderer)),
        &admin,
        Some(r#"{"status":"abgelehnt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{id}", kontakte(anderer)),
        &admin,
        Some(r#"{"thema":"x"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // PATCH leert die Ansprechperson per `null` und lässt den Rest stehen.
    let (s, k) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{id}", kontakte(e)),
        &admin,
        Some(r#"{"kontakt_name":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert!(!k.as_object().unwrap().contains_key("kontakt_name"));
    assert_eq!(k["kontakt_erreichbarkeit"], "+49 511 000000");

    // Kein Endpunkt zum Löschen.
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{id}", kontakte(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::METHOD_NOT_ALLOWED);
}

// ── Pressemitteilung ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn pressemitteilung_durchstich_mit_etb_snapshot() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let pm = mitteilung(&app, &admin, e).await;
    assert_eq!(pm["status"], "entwurf");
    let abschnitte: Vec<&str> = pm["abschnitte"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["schluessel"].as_str().unwrap())
        .collect();
    assert_eq!(
        abschnitte,
        [
            "sachverhalt",
            "massnahmen",
            "hinweise",
            "naechste_information",
            "rueckfragen"
        ]
    );
    let id = pm["id"].as_i64().unwrap();

    let (s, frei) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/freigeben", mitteilungen(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{frei:?}");
    assert_eq!(frei["status"], "freigegeben");
    let etb_id = frei["etb_eintrag_id"].as_i64().unwrap();

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    let eintrag = etb
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"].as_i64() == Some(etb_id))
        .expect("Snapshot im ETB");
    assert_eq!(eintrag["typ"], "meldung");
    let inhalt = eintrag["inhalt"].as_str().unwrap();
    assert!(inhalt.contains("Hochwasser Musterstadt"), "{inhalt}");
    assert!(inhalt.contains("Seit 06:00 Uhr Hochwasser."), "{inhalt}");

    // Freigegeben ist unveränderlich; eine zweite Freigabe ist 422 mit femininem Wortlaut.
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{id}", mitteilungen(e)),
        &admin,
        Some(r#"{"titel":"neu"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/freigeben", mitteilungen(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(j["error"], "Pressemitteilung ist bereits freigegeben");

    // Fortschreiben: Version 2 mit dem Inhalt der Vorgängerin.
    let (s, v2) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/fortschreiben", mitteilungen(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v2:?}");
    assert_eq!(v2["version"], 2);
    assert_eq!(v2["vorgaenger_id"], id);
    assert_eq!(v2["abschnitte"][0]["text"], "Seit 06:00 Uhr Hochwasser.");

    // Bezug aus dem Presse-Log auf die freigegebene Mitteilung gelingt.
    let kid = kontakt(&app, &admin, e, ANFRAGE).await;
    let (s, k) = anfrage(
        &app,
        "POST",
        &format!("{}/{kid}/status", kontakte(e)),
        &admin,
        Some(&format!(
            r#"{{"status":"beantwortet","antwort":"siehe PM","pressemitteilung_id":{id}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(k["pressemitteilung_id"], id);
}

#[tokio::test]
async fn statuscodes_der_pressemitteilung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    for (body, fall) in [
        (
            r#"{"vorlage":"suchhinweis","titel":"X"}"#,
            "unbekannte Vorlage",
        ),
        (
            r#"{"vorlage":"freitext","titel":"X","abschnitte":[{"schluessel":"sachverhalt","text":"a"}]}"#,
            "fremder Schlüssel",
        ),
        (r#"{"vorlage":"freitext","titel":" "}"#, "leerer Titel"),
    ] {
        let (s, _) = anfrage(&app, "POST", &mitteilungen(e), &admin, Some(body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{fall}");
    }
    let (s, leer) = anfrage(
        &app,
        "POST",
        &mitteilungen(e),
        &admin,
        Some(r#"{"vorlage":"bevoelkerungshinweis","titel":"Warnung"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let id = leer["id"].as_i64().unwrap();
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/freigeben", mitteilungen(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        j["error"],
        "Die Pressemitteilung ist leer und kann nicht freigegeben werden"
    );
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/{id}", mitteilungen(anderer)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Spec „Führungspersonal kann nicht freigeben“ und „Lagebericht unverändert“ als Paar: dieselbe
/// Person gibt Lagebericht und Befehl frei, die Pressemitteilung nicht.
#[tokio::test]
async fn nur_die_einsatzleitung_gibt_frei_lagebericht_und_befehl_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let frieda = fuehrungspersonal(&app, &admin, e).await;

    let pm = mitteilung(&app, &frieda, e).await["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{pm}/freigeben", mitteilungen(e)),
        &frieda,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Führungspersonal gibt keine PM frei"
    );

    for (pfad, body) in [
        (
            format!("/api/einsaetze/{e}/lageberichte"),
            r#"{"vorlage":"freitext","titel":"Lage","abschnitte":[{"schluessel":"text","text":"ruhig"}]}"#,
        ),
        (
            format!("/api/einsaetze/{e}/befehle"),
            r#"{"vorlage":"befehl_lad","titel":"Befehl","abschnitte":[{"schluessel":"lage","text":"a"},{"schluessel":"auftrag","text":"b"},{"schluessel":"durchfuehrung","text":"c"}]}"#,
        ),
    ] {
        let (s, d) = anfrage(&app, "POST", &pfad, &frieda, Some(body)).await;
        assert_eq!(s, StatusCode::CREATED, "{pfad}: {d:?}");
        let id = d["id"].as_i64().unwrap();
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("{pfad}/{id}/freigeben"),
            &frieda,
            None,
        )
        .await;
        assert_eq!(
            s,
            StatusCode::OK,
            "{pfad} gibt Führungspersonal frei: {j:?}"
        );
    }

    // Gegenprobe: die Einsatzleitung gibt die Pressemitteilung frei.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{pm}/freigeben", mitteilungen(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

// ── Rechte und Lebenszyklus ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let kid = kontakt(&app, &admin, e, ANFRAGE).await;
    let pm = mitteilung(&app, &admin, e).await["id"].as_i64().unwrap();
    let beob = beobachter(&app, &admin, e).await;

    for uri in [
        kontakte(e),
        mitteilungen(e),
        format!("{}/{pm}", mitteilungen(e)),
    ] {
        let (s, _) = anfrage(&app, "GET", &uri, &beob, None).await;
        assert_eq!(s, StatusCode::OK, "{uri}");
    }
    for (methode, uri, body) in [
        ("POST", kontakte(e), Some(ANFRAGE)),
        (
            "PATCH",
            format!("{}/{kid}", kontakte(e)),
            Some(r#"{"thema":"x"}"#),
        ),
        (
            "POST",
            format!("{}/{kid}/status", kontakte(e)),
            Some(r#"{"status":"abgelehnt"}"#),
        ),
        (
            "POST",
            mitteilungen(e),
            Some(r#"{"vorlage":"freitext","titel":"X"}"#),
        ),
        ("POST", format!("{}/{pm}/freigeben", mitteilungen(e)), None),
    ] {
        let (s, _) = anfrage(&app, methode, &uri, &beob, body).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {uri}");
    }
}

#[tokio::test]
async fn ausgeblendeter_stab_sperrt_presse() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let frieda = fuehrungspersonal(&app, &admin, e).await;
    let (s, _) = anfrage(&app, "GET", &kontakte(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: sichtbar liest sie");
    let (s, j) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/stab"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    for uri in [
        kontakte(e),
        mitteilungen(e),
        format!("/api/einsaetze/{e}/stab/infotelefon"),
    ] {
        let (s, _) = anfrage(&app, "GET", &uri, &frieda, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{uri}");
    }
    let (s, _) = anfrage(&app, "POST", &kontakte(e), &frieda, Some(ANFRAGE)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_schreibgeschuetzt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let kid = kontakt(&app, &admin, e, ANFRAGE).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Einsatz abschließen: {s}");
    let (s, _) = anfrage(&app, "POST", &kontakte(e), &admin, Some(ANFRAGE)).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{kid}/status", kontakte(e)),
        &admin,
        Some(r#"{"status":"abgelehnt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, l) = anfrage(&app, "GET", &kontakte(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(l.as_array().unwrap().len(), 1);
}

/// Spec „Zweiter Arbeitsplatz“: ein Leser mit Stab-Recht bekommt `presse`, nur mit Kennungen.
#[tokio::test]
async fn live_ereignis_presse_nur_mit_kennungen() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(e);
    let kid = kontakt(&app, &admin, e, ANFRAGE).await;
    let n = recv_until_tag(&mut rx, "presse", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["medienkontakt_id"], kid);
    assert!(
        !n.data.contains("Beispiel"),
        "keine Namen im Ereignis: {:?}",
        n.data
    );
    assert!(
        !n.data.contains("NDR"),
        "kein Medium im Ereignis: {:?}",
        n.data
    );
}
