//! Zugangsprotokoll über den echten Router (LFH-1097): Anmelde- und Admin-Spur lesen.
//!
//! Gate (nur System-Admin), Lesen ohne eigene Spur, die Filter und das Blättern. Die Zeilen
//! entstehen hier meist per SQL, damit Zeitpunkte und Namen genau feststehen; dass die echten
//! Aktionen sie schreiben, belegen `tests/auth_audit.rs` und `tests/admin_audit.rs`.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, benutzer_anlegen, login_cookie, setup_mit_pool};

const ANMELDUNGEN: &str = "/api/zugangsprotokoll/anmeldungen";
const AENDERUNGEN: &str = "/api/zugangsprotokoll/zugangsaenderungen";

async fn leeren(pool: &sqlx::SqlitePool) {
    sqlx::query("DELETE FROM auth_audit")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM admin_audit")
        .execute(pool)
        .await
        .unwrap();
}

async fn anmeldung(pool: &sqlx::SqlitePool, zeitpunkt: &str, ereignis: &str, name: &str) {
    sqlx::query(
        "INSERT INTO auth_audit (zeitpunkt, ereignis, benutzername, provider) \
         VALUES (?, ?, ?, 'passwort')",
    )
    .bind(zeitpunkt)
    .bind(ereignis)
    .bind(name)
    .execute(pool)
    .await
    .unwrap();
}

async fn aenderung(
    pool: &sqlx::SqlitePool,
    aktion: &str,
    akteur: &str,
    ziel_benutzer_id: Option<i64>,
    ziel: &str,
) {
    sqlx::query(
        "INSERT INTO admin_audit (aktion, akteur_name, ziel_benutzer_id, ziel) VALUES (?, ?, ?, ?)",
    )
    .bind(aktion)
    .bind(akteur)
    .bind(ziel_benutzer_id)
    .bind(ziel)
    .execute(pool)
    .await
    .unwrap();
}

async fn lesen(app: &axum::Router, cookie: &str, uri: &str) -> Vec<Value> {
    let (status, body) = anfrage(app, "GET", uri, cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{uri}: {body}");
    body.as_array().unwrap().clone()
}

fn feld<'a>(zeilen: &'a [Value], name: &str) -> Vec<&'a str> {
    zeilen.iter().map(|z| z[name].as_str().unwrap()).collect()
}

#[tokio::test]
async fn nur_der_system_admin_liest() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "fuehrungskraft").await;
    let fuehrungskraft = login_cookie(&app, "marlene", "marlenepw1").await;

    for uri in [ANMELDUNGEN, AENDERUNGEN] {
        let (ohne, _) = anfrage(&app, "GET", uri, "", None).await;
        assert_eq!(ohne, StatusCode::UNAUTHORIZED, "{uri} ohne Sitzung");
        let (fk, _) = anfrage(&app, "GET", uri, &fuehrungskraft, None).await;
        assert_eq!(fk, StatusCode::FORBIDDEN, "{uri} als Führungskraft");
        let (adm, _) = anfrage(&app, "GET", uri, &admin, None).await;
        assert_eq!(adm, StatusCode::OK, "{uri} als System-Admin");
    }
}

#[tokio::test]
async fn lesen_schreibt_keine_spur() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let zaehlen = || async {
        let a: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_audit")
            .fetch_one(&pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit")
            .fetch_one(&pool)
            .await
            .unwrap();
        (a, b)
    };

    let vorher = zaehlen().await;
    for _ in 0..2 {
        lesen(&app, &admin, ANMELDUNGEN).await;
        lesen(&app, &admin, AENDERUNGEN).await;
    }
    assert_eq!(zaehlen().await, vorher);
}

/// Echte Fehlversuche auf einen Namen ohne Konto: genau die liefert der Kontofilter, ohne
/// Groß-/Kleinschreibung.
#[tokio::test]
async fn versuchter_name_ohne_konto_ist_filterbar() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    leeren(&pool).await;
    for _ in 0..2 {
        let (status, _) = anfrage(
            &app,
            "POST",
            "/api/auth/login",
            "",
            Some(r#"{"benutzername":"root","passwort":"geraten123"}"#),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    anmeldung(&pool, "2026-10-01 08:00:00", "login_ok", "admin").await;

    let zeilen = lesen(&app, &admin, &format!("{ANMELDUNGEN}?konto=ROOT")).await;
    assert_eq!(feld(&zeilen, "benutzername"), ["root", "root"]);
    assert_eq!(
        feld(&zeilen, "ereignis"),
        ["login_fehlgeschlagen", "login_fehlgeschlagen"]
    );
    assert_eq!(feld(&zeilen, "provider"), ["passwort", "passwort"]);
}

#[tokio::test]
async fn anmeldespur_nach_ereignis_und_zeitraum() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    leeren(&pool).await;
    anmeldung(&pool, "2026-10-01 08:00:00", "login_ok", "a").await;
    anmeldung(&pool, "2026-10-02 08:00:00", "login_fehlgeschlagen", "b").await;
    anmeldung(&pool, "2026-10-03 08:00:00", "logout", "c").await;
    anmeldung(&pool, "2026-10-04 08:00:00", "login_fehlgeschlagen", "d").await;

    let fehl = lesen(
        &app,
        &admin,
        &format!("{ANMELDUNGEN}?ereignis=login_fehlgeschlagen"),
    )
    .await;
    assert_eq!(feld(&fehl, "benutzername"), ["d", "b"], "neueste zuerst");

    // Grenzen einschließlich; ISO-8601 wie aus `Date.toISOString()`.
    let zeitraum = lesen(
        &app,
        &admin,
        &format!("{ANMELDUNGEN}?von=2026-10-02T08:00:00Z&bis=2026-10-03T08:00:00.000Z"),
    )
    .await;
    assert_eq!(feld(&zeitraum, "benutzername"), ["c", "b"]);
}

#[tokio::test]
async fn ungueltige_filter_sind_400_und_verdrehter_zeitraum_422() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    for uri in [
        format!("{ANMELDUNGEN}?ereignis=rolle_geaendert"),
        format!("{AENDERUNGEN}?aktion=login_ok"),
        format!("{ANMELDUNGEN}?von=gestern"),
        format!("{AENDERUNGEN}?konto={}", "x".repeat(200)),
    ] {
        let (status, body) = anfrage(&app, "GET", &uri, &admin, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}: {body}");
        assert!(
            body["error"].is_string(),
            "{uri}: Fehler im {{error}}-Format"
        );
    }

    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("{AENDERUNGEN}?von=2026-10-03T00:00:00Z&bis=2026-10-02T00:00:00Z"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

/// „Was hat dieses Konto getan oder erlitten“: Akteur und Zielkonto, nie ein Anmeldeweg
/// gleichen Namens.
#[tokio::test]
async fn kontofilter_trifft_akteur_und_ziel() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let bernd = benutzer_anlegen(&app, &admin, "bernd", "keine").await;
    let carla = benutzer_anlegen(&app, &admin, "carla", "keine").await;
    let doris = benutzer_anlegen(&app, &admin, "doris", "keine").await;
    leeren(&pool).await;
    aenderung(&pool, "benutzer_deaktiviert", "admin", Some(bernd), "bernd").await;
    aenderung(&pool, "benutzer_angelegt", "Bernd", Some(carla), "carla").await;
    aenderung(&pool, "anmeldeweg_deaktiviert", "admin", None, "bernd").await;
    aenderung(&pool, "rolle_geaendert", "admin", Some(doris), "doris").await;

    let zeilen = lesen(&app, &admin, &format!("{AENDERUNGEN}?konto=bernd")).await;
    assert_eq!(
        feld(&zeilen, "aktion"),
        ["benutzer_angelegt", "benutzer_deaktiviert"]
    );

    let nur_rolle = lesen(
        &app,
        &admin,
        &format!("{AENDERUNGEN}?aktion=rolle_geaendert"),
    )
    .await;
    assert_eq!(feld(&nur_rolle, "ziel"), ["doris"]);
}

/// Der Filterwert wird gekürzt wie beim Schreiben, sonst träfe ein langer Name nie.
#[tokio::test]
async fn langer_kontoname_trifft_seinen_gekuerzten_eintrag() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    leeren(&pool).await;
    let lang = "x".repeat(100);
    lifeline_hub::auth::audit::schreibe(
        &pool,
        lifeline_hub::auth::audit::AuditEintrag {
            ereignis: lifeline_hub::auth::audit::Ereignis::LoginFehlgeschlagen,
            benutzername: Some(&lang),
            benutzer_id: None,
            peer_ip: None,
            provider: "passwort",
        },
    )
    .await;

    let zeilen = lesen(&app, &admin, &format!("{ANMELDUNGEN}?konto={lang}")).await;
    assert_eq!(zeilen.len(), 1);
}

#[tokio::test]
async fn blaettern_ueber_vor_id() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    leeren(&pool).await;
    for i in 0..150 {
        aenderung(
            &pool,
            "benutzer_angelegt",
            "admin",
            None,
            &format!("k{i:03}"),
        )
        .await;
    }

    let erste = lesen(&app, &admin, AENDERUNGEN).await;
    assert_eq!(erste.len(), 100, "Vorgabe-Seitengröße");
    assert_eq!(erste[0]["ziel"], "k149");
    let kleinste = erste.last().unwrap()["id"].as_i64().unwrap();

    let zweite = lesen(&app, &admin, &format!("{AENDERUNGEN}?vor_id={kleinste}")).await;
    assert_eq!(zweite.len(), 50);
    assert_eq!(zweite[0]["ziel"], "k049");
    assert_eq!(zweite[49]["ziel"], "k000");

    let eine = lesen(&app, &admin, &format!("{AENDERUNGEN}?limit=0")).await;
    assert_eq!(eine.len(), 1, "limit wird auf mindestens 1 geklemmt");
}
