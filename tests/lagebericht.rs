use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

#[tokio::test]
async fn anlegen_und_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["vorlage"], "lagebericht");
    assert_eq!(json["status"], "entwurf");
    assert_eq!(json["abschnitte"].as_array().unwrap().len(), 7);
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn freigabe_schreibt_genau_einen_lage_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage 10:00"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"Hochwasser steigt."}]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, frei) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(frei["status"], "freigegeben");
    assert!(frei["etb_eintrag_id"].is_i64());
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let lage: Vec<&serde_json::Value> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "lage")
        .collect();
    assert_eq!(lage.len(), 1);
    assert!(lage[0]["inhalt"]
        .as_str()
        .unwrap()
        .contains("Hochwasser steigt."));
    assert_eq!(lage[0]["lagebericht_id"], lid);
}

#[tokio::test]
async fn freigegebener_bericht_nicht_mehr_patchbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"titel":"Neu"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Der Abschnitts-Schlüssel wird gegen die Schlüsselmenge der Vorlage geprüft und scheitert
/// für sich genommen → 400 (LFH-305). Abgrenzung zu den 422 dieser Datei
/// (`freigegebener_bericht_nicht_mehr_patchbar`, `freigabe_leerer_bericht_422`): die
/// bewerten den Zustand des Objekts, nicht ein einzelnes Feld. Der Positiv-Zweig belegt,
/// dass der 400 aus der Schlüsselprüfung kommt und nicht aus einem vorgelagerten Gate.
#[tokio::test]
async fn patch_unbekannter_abschnitts_schluessel_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    let u = format!("/api/einsaetze/{einsatz}/lageberichte/{lid}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"quatsch","text":"x"}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"Lage steigt."}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Positiv-Zweig: {antwort:?}");
}

#[tokio::test]
async fn freigabe_leerer_bericht_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn fortschreiben_erzeugt_version_2() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    let (s, fort) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/fortschreiben"),
        &admin,
        Some(r#"{}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(fort["version"], 2);
    assert_eq!(fort["vorgaenger_id"], lid);
    assert_eq!(fort["status"], "entwurf");
    // Fortschreibung übernimmt die Inhalte des freigegebenen Vorgängers als Ausgangspunkt.
    assert_eq!(fort["abschnitte"][0]["text"], "A");
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/lageberichte"),
            &erika,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/lageberichte"),
            &erika,
            Some(r#"{"vorlage":"freitext","titel":"X"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
