//! Integrationstests zu LLH-1332 (Spec `patienten-uebergabe`): wer einen Patienten transportiert,
//! die Übergabe eines Eigentransports, der abgeleitete Versorgungszustand und die Vorschläge zum
//! Rettungsmittel. Die Ableitung selbst pinnt `tests/verdichtung_fixture.rs`, den Rebuild der
//! Tabelle `db::tests::migration_0222_*`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

fn zeit(versatz_sek: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(versatz_sek))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    einsatz: i64,
}

impl Welt {
    async fn neu() -> Self {
        let (app, pool) = setup_mit_pool().await;
        let admin = login_cookie(&app, "admin", "startpw12").await;
        let einsatz = einsatz_anlegen(&app, &admin).await;
        Self {
            app,
            pool,
            admin,
            einsatz,
        }
    }

    async fn person(&self) -> i64 {
        person_anlegen(&self.app, &self.admin, self.einsatz, "{}").await
    }

    async fn fahrzeug(&self, einsatz: i64, funkrufname: &str) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
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
async fn fremdes_rettungsmittel_schliesst_den_patienten_ab() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "fremd",
                    "transportmittel": "RTW 3/83-2", "ziel": "KH Mitte",
                    "status": "abtransportiert" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["transport_durch"], "fremd");
    assert_eq!(v["transportmittel"], "RTW 3/83-2");
    let d = w.detail(p).await;
    assert_eq!(d["versorgung"], "abgeschlossen");
    assert_eq!(d["aktueller_transport_durch"], "fremd");
    assert_eq!(d["aktueller_verbleib"], "Transport → KH Mitte");
}

#[tokio::test]
async fn eigentransport_ist_unterwegs_bis_zur_uebergabe() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let ef = w.fahrzeug(w.einsatz, "1/83-1").await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef,
                    "transportmittel": "wird ersetzt", "ziel": "KH Mitte",
                    "status": "abtransportiert" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["einsatz_fahrzeug_id"], ef);
    assert_eq!(
        v["transportmittel"], "1/83-1",
        "der Funkrufname ist die Momentaufnahme"
    );
    let d = w.detail(p).await;
    assert_eq!(d["versorgung"], "unterwegs");
    assert_eq!(d["aktuelles_einsatz_fahrzeug_id"], ef);
    assert_eq!(d["aktueller_verbleib"], "Eigentransport 1/83-1 → KH Mitte");
    let etb = system_etb_inhalte(&w.app, &w.admin, w.einsatz).await;
    assert!(
        etb.iter().any(|t| t.ends_with("im Eigentransport")),
        "ETB ohne Ziel und Fahrzeug: {etb:?}"
    );
    // Die Disposition des Fahrzeugs steht mit Funkrufnamen im ETB; der Verbleib nicht.
    assert!(etb
        .iter()
        .filter(|t| t.starts_with("Person"))
        .all(|t| !t.contains("KH Mitte") && !t.contains("1/83-1")));

    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef,
                    "ziel": "KH Mitte", "status": "uebergeben" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let d = w.detail(p).await;
    assert_eq!(d["versorgung"], "abgeschlossen");
    assert_eq!(d["aktueller_verbleib"], "übergeben → KH Mitte");
    let etb = system_etb_inhalte(&w.app, &w.admin, w.einsatz).await;
    assert!(etb.iter().any(|t| t.ends_with("übergeben")), "{etb:?}");
}

#[tokio::test]
async fn fahrer_angabe_wird_gepaart_geprueft() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let ef = w.fahrzeug(w.einsatz, "1/83-1").await;
    for (body, grund) in [
        (
            json!({ "art": "entlassung", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef }),
            "Fahrer-Angabe bei anderer Art",
        ),
        (
            json!({ "art": "transport", "transport_durch": "eigen" }),
            "Eigentransport ohne Fahrzeug",
        ),
        (
            json!({ "art": "transport", "transport_durch": "fremd", "einsatz_fahrzeug_id": ef }),
            "Fahrzeug ohne Eigentransport",
        ),
        (
            json!({ "art": "transport", "transport_durch": "fremd", "status": "uebergeben" }),
            "Übergabe bei fremdem Rettungsmittel",
        ),
    ] {
        let (s, v) = w.verbleib(p, body).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{grund}: {v}");
    }
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "nachbar" }),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unbekannte Fahrer-Angabe: {v}");
    assert_eq!(w.detail(p).await["verbleib"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn fahrzeug_eines_anderen_einsatzes_ist_404() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let anderer = einsatz_anlegen_mit(&w.app, &w.admin, "Anderer Einsatz").await;
    let fremd = w.fahrzeug(anderer, "2/83-1").await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": fremd }),
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
}

#[tokio::test]
async fn erfassungszeit_entscheidet_ueber_ein_entlassenes_fahrzeug() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let ef = w.fahrzeug(w.einsatz, "1/83-1").await;
    // Person und Disposition liegen eine Stunde zurück, entlassen wurde vor zehn Minuten.
    sqlx::query("UPDATE einsatz_person SET erfasst_at = ? WHERE id = ?")
        .bind(zeit(-3600))
        .bind(p)
        .execute(&w.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET disponiert_at = ?, beendet_at = ?, \
         beendet_als = 'entlassen' WHERE id = ?",
    )
    .bind(zeit(-3600))
    .bind(zeit(-600))
    .bind(ef)
    .execute(&w.pool)
    .await
    .unwrap();

    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef }),
        )
        .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "jetzt nicht mehr disponiert: {v}"
    );

    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef,
                    "zeitpunkt_at": zeit(-1200) }),
        )
        .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "vor der Entlassung erfasst, später angekommen: {v}"
    );
    assert_eq!(w.detail(p).await["versorgung"], "unterwegs");
}

#[tokio::test]
async fn vorschlaege_nennen_einsatz_bisher_und_stamm() {
    let w = Welt::neu().await;
    let ef = w.fahrzeug(w.einsatz, "1/83-1").await;
    for _ in 0..2 {
        let p = w.person().await;
        let (s, v) = w
            .verbleib(
                p,
                json!({ "art": "transport", "transport_durch": "fremd",
                        "transportmittel": "RTW 3/83-2" }),
            )
            .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let p = w.person().await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transportmittel": " KTW 4/85-1 " }),
        )
        .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "Bestand ohne Fahrer-Angabe gilt als fremd: {v}"
    );
    let (s, v) = anfrage(
        &w.app,
        "POST",
        "/api/fahrzeuge",
        &w.admin,
        Some(r#"{"funkrufname":"Rotkreuz Musterstadt 83-1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Stamm-Fahrzeug: {v}");

    let (s, v) = anfrage(
        &w.app,
        "POST",
        "/api/fahrzeuge",
        &w.admin,
        Some(r#"{"funkrufname":"Ausgemustert 83-9"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    sqlx::query("UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE id = ?")
        .bind(v["id"].as_i64().unwrap())
        .execute(&w.pool)
        .await
        .unwrap();

    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/personen/transportmittel", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["im_einsatz"],
        json!([{ "einsatz_fahrzeug_id": ef, "funkrufname": "1/83-1" }])
    );
    assert_eq!(v["bisher"], json!(["RTW 3/83-2", "KTW 4/85-1"]));
    assert!(
        v["stamm"]
            .as_array()
            .unwrap()
            .contains(&json!("Rotkreuz Musterstadt 83-1")),
        "{v}"
    );
    assert!(
        !v["stamm"]
            .as_array()
            .unwrap()
            .contains(&json!("Ausgemustert 83-9")),
        "außer Dienst fehlt: {v}"
    );
}

#[tokio::test]
async fn uebergabe_geht_nach_der_entlassung_des_fahrzeugs_durch() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let ef = w.fahrzeug(w.einsatz, "1/83-1").await;
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef,
                    "ziel": "KH Mitte" }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    // Das Fahrzeug wird entlassen, bevor die UHS die Übergabe quittiert.
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET beendet_at = ?, beendet_als = 'entlassen' WHERE id = ?",
    )
    .bind(zeit(0))
    .bind(ef)
    .execute(&w.pool)
    .await
    .unwrap();
    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "status": "uebergeben", "transport_durch": "eigen",
                    "einsatz_fahrzeug_id": ef, "ziel": "KH Mitte", "zeitpunkt_at": zeit(1) }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "Übergabe nach der Entlassung: {v}");
    assert_eq!(w.detail(p).await["versorgung"], "abgeschlossen");
}

#[tokio::test]
async fn uebergabe_braucht_den_laufenden_eigentransport() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let ef = w.fahrzeug(w.einsatz, "1/83-1").await;
    let anderes = w.fahrzeug(w.einsatz, "1/83-2").await;
    let uebergabe = |fahrzeug: i64, zeitpunkt: Option<String>| {
        let mut b = json!({ "art": "transport", "status": "uebergeben",
                            "transport_durch": "eigen", "einsatz_fahrzeug_id": fahrzeug });
        if let Some(z) = zeitpunkt {
            b["zeitpunkt_at"] = json!(z);
        }
        b
    };

    let (s, v) = w.verbleib(p, uebergabe(ef, None)).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "ohne Eigentransport: {v}"
    );

    let (s, v) = w
        .verbleib(
            p,
            json!({ "art": "transport", "transport_durch": "eigen", "einsatz_fahrzeug_id": ef }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let beginn = v["zeitpunkt_at"].as_str().unwrap().to_string();

    let (s, v) = w.verbleib(p, uebergabe(anderes, None)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "anderes Fahrzeug: {v}");

    // Eine Übergabe vor dem Beginn des Eigentransports ist 422, statt still nachgetragen zu werden.
    sqlx::query("UPDATE einsatz_person SET erfasst_at = ? WHERE id = ?")
        .bind(zeit(-3600))
        .bind(p)
        .execute(&w.pool)
        .await
        .unwrap();
    let frueher = (chrono::NaiveDateTime::parse_from_str(&beginn, "%Y-%m-%d %H:%M:%S").unwrap()
        - chrono::Duration::minutes(5))
    .format("%Y-%m-%d %H:%M:%S")
    .to_string();
    let (s, v) = w.verbleib(p, uebergabe(ef, Some(frueher))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "vor dem Beginn: {v}");
    assert_eq!(w.detail(p).await["versorgung"], "unterwegs");

    let (s, v) = w.verbleib(p, uebergabe(ef, None)).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = w.verbleib(p, uebergabe(ef, None)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "schon übergeben: {v}");
}

#[tokio::test]
async fn vermisste_person_bleibt_offen_trotz_verbleib() {
    let w = Welt::neu().await;
    let p = w.person().await;
    let (s, v) = w.verbleib(p, json!({ "art": "entlassung" })).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(w.detail(p).await["versorgung"], "abgeschlossen");
    sqlx::query("UPDATE einsatz_person SET status = 'vermisst' WHERE id = ?")
        .bind(p)
        .execute(&w.pool)
        .await
        .unwrap();
    assert_eq!(w.detail(p).await["versorgung"], "offen");
}
