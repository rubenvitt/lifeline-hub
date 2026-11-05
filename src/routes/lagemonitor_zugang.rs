//! Lesezugänge für externe Anzeigen (LLH-1484): Verwaltung durch den System-Admin und Freigabe
//! am Einsatz durch die Einsatzleitung. Herleitung: `/mnt/project-files/llh-1484/design.md`
//! (D1, D3). Den Abruf selbst trägt `routes::lagemonitor_v1`.

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel};
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLeitungszugriff, EinsatzLesezugriff};
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::lagemonitor_zugang::{
    self as zugang, FreigabeWirkung, LesezugangAnzeige, LesezugangFreigabe, Widerruf,
    BEZEICHNUNG_MAX,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// GET /api/lagemonitor-zugaenge — alle Zugänge der eigenen Organisation. Lesen darf, wer die
/// Verwaltung sieht; anlegen und widerrufen nur der System-Admin.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<LesezugangAnzeige>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(zugang::liste(&state.pool, benutzer.org_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeuerLesezugang {
    pub bezeichnung: String,
}

/// Ein frisch angelegter Zugang. Der Schlüssel verlässt den Server nur hier, einmal.
#[derive(Debug, Serialize, ToSchema)]
pub struct LesezugangMitSchluessel {
    pub zugang: LesezugangAnzeige,
    pub schluessel: String,
}

/// POST /api/lagemonitor-zugaenge — legt einen Zugang an. Admin-Spur `lesezugang_angelegt`.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<NeuerLesezugang>,
) -> Result<(StatusCode, Json<LesezugangMitSchluessel>), AppError> {
    let bezeichnung =
        crate::routes::support::pflicht_max(&body.bezeichnung, "bezeichnung", BEZEICHNUNG_MAX)?;
    let schluessel = zugang::neuer_schluessel();
    let id = zugang::anlegen(
        &state.pool,
        admin.org_id,
        &bezeichnung,
        &zugang::hash(&schluessel),
        admin.id,
    )
    .await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::LesezugangAngelegt,
            akteur: &admin,
            ziel: Ziel::Lesezugang(&bezeichnung),
            angaben: None,
            peer_ip,
        },
    )
    .await;
    let zugang = zugang::laden(&state.pool, admin.org_id, id).await?;
    Ok((
        StatusCode::CREATED,
        Json(LesezugangMitSchluessel { zugang, schluessel }),
    ))
}

/// POST /api/lagemonitor-zugaenge/{zid}/widerrufen — der Schlüssel gilt sofort nicht mehr, die
/// Freigabe endet. Zeigte der Zugang einen Einsatz, steht das in dessen ETB. Idempotent; die
/// Admin-Spur schreibt nur die Wirkung.
pub async fn widerrufen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(zugang_id): PfadParam<i64>,
) -> Result<Json<LesezugangAnzeige>, AppError> {
    let vorher = zugang::laden(&state.pool, admin.org_id, zugang_id).await?; // 404 falls fremd
    let text = format!(
        "Lagemonitor-Zugang „{}“ widerrufen von {}; der Einsatz wird dort nicht mehr gezeigt.",
        vorher.bezeichnung, admin.anzeigename
    );
    let von = admin.id;
    let org_id = admin.org_id;
    // Der Einsatz für den ETB-Eintrag kommt aus der Transaktion selbst (`Widerruf`), nicht aus
    // `vorher`: eine gleichzeitige Umstellung könnte ihn inzwischen geändert haben.
    let (wirkung, etb_id) = crate::write_retry!(&state.pool, |conn| {
        match zugang::widerrufen(conn, org_id, zugang_id, von).await? {
            Widerruf::Keine => Ok((false, None)),
            Widerruf::Widerrufen { einsatz_id: None } => Ok((true, None)),
            Widerruf::Widerrufen {
                einsatz_id: Some(einsatz_id),
            } => {
                let startwert = etb_startwert(&mut *conn, einsatz_id).await?;
                let etb_id =
                    crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await?;
                Ok((true, Some((einsatz_id, etb_id))))
            }
        }
    })?;
    if let Some((einsatz_id, etb_id)) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    if wirkung {
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::LesezugangWiderrufen,
                akteur: &admin,
                ziel: Ziel::Lesezugang(&vorher.bezeichnung),
                angaben: None,
                peer_ip,
            },
        )
        .await;
    }
    Ok(Json(
        zugang::laden(&state.pool, admin.org_id, zugang_id).await?,
    ))
}

/// GET /api/einsaetze/{id}/lagemonitor-zugaenge — die Zugänge der Organisation aus Sicht dieses
/// Einsatzes. Nur die Einsatzleitung, wie die Geräte.
pub async fn einsatz_liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<Vec<LesezugangFreigabe>>, AppError> {
    ctx.fordere_einsatzleitung()?;
    Ok(Json(
        zugang::freigaben_fuer_einsatz(&state.pool, ctx.einsatz.org_id, ctx.einsatz.id).await?,
    ))
}

/// PUT /api/einsaetze/{id}/lagemonitor-zugaenge/{zid}/freigabe — der Zugang zeigt ab jetzt diesen
/// Einsatz. Zeigte er einen anderen, endet dessen Freigabe; beide ETBs nennen das. Idempotent.
pub async fn freigeben(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, zugang_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<LesezugangFreigabe>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let von = ctx.benutzer.id;
    let name = ctx.benutzer.anzeigename.clone();
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_ids = crate::write_retry!(&state.pool, |conn| {
        let bezeichnung = zugang::gueltige_bezeichnung(conn, org_id, zugang_id).await?;
        let mut etb_ids = Vec::new();
        match zugang::freigeben_tx(conn, zugang_id, einsatz_id, von).await? {
            FreigabeWirkung::Keine => {}
            wirkung => {
                let text = format!(
                    "Einsatz für den Lagemonitor-Zugang „{bezeichnung}“ freigegeben von {name}."
                );
                etb_ids.push((
                    einsatz_id,
                    crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await?,
                ));
                if let FreigabeWirkung::Abgeloest { vorher } = wirkung {
                    let startwert_vorher = etb_startwert(&mut *conn, vorher).await?;
                    let text = format!(
                        "Lagemonitor-Zugang „{bezeichnung}“ zeigt jetzt einen anderen Einsatz \
                         (umgestellt von {name})."
                    );
                    etb_ids.push((
                        vorher,
                        crate::etb::system_audit_tx(conn, vorher, von, startwert_vorher, &text)
                            .await?,
                    ));
                }
            }
        }
        Ok(etb_ids)
    })?;
    for (einsatz_id, etb_id) in etb_ids {
        state.live.publiziere(einsatz_id, etb_id);
    }
    Ok(Json(
        zugang::freigaben_fuer_einsatz(&state.pool, org_id, einsatz_id).await?,
    ))
}

/// DELETE /api/einsaetze/{id}/lagemonitor-zugaenge/{zid}/freigabe — der Zugang zeigt diesen
/// Einsatz nicht mehr. Idempotent; das ETB nennt nur die Wirkung.
pub async fn freigabe_beenden(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff,
    PfadParam((_eid, zugang_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<LesezugangFreigabe>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let von = ctx.benutzer.id;
    let name = ctx.benutzer.anzeigename.clone();
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = crate::write_retry!(&state.pool, |conn| {
        let bezeichnung = zugang::gueltige_bezeichnung(conn, org_id, zugang_id).await?;
        if zugang::freigabe_beenden_tx(conn, zugang_id, einsatz_id).await? {
            let text =
                format!("Freigabe für den Lagemonitor-Zugang „{bezeichnung}“ beendet von {name}.");
            Ok(Some(
                crate::etb::system_audit_tx(conn, einsatz_id, von, startwert, &text).await?,
            ))
        } else {
            Ok(None)
        }
    })?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    Ok(Json(
        zugang::freigaben_fuer_einsatz(&state.pool, org_id, einsatz_id).await?,
    ))
}
