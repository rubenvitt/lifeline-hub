//! Einwurf-Zugänge verwalten (LLH-1654, Spec `einwurf-zugang`, design.md D11): Zugänge für
//! Absender ohne Signatur anlegen, den Schlüssel wechseln und widerrufen. Lesen darf, wer die
//! Verwaltung sieht; schreiben nur der System-Admin, immer für die eigene Org. Die Einwürfe
//! selbst nimmt `public_api::einwurf` an.
//!
//! Der Schlüssel verlässt den Server genau zweimal: in der Antwort auf das Anlegen und auf den
//! Wechsel. Er steht in keiner Liste, keiner Logzeile und keinem Eintrag der Admin-Spur.

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel, ZugangsAngaben};
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::public_api::einwurf::{self, EinwurfTransport, EinwurfZugang, Transport};
use crate::public_api::scope::Scope;
use crate::routes::anbindungen::{check_gueltig_bis, check_name, gesperrt_grund};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Ein Einwurf-Zugang, wie die Seite „Anbindungen“ ihn zeigt. Ohne Schlüssel.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinwurfZugangAnzeige {
    pub id: String,
    pub name: String,
    /// Der Zweck: `alarmmeldungen:write` oder `positionen:write`.
    pub scope: Scope,
    pub gueltig_bis: Option<String>,
    /// „gültig bis“ ist verstrichen; der Zugang verhält sich wie widerrufen.
    pub is_abgelaufen: bool,
    pub angelegt_at: String,
    pub schluessel_gewechselt_at: Option<String>,
    pub widerrufen_at: Option<String>,
    /// Anzeigename des Admins, der widerrufen hat.
    pub widerrufen_von_name: Option<String>,
    /// Letzter angenommener Einwurf, höchstens minütlich fortgeschrieben.
    pub zuletzt_genutzt_at: Option<String>,
}

impl EinwurfZugangAnzeige {
    fn aus(z: &EinwurfZugang, jetzt: &str) -> Self {
        EinwurfZugangAnzeige {
            id: z.id.clone(),
            name: z.name.clone(),
            scope: z.scope,
            gueltig_bis: z.gueltig_bis.clone(),
            is_abgelaufen: z.is_abgelaufen(jetzt),
            angelegt_at: z.angelegt_at.clone(),
            schluessel_gewechselt_at: z.schluessel_gewechselt_at.clone(),
            widerrufen_at: z.widerrufen_at.clone(),
            widerrufen_von_name: z.widerrufen_von_name.clone(),
            zuletzt_genutzt_at: z.zuletzt_genutzt_at.clone(),
        }
    }
}

/// Die Einwurf-Zugänge der Org, ob Einwürfe hier angenommen werden und über welchen Weg.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinwurfZugaengeListe {
    pub zugaenge: Vec<EinwurfZugangAnzeige>,
    /// Gesetzt, wenn diese Instanz sich für die Org bei einem Hub meldet: Anlegen und Wechsel
    /// sind dann gesperrt, und Einwürfe werden abgelehnt.
    pub gesperrt_grund: Option<String>,
    /// Wie Einwürfe diese Instanz erreichen. Bei `http` nimmt sie Einwürfe unverschlüsselt an,
    /// bei `keiner` lehnt sie jeden ab.
    pub transport: EinwurfTransport,
}

/// Ein frisch ausgestellter Schlüssel. Er verlässt den Server nur hier, einmal.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EinwurfZugangSchluessel {
    pub zugang: EinwurfZugangAnzeige,
    /// `llh_ew_` und 43 Zeichen. Die Adresse baut die Oberfläche daraus.
    pub schluessel: String,
}

/// Body des Anlegens.
#[derive(Debug, Deserialize)]
pub struct EinwurfZugangEingabe {
    pub name: String,
    pub scope: String,
    #[serde(default)]
    pub gueltig_bis: Option<String>,
}

/// Der Zweck eines Einwurf-Zugangs: einer der beiden schreibenden Scopes (400 sonst).
fn check_scope(roh: &str) -> Result<Scope, AppError> {
    Scope::parse(roh)
        .filter(|s| einwurf::ZWECKE.contains(s))
        .ok_or_else(|| AppError::Validation(format!("scope: unbekannter Wert „{roh}“")))
}

fn angaben(z: &EinwurfZugang) -> Option<ZugangsAngaben> {
    Some(ZugangsAngaben {
        zugang_id: Some(z.id.clone()),
        scopes: Some(vec![z.scope.as_str().to_string()]),
        ..Default::default()
    })
}

/// GET /api/admin/einwurf-zugaenge — alle Einwurf-Zugänge der eigenen Org, widerrufene
/// eingeschlossen.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    transport: Transport,
) -> Result<Json<EinwurfZugaengeListe>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let jetzt = crate::zeit::jetzt();
    let mut conn = state.pool.acquire().await?;
    let zugaenge = einwurf::liste(&mut conn, benutzer.org_id)
        .await?
        .iter()
        .map(|z| EinwurfZugangAnzeige::aus(z, &jetzt))
        .collect();
    Ok(Json(EinwurfZugaengeListe {
        zugaenge,
        gesperrt_grund: gesperrt_grund(&mut conn, benutzer.org_id).await?,
        transport: transport.lage(!crate::extract::vertraute_proxys().is_empty()),
    }))
}

/// POST /api/admin/einwurf-zugaenge — legt einen Zugang an und gibt seinen Schlüssel aus.
/// Admin-Spur `einwurf_zugang_angelegt`.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<EinwurfZugangEingabe>,
) -> Result<(StatusCode, Json<EinwurfZugangSchluessel>), AppError> {
    let jetzt = crate::zeit::jetzt();
    let name = check_name(&body.name)?;
    let scope = check_scope(&body.scope)?;
    let gueltig_bis = check_gueltig_bis(body.gueltig_bis.as_deref(), &jetzt)?;
    let (org_id, von) = (admin.org_id, admin.id);
    let (z, schluessel) = crate::write_retry!(&state.pool, |conn| {
        if let Some(grund) = gesperrt_grund(&mut *conn, org_id).await? {
            return Err(AppError::Conflict(grund));
        }
        let (id, schluessel) = einwurf::anlegen(
            &mut *conn,
            org_id,
            &name,
            scope,
            gueltig_bis.as_deref(),
            Some(von),
            &jetzt,
        )
        .await?;
        let z = einwurf::laden_in_org(&mut *conn, org_id, &id)
            .await?
            .ok_or_else(|| AppError::Internal("Einwurf-Zugang verschwunden".into()))?;
        Ok((z, schluessel))
    })?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::EinwurfZugangAngelegt,
            akteur: &admin,
            ziel: Ziel::EinwurfZugang(&z.name),
            angaben: angaben(&z),
            peer_ip,
        },
    )
    .await;
    Ok((
        StatusCode::CREATED,
        Json(EinwurfZugangSchluessel {
            zugang: EinwurfZugangAnzeige::aus(&z, &jetzt),
            schluessel,
        }),
    ))
}

/// POST /api/admin/einwurf-zugaenge/{id}/schluessel — gibt dem Zugang einen neuen Schlüssel.
/// Der alte gilt ab sofort nicht mehr. Ein widerrufener Zugang und der gekoppelte ELW: 409.
/// Admin-Spur `einwurf_zugang_schluessel_gewechselt`.
pub async fn schluessel_wechseln(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<EinwurfZugangSchluessel>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let org_id = admin.org_id;
    let (z, schluessel) = crate::write_retry!(&state.pool, |conn| {
        // Erst die Existenz, dann die Sperre: ein fremder Zugang bleibt 404, auch am ELW.
        if einwurf::laden_in_org(&mut *conn, org_id, &id)
            .await?
            .is_none()
        {
            return Err(AppError::NotFound);
        }
        if let Some(grund) = gesperrt_grund(&mut *conn, org_id).await? {
            return Err(AppError::Conflict(grund));
        }
        let schluessel = einwurf::schluessel_wechseln(&mut *conn, org_id, &id, &jetzt)
            .await?
            .ok_or(AppError::NotFound)?;
        let z = einwurf::laden_in_org(&mut *conn, org_id, &id)
            .await?
            .ok_or(AppError::NotFound)?;
        Ok((z, schluessel))
    })?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::EinwurfZugangSchluesselGewechselt,
            akteur: &admin,
            ziel: Ziel::EinwurfZugang(&z.name),
            angaben: angaben(&z),
            peer_ip,
        },
    )
    .await;
    Ok(Json(EinwurfZugangSchluessel {
        zugang: EinwurfZugangAnzeige::aus(&z, &jetzt),
        schluessel,
    }))
}

/// POST /api/admin/einwurf-zugaenge/{id}/widerrufen — wirkt sofort. Idempotent; die Admin-Spur
/// schreibt nur die Wirkung. Auch am gekoppelten ELW möglich.
pub async fn widerrufen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<EinwurfZugangAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let (org_id, von) = (admin.org_id, admin.id);
    // Der Stand für Antwort und Spur kommt aus derselben Transaktion wie der Widerruf.
    let (wirkung, z) = crate::write_retry!(&state.pool, |conn| {
        let wirkung = einwurf::widerrufen(&mut *conn, org_id, &id, Some(von), &jetzt)
            .await?
            .ok_or(AppError::NotFound)?;
        let z = einwurf::laden_in_org(&mut *conn, org_id, &id)
            .await?
            .ok_or(AppError::NotFound)?;
        Ok((wirkung, z))
    })?;
    if wirkung {
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::EinwurfZugangWiderrufen,
                akteur: &admin,
                ziel: Ziel::EinwurfZugang(&z.name),
                angaben: angaben(&z),
                peer_ip,
            },
        )
        .await;
    }
    Ok(Json(EinwurfZugangAnzeige::aus(&z, &jetzt)))
}
