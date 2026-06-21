#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn migration_legt_befehl_tabelle_an() {
        let pool = crate::db::test_pool().await;
        // Tabelle existiert + akzeptiert Insert mit gültiger Vorlage.
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'O')").execute(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h')").execute(&pool).await.unwrap();
        let eid: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'E') RETURNING id").fetch_one(&pool).await.unwrap();
        let uid: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername='l'").fetch_one(&pool).await.unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO befehl (einsatz_id, vorlage, titel, zeitstand, abschnitte, ersteller_id) \
             VALUES (?, 'befehl_lad', 'T', '2026-06-02 10:00:00', '[]', ?) RETURNING id")
            .bind(eid).bind(uid).fetch_one(&pool).await.unwrap();
        // etb_eintrag.befehl_id existiert (additive Spalte).
        sqlx::query("SELECT befehl_id FROM etb_eintrag WHERE 0 = 1").fetch_optional(&pool).await.unwrap();
        assert!(bid > 0);
    }
}
