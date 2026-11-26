//! Positionsbaustein (Helfer-App, Spec `2026-11-24-vakwvkpg-helfer-app-design.md`, Abschnitt
//! „Ortung der Organisation und Positionsbaustein“): eine Schreibstelle für alle Quellen, die
//! ältere Zeitstempel verwirft, die Zeit des Geräts klemmt und das Live-Ereignis auslöst; die
//! Handwege setzen die Quelle `manuell`.
//!
//! Dazu die Fahrzeugortung aus dem Einwurf (LLH-2091, ADR-0103): Kopplung, Übernahme über den
//! Baustein mit Quelle `einwurf`, Drossel und Lebenszyklus. Die Übernahme-Tests rufen
//! `apply_position_tx` mit gebauten Zeitstempeln auf, ohne zu schlafen.

use axum::http::{Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use lifeline_hub::error::AppError;
use lifeline_hub::live::LiveHub;
use lifeline_hub::ortung::uebernahme::{
    apply_position, apply_position_tx, is_nachlauf_vorgemerkt, set_nachlauf_verzoegerung,
    Uebernahme,
};
use lifeline_hub::ortung::{
    klemme_zeitpunkt, loesche_position, publiziere, schreibe_position, Ortungsziel, Positionsquelle,
};
use sqlx::SqlitePool;
use std::time::Duration;
use tower::ServiceExt;

mod common;
use common::*;

type Spalten = (Option<f64>, Option<f64>, Option<String>, Option<String>);

/// Liest über den übergebenen Zugang: der Test-Pool hat eine Verbindung, und die hält der Test
/// beim Schreiben über die Schreibstelle selbst.
async fn spalten<'e>(db: impl sqlx::SqliteExecutor<'e>, tabelle: &str, id: i64) -> Spalten {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT lat, lon, position_quelle, position_aktualisiert_at FROM {tabelle} WHERE id = ?"
    )))
    .bind(id)
    .fetch_one(db)
    .await
    .unwrap()
}

async fn fahrzeug_adhoc(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        cookie,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1","traegerorganisation":"Feuerwehr"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn aeltere_position_wird_verworfen() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let ziel = Ortungsziel::Einheit(eid);
    let mut conn = pool.acquire().await.unwrap();

    let t2 = "2026-11-24T12:00:30Z";
    let t1 = "2026-11-24T12:00:00Z";
    let erst = schreibe_position(
        &mut conn,
        einsatz,
        ziel,
        52.5,
        13.4,
        t2,
        Positionsquelle::Helfer,
    )
    .await
    .unwrap();
    assert!(erst, "die erste Position wird geschrieben");
    let dann = schreibe_position(
        &mut conn,
        einsatz,
        ziel,
        50.0,
        8.0,
        t1,
        Positionsquelle::Helfer,
    )
    .await
    .unwrap();
    assert!(!dann, "eine ältere Position wird verworfen");
    let (lat, lon, quelle, at) = spalten(&mut *conn, "einsatz_einheit", eid).await;
    assert_eq!((lat, lon), (Some(52.5), Some(13.4)), "lat bleibt bei t2");
    assert_eq!(quelle.as_deref(), Some("helfer"));
    assert_eq!(
        at.as_deref(),
        Some("2026-11-24 12:00:30"),
        "kanonisches Zeitformat"
    );

    // Gleich alt oder jünger wird geschrieben, auch aus einer anderen automatischen Quelle.
    let neu = schreibe_position(
        &mut conn,
        einsatz,
        ziel,
        51.0,
        9.0,
        "2026-11-24 12:01:00",
        Positionsquelle::Einwurf,
    )
    .await
    .unwrap();
    assert!(neu);
    let (lat, _, quelle, _) = spalten(&mut *conn, "einsatz_einheit", eid).await;
    assert_eq!(lat, Some(51.0));
    assert_eq!(quelle.as_deref(), Some("einwurf"));

    // Die Quelle `manuell` wird nie verworfen, auch mit älterem Zeitpunkt.
    let hand = schreibe_position(
        &mut conn,
        einsatz,
        ziel,
        49.0,
        7.0,
        t1,
        Positionsquelle::Manuell,
    )
    .await
    .unwrap();
    assert!(hand, "eine Handposition gilt immer");
    let (lat, _, quelle, _) = spalten(&mut *conn, "einsatz_einheit", eid).await;
    assert_eq!(lat, Some(49.0));
    assert_eq!(quelle.as_deref(), Some("manuell"));
}

#[tokio::test]
async fn zukunftszeit_wird_auf_serverzeit_geklemmt() {
    assert_eq!(
        klemme_zeitpunkt("2026-11-24T12:05:00Z", "2026-11-24T12:00:00Z"),
        "2026-11-24T12:00:00Z"
    );
    assert_eq!(
        klemme_zeitpunkt("2026-11-24T12:00:30Z", "2026-11-24T12:00:00Z"),
        "2026-11-24T12:00:30Z",
        "30 s Vorlauf bleiben unverändert"
    );
    assert_eq!(
        klemme_zeitpunkt("2026-11-24T12:01:00Z", "2026-11-24T12:00:00Z"),
        "2026-11-24T12:01:00Z",
        "genau 60 s Vorlauf bleiben unverändert"
    );
    assert_eq!(
        klemme_zeitpunkt("2026-11-24T13:05:00+01:00", "2026-11-24 12:00:00"),
        "2026-11-24 12:00:00",
        "Versatz und kanonisches Format werden verglichen, nicht der Text"
    );
    assert_eq!(
        klemme_zeitpunkt("kaputt", "2026-11-24T12:00:00Z"),
        "2026-11-24T12:00:00Z",
        "ein unlesbarer Gerätezeitpunkt wird die Serverzeit"
    );
}

#[tokio::test]
async fn manuelle_position_setzt_quelle_manuell() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let ef = fahrzeug_adhoc(&app, &admin, einsatz).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Helfer").await;

    for (pfad, tabelle, id) in [
        ("units", "einsatz_einheit", eid),
        ("vehicles", "einsatz_fahrzeug", ef),
        ("personnel", "einsatz_personal", ep),
    ] {
        let uri = format!("/api/incidents/{einsatz}/{pfad}/{id}/position");
        let (s, json) = anfrage(
            &app,
            "PATCH",
            &uri,
            &admin,
            Some(r#"{"lat":52.5,"lon":13.4}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{pfad}: {json}");
        assert_eq!(json["position_quelle"], "manuell", "{pfad}: {json}");
        let at = json["position_aktualisiert_at"]
            .as_str()
            .unwrap_or_default();
        assert!(
            lifeline_hub::zeit::parse(at).is_some(),
            "{pfad}: Zeitpunkt gesetzt, kanonisch: {json}"
        );

        // Nur das Zeichen ändern lässt Quelle und Zeitpunkt stehen.
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {tabelle} SET position_aktualisiert_at = '2026-01-01 00:00:00' WHERE id = ?"
        )))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        let (s, json) = anfrage(
            &app,
            "PATCH",
            &uri,
            &admin,
            Some(r#"{"tz_fachaufgabe":"fuehrung"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{pfad}: {json}");
        assert_eq!(
            json["position_aktualisiert_at"], "2026-01-01 00:00:00",
            "{pfad}"
        );

        // Eine Handposition gilt immer, auch wenn der gespeicherte Zeitpunkt jünger wäre.
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {tabelle} SET position_quelle = 'helfer', \
                    position_aktualisiert_at = '2099-01-01 00:00:00' WHERE id = ?"
        )))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        let (s, json) = anfrage(
            &app,
            "PATCH",
            &uri,
            &admin,
            Some(r#"{"lat":50.0,"lon":8.0}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{pfad}: {json}");
        assert_eq!(json["lat"].as_f64(), Some(50.0), "{pfad}");
        assert_eq!(json["position_quelle"], "manuell", "{pfad}");
        assert_ne!(
            json["position_aktualisiert_at"], "2099-01-01 00:00:00",
            "{pfad}"
        );

        // Löschen leert den Zeitpunkt mit.
        let (s, json) = anfrage(
            &app,
            "PATCH",
            &uri,
            &admin,
            Some(r#"{"lat":null,"lon":null}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{pfad}: {json}");
        let (lat, _, quelle, at) = spalten(&pool, tabelle, id).await;
        assert_eq!(lat, None, "{pfad}");
        assert_eq!(quelle.as_deref(), Some("manuell"), "{pfad}");
        assert_eq!(at, None, "{pfad}: gelöschte Position hat keinen Zeitpunkt");
    }
}

#[tokio::test]
async fn schreibstelle_trifft_fahrzeug_und_person() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_adhoc(&app, &admin, einsatz).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Helfer").await;
    let mut conn = pool.acquire().await.unwrap();
    let t = "2026-11-24T12:00:00Z";

    for (ziel, tabelle, id) in [
        (Ortungsziel::Fahrzeug(ef), "einsatz_fahrzeug", ef),
        (Ortungsziel::Person(ep), "einsatz_personal", ep),
    ] {
        assert!(schreibe_position(
            &mut conn,
            einsatz,
            ziel,
            52.0,
            13.0,
            t,
            Positionsquelle::Helfer
        )
        .await
        .unwrap());
        let (lat, _, quelle, at) = spalten(&mut *conn, tabelle, id).await;
        assert_eq!(lat, Some(52.0));
        assert_eq!(quelle.as_deref(), Some("helfer"));
        assert_eq!(at.as_deref(), Some("2026-11-24 12:00:00"));

        loesche_position(&mut conn, ziel).await.unwrap();
        let (lat, lon, quelle, at) = spalten(&mut *conn, tabelle, id).await;
        assert_eq!((lat, lon), (None, None), "lat/lon werden NULL");
        assert_eq!(
            quelle.as_deref(),
            Some("helfer"),
            "Quelle bleibt als Hinweis"
        );
        assert_eq!(
            at.as_deref(),
            Some("2026-11-24 12:00:00"),
            "Zeitpunkt bleibt"
        );
    }
}

#[tokio::test]
async fn fremdes_ziel_ist_404_und_kaputte_koordinate_422() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, anderer, "Fremd").await;
    let mut conn = pool.acquire().await.unwrap();
    let t = "2026-11-24T12:00:00Z";

    let fremd = schreibe_position(
        &mut conn,
        einsatz,
        Ortungsziel::Einheit(eid),
        52.0,
        13.0,
        t,
        Positionsquelle::Helfer,
    )
    .await;
    assert!(matches!(fremd, Err(AppError::NotFound)), "{fremd:?}");

    let kaputt = schreibe_position(
        &mut conn,
        anderer,
        Ortungsziel::Einheit(eid),
        95.0,
        13.0,
        t,
        Positionsquelle::Helfer,
    )
    .await;
    assert!(
        matches!(kaputt, Err(AppError::UnprocessableEntity(_))),
        "{kaputt:?}"
    );

    let unlesbar = schreibe_position(
        &mut conn,
        anderer,
        Ortungsziel::Einheit(eid),
        52.0,
        13.0,
        "gestern",
        Positionsquelle::Helfer,
    )
    .await;
    assert!(
        matches!(unlesbar, Err(AppError::Validation(_))),
        "{unlesbar:?}"
    );
}

#[tokio::test]
async fn publiziere_loest_das_live_ereignis_des_ziels_aus() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let state = test_state(&pool, &live);
    let kurz = Duration::from_secs(2);
    let mut rx = live.abonniere(einsatz);

    for (ziel, tag, schluessel) in [
        (Ortungsziel::Einheit(7), "einheit", "einheit_id"),
        (Ortungsziel::Fahrzeug(8), "fahrzeug", "fahrzeug_id"),
        (Ortungsziel::Person(9), "personal", "personal_id"),
    ] {
        publiziere(&state, einsatz, ziel);
        let n = recv_until_tag(&mut rx, tag, kurz).await;
        let id = match ziel {
            Ortungsziel::Einheit(i) | Ortungsziel::Fahrzeug(i) | Ortungsziel::Person(i) => i,
        };
        assert!(
            n.data.contains(&format!("\"{schluessel}\":{id}")),
            "{}",
            n.data
        );
    }
}
// ── Fahrzeugortung aus dem Einwurf (LLH-2091, ADR-0103) ────────────────────────────────────

const KENNUNG: &str = "geraet-1";
const T: &str = "2026-11-24 12:00:00";

struct Fix {
    app: axum::Router,
    /// Klartext-Schlüssel des Zugangs; leer, wenn der Zugang direkt in die DB geschrieben wurde.
    schluessel: String,
    pool: SqlitePool,
    org: i64,
    einsatz: i64,
    ef: i64,
    zugang: String,
}

/// Setzt den Org-Schalter „Ortung im Einsatz“ direkt in der DB.
async fn schalter_setzen(pool: &SqlitePool, org: i64, an: bool) {
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, ortung_im_einsatz) VALUES (?1, ?2) \
         ON CONFLICT(org_id) DO UPDATE SET ortung_im_einsatz = ?2",
    )
    .bind(org)
    .bind(i64::from(an))
    .execute(pool)
    .await
    .unwrap();
}

async fn fix() -> Fix {
    let (app, pool) = setup_mit_pool().await;
    fix_auf(app, pool, false).await
}

/// Wie [`fix`], aber über den echten Einwurf erreichbar: Router ohne TLS-Pflicht und ein Zugang
/// mit echtem Schlüssel; der Live-Hub wird mitgeliefert.
async fn fix_fuer_einwurf() -> (Fix, LiveHub) {
    let opt = RouterOptionen {
        demo_daten: false,
        zulassungs_budget: None,
        heic_decoder_verzeichnis: None,
        tls: false,
        einwurf_allow_http: true,
    };
    let (app, pool, live) = setup_mit_optionen_und_live(opt).await;
    (fix_auf(app, pool, true).await, live)
}

async fn fix_auf(app: axum::Router, pool: SqlitePool, echter_zugang: bool) -> Fix {
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        "/api/vehicles",
        &admin,
        Some(r#"{"funkrufname":"Florian 1","kennzeichen":"XX-AB 1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let fz = v["id"].as_i64().unwrap();
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let ef = v["id"].as_i64().unwrap();
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    let benutzer: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (zugang, schluessel) = if echter_zugang {
        let (s, v) = anfrage(
            &app,
            "POST",
            "/api/admin/intake-credentials",
            &admin,
            Some(r#"{"name":"Tracker","scope":"positionen:write"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        (
            v["zugang"]["id"].as_str().unwrap().to_string(),
            v["schluessel"].as_str().unwrap().to_string(),
        )
    } else {
        sqlx::query(
            "INSERT INTO einwurf_zugang (id, org_id, name, scope, schluessel_hash, angelegt_at) \
             VALUES (?, ?, 'Tracker', 'positionen:write', 'hash-ortung', ?)",
        )
        .bind("zugang-ortung")
        .bind(org)
        .bind(T)
        .execute(&pool)
        .await
        .unwrap();
        ("zugang-ortung".to_string(), String::new())
    };
    // Org-Schalter „Ortung im Einsatz“ (ADR-0101) an; die Tests zum Schalter schalten ihn aus.
    schalter_setzen(&pool, org, true).await;
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, kennung, \
         gekoppelt_at, gekoppelt_von) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(ef)
    .bind(einsatz)
    .bind(org)
    .bind(&zugang)
    .bind(KENNUNG)
    .bind(T)
    .bind(benutzer)
    .execute(&pool)
    .await
    .unwrap();
    Fix {
        app,
        schluessel,
        pool,
        org,
        einsatz,
        ef,
        zugang,
    }
}

impl Fix {
    /// Legt (oder ersetzt) die Ablage `position_letzte` der Kennung.
    async fn einwerfen(&self, lat: f64, lon: f64, gemessen: &str, empfangen: &str) {
        sqlx::query(
            "INSERT OR REPLACE INTO position_letzte \
             (org_id, zugang_id, kennung, lat, lon, gemessen_at, empfangen_at, rohdaten) \
             VALUES (?, ?, ?, ?, ?, ?, ?, '{}')",
        )
        .bind(self.org)
        .bind(&self.zugang)
        .bind(KENNUNG)
        .bind(lat)
        .bind(lon)
        .bind(gemessen)
        .bind(empfangen)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn uebernehmen(&self, jetzt: &str) -> Uebernahme {
        let mut conn = self.pool.acquire().await.unwrap();
        apply_position_tx(&mut conn, &self.zugang, KENNUNG, jetzt)
            .await
            .unwrap()
    }

    /// Setzt eine manuelle Position wie die Lagekarte: Quelle `manuell`, Zeitpunkt `at`.
    async fn manuell_setzen(&self, lat: f64, lon: f64, at: &str) {
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET lat = ?, lon = ?, position_quelle = 'manuell', \
             position_aktualisiert_at = ? WHERE id = ?",
        )
        .bind(lat)
        .bind(lon)
        .bind(at)
        .bind(self.ef)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    /// `(lat, lon, quelle, aktualisiert_at)` des Einsatzfahrzeugs.
    async fn stand(&self) -> Spalten {
        spalten(&self.pool, "einsatz_fahrzeug", self.ef).await
    }
}

fn geschrieben(f: &Fix) -> Uebernahme {
    Uebernahme::Geschrieben {
        einsatz_id: f.einsatz,
        ef_id: f.ef,
    }
}

#[tokio::test]
async fn gekoppelte_kennung_schreibt_position_mit_quelle_einwurf_und_messzeit() {
    let f = fix().await;
    f.einwerfen(48.1, 11.5, "2026-11-24 11:59:50", T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    assert_eq!(
        f.stand().await,
        (
            Some(48.1),
            Some(11.5),
            Some("einwurf".into()),
            Some("2026-11-24 11:59:50".into()),
        )
    );
}

#[tokio::test]
async fn ohne_kopplung_aendert_nichts() {
    let f = fix().await;
    sqlx::query("DELETE FROM ortung_kopplung")
        .execute(&f.pool)
        .await
        .unwrap();
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.0, None);
}

/// ADR-0101/ADR-0103: ohne Org-Schalter „Ortung im Einsatz“ schreibt die Übernahme nichts, die
/// Kopplung bleibt stehen; mit dem Schalter kommt der nächste Fix wieder an.
#[tokio::test]
async fn ohne_org_schalter_schreibt_die_uebernahme_nichts() {
    let f = fix().await;
    schalter_setzen(&f.pool, f.org, false).await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.0, None);

    schalter_setzen(&f.pool, f.org, true).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    assert_eq!(f.stand().await.0, Some(48.1));
}

#[tokio::test]
async fn beendetes_fahrzeug_aendert_nichts() {
    let f = fix().await;
    sqlx::query("UPDATE einsatz_fahrzeug SET beendet_at = ? WHERE id = ?")
        .bind(T)
        .bind(f.ef)
        .execute(&f.pool)
        .await
        .unwrap();
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.0, None);
}

#[tokio::test]
async fn abgeschlossener_einsatz_aendert_nichts() {
    let f = fix().await;
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(f.einsatz)
        .execute(&f.pool)
        .await
        .unwrap();
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.0, None);
}

#[tokio::test]
async fn gespiegelter_einsatz_aendert_nichts() {
    let f = fix().await;
    sqlx::query("UPDATE einsatz SET spiegel = 1 WHERE id = ?")
        .bind(f.einsatz)
        .execute(&f.pool)
        .await
        .unwrap();
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.0, None);
}

/// Vorrang nach dem Positionsbaustein: der jüngere Zeitpunkt gewinnt. Ein Fix, der vor dem
/// manuellen Setzen gemessen wurde, wird verworfen; ein später gemessener übernommen.
#[tokio::test]
async fn manuelle_position_bleibt_bis_ein_juenger_gemessener_fix_kommt() {
    let f = fix().await;
    f.manuell_setzen(50.0, 10.0, T).await;
    f.einwerfen(48.1, 11.5, "2026-11-24 11:59:59", T).await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.2.as_deref(), Some("manuell"));
    assert_eq!(f.stand().await.0, Some(50.0));

    f.einwerfen(48.2, 11.6, "2026-11-24 12:00:01", "2026-11-24 12:00:01")
        .await;
    assert_eq!(f.uebernehmen("2026-11-24 12:00:01").await, geschrieben(&f));
    assert_eq!(f.stand().await.2.as_deref(), Some("einwurf"));
    assert_eq!(f.stand().await.0, Some(48.2));
}

/// Eine vorgehende Geräteuhr überholt eine manuelle Position nicht: mehr als 60 s in der Zukunft
/// wird die Messzeit auf die Serverzeit geklemmt (`klemme_zeitpunkt`).
#[tokio::test]
async fn vorgehende_geraeteuhr_wird_auf_die_serverzeit_geklemmt() {
    let f = fix().await;
    f.manuell_setzen(50.0, 10.0, T).await;
    // Die Geräteuhr geht eine Stunde vor; der Server steht eine Minute vor dem manuellen Setzen.
    f.einwerfen(48.1, 11.5, "2026-11-24 13:00:00", "2026-11-24 11:59:00")
        .await;
    assert_eq!(
        f.uebernehmen("2026-11-24 11:59:00").await,
        Uebernahme::Nichts
    );
    assert_eq!(f.stand().await.0, Some(50.0));

    // Ohne manuelle Position steht der Fix mit der Serverzeit statt der Gerätezeit.
    let g = fix().await;
    g.einwerfen(48.1, 11.5, "2026-11-24 13:00:00", T).await;
    assert_eq!(g.uebernehmen(T).await, geschrieben(&g));
    assert_eq!(g.stand().await.3.as_deref(), Some(T));
}

#[tokio::test]
async fn geloeschte_position_wird_vom_naechsten_fix_gesetzt() {
    let f = fix().await;
    // Wie nach dem Löschen der Position: Koordinaten, Quelle und Zeitpunkt sind NULL.
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.stand().await.0, None);
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    assert_eq!(f.stand().await.0, Some(48.1));
}

#[tokio::test]
async fn derselbe_fix_ist_nichts_neues() {
    let f = fix().await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    assert_eq!(
        f.uebernehmen("2026-11-24 12:01:00").await,
        Uebernahme::Nichts
    );
}

#[tokio::test]
async fn zweiter_fix_binnen_15_s_wird_gedrosselt() {
    let f = fix().await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    let vorher = f.stand().await;

    f.einwerfen(48.2, 11.6, "2026-11-24 12:00:05", "2026-11-24 12:00:05")
        .await;
    assert_eq!(
        f.uebernehmen("2026-11-24 12:00:05").await,
        Uebernahme::Gedrosselt { ef_id: f.ef }
    );
    assert_eq!(f.stand().await, vorher);
}

#[tokio::test]
async fn fix_15_s_nach_dem_letzten_wird_wieder_geschrieben() {
    let f = fix().await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    f.einwerfen(48.2, 11.6, "2026-11-24 12:00:15", "2026-11-24 12:00:15")
        .await;
    assert_eq!(f.uebernehmen("2026-11-24 12:00:15").await, geschrieben(&f));
    assert_eq!(
        f.stand().await,
        (
            Some(48.2),
            Some(11.6),
            Some("einwurf".into()),
            Some("2026-11-24 12:00:15".into()),
        )
    );
}

/// Die Drossel misst gegen die gespeicherte Einwurf-Position, nicht gegen eine manuelle: direkt
/// nach dem manuellen Setzen kommt ein jüngerer Fix sofort an.
#[tokio::test]
async fn nach_manueller_position_greift_die_drossel_nicht() {
    let f = fix().await;
    f.manuell_setzen(50.0, 10.0, T).await;
    f.einwerfen(48.1, 11.5, "2026-11-24 12:00:02", "2026-11-24 12:00:02")
        .await;
    assert_eq!(f.uebernehmen("2026-11-24 12:00:02").await, geschrieben(&f));
}

/// Die jetzige Serverzeit minus `s` Sekunden, kanonisch; für die Wege mit echter Uhr.
fn vor_sekunden(s: i64) -> String {
    lifeline_hub::zeit::formatiere_utc(chrono::Utc::now() - chrono::TimeDelta::seconds(s))
}

#[tokio::test]
async fn gedrosselter_fix_merkt_genau_einen_nachlauf_vor() {
    let f = fix().await;
    let erst = vor_sekunden(10);
    f.einwerfen(48.1, 11.5, &erst, &erst).await;
    let state = test_state(&f.pool, &LiveHub::new());
    apply_position(&state, &f.zugang, KENNUNG).await;
    assert_eq!(f.stand().await.0, Some(48.1));
    assert!(!is_nachlauf_vorgemerkt(&f.pool, f.ef));

    let dann = vor_sekunden(5);
    f.einwerfen(48.2, 11.6, &dann, &dann).await;
    apply_position(&state, &f.zugang, KENNUNG).await;
    apply_position(&state, &f.zugang, KENNUNG).await;
    assert_eq!(f.stand().await.0, Some(48.1));
    assert!(is_nachlauf_vorgemerkt(&f.pool, f.ef));
}

/// Ein Positions-Einwurf über den echten Router; liefert Status und Header.
async fn einwurf_position(f: &Fix, lat: f64, lon: f64) -> (StatusCode, axum::http::HeaderMap) {
    let resp = f
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/intake/{}/position?id={KENNUNG}&lat={lat}&lon={lon}",
                    f.schluessel
                ))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    (resp.status(), resp.headers().clone())
}

/// Header ohne die je Antwort wechselnden Kennungen.
fn stabile_header(h: &axum::http::HeaderMap) -> Vec<(String, String)> {
    let mut v: Vec<_> = h
        .iter()
        .filter(|(n, _)| !matches!(n.as_str(), "x-request-id" | "date"))
        .map(|(n, w)| (n.to_string(), w.to_str().unwrap_or_default().to_string()))
        .collect();
    v.sort();
    v
}

#[tokio::test]
async fn einwurf_mit_gekoppelter_kennung_bewegt_das_fahrzeug_und_meldet_live() {
    let (f, live) = fix_fuer_einwurf().await;
    let mut rx = live.abonniere(f.einsatz);
    let (status, _) = einwurf_position(&f, 48.1, 11.5).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let stand = f.stand().await;
    assert_eq!((stand.0, stand.1), (Some(48.1), Some(11.5)));
    assert_eq!(stand.2.as_deref(), Some("einwurf"));
    let n = recv_until_tag(&mut rx, "fahrzeug", std::time::Duration::from_secs(2)).await;
    let data: serde_json::Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(data["fahrzeug_id"].as_i64(), Some(f.ef));
}

#[tokio::test]
async fn einwurf_ohne_kopplung_antwortet_gleich() {
    let (gekoppelt, _) = fix_fuer_einwurf().await;
    let (frei, live) = fix_fuer_einwurf().await;
    sqlx::query("DELETE FROM ortung_kopplung")
        .execute(&frei.pool)
        .await
        .unwrap();
    let mut rx = live.abonniere(frei.einsatz);
    let (s1, h1) = einwurf_position(&gekoppelt, 48.1, 11.5).await;
    let (s2, h2) = einwurf_position(&frei, 48.1, 11.5).await;
    assert_eq!((s1, s2), (StatusCode::NO_CONTENT, StatusCode::NO_CONTENT));
    assert_eq!(stabile_header(&h1), stabile_header(&h2));
    assert_eq!(frei.stand().await.0, None);
    assert!(objekt_ereignisse(&mut rx, &[("fahrzeug", "fahrzeug_id")]).is_empty());
}

#[tokio::test]
async fn einwurf_nach_abschluss_aendert_kein_fahrzeug() {
    let (f, live) = fix_fuer_einwurf().await;
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(f.einsatz)
        .execute(&f.pool)
        .await
        .unwrap();
    let mut rx = live.abonniere(f.einsatz);
    let (status, _) = einwurf_position(&f, 48.1, 11.5).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(f.stand().await.0, None);
    assert!(objekt_ereignisse(&mut rx, &[("fahrzeug", "fahrzeug_id")]).is_empty());
}

#[tokio::test]
async fn aelterer_fix_stoesst_nichts_an() {
    let (f, live) = fix_fuer_einwurf().await;
    let (status, _) = einwurf_position(&f, 48.1, 11.5).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let vorher = f.stand().await;
    let mut rx = live.abonniere(f.einsatz);
    // Ein Fix mit älterer Messzeit wird abgelegt als `Aelter` und darf nichts anstoßen.
    let resp = f
        .app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/api/v1/intake/{}/position?id={KENNUNG}&lat=1&lon=2&timestamp=2000-01-01T00:00:00Z",
                    f.schluessel
                ))
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    assert_eq!(f.stand().await, vorher);
    assert!(objekt_ereignisse(&mut rx, &[("fahrzeug", "fahrzeug_id")]).is_empty());
}

// ── Koppeln, Trennen, Kandidaten (Routen) ───────────────────────────────────────────────────

impl Fix {
    fn pfad(&self) -> String {
        format!(
            "/api/incidents/{}/vehicles/{}/tracking",
            self.einsatz, self.ef
        )
    }

    /// Nimmt die Kopplung der Fixture weg, damit die Route sie neu anlegen kann.
    async fn kopplung_loeschen(&self) {
        sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ?")
            .bind(self.ef)
            .execute(&self.pool)
            .await
            .unwrap();
    }

    async fn kopplungen(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM ortung_kopplung")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    async fn ortung_etb(&self, cookie: &str) -> Vec<String> {
        system_etb_inhalte(&self.app, cookie, self.einsatz)
            .await
            .into_iter()
            .filter(|t| t.starts_with("Ortung "))
            .collect()
    }

    async fn zugang_anlegen(&self, id: &str, org: i64, scope: &str, widerrufen: bool) {
        sqlx::query(
            "INSERT INTO einwurf_zugang (id, org_id, name, scope, schluessel_hash, angelegt_at, \
             widerrufen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(org)
        .bind(format!("Zugang {id}"))
        .bind(scope)
        .bind(format!("hash-{id}"))
        .bind(T)
        .bind(widerrufen.then_some(T))
        .execute(&self.pool)
        .await
        .unwrap();
    }
}

async fn vor_stunden(pool: &SqlitePool, h: i64) -> String {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT datetime('now', '-{h} hours')"
    )))
    .fetch_one(pool)
    .await
    .unwrap()
}

fn koppel_body(f: &Fix) -> String {
    format!(r#"{{"access_id":"{}","device_id":"{KENNUNG}"}}"#, f.zugang)
}

#[tokio::test]
async fn koppeln_schreibt_etb_und_uebernimmt_vorhandene_position() {
    let f = fix().await;
    f.kopplung_loeschen().await;
    f.einwerfen(48.1, 11.5, T, T).await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(&f.app, "PUT", &f.pfad(), &admin, Some(&koppel_body(&f))).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ortung_gekoppelt"], true);
    assert_eq!(v["position_quelle"], "einwurf");
    assert_eq!(v["lat"], 48.1);
    assert_eq!(
        f.ortung_etb(&admin).await,
        ["Ortung gekoppelt: Florian 1 (Tracker / geraet-1)"]
    );
    let (s, v) = anfrage(&f.app, "GET", &f.pfad(), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["access_id"], f.zugang.as_str());
    assert_eq!(v["access_name"], "Tracker");
    assert_eq!(v["device_id"], KENNUNG);
    assert!(v["coupled_at"].is_string());
    let schluessel: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        schluessel.len(),
        4,
        "keine Bestätigung mehr an der Kopplung: {v}"
    );
}

/// ADR-0101/ADR-0103: Koppeln braucht den Org-Schalter „Ortung im Einsatz“. Aus ist ein Zustand,
/// kein kaputtes Feld: 422 (`src/AGENTS.md`, Statuscode-Konvention) mit lesbarem Grund, keine
/// Kopplung, kein ETB-Eintrag.
#[tokio::test]
async fn koppeln_bei_ausgeschaltetem_org_schalter_ist_422() {
    let f = fix().await;
    f.kopplung_loeschen().await;
    schalter_setzen(&f.pool, f.org, false).await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(&f.app, "PUT", &f.pfad(), &admin, Some(&koppel_body(&f))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("Ortung ist für diese Organisation ausgeschaltet"),
        "{v}"
    );
    assert_eq!(f.kopplungen().await, 0);
    assert!(f.ortung_etb(&admin).await.is_empty());
}

/// Ein Body mit dem früheren Feld `volunteer_crew_confirmed` stört nicht; es gibt keine
/// Bestätigung „Besatzung ehrenamtlich“ mehr.
#[tokio::test]
async fn koppeln_ignoriert_die_fruehere_ehrenamt_bestaetigung() {
    let f = fix().await;
    f.kopplung_loeschen().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let body = format!(
        r#"{{"access_id":"{}","device_id":"{KENNUNG}","volunteer_crew_confirmed":false}}"#,
        f.zugang
    );
    let (s, v) = anfrage(&f.app, "PUT", &f.pfad(), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(f.kopplungen().await, 1);
}

#[tokio::test]
async fn belegte_kennung_ist_409() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(
        &f.app,
        "POST",
        "/api/vehicles",
        &admin,
        Some(r#"{"funkrufname":"Florian 2"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/vehicles", f.einsatz),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{}}}"#, v["id"])),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let ef2 = v["id"].as_i64().unwrap();
    // Die Kennung hängt aus der Fixture an `f.ef`.
    let pfad = format!("/api/incidents/{}/vehicles/{ef2}/tracking", f.einsatz);
    let (s, _) = anfrage(&f.app, "PUT", &pfad, &admin, Some(&koppel_body(&f))).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(f.kopplungen().await, 1);
    assert!(f.ortung_etb(&admin).await.is_empty());
    // Ein erneutes PUT am selben Fahrzeug ersetzt dessen Kopplung.
    let (s, _) = anfrage(&f.app, "PUT", &f.pfad(), &admin, Some(&koppel_body(&f))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(f.kopplungen().await, 1);
}

#[tokio::test]
async fn koppeln_im_gespiegelten_einsatz_ist_409_ohne_etb() {
    let f = fix().await;
    f.kopplung_loeschen().await;
    sqlx::query("UPDATE einsatz SET spiegel = 1 WHERE id = ?")
        .bind(f.einsatz)
        .execute(&f.pool)
        .await
        .unwrap();
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(&f.app, "PUT", &f.pfad(), &admin, Some(&koppel_body(&f))).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(f.kopplungen().await, 0);
    assert!(f.ortung_etb(&admin).await.is_empty());
}

#[tokio::test]
async fn fremder_oder_falscher_zugang_ist_422() {
    let f = fix().await;
    f.kopplung_loeschen().await;
    let (fremde_org, _) =
        fremde_org_anlegen(&f.pool, "Fremd", "fremder", "fremderpw1", "keine").await;
    f.zugang_anlegen("zugang-fremd", fremde_org, "positionen:write", false)
        .await;
    f.zugang_anlegen("zugang-alarm", f.org, "alarmmeldungen:write", false)
        .await;
    f.zugang_anlegen("zugang-widerrufen", f.org, "positionen:write", true)
        .await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    for id in [
        "zugang-fremd",
        "zugang-alarm",
        "zugang-widerrufen",
        "gibt-es-nicht",
    ] {
        let body = format!(r#"{{"access_id":"{id}","device_id":"{KENNUNG}"}}"#);
        let (s, v) = anfrage(&f.app, "PUT", &f.pfad(), &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{id}: {v}");
    }
    assert_eq!(f.kopplungen().await, 0);
}

#[tokio::test]
async fn lesende_rolle_darf_nicht_koppeln() {
    let f = fix().await;
    f.kopplung_loeschen().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let erika = benutzer_anlegen(&f.app, &admin, "erika", "keine").await;
    rolle_setzen(&f.app, &admin, f.einsatz, erika, "beobachter").await;
    let cookie = login_cookie(&f.app, "erika", "erikapw1").await;
    let (s, _) = anfrage(&f.app, "PUT", &f.pfad(), &cookie, Some(&koppel_body(&f))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&f.app, "DELETE", &f.pfad(), &cookie, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(f.kopplungen().await, 0);
}

#[tokio::test]
async fn trennen_schreibt_etb_und_laesst_die_position_stehen() {
    let f = fix().await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, _) = anfrage(&f.app, "DELETE", &f.pfad(), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(f.kopplungen().await, 0);
    let (lat, lon, quelle, _) = f.stand().await;
    assert_eq!(
        (lat, lon, quelle.as_deref()),
        (Some(48.1), Some(11.5), Some("einwurf"))
    );
    assert_eq!(f.ortung_etb(&admin).await, ["Ortung getrennt: Florian 1"]);
    // Ohne Kopplung gibt es nichts zu trennen: 404, kein zweiter ETB-Eintrag.
    let (s, _) = anfrage(&f.app, "DELETE", &f.pfad(), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(f.ortung_etb(&admin).await.len(), 1);
    let (s, _) = anfrage(&f.app, "GET", &f.pfad(), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn kandidaten_ohne_koordinaten_ohne_fremde_org_ohne_widerrufene_und_ohne_alte() {
    let f = fix().await;
    let jung = vor_stunden(&f.pool, 1).await;
    let alt = vor_stunden(&f.pool, 25).await;
    f.einwerfen(48.1, 11.5, &jung, &jung).await;
    let (fremde_org, _) =
        fremde_org_anlegen(&f.pool, "Fremd", "fremder", "fremderpw1", "keine").await;
    f.zugang_anlegen("zugang-fremd", fremde_org, "positionen:write", false)
        .await;
    f.zugang_anlegen("zugang-alarm", f.org, "alarmmeldungen:write", false)
        .await;
    f.zugang_anlegen("zugang-widerrufen", f.org, "positionen:write", true)
        .await;
    f.zugang_anlegen("zugang-zweit", f.org, "positionen:write", false)
        .await;
    for (zugang, org, kennung, at) in [
        ("zugang-fremd", fremde_org, "x1", &jung),
        ("zugang-alarm", f.org, "x2", &jung),
        ("zugang-widerrufen", f.org, "x3", &jung),
        ("zugang-zweit", f.org, "alt", &alt),
        ("zugang-zweit", f.org, "frei", &jung),
    ] {
        sqlx::query(
            "INSERT INTO position_letzte (org_id, zugang_id, kennung, lat, lon, gemessen_at, \
             empfangen_at, rohdaten) VALUES (?, ?, ?, 1.5, 2.5, ?, ?, '{}')",
        )
        .bind(org)
        .bind(zugang)
        .bind(kennung)
        .bind(at)
        .bind(at)
        .execute(&f.pool)
        .await
        .unwrap();
    }
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(
        &f.app,
        "GET",
        &format!("{}/candidates", f.pfad()),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let liste = v["candidates"].as_array().unwrap();
    let mut gesehen: Vec<(&str, &str, bool)> = liste
        .iter()
        .map(|k| {
            (
                k["access_id"].as_str().unwrap(),
                k["device_id"].as_str().unwrap(),
                k["coupled"].as_bool().unwrap(),
            )
        })
        .collect();
    gesehen.sort();
    assert_eq!(
        gesehen,
        [
            ("zugang-ortung", KENNUNG, true),
            ("zugang-zweit", "frei", false)
        ]
    );
    for k in liste {
        let schluessel: Vec<&str> = k.as_object().unwrap().keys().map(String::as_str).collect();
        assert!(
            !schluessel.contains(&"lat") && !schluessel.contains(&"lon"),
            "{k}"
        );
        assert!(k["received_at"].is_string());
        assert!(k["access_name"].is_string());
    }
}

#[tokio::test]
async fn abgelaufener_zugang_ist_422_beim_koppeln() {
    let f = fix().await;
    f.kopplung_loeschen().await;
    f.zugang_anlegen("zugang-abgelaufen", f.org, "positionen:write", false)
        .await;
    sqlx::query("UPDATE einwurf_zugang SET gueltig_bis = datetime('now', '-1 hours') WHERE id = ?")
        .bind("zugang-abgelaufen")
        .execute(&f.pool)
        .await
        .unwrap();
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let body = format!(r#"{{"access_id":"zugang-abgelaufen","device_id":"{KENNUNG}"}}"#);
    let (s, v) = anfrage(&f.app, "PUT", &f.pfad(), &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(f.kopplungen().await, 0);
}

#[tokio::test]
async fn abgelaufener_zugang_erscheint_nicht_in_den_kandidaten() {
    let f = fix().await;
    f.zugang_anlegen("zugang-abgelaufen", f.org, "positionen:write", false)
        .await;
    sqlx::query("UPDATE einwurf_zugang SET gueltig_bis = datetime('now', '-1 hours') WHERE id = ?")
        .bind("zugang-abgelaufen")
        .execute(&f.pool)
        .await
        .unwrap();
    let jung = vor_stunden(&f.pool, 1).await;
    sqlx::query(
        "INSERT INTO position_letzte (org_id, zugang_id, kennung, lat, lon, gemessen_at, \
         empfangen_at, rohdaten) VALUES (?, 'zugang-abgelaufen', 'x', 1.5, 2.5, ?, ?, '{}')",
    )
    .bind(f.org)
    .bind(&jung)
    .bind(&jung)
    .execute(&f.pool)
    .await
    .unwrap();
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(
        &f.app,
        "GET",
        &format!("{}/candidates", f.pfad()),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .all(|k| k["access_id"] != "zugang-abgelaufen"));
}

/// Die Kandidatenliste nennt den Org-Schalter, damit der Dialog erklärt, warum Koppeln gesperrt
/// ist; die Org-Einstellungen selbst darf die Rolle nicht lesen.
#[tokio::test]
async fn kandidaten_nennen_den_org_schalter() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let pfad = format!("{}/candidates", f.pfad());
    let (s, v) = anfrage(&f.app, "GET", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["tracking_enabled"], true, "{v}");
    assert!(v.get("volunteer_crew_required").is_none(), "{v}");
    schalter_setzen(&f.pool, f.org, false).await;
    let (s, v) = anfrage(&f.app, "GET", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["tracking_enabled"], false, "{v}");
}

// ── Lebenszyklus: Entlassen, Stornieren, Abschluss, Rückgängig (LLH-2091, Task 6) ───────────

impl Fix {
    /// Disponiert ein weiteres Stamm-Fahrzeug in den Einsatz und liefert seine `ef_id`.
    async fn weiteres_fahrzeug(&self, cookie: &str, funkrufname: &str) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            "/api/vehicles",
            cookie,
            Some(&format!(r#"{{"funkrufname":"{funkrufname}"}}"#)),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED);
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/incidents/{}/vehicles", self.einsatz),
            cookie,
            Some(&format!(r#"{{"fahrzeug_id":{}}}"#, v["id"])),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED);
        v["id"].as_i64().unwrap()
    }

    fn fahrzeug_pfad(&self, ef: i64, aktion: &str) -> String {
        format!("/api/incidents/{}/vehicles/{ef}/{aktion}", self.einsatz)
    }

    /// Entlassen mit Antwort; liefert den Vorzustand als JSON.
    async fn entlassen(&self, cookie: &str) -> serde_json::Value {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.fahrzeug_pfad(self.ef, "stand-down"),
            cookie,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v["vorzustand"].clone()
    }

    async fn zuruecknehmen(
        &self,
        cookie: &str,
        vorzustand: &serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        anfrage(
            &self.app,
            "POST",
            &self.fahrzeug_pfad(self.ef, "stand-down/undo"),
            cookie,
            Some(&vorzustand.to_string()),
        )
        .await
    }

    async fn hat_kopplung(&self, ef: i64) -> bool {
        sqlx::query_scalar("SELECT COUNT(*) > 0 FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ?")
            .bind(ef)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn entlassen_trennt_die_ortung_mit_etb() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    let vorzustand = f.entlassen(&admin).await;
    assert_eq!(vorzustand["ortung"]["zugang_id"], f.zugang.as_str());
    assert_eq!(vorzustand["ortung"]["kennung"], KENNUNG);
    assert!(vorzustand["ortung"].get("ehrenamt_bestaetigt").is_none());
    assert!(!f.hat_kopplung(f.ef).await);
    assert_eq!(f.ortung_etb(&admin).await, ["Ortung getrennt: Florian 1"]);
    // Die Position bleibt als letzter Stand stehen.
    assert_eq!(f.stand().await.2.as_deref(), Some("einwurf"));
}

#[tokio::test]
async fn stornieren_trennt_die_ortung_mit_etb() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &f.fahrzeug_pfad(f.ef, "annul"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    assert!(!f.hat_kopplung(f.ef).await);
    assert_eq!(f.ortung_etb(&admin).await, ["Ortung getrennt: Florian 1"]);
}

#[tokio::test]
async fn abschluss_trennt_alle_kopplungen_und_loescht_gps_positionen_aber_keine_manuellen() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    // Zweites Fahrzeug mit manueller Position und eigener Kopplung.
    let ef2 = f.weiteres_fahrzeug(&admin, "Florian 2").await;
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET lat = 1.5, lon = 2.5, position_quelle = 'manuell', \
         position_aktualisiert_at = ?1 WHERE id = ?2",
    )
    .bind(T)
    .bind(ef2)
    .execute(&f.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, kennung, \
         gekoppelt_at, gekoppelt_von) \
         SELECT ?, einsatz_id, org_id, zugang_id, 'geraet-2', gekoppelt_at, gekoppelt_von \
         FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ?",
    )
    .bind(ef2)
    .bind(f.ef)
    .execute(&f.pool)
    .await
    .unwrap();
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/close", f.einsatz),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(f.kopplungen().await, 0);
    // Die Einwurf-Position ist gelöscht; Quelle und Zeitpunkt bleiben als Hinweis (Baustein).
    let (lat, lon, quelle, _) = f.stand().await;
    assert_eq!((lat, lon, quelle.as_deref()), (None, None, Some("einwurf")));
    let manuell: (Option<f64>, Option<String>) =
        sqlx::query_as("SELECT lat, position_quelle FROM einsatz_fahrzeug WHERE id = ?")
            .bind(ef2)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(manuell, (Some(1.5), Some("manuell".to_string())));
    let mut etb = f.ortung_etb(&admin).await;
    etb.sort();
    assert_eq!(
        etb,
        ["Ortung getrennt: Florian 1", "Ortung getrennt: Florian 2"]
    );
}

#[tokio::test]
async fn abschluss_ohne_kopplung_schreibt_keinen_ortung_etb() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    f.kopplung_loeschen().await;
    let (s, _) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/close", f.einsatz),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(f.ortung_etb(&admin).await.is_empty());
}

#[tokio::test]
async fn rueckgaengig_nach_entlassen_stellt_die_kopplung_her() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let vorzustand = f.entlassen(&admin).await;
    assert!(!f.hat_kopplung(f.ef).await);
    let (s, v) = f.zuruecknehmen(&admin, &vorzustand).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ausgelassen"].as_array().unwrap().len(), 0, "{v}");
    assert_eq!(v["fahrzeug"]["ortung_gekoppelt"], true);
    let (s, k) = anfrage(&f.app, "GET", &f.pfad(), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(k["device_id"], KENNUNG);
    assert_eq!(k["access_id"], f.zugang.as_str());
    assert_eq!(
        f.ortung_etb(&admin).await,
        [
            // Neuester Eintrag zuerst.
            "Ortung gekoppelt: Florian 1 (Tracker / geraet-1)",
            "Ortung getrennt: Florian 1",
        ]
    );
}

#[tokio::test]
async fn rueckgaengig_laesst_die_kopplung_aus_wenn_die_kennung_inzwischen_belegt_ist() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let vorzustand = f.entlassen(&admin).await;
    // Dieselbe Kennung hängt jetzt an Fahrzeug B.
    let ef_b = f.weiteres_fahrzeug(&admin, "Florian 2").await;
    let pfad_b = format!("/api/incidents/{}/vehicles/{ef_b}/tracking", f.einsatz);
    let (s, _) = anfrage(&f.app, "PUT", &pfad_b, &admin, Some(&koppel_body(&f))).await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = f.zuruecknehmen(&admin, &vorzustand).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let ausgelassen = v["ausgelassen"].as_array().unwrap();
    assert_eq!(ausgelassen.len(), 1, "{v}");
    assert_eq!(ausgelassen[0]["bezeichnung"], "Ortung");
    assert!(!f.hat_kopplung(f.ef).await);
    assert!(f.hat_kopplung(ef_b).await);
    assert_eq!(v["fahrzeug"]["ortung_gekoppelt"], false);
    let etb = system_etb_inhalte(&f.app, &admin, f.einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Entlassung zurückgenommen, ohne Ortung (")),
        "{etb:?}"
    );
}

#[tokio::test]
async fn rueckgaengig_prueft_zugang_der_org() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    // Ein Zugang einer anderen Org, ein widerrufener, einer mit falschem Scope und ein
    // erfundener werden nie gekoppelt.
    sqlx::query("INSERT INTO organisation (id, name) VALUES (99, 'Fremd')")
        .execute(&f.pool)
        .await
        .unwrap();
    f.zugang_anlegen("zugang-fremd", 99, "positionen:write", false)
        .await;
    f.zugang_anlegen("zugang-widerrufen", f.org, "positionen:write", true)
        .await;
    f.zugang_anlegen("zugang-scope", f.org, "alarmmeldungen:write", false)
        .await;
    for zugang in [
        "zugang-fremd",
        "zugang-widerrufen",
        "zugang-scope",
        "gibt-es-nicht",
    ] {
        // Der Riegel (`entlassen_at`) ist nach jeder Rücknahme verbraucht: erneut entlassen und
        // eine Ortung mit dem untergeschobenen Zugang mitschicken.
        let mut vorzustand = f.entlassen(&admin).await;
        vorzustand["ortung"] = serde_json::json!({
            "zugang_id": zugang,
            "kennung": KENNUNG,
        });
        let (s, v) = f.zuruecknehmen(&admin, &vorzustand).await;
        assert_eq!(s, StatusCode::OK, "{zugang}: {v}");
        assert_eq!(
            v["ausgelassen"][0]["bezeichnung"], "Ortung",
            "{zugang}: {v}"
        );
        assert!(!f.hat_kopplung(f.ef).await, "{zugang}");
    }
}

#[tokio::test]
async fn rueckgaengig_bei_ausgeschaltetem_org_schalter_laesst_die_kopplung_aus() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let vorzustand = f.entlassen(&admin).await;
    schalter_setzen(&f.pool, f.org, false).await;
    let (s, v) = f.zuruecknehmen(&admin, &vorzustand).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ausgelassen"][0]["bezeichnung"], "Ortung", "{v}");
    assert!(
        v["ausgelassen"][0]["grund"]
            .as_str()
            .unwrap()
            .contains("ausgeschaltet"),
        "{v}"
    );
    assert!(!f.hat_kopplung(f.ef).await);
}

#[tokio::test]
async fn rueckgaengig_ohne_ortung_im_vorzustand_koppelt_nichts() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    f.kopplung_loeschen().await;
    let mut vorzustand = f.entlassen(&admin).await;
    assert!(vorzustand["ortung"].is_null());
    vorzustand.as_object_mut().unwrap().remove("ortung");
    let (s, v) = f.zuruecknehmen(&admin, &vorzustand).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ausgelassen"].as_array().unwrap().len(), 0);
    assert_eq!(f.kopplungen().await, 0);
}

#[tokio::test]
async fn wiedereroeffnen_stellt_keine_kopplung_her() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, _) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/close", f.einsatz),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/reopen", f.einsatz),
        &admin,
        Some(r#"{"grund":"Falscher Einsatz abgeschlossen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(f.kopplungen().await, 0);
}

/// ADR-0103: keine Tabelle hält einen Positionsverlauf. Jede Tabelle mit den Spalten `lat` und
/// `lon` steht in einer der beiden Listen: Karten- und Lagedaten, die eine Einsatzkraft selbst
/// setzt (je Zeile ein Ort, kein Messverlauf), oder Positionsablagen, deren eindeutiger Schlüssel
/// höchstens eine Zeile je Fahrzeug bzw. Kennung erlaubt. Eine neue Tabelle mit `lat`/`lon` macht
/// den Test rot, bis sie hier bewusst einsortiert ist.
#[tokio::test]
async fn keine_tabelle_haelt_einen_positionsverlauf() {
    /// Ein Ort je Zeile, von Menschen gesetzt; keine Messreihe eines Geräts.
    const ORTE_VON_MENSCHEN: &[&str] = &[
        "bereitstellungsraum",
        "betreuungsstelle",
        "einsatz_einheit",
        "einsatz_personal",
        "einsatz_schaden",
        "freies_zeichen",
        "meldung",
        "uhs",
        "verpflegungsstelle",
    ];
    /// Positionsablagen mit dem Schlüssel, der die Zeilen je Fahrzeug bzw. Kennung begrenzt.
    const POSITIONSABLAGEN: &[(&str, &[&str])] = &[
        ("einsatz_fahrzeug", &["id"]),
        ("position_letzte", &["zugang_id", "kennung"]),
    ];

    let pool = lifeline_hub::db::test_pool().await;
    let tabellen: Vec<String> = sqlx::query_scalar(
        "SELECT m.name FROM sqlite_master m WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
         AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'lat') \
         AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'lon') \
         ORDER BY m.name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for t in &tabellen {
        let ablage = POSITIONSABLAGEN.iter().find(|(n, _)| n == t);
        if let Some((_, schluessel)) = ablage {
            // Die Spalten des Primärschlüssels sind genau die erlaubten.
            let pk: Vec<String> = sqlx::query_scalar(
                "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
            )
            .bind(t)
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(&pk, schluessel, "Primärschlüssel von {t}");
        } else {
            assert!(
                ORTE_VON_MENSCHEN.contains(&t.as_str()),
                "Tabelle {t} hat lat und lon: ein Positionsverlauf ist nach ADR-0103 verboten; \
                 gehört sie zu den von Menschen gesetzten Orten, in die Liste eintragen"
            );
        }
    }
    for (n, _) in POSITIONSABLAGEN {
        assert!(tabellen.iter().any(|t| t == n), "{n} fehlt");
    }
}

// ── Review-Nachträge (LLH-2091) ────────────────────────────────────────────────────────────

#[tokio::test]
async fn abweisen_einer_einheit_trennt_die_ortung_mit_etb_und_meldet_live() {
    let (f, live) = fix_fuer_einwurf().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/staging-areas", f.einsatz),
        &admin,
        Some(r#"{"bezeichnung":"Sportplatz"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let br = v["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/staging-areas/{br}/status", f.einsatz),
        &admin,
        Some(r#"{"status":"aktiv"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/staging-areas/{br}/arrival", f.einsatz),
        &admin,
        Some(r#"{"unangemeldet":{"fahrzeuge":[{"funkrufname":"Florian 7"}]}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let einheit = v["einheit_id"].as_i64().unwrap();
    let ef2 = v["fahrzeug_ids"][0].as_i64().unwrap();
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, kennung, \
         gekoppelt_at, gekoppelt_von) \
         SELECT ?, einsatz_id, org_id, zugang_id, 'geraet-2', gekoppelt_at, gekoppelt_von \
         FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ?",
    )
    .bind(ef2)
    .bind(f.ef)
    .execute(&f.pool)
    .await
    .unwrap();

    let mut rx = live.abonniere(f.einsatz);
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/units/{einheit}/reject", f.einsatz),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    assert!(!f.hat_kopplung(ef2).await);
    assert!(f.hat_kopplung(f.ef).await);
    assert_eq!(f.ortung_etb(&admin).await, ["Ortung getrennt: Florian 7"]);
    let n = recv_until_tag(&mut rx, "fahrzeug", std::time::Duration::from_secs(2)).await;
    let data: serde_json::Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(data["fahrzeug_id"].as_i64(), Some(ef2));
}

#[tokio::test]
async fn abschluss_meldet_fahrzeug_live_fuer_gekoppelte_und_geortete() {
    let (f, live) = fix_fuer_einwurf().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    let mut rx = live.abonniere(f.einsatz);
    let (s, v) = anfrage(
        &f.app,
        "POST",
        &format!("/api/incidents/{}/close", f.einsatz),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let n = recv_until_tag(&mut rx, "fahrzeug", std::time::Duration::from_secs(2)).await;
    let data: serde_json::Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(data["fahrzeug_id"].as_i64(), Some(f.ef));
}

/// Wartet höchstens 3 s, bis die Bedingung gilt.
async fn bis<F: std::future::Future<Output = bool>>(mut f: impl FnMut() -> F) {
    for _ in 0..60 {
        if f().await {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("Bedingung nicht erreicht");
}

#[tokio::test]
async fn der_echte_nachlauf_schreibt_nach_der_drossel_genau_einmal_und_meldet_live() {
    set_nachlauf_verzoegerung(std::time::Duration::from_millis(300));
    let f = fix().await;
    let live = LiveHub::new();
    let state = test_state(&f.pool, &live);
    let erst = vor_sekunden(10);
    f.einwerfen(48.1, 11.5, &erst, &erst).await;
    apply_position(&state, &f.zugang, KENNUNG).await;
    assert_eq!(f.stand().await.0, Some(48.1));

    let mut rx = live.abonniere(f.einsatz);
    let dann = vor_sekunden(5);
    f.einwerfen(48.2, 11.6, &dann, &dann).await;
    for _ in 0..3 {
        apply_position(&state, &f.zugang, KENNUNG).await;
    }
    assert_eq!(f.stand().await.0, Some(48.1), "gedrosselt");
    assert!(is_nachlauf_vorgemerkt(&f.pool, f.ef));

    bis(|| async { f.stand().await.0 == Some(48.2) }).await;
    bis(|| async { !is_nachlauf_vorgemerkt(&f.pool, f.ef) }).await;
    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    assert_eq!(
        objekt_ereignisse(&mut rx, &[("fahrzeug", "fahrzeug_id")]),
        [("fahrzeug".to_string(), f.ef)],
        "genau ein Nachlauf, genau eine Meldung"
    );
}

#[tokio::test]
async fn nachlauf_uebernimmt_die_aktuelle_kopplung_nach_neukopplung() {
    set_nachlauf_verzoegerung(std::time::Duration::from_millis(300));
    let f = fix().await;
    let state = test_state(&f.pool, &LiveHub::new());
    let erst = vor_sekunden(10);
    f.einwerfen(48.1, 11.5, &erst, &erst).await;
    apply_position(&state, &f.zugang, KENNUNG).await;
    let dann = vor_sekunden(5);
    f.einwerfen(48.2, 11.6, &dann, &dann).await;
    apply_position(&state, &f.zugang, KENNUNG).await;
    assert!(is_nachlauf_vorgemerkt(&f.pool, f.ef));

    // Neukopplung an eine andere Kennung, deren letzte Position schon in der Ablage liegt.
    sqlx::query("UPDATE ortung_kopplung SET kennung = 'geraet-2' WHERE einsatz_fahrzeug_id = ?")
        .bind(f.ef)
        .execute(&f.pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO position_letzte (org_id, zugang_id, kennung, lat, lon, gemessen_at, \
         empfangen_at, rohdaten) VALUES (?1, ?2, 'geraet-2', 50.5, 8.5, ?3, ?3, '{}')",
    )
    .bind(f.org)
    .bind(&f.zugang)
    .bind(vor_sekunden(2))
    .execute(&f.pool)
    .await
    .unwrap();
    bis(|| async { f.stand().await.0 == Some(50.5) }).await;
}

// ── Kopplung an Zugänge des Hubs (LLH-2119) ───────────────────────────────────────────────

use lifeline_hub::ortung::kopplung::{
    beende_im_einsatz_tx, delete_kopplung_tx, load_kopplung_tx, KopplungZugang,
};

/// Legt eine Instanzkopplung an und gibt ihre ID zurück.
async fn instanz_kopplung_anlegen(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, \
         gegenueber_name, richtung, zustand) \
         VALUES ('hub-1', 'schluessel', 'Hub', 'wird_gemeldet', 'aktiv') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Fügt eine Hub-Zeile für das Fahrzeug ein.
async fn hub_kopplung_einfuegen(f: &Fix, ef: i64, instanz: i64) {
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, \
         instanz_kopplung_id, fremder_zugang_id, zugang_name, kennung, gekoppelt_at, \
         gekoppelt_von) VALUES (?, ?, ?, ?, 'fremd-zugang', 'Fremder Tracker', 'hub-geraet', ?, 1)",
    )
    .bind(ef)
    .bind(f.einsatz)
    .bind(f.org)
    .bind(instanz)
    .bind(T)
    .execute(&f.pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn gemischte_kopplungszeile_wird_abgelehnt() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let ef2 = f.weiteres_fahrzeug(&admin, "Florian 2").await;
    let instanz = instanz_kopplung_anlegen(&f.pool).await;
    let fehler = sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, \
         instanz_kopplung_id, fremder_zugang_id, zugang_name, kennung, gekoppelt_at, \
         gekoppelt_von) VALUES (?, ?, ?, ?, ?, 'fremd-zugang', 'Name', 'x', ?, 1)",
    )
    .bind(ef2)
    .bind(f.einsatz)
    .bind(f.org)
    .bind(&f.zugang)
    .bind(instanz)
    .bind(T)
    .execute(&f.pool)
    .await
    .unwrap_err();
    assert!(fehler.to_string().contains("CHECK"), "{fehler}");
}

#[tokio::test]
async fn hub_kopplung_wird_mit_namen_geladen() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let ef2 = f.weiteres_fahrzeug(&admin, "Florian 2").await;
    let instanz = instanz_kopplung_anlegen(&f.pool).await;
    hub_kopplung_einfuegen(&f, ef2, instanz).await;
    let mut conn = f.pool.acquire().await.unwrap();
    let k = load_kopplung_tx(&mut conn, f.einsatz, ef2)
        .await
        .unwrap()
        .expect("Hub-Kopplung");
    assert_eq!(k.zugang_name, "Fremder Tracker");
    assert_eq!(
        k.zugang,
        KopplungZugang::Hub {
            instanz_kopplung_id: instanz,
            zugang_id: "fremd-zugang".into()
        }
    );
    assert_eq!(k.access_id(), "fremd-zugang");
    // Die lokale Kopplung bleibt lokal und trägt den Namen des Zugangs.
    let lokal = load_kopplung_tx(&mut conn, f.einsatz, f.ef)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lokal.zugang_name, "Tracker");
    assert_eq!(
        lokal.zugang,
        KopplungZugang::Lokal {
            zugang_id: f.zugang.clone()
        }
    );
}

#[tokio::test]
async fn trennen_und_abschluss_sehen_hub_kopplungen() {
    let f = fix().await;
    let admin = login_cookie(&f.app, "admin", "startpw12").await;
    let ef2 = f.weiteres_fahrzeug(&admin, "Florian 2").await;
    let ef3 = f.weiteres_fahrzeug(&admin, "Florian 3").await;
    let instanz = instanz_kopplung_anlegen(&f.pool).await;
    hub_kopplung_einfuegen(&f, ef2, instanz).await;
    // Der Test-Pool hat eine Verbindung: sie wird vor jedem Zählen freigegeben.
    let mut conn = f.pool.acquire().await.unwrap();
    let getrennt = delete_kopplung_tx(&mut conn, f.einsatz, ef2).await.unwrap();
    drop(conn);
    assert!(getrennt.is_some());
    assert_eq!(f.kopplungen().await, 1);
    // Eine zweite Hub-Zeile (Kennung bleibt je Zugang eindeutig) fällt beim Abschluss.
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, \
         instanz_kopplung_id, fremder_zugang_id, zugang_name, kennung, gekoppelt_at, \
         gekoppelt_von) VALUES (?, ?, ?, ?, 'fremd-zugang', 'Fremder Tracker', 'hub-geraet', ?, 1)",
    )
    .bind(ef3)
    .bind(f.einsatz)
    .bind(f.org)
    .bind(instanz)
    .bind(T)
    .execute(&f.pool)
    .await
    .unwrap();
    let mut conn = f.pool.acquire().await.unwrap();
    let ende = beende_im_einsatz_tx(&mut conn, f.einsatz).await.unwrap();
    let mut ids: Vec<i64> = ende
        .getrennt
        .iter()
        .map(|k| k.einsatz_fahrzeug_id)
        .collect();
    ids.sort_unstable();
    assert_eq!(ids, vec![f.ef, ef3]);
    drop(conn);
    assert_eq!(f.kopplungen().await, 0);
}
