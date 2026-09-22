//! LFH-608: Lagezustand, Abschnittsauftrag, Fortschritt und Kurzbezeichnung je
//! Einsatzabschnitt — die Datenquelle für die Abschnittszeile im Führungs-Überblick (S2).

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup, system_etb_anzahl};

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abschnitte")
}

async fn anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &str) -> Value {
    let (s, json) = anfrage(app, "POST", &pfad(einsatz), cookie, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json
}

async fn patch(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    aid: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("{}/{aid}", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await
}

/// Inhalte der System-ETB-Einträge (neueste zuerst, wie die ETB-Liste sie liefert).
async fn system_texte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap_or("").to_string())
        .collect()
}

#[tokio::test]
async fn anlegen_traegt_alle_vier_felder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let json = anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Abschnitt Nord","kurzbezeichnung":"  EA-N ","lagezustand":"angespannt",
            "abschnittsauftrag":"Deichsicherung km 3,8 – 5,4","fortschritt":72}"#,
    )
    .await;
    assert_eq!(json["kurzbezeichnung"], "EA-N");
    assert_eq!(json["lagezustand"], "angespannt");
    assert_eq!(json["abschnittsauftrag"], "Deichsicherung km 3,8 – 5,4");
    assert_eq!(json["fortschritt"], 72);
}

#[tokio::test]
async fn ohne_angaben_fehlen_die_felder_statt_null() {
    // Norm LFH-265: `Option` ohne Wert ist ABWESEND, nicht `null` — per `contains_key`
    // geprüft, weil `v["feld"] == Null` beide Fälle nicht unterscheidet.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let json = anlegen(&app, &admin, einsatz, r#"{"name":"Süd"}"#).await;
    let obj = json.as_object().unwrap();
    for feld in [
        "kurzbezeichnung",
        "lagezustand",
        "abschnittsauftrag",
        "fortschritt",
    ] {
        assert!(!obj.contains_key(feld), "{feld} darf nicht gesendet werden");
    }
}

#[tokio::test]
async fn unbekannter_lagezustand_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(r#"{"name":"Nord","lagezustand":"dramatisch"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let aid = anlegen(&app, &admin, einsatz, r#"{"name":"Nord"}"#).await["id"]
        .as_i64()
        .unwrap();
    let (s, _) = patch(&app, &admin, einsatz, aid, r#"{"lagezustand":"gelb"}"#).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fortschritt_ausserhalb_0_bis_100_ist_400_grenzen_gelten() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for wert in ["-1", "101"] {
        let (s, _) = anfrage(
            &app,
            "POST",
            &pfad(einsatz),
            &admin,
            Some(&format!(r#"{{"name":"Nord","fortschritt":{wert}}}"#)),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "POST fortschritt={wert}");
    }
    let aid = anlegen(&app, &admin, einsatz, r#"{"name":"Nord","fortschritt":0}"#).await["id"]
        .as_i64()
        .unwrap();
    let (s, json) = patch(&app, &admin, einsatz, aid, r#"{"fortschritt":100}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["fortschritt"], 100);
    let (s, _) = patch(&app, &admin, einsatz, aid, r#"{"fortschritt":250}"#).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // `null` löscht die Einschätzung — „nicht eingeschätzt" ist nicht 0 %.
    let (s, json) = patch(&app, &admin, einsatz, aid, r#"{"fortschritt":null}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert!(!json.as_object().unwrap().contains_key("fortschritt"));
}

#[tokio::test]
async fn patch_eines_feldes_laesst_die_anderen_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Nord","kurzbezeichnung":"EA-N","lagezustand":"planmaessig",
            "abschnittsauftrag":"Deich halten","fortschritt":10}"#,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let (s, json) = patch(&app, &admin, einsatz, aid, r#"{"fortschritt":40}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["fortschritt"], 40);
    assert_eq!(json["kurzbezeichnung"], "EA-N");
    assert_eq!(json["lagezustand"], "planmaessig");
    assert_eq!(json["abschnittsauftrag"], "Deich halten");
    assert_eq!(json["name"], "Nord");

    // Leerstring leert wie `null` (trimme_tri) — und nur dieses Feld.
    let (s, json) = patch(&app, &admin, einsatz, aid, r#"{"abschnittsauftrag":"  "}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert!(!json.as_object().unwrap().contains_key("abschnittsauftrag"));
    assert_eq!(json["fortschritt"], 40);
}

#[tokio::test]
async fn kurzbezeichnung_ist_je_einsatz_eindeutig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Nord","kurzbezeichnung":"EA-N"}"#,
    )
    .await;
    // Groß-/Kleinschreibung unterscheidet im Funk nichts.
    let (s, json) = anfrage(
        &app,
        "POST",
        &pfad(einsatz),
        &admin,
        Some(r#"{"name":"Nordost","kurzbezeichnung":"ea-n"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");

    // PATCH auf ein vergebenes Kürzel ebenso.
    let sued = anlegen(&app, &admin, einsatz, r#"{"name":"Süd"}"#).await["id"]
        .as_i64()
        .unwrap();
    let (s, _) = patch(&app, &admin, einsatz, sued, r#"{"kurzbezeichnung":"EA-N"}"#).await;
    assert_eq!(s, StatusCode::CONFLICT);
    // Mehrere Abschnitte OHNE Kürzel sind kein Konflikt.
    anlegen(&app, &admin, einsatz, r#"{"name":"Logistik"}"#).await;

    // Ein anderer Einsatz darf dasselbe Kürzel vergeben.
    let anderer = einsatz_anlegen(&app, &admin).await;
    anlegen(
        &app,
        &admin,
        anderer,
        r#"{"name":"Nord","kurzbezeichnung":"EA-N"}"#,
    )
    .await;
}

#[tokio::test]
async fn wechsel_des_lagezustands_schreibt_genau_einen_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Nord","lagezustand":"angespannt"}"#,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, _) = patch(&app, &admin, einsatz, aid, r#"{"lagezustand":"kritisch"}"#).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, vorher + 1);
    assert_eq!(
        system_texte(&app, &admin, einsatz).await[0],
        "Lage Abschnitt «Nord»: angespannt → kritisch"
    );

    // Derselbe Wert noch einmal und ein Patch ohne das Feld: KEIN Eintrag.
    patch(&app, &admin, einsatz, aid, r#"{"lagezustand":"kritisch"}"#).await;
    patch(&app, &admin, einsatz, aid, r#"{"fortschritt":30}"#).await;
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, vorher + 1);

    // Zurücknehmen der Beurteilung ist ebenfalls ein Wechsel.
    patch(&app, &admin, einsatz, aid, r#"{"lagezustand":null}"#).await;
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, vorher + 2);
    assert_eq!(
        system_texte(&app, &admin, einsatz).await[0],
        "Lage Abschnitt «Nord»: kritisch → nicht beurteilt"
    );
}

#[tokio::test]
async fn anlegen_mit_lagezustand_nennt_ihn_im_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Süd","lagezustand":"planmaessig"}"#,
    )
    .await;
    anlegen(&app, &admin, einsatz, r#"{"name":"West"}"#).await;
    let texte = system_texte(&app, &admin, einsatz).await;
    assert!(texte.contains(&"Abschnitt «Süd» angelegt (Lage: planmäßig)".to_string()));
    assert!(texte.contains(&"Abschnitt «West» angelegt".to_string()));
}

#[tokio::test]
async fn lagewechsel_bleibt_dokumentiert_wenn_die_sprechgruppen_zuordnung_scheitert() {
    // Review LFH-608: das Formular schickt `sprechgruppe_ids` bei JEDEM Speichern mit. Scheitert
    // die Zuordnung, darf der schon gespeicherte Lagewechsel nicht ohne ETB-Eintrag bleiben.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = anlegen(
        &app,
        &admin,
        einsatz,
        r#"{"name":"Nord","lagezustand":"planmaessig"}"#,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, _) = patch(
        &app,
        &admin,
        einsatz,
        aid,
        r#"{"lagezustand":"kritisch","sprechgruppe_ids":[987654]}"#,
    )
    .await;
    assert!(
        s.is_client_error(),
        "unbekannte Sprechgruppe muss scheitern, war {s}"
    );

    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(liste[0]["lagezustand"], "kritisch");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, vorher + 1);
    assert_eq!(
        system_texte(&app, &admin, einsatz).await[0],
        "Lage Abschnitt «Nord»: planmäßig → kritisch"
    );
}

#[tokio::test]
async fn umbenennen_und_lagewechsel_im_selben_patch_nennt_den_neuen_namen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = anlegen(&app, &admin, einsatz, r#"{"name":"Nord"}"#).await["id"]
        .as_i64()
        .unwrap();
    let (s, json) = patch(
        &app,
        &admin,
        einsatz,
        aid,
        r#"{"name":"Deich Nord","lagezustand":"angespannt"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["lagezustand"], "angespannt");
    assert_eq!(
        system_texte(&app, &admin, einsatz).await[0],
        "Lage Abschnitt «Deich Nord»: nicht beurteilt → angespannt"
    );
}
