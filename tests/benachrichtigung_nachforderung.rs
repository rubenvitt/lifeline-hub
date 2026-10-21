//! Benachrichtigungen zum Status einer Nachforderung (LLH-1216, Change
//! `kcjecn9e-benachrichtigungskonzept`, Spec `benachrichtigungen`, „Status einer Nachforderung“
//! und „Eigene Aktionen benachrichtigen den Auslöser nicht“): beide Schreibwege des Status
//! (`…/status` und `…/ablehnen`) melden `nachforderung_status` an den Ersteller und S4, und zwar
//! nur beim Wechsel in zugesagt, unterwegs, eingetroffen oder abgelehnt.

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
    /// Mitglied (Führungspersonal) „annika“, legt die Nachforderung an.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“, besetzt S4.
    bert: i64,
    /// Mitglied (Führungspersonal) „carla“, weder Ersteller noch S4.
    carla: i64,
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
    for id in [anna, bert, carla] {
        rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
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
        admin,
        admin_id,
        einsatz,
        anna,
        bert,
        carla,
    }
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Besetzt S4 in der Stab-Besetzung mit einer Stamm-Person, die mit `benutzer_id`
    /// verknüpft ist.
    async fn s4_besetzen(&self, benutzer_id: i64) {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            "/api/personal",
            &self.admin,
            Some(&json!({ "name": "Stab S4", "benutzer_id": benutzer_id }).to_string()),
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
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/stab/besetzung/s4", self.einsatz),
            &self.admin,
            Some(&json!({ "besetzung_art": "personal", "personal_id": v["id"] }).to_string()),
        )
        .await;
        assert!(s.is_success(), "besetzen s4: {s} {v}");
    }

    /// Legt als `cookie` die Nachforderung „2 RTW“ an die Leitstelle an; liefert ihre Kennung.
    async fn anfordern(&self, cookie: &str) -> i64 {
        let body = json!({
            "art": "RTW",
            "bezeichnung": "Verstärkung Abschnitt Deich",
            "anzahl": 2,
            "adressat_kategorie": "leitstelle",
            "adressat_bezeichnung": "Leitstelle Nord",
            "begruendung": "Zwei Verletzte am Deich",
        });
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/nachforderungen", self.einsatz),
            cookie,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    async fn status(&self, cookie: &str, nachforderung: i64, status: &str) -> StatusCode {
        let (s, _) = anfrage(
            &self.app,
            "POST",
            &format!(
                "/api/einsaetze/{}/nachforderungen/{nachforderung}/status",
                self.einsatz
            ),
            cookie,
            Some(&json!({ "status": status }).to_string()),
        )
        .await;
        s
    }

    async fn ablehnen(&self, cookie: &str, nachforderung: i64) -> StatusCode {
        let (s, _) = anfrage(
            &self.app,
            "POST",
            &format!(
                "/api/einsaetze/{}/nachforderungen/{nachforderung}/ablehnen",
                self.einsatz
            ),
            cookie,
            Some(&json!({ "grund": "Keine Kräfte frei" }).to_string()),
        )
        .await;
        s
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    /// Die Empfänger der Benachrichtigungen mit diesem Bezugstyp, aufsteigend.
    async fn empfaenger(&self, bezug_typ: &str) -> Vec<i64> {
        let mut e: Vec<i64> = self
            .zeilen()
            .await
            .into_iter()
            .filter(|z| z.2 == bezug_typ)
            .map(|z| z.0)
            .collect();
        e.sort_unstable();
        e
    }

    /// Die Benachrichtigungen, wie `cookie` sie über die Route liest (neueste zuerst).
    async fn lesen(&self, cookie: &str) -> Vec<Value> {
        let (s, v) = anfrage(&self.app, "GET", "/api/benachrichtigungen", cookie, None).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v.as_array().unwrap().clone()
    }
}

fn sortiert(mut v: Vec<i64>) -> Vec<i64> {
    v.sort_unstable();
    v
}

/// Spec-Szenario „Nachforderung eingetroffen“: die Nachforderung „2 RTW“ von Person A wechselt
/// auf eingetroffen, A und S4 erhalten einen Hinweis mit dem neuen Status. Ein weiteres Mitglied
/// mit dem Modul Nachforderungen und der Auslöser bekommen nichts.
#[tokio::test]
async fn nachforderung_eingetroffen_erreicht_ersteller_und_s4() {
    let w = welt().await;
    w.s4_besetzen(w.bert).await;
    let nf = w.anfordern(&w.cookie("annika").await).await;
    assert_eq!(w.status(&w.admin, nf, "zugesagt").await, StatusCode::OK);
    assert_eq!(w.status(&w.admin, nf, "unterwegs").await, StatusCode::OK);
    assert_eq!(w.status(&w.admin, nf, "eingetroffen").await, StatusCode::OK);

    assert_eq!(
        w.empfaenger("nachforderung_eingetroffen").await,
        sortiert(vec![w.anna, w.bert])
    );
    let zeilen = w.zeilen().await;
    assert!(
        zeilen
            .iter()
            .all(|z| z.1 == "nachforderung_status" && z.3 == nf),
        "{zeilen:?}"
    );
    assert!(
        zeilen.iter().all(|z| z.0 != w.carla && z.0 != w.admin_id),
        "weder Unbeteiligte noch der Auslöser: {zeilen:?}"
    );

    for name in ["annika", "bertram"] {
        let gelesen = w.lesen(&w.cookie(name).await).await;
        assert_eq!(gelesen.len(), 3, "{name}: {gelesen:?}");
        let neueste = &gelesen[0];
        assert_eq!(neueste["art"], "nachforderung_status");
        assert_eq!(neueste["stufe"], "hinweis");
        assert_eq!(neueste["titel"], "Nachforderung eingetroffen");
        // „RTW“ ist ein Scrub-Wert (`nachforderung.art`) und steht nie im Detail; Anzahl und
        // Adressat-Kategorie sind Retain-Werte.
        assert_eq!(neueste["detail"], "2× an Leitstelle");
        assert_eq!(
            neueste["pfad"],
            format!("/einsaetze/{}/nachforderungen", w.einsatz)
        );
        // Ältere Hinweise nennen den Status ihres Wechsels, nicht den heutigen.
        let titel: Vec<&str> = gelesen
            .iter()
            .map(|g| g["titel"].as_str().unwrap())
            .collect();
        assert_eq!(
            sortiert_str(titel),
            vec![
                "Nachforderung eingetroffen",
                "Nachforderung unterwegs",
                "Nachforderung zugesagt"
            ]
        );
    }
    assert!(w.lesen(&w.cookie("carla").await).await.is_empty());
}

fn sortiert_str(mut v: Vec<&str>) -> Vec<&str> {
    v.sort_unstable();
    v
}

/// Gemeldet wird der Wechsel in jeden der vier Status, auch über den eigenen Weg der Ablehnung
/// und auch als Rücknahme um eine Stufe (die Empfänger erfahren, dass sie doch noch unterwegs
/// ist); die Rücknahme auf „angefordert“ bleibt still.
#[tokio::test]
async fn jeder_der_vier_status_meldet_die_ruecknahme_auf_angefordert_nicht() {
    let w = welt().await;
    w.s4_besetzen(w.bert).await;
    let nf = w.anfordern(&w.admin).await;
    assert!(w.zeilen().await.is_empty(), "Anlegen meldet keinen Status");

    assert_eq!(w.status(&w.admin, nf, "zugesagt").await, StatusCode::OK);
    assert_eq!(w.empfaenger("nachforderung_zugesagt").await, vec![w.bert]);
    // Der Ausgang der Rücknahme auf „angefordert“ ist hier gleich: sie meldet nichts.
    w.status(&w.admin, nf, "angefordert").await;
    assert_eq!(
        w.zeilen().await.len(),
        1,
        "Rücknahme auf angefordert bleibt still"
    );

    let nf2 = w.anfordern(&w.admin).await;
    assert_eq!(w.status(&w.admin, nf2, "zugesagt").await, StatusCode::OK);
    assert_eq!(w.status(&w.admin, nf2, "unterwegs").await, StatusCode::OK);
    assert_eq!(w.empfaenger("nachforderung_unterwegs").await, vec![w.bert]);
    assert_eq!(
        w.status(&w.admin, nf2, "eingetroffen").await,
        StatusCode::OK
    );
    assert_eq!(w.status(&w.admin, nf2, "unterwegs").await, StatusCode::OK);
    assert_eq!(
        w.empfaenger("nachforderung_unterwegs").await,
        vec![w.bert, w.bert],
        "Rücknahme auf unterwegs meldet erneut"
    );
    assert_eq!(w.ablehnen(&w.admin, nf2).await, StatusCode::OK);
    assert_eq!(w.empfaenger("nachforderung_abgelehnt").await, vec![w.bert]);

    let gelesen = w.lesen(&w.cookie("bertram").await).await;
    assert_eq!(gelesen.len(), 6, "{gelesen:?}");
    assert_eq!(gelesen[0]["titel"], "Nachforderung abgelehnt");
    // Der Ablehnungsgrund ist ein Scrub-Wert und erscheint nicht.
    assert_eq!(gelesen[0]["detail"], "2× an Leitstelle");
}

/// Kein Hinweis ohne tatsächlichen Wechsel: ein wiederholter Schritt ist 422 und meldet nichts,
/// eine zweite Ablehnung auch nicht.
#[tokio::test]
async fn ohne_statuswechsel_kein_hinweis() {
    let w = welt().await;
    w.s4_besetzen(w.bert).await;
    let nf = w.anfordern(&w.admin).await;
    assert_eq!(w.status(&w.admin, nf, "zugesagt").await, StatusCode::OK);
    assert_eq!(
        w.status(&w.admin, nf, "zugesagt").await,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(w.zeilen().await.len(), 1);
    assert_eq!(w.ablehnen(&w.admin, nf).await, StatusCode::OK);
    assert_eq!(
        w.ablehnen(&w.admin, nf).await,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(w.zeilen().await.len(), 2);
}

/// Spec „Eigene Aktionen benachrichtigen den Auslöser nicht“: schaltet der Ersteller selbst
/// weiter, bekommt nur S4 den Hinweis; schaltet S4, nur der Ersteller.
#[tokio::test]
async fn eigene_statusaenderung_benachrichtigt_den_ausloeser_nicht() {
    let w = welt().await;
    w.s4_besetzen(w.bert).await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let nf = w.anfordern(&anna).await;

    assert_eq!(w.status(&anna, nf, "zugesagt").await, StatusCode::OK);
    assert_eq!(w.empfaenger("nachforderung_zugesagt").await, vec![w.bert]);
    assert_eq!(w.status(&bert, nf, "unterwegs").await, StatusCode::OK);
    assert_eq!(w.empfaenger("nachforderung_unterwegs").await, vec![w.anna]);
}

/// Wer die Nachforderung angelegt hat und zugleich S4 besetzt, bekommt einen Hinweis, nicht zwei.
#[tokio::test]
async fn ersteller_der_s4_besetzt_bekommt_einen_hinweis() {
    let w = welt().await;
    w.s4_besetzen(w.anna).await;
    let nf = w.anfordern(&w.cookie("annika").await).await;
    assert_eq!(w.status(&w.admin, nf, "zugesagt").await, StatusCode::OK);
    assert_eq!(w.empfaenger("nachforderung_zugesagt").await, vec![w.anna]);
}

/// LLH-1104 (design.md D7): Der ETB-Eintrag einer Stufe löst keinen zweiten Hinweis aus — je
/// Wechsel bleibt es bei einer Zeile je Empfänger, und alle Zeilen sind `nachforderung_status`.
#[tokio::test]
async fn etb_eintrag_der_stufe_benachrichtigt_nicht_doppelt() {
    let w = welt().await;
    w.s4_besetzen(w.bert).await;
    let nf = w.anfordern(&w.cookie("annika").await).await;
    assert_eq!(w.status(&w.admin, nf, "zugesagt").await, StatusCode::OK);
    let stufen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE nachforderung_id = ? AND typ = 'system'",
    )
    .bind(nf)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(stufen, 1, "die Stufe steht im ETB");
    let zeilen = w.zeilen().await;
    assert_eq!(zeilen.len(), 2, "Ersteller und S4, je einmal: {zeilen:?}");
    assert!(
        zeilen.iter().all(|z| z.1 == "nachforderung_status"),
        "{zeilen:?}"
    );
}
