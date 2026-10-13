//! Auftrag berichtigen (LLH-1098, Spec `auftrag-aufheben-berichtigen`): Teil-Patch vor der
//! ersten Quittung, Anordnung mit den geänderten Feldern im ETB, Erinnerung folgt der Frist.
use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, recv_until_tag, rolle_setzen,
    setup_mit_pool_und_live,
};

/// 12.10.2026 15:00 Europe/Berlin (Vorgabezone ohne Org-Einstellung) = 13:00 UTC.
const FRIST: &str = "2099-10-12 13:00:00";

fn funktion(t: &str) -> Value {
    json!({ "empfaenger_typ": "funktion", "funktion_text": t })
}

async fn erteilen(app: &axum::Router, cookie: &str, e: i64, body: Value) -> Value {
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    j
}

async fn standard(app: &axum::Router, cookie: &str, e: i64) -> Value {
    erteilen(
        app,
        cookie,
        e,
        json!({
            "auftrag_text": "Sandsäcke zum Deich bringen",
            "frist_at": FRIST,
            "mittel": "LKW",
            "empfaenger": [funktion("Logistiktrupp")]
        }),
    )
    .await
}

async fn patch(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    aid: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{e}/auftraege/{aid}"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn anordnungen(app: &axum::Router, cookie: &str, e: i64) -> Vec<Value> {
    let (_, etb) = anfrage(app, "GET", &format!("/api/einsaetze/{e}/etb"), cookie, None).await;
    etb.as_array()
        .unwrap()
        .iter()
        .filter(|x| x["typ"] == "anordnung")
        .cloned()
        .collect()
}

fn inhalte(a: &[Value]) -> Vec<String> {
    a.iter()
        .map(|x| x["inhalt"].as_str().unwrap().to_string())
        .collect()
}

async fn auto_erinnerung(pool: &sqlx::SqlitePool, aid: i64) -> Option<(String, Option<String>)> {
    sqlx::query_as(
        "SELECT faellig_at, zuletzt_ausgeloest_at FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = 'auftrag' AND bezug_id = ?",
    )
    .bind(aid)
    .fetch_optional(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn frist_und_prioritaet_berichtigen_nennt_beide_im_etb() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = standard(&app, &admin, e).await;
    let aid = a["id"].as_i64().unwrap();
    let mut rx = live.abonniere(e);

    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "frist_at": "2099-10-12 14:00:00", "prioritaet": "sofort" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["frist_at"], "2099-10-12 14:00:00");
    assert_eq!(j["prioritaet"], "sofort");
    assert_eq!(
        j["auftrag_text"], "Sandsäcke zum Deich bringen",
        "Rest bleibt"
    );
    assert_eq!(j["mittel"], "LKW");
    assert_eq!(j["berichtigbar"], true);
    recv_until_tag(&mut rx, "auftrag", Duration::from_secs(1)).await;

    let a = anordnungen(&app, &admin, e).await;
    let berichtigt = a
        .iter()
        .find(|x| x["inhalt"].as_str().unwrap().contains("geändert"))
        .unwrap_or_else(|| panic!("{a:?}"));
    assert_eq!(
        berichtigt["inhalt"],
        "Auftrag #1 geändert: Priorität sofort (vorher normal), Frist 12.10. 16:00 (vorher 12.10. 15:00)."
    );
    assert_eq!(berichtigt["an"], "Logistiktrupp");
    assert_eq!(berichtigt["auftrag_id"], aid);
    assert!(
        inhalte(&a).contains(&"Sandsäcke zum Deich bringen".to_string()),
        "die ursprüngliche Anordnung bleibt"
    );
}

#[tokio::test]
async fn text_empfaenger_und_schema_im_etb() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();

    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({
            "auftrag_text": " Sandsäcke zum Deich Nord bringen ",
            "empfaenger": [funktion("Versorgungszug"), funktion("Versorgungszug")],
            "mittel": "Radlader",
            "lage": null
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["auftrag_text"], "Sandsäcke zum Deich Nord bringen");
    let empf = j["empfaenger"].as_array().unwrap();
    assert_eq!(empf.len(), 1, "gleiche Empfänger zusammengeführt");
    assert_eq!(empf[0]["snap_anzeige"], "Versorgungszug");
    assert!(empf[0]["quittiert_at"].is_null());
    assert_eq!(j["mittel"], "Radlader");

    let a = anordnungen(&app, &admin, e).await;
    assert!(
        inhalte(&a).contains(
            &"Auftrag #1 geändert: Auftragstext „Sandsäcke zum Deich Nord bringen“, Empfänger Versorgungszug (vorher Logistiktrupp), Mittel."
                .to_string()
        ),
        "{a:?}"
    );
    let eintrag = a
        .iter()
        .find(|x| x["inhalt"].as_str().unwrap().contains("geändert"))
        .unwrap();
    assert_eq!(eintrag["an"], "Versorgungszug");
}

#[tokio::test]
async fn null_leert_und_fehlendes_feld_bleibt() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();

    let (s, j) = patch(&app, &admin, e, aid, json!({ "mittel": null })).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert!(j["mittel"].is_null());
    assert_eq!(j["frist_at"], FRIST);
    assert!(inhalte(&anordnungen(&app, &admin, e).await)
        .contains(&"Auftrag #1 geändert: Mittel.".to_string()));
}

#[tokio::test]
async fn patch_ohne_aenderung_schreibt_nichts() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();
    let vorher = anordnungen(&app, &admin, e).await.len();

    let (s, _) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({
            "auftrag_text": "Sandsäcke zum Deich bringen",
            "frist_at": FRIST,
            "mittel": " LKW ",
            "prioritaet": "normal",
            "empfaenger": [funktion("Logistiktrupp")]
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = patch(&app, &admin, e, aid, json!({})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(anordnungen(&app, &admin, e).await.len(), vorher);
}

#[tokio::test]
async fn nach_quittung_in_arbeit_vollzogen_oder_aufgehoben_ist_422() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let text = json!({ "auftrag_text": "neu" });

    let quittiert = erteilen(
        &app,
        &admin,
        e,
        json!({ "auftrag_text": "A", "empfaenger": [funktion("Nord"), funktion("Süd")] }),
    )
    .await;
    let qid = quittiert["id"].as_i64().unwrap();
    let empf = quittiert["empfaenger"][0]["id"].as_i64().unwrap();
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{qid}/empfaenger/{empf}/quittieren"),
        &admin,
        None,
    )
    .await;
    let (s, j) = patch(&app, &admin, e, qid, text.clone()).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "quittiert: {j}");

    for (status, body) in [
        ("in_arbeit", json!({ "status": "in_arbeit" })),
        (
            "vollzogen",
            json!({ "status": "vollzogen", "vollzugsmeldung": "ok" }),
        ),
    ] {
        let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"),
            &admin,
            Some(&body.to_string()),
        )
        .await;
        let (s, _) = patch(&app, &admin, e, aid, text.clone()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{status}");
    }

    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{aid}/aufheben"),
        &admin,
        Some(r#"{"grund":"erledigt"}"#),
    )
    .await;
    let (s, _) = patch(&app, &admin, e, aid, text).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "aufgehoben");

    let (_, d) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege/{qid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(d["auftrag_text"], "A", "unverändert");
    assert_eq!(d["berichtigbar"], false);
}

#[tokio::test]
async fn feldfehler_sind_400() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();
    for body in [
        json!({ "auftrag_text": "   " }),
        json!({ "auftrag_text": "x".repeat(10_001) }),
        json!({ "empfaenger": [] }),
        json!({ "empfaenger": (0..51).map(|i| funktion(&format!("EA {i}"))).collect::<Vec<_>>() }),
        json!({ "prioritaet": "egal" }),
        json!({ "frist_at": "morgen" }),
        json!({ "mittel": "x".repeat(2_001) }),
    ] {
        let (s, j) = patch(&app, &admin, e, aid, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{j}");
    }
    let (_, d) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege/{aid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(d["auftrag_text"], "Sandsäcke zum Deich bringen");
}

#[tokio::test]
async fn rechte_und_einsatz_wie_beim_aufheben() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();
    let body = json!({ "auftrag_text": "neu" });

    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(
        patch(&app, &erika_c, e, aid, body.clone()).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        patch(&app, &admin, anderer, aid, body.clone()).await.0,
        StatusCode::NOT_FOUND
    );
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        patch(&app, &admin, e, aid, body).await.0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn frist_fuehrt_die_erinnerung_nach() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();
    // Der Alarm hat schon ausgelöst.
    sqlx::query(
        "UPDATE erinnerung SET zuletzt_ausgeloest_at = '2026-01-01 00:00:00' \
         WHERE quelle = 'auto_frist' AND bezug_id = ?",
    )
    .bind(aid)
    .execute(&pool)
    .await
    .unwrap();

    let (s, _) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "frist_at": "2099-10-12 14:00:00" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        auto_erinnerung(&pool, aid).await,
        Some(("2099-10-12 14:00:00".to_string(), None)),
        "verschoben, Auslöser zurückgesetzt"
    );

    let (s, _) = patch(&app, &admin, e, aid, json!({ "frist_at": null })).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(auto_erinnerung(&pool, aid).await, None, "geschlossen");
    assert!(inhalte(&anordnungen(&app, &admin, e).await)
        .contains(&"Auftrag #1 geändert: Frist keine (vorher 12.10. 16:00).".to_string()));

    let (s, _) = patch(&app, &admin, e, aid, json!({ "frist_at": FRIST })).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        auto_erinnerung(&pool, aid).await.map(|(f, _)| f),
        Some(FRIST.to_string()),
        "neu angelegt"
    );
}

#[tokio::test]
async fn liste_traegt_berichtigbar() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    standard(&app, &admin, e).await;
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["berichtigbar"], true);
}

/// LLH-1091: der Weg ist ein Feld des Befehlsschemas wie die übrigen; er lässt sich berichtigen,
/// steht als „Weg“ in der Anordnung und hat dieselbe Grenze.
#[tokio::test]
async fn weg_berichtigen_nennt_ihn_im_etb() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let aid = standard(&app, &admin, e).await["id"].as_i64().unwrap();

    let (s, j) = patch(&app, &admin, e, aid, json!({ "weg": " über B 3 " })).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["weg"], "über B 3");
    assert_eq!(j["mittel"], "LKW", "nicht gesendetes Feld bleibt");
    assert!(inhalte(&anordnungen(&app, &admin, e).await)
        .contains(&"Auftrag #1 geändert: Weg.".to_string()));

    let (s, j) = patch(&app, &admin, e, aid, json!({ "weg": "x".repeat(2_001) })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j}");
    assert!(j["error"].as_str().unwrap().starts_with("Weg"), "{j}");

    let (s, j) = patch(&app, &admin, e, aid, json!({ "weg": null })).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert!(j["weg"].is_null());
}

/// LLH-1176: Die Empfänger sind eine Menge. Dieselben Empfänger in anderer Reihenfolge sind keine
/// Berichtigung: kein ETB-Eintrag, die Zeilen bleiben.
#[tokio::test]
async fn umsortierte_empfaenger_sind_keine_aenderung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = erteilen(
        &app,
        &admin,
        e,
        json!({
            "auftrag_text": "Sandsäcke zum Deich bringen",
            "empfaenger": [funktion("Logistiktrupp"), funktion("Bergungsgruppe")]
        }),
    )
    .await;
    let aid = a["id"].as_i64().unwrap();
    let vorher = anordnungen(&app, &admin, e).await.len();

    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "empfaenger": [funktion("Bergungsgruppe"), funktion("Logistiktrupp")] }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["empfaenger"], a["empfaenger"], "Zeilen unverändert");
    assert_eq!(anordnungen(&app, &admin, e).await.len(), vorher);
}

/// Eine Einheit des Einsatzes; liefert ihre id.
async fn einheit(app: &axum::Router, cookie: &str, e: i64, name: &str) -> i64 {
    let (s, j) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten"),
        cookie,
        Some(&json!({ "name": name }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    j["id"].as_i64().unwrap()
}

/// LLH-1176: Ein Empfänger, den es so im Einsatz nicht mehr gibt (Einheit aufgelöst), hält die
/// Berichtigung eines anderen Felds nicht auf. Der Client schickt die Liste so zurück, wie er sie
/// gelesen hat; geprüft werden nur hinzukommende Empfänger, die bisherigen behalten ihre Anzeige.
#[tokio::test]
async fn aufgeloeste_empfaenger_einheit_haelt_die_berichtigung_nicht_auf() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let eid = einheit(&app, &admin, e, "Logistiktrupp 1").await;
    let a = erteilen(
        &app,
        &admin,
        e,
        json!({
            "auftrag_text": "Sandsäcke zum Deich bringen",
            "frist_at": FRIST,
            "empfaenger": [{ "empfaenger_typ": "einheit", "einheit_id": eid }]
        }),
    )
    .await;
    let aid = a["id"].as_i64().unwrap();
    lifeline_hub::einheit::repo::aufloesen(&pool, e, eid)
        .await
        .unwrap();
    let (_, gelesen) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege/{aid}"),
        &admin,
        None,
    )
    .await;
    let bisher = gelesen["empfaenger"].clone();
    assert!(bisher[0]["einheit_id"].is_null(), "{bisher}");

    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "frist_at": "2099-10-12 14:00:00", "empfaenger": bisher }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["frist_at"], "2099-10-12 14:00:00");
    assert_eq!(j["empfaenger"][0]["snap_anzeige"], "Logistiktrupp 1");
    assert!(inhalte(&anordnungen(&app, &admin, e).await)
        .contains(&"Auftrag #1 geändert: Frist 12.10. 16:00 (vorher 12.10. 15:00).".to_string()));

    // Kommt ein Empfänger hinzu, wird nur er geprüft; der bisherige bleibt mit seiner Anzeige.
    let mut liste = bisher.as_array().unwrap().clone();
    liste.push(funktion("Bergungsgruppe"));
    let (s, j) = patch(&app, &admin, e, aid, json!({ "empfaenger": liste })).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    let namen: Vec<&str> = j["empfaenger"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["snap_anzeige"].as_str().unwrap())
        .collect();
    assert_eq!(namen, ["Logistiktrupp 1", "Bergungsgruppe"]);
    assert!(inhalte(&anordnungen(&app, &admin, e).await).contains(
        &"Auftrag #1 geändert: Empfänger Logistiktrupp 1, Bergungsgruppe (vorher Logistiktrupp 1)."
            .to_string()
    ));

    // Ein neu genannter, ungültiger Empfänger bleibt ein Feldfehler.
    let mut liste = bisher.as_array().unwrap().clone();
    liste.push(json!({ "empfaenger_typ": "einheit", "einheit_id": eid }));
    let (s, j) = patch(&app, &admin, e, aid, json!({ "empfaenger": liste })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j}");
}

/// LLH-1176: Zwei aufgelöste Empfänger-Einheiten hinterlassen zwei gleiche Zeilen (ohne Ziel). Die
/// Liste so zurückzuschicken ist keine Empfänger-Änderung, und beide Zeilen bleiben.
#[tokio::test]
async fn zwei_aufgeloeste_einheiten_sind_keine_empfaenger_aenderung() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let eins = einheit(&app, &admin, e, "Logistiktrupp 1").await;
    let zwei = einheit(&app, &admin, e, "Logistiktrupp 2").await;
    let aid = erteilen(
        &app,
        &admin,
        e,
        json!({
            "auftrag_text": "Sandsäcke zum Deich bringen",
            "frist_at": FRIST,
            "empfaenger": [
                { "empfaenger_typ": "einheit", "einheit_id": eins },
                { "empfaenger_typ": "einheit", "einheit_id": zwei }
            ]
        }),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    for eid in [eins, zwei] {
        lifeline_hub::einheit::repo::aufloesen(&pool, e, eid)
            .await
            .unwrap();
    }
    let (_, gelesen) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege/{aid}"),
        &admin,
        None,
    )
    .await;

    let (s, j) = patch(
        &app,
        &admin,
        e,
        aid,
        json!({ "frist_at": "2099-10-12 14:00:00", "empfaenger": gelesen["empfaenger"] }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(
        j["empfaenger"], gelesen["empfaenger"],
        "beide Zeilen bleiben"
    );
    let geaendert: Vec<String> = inhalte(&anordnungen(&app, &admin, e).await)
        .into_iter()
        .filter(|i| i.contains("geändert"))
        .collect();
    assert_eq!(
        geaendert,
        ["Auftrag #1 geändert: Frist 12.10. 16:00 (vorher 12.10. 15:00)."]
    );
}

/// Inhalte der Anordnungen, die der ETB-Filter „Einheit“ liefert, älteste zuerst.
async fn anordnungen_der_einheit(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    einheit_id: i64,
) -> Vec<String> {
    let (s, etb) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/etb?einheit_id={einheit_id}&typ=anordnung"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{etb}");
    let mut v = inhalte(etb.as_array().unwrap());
    v.reverse();
    v
}

/// LLH-1175: ein ETB-Eintrag bleibt den Einheiten zugeordnet, an die er sich beim Schreiben
/// richtete. Die Erteilung an Logistiktrupp und Sanitätszug steht nach dem Umstellen auf die
/// Bergungsgruppe weiter unter beiden und nicht unter der Bergungsgruppe; die Anordnung
/// „… geändert: Empfänger …“ steht unter dem alten und dem neuen Kreis. Zwei alte Empfänger,
/// damit das „An“-Feld („Logistiktrupp, Sanitätszug“) allein keinen Treffer liefert.
#[tokio::test]
async fn einheitenfilter_ordnet_nach_den_empfaengern_beim_schreiben() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let logistik = einheit(&app, &admin, e, "Logistiktrupp").await;
    let sani = einheit(&app, &admin, e, "Sanitätszug").await;
    let bergung = einheit(&app, &admin, e, "Bergungsgruppe").await;
    let an = |id: i64| json!({ "empfaenger_typ": "einheit", "einheit_id": id });
    let aid = erteilen(
        &app,
        &admin,
        e,
        json!({ "auftrag_text": "Sandsäcke zum Deich bringen", "empfaenger": [an(logistik), an(sani)] }),
    )
    .await["id"]
        .as_i64()
        .unwrap();

    let (s, j) = patch(&app, &admin, e, aid, json!({ "empfaenger": [an(bergung)] })).await;
    assert_eq!(s, StatusCode::OK, "{j}");

    let erteilung = "Sandsäcke zum Deich bringen".to_string();
    let geaendert =
        "Auftrag #1 geändert: Empfänger Bergungsgruppe (vorher Logistiktrupp, Sanitätszug)."
            .to_string();
    for alt in [logistik, sani] {
        assert_eq!(
            anordnungen_der_einheit(&app, &admin, e, alt).await,
            vec![erteilung.clone(), geaendert.clone()],
            "alter Empfänger {alt}"
        );
    }
    assert_eq!(
        anordnungen_der_einheit(&app, &admin, e, bergung).await,
        vec![geaendert.clone()],
        "der neue Empfänger bekommt die Erteilung nicht nachträglich"
    );

    // Eine Anordnung nach der Berichtigung richtet sich nur noch an den neuen Kreis.
    let (s, j) = patch(&app, &admin, e, aid, json!({ "prioritaet": "sofort" })).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    let prio = "Auftrag #1 geändert: Priorität sofort (vorher normal).".to_string();
    assert_eq!(
        anordnungen_der_einheit(&app, &admin, e, bergung).await,
        vec![geaendert.clone(), prio]
    );
    assert_eq!(
        anordnungen_der_einheit(&app, &admin, e, logistik).await,
        vec![erteilung, geaendert]
    );
}
