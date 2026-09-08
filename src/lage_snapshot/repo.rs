//! Persistenz der Lage-Snapshots. `daten` liegt als JSON-String in einer `TEXT`-Spalte; die
//! Liste selektiert `daten` bewusst **nicht** (Größe). Der Capture `erzeuge` (LFH-321, Task 2)
//! sammelt das volle Lagebild über Pool-Reuse ein.

use crate::error::AppError;
use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;

use super::{LageSnapshotAnzeige, LageSnapshotDokument};

/// POST-Body: manuelle Snapshot-Auslösung mit optionaler Bezeichnung/Notiz.
#[derive(Debug, Deserialize)]
pub struct NeuerLageSnapshot {
    pub bezeichnung: Option<String>,
    pub notiz: Option<String>,
}

/// PATCH-Body — **nur** Metadaten. `daten`/`stand_at`/`erstellt_*` sind strukturell NICHT
/// enthalten (Unveränderlichkeit ist typseitig erzwungen). Tri-State (`Option<Option<T>>`):
/// absent = unverändert, `null` = löschen, Wert = setzen.
#[derive(Debug, Deserialize)]
pub struct PatchLageSnapshot {
    #[serde(default)]
    pub bezeichnung: Option<Option<String>>,
    #[serde(default)]
    pub notiz: Option<Option<String>>,
}

const SELECT_META: &str = "\
    SELECT id, einsatz_id, bezeichnung, notiz, stand_at, schema_version, erstellt_von, erstellt_at \
    FROM lage_snapshot";

#[derive(sqlx::FromRow)]
struct MetaRow {
    id: i64,
    einsatz_id: i64,
    bezeichnung: Option<String>,
    notiz: Option<String>,
    stand_at: String,
    schema_version: i64,
    erstellt_von: i64,
    erstellt_at: String,
}

impl MetaRow {
    fn zu_anzeige(self) -> LageSnapshotAnzeige {
        LageSnapshotAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            bezeichnung: self.bezeichnung,
            notiz: self.notiz,
            stand_at: self.stand_at,
            schema_version: self.schema_version,
            erstellt_von: self.erstellt_von,
            erstellt_at: self.erstellt_at,
        }
    }
}

/// Snapshots eines Einsatzes — nur Metadaten, **ohne** `daten`. Neueste zuerst.
pub async fn liste_metadaten(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LageSnapshotAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, MetaRow>(sqlx::AssertSqlSafe(format!(
        "{SELECT_META} WHERE einsatz_id = ? ORDER BY stand_at DESC, id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(MetaRow::zu_anzeige).collect())
}

#[derive(sqlx::FromRow)]
struct DokRow {
    id: i64,
    einsatz_id: i64,
    bezeichnung: Option<String>,
    notiz: Option<String>,
    stand_at: String,
    schema_version: i64,
    erstellt_von: i64,
    erstellt_at: String,
    daten: String,
}

/// Volldokument eines Snapshots (inkl. eingefrorenem `daten`-Lagebild), einsatz-gescopt.
pub async fn lade_dokument(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<Option<LageSnapshotDokument>, AppError> {
    let row = sqlx::query_as::<_, DokRow>(
        "SELECT id, einsatz_id, bezeichnung, notiz, stand_at, schema_version, erstellt_von, \
                erstellt_at, daten \
         FROM lage_snapshot WHERE einsatz_id = ? AND id = ?",
    )
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let daten: Value = serde_json::from_str(&row.daten)
        .map_err(|e| AppError::Internal(format!("lage_snapshot.daten kein gültiges JSON: {e}")))?;
    Ok(Some(LageSnapshotDokument {
        id: row.id,
        einsatz_id: row.einsatz_id,
        bezeichnung: row.bezeichnung,
        notiz: row.notiz,
        stand_at: row.stand_at,
        schema_version: row.schema_version,
        erstellt_von: row.erstellt_von,
        erstellt_at: row.erstellt_at,
        daten,
    }))
}

/// Rohe INSERT-Primitive (genutzt von `erzeuge` und Tests). `daten` wird als JSON-String abgelegt.
#[allow(clippy::too_many_arguments)]
pub async fn insert_roh(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    bezeichnung: Option<&str>,
    notiz: Option<&str>,
    stand_at: &str,
    daten: &Value,
) -> Result<i64, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_snapshot \
             (einsatz_id, bezeichnung, notiz, stand_at, schema_version, daten, erstellt_von) \
         VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(bezeichnung)
    .bind(notiz)
    .bind(stand_at)
    .bind(daten.to_string())
    .bind(benutzer_id)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Snapshot löschen (Dokumenten-Vernichtung). `true`, wenn eine Zeile getroffen wurde.
pub async fn loesche(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<bool, AppError> {
    let res = sqlx::query("DELETE FROM lage_snapshot WHERE einsatz_id = ? AND id = ?")
        .bind(einsatz_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Aktualisiert **nur** die Metadaten (Tri-State: `None` = Feld unverändert, `Some(None)` =
/// auf NULL, `Some(Some(v))` = setzen). `daten`/`stand_at`/`erstellt_*` bleiben unangetastet —
/// das ist die Unveränderlichkeits-Garantie. Kein gesetztes Feld = No-op.
pub async fn patche_meta(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    bezeichnung: Option<Option<&str>>,
    notiz: Option<Option<&str>>,
) -> Result<(), AppError> {
    if let Some(b) = bezeichnung {
        sqlx::query("UPDATE lage_snapshot SET bezeichnung = ? WHERE einsatz_id = ? AND id = ?")
            .bind(b)
            .bind(einsatz_id)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(n) = notiz {
        sqlx::query("UPDATE lage_snapshot SET notiz = ? WHERE einsatz_id = ? AND id = ?")
            .bind(n)
            .bind(einsatz_id)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Eingefrorenes Lagebild (`schema_version = 1`). Jedes Feld ist die **rohe `*Anzeige`-DTO-Liste**
/// der jeweiligen Lagekarte-Quelle — so bleiben Inspector-Felder (status/staerke/abschnitt_id …)
/// erhalten und das Frontend leitet Marker im Replay durch die unveränderten `baueMarker`-Ableiter.
#[derive(serde::Serialize)]
struct SnapshotDaten {
    version: u32,
    stand_at: String,
    /// Eingefrorener Org-TZ-Default (`organisation.tz_organisation`) — Fallback in der
    /// Marker-Ableitung; muss eingefroren werden, sonst ändert eine Org-Umbenennung den Stand.
    #[serde(skip_serializing_if = "Option::is_none")]
    org_default: Option<String>,
    einsatz: crate::einsatz::EinsatzAnzeige,
    ansichten: Vec<crate::karten_ansicht::KartenAnsichtAnzeige>,
    uhs: Vec<crate::uhs::UhsAnzeige>,
    schaeden: Vec<crate::schaden::SchadenAnzeige>,
    einheiten: Vec<crate::einheit::EinheitAnzeige>,
    fahrzeuge: Vec<crate::fahrzeug::EinsatzFahrzeugAnzeige>,
    fuehrungskraefte: Vec<crate::personal::FuehrungskraftKarte>,
    abschnitte: Vec<crate::einsatzabschnitt::EinsatzabschnittAnzeige>,
    zonen: Vec<crate::lage_zone::LageZoneAnzeige>,
    freie_zeichen: Vec<crate::freies_zeichen::FreiesZeichenAnzeige>,
    /// Enthält `hoechste_warnstufe` je Gebiet — die Zonen-Färbung; ebenfalls einzufrieren.
    gefahrengebiete: Vec<crate::gefahr::GefahrengebietAnzeige>,
    lagemeldungen: Vec<crate::meldung::LageMeldungAnzeige>,
    /// Nur Metadaten/ID-Referenz — die BLOB-Bytes bleiben live (kein 5-MB-Grundriss je Stand).
    bilder: Vec<crate::karte_hintergrundbild::HintergrundbildAnzeige>,
}

/// Capture: friert das volle Lagebild eines Einsatzes in EIN JSON-Dokument ein (LFH-321, C).
///
/// Sammelt über **Pool-Reuse** dieselben Roh-`*Anzeige`-DTOs ein, die auch die Lagekarte speisen.
/// Bewusst **keine** echte Read-Transaktion (jede `liste` nutzt eine eigene Pool-Connection) — für
/// einen manuell ausgelösten Stand akzeptiert; SQLite serialisiert Writes, das Torn-Read-Fenster ist
/// winzig. Global-Scope-Ableitungsinputs (`org_default`, gefahrengebiet-Warnstufe über die
/// Gebiets-Liste) werden mit eingefroren — sonst schriebe ein späterer Config-Wechsel den Stand um.
pub async fn erzeuge(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    bezeichnung: Option<&str>,
    notiz: Option<&str>,
) -> Result<LageSnapshotDokument, AppError> {
    let einsatz = crate::einsatz::repo::laden(pool, einsatz_id).await?;
    let einsatz_aktiv = einsatz.ist_aktiv();
    let org_default: Option<String> =
        sqlx::query_scalar("SELECT tz_organisation FROM organisation WHERE id = ?")
            .bind(einsatz.org_id)
            .fetch_one(pool)
            .await?;
    let stand_at: String = sqlx::query_scalar("SELECT datetime('now')")
        .fetch_one(pool)
        .await?;

    let daten = SnapshotDaten {
        version: 1,
        stand_at: stand_at.clone(),
        org_default,
        einsatz: einsatz.anzeige(None, None),
        ansichten: crate::karten_ansicht::repo::liste(pool, einsatz_id).await?,
        uhs: crate::uhs::repo::liste(pool, einsatz_id, None, None).await?,
        // inkl_storniert=false: der Stand spiegelt das sichtbare Lagebild, nicht stornierte Schäden.
        schaeden: crate::schaden::repo::liste(pool, einsatz_id, None, None, None, None, false)
            .await?,
        einheiten: crate::einheit::repo::liste(pool, einsatz_id).await?,
        // Fahrzeuge aus der einsatz-scoped Disposition (NICHT dem org-weiten Fuhrpark).
        fahrzeuge: crate::fahrzeug::disposition_repo::liste(pool, einsatz_id, einsatz_aktiv)
            .await?,
        // Nur Führungskräfte werden Marker (EL/AL), nicht das gesamte Personal.
        fuehrungskraefte: crate::personal::disposition_repo::liste_fuehrungskraefte(
            pool, einsatz_id,
        )
        .await?,
        abschnitte: crate::einsatzabschnitt::repo::liste(pool, einsatz_id).await?,
        zonen: crate::lage_zone::repo::liste(pool, einsatz_id, None).await?,
        freie_zeichen: crate::freies_zeichen::repo::liste(pool, einsatz_id, None).await?,
        gefahrengebiete: crate::gefahr::repo::gebiete_liste(pool, einsatz_id).await?,
        lagemeldungen: crate::meldung::repo::liste_lage_meldungen(pool, einsatz_id).await?,
        bilder: crate::karte_hintergrundbild::repo::liste(pool, einsatz_id, None).await?,
    };

    let daten_value = serde_json::to_value(&daten)
        .map_err(|e| AppError::Internal(format!("Snapshot-Serialisierung: {e}")))?;
    let id = insert_roh(
        pool,
        einsatz_id,
        benutzer_id,
        bezeichnung,
        notiz,
        &stand_at,
        &daten_value,
    )
    .await?;
    lade_dokument(pool, einsatz_id, id)
        .await?
        .ok_or_else(|| AppError::Internal("Snapshot direkt nach Anlegen nicht auffindbar".into()))
}
