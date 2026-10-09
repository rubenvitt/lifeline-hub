//! Kräfte einer UHS (LFH-1045, Spec `uhs-staerke`, design.md D3–D6).
//!
//! Zuordnen, Ad-hoc erfassen, Lösen und eine ganze Einheit zuordnen. Die Stärke selbst rechnet
//! `uhs::repo` aus `einsatz_personal.uhs_id`; diese Routen ändern nur die Zuordnung. Jede
//! Änderung schreibt einen ETB-Systemeintrag in derselben Transaktion und stößt Live für UHS und
//! Personal an. Ein UHS-Laptop erreicht alles außer „Einheit zuordnen“, und nur an der eigenen
//! UHS (`geraet::stelle`).

use super::einsatz_personal::sse_personal;
use super::einsatz_uhs::sse_uhs;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Unfallhilfsstellen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle;
use crate::live::LiveEvent;
use crate::personal::disposition_repo::{self, AdhocDaten};
use crate::personal::{etb_bezeichnung, ADHOC_TEXT_MAX};
use crate::routes::support::{optional_max, parse_enum, pflicht_max};
use crate::staerke::StaerkePosition;
use crate::uhs::kraefte::{self, UhsKraft};
use crate::uhs::repo as uhs_repo;
use crate::uhs::{UhsAnzeige, UhsStatus};
use crate::zeitachse::repo as zeitachse_repo;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Eine UHS, an der sich die Zuordnung noch ändern darf: storniert oder aufgelöst → 409
/// (Lebenszyklus, `src/AGENTS.md` Statuscode-Konvention).
async fn offene_uhs(
    state: &AppState,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<UhsAnzeige, AppError> {
    let uhs = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;
    if uhs.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte UHS kann nicht geändert werden".into(),
        ));
    }
    if uhs.status == UhsStatus::Aufgeloest {
        return Err(AppError::Conflict(
            "Aufgelöste UHS kann nicht geändert werden".into(),
        ));
    }
    Ok(uhs)
}

/// GET /api/einsaetze/{id}/uhs/{uid}/kraefte/verfuegbar — Einsatzkräfte ohne UHS (Auswahl
/// beim Zuordnen). Nur Name, Funktion, Position und Einheit (design.md D4).
pub async fn verfuegbar(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Unfallhilfsstellen>,
    PfadParam((_eid, uhs_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<UhsKraft>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;
    Ok(Json(
        kraefte::liste(&state.pool, einsatz_id, None, ctx.einsatz.ist_aktiv()).await?,
    ))
}

/// PUT /api/einsaetze/{id}/uhs/{uid}/kraefte/{epid} — eine Einsatzkraft der UHS zuordnen.
/// Steht sie an einer anderen UHS, wechselt sie für die Leitung; ein Gerät holt sie nicht zu
/// sich (403). Schon an dieser UHS: unverändert, ohne ETB.
pub async fn zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_eid, uhs_id, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<Json<UhsKraft>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let uhs = offene_uhs(&state, einsatz_id, uhs_id).await?;
    let geraet = stelle::stelle(ctx.geraet.as_ref()).is_some();
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        let alt = kraefte::uhs_der_kraft_tx(conn, einsatz_id, ep_id).await?;
        if alt == Some(uhs_id) {
            return Ok(None);
        }
        if alt.is_some() && geraet {
            return Err(AppError::Forbidden);
        }
        kraefte::setze_uhs_tx(conn, einsatz_id, ep_id, Some(uhs_id)).await?;
        let kraft = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        let text = kraefte::etb_text_zugeordnet(
            &etb_bezeichnung(&kraft.name, kraft.funktion.as_deref()),
            &uhs.bezeichnung,
        );
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                .await?;
        Ok(Some((etb_id, alt)))
    })?;
    if let Some((etb_id, alt)) = ergebnis {
        state.live.publiziere(einsatz_id, etb_id);
        sse_uhs(&state, einsatz_id, uhs_id);
        if let Some(alt) = alt {
            sse_uhs(&state, einsatz_id, alt);
        }
        sse_personal(&state, einsatz_id, ep_id);
    }
    Ok(Json(
        kraefte::laden(&state.pool, einsatz_id, ep_id, true).await?,
    ))
}

/// Body einer Ad-hoc-Kraft, die an der UHS erfasst wird (Teilmenge des Ad-hoc-Dispos).
#[derive(Debug, Deserialize)]
pub struct AdhocKraftBody {
    pub name: String,
    pub funktion: Option<String>,
    pub staerke_position: Option<String>,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/kraefte — Ad-hoc-Kraft disponieren und der UHS zuordnen,
/// in einer Transaktion samt Zeitachse des Initialstatus und ETB.
pub async fn adhoc(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_eid, uhs_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AdhocKraftBody>,
) -> Result<(StatusCode, Json<UhsKraft>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let name = pflicht_max(&body.name, "Name", ADHOC_TEXT_MAX)?;
    let funktion = optional_max(body.funktion, "Funktion", ADHOC_TEXT_MAX)?;
    let position = body
        .staerke_position
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    if let Some(p) = position.as_deref() {
        parse_enum(StaerkePosition::parse, p, "Ungültige Stärke-Position")?;
    }
    let uhs = offene_uhs(&state, einsatz_id, uhs_id).await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let text = kraefte::etb_text_adhoc(
        &etb_bezeichnung(&name, funktion.as_deref()),
        &uhs.bezeichnung,
    );
    let (ep_id, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let ep_id = disposition_repo::disponiere_adhoc_tx(
            conn,
            einsatz_id,
            ctx.einsatz.org_id,
            AdhocDaten {
                name: &name,
                funktion: funktion.as_deref(),
                traegerorganisation: None,
                staerke_position: position.as_deref(),
            },
            ctx.benutzer.id,
        )
        .await?;
        // Wie `einsatz_personal::disponieren` (LFH-552): Zeitachse des Initialstatus.
        let status_id: Option<i64> =
            sqlx::query_scalar("SELECT status_id FROM einsatz_personal WHERE id = ?")
                .bind(ep_id)
                .fetch_one(&mut *conn)
                .await?;
        if let Some(sid) = status_id {
            zeitachse_repo::aus_personalstatus_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                ep_id,
                sid,
                &jetzt,
            )
            .await?;
        }
        kraefte::setze_uhs_tx(conn, einsatz_id, ep_id, Some(uhs_id)).await?;
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text)
                .await?;
        Ok((ep_id, etb_id))
    })?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_uhs(&state, einsatz_id, uhs_id);
    sse_personal(&state, einsatz_id, ep_id);
    Ok((
        StatusCode::CREATED,
        Json(kraefte::laden(&state.pool, einsatz_id, ep_id, true).await?),
    ))
}

/// DELETE /api/einsaetze/{id}/uhs/{uid}/kraefte/{epid} — Kraft von der UHS lösen; sie bleibt im
/// Einsatz. Steht sie nicht an dieser UHS: 404.
pub async fn loesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_eid, uhs_id, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    stelle::fordere_uhs(ctx.geraet.as_ref(), uhs_id)?;
    let uhs = offene_uhs(&state, einsatz_id, uhs_id).await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        if kraefte::uhs_der_kraft_tx(conn, einsatz_id, ep_id).await? != Some(uhs_id) {
            return Err(AppError::NotFound);
        }
        let kraft = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ep_id, true).await?;
        kraefte::setze_uhs_tx(conn, einsatz_id, ep_id, None).await?;
        let text = kraefte::etb_text_geloest(
            &etb_bezeichnung(&kraft.name, kraft.funktion.as_deref()),
            &uhs.bezeichnung,
        );
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await
    })?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_uhs(&state, einsatz_id, uhs_id);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /api/einsaetze/{id}/uhs/{uid}/kraefte/einheit/{eid} — alle Kräfte einer Einheit, die an
/// keiner UHS stehen, der UHS zuordnen (design.md F3). Nur für die Leitung: kein Gerätekatalog
/// nennt die Route. Ohne eine solche Kraft: 422.
pub async fn einheit_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Unfallhilfsstellen>,
    PfadParam((_eid, uhs_id, einheit_id)): PfadParam<(i64, i64, i64)>,
) -> Result<Json<Vec<UhsKraft>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if ctx.geraet.is_some() {
        return Err(AppError::Forbidden);
    }
    let uhs = offene_uhs(&state, einsatz_id, uhs_id).await?;
    let einheit: String =
        sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
            .bind(einheit_id)
            .bind(einsatz_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        let anzahl = kraefte::einheit_zuordnen_tx(conn, einsatz_id, einheit_id, uhs_id).await?;
        if anzahl == 0 {
            return Err(AppError::UnprocessableEntity(
                "Die Einheit hat keine Kraft ohne UHS".into(),
            ));
        }
        let text = kraefte::etb_text_einheit(&einheit, anzahl, &uhs.bezeichnung);
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await
    })?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_uhs(&state, einsatz_id, uhs_id);
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Personal);
    Ok(Json(
        kraefte::liste(&state.pool, einsatz_id, Some(uhs_id), true).await?,
    ))
}
