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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
            &format!("/api/einsaetze/{einsatz}/personnel"),
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
            &format!("/api/einsaetze/{einsatz}/personnel"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

/// Statuscode-Konvention (`src/AGENTS.md`): außer Dienst ist ein Zustand, also 422 (LLH-1100:
/// der Einzelweg läuft über den Baustein der Sammel-Disposition). Unbekannt bleibt 404.
#[tokio::test]
async fn stamm_person_ausser_dienst_ist_422_und_unbekannte_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/personal/{person}/ausser-dienst"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"],
        "Person ist außer Dienst und kann nicht disponiert werden"
    );
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(r#"{"personal_id":424242}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 0);
}

#[tokio::test]
async fn adhoc_ohne_stamm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app, "POST", &format!("/api/einsaetze/{einsatz}/personnel"), &admin,
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
            &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
            &format!("/api/einsaetze/{einsatz}/close"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
            &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
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
            "POST",
            &format!("/api/einsaetze/{einsatz}/personnel/{ep}/release"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    // Disponieren + Status-Wechsel + Entlassen = 3 System-Einträge.
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
            &format!("/api/einsaetze/{einsatz}/units/{einheit}/personnel/{ep}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "zuordnen");
    }
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/units/{einheit}"),
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
                "POST",
                &format!("/api/einsaetze/{einsatz}/personnel/{ep}/release"),
                &admin,
                None,
            )
            .await
            .0
        }
    };

    assert_eq!(entlassen(ohne).await, StatusCode::OK);
    assert_eq!(ereignisse(), (vec![], vec![]), "ohne Rolle: nur `personal`");
    assert_eq!(entlassen(mitglied).await, StatusCode::OK);
    assert_eq!(
        ereignisse(),
        (vec![einheit], vec![]),
        "Mitgliederliste geändert"
    );
    assert_eq!(entlassen(chef).await, StatusCode::OK);
    assert_eq!(ereignisse(), (vec![einheit], vec![]), "Führer gelöst");
    assert_eq!(entlassen(leiter).await, StatusCode::OK);
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    assert_eq!(live[0]["name"], "Thomas NEU");
    // Abschließen → Snapshot.
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/close"),
        &admin,
        None,
    )
    .await;
    let (_, snap) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
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
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();
    // Tri-State Some(Some("quatsch")) → die Inline-Validierung lehnt den Wert ab.
    let (status, body) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
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
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
        &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    )
    .await;
    assert_eq!(gesetzt["bemerkung"], "vor Ort");

    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
        &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    )
    .await;
    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
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
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
        &admin,
        Some(r#"{"bemerkung":"vor Ort"}"#),
    )
    .await;
    let (_, unberuehrt) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
        &admin,
        Some(r#"{"staerke_position":"fuehrer"}"#),
    )
    .await;
    assert_eq!(
        unberuehrt["bemerkung"], "vor Ort",
        "absentes Feld lässt die Bemerkung unverändert"
    );
}

// ---------- Fremd-Ereignisse (LLH-1182) ----------

/// Ad-hoc-Kraft mit Stärke-Position; liefert die `ep_id`.
async fn kraft(app: &axum::Router, cookie: &str, einsatz: i64, name: &str, position: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        cookie,
        Some(&format!(
            r#"{{"adhoc":{{"name":"{name}","staerke_position":"{position}"}}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

/// Aktive UHS mit der Kraft `ep`; liefert die `uhs_id`.
async fn uhs_mit_kraft(app: &axum::Router, cookie: &str, einsatz: i64, ep: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(r#"{"typ":"behandlungsplatz","bezeichnung":"UHS 1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let uhs = json["id"].as_i64().unwrap();
    for (methode, pfad, body) in [
        (
            "POST",
            format!("uhs/{uhs}/status"),
            Some(r#"{"status":"aktiv"}"#),
        ),
        ("PUT", format!("uhs/{uhs}/kraefte/{ep}"), None),
    ] {
        let (s, json) = anfrage(
            app,
            methode,
            &format!("/api/einsaetze/{einsatz}/{pfad}"),
            cookie,
            body,
        )
        .await;
        assert!(s.is_success(), "{pfad}: {s} {json}");
    }
    uhs
}

async fn einheit_mit(app: &axum::Router, cookie: &str, einsatz: i64, ep: i64) -> i64 {
    let einheit = einheit_bilden(app, cookie, einsatz, "1. Zug").await;
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/units/{einheit}/personnel/{ep}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "zuordnen");
    einheit
}

const FREMD: &[(&str, &str)] = &[
    ("einheit", "einheit_id"),
    ("uhs", "uhs_id"),
    ("schaden", "schaden_id"),
];

fn ereignis(tag: &str, id: i64) -> (String, i64) {
    (tag.to_string(), id)
}

/// Das Entlassen ändert die Stärke einer UHS, an der die Kraft arbeitet (LFH-1045). `personal`
/// erreicht UHS-Leser ohne Personalrecht nicht; `uhs` trägt die Änderung, aber nur, wenn die
/// Kraft dort steht. Den Schaden lässt das Entlassen unverändert: die geschädigte Einsatzkraft
/// bleibt Historie (LLH-1079, design.md D4), also meldet es dort nichts.
#[tokio::test]
async fn entlassen_feuert_uhs_nur_bei_betroffener_kraft_und_laesst_den_schaden() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ohne = kraft(&app, &admin, einsatz, "Ohne Bezug", "mannschaft").await;
    let an_uhs = kraft(&app, &admin, einsatz, "An der UHS", "mannschaft").await;
    let geschaedigt = kraft(&app, &admin, einsatz, "Geschädigt", "mannschaft").await;
    let uhs = uhs_mit_kraft(&app, &admin, einsatz, an_uhs).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/schaeden"),
        &admin,
        Some(&format!(
            r#"{{"typ":"sachschaden","ausmass":"gering","ort":"Hauptstr. 1","geschaedigt_personal_id":{geschaedigt}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let schaden = json["id"].as_i64().unwrap();

    let mut rx = live.abonniere(einsatz);
    let entlassen = |ep: i64| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "POST",
                &format!("/api/einsaetze/{einsatz}/personnel/{ep}/release"),
                &admin,
                None,
            )
            .await
            .0
        }
    };

    assert_eq!(entlassen(ohne).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "ohne Bezug");
    assert_eq!(entlassen(an_uhs).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Stärke der UHS geändert"
    );
    assert_eq!(entlassen(geschaedigt).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![],
        "der Schaden ändert sich nicht"
    );
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/schaeden/{schaden}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        json["geschaedigt_personal_id"], geschaedigt,
        "die geschädigte Einsatzkraft bleibt im Nachweis: {json}"
    );
}

/// Die Stärke-Position zeigt die Mitgliederliste der Einheit, und die UHS zählt ihre Kräfte nach
/// ihr. Der PATCH meldet `einheit` bzw. `uhs` genau dann, wenn sich die wirksame Position ändert,
/// nicht bei Status, Bemerkung oder gleichem Wert.
#[tokio::test]
async fn staerke_position_aendern_feuert_einheit_und_uhs_nur_bei_wirksamer_aenderung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frei = kraft(&app, &admin, einsatz, "Frei", "mannschaft").await;
    let mitglied = kraft(&app, &admin, einsatz, "Mitglied", "mannschaft").await;
    let an_uhs = kraft(&app, &admin, einsatz, "An der UHS", "mannschaft").await;
    let einheit = einheit_mit(&app, &admin, einsatz, mitglied).await;
    let uhs = uhs_mit_kraft(&app, &admin, einsatz, an_uhs).await;

    let mut rx = live.abonniere(einsatz);
    let patch = |ep: i64, body: &'static str| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "PATCH",
                &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
                &admin,
                Some(body),
            )
            .await
            .0
        }
    };

    assert_eq!(
        patch(frei, r#"{"staerke_position":"fuehrer"}"#).await,
        StatusCode::OK
    );
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "freie Kraft");
    assert_eq!(
        patch(mitglied, r#"{"staerke_position":"fuehrer"}"#).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Position eines Mitglieds"
    );
    assert_eq!(
        patch(mitglied, r#"{"staerke_position":"fuehrer"}"#).await,
        StatusCode::OK
    );
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "gleicher Wert");
    assert_eq!(
        patch(mitglied, r#"{"bemerkung":"vor Ort"}"#).await,
        StatusCode::OK
    );
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "nur Bemerkung");
    assert_eq!(
        patch(an_uhs, r#"{"staerke_position":null}"#).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Position einer UHS-Kraft geleert"
    );
}

/// Die wirksame Position ist der Override vor dem Stamm-Default. Ein Override auf den Stamm-Wert
/// und ein Statuswechsel ändern die Einheit nicht; ein abweichender Override und sein Löschen
/// (zurück auf den Stamm-Wert) ändern sie.
#[tokio::test]
async fn staerke_position_mit_stamm_default_feuert_nur_bei_wirksamer_aenderung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(r#"{"name":"Stamm Mannschaft","staerke_position":"mannschaft"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let pid = json["id"].as_i64().unwrap();
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(&format!(r#"{{"personal_id":{pid}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(
        json["staerke_position"], "mannschaft",
        "Stamm-Default wirkt"
    );
    let ep = json["id"].as_i64().unwrap();
    let einheit = einheit_mit(&app, &admin, einsatz, ep).await;
    let (_, stati) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    let im_einsatz = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == "im Einsatz")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let mut rx = live.abonniere(einsatz);
    let patch = |body: String| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "PATCH",
                &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
                &admin,
                Some(&body),
            )
            .await
            .0
        }
    };

    assert_eq!(
        patch(r#"{"staerke_position":"mannschaft"}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![],
        "Override gleich Stamm-Wert"
    );
    assert_eq!(
        patch(format!(r#"{{"status_id":{im_einsatz}}}"#)).await,
        StatusCode::OK
    );
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "nur Status");
    assert_eq!(
        patch(r#"{"staerke_position":"fuehrer"}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "abweichender Override"
    );
    assert_eq!(
        patch(r#"{"staerke_position":null}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Override gelöscht, Stamm-Wert wirkt wieder"
    );
    assert_eq!(
        patch(r#"{"staerke_position":null}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "schon gelöscht");
}

// ── Entlassen, Stornieren, erneut Disponieren (LLH-1079) ──────────────────────────────────

/// `(id, name)` der Liste, aktiv oder mit `?entlassene=1`.
async fn namen(app: &axum::Router, cookie: &str, einsatz: i64, query: &str) -> Vec<String> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal{query}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    json.as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_string())
        .collect()
}

async fn aktion(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ep: i64,
    was: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}/{was}"),
        cookie,
        None,
    )
    .await
}

/// LLH-1922 (Spec `kraefte-entlassung`, „Entlassung einer Person zurücknehmen“): Nach „Entlassen“
/// und „Rückgängig“ steht die Person wie vorher da — Status, Einheit samt Führung, UHS,
/// Abschnittsleitung; ETB und Live wie beim Entlassen. Ein zweites Rücknehmen ist 409, eine zu
/// lange Liste 400.
#[tokio::test]
async fn personal_entlassen_und_zuruecknehmen_ergibt_denselben_zustand() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, einsatz, "Zug 1").await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Müller").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/units/{einheit}/personnel/{anna}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "zuordnen");
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/units/{einheit}"),
        &admin,
        Some(&format!(r#"{{"fuehrer_id":{anna}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Führer setzen");
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        Some(&format!(r#"{{"name":"Süd","leiter_id":{anna}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let abschnitt = json["id"].as_i64().unwrap();
    let uhs = uhs_mit_kraft(&app, &admin, einsatz, anna).await;
    let stand = |p: &serde_json::Value| {
        (
            p["status_id"].clone(),
            p["disponiert_at"].clone(),
            p["einheit_id"].clone(),
            p["uhs_id"].clone(),
        )
    };
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    let vorher = stand(
        liste
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == anna)
            .unwrap(),
    );

    let (s, entlassen) = aktion(&app, &admin, einsatz, anna, "entlassen").await;
    assert_eq!(s, StatusCode::OK, "{entlassen}");
    let v = &entlassen["vorzustand"];
    assert_eq!(v["einheit_id"], einheit);
    assert_eq!(v["uhs_id"], uhs);
    assert_eq!(v["gefuehrte_einheiten"], serde_json::json!([einheit]));
    assert_eq!(v["geleitete_abschnitte"], serde_json::json!([abschnitt]));
    let vorzustand = v.to_string();

    let zuruecknehmen = |body: String| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            anfrage(
                &app,
                "POST",
                &format!("/api/einsaetze/{einsatz}/personnel/{anna}/release/undo"),
                &admin,
                Some(&body),
            )
            .await
        }
    };
    let mut rx = live.abonniere(einsatz);
    let (s, json) = zuruecknehmen(vorzustand.clone()).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["ausgelassen"], serde_json::json!([]));
    assert_eq!(stand(&json["personal"]), vorher);
    let (mut einheiten, mut abschnitte, mut uhs_ereignisse) = (Vec::new(), Vec::new(), Vec::new());
    let mut etb = 0;
    while let Ok(n) = rx.try_recv() {
        let data: serde_json::Value = serde_json::from_str(&n.data).unwrap();
        match n.event {
            lifeline_hub::live::LiveEvent::Etb => etb += 1,
            lifeline_hub::live::LiveEvent::Einheit => einheiten.push(data["einheit_id"].clone()),
            lifeline_hub::live::LiveEvent::Abschnitt => {
                abschnitte.push(data["abschnitt_id"].clone())
            }
            lifeline_hub::live::LiveEvent::Uhs => uhs_ereignisse.push(data["uhs_id"].clone()),
            _ => {}
        }
    }
    assert_eq!(einheiten, [einheit], "Live an die Einheit");
    assert_eq!(abschnitte, [abschnitt], "Live an den Abschnitt");
    assert_eq!(uhs_ereignisse, [uhs], "Live an die UHS");
    assert_eq!(etb, 1, "der ETB-Eintrag geht live hinaus");
    let (_, einheiten_json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/units"),
        &admin,
        None,
    )
    .await;
    let zug = einheiten_json
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == einheit)
        .unwrap();
    assert_eq!(zug["fuehrer_id"], anna, "{zug}");
    assert!(
        system_etb_inhalte(&app, &admin, einsatz)
            .await
            .iter()
            .any(|t| t.starts_with("Person «Anna Müller")
                && t.ends_with(": Entlassung zurückgenommen")),
        "ETB"
    );

    let (s, _) = zuruecknehmen(vorzustand.clone()).await;
    assert_eq!(s, StatusCode::CONFLICT, "schon zurückgenommen");

    let zu_viele: Vec<i64> = (1..=201).collect();
    let (s, json) = zuruecknehmen(
        serde_json::json!({
            "entlassen_at": "2026-11-17 10:00:00",
            "gefuehrte_einheiten": zu_viele,
        })
        .to_string(),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");

    let (s, json) = zuruecknehmen(
        serde_json::json!({
            "entlassen_at": "2026-11-17 10:00:00",
            "einsatzleiter_name": "x".repeat(2_001),
        })
        .to_string(),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
}

/// Spec `kraefte-entlassung`: die entlassene Person bleibt mit Zeitpunkt und entlassender Person,
/// fehlt in der Liste und steht unter `?entlassene=1`; jeder Schreibweg an ihr ist 409, das
/// erneute Disponieren holt sie zurück.
#[tokio::test]
async fn entlassen_und_erneut_disponieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    kraft(&app, &admin, einsatz, "Bert", "mannschaft").await;

    let (s, json) = aktion(&app, &admin, einsatz, anna, "entlassen").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let person = &json["personal"];
    assert_eq!(person["beendet_als"], "entlassen");
    assert!(
        person["beendet_at"].is_string() && person["beendet_von"].is_i64(),
        "{json}"
    );
    assert_eq!(json["vorzustand"]["entlassen_at"], person["beendet_at"]);
    assert_eq!(namen(&app, &admin, einsatz, "").await, ["Bert"]);
    assert_eq!(
        namen(&app, &admin, einsatz, "?entlassene=1").await,
        ["Anna"]
    );
    assert_eq!(
        namen(&app, &admin, einsatz, "?entlassene=0").await,
        ["Bert"]
    );
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personnel?entlassene=ja"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Schreibwege an der Entlassenen: Lebenszyklus.
    assert_eq!(
        aktion(&app, &admin, einsatz, anna, "entlassen").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        aktion(&app, &admin, einsatz, anna, "stornieren").await.0,
        StatusCode::CONFLICT
    );
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{anna}"),
        &admin,
        Some(r#"{"bemerkung":"x"}"#),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "Status oder Bemerkung an einer Entlassenen"
    );
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{anna}/position"),
        &admin,
        Some(r#"{"lat":52.0,"lon":10.0}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    // Rückgängig bzw. „Erneut disponieren“.
    let (s, json) = aktion(&app, &admin, einsatz, anna, "reaktivieren").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(
        json.get("beendet_als").is_none_or(|v| v.is_null()),
        "{json}"
    );
    // Die Liste ordnet nach Disposition; die Reaktivierung disponiert neu.
    let mut aktiv = namen(&app, &admin, einsatz, "").await;
    aktiv.sort();
    assert_eq!(aktiv, ["Anna", "Bert"]);
    assert!(namen(&app, &admin, einsatz, "?entlassene=1")
        .await
        .is_empty());
    assert_eq!(
        aktion(&app, &admin, einsatz, anna, "reaktivieren").await.0,
        StatusCode::CONFLICT,
        "eine aktive Kraft wird nicht reaktiviert"
    );
}

/// Spec „Stamm-Person kommt zurück“: das Disponieren einer entlassenen Stamm-Person gelingt statt
/// 409 und trifft dieselbe Zeile.
#[tokio::test]
async fn entlassene_stamm_person_erneut_disponieren_ist_201() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = stammpersonal_anlegen(&app, &admin, "Thomas Müller").await;
    let dispo = || {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "POST",
                &format!("/api/einsaetze/{einsatz}/personnel"),
                &admin,
                Some(&format!(r#"{{"personal_id":{person}}}"#)),
            )
            .await
        }
    };
    let (s, json) = dispo().await;
    assert_eq!(s, StatusCode::CREATED);
    let ep = json["id"].as_i64().unwrap();
    assert_eq!(dispo().await.0, StatusCode::CONFLICT, "aktiv: weiter 409");
    assert_eq!(
        aktion(&app, &admin, einsatz, ep, "entlassen").await.0,
        StatusCode::OK
    );
    let (s, json) = dispo().await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json["id"].as_i64().unwrap(), ep, "dieselbe Zeile");
    assert_eq!(namen(&app, &admin, einsatz, "").await, ["Thomas Müller"]);
}

/// Spec „Fehldisposition stornieren“: direkt nach dem Disponieren gelingt der Storno (204), die
/// Kraft steht in keiner Liste; mit Bindung ist es ein Zustand (422 mit Satz).
#[tokio::test]
async fn stornieren_nur_ohne_spur() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fehl = kraft(&app, &admin, einsatz, "Fehl", "mannschaft").await;
    let gebunden = kraft(&app, &admin, einsatz, "Gebunden", "mannschaft").await;
    einheit_mit(&app, &admin, einsatz, gebunden).await;

    assert_eq!(
        aktion(&app, &admin, einsatz, fehl, "stornieren").await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(namen(&app, &admin, einsatz, "").await, ["Gebunden"]);
    assert!(namen(&app, &admin, einsatz, "?entlassene=1")
        .await
        .is_empty());

    let (s, json) = aktion(&app, &admin, einsatz, gebunden, "stornieren").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"], "Die Person gehört einer Einheit an; erst lösen oder die Person entlassen",
        "{json}"
    );
    // Eine stornierte Kraft kommt über „Erneut disponieren“ zurück.
    assert_eq!(
        aktion(&app, &admin, einsatz, fehl, "reaktivieren").await.0,
        StatusCode::OK
    );
}

/// Storno nach erneutem Disponieren (Review LLH-1079, S3): wer einmal entlassen war, war im
/// Einsatz. Auch wenn die Zeitachse leer blieb (Status ohne Marke) und das erneute Disponieren
/// die Frist neu beginnen ließe, ist ein Storno 422; die Person lässt sich nur entlassen.
#[tokio::test]
async fn einmal_entlassene_kraft_laesst_sich_nicht_stornieren() {
    let (app, pool) = setup_mit_pool().await;
    // Ohne Marke am Status bleibt die Zeitachse leer; nur dann fiele der Storno durch.
    sqlx::query("UPDATE personal_status SET zeitachse_marke = NULL")
        .execute(&pool)
        .await
        .unwrap();
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    assert_eq!(
        aktion(&app, &admin, einsatz, anna, "entlassen").await.0,
        StatusCode::OK
    );
    assert_eq!(
        aktion(&app, &admin, einsatz, anna, "reaktivieren").await.0,
        StatusCode::OK
    );

    let (s, json) = aktion(&app, &admin, einsatz, anna, "stornieren").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"],
        "Die Person war schon einmal aus dem Einsatz entlassen; die Person lässt sich entlassen",
        "{json}"
    );
    // Ein Storno ist dagegen keine Entlassung: danach bleibt ein neuer Storno möglich.
    let bert = kraft(&app, &admin, einsatz, "Bert", "mannschaft").await;
    assert_eq!(
        aktion(&app, &admin, einsatz, bert, "stornieren").await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        aktion(&app, &admin, einsatz, bert, "reaktivieren").await.0,
        StatusCode::OK
    );
    assert_eq!(
        aktion(&app, &admin, einsatz, bert, "stornieren").await.0,
        StatusCode::NO_CONTENT
    );
}

/// Spec „Status an Entlassener“ und design.md D6: jeder Schreibweg an einer entlassenen Kraft
/// außer dem erneuten Disponieren antwortet 409 — auch die Wege anderer Module, die eine Person
/// binden (Einheit, Besatzung, UHS, Einsatzleitung, Abschnittsleitung, Schaden). Ihre
/// Zeitachse lässt sich berichtigen (LLH-1263, `tests/kraefte_zeitachse.rs`).
#[tokio::test]
async fn schreibwege_an_einer_entlassenen_kraft_sind_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    let bert = kraft(&app, &admin, einsatz, "Bert", "mannschaft").await;
    let uhs = uhs_mit_kraft(&app, &admin, einsatz, bert).await;
    let einheit = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/vehicles"),
        &admin,
        Some(r#"{"adhoc":{"funkrufname":"Florian 1","fahrzeugtyp":"ELW 2"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let fahrzeug = json["id"].as_i64().unwrap();
    assert_eq!(
        aktion(&app, &admin, einsatz, anna, "entlassen").await.0,
        StatusCode::OK
    );

    let leiter = format!(r#"{{"name":"Nord","leiter_id":{anna}}}"#);
    let einsatzleiter = format!(r#"{{"einsatzleiter":{{"art":"personal","personal_id":{anna}}}}}"#);
    let schaden = format!(
        r#"{{"typ":"sachschaden","ausmass":"gering","ort":"Hauptstr. 1","geschaedigt_personal_id":{anna}}}"#
    );
    for (methode, pfad, body) in [
        ("PUT", format!("units/{einheit}/personnel/{anna}"), None),
        ("PUT", format!("vehicles/{fahrzeug}/crew/{anna}"), None),
        ("PUT", format!("uhs/{uhs}/kraefte/{anna}"), None),
        ("PATCH", "fuehrungsstelle".to_string(), Some(einsatzleiter)),
        ("POST", "abschnitte".to_string(), Some(leiter)),
        ("POST", "schaeden".to_string(), Some(schaden)),
    ] {
        let (s, json) = anfrage(
            &app,
            methode,
            &format!("/api/einsaetze/{einsatz}/{pfad}"),
            &admin,
            body.as_deref(),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}: {json}");
    }
}

// ---------- Einsatzfunktion und Ad-hoc-Angaben (LLH-1067, Spec `personal-einsatzangaben`) ----------

async fn patch_kraft(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ep: i64,
    body: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
        cookie,
        Some(body),
    )
    .await
}

/// Ad-hoc-Kraft mit Qualifikation und Träger; liefert die `ep_id`.
async fn adhoc_kraft(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        cookie,
        Some(&format!(
            r#"{{"adhoc":{{"name":"{name}","funktion":"Sanitäter","traegerorganisation":"ASB"}}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn einsatzfunktion_setzen_und_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Max Mustermann").await;

    let (s, json) = patch_kraft(
        &app,
        &admin,
        einsatz,
        ep,
        r#"{"einsatzfunktion":"  Sprechfunker "}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["einsatzfunktion"], "Sprechfunker");
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["einsatzfunktion"], "Sprechfunker");

    for leer in [r#"{"einsatzfunktion":""}"#, r#"{"einsatzfunktion":null}"#] {
        let (s, _) =
            patch_kraft(&app, &admin, einsatz, ep, r#"{"einsatzfunktion":"Melder"}"#).await;
        assert_eq!(s, StatusCode::OK);
        let (s, json) = patch_kraft(&app, &admin, einsatz, ep, leer).await;
        assert_eq!(s, StatusCode::OK, "{json}");
        assert!(
            !json.as_object().unwrap().contains_key("einsatzfunktion"),
            "{leer} leert: {json}"
        );
    }
}

/// LLH-1239: Die Kartensicht trägt die Einsatzfunktion neben der Qualifikation; `funktion` bleibt
/// die Quelle des taktischen Zeichens.
#[tokio::test]
async fn kartensicht_traegt_einsatzfunktion_neben_der_qualifikation() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = adhoc_kraft(&app, &admin, einsatz, "Erika Funk").await;
    let pfad = format!("/api/einsaetze/{einsatz}/karte/fuehrungskraefte");

    let (s, karte) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{karte}");
    assert!(karte[0].get("einsatzfunktion").is_none(), "{karte}");

    let (s, json) = patch_kraft(
        &app,
        &admin,
        einsatz,
        ep,
        r#"{"einsatzfunktion":"Sprechfunker"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let (s, karte) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{karte}");
    assert_eq!(karte[0]["einsatzfunktion"], "Sprechfunker");
    assert_eq!(karte[0]["funktion"], "Sanitäter");
}

#[tokio::test]
async fn einsatzfunktion_ueber_200_zeichen_ist_400_und_aendert_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Max Mustermann").await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let zu_lang = format!(r#"{{"einsatzfunktion":"{}"}}"#, "x".repeat(201));
    let (s, json) = patch_kraft(&app, &admin, einsatz, ep, &zu_lang).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    assert_eq!(
        json["error"],
        "Einsatzfunktion darf höchstens 200 Zeichen lang sein"
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    assert!(!liste[0]
        .as_object()
        .unwrap()
        .contains_key("einsatzfunktion"));
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);

    let genau = format!(r#"{{"einsatzfunktion":"{}"}}"#, "ä".repeat(200));
    assert_eq!(
        patch_kraft(&app, &admin, einsatz, ep, &genau).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn bemerkung_ueber_2000_zeichen_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Max Mustermann").await;
    let zu_lang = format!(r#"{{"bemerkung":"{}"}}"#, "x".repeat(2_001));
    let (s, json) = patch_kraft(&app, &admin, einsatz, ep, &zu_lang).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    assert_eq!(
        json["error"],
        "Bemerkung darf höchstens 2000 Zeichen lang sein"
    );
    let genau = format!(r#"{{"bemerkung":"{}"}}"#, "x".repeat(2_000));
    assert_eq!(
        patch_kraft(&app, &admin, einsatz, ep, &genau).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn adhoc_disponieren_prueft_die_grenzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let lang = "x".repeat(201);
    for (body, meldung) in [
        (
            format!(r#"{{"adhoc":{{"name":"{lang}"}}}}"#),
            "Name darf höchstens 200 Zeichen lang sein",
        ),
        (
            format!(r#"{{"adhoc":{{"name":"A","funktion":"{lang}"}}}}"#),
            "Qualifikation darf höchstens 200 Zeichen lang sein",
        ),
        (
            format!(r#"{{"adhoc":{{"name":"A","traegerorganisation":"{lang}"}}}}"#),
            "Trägerorganisation darf höchstens 200 Zeichen lang sein",
        ),
    ] {
        let (s, json) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/personnel"),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
        assert_eq!(json["error"], meldung);
    }
    let genau = "x".repeat(200);
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(&format!(
            r#"{{"adhoc":{{"name":"{genau}","funktion":"{genau}","traegerorganisation":"{genau}"}}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);
}

#[tokio::test]
async fn adhoc_angaben_im_patch_aenderbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = adhoc_kraft(&app, &admin, einsatz, "Maier").await;
    let einheit = einheit_mit(&app, &admin, einsatz, ep).await;

    let (s, json) = patch_kraft(
        &app,
        &admin,
        einsatz,
        ep,
        r#"{"name":" Meier ","funktion":"Rettungssanitäter","traegerorganisation":""}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["name"], "Meier");
    assert_eq!(json["funktion"], "Rettungssanitäter");
    assert!(json["traegerorganisation"].is_null(), "{json}");

    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/units"),
        &admin,
        None,
    )
    .await;
    let e = json
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == einheit)
        .unwrap();
    assert_eq!(e["personal_mitglieder"][0]["name"], "Meier", "{e}");
}

#[tokio::test]
async fn adhoc_name_leer_oder_null_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = adhoc_kraft(&app, &admin, einsatz, "Maier").await;
    for body in [r#"{"name":"  "}"#, r#"{"name":null}"#] {
        let (s, json) = patch_kraft(&app, &admin, einsatz, ep, body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {json}");
        assert_eq!(json["error"], "Name darf nicht leer sein");
    }
    let lang = format!(r#"{{"funktion":"{}"}}"#, "x".repeat(201));
    let (s, json) = patch_kraft(&app, &admin, einsatz, ep, &lang).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    assert_eq!(
        json["error"],
        "Qualifikation darf höchstens 200 Zeichen lang sein"
    );
}

#[tokio::test]
async fn stamm_person_umbenennen_ist_422_im_stamm_pflegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Max Mustermann").await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    for body in [
        r#"{"name":"Moritz","einsatzfunktion":"Melder"}"#,
        r#"{"funktion":null}"#,
        r#"{"traegerorganisation":"THW"}"#,
    ] {
        let (s, json) = patch_kraft(&app, &admin, einsatz, ep, body).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {json}");
        assert!(
            json["error"].as_str().unwrap().contains("im Stamm pflegen"),
            "{json}"
        );
    }
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["name"], "Max Mustermann");
    assert!(
        !liste[0]
            .as_object()
            .unwrap()
            .contains_key("einsatzfunktion"),
        "nichts geschrieben"
    );
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);

    // Grenze vor Zusammenhang: ein zu langer Name an einer Stamm-Person ist 400, nicht 422.
    let lang = format!(r#"{{"name":"{}"}}"#, "x".repeat(201));
    assert_eq!(
        patch_kraft(&app, &admin, einsatz, ep, &lang).await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn aenderungen_stehen_in_genau_einem_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Max Mustermann").await;
    let n = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, _) = patch_kraft(
        &app,
        &admin,
        einsatz,
        ep,
        r#"{"einsatzfunktion":"Sprechfunker"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(inhalte.len(), n + 1);
    assert!(
        inhalte.contains(&"Person «Max Mustermann»: Funktion «—» → «Sprechfunker»".to_string()),
        "{inhalte:?}"
    );

    // Gleicher Wert und reine Bemerkung schreiben nichts.
    for body in [
        r#"{"einsatzfunktion":"Sprechfunker"}"#,
        r#"{"bemerkung":"vor Ort"}"#,
    ] {
        assert_eq!(
            patch_kraft(&app, &admin, einsatz, ep, body).await.0,
            StatusCode::OK
        );
    }
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, n + 1);

    // Ad-hoc: mehrere Angaben in einem Eintrag, jede mit altem und neuem Wert.
    let adhoc = adhoc_kraft(&app, &admin, einsatz, "Maier").await;
    let n = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, _) = patch_kraft(
        &app,
        &admin,
        einsatz,
        adhoc,
        r#"{"einsatzfunktion":"Melder","name":"Meier","funktion":"Rettungssanitäter","traegerorganisation":null}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(inhalte.len(), n + 1);
    assert!(
        inhalte.contains(
            &"Person «Meier»: Funktion «—» → «Melder»; Name «Maier» → «Meier»; \
              Qualifikation «Sanitäter» → «Rettungssanitäter»; Träger «ASB» → «—»"
                .to_string()
        ),
        "{inhalte:?}"
    );

    // Die Bezeichnung in späteren Einträgen nennt die Einsatzfunktion vor der Qualifikation.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel/{adhoc}/release"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte.contains(&"Person «Meier (Melder)» aus dem Einsatz entlassen".to_string()),
        "{inhalte:?}"
    );
}

/// Name und Funktionstext lesen Einheit, Abschnitt, UHS und Schaden live (design.md D5): eine
/// Änderung meldet genau die Ansichten, die die Kraft tragen; der Schaden zeigt nur den Namen.
/// Träger, Bemerkung und gleiche Werte melden nichts außerhalb von `personal`.
#[tokio::test]
async fn angaben_aendern_meldet_nur_betroffene_ansichten() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frei = adhoc_kraft(&app, &admin, einsatz, "Frei").await;
    let mitglied = adhoc_kraft(&app, &admin, einsatz, "Mitglied").await;
    let an_uhs = adhoc_kraft(&app, &admin, einsatz, "An der UHS").await;
    let geschaedigt = adhoc_kraft(&app, &admin, einsatz, "Geschädigt").await;
    let einheit = einheit_mit(&app, &admin, einsatz, mitglied).await;
    let uhs = uhs_mit_kraft(&app, &admin, einsatz, an_uhs).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/schaeden"),
        &admin,
        Some(&format!(
            r#"{{"typ":"sachschaden","ausmass":"gering","ort":"Hauptstr. 1","geschaedigt_personal_id":{geschaedigt}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let schaden = json["id"].as_i64().unwrap();

    let mut rx = live.abonniere(einsatz);
    let patch = |ep: i64, body: &'static str| {
        let (app, admin) = (app.clone(), admin.clone());
        async move { patch_kraft(&app, &admin, einsatz, ep, body).await.0 }
    };

    assert_eq!(patch(frei, r#"{"name":"Frei 2"}"#).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "ohne Bezug");
    assert_eq!(
        patch(mitglied, r#"{"einsatzfunktion":"Melder"}"#).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Einsatzfunktion eines Mitglieds"
    );
    assert_eq!(
        patch(
            mitglied,
            r#"{"einsatzfunktion":"Melder","traegerorganisation":"DRK"}"#
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![],
        "gleicher Wert, Träger"
    );
    assert_eq!(
        patch(an_uhs, r#"{"funktion":"Notfallsanitäter"}"#).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("uhs", uhs)],
        "Qualifikation einer UHS-Kraft"
    );
    assert_eq!(
        patch(geschaedigt, r#"{"einsatzfunktion":"Fahrer"}"#).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![],
        "der Schaden zeigt keine Funktion"
    );
    assert_eq!(
        patch(geschaedigt, r#"{"name":"Geschädigt 2"}"#).await,
        StatusCode::OK
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("schaden", schaden)],
        "Name einer geschädigten Kraft"
    );
}

/// Einheit-Mitglieder und UHS-Kräfte tragen die Einsatzfunktion mit (design.md D6).
#[tokio::test]
async fn einheit_und_uhs_tragen_die_einsatzfunktion() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mitglied = adhoc_kraft(&app, &admin, einsatz, "Mitglied").await;
    let an_uhs = adhoc_kraft(&app, &admin, einsatz, "An der UHS").await;
    let einheit = einheit_mit(&app, &admin, einsatz, mitglied).await;
    let uhs = uhs_mit_kraft(&app, &admin, einsatz, an_uhs).await;
    for ep in [mitglied, an_uhs] {
        let (s, _) =
            patch_kraft(&app, &admin, einsatz, ep, r#"{"einsatzfunktion":"Melder"}"#).await;
        assert_eq!(s, StatusCode::OK);
    }

    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/units"),
        &admin,
        None,
    )
    .await;
    let e = json
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == einheit)
        .unwrap();
    assert_eq!(
        e["personal_mitglieder"][0]["einsatzfunktion"], "Melder",
        "{e}"
    );
    assert_eq!(e["personal_mitglieder"][0]["funktion"], "Sanitäter", "{e}");

    let (s, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["kraefte"][0]["einsatzfunktion"], "Melder", "{json}");
    assert_eq!(json["kraefte"][0]["funktion"], "Sanitäter", "{json}");
}

// ---------- Feld-CAS an der Disposition (LLH-1945) ----------

async fn personal_patch(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ep: i64,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage_json(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}"),
        cookie,
        Some(&body),
    )
    .await
}

#[tokio::test]
async fn bemerkung_mit_ueberholtem_altwert_ist_409_und_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"bemerkung": "Tor 3"}),
    )
    .await;
    personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"bemerkung": "Tor 5"}),
    )
    .await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, j) = personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({
            "bemerkung": "Halle 2",
            "einsatzfunktion": "Melder",
            "erwartet": {"bemerkung": "Tor 3"}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert_eq!(j["grund"], "veraltet", "{j:?}");
    // Nichts geschrieben, auch nicht die zweite Angabe derselben Anfrage, kein ETB.
    let (_, a) = personal_patch(&app, &admin, einsatz, ep, serde_json::json!({})).await;
    assert_eq!(a["bemerkung"], "Tor 5");
    assert!(a["einsatzfunktion"].is_null(), "{a:?}");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);

    // Mit dem aktuellen Altwert geht es.
    let (s, j) = personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"bemerkung": "Halle 2", "erwartet": {"bemerkung": " Tor 5 "}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["bemerkung"], "Halle 2");
}

#[tokio::test]
async fn andere_angabe_der_kraft_dazwischen_speichert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    // Die Liste öffnet die Einsatzfunktion leer, ein anderer Arbeitsplatz setzt die Bemerkung.
    personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"bemerkung": "Tor 3"}),
    )
    .await;
    let (s, j) = personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"einsatzfunktion": "Melder", "erwartet": {"einsatzfunktion": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["einsatzfunktion"], "Melder");
    assert_eq!(j["bemerkung"], "Tor 3");
}

#[tokio::test]
async fn altwert_ohne_aenderung_der_angabe_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    let (s, j) = personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"bemerkung": "Tor 3", "erwartet": {"einsatzfunktion": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    // Eine unbekannte Kraft bleibt 404, auch mit Altwert.
    let (s, _) = personal_patch(
        &app,
        &admin,
        einsatz,
        424242,
        serde_json::json!({"bemerkung": "x", "erwartet": {"bemerkung": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn position_vergleicht_den_wirksamen_wert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, p) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(r#"{"name":"Thomas","staerke_position":"mannschaft"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p:?}");
    let person = p["id"].as_i64().unwrap();
    let (_, d) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel"),
        &admin,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    let ep = d["id"].as_i64().unwrap();
    // Ohne Override zeigt die Liste die Position des Stamms: das ist der Wert beim Öffnen.
    let (s, j) = personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"staerke_position": "fuehrer", "erwartet": {"staerke_position": "mannschaft"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["staerke_position"], "fuehrer");
    // Ein anderer hat inzwischen auf Unterführer gestellt: der Altwert „Führer“ ist überholt.
    personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"staerke_position": "unterfuehrer"}),
    )
    .await;
    let (s, j) = personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"staerke_position": null, "erwartet": {"staerke_position": "fuehrer"}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
}

#[tokio::test]
async fn adhoc_angaben_pruefen_ihren_altwert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({"name": "Anna B."}),
    )
    .await;
    for (feld, wert, alt) in [
        ("name", "Anna C.", "Anna"),
        ("funktion", "Notarzt", "Sanitäter"),
        ("traegerorganisation", "THW", "DRK"),
    ] {
        let (s, j) = personal_patch(
            &app,
            &admin,
            einsatz,
            ep,
            serde_json::json!({feld: wert, "erwartet": {feld: alt}}),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT, "{feld}: {j:?}");
    }
    let (s, j) = personal_patch(
        &app,
        &admin,
        einsatz,
        ep,
        serde_json::json!({
            "name": "Anna C.",
            "funktion": "Notarzt",
            "traegerorganisation": "THW",
            "erwartet": {"name": "Anna B.", "funktion": null, "traegerorganisation": null}
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["name"], "Anna C.");
}

/// LLH-1952: Jeder ETB-Eintrag des Personalmoduls geht als Ereignis `etb` hinaus. `personal`
/// frischt das Einsatztagebuch nicht auf; ohne das eigene Ereignis sähe ein zweiter Schirm den
/// Eintrag erst nach dem Neuladen.
#[tokio::test]
async fn etb_eintraege_des_personals_gehen_live_hinaus() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = adhoc_kraft(&app, &admin, einsatz, "Anna").await;
    let fehl = adhoc_kraft(&app, &admin, einsatz, "Fehl").await;
    let (_, stati) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    let im_einsatz = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == "im Einsatz")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let mut etb = EtbLive::neu(&app, &admin, einsatz, &live).await;

    let body = format!(r#"{{"status_id":{im_einsatz},"name":"Anna B."}}"#);
    let (s, json) = patch_kraft(&app, &admin, einsatz, ep, &body).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    etb.pruefe(&app, &admin, einsatz, "Status und Angaben ändern")
        .await;

    for (kraft, was, erwartet) in [
        (ep, "entlassen", StatusCode::OK),
        (ep, "reaktivieren", StatusCode::OK),
        (fehl, "stornieren", StatusCode::NO_CONTENT),
    ] {
        let (s, json) = aktion(&app, &admin, einsatz, kraft, was).await;
        assert_eq!(s, erwartet, "{was}: {json}");
        etb.pruefe(&app, &admin, einsatz, was).await;
    }
}

// ── Statuswechsel zurücknehmen (LLH-1986) ────────────────────────────────────────────────────

/// Id eines Personalstatus nach Label.
fn personalstatus(stati: &serde_json::Value, label: &str) -> i64 {
    stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == label)
        .unwrap()["id"]
        .as_i64()
        .unwrap()
}

/// Eine Ad-hoc-Kraft (Startstatus „alarmiert“), „im Einsatz“ trägt die Marke `eintreffen`.
/// Liefert (app, pool, admin, einsatz, ep, alarmiert, im Einsatz, Pause).
async fn personalstatus_welt() -> (
    axum::Router,
    sqlx::SqlitePool,
    String,
    i64,
    i64,
    i64,
    i64,
    i64,
) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = adhoc_kraft(&app, &admin, einsatz, "Anna Muster").await;
    let (_, stati) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
    let (alarmiert, im_einsatz, pause) = (
        personalstatus(&stati, "alarmiert"),
        personalstatus(&stati, "im Einsatz"),
        personalstatus(&stati, "Pause"),
    );
    sqlx::query("UPDATE personal_status SET zeitachse_marke = 'eintreffen' WHERE id = ?")
        .bind(im_einsatz)
        .execute(&pool)
        .await
        .unwrap();
    (app, pool, admin, einsatz, ep, alarmiert, im_einsatz, pause)
}

async fn personalstatus_zuruecknehmen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ep: i64,
    beleg: &serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}/status/undo"),
        cookie,
        Some(&beleg.to_string()),
    )
    .await
}

async fn status_wechseln(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ep: i64,
    status: i64,
) -> serde_json::Value {
    let (s, json) = patch_kraft(
        app,
        cookie,
        einsatz,
        ep,
        &format!(r#"{{"status_id":{status}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    json
}

/// Ereignisse der Person: (Art, gestrichen?).
async fn person_ereignisse(pool: &sqlx::SqlitePool, ep: i64) -> Vec<(String, bool)> {
    sqlx::query_as::<_, (String, bool)>(
        "SELECT art, gestrichen_at IS NOT NULL FROM einsatz_kraft_zeitachse \
         WHERE personal_id = ? ORDER BY id",
    )
    .bind(ep)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn personalstatus_zuruecknehmen_stellt_status_her_und_streicht_das_ereignis() {
    let (app, pool, admin, einsatz, ep, alarmiert, im_einsatz, _) = personalstatus_welt().await;
    let vorher_ereignisse = person_ereignisse(&pool, ep).await;
    let wechsel = status_wechseln(&app, &admin, einsatz, ep, im_einsatz).await;
    let beleg = wechsel["status_ruecknahme"].clone();
    assert_eq!(beleg["vorher_status_id"], alarmiert, "{wechsel}");
    assert_eq!(beleg["status_id"], im_einsatz);
    assert!(beleg["gesetzt_at"].is_string(), "{beleg}");
    assert!(beleg.get("ereignis_id").is_none(), "{beleg}");
    assert_eq!(
        wechsel["name"], "Anna Muster",
        "die Anzeige steht flach in der Antwort"
    );
    let mut erwartet = vorher_ereignisse.clone();
    erwartet.push(("eintreffen".into(), false));
    assert_eq!(person_ereignisse(&pool, ep).await, erwartet);

    let (s, json) = personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &beleg).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status_id"], alarmiert);
    let mut erwartet = vorher_ereignisse.clone();
    erwartet.push(("eintreffen".into(), true));
    assert_eq!(person_ereignisse(&pool, ep).await, erwartet);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(|t| t
            == "Person «Anna Muster»: Statuswechsel «alarmiert» → «im Einsatz» zurückgenommen"),
        "{etb:?}"
    );

    // Ein zweites Mal: der Status steht nicht mehr → 409 veraltet.
    let (s, json) = personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &beleg).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(json["grund"], "veraltet", "{json}");
}

#[tokio::test]
async fn personalstatus_ohne_marke_ist_zuruecknehmbar() {
    let (app, pool, admin, einsatz, ep, alarmiert, _, pause) = personalstatus_welt().await;
    let vorher_ereignisse = person_ereignisse(&pool, ep).await;
    let wechsel = status_wechseln(&app, &admin, einsatz, ep, pause).await;
    let (s, json) =
        personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &wechsel["status_ruecknahme"])
            .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status_id"], alarmiert);
    assert_eq!(person_ereignisse(&pool, ep).await, vorher_ereignisse);
}

/// Zwei Wechsel hintereinander: nur der letzte lässt sich zurücknehmen, und er führt auf den
/// mittleren Status, nicht auf den ersten.
#[tokio::test]
async fn zwei_wechsel_erster_beleg_veraltet_zweiter_stellt_den_mittleren_her() {
    let (app, _pool, admin, einsatz, ep, _, im_einsatz, pause) = personalstatus_welt().await;
    let erster = status_wechseln(&app, &admin, einsatz, ep, im_einsatz).await;
    let zweiter = status_wechseln(&app, &admin, einsatz, ep, pause).await;
    let (s, json) =
        personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &erster["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(json["grund"], "veraltet", "{json}");
    let (s, json) =
        personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &zweiter["status_ruecknahme"])
            .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status_id"], im_einsatz);
}

#[tokio::test]
async fn personalstatus_andere_person_409() {
    let (app, _pool, admin, einsatz, ep, _, im_einsatz, _) = personalstatus_welt().await;
    let wechsel = status_wechseln(&app, &admin, einsatz, ep, im_einsatz).await;
    let id = benutzer_anlegen(&app, &admin, "fritz", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
    let fritz = login_cookie(&app, "fritz", "fritzpw1").await;
    let (s, json) =
        personalstatus_zuruecknehmen(&app, &fritz, einsatz, ep, &wechsel["status_ruecknahme"])
            .await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_ne!(json["grund"], "veraltet", "{json}");
}

#[tokio::test]
async fn personalstatus_nach_elf_minuten_409() {
    let (app, pool, admin, einsatz, ep, _, im_einsatz, _) = personalstatus_welt().await;
    let wechsel = status_wechseln(&app, &admin, einsatz, ep, im_einsatz).await;
    sqlx::query(
        "UPDATE einsatz_personal SET status_gesetzt_at = datetime('now', '-11 minutes') \
         WHERE id = ?",
    )
    .bind(ep)
    .execute(&pool)
    .await
    .unwrap();
    let mut beleg = wechsel["status_ruecknahme"].clone();
    beleg["gesetzt_at"] = sqlx::query_scalar::<_, String>(
        "SELECT status_gesetzt_at FROM einsatz_personal WHERE id = ?",
    )
    .bind(ep)
    .fetch_one(&pool)
    .await
    .unwrap()
    .into();
    let (s, json) = personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &beleg).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_ne!(json["grund"], "veraltet", "{json}");
}

#[tokio::test]
async fn personalstatus_gleicher_status_ohne_beleg() {
    let (app, _pool, admin, einsatz, ep, alarmiert, _, _) = personalstatus_welt().await;
    let json = status_wechseln(&app, &admin, einsatz, ep, alarmiert).await;
    assert!(json.get("status_ruecknahme").is_none(), "{json}");
}

/// Ein Wechsel ohne Person (Schichtplan-Vollzug, `update_tx` ohne `gesetzt_von`) überholt den
/// gemerkten: er ist nicht zurückzunehmen, und der Beleg davor ist veraltet.
#[tokio::test]
async fn schichtplan_wechsel_ist_nicht_zuruecknehmbar() {
    let (app, pool, admin, einsatz, ep, _, im_einsatz, pause) = personalstatus_welt().await;
    let wechsel = status_wechseln(&app, &admin, einsatz, ep, im_einsatz).await;
    let mut conn = pool.acquire().await.unwrap();
    lifeline_hub::personal::disposition_repo::update_tx(
        &mut conn,
        einsatz,
        ep,
        lifeline_hub::personal::disposition_repo::DispositionPatch {
            status_id: Some(pause),
            ..Default::default()
        },
        &lifeline_hub::feld_cas::ExpectedValues::new(),
    )
    .await
    .unwrap();
    drop(conn);
    let von: Option<i64> =
        sqlx::query_scalar("SELECT status_gesetzt_von FROM einsatz_personal WHERE id = ?")
            .bind(ep)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(von, None);
    let (s, _) =
        personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &wechsel["status_ruecknahme"])
            .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn entlassene_person_rueckname_409() {
    let (app, _pool, admin, einsatz, ep, _, im_einsatz, _) = personalstatus_welt().await;
    let wechsel = status_wechseln(&app, &admin, einsatz, ep, im_einsatz).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personnel/{ep}/release"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) =
        personalstatus_zuruecknehmen(&app, &admin, einsatz, ep, &wechsel["status_ruecknahme"])
            .await;
    assert_eq!(s, StatusCode::CONFLICT);
}
