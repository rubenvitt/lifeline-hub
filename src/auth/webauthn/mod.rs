//! WebAuthn/Passkeys (LFH-275, Increment 4): app-eigener Passkey-Provider. Ein registrierter
//! Nutzer legt aus seinem Profil einen Passkey an, danach ist passwortloser Login möglich —
//! zusätzlich zu Passwort/OIDC.
//!
//! **Eager Boot-Validierung (MUST):** `WebauthnBuilder::new(rp_id, &rp_origin)?.build()?` wird
//! beim Serverstart versucht (`main::run_server`); nur bei `Ok` wird der Provider als
//! konfiguriert markiert (`registry::set_webauthn_konfiguriert`) UND das gebaute `Webauthn`
//! prozessweit gehalten ([`set_webauthn`]/[`webauthn`]). Bei `Err`/fehlender Config bleibt der
//! Provider ungelistet — kein Fake-Button, der erst beim Klick als Fehlkonfiguration auffällt
//! (direkte Anwendung des OIDC-redirect_url-Footgun-Fixes). Keine lazy/offline-Discovery-
//! Maschinerie nötig: WebAuthn ruft nichts übers Netz auf.
use crate::error::AppError;
use sqlx::SqlitePool;
use std::sync::OnceLock;
use uuid::Uuid;
use webauthn_rs::prelude::*;

pub mod state;
pub mod storage;

/// Prozessweit EINMAL (beim Serverstart, nach erfolgreichem [`baue`]) gesetztes `Webauthn` —
/// OnceLock statt `AppState`-Feld, analog zu `oidc::OIDC_SETTINGS`/`anhang::ScanConfig` (LFH-114):
/// bricht keine der vielen inline-`AppState`-Testkonstruktionen (Memory:
/// appstate-feld-bricht-test-konstruktionen). Anders als `OidcSettings` (rohe Config, immer
/// gesetzt) hält dieser OnceLock das bereits erfolgreich GEBAUTE Objekt — ungesetzt heißt: der
/// Boot-Bau ist fehlgeschlagen/die Config fehlt, kein Passkey-Login möglich.
static WEBAUTHN: OnceLock<Webauthn> = OnceLock::new();

/// Einmalig beim Serverstart setzen (`main::run_server`), NACHDEM [`baue`] `Ok` geliefert hat.
/// Doppelsetzen wird ignoriert (wie `oidc::init_oidc_settings`/`registry::set_oidc_konfiguriert`).
pub fn set_webauthn(w: Webauthn) {
    let _ = WEBAUTHN.set(w);
}

/// Liefert das prozessweit gebaute `Webauthn`, sofern der Boot-Bau erfolgreich war. `None`
/// heißt: kein Passkey-Login/Enrollment möglich (fehlende/kaputte `rp_id`/`rp_origin`-Config) —
/// spätere Endpoints (Task 5/6) müssen das behandeln (z.B. 404, analog zum inaktiven Provider).
pub fn webauthn() -> Option<&'static Webauthn> {
    WEBAUTHN.get()
}

/// Baut das `Webauthn`-Objekt aus `rp_id`/`rp_origin` (eager Boot-Validierung, Plan-MUST).
///
/// `rp_id` MUSS eine effektive Domain von `rp_origin` sein (KEINE IP) — `WebauthnBuilder`
/// prüft das selbst (`rp_origin.domain()` liefert bei IP-Hosts `None`) und liefert sonst `Err`.
/// Ein kaputtes `rp_origin` (kein parsbarer URL) scheitert schon vorher an `Url::parse`.
/// Beides ist NIE ein Panic — der Aufrufer (`main::run_server`) loggt `warn!` und listet den
/// Provider einfach nicht.
pub fn baue(rp_id: &str, rp_origin: &str) -> Result<Webauthn, AppError> {
    let origin = Url::parse(rp_origin)
        .map_err(|e| AppError::Internal(format!("WebAuthn-rp_origin ungültig: {e}")))?;
    let builder = WebauthnBuilder::new(rp_id, &origin)
        .map_err(|e| AppError::Internal(format!("WebAuthn-Konfiguration ungültig: {e}")))?;
    builder
        .build()
        .map_err(|e| AppError::Internal(format!("WebAuthn-Aufbau fehlgeschlagen: {e}")))
}

/// Liefert den gespeicherten Opaque-User-Handle für `benutzer_id`; ist er NULL (erster Aufruf),
/// wird ein neuer zufälliger [`Uuid::new_v4`] erzeugt, persistiert und zurückgegeben — danach
/// idempotent derselbe Wert.
///
/// **MUST (irreversibel):** der Handle ist ein gespeicherter Zufallswert, NIEMALS aus
/// `benutzer_id` abgeleitet — Authenticatoren binden sich an `(rp_id, handle)` dauerhaft, eine
/// Ableitung aus der laufenden PK würde später den Wechsel auf discoverable/usernameless Login
/// verbauen und eine PK-Änderung würde jeden Passkey invalidieren. Der Handle enthält keinerlei
/// PII (reine `Uuid::new_v4`-Zufallsbytes). EINE Quelle für Register UND Auth (beide Ceremonien
/// rufen diese Funktion).
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
        // WebauthnBuilder verlangt rp_id als effektive Domain von rp_origin — bei einer
        // IP-Origin liefert `Url::domain()` `None`, also scheitert der Bau (Boot-Validierungs-
        // MUST: WebAuthn funktioniert grundsätzlich nicht auf reinen IP-Origins).
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
        // rp_id passt nicht zur Origin-Domain — auch das ist eine Fehlkonfiguration, die der
        // Boot-Bau abfangen muss (kein Fake-Button, der erst beim ersten Klick scheitert).
        let ergebnis = baue("example.com", "https://idm.different.example");
        assert!(ergebnis.is_err(), "rp_id/Origin-Mismatch muss scheitern");
    }
}
