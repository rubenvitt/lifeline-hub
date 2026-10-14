//! Kräfte gesammelt disponieren (LLH-1100, Spec `kraefte-disposition`, `eingabegrenzen`):
//! `POST …/personal/sammel` und `…/fahrzeuge/sammel`.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

/// Stamm-Fahrzeug (`/api/fahrzeuge`); liefert die id.
async fn stammfahrzeug(app: &axum::Router, admin: &str, funkrufname: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        "/api/fahrzeuge",
        admin,
        Some(&format!(r#"{{"funkrufname":"{funkrufname}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

/// Stamm-Person mit Trägerorganisation; liefert die id.
async fn stammperson(app: &axum::Router, admin: &str, name: &str, traeger: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&format!(
            r#"{{"name":"{name}","traegerorganisation":"{traeger}"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

/// Disponiert ein Stamm-Fahrzeug einzeln und ordnet es optional einer Einheit zu; liefert `ef_id`.
async fn fahrzeug_im_einsatz(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    funkrufname: &str,
    einheit: Option<i64>,
) -> i64 {
    let fid = stammfahrzeug(app, admin, funkrufname).await;
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

async fn sammel(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    art: &str,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/{art}/sammel"),
        cookie,
        Some(body),
    )
    .await
}

async fn personal(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    json.as_array().unwrap().clone()
}

async fn fahrzeuge(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    json.as_array().unwrap().clone()
}

fn ids(liste: &[i64]) -> String {
    serde_json::to_string(liste).unwrap()
}

/// Der erste `gebunden`-Status der Org trägt die Marke „alarmierung“, damit der Initialstatus in
/// die Zeitachse eingeht (wie bei einer neu angelegten Organisation).
async fn initialstatus_mit_marke(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "UPDATE personal_status SET zeitachse_marke = 'alarmierung' WHERE id = \
         (SELECT id FROM personal_status WHERE kategorie = 'gebunden' AND aktiv = 1 \
          ORDER BY sortier, id LIMIT 1)",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn zeitachse_je_kraft(pool: &sqlx::SqlitePool, ep_id: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_kraft_zeitachse WHERE personal_id = ? AND gestrichen_at IS NULL",
    )
    .bind(ep_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn neun_personen_in_einheit_und_fahrzeug_mit_einem_etb_eintrag() {
    let (app, pool) = setup_mit_pool().await;
    initialstatus_mit_marke(&pool).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let staffel = einheit_bilden(&app, &admin, einsatz, "Rettungsstaffel").await;
    let fz = fahrzeug_im_einsatz(&app, &admin, einsatz, "83-1", Some(staffel)).await;
    let mut pids = Vec::new();
    for i in 1..=9 {
        pids.push(stammperson(&app, &admin, &format!("Kraft {i}"), "DRK").await);
    }
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(
            r#"{{"personal_ids":{},"einheit_id":{staffel},"fahrzeug_id":{fz}}}"#,
            ids(&pids)
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json.as_array().unwrap().len(), 9);

    let liste = personal(&app, &admin, einsatz).await;
    assert_eq!(liste.len(), 9);
    for p in &liste {
        assert_eq!(p["einheit_id"], staffel, "{p}");
        assert_eq!(p["fahrzeug_id"], fz, "{p}");
        assert_eq!(p["status_kategorie"], "gebunden");
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
    let eintrag = inhalte
        .iter()
        .find(|i| i.contains("9 Kräfte disponiert"))
        .unwrap_or_else(|| panic!("kein Sammeleintrag: {inhalte:?}"));
    assert!(
        eintrag.starts_with("9 Kräfte disponiert, Einheit «Rettungsstaffel», Fahrzeug «83-1»: "),
        "{eintrag}"
    );
    for i in 1..=9 {
        assert!(eintrag.contains(&format!("Kraft {i} (DRK)")), "{eintrag}");
    }
}

#[tokio::test]
async fn eine_person_ausser_dienst_lehnt_mit_grund_ab_und_legt_nichts_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut pids = Vec::new();
    for i in 1..=9 {
        pids.push(stammpersonal_anlegen(&app, &admin, &format!("Kraft {i}")).await);
    }
    let ruhend = pids[4];
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/personal/{ruhend}/ausser-dienst"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":{}}}"#, ids(&pids)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert!(json["error"].is_string(), "{json}");
    assert_eq!(
        json["zeilen"],
        serde_json::json!([{"art": "personal", "id": ruhend, "grund": "außer Dienst"}])
    );
    assert!(personal(&app, &admin, einsatz).await.is_empty());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);
}

#[tokio::test]
async fn schon_disponierte_unbekannte_und_entlassene_personen_nennen_ihren_grund() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let dabei = stammpersonal_anlegen(&app, &admin, "Dabei").await;
    let entlassen = stammpersonal_anlegen(&app, &admin, "Entlassen").await;
    let frei = stammpersonal_anlegen(&app, &admin, "Frei").await;
    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":{}}}"#, ids(&[dabei, entlassen])),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let ep_entlassen = json[1]["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal/{ep_entlassen}/entlassen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(
            r#"{{"personal_ids":{}}}"#,
            ids(&[frei, dabei, 987654, entlassen])
        ),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["zeilen"],
        serde_json::json!([
            {"art": "personal", "id": dabei, "grund": "schon disponiert"},
            {"art": "personal", "id": 987654, "grund": "unbekannt"},
            {"art": "personal", "id": entlassen, "grund": "entlassen"},
        ])
    );
    // Nichts angelegt, die entlassene Person bleibt entlassen (keine stille Reaktivierung).
    let namen: Vec<_> = personal(&app, &admin, einsatz)
        .await
        .iter()
        .map(|p| p["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(namen, ["Dabei"]);
}

#[tokio::test]
async fn fahrzeug_einer_anderen_einheit_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let staffel = einheit_bilden(&app, &admin, einsatz, "Rettungsstaffel").await;
    let zug = einheit_bilden(&app, &admin, einsatz, "Sanitätszug").await;
    let fz = fahrzeug_im_einsatz(&app, &admin, einsatz, "83-1", Some(zug)).await;
    let a = stammpersonal_anlegen(&app, &admin, "Anna").await;
    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":[{a}],"einheit_id":{staffel},"fahrzeug_id":{fz}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert!(personal(&app, &admin, einsatz).await.is_empty());
}

#[tokio::test]
async fn einundfuenfzig_kraefte_sind_400_und_dubletten_zaehlen_einmal() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = stammpersonal_anlegen(&app, &admin, "Anna").await;
    let zu_viel = vec![a; 51];
    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":{}}}"#, ids(&zu_viel)),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    assert!(personal(&app, &admin, einsatz).await.is_empty());
    let (s, json) = sammel(&app, &admin, einsatz, "fahrzeuge", r#"{"fahrzeug_ids":[]}"#).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");

    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":[{a},{a}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json.as_array().unwrap().len(), 1);
    assert_eq!(personal(&app, &admin, einsatz).await.len(), 1);
    // Bei genau einer Kraft der Wortlaut des Einzelwegs.
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte.iter().any(|i| i == "Person «Anna» disponiert"),
        "{inhalte:?}"
    );
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
async fn ziel_in_gesperrtem_modul_ist_403_und_legt_nichts_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frieda_id = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, frieda_id, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let staffel = einheit_bilden(&app, &admin, einsatz, "Rettungsstaffel").await;
    let fz = fahrzeug_im_einsatz(&app, &admin, einsatz, "83-1", None).await;
    let a = stammpersonal_anlegen(&app, &admin, "Anna").await;
    let f2 = stammfahrzeug(&app, &admin, "83-2").await;

    nur_fuer_admins(&app, &admin, einsatz, "einheiten").await;
    let (s, json) = sammel(
        &app,
        &frieda,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":[{a}],"einheit_id":{staffel}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");
    let (s, json) = sammel(
        &app,
        &frieda,
        einsatz,
        "fahrzeuge",
        &format!(r#"{{"fahrzeug_ids":[{f2}],"einheit_id":{staffel}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");

    nur_fuer_admins(&app, &admin, einsatz, "fahrzeuge").await;
    let (s, json) = sammel(
        &app,
        &frieda,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":[{a}],"fahrzeug_id":{fz}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");
    assert!(personal(&app, &admin, einsatz).await.is_empty());
    assert_eq!(fahrzeuge(&app, &admin, einsatz).await.len(), 1);

    // Ohne Ziel genügt das Personalrecht.
    let (s, json) = sammel(
        &app,
        &frieda,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":[{a}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
}

#[tokio::test]
async fn zwei_fahrzeuge_in_eine_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zug = einheit_bilden(&app, &admin, einsatz, "Sanitätszug").await;
    let f1 = stammfahrzeug(&app, &admin, "83-1").await;
    let f2 = stammfahrzeug(&app, &admin, "83-2").await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "fahrzeuge",
        &format!(r#"{{"fahrzeug_ids":[{f1},{f2}],"einheit_id":{zug}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let liste = fahrzeuge(&app, &admin, einsatz).await;
    assert_eq!(liste.len(), 2);
    assert!(liste.iter().all(|f| f["einheit_id"] == zug), "{liste:?}");
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 1
    );
    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|i| i == "2 Fahrzeuge disponiert, Einheit «Sanitätszug»: 83-1, 83-2"),
        "{inhalte:?}"
    );

    // Ein schon disponiertes Fahrzeug nennt seinen Grund; nichts weiter angelegt.
    let f3 = stammfahrzeug(&app, &admin, "83-3").await;
    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "fahrzeuge",
        &format!(r#"{{"fahrzeug_ids":[{f3},{f1}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["zeilen"],
        serde_json::json!([{"art": "fahrzeug", "id": f1, "grund": "schon disponiert"}])
    );
    assert_eq!(fahrzeuge(&app, &admin, einsatz).await.len(), 2);
}

const ZIELE: &[(&str, &str)] = &[
    ("personal", "personal_id"),
    ("einheit", "einheit_id"),
    ("fahrzeug", "fahrzeug_id"),
];

/// Ereignisse für Personal, Einheit und Fahrzeug folgen nach dem Commit (Spec
/// `kraefte-disposition`, „Ein ETB-Eintrag je Absenden“); eine Ablehnung meldet nichts.
#[tokio::test]
async fn ereignisse_nach_dem_commit_fuer_personal_einheit_und_fahrzeug() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let staffel = einheit_bilden(&app, &admin, einsatz, "Rettungsstaffel").await;
    let fz = fahrzeug_im_einsatz(&app, &admin, einsatz, "83-1", Some(staffel)).await;
    let a = stammpersonal_anlegen(&app, &admin, "Anna").await;
    let b = stammpersonal_anlegen(&app, &admin, "Bernd").await;
    let f2 = stammfahrzeug(&app, &admin, "83-2").await;

    let mut rx = live.abonniere(einsatz);
    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":[{a},{b}],"einheit_id":{staffel},"fahrzeug_id":{fz}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let (ep_a, ep_b) = (
        json[0]["id"].as_i64().unwrap(),
        json[1]["id"].as_i64().unwrap(),
    );
    let mut ereignisse = objekt_ereignisse(&mut rx, ZIELE);
    ereignisse.sort();
    assert_eq!(
        ereignisse,
        vec![
            ("einheit".to_string(), staffel),
            ("fahrzeug".to_string(), fz),
            ("personal".to_string(), ep_a),
            ("personal".to_string(), ep_b),
        ]
    );

    let (s, json) = sammel(
        &app,
        &admin,
        einsatz,
        "fahrzeuge",
        &format!(r#"{{"fahrzeug_ids":[{f2}],"einheit_id":{staffel}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let ef2 = json[0]["id"].as_i64().unwrap();
    let mut ereignisse = objekt_ereignisse(&mut rx, ZIELE);
    ereignisse.sort();
    assert_eq!(
        ereignisse,
        vec![
            ("einheit".to_string(), staffel),
            ("fahrzeug".to_string(), ef2)
        ]
    );

    let (s, _) = sammel(
        &app,
        &admin,
        einsatz,
        "personal",
        &format!(r#"{{"personal_ids":[{a}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(objekt_ereignisse(&mut rx, ZIELE), vec![]);
}

#[tokio::test]
async fn beobachter_disponiert_nicht_gesammelt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = stammpersonal_anlegen(&app, &admin, "Anna").await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let body = format!(r#"{{"personal_ids":[{a}]}}"#);
    let (s, _) = sammel(&app, &erika, einsatz, "personal", &body).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(personal(&app, &admin, einsatz).await.is_empty());
}
