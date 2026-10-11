//! Die eigene Führungsstelle eines Einsatzes (LFH-849): die Gegenstelle des Funkplans (ELW,
//! Einsatzleitung) mit Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und den
//! Fahrzeugen, die sie tragen (LFH-1106). Seit LFH-1181 ein Ort mit Ausstattung: Art (mobil,
//! ortsfest), Bezeichnung und Standort (Adresse, Koordinate; Migration 0177).
//!
//! Eine Zeile je Einsatz (Migration 0145), lazy beim ersten Schreiben; fehlt sie, gilt die
//! Führungsstelle als nicht erfasst und der Abruf liefert alle Angaben leer. Sprechgruppen (0145)
//! und Fahrzeuge (0171) hängen in eigenen Zuordnungstabellen. Nicht zu verwechseln
//! mit `einsatz_mitgliedschaft.fuehrungsstelle` (Freitext je Person, LFH-461).
//!
//! Herleitung: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D2),
//! `openspec/changes/archive/2026-10-11-lfh-1181-fuehrungsstelle-ort/design.md` (D1, D2).

use crate::error::AppError;
use crate::sprechgruppe::{Sprechgruppe, SprechgruppeAnzeige};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

wire_enum! {
    /// Art der Führungsstelle (FwDV 100): `mobil` (ELW, Führungsfahrzeug) oder `ortsfest`
    /// (Feuerwehrhaus, TEL im Rathaus). Nie leer, Vorgabe `mobil`; die CHECK-Liste in
    /// `migrations/0177_einsatz_fuehrungsstelle_ort.sql` spiegelt `ALLE`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum FuehrungsstellenArt {
        Mobil => "mobil",
        Ortsfest => "ortsfest",
    }
}

/// Höchstlänge der Bezeichnung (LFH-1181, `src/AGENTS.md`, „Eingabegrenzen“).
pub const FUEHRUNGSSTELLE_BEZEICHNUNG_MAX: usize = 200;
/// Höchstlänge der Standort-Adresse, wie der Ort eines Schadens (`schaden::ORT_MAX`).
pub const FUEHRUNGSSTELLE_ADRESSE_MAX: usize = 500;

/// Die Führungsstelle, wie der Client sie liest. Leere Angaben fehlen im JSON; die Art steht
/// immer.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct FuehrungsstelleAnzeige {
    /// Ohne gespeicherte Zeile die Vorgabe `mobil`. Zählt nicht dafür, ob die Führungsstelle
    /// erfasst ist (Spec `einsatz-fuehrungsstelle`).
    pub art: FuehrungsstellenArt,
    /// Name der Stelle, z. B. „ELW 2 Musterstadt“ oder „TEL Rathaus“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezeichnung: Option<String>,
    /// Adresse des Standorts. Wird geschwärzt (kann eine Privatadresse sein).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort_adresse: Option<String>,
    /// Koordinate des Standorts, nur als Paar gesetzt. Wird mit der Adresse geschwärzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort_lat: Option<f64>,
    /// Länge zur Breite `standort_lat`, nur als Paar gesetzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort_lon: Option<f64>,
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
/// (Migration 0171) löst die Zuordnung still, das Ereignis `einsatz` muss der Aufrufer melden.
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
    /// Nie leer: die Route lehnt `null` ab.
    pub art: Option<FuehrungsstellenArt>,
    pub bezeichnung: Option<Option<&'a str>>,
    pub standort_adresse: Option<Option<&'a str>>,
    /// Die Route prüft das Paar am Stand nach der Änderung.
    pub standort_lat: Option<Option<f64>>,
    pub standort_lon: Option<Option<f64>>,
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
    art: String,
    bezeichnung: Option<String>,
    standort_adresse: Option<String>,
    standort_lat: Option<f64>,
    standort_lon: Option<f64>,
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
        "SELECT art, bezeichnung, standort_adresse, standort_lat, standort_lon, \
                rufname, kommunikationsmittel, erreichbarkeit \
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
    let z = zeile.unwrap_or(Zeile {
        art: FuehrungsstellenArt::Mobil.as_str().to_string(),
        bezeichnung: None,
        standort_adresse: None,
        standort_lat: None,
        standort_lon: None,
        rufname: None,
        kommunikationsmittel: None,
        erreichbarkeit: None,
    });
    let art = FuehrungsstellenArt::parse(&z.art).ok_or_else(|| {
        AppError::Internal(format!("Unbekannte Art der Führungsstelle: {}", z.art))
    })?;
    Ok(FuehrungsstelleAnzeige {
        art,
        bezeichnung: z.bezeichnung,
        standort_adresse: z.standort_adresse,
        standort_lat: z.standort_lat,
        standort_lon: z.standort_lon,
        rufname: z.rufname,
        sprechgruppen: sprechgruppen.iter().map(Sprechgruppe::anzeige).collect(),
        kommunikationsmittel: z.kommunikationsmittel,
        erreichbarkeit: z.erreichbarkeit,
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
    // Je Feld ein UPDATE: feste Statements statt eines zusammengesetzten SQL-Texts.
    if let Some(art) = patch.art {
        sqlx::query("UPDATE einsatz_fuehrungsstelle SET art = ? WHERE einsatz_id = ?")
            .bind(art.as_str())
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    for (spalte, wert) in [
        ("standort_lat", patch.standort_lat),
        ("standort_lon", patch.standort_lon),
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
    for (spalte, wert) in [
        ("bezeichnung", patch.bezeichnung),
        ("standort_adresse", patch.standort_adresse),
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
