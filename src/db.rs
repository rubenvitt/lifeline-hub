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
        assert!(
            bad_rolle.is_err(),
            "ungültige system_rolle muss abgelehnt werden"
        );

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
        let bad_org =
            sqlx::query("UPDATE benutzer SET org_rolle = 'chef' WHERE benutzername = 'leit'")
                .execute(&pool)
                .await;
        assert!(
            bad_org.is_err(),
            "ungültige org_rolle muss abgelehnt werden"
        );

        // Einsatz anlegen: status-Default ist 'aktiv'.
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Sturmlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
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
        assert!(
            bad_status.is_err(),
            "ungültiger status muss abgelehnt werden"
        );

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
        assert!(
            bad_rolle.is_err(),
            "ungültige einsatz_rolle muss abgelehnt werden"
        );

        // PK (einsatz_id, benutzer_id) verhindert Doppel-Mitgliedschaft.
        let dup = sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, 'beobachter')",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(
            dup.is_err(),
            "doppelte Mitgliedschaft muss abgelehnt werden"
        );
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
        assert_eq!(
            angelegt, "",
            "neue Zeile: angelegt_at = '' bis repo::anlegen es setzt"
        );

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
        assert!(
            dup.is_err(),
            "doppelte Einsatznummer je Org muss abgelehnt werden"
        );
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
    async fn etb_client_id_migration_partieller_unique() {
        // F03/LFH-261: client_id trägt die Offline-Idempotenz. Der UNIQUE-Index ist
        // PARTIELL (WHERE client_id IS NOT NULL), damit die vielen NULL-Einträge
        // (System-/abgeleitete Einträge, Online-Direkterfassung ohne Id) nicht kollidieren.
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
        let e1: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'A') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'B') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        async fn ins(
            pool: &SqlitePool,
            einsatz_id: i64,
            lfd_nr: i64,
            client_id: Option<&str>,
        ) -> Result<(), sqlx::Error> {
            sqlx::query(
                "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, client_id) \
                 VALUES (?, ?, 'meldung', 'x', 1, '2026-05-23 10:00:00', ?)",
            )
            .bind(einsatz_id)
            .bind(lfd_nr)
            .bind(client_id)
            .execute(pool)
            .await
            .map(|_| ())
        }

        // (a) client_id ist speicherbar.
        ins(&pool, e1, 1, Some("u1")).await.unwrap();
        // (b) gleiche (einsatz_id, client_id) → UNIQUE-Verletzung (Idempotenz-Backstop).
        assert!(
            ins(&pool, e1, 2, Some("u1")).await.is_err(),
            "doppelte client_id im selben Einsatz muss abgelehnt werden"
        );
        // (c) NULL kollidiert nie (partieller Index nimmt NULL aus).
        ins(&pool, e1, 3, None).await.unwrap();
        ins(&pool, e1, 4, None).await.unwrap();
        // (d) dieselbe client_id in einem ANDEREN Einsatz ist erlaubt (per-Einsatz-eindeutig).
        ins(&pool, e2, 1, Some("u1")).await.unwrap();
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
        assert_eq!(
            treffer, 0,
            "FTS-Index muss nach Cascade-Delete bereinigt sein"
        );
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
        let dup =
            sqlx::query("INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'H1')")
                .execute(&pool)
                .await;
        assert!(
            dup.is_err(),
            "doppeltes Stichwort je Org muss abgelehnt werden"
        );

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
        assert!(
            bad.is_err(),
            "ungültiger dienststatus muss abgelehnt werden"
        );

        // Partieller Unique-Index: doppelter Funkrufname unter aktiven verboten.
        let dup = sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
            .execute(&pool)
            .await;
        assert!(
            dup.is_err(),
            "doppelter aktiver Funkrufname je Org muss abgelehnt werden"
        );

        // Außer Dienst gestellt → Name wieder frei.
        sqlx::query("UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        let wieder =
            sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Florian 1')")
                .execute(&pool)
                .await;
        assert!(
            wieder.is_ok(),
            "Name eines außer Dienst gestellten Fahrzeugs muss frei sein"
        );
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
        assert!(
            bad_kat.is_err(),
            "ungültige kategorie muss abgelehnt werden"
        );

        // fms_anker-CHECK (0..=9).
        let bad_fms = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker) VALUES (1, 'Y', 'gebunden', 12)",
        )
        .execute(&pool)
        .await;
        assert!(
            bad_fms.is_err(),
            "fms_anker außerhalb 0..=9 muss abgelehnt werden"
        );

        // aktiv-Default ist 1, sortier-Default 0.
        sqlx::query("INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'verfuegbar')")
            .execute(&pool)
            .await
            .unwrap();
        let (aktiv, sortier): (i64, i64) =
            sqlx::query_as("SELECT aktiv, sortier FROM fahrzeug_status WHERE label = 'frei'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(aktiv, 1);
        assert_eq!(sortier, 0);

        // UNIQUE(org_id, label).
        let dup = sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie) VALUES (1, 'frei', 'gebunden')",
        )
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
        assert!(
            dup.is_err(),
            "dasselbe Stamm-Fahrzeug doppelt im Einsatz muss abgelehnt werden"
        );

        // Mehrere Ad-hoc (fahrzeug_id NULL) erlaubt — NULL ist in SQLite-UNIQUE verschieden.
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 1')",
        )
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FW Extern 2')",
        )
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
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // Oberste Ebene + Unterabschnitt.
        let oben: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO einsatzabschnitt (einsatz_id, ueber_abschnitt_id, name) VALUES (?, ?, 'Nord-1')")
            .bind(einsatz).bind(oben).execute(&pool).await.unwrap();

        // sortier-Default 0, angelegt_at gesetzt.
        let (sortier, angelegt): (i64, String) =
            sqlx::query_as("SELECT sortier, angelegt_at FROM einsatzabschnitt WHERE name = 'Nord'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sortier, 0);
        assert!(!angelegt.is_empty());

        // CASCADE: Einsatz löschen entfernt die Abschnitte.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatzabschnitt")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Abschnitte entfernen");
    }

    #[tokio::test]
    async fn einheit_typ_migration_constraints_und_nullable_soll() {
        let pool = test_pool().await;
        // Org NACH der Migration → Migrations-Seed greift NICHT (bootstrap seedet neue Orgs).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();

        // Soll vollständig.
        sqlx::query("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18)")
            .execute(&pool).await.unwrap();
        // Soll komplett NULL (z. B. Sonstige).
        sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Sonstige')")
            .execute(&pool)
            .await
            .unwrap();
        let (aktiv, sortier): (i64, i64) =
            sqlx::query_as("SELECT aktiv, sortier FROM einheit_typ WHERE label = 'Sonstige'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            (aktiv, sortier),
            (1, 0),
            "aktiv-Default 1, sortier-Default 0"
        );

        // UNIQUE(org_id, label).
        let dup = sqlx::query("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "doppeltes label je Org muss abgelehnt werden");
    }

    #[tokio::test]
    async fn einsatz_einheit_migration_referenzen_und_cascade() {
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
        let typ: i64 = sqlx::query_scalar(
            "INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Einheit mit beiden Referenzen + Selbstreferenz (Unter-Einheit).
        let zug: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, abschnitt_id, typ_id, name) VALUES (?, ?, ?, '1. Zug') RETURNING id",
        ).bind(einsatz).bind(abschnitt).bind(typ).fetch_one(&pool).await.unwrap();
        sqlx::query("INSERT INTO einsatz_einheit (einsatz_id, ueber_einheit_id, name) VALUES (?, ?, 'Gruppe Florian 1')")
            .bind(einsatz).bind(zug).execute(&pool).await.unwrap();

        let (sortier, angelegt): (i64, String) = sqlx::query_as(
            "SELECT sortier, angelegt_at FROM einsatz_einheit WHERE name = '1. Zug'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(sortier, 0);
        assert!(!angelegt.is_empty());

        // CASCADE über Einsatz.
        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "CASCADE muss Einheiten entfernen");
    }

    #[tokio::test]
    async fn einheit_mitgliedschaft_migration_fk_spalte_default_null() {
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

        // Neue Dispozeile: einheit_id ist standardmäßig NULL (freie Kraft).
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Extern') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        let einheit_id: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?")
                .bind(ep)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(einheit_id, None);

        // Zuordnen auf eine Einheit funktioniert.
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Trupp') RETURNING id",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(ep)
            .execute(&pool)
            .await
            .unwrap();

        // Auch an einsatz_fahrzeug existiert die Spalte.
        let ef: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'Florian 1') RETURNING id",
        ).bind(einsatz).fetch_one(&pool).await.unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
        let zuordnung: Option<i64> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_fahrzeug WHERE id = ?")
                .bind(ef)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(zuordnung, Some(einheit));
    }

    #[tokio::test]
    async fn migration_0010_bis_0013_legen_personal_schema_an() {
        let pool = test_pool().await;
        // Tabellen existieren (leeres SELECT wirft nicht).
        for tabelle in [
            "personal",
            "qualifikation",
            "personal_qualifikation",
            "personal_status",
            "einsatz_personal",
        ] {
            let sql = format!("SELECT COUNT(*) FROM {tabelle}");
            let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(&*sql))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(n, 0, "{tabelle} startet leer (keine Org auf test_pool)");
        }
    }

    #[tokio::test]
    async fn qualifikation_und_personal_status_schema_akzeptiert_einfuegungen() {
        let pool = test_pool().await;
        // Org NACH den Migrationen anlegen → Seed greift NICHT (CROSS JOIN lief auf leerer
        // Org-Menge). Wir prüfen daher den Seed über bootstrap in Task 9; hier nur, dass
        // ein manuell geseedeter Eintrag einfügbar ist (Schema/CHECK korrekt).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO qualifikation (org_id, label, sortier) VALUES (1, 'Sanitäter', 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (1, 'verfügbar', 'verfuegbar', 10)")
            .execute(&pool).await.unwrap();
        let q: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM qualifikation WHERE org_id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let s: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM personal_status WHERE org_id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
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
        let dup = sqlx::query(
            "INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Bert', 'P-100')",
        )
        .execute(&pool)
        .await;
        assert!(
            dup.is_err(),
            "doppelte aktive Personalnummer je Org muss abgelehnt werden"
        );

        // Außer Dienst gestellt → Nummer wieder frei.
        sqlx::query("UPDATE personal SET dienststatus = 'ausser_dienst' WHERE id = ?")
            .bind(p1)
            .execute(&pool)
            .await
            .unwrap();
        let wieder = sqlx::query(
            "INSERT INTO personal (org_id, name, personalnummer) VALUES (1, 'Cara', 'P-100')",
        )
        .execute(&pool)
        .await;
        assert!(
            wieder.is_ok(),
            "Nummer einer außer Dienst gestellten Person muss frei sein"
        );

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
        assert!(
            dup.is_err(),
            "dieselbe Stamm-Person doppelt im Einsatz muss abgelehnt werden"
        );

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

    #[tokio::test]
    async fn einsatz_tier_migration_legt_tabelle_und_constraints_an() {
        let pool = test_pool().await;

        // Setup: Org, Benutzer, Einsatz, eine Person (als Halter-FK-Ziel).
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
        let person_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, 1, 1) RETURNING id",
        )
        .bind(einsatz_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Gültiges Tier (Status-Default 'aktiv', spezies gesetzt).
        let tier_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'hund', 1, 1) RETURNING id",
        ).bind(einsatz_id).fetch_one(&pool).await.unwrap();
        let status: String = sqlx::query_scalar("SELECT status FROM einsatz_tier WHERE id = ?")
            .bind(tier_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "aktiv", "Status-Default ist aktiv");

        // spezies-CHECK lehnt ungültigen Wert ab.
        let bad_spezies = sqlx::query(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 2, 'dinosaurier', 1, 1)",
        ).bind(einsatz_id).execute(&pool).await;
        assert!(
            bad_spezies.is_err(),
            "ungültige spezies muss abgelehnt werden"
        );

        // status-CHECK lehnt ungültigen Wert ab.
        let bad_status = sqlx::query("UPDATE einsatz_tier SET status = 'gestohlen' WHERE id = ?")
            .bind(tier_id)
            .execute(&pool)
            .await;
        assert!(
            bad_status.is_err(),
            "ungültiger status muss abgelehnt werden"
        );

        // Halter-XOR-CHECK: beide gesetzt → Insert-Fehler.
        let bad_halter = sqlx::query(
            "INSERT INTO einsatz_tier \
                (einsatz_id, registrier_nr, spezies, halter_person_id, halter_kontakt, erfasst_von, geaendert_von) \
             VALUES (?, 3, 'katze', ?, 'Frau Müller', 1, 1)",
        ).bind(einsatz_id).bind(person_id).execute(&pool).await;
        assert!(
            bad_halter.is_err(),
            "halter_person_id UND halter_kontakt gleichzeitig muss abgelehnt werden"
        );

        // Abschluss-CHECK: status='abgeschlossen' ohne abschluss_grund → Fehler.
        let bad_abschluss =
            sqlx::query("UPDATE einsatz_tier SET status = 'abgeschlossen' WHERE id = ?")
                .bind(tier_id)
                .execute(&pool)
                .await;
        assert!(
            bad_abschluss.is_err(),
            "abgeschlossen ohne abschluss_grund muss abgelehnt werden"
        );

        // Mit abschluss_grund erlaubt.
        sqlx::query(
            "UPDATE einsatz_tier SET status = 'abgeschlossen', abschluss_grund = 'uebergabe_tierarzt' WHERE id = ?",
        ).bind(tier_id).execute(&pool).await.unwrap();

        // UNIQUE (einsatz_id, registrier_nr): doppelte Nummer je Einsatz → Fehler.
        let dup = sqlx::query(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'hund', 1, 1)",
        ).bind(einsatz_id).execute(&pool).await;
        assert!(
            dup.is_err(),
            "doppelte registrier_nr je Einsatz muss abgelehnt werden"
        );
    }

    // --- E-5 Schaden: Constraints ---

    /// Legt Org, Benutzer, Einsatz per rohem SQL an und gibt (benutzer_id, einsatz_id) zurück.
    /// Spalten gemäß Migrationen 0002/0003: benutzer.org_id, system_rolle ∈ {admin,keiner};
    /// einsatz.org_id NOT NULL, KEIN erstellt_von.
    async fn schaden_setup(pool: &sqlx::SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (name) VALUES ('O')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle) \
             VALUES (1, 'A', 'a', 'x', 'keiner', 'keine') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status) \
             VALUES (1, 'L', 'aktiv') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id)
    }

    async fn schaden_insert_min(
        pool: &sqlx::SqlitePool,
        einsatz_id: i64,
        benutzer_id: i64,
        extra_spalten: &str,
        extra_werte: &str,
    ) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
        let sql = format!(
            "INSERT INTO einsatz_schaden \
                (einsatz_id, registrier_nr, typ, ausmass, ort, erfasst_von, geaendert_von{extra_spalten}) \
             VALUES ({einsatz_id}, 1, 'sachschaden', 'gering', 'Hauptstr. 1', {benutzer_id}, {benutzer_id}{extra_werte})"
        );
        sqlx::query(sqlx::AssertSqlSafe(&*sql)).execute(pool).await
    }

    #[tokio::test]
    async fn schaden_minimal_insert_ok() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        schaden_insert_min(&pool, e, b, "", "")
            .await
            .expect("Minimal-Insert muss gehen");
    }

    #[tokio::test]
    async fn schaden_geschaedigt_xor_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_person_id, geschaedigt_kontakt",
            &format!(", {p}, 'Herr Meier'"),
        )
        .await;
        assert!(
            res.is_err(),
            "FK UND Freitext gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn schaden_status_uebergeben_braucht_adressat() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let res = schaden_insert_min(&pool, e, b, ", status", ", 'uebergeben'").await;
        assert!(
            res.is_err(),
            "status='uebergeben' ohne uebergeben_an muss CHECK verletzen"
        );
    }

    #[tokio::test]
    async fn schaden_status_abgeschlossen_braucht_grund() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let res = schaden_insert_min(&pool, e, b, ", status", ", 'abgeschlossen'").await;
        assert!(
            res.is_err(),
            "status='abgeschlossen' ohne abschluss_grund muss CHECK verletzen"
        );
    }

    #[tokio::test]
    async fn schaden_registrier_nr_unique_je_einsatz() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        schaden_insert_min(&pool, e, b, "", "").await.unwrap();
        let res = schaden_insert_min(&pool, e, b, "", "").await;
        assert!(
            res.is_err(),
            "UNIQUE(einsatz_id, registrier_nr) muss greifen"
        );
    }

    // --- E-5 Schaden: 4‑Wege-Geschädigt-Exklusivität (Migration 0033) ---

    /// Legt eine Einsatzkraft (einsatz_personal, Ad-hoc) an und liefert deren id.
    /// einsatz_id + snap_name sind NOT NULL; personal_id darf NULL sein (Ad-hoc extern).
    async fn schaden_personal(pool: &sqlx::SqlitePool, einsatz_id: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Einsatzkraft A') RETURNING id",
        )
        .bind(einsatz_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn schaden_geschaedigt_personal_einzeln_ok() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let ep = schaden_personal(&pool, e).await;
        schaden_insert_min(&pool, e, b, ", geschaedigt_personal_id", &format!(", {ep}"))
            .await
            .expect("einzelne Einsatzkraft als Geschädigter muss gehen");
    }

    #[tokio::test]
    async fn schaden_geschaedigt_organisation_einzeln_ok() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        // organisation id 1 wird in schaden_setup angelegt.
        schaden_insert_min(&pool, e, b, ", geschaedigt_organisation_id", ", 1")
            .await
            .expect("einzelne eigene Organisation als Geschädigter muss gehen");
    }

    #[tokio::test]
    async fn schaden_geschaedigt_person_und_personal_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        let ep = schaden_personal(&pool, e).await;
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_person_id, geschaedigt_personal_id",
            &format!(", {p}, {ep}"),
        )
        .await;
        assert!(
            res.is_err(),
            "Person UND Einsatzkraft gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn schaden_geschaedigt_personal_und_organisation_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let ep = schaden_personal(&pool, e).await;
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_personal_id, geschaedigt_organisation_id",
            &format!(", {ep}, 1"),
        )
        .await;
        assert!(
            res.is_err(),
            "Einsatzkraft UND Organisation gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    #[tokio::test]
    async fn schaden_geschaedigt_organisation_und_kontakt_check() {
        let pool = test_pool().await;
        let (b, e) = schaden_setup(&pool).await;
        let res = schaden_insert_min(
            &pool,
            e,
            b,
            ", geschaedigt_organisation_id, geschaedigt_kontakt",
            ", 1, 'Stadtwerke'",
        )
        .await;
        assert!(
            res.is_err(),
            "Organisation UND Freitext gleichzeitig muss vom CHECK abgelehnt werden"
        );
    }

    // --- Migration 0062: uhs FK-Integrität nach Daten-Bereinigung ---
    //
    // Was dieser Test absichert:
    // Migration 0062 migriert Altdaten (typ='bereitstellungsraum' → 'sonstige'). Der
    // Tabellen-Rebuild (CHECK-Nachzug) wurde zurückgestellt, weil sqlx-sqlite 0.8.6
    // jede Migration in einer eigenen Transaktion ausführt und `migration.no_tx` für
    // das SQLite-Backend ignoriert → `PRAGMA foreign_keys=OFF` innerhalb der Tx ist
    // ein No-op → `DROP TABLE uhs` würde eingehende FKs (uhs_platz ON DELETE CASCADE,
    // person_uhs_belegung NOT NULL) gefährden (stille Daten-Vernichtung oder Deploy-Blockade).
    //
    // Dieser Test verifiziert, dass nach allen Migrationen (test_pool() spielt die volle
    // Kette bis zur neuesten Migration ein, inkl. des 0082-Rebuilds) die `uhs`-Tabelle mit
    // ihren eingehenden FKs korrekt nutzbar ist: Einfügen
    // von uhs + uhs_platz + person_uhs_belegung und Lesen aller drei Zeilen beweist, dass
    // das Schema FK-konsistent ist.
    //
    // HINWEIS: Zum Zeitpunkt von 0062 erlaubte der DB-CHECK 'bereitstellungsraum' noch
    // (Verbot nur in UhsTyp::parse() auf Applikationsebene); dieser Test prüft daher NUR
    // die FK-Integrität, nicht die CHECK-Ablehnung. Der CHECK-Nachzug erfolgt in Migration
    // 0082 (sqlx 0.9 honoriert `-- no-transaction`); dessen Regression steht in
    // migration_0082_uhs_typ_check_ohne_bereitstellungsraum.
    #[tokio::test]
    async fn migration_0062_uhs_fk_integritaet_nach_datenbereinigung() {
        let pool = test_pool().await;

        // Minimale Stammdaten anlegen (alle NOT-NULL-FKs).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leiter', 'leiter', 'hash') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Testlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // uhs anlegen.
        let uhs_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs \
             (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'behandlungsplatz', 'BHP 1', ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .expect("uhs-Einfügen muss nach Migration funktionieren");

        // uhs_platz anlegen: FK uhs_platz.uhs_id → uhs(id) muss greifen.
        let platz_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) \
             VALUES (?, 'bett', 'Bett 1') RETURNING id",
        )
        .bind(uhs_id)
        .fetch_one(&pool)
        .await
        .expect("uhs_platz-Einfügen mit FK auf uhs muss funktionieren");

        // einsatz_person anlegen (für person_uhs_belegung.person_id).
        let ep_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person \
             (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        // person_uhs_belegung anlegen: FK .uhs_id → uhs(id) NOT NULL muss greifen.
        sqlx::query(
            "INSERT INTO person_uhs_belegung \
             (einsatz_id, person_id, uhs_id, platz_id, art, erfasst_von) \
             VALUES (?, ?, ?, ?, 'eintritt', ?)",
        )
        .bind(einsatz_id)
        .bind(ep_id)
        .bind(uhs_id)
        .bind(platz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .expect("person_uhs_belegung mit FK auf uhs muss funktionieren");

        // Alle drei Zeilen müssen existieren und FK-konsistent sein.
        let uhs_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM uhs WHERE id = ?")
            .bind(uhs_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(uhs_count, 1, "uhs-Zeile muss nach Migration vorhanden sein");

        let platz_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM uhs_platz WHERE uhs_id = ?")
                .bind(uhs_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(platz_count, 1, "uhs_platz-Zeile muss FK auf uhs tragen");

        let belegung_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM person_uhs_belegung WHERE uhs_id = ?")
                .bind(uhs_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            belegung_count, 1,
            "person_uhs_belegung-Zeile muss FK auf uhs tragen"
        );
    }

    // --- Migration 0082: uhs-typ-CHECK ohne 'bereitstellungsraum' (LFH-119 / LFH-174) ---
    //
    // Nachzug zu 0062: der FK-sichere no-tx-Rebuild (sqlx 0.9 honoriert `-- no-transaction`)
    // zieht den DB-CHECK eng nach, sodass 'bereitstellungsraum' auch auf DB-Ebene abgelehnt
    // wird (Defense-in-Depth zusätzlich zu UhsTyp::parse). Der Test verifiziert zugleich, dass
    // der Rebuild die eingehenden FKs (uhs_platz, person_uhs_belegung), die Zusatzspalten
    // (lat/lon aus 0034) und die beiden Indizes erhält.
    #[tokio::test]
    async fn migration_0082_uhs_typ_check_ohne_bereitstellungsraum() {
        let pool = test_pool().await;

        // Minimale Stammdaten (alle NOT-NULL-FKs von uhs).
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leiter', 'leiter', 'hash') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Testlage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        // 1) Alle vier gültigen Typen werden akzeptiert.
        for (i, typ) in [
            "patientenablage",
            "behandlungsplatz",
            "verletztensammelstelle",
            "sonstige",
        ]
        .iter()
        .enumerate()
        {
            sqlx::query(
                "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(einsatz_id)
            .bind(typ)
            .bind(format!("UHS {i}"))
            .bind(benutzer_id)
            .bind(benutzer_id)
            .execute(&pool)
            .await
            .unwrap_or_else(|e| panic!("gültiger typ '{typ}' muss akzeptiert werden: {e}"));
        }

        // 2) Kern von LFH-119: Der CHECK lehnt 'bereitstellungsraum' jetzt auf DB-Ebene ab.
        let bad = sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'bereitstellungsraum', 'BR 1', ?, ?)",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await;
        assert!(
            bad.is_err(),
            "typ='bereitstellungsraum' muss der DB-CHECK jetzt ablehnen"
        );

        // 3) lat/lon (Zusatzspalten aus 0034) überleben den Rebuild inhaltlich.
        let uhs_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von, lat, lon) \
             VALUES (?, 'behandlungsplatz', 'BHP Geo', ?, ?, 52.5, 13.4) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .expect("lat/lon-Spalten müssen nach dem Rebuild existieren");
        let (lat, lon): (Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT lat, lon FROM uhs WHERE id = ?")
                .bind(uhs_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            (lat, lon),
            (Some(52.5), Some(13.4)),
            "lat/lon müssen erhalten bleiben"
        );

        // 4) Eingehende FKs bleiben intakt: uhs_platz + person_uhs_belegung nutzbar.
        let platz_id: i64 = sqlx::query_scalar(
            "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) VALUES (?, 'bett', 'Bett 1') RETURNING id",
        )
        .bind(uhs_id)
        .fetch_one(&pool)
        .await
        .expect("uhs_platz-FK auf das rebuildete uhs muss greifen");
        let ep_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'betroffen', ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO person_uhs_belegung (einsatz_id, person_id, uhs_id, platz_id, art, erfasst_von) \
             VALUES (?, ?, ?, ?, 'eintritt', ?)",
        )
        .bind(einsatz_id)
        .bind(ep_id)
        .bind(uhs_id)
        .bind(platz_id)
        .bind(benutzer_id)
        .execute(&pool)
        .await
        .expect("person_uhs_belegung-FK auf das rebuildete uhs muss greifen");

        // 5) Beide Indizes wurden nach dem Table-Rebuild neu angelegt.
        let indizes: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'uhs' \
             AND name IN ('idx_uhs_einsatz', 'idx_uhs_abschnitt') ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            indizes,
            vec![
                "idx_uhs_abschnitt".to_string(),
                "idx_uhs_einsatz".to_string()
            ],
            "beide uhs-Indizes müssen nach dem Rebuild existieren"
        );

        // 6) FK-Konsistenz gesamthaft: kein dangling FK nach dem Rebuild.
        let fk_verletzungen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check()")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            fk_verletzungen, 0,
            "PRAGMA foreign_key_check muss nach dem Rebuild leer sein"
        );
    }

    // Deckt den Sicherheitsnetz-Zweig von 0082 ab (UPDATE 'bereitstellungsraum' → 'sonstige'
    // VOR dem Copy). Auf der leeren test_pool()-DB ist uhs bei 0082 leer, der Zweig greift
    // dort nie — würde man ihn entfernen, bliebe die Suite grün, während eine reale DB mit
    // einer verbliebenen 'bereitstellungsraum'-Zeile beim `INSERT … SELECT` am neuen CHECK
    // bräche (Deploy-Blockade). Hier bilden wir genau diese Alt-DB nach und wenden die ECHTE
    // Migration (include_str!) an: fehlt das Sicherheitsnetz, wird dieser Test rot.
    #[tokio::test]
    async fn migration_0082_sicherheitsnetz_bereinigt_altzeile_vor_rebuild() {
        // Isolierter Pool ohne FK-Zwang: die 0082-uhs_new-FKs zeigen auf einsatz/benutzer,
        // die hier nicht existieren — der Rebuild läuft (PRAGMA foreign_keys=OFF), und nach
        // der Migration triggern nur FK-freie SELECTs.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(false),
            )
            .await
            .expect("In-Memory-Pool");

        // uhs im ALTEN Stand: 0027-CHECK erlaubt noch 'bereitstellungsraum', + lat/lon (0034),
        // ohne FK-Klauseln (für diesen Zweig irrelevant). Spaltenmenge = 0082-Copy-Liste.
        sqlx::query(
            "CREATE TABLE uhs ( \
                id            INTEGER PRIMARY KEY AUTOINCREMENT, \
                einsatz_id    INTEGER NOT NULL, \
                abschnitt_id  INTEGER, \
                typ           TEXT    NOT NULL \
                              CHECK (typ IN ('patientenablage','behandlungsplatz', \
                                             'verletztensammelstelle','bereitstellungsraum','sonstige')), \
                bezeichnung   TEXT    NOT NULL, \
                standort      TEXT, \
                notiz         TEXT, \
                status        TEXT    NOT NULL DEFAULT 'geplant' \
                              CHECK (status IN ('geplant','aktiv','aufgeloest')), \
                erfasst_at    TEXT    NOT NULL DEFAULT '', \
                erfasst_von   INTEGER NOT NULL, \
                geaendert_at  TEXT    NOT NULL DEFAULT '', \
                geaendert_von INTEGER NOT NULL, \
                storniert_at  TEXT, \
                lat           REAL, \
                lon           REAL, \
                UNIQUE (einsatz_id, bezeichnung) \
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Alt-Zeile mit dem inzwischen verbotenen Wert + Geo (muss den Rebuild überleben).
        sqlx::query(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von, lat, lon) \
             VALUES (1, 'bereitstellungsraum', 'BR alt', 1, 1, 48.1, 11.5)",
        )
        .execute(&pool)
        .await
        .unwrap();

        // Die ECHTE Migration 0082 anwenden (Multi-Statement inkl. PRAGMA-Toggle + Rebuild).
        let migration =
            include_str!("../migrations/0082_uhs_typ_check_ohne_bereitstellungsraum.sql");
        sqlx::raw_sql(migration)
            .execute(&pool)
            .await
            .expect("0082 muss auf einer DB mit Alt-Zeile durchlaufen (Sicherheitsnetz greift)");

        // Zeile erhalten, auf 'sonstige' migriert, Geo intakt.
        let (typ, lat, lon): (String, Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT typ, lat, lon FROM uhs WHERE bezeichnung = 'BR alt'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            typ, "sonstige",
            "Alt-Zeile muss auf 'sonstige' migriert sein"
        );
        assert_eq!(
            (lat, lon),
            (Some(48.1), Some(11.5)),
            "lat/lon der Alt-Zeile müssen den Rebuild überleben"
        );

        // Kein Rest mehr mit dem verbotenen Wert.
        let rest: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM uhs WHERE typ = 'bereitstellungsraum'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            rest, 0,
            "nach 0082 darf keine 'bereitstellungsraum'-Zeile verbleiben"
        );
    }

    #[tokio::test]
    async fn migration_0083_legt_auth_provider_schema_an() {
        let pool = test_pool().await;

        // auth_provider-Tabelle existiert und ist leer (Override-Tabelle, kein Reconcile).
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_provider")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0);

        // Neue benutzer-Spalten sind vorhanden (Query würde sonst fehlschlagen).
        let cols: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('benutzer') \
             WHERE name IN ('oidc_subject','oidc_issuer','totp_secret','totp_aktiviert')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(cols, 4, "vier neue benutzer-Spalten erwartet");

        // Kind-Tabellen existieren.
        for tabelle in ["webauthn_credential", "totp_recovery_code"] {
            let da: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?",
            )
            .bind(tabelle)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(da, 1, "Tabelle {tabelle} fehlt");
        }
    }
}
