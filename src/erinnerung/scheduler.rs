//! Zeitbasierter Scheduler für Erinnerungen: ein dünner Tokio-`interval`-Task
//! ruft periodisch `tick_einmal`. Die Fälligkeit ist aus `faellig_at` abgeleitet
//! (siehe repo) — ein verpasster Tick verzögert nur den Live-Nudge, nicht die
//! Korrektheit der offenen Liste.

use crate::erinnerung::faelligkeit::naechste_faelligkeit;
use crate::erinnerung::repo;
use crate::live::LiveEvent;
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
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|n| n.and_utc())
}

/// Ein Scheduler-Durchlauf für den Zeitpunkt `jetzt`. Publiziert je fälliger
/// Erinnerung ein SSE-Event `erinnerung` (Payload `{einsatz_id, erinnerung_id,
/// bezug_typ, bezug_id}`) und schreibt wiederkehrende per skip-forward fort.
/// Async + injiziertes `jetzt` = deterministisch testbar.
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
        // Eskalation einer bestätigungspflichtigen Sofortmeldung (LFH-97) ZUERST: die Auto-Frist-
        // Erinnerung trägt bezug_typ='meldung' + die Meldungs-ID. setze_eskaliert ist One-Shot
        // (eskaliert=0-Guard) und prüft unbestätigt+überfällig. Bewusst VOR markiere_ausgeloest:
        // schlägt der DB-Schreib fehl, wird NICHT markiert (continue) → der einmalige Reminder
        // bleibt fällig und wird nächsten Tick erneut versucht, statt die Eskalation + das
        // Re-Highlight dauerhaft zu verlieren. Reitet auf demselben Tick, kein neuer Timer.
        let mut eskaliert_mid: Option<i64> = None;
        if f.bezug_typ.as_deref() == Some(crate::kommunikation::OBJEKT_MELDUNG) {
            if let Some(mid) = f.bezug_id {
                match crate::meldung::repo::setze_eskaliert(pool, mid, &jetzt_s).await {
                    Ok(true) => eskaliert_mid = Some(mid),
                    Ok(false) => {}
                    Err(e) => {
                        tracing::warn!("Eskalation Meldung {mid} fehlgeschlagen: {e}");
                        continue;
                    }
                }
            }
        }
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
            LiveEvent::Erinnerung,
            serde_json::json!({
                "einsatz_id": f.einsatz_id,
                "erinnerung_id": f.id,
                "bezug_typ": f.bezug_typ,
                "bezug_id": f.bezug_id,
            })
            .to_string(),
        );
        // Re-Highlight nur bei frischer Eskalation (ein Event, kein Spam auf Folge-Ticks).
        if let Some(mid) = eskaliert_mid {
            live.publiziere_event(
                f.einsatz_id,
                LiveEvent::Sofortmeldung,
                serde_json::json!({ "einsatz_id": f.einsatz_id, "meldung_id": mid }).to_string(),
            );
        }
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
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
    }

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    #[tokio::test]
    async fn einmalige_loest_genau_einmal_aus() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        repo::anlegen(
            &pool,
            e,
            b,
            ErinnerungDaten {
                titel: "Einmal",
                beschreibung: None,
                faellig_at: "2026-06-11 10:00:00",
                intervall_minuten: None,
                empfaenger_funktion: None,
                bezug_typ: None,
                bezug_id: None,
            },
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

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
        let r = repo::anlegen(
            &pool,
            e,
            b,
            ErinnerungDaten {
                titel: "Lagemeldung",
                beschreibung: None,
                faellig_at: "2026-06-11 10:00:00",
                intervall_minuten: Some(30),
                empfaenger_funktion: None,
                bezug_typ: None,
                bezug_id: None,
            },
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

        // Server „2h weg": jetzt 12:10 → ein Nudge, nächster Slot 12:30 (kein Sturm).
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 12:10:00")).await, 1);
        let nachher = repo::laden(&pool, r.id, "2026-06-11 12:10:00")
            .await
            .unwrap();
        assert_eq!(nachher.faellig_at, "2026-06-11 12:30:00");
        // Sofortiger zweiter Tick: nichts (12:30 > 12:10).
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 12:11:00")).await, 0);
    }

    #[tokio::test]
    async fn erledigte_loesen_nicht_aus() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let r = repo::anlegen(
            &pool,
            e,
            b,
            ErinnerungDaten {
                titel: "X",
                beschreibung: None,
                faellig_at: "2026-06-11 10:00:00",
                intervall_minuten: None,
                empfaenger_funktion: None,
                bezug_typ: None,
                bezug_id: None,
            },
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();
        repo::status_setzen(
            &pool,
            r.id,
            crate::erinnerung::STATUS_ERLEDIGT,
            "2026-06-11 09:30:00",
        )
        .await
        .unwrap();

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
        let r = repo::anlegen(
            &pool,
            e,
            b,
            ErinnerungDaten {
                titel: "Lagemeldung",
                beschreibung: None,
                faellig_at: "2026-06-11 10:00:00",
                intervall_minuten: None,
                empfaenger_funktion: None,
                bezug_typ: None,
                bezug_id: None,
            },
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        let nachricht = rx.recv().await.unwrap();
        assert_eq!(nachricht.event.as_str(), "erinnerung");
        let v: serde_json::Value = serde_json::from_str(&nachricht.data).unwrap();
        assert_eq!(v["einsatz_id"], e);
        assert_eq!(v["erinnerung_id"], r.id);
        assert_eq!(v["bezug_typ"], serde_json::Value::Null);
        assert_eq!(v["bezug_id"], serde_json::Value::Null);
    }

    /// LFH-97: die Auto-Frist-Erinnerung einer bestätigungspflichtigen Sofortmeldung
    /// (bezug_typ='meldung') eskaliert die Meldung beim Frist-Tick und re-highlightet via
    /// SSE-Tag 'sofortmeldung' — auf demselben Tick, ohne Fremdtabellen-Polling.
    #[tokio::test]
    async fn meldung_frist_eskaliert_und_publiziert_sofortmeldung() {
        use crate::kommunikation::OBJEKT_MELDUNG;
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let mut rx = live.abonniere(e);

        // Bestätigungspflichtige Sofortmeldung + Auto-Frist-Erinnerung mit Bezug.
        let m = crate::meldung::repo::anlegen(
            &pool,
            e,
            b,
            crate::meldung::repo::MeldungDaten {
                absender: "Florian Nord 1",
                empfaenger: None,
                meldeweg: "funk",
                inhalt: "MANV",
                meldungsart: crate::meldung::ART_SOFORTMELDUNG,
                prioritaet: crate::meldung::PRIO_SOFORT,
                richtung: "intern",
                ereigniszeit: "2026-06-11 09:55:00",
                eingang_at: "2026-06-11 09:55:00",
                bestaetigung_pflicht: true,
                bestaetigung_frist_at: Some("2026-06-11 10:00:00"),
            },
        )
        .await
        .unwrap();
        repo::anlegen_aus_frist(
            &pool,
            e,
            b,
            OBJEKT_MELDUNG,
            m.id,
            "Nachfass",
            "2026-06-11 10:00:00",
            "2026-06-11 09:55:00",
        )
        .await
        .unwrap();

        // Tick nach Frist: ein Auslösen, Meldung eskaliert, und ein 'sofortmeldung'-Event folgt.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        assert!(
            crate::meldung::repo::laden(&pool, m.id, "2026-06-11 10:01:00")
                .await
                .unwrap()
                .eskaliert
        );
        let mut tags = vec![
            rx.recv().await.unwrap().event.as_str(),
            rx.recv().await.unwrap().event.as_str(),
        ];
        tags.sort();
        assert_eq!(tags, vec!["erinnerung", "sofortmeldung"]);
    }

    /// One-Shot über den Scheduler: ein zweiter Tick nach der Eskalation publiziert KEIN
    /// weiteres 'sofortmeldung'-Event (kein Alarm-Spam), während die Liste über das computed
    /// ist_ueberfaellig weiter hervorhebt.
    #[tokio::test]
    async fn meldung_eskalation_kein_respam_auf_folge_tick() {
        use crate::kommunikation::OBJEKT_MELDUNG;
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let mut rx = live.abonniere(e);
        let m = crate::meldung::repo::anlegen(
            &pool,
            e,
            b,
            crate::meldung::repo::MeldungDaten {
                absender: "Florian Nord 1",
                empfaenger: None,
                meldeweg: "funk",
                inhalt: "MANV",
                meldungsart: crate::meldung::ART_SOFORTMELDUNG,
                prioritaet: crate::meldung::PRIO_SOFORT,
                richtung: "intern",
                ereigniszeit: "2026-06-11 09:55:00",
                eingang_at: "2026-06-11 09:55:00",
                bestaetigung_pflicht: true,
                bestaetigung_frist_at: Some("2026-06-11 10:00:00"),
            },
        )
        .await
        .unwrap();
        repo::anlegen_aus_frist(
            &pool,
            e,
            b,
            OBJEKT_MELDUNG,
            m.id,
            "Nachfass",
            "2026-06-11 10:00:00",
            "2026-06-11 09:55:00",
        )
        .await
        .unwrap();

        // Erster Tick: ein Auslösen, zwei Events (erinnerung + sofortmeldung) — drainen.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        rx.recv().await.unwrap();
        rx.recv().await.unwrap();
        // Zweiter Tick: Reminder ist one-shot ausgelöst → kein Nudge, kein erneuter Alarm.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:02:00")).await, 0);
        assert!(
            rx.try_recv().is_err(),
            "kein weiteres Event auf dem Folge-Tick"
        );
    }

    /// Bereits bestätigt → Tick eskaliert NICHT (Erinnerung wurde geschlossen, Meldung quittiert).
    #[tokio::test]
    async fn bestaetigte_meldung_eskaliert_nicht() {
        use crate::kommunikation::OBJEKT_MELDUNG;
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let m = crate::meldung::repo::anlegen(
            &pool,
            e,
            b,
            crate::meldung::repo::MeldungDaten {
                absender: "Florian Nord 1",
                empfaenger: None,
                meldeweg: "funk",
                inhalt: "MANV",
                meldungsart: crate::meldung::ART_SOFORTMELDUNG,
                prioritaet: crate::meldung::PRIO_SOFORT,
                richtung: "intern",
                ereigniszeit: "2026-06-11 09:55:00",
                eingang_at: "2026-06-11 09:55:00",
                bestaetigung_pflicht: true,
                bestaetigung_frist_at: Some("2026-06-11 10:00:00"),
            },
        )
        .await
        .unwrap();
        repo::anlegen_aus_frist(
            &pool,
            e,
            b,
            OBJEKT_MELDUNG,
            m.id,
            "Nachfass",
            "2026-06-11 10:00:00",
            "2026-06-11 09:55:00",
        )
        .await
        .unwrap();
        // Bestätigen schließt die Erinnerung + quittiert die Meldung.
        crate::meldung::repo::bestaetige(&pool, 1, e, m.id, b, "2026-06-11 09:58:00")
            .await
            .unwrap();

        // Kein fälliger Nudge mehr (Erinnerung erledigt), keine Eskalation.
        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 0);
        assert!(
            !crate::meldung::repo::laden(&pool, m.id, "2026-06-11 10:01:00")
                .await
                .unwrap()
                .eskaliert
        );
    }

    /// LFH-118: eine Auto-Frist-Erinnerung mit bezug_typ='auftrag' publiziert `erinnerung` mit
    /// Diskriminator + IDs im Payload — und KEIN zweites (sofortmeldung-)Event (Nicht-Meldung).
    #[tokio::test]
    async fn auftrag_frist_erinnerung_traegt_bezug_typ_und_id_im_payload() {
        use crate::kommunikation::OBJEKT_AUFTRAG;
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let live = LiveHub::new();
        let mut rx = live.abonniere(e);
        // bezug_id ist ein generischer Sachbezug ohne FK (migration 0044) → beliebige ID genügt;
        // der Scheduler dereferenziert sie nur für bezug_typ='meldung'.
        let r = repo::anlegen_aus_frist(
            &pool,
            e,
            b,
            OBJEKT_AUFTRAG,
            42,
            "Auftrag #1 Quittierfrist",
            "2026-06-11 10:00:00",
            "2026-06-11 09:00:00",
        )
        .await
        .unwrap();

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-11 10:01:00")).await, 1);
        let n = rx.recv().await.unwrap();
        assert_eq!(n.event.as_str(), "erinnerung");
        let v: serde_json::Value = serde_json::from_str(&n.data).unwrap();
        assert_eq!(v["erinnerung_id"], r.id);
        assert_eq!(v["bezug_typ"], "auftrag");
        assert_eq!(v["bezug_id"], 42);
        assert!(
            rx.try_recv().is_err(),
            "kein sofortmeldung-Event für Nicht-Meldungs-Bezug"
        );
    }
}
