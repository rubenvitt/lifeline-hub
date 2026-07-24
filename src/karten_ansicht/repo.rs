use crate::einsatz::einstellungen;
use crate::error::AppError;
use serde::Deserialize;
use sqlx::SqlitePool;

use super::KartenAnsichtAnzeige;

/// „Für den Einsatz speichern" (LFH-319): Vollersatz der Konfigurationsfelder einer
/// Ansicht. Das Frontend schickt beim Speichern den vollständigen Karten-Zustand;
/// ein weggelassenes Config-Feld ist damit bewusst `NULL` (z. B. `online_stil` im
/// Offline-Modus). `name`/`reihenfolge`/`ist_standard` gehören NICHT hierher — deren
/// Pflege (Umbenennen, Standard setzen) ist Inkrement B.
#[derive(Debug, Deserialize)]
pub struct AnsichtPatch {
    pub basemap_modus: Option<String>,
    pub online_stil: Option<String>,
    pub karten_theme: Option<String>,
    pub layer_sichtbar: Option<serde_json::Value>,
    pub fachebenen_sichtbar: Option<serde_json::Value>,
    pub zentrum_lat: Option<f64>,
    pub zentrum_lon: Option<f64>,
    pub zoom: Option<f64>,
}

fn json_str(v: &Option<serde_json::Value>) -> Option<String> {
    v.as_ref().map(|x| x.to_string())
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, name, reihenfolge, ist_standard, basemap_modus, online_stil, \
           karten_theme, layer_sichtbar, fachebenen_sichtbar, zentrum_lat, zentrum_lon, \
           zoom, erstellt_von, erstellt_at, geaendert_at, geaendert_von \
    FROM karten_ansicht";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    name: String,
    reihenfolge: i64,
    ist_standard: i64,
    basemap_modus: Option<String>,
    online_stil: Option<String>,
    karten_theme: Option<String>,
    layer_sichtbar: Option<String>,
    fachebenen_sichtbar: Option<String>,
    zentrum_lat: Option<f64>,
    zentrum_lon: Option<f64>,
    zoom: Option<f64>,
    erstellt_von: Option<i64>,
    erstellt_at: String,
    geaendert_at: String,
    geaendert_von: Option<i64>,
}

/// Rohen JSON-String aus der DB zu `Value` — ein unparsbarer Rest wird zu `None`
/// (der Client fällt dann auf seinen Default zurück, statt zu brechen).
fn json_parse(s: Option<String>) -> Option<serde_json::Value> {
    s.and_then(|t| serde_json::from_str(&t).ok())
}

fn zu_anzeige(r: Row) -> KartenAnsichtAnzeige {
    KartenAnsichtAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        name: r.name,
        reihenfolge: r.reihenfolge,
        ist_standard: r.ist_standard != 0,
        basemap_modus: r.basemap_modus,
        online_stil: r.online_stil,
        karten_theme: r.karten_theme,
        layer_sichtbar: json_parse(r.layer_sichtbar),
        fachebenen_sichtbar: json_parse(r.fachebenen_sichtbar),
        zentrum_lat: r.zentrum_lat,
        zentrum_lon: r.zentrum_lon,
        zoom: r.zoom,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
        geaendert_von: r.geaendert_von,
    }
}

pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<KartenAnsichtAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY reihenfolge, id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Eine Ansicht einsatz-skopiert laden. `None` = existiert nicht oder gehört zu einem
/// anderen Einsatz (→ 404 im Handler).
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<Option<KartenAnsichtAnzeige>, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE einsatz_id = ? AND id = ?"
    )))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(zu_anzeige))
}

/// Konfiguration einer Ansicht überschreiben (Vollersatz der Config, s. [`AnsichtPatch`]).
/// `None` = die Ansicht gehört nicht zu diesem Einsatz (→ 404). Enum-Werte sind vom
/// Handler bereits validiert.
pub async fn patche(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    p: &AnsichtPatch,
    benutzer_id: i64,
) -> Result<Option<KartenAnsichtAnzeige>, AppError> {
    let res = sqlx::query(
        "UPDATE karten_ansicht SET \
             basemap_modus = ?, online_stil = ?, karten_theme = ?, \
             layer_sichtbar = ?, fachebenen_sichtbar = ?, \
             zentrum_lat = ?, zentrum_lon = ?, zoom = ?, \
             geaendert_at = datetime('now'), geaendert_von = ? \
         WHERE einsatz_id = ? AND id = ?",
    )
    .bind(&p.basemap_modus)
    .bind(&p.online_stil)
    .bind(&p.karten_theme)
    .bind(json_str(&p.layer_sichtbar))
    .bind(json_str(&p.fachebenen_sichtbar))
    .bind(p.zentrum_lat)
    .bind(p.zentrum_lon)
    .bind(p.zoom)
    .bind(benutzer_id)
    .bind(einsatz_id)
    .bind(id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(None);
    }
    laden(pool, einsatz_id, id).await
}

/// Existiert für den Einsatz keine Ansicht, lege lazy eine Standardansicht an —
/// gespeist aus `einsatz_einstellungen` (basemap_modus/fachebenen_sichtbar/zoom),
/// Layer bleibt NULL (= FE-Default „alle an").
///
/// Race-fest ohne Transaktion: `INSERT OR IGNORE … SELECT … WHERE NOT EXISTS` ist
/// atomar; der partielle UNIQUE-Index (`ist_standard = 1`) ist das Sicherheitsnetz.
/// Ein gleichzeitiger zweiter Seed sieht die Zeile (WHERE NOT EXISTS) oder wird vom
/// `OR IGNORE` geschluckt — ein GET darf **nie** an einem 409 scheitern.
pub async fn standard_oder_saat(pool: &SqlitePool, einsatz_id: i64) -> Result<(), AppError> {
    let einst = einstellungen::laden_oder_default(pool, einsatz_id).await?;
    sqlx::query(
        "INSERT OR IGNORE INTO karten_ansicht \
             (einsatz_id, name, reihenfolge, ist_standard, basemap_modus, fachebenen_sichtbar, zoom) \
         SELECT ?, 'Standard', 0, 1, ?, ?, ? \
         WHERE NOT EXISTS (SELECT 1 FROM karten_ansicht WHERE einsatz_id = ?)",
    )
    .bind(einsatz_id)
    .bind(&einst.basemap_modus)
    .bind(&einst.fachebenen_sichtbar)
    .bind(einst.karten_zoom_start)
    .bind(einsatz_id)
    .execute(pool)
    .await?;
    Ok(())
}
