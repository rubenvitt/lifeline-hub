use super::AnhangAnzeige;
use crate::error::AppError;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

/// Projektion der Anzeige-Spalten (ohne `daten`/`sha256`).
const ANZEIGE_SELECT: &str =
    "SELECT id, einsatz_id, dateiname, mime, groesse, hochgeladen_von, erstellt_at FROM anhang";

/// Hex-Kodierung (kleingeschrieben) ohne externe Crate.
fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// SHA-256 der Bytes als Hex-String — Integritäts-/Dedup-Schlüssel und künftiger
/// Cache-Key des AV-Scan-Ergebnisses (LFH-114).
pub fn sha256_hex(daten: &[u8]) -> String {
    hex(&Sha256::digest(daten))
}

/// Lädt die Anzeige eines Anhangs. `NotFound`, wenn er nicht existiert.
pub async fn anzeige_laden(pool: &SqlitePool, id: i64) -> Result<AnhangAnzeige, AppError> {
    sqlx::query_as::<_, AnhangAnzeige>(sqlx::AssertSqlSafe(format!("{ANZEIGE_SELECT} WHERE id = ?")))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Persistiert einen Anhang (Bytes als BLOB) und liefert seine Anzeige.
/// `groesse` und `sha256` werden serverseitig aus den Bytes berechnet.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    hochgeladen_von: i64,
    dateiname: &str,
    mime: &str,
    daten: &[u8],
) -> Result<AnhangAnzeige, AppError> {
    let groesse = daten.len() as i64;
    let sha = sha256_hex(daten);
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(dateiname)
    .bind(mime)
    .bind(groesse)
    .bind(sha)
    .bind(daten)
    .bind(hochgeladen_von)
    .fetch_one(pool)
    .await?;
    anzeige_laden(pool, id).await
}

/// Lädt die Bytes eines Anhangs für den Download: `(dateiname, mime, daten)`.
/// `NotFound`, wenn der Anhang nicht existiert.
pub async fn laden_bytes(
    pool: &SqlitePool,
    id: i64,
) -> Result<(String, String, Vec<u8>), AppError> {
    sqlx::query_as::<_, (String, String, Vec<u8>)>(
        "SELECT dateiname, mime, daten FROM anhang WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Prüft, ob ein Anhang zum angegebenen Einsatz gehört (Schutz gegen
/// Cross-Einsatz-Zugriff beim Download und beim Verknüpfen).
pub async fn gehoert_anhang_zu_einsatz(
    pool: &SqlitePool,
    anhang_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM anhang WHERE id = ? AND einsatz_id = ?")
            .bind(anhang_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    #[test]
    fn sha256_hex_ist_stabil() {
        // Bekannter Vektor: SHA-256 der leeren Eingabe.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[tokio::test]
    async fn anlegen_und_laden_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let bytes = b"PDF-Inhalt";
        let a = anlegen(&pool, einsatz, benutzer, "lage.pdf", "application/pdf", bytes).await.unwrap();
        assert_eq!(a.dateiname, "lage.pdf");
        assert_eq!(a.mime, "application/pdf");
        assert_eq!(a.groesse, bytes.len() as i64);

        let (name, mime, daten) = laden_bytes(&pool, a.id).await.unwrap();
        assert_eq!(name, "lage.pdf");
        assert_eq!(mime, "application/pdf");
        assert_eq!(daten, bytes);
    }

    #[tokio::test]
    async fn gehoert_anhang_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, benutzer, "f.png", "image/png", b"x").await.unwrap();

        assert!(gehoert_anhang_zu_einsatz(&pool, a.id, einsatz).await.unwrap());
        assert!(!gehoert_anhang_zu_einsatz(&pool, a.id, 999).await.unwrap());
        assert!(!gehoert_anhang_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }

    #[tokio::test]
    async fn laden_bytes_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(laden_bytes(&pool, 999).await.unwrap_err(), AppError::NotFound));
    }
}
