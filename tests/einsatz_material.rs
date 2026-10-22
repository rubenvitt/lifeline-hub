use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{
    anfrage, benutzer_anlegen, einheit_bilden, einsatz_anlegen, login_cookie, objekt_ereignisse,
    rolle_setzen, setup, setup_mit_live, system_etb_anzahl, system_etb_inhalte,
};

// ---------- Zusatz-Helfer ----------

/// Legt Stamm-Verbrauchsgut an (Admin, Mengen über 1) und liefert dessen id.
async fn material_anlegen(app: &axum::Router, admin: &str, bezeichnung: &str) -> i64 {
    stamm_anlegen(app, admin, bezeichnung, "verbrauchsgut").await
}

/// Legt Stamm-Material der Art `art` an (Admin) und liefert dessen id.
async fn stamm_anlegen(app: &axum::Router, admin: &str, bezeichnung: &str, art: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/material",
        admin,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","kategorie":"Betreuung","art":"{art}"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["art"], art);
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

/// LLH-1224 D6/D9: ein Posten hat höchstens einen Ort. Wechselt er von der Einheit an eine UHS,
/// melden alte Einheit und neue UHS, der ETB nennt beide Orte, und die Einheit zählt ihn nicht
/// mehr; danach meldet ein Statuswechsel nur noch die UHS.
#[tokio::test]
async fn wechsel_von_der_einheit_an_die_uhs_loest_die_einheit() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = material_disponieren(&app, &admin, einsatz, "Trage").await;
    let einheit = in_einheit(&app, &admin, einsatz, em).await;
    let uhs = create_uhs(&app, &admin, einsatz, "UHS 1").await;
    let pfad = format!("/api/einsaetze/{einsatz}/material/{em}");

    let mut rx = live.abonniere(einsatz);
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&format!(r#"{{"uhs_id":{uhs}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(
        (json["uhs_id"].as_i64(), json["einheit_id"].as_i64()),
        (Some(uhs), None)
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit), ereignis("uhs", uhs)],
        "Ortswechsel: alte Einheit und neue UHS"
    );
    let texte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        texte
            .iter()
            .any(|t| t == "Material «Trage» (×1): Einheit «1. Zug» → UHS «UHS 1»"),
        "{texte:?}"
    );

    let (s, _) = anfrage(&app, "PATCH", &pfad, &admin, Some(r#"{"status":"defekt"}"#)).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Status: nur noch die UHS"
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
/// korrigierte Bezeichnung meldet den Ort des Postens, eine Kategorie nur die UHS (LLH-1224:
/// ein Ort je Posten).
#[tokio::test]
async fn angaben_melden_einheit_und_uhs_wenn_deren_ansicht_sich_aendert() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let im_zug = adhoc_disponieren(&app, &admin, einsatz, "Feldbeten", 4).await;
    let an_uhs = adhoc_disponieren(&app, &admin, einsatz, "Liegen", 4).await;
    let einheit = in_einheit(&app, &admin, einsatz, im_zug).await;
    let uhs = create_uhs(&app, &admin, einsatz, "UHS 1").await;
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        an_uhs,
        &format!(r#"{{"uhs_id":{uhs}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let mut rx = live.abonniere(einsatz);
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        im_zug,
        r#"{"bezeichnung":"Feldbetten"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Bezeichnung in der Einheit"
    );
    let (s, _) = material_patch(&app, &admin, einsatz, an_uhs, r#"{"bezeichnung":"Liege"}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Bezeichnung an der UHS"
    );
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        im_zug,
        r#"{"kategorie":"Betreuung"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![],
        "Kategorie: die Einheit zeigt sie nicht"
    );
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        an_uhs,
        r#"{"kategorie":"Betreuung"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Kategorie: UHS"
    );
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        an_uhs,
        r#"{"kategorie":"Betreuung"}"#,
    )
    .await;
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

async fn aufteilen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    em: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material/{em}/aufteilen"),
        cookie,
        Some(body),
    )
    .await
}

/// Spec `material-liste`, „Posten aufteilen“: 201 mit `[Ausgang, neu]`, beide Zeilen am selben
/// Ort, Summe gleich, genau ein ETB-Eintrag; der Ort wird gemeldet. Die Teilzeile kommt aus dem
/// Rest und startet ohne Ausgabe (LLH-1224 D14).
#[tokio::test]
async fn aufteilen_legt_zweite_zeile_an_und_schreibt_einen_etb_eintrag() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Wolldecke", 50).await;
    let uhs = create_uhs(&app, &admin, einsatz, "UHS 1").await;
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"uhs_id":{uhs},"ausgegeben":10}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let etb = system_etb_anzahl(&app, &admin, einsatz).await;

    let mut rx = live.abonniere(einsatz);
    let (s, json) = aufteilen(&app, &admin, einsatz, em, r#"{"menge":20}"#).await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let zeilen = json.as_array().unwrap();
    assert_eq!(zeilen.len(), 2);
    assert_eq!(zeilen[0]["id"], em);
    assert_eq!(
        (zeilen[0]["menge"].as_i64(), zeilen[1]["menge"].as_i64()),
        (Some(30), Some(20))
    );
    assert_eq!(
        (
            zeilen[0]["ausgegeben"].as_i64(),
            zeilen[1]["ausgegeben"].as_i64()
        ),
        (Some(10), Some(0)),
        "die Ausgabe bleibt an der Ausgangszeile"
    );
    let neu = zeilen[1]["id"].as_i64().unwrap();
    for z in zeilen {
        assert!(z["einheit_id"].is_null());
        assert_eq!(z["uhs_id"], uhs);
        assert_eq!(z["art"], "verbrauchsgut");
        assert_eq!(z["bezeichnung"], "Wolldecke");
    }
    assert_eq!(zeilen[0]["disponiert_at"], zeilen[1]["disponiert_at"]);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb + 1);
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Material «Wolldecke» aufgeteilt: 50 → 30 + 20"));
    assert_eq!(
        objekt_ereignisse(
            &mut rx,
            &[
                ("material", "material_id"),
                ("einheit", "einheit_id"),
                ("uhs", "uhs_id")
            ]
        ),
        vec![
            ereignis("material", em),
            ereignis("material", neu),
            ereignis("uhs", uhs)
        ]
    );
    assert_eq!(
        material_zeile(&app, &admin, einsatz, neu).await["menge"],
        20
    );
}

/// Spec `material-liste`, „Grenzen des Aufteilens“: unter 1 400, ab der Menge 422 (auch bei
/// Menge 1), aus dem Einsatz genommen 409, fremd 404; nie wird etwas geschrieben.
#[tokio::test]
async fn aufteilen_grenzen_400_422_409_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Decke", 5).await;
    let eins = adhoc_disponieren(&app, &admin, einsatz, "Pumpe", 1).await;
    let etb = system_etb_anzahl(&app, &admin, einsatz).await;
    for (ziel, body, erwartet) in [
        (em, r#"{"menge":0}"#, StatusCode::BAD_REQUEST),
        (em, r#"{"menge":-3}"#, StatusCode::BAD_REQUEST),
        (em, r#"{}"#, StatusCode::BAD_REQUEST),
        (em, r#"{"menge":"zwei"}"#, StatusCode::BAD_REQUEST),
        (em, r#"{"menge":5}"#, StatusCode::UNPROCESSABLE_ENTITY),
        (em, r#"{"menge":9}"#, StatusCode::UNPROCESSABLE_ENTITY),
        (eins, r#"{"menge":1}"#, StatusCode::UNPROCESSABLE_ENTITY),
        (999_999, r#"{"menge":1}"#, StatusCode::NOT_FOUND),
    ] {
        let (s, json) = aufteilen(&app, &admin, einsatz, ziel, body).await;
        assert_eq!(s, erwartet, "{body}: {json}");
    }
    let (s, _) = aufteilen(&app, &admin, anderer, em, r#"{"menge":1}"#).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Zeile eines anderen Einsatzes");
    let (s, _) = aktion(&app, &admin, einsatz, em, "entlassen").await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = aufteilen(&app, &admin, einsatz, em, r#"{"menge":1}"#).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(bezeichnungen(&app, &admin, einsatz, "").await, ["Pumpe"]);
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb + 1,
        "nur das Herausnehmen schreibt"
    );
}

/// t1hvaqzu (LLH-1251), Spec `material-liste`, „Posten aufteilen“: 20 von 50 an einen anderen Ort
/// in EINEM Aufteilen. Die neue Zeile steht am Ziel, der Rest am alten Ort, genau EIN ETB-Eintrag
/// nennt Aufteilen und Ortswechsel; alter und neuer Ort werden gemeldet (`material-modell`,
/// „Ortswechsel live“).
#[tokio::test]
async fn aufteilen_mit_zielort_eine_zeile_am_ziel_ein_etb_eintrag() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Wolldecke", 50).await;
    let zelt = create_uhs(&app, &admin, einsatz, "Zelt").await;
    let turnhalle = create_uhs(&app, &admin, einsatz, "Turnhalle").await;
    let (s, _) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"uhs_id":{zelt}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let etb = system_etb_anzahl(&app, &admin, einsatz).await;

    let mut rx = live.abonniere(einsatz);
    let (s, json) = aufteilen(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"menge":20,"uhs_id":{turnhalle}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let zeilen = json.as_array().unwrap();
    assert_eq!(
        (zeilen[0]["id"].as_i64(), zeilen[0]["menge"].as_i64()),
        (Some(em), Some(30))
    );
    assert_eq!(zeilen[0]["uhs_id"], zelt, "der Rest bleibt am alten Ort");
    assert_eq!(zeilen[1]["menge"], 20);
    assert_eq!(
        zeilen[1]["uhs_id"], turnhalle,
        "die neue Zeile steht am Ziel"
    );
    let neu = zeilen[1]["id"].as_i64().unwrap();
    assert_eq!(
        material_zeile(&app, &admin, einsatz, neu).await["uhs_id"],
        turnhalle
    );
    assert_eq!(bezeichnungen(&app, &admin, einsatz, "").await.len(), 2);
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb + 1,
        "genau ein Eintrag"
    );
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| {
            t
        == "Material «Wolldecke» aufgeteilt: 50 → 30 + 20, davon 20: UHS «Zelt» → UHS «Turnhalle»"
        }));
    assert_eq!(
        objekt_ereignisse(&mut rx, &[("material", "material_id"), ("uhs", "uhs_id")]),
        vec![
            ereignis("material", em),
            ereignis("material", neu),
            ereignis("uhs", zelt),
            ereignis("uhs", turnhalle)
        ]
    );
}

/// t1hvaqzu, Spec `material-liste`, „Grenzen des Aufteilens“: 400 vor 422 (zwei Orte), ein
/// aufgelöstes Ziel 422; nie wird etwas geschrieben, auch kein ETB-Eintrag.
#[tokio::test]
async fn aufteilen_mit_zielort_grenzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Wolldecke", 50).await;
    let uhs = create_uhs(&app, &admin, einsatz, "Turnhalle").await;
    let aufgeloest = create_uhs(&app, &admin, einsatz, "Zelt").await;
    uhs_status(&app, &admin, einsatz, aufgeloest, "aufgeloest").await;
    let etb = system_etb_anzahl(&app, &admin, einsatz).await;
    for (body, erwartet) in [
        (
            format!(r#"{{"menge":0,"uhs_id":{uhs},"br_id":1}}"#),
            StatusCode::BAD_REQUEST,
        ),
        (
            format!(r#"{{"menge":20,"uhs_id":{uhs},"einheit_id":1}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            format!(r#"{{"menge":20,"uhs_id":{aufgeloest}}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            r#"{"menge":20,"uhs_id":999999}"#.to_string(),
            StatusCode::NOT_FOUND,
        ),
    ] {
        let (s, json) = aufteilen(&app, &admin, einsatz, em, &body).await;
        assert_eq!(s, erwartet, "{body}: {json}");
    }
    assert_eq!(material_zeile(&app, &admin, einsatz, em).await["menge"], 50);
    assert_eq!(bezeichnungen(&app, &admin, einsatz, "").await.len(), 1);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb);
}

/// Ohne Schreibrecht am Material kein Aufteilen (Modul `material` über `PFAD_KEY`).
#[tokio::test]
async fn aufteilen_braucht_schreibrecht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Decke", 5).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) = aufteilen(&app, &erika, einsatz, em, r#"{"menge":1}"#).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(material_zeile(&app, &admin, einsatz, em).await["menge"], 5);
}

// ── Material-Modell A (LLH-1224) ──────────────────────────────────────────────────────────

/// Die System-ETB-Einträge, die nach den ersten `vorher` hinzugekommen sind, in der Folge ihres
/// Entstehens (die Liste kommt neueste zuerst).
async fn neue_etb(app: &axum::Router, cookie: &str, einsatz: i64, vorher: usize) -> Vec<String> {
    let alle = system_etb_inhalte(app, cookie, einsatz).await;
    let mut neu = alle[..alle.len() - vorher].to_vec();
    neu.reverse();
    neu
}

async fn disponieren_roh(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        cookie,
        Some(body),
    )
    .await
}

/// Spec `material-modell`, „Art einer Zeile“ (design.md D2/D5): der Stamm gibt die Art vor, ein
/// Ad-hoc-Posten nennt sie oder bekommt sie aus der Menge; ein Gerät steht je Stück im Einsatz.
/// Jede Ablehnung schreibt nichts.
#[tokio::test]
async fn disponieren_kopiert_die_art_und_prueft_die_menge() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let geraet = stamm_anlegen(&app, &admin, "Stromerzeuger", "geraet").await;
    let decke = material_anlegen(&app, &admin, "Wolldecke").await;

    let abgelehnt = [
        (
            format!(r#"{{"material_id":{geraet},"menge":2}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
            "Ein Gerät steht je Stück im Einsatz",
        ),
        (
            format!(r#"{{"material_id":{decke},"menge":5,"art":"verbrauchsgut"}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
            "Die Art kommt aus dem Stamm",
        ),
        (
            r#"{"adhoc":{"bezeichnung":"Pumpe"},"menge":3,"art":"geraet"}"#.to_string(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "Ein Gerät steht je Stück im Einsatz",
        ),
        (
            r#"{"adhoc":{"bezeichnung":"Fass"},"art":"fass"}"#.to_string(),
            StatusCode::BAD_REQUEST,
            "Unbekannte Art",
        ),
    ];
    for (body, status, grund) in &abgelehnt {
        let (s, json) = disponieren_roh(&app, &admin, einsatz, body).await;
        assert_eq!(s, *status, "{body}: {json}");
        assert!(
            json["error"].as_str().unwrap_or_default().contains(grund),
            "{body}: {json}"
        );
    }
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        0,
        "nichts geschrieben"
    );

    let faelle = [
        (format!(r#"{{"material_id":{geraet}}}"#), "geraet"),
        (
            format!(r#"{{"material_id":{decke},"menge":50}}"#),
            "verbrauchsgut",
        ),
        (
            r#"{"adhoc":{"bezeichnung":"Feldbett"},"menge":200}"#.to_string(),
            "verbrauchsgut",
        ),
        (r#"{"adhoc":{"bezeichnung":"Trage"}}"#.to_string(), "geraet"),
        (
            r#"{"adhoc":{"bezeichnung":"Sandsack"},"art":"verbrauchsgut"}"#.to_string(),
            "verbrauchsgut",
        ),
    ];
    for (body, art) in &faelle {
        let (s, json) = disponieren_roh(&app, &admin, einsatz, body).await;
        assert_eq!(s, StatusCode::CREATED, "{body}: {json}");
        assert_eq!(json["art"], *art, "{body}");
        assert_eq!(json["ausgegeben"], 0, "{body}");
    }
}

/// Spec `material-modell`, „Ausgabe eines Verbrauchsguts“ (design.md D4/D11): absolute Ausgabe
/// mit ETB-Eintrag samt Rest, Rücknahme erlaubt, ohne Änderung kein Eintrag; die Regeln der
/// Ergebniszeile sind 422, falsche Werte 400, beides ohne zu schreiben.
#[tokio::test]
async fn ausgabe_schreibt_den_rest_ins_etb_und_prueft_die_zeile() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Wolldecke", 50).await;

    let (s, json) = material_patch(&app, &admin, einsatz, em, r#"{"ausgegeben":20}"#).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["ausgegeben"], 20);
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, _) = material_patch(&app, &admin, einsatz, em, r#"{"ausgegeben":30}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        neue_etb(&app, &admin, einsatz, vorher).await,
        ["Material «Wolldecke»: Ausgabe 20 → 30 (Rest 20 von 50)"]
    );

    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    for (body, status, grund) in [
        (
            r#"{"ausgegeben":60}"#,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Ausgabe größer als die Menge",
        ),
        (
            r#"{"menge":20}"#,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Menge kleiner als die Ausgabe",
        ),
        (
            r#"{"status":"verbraucht"}"#,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Status «verbraucht» gibt es nur für Geräte",
        ),
        (
            r#"{"art":"geraet"}"#,
            StatusCode::UNPROCESSABLE_ENTITY,
            "Ein Gerät steht je Stück im Einsatz",
        ),
        (r#"{"ausgegeben":-1}"#, StatusCode::BAD_REQUEST, "Ausgabe"),
        (
            r#"{"art":"fass","ausgegeben":60}"#,
            StatusCode::BAD_REQUEST,
            "Unbekannte Art",
        ),
        (r#"{"art":null}"#, StatusCode::BAD_REQUEST, "Art"),
    ] {
        let (s, json) = material_patch(&app, &admin, einsatz, em, body).await;
        assert_eq!(s, status, "{body}: {json}");
        assert!(
            json["error"].as_str().unwrap_or_default().contains(grund),
            "{body}: {json}"
        );
    }
    let zeile = material_zeile(&app, &admin, einsatz, em).await;
    assert_eq!(
        (
            zeile["menge"].as_i64(),
            zeile["ausgegeben"].as_i64(),
            zeile["art"].as_str()
        ),
        (Some(50), Some(30), Some("verbrauchsgut")),
        "nichts geschrieben"
    );
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, vorher);

    // Rücknahme: eine kleinere Ausgabe geht; derselbe Wert schreibt nichts.
    let (s, _) = material_patch(&app, &admin, einsatz, em, r#"{"ausgegeben":25}"#).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = material_patch(&app, &admin, einsatz, em, r#"{"ausgegeben":25}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        neue_etb(&app, &admin, einsatz, vorher).await,
        ["Material «Wolldecke»: Ausgabe 30 → 25 (Rest 25 von 50)"]
    );

    // Je Aspekt ein Eintrag, in der Reihenfolge Menge, Ausgabe, Status.
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        r#"{"status":"defekt","ausgegeben":60,"menge":80}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let neu = neue_etb(&app, &admin, einsatz, vorher).await;
    assert_eq!(neu.len(), 3, "{neu:?}");
    assert!(neu[0].contains("80"), "Menge zuerst: {neu:?}");
    assert_eq!(
        neu[1],
        "Material «Wolldecke»: Ausgabe 25 → 60 (Rest 20 von 80)"
    );
    assert!(neu[2].contains("defekt"), "Status zuletzt: {neu:?}");
}

/// design.md D10: die Art einer Zeile lässt sich korrigieren; der ETB nennt beide Arten.
#[tokio::test]
async fn art_wechsel_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Sandsack", 1).await;
    assert_eq!(
        material_zeile(&app, &admin, einsatz, em).await["art"],
        "geraet"
    );
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        r#"{"art":"verbrauchsgut","menge":40}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let neu = neue_etb(&app, &admin, einsatz, vorher).await;
    assert_eq!(neu.len(), 2, "{neu:?}");
    assert_eq!(neu[1], "Material «Sandsack»: Art Gerät → Verbrauchsgut");
    let zeile = material_zeile(&app, &admin, einsatz, em).await;
    assert_eq!(
        (zeile["art"].as_str(), zeile["menge"].as_i64()),
        (Some("verbrauchsgut"), Some(40))
    );

    // Zurück zum Gerät geht nur mit Menge 1 im selben PATCH („Art ändern …“ schickt beides).
    let (s, json) = material_patch(&app, &admin, einsatz, em, r#"{"art":"geraet"}"#).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) =
        material_patch(&app, &admin, einsatz, em, r#"{"art":"geraet","menge":1}"#).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(
        (json["art"].as_str(), json["menge"].as_i64()),
        (Some("geraet"), Some(1))
    );
    let neu = neue_etb(&app, &admin, einsatz, vorher).await;
    assert_eq!(neu.len(), 2, "{neu:?}");
    assert_eq!(neu[1], "Material «Sandsack»: Art Verbrauchsgut → Gerät");
}

/// Die Einheit zeigt Art und Ausgabe ihres Materials (Ausfall „aufgebraucht“): beide melden sie.
#[tokio::test]
async fn ausgabe_meldet_die_einheit() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Wolldecke", 10).await;
    let einheit = in_einheit(&app, &admin, einsatz, em).await;
    let mut rx = live.abonniere(einsatz);
    let (s, _) = material_patch(&app, &admin, einsatz, em, r#"{"ausgegeben":10}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)]
    );
}

async fn br_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume"),
        cookie,
        Some(&format!(r#"{{"bezeichnung":"{bez}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

async fn br_status(app: &axum::Router, cookie: &str, einsatz: i64, br: i64, status: &str) {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/status"),
        cookie,
        Some(&format!(r#"{{"status":"{status}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{status}: {json}");
}

async fn adhoc_fahrzeug(app: &axum::Router, cookie: &str, einsatz: i64, funkrufname: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        cookie,
        Some(&format!(r#"{{"adhoc":{{"funkrufname":"{funkrufname}"}}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

const ORTE: &[(&str, &str)] = &[
    ("einheit", "einheit_id"),
    ("uhs", "uhs_id"),
    ("fahrzeug", "fahrzeug_id"),
    ("bereitstellungsraum", "br_id"),
];

/// Spec `material-modell`, „Ein Ort je Posten“ (design.md D6/D7/D9/D11): Ort beim Disponieren,
/// Wechsel über alle Ortsarten mit je einem ETB-Eintrag und Meldung an alten und neuen Ort; zwei
/// Orte sind 422 ohne zu schreiben; `null` an einem fremden Ort ändert nichts.
#[tokio::test]
async fn ein_ort_je_posten_ueber_alle_ortsarten() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let uhs = create_uhs(&app, &admin, einsatz, "Turnhalle").await;
    let br = br_anlegen(&app, &admin, einsatz, "BR Nord").await;
    let ef = adhoc_fahrzeug(&app, &admin, einsatz, "Florian 1/83-1").await;
    let einheit = einheit_bilden(&app, &admin, einsatz, "Staffel A").await;

    let mut rx = live.abonniere(einsatz);
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &format!(r#"{{"adhoc":{{"bezeichnung":"Wolldecke"}},"menge":20,"uhs_id":{uhs}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let em = json["id"].as_i64().unwrap();
    assert_eq!(json["uhs_id"], uhs);
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Material «Wolldecke» (×20) disponiert, Ort UHS «Turnhalle»"));
    assert_eq!(objekt_ereignisse(&mut rx, ORTE), vec![ereignis("uhs", uhs)]);

    // Zwei Orte mit Wert: 422 vor der Transaktion, nichts geschrieben.
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        em,
        &format!(r#"{{"uhs_id":{uhs},"einheit_id":{einheit},"bemerkung":"x"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(json["error"], "Ein Posten hat höchstens einen Ort");
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &format!(
            r#"{{"adhoc":{{"bezeichnung":"Liege"}},"br_id":{br},"einsatz_fahrzeug_id":{ef}}}"#
        ),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, vorher);
    let zeile = material_zeile(&app, &admin, einsatz, em).await;
    assert_eq!(
        (zeile["uhs_id"].as_i64(), zeile["bemerkung"].as_str()),
        (Some(uhs), None)
    );

    // `null` an einem Ort, an dem der Posten nicht ist: keine Wirkung.
    let (s, json) = material_patch(&app, &admin, einsatz, em, r#"{"einheit_id":null}"#).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["uhs_id"], uhs);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, vorher);
    assert_eq!(objekt_ereignisse(&mut rx, ORTE), vec![]);

    let wege = [
        (
            format!(r#"{{"br_id":{br}}}"#),
            "UHS «Turnhalle» → Bereitstellungsraum «BR Nord»",
            vec![ereignis("uhs", uhs), ereignis("bereitstellungsraum", br)],
        ),
        (
            format!(r#"{{"einsatz_fahrzeug_id":{ef}}}"#),
            "Bereitstellungsraum «BR Nord» → Fahrzeug «Florian 1/83-1»",
            vec![
                ereignis("bereitstellungsraum", br),
                ereignis("fahrzeug", ef),
            ],
        ),
        (
            format!(r#"{{"einheit_id":{einheit}}}"#),
            "Fahrzeug «Florian 1/83-1» → Einheit «Staffel A»",
            vec![ereignis("fahrzeug", ef), ereignis("einheit", einheit)],
        ),
        (
            r#"{"einheit_id":null}"#.to_string(),
            "Einheit «Staffel A» → ohne Ort",
            vec![ereignis("einheit", einheit)],
        ),
    ];
    for (body, text, ereignisse) in wege {
        let vorher = system_etb_anzahl(&app, &admin, einsatz).await;
        let (s, json) = material_patch(&app, &admin, einsatz, em, &body).await;
        assert_eq!(s, StatusCode::OK, "{body}: {json}");
        assert_eq!(
            neue_etb(&app, &admin, einsatz, vorher).await,
            [format!("Material «Wolldecke» (×20): {text}")],
            "{body}"
        );
        let mut gemeldet = objekt_ereignisse(&mut rx, ORTE);
        gemeldet.sort();
        let mut erwartet = ereignisse;
        erwartet.sort();
        assert_eq!(gemeldet, erwartet, "{body}");
        let gesetzt = ["einheit_id", "einsatz_fahrzeug_id", "uhs_id", "br_id"]
            .iter()
            .filter(|f| json.get(**f).is_some_and(|v| !v.is_null()))
            .count();
        assert!(gesetzt <= 1, "{body}: {json}");
    }
}

/// design.md D8/D13: an einem aufgelösten Bereitstellungsraum bleibt der Posten; der unveränderte
/// Wert und das Lösen gehen, ein neuer Posten dorthin ist 422. Stornieren verlangt „ohne Ort“.
#[tokio::test]
async fn aufgeloester_br_behaelt_den_posten_und_storno_verlangt_ohne_ort() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let br = br_anlegen(&app, &admin, einsatz, "BR Nord").await;
    br_status(&app, &admin, einsatz, br, "aktiv").await;
    let em = adhoc_disponieren(&app, &admin, einsatz, "Wolldecke", 20).await;
    let zweiter = adhoc_disponieren(&app, &admin, einsatz, "Liege", 5).await;
    let (s, json) =
        material_patch(&app, &admin, einsatz, em, &format!(r#"{{"br_id":{br}}}"#)).await;
    assert_eq!(s, StatusCode::OK, "{json}");

    let (s, json) = aktion(&app, &admin, einsatz, em, "stornieren").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert!(
        json["error"]
            .as_str()
            .unwrap_or_default()
            .contains("Bereitstellungsraum"),
        "{json}"
    );

    br_status(&app, &admin, einsatz, br, "aufgeloest").await;
    assert_eq!(material_zeile(&app, &admin, einsatz, em).await["br_id"], br);
    let (s, json) =
        material_patch(&app, &admin, einsatz, em, &format!(r#"{{"br_id":{br}}}"#)).await;
    assert_eq!(s, StatusCode::OK, "unveränderter Wert: {json}");
    let (s, json) = material_patch(
        &app,
        &admin,
        einsatz,
        zweiter,
        &format!(r#"{{"br_id":{br}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(json["error"], "Bereitstellungsraum ist aufgelöst");
    let (s, json) = material_patch(&app, &admin, einsatz, em, r#"{"br_id":null}"#).await;
    assert_eq!(s, StatusCode::OK, "Lösen: {json}");
    assert!(json.get("br_id").is_none_or(|v| v.is_null()));
    let (s, json) = aktion(&app, &admin, einsatz, em, "stornieren").await;
    assert_eq!(s, StatusCode::NO_CONTENT, "ohne Ort: {json}");
}

// ── Nachforderung → Material (LLH-1226 Teil I) ──────────────────────────────────────────

/// Setzt eine Nachforderung ab und schaltet sie bis `bis` weiter; liefert ihre id.
async fn nachforderung_bis(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    art: &str,
    bezeichnung: &str,
    anzahl: i64,
    bis: &str,
) -> i64 {
    let (s, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/nachforderungen"),
        cookie,
        Some(
            &serde_json::json!({
                "art": art, "bezeichnung": bezeichnung, "anzahl": anzahl,
                "adressat_kategorie": "leitstelle"
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{n}");
    let id = n["id"].as_i64().unwrap();
    for status in ["zugesagt", "unterwegs", "eingetroffen"] {
        let (s, n) = nachforderung_status(app, cookie, einsatz, id, status).await;
        assert_eq!(s, StatusCode::OK, "{n}");
        if status == bis {
            break;
        }
    }
    id
}

async fn nachforderung_status(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    id: i64,
    status: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/nachforderungen/{id}/status"),
        cookie,
        Some(&format!(r#"{{"status":"{status}"}}"#)),
    )
    .await
}

/// Die Nachforderung `id` aus der Liste des Einsatzes.
async fn load_nachforderung(app: &axum::Router, cookie: &str, einsatz: i64, id: i64) -> Value {
    let (s, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/nachforderungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == id)
        .cloned()
        .unwrap_or_else(|| panic!("Nachforderung {id} fehlt"))
}

fn material_ids(n: &Value) -> Vec<i64> {
    n["material_ids"]
        .as_array()
        .unwrap_or_else(|| panic!("ohne material_ids: {n}"))
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect()
}

/// Anzahl aktiver und aus dem Einsatz genommener Posten: „nichts geschrieben“.
async fn posten_count(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let mut n = 0;
    for query in ["", "?entlassene=1"] {
        let (s, json) = anfrage(
            app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/material{query}"),
            cookie,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{json}");
        n += json.as_array().unwrap().len();
    }
    n
}

/// Ein ETB-Eintrag jeder Art (nicht nur System): die Nachforderung schreibt keinen eigenen.
async fn etb_count(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array().unwrap().len()
}

fn uebernahme(bezeichnung: &str, menge: i64, nachforderung: i64, rest: &str) -> String {
    format!(
        r#"{{"adhoc":{{"bezeichnung":"{bezeichnung}"}},"menge":{menge},"nachforderung_id":{nachforderung}{rest}}}"#
    )
}

/// Spec `nachforderung-material`, „Prüfung der Übernahme“ (design.md D2): 400 (Feldtyp) → 422
/// (`ergaenzen` ohne Bezug) → 403 (Nachforderungen nicht freigegeben, gleich ob es sie gibt) →
/// in der Transaktion 404 (fremd, unbekannt) → 422 (nicht eingetroffen). Keine Ablehnung schreibt
/// etwas.
#[tokio::test]
async fn uebernahme_prueft_bezug_freigabe_und_zustand() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let eingetroffen = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Tauchpumpe",
        "3 Tauchpumpen",
        3,
        "eingetroffen",
    )
    .await;
    let unterwegs = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Sandsäcke",
        "Deich",
        500,
        "unterwegs",
    )
    .await;
    let fremd = nachforderung_bis(
        &app,
        &admin,
        anderer,
        "Tauchpumpe",
        "fremd",
        1,
        "eingetroffen",
    )
    .await;
    let etb_vorher = etb_count(&app, &admin, einsatz).await;

    let tauchpumpe = r#"{"adhoc":{"bezeichnung":"Tauchpumpe"}"#;
    for (body, erwartet, grund) in [
        (
            format!(r#"{tauchpumpe},"nachforderung_id":"vier"}}"#),
            StatusCode::BAD_REQUEST,
            None,
        ),
        (
            format!(r#"{tauchpumpe},"nachforderung_id":{eingetroffen},"ergaenzen":"ja"}}"#),
            StatusCode::BAD_REQUEST,
            None,
        ),
        (
            format!(r#"{tauchpumpe},"ergaenzen":true}}"#),
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("Ergänzen nur mit Nachforderung"),
        ),
        (
            uebernahme("Tauchpumpe", 1, fremd, ""),
            StatusCode::NOT_FOUND,
            None,
        ),
        (
            uebernahme("Tauchpumpe", 1, 999_999, ""),
            StatusCode::NOT_FOUND,
            None,
        ),
        (
            uebernahme("Sandsäcke", 500, unterwegs, ""),
            StatusCode::UNPROCESSABLE_ENTITY,
            Some("Material wird erst nach dem Eintreffen übernommen"),
        ),
    ] {
        let (s, json) = disponieren_roh(&app, &admin, einsatz, &body).await;
        assert_eq!(s, erwartet, "{body}: {json}");
        if let Some(grund) = grund {
            assert_eq!(json["error"], grund, "{body}");
        }
    }

    // Material schreiben darf sie, Nachforderungen sieht sie nicht: 403 vor jedem Lesen.
    let frieda_id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, frieda_id, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/nachforderungen"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for nid in [eingetroffen, fremd, 999_999] {
        let (s, json) = disponieren_roh(
            &app,
            &frieda,
            einsatz,
            &uebernahme("Tauchpumpe", 1, nid, ""),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{nid}: {json}");
    }
    let (s, json) = disponieren_roh(
        &app,
        &frieda,
        einsatz,
        r#"{"adhoc":{"bezeichnung":"Ohne Bezug"}}"#,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "ohne Bezug braucht es die Freigabe nicht: {json}"
    );
    aktion(
        &app,
        &admin,
        einsatz,
        json["id"].as_i64().unwrap(),
        "stornieren",
    )
    .await;

    assert_eq!(posten_count(&app, &admin, einsatz).await, 0);
    assert_eq!(
        etb_count(&app, &admin, einsatz).await,
        etb_vorher + 2,
        "nur Disponieren und Storno des Postens ohne Bezug"
    );
    assert!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, eingetroffen).await).is_empty()
    );
}

/// Spec `nachforderung-material`, „Eingetroffenes Material übernehmen“ (design.md D2/D6): genau
/// ein Posten mit Bezug und Ort, genau ein ETB-Eintrag mit Herkunft, die Nachforderung bleibt
/// unverändert und trägt die Kennung. Gegenprobe: eine aufgelöste Einheit als Ort ist 409, und
/// es bleibt weder Posten noch ETB noch Bezug.
#[tokio::test]
async fn uebernahme_legt_einen_posten_mit_bezug_ort_und_etb_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let staffel = einheit_bilden(&app, &admin, einsatz, "Staffel A").await;
    let nid = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Tauchpumpe",
        "3 Tauchpumpen für Keller Hauptstraße",
        3,
        "eingetroffen",
    )
    .await;
    let vorher = load_nachforderung(&app, &admin, einsatz, nid).await;
    let etb_vorher = etb_count(&app, &admin, einsatz).await;
    let system_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme(
            "Tauchpumpe",
            1,
            nid,
            &format!(r#","art":"geraet","einheit_id":{staffel}"#),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let em = json["id"].as_i64().unwrap();
    assert_eq!(json["nachforderung_id"], nid);
    assert_eq!(json["einheit_id"], staffel);
    assert_eq!(json["art"], "geraet");
    assert_eq!(json["ist_adhoc"], true);
    assert_eq!(
        material_zeile(&app, &admin, einsatz, em).await["nachforderung_id"],
        nid
    );

    assert_eq!(etb_count(&app, &admin, einsatz).await, etb_vorher + 1);
    assert_eq!(
        neue_etb(&app, &admin, einsatz, system_vorher).await,
        [
            "Material «Tauchpumpe» (×1) disponiert, Ort Einheit «Staffel A», aus Nachforderung \
          «3 Tauchpumpen für Keller Hauptstraße»"
        ]
    );
    let nachher = load_nachforderung(&app, &admin, einsatz, nid).await;
    assert_eq!(material_ids(&nachher), vec![em]);
    let ohne_ids = |mut n: Value| {
        n.as_object_mut().unwrap().remove("material_ids");
        n
    };
    assert_eq!(
        ohne_ids(nachher),
        ohne_ids(vorher),
        "Nachforderung unverändert"
    );

    // Gegenprobe: aufgelöste Einheit (mit Spur, damit sie nicht gelöscht wird).
    let aufgeloest = einheit_bilden(&app, &admin, einsatz, "Trupp weg").await;
    let (s, spur) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &format!(r#"{{"adhoc":{{"bezeichnung":"Spur"}},"einheit_id":{aufgeloest}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{spur}");
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/einheiten/{aufgeloest}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let posten_vorher = posten_count(&app, &admin, einsatz).await;
    let etb_vorher = etb_count(&app, &admin, einsatz).await;
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme(
            "Tauchpumpe",
            1,
            nid,
            &format!(r#","ergaenzen":true,"einheit_id":{aufgeloest}"#),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(
        json["error"], "Die Einheit ist aufgelöst",
        "der 409 kommt vom Ort, nicht von der zweiten Übernahme"
    );
    assert_eq!(posten_count(&app, &admin, einsatz).await, posten_vorher);
    assert_eq!(etb_count(&app, &admin, einsatz).await, etb_vorher);
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, nid).await),
        vec![em]
    );
}

/// Spec `nachforderung-material`, „Weitere Posten nur bewusst“ (design.md D3): ohne `ergaenzen`
/// ist die zweite Übernahme 409 und schreibt nichts, mit `ergaenzen` gibt es einen zweiten Posten;
/// ein stornierter Posten gibt die Nachforderung frei, ein aus dem Einsatz genommener zählt.
#[tokio::test]
async fn weitere_posten_nur_bewusst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sand = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Sandsäcke",
        "2 000 Sandsäcke",
        2000,
        "eingetroffen",
    )
    .await;

    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Sandsäcke", 1200, sand, ""),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let erste = json["id"].as_i64().unwrap();

    // Doppelklick: dieselbe Übernahme noch einmal.
    let etb_vorher = etb_count(&app, &admin, einsatz).await;
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Sandsäcke", 1200, sand, ""),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(
        json["error"],
        "Aus dieser Nachforderung ist schon Material übernommen"
    );
    assert_eq!(posten_count(&app, &admin, einsatz).await, 1);
    assert_eq!(etb_count(&app, &admin, einsatz).await, etb_vorher);
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Sandsäcke", 1200, sand, r#","ergaenzen":false"#),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "ergaenzen false wie fehlend: {json}"
    );

    // Zweite Fuhr bewusst ergänzt.
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Sandsäcke", 800, sand, r#","ergaenzen":true"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let zweite = json["id"].as_i64().unwrap();
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, sand).await),
        vec![erste, zweite]
    );

    // Fehlbuchung storniert: die Nachforderung ist wieder frei.
    let pumpe = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Tauchpumpe",
        "Pumpe Keller",
        1,
        "eingetroffen",
    )
    .await;
    let (_, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Tauchpumpe", 1, pumpe, ""),
    )
    .await;
    let fehl = json["id"].as_i64().unwrap();
    assert_eq!(
        aktion(&app, &admin, einsatz, fehl, "stornieren").await.0,
        StatusCode::NO_CONTENT
    );
    assert!(material_ids(&load_nachforderung(&app, &admin, einsatz, pumpe).await).is_empty());
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Tauchpumpe", 1, pumpe, ""),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "nach dem Storno ohne ergaenzen: {json}"
    );
    let richtig = json["id"].as_i64().unwrap();

    // Aus dem Einsatz genommen: war da, zählt weiter.
    let (s, _) = aktion(&app, &admin, einsatz, richtig, "entlassen").await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, pumpe).await),
        vec![richtig]
    );
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Tauchpumpe", 1, pumpe, ""),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
}

/// Spec `nachforderung-material`, „ETB und Live bei der Übernahme“ (design.md D7): nach dem
/// Commit `material`, das Ereignis des Orts und `nachforderung`.
#[tokio::test]
async fn uebernahme_meldet_material_ort_und_nachforderung() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let staffel = einheit_bilden(&app, &admin, einsatz, "Staffel A").await;
    let nid = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Tauchpumpe",
        "3 Tauchpumpen",
        3,
        "eingetroffen",
    )
    .await;

    let mut rx = live.abonniere(einsatz);
    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Tauchpumpe", 1, nid, &format!(r#","einheit_id":{staffel}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let em = json["id"].as_i64().unwrap();
    let mut events = Vec::new();
    while let Ok(n) = rx.try_recv() {
        let data: Value = serde_json::from_str(&n.data).unwrap_or(Value::Null);
        events.push((n.event.as_str().to_string(), data));
    }
    let tags: Vec<&str> = events.iter().map(|(t, _)| t.as_str()).collect();
    assert!(
        events
            .iter()
            .any(|(t, d)| t == "material" && d["material_id"] == em),
        "{tags:?}"
    );
    assert!(
        events
            .iter()
            .any(|(t, d)| t == "einheit" && d["einheit_id"] == staffel),
        "{tags:?}"
    );
    assert_eq!(
        tags.iter().filter(|t| **t == "nachforderung").count(),
        1,
        "{tags:?}"
    );

    // Ohne Bezug kein `nachforderung`.
    let mut rx = live.abonniere(einsatz);
    let (s, _) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        r#"{"adhoc":{"bezeichnung":"Decke"}}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let mut tags = Vec::new();
    while let Ok(n) = rx.try_recv() {
        tags.push(n.event.as_str().to_string());
    }
    assert!(!tags.iter().any(|t| t == "nachforderung"), "{tags:?}");
}

fn tags(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>,
) -> Vec<String> {
    let mut tags = Vec::new();
    while let Ok(n) = rx.try_recv() {
        tags.push(n.event.as_str().to_string());
    }
    tags
}

/// Spec `nachforderung-material`, „Bezug über den Lebenszyklus des Postens“ (design.md D7/D9):
/// Aufteilen gibt den Bezug an die neue Zeile weiter; Aufteilen, Stornieren und Reaktivieren eines
/// verknüpften Postens melden `nachforderung`, an einem Posten ohne Bezug nicht.
#[tokio::test]
async fn lebenszyklus_eines_verknuepften_postens() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nid = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Wolldecke",
        "50 Wolldecken",
        50,
        "eingetroffen",
    )
    .await;
    let (s, json) =
        disponieren_roh(&app, &admin, einsatz, &uebernahme("Wolldecke", 50, nid, "")).await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let em = json["id"].as_i64().unwrap();

    let mut rx = live.abonniere(einsatz);
    let (s, json) = aufteilen(&app, &admin, einsatz, em, r#"{"menge":20}"#).await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let teil = json[1]["id"].as_i64().unwrap();
    assert_eq!(json[1]["nachforderung_id"], nid);
    assert_eq!(json[0]["nachforderung_id"], nid);
    assert!(tags(&mut rx).iter().any(|t| t == "nachforderung"));
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, nid).await),
        vec![em, teil]
    );

    let mut rx = live.abonniere(einsatz);
    assert_eq!(
        aktion(&app, &admin, einsatz, teil, "stornieren").await.0,
        StatusCode::NO_CONTENT
    );
    assert!(tags(&mut rx).iter().any(|t| t == "nachforderung"));
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, nid).await),
        vec![em]
    );

    let mut rx = live.abonniere(einsatz);
    let (s, json) = aktion(&app, &admin, einsatz, teil, "reaktivieren").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(
        json["nachforderung_id"], nid,
        "der Bezug bleibt über den Storno"
    );
    assert!(tags(&mut rx).iter().any(|t| t == "nachforderung"));
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, nid).await),
        vec![em, teil]
    );

    // Ohne Bezug: dieselben Wege, kein `nachforderung`.
    let ohne = adhoc_disponieren(&app, &admin, einsatz, "Feldbetten", 10).await;
    let mut rx = live.abonniere(einsatz);
    let (s, json) = aufteilen(&app, &admin, einsatz, ohne, r#"{"menge":4}"#).await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let ohne_teil = json[1]["id"].as_i64().unwrap();
    assert!(json[1].get("nachforderung_id").is_none());
    aktion(&app, &admin, einsatz, ohne_teil, "stornieren").await;
    aktion(&app, &admin, einsatz, ohne_teil, "reaktivieren").await;
    let t = tags(&mut rx);
    assert!(!t.iter().any(|t| t == "nachforderung"), "{t:?}");
}

/// design.md D9: PATCH setzt den Bezug nicht, ein mitgeschicktes `nachforderung_id` bleibt ohne
/// Wirkung (nachträgliches Verknüpfen ist eine Folgeaufgabe).
#[tokio::test]
async fn patch_aendert_den_bezug_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erste = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Tauchpumpe",
        "Pumpe 1",
        1,
        "eingetroffen",
    )
    .await;
    let zweite = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Tauchpumpe",
        "Pumpe 2",
        1,
        "eingetroffen",
    )
    .await;
    let (_, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &uebernahme("Tauchpumpe", 1, erste, ""),
    )
    .await;
    let em = json["id"].as_i64().unwrap();
    let ohne = adhoc_disponieren(&app, &admin, einsatz, "Decke", 1).await;

    for (posten, bezug) in [(em, Some(erste)), (ohne, None)] {
        let (s, json) = material_patch(
            &app,
            &admin,
            einsatz,
            posten,
            &format!(r#"{{"nachforderung_id":{zweite},"bemerkung":"Keller"}}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{json}");
        assert_eq!(json["bemerkung"], "Keller");
        assert_eq!(json["nachforderung_id"].as_i64(), bezug);
    }
    assert!(material_ids(&load_nachforderung(&app, &admin, einsatz, zweite).await).is_empty());
}

/// Spec `nachforderung-material`, „Eingetroffenes Material übernehmen“ (design.md D1): der Bezug
/// geht auch mit Stamm-Material; die Art kommt aus dem Stamm.
#[tokio::test]
async fn stamm_material_aus_nachforderung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let stamm = stamm_anlegen(&app, &admin, "Stromerzeuger", "geraet").await;
    let nid = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Stromerzeuger",
        "Strom für die Betreuungsstelle",
        1,
        "eingetroffen",
    )
    .await;
    let system_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = disponieren_roh(
        &app,
        &admin,
        einsatz,
        &format!(r#"{{"material_id":{stamm},"nachforderung_id":{nid}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let em = json["id"].as_i64().unwrap();
    assert_eq!(json["material_id"], stamm);
    assert_eq!(json["nachforderung_id"], nid);
    assert_eq!(json["art"], "geraet");
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, nid).await),
        vec![em]
    );
    assert_eq!(
        neue_etb(&app, &admin, einsatz, system_vorher).await,
        [
            "Material «Stromerzeuger» (×1) disponiert, aus Nachforderung «Strom für die \
          Betreuungsstelle»"
        ]
    );
}

/// design.md D9 (Nachtrag Review): Reaktivieren eines stornierten, verknüpften Postens ist eine
/// Übernahme und verlangt eine eingetroffene Nachforderung. Wurde sie nach dem Storno auf
/// „Unterwegs“ zurückgenommen, ist es 422, und sie bleibt ohne zählenden Posten. Ist sie
/// eingetroffen, gelingt es auch neben einem schon vorhandenen Posten (bewusstes Rückgängig, kein
/// 409).
#[tokio::test]
async fn reaktivieren_verlangt_eine_eingetroffene_nachforderung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nid = nachforderung_bis(
        &app,
        &admin,
        einsatz,
        "Tauchpumpe",
        "Pumpe Keller",
        2,
        "eingetroffen",
    )
    .await;
    let (_, json) =
        disponieren_roh(&app, &admin, einsatz, &uebernahme("Tauchpumpe", 1, nid, "")).await;
    let erste = json["id"].as_i64().unwrap();
    assert_eq!(
        aktion(&app, &admin, einsatz, erste, "stornieren").await.0,
        StatusCode::NO_CONTENT
    );
    let (s, json) = nachforderung_status(&app, &admin, einsatz, nid, "unterwegs").await;
    assert_eq!(s, StatusCode::OK, "{json}");

    let etb_vorher = etb_count(&app, &admin, einsatz).await;
    let (s, json) = aktion(&app, &admin, einsatz, erste, "reaktivieren").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"],
        "Material wird erst nach dem Eintreffen übernommen"
    );
    assert_eq!(etb_count(&app, &admin, einsatz).await, etb_vorher);
    assert_eq!(posten_count(&app, &admin, einsatz).await, 0);
    let n = load_nachforderung(&app, &admin, einsatz, nid).await;
    assert_eq!(n["status"], "unterwegs");
    assert!(material_ids(&n).is_empty());

    // Wieder eingetroffen, ein zweiter Posten übernommen: das Reaktivieren des ersten scheitert
    // nicht an 409.
    let (s, _) = nachforderung_status(&app, &admin, einsatz, nid, "eingetroffen").await;
    assert_eq!(s, StatusCode::OK);
    let (_, json) =
        disponieren_roh(&app, &admin, einsatz, &uebernahme("Tauchpumpe", 1, nid, "")).await;
    let zweite = json["id"].as_i64().unwrap();
    let (s, json) = aktion(&app, &admin, einsatz, erste, "reaktivieren").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(
        material_ids(&load_nachforderung(&app, &admin, einsatz, nid).await),
        vec![erste, zweite]
    );
}

/// Spec `material-modell`, „Ein Stamm-Gerät mit Bestandsnummer steht höchstens einmal aktiv im
/// Einsatz“ (LLH-1256): die zweite aktive Disposition desselben Stücks ist 409 mit Grund und
/// schreibt nichts; nach dem Herausnehmen geht es wieder. Das Wiederaufnehmen der alten Zeile
/// neben einer aktiven ist ebenso 409. Ein Gerät ohne Bestandsnummer und Verbrauchsgut bleiben
/// mehrfach disponierbar.
#[tokio::test]
async fn stamm_geraet_mit_bestandsnummer_nur_einmal_aktiv() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        "/api/material",
        &admin,
        Some(r#"{"bezeichnung":"Stromerzeuger 5 kVA","bestandsnummer":"SE-1","art":"geraet"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let stueck = json["id"].as_i64().unwrap();
    let pfad = format!("/api/einsaetze/{einsatz}/material");
    let body = format!(r#"{{"material_id":{stueck}}}"#);

    let (s, json) = anfrage(&app, "POST", &pfad, &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let erste = json["id"].as_i64().unwrap();
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = anfrage(&app, "POST", &pfad, &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(
        json["error"],
        "Das Gerät «Stromerzeuger 5 kVA» (SE-1) ist in diesem Einsatz schon disponiert; \
         erst aus dem Einsatz nehmen"
    );
    let (_, liste) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1, "zweite Zeile angelegt");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);

    // Herausgenommen: das Stück lässt sich wieder disponieren.
    let (s, _) = aktion(&app, &admin, einsatz, erste, "entlassen").await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = anfrage(&app, "POST", &pfad, &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "nach dem Herausnehmen: {json}");

    // Die alte Zeile neben der neuen wieder aufnehmen: dasselbe Stück, also 409.
    let (s, json) = aktion(&app, &admin, einsatz, erste, "reaktivieren").await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert!(
        json["error"]
            .as_str()
            .unwrap()
            .contains("ist in diesem Einsatz schon disponiert"),
        "{json}"
    );

    // Ohne Bestandsnummer ist ein Gerät kein bestimmtes Stück: mehrfach erlaubt.
    let ohne = stamm_anlegen(&app, &admin, "Trage", "geraet").await;
    let body = format!(r#"{{"material_id":{ohne}}}"#);
    for _ in 0..2 {
        let (s, json) = anfrage(&app, "POST", &pfad, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::CREATED, "Gerät ohne Bestandsnummer: {json}");
    }
}
