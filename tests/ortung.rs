//! Übernahme eingeworfener Positionen in gekoppelte Einsatzfahrzeuge (LLH-2091). Die Tests rufen
//! `apply_position_tx` mit gebauten Zeitstempeln auf, ohne zu schlafen.

use axum::http::StatusCode;
use lifeline_hub::live::LiveHub;
use lifeline_hub::ortung::uebernahme::{
    apply_position, apply_position_tx, is_nachlauf_vorgemerkt, Uebernahme,
};
use sqlx::SqlitePool;

mod common;
use common::*;

const KENNUNG: &str = "geraet-1";
const T: &str = "2026-11-24 12:00:00";

struct Fix {
    pool: SqlitePool,
    org: i64,
    einsatz: i64,
    ef: i64,
    zugang: String,
}

async fn fix() -> Fix {
    let (app, pool) = setup_mit_pool().await;
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
    let zugang = "zugang-ortung".to_string();
    sqlx::query(
        "INSERT INTO einwurf_zugang (id, org_id, name, scope, schluessel_hash, angelegt_at) \
         VALUES (?, ?, 'Tracker', 'positionen:write', 'hash-ortung', ?)",
    )
    .bind(&zugang)
    .bind(org)
    .bind(T)
    .execute(&pool)
    .await
    .unwrap();
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
