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
    /// Wer am Hub das Passwort erst wechseln muss (neues Konto, Einmalpasswort), muss es am ELW
    /// auch.
    #[serde(default)]
    pub passwort_wechsel_pflicht: bool,
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
    // Die Zeile muss bestehen, sonst ginge der Wert still verloren.
    crate::instanz::identitaet::load_or_create(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    sqlx::query("UPDATE instanz_identitaet SET datentraeger_bestaetigt = ?")
        .bind(wert)
        .execute(pool)
        .await?;
    Ok(())
}

/// Ob die Org eines Kontos hier ihre Geheimnisse verteilt: diese Instanz ist für sie die
/// erreichte Seite einer aktiven Kopplung (Spec `passwort-anmeldung`, design.md D7).
pub async fn is_org_verteilend(pool: &SqlitePool, org_id: i64) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM instanz_kopplung_org o \
         JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE o.org_id = ? AND o.widerrufen_at IS NULL \
           AND k.richtung = 'wird_gemeldet' AND k.zustand IN ('aktiv', 'angebahnt'))",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await?)
}

/// Text der Abweisung, wenn ein Admin mit Passkey hier ein Passwort nimmt (D7).
pub const NUR_PASSKEY: &str = "Admins melden sich hier per Passkey an.";

/// Passkey-Pflicht (D7): ein System-Admin mit Anmelde-Passkey meldet sich an einer Instanz, die
/// die Geheimnisse seiner Org verteilt, nicht per Passwort an. Ohne Passkey gehen seine
/// Geheimnisse nicht hinaus, also bleibt ihm das Passwort.
pub async fn check_passkey_pflicht(
    pool: &SqlitePool,
    benutzer: &crate::auth::Benutzer,
) -> Result<(), AppError> {
    let hat_passkey: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webauthn_credential WHERE benutzer_id = ?)",
    )
    .bind(benutzer.id)
    .fetch_one(pool)
    .await?;
    if hat_passkey && is_passkey_pflichtig(pool, benutzer).await? {
        return Err(AppError::ForbiddenMit(NUR_PASSKEY.into()));
    }
    Ok(())
}

/// Ob für dieses Konto die Passkey-Pflicht gilt, sobald es einen Passkey hat: ein System-Admin
/// einer verteilenden Org, oder einer, dessen Hash je an einen ELW ging. Auch nach einem
/// Widerruf: der Hash bleibt dort (die Zeilen gehören danach der Instanz), also bleibt er hier
/// wertlos.
pub async fn is_passkey_pflichtig(
    pool: &SqlitePool,
    benutzer: &crate::auth::Benutzer,
) -> Result<bool, AppError> {
    if benutzer.system_rolle != crate::auth::SystemRolle::Admin {
        return Ok(false);
    }
    let je_geliefert: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM instanz_geheimnis_lieferung WHERE benutzer_id = ?)",
    )
    .bind(benutzer.id)
    .fetch_one(pool)
    .await?;
    Ok(je_geliefert || is_org_verteilend(pool, benutzer.org_id).await?)
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
            passwort_wechsel_pflicht: false,
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
