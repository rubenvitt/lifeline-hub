//! Aufträge der Helfer-App (Stufe 2, Spec
//! `docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md`, ADR-0106): welche
//! Empfängerzeilen einer Helfer-Kopplung gehören, und die eigene Auftragsliste.
//!
//! Eigene Zeile: `einheit` an die Ziel-Einheit, `fahrzeug` an das Ziel-Fahrzeug, `person` an die
//! von der Leitung zugeordnete Person. Abschnitt, Funktion und extern gehören nie einem Helfer.

use crate::error::AppError;
use crate::kommunikation::Prioritaet;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Ein Pager-Empfänger (Alias `gk` für `geraet_kopplung`, `e` für `einsatz`): bestätigte,
/// nicht widerrufene, nicht abgelaufene Helfer-Kopplung eines aktiven, nicht gelöschten Einsatzes.
/// Pausiert oder ruhend zählt mit.
pub const PAGER_EMPFAENGER: &str = "gk.ansicht = 'helfer' AND gk.helfer_zustand = 'aktiv' \
     AND gk.widerrufen_at IS NULL AND gk.laeuft_ab_at > datetime('now') \
     AND e.status = 'aktiv' AND e.geloescht_at IS NULL";

/// Die Empfängerzeile `ae` gehört der Helfer-Kopplung `gk` (Aliase `ae`, `gk`).
pub const EIGENE_ZEILE: &str =
    "((ae.empfaenger_typ = 'einheit' AND ae.einheit_id = gk.einheit_id) \
     OR (ae.empfaenger_typ = 'fahrzeug' AND ae.fahrzeug_id = gk.fahrzeug_id) \
     OR (ae.empfaenger_typ = 'person' AND gk.person_id IS NOT NULL \
         AND ae.person_id = gk.person_id))";

/// Wie lange ein aufgehobener Auftrag noch in der Liste steht.
pub const AUFGEHOBEN_SICHTBAR_MIN: i64 = 30;

/// Eine eigene Empfängerzeile eines Auftrags.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelperTaskRecipient {
    pub id: i64,
    /// `unit`, `vehicle` oder `person`.
    pub kind: String,
    /// Empfänger, wie beim Erteilen angezeigt.
    pub label: String,
    pub acknowledged_at: Option<String>,
    /// Wer quittiert hat: Anzeigename der Helfer-Kopplung, sonst Name des Kontos.
    pub acknowledged_by: Option<String>,
}

/// Ein Auftrag in der Helfer-App.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelperTask {
    pub id: i64,
    pub number: Option<i64>,
    pub text: String,
    pub location: Option<String>,
    pub location_lat: Option<f64>,
    pub location_lon: Option<f64>,
    pub priority: Prioritaet,
    pub deadline_at: Option<String>,
    pub issued_at: String,
    pub cancelled_at: Option<String>,
    pub recipients: Vec<HelperTaskRecipient>,
}

/// Antwort von `GET /api/devices/me/tasks`.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelperTaskList {
    pub tasks: Vec<HelperTask>,
}

#[derive(sqlx::FromRow)]
struct Zeile {
    auftrag_id: i64,
    lfd_nr: Option<i64>,
    auftrag_text: String,
    ort: Option<String>,
    ort_lat: Option<f64>,
    ort_lon: Option<f64>,
    prioritaet: String,
    frist_at: Option<String>,
    erteilt_at: String,
    aufgehoben_at: Option<String>,
    empfaenger_id: i64,
    empfaenger_typ: String,
    snap_anzeige: String,
    quittiert_at: Option<String>,
    quittiert_von: Option<String>,
}

fn art(typ: &str) -> String {
    match typ {
        "einheit" => "unit",
        "fahrzeug" => "vehicle",
        _ => "person",
    }
    .to_string()
}

async fn eigene_zeilen(
    pool: &SqlitePool,
    kopplung_id: i64,
    auftrag_id: Option<i64>,
) -> Result<Vec<Zeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT a.id AS auftrag_id, a.lfd_nr, a.auftrag_text, a.ort, a.ort_lat, a.ort_lon, \
                a.prioritaet, a.frist_at, a.erteilt_at, a.aufgehoben_at, \
                ae.id AS empfaenger_id, ae.empfaenger_typ, ae.snap_anzeige, ae.quittiert_at, \
                COALESCE((SELECT q.anzeigename FROM geraet_kopplung q \
                          WHERE q.benutzer_id = ae.quittiert_von_id AND q.ansicht = 'helfer'), \
                         (SELECT b.anzeigename FROM benutzer b \
                          WHERE b.id = ae.quittiert_von_id)) AS quittiert_von \
         FROM geraet_kopplung gk \
         JOIN auftrag a ON a.einsatz_id = gk.einsatz_id \
         JOIN auftrag_empfaenger ae ON ae.auftrag_id = a.id \
         WHERE gk.id = ?1 AND {EIGENE_ZEILE} \
           AND (?2 IS NULL OR a.id = ?2) \
           AND (a.aufgehoben_at IS NULL \
                OR a.aufgehoben_at > datetime('now', '-{AUFGEHOBEN_SICHTBAR_MIN} minutes')) \
         ORDER BY a.erteilt_at DESC, a.id DESC, ae.id"
    )))
    .bind(kopplung_id)
    .bind(auftrag_id)
    .fetch_all(pool)
    .await?)
}

fn gruppieren(zeilen: Vec<Zeile>) -> Vec<HelperTask> {
    let mut auftraege: Vec<HelperTask> = Vec::new();
    for z in zeilen {
        let empfaenger = HelperTaskRecipient {
            id: z.empfaenger_id,
            kind: art(&z.empfaenger_typ),
            label: z.snap_anzeige,
            acknowledged_by: z.quittiert_at.as_ref().and(z.quittiert_von),
            acknowledged_at: z.quittiert_at,
        };
        match auftraege.last_mut() {
            Some(a) if a.id == z.auftrag_id => a.recipients.push(empfaenger),
            _ => auftraege.push(HelperTask {
                id: z.auftrag_id,
                number: z.lfd_nr,
                text: z.auftrag_text,
                location: z.ort,
                location_lat: z.ort_lat,
                location_lon: z.ort_lon,
                priority: Prioritaet::parse(&z.prioritaet).unwrap_or(Prioritaet::Normal),
                deadline_at: z.frist_at,
                issued_at: z.erteilt_at,
                cancelled_at: z.aufgehoben_at,
                recipients: vec![empfaenger],
            }),
        }
    }
    auftraege
}

/// Ob die Helfer-Kopplung bestätigt ist (`helfer_zustand = 'aktiv'`).
pub async fn is_confirmed(pool: &SqlitePool, kopplung_id: i64) -> Result<bool, AppError> {
    let zustand: Option<String> =
        sqlx::query_scalar("SELECT helfer_zustand FROM geraet_kopplung WHERE id = ?")
            .bind(kopplung_id)
            .fetch_optional(pool)
            .await?
            .flatten();
    Ok(zustand.as_deref() == Some("aktiv"))
}

/// Die Aufträge mit mindestens einer eigenen Empfängerzeile, neueste zuerst; aufgehobene nur
/// [`AUFGEHOBEN_SICHTBAR_MIN`] Minuten lang.
pub async fn list_own(pool: &SqlitePool, kopplung_id: i64) -> Result<Vec<HelperTask>, AppError> {
    Ok(gruppieren(eigene_zeilen(pool, kopplung_id, None).await?))
}

/// Ein Auftrag mit seinen eigenen Zeilen; `None`, wenn keine Zeile der Kopplung gehört.
pub async fn load_own(
    pool: &SqlitePool,
    kopplung_id: i64,
    auftrag_id: i64,
) -> Result<Option<HelperTask>, AppError> {
    Ok(
        gruppieren(eigene_zeilen(pool, kopplung_id, Some(auftrag_id)).await?)
            .into_iter()
            .next(),
    )
}

/// Ob `empfaenger_id` eine eigene Zeile des Auftrags `auftrag_id` ist (auch aufgehoben).
pub async fn is_own_row(
    pool: &SqlitePool,
    kopplung_id: i64,
    auftrag_id: i64,
    empfaenger_id: i64,
) -> Result<bool, AppError> {
    let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM geraet_kopplung gk \
         JOIN auftrag a ON a.einsatz_id = gk.einsatz_id \
         JOIN auftrag_empfaenger ae ON ae.auftrag_id = a.id \
         WHERE gk.id = ? AND a.id = ? AND ae.id = ? AND {EIGENE_ZEILE}"
    )))
    .bind(kopplung_id)
    .bind(auftrag_id)
    .bind(empfaenger_id)
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}
