//! Anlass der Hilfeleistung an einer Person (LLH-1566, Konzept LLH-1562 Abschnitt 5.1): ein
//! voller Stand je Eintrag aus einem festen Katalog, der jüngste ist aktuell, leer hebt auf.
//! Kein ETB-Eintrag, das Live-Ereignis nennt nur Einsatz und Person (LLH-1109).

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, fremde_org_anlegen, login_cookie, person_anlegen,
    recv_until_tag, rolle_setzen, setup_mit_pool, setup_mit_pool_und_live, system_etb_inhalte,
};

/// Jetzt plus `versatz_sek` als Wire-Zeitstempel (UTC, `YYYY-MM-DD HH:MM:SS`).
fn zeit(versatz_sek: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(versatz_sek))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage(app, "POST", pfad, cookie, Some(&body.to_string())).await
}

fn pfad(e: i64, p: i64) -> String {
    format!("/api/einsaetze/{e}/personen/{p}/anlass")
}

async fn detail(app: &axum::Router, cookie: &str, e: i64, p: i64) -> Value {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

/// Kein ETB-Text darf den Anlass nennen, auch nicht als Katalogwert oder Wort.
async fn etb_ohne_anlass(app: &axum::Router, cookie: &str, e: i64) {
    for text in system_etb_inhalte(app, cookie, e).await {
        let klein = text.to_lowercase();
        for wort in [
            "anlass",
            "intox",
            "psychisch",
            "verletzung",
            "hitze",
            "allergie",
        ] {
            assert!(!klein.contains(wort), "Anlass im ETB ({wort}): {text}");
        }
    }
}

#[tokio::test]
async fn festgelegter_anlass_steht_in_liste_detail_und_verlauf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (s, v) = post(&app, &admin, &pfad(e, p), json!({"anlass": "intoxikation"})).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["anlass"], "intoxikation");
    assert!(
        v["erfasst_von"].is_i64() && v["zeitpunkt_at"].is_string() && v["erfasst_at"].is_string()
    );

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["anlass"], "intoxikation");
    assert_eq!(liste[0]["anlass_at"], v["zeitpunkt_at"]);

    // Ändern: ein neuer Stand, der Verlauf zeigt beide.
    let (s, _) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"anlass": "internistisch"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["anlass"], "internistisch");
    let verlauf: Vec<&str> = d["anlaesse"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["anlass"].as_str().unwrap())
        .collect();
    assert_eq!(
        verlauf,
        ["internistisch", "intoxikation"],
        "jüngster zuerst"
    );
    etb_ohne_anlass(&app, &admin, e).await;
}

#[tokio::test]
async fn leerer_anlass_hebt_auf_und_bleibt_im_verlauf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (s, _) = post(&app, &admin, &pfad(e, p), json!({"anlass": "verletzung"})).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, v) = post(&app, &admin, &pfad(e, p), json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert!(v.get("anlass").is_none(), "{v}");

    let d = detail(&app, &admin, e, p).await;
    assert!(
        d.get("anlass").is_none() && d.get("anlass_at").is_none(),
        "{d}"
    );
    assert_eq!(d["anlaesse"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn anlass_geht_mit_der_anlage_und_nie_ins_etb() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(&json!({"sichtung": "sk3", "anlass": "allergie", "client_id": "auf-1"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["anlass"], "allergie", "die Antwort trägt den Anlass");
    let p = v["id"].as_i64().unwrap();

    // Ein Replay legt keinen zweiten Stand an.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(&json!({"sichtung": "sk3", "anlass": "allergie", "client_id": "auf-1"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let d = detail(&app, &admin, e, p).await;
    let verlauf = d["anlaesse"].as_array().unwrap();
    assert_eq!(verlauf.len(), 1, "{d}");
    assert_eq!(
        verlauf[0]["zeitpunkt_at"], d["erfasst_at"],
        "zur Erfassungszeit der Anlage"
    );
    etb_ohne_anlass(&app, &admin, e).await;

    // Unbekannt ist das Feld (400), vermisst der Zusammenhang (422).
    for (body, soll) in [
        (json!({"anlass": "kopfweh"}), StatusCode::BAD_REQUEST),
        (
            json!({"anlass": "psychisch", "status": "vermisst"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, v) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/personen"),
            &admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, soll, "{body}: {v}");
    }
}

#[tokio::test]
async fn live_kanal_nennt_nur_einsatz_und_person() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let mut rx = live.abonniere(e);
    let (s, _) = post(&app, &admin, &pfad(e, p), json!({"anlass": "psychisch"})).await;
    assert_eq!(s, StatusCode::CREATED);
    let person = recv_until_tag(&mut rx, "person", Duration::from_secs(2)).await;
    assert!(!person.data.contains("psychisch"), "{}", person.data);
    let v: Value = serde_json::from_str(&person.data).unwrap();
    assert_eq!(
        v.as_object().unwrap().len(),
        2,
        "nur einsatz_id und person_id: {v}"
    );
}

#[tokio::test]
async fn beobachter_darf_nicht_und_fremde_org_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let beob = benutzer_anlegen(&app, &admin, "beobacht", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob = login_cookie(&app, "beobacht", "beobachtpw1").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    for cookie in [&beob, &fremd] {
        let (s, v) = post(&app, cookie, &pfad(e, p), json!({"anlass": "sonstiges"})).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    }
    assert!(detail(&app, &admin, e, p).await["anlaesse"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn unbekannter_anlass_und_zukunft_sind_400() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    for body in [
        json!({"anlass": "kopfweh"}),
        json!({"anlass": "Intoxikation"}),
        json!({"anlass": "neurologisch", "zeitpunkt_at": zeit(600)}),
    ] {
        let (s, v) = post(&app, &admin, &pfad(e, p), body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    assert!(detail(&app, &admin, e, p).await["anlaesse"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn storniert_409_vermisst_und_abgemeldet_422() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let storniert = person_anlegen(&app, &admin, e, "{}").await;
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{storniert}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, v) = post(
        &app,
        &admin,
        &pfad(e, storniert),
        json!({"anlass": "verletzung"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");

    for status in ["vermisst", "abgemeldet"] {
        let p = person_anlegen(&app, &admin, e, "{}").await;
        let (s, _) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/personen/{p}/status"),
            &admin,
            Some(&json!({"status": status}).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let (s, v) = post(&app, &admin, &pfad(e, p), json!({"anlass": "verletzung"})).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{status}: {v}");
    }
}

#[tokio::test]
async fn replay_derselben_client_id_legt_einen_stand_an() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let andere = person_anlegen(&app, &admin, e, "{}").await;
    let body = json!({"anlass": "neurologisch", "client_id": "an-1"});
    let (s1, v1) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    let (s2, v2) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    assert_eq!((s1, s2), (StatusCode::CREATED, StatusCode::CREATED));
    assert_eq!(
        v1["id"], v2["id"],
        "der Replay liefert den gespeicherten Stand"
    );
    assert_eq!(
        detail(&app, &admin, e, p).await["anlaesse"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let (s, v) = post(&app, &admin, &pfad(e, andere), body.clone()).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Schlüssel einer anderen Person: {v}"
    );

    // Nach dem Abschluss kommt der Replay noch zurück, ein neuer Stand nicht mehr.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, replay) = post(&app, &admin, &pfad(e, p), body).await;
    assert_eq!(s, StatusCode::CREATED, "{replay}");
    assert_eq!(replay["id"], v1["id"]);
    let (s, _) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"anlass": "sonstiges", "client_id": "an-2"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn nachgereichter_aelterer_anlass_aendert_den_cache_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    sqlx::query("UPDATE einsatz_person SET erfasst_at = ? WHERE id = ?")
        .bind(zeit(-1800))
        .bind(p)
        .execute(&pool)
        .await
        .unwrap();
    let (s, aktuell) = post(&app, &admin, &pfad(e, p), json!({"anlass": "verletzung"})).await;
    assert_eq!(s, StatusCode::CREATED);
    let frueh = zeit(-1200);
    let (s, v) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"anlass": "hitze_kaelte", "zeitpunkt_at": frueh, "client_id": "off-1"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["zeitpunkt_at"], frueh.as_str(), "die Erfassungszeit gilt");

    let d = detail(&app, &admin, e, p).await;
    assert_eq!(
        d["anlass"], "verletzung",
        "der jüngste Stand bleibt aktuell"
    );
    assert_eq!(d["anlass_at"], aktuell["zeitpunkt_at"]);
    assert_eq!(d["anlaesse"][1]["anlass"], "hitze_kaelte");
}
