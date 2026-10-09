//! Sitzungsliste und Beenden ohne Deaktivieren (LFH-1092).
//!
//! Eine Person sieht und beendet ihre eigenen Sitzungen (`/api/auth/sitzungen…`), ein Admin die
//! einer Person seiner Organisation (`/api/benutzer/{id}/sitzungen…`). Beenden löscht nur
//! Sitzungszeilen: Konto, Passwort und Zweitfaktor bleiben, Sitzungen gekoppelter Geräte auch
//! (die haben ihren eigenen Widerruf). Jede beendete Sitzung steht in der Spur und beendet ihre
//! offenen Live-Ströme sofort. Herleitung: `/mnt/project-files/lfh-1092/design.md`.

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel};
use crate::auth::session::{
    self, AdminUser, AktuelleSitzung, Auswahl, BeendeteSitzung, CurrentUser, SitzungAnzeige,
};
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::extract::{PeerIp, PfadParam};
use axum::extract::State;
use axum::Json;
use serde::Serialize;
use std::net::IpAddr;
use utoipa::ToSchema;

/// Antwort der Beenden-Routen.
#[derive(Debug, Serialize, ToSchema)]
pub struct SitzungenBeendet {
    /// Zahl der beendeten Sitzungen.
    pub beendet: u32,
}

const AKTUELLE_SITZUNG: &str = "Die aktuelle Anmeldung endet über Abmelden.";

/// GET /api/auth/sitzungen — die eigenen laufenden Sitzungen, die aktuelle markiert.
pub async fn eigene_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    AktuelleSitzung(aktuell): AktuelleSitzung,
) -> Result<Json<Vec<SitzungAnzeige>>, AppError> {
    let aktuell = aktuell.map(|k| k.0);
    Ok(Json(
        session::liste(&state.pool, benutzer.id, aktuell.as_deref()).await?,
    ))
}

/// DELETE /api/auth/sitzungen/{kennung} — eine eigene Sitzung beenden. Die aktuelle → 422
/// (dafür gibt es Abmelden), eine unbekannte → 404.
pub async fn eigene_beenden(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    CurrentUser(benutzer): CurrentUser,
    AktuelleSitzung(aktuell): AktuelleSitzung,
    PfadParam(kennung): PfadParam<String>,
) -> Result<Json<SitzungenBeendet>, AppError> {
    if aktuell.as_ref().is_some_and(|k| k.0 == kennung) {
        return Err(AppError::UnprocessableEntity(AKTUELLE_SITZUNG.into()));
    }
    let beendet = session::beenden(&state.pool, benutzer.id, Auswahl::Eine(&kennung)).await?;
    if beendet.is_empty() {
        return Err(AppError::NotFound);
    }
    Ok(Json(
        nach_dem_beenden(&state, &benutzer, None, peer_ip, beendet).await,
    ))
}

/// POST /api/auth/sitzungen/andere-beenden — alle eigenen Sitzungen außer der aktuellen.
pub async fn eigene_andere_beenden(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    CurrentUser(benutzer): CurrentUser,
    AktuelleSitzung(aktuell): AktuelleSitzung,
) -> Result<Json<SitzungenBeendet>, AppError> {
    let aktuell = aktuell.map(|k| k.0);
    let beendet = session::beenden(
        &state.pool,
        benutzer.id,
        Auswahl::AlleAusser(aktuell.as_deref()),
    )
    .await?;
    Ok(Json(
        nach_dem_beenden(&state, &benutzer, None, peer_ip, beendet).await,
    ))
}

/// Das Zielkonto einer Admin-Route: eine Person der eigenen Organisation. Ein Konto einer
/// fremden Organisation und ein Gerätekonto sind 404 wie ein unbekanntes.
async fn ziel_laden(state: &AppState, admin: &Benutzer, id: i64) -> Result<Benutzer, AppError> {
    let ziel = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, \
                aktiv, erstellt_at \
         FROM benutzer WHERE id = ? AND org_id = ?",
    )
    .bind(id)
    .bind(admin.org_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    if crate::geraet::repo::ist_geraetekonto(&state.pool, id).await? {
        return Err(AppError::NotFound);
    }
    Ok(ziel)
}

/// Die eigene Kennung, wenn der Admin sein eigenes Konto meint; sonst keine.
fn eigene_kennung(admin: &Benutzer, ziel: &Benutzer, aktuell: Option<String>) -> Option<String> {
    aktuell.filter(|_| admin.id == ziel.id)
}

/// GET /api/benutzer/{id}/sitzungen — die laufenden Sitzungen einer Person. Admin-only.
pub async fn admin_liste(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    AktuelleSitzung(aktuell): AktuelleSitzung,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<Vec<SitzungAnzeige>>, AppError> {
    let ziel = ziel_laden(&state, &admin, id).await?;
    let aktuell = eigene_kennung(&admin, &ziel, aktuell.map(|k| k.0));
    Ok(Json(
        session::liste(&state.pool, ziel.id, aktuell.as_deref()).await?,
    ))
}

/// DELETE /api/benutzer/{id}/sitzungen/{kennung} — eine Sitzung einer Person beenden.
/// Admin-only; die eigene aktuelle → 422.
pub async fn admin_beenden(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    AdminUser(admin): AdminUser,
    AktuelleSitzung(aktuell): AktuelleSitzung,
    PfadParam((id, kennung)): PfadParam<(i64, String)>,
) -> Result<Json<SitzungenBeendet>, AppError> {
    let ziel = ziel_laden(&state, &admin, id).await?;
    if eigene_kennung(&admin, &ziel, aktuell.map(|k| k.0)).as_deref() == Some(kennung.as_str()) {
        return Err(AppError::UnprocessableEntity(AKTUELLE_SITZUNG.into()));
    }
    let beendet = session::beenden(&state.pool, ziel.id, Auswahl::Eine(&kennung)).await?;
    if beendet.is_empty() {
        return Err(AppError::NotFound);
    }
    Ok(Json(
        nach_dem_beenden(&state, &ziel, Some(&admin), peer_ip, beendet).await,
    ))
}

/// POST /api/benutzer/{id}/sitzungen/beenden — alle Sitzungen einer Person; beim eigenen Konto
/// alle außer der aktuellen. Admin-only.
pub async fn admin_alle_beenden(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    AdminUser(admin): AdminUser,
    AktuelleSitzung(aktuell): AktuelleSitzung,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<SitzungenBeendet>, AppError> {
    let ziel = ziel_laden(&state, &admin, id).await?;
    let ausser = eigene_kennung(&admin, &ziel, aktuell.map(|k| k.0));
    let beendet =
        session::beenden(&state.pool, ziel.id, Auswahl::AlleAusser(ausser.as_deref())).await?;
    Ok(Json(
        nach_dem_beenden(&state, &ziel, Some(&admin), peer_ip, beendet).await,
    ))
}

/// Nach dem Löschen: offene Live-Ströme beenden, je Sitzung einen Audit-Eintrag schreiben
/// (design.md D6, D7). `admin` gesetzt → Admin-Spur, sonst Anmeldespur der Person selbst. Die
/// Spur schlägt nie nach außen durch: das Beenden ist schon geschehen.
async fn nach_dem_beenden(
    state: &AppState,
    person: &Benutzer,
    admin: Option<&Benutzer>,
    peer_ip: Option<IpAddr>,
    beendet: Vec<BeendeteSitzung>,
) -> SitzungenBeendet {
    state
        .live
        .melde_sitzung_ende(beendet.iter().map(|s| s.kennung.clone()));
    for sitzung in &beendet {
        match admin {
            Some(admin) => {
                admin_audit::schreibe(
                    &state.pool,
                    AdminEintrag {
                        aktion: AdminAktion::SitzungBeendet,
                        akteur: admin,
                        ziel: Ziel::Benutzer {
                            id: person.id,
                            benutzername: &person.benutzername,
                        },
                        detail: Some(format!(
                            "{}, angemeldet {}",
                            sitzung.geraet.as_deref().unwrap_or("unbekanntes Gerät"),
                            sitzung.angemeldet_at
                        )),
                        peer_ip,
                    },
                )
                .await;
            }
            None => {
                crate::auth::audit::schreibe(
                    &state.pool,
                    crate::auth::audit::AuditEintrag {
                        ereignis: crate::auth::audit::Ereignis::SitzungBeendet,
                        benutzername: Some(&person.benutzername),
                        benutzer_id: Some(person.id),
                        peer_ip: peer_ip.map(|ip| ip.to_string()),
                        // Wie beim Logout: die Spalte ist NOT NULL, die Sitzung kennt ihren
                        // Anmeldeweg nicht.
                        provider: crate::auth::provider::ID_PASSWORT,
                    },
                )
                .await;
            }
        }
    }
    SitzungenBeendet {
        beendet: u32::try_from(beendet.len()).unwrap_or(u32::MAX),
    }
}
