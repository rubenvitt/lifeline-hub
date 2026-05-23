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
}
