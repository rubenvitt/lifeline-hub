//! Benachrichtigungen zur Lagebesprechung (LLH-1215, Change `kcjecn9e-benachrichtigungskonzept`,
//! design.md D10, Spec `benachrichtigungen`, „Lagebesprechung steht an“): der
//! Erinnerungs-Scheduler kündigt den nächsten Termin 10 Minuten vorher und bei Erreichen an EL und
//! S1 bis S7 an, je Termin genau einmal. Die Uhr ist gesetzt (`tick_einmal` mit `jetzt`).

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use lifeline_hub::erinnerung::scheduler::tick_einmal;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool_und_live,
};

const VORHER: &str = "lagebesprechung_vorher";
const FAELLIG: &str = "lagebesprechung_faellig";

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    admin: String,
    einsatz: i64,
    /// Trägt EL in der Mitgliedschaft.
    anna: i64,
    /// Besetzt S1 in der Stab-Besetzung (verknüpftes Personal).
    bert: i64,
    /// Fachberaterin: Führungsfunktion, aber nicht Stab; bekommt nichts.
    carla: i64,
    /// Mitglied ohne Funktion; bekommt nichts.
    dora: i64,
}

/// Eine gespeicherte Benachrichtigung: (Empfänger, Art, Bezugstyp, Bezugskennung).
type Zeile = (i64, String, String, i64);

fn t(s: &str) -> DateTime<Utc> {
    lifeline_hub::zeit::parse_utc(s).unwrap()
}

async fn welt() -> Welt {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let carla = benutzer_anlegen(&app, &admin, "carla", "keine").await;
    let dora = benutzer_anlegen(&app, &admin, "dorothea", "keine").await;
    for id in [anna, bert, carla, dora] {
        rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
    }
    // Die Aufnahmen oben melden `einsatz_aufnahme` (tasks.md 15.1, `tests/benachrichtigung_org.rs`);
    // die Tests hier beginnen mit leerer Tabelle.
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();
    let w = Welt {
        app,
        pool,
        live,
        admin,
        einsatz,
        anna,
        bert,
        carla,
        dora,
    };
    w.funktion_setzen(anna, json!({ "fuehrungsfunktion": "el" }))
        .await;
    w.funktion_setzen(
        carla,
        json!({ "fuehrungsfunktion": "fachberater", "fuehrungsstelle": "THW" }),
    )
    .await;
    let ep = w.personal("Bertram", bert).await;
    let (s, v) = anfrage(
        &w.app,
        "PUT",
        &format!("/api/einsaetze/{}/stab/besetzung/s1", w.einsatz),
        &w.admin,
        Some(&json!({ "besetzung_art": "personal", "personal_id": ep }).to_string()),
    )
    .await;
    assert!(s.is_success(), "S1 besetzen: {s} {v}");
    w
}

impl Welt {
    /// Setzt die Funktion der Mitgliedschaft; `funktion` trägt Code und, wo nötig, Bezeichnung.
    async fn funktion_setzen(&self, benutzer_id: i64, mut funktion: Value) {
        funktion["einsatz_rolle"] = json!("fuehrungspersonal");
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/mitglieder/{benutzer_id}", self.einsatz),
            &self.admin,
            Some(&funktion.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Stamm-Person mit verknüpftem Konto, disponiert; liefert die `einsatz_personal.id`.
    async fn personal(&self, name: &str, benutzer_id: i64) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            "/api/personal",
            &self.admin,
            Some(&json!({ "name": name, "benutzer_id": benutzer_id }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personal", self.einsatz),
            &self.admin,
            Some(&json!({ "personal_id": v["id"] }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    /// Setzt den Termin über den einen Schreibweg ohne Abschluss (`null` = kein Termin).
    async fn termin(&self, wert: Value) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/lagebesprechung/termin", self.einsatz),
            &self.admin,
            Some(&json!({ "naechste_at": wert }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    async fn tick(&self, jetzt: &str) {
        tick_einmal(&self.pool, &self.live, t(jetzt)).await;
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    /// Die Empfänger einer Art, aufsteigend.
    async fn empfaenger(&self, art: &str) -> Vec<i64> {
        let mut ids: Vec<i64> = self
            .zeilen()
            .await
            .into_iter()
            .filter(|z| z.1 == art)
            .map(|z| z.0)
            .collect();
        ids.sort_unstable();
        ids
    }

    fn stab(&self) -> Vec<i64> {
        let mut ids = vec![self.anna, self.bert];
        ids.sort_unstable();
        ids
    }

    async fn merker(&self) -> (Option<String>, Option<String>) {
        sqlx::query_as(
            "SELECT lagebesprechung_angekuendigt_vorher_at, \
                    lagebesprechung_angekuendigt_faellig_at FROM einsatz WHERE id = ?",
        )
        .bind(self.einsatz)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }
}

/// Spec-Szenario „Termin 14:00“: um 13:50 und um 14:00 je ein Hinweis an EL und S1, nicht an die
/// Fachberaterin und nicht an ein Mitglied ohne Funktion; ein zweiter Lauf meldet nichts doppelt.
#[tokio::test]
async fn termin_14_uhr_kuendigt_um_13_50_und_um_14_00_je_einmal_an() {
    let w = welt().await;
    w.termin(json!("2026-09-12 14:00:00")).await;

    w.tick("2026-09-12 13:49:59").await;
    assert!(w.zeilen().await.is_empty(), "vor 13:50 nichts");

    w.tick("2026-09-12 13:50:00").await;
    assert_eq!(w.empfaenger(VORHER).await, w.stab());
    w.tick("2026-09-12 13:50:30").await;
    w.tick("2026-09-12 13:59:30").await;
    assert_eq!(w.empfaenger(VORHER).await, w.stab(), "kein Doppel");
    assert!(
        w.empfaenger(FAELLIG).await.is_empty(),
        "vor 14:00 nicht fällig"
    );

    w.tick("2026-09-12 14:00:00").await;
    w.tick("2026-09-12 14:00:30").await;
    assert_eq!(w.empfaenger(FAELLIG).await, w.stab());
    assert_eq!(w.empfaenger(VORHER).await, w.stab(), "kein Doppel");

    let zeilen = w.zeilen().await;
    assert_eq!(zeilen.len(), 4, "{zeilen:?}");
    for z in &zeilen {
        assert_eq!(z.2, "lagebesprechung");
        assert_eq!(z.3, w.einsatz, "Bezug ist der Einsatz");
        assert!(z.0 != w.carla && z.0 != w.dora, "{zeilen:?}");
    }

    // Der Text, wie EL ihn liest.
    let anna = login_cookie(&w.app, "annika", "annikapw1").await;
    let (s, liste) = anfrage(&w.app, "GET", "/api/benachrichtigungen", &anna, None).await;
    assert_eq!(s, StatusCode::OK, "{liste}");
    let titel: Vec<&str> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["titel"].as_str().unwrap())
        .collect();
    assert!(titel.contains(&"Lagebesprechung in 10 Minuten"), "{liste}");
    assert!(titel.contains(&"Lagebesprechung jetzt fällig"), "{liste}");
    for b in liste.as_array().unwrap() {
        assert_eq!(
            b["pfad"],
            format!("/einsaetze/{}/lagebesprechung", w.einsatz)
        );
    }
    let dora = login_cookie(&w.app, "dorothea", "dorotheapw1").await;
    let (_, liste) = anfrage(&w.app, "GET", "/api/benachrichtigungen", &dora, None).await;
    assert_eq!(liste, json!([]), "Mitglied ohne Funktion");
}

/// Spec-Szenario „Termin verschoben“: um 13:45 von 14:00 auf 14:30 — kein Hinweis um 13:50 oder
/// 14:00, sondern um 14:20 und 14:30.
#[tokio::test]
async fn verschobener_termin_kuendigt_den_neuen_an_nicht_den_alten() {
    let w = welt().await;
    w.termin(json!("2026-09-12 14:00:00")).await;
    w.tick("2026-09-12 13:45:00").await;
    w.termin(json!("2026-09-12 14:30:00")).await;

    for jetzt in ["2026-09-12 13:50:00", "2026-09-12 14:00:00"] {
        w.tick(jetzt).await;
    }
    assert!(w.zeilen().await.is_empty(), "nichts zum alten Termin");

    w.tick("2026-09-12 14:20:00").await;
    assert_eq!(w.empfaenger(VORHER).await, w.stab());
    w.tick("2026-09-12 14:30:00").await;
    assert_eq!(w.empfaenger(FAELLIG).await, w.stab());
    assert_eq!(w.zeilen().await.len(), 4);
}

/// Schon angekündigt, dann verschoben (hier über den Abschluss): Setzen leert die Merker, der
/// neue Termin wird wieder angekündigt, der alte nicht mehr als fällig.
#[tokio::test]
async fn verschieben_nach_der_ankuendigung_kuendigt_den_neuen_termin_erneut_an() {
    let w = welt().await;
    w.termin(json!("2026-09-12 14:00:00")).await;
    w.tick("2026-09-12 13:50:00").await;
    assert_eq!(w.empfaenger(VORHER).await, w.stab());
    assert!(w.merker().await.0.is_some(), "Merker gesetzt");

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/lagebesprechungen", w.einsatz),
        &w.admin,
        Some(
            &json!({
                "entschluss": "Lage unverändert, Maßnahmen fortführen",
                "abgehalten_at": "2026-09-12 13:55:00",
                "naechste_at": "2026-09-12 14:30:00"
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(w.merker().await, (None, None), "Abschluss mit Termin leert");

    w.tick("2026-09-12 14:00:00").await;
    assert!(w.empfaenger(FAELLIG).await.is_empty(), "alter Termin");
    w.tick("2026-09-12 14:20:00").await;
    w.tick("2026-09-12 14:30:00").await;
    assert_eq!(w.zeilen().await.len(), 6, "zweimal vorher, einmal fällig");
    assert_eq!(w.empfaenger(FAELLIG).await, w.stab());
}

/// Derselbe Termin noch einmal gesetzt (etwa eine wiederholte Anfrage) ist keine Änderung: die
/// Merker bleiben, nichts wird doppelt angekündigt. Ein Abschluss ohne Termin lässt sie ebenso.
#[tokio::test]
async fn gleicher_termin_erneut_gesetzt_kuendigt_nicht_doppelt_an() {
    let w = welt().await;
    w.termin(json!("2026-09-12 14:00:00")).await;
    w.tick("2026-09-12 13:50:00").await;
    let gesetzt = w.merker().await;
    assert!(gesetzt.0.is_some());

    w.termin(json!("2026-09-12T14:00:00Z")).await;
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/lagebesprechungen", w.einsatz),
        &w.admin,
        Some(
            &json!({ "entschluss": "Weiter wie bisher", "abgehalten_at": "2026-09-12 13:52:00" })
                .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(w.merker().await, gesetzt, "Merker bleiben");

    w.tick("2026-09-12 13:51:00").await;
    assert_eq!(w.empfaenger(VORHER).await, w.stab(), "kein zweites Vorher");
}

/// Gelöschter Termin: nichts. Vergangener Termin (über das Nachholfenster hinaus): nichts, auch
/// nicht beim ersten Lauf nach dem Setzen.
#[tokio::test]
async fn geloeschter_und_vergangener_termin_bleiben_still() {
    let w = welt().await;
    w.termin(json!("2026-09-12 14:00:00")).await;
    w.tick("2026-09-12 13:45:00").await;
    w.termin(Value::Null).await;
    for jetzt in [
        "2026-09-12 13:50:00",
        "2026-09-12 13:55:00",
        "2026-09-12 14:00:00",
    ] {
        w.tick(jetzt).await;
    }
    assert!(w.zeilen().await.is_empty(), "gelöschter Termin");

    w.termin(json!("2026-09-12 12:00:00")).await;
    w.tick("2026-09-12 14:00:00").await;
    w.tick("2026-09-12 14:00:30").await;
    assert!(w.zeilen().await.is_empty(), "vergangener Termin");
    assert_eq!(w.merker().await, (None, None));
}

/// Ein abgeschlossener Einsatz kündigt nichts mehr an.
#[tokio::test]
async fn abgeschlossener_einsatz_bleibt_still() {
    let w = welt().await;
    w.termin(json!("2026-09-12 14:00:00")).await;
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(w.einsatz)
    .execute(&w.pool)
    .await
    .unwrap();
    w.tick("2026-09-12 13:50:00").await;
    w.tick("2026-09-12 14:00:00").await;
    assert!(w.zeilen().await.is_empty());
}
