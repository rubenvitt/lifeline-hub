//! WebAuthn/Passkeys (LFH-275): passwortloser Login zusätzlich zu Passwort/OIDC.
//!
//! **Eager Boot-Validierung:** das `Webauthn` wird beim Serverstart gebaut; nur bei Erfolg
//! gilt der Provider als konfiguriert und das Objekt wird prozessweit gehalten ([`set_webauthn`]/
//! [`webauthn`]). Sonst bleibt der Provider ungelistet — kein Knopf, der erst beim Klick als
//! Fehlkonfiguration auffällt.
use crate::error::AppError;
use sqlx::SqlitePool;
use std::sync::OnceLock;
use uuid::Uuid;
use webauthn_rs::prelude::*;

pub mod state;
pub mod storage;

/// Prozessweit einmal gesetztes, erfolgreich gebautes `Webauthn` (OnceLock statt
/// `AppState`-Feld). Ungesetzt heißt: kein Passkey-Login möglich.
static WEBAUTHN: OnceLock<Webauthn> = OnceLock::new();

/// Einmalig beim Serverstart setzen, nachdem [`baue`] `Ok` geliefert hat; Doppelsetzen wird
/// ignoriert.
pub fn set_webauthn(w: Webauthn) {
    let _ = WEBAUTHN.set(w);
}

/// Das prozessweit gebaute `Webauthn`; `None` heißt kein Passkey-Login/Enrollment möglich.
pub fn webauthn() -> Option<&'static Webauthn> {
    WEBAUTHN.get()
}

/// Baut das `Webauthn` aus `rp_id`/`rp_origin`.
///
/// `rp_id` muss eine effektive Domain von `rp_origin` sein (keine IP), sonst `Err`; ein
/// unparsbares `rp_origin` scheitert an `Url::parse`. Nie ein Panic.
pub fn baue(rp_id: &str, rp_origin: &str) -> Result<Webauthn, AppError> {
    let origin = Url::parse(rp_origin)
        .map_err(|e| AppError::Internal(format!("WebAuthn-rp_origin ungültig: {e}")))?;
    let builder = WebauthnBuilder::new(rp_id, &origin)
        .map_err(|e| AppError::Internal(format!("WebAuthn-Konfiguration ungültig: {e}")))?;
    builder
        .build()
        .map_err(|e| AppError::Internal(format!("WebAuthn-Aufbau fehlgeschlagen: {e}")))
}

/// Opaker User-Handle für `benutzer_id`; beim ersten Aufruf zufällig erzeugt und persistiert,
/// danach stets derselbe. Register und Auth nutzen beide diese Funktion.
///
/// **Irreversibel:** der Handle ist Zufall, NIE aus `benutzer_id` abgeleitet. Authenticatoren
/// binden sich dauerhaft an `(rp_id, handle)`; eine PK-Ableitung invalidierte bei jeder
/// PK-Änderung alle Passkeys. Er enthält keine PII.
pub async fn user_handle(pool: &SqlitePool, benutzer_id: i64) -> Result<Uuid, AppError> {
    let vorhanden: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT webauthn_user_handle FROM benutzer WHERE id = ?")
            .bind(benutzer_id)
            .fetch_one(pool)
            .await?;

    if let Some(bytes) = vorhanden {
        return Uuid::from_slice(&bytes)
            .map_err(|e| AppError::Internal(format!("webauthn_user_handle korrupt: {e}")));
    }

    let neu = Uuid::new_v4();
    sqlx::query("UPDATE benutzer SET webauthn_user_handle = ? WHERE id = ?")
        .bind(neu.as_bytes().as_slice())
        .bind(benutzer_id)
        .execute(pool)
        .await?;
    Ok(neu)
}

/// Reverse-Lookup für den discoverable Login (LFH-313): der **aktive** Benutzer zu einem
/// User-Handle aus der Assertion. Deaktivierte Konten werden nicht gefunden; die Eindeutigkeit
/// sichert ein partieller UNIQUE-Index.
pub async fn benutzer_je_user_handle(
    pool: &SqlitePool,
    handle: Uuid,
) -> Result<Option<i64>, AppError> {
    let id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE webauthn_user_handle = ? AND aktiv = 1")
            .bind(handle.as_bytes().as_slice())
            .fetch_optional(pool)
            .await?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

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

    async fn pool_mit_org() -> SqlitePool {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn user_handle_ist_stabil_ueber_zwei_aufrufe() {
        let pool = pool_mit_org().await;
        let id = benutzer(&pool, "erika").await;

        let erster = user_handle(&pool, id).await.unwrap();
        let zweiter = user_handle(&pool, id).await.unwrap();

        assert_eq!(
            erster, zweiter,
            "derselbe Nutzer muss denselben Handle bekommen"
        );
    }

    #[tokio::test]
    async fn user_handle_ist_random_pro_nutzer() {
        let pool = pool_mit_org().await;
        let a = benutzer(&pool, "nutzer-a").await;
        let b = benutzer(&pool, "nutzer-b").await;

        let handle_a = user_handle(&pool, a).await.unwrap();
        let handle_b = user_handle(&pool, b).await.unwrap();

        assert_ne!(
            handle_a, handle_b,
            "zwei verschiedene Nutzer dürfen NIE denselben Handle bekommen"
        );
    }

    #[tokio::test]
    async fn user_handle_wird_bei_null_generiert_und_persistiert() {
        let pool = pool_mit_org().await;
        let id = benutzer(&pool, "frisch").await;

        // Vorbedingung: Spalte ist frisch nach Anlage NULL (No-op-Default).
        let vor: Option<Vec<u8>> =
            sqlx::query_scalar("SELECT webauthn_user_handle FROM benutzer WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(vor.is_none(), "vor dem ersten Aufruf ist der Handle NULL");

        let handle = user_handle(&pool, id).await.unwrap();

        let nach: Option<Vec<u8>> =
            sqlx::query_scalar("SELECT webauthn_user_handle FROM benutzer WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            nach.as_deref(),
            Some(handle.as_bytes().as_slice()),
            "der generierte Handle muss 1:1 in der Spalte landen"
        );
    }

    #[tokio::test]
    async fn benutzer_je_user_handle_findet_aktiven_benutzer() {
        let pool = pool_mit_org().await;
        let id = benutzer(&pool, "erika").await;
        // Handle erzeugen + persistieren, dann rückwärts auflösen.
        let handle = user_handle(&pool, id).await.unwrap();

        let gefunden = benutzer_je_user_handle(&pool, handle).await.unwrap();

        assert_eq!(gefunden, Some(id));
    }

    #[tokio::test]
    async fn benutzer_je_user_handle_liefert_none_bei_unbekanntem_handle() {
        let pool = pool_mit_org().await;
        let _ = benutzer(&pool, "erika").await;

        let gefunden = benutzer_je_user_handle(&pool, Uuid::new_v4())
            .await
            .unwrap();

        assert!(gefunden.is_none());
    }

    #[tokio::test]
    async fn benutzer_je_user_handle_ignoriert_deaktivierten_benutzer() {
        // Ein deaktiviertes Konto darf sich nicht per Passkey anmelden.
        let pool = pool_mit_org().await;
        let id = benutzer(&pool, "erika").await;
        let handle = user_handle(&pool, id).await.unwrap();
        sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();

        let gefunden = benutzer_je_user_handle(&pool, handle).await.unwrap();

        assert!(
            gefunden.is_none(),
            "deaktivierter Benutzer darf nicht über den Handle auflösbar sein"
        );
    }

    #[test]
    fn baue_ok_bei_validem_hostname_und_origin() {
        let ergebnis = baue("localhost", "https://localhost:8443");
        assert!(
            ergebnis.is_ok(),
            "gültiger Hostname-rp_id + passende Origin muss bauen: {:?}",
            ergebnis.err()
        );
    }

    #[test]
    fn baue_err_bei_ip_basierter_rp_id() {
        // Auf einer IP-Origin funktioniert WebAuthn nicht; der Bau muss scheitern.
        let ergebnis = baue("192.168.1.5", "https://192.168.1.5:8443");
        assert!(ergebnis.is_err(), "IP-basierte rp_id/Origin muss scheitern");
    }

    #[test]
    fn baue_err_bei_kaputtem_origin() {
        let ergebnis = baue("localhost", "das-ist-keine-url");
        assert!(ergebnis.is_err(), "unparsbare Origin muss scheitern");
    }

    #[test]
    fn baue_err_bei_rp_id_mismatch() {
        // rp_id passt nicht zur Origin-Domain — Fehlkonfiguration, die der Boot-Bau abfangen muss.
        let ergebnis = baue("example.com", "https://idm.different.example");
        assert!(ergebnis.is_err(), "rp_id/Origin-Mismatch muss scheitern");
    }
}
