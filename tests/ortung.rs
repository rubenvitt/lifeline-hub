//! Positionsbaustein (Helfer-App, Spec `2026-11-24-vakwvkpg-helfer-app-design.md`, Abschnitt
//! „Ortung der Organisation und Positionsbaustein“): eine Schreibstelle für alle Quellen, die
//! ältere Zeitstempel verwirft, die Zeit des Geräts klemmt und das Live-Ereignis auslöst; die
//! Handwege setzen die Quelle `manuell`.

use axum::http::StatusCode;
use lifeline_hub::error::AppError;
use lifeline_hub::ortung::{
    klemme_zeitpunkt, loesche_position, publiziere, schreibe_position, Ortungsziel, Positionsquelle,
};
use std::time::Duration;

mod common;
use common::{
    anfrage, einheit_bilden, einsatz_anlegen, login_cookie, recv_until_tag,
    setup_mit_pool_und_live, stammpersonal_disponieren, test_state,
};

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
