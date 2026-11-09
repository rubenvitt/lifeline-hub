//! Geheimnisse eines Kontos auf der Leitung (design.md D6): Passwort-Hash und TOTP gehen mit age
//! an den X25519-Schlüssel der meldenden Instanz, auch wer TLS bricht, liest sie nicht. Der
//! Schlüssel liegt neben der Instanzidentität in der DB und wandert mit der Sicherung.

use crate::error::AppError;
use age::secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

/// Was von einem Konto verschlüsselt mitgeht. `Debug` zeigt nichts davon.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Geheimnis {
    pub passwort_hash: String,
    pub totp_secret: Option<String>,
    pub totp_aktiviert: bool,
}

impl std::fmt::Debug for Geheimnis {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Geheimnis(…)")
    }
}

impl Geheimnis {
    /// SHA-256 über den Klartext (Hex): erkennt, ob sich an der Quelle etwas geändert hat, ohne
    /// das Geheimnis selbst zu vergleichen oder zu speichern.
    pub fn merkmal(&self) -> String {
        let json = serde_json::to_vec(self).expect("Geheimnis ist serialisierbar");
        Sha256::digest(json)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}

/// Liest den age-Schlüssel dieser Instanz oder erzeugt ihn beim ersten Aufruf. Die
/// Instanzidentität muss schon bestehen (`identitaet::load_or_create`).
pub async fn load_or_create_age(pool: &SqlitePool) -> Result<age::x25519::Identity, AppError> {
    let neu = age::x25519::Identity::generate();
    sqlx::query("UPDATE instanz_identitaet SET age_privat = ? WHERE age_privat IS NULL")
        .bind(neu.to_string().expose_secret())
        .execute(pool)
        .await?;
    let text: Option<String> = sqlx::query_scalar("SELECT age_privat FROM instanz_identitaet")
        .fetch_optional(pool)
        .await?
        .flatten();
    text.and_then(|t| t.parse::<age::x25519::Identity>().ok())
        .ok_or_else(|| AppError::Internal("age-Schlüssel der Instanz fehlt".into()))
}

/// Ob der Betreiber dieser Instanz die Datenträgerverschlüsselung bestätigt hat.
pub async fn is_datentraeger_bestaetigt(pool: &SqlitePool) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT datentraeger_bestaetigt FROM instanz_identitaet")
            .fetch_optional(pool)
            .await?
            .unwrap_or(0)
            == 1,
    )
}

/// Schreibt beim Start, was die Konfiguration über die Datenträgerverschlüsselung sagt.
pub async fn save_datentraeger_bestaetigt(pool: &SqlitePool, wert: bool) -> Result<(), AppError> {
    sqlx::query("UPDATE instanz_identitaet SET datentraeger_bestaetigt = ?")
        .bind(wert)
        .execute(pool)
        .await?;
    Ok(())
}

/// Verschlüsselt an einen Empfänger (`age1…`); `None`, wenn der Empfänger unlesbar ist.
pub fn encrypt(empfaenger: &str, geheimnis: &Geheimnis) -> Option<String> {
    let empfaenger: age::x25519::Recipient = empfaenger.trim().parse().ok()?;
    let klartext = serde_json::to_vec(geheimnis).ok()?;
    let chiffrat = age::encrypt(&empfaenger, &klartext).ok()?;
    Some(crate::instanz::basis32::b64(&chiffrat))
}

/// Entschlüsselt mit dem eigenen Schlüssel; `None`, wenn es nicht für uns war oder kaputt ist.
pub fn decrypt(identitaet: &age::x25519::Identity, text: &str) -> Option<Geheimnis> {
    let chiffrat = crate::instanz::basis32::parse_b64(text)?;
    let klartext = age::decrypt(identitaet, &chiffrat).ok()?;
    serde_json::from_slice(&klartext).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g() -> Geheimnis {
        Geheimnis {
            passwort_hash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def".into(),
            totp_secret: Some("JBSWY3DPEHPK3PXP".into()),
            totp_aktiviert: true,
        }
    }

    #[test]
    fn hin_und_zurueck_nur_mit_dem_richtigen_schluessel() {
        let elw = age::x25519::Identity::generate();
        let fremd = age::x25519::Identity::generate();
        let text = encrypt(&elw.to_public().to_string(), &g()).unwrap();
        assert!(!text.contains("argon2") && !text.contains("JBSWY3DP"));
        assert_eq!(decrypt(&elw, &text), Some(g()));
        assert_eq!(decrypt(&fremd, &text), None);
        assert_eq!(decrypt(&elw, "kaputt"), None);
    }

    #[test]
    fn unlesbarer_empfaenger_liefert_nichts() {
        assert!(encrypt("kein-age-schluessel", &g()).is_none());
    }

    #[test]
    fn merkmal_folgt_dem_inhalt_und_debug_zeigt_nichts() {
        let mut anders = g();
        anders.totp_aktiviert = false;
        assert_eq!(g().merkmal(), g().merkmal());
        assert_ne!(g().merkmal(), anders.merkmal());
        assert!(!format!("{:?}", g()).contains("argon2"));
    }

    #[tokio::test]
    async fn age_schluessel_bleibt_ueber_aufrufe_gleich() {
        let pool = crate::db::test_pool().await;
        crate::instanz::identitaet::load_or_create(&pool)
            .await
            .unwrap();
        let a = load_or_create_age(&pool).await.unwrap();
        let b = load_or_create_age(&pool).await.unwrap();
        assert_eq!(a.to_public().to_string(), b.to_public().to_string());
    }
}
