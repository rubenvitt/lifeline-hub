use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::fordere_aktiv;
use crate::einsatz::berechtigung::fordere_schreibrecht;
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{normalisiere_zeit, repo, EtbEintragAnzeige, EtbTyp, MeldeWeg};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NeuerEintrag {
    pub typ: String,
    pub inhalt: String,
    pub von: Option<String>,
    pub an: Option<String>,
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    /// ISO-8601/RFC3339 oder SQLite-Format; fehlt das Feld, setzt der Server „jetzt".
    pub ereigniszeit: Option<String>,
    pub erfasst_lokal_at: Option<String>,
    /// Pflicht bei `typ = "berichtigung"`, sonst muss es fehlen.
    pub berichtigt_eintrag_id: Option<i64>,
}

/// Trimmt einen optionalen String und verwirft ihn, wenn er leer ist.
fn bereinige(feld: Option<String>) -> Option<String> {
    feld.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// POST /api/einsaetze/{id}/etb — neuen ETB-Eintrag erfassen.
/// Nur Schreibberechtigte (Einsatzleitung/Führungspersonal), nur bei aktivem
/// Einsatz. Der Server vergibt `lfd_nr` und `received_at` und broadcastet den
/// fertigen Eintrag an alle SSE-Abonnenten.
pub async fn erfassen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeuerEintrag>,
) -> Result<(StatusCode, Json<EtbEintragAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Typ validieren; System ist nicht client-erfassbar.
    let typ = EtbTyp::parse(&req.typ)
        .ok_or_else(|| AppError::Validation("Ungültiger Eintragstyp".into()))?;
    if !typ.darf_client_erfassen() {
        return Err(AppError::Validation(
            "Eintragstyp 'system' kann nicht manuell erfasst werden".into(),
        ));
    }

    let inhalt = req.inhalt.trim();
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }

    // Meldeweg validieren (falls gesetzt).
    let meldeweg = bereinige(req.meldeweg);
    if let Some(w) = &meldeweg {
        if MeldeWeg::parse(w).is_none() {
            return Err(AppError::Validation("Ungültiger Meldeweg".into()));
        }
    }

    // Berichtigungs-Regeln (Spec §6: Korrekturen nur als verknüpfte Berichtigung).
    if typ.ist_berichtigung() {
        let ziel = req.berichtigt_eintrag_id.ok_or_else(|| {
            AppError::Validation("Berichtigung erfordert berichtigt_eintrag_id".into())
        })?;
        if !repo::gehoert_zu_einsatz(&state.pool, ziel, einsatz_id).await? {
            return Err(AppError::Validation(
                "Berichtigter Eintrag gehört nicht zu diesem Einsatz".into(),
            ));
        }
    } else if req.berichtigt_eintrag_id.is_some() {
        return Err(AppError::Validation(
            "berichtigt_eintrag_id ist nur bei typ='berichtigung' erlaubt".into(),
        ));
    }

    // Zeiten normalisieren (None = Server-Default in der DB).
    let ereigniszeit = match &req.ereigniszeit {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };
    let erfasst_lokal_at = match &req.erfasst_lokal_at {
        Some(s) => Some(normalisiere_zeit(s)?),
        None => None,
    };

    let von = bereinige(req.von);
    let an = bereinige(req.an);
    let veranlassung = bereinige(req.veranlassung);

    let anzeige = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::EintragDaten {
            typ: typ.as_str(),
            inhalt,
            von: von.as_deref(),
            an: an.as_deref(),
            meldeweg: meldeweg.as_deref(),
            veranlassung: veranlassung.as_deref(),
            ereigniszeit: ereigniszeit.as_deref(),
            erfasst_lokal_at: erfasst_lokal_at.as_deref(),
            berichtigt_eintrag_id: req.berichtigt_eintrag_id,
        },
    )
    .await?;

    // Live an alle SSE-Abonnenten dieses Einsatzes pushen. Eine Serialisierung
    // dieses Typs kann derzeit nicht fehlschlagen; sollte sie es künftig doch,
    // wird der Eintrag (bereits persistiert) nicht stillschweigend verschluckt,
    // sondern protokolliert.
    match serde_json::to_string(&anzeige) {
        Ok(json) => state.live.publiziere(einsatz_id, json),
        Err(e) => tracing::error!(
            eintrag_id = anzeige.id,
            %e,
            "ETB-Eintrag konnte nicht für Live-Publish serialisiert werden"
        ),
    }

    Ok((StatusCode::CREATED, Json(anzeige)))
}
