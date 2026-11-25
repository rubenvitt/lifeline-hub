//! Fahrzeugortung in gespiegelten Einsätzen, Seite des Hubs (LLH-2119, Entwurf
//! `docs/superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md`, „Abgleich: neue
//! Felder im `SpiegelPaket`“): Der Hub beantwortet die Ortungsanfragen des ELW im Abgleich.
//!
//! - Eine Position geht nur hinaus, wenn die Org über diese Kopplung abgebildet ist, der Zugang
//!   zu ihr gehört, `positionen:write` trägt, nicht widerrufen und nicht abgelaufen ist und der
//!   Org-Schalter „Ortung im Einsatz“ an ist (ADR-0101, ADR-0103). Sonst entfällt der Eintrag
//!   stumm: das ELW erfährt nicht, warum.
//! - Die Kandidatenliste trägt keine Koordinaten.
//! - Die Antwort entsteht außerhalb der Schreibtransaktion des Abgleichs und ist fehlerfrei nach
//!   außen: ein Fehler zählt eine Sammelzeile ohne Kennung und liefert leere Listen.

use crate::error::AppError;
use crate::instanz::identitaet::Identitaet;
use crate::instanz::org_kennung;
use crate::instanz::repo::{self, KopplungZeile};
use crate::instanz::spiegel::paket::{
    RemoteTrackingCandidate, RemoteTrackingCandidates, RemoteTrackingPosition, SpiegelPaket,
    TRACKING_ANFRAGEN_MAX,
};
use crate::log_drossel::SammelzeileJe;
use crate::ortung::kopplung;
use crate::public_api::scope::Scope;
use sqlx::SqlitePool;

/// Beantwortet die Ortungsfelder der Anfrage: (Positionen, Kandidaten). Bei einem Fehler leere
/// Listen.
pub async fn answer_hub(
    pool: &SqlitePool,
    eigen: &Identitaet,
    kopplung: &KopplungZeile,
    anfrage: &SpiegelPaket,
) -> (Vec<RemoteTrackingPosition>, Vec<RemoteTrackingCandidates>) {
    if anfrage.tracking_requests.is_empty() && anfrage.tracking_candidates_wanted.is_empty() {
        return (Vec::new(), Vec::new());
    }
    match antworten(pool, eigen, kopplung, anfrage).await {
        Ok(a) => a,
        Err(_) => {
            // Je Kopplung gezählt; weder Kennung noch Zugang noch Koordinaten stehen im Log.
            static FEHLER: SammelzeileJe = SammelzeileJe::neu();
            if let Some(f) = FEHLER.zaehlen(&kopplung.id.to_string()) {
                tracing::warn!(
                    anzahl = f.anzahl,
                    seit_s = f.seit_s,
                    "Ortungsanfragen des Gegenübers nicht beantwortet, Sammelzeile"
                );
            }
            (Vec::new(), Vec::new())
        }
    }
}

async fn antworten(
    pool: &SqlitePool,
    eigen: &Identitaet,
    kopplung: &KopplungZeile,
    anfrage: &SpiegelPaket,
) -> Result<(Vec<RemoteTrackingPosition>, Vec<RemoteTrackingCandidates>), AppError> {
    let orgs = {
        let mut conn = pool.acquire().await?;
        repo::list_orgs_aktiv(&mut conn, kopplung.id).await?
    };
    // Org-Kennung der Abbildung (wie `org_wire` auf der erreichten Seite) → Org dieser Instanz.
    let org_von = |wire: &str| {
        orgs.iter()
            .find(|o| org_kennung(&eigen.kennung, o.org_id) == wire)
            .map(|o| o.org_id)
    };
    let jetzt = crate::zeit::jetzt();

    let mut positionen = Vec::new();
    for r in anfrage.tracking_requests.iter().take(TRACKING_ANFRAGEN_MAX) {
        let Some(org_id) = org_von(&r.org) else {
            continue;
        };
        if !crate::org::einstellungen::ortung_der_org(pool, org_id)
            .await?
            .im_einsatz
        {
            continue;
        }
        let zeile: Option<(f64, f64, String)> = sqlx::query_as(
            "SELECT p.lat, p.lon, p.gemessen_at \
             FROM position_letzte p JOIN einwurf_zugang z ON z.id = p.zugang_id \
             WHERE p.zugang_id = ? AND p.kennung = ? AND z.org_id = ? AND z.scope = ? \
               AND z.widerrufen_at IS NULL AND (z.gueltig_bis IS NULL OR z.gueltig_bis > ?)",
        )
        .bind(&r.access_id)
        .bind(&r.device_id)
        .bind(org_id)
        .bind(Scope::PositionenWrite.as_str())
        .bind(&jetzt)
        .fetch_optional(pool)
        .await?;
        if let Some((lat, lon, measured_at)) = zeile {
            positionen.push(RemoteTrackingPosition {
                org: r.org.clone(),
                access_id: r.access_id.clone(),
                device_id: r.device_id.clone(),
                lat,
                lon,
                measured_at,
            });
        }
    }

    let mut kandidaten: Vec<RemoteTrackingCandidates> = Vec::new();
    for wire in anfrage
        .tracking_candidates_wanted
        .iter()
        .take(orgs.len().max(1))
    {
        let Some(org_id) = org_von(wire) else {
            continue;
        };
        if kandidaten.iter().any(|k| &k.org == wire) {
            continue;
        }
        let enabled = crate::org::einstellungen::ortung_der_org(pool, org_id)
            .await?
            .im_einsatz;
        let items = if enabled {
            kopplung::list_kandidaten(pool, org_id, &jetzt)
                .await?
                .into_iter()
                .map(|k| RemoteTrackingCandidate {
                    access_id: k.zugang_id,
                    access_name: k.zugang_name,
                    device_id: k.kennung,
                    received_at: k.empfangen_at,
                })
                .collect()
        } else {
            Vec::new()
        };
        kandidaten.push(RemoteTrackingCandidates {
            org: wire.clone(),
            tracking_enabled: enabled,
            items,
        });
    }
    Ok((positionen, kandidaten))
}
