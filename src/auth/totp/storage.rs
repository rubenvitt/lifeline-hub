//! Recovery-Code-Persistenz (LFH-43, Increment 5 „MFA/TOTP"): die zehn bei einem
//! TOTP-Enrollment ausgegebenen Einmal-Codes (`totp::neue_recovery_codes`) werden NIE im
//! Klartext gespeichert, nur als sha256-Hash (`totp::hash_recovery`) in
//! `totp_recovery_code` (Migration 0083).
//!
//! **[MUST — Plan „Global Constraints", atomarer single-use Verbrauch]:**
//! [`verbrauche_recovery_code`] ist EIN einzelnes `UPDATE ... WHERE ... AND benutzt_at IS
//! NULL` + `rows_affected() == 1`-Prüfung — bewusst KEIN SELECT-then-UPDATE. Ein
//! SELECT-then-UPDATE hätte ein Double-Spend-Race-Fenster (zwei nebenläufige Requests mit
//! demselben Code sehen beide das SELECT-Ergebnis „unbenutzt", bevor einer von ihnen
//! schreibt); das einzelne bedingte UPDATE macht SQLite den Race für uns dicht.

use sqlx::SqlitePool;

use crate::auth::totp::hash_recovery;
use crate::error::AppError;

/// Ersetzt die Recovery-Codes von `benutzer_id`: löscht alle vorhandenen Zeilen und legt für
/// jeden Klartext-Code aus `codes_klartext` eine neue Zeile mit `hash_recovery(code)` an. Wird
/// bei Erst-Enrollment UND bei jedem Re-Enroll aufgerufen (Re-Enroll erzeugt frische Codes und
/// invalidiert damit alte automatisch — kein separater „alte Codes löschen"-Schritt nötig).
///
/// DELETE + INSERTs laufen in einer Transaktion, damit ein Fehler mitten in den INSERTs nicht
/// einen Nutzer ohne jegliche gültigen Recovery-Codes zurücklässt (weder alte noch neue).
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

/// Verbraucht EINEN Recovery-Code atomar-einmalig: `true`, wenn `code_klartext` (gehasht) zu
/// `benutzer_id` einen noch unbenutzten Code trifft (und ihn dabei als benutzt markiert);
/// `false` bei unbekanntem Hash, bereits verbrauchtem Code oder einem Code, der zu einem
/// ANDEREN Nutzer gehört.
///
/// **Atomar per Konstruktion:** ein einzelnes `UPDATE ... WHERE benutzer_id = ? AND
/// code_hash = ? AND benutzt_at IS NULL`, dessen `rows_affected()` entscheidet — kein
/// vorheriges SELECT, das ein Double-Spend-Race öffnen würde (s. Moduldoc).
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

/// Löscht alle Recovery-Codes von `benutzer_id` (Admin-Reset, Task 6: keine stale Codes nach
/// einem `totp_secret`-Reset). Executor-generisch (Präzedenz `gefahr::repo::gebiet_anlegen`),
/// damit der Aufrufer (`routes::benutzer::totp_reset`) sie in DERSELBEN Transaktion wie das
/// `UPDATE benutzer SET totp_secret = NULL, totp_aktiviert = 0 ...` aufrufen kann (Plan-MUST
/// „Admin-Reset in einer Transaktion") — mit `&SqlitePool` weiterhin genauso aufrufbar wie
/// bisher (s. Tests unten).
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

        // Erikas eigener Verbrauch muss weiterhin funktionieren (Code ist nicht fälschlich
        // als benutzt markiert worden).
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
