//! Passkey-Persistenz (LFH-275): der opak als JSON serialisierte `Passkey` in
//! `webauthn_credential.passkey_json` ist die Quelle der Wahrheit. `credential_id` ist nur
//! Indexspalte (Lookup, UNIQUE, `exclude_credentials`).
//!
//! Die Altspalten `public_key`/`sign_count` werden nicht befüllt: `Passkey` legt Schlüssel und
//! Counter nicht offen (nur über das Feature `danger-credential-internals`, das die opake
//! Speicherung unterliefe). `sign_count` bleibt beim `DEFAULT 0`, `public_key` bekommt einen
//! expliziten leeren Blob statt vorgetäuschter Schlüsseldaten.

use crate::error::AppError;
use sqlx::SqlitePool;
use webauthn_rs::prelude::Passkey;

/// Speichert einen frisch registrierten Passkey. Eine schon vorhandene `credential_id` liefert
/// `AppError::Conflict` (409) statt 500.
pub async fn speichere_passkey(
    pool: &SqlitePool,
    benutzer_id: i64,
    passkey: &Passkey,
) -> Result<(), AppError> {
    let credential_id: &[u8] = passkey.cred_id().as_ref();
    let passkey_json = serde_json::to_string(passkey)
        .map_err(|e| AppError::Internal(format!("Passkey-Serialisierung fehlgeschlagen: {e}")))?;

    let ergebnis = sqlx::query(
        "INSERT INTO webauthn_credential (benutzer_id, credential_id, public_key, passkey_json) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(benutzer_id)
    .bind(credential_id)
    // Altspalte: leerer Blob statt vorgetäuschter Schlüsseldaten (s. Modul-Doku); `sign_count`
    // fällt auf `DEFAULT 0`.
    .bind(Vec::<u8>::new())
    .bind(&passkey_json)
    .execute(pool)
    .await;

    match ergebnis {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Passkey bereits registriert".to_string(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Lädt alle Passkeys von `benutzer_id` (für `exclude_credentials` und
/// `start_passkey_authentication`).
pub async fn passkeys_fuer_benutzer(
    pool: &SqlitePool,
    benutzer_id: i64,
) -> Result<Vec<Passkey>, AppError> {
    let zeilen: Vec<String> =
        sqlx::query_scalar("SELECT passkey_json FROM webauthn_credential WHERE benutzer_id = ?")
            .bind(benutzer_id)
            .fetch_all(pool)
            .await?;

    zeilen
        .into_iter()
        .map(|json| {
            serde_json::from_str(&json).map_err(|e| {
                AppError::Internal(format!("Passkey-Deserialisierung fehlgeschlagen: {e}"))
            })
        })
        .collect()
}

/// Sucht den Passkey zu einer `credential_id` (wie sie z. B. aus einer Auth-Antwort des
/// Clients kommt) und liefert `(benutzer_id, Passkey)`. `None`, wenn keine Zeile passt.
pub async fn passkey_je_credential_id(
    pool: &SqlitePool,
    cred_id: &[u8],
) -> Result<Option<(i64, Passkey)>, AppError> {
    let zeile: Option<(i64, String)> = sqlx::query_as(
        "SELECT benutzer_id, passkey_json FROM webauthn_credential WHERE credential_id = ?",
    )
    .bind(cred_id)
    .fetch_optional(pool)
    .await?;

    zeile
        .map(|(benutzer_id, json)| {
            serde_json::from_str(&json)
                .map(|passkey| (benutzer_id, passkey))
                .map_err(|e| {
                    AppError::Internal(format!("Passkey-Deserialisierung fehlgeschlagen: {e}"))
                })
        })
        .transpose()
}

/// Schreibt den per `Passkey::update_credential` fortgeschriebenen Passkey zurück — die
/// Clone-Erkennung ist nur so stark wie der zurückgeschriebene Counter.
///
/// `NotFound`, wenn die `credential_id` inzwischen fehlt; ein stiller Erfolg würde das
/// Rückschreiben nur vortäuschen.
pub async fn aktualisiere_counter(pool: &SqlitePool, passkey: &Passkey) -> Result<(), AppError> {
    let credential_id: &[u8] = passkey.cred_id().as_ref();
    let passkey_json = serde_json::to_string(passkey)
        .map_err(|e| AppError::Internal(format!("Passkey-Serialisierung fehlgeschlagen: {e}")))?;

    let ergebnis =
        sqlx::query("UPDATE webauthn_credential SET passkey_json = ? WHERE credential_id = ?")
            .bind(&passkey_json)
            .bind(credential_id)
            .execute(pool)
            .await?;

    if ergebnis.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use webauthn_rs::prelude::Credential;
    use webauthn_rs_core::proto::{
        AttestationFormat, COSEAlgorithm, COSEEC2Key, COSEKey, COSEKeyType, ECDSACurve,
        ParsedAttestation, RegisteredExtensions, UserVerificationPolicy,
    };

    /// Echter `Passkey` über `danger-credential-internals` (nur `[dev-dependencies]`): eine
    /// synthetische `Credential` per `Passkey::from`. Kryptografisch ungültig, für die reine
    /// Storage-Schicht irrelevant.
    fn test_passkey(cred_id: &[u8], counter: u32) -> Passkey {
        let cred = Credential {
            cred_id: cred_id.to_vec().into(),
            cred: COSEKey {
                type_: COSEAlgorithm::ES256,
                key: COSEKeyType::EC_EC2(COSEEC2Key {
                    curve: ECDSACurve::SECP256R1,
                    x: vec![7u8; 32].into(),
                    y: vec![9u8; 32].into(),
                }),
            },
            counter,
            transports: None,
            user_verified: true,
            backup_eligible: false,
            backup_state: false,
            registration_policy: UserVerificationPolicy::Required,
            extensions: RegisteredExtensions::none(),
            attestation: ParsedAttestation::default(),
            attestation_format: AttestationFormat::None,
        };
        Passkey::from(cred)
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

    async fn pool_mit_org() -> SqlitePool {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    /// `Passkey`s `PartialEq` vergleicht nur `cred_id`; verglichen wird deshalb die
    /// JSON-Repräsentation.
    fn als_json(passkey: &Passkey) -> serde_json::Value {
        serde_json::to_value(passkey).expect("Passkey muss serialisierbar sein")
    }

    #[tokio::test]
    async fn roundtrip_speichern_und_laden_liefert_denselben_passkey() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        let passkey = test_passkey(b"cred-roundtrip", 0);

        speichere_passkey(&pool, benutzer_id, &passkey)
            .await
            .unwrap();

        let geladen = passkeys_fuer_benutzer(&pool, benutzer_id).await.unwrap();

        assert_eq!(geladen.len(), 1);
        assert_eq!(
            als_json(&geladen[0]),
            als_json(&passkey),
            "geladener Passkey muss (per JSON) identisch zum gespeicherten sein"
        );
    }

    #[tokio::test]
    async fn passkey_je_credential_id_findet_richtigen_benutzer() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        let passkey = test_passkey(b"cred-lookup", 0);
        speichere_passkey(&pool, benutzer_id, &passkey)
            .await
            .unwrap();

        let gefunden = passkey_je_credential_id(&pool, b"cred-lookup")
            .await
            .unwrap();

        let (gefundener_benutzer_id, gefundener_passkey) =
            gefunden.expect("Passkey muss gefunden werden");
        assert_eq!(gefundener_benutzer_id, benutzer_id);
        assert_eq!(als_json(&gefundener_passkey), als_json(&passkey));
    }

    #[tokio::test]
    async fn passkey_je_credential_id_liefert_none_bei_unbekannter_id() {
        let pool = pool_mit_org().await;

        let gefunden = passkey_je_credential_id(&pool, b"unbekannt").await.unwrap();

        assert!(gefunden.is_none());
    }

    #[tokio::test]
    async fn zweites_speichern_derselben_credential_id_liefert_conflict() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        let passkey = test_passkey(b"cred-doppelt", 0);

        speichere_passkey(&pool, benutzer_id, &passkey)
            .await
            .unwrap();
        let zweiter_versuch = speichere_passkey(&pool, benutzer_id, &passkey).await;

        assert!(
            matches!(zweiter_versuch, Err(AppError::Conflict(_))),
            "doppelte credential_id (UNIQUE) muss als Conflict/409 auflaufen, nicht als 500"
        );
    }

    #[tokio::test]
    async fn aktualisiere_counter_schreibt_geaenderten_passkey_zurueck() {
        let pool = pool_mit_org().await;
        let benutzer_id = benutzer(&pool, "erika").await;
        let passkey = test_passkey(b"cred-counter", 0);
        speichere_passkey(&pool, benutzer_id, &passkey)
            .await
            .unwrap();

        // Wie der Login-Handler nach erfolgreicher Authentisierung: gleiche `credential_id`,
        // höherer
        // Counter.
        let aktualisierter_passkey = test_passkey(b"cred-counter", 7);

        aktualisiere_counter(&pool, &aktualisierter_passkey)
            .await
            .unwrap();

        let neu_geladen = passkeys_fuer_benutzer(&pool, benutzer_id).await.unwrap();
        assert_eq!(neu_geladen.len(), 1, "es war ein UPDATE, kein INSERT");
        let counter_nach_reload = als_json(&neu_geladen[0])["cred"]["counter"].clone();
        assert_eq!(
            counter_nach_reload,
            serde_json::json!(7),
            "aktualisierter Counter muss nach dem Reload sichtbar sein"
        );
    }

    #[tokio::test]
    async fn aktualisiere_counter_bei_unbekannter_credential_id_liefert_not_found() {
        let pool = pool_mit_org().await;
        let passkey = test_passkey(b"cred-nie-gespeichert", 3);

        let ergebnis = aktualisiere_counter(&pool, &passkey).await;

        assert!(matches!(ergebnis, Err(AppError::NotFound)));
    }
}
