//! Einsatzrolle „Mitarbeit“ (LLH-1817): darf erfassen, aber nichts ändern. Geteilt mit den
//! Erfassungs-Tests der übrigen Module.

use axum::http::StatusCode;

mod common;
use common::{
    anfrage, anfrage_mit_offline_queue_benutzer, benutzer_anlegen, einsatz_anlegen, login_cookie,
    multipart_post, rolle_setzen, setup, setup_mit_pool_und_live, MINI_PNG,
};

/// Legt einen Benutzer an, gibt ihm im Einsatz die Rolle `mitarbeit` und meldet ihn an;
/// liefert (Benutzer-id, Cookie).
async fn mitarbeit_anlegen(app: &axum::Router, admin: &str, einsatz: i64) -> (i64, String) {
    let id = benutzer_anlegen(app, admin, "mitarbeiter", "keine").await;
    rolle_setzen(app, admin, einsatz, id, "mitarbeit").await;
    let cookie = login_cookie(app, "mitarbeiter", "mitarbeiterpw1").await;
    (id, cookie)
}

async fn default_kanal(app: &axum::Router, einsatz: i64, cookie: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json.as_array().unwrap()[0]["id"].as_i64().unwrap()
}

async fn nachricht(
    app: &axum::Router,
    einsatz: i64,
    kanal: i64,
    cookie: &str,
    inhalt: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kanal}/nachrichten"),
        cookie,
        Some(&format!(r#"{{"inhalt":"{inhalt}"}}"#)),
    )
    .await
}

#[tokio::test]
async fn mitarbeit_schreibt_bearbeitet_und_loescht_eigene_chatnachricht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;

    let (s, m) = nachricht(&app, einsatz, kid, &mit, "Erster Stand").await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    let mid = m["id"].as_i64().unwrap();
    let uri = format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}");

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &uri,
        &mit,
        Some(r#"{"inhalt":"Korrigiert"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "DELETE", &uri, &mit, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn mitarbeit_bearbeitet_fremde_chatnachricht_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;

    let (_, m) = nachricht(&app, einsatz, kid, &admin, "Von der Leitung").await;
    let mid = m["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}"),
        &mit,
        Some(r#"{"inhalt":"Übernommen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mitarbeit_legt_keinen_chatkanal_an_und_setzt_keinen_bezug() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let (_, m) = nachricht(&app, einsatz, kid, &mit, "Eigene Nachricht").await;
    let mid = m["id"].as_i64().unwrap();

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele"),
        &mit,
        Some(r#"{"name":"Neu"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/chat/nachrichten/{mid}/bezug"),
        &mit,
        Some(r#"{"typ":"schaden","ziel_id":1}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn beobachter_schreibt_weiter_nicht_in_den_chat() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let id = benutzer_anlegen(&app, &admin, "beobachter1", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let cookie = login_cookie(&app, "beobachter1", "beobachter1pw1").await;

    let (s, _) = nachricht(&app, einsatz, kid, &cookie, "Darf nicht").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn herabgestufte_mitarbeit_schreibt_nicht_mehr() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (id, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;

    let (s, _) = nachricht(&app, einsatz, kid, &mit, "Noch erlaubt").await;
    assert_eq!(s, StatusCode::CREATED);
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let (s, _) = nachricht(&app, einsatz, kid, &mit, "Nicht mehr erlaubt").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn mitarbeit_laedt_anhang_hoch_und_loescht_eigenen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let uri = format!("/api/einsaetze/{einsatz}/anhaenge");

    let (s, v) = multipart_post(&app, &uri, &mit, Some(("a.png", MINI_PNG)), &[]).await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    let eigener = v[0]["id"].as_i64().unwrap();
    let (s, _) = anfrage(&app, "DELETE", &format!("{uri}/{eigener}"), &mit, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    // Ein fremder, ungebundener Anhang bleibt für die Mitarbeit unsichtbar.
    let (s, v) = multipart_post(&app, &uri, &admin, Some(("b.png", MINI_PNG)), &[]).await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    let fremder = v[0]["id"].as_i64().unwrap();
    let (s, _) = anfrage(&app, "DELETE", &format!("{uri}/{fremder}"), &mit, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn mitarbeit_legt_keine_kraefte_abschnitte_oder_einstellungen_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;

    for (methode, pfad, body) in [
        ("POST", "einheiten", r#"{"name":"Trupp"}"#),
        ("POST", "abschnitte", r#"{"name":"Nord"}"#),
        (
            "PUT",
            "einstellungen",
            r#"{"auftrag_quittierung_frist_min":45}"#,
        ),
    ] {
        let (s, v) = anfrage(
            &app,
            methode,
            &format!("/api/einsaetze/{einsatz}/{pfad}"),
            &mit,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {pfad}: {v:?}");
    }
}

#[tokio::test]
async fn mitarbeit_loescht_keinen_anhang_einer_fremden_chatnachricht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kid = default_kanal(&app, einsatz, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let uri = format!("/api/einsaetze/{einsatz}/anhaenge");

    let (s, v) = multipart_post(&app, &uri, &admin, Some(("c.png", MINI_PNG)), &[]).await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    let aid = v[0]["id"].as_i64().unwrap();
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele/{kid}/nachrichten"),
        &admin,
        Some(&format!(r#"{{"inhalt":"Mit Foto","anhang_ids":[{aid}]}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");

    let (s, _) = anfrage(&app, "DELETE", &format!("{uri}/{aid}"), &mit, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "GET", &format!("{uri}/{aid}"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "der Anhang muss bleiben");
}

// ───────────────────────────── Meldungen (LLH-1817, D3/D4) ─────────────────────────────

fn meldung_body(extra: serde_json::Value) -> serde_json::Value {
    let mut body = serde_json::json!({
        "absender": "Florian Nord 1",
        "empfaenger": "ELW 1",
        "meldeweg": "funk",
        "inhalt": "Brücke gesperrt",
        "ereigniszeit": "2026-10-21 09:00:00",
    });
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    body
}

async fn meldung_senden(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    extra: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/meldungen"),
        cookie,
        Some(&meldung_body(extra).to_string()),
    )
    .await
}

async fn meldung_korrigieren(
    app: &axum::Router,
    einsatz: i64,
    mid: i64,
    cookie: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/meldungen/{mid}"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn meldungen_liste(app: &axum::Router, einsatz: i64, cookie: &str) -> Vec<serde_json::Value> {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/meldungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    v.as_array().unwrap().clone()
}

#[tokio::test]
async fn mitarbeit_legt_normale_meldung_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let zweite = benutzer_anlegen(&app, &admin, "mitarbeiterin", "keine").await;
    rolle_setzen(&app, &admin, einsatz, zweite, "mitarbeit").await;
    let zweite_cookie = login_cookie(&app, "mitarbeiterin", "mitarbeiterinpw1").await;

    let (s, m) = meldung_senden(&app, einsatz, &mit, serde_json::json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    assert_eq!(m["erfasst_von_id"].as_i64(), Some(id));
    assert_eq!(m["lagerelevant"], serde_json::json!(false));

    // Eine Mitarbeit hört nicht auf „Neue Meldung“ (D5).
    let (s, hinweise) = anfrage(&app, "GET", "/api/benachrichtigungen", &zweite_cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        hinweise
            .as_array()
            .unwrap()
            .iter()
            .all(|h| h["bezug_typ"] != "meldung"),
        "{hinweise:?}"
    );
}

#[tokio::test]
async fn mitarbeit_legt_keine_lagemeldung_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;

    let (s, v) = meldung_senden(
        &app,
        einsatz,
        &mit,
        serde_json::json!({ "meldungsart": "lagemeldung" }),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v:?}");
    assert!(meldungen_liste(&app, einsatz, &admin).await.is_empty());
}

#[tokio::test]
async fn mitarbeit_korrigiert_eigene_meldung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let (_, m) = meldung_senden(&app, einsatz, &mit, serde_json::json!({})).await;
    let mid = m["id"].as_i64().unwrap();

    let (s, v) = meldung_korrigieren(
        &app,
        einsatz,
        mid,
        &mit,
        serde_json::json!({ "prioritaet": "dringend" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["prioritaet"], "dringend");
}

#[tokio::test]
async fn mitarbeit_korrigiert_fremde_meldung_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let (_, m) = meldung_senden(&app, einsatz, &admin, serde_json::json!({})).await;
    let mid = m["id"].as_i64().unwrap();

    let (s, _) = meldung_korrigieren(
        &app,
        einsatz,
        mid,
        &mit,
        serde_json::json!({ "prioritaet": "dringend" }),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Auch mit einem Lage-Feld bleibt es 404 und ändert nichts.
    let (s, _) = meldung_korrigieren(
        &app,
        einsatz,
        mid,
        &mit,
        serde_json::json!({ "lagerelevant": true }),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let liste = meldungen_liste(&app, einsatz, &admin).await;
    assert_eq!(liste[0]["prioritaet"], "normal");
    assert_eq!(liste[0]["lagerelevant"], serde_json::json!(false));
}

#[tokio::test]
async fn mitarbeit_stellt_eigene_meldung_nicht_auf_lagemeldung_um() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let (_, m) = meldung_senden(&app, einsatz, &mit, serde_json::json!({})).await;
    let mid = m["id"].as_i64().unwrap();

    for body in [
        serde_json::json!({ "meldungsart": "lagemeldung" }),
        serde_json::json!({ "lagerelevant": true }),
        serde_json::json!({ "lagerelevant": false }),
        serde_json::json!({ "lage_text": "Brücke weg" }),
        serde_json::json!({ "lage_text": null }),
        serde_json::json!({ "meldungsart": "lagemeldung", "prioritaet": "dringend" }),
    ] {
        let (s, v) = meldung_korrigieren(&app, einsatz, mid, &mit, body.clone()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{body}: {v:?}");
    }
    let liste = meldungen_liste(&app, einsatz, &admin).await;
    assert_eq!(liste[0]["meldungsart"], "sonstige");
    assert_eq!(liste[0]["prioritaet"], "normal");
    assert_eq!(liste[0]["lagerelevant"], serde_json::json!(false));
}

#[tokio::test]
async fn mitarbeit_bestaetigt_weist_zu_und_erteilt_keinen_auftrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let (_, m) = meldung_senden(&app, einsatz, &mit, serde_json::json!({})).await;
    let mid = m["id"].as_i64().unwrap();

    for (pfad, body) in [
        ("bestaetigen", "{}".to_string()),
        ("zuweisen", format!(r#"{{"bearbeiter_id":{id}}}"#)),
        ("status", r#"{"status":"gesichtet"}"#.to_string()),
        ("auftrag", "{}".to_string()),
    ] {
        let (s, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/meldungen/{mid}/{pfad}"),
            &mit,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{pfad}: {v:?}");
    }
}

#[tokio::test]
async fn mitarbeit_meldung_offline_replay_gibt_gespeicherte_zurueck() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (id, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let uri = format!("/api/einsaetze/{einsatz}/meldungen");
    let body = meldung_body(serde_json::json!({ "client_id": "offline-mit-1" })).to_string();

    let (s1, erst) =
        anfrage_mit_offline_queue_benutzer(&app, "POST", &uri, &mit, Some(&body), id).await;
    assert_eq!(s1, StatusCode::CREATED, "{erst:?}");
    let (s2, zweit) =
        anfrage_mit_offline_queue_benutzer(&app, "POST", &uri, &mit, Some(&body), id).await;
    assert_eq!(s2, StatusCode::CREATED, "{zweit:?}");
    assert_eq!(erst["id"], zweit["id"]);

    // Nach dem Abschluss des Einsatzes liefert der Replay weiter die gespeicherte Meldung.
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
         abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    let (s3, dritt) =
        anfrage_mit_offline_queue_benutzer(&app, "POST", &uri, &mit, Some(&body), id).await;
    assert_eq!(s3, StatusCode::CREATED, "{dritt:?}");
    assert_eq!(erst["id"], dritt["id"]);
}

#[tokio::test]
async fn mitarbeit_verortet_normale_meldung_wie_alle_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;

    let (s, v) = meldung_senden(
        &app,
        einsatz,
        &mit,
        serde_json::json!({ "lat": 52.5, "lon": 13.4 }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v:?}");
}

#[tokio::test]
async fn mitarbeit_korrigiert_eigene_meldung_in_der_lage_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, mit) = mitarbeit_anlegen(&app, &admin, einsatz).await;
    let (_, m) = meldung_senden(&app, einsatz, &mit, serde_json::json!({})).await;
    let mid = m["id"].as_i64().unwrap();
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/meldungen/{mid}/lagerelevant"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");

    for body in [
        serde_json::json!({ "prioritaet": "dringend" }),
        serde_json::json!({ "meldungsart": "sonstige" }),
    ] {
        let (s, v) = meldung_korrigieren(&app, einsatz, mid, &mit, body.clone()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{body}: {v:?}");
    }
    let liste = meldungen_liste(&app, einsatz, &admin).await;
    assert_eq!(liste[0]["prioritaet"], "normal");
    assert_eq!(liste[0]["lagerelevant"], serde_json::json!(true));
}
