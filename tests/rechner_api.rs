//! Rechner-API Unterkunft und Zelte für Fremdsysteme (LLH-1524, Spec `rechner-api-unterkunft`):
//! `POST /api/v1/rechner/unterkunft` und `GET /api/v1/rechner/unterkunft/richtwerte`, signiert
//! als Maschinenzugang mit dem Scope `rechner:use`.
//!
//! Die Prüfung der Eingabe im Einzelnen und die Gleichheit mit dem Rechner der Oberfläche belegen
//! die Unit-Tests in `src/public_api/rechner/tests.rs`; hier steht, was nur über die Route sichtbar
//! wird: Anmeldung, Scope, Signatur, Werte der Organisation und die Fehlerform.

use axum::http::StatusCode;
use lifeline_machine_client::Credentials;
use serde_json::{json, Value};

mod common;
use common::maschine::{angebunden, jetzt, schluessel, senden, signiert, signiert_mit_body};
use common::{
    anfrage, anfrage_json, einsatz_anlegen_mit, fremde_org_anlegen, login_cookie, setup_mit_pool,
};

const RECHNEN: &str = "/api/v1/rechner/unterkunft";
const RICHTWERTE: &str = "/api/v1/rechner/unterkunft/richtwerte";

/// Router, Pool, Admin-Sitzung und ein Zugang mit `rechner:use`. `n` unterscheidet Schlüssel und
/// Quelle je Test: die Zähler je Quelle gelten prozessweit.
async fn aufbau(n: u8) -> (axum::Router, sqlx::SqlitePool, String, Credentials, String) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ip = format!("198.51.100.{n}");
    let cred = angebunden(&app, &admin, json!(["rechner:use"]), &schluessel(n), &ip).await;
    (app, pool, admin, cred, ip)
}

/// Rechnet signiert; die `jti` entsteht aus dem Body-Zähler des Aufrufers.
async fn rechnen(
    app: &axum::Router,
    cred: &Credentials,
    ip: &str,
    jti: &str,
    body: &Value,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    signiert_mit_body(
        app,
        cred,
        "POST",
        RECHNEN,
        body.to_string().into_bytes(),
        jetzt(),
        jti,
        ip,
    )
    .await
}

fn richtwert<'a>(antwort: &'a Value, schluessel: &str) -> &'a Value {
    antwort["richtwerte"]
        .as_array()
        .expect("richtwerte ist eine Liste")
        .iter()
        .find(|r| r["schluessel"] == schluessel)
        .unwrap_or_else(|| panic!("{schluessel} fehlt in {antwort}"))
}

/// Setzt als Admin einen Richtwert der eigenen Organisation über die interne Route.
async fn org_wert_setzen(app: &axum::Router, admin: &str, schluessel: &str, wert: f64) {
    let (s, v) = anfrage_json(
        app,
        "PUT",
        &format!("/api/org-unterkunft-richtwerte/{schluessel}"),
        admin,
        Some(&json!({ "wert": wert })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Akzeptanz aus LLH-1524: 100 Personen mit eigenem Wasserwert.
#[tokio::test]
async fn hundert_personen_mit_eigenem_wasserwert() {
    let (app, _pool, _admin, cred, ip) = aufbau(201).await;
    let body = json!({
        "weg": "personen",
        "trennung": false,
        "personen": { "gesamt": 100 },
        "richtwerte": { "wasser_je_person_l": 15 }
    });
    let (s, h, v) = rechnen(&app, &cred, &ip, "r1", &body).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(h.contains_key("lifeline-signature"), "Antwort signiert");
    assert_eq!(h["cache-control"], "no-store");

    assert_eq!(v["ergebnis"]["versorgung"]["wasser_l_tag"], 1500);
    assert_eq!(v["ergebnis"]["personen"], 100);
    assert!(v["ergebnis"]["kapazitaet"].is_null());
    assert_eq!(v["stand"], "2026-11-01");

    let richtwerte = v["richtwerte"].as_array().unwrap();
    assert_eq!(
        richtwerte.len(),
        38,
        "jeder Schlüssel der Basis genau einmal"
    );
    let wasser = richtwert(&v, "wasser_je_person_l");
    assert_eq!(
        (wasser["wert"].as_f64(), &wasser["herkunft"]),
        (Some(15.0), &json!("anfrage"))
    );
    for r in richtwerte {
        if r["schluessel"] != "wasser_je_person_l" {
            assert_eq!(r["herkunft"], "basis", "{r}");
        }
    }
}

/// Die Beispielanfrage aus `docs/api/maschinenzugang.md`, wörtlich.
#[tokio::test]
async fn beispiel_der_doku_ergibt_70_plaetze() {
    let (app, _pool, _admin, cred, ip) = aufbau(202).await;
    let body: Value = serde_json::from_str(
        r#"{
          "weg": "raeume",
          "trennung": false,
          "raeume": [
            { "bezeichnung": "Halle", "laenge_m": 15, "breite_m": 13.5,
              "abzuege": [{ "laenge_m": 4, "breite_m": 2.5 }] },
            { "bezeichnung": "Gymnastikraum", "laenge_m": 12, "breite_m": 8,
              "abzuege": [{ "laenge_m": 3, "breite_m": 2 }] }
          ]
        }"#,
    )
    .unwrap();
    let (s, _, v) = rechnen(&app, &cred, &ip, "d1", &body).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let kapazitaet = &v["ergebnis"]["kapazitaet"];
    assert_eq!(kapazitaet["plaetze"], 70);
    assert_eq!(kapazitaet["raeume"][0]["plaetze"], 48);
    assert_eq!(kapazitaet["raeume"][1]["plaetze"], 22);
    assert_eq!(kapazitaet["raeume"][0]["bezeichnung"], "Halle");
}

#[tokio::test]
async fn werte_der_eigenen_organisation_wirken_fremde_nicht() {
    let (app, pool, admin, cred, ip) = aufbau(203).await;
    let (fremd_org, fremd_benutzer) =
        fremde_org_anlegen(&pool, "Fremd-Orga", "fremdadmin", "fremdpw12", "keine").await;
    sqlx::query(
        "INSERT INTO org_unterkunft_richtwert (org_id, schluessel, wert, geaendert_at, geaendert_von) \
         VALUES (?, 'wasser_je_person_l', 40, datetime('now'), ?)",
    )
    .bind(fremd_org)
    .bind(fremd_benutzer)
    .execute(&pool)
    .await
    .unwrap();
    org_wert_setzen(&app, &admin, "flaeche_je_person_m2", 5.0).await;

    let body = json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": 100 } });
    let (s, _, v) = rechnen(&app, &cred, &ip, "o1", &body).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["ergebnis"]["schlafen"]["flaeche_m2"].as_f64(),
        Some(500.0)
    );
    assert_eq!(richtwert(&v, "flaeche_je_person_m2")["herkunft"], "org");
    // Der Wert der fremden Organisation bleibt draußen.
    assert_eq!(v["ergebnis"]["versorgung"]["wasser_l_tag"], 2500);
    assert_eq!(richtwert(&v, "wasser_je_person_l")["herkunft"], "basis");

    // Die Anfrage geht dem Wert der Organisation vor.
    let mut eigen = body.clone();
    eigen["richtwerte"] = json!({ "flaeche_je_person_m2": 3.5 });
    let (s, _, v) = rechnen(&app, &cred, &ip, "o2", &eigen).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["ergebnis"]["schlafen"]["flaeche_m2"].as_f64(),
        Some(350.0)
    );
    assert_eq!(richtwert(&v, "flaeche_je_person_m2")["herkunft"], "anfrage");
}

#[tokio::test]
async fn die_rechnung_speichert_nichts() {
    let (app, pool, admin, cred, ip) = aufbau(204).await;
    org_wert_setzen(&app, &admin, "wasser_je_person_l", 30.0).await;
    let vorher: Vec<(i64, String, f64)> =
        sqlx::query_as("SELECT org_id, schluessel, wert FROM org_unterkunft_richtwert")
            .fetch_all(&pool)
            .await
            .unwrap();

    let body = json!({
        "weg": "personen", "trennung": false, "personen": { "gesamt": 10 },
        "richtwerte": { "wasser_je_person_l": 15 }
    });
    let (s, _, v) = rechnen(&app, &cred, &ip, "s1", &body).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ergebnis"]["versorgung"]["wasser_l_tag"], 150);

    let nachher: Vec<(i64, String, f64)> =
        sqlx::query_as("SELECT org_id, schluessel, wert FROM org_unterkunft_richtwert")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(vorher, nachher);
    let einsatz_werte: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_unterkunft_richtwert")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(einsatz_werte, 0);

    // Die Auskunft nennt weiter den Wert der Organisation, nicht den der Anfrage.
    let (s, _, v) = signiert(&app, &cred, "GET", RICHTWERTE, jetzt(), "s2", &ip).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        richtwert(&v, "wasser_je_person_l")["wert"].as_f64(),
        Some(30.0)
    );
}

#[tokio::test]
async fn ungueltige_eingaben_tragen_code_und_nennen_das_feld() {
    let (app, _pool, _admin, cred, ip) = aufbau(205).await;
    let personen = json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": 100 } });
    let mit = |feld: &str, wert: Value| {
        let mut body = personen.clone();
        body[feld] = wert;
        body
    };
    let faelle = [
        // Akzeptanz aus LLH-1524: unbekannter Richtwert.
        (
            mit("richtwerte", json!({ "foo": 1 })),
            400,
            "invalid_field",
            "foo",
        ),
        (
            mit("richtwerte", json!({ "wasser_je_person_l": 4 })),
            400,
            "invalid_field",
            "wasser_je_person_l muss zwischen 5 und 500 liegen",
        ),
        // Ein unbekanntes Feld nennt seinen Namen.
        (mit("einsatz", json!(1)), 400, "invalid_field", "einsatz"),
        // `einsatz_id` ist eine ganze Zahl (LLH-1856).
        (
            mit("einsatz_id", json!("1")),
            400,
            "invalid_field",
            "einsatz_id",
        ),
        // Ein falscher Typ nennt den Pfad des Felds.
        (
            json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": "100" } }),
            400,
            "invalid_field",
            "personen.gesamt",
        ),
        (mit("raeume", json!([])), 422, "unprocessable", "raeume"),
        (
            json!({ "weg": "personen", "trennung": true, "personen": { "gesamt": 100 } }),
            422,
            "unprocessable",
            "personen.gesamt",
        ),
    ];
    for (i, (body, status, code, text)) in faelle.iter().enumerate() {
        let (s, h, v) = rechnen(&app, &cred, &ip, &format!("u{i}"), body).await;
        assert_eq!(s.as_u16(), *status, "{body} → {v}");
        assert_eq!(v["code"], *code, "{body} → {v}");
        let fehler = v["error"].as_str().unwrap();
        assert!(
            fehler.contains(text),
            "{body}: „{fehler}“ nennt {text} nicht"
        );
        assert_eq!(h["cache-control"], "no-store");
    }

    // Kein JSON: leerer Body und kaputter Body.
    for (i, body) in [&b""[..], &b"{\"weg\": "[..]].into_iter().enumerate() {
        let (s, _, v) = signiert_mit_body(
            &app,
            &cred,
            "POST",
            RECHNEN,
            body.to_vec(),
            jetzt(),
            &format!("k{i}"),
            &ip,
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
        assert_eq!(v["code"], "invalid_field");
    }
}

#[tokio::test]
async fn ohne_scope_403_und_ohne_anmeldung_401() {
    let (app, _pool, admin, _cred, ip) = aufbau(206).await;
    let nur_lage = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(207), &ip).await;
    let body = json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": 1 } });

    let (s, _, v) = rechnen(&app, &nur_lage, &ip, "f1", &body).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["code"], "missing_scope");
    let (s, _, v) = signiert(&app, &nur_lage, "GET", RICHTWERTE, jetzt(), "f2", &ip).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["code"], "missing_scope");

    for (methode, pfad, body) in [
        ("POST", RECHNEN, body.to_string().into_bytes()),
        ("GET", RICHTWERTE, vec![]),
    ] {
        let (s, _, bytes) = senden(&app, methode, pfad, None, body, &ip).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED, "{methode} {pfad}");
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["code"], "unauthorized");
    }

    // Eine Sitzung der Oberfläche gilt unter /api/v1/ nicht.
    let (s, v) = anfrage_json(&app, "GET", RICHTWERTE, &admin, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "{v}");
}

#[tokio::test]
async fn auskunft_nennt_richtwerte_mit_angaben_und_zelttypen() {
    let (app, _pool, admin, cred, ip) = aufbau(208).await;
    org_wert_setzen(&app, &admin, "wasser_je_person_l", 30.0).await;

    let (s, h, v) = signiert(&app, &cred, "GET", RICHTWERTE, jetzt(), "a1", &ip).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(h.contains_key("lifeline-signature"), "Antwort signiert");
    assert_eq!(v["stand"], "2026-11-01");

    let richtwerte = v["richtwerte"].as_array().unwrap();
    assert_eq!(richtwerte.len(), 38);
    assert_eq!(
        richtwert(&v, "wasser_je_person_l"),
        &json!({
            "schluessel": "wasser_je_person_l",
            "bezeichnung": "Wasser je Person und Tag",
            "gruppe": "versorgung",
            "einheit": "l",
            "min": 5.0,
            "max": 500.0,
            "ganzzahl": false,
            "basis": 25.0,
            "wert": 30.0,
            "herkunft": "org"
        })
    );
    assert_eq!(richtwert(&v, "dusche_je_personen")["herkunft"], "basis");
    // Schlank: weder Quelle noch Beleg, und keine Ebene eines Einsatzes.
    for r in richtwerte {
        let felder = r.as_object().unwrap();
        assert_eq!(felder.len(), 10, "{r}");
        assert!(!felder.contains_key("quelle") && !felder.contains_key("einsatz"));
    }

    assert_eq!(
        v["zelttypen"],
        json!([
            { "typ": "sg20", "bezeichnung": "SG 20" },
            { "typ": "sg30", "bezeichnung": "SG 30" },
            { "typ": "sg40", "bezeichnung": "SG 40" },
            { "typ": "sg50", "bezeichnung": "SG 50" }
        ])
    );
}

/// Die Feldgrenzen passen zur Body-Grenze der öffentlichen API (64 KiB): die größte Anfrage in
/// üblicher Schreibweise (200 Räume mit Namen, je 5 Abzüge, Maße mit zwei Nachkommastellen) wird
/// gerechnet. Was darüber liegt, endet vor dem Handler mit 413.
#[tokio::test]
async fn groesste_anfrage_passt_in_den_body() {
    use lifeline_hub::unterkunft::rechner::{ABZUEGE_MAX, RAEUME_MAX};
    let (app, _pool, _admin, cred, ip) = aufbau(210).await;
    let raum = |i: usize, name: usize| {
        json!({
            "bezeichnung": format!("Raum {i:03} {}", "x".repeat(name)),
            "laenge_m": 123.45,
            "breite_m": 67.89,
            "belegung": if i % 2 == 0 { "maenner" } else { "frauen" },
            "abzuege": vec![json!({ "laenge_m": 12.34, "breite_m": 5.67 }); ABZUEGE_MAX],
        })
    };
    let anfrage = |name: usize| {
        json!({
            "weg": "raeume",
            "trennung": true,
            "raeume": (0..RAEUME_MAX).map(|i| raum(i, name)).collect::<Vec<_>>(),
        })
    };

    let body = anfrage(20);
    let bytes = body.to_string().len();
    assert!(
        bytes <= lifeline_hub::app::PUBLIC_API_BODY_MAX,
        "{bytes} Bytes"
    );
    let (s, _, v) = rechnen(&app, &cred, &ip, "g1", &body).await;
    assert_eq!(s, StatusCode::OK, "{bytes} Bytes → {v}");
    assert_eq!(
        v["ergebnis"]["kapazitaet"]["raeume"]
            .as_array()
            .unwrap()
            .len(),
        RAEUME_MAX
    );

    // Mit langen Bezeichnungen liegt dieselbe Anfrage über 64 KiB.
    let zu_gross = anfrage(70);
    assert!(zu_gross.to_string().len() > lifeline_hub::app::PUBLIC_API_BODY_MAX);
    let (s, _, v) = rechnen(&app, &cred, &ip, "g2", &zu_gross).await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE, "{v}");
    assert_eq!(v["code"], "payload_too_large");
}

/// Jeder Abruf steht im Abrufprotokoll des Zugangs, je Route (ADR-0022).
#[tokio::test]
async fn abrufe_stehen_im_abrufprotokoll() {
    let (app, pool, _admin, cred, ip) = aufbau(209).await;
    let body = json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": 1 } });
    let (s, _, _) = rechnen(&app, &cred, &ip, "p1", &body).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _, _) = signiert(&app, &cred, "GET", RICHTWERTE, jetzt(), "p2", &ip).await;
    assert_eq!(s, StatusCode::OK);

    let mut routen: Vec<String> = sqlx::query_scalar("SELECT route FROM maschine_abruf")
        .fetch_all(&pool)
        .await
        .unwrap();
    routen.sort();
    assert_eq!(routen, [RECHNEN, RICHTWERTE]);
}

// ---------------------------------------------------------------------------------------------
// LLH-1856: Werte eines freigegebenen Einsatzes über `einsatz_id`.
// ---------------------------------------------------------------------------------------------

/// Ein Zugang, wie ihn die Doku für Einsatz-Werte empfiehlt: `rechner:use` und `einsaetze:read`.
async fn planung(app: &axum::Router, admin: &str, n: u8, ip: &str) -> Credentials {
    angebunden(
        app,
        admin,
        json!(["rechner:use", "einsaetze:read"]),
        &schluessel(n),
        ip,
    )
    .await
}

/// Die Einsatzleitung gibt den Einsatz für den Zugang frei (Paneel „Anbindungen“).
async fn einsatz_freigeben(app: &axum::Router, admin: &str, einsatz: i64, cred: &Credentials) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!(
            "/api/einsaetze/{einsatz}/anbindungen/{}/freigabe",
            cred.zugang_id
        ),
        admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Setzt einen Richtwert des Einsatzes über die interne Route (Einstellungen des Einsatzes).
async fn einsatz_wert_setzen(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    schluessel: &str,
    wert: f64,
) {
    let (s, v) = anfrage_json(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/unterkunft-richtwerte/{schluessel}"),
        admin,
        Some(&json!({ "wert": wert })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

fn personen_mit_einsatz(einsatz: Value) -> Value {
    json!({
        "weg": "personen",
        "trennung": false,
        "personen": { "gesamt": 100 },
        "einsatz_id": einsatz
    })
}

/// Akzeptanz aus LLH-1856: Ein Zugang mit Freigabe für E rechnet mit dem Wert von E und bekommt
/// die Herkunft `einsatz`; Anfrage vor Einsatz vor Organisation; ohne `einsatz_id` wie bisher.
#[tokio::test]
async fn rechnet_mit_den_werten_des_freigegebenen_einsatzes() {
    let (app, _pool, admin, _cred, ip) = aufbau(221).await;
    let cred = planung(&app, &admin, 222, &ip).await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    org_wert_setzen(&app, &admin, "wasser_je_person_l", 30.0).await;
    org_wert_setzen(&app, &admin, "flaeche_je_person_m2", 5.0).await;
    einsatz_wert_setzen(&app, &admin, einsatz, "wasser_je_person_l", 40.0).await;
    einsatz_freigeben(&app, &admin, einsatz, &cred).await;

    let (s, h, v) = rechnen(
        &app,
        &cred,
        &ip,
        "e1",
        &personen_mit_einsatz(json!(einsatz)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(h.contains_key("lifeline-signature"), "Antwort signiert");
    assert_eq!(v["ergebnis"]["versorgung"]["wasser_l_tag"], 4000);
    let wasser = richtwert(&v, "wasser_je_person_l");
    assert_eq!(
        (wasser["wert"].as_f64(), &wasser["herkunft"]),
        (Some(40.0), &json!("einsatz"))
    );
    // Der Einsatz hat keinen eigenen Wert: es gilt die Organisation.
    assert_eq!(richtwert(&v, "flaeche_je_person_m2")["herkunft"], "org");
    assert_eq!(
        v["ergebnis"]["schlafen"]["flaeche_m2"].as_f64(),
        Some(500.0)
    );
    assert_eq!(richtwert(&v, "dusche_je_personen")["herkunft"], "basis");

    // Die Anfrage geht dem Einsatz vor.
    let mut eigen = personen_mit_einsatz(json!(einsatz));
    eigen["richtwerte"] = json!({ "wasser_je_person_l": 15 });
    let (s, _, v) = rechnen(&app, &cred, &ip, "e2", &eigen).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ergebnis"]["versorgung"]["wasser_l_tag"], 1500);
    assert_eq!(richtwert(&v, "wasser_je_person_l")["herkunft"], "anfrage");

    // Ohne `einsatz_id` bleiben die Werte des Einsatzes draußen, ebenso mit `null`.
    for (jti, body) in [
        (
            "e3",
            json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": 100 } }),
        ),
        ("e4", personen_mit_einsatz(Value::Null)),
    ] {
        let (s, _, v) = rechnen(&app, &cred, &ip, jti, &body).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(v["ergebnis"]["versorgung"]["wasser_l_tag"], 3000);
        assert_eq!(richtwert(&v, "wasser_je_person_l")["herkunft"], "org");
    }

    // Die Auskunft mit und ohne Einsatz.
    let pfad = format!("{RICHTWERTE}?einsatz_id={einsatz}");
    let (s, h, v) = signiert(&app, &cred, "GET", &pfad, jetzt(), "e5", &ip).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(h.contains_key("lifeline-signature"), "Antwort signiert");
    let wasser = richtwert(&v, "wasser_je_person_l");
    assert_eq!(wasser["basis"].as_f64(), Some(25.0));
    assert_eq!(wasser["wert"].as_f64(), Some(40.0));
    assert_eq!(wasser["herkunft"], "einsatz");
    assert_eq!(richtwert(&v, "flaeche_je_person_m2")["herkunft"], "org");
    let (s, _, v) = signiert(&app, &cred, "GET", RICHTWERTE, jetzt(), "e6", &ip).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(richtwert(&v, "wasser_je_person_l")["herkunft"], "org");
}

/// Spec `rechner-api-unterkunft`, „Einsatz-Werte gibt es nur für einen freigegebenen Einsatz“:
/// jeder andere Fall ist dieselbe 404, eine ungültige Anfrage zuerst 400 oder 422.
#[tokio::test]
async fn einsatz_werte_nur_fuer_den_freigegebenen_einsatz() {
    let (app, pool, admin, nur_rechner, ip) = aufbau(223).await;
    let cred = planung(&app, &admin, 224, &ip).await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Hochwasser").await;
    let (fremd_org, _) =
        fremde_org_anlegen(&pool, "Fremd-Orga", "fremdadmin", "fremdpw12", "keine").await;
    let fremder: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (?, 'Fremd') RETURNING id",
    )
    .bind(fremd_org)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Ohne Freigabe.
    let (s, _, ohne_freigabe) = rechnen(
        &app,
        &cred,
        &ip,
        "n0",
        &personen_mit_einsatz(json!(einsatz)),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{ohne_freigabe}");
    assert_eq!(ohne_freigabe["code"], "not_found");

    einsatz_freigeben(&app, &admin, einsatz, &cred).await;
    let faelle = [
        ("anderer Einsatz", &cred, json!(anderer)),
        ("fremde Org", &cred, json!(fremder)),
        ("unbekannt", &cred, json!(999_999)),
        ("negativ", &cred, json!(-1)),
        // Nur `rechner:use`: lässt sich nicht freigeben, liest also keinen Einsatz.
        ("nur rechner:use", &nur_rechner, json!(einsatz)),
    ];
    for (i, (fall, zugang, id)) in faelle.iter().enumerate() {
        let (s, _, v) = rechnen(
            &app,
            zugang,
            &ip,
            &format!("n{}", i + 1),
            &personen_mit_einsatz(id.clone()),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{fall}: {v}");
        assert_eq!(v, ohne_freigabe, "{fall}: dieselbe Antwort");
    }

    // Die Auskunft ebenso.
    let pfad = format!("{RICHTWERTE}?einsatz_id={anderer}");
    let (s, _, v) = signiert(&app, &cred, "GET", &pfad, jetzt(), "n7", &ip).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
    assert_eq!(v, ohne_freigabe);

    // Eine ungültige Anfrage ist 422, auch mit einem nicht lesbaren Einsatz.
    let kaputt = json!({ "weg": "personen", "trennung": false, "einsatz_id": anderer });
    let (s, _, v) = rechnen(&app, &cred, &ip, "n8", &kaputt).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    // Der freigegebene Einsatz geht, bis er abgeschlossen ist.
    let (s, _, v) = rechnen(
        &app,
        &cred,
        &ip,
        "n9",
        &personen_mit_einsatz(json!(einsatz)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let (s, _, v) = rechnen(
        &app,
        &cred,
        &ip,
        "n10",
        &personen_mit_einsatz(json!(einsatz)),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "abgeschlossen: {v}");
    assert_eq!(v, ohne_freigabe);
}

#[tokio::test]
async fn auskunft_mit_einsatz_id_keine_zahl_ist_400() {
    let (app, _pool, admin, _cred, ip) = aufbau(225).await;
    let cred = planung(&app, &admin, 226, &ip).await;
    for (i, wert) in ["abc", "", "7.5"].iter().enumerate() {
        let pfad = format!("{RICHTWERTE}?einsatz_id={wert}");
        let (s, _, v) = signiert(&app, &cred, "GET", &pfad, jetzt(), &format!("q{i}"), &ip).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{wert}: {v}");
        assert_eq!(v["code"], "invalid_field");
        assert!(v["error"].as_str().unwrap().contains("einsatz_id"), "{v}");
    }
}
