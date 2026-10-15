//! Benachrichtigung „Neue Gefahr“ (LLH-1217, Change `kcjecn9e-benachrichtigungskonzept`, Spec
//! `benachrichtigungen`, „Neue Gefahr“ und „Eigene Aktionen benachrichtigen den Auslöser nicht“):
//! ein auf der Lagekarte neu gezeichnetes Gefahrengebiet meldet `gefahr` an die Leser der
//! Lagekarte; Änderungen an bestehenden Gefahren (Zone, Bezeichnung, Bewertung) bleiben still.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool,
};

const FLAECHE: &str =
    r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// Mitglied (Führungspersonal) „annika“, zeichnet die Gefahr.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“.
    bert: i64,
    /// Mitglied (Beobachter) „carla“.
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
    Welt {
        app,
        pool,
        admin,
        admin_id,
        einsatz,
        anna,
        bert,
        carla,
        dorian,
    }
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Zeichnet als `cookie` eine Zone vom Typ `typ`; liefert die Antwort.
    async fn zone(&self, cookie: &str, typ: &str, label: &str) -> Value {
        let body = json!({
            "typ": typ,
            "geometrie_typ": "Polygon",
            "geometrie": FLAECHE,
            "label": label,
        });
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/zonen", self.einsatz),
            cookie,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v
    }

    async fn schreiben(&self, cookie: &str, methode: &str, pfad: &str, body: Value) {
        let (s, v) = anfrage(
            &self.app,
            methode,
            &format!("/api/einsaetze/{}{pfad}", self.einsatz),
            cookie,
            Some(&body.to_string()),
        )
        .await;
        assert!(s.is_success(), "{methode} {pfad}: {s} {v}");
    }

    /// Nur die Führung im Einsatz liest die Lagekarte; Beobachter nicht.
    async fn lagekarte_nur_fuer_fuehrung(&self) {
        self.schreiben(
            &self.admin,
            "PUT",
            "/modul-overrides/lagekarte",
            json!({ "sichtbar": true, "benoetigte_rolle": "einsatzfuehrung" }),
        )
        .await;
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung ORDER BY benutzer_id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

/// Spec-Szenario „Gefahr eingetragen“: Annika zeichnet das Gefahrengebiet „Gasaustritt“. Alle,
/// die die Lagekarte lesen, bekommen den Hinweis mit Sprung zum Gebiet auf der Lagekarte; nicht
/// Annika selbst, nicht die Beobachterin ohne Recht an der Lagekarte, nicht wer nicht Mitglied
/// ist.
#[tokio::test]
async fn gefahr_eingetragen_erreicht_die_leser_der_lagekarte() {
    let w = welt().await;
    w.lagekarte_nur_fuer_fuehrung().await;
    let anna = w.cookie("annika").await;

    let zone = w.zone(&anna, "gefahrengebiet", "Gasaustritt").await;
    let gebiet = zone["gefahrengebiet_id"].as_i64().unwrap();

    let gefahr = |b| {
        (
            b,
            "gefahr".to_string(),
            "gefahrengebiet".to_string(),
            gebiet,
        )
    };
    assert_eq!(w.zeilen().await, vec![gefahr(w.admin_id), gefahr(w.bert)]);
    let empfaenger: Vec<i64> = w.zeilen().await.iter().map(|z| z.0).collect();
    for nicht in [w.anna, w.carla, w.dorian] {
        assert!(!empfaenger.contains(&nicht), "{nicht} darf nichts bekommen");
    }

    // Bert liest den Text: Titel der Spec, Sprung zum Gebiet auf der Lagekarte.
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
    assert_eq!(liste[0]["titel"], "Neue Gefahr");
    assert_eq!(liste[0]["stufe"], "hinweis");
    assert_eq!(
        liste[0]["pfad"],
        format!("/einsaetze/{}/lagekarte?gefahrengebiet={gebiet}", w.einsatz)
    );
    // Die Bezeichnung des Gebiets ist ein Scrub-Wert und steht nicht im Text.
    assert!(!offen.to_string().contains("Gasaustritt"), "{offen}");
}

/// Änderungen an einer bestehenden Gefahr bleiben still: Zone umbenennen, Gebiet umbenennen,
/// Matrix bewerten. Auch eine neue Zone, die keine Gefahr ist, meldet nichts.
#[tokio::test]
async fn aenderung_einer_bestehenden_gefahr_bleibt_still() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let zone = w.zone(&anna, "gefahrengebiet", "Gasaustritt").await;
    let zone_id = zone["id"].as_i64().unwrap();
    let gebiet = zone["gefahrengebiet_id"].as_i64().unwrap();
    let vorher = w.zeilen().await;
    assert!(!vorher.is_empty(), "die Neuanlage meldet");

    w.schreiben(
        &anna,
        "PATCH",
        &format!("/zonen/{zone_id}"),
        json!({ "label": "Gasaustritt Nord", "notiz": "Wind aus West" }),
    )
    .await;
    w.schreiben(
        &anna,
        "PATCH",
        &format!("/gefahrengebiete/{gebiet}"),
        json!({ "label": "Gasaustritt Nordstadt" }),
    )
    .await;
    w.schreiben(
        &anna,
        "PUT",
        &format!("/gefahrengebiete/{gebiet}/matrix/bewertung"),
        json!({ "gefahrentyp": "atemgifte", "schutzobjekt": "menschen", "warnstufe": "hoch" }),
    )
    .await;
    w.zone(&anna, "absperrbereich", "Absperrung Süd").await;

    assert_eq!(w.zeilen().await, vorher, "keine weitere Benachrichtigung");
}
