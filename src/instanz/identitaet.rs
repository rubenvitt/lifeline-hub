//! Identität der Instanz (design.md D1): Kennung und Ed25519-Schlüsselpaar, erzeugt beim ersten
//! Start, in der DB (`instanz_identitaet`), damit die Sicherung sie mitnimmt. Muster
//! `web_push::repo::schluessel_laden_oder_erzeugen`.

use super::basis32::{b64, fingerabdruck, parse_b64};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use sqlx::SqlitePool;

/// Die Identität dieser Instanz. Der private Schlüssel verlässt diese Struktur nie: kein
/// `Serialize`, und `Debug` zeigt nur Kennung und Fingerabdruck.
#[derive(Clone)]
pub struct Identitaet {
    pub kennung: String,
    schluessel: SigningKey,
}

impl std::fmt::Debug for Identitaet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Identitaet")
            .field("kennung", &self.kennung)
            .field("fingerabdruck", &self.fingerabdruck())
            .finish_non_exhaustive()
    }
}

impl Identitaet {
    /// Neue Identität aus dem Zufall des Betriebssystems.
    pub fn create() -> Self {
        let mut geheim = [0u8; 32];
        OsRng.fill_bytes(&mut geheim);
        Identitaet {
            kennung: uuid::Uuid::new_v4().to_string(),
            schluessel: SigningKey::from_bytes(&geheim),
        }
    }

    /// Für Tests: eine Identität aus festen Bytes.
    pub fn from_parts(kennung: &str, geheim: [u8; 32]) -> Self {
        Identitaet {
            kennung: kennung.to_string(),
            schluessel: SigningKey::from_bytes(&geheim),
        }
    }

    /// Der öffentliche Schlüssel (32 Byte).
    pub fn oeffentlich(&self) -> [u8; 32] {
        self.schluessel.verifying_key().to_bytes()
    }

    /// Der öffentliche Schlüssel als Base64url, so steht er auf der Leitung und in der DB.
    pub fn oeffentlich_b64(&self) -> String {
        b64(&self.oeffentlich())
    }

    pub fn fingerabdruck(&self) -> String {
        fingerabdruck(&self.oeffentlich())
    }

    /// Ed25519-Signatur über `nachricht`.
    pub fn sign(&self, nachricht: &[u8]) -> [u8; 64] {
        self.schluessel.sign(nachricht).to_bytes()
    }
}

/// Liest einen öffentlichen Ed25519-Schlüssel aus Base64url; `None`, wenn er kein gültiger Punkt
/// ist.
pub fn parse_oeffentlich(text: &str) -> Option<VerifyingKey> {
    let bytes: [u8; 32] = parse_b64(text)?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

/// Liest die Identität oder erzeugt sie beim ersten Aufruf. Zwei gleichzeitige Erstaufrufe
/// schreiben nicht zwei: `INSERT OR IGNORE` auf die eine Zeile, danach liest jeder, was gewonnen
/// hat.
pub async fn load_or_create(pool: &SqlitePool) -> anyhow::Result<Identitaet> {
    if let Some(i) = load(pool).await? {
        return Ok(i);
    }
    let neu = Identitaet::create();
    sqlx::query(
        "INSERT OR IGNORE INTO instanz_identitaet (id, kennung, privat, oeffentlich) VALUES (1, ?, ?, ?)",
    )
    .bind(&neu.kennung)
    .bind(b64(&neu.schluessel.to_bytes()))
    .bind(neu.oeffentlich_b64())
    .execute(pool)
    .await?;
    load(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Instanzidentität nach dem Anlegen nicht lesbar"))
}

async fn load(pool: &SqlitePool) -> anyhow::Result<Option<Identitaet>> {
    let zeile: Option<(String, String)> =
        sqlx::query_as("SELECT kennung, privat FROM instanz_identitaet WHERE id = 1")
            .fetch_optional(pool)
            .await?;
    let Some((kennung, privat)) = zeile else {
        return Ok(None);
    };
    let geheim: [u8; 32] = parse_b64(&privat)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| {
            anyhow::anyhow!("gespeicherter Instanzschlüssel ist kein Ed25519-Schlüssel")
        })?;
    Ok(Some(Identitaet {
        kennung,
        schluessel: SigningKey::from_bytes(&geheim),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[tokio::test]
    async fn zweiter_aufruf_liefert_dieselbe_identitaet() {
        let pool = crate::db::test_pool().await;
        let a = load_or_create(&pool).await.unwrap();
        let b = load_or_create(&pool).await.unwrap();
        assert_eq!(a.kennung, b.kennung);
        assert_eq!(a.oeffentlich(), b.oeffentlich());
    }

    #[tokio::test]
    async fn gleichzeitige_erstaufrufe_ergeben_eine_zeile() {
        let pool = crate::db::test_pool().await;
        let (a, b) = tokio::join!(load_or_create(&pool), load_or_create(&pool));
        assert_eq!(a.unwrap().kennung, b.unwrap().kennung);
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM instanz_identitaet")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn debug_zeigt_den_privaten_schluessel_nicht() {
        let i = Identitaet::from_parts("k", [9u8; 32]);
        let text = format!("{i:?}");
        assert!(text.contains("fingerabdruck"));
        assert!(!text.contains(&b64(&[9u8; 32])));
        assert!(!text.contains("SigningKey"));
    }

    #[test]
    fn signatur_prueft_gegen_den_oeffentlichen_schluessel() {
        let i = Identitaet::from_parts("k", [3u8; 32]);
        let sig = ed25519_dalek::Signature::from_bytes(&i.sign(b"hallo"));
        let pk = parse_oeffentlich(&i.oeffentlich_b64()).unwrap();
        assert!(pk.verify(b"hallo", &sig).is_ok());
        assert!(pk.verify(b"hallo!", &sig).is_err());
    }
}
