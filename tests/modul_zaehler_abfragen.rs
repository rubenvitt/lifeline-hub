//! Der Modulzähler lädt keine Listen (LFH-935): seine Abfragezahl hängt nicht vom Bestand ab.
//!
//! Gezählt werden die Statement-Ereignisse, die sqlx je ausgeführtem Statement auf DEBUG unter
//! dem Target `sqlx::query` schreibt. sqlite führt die Statements auf dem Thread seiner
//! Verbindung aus, deshalb ein **globaler** Subscriber — und deshalb diese eigene Testdatei mit
//! genau einem Test: ein paralleler Test im selben Binary zählte mit.
//!
//! Der Test-Pool hat genau eine Verbindung, ihre Statements laufen also nacheinander. Ein
//! Messpunkt-Statement nach `berechne` stellt sicher, dass jedes Statement davor protokolliert
//! ist; es selbst wird nicht gezählt.

use lifeline_hub::auth::Benutzer;
use lifeline_hub::einsatz::zaehler;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, setup_mit_pool};

static STATEMENTS: AtomicUsize = AtomicUsize::new(0);
const MESSPUNKT: &str = "SELECT 'messpunkt-lfh-935'";

/// Zählt die Statement-Ereignisse von sqlx, ohne den Messpunkt.
struct StatementZaehler;

#[derive(Default)]
struct Zusammenfassung(String);

impl Visit for Zusammenfassung {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "summary" {
            self.0 = value.to_owned();
        }
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "summary" {
            self.0 = format!("{value:?}");
        }
    }
}

impl<S: Subscriber> Layer<S> for StatementZaehler {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        if event.metadata().target() != "sqlx::query" {
            return;
        }
        let mut z = Zusammenfassung::default();
        event.record(&mut z);
        if !z.0.contains("messpunkt") {
            STATEMENTS.fetch_add(1, Ordering::SeqCst);
        }
    }
}

async fn statements_von_berechne(pool: &sqlx::SqlitePool, einsatz: i64, admin: &Benutzer) -> usize {
    let alle: HashSet<&'static str> = [
        "etb",
        "personen",
        "einheiten",
        "einsatzabschnitte",
        "meldungen",
        "auftraege",
        "erinnerungen",
        "chat",
        "dokumente",
    ]
    .into_iter()
    .collect();
    let vorher = STATEMENTS.load(Ordering::SeqCst);
    zaehler::berechne(pool, einsatz, admin, &alle, "2026-06-12 12:00:00")
        .await
        .expect("berechne");
    sqlx::query(MESSPUNKT).execute(pool).await.unwrap();
    STATEMENTS.load(Ordering::SeqCst) - vorher
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: &str) -> Value {
    let (status, v) = anfrage(app, "POST", pfad, cookie, Some(body)).await;
    assert!(status.is_success(), "POST {pfad}: {status} {v:?}");
    v
}

#[tokio::test]
async fn zaehlerabruf_kostet_bei_grossem_bestand_nicht_mehr_abfragen() {
    tracing::subscriber::set_global_default(tracing_subscriber::registry().with(StatementZaehler))
        .expect("einziger Subscriber dieses Binaries");

    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let admin: Benutzer = sqlx::query_as("SELECT * FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let basis = format!("/api/einsaetze/{einsatz}");

    let leer = statements_von_berechne(&pool, einsatz, &admin).await;
    assert!(leer <= 9, "leerer Einsatz: {leer} Statements");

    // Bestand: Aufträge mit je drei Empfängern (der frühere Listenpfad lud sie mit), Meldungen,
    // Erinnerungen und Chat-Nachrichten eines anderen Benutzers.
    let empfaenger = json!([
        { "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Nord" },
        { "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Süd" },
        { "empfaenger_typ": "funktion", "funktion_text": "Abschnitt West" }
    ]);
    for i in 0..200 {
        let body = json!({
            "auftrag_text": format!("Auftrag {i}"),
            "frist_at": "2026-06-01 10:00:00",
            "empfaenger": empfaenger,
        });
        post(
            &app,
            &cookie,
            &format!("{basis}/auftraege"),
            &body.to_string(),
        )
        .await;
    }
    for i in 0..300 {
        let body = json!({
            "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
            "inhalt": format!("Meldung {i}"), "ereigniszeit": "2026-06-12 09:00:00"
        });
        post(
            &app,
            &cookie,
            &format!("{basis}/meldungen"),
            &body.to_string(),
        )
        .await;
    }
    for i in 0..50 {
        let body = json!({ "titel": format!("Erinnerung {i}"), "faellig_at": "2026-06-11 10:00" });
        post(
            &app,
            &cookie,
            &format!("{basis}/erinnerungen"),
            &body.to_string(),
        )
        .await;
    }
    let (_, kanaele) = anfrage(&app, "GET", &format!("{basis}/chat/kanaele"), &cookie, None).await;
    let kid = kanaele[0]["id"].as_i64().unwrap();
    // Nachrichten eines anderen Autors, damit sie für den Admin ungelesen sind.
    let autor = benutzer_anlegen(&app, &cookie, "karla", "keine").await;
    for i in 0..100 {
        sqlx::query(
            "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt) VALUES (?, ?, ?, ?)",
        )
        .bind(einsatz)
        .bind(kid)
        .bind(autor)
        .bind(format!("Nachricht {i}"))
        .execute(&pool)
        .await
        .unwrap();
    }

    let gross = statements_von_berechne(&pool, einsatz, &admin).await;
    assert_eq!(
        gross, leer,
        "der Zählerabruf hängt vom Bestand ab: {leer} Statements leer, {gross} mit Bestand"
    );

    // Die Zahlen selbst stimmen (die Parität mit den Listen prüft `tests/modul_zaehler.rs`).
    let z = zaehler::berechne(
        &pool,
        einsatz,
        &admin,
        &["auftraege", "meldungen", "erinnerungen", "chat"]
            .into_iter()
            .collect(),
        "2026-06-12 12:00:00",
    )
    .await
    .unwrap();
    assert_eq!(z.auftraege.unwrap().ueberfaellig, 200);
    assert_eq!(z.meldungen.unwrap().offen, 300);
    // Aufträge mit Frist legen eigene Erinnerungen an; die Erwartung kommt deshalb aus der Liste.
    let erinnerungen =
        lifeline_hub::erinnerung::repo::liste(&pool, einsatz, true, "2026-06-12 12:00:00")
            .await
            .unwrap();
    let faellig = erinnerungen.iter().filter(|e| e.ist_faellig).count() as i64;
    assert!(faellig >= 50, "{faellig}");
    assert_eq!(z.erinnerungen.unwrap().faellig, faellig);
    assert_eq!(z.chat.unwrap().ungelesen, 100);
}
