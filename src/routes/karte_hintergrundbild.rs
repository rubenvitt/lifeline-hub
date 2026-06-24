use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::karte_hintergrundbild::{
    self as bild, repo as bild_repo, repo::BildPatch, HintergrundbildAnzeige,
};
use axum::extract::{Multipart, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

const MODUL_KEY: &str = "lagekarte";

/// SSE-Notify: ein Bild-Hintergrund hat sich geändert. Event-Tag `karte_bild`.
fn sse_bild(state: &AppState, einsatz_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id }).to_string();
    state.live.publiziere_event(einsatz_id, "karte_bild", data);
}

/// GET Liste (Metadaten ohne BLOB). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<HintergrundbildAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    Ok(Json(bild_repo::liste(&state.pool, einsatz_id).await?))
}

/// POST Multipart-Upload. Felder: `datei` (Bytes), `ecken` (JSON-String der 4 Ecken),
/// optional `name`. Schreibrecht + aktiv.
pub async fn hochladen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<HintergrundbildAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    let mut bytes: Option<Vec<u8>> = None;
    let mut ecken: Option<String> = None;
    let mut name: Option<String> = None;

    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        match feld.name() {
            Some("datei") => {
                if name.is_none() {
                    name = feld.file_name().map(str::to_string);
                }
                let b = feld.bytes().await
                    .map_err(|e| AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}")))?;
                bytes = Some(b.to_vec());
            }
            Some("ecken") => {
                ecken = Some(feld.text().await
                    .map_err(|e| AppError::Validation(format!("Ecken lesen fehlgeschlagen: {e}")))?);
            }
            Some("name") => {
                name = Some(feld.text().await
                    .map_err(|e| AppError::Validation(format!("Name lesen fehlgeschlagen: {e}")))?);
            }
            _ => {}
        }
    }

    let bytes = bytes.ok_or_else(|| AppError::Validation("Kein Bild im Upload".into()))?;
    let ecken = ecken.ok_or_else(|| AppError::Validation("Ecken fehlen".into()))?;
    bild::pruefe_groesse(bytes.len())?;
    let mime = bild::erkenne_bild_mime(&bytes)?;
    bild::pruefe_ecken(&ecken)?;
    let name = name.unwrap_or_else(|| "Bild-Hintergrund".into());

    let a = bild_repo::anlegen(&state.pool, einsatz_id, benutzer.id, &name, mime, &bytes, &ecken).await?;
    sse_bild(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(a)))
}

/// GET Download der Bytes. Nur Lesezugriff; Ownership über `laden_bytes(einsatz_id, id)`.
pub async fn herunterladen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bild_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    let (mime, daten) = bild_repo::laden_bytes(&state.pool, einsatz_id, bild_id).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    Ok((headers, daten))
}

#[derive(Debug, Deserialize)]
pub struct BildPatchBody {
    pub name: Option<String>,
    pub ecken_json: Option<String>,
    pub opazitaet: Option<i64>,
    pub sichtbar: Option<bool>,
    pub reihenfolge: Option<i64>,
}

/// PATCH Stil/Geometrie ohne Neuupload. Schreibrecht + aktiv.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bild_id)): Path<(i64, i64)>,
    Json(body): Json<BildPatchBody>,
) -> Result<Json<HintergrundbildAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;

    if let Some(o) = body.opazitaet {
        bild::pruefe_opazitaet(o)?;
    }
    if let Some(e) = &body.ecken_json {
        bild::pruefe_ecken(e)?;
    }

    let a = bild_repo::aktualisiere(&state.pool, einsatz_id, bild_id, BildPatch {
        name: body.name,
        ecken_json: body.ecken_json,
        opazitaet: body.opazitaet,
        sichtbar: body.sichtbar,
        reihenfolge: body.reihenfolge,
    }).await?;
    sse_bild(&state, einsatz_id);
    Ok(Json(a))
}

/// DELETE (Hard-Delete). Schreibrecht + aktiv.
pub async fn loeschen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, bild_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(&state.pool, einsatz_id, einsatz.org_id, MODUL_KEY, &benutzer).await?;
    fordere_aktiv(&einsatz)?;
    bild_repo::loeschen(&state.pool, einsatz_id, bild_id).await?;
    sse_bild(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}
