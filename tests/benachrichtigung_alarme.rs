//! Bestehende Alarme auf dem Weg der Benachrichtigungen (LLH-1209, Change
//! `kcjecn9e-benachrichtigungskonzept`, tasks.md 3.1–3.4, Spec `benachrichtigungen`):
//! Sofortmeldung und ihre Eskalation, überfälliger Auftrag, fällige Erinnerung und Ablösung
//! melden über `benachrichtigung::melden`. Geprüft wird, wer eine Zeile bekommt und wer nicht;
//! jede Zeile ist genau eine Zustellung (`tests/benachrichtigung.rs` belegt den Strom).

use axum::http::StatusCode;
use chrono::{DateTime, Duration, Utc};
use lifeline_hub::erinnerung::scheduler::tick_einmal;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, anfrage_mit_offline_queue_benutzer, benutzer_anlegen, einsatz_anlegen, login_cookie,
    rolle_setzen, setup_mit_pool_und_live,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// Erfasserin, Auftraggeberin, Erstellerin.
    anna: i64,
    /// Empfänger (S1, S2).
    bert: i64,
    /// Ein weiteres Mitglied mit allen Modulen.
    carl: i64,
}

async fn welt() -> Welt {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let carl = benutzer_anlegen(&app, &admin, "carlotta", "keine").await;
    for b in [anna, bert, carl] {
        rolle_setzen(&app, &admin, einsatz, b, "fuehrungspersonal").await;
    }
    // Die Aufnahmen oben melden `einsatz_aufnahme` (tasks.md 15.1, `tests/benachrichtigung_org.rs`);
    // die Tests hier beginnen mit leerer Tabelle.
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();
    Welt {
        app,
        pool,
        live,
        admin,
        admin_id,
        einsatz,
        anna,
        bert,
        carl,
    }
}

/// Zeitpunkt im Wire-Format der Routen.
fn wire(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Zeitpunkt im DB-Format (UTC), wie es Frist- und Fälligkeitsfelder annehmen.
fn db(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    fn pfad(&self, rest: &str) -> String {
        format!("/api/einsaetze/{}/{rest}", self.einsatz)
    }

    /// Besetzt ein Sachgebiet der Stab-Besetzung mit einer Stamm-Person, die mit `benutzer_id`
    /// verknüpft ist.
    async fn besetzen(&self, sachgebiet: &str, name: &str, benutzer_id: i64) {
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
            &self.pfad("personal"),
            &self.admin,
            Some(&json!({ "personal_id": v["id"] }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &self.pfad(&format!("stab/besetzung/{sachgebiet}")),
            &self.admin,
            Some(&json!({ "besetzung_art": "personal", "personal_id": v["id"] }).to_string()),
        )
        .await;
        assert!(s.is_success(), "besetzen {sachgebiet}: {s} {v}");
    }

    async fn modul_nur_fuer_admins(&self, modul: &str) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &self.pfad(&format!("modul-overrides/{modul}")),
            &self.admin,
            Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Empfänger der Benachrichtigungen einer Art, aufsteigend.
    async fn empfaenger(&self, art: &str) -> Vec<i64> {
        sqlx::query_scalar(
            "SELECT benutzer_id FROM benachrichtigung WHERE art = ? ORDER BY benutzer_id",
        )
        .bind(art)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn tick(&self, jetzt: DateTime<Utc>) {
        tick_einmal(&self.pool, &self.live, jetzt).await;
    }

    /// Erfasst als `name` eine Sofortmeldung mit Bestätigungsfrist von 5 Minuten.
    async fn sofortmeldung(&self, name: &str, benutzer_id: i64, client_id: &str) -> Value {
        let cookie = self.cookie(name).await;
        let (s, v) = anfrage_mit_offline_queue_benutzer(
            &self.app,
            "POST",
            &self.pfad("meldungen"),
            &cookie,
            Some(
                &json!({
                    "absender": "Florian Nord 1",
                    "meldeweg": "funk",
                    "inhalt": "MANV am Deich",
                    "meldungsart": "sofortmeldung",
                    "ereigniszeit": wire(Utc::now()),
                    "bestaetigung_frist_min": 5,
                    "client_id": client_id,
                })
                .to_string(),
            ),
            benutzer_id,
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v
    }

    /// Erteilt als `name` einen Auftrag an die Funktionen `funktionen` mit Frist in einer Stunde.
    async fn auftrag_mit_frist(&self, name: &str, funktionen: &[&str]) -> Value {
        let cookie = self.cookie(name).await;
        let empfaenger: Vec<Value> = funktionen
            .iter()
            .map(|f| json!({ "empfaenger_typ": "funktion", "funktion": f }))
            .collect();
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.pfad("auftraege"),
            &cookie,
            Some(
                &json!({
                    "auftrag_text": "Sandsäcke zum Deich bringen",
                    "frist_at": db(Utc::now() + Duration::hours(1)),
                    "empfaenger": empfaenger,
                })
                .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v
    }

    /// Legt als `name` eine Erinnerung an, fällig in einer Stunde.
    async fn erinnerung(&self, name: &str, empfaenger_funktion_code: Option<&str>) -> i64 {
        self.erinnerung_zu(name, empfaenger_funktion_code, None)
            .await
    }

    /// Wie [`Self::erinnerung`], von Hand mit Bezug `(bezug_typ, bezug_id)`.
    async fn erinnerung_zu(
        &self,
        name: &str,
        empfaenger_funktion_code: Option<&str>,
        bezug: Option<(&str, i64)>,
    ) -> i64 {
        let cookie = self.cookie(name).await;
        let mut body = json!({
            "titel": "Lagemeldung an die Leitstelle",
            "faellig_at": db(Utc::now() + Duration::hours(1)),
        });
        if let Some(code) = empfaenger_funktion_code {
            body["empfaenger_funktion_code"] = json!(code);
        }
        if let Some((typ, id)) = bezug {
            body["bezug_typ"] = json!(typ);
            body["bezug_id"] = json!(id);
        }
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.pfad("erinnerungen"),
            &cookie,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }
}

// ───────────────────────── 3.1 Sofortmeldung ─────────────────────────

/// Spec-Szenarien „Neue Sofortmeldung“ und „Eigene Sofortmeldung“: alle mit dem Modul Meldungen
/// bekommen den Alarm, die Erfasserin nicht. Eine Wiederholung derselben Anfrage (Offline-Queue,
/// `client_id`) alarmiert nicht noch einmal; eine gewöhnliche Meldung alarmiert nicht.
#[tokio::test]
async fn neue_sofortmeldung_alarmiert_alle_leser_ausser_der_erfasserin() {
    let w = welt().await;
    let m = w.sofortmeldung("annika", w.anna, "sofort-1").await;

    assert_eq!(
        w.empfaenger("sofortmeldung").await,
        vec![w.admin_id, w.bert, w.carl]
    );
    let (bezug_typ, bezug_id, stufe): (String, i64, String) = sqlx::query_as(
        "SELECT bezug_typ, bezug_id, stufe FROM benachrichtigung WHERE art = 'sofortmeldung' LIMIT 1",
    )
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(
        (bezug_typ.as_str(), bezug_id, stufe.as_str()),
        ("meldung", m["id"].as_i64().unwrap(), "alarm")
    );

    // Replay derselben Offline-Aktion: keine zweite Benachrichtigung.
    w.sofortmeldung("annika", w.anna, "sofort-1").await;
    assert_eq!(w.empfaenger("sofortmeldung").await.len(), 3);

    // Eine gewöhnliche Meldung alarmiert nicht: sie ist ein Eingang (LLH-1143 D5), kein Alarm.
    let cookie = w.cookie("bertram").await;
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &w.pfad("meldungen"),
        &cookie,
        Some(
            &json!({
                "absender": "Florian Nord 2",
                "meldeweg": "funk",
                "inhalt": "Lage ruhig",
                "ereigniszeit": wire(Utc::now()),
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(w.empfaenger("sofortmeldung").await.len(), 3);
    let (alarme,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM benachrichtigung WHERE stufe = 'alarm' AND bezug_id = ?",
    )
    .bind(v["id"].as_i64().unwrap())
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(alarme, 0, "kein Alarm für die gewöhnliche Meldung");
}

/// Wer das Modul Meldungen nicht lesen darf, bekommt den Alarm nicht.
#[tokio::test]
async fn sofortmeldung_erreicht_niemanden_ohne_modul_meldungen() {
    let w = welt().await;
    w.modul_nur_fuer_admins("meldungen").await;
    let cookie = w.admin.clone();
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &w.pfad("meldungen"),
        &cookie,
        Some(
            &json!({
                "absender": "Florian Nord 1",
                "meldeweg": "funk",
                "inhalt": "MANV",
                "prioritaet": "sofort",
                "ereigniszeit": wire(Utc::now()),
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert!(w.empfaenger("sofortmeldung").await.is_empty());
}

/// Spec-Szenario „Eskalation“: bleibt die Sofortmeldung unbestätigt, alarmiert der Scheduler
/// alle mit dem Modul Meldungen erneut, jetzt einschließlich der Erfasserin; genau einmal, und
/// ohne eine zweite Benachrichtigung als Erinnerung.
#[tokio::test]
async fn eskalation_alarmiert_alle_leser_einschliesslich_der_erfasserin() {
    let w = welt().await;
    w.sofortmeldung("annika", w.anna, "sofort-2").await;

    w.tick(Utc::now() + Duration::minutes(10)).await;
    assert_eq!(
        w.empfaenger("sofortmeldung_eskaliert").await,
        vec![w.admin_id, w.anna, w.bert, w.carl]
    );
    assert!(w.empfaenger("erinnerung_faellig").await.is_empty());

    w.tick(Utc::now() + Duration::minutes(11)).await;
    assert_eq!(w.empfaenger("sofortmeldung_eskaliert").await.len(), 4);
}

/// Eine bestätigte Sofortmeldung eskaliert nicht.
#[tokio::test]
async fn bestaetigte_sofortmeldung_eskaliert_nicht() {
    let w = welt().await;
    let m = w.sofortmeldung("annika", w.anna, "sofort-3").await;
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &w.pfad(&format!("meldungen/{}/bestaetigen", m["id"])),
        &w.cookie("bertram").await,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    w.tick(Utc::now() + Duration::minutes(10)).await;
    assert!(w.empfaenger("sofortmeldung_eskaliert").await.is_empty());
}

// ───────────────────────── 3.2 Überfälliger Auftrag ─────────────────────────

/// Spec-Szenario „Auftrag an S2 überfällig“: Auftraggeberin und S2 bekommen den Alarm, ein
/// anderes Mitglied mit dem Modul Aufträge nicht.
#[tokio::test]
async fn auftrag_an_s2_ueberfaellig_alarmiert_auftraggeberin_und_s2() {
    let w = welt().await;
    w.besetzen("s2", "Bert", w.bert).await;
    let a = w.auftrag_mit_frist("annika", &["s2"]).await;

    w.tick(Utc::now() + Duration::minutes(30)).await;
    assert!(
        w.empfaenger("auftrag_ueberfaellig").await.is_empty(),
        "vor der Frist"
    );

    w.tick(Utc::now() + Duration::hours(2)).await;
    assert_eq!(
        w.empfaenger("auftrag_ueberfaellig").await,
        vec![w.anna, w.bert]
    );
    let bezug: (String, i64) = sqlx::query_as(
        "SELECT bezug_typ, bezug_id FROM benachrichtigung WHERE art = 'auftrag_ueberfaellig' LIMIT 1",
    )
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(bezug, ("auftrag".to_string(), a["id"].as_i64().unwrap()));
    // Die Quittierfrist ist keine eigene Erinnerung für jemanden.
    assert!(w.empfaenger("erinnerung_faellig").await.is_empty());

    w.tick(Utc::now() + Duration::hours(3)).await;
    assert_eq!(w.empfaenger("auftrag_ueberfaellig").await.len(), 2);
}

/// Spec-Szenario „Empfänger hat quittiert“: S3 hat quittiert, also nur Auftraggeberin und S2.
#[tokio::test]
async fn quittierter_empfaenger_bekommt_den_ueberfaelligen_auftrag_nicht() {
    let w = welt().await;
    w.besetzen("s2", "Bert", w.bert).await;
    w.besetzen("s3", "Carl", w.carl).await;
    let a = w.auftrag_mit_frist("annika", &["s2", "s3"]).await;
    let s3_zeile = a["empfaenger"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["funktion"] == "s3")
        .unwrap_or_else(|| panic!("S3-Zeile fehlt: {a}"))["id"]
        .as_i64()
        .unwrap();
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &w.pfad(&format!(
            "auftraege/{}/empfaenger/{s3_zeile}/quittieren",
            a["id"]
        )),
        &w.cookie("carlotta").await,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");

    w.tick(Utc::now() + Duration::hours(2)).await;
    assert_eq!(
        w.empfaenger("auftrag_ueberfaellig").await,
        vec![w.anna, w.bert]
    );
}

/// Haben alle quittiert, ist der Auftrag nicht überfällig: niemand bekommt einen Alarm.
#[tokio::test]
async fn voll_quittierter_auftrag_alarmiert_niemanden() {
    let w = welt().await;
    w.besetzen("s2", "Bert", w.bert).await;
    let a = w.auftrag_mit_frist("annika", &["s2"]).await;
    let zeile = a["empfaenger"][0]["id"].as_i64().unwrap();
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &w.pfad(&format!(
            "auftraege/{}/empfaenger/{zeile}/quittieren",
            a["id"]
        )),
        &w.cookie("bertram").await,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    w.tick(Utc::now() + Duration::hours(2)).await;
    assert!(w.empfaenger("auftrag_ueberfaellig").await.is_empty());
}

// ───────────────────────── 3.3 Fällige Erinnerung ─────────────────────────

/// Spec-Szenario „Erinnerung an S1“: die Nutzer von S1 bekommen den Hinweis, die Erstellerin und
/// andere nicht.
#[tokio::test]
async fn erinnerung_an_s1_erreicht_nur_s1() {
    let w = welt().await;
    w.besetzen("s1", "Bert", w.bert).await;
    let id = w.erinnerung("annika", Some("s1")).await;

    w.tick(Utc::now() + Duration::hours(2)).await;
    assert_eq!(w.empfaenger("erinnerung_faellig").await, vec![w.bert]);
    let (bezug_typ, bezug_id, stufe): (String, i64, String) = sqlx::query_as(
        "SELECT bezug_typ, bezug_id, stufe FROM benachrichtigung WHERE art = 'erinnerung_faellig'",
    )
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(
        (bezug_typ.as_str(), bezug_id, stufe.as_str()),
        ("erinnerung", id, "hinweis")
    );
}

/// Spec-Szenario „Erinnerung ohne Empfänger“: die Erstellerin bekommt den Hinweis, sonst
/// niemand — auch wenn sie ihn selbst angelegt hat (der Scheduler ist der Auslöser).
#[tokio::test]
async fn erinnerung_ohne_empfaenger_erreicht_die_erstellerin() {
    let w = welt().await;
    w.erinnerung("annika", None).await;
    w.tick(Utc::now() + Duration::hours(2)).await;
    assert_eq!(w.empfaenger("erinnerung_faellig").await, vec![w.anna]);
}

/// Eine von Hand angelegte Erinnerung mit Bezug auf eine Meldung oder einen Auftrag ist keine
/// Frist ihres Bezugs: sie meldet sich als „Erinnerung fällig“ an ihren Empfänger, nicht als
/// Eskalation und nicht als überfälliger Auftrag.
#[tokio::test]
async fn erinnerung_von_hand_zu_meldung_oder_auftrag_bleibt_eine_erinnerung() {
    let w = welt().await;
    w.besetzen("s1", "Bert", w.bert).await;
    let cookie = w.cookie("annika").await;
    let (s, meldung) = anfrage(
        &w.app,
        "POST",
        &w.pfad("meldungen"),
        &cookie,
        Some(
            &json!({
                "absender": "Florian Nord 1",
                "meldeweg": "funk",
                "inhalt": "Deich hält",
                "ereigniszeit": wire(Utc::now()),
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{meldung}");
    let auftrag = w.auftrag_mit_frist("annika", &["s2"]).await;
    w.erinnerung_zu(
        "annika",
        Some("s1"),
        Some(("meldung", meldung["id"].as_i64().unwrap())),
    )
    .await;
    w.erinnerung_zu(
        "annika",
        None,
        Some(("auftrag", auftrag["id"].as_i64().unwrap())),
    )
    .await;

    w.tick(Utc::now() + Duration::hours(2)).await;
    assert_eq!(
        w.empfaenger("erinnerung_faellig").await,
        vec![w.anna, w.bert]
    );
    assert!(w.empfaenger("sofortmeldung_eskaliert").await.is_empty());
    // Die Quittierfrist des Auftrags meldet sich daneben auf ihrem eigenen Weg.
    assert_eq!(w.empfaenger("auftrag_ueberfaellig").await, vec![w.anna]);
}

// ───────────────────────── 3.4 Ablösung ─────────────────────────

/// Legt Einheit und Schicht an: Beginn vor einer Stunde, Rhythmus zwei Stunden, also Vorwarnung
/// in 30 und Fälligkeit in 60 Minuten.
async fn schicht(w: &Welt) -> i64 {
    let (s, einheit) = anfrage(
        &w.app,
        "POST",
        &w.pfad("einheiten"),
        &w.admin,
        Some(r#"{"name":"Florian 1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{einheit}");
    let (s, schicht) = anfrage(
        &w.app,
        "POST",
        &w.pfad("abloesungen"),
        &w.admin,
        Some(
            &json!({
                "einheit_id": einheit["id"],
                "beginn_at": wire(Utc::now() - Duration::hours(1)),
                "rhythmus_minuten": 120,
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{schicht}");
    schicht["id"].as_i64().unwrap()
}

/// Spec-Szenario „Ablösung fällig“: Vorwarnung als Hinweis und Fälligkeit als Alarm an alle mit
/// dem Modul Ablösung, je genau einmal und ohne zweite Benachrichtigung als Erinnerung.
#[tokio::test]
async fn abloesung_meldet_vorwarnung_und_faelligkeit_an_die_modul_leser() {
    let w = welt().await;
    let id = schicht(&w).await;
    let alle = vec![w.admin_id, w.anna, w.bert, w.carl];

    w.tick(Utc::now() + Duration::minutes(40)).await;
    assert_eq!(w.empfaenger("abloesung_vorwarnung").await, alle);
    assert!(w.empfaenger("abloesung_faellig").await.is_empty());

    w.tick(Utc::now() + Duration::minutes(70)).await;
    assert_eq!(w.empfaenger("abloesung_faellig").await, alle);
    w.tick(Utc::now() + Duration::minutes(71)).await;
    assert_eq!(w.empfaenger("abloesung_vorwarnung").await.len(), 4);
    assert_eq!(w.empfaenger("abloesung_faellig").await.len(), 4);
    assert!(
        w.empfaenger("erinnerung_faellig").await.is_empty(),
        "kein Doppel"
    );

    // Der Toast nennt die Einheit und die Uhrzeit der Fälligkeit, springt in die Ablösung.
    let b: i64 = sqlx::query_scalar(
        "SELECT id FROM benachrichtigung WHERE art = 'abloesung_faellig' AND benutzer_id = ?",
    )
    .bind(w.anna)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/benachrichtigungen/{b}"),
        &w.cookie("annika").await,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Ablösung fällig");
    assert_eq!(v["bezug_typ"], "abloesung");
    assert_eq!(v["bezug_id"], id);
    let detail = v["detail"].as_str().unwrap_or_default();
    assert!(
        detail.starts_with("Florian 1, ") && detail.len() == "Florian 1, 00:00".len(),
        "{v}"
    );
    assert_eq!(
        v["pfad"],
        format!("/einsaetze/{}/abloesung?schicht={id}", w.einsatz).as_str()
    );
}

/// Wer das Modul Ablösung nicht lesen darf, bekommt keine Ablösung.
#[tokio::test]
async fn abloesung_erreicht_niemanden_ohne_modul_abloesung() {
    let w = welt().await;
    schicht(&w).await;
    w.modul_nur_fuer_admins("abloesung").await;
    w.tick(Utc::now() + Duration::minutes(70)).await;
    assert_eq!(w.empfaenger("abloesung_faellig").await, vec![w.admin_id]);
}
