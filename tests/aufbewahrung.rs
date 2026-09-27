//! Archiv-Namensraum der Aufbewahrung (LFH-23): Zugriff, Übersicht, Archiv-ETB,
//! Wiederherstellen, die unveränderte Sperre der regulären Routen und der Struktur-Guard
//! des Namensraums.

use axum::http::StatusCode;
use chrono::{Duration, Utc};
use serde_json::Value;
use sqlx::SqlitePool;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen};

const FMT: &str = "%Y-%m-%d %H:%M:%S";

fn vor_tagen(tage: i64) -> String {
    (Utc::now() - Duration::days(tage)).format(FMT).to_string()
}

fn in_tagen(tage: i64) -> String {
    (Utc::now() + Duration::days(tage)).format(FMT).to_string()
}

/// Legt einen Einsatz als Admin an und schließt ihn ab.
async fn abgeschlossen(app: &axum::Router, admin: &str) -> i64 {
    let id = einsatz_anlegen(app, admin).await;
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "abschliessen: {v}");
    id
}

async fn setze(
    pool: &SqlitePool,
    id: i64,
    frist: Option<&str>,
    geloescht: Option<&str>,
    geschwaerzt: Option<&str>,
) {
    sqlx::query(
        "UPDATE einsatz SET retention_bis = ?, geloescht_at = ?, geschwaerzt_at = ? WHERE id = ?",
    )
    .bind(frist)
    .bind(geloescht)
    .bind(geschwaerzt)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

/// Zweite Organisation mit eigenem System-Admin (per SQL: `fremde_org_anlegen` legt
/// bewusst `keiner` an). Liefert das Login-Cookie.
async fn fremder_admin(app: &axum::Router, pool: &SqlitePool) -> String {
    let org: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) VALUES ('Fremd', 'hilfsorganisation') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let hash = lifeline_hub::auth::password::hash("fremdpw12").unwrap();
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, 'Fremd-Admin', 'fremdadmin', ?, 'admin')",
    )
    .bind(org)
    .bind(&hash)
    .execute(pool)
    .await
    .unwrap();
    login_cookie(app, "fremdadmin", "fremdpw12").await
}

async fn etb_anzahl(pool: &SqlitePool, id: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn archivzugriff_nur_fuer_den_admin_der_eigenen_org() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fk_id = benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let leit_id = benutzer_anlegen(&app, &admin, "leitung", "keine").await;
    let _ = fk_id;
    let id = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, id, leit_id, "einsatzleitung").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    setze(&pool, id, Some(&vor_tagen(3)), Some(&vor_tagen(2)), None).await;
    let aktiv = einsatz_anlegen(&app, &admin).await;

    let akte = format!("/api/aufbewahrung/einsaetze/{id}");
    let etb = format!("/api/aufbewahrung/einsaetze/{id}/etb");
    for uri in ["/api/aufbewahrung", akte.as_str(), etb.as_str()] {
        let (s, v) = anfrage(&app, "GET", uri, &admin, None).await;
        assert_eq!(s, StatusCode::OK, "Admin eigene Org {uri}: {v}");
    }

    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    let leit = login_cookie(&app, "leitung", "leitungpw1").await;
    for (wer, cookie) in [("Führungskraft", &fk), ("Einsatzleitung", &leit)] {
        for uri in ["/api/aufbewahrung", akte.as_str(), etb.as_str()] {
            let (s, _) = anfrage(&app, "GET", uri, cookie, None).await;
            assert_eq!(s, StatusCode::FORBIDDEN, "{wer} {uri}");
        }
    }

    let fremd = fremder_admin(&app, &pool).await;
    for uri in [akte.as_str(), etb.as_str()] {
        let (s, _) = anfrage(&app, "GET", uri, &fremd, None).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "fremde Org {uri}");
    }
    let (s, v) = anfrage(&app, "GET", "/api/aufbewahrung", &fremd, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.as_array().unwrap().len(), 0, "fremde Übersicht leer: {v}");

    let (s, _) = anfrage(
        &app,
        "GET",
        "/api/aufbewahrung/einsaetze/999999",
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{aktiv}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "aktiver Einsatz hat keine Archivakte"
    );
}

#[tokio::test]
async fn uebersicht_ohne_aktive_und_fremde_einsaetze() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = abgeschlossen(&app, &admin).await;
    let b = abgeschlossen(&app, &admin).await;
    setze(&pool, b, Some(&vor_tagen(40)), Some(&vor_tagen(35)), None).await;
    let _aktiv = einsatz_anlegen(&app, &admin).await;
    // Ein abgeschlossener Einsatz der fremden Org.
    let fremd = fremder_admin(&app, &pool).await;
    let fremd_org: i64 =
        sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'fremdadmin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at) VALUES (?, 'Fremd', 'abgeschlossen', datetime('now'))")
        .bind(fremd_org)
        .execute(&pool)
        .await
        .unwrap();

    let (s, v) = anfrage(&app, "GET", "/api/aufbewahrung", &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let mut ids: Vec<i64> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["einsatz_id"].as_i64().unwrap())
        .collect();
    ids.sort();
    assert_eq!(ids, vec![a, b]);
    let zb = v
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["einsatz_id"] == b)
        .unwrap();
    assert_eq!(zb["zustand"], "schwaerzung_ausstehend");
    assert!(zb.as_object().unwrap().contains_key("karenz_ende"));
    let za = v
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["einsatz_id"] == a)
        .unwrap();
    assert_eq!(za["zustand"], "ohne_frist");
    assert!(!za.as_object().unwrap().contains_key("karenz_ende"));

    let (_, vf) = anfrage(&app, "GET", "/api/aufbewahrung", &fremd, None).await;
    assert_eq!(
        vf.as_array().unwrap().len(),
        1,
        "fremde Org sieht nur ihren eigenen"
    );
}

#[tokio::test]
async fn archiv_etb_paginiert_filterbar_und_mit_berichtigungsverweis() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{id}/etb"),
        &admin,
        Some(r#"{"typ":"meldung","inhalt":"Erstmeldung"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let erst_id = v["id"].as_i64().unwrap();
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{id}/etb"),
        &admin,
        Some(&format!(
            r#"{{"typ":"berichtigung","inhalt":"Korrektur","berichtigt_eintrag_id":{erst_id}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // Frist setzen erzeugt einen System-Eintrag; danach Vormerkung per SQL.
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{id}/aufbewahrungsfrist"),
        &admin,
        Some(&format!(
            r#"{{"retention_bis":"{}","bestaetigt":true}}"#,
            vor_tagen(1)
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    setze(&pool, id, Some(&vor_tagen(1)), Some(&vor_tagen(0)), None).await;

    let basis = format!("/api/aufbewahrung/einsaetze/{id}/etb");
    let (s, alle) = anfrage(&app, "GET", &basis, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let alle = alle.as_array().unwrap().clone();
    assert!(alle.len() >= 3, "{alle:?}");
    let nrn: Vec<i64> = alle.iter().map(|e| e["lfd_nr"].as_i64().unwrap()).collect();
    let mut sortiert = nrn.clone();
    sortiert.sort_by(|a, b| b.cmp(a));
    assert_eq!(nrn, sortiert, "neueste zuerst");
    let korrektur = alle.iter().find(|e| e["typ"] == "berichtigung").unwrap();
    assert_eq!(korrektur["berichtigt_eintrag_id"], erst_id);
    for e in &alle {
        let o = e.as_object().unwrap();
        for k in [
            "auftrag_id",
            "befehl_id",
            "lagebericht_id",
            "folgeauftraege",
            "anhaenge",
        ] {
            assert!(!o.contains_key(k), "Archiv-ETB darf {k} nicht tragen");
        }
    }

    // Seite 1 mit limit=1, dann Cursor.
    let (_, s1) = anfrage(&app, "GET", &format!("{basis}?limit=1"), &admin, None).await;
    let s1 = s1.as_array().unwrap();
    assert_eq!(s1.len(), 1);
    let cursor = s1[0]["lfd_nr"].as_i64().unwrap();
    let (_, s2) = anfrage(
        &app,
        "GET",
        &format!("{basis}?before_lfd_nr={cursor}&limit=500"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s2.as_array().unwrap().len(), alle.len() - 1);

    let (s, sys) = anfrage(&app, "GET", &format!("{basis}?typ=system"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(sys.as_array().unwrap().iter().all(|e| e["typ"] == "system"));
    assert!(sys
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["inhalt"].as_str().unwrap().contains("Aufbewahrungsfrist")));

    let (s, _) = anfrage(&app, "GET", &format!("{basis}?typ=unsinn"), &admin, None).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Anhang direkt per SQL (die Upload-Route braucht Multipart und ist hier nicht Thema).
async fn anhang(pool: &SqlitePool, einsatz: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'foto.jpg', 'image/jpeg', 3, 'deadbeef', X'414243', 1) RETURNING id",
    )
    .bind(einsatz)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn regulaere_routen_gesperrt(app: &axum::Router, admin: &str, id: i64, aid: i64) {
    for uri in [
        format!("/api/einsaetze/{id}"),
        format!("/api/einsaetze/{id}/etb"),
        format!("/api/einsaetze/{id}/personen"),
        format!("/api/einsaetze/{id}/anhaenge/{aid}"),
        format!("/api/einsaetze/{id}/live"),
    ] {
        let (s, _) = anfrage(app, "GET", &uri, admin, None).await;
        assert_eq!(
            s,
            StatusCode::FORBIDDEN,
            "{uri} muss für den Admin gesperrt bleiben"
        );
    }
}

#[tokio::test]
async fn nach_schwaerzung_regulaer_403_archiv_200() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = abgeschlossen(&app, &admin).await;
    let aid = anhang(&pool, id).await;
    setze(&pool, id, Some(&vor_tagen(50)), Some(&vor_tagen(31)), None).await;
    assert_eq!(
        lifeline_hub::einsatz::purge_scheduler::tick_einmal(&pool, Utc::now()).await,
        1,
        "Tick schwärzt"
    );
    regulaere_routen_gesperrt(&app, &admin, id, aid).await;
    for uri in [
        format!("/api/aufbewahrung/einsaetze/{id}"),
        format!("/api/aufbewahrung/einsaetze/{id}/etb"),
    ] {
        let (s, v) = anfrage(&app, "GET", &uri, &admin, None).await;
        assert_eq!(s, StatusCode::OK, "{uri}: {v}");
    }
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/aufbewahrung/einsaetze/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(v["zustand"], "geschwaerzt");
}

async fn wiederherstellen(
    app: &axum::Router,
    cookie: &str,
    id: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/aufbewahrung/einsaetze/{id}/wiederherstellen"),
        cookie,
        Some(body),
    )
    .await
}

#[tokio::test]
async fn wiederherstellen_mit_frist_oeffnet_den_einsatz_wieder() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let leit_id = benutzer_anlegen(&app, &admin, "leitung", "keine").await;
    let id = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, id, leit_id, "einsatzleitung").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    setze(&pool, id, Some(&vor_tagen(6)), Some(&vor_tagen(5)), None).await;
    let leit = login_cookie(&app, "leitung", "leitungpw1").await;
    let (s, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{id}"), &leit, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "vorher gesperrt");

    let frist = in_tagen(90);
    let (s, v) = wiederherstellen(
        &app,
        &admin,
        id,
        &format!(r#"{{"retention_bis":"{frist}"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zustand"], "frist_laeuft");
    assert_eq!(v["kopf"]["retention_bis"], frist.as_str());
    assert!(!v["kopf"].as_object().unwrap().contains_key("geloescht_at"));

    let (s, _) = anfrage(&app, "GET", &format!("/api/einsaetze/{id}"), &leit, None).await;
    assert_eq!(s, StatusCode::OK, "Einsatzleitung liest wieder");
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (erfasser, inhalt): (i64, String) = sqlx::query_as(
        "SELECT erfasser_id, inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr DESC LIMIT 1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(erfasser, admin_id);
    assert!(inhalt.contains("Löschvormerkung"), "{inhalt}");

    // Kein Wiedervormerken im nächsten Purge-Lauf (design.md D5).
    lifeline_hub::einsatz::purge_scheduler::tick_einmal(&pool, Utc::now()).await;
    let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        g, None,
        "wiederhergestellt bleibt nach dem Tick unvorgemerkt"
    );
}

#[tokio::test]
async fn wiederherstellen_unbegrenzt_mit_null() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = abgeschlossen(&app, &admin).await;
    setze(&pool, id, Some(&vor_tagen(6)), Some(&vor_tagen(5)), None).await;
    let (s, v) = wiederherstellen(&app, &admin, id, r#"{"retention_bis":null}"#).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["zustand"], "ohne_frist");
    lifeline_hub::einsatz::purge_scheduler::tick_einmal(&pool, Utc::now()).await;
    let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(g, None);
}

#[tokio::test]
async fn wiederherstellen_statuscodes_ohne_schreibvorgang() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let _fk = benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let vorgemerkt = abgeschlossen(&app, &admin).await;
    setze(
        &pool,
        vorgemerkt,
        Some(&vor_tagen(6)),
        Some(&vor_tagen(5)),
        None,
    )
    .await;
    let vorher = etb_anzahl(&pool, vorgemerkt).await;
    let zukunft = format!(r#"{{"retention_bis":"{}"}}"#, in_tagen(30));
    for (body, erwartet, fall) in [
        ("{}", StatusCode::BAD_REQUEST, "Feld fehlt"),
        (
            r#"{"retention_bis":"morgen"}"#,
            StatusCode::BAD_REQUEST,
            "unlesbar",
        ),
        (r#"{"retention_bis":""}"#, StatusCode::BAD_REQUEST, "leer"),
        (
            &format!(r#"{{"retention_bis":"{}"}}"#, vor_tagen(1)),
            StatusCode::UNPROCESSABLE_ENTITY,
            "Vergangenheit",
        ),
    ] {
        let (s, v) = wiederherstellen(&app, &admin, vorgemerkt, body).await;
        assert_eq!(s, erwartet, "{fall}: {v}");
    }
    let (s, _) = wiederherstellen(&app, &fk, vorgemerkt, &zukunft).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Führungskraft");
    assert_eq!(
        etb_anzahl(&pool, vorgemerkt).await,
        vorher,
        "keine Ablehnung schreibt"
    );
    let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
        .bind(vorgemerkt)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(g.is_some(), "bleibt vorgemerkt");

    let offen = abgeschlossen(&app, &admin).await;
    let (s, _) = wiederherstellen(&app, &admin, offen, &zukunft).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "nicht vorgemerkt");

    let karenz_vorbei = abgeschlossen(&app, &admin).await;
    setze(
        &pool,
        karenz_vorbei,
        Some(&vor_tagen(40)),
        Some(&vor_tagen(31)),
        None,
    )
    .await;
    let (s, _) = wiederherstellen(&app, &admin, karenz_vorbei, &zukunft).await;
    assert_eq!(s, StatusCode::CONFLICT, "Karenz abgelaufen");

    let schwarz = abgeschlossen(&app, &admin).await;
    setze(
        &pool,
        schwarz,
        Some(&vor_tagen(40)),
        Some(&vor_tagen(35)),
        Some(&vor_tagen(2)),
    )
    .await;
    let (s, _) = wiederherstellen(&app, &admin, schwarz, &zukunft).await;
    assert_eq!(s, StatusCode::CONFLICT, "geschwärzt");

    let aktiv = einsatz_anlegen(&app, &admin).await;
    let (s, _) = wiederherstellen(&app, &admin, aktiv, &zukunft).await;
    assert_eq!(s, StatusCode::CONFLICT, "aktiv");
}

// ───────────────────── Struktur-Guard des Namensraums (design.md D2) ─────────────────────

/// Eine Route unter `/api/aufbewahrung` aus `src/app.rs`: Pfad plus Methoden-Handler.
#[derive(Debug)]
struct Route {
    pfad: String,
    handler: Vec<(String, String)>,
}

/// Schneidet alle `.route(…)`-Aufrufe aus `app.rs` (auch mehrzeilige) und liefert die unter
/// dem Archiv-Namensraum mit ihren `get(routes::aufbewahrung::x)`-Paaren.
fn archivrouten(app_rs: &str) -> Vec<Route> {
    let mut routen = Vec::new();
    let mut rest = app_rs;
    while let Some(start) = rest.find(".route(") {
        let nach = &rest[start + ".route(".len()..];
        // Klammerzählung bis zum schließenden `)` des route-Aufrufs.
        let mut tiefe = 1usize;
        let mut ende = 0usize;
        for (i, c) in nach.char_indices() {
            match c {
                '(' => tiefe += 1,
                ')' => {
                    tiefe -= 1;
                    if tiefe == 0 {
                        ende = i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let aufruf = &nach[..ende];
        rest = &nach[ende..];
        let Some(p0) = aufruf.find('"') else { continue };
        let Some(p1) = aufruf[p0 + 1..].find('"') else {
            continue;
        };
        let pfad = &aufruf[p0 + 1..p0 + 1 + p1];
        if !(pfad == "/api/aufbewahrung" || pfad.starts_with("/api/aufbewahrung/")) {
            continue;
        }
        let mut handler = Vec::new();
        for methode in ["get", "post", "put", "patch", "delete"] {
            let muster = format!("{methode}(");
            let mut such = aufruf;
            while let Some(i) = such.find(&muster) {
                let vor = such[..i].chars().last();
                let nach_m = &such[i + muster.len()..];
                if vor.is_none_or(|c| !c.is_alphanumeric() && c != '_') {
                    let name_ende = nach_m.find(')').unwrap_or(nach_m.len());
                    handler.push((methode.to_string(), nach_m[..name_ende].trim().to_string()));
                }
                such = nach_m;
            }
        }
        routen.push(Route {
            pfad: pfad.to_string(),
            handler,
        });
    }
    routen
}

/// Die Signatur eines `pub async fn name(` bis zur schließenden Parameterklammer.
fn signatur<'a>(quelle: &'a str, name: &str) -> Option<&'a str> {
    let kopf = format!("pub async fn {name}(");
    let start = quelle.find(&kopf)? + kopf.len();
    let ende = quelle[start..].find(") ->")?;
    Some(&quelle[start..start + ende])
}

fn pruefe_namensraum(app_rs: &str, routen_rs: &str) -> Vec<String> {
    let mut verstoesse = Vec::new();
    let routen = archivrouten(app_rs);
    if routen.is_empty() {
        verstoesse.push("keine Route unter /api/aufbewahrung gefunden — Schnitt kaputt?".into());
    }
    let mut nicht_get = Vec::new();
    for r in &routen {
        if r.handler.is_empty() {
            verstoesse.push(format!("{}: kein Handler erkannt", r.pfad));
        }
        for (methode, handler) in &r.handler {
            let Some(name) = handler.strip_prefix("routes::aufbewahrung::") else {
                verstoesse.push(format!(
                    "{} {methode}: Handler {handler} liegt nicht in routes::aufbewahrung",
                    r.pfad
                ));
                continue;
            };
            match signatur(routen_rs, name) {
                None => verstoesse.push(format!("{name}: Signatur nicht gefunden")),
                Some(sig) => {
                    if !sig.contains("AdminUser(") {
                        verstoesse.push(format!("{name}: Handler ohne AdminUser"));
                    }
                    if sig.contains("CurrentUser") {
                        verstoesse.push(format!("{name}: Handler mit CurrentUser"));
                    }
                }
            }
            if methode != "get" {
                nicht_get.push(format!("{methode} {} → {name}", r.pfad));
            }
        }
    }
    if nicht_get
        != vec![
            "post /api/aufbewahrung/einsaetze/{id}/wiederherstellen → wiederherstellen".to_string(),
        ]
    {
        verstoesse.push(format!(
            "genau ein Nicht-GET (wiederherstellen) erlaubt, gefunden: {nicht_get:?}"
        ));
    }
    verstoesse
}

#[test]
fn archiv_namensraum_nur_lesend_und_admin() {
    let app_rs = std::fs::read_to_string("src/app.rs").unwrap();
    let routen_rs = std::fs::read_to_string("src/routes/aufbewahrung.rs").unwrap();
    let routen = archivrouten(&app_rs);
    assert_eq!(routen.len(), 4, "vier Archivrouten erwartet: {routen:?}");
    let v = pruefe_namensraum(&app_rs, &routen_rs);
    assert!(
        v.is_empty(),
        "Archiv-Namensraum (LFH-23, design.md D2):\n{}",
        v.join("\n")
    );
}

/// Selbsttest des Guards: die beiden Mutationen aus tasks.md 2.5 machen ihn rot.
#[test]
fn guard_erkennt_zusaetzlichen_schreibweg_und_current_user() {
    let app_rs = std::fs::read_to_string("src/app.rs").unwrap();
    let routen_rs = std::fs::read_to_string("src/routes/aufbewahrung.rs").unwrap();

    let mit_post = app_rs.replacen(
        "get(routes::aufbewahrung::akte)",
        "get(routes::aufbewahrung::akte).post(routes::aufbewahrung::akte)",
        1,
    );
    assert_ne!(mit_post, app_rs);
    assert!(
        pruefe_namensraum(&mit_post, &routen_rs)
            .iter()
            .any(|v| v.contains("genau ein Nicht-GET")),
        "zusätzliche post-Route muss auffallen"
    );

    let mit_current = routen_rs.replacen(
        "pub async fn akte(\n    State(state): State<AppState>,\n    AdminUser(benutzer): AdminUser,",
        "pub async fn akte(\n    State(state): State<AppState>,\n    CurrentUser(benutzer): CurrentUser,",
        1,
    );
    assert_ne!(mit_current, routen_rs, "Mutationsanker nicht gefunden");
    let v = pruefe_namensraum(&app_rs, &mit_current);
    assert!(
        v.iter().any(|x| x.contains("akte: Handler ohne AdminUser")),
        "{v:?}"
    );
    assert!(
        v.iter()
            .any(|x| x.contains("akte: Handler mit CurrentUser")),
        "{v:?}"
    );
}

#[tokio::test]
async fn fremde_org_darf_nicht_wiederherstellen() {
    // Der einzige Schreibweg des Namensraums: der Admin einer FREMDEN Org bekommt 403, und es
    // ändert sich nichts — weder Vormerkung noch Frist noch ETB.
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = abgeschlossen(&app, &admin).await;
    let frist = vor_tagen(6);
    let vormerkung = vor_tagen(5);
    setze(&pool, id, Some(&frist), Some(&vormerkung), None).await;
    let vorher = etb_anzahl(&pool, id).await;
    let fremd = fremder_admin(&app, &pool).await;
    let (s, v) = wiederherstellen(&app, &fremd, id, r#"{"retention_bis":null}"#).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    let (f, g): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT retention_bis, geloescht_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((f, g), (Some(frist), Some(vormerkung)), "nichts geändert");
    assert_eq!(etb_anzahl(&pool, id).await, vorher, "kein ETB-Eintrag");
}
