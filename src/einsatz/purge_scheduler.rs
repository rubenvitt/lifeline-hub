//! Aufbewahrungs-Purge-Scheduler (LFH-135) — gespiegeltes Muster von
//! `erinnerung::scheduler`: ein dünner Tokio-`interval`-Task ruft periodisch
//! `tick_einmal`; die Logik selbst ist mit injiziertem `jetzt` deterministisch
//! testbar. Idempotent über WHERE-Guards in den Repo-Queries.
//!
//! Zwei Phasen:
//! - **Phase A** (reversibel): Einsätze mit abgelaufener Aufbewahrungsfrist werden
//!   soft-gelöscht (`geloescht_at` gesetzt = Karenz-Start). Ab da am Datenzugriff
//!   gesperrt (`darf_lesen`).
//! - **Phase B** (IRREVERSIBEL): nach Ablauf der Karenz (`KARENZ_TAGE`) werden die
//!   Personendaten gescrubbt (`repo::schwaerze_einsatz`), das operative Skelett
//!   (Einsatz, ETB, Zähler) bleibt erhalten. `geschwaerzt_at`-Tombstone = Idempotenz.
//!
//! DATENVERLUST-kritisch: jede Mutation wird zuvor mit `tracing` protokolliert und
//! mit einem ETB-System-Audit begleitet; aktive Einsätze sind durch
//! `status='abgeschlossen'` in jeder Purge-Query hart ausgeschlossen.

use super::repo;
use super::retention::{karenz_abgelaufen, KARENZ_TAGE};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::time::Duration;

/// Pollintervall des Purge-Schedulers (10 Minuten — Aufbewahrung ist tagesgenau,
/// kein Sekunden-Druck wie bei Erinnerungen).
const TICK_SEKUNDEN: u64 = 600;

/// Formatiert einen UTC-Zeitpunkt im kanonischen DB-Format.
fn fmt(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Ein Purge-Durchlauf für den Zeitpunkt `jetzt`. Führt Phase A (Soft-Delete) und
/// Phase B (PII-Schwärzung) aus und liefert die Gesamtzahl der mutierten Einsätze.
/// Async + injiziertes `jetzt` = deterministisch testbar. Idempotent: ein zweiter
/// Tick ohne neue Fälligkeiten liefert 0.
pub async fn tick_einmal(pool: &SqlitePool, jetzt: DateTime<Utc>) -> usize {
    let jetzt_s = fmt(jetzt);
    let mut anzahl = 0;

    // --- Phase A: Soft-Delete fälliger Einsätze (reversibel, Karenz-Start) ---
    match repo::faellige_soft_delete(pool, &jetzt_s).await {
        Ok(ids) => {
            for id in ids {
                tracing::info!(
                    einsatz_id = id,
                    "Purge Phase A: Soft-Delete (Aufbewahrungsfrist abgelaufen)"
                );
                match repo::soft_delete_einsatz(pool, id, &jetzt_s).await {
                    Ok(true) => anzahl += 1,
                    Ok(false) => {} // Race: bereits soft-gelöscht.
                    Err(e) => tracing::warn!(einsatz_id = id, "Purge Phase A fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase A: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase B: PII-Schwärzung nach Ablauf der Karenz (IRREVERSIBEL) ---
    match repo::faellige_purge(pool, KARENZ_TAGE).await {
        Ok(kandidaten) => {
            for (id, geloescht_at) in kandidaten {
                // Karenz-Grenze in Rust prüfen (injiziertes jetzt; defensiv gegen
                // unparsebare Tombstones → kein Scrub).
                if !karenz_abgelaufen(Some(&geloescht_at), jetzt) {
                    continue;
                }
                tracing::warn!(
                    einsatz_id = id,
                    "Purge Phase B: PII-SCHWÄRZUNG (irreversibel) — Karenz abgelaufen"
                );
                match repo::schwaerze_einsatz(pool, id, &jetzt_s).await {
                    Ok(true) => anzahl += 1,
                    Ok(false) => {} // Bereits geschwärzt (Idempotenz).
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase B fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase B: Abfrage fehlgeschlagen: {e}"),
    }

    anzahl
}

/// Startet den Hintergrund-Purge-Scheduler (nur im Produktivlauf aus `main.rs`).
/// Dünner Wrapper um `tick_einmal`; die Logik selbst ist oben testbar.
pub fn starte_purge_scheduler(pool: SqlitePool) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(TICK_SEKUNDEN));
        loop {
            ticker.tick().await;
            tick_einmal(&pool, Utc::now()).await;
            // Verwaiste Anhänge (hochgeladen-nicht-gesendet) jenseits der Karenz entfernen
            // (LFH-250) — gegen monotones BLOB-Wachstum. Fehler nur loggen, nie den Tick killen.
            match crate::anhang::repo::sweep_verwaiste(&pool, Utc::now()).await {
                Ok(n) if n > 0 => {
                    tracing::info!(anzahl = n, "Orphan-Sweep: verwaiste Anhänge gelöscht")
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("Orphan-Sweep fehlgeschlagen: {e}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDateTime;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
    }

    /// Org + Benutzer + ABGESCHLOSSENER Einsatz mit gesetzter, abgelaufener Frist.
    /// Liefert die einsatz_id. `retention_bis` liegt in der Vergangenheit.
    async fn abgeschlossen_mit_frist(pool: &SqlitePool, retention_bis: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'L','l','h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, retention_bis) \
             VALUES (1,'Lage','abgeschlossen','2026-01-01 00:00:00', ?, ?) RETURNING id",
        )
        .bind(b)
        .bind(retention_bis)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn phase_a_soft_loescht_nur_abgelaufene_und_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;

        // Vor Fälligkeit: nichts.
        assert_eq!(tick_einmal(&pool, t("2026-05-01 12:00:00")).await, 0);
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g, None, "vor Ablauf nicht soft-gelöscht");

        // Nach Fälligkeit: genau ein Soft-Delete, Tombstone gesetzt.
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 1);
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g.as_deref(), Some("2026-06-02 12:00:00"));

        // Zweiter Tick: idempotent, kein erneutes Soft-Delete (noch in Karenz, nicht purge-fällig).
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:05:00")).await, 0);
    }

    #[tokio::test]
    async fn aktiver_einsatz_wird_nie_soft_geloescht() {
        // Sicherheits-Test: ein AKTIVER Einsatz mit (defensiv) abgelaufener Frist darf
        // weder soft-gelöscht noch geschwärzt werden — status='abgeschlossen' ist hart.
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, retention_bis) \
             VALUES (1,'Aktiv','aktiv','2026-01-01 00:00:00') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(tick_einmal(&pool, t("2027-01-01 12:00:00")).await, 0);
        let (g, s): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(g, None, "aktiver Einsatz nie soft-gelöscht");
        assert_eq!(s, None, "aktiver Einsatz nie geschwärzt");
    }

    /// Vollständiger Phase-B-Durchlauf inkl. aller CHECK/NOT-NULL-Fallen und einer
    /// STORNIERTEN Person (die ebenfalls reale PII trägt und gescrubbt werden muss).
    #[tokio::test]
    async fn phase_b_schwaerzt_alle_pii_inkl_stornierte_und_haelt_skelett() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Leit','leit','h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        // Abgeschlossen + Frist abgelaufen + bereits soft-gelöscht (Karenz-Start lange her).
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, retention_bis, geloescht_at) \
             VALUES (1,'Lage','abgeschlossen','2026-01-01 00:00:00', ?, '2026-02-01 00:00:00','2026-02-15 00:00:00') RETURNING id",
        )
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();

        // PII-Bestand: normale + STORNIERTE Person, Verlaufsnotiz, Tier, Schaden
        // (status='uebergeben' → uebergeben_an NOT NULL via CHECK!), Ad-hoc-Personal.
        let p1: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, geburtsdatum, herkunft_adresse, melder_kontakt, notiz, aktueller_verbleib, erfasst_von, geaendert_von) \
             VALUES (?,1,'betroffen','Mustermann','Max','1980-01-01','Hauptstr 1','Angeh. 0170','frei','Transport → KH Mitte', ?, ?) RETURNING id",
        ).bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        // STORNIERTE Person (trägt trotzdem PII).
        sqlx::query(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, storniert_at, erfasst_von, geaendert_von) \
             VALUES (?,2,'erfasst','Storno','Erika','2026-01-05 00:00:00', ?, ?)",
        ).bind(e).bind(b).bind(b).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von) VALUES (?,?, 'Verdacht auf XY', ?)")
            .bind(e).bind(p1).bind(b).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, halter_kontakt, antreff_ort, notiz, kennzeichnung, erfasst_von, geaendert_von) VALUES (?,1,'hund','Müller 0170','Wald','x','CHIP-276098106012345', ?, ?)")
            .bind(e).bind(b).bind(b).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, status, typ, ausmass, ort, beschreibung, geschaedigt_kontakt, uebergeben_an, uebergeben_at, erfasst_von, geaendert_von) VALUES (?,1,'uebergeben','sachschaden','gering','Hauptstr','Schaden','Geschäd. Person','Polizist Schmidt','2026-01-02 00:00:00', ?, ?)")
            .bind(e).bind(b).bind(b).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name, snap_funktion, bemerkung) VALUES (?, NULL, 'Externer Hans', 'Helfer', 'kam spontan')")
            .bind(e).execute(&pool).await.unwrap();
        // Eine bestehende ETB-Zeile (Skelett, muss erhalten bleiben).
        sqlx::query("INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) VALUES (?,1,'meldung','ORIGINAL', ?, '2026-01-01 09:00:00')")
            .bind(e).bind(b).execute(&pool).await.unwrap();
        // Bild-Hintergrund (LFH-35): name kann PII tragen (z.B. „Lageplan Familie Müller.png").
        let bild = crate::karte_hintergrundbild::repo::anlegen(
            &pool,
            e,
            b,
            "Lageplan Familie Müller.png",
            "image/png",
            &[0x89, b'P', b'N', b'G'],
            "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]",
        )
        .await
        .unwrap();

        // Tick nach Ablauf der Karenz → eine Schwärzung.
        assert_eq!(tick_einmal(&pool, t("2026-06-01 12:00:00")).await, 1);

        // (a) PII genullt/platzhalter — auch die STORNIERTE Person.
        let namen: Vec<Option<String>> = sqlx::query_scalar(
            "SELECT name FROM einsatz_person WHERE einsatz_id = ? ORDER BY registrier_nr",
        )
        .bind(e)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            namen,
            vec![None, None],
            "alle Personen (inkl. stornierte) gescrubbt"
        );
        let vtext: String =
            sqlx::query_scalar("SELECT text FROM person_verlaufsnotiz WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(vtext, super::repo::SCHWAERZUNG_PLATZHALTER);
        let (halter, kennzeichnung): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT halter_kontakt, kennzeichnung FROM einsatz_tier WHERE einsatz_id = ?",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(halter, None);
        assert_eq!(
            kennzeichnung, None,
            "Chip-/Tätowierungsnummer (personenverknüpfend) gescrubbt"
        );
        // aktueller_verbleib-Cache (Klinikname „Transport → …") überlebt die Schwärzung nicht.
        let verbleib: Option<String> = sqlx::query_scalar("SELECT aktueller_verbleib FROM einsatz_person WHERE einsatz_id = ? AND registrier_nr = 1")
            .bind(e).fetch_one(&pool).await.unwrap();
        assert_eq!(
            verbleib, None,
            "denormalisierter Verbleib-Cache (PII) gescrubbt"
        );
        // (b) Schaden bei status='uebergeben' brach NICHT (uebergeben_an → Platzhalter).
        let (uebergeben_an, geschaedigt, status): (String, Option<String>, String) =
            sqlx::query_as("SELECT uebergeben_an, geschaedigt_kontakt, status FROM einsatz_schaden WHERE einsatz_id = ?")
            .bind(e).fetch_one(&pool).await.unwrap();
        assert_eq!(uebergeben_an, super::repo::SCHWAERZUNG_PLATZHALTER);
        assert_eq!(geschaedigt, None);
        assert_eq!(status, "uebergeben");
        let snap: String =
            sqlx::query_scalar("SELECT snap_name FROM einsatz_personal WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(snap, super::repo::SCHWAERZUNG_PLATZHALTER);
        // (b2) Bild-Hintergrund: name geschwärzt, BLOB (Kartografie) bleibt erhalten.
        let nachher = crate::karte_hintergrundbild::repo::liste(&pool, e)
            .await
            .unwrap();
        assert_eq!(
            nachher[0].name,
            super::repo::SCHWAERZUNG_PLATZHALTER,
            "Bildname (PII) geschwärzt"
        );
        let (_, _, daten) = crate::karte_hintergrundbild::repo::laden_bytes(&pool, e, bild.id)
            .await
            .unwrap();
        assert!(!daten.is_empty(), "Bild-BLOB (Kartografie) bleibt erhalten");

        // (c) Skelett intakt: Einsatz + registrier_nr + ETB-Original erhalten.
        let person_anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            person_anzahl, 2,
            "Personen-Zeilen bleiben (nur Inhalt gescrubbt)"
        );
        let etb_original: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND inhalt = 'ORIGINAL'",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(etb_original, 1, "ETB-Skelett erhalten");

        // (d) geschwaerzt_at gesetzt.
        let s: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s.as_deref(), Some("2026-06-01 12:00:00"));

        // (e) Zweiter Tick: idempotent, kein Doppel-Scrub.
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 0);
        let s2: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            s2.as_deref(),
            Some("2026-06-01 12:00:00"),
            "Tombstone unverändert"
        );
    }

    #[tokio::test]
    async fn soft_geloescht_vor_karenz_wird_nicht_geschwaerzt() {
        // Phase B greift erst nach KARENZ_TAGE. Direkt nach dem Soft-Delete (gleicher
        // Tick-Tag) darf nicht geschwärzt werden.
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        // Soft-Delete.
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 1);
        // Wenige Tage später (< KARENZ_TAGE): noch keine Schwärzung.
        assert_eq!(tick_einmal(&pool, t("2026-06-10 12:00:00")).await, 0);
        let s: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s, None, "vor Ablauf der Karenz nicht geschwärzt");
    }
}
