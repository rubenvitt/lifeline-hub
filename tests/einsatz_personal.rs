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
            "POST",
            &format!("/api/einsaetze/{einsatz}/personal/{ep}/entlassen"),
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
                "POST",
                &format!("/api/einsaetze/{einsatz}/personal/{ep}/entlassen"),
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

// ---------- Fremd-Ereignisse (LLH-1182) ----------

/// Ad-hoc-Kraft mit Stärke-Position; liefert die `ep_id`.
async fn kraft(app: &axum::Router, cookie: &str, einsatz: i64, name: &str, position: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
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
        &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/personal/{ep}"),
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
                &format!("/api/einsaetze/{einsatz}/personal/{ep}/entlassen"),
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
                &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
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
        &format!("/api/einsaetze/{einsatz}/personal"),
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
                &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
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
        &format!("/api/einsaetze/{einsatz}/personal/{ep}/{was}"),
        cookie,
        None,
    )
    .await
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
    assert_eq!(json["beendet_als"], "entlassen");
    assert!(
        json["beendet_at"].is_string() && json["beendet_von"].is_i64(),
        "{json}"
    );
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
        &format!("/api/einsaetze/{einsatz}/personal?entlassene=ja"),
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
        &format!("/api/einsaetze/{einsatz}/personal/{anna}"),
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
        &format!("/api/einsaetze/{einsatz}/personal/{anna}/position"),
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
    assert_eq!(namen(&app, &admin, einsatz, "").await, ["Anna", "Bert"]);
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
                &format!("/api/einsaetze/{einsatz}/personal"),
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
