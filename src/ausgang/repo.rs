//! Tabelle `ausgang` (LLH-2093, Migration 0374). Schreibwege nehmen eine Verbindung (`_tx`), damit
//! der Aufrufer sie mit ETB und Quellprüfung in einer Transaktion bündelt; die Lesewege der
//! Versandliste und der Lauf nehmen den Pool. Fremde Einsätze sind `NotFound` (404).

use super::zustand::{AusgangFehler, QuelleArt};
use super::{NeuerVersand, Versand, VersandZeile};
use crate::error::AppError;
use crate::externe_stelle::KanalArt;
use crate::write_retry;
use chrono::{DateTime, Utc};
use sqlx::{SqliteConnection, SqlitePool};

/// Alle Spalten von `ausgang` für [`VersandZeile`].
const ZEILE: &str = "id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, \
     externe_stelle_id, stelle_bezeichnung, adresse, betreff, inhalt, zustand, versuche, \
     naechster_versuch_at, erster_versuch_at, versuch_begonnen_at, fehler_art, fehler_status, \
     erstellt_von_id, erstellt_at, uebergeben_at, etb_eintrag_id";

/// Spalten der Versandliste (ohne Text), mit dem Namen des Absenders.
const ANZEIGE: &str = "a.id, a.quelle_art, a.quelle_id, a.kanal, a.externe_stelle_id, \
     a.stelle_bezeichnung, a.adresse, a.betreff, a.zustand, a.fehler_art, a.fehler_status, \
     a.versuche, a.erstellt_von_id, b.anzeigename AS erstellt_von_name, a.erstellt_at, \
     a.uebergeben_at";

#[derive(sqlx::FromRow)]
struct AnzeigeZeile {
    id: String,
    quelle_art: QuelleArt,
    quelle_id: i64,
    #[sqlx(try_from = "String")]
    kanal: KanalArt,
    externe_stelle_id: Option<i64>,
    stelle_bezeichnung: String,
    adresse: String,
    betreff: String,
    zustand: super::VersandZustand,
    fehler_art: Option<AusgangFehler>,
    fehler_status: Option<i64>,
    versuche: i64,
    erstellt_von_id: i64,
    erstellt_von_name: Option<String>,
    erstellt_at: String,
    uebergeben_at: Option<String>,
}

impl From<AnzeigeZeile> for Versand {
    fn from(z: AnzeigeZeile) -> Self {
        Versand {
            id: z.id,
            source_kind: z.quelle_art,
            source_id: z.quelle_id,
            channel: z.kanal,
            agency_id: z.externe_stelle_id,
            agency_name: z.stelle_bezeichnung,
            address: z.adresse,
            subject: z.betreff,
            state: z.zustand,
            error: z.fehler_art,
            smtp_status: z.fehler_status.and_then(|s| u16::try_from(s).ok()),
            attempts: z.versuche,
            created_by_id: z.erstellt_von_id,
            created_by_name: z.erstellt_von_name,
            created_at: z.erstellt_at,
            handed_over_at: z.uebergeben_at,
        }
    }
}

/// Ergebnis eines Zustellversuchs, wie [`save_ergebnis_tx`] es schreibt.
#[derive(Debug, Clone, Copy)]
pub enum Ergebnis {
    /// Vom Mailserver angenommen.
    Uebergeben { at: DateTime<Utc> },
    /// Vorübergehender Fehler: bleibt `wartet`, nächster Versuch zum Zeitpunkt `naechster`.
    Wiederholen {
        naechster: DateTime<Utc>,
        fehler: AusgangFehler,
        status: Option<u16>,
    },
    /// Endgültig `fehlgeschlagen`, ohne weitere Wiederholung.
    Fehlgeschlagen {
        fehler: AusgangFehler,
        status: Option<u16>,
    },
}

fn zeit(t: DateTime<Utc>) -> String {
    crate::zeit::formatiere_utc(t)
}

async fn load_anzeige(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: &str,
) -> Result<Versand, AppError> {
    sqlx::query_as::<_, AnzeigeZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ANZEIGE} FROM ausgang a LEFT JOIN benutzer b ON b.id = a.erstellt_von_id \
         WHERE a.id = ? AND a.einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .map(Versand::from)
    .ok_or(AppError::NotFound)
}

/// Legt einen Versand im Zustand `wartet` an, sofort fällig. Dieselbe `(org_id, client_id)` liefert
/// die vorhandene Zeile (doppeltes Absenden), ohne eine zweite zu schreiben.
pub async fn create_tx(
    conn: &mut SqliteConnection,
    neu: &NeuerVersand<'_>,
) -> Result<Versand, AppError> {
    let jetzt = crate::zeit::jetzt();
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO ausgang (id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, \
             externe_stelle_id, stelle_bezeichnung, adresse, betreff, inhalt, zustand, \
             naechster_versuch_at, erstellt_von_id, erstellt_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wartet', ?, ?, ?) \
         ON CONFLICT (org_id, client_id) DO NOTHING",
    )
    .bind(&id)
    .bind(neu.org_id)
    .bind(neu.einsatz_id)
    .bind(neu.client_id)
    .bind(neu.quelle.as_str())
    .bind(neu.quelle_id)
    .bind(neu.kanal.channel.as_str())
    .bind(neu.stelle.id)
    .bind(&neu.stelle.bezeichnung)
    .bind(&neu.kanal.address)
    .bind(neu.betreff)
    .bind(neu.inhalt)
    .bind(&jetzt)
    .bind(neu.erstellt_von_id)
    .bind(&jetzt)
    .execute(&mut *conn)
    .await?;
    let vorhanden: String =
        sqlx::query_scalar("SELECT id FROM ausgang WHERE org_id = ? AND client_id = ?")
            .bind(neu.org_id)
            .bind(neu.client_id)
            .fetch_one(&mut *conn)
            .await?;
    load_anzeige(conn, neu.einsatz_id, &vorhanden).await
}

/// Die Versände einer Quelle, neueste zuerst.
pub async fn list_fuer_quelle(
    pool: &SqlitePool,
    einsatz_id: i64,
    quelle: QuelleArt,
    quelle_id: i64,
) -> Result<Vec<Versand>, AppError> {
    let zeilen = sqlx::query_as::<_, AnzeigeZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ANZEIGE} FROM ausgang a LEFT JOIN benutzer b ON b.id = a.erstellt_von_id \
         WHERE a.einsatz_id = ? AND a.quelle_art = ? AND a.quelle_id = ? \
         ORDER BY a.erstellt_at DESC, a.id"
    )))
    .bind(einsatz_id)
    .bind(quelle.as_str())
    .bind(quelle_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().map(Versand::from).collect())
}

/// Alle Versände eines Einsatzes, neueste zuerst.
pub async fn list_fuer_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<Versand>, AppError> {
    let zeilen = sqlx::query_as::<_, AnzeigeZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ANZEIGE} FROM ausgang a LEFT JOIN benutzer b ON b.id = a.erstellt_von_id \
         WHERE a.einsatz_id = ? ORDER BY a.erstellt_at DESC, a.id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen.into_iter().map(Versand::from).collect())
}

/// Eine Zeile mit Text und Merkern; `NotFound`, wenn sie nicht zum Einsatz gehört.
pub async fn load(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: &str,
) -> Result<VersandZeile, AppError> {
    sqlx::query_as::<_, VersandZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ZEILE} FROM ausgang WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// „Erneut senden“: nur aus `fehlgeschlagen` (sonst 422). Setzt die Versuche zurück, beginnt ein
/// neues Wiederholungsfenster und macht den Versand sofort fällig. Die Prüfung der Quelle liegt
/// beim Aufrufer.
pub async fn retry_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: &str,
    jetzt: DateTime<Utc>,
) -> Result<Versand, AppError> {
    load(conn, einsatz_id, id).await?;
    let t = zeit(jetzt);
    let geaendert = sqlx::query(
        "UPDATE ausgang SET zustand = 'wartet', versuche = 0, erster_versuch_at = ?, \
             naechster_versuch_at = ?, versuch_begonnen_at = NULL, fehler_art = NULL, \
             fehler_status = NULL, uebergeben_at = NULL \
         WHERE id = ? AND einsatz_id = ? AND zustand = 'fehlgeschlagen'",
    )
    .bind(&t)
    .bind(&t)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geaendert == 0 {
        return Err(AppError::UnprocessableEntity(
            "Nur ein fehlgeschlagener Versand lässt sich erneut senden".into(),
        ));
    }
    load_anzeige(conn, einsatz_id, id).await
}

/// Fällige Versände: `wartet`, Zeitpunkt erreicht, kein Versuch im Gang; nach Fälligkeit sortiert.
/// Bewusst **nicht** nach Spiegel gefiltert: der Lauf erkennt einen Spiegel und lässt den Versand
/// mit `spiegel` fehlschlagen.
pub async fn load_faellige(
    pool: &SqlitePool,
    jetzt: DateTime<Utc>,
    limit: i64,
) -> Result<Vec<VersandZeile>, AppError> {
    sqlx::query_as::<_, VersandZeile>(sqlx::AssertSqlSafe(format!(
        "SELECT {ZEILE} FROM ausgang \
         WHERE zustand = 'wartet' AND naechster_versuch_at <= ? AND versuch_begonnen_at IS NULL \
         ORDER BY naechster_versuch_at, id LIMIT ?"
    )))
    .bind(zeit(jetzt))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Merkt den Beginn eines Zustellversuchs vor dem Netz: setzt `versuch_begonnen_at`, zählt
/// `versuche` hoch und hält beim ersten Versuch `erster_versuch_at` fest.
pub async fn mark_begonnen(
    pool: &SqlitePool,
    id: &str,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let t = zeit(jetzt);
    write_retry!(pool, |conn| {
        sqlx::query(
            "UPDATE ausgang SET versuch_begonnen_at = ?, versuche = versuche + 1, \
                 erster_versuch_at = COALESCE(erster_versuch_at, ?) \
             WHERE id = ? AND zustand = 'wartet'",
        )
        .bind(&t)
        .bind(&t)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        Ok(())
    })
}

/// Schreibt das Ergebnis eines Versuchs und leert den Merker `versuch_begonnen_at`.
pub async fn save_ergebnis_tx(
    conn: &mut SqliteConnection,
    id: &str,
    ergebnis: Ergebnis,
) -> Result<(), AppError> {
    let q = match ergebnis {
        Ergebnis::Uebergeben { at } => sqlx::query(
            "UPDATE ausgang SET zustand = 'uebergeben', uebergeben_at = ?, \
                 naechster_versuch_at = NULL, versuch_begonnen_at = NULL, fehler_art = NULL, \
                 fehler_status = NULL WHERE id = ?",
        )
        .bind(zeit(at))
        .bind(id),
        Ergebnis::Wiederholen {
            naechster,
            fehler,
            status,
        } => sqlx::query(
            "UPDATE ausgang SET zustand = 'wartet', naechster_versuch_at = ?, \
                 versuch_begonnen_at = NULL, fehler_art = ?, fehler_status = ? WHERE id = ?",
        )
        .bind(zeit(naechster))
        .bind(fehler.as_str())
        .bind(status.map(i64::from))
        .bind(id),
        Ergebnis::Fehlgeschlagen { fehler, status } => sqlx::query(
            "UPDATE ausgang SET zustand = 'fehlgeschlagen', naechster_versuch_at = NULL, \
                 versuch_begonnen_at = NULL, fehler_art = ?, fehler_status = ? WHERE id = ?",
        )
        .bind(fehler.as_str())
        .bind(status.map(i64::from))
        .bind(id),
    };
    let n = q.execute(&mut *conn).await?.rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Merkt den ETB-Eintrag eines Versands (der letzte gewinnt).
pub async fn save_etb_eintrag_tx(
    conn: &mut SqliteConnection,
    id: &str,
    etb_eintrag_id: i64,
) -> Result<(), AppError> {
    sqlx::query("UPDATE ausgang SET etb_eintrag_id = ? WHERE id = ?")
        .bind(etb_eintrag_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Nach einem Neustart: Zeilen mit gesetztem Merker waren mitten in der Zustellung, ob die Mail
/// raus ist, ist unklar. Sie werden `fehlgeschlagen` mit `ungewiss`, ohne Wiederholung. Liefert
/// die Anzahl.
pub async fn recover_unterbrochene(pool: &SqlitePool) -> Result<u64, AppError> {
    write_retry!(pool, |conn| {
        let n = sqlx::query(
            "UPDATE ausgang SET zustand = 'fehlgeschlagen', fehler_art = 'ungewiss', \
                 fehler_status = NULL, naechster_versuch_at = NULL, versuch_begonnen_at = NULL \
             WHERE zustand = 'wartet' AND versuch_begonnen_at IS NOT NULL",
        )
        .execute(&mut *conn)
        .await?
        .rows_affected();
        Ok(n)
    })
}
