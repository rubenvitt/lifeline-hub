//! Zentraler Einsatz-Zugriffs-Extractor (LFH-121).
//!
//! Bündelt das in ~200 Handlern von Hand wiederholte Gate-Vorspiel
//! (Einsatz laden → Rolle bestimmen → Org-Zugehörigkeit prüfen) in einen
//! wiederverwendbaren Axum-Extractor. Ein Handler zieht `EinsatzKontext` deklarativ
//! in die Signatur und ruft danach nur noch das fachlich passende Gate
//! (`fordere_lesezugriff`/`fordere_schreibrecht`/…) auf `self`.
//!
//! Der **Org-Isolations-Floor** ([`berechtigung::fordere_org_zugehoerigkeit`]) läuft
//! dabei IMMER im Extractor — damit die Cross-Org-Lücke (LFH-115) für neue Sub-Routen
//! strukturell nicht mehr „vergessen" werden kann (der Guard-Test
//! `tests/einsatz_kontext_guard.rs` erzwingt, dass jede `/api/einsaetze/{id}/…`-Route
//! den Extractor zieht).
//!
//! Bewusst zieht der Extractor NICHT die volle Lese-Policy (`fordere_lesezugriff`):
//! deren DSGVO-Hard-Blocks (Aufbewahrungsfrist/Tombstone) sperren auch höhere
//! Berechtigungen und würden `aufbewahrungsfrist_setzen` (Admin/Einsatzleitung
//! verlängert reaktiv die Frist eines abgelaufenen Einsatzes) aussperren. Das
//! Read-/Write-/Aktiv-/Modul-Gate bleibt darum explizit im Handler — jetzt aber
//! deklarativ über die Helfer-Methoden, ohne wiederholtes Laden/Rolle-Bestimmen.

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::auth::Benutzer;
use crate::einsatz::modul::{ModulMarker, OhneModul};
use crate::einsatz::{berechtigung, repo as einsatz_repo, Einsatz, EinsatzRolle};
use crate::error::AppError;
use axum::extract::{FromRequestParts, Path};
use axum::http::request::Parts;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::marker::PhantomData;
use std::ops::Deref;

/// Der zugriffs-geprüfte Kontext eines einsatz-gebundenen Handlers: der geladene
/// Einsatz, die Rolle des aufrufenden Benutzers darin (`None` = kein Mitglied) und
/// der Benutzer selbst. Bei erfolgreicher Extraktion ist der **Org-Floor** bereits
/// bestanden (Mitglied ODER fremdeinsatz-leseberechtigt).
pub struct EinsatzKontext {
    pub einsatz: Einsatz,
    pub rolle: Option<EinsatzRolle>,
    pub benutzer: Benutzer,
}

impl FromRequestParts<AppState> for EinsatzKontext {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let CurrentUser(benutzer) = CurrentUser::from_request_parts(parts, state).await?;

        // Alle einsatz-gebundenen Routen tragen den Einsatz als `{id}` (einheitlich
        // über alle 162 Routen, per app.rs verifiziert). Keyed-Extraktion statt
        // positionell, damit verschachtelte Pfade (`{id}/…/{child_id}`) egal sind.
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::NotFound)?;
        let einsatz_id: i64 = params
            .get("id")
            .and_then(|s| s.parse().ok())
            .ok_or(AppError::NotFound)?;

        let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
        let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
        berechtigung::fordere_org_zugehoerigkeit(&benutzer, einsatz.org_id, rolle)?;

        Ok(EinsatzKontext {
            einsatz,
            rolle,
            benutzer,
        })
    }
}

impl EinsatzKontext {
    /// Lese-Gate inkl. DSGVO-Zeit-Policy (Nachlauffrist/Aufbewahrungsfrist/Tombstone).
    pub fn fordere_lesezugriff(&self) -> Result<(), AppError> {
        berechtigung::fordere_lesezugriff(&self.benutzer, &self.einsatz, self.rolle)
    }

    /// Schreib-Gate: Einsatzleitung oder Führungspersonal.
    pub fn fordere_schreibrecht(&self) -> Result<(), AppError> {
        berechtigung::fordere_schreibrecht(self.rolle)
    }

    /// Schreib-Gate ODER System-Admin (für Kopfdaten-/Einstellungs-Routen).
    pub fn fordere_schreibrecht_oder_admin(&self) -> Result<(), AppError> {
        berechtigung::fordere_schreibrecht_oder_admin(&self.benutzer, self.rolle)
    }

    /// Nur-Einsatzleitung-Gate.
    pub fn fordere_einsatzleitung(&self) -> Result<(), AppError> {
        berechtigung::fordere_einsatzleitung(self.rolle)
    }

    /// Schreib-Freeze: der Einsatz muss noch aktiv (beschreibbar) sein.
    pub fn fordere_aktiv(&self) -> Result<(), AppError> {
        berechtigung::fordere_aktiv(&self.einsatz)
    }

    /// Modul-Sichtbarkeit/-Rolle (LFH-132) für `modul_key` prüfen (lädt Override-Maps).
    pub async fn fordere_modul_zugriff(
        &self,
        pool: &SqlitePool,
        modul_key: &str,
    ) -> Result<(), AppError> {
        berechtigung::fordere_modul_zugriff_laden(
            pool,
            self.einsatz.id,
            self.einsatz.org_id,
            modul_key,
            &self.benutzer,
        )
        .await
    }
}

/// Lese-Gate-Extractor (LFH-230): Org-Floor (via [`EinsatzKontext`]) + `fordere_lesezugriff`
/// (+ Modul-Gate `M`, falls `M::KEY` gesetzt). Der Typ ERZWINGT das Gate — ein Handler
/// unter dieser Signatur kann die Lese-Prüfung nicht mehr „vergessen". Über `Deref`
/// bleibt `ctx.einsatz`/`ctx.benutzer`/`ctx.rolle` unverändert erreichbar.
pub struct EinsatzLesezugriff<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzLesezugriff<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_lesezugriff()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzLesezugriff<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}

/// Schreib-Gate-Extractor (LFH-230): Org-Floor + `fordere_schreibrecht`
/// (+ Modul-Gate `M`) + `fordere_aktiv` — in genau dieser Reihenfolge (Status-Code-
/// Präzedenz erhalten). Ownership-/Objekt-Prüfungen (gehört das Kind-Objekt zum
/// Einsatz?) bleiben bewusst im Handler.
pub struct EinsatzSchreibzugriff<M: ModulMarker = OhneModul>(pub EinsatzKontext, PhantomData<M>);

impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzSchreibzugriff<M> {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let ctx = EinsatzKontext::from_request_parts(parts, state).await?;
        ctx.fordere_schreibrecht()?;
        if let Some(key) = M::KEY {
            ctx.fordere_modul_zugriff(&state.pool, key).await?;
        }
        ctx.fordere_aktiv()?;
        Ok(Self(ctx, PhantomData))
    }
}

impl<M: ModulMarker> Deref for EinsatzSchreibzugriff<M> {
    type Target = EinsatzKontext;
    fn deref(&self) -> &EinsatzKontext {
        &self.0
    }
}
