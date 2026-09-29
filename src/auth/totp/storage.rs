//! Recovery-Code-Persistenz (LFH-43): die Einmal-Codes stehen nie im Klartext, nur als
//! SHA-256 in `totp_recovery_code`.
//!
//! [`verbrauche_recovery_code`] ist EIN bedingtes `UPDATE … AND benutzt_at IS NULL` mit
//! Prüfung von `rows_affected() == 1`, kein SELECT-then-UPDATE: das hätte ein
//! Double-Spend-Fenster für zwei nebenläufige Requests mit demselben Code.

use sqlx::SqlitePool;

use crate::auth::totp::hash_recovery;
use crate::error::AppError;

/// Ersetzt die Recovery-Codes von `benutzer_id` (Erst- und Re-Enroll; alte Codes werden damit
/// ungültig). DELETE und INSERTs laufen in einer Transaktion, damit ein Fehler niemanden ohne
/// gültige Codes zurücklässt.
pub async fn speichere_recovery_codes(
    pool: &SqlitePool,
    benutzer_id: i64,
    codes_klartext: &[String],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM totp_recovery_code WHERE benutzer_id = ?")
        .bind(benutzer_id)
        .execute(&mut *tx)
        .await?;

    for code in codes_klartext {
        let hash = hash_recovery(code);
        sqlx::query("INSERT INTO totp_recovery_code (benutzer_id, code_hash) VALUES (?, ?)")
            .bind(benutzer_id)
            .bind(hash)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Verbraucht EINEN Recovery-Code atomar: `true`, wenn der Code zu `benutzer_id` gehört und
/// noch unbenutzt war (er ist dann als benutzt markiert); sonst `false`.
pub async fn verbrauche_recovery_code(
    pool: &SqlitePool,
    benutzer_id: i64,
    code_klartext: &str,
) -> Result<bool, AppError> {
    let hash = hash_recovery(code_klartext);

    let ergebnis = sqlx::query(
        "UPDATE totp_recovery_code SET benutzt_at = datetime('now') \
         WHERE benutzer_id = ? AND code_hash = ? AND benutzt_at IS NULL",
    )
    .bind(benutzer_id)
    .bind(hash)
    .execute(pool)
    .await?;

    Ok(ergebnis.rows_affected() == 1)
}

/// Löscht alle Recovery-Codes von `benutzer_id` (Admin-Reset). Executor-generisch, damit der
/// Reset in derselben Transaktion wie das Zurücksetzen von `totp_secret` läuft.
pub async fn loesche_recovery_codes(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM totp_recovery_code WHERE benutzer_id = ?")
        .bind(benutzer_id)
        .execute(executor)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool_mit_org() -> SqlitePool {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn benutzer(pool: &SqlitePool, benutzername: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'X', ?, 'h') RETURNING id",
        )
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn verbrauche_recovery_code_akzeptiert_gueltigen_code_genau_einmal() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        let codes = vec!["aaaa-1111".to_string(), "bbbb-2222".to_string()];
        speichere_recovery_codes(&pool, benutzer_id, &codes)
            .await
            .unwrap();

        let erster_verbrauch = verbrauche_recovery_code(&pool, benutzer_id, "aaaa-1111")
            .await
            .unwrap();
        assert!(
            erster_verbrauch,
            "gültiger, unbenutzter Code muss true liefern"
        );

        let zweiter_verbrauch = verbrauche_recovery_code(&pool, benutzer_id, "aaaa-1111")
            .await
            .unwrap();
        assert!(
            !zweiter_verbrauch,
            "derselbe Code darf kein zweites Mal verbrauchbar sein (single-use)"
        );
    }

    #[tokio::test]
    async fn verbrauche_recovery_code_lehnt_unbekannten_code_ab() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        speichere_recovery_codes(&pool, benutzer_id, &["aaaa-1111".to_string()])
            .await
            .unwrap();

        let ergebnis = verbrauche_recovery_code(&pool, benutzer_id, "nie-vergeben")
            .await
            .unwrap();

        assert!(!ergebnis);
    }

    #[tokio::test]
    async fn verbrauche_recovery_code_ist_an_benutzer_id_gebunden() {
        let pool = pool_mit_org().await;
        let erika = benutzer(&pool, "erika").await;
        let max = benutzer(&pool, "max").await;
        speichere_recovery_codes(&pool, erika, &["aaaa-1111".to_string()])
            .await
            .unwrap();

        // Max versucht Erikas Code zu verbrauchen — muss scheitern, obwohl der Hash existiert.
        let ergebnis = verbrauche_recovery_code(&pool, max, "aaaa-1111")
            .await
            .unwrap();
        assert!(
            !ergebnis,
            "Code eines anderen Nutzers darf nicht verbrauchbar sein"
        );

        // Erikas eigener Code ist nicht fälschlich als benutzt markiert.
        let eigener_verbrauch = verbrauche_recovery_code(&pool, erika, "aaaa-1111")
            .await
            .unwrap();
        assert!(eigener_verbrauch);
    }

    #[tokio::test]
    async fn loesche_recovery_codes_entfernt_alle_codes_des_nutzers() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        speichere_recovery_codes(
            &pool,
            benutzer_id,
            &["aaaa-1111".to_string(), "bbbb-2222".to_string()],
        )
        .await
        .unwrap();

        loesche_recovery_codes(&pool, benutzer_id).await.unwrap();

        let ergebnis = verbrauche_recovery_code(&pool, benutzer_id, "aaaa-1111")
            .await
            .unwrap();
        assert!(
            !ergebnis,
            "nach dem Löschen darf kein vorher gültiger Code mehr verbrauchbar sein"
        );
    }

    #[tokio::test]
    async fn speichere_recovery_codes_ersetzt_vorhandene_codes() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        speichere_recovery_codes(&pool, benutzer_id, &["alt-code".to_string()])
            .await
            .unwrap();

        // Re-Enroll: neue Codes ersetzen die alten.
        speichere_recovery_codes(&pool, benutzer_id, &["neu-code".to_string()])
            .await
            .unwrap();

        let alter_code_noch_gueltig = verbrauche_recovery_code(&pool, benutzer_id, "alt-code")
            .await
            .unwrap();
        assert!(
            !alter_code_noch_gueltig,
            "alter Code muss durch Re-Enroll invalidiert sein"
        );

        let neuer_code_gueltig = verbrauche_recovery_code(&pool, benutzer_id, "neu-code")
            .await
            .unwrap();
        assert!(
            neuer_code_gueltig,
            "neuer Code muss nach Re-Enroll gültig sein"
        );
    }

    #[tokio::test]
    async fn speichere_recovery_codes_speichert_nur_hashes_kein_klartext() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer_id = benutzer(&pool, "erika").await;

        let codes = crate::auth::totp::neue_recovery_codes();
        assert_eq!(codes.len(), 10);
        speichere_recovery_codes(&pool, benutzer_id, &codes)
            .await
            .unwrap();

        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM totp_recovery_code WHERE benutzer_id = ?")
                .bind(benutzer_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 10);

        let gespeicherte_hashes: Vec<String> =
            sqlx::query_scalar("SELECT code_hash FROM totp_recovery_code WHERE benutzer_id = ?")
                .bind(benutzer_id)
                .fetch_all(&pool)
                .await
                .unwrap();

        for hash in &gespeicherte_hashes {
            assert_eq!(hash.len(), 64, "sha256-Hex sollte 64 Zeichen haben: {hash}");
            assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(
                !codes.contains(hash),
                "gespeicherter Wert darf kein Klartext-Code sein"
            );
        }
    }
}
