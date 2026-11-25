//! Routen „Stammdaten einlesen“ (LLH-1633): Fahrzeuge, Personal und Qualifikationen aus einer
//! Datei (CSV oder XLSX, Vertrag „Stammdaten-Datei“). Pfade unter `/api/master-data/import`.
//!
//! `POST …/preview` gleicht ab und schreibt nichts; `POST …/import` schreibt in EINER
//! Transaktion. Beide nur für Admins (wie `POST /api/vehicles`); meldet sich die Org bei einem
//! Hub, führt der Hub die Stammdaten und die Routen antworten 409. Die Datei wird außerhalb der
//! Async-Worker gelesen. Das Log nennt Org, Benutzer, Herkunft und Zählung, nie Feldwerte.

use axum::extract::{Multipart, State};
use axum::Json;

use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::error::AppError;
use crate::stammdaten_eingang::datei::lies_paket;
use crate::stammdaten_eingang::repo::{
    self, Entscheidungen, StammdatenErgebnis, StammdatenVorschau, ENTSCHEIDUNGEN_MAX,
};
use crate::stammdaten_eingang::{DateiMeldung, StammdatenPaket};

/// Längste Herkunft, die ein Hochladen nennen darf (wie in der Datei).
const HERKUNFT_MAX: usize = 100;

/// Die Teile einer Anfrage: `datei`, optional `herkunft` und `entscheidungen` (JSON).
struct Anfrage {
    datei: Vec<u8>,
    herkunft: Option<String>,
    entscheidungen: Entscheidungen,
}

/// Ein anderes Feld, ein doppeltes Feld oder ungültiges JSON ist 400.
async fn lies_anfrage(multipart: &mut Multipart) -> Result<Anfrage, AppError> {
    let mut datei: Option<Vec<u8>> = None;
    let mut herkunft: Option<String> = None;
    let mut entscheidungen: Option<Entscheidungen> = None;
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        match feld.name() {
            Some("datei") => {
                if datei.is_some() {
                    return Err(AppError::Validation("Genau eine Datei".into()));
                }
                let bytes = feld.bytes().await.map_err(|e| {
                    AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}"))
                })?;
                datei = Some(bytes.to_vec());
            }
            Some("herkunft") => {
                if herkunft.is_some() {
                    return Err(AppError::Validation("herkunft doppelt".into()));
                }
                let text = feld
                    .text()
                    .await
                    .map_err(|e| AppError::Validation(format!("herkunft: {e}")))?;
                let text = text.trim();
                if text.chars().count() > HERKUNFT_MAX {
                    return Err(AppError::Validation(format!(
                        "herkunft: höchstens {HERKUNFT_MAX} Zeichen"
                    )));
                }
                herkunft = Some(text.to_string());
            }
            Some("entscheidungen") => {
                if entscheidungen.is_some() {
                    return Err(AppError::Validation("entscheidungen doppelt".into()));
                }
                let text = feld
                    .text()
                    .await
                    .map_err(|e| AppError::Validation(format!("entscheidungen: {e}")))?;
                let e: Entscheidungen = serde_json::from_str(&text)
                    .map_err(|e| AppError::Validation(format!("entscheidungen: {e}")))?;
                if e.zeilen.len() > ENTSCHEIDUNGEN_MAX
                    || e.qualifikationen.len() > ENTSCHEIDUNGEN_MAX
                {
                    return Err(AppError::Validation(format!(
                        "entscheidungen: höchstens {ENTSCHEIDUNGEN_MAX} je Art"
                    )));
                }
                entscheidungen = Some(e);
            }
            andere => {
                return Err(AppError::Validation(format!(
                    "Unbekanntes Feld '{}'",
                    andere.unwrap_or_default()
                )))
            }
        }
    }
    Ok(Anfrage {
        datei: datei.ok_or_else(|| AppError::Validation("Keine Datei im Upload".into()))?,
        herkunft: herkunft.filter(|h| !h.is_empty()),
        entscheidungen: entscheidungen.unwrap_or_default(),
    })
}

/// Gemeinsamer Anfang: Hub-Sperre (409), Anfrage lesen (400), Datei lesen (400).
async fn vorbereiten(
    state: &AppState,
    org_id: i64,
    multipart: &mut Multipart,
) -> Result<
    (
        StammdatenPaket,
        Vec<DateiMeldung>,
        Vec<String>,
        Option<String>,
        Entscheidungen,
    ),
    AppError,
> {
    let mut conn = state.pool.acquire().await?;
    if crate::public_api::zugang::hub_fuer_org(&mut conn, org_id)
        .await?
        .is_some()
    {
        return Err(AppError::Conflict(
            "Die Stammdaten führt der Hub; sie werden hier nicht eingelesen".into(),
        ));
    }
    drop(conn);
    let anfrage = lies_anfrage(multipart).await?;
    let datei = anfrage.datei;
    // Entpacken und Parsen (XLSX bis 2 MiB, 5.000 Zeilen je Art) außerhalb der Async-Worker.
    let (paket, meldungen, nicht_uebernommen) =
        tokio::task::spawn_blocking(move || lies_paket(&datei))
            .await
            .map_err(|e| AppError::Internal(format!("Einlesen der Stammdaten-Datei: {e}")))??;
    Ok((
        paket,
        meldungen,
        nicht_uebernommen,
        anfrage.herkunft,
        anfrage.entscheidungen,
    ))
}

/// POST /api/master-data/import/preview — Admin. Multipart mit `datei`, optional `herkunft`
/// und `entscheidungen`. Gleicht ab und schreibt nichts; Fehler einzelner Zeilen stehen in der
/// Antwort (200). Eine unlesbare Datei ist 400, eine Org am Hub 409.
pub async fn vorschau(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    mut multipart: Multipart,
) -> Result<Json<StammdatenVorschau>, AppError> {
    let (paket, meldungen, nicht_uebernommen, herkunft, entscheidungen) =
        vorbereiten(&state, benutzer.org_id, &mut multipart).await?;
    Ok(Json(
        repo::vorschau(
            &state.pool,
            benutzer.org_id,
            &paket,
            &meldungen,
            &nicht_uebernommen,
            herkunft.as_deref(),
            &entscheidungen,
        )
        .await?,
    ))
}

/// POST /api/master-data/import — Admin. Dieselben Teile wie die Vorschau; schreibt in einer
/// Transaktion oder gar nicht. Nicht übernehmbar (Zeilenfehler, offene Mehrdeutigkeit) → 422
/// mit den Zeilen, fehlende Herkunft → 400, Org am Hub → 409.
pub async fn uebernehmen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    mut multipart: Multipart,
) -> Result<Json<StammdatenErgebnis>, AppError> {
    let (paket, meldungen, nicht_uebernommen, herkunft, entscheidungen) =
        vorbereiten(&state, benutzer.org_id, &mut multipart).await?;
    let (ergebnis, fahrzeug_ids) = repo::uebernehmen(
        &state.pool,
        benutzer.org_id,
        &paket,
        &meldungen,
        &nicht_uebernommen,
        herkunft.as_deref(),
        &entscheidungen,
    )
    .await?;
    for id in fahrzeug_ids {
        super::fahrzeug::stamm_geaendert_melden(&state, benutzer.org_id, id).await;
    }
    tracing::info!(
        org_id = benutzer.org_id,
        benutzer_id = benutzer.id,
        herkunft = herkunft.as_deref().unwrap_or(""),
        zaehlung = ?ergebnis.zaehlung,
        "Stammdaten-Datei übernommen"
    );
    Ok(Json(ergebnis))
}
