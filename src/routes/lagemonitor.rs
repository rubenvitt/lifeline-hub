//! Lagebild des Lagemonitors (LFH-892, Subtask LFH-1026; Spec `lagemonitor`, design.md D6).
//!
//! Verdichtete Zahlen statt der Listen des Lage-Dashboards: Kopfzahlen der Betroffenen, Belegung
//! je UHS als Zahl, Kräftesummen und der Datenstand. **Keine Namen, keine Personenkennungen** —
//! auch nicht in der Antwort; gepinnt von `lagemonitor_antwort_traegt_keine_personen` in
//! `tests/geraet_kopplung.rs`. Personen-Ereignisse erreichen den Monitor im Live-Kanal nicht
//! (`LiveEvent::Person` gehört nur `personen`); der Client holt die Zahlen deshalb zusätzlich in
//! festem Takt (`geraet/LagemonitorPage.tsx`).

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
use crate::geraet::Funktionsansicht;
use crate::staerke::{Staerke, StaerkePosition};
use crate::uhs::{UhsStatus, UhsTyp};
use axum::extract::State;
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

/// Betroffene in Zahlen, wie die Kopfzahl des Lage-Dashboards (`lageVerdichtung.ts`).
#[derive(Debug, Default, Serialize, ToSchema)]
pub struct LagemonitorBetroffene {
    pub gesamt: i64,
    /// SK I bis SK IV.
    pub patienten: i64,
    pub sk1: i64,
    pub sk2: i64,
    pub sk3: i64,
    pub sk4: i64,
    pub tot: i64,
    pub unverletzt: i64,
    /// Noch nicht gesichtet.
    pub ohne: i64,
    pub vermisst: i64,
}

/// Kräfte in Zahlen: Einheiten, disponiertes Personal und seine Stärke.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorKraefte {
    pub einheiten: i64,
    pub personal: i64,
    pub staerke: Staerke,
}

/// Eine nicht aufgelöste UHS mit ihrer Belegung als Zahl.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorUhs {
    pub id: i64,
    pub bezeichnung: String,
    pub typ: UhsTyp,
    pub status: UhsStatus,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// Personen, die gerade in dieser UHS liegen.
    pub belegt: i64,
    /// Plätze ohne Wartebereich.
    pub plaetze: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorAnzeige {
    /// Zeitpunkt der Berechnung (UTC, SQLite-Format).
    pub stand_at: String,
    pub betroffene: LagemonitorBetroffene,
    pub kraefte: LagemonitorKraefte,
    pub uhs: Vec<LagemonitorUhs>,
}

/// GET /api/einsaetze/{id}/lagemonitor — nur für einen gekoppelten Lagemonitor; eine Person und
/// jede andere Ansicht bekommen 403 (die Zahlen umgingen sonst das Modul `personen`).
pub async fn lagebild(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<LagemonitorAnzeige>, AppError> {
    if ctx.geraet.as_ref().map(|g| g.ansicht) != Some(Funktionsansicht::Lagemonitor) {
        return Err(AppError::Forbidden);
    }
    let einsatz_id = ctx.einsatz.id;
    let pool = &state.pool;

    let mut betroffene = LagemonitorBetroffene::default();
    let sichtungen: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT aktuelle_sichtung, COUNT(*) FROM einsatz_person \
         WHERE einsatz_id = ? AND storniert_at IS NULL GROUP BY aktuelle_sichtung",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    for (sk, n) in sichtungen {
        betroffene.gesamt += n;
        match sk.as_deref() {
            Some("sk1") => betroffene.sk1 += n,
            Some("sk2") => betroffene.sk2 += n,
            Some("sk3") => betroffene.sk3 += n,
            Some("sk4") => betroffene.sk4 += n,
            Some("tot") => betroffene.tot += n,
            Some("unverletzt") => betroffene.unverletzt += n,
            _ => betroffene.ohne += n,
        }
    }
    betroffene.patienten = betroffene.sk1 + betroffene.sk2 + betroffene.sk3 + betroffene.sk4;
    betroffene.vermisst = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_person \
         WHERE einsatz_id = ? AND storniert_at IS NULL AND status = 'vermisst'",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;

    let einheiten: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?;
    // Wie die Verdichtung der Kräfte-Seiten (`kraefte/kraeftebild.ts`, `verdichte`): jedes
    // disponierte Personal, auch ohne Einheit.
    let positionen: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT COALESCE(ep.staerke_position, p.staerke_position) \
         FROM einsatz_personal ep LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let personal = positionen.len() as i64;
    let staerke = Staerke::aus_positionen(
        positionen
            .into_iter()
            .flatten()
            .filter_map(|s| StaerkePosition::parse(&s)),
    );

    let zeilen: Vec<(
        i64,
        String,
        String,
        String,
        Option<f64>,
        Option<f64>,
        i64,
        i64,
    )> = sqlx::query_as(
        "SELECT u.id, u.bezeichnung, u.typ, u.status, u.lat, u.lon, \
               (SELECT COUNT(*) FROM einsatz_person p \
                 WHERE p.aktuelle_uhs_id = u.id AND p.storniert_at IS NULL), \
               (SELECT COUNT(*) FROM uhs_platz pl \
                 WHERE pl.uhs_id = u.id AND pl.storniert_at IS NULL \
                   AND pl.typ <> 'wartebereich') \
             FROM uhs u \
             WHERE u.einsatz_id = ? AND u.storniert_at IS NULL AND u.status <> 'aufgeloest' \
             ORDER BY u.bezeichnung COLLATE NOCASE, u.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut uhs = Vec::with_capacity(zeilen.len());
    for (id, bezeichnung, typ, status, lat, lon, belegt, plaetze) in zeilen {
        uhs.push(LagemonitorUhs {
            id,
            bezeichnung,
            typ: UhsTyp::parse(&typ).ok_or_else(|| AppError::Internal(format!("UHS-Typ {typ}")))?,
            status: UhsStatus::parse(&status)
                .ok_or_else(|| AppError::Internal(format!("UHS-Status {status}")))?,
            lat,
            lon,
            belegt,
            plaetze,
        });
    }

    Ok(Json(LagemonitorAnzeige {
        stand_at: crate::zeit::jetzt(),
        betroffene,
        kraefte: LagemonitorKraefte {
            einheiten,
            personal,
            staerke,
        },
        uhs,
    }))
}
