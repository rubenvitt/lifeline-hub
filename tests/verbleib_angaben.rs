//! Integrationstests zu LLH-1568 (Spec `verbleib-angaben`): Einsatznummer der Leitstelle,
//! „Entlassen an“ und „Gegen Rat“ am Verbleib. Die Migration pinnt
//! `db::tests::migration_0280_*`, die Schwärzung die Registry-Guards.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

struct Welt {
    app: axum::Router,
    admin: String,
    einsatz: i64,
}

impl Welt {
    async fn neu() -> Self {
        let (app, _pool) = setup_mit_pool().await;
        let admin = login_cookie(&app, "admin", "startpw12").await;
        let einsatz = einsatz_anlegen(&app, &admin).await;
        Self {
            app,
            admin,
            einsatz,
        }
    }

    async fn person(&self) -> i64 {
        person_anlegen(&self.app, &self.admin, self.einsatz, "{}").await
    }

    async fn fahrzeug(&self, funkrufname: &str) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/fahrzeuge", self.einsatz),
            &self.admin,
            Some(&json!({ "adhoc": { "funkrufname": funkrufname } }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    async fn verbleib(&self, person: i64, body: Value) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personen/{person}/verbleib", self.einsatz),
            &self.admin,
            Some(&body.to_string()),
        )
        .await
    }

    async fn detail(&self, person: i64) -> Value {
        let (s, v) = anfrage(
            &self.app,
            "GET",
            &format!("/api/einsaetze/{}/personen/{person}", self.einsatz),
            &self.admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v
    }
}

#[tokio::test]
async fn fremder_transport_traegt_die_einsatznummer_der_leitstelle() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "fremd",
                    "transportmittel": "RTW 3/83-2", "ziel": "KH Mitte",
                    "status": "abtransportiert",
                    "leitstelle_einsatznummer": "  2611-0815 " }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["leitstelle_einsatznummer"], "2611-0815", "getrimmt");
    let d = w.detail(p).await;
    assert_eq!(d["verbleib"][0]["leitstelle_einsatznummer"], "2611-0815");
    assert_eq!(
        d["aktueller_verbleib"], "Transport → KH Mitte",
        "die Kurzform des Servers bleibt"
    );
    let etb = system_etb_inhalte(&w.app, &w.admin, w.einsatz).await;
    assert!(
        etb.iter().all(|t| !t.contains("2611-0815")),
        "keine Einsatznummer im ETB: {etb:?}"
    );
}

#[tokio::test]
async fn entlassung_an_die_polizei_gegen_rat_steht_nicht_im_etb() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "entlassung", "entlassen_an": "polizei",
                    "gegen_rat": "transport", "unterschrift": "liegt_vor" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["entlassen_an"], "polizei");
    assert_eq!(v["gegen_rat"], "transport");
    assert_eq!(v["unterschrift"], "liegt_vor");
    assert!(v.get("leitstelle_einsatznummer").is_none());
    let etb = system_etb_inhalte(&w.app, &w.admin, w.einsatz).await;
    let zeile = etb
        .iter()
        .find(|t| t.starts_with("Person") && t.contains("entlassen"))
        .expect("ETB-Eintrag der Entlassung");
    assert!(
        zeile.ends_with(": entlassen"),
        "nur der Sachverhalt: {zeile}"
    );
}

#[tokio::test]
async fn gegen_rat_beim_transport() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "fremd",
                    "transportmittel": "RTW", "gegen_rat": "behandlung",
                    "unterschrift": "verweigert" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["gegen_rat"], "behandlung");
    assert_eq!(v["unterschrift"], "verweigert");
}

#[tokio::test]
async fn unbekannte_werte_und_zu_lange_einsatznummer_sind_400() {
    let w = Welt::neu().await;
    let p = w.person().await;
    for body in [
        json!({ "art": "entlassung", "entlassen_an": "nachbar" }),
        json!({ "art": "entlassung", "gegen_rat": "alles" }),
        json!({ "art": "entlassung", "gegen_rat": "behandlung", "unterschrift": "ja" }),
        json!({ "art": "transport", "transportmittel": "RTW",
                "leitstelle_einsatznummer": "x".repeat(51) }),
    ] {
        let (s, v) = w.verbleib(p, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }
    // Genau an der Grenze geht es durch.
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transportmittel": "RTW",
                    "leitstelle_einsatznummer": "x".repeat(50) }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

#[tokio::test]
async fn angaben_zur_falschen_art_sind_422() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let ef = w.fahrzeug("1/83-1").await;
    for body in [
        json!({ "art": "entlassung", "leitstelle_einsatznummer": "4711" }),
        json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef,
                "leitstelle_einsatznummer": "4711" }),
        json!({ "art": "transport", "transportmittel": "RTW", "entlassen_an": "selbst" }),
        json!({ "art": "vor_ort", "entlassen_an": "selbst" }),
        json!({ "art": "vor_ort", "gegen_rat": "behandlung" }),
        json!({ "art": "notunterkunft", "gegen_rat": "transport" }),
        json!({ "art": "entlassung", "unterschrift": "liegt_vor" }),
    ] {
        let (s, v) = w.verbleib(p, body.clone()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body} → {v}");
    }
    // Eine leere Einsatznummer gilt als fehlend.
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "entlassung", "leitstelle_einsatznummer": "   " }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

#[tokio::test]
async fn uebergabe_traegt_keine_angaben() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let ef = w.fahrzeug("1/83-1").await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef,
                    "ziel": "KH Mitte", "status": "abtransportiert" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef,
                    "status": "uebergeben", "gegen_rat": "behandlung" }),
        )
        .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}
