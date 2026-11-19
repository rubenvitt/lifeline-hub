//! Einsatzrolle „Mitarbeit“ (LLH-1817): darf erfassen, aber nichts ändern. Geteilt mit den
//! Erfassungs-Tests der übrigen Module.

use axum::http::StatusCode;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, multipart_post, rolle_setzen, setup,
    MINI_PNG,
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
