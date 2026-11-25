//! Ende der Ortung einer Helfer-Kopplung (Spec
//! `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Personenposition“): endet
//! die Kopplung, löscht der Server die Position an der zugeordneten Person (`lat`/`lon` auf NULL,
//! Quelle bleibt als Hinweis). Einheit und Fahrzeug behalten den letzten Lagestand.
//!
//! - [`beende_ortung`] ruft die gemeinsame Endstelle `geraet::repo::beenden` für jede beendete
//!   Kopplung: Widerruf durch die Leitung, Abmelden in der App, Ablehnung, Auflösen der Einheit
//!   oder des Abschnitts, Wiederöffnen und Spiegel-Ende.
//! - [`beende_ortung_im_einsatz`] ruft der Einsatzabschluss; er beendet Kopplungen nur über den
//!   Status.
//! - [`raeume_abgelaufene`] löscht die Personenposition abgelaufener Kopplungen; der Ablauf-Takt
//!   (`geraet::ablauf`) und die Schreibwege der Leitung rufen es, denn ein Ablauf schreibt sonst
//!   nichts.
//! - An einem Spiegel schreibt keiner dieser Wege: seine Zeilen gehören der führenden Instanz.
//! - Das Live-Ereignis meldet der Aufrufer nach dem Commit (`routes::helfer::melde_helfer_ende`).

use crate::einsatz::spiegel_filter::nicht_gespiegelt;
use crate::error::AppError;
use crate::ortung::{self, Ortungsziel};
use sqlx::SqliteConnection;

/// Bedingung „keine andere offene Helfer-Kopplung hält dieselbe Person“ (Alias `gk`).
const KEINE_ANDERE_OFFENE: &str = "NOT EXISTS (SELECT 1 FROM geraet_kopplung o \
     WHERE o.ansicht = 'helfer' AND o.person_id = gk.person_id AND o.id <> gk.id \
       AND o.widerrufen_at IS NULL AND o.laeuft_ab_at > datetime('now'))";

/// Löscht die Position der Person einer (eben beendeten) Helfer-Kopplung. Liefert die Person,
/// wenn gelöscht wurde; eine andere Ansicht, eine Kopplung ohne Person, ein Spiegel oder eine
/// Person, die eine andere offene Helfer-Kopplung noch ortet, ergeben `None`.
pub async fn beende_ortung(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Option<i64>, AppError> {
    let person: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT gk.person_id FROM geraet_kopplung gk \
         WHERE gk.id = ? AND gk.ansicht = 'helfer' AND gk.person_id IS NOT NULL \
           AND {} AND {KEINE_ANDERE_OFFENE}",
        nicht_gespiegelt("gk.einsatz_id")
    )))
    .bind(kopplung_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(pid) = person {
        ortung::loesche_position(conn, Ortungsziel::Person(pid)).await?;
    }
    Ok(person)
}

/// Löscht beim Abschluss die Positionen aller Personen, die eine nicht widerrufene
/// Helfer-Kopplung des Einsatzes ortet. Liefert die Personen.
pub async fn beende_ortung_im_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<i64>, AppError> {
    let personen: Vec<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT DISTINCT gk.person_id FROM geraet_kopplung gk \
         WHERE gk.einsatz_id = ? AND gk.ansicht = 'helfer' AND gk.person_id IS NOT NULL \
           AND gk.widerrufen_at IS NULL AND {}",
        nicht_gespiegelt("gk.einsatz_id")
    )))
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for pid in &personen {
        ortung::loesche_position(conn, Ortungsziel::Person(*pid)).await?;
    }
    Ok(personen)
}

/// Eine abgelaufene Helfer-Kopplung, deren Personenposition [`raeume_abgelaufene`] gelöscht hat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::FromRow)]
pub struct Geraeumt {
    pub einsatz_id: i64,
    pub kopplung_id: i64,
    pub person_id: i64,
}

/// Löscht die Personenposition abgelaufener, nicht widerrufener Helfer-Kopplungen aktiver
/// Einsätze (`einsatz_id`: nur dieser Einsatz). Gelöscht wird nur eine Position der Quelle
/// `helfer` und nur, wenn keine andere offene Helfer-Kopplung die Person ortet; ein zweiter Lauf
/// findet deshalb nichts mehr.
pub async fn raeume_abgelaufene(
    conn: &mut SqliteConnection,
    einsatz_id: Option<i64>,
) -> Result<Vec<Geraeumt>, AppError> {
    let geraeumt: Vec<Geraeumt> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT gk.einsatz_id, gk.id AS kopplung_id, gk.person_id \
         FROM geraet_kopplung gk \
         JOIN einsatz e ON e.id = gk.einsatz_id \
         JOIN einsatz_personal ep ON ep.id = gk.person_id \
         WHERE gk.ansicht = 'helfer' AND gk.widerrufen_at IS NULL \
           AND gk.laeuft_ab_at <= datetime('now') \
           AND (?1 IS NULL OR gk.einsatz_id = ?1) \
           AND e.status = 'aktiv' AND e.geloescht_at IS NULL \
           AND ep.lat IS NOT NULL AND ep.position_quelle = 'helfer' \
           AND {} AND {KEINE_ANDERE_OFFENE} \
         ORDER BY gk.einsatz_id, gk.id",
        nicht_gespiegelt("gk.einsatz_id")
    )))
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for g in &geraeumt {
        ortung::loesche_position(conn, Ortungsziel::Person(g.person_id)).await?;
    }
    Ok(geraeumt)
}
