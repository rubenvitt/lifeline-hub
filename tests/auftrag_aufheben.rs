//! Auftrag aufheben (LLH-1098, Spec `auftrag-aufheben-berichtigen`): Pflichtgrund, Endstatus
//! `aufgehoben`, Anordnung im ETB, Erinnerung endet, nichts nimmt der Auftrag danach mehr an.
use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, recv_until_tag, rolle_setzen,
    setup_mit_pool_und_live,
};

const FRIST_VERGANGEN: &str = "2020-01-01 00:00:00";

async fn auftrag_erteilen(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    frist: Option<&str>,
) -> (i64, i64) {
    let mut body = serde_json::json!({
        "auftrag_text": "Sandsäcke zum Deich bringen",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Logistiktrupp" }]
    });
    if let Some(f) = frist {
        body["frist_at"] = Value::from(f);
    }
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    (
        json["id"].as_i64().unwrap(),
        json["empfaenger"][0]["id"].as_i64().unwrap(),
    )
}

async fn aufheben(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    aid: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{aid}/aufheben"),
        cookie,
        Some(body),
    )
    .await
}

fn grund(g: &str) -> String {
    serde_json::json!({ "grund": g }).to_string()
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

async fn offene_auto_erinnerungen(pool: &sqlx::SqlitePool, aid: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = 'auftrag' AND bezug_id = ?",
    )
    .bind(aid)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn offenen_auftrag_aufheben_schreibt_anordnung_und_meldet_live() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (aid, _) = auftrag_erteilen(&app, &admin, e, None).await;
    let mut rx = live.abonniere(e);

    let (status, json) =
        aufheben(&app, &admin, e, aid, &grund("  Material kommt vom Bauhof ")).await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["bearbeitungsstatus"], "aufgehoben");
    assert_eq!(json["aufhebungsgrund"], "Material kommt vom Bauhof");
    assert!(json["aufgehoben_at"].is_string());
    assert!(json["aufgehoben_von_id"].is_i64());
    assert!(json["aufgehoben_von_name"].is_string());
    assert_eq!(json["berichtigbar"], false);
    recv_until_tag(&mut rx, "auftrag", Duration::from_secs(1)).await;

    let a = anordnungen(&app, &admin, e).await;
    assert_eq!(a.len(), 2, "Erteilen und Aufheben: {a:?}");
    let erteilt = a
        .iter()
        .find(|x| x["inhalt"] == "Sandsäcke zum Deich bringen");
    assert!(
        erteilt.is_some(),
        "die ursprüngliche Anordnung bleibt: {a:?}"
    );
    let aufgehoben = a
        .iter()
        .find(|x| x["inhalt"] == "Auftrag #1 aufgehoben: Material kommt vom Bauhof")
        .unwrap_or_else(|| panic!("Aufhebungs-Anordnung fehlt: {a:?}"));
    assert_eq!(aufgehoben["an"], "Logistiktrupp");
    assert_eq!(aufgehoben["von"], "System");
    assert_eq!(aufgehoben["auftrag_id"], aid);
    assert_eq!(
        aufgehoben["folgeauftraege"].as_array().map(Vec::len),
        Some(0),
        "die Anordnung trägt keinen Folgeauftrag"
    );
}

#[tokio::test]
async fn aufheben_aus_in_arbeit_und_vollzogen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (in_arbeit, _) = auftrag_erteilen(&app, &admin, e, None).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{in_arbeit}/vollzug"),
        &admin,
        Some(r#"{"status":"in_arbeit"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = aufheben(&app, &admin, e, in_arbeit, &grund("Lage erledigt")).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["bearbeitungsstatus"], "aufgehoben");

    let (vollzogen, _) = auftrag_erteilen(&app, &admin, e, None).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{vollzogen}/vollzug"),
        &admin,
        Some(r#"{"status":"vollzogen","vollzugsmeldung":"Säcke liegen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = aufheben(&app, &admin, e, vollzogen, &grund("Lage erledigt")).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["bearbeitungsstatus"], "aufgehoben");
    assert_eq!(
        json["vollzugsmeldung"], "Säcke liegen",
        "die Meldung bleibt"
    );
}

#[tokio::test]
async fn abgenommen_oder_schon_aufgehoben_ist_422_ohne_zweiten_eintrag() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (abgenommen, _) = auftrag_erteilen(&app, &admin, e, None).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{abgenommen}/vollzug"),
        &admin,
        Some(r#"{"status":"vollzogen","vollzugsmeldung":"ok"}"#),
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{abgenommen}/abnehmen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = aufheben(&app, &admin, e, abgenommen, &grund("zu spät")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (aid, _) = auftrag_erteilen(&app, &admin, e, None).await;
    let (s, _) = aufheben(&app, &admin, e, aid, &grund("erster")).await;
    assert_eq!(s, StatusCode::OK);
    let vorher = anordnungen(&app, &admin, e).await.len();
    let (s, _) = aufheben(&app, &admin, e, aid, &grund("zweiter")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(anordnungen(&app, &admin, e).await.len(), vorher);
}

#[tokio::test]
async fn grund_fehlt_leer_oder_zu_lang_ist_400() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (aid, _) = auftrag_erteilen(&app, &admin, e, None).await;

    for body in [
        "{}".to_string(),
        grund("   "),
        grund(&"x".repeat(lifeline_hub::auftrag::AUFHEBUNGSGRUND_MAX + 1)),
    ] {
        let (s, _) = aufheben(&app, &admin, e, aid, &body).await;
        assert_eq!(
            s,
            StatusCode::BAD_REQUEST,
            "{}",
            &body[..body.len().min(40)]
        );
    }
    let offen: Option<String> =
        sqlx::query_scalar("SELECT aufgehoben_at FROM auftrag WHERE id = ?")
            .bind(aid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(offen.is_none(), "der Auftrag bleibt offen");
    let (s, _) = aufheben(
        &app,
        &admin,
        e,
        aid,
        &grund(&"x".repeat(lifeline_hub::auftrag::AUFHEBUNGSGRUND_MAX)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "genau an der Grenze geht es");
}

#[tokio::test]
async fn beobachter_403_abgeschlossener_einsatz_409_fremder_einsatz_404() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (aid, _) = auftrag_erteilen(&app, &admin, e, None).await;

    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) = aufheben(&app, &erika_c, e, aid, &grund("x")).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    let (s, _) = aufheben(&app, &admin, anderer, aid, &grund("x")).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    let (s, _) = aufheben(&app, &admin, e, aid, &grund("x")).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn aufheben_schreibt_auch_ohne_auto_etb() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/einstellungen"),
        &admin,
        Some(r#"{"auto_etb_eintraege":false}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (aid, _) = auftrag_erteilen(&app, &admin, e, None).await;
    assert!(anordnungen(&app, &admin, e).await.is_empty());

    let (s, _) = aufheben(&app, &admin, e, aid, &grund("Lage erledigt")).await;
    assert_eq!(s, StatusCode::OK);
    let a = anordnungen(&app, &admin, e).await;
    assert_eq!(a.len(), 1, "{a:?}");
    assert_eq!(a[0]["inhalt"], "Auftrag #1 aufgehoben: Lage erledigt");
}

#[tokio::test]
async fn aufheben_schliesst_auto_erinnerung_und_laesst_manuelle_stehen() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (aid, _) = auftrag_erteilen(&app, &admin, e, Some("2099-12-31 00:00:00")).await;
    assert_eq!(offene_auto_erinnerungen(&pool, aid).await, 1);
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/erinnerungen"),
        &admin,
        Some(
            &serde_json::json!({
                "titel": "Bei Logistik nachfragen",
                "faellig_at": "2099-12-31 00:00",
                "bezug_typ": "auftrag",
                "bezug_id": aid
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let manuelle = json["id"].as_i64().unwrap();

    let (s, _) = aufheben(&app, &admin, e, aid, &grund("Lage erledigt")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(offene_auto_erinnerungen(&pool, aid).await, 0);
    let status: String = sqlx::query_scalar("SELECT status FROM erinnerung WHERE id = ?")
        .bind(manuelle)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "offen", "die selbst angelegte Erinnerung bleibt");
}

#[tokio::test]
async fn nach_dem_aufheben_nimmt_der_auftrag_nichts_mehr_an() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (aid, empf) = auftrag_erteilen(&app, &admin, e, Some(FRIST_VERGANGEN)).await;
    let (s, _) = aufheben(&app, &admin, e, aid, &grund("Lage erledigt")).await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{aid}/empfaenger/{empf}/quittieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Quittieren");
    for body in [
        r#"{"status":"in_arbeit"}"#,
        r#"{"status":"offen"}"#,
        r#"{"status":"vollzogen","vollzugsmeldung":"doch"}"#,
    ] {
        let (s, _) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Vollzug {body}");
    }
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/auftraege/{aid}/abnehmen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Abnehmen");

    let (_, d) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege/{aid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(d["bearbeitungsstatus"], "aufgehoben");
    assert_eq!(d["quittiert_anzahl"], 0, "der Empfänger bleibt unquittiert");
    assert_eq!(d["ist_ueberfaellig"], false);

    let (_, z) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/modul-zaehler"),
        &admin,
        None,
    )
    .await;
    assert_eq!(z["auftraege"]["offen"], 0, "{z}");
    assert_eq!(z["auftraege"]["ueberfaellig"], 0, "{z}");
}

#[tokio::test]
async fn feldfehler_am_vollzug_bleiben_400_auch_wenn_aufgehoben() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (aid, _) = auftrag_erteilen(&app, &admin, e, None).await;
    let (s, _) = aufheben(&app, &admin, e, aid, &grund("Lage erledigt")).await;
    assert_eq!(s, StatusCode::OK);
    for body in [
        r#"{"status":"xyz"}"#,
        r#"{"status":"vollzogen","vollzugsmeldung":"  "}"#,
    ] {
        let (s, _) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/auftraege/{aid}/vollzug"),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: 400 vor 422");
    }
}

/// Meldung → Auftrag erteilen → Auftrag aufheben → an der Meldung erneut erteilen (LLH-1177):
/// die Meldung meldet das Aufheben live, zeigt `is_auftrag_aufgehoben` und nimmt einen neuen Auftrag
/// an, der den Rückverweis übernimmt. Der alte bleibt aufgehoben bestehen.
#[tokio::test]
async fn meldung_mit_aufgehobenem_auftrag_laesst_sich_erneut_erteilen() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let meldung = serde_json::json!({
        "absender": "Florian Nord 1",
        "meldeweg": "funk",
        "inhalt": "Deich instabil",
        "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string();
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen"),
        &admin,
        Some(&meldung),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    let mid = m["id"].as_i64().unwrap();
    let auftrag = |text: &str| {
        serde_json::json!({
            "auftrag_text": text,
            "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "S3" }]
        })
        .to_string()
    };
    let erteilen_pfad = format!("/api/einsaetze/{e}/meldungen/{mid}/auftrag");

    let (s, json) = anfrage(
        &app,
        "POST",
        &erteilen_pfad,
        &admin,
        Some(&auftrag("erster")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let erster = json["auftrag_id"].as_i64().unwrap();
    assert_eq!(json["is_auftrag_aufgehoben"], false);

    let mut rx = live.abonniere(e);
    let (s, json) = aufheben(&app, &admin, e, erster, &grund("Lage erledigt")).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    recv_until_tag(&mut rx, "meldung", Duration::from_secs(1)).await;

    let (s, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/meldungen/{mid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["auftrag_id"], erster);
    assert_eq!(json["is_auftrag_aufgehoben"], true);

    let (s, json) = anfrage(
        &app,
        "POST",
        &erteilen_pfad,
        &admin,
        Some(&auftrag("zweiter")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let zweiter = json["auftrag_id"].as_i64().unwrap();
    assert_ne!(zweiter, erster, "die Meldung zeigt auf den neuen Auftrag");
    assert_eq!(json["is_auftrag_aufgehoben"], false);

    let (_, alt) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/auftraege/{erster}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(alt["bearbeitungsstatus"], "aufgehoben", "{alt}");

    // Der neue Auftrag gilt: eine dritte Erteilung bleibt 409.
    let (s, _) = anfrage(
        &app,
        "POST",
        &erteilen_pfad,
        &admin,
        Some(&auftrag("dritter")),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}
