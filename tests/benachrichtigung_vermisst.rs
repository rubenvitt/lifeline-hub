//! Alarm „Vermisstenmeldung“ (LLH-1425, Katalog LLH-1142 E1, Spec `benachrichtigungen`,
//! „Vermisstenmeldung“): die Anlage einer Person mit Status vermisst und der Statuswechsel auf
//! vermisst melden `vermisstenmeldung` (Stufe Alarm) an die Leser des Moduls Personen, ohne den
//! Auslöser. Je Wechsel genau einer: ein Replay der Anlage und ein zweiter Wechsel auf vermisst
//! (ein Übergang auf denselben Status ist 422) melden nicht noch einmal. Der Text trägt nur die
//! Registriernummer; ein Alarm lässt sich nicht abschalten.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// Mitglied (Führungspersonal) „annika“, erfasst und setzt den Status.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“.
    bert: i64,
    /// Mitglied (Beobachter) „carla“; liest das Modul Personen nicht (Override).
    carla: i64,
    /// Kein Mitglied: „dorian“.
    dorian: i64,
}

/// Eine gespeicherte Benachrichtigung: (Empfänger, Art, Stufe, Bezugstyp, Bezugskennung).
type Zeile = (i64, String, String, String, i64);

async fn welt() -> Welt {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let carla = benutzer_anlegen(&app, &admin, "carla", "keine").await;
    let dorian = benutzer_anlegen(&app, &admin, "dorian", "keine").await;
    rolle_setzen(&app, &admin, einsatz, anna, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, bert, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, carla, "beobachter").await;
    // Die Aufnahmen oben melden `einsatz_aufnahme` (`tests/benachrichtigung_org.rs`); die Tests
    // hier beginnen mit leerer Tabelle.
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();
    let w = Welt {
        app,
        pool,
        admin,
        admin_id,
        einsatz,
        anna,
        bert,
        carla,
        dorian,
    };
    // Nur die Führung im Einsatz liest das Modul Personen; die Beobachterin nicht.
    let (s, v) = anfrage(
        &w.app,
        "PUT",
        &format!("/api/einsaetze/{}/modul-overrides/personen", w.einsatz),
        &w.admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"einsatzfuehrung"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    w
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Legt als `cookie` eine Person mit `body` an; liefert die Antwort.
    async fn person(&self, cookie: &str, body: Value) -> Value {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personen", self.einsatz),
            cookie,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v
    }

    /// Statuswechsel als `cookie`; liefert den Statuscode.
    async fn status(&self, cookie: &str, person: i64, status: &str) -> StatusCode {
        let (s, _) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personen/{person}/status", self.einsatz),
            cookie,
            Some(&json!({ "status": status }).to_string()),
        )
        .await;
        s
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, art, stufe, bezug_typ, bezug_id FROM benachrichtigung \
             ORDER BY id, benutzer_id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    /// Die erwarteten Zeilen eines Alarms zu `person`: Einsatzleitung (Admin) und Bert.
    fn erwartet(&self, person: i64) -> Vec<Zeile> {
        [self.admin_id, self.bert]
            .into_iter()
            .map(|b| {
                (
                    b,
                    "vermisstenmeldung".into(),
                    "alarm".into(),
                    "person".into(),
                    person,
                )
            })
            .collect()
    }

    fn pruefe_gegenseite(&self, zeilen: &[Zeile]) {
        for nicht in [self.anna, self.carla, self.dorian] {
            assert!(
                zeilen.iter().all(|z| z.0 != nicht),
                "{nicht} darf nichts bekommen: {zeilen:?}"
            );
        }
    }
}

/// Spec-Szenario „Person auf vermisst gesetzt“: Annika setzt eine erfasste Person auf vermisst.
/// Alle mit dem Modul Personen bekommen den Alarm „Vermisstenmeldung“; nicht Annika, nicht die
/// Beobachterin ohne das Modul, nicht wer nicht Mitglied ist. Der Text nennt nur die
/// Registriernummer, weder Name noch Notiz.
#[tokio::test]
async fn wechsel_auf_vermisst_alarmiert_die_leser_der_personen() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let p = w
        .person(
            &anna,
            json!({ "name": "Mustermann", "notiz": "zuletzt am Deich gesehen" }),
        )
        .await;
    let person = p["id"].as_i64().unwrap();
    assert!(w.zeilen().await.is_empty(), "erfasst meldet nichts");

    assert_eq!(w.status(&anna, person, "vermisst").await, StatusCode::OK);

    let zeilen = w.zeilen().await;
    assert_eq!(zeilen, w.erwartet(person));
    w.pruefe_gegenseite(&zeilen);

    let bert = w.cookie("bertram").await;
    let (s, offen) = anfrage(
        &w.app,
        "GET",
        "/api/benachrichtigungen?offen=true",
        &bert,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{offen}");
    let liste = offen.as_array().unwrap();
    assert_eq!(liste.len(), 1, "{offen}");
    assert_eq!(liste[0]["art"], "vermisstenmeldung");
    assert_eq!(liste[0]["titel"], "Vermisstenmeldung");
    assert_eq!(liste[0]["stufe"], "alarm");
    assert_eq!(liste[0]["detail"], "Person R-001");
    assert_eq!(
        liste[0]["pfad"],
        format!("/einsaetze/{}/personen/{person}", w.einsatz)
    );
    let text = offen.to_string();
    for scrub in ["Mustermann", "Deich"] {
        assert!(!text.contains(scrub), "{scrub} im Text: {text}");
    }
}

/// Spec-Szenario „Person als vermisst erfasst“: die Anlage mit Status vermisst alarmiert einmal;
/// ein Replay derselben Anlage (`client_id`, Offline-Queue) alarmiert nicht noch einmal.
#[tokio::test]
async fn anlage_als_vermisst_alarmiert_einmal_auch_beim_replay() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let body = json!({ "name": "Mustermann", "status": "vermisst", "client_id": "offline-9" });
    let p = w.person(&anna, body.clone()).await;
    let person = p["id"].as_i64().unwrap();

    let zeilen = w.zeilen().await;
    assert_eq!(zeilen, w.erwartet(person));
    w.pruefe_gegenseite(&zeilen);

    let wieder = w.person(&anna, body).await;
    assert_eq!(wieder["id"], p["id"], "Replay liefert dieselbe Person");
    assert_eq!(w.zeilen().await, zeilen, "Replay alarmiert nicht erneut");
}

/// Doppelschutz und Gegenseiten: ein zweiter Wechsel auf vermisst ist kein Übergang (422) und
/// alarmiert nicht; andere Wechsel und die Anlage als betroffen bleiben still. Wird die Person
/// gefunden und später erneut vermisst, ist das eine neue Vermisstenmeldung.
#[tokio::test]
async fn je_wechsel_auf_vermisst_genau_ein_alarm() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let andere = w.person(&anna, json!({ "status": "betroffen" })).await["id"]
        .as_i64()
        .unwrap();
    assert_eq!(w.status(&anna, andere, "abgemeldet").await, StatusCode::OK);
    assert!(w.zeilen().await.is_empty(), "kein Wechsel auf vermisst");

    let person = w.person(&anna, json!({})).await["id"].as_i64().unwrap();
    assert_eq!(w.status(&anna, person, "vermisst").await, StatusCode::OK);
    let einmal = w.zeilen().await;
    assert_eq!(einmal, w.erwartet(person));

    // Derselbe Wechsel noch einmal (Doppelklick, zweiter Tab): 422, kein zweiter Alarm.
    assert_eq!(
        w.status(&anna, person, "vermisst").await,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // Gefunden: kein Alarm.
    assert_eq!(w.status(&anna, person, "betroffen").await, StatusCode::OK);
    assert_eq!(w.zeilen().await, einmal, "keine weitere Benachrichtigung");

    // Erneut vermisst: ein neuer Wechsel, ein neuer Alarm.
    assert_eq!(w.status(&anna, person, "vermisst").await, StatusCode::OK);
    assert_eq!(w.zeilen().await.len(), einmal.len() + 2);
}

/// Ein Alarm lässt sich nicht abschalten: wer `vermisstenmeldung` in seine abgeschalteten Arten
/// legen will, bekommt 422, und der Alarm erreicht ihn weiter.
#[tokio::test]
async fn vermisstenmeldung_ist_nicht_abschaltbar() {
    let w = welt().await;
    let bert = w.cookie("bertram").await;
    let (s, v) = anfrage(
        &w.app,
        "PUT",
        "/api/benutzer-einstellungen/benachrichtigungen_aus",
        &bert,
        Some(&json!({ "wert": "[\"vermisstenmeldung\"]" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    let anna = w.cookie("annika").await;
    let person = w.person(&anna, json!({ "status": "vermisst" })).await["id"]
        .as_i64()
        .unwrap();
    assert_eq!(w.zeilen().await, w.erwartet(person));
}
