//! Org-weite Einstellungen (admin-einstellungen) — 1:1 per Organisation.
//!
//! Spiegelt `einsatz::einstellungen` ohne einsatzspezifische Felder (kein
//! standard_modul, basemap_modus, karten_zoom_start, fachebenen_sichtbar, keine
//! Nummern-Startwerte — Startwerte bleiben rein pro Einsatz). Effektivwert =
//! Einsatz-Override ?? Org-Default ?? hartkodierter Fallback (Task 3). Validatoren
//! aus `einsatz::einstellungen` wiederverwenden, nicht duplizieren.

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Org-Einstellungen wie in der DB abgelegt (1:1 per Organisation). Alle Felder
/// optional — `None` = kein Org-Default (hartkodierter Fallback greift im Resolver).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OrgEinstellungen {
    pub org_id: i64,
    // Anzeige-Konventionen.
    pub zeitzone: Option<String>,
    pub zeitformat: Option<String>,
    pub einheiten: Option<String>,
    pub koordinatenformat: Option<String>,
    // Aufbewahrung.
    pub retention_dauer_tage: Option<i64>,
    // Nummernkreis-Präfixe (display-only; Startwerte bleiben Einsatz-only).
    pub etb_nummer_praefix: Option<String>,
    pub meldung_nummer_praefix: Option<String>,
    pub auftrag_nummer_praefix: Option<String>,
    // Default-Fristen.
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    // Auto-ETB-Schalter: 0 = aus; NULL/1 = an.
    pub auto_etb_eintraege: Option<i64>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

impl OrgEinstellungen {
    pub(crate) fn leer(org_id: i64) -> Self {
        Self {
            org_id,
            zeitzone: None,
            zeitformat: None,
            einheiten: None,
            koordinatenformat: None,
            retention_dauer_tage: None,
            etb_nummer_praefix: None,
            meldung_nummer_praefix: None,
            auftrag_nummer_praefix: None,
            meldung_bestaetigung_frist_min: None,
            auftrag_quittierung_frist_min: None,
            auto_etb_eintraege: None,
            geaendert_at: None,
            geaendert_von: None,
        }
    }

    /// API-Darstellung: flache 1:1-Spiegelung aller Felder inkl. Audit (Admin-Endpunkt).
    pub fn anzeige(&self) -> OrgEinstellungenAnzeige {
        OrgEinstellungenAnzeige {
            org_id: self.org_id,
            zeitzone: self.zeitzone.clone(),
            zeitformat: self.zeitformat.clone(),
            einheiten: self.einheiten.clone(),
            koordinatenformat: self.koordinatenformat.clone(),
            retention_dauer_tage: self.retention_dauer_tage,
            etb_nummer_praefix: self.etb_nummer_praefix.clone(),
            meldung_nummer_praefix: self.meldung_nummer_praefix.clone(),
            auftrag_nummer_praefix: self.auftrag_nummer_praefix.clone(),
            meldung_bestaetigung_frist_min: self.meldung_bestaetigung_frist_min,
            auftrag_quittierung_frist_min: self.auftrag_quittierung_frist_min,
            auto_etb_eintraege: self.auto_etb_eintraege,
            geaendert_at: self.geaendert_at.clone(),
            geaendert_von: self.geaendert_von,
        }
    }

    /// Schlanke API-Darstellung ohne Audit-Felder — für Einsatz-Endpoint (non-admin).
    /// Schützt `geaendert_at`/`geaendert_von` vor Leak an Einsatz-Mitglieder.
    pub fn anzeige_hinweis(&self) -> OrgEinstellungenHinweis {
        OrgEinstellungenHinweis {
            org_id: self.org_id,
            zeitzone: self.zeitzone.clone(),
            zeitformat: self.zeitformat.clone(),
            einheiten: self.einheiten.clone(),
            koordinatenformat: self.koordinatenformat.clone(),
            retention_dauer_tage: self.retention_dauer_tage,
            etb_nummer_praefix: self.etb_nummer_praefix.clone(),
            meldung_nummer_praefix: self.meldung_nummer_praefix.clone(),
            auftrag_nummer_praefix: self.auftrag_nummer_praefix.clone(),
            meldung_bestaetigung_frist_min: self.meldung_bestaetigung_frist_min,
            auftrag_quittierung_frist_min: self.auftrag_quittierung_frist_min,
            auto_etb_eintraege: self.auto_etb_eintraege,
        }
    }
}

/// API-Darstellung der Org-Einstellungen (flach, alle Felder serialisiert).
#[derive(Debug, Clone, Serialize)]
pub struct OrgEinstellungenAnzeige {
    pub org_id: i64,
    pub zeitzone: Option<String>,
    pub zeitformat: Option<String>,
    pub einheiten: Option<String>,
    pub koordinatenformat: Option<String>,
    pub retention_dauer_tage: Option<i64>,
    pub etb_nummer_praefix: Option<String>,
    pub meldung_nummer_praefix: Option<String>,
    pub auftrag_nummer_praefix: Option<String>,
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    pub auto_etb_eintraege: Option<i64>,
    pub geaendert_at: Option<String>,
    pub geaendert_von: Option<i64>,
}

/// Schlanke API-Darstellung für den Einsatz-Endpoint: nur Konventions-Felder,
/// KEIN `geaendert_at`, KEIN `geaendert_von` — Audit-Schutz für Non-Admin-Mitglieder.
#[derive(Debug, Clone, Serialize)]
pub struct OrgEinstellungenHinweis {
    pub org_id: i64,
    pub zeitzone: Option<String>,
    pub zeitformat: Option<String>,
    pub einheiten: Option<String>,
    pub koordinatenformat: Option<String>,
    pub retention_dauer_tage: Option<i64>,
    pub etb_nummer_praefix: Option<String>,
    pub meldung_nummer_praefix: Option<String>,
    pub auftrag_nummer_praefix: Option<String>,
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    pub auto_etb_eintraege: Option<i64>,
}

/// Eingabe für `speichern`; bereits vom Handler getrimmt/validiert.
/// Validatoren aus `einsatz::einstellungen` wiederverwenden (nicht duplizieren).
#[derive(Debug, Default)]
pub struct OrgEinstellungenDaten<'a> {
    pub zeitzone: Option<&'a str>,
    pub zeitformat: Option<&'a str>,
    pub einheiten: Option<&'a str>,
    pub koordinatenformat: Option<&'a str>,
    pub retention_dauer_tage: Option<i64>,
    pub etb_nummer_praefix: Option<&'a str>,
    pub meldung_nummer_praefix: Option<&'a str>,
    pub auftrag_nummer_praefix: Option<&'a str>,
    pub meldung_bestaetigung_frist_min: Option<i64>,
    pub auftrag_quittierung_frist_min: Option<i64>,
    pub auto_etb_eintraege: Option<i64>,
}

/// Lädt die Org-Einstellungen; existiert keine Zeile, werden Defaults
/// (alle `None`) zurückgegeben. Strikt per `org_id` (Org-Isolation).
pub async fn laden_oder_default(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<OrgEinstellungen, AppError> {
    let row = sqlx::query_as::<_, OrgEinstellungen>(
        "SELECT org_id, zeitzone, zeitformat, einheiten, koordinatenformat, \
                retention_dauer_tage, etb_nummer_praefix, meldung_nummer_praefix, \
                auftrag_nummer_praefix, meldung_bestaetigung_frist_min, \
                auftrag_quittierung_frist_min, auto_etb_eintraege, \
                geaendert_at, geaendert_von \
         FROM org_einstellungen WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or_else(|| OrgEinstellungen::leer(org_id)))
}

/// Speichert die Org-Einstellungen (UPSERT auf `org_id`); setzt die Audit-Felder.
/// Vollersatz-Semantik: alle Felder werden überschrieben (leer = None).
pub async fn speichern(
    pool: &SqlitePool,
    org_id: i64,
    erfasser_id: i64,
    daten: OrgEinstellungenDaten<'_>,
) -> Result<OrgEinstellungen, AppError> {
    sqlx::query(
        "INSERT INTO org_einstellungen \
            (org_id, zeitzone, zeitformat, einheiten, koordinatenformat, \
             retention_dauer_tage, etb_nummer_praefix, meldung_nummer_praefix, \
             auftrag_nummer_praefix, meldung_bestaetigung_frist_min, \
             auftrag_quittierung_frist_min, auto_etb_eintraege, \
             geaendert_at, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?) \
         ON CONFLICT(org_id) DO UPDATE SET \
             zeitzone = excluded.zeitzone, \
             zeitformat = excluded.zeitformat, \
             einheiten = excluded.einheiten, \
             koordinatenformat = excluded.koordinatenformat, \
             retention_dauer_tage = excluded.retention_dauer_tage, \
             etb_nummer_praefix = excluded.etb_nummer_praefix, \
             meldung_nummer_praefix = excluded.meldung_nummer_praefix, \
             auftrag_nummer_praefix = excluded.auftrag_nummer_praefix, \
             meldung_bestaetigung_frist_min = excluded.meldung_bestaetigung_frist_min, \
             auftrag_quittierung_frist_min = excluded.auftrag_quittierung_frist_min, \
             auto_etb_eintraege = excluded.auto_etb_eintraege, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(org_id)
    .bind(daten.zeitzone)
    .bind(daten.zeitformat)
    .bind(daten.einheiten)
    .bind(daten.koordinatenformat)
    .bind(daten.retention_dauer_tage)
    .bind(daten.etb_nummer_praefix)
    .bind(daten.meldung_nummer_praefix)
    .bind(daten.auftrag_nummer_praefix)
    .bind(daten.meldung_bestaetigung_frist_min)
    .bind(daten.auftrag_quittierung_frist_min)
    .bind(daten.auto_etb_eintraege)
    .bind(erfasser_id)
    .execute(pool)
    .await?;
    laden_oder_default(pool, org_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use sqlx::SqlitePool;

    /// Legt Org(1) + Benutzer an; liefert benutzer_id.
    /// Kein Einsatz nötig — `org_einstellungen` ist 1:1 per Org.
    async fn fixture(pool: &SqlitePool) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'admin', 'admin', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn laden_oder_default_ohne_zeile_ist_leer() {
        let pool = db::test_pool().await;
        let _bid = fixture(&pool).await;

        let e = laden_oder_default(&pool, 1).await.unwrap();
        assert_eq!(e.org_id, 1);
        assert_eq!(e.zeitzone, None);
        assert_eq!(e.zeitformat, None);
        assert_eq!(e.einheiten, None);
        assert_eq!(e.koordinatenformat, None);
        assert_eq!(e.retention_dauer_tage, None);
        assert_eq!(e.etb_nummer_praefix, None);
        assert_eq!(e.meldung_nummer_praefix, None);
        assert_eq!(e.auftrag_nummer_praefix, None);
        assert_eq!(e.meldung_bestaetigung_frist_min, None);
        assert_eq!(e.auftrag_quittierung_frist_min, None);
        assert_eq!(e.auto_etb_eintraege, None);
        assert_eq!(e.geaendert_at, None);
        assert_eq!(e.geaendert_von, None);
    }

    #[tokio::test]
    async fn speichern_upsert_und_laden() {
        let pool = db::test_pool().await;
        let bid = fixture(&pool).await;

        // Erster Speichervorgang: alle Felder setzen.
        let g = speichern(
            &pool,
            1,
            bid,
            OrgEinstellungenDaten {
                zeitzone: Some("Europe/Berlin"),
                zeitformat: Some("24h"),
                einheiten: Some("metrisch"),
                koordinatenformat: Some("mgrs"),
                retention_dauer_tage: Some(365),
                etb_nummer_praefix: Some("EB-"),
                meldung_nummer_praefix: Some("M-"),
                auftrag_nummer_praefix: Some("A-"),
                meldung_bestaetigung_frist_min: Some(30),
                auftrag_quittierung_frist_min: Some(45),
                auto_etb_eintraege: Some(0),
            },
        )
        .await
        .unwrap();

        assert_eq!(g.org_id, 1);
        assert_eq!(g.zeitzone.as_deref(), Some("Europe/Berlin"));
        assert_eq!(g.zeitformat.as_deref(), Some("24h"));
        assert_eq!(g.einheiten.as_deref(), Some("metrisch"));
        assert_eq!(g.koordinatenformat.as_deref(), Some("mgrs"));
        assert_eq!(g.retention_dauer_tage, Some(365));
        assert_eq!(g.etb_nummer_praefix.as_deref(), Some("EB-"));
        assert_eq!(g.meldung_nummer_praefix.as_deref(), Some("M-"));
        assert_eq!(g.auftrag_nummer_praefix.as_deref(), Some("A-"));
        assert_eq!(g.meldung_bestaetigung_frist_min, Some(30));
        assert_eq!(g.auftrag_quittierung_frist_min, Some(45));
        assert_eq!(g.auto_etb_eintraege, Some(0));
        assert!(g.geaendert_at.is_some());
        assert_eq!(g.geaendert_von, Some(bid));

        // Anzeige spiegelt alle Felder.
        let a = g.anzeige();
        assert_eq!(a.org_id, 1);
        assert_eq!(a.retention_dauer_tage, Some(365));
        assert_eq!(a.auto_etb_eintraege, Some(0));

        // Upsert: zweites Speichern überschreibt dieselbe Zeile (Vollersatz).
        let zweite = speichern(
            &pool,
            1,
            bid,
            OrgEinstellungenDaten {
                zeitzone: Some("UTC"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(zweite.zeitzone.as_deref(), Some("UTC"));
        assert_eq!(zweite.zeitformat, None);
        assert_eq!(zweite.retention_dauer_tage, None);
        assert_eq!(zweite.auto_etb_eintraege, None);

        // COUNT == 1 nach zwei Speichervorgängen (UPSERT, kein zweiter Insert).
        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM org_einstellungen WHERE org_id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 1);

        // geaendert_von ist gesetzt.
        assert_eq!(zweite.geaendert_von, Some(bid));
    }
}
