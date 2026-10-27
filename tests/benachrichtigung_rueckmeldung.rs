//! Hinweis „Rückmeldung überfällig“ (LLH-1425, Katalog LLH-1142 E1, Spec `benachrichtigungen`,
//! „Rückmeldung überfällig“): der Erinnerungs-Scheduler meldet je Einheit, deren letzte
//! Rückmeldung älter als die Rückmeldefrist ist, `rueckmeldung_ueberfaellig` (Stufe Eingang) an
//! die, die Meldungen bearbeiten. Je Überfälligkeit genau einmal: weitere Takte melden nicht
//! noch einmal; erst eine neue Rückmeldung, die ihrerseits überfällig wird, meldet wieder. Die
//! Uhr ist gesetzt (`jetzt`).

use axum::http::StatusCode;
use chrono::{DateTime, Duration, Utc};
use lifeline_hub::erinnerung::scheduler::tick_einmal;
use lifeline_hub::live::LiveHub;
use lifeline_hub::meldung::rueckmeldung::ueberfaellige_melden;
use serde_json::json;

mod common;
use common::{
    anfrage, benutzer_anlegen, einheit_bilden, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool_und_live,
};

const ART: &str = "rueckmeldung_ueberfaellig";

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// Mitglied (Führungspersonal) „annika“: bearbeitet Meldungen.
    anna: i64,
    /// Mitglied (Beobachter) „carla“: liest nur, bekommt nichts.
    carla: i64,
    /// Einheiten „1. Zug“ und „2. Zug“.
    zug1: i64,
    zug2: i64,
}

/// Eine gespeicherte Benachrichtigung der Art: (Empfänger, Stufe, Bezugstyp, Bezugskennung).
type Zeile = (i64, String, String, i64);

async fn welt() -> Welt {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let carla = benutzer_anlegen(&app, &admin, "carla", "keine").await;
    rolle_setzen(&app, &admin, einsatz, anna, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, carla, "beobachter").await;
    let zug1 = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let zug2 = einheit_bilden(&app, &admin, einsatz, "2. Zug").await;
    Welt {
        app,
        pool,
        live,
        admin,
        admin_id,
        einsatz,
        anna,
        carla,
        zug1,
        zug2,
    }
}

impl Welt {
    /// Rückmeldung der Einheit zur Ereigniszeit `zeit`; liefert die gespeicherte Ereigniszeit
    /// (UTC) der neuen Meldung.
    async fn rueckmeldung(&self, einheit: i64, zeit: &str) -> DateTime<Utc> {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/meldungen", self.einsatz),
            &self.admin,
            Some(
                &json!({
                    "absender": "Florian Nord 1",
                    "meldeweg": "funk",
                    "inhalt": "Lage unverändert",
                    "ereigniszeit": zeit,
                    "einheit_id": einheit,
                })
                .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let gespeichert: String =
            sqlx::query_scalar("SELECT ereigniszeit FROM meldung WHERE id = ?")
                .bind(v["id"].as_i64().unwrap())
                .fetch_one(&self.pool)
                .await
                .unwrap();
        lifeline_hub::zeit::parse_utc(&gespeichert).unwrap()
    }

    async fn takt(&self, jetzt: DateTime<Utc>) -> usize {
        ueberfaellige_melden(&self.pool, &self.live, jetzt).await
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, stufe, bezug_typ, bezug_id FROM benachrichtigung \
             WHERE art = ? ORDER BY id, benutzer_id",
        )
        .bind(ART)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    /// Die erwarteten Zeilen eines Hinweises zu `einheit`: Einsatzleitung (Admin) und Annika.
    fn erwartet(&self, einheit: i64) -> Vec<Zeile> {
        [self.admin_id, self.anna]
            .into_iter()
            .map(|b| (b, "hinweis".into(), "einheit".into(), einheit))
            .collect()
    }
}

/// Spec-Szenario „Rückmeldung wird überfällig“: vor Ablauf der Frist (Vorgabe 60 Minuten) bleibt
/// es still, ab der Fälligkeit meldet der Takt einen Eingang an alle, die Meldungen bearbeiten;
/// nicht an die Beobachterin. Der Text nennt die Einheit und springt zu ihr.
#[tokio::test]
async fn ueberfaellige_rueckmeldung_meldet_einen_eingang() {
    let w = welt().await;
    let zeit = w.rueckmeldung(w.zug1, "2026-10-26 08:00:00").await;

    assert_eq!(w.takt(zeit + Duration::minutes(59)).await, 0);
    assert!(w.zeilen().await.is_empty(), "vor der Frist still");

    assert_eq!(w.takt(zeit + Duration::minutes(60)).await, 1);
    let zeilen = w.zeilen().await;
    assert_eq!(zeilen, w.erwartet(w.zug1));
    assert!(zeilen.iter().all(|z| z.0 != w.carla), "{zeilen:?}");

    let anna = login_cookie(&w.app, "annika", "annikapw1").await;
    let (s, v) = anfrage(
        &w.app,
        "GET",
        "/api/benachrichtigungen?offen=true",
        &anna,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let eintrag = v
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["art"] == ART)
        .unwrap_or_else(|| panic!("kein Hinweis im Verlauf: {v}"));
    assert_eq!(eintrag["titel"], "Rückmeldung überfällig");
    assert_eq!(eintrag["stufe"], "hinweis");
    assert_eq!(eintrag["detail"], "1. Zug");
    assert_eq!(
        eintrag["pfad"],
        format!("/einsaetze/{}/einheiten/{}", w.einsatz, w.zug1)
    );
}

/// Doppelschutz: weitere Takte (auch der Scheduler selbst, `tick_einmal`) melden dieselbe
/// Überfälligkeit nicht noch einmal. Eine neue Rückmeldung setzt die Frist neu; wird sie
/// überfällig, meldet es wieder, genau einmal.
#[tokio::test]
async fn je_ueberfaelligkeit_genau_einmal() {
    let w = welt().await;
    let zeit = w.rueckmeldung(w.zug1, "2026-10-26 08:00:00").await;
    let spaeter = zeit + Duration::minutes(61);
    assert_eq!(w.takt(spaeter).await, 1);
    let einmal = w.zeilen().await;
    assert_eq!(einmal, w.erwartet(w.zug1));

    for minuten in [62, 90, 600] {
        tick_einmal(&w.pool, &w.live, zeit + Duration::minutes(minuten)).await;
        assert_eq!(w.takt(zeit + Duration::minutes(minuten)).await, 0);
    }
    assert_eq!(w.zeilen().await, einmal, "kein Doppel je Takt");

    // Neue Rückmeldung: wieder rechtzeitig, dann erneut überfällig.
    let neu = w.rueckmeldung(w.zug1, "2026-10-26 18:00:00").await;
    assert_eq!(w.takt(neu + Duration::minutes(30)).await, 0);
    assert_eq!(w.takt(neu + Duration::minutes(60)).await, 1);
    assert_eq!(w.takt(neu + Duration::minutes(120)).await, 0);
    assert_eq!(w.zeilen().await.len(), einmal.len() * 2);
}

/// Der Scheduler selbst meldet: `tick_einmal` trägt die Quelle.
#[tokio::test]
async fn der_erinnerungs_takt_traegt_die_quelle() {
    let w = welt().await;
    let zeit = w.rueckmeldung(w.zug2, "2026-10-26 08:00:00").await;
    tick_einmal(&w.pool, &w.live, zeit + Duration::minutes(75)).await;
    assert_eq!(w.zeilen().await, w.erwartet(w.zug2));
}

/// Gegenseiten: eine Einheit ohne jede Rückmeldung („keine Rückmeldung“) meldet nichts, eine
/// aufgelöste Einheit erwartet keine mehr, und ein abgeschlossener Einsatz läuft nicht mit. Je Einheit
/// zählt nur ihre jüngste Rückmeldung.
#[tokio::test]
async fn ohne_rueckmeldung_aufgeloest_oder_abgeschlossen_bleibt_es_still() {
    let w = welt().await;
    // zug2 hat sich nie zurückgemeldet.
    let alt = w.rueckmeldung(w.zug1, "2026-10-26 08:00:00").await;
    let juenger = w.rueckmeldung(w.zug1, "2026-10-26 08:50:00").await;
    assert!(juenger > alt);
    assert_eq!(
        w.takt(alt + Duration::minutes(70)).await,
        0,
        "jüngste zählt"
    );

    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = '2026-10-26 09:00:00' WHERE id = ?")
        .bind(w.zug1)
        .execute(&w.pool)
        .await
        .unwrap();
    assert_eq!(
        w.takt(juenger + Duration::minutes(120)).await,
        0,
        "aufgelöst"
    );

    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = NULL WHERE id = ?")
        .bind(w.zug1)
        .execute(&w.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
        .bind(w.einsatz)
        .execute(&w.pool)
        .await
        .unwrap();
    assert_eq!(
        w.takt(juenger + Duration::minutes(120)).await,
        0,
        "abgeschlossen"
    );
    assert!(w.zeilen().await.is_empty());
}
