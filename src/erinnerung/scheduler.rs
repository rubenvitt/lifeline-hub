//! Zeitbasierter Scheduler für Erinnerungen: ein dünner Tokio-`interval`-Task
//! ruft periodisch `tick_einmal`. Die Fälligkeit ist aus `faellig_at` abgeleitet
//! (siehe repo) — ein verpasster Tick verzögert nur den Live-Nudge, nicht die
//! Korrektheit der offenen Liste.

use crate::erinnerung::faelligkeit::naechste_faelligkeit;
use crate::erinnerung::repo;
use crate::live::LiveHub;
use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::SqlitePool;
use std::time::Duration;

/// Pollintervall des Schedulers.
const TICK_SEKUNDEN: u64 = 30;

/// Formatiert einen UTC-Zeitpunkt im kanonischen DB-Format.
fn fmt(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Parst einen DB-Zeitstempel; bei Unparsbarkeit `None` (defensiv).
fn parse(s: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok().map(|n| n.and_utc())
}

/// Ein Scheduler-Durchlauf für den Zeitpunkt `jetzt`. Publiziert je fälliger
/// Erinnerung ein SSE-Event `erinnerung` (Payload nur `{einsatz_id}`) und
/// schreibt wiederkehrende per skip-forward fort. Async + injiziertes `jetzt`
/// = deterministisch testbar.
pub async fn tick_einmal(pool: &SqlitePool, live: &LiveHub, jetzt: DateTime<Utc>) -> usize {
    let jetzt_s = fmt(jetzt);
    let faellige = match repo::faellige_zum_ausloesen(pool, &jetzt_s).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Scheduler-Abfrage fehlgeschlagen: {e}");
            return 0;
        }
    };

    let mut ausgeloest = 0;
    for f in &faellige {
        let neu = match (f.intervall_minuten, parse(&f.faellig_at)) {
            (Some(iv), Some(fa)) if iv > 0 => Some(fmt(naechste_faelligkeit(fa, iv, jetzt))),
            _ => None, // einmalig oder unparsbar → nur als ausgelöst markieren
        };
        if let Err(e) = repo::markiere_ausgeloest(pool, f.id, neu.as_deref(), &jetzt_s).await {
            tracing::warn!("Scheduler-Update {id} fehlgeschlagen: {e}", id = f.id);
            continue;
        }
        live.publiziere_event(
            f.einsatz_id,
            "erinnerung",
            serde_json::json!({ "einsatz_id": f.einsatz_id }).to_string(),
        );
        ausgeloest += 1;
    }
    ausgeloest
}

/// Startet den Hintergrund-Scheduler (nur im Produktivlauf aus `main.rs`).
/// Dünner Wrapper um `tick_einmal`; die Logik selbst ist oben testbar.
pub fn starte_scheduler(pool: SqlitePool, live: LiveHub) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(TICK_SEKUNDEN));
        loop {
            ticker.tick().await;
            tick_einmal(&pool, &live, Utc::now()).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::erinnerung::repo::ErinnerungDaten;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap().and_utc()
    }

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (b, e)
    }

    #[tokio::test]
    async fn einmalige_loest_genau_einmal_aus() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "Einmal", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: None, empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();

        // Vor Fälligkeit: nichts.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 09:30:00")).await, 0);
        // Nach Fälligkeit: genau einmal.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        // Erneuter Tick: kein Doppel-Nudge.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:02:00")).await, 0);
    }

    #[tokio::test]
    async fn wiederkehrende_schiebt_faellig_at_per_skip_forward() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let r = repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "Lagemeldung", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: Some(30), empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();

        // Server „2h weg": jetzt 12:10 → ein Nudge, nächster Slot 12:30 (kein Sturm).
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 12:10:00")).await, 1);
        let nachher = repo::laden(&pool, r.id, "2026-06-11 12:10:00").await.unwrap();
        assert_eq!(nachher.faellig_at, "2026-06-11 12:30:00");
        // Sofortiger zweiter Tick: nichts (12:30 > 12:10).
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 12:11:00")).await, 0);
    }

    #[tokio::test]
    async fn erledigte_loesen_nicht_aus() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let r = repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "X", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: None, empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();
        repo::status_setzen(&pool, r.id, crate::erinnerung::STATUS_ERLEDIGT, "2026-06-11 09:30:00").await.unwrap();

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 0);
    }

    #[tokio::test]
    async fn faellige_publiziert_sse_event_erinnerung() {
        // Deckt das AK „Live-Auslösung über SSE" direkt ab: ein Abonnent des
        // Einsatz-LiveHub erhält beim Tick ein Event mit Tag `erinnerung`.
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let mut rx = live.abonniere(e);
        repo::anlegen(&pool, e, b, ErinnerungDaten {
            titel: "Lagemeldung", beschreibung: None, faellig_at: "2026-06-11 10:00:00",
            intervall_minuten: None, empfaenger_funktion: None,
        }, "2026-06-11 09:00:00").await.unwrap();

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        let nachricht = rx.recv().await.unwrap();
        assert_eq!(nachricht.event, "erinnerung");
    }
}
