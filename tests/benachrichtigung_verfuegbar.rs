//! Benachrichtigung „Wieder verfügbar“ (Change `kcjecn9e-benachrichtigungskonzept`, design.md
//! D11, Spec `benachrichtigungen`, Anforderung „Einheit oder Fahrzeug wieder verfügbar“):
//! wechselt die Statuskategorie eines Fahrzeugs oder des Handstatus einer Einheit von gebunden
//! oder nicht verfügbar auf verfügbar, bekommen EL und S3 einen Hinweis. Jeder andere Wechsel,
//! ein abgeleiteter Einheitenstatus und die eigene Aktion bleiben still.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einheit_bilden, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    einsatz: i64,
    /// Mitglied mit Funktion EL.
    el: i64,
    /// Mitglied mit Funktion S3.
    s3: i64,
    /// Mitglied mit Funktion S4: bekommt nie etwas.
    s4: i64,
}

async fn welt() -> Welt {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut ids = Vec::new();
    for (name, funktion) in [("elena", "el"), ("simon", "s3"), ("veronika", "s4")] {
        let id = benutzer_anlegen(&app, &admin, name, "keine").await;
        rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
        let (s, v) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/mitglieder/{id}"),
            &admin,
            Some(
                &json!({ "einsatz_rolle": "fuehrungspersonal", "fuehrungsfunktion": funktion })
                    .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        ids.push(id);
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
        einsatz,
        el: ids[0],
        s3: ids[1],
        s4: ids[2],
    }
}

impl Welt {
    async fn status(&self, label: &str) -> i64 {
        let (_, stati) = anfrage(&self.app, "GET", "/api/fahrzeug-status", &self.admin, None).await;
        stati
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["label"] == label)
            .unwrap_or_else(|| panic!("Status {label} fehlt"))["id"]
            .as_i64()
            .unwrap()
    }

    /// Disponiert ein Ad-hoc-Fahrzeug; es startet im ersten gebundenen Status (3).
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
        assert_eq!(v["status_kategorie"], "gebunden");
        v["id"].as_i64().unwrap()
    }

    async fn fahrzeug_status(&self, cookie: &str, ef: i64, label: &str) {
        let sid = self.status(label).await;
        let (s, v) = anfrage(
            &self.app,
            "PATCH",
            &format!("/api/einsaetze/{}/fahrzeuge/{ef}", self.einsatz),
            cookie,
            Some(&json!({ "status_id": sid }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    async fn hand_status(&self, einheit: i64, label: Option<&str>) {
        let sid = match label {
            Some(l) => json!(self.status(l).await),
            None => Value::Null,
        };
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/einheiten/{einheit}/status", self.einsatz),
            &self.admin,
            Some(&json!({ "status_id": sid }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Die Benachrichtigungen als `(benutzer_id, art, bezug_typ, bezug_id)`, aufsteigend.
    async fn zeilen(&self) -> Vec<(i64, String, String, i64)> {
        sqlx::query_as(
            "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung \
             ORDER BY benutzer_id, id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    fn erwartet(&self, ids: &[i64], typ: &str, bezug: i64) -> Vec<(i64, String, String, i64)> {
        ids.iter()
            .map(|id| (*id, "wieder_verfuegbar".into(), typ.into(), bezug))
            .collect()
    }

    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }
}

// ───────────────────────────── Fahrzeug ─────────────────────────────

/// Spec-Szenario „Fahrzeug einsatzbereit“: Status 3 (gebunden) → 2 (verfügbar) erreicht EL und
/// S3 mit dem Fahrzeug, S4 nicht.
#[tokio::test]
async fn fahrzeug_einsatzbereit_erreicht_el_und_s3() {
    let w = welt().await;
    let ef = w.fahrzeug("Florian 1").await;
    w.fahrzeug_status(&w.admin, ef, "2 – Frei auf Wache").await;

    assert_eq!(w.zeilen().await, w.erwartet(&[w.el, w.s3], "fahrzeug", ef));

    // Der Empfänger liest „Wieder verfügbar“ mit dem Funkrufnamen und springt zum Fahrzeug.
    let id: i64 = sqlx::query_scalar("SELECT id FROM benachrichtigung WHERE benutzer_id = ?")
        .bind(w.s3)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/benachrichtigungen/{id}"),
        &w.cookie("simon").await,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Wieder verfügbar");
    assert_eq!(v["detail"], "Florian 1");
    assert_eq!(
        v["pfad"],
        format!("/einsaetze/{}/fahrzeuge?fahrzeug={ef}", w.einsatz)
    );
    assert_eq!(v["stufe"], "hinweis");
}

/// Spec-Szenario „Wechsel innerhalb gebunden“: 3 → 4 benachrichtigt niemanden.
#[tokio::test]
async fn wechsel_innerhalb_gebunden_bleibt_still() {
    let w = welt().await;
    let ef = w.fahrzeug("Florian 1").await;
    w.fahrzeug_status(&w.admin, ef, "4 – Am Einsatzort").await;
    assert!(w.zeilen().await.is_empty());
}

/// Auch aus „nicht verfügbar“ (6) zurück auf verfügbar meldet.
#[tokio::test]
async fn aus_nicht_verfuegbar_zurueck_meldet() {
    let w = welt().await;
    let ef = w.fahrzeug("Florian 1").await;
    w.fahrzeug_status(&w.admin, ef, "6 – Nicht einsatzbereit")
        .await;
    assert!(w.zeilen().await.is_empty(), "6 ist nicht verfügbar");
    w.fahrzeug_status(&w.admin, ef, "1 – Frei auf Funk").await;
    assert_eq!(w.zeilen().await, w.erwartet(&[w.el, w.s3], "fahrzeug", ef));
}

/// Ein Wechsel, der schon verfügbar war (2 → 1), derselbe Status erneut und der Weg aus
/// verfügbar hinaus bleiben still: genau eine Benachrichtigung je Empfänger.
#[tokio::test]
async fn schon_verfuegbar_wiederholung_und_weg_hinaus_bleiben_still() {
    let w = welt().await;
    let ef = w.fahrzeug("Florian 1").await;
    w.fahrzeug_status(&w.admin, ef, "2 – Frei auf Wache").await;
    w.fahrzeug_status(&w.admin, ef, "2 – Frei auf Wache").await;
    w.fahrzeug_status(&w.admin, ef, "1 – Frei auf Funk").await;
    w.fahrzeug_status(&w.admin, ef, "3 – Auf Anfahrt").await;
    assert_eq!(w.zeilen().await, w.erwartet(&[w.el, w.s3], "fahrzeug", ef));
}

/// Eigene Aktionen bleiben still: setzt die EL das Fahrzeug selbst frei, bekommt nur S3 etwas.
#[tokio::test]
async fn eigene_statusmeldung_erreicht_den_ausloeser_nicht() {
    let w = welt().await;
    let ef = w.fahrzeug("Florian 1").await;
    let el = w.cookie("elena").await;
    w.fahrzeug_status(&el, ef, "2 – Frei auf Wache").await;
    assert_eq!(w.zeilen().await, w.erwartet(&[w.s3], "fahrzeug", ef));
}

/// Ein reiner Bemerkungs-Patch an einem gebundenen Fahrzeug ändert keinen Status und meldet
/// nichts.
#[tokio::test]
async fn patch_ohne_status_bleibt_still() {
    let w = welt().await;
    let ef = w.fahrzeug("Florian 1").await;
    let (s, v) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/fahrzeuge/{ef}", w.einsatz),
        &w.admin,
        Some(r#"{"bemerkung":"Tank halb voll"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(w.zeilen().await.is_empty());
}

// ───────────────────────────── Einheit ─────────────────────────────

/// Eine Einheit mit Handstatus meldet den Wechsel von gebunden auf verfügbar mit sich selbst
/// als Bezug.
#[tokio::test]
async fn einheit_mit_handstatus_meldet_wieder_verfuegbar() {
    let w = welt().await;
    let e = einheit_bilden(&w.app, &w.admin, w.einsatz, "Fachberater EVU").await;
    w.hand_status(e, Some("4 – Am Einsatzort")).await;
    assert!(w.zeilen().await.is_empty(), "gebunden meldet nichts");
    w.hand_status(e, Some("2 – Frei auf Wache")).await;
    assert_eq!(w.zeilen().await, w.erwartet(&[w.el, w.s3], "einheit", e));
}

/// Ohne vorherigen Status ist eine Einheit nicht „wieder“ verfügbar (design.md D11: nur aus
/// gebunden oder nicht verfügbar); Löschen des Handstatus meldet ebenfalls nichts.
#[tokio::test]
async fn einheit_ohne_vorstatus_und_loeschen_bleiben_still() {
    let w = welt().await;
    let e = einheit_bilden(&w.app, &w.admin, w.einsatz, "Fachberater EVU").await;
    w.hand_status(e, Some("2 – Frei auf Wache")).await;
    w.hand_status(e, None).await;
    assert!(w.zeilen().await.is_empty());
}

/// Eine Einheit mit Fahrzeugen leitet ihren Status ab: wird ihr Fahrzeug frei, meldet nur das
/// Fahrzeug, die Einheit nicht noch einmal.
#[tokio::test]
async fn abgeleiteter_einheitenstatus_meldet_nicht_noch_einmal() {
    let w = welt().await;
    let e = einheit_bilden(&w.app, &w.admin, w.einsatz, "1. Zug").await;
    let ef = w.fahrzeug("Florian 1").await;
    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!("/api/einsaetze/{}/einheiten/{e}/fahrzeug/{ef}", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    w.fahrzeug_status(&w.admin, ef, "2 – Frei auf Wache").await;
    assert_eq!(w.zeilen().await, w.erwartet(&[w.el, w.s3], "fahrzeug", ef));
}

/// Gegenseite S4 und Unbeteiligte: nur EL und S3 sind Adressaten, auch wenn S4 Fahrzeuge lesen
/// darf.
#[tokio::test]
async fn s4_bekommt_nichts() {
    let w = welt().await;
    let ef = w.fahrzeug("Florian 1").await;
    w.fahrzeug_status(&w.admin, ef, "2 – Frei auf Wache").await;
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/fahrzeuge", w.einsatz),
        &w.cookie("veronika").await,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "S4 liest Fahrzeuge: {v}");
    assert!(w.zeilen().await.iter().all(|z| z.0 != w.s4));
}
