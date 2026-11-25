//! Position senden (Spec Helfer-App, „Ablauf“ Schritt 5, „Ein Ortungsgerät je Ziel“,
//! „Senden, Takt, ohne Netz“): was eine Sendung der Helfer-App an `PUT /api/devices/me/position`
//! schreibt.
//!
//! - An das Ziel (Einheit oder Fahrzeug) nur als Ortungsgerät, an die Person nur mit
//!   Zuordnung und „Auch Personen orten“ der Organisation. Quelle `helfer`, der Zeitpunkt des
//!   Geräts geklemmt ([`ortung::klemme_zeitpunkt`]); ein älterer als der gespeicherte wird
//!   verworfen ([`ortung::schreibe_position`]).
//! - Pausiert schreibt eine Position nichts: sie kann eine verspätete Wiederholung von vor der
//!   Pause sein. Fortsetzen geht nur ausdrücklich (`paused: false`).
//! - Pausieren löscht die Personenposition; Einheit und Fahrzeug behalten den letzten Stand.

use crate::error::AppError;
use crate::ortung::{self, Ortungsziel, Positionsquelle};
use sqlx::SqliteConnection;

/// Warum eine Sendung abgewiesen wird; Wert von `reason` in der Antwort.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Abweisung {
    /// 409: die Leitung hat noch nicht bestätigt; nichts gespeichert, der Dienst läuft weiter.
    Unbestaetigt,
    /// 403: weder Ortungsgerät noch Person mit Personenortung.
    KeineRolle,
    /// 403: das Ziel ist aufgelöst oder weg.
    ZielEntfernt,
}

impl Abweisung {
    pub fn grund(self) -> &'static str {
        match self {
            Self::Unbestaetigt => "unconfirmed",
            Self::KeineRolle => "no_role",
            Self::ZielEntfernt => "target_removed",
        }
    }
}

/// Ergebnis einer Sendung, die nicht abgewiesen wurde.
#[derive(Debug, Default)]
pub struct Gesendet {
    /// Mindestens ein Ziel hat die Position übernommen.
    pub gespeichert: bool,
    /// Ziele, deren Position sich geändert hat (Live-Ereignis der Lagekarte nach dem Commit).
    pub geaendert: Vec<Ortungsziel>,
}

#[derive(sqlx::FromRow)]
struct Stand {
    helfer_zustand: Option<String>,
    ortungsgeraet: bool,
    einheit_id: Option<i64>,
    fahrzeug_id: Option<i64>,
    person_id: Option<i64>,
    pausiert: bool,
}

async fn stand(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<Stand, AppError> {
    sqlx::query_as(
        "SELECT helfer_zustand, ortungsgeraet <> 0 AS ortungsgeraet, einheit_id, fahrzeug_id, \
                person_id, pausiert_at IS NOT NULL AS pausiert \
         FROM geraet_kopplung WHERE id = ? AND ansicht = 'helfer'",
    )
    .bind(kopplung_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

async fn zugriff_vermerken(conn: &mut SqliteConnection, kopplung_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE geraet_kopplung SET letzter_zugriff_at = datetime('now') WHERE id = ?")
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Schreibt eine Position (ein Schritt der Transaktion). `personen` ist „Auch Personen orten“
/// der Organisation. Koordinate und Zeitpunkt prüft der Aufrufer vorher (422).
pub async fn senden(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kopplung_id: i64,
    personen: bool,
    lat: f64,
    lon: f64,
    zeitpunkt: &str,
) -> Result<Result<Gesendet, Abweisung>, AppError> {
    let s = stand(conn, kopplung_id).await?;
    if s.helfer_zustand.as_deref() != Some("aktiv") {
        return Ok(Err(Abweisung::Unbestaetigt));
    }
    // Ziele in Schreibreihenfolge; `None` = die Rolle besteht, das Ziel aber nicht mehr.
    let mut ziele: Vec<Option<Ortungsziel>> = Vec::new();
    if s.ortungsgeraet {
        ziele.push(match (s.einheit_id, s.fahrzeug_id) {
            (Some(id), _) => Some(Ortungsziel::Einheit(id)),
            (None, Some(id)) => Some(Ortungsziel::Fahrzeug(id)),
            (None, None) => None,
        });
    }
    if personen {
        if let Some(pid) = s.person_id {
            ziele.push(Some(Ortungsziel::Person(pid)));
        }
    }
    if ziele.is_empty() {
        return Ok(Err(Abweisung::KeineRolle));
    }
    zugriff_vermerken(conn, kopplung_id).await?;
    if s.pausiert {
        return Ok(Ok(Gesendet::default()));
    }
    let zeitpunkt = ortung::klemme_zeitpunkt(zeitpunkt, &crate::zeit::jetzt());
    let mut ergebnis = Gesendet::default();
    let mut erreichbar = false;
    for ziel in ziele.into_iter().flatten() {
        match ortung::schreibe_position(
            conn,
            einsatz_id,
            ziel,
            lat,
            lon,
            &zeitpunkt,
            Positionsquelle::Helfer,
        )
        .await
        {
            Ok(geschrieben) => {
                erreichbar = true;
                if geschrieben {
                    ergebnis.gespeichert = true;
                    ergebnis.geaendert.push(ziel);
                }
            }
            // Aufgelöst (409) oder weg (404): dieses Ziel zählt nicht mehr.
            Err(AppError::NotFound | AppError::Conflict(_)) => {}
            Err(e) => return Err(e),
        }
    }
    if !erreichbar {
        return Ok(Err(Abweisung::ZielEntfernt));
    }
    Ok(Ok(ergebnis))
}

/// Pausiert oder setzt fort (ein Schritt der Transaktion). Pausieren löscht die Position der
/// zugeordneten Person und liefert sie für das Live-Ereignis; ein zweites Pausieren behält den
/// ersten Zeitpunkt.
pub async fn pausieren(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    pausiert: bool,
) -> Result<Option<i64>, AppError> {
    let s = stand(conn, kopplung_id).await?;
    sqlx::query(
        "UPDATE geraet_kopplung \
         SET pausiert_at = CASE WHEN ? THEN COALESCE(pausiert_at, datetime('now')) END, \
             letzter_zugriff_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(pausiert)
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    match (pausiert, s.person_id) {
        (true, Some(pid)) => {
            ortung::loesche_position(conn, Ortungsziel::Person(pid)).await?;
            Ok(Some(pid))
        }
        _ => Ok(None),
    }
}

/// Löscht die Personenpositionen aller laufenden Helfer der Organisation (ein Schritt der
/// Transaktion), wenn „Auch Personen orten“ oder „Ortung im Einsatz“ ausgeht. Liefert
/// `(einsatz_id, person_id)` für die Live-Ereignisse nach dem Commit.
pub async fn personen_der_org_loeschen(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Vec<(i64, i64)>, AppError> {
    let personen: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT gk.einsatz_id, gk.person_id FROM geraet_kopplung gk \
         JOIN einsatz e ON e.id = gk.einsatz_id \
         WHERE e.org_id = ? AND gk.ansicht = 'helfer' AND gk.person_id IS NOT NULL \
           AND gk.widerrufen_at IS NULL AND gk.laeuft_ab_at > datetime('now') \
         ORDER BY gk.id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    for (_, pid) in &personen {
        ortung::loesche_position(conn, Ortungsziel::Person(*pid)).await?;
    }
    Ok(personen)
}
