//! Interne Routen der Meldungsvorschläge (LLH-2112): offene Vorschläge listen, einen als Meldung
//! übernehmen oder verwerfen. Design-Doc
//! `docs/superpowers/specs/2026-11-28-jd4jgna4-maschinen-eingang-meldungen-design.md`,
//! „Interne Routen (Frontend)“.
//!
//! Die Übernahme geht denselben Weg wie das Erfassen (`routes::meldung::anlegen`): dieselben
//! Prüfungen ([`meldung::pruefe_neue_meldung`]), derselbe Schreibweg
//! (`meldung::repo::anlegen_mit_client_id_tx`, Auto-ETB nach den Einstellungen), dieselben
//! Folgen nach dem Commit. Meldung und Vorschlag werden in einer Transaktion geschrieben.
//!
//! Übernehmen und Verwerfen stehen nicht auf der Positivliste des Erfassens (ADR-0072): sie
//! verlangen Schreibrecht (`EinsatzSchreibzugriff`, prüft auch den aktiven Einsatz); die
//! Mitarbeit liest die Vorschläge nur.

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzKontext, EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Meldungen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::meldung::{repo, vorschlag, AutoFristHerkunft, MeldungAnzeige};
use crate::routes::meldung::{self, NeueMeldung};
use crate::zeit::jetzt;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

/// Ein offener Meldungsvorschlag eines Fremdsystems (`GET …/report-suggestions`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReportSuggestion {
    pub id: i64,
    pub text: String,
    pub source: ReportSuggestionSource,
    /// Sendezeitpunkt laut Fremdsystem (UTC), wenn es einen nannte.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<String>,
    /// Empfangszeitpunkt am Server (UTC).
    pub received_at: String,
}

/// Wer einen Vorschlag geschickt hat.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ReportSuggestionSource {
    pub adapter: String,
    pub sender_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_name: Option<String>,
    /// Das Fremdsystem meldet die Nachricht als signiert; der Server prüft das nicht.
    pub signed: bool,
}

impl ReportSuggestion {
    fn aus(v: vorschlag::Vorschlag) -> Self {
        ReportSuggestion {
            id: v.id,
            text: v.text.unwrap_or_default(),
            source: ReportSuggestionSource {
                adapter: v.herkunft.adapter,
                sender_id: v.herkunft.kennung,
                sender_name: v.herkunft.name,
                signed: v.herkunft.signiert,
            },
            sent_at: v.gesendet_at,
            received_at: v.empfangen_at,
        }
    }
}

/// Gekoppelte Geräte sehen nur eigene Meldungen und erreichen die Vorschläge nicht (403).
fn kein_geraet(ctx: &EinsatzKontext) -> Result<(), AppError> {
    if ctx.geraet.is_some() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

/// Am Spiegel führt eine andere Instanz den Einsatz (409). Ausdrücklich geprüft, denn das
/// Verwerfen schreibt nur in die ausgenommene `meldung_vorschlag` ohne Schutz-Trigger.
fn kein_spiegel(ctx: &EinsatzKontext) -> Result<(), AppError> {
    if ctx.einsatz.spiegel.spiegel_ist {
        return Err(AppError::Conflict(
            "Dieser Einsatz ist ein Spiegel; Vorschläge bearbeitet die führende Instanz.".into(),
        ));
    }
    Ok(())
}

/// GET /api/incidents/{id}/report-suggestions — offene, nicht abgelaufene Vorschläge, älteste
/// zuerst.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Meldungen>,
) -> Result<Json<Vec<ReportSuggestion>>, AppError> {
    kein_geraet(&ctx)?;
    let offene = vorschlag::offene(&state.pool, ctx.einsatz.id, &jetzt()).await?;
    Ok(Json(
        offene.into_iter().map(ReportSuggestion::aus).collect(),
    ))
}

/// POST /api/incidents/{id}/report-suggestions/{vid}/accept — den Vorschlag als Meldung
/// übernehmen. Körper wie beim Erfassen; `client_id` wirkt wie dort (eine Wiederholung liefert
/// die schon angelegte Meldung, auch wenn der Vorschlag inzwischen angenommen ist).
pub async fn accept(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((_, vorschlag_id)): PfadParam<(i64, i64)>,
    headers: HeaderMap,
    JsonBody(req): JsonBody<NeueMeldung>,
) -> Result<(StatusCode, Json<MeldungAnzeige>), AppError> {
    kein_geraet(&ctx)?;
    crate::routes::support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = meldung::client_id_aus(&req)?;
    if let Some(cid) = client_id {
        if let Some(m) = meldung::bestehende_meldung(&state, &ctx, cid).await? {
            return Ok((StatusCode::CREATED, Json(m)));
        }
    }
    kein_spiegel(&ctx)?;
    let geprueft = meldung::pruefe_neue_meldung(&state, &ctx, &req).await?;
    let daten = geprueft.daten();
    let einsatz_id = ctx.einsatz.id;
    let benutzer_id = ctx.benutzer.id;
    let meldung_id = crate::write_retry!(&state.pool, |conn| {
        let jetzt = jetzt();
        vorschlag::laden_offen_tx(&mut *conn, einsatz_id, vorschlag_id, &jetzt).await?;
        let meldung_id =
            repo::anlegen_mit_client_id_tx(&mut *conn, einsatz_id, benutzer_id, client_id, &daten)
                .await?;
        vorschlag::annehmen_tx(&mut *conn, vorschlag_id, meldung_id, benutzer_id, &jetzt).await?;
        Ok(meldung_id)
    });
    let meldung_id = match meldung_id {
        Ok(id) => id,
        // Ein paralleler Tab mit derselben `client_id` kann gewonnen haben: der Unique-Fehler
        // rollt alles zurück, die Antwort ist dann die Meldung des Gewinners (wie beim Erfassen).
        Err(e) => match client_id {
            Some(cid) => match meldung::bestehende_meldung(&state, &ctx, cid).await? {
                Some(m) => return Ok((StatusCode::CREATED, Json(m))),
                None => return Err(e),
            },
            None => return Err(e),
        },
    };
    let m = repo::laden(&state.pool, meldung_id, &jetzt()).await?;
    crate::meldung::live_publikation_sicherstellen(&state, &m).await?;
    crate::meldung::auto_frist_erinnerung_sicherstellen(&state, &m, AutoFristHerkunft::Meldung)
        .await?;
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Meldung);
    Ok((StatusCode::CREATED, Json(m)))
}

/// POST /api/incidents/{id}/report-suggestions/{vid}/discard — den Vorschlag verwerfen. Nur aus
/// `offen` (sonst 409); einen ETB- oder Audit-Eintrag gibt es nicht.
pub async fn discard(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((_, vorschlag_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    kein_geraet(&ctx)?;
    kein_spiegel(&ctx)?;
    let einsatz_id = ctx.einsatz.id;
    let benutzer_id = ctx.benutzer.id;
    crate::write_retry!(&state.pool, |conn| {
        vorschlag::verwerfen_tx(&mut *conn, einsatz_id, vorschlag_id, benutzer_id, &jetzt())
            .await?;
        Ok(())
    })?;
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Meldung);
    Ok(StatusCode::NO_CONTENT)
}
