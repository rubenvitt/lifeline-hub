use crate::einsatz::einstellungen;
use crate::error::AppError;
use serde::Deserialize;
use sqlx::SqlitePool;

use super::KartenAnsichtAnzeige;

/// „Für den Einsatz speichern“: Vollersatz der Konfigurationsfelder einer Ansicht. Das Frontend
/// schickt den vollständigen Karten-Zustand; ein weggelassenes Feld ist damit bewusst `NULL`
/// (z. B. `online_stil` im Offline-Modus).
#[derive(Debug, Deserialize)]
pub struct AnsichtPatch {
    /// Umbenennen, unabhängig von der Konfiguration. `None` = unverändert.
    pub name: Option<String>,
    /// Standard setzen: nur `Some(true)` wirkt (Transaktion). `Some(false)` hinterließe keine
    /// Standardansicht und wird ignoriert.
    pub ist_standard: Option<bool>,
    pub basemap_modus: Option<String>,
    pub online_stil: Option<String>,
    pub karten_theme: Option<String>,
    pub layer_sichtbar: Option<serde_json::Value>,
    pub fachebenen_sichtbar: Option<serde_json::Value>,
    pub zentrum_lat: Option<f64>,
    pub zentrum_lon: Option<f64>,
    pub zoom: Option<f64>,
}

impl AnsichtPatch {
    /// Trägt der Patch Konfigurations-Felder? Nur dann läuft der Config-Vollersatz ([`patche`]),
    /// sonst wischte ein reines Umbenennen die Config auf NULL.
    pub fn hat_config(&self) -> bool {
        self.basemap_modus.is_some()
            || self.online_stil.is_some()
            || self.karten_theme.is_some()
            || self.layer_sichtbar.is_some()
            || self.fachebenen_sichtbar.is_some()
            || self.zentrum_lat.is_some()
            || self.zentrum_lon.is_some()
            || self.zoom.is_some()
    }
}

/// Felder zum Anlegen einer weiteren Ansicht („Als neue Ansicht speichern“). `name` ist
/// Pflicht; die Config-Felder spiegeln [`AnsichtPatch`]. Die neue Ansicht ist nie Standard und
/// reiht hinter die bestehenden ein.
#[derive(Debug, Deserialize)]
pub struct AnsichtNeu {
    pub name: String,
    pub basemap_modus: Option<String>,
    pub online_stil: Option<String>,
    pub karten_theme: Option<String>,
    pub layer_sichtbar: Option<serde_json::Value>,
    pub fachebenen_sichtbar: Option<serde_json::Value>,
    pub zentrum_lat: Option<f64>,
    pub zentrum_lon: Option<f64>,
    pub zoom: Option<f64>,
}

/// Behandlung der ansichtsgebundenen Objekte beim Löschen einer Ansicht.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjektBehandlung {
    /// Objekte auf `ansicht_id = NULL` setzen (einsatzweit sichtbar) — Default.
    Freigeben,
    /// Objekte der Ansicht mitlöschen.
    Loeschen,
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

/// Roher JSON-String aus der DB → `Value`; Unparsbares wird `None`, damit der Client auf seinen
/// Default fällt.
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

/// Prüft eine gesendete `ansicht_id` gegen den Einsatz (LFH-738). Die id von `karten_ansicht`
/// gilt für die ganze Instanz; ungeprüft hinge ein Kartenobjekt an der Ansicht eines fremden
/// Einsatzes, und deren Löschen setzte die Zuordnung per `ON DELETE SET NULL` still zurück.
/// `None` (auf allen Ansichten sichtbar) ist immer zulässig. Fremd und unbekannt sind beide
/// `NotFound` (404) — ununterscheidbar, damit kein Existenz-Orakel entsteht.
pub async fn pruefe_zugehoerig(
    pool: &SqlitePool,
    einsatz_id: i64,
    ansicht_id: Option<i64>,
) -> Result<(), AppError> {
    let Some(id) = ansicht_id else {
        return Ok(());
    };
    let gefunden: Option<i64> =
        sqlx::query_scalar("SELECT id FROM karten_ansicht WHERE einsatz_id = ? AND id = ?")
            .bind(einsatz_id)
            .bind(id)
            .fetch_optional(pool)
            .await?;
    gefunden.map(|_| ()).ok_or(AppError::NotFound)
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

/// Lege lazy eine Standardansicht an, falls der Einsatz keine hat — aus `einsatz_einstellungen`
/// (basemap_modus/fachebenen_sichtbar/zoom); Layer bleibt NULL (Frontend: „alle an“).
///
/// Race-fest ohne Transaktion: `INSERT OR IGNORE … SELECT … WHERE NOT EXISTS` ist atomar, der
/// partielle UNIQUE-Index (`ist_standard = 1`) das Netz. Ein GET darf nie an einem 409
/// scheitern.
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

/// Legt eine weitere Ansicht an: nie Standard, `reihenfolge = max+1`. Enum-Werte hat der Handler
/// validiert.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    neu: &AnsichtNeu,
    benutzer_id: i64,
) -> Result<KartenAnsichtAnzeige, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO karten_ansicht \
             (einsatz_id, name, reihenfolge, ist_standard, basemap_modus, online_stil, \
              karten_theme, layer_sichtbar, fachebenen_sichtbar, zentrum_lat, zentrum_lon, \
              zoom, erstellt_von) \
         VALUES (?, ?, \
             (SELECT COALESCE(MAX(reihenfolge), -1) + 1 FROM karten_ansicht WHERE einsatz_id = ?), \
             0, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(neu.name.trim())
    .bind(einsatz_id)
    .bind(&neu.basemap_modus)
    .bind(&neu.online_stil)
    .bind(&neu.karten_theme)
    .bind(json_str(&neu.layer_sichtbar))
    .bind(json_str(&neu.fachebenen_sichtbar))
    .bind(neu.zentrum_lat)
    .bind(neu.zentrum_lon)
    .bind(neu.zoom)
    .bind(benutzer_id)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await?.ok_or(AppError::NotFound)
}

/// Benennt eine Ansicht um, ohne die Konfiguration zu berühren. `None` = fremd (404).
pub async fn benenne_um(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    name: &str,
    benutzer_id: i64,
) -> Result<Option<KartenAnsichtAnzeige>, AppError> {
    let res = sqlx::query(
        "UPDATE karten_ansicht SET name = ?, geaendert_at = datetime('now'), geaendert_von = ? \
         WHERE einsatz_id = ? AND id = ?",
    )
    .bind(name)
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

/// Setzt eine Ansicht als Standard in EINER Transaktion: erst alle anderen auf 0, dann diese
/// auf 1, damit der partielle UNIQUE-Index nie doppelt trifft. Die Existenzprüfung in der
/// Transaktion verhindert, dass eine fremde `id` das Standard-Flag löscht. `None` = fremd (404).
pub async fn setze_standard(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
) -> Result<Option<KartenAnsichtAnzeige>, AppError> {
    let mut tx = pool.begin().await?;
    let existiert: Option<i64> =
        sqlx::query_scalar("SELECT id FROM karten_ansicht WHERE einsatz_id = ? AND id = ?")
            .bind(einsatz_id)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    if existiert.is_none() {
        return Ok(None); // Rollback beim Drop
    }
    sqlx::query("UPDATE karten_ansicht SET ist_standard = 0 WHERE einsatz_id = ? AND id <> ?")
        .bind(einsatz_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE karten_ansicht SET ist_standard = 1, geaendert_at = datetime('now'), \
             geaendert_von = ? WHERE einsatz_id = ? AND id = ?",
    )
    .bind(benutzer_id)
    .bind(einsatz_id)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Löscht eine Ansicht. Fremde `id` → 404; Standardansicht oder letzte Ansicht → 422. Objekte
/// werden je [`ObjektBehandlung`] freigegeben oder mitgelöscht — explizit, in derselben
/// Transaktion und VOR dem Ansichts-DELETE, weil `ON DELETE SET NULL` die `ansicht_id` sonst
/// schon genullt hätte und der Filter nichts mehr fände.
pub async fn loesche(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    behandlung: ObjektBehandlung,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    let ist_standard: Option<i64> = sqlx::query_scalar(
        "SELECT ist_standard FROM karten_ansicht WHERE einsatz_id = ? AND id = ?",
    )
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(ist_standard) = ist_standard else {
        return Err(AppError::NotFound);
    };
    if ist_standard != 0 {
        return Err(AppError::UnprocessableEntity(
            "Die Standardansicht ist nicht löschbar".into(),
        ));
    }
    let anzahl: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM karten_ansicht WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *tx)
            .await?;
    if anzahl <= 1 {
        return Err(AppError::UnprocessableEntity(
            "Die letzte verbleibende Ansicht ist nicht löschbar".into(),
        ));
    }

    // Verwaiste Gefahrengebiet-Gruppen nach dem Commit aufräumen (nur beim Löschen).
    let mut gruppen: Vec<i64> = Vec::new();
    match behandlung {
        ObjektBehandlung::Freigeben => {
            for tabelle in ["freies_zeichen", "lage_zone", "karte_hintergrundbild"] {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "UPDATE {tabelle} SET ansicht_id = NULL WHERE einsatz_id = ? AND ansicht_id = ?"
                )))
                .bind(einsatz_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            }
        }
        ObjektBehandlung::Loeschen => {
            // Zonen zuerst: RETURNING liefert die Gefahrengebiet-Gruppen für das Aufräumen.
            gruppen = sqlx::query_scalar::<_, Option<i64>>(
                "DELETE FROM lage_zone WHERE einsatz_id = ? AND ansicht_id = ? \
                 RETURNING gefahrengebiet_id",
            )
            .bind(einsatz_id)
            .bind(id)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .flatten()
            .collect();
            for tabelle in ["freies_zeichen", "karte_hintergrundbild"] {
                sqlx::query(sqlx::AssertSqlSafe(format!(
                    "DELETE FROM {tabelle} WHERE einsatz_id = ? AND ansicht_id = ?"
                )))
                .bind(einsatz_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    sqlx::query("DELETE FROM karten_ansicht WHERE einsatz_id = ? AND id = ?")
        .bind(einsatz_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    // Nach dem Commit, nicht unter dem Write-Lock: leer gewordene Gruppen aufräumen.
    gruppen.sort_unstable();
    gruppen.dedup();
    for g in gruppen {
        crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(pool, g).await?;
    }
    Ok(())
}
