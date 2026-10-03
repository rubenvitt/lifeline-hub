//! Die eigene Führungsstelle eines Einsatzes (LFH-849): die Gegenstelle des Funkplans (ELW,
//! Einsatzleitung) mit Rufname, Sprechgruppen, Kommunikationsmittel und Erreichbarkeit.
//!
//! Eine Zeile je Einsatz (Migration 0145), lazy beim ersten Schreiben; fehlt sie, gilt die
//! Führungsstelle als nicht erfasst und der Abruf liefert alle Angaben leer. Nicht zu verwechseln
//! mit `einsatz_mitgliedschaft.fuehrungsstelle` (Freitext je Person, LFH-461).
//!
//! Herleitung: `openspec/changes/lfh-849-eigene-fuehrungsstelle/design.md` (D2).

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
                sg.hinweis, sg.aktiv, sg.sortier, sg.angelegt_at \
         FROM sprechgruppe sg \
         JOIN einsatz_fuehrungsstelle_sprechgruppe fs ON fs.sprechgruppe_id = sg.id \
         WHERE fs.einsatz_id = ? \
         ORDER BY sg.betriebsart, sg.sortier, sg.bezeichnung",
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
        sqlx::query("DELETE FROM einsatz_fuehrungsstelle_sprechgruppe WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
        for &id in ids {
            sqlx::query(
                "INSERT OR IGNORE INTO einsatz_fuehrungsstelle_sprechgruppe \
                 (einsatz_id, sprechgruppe_id) VALUES (?, ?)",
            )
            .bind(einsatz_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        }
    }
    laden_tx(conn, einsatz_id).await
}
