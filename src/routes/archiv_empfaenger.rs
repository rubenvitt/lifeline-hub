//! Archiv-Schlüssel der Organisation (LLH-1494, K6). Nur System-Admins der eigenen Org; jede
//! Änderung steht in der Admin-Spur.
//!
//! | Methode | Pfad | Zweck |
//! |---|---|---|
//! | GET    | `/api/org-archiv-schluessel` | Liste |
//! | POST   | `/api/org-archiv-schluessel` | Eintragen; liefert die Schlüsselprobe |
//! | POST   | `/api/org-archiv-schluessel/{id}/pruefen` | Code der Probe eingeben |
//! | DELETE | `/api/org-archiv-schluessel/{id}` | Entfernen |

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel, ZugangsAngaben};
use crate::auth::session::AdminUser;
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::org::archiv_empfaenger::{
    self as empfaenger, ArchivEmpfaengerAnzeige, NeuerArchivEmpfaenger,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

fn angaben(e: &ArchivEmpfaengerAnzeige) -> Option<ZugangsAngaben> {
    Some(ZugangsAngaben {
        fingerabdruck: Some(e.fingerabdruck.clone()),
        ..Default::default()
    })
}

/// GET /api/org-archiv-schluessel
pub async fn liste(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
) -> Result<Json<Vec<ArchivEmpfaengerAnzeige>>, AppError> {
    Ok(Json(empfaenger::liste(&state.pool, admin.org_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeuerSchluessel {
    /// Öffentlicher age-Schlüssel (`age1…`).
    pub schluessel: String,
    pub bezeichnung: String,
}

/// POST /api/org-archiv-schluessel — trägt einen Schlüssel ein (gilt erst nach der Probe).
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    JsonBody(body): JsonBody<NeuerSchluessel>,
) -> Result<(StatusCode, Json<NeuerArchivEmpfaenger>), AppError> {
    let neu = empfaenger::anlegen(
        &state.pool,
        admin.org_id,
        admin.id,
        &body.schluessel,
        &body.bezeichnung,
    )
    .await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::ArchivSchluesselEingetragen,
            akteur: &admin,
            ziel: Ziel::Archiv(&neu.empfaenger.bezeichnung),
            angaben: angaben(&neu.empfaenger),
            peer_ip,
        },
    )
    .await;
    Ok((StatusCode::CREATED, Json(neu)))
}

#[derive(Debug, Deserialize)]
pub struct Probe {
    pub code: String,
}

/// POST /api/org-archiv-schluessel/{id}/pruefen — Code der Probe; richtig: der Schlüssel gilt.
pub async fn pruefen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<Probe>,
) -> Result<Json<ArchivEmpfaengerAnzeige>, AppError> {
    let vorher = empfaenger::liste(&state.pool, admin.org_id)
        .await?
        .into_iter()
        .find(|e| e.id == id)
        .ok_or(AppError::NotFound)?;
    let geprueft = empfaenger::pruefen(&state.pool, admin.org_id, id, &body.code).await?;
    if vorher.geprueft_at.is_none() {
        admin_audit::schreibe(
            &state.pool,
            AdminEintrag {
                aktion: AdminAktion::ArchivSchluesselGeprueft,
                akteur: &admin,
                ziel: Ziel::Archiv(&geprueft.bezeichnung),
                angaben: angaben(&geprueft),
                peer_ip,
            },
        )
        .await;
    }
    Ok(Json(geprueft))
}

/// DELETE /api/org-archiv-schluessel/{id}
pub async fn entfernen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    let weg = empfaenger::entfernen(&state.pool, admin.org_id, id).await?;
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion: AdminAktion::ArchivSchluesselEntfernt,
            akteur: &admin,
            ziel: Ziel::Archiv(&weg.bezeichnung),
            angaben: angaben(&weg),
            peer_ip,
        },
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}
