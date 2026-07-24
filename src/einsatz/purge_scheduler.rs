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
