//! Freigabe eines Einsatzes für Maschinenzugänge durch die Einsatzleitung (LLH-1638, ADR-0033,
//! Spec `maschinenzugang`): Routen unter `/api/einsaetze/{id}/anbindungen`, ein Einsatz je Zugang,
//! Ende der Freigabe, Anzeige an der Anbindung und das Verhalten an einem Spiegel.

use axum::http::StatusCode;
use lifeline_machine_client::Credentials;
use serde_json::{json, Value};

mod common;
mod instanz_hilfen;
use common::maschine::{angebunden_als, jetzt, schluessel, signiert, ANBINDUNGEN};
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen_mit, fremde_org_anlegen, login_cookie,
    rolle_setzen, setup_mit_pool, system_etb_inhalte,
};

const IP: &str = "198.51.100.7";

fn liste_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/anbindungen")
}

async fn liste(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (s, v) = anfrage(app, "GET", &liste_pfad(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

async fn freigeben(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    zugang: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PUT",
        &format!("{}/{zugang}/freigabe", liste_pfad(einsatz)),
        cookie,
        None,
    )
    .await
}

async fn beenden(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    zugang: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "DELETE",
        &format!("{}/{zugang}/freigabe", liste_pfad(einsatz)),
        cookie,
        None,
    )
    .await
}

/// Die Lage, wie das Fremdsystem sie sieht; `None` bei 401.
async fn lage(app: &axum::Router, cred: &Credentials) -> Option<Value> {
    let jti = uuid::Uuid::new_v4().simple().to_string();
    let (s, _, v) = signiert(
        app,
        cred,
        "GET",
        "/api/v1/lage?karte=none",
        jetzt(),
        &jti,
        IP,
    )
    .await;
    if s == StatusCode::UNAUTHORIZED {
        return None;
    }
    assert_eq!(s, StatusCode::OK, "{v}");
    Some(v)
}

async fn anbindung(app: &axum::Router, admin: &str, id: &str) -> Value {
    let (s, v) = anfrage(app, "GET", &format!("{ANBINDUNGEN}/{id}"), admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

fn zaehle(etb: &[String], teil: &str) -> usize {
    etb.iter().filter(|t| t.contains(teil)).count()
}

async fn freigaben(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM maschinenzugang_freigabe")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn einsatzleitung_gibt_frei_und_beendet_und_das_etb_nennt_beides() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let monitor = angebunden_als(
        &app,
        &admin,
        "FüKW Monitor",
        json!(["lage:read"]),
        &schluessel(1),
        IP,
    )
    .await;
    // Ohne Lese-Scope mit Einsatzbezug: steht nicht im Paneel.
    let adapter = angebunden_als(
        &app,
        &admin,
        "Alarm-Adapter",
        json!(["alarmmeldungen:write"]),
        &schluessel(2),
        IP,
    )
    .await;

    let v = liste(&app, &admin, einsatz).await;
    assert_eq!(v.as_array().unwrap().len(), 1, "{v}");
    assert_eq!(v[0]["zugang_id"], json!(monitor.zugang_id));
    assert_eq!(v[0]["name"], "FüKW Monitor");
    assert_eq!(v[0]["scopes"], json!(["lage:read"]));
    assert_eq!(v[0]["zustand"], "aktiv");
    assert_eq!(v[0]["freigegeben"], json!(false));
    assert_eq!(v[0]["anderer_einsatz"], json!(false));
    assert!(lage(&app, &monitor).await.unwrap()["einsatz"].is_null());

    let (s, v) = freigeben(&app, &admin, einsatz, &monitor.zugang_id).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v[0]["freigegeben"], json!(true));
    // Idempotent: ein zweites Freigeben schreibt keinen zweiten Eintrag.
    freigeben(&app, &admin, einsatz, &monitor.zugang_id).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        zaehle(
            &etb,
            "Einsatz für die Anbindung „FüKW Monitor“ freigegeben von"
        ),
        1,
        "{etb:?}"
    );
    assert_eq!(
        lage(&app, &monitor).await.unwrap()["einsatz"]["bezeichnung"],
        "Stadtfest"
    );
    // Die Seite „Anbindungen“ nennt den gelesenen Einsatz.
    let a = anbindung(&app, &admin, &monitor.zugang_id).await;
    assert_eq!(a["einsatz_id"], json!(einsatz));
    assert_eq!(a["einsatz_bezeichnung"], "Stadtfest");
    let (_, alle) = anfrage(&app, "GET", ANBINDUNGEN, &admin, None).await;
    let zeile = alle["zugaenge"]
        .as_array()
        .unwrap()
        .iter()
        .find(|z| z["id"] == json!(monitor.zugang_id))
        .unwrap();
    assert_eq!(zeile["einsatz_bezeichnung"], "Stadtfest");

    // Ein Zugang ohne Lese-Scope mit Einsatzbezug lässt sich nicht freigeben.
    let (s, _) = freigeben(&app, &admin, einsatz, &adapter.zugang_id).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = freigeben(&app, &admin, einsatz, "gibt-es-nicht").await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let (s, v) = beenden(&app, &admin, einsatz, &monitor.zugang_id).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v[0]["freigegeben"], json!(false));
    beenden(&app, &admin, einsatz, &monitor.zugang_id).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        zaehle(
            &etb,
            "Freigabe für die Anbindung „FüKW Monitor“ beendet von"
        ),
        1,
        "{etb:?}"
    );
    assert!(lage(&app, &monitor).await.unwrap()["einsatz"].is_null());
    let a = anbindung(&app, &admin, &monitor.zugang_id).await;
    assert!(a.get("einsatz_id").is_none() && a.get("einsatz_bezeichnung").is_none());
}

#[tokio::test]
async fn ein_zugang_liest_hoechstens_einen_einsatz_und_abschluss_beendet_die_freigabe() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let erster = einsatz_anlegen_mit(&app, &admin, "Erster").await;
    let zweiter = einsatz_anlegen_mit(&app, &admin, "Zweiter").await;
    let monitor = angebunden_als(
        &app,
        &admin,
        "FüKW Monitor",
        json!(["lage:read"]),
        &schluessel(1),
        IP,
    )
    .await;
    let zweiter_monitor = angebunden_als(
        &app,
        &admin,
        "Wache",
        json!(["lage:read"]),
        &schluessel(2),
        IP,
    )
    .await;
    let zid = monitor.zugang_id.clone();

    freigeben(&app, &admin, erster, &zid).await;
    // Ein Einsatz kann für mehrere Zugänge freigegeben sein.
    freigeben(&app, &admin, erster, &zweiter_monitor.zugang_id).await;
    for cred in [&monitor, &zweiter_monitor] {
        assert_eq!(
            lage(&app, cred).await.unwrap()["einsatz"]["bezeichnung"],
            "Erster"
        );
    }
    let v = liste(&app, &admin, zweiter).await;
    let zeile = v
        .as_array()
        .unwrap()
        .iter()
        .find(|z| z["zugang_id"] == json!(zid))
        .unwrap();
    assert_eq!(zeile["freigegeben"], json!(false));
    assert_eq!(zeile["anderer_einsatz"], json!(true));

    // Umstellen löst den ersten ab, beide ETBs nennen es.
    let (s, v) = freigeben(&app, &admin, zweiter, &zid).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        lage(&app, &monitor).await.unwrap()["einsatz"]["bezeichnung"],
        "Zweiter"
    );
    assert_eq!(
        lage(&app, &zweiter_monitor).await.unwrap()["einsatz"]["bezeichnung"],
        "Erster",
        "der andere Zugang bleibt beim ersten Einsatz"
    );
    let etb = system_etb_inhalte(&app, &admin, erster).await;
    assert_eq!(
        zaehle(
            &etb,
            "Anbindung „FüKW Monitor“ liest jetzt einen anderen Einsatz"
        ),
        1,
        "{etb:?}"
    );
    let etb = system_etb_inhalte(&app, &admin, zweiter).await;
    assert_eq!(
        zaehle(&etb, "Einsatz für die Anbindung „FüKW Monitor“ freigegeben"),
        1,
        "{etb:?}"
    );

    // Beenden am falschen Einsatz wirkt nicht.
    let (s, _) = beenden(&app, &admin, erster, &zid).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        lage(&app, &monitor).await.unwrap()["einsatz"]["bezeichnung"],
        "Zweiter"
    );

    // Abschluss beendet die Freigabe; danach lässt sich nichts mehr freigeben.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{zweiter}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(lage(&app, &monitor).await.unwrap()["einsatz"].is_null());
    assert_eq!(
        freigaben(&pool).await,
        1,
        "nur noch die des ersten Einsatzes"
    );
    let (s, _) = freigeben(&app, &admin, zweiter, &zid).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = beenden(&app, &admin, zweiter, &zid).await;
    assert_eq!(s, StatusCode::CONFLICT);
    // Die Liste bleibt zur Ansicht lesbar.
    let v = liste(&app, &admin, zweiter).await;
    assert!(v
        .as_array()
        .unwrap()
        .iter()
        .all(|z| z["freigegeben"] == json!(false)));
}

#[tokio::test]
async fn freigeben_darf_nur_die_einsatzleitung_und_nur_zugaenge_der_eigenen_org() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let monitor = angebunden_als(
        &app,
        &admin,
        "FüKW Monitor",
        json!(["lage:read"]),
        &schluessel(1),
        IP,
    )
    .await;
    let zid = monitor.zugang_id.clone();

    // Führungspersonal ist nicht die Einsatzleitung.
    let helfer_id = benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    rolle_setzen(&app, &admin, einsatz, helfer_id, "fuehrungspersonal").await;
    let helfer = login_cookie(&app, "helfer", "helferpw1").await;
    let (s, _) = freigeben(&app, &helfer, einsatz, &zid).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = beenden(&app, &helfer, einsatz, &zid).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "GET", &liste_pfad(einsatz), &helfer, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Ein System-Admin ohne Rolle im Einsatz gibt nicht frei: den Einsatz einer Führungskraft
    // sieht er, leitet ihn aber nicht.
    benutzer_anlegen(&app, &admin, "leiterin", "fuehrungskraft").await;
    let chef = login_cookie(&app, "leiterin", "leiterinpw1").await;
    let fremd_geleitet = einsatz_anlegen_mit(&app, &chef, "Übung").await;
    let (s, _) = freigeben(&app, &admin, fremd_geleitet, &zid).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, v) = freigeben(&app, &chef, fremd_geleitet, &zid).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = beenden(&app, &chef, fremd_geleitet, &zid).await;
    assert_eq!(s, StatusCode::OK);

    // Ein Zugang einer fremden Org ist hier unbekannt.
    let (fremde_org, _) = fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw12", "keine").await;
    sqlx::query(
        "INSERT INTO maschinenzugang (id, org_id, name, scopes, zustand) \
         VALUES ('fremder-zugang', ?, 'Fremd', '[\"lage:read\"]', 'aktiv')",
    )
    .bind(fremde_org)
    .execute(&pool)
    .await
    .unwrap();
    let (s, _) = freigeben(&app, &admin, einsatz, "fremder-zugang").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        liste(&app, &admin, einsatz).await.as_array().unwrap().len(),
        1
    );

    // Abgelaufen: nicht mehr im Paneel und nicht mehr freigebbar.
    sqlx::query(
        "UPDATE maschinenzugang SET gueltig_bis = datetime('now', '-1 minute') WHERE id = ?",
    )
    .bind(&zid)
    .execute(&pool)
    .await
    .unwrap();
    let (s, _) = freigeben(&app, &admin, einsatz, &zid).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(liste(&app, &admin, einsatz)
        .await
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(freigaben(&pool).await, 0);
}

#[tokio::test]
async fn widerruf_und_entzug_des_rechts_beenden_die_freigabe() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let monitor = angebunden_als(
        &app,
        &admin,
        "FüKW Monitor",
        json!(["lage:read", "rechner:use"]),
        &schluessel(1),
        IP,
    )
    .await;
    let zid = monitor.zugang_id.clone();
    let pfad = format!("{ANBINDUNGEN}/{zid}");
    freigeben(&app, &admin, einsatz, &zid).await;

    // Eine andere Änderung (Name) lässt die Freigabe stehen.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"name": "FüKW Anzeige"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["einsatz_id"], json!(einsatz), "{v}");
    assert_eq!(
        lage(&app, &monitor).await.unwrap()["einsatz"]["id"],
        json!(einsatz)
    );

    // Entzug von `lage:read`: Freigabe weg, das ETB nennt es.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"scopes": ["rechner:use"]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("einsatz_id").is_none(), "{v}");
    assert_eq!(freigaben(&pool).await, 0);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        zaehle(&etb, "Anbindung „FüKW Anzeige“ darf keine Lage mehr lesen"),
        1,
        "{etb:?}"
    );

    // Bekommt der Zugang das Recht wieder, liest er erst nach einer neuen Freigabe.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"scopes": ["lage:read", "rechner:use"]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(lage(&app, &monitor).await.unwrap()["einsatz"].is_null());
    let v = liste(&app, &admin, einsatz).await;
    assert_eq!(v[0]["freigegeben"], json!(false));
    freigeben(&app, &admin, einsatz, &zid).await;
    assert_eq!(
        lage(&app, &monitor).await.unwrap()["einsatz"]["id"],
        json!(einsatz)
    );

    // Widerruf: 401 für das Fremdsystem, Freigabe weg, ETB und Admin-Spur nennen es.
    let (s, w) = anfrage(&app, "POST", &format!("{pfad}/widerrufen"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{w}");
    assert!(w.get("einsatz_id").is_none());
    assert!(
        lage(&app, &monitor).await.is_none(),
        "401 nach dem Widerruf"
    );
    assert_eq!(freigaben(&pool).await, 0);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        zaehle(&etb, "Anbindung „FüKW Anzeige“ widerrufen von"),
        1,
        "{etb:?}"
    );
    let aktion: String =
        sqlx::query_scalar("SELECT aktion FROM admin_audit ORDER BY id DESC LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(aktion, "maschinenzugang_widerrufen");
    // Ein widerrufener Zugang lässt sich nicht freigeben und steht nicht mehr im Paneel.
    let (s, _) = freigeben(&app, &admin, einsatz, &zid).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(liste(&app, &admin, einsatz)
        .await
        .as_array()
        .unwrap()
        .is_empty());
    // Ein zweiter Widerruf schreibt keinen zweiten ETB-Eintrag.
    anfrage(&app, "POST", &format!("{pfad}/widerrufen"), &admin, None).await;
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(zaehle(&etb, "Anbindung „FüKW Anzeige“ widerrufen von"), 1);
}

/// Spec `maschinenzugang`, „Die Freigabe endet mit Einsatz, Zugang oder Recht“: Verstreicht
/// „gültig bis“, endet die Freigabe. Verlängert der Admin den Zugang danach, liest er erst nach
/// einer neuen Freigabe wieder.
#[tokio::test]
async fn ablauf_beendet_die_freigabe_auch_wenn_der_zugang_verlaengert_wird() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let monitor = angebunden_als(
        &app,
        &admin,
        "FüKW Monitor",
        json!(["lage:read"]),
        &schluessel(1),
        IP,
    )
    .await;
    let zid = monitor.zugang_id.clone();
    let pfad = format!("{ANBINDUNGEN}/{zid}");
    freigeben(&app, &admin, einsatz, &zid).await;
    assert_eq!(
        lage(&app, &monitor).await.unwrap()["einsatz"]["id"],
        json!(einsatz)
    );

    // Abgelaufen: 401 für das Fremdsystem, die Verwaltung nennt keinen Einsatz mehr.
    sqlx::query(
        "UPDATE maschinenzugang SET gueltig_bis = datetime('now', '-1 minute') WHERE id = ?",
    )
    .bind(&zid)
    .execute(&pool)
    .await
    .unwrap();
    assert!(lage(&app, &monitor).await.is_none(), "401 nach dem Ablauf");
    let a = anbindung(&app, &admin, &zid).await;
    assert_eq!(a["einsatz_freigebbar"], json!(false));
    assert!(a.get("einsatz_id").is_none(), "{a}");

    // Verlängert: der Zugang kommt wieder herein, liest aber keinen Einsatz.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({"gueltig_bis": "2099-01-01 00:00:00"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["einsatz_freigebbar"], json!(true), "{v}");
    assert!(v.get("einsatz_id").is_none(), "{v}");
    assert!(
        lage(&app, &monitor).await.unwrap()["einsatz"].is_null(),
        "ohne neue Freigabe kein Einsatz"
    );
    assert_eq!(freigaben(&pool).await, 0);
    let z = liste(&app, &admin, einsatz).await;
    assert_eq!(z[0]["freigegeben"], json!(false));
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        zaehle(
            &etb,
            "für die Anbindung „FüKW Monitor“ ist mit deren Ablauf beendet"
        ),
        1,
        "{etb:?}"
    );

    // Die Einsatzleitung gibt neu frei.
    freigeben(&app, &admin, einsatz, &zid).await;
    assert_eq!(
        lage(&app, &monitor).await.unwrap()["einsatz"]["id"],
        json!(einsatz)
    );
}

/// Die Org des Admins meldet sich bei einem Hub (aktive Kopplung, meldende Seite).
async fn org_an_hub_koppeln(pool: &sqlx::SqlitePool) {
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap();
    let kopplung: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand) VALUES ('hub-1', 'X', 'Hub Kreis', 'meldet_sich', \
         'https://hub.example', 'aktiv') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name) \
         VALUES (?, ?, 'hub-1/1', 'Kreis')",
    )
    .bind(kopplung)
    .bind(org)
    .execute(pool)
    .await
    .unwrap();
}

/// Spec `maschinenzugang`, „Ein gekoppelter ELW nimmt keine Fremdsysteme an“: Meldet sich die
/// Instanz für die Org bei einem Hub, gibt es hier nichts freizugeben, auch nicht für einen
/// Zugang aus der Zeit davor.
#[tokio::test]
async fn am_gekoppelten_elw_bleibt_das_paneel_leer() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let monitor = angebunden_als(
        &app,
        &admin,
        "FüKW Monitor",
        json!(["lage:read"]),
        &schluessel(1),
        IP,
    )
    .await;
    assert_eq!(
        liste(&app, &admin, einsatz).await.as_array().unwrap().len(),
        1
    );

    org_an_hub_koppeln(&pool).await;

    assert!(liste(&app, &admin, einsatz)
        .await
        .as_array()
        .unwrap()
        .is_empty());
    let (s, _) = freigeben(&app, &admin, einsatz, &monitor.zugang_id).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let a = anbindung(&app, &admin, &monitor.zugang_id).await;
    assert_eq!(a["einsatz_freigebbar"], json!(false), "{a}");
}

/// Eine Freigabe von vor der Kopplung ruht am gekoppelten ELW: das Fremdsystem liest nicht, die
/// Einsatzleitung sieht die Zeile und kann die Freigabe beenden. Ohne die Zeile gälte die
/// Freigabe nach dem Ende der Kopplung wieder, ohne dass sie jemand gesehen hätte.
#[tokio::test]
async fn am_gekoppelten_elw_ruht_die_freigabe_und_laesst_sich_beenden() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let monitor = angebunden_als(
        &app,
        &admin,
        "FüKW Monitor",
        json!(["lage:read"]),
        &schluessel(1),
        IP,
    )
    .await;
    let zweiter = angebunden_als(
        &app,
        &admin,
        "Monitor Stab",
        json!(["lage:read"]),
        &schluessel(2),
        IP,
    )
    .await;
    let (s, _) = freigeben(&app, &admin, einsatz, &monitor.zugang_id).await;
    assert_eq!(s, StatusCode::OK);
    let v = liste(&app, &admin, einsatz).await;
    assert_eq!(v.as_array().unwrap().len(), 2, "{v}");
    assert_eq!(v[0]["ruht"], json!(false), "{v}");

    org_an_hub_koppeln(&pool).await;

    // Das Fremdsystem wird abgewiesen, die Freigabe steht weiter in der Tabelle.
    assert!(lage(&app, &monitor).await.is_none());
    assert_eq!(freigaben(&pool).await, 1);
    // Im Paneel steht nur die bestehende Freigabe, als ruhend.
    let v = liste(&app, &admin, einsatz).await;
    assert_eq!(v.as_array().unwrap().len(), 1, "{v}");
    assert_eq!(v[0]["zugang_id"], json!(monitor.zugang_id));
    assert_eq!(v[0]["freigegeben"], json!(true));
    assert_eq!(v[0]["ruht"], json!(true));
    // Neu freigeben geht hier nicht.
    let (s, _) = freigeben(&app, &admin, einsatz, &zweiter.zugang_id).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let (s, v) = beenden(&app, &admin, einsatz, &monitor.zugang_id).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.as_array().unwrap().is_empty(), "{v}");
    assert_eq!(freigaben(&pool).await, 0);
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert_eq!(
        zaehle(
            &etb,
            "Freigabe für die Anbindung „FüKW Monitor“ beendet von"
        ),
        1,
        "{etb:?}"
    );
}

// ── Am Spiegel (design.md D4, D5, D8) ────────────────────────────────────────────────────────

#[tokio::test]
async fn am_spiegel_gilt_die_freigabe_hier_und_das_etb_geht_als_antrag_an_den_fuehrer() {
    use instanz_hilfen::{eine, exec, gekoppelt, lokale_id, melden};

    let (hub, elw) = gekoppelt().await;
    melden(&elw).await;
    // Ein Konto, das der Hub an den ELW verteilt; am ELW leitet es den Einsatz.
    let (s, v) = anfrage_json(
        &hub.app,
        "POST",
        "/api/benutzer",
        &hub.admin,
        Some(&json!({"anzeigename": "Erika", "benutzername": "erika",
                     "passwort": "erikapw12345"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    exec(
        &hub.pool,
        "UPDATE benutzer SET passwort_wechsel_pflicht = 0",
    )
    .await;
    let erika = login_cookie(&hub.app, "erika", "erikapw12345").await;
    melden(&elw).await;
    let erika_elw = lokale_id(&elw, "benutzer", "benutzername", "erika").await;
    let e = einsatz_anlegen_mit(&elw.app, &elw.admin, "Deichbruch").await;
    rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "einsatzleitung").await;
    let abgleichen = || async {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    };
    abgleichen().await;
    let s: i64 = eine(&hub.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;

    // Fremdsysteme kommen am Hub an.
    let monitor = angebunden_als(
        &hub.app,
        &hub.admin,
        "FüKW Monitor",
        json!(["lage:read"]),
        &schluessel(1),
        IP,
    )
    .await;
    let zid = monitor.zugang_id.clone();

    let (status, v) = freigeben(&hub.app, &erika, s, &zid).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v[0]["freigegeben"], json!(true));
    let antrag: (String, String) = sqlx::query_as(
        "SELECT art, json_extract(daten, '$.inhalt') FROM spiegel_antrag WHERE einsatz_id = ?",
    )
    .bind(s)
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert_eq!(antrag.0, "etb");
    assert!(
        antrag
            .1
            .starts_with("Einsatz für die Anbindung „FüKW Monitor“ freigegeben von"),
        "{}",
        antrag.1
    );

    // Die Lage des gespiegelten Einsatzes nennt ihren Abgleich.
    let v = lage(&hub.app, &monitor).await.unwrap();
    assert_eq!(v["einsatz"]["bezeichnung"], "Deichbruch");
    assert_eq!(v["einsatz"]["id"], json!(s));
    assert!(
        v["einsatz"]["spiegel"]["letzter_abgleich_at"].is_string(),
        "{v}"
    );
    assert_eq!(v["einsatz"]["spiegel"]["abgleich_beendet"], json!(false));

    for _ in 0..3 {
        abgleichen().await;
    }
    let am_elw: i64 = eine(
        &elw.pool,
        &format!(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = {e} \
             AND inhalt LIKE 'Einsatz für die Anbindung „FüKW Monitor“ freigegeben%'"
        ),
    )
    .await;
    assert_eq!(am_elw, 1, "der Führer übernimmt den Eintrag");
    // Die Freigabe gilt nur am Hub: sie wird nicht gespiegelt.
    let freigaben_elw: i64 = eine(&elw.pool, "SELECT COUNT(*) FROM maschinenzugang_freigabe").await;
    assert_eq!(freigaben_elw, 0);

    // Ein Admin widerruft eine zweite Anbindung, die den Spiegel liest: kein Antrag ans ETB,
    // der Vorgang steht in der Admin-Spur.
    let zweiter = angebunden_als(
        &hub.app,
        &hub.admin,
        "Wache",
        json!(["lage:read"]),
        &schluessel(2),
        IP,
    )
    .await;
    freigeben(&hub.app, &erika, s, &zweiter.zugang_id).await;
    let antraege_vorher: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM spiegel_antrag").await;
    let (status, w) = anfrage(
        &hub.app,
        "POST",
        &format!("{ANBINDUNGEN}/{}/widerrufen", zweiter.zugang_id),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{w}");
    assert!(lage(&hub.app, &zweiter).await.is_none());
    let antraege: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM spiegel_antrag").await;
    assert_eq!(antraege, antraege_vorher, "Widerruf am Spiegel ohne Antrag");

    // Umstellen, wenn der frühere Einsatz ein Spiegel ist: Der Hinweis geht dort als Antrag, wenn
    // die handelnde Person in ihm zur Führung gehört; sonst entfällt er (der Führer lehnte ihn ab).
    let hier = einsatz_anlegen_mit(&hub.app, &hub.admin, "Sanitätsdienst Markt").await;
    let erika_hub: i64 = eine(
        &hub.pool,
        "SELECT id FROM benutzer WHERE benutzername = 'erika'",
    )
    .await;
    rolle_setzen(&hub.app, &hub.admin, hier, erika_hub, "einsatzleitung").await;
    let umstellungen = || async {
        eine::<i64>(
            &hub.pool,
            &format!(
                "SELECT COUNT(*) FROM spiegel_antrag WHERE einsatz_id = {s} AND \
                 json_extract(daten, '$.inhalt') LIKE '%liest jetzt einen anderen Einsatz%'"
            ),
        )
        .await
    };
    let (status, v) = freigeben(&hub.app, &erika, hier, &zid).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(umstellungen().await, 1, "Erika leitet auch den Spiegel");
    // Zurück auf den Spiegel: der hier geführte Einsatz bekommt seinen Eintrag direkt.
    let (status, v) = freigeben(&hub.app, &erika, s, &zid).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    let etb = system_etb_inhalte(&hub.app, &hub.admin, hier).await;
    assert_eq!(
        zaehle(
            &etb,
            "Anbindung „FüKW Monitor“ liest jetzt einen anderen Einsatz"
        ),
        1,
        "{etb:?}"
    );
    // Der Admin leitet nur den eigenen Einsatz: im Spiegel entsteht kein Antrag.
    let (status, v) = freigeben(&hub.app, &hub.admin, hier, &zid).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(umstellungen().await, 1, "kein Antrag ohne Rolle im Spiegel");
    let (status, v) = freigeben(&hub.app, &erika, s, &zid).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    let antraege: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM spiegel_antrag").await;

    // Endet der Abgleich, gilt das Ende der Freigabe trotzdem; nur der Antrag entfällt.
    exec(
        &hub.pool,
        &format!("UPDATE einsatz_spiegel SET beendet_at = datetime('now') WHERE einsatz_id = {s}"),
    )
    .await;
    let v = lage(&hub.app, &monitor).await.unwrap();
    assert_eq!(v["einsatz"]["spiegel"]["abgleich_beendet"], json!(true));
    let (status, v) = beenden(&hub.app, &erika, s, &zid).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert!(lage(&hub.app, &monitor).await.unwrap()["einsatz"].is_null());
    let antraege_nachher: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM spiegel_antrag").await;
    assert_eq!(antraege_nachher, antraege, "kein Antrag nach dem Abgleich");
}
