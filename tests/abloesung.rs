//! Integrationstests der Ablösung (LFH-635): Statuscodes je Endpunkt und ein Durchstich
//! Beginnen → Vorgabe verkürzen → Vollziehen → Zurücknehmen samt ETB-Nachweis.
//!
//! Das Modul-Gate (403 bei ausgeblendetem Modul) deckt `tests/modul_override.rs` über
//! `MODUL_GET_PFADE` ab; die Fachlogik der Schreibpfade `src/abloesung/repo/tests.rs`.

use axum::http::StatusCode;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen")
}

async fn abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn einheit(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    abschnitt: Option<i64>,
) -> i64 {
    let body = match abschnitt {
        Some(a) => format!(r#"{{"name":"{name}","abschnitt_id":{a}}}"#),
        None => format!(r#"{{"name":"{name}"}}"#),
    };
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Einheit: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn etb_eintraege(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<serde_json::Value> {
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

fn treffer(etb: &[serde_json::Value], typ: &str, nadel: &str) -> Vec<serde_json::Value> {
    etb.iter()
        .filter(|e| e["typ"] == typ && e["inhalt"].as_str().is_some_and(|i| i.contains(nadel)))
        .cloned()
        .collect()
}

#[tokio::test]
async fn durchstich_beginnen_vorgabe_vollzug_ruecknahme() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt(&app, &admin, e, "Deichwache Nord").await;
    let f1 = einheit(&app, &admin, e, "Florian 1", Some(nord)).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", None).await;

    // Vorgabe 8 h am Abschnitt
    let (s, json) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{nord}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":480}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    assert_eq!(json[0]["rhythmus_minuten"], 480);

    // Schicht ohne eigenen Rhythmus → Vorgabe
    let (s, schicht) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(&format!(
            r#"{{"einheit_id":{f1},"beginn_at":"2026-09-22T09:30:00Z"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{schicht:?}");
    assert_eq!(schicht["faellig_at"], "2026-09-22 17:30:00");
    assert_eq!(schicht["rhythmus_quelle"], "abschnitt");
    assert_eq!(schicht["einheit_name"], "Florian 1");
    let id = schicht["id"].as_i64().unwrap();

    // Vorgabe auf 6 h verkürzt → Entscheidung im ETB, Schicht wandert mit
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{nord}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":360}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("{}?status=laufend", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["faellig_at"], "2026-09-22 15:30:00");
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(treffer(&etb, "entscheidung", "Deichwache Nord").len(), 2);

    // Vollzug durch Florian 2
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/vollzug", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"vollzogen_at":"2026-09-22T15:40:00Z","abloesende_einheit_id":{f2}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["abgeloest"]["status"], "abgeloest");
    assert_eq!(v["abgeloest"]["ruecknehmbar"], true);
    assert_eq!(v["folgeschicht"]["einheit_name"], "Florian 2");
    assert_eq!(v["folgeschicht"]["faellig_at"], "2026-09-22 21:40:00");
    assert!(
        v["abgeloest"]
            .as_object()
            .unwrap()
            .get("einstufung")
            .is_none(),
        "abgelöste Schicht trägt keine Einstufung"
    );
    let etb = etb_eintraege(&app, &admin, e).await;
    let vollzug = treffer(&etb, "meldung", "Ablösung vollzogen");
    assert_eq!(vollzug.len(), 1);
    assert!(vollzug[0]["inhalt"].as_str().unwrap().contains("Florian 2"));

    // Rücknahme
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/vollzug/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert_eq!(r["status"], "laufend");
    let etb = etb_eintraege(&app, &admin, e).await;
    let berichtigung = treffer(&etb, "berichtigung", "zurückgenommen");
    assert_eq!(berichtigung.len(), 1);
    assert_eq!(berichtigung[0]["berichtigt_eintrag_id"], vollzug[0]["id"]);
    let (_, laufend) = anfrage(
        &app,
        "GET",
        &format!("{}?status=laufend", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        laufend.as_array().unwrap().len(),
        1,
        "Folgeschicht entfernt"
    );

    // Doppelte Rücknahme → 422
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/{id}/vollzug/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;

    // 400: unbekannter Status-Filter
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}?status=offen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // 400: Rhythmus außerhalb, fehlender Rhythmus ohne Vorgabe, unparsbare Zeit
    for body in [
        format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":0}}"#),
        format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":10081}}"#),
        format!(r#"{{"einheit_id":{f1}}}"#),
        format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":60,"beginn_at":"gestern"}}"#),
        // LFH-1060: Jahr außerhalb 2000–2100; am Rand panickte die Fälligkeitsrechnung (500).
        format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":60,"beginn_at":"0226-09-22 09:30:00"}}"#),
        format!(
            r#"{{"einheit_id":{f1},"rhythmus_minuten":60,"beginn_at":"+262142-12-31 23:30:00"}}"#
        ),
    ] {
        let (s, j) = anfrage(&app, "POST", &pfad(e), &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    // 400: Vorgabe ohne Feld
    let nord = abschnitt(&app, &admin, e, "Nord").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{nord}", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // 404: fremde Einheit, unbekannte Schicht, fremder Abschnitt
    let e2 = einsatz_anlegen(&app, &admin).await;
    let fremd = einheit(&app, &admin, e2, "Fremd", None).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(&format!(
            r#"{{"einheit_id":{fremd},"rhythmus_minuten":60}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/999999/vollzug", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let fremd_abschnitt = abschnitt(&app, &admin, e2, "Fremd").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{fremd_abschnitt}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":60}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // 400: nicht-numerische Sub-ID (PfadParam)
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/abc", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // 422: zweite laufende Schicht
    let body = format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":60}}"#);
    let (s, schicht) = anfrage(&app, "POST", &pfad(e), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = anfrage(&app, "POST", &pfad(e), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // 400 (LFH-1060): Beginn und Vollzug am Rand des Jahresbereichs, auch beim Ändern.
    let aid = schicht["id"].as_i64().unwrap();
    for (methode, unterpfad, body) in [
        ("PATCH", "", r#"{"beginn_at":"+262142-12-31 23:30:00"}"#),
        ("PATCH", "", r#"{"beginn_at":"2101-01-01 00:00:00"}"#),
        (
            "POST",
            "/vollzug",
            r#"{"vollzogen_at":"+262142-12-31 23:30:00"}"#,
        ),
        (
            "POST",
            "/vollzug",
            r#"{"vollzogen_at":"1999-12-31 23:59:59"}"#,
        ),
    ] {
        let (s, j) = anfrage(
            &app,
            methode,
            &format!("{}/{aid}{unterpfad}", pfad(e)),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(
            s,
            StatusCode::BAD_REQUEST,
            "{methode} {unterpfad} {body} → {j:?}"
        );
    }
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (s, _) = anfrage(&app, "GET", &pfad(e), &beob_cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/vorgaben", pfad(e)),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &beob_cookie,
        Some(&format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":60}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

// ── LLH-1122: Schichtmodelle in den Stammdaten und Vorgabe des Einsatzes ─────────────────────

const MODELLE: &str = "/api/schichtmodelle";

fn vorgabe_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen/schichtmodell")
}

async fn modell(app: &axum::Router, cookie: &str, body: &str) -> (StatusCode, serde_json::Value) {
    anfrage(app, "POST", MODELLE, cookie, Some(body)).await
}

/// Offene Auto-Fristen einer Schicht als (bezug_typ, faellig_at), sortiert.
async fn offene_fristen(pool: &sqlx::SqlitePool, schicht: i64) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT bezug_typ, faellig_at FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_id = ? \
           AND bezug_typ IN ('abloesung', 'abloesung_vorwarnung') \
         ORDER BY bezug_typ",
    )
    .bind(schicht)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Spec „Schichtmodelle der Organisation“: Admin legt an, ändert und löscht; jedes Mitglied
/// liest; genau eine Vorgabe (409 bei der zweiten), Bezeichnung eindeutig ohne Groß- und
/// Kleinschreibung (409); ohne Admin 403; fremd oder unbekannt 404.
#[tokio::test]
async fn stammdaten_schichtmodelle_anlegen_aendern_loeschen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let (s, san) = modell(
        &app,
        &admin,
        r#"{"bezeichnung":" Sanitätsdienst 6 h ","typ":"rhythmus","rhythmus_minuten":360,"ist_vorgabe":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{san}");
    assert_eq!(san["bezeichnung"], "Sanitätsdienst 6 h");
    assert_eq!(san["rhythmus_minuten"], 360);
    assert_eq!(san["vorwarnung_minuten"], 30, "Vorgabe der Vorwarnung");
    assert_eq!(
        san["planungsvorlauf_minuten"], 120,
        "Vorgabe des Planungsvorlaufs"
    );
    assert_eq!(san["ist_vorgabe"], true);
    assert_eq!(san["ist_demo"], false);
    let obj = san.as_object().unwrap();
    assert!(!obj.contains_key("wechselzeiten") && !obj.contains_key("mindestdauer_minuten"));
    let san_id = san["id"].as_i64().unwrap();

    let hochwasser = r#"{"bezeichnung":"Hochwasser","typ":"wechselzeiten","wechselzeiten":["1800","06:00"],"mindestdauer_minuten":240,"vorwarnung_minuten":45}"#;
    let (s, hw) = modell(&app, &admin, hochwasser).await;
    assert_eq!(s, StatusCode::CREATED, "{hw}");
    assert_eq!(hw["wechselzeiten"], serde_json::json!(["06:00", "18:00"]));
    assert_eq!(hw["ist_vorgabe"], false);
    let hw_id = hw["id"].as_i64().unwrap();

    // 409: zweite Vorgabe, gleiche Bezeichnung in anderer Schreibweise
    let (s, j) = modell(
        &app,
        &admin,
        r#"{"bezeichnung":"Zweite","typ":"rhythmus","rhythmus_minuten":60,"ist_vorgabe":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j}");
    let (s, _) = modell(
        &app,
        &admin,
        r#"{"bezeichnung":"HOCHWASSER","typ":"rhythmus","rhythmus_minuten":60}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{MODELLE}/{hw_id}"),
        &admin,
        Some(&hochwasser.replace("\"vorwarnung_minuten\":45", "\"ist_vorgabe\":true")),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "Vorgabe nur nach dem Aufheben der alten"
    );

    // 400/422 aus der Feldprüfung, 403 ohne Admin
    for (body, erwartet) in [
        (
            r#"{"bezeichnung":"X","typ":"schicht","rhythmus_minuten":60}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"X","typ":"rhythmus"}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"X","typ":"wechselzeiten","wechselzeiten":["25:00"],"mindestdauer_minuten":0}"#,
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"bezeichnung":"X","typ":"rhythmus","rhythmus_minuten":60,"mindestdauer_minuten":0}"#,
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, j) = modell(&app, &admin, body).await;
        assert_eq!(s, erwartet, "{body} → {j}");
    }
    let (s, _) = modell(
        &app,
        &erika,
        r#"{"bezeichnung":"Erika","typ":"rhythmus","rhythmus_minuten":60}"#,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Lesen für jedes Mitglied, die Vorgabe zuerst
    let (s, liste) = anfrage(&app, "GET", MODELLE, &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    let namen: Vec<&str> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(namen, ["Sanitätsdienst 6 h", "Hochwasser"]);

    // Ändern: Vorgabe wechseln
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{MODELLE}/{san_id}"),
        &admin,
        Some(r#"{"bezeichnung":"Sanitätsdienst 8 h","typ":"rhythmus","rhythmus_minuten":480}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, hw) = anfrage(
        &app,
        "PUT",
        &format!("{MODELLE}/{hw_id}"),
        &admin,
        Some(&hochwasser.replace("\"vorwarnung_minuten\":45", "\"ist_vorgabe\":true")),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{hw}");
    assert_eq!(hw["ist_vorgabe"], true);
    assert_eq!(hw["vorwarnung_minuten"], 30, "ganzer Satz: fehlt = Vorgabe");

    // Fremde Org: 404 beim Ändern und Löschen
    let (_org, _b) =
        fremde_org_anlegen(&pool, "Fremd-Org", "fremdadmin", "fremdpw12", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE benutzername = 'fremdadmin'")
        .execute(&pool)
        .await
        .unwrap();
    let fremd = login_cookie(&app, "fremdadmin", "fremdpw12").await;
    let (s, _) = anfrage(&app, "DELETE", &format!("{MODELLE}/{hw_id}"), &fremd, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, liste) = anfrage(&app, "GET", MODELLE, &fremd, None).await;
    assert_eq!((s, liste.as_array().unwrap().len()), (StatusCode::OK, 0));

    // Löschen
    let (s, _) = anfrage(&app, "DELETE", &format!("{MODELLE}/{san_id}"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage(&app, "DELETE", &format!("{MODELLE}/{san_id}"), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Spec „Vorgabe des Einsatzes“: die Anlage kopiert die Org-Vorgabe; eine Änderung oder das
/// Löschen des Modells in den Stammdaten ändert den Einsatz nicht; ohne Org-Vorgabe hat ein
/// neuer Einsatz keine.
#[tokio::test]
async fn einsatz_kopiert_die_org_vorgabe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let ohne = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(&app, "GET", &vorgabe_pfad(ohne), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(!v.as_object().unwrap().contains_key("schichtmodell"), "{v}");
    assert_eq!(v["vorwarnung_minuten"], 30);

    let (_, m) = modell(
        &app,
        &admin,
        r#"{"bezeichnung":"12-h-Schicht","typ":"wechselzeiten","wechselzeiten":["06:00","18:00"],"mindestdauer_minuten":240,"vorwarnung_minuten":45,"ist_vorgabe":true}"#,
    )
    .await;
    let m_id = m["id"].as_i64().unwrap();
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, v) = anfrage(&app, "GET", &vorgabe_pfad(e), &admin, None).await;
    assert_eq!(v["schichtmodell"]["bezeichnung"], "12-h-Schicht");
    assert_eq!(v["schichtmodell"]["typ"], "wechselzeiten");
    assert_eq!(
        v["schichtmodell"]["wechselzeiten"],
        serde_json::json!(["06:00", "18:00"])
    );
    assert_eq!(v["vorwarnung_minuten"], 45);
    let kopie = v["schichtmodell"].clone();

    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{MODELLE}/{m_id}"),
        &admin,
        Some(r#"{"bezeichnung":"12-h-Schicht","typ":"rhythmus","rhythmus_minuten":720,"ist_vorgabe":true}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "DELETE", &format!("{MODELLE}/{m_id}"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, v) = anfrage(&app, "GET", &vorgabe_pfad(e), &admin, None).await;
    assert_eq!(
        v["schichtmodell"], kopie,
        "Kopie unverändert nach Ändern und Löschen"
    );

    let danach = einsatz_anlegen(&app, &admin).await;
    let (_, v) = anfrage(&app, "GET", &vorgabe_pfad(danach), &admin, None).await;
    assert!(
        !v.as_object().unwrap().contains_key("schichtmodell"),
        "ohne Org-Vorgabe keine Einsatzvorgabe: {v}"
    );
}

/// Spec „Rangfolge des Rhythmus“ und „Vorgabe des Einsatzes ändern“: ohne eigenen Wert und ohne
/// Abschnittsvorgabe nimmt die Schicht die Einsatzvorgabe; ändert sie sich, wandern Rhythmus,
/// Fälligkeit und Fristen der Schichten mit Quelle `einsatz` mit, die übrigen behalten ihre
/// Fälligkeit, und die Vorwarnung aus dem Modell verschiebt die Vorwarn-Frist aller laufenden.
#[tokio::test]
async fn einsatzvorgabe_rangfolge_und_weitergabe() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(r#"{"schichtmodell":{"bezeichnung":"Sanitätsdienst","typ":"rhythmus","rhythmus_minuten":360}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["schichtmodell"]["rhythmus_minuten"], 360);

    let nord = abschnitt(&app, &admin, e, "Deichwache Nord").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("{}/vorgaben/{nord}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":480}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", Some(nord)).await;
    let f3 = einheit(&app, &admin, e, "Florian 3", None).await;

    let beginnen = |einheit: i64, rhythmus: Option<i64>| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            let body = match rhythmus {
                Some(r) => format!(
                    r#"{{"einheit_id":{einheit},"beginn_at":"2030-06-03T08:00:00Z","rhythmus_minuten":{r}}}"#
                ),
                None => format!(r#"{{"einheit_id":{einheit},"beginn_at":"2030-06-03T08:00:00Z"}}"#),
            };
            let (s, j) = anfrage(&app, "POST", &pfad(e), &admin, Some(&body)).await;
            assert_eq!(s, StatusCode::CREATED, "{j}");
            j
        }
    };
    let s1 = beginnen(f1, None).await;
    assert_eq!(s1["rhythmus_quelle"], "einsatz");
    assert_eq!(s1["faellig_at"], "2030-06-03 14:00:00");
    assert_eq!(s1["vorwarnung_minuten"], 30);
    let s2 = beginnen(f2, None).await;
    assert_eq!(s2["rhythmus_quelle"], "abschnitt", "Abschnitt vor Einsatz");
    assert_eq!(s2["faellig_at"], "2030-06-03 16:00:00");
    let s3 = beginnen(f3, Some(120)).await;
    assert_eq!(s3["rhythmus_quelle"], "einheit", "eigener Wert vor allem");
    let (id1, id2, id3) = (
        s1["id"].as_i64().unwrap(),
        s2["id"].as_i64().unwrap(),
        s3["id"].as_i64().unwrap(),
    );
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(
            &etb,
            "system",
            "Rhythmus 6 h (Vorgabe Einsatz «Sanitätsdienst»)"
        )
        .len(),
        1,
        "ETB nennt die Herkunft"
    );

    // Einsatzvorgabe 4 h, Vorwarnung 45 min
    let (s, v) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(r#"{"schichtmodell":{"bezeichnung":"Hitze","typ":"rhythmus","rhythmus_minuten":240,"vorwarnung_minuten":45}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["laufende_schichten"], 1);
    assert_eq!(v["vorwarnung_minuten"], 45);
    let (_, liste) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let faellig = |id: i64| {
        liste
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == id)
            .map(|s| {
                (
                    s["faellig_at"].clone(),
                    s["rhythmus_minuten"].clone(),
                    s["vorwarnung_minuten"].clone(),
                )
            })
            .unwrap()
    };
    assert_eq!(
        faellig(id1),
        (
            serde_json::json!("2030-06-03 12:00:00"),
            serde_json::json!(240),
            serde_json::json!(45)
        ),
        "Quelle einsatz wandert mit"
    );
    assert_eq!(
        faellig(id2).0,
        "2030-06-03 16:00:00",
        "Abschnittsvorgabe bleibt"
    );
    assert_eq!(faellig(id3).0, "2030-06-03 10:00:00", "eigener Wert bleibt");
    assert_eq!(
        offene_fristen(&pool, id1).await,
        [
            ("abloesung".to_string(), "2030-06-03 12:00:00".to_string()),
            (
                "abloesung_vorwarnung".to_string(),
                "2030-06-03 11:15:00".to_string()
            ),
        ],
        "Fristen über setze_auto_frist_tx neu"
    );
    assert_eq!(
        offene_fristen(&pool, id2).await[1],
        (
            "abloesung_vorwarnung".to_string(),
            "2030-06-03 15:15:00".to_string()
        ),
        "die Vorwarnung aus dem Modell gilt für jede laufende Schicht"
    );
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(
            &etb,
            "entscheidung",
            "Ablösung Einsatz: Schichtmodell «Hitze», Rhythmus 4 h, Vorwarnung 45 min gesetzt \
             (vorher «Sanitätsdienst», Rhythmus 6 h, Vorwarnung 30 min)."
        )
        .len(),
        1
    );

    // Gleicher Wert erneut: kein ETB
    let vorher = etb_eintraege(&app, &admin, e).await.len();
    let (s, _) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(r#"{"schichtmodell":{"bezeichnung":"Hitze","typ":"rhythmus","rhythmus_minuten":240,"vorwarnung_minuten":45}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(etb_eintraege(&app, &admin, e).await.len(), vorher);

    // Entfernen: Rhythmus bleibt, Vorwarnung fällt auf 30 min zurück
    let (s, v) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(r#"{"schichtmodell":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["vorwarnung_minuten"], 30);
    assert_eq!(
        offene_fristen(&pool, id1).await,
        [
            ("abloesung".to_string(), "2030-06-03 12:00:00".to_string()),
            (
                "abloesung_vorwarnung".to_string(),
                "2030-06-03 11:30:00".to_string()
            ),
        ]
    );

    // Zurück zur Vorgabe ohne Abschnitts- und Einsatzvorgabe: 422
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{id3}", pfad(e)),
        &admin,
        Some(r#"{"rhythmus_minuten":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Spec „Fälligkeit nach Wechselzeiten“: Beginn 13:42, Wechsel 06:00/18:00, Mindestdauer 4 h
/// → 18:00 in der wirksamen Zone Einsatz → Org → Berlin; die Folgeschicht rechnet ab dem
/// Vollzug neu.
#[tokio::test]
async fn wechselzeiten_in_der_wirksamen_zone() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(r#"{"schichtmodell":{"bezeichnung":"12-h-Schicht","typ":"wechselzeiten","wechselzeiten":["06:00","18:00"],"mindestdauer_minuten":240}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", None).await;
    let f3 = einheit(&app, &admin, e, "Florian 3", None).await;
    let beginnen = |einheit: i64| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            // 13:42 Sommerzeit
            let (s, j) = anfrage(
                &app,
                "POST",
                &pfad(e),
                &admin,
                Some(&format!(
                    r#"{{"einheit_id":{einheit},"beginn_at":"2026-10-16T11:42:00Z"}}"#
                )),
            )
            .await;
            assert_eq!(s, StatusCode::CREATED, "{j}");
            j
        }
    };

    // Ohne Einstellung: Europe/Berlin
    let s1 = beginnen(f1).await;
    assert_eq!(s1["faellig_at"], "2026-10-16 16:00:00");
    assert_eq!(s1["rhythmus_minuten"], 258);
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(
            &etb,
            "system",
            "Rhythmus Wechsel 06:00/18:00, Mindestdauer 4 h (Vorgabe Einsatz «12-h-Schicht»)"
        )
        .len(),
        1
    );

    // Org-Zone UTC gilt, solange der Einsatz keine eigene hat
    sqlx::query("INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'UTC')")
        .execute(&pool)
        .await
        .unwrap();
    let s2 = beginnen(f2).await;
    assert_eq!(s2["faellig_at"], "2026-10-16 18:00:00");
    // Die Zone des Einsatzes geht vor
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone) VALUES (?, 'Europe/Berlin') \
         ON CONFLICT (einsatz_id) DO UPDATE SET zeitzone = excluded.zeitzone",
    )
    .bind(e)
    .execute(&pool)
    .await
    .unwrap();
    let s3 = beginnen(f3).await;
    assert_eq!(s3["faellig_at"], "2026-10-16 16:00:00");

    // Vollzug um 18:05 Berlin; eine vierte Einheit ohne Schicht löst ab.
    let f4 = einheit(&app, &admin, e, "Florian 4", None).await;
    let id1 = s1["id"].as_i64().unwrap();
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("{}/{id1}/vollzug", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"vollzogen_at":"2026-10-16T16:05:00Z","abloesende_einheit_id":{f4}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["folgeschicht"]["rhythmus_quelle"], "einsatz");
    assert_eq!(
        v["folgeschicht"]["faellig_at"], "2026-10-17 04:00:00",
        "18:05 + 4 h → 06:00 am Folgetag"
    );

    // Beginn ändern rechnet über die Regel neu, ohne Rhythmusänderung im ETB
    let id3 = s3["id"].as_i64().unwrap();
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{id3}", pfad(e)),
        &admin,
        Some(r#"{"beginn_at":"2026-10-16T13:00:00Z"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["faellig_at"], "2026-10-17 04:00:00");
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(
            &etb,
            "system",
            "Ablösung «Florian 3»: Einsatzbeginn geändert"
        )
        .len(),
        1
    );
}

/// Statuscodes der Einsatzvorgabe (`src/AGENTS.md`): leerer Body 400, beide Angaben 422,
/// unbekanntes oder fremdes Modell 404, Feldfehler 400; Beobachter liest, schreibt aber nicht.
#[tokio::test]
async fn einsatzvorgabe_statuscodes_und_rechte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, m) = modell(
        &app,
        &admin,
        r#"{"bezeichnung":"Sanitätsdienst","typ":"rhythmus","rhythmus_minuten":360}"#,
    )
    .await;
    let m_id = m["id"].as_i64().unwrap();
    let (fremd_org, _) =
        fremde_org_anlegen(&pool, "Fremd-Org", "fremd", "fremdpw12", "keine").await;
    let fremd_modell: i64 = sqlx::query_scalar(
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten) \
         VALUES (?, 'Fremd', 'rhythmus', 60) RETURNING id",
    )
    .bind(fremd_org)
    .fetch_one(&pool)
    .await
    .unwrap();

    for (body, erwartet) in [
        ("{}".to_string(), StatusCode::BAD_REQUEST),
        (
            format!(r#"{{"schichtmodell_id":{m_id},"schichtmodell":null}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            r#"{"schichtmodell_id":999999}"#.to_string(),
            StatusCode::NOT_FOUND,
        ),
        (
            format!(r#"{{"schichtmodell_id":{fremd_modell}}}"#),
            StatusCode::NOT_FOUND,
        ),
        (
            r#"{"schichtmodell":{"bezeichnung":"","typ":"rhythmus","rhythmus_minuten":60}}"#
                .to_string(),
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let (s, j) = anfrage(&app, "PUT", &vorgabe_pfad(e), &admin, Some(&body)).await;
        assert_eq!(s, erwartet, "{body} → {j}");
    }
    let (s, v) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(&format!(r#"{{"schichtmodell_id":{m_id}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["schichtmodell"]["bezeichnung"], "Sanitätsdienst");

    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, _) = anfrage(&app, "GET", &vorgabe_pfad(e), &beob_cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &beob_cookie,
        Some(r#"{"schichtmodell":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}
