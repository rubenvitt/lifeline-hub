use super::AnhangAnzeige;
use crate::error::AppError;
use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

/// Karenz (Stunden), die ein verwaister Anhang „überleben" darf, bevor der Sweep ihn
/// entfernt — großzügig gewählt, damit ein regulärer Upload→Senden-Ablauf (Anhang wird
/// beim Nachricht-Senden verknüpft) nie in die Löschung läuft.
pub const VERWAISTE_KARENZ_STUNDEN: i64 = 24;

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
    sqlx::query_as::<_, AnhangAnzeige>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE id = ?"
    )))
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

/// Hard-Delete eines Anhangs, einsatz-gescopt (Ownership: `AND einsatz_id = ?` weist
/// fremde Anhänge ab). Der `ON DELETE CASCADE`-FK räumt die `chat_nachricht_anhang`-
/// Verknüpfungen automatisch mit. `NotFound`, wenn keine Zeile getroffen wird
/// (unbekannter oder fremder Anhang) — Freigabepfad gegen monotones Wachstum (LFH-250).
pub async fn loeschen(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let betroffen = sqlx::query("DELETE FROM anhang WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Löscht „verwaiste" Anhänge (an KEINE `chat_nachricht_anhang`-Zeile gebunden — z. B.
/// hochgeladen aber nie gesendet), deren Upload länger als [`VERWAISTE_KARENZ_STUNDEN`]
/// zurückliegt. Gegen monotones BLOB-Wachstum (LFH-250). Injiziertes `jetzt` =
/// deterministisch testbar; der `WHERE`-Guard macht wiederholte Läufe idempotent.
/// Liefert die Anzahl gelöschter Anhänge.
///
/// Heute referenziert NUR `chat_nachricht_anhang` die `anhang`-Tabelle. Kommt ein zweiter
/// Linker (ETB/Lageobjekte) hinzu, MUSS dieses `NOT EXISTS` um ihn erweitert werden — sonst
/// löscht der Sweep dort gebundene Anhänge (analoger Vorbehalt wie beim Tombstone-Guard).
pub async fn sweep_verwaiste(pool: &SqlitePool, jetzt: DateTime<Utc>) -> Result<u64, AppError> {
    let grenze = (jetzt - Duration::hours(VERWAISTE_KARENZ_STUNDEN))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let betroffen = sqlx::query(
        "DELETE FROM anhang \
         WHERE erstellt_at < ? \
           AND NOT EXISTS \
               (SELECT 1 FROM chat_nachricht_anhang cna WHERE cna.anhang_id = anhang.id)",
    )
    .bind(grenze)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(betroffen)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
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
        let a = anlegen(
            &pool,
            einsatz,
            benutzer,
            "lage.pdf",
            "application/pdf",
            bytes,
        )
        .await
        .unwrap();
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
        let a = anlegen(&pool, einsatz, benutzer, "f.png", "image/png", b"x")
            .await
            .unwrap();

        assert!(gehoert_anhang_zu_einsatz(&pool, a.id, einsatz)
            .await
            .unwrap());
        assert!(!gehoert_anhang_zu_einsatz(&pool, a.id, 999).await.unwrap());
        assert!(!gehoert_anhang_zu_einsatz(&pool, 12345, einsatz)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn laden_bytes_unbekannt_ist_notfound() {
        let pool = crate::db::test_pool().await;
        setup(&pool).await;
        assert!(matches!(
            laden_bytes(&pool, 999).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    fn t(s: &str) -> DateTime<Utc> {
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
    }

    /// Verwaisten Anhang mit kontrolliertem `erstellt_at` direkt einfügen (umgeht
    /// `anlegen`s `datetime('now')`), um die Karenz-Grenze deterministisch zu prüfen.
    async fn anhang_mit_zeit(
        pool: &SqlitePool,
        einsatz_id: i64,
        von: i64,
        name: &str,
        erstellt_at: &str,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO anhang \
                (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von, erstellt_at) \
             VALUES (?, ?, 'application/pdf', 3, 'deadbeef', ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(name)
        .bind(b"ABC".as_slice())
        .bind(von)
        .bind(erstellt_at)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn sweep_verwaiste_loescht_alte_orphans_haelt_junge() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;

        // Zwei verwaiste Anhänge (nie an eine Nachricht gehängt), unterschiedlich alt.
        let alt = anhang_mit_zeit(&pool, einsatz, von, "alt.pdf", "2026-01-01 00:00:00").await;
        let jung = anhang_mit_zeit(&pool, einsatz, von, "jung.pdf", "2026-06-15 12:00:00").await;

        // jetzt = 2026-06-16 00:00:00 → Karenz-Grenze (24h) = 2026-06-15 00:00:00.
        let geloescht = sweep_verwaiste(&pool, t("2026-06-16 00:00:00"))
            .await
            .unwrap();
        assert_eq!(geloescht, 1, "nur der alte verwaiste Anhang wird gelöscht");

        assert!(
            anzeige_laden(&pool, alt).await.is_err(),
            "alter Orphan ist gelöscht"
        );
        assert!(
            anzeige_laden(&pool, jung).await.is_ok(),
            "junger Orphan bleibt (innerhalb Karenz)"
        );

        // Zweiter Lauf ohne neue Fälligkeit ist idempotent (0 gelöscht).
        let zweiter = sweep_verwaiste(&pool, t("2026-06-16 00:00:00"))
            .await
            .unwrap();
        assert_eq!(zweiter, 0, "idempotent: kein erneutes Löschen");
    }
}
