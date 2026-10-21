//! ETB-Erfassung „Meldung“/„Lage“ legt den Vorgang im Meldungseingang an (LLH-1037, Spec
//! `meldungseingang`, Entscheidung LLH-1027 D2): mit `in_meldungseingang: true` entstehen Eintrag
//! und Meldung in EINER Transaktion, beidseitig verlinkt, ohne zweiten ETB-Eintrag; ohne Feld wird
//! nur protokolliert. Ohne Freigabe des Moduls Meldungen 403, nie stilles Herunterstufen.

use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

mod common;
use common::{
    anfrage, anfrage_mit_offline_queue_benutzer, benutzer_anlegen, einsatz_anlegen, login_cookie,
    rolle_setzen, setup, setup_mit_live,
};

async fn erfassen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        Some(body),
    )
    .await
}

async fn lesen(app: &axum::Router, cookie: &str, pfad: &str) -> Value {
    let (s, v) = anfrage(app, "GET", pfad, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v
}

async fn etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    lesen(app, cookie, &format!("/api/einsaetze/{einsatz}/etb"))
        .await
        .as_array()
        .unwrap()
        .clone()
}

async fn meldungen(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    lesen(app, cookie, &format!("/api/einsaetze/{einsatz}/meldungen"))
        .await
        .as_array()
        .unwrap()
        .clone()
}

async fn lagemeldungen(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    lesen(
        app,
        cookie,
        &format!("/api/einsaetze/{einsatz}/lage/meldungen"),
    )
    .await
    .as_array()
    .unwrap()
    .clone()
}

/// Führungspersonal im Einsatz (Schreibrecht im ETB, ohne Admin-Ausnahme der Modulfreigabe).
async fn fuehrungsperson(app: &axum::Router, admin: &str, einsatz: i64) -> (String, i64) {
    let id = benutzer_anlegen(app, admin, "frieda", "keine").await;
    rolle_setzen(app, admin, einsatz, id, "fuehrungspersonal").await;
    (login_cookie(app, "frieda", "friedapw1").await, id)
}

/// Beschränkt ein Modul des Einsatzes auf System-Admins (Override, LFH-132).
async fn nur_fuer_admins(app: &axum::Router, admin: &str, einsatz: i64, modul: &str) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

const LAGE: &str = r#"{"typ":"lage","inhalt":"Brand in Halle 2 unter Kontrolle","von":"Florian 3","an":"ELW 1","meldeweg":"funk","in_meldungseingang":true}"#;

#[tokio::test]
async fn lage_aus_dem_etb_steht_als_lagemeldung_im_eingang_und_in_der_lage() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (s, eintrag) = erfassen(&app, &admin, e, LAGE).await;
    assert_eq!(s, StatusCode::CREATED, "{eintrag}");
    let mid = eintrag["meldung_id"]
        .as_i64()
        .expect("Verweis auf die Meldung");
    assert!(eintrag["meldung_lfd_nr"].is_i64(), "{eintrag}");

    let liste = etb(&app, &admin, e).await;
    assert_eq!(liste.len(), 1, "genau ein ETB-Eintrag: {liste:?}");
    assert_eq!(liste[0]["typ"], "lage");
    assert_eq!(liste[0]["meldung_id"], mid);

    let m = meldungen(&app, &admin, e).await;
    assert_eq!(m.len(), 1, "{m:?}");
    let m = &m[0];
    assert_eq!(m["id"], mid);
    assert_eq!(m["meldungsart"], "lagemeldung");
    assert_eq!(m["status"], "neu");
    assert_eq!(m["prioritaet"], "normal");
    assert_eq!(m["absender"], "Florian 3");
    assert_eq!(m["empfaenger"], "ELW 1");
    assert_eq!(m["meldeweg"], "funk");
    assert_eq!(m["inhalt"], "Brand in Halle 2 unter Kontrolle");
    assert_eq!(m["lagerelevant"], true);
    assert_eq!(m["etb_meldung_id"], eintrag["id"], "Backlink der Meldung");
    assert_eq!(
        m["ereigniszeit"], eintrag["ereigniszeit"],
        "eine Zeit für beide"
    );

    let lage = lagemeldungen(&app, &admin, e).await;
    assert_eq!(lage.len(), 1, "{lage:?}");
    assert_eq!(lage[0]["meldung_id"], mid);
}

#[tokio::test]
async fn meldung_aus_dem_etb_ist_sonstige_und_zaehlt_als_offen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let zaehler = |app: axum::Router, admin: String| async move {
        lesen(&app, &admin, &format!("/api/einsaetze/{e}/modul-zaehler")).await["meldungen"]
            ["offen"]
            .as_i64()
            .unwrap()
    };
    let vorher = zaehler(app.clone(), admin.clone()).await;

    let (s, eintrag) = erfassen(
        &app,
        &admin,
        e,
        r#"{"typ":"meldung","inhalt":"Pegel steigt","von":"Florian 3","an":"ELW 1","ereigniszeit":"2026-10-21T12:30:00Z","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{eintrag}");
    let m = meldungen(&app, &admin, e).await;
    assert_eq!(m.len(), 1);
    assert_eq!(m[0]["meldungsart"], "sonstige");
    assert_eq!(m[0]["meldeweg"], "sonstige", "ohne Meldeweg „sonstige“");
    assert_eq!(m[0]["ereigniszeit"], "2026-10-21 12:30:00");
    assert_eq!(m[0]["lagerelevant"], false);
    assert_eq!(zaehler(app.clone(), admin.clone()).await, vorher + 1);
    assert!(lagemeldungen(&app, &admin, e).await.is_empty());
    assert_eq!(etb(&app, &admin, e).await.len(), 1);
}

#[tokio::test]
async fn ohne_feld_oder_mit_false_wird_nur_protokolliert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for body in [
        r#"{"typ":"meldung","inhalt":"Altclient","von":"A","an":"B"}"#,
        r#"{"typ":"lage","inhalt":"Nur Mitschrift","von":"A","an":"B","in_meldungseingang":false}"#,
        r#"{"typ":"anordnung","inhalt":"Anordnung","von":"A","an":"B","in_meldungseingang":false}"#,
    ] {
        let (s, v) = erfassen(&app, &admin, e, body).await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        assert!(v.get("meldung_id").is_none(), "{v}");
    }
    assert!(meldungen(&app, &admin, e).await.is_empty());
    assert_eq!(etb(&app, &admin, e).await.len(), 3);
}

#[tokio::test]
async fn andere_typen_mit_meldungseingang_sind_422_und_schreiben_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for typ in ["anordnung", "entscheidung"] {
        let (s, v) = erfassen(
            &app,
            &admin,
            e,
            &format!(
                r#"{{"typ":"{typ}","inhalt":"X","von":"A","an":"B","in_meldungseingang":true}}"#
            ),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{typ}: {v}");
    }
    // Ein Feldfehler bleibt 400 vor dem Zusammenhang (Statuscode-Konvention).
    let (s, _) = erfassen(
        &app,
        &admin,
        e,
        r#"{"typ":"anordnung","inhalt":"  ","von":"A","an":"B","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(etb(&app, &admin, e).await.is_empty());
    assert!(meldungen(&app, &admin, e).await.is_empty());
}

#[tokio::test]
async fn ohne_freigabe_der_meldungen_ist_403_und_nichts_entsteht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (frieda, _) = fuehrungsperson(&app, &admin, e).await;
    nur_fuer_admins(&app, &admin, e, "meldungen").await;

    let (s, v) = erfassen(&app, &frieda, e, LAGE).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert!(etb(&app, &admin, e).await.is_empty(), "kein Eintrag");
    assert!(meldungen(&app, &admin, e).await.is_empty(), "keine Meldung");

    // Nur protokollieren bleibt ihr offen.
    let (s, v) = erfassen(
        &app,
        &frieda,
        e,
        r#"{"typ":"lage","inhalt":"Mitschrift","von":"A","an":"B","in_meldungseingang":false}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

#[tokio::test]
async fn auto_etb_aus_aendert_nichts_am_einen_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/einstellungen"),
        &admin,
        Some(r#"{"auto_etb_eintraege":false}"#),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");

    let (s, eintrag) = erfassen(&app, &admin, e, LAGE).await;
    assert_eq!(s, StatusCode::CREATED, "{eintrag}");
    assert_eq!(etb(&app, &admin, e).await.len(), 1);
    let m = meldungen(&app, &admin, e).await;
    assert_eq!(m[0]["etb_meldung_id"], eintrag["id"]);
}

#[tokio::test]
async fn replay_derselben_client_id_erzeugt_weder_meldungs_noch_etb_dublette() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(e);
    let body = r#"{"typ":"lage","inhalt":"Deich hält","von":"A","an":"B","client_id":"etb-meldung-1","in_meldungseingang":true}"#;

    let (s1, v1) = erfassen(&app, &admin, e, body).await;
    assert_eq!(s1, StatusCode::CREATED, "{v1}");
    let mut tags = Vec::new();
    while let Ok(Ok(n)) = tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
        tags.push(n.event.as_str().to_string());
    }
    assert_eq!(
        tags.iter().filter(|t| *t == "etb").count(),
        1,
        "genau ein ETB-Ereignis: {tags:?}"
    );
    assert!(tags.iter().any(|t| t == "meldung"), "{tags:?}");

    let (s2, v2) = erfassen(&app, &admin, e, body).await;
    assert_eq!(s2, StatusCode::CREATED, "{v2}");
    assert_eq!(v1["id"], v2["id"]);
    assert_eq!(v1["meldung_id"], v2["meldung_id"]);
    assert!(
        matches!(
            rx.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ),
        "Replay publiziert nichts zweimal"
    );
    assert_eq!(etb(&app, &admin, e).await.len(), 1);
    assert_eq!(meldungen(&app, &admin, e).await.len(), 1);
}

#[tokio::test]
async fn replay_mit_anderer_kopplung_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = erfassen(
        &app,
        &admin,
        e,
        r#"{"typ":"lage","inhalt":"Deich hält","von":"A","an":"B","client_id":"etb-kopplung","in_meldungseingang":false}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, v) = erfassen(
        &app,
        &admin,
        e,
        r#"{"typ":"lage","inhalt":"Deich hält","von":"A","an":"B","client_id":"etb-kopplung","in_meldungseingang":true}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(meldungen(&app, &admin, e).await.is_empty());
}

#[tokio::test]
async fn ohne_netz_vorgemerkt_legt_beim_abspielen_die_meldung_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (frieda, frieda_id) = fuehrungsperson(&app, &admin, e).await;
    // Die Warteschlange sendet mit Besitz-Nachweis und der Ereigniszeit der Erfassung.
    let body = r#"{"typ":"lage","inhalt":"Offline erfasst","von":"A","an":"B","ereigniszeit":"2026-10-21T09:15:00Z","erfasst_lokal_at":"2026-10-21T09:15:00Z","client_id":"queue-1","in_meldungseingang":true}"#;
    for _ in 0..2 {
        let (s, v) = anfrage_mit_offline_queue_benutzer(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/etb"),
            &frieda,
            Some(body),
            frieda_id,
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let lage = lagemeldungen(&app, &admin, e).await;
    assert_eq!(lage.len(), 1, "{lage:?}");
    assert_eq!(lage[0]["meldungsart"], "lagemeldung");
    assert_eq!(lage[0]["ereigniszeit"], "2026-10-21 09:15:00");
    assert_eq!(etb(&app, &admin, e).await.len(), 1);
}
