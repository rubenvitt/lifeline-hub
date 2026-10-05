use axum::http::StatusCode;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup};

#[tokio::test]
async fn anlegen_listen_und_erledigen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen"),
        &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00","intervall_minuten":30}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let eid = json["id"].as_i64().unwrap();
    assert_eq!(json["status"], "offen");
    assert_eq!(
        json["faellig_at"], "2026-06-11 10:00:00",
        "auf Sekundenformat normalisiert"
    );

    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen/{eid}/erledigen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"),
        &admin,
        None,
    )
    .await;
    assert!(
        liste.as_array().unwrap().is_empty(),
        "erledigte verschwinden aus offener Liste"
    );
}

#[tokio::test]
async fn anlegen_lehnt_leeren_titel_ab() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen"),
        &admin,
        Some(r#"{"titel":"  ","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    // Leerer Titel → AppError::Validation → 400 (Konvention, vgl. src/error.rs + tests/chat.rs).
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// --- Eingabegrenzen (LFH-924): Giftzeilen für den Planer gar nicht erst annehmen ---

async fn anlegen_status(faellig_at: &str, intervall: Option<i64>) -> StatusCode {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "titel": "Lagemeldung", "faellig_at": faellig_at, "intervall_minuten": intervall
    })
    .to_string();
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen"),
        &admin,
        Some(&body),
    )
    .await
    .0
}

#[tokio::test]
async fn intervall_ueber_sieben_tagen_ist_400() {
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(999_999_999_999)).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(10_081)).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(0)).await,
        StatusCode::BAD_REQUEST
    );
    // Die Grenze selbst gilt: 7 Tage.
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(10_080)).await,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn faelligkeit_ausserhalb_des_jahresbereichs_ist_400() {
    for faellig in [
        "0226-05-01 10:00",
        "-262000-05-01 10:00",
        "2101-01-01 00:00",
    ] {
        assert_eq!(
            anlegen_status(faellig, Some(1)).await,
            StatusCode::BAD_REQUEST,
            "{faellig}"
        );
    }
    for faellig in ["2000-01-01 00:00", "2100-12-31 23:59"] {
        assert_eq!(
            anlegen_status(faellig, None).await,
            StatusCode::CREATED,
            "{faellig}"
        );
    }
}

// --- Sachbezug-Guard (LFH-112): Allowlist + einsatz-gescopter Existenz-Check ---

#[tokio::test]
async fn erinnerung_bezug_fremde_meldung_ist_404() {
    // Schreibberechtigter in Einsatz e1 darf keine Meldungs-ID aus e2 referenzieren —
    // sonst Cross-Einsatz-Schreibzugriff über den Scheduler (setze_eskaliert, nicht
    // einsatz-gescopt). Der Guard weist das an der Quelle ab.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    // Fremde Meldung in e2 anlegen.
    let meldung_body = serde_json::json!({
        "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
        "inhalt": "Deich instabil", "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string();
    let (status, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e2}/meldungen"),
        &admin,
        Some(&meldung_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let fremde_mid = m["id"].as_i64().unwrap();

    let body = format!(
        r#"{{"titel":"X","faellig_at":"2026-06-11 10:00","bezug_typ":"meldung","bezug_id":{fremde_mid}}}"#
    );
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e1}/erinnerungen"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "fremde Meldungs-ID als Bezug → 404"
    );
}

#[tokio::test]
async fn erinnerung_bezug_unbekannter_typ_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen"),
        &admin,
        Some(r#"{"titel":"X","faellig_at":"2026-06-11 10:00","bezug_typ":"schaden","bezug_id":1}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "bezug_typ nicht in der Allowlist → Validation"
    );
}

#[tokio::test]
async fn erinnerung_bezug_gueltige_etb_ist_201() {
    // Der EtbPage-Frontend-Pfad postet bezug_typ='etb' + ETB-Eintrag-ID desselben Einsatzes —
    // das muss durchgehen.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, etb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        Some(r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"Deich instabil"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let etb_id = etb["id"].as_i64().unwrap();

    let body = format!(
        r#"{{"titel":"Nachverfolgen","faellig_at":"2026-06-11 10:00","bezug_typ":"etb","bezug_id":{etb_id}}}"#
    );
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "gültiger ETB-Bezug aus demselben Einsatz → 201"
    );
    assert_eq!(json["bezug_typ"], "etb");
    assert_eq!(json["bezug_id"], etb_id);
}

#[tokio::test]
async fn erledigen_anderer_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e1}/erinnerungen"),
        &admin,
        Some(r#"{"titel":"X","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    let eid = json["id"].as_i64().unwrap();
    // Erinnerung von e1 über e2 ansprechen → NotFound.
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e2}/erinnerungen/{eid}/erledigen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Rücknahme von Erledigt/Quittiert (LFH-343).
///
/// Beide Knöpfe schalten mit EINEM Klick statt mit Rückfrage; der Rückgängig-Toast braucht
/// dafür einen Weg, den der Server annimmt.
#[tokio::test]
async fn oeffnen_nimmt_erledigt_und_quittiert_zurueck() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen"),
        &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    let eid = json["id"].as_i64().unwrap();
    let oeffnen = format!("/api/einsaetze/{e}/erinnerungen/{eid}/oeffnen");

    // Aus `offen` heraus wäre die Rücknahme ein No-op, der wie Erfolg aussieht → 422.
    let (leerlauf, _) = anfrage(&app, "POST", &oeffnen, &admin, None).await;
    assert_eq!(leerlauf, StatusCode::UNPROCESSABLE_ENTITY);

    // Weg 1: erledigt → offen.
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen/{eid}/erledigen"),
        &admin,
        None,
    )
    .await;
    let (status, zurueck) = anfrage(&app, "POST", &oeffnen, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(zurueck["status"], "offen");
    // Die Vollzugsachse muss MITgehen: bliebe sie stehen, zeigte die Karte „offen"
    // und trüge gleichzeitig den grünen Vollzugs-Tag.
    assert_eq!(zurueck["vollzug_status"], "offen");
    assert!(zurueck["erledigt_at"].is_null());

    // Weg 2: quittiert → offen. Die Quittungsachse ist eine ANDERE Spalte als der
    // Vollzug — eine Rücknahme, die nur eine von beiden räumt, ist keine.
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen/{eid}/quittieren"),
        &admin,
        None,
    )
    .await;
    let (status, zurueck) = anfrage(&app, "POST", &oeffnen, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(zurueck["status"], "offen");
    assert!(zurueck["quittiert_at"].is_null());

    // Und sie taucht in der Offen-Liste wieder auf — das ist der sichtbare Zweck.
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/erinnerungen?nur_offen=true"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}
