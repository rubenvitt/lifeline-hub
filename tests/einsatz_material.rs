use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{
    anfrage, benutzer_anlegen, einheit_bilden, einsatz_anlegen, login_cookie, objekt_ereignisse,
    rolle_setzen, setup, setup_mit_live, system_etb_anzahl, system_etb_inhalte,
};

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
        "POST",
        &format!("/api/einsaetze/{einsatz}/material/{em}/entlassen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        2,
        "Disponieren + Aus dem Einsatz nehmen"
    );
}

/// Stamm-Material außer Dienst ist ein Zustand: 422 wie bei Person und Fahrzeug (`src/AGENTS.md`,
/// Statuscode-Konvention; bis LLH-1079 Teil II war es 400), ohne ETB-Eintrag.
#[tokio::test]
async fn stamm_material_ausser_dienst_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mid = material_anlegen(&app, &admin, "Wolldecke").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/material/{mid}/ausser-dienst"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{mid},"menge":1}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"],
        "Material ist außer Dienst und kann nicht disponiert werden"
    );
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 0);
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
        "POST",
        &format!("/api/einsaetze/{einsatz}/material/999999/entlassen"),
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
    let (app, live) = setup_mit_live().await;
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
    assert_eq!(nachricht.event.as_str(), "material");
    let data: Value = serde_json::from_str(&nachricht.data).unwrap();
    assert_eq!(data["einsatz_id"], einsatz);
    assert_eq!(data["material_id"], em);
}

/// LFH-66: Auch das Zuordnen von Material an eine Einheit publiziert ein
/// `material`-Live-Event (analog fahrzeug/personal in einsatz_einheit) — nicht nur
/// als Beifang des `einheit`-Events.
#[tokio::test]
async fn material_an_einheit_zuordnen_publiziert_material_event() {
    let (app, live) = setup_mit_live().await;
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
        events.iter().any(|e| e.as_str() == "material"),
        "erwartete ein material-Event, bekam: {events:?}"
    );
}

// F12-c (LFH-266-Nachzug): `bemerkung` ist nullable und muss per PATCH löschbar sein.
// Tri-State wie in d167778: absent = unverändert, `null`/`""` = leeren, Wert = setzen.
// Der Material-Fall prüft `menge` mit — die Query bindet nummeriert (?1..?8) und das neue
// bemerkung-Paar verschiebt alles danach; ein verrutschter Parameter fiele sonst nicht auf.
// Für `uhs_id` (das dabei von ?4/?5 auf ?5/?6 wandert) übernehmen das die Unit-Tests im
// Repo-Modul, src/material/disposition_repo.rs.
#[tokio::test]
async fn patch_null_leert_bemerkung() {
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
        Some(r#"{"menge":7,"bemerkung":"Lagerhalle 2"}"#),
    )
    .await;
    assert_eq!(gesetzt["bemerkung"], "Lagerhalle 2");
    assert_eq!(gesetzt["menge"], 7, "menge liegt vor der Bemerkung im Bind");

    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"bemerkung":null}"#),
    )
    .await;
    assert!(
        geleert["bemerkung"].is_null(),
        "explizites null muss die Bemerkung löschen"
    );
    assert_eq!(
        geleert["menge"], 7,
        "die Nachbarspalten dürfen dabei nicht mitgeschrieben werden"
    );
}

#[tokio::test]
async fn patch_leerstring_leert_bemerkung() {
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

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"bemerkung":"Lagerhalle 2"}"#),
    )
    .await;
    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"bemerkung":"   "}"#),
    )
    .await;
    assert!(
        geleert["bemerkung"].is_null(),
        "whitespace-only zählt als Leerwunsch (trimme_tri), nicht als Wert"
    );
}

#[tokio::test]
async fn patch_ohne_bemerkung_laesst_sie_stehen() {
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

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"bemerkung":"Lagerhalle 2"}"#),
    )
    .await;
    let (_, unberuehrt) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        &admin,
        Some(r#"{"menge":3}"#),
    )
    .await;
    assert_eq!(
        unberuehrt["bemerkung"], "Lagerhalle 2",
        "absentes Feld lässt die Bemerkung unverändert"
    );
    assert_eq!(unberuehrt["menge"], 3);
}

// ---------- Fremd-Ereignisse (LLH-1182) ----------

const FREMD: &[(&str, &str)] = &[("einheit", "einheit_id"), ("uhs", "uhs_id")];

fn ereignis(tag: &str, id: i64) -> (String, i64) {
    (tag.to_string(), id)
}

async fn material_disponieren(app: &axum::Router, admin: &str, einsatz: i64, bez: &str) -> i64 {
    let mat = material_anlegen(app, admin, bez).await;
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        admin,
        Some(&format!(r#"{{"material_id":{mat}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

async fn create_uhs(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&format!(
            r#"{{"typ":"behandlungsplatz","bezeichnung":"{bez}"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

async fn in_einheit(app: &axum::Router, cookie: &str, einsatz: i64, em: i64) -> i64 {
    let einheit = einheit_bilden(app, cookie, einsatz, "1. Zug").await;
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/material/{em}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "Material der Einheit zuordnen");
    einheit
}

/// Das Entfernen nimmt der Einheit ein Mitglied und dem UHS-Detail das dort verortete Material
/// (LFH-892). `material` erreicht Einheiten- und UHS-Leser ohne Materialrecht nicht; `einheit`
/// bzw. `uhs` tragen es, aber nur, wenn das Material dort stand.
#[tokio::test]
async fn entfernen_feuert_einheit_und_uhs_nur_bei_betroffenem_material() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frei = material_disponieren(&app, &admin, einsatz, "Wolldecke").await;
    let im_zug = material_disponieren(&app, &admin, einsatz, "Trage").await;
    let an_uhs = material_disponieren(&app, &admin, einsatz, "Verbandkasten").await;
    let einheit = in_einheit(&app, &admin, einsatz, im_zug).await;
    let uhs = create_uhs(&app, &admin, einsatz, "UHS 1").await;
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{an_uhs}"),
        &admin,
        Some(&format!(r#"{{"uhs_id":{uhs}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "an der UHS verorten: {json}");

    let mut rx = live.abonniere(einsatz);
    let entfernen = |em: i64| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "POST",
                &format!("/api/einsaetze/{einsatz}/material/{em}/entlassen"),
                &admin,
                None,
            )
            .await
            .0
        }
    };

    assert_eq!(entfernen(frei).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "ohne Bezug");
    assert_eq!(entfernen(im_zug).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Mitglied der Einheit"
    );
    assert_eq!(entfernen(an_uhs).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Material der UHS"
    );
}

/// Die Mitgliederliste der Einheit zeigt Bezeichnung, Menge und Status, das UHS-Detail die ganze
/// Materialzeile. Der PATCH meldet `einheit` bei geänderter Menge oder geändertem Status eines
/// Einheitsmaterials, `uhs` bei jeder Änderung an Material einer UHS, beim Umverorten für die alte
/// und die neue UHS — und nichts, wenn sich nichts ändert.
#[tokio::test]
async fn aendern_feuert_einheit_und_uhs_nur_wenn_deren_ansicht_sich_aendert() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frei = material_disponieren(&app, &admin, einsatz, "Wolldecke").await;
    let im_zug = material_disponieren(&app, &admin, einsatz, "Trage").await;
    let einheit = in_einheit(&app, &admin, einsatz, im_zug).await;
    let uhs_a = create_uhs(&app, &admin, einsatz, "UHS A").await;
    let uhs_b = create_uhs(&app, &admin, einsatz, "UHS B").await;

    let mut rx = live.abonniere(einsatz);
    let patch = |em: i64, body: String| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "PATCH",
                &format!("/api/einsaetze/{einsatz}/material/{em}"),
                &admin,
                Some(&body),
            )
            .await
            .0
        }
    };

    assert_eq!(patch(frei, r#"{"menge":2}"#.into()).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "freies Material");
    assert_eq!(patch(im_zug, r#"{"menge":3}"#.into()).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Menge eines Einheitsmaterials"
    );
    assert_eq!(
        patch(im_zug, r#"{"status":"defekt"}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Status eines Einheitsmaterials"
    );
    assert_eq!(patch(im_zug, r#"{"menge":3}"#.into()).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "gleiche Menge");
    assert_eq!(
        patch(im_zug, r#"{"bemerkung":"Gurt fehlt"}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![],
        "die Einheit zeigt keine Bemerkung"
    );

    assert_eq!(
        patch(frei, format!(r#"{{"uhs_id":{uhs_a}}}"#)).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs_a)],
        "an der UHS verortet"
    );
    assert_eq!(
        patch(frei, r#"{"bemerkung":"Regal 2"}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs_a)],
        "Bemerkung an Material der UHS"
    );
    assert_eq!(
        patch(frei, r#"{"bemerkung":"Regal 2"}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![],
        "gleiche Bemerkung"
    );
    assert_eq!(
        patch(frei, format!(r#"{{"uhs_id":{uhs_b}}}"#)).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs_a), ereignis("uhs", uhs_b)],
        "umverortet: alte und neue UHS"
    );
    assert_eq!(
        patch(frei, r#"{"uhs_id":null}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs_b)],
        "von der UHS gelöst"
    );
}

/// Material in einer Einheit und zugleich an einer UHS: ein Statuswechsel ändert beide Ansichten,
/// eine Bemerkung nur das UHS-Detail.
#[tokio::test]
async fn material_in_einheit_und_an_uhs_meldet_beide_ansichten() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = material_disponieren(&app, &admin, einsatz, "Trage").await;
    let einheit = in_einheit(&app, &admin, einsatz, em).await;
    let uhs = create_uhs(&app, &admin, einsatz, "UHS 1").await;
    let pfad = format!("/api/einsaetze/{einsatz}/material/{em}");
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&format!(r#"{{"uhs_id":{uhs}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let mut rx = live.abonniere(einsatz);
    let (s, _) = anfrage(&app, "PATCH", &pfad, &admin, Some(r#"{"status":"defekt"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit), ereignis("uhs", uhs)],
        "Status: Einheit und UHS"
    );
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"bemerkung":"Gurt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Bemerkung: nur UHS"
    );
}

// ── Aus dem Einsatz nehmen statt löschen (LLH-1079 Teil II) ───────────────────────────────

async fn aktion(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    em: i64,
    was: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material/{em}/{was}"),
        cookie,
        None,
    )
    .await
}

async fn bezeichnungen(app: &axum::Router, cookie: &str, einsatz: i64, query: &str) -> Vec<String> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/material{query}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    json.as_array()
        .unwrap()
        .iter()
        .map(|m| m["bezeichnung"].as_str().unwrap().to_string())
        .collect()
}

/// Spec `kraefte-entlassung` für Material (Wortlaut „aus dem Einsatz genommen“, LLH-1093): die
/// Zeile bleibt, fehlt in der Liste, steht unter `?entlassene=1`; Schreibwege sind 409, auch die
/// Zuordnung zu einer Einheit; „Erneut disponieren“ holt sie zurück; ein Storno direkt nach dem
/// Disponieren ist 204.
#[tokio::test]
async fn material_aus_dem_einsatz_nehmen_stornieren_reaktivieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let decke = material_disponieren(&app, &admin, einsatz, "Wolldecke").await;
    let trage = material_disponieren(&app, &admin, einsatz, "Trage").await;

    let (s, json) = aktion(&app, &admin, einsatz, decke, "entlassen").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["beendet_als"], "entlassen");
    assert_eq!(bezeichnungen(&app, &admin, einsatz, "").await, ["Trage"]);
    assert_eq!(
        bezeichnungen(&app, &admin, einsatz, "?entlassene=1").await,
        ["Wolldecke"]
    );
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Material «Wolldecke» (×1) aus dem Einsatz genommen"));
    assert_eq!(
        aktion(&app, &admin, einsatz, decke, "entlassen").await.0,
        StatusCode::CONFLICT
    );
    let einheit = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    for (methode, pfad, body) in [
        ("PATCH", format!("material/{decke}"), Some(r#"{"menge":2}"#)),
        ("PUT", format!("einheiten/{einheit}/material/{decke}"), None),
    ] {
        let (s, json) = anfrage(
            &app,
            methode,
            &format!("/api/einsaetze/{einsatz}/{pfad}"),
            &admin,
            body,
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}: {json}");
    }

    let (s, _) = aktion(&app, &admin, einsatz, decke, "reaktivieren").await;
    assert_eq!(s, StatusCode::OK);
    let mut aktiv = bezeichnungen(&app, &admin, einsatz, "").await;
    aktiv.sort();
    assert_eq!(aktiv, ["Trage", "Wolldecke"]);

    assert_eq!(
        aktion(&app, &admin, einsatz, trage, "stornieren").await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        bezeichnungen(&app, &admin, einsatz, "").await,
        ["Wolldecke"]
    );
    assert!(bezeichnungen(&app, &admin, einsatz, "?entlassene=1")
        .await
        .is_empty());
    // Wer einmal herausgenommen war, lässt sich nicht stornieren.
    let (s, json) = aktion(&app, &admin, einsatz, decke, "stornieren").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
}

// ── Material-Liste (LLH-1093 Teil I) ────────────────────────────────────────────────────

/// Disponiert Ad-hoc-Material mit Bezeichnung und Menge; liefert die `em_id`.
async fn adhoc_disponieren(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bezeichnung: &str,
    menge: i64,
) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        cookie,
        Some(&format!(
            r#"{{"adhoc":{{"bezeichnung":"{bezeichnung}"}},"menge":{menge}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

async fn material_patch(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    em: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/material/{em}"),
        cookie,
        Some(body),
    )
    .await
}

async fn material_zeile(app: &axum::Router, cookie: &str, einsatz: i64, em: i64) -> Value {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/material"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    json.as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == em)
        .cloned()
        .unwrap_or_else(|| panic!("Material {em} fehlt in der Liste"))
}

/// Spec `material-liste`, „Grenzen der Materialangaben“: Ad-hoc-Texte höchstens 200 Zeichen,
/// sonst 400 und nichts angelegt; 200 Zeichen gehen.
#[tokio::test]
async fn adhoc_texte_ueber_der_grenze_sind_400_und_legen_nichts_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let lang = "x".repeat(201);
    for feld in [
        "bezeichnung",
        "kategorie",
        "bestandsnummer",
        "traegerorganisation",
    ] {
        let adhoc = if feld == "bezeichnung" {
            format!(r#"{{"bezeichnung":"{lang}"}}"#)
        } else {
            format!(r#"{{"bezeichnung":"Decke","{feld}":"{lang}"}}"#)
        };
        let (s, json) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/material"),
            &admin,
            Some(&format!(r#"{{"adhoc":{adhoc}}}"#)),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}: {json}");
        assert!(
            json["error"]
                .as_str()
                .unwrap()
                .contains("darf höchstens 200 Zeichen lang sein"),
            "{feld}: {json}"
        );
    }
    assert!(bezeichnungen(&app, &admin, einsatz, "").await.is_empty());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 0);
    let genau = "y".repeat(200);
    adhoc_disponieren(&app, &admin, einsatz, &genau, 1).await;
}

/// Bemerkung höchstens 2 000 Zeichen (Spec `material-liste`); darüber 400, nichts geschrieben.
#[tokio::test]
async fn bemerkung_ueber_der_grenze_ist_400_und_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Decke", 5).await;
    let lang = "b".repeat(2_001);
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"bemerkung":"{lang}","menge":7}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    let zeile = material_zeile(&app, &admin, einsatz, em).await;
    assert_eq!(zeile["menge"], 5);
    assert!(zeile["bemerkung"].is_null());
    let genau = "b".repeat(2_000);
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"bemerkung":"{genau}"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
}

/// Spec `material-liste`, „Ad-hoc-Angaben korrigieren“ und „Korrektur steht im ETB“: ein
/// Eintrag nennt jede geänderte Angabe mit alt und neu; unverändert schreibt nichts.
#[tokio::test]
async fn adhoc_angaben_korrigieren_schreibt_einen_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Feldbeten", 12).await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        r#"{"bezeichnung":"  Feldbetten ","kategorie":"Betreuung"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["bezeichnung"], "Feldbetten");
    assert_eq!(json["kategorie"], "Betreuung");
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 1
    );
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t
            == "Material «Feldbetten»: Bezeichnung «Feldbeten» → «Feldbetten», Kategorie «—» → «Betreuung»"));

    // Bestandsnummer und Träger setzen, dann leeren.
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        r#"{"bestandsnummer":"B-7","traegerorganisation":"THW"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(
        (
            json["bestandsnummer"].as_str(),
            json["traegerorganisation"].as_str()
        ),
        (Some("B-7"), Some("THW"))
    );
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        r#"{"bestandsnummer":null,"traegerorganisation":"  "}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(json["bestandsnummer"].is_null() && json["traegerorganisation"].is_null());
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Material «Feldbetten»: Bestandsnummer «B-7» → «—», Träger «THW» → «—»"));

    // Unverändert gesendet: kein Eintrag.
    let anzahl = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        r#"{"bezeichnung":"Feldbetten","kategorie":"Betreuung","bestandsnummer":null}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl);
}

/// Stamm-Posten: 422 „im Stamm pflegen“, und nichts aus der Anfrage ist geschrieben, auch die
/// Menge nicht. Eine zu lange Bezeichnung ist auch hier 400 (vor dem Zusammenhang).
#[tokio::test]
async fn stamm_angaben_sind_422_und_schreiben_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = material_disponieren(&app, &admin, einsatz, "Wolldecke").await;
    let etb = system_etb_anzahl(&app, &admin, einsatz).await;
    for body in [
        r#"{"kategorie":"Sonstiges","menge":9}"#,
        r#"{"bezeichnung":"Decke","status":"defekt"}"#,
        r#"{"bestandsnummer":null,"bemerkung":"x"}"#,
        r#"{"traegerorganisation":"THW"}"#,
    ] {
        let (s, json) = material_patch(&app, &admin, einsatz, em, body).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {json}");
        assert!(
            json["error"].as_str().unwrap().contains("im Stamm pflegen"),
            "{json}"
        );
    }
    let zeile = material_zeile(&app, &admin, einsatz, em).await;
    assert_eq!(zeile["menge"], 1);
    assert_eq!(zeile["status"], "einsatzbereit");
    assert_eq!(zeile["kategorie"], "Betreuung");
    assert!(zeile["bemerkung"].is_null());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb);

    let lang = "x".repeat(201);
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"bezeichnung":"{lang}"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
}

/// Leere oder `null`-Bezeichnung ist 400 (Pflichtfeld), zu lange Ad-hoc-Angaben auch; an einem
/// aus dem Einsatz genommenen Posten ist die Korrektur 409.
#[tokio::test]
async fn adhoc_angaben_grenzen_und_beendeter_posten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Feldbett", 2).await;
    let lang = "k".repeat(201);
    for body in [
        r#"{"bezeichnung":""}"#.to_string(),
        r#"{"bezeichnung":"   "}"#.to_string(),
        r#"{"bezeichnung":null}"#.to_string(),
        format!(r#"{{"kategorie":"{lang}"}}"#),
        format!(r#"{{"bestandsnummer":"{lang}"}}"#),
        format!(r#"{{"traegerorganisation":"{lang}"}}"#),
    ] {
        let (s, json) = material_patch(&app, &admin, einsatz, em, &body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {json}");
    }
    assert_eq!(
        material_zeile(&app, &admin, einsatz, em).await["bezeichnung"],
        "Feldbett"
    );
    let (s, _) = aktion(&app, &admin, einsatz, em, "entlassen").await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = material_patch(&app, &admin, einsatz, em, r#"{"bezeichnung":"Liege"}"#).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
}

/// Die Einheit zeigt die Bezeichnung ihres Materials, das UHS-Detail die ganze Zeile: eine
/// korrigierte Bezeichnung meldet beide, eine Kategorie nur die UHS.
#[tokio::test]
async fn angaben_melden_einheit_und_uhs_wenn_deren_ansicht_sich_aendert() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Feldbeten", 4).await;
    let einheit = in_einheit(&app, &admin, einsatz, em).await;
    let uhs = create_uhs(&app, &admin, einsatz, "UHS 1").await;
    let (s, _) = material_patch(&app, &admin, einsatz, em, &format!(r#"{{"uhs_id":{uhs}}}"#)).await;
    assert_eq!(s, StatusCode::OK);

    let mut rx = live.abonniere(einsatz);
    let (s, _) = material_patch(&app, &admin, einsatz, em, r#"{"bezeichnung":"Feldbetten"}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit), ereignis("uhs", uhs)],
        "Bezeichnung: Einheit und UHS"
    );
    let (s, _) = material_patch(&app, &admin, einsatz, em, r#"{"kategorie":"Betreuung"}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Kategorie: nur UHS"
    );
    let (s, _) = material_patch(&app, &admin, einsatz, em, r#"{"kategorie":"Betreuung"}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "unverändert");
}

/// Setzt den Status einer UHS über die Route (geplant → aktiv → aufgeloest).
async fn uhs_status(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64, status: &str) {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        cookie,
        Some(&format!(r#"{{"status":"{status}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{status}: {json}");
}

/// Spec `material-liste`, „UHS-Verortung prüft das Ziel“: fremd, unbekannt oder storniert 404,
/// aufgelöst 422, jeweils ohne zu schreiben; geplant und aktiv gehen; Lösen und ein unveränderter
/// Wert prüfen nichts.
#[tokio::test]
async fn uhs_verortung_prueft_das_ziel() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Trage", 2).await;
    let fremd = create_uhs(&app, &admin, anderer, "Fremd").await;
    let storniert = create_uhs(&app, &admin, einsatz, "Storno").await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/uhs/{storniert}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let geplant = create_uhs(&app, &admin, einsatz, "Geplant").await;
    let aufgeloest = create_uhs(&app, &admin, einsatz, "Aufgelöst").await;
    uhs_status(&app, &admin, einsatz, aufgeloest, "aufgeloest").await;

    for (uhs, erwartet) in [
        (fremd, StatusCode::NOT_FOUND),
        (storniert, StatusCode::NOT_FOUND),
        (999_999, StatusCode::NOT_FOUND),
        (aufgeloest, StatusCode::UNPROCESSABLE_ENTITY),
    ] {
        let (s, json) = material_patch(
            &app,
            &admin,
            einsatz,
            em,
            &format!(r#"{{"uhs_id":{uhs},"menge":5}}"#),
        )
        .await;
        assert_eq!(s, erwartet, "UHS {uhs}: {json}");
        let zeile = material_zeile(&app, &admin, einsatz, em).await;
        assert!(zeile["uhs_id"].is_null(), "UHS {uhs}");
        assert_eq!(zeile["menge"], 2, "UHS {uhs}: nichts geschrieben");
    }
    let (_, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"uhs_id":{aufgeloest}}}"#),
    )
    .await;
    assert_eq!(json["error"], "UHS ist aufgelöst");

    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"uhs_id":{geplant}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "geplant: {json}");
    uhs_status(&app, &admin, einsatz, geplant, "aktiv").await;
    let aktiv = geplant;
    // Liegt das Material an einer UHS, die danach aufgelöst wird, bleibt es änderbar.
    uhs_status(&app, &admin, einsatz, aktiv, "aufgeloest").await;
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"uhs_id":{aktiv},"menge":3}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "unveränderter Wert: {json}");
    let (s, json) = material_patch(&app, &admin, einsatz, em, r#"{"uhs_id":null}"#).await;
    assert_eq!(s, StatusCode::OK, "Lösen: {json}");
    assert!(json["uhs_id"].is_null());

    // An einer aktiven UHS verorten geht.
    let zweite = create_uhs(&app, &admin, einsatz, "Zweite").await;
    uhs_status(&app, &admin, einsatz, zweite, "aktiv").await;
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"uhs_id":{zweite}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "aktiv: {json}");
}
