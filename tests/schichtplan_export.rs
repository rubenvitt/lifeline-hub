//! Integrationstests „Schichtplan als Excel“ (LLH-1557, Spec `kraefte-schichtplan`, design.md D7):
//! der Rundweg Export → Einlesen über den Leser aus LLH-1556 für einen Einsatz und für die
//! Demo-Planung, dazu Rechte. Blätter und Bezüge im Einzelnen prüfen `ausgabe/plan.rs` und
//! `ausgabe/mappe.rs`, Regel 0 `uebernahme/abgleich.rs` und `uebernahme/repo.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::*;

const AN: RouterOptionen = RouterOptionen {
    demo_daten: true,
    zulassungs_budget: None,
    heic_decoder_verzeichnis: None,
};

const CSV: &[u8] = include_bytes!("../frontend/public/beispiele/schichtplan-stadtfest.csv");
const XLSX_TYP: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan")
}

/// GET mit Bytes statt JSON.
async fn laden(app: &axum::Router, uri: &str, cookie: &str) -> (StatusCode, String, Vec<u8>) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::COOKIE, cookie.to_string())
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let typ = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, typ, bytes.to_vec())
}

async fn stadtfest(app: &axum::Router, admin: &str) -> i64 {
    let (s, v) = anfrage(app, "POST", "/api/demo-daten/stadtfest", admin, None).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["lagen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["lage"] == "stadtfest")
        .unwrap()["import"]["einsatz_id"]
        .as_i64()
        .unwrap()
}

async fn einlesen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    was: &str,
    datei: &[u8],
) -> (StatusCode, Value) {
    multipart_post(
        app,
        &format!("{}/{was}", pfad(einsatz)),
        cookie,
        Some(("plan.xlsx", datei)),
        &[],
    )
    .await
}

/// Nichts zu tun: alle Blöcke unverändert, jede Person sicher, keine Meldung.
fn nur_unveraendert(v: &Value, bloecke: usize) {
    assert_eq!(v["uebernehmbar"], true, "{v}");
    assert_eq!(v["zaehlung"]["aenderungen"], 0, "{}", v["zaehlung"]);
    assert_eq!(v["zaehlung"]["bloecke_unveraendert"], bloecke as i64);
    for b in v["bloecke"].as_array().unwrap() {
        assert_eq!(b["zustand"], "unveraendert", "{b}");
    }
    for p in v["personen"].as_array().unwrap() {
        assert_eq!(p["treffer"], "sicher", "{p}");
    }
    assert_eq!(v["meldungen"], json!([]), "keine Hinweise");
}

#[tokio::test]
async fn einsatz_export_und_erneutes_einlesen_aendern_nichts() {
    let (app, _pool) = setup_mit_optionen(AN).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = stadtfest(&app, &admin).await;

    // Plan aus der Beispieldatei: Stamm, Helfer mit externer Kennung, eine neue Einheit, UHS.
    let (s, r) = multipart_post(
        &app,
        &format!("{}/import", pfad(e)),
        &admin,
        Some(("plan.csv", CSV)),
        &[],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    let streife = r["plan"]["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["posten"]["art"] == "einheit")
        .unwrap()["posten"]["einheit_id"]
        .as_i64()
        .unwrap();
    let stamm = r["plan"]["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|b| b["personen"].as_array().unwrap())
        .find(|p| p["art"] == "stamm")
        .unwrap()["personal_id"]
        .as_i64()
        .unwrap();

    // Dazu eine Ad-hoc-Kraft, ein Helfer ohne Kennung und eine Pause.
    let (s, adhoc) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personal"),
        &admin,
        Some(
            &json!({"adhoc": {"name": "Notarzt Extern", "funktion": "Notarzt",
                               "staerke_position": "fuehrer"}}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{adhoc}");
    let adhoc = adhoc["id"].as_i64().unwrap();
    let (s, h) = anfrage_json(
        &app,
        "POST",
        &format!("{}/helfer", pfad(e)),
        &admin,
        Some(&json!({"name": "Hanna Ohnekennung", "telefon": "0170 5", "organisation": "THW"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{h}");
    let hanna = h["id"].as_i64().unwrap();
    for body in [
        json!({"posten": {"art": "einheit", "einheit_id": streife},
               "von": "2027-06-25 06:00:00", "bis": "2027-06-25 08:00:00",
               "personen": [{"art": "einsatz", "einsatz_personal_id": adhoc},
                            {"art": "helfer", "helfer_id": hanna}]}),
        json!({"posten": {"art": "pause"},
               "von": "2027-06-25 08:00:00", "bis": "2027-06-25 08:30:00",
               "personen": [{"art": "stamm", "personal_id": stamm},
                            {"art": "helfer", "helfer_id": hanna}]}),
    ] {
        let (s, v) = anfrage_json(
            &app,
            "POST",
            &format!("{}/bloecke", pfad(e)),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let anzahl = plan["bloecke"].as_array().unwrap().len();
    assert_eq!(anzahl, 12);

    let (s, typ, mappe) = laden(&app, &format!("{}/export", pfad(e)), &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(typ, XLSX_TYP);
    assert!(mappe.starts_with(b"PK\x03\x04"));

    // Wieder einlesen: nur unverändert, jede Person über ihren Bezug.
    let (s, v) = einlesen(&app, &admin, e, "import/vorschau", &mappe).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    nur_unveraendert(&v, anzahl);
    let person = |name: &str| {
        v["personen"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["name"] == name)
            .unwrap_or_else(|| panic!("{name} fehlt: {v}"))
            .clone()
    };
    assert_eq!(person("Notarzt Extern")["ziel"]["art"], "einsatz");
    assert_eq!(person("Notarzt Extern")["grund"], "bezug");
    assert_eq!(person("Hanna Ohnekennung")["ziel"]["art"], "helfer");
    assert_eq!(person("Jonas Fiktiv")["grund"], "kennung");
    let (s, r) = einlesen(&app, &admin, e, "import", &mappe).await;
    assert_eq!(s, StatusCode::OK, "{r}");
    assert_eq!(r["zaehlung"]["aenderungen"], 0);
    assert_eq!(r["plan"]["bloecke"], plan["bloecke"], "der Plan bleibt");

    // In einen anderen Einsatz: keine eigenen Treffer, also neue Helfer mit dem Bezug; ein
    // zweiter Lauf trifft sie über Kennung und Herkunft.
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (s, v) = einlesen(&app, &admin, anderer, "import", &mappe).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["zaehlung"]["bloecke_neu"], anzahl as i64,
        "{}",
        v["zaehlung"]
    );
    let (s, v) = einlesen(&app, &admin, anderer, "import/vorschau", &mappe).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zaehlung"]["aenderungen"], 0, "{}", v["zaehlung"]);
}

#[tokio::test]
async fn planung_export_in_leeren_einsatz_und_zweiter_lauf() {
    let (app, _pool) = setup_mit_optionen(AN).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    stadtfest(&app, &admin).await;
    let (s, liste) = anfrage(&app, "GET", "/api/planungen", &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    let p = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["bezeichnung"] == "Stadtfest Musterstadt")
        .unwrap_or_else(|| panic!("Demo-Planung fehlt: {liste}"))["id"]
        .as_i64()
        .unwrap();
    let (_, planung) = anfrage(&app, "GET", &format!("/api/planungen/{p}"), &admin, None).await;
    let (s, typ, mappe) = laden(&app, &format!("/api/planungen/{p}/export"), &admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(typ, XLSX_TYP);

    let e = einsatz_anlegen(&app, &admin).await;
    let (s, r) = einlesen(&app, &admin, e, "import", &mappe).await;
    assert_eq!(s, StatusCode::OK, "{r}");
    // Blöcke, Personen und Soll wie in der Planung.
    let quelle = planung["bloecke"].as_array().unwrap();
    let ziel = r["plan"]["bloecke"].as_array().unwrap();
    assert_eq!(ziel.len(), quelle.len());
    let form = |b: &Value| {
        let mut namen: Vec<String> = b["personen"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["name"].as_str().unwrap().to_string())
            .collect();
        namen.sort();
        (
            b["von"].as_str().unwrap().to_string(),
            b["bis"].as_str().unwrap().to_string(),
            b["soll_anzahl"].as_i64(),
            b["quali_soll"].as_array().map_or(0, Vec::len),
            namen,
        )
    };
    let mut a: Vec<_> = quelle.iter().map(form).collect();
    let mut b: Vec<_> = ziel.iter().map(form).collect();
    a.sort();
    b.sort();
    assert_eq!(a, b);
    let helfer: Vec<&Value> = r["plan"]["helfer"].as_array().unwrap().iter().collect();
    assert!(
        helfer.iter().all(|h| h["herkunft"] == "vorplanung"),
        "{helfer:?}"
    );

    let (s, v) = einlesen(&app, &admin, e, "import/vorschau", &mappe).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zaehlung"]["aenderungen"], 0, "{}", v["zaehlung"]);
    assert!(v["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .all(|b| b["zustand"] == "unveraendert"));
}

#[tokio::test]
async fn rechte_und_abgeschlossener_einsatz() {
    let (app, _pool) = setup_mit_optionen(AN).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = stadtfest(&app, &admin).await;
    let bid = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    rolle_setzen(&app, &admin, e, bid, "beobachter").await;
    let bert = login_cookie(&app, "bertram", "bertrampw1").await;

    // Lesen der Ablösung genügt, auch für den Beobachter.
    let (s, typ, _) = laden(&app, &format!("{}/export", pfad(e)), &bert).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(typ, XLSX_TYP);

    // Ohne Personal: 403.
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/personal"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _, _) = laden(&app, &format!("{}/export", pfad(e)), &bert).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/personal"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    // Abgeschlossen: weiter lesbar.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _, _) = laden(&app, &format!("{}/export", pfad(e)), &admin).await;
    assert_eq!(s, StatusCode::OK);

    // Planung: nur, wer planen darf; eine fremde ist 404.
    let (_, liste) = anfrage(&app, "GET", "/api/planungen", &admin, None).await;
    let p = liste[0]["id"].as_i64().unwrap();
    let (s, _, _) = laden(&app, &format!("/api/planungen/{p}/export"), &bert).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _, _) = laden(&app, "/api/planungen/999999/export", &admin).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
