//! LFH-769: Ein `client_id`-Replay der Offline-Queue liefert nichts, was der Einsatz sonst nicht
//! mehr hergibt. Die sechs idempotenten Melde-Routen unter `EinsatzSchreibfreigabe` prüfen ihren
//! Replay vor `fordere_aktiv` — bis LFH-769 aber auch vor der Lese-Policy (`darf_lesen`): ein
//! Mitglied bekam seinen Eintrag an einem vorgemerkten, geschwärzten oder abgelaufenen Einsatz
//! zurück, obwohl jede Leseroute dort 403 antwortet (Totalsperre, `src/AGENTS.md`,
//! „Aufbewahrung“).
//!
//! Geprüft wird je Route: der gesperrte Replay ist 403 ohne Inhalt, ein unbekannter Schlüssel
//! antwortet dort gleich (kein Orakel, ob es den Schlüssel gibt), und am aktiven Einsatz bleibt
//! der Replay unverändert 201.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

/// Wie der Einsatz für den Leser gesperrt wird.
#[derive(Clone, Copy, Debug)]
enum Sperre {
    /// Purge vorgemerkt (Tombstone `geloescht_at`).
    Vorgemerkt,
    /// Geschwärzt (Tombstone samt `geschwaerzt_at`).
    Geschwaerzt,
    /// Aufbewahrungsfrist abgelaufen, noch nicht vorgemerkt.
    FristAbgelaufen,
}

const ALLE_SPERREN: [Sperre; 3] = [
    Sperre::Vorgemerkt,
    Sperre::Geschwaerzt,
    Sperre::FristAbgelaufen,
];

async fn abschliessen(app: &axum::Router, cookie: &str, e: i64) {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
}

async fn sperren(pool: &sqlx::SqlitePool, e: i64, sperre: Sperre) {
    let sql = match sperre {
        Sperre::Vorgemerkt => {
            "UPDATE einsatz SET retention_bis = '2020-01-01 00:00:00', \
             geloescht_at = '2020-01-02 00:00:00' WHERE id = ?"
        }
        Sperre::Geschwaerzt => {
            "UPDATE einsatz SET retention_bis = '2020-01-01 00:00:00', \
             geloescht_at = '2020-01-02 00:00:00', geschwaerzt_at = '2020-01-03 00:00:00' \
             WHERE id = ?"
        }
        Sperre::FristAbgelaufen => {
            "UPDATE einsatz SET retention_bis = '2020-01-01 00:00:00' WHERE id = ?"
        }
    };
    sqlx::query(sql).bind(e).execute(pool).await.unwrap();
}

/// Eine idempotente Melde-Route mit ihrem ersten Versand: Pfad, Body (mit `client_id`), ein
/// Body mit unbekanntem Schlüssel und der Wortlaut, der im gesperrten Replay nicht stehen darf.
struct Fall {
    route: &'static str,
    url: String,
    body: String,
    body_unbekannt: String,
    geheim: &'static str,
}

async fn post(app: &axum::Router, cookie: &str, url: &str, body: &str) -> (StatusCode, Value) {
    anfrage(app, "POST", url, cookie, Some(body)).await
}

async fn angelegt(app: &axum::Router, cookie: &str, url: &str, body: &str, was: &str) -> Value {
    let (s, v) = post(app, cookie, url, body).await;
    assert_eq!(s, StatusCode::CREATED, "{was}: {v:?}");
    v
}

/// Legt an Einsatz `e` je Route einen Datensatz mit `client_id` an (als `cookie`) und liefert
/// die Fälle für den Replay.
async fn faelle_anlegen(app: &axum::Router, cookie: &str, e: i64) -> Vec<Fall> {
    let basis = format!("/api/einsaetze/{e}");
    let mut faelle = Vec::new();

    let url = format!("{basis}/etb");
    let body = json!({"typ":"meldung","inhalt":"Geheim-ETB Deichbruch","client_id":"r-etb"});
    angelegt(app, cookie, &url, &body.to_string(), "ETB").await;
    faelle.push(Fall {
        route: "etb",
        url,
        body: body.to_string(),
        body_unbekannt: json!({"typ":"meldung","inhalt":"Neu","client_id":"r-etb-neu"}).to_string(),
        geheim: "Geheim-ETB",
    });

    let url = format!("{basis}/personen");
    let body = json!({"name":"Geheim-Person Muster","status":"vermisst","client_id":"r-person"});
    angelegt(app, cookie, &url, &body.to_string(), "Person").await;
    faelle.push(Fall {
        route: "personen",
        url,
        body: body.to_string(),
        body_unbekannt: json!({"name":"Neu","client_id":"r-person-neu"}).to_string(),
        geheim: "Geheim-Person",
    });

    let url = format!("{basis}/meldungen");
    let body = json!({
        "absender":"Florian Nord 1","meldeweg":"funk","ereigniszeit":"2026-06-12 09:00:00",
        "inhalt":"Geheim-Meldung Verletzte","client_id":"r-meldung"
    });
    angelegt(app, cookie, &url, &body.to_string(), "Meldung").await;
    faelle.push(Fall {
        route: "meldungen",
        url,
        body: body.to_string(),
        body_unbekannt: json!({
            "absender":"Florian Nord 1","meldeweg":"funk","ereigniszeit":"2026-06-12 09:00:00",
            "inhalt":"Neu","client_id":"r-meldung-neu"
        })
        .to_string(),
        geheim: "Geheim-Meldung",
    });

    let bezirk = angelegt(
        app,
        cookie,
        &format!("{basis}/betreuung/bezirke"),
        r#"{"bezeichnung":"Geheim-Bezirk Ufer","plan_personen":640,"plan_erhebung":"geschaetzt"}"#,
        "Bezirk",
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let url = format!("{basis}/betreuung/bezirke/{bezirk}/staende");
    let body = json!({"evakuiert":12,"erhebung":"gezaehlt","client_id":"r-stand"});
    angelegt(app, cookie, &url, &body.to_string(), "Stand").await;
    faelle.push(Fall {
        route: "betreuung/staende",
        url,
        body: body.to_string(),
        body_unbekannt: json!({"evakuiert":13,"erhebung":"gezaehlt","client_id":"r-stand-neu"})
            .to_string(),
        geheim: "Geheim-Bezirk",
    });

    let stelle = angelegt(
        app,
        cookie,
        &format!("{basis}/betreuung/stellen"),
        r#"{"bezeichnung":"Geheim-Stelle Halle","art":"notunterkunft","kapazitaet_personen":150}"#,
        "Stelle",
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let url = format!("{basis}/betreuung/stellen/{stelle}/belegungen");
    let body = json!({"belegt":40,"client_id":"r-belegung"});
    angelegt(app, cookie, &url, &body.to_string(), "Belegung").await;
    faelle.push(Fall {
        route: "betreuung/belegungen",
        url,
        body: body.to_string(),
        body_unbekannt: json!({"belegt":41,"client_id":"r-belegung-neu"}).to_string(),
        geheim: "Geheim-Stelle",
    });

    let zid = angelegt(
        app,
        cookie,
        &format!("{basis}/verpflegung/zeitfenster"),
        r#"{"bezeichnung":"Geheim-Fenster Mittag","von_at":"2026-09-24T10:00:00Z","bis_at":"2026-09-24T11:30:00Z","bedarf_kraefte":180,"bedarf_betreute":70}"#,
        "Zeitfenster",
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let url = format!("{basis}/verpflegung/zeitfenster/{zid}/ausgaben");
    let body = json!({"menge":120,"client_id":"r-ausgabe"});
    angelegt(app, cookie, &url, &body.to_string(), "Ausgabe").await;
    faelle.push(Fall {
        route: "verpflegung/ausgaben",
        url,
        body: body.to_string(),
        body_unbekannt: json!({"menge":5,"client_id":"r-ausgabe-neu"}).to_string(),
        geheim: "Geheim-Fenster",
    });

    faelle
}

/// Akzeptanzkriterium 1: Replay an einem vorgemerkten, geschwärzten oder abgelaufenen Einsatz
/// liefert keinen Inhalt — auch nicht der Einsatzleitung, die den Datensatz selbst erfasst hat,
/// und auch nicht dem System-Admin (Totalsperre).
#[tokio::test]
async fn replay_am_gesperrten_einsatz_liefert_keinen_inhalt() {
    for sperre in ALLE_SPERREN {
        let (app, pool) = setup_mit_pool().await;
        let admin = login_cookie(&app, "admin", "startpw12").await;
        let e = einsatz_anlegen(&app, &admin).await;
        let faelle = faelle_anlegen(&app, &admin, e).await;
        abschliessen(&app, &admin, e).await;
        sperren(&pool, e, sperre).await;

        for f in &faelle {
            let (s, v) = post(&app, &admin, &f.url, &f.body).await;
            assert_eq!(
                s,
                StatusCode::FORBIDDEN,
                "{sperre:?} {}: gesperrter Replay muss 403 sein, war {v:?}",
                f.route
            );
            assert!(
                !v.to_string().contains(f.geheim),
                "{sperre:?} {}: Replay trägt Inhalt: {v:?}",
                f.route
            );

            // Kein Orakel: ein unbekannter Schlüssel antwortet am gesperrten Einsatz gleich.
            let (s_neu, v_neu) = post(&app, &admin, &f.url, &f.body_unbekannt).await;
            assert_eq!(
                s_neu, s,
                "{sperre:?} {}: unbekannter Schlüssel muss wie der bekannte antworten: {v_neu:?}",
                f.route
            );
            assert_eq!(v_neu, v, "{sperre:?} {}: gleicher Fehlertext", f.route);
        }
    }
}

/// Nach der Nachlauffrist ist der Einsatz für Führungspersonal gesperrt (nur die
/// Einsatzleitung liest weiter) — der Replay seines eigenen Eintrags auch.
#[tokio::test]
async fn replay_nach_nachlauffrist_fuer_fuehrungspersonal_gesperrt() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fuehr = benutzer_anlegen(&app, &admin, "fuehrer1", "keine").await;
    rolle_setzen(&app, &admin, e, fuehr, "fuehrungspersonal").await;
    let fuehr_cookie = login_cookie(&app, "fuehrer1", "fuehrer1pw1").await;
    let faelle = faelle_anlegen(&app, &fuehr_cookie, e).await;
    abschliessen(&app, &admin, e).await;
    sqlx::query("UPDATE einsatz SET abgeschlossen_at = datetime('now','-25 hours') WHERE id = ?")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();

    // Gegenprobe: die Lese-Policy sperrt ihn dort wirklich.
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &fuehr_cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    for f in &faelle {
        let (s, v) = post(&app, &fuehr_cookie, &f.url, &f.body).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{}: {v:?}", f.route);
        assert!(!v.to_string().contains(f.geheim), "{}: {v:?}", f.route);
    }

    // Die Einsatzleitung liest nach der Nachlauffrist weiter und bekommt den Replay: für sie
    // ändert sich nichts (Totalsperre greift erst mit Frist oder Vormerkung).
    for f in &faelle {
        let (s, v) = post(&app, &admin, &f.url, &f.body).await;
        assert_eq!(s, StatusCode::CREATED, "{}: {v:?}", f.route);
    }
}

/// Akzeptanzkriterium 2: am aktiven Einsatz bleibt der Replay unverändert — 201 mit demselben
/// Datensatz, auch für Führungspersonal.
#[tokio::test]
async fn replay_am_aktiven_einsatz_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fuehr = benutzer_anlegen(&app, &admin, "fuehrer1", "keine").await;
    rolle_setzen(&app, &admin, e, fuehr, "fuehrungspersonal").await;
    let fuehr_cookie = login_cookie(&app, "fuehrer1", "fuehrer1pw1").await;
    let faelle = faelle_anlegen(&app, &fuehr_cookie, e).await;

    for f in &faelle {
        let (s, v) = post(&app, &fuehr_cookie, &f.url, &f.body).await;
        assert_eq!(s, StatusCode::CREATED, "{}: {v:?}", f.route);
        assert!(
            v.to_string().contains(f.geheim),
            "{}: Replay liefert den Datensatz: {v:?}",
            f.route
        );
    }
}
