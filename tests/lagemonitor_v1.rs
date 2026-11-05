//! Lesezugang für externe Anzeigen und `GET /api/lagemonitor/v1/lage` (LLH-1484).
//!
//! Herleitung: `/mnt/project-files/llh-1484/design.md`, Spec
//! `/mnt/project-files/llh-1484/specs/lagemonitor-schnittstelle/spec.md`.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, einsatz_anlegen_mit,
    fremde_org_anlegen, login_cookie, rolle_setzen, setup_mit_pool, system_etb_inhalte,
};

const STELLE_SANITAET: &str =
    r#"{"v":1,"spec":{"bodyMarks":["medical-service"],"kind":"post","organization":"feuerwehr"}}"#;

/// `GET` mit Bearer-Kopf statt Sitzung.
async fn abruf(app: &axum::Router, uri: &str, schluessel: Option<&str>) -> (StatusCode, Value) {
    let mut req = Request::builder().method("GET").uri(uri);
    if let Some(s) = schluessel {
        req = req.header(header::AUTHORIZATION, format!("Bearer {s}"));
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn lage(app: &axum::Router, schluessel: &str) -> Value {
    let (s, v) = abruf(app, "/api/lagemonitor/v1/lage", Some(schluessel)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

/// Legt einen Zugang an und liefert `(id, schluessel)`.
async fn zugang(app: &axum::Router, admin: &str, bezeichnung: &str) -> (i64, String) {
    let (s, v) = anfrage_json(
        app,
        "POST",
        "/api/lagemonitor-zugaenge",
        admin,
        Some(&json!({ "bezeichnung": bezeichnung })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (
        v["zugang"]["id"].as_i64().unwrap(),
        v["schluessel"].as_str().unwrap().to_string(),
    )
}

async fn freigeben(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    zid: i64,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/lagemonitor-zugaenge/{zid}/freigabe"),
        cookie,
        None,
    )
    .await
}

#[tokio::test]
async fn ohne_gueltigen_schluessel_ist_401_und_eine_sitzung_oeffnet_nichts() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let uri = "/api/lagemonitor/v1/lage";
    assert_eq!(abruf(&app, uri, None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(
        abruf(&app, uri, Some("llh_lm_falsch")).await.0,
        StatusCode::UNAUTHORIZED
    );
    // Eine angemeldete Person ist kein Lesezugang.
    let (s, _) = anfrage(&app, "GET", uri, &admin, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // Umgekehrt öffnet der Schlüssel keine andere Route.
    let (_, schluessel) = zugang(&app, &admin, "FüKW").await;
    let (s, _) = abruf(&app, "/api/einsaetze", Some(&schluessel)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = abruf(&app, "/api/lagemonitor-zugaenge", Some(&schluessel)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn anlegen_zeigt_den_schluessel_einmal_und_schreibt_die_admin_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (id, schluessel) = zugang(&app, &admin, "  FüKW 40-12-1 ").await;
    assert!(schluessel.starts_with("llh_lm_"));

    let (s, liste) = anfrage(&app, "GET", "/api/lagemonitor-zugaenge", &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste[0]["id"], json!(id));
    assert_eq!(liste[0]["bezeichnung"], "FüKW 40-12-1");
    assert!(
        !liste.to_string().contains(&schluessel),
        "die Liste trägt den Schlüssel nie"
    );
    let gespeichert: String =
        sqlx::query_scalar("SELECT schluessel_hash FROM lagemonitor_zugang WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_ne!(gespeichert, schluessel, "gespeichert ist nur der Hash");

    let (aktion, ziel, ziel_benutzer): (String, String, Option<i64>) = sqlx::query_as(
        "SELECT aktion, ziel, ziel_benutzer_id FROM admin_audit ORDER BY id DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (aktion.as_str(), ziel.as_str(), ziel_benutzer),
        ("lesezugang_angelegt", "FüKW 40-12-1", None)
    );

    // Ohne Freigabe: 200 mit `einsatz: null`, keine Karte.
    let v = lage(&app, &schluessel).await;
    assert_eq!(v["api_version"], json!(1));
    assert!(v["einsatz"].is_null() && v.as_object().unwrap().contains_key("einsatz"));
    assert!(!v.as_object().unwrap().contains_key("karte"));
    let genutzt: Option<String> =
        sqlx::query_scalar("SELECT zuletzt_genutzt_at FROM lagemonitor_zugang WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(genutzt.is_some(), "der Abruf vermerkt die Nutzung");
}

#[tokio::test]
async fn nur_der_system_admin_legt_an_und_widerruft() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fritz", "fuehrungskraft").await;
    benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    let fk = login_cookie(&app, "fritz", "fritzpw1").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;
    let (id, _) = zugang(&app, &admin, "FüKW").await;

    // Lesen darf, wer die Verwaltung sieht.
    let (s, _) = anfrage(&app, "GET", "/api/lagemonitor-zugaenge", &fk, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "GET", "/api/lagemonitor-zugaenge", &helfer, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    // Schreiben nur der System-Admin.
    let body = json!({ "bezeichnung": "Zweiter" });
    let (s, _) = anfrage_json(&app, "POST", "/api/lagemonitor-zugaenge", &fk, Some(&body)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let widerruf = format!("/api/lagemonitor-zugaenge/{id}/widerrufen");
    let (s, _) = anfrage(&app, "POST", &widerruf, &fk, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Grenzen der Bezeichnung.
    for bezeichnung in ["   ".to_string(), "x".repeat(61)] {
        let body = json!({ "bezeichnung": bezeichnung });
        let (s, _) = anfrage_json(
            &app,
            "POST",
            "/api/lagemonitor-zugaenge",
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn freigabe_zeigt_den_einsatz_und_widerruf_beendet_alles() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Ilmenau").await;
    let (zid, schluessel) = zugang(&app, &admin, "FüKW").await;

    let (s, v) = freigeben(&app, &admin, einsatz, zid).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v[0]["freigegeben"], json!(true));
    assert_eq!(v[0]["anderer_einsatz"], json!(false));
    // Idempotent: ein zweites Freigeben schreibt kein zweites ETB.
    freigeben(&app, &admin, einsatz, zid).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        etb.iter()
            .filter(|t| t.contains("Lagemonitor-Zugang „FüKW“ freigegeben"))
            .count(),
        1,
        "{etb:?}"
    );

    let v = lage(&app, &schluessel).await;
    assert_eq!(v["einsatz"]["bezeichnung"], "Hochwasser Ilmenau");
    assert_eq!(v["einsatz"]["betroffene"]["gesamt"], json!(0));
    assert!(v["einsatz"]["lagemeldung"].is_null());
    assert_eq!(v["karte"]["type"], "FeatureCollection");
    assert_eq!(v["karte_etag"].as_str().unwrap().len(), 16);

    // Widerruf: 401, Freigabe weg, ETB nennt es.
    let (s, w) = anfrage(
        &app,
        "POST",
        &format!("/api/lagemonitor-zugaenge/{zid}/widerrufen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{w}");
    assert!(w["widerrufen_at"].is_string());
    assert!(w.get("einsatz_id").is_none());
    let (s, _) = abruf(&app, "/api/lagemonitor/v1/lage", Some(&schluessel)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lagemonitor_freigabe")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rest, 0);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(|t| t.contains("„FüKW“ widerrufen")),
        "{etb:?}"
    );
    // Ein widerrufener Zugang lässt sich nicht freigeben.
    let (s, _) = freigeben(&app, &admin, einsatz, zid).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let aktion: String =
        sqlx::query_scalar("SELECT aktion FROM admin_audit ORDER BY id DESC LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(aktion, "lesezugang_widerrufen");
}

#[tokio::test]
async fn hoechstens_ein_einsatz_je_zugang_und_abschluss_beendet_die_freigabe() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let erster = einsatz_anlegen_mit(&app, &admin, "Erster").await;
    let zweiter = einsatz_anlegen_mit(&app, &admin, "Zweiter").await;
    let (zid, schluessel) = zugang(&app, &admin, "FüKW").await;

    freigeben(&app, &admin, erster, zid).await;
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{zweiter}/lagemonitor-zugaenge"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v[0]["freigegeben"], json!(false));
    assert_eq!(v[0]["anderer_einsatz"], json!(true));

    // Umstellen löst den ersten ab, beide ETBs nennen es.
    freigeben(&app, &admin, zweiter, zid).await;
    assert_eq!(
        lage(&app, &schluessel).await["einsatz"]["bezeichnung"],
        "Zweiter"
    );
    let etb = system_etb_inhalte(&app, &admin, erster).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("zeigt jetzt einen anderen Einsatz")),
        "{etb:?}"
    );

    // Beenden am falschen Einsatz wirkt nicht; am richtigen schon.
    let beenden = |e: i64| format!("/api/einsaetze/{e}/lagemonitor-zugaenge/{zid}/freigabe");
    let (s, _) = anfrage(&app, "DELETE", &beenden(erster), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        lage(&app, &schluessel).await["einsatz"]["bezeichnung"],
        "Zweiter"
    );

    // Abschluss beendet die Freigabe.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{zweiter}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(lage(&app, &schluessel).await["einsatz"].is_null());
    let (s, _) = anfrage(&app, "DELETE", &beenden(zweiter), &admin, None).await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "am abgeschlossenen Einsatz gibt es nichts mehr zu schalten"
    );
}

#[tokio::test]
async fn freigeben_darf_nur_die_einsatzleitung_der_eigenen_org() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (zid, _) = zugang(&app, &admin, "FüKW").await;
    let helfer_id = benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    rolle_setzen(&app, &admin, einsatz, helfer_id, "fuehrungspersonal").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;
    let (s, _) = freigeben(&app, &helfer, einsatz, zid).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lagemonitor-zugaenge"),
        &helfer,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Ein Zugang einer fremden Org ist hier unbekannt.
    let (fremde_org, _) = fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw12", "keine").await;
    let fremder: i64 = sqlx::query_scalar(
        "INSERT INTO lagemonitor_zugang (org_id, bezeichnung, schluessel_hash) \
         VALUES (?, 'Fremd', 'x') RETURNING id",
    )
    .bind(fremde_org)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (s, _) = freigeben(&app, &admin, einsatz, fremder).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lagemonitor-zugaenge"),
        &admin,
        None,
    )
    .await;
    assert_eq!(v.as_array().unwrap().len(), 1, "nur der eigene: {v}");
}

#[tokio::test]
async fn lagebild_traegt_zahlen_karte_und_lagemeldung_aber_keine_personen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (zid, schluessel) = zugang(&app, &admin, "FüKW").await;
    freigeben(&app, &admin, einsatz, zid).await;

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(&json!({
            "sachverhalt": "Herr Muster gestürzt",
            "meldende_stelle": "Frau Vera",
            "einsatzort": "Musterweg 3",
            "einsatzort_lat": 52.96,
            "einsatzort_lon": 10.56,
        })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &admin,
        Some(&json!({"name": "Vermisstfrau", "vorname": "Vera", "status": "vermisst"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/freie-zeichen"),
        &admin,
        Some(&json!({
            "lat": 52.95, "lon": 10.55,
            "zeichen_spec": STELLE_SANITAET,
            "label": "Familie Muster",
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    // Lagebericht mit Zusammenfassung, freigegeben.
    let (s, lb) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(&json!({"vorlage": "lagebericht", "titel": "Lage 10:00"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{lb}");
    let lid = lb["id"].as_i64().unwrap();
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(&json!({"abschnitte": [
            {"schluessel": "zusammenfassung", "text": "Pegel steigt, Deich hält."},
            {"schluessel": "auftrag", "text": "Deich sichern."},
            {"schluessel": "gefahren_schadenlage", "text": "Hochwasser."},
            {"schluessel": "eigene_lage", "text": "Zwei Züge vor Ort."},
            {"schluessel": "lageentwicklung", "text": "Pegel steigt."},
            {"schluessel": "fuehrungsprobleme", "text": "Keine."},
            {"schluessel": "antraege_vorschlaege", "text": "Keine."},
            {"schluessel": "medienlage", "text": "Ruhig."}
        ]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let v = lage(&app, &schluessel).await;
    assert!(
        v["einsatz"]["lagemeldung"].is_null(),
        "ein Entwurf ist keine Lagemeldung"
    );
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let v = lage(&app, &schluessel).await;
    let e = &v["einsatz"];
    assert_eq!(e["betroffene"]["vermisst"], json!(1));
    assert_eq!(e["lagemeldung"]["text"], "Pegel steigt, Deich hält.");
    assert!(e["lagemeldung"]["freigegeben_at"].is_string());
    // Die Karte passt auf das veröffentlichte Schema (OpenAPI `GeoJsonFeatureCollection`).
    serde_json::from_value::<lifeline_hub::karte::typen::GeoJsonFeatureCollection>(
        v["karte"].clone(),
    )
    .expect("karte entspricht GeoJsonFeatureCollection");
    let features = v["karte"]["features"].as_array().unwrap();
    assert!(features
        .iter()
        .any(|f| f["properties"]["kind"] == "einsatzort"
            && f["geometry"]["coordinates"] == json!([10.56, 52.96])));
    let z = features
        .iter()
        .find(|f| f["properties"]["kind"] == "zeichen")
        .expect("freies Zeichen in der Karte");
    assert_eq!(z["properties"]["zeichen_spec"], STELLE_SANITAET);
    assert!(
        z["properties"].get("label").is_none(),
        "Beschriftung ist Freitext"
    );

    let text = v.to_string();
    for name in ["Muster", "Vermisstfrau", "Vera", "Musterweg"] {
        assert!(!text.contains(name), "{name} in der Antwort: {text}");
    }
    for schluessel in [
        "sachverhalt",
        "meldende_stelle",
        "person_id",
        "name",
        "label",
    ] {
        assert!(
            !text.contains(&format!("\"{schluessel}\"")),
            "Feld {schluessel} in der Antwort: {text}"
        );
    }

    // Datensparsam: mit der bekannten Fassung kommt die Karte nicht mit, mit `aus` nie.
    let etag = v["karte_etag"].as_str().unwrap().to_string();
    let (_, v) = abruf(
        &app,
        &format!("/api/lagemonitor/v1/lage?karte={etag}"),
        Some(&schluessel),
    )
    .await;
    assert!(v.get("karte").is_none());
    assert_eq!(v["karte_etag"], json!(etag));
    let (_, v) = abruf(
        &app,
        "/api/lagemonitor/v1/lage?karte=aus",
        Some(&schluessel),
    )
    .await;
    assert!(v.get("karte").is_none() && v.get("karte_etag").is_none());
    assert!(v["einsatz"].is_object());
    let (_, v) = abruf(
        &app,
        "/api/lagemonitor/v1/lage?karte=0000000000000000",
        Some(&schluessel),
    )
    .await;
    assert!(
        v["karte"].is_object(),
        "eine andere Fassung bekommt die Karte"
    );
}
