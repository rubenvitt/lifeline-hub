use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

/// Öffnet einen SQLite-Pool auf der angegebenen Datei.
/// Aktiviert WAL-Journal, Foreign Keys und legt die Datei bei Bedarf an.
pub async fn connect(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
}

/// Spielt alle eingebetteten Migrationen aus `./migrations` ein.
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// In-Memory-Pool für Tests (eine Verbindung, damit dieselbe DB geteilt wird),
/// inklusive eingespielter Migrationen.
pub async fn test_pool() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(":memory:")
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("In-Memory-Pool");

    migrate(&pool).await.expect("Migrationen einspielen");
    pool
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    #[tokio::test]
    async fn connect_enables_wal_and_foreign_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let pool = connect(path.to_str().unwrap()).await.unwrap();

        let journal: String = sqlx::query("PRAGMA journal_mode;")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(journal.to_lowercase(), "wal");

        let foreign_keys: i64 = sqlx::query("PRAGMA foreign_keys;")
            .fetch_one(&pool)
            .await
            .unwrap()
            .get(0);
        assert_eq!(foreign_keys, 1);
    }

    #[tokio::test]
    async fn migrations_create_app_meta() {
        let pool = test_pool().await;
        let value: String =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_initialized'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(value, "1");
    }

    #[tokio::test]
    async fn auth_migration_creates_tables_and_constraints() {
        let pool = test_pool().await;

        // Organisation + Benutzer anlegen funktioniert.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Max Muster', 'max', 'hash')",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Default-Rolle ist 'keiner', aktiv ist 1.
        let (rolle, aktiv): (String, i64) =
            sqlx::query_as("SELECT system_rolle, aktiv FROM benutzer WHERE benutzername = 'max'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rolle, "keiner");
        assert_eq!(aktiv, 1);

        // CHECK-Constraint lehnt ungültige Rolle ab.
        let bad_rolle = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'X', 'x', 'h', 'superadmin')",
        )
        .execute(&pool)
        .await;
        assert!(bad_rolle.is_err(), "ungültige system_rolle muss abgelehnt werden");

        // UNIQUE-Constraint lehnt doppelten Benutzernamen ab.
        let dup = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Zweiter Max', 'max', 'h')",
        )
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelter benutzername muss abgelehnt werden");
    }

    #[tokio::test]
    async fn einsatz_migration_creates_tables_and_constraints() {
        let pool = test_pool().await;

        // org_rolle: Default ist 'keine'.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let org_rolle: String =
            sqlx::query_scalar("SELECT org_rolle FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(org_rolle, "keine");

        // org_rolle-CHECK lehnt ungültigen Wert ab.
        let bad_org = sqlx::query("UPDATE benutzer SET org_rolle = 'chef' WHERE benutzername = 'leit'")
            .execute(&pool)
            .await;
        assert!(bad_org.is_err(), "ungültige org_rolle muss abgelehnt werden");

        // Einsatz anlegen: status-Default ist 'aktiv'.
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Sturmlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let status: String =
            sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
                .bind(einsatz_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "aktiv");

        // status-CHECK lehnt ungültigen Wert ab.
        let bad_status = sqlx::query("UPDATE einsatz SET status = 'pausiert' WHERE id = ?")
            .bind(einsatz_id)
            .execute(&pool)
            .await;
        assert!(bad_status.is_err(), "ungültiger status muss abgelehnt werden");

        // Mitgliedschaft anlegen + einsatz_rolle-CHECK.
        let benutzer_id: i64 =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'einsatzleitung')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .unwrap();

        let bad_rolle = sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'haeuptling')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(bad_rolle.is_err(), "ungültige einsatz_rolle muss abgelehnt werden");

        // PK (einsatz_id, benutzer_id) verhindert Doppel-Mitgliedschaft.
        let dup = sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'beobachter')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelte Mitgliedschaft muss abgelehnt werden");
    }

    #[tokio::test]
    async fn einsatzdaten_migration_legt_spalten_und_unique_index_an() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // einsatzart-Default ist 'realeinsatz'. angelegt_at hat den konstanten
        // Migrations-Default '' (der Backfill betrifft nur Bestandszeilen; neue
        // Zeilen bekommen den Wert erst in repo::anlegen, Task 4).
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, begonnen_at) \
             VALUES (1, 'Lage', '2026-05-23 09:00:00') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (art, angelegt): (String, String) =
            sqlx::query_as("SELECT einsatzart, angelegt_at FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(art, "realeinsatz");
        assert_eq!(angelegt, "", "neue Zeile: angelegt_at = '' bis repo::anlegen es setzt");

        // einsatzart-CHECK lehnt ungültigen Wert ab.
        let bad = sqlx::query("UPDATE einsatz SET einsatzart = 'quatsch' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await;
        assert!(bad.is_err(), "ungültige einsatzart muss abgelehnt werden");

        // Mehrere NULL-Einsatznummern sind erlaubt (Bestand).
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A'), (1, 'B')")
            .execute(&pool)
            .await
            .unwrap();

        // Erste manuelle Nummer ok, Dublette in derselben Org → Unique-Verstoß.
        sqlx::query("UPDATE einsatz SET einsatznummer_intern = '2026-001' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let dup = sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (1, 'C', '2026-001')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppelte Einsatznummer je Org muss abgelehnt werden");
    }

    #[tokio::test]
    async fn etb_migration_legt_tabelle_und_fts_an() {
        let pool = test_pool().await;

        // Org + Benutzer + Einsatz als Voraussetzung anlegen.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Eintrag einfügen (ereigniszeit Pflicht, received_at Default).
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'Deich bei km 12 instabil', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await
        .unwrap();

        // received_at wurde per Default gesetzt.
        let received: String =
            sqlx::query_scalar("SELECT received_at FROM etb_eintrag WHERE lfd_nr = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!received.is_empty());

        // typ-CHECK lehnt ungültigen Wert ab.
        let bad_typ = sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 2, 'geschwafel', 'x', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await;
        assert!(bad_typ.is_err(), "ungültiger typ muss abgelehnt werden");

        // UNIQUE(einsatz_id, lfd_nr) verhindert doppelte lfd_nr.
        let dup = sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'lage', 'y', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "doppelte lfd_nr muss abgelehnt werden");

        // FTS5-Trigger hat den Eintrag indiziert: Volltextsuche findet ihn.
        let treffer: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag_fts WHERE etb_eintrag_fts MATCH 'Deich'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(treffer, 1, "FTS5-Trigger muss den Eintrag indizieren");
    }

    #[tokio::test]
    async fn etb_fts_wird_bei_cascade_delete_bereinigt() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'Sandsack-Nachschub', 1, '2026-05-23 10:00:00')",
        )
        .bind(einsatz_id)
        .execute(&pool)
        .await
        .unwrap();

        // Einsatz löschen → CASCADE entfernt den Eintrag; AFTER DELETE-Trigger bereinigt FTS.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .execute(&pool)
            .await
            .unwrap();

        let treffer: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag_fts WHERE etb_eintrag_fts MATCH 'Sandsack'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(treffer, 0, "FTS-Index muss nach Cascade-Delete bereinigt sein");
    }

    #[tokio::test]
    async fn stichwort_vorschlag_migration_legt_tabelle_mit_unique_an() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'H1')")
            .execute(&pool)
            .await
            .unwrap();

        // UNIQUE(org_id, text): Dublette je Org abgelehnt.
        let dup = sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'H1')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppeltes Stichwort je Org muss abgelehnt werden");

        // sortier-Default ist 0.
        let sortier: i64 =
            sqlx::query_scalar("SELECT sortier FROM einsatz_stichwort_vorschlag WHERE text = 'H1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sortier, 0);
    }

    #[tokio::test]
    async fn fahrzeug_migration_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // dienststatus-Default ist 'in_dienst'.
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (status, signal): (String, i64) =
            sqlx::query_as("SELECT dienststatus, sondersignal FROM fahrzeug WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "in_dienst");
        assert_eq!(signal, 0);

        // dienststatus-CHECK lehnt ungültigen Wert ab.
        let bad = sqlx::query("UPDATE fahrzeug SET dienststatus = 'kaputt' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await;
        assert!(bad.is_err(), "ungültiger dienststatus muss abgelehnt werden");

        // Partieller Unique-Index: doppelter Funkrufname unter aktiven verboten.
        let dup = sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppelter aktiver Funkrufname je Org muss abgelehnt werden");

        // Außer Dienst gestellt → Name wieder frei.
        sqlx::query("UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let wieder = sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
            .execute(&pool)
            .await;
        assert!(wieder.is_ok(), "Name eines außer Dienst gestellten Fahrzeugs muss frei sein");
    }

    #[tokio::test]
    async fn fahrzeug_status_migration_constraints_und_seed() {
        let pool = test_pool().await;
        // Org NACH der Migration anlegen → Migrations-Seed greift hier NICHT
        // (das Seeding der neuen Org ist bootstrap_admins Aufgabe, separat getestet).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // kategorie-CHECK.
        let bad_kat = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'X', 'quatsch')",
        )
        .execute(&pool)
        .await;
        assert!(bad_kat.is_err(), "ungültige kategorie muss abgelehnt werden");

        // fms_anker-CHECK (0..=9).
        let bad_fms = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker) VALUES (1, 'Y', 'gebunden', 12)",
        )
        .execute(&pool)
        .await;
        assert!(bad_fms.is_err(), "fms_anker außerhalb 0..=9 muss abgelehnt werden");

        // aktiv-Default ist 1, sortier-Default 0.
        sqlx::query("INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'verfuegbar')")
            .execute(&pool)
            .await
            .unwrap();
        let (aktiv, sortier): (i64, i64) = sqlx::query_as(
            "SELECT aktiv, sortier FROM fahrzeug_status WHERE label = 'frei'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(aktiv, 1);
        assert_eq!(sortier, 0);

        // UNIQUE(org_id, label).
        let dup = sqlx::query("INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'gebunden')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppeltes label je Org muss abgelehnt werden");
    }

    #[tokio::test]
    async fn einsatz_fahrzeug_migration_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let fz: i64 = sqlx::query_scalar(
            "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Stamm-Disposition.
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
             VALUES (?, ?, 'Florian 1')",
        )
        .bind(einsatz)
        .bind(fz)
        .execute(&pool)
        .await
        .unwrap();

        // UNIQUE(einsatz_id, fahrzeug_id): dasselbe Stamm-Fahrzeug nicht doppelt.
        let dup = sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
             VALUES (?, ?, 'Florian 1')",
        )
        .bind(einsatz)
        .bind(fz)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "dasselbe Stamm-Fahrzeug doppelt im Einsatz muss abgelehnt werden");

        // Mehrere Ad-hoc (fahrzeug_id NULL) erlaubt — NULL ist in SQLite-UNIQUE verschieden.
        sqlx::query("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 1')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 2')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fahrzeug WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 3, "1 Stamm + 2 Ad-hoc");

        // Einsatz löschen → CASCADE entfernt die Dispositionszeilen.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fahrzeug")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Dispositionszeilen entfernen");
    }

    #[tokio::test]
    async fn einsatzabschnitt_migration_legt_tabelle_und_cascade_an() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(&pool).await.unwrap();

        // Oberste Ebene + Unterabschnitt.
        let oben: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatzabschnitt (einsatz_id, ueber_abschnitt_id, name) VALUES (?, ?, 'Nord-1')")
            .bind(einsatz).bind(oben).execute(&pool).await.unwrap();

        // sortier-Default 0, angelegt_at gesetzt.
        let (sortier, angelegt): (i64, String) = sqlx::query_as(
            "SELECT sortier, angelegt_at FROM einsatzabschnitt WHERE name = 'Nord'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(sortier, 0);
        assert!(!angelegt.is_empty());

        // CASCADE: Einsatz löschen entfernt die Abschnitte.
        sqlx::query("DELETE FROM einsatz WHERE id = ?").bind(einsatz).execute(&pool).await.unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatzabschnitt").fetch_one(&pool).await.unwrap();
        assert_eq!(rest, 0, "CASCADE muss Abschnitte entfernen");
    }

    #[tokio::test]
    async fn einheit_typ_migration_constraints_und_nullable_soll() {
        let pool = test_pool().await;
        // Org NACH der Migration → Migrations-Seed greift NICHT (bootstrap seedet neue Orgs).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool).await.unwrap();

        // Soll vollständig.
        sqlx::query("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18)")
            .execute(&pool).await.unwrap();
        // Soll komplett NULL (z. B. Sonstige).
        sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Sonstige')")
            .execute(&pool).await.unwrap();
        let (aktiv, sortier): (i64, i64) = sqlx::query_as(
            "SELECT aktiv, sortier FROM einheit_typ WHERE label = 'Sonstige'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!((aktiv, sortier), (1, 0), "aktiv-Default 1, sortier-Default 0");

        // UNIQUE(org_id, label).
        let dup = sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug')")
            .execute(&pool).await;
        assert!(dup.is_err(), "doppeltes label je Org muss abgelehnt werden");
    }

    #[tokio::test]
    async fn migration_0010_bis_0013_legen_personal_schema_an() {
        let pool = test_pool().await;
        // Tabellen existieren (leeres SELECT wirft nicht).
        for tabelle in ["personal", "qualifikation", "personal_qualifikation", "personal_status", "einsatz_personal"] {
            let sql = format!("SELECT COUNT(*) FROM {tabelle}");
            let n: i64 = sqlx::query_scalar(&sql).fetch_one(&pool).await.unwrap();
            assert_eq!(n, 0, "{tabelle} startet leer (keine Org auf test_pool)");
        }
    }

    #[tokio::test]
    async fn qualifikation_und_personal_status_schema_akzeptiert_einfuegungen() {
        let pool = test_pool().await;
        // Org NACH den Migrationen anlegen → Seed greift NICHT (CROSS JOIN lief auf leerer
        // Org-Menge). Wir prüfen daher den Seed über bootstrap in Task 9; hier nur, dass
        // ein manuell geseedeter Eintrag einfügbar ist (Schema/CHECK korrekt).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Sanitäter', 10)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (1, 'verfügbar', 'verfuegbar', 10)")
            .execute(&pool).await.unwrap();
        let q: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM qualifikation WHERE org_id = 1").fetch_one(&pool).await.unwrap();
        let s: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM personal_status WHERE org_id = 1").fetch_one(&pool).await.unwrap();
        assert_eq!((q, s), (1, 1));
    }

    #[tokio::test]
    async fn personal_schema_constraints() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // Partieller Unique-Index idx_personal_personalnummer: gleiche Personalnummer
        // je Org unter aktiven (in_dienst) Personen verboten.
        let p1: i64 = sqlx::query_scalar(
            "INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Anna', 'P-100') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let dup = sqlx::query("INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Bert', 'P-100')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppelte aktive Personalnummer je Org muss abgelehnt werden");

        // Außer Dienst gestellt → Nummer wieder frei.
        sqlx::query("UPDATE personal SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(p1)
            .execute(&pool)
            .await
            .unwrap();
        let wieder = sqlx::query("INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Cara', 'P-100')")
            .execute(&pool)
            .await;
        assert!(wieder.is_ok(), "Nummer einer außer Dienst gestellten Person muss frei sein");

        // Einsatz als Voraussetzung für einsatz_personal.
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO personal (org_id, name) VALUES (1, 'Dora') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Stamm-Person disponieren.
        sqlx::query(
            "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) VALUES (?, ?, 'Dora')",
        )
        .bind(einsatz)
        .bind(person)
        .execute(&pool)
        .await
        .unwrap();

        // UNIQUE(einsatz_id, personal_id): dieselbe Stamm-Person nicht doppelt.
        let dup = sqlx::query(
            "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) VALUES (?, ?, 'Dora')",
        )
        .bind(einsatz)
        .bind(person)
        .execute(&pool)
        .await;
        assert!(dup.is_err(), "dieselbe Stamm-Person doppelt im Einsatz muss abgelehnt werden");

        // Mehrere Ad-hoc (personal_id NULL) erlaubt — NULL ist in SQLite-UNIQUE verschieden.
        sqlx::query("INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Extern 1')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Extern 2')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_personal WHERE einsatz_id = ?")
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 3, "1 Stamm + 2 Ad-hoc");

        // Einsatz löschen → CASCADE entfernt die Dispositionszeilen.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_personal")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Dispositionszeilen entfernen");
    }
}
