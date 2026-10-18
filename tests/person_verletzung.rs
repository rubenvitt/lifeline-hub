//! Verletzungen am Körperschema (LLH-1113, Change `y18v58dt-pat-kern`, Spec
//! `personen-verletzungen`, design.md D1/D4/D5): Katalog 400, Paare aus Ansicht und Region 422,
//! Aufheben genau einmal, kein ETB, das Live-Ereignis nennt nur Einsatz und Person; am UHS-Gerät
//! nur an Personen der eigenen UHS.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, fremde_org_anlegen, login_cookie, person_anlegen,
    rolle_setzen, setup_mit_optionen_auf, setup_mit_pool, setup_mit_pool_und_live,
    system_etb_inhalte,
};

fn zeit(versatz_sek: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(versatz_sek))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> (StatusCode, Value) {
    anfrage(app, "POST", pfad, cookie, Some(&body.to_string())).await
}

fn pfad(e: i64, p: i64) -> String {
    format!("/api/einsaetze/{e}/personen/{p}/verletzungen")
}

fn aufheben_pfad(e: i64, p: i64, v: &Value) -> String {
    format!("{}/{}/aufheben", pfad(e, p), v["id"])
}

fn unterarm() -> Value {
    json!({"ansicht": "vorn", "region": "unterarm_l", "art": "fraktur_verdacht"})
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

async fn verletzungen(app: &axum::Router, cookie: &str, e: i64, p: i64) -> Vec<Value> {
    detail(app, cookie, e, p).await["verletzungen"]
        .as_array()
        .unwrap()
        .clone()
}

#[tokio::test]
async fn fraktur_verdacht_am_unterarm_links_vorn() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let mut body = unterarm();
    body["schwere"] = json!("mittel");
    body["x"] = json!(0.31);
    body["y"] = json!(0.44);
    body["notiz"] = json!("  Fehlstellung  ");
    let (s, v) = post(&app, &admin, &pfad(e, p), body).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let liste = verletzungen(&app, &admin, e, p).await;
    assert_eq!(liste.len(), 1);
    let d = &liste[0];
    assert_eq!(d["id"], v["id"]);
    assert_eq!(d["ansicht"], "vorn");
    assert_eq!(d["region"], "unterarm_l");
    assert_eq!(d["art"], "fraktur_verdacht");
    assert_eq!(d["schwere"], "mittel");
    assert_eq!((d["x"].as_f64(), d["y"].as_f64()), (Some(0.31), Some(0.44)));
    assert_eq!(d["notiz"], "Fehlstellung", "getrimmt");
    assert!(d["zeitpunkt_at"].is_string() && d["erfasst_von"].is_i64());
    assert!(d.get("aufgehoben_at").is_none());

    // Ohne Schwere, Lage und Notiz.
    let (s, v) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"ansicht": "hinten", "region": "ruecken", "art": "prellung_schwellung"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    for feld in ["schwere", "x", "y", "notiz"] {
        assert!(v.get(feld).is_none(), "{feld}: {v}");
    }
    assert_eq!(
        verletzungen(&app, &admin, e, p).await.len(),
        2,
        "in Erfassungsfolge"
    );
}

#[tokio::test]
async fn katalog_und_lage_sind_400() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let mit = |feld: &str, wert: Value| {
        let mut b = unterarm();
        b[feld] = wert;
        b
    };
    let lange_notiz = "x".repeat(lifeline_hub::person::VERLETZUNG_NOTIZ_MAX + 1);
    for (fall, body) in [
        ("Art biss", mit("art", json!("biss"))),
        ("Region", mit("region", json!("schulter_l"))),
        ("Ansicht", mit("ansicht", json!("seite"))),
        ("Schwere", mit("schwere", json!("kritisch"))),
        ("ohne Art", json!({"ansicht": "vorn", "region": "kopf"})),
        ("x > 1", {
            let mut b = mit("x", json!(1.2));
            b["y"] = json!(0.5);
            b
        }),
        ("y < 0", {
            let mut b = mit("x", json!(0.2));
            b["y"] = json!(-0.01);
            b
        }),
        ("Notiz zu lang", mit("notiz", json!(lange_notiz))),
        ("Zukunft", mit("zeitpunkt_at", json!(zeit(600)))),
    ] {
        let (s, v) = post(&app, &admin, &pfad(e, p), body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{fall}: {v}");
    }
    let genau = mit(
        "notiz",
        json!("y".repeat(lifeline_hub::person::VERLETZUNG_NOTIZ_MAX)),
    );
    let (s, v) = post(&app, &admin, &pfad(e, p), genau).await;
    assert_eq!(s, StatusCode::CREATED, "Notiz an der Grenze: {v}");
    assert_eq!(verletzungen(&app, &admin, e, p).await.len(), 1);
}

#[tokio::test]
async fn region_ohne_ansicht_und_halbe_lage_sind_422() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    for (ansicht, region) in [
        ("vorn", "ruecken"),
        ("vorn", "wirbelsaeule"),
        ("vorn", "gesaess"),
        ("hinten", "gesicht"),
        ("hinten", "thorax"),
        ("hinten", "abdomen"),
        ("hinten", "becken"),
    ] {
        let (s, v) = post(
            &app,
            &admin,
            &pfad(e, p),
            json!({"ansicht": ansicht, "region": region, "art": "schmerz"}),
        )
        .await;
        assert_eq!(
            s,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{region} {ansicht}: {v}"
        );
    }
    let mut halb = unterarm();
    halb["x"] = json!(0.5);
    let (s, v) = post(&app, &admin, &pfad(e, p), halb).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "nur x: {v}");
    assert!(
        verletzungen(&app, &admin, e, p).await.is_empty(),
        "nichts gespeichert"
    );
    // Beide Ansichten kennen Kopf, Hals und die Gliedmaßen.
    for ansicht in ["vorn", "hinten"] {
        for region in ["kopf", "hals", "hand_r", "fuss_l"] {
            let (s, v) = post(
                &app,
                &admin,
                &pfad(e, p),
                json!({"ansicht": ansicht, "region": region, "art": "schmerz"}),
            )
            .await;
            assert_eq!(s, StatusCode::CREATED, "{region} {ansicht}: {v}");
        }
    }
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
    let (s, v) = post(&app, &admin, &pfad(e, storniert), unterarm()).await;
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
        let (s, v) = post(&app, &admin, &pfad(e, p), unterarm()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{status}: {v}");
    }
}

#[tokio::test]
async fn beobachter_darf_nicht_und_fremde_org_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (_, v) = post(&app, &admin, &pfad(e, p), unterarm()).await;
    let beob = benutzer_anlegen(&app, &admin, "beobacht", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob = login_cookie(&app, "beobacht", "beobachtpw1").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    for cookie in [&beob, &fremd] {
        let (s, x) = post(&app, cookie, &pfad(e, p), unterarm()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{x}");
        let (s, x) = post(&app, cookie, &aufheben_pfad(e, p, &v), json!({})).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{x}");
    }
    let liste = verletzungen(&app, &admin, e, p).await;
    assert_eq!(liste.len(), 1);
    assert!(liste[0].get("aufgehoben_at").is_none());
}

#[tokio::test]
async fn aufheben_genau_einmal_auch_gleichzeitig() {
    let (_dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, _pool, _live) =
        setup_mit_optionen_auf(pool, lifeline_hub::app::RouterOptionen::default()).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let andere = person_anlegen(&app, &admin, e, "{}").await;

    let (_, v) = post(&app, &admin, &pfad(e, p), unterarm()).await;
    let (s, x) = post(&app, &admin, &aufheben_pfad(e, andere, &v), json!({})).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "an einer anderen Person: {x}");
    let (s, a) = post(&app, &admin, &aufheben_pfad(e, p, &v), json!({})).await;
    assert_eq!(s, StatusCode::OK, "{a}");
    assert!(a["aufgehoben_at"].is_string() && a["aufgehoben_von_id"].is_i64());
    let (s, x) = post(&app, &admin, &aufheben_pfad(e, p, &v), json!({})).await;
    assert_eq!(s, StatusCode::CONFLICT, "zweites Aufheben: {x}");
    let liste = verletzungen(&app, &admin, e, p).await;
    assert_eq!(
        liste[0]["aufgehoben_at"], a["aufgehoben_at"],
        "die Zeile bleibt, als aufgehoben"
    );

    // Zwei Arbeitsplätze zugleich: genau eines gelingt.
    for _ in 0..5 {
        let (_, v) = post(&app, &admin, &pfad(e, p), unterarm()).await;
        let ziel = aufheben_pfad(e, p, &v);
        let ((s1, v1), (s2, v2)) = tokio::join!(
            post(&app, &admin, &ziel, json!({})),
            post(&app, &admin, &ziel, json!({}))
        );
        let mut status = [s1, s2];
        status.sort();
        assert_eq!(status, [StatusCode::OK, StatusCode::CONFLICT], "{v1} {v2}");
    }
}

#[tokio::test]
async fn leak_probe_weder_etb_noch_live_kanal_nennt_region_art_oder_notiz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let etb_vorher = system_etb_inhalte(&app, &admin, e).await;
    let mut rx = live.abonniere(e);
    let (s, v) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"ansicht": "vorn", "region": "thorax", "art": "wunde_blutung",
               "notiz": "offene Wunde", "x": 0.5, "y": 0.3}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, _) = post(&app, &admin, &aufheben_pfad(e, p, &v), json!({})).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        system_etb_inhalte(&app, &admin, e).await,
        etb_vorher,
        "kein ETB"
    );
    let mut personen = 0;
    while let Ok(n) = rx.try_recv() {
        for wort in ["thorax", "wunde", "Wunde", "offene"] {
            assert!(!n.data.contains(wort), "Live-Leak ({wort}): {}", n.data);
        }
        assert_ne!(n.event.as_str(), "etb", "kein ETB-Ereignis");
        if n.event.as_str() == "person" {
            let x: Value = serde_json::from_str(&n.data).unwrap();
            assert_eq!(
                x.as_object().unwrap().len(),
                2,
                "nur Einsatz und Person: {x}"
            );
            personen += 1;
        }
    }
    assert_eq!(personen, 2, "je ein Ereignis für Erfassen und Aufheben");
}

#[tokio::test]
async fn replay_derselben_client_id_legt_eine_verletzung_an() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let andere = person_anlegen(&app, &admin, e, "{}").await;
    sqlx::query("UPDATE einsatz_person SET erfasst_at = ? WHERE id = ?")
        .bind(zeit(-3600))
        .bind(p)
        .execute(&pool)
        .await
        .unwrap();
    let mut body = unterarm();
    body["client_id"] = json!("v-1");
    let vorgemerkt = zeit(-900);
    body["zeitpunkt_at"] = json!(vorgemerkt);
    let (s1, v1) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    let (s2, v2) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    assert_eq!(
        (s1, s2),
        (StatusCode::CREATED, StatusCode::CREATED),
        "{v1} {v2}"
    );
    assert_eq!(v1["id"], v2["id"]);
    assert_eq!(
        v1["zeitpunkt_at"],
        vorgemerkt.as_str(),
        "die Erfassungszeit gilt"
    );
    assert_eq!(verletzungen(&app, &admin, e, p).await.len(), 1);
    let (s, v) = post(&app, &admin, &pfad(e, andere), body.clone()).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

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
    assert_eq!(
        s,
        StatusCode::CREATED,
        "Replay vor dem Aktiv-Gate: {replay}"
    );
    assert_eq!(replay["id"], v1["id"]);
    let mut neu = unterarm();
    neu["client_id"] = json!("v-2");
    let (s, _) = post(&app, &admin, &pfad(e, p), neu).await;
    assert_eq!(s, StatusCode::CONFLICT);
}
