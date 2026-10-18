//! Erfassungszeit, Idempotenz und „jüngster Stand gewinnt“ am Personen-Verlauf (LLH-1138,
//! Change `y18v58dt-pat-kern`, Spec `personen-verlauf`, design.md D5–D7): Sichtung, Verbleib und
//! Notiz nehmen `client_id` und `zeitpunkt_at` an. Ein Replay derselben `client_id` liefert den
//! gespeicherten Eintrag ohne zweiten ETB-Eintrag, eine nachgereichte ältere Sichtung steht im
//! Verlauf, ändert aber weder den Cache noch löst sie den Hinweis „Sichtung I“ aus.

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, person_anlegen, recv_until_tag,
    rolle_setzen, setup_mit_pool, setup_mit_pool_und_live, system_etb_inhalte,
};

/// Jetzt plus `versatz_sek` als Wire-Zeitstempel (UTC, `YYYY-MM-DD HH:MM:SS`).
fn zeit(versatz_sek: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(versatz_sek))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Verlegt das Anlegen der Person `minuten` in die Vergangenheit, damit ein nachgereichter
/// Eintrag nicht auf das Anlegen gekappt wird.
async fn angelegt_vor(pool: &sqlx::SqlitePool, person: i64, minuten: i64) {
    sqlx::query("UPDATE einsatz_person SET erfasst_at = ? WHERE id = ?")
        .bind(zeit(-60 * minuten))
        .bind(person)
        .execute(pool)
        .await
        .unwrap();
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage(app, "POST", pfad, cookie, Some(&body.to_string())).await
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

/// Die System-Einträge des ETB samt Ereigniszeit.
async fn system_etb(app: &axum::Router, cookie: &str, e: i64) -> Vec<Value> {
    let (_, v) = anfrage(app, "GET", &format!("/api/einsaetze/{e}/etb"), cookie, None).await;
    v.as_array()
        .unwrap()
        .iter()
        .filter(|z| z["typ"] == "system")
        .cloned()
        .collect()
}

async fn sichtung_eins_anzahl(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung WHERE art = 'sichtung_eins'")
        .fetch_one(pool)
        .await
        .unwrap()
}

// ---------- Sichtung (tasks.md 1.3) ----------

#[tokio::test]
async fn doppelte_client_id_ergibt_eine_sichtung_und_einen_etb_eintrag() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/sichtung");
    let body = json!({ "kategorie": "sk2", "client_id": "sicht-1" });
    let (s1, v1) = post(&app, &admin, &pfad, body.clone()).await;
    assert_eq!(s1, StatusCode::CREATED, "{v1}");
    let (s2, v2) = post(&app, &admin, &pfad, body).await;
    assert_eq!(s2, StatusCode::CREATED, "{v2}");
    assert_eq!(
        v1["id"], v2["id"],
        "der Replay liefert den gespeicherten Eintrag"
    );
    assert_eq!(
        detail(&app, &admin, e, p).await["sichtungen"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let sichtungen_im_etb = system_etb_inhalte(&app, &admin, e)
        .await
        .into_iter()
        .filter(|i| i.contains("Sichtung"))
        .count();
    assert_eq!(sichtungen_im_etb, 1, "kein zweiter ETB-Eintrag");
}

#[tokio::test]
async fn sichtung_replay_nach_abschluss_gelingt_neue_ist_409() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/sichtung");
    let (s, erst) = post(
        &app,
        &admin,
        &pfad,
        json!({ "kategorie": "sk3", "client_id": "a" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{erst}");
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, replay) = post(
        &app,
        &admin,
        &pfad,
        json!({ "kategorie": "sk3", "client_id": "a" }),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "Replay vor dem Aktiv-Gate: {replay}"
    );
    assert_eq!(replay["id"], erst["id"]);
    let (s, _) = post(
        &app,
        &admin,
        &pfad,
        json!({ "kategorie": "sk3", "client_id": "b" }),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "eine neue Sichtung am abgeschlossenen Einsatz"
    );
}

#[tokio::test]
async fn client_id_einer_anderen_person_ist_422() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let q = person_anlegen(&app, &admin, e, "{}").await;
    let body = json!({ "kategorie": "sk2", "client_id": "geteilt" });
    let (s, _) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{p}/sichtung"),
        body.clone(),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{q}/sichtung"),
        body,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(detail(&app, &admin, e, q).await["sichtungen"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn aeltere_sichtung_aendert_den_cache_nicht_und_meldet_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Ein zweites Mitglied liest das Modul Personen; der Auslöser selbst bekommt nie einen Hinweis.
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    rolle_setzen(&app, &admin, e, anna, "fuehrungspersonal").await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    angelegt_vor(&pool, p, 30).await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/sichtung");

    // 14:20 online SK II, danach kommt eine um 14:10 vorgemerkte SK I an.
    let (s, _) = post(&app, &admin, &pfad, json!({ "kategorie": "sk2" })).await;
    assert_eq!(s, StatusCode::CREATED);
    let vorgemerkt = zeit(-600);
    let (s, alt) = post(
        &app,
        &admin,
        &pfad,
        json!({ "kategorie": "sk1", "zeitpunkt_at": vorgemerkt, "client_id": "offline-1" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{alt}");
    assert_eq!(
        alt["gesichtet_at"],
        vorgemerkt.as_str(),
        "die Erfassungszeit gilt"
    );
    assert!(
        alt["eingegangen_at"].is_string(),
        "die Ankunft steht dabei: {alt}"
    );

    let d = detail(&app, &admin, e, p).await;
    assert_eq!(
        d["aktuelle_sichtung"], "sk2",
        "der jüngste Eintrag bleibt aktuell"
    );
    let verlauf: Vec<&str> = d["sichtungen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["kategorie"].as_str().unwrap())
        .collect();
    assert_eq!(verlauf, ["sk2", "sk1"], "zeitliche Folge, neueste zuerst");
    assert_eq!(
        sichtung_eins_anzahl(&pool).await,
        0,
        "kein Hinweis „Sichtung I“"
    );

    let etb = system_etb(&app, &admin, e).await;
    let nachtrag = etb
        .iter()
        .find(|z| z["inhalt"].as_str().unwrap().contains("Sichtung SK I,"))
        .unwrap_or_else(|| panic!("kein ETB zur nachgereichten Sichtung: {etb:?}"));
    assert_eq!(
        nachtrag["inhalt"],
        "Person R-001: Sichtung SK I, nachgetragen, aktuelle Sichtung bleibt SK II"
    );
    assert_eq!(
        nachtrag["ereigniszeit"],
        vorgemerkt.as_str(),
        "ETB trägt die Erfassungszeit"
    );

    // Gegenprobe: eine jüngere SK I wird aktuell und meldet.
    let (s, _) = post(&app, &admin, &pfad, json!({ "kategorie": "sk1" })).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(detail(&app, &admin, e, p).await["aktuelle_sichtung"], "sk1");
    assert_eq!(sichtung_eins_anzahl(&pool).await, 1);
}

#[tokio::test]
async fn juengere_vorgemerkte_sichtung_wird_aktuell_ohne_nachtrag() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    angelegt_vor(&pool, p, 30).await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/sichtung");
    let (s, _) = post(
        &app,
        &admin,
        &pfad,
        json!({ "kategorie": "sk3", "zeitpunkt_at": zeit(-1200) }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let vorgemerkt = zeit(-600);
    let (s, _) = post(
        &app,
        &admin,
        &pfad,
        json!({ "kategorie": "sk2", "zeitpunkt_at": vorgemerkt }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["aktuelle_sichtung"], "sk2");
    assert_eq!(d["aktuelle_sichtung_at"], vorgemerkt.as_str());
    let etb = system_etb(&app, &admin, e).await;
    let z = etb
        .iter()
        .find(|z| z["inhalt"] == "Person R-001: Sichtung SK II")
        .unwrap_or_else(|| panic!("{etb:?}"));
    assert_eq!(z["ereigniszeit"], vorgemerkt.as_str());
}

#[tokio::test]
async fn sichtung_vor_dem_anlegen_wird_auf_das_anlegen_gekappt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    angelegt_vor(&pool, p, 5).await;
    let angelegt: String = sqlx::query_scalar("SELECT erfasst_at FROM einsatz_person WHERE id = ?")
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{p}/sichtung"),
        json!({ "kategorie": "sk2", "zeitpunkt_at": zeit(-3600) }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["gesichtet_at"], angelegt.as_str());
}

#[tokio::test]
async fn sichtung_weit_in_der_zukunft_ist_400_und_speichert_nichts() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{p}/sichtung"),
        json!({ "kategorie": "sk2", "zeitpunkt_at": zeit(600) }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert!(detail(&app, &admin, e, p).await["sichtungen"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn sichtung_sendet_das_etb_live_ereignis() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let mut rx = live.abonniere(e);
    let (s, _) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{p}/sichtung"),
        json!({ "kategorie": "sk2" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    recv_until_tag(&mut rx, "etb", Duration::from_secs(1)).await;
}

// ---------- Verbleib (tasks.md 1.4) ----------

/// Einsatz mit aktiver UHS und einer Person darin (vor 30 Minuten angelegt). Liefert
/// (Einsatz, UHS, Person).
async fn person_in_uhs(
    app: &axum::Router,
    pool: &sqlx::SqlitePool,
    cookie: &str,
) -> (i64, i64, i64) {
    let e = einsatz_anlegen(app, cookie).await;
    let (s, uhs) = post(
        app,
        cookie,
        &format!("/api/einsaetze/{e}/uhs"),
        json!({ "typ": "behandlungsplatz", "bezeichnung": "BHP Mitte" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{uhs}");
    let u = uhs["id"].as_i64().unwrap();
    let (s, v) = post(
        app,
        cookie,
        &format!("/api/einsaetze/{e}/uhs/{u}/status"),
        json!({ "status": "aktiv" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, person) = post(
        app,
        cookie,
        &format!("/api/einsaetze/{e}/personen"),
        json!({ "uhs_id": u }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{person}");
    let p = person["id"].as_i64().unwrap();
    angelegt_vor(pool, p, 30).await;
    (e, u, p)
}

#[tokio::test]
async fn aelterer_verbleib_laesst_den_aktuellen_stehen_und_tritt_nicht_aus() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (e, _u, p) = person_in_uhs(&app, &pool, &admin).await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/verbleib");

    let (s, _) = post(&app, &admin, &pfad, json!({ "art": "vor_ort" })).await;
    assert_eq!(s, StatusCode::CREATED);
    let vorgemerkt = zeit(-600);
    let (s, alt) = post(
        &app,
        &admin,
        &pfad,
        json!({ "art": "transport", "ziel": "KH Mitte", "zeitpunkt_at": vorgemerkt, "client_id": "v-1" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{alt}");
    assert_eq!(alt["zeitpunkt_at"], vorgemerkt.as_str());
    assert!(alt["eingegangen_at"].is_string(), "{alt}");

    let d = detail(&app, &admin, e, p).await;
    assert_eq!(
        d["aktueller_verbleib"], "vor Ort",
        "die Kurzform kommt aus der gewinnenden Zeile"
    );
    assert_eq!(d["aktuelle_verbleib_art"], "vor_ort");
    assert!(
        d["aufenthalt"].is_object(),
        "die Person tritt nicht aus der UHS aus: {d}"
    );
    assert_eq!(d["verbleib"].as_array().unwrap().len(), 2);

    let etb = system_etb(&app, &admin, e).await;
    assert!(
        etb.iter()
            .all(|z| !z["inhalt"].as_str().unwrap().contains("verlässt")),
        "kein Austritt: {etb:?}"
    );
    let nachtrag = etb
        .iter()
        .find(|z| z["inhalt"] == "Person R-001: abtransportiert, nachgetragen")
        .unwrap_or_else(|| panic!("{etb:?}"));
    assert_eq!(nachtrag["ereigniszeit"], vorgemerkt.as_str());

    // Gegenprobe: ein jüngerer Transport gewinnt und nimmt die Person aus der UHS.
    let (s, _) = post(
        &app,
        &admin,
        &pfad,
        json!({ "art": "transport", "ziel": "KH Süd" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["aktueller_verbleib"], "Transport → KH Süd");
    assert!(d["aufenthalt"].is_null(), "{d}");
}

#[tokio::test]
async fn verbleib_replay_ist_idempotent_samt_austritt() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (e, _u, p) = person_in_uhs(&app, &pool, &admin).await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/verbleib");
    let body = json!({ "art": "transport", "zeitpunkt_at": zeit(-120), "client_id": "v-2" });
    let mut rx = live.abonniere(e);
    let (s1, v1) = post(&app, &admin, &pfad, body.clone()).await;
    assert_eq!(s1, StatusCode::CREATED, "{v1}");
    recv_until_tag(&mut rx, "etb", Duration::from_secs(1)).await;
    let (s2, v2) = post(&app, &admin, &pfad, body).await;
    assert_eq!(s2, StatusCode::CREATED, "{v2}");
    assert_eq!(v1["id"], v2["id"]);
    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["verbleib"].as_array().unwrap().len(), 1);
    assert!(d["aufenthalt"].is_null());
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(
        inhalte
            .iter()
            .filter(|i| i.contains("abtransportiert"))
            .count(),
        1,
        "{inhalte:?}"
    );
    assert_eq!(
        inhalte.iter().filter(|i| i.contains("verlässt")).count(),
        1,
        "{inhalte:?}"
    );
}

#[tokio::test]
async fn verbleib_weit_in_der_zukunft_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{p}/verbleib"),
        json!({ "art": "entlassung", "zeitpunkt_at": zeit(600) }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert!(detail(&app, &admin, e, p).await["verbleib"]
        .as_array()
        .unwrap()
        .is_empty());
}
