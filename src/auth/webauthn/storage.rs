//! Passkey-Persistenz (LFH-275, Increment 4): der komplette, opak serialisierte `Passkey`
//! (serde/JSON, `webauthn_rs::prelude::Passkey`) ist die **Quelle der Wahrheit** in
//! `webauthn_credential.passkey_json`. `credential_id` bleibt in ihrer eigenen `BLOB
//! UNIQUE`-Spalte (aus `passkey.cred_id()` extrahiert) für Lookup/UNIQUE-Erzwingung/
//! `exclude_credentials` — sie ist eine reine Indexspalte, kein zweiter Datenspeicher.
//!
//! **Inc-1-Altspalten `public_key`/`sign_count` (Plan-MUST: „NICHT missbrauchen"):** die
//! Increment-1-Migration (0083) legte die Tabelle mit `public_key BLOB NOT NULL` (kein
//! Default) und `sign_count INTEGER NOT NULL DEFAULT 0` an — geplant für eine spätere
//! feldweise Persistenz, die mit der opaken Blob-Strategie (Increment 4) obsolet wurde.
//! `Passkey` (webauthn-rs 0.5) exponiert weder den öffentlichen Schlüssel noch den Counter
//! über eine öffentliche API (nur `cred_id()`/`cred_algorithm()`/`get_public_key() ->
//! &COSEKey`, kein Rohbyte-Extraktor; der Counter ist komplett privat) — sie ließen sich nur
//! über den „danger-credential-internals"-Featureflag „ehrlich" auslesen, was das ganze
//! Opak-Storage-Konzept in Produktionscode unterlaufen würde. Statt einer IRREFÜHRENDEN
//! Platzhalter-Befüllung (z. B. `credential_id` nochmal in `public_key` kopieren) bleibt
//! `sign_count` schlicht bei ihrem `DEFAULT 0` (kein produktionsseitiger INSERT-Wert nötig)
//! und `public_key` bekommt einen **expliziten leeren Blob** — unmissverständlich „nicht
//! befüllt", keine vorgetäuschten echten Schlüsseldaten. Eine additive Migration, die beide
//! Spalten nullable macht, wäre die sauberere Langfrist-Lösung, ist für zwei tote Spalten
//! aber nicht in diesem Task ausgerollt (siehe Task-3-Report).

use crate::error::AppError;
use sqlx::SqlitePool;
use webauthn_rs::prelude::Passkey;

/// Speichert einen frisch registrierten Passkey für `benutzer_id`. `credential_id` wird aus
/// `passkey.cred_id()` extrahiert (eigene Spalte, s. Moduldoc), der komplette Passkey landet
/// opak als JSON in `passkey_json`.
///
/// Ein Passkey mit bereits vorhandener `credential_id` (UNIQUE-Verletzung) liefert
/// `AppError::Conflict` (409) statt eines 500ers — derselbe Credential kann nicht zweimal
/// registriert werden (das wäre ohnehin ein Client-/Ceremony-Bug, kein Serverfehler).
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
    // Inc-1-Altspalte, seit der opaken Blob-Strategie (Increment 4) unbenutzt — expliziter
    // leerer Blob statt vorgetäuschter echter Schlüsseldaten (s. Moduldoc). `sign_count`
    // bleibt unbenannt und fällt auf ihr `DEFAULT 0` zurück.
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

/// Lädt alle Passkeys von `benutzer_id`, deserialisiert aus `passkey_json`. Wird u.a. für
/// `exclude_credentials` bei der Registrierung und für `webauthn.start_passkey_authentication`
/// beim Login gebraucht.
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

/// Schreibt den (vom Aufrufer bereits via `Passkey::update_credential` aktualisierten) Passkey
/// zurück — Counter-Rückschreiben nach jeder erfolgreichen Authentisierung (Plan-MUST:
/// Clone-Detection ist nur so stark wie der zurückgeschriebene Counter). Re-serialisiert den
/// kompletten Passkey und ersetzt `passkey_json` anhand der (unveränderlichen) `credential_id`.
///
/// Liefert `NotFound`, falls die `credential_id` zwischenzeitlich verschwunden ist (z. B.
/// nebenläufig gelöschter Passkey) — ein stiller No-op-Erfolg würde das Counter-Rückschreiben
/// nur vortäuschen.
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

    /// Baut einen ECHTEN `Passkey`-Wert (keine gefälschte Zeichenkette) über den von
    /// webauthn-rs selbst bereitgestellten Escape-Hatch `danger-credential-internals`
    /// (nur `[dev-dependencies]`, s. Cargo.toml-Kommentar): eine synthetische `Credential`
    /// (alle Felder öffentlich) wird per `Passkey::from` konvertiert — echte Typ-Instanz,
    /// durchläuft den echten serde-Pfad. Kryptografisch nicht gültig (keine echte
    /// Attestation/Signatur) — für die reine Storage-Schicht irrelevant, die Passkeys nie
    /// kryptografisch verifiziert, nur (de)serialisiert.
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

    /// `Passkey`s `PartialEq` vergleicht NUR `cred_id` (s. webauthn-rs interface.rs) — ein
    /// `assert_eq!` auf zwei `Passkey`-Werten würde daher selbst bei unterschiedlichem
    /// Counter/Inhalt grün bleiben. Für einen echten Roundtrip-/Änderungsvergleich wird
    /// stattdessen die serialisierte JSON-Repräsentation verglichen (wie im Plan gefordert:
    /// „serde-Vergleich der JSON").
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

        // Simuliert, was der Aufrufer (Task 6: Login-Handler) nach einer erfolgreichen
        // Authentisierung tut: den Passkey lokal mit einem höheren Counter fortschreiben
        // (real via `Passkey::update_credential`), BEVOR aktualisiere_counter den
        // re-serialisierten Wert persistiert. Gleiche credential_id, anderer Counter.
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
