use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn seed_liefert_sechs_aktive_status() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 6);
    assert_eq!(json[0]["label"], "verfügbar");
}

#[tokio::test]
async fn admin_crud_kategorie_validierung_dublette() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    assert_eq!(
        anfrage(&app, "GET", "/api/personal-status", &erika, None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &erika,
            Some(r#"{"label":"X","kategorie":"gebunden"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );

    // Ungültige Kategorie → 400.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &admin,
            Some(r#"{"label":"X","kategorie":"quatsch"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Anlegen ok.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &admin,
            Some(r#"{"label":"nachalarmiert","kategorie":"gebunden","sortier":70}"#)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    // Dublette label → Conflict.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal-status",
            &admin,
            Some(r#"{"label":"nachalarmiert","kategorie":"verfuegbar"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn patch_aktualisiert_und_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/personal-status",
        &admin,
        Some(r#"{"label":"nachalarmiert","kategorie":"gebunden","sortier":70}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    let (status, json) = anfrage(&app, "PATCH", &format!("/api/personal-status/{id}"), &admin, Some(r##"{"label":"nachgefordert","kategorie":"verfuegbar","farbe":"#00ff00","sortier":75}"##)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["label"], "nachgefordert");
    assert_eq!(json["kategorie"], "verfuegbar");
    // Unbekannte id → 404.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            "/api/personal-status/9999",
            &admin,
            Some(r#"{"label":"X","kategorie":"gebunden"}"#)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// Legt einen Status mit allen vier Feldern gesetzt an und liefert seine id.
async fn status_mit_farbe(app: &axum::Router, admin: &str, label: &str) -> i64 {
    let (_, json) = anfrage(
        app,
        "POST",
        "/api/personal-status",
        admin,
        Some(&format!(
            r##"{{"label":"{label}","kategorie":"gebunden","farbe":"#ff0000","sortier":70}}"##
        )),
    )
    .await;
    json["id"].as_i64().unwrap()
}

/// **Der unterscheidende Test.** Zusammen mit `patch_farbe_null_loescht_die_farbe` bildet er
/// das Paar, das den Tri-State beweist: HIER ist `farbe` nicht im Body und muss stehen
/// bleiben, DORT steht `null` im Body und muss löschen. Unter dem alten Vollersatz-Verhalten
/// war beides ununterscheidbar — das fehlende Feld wurde zu `None` und nullte die Spalte.
#[tokio::test]
async fn patch_ohne_farbe_laesst_farbe_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_mit_farbe(&app, &admin, "nachalarmiert").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal-status/{id}"),
        &admin,
        Some(r#"{"label":"umbenannt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["label"], "umbenannt");
    assert_eq!(json["farbe"], "#ff0000", "nicht gesendetes Feld bleibt");
    assert_eq!(
        json["kategorie"], "gebunden",
        "nicht gesendetes Feld bleibt"
    );
}

#[tokio::test]
async fn patch_farbe_null_loescht_die_farbe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_mit_farbe(&app, &admin, "nachalarmiert").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal-status/{id}"),
        &admin,
        Some(r#"{"farbe":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["farbe"].is_null(), "explizites null leert die Spalte");
    assert_eq!(json["label"], "nachalarmiert", "Nachbarfeld unberührt");
}

/// `""` ist der zweite Weg zum Leerwunsch (`trimme_tri`) — die Formulare schicken
/// geleerte Textfelder als Leerstring, nicht als `null`.
#[tokio::test]
async fn patch_farbe_leerstring_loescht_die_farbe() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_mit_farbe(&app, &admin, "nachalarmiert").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal-status/{id}"),
        &admin,
        Some(r#"{"farbe":"   "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["farbe"].is_null());
}

/// Der schärfste Test der Route: `sortier` ist NOT NULL und trug im alten Body ein
/// `#[serde(default)]` — jeder Teil-Patch setzte die Sortierung still auf 0 und verschob
/// den Eintrag in der Katalogliste.
#[tokio::test]
async fn patch_ohne_sortier_laesst_sortier_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_mit_farbe(&app, &admin, "nachalarmiert").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal-status/{id}"),
        &admin,
        Some(r#"{"label":"umbenannt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["sortier"], 70,
        "NOT-NULL-Spalte darf nicht auf 0 fallen"
    );
}

/// Statuscode-Konvention (LFH-305): ein VORHANDENES, aber leeres Pflichtfeld scheitert am
/// Feld selbst → 400. Ein ABSENTES ist kein Wunsch und geht durch — der Kontrast ist die
/// Aussage, ein Test allein wäre in beiden Welten grün.
#[tokio::test]
async fn patch_leeres_label_ist_400_absentes_laesst_label_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = status_mit_farbe(&app, &admin, "nachalarmiert").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/personal-status/{id}"),
            &admin,
            Some(r#"{"label":"   "}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Unbekannter Enum-Wert ebenfalls 400 — aber nur, wenn das Feld gesendet wurde.
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/personal-status/{id}"),
            &admin,
            Some(r#"{"kategorie":"quatsch"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal-status/{id}"),
        &admin,
        Some(r#"{"sortier":5}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "absentes Pflichtfeld ist zulässig");
    assert_eq!(json["label"], "nachalarmiert");
}

#[tokio::test]
async fn deaktivieren_entfernt_aus_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/personal-status",
        &admin,
        Some(r#"{"label":"Reserve","kategorie":"verfuegbar"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/personal-status/{id}/deaktivieren"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    assert!(!liste
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["label"] == "Reserve"));
}
