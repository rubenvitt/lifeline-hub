//! Die eigene Führungsstelle eines Einsatzes (LFH-849): die Gegenstelle des Funkplans (ELW,
//! Einsatzleitung) mit Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und den
//! Fahrzeugen, die sie tragen (LFH-1106).
//!
//! Eine Zeile je Einsatz (Migration 0145), lazy beim ersten Schreiben; fehlt sie, gilt die
//! Führungsstelle als nicht erfasst und der Abruf liefert alle Angaben leer. Sprechgruppen (0145)
//! und Fahrzeuge (0168) hängen in eigenen Zuordnungstabellen. Nicht zu verwechseln
//! mit `einsatz_mitgliedschaft.fuehrungsstelle` (Freitext je Person, LFH-461).
//!
//! Herleitung: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D2).

use crate::error::AppError;
use crate::sprechgruppe::{Sprechgruppe, SprechgruppeAnzeige};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Die Führungsstelle, wie der Client sie liest. Leere Angaben fehlen im JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct FuehrungsstelleAnzeige {
    /// Funkrufname der Führungsstelle, z. B. „Florian Musterstadt 10/1“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rufname: Option<String>,
    /// Zugeordnete Sprechgruppen (Katalog oder einsatzlokal), sortiert wie an Abschnitt und
    /// Einheit.
    pub sprechgruppen: Vec<SprechgruppeAnzeige>,
    /// Kommunikationsart-Schlüssel (`routes::support::KOMMUNIKATIONSMITTEL`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kommunikationsmittel: Option<String>,
    /// Personenbezogen: wird geschwärzt und steht nie im Lagebericht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erreichbarkeit: Option<String>,
    /// Dispositionszeilen (`einsatz_fahrzeug.id`), die die Führungsstelle tragen, aufsteigend.
    /// Nur IDs: die Führungsstelle liest jeder mit dem Einsatz, Fahrzeugdaten nur das Modul
    /// Fahrzeuge (LFH-1106; Spec `einsatz-fuehrungsstelle`, „Fahrzeuge der Führungsstelle“).
    pub fahrzeug_ids: Vec<i64>,
}

/// Höchstzahl der Fahrzeuge einer Führungsstelle (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
pub const FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX: usize = 16;

/// Fahrzeug-Liste von außen: sortiert, entdoppelt, höchstens
/// [`FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX`] (sonst 400), vor jedem Schreiben.
pub fn normalisiere_fahrzeug_ids(mut ids: Vec<i64>) -> Result<Vec<i64>, AppError> {
    ids.sort_unstable();
    ids.dedup();
    if ids.len() > FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX} Fahrzeuge je Führungsstelle"
        )));
    }
    Ok(ids)
}

/// Prüft, dass jede ID eine Dispositionszeile dieses Einsatzes ist; sonst 422 (Zusammenhang,
/// `src/AGENTS.md`, Statuscode-Konvention). Eine Abfrage für die ganze Liste.
pub async fn pruefe_fahrzeuge(
    pool: &SqlitePool,
    einsatz_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    let disponiert: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_fahrzeug \
         WHERE id IN (SELECT value FROM json_each(?)) AND einsatz_id = ?",
    )
    .bind(ids_json(ids)?)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    if let Some(id) = ids.iter().find(|id| !disponiert.contains(id)) {
        return Err(AppError::UnprocessableEntity(format!(
            "Fahrzeug {id} ist diesem Einsatz nicht disponiert"
        )));
    }
    Ok(())
}

/// Trägt die Dispositionszeile die Führungsstelle? Wer sie löscht, fragt vorher: die Kaskade
/// (Migration 0168) löst die Zuordnung still, das Ereignis `einsatz` muss der Aufrufer melden.
pub async fn traegt_fahrzeug_tx(
    conn: &mut SqliteConnection,
    einsatz_fahrzeug_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_fuehrungsstelle_fahrzeug WHERE einsatz_fahrzeug_id = ?",
    )
    .bind(einsatz_fahrzeug_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(treffer.is_some())
}

fn ids_json(ids: &[i64]) -> Result<String, AppError> {
    serde_json::to_string(ids)
        .map_err(|e| AppError::Internal(format!("Fahrzeug-ids serialisieren: {e}")))
}

/// Teiländerung: `None` = unverändert, `Some(None)` = leeren. Werte sind bereits getrimmt und
/// geprüft (Route).
#[derive(Debug, Default)]
pub struct FuehrungsstellePatch<'a> {
    pub rufname: Option<Option<&'a str>>,
    pub kommunikationsmittel: Option<Option<&'a str>>,
    pub erreichbarkeit: Option<Option<&'a str>>,
    /// Ersetzt die Zuordnung vollständig. Die IDs prüft der Aufrufer vorher
    /// (`sprechgruppe::repo::pruefe_zuordenbar`).
    pub sprechgruppe_ids: Option<&'a [i64]>,
    /// Ersetzt die Fahrzeuge vollständig. Die IDs prüft der Aufrufer vorher
    /// ([`pruefe_fahrzeuge`]).
    pub fahrzeug_ids: Option<&'a [i64]>,
}

#[derive(sqlx::FromRow)]
struct Zeile {
    rufname: Option<String>,
    kommunikationsmittel: Option<String>,
    erreichbarkeit: Option<String>,
}

/// Lädt die Führungsstelle; ohne Zeile alle Angaben leer.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<FuehrungsstelleAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    laden_tx(&mut conn, einsatz_id).await
}

async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<FuehrungsstelleAnzeige, AppError> {
    let zeile = sqlx::query_as::<_, Zeile>(
        "SELECT rufname, kommunikationsmittel, erreichbarkeit \
         FROM einsatz_fuehrungsstelle WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let sprechgruppen = sqlx::query_as::<_, Sprechgruppe>(
        "SELECT sg.id, sg.org_id, sg.einsatz_id, sg.bezeichnung, sg.betriebsart, \
                sg.hinweis, sg.netz, sg.sicherheit, sg.aktiv, sg.sortier, sg.angelegt_at \
         FROM sprechgruppe sg \
         JOIN einsatz_fuehrungsstelle_sprechgruppe fs ON fs.sprechgruppe_id = sg.id \
         WHERE fs.einsatz_id = ? \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let fahrzeug_ids = sqlx::query_scalar::<_, i64>(
        "SELECT einsatz_fahrzeug_id FROM einsatz_fuehrungsstelle_fahrzeug \
         WHERE einsatz_id = ? ORDER BY einsatz_fahrzeug_id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    let (rufname, kommunikationsmittel, erreichbarkeit) = match zeile {
        Some(z) => (z.rufname, z.kommunikationsmittel, z.erreichbarkeit),
        None => (None, None, None),
    };
    Ok(FuehrungsstelleAnzeige {
        rufname,
        sprechgruppen: sprechgruppen.iter().map(Sprechgruppe::anzeige).collect(),
        kommunikationsmittel,
        erreichbarkeit,
        fahrzeug_ids,
    })
}

/// Schreibt die Teiländerung und liefert den neuen Stand — alles in der offenen Transaktion des
/// Aufrufers (`write_retry!`), damit ein Fehler nichts teilweise speichert.
pub async fn patchen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    patch: &FuehrungsstellePatch<'_>,
) -> Result<FuehrungsstelleAnzeige, AppError> {
    sqlx::query("INSERT OR IGNORE INTO einsatz_fuehrungsstelle (einsatz_id) VALUES (?)")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    // Je Feld ein UPDATE: drei feste Statements statt eines zusammengesetzten SQL-Texts.
    for (spalte, wert) in [
        ("rufname", patch.rufname),
        ("kommunikationsmittel", patch.kommunikationsmittel),
        ("erreichbarkeit", patch.erreichbarkeit),
    ] {
        let Some(wert) = wert else { continue };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE einsatz_fuehrungsstelle SET {spalte} = ? WHERE einsatz_id = ?"
        )))
        .bind(wert)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    }
    if let Some(ids) = patch.sprechgruppe_ids {
        crate::sprechgruppe::repo::ersetzen_tx(
            conn,
            crate::sprechgruppe::repo::Zuordnungsziel::Fuehrungsstelle(einsatz_id),
            ids,
        )
        .await?;
    }
    if let Some(ids) = patch.fahrzeug_ids {
        // Zwei Anweisungen, unabhängig von der Länge der Liste (Muster
        // `sprechgruppe::repo::ersetzen_tx`).
        let ids = ids_json(ids)?;
        sqlx::query(
            "DELETE FROM einsatz_fuehrungsstelle_fahrzeug WHERE einsatz_id = ? \
               AND einsatz_fahrzeug_id NOT IN (SELECT value FROM json_each(?))",
        )
        .bind(einsatz_id)
        .bind(&ids)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO einsatz_fuehrungsstelle_fahrzeug \
               (einsatz_id, einsatz_fahrzeug_id) SELECT ?, value FROM json_each(?)",
        )
        .bind(einsatz_id)
        .bind(&ids)
        .execute(&mut *conn)
        .await?;
    }
    laden_tx(conn, einsatz_id).await
}
