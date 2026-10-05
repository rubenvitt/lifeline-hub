//! Gemeinsamer Testbestand für Personen-Scrub, Schwärzungsantrag und Purge-Lauf (LFH-751).
//!
//! Zwei abgeschlossene Einsätze derselben Organisation. Im ersten Einsatz steht je Personenart
//! eine Zielperson und eine Nachbarperson mit eindeutigem Klartext, dazu jede Tabelle, die auf
//! eine Person verweist. Der zweite Einsatz trägt eine eigene Person, damit ein Scrub über die
//! Einsatzgrenze auffiele.

use sqlx::SqlitePool;

/// Eindeutige Klartexte der Zielpersonen — dürfen nach dem Vollzug nirgends mehr stehen.
pub const ZIEL_KLARTEXTE: &[&str] = &[
    "Yilmaz",
    "Ayse",
    "0171 2345678",
    "Klinik Nord",
    "Herr Yilmaz klagt über Atemnot",
    "Hund-Chip-276",
    "Gartenweg 7",
    "Externer Hans",
    "THW OV Nord",
    "Hans Funk 0172",
    "Anruferin Lisa",
    // LFH-757: Dateinamen der Personen-Anhänge (auch ein schon entfernter) gehen samt Datei.
    "Yilmaz-Wunde.jpg",
    "Yilmaz-Ausweis-alt.pdf",
    "0151 1112223",
    "Maria Beispiel",
    "+49 511 1234567",
    // LFH-901: alle Freitexte des Medienkontakts hängen an der Ansprechperson (Wurzel).
    "NDR 1",
    "Pegelstand Deichstraße",
    "Pegel sinkt seit Mittag",
    "EL Brandt",
];

/// Klartexte der Nachbarn — müssen nach einem Personen-Vollzug stehen bleiben.
pub const NACHBAR_KLARTEXTE: &[&str] = &[
    "Mustermann",
    "Mustermann Hof",
    "0160 9999999",
    "Externe Grete",
    "Stamm-Dora",
    "Anrufer Tom",
    "Paul Presse",
    "Sperrung Brücke",
    "Anderer Einsatz Meier",
    "Mustermann-Ausweis.pdf",
    "Meier-Foto-E2.jpg",
];

#[derive(Debug, Clone, Copy)]
pub struct Bestand {
    pub org_id: i64,
    pub admin: i64,
    pub leitung: i64,
    pub e1: i64,
    pub e2: i64,
    /// Betroffene `R-001` (Ziel) und `R-002` (Nachbar) in e1, `R-001` in e2.
    pub p1: i64,
    pub p2: i64,
    pub p_e2: i64,
    /// Ad-hoc-externe Kräfte (Ziel, Nachbar) und eine Stammkraft in e1.
    pub k1: i64,
    pub k2: i64,
    pub k_stamm: i64,
    pub anruf1: i64,
    pub anruf2: i64,
    pub medien1: i64,
    pub medien2: i64,
}

async fn id(pool: &SqlitePool, sql: &str, binds: &[i64]) -> i64 {
    let mut q = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(sql.to_string()));
    for b in binds {
        q = q.bind(*b);
    }
    q.fetch_one(pool).await.unwrap()
}

async fn exec(pool: &SqlitePool, sql: &str, binds: &[i64]) {
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()));
    for b in binds {
        q = q.bind(*b);
    }
    q.execute(pool).await.unwrap();
}

/// Legt den Bestand an. `status_e1` erlaubt einen aktiven ersten Einsatz.
pub async fn anlegen(pool: &SqlitePool) -> Bestand {
    anlegen_mit_status(pool, "abgeschlossen").await
}

pub async fn anlegen_mit_status(pool: &SqlitePool, status_e1: &str) -> Bestand {
    exec(
        pool,
        "INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')",
        &[],
    )
    .await;
    let admin = id(
        pool,
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (1, 'Admin', 'admin751', 'h', 'admin') RETURNING id",
        &[],
    )
    .await;
    let leitung = id(
        pool,
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Leitung', 'leitung751', 'h') RETURNING id",
        &[],
    )
    .await;
    let abgeschlossen_at = if status_e1 == "abgeschlossen" {
        "'2026-01-01 00:00:00'"
    } else {
        "NULL"
    };
    let e1 = id(
        pool,
        &format!(
            "INSERT INTO einsatz (org_id, bezeichnung, status, einsatznummer_intern, \
                abgeschlossen_at, abgeschlossen_von, retention_bis) \
             VALUES (1, 'Hochwasser', '{status_e1}', 'E-2026-0751', {abgeschlossen_at}, ?, \
                '2031-01-01 00:00:00') RETURNING id"
        ),
        &[leitung],
    )
    .await;
    let e2 = id(
        pool,
        "INSERT INTO einsatz (org_id, bezeichnung, status, einsatznummer_intern, \
            abgeschlossen_at, abgeschlossen_von) \
         VALUES (1, 'Brand', 'abgeschlossen', 'E-2026-0752', '2026-01-02 00:00:00', ?) \
         RETURNING id",
        &[leitung],
    )
    .await;

    // ---------- Betroffene ----------
    let p1 = id(
        pool,
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, \
            geburtsdatum, herkunft_adresse, melder_kontakt, notiz, aktueller_verbleib, \
            aktuelles_verbleib_ziel, zustand, antreff_lat, antreff_lon, erfasst_von, geaendert_von) \
         VALUES (?, 1, 'betroffen', 'Yilmaz', 'Ayse', '1980-01-01', 'Gartenweg 7', \
            '0171 2345678', 'Herr Yilmaz klagt über Atemnot', 'Transport → Klinik Nord', \
            'Klinik Nord', 'Herr Yilmaz klagt über Atemnot', 52.1, 9.9, ?, ?) RETURNING id",
        &[e1, leitung, leitung],
    )
    .await;
    let p2 = id(
        pool,
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, \
            melder_kontakt, erfasst_von, geaendert_von) \
         VALUES (?, 2, 'betroffen', 'Mustermann', 'Erika', '0160 9999999', ?, ?) RETURNING id",
        &[e1, leitung, leitung],
    )
    .await;
    let p_e2 = id(
        pool,
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, erfasst_von, \
            geaendert_von) \
         VALUES (?, 1, 'betroffen', 'Anderer Einsatz Meier', ?, ?) RETURNING id",
        &[e2, leitung, leitung],
    )
    .await;
    for (p, notiz) in [(p1, "Herr Yilmaz klagt über Atemnot"), (p2, "Mustermann")] {
        exec(
            pool,
            &format!(
                "INSERT INTO person_sichtung (einsatz_id, person_id, kategorie, notiz, \
                    gesichtet_von) VALUES (?, ?, 'sk2', '{notiz}', ?)"
            ),
            &[e1, p, leitung],
        )
        .await;
    }
    exec(
        pool,
        "INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von) \
         VALUES (?, ?, 'Herr Yilmaz klagt über Atemnot', ?)",
        &[e1, p1, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von) \
         VALUES (?, ?, 'Mustermann stabil', ?)",
        &[e1, p2, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO person_verbleib (einsatz_id, person_id, art, transportmittel, ziel, \
            notiz, erfasst_von) \
         VALUES (?, ?, 'transport', 'RTW', 'Klinik Nord', 'Gartenweg 7', ?)",
        &[e1, p1, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, halter_person_id, \
            kennzeichnung, antreff_ort, notiz, erfasst_von, geaendert_von) \
         VALUES (?, 1, 'hund', ?, 'Hund-Chip-276', 'Waldrand', 'Tier ruhig', ?, ?)",
        &[e1, p1, leitung, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, status, typ, ausmass, ort, \
            beschreibung, geschaedigt_person_id, uebergeben_an, \
            uebergeben_at, erfasst_von, geaendert_von) \
         VALUES (?, 1, 'uebergeben', 'sachschaden', 'gering', 'Gartenweg 7', \
            'Keller Gartenweg 7', ?, 'Polizei Revier Süd', \
            '2026-01-01 00:00:00', ?, ?)",
        &[e1, p1, leitung, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, status, typ, ausmass, ort, \
            geschaedigt_person_id, erfasst_von, geaendert_von) \
         VALUES (?, 2, 'offen', 'sachschaden', 'gering', 'Mustermann Hof', ?, ?, ?)",
        &[e1, p2, leitung, leitung],
    )
    .await;

    // ---------- Externe Kräfte ----------
    let k1 = id(
        pool,
        "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name, snap_funktion, \
            snap_traegerorganisation, bemerkung) \
         VALUES (?, NULL, 'Externer Hans', 'Helfer', 'THW OV Nord', 'Hans Funk 0172') \
         RETURNING id",
        &[e1],
    )
    .await;
    let k2 = id(
        pool,
        "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) \
         VALUES (?, NULL, 'Externe Grete') RETURNING id",
        &[e1],
    )
    .await;
    let stamm_pid = id(
        pool,
        "INSERT INTO personal (org_id, name) VALUES (1, 'Stamm-Dora') RETURNING id",
        &[],
    )
    .await;
    let k_stamm = id(
        pool,
        "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) \
         VALUES (?, ?, 'Stamm-Dora') RETURNING id",
        &[e1, stamm_pid],
    )
    .await;
    let auftrag = id(
        pool,
        "INSERT INTO auftrag (einsatz_id, auftrag_text, erteilt_at, erstellt_von_id) \
         VALUES (?, 'Sandsäcke', '2026-01-01 00:00:00', ?) RETURNING id",
        &[e1, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, person_id, snap_anzeige) \
         VALUES (?, 'person', ?, 'Externer Hans')",
        &[auftrag, k1],
    )
    .await;
    exec(
        pool,
        "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, person_id, snap_anzeige) \
         VALUES (?, 'person', ?, 'Externe Grete')",
        &[auftrag, k2],
    )
    .await;
    exec(
        pool,
        "INSERT INTO einsatz_stabsfunktion (einsatz_id, sachgebiet, besetzung_art, personal_id, \
            snap_name, gesetzt_von_id) VALUES (?, 's1', 'personal', ?, 'Externer Hans', ?)",
        &[e1, k1, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO einsatz_kraft_zeitachse (einsatz_id, personal_id, art, zeitpunkt_at, \
            quelle, notiz, erfasst_von) \
         VALUES (?, ?, 'eintreffen', '2026-01-01 00:00:00', 'nachtrag', 'Hans Funk 0172', ?)",
        &[e1, k1, leitung],
    )
    .await;
    exec(
        pool,
        "INSERT INTO einsatzabschnitt (einsatz_id, name, leiter_id, erreichbarkeit, bemerkung) \
         VALUES (?, 'EA Nord', ?, 'Hans Funk 0172', 'Deich halten')",
        &[e1, k1],
    )
    .await;

    // ---------- Anrufe und Medienkontakte ----------
    let anruf1 = id(
        pool,
        "INSERT INTO infotelefon_anruf (einsatz_id, anliegen, notiz, anrufer_name, rueckruf, \
            status, eingang_at, angelegt_von_id) \
         VALUES (?, 'hinweis', 'Anruferin Lisa sah Wasser', 'Anruferin Lisa', '0151 1112223', \
            'offen', '2026-01-01 00:00:00', ?) RETURNING id",
        &[e1, leitung],
    )
    .await;
    let anruf2 = id(
        pool,
        "INSERT INTO infotelefon_anruf (einsatz_id, anliegen, anrufer_name, rueckruf, status, \
            eingang_at, angelegt_von_id) \
         VALUES (?, 'hinweis', 'Anrufer Tom', '0152 333444', 'offen', '2026-01-01 00:00:00', ?) \
         RETURNING id",
        &[e1, leitung],
    )
    .await;
    let medien1 = id(
        pool,
        "INSERT INTO medienkontakt (einsatz_id, art, medium, thema, kontakt_name, \
            kontakt_erreichbarkeit, eingang_at, status, antwort, freigabe_durch, \
            angelegt_von_id) \
         VALUES (?, 'anfrage', 'NDR 1', 'Pegelstand Deichstraße', 'Maria Beispiel', \
            '+49 511 1234567', '2026-01-01 00:00:00', 'beantwortet', \
            'Pegel sinkt seit Mittag', 'EL Brandt', ?) RETURNING id",
        &[e1, leitung],
    )
    .await;
    let medien2 = id(
        pool,
        "INSERT INTO medienkontakt (einsatz_id, art, medium, thema, kontakt_name, eingang_at, \
            angelegt_von_id) \
         VALUES (?, 'anfrage', 'HAZ', 'Sperrung Brücke', 'Paul Presse', '2026-01-01 00:00:00', ?) \
         RETURNING id",
        &[e1, leitung],
    )
    .await;

    // LFH-757: Personen-Anhänge — Ziel (einer davon schon entfernt), Nachbar im selben Einsatz,
    // und die Person im anderen Einsatz.
    for (einsatz, person, datei, entfernt) in [
        (e1, p1, "Yilmaz-Wunde.jpg", false),
        (e1, p1, "Yilmaz-Ausweis-alt.pdf", true),
        (e1, p2, "Mustermann-Ausweis.pdf", false),
        (e2, p_e2, "Meier-Foto-E2.jpg", false),
    ] {
        let anhang = id(
            pool,
            &format!(
                "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, \
                    hochgeladen_von) VALUES (?, '{datei}', 'image/jpeg', 1, 'x', X'00', ?) \
                 RETURNING id"
            ),
            &[einsatz, leitung],
        )
        .await;
        exec(
            pool,
            if entfernt {
                "INSERT INTO einsatz_person_anhang (einsatz_id, person_id, anhang_id, \
                    abgelegt_von_id, geloescht_at, geloescht_von_id) \
                 VALUES (?, ?, ?, ?, '2026-01-01 00:00:00', ?)"
            } else {
                "INSERT INTO einsatz_person_anhang (einsatz_id, person_id, anhang_id, \
                    abgelegt_von_id) VALUES (?, ?, ?, ?)"
            },
            &if entfernt {
                vec![einsatz, person, anhang, leitung, leitung]
            } else {
                vec![einsatz, person, anhang, leitung]
            },
        )
        .await;
    }

    Bestand {
        org_id: 1,
        admin,
        leitung,
        e1,
        e2,
        p1,
        p2,
        p_e2,
        k1,
        k2,
        k_stamm,
        anruf1,
        anruf2,
        medien1,
        medien2,
    }
}

/// Alle Textwerte aller Registry-Tabellen als eine Zeichenkette — um zu prüfen, ob ein
/// Klartext irgendwo in der Datenbank noch steht. Liest nur Spalten, die die Registry kennt.
pub async fn alle_texte(pool: &SqlitePool) -> String {
    use crate::einsatz::schwaerzung_registry::TABELLEN;
    let mut aus = String::new();
    for t in TABELLEN {
        for s in t.spalten {
            let sql = format!(
                "SELECT group_concat(CAST({} AS TEXT), '|') FROM {}",
                s.spalte, t.tabelle
            );
            let v: Option<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                .fetch_one(pool)
                .await
                .unwrap();
            if let Some(v) = v {
                aus.push_str(&v);
                aus.push('|');
            }
        }
    }
    aus
}
