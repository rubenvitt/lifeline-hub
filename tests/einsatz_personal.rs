use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_setzt_status_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas Müller").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(
            r#"{{"personal_id":{person},"staerke_position":"fuehrer"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Thomas Müller");
    assert_eq!(json["status_kategorie"], "gebunden");
    assert_eq!(json["staerke_position"], "fuehrer");
    assert_eq!(json["ist_adhoc"], false);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);
}

#[tokio::test]
async fn doppelte_stamm_disposition_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let body = format!(r#"{{"personal_id":{person}}}"#);
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/personal"),
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
            &format!("/api/einsaetze/{einsatz}/personal"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn adhoc_ohne_stamm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personal"), &admin,
        Some(r#"{"adhoc":{"name":"Notarzt Extern","funktion":"Notarzt","staerke_position":"fuehrer"}}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["personal_id"].is_null());
    assert_eq!(json["funktion"], "Notarzt");
}

#[tokio::test]
async fn beobachter_liest_disponiert_nicht() {
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
            &format!("/api/einsaetze/{einsatz}/personal"),
            &erika,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &erika,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
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
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn status_wechsel_und_entfernen_schreiben_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();

    // Anderen 'gebunden'-Status aus dem Seed holen ('im Einsatz').
    let (_, stati) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    let im_einsatz = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == "im Einsatz")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
            &admin,
            Some(&format!(r#"{{"status_id":{im_einsatz}}}"#))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    // Disponieren + Status-Wechsel + Entfernen = 3 System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

/// Das Entlassen feuert `personal`, das einen Einheiten- oder Abschnittsleser ohne Personal- und
/// Kartenrecht nicht erreicht. War die Person Mitglied (und damit womöglich Führer) einer Einheit,
/// trägt `einheit` die geänderte Mitgliederliste; war sie Abschnittsleiter, trägt `abschnitt` den
/// gelösten Leiter (LLH-1178).
#[tokio::test]
async fn entlassen_feuert_einheit_und_abschnitt_nur_bei_betroffener_person() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let ohne = stammpersonal_disponieren(&app, &admin, einsatz, "Ohne Rolle").await;
    let mitglied = stammpersonal_disponieren(&app, &admin, einsatz, "Mitglied").await;
    let chef = stammpersonal_disponieren(&app, &admin, einsatz, "Chef").await;
    let leiter = stammpersonal_disponieren(&app, &admin, einsatz, "Leiter Nord").await;
    for ep in [mitglied, chef] {
        let (s, _) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/personal/{ep}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "zuordnen");
    }
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}"),
        &admin,
        Some(&format!(r#"{{"fuehrer_id":{chef}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Führer setzen");
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        Some(&format!(r#"{{"name":"Nord","leiter_id":{leiter}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt anlegen");
    let abschnitt = json["id"].as_i64().unwrap();

    let mut rx = live.abonniere(einsatz);
    let mut ereignisse = || {
        let (mut einheiten, mut abschnitte) = (Vec::new(), Vec::new());
        while let Ok(n) = rx.try_recv() {
            let data: serde_json::Value = serde_json::from_str(&n.data).unwrap();
            match n.event {
                lifeline_hub::live::LiveEvent::Einheit => {
                    einheiten.push(data["einheit_id"].as_i64().unwrap())
                }
                lifeline_hub::live::LiveEvent::Abschnitt => {
                    abschnitte.push(data["abschnitt_id"].as_i64().unwrap())
                }
                _ => {}
            }
        }
        (einheiten, abschnitte)
    };
    let entlassen = |ep: i64| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "DELETE",
                &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
                &admin,
                None,
            )
            .await
            .0
        }
    };

    assert_eq!(entlassen(ohne).await, StatusCode::NO_CONTENT);
    assert_eq!(ereignisse(), (vec![], vec![]), "ohne Rolle: nur `personal`");
    assert_eq!(entlassen(mitglied).await, StatusCode::NO_CONTENT);
    assert_eq!(
        ereignisse(),
        (vec![einheit], vec![]),
        "Mitgliederliste geändert"
    );
    assert_eq!(entlassen(chef).await, StatusCode::NO_CONTENT);
    assert_eq!(ereignisse(), (vec![einheit], vec![]), "Führer gelöst");
    assert_eq!(entlassen(leiter).await, StatusCode::NO_CONTENT);
    assert_eq!(ereignisse(), (vec![], vec![abschnitt]), "Leiter gelöst");
}

#[tokio::test]
async fn snapshot_bleibt_nach_stamm_aenderung_bei_abgeschlossenem_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas Müller").await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    // Stamm umbenennen.
    anfrage(
        &app,
        "PATCH",
        &format!("/api/personal/{person}"),
        &admin,
        Some(r#"{"name":"Thomas NEU"}"#),
    )
    .await;
    // Aktiver Einsatz → Live.
    let (_, live) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert_eq!(live[0]["name"], "Thomas NEU");
    // Abschließen → Snapshot.
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    let (_, snap) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        snap[0]["name"], "Thomas Müller",
        "Snapshot bei abgeschlossenem Einsatz"
    );
}

// LFH-4 P2: XOR-Fehlermeldung differenziert both-None vs both-Some.
#[tokio::test]
async fn disponieren_leerer_body_meldet_entweder_oder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Weder personal_id noch adhoc → "angeben", NICHT "nicht beides".
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json["error"],
        "Entweder personal_id (Stamm) oder adhoc angeben"
    );
}

#[tokio::test]
async fn disponieren_beides_meldet_nicht_beides() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    // personal_id UND adhoc → "nicht beides".
    let body = format!(r#"{{"personal_id":{person},"adhoc":{{"name":"Extern"}}}}"#);
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json["error"],
        "Entweder personal_id (Stamm) oder adhoc angeben, nicht beides"
    );
}

// LFH-4 P1: staerke_position im Dispo-PATCH ist Tri-State — explizit null entfernt den
// Override, fehlendes Feld lässt ihn unverändert.
#[tokio::test]
async fn dispo_position_explizit_null_entfernt_absent_behaelt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await; // Stamm ohne Position
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(
            r#"{{"personal_id":{person},"staerke_position":"fuehrer"}}"#
        )),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();
    assert_eq!(json["staerke_position"], "fuehrer");

    // Feld absent (nur Bemerkung) → Position unverändert.
    let (_, a) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    )
    .await;
    assert_eq!(
        a["staerke_position"], "fuehrer",
        "absentes Feld lässt die Position unverändert"
    );

    // Explizit null → Override entfernt (Stamm hat keine Position → null).
    let (_, b) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"staerke_position":null}"#),
    )
    .await;
    assert!(
        b["staerke_position"].is_null(),
        "explizit null entfernt den Positions-Override"
    );
}

#[tokio::test]
async fn dispo_position_ungueltiger_wert_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();
    // Tri-State Some(Some("quatsch")) → die Inline-Validierung lehnt den Wert ab.
    let (status, body) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"staerke_position":"quatsch"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "Ungültige Stärke-Position");
}

// F12-c (LFH-266-Nachzug): `bemerkung` ist nullable und muss per PATCH löschbar sein.
// Tri-State wie in d167778: absent = unverändert, `null`/`""` = leeren, Wert = setzen.
// Der Personal-Fall prüft `staerke_position` mit — die beiden Flag/Wert-Paare liegen im
// SQL direkt nebeneinander, ein verrutschtes Bind fiele sonst nicht auf.
#[tokio::test]
async fn patch_null_leert_bemerkung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(
            r#"{{"personal_id":{person},"staerke_position":"fuehrer"}}"#
        )),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();

    let (_, gesetzt) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    )
    .await;
    assert_eq!(gesetzt["bemerkung"], "vor Ort");

    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"bemerkung":null}"#),
    )
    .await;
    assert!(
        geleert["bemerkung"].is_null(),
        "explizites null muss die Bemerkung löschen"
    );
    assert_eq!(
        geleert["staerke_position"], "fuehrer",
        "die Nachbarspalte darf dabei nicht mitgelöscht werden"
    );
}

#[tokio::test]
async fn patch_leerstring_leert_bemerkung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    )
    .await;
    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
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
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    )
    .await;
    let (_, unberuehrt) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(r#"{"staerke_position":"fuehrer"}"#),
    )
    .await;
    assert_eq!(
        unberuehrt["bemerkung"], "vor Ort",
        "absentes Feld lässt die Bemerkung unverändert"
    );
}
