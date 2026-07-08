//! Einsatz-Einstellungen (LFH-55 / LFH-131) — 1:1 pro Einsatz.
//!
//! Hybrid-Speichermodell (Decision Record LFH-55): skalare Spalten + eine
//! JSON-Spalte (`fachebenen_sichtbar`). Validierung erfolgt in Rust statt per
//! DB-CHECK (sqlx-sqlite 0.8.6 kann CHECK nicht per Rebuild ändern).

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

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
pub const KOORDINATENFORMATE: [&str; 5] = ["wgs84", "dms", "utm", "mgrs", "gk"];

/// Ob `s` ein gültiges Zeitformat ist.
pub fn ist_gueltiges_zeitformat(s: &str) -> bool {
    ZEITFORMATE.contains(&s)
}

/// Ob `s` ein gültiges Einheiten-System ist.
pub fn ist_gueltiges_einheiten_system(s: &str) -> bool {
    EINHEITEN_SYSTEME.contains(&s)
}

/// Basemap-Modus (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `basemap_modus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BasemapModus {
    Online,
    Offline,
    Blind,
}

/// Zeitformat (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `zeitformat`
/// (per-Variante, `rename_all` trifft die Ziffern-Kürzel nicht).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub enum Zeitformat {
    #[serde(rename = "24h")]
    VierundzwanzigStunden,
    #[serde(rename = "12h")]
    ZwoelfStunden,
}

/// Einheiten-System (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `einheiten_system`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EinheitenSystem {
    Metrisch,
    Imperial,
}

/// Koordinatenformat (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `koordinatenformat`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Koordinatenformat {
    Wgs84,
    Dms,
    Utm,
    Mgrs,
    Gk,
}

/// Ob `s` ein gültiges Koordinatenformat ist.
pub fn ist_gueltiges_koordinatenformat(s: &str) -> bool {
    KOORDINATENFORMATE.contains(&s)
}

/// Geocoder-Basis-URL: nur http/https, nicht leer. Bewusst leichtgewichtig (kein
/// vollständiges URL-Parsing) — fehlkonfigurierte URLs werden zur Laufzeit wie offline
/// behandelt (`ortsname: null`), nie ein Crash.
pub fn ist_gueltige_geocoder_url(s: &str) -> bool {
    (s.starts_with("http://") || s.starts_with("https://")) && s.len() > 10
}

// Verhalten & Automatik (LFH-133) — Validatoren in Rust statt DB-CHECK.

/// Maximale Präfix-Länge (Nummernkreise). Display-only, nie pro Zeile gespeichert.
pub const NUMMER_PRAEFIX_MAX_LEN: usize = 8;

/// Ob `s` ein gültiges Nummernkreis-Präfix ist: getrimmt höchstens
/// [`NUMMER_PRAEFIX_MAX_LEN`] Zeichen, Whitelist `[A-Za-z0-9-_/ ]`. Ein leerer
/// (getrimmter) Wert ist gültig und bedeutet „kein Präfix" (Handler → None).
pub fn ist_gueltiges_nummer_praefix(s: &str) -> bool {
    let t = s.trim();
    t.chars().count() <= NUMMER_PRAEFIX_MAX_LEN
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '/' | ' '))
}

/// Ob `n` ein gültiger Startwert einer laufenden Nummer ist (1..=999_999).
pub fn ist_gueltiger_startwert(n: i64) -> bool {
    (1..=999_999).contains(&n)
}

/// Ob `n` eine gültige Default-Frist in Minuten ist (1..=10_080 = eine Woche).
pub fn ist_gueltige_frist_min(n: i64) -> bool {
    (1..=10_080).contains(&n)
}

/// Ob `n` eine gültige Aufbewahrungs-Dauer in Tagen ist (1..=3650 = zehn Jahre).
/// 0/negativ ist unzulässig (kein Instant-Purge); `None` (keine Politik) wird vom
/// Aufrufer separat behandelt (= keine Auto-Frist). LFH-135.
pub fn ist_gueltige_retention_dauer(tage: i64) -> bool {
    (1..=3650).contains(&tage)
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
    // Verhalten & Automatik (LFH-133); None = projektweiter Default.
    pub etb_nummer_praefix: Option<String>,
    pub etb_nummer_start: Option<i64>,
    pub meldung_nummer_praefix: Option<String>,
    pub meldung_nummer_start: Option<i64>,
    pub auftrag_nummer_praefix: Option<String>,
    pub auftrag_nummer_start: Option<i64>,
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    /// 0 = Auto-ETB-Dual-Publish aus; NULL/1 = an (heutiges Verhalten).
    pub auto_etb_eintraege: Option<i64>,
    /// Aufbewahrungs-Dauer-Politik in Tagen (LFH-135). NULL = keine Auto-Frist.
    /// Der Zeitpunkt (`einsatz.retention_bis`) wird daraus erst beim Abschluss berechnet.
    pub retention_dauer_tage: Option<i64>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

impl EinsatzEinstellungen {
    pub(crate) fn leer(einsatz_id: i64) -> Self {
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
            etb_nummer_praefix: None,
            etb_nummer_start: None,
            meldung_nummer_praefix: None,
            meldung_nummer_start: None,
            auftrag_nummer_praefix: None,
            auftrag_nummer_start: None,
            meldung_bestaetigung_frist_min: None,
            auftrag_quittierung_frist_min: None,
            auto_etb_eintraege: None,
            retention_dauer_tage: None,
            geaendert_at: None,
            geaendert_von: None,
        }
    }

    /// Startwert der ETB-Nummerierung (Default 1, wenn nicht konfiguriert).
    pub fn etb_startwert(&self) -> i64 {
        self.etb_nummer_start.unwrap_or(1)
    }
    /// Startwert der Meldungs-Nummerierung (Default 1).
    pub fn meldung_startwert(&self) -> i64 {
        self.meldung_nummer_start.unwrap_or(1)
    }
    /// Startwert der Auftrags-Nummerierung (Default 1).
    pub fn auftrag_startwert(&self) -> i64 {
        self.auftrag_nummer_start.unwrap_or(1)
    }
    /// Ob Auto-ETB-Folgeeinträge (Pattern B) erzeugt werden. Default an;
    /// nur ein explizites `Some(0)` schaltet das Dual-Publish ab.
    pub fn auto_etb_aktiv(&self) -> bool {
        self.auto_etb_eintraege != Some(0)
    }

    /// API-Darstellung: `fachebenen_sichtbar` als geparstes Objekt (symmetrisch zur
    /// PUT-Eingabe). Ungültiges/leeres JSON → `None`. Freeze-Flags alle `false`
    /// (für Aufrufer ohne Daten-Existenz-Kontext); sonst [`anzeige_mit_freeze`].
    pub fn anzeige(&self) -> EinstellungenAnzeige {
        self.anzeige_mit_freeze(false, false, false)
    }

    /// Wie [`anzeige`], aber mit den Freeze-Flags je Nummernkreis (LFH-133).
    /// Der Aufrufer ermittelt sie aus der Daten-Existenz ([`etb_nummer_vergeben`] etc.).
    pub fn anzeige_mit_freeze(
        &self,
        etb_eingefroren: bool,
        meldung_eingefroren: bool,
        auftrag_eingefroren: bool,
    ) -> EinstellungenAnzeige {
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
            etb_nummer_praefix: self.etb_nummer_praefix.clone(),
            etb_nummer_start: self.etb_nummer_start,
            meldung_nummer_praefix: self.meldung_nummer_praefix.clone(),
            meldung_nummer_start: self.meldung_nummer_start,
            auftrag_nummer_praefix: self.auftrag_nummer_praefix.clone(),
            auftrag_nummer_start: self.auftrag_nummer_start,
            meldung_bestaetigung_frist_min: self.meldung_bestaetigung_frist_min,
            auftrag_quittierung_frist_min: self.auftrag_quittierung_frist_min,
            auto_etb_eintraege: self.auto_etb_eintraege,
            retention_dauer_tage: self.retention_dauer_tage,
            etb_nummer_eingefroren: etb_eingefroren,
            meldung_nummer_eingefroren: meldung_eingefroren,
            auftrag_nummer_eingefroren: auftrag_eingefroren,
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
    // Verhalten & Automatik (LFH-133).
    pub etb_nummer_praefix: Option<String>,
    pub etb_nummer_start: Option<i64>,
    pub meldung_nummer_praefix: Option<String>,
    pub meldung_nummer_start: Option<i64>,
    pub auftrag_nummer_praefix: Option<String>,
    pub auftrag_nummer_start: Option<i64>,
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    pub auto_etb_eintraege: Option<i64>,
    /// Aufbewahrungs-Dauer-Politik in Tagen (LFH-135); `None` = keine Auto-Frist.
    pub retention_dauer_tage: Option<i64>,
    /// Freeze pro Nummernkreis (LFH-133): true, sobald die erste Nummer vergeben ist
    /// (Präfix + Startwert dann read-only). Aus Daten-Existenz abgeleitet, nicht gespeichert.
    pub etb_nummer_eingefroren: bool,
    pub meldung_nummer_eingefroren: bool,
    pub auftrag_nummer_eingefroren: bool,
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
                etb_nummer_praefix, etb_nummer_start, meldung_nummer_praefix, meldung_nummer_start, \
                auftrag_nummer_praefix, auftrag_nummer_start, meldung_bestaetigung_frist_min, \
                auftrag_quittierung_frist_min, auto_etb_eintraege, retention_dauer_tage, \
                geaendert_at, geaendert_von \
         FROM einsatz_einstellungen WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_else(|| EinsatzEinstellungen::leer(einsatz_id)))
}

/// Eingabe für `speichern`; bereits vom Handler getrimmt/validiert.
#[derive(Debug, Default)]
pub struct EinstellungenDaten<'a> {
    pub standard_modul: Option<&'a str>,
    pub basemap_modus: Option<&'a str>,
    pub karten_zoom_start: Option<f64>,
    pub fachebenen_sichtbar: Option<&'a str>,
    pub zeitzone: Option<&'a str>,
    pub zeitformat: Option<&'a str>,
    pub einheiten: Option<&'a str>,
    pub koordinatenformat: Option<&'a str>,
    // Verhalten & Automatik (LFH-133).
    pub etb_nummer_praefix: Option<&'a str>,
    pub etb_nummer_start: Option<i64>,
    pub meldung_nummer_praefix: Option<&'a str>,
    pub meldung_nummer_start: Option<i64>,
    pub auftrag_nummer_praefix: Option<&'a str>,
    pub auftrag_nummer_start: Option<i64>,
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    pub auto_etb_eintraege: Option<i64>,
    pub retention_dauer_tage: Option<i64>,
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
             etb_nummer_praefix, etb_nummer_start, meldung_nummer_praefix, meldung_nummer_start, \
             auftrag_nummer_praefix, auftrag_nummer_start, meldung_bestaetigung_frist_min, \
             auftrag_quittierung_frist_min, auto_etb_eintraege, retention_dauer_tage, \
             geaendert_at, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?) \
         ON CONFLICT(einsatz_id) DO UPDATE SET \
             standard_modul = excluded.standard_modul, \
             basemap_modus = excluded.basemap_modus, \
             karten_zoom_start = excluded.karten_zoom_start, \
             fachebenen_sichtbar = excluded.fachebenen_sichtbar, \
             zeitzone = excluded.zeitzone, \
             zeitformat = excluded.zeitformat, \
             einheiten = excluded.einheiten, \
             koordinatenformat = excluded.koordinatenformat, \
             etb_nummer_praefix = excluded.etb_nummer_praefix, \
             etb_nummer_start = excluded.etb_nummer_start, \
             meldung_nummer_praefix = excluded.meldung_nummer_praefix, \
             meldung_nummer_start = excluded.meldung_nummer_start, \
             auftrag_nummer_praefix = excluded.auftrag_nummer_praefix, \
             auftrag_nummer_start = excluded.auftrag_nummer_start, \
             meldung_bestaetigung_frist_min = excluded.meldung_bestaetigung_frist_min, \
             auftrag_quittierung_frist_min = excluded.auftrag_quittierung_frist_min, \
             auto_etb_eintraege = excluded.auto_etb_eintraege, \
             retention_dauer_tage = excluded.retention_dauer_tage, \
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
    .bind(daten.etb_nummer_praefix)
    .bind(daten.etb_nummer_start)
    .bind(daten.meldung_nummer_praefix)
    .bind(daten.meldung_nummer_start)
    .bind(daten.auftrag_nummer_praefix)
    .bind(daten.auftrag_nummer_start)
    .bind(daten.meldung_bestaetigung_frist_min)
    .bind(daten.auftrag_quittierung_frist_min)
    .bind(daten.auto_etb_eintraege)
    .bind(daten.retention_dauer_tage)
    .bind(erfasser_id)
    .execute(pool)
    .await?;
    laden_oder_default(pool, einsatz_id).await
}

/// Ob der ETB-Nummernkreis dieses Einsatzes bereits eine Nummer vergeben hat
/// (Freeze-Trigger, LFH-133). Strikt per `einsatz_id` — ein fremder Einsatz mit
/// Einträgen friert diesen Kreis NICHT ein (Org-Isolation).
pub async fn etb_nummer_vergeben(pool: &SqlitePool, einsatz_id: i64) -> Result<bool, AppError> {
    nummer_vergeben(pool, "etb_eintrag", einsatz_id).await
}

/// Ob der Meldungs-Nummernkreis dieses Einsatzes bereits eine Nummer vergeben hat.
pub async fn meldung_nummer_vergeben(pool: &SqlitePool, einsatz_id: i64) -> Result<bool, AppError> {
    nummer_vergeben(pool, "meldung", einsatz_id).await
}

/// Ob der Auftrags-Nummernkreis dieses Einsatzes bereits eine Nummer vergeben hat.
pub async fn auftrag_nummer_vergeben(pool: &SqlitePool, einsatz_id: i64) -> Result<bool, AppError> {
    nummer_vergeben(pool, "auftrag", einsatz_id).await
}

/// EXISTS-Check pro Nummernkreis. `tabelle` ist eine feste, interne Konstante
/// (kein User-Input) — kein Injection-Risiko.
///
/// `AND lfd_nr IS NOT NULL` ist entscheidend: `auftrag.lfd_nr` ist nullable
/// (Migration 0067 ohne Backfill), Vor-0067-Aufträge tragen NULL und konsumieren
/// noch keine Nummer (`COALESCE(MAX(lfd_nr)+1, startwert)`). Ohne den Filter
/// würde der Freeze schon bei bloßer Zeilen-Existenz feuern und Präfix/Startwert
/// dauerhaft fälschlich sperren (409). Für ETB/Meldung (`lfd_nr NOT NULL`) ist
/// der Filter ein No-op.
async fn nummer_vergeben(
    pool: &SqlitePool,
    tabelle: &str,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT 1 FROM {tabelle} WHERE einsatz_id = ? AND lfd_nr IS NOT NULL LIMIT 1"
    )))
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(treffer.is_some())
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
                ..Default::default()
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
                ..Default::default()
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
            fachebenen_sichtbar: Some(r#"{"nina":true,"dwd":false,"pegelonline":false,"kritis":false}"#.into()),
            ..EinsatzEinstellungen::leer(1)
        };
        let a = e.anzeige();
        assert_eq!(a.fachebenen_sichtbar.as_ref().unwrap()["nina"], true);
        assert_eq!(a.fachebenen_sichtbar.as_ref().unwrap()["dwd"], false);
    }

    #[test]
    fn koordinatenformat_dms_und_gk_sind_gueltig() {
        assert!(ist_gueltiges_koordinatenformat("dms"));
        assert!(ist_gueltiges_koordinatenformat("gk"));
        assert!(ist_gueltiges_koordinatenformat("wgs84"));
        assert!(!ist_gueltiges_koordinatenformat("xyz"));
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

    #[test]
    fn verhalten_validatoren() {
        // Präfix: Whitelist + Länge ≤ 8 (getrimmt).
        assert!(ist_gueltiges_nummer_praefix("EB-"));
        assert!(ist_gueltiges_nummer_praefix("M_2026/"));
        assert!(ist_gueltiges_nummer_praefix("A B-1")); // interner Space erlaubt
        assert!(ist_gueltiges_nummer_praefix("")); // leer = kein Präfix
        assert!(ist_gueltiges_nummer_praefix("  EB-  ")); // getrimmt 3 Zeichen
        assert!(!ist_gueltiges_nummer_praefix("123456789")); // 9 Zeichen
        assert!(!ist_gueltiges_nummer_praefix("EB#")); // '#' nicht in Whitelist
        assert!(!ist_gueltiges_nummer_praefix("EB!")); // '!' nicht in Whitelist

        // Startwert: 1..=999_999.
        assert!(ist_gueltiger_startwert(1));
        assert!(ist_gueltiger_startwert(100));
        assert!(ist_gueltiger_startwert(999_999));
        assert!(!ist_gueltiger_startwert(0));
        assert!(!ist_gueltiger_startwert(-5));
        assert!(!ist_gueltiger_startwert(1_000_000));

        // Frist (Minuten): 1..=10_080.
        assert!(ist_gueltige_frist_min(1));
        assert!(ist_gueltige_frist_min(30));
        assert!(ist_gueltige_frist_min(10_080));
        assert!(!ist_gueltige_frist_min(0));
        assert!(!ist_gueltige_frist_min(10_081));
    }

    #[test]
    fn retention_dauer_validator_grenzen() {
        // Gültig: 1..=3650 Tage.
        assert!(ist_gueltige_retention_dauer(1));
        assert!(ist_gueltige_retention_dauer(30));
        assert!(ist_gueltige_retention_dauer(3650));
        // 0/negativ → kein Instant-Purge.
        assert!(!ist_gueltige_retention_dauer(0));
        assert!(!ist_gueltige_retention_dauer(-1));
        // Zu groß.
        assert!(!ist_gueltige_retention_dauer(3651));
    }

    #[tokio::test]
    async fn speichern_round_trip_retention_dauer() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = fixture(&pool).await;
        // Default: keine Politik.
        let leer = laden_oder_default(&pool, eid).await.unwrap();
        assert_eq!(leer.retention_dauer_tage, None);

        let g = speichern(
            &pool,
            eid,
            bid,
            EinstellungenDaten {
                retention_dauer_tage: Some(365),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.retention_dauer_tage, Some(365));
        assert_eq!(g.anzeige().retention_dauer_tage, Some(365));

        // Vollersatz-Upsert ohne Dauer hebt die Politik wieder auf.
        let aufgehoben = speichern(&pool, eid, bid, EinstellungenDaten::default())
            .await
            .unwrap();
        assert_eq!(aufgehoben.retention_dauer_tage, None);
    }

    #[test]
    fn leer_ist_alle_none_und_startwert_default_eins() {
        let e = EinsatzEinstellungen::leer(7);
        assert_eq!(e.etb_nummer_praefix, None);
        assert_eq!(e.etb_nummer_start, None);
        assert_eq!(e.meldung_nummer_start, None);
        assert_eq!(e.auftrag_nummer_start, None);
        assert_eq!(e.meldung_bestaetigung_frist_min, None);
        assert_eq!(e.auftrag_quittierung_frist_min, None);
        assert_eq!(e.auto_etb_eintraege, None);
        // Startwert-Auflösung: Default 1, wenn nicht gesetzt.
        assert_eq!(e.etb_startwert(), 1);
        assert_eq!(e.meldung_startwert(), 1);
        assert_eq!(e.auftrag_startwert(), 1);
        // Auto-ETB: Default an.
        assert!(e.auto_etb_aktiv());
    }

    async fn etb_eintrag_anlegen(pool: &SqlitePool, eid: i64, bid: i64) {
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'x', ?, '2026-06-19 09:00:00')",
        )
        .bind(eid).bind(bid).execute(pool).await.unwrap();
    }
    async fn meldung_anlegen(pool: &SqlitePool, eid: i64, bid: i64) {
        sqlx::query(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, ereigniszeit, eingang_at, erfasst_von_id) \
             VALUES (?, 1, 'A', 'funk', 'x', '2026-06-19 09:00:00', '2026-06-19 09:00:00', ?)",
        )
        .bind(eid).bind(bid).execute(pool).await.unwrap();
    }
    async fn auftrag_anlegen(pool: &SqlitePool, eid: i64, bid: i64) {
        sqlx::query(
            "INSERT INTO auftrag (einsatz_id, lfd_nr, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, 1, 'x', '2026-06-19 09:00:00', ?)",
        )
        .bind(eid).bind(bid).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn freeze_nur_bei_daten_existenz_pro_nummernkreis() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = fixture(&pool).await;
        // Frisch: nichts eingefroren.
        assert!(!etb_nummer_vergeben(&pool, eid).await.unwrap());
        assert!(!meldung_nummer_vergeben(&pool, eid).await.unwrap());
        assert!(!auftrag_nummer_vergeben(&pool, eid).await.unwrap());

        // Erster ETB-Eintrag friert NUR den ETB-Kreis ein.
        etb_eintrag_anlegen(&pool, eid, bid).await;
        assert!(etb_nummer_vergeben(&pool, eid).await.unwrap());
        assert!(!meldung_nummer_vergeben(&pool, eid).await.unwrap(), "ETB-Freeze ist unabhängig von Meldung");
        assert!(!auftrag_nummer_vergeben(&pool, eid).await.unwrap());

        // Erste Meldung friert NUR den Meldungs-Kreis ein (zusätzlich).
        meldung_anlegen(&pool, eid, bid).await;
        assert!(meldung_nummer_vergeben(&pool, eid).await.unwrap());
        assert!(!auftrag_nummer_vergeben(&pool, eid).await.unwrap());

        // Erster Auftrag friert den Auftrags-Kreis ein.
        auftrag_anlegen(&pool, eid, bid).await;
        assert!(auftrag_nummer_vergeben(&pool, eid).await.unwrap());
    }

    #[tokio::test]
    async fn auftrag_freeze_ignoriert_null_lfd_nr() {
        // Regression (Review LFH-133): Vor-0067-Aufträge tragen lfd_nr = NULL und
        // konsumieren noch keine Nummer. Der Freeze darf erst feuern, wenn eine
        // echte Nummer vergeben wurde — sonst dauerhafter Falsch-409-Lockout.
        let pool = crate::db::test_pool().await;
        let (eid, bid) = fixture(&pool).await;
        sqlx::query(
            "INSERT INTO auftrag (einsatz_id, lfd_nr, auftrag_text, erteilt_at, erstellt_von_id) \
             VALUES (?, NULL, 'legacy', '2026-06-19 09:00:00', ?)",
        )
        .bind(eid).bind(bid).execute(&pool).await.unwrap();
        assert!(
            !auftrag_nummer_vergeben(&pool, eid).await.unwrap(),
            "Auftrag mit lfd_nr=NULL darf den Nummernkreis nicht einfrieren"
        );
        // Erst eine echte Nummer friert ein.
        auftrag_anlegen(&pool, eid, bid).await;
        assert!(auftrag_nummer_vergeben(&pool, eid).await.unwrap());
    }

    #[test]
    fn geocoder_url_nur_http_s() {
        assert!(super::ist_gueltige_geocoder_url("https://nominatim.example.org"));
        assert!(super::ist_gueltige_geocoder_url("http://10.0.0.5:8080"));
        assert!(!super::ist_gueltige_geocoder_url("ftp://x"));
        assert!(!super::ist_gueltige_geocoder_url("kein-schema"));
        assert!(!super::ist_gueltige_geocoder_url(""));
    }

    #[tokio::test]
    async fn freeze_ist_org_isoliert() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = fixture(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) \
             VALUES (1, 'Fremd', '2026-002') RETURNING id",
        )
        .fetch_one(&pool).await.unwrap();
        // Einträge im FREMDEN Einsatz dürfen den Freeze dieses Einsatzes nicht auslösen.
        etb_eintrag_anlegen(&pool, fremd, bid).await;
        auftrag_anlegen(&pool, fremd, bid).await;
        assert!(!etb_nummer_vergeben(&pool, eid).await.unwrap());
        assert!(!auftrag_nummer_vergeben(&pool, eid).await.unwrap());
        // Der fremde Einsatz selbst ist eingefroren.
        assert!(etb_nummer_vergeben(&pool, fremd).await.unwrap());
    }

    #[tokio::test]
    async fn anzeige_mit_freeze_setzt_flags() {
        let e = EinsatzEinstellungen::leer(1);
        let a = e.anzeige_mit_freeze(true, false, true);
        assert!(a.etb_nummer_eingefroren);
        assert!(!a.meldung_nummer_eingefroren);
        assert!(a.auftrag_nummer_eingefroren);
    }

    #[tokio::test]
    async fn speichern_round_trip_verhalten_felder() {
        let pool = crate::db::test_pool().await;
        let (eid, bid) = fixture(&pool).await;
        let g = speichern(
            &pool,
            eid,
            bid,
            EinstellungenDaten {
                etb_nummer_praefix: Some("EB-"),
                etb_nummer_start: Some(100),
                meldung_nummer_praefix: Some("M-"),
                meldung_nummer_start: Some(5),
                auftrag_nummer_praefix: Some("A-"),
                auftrag_nummer_start: Some(10),
                meldung_bestaetigung_frist_min: Some(30),
                auftrag_quittierung_frist_min: Some(45),
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.etb_nummer_praefix.as_deref(), Some("EB-"));
        assert_eq!(g.etb_nummer_start, Some(100));
        assert_eq!(g.meldung_nummer_praefix.as_deref(), Some("M-"));
        assert_eq!(g.meldung_nummer_start, Some(5));
        assert_eq!(g.auftrag_nummer_praefix.as_deref(), Some("A-"));
        assert_eq!(g.auftrag_nummer_start, Some(10));
        assert_eq!(g.meldung_bestaetigung_frist_min, Some(30));
        assert_eq!(g.auftrag_quittierung_frist_min, Some(45));
        assert_eq!(g.auto_etb_eintraege, Some(0));
        assert_eq!(g.etb_startwert(), 100);
        assert_eq!(g.auftrag_startwert(), 10);
        assert!(!g.auto_etb_aktiv(), "Some(0) → Auto-ETB aus");

        // Anzeige spiegelt die Felder (Freeze-Flags hier defaultmäßig false).
        let a = g.anzeige();
        assert_eq!(a.etb_nummer_start, Some(100));
        assert_eq!(a.auto_etb_eintraege, Some(0));
        assert!(!a.etb_nummer_eingefroren);
    }
}
