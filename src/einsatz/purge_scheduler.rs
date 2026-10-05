//! Aufbewahrungs-Purge-Scheduler (LFH-135) — gespiegeltes Muster von
//! `erinnerung::scheduler`: ein dünner Tokio-`interval`-Task ruft periodisch
//! `tick_einmal`; die Logik selbst ist mit injiziertem `jetzt` deterministisch
//! testbar. Idempotent über WHERE-Guards in den Repo-Queries.
//!
//! Vier Phasen:
//! - **Phase A** (reversibel): Einsätze mit abgelaufener Aufbewahrungsfrist werden
//!   soft-gelöscht (`geloescht_at` = Karenz-Start: Fristablauf bzw. Setzen einer Frist in die
//!   Vergangenheit, höchstens jetzt; LFH-906). Ab da am Datenzugriff
//!   gesperrt (`darf_lesen`).
//! - **Phase A2** (IRREVERSIBEL, LFH-751): fällige Schwärzungsanträge (Löschersuchen nach
//!   Art. 17) werden vollzogen (`aufbewahrung::antrag::vollziehe_faellige`).
//! - **Phasen K1/K2** (LFH-749): dasselbe je Datenkategorie — Vormerkung nach Ablauf der
//!   Kategorie-Frist, Schwärzung nur ihrer Daten nach der Karenz. Der Einsatz bleibt lesbar.
//! - **Phase B** (IRREVERSIBEL): nach Ablauf der Karenz (`KARENZ_TAGE`) werden die
//!   Personendaten gescrubbt (`repo::schwaerze_einsatz`), das operative Skelett
//!   (Einsatz, ETB, Zähler) bleibt erhalten. `geschwaerzt_at`-Tombstone = Idempotenz.
//! - **Phase C**: abgelaufene Einträge des Auth-Audits (eigene Frist, an keinem Einsatz).
//! - **Phase D** (UNUMKEHRBAR, LFH-750): ein geschwärzter Einsatz, dessen Skelett-Frist der Org
//!   abgelaufen ist, wird samt ETB endgültig gelöscht (`skelett_loeschung::loeschen`); seine
//!   einzige Spur ist das Löschprotokoll der Org. Ohne Org-Frist bleibt das Skelett.
//!
//! DATENVERLUST-kritisch: jede Mutation wird zuvor mit `tracing` protokolliert. Phase A und B
//! begleitet ein ETB-System-Audit; Phase D schreibt ihren Audit in derselben Transaktion ins
//! `aufbewahrung_loeschprotokoll` (das ETB geht mit); Phase C betrifft keinen Einsatz. Aktive
//! Einsätze sind durch `status='abgeschlossen'` in jeder Einsatz-Purge-Query hart ausgeschlossen.

use super::aufbewahrung_kategorie as kategorie;
use super::repo;
use super::retention::{karenz_abgelaufen, KARENZ_TAGE};
use super::skelett_loeschung;
use crate::live::{LiveEvent, LiveHub};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::time::Duration;

/// Pollintervall des Purge-Schedulers (10 Minuten — Aufbewahrung ist tagesgenau,
/// kein Sekunden-Druck wie bei Erinnerungen).
const TICK_SEKUNDEN: u64 = 600;

/// Ein Purge-Durchlauf für den Zeitpunkt `jetzt`. Führt Phase A (Soft-Delete), Phase B
/// (PII-Schwärzung), Phase C (Auth-Audit) und Phase D (endgültige Löschung) aus und liefert
/// die Gesamtzahl der Mutationen.
/// Async + injiziertes `jetzt` = deterministisch testbar. Idempotent: ein zweiter
/// Tick ohne neue Fälligkeiten liefert 0.
///
/// Ohne Gedächtnis für einen ausstehenden WAL-Rückschrieb; der laufende Scheduler nimmt
/// [`tick_mit_rueckschrieb`].
///
/// Ein Soft-Delete meldet `einsatzliste` an die Leser des Einsatzes (LFH-734): er verschwindet
/// aus ihrer Liste. Die Schwärzung (Phase B) trifft nur schon gesperrte Einsätze und meldet nichts.
pub async fn tick_einmal(pool: &SqlitePool, live: &LiveHub, jetzt: DateTime<Utc>) -> usize {
    tick_mit_rueckschrieb(pool, live, jetzt, &mut false).await
}

/// Wie [`tick_einmal`], schreibt nach einer Schwärzung oder endgültigen Löschung (LFH-750) aber
/// den WAL zurück (LFH-725, Spec
/// `aufbewahrung`, „Physische Entfernung geschwärzter Werte“): erst damit sind die genullten
/// Seiten in der Hauptdatei und der Vorzustand aus dem WAL getilgt. Blockiert eine andere
/// Verbindung den Rückschrieb, bleibt `rueckschrieb_ausstehend` gesetzt, und jeder folgende Tick
/// versucht es erneut, bis es gelingt.
pub async fn tick_mit_rueckschrieb(
    pool: &SqlitePool,
    live: &LiveHub,
    jetzt: DateTime<Utc>,
    rueckschrieb_ausstehend: &mut bool,
) -> usize {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let mut anzahl = 0;
    let mut geschwaerzt = 0;
    let mut geloescht = 0;

    // --- Phase A: Soft-Delete fälliger Einsätze (reversibel, Karenz-Start ab Fristablauf) ---
    match repo::faellige_soft_delete(pool, &jetzt_s).await {
        Ok(ids) => {
            for id in ids {
                // Gemeldet wird erst der Erfolg (LFH-756): ein fail-closed gescheiterter Versuch
                // stünde sonst bei jeder Blockade alle 10 min als Erfolg neben dem `error!`.
                match repo::soft_delete_einsatz(pool, id, &jetzt_s).await {
                    Ok(true) => {
                        tracing::info!(
                            einsatz_id = id,
                            "Purge Phase A: Soft-Delete (Aufbewahrungsfrist abgelaufen)"
                        );
                        anzahl += 1;
                        crate::live::org::einsatzliste_melden(pool, live, id, &[]).await;
                    }
                    Ok(false) => {} // Race: bereits soft-gelöscht.
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase A fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase A: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase A2: fällige Schwärzungsanträge (Art. 17, LFH-751, IRREVERSIBEL) ---
    // Vor Phase B, damit ein Einsatz-Antrag mit seinem Aktenzeichen im Audit schwärzt, wenn
    // im selben Lauf auch die Karenz abliefe. Ein Vollzug zählt für den WAL-Rückschrieb.
    let vollzogen = crate::aufbewahrung::antrag::vollziehe_faellige(pool, live, jetzt).await;
    anzahl += vollzogen;
    geschwaerzt += vollzogen;

    // --- Phase K1: Vormerkung fälliger Datenkategorien (LFH-749, reversibel) ---
    // Auch an einem gesperrten Einsatz: eine Kategorie bleibt nicht liegen, nur weil der Einsatz
    // vorgemerkt wurde (Spec `aufbewahrung-kategorien`, „Zusammenspiel mit der Einsatz-Frist“).
    match kategorie::faellige_vormerkung(pool, &jetzt_s).await {
        Ok(faellig) => {
            for (id, k) in faellig {
                tracing::info!(
                    einsatz_id = id,
                    kategorie = k.as_str(),
                    "Purge Phase K1: Datenkategorie vorgemerkt (Frist abgelaufen)"
                );
                match kategorie::vormerken(pool, id, k, &jetzt_s).await {
                    Ok(true) => {
                        anzahl += 1;
                        live.publiziere_einsatz(id, LiveEvent::Etb);
                    }
                    Ok(false) => {}
                    Err(e) => tracing::error!(
                        einsatz_id = id,
                        kategorie = k.as_str(),
                        "Purge Phase K1 fehlgeschlagen: {e}"
                    ),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase K1: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase K2: Schwärzung einer Datenkategorie nach ihrer Karenz (IRREVERSIBEL) ---
    match kategorie::faellige_schwaerzung(pool).await {
        Ok(kandidaten) => {
            for (id, k, vorgemerkt_at) in kandidaten {
                if !karenz_abgelaufen(Some(&vorgemerkt_at), jetzt) {
                    continue;
                }
                tracing::warn!(
                    einsatz_id = id,
                    kategorie = k.as_str(),
                    "Purge Phase K2: Schwärzung einer Datenkategorie (irreversibel)"
                );
                match kategorie::schwaerzen(pool, id, k, jetzt).await {
                    Ok(true) => {
                        anzahl += 1;
                        geschwaerzt += 1;
                        // Offene Clients laden neu und tragen keinen Altstand weiter (design.md D5).
                        for event in [
                            LiveEvent::Person,
                            LiveEvent::Dokument,
                            LiveEvent::Schaden,
                            LiveEvent::Chat,
                            LiveEvent::Etb,
                        ] {
                            live.publiziere_einsatz(id, event);
                        }
                    }
                    Ok(false) => {}
                    Err(e) => tracing::error!(
                        einsatz_id = id,
                        kategorie = k.as_str(),
                        "Purge Phase K2 fehlgeschlagen: {e}"
                    ),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase K2: Abfrage fehlgeschlagen: {e}"),
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
                // Wie Phase A: erst nach dem Erfolg melden (LFH-756).
                match repo::schwaerze_einsatz(pool, id, &jetzt_s).await {
                    Ok(true) => {
                        tracing::warn!(
                            einsatz_id = id,
                            "Purge Phase B: PII-SCHWÄRZUNG (irreversibel) — Karenz abgelaufen"
                        );
                        anzahl += 1;
                        geschwaerzt += 1;
                    }
                    Ok(false) => {} // Bereits geschwärzt (Idempotenz).
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase B fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase B: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase C: abgelaufene Auth-Audit-Einträge (LFH-249/F30) ---
    // Die Audit-Spur trägt personenbezogene Daten (Benutzername, Quell-IP), hängt aber an
    // keinem Einsatz und damit an keiner Einsatz-Aufbewahrungsfrist. Ohne eigene Frist
    // entstünde eine unbegrenzt wachsende Sammlung von Anmeldedaten — deshalb hier mit,
    // wo der Aufbewahrungs-Purge ohnehin läuft.
    match crate::auth::audit::purge_abgelaufene(pool).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::info!(
                anzahl = n,
                tage = crate::auth::audit::AUFBEWAHRUNG_TAGE,
                "Purge Phase C: abgelaufene Auth-Audit-Einträge gelöscht"
            );
            anzahl += n as usize;
        }
        Err(e) => tracing::warn!("Purge Phase C: Auth-Audit-Purge fehlgeschlagen: {e}"),
    }

    // --- Phase D: endgültige Löschung geschwärzter Skelette (UNUMKEHRBAR, LFH-750) ---
    // Läuft nach Phase B: fallen Karenz-Ende und Skelett-Frist in denselben Lauf, löscht er
    // direkt nach der Schwärzung. Wie Phase B meldet sie nichts live — der Einsatz ist seit der
    // Vormerkung gesperrt und steht in keiner Einsatzliste.
    match skelett_loeschung::faellige(pool, jetzt).await {
        Ok(ids) => {
            for id in ids {
                tracing::warn!(
                    einsatz_id = id,
                    "Purge Phase D: ENDGÜLTIGE LÖSCHUNG des Skeletts (unumkehrbar) — \
                     Skelett-Frist abgelaufen"
                );
                match skelett_loeschung::loeschen(pool, id, jetzt).await {
                    Ok(true) => {
                        anzahl += 1;
                        geloescht += 1;
                    }
                    Ok(false) => {} // Race: Frist geleert/verlängert oder schon gelöscht.
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase D fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase D: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Rückschrieb nach Schwärzung oder Löschung (LFH-725, LFH-750) ---
    // Nicht in jedem Tick: TRUNCATE hält beim Warten auf Lesende die Schreibsperre.
    if geschwaerzt > 0 || geloescht > 0 || *rueckschrieb_ausstehend {
        match crate::db::wal_zurueckschreiben(pool).await {
            Ok(true) => {
                if *rueckschrieb_ausstehend {
                    tracing::info!("Purge: ausstehender WAL-Rückschrieb nachgeholt");
                }
                *rueckschrieb_ausstehend = false;
            }
            Ok(false) => {
                tracing::warn!(
                    "Purge: WAL-Rückschrieb von anderen Verbindungen blockiert, nächster Tick \
                     versucht es erneut"
                );
                *rueckschrieb_ausstehend = true;
            }
            Err(e) => {
                tracing::warn!(
                    "Purge: WAL-Rückschrieb fehlgeschlagen, nächster Tick versucht es erneut: {e}"
                );
                *rueckschrieb_ausstehend = true;
            }
        }
    }

    anzahl
}

/// Startet den Hintergrund-Purge-Scheduler (nur im Produktivlauf aus `main.rs`).
/// Dünner Wrapper um `tick_einmal`; die Logik selbst ist oben testbar.
pub fn starte_purge_scheduler(pool: SqlitePool, live: LiveHub) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(TICK_SEKUNDEN));
        // `true`: der erste Tick (sofort) holt einen beim Start blockierten Rückschrieb nach,
        // etwa nach einem Absturz zwischen Schwärzung und Rückschrieb.
        let mut rueckschrieb_ausstehend = true;
        loop {
            ticker.tick().await;
            tick_mit_rueckschrieb(&pool, &live, Utc::now(), &mut rueckschrieb_ausstehend).await;
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

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
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
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-05-01 12:00:00")).await,
            0
        );
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g, None, "vor Ablauf nicht soft-gelöscht");

        // Nach Fälligkeit: genau ein Soft-Delete, Tombstone gesetzt.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            1
        );
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g.as_deref(), Some("2026-06-02 12:00:00"));

        // Zweiter Tick: idempotent, kein erneutes Soft-Delete (noch in Karenz, nicht purge-fällig).
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:05:00")).await,
            0
        );
    }

    thread_local! {
        /// Ziel der Log-Ausgabe dieses Test-Threads, solange ein [`LogPuffer`] einfängt.
        static LOG_ZIEL: std::cell::RefCell<Option<LogPuffer>> = const { std::cell::RefCell::new(None) };
    }

    /// Fängt die Log-Ausgabe eines Tests ein.
    ///
    /// Über EINEN globalen Subscriber, dessen Writer nur in den Puffer des eigenen Threads schreibt
    /// (ein `#[tokio::test]` läuft auf genau einem). Ein thread-lokaler (`set_default`) fing unter
    /// parallelen Tests mal alles, mal nichts: `tracing` speichert je Meldestelle zwischen, ob sie
    /// jemand hören will, und das über alle Threads hinweg.
    #[derive(Clone, Default)]
    struct LogPuffer(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    /// Hebt das Einfangen beim Verlassen des Tests auf.
    struct LogWaechter;

    impl Drop for LogWaechter {
        fn drop(&mut self) {
            LOG_ZIEL.with(|z| z.borrow_mut().take());
        }
    }

    impl LogPuffer {
        fn einfangen() -> (Self, LogWaechter) {
            static GLOBAL: std::sync::Once = std::sync::Once::new();
            GLOBAL.call_once(|| {
                let _ = tracing::subscriber::set_global_default(
                    tracing_subscriber::fmt()
                        .with_writer(|| ThreadLog)
                        .with_ansi(false)
                        .with_max_level(tracing::Level::INFO)
                        .finish(),
                );
            });
            // Eine Meldestelle, die ein anderer Thread gerade während des Setzens registriert
            // hat, kann sonst als „hört niemand“ stehen bleiben.
            tracing::callsite::rebuild_interest_cache();
            let puffer = Self::default();
            LOG_ZIEL.with(|z| *z.borrow_mut() = Some(puffer.clone()));
            (puffer, LogWaechter)
        }

        fn text(&self) -> String {
            String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
        }
    }

    /// Writer des globalen Test-Subscribers: schreibt in den Puffer des Threads oder verwirft.
    struct ThreadLog;

    impl std::io::Write for ThreadLog {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            LOG_ZIEL.with(|z| {
                if let Some(puffer) = z.borrow().as_ref() {
                    puffer.0.lock().unwrap().extend_from_slice(buf);
                }
            });
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// Jeder Audit-Eintrag scheitert — Soft-Delete und Schwärzung brechen fail-closed ab.
    async fn audit_scheitern_lassen(pool: &SqlitePool) {
        sqlx::query(
            "CREATE TRIGGER test_audit_scheitert BEFORE INSERT ON etb_eintrag \
             BEGIN SELECT RAISE(ABORT, 'simulierter Audit-Fehler'); END",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn audit_wieder_zulassen(pool: &SqlitePool) {
        sqlx::query("DROP TRIGGER test_audit_scheitert")
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn phase_a_meldet_den_soft_delete_erst_nach_dem_erfolg() {
        // LFH-756: Scheitert das Soft-Delete fail-closed (hier am Audit-Eintrag), darf neben dem
        // `error!` keine Erfolgsmeldung stehen — bei einer Blockade sonst alle 10 min.
        let (puffer, _log) = LogPuffer::einfangen();
        let pool = crate::db::test_pool().await;
        abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        audit_scheitern_lassen(&pool).await;

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            0
        );
        let log = puffer.text();
        assert!(log.contains("Purge Phase A fehlgeschlagen"), "{log}");
        assert!(
            !log.contains("Soft-Delete"),
            "Erfolgsmeldung trotz Fehlschlag: {log}"
        );

        audit_wieder_zulassen(&pool).await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:10:00")).await,
            1
        );
        let log = puffer.text();
        assert_eq!(log.matches("Soft-Delete").count(), 1, "{log}");
    }

    #[tokio::test]
    async fn phase_b_meldet_die_schwaerzung_erst_nach_dem_erfolg() {
        let pool = crate::db::test_pool().await;
        abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            1
        );
        let (puffer, _log) = LogPuffer::einfangen();
        audit_scheitern_lassen(&pool).await;
        let nach_karenz = t("2026-08-01 12:00:00");

        assert_eq!(tick_einmal(&pool, &LiveHub::new(), nach_karenz).await, 0);
        let log = puffer.text();
        assert!(log.contains("Purge Phase B fehlgeschlagen"), "{log}");
        assert!(
            !log.contains("PII-SCHWÄRZUNG"),
            "Erfolgsmeldung trotz Fehlschlag: {log}"
        );

        audit_wieder_zulassen(&pool).await;
        assert_eq!(tick_einmal(&pool, &LiveHub::new(), nach_karenz).await, 1);
        let log = puffer.text();
        assert_eq!(log.matches("PII-SCHWÄRZUNG").count(), 1, "{log}");
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

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2027-01-01 12:00:00")).await,
            0
        );
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
        // Ad-hoc-externe Kraft (personal_id NULL) → snap_* ist einsatz-scoped PII, wird gescrubbt.
        sqlx::query("INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name, snap_funktion, bemerkung) VALUES (?, NULL, 'Externer Hans', 'Helfer', 'kam spontan')")
            .bind(e).execute(&pool).await.unwrap();
        // Disponierte Stamm-Kraft (personal_id gesetzt) → snap_* ist ein Stammdaten-Snapshot und
        // muss die Schwärzung ÜBERLEBEN. Negativtest gegen einen Wegfall des personal_id-Zeilenfilters.
        let stamm_pid: i64 = sqlx::query_scalar(
            "INSERT INTO personal (org_id, name) VALUES (1, 'Stamm-Dora') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name, snap_funktion, bemerkung) VALUES (?, ?, 'Stamm-Dora', 'Gruppenführer', 'stamm')")
            .bind(e).bind(stamm_pid).execute(&pool).await.unwrap();
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
            None,
        )
        .await
        .unwrap();

        // Tick nach Ablauf der Karenz → eine Schwärzung.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-01 12:00:00")).await,
            1
        );

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
        // ort (Schadensort = faktisch Adresse Betroffener, NOT NULL) → Platzhalter (LFH-229,
        // Nutzer-Entscheidung); beschreibung (operative Schadens-Doku) bleibt bewusst RETAIN.
        let (ort, beschreibung, uebergeben_an, geschaedigt, status): (
            String,
            String,
            String,
            Option<String>,
            String,
        ) = sqlx::query_as("SELECT ort, beschreibung, uebergeben_an, geschaedigt_kontakt, status FROM einsatz_schaden WHERE einsatz_id = ?")
            .bind(e).fetch_one(&pool).await.unwrap();
        assert_eq!(
            ort,
            super::repo::SCHWAERZUNG_PLATZHALTER,
            "Schadensort (faktisch Adresse) gescrubbt"
        );
        assert_eq!(
            beschreibung,
            super::repo::SCHWAERZUNG_PLATZHALTER,
            "Schadens-Beschreibung (unstrukturierter Freitext-PII) gescrubbt"
        );
        assert_eq!(uebergeben_an, super::repo::SCHWAERZUNG_PLATZHALTER);
        assert_eq!(geschaedigt, None);
        assert_eq!(status, "uebergeben");
        // Ad-hoc-Kraft (personal_id NULL): snap_name gescrubbt (Platzhalter).
        let snap_extern: String = sqlx::query_scalar(
            "SELECT snap_name FROM einsatz_personal WHERE einsatz_id = ? AND personal_id IS NULL",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(snap_extern, super::repo::SCHWAERZUNG_PLATZHALTER);
        // Disponierte Stamm-Kraft (personal_id gesetzt): Snapshot bleibt UNVERÄNDERT (Stammdaten).
        let (snap_stamm_name, snap_stamm_funktion): (String, Option<String>) = sqlx::query_as(
            "SELECT snap_name, snap_funktion FROM einsatz_personal \
             WHERE einsatz_id = ? AND personal_id IS NOT NULL",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            snap_stamm_name, "Stamm-Dora",
            "Stammdaten-Snapshot einer disponierten Kraft darf NICHT gescrubbt werden"
        );
        assert_eq!(snap_stamm_funktion.as_deref(), Some("Gruppenführer"));
        // (b2) Bild-Hintergrund: name geschwärzt, BLOB (Kartografie) bleibt erhalten.
        let nachher = crate::karte_hintergrundbild::repo::liste(&pool, e, None)
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
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            0
        );
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

    /// F02/LFH-229: die vormals ungescrubbten Lücken (Einsatz-Kopf, Anhang-BLOB,
    /// Lage-/Gefahren-Freitexte, operative Freitext-Zettel) werden jetzt data-driven aus
    /// der Registry mit-geschwärzt; ETB-Wortlaut + operatives Skelett bleiben, der Meldungs-Freitext
    /// geht seit LFH-701 mit (die Führungsdokumentation ist das ETB).
    /// Exerziert zugleich alle Generator-Pfade: SelbstId (Kopf), EinsatzId (NullSetzen),
    /// Platzhalter (lage_meldung.text NOT NULL), ZeileLoeschen (anhang), UeberParent
    /// (gefahr_bewertung über gefahrengebiet).
    #[tokio::test]
    async fn phase_b_schwaerzt_neue_luecken_und_haelt_fuehrungsdoku() {
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
        // Abgeschlossen + soft-gelöscht (Karenz lange her) + Kopf-PII gesetzt.
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, \
                retention_bis, geloescht_at, einsatzort, einsatzort_lat, einsatzort_lon, \
                meldende_stelle, sachverhalt) \
             VALUES (1,'Hochwasser Musterstadt','abgeschlossen','2026-01-01 00:00:00', ?, \
                '2026-02-01 00:00:00','2026-02-15 00:00:00','Hauptstr 3, Familie Müller', \
                50.1, 8.6, 'Anrufer Herr Müller 0170', 'Betroffener im OG eingeschlossen') RETURNING id",
        )
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Anhang-BLOB (Foto Betroffener) — muss als GANZE ZEILE verschwinden.
        let anhang = crate::anhang::repo::anlegen(
            &pool,
            e,
            b,
            "Foto Betroffener.jpg",
            "image/jpeg",
            &[0xFF, 0xD8, 0xFF, 0xE0],
        )
        .await
        .unwrap();

        // Lage-Freitexte.
        sqlx::query(
            "INSERT INTO lage_zone (einsatz_id, typ, geometrie_typ, geometrie, label, notiz, erstellt_von) \
             VALUES (?, 'freie_skizze', 'Polygon', '{}', 'ELW Fam. Müller', 'Kontakt 0170', ?)",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        let gebiet: i64 = sqlx::query_scalar(
            "INSERT INTO gefahrengebiet (einsatz_id, label, erstellt_von) \
             VALUES (?, 'Wohngebiet Müllerstr', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        // gefahr_bewertung hat KEIN einsatz_id → Scoping über den Parent gefahrengebiet.
        sqlx::query(
            "INSERT INTO gefahr_bewertung (gefahrengebiet_id, gefahrentyp, schutzobjekt, warnstufe, \
                beschreibung, gemeldet_von, aktualisiert_von) \
             VALUES (?, 'brand', 'menschen', 'hoch', 'Gasgeruch im Treppenhaus', 'Melderin Anna Beispiel', ?)",
        )
        .bind(gebiet)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();

        // Meldung (Freitext Scrub, LFH-701) + daraus abgeleitetes lage_meldung (text NOT NULL → Platzhalter).
        let meldung: i64 = sqlx::query_scalar(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, ereigniszeit, eingang_at, erfasst_von_id) \
             VALUES (?, 1, 'Florian 1', 'funk', 'Lagemeldung Wortlaut (nur im ETB erhalten)', \
                '2026-01-01 09:00:00', '2026-01-01 09:01:00', ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO lage_meldung (einsatz_id, meldung_id, text, erstellt_von_id) \
             VALUES (?, ?, 'Lageobjekt-Freitext mit PII', ?)",
        )
        .bind(e)
        .bind(meldung)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();

        // Operativer Freitext-Zettel (bemerkung) — konservativ gescrubbt; name (Label) bleibt.
        sqlx::query(
            "INSERT INTO einsatzabschnitt (einsatz_id, name, bemerkung) \
             VALUES (?, 'Abschnitt Nord', 'Zettel: Anwohner Herr Müller hat Schlüssel')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();

        // ETB-Skelett (muss bleiben).
        sqlx::query("INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) VALUES (?,1,'meldung','ETB ORIGINAL', ?, '2026-01-01 09:00:00')")
            .bind(e).bind(b).execute(&pool).await.unwrap();

        // Tick nach Ablauf der Karenz → eine Schwärzung.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-01 12:00:00")).await,
            1
        );

        // (a) Einsatz-Kopf: PII genullt, operatives Label (bezeichnung) bleibt.
        let (ort, lat, lon, ms, sv, bez): (
            Option<String>,
            Option<f64>,
            Option<f64>,
            Option<String>,
            Option<String>,
            String,
        ) = sqlx::query_as(
            "SELECT einsatzort, einsatzort_lat, einsatzort_lon, meldende_stelle, sachverhalt, bezeichnung \
             FROM einsatz WHERE id = ?",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(ort, None, "Einsatzort (Adresse) genullt");
        assert_eq!(lat, None, "GPS mit-genullt");
        assert_eq!(lon, None, "GPS mit-genullt");
        assert_eq!(ms, None, "meldende Stelle genullt");
        assert_eq!(sv, None, "Sachverhalt/Meldebild genullt");
        assert_eq!(bez, "Hochwasser Musterstadt", "operatives Label bleibt");

        // (b) Anhang-Zeile ist WEG (BLOB Betroffener), nicht nur der Name.
        let treffer = crate::anhang::repo::anzeige_laden(&pool, anhang.id).await;
        assert!(
            matches!(treffer, Err(crate::error::AppError::NotFound)),
            "Anhang-Zeile muss gelöscht sein"
        );
        let anhang_zahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anhang_zahl, 0);

        // (c) Lage-/Gefahren-Freitexte gescrubbt; Geometrie-Skelett bleibt.
        let (lz_label, lz_notiz, lz_geo): (Option<String>, Option<String>, String) =
            sqlx::query_as("SELECT label, notiz, geometrie FROM lage_zone WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(lz_label, None);
        assert_eq!(lz_notiz, None);
        assert_eq!(lz_geo, "{}", "Geometrie-Skelett bleibt");
        let gg_label: Option<String> =
            sqlx::query_scalar("SELECT label FROM gefahrengebiet WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(gg_label, None);
        // UeberParent-Scoping: gemeldet_von (Melder-Klartext) UND beschreibung (Freitext-PII)
        // beide genullt.
        let (gb_melder, gb_beschr): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT gemeldet_von, beschreibung FROM gefahr_bewertung WHERE gefahrengebiet_id = ?",
        )
        .bind(gebiet)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            gb_melder, None,
            "Melder-Klartext (UeberParent-Scoping) genullt"
        );
        assert_eq!(
            gb_beschr, None,
            "Gefahren-Beschreibung (unstrukturierter Freitext-PII) gescrubbt"
        );

        // (d) lage_meldung.text (NOT NULL) → Platzhalter.
        let lm_text: String =
            sqlx::query_scalar("SELECT text FROM lage_meldung WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(lm_text, super::repo::SCHWAERZUNG_PLATZHALTER);

        // (e) Operativer Freitext-Zettel genullt; Struktur-Label bleibt.
        let (ea_name, ea_bem): (String, Option<String>) =
            sqlx::query_as("SELECT name, bemerkung FROM einsatzabschnitt WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            ea_name, "Abschnitt Nord",
            "operatives Struktur-Label bleibt"
        );
        assert_eq!(ea_bem, None, "operativer Freitext-Zettel gescrubbt");

        // (f) Führungsdokumentation ist das ETB (LFH-701, Linie A): Der Meldungs-Wortlaut im
        // Modul wird geschwärzt, das ETB-Skelett bleibt im Wortlaut erhalten.
        let m_inhalt: String = sqlx::query_scalar("SELECT inhalt FROM meldung WHERE id = ?")
            .bind(meldung)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            m_inhalt,
            crate::einsatz::repo::SCHWAERZUNG_PLATZHALTER,
            "Meldungs-Freitext im Modul geschwärzt"
        );
        let etb_original: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND inhalt = 'ETB ORIGINAL'",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(etb_original, 1, "ETB-Skelett erhalten");

        // (g) geschwaerzt_at gesetzt; zweiter Tick idempotent.
        let s: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s.as_deref(), Some("2026-06-01 12:00:00"));
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            0
        );
    }

    /// LFH-639, Spec-Szenario „Einsatz schwärzen“ — bewusst mit ZWEI aktiven Bezirken und
    /// ZWEI aktiven Stellen: die Bezeichnung steht unter einem partiellen UNIQUE-Index
    /// `(einsatz_id, bezeichnung) WHERE storniert_at IS NULL`. Ein für alle Zeilen gleicher
    /// Platzhalter verletzte ihn, und die ganze Schwärzung bräche ab (mit einem Bezirk, wie im
    /// Szenario, bliebe das unsichtbar).
    #[tokio::test]
    async fn schwaerzung_betreuung_ersetzt_bezeichnungen_und_haelt_mengen() {
        use crate::betreuung::repo as b;
        use crate::betreuung::{BetreuungsstelleArt, BetreuungsstelleStatus, Erhebung};

        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let nutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Leit','leit','h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, \
                retention_bis, geloescht_at) \
             VALUES (1,'Hochwasser','abgeschlossen','2026-01-01 00:00:00', ?, \
                '2026-02-01 00:00:00','2026-02-15 00:00:00') RETURNING id",
        )
        .bind(nutzer)
        .fetch_one(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        for (bezeichnung, plan) in [("Uferstraße 12–40", 640), ("Deichweg 1–9", 120)] {
            let g = b::bezirk_anlegen_tx(
                &mut tx,
                e,
                nutzer,
                1,
                &b::BezirkEingabe {
                    bezeichnung: bezeichnung.into(),
                    abschnitt_id: None,
                    plan_personen: plan,
                    plan_erhebung: Erhebung::Geschaetzt,
                    sammelstelle: Some("Parkplatz bei Familie Müller".into()),
                    notiz: Some("Frau Schulz, Rollstuhl".into()),
                },
            )
            .await
            .unwrap();
            b::stand_melden_tx(
                &mut tx,
                e,
                g.id,
                nutzer,
                1,
                &b::StandEingabe {
                    evakuiert: 212,
                    erhebung: Erhebung::Gezaehlt,
                    zeitpunkt_at: "2026-01-01 09:30:00".into(),
                    client_id: None,
                },
            )
            .await
            .unwrap();
        }
        for bezeichnung in ["Turnhalle Ost, Ostring 5", "Weserstadion"] {
            let g = b::stelle_anlegen_tx(
                &mut tx,
                e,
                nutzer,
                1,
                &b::StelleEingabe {
                    bezeichnung: bezeichnung.into(),
                    art: BetreuungsstelleArt::Notunterkunft,
                    abschnitt_id: None,
                    kapazitaet_personen: Some(150),
                    standort: Some("Ostring 5".into()),
                    notiz: Some("Ansprechpartner Herr Meier 0170".into()),
                },
            )
            .await
            .unwrap();
            b::stelle_aendern_tx(
                &mut tx,
                e,
                g.id,
                nutzer,
                1,
                &b::StelleAenderung {
                    status: Some(BetreuungsstelleStatus::InBetrieb),
                    // LFH-673: die Koordinate ist Geo-Skelett (G_GEO) und bleibt stehen.
                    lat: Some(Some(51.93)),
                    lon: Some(Some(8.87)),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            b::belegung_melden_tx(
                &mut tx,
                e,
                g.id,
                nutzer,
                1,
                &b::BelegungEingabe {
                    belegt: 89,
                    zeitpunkt_at: "2026-01-01 10:00:00".into(),
                    client_id: None,
                },
            )
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();

        assert!(
            super::repo::schwaerze_einsatz(&pool, e, "2026-06-01 12:00:00")
                .await
                .expect("Schwärzung darf nicht am UNIQUE-Index scheitern"),
            "Einsatz wurde geschwärzt"
        );

        let bezirk_zeilen: Vec<(String, Option<String>, Option<String>, i64, String, String)> =
            sqlx::query_as(
                "SELECT bezeichnung, sammelstelle, notiz, plan_personen, plan_erhebung, raeumung \
                 FROM evakuierungsbezirk WHERE einsatz_id = ? ORDER BY id",
            )
            .bind(e)
            .fetch_all(&pool)
            .await
            .unwrap();
        let stellen_zeilen: Vec<(
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
            String,
            String,
        )> = sqlx::query_as(
            "SELECT bezeichnung, standort, notiz, kapazitaet_personen, art, status \
                 FROM betreuungsstelle WHERE einsatz_id = ? ORDER BY id",
        )
        .bind(e)
        .fetch_all(&pool)
        .await
        .unwrap();
        let mut bezeichnungen = std::collections::BTreeSet::new();
        for (bez, sammel, notiz, plan, erhebung, raeumung) in &bezirk_zeilen {
            assert!(
                bez.starts_with(super::repo::SCHWAERZUNG_PLATZHALTER),
                "Platzhalter-Bezeichnung: {bez:?}"
            );
            assert!(!bez.contains("Uferstraße") && !bez.contains("Deichweg"));
            assert_eq!((sammel, notiz), (&None, &None), "Freitexte leer");
            assert!(*plan == 640 || *plan == 120, "Plangröße bleibt");
            assert_eq!(erhebung, "geschaetzt");
            assert_eq!(raeumung, "angeordnet");
            bezeichnungen.insert(bez.clone());
        }
        for (bez, standort, notiz, kap, art, status) in &stellen_zeilen {
            assert!(
                bez.starts_with(super::repo::SCHWAERZUNG_PLATZHALTER),
                "Platzhalter-Bezeichnung: {bez:?}"
            );
            assert!(!bez.contains("Ostring") && !bez.contains("Weserstadion"));
            assert_eq!((standort, notiz), (&None, &None), "Freitexte leer");
            assert_eq!(*kap, Some(150), "Kapazität bleibt");
            assert_eq!(art, "notunterkunft");
            assert_eq!(status, "in_betrieb");
        }
        assert_eq!(bezirk_zeilen.len(), 2);
        assert_eq!(stellen_zeilen.len(), 2);
        assert_eq!(bezeichnungen.len(), 2, "je Bezirk ein eigener Platzhalter");
        let koordinaten: Vec<(Option<f64>, Option<f64>)> = sqlx::query_as(
            "SELECT lat, lon FROM betreuungsstelle WHERE einsatz_id = ? ORDER BY id",
        )
        .bind(e)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            koordinaten,
            vec![(Some(51.93), Some(8.87)); 2],
            "Koordinate bleibt als Geo-Skelett (LFH-673)"
        );

        // Meldereihen unverändert: Anzahlen, Erhebung, Zeitpunkte, Zeiger
        let staende: Vec<(i64, String, String)> = sqlx::query_as(
            "SELECT evakuiert, erhebung, zeitpunkt_at FROM evakuierung_stand \
             WHERE einsatz_id = ? ORDER BY id",
        )
        .bind(e)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            staende,
            vec![
                (212, "gezaehlt".into(), "2026-01-01 09:30:00".into()),
                (212, "gezaehlt".into(), "2026-01-01 09:30:00".into()),
            ]
        );
        let belegungen: Vec<(i64, String)> = sqlx::query_as(
            "SELECT belegt, zeitpunkt_at FROM betreuungsstelle_belegung \
             WHERE einsatz_id = ? ORDER BY id",
        )
        .bind(e)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            belegungen,
            vec![
                (89, "2026-01-01 10:00:00".into()),
                (89, "2026-01-01 10:00:00".into()),
            ]
        );
        let uebersicht = crate::betreuung::repo::uebersicht(&pool, e).await.unwrap();
        assert!(uebersicht
            .bezirke
            .iter()
            .all(|b| b.stand.as_ref().map(|s| s.evakuiert) == Some(212)));
        assert!(uebersicht
            .stellen
            .iter()
            .all(|s| s.belegung.as_ref().map(|m| m.belegt) == Some(89)));
    }

    /// LFH-634, Spec-Szenario „Einsatz schwärzen“: Ort und Bemerkung der Ausgabe leer; Menge,
    /// Sonderkost, Zeitpunkt, Nachforderungsverweis und das Zeitfenster samt Bezeichnung und
    /// Bedarf unverändert.
    #[tokio::test]
    async fn schwaerzung_verpflegung_leert_ort_und_bemerkung_und_haelt_mengen() {
        use crate::verpflegung::repo as v;
        use crate::verpflegung::SonderkostEingabe;

        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let nutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Leit','leit','h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, \
                retention_bis, geloescht_at) \
             VALUES (1,'Hochwasser','abgeschlossen','2026-01-01 00:00:00', ?, \
                '2026-02-01 00:00:00','2026-02-15 00:00:00') RETURNING id",
        )
        .bind(nutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        let nachforderung: i64 = sqlx::query_scalar(
            "INSERT INTO nachforderung (einsatz_id, art, bezeichnung, anzahl, adressat_kategorie, \
                angefordert_at, erstellt_von_id) \
             VALUES (?, 'Verpflegung', 'Verpflegung 60 EP', 60, 'leitstelle', \
                '2026-01-01 09:00:00', ?) RETURNING id",
        )
        .bind(e)
        .bind(nutzer)
        .fetch_one(&pool)
        .await
        .unwrap();
        let sonderkost = SonderkostEingabe {
            diaet_allergenarm: Some(1),
            ..SonderkostEingabe::default()
        };

        let mut tx = pool.begin().await.unwrap();
        let zf = v::zeitfenster_anlegen_tx(
            &mut tx,
            e,
            nutzer,
            1,
            crate::einsatz::nummer::ZEITZONE_VORGABE,
            &v::ZeitfensterEingabe {
                bezeichnung: "Mittag".into(),
                von_at: "2026-01-01 10:00:00".into(),
                bis_at: "2026-01-01 11:30:00".into(),
                bedarf_kraefte: 180,
                bedarf_betreute: 70,
                bedarf_weitere: 0,
                sonderkost,
            },
        )
        .await
        .unwrap();
        v::ausgabe_erfassen_tx(
            &mut tx,
            e,
            zf.id,
            nutzer,
            &v::AusgabeEingabe {
                zeitpunkt_at: "2026-01-01 10:40:00".into(),
                menge: 60,
                ort: Some("Hof Familie Meyer, Deichstraße 4".into()),
                bemerkung: Some("für Frau Meyer glutenfrei".into()),
                sonderkost,
                nachforderung_id: Some(nachforderung),
                client_id: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let vorher = v::zeitfenster_laden(&pool, e, zf.id).await.unwrap();

        assert!(
            super::repo::schwaerze_einsatz(&pool, e, "2026-06-01 12:00:00")
                .await
                .unwrap()
        );

        let nachher = v::zeitfenster_laden(&pool, e, zf.id).await.unwrap();
        let a = &nachher.ausgaben[0];
        assert_eq!((a.ort.as_deref(), a.bemerkung.as_deref()), (None, None));
        assert_eq!(a.menge, 60);
        assert_eq!(a.sonderkost.diaet_allergenarm, 1);
        assert_eq!(a.zeitpunkt_at, "2026-01-01 10:40:00");
        assert_eq!(a.nachforderung_id, Some(nachforderung), "Verweis bleibt");
        // Das Zeitfenster samt Deckung ist unverändert — bis auf die geleerten Freitexte.
        let mut erwartet = vorher.clone();
        erwartet.ausgaben[0].ort = None;
        erwartet.ausgaben[0].bemerkung = None;
        assert_eq!(nachher, erwartet);
        assert_eq!(nachher.bezeichnung, "Mittag");
        assert_eq!(nachher.bedarf.gesamt, 250);
    }

    /// LFH-554, Spec-Szenarien „Schwärzung“ von Presse-Log und Informationstelefon:
    /// Ansprechperson, Erreichbarkeit, Anrufername und Notiz leer, eine gesetzte Rückrufnummer
    /// ersetzt (ein CHECK verlangt sie bei offenem Rückruf); Medium, Thema, Antwort, Anliegen und
    /// Status bleiben. Ein offener Rückruf bricht die Schwärzung nicht.
    #[tokio::test]
    async fn schwaerzung_presse_und_infotelefon_leert_personenbezug_und_haelt_nachweis() {
        use crate::infotelefon::repo as tel;
        use crate::infotelefon::{InfotelefonAnliegen, InfotelefonStatus};
        use crate::presse::repo as presse;
        use crate::presse::{MedienkontaktArt, MedienkontaktStatus};

        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let nutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Leit','leit','h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, \
                retention_bis, geloescht_at) \
             VALUES (1,'Hochwasser','abgeschlossen','2026-01-01 00:00:00', ?, \
                '2026-02-01 00:00:00','2026-02-15 00:00:00') RETURNING id",
        )
        .bind(nutzer)
        .fetch_one(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        let kontakt = presse::anlegen_tx(
            &mut tx,
            e,
            nutzer,
            &presse::KontaktEingabe {
                art: MedienkontaktArt::Anfrage,
                medium: "NDR 1".into(),
                thema: "Zahl der Evakuierten".into(),
                kontakt_name: Some("Maria Beispiel".into()),
                kontakt_erreichbarkeit: Some("+49 511 1234567".into()),
                eingang_at: "2026-01-01 10:00:00".into(),
            },
        )
        .await
        .unwrap();
        presse::status_tx(
            &mut tx,
            e,
            kontakt,
            nutzer,
            &presse::StatusWechsel {
                ziel: MedienkontaktStatus::Beantwortet,
                antwort: Some("240 Personen".into()),
                freigabe_durch: Some("EL".into()),
                pressemitteilung_id: None,
            },
        )
        .await
        .unwrap();
        let mut anrufe = Vec::new();
        for (noetig, nummer) in [(true, Some("0171 7654321")), (false, None)] {
            anrufe.push(
                tel::anlegen_tx(
                    &mut tx,
                    e,
                    nutzer,
                    &tel::AnrufEingabe {
                        anliegen: InfotelefonAnliegen::Vermisstensuche,
                        notiz: Some("sucht Vater, Deichstraße 4".into()),
                        anrufer_name: Some("Klaus Meyer".into()),
                        rueckruf: nummer.map(str::to_string),
                        rueckruf_noetig: noetig,
                        eingang_at: "2026-01-01 11:00:00".into(),
                    },
                )
                .await
                .unwrap(),
            );
        }
        tx.commit().await.unwrap();

        assert!(
            super::repo::schwaerze_einsatz(&pool, e, "2026-06-01 12:00:00")
                .await
                .unwrap()
        );

        let k = presse::laden(&pool, e, kontakt).await.unwrap();
        assert_eq!((k.kontakt_name, k.kontakt_erreichbarkeit), (None, None));
        assert_eq!(
            (k.medium.as_str(), k.thema.as_str(), k.antwort.as_deref()),
            ("NDR 1", "Zahl der Evakuierten", Some("240 Personen"))
        );
        assert_eq!(k.status, MedienkontaktStatus::Beantwortet);

        let offen = tel::laden(&pool, e, anrufe[0]).await.unwrap();
        assert_eq!((offen.anrufer_name, offen.notiz), (None, None));
        assert_ne!(offen.rueckruf.as_deref(), Some("0171 7654321"));
        assert!(offen.rueckruf.is_some(), "Platzhalter statt NULL");
        assert_eq!(offen.status, InfotelefonStatus::Offen);
        assert_eq!(offen.anliegen, InfotelefonAnliegen::Vermisstensuche);
        let ohne = tel::laden(&pool, e, anrufe[1]).await.unwrap();
        assert_eq!(ohne.rueckruf, None, "eine leere Nummer bleibt leer");
    }

    #[tokio::test]
    async fn soft_geloescht_vor_karenz_wird_nicht_geschwaerzt() {
        // Phase B greift erst nach KARENZ_TAGE. Direkt nach dem Soft-Delete (gleicher
        // Tick-Tag) darf nicht geschwärzt werden.
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        // Soft-Delete.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            1
        );
        // Wenige Tage später (< KARENZ_TAGE): noch keine Schwärzung.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-10 12:00:00")).await,
            0
        );
        let s: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s, None, "vor Ablauf der Karenz nicht geschwärzt");
    }

    // ---------- LFH-906: Karenz-Beginn ab Fristablauf ----------

    /// Setzt den Zeitpunkt, zu dem die Frist gesetzt wurde (sonst NULL = unbekannt).
    async fn frist_gesetzt_am(pool: &SqlitePool, id: i64, gesetzt_at: &str) {
        sqlx::query("UPDATE einsatz SET retention_gesetzt_at = ? WHERE id = ?")
            .bind(gesetzt_at)
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn tombstones(pool: &SqlitePool, id: i64) -> (Option<String>, Option<String>) {
        sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn vormerkungs_audit(pool: &SqlitePool, id: i64) -> String {
        sqlx::query_scalar(
            "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
             AND inhalt LIKE 'Aufbewahrungsfrist abgelaufen%'",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Spec `aufbewahrung`, „Erster Lauf lange nach dem Fristablauf“: die beim Abschluss gesetzte
    /// Frist lief am 01.06. ab, der erste Lauf kommt zehn Tage später (Stillstand). Die Karenz
    /// rechnet ab dem 01.06., nicht ab dem Lauf.
    #[tokio::test]
    async fn erster_lauf_lange_nach_fristablauf_rechnet_karenz_ab_fristablauf() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        frist_gesetzt_am(&pool, id, "2026-01-01 00:00:00").await;

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-11 12:00:00")).await,
            1
        );
        assert_eq!(
            tombstones(&pool, id).await,
            (Some("2026-06-01 00:00:00".into()), None),
            "vorgemerkt mit dem Fristablauf als Karenz-Beginn"
        );
        let audit = vormerkungs_audit(&pool, id).await;
        assert!(audit.contains("seit 2026-06-01 00:00:00"), "{audit}");

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-30 23:59:59")).await,
            0,
            "Karenz läuft bis 30 Tage nach dem Fristablauf"
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-07-01 00:00:00")).await,
            1
        );
        assert_eq!(
            tombstones(&pool, id).await.1.as_deref(),
            Some("2026-07-01 00:00:00")
        );
    }

    /// Fällt der Lauf genau auf den Fristablauf, ist der Karenz-Beginn der Lauf selbst, und der
    /// ETB-Eintrag nennt keinen früheren Zeitpunkt. Jeder spätere Lauf nennt ihn („seit …“).
    #[tokio::test]
    async fn lauf_zur_fristablauf_minute_merkt_ohne_verschiebung_vor() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        frist_gesetzt_am(&pool, id, "2026-01-01 00:00:00").await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-01 00:00:00")).await,
            1
        );
        assert_eq!(
            tombstones(&pool, id).await.0.as_deref(),
            Some("2026-06-01 00:00:00")
        );
        let audit = vormerkungs_audit(&pool, id).await;
        assert!(
            !audit.contains("seit"),
            "kein Karenz-Beginn vor dem Lauf: {audit}"
        );
    }

    /// Spec `aufbewahrung`, „Frist in die Vergangenheit verkürzt“: die Frist wurde am 01.06. auf
    /// einen Zeitpunkt 60 Tage davor gesetzt. Die Karenz beginnt mit dem Setzen und hält volle
    /// 30 Tage.
    #[tokio::test]
    async fn frist_in_die_vergangenheit_behaelt_volle_karenz_ab_dem_setzen() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-04-02 12:00:00").await;
        frist_gesetzt_am(&pool, id, "2026-06-01 12:00:00").await;

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-01 12:10:00")).await,
            1
        );
        assert_eq!(
            tombstones(&pool, id).await,
            (Some("2026-06-01 12:00:00".into()), None)
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-07-01 11:59:59")).await,
            0
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-07-01 12:00:00")).await,
            1
        );
    }

    /// Spec `aufbewahrung`, „Vormerkung mit schon abgelaufener Karenz“: Frist seit 40 Tagen
    /// abgelaufen, ein Lauf merkt vor und schwärzt.
    #[tokio::test]
    async fn vormerkung_mit_abgelaufener_karenz_schwaerzt_im_selben_lauf() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-05-01 00:00:00").await;
        frist_gesetzt_am(&pool, id, "2026-01-01 00:00:00").await;

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-10 00:00:00")).await,
            2,
            "Vormerkung und Schwärzung"
        );
        assert_eq!(
            tombstones(&pool, id).await,
            (
                Some("2026-05-01 00:00:00".into()),
                Some("2026-06-10 00:00:00".into())
            )
        );
    }

    /// Ist nicht bekannt, wann die Frist gesetzt wurde (NULL), gilt wie bisher der Lauf selbst.
    #[tokio::test]
    async fn unbekannter_setzzeitpunkt_beginnt_karenz_beim_lauf() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-05-01 00:00:00").await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-10 00:00:00")).await,
            1
        );
        assert_eq!(
            tombstones(&pool, id).await,
            (Some("2026-06-10 00:00:00".into()), None)
        );
    }

    // ---------- LFH-23: Audit ohne stilles Auslassen ----------

    /// Abgeschlossener Einsatz OHNE jeden Akteur: kein `abgeschlossen_von`, keine
    /// Einsatzleitung, kein Admin in der Org. Org 1 trägt nur einen Nicht-Admin.
    async fn ohne_akteur(
        pool: &SqlitePool,
        retention_bis: &str,
        geloescht_at: Option<&str>,
    ) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1,'Helfer','helfer','h')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, retention_bis, \
                geloescht_at, einsatzort) \
             VALUES (1,'Lage','abgeschlossen','2026-01-01 00:00:00', ?, ?, 'Hauptstr 1') RETURNING id",
        )
        .bind(retention_bis)
        .bind(geloescht_at)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn org_admin_anlegen(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1,'Admin','orgadmin','h','admin') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn etb_erfasser(pool: &SqlitePool, e: i64) -> Vec<i64> {
        sqlx::query_scalar(
            "SELECT erfasser_id FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr",
        )
        .bind(e)
        .fetch_all(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn phase_a_ohne_akteur_merkt_nicht_vor_und_holt_es_mit_admin_nach() {
        let pool = crate::db::test_pool().await;
        let e = ohne_akteur(&pool, "2026-06-01 00:00:00", None).await;

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            0
        );
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g, None, "ohne Audit keine Vormerkung");
        assert!(etb_erfasser(&pool, e).await.is_empty(), "kein ETB-Eintrag");
        // Sichtbar ist die Blockade nur im Log — die Meldung nennt deshalb Einsatz UND Org.
        let fehler = repo::soft_delete_einsatz(&pool, e, "2026-06-02 12:05:00")
            .await
            .unwrap_err()
            .to_string();
        assert!(fehler.contains(&format!("Einsatz {e} (Org 1)")), "{fehler}");

        let admin = org_admin_anlegen(&pool).await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:10:00")).await,
            1
        );
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g.as_deref(), Some("2026-06-02 12:10:00"));
        assert_eq!(
            etb_erfasser(&pool, e).await,
            vec![admin],
            "Audit trägt den Admin"
        );
    }

    #[tokio::test]
    async fn phase_b_ohne_akteur_schwaerzt_nicht_und_holt_es_mit_admin_nach() {
        let pool = crate::db::test_pool().await;
        let e = ohne_akteur(&pool, "2026-02-01 00:00:00", Some("2026-02-15 00:00:00")).await;

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-01 12:00:00")).await,
            0
        );
        let (s, ort): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT geschwaerzt_at, einsatzort FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s, None, "ohne Audit keine Schwärzung");
        assert_eq!(
            ort.as_deref(),
            Some("Hauptstr 1"),
            "PII unverändert (Rollback)"
        );
        assert!(etb_erfasser(&pool, e).await.is_empty());

        let admin = org_admin_anlegen(&pool).await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-01 12:10:00")).await,
            1
        );
        let (s, ort): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT geschwaerzt_at, einsatzort FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s.as_deref(), Some("2026-06-01 12:10:00"));
        assert_eq!(ort, None);
        assert_eq!(etb_erfasser(&pool, e).await, vec![admin]);
    }

    // ---------- LFH-749: Phasen K1/K2 (Datenkategorien) ----------

    async fn kategorie_mit_frist(pool: &SqlitePool, e: i64, k: &str, frist: &str) {
        sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage) VALUES (?, ?, ?, 'RG')",
        )
        .bind(e)
        .bind(k)
        .bind(frist)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn kategorie_tombstones(
        pool: &SqlitePool,
        e: i64,
        k: &str,
    ) -> (Option<String>, Option<String>) {
        sqlx::query_as(
            "SELECT vorgemerkt_at, geschwaerzt_at FROM einsatz_aufbewahrung_kategorie \
             WHERE einsatz_id = ? AND kategorie = ?",
        )
        .bind(e)
        .bind(k)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn adresse_und_name(pool: &SqlitePool, e: i64) -> (Option<String>, Option<String>) {
        sqlx::query_as("SELECT herkunft_adresse, name FROM einsatz_person WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn person_mit_adresse(pool: &SqlitePool, e: i64) {
        let von: i64 = sqlx::query_scalar("SELECT abgeschlossen_von FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, \
                herkunft_adresse, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', 'Mustermann', 'Hauptstr. 5', ?, ?)",
        )
        .bind(e)
        .bind(von)
        .bind(von)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Spec `aufbewahrung-kategorien`, „Fällig“ und „Kategorie-Schwärzung“ über den Tick: Frist
    /// abgelaufen → vorgemerkt (Einsatz bleibt unberührt), 29 Tage später nichts, 30 Tage später
    /// geschwärzt samt Live-Meldung.
    #[tokio::test]
    async fn kategorie_ablauf_ueber_den_tick() {
        let pool = crate::db::test_pool().await;
        let e = abgeschlossen_mit_frist(&pool, "2099-01-01 00:00:00").await;
        person_mit_adresse(&pool, e).await;
        kategorie_mit_frist(&pool, e, "personenauskunft", "2026-06-01 00:00:00").await;
        let live = LiveHub::new();
        let mut rx = live.abonniere(e);

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-01 00:00:00")).await, 1);
        let (v, g) = kategorie_tombstones(&pool, e, "personenauskunft").await;
        assert_eq!(v.as_deref(), Some("2026-06-01 00:00:00"));
        assert_eq!(g, None);
        let geloescht: Option<String> =
            sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(geloescht, None, "der Einsatz bleibt unberührt");

        assert_eq!(tick_einmal(&pool, &live, t("2026-06-30 00:00:00")).await, 0);
        assert_eq!(
            adresse_und_name(&pool, e).await.0.as_deref(),
            Some("Hauptstr. 5")
        );

        while rx.try_recv().is_ok() {}
        assert_eq!(tick_einmal(&pool, &live, t("2026-07-01 00:00:00")).await, 1);
        assert_eq!(
            kategorie_tombstones(&pool, e, "personenauskunft")
                .await
                .1
                .as_deref(),
            Some("2026-07-01 00:00:00")
        );
        assert_eq!(
            adresse_und_name(&pool, e).await,
            (None, None),
            "nur registriert: Stamm mit"
        );
        let mut events = Vec::new();
        while let Ok(n) = rx.try_recv() {
            events.push(n.event);
        }
        assert!(events.contains(&LiveEvent::Person), "{events:?}");
        assert!(events.contains(&LiveEvent::Dokument), "{events:?}");
    }

    /// Spec „Gesperrter Einsatz“: eine Kategorie mit abgelaufener Karenz wird auch an einem
    /// vorgemerkten Einsatz geschwärzt; dessen Vormerkung bleibt.
    #[tokio::test]
    async fn kategorie_an_gesperrtem_einsatz() {
        let pool = crate::db::test_pool().await;
        let e = abgeschlossen_mit_frist(&pool, "2026-06-20 00:00:00").await;
        person_mit_adresse(&pool, e).await;
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-06-20 00:00:00' WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        kategorie_mit_frist(&pool, e, "personenauskunft", "2026-05-01 00:00:00").await;
        sqlx::query(
            "UPDATE einsatz_aufbewahrung_kategorie SET vorgemerkt_at = '2026-05-01 00:00:00' \
             WHERE einsatz_id = ?",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-30 12:00:00")).await,
            1
        );
        assert!(kategorie_tombstones(&pool, e, "personenauskunft")
            .await
            .1
            .is_some());
        assert_eq!(adresse_und_name(&pool, e).await.0, None);
        let (geloescht, geschwaerzt): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(geloescht.as_deref(), Some("2026-06-20 00:00:00"));
        assert_eq!(geschwaerzt, None);
    }

    /// Spec „Zusammenspiel mit der Einsatz-Frist“: auch die Vormerkung (K1) läuft an einem
    /// gesperrten Einsatz; dessen Vormerkung bleibt unverändert.
    #[tokio::test]
    async fn kategorie_vormerkung_an_gesperrtem_einsatz() {
        let pool = crate::db::test_pool().await;
        let e = abgeschlossen_mit_frist(&pool, "2026-06-20 00:00:00").await;
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-06-20 00:00:00' WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        kategorie_mit_frist(&pool, e, "anhaenge", "2026-06-25 00:00:00").await;

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-30 12:00:00")).await,
            1
        );
        let (v, g) = kategorie_tombstones(&pool, e, "anhaenge").await;
        assert_eq!(v.as_deref(), Some("2026-06-30 12:00:00"));
        assert_eq!(g, None);
        let geloescht: Option<String> =
            sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(geloescht.as_deref(), Some("2026-06-20 00:00:00"));
        let etb: Vec<String> =
            sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(e)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(
            etb.iter().any(|x| x.contains("„Anhänge“ abgelaufen")),
            "{etb:?}"
        );
    }

    /// Spec „Einsatz-Frist kürzer als Kategorie-Frist“: die Einsatz-Schwärzung nimmt die
    /// Kategorie mit und setzt ihren Tombstone.
    #[tokio::test]
    async fn einsatz_schwaerzung_setzt_kategorie_tombstones() {
        let pool = crate::db::test_pool().await;
        let e = abgeschlossen_mit_frist(&pool, "2026-05-01 00:00:00").await;
        kategorie_mit_frist(&pool, e, "behandlung", "2099-01-01 00:00:00").await;
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-05-01 00:00:00' WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-30 12:00:00")).await,
            1
        );
        let (v, g) = kategorie_tombstones(&pool, e, "behandlung").await;
        assert_eq!(v, None);
        assert_eq!(g.as_deref(), Some("2026-06-30 12:00:00"));
    }

    /// LFH-23, Anforderung „Karenz“: Phase B liest `retention_bis` nicht. Ein vorgemerkter
    /// Einsatz, dessen Frist direkt in der DB verlängert wurde, wird nach der Karenz trotzdem
    /// geschwärzt — maßgeblich ist allein `geloescht_at`.
    #[tokio::test]
    async fn karenz_ignoriert_verlaengerte_frist() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-06-02 12:00:00")).await,
            1
        );
        sqlx::query("UPDATE einsatz SET retention_bis = '2099-01-01 00:00:00' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-07-02 12:00:00")).await,
            1
        );
        let s: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s.as_deref(), Some("2026-07-02 12:00:00"));
    }

    // ---------- LFH-725: physische Entfernung ----------

    const NAME_KLARTEXT: &str = "LFH725-Gepflanzter-Name";
    const ANHANG_KLARTEXT: &[u8] = b"LFH725-GEPFLANZTER-ANHANG";

    // ---------- LFH-751: Schwärzungsanträge im Purge-Lauf ----------

    use crate::aufbewahrung::antrag::{self as antrag, AntragZiel};
    use crate::einsatz::schwaerzung_person::{testdaten, PersonenArt};

    async fn antrag_r001(pool: &SqlitePool, b: &testdaten::Bestand, jetzt: &str) -> i64 {
        antrag::stellen(
            pool,
            b.e1,
            b.admin,
            b.org_id,
            AntragZiel::Person(PersonenArt::Betroffene, b.p1),
            "DS-2026-014",
            "R-001",
            t(jetzt),
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn antrag_23h_nichts_24h_vollzogen_zweiter_lauf_nichts() {
        let pool = crate::db::test_pool().await;
        let b = testdaten::anlegen(&pool).await;
        antrag_r001(&pool, &b, "2026-10-02 08:00:00").await;
        let live = LiveHub::new();
        assert_eq!(tick_einmal(&pool, &live, t("2026-10-03 07:59:59")).await, 0);
        assert!(testdaten::alle_texte(&pool).await.contains("Yilmaz"));
        assert_eq!(tick_einmal(&pool, &live, t("2026-10-03 08:00:00")).await, 1);
        assert!(!testdaten::alle_texte(&pool).await.contains("Yilmaz"));
        assert_eq!(tick_einmal(&pool, &live, t("2026-10-03 08:10:00")).await, 0);
    }

    #[tokio::test]
    async fn ruecknahme_verhindert_vollzug_im_purge_lauf() {
        let pool = crate::db::test_pool().await;
        let b = testdaten::anlegen(&pool).await;
        let a = antrag_r001(&pool, &b, "2026-10-02 08:00:00").await;
        antrag::zuruecknehmen(&pool, b.e1, a, b.admin, t("2026-10-02 11:00:00"))
            .await
            .unwrap();
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-10-04 08:00:00")).await,
            0
        );
        assert!(testdaten::alle_texte(&pool).await.contains("Yilmaz"));
    }

    /// Ein Einsatz-Antrag schwärzt auch während der laufenden 30-Tage-Karenz.
    #[tokio::test]
    async fn einsatz_antrag_waehrend_der_karenz() {
        let pool = crate::db::test_pool().await;
        let b = testdaten::anlegen(&pool).await;
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-09-29 08:00:00' WHERE id = ?")
            .bind(b.e1)
            .execute(&pool)
            .await
            .unwrap();
        antrag::stellen(
            &pool,
            b.e1,
            b.admin,
            b.org_id,
            AntragZiel::Einsatz,
            "DS-2026-015",
            "E-2026-0751",
            t("2026-10-02 08:00:00"),
        )
        .await
        .unwrap();
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-10-03 08:00:00")).await,
            1
        );
        let (g, s): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(b.e1)
                .fetch_one(&pool)
                .await
                .unwrap();
        // Die frühere Vormerkung bleibt der Zeitpunkt der Vormerkung.
        assert_eq!(g.as_deref(), Some("2026-09-29 08:00:00"));
        assert_eq!(s.as_deref(), Some("2026-10-03 08:00:00"));
    }

    /// Wie `schwaerzung_hinterlaesst_keine_altbytes`, für den Vollzug eines Personen-Antrags:
    /// der Klartext der Person steht weder in der Datei noch im WAL, der der Nachbarperson
    /// steht weiter in der Datenbank.
    #[tokio::test]
    async fn personen_vollzug_hinterlaesst_keine_altbytes() {
        let (_dir, pfad, pool) = produktions_pool().await;
        let b = testdaten::anlegen(&pool).await;
        antrag_r001(&pool, &b, "2026-10-02 08:00:00").await;
        assert!(crate::db::datei_oder_wal_enthaelt(&pfad, b"Gartenweg 7"));
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-10-03 08:00:00")).await,
            1
        );
        for k in ["Yilmaz", "Gartenweg 7", "Hund-Chip-276", "0171 2345678"] {
            assert!(
                !crate::db::datei_oder_wal_enthaelt(&pfad, k.as_bytes()),
                "{k} steht noch in DB-Datei oder WAL"
            );
        }
        assert!(testdaten::alle_texte(&pool).await.contains("Mustermann"));
    }

    /// Pool mit den Produktionsoptionen (`db::connect`) auf einer Datei — nur dort gibt es eine
    /// Hauptdatei und einen WAL, in denen Altbytes stehen bleiben können.
    async fn produktions_pool() -> (tempfile::TempDir, std::path::PathBuf, SqlitePool) {
        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("prod.db");
        let pool = crate::db::connect(pfad.to_str().unwrap()).await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        (dir, pfad, pool)
    }

    /// Vorgemerkter Einsatz, Karenz zum Zeitpunkt `2026-03-01` abgelaufen, mit dem Klartext in
    /// einer Scrub-Spalte (Personenname) und in einem Anhang, der über mehrere Seiten reicht
    /// (Overflow-Seiten — genau die lässt `secure_delete = FAST` stehen).
    async fn faelliger_einsatz_mit_klartext(pool: &SqlitePool) -> i64 {
        let e = abgeschlossen_mit_frist(pool, "2026-01-01 00:00:00").await;
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-01-02 00:00:00' WHERE id = ?")
            .bind(e)
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'l'")
            .fetch_one(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?, ?)",
        )
        .bind(e)
        .bind(NAME_KLARTEXT)
        .bind(b)
        .bind(b)
        .execute(pool)
        .await
        .unwrap();
        let daten = ANHANG_KLARTEXT.repeat(1000);
        sqlx::query(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
             VALUES (?, 'foto.jpg', 'image/jpeg', ?, 'x', ?, ?)",
        )
        .bind(e)
        .bind(daten.len() as i64)
        .bind(&daten)
        .bind(b)
        .execute(pool)
        .await
        .unwrap();
        e
    }

    fn enthaelt_klartext(pfad: &std::path::Path) -> bool {
        crate::db::datei_oder_wal_enthaelt(pfad, NAME_KLARTEXT.as_bytes())
            || crate::db::datei_oder_wal_enthaelt(pfad, ANHANG_KLARTEXT)
    }

    /// Spec `aufbewahrung`, „Physische Entfernung geschwärzter Werte“: nach dem Purge-Lauf steht
    /// der gepflanzte Klartext weder in der DB-Datei noch im WAL. Mutationsproben: ohne
    /// `secure_delete` in `db::connect`, mit `FAST` oder ohne den Rückschrieb wird dieser Test rot.
    #[tokio::test]
    async fn schwaerzung_hinterlaesst_keine_altbytes() {
        let (_dir, pfad, pool) = produktions_pool().await;
        let e = faelliger_einsatz_mit_klartext(&pool).await;
        assert!(
            enthaelt_klartext(&pfad),
            "Vorbedingung: Klartext liegt in der Datei"
        );

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-01 12:00:00")).await,
            1
        );

        let s: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(s.is_some(), "Einsatz geschwärzt");
        assert!(
            !crate::db::datei_oder_wal_enthaelt(&pfad, NAME_KLARTEXT.as_bytes()),
            "Name aus der Scrub-Spalte steht noch in DB-Datei oder WAL"
        );
        assert!(
            !crate::db::datei_oder_wal_enthaelt(&pfad, ANHANG_KLARTEXT),
            "Anhang-Bytes stehen noch in DB-Datei oder WAL"
        );
    }

    /// LFH-749, Spec `aufbewahrung-kategorien`, „Klartext ist physisch weg“: dasselbe für eine
    /// Kategorie-Schwärzung an einem lesbaren Einsatz — Klartext in `herkunft_adresse`
    /// (`personenauskunft`) und in einem Anhang (`anhaenge`), beide mit abgelaufener Karenz.
    #[tokio::test]
    async fn kategorie_schwaerzung_hinterlaesst_keine_altbytes() {
        let (_dir, pfad, pool) = produktions_pool().await;
        let e = abgeschlossen_mit_frist(&pool, "2099-01-01 00:00:00").await;
        let b: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'l'")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, herkunft_adresse, \
                erfasst_von, geaendert_von) VALUES (?, 1, 'betroffen', ?, ?, ?)",
        )
        .bind(e)
        .bind(NAME_KLARTEXT)
        .bind(b)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        let daten = ANHANG_KLARTEXT.repeat(1000);
        sqlx::query(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
             VALUES (?, 'foto.jpg', 'image/jpeg', ?, 'x', ?, ?)",
        )
        .bind(e)
        .bind(daten.len() as i64)
        .bind(&daten)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        for k in ["personenauskunft", "anhaenge"] {
            kategorie_mit_frist(&pool, e, k, "2026-01-01 00:00:00").await;
        }
        sqlx::query(
            "UPDATE einsatz_aufbewahrung_kategorie SET vorgemerkt_at = '2026-01-02 00:00:00' \
             WHERE einsatz_id = ?",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            enthaelt_klartext(&pfad),
            "Vorbedingung: Klartext liegt in der Datei"
        );

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-01 12:00:00")).await,
            2
        );
        assert!(
            !crate::db::datei_oder_wal_enthaelt(&pfad, NAME_KLARTEXT.as_bytes()),
            "Adresse aus der Kategorie-Spalte steht noch in DB-Datei oder WAL"
        );
        assert!(
            !crate::db::datei_oder_wal_enthaelt(&pfad, ANHANG_KLARTEXT),
            "Anhang-Bytes stehen noch in DB-Datei oder WAL"
        );
        let geschwaerzt: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(geschwaerzt, None, "der Einsatz selbst ist nicht geschwärzt");
    }

    /// Spec `aufbewahrung`, Szenario „Rückschrieb blockiert“: ein Lesender mit älterem Stand
    /// hält den Rückschrieb auf (der Klartext steht noch in der Hauptdatei); der nächste Tick
    /// holt ihn nach. Wartet einmal `busy_timeout` (5 s).
    #[tokio::test]
    async fn blockierter_rueckschrieb_wird_im_naechsten_tick_nachgeholt() {
        let (_dir, pfad, pool) = produktions_pool().await;
        faelliger_einsatz_mit_klartext(&pool).await;

        let mut leser = pool.acquire().await.unwrap();
        sqlx::query("BEGIN").execute(&mut *leser).await.unwrap();
        sqlx::query("SELECT count(*) FROM einsatz")
            .execute(&mut *leser)
            .await
            .unwrap();

        let mut ausstehend = false;
        assert_eq!(
            tick_mit_rueckschrieb(
                &pool,
                &LiveHub::new(),
                t("2026-03-01 12:00:00"),
                &mut ausstehend
            )
            .await,
            1
        );
        assert!(ausstehend, "blockierter Rückschrieb bleibt vorgemerkt");
        assert!(
            enthaelt_klartext(&pfad),
            "ohne Rückschrieb steht der Vorzustand noch da"
        );

        sqlx::query("COMMIT").execute(&mut *leser).await.unwrap();
        drop(leser);

        assert_eq!(
            tick_mit_rueckschrieb(
                &pool,
                &LiveHub::new(),
                t("2026-03-01 12:10:00"),
                &mut ausstehend
            )
            .await,
            0,
            "nichts Neues zu schwärzen"
        );
        assert!(!ausstehend);
        assert!(!enthaelt_klartext(&pfad));
    }

    /// Spec `aufbewahrung`, „Rückspielen einer Sicherung von vor der Schwärzung“: die Sicherung
    /// trägt den vorgemerkten Einsatz ungeschwärzt; nach dem Restore schwärzt der nächste
    /// Purge-Lauf ihn erneut, und die Vormerkung aus der Sicherung gilt weiter.
    #[tokio::test]
    async fn restore_von_vor_der_schwaerzung_wird_erneut_geschwaerzt() {
        let (dir, pfad, pool) = produktions_pool().await;
        let e = faelliger_einsatz_mit_klartext(&pool).await;
        let sicherung = dir.path().join("vorher.sqlite");
        crate::backup::erzeuge_sicherung(&pool, &sicherung)
            .await
            .unwrap();
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-01 12:00:00")).await,
            1
        );
        pool.close().await;

        crate::backup::restore::restore_aus_datei(&sicherung, &pfad, true)
            .await
            .unwrap();
        let pool = crate::db::connect(pfad.to_str().unwrap()).await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        let geschwaerzt = |pool: SqlitePool| async move {
            sqlx::query_as::<_, (Option<String>, Option<String>)>(
                "SELECT geschwaerzt_at, geloescht_at FROM einsatz WHERE id = ?",
            )
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        assert_eq!(
            geschwaerzt(pool.clone()).await,
            (None, Some("2026-01-02 00:00:00".to_string())),
            "Vorbedingung: die Sicherung trägt den Einsatz ungeschwärzt"
        );

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-01 12:10:00")).await,
            1
        );
        assert_eq!(
            geschwaerzt(pool.clone()).await,
            (
                Some("2026-03-01 12:10:00".to_string()),
                Some("2026-01-02 00:00:00".to_string())
            ),
            "erneut geschwärzt, Vormerkung aus der Sicherung unverändert"
        );
        assert!(!enthaelt_klartext(&pfad));
    }

    /// Spec `aufbewahrung`, „Restore von vor der Vormerkung, Karenz abgelaufen“ (LFH-906): die
    /// Sicherung stammt aus der Zeit vor der Vormerkung. Im ursprünglichen Verlauf ist der Einsatz
    /// am 31.01. geschwärzt; nach dem Restore am 01.03. schwärzt der nächste Lauf ihn sofort,
    /// statt die Karenz neu zu beginnen.
    #[tokio::test]
    async fn restore_von_vor_der_vormerkung_rechnet_karenz_ab_fristablauf() {
        let (dir, pfad, pool) = produktions_pool().await;
        let e = faelliger_einsatz_mit_klartext(&pool).await;
        // Stand der Sicherung: Frist beim Abschluss gesetzt, noch nicht vorgemerkt.
        sqlx::query(
            "UPDATE einsatz SET geloescht_at = NULL, retention_gesetzt_at = '2025-12-01 00:00:00' \
             WHERE id = ?",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        let sicherung = dir.path().join("vor_der_vormerkung.sqlite");
        crate::backup::erzeuge_sicherung(&pool, &sicherung)
            .await
            .unwrap();

        // Ursprünglicher Verlauf: Vormerkung zum Fristablauf, Schwärzung 30 Tage danach.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-01-01 00:10:00")).await,
            1
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-01-31 00:10:00")).await,
            1
        );
        pool.close().await;

        crate::backup::restore::restore_aus_datei(&sicherung, &pfad, true)
            .await
            .unwrap();
        let pool = crate::db::connect(pfad.to_str().unwrap()).await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        assert_eq!(
            tombstones(&pool, e).await,
            (None, None),
            "Vorbedingung: die Sicherung trägt den Einsatz weder vorgemerkt noch geschwärzt"
        );

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-01 12:00:00")).await,
            2,
            "Vormerkung und Schwärzung im selben Lauf"
        );
        assert_eq!(
            tombstones(&pool, e).await,
            (
                Some("2026-01-01 00:00:00".into()),
                Some("2026-03-01 12:00:00".into())
            ),
            "Karenz ab dem Fristablauf, nicht ab dem Restore"
        );
        assert!(!enthaelt_klartext(&pfad));
    }

    /// Spec `aufbewahrung`, „Rückspielen einer Sicherung von vor der Schwärzung“, Satz „auch wenn
    /// die Sicherung vor diesem Verhalten entstand“ (LFH-906): eine Datenbank auf dem Stand vor
    /// Migration 0149 (wie eine alte Sicherung) wird beim Start migriert, und der erste Lauf
    /// rechnet die Karenz ab dem Fristablauf.
    #[tokio::test]
    async fn sicherung_von_vor_dem_update_rechnet_karenz_ab_fristablauf() {
        use sqlx::migrate::Migrator;
        use std::borrow::Cow;

        let dir = tempfile::tempdir().unwrap();
        let pfad = dir.path().join("alt.db");
        let pool = crate::db::connect(pfad.to_str().unwrap()).await.unwrap();
        let alle: Vec<_> = sqlx::migrate!("./migrations").iter().cloned().collect();
        Migrator {
            migrations: Cow::Owned(alle.into_iter().filter(|m| m.version <= 148).collect()),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .expect("Migrationen bis 0148");
        let e = abgeschlossen_mit_frist(&pool, "2026-01-01 00:00:00").await;
        pool.close().await;

        let pool = crate::db::connect(pfad.to_str().unwrap()).await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-01 12:00:00")).await,
            2,
            "Vormerkung und Schwärzung im selben Lauf"
        );
        assert_eq!(
            tombstones(&pool, e).await,
            (
                Some("2026-01-01 00:00:00".into()),
                Some("2026-03-01 12:00:00".into())
            )
        );
    }

    /// Spec `aufbewahrung`, „Frist am aktiven Einsatz abgelaufen“ (LFH-906): die Frist lief am
    /// 10.01. ab, abgeschlossen wurde erst am 01.03. Die Karenz beginnt mit dem Abschluss, nicht
    /// mit dem Fristablauf; sonst schwärzte der erste Lauf nach dem Abschluss sofort.
    #[tokio::test]
    async fn frist_am_aktiven_einsatz_abgelaufen_karenz_ab_abschluss() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-01-10 00:00:00").await;
        frist_gesetzt_am(&pool, id, "2026-01-01 00:00:00").await;
        sqlx::query("UPDATE einsatz SET abgeschlossen_at = '2026-03-01 00:00:00' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-01 00:05:00")).await,
            1
        );
        assert_eq!(
            tombstones(&pool, id).await,
            (Some("2026-03-01 00:00:00".into()), None)
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-30 23:59:59")).await,
            0
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-03-31 00:00:00")).await,
            1
        );
    }

    /// Spec `aufbewahrung`, „Restore von vor der Vormerkung, Karenz läuft noch“ (LFH-906): der
    /// Stand nach einem Restore zehn Tage nach dem Fristablauf (Frist abgelaufen, nicht vorgemerkt,
    /// Setzzeitpunkt bekannt), ohne das Rückspielen selbst; das belegen die Tests daneben. Der
    /// Einsatz ist mit dem Fristablauf vorgemerkt, die
    /// Friständerung liefert 422, Wiederherstellen gelingt, und ohne es ist er 20 Tage später
    /// geschwärzt.
    #[tokio::test]
    async fn restore_von_vor_der_vormerkung_laesst_nur_die_restkarenz() {
        let pool = crate::db::test_pool().await;
        let e = abgeschlossen_mit_frist(&pool, "2026-01-01 00:00:00").await;
        frist_gesetzt_am(&pool, e, "2025-12-01 00:00:00").await;
        let b: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'l'")
            .fetch_one(&pool)
            .await
            .unwrap();
        let zweiter: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, \
                 retention_bis, retention_gesetzt_at) \
             VALUES (1, 'Lage 2', 'abgeschlossen', '2026-01-01 00:00:00', ?, \
                 '2026-01-01 00:00:00', '2025-12-01 00:00:00') RETURNING id",
        )
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-01-11 00:00:00")).await,
            2
        );
        for id in [e, zweiter] {
            assert_eq!(
                tombstones(&pool, id).await,
                (Some("2026-01-01 00:00:00".into()), None)
            );
        }

        let jetzt = t("2026-01-11 00:10:00");
        assert!(matches!(
            repo::frist_setzen(&pool, e, b, Some("2027-01-01 00:00:00"), "x", jetzt).await,
            Err(crate::error::AppError::UnprocessableEntity(_))
        ));
        repo::wiederherstellen(&pool, zweiter, b, 1, Some("2027-01-01 00:00:00"), jetzt)
            .await
            .expect("Wiederherstellen in der Restkarenz");
        assert_eq!(tombstones(&pool, zweiter).await, (None, None));

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-01-30 23:59:59")).await,
            0
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-01-31 00:00:00")).await,
            1
        );
        assert_eq!(
            tombstones(&pool, e).await.1.as_deref(),
            Some("2026-01-31 00:00:00")
        );
        assert_eq!(tombstones(&pool, zweiter).await, (None, None));
    }

    // ---------- LFH-750: endgültige Löschung des Skeletts (Phase D) ----------

    /// Ein einzelnes, kleingeschriebenes Wort: so legt es auch der FTS5-Tokenizer (`unicode61`)
    /// in `etb_eintrag_fts_data` ab. Ein Text mit Bindestrichen und Großbuchstaben stünde dort nur
    /// zerlegt, und die Bytesuche sähe die Reste im Suchindex nicht.
    const ETB_KLARTEXT: &str = "lfh750gepflanztwortlaut";

    async fn skelett_frist(pool: &SqlitePool, tage: Option<i64>) {
        sqlx::query(
            "INSERT INTO org_einstellungen (org_id, skelett_dauer_tage) VALUES (1, ?) \
             ON CONFLICT(org_id) DO UPDATE SET skelett_dauer_tage = excluded.skelett_dauer_tage",
        )
        .bind(tage)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Abgeschlossen am 2026-01-01, Frist abgelaufen, vorgemerkt am 2026-01-02 (Karenz endet am
    /// 2026-02-01), mit ETB-Eintrag (Retain — überlebt die Schwärzung) und Person.
    async fn vorgemerkt_mit_etb(pool: &SqlitePool) -> i64 {
        let e = abgeschlossen_mit_frist(pool, "2026-01-01 00:00:00").await;
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-01-02 00:00:00' WHERE id = ?")
            .bind(e)
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar("SELECT abgeschlossen_von FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', ?, ?, '2026-01-01 00:00:00')",
        )
        .bind(e)
        .bind(ETB_KLARTEXT)
        .bind(b)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, \
                geaendert_von) VALUES (?, 1, 'betroffen', ?, ?)",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .execute(pool)
        .await
        .unwrap();
        e
    }

    async fn existiert(pool: &SqlitePool, e: i64) -> bool {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM einsatz WHERE id = ?)")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn reste_im_etb_und_register(pool: &SqlitePool, e: i64) -> i64 {
        sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?1) \
                  + (SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?1)",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn protokoll_zeilen(pool: &SqlitePool, e: i64) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// Spec `aufbewahrung`, „Frist abgelaufen, aber noch nicht geschwärzt“ und „Fällig“: die
    /// Skelett-Frist (Abschluss + 30 Tage = 2026-01-31) ist vor der Schwärzung abgelaufen; der
    /// Lauf löscht erst in dem Lauf, der schwärzt — dann samt ETB und Register.
    #[tokio::test]
    async fn phase_d_loescht_erst_im_schwaerzungslauf_und_dann_vollstaendig() {
        let pool = crate::db::test_pool().await;
        let e = vorgemerkt_mit_etb(&pool).await;
        skelett_frist(&pool, Some(30)).await;

        // Skelett-Frist abgelaufen, Karenz noch nicht: weder geschwärzt noch gelöscht.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-01-31 12:00:00")).await,
            0
        );
        assert!(existiert(&pool, e).await);
        assert_eq!(reste_im_etb_und_register(&pool, e).await, 2);

        // Karenz abgelaufen: derselbe Lauf schwärzt (B) und löscht (D).
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-02-01 12:00:00")).await,
            2
        );
        assert!(!existiert(&pool, e).await, "Skelett endgültig gelöscht");
        assert_eq!(reste_im_etb_und_register(&pool, e).await, 0);
        assert_eq!(protokoll_zeilen(&pool, e).await, 1);

        // Zweiter Lauf: nichts mehr zu tun.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-02-01 12:10:00")).await,
            0
        );
        assert_eq!(protokoll_zeilen(&pool, e).await, 1);
    }

    /// Spec `aufbewahrung`, „Ohne Skelett-Frist“, „Noch nicht fällig“ und „Skelett-Frist ohne
    /// Eingriff“: ohne Org-Frist bleibt das Skelett auch nach Jahrzehnten; mit Frist löscht der
    /// nächste Lauf nach ihrem Ablauf, nicht vorher.
    #[tokio::test]
    async fn phase_d_ohne_frist_bleibt_mit_frist_erst_nach_ablauf() {
        let pool = crate::db::test_pool().await;
        let e = vorgemerkt_mit_etb(&pool).await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-02-01 12:00:00")).await,
            1,
            "nur geschwärzt"
        );
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2046-02-01 12:00:00")).await,
            0
        );
        assert!(
            existiert(&pool, e).await,
            "ohne Skelett-Frist bleibt das Skelett"
        );

        // Abschluss 2026-01-01 + 3650 Tage = 2035-12-30 00:00:00.
        skelett_frist(&pool, Some(3650)).await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2035-12-29 23:59:59")).await,
            0
        );
        assert!(existiert(&pool, e).await, "noch nicht fällig");
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2035-12-30 00:00:00")).await,
            1
        );
        assert!(!existiert(&pool, e).await);
    }

    /// Spec `aufbewahrung`, „Keine Altbytes“: der ETB-Wortlaut überlebt die Schwärzung (Retain)
    /// und verschwindet erst mit der Löschung — danach steht er weder in der DB-Datei noch im
    /// WAL, auch nicht als Token im FTS5-Suchindex. Schwärzung und Löschung liegen in getrennten
    /// Läufen, damit der Rückschrieb der Löschung selbst geprüft ist. Mutationsproben: ohne
    /// Rückschrieb nach Phase D und ohne `secure-delete` am FTS-Index wird er rot.
    #[tokio::test]
    async fn skelett_loeschung_hinterlaesst_keine_altbytes() {
        let (_dir, pfad, pool) = produktions_pool().await;
        let e = vorgemerkt_mit_etb(&pool).await;
        skelett_frist(&pool, Some(100)).await;
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-02-01 12:00:00")).await,
            1,
            "nur geschwärzt"
        );
        assert!(
            crate::db::datei_oder_wal_enthaelt(&pfad, ETB_KLARTEXT.as_bytes()),
            "Vorbedingung: der ETB-Wortlaut überlebt die Schwärzung"
        );

        // Abschluss + 100 Tage = 2026-04-11.
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-04-11 12:00:00")).await,
            1
        );
        assert!(!existiert(&pool, e).await);
        assert!(
            !crate::db::datei_oder_wal_enthaelt(&pfad, ETB_KLARTEXT.as_bytes()),
            "ETB-Wortlaut steht nach der Löschung noch in DB-Datei oder WAL"
        );
    }

    /// Spec `aufbewahrung`, „Rückspielen einer älteren Sicherung“: eine Sicherung von vor der
    /// Löschung bringt das Skelett zurück; der nächste Lauf löscht es erneut, mit genau einer
    /// Protokollzeile.
    #[tokio::test]
    async fn restore_von_vor_der_loeschung_wird_erneut_geloescht() {
        let (dir, pfad, pool) = produktions_pool().await;
        let e = vorgemerkt_mit_etb(&pool).await;
        skelett_frist(&pool, Some(100)).await;
        tick_einmal(&pool, &LiveHub::new(), t("2026-02-01 12:00:00")).await;
        let sicherung = dir.path().join("vorher.sqlite");
        crate::backup::erzeuge_sicherung(&pool, &sicherung)
            .await
            .unwrap();
        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-04-11 12:00:00")).await,
            1
        );
        pool.close().await;

        crate::backup::restore::restore_aus_datei(&sicherung, &pfad, true)
            .await
            .unwrap();
        let pool = crate::db::connect(pfad.to_str().unwrap()).await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        assert!(
            existiert(&pool, e).await,
            "Vorbedingung: die Sicherung trägt das Skelett"
        );
        assert_eq!(protokoll_zeilen(&pool, e).await, 0);

        assert_eq!(
            tick_einmal(&pool, &LiveHub::new(), t("2026-04-11 12:10:00")).await,
            1
        );
        assert!(!existiert(&pool, e).await);
        assert_eq!(protokoll_zeilen(&pool, e).await, 1);
        assert!(!crate::db::datei_oder_wal_enthaelt(
            &pfad,
            ETB_KLARTEXT.as_bytes()
        ));
    }
}
