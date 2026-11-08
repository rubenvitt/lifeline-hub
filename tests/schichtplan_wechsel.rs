//! Integrationstests der Wechsel aus dem Schichtplan an einer UHS und in der Pause (LLH-1555
//! Welle 2, Change `qo0amhd5-wechsel-aus-schichtplan`, design.md D6/D7, Spec
//! `kraefte-schichtplan` „Wechsel an der UHS“ und „Pause aus dem Plan“).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

fn plan(e: i64) -> String {
    format!("/api/einsaetze/{e}/abloesungen/schichtplan")
}

fn wechsel_pfad(e: i64, bid: i64) -> String {
    format!("{}/bloecke/{bid}/wechsel", plan(e))
}

fn ruecknahme_pfad(e: i64, wid: i64) -> String {
    format!("{}/wechsel/{wid}/zuruecknehmen", plan(e))
}

async fn uhs_anlegen(app: &axum::Router, cookie: &str, e: i64, bez: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/uhs"),
        cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

async fn adhoc(app: &axum::Router, cookie: &str, e: i64, name: &str) -> i64 {
    let (s, p) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/personal"),
        cookie,
        Some(&json!({"adhoc": {"name": name}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    p["id"].as_i64().unwrap()
}

async fn an_uhs(app: &axum::Router, cookie: &str, e: i64, uhs: i64, ep: i64) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{e}/uhs/{uhs}/kraefte/{ep}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn kraft(app: &axum::Router, cookie: &str, e: i64, ep: i64) -> Value {
    let (_, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/personal"),
        cookie,
        None,
    )
    .await;
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == ep)
        .cloned()
        .unwrap_or_else(|| panic!("Kraft {ep} fehlt: {liste}"))
}

/// Die Kraft einer Stamm-Person im Einsatz (`None` = nicht disponiert).
async fn kraft_von_stamm(app: &axum::Router, cookie: &str, e: i64, pid: i64) -> Option<Value> {
    let (_, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/personal"),
        cookie,
        None,
    )
    .await;
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["personal_id"] == pid)
        .cloned()
}

async fn block(app: &axum::Router, cookie: &str, e: i64, posten: Value, personen: Value) -> i64 {
    let (s, p) = anfrage_json(
        app,
        "POST",
        &format!("{}/bloecke", plan(e)),
        cookie,
        Some(&json!({"posten": posten, "von": "2026-11-14 18:00:00",
                     "bis": "2026-11-14 22:00:00", "personen": personen})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    p["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["posten"] == posten || b["posten"]["art"] == posten["art"])
        .unwrap()["id"]
        .as_i64()
        .unwrap()
}

async fn vorlage(app: &axum::Router, cookie: &str, e: i64, bid: i64) -> Value {
    let (s, v) = anfrage(app, "GET", &wechsel_pfad(e, bid), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

async fn vollziehen(app: &axum::Router, cookie: &str, e: i64, bid: i64, body: Value) -> Value {
    let (s, v) = anfrage_json(app, "POST", &wechsel_pfad(e, bid), cookie, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v
}

async fn zuruecknehmen(app: &axum::Router, cookie: &str, e: i64, wid: i64) -> Value {
    let (s, v) = anfrage(app, "POST", &ruecknahme_pfad(e, wid), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

fn namen(liste: &Value) -> Vec<String> {
    liste
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_string())
        .collect()
}

/// Die Zeitachse einer Kraft als (art, quelle, gestrichen).
async fn zeitachse(pool: &sqlx::SqlitePool, ep: i64) -> Vec<(String, String, bool)> {
    sqlx::query_as(
        "SELECT art, quelle, gestrichen_at IS NOT NULL FROM einsatz_kraft_zeitachse \
         WHERE personal_id = ? ORDER BY id",
    )
    .bind(ep)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn ereignis(art: &str, quelle: &str, gestrichen: bool) -> (String, String, bool) {
    (art.to_string(), quelle.to_string(), gestrichen)
}

/// Der jüngste ETB-Eintrag, der `nadel` enthält.
async fn etb_letzter(pool: &sqlx::SqlitePool, e: i64, nadel: &str) -> String {
    sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND instr(inhalt, ?) > 0 \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(e)
    .bind(nadel)
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or_else(|| panic!("kein ETB mit «{nadel}»"))
}

async fn status_id(app: &axum::Router, cookie: &str, label: &str) -> i64 {
    let (_, liste) = anfrage(app, "GET", "/api/personal-status", cookie, None).await;
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == label)
        .unwrap_or_else(|| panic!("Status {label} fehlt: {liste}"))["id"]
        .as_i64()
        .unwrap()
}

async fn status_setzen(app: &axum::Router, cookie: &str, e: i64, ep: i64, status: i64) {
    let (s, v) = anfrage_json(
        app,
        "PATCH",
        &format!("/api/einsaetze/{e}/personal/{ep}"),
        cookie,
        Some(&json!({"status_id": status})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Spec-Szenario „UHS Markt um 18:00“: Anna und Dana an der UHS, der Block hat Dana und Ben (aus
/// den Stammdaten, noch nicht im Einsatz). Danach Rücknahme und neuer Vollzug.
#[tokio::test]
async fn uhs_markt_um_1800() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let markt = uhs_anlegen(&app, &admin, e, "Markt").await;
    let anna = adhoc(&app, &admin, e, "Anna").await;
    let dana = adhoc(&app, &admin, e, "Dana").await;
    an_uhs(&app, &admin, e, markt, anna).await;
    an_uhs(&app, &admin, e, markt, dana).await;
    let ben = stammpersonal_anlegen(&app, &admin, "Ben").await;
    let bid = block(
        &app,
        &admin,
        e,
        json!({"art": "uhs", "uhs_id": markt}),
        json!([{"art": "einsatz", "einsatz_personal_id": dana},
               {"art": "stamm", "personal_id": ben}]),
    )
    .await;

    let v = vorlage(&app, &admin, e, bid).await;
    assert_eq!(v["art"], "uhs", "{v}");
    assert_eq!(v["uhs"], "Markt");
    assert_eq!(v["zeitpunkt"], "2026-11-14 18:00:00");
    assert_eq!(namen(&v["kommen"]), ["Ben"]);
    assert!(v["kommen"][0]["einsatz_personal_id"].is_null());
    assert_eq!(namen(&v["gehen"]), ["Anna"]);
    assert_eq!(namen(&v["bleiben"]), ["Dana"]);
    assert!(v["gesperrt"].is_null());

    let w = vollziehen(
        &app,
        &admin,
        e,
        bid,
        json!({"art": "uhs", "vollzogen_at": "2026-11-14 18:00:00",
               "kommen": [{"art": "stamm", "personal_id": ben}], "gehen": [anna]}),
    )
    .await;
    assert_eq!(w["art"], "uhs");
    assert_eq!(w["planschicht_id"], bid);
    let ben_kraft = kraft_von_stamm(&app, &admin, e, ben)
        .await
        .expect("Ben ist übernommen");
    let ben_ep = ben_kraft["id"].as_i64().unwrap();
    assert_eq!(ben_kraft["uhs_id"], markt);
    assert_eq!(kraft(&app, &admin, e, dana).await["uhs_id"], markt);
    assert!(kraft(&app, &admin, e, anna).await["uhs_id"].is_null());
    assert_eq!(
        etb_letzter(&pool, e, "Wechsel UHS").await,
        "Wechsel UHS «Markt»: Geht «Anna». Kommt «Ben». Bleibt «Dana». \
         Aus dem Schichtplan in den Einsatz übernommen: «Ben»."
    );
    // Ohne Einheit: Anna wird abgelöst, Ben trifft ein (Quelle `abloesung`); Dana ohne Ereignis.
    assert!(zeitachse(&pool, anna)
        .await
        .contains(&ereignis("abloesung", "abloesung", false)));
    assert!(zeitachse(&pool, ben_ep)
        .await
        .contains(&ereignis("eintreffen", "abloesung", false)));
    assert!(!zeitachse(&pool, dana)
        .await
        .iter()
        .any(|(_, q, _)| q == "abloesung"));

    // Ein zweites Mal: 409. Die Vorlage nennt den Wechsel.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, bid),
        &admin,
        Some(&json!({"art": "uhs"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let v = vorlage(&app, &admin, e, bid).await;
    assert!(v["art"].is_null(), "{v}");
    assert_eq!(v["wechsel"][0]["id"], w["id"]);

    // Rücknahme: Anna zurück, Ben bleibt im Einsatz ohne UHS, die Ereignisse sind gestrichen.
    let wid = w["id"].as_i64().unwrap();
    let r = zuruecknehmen(&app, &admin, e, wid).await;
    assert!(r["zurueckgenommen_at"].is_string());
    assert_eq!(kraft(&app, &admin, e, anna).await["uhs_id"], markt);
    let ben_kraft = kraft(&app, &admin, e, ben_ep).await;
    assert!(ben_kraft["uhs_id"].is_null());
    assert!(ben_kraft["beendet_at"].is_null(), "{ben_kraft}");
    assert!(zeitachse(&pool, anna)
        .await
        .contains(&ereignis("abloesung", "abloesung", true)));
    assert!(zeitachse(&pool, ben_ep)
        .await
        .contains(&ereignis("eintreffen", "abloesung", true)));
    let text = etb_letzter(&pool, e, "zurückgenommen").await;
    assert!(text.starts_with("Wechsel UHS «Markt» ("), "{text}");
    assert!(
        text.ends_with("zurückgenommen. Im Einsatz bleiben, ohne UHS: «Ben»."),
        "{text}"
    );
    let (s, _) = anfrage(&app, "POST", &ruecknahme_pfad(e, wid), &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT, "schon zurückgenommen");

    // Danach ist der Wechsel wieder offen; Ben ist jetzt eine Kraft des Einsatzes.
    let v = vorlage(&app, &admin, e, bid).await;
    assert_eq!(v["art"], "uhs");
    assert_eq!(v["kommen"][0]["einsatz_personal_id"], ben_ep);
    vollziehen(
        &app,
        &admin,
        e,
        bid,
        json!({"art": "uhs", "kommen": [{"art": "stamm", "personal_id": ben}],
               "gehen": [anna]}),
    )
    .await;
    assert_eq!(
        etb_letzter(&pool, e, "Wechsel UHS").await,
        "Wechsel UHS «Markt»: Geht «Anna». Kommt «Ben». Bleibt «Dana»."
    );
}

/// Wer zu einer Einheit gehört, folgt ihrer Periode und behält sie; wer von einer anderen UHS
/// kommt, wechselt und geht bei der Rücknahme dorthin zurück — aber nur, solange er noch so
/// steht, wie der Wechsel ihn hinterließ.
#[tokio::test]
async fn uhs_einheit_bleibt_und_ruecknahme_nur_beim_stand_des_wechsels() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let markt = uhs_anlegen(&app, &admin, e, "Markt").await;
    let bahnhof = uhs_anlegen(&app, &admin, e, "Bahnhof").await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let eva = adhoc(&app, &admin, e, "Eva").await;
    let (s, j) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/einheiten/{rtw}/personal/{eva}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{j:?}");
    let finn = adhoc(&app, &admin, e, "Finn").await;
    an_uhs(&app, &admin, e, bahnhof, finn).await;
    let gero = adhoc(&app, &admin, e, "Gero").await;
    an_uhs(&app, &admin, e, bahnhof, gero).await;
    let vorher_eva = zeitachse(&pool, eva).await;

    let bid = block(
        &app,
        &admin,
        e,
        json!({"art": "uhs", "uhs_id": markt}),
        json!([{"art": "einsatz", "einsatz_personal_id": eva},
               {"art": "einsatz", "einsatz_personal_id": finn},
               {"art": "einsatz", "einsatz_personal_id": gero}]),
    )
    .await;
    let v = vorlage(&app, &admin, e, bid).await;
    assert_eq!(namen(&v["kommen"]), ["Eva", "Finn", "Gero"]);
    assert_eq!(v["kommen"][1]["andere_uhs"], "Bahnhof");
    let w = vollziehen(
        &app,
        &admin,
        e,
        bid,
        json!({"art": "uhs", "kommen": [
            {"art": "einsatz", "einsatz_personal_id": eva},
            {"art": "einsatz", "einsatz_personal_id": finn},
            {"art": "einsatz", "einsatz_personal_id": gero}]}),
    )
    .await;
    let eva_kraft = kraft(&app, &admin, e, eva).await;
    assert_eq!(eva_kraft["uhs_id"], markt);
    assert_eq!(eva_kraft["einheit_id"], rtw, "die Einheit bleibt");
    assert_eq!(
        zeitachse(&pool, eva).await,
        vorher_eva,
        "mit Einheit kein eigenes Ereignis"
    );
    assert_eq!(kraft(&app, &admin, e, finn).await["uhs_id"], markt);

    // Gero geht von Hand weiter; die Rücknahme lässt ihn dort.
    an_uhs(&app, &admin, e, bahnhof, gero).await;
    zuruecknehmen(&app, &admin, e, w["id"].as_i64().unwrap()).await;
    assert!(kraft(&app, &admin, e, eva).await["uhs_id"].is_null());
    assert_eq!(kraft(&app, &admin, e, eva).await["einheit_id"], rtw);
    assert_eq!(kraft(&app, &admin, e, finn).await["uhs_id"], bahnhof);
    assert_eq!(kraft(&app, &admin, e, gero).await["uhs_id"], bahnhof);

    // Gehen nur, wer an dieser UHS steht; niemand kommt und geht zugleich.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, bid),
        &admin,
        Some(&json!({"art": "uhs", "gehen": [finn]})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    an_uhs(&app, &admin, e, markt, finn).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, bid),
        &admin,
        Some(&json!({"art": "uhs", "gehen": [finn],
                     "kommen": [{"art": "einsatz", "einsatz_personal_id": finn}]})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

/// Spec-Szenario „Pause zurück“ und: das Ende gibt nur zurück, wer noch „Pause“ trägt; die
/// Rücknahme in umgekehrter Reihenfolge.
#[tokio::test]
async fn pause_zurueck() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let im_einsatz = status_id(&app, &admin, "im Einsatz").await;
    let alarmiert = status_id(&app, &admin, "alarmiert").await;
    let pause = status_id(&app, &admin, "Pause").await;
    let anna = adhoc(&app, &admin, e, "Anna").await;
    status_setzen(&app, &admin, e, anna, im_einsatz).await;
    let ben = adhoc(&app, &admin, e, "Ben").await;
    status_setzen(&app, &admin, e, ben, im_einsatz).await;
    let cora = stammpersonal_anlegen(&app, &admin, "Cora").await;
    let bid = block(
        &app,
        &admin,
        e,
        json!({"art": "pause"}),
        json!([{"art": "einsatz", "einsatz_personal_id": anna},
               {"art": "einsatz", "einsatz_personal_id": ben},
               {"art": "stamm", "personal_id": cora}]),
    )
    .await;

    let v = vorlage(&app, &admin, e, bid).await;
    assert_eq!(v["art"], "pause_beginn", "{v}");
    assert_eq!(v["pause_status"], "Pause");
    assert_eq!(namen(&v["kommen"]), ["Anna", "Ben"]);
    assert_eq!(namen(&v["uebersprungen"]), ["Cora"]);
    let beginn = vollziehen(&app, &admin, e, bid, json!({"art": "pause_beginn"})).await;
    assert_eq!(kraft(&app, &admin, e, anna).await["status_id"], pause);
    assert_eq!(kraft(&app, &admin, e, ben).await["status_id"], pause);
    assert!(kraft_von_stamm(&app, &admin, e, cora).await.is_none());
    let text = etb_letzter(&pool, e, "Pause laut Plan ab").await;
    assert!(
        text.ends_with(": «Anna», «Ben» auf «Pause». Nicht im Einsatz: «Cora»."),
        "{text}"
    );

    // Ben wechselt von Hand; das Ende lässt ihn so.
    status_setzen(&app, &admin, e, ben, alarmiert).await;
    let v = vorlage(&app, &admin, e, bid).await;
    assert_eq!(v["art"], "pause_ende");
    assert_eq!(v["zeitpunkt"], "2026-11-14 22:00:00");
    assert_eq!(namen(&v["kommen"]), ["Anna"]);
    assert_eq!(v["kommen"][0]["status_zurueck"], "im Einsatz");
    assert_eq!(namen(&v["uebersprungen"]), ["Ben"]);
    let ende = vollziehen(&app, &admin, e, bid, json!({"art": "pause_ende"})).await;
    assert_eq!(kraft(&app, &admin, e, anna).await["status_id"], im_einsatz);
    assert_eq!(kraft(&app, &admin, e, ben).await["status_id"], alarmiert);
    let text = etb_letzter(&pool, e, "Pause laut Plan bis").await;
    assert!(
        text.ends_with("beendet: «Anna» wieder «im Einsatz»."),
        "{text}"
    );
    let v = vorlage(&app, &admin, e, bid).await;
    assert!(v["art"].is_null(), "{v}");

    // Rücknahme: erst das Ende, dann der Beginn.
    let (s, _) = anfrage(
        &app,
        "POST",
        &ruecknahme_pfad(e, beginn["id"].as_i64().unwrap()),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    zuruecknehmen(&app, &admin, e, ende["id"].as_i64().unwrap()).await;
    assert_eq!(kraft(&app, &admin, e, anna).await["status_id"], pause);
    zuruecknehmen(&app, &admin, e, beginn["id"].as_i64().unwrap()).await;
    assert_eq!(kraft(&app, &admin, e, anna).await["status_id"], im_einsatz);
    assert_eq!(
        kraft(&app, &admin, e, ben).await["status_id"],
        alarmiert,
        "Ben trägt nicht mehr den Stand des Wechsels"
    );
    let text = etb_letzter(&pool, e, "Beginn der Pause laut Plan").await;
    assert!(
        text.ends_with("zurückgenommen: «Anna» wieder «im Einsatz»."),
        "{text}"
    );
}

/// Ohne gekennzeichneten Status ist die Pause gesperrt; das Kennzeichen wandert, ein Ende ohne
/// Beginn ist 422.
#[tokio::test]
async fn pause_kennzeichen_und_sperren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let pause = status_id(&app, &admin, "Pause").await;
    let abgemeldet = status_id(&app, &admin, "abgemeldet").await;
    let anna = adhoc(&app, &admin, e, "Anna").await;
    let bid = block(
        &app,
        &admin,
        e,
        json!({"art": "pause"}),
        json!([{"art": "einsatz", "einsatz_personal_id": anna}]),
    )
    .await;

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, bid),
        &admin,
        Some(&json!({"art": "pause_ende"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/personal-status/{pause}"),
        &admin,
        Some(&json!({"pause": false})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["pause"], false);
    let v = vorlage(&app, &admin, e, bid).await;
    assert!(v["pause_status"].is_null());
    assert_eq!(
        v["gesperrt"],
        "Kein Personalstatus ist als Pause gekennzeichnet"
    );
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, bid),
        &admin,
        Some(&json!({"art": "pause_beginn"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Das Kennzeichen an „abgemeldet“, dann wieder an „Pause“: es wandert.
    for (id, ziel) in [(abgemeldet, "abgemeldet"), (pause, "Pause")] {
        let (s, v) = anfrage_json(
            &app,
            "PATCH",
            &format!("/api/personal-status/{id}"),
            &admin,
            Some(&json!({"pause": true})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let (_, liste) = anfrage(&app, "GET", "/api/personal-status", &admin, None).await;
        let markiert: Vec<&str> = liste
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["pause"] == true)
            .map(|s| s["label"].as_str().unwrap())
            .collect();
        assert_eq!(markiert, [ziel]);
    }
    vollziehen(&app, &admin, e, bid, json!({"art": "pause_beginn"})).await;
    assert_eq!(kraft(&app, &admin, e, anna).await["status_id"], pause);
}

/// Der Posten muss zur Art passen, die Felder der UHS gelten nur dort, und die Module gelten.
#[tokio::test]
async fn posten_felder_und_rechte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let markt = uhs_anlegen(&app, &admin, e, "Markt").await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let an_uhs_block = block(
        &app,
        &admin,
        e,
        json!({"art": "uhs", "uhs_id": markt}),
        json!([]),
    )
    .await;
    let an_einheit = block(
        &app,
        &admin,
        e,
        json!({"art": "einheit", "einheit_id": rtw}),
        json!([]),
    )
    .await;
    let pause_block = block(&app, &admin, e, json!({"art": "pause"}), json!([])).await;

    let (s, _) = anfrage(&app, "GET", &wechsel_pfad(e, an_einheit), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    for (bid, body, erwartet) in [
        (
            an_einheit,
            json!({"art": "uhs"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            pause_block,
            json!({"art": "uhs"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            an_uhs_block,
            json!({"art": "pause_beginn"}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            an_uhs_block,
            json!({"art": "tausch"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            pause_block,
            json!({"art": "pause_beginn", "gehen": [1]}),
            StatusCode::BAD_REQUEST,
        ),
        (9_999, json!({"art": "uhs"}), StatusCode::NOT_FOUND),
    ] {
        let (s, v) = anfrage_json(&app, "POST", &wechsel_pfad(e, bid), &admin, Some(&body)).await;
        assert_eq!(s, erwartet, "{body} → {v}");
    }

    // Ohne Unfallhilfsstellen: kein UHS-Wechsel, die Pause geht; ohne Personal keiner.
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let sperren = |modul: &'static str| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            let (s, _) = anfrage(
                &app,
                "PUT",
                &format!("/api/einsaetze/{e}/modul-overrides/{modul}"),
                &admin,
                Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
            )
            .await;
            assert_eq!(s, StatusCode::OK);
        }
    };
    sperren("unfallhilfsstellen").await;
    assert_eq!(
        anfrage(&app, "GET", &wechsel_pfad(e, an_uhs_block), &frieda, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, an_uhs_block),
        &frieda,
        Some(&json!({"art": "uhs"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        anfrage(&app, "GET", &wechsel_pfad(e, pause_block), &frieda, None)
            .await
            .0,
        StatusCode::OK
    );
    sperren("personal").await;
    assert_eq!(
        anfrage(&app, "GET", &wechsel_pfad(e, pause_block), &frieda, None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, pause_block),
        &frieda,
        Some(&json!({"art": "pause_beginn"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

/// Review #1213: eine begonnene Pause hält ihren Block fest (Löschen und Verschieben aus der
/// Zeile „Pause“ sind 409), ein leerer Status vor der Pause kommt zurück, und kommen darf nur, wer
/// jetzt im Block steht.
#[tokio::test]
async fn offene_pause_leerer_status_und_fremde_kommende() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anna = adhoc(&app, &admin, e, "Anna").await;
    sqlx::query("UPDATE einsatz_personal SET status_id = NULL WHERE id = ?")
        .bind(anna)
        .execute(&pool)
        .await
        .unwrap();
    let bid = block(
        &app,
        &admin,
        e,
        json!({"art": "pause"}),
        json!([{"art": "einsatz", "einsatz_personal_id": anna}]),
    )
    .await;
    let beginn = vollziehen(&app, &admin, e, bid, json!({"art": "pause_beginn"})).await;
    let pause = status_id(&app, &admin, "Pause").await;
    assert_eq!(kraft(&app, &admin, e, anna).await["status_id"], pause);

    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("{}/bloecke/{bid}?version=1", plan(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    let markt = uhs_anlegen(&app, &admin, e, "Markt").await;
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/bloecke/{bid}", plan(e)),
        &admin,
        Some(&json!({"version": 1, "posten": {"art": "uhs", "uhs_id": markt}})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");

    // Ende: der leere Stand kommt zurück; Rücknahme des Endes setzt wieder „Pause“.
    let ende = vollziehen(&app, &admin, e, bid, json!({"art": "pause_ende"})).await;
    assert!(kraft(&app, &admin, e, anna).await["status_id"].is_null());
    zuruecknehmen(&app, &admin, e, ende["id"].as_i64().unwrap()).await;
    assert_eq!(kraft(&app, &admin, e, anna).await["status_id"], pause);
    // Rücknahme des Beginns: ebenso leer.
    zuruecknehmen(&app, &admin, e, beginn["id"].as_i64().unwrap()).await;
    assert!(kraft(&app, &admin, e, anna).await["status_id"].is_null());
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("{}/bloecke/{bid}?version=1", plan(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");

    // Kommen nur aus dem Block.
    let ben = adhoc(&app, &admin, e, "Ben").await;
    let finn = adhoc(&app, &admin, e, "Finn").await;
    let uhs_block = block(
        &app,
        &admin,
        e,
        json!({"art": "uhs", "uhs_id": markt}),
        json!([{"art": "einsatz", "einsatz_personal_id": ben}]),
    )
    .await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &wechsel_pfad(e, uhs_block),
        &admin,
        Some(&json!({"art": "uhs", "kommen": [{"art": "einsatz", "einsatz_personal_id": finn}]})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(kraft(&app, &admin, e, finn).await["uhs_id"].is_null());
}
