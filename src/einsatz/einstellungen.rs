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

// Anzeige-Konventionen (LFH-136) — Whitelist-Validierung in Rust statt DB-CHECK.

/// Gültige Zeitformate.
pub const ZEITFORMATE: [&str; 2] = ["24h", "12h"];
/// Gültige Einheiten-Systeme.
pub const EINHEITEN_SYSTEME: [&str; 2] = ["metrisch", "imperial"];
/// Gültige Koordinatenformate.
pub const KOORDINATENFORMATE: [&str; 3] = ["wgs84", "mgrs", "utm"];

/// Ob `s` ein gültiges Zeitformat ist.
pub fn ist_gueltiges_zeitformat(s: &str) -> bool {
    ZEITFORMATE.contains(&s)
}

/// Ob `s` ein gültiges Einheiten-System ist.
pub fn ist_gueltiges_einheiten_system(s: &str) -> bool {
    EINHEITEN_SYSTEME.contains(&s)
}

/// Ob `s` ein gültiges Koordinatenformat ist.
pub fn ist_gueltiges_koordinatenformat(s: &str) -> bool {
    KOORDINATENFORMATE.contains(&s)
}

/// Ob `s` eine pragmatisch gültige Zeitzone ist. Volle IANA-TZ-DB-Prüfung wäre
/// Over-Engineering (siehe Plan-Risiken) — Backend prüft nur „nicht-leer"; die UI
/// bietet eine kuratierte Liste + Freitext.
pub fn ist_gueltige_zeitzone(s: &str) -> bool {
    !s.trim().is_empty()
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
    // Anzeige-Konventionen (LFH-136); None = projektweiter Default.
    pub zeitzone: Option<String>,
    pub zeitformat: Option<String>,
    pub einheiten: Option<String>,
    pub koordinatenformat: Option<String>,
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
            zeitzone: None,
            zeitformat: None,
            einheiten: None,
            koordinatenformat: None,
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
            zeitzone: self.zeitzone.clone(),
            zeitformat: self.zeitformat.clone(),
            einheiten: self.einheiten.clone(),
            koordinatenformat: self.koordinatenformat.clone(),
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
    pub zeitzone: Option<String>,
    pub zeitformat: Option<String>,
    pub einheiten: Option<String>,
    pub koordinatenformat: Option<String>,
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
                fachebenen_sichtbar, zeitzone, zeitformat, einheiten, koordinatenformat, \
                geaendert_at, geaendert_von \
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
    pub zeitzone: Option<&'a str>,
    pub zeitformat: Option<&'a str>,
    pub einheiten: Option<&'a str>,
    pub koordinatenformat: Option<&'a str>,
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
             fachebenen_sichtbar, zeitzone, zeitformat, einheiten, koordinatenformat, \
             geaendert_at, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?) \
         ON CONFLICT(einsatz_id) DO UPDATE SET \
             standard_modul = excluded.standard_modul, \
             basemap_modus = excluded.basemap_modus, \
             karten_zoom_start = excluded.karten_zoom_start, \
             fachebenen_sichtbar = excluded.fachebenen_sichtbar, \
             zeitzone = excluded.zeitzone, \
             zeitformat = excluded.zeitformat, \
             einheiten = excluded.einheiten, \
             koordinatenformat = excluded.koordinatenformat, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(einsatz_id)
    .bind(daten.standard_modul)
    .bind(daten.basemap_modus)
    .bind(daten.karten_zoom_start)
    .bind(daten.fachebenen_sichtbar)
    .bind(daten.zeitzone)
    .bind(daten.zeitformat)
    .bind(daten.einheiten)
    .bind(daten.koordinatenformat)
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
                zeitzone: Some("Europe/Berlin"),
                zeitformat: Some("24h"),
                einheiten: Some("metrisch"),
                koordinatenformat: Some("mgrs"),
            },
        )
        .await
        .unwrap();
        assert_eq!(gespeichert.standard_modul.as_deref(), Some("lagekarte"));
        assert_eq!(gespeichert.basemap_modus.as_deref(), Some("offline"));
        assert_eq!(gespeichert.karten_zoom_start, Some(12.0));
        assert_eq!(gespeichert.zeitzone.as_deref(), Some("Europe/Berlin"));
        assert_eq!(gespeichert.zeitformat.as_deref(), Some("24h"));
        assert_eq!(gespeichert.einheiten.as_deref(), Some("metrisch"));
        assert_eq!(gespeichert.koordinatenformat.as_deref(), Some("mgrs"));
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
                zeitzone: None,
                zeitformat: None,
                einheiten: None,
                koordinatenformat: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(zweite.standard_modul, None);
        assert_eq!(zweite.basemap_modus.as_deref(), Some("online"));
        // Upsert überschreibt auch die Anzeige-Konventionen (Vollersatz).
        assert_eq!(zweite.zeitformat, None);
        assert_eq!(zweite.koordinatenformat, None);

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
            zeitzone: None,
            zeitformat: None,
            einheiten: None,
            koordinatenformat: None,
            geaendert_at: None,
            geaendert_von: None,
        };
        let a = e.anzeige();
        assert_eq!(a.fachebenen_sichtbar.as_ref().unwrap()["nina"], true);
        assert_eq!(a.fachebenen_sichtbar.as_ref().unwrap()["dwd"], false);
    }

    #[test]
    fn anzeige_konventionen_validatoren() {
        // Zeitformat
        assert!(ist_gueltiges_zeitformat("24h"));
        assert!(ist_gueltiges_zeitformat("12h"));
        assert!(!ist_gueltiges_zeitformat("48h"));
        assert!(!ist_gueltiges_zeitformat(""));

        // Einheiten
        assert!(ist_gueltiges_einheiten_system("metrisch"));
        assert!(ist_gueltiges_einheiten_system("imperial"));
        assert!(!ist_gueltiges_einheiten_system("nautisch"));

        // Koordinatenformat
        assert!(ist_gueltiges_koordinatenformat("wgs84"));
        assert!(ist_gueltiges_koordinatenformat("mgrs"));
        assert!(ist_gueltiges_koordinatenformat("utm"));
        assert!(!ist_gueltiges_koordinatenformat("gauss-krueger"));

        // Zeitzone: pragmatisch nur nicht-leer.
        assert!(ist_gueltige_zeitzone("Europe/Berlin"));
        assert!(ist_gueltige_zeitzone("UTC"));
        assert!(!ist_gueltige_zeitzone(""));
        assert!(!ist_gueltige_zeitzone("   "));
    }
}
