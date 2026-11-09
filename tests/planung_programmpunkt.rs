//! Programmpunkte der Planung (LLH-1583, Spec `vorplanung`, „Programmpunkte der Planung“ und
//! „Übernahme in einen Einsatz“): pflegen, Grenzen und Rechte, und die Übernahme in einen neuen
//! oder laufenden Einsatz. Ein gleicher Punkt im Einsatz bleibt aus, mehr als 50 sperren die
//! Übernahme. Entwurf: `/mnt/project-files/llh-1583/entwurf.md` (Freigabe Ruben 08.11.2026).

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::*;

const PFAD: &str = "/api/planungen";

const AN: RouterOptionen = RouterOptionen {
    demo_daten: true,
    zulassungs_budget: None,
    heic_decoder_verzeichnis: None,
};

async fn admin(app: &axum::Router) -> String {
    login_cookie(app, "admin", "startpw12").await
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "POST", pfad, cookie, Some(&body)).await
}

async fn get(app: &axum::Router, cookie: &str, pfad: &str) -> Value {
    let (s, v) = anfrage(app, "GET", pfad, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v
}

/// Eine leere Planung am 13.03.2027.
async fn planung(app: &axum::Router, cookie: &str, name: &str) -> i64 {
    let (s, plan) = post(
        app,
        cookie,
        PFAD,
        json!({"bezeichnung": name, "von": "2027-03-13 08:00:00", "bis": "2027-03-13 23:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{plan}");
    plan["kopf"]["id"].as_i64().unwrap()
}

async fn punkt(app: &axum::Router, cookie: &str, p: i64, b: &str, z: &str) -> (StatusCode, Value) {
    post(
        app,
        cookie,
        &format!("{PFAD}/{p}/programmpunkte"),
        json!({"bezeichnung": b, "zeitpunkt_at": z}),
    )
    .await
}

fn namen_und_zeiten(liste: &Value) -> Vec<(String, String)> {
    liste
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["bezeichnung"].as_str().unwrap().to_string(),
                p["zeitpunkt_at"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[tokio::test]
async fn pflegen_mit_grenzen_und_rechten() {
    let (app, pool) = setup_mit_pool().await;
    let admin = admin(&app).await;
    let p = planung(&app, &admin, "Konzert").await;

    // Formulareingabe wird kanonisch; die Planung trägt die Punkte nach Zeit, auch außerhalb
    // ihres Zeitraums (Aufbau am Vortag).
    let (s, feuerwerk) = punkt(&app, &admin, p, "  Feuerwerk ", "2027-03-13T21:30").await;
    assert_eq!(s, StatusCode::CREATED, "{feuerwerk}");
    assert_eq!(feuerwerk["bezeichnung"], "Feuerwerk");
    assert_eq!(feuerwerk["zeitpunkt_at"], "2027-03-13 21:30:00");
    let (s, aufbau) = punkt(&app, &admin, p, "Aufbau", "2027-03-12 16:00:00").await;
    assert_eq!(s, StatusCode::CREATED, "{aufbau}");
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    assert_eq!(
        namen_und_zeiten(&plan["programmpunkte"]),
        [
            ("Aufbau".into(), "2027-03-12 16:00:00".into()),
            ("Feuerwerk".into(), "2027-03-13 21:30:00".into()),
        ]
    );

    // Ändern und löschen.
    let einzeln = format!("{PFAD}/{p}/programmpunkte/{}", feuerwerk["id"]);
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &einzeln,
        &admin,
        Some(&json!({"zeitpunkt_at": "2027-03-13 22:00:00"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["bezeichnung"], "Feuerwerk");
    assert_eq!(v["zeitpunkt_at"], "2027-03-13 22:00:00");
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PFAD}/{p}/programmpunkte/{}", aufbau["id"]),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PFAD}/{p}/programmpunkte/{}", aufbau["id"]),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // Feldfehler 400.
    for (b, z) in [
        ("   ", "2027-03-13 20:00:00"),
        (&*"x".repeat(101), "2027-03-13 20:00:00"),
        ("Pause", "irgendwann"),
        ("Pause", "1899-03-13 20:00:00"),
    ] {
        let (s, v) = punkt(&app, &admin, p, b, z).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{b} {z}: {v}");
    }
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &einzeln,
        &admin,
        Some(&json!({"bezeichnung": " "})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");

    // Höchstens 50 je Planung: der 51. ist 422.
    for i in 1..50 {
        let (s, v) = punkt(
            &app,
            &admin,
            p,
            &format!("Punkt {i}"),
            "2027-03-13 12:00:00",
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{i}: {v}");
    }
    let (s, v) = punkt(&app, &admin, p, "Einer zu viel", "2027-03-13 12:00:00").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    // Ohne Recht zu planen 403, eine fremde Planung 404.
    benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, _) = punkt(&app, &beob, p, "Zugabe", "2027-03-13 22:30:00").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    fremde_org_anlegen(&pool, "Andere", "fremd", "fremdpw12", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let (s, _) = punkt(&app, &fremd, p, "Zugabe", "2027-03-13 22:30:00").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "DELETE", &einzeln, &fremd, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // Das Löschen der Planung nimmt die Punkte mit.
    let (s, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{p}"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM planung_programmpunkt")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rest, 0);
}

/// Ein gekoppelter Lagemonitor: das Sitzungscookie des Geräts.
async fn lagemonitor(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        admin,
        Some(&json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap();
    let req = Request::builder()
        .method("POST")
        .uri("/api/geraete/koppeln")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp.headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
        .expect("Sitzungscookie")
}

/// Akzeptanzkriterium: die Demo-Planung bringt ihr Programm in den neuen Einsatz; Einsatzdaten
/// und Lagemonitor zeigen denselben Ablauf, das ETB nennt ihn, die Planung ist danach auch für
/// Programmpunkte schreibgeschützt.
#[tokio::test]
async fn stadtfest_bringt_sein_programm_in_den_neuen_einsatz() {
    let (app, _pool) = setup_mit_optionen(AN).await;
    let admin = admin(&app).await;
    let (s, v) = anfrage(&app, "POST", "/api/demo-daten/stadtfest", &admin, None).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let p = get(&app, &admin, PFAD)
        .await
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["bezeichnung"] == "Stadtfest Musterstadt")
        .expect("Demo-Planung")["id"]
        .as_i64()
        .unwrap();
    let vorher = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    let programm = namen_und_zeiten(&vorher["programmpunkte"]);
    let bezeichnungen: Vec<&str> = programm.iter().map(|(b, _)| b.as_str()).collect();
    assert_eq!(
        bezeichnungen,
        ["Festbeginn", "Einlass Bühne", "Bühnenprogramm", "Feuerwerk"]
    );

    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        json!({"ziel": {"art": "neu"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    assert_eq!(vorschau["zaehlung"]["programmpunkte_neu"], 4, "{vorschau}");
    assert_eq!(vorschau["zaehlung"]["programmpunkte_vorhanden"], 0);

    let (s, ergebnis) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme"),
        json!({"ziel": {"art": "neu"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    assert_eq!(ergebnis["zaehlung"]["programmpunkte_neu"], 4);
    let einsatz = ergebnis["einsatz_id"].as_i64().unwrap();
    let im_einsatz = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/programmpunkte"),
    )
    .await;
    assert_eq!(namen_und_zeiten(&im_einsatz), programm, "derselbe Ablauf");
    assert!(
        system_etb_inhalte(&app, &admin, einsatz)
            .await
            .iter()
            .any(
                |t| t.starts_with("Planung „Stadtfest Musterstadt“ übernommen:")
                    && t.contains("4 Programmpunkte neu")
            ),
        "ETB nennt das Programm"
    );

    // Die Planung liegt am nächsten Samstag: der Lagemonitor zeigt die ersten drei.
    let monitor = lagemonitor(&app, &admin, einsatz).await;
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lagemonitor"),
        &monitor,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let auf_dem_monitor: Vec<&str> = v["programm"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(
        auf_dem_monitor,
        ["Festbeginn", "Einlass Bühne", "Bühnenprogramm"]
    );

    // Übernommen: auch die Programmpunkte der Planung sind schreibgeschützt.
    let erster = &vorher["programmpunkte"][0]["id"];
    let (s, _) = punkt(&app, &admin, p, "Zugabe", "2027-03-13 22:30:00").await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("{PFAD}/{p}/programmpunkte/{erster}"),
        &admin,
        Some(&json!({"bezeichnung": "Anders"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("{PFAD}/{p}/programmpunkte/{erster}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// In einen laufenden Einsatz: ein Punkt mit gleicher Bezeichnung (ohne Groß und klein) und
/// gleichem Zeitpunkt bleibt aus, der Rest kommt dazu. Programmpunkte allein sind schon eine
/// Änderung.
#[tokio::test]
async fn laufender_einsatz_ueberspringt_gleiche_punkte() {
    let app = setup().await;
    let admin = admin(&app).await;
    let p = planung(&app, &admin, "Konzert").await;
    for (b, z) in [
        ("Einlass", "2027-03-13 17:00:00"),
        ("Feuerwerk", "2027-03-13 21:30:00"),
    ] {
        let (s, v) = punkt(&app, &admin, p, b, z).await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Konzert").await;
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/programmpunkte"),
        json!({"bezeichnung": "EINLASS", "zeitpunkt_at": "2027-03-13 17:00:00"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ziel = json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}});

    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        ziel.clone(),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    let z = &vorschau["zaehlung"];
    assert_eq!(z["programmpunkte_neu"], 1, "{z}");
    assert_eq!(z["programmpunkte_vorhanden"], 1, "{z}");
    assert_eq!(z["aenderungen"], 1, "nur das Programm: {z}");
    assert_eq!(vorschau["uebernehmbar"], true);

    let (s, ergebnis) = post(&app, &admin, &format!("{PFAD}/{p}/uebernahme"), ziel).await;
    assert_eq!(s, StatusCode::OK, "{ergebnis}");
    let im_einsatz = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/programmpunkte"),
    )
    .await;
    assert_eq!(
        namen_und_zeiten(&im_einsatz),
        [
            ("EINLASS".into(), "2027-03-13 17:00:00".into()),
            ("Feuerwerk".into(), "2027-03-13 21:30:00".into()),
        ],
        "der vorhandene bleibt, wie er ist"
    );
}

/// Mehr als 50 im Einsatz sperren die Übernahme mit einer Meldung; nichts wird abgeschnitten.
#[tokio::test]
async fn mehr_als_fuenfzig_sperren_die_uebernahme() {
    let app = setup().await;
    let admin = admin(&app).await;
    let p = planung(&app, &admin, "Konzert").await;
    for b in ["Einlass", "Feuerwerk"] {
        let (s, v) = punkt(&app, &admin, p, b, "2027-03-13 20:00:00").await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Konzert").await;
    for i in 0..49 {
        let (s, v) = post(
            &app,
            &admin,
            &format!("/api/einsaetze/{einsatz}/programmpunkte"),
            json!({"bezeichnung": format!("Punkt {i}"), "zeitpunkt_at": "2027-03-13 12:00:00"}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let ziel = json!({"ziel": {"art": "einsatz", "einsatz_id": einsatz}});

    let (s, vorschau) = post(
        &app,
        &admin,
        &format!("{PFAD}/{p}/uebernahme/vorschau"),
        ziel.clone(),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{vorschau}");
    assert_eq!(vorschau["uebernehmbar"], false, "{vorschau}");
    let meldung = &vorschau["meldungen"][0];
    assert_eq!(meldung["stufe"], "fehler", "{meldung}");
    assert!(
        meldung["text"].as_str().unwrap().contains("51"),
        "{meldung}"
    );

    let (s, v) = post(&app, &admin, &format!("{PFAD}/{p}/uebernahme"), ziel).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let anzahl = get(
        &app,
        &admin,
        &format!("/api/einsaetze/{einsatz}/programmpunkte"),
    )
    .await
    .as_array()
    .unwrap()
    .len();
    assert_eq!(anzahl, 49, "nichts übernommen");
    let plan = get(&app, &admin, &format!("{PFAD}/{p}")).await;
    assert!(
        plan["kopf"].get("uebernahme").is_none(),
        "bleibt übernehmbar"
    );
}
