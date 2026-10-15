//! Benachrichtigung „Neue Person der Sichtungskategorie I“ (LLH-1218, Change
//! `kcjecn9e-benachrichtigungskonzept`, Spec `benachrichtigungen`, „Neue Person der
//! Sichtungskategorie I“ und „Eigene Aktionen benachrichtigen den Auslöser nicht“): die Anlage
//! einer Person mit SK I und die Hochstufung auf SK I melden `sichtung_eins` an die Leser des
//! Moduls Personen. Eine Sichtung, die schon SK I war, eine Herabstufung, eine Bearbeitung ohne
//! Sichtung und ein Replay der Anlage bleiben still. Der Text trägt nur die Registriernummer.

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
    /// Mitglied (Führungspersonal) „annika“, erfasst und sichtet.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“.
    bert: i64,
    /// Mitglied (Beobachter) „carla“; liest das Modul Personen nicht (Override).
    carla: i64,
    /// Kein Mitglied: „dorian“.
    dorian: i64,
}

/// Eine gespeicherte Benachrichtigung: (Empfänger, Art, Bezugstyp, Bezugskennung).
type Zeile = (i64, String, String, i64);

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

    async fn sichten(&self, cookie: &str, person: i64, kategorie: &str) {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personen/{person}/sichtung", self.einsatz),
            cookie,
            Some(&json!({ "kategorie": kategorie, "notiz": "Atemnot, Brustschmerz" }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung \
             ORDER BY id, benutzer_id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    /// Die erwarteten Zeilen eines Hinweises zu `person`: Einsatzleitung (Admin) und Bert.
    fn erwartet(&self, person: i64) -> Vec<Zeile> {
        [self.admin_id, self.bert]
            .into_iter()
            .map(|b| (b, "sichtung_eins".into(), "person".into(), person))
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

/// Spec-Szenario „Hochstufung“: Annika stuft eine Person von SK II auf SK I hoch. Alle mit dem
/// Modul Personen bekommen den Hinweis „Sichtung I“; nicht Annika, nicht die Beobachterin ohne
/// das Modul, nicht wer nicht Mitglied ist. Der Text nennt nur die Registriernummer, weder Name
/// noch Notiz.
#[tokio::test]
async fn hochstufung_auf_sk1_erreicht_die_leser_der_personen() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let p = w
        .person(&anna, json!({ "name": "Mustermann", "sichtung": "sk2" }))
        .await;
    let person = p["id"].as_i64().unwrap();
    assert!(w.zeilen().await.is_empty(), "SK II meldet nichts");

    w.sichten(&anna, person, "sk1").await;

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
    assert_eq!(liste[0]["titel"], "Sichtung I");
    assert_eq!(liste[0]["stufe"], "hinweis");
    assert_eq!(liste[0]["detail"], "Person R-001");
    assert_eq!(
        liste[0]["pfad"],
        format!("/einsaetze/{}/personen/{person}", w.einsatz)
    );
    let text = offen.to_string();
    for scrub in ["Mustermann", "Atemnot"] {
        assert!(!text.contains(scrub), "{scrub} im Text: {text}");
    }
}

/// Die Neuerfassung mit SK I meldet einmal; ein Replay derselben Anlage (`client_id`, Offline-
/// Queue) meldet nicht noch einmal.
#[tokio::test]
async fn neuerfassung_mit_sk1_meldet_einmal_auch_beim_replay() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let body = json!({ "name": "Mustermann", "sichtung": "sk1", "client_id": "offline-7" });
    let p = w.person(&anna, body.clone()).await;
    let person = p["id"].as_i64().unwrap();

    let zeilen = w.zeilen().await;
    assert_eq!(zeilen, w.erwartet(person));
    w.pruefe_gegenseite(&zeilen);

    let wieder = w.person(&anna, body).await;
    assert_eq!(wieder["id"], p["id"], "Replay liefert dieselbe Person");
    assert_eq!(w.zeilen().await, zeilen, "Replay meldet nicht erneut");
}

/// Erst-Sichtung SK I an einer Person, die ohne Sichtung erfasst wurde, ist eine Hochstufung.
#[tokio::test]
async fn erste_sichtung_mit_sk1_meldet() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let person = w.person(&anna, json!({})).await["id"].as_i64().unwrap();
    assert!(
        w.zeilen().await.is_empty(),
        "Anlage ohne Sichtung meldet nichts"
    );

    w.sichten(&anna, person, "sk1").await;
    assert_eq!(w.zeilen().await, w.erwartet(person));
}

/// Gegenseiten: Anlage mit anderer Kategorie, erneute SK-I-Sichtung, Bearbeitung ohne
/// Kategoriewechsel und Herabstufung bleiben still.
#[tokio::test]
async fn ohne_wechsel_auf_sk1_bleibt_es_still() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let andere = w.person(&anna, json!({ "sichtung": "sk3" })).await;
    w.sichten(&anna, andere["id"].as_i64().unwrap(), "sk2")
        .await;
    assert!(w.zeilen().await.is_empty(), "SK III → SK II meldet nichts");

    let person = w.person(&anna, json!({ "sichtung": "sk1" })).await["id"]
        .as_i64()
        .unwrap();
    let nach_anlage = w.zeilen().await;
    assert_eq!(nach_anlage, w.erwartet(person));

    // Schon SK I: eine erneute Sichtung mit SK I ist kein Wechsel.
    w.sichten(&anna, person, "sk1").await;
    // Bearbeitung ohne Sichtung.
    let (s, v) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/personen/{person}", w.einsatz),
        &anna,
        Some(&json!({ "notiz": "Angehörige verständigt" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Herabstufung.
    w.sichten(&anna, person, "sk2").await;

    assert_eq!(
        w.zeilen().await,
        nach_anlage,
        "keine weitere Benachrichtigung"
    );

    // Von SK II wieder auf SK I ist erneut eine Hochstufung.
    w.sichten(&anna, person, "sk1").await;
    assert_eq!(w.zeilen().await.len(), nach_anlage.len() + 2);
}
