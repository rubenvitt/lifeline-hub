//! Gemeinsame Handler-Logik der Vorlagen-Dokumente (`routes::befehl`, `routes::lagebericht`).
//! Die Handler selbst stehen weiter in den beiden Route-Modulen und reichen nur durch; hier
//! liegen Rechteprüfung, Validierung, Repo-Aufruf und Live-Ereignis, für beide Arten gleich.

use crate::app::AppState;
use crate::auth::Benutzer;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::normalisiere_zeit;
use crate::live::LiveEvent;
use crate::routes::support::{pflicht, pflicht_tri};
use crate::vorlagendokument::repo::{self as dok_repo, Patch};
use crate::vorlagendokument::{vorlage, Abschnittsart, Dokumentart, STATUS_ENTWURF};
use crate::zeit::jetzt;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Was die Routen einer Dokumentart über [`Dokumentart`] hinaus brauchen.
pub trait DokumentRoute: Dokumentart {
    /// Modul-Key für die Modul-Freigabe (LFH-132).
    const MODUL_KEY: &'static str;
    /// Live-Ereignis und Schlüssel der Objekt-id in seiner Payload.
    const LIVE: LiveEvent;
    const LIVE_ID: &'static str;
}

/// SSE-Notify: Dokumente des Einsatzes haben sich geändert.
fn sse<T: DokumentRoute>(state: &AppState, einsatz_id: i64, id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, T::LIVE, T::LIVE_ID, id);
}

/// Lesezugriff (inkl. Beobachter) plus Modul-Freigabe.
async fn fordere_lesen<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        T::MODUL_KEY,
        benutzer,
    )
    .await
}

/// Schreibrecht plus Modul-Freigabe, Einsatz aktiv.
async fn fordere_schreiben<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        T::MODUL_KEY,
        benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)
}

pub async fn liste<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<Json<Vec<T::Anzeige>>, AppError> {
    fordere_lesen::<T>(state, benutzer, einsatz_id).await?;
    let alle = dok_repo::liste::<T>(&state.pool, einsatz_id).await?;
    Ok(Json(alle.into_iter().map(Into::into).collect()))
}

pub async fn detail<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
) -> Result<Json<T::Anzeige>, AppError> {
    fordere_lesen::<T>(state, benutzer, einsatz_id).await?;
    Ok(Json(
        dok_repo::laden::<T>(&state.pool, einsatz_id, id)
            .await?
            .into(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: Option<String>,
}

pub async fn anlegen<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    body: AnlegenBody,
) -> Result<(StatusCode, Json<T::Anzeige>), AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    if vorlage::<T>(&body.vorlage).is_none() {
        return Err(AppError::Validation("Unbekannte Vorlage".into()));
    }
    let titel = pflicht(&body.titel, "Titel")?;
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => jetzt(),
    };

    let dok = dok_repo::anlegen::<T>(
        &state.pool,
        einsatz_id,
        &body.vorlage,
        &titel,
        &zeitstand,
        benutzer.id,
    )
    .await?;
    sse::<T>(state, einsatz_id, dok.id);
    Ok((StatusCode::CREATED, Json(dok.into())))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody<A> {
    pub titel: Option<String>,
    pub zeitstand: Option<String>,
    pub abschnitte: Option<Vec<A>>,
}

/// Nur solange Entwurf (sonst 422).
pub async fn aktualisieren<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
    body: PatchBody<T::Abschnitt>,
) -> Result<Json<T::Anzeige>, AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    let vorher = dok_repo::laden::<T>(&state.pool, einsatz_id, id).await?;
    if vorher.status != STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(
            "Nur Entwürfe können bearbeitet werden".into(),
        ));
    }

    let titel = pflicht_tri(body.titel.as_deref(), "Titel")?;
    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => Some(normalisiere_zeit(z)?),
        None => None,
    };
    if let Some(abs) = &body.abschnitte {
        let v = vorlage::<T>(&vorher.vorlage)
            .ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
        for a in abs {
            // Enum-artig: der Schlüssel wird gegen die feste Schlüsselmenge der Vorlage
            // geprüft, scheitert also am Feld selbst → 400 (LFH-305).
            if !v.abschnitte.iter().any(|d| d.schluessel == a.schluessel()) {
                return Err(AppError::Validation(format!(
                    "Unbekannter Abschnitts-Schlüssel «{}»",
                    a.schluessel()
                )));
            }
        }
    }

    let dok = dok_repo::aktualisiere::<T>(
        &state.pool,
        einsatz_id,
        id,
        Patch {
            titel: titel.as_deref(),
            zeitstand: zeitstand.as_deref(),
            abschnitte: body.abschnitte.as_deref(),
        },
    )
    .await?;
    sse::<T>(state, einsatz_id, id);
    Ok(Json(dok.into()))
}

/// Rendert und snapshottet ins ETB.
pub async fn freigeben<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
) -> Result<Json<T::Anzeige>, AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    // Laden, Status prüfen, validieren, rendern und schreiben in EINER Transaktion, auf
    // demselben Weg wie der Demo-Import (LFH-690).
    let dok = dok_repo::freigeben_gerendert::<T>(&state.pool, einsatz_id, id, benutzer.id).await?;

    if let Some(etb_id) = dok.etb_eintrag_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse::<T>(state, einsatz_id, id);
    Ok(Json(dok.into()))
}

#[derive(Debug, Deserialize)]
pub struct FortschreibenBody {
    pub zeitstand: Option<String>,
}

/// Neue Entwurfs-Version aus einem freigegebenen Dokument.
pub async fn fortschreiben<T: DokumentRoute>(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
    id: i64,
    body: FortschreibenBody,
) -> Result<(StatusCode, Json<T::Anzeige>), AppError> {
    fordere_schreiben::<T>(state, benutzer, einsatz_id).await?;

    let zeitstand = match body.zeitstand.as_deref() {
        Some(z) => normalisiere_zeit(z)?,
        None => jetzt(),
    };
    let dok =
        dok_repo::fortschreiben::<T>(&state.pool, einsatz_id, id, benutzer.id, &zeitstand).await?;
    sse::<T>(state, einsatz_id, dok.id);
    Ok((StatusCode::CREATED, Json(dok.into())))
}
