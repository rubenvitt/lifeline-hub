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
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase A fehlgeschlagen: {e}"),
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

    /// F02/LFH-229: die vormals ungescrubbten Lücken (Einsatz-Kopf, Anhang-BLOB,
    /// Lage-/Gefahren-Freitexte, operative Freitext-Zettel) werden jetzt data-driven aus
    /// der Registry mit-geschwärzt; Führungs-Doku (ETB/Meldung) + operatives Skelett bleiben.
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

        // Meldung (Führungs-Doku, RETAIN) + daraus abgeleitetes lage_meldung (text NOT NULL → Platzhalter).
        let meldung: i64 = sqlx::query_scalar(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, ereigniszeit, eingang_at, erfasst_von_id) \
             VALUES (?, 1, 'Florian 1', 'funk', 'Lagemeldung Wortlaut bleibt (ETB-Doku)', \
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
        assert_eq!(tick_einmal(&pool, t("2026-06-01 12:00:00")).await, 1);

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

        // (f) Führungs-Dokumentation (Meldung-Wortlaut) + ETB-Skelett bleiben erhalten.
        let m_inhalt: String = sqlx::query_scalar("SELECT inhalt FROM meldung WHERE id = ?")
            .bind(meldung)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            m_inhalt, "Lagemeldung Wortlaut bleibt (ETB-Doku)",
            "Führungs-Doku (Meldung) bleibt"
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
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 0);
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

        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 0);
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g, None, "ohne Audit keine Vormerkung");
        assert!(etb_erfasser(&pool, e).await.is_empty(), "kein ETB-Eintrag");

        let admin = org_admin_anlegen(&pool).await;
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:10:00")).await, 1);
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

        assert_eq!(tick_einmal(&pool, t("2026-06-01 12:00:00")).await, 0);
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
        assert_eq!(tick_einmal(&pool, t("2026-06-01 12:10:00")).await, 1);
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

    /// LFH-23, Anforderung „Karenz“: Phase B liest `retention_bis` nicht. Ein vorgemerkter
    /// Einsatz, dessen Frist direkt in der DB verlängert wurde, wird nach der Karenz trotzdem
    /// geschwärzt — maßgeblich ist allein `geloescht_at`.
    #[tokio::test]
    async fn karenz_ignoriert_verlaengerte_frist() {
        let pool = crate::db::test_pool().await;
        let id = abgeschlossen_mit_frist(&pool, "2026-06-01 00:00:00").await;
        assert_eq!(tick_einmal(&pool, t("2026-06-02 12:00:00")).await, 1);
        sqlx::query("UPDATE einsatz SET retention_bis = '2099-01-01 00:00:00' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(tick_einmal(&pool, t("2026-07-02 12:00:00")).await, 1);
        let s: Option<String> =
            sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(s.as_deref(), Some("2026-07-02 12:00:00"));
    }
}
