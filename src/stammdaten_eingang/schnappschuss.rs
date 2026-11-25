//! Schnappschüsse des Adapters „Stammdaten-Abruf“ (LLH-1194, Migration 0374).
//!
//! Ein Abruf übernimmt nie selbst (G1): er legt den Körper ab ([`ablegen`]), und ein Admin rechnet
//! Vorschau und Übernahme auf genau diesem Stand ([`vorschau`], [`uebernehmen`]). So bleibt die
//! Reihenfolge der Zeilen zwischen beiden gleich, an der die Entscheidungen hängen. Nur ein offener
//! Schnappschuss trägt Inhalt; beim Ersetzen und Übernehmen wird er geleert (Datensparsamkeit).

use serde::Serialize;
use serde_json::Value;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use super::json;
use super::repo::{
    bestand_tx, herkunft_vorschlag_tx, planen, write_tx, Entscheidungen, StammdatenErgebnis,
    StammdatenVorschau,
};
use super::StammdatenPaket;
use crate::error::AppError;
use crate::write_retry;

/// Feld der Adapter-Einstellung mit der Herkunft (Vorgabe für Einträge ohne `herkunft`).
pub const FELD_HERKUNFT: &str = "herkunft";

/// Zählung je Art, wie sie die Liste der offenen Schnappschüsse zeigt.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, serde::Deserialize, ToSchema)]
pub struct Anzahl {
    pub fahrzeuge: i64,
    pub personal: i64,
    pub qualifikationen: i64,
}

impl Anzahl {
    pub fn von(paket: &StammdatenPaket) -> Self {
        Anzahl {
            fahrzeuge: paket.fahrzeuge.len() as i64,
            personal: paket.personal.len() as i64,
            qualifikationen: paket.qualifikationen.len() as i64,
        }
    }
}

/// Ein offener Schnappschuss ohne Inhalt, für Hinweis und Liste.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct SchnappschussInfo {
    pub id: String,
    pub adapter_id: String,
    pub adapter_name: String,
    pub herkunft: String,
    pub anzahl: Anzahl,
    pub abgerufen_at: String,
}

/// Legt den Körper eines Abrufs ab, falls er Neues bringt. `true` = neuer offener Schnappschuss.
/// Gleicht der Fingerabdruck dem offenen oder dem zuletzt übernommenen und ist „Erneut vorlegen“
/// nicht gesetzt, passiert nichts. Sonst wird ein offener ersetzt und die Markierung gelöscht.
pub async fn ablegen(
    conn: &mut SqliteConnection,
    adapter_id: &str,
    org_id: i64,
    koerper: &str,
    fingerabdruck: &str,
    anzahl: &Anzahl,
    jetzt: &str,
) -> Result<bool, AppError> {
    let erzwingen: i64 =
        sqlx::query_scalar("SELECT vorlegen_erzwingen FROM adapter WHERE id = ? AND org_id = ?")
            .bind(adapter_id)
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or(AppError::NotFound)?;
    if erzwingen == 0 {
        let gleich: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM stammdaten_schnappschuss WHERE adapter_id = ? AND fingerabdruck = ? AND \
             (status = 'offen' OR id = (SELECT id FROM stammdaten_schnappschuss \
              WHERE adapter_id = ? AND status = 'uebernommen' ORDER BY erledigt_at DESC, abgerufen_at DESC LIMIT 1))",
        )
        .bind(adapter_id)
        .bind(fingerabdruck)
        .bind(adapter_id)
        .fetch_optional(&mut *conn)
        .await?;
        if gleich.is_some() {
            return Ok(false);
        }
    }
    sqlx::query(
        "UPDATE stammdaten_schnappschuss SET status = 'ersetzt', inhalt = NULL, erledigt_at = ? \
         WHERE adapter_id = ? AND status = 'offen'",
    )
    .bind(jetzt)
    .bind(adapter_id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO stammdaten_schnappschuss (id, org_id, adapter_id, status, fingerabdruck, inhalt, anzahl, abgerufen_at) \
         VALUES (?, ?, ?, 'offen', ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(org_id)
    .bind(adapter_id)
    .bind(fingerabdruck)
    .bind(koerper)
    .bind(serde_json::to_string(anzahl).expect("Anzahl serialisierbar"))
    .bind(jetzt)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE adapter SET vorlegen_erzwingen = 0 WHERE id = ?")
        .bind(adapter_id)
        .execute(&mut *conn)
        .await?;
    raeume_auf(conn, adapter_id, jetzt).await?;
    Ok(true)
}

/// Wie lange erledigte Schnappschüsse (nur Fingerabdruck, Zählung, Zeiten) stehen bleiben.
pub const AUFBEWAHRUNG_TAGE: i64 = 90;

/// Löscht erledigte Schnappschüsse des Adapters, die älter als [`AUFBEWAHRUNG_TAGE`] sind — außer dem
/// jüngsten übernommenen: er ist der Vergleich für „Ruhe bei gleichem Stand“. Läuft mit jedem
/// neuen Schnappschuss, wie das Kürzen von `adapter_versuch`.
async fn raeume_auf(
    conn: &mut SqliteConnection,
    adapter_id: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    let Some(t) = crate::zeit::parse(jetzt) else {
        return Ok(());
    };
    let grenze = crate::zeit::formatiere(t - chrono::Duration::days(AUFBEWAHRUNG_TAGE));
    sqlx::query(
        "DELETE FROM stammdaten_schnappschuss WHERE adapter_id = ? AND status <> 'offen' \
         AND COALESCE(erledigt_at, abgerufen_at) < ? AND id IS NOT (SELECT id FROM stammdaten_schnappschuss \
         WHERE adapter_id = ? AND status = 'uebernommen' ORDER BY erledigt_at DESC, abgerufen_at DESC LIMIT 1)",
    )
    .bind(adapter_id)
    .bind(grenze)
    .bind(adapter_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

fn herkunft_aus(einstellungen: &str) -> String {
    serde_json::from_str::<Value>(einstellungen)
        .ok()
        .and_then(|v| v.get(FELD_HERKUNFT)?.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Die offenen Schnappschüsse der Org, jüngste zuerst, ohne Inhalt.
pub async fn liste_offen(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<Vec<SchnappschussInfo>, AppError> {
    let zeilen: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
        "SELECT s.id, s.adapter_id, a.name, a.einstellungen, s.anzahl, s.abgerufen_at \
         FROM stammdaten_schnappschuss s JOIN adapter a ON a.id = s.adapter_id AND a.org_id = s.org_id \
         WHERE s.org_id = ? AND s.status = 'offen' ORDER BY s.abgerufen_at DESC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(
            |(id, adapter_id, adapter_name, einst, anzahl, abgerufen_at)| SchnappschussInfo {
                id,
                adapter_id,
                adapter_name,
                herkunft: herkunft_aus(&einst),
                anzahl: serde_json::from_str(&anzahl).unwrap_or_default(),
                abgerufen_at,
            },
        )
        .collect())
}

/// Ein offener Schnappschuss, gelesen zum Paket. Fremde Org oder unbekannt → `NotFound`; nicht
/// mehr offen → `Conflict` (inzwischen ersetzt oder übernommen).
struct Offen {
    paket: StammdatenPaket,
    meldungen: Vec<super::DateiMeldung>,
    nicht: Vec<String>,
    herkunft: String,
}

async fn lade(conn: &mut SqliteConnection, org_id: i64, id: &str) -> Result<Offen, AppError> {
    let zeile: Option<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT s.status, s.inhalt, a.einstellungen FROM stammdaten_schnappschuss s \
         JOIN adapter a ON a.id = s.adapter_id WHERE s.id = ? AND s.org_id = ?",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((status, inhalt, einst)) = zeile else {
        return Err(AppError::NotFound);
    };
    let (Some(inhalt), "offen") = (inhalt, status.as_str()) else {
        return Err(AppError::Conflict(
            "Inzwischen sind neuere Daten da. Bitte den aktuellen Stand prüfen.".into(),
        ));
    };
    let (paket, meldungen, nicht) = json::lies_paket(inhalt.as_bytes())
        .map_err(|_| AppError::Internal("Schnappschuss unlesbar".into()))?;
    Ok(Offen {
        paket,
        meldungen,
        nicht,
        herkunft: herkunft_aus(&einst),
    })
}

/// Die Vorschau eines offenen Schnappschusses; schreibt nichts.
pub async fn vorschau(
    pool: &SqlitePool,
    org_id: i64,
    id: &str,
    e: &Entscheidungen,
) -> Result<StammdatenVorschau, AppError> {
    let mut conn = pool.acquire().await?;
    let o = lade(&mut conn, org_id, id).await?;
    let bestand = bestand_tx(&mut conn, org_id).await?;
    let vorschlag = herkunft_vorschlag_tx(&mut conn, org_id).await?;
    let planung = planen(
        &bestand,
        &o.paket,
        &o.meldungen,
        &o.nicht,
        Some(o.herkunft.as_str()).filter(|h| !h.is_empty()),
        vorschlag,
        e,
    )?;
    Ok(planung.vorschau)
}

/// Übernimmt einen offenen Schnappschuss in EINER Transaktion: rechnet die Vorschau neu, schreibt
/// sie und setzt den Schnappschuss auf `uebernommen` (Inhalt geleert).
pub async fn uebernehmen(
    pool: &SqlitePool,
    org_id: i64,
    id: &str,
    benutzer_id: i64,
    e: &Entscheidungen,
) -> Result<(StammdatenErgebnis, Vec<i64>), AppError> {
    let jetzt = crate::zeit::jetzt();
    let (ergebnis, fahrzeug_ids) = write_retry!(pool, |conn| {
        let o = lade(conn, org_id, id).await?;
        let bestand = bestand_tx(conn, org_id).await?;
        let vorschlag = herkunft_vorschlag_tx(conn, org_id).await?;
        let planung = planen(
            &bestand,
            &o.paket,
            &o.meldungen,
            &o.nicht,
            Some(o.herkunft.as_str()).filter(|h| !h.is_empty()),
            vorschlag,
            e,
        )?;
        let aus = write_tx(conn, org_id, &planung, &jetzt).await?;
        sqlx::query(
            "UPDATE stammdaten_schnappschuss SET status = 'uebernommen', inhalt = NULL, \
             erledigt_at = ?, erledigt_von = ? WHERE id = ? AND status = 'offen'",
        )
        .bind(&jetzt)
        .bind(benutzer_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        Ok(aus)
    })?;
    tracing::info!(org_id, schnappschuss = id, zaehlung = ?ergebnis.zaehlung, "Stammdaten-Schnappschuss übernommen");
    Ok((ergebnis, fahrzeug_ids))
}

/// „Erneut vorlegen“: der nächste Lauf legt in jedem Fall einen Schnappschuss an.
pub async fn erneut_vorlegen(
    pool: &SqlitePool,
    org_id: i64,
    adapter_id: &str,
) -> Result<(), AppError> {
    let n = sqlx::query("UPDATE adapter SET vorlegen_erzwingen = 1 WHERE id = ? AND org_id = ?")
        .bind(adapter_id)
        .bind(org_id)
        .execute(pool)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
