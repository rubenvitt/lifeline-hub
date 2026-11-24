//! Übernahme eingeworfener Positionen in gekoppelte Einsatzfahrzeuge (LLH-2091). Die Tests rufen
//! `apply_position_tx` mit gebauten Zeitstempeln auf, ohne zu schlafen.

use axum::http::{Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use lifeline_hub::live::LiveHub;
use lifeline_hub::ortung::uebernahme::{
    apply_position, apply_position_tx, is_nachlauf_vorgemerkt, Uebernahme,
};
use sqlx::SqlitePool;
use tower::ServiceExt;

mod common;
use common::*;

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
        &format!("/api/einsaetze/{einsatz}/vehicles"),
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
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, kennung, \
         ehrenamt_bestaetigt, gekoppelt_at, gekoppelt_von) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
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

    /// Setzt eine manuelle Position wie die Lagekarte: Quelle `manuell`, beide Zeiten gleich.
    async fn manuell_setzen(&self, lat: f64, lon: f64, at: &str) {
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET lat = ?, lon = ?, position_quelle = 'manuell', \
             position_gemessen_at = ?, position_gesetzt_at = ? WHERE id = ?",
        )
        .bind(lat)
        .bind(lon)
        .bind(at)
        .bind(at)
        .bind(self.ef)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    /// `(lat, lon, quelle, gemessen_at, gesetzt_at)` des Einsatzfahrzeugs.
    async fn stand(
        &self,
    ) -> (
        Option<f64>,
        Option<f64>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) {
        sqlx::query_as(
            "SELECT lat, lon, position_quelle, position_gemessen_at, position_gesetzt_at \
             FROM einsatz_fahrzeug WHERE id = ?",
        )
        .bind(self.ef)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }
}

fn geschrieben(f: &Fix) -> Uebernahme {
    Uebernahme::Geschrieben {
        einsatz_id: f.einsatz,
        ef_id: f.ef,
    }
}

#[tokio::test]
async fn gekoppelte_kennung_schreibt_position_und_quelle_ortung() {
    let f = fix().await;
    f.einwerfen(48.1, 11.5, "2026-11-24 11:59:50", T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    assert_eq!(
        f.stand().await,
        (
            Some(48.1),
            Some(11.5),
            Some("ortung".into()),
            Some("2026-11-24 11:59:50".into()),
            Some(T.into())
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

#[tokio::test]
async fn manuelle_position_bleibt_bis_ein_spaeter_empfangener_fix_kommt() {
    let f = fix().await;
    f.manuell_setzen(50.0, 10.0, T).await;
    f.einwerfen(48.1, 11.5, T, "2026-11-24 11:59:59").await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.2.as_deref(), Some("manuell"));
    assert_eq!(f.stand().await.0, Some(50.0));

    f.einwerfen(48.2, 11.6, T, "2026-11-24 12:00:01").await;
    assert_eq!(f.uebernehmen("2026-11-24 12:00:01").await, geschrieben(&f));
    assert_eq!(f.stand().await.2.as_deref(), Some("ortung"));
    assert_eq!(f.stand().await.0, Some(48.2));
}

#[tokio::test]
async fn vorgehende_geraeteuhr_aendert_den_vorrang_nicht() {
    let f = fix().await;
    f.manuell_setzen(50.0, 10.0, T).await;
    // Die Geräteuhr geht eine Stunde vor; empfangen wurde der Fix aber vor dem manuellen Setzen.
    f.einwerfen(48.1, 11.5, "2026-11-24 13:00:00", "2026-11-24 11:59:00")
        .await;
    assert_eq!(f.uebernehmen(T).await, Uebernahme::Nichts);
    assert_eq!(f.stand().await.0, Some(50.0));
}

#[tokio::test]
async fn geloeschte_position_wird_vom_naechsten_fix_gesetzt() {
    let f = fix().await;
    // Wie nach dem Löschen der Position: Koordinaten, Quelle und Zeiten sind NULL.
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.stand().await.0, None);
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    assert_eq!(f.stand().await.0, Some(48.1));
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
async fn nachlauf_schreibt_die_juengste_position() {
    let f = fix().await;
    f.einwerfen(48.1, 11.5, T, T).await;
    assert_eq!(f.uebernehmen(T).await, geschrieben(&f));
    f.einwerfen(48.2, 11.6, "2026-11-24 12:00:05", "2026-11-24 12:00:05")
        .await;
    assert!(matches!(
        f.uebernehmen("2026-11-24 12:00:05").await,
        Uebernahme::Gedrosselt { .. }
    ));
    // Der Nachlauf läuft 15 s nach dem gedrosselten Fix.
    assert_eq!(f.uebernehmen("2026-11-24 12:00:20").await, geschrieben(&f));
    let (lat, lon, quelle, _, gesetzt) = f.stand().await;
    assert_eq!((lat, lon), (Some(48.2), Some(11.6)));
    assert_eq!(quelle.as_deref(), Some("ortung"));
    assert_eq!(gesetzt.as_deref(), Some("2026-11-24 12:00:05"));
}

#[tokio::test]
async fn gedrosselter_fix_merkt_genau_einen_nachlauf_vor() {
    let f = fix().await;
    // Der Fix ist so frisch, wie die Uhr im Aufruf: `apply_position` nimmt die Serverzeit.
    let jetzt = lifeline_hub::zeit::jetzt();
    f.einwerfen(48.1, 11.5, &jetzt, &jetzt).await;
    let state = test_state(&f.pool, &LiveHub::new());
    apply_position(&state, &f.zugang, KENNUNG).await;
    assert_eq!(f.stand().await.0, Some(48.1));
    assert!(!is_nachlauf_vorgemerkt(f.ef));

    f.einwerfen(48.2, 11.6, &jetzt, "9999-01-01 00:00:00").await;
    apply_position(&state, &f.zugang, KENNUNG).await;
    apply_position(&state, &f.zugang, KENNUNG).await;
    assert_eq!(f.stand().await.0, Some(48.1));
    assert!(is_nachlauf_vorgemerkt(f.ef));
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
    assert_eq!(stand.2.as_deref(), Some("ortung"));
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
