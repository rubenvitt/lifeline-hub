//! Speicher der Benachrichtigungen (design.md D1): eine Zeile je Empfänger, ohne Text.
//!
//! Jede Lese- und Schreibfunktion außer [`anlegen`], [`quittieren_fuer_bezug`] und
//! [`aufraeumen`] ist an EINEN Empfänger gebunden, dessen Kennung die Route aus der Sitzung
//! nimmt: eine fremde Zeile ist so unerreichbar (404), nicht nur verboten.

use super::{Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, BenachrichtigungStufe};
use crate::error::AppError;
use chrono::{DateTime, Duration, Utc};
use sqlx::SqlitePool;

/// Wie lange eine unquittierte Benachrichtigung nachgereicht wird und lebt (Spec „Verpasste
/// Benachrichtigungen werden nachgereicht“).
pub const NACHREICHEN_STUNDEN: i64 = 12;

/// Wie lange eine quittierte Zeile bleibt, ehe der Scheduler sie abräumt (design.md D1).
pub const QUITTIERT_AUFBEWAHRUNG_STUNDEN: i64 = 24;

/// Höchstzahl der Zeilen einer Listenantwort, jüngste zuerst. Zwölf Stunden einer Großlage
/// bleiben weit darunter; die Grenze schützt den Server, nicht die Fachlichkeit.
pub const LISTE_MAX: i64 = 200;

/// Eine gespeicherte Benachrichtigung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Zeile {
    pub id: i64,
    pub einsatz_id: i64,
    pub benutzer_id: i64,
    pub art: BenachrichtigungArt,
    pub stufe: BenachrichtigungStufe,
    pub bezug_typ: BenachrichtigungBezugTyp,
    pub bezug_id: i64,
    pub erstellt_at: String,
    pub quittiert_at: Option<String>,
}

type RohZeile = (
    i64,
    i64,
    i64,
    String,
    String,
    String,
    i64,
    String,
    Option<String>,
);

const SPALTEN: &str = "id, einsatz_id, benutzer_id, art, stufe, bezug_typ, bezug_id, \
     erstellt_at, quittiert_at";

/// Eine Zeile mit unbekanntem Katalogwert (Datenbank neuer als der Code) fällt weg, statt die
/// ganze Antwort scheitern zu lassen.
fn aus_roh(r: RohZeile) -> Option<Zeile> {
    Some(Zeile {
        id: r.0,
        einsatz_id: r.1,
        benutzer_id: r.2,
        art: BenachrichtigungArt::parse(&r.3)?,
        stufe: BenachrichtigungStufe::parse(&r.4)?,
        bezug_typ: BenachrichtigungBezugTyp::parse(&r.5)?,
        bezug_id: r.6,
        erstellt_at: r.7,
        quittiert_at: r.8,
    })
}

/// Schreibt je Empfänger eine Zeile, alle in einer Transaktion. Liefert `(benutzer_id, id)`.
pub async fn anlegen(
    pool: &SqlitePool,
    anlass: &Anlass,
    empfaenger: &[i64],
) -> Result<Vec<(i64, i64)>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let mut tx = pool.begin().await?;
    let mut zeilen = Vec::with_capacity(empfaenger.len());
    for &benutzer_id in empfaenger {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO benachrichtigung (einsatz_id, benutzer_id, art, stufe, bezug_typ, \
                 bezug_id, ausloeser_id, erstellt_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(anlass.einsatz_id)
        .bind(benutzer_id)
        .bind(anlass.art.as_str())
        .bind(anlass.art.stufe().as_str())
        .bind(anlass.bezug.typ.as_str())
        .bind(anlass.bezug.id)
        .bind(anlass.ausloeser)
        .bind(&jetzt)
        .fetch_one(&mut *tx)
        .await?;
        zeilen.push((benutzer_id, id));
    }
    tx.commit().await?;
    Ok(zeilen)
}

/// Die eigene Benachrichtigung `id` von `benutzer_id`; eine fremde oder unbekannte: `None`.
pub async fn laden_eigene(
    pool: &SqlitePool,
    id: i64,
    benutzer_id: i64,
) -> Result<Option<Zeile>, AppError> {
    let sql = format!("SELECT {SPALTEN} FROM benachrichtigung WHERE id = ? AND benutzer_id = ?");
    let roh = sqlx::query_as::<_, RohZeile>(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .bind(benutzer_id)
        .fetch_optional(pool)
        .await?;
    Ok(roh.and_then(aus_roh))
}

/// Die Benachrichtigungen von `benutzer_id` der letzten [`NACHREICHEN_STUNDEN`], jüngste
/// zuerst, höchstens [`LISTE_MAX`]. `offen` nur unquittierte, `einsatz_id` nur die eines Einsatzes.
pub async fn liste(
    pool: &SqlitePool,
    benutzer_id: i64,
    offen: bool,
    einsatz_id: Option<i64>,
    jetzt: DateTime<Utc>,
) -> Result<Vec<Zeile>, AppError> {
    let seit = crate::zeit::formatiere_utc(jetzt - Duration::hours(NACHREICHEN_STUNDEN));
    let sql = format!(
        "SELECT {SPALTEN} FROM benachrichtigung \
         WHERE benutzer_id = ? AND erstellt_at >= ? \
           AND (? = 0 OR quittiert_at IS NULL) \
           AND (? IS NULL OR einsatz_id = ?) \
         ORDER BY erstellt_at DESC, id DESC LIMIT ?"
    );
    let roh = sqlx::query_as::<_, RohZeile>(sqlx::AssertSqlSafe(sql))
        .bind(benutzer_id)
        .bind(seit)
        .bind(offen)
        .bind(einsatz_id)
        .bind(einsatz_id)
        .bind(LISTE_MAX)
        .fetch_all(pool)
        .await?;
    Ok(roh.into_iter().filter_map(aus_roh).collect())
}

/// Quittiert die eigene Benachrichtigung. `None`: fremd oder unbekannt. `Some(true)`: jetzt
/// quittiert, `Some(false)`: war es schon (idempotent, kein zweites Ereignis).
pub async fn quittieren(
    pool: &SqlitePool,
    id: i64,
    benutzer_id: i64,
) -> Result<Option<bool>, AppError> {
    let geaendert = sqlx::query(
        "UPDATE benachrichtigung SET quittiert_at = ? \
         WHERE id = ? AND benutzer_id = ? AND quittiert_at IS NULL",
    )
    .bind(crate::zeit::jetzt())
    .bind(id)
    .bind(benutzer_id)
    .execute(pool)
    .await?
    .rows_affected();
    if geaendert > 0 {
        return Ok(Some(true));
    }
    let vorhanden: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM benachrichtigung WHERE id = ? AND benutzer_id = ?")
            .bind(id)
            .bind(benutzer_id)
            .fetch_optional(pool)
            .await?;
    Ok(vorhanden.map(|_| false))
}

/// Quittiert die offenen Zeilen der Art `art` zu den Bezügen `typ`/`ids` im Einsatz, für ALLE
/// Empfänger (LLH-1062: eine gesichtete Meldung ist für jeden erledigt). Die einzige
/// Schreibfunktion außer [`anlegen`] und [`aufraeumen`], die nicht an einen Empfänger gebunden
/// ist: sie nimmt nur, was der Server selbst gemeldet hat, und gibt nichts heraus als das
/// Quittier-Ereignis an den jeweiligen Empfänger. Liefert die jetzt quittierten Zeilen.
pub async fn quittieren_fuer_bezug(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    typ: BenachrichtigungBezugTyp,
    ids: &[i64],
) -> Result<Vec<Zeile>, AppError> {
    let sql = format!(
        "UPDATE benachrichtigung SET quittiert_at = ? \
         WHERE einsatz_id = ? AND art = ? AND bezug_typ = ? AND quittiert_at IS NULL \
           AND bezug_id IN (SELECT value FROM json_each(?)) \
         RETURNING {SPALTEN}"
    );
    let roh = sqlx::query_as::<_, RohZeile>(sqlx::AssertSqlSafe(sql))
        .bind(crate::zeit::jetzt())
        .bind(einsatz_id)
        .bind(art.as_str())
        .bind(typ.as_str())
        .bind(serde_json::to_string(ids).expect("ID-Liste serialisierbar"))
        .fetch_all(pool)
        .await?;
    let mut zeilen: Vec<Zeile> = roh.into_iter().filter_map(aus_roh).collect();
    zeilen.sort_by_key(|z| z.id);
    Ok(zeilen)
}

/// Räumt ab (Scheduler, design.md D1): quittierte Zeilen, deren Quittung älter als
/// [`QUITTIERT_AUFBEWAHRUNG_STUNDEN`] ist, und unquittierte, älter als [`NACHREICHEN_STUNDEN`].
/// Liefert die Zahl der gelöschten Zeilen.
pub async fn aufraeumen(pool: &SqlitePool, jetzt: DateTime<Utc>) -> Result<u64, AppError> {
    let quittiert_vor =
        crate::zeit::formatiere_utc(jetzt - Duration::hours(QUITTIERT_AUFBEWAHRUNG_STUNDEN));
    let erstellt_vor = crate::zeit::formatiere_utc(jetzt - Duration::hours(NACHREICHEN_STUNDEN));
    Ok(sqlx::query(
        "DELETE FROM benachrichtigung \
         WHERE (quittiert_at IS NOT NULL AND quittiert_at < ?) \
            OR (quittiert_at IS NULL AND erstellt_at < ?)",
    )
    .bind(quittiert_vor)
    .bind(erstellt_vor)
    .execute(pool)
    .await?
    .rows_affected())
}
