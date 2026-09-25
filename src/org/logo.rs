//! Logo der Organisation (LFH-22, design.md D8).
//!
//! Eigene 1:1-Tabelle `org_logo` statt Spalten an `organisation`: der BLOB bleibt aus jeder
//! Abfrage der Stammdaten heraus, und „kein Logo" ist die fehlende Zeile. Die Tabelle hat
//! keine `einsatz_id` und keinen CASCADE-Pfad zu `einsatz` — sie liegt damit außerhalb der
//! Schwärzungsmenge (`einsatz::schwaerzung_registry`), was dort ein Guard festhält.

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Höchstgröße eines Logos in Bytes (1 MiB). Deckungsgleich mit dem CHECK der Migration
/// `0123_org_logo.sql`; das Body-Limit der Route liegt 64 KiB darüber (Multipart-Rahmen).
pub const MAX_GROESSE: usize = 1024 * 1024;

/// `Cache-Control` des Logo-Abrufs. **Nicht** `ASSET_CACHE_CONTROL` (immutable): die Adresse
/// `/api/organisation/logo` ist stabil, der Inhalt nicht. `no-cache` lässt den Browser
/// speichern, zwingt ihn aber zur Rückfrage mit dem ETag — ein neues Logo ist sofort da,
/// ein unverändertes kostet nur ein 304.
pub const CACHE_CONTROL: &str = "private, no-cache";

/// Metadaten des Logos ohne Bytes — hängen als `logo` an der `OrganisationAnzeige`.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow, ToSchema)]
pub struct OrgLogoAnzeige {
    pub mime: String,
    pub groesse: i64,
    /// Hex-sha256 der Bytes; zugleich der ETag des Abrufs und der Cache-Brecher `?v=`.
    pub sha256: String,
    pub geaendert_at: String,
}

/// Größe 1 … [`MAX_GROESSE`], sonst 400 (das Feld für sich ist unbrauchbar).
pub fn pruefe_groesse(len: usize) -> Result<(), AppError> {
    if len == 0 {
        return Err(AppError::Validation("Logo ist leer".into()));
    }
    if len > MAX_GROESSE {
        return Err(AppError::Validation(
            "Logo ist zu groß (höchstens 1 MiB)".into(),
        ));
    }
    Ok(())
}

/// Metadaten der eigenen Org ohne BLOB; `None` = kein Logo hinterlegt.
pub async fn meta(pool: &SqlitePool, org_id: i64) -> Result<Option<OrgLogoAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, OrgLogoAnzeige>(
        "SELECT mime, groesse, sha256, geaendert_at FROM org_logo WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?)
}

/// Was der Abruf ausliefert: Typ, Prüfsumme (ETag) und Bytes aus DERSELBEN Zeile.
#[derive(Debug, sqlx::FromRow)]
pub struct LogoInhalt {
    pub mime: String,
    pub sha256: String,
    pub daten: Vec<u8>,
}

/// Typ, Prüfsumme und Bytes in EINER Abfrage; `None` = kein Logo. Getrennt gelesen lieferte
/// ein Ersetzen zwischen beiden Abfragen die Bytes des neuen Logos unter Typ und ETag des
/// alten.
pub async fn inhalt(pool: &SqlitePool, org_id: i64) -> Result<Option<LogoInhalt>, AppError> {
    Ok(
        sqlx::query_as::<_, LogoInhalt>(
            "SELECT mime, sha256, daten FROM org_logo WHERE org_id = ?",
        )
        .bind(org_id)
        .fetch_optional(pool)
        .await?,
    )
}

/// Setzt oder ersetzt das Logo einer Org (Upsert in einer Transaktion). Größe und Typ
/// prüft der Aufrufer vorher; die CHECKs der Tabelle sind das Netz dahinter.
pub async fn setzen(
    pool: &SqlitePool,
    org_id: i64,
    mime: &str,
    daten: &[u8],
    von: i64,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO org_logo (org_id, mime, groesse, sha256, daten, hochgeladen_von, geaendert_at) \
         VALUES (?, ?, ?, ?, ?, ?, datetime('now')) \
         ON CONFLICT(org_id) DO UPDATE SET mime = excluded.mime, groesse = excluded.groesse, \
           sha256 = excluded.sha256, daten = excluded.daten, \
           hochgeladen_von = excluded.hochgeladen_von, geaendert_at = excluded.geaendert_at",
    )
    .bind(org_id)
    .bind(mime)
    .bind(daten.len() as i64)
    .bind(crate::anhang::repo::sha256_hex(daten))
    .bind(daten)
    .bind(von)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Entfernt das Logo einer Org. Ohne Logo ein No-op (die Route antwortet dann auch 204).
pub async fn entfernen(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM org_logo WHERE org_id = ?")
        .bind(org_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    async fn pool_mit_org() -> SqlitePool {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    /// Schreibt eine Zeile roh (am Repo vorbei), damit die CHECKs der Tabelle selbst
    /// geprüft werden und nicht eine Vorprüfung im Rust-Code.
    async fn roh_einfuegen(pool: &SqlitePool, mime: &str, groesse: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO org_logo (org_id, mime, groesse, sha256, daten, geaendert_at) \
             VALUES (1, ?, ?, 'abc', x'00', datetime('now'))",
        )
        .bind(mime)
        .bind(groesse)
        .execute(pool)
        .await
        .map(|_| ())
    }

    #[tokio::test]
    async fn check_mime_nimmt_nur_png_und_jpeg() {
        for (mime, erlaubt) in [
            ("image/png", true),
            ("image/jpeg", true),
            ("image/gif", false),
            ("image/svg+xml", false),
        ] {
            let pool = pool_mit_org().await;
            let erg = roh_einfuegen(&pool, mime, 10).await;
            assert_eq!(erg.is_ok(), erlaubt, "{mime}: {erg:?}");
        }
    }

    #[tokio::test]
    async fn check_groesse_zwischen_1_und_1_mib() {
        for (groesse, erlaubt) in [(0, false), (1, true), (1_048_576, true), (1_048_577, false)] {
            let pool = pool_mit_org().await;
            let erg = roh_einfuegen(&pool, "image/png", groesse).await;
            assert_eq!(erg.is_ok(), erlaubt, "{groesse}: {erg:?}");
        }
    }

    /// 1:1 zur Organisation: eine zweite Zeile derselben Org verletzt den Primärschlüssel.
    #[tokio::test]
    async fn hoechstens_ein_logo_je_organisation() {
        let pool = pool_mit_org().await;
        roh_einfuegen(&pool, "image/png", 10).await.unwrap();
        assert!(roh_einfuegen(&pool, "image/png", 10).await.is_err());
    }

    #[test]
    fn pruefe_groesse_grenzen() {
        use super::{pruefe_groesse, MAX_GROESSE};
        assert!(pruefe_groesse(0).is_err());
        assert!(pruefe_groesse(1).is_ok());
        assert!(pruefe_groesse(MAX_GROESSE).is_ok());
        assert!(pruefe_groesse(MAX_GROESSE + 1).is_err());
    }

    #[tokio::test]
    async fn setzen_ersetzt_und_entfernen_raeumt() {
        let pool = pool_mit_org().await;
        assert_eq!(super::meta(&pool, 1).await.unwrap(), None);

        sqlx::query("INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) VALUES (7, 1, 'A', 'a', 'h')")
            .execute(&pool)
            .await
            .unwrap();
        super::setzen(&pool, 1, "image/png", b"\x89PNGeins", 7)
            .await
            .unwrap();
        super::setzen(&pool, 1, "image/jpeg", b"\xFF\xD8\xFFzwei", 7)
            .await
            .unwrap();
        let m = super::meta(&pool, 1).await.unwrap().unwrap();
        assert_eq!(m.mime, "image/jpeg");
        assert_eq!(m.groesse, 7);
        assert_eq!(
            m.sha256,
            crate::anhang::repo::sha256_hex(b"\xFF\xD8\xFFzwei")
        );
        assert_eq!(
            super::inhalt(&pool, 1).await.unwrap().unwrap().daten,
            b"\xFF\xD8\xFFzwei".to_vec()
        );

        super::entfernen(&pool, 1).await.unwrap();
        assert_eq!(super::meta(&pool, 1).await.unwrap(), None);
        assert!(super::inhalt(&pool, 1).await.unwrap().is_none());
        super::entfernen(&pool, 1).await.unwrap();
    }

    /// Typ, Prüfsumme und Bytes kommen aus EINER Abfrage (Review Welle B): der Abruf las
    /// vorher Metadaten und Bytes getrennt, und ein Ersetzen dazwischen lieferte die Bytes
    /// des neuen Logos unter Typ und ETag des alten.
    #[tokio::test]
    async fn inhalt_liefert_typ_pruefsumme_und_bytes_aus_einer_zeile() {
        let pool = pool_mit_org().await;
        assert!(super::inhalt(&pool, 1).await.unwrap().is_none());
        sqlx::query("INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) VALUES (7, 1, 'A', 'a', 'h')")
            .execute(&pool)
            .await
            .unwrap();
        super::setzen(&pool, 1, "image/jpeg", b"\xFF\xD8\xFFzwei", 7)
            .await
            .unwrap();
        let i = super::inhalt(&pool, 1).await.unwrap().unwrap();
        assert_eq!(i.mime, "image/jpeg");
        assert_eq!(
            i.sha256,
            crate::anhang::repo::sha256_hex(b"\xFF\xD8\xFFzwei")
        );
        assert_eq!(i.daten, b"\xFF\xD8\xFFzwei".to_vec());
    }

    /// Löschen der Organisation räumt das Logo mit (ON DELETE CASCADE).
    #[tokio::test]
    async fn logo_faellt_mit_der_organisation() {
        let pool = pool_mit_org().await;
        roh_einfuegen(&pool, "image/png", 10).await.unwrap();
        sqlx::query("DELETE FROM organisation WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM org_logo")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0);
    }
}
