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
/// Vollzug neu. Das ETB nennt die Wechselzeiten taktisch (Vorgabe, LLH-1469).
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
            "Rhythmus Wechsel 0600/1800, Mindestdauer 4 h (Vorgabe Einsatz «12-h-Schicht»)"
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

// ── Kopplung an die Kräfte-Zeitachse (LLH-1128) ─────────────────────────────────────────────

async fn status_mit_marke(app: &axum::Router, admin: &str, label: &str, marke: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        "/api/fahrzeug-status",
        admin,
        Some(&format!(
            r#"{{"label":"{label}","kategorie":"gebunden","zeitachse_marke":"{marke}"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

/// Handstatus der Einheit (ohne Fahrzeug): wirkt wie ein Wechsel an der Einheit selbst.
async fn handstatus(app: &axum::Router, admin: &str, e: i64, einheit: i64, status: i64) {
    let (s, json) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{e}/einheiten/{einheit}/status"),
        admin,
        Some(&format!(r#"{{"status_id":{status}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
}

async fn liste_mit(
    app: &axum::Router,
    admin: &str,
    e: i64,
    status: &str,
) -> Vec<serde_json::Value> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("{}?status={status}", pfad(e)),
        admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json.as_array().unwrap().clone()
}

fn utc(s: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .unwrap()
        .and_utc()
}

/// Durchstich LLH-1128 über die echten Routen: Einsatzvorgabe 6 h, Statuswechsel mit Marke
/// `eintreffen` → Schicht ab dem Eintreffen samt Fristen, ETB und Live-Ereignis; ein zweites
/// Eintreffen legt keine zweite an; die Entlassung beendet sie (kein Hinweis des Schedulers
/// nach der Fälligkeit); die Streichung der Entlassung öffnet sie wieder.
#[tokio::test]
async fn schicht_beginnt_mit_dem_eintreffen_und_endet_mit_der_entlassung() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
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
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;
    let am_ort = status_mit_marke(&app, &admin, "am Einsatzort", "eintreffen").await;
    let am_ort_2 = status_mit_marke(&app, &admin, "an der Stelle", "eintreffen").await;
    let entlassen = status_mit_marke(&app, &admin, "entlassen", "entlassung").await;

    let mut rx = live.abonniere(e);
    handstatus(&app, &admin, e, f1, am_ort).await;
    recv_until_tag(&mut rx, "abloesung", std::time::Duration::from_secs(2)).await;

    let laufend = liste_mit(&app, &admin, e, "laufend").await;
    assert_eq!(laufend.len(), 1, "{laufend:?}");
    let schicht = &laufend[0];
    let id = schicht["id"].as_i64().unwrap();
    let (_, z) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten/{f1}/zeitachse"),
        &admin,
        None,
    )
    .await;
    let eintreffen_at = z["perioden"][0]["eintreffen_at"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(schicht["beginn_at"], eintreffen_at.as_str());
    assert_eq!(schicht["rhythmus_quelle"], "einsatz");
    let faellig = (utc(&eintreffen_at) + chrono::Duration::hours(6))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    assert_eq!(schicht["faellig_at"], faellig.as_str());
    assert_eq!(schicht["erbende_einheiten"], serde_json::json!([]));
    assert_eq!(
        offene_fristen(&pool, id).await.len(),
        2,
        "Fälligkeit und Vorwarnung"
    );
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(&etb, "system", "«Florian 1» mit dem Eintreffen begonnen").len(),
        1
    );

    // Zweites Eintreffen in derselben Periode: ausgelassen, keine zweite Schicht.
    handstatus(&app, &admin, e, f1, am_ort_2).await;
    assert_eq!(liste_mit(&app, &admin, e, "laufend").await.len(), 1);

    // Entlassung: beendet mit Spur, keine Fristen, kein Hinweis nach der Fälligkeit.
    let mut rx = live.abonniere(e);
    handstatus(&app, &admin, e, f1, entlassen).await;
    recv_until_tag(&mut rx, "abloesung", std::time::Duration::from_secs(2)).await;
    assert!(liste_mit(&app, &admin, e, "laufend").await.is_empty());
    let beendet = liste_mit(&app, &admin, e, "beendet").await;
    assert_eq!(beendet.len(), 1);
    assert_eq!(beendet[0]["id"], id);
    assert_eq!(beendet[0]["status"], "beendet");
    assert_eq!(beendet[0]["beendet_grund"], "entlassung");
    assert!(beendet[0].get("einstufung").is_none(), "{:?}", beendet[0]);
    assert!(liste_mit(&app, &admin, e, "abgeloest").await.is_empty());
    assert!(offene_fristen(&pool, id).await.is_empty());
    let mut rx = live.abonniere(e);
    lifeline_hub::erinnerung::scheduler::tick_einmal(
        &pool,
        &live,
        utc(&faellig) + chrono::Duration::minutes(1),
    )
    .await;
    while let Ok(n) = rx.try_recv() {
        assert_ne!(n.event.as_str(), "abloesung", "kein Hinweis: {}", n.data);
    }

    // Streichung der Entlassung: die Schicht läuft wieder, samt Fristen.
    let (_, z) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten/{f1}/zeitachse"),
        &admin,
        None,
    )
    .await;
    let entlassung = z["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["art"] == "entlassung")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let mut rx = live.abonniere(e);
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten/{f1}/zeitachse/{entlassung}/streichen"),
        &admin,
        Some(r#"{"grund":"falscher Knopf"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    recv_until_tag(&mut rx, "abloesung", std::time::Duration::from_secs(2)).await;
    let laufend = liste_mit(&app, &admin, e, "laufend").await;
    assert_eq!(laufend.len(), 1);
    assert_eq!(laufend[0]["id"], id);
    assert!(laufend[0].get("beendet_grund").is_none());
    assert_eq!(offene_fristen(&pool, id).await.len(), 2);
}

/// Ohne Vorgabe entsteht keine Schicht; ein erzwungener Fehler im Autostart lässt den
/// Statuswechsel und das Eintreffen gelingen (Spec „Fehler im Autostart“).
#[tokio::test]
async fn ohne_vorgabe_oder_bei_fehler_bleibt_es_beim_statuswechsel() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", None).await;
    let am_ort = status_mit_marke(&app, &admin, "am Einsatzort", "eintreffen").await;

    handstatus(&app, &admin, e, f1, am_ort).await;
    let (_, alle) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(alle, serde_json::json!([]), "keine erfundene Zahl");

    let (s, _) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(r#"{"schichtmodell":{"bezeichnung":"Sanitätsdienst","typ":"rhythmus","rhythmus_minuten":360}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    sqlx::query(
        "CREATE TRIGGER schicht_scheitert BEFORE INSERT ON einsatz_abloesung \
         BEGIN SELECT RAISE(ABORT, 'erzwungen'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    handstatus(&app, &admin, e, f2, am_ort).await;
    let (_, z) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten/{f2}/zeitachse"),
        &admin,
        None,
    )
    .await;
    assert_eq!(z["perioden"][0]["anker"], "eintreffen", "{z}");
    let (_, alle) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(alle, serde_json::json!([]));
}

/// Knoten-Modell über die Routen: die Untereinheit erbt die Schicht des Verbands und steht im
/// DTO unter `erbende_einheiten`; ihr eigenes Eintreffen legt keine Schicht an.
#[tokio::test]
async fn untereinheit_erbt_die_schicht_des_verbands() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &vorgabe_pfad(e),
        &admin,
        Some(r#"{"schichtmodell":{"bezeichnung":"Sanitätsdienst","typ":"rhythmus","rhythmus_minuten":360}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let zug = einheit(&app, &admin, e, "Zug 1", None).await;
    let (s, gruppe) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten"),
        &admin,
        Some(&format!(
            r#"{{"name":"Gruppe 1","ueber_einheit_id":{zug}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{gruppe:?}");
    let gruppe = gruppe["id"].as_i64().unwrap();
    let am_ort = status_mit_marke(&app, &admin, "am Einsatzort", "eintreffen").await;
    handstatus(&app, &admin, e, zug, am_ort).await;
    handstatus(&app, &admin, e, gruppe, am_ort).await;

    let laufend = liste_mit(&app, &admin, e, "laufend").await;
    assert_eq!(laufend.len(), 1, "nur der Verband: {laufend:?}");
    assert_eq!(laufend[0]["einheit_id"], zug);
    assert_eq!(
        laufend[0]["erbende_einheiten"],
        serde_json::json!([{"einheit_id": gruppe, "einheit_name": "Gruppe 1"}])
    );
}

/// Abschnitt einer Einheit laut `GET …/einheiten`.
async fn abschnitt_von(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    einheit: i64,
) -> serde_json::Value {
    let (s, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == einheit)
        .map(|x| x["abschnitt_id"].clone())
        .unwrap()
}

/// LLH-1132 über die Route: Liste der Ablöser (höchstens 8 → sonst 400, nicht zugleich mit der
/// Einzelangabe → 422), je Ablöser eine Folgeschicht, „Abschnitt übergeben“ samt Rücknahme. Die
/// Übergabe verlangt die Freigabe des Moduls Einheiten (403), der Vollzug ohne sie nicht.
#[tokio::test]
async fn vollzug_mit_liste_und_abschnittsuebergabe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt(&app, &admin, e, "Deichwache Nord").await;
    let f1 = einheit(&app, &admin, e, "Florian 1", Some(nord)).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", None).await;
    let f3 = einheit(&app, &admin, e, "Florian 3", None).await;
    let (s, schicht) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(&format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":360}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let aid = schicht["id"].as_i64().unwrap();
    let vollzug = format!("{}/{aid}/vollzug", pfad(e));

    let neun = format!(
        r#"{{"abloeser_ids":[{}]}}"#,
        (0..9).map(|_| f2.to_string()).collect::<Vec<_>>().join(",")
    );
    let (s, j) = anfrage(&app, "POST", &vollzug, &admin, Some(&neun)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    let beide = format!(r#"{{"abloeser_ids":[{f2}],"abloesende_einheit_id":{f3}}}"#);
    let (s, _) = anfrage(&app, "POST", &vollzug, &admin, Some(&beide)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // Planen als Liste über PATCH; der Spiegel ist der erste Eintrag.
    let (s, geplant) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{aid}", pfad(e)),
        &admin,
        Some(&format!(r#"{{"abloeser_ids":[{f3},{f2}]}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{geplant:?}");
    assert_eq!(geplant["abloesende_einheit_id"], f3);
    assert_eq!(
        geplant["abloeser"],
        serde_json::json!([
            {"einheit_id": f3, "einheit_name": "Florian 3"},
            {"einheit_id": f2, "einheit_name": "Florian 2"}
        ])
    );

    let (s, v) = anfrage(
        &app,
        "POST",
        &vollzug,
        &admin,
        Some(&format!(
            r#"{{"abloeser_ids":[{f2},{f3}],"abschnitt_uebergeben":true}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["folgeschichten"].as_array().unwrap().len(), 2);
    assert_eq!(v["folgeschicht"]["einheit_id"], f2);
    assert_eq!(v["abgeloest"]["abschnitt_uebergeben"], true);
    assert_eq!(
        v["abgeloest"]["uebergebener_abschnitt_name"],
        "Deichwache Nord"
    );
    assert_eq!(
        abschnitt_von(&app, &admin, e, f1).await,
        serde_json::Value::Null
    );
    assert_eq!(abschnitt_von(&app, &admin, e, f2).await, nord);
    assert_eq!(abschnitt_von(&app, &admin, e, f3).await, nord);
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(
            &etb,
            "meldung",
            "Abschnitt «Deichwache Nord» an «Florian 2», «Florian 3» übergeben"
        )
        .len(),
        1,
        "{etb:?}"
    );

    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{vollzug}/zuruecknehmen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert_eq!(r["status"], "laufend");
    assert_eq!(r["folgeschichten"], serde_json::json!([]));
    assert_eq!(abschnitt_von(&app, &admin, e, f1).await, nord);
    assert_eq!(
        abschnitt_von(&app, &admin, e, f2).await,
        serde_json::Value::Null
    );

    // Ohne Freigabe des Moduls Einheiten: Übergabe 403, Vollzug ohne Übergabe gelingt.
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/einheiten"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "POST",
        &vollzug,
        &frieda,
        Some(&format!(
            r#"{{"abloeser_ids":[{f2}],"abschnitt_uebergeben":true}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        abschnitt_von(&app, &admin, e, f1).await,
        nord,
        "nichts geschrieben"
    );
    let (s, v) = anfrage(
        &app,
        "POST",
        &vollzug,
        &frieda,
        Some(&format!(r#"{{"abloeser_ids":[{f2}]}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["abgeloest"]["abschnitt_uebergeben"], false);
}

/// Eine ad hoc disponierte Person, optional einer Einheit zugeordnet.
async fn person(app: &axum::Router, cookie: &str, e: i64, name: &str, einheit: Option<i64>) -> i64 {
    let (s, p) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/personal"),
        cookie,
        Some(&format!(r#"{{"adhoc":{{"name":"{name}"}}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p:?}");
    let id = p["id"].as_i64().unwrap();
    if let Some(einheit) = einheit {
        let (s, j) = anfrage(
            app,
            "PUT",
            &format!("/api/einsaetze/{e}/einheiten/{einheit}/personal/{id}"),
            cookie,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{j:?}");
    }
    id
}

/// Die Personen einer Einheit, wie die Einheitenliste sie führt.
async fn mitglieder(app: &axum::Router, cookie: &str, e: i64, einheit: i64) -> Vec<i64> {
    let (s, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == einheit)
        .map(|x| {
            x["personal_mitglieder"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| m["ep_id"].as_i64().unwrap())
                .collect()
        })
        .unwrap()
}

/// LLH-1150 über die Route: Art `besatzung` mit `besatzung_ids`. Erst die Felder (unbekannte Art,
/// leere oder fehlende Besatzung, mehr als 50 → 400), dann der Zusammenhang (mit ablösenden
/// Einheiten, mit „Abschnitt übergeben“, Besatzung ohne Besatzungswechsel → 422). Der Wechsel
/// verlangt die Freigabe des Moduls Einheiten (403). Die Antwort trägt Art und Besatzung, die
/// Folgeschicht hängt an derselben Einheit, das ETB nennt beide Besatzungen, die Rücknahme legt
/// die Personen zurück.
#[tokio::test]
async fn besatzungswechsel_ueber_die_route() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt(&app, &admin, e, "Deichwache Nord").await;
    let f1 = einheit(&app, &admin, e, "Florian 1", Some(nord)).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", None).await;
    let alt = person(&app, &admin, e, "Anna Alt", Some(f1)).await;
    let neu = person(&app, &admin, e, "Cora Neu", None).await;
    let (s, schicht) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(&format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":360}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(schicht["art"], "einheit");
    assert_eq!(schicht["besatzung"], serde_json::json!([]));
    let aid = schicht["id"].as_i64().unwrap();
    let vollzug = format!("{}/{aid}/vollzug", pfad(e));

    let viele = (0..51).map(|i| i.to_string()).collect::<Vec<_>>().join(",");
    for (body, code) in [
        (r#"{"art":"fahrzeug"}"#.to_string(), StatusCode::BAD_REQUEST),
        (
            r#"{"art":"besatzung"}"#.to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (
            r#"{"art":"besatzung","besatzung_ids":[]}"#.to_string(),
            StatusCode::BAD_REQUEST,
        ),
        (
            format!(r#"{{"art":"besatzung","besatzung_ids":[{viele}]}}"#),
            StatusCode::BAD_REQUEST,
        ),
        (
            format!(r#"{{"art":"besatzung","besatzung_ids":[{neu}],"abloeser_ids":[{f2}]}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!(r#"{{"art":"besatzung","besatzung_ids":[{neu}],"abschnitt_uebergeben":true}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!(r#"{{"besatzung_ids":[{neu}]}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!(r#"{{"art":"besatzung","besatzung_ids":[{alt}]}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, j) = anfrage(&app, "POST", &vollzug, &admin, Some(&body)).await;
        assert_eq!(s, code, "{body}: {j:?}");
    }

    // Ohne Freigabe des Moduls Einheiten: 403, nichts geschrieben.
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/einheiten"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let wechsel = format!(r#"{{"art":"besatzung","besatzung_ids":[{neu}]}}"#);
    let (s, _) = anfrage(&app, "POST", &vollzug, &frieda, Some(&wechsel)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/einheiten"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(mitglieder(&app, &admin, e, f1).await, vec![alt]);

    let (s, v) = anfrage(&app, "POST", &vollzug, &admin, Some(&wechsel)).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["abgeloest"]["art"], "besatzung");
    assert_eq!(
        v["abgeloest"]["besatzung"],
        serde_json::json!([
            {"personal_id": alt, "name": "Anna Alt", "rolle": "alt"},
            {"personal_id": neu, "name": "Cora Neu", "rolle": "neu"}
        ])
    );
    assert_eq!(v["abgeloest"]["ruecknehmbar"], true);
    assert_eq!(v["folgeschicht"]["einheit_id"], f1);
    assert_eq!(v["folgeschicht"]["vorgaenger_id"], aid);
    assert_eq!(mitglieder(&app, &admin, e, f1).await, vec![neu]);
    assert_eq!(
        abschnitt_von(&app, &admin, e, f1).await,
        nord,
        "Abschnitt bleibt"
    );
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(
            &etb,
            "meldung",
            "Besatzungswechsel «Florian 1», Einheit und Fahrzeug bleiben. Alte Besatzung: \
             «Anna Alt». Neue Besatzung: «Cora Neu»."
        )
        .len(),
        1,
        "{etb:?}"
    );

    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{vollzug}/zuruecknehmen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert_eq!(r["status"], "laufend");
    assert_eq!(r["art"], "einheit");
    assert_eq!(mitglieder(&app, &admin, e, f1).await, vec![alt]);
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(&etb, "berichtigung", "Besatzungswechsel rückgängig").len(),
        1
    );
}

/// LLH-1308: Bereitstellungsraum anlegen und aktivieren.
async fn raum(app: &axum::Router, cookie: &str, e: i64, bez: &str) -> i64 {
    let basis = format!("/api/einsaetze/{e}/bereitstellungsraeume");
    let (s, j) = anfrage(
        app,
        "POST",
        &basis,
        cookie,
        Some(&format!(r#"{{"bezeichnung":"{bez}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Raum: {j:?}");
    let id = j["id"].as_i64().unwrap();
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("{basis}/{id}/status"),
        cookie,
        Some(r#"{"status":"aktiv"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Raum aktiv: {j:?}");
    id
}

/// LLH-1308: Verbleib der abgelösten Einheit über die Route (400/422/403, Erfolg, Rücknahme).
#[tokio::test]
async fn vollzug_mit_verbleib_ueber_die_route() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit(&app, &admin, e, "Florian 1", None).await;
    let f2 = einheit(&app, &admin, e, "Florian 2", None).await;
    let schule = raum(&app, &admin, e, "Schule").await;
    let (s, schicht) = anfrage(
        &app,
        "POST",
        &pfad(e),
        &admin,
        Some(&format!(r#"{{"einheit_id":{f1},"rhythmus_minuten":360}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let aid = schicht["id"].as_i64().unwrap();
    let vollzug = format!("{}/{aid}/vollzug", pfad(e));

    for (body, erwartet) in [
        (
            format!(r#"{{"abloeser_ids":[{f2}],"verbleib":"unterwegs"}}"#),
            StatusCode::BAD_REQUEST,
        ),
        (
            format!(r#"{{"abloeser_ids":[{f2}],"verbleib":"bereitstellungsraum"}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!(r#"{{"abloeser_ids":[{f2}],"verbleib_br_id":{schule}}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!(
                r#"{{"abloeser_ids":[{f2}],"verbleib":"entlassen","verbleib_br_id":{schule}}}"#
            ),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            r#"{"art":"besatzung","besatzung_ids":[1],"verbleib":"entlassen"}"#.to_string(),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!(
                r#"{{"abloeser_ids":[{f2}],"verbleib":"bereitstellungsraum","verbleib_br_id":999999}}"#
            ),
            StatusCode::NOT_FOUND,
        ),
    ] {
        let (s, j) = anfrage(&app, "POST", &vollzug, &admin, Some(&body)).await;
        assert_eq!(s, erwartet, "{body}: {j:?}");
    }

    // Ohne Freigabe der Bereitstellungsräume: Raum 403, nichts geschrieben.
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/bereitstellungsraeume"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let mit_raum = format!(
        r#"{{"abloeser_ids":[{f2}],"verbleib":"bereitstellungsraum","verbleib_br_id":{schule}}}"#
    );
    let (s, _) = anfrage(&app, "POST", &vollzug, &frieda, Some(&mit_raum)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (_, liste) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert!(
        liste.to_string().contains(r#""status":"laufend""#),
        "nichts geschrieben: {liste:?}"
    );

    let (s, v) = anfrage(&app, "POST", &vollzug, &admin, Some(&mit_raum)).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["abgeloest"]["verbleib"], "bereitstellungsraum");
    assert_eq!(v["abgeloest"]["verbleib_br_bezeichnung"], "Schule");
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(
            &etb,
            "meldung",
            "«Florian 1» danach in Bereitstellungsraum Schule."
        )
        .len(),
        1,
        "{etb:?}"
    );

    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{vollzug}/zuruecknehmen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert_eq!(r["status"], "laufend");
    assert_eq!(r["verbleib"], "ruhe");
    assert!(r.get("verbleib_br_bezeichnung").is_none(), "{r:?}");

    // Entlassen braucht keine Freigabe der Bereitstellungsräume.
    let (s, v) = anfrage(
        &app,
        "POST",
        &vollzug,
        &frieda,
        Some(&format!(
            r#"{{"abloeser_ids":[{f2}],"verbleib":"entlassen"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["abgeloest"]["verbleib"], "entlassen");
}
