//! Einheit aus Vorlage bilden (LLH-1049, Spec `kraefte-disposition`, „Einheit aus Vorlage
//! bilden“, und `einheit-vorlagen`, „Vorschau im Einsatz“): `GET …/einheiten/aus-vorlage/{id}`
//! und `POST …/einheiten/aus-vorlage`. Die Regeln der Planung prüfen die Repo-Tests in
//! `src/einheit/aus_vorlage/tests.rs`; hier Statuscodes, Rechte, ETB und Ereignisse.

use axum::http::StatusCode;
use lifeline_hub::einheit_vorlage::repo::{self as vrepo, NewVorlage};
use lifeline_hub::einheit_vorlage::PersonalEntry;
use lifeline_hub::staerke::{Staerke, StaerkePosition};
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::*;

/// Der Demo-„Sanitätszug Musterstadt“ mit „Rettungsstaffel“ als Vorlage der Org des Admins.
struct Vorlage {
    zug: i64,
    staffel: i64,
    elw: i64,
    rtw1: i64,
    rtw2: i64,
    zugfuehrer: i64,
    funker: i64,
    notarzt: i64,
    notsan: i64,
    rettsan1: i64,
    rettsan2: i64,
}

async fn org_von(pool: &SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn typ_id(pool: &SqlitePool, org: i64, label: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM einheit_typ WHERE org_id = ? AND label = ?")
        .bind(org)
        .bind(label)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn fahrzeug(pool: &SqlitePool, org: i64, funkrufname: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (?, ?) RETURNING id")
        .bind(org)
        .bind(funkrufname)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn person(pool: &SqlitePool, org: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (?, ?) RETURNING id")
        .bind(org)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn neu<'a>(name: &'a str, typ: i64, ueber: Option<i64>, funkrufname: &'a str) -> NewVorlage<'a> {
    NewVorlage {
        name,
        typ_id: typ,
        ueber_vorlage_id: ueber,
        funkrufname: Some(funkrufname),
        tz_fachaufgabe: Some("rettungswesen"),
        tz_organisation: Some("hilfsorganisation"),
        soll: None,
        bemerkung: None,
        sortier: 0,
    }
}

fn eintrag(p: i64, f: i64, s: Option<StaerkePosition>) -> PersonalEntry {
    PersonalEntry {
        personal_id: p,
        fahrzeug_id: Some(f),
        staerke_position: s,
    }
}

async fn vorlage(pool: &SqlitePool, org: i64) -> Vorlage {
    let zug = vrepo::create(
        pool,
        org,
        NewVorlage {
            soll: Some(Staerke {
                fuehrer: 1,
                unterfuehrer: 2,
                mannschaft: 10,
            }),
            ..neu(
                "Sanitätszug Musterstadt",
                typ_id(pool, org, "Zug").await,
                None,
                "Rotkreuz Musterstadt 1",
            )
        },
    )
    .await
    .unwrap()
    .id;
    let staffel = vrepo::create(
        pool,
        org,
        neu(
            "Rettungsstaffel",
            typ_id(pool, org, "Staffel").await,
            Some(zug),
            "Rotkreuz Musterstadt 1/83",
        ),
    )
    .await
    .unwrap()
    .id;
    let elw = fahrzeug(pool, org, "ELW 1").await;
    let rtw1 = fahrzeug(pool, org, "RTW 1").await;
    let rtw2 = fahrzeug(pool, org, "RTW 2").await;
    let zugfuehrer = person(pool, org, "Zugführer Zander").await;
    let funker = person(pool, org, "Funker Fritz").await;
    let notarzt = person(pool, org, "Notarzt Nora").await;
    let notsan = person(pool, org, "Notsan Nils").await;
    let rettsan1 = person(pool, org, "Rettsan Rita").await;
    let rettsan2 = person(pool, org, "Rettsan Rolf").await;
    vrepo::replace_fahrzeuge(pool, org, zug, &[elw])
        .await
        .unwrap();
    vrepo::replace_fahrzeuge(pool, org, staffel, &[rtw1, rtw2])
        .await
        .unwrap();
    vrepo::replace_personal(
        pool,
        org,
        zug,
        &[
            eintrag(zugfuehrer, elw, Some(StaerkePosition::Fuehrer)),
            eintrag(funker, elw, None),
        ],
    )
    .await
    .unwrap();
    vrepo::replace_personal(
        pool,
        org,
        staffel,
        &[
            eintrag(notarzt, rtw1, None),
            eintrag(notsan, rtw1, None),
            eintrag(rettsan1, rtw2, None),
            eintrag(rettsan2, rtw2, None),
        ],
    )
    .await
    .unwrap();
    Vorlage {
        zug,
        staffel,
        elw,
        rtw1,
        rtw2,
        zugfuehrer,
        funker,
        notarzt,
        notsan,
        rettsan1,
        rettsan2,
    }
}

/// Der erste `gebunden`-Status trägt die Marke „alarmierung“: der Initialstatus geht in die
/// Zeitachse ein (wie bei einer neu angelegten Organisation).
async fn initialstatus_mit_marke(pool: &SqlitePool) {
    sqlx::query(
        "UPDATE personal_status SET zeitachse_marke = 'alarmierung' WHERE id = \
         (SELECT id FROM personal_status WHERE kategorie = 'gebunden' AND aktiv = 1 \
          ORDER BY sortier, id LIMIT 1)",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn vorschau(app: &axum::Router, cookie: &str, einsatz: i64, v: i64) -> (StatusCode, Value) {
    anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten/aus-vorlage/{v}"),
        cookie,
        None,
    )
    .await
}

async fn bilden(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: &Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten/aus-vorlage"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

fn fz(ids: &[i64]) -> Value {
    Value::Array(ids.iter().map(|id| json!({"fahrzeug_id": id})).collect())
}

fn pers(ids: &[i64]) -> Value {
    Value::Array(ids.iter().map(|id| json!({"personal_id": id})).collect())
}

async fn liste(app: &axum::Router, cookie: &str, einsatz: i64, art: &str) -> Vec<Value> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/{art}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    json.as_array().unwrap().clone()
}

/// Einheiten, Fahrzeuge und aktive Personen des Einsatzes, für „nichts angelegt“.
async fn bestand(app: &axum::Router, cookie: &str, einsatz: i64) -> (usize, usize, usize) {
    (
        liste(app, cookie, einsatz, "einheiten").await.len(),
        liste(app, cookie, einsatz, "fahrzeuge").await.len(),
        liste(app, cookie, einsatz, "personal").await.len(),
    )
}

/// Disponiert ein Stamm-Fahrzeug einzeln und ordnet es optional einer Einheit zu; liefert `ef_id`.
async fn fahrzeug_im_einsatz(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    fid: i64,
    einheit: Option<i64>,
) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        admin,
        Some(&format!(r#"{{"fahrzeug_id":{fid}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let ef = json["id"].as_i64().unwrap();
    if let Some(e) = einheit {
        let (s, _) = anfrage(
            app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{e}/fahrzeug/{ef}"),
            admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
    }
    ef
}

async fn zeitachse_je_kraft(pool: &SqlitePool, ep_id: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_kraft_zeitachse WHERE personal_id = ? AND gestrichen_at IS NULL",
    )
    .bind(ep_id)
    .fetch_one(pool)
    .await
    .unwrap()
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

#[tokio::test]
async fn sanitaetszug_mit_rettungsstaffel_in_einem_schritt() {
    let (app, pool) = setup_mit_pool().await;
    initialstatus_mit_marke(&pool).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, json) = vorschau(&app, &admin, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["vorlage_id"], v.zug);
    assert_eq!(json["fahrzeuge_gesperrt"], false);
    assert_eq!(json["personal_gesperrt"], false);
    let knoten = json["knoten"].as_array().unwrap();
    assert_eq!(knoten.len(), 2);
    assert!(knoten[0].get("ueber_vorlage_id").is_none());
    assert_eq!(knoten[1]["ueber_vorlage_id"], v.zug);
    assert_eq!(knoten[1]["fahrzeuge"][1]["funkrufname"], "RTW 2");
    assert_eq!(knoten[1]["fahrzeuge"][1]["zustand"], "neu");
    assert_eq!(knoten[0]["personal"][0]["staerke_position"], "fuehrer");
    assert_eq!(knoten[0]["personal"][0]["fahrzeug_id"], v.elw);
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({
            "vorlage_id": v.zug,
            "name": " 1. Zug ",
            "fahrzeuge": fz(&[v.elw, v.rtw1, v.rtw2]),
            "personal": pers(&[v.rettsan1, v.rettsan2]),
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let zug = json["einheit_id"].as_i64().unwrap();
    let staffel = json["einheit_ids"][1].as_i64().unwrap();
    assert_eq!(json["einheit_ids"], json!([zug, staffel]));
    assert_eq!(json["fahrzeuge"].as_array().unwrap().len(), 3);
    assert_eq!(json["personal"].as_array().unwrap().len(), 2);

    let einheiten = liste(&app, &admin, einsatz, "einheiten").await;
    let e = |id: i64| einheiten.iter().find(|e| e["id"] == id).unwrap().clone();
    let (z, st) = (e(zug), e(staffel));
    assert_eq!(z["name"], "1. Zug");
    assert_eq!(z["typ_label"], "Zug");
    assert_eq!(z["funkrufname"], "Rotkreuz Musterstadt 1");
    assert_eq!(z["tz_fachaufgabe"], "rettungswesen");
    assert_eq!(
        z["soll"],
        json!({"fuehrer":1,"unterfuehrer":2,"mannschaft":10})
    );
    assert_eq!(st["name"], "Rettungsstaffel");
    assert_eq!(st["ueber_einheit_id"], zug);
    assert_eq!(st["tz_organisation"], "hilfsorganisation");
    assert_eq!(st["funkrufname"], "Rotkreuz Musterstadt 1/83");
    assert_eq!(
        st["soll"],
        json!({"fuehrer":0,"unterfuehrer":1,"mannschaft":5})
    );

    let fahrzeuge = liste(&app, &admin, einsatz, "fahrzeuge").await;
    let einheit_von = |name: &str| {
        fahrzeuge
            .iter()
            .find(|f| f["funkrufname"] == name)
            .unwrap_or_else(|| panic!("{name} fehlt: {fahrzeuge:?}"))["einheit_id"]
            .clone()
    };
    assert_eq!(einheit_von("ELW 1"), zug);
    assert_eq!(einheit_von("RTW 1"), staffel);
    assert_eq!(einheit_von("RTW 2"), staffel);
    let ef_rtw2 = fahrzeuge
        .iter()
        .find(|f| f["funkrufname"] == "RTW 2")
        .unwrap()["id"]
        .clone();

    let personal = liste(&app, &admin, einsatz, "personal").await;
    assert_eq!(personal.len(), 2);
    for p in &personal {
        assert_eq!(p["einheit_id"], staffel, "{p}");
        assert_eq!(p["fahrzeug_id"], ef_rtw2, "{p}");
        assert_eq!(
            zeitachse_je_kraft(&pool, p["id"].as_i64().unwrap()).await,
            1,
            "Initialstatus in der Zeitachse: {p}"
        );
    }

    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 1
    );
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte.iter().any(|i| i
            == "Einheit «1. Zug» aus Vorlage «Sanitätszug Musterstadt» gebildet; Untereinheit: \
                «Rettungsstaffel»; 3 Fahrzeuge: ELW 1, RTW 1, RTW 2; 2 Kräfte: Rettsan Rita, \
                Rettsan Rolf"),
        "{inhalte:?}"
    );
}

#[tokio::test]
async fn gebundenes_fahrzeug_nur_mit_umhaengen() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zweiter = einheit_bilden(&app, &admin, einsatz, "2. Zug").await;
    let ef2 = fahrzeug_im_einsatz(&app, &admin, einsatz, v.rtw2, Some(zweiter)).await;

    let (s, json) = vorschau(&app, &admin, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK);
    let rtw2 = &json["knoten"][1]["fahrzeuge"][1];
    assert_eq!(rtw2["zustand"], "gebunden");
    assert_eq!(rtw2["einheit_name"], "2. Zug");
    assert_eq!(rtw2["ef_id"], ef2);

    let mut rx = live.abonniere(einsatz);
    let vorher = bestand(&app, &admin, einsatz).await;
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.zug, "fahrzeuge": fz(&[v.elw, v.rtw1, v.rtw2])}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert!(json["error"].is_string(), "{json}");
    assert_eq!(
        json["zeilen"],
        json!([{"art": "fahrzeug", "id": v.rtw2, "grund": "in «2. Zug»"}])
    );
    assert_eq!(
        bestand(&app, &admin, einsatz).await,
        vorher,
        "nichts angelegt"
    );
    assert_eq!(
        objekt_ereignisse(&mut rx, ZIELE),
        vec![],
        "keine Ereignisse"
    );

    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({
            "vorlage_id": v.zug,
            "fahrzeuge": [
                {"fahrzeug_id": v.elw},
                {"fahrzeug_id": v.rtw1},
                {"fahrzeug_id": v.rtw2, "umhaengen": true},
            ],
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let staffel = json["einheit_ids"][1].as_i64().unwrap();
    let rtw2 = liste(&app, &admin, einsatz, "fahrzeuge")
        .await
        .into_iter()
        .find(|f| f["id"] == ef2)
        .unwrap();
    assert_eq!(rtw2["einheit_id"], staffel);
    let ereignisse = objekt_ereignisse(&mut rx, ZIELE);
    assert!(
        ereignisse.contains(&("einheit".to_string(), zweiter)),
        "der 2. Zug erfährt das Umhängen: {ereignisse:?}"
    );
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|i| i.ends_with("umgehängt: RTW 2 aus «2. Zug»")),
        "{inhalte:?}"
    );
}

const ZIELE: &[(&str, &str)] = &[
    ("personal", "personal_id"),
    ("einheit", "einheit_id"),
    ("fahrzeug", "fahrzeug_id"),
    ("etb", "etb_id"),
];

/// Ereignisse für neue Einheiten, Fahrzeuge, Personen und den ETB-Eintrag folgen nach dem
/// Commit (Spec `kraefte-disposition`, „Ein ETB-Eintrag beim Bilden aus Vorlage“).
#[tokio::test]
async fn ereignisse_nach_dem_commit() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({
            "vorlage_id": v.zug,
            "fahrzeuge": fz(&[v.elw]),
            "personal": pers(&[v.zugfuehrer, v.funker]),
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let id = |pfad: &str, i: usize| json[pfad][i].as_i64().unwrap();
    let mut ereignisse = objekt_ereignisse(&mut rx, ZIELE);
    let etb = ereignisse.iter().filter(|(t, _)| t == "etb").count();
    ereignisse.retain(|(t, _)| t != "etb");
    ereignisse.sort();
    let mut erwartet = vec![
        ("einheit".to_string(), id("einheit_ids", 0)),
        ("einheit".to_string(), id("einheit_ids", 1)),
        ("fahrzeug".to_string(), id("fahrzeuge", 0)),
        ("personal".to_string(), id("personal", 0)),
        ("personal".to_string(), id("personal", 1)),
    ];
    erwartet.sort();
    assert_eq!(ereignisse, erwartet);
    assert_eq!(etb, 1, "genau ein ETB-Ereignis für den Sammeleintrag");
}

#[tokio::test]
async fn kraft_ausserhalb_der_vorlage_ist_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fremd = fahrzeug(&pool, org, "LF 1").await;
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.zug, "fahrzeuge": fz(&[v.elw, fremd])}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["zeilen"],
        json!([{"art": "fahrzeug", "id": fremd, "grund": "nicht in der Vorlage"}])
    );
    // Die Untervorlage allein kennt die Personen des Zugs nicht.
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.staffel, "personal": pers(&[v.notarzt, v.zugfuehrer])}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["zeilen"],
        json!([{"art": "personal", "id": v.zugfuehrer, "grund": "nicht in der Vorlage"}])
    );
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));
}

/// Alles oder nichts: steht die letzte gewählte Person außer Dienst, ist nichts angelegt.
#[tokio::test]
async fn letzte_person_ausser_dienst_legt_nichts_an() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/personal/{}/ausser-dienst", v.rettsan2),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({
            "vorlage_id": v.zug,
            "fahrzeuge": fz(&[v.elw, v.rtw1, v.rtw2]),
            "personal": pers(&[v.zugfuehrer, v.funker, v.notarzt, v.notsan, v.rettsan1, v.rettsan2]),
        }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["zeilen"],
        json!([{"art": "personal", "id": v.rettsan2, "grund": "außer Dienst"}])
    );
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);
    // In der Vorschau steht sie als außer Dienst.
    let (_, json) = vorschau(&app, &admin, einsatz, v.zug).await;
    let rolf = json["knoten"][1]["personal"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["personal_id"] == v.rettsan2)
        .unwrap()
        .clone();
    assert_eq!(rolf["zustand"], "ausser_dienst");
}

#[tokio::test]
async fn entlassene_person_wird_erneut_disponiert() {
    let (app, pool) = setup_mit_pool().await;
    initialstatus_mit_marke(&pool).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(&format!(r#"{{"personal_id":{}}}"#, v.notarzt)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let ep = json["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}/entlassen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let zeitachse_vorher = zeitachse_je_kraft(&pool, ep).await;
    let (_, json) = vorschau(&app, &admin, einsatz, v.staffel).await;
    assert_eq!(json["knoten"][0]["personal"][0]["zustand"], "entlassen");

    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.staffel, "personal": pers(&[v.notarzt])}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json["personal"], json!([ep]), "dieselbe Zeile");
    let staffel = json["einheit_id"].clone();
    let personal = liste(&app, &admin, einsatz, "personal").await;
    assert_eq!(personal.len(), 1);
    assert_eq!(personal[0]["einheit_id"], staffel);
    assert!(
        personal[0]["fahrzeug_id"].is_null(),
        "RTW 1 kommt nicht mit"
    );
    assert_eq!(zeitachse_je_kraft(&pool, ep).await, zeitachse_vorher + 1);
}

/// LLH-1236: ein entlassenes Fahrzeug der Vorlage kommt wieder mit, in derselben Zeile, und
/// trägt seine Besatzung aus der Vorlage.
#[tokio::test]
async fn entlassenes_fahrzeug_wird_wieder_aufgenommen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_im_einsatz(&app, &admin, einsatz, v.rtw1, None).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}/entlassen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, json) = vorschau(&app, &admin, einsatz, v.staffel).await;
    assert_eq!(json["knoten"][0]["fahrzeuge"][0]["fahrzeug_id"], v.rtw1);
    assert_eq!(json["knoten"][0]["fahrzeuge"][0]["zustand"], "entlassen");

    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({
            "vorlage_id": v.staffel,
            "fahrzeuge": fz(&[v.rtw1]),
            "personal": pers(&[v.notarzt]),
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json["fahrzeuge"], json!([ef]), "dieselbe Zeile");
    let staffel = json["einheit_id"].clone();
    let fahrzeuge = liste(&app, &admin, einsatz, "fahrzeuge").await;
    assert_eq!(fahrzeuge.len(), 1, "kein zweiter Datensatz");
    assert_eq!(fahrzeuge[0]["id"], ef);
    assert_eq!(fahrzeuge[0]["einheit_id"], staffel);
    let personal = liste(&app, &admin, einsatz, "personal").await;
    assert_eq!(personal[0]["fahrzeug_id"], ef, "Besatzung nach der Vorlage");
    let entlassene = liste(&app, &admin, einsatz, "fahrzeuge?entlassene=1").await;
    assert!(entlassene.is_empty(), "{entlassene:?}");
}

#[tokio::test]
async fn fremde_unbekannte_und_deaktivierte_vorlage() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (fremd_org, _) = fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw12", "keine").await;
    let fremd_typ: i64 = sqlx::query_scalar(
        "INSERT INTO einheit_typ (org_id, label) VALUES (?, 'Zug') RETURNING id",
    )
    .bind(fremd_org)
    .fetch_one(&pool)
    .await
    .unwrap();
    let fremd = vrepo::create(&pool, fremd_org, neu("Fremdzug", fremd_typ, None, "F 1"))
        .await
        .unwrap()
        .id;
    for vid in [fremd, 987_654] {
        let (s, _) = vorschau(&app, &admin, einsatz, vid).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        let (s, _) = bilden(&app, &admin, einsatz, &json!({"vorlage_id": vid})).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
    }
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einheit-vorlagen/{}", v.zug),
        &admin,
        Some(r#"{"aktiv":false}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let (s, _) = vorschau(&app, &admin, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = bilden(&app, &admin, einsatz, &json!({"vorlage_id": v.zug})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));
}

/// Eine Vorlage mit mehr als 20 Einheiten (D7) ist kein Eingabefehler, sondern ihr Zustand: 422
/// in Vorschau und Bilden, nichts angelegt. Mit genau 20 geht beides.
#[tokio::test]
async fn vorlage_mit_mehr_als_zwanzig_einheiten_ist_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let trupp = typ_id(&pool, org, "Staffel").await;
    // Zug und Staffel plus 18 Trupps ergeben 20 Einheiten.
    for i in 0..18 {
        let name = format!("Trupp {i}");
        let funk = format!("Trupp-Funk {i}");
        vrepo::create(&pool, org, neu(&name, trupp, Some(v.staffel), &funk))
            .await
            .unwrap();
    }
    let (s, json) = vorschau(&app, &admin, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["knoten"].as_array().unwrap().len(), 20);

    vrepo::create(
        &pool,
        org,
        neu("Trupp 21", trupp, Some(v.zug), "Trupp-Funk 21"),
    )
    .await
    .unwrap();
    let (s, json) = vorschau(&app, &admin, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(json["error"], "Vorlage hat mehr als 20 Einheiten");
    let body = json!({"vorlage_id": v.zug, "fahrzeuge": fz(&[v.elw])});
    let (s, json) = bilden(&app, &admin, einsatz, &body).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(json["error"], "Vorlage hat mehr als 20 Einheiten");
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));
}

#[tokio::test]
async fn gesperrte_module_403_und_leere_vorschau() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frieda_id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, frieda_id, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    nur_fuer_admins(&app, &admin, einsatz, "fahrzeuge").await;

    let (s, json) = vorschau(&app, &frieda, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["fahrzeuge_gesperrt"], true);
    assert_eq!(json["personal_gesperrt"], false);
    assert_eq!(json["knoten"][1]["fahrzeuge"], json!([]));
    assert_eq!(json["knoten"][1]["personal"].as_array().unwrap().len(), 4);

    let (s, json) = bilden(
        &app,
        &frieda,
        einsatz,
        &json!({"vorlage_id": v.zug, "fahrzeuge": fz(&[v.elw]), "personal": pers(&[v.funker])}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));
    // Ohne Fahrzeuge genügen Einheiten und Personal.
    let (s, json) = bilden(
        &app,
        &frieda,
        einsatz,
        &json!({"vorlage_id": v.zug, "personal": pers(&[v.funker])}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");

    nur_fuer_admins(&app, &admin, einsatz, "personal").await;
    let (s, json) = bilden(
        &app,
        &frieda,
        einsatz,
        &json!({"vorlage_id": v.staffel, "personal": pers(&[v.notarzt])}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");
}

#[tokio::test]
async fn beobachter_sieht_die_vorschau_und_bildet_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) = vorschau(&app, &erika, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = bilden(&app, &erika, einsatz, &json!({"vorlage_id": v.zug})).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let (s, _) = bilden(&app, &admin, einsatz, &json!({"vorlage_id": v.zug})).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn grenzen_sind_400_vor_jeder_abfrage() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // 51 Personen (auch als Dubletten) sind 400, auch bei unbekannter Vorlage.
    let zu_viel = pers(&[v.funker; 51]);
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": 987_654, "personal": zu_viel}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.zug, "fahrzeuge": fz(&[v.elw; 51])}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    let lang: String = "Z".repeat(201);
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.zug, "name": lang}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.zug, "name": "  "}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));
    // Genau 200 Zeichen und Dubletten unter der Grenze sind erlaubt; die erste Zeile gewinnt.
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({
            "vorlage_id": v.zug,
            "name": "Z".repeat(200),
            "fahrzeuge": fz(&[v.elw, v.elw]),
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json["fahrzeuge"].as_array().unwrap().len(), 1);
}

/// LLH-1261: Material der Vorlage. Die Staffel trägt 50 Wolldecken an der Einheit und einen
/// Sanitätsrucksack auf RTW 1; liefert die beiden Positionen.
async fn material_der_staffel(pool: &SqlitePool, org: i64, v: &Vorlage) -> (i64, i64) {
    let material = |bezeichnung: &'static str, art: &'static str| {
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO material (org_id, bezeichnung, art) VALUES (?, ?, ?) RETURNING id",
        )
        .bind(org)
        .bind(bezeichnung)
        .bind(art)
    };
    let decke = material("Wolldecke", "verbrauchsgut")
        .fetch_one(pool)
        .await
        .unwrap();
    let rucksack = material("Sanitätsrucksack", "geraet")
        .fetch_one(pool)
        .await
        .unwrap();
    let posten = |material_id, menge, fahrzeug_id| lifeline_hub::einheit_vorlage::MaterialEntry {
        material_id,
        menge,
        fahrzeug_id,
    };
    let s = vrepo::replace_material(
        pool,
        org,
        v.staffel,
        &[posten(decke, 50, None), posten(rucksack, 1, Some(v.rtw1))],
    )
    .await
    .unwrap();
    (s.material[0].id, s.material[1].id)
}

fn mat(ids: &[i64]) -> Value {
    Value::Array(
        ids.iter()
            .map(|id| json!({"vorlage_material_id": id}))
            .collect(),
    )
}

#[tokio::test]
async fn material_aus_der_vorlage_am_richtigen_ort_mit_einem_etb_eintrag() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let (decken, rucksack) = material_der_staffel(&pool, org, &v).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (s, json) = vorschau(&app, &admin, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["material_gesperrt"], false);
    assert_eq!(
        json["knoten"][1]["material"][0]["vorlage_material_id"],
        decken
    );
    assert_eq!(json["knoten"][1]["material"][0]["zustand"], "neu");
    assert_eq!(json["knoten"][1]["material"][1]["fahrzeug_id"], v.rtw1);

    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let mut rx = live.abonniere(einsatz);
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({
            "vorlage_id": v.staffel,
            "fahrzeuge": fz(&[v.rtw1, v.rtw2]),
            "material": mat(&[decken, rucksack]),
        }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let staffel = json["einheit_id"].clone();
    let material_ids: Vec<i64> = json["material"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m.as_i64().unwrap())
        .collect();
    assert_eq!(material_ids.len(), 2);

    let fahrzeuge = liste(&app, &admin, einsatz, "fahrzeuge").await;
    let ef_rtw1 = fahrzeuge
        .iter()
        .find(|f| f["funkrufname"] == "RTW 1")
        .unwrap()["id"]
        .clone();
    let posten = liste(&app, &admin, einsatz, "material").await;
    let p = |name: &str| {
        posten
            .iter()
            .find(|p| p["bezeichnung"] == name)
            .unwrap_or_else(|| panic!("{name} fehlt: {posten:?}"))
            .clone()
    };
    assert_eq!(p("Wolldecke")["menge"], 50);
    assert_eq!(p("Wolldecke")["einheit_id"], staffel);
    assert_eq!(p("Sanitätsrucksack")["einsatz_fahrzeug_id"], ef_rtw1);
    assert!(p("Sanitätsrucksack")
        .get("einheit_id")
        .is_none_or(Value::is_null));

    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 1,
        "ein ETB-Eintrag, keiner je Posten"
    );
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|i| i.contains("Material: 50× Wolldecke, 1× Sanitätsrucksack")),
        "{inhalte:?}"
    );
    let ereignisse = objekt_ereignisse(&mut rx, &[("material", "material_id")]);
    let mut gesehen: Vec<i64> = ereignisse.iter().map(|(_, id)| *id).collect();
    gesehen.sort_unstable();
    let mut erwartet = material_ids.clone();
    erwartet.sort_unstable();
    assert_eq!(gesehen, erwartet, "ein Ereignis je Posten nach dem Commit");
}

#[tokio::test]
async fn material_gesperrt_und_schon_im_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let v = vorlage(&pool, org).await;
    let (decken, _) = material_der_staffel(&pool, org, &v).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frieda_id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, frieda_id, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    nur_fuer_admins(&app, &admin, einsatz, "material").await;

    let (s, json) = vorschau(&app, &frieda, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["material_gesperrt"], true);
    assert_eq!(json["knoten"][1]["material"], json!([]));
    let (s, json) = bilden(
        &app,
        &frieda,
        einsatz,
        &json!({"vorlage_id": v.staffel, "material": mat(&[decken])}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");
    assert_eq!(bestand(&app, &admin, einsatz).await, (0, 0, 0));

    // 51 Positionen sind 400, vor jeder Abfrage.
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": 987_654, "material": mat(&[decken; 51])}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");

    // Ein Gerät mit Bestandsnummer, das schon im Einsatz steht: 422 an der Position.
    let se: i64 = sqlx::query_scalar(
        "INSERT INTO material (org_id, bezeichnung, art, bestandsnummer) \
         VALUES (?, 'Stromerzeuger', 'geraet', 'SE-1') RETURNING id",
    )
    .bind(org)
    .fetch_one(&pool)
    .await
    .unwrap();
    let stand = vrepo::replace_material(
        &pool,
        org,
        v.zug,
        &[lifeline_hub::einheit_vorlage::MaterialEntry {
            material_id: se,
            menge: 1,
            fahrzeug_id: None,
        }],
    )
    .await
    .unwrap();
    let position = stand.material[0].id;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &admin,
        Some(&format!(r#"{{"material_id":{se}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let (s, json) = vorschau(&app, &admin, einsatz, v.zug).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["knoten"][0]["material"][0]["zustand"], "im_einsatz");
    let (s, json) = bilden(
        &app,
        &admin,
        einsatz,
        &json!({"vorlage_id": v.zug, "material": mat(&[position])}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["zeilen"],
        json!([{"art": "material", "id": position, "grund": "schon im Einsatz"}])
    );
    assert_eq!(liste(&app, &admin, einsatz, "einheiten").await.len(), 0);
}
