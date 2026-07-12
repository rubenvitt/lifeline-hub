use axum::http::StatusCode;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::auth::bootstrap::bootstrap_admin;
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use serde_json::Value;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup,
    system_etb_anzahl,
};

// ---------- Harness (identisch zu tests/einsatz_fahrzeug.rs) ----------

/// Wie `setup`, behält aber ein Handle auf den `LiveHub`, um Live-Events zu abonnieren.
async fn setup_mit_hub() -> (axum::Router, LiveHub) {
    let pool = db::test_pool().await;
    bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let router = build_router(AppState {
        pool,
        live: live.clone(),
        karten_dir: std::env::temp_dir(),
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        download_client: lifeline_hub::karte::download::download_client(),
        download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
        karten_service_url: None,
        karten_service_token: None,
    });
    (router, live)
}

// ---------- Zusatz-Helfer ----------

/// Legt Stamm-Material an (Admin) und liefert dessen id.
async fn material_anlegen(app: &axum::Router, admin: &str, bezeichnung: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/material",
        admin,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","kategorie":"Betreuung"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_mit_menge_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["bezeichnung"], "Wolldecke");
    assert_eq!(json["menge"], 50);
    assert_eq!(json["status"], "einsatzbereit");
    assert_eq!(json["ist_adhoc"], false);

    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        1,
        "Disponieren schreibt 1 System-ETB"
    );
}

#[tokio::test]
async fn dasselbe_material_mehrfach_disponierbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let body = format!(r#"{{"material_id":{mat},"menge":30}}"#);
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/material"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/material"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::CREATED,
        "kein Conflict"
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn adhoc_ohne_stamm_mit_pflicht_bezeichnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(
            r#"{"adhoc":{"bezeichnung":"Spende-Decken","traegerorganisation":"THW"},"menge":100}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["material_id"].is_null());
    assert_eq!(json["menge"], 100);
}

#[tokio::test]
async fn menge_unter_eins_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":0}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn beobachter_liest_nicht_disponiert_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/material"),
            &erika,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &erika,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/abschliessen"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn menge_und_status_aenderung_schreiben_je_einen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();

    // Menge UND Status in einem PATCH → +2 System-ETB.
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"menge":30,"status":"defekt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["menge"], 30);
    assert_eq!(json["status"], "defekt");

    // Disponieren (1) + Menge (1) + Status (1) = 3.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn ungueltiger_status_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"status":"kaputtnochmal"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn reine_bemerkung_schreibt_keinen_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();

    let (_, gesetzt) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"bemerkung":"Lagerhalle 2"}"#),
    )
    .await;
    assert_eq!(gesetzt["bemerkung"], "Lagerhalle 2");
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        1,
        "nur die Disposition selbst"
    );
}

#[tokio::test]
async fn entfernen_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        2,
        "Disponieren + Entfernen"
    );
}

#[tokio::test]
async fn org_isolation_fremdes_material_nicht_disponierbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(r#"{"material_id":999999}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patch_und_delete_unbekannte_em_id_sind_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/999999"),
        &admin,
        Some(r#"{"menge":5}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/material/999999"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patch_menge_unter_eins_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"menge":0}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Bildet eine Einheit (Admin) und liefert ihre id.
async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn material_einheit_zuordnen_freigeben_und_aufloesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat},"menge":50}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();
    let eid = einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;

    // Zuordnen.
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/material/{em}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap()[0]["einheit_id"], eid);

    // Material-Mitglied erscheint in der Einheit.
    let (_, einheiten) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    let einheit = einheiten
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == eid)
        .unwrap();
    assert_eq!(einheit["material_mitglieder"].as_array().unwrap().len(), 1);

    // Explizit freigeben (HTTP-Route material_freigeben).
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/material/{em}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste_frei) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        None,
    )
    .await;
    assert!(
        liste_frei.as_array().unwrap()[0]["einheit_id"].is_null(),
        "Freigeben löst die Zuordnung"
    );
    // Wieder zuordnen, damit der anschließende Auflösen-Block weiterhin greift.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/material/{em}"),
        &admin,
        None,
    )
    .await;

    // Auflösen gibt Material frei.
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/einheiten/{eid}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste2) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        None,
    )
    .await;
    assert!(
        liste2.as_array().unwrap()[0]["einheit_id"].is_null(),
        "Auflösen gibt Material frei"
    );
}

#[tokio::test]
async fn fremde_em_id_an_einheit_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/material/999999"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// LFH-66: Jede Material-Mutation publiziert ein `material`-Live-Event — auch eine
/// reine Bemerkungsänderung, die KEINEN ETB-Eintrag schreibt. Diskriminiert die
/// Fehlplatzierung des Events hinter den ETB-Schreibbedingungen (menge/status).
#[tokio::test]
async fn reine_bemerkung_publiziert_material_event() {
    let (app, live) = setup_mit_hub().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();

    // Erst NACH dem Disponieren abonnieren → isoliert das Event des folgenden PATCH.
    let mut rx = live.abonniere(einsatz);
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"bemerkung":"Lagerhalle 2"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Reine Bemerkung schreibt keinen ETB → das einzige Live-Event muss `material` sein.
    let nachricht = rx
        .try_recv()
        .expect("ein Live-Event nach der Material-Mutation erwartet");
    assert_eq!(nachricht.event, "material");
    let data: Value = serde_json::from_str(&nachricht.data).unwrap();
    assert_eq!(data["einsatz_id"], einsatz);
    assert_eq!(data["material_id"], em);
}

/// LFH-66: Auch das Zuordnen von Material an eine Einheit publiziert ein
/// `material`-Live-Event (analog fahrzeug/personal in einsatz_einheit) — nicht nur
/// als Beifang des `einheit`-Events.
#[tokio::test]
async fn material_an_einheit_zuordnen_publiziert_material_event() {
    let (app, live) = setup_mit_hub().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mat = material_anlegen(&app, &admin, "Wolldecke").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    let em = json["id"].as_i64().unwrap();
    let eid = einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;

    // Erst NACH dem Aufbau abonnieren → isoliert die Events der Zuordnung.
    let mut rx = live.abonniere(einsatz);
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/material/{em}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );

    // Unter den publizierten Events (einheit/etb/material) muss ein `material`-Event sein.
    let mut events = Vec::new();
    while let Ok(n) = rx.try_recv() {
        events.push(n.event);
    }
    assert!(
        events.iter().any(|e| e == "material"),
        "erwartete ein material-Event, bekam: {events:?}"
    );
}
