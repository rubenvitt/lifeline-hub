//! LLH-1042: Katalog „Einheiten-Vorlagen“ über HTTP — Rechte, Statuscodes, Org-Grenze und das
//! Ereignis `stammdaten` (Spec `einheit-vorlagen`, `org-live`). Die Regeln von Baum und
//! Zuordnungen prüfen die Repo-Tests in `src/einheit_vorlage/tests.rs`; hier ihr Statuscode.

use axum::http::StatusCode;
use lifeline_hub::live::org::{OrgLiveEvent, OrgNachricht};
use serde_json::Value;
use tokio::sync::broadcast::Receiver;

mod common;
use common::{
    anfrage, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_pool,
    setup_mit_pool_und_live,
};

const PFAD: &str = "/api/einheit-vorlagen";

async fn org_von(pool: &sqlx::SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Id des Einheitstyps der Startliste in der Org.
async fn typ_id(pool: &sqlx::SqlitePool, org_id: i64, label: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM einheit_typ WHERE org_id = ? AND label = ?")
        .bind(org_id)
        .bind(label)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn fahrzeug(pool: &sqlx::SqlitePool, org_id: i64, funkrufname: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (?, ?) RETURNING id")
        .bind(org_id)
        .bind(funkrufname)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn person(pool: &sqlx::SqlitePool, org_id: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (?, ?) RETURNING id")
        .bind(org_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn create(app: &axum::Router, cookie: &str, rumpf: &str) -> (StatusCode, Value) {
    anfrage(app, "POST", PFAD, cookie, Some(rumpf)).await
}

async fn send(
    app: &axum::Router,
    methode: &str,
    cookie: &str,
    pfad: &str,
    rumpf: &str,
) -> (StatusCode, Value) {
    anfrage(app, methode, &format!("{PFAD}{pfad}"), cookie, Some(rumpf)).await
}

fn id(json: &Value) -> i64 {
    json["id"]
        .as_i64()
        .unwrap_or_else(|| panic!("keine id: {json}"))
}

fn namen(json: &Value) -> Vec<String> {
    json.as_array()
        .unwrap()
        .iter()
        .map(|v| v["name"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn admin_legt_vorlage_an_und_liste_traegt_das_soll_des_typs() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let zug = typ_id(&pool, org, "Zug").await;

    let (status, json) = create(
        &app,
        &admin,
        &format!(r#"{{"name":"  Sanitätszug Musterstadt ","typ_id":{zug},"funkrufname":" "}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["name"], "Sanitätszug Musterstadt");
    assert_eq!(json["typ_label"], "Zug");
    assert_eq!(
        json["soll"],
        serde_json::json!({"fuehrer":1,"unterfuehrer":3,"mannschaft":18})
    );
    assert_eq!(json["soll_eigen"], false);
    assert_eq!(json["aktiv"], true);
    assert_eq!(json["ist_demo"], false);
    assert!(json.get("funkrufname").is_none(), "leer wird weggelassen");
    assert!(json.get("ueber_vorlage_id").is_none());
    assert_eq!(json["fahrzeuge"], serde_json::json!([]));
    assert_eq!(json["personal"], serde_json::json!([]));

    let (status, liste) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(namen(&liste), ["Sanitätszug Musterstadt"]);
}

#[tokio::test]
async fn feldfehler_sind_400_und_dublette_409() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let zug = typ_id(&pool, org, "Zug").await;
    let lang = "x".repeat(201);
    for rumpf in [
        format!(r#"{{"name":"  ","typ_id":{zug}}}"#),
        format!(r#"{{"name":"{lang}","typ_id":{zug}}}"#),
        format!(
            r#"{{"name":"Z","typ_id":{zug},"funkrufname":"{}"}}"#,
            "f".repeat(101)
        ),
        format!(
            r#"{{"name":"Z","typ_id":{zug},"bemerkung":"{}"}}"#,
            "b".repeat(2001)
        ),
        format!(r#"{{"name":"Z","typ_id":{zug},"soll_fuehrer":1,"soll_mannschaft":5}}"#),
        r#"{"name":"Z"}"#.to_string(),
    ] {
        let (status, json) = create(&app, &admin, &rumpf).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{rumpf}: {json}");
    }
    let (_, json) = create(
        &app,
        &admin,
        &format!(r#"{{"name":"{lang}","typ_id":{zug}}}"#),
    )
    .await;
    let meldung = json.to_string();
    assert!(
        meldung.contains("Name") && meldung.contains("200"),
        "{meldung}"
    );
    let genau = "ä".repeat(200);
    let (status, _) = create(
        &app,
        &admin,
        &format!(r#"{{"name":"{genau}","typ_id":{zug}}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "genau an der Grenze");

    let rumpf = format!(r#"{{"name":"SEG","typ_id":{zug}}}"#);
    let (status, _) = create(&app, &admin, &rumpf).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = create(&app, &admin, &rumpf).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, _) = create(&app, &admin, r#"{"name":"X","typ_id":999999}"#).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "unbekannter Typ");
}

#[tokio::test]
async fn ohne_admin_recht_403_aber_lesen_geht_nur_aktive() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let zug = typ_id(&pool, org, "Zug").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    let rumpf = format!(r#"{{"name":"Zug","typ_id":{zug}}}"#);
    let (status, _) = create(&app, &erika, &rumpf).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, json) = create(&app, &admin, &rumpf).await;
    let v = id(&json);
    let (_, json) = create(
        &app,
        &admin,
        &format!(r#"{{"name":"Ruhend","typ_id":{zug}}}"#),
    )
    .await;
    let ruhend = id(&json);

    for (methode, pfad, rumpf) in [
        ("PATCH", format!("/{v}"), r#"{"name":"Neu"}"#),
        ("PUT", format!("/{v}/fahrzeuge"), r#"{"fahrzeug_ids":[]}"#),
        ("PUT", format!("/{v}/personal"), r#"{"personal":[]}"#),
    ] {
        let (status, _) = send(&app, methode, &erika, &pfad, rumpf).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }

    let (status, json) = send(
        &app,
        "PATCH",
        &admin,
        &format!("/{ruhend}"),
        r#"{"aktiv":false}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    let (status, json) = anfrage(&app, "GET", PFAD, &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(namen(&json), ["Zug"]);
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("{PFAD}?nur_aktive=false"),
        &erika,
        None,
    )
    .await;
    assert_eq!(namen(&json), ["Ruhend", "Zug"]);
    assert_eq!(json[0]["aktiv"], false);

    let (status, _) = anfrage(&app, "DELETE", &format!("{PFAD}/{v}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED, "kein Löschen");
}

#[tokio::test]
async fn zuordnungen_und_zusammenhangsfehler() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let zug_typ = typ_id(&pool, org, "Zug").await;
    let staffel_typ = typ_id(&pool, org, "Staffel").await;
    let (_, json) = create(
        &app,
        &admin,
        &format!(r#"{{"name":"Zug","typ_id":{zug_typ}}}"#),
    )
    .await;
    let zug = id(&json);
    let (status, json) = create(
        &app,
        &admin,
        &format!(r#"{{"name":"Staffel","typ_id":{staffel_typ},"ueber_vorlage_id":{zug}}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json}");
    assert_eq!(json["ueber_vorlage_id"], zug);
    let staffel = id(&json);

    let (status, _) = send(
        &app,
        "PATCH",
        &admin,
        &format!("/{zug}"),
        &format!(r#"{{"ueber_vorlage_id":{staffel}}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "Zyklus");

    let elw = fahrzeug(&pool, org, "Musterstadt 11-1").await;
    let rtw = fahrzeug(&pool, org, "Musterstadt 83-1").await;
    let (status, json) = send(
        &app,
        "PUT",
        &admin,
        &format!("/{zug}/fahrzeuge"),
        &format!(r#"{{"fahrzeug_ids":[{elw},{elw}]}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["fahrzeuge"].as_array().unwrap().len(), 1, "entdoppelt");
    assert_eq!(json["fahrzeuge"][0]["funkrufname"], "Musterstadt 11-1");
    assert_eq!(json["fahrzeuge"][0]["dienststatus"], "in_dienst");
    assert_eq!(json["fahrzeuge"][0]["auch_in"], serde_json::json!([]));

    let (status, _) = send(
        &app,
        "PUT",
        &admin,
        &format!("/{staffel}/fahrzeuge"),
        &format!(r#"{{"fahrzeug_ids":[{elw}]}}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "doppelt im selben Baum"
    );
    let zu_viele: Vec<String> = (1..=51).map(|i| i.to_string()).collect();
    let (status, _) = send(
        &app,
        "PUT",
        &admin,
        &format!("/{staffel}/fahrzeuge"),
        &format!(r#"{{"fahrzeug_ids":[{}]}}"#, zu_viele.join(",")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "Deckel");

    let p = person(&pool, org, "Erika Muster").await;
    let (status, json) = send(
        &app,
        "PUT",
        &admin,
        &format!("/{staffel}/personal"),
        &format!(r#"{{"personal":[{{"personal_id":{p},"fahrzeug_id":{rtw},"staerke_position":"fuehrer"}}]}}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Fahrzeug nicht in der Vorlage: {json}"
    );
    let (status, _) = send(
        &app,
        "PUT",
        &admin,
        &format!("/{staffel}/personal"),
        &format!(r#"{{"personal":[{{"personal_id":{p},"staerke_position":"f"}}]}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "unbekannte Position");
    send(
        &app,
        "PUT",
        &admin,
        &format!("/{staffel}/fahrzeuge"),
        &format!(r#"{{"fahrzeug_ids":[{rtw}]}}"#),
    )
    .await;
    let (status, json) = send(
        &app,
        "PUT",
        &admin,
        &format!("/{staffel}/personal"),
        &format!(r#"{{"personal":[{{"personal_id":{p},"fahrzeug_id":{rtw},"staerke_position":"unterfuehrer"}}]}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["personal"][0]["name"], "Erika Muster");
    assert_eq!(json["personal"][0]["fahrzeug_id"], rtw);
    assert_eq!(json["personal"][0]["staerke_position"], "unterfuehrer");

    let (status, _) = send(&app, "PATCH", &admin, "/999999", r#"{"name":"X"}"#).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        "PUT",
        &admin,
        "/999999/fahrzeuge",
        r#"{"fahrzeug_ids":[]}"#,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn org_grenze() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org_a = org_von(&pool, "admin").await;
    let zug_a = typ_id(&pool, org_a, "Zug").await;
    let (_, json) = create(
        &app,
        &admin,
        &format!(r#"{{"name":"Zug A","typ_id":{zug_a}}}"#),
    )
    .await;
    let a = id(&json);

    let (org_b, _) = fremde_org_anlegen(&pool, "Org B", "bert", "bertpw123", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE benutzername = 'bert'")
        .execute(&pool)
        .await
        .unwrap();
    let bert = login_cookie(&app, "bert", "bertpw123").await;
    let (status, json) = anfrage(&app, "GET", PFAD, &bert, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(json.as_array().unwrap().is_empty(), "{json}");

    let (status, _) = send(
        &app,
        "PATCH",
        &bert,
        &format!("/{a}"),
        r#"{"name":"fremd"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        "PUT",
        &bert,
        &format!("/{a}/fahrzeuge"),
        r#"{"fahrzeug_ids":[]}"#,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        "PUT",
        &bert,
        &format!("/{a}/personal"),
        r#"{"personal":[]}"#,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "Stammbesetzung fremder Vorlage"
    );

    // Verweise auf Typ, Vorlage und Fahrzeug der anderen Org sind 422.
    let (status, _) = create(&app, &bert, &format!(r#"{{"name":"X","typ_id":{zug_a}}}"#)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "fremder Typ");
    let zug_b: i64 = sqlx::query_scalar(
        "INSERT INTO einheit_typ (org_id, label) VALUES (?, 'Zug') RETURNING id",
    )
    .bind(org_b)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (status, _) = create(
        &app,
        &bert,
        &format!(r#"{{"name":"X","typ_id":{zug_b},"ueber_vorlage_id":{a}}}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "fremde Unterstellung"
    );
    let (_, json) = create(
        &app,
        &bert,
        &format!(r#"{{"name":"Zug B","typ_id":{zug_b}}}"#),
    )
    .await;
    let b = id(&json);
    let fremdes = fahrzeug(&pool, org_a, "Fremd").await;
    let (status, _) = send(
        &app,
        "PUT",
        &bert,
        &format!("/{b}/fahrzeuge"),
        &format!(r#"{{"fahrzeug_ids":[{fremdes}]}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "fremdes Fahrzeug");
    let (_, json) = anfrage(&app, "GET", PFAD, &bert, None).await;
    assert_eq!(
        json[0]["fahrzeuge"],
        serde_json::json!([]),
        "nichts geändert"
    );
}

fn stammdaten(rx: &mut Receiver<OrgNachricht>) -> usize {
    let mut n = 0;
    while let Ok(nachricht) = rx.try_recv() {
        if nachricht.event == OrgLiveEvent::Stammdaten {
            n += 1;
        }
    }
    n
}

/// Jede erfolgreiche Schreibanfrage meldet `stammdaten`, Lesen und abgelehnte nicht (Spec
/// `org-live`, „Ereignis für die Stammdaten“).
#[tokio::test]
async fn stammdaten_nur_nach_erfolgreichem_schreiben() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let zug = typ_id(&pool, org, "Zug").await;
    let f = fahrzeug(&pool, org, "F 1").await;
    let p = person(&pool, org, "P").await;
    let mut rx = live.abonniere_org();

    let (status, json) = create(&app, &admin, &format!(r#"{{"name":"Zug","typ_id":{zug}}}"#)).await;
    assert_eq!(status, StatusCode::CREATED);
    let v = id(&json);
    assert_eq!(stammdaten(&mut rx), 1, "POST");
    for (methode, pfad, rumpf) in [
        ("PATCH", format!("/{v}"), r#"{"bemerkung":"x"}"#.to_string()),
        (
            "PUT",
            format!("/{v}/fahrzeuge"),
            format!(r#"{{"fahrzeug_ids":[{f}]}}"#),
        ),
        (
            "PUT",
            format!("/{v}/personal"),
            format!(r#"{{"personal":[{{"personal_id":{p}}}]}}"#),
        ),
    ] {
        let (status, json) = send(&app, methode, &admin, &pfad, &rumpf).await;
        assert_eq!(status, StatusCode::OK, "{methode} {pfad}: {json}");
        assert_eq!(stammdaten(&mut rx), 1, "{methode} {pfad}");
    }

    let (status, _) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = create(&app, &admin, &format!(r#"{{"name":"Zug","typ_id":{zug}}}"#)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = create(&app, &admin, &format!(r#"{{"name":" ","typ_id":{zug}}}"#)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = send(
        &app,
        "PATCH",
        &admin,
        &format!("/{v}"),
        &format!(r#"{{"ueber_vorlage_id":{v}}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        stammdaten(&mut rx),
        0,
        "Lesen und Ablehnungen melden nichts"
    );
}
