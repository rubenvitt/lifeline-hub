//! Passwort-Provider — extrahierte Login-Logik (verhaltensneutral aus routes/auth.rs).
use crate::auth::{password, Benutzer};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Prüft Anmeldedaten und liefert den aktiven Benutzer. `AppError::Unauthorized`
/// bei unbekanntem Benutzer ODER falschem Passwort. Gleicht die Antwortzeit an
/// (Wegwerf-Hash), damit sich existierende Benutzer nicht per Timing enumerieren lassen.
pub async fn anmelden(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
) -> Result<Benutzer, AppError> {
    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
    )
    .bind(benutzername)
    .fetch_optional(pool)
    .await?;

    match benutzer {
        Some(b) if password::verifizieren(passwort, &b.passwort_hash) => Ok(b),
        Some(_) => Err(AppError::Unauthorized),
        None => {
            let _ = password::hash(passwort);
            Err(AppError::Unauthorized)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn benutzer_mit_pw(pool: &SqlitePool, pw: &str) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let hash = password::hash(pw).unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Max', 'max', ?, 1)",
        )
        .bind(hash)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn korrektes_passwort_meldet_an() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let b = anmelden(&pool, "max", "geheim123").await.unwrap();
        assert_eq!(b.benutzername, "max");
    }

    #[tokio::test]
    async fn falsches_passwort_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let err = anmelden(&pool, "max", "falsch").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn unbekannter_benutzer_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let err = anmelden(&pool, "niemand", "geheim123").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }
}
