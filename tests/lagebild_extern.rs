//! Lagebild für Externe (LLH-1496, Spec `lagebild-extern`): Links der Einsatzleitung je Empfänger
//! und der öffentliche Abruf `GET /api/extern/v1/lagebild`.
//!
//! Herleitung: `/mnt/project-files/llh-1496/openspec/k11guwns-lagebild-extern/design.md`.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
mod instanz_hilfen;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, einsatz_anlegen_mit, login_cookie,
    rolle_setzen, setup_mit_pool, system_etb_inhalte,
};

const POLY: &str =
    r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
const STELLE_SANITAET: &str =
    r#"{"v":1,"spec":{"bodyMarks":["medical-service"],"kind":"post","organization":"feuerwehr"}}"#;
const EXTERN: &str = "/api/extern/v1/lagebild";

/// `GET` mit Bearer-Kopf statt Sitzung, optional mit Kennung der Öffnung.
async fn abruf_mit(
    app: &axum::Router,
    uri: &str,
    schluessel: Option<&str>,
    oeffnung: Option<&str>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method("GET").uri(uri);
    if let Some(s) = schluessel {
        req = req.header(header::AUTHORIZATION, format!("Bearer {s}"));
    }
    if let Some(o) = oeffnung {
        req = req.header("x-lagebild-oeffnung", o);
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

async fn abruf(app: &axum::Router, uri: &str, schluessel: Option<&str>) -> (StatusCode, Value) {
    abruf_mit(app, uri, schluessel, None).await
}

async fn lagebild(app: &axum::Router, schluessel: &str) -> Value {
    let (s, v) = abruf(app, EXTERN, Some(schluessel)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/lagebild-freigaben")
}

/// Legt einen Link an und liefert `(antwort, schluessel)`.
async fn freigabe(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    empfaenger: &str,
    stufe: &str,
    dauer: &str,
) -> (Value, String) {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &pfad(einsatz),
        cookie,
        Some(&json!({ "empfaenger": empfaenger, "stufe": stufe, "dauer": dauer })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let schluessel = v["schluessel"].as_str().unwrap().to_string();
    (v, schluessel)
}

async fn widerrufen(app: &axum::Router, cookie: &str, einsatz: i64, fid: i64) -> StatusCode {
    anfrage(
        app,
        "POST",
        &format!("{}/{fid}/widerrufen", pfad(einsatz)),
        cookie,
        None,
    )
    .await
    .0
}

#[tokio::test]
async fn anlegen_zeigt_den_schluessel_einmal_und_schreibt_das_etb() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Ilmenau").await;

    let (v, schluessel) = freigabe(
        &app,
        &admin,
        einsatz,
        "  Krisenstab Kreis ",
        "lagebild",
        "24h",
    )
    .await;
    assert!(schluessel.starts_with("llh_lb_"), "{schluessel}");
    let f = &v["freigabe"];
    assert_eq!(f["empfaenger"], "Krisenstab Kreis");
    assert_eq!(f["stufe"], "lagebild");
    assert_eq!(f["gueltig"], json!(true));
    assert!(f["gueltig_bis"].is_string(), "{f}");
    assert_eq!(f["oeffnungen"], json!(0));
    let fid = f["id"].as_i64().unwrap();

    let gespeichert: String =
        sqlx::query_scalar("SELECT schluessel_hash FROM lagebild_freigabe WHERE id = ?")
            .bind(fid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_ne!(gespeichert, schluessel, "gespeichert ist nur der Hash");
    assert!(!gespeichert.contains("llh_lb_"));

    let (s, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    assert_eq!(liste[0]["id"], json!(fid));
    assert!(
        !liste.to_string().contains(&schluessel),
        "die Liste trägt den Schlüssel nie"
    );

    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(|t| t.contains(
            "Lagebild für Externe an „Krisenstab Kreis“ freigegeben (Stufe Lagebild, gültig 24 Stunden)"
        )),
        "{etb:?}"
    );

    // Bis Einsatzende: ohne Ablaufzeit.
    let (v, _) = freigabe(
        &app,
        &admin,
        einsatz,
        "Presse",
        "oeffentlich",
        "einsatzende",
    )
    .await;
    assert!(!v["freigabe"]
        .as_object()
        .unwrap()
        .contains_key("gueltig_bis"));
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("(Stufe Öffentlich, gültig bis zum Einsatzende)")),
        "{etb:?}"
    );
}

#[tokio::test]
async fn grenzen_und_unbekannte_werte_sind_400() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for body in [
        json!({ "empfaenger": "   ", "stufe": "lagebild", "dauer": "24h" }),
        json!({ "empfaenger": "x".repeat(81), "stufe": "lagebild", "dauer": "24h" }),
        json!({ "empfaenger": "Presse", "stufe": "alles", "dauer": "24h" }),
        json!({ "empfaenger": "Presse", "stufe": "lagebild", "dauer": "48h" }),
    ] {
        let (s, v) = anfrage_json(&app, "POST", &pfad(einsatz), &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    freigabe(&app, &admin, einsatz, &"x".repeat(80), "lagebild", "2h").await;
}

#[tokio::test]
async fn nur_die_einsatzleitung_gibt_frei_sieht_und_widerruft() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (v, _) = freigabe(&app, &admin, einsatz, "Krisenstab", "lagebild", "24h").await;
    let fid = v["freigabe"]["id"].as_i64().unwrap();
    let helfer_id = benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    rolle_setzen(&app, &admin, einsatz, helfer_id, "fuehrungspersonal").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;

    let (s, _) = anfrage(&app, "GET", &pfad(einsatz), &helfer, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let body = json!({ "empfaenger": "Presse", "stufe": "oeffentlich", "dauer": "2h" });
    let (s, _) = anfrage_json(&app, "POST", &pfad(einsatz), &helfer, Some(&body)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        widerrufen(&app, &helfer, einsatz, fid).await,
        StatusCode::FORBIDDEN
    );

    // Ein Link eines anderen Einsatzes ist hier unbekannt.
    let anderer = einsatz_anlegen(&app, &admin).await;
    assert_eq!(
        widerrufen(&app, &admin, anderer, fid).await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn ohne_gueltigen_schluessel_ist_401_und_der_schluessel_oeffnet_nichts_anderes() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(abruf(&app, EXTERN, None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(
        abruf(&app, EXTERN, Some("llh_lb_falsch")).await.0,
        StatusCode::UNAUTHORIZED
    );
    // Eine angemeldete Person ist kein Link.
    let (s, _) = anfrage(&app, "GET", EXTERN, &admin, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, schluessel) = freigabe(&app, &admin, einsatz, "Krisenstab", "lagebild", "24h").await;
    for uri in [
        "/api/einsaetze".to_string(),
        format!("/api/einsaetze/{einsatz}"),
        pfad(einsatz),
        "/api/lagemonitor/v1/lage".to_string(),
    ] {
        let (s, _) = abruf(&app, &uri, Some(&schluessel)).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "{uri}");
    }

    // Der Karten-Proxy lässt den Link durch (die Quelle gibt es nicht: 404), ohne ihn nicht.
    let kachel = "/api/karte/proxy/999999/raster/1/0/0";
    assert_eq!(abruf(&app, kachel, None).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(
        abruf(&app, kachel, Some("llh_lb_falsch")).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        abruf(&app, kachel, Some(&schluessel)).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn stufe_lagebild_traegt_zahlen_karte_und_lagemeldung_aber_keine_namen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Ilmenau").await;
    let (_, schluessel) = freigabe(&app, &admin, einsatz, "Krisenstab", "lagebild", "24h").await;

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

    let v = lagebild(&app, &schluessel).await;
    assert_eq!(v["api_version"], json!(1));
    assert_eq!(v["stufe"], "lagebild");
    assert_eq!(v["empfaenger"], "Krisenstab");
    assert!(v["gueltig_bis"].is_string());
    assert_eq!(v["quelle"]["spiegel"], json!(false));
    assert_eq!(v["nicht_uebertragen"], json!([]));
    let e = &v["einsatz"];
    assert_eq!(e["bezeichnung"], "Hochwasser Ilmenau");
    assert_eq!(e["betroffene_gesamt"], json!(1));
    assert_eq!(e["betroffene"]["vermisst"], json!(1));
    assert!(e["kraefte"].is_object() && e["uhs"].is_array());
    assert!(e["einsatzkraefte_gesamt"].is_i64());
    serde_json::from_value::<lifeline_hub::karte::typen::GeoJsonFeatureCollection>(
        v["karte"].clone(),
    )
    .expect("karte entspricht GeoJsonFeatureCollection");
    let arten: Vec<&str> = v["karte"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["properties"]["kind"].as_str().unwrap())
        .collect();
    assert!(
        arten.contains(&"einsatzort") && arten.contains(&"zeichen"),
        "{arten:?}"
    );

    let text = v.to_string();
    for name in ["Muster", "Vermisstfrau", "Vera", "Musterweg"] {
        assert!(!text.contains(name), "{name} in der Antwort: {text}");
    }
    for feld in ["sachverhalt", "meldende_stelle", "person_id", "label"] {
        assert!(
            !text.contains(&format!("\"{feld}\"")),
            "Feld {feld} in der Antwort: {text}"
        );
    }

    // Datensparsam wie der Lagemonitor: bekannte Fassung ohne Karte, `aus` ganz ohne.
    let etag = v["karte_etag"].as_str().unwrap().to_string();
    let (_, v) = abruf(&app, &format!("{EXTERN}?karte={etag}"), Some(&schluessel)).await;
    assert!(v.get("karte").is_none());
    assert_eq!(v["karte_etag"], json!(etag));
    let (_, v) = abruf(&app, &format!("{EXTERN}?karte=aus"), Some(&schluessel)).await;
    assert!(v.get("karte").is_none() && v.get("karte_etag").is_none());
}

#[tokio::test]
async fn stufe_oeffentlich_zeigt_nur_gesamtzahlen_einsatzort_und_absperrungen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Ilmenau").await;
    let (_, schluessel) = freigabe(&app, &admin, einsatz, "Presse", "oeffentlich", "12h").await;
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(&json!({ "einsatzort_lat": 52.96, "einsatzort_lon": 10.56 })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for typ in ["absperrbereich", "gefahrengebiet", "sperrgebiet"] {
        let body = json!({"typ": typ, "geometrie_typ": "Polygon", "geometrie": POLY,
                          "label": "Halle 3"})
        .to_string();
        let (s, z) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/zonen"),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{z}");
    }
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &admin,
        Some(&json!({"name": "Muster", "status": "vermisst"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let v = lagebild(&app, &schluessel).await;
    assert_eq!(v["stufe"], "oeffentlich");
    let e = v["einsatz"].as_object().unwrap();
    assert_eq!(e["betroffene_gesamt"], json!(1));
    assert!(e.contains_key("einsatzkraefte_gesamt"));
    for feld in [
        "betroffene",
        "sanitaetsdienst",
        "kraefte",
        "uhs",
        "lagemeldung",
    ] {
        assert!(!e.contains_key(feld), "{feld} in der Stufe öffentlich");
    }
    assert_eq!(
        v["nicht_uebertragen"],
        json!([]),
        "abbestellt, nicht fehlend"
    );
    let mut arten: Vec<String> = v["karte"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| {
            format!(
                "{}:{}",
                f["properties"]["kind"].as_str().unwrap(),
                f["properties"]["typ"].as_str().unwrap_or("")
            )
        })
        .collect();
    arten.sort();
    assert_eq!(
        arten,
        ["einsatzort:", "zone:absperrbereich", "zone:sperrgebiet"]
    );
    assert!(!v.to_string().contains("Halle 3"));
}

#[tokio::test]
async fn widerruf_ablauf_und_abschluss_beenden_den_link() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Widerruf: sofort 401, idempotent, ETB nennt es einmal.
    let (v, erster) = freigabe(&app, &admin, einsatz, "Krisenstab", "lagebild", "24h").await;
    let fid = v["freigabe"]["id"].as_i64().unwrap();
    lagebild(&app, &erster).await;
    assert_eq!(widerrufen(&app, &admin, einsatz, fid).await, StatusCode::OK);
    assert_eq!(widerrufen(&app, &admin, einsatz, fid).await, StatusCode::OK);
    assert_eq!(
        abruf(&app, EXTERN, Some(&erster)).await.0,
        StatusCode::UNAUTHORIZED
    );
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        etb.iter()
            .filter(|t| t.contains("Lagebild für Externe an „Krisenstab“ widerrufen"))
            .count(),
        1,
        "{etb:?}"
    );

    // Abgelaufen: 401.
    let (v, zweiter) = freigabe(&app, &admin, einsatz, "Nachbar-OV", "lagebild", "2h").await;
    lagebild(&app, &zweiter).await;
    sqlx::query(
        "UPDATE lagebild_freigabe SET gueltig_bis = datetime('now', '-1 minute') WHERE id = ?",
    )
    .bind(v["freigabe"]["id"].as_i64().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        abruf(&app, EXTERN, Some(&zweiter)).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Abschluss beendet einen Link bis Einsatzende; danach gibt es keinen neuen.
    let (_, dritter) = freigabe(
        &app,
        &admin,
        einsatz,
        "Presse",
        "oeffentlich",
        "einsatzende",
    )
    .await;
    lagebild(&app, &dritter).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        abruf(&app, EXTERN, Some(&dritter)).await.0,
        StatusCode::UNAUTHORIZED
    );
    let body = json!({ "empfaenger": "Presse", "stufe": "oeffentlich", "dauer": "2h" });
    let (s, _) = anfrage_json(&app, "POST", &pfad(einsatz), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CONFLICT);

    // Die Liste behält alle drei samt Protokoll, keiner gilt mehr.
    let (s, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 3);
    assert!(
        liste.iter().all(|f| f["gueltig"] == json!(false)),
        "{liste:?}"
    );
    assert!(
        liste.iter().all(|f| f["oeffnungen"] == json!(1)),
        "{liste:?}"
    );
}

#[tokio::test]
async fn das_protokoll_zaehlt_je_oeffnung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (v, schluessel) = freigabe(&app, &admin, einsatz, "Krisenstab", "lagebild", "24h").await;
    let fid = v["freigabe"]["id"].as_i64().unwrap();

    for oeffnung in ["a-1", "a-1", "a-1", "b-2"] {
        let (s, _) = abruf_mit(&app, EXTERN, Some(&schluessel), Some(oeffnung)).await;
        assert_eq!(s, StatusCode::OK);
    }
    let zeilen: Vec<(String, i64)> = sqlx::query_as(
        "SELECT oeffnung, abrufe FROM lagebild_abruf WHERE freigabe_id = ? ORDER BY oeffnung",
    )
    .bind(fid)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen, [("a-1".to_string(), 3), ("b-2".to_string(), 1)]);

    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    let f = &liste[0];
    assert_eq!(f["oeffnungen"], json!(2));
    assert!(f["zuletzt_abgerufen_at"].is_string());
    let protokoll = f["protokoll"].as_array().unwrap();
    assert_eq!(protokoll.len(), 2);
    let abrufe: i64 = protokoll
        .iter()
        .map(|o| o["abrufe"].as_i64().unwrap())
        .sum();
    assert_eq!(abrufe, 4);
    assert!(
        !liste.to_string().contains("a-1"),
        "die Kennung der Öffnung bleibt am Server"
    );
}

// ── Am Spiegel (design.md D7, D8) ────────────────────────────────────────────────────────────

#[tokio::test]
async fn am_spiegel_gilt_der_link_hier_und_das_etb_geht_als_antrag_an_den_fuehrer() {
    use instanz_hilfen::*;

    let (hub, elw) = gekoppelt().await;
    melden(&elw).await;
    // Ein Konto, das der Hub an den ELW verteilt; am ELW leitet es den Einsatz.
    let (s, v) = anfrage_json(
        &hub.app,
        "POST",
        "/api/benutzer",
        &hub.admin,
        Some(&json!({"anzeigename": "Erika", "benutzername": "erika",
                     "passwort": "erikapw12345"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    exec(
        &hub.pool,
        "UPDATE benutzer SET passwort_wechsel_pflicht = 0",
    )
    .await;
    let erika = login_cookie(&hub.app, "erika", "erikapw12345").await;
    melden(&elw).await;
    let erika_elw = lokale_id(&elw, "benutzer", "benutzername", "erika").await;
    let e = einsatz_anlegen_mit(&elw.app, &elw.admin, "Deichbruch").await;
    rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "einsatzleitung").await;
    let abgleichen = || async {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    };
    abgleichen().await;
    let s: i64 = eine(&hub.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;

    let (v, schluessel) = freigabe(&hub.app, &erika, s, "Krisenstab", "lagebild", "24h").await;
    assert_eq!(v["freigabe"]["empfaenger"], "Krisenstab");
    let fid = v["freigabe"]["id"].as_i64().unwrap();
    let antrag: (String, String) = sqlx::query_as(
        "SELECT art, json_extract(daten, '$.inhalt') FROM spiegel_antrag WHERE einsatz_id = ?",
    )
    .bind(s)
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert_eq!(antrag.0, "etb");
    assert!(
        antrag
            .1
            .starts_with("Lagebild für Externe an „Krisenstab“ freigegeben"),
        "{}",
        antrag.1
    );

    let v = lagebild(&hub.app, &schluessel).await;
    assert_eq!(v["einsatz"]["bezeichnung"], "Deichbruch");
    assert_eq!(v["quelle"]["spiegel"], json!(true));
    assert!(v["quelle"]["letzter_abgleich_at"].is_string(), "{v}");
    assert_eq!(v["quelle"]["abgleich_beendet"], json!(false));
    assert_eq!(v["nicht_uebertragen"], json!([]));

    for _ in 0..3 {
        abgleichen().await;
    }
    let am_elw: i64 = eine(
        &elw.pool,
        &format!(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = {e} \
             AND inhalt LIKE 'Lagebild für Externe an „Krisenstab“ freigegeben%'"
        ),
    )
    .await;
    assert_eq!(am_elw, 1, "der Führer übernimmt den Eintrag");
    // Der Link gilt nur am Hub: der ELW kennt ihn nicht.
    let freigaben_elw: i64 = eine(&elw.pool, "SELECT COUNT(*) FROM lagebild_freigabe").await;
    assert_eq!(freigaben_elw, 0);
    assert_eq!(
        abruf(&elw.app, EXTERN, Some(&schluessel)).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Endet der Abgleich, gilt der Widerruf trotzdem; nur der Antrag entfällt.
    exec(
        &hub.pool,
        &format!("UPDATE einsatz_spiegel SET beendet_at = datetime('now') WHERE einsatz_id = {s}"),
    )
    .await;
    let antraege_vorher: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM spiegel_antrag").await;
    assert_eq!(widerrufen(&hub.app, &erika, s, fid).await, StatusCode::OK);
    assert_eq!(
        abruf(&hub.app, EXTERN, Some(&schluessel)).await.0,
        StatusCode::UNAUTHORIZED
    );
    let antraege_nachher: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM spiegel_antrag").await;
    assert_eq!(
        antraege_nachher, antraege_vorher,
        "kein Antrag nach dem Abgleich"
    );
}
