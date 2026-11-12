//! Entdeckung von Instanzen im lokalen Netz per mDNS/DNS-SD (LLH-1497, Change
//! `t10a7luh-elw-lan-direktkopplung`, design.md D6, Spec `instanz-entdeckung`).

use crate::error::AppError;
use sqlx::SqlitePool;

/// Ob die LAN-Entdeckung an dieser Instanz läuft (beim Start gesetzt).
pub async fn is_an(pool: &SqlitePool) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT lan_entdeckung_an FROM instanz_identitaet")
            .fetch_optional(pool)
            .await?
            .unwrap_or(0)
            == 1,
    )
}
