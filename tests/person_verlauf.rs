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

/// Einsatz mit aktiver UHS und einer Person darin (vor 30 Minuten angelegt und eingetreten). Liefert
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
    // Der Eintritt gehört zum Anlegen: ein nachgereichter Verbleib danach nimmt sie heraus.
    sqlx::query("UPDATE person_uhs_belegung SET zeitpunkt_at = ? WHERE person_id = ?")
        .bind(zeit(-60 * 30))
        .bind(p)
        .execute(pool)
        .await
        .unwrap();
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

/// Spec `personen-verlauf`, „Nachgereichter Verbleib vor der Wiederaufnahme“: ein vorgemerkter
/// Verbleib gewinnt unter den Verbleib-Einträgen, ist aber älter als die spätere Wiederaufnahme
/// in die UHS. Er wird aktueller Verbleib, nimmt die Person aber nicht aus der UHS.
#[tokio::test]
async fn nachgereichter_verbleib_vor_der_wiederaufnahme_tritt_nicht_aus() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (e, u, p) = person_in_uhs(&app, &pool, &admin).await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/verbleib");

    // 10:00 Transport (Austritt), 10:30 Wiederaufnahme, 10:15 vorgemerkte Entlassung kommt an.
    let (s, v) = post(
        &app,
        &admin,
        &pfad,
        json!({ "art": "transport", "zeitpunkt_at": zeit(-1200) }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert!(detail(&app, &admin, e, p).await["aufenthalt"].is_null());
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{p}/uhs-belegung"),
        json!({ "art": "eintritt", "uhs_id": u }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let vorgemerkt = zeit(-600);
    let (s, v) = post(
        &app,
        &admin,
        &pfad,
        json!({ "art": "entlassung", "zeitpunkt_at": vorgemerkt, "client_id": "v-3" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["aktuelle_verbleib_art"], "entlassung", "{d}");
    assert!(
        d["aufenthalt"].is_object(),
        "die wieder aufgenommene Person bleibt in der UHS: {d}"
    );
    let etb = system_etb(&app, &admin, e).await;
    assert_eq!(
        etb.iter()
            .filter(|z| z["inhalt"].as_str().unwrap().contains("verlässt"))
            .count(),
        1,
        "nur der Transport nimmt die Person heraus: {etb:?}"
    );
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

// ---------- Notiz (tasks.md 1.5) ----------

#[tokio::test]
async fn notiz_replay_steht_genau_einmal_im_verlauf() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    angelegt_vor(&pool, p, 30).await;
    let etb_vorher = system_etb(&app, &admin, e).await.len();
    let pfad = format!("/api/einsaetze/{e}/personen/{p}/notizen");
    let vorgemerkt = zeit(-300);
    let body =
        json!({ "text": "stabil, ansprechbar", "zeitpunkt_at": vorgemerkt, "client_id": "n-1" });
    let (s1, v1) = post(&app, &admin, &pfad, body.clone()).await;
    assert_eq!(s1, StatusCode::CREATED, "{v1}");
    assert_eq!(
        v1["erfasst_at"],
        vorgemerkt.as_str(),
        "die Erfassungszeit gilt"
    );
    assert!(v1["eingegangen_at"].is_string(), "{v1}");
    let (s2, v2) = post(&app, &admin, &pfad, body).await;
    assert_eq!(s2, StatusCode::CREATED, "{v2}");
    assert_eq!(v1["id"], v2["id"]);
    assert_eq!(
        detail(&app, &admin, e, p).await["notizen"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        system_etb(&app, &admin, e).await.len(),
        etb_vorher,
        "eine Notiz schreibt kein ETB"
    );
}

#[tokio::test]
async fn notiz_weit_in_der_zukunft_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen/{p}/notizen"),
        json!({ "text": "x", "zeitpunkt_at": zeit(600) }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert!(detail(&app, &admin, e, p).await["notizen"]
        .as_array()
        .unwrap()
        .is_empty());
}

// ---------- PAT-Nummer und Kontamination (tasks.md 2.1) ----------

#[tokio::test]
async fn pat_nummer_und_kontamination_einzeln_setzen_und_leeren() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(
        &app,
        &admin,
        e,
        r#"{"name":"Muster","zustand":"unterkühlt"}"#,
    )
    .await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}");
    let patch = |body: Value| {
        let app = app.clone();
        let admin = admin.clone();
        let pfad = pfad.clone();
        async move { anfrage(&app, "PATCH", &pfad, &admin, Some(&body.to_string())).await }
    };

    let (s, v) = patch(json!({ "pat_nummer": "  A-4711 " })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["pat_nummer"], "A-4711", "getrimmt");
    assert_eq!(v["name"], "Muster");
    assert_eq!(
        v["zustand"], "unterkühlt",
        "ein einzelnes Feld leert keine anderen"
    );
    assert!(
        !v.as_object().unwrap().contains_key("kontamination"),
        "keine Angabe: {v}"
    );

    let (s, v) = patch(json!({ "kontamination": false })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["kontamination"], false, "„nein“ ist eine Angabe");
    assert_eq!(v["pat_nummer"], "A-4711");

    let (s, v) = patch(json!({ "kontamination": true })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["kontamination"], true);

    let (s, v) = patch(json!({ "pat_nummer": null })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(!v.as_object().unwrap().contains_key("pat_nummer"), "{v}");
    assert_eq!(v["kontamination"], true, "die Kontamination bleibt");

    let (s, v) = patch(json!({ "kontamination": null })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(
        !v.as_object().unwrap().contains_key("kontamination"),
        "geleert: {v}"
    );
    assert_eq!(v["zustand"], "unterkühlt");

    let (s, _) = patch(json!({ "kontamination": "ja" })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "nur true, false oder null");
}

#[tokio::test]
async fn auswahl_traegt_die_pat_nummer() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let q = person_anlegen(&app, &admin, e, "{}").await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        Some(r#"{"pat_nummer":"4711"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/auswahl"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let zeilen = v.as_array().unwrap();
    let zeile = |id: i64| zeilen.iter().find(|z| z["id"] == id).unwrap();
    assert_eq!(zeile(p)["pat_nummer"], "4711");
    assert!(!zeile(q).as_object().unwrap().contains_key("pat_nummer"));
}

#[tokio::test]
async fn pat_nummer_ueber_der_grenze_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let pfad = format!("/api/einsaetze/{e}/personen/{p}");
    let max = lifeline_hub::person::PAT_NUMMER_MAX;
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "pat_nummer": "9".repeat(max + 1) }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(
        v["error"],
        format!("PAT-Nummer darf höchstens {max} Zeichen lang sein")
    );
    assert!(!detail(&app, &admin, e, p)
        .await
        .as_object()
        .unwrap()
        .contains_key("pat_nummer"));
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "pat_nummer": format!("  {}  ", "9".repeat(max)) }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "genau die Grenze, nach dem Trimmen: {v}");
}

// ---------- Aufnahme ohne Netz (LLH-1330) ----------

/// Verlegt den Beginn des Einsatzes `minuten` in die Vergangenheit, damit eine vorgemerkte
/// Aufnahme nicht auf ihn gekappt wird.
async fn einsatz_begonnen_vor(pool: &sqlx::SqlitePool, einsatz: i64, minuten: i64) {
    sqlx::query("UPDATE einsatz SET begonnen_at = ? WHERE id = ?")
        .bind(zeit(-60 * minuten))
        .bind(einsatz)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn vorgemerkte_aufnahme_traegt_ihre_erfassungszeit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    einsatz_begonnen_vor(&pool, e, 60).await;
    // Um 14:10 ohne Netz aufgenommen, um 14:30 übertragen.
    let vorgemerkt = zeit(-1200);
    let body = json!({
        "sichtung": "sk2",
        "zeitpunkt_at": vorgemerkt,
        "client_id": "aufnahme-1",
    });
    let pfad = format!("/api/einsaetze/{e}/personen");
    let (s, person) = post(&app, &admin, &pfad, body.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "{person}");
    let p = person["id"].as_i64().unwrap();
    assert_eq!(
        person["erfasst_at"],
        vorgemerkt.as_str(),
        "Anlage zur Erfassungszeit"
    );
    assert_eq!(person["aktuelle_sichtung_at"], vorgemerkt.as_str());

    let d = detail(&app, &admin, e, p).await;
    let sichtungen = d["sichtungen"].as_array().unwrap();
    assert_eq!(sichtungen.len(), 1);
    assert_eq!(
        sichtungen[0]["gesichtet_at"],
        vorgemerkt.as_str(),
        "die Erstsichtung trägt 14:10, nicht die Ankunft"
    );
    assert_ne!(
        sichtungen[0]["eingegangen_at"],
        vorgemerkt.as_str(),
        "die Ankunft steht dabei"
    );

    let etb = system_etb(&app, &admin, e).await;
    for inhalt in ["Person R-001 erfasst", "Person R-001: Sichtung SK II"] {
        let z = etb
            .iter()
            .find(|z| z["inhalt"] == inhalt)
            .unwrap_or_else(|| panic!("kein ETB „{inhalt}“: {etb:?}"));
        assert_eq!(
            z["ereigniszeit"],
            vorgemerkt.as_str(),
            "„{inhalt}“ steht zur Erfassungszeit im ETB (nachgetragen)"
        );
    }

    // Der Replay derselben Aufnahme legt nichts ein zweites Mal an.
    let (s, replay) = post(&app, &admin, &pfad, body).await;
    assert_eq!(s, StatusCode::CREATED, "{replay}");
    assert_eq!(replay["id"], p);
    assert_eq!(
        detail(&app, &admin, e, p).await["sichtungen"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(system_etb(&app, &admin, e).await.len(), etb.len());
}

#[tokio::test]
async fn aufnahme_ohne_zeitpunkt_traegt_die_serverzeit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    einsatz_begonnen_vor(&pool, e, 60).await;
    let vorher = zeit(-1);
    let (s, person) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen"),
        json!({ "sichtung": "sk3" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{person}");
    let erfasst = person["erfasst_at"].as_str().unwrap();
    assert!(
        erfasst >= vorher.as_str() && erfasst <= zeit(1).as_str(),
        "{erfasst}"
    );
    assert_eq!(person["aktuelle_sichtung_at"], erfasst);
}

#[tokio::test]
async fn aufnahme_vor_dem_einsatzbeginn_wird_auf_ihn_gekappt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    einsatz_begonnen_vor(&pool, e, 10).await;
    let beginn: String = sqlx::query_scalar("SELECT begonnen_at FROM einsatz WHERE id = ?")
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (s, person) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen"),
        json!({ "sichtung": "sk2", "zeitpunkt_at": zeit(-3600) }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{person}");
    assert_eq!(person["erfasst_at"], beginn.as_str());
    assert_eq!(person["aktuelle_sichtung_at"], beginn.as_str());
}

#[tokio::test]
async fn aufnahme_weit_in_der_zukunft_ist_400_und_legt_nichts_an() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen"),
        json!({ "sichtung": "sk2", "zeitpunkt_at": zeit(600) }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    let anzahl: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(anzahl, 0);
}

#[tokio::test]
async fn vorgemerkte_vermisstmeldung_gilt_ab_ihrer_erfassungszeit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    einsatz_begonnen_vor(&pool, e, 60).await;
    let vorgemerkt = zeit(-1200);
    let (s, person) = post(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/personen"),
        json!({ "status": "vermisst", "zeitpunkt_at": vorgemerkt }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{person}");
    assert_eq!(person["vermisst_seit"], vorgemerkt.as_str());
    assert_eq!(person["erfasst_at"], vorgemerkt.as_str());
}
