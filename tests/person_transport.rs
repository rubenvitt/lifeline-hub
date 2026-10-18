//! Transport einer Person (LLH-1325, Change `y18v58dt-pat-kern`, Spec `personen-transport`,
//! design.md D2/D5/D6): ein voller Stand je Eintrag, der jüngste ist aktuell, nur ein
//! Prioritätswechsel steht im ETB, Art und Fachrichtung nie in ETB oder Live-Kanal.

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

/// Verlegt das Anlegen der Person in die Vergangenheit, damit ein nachgereichter Stand nicht auf
/// das Anlegen gekappt wird.
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

fn pfad(e: i64, p: i64) -> String {
    format!("/api/einsaetze/{e}/personen/{p}/transport")
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

/// Die ETB-Systemtexte, die eine Transportpriorität nennen.
async fn transport_etb(app: &axum::Router, cookie: &str, e: i64) -> Vec<String> {
    system_etb_inhalte(app, cookie, e)
        .await
        .into_iter()
        .filter(|i| i.contains("Transport"))
        .collect()
}

#[tokio::test]
async fn festgelegter_stand_steht_in_liste_detail_und_verlauf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (s, v) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"prioritaet": "dringlich", "art": "liegend", "fachrichtung": "unfallchirurgie"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["prioritaet"], "dringlich");
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
    let zeile = &liste[0];
    assert_eq!(zeile["transport_prioritaet"], "dringlich");
    assert_eq!(zeile["transport_art"], "liegend");
    assert_eq!(zeile["transport_fachrichtung"], "unfallchirurgie");
    assert_eq!(zeile["transport_at"], v["zeitpunkt_at"]);

    let d = detail(&app, &admin, e, p).await;
    assert_eq!(d["transport_prioritaet"], "dringlich");
    let verlauf = d["transporte"].as_array().unwrap();
    assert_eq!(verlauf.len(), 1);
    assert_eq!(verlauf[0]["id"], v["id"]);
    assert_eq!(verlauf[0]["art"], "liegend");
}

#[tokio::test]
async fn drei_leere_felder_heben_den_transport_auf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let (s, _) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"prioritaet": "dringlich", "art": "sitzend"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, v) = post(&app, &admin, &pfad(e, p), json!({})).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    let d = detail(&app, &admin, e, p).await;
    for feld in [
        "transport_prioritaet",
        "transport_art",
        "transport_fachrichtung",
        "transport_at",
    ] {
        assert!(d.get(feld).is_none(), "{feld} fehlt nach dem Aufheben: {d}");
    }
    let verlauf = d["transporte"].as_array().unwrap();
    assert_eq!(verlauf.len(), 2, "die Aufhebung steht im Verlauf");
    assert!(verlauf[0].get("prioritaet").is_none() && verlauf[0].get("art").is_none());
    assert_eq!(
        transport_etb(&app, &admin, e).await,
        [
            "Person R-001: Transportpriorität aufgehoben",
            "Person R-001: Transportpriorität dringlich"
        ]
    );
}

#[tokio::test]
async fn nur_ein_prioritaetswechsel_schreibt_ins_etb() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(
        &app,
        &admin,
        e,
        r#"{"name":"Mustermann","vorname":"Erika"}"#,
    )
    .await;
    for body in [
        json!({"prioritaet": "dringlich", "art": "liegend", "fachrichtung": "unfallchirurgie"}),
        // nur die Fachrichtung
        json!({"prioritaet": "dringlich", "art": "liegend", "fachrichtung": "verbrennung"}),
        // nur die Art
        json!({"prioritaet": "dringlich", "art": "mit_notarzt", "fachrichtung": "verbrennung"}),
        // ohne Priorität, aber mit Art: die Priorität ist aufgehoben
        json!({"art": "mit_notarzt"}),
        json!({"art": "sitzend"}),
        json!({"prioritaet": "sofort", "art": "sitzend", "fachrichtung": "psychiatrie"}),
    ] {
        let (s, v) = post(&app, &admin, &pfad(e, p), body).await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let etb = transport_etb(&app, &admin, e).await;
    assert_eq!(
        etb,
        [
            "Person R-001: Transportpriorität sofort",
            "Person R-001: Transportpriorität aufgehoben",
            "Person R-001: Transportpriorität dringlich",
        ],
        "kein Eintrag für einen reinen Art- oder Fachrichtungswechsel"
    );
    // Pseudonym: weder Name noch Art noch Fachrichtung im ETB.
    for i in system_etb_inhalte(&app, &admin, e).await {
        for wort in [
            "Mustermann",
            "Erika",
            "liegend",
            "sitzend",
            "mit_notarzt",
            "Notarzt",
            "unfallchirurgie",
            "Unfallchirurgie",
            "verbrennung",
            "Verbrennung",
            "psychiatrie",
            "Psychiatrie",
        ] {
            assert!(!i.contains(wort), "ETB-Leak ({wort}): {i}");
        }
    }
}

#[tokio::test]
async fn live_kanal_traegt_etb_und_person_ohne_art_und_fachrichtung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let mut rx = live.abonniere(e);
    let (s, _) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"prioritaet": "sofort", "art": "liegend", "fachrichtung": "geburtshilfe"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let etb = recv_until_tag(&mut rx, "etb", Duration::from_secs(2)).await;
    let person = recv_until_tag(&mut rx, "person", Duration::from_secs(2)).await;
    for n in [&etb, &person] {
        for wort in ["liegend", "geburtshilfe", "sofort"] {
            assert!(!n.data.contains(wort), "Live-Leak ({wort}): {}", n.data);
        }
    }
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
        let (s, v) = post(&app, cookie, &pfad(e, p), json!({"prioritaet": "sofort"})).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    }
    assert!(detail(&app, &admin, e, p).await["transporte"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn unbekannter_katalogwert_ist_400() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    for body in [
        json!({"prioritaet": "eilig"}),
        json!({"art": "fliegend"}),
        json!({"fachrichtung": "zahnmedizin"}),
    ] {
        let (s, v) = post(&app, &admin, &pfad(e, p), body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    let (s, _) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"prioritaet": "normal", "zeitpunkt_at": zeit(600)}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Zukunft");
    assert!(detail(&app, &admin, e, p).await["transporte"]
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
        json!({"prioritaet": "sofort"}),
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
        let (s, v) = post(&app, &admin, &pfad(e, p), json!({"prioritaet": "sofort"})).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{status}: {v}");
    }
}

#[tokio::test]
async fn replay_derselben_client_id_legt_einen_stand_und_einen_etb_eintrag_an() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    let andere = person_anlegen(&app, &admin, e, "{}").await;
    let body = json!({"prioritaet": "dringlich", "client_id": "tr-1"});
    let (s1, v1) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    let (s2, v2) = post(&app, &admin, &pfad(e, p), body.clone()).await;
    assert_eq!(
        (s1, s2),
        (StatusCode::CREATED, StatusCode::CREATED),
        "{v1} {v2}"
    );
    assert_eq!(
        v1["id"], v2["id"],
        "der Replay liefert den gespeicherten Stand"
    );
    assert_eq!(
        detail(&app, &admin, e, p).await["transporte"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        transport_etb(&app, &admin, e).await.len(),
        1,
        "kein zweiter ETB-Eintrag"
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
        json!({"prioritaet": "sofort", "client_id": "tr-2"}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn nachgereichter_aelterer_stand_aendert_den_cache_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e, "{}").await;
    angelegt_vor(&pool, p, 30).await;
    let (s, aktuell) = post(
        &app,
        &admin,
        &pfad(e, p),
        json!({"prioritaet": "sofort", "art": "liegend"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    // Vor 20 min ohne Netz „normal“ vorgemerkt, vor 10 min „normal, sitzend“.
    let frueh = zeit(-1200);
    let spaeter = zeit(-600);
    for (t, body, cid) in [
        (&frueh, json!({"prioritaet": "normal"}), "off-1"),
        (
            &spaeter,
            json!({"prioritaet": "normal", "art": "sitzend"}),
            "off-2",
        ),
    ] {
        let mut body = body;
        body["zeitpunkt_at"] = json!(t);
        body["client_id"] = json!(cid);
        let (s, v) = post(&app, &admin, &pfad(e, p), body).await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        assert_eq!(v["zeitpunkt_at"], t.as_str(), "die Erfassungszeit gilt");
    }

    let d = detail(&app, &admin, e, p).await;
    assert_eq!(
        d["transport_prioritaet"], "sofort",
        "der jüngste Stand bleibt aktuell"
    );
    assert_eq!(d["transport_art"], "liegend");
    assert_eq!(d["transport_at"], aktuell["zeitpunkt_at"]);
    let folge: Vec<&str> = d["transporte"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["zeitpunkt_at"].as_str().unwrap())
        .collect();
    assert_eq!(
        folge,
        [
            aktuell["zeitpunkt_at"].as_str().unwrap(),
            spaeter.as_str(),
            frueh.as_str()
        ],
        "zeitliche Folge, jüngster zuerst"
    );

    // Der erste Nachtrag wechselt die Priorität (vorher keine), der zweite nicht.
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    let nachtraege: Vec<&Value> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|z| z["inhalt"].as_str().unwrap().contains("nachgetragen"))
        .collect();
    assert_eq!(nachtraege.len(), 1, "{etb}");
    assert_eq!(
        nachtraege[0]["inhalt"],
        "Person R-001: Transportpriorität normal, nachgetragen"
    );
    assert_eq!(
        nachtraege[0]["ereigniszeit"],
        frueh.as_str(),
        "ETB trägt die Erfassungszeit"
    );
    assert!(
        !transport_etb(&app, &admin, e)
            .await
            .iter()
            .any(|i| i == "Person R-001: Transportpriorität normal"),
        "kein Eintrag, der den aktuellen Stand behauptet"
    );
}
