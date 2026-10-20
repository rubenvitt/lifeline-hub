use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

fn body() -> String {
    serde_json::json!({
        "art": "RTW", "bezeichnung": "2 RTW zur Verstärkung", "anzahl": 2,
        "adressat_kategorie": "leitstelle", "adressat_bezeichnung": "Leitstelle Nord",
        "prioritaet": "dringend"
    })
    .to_string()
}

#[tokio::test]
async fn anlegen_erzeugt_nachforderung_und_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["status"], "angefordert");
    assert_eq!(n["anzahl"], 2);
    assert_eq!(n["adressat_kategorie"], "leitstelle");
    assert_eq!(n["ist_offen"], true);
    assert!(n["etb_nachforderung_id"].is_i64());
    // ETB enthält die Anforderung als Meldung.
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    assert!(etb
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["typ"] == "meldung"));
}

#[tokio::test]
async fn anlegen_ohne_bezeichnung_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b = serde_json::json!({ "art": "RTW", "bezeichnung": "  ", "adressat_kategorie": "leitstelle" }).to_string();
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&b),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// LFH-553 (Spec `stab-versorgung`, „Betriebsstoffe als Nachforderung mit freier Art“):
/// Betriebsstoffe und Verbrauchsgüter laufen als Nachforderung mit frei beschrifteter Art.
/// Eine feste Artenliste wäre eine neue Entscheidung (Wiedervorlage nur mit Feldbefund) —
/// dieser Test hält fest, dass die Art heute nicht gegen eine Liste geprüft wird.
#[tokio::test]
async fn betriebsstoff_ist_eine_nachforderung_mit_freier_art() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b = serde_json::json!({
        "art": "Kraftstoff Diesel", "bezeichnung": "2 × 200 l für Pumpen EA Süd", "anzahl": 2,
        "adressat_kategorie": "leitstelle"
    })
    .to_string();
    let (status, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&b),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["art"], "Kraftstoff Diesel");
    assert_eq!(n["status"], "angefordert");
    let etb_id = n["etb_nachforderung_id"].as_i64().expect("ETB-Verweis");
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    let eintrag = etb
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == etb_id)
        .expect("ETB-Eintrag der Nachforderung");
    assert!(eintrag["inhalt"]
        .as_str()
        .unwrap()
        .contains("Kraftstoff Diesel"));
}

#[tokio::test]
async fn anlegen_ungueltige_adressat_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b =
        serde_json::json!({ "art": "RTW", "bezeichnung": "x", "adressat_kategorie": "irgendwer" })
            .to_string();
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&b),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn status_workflow_und_ungueltiger_uebergang_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();

    // angefordert → unterwegs ist KEIN erlaubter (Sprung) → 422.
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
        &admin,
        Some(r#"{"status":"unterwegs"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // angefordert → zugesagt → unterwegs → eingetroffen (linear).
    for ziel in ["zugesagt", "unterwegs", "eingetroffen"] {
        let (status, j) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
            &admin,
            Some(&format!(r#"{{"status":"{ziel}"}}"#)),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{j:?}");
        assert_eq!(j["status"], ziel);
    }
    // eingetroffen ist terminal → weiterer Übergang 422.
    let (status, j) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(j.as_array().unwrap()[0]["ist_offen"], false);
}

#[tokio::test]
async fn status_abgelehnt_ueber_status_endpoint_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    // 'abgelehnt' gehört auf den /ablehnen-Pfad → /status weist sauber mit 422 ab (kein 400).
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
        &admin,
        Some(r#"{"status":"abgelehnt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn ablehnen_setzt_grund() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    let (status, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/ablehnen"),
        &admin,
        Some(r#"{"grund":"keine Reserven"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(j["status"], "abgelehnt");
    assert_eq!(j["abgelehnt_grund"], "keine Reserven");
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &erika_c,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &erika_c,
        Some(&body()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_einsatz_status_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{a}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{b}/nachforderungen/{nid}/status"),
        &admin,
        Some(r#"{"status":"zugesagt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── Rücknahme nach einer Übernahme (LLH-1226, design.md D9) ─────────────────────────────

async fn set_status(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    nid: i64,
    status: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
        cookie,
        Some(&format!(r#"{{"status":"{status}"}}"#)),
    )
    .await
}

/// Setzt eine Nachforderung ab und meldet sie eingetroffen; liefert ihre id.
async fn eingetroffen(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let (_, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        cookie,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    for s in ["zugesagt", "unterwegs", "eingetroffen"] {
        assert_eq!(set_status(app, cookie, e, nid, s).await.0, StatusCode::OK);
    }
    nid
}

/// Übernimmt einen Posten aus der Nachforderung; liefert die `em_id`.
async fn uebernehmen(app: &axum::Router, cookie: &str, e: i64, nid: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/material"),
        cookie,
        Some(&format!(
            r#"{{"adhoc":{{"bezeichnung":"RTW-Ausstattung"}},"nachforderung_id":{nid}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

/// Spec `nachforderung-material`, „Rücknahme nach Übernahme gesperrt“: mit einem zählenden
/// Posten bleibt die Nachforderung eingetroffen (422 mit Grund), auch ein aus dem Einsatz
/// genommener Posten sperrt.
#[tokio::test]
async fn ruecknahme_nach_uebernahme_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nid = eingetroffen(&app, &admin, e).await;
    let em = uebernehmen(&app, &admin, e, nid).await;

    let (s, json) = set_status(&app, &admin, e, nid, "unterwegs").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"],
        "Aus der Nachforderung ist Material übernommen"
    );
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/material/{em}/entlassen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let (s, _) = set_status(&app, &admin, e, nid, "unterwegs").await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "entlassen zählt weiter"
    );

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["status"], "eingetroffen");
}

/// LLH-1247: „Rückgängig“ nach „Zusage erfassen“ nimmt die Zusage zurück (früher 400
/// „Ungültiger Zielstatus“) und leert ihren Zeitpunkt; die nächste Zusage trägt ihren eigenen.
#[tokio::test]
async fn ruecknahme_auf_angefordert_geht_und_leert_den_zeitpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();

    let (s, json) = set_status(&app, &admin, e, nid, "zugesagt").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(json["zugesagt_at"].is_string());

    let (s, json) = set_status(&app, &admin, e, nid, "angefordert").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status"], "angefordert");
    assert!(json["zugesagt_at"].is_null(), "{json}");
    assert_eq!(json["ist_offen"], true);

    let (s, json) = set_status(&app, &admin, e, nid, "zugesagt").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(json["zugesagt_at"].is_string());

    // Zwei Stufen zurück bleiben zu.
    assert_eq!(
        set_status(&app, &admin, e, nid, "unterwegs").await.0,
        StatusCode::OK
    );
    let (s, _) = set_status(&app, &admin, e, nid, "angefordert").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Ohne Posten und mit nur storniertem Posten bleibt die Rücknahme (LFH-343 C8) erlaubt.
#[tokio::test]
async fn ruecknahme_ohne_oder_mit_storniertem_posten_geht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ohne = eingetroffen(&app, &admin, e).await;
    let (s, json) = set_status(&app, &admin, e, ohne, "unterwegs").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status"], "unterwegs");

    let storniert = eingetroffen(&app, &admin, e).await;
    let em = uebernehmen(&app, &admin, e, storniert).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/material/{em}/stornieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, json) = set_status(&app, &admin, e, storniert, "unterwegs").await;
    assert_eq!(s, StatusCode::OK, "{json}");
}
