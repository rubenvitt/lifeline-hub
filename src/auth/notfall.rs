//! Notfallbefehl `admin-zugang-zuruecksetzen` (LLH-1493, ADR-0016): rettet einen System-Admin,
//! der seinen Passkey verloren hat, an einer Instanz mit Passkey-Pflicht, auch den letzten.
//! Läuft nur mit Zugang zur Maschine (Startbefehl gegen die Datenbank), nie über HTTP.

use crate::auth::admin_audit::{self, AdminAktion, Ziel, ZugangsAngaben};
use crate::auth::{PASSWORT_HASH_SSO_ONLY, ROLLE_ADMIN};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Name des Akteurs in der Admin-Spur: keine Person dieser Instanz.
pub const AKTEUR: &str = "Notfallbefehl am Server";

/// Ergebnis für die Ausgabe am Terminal.
#[derive(Debug)]
pub struct Zurueckgesetzt {
    pub einmalpasswort: String,
    pub passkeys_entfernt: i64,
}

/// Entfernt die Anmelde-Passkeys eines System-Admins, setzt ein Einmalpasswort mit
/// Wechselpflicht und beendet seine Sitzungen. Danach legt er nach der Anmeldung einen neuen
/// Passkey an. Ein deaktiviertes Konto bleibt deaktiviert.
pub async fn admin_zugang_zuruecksetzen(
    pool: &SqlitePool,
    benutzername: &str,
) -> Result<Zurueckgesetzt, AppError> {
    let benutzername = crate::auth::benutzername::normalisiere(benutzername)?;
    let ziel: Option<(i64, i64, String, String)> = sqlx::query_as(
        "SELECT id, org_id, system_rolle, passwort_hash FROM benutzer WHERE benutzername = ?",
    )
    .bind(benutzername)
    .fetch_optional(pool)
    .await?;
    let Some((id, org_id, rolle, passwort_hash)) = ziel else {
        return Err(AppError::UnprocessableEntity(format!(
            "Kein Konto „{benutzername}“."
        )));
    };
    if rolle != ROLLE_ADMIN {
        return Err(AppError::UnprocessableEntity(
            "Nur für System-Admins; andere Konten setzt ein Admin in der Benutzerverwaltung zurück."
                .into(),
        ));
    }
    if passwort_hash == PASSWORT_HASH_SSO_ONLY {
        return Err(AppError::UnprocessableEntity(
            "Dieses Konto meldet sich über SSO an und hat kein Passwort.".into(),
        ));
    }

    let einmalpasswort = crate::auth::passwort_wechsel::erzeuge_einmalpasswort();
    let hash = crate::auth::password::hash(&einmalpasswort)?;
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE benutzer SET passwort_hash = ?, passwort_wechsel_pflicht = 1 WHERE id = ?")
        .bind(&hash)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let passkeys_entfernt = sqlx::query("DELETE FROM webauthn_credential WHERE benutzer_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
    crate::auth::session::alle_loeschen(&mut tx, id).await?;
    tx.commit().await?;

    admin_audit::schreibe_ohne_akteur(
        pool,
        AdminAktion::EinmalpasswortVergeben,
        org_id,
        AKTEUR,
        Ziel::Benutzer { id, benutzername },
        Some(ZugangsAngaben {
            passkeys_entfernt: Some(passkeys_entfernt),
            ..Default::default()
        }),
        None,
    )
    .await;
    Ok(Zurueckgesetzt {
        einmalpasswort,
        passkeys_entfernt,
    })
}
