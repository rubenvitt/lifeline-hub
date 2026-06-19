//! Einsatz-Einstellungen (LFH-55 / LFH-131) — 1:1 pro Einsatz.
//!
//! Hybrid-Speichermodell (Decision Record LFH-55): skalare Spalten + eine
//! JSON-Spalte (`fachebenen_sichtbar`). Validierung erfolgt in Rust statt per
//! DB-CHECK (sqlx-sqlite 0.8.6 kann CHECK nicht per Rebuild ändern).

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Gültige Basemap-Modi (Validierung in Rust statt DB-CHECK).
pub const BASEMAP_MODI: [&str; 3] = ["online", "offline", "blind"];

/// Ob `s` ein gültiger Basemap-Modus ist (für die Eingabe-Validierung).
pub fn ist_gueltiger_basemap_modus(s: &str) -> bool {
    BASEMAP_MODI.contains(&s)
}

/// Einsatz-Einstellungen wie in der DB abgelegt (1:1 pro Einsatz). Alle Felder
/// optional — `None` = Default. `fachebenen_sichtbar` ist der rohe JSON-String.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EinsatzEinstellungen {
    pub einsatz_id: i64,
    pub standard_modul: Option<String>,
    pub basemap_modus: Option<String>,
    pub karten_zoom_start: Option<f64>,
    pub fachebenen_sichtbar: Option<String>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

impl EinsatzEinstellungen {
    fn leer(einsatz_id: i64) -> Self {
        Self {
            einsatz_id,
            standard_modul: None,
            basemap_modus: None,
            karten_zoom_start: None,
            fachebenen_sichtbar: None,
            geaendert_at: None,
            geaendert_von: None,
        }
    }

    /// API-Darstellung: `fachebenen_sichtbar` als geparstes Objekt (symmetrisch zur
    /// PUT-Eingabe). Ungültiges/leeres JSON → `None`.
    pub fn anzeige(&self) -> EinstellungenAnzeige {
        EinstellungenAnzeige {
            einsatz_id: self.einsatz_id,
            standard_modul: self.standard_modul.clone(),
            basemap_modus: self.basemap_modus.clone(),
            karten_zoom_start: self.karten_zoom_start,
            fachebenen_sichtbar: self
                .fachebenen_sichtbar
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok()),
            geaendert_at: self.geaendert_at.clone(),
            geaendert_von: self.geaendert_von,
        }
    }
}

/// API-Darstellung der Einstellungen (`fachebenen_sichtbar` als Objekt).
#[derive(Debug, Clone, Serialize)]
pub struct EinstellungenAnzeige {
    pub einsatz_id: i64,
    pub standard_modul: Option<String>,
    pub basemap_modus: Option<String>,
    pub karten_zoom_start: Option<f64>,
    pub fachebenen_sichtbar: Option<serde_json::Value>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

/// Lädt die Einstellungen eines Einsatzes; existiert keine Zeile, werden Defaults
/// (alle `None`) zurückgegeben. Der Aufrufer hat den Einsatz bereits geladen (404/Guard).
pub async fn laden_oder_default(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<EinsatzEinstellungen, AppError> {
    let row = sqlx::query_as::<_, EinsatzEinstellungen>(
        "SELECT einsatz_id, standard_modul, basemap_modus, karten_zoom_start, \
                fachebenen_sichtbar, geaendert_at, geaendert_von \
         FROM einsatz_einstellungen WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_else(|| EinsatzEinstellungen::leer(einsatz_id)))
}

/// Eingabe für `speichern`; bereits vom Handler getrimmt/validiert.
#[derive(Debug)]
pub struct EinstellungenDaten<'a> {
    pub standard_modul: Option<&'a str>,
    pub basemap_modus: Option<&'a str>,
    pub karten_zoom_start: Option<f64>,
    pub fachebenen_sichtbar: Option<&'a str>,
}

/// Speichert die Einstellungen (UPSERT auf `einsatz_id`); setzt die Audit-Felder.
pub async fn speichern(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: EinstellungenDaten<'_>,
) -> Result<EinsatzEinstellungen, AppError> {
    sqlx::query(
        "INSERT INTO einsatz_einstellungen \
            (einsatz_id, standard_modul, basemap_modus, karten_zoom_start, \
             fachebenen_sichtbar, geaendert_at, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?) \
         ON CONFLICT(einsatz_id) DO UPDATE SET \
             standard_modul = excluded.standard_modul, \
             basemap_modus = excluded.basemap_modus, \
             karten_zoom_start = excluded.karten_zoom_start, \
             fachebenen_sichtbar = excluded.fachebenen_sichtbar, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(einsatz_id)
    .bind(daten.standard_modul)
    .bind(daten.basemap_modus)
    .bind(daten.karten_zoom_start)
    .bind(daten.fachebenen_sichtbar)
    .bind(erfasser_id)
    .execute(pool)
    .await?;
    laden_oder_default(pool, einsatz_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    /// Legt Org(1) + Benutzer + Einsatz an; liefert (einsatz_id, benutzer_id).
    /// Benutzer ist nötig, weil `geaendert_von` ein FK auf `benutzer(id)` ist und
    /// sqlx `foreign_keys` per Default aktiviert (id=0 würde mit FK-Violation brechen).
    async fn fixture(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let bid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let eid = sqlx::query_scalar::<_, i64>(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) \
             VALUES (1, 'Lage', '2026-001') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (eid, bid)
    }

    #[tokio::test]
    async fn laden_oder_default_ohne_zeile_ist_leer() {
        let pool = crate::db::test_pool().await;
        let (eid, _bid) = fixture(&pool).await;
        let e = laden_oder_default(&pool, eid).await.unwrap();
        assert_eq!(e.einsatz_id, eid);
        assert_eq!(e.standard_modul, None);
        assert_eq!(e.basemap_modus, None);
        assert_eq!(e.karten_zoom_start, None);
        assert_eq!(e.fachebenen_sichtbar, None);
    }

    #[tokio::test]
    async fn speichern_upsert_und_laden() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = fixture(&pool).await;

        let gespeichert = speichern(
            &pool,
            eid,
            bid,
            EinstellungenDaten {
                standard_modul: Some("lagekarte"),
                basemap_modus: Some("offline"),
                karten_zoom_start: Some(12.0),
                fachebenen_sichtbar: Some(
                    r#"{"nina":true,"dwd":false,"pegelonline":false,"kritis":false}"#,
                ),
            },
        )
        .await
        .unwrap();
        assert_eq!(gespeichert.standard_modul.as_deref(), Some("lagekarte"));
        assert_eq!(gespeichert.basemap_modus.as_deref(), Some("offline"));
        assert_eq!(gespeichert.karten_zoom_start, Some(12.0));
        assert!(gespeichert.geaendert_at.is_some());
        assert_eq!(gespeichert.geaendert_von, Some(bid));

        // Upsert: zweites Speichern überschreibt dieselbe Zeile (kein zweiter Insert).
        let zweite = speichern(
            &pool,
            eid,
            bid,
            EinstellungenDaten {
                standard_modul: None,
                basemap_modus: Some("online"),
                karten_zoom_start: None,
                fachebenen_sichtbar: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(zweite.standard_modul, None);
        assert_eq!(zweite.basemap_modus.as_deref(), Some("online"));

        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einstellungen WHERE einsatz_id = ?")
                .bind(eid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 1);
    }

    #[tokio::test]
    async fn anzeige_parst_fachebenen_zu_objekt() {
        let e = EinsatzEinstellungen {
            einsatz_id: 1,
            standard_modul: None,
            basemap_modus: None,
            karten_zoom_start: None,
            fachebenen_sichtbar: Some(r#"{"nina":true,"dwd":false,"pegelonline":false,"kritis":false}"#.into()),
            geaendert_at: None,
            geaendert_von: None,
        };
        let a = e.anzeige();
        assert_eq!(a.fachebenen_sichtbar.as_ref().unwrap()["nina"], true);
        assert_eq!(a.fachebenen_sichtbar.as_ref().unwrap()["dwd"], false);
    }
}
