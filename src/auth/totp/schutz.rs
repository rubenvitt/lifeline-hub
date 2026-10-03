//! Schutz des zweiten Faktors gegen Durchprobieren und Wiederverwendung (LFH-791).
//!
//! **Sperre je Benutzer:** [`MAX_FEHLVERSUCHE`] aufeinanderfolgende Versuche ohne Erfolg in
//! `/auth/totp/finish` sperren den zweiten Faktor dieses Benutzers für [`SPERRE_SEKUNDEN`]. Jeder
//! Anlauf `login` → `totp/finish` holt sich mit dem richtigen Passwort einen frischen
//! Pending-Key; ohne diese Zählung je Benutzer bremste nur die Sperre je Quelle
//! (`auth::rate_limit`), und die lässt sich mit wechselnden Adressen umgehen. Erreichbar ist die
//! Sperre nur mit dem richtigen Passwort; ein Erfolg räumt den Zähler. Recovery-Codes (80 Bit,
//! nicht zu raten) laufen an ihr vorbei (`totp::ist_recovery_form`): sonst könnte, wer das
//! Passwort kennt, das Konto mit fünf falschen Codes je Sperrfenster auf Dauer aussperren. Bei 5 Versuchen je
//! 15 Minuten und höchstens drei gültigen Codes je Fenster braucht Raten im Erwartungswert
//! Jahre statt Stunden.
//!
//! **Replay-Schutz (RFC 6238 §5.2):** [`schritt_annehmen`] merkt den zuletzt angenommenen
//! Zeitschritt und nimmt nur spätere an. Ein mitgelesener Code gilt damit genau einmal, auch im
//! ±1-Skew-Fenster und bei zwei gleichzeitigen Anfragen (ein bedingtes `UPDATE`).
//!
//! Beides steht in `benutzer` (Migration `0144_totp_schutz.sql`), nicht im Prozess: die Sperre
//! übersteht einen Neustart, und Testläufe mit eigener Datenbank stören sich nicht.

use sqlx::SqlitePool;

use crate::error::AppError;

/// Aufeinanderfolgende Fehlversuche am zweiten Faktor, ab denen er gesperrt wird.
pub const MAX_FEHLVERSUCHE: u32 = 5;

/// Dauer der Sperre in Sekunden.
pub const SPERRE_SEKUNDEN: i64 = 15 * 60;

/// Beginnt einen Versuch am zweiten Faktor: `false` heißt gesperrt (429), die Codeprüfung
/// unterbleibt. Sonst zählt der Versuch **vorab** als Fehlversuch, und [`erfolg`] nimmt ihn
/// zurück. Erreicht der Zähler damit [`MAX_FEHLVERSUCHE`], beginnt die Sperre gleich, und der
/// Zähler steht wieder auf null: nach ihrem Ablauf gibt es die nächsten Versuche.
///
/// **Prüfen und Zählen in einem `UPDATE`.** Getrennt (erst lesen, nach der Codeprüfung zählen)
/// passierten beliebig viele gleichzeitige Anfragen die Prüfung, bevor der erste Fehlversuch
/// zählt: wer das Passwort kennt, sammelt Pending-Keys und schickt die Codes auf einmal. So
/// bekommt höchstens [`MAX_FEHLVERSUCHE`] Anfragen je Sperrfenster eine Codeprüfung. Alle
/// Ausdrücke in `SET` lesen die Werte vor der Änderung.
pub async fn versuch_beginnen(
    pool: &SqlitePool,
    benutzer_id: i64,
    jetzt_unix: i64,
) -> Result<bool, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE benutzer SET \
           totp_fehlversuche = CASE WHEN totp_fehlversuche + 1 >= ?1 THEN 0 \
                                    ELSE totp_fehlversuche + 1 END, \
           totp_gesperrt_bis = CASE WHEN totp_fehlversuche + 1 >= ?1 THEN ?2 \
                                    ELSE totp_gesperrt_bis END \
         WHERE id = ?3 AND (totp_gesperrt_bis IS NULL OR totp_gesperrt_bis <= ?4)",
    )
    .bind(MAX_FEHLVERSUCHE)
    .bind(jetzt_unix + SPERRE_SEKUNDEN)
    .bind(benutzer_id)
    .bind(jetzt_unix)
    .execute(pool)
    .await?;
    Ok(ergebnis.rows_affected() == 1)
}

/// Räumt Zähler und Sperre nach einem bestandenen zweiten Faktor, auch den vorab gezählten
/// Versuch aus [`versuch_beginnen`].
pub async fn erfolg(pool: &SqlitePool, benutzer_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE benutzer SET totp_fehlversuche = 0, totp_gesperrt_bis = NULL WHERE id = ?")
        .bind(benutzer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Nimmt den Zeitschritt `schritt` eines gültigen Codes an, wenn er nach dem zuletzt
/// angenommenen liegt, und merkt ihn sich. `false` heißt: dieser oder ein späterer Schritt galt
/// schon, der Code ist verbraucht.
pub async fn schritt_annehmen(
    pool: &SqlitePool,
    benutzer_id: i64,
    schritt: u64,
) -> Result<bool, AppError> {
    let schritt = i64::try_from(schritt)
        .map_err(|_| AppError::Internal("TOTP-Zeitschritt außerhalb von i64".to_string()))?;
    let ergebnis = sqlx::query(
        "UPDATE benutzer SET totp_letzter_schritt = ?1 \
         WHERE id = ?2 AND (totp_letzter_schritt IS NULL OR totp_letzter_schritt < ?1)",
    )
    .bind(schritt)
    .bind(benutzer_id)
    .execute(pool)
    .await?;
    Ok(ergebnis.rows_affected() == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    const JETZT: i64 = 1_700_000_000;

    async fn pool_mit_benutzer() -> (SqlitePool, i64) {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let id = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'X', 'erika', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        (pool, id)
    }

    /// Ein Versuch, der nicht gelingt: so zählt ihn der Handler (vorab, ohne `erfolg`).
    async fn fehlversuch(pool: &SqlitePool, id: i64, jetzt: i64) -> bool {
        versuch_beginnen(pool, id, jetzt).await.unwrap()
    }

    #[tokio::test]
    async fn sperrt_erst_ab_der_schwelle_und_nur_fuer_die_sperrdauer() {
        let (pool, id) = pool_mit_benutzer().await;
        for i in 0..MAX_FEHLVERSUCHE {
            assert!(fehlversuch(&pool, id, JETZT).await, "Versuch {i} ist frei");
        }
        assert!(!versuch_beginnen(&pool, id, JETZT).await.unwrap());
        assert!(!versuch_beginnen(&pool, id, JETZT + SPERRE_SEKUNDEN - 1)
            .await
            .unwrap());
        assert!(
            versuch_beginnen(&pool, id, JETZT + SPERRE_SEKUNDEN)
                .await
                .unwrap(),
            "die Sperre läuft von selbst aus"
        );
    }

    #[tokio::test]
    async fn nach_der_sperre_zaehlt_der_naechste_block_von_vorn() {
        let (pool, id) = pool_mit_benutzer().await;
        for _ in 0..MAX_FEHLVERSUCHE {
            fehlversuch(&pool, id, JETZT).await;
        }
        let danach = JETZT + SPERRE_SEKUNDEN;
        for i in 0..MAX_FEHLVERSUCHE {
            assert!(fehlversuch(&pool, id, danach).await, "Versuch {i} danach");
        }
        assert!(!versuch_beginnen(&pool, id, danach).await.unwrap());
    }

    #[tokio::test]
    async fn erfolg_raeumt_zaehler_und_sperre() {
        let (pool, id) = pool_mit_benutzer().await;
        for _ in 0..MAX_FEHLVERSUCHE - 1 {
            fehlversuch(&pool, id, JETZT).await;
        }
        // Der letzte freie Versuch gelingt: er hat die Sperre schon begonnen, `erfolg` räumt sie.
        assert!(versuch_beginnen(&pool, id, JETZT).await.unwrap());
        erfolg(&pool, id).await.unwrap();
        for i in 0..MAX_FEHLVERSUCHE {
            assert!(
                fehlversuch(&pool, id, JETZT).await,
                "nur aufeinanderfolgende Fehlversuche zählen (Versuch {i})"
            );
        }
    }

    /// Gleichzeitige Versuche: höchstens die Schwelle kommt zur Codeprüfung, nicht alle, die
    /// vor dem ersten gezählten Fehlversuch eintreffen.
    #[tokio::test]
    async fn gleichzeitige_versuche_kommen_hoechstens_bis_zur_schwelle() {
        let (pool, id) = pool_mit_benutzer().await;
        let laeufe: Vec<_> = (0..40)
            .map(|_| {
                let pool = pool.clone();
                tokio::spawn(async move { versuch_beginnen(&pool, id, JETZT).await.unwrap() })
            })
            .collect();
        let mut frei = 0;
        for lauf in laeufe {
            if lauf.await.unwrap() {
                frei += 1;
            }
        }
        assert_eq!(frei, MAX_FEHLVERSUCHE);
    }

    #[tokio::test]
    async fn schritt_gilt_genau_einmal_und_fruehere_nicht_mehr() {
        let (pool, id) = pool_mit_benutzer().await;
        assert!(schritt_annehmen(&pool, id, 100).await.unwrap());
        assert!(
            !schritt_annehmen(&pool, id, 100).await.unwrap(),
            "derselbe Schritt ist verbraucht"
        );
        assert!(
            !schritt_annehmen(&pool, id, 99).await.unwrap(),
            "ein früherer Schritt (Skew) gilt nach einem späteren nicht mehr"
        );
        assert!(schritt_annehmen(&pool, id, 101).await.unwrap());
    }

    #[tokio::test]
    async fn unbekannter_benutzer_bekommt_keinen_versuch_und_keinen_schritt() {
        let (pool, _) = pool_mit_benutzer().await;
        assert!(!versuch_beginnen(&pool, 9999, JETZT).await.unwrap());
        assert!(!schritt_annehmen(&pool, 9999, 1).await.unwrap());
    }
}
