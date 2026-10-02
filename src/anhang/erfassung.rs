//! Gemeinsamer Kern der Erfassungs-Anhänge (LFH-758, design.md D2): Fotos und Dateien an einem
//! Datensatz eines Fachmoduls — Schaden (LFH-21), Tier und Unfallhilfsstelle (LFH-758), Person
//! (LFH-757).
//!
//! Ein Modul beschreibt seinen Linker mit einem [`ErfassungsAblage`]-Deskriptor aus
//! Compile-Zeit-Konstanten; Liste, Laden, Download-Lookup, Ablage und Soft-Delete stehen hier
//! genau einmal. Das Modul selbst lädt nur seinen Besitzer in der offenen Transaktion
//! ([`BesitzerKopf`]: storniert? Name für den ETB-Nachweis) und mappt die
//! [`ErfassungsAnhangZeile`] auf sein Wire-DTO (`schaden_id`, `tier_id`, `uhs_id`).
//!
//! Jeder Linker steht zusätzlich im Register `anhang::repo::MODUL_LINKER` (Abschottung gegen
//! generische Routen, Chat, ETB und Sweep); der Guard
//! `jede_erfassungs_ablage_steht_im_linker_register` hält beide Listen zusammen.
//!
//! Der SQL-Text entsteht aus den `&'static str`-Feldern des Deskriptors (wie
//! `repo::modul_gebunden_sql`); kein Eingabewert gelangt hinein. Ein Test führt jede Form für
//! jeden Deskriptor gegen eine migrierte Datenbank aus.

use crate::error::AppError;
use sqlx::{FromRow, SqliteConnection, SqlitePool};

/// Ein modulgebundener Erfassungs-Linker auf `anhang`. Die Tabelle trägt die Spalten
/// `id, einsatz_id, <besitzer_spalte>, anhang_id, abgelegt_von_id, abgelegt_at,
/// geloescht_at, geloescht_von_id` (Muster `0126_einsatz_schaden_anhang.sql`).
#[derive(Debug, PartialEq, Eq)]
pub struct ErfassungsAblage {
    /// Tabellenname des Linkers, z. B. `einsatz_tier_anhang`.
    pub linker: &'static str,
    /// Spalte am Linker, die auf den Besitzer zeigt, z. B. `tier_id`.
    pub besitzer_spalte: &'static str,
    /// Tabelle des Besitzers (mit `id` und `einsatz_id`), z. B. `einsatz_tier`.
    pub besitzer_tabelle: &'static str,
    /// Meldung des 409 an einem stornierten Besitzer, z. B. „Tier ist storniert“.
    pub storniert_meldung: &'static str,
}

/// Alle Erfassungs-Ablagen. Ein neues Modul trägt seinen Deskriptor hier ein; die Guards
/// unten prüfen SQL und Registereintrag für jeden.
pub const ERFASSUNGS_ABLAGEN: &[&ErfassungsAblage] = &[
    &crate::schaden::anhang::SCHADEN_ABLAGE,
    &crate::tier::anhang::TIER_ABLAGE,
    &crate::uhs::anhang::UHS_ABLAGE,
    &crate::person::anhang::PERSON_ABLAGE,
];

/// Ein lebender Anhang eines Besitzers. `id` ist die **Linker-id**, nicht `anhang.id`.
#[derive(Debug, Clone, FromRow)]
pub struct ErfassungsAnhangZeile {
    pub id: i64,
    pub besitzer_id: i64,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    pub abgelegt_von_id: i64,
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

/// Was der Kern vom Besitzer wissen muss; das Modul lädt ihn in derselben Transaktion.
#[derive(Debug, Clone)]
pub struct BesitzerKopf {
    pub storniert: bool,
    /// Name im ETB-Nachweis, pseudonym: „Schaden S-003“, „Tier T-007“, „UHS BHP 50“.
    pub etb_name: String,
}

/// Eingabe für [`ablegen_tx`] — vom Handler geprüft (Typ, Größe, Scan).
pub struct Ablage<'a> {
    pub dateiname: &'a str,
    pub mime: &'a str,
    pub daten: &'a [u8],
}

/// Vorgang für den ETB-Nachweis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vorgang {
    Abgelegt,
    Entfernt,
}

/// Wortlaut des pseudonymen ETB-Nachweises (LFH-21 D6): „Tier T-007: Foto abgelegt“. Die Art
/// kommt aus dem **serverseitig ermittelten** MIME, nie aus einer Eingabe; kein Dateiname.
pub fn etb_text(etb_name: &str, mime: &str, vorgang: Vorgang) -> String {
    let art = if mime == "application/pdf" {
        "PDF"
    } else if mime.starts_with("image/") {
        "Foto"
    } else {
        // Die Erfassungs-Allowlist lässt nur Bilder und PDF zu; der Zweig hält den Text auch
        // dann pseudonym, wenn sie einmal wächst.
        "Datei"
    };
    let tat = match vorgang {
        Vorgang::Abgelegt => "abgelegt",
        Vorgang::Entfernt => "entfernt",
    };
    format!("{etb_name}: {art} {tat}")
}

/// Lebende Anhänge je Besitzer samt Anzeige-Joins.
fn select_sql(d: &ErfassungsAblage) -> String {
    format!(
        "SELECT l.id, l.{b} AS besitzer_id, a.dateiname, a.mime, a.groesse, \
            l.abgelegt_von_id, bn.anzeigename AS abgelegt_von_name, l.abgelegt_at \
         FROM {t} l \
         JOIN anhang a ON a.id = l.anhang_id \
         LEFT JOIN benutzer bn ON bn.id = l.abgelegt_von_id \
         WHERE l.einsatz_id = ? AND l.{b} = ? AND l.geloescht_at IS NULL",
        t = d.linker,
        b = d.besitzer_spalte,
    )
}

/// Prüft, dass der Besitzer zu diesem Einsatz gehört (sonst 404) — auch storniert.
async fn fordere_besitzer(
    pool: &SqlitePool,
    d: &ErfassungsAblage,
    einsatz_id: i64,
    besitzer_id: i64,
) -> Result<(), AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT 1 FROM {} WHERE id = ? AND einsatz_id = ?",
        d.besitzer_tabelle
    )))
    .bind(besitzer_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    treffer.map(|_| ()).ok_or(AppError::NotFound)
}

/// Lebende Anhänge eines Besitzers dieses Einsatzes, neueste zuerst. Ein Besitzer eines
/// anderen Einsatzes → `NotFound`; ein stornierter bleibt lesbar.
pub async fn liste(
    pool: &SqlitePool,
    d: &ErfassungsAblage,
    einsatz_id: i64,
    besitzer_id: i64,
) -> Result<Vec<ErfassungsAnhangZeile>, AppError> {
    fordere_besitzer(pool, d, einsatz_id, besitzer_id).await?;
    Ok(
        sqlx::query_as::<_, ErfassungsAnhangZeile>(sqlx::AssertSqlSafe(format!(
            "{} ORDER BY l.abgelegt_at DESC, l.id DESC",
            select_sql(d)
        )))
        .bind(einsatz_id)
        .bind(besitzer_id)
        .fetch_all(pool)
        .await?,
    )
}

/// Ein lebender Anhang; fremd, unbekannt, anderer Besitzer oder entfernt → `NotFound`.
pub async fn laden(
    pool: &SqlitePool,
    d: &ErfassungsAblage,
    einsatz_id: i64,
    besitzer_id: i64,
    id: i64,
) -> Result<ErfassungsAnhangZeile, AppError> {
    sqlx::query_as::<_, ErfassungsAnhangZeile>(sqlx::AssertSqlSafe(format!(
        "{} AND l.id = ?",
        select_sql(d)
    )))
    .bind(einsatz_id)
    .bind(besitzer_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// `anhang_id` eines lebenden Anhangs für den Download. Der Lookup IST die Zugriffsprüfung
/// (Einsatz, Besitzer, nicht entfernt); sonst `NotFound`.
pub async fn anhang_id_fuer_download(
    pool: &SqlitePool,
    d: &ErfassungsAblage,
    einsatz_id: i64,
    besitzer_id: i64,
    id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT anhang_id FROM {} \
         WHERE id = ? AND {} = ? AND einsatz_id = ? AND geloescht_at IS NULL",
        d.linker, d.besitzer_spalte
    )))
    .bind(id)
    .bind(besitzer_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt Anhang, Linker und System-ETB-Eintrag in der offenen Transaktion an. Der Aufrufer hat
/// den Besitzer mit `AND einsatz_id = ?` geladen (sonst `NotFound`); storniert → `Conflict`
/// ohne jede Zeile. Liefert `(linker_id, etb_id)`; SSE macht der Aufrufer NACH dem Commit.
#[allow(clippy::too_many_arguments)]
pub async fn ablegen_tx(
    conn: &mut SqliteConnection,
    d: &ErfassungsAblage,
    einsatz_id: i64,
    besitzer_id: i64,
    benutzer_id: i64,
    etb_startwert: i64,
    besitzer: &BesitzerKopf,
    ablage: &Ablage<'_>,
) -> Result<(i64, i64), AppError> {
    if besitzer.storniert {
        return Err(AppError::Conflict(d.storniert_meldung.into()));
    }
    let anhang_id = crate::anhang::repo::anlegen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        ablage.dateiname,
        ablage.mime,
        ablage.daten,
    )
    .await?;
    let id: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "INSERT INTO {} (einsatz_id, {}, anhang_id, abgelegt_von_id) \
         VALUES (?, ?, ?, ?) RETURNING id",
        d.linker, d.besitzer_spalte
    )))
    .bind(einsatz_id)
    .bind(besitzer_id)
    .bind(anhang_id)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    let text = etb_text(&besitzer.etb_name, ablage.mime, Vorgang::Abgelegt);
    let etb_id =
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &text).await?;
    Ok((id, etb_id))
}

/// MIME eines lebenden Anhangs dieses Besitzers in diesem Einsatz, in der offenen
/// Transaktion — der erste Schritt von [`entfernen_tx`]. Sonst `NotFound`.
pub async fn lebender_mime_tx(
    conn: &mut SqliteConnection,
    d: &ErfassungsAblage,
    einsatz_id: i64,
    besitzer_id: i64,
    id: i64,
) -> Result<String, AppError> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT a.mime FROM {} l JOIN anhang a ON a.id = l.anhang_id \
         WHERE l.id = ? AND l.{} = ? AND l.einsatz_id = ? AND l.geloescht_at IS NULL",
        d.linker, d.besitzer_spalte
    )))
    .bind(id)
    .bind(besitzer_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Soft-Delete mit System-ETB-Nachweis in der offenen Transaktion. Reihenfolge beim Aufrufer:
/// [`lebender_mime_tx`] (404), Besitzer laden, dann diese Funktion (storniert → 409). Die
/// Datei bleibt gespeichert bis zur Schwärzung. Liefert die ETB-id.
#[allow(clippy::too_many_arguments)]
pub async fn entfernen_tx(
    conn: &mut SqliteConnection,
    d: &ErfassungsAblage,
    id: i64,
    mime: &str,
    benutzer_id: i64,
    etb_startwert: i64,
    besitzer: &BesitzerKopf,
    einsatz_id: i64,
) -> Result<i64, AppError> {
    if besitzer.storniert {
        return Err(AppError::Conflict(d.storniert_meldung.into()));
    }
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {} SET geloescht_at = datetime('now'), geloescht_von_id = ? WHERE id = ?",
        d.linker
    )))
    .bind(benutzer_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    let text = etb_text(&besitzer.etb_name, mime, Vorgang::Entfernt);
    crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &text).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etb_text_nennt_nur_name_und_art() {
        assert_eq!(
            etb_text("Tier T-007", "image/jpeg", Vorgang::Abgelegt),
            "Tier T-007: Foto abgelegt"
        );
        assert_eq!(
            etb_text("UHS BHP 50", "image/heic", Vorgang::Entfernt),
            "UHS BHP 50: Foto entfernt"
        );
        assert_eq!(
            etb_text("Schaden S-012", "application/pdf", Vorgang::Abgelegt),
            "Schaden S-012: PDF abgelegt"
        );
        assert_eq!(
            etb_text("Schaden S-012", "text/plain", Vorgang::Entfernt),
            "Schaden S-012: Datei entfernt"
        );
    }

    /// Jede Ablage steht im Linker-Register — sonst gälte ihre Datei als „ungebunden“
    /// (Sweep, generischer Download/DELETE für die hochladende Person, Chat, ETB).
    #[test]
    fn jede_erfassungs_ablage_steht_im_linker_register() {
        for d in ERFASSUNGS_ABLAGEN {
            assert!(
                crate::anhang::repo::MODUL_LINKER
                    .iter()
                    .any(|l| l.tabelle == d.linker),
                "{} fehlt in anhang::repo::MODUL_LINKER",
                d.linker
            );
        }
    }

    /// Jede SQL-Form des Kerns läuft für jeden Deskriptor gegen eine frisch migrierte DB —
    /// ein Tippfehler in einer Konstante fällt hier auf, nicht erst zur Laufzeit.
    #[tokio::test]
    async fn jede_sql_form_laeuft_fuer_jede_ablage() {
        let pool = crate::db::test_pool().await;
        for d in ERFASSUNGS_ABLAGEN {
            assert!(matches!(
                liste(&pool, d, 1, 1).await.unwrap_err(),
                AppError::NotFound
            ));
            assert!(matches!(
                laden(&pool, d, 1, 1, 1).await.unwrap_err(),
                AppError::NotFound
            ));
            assert!(matches!(
                anhang_id_fuer_download(&pool, d, 1, 1, 1)
                    .await
                    .unwrap_err(),
                AppError::NotFound
            ));
            let mut conn = pool.acquire().await.unwrap();
            assert!(matches!(
                lebender_mime_tx(&mut conn, d, 1, 1, 1).await.unwrap_err(),
                AppError::NotFound
            ));
            // INSERT/UPDATE-Formen: ein Besitzer-Fremdschlüssel scheitert an der DB, nicht am
            // SQL-Text — EXPLAIN prüft nur die Form.
            for sql in [
                format!(
                    "EXPLAIN INSERT INTO {} (einsatz_id, {}, anhang_id, abgelegt_von_id) \
                     VALUES (1, 1, 1, 1) RETURNING id",
                    d.linker, d.besitzer_spalte
                ),
                format!(
                    "EXPLAIN UPDATE {} SET geloescht_at = datetime('now'), geloescht_von_id = 1 \
                     WHERE id = 1",
                    d.linker
                ),
            ] {
                sqlx::query(sqlx::AssertSqlSafe(sql))
                    .execute(&mut *conn)
                    .await
                    .unwrap_or_else(|e| panic!("{}: {e}", d.linker));
            }
        }
    }

    #[tokio::test]
    async fn storniert_ist_409_vor_jeder_zeile() {
        let pool = crate::db::test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        let kopf = BesitzerKopf {
            storniert: true,
            etb_name: "Schaden S-001".into(),
        };
        let d = &crate::schaden::anhang::SCHADEN_ABLAGE;
        let fehler = ablegen_tx(
            &mut conn,
            d,
            1,
            1,
            1,
            1,
            &kopf,
            &Ablage {
                dateiname: "x.jpg",
                mime: "image/jpeg",
                daten: b"X",
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(fehler, AppError::Conflict(ref m) if m == "Schaden ist storniert"));
        let fehler = entfernen_tx(&mut conn, d, 1, "image/jpeg", 1, 1, &kopf, 1)
            .await
            .unwrap_err();
        assert!(matches!(fehler, AppError::Conflict(_)));
        let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
        assert_eq!(anhaenge, 0);
    }
}
