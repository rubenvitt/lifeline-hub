//! Routen der Dokumentenablage (LFH-632). Gates strukturell über die Extractor-Typen:
//! `EinsatzLesezugriff<Dokumente>` (alle Mitglieder inkl. Beobachter),
//! `EinsatzSchreibzugriff<Dokumente>` (Schreibrecht + aktiver Einsatz).

use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

use crate::anhang;
use crate::app::AppState;
use crate::dokument::repo::{self, Ablage};
use crate::dokument::{Bezug, DokumentAnzeige, DokumentKategorie, TITEL_MAX};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Dokumente;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::live::LiveEvent;

use super::support::anhang_antwort;

fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Dokument,
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// GET /api/einsaetze/{id}/dokumente — lebende Dokumente, neueste zuerst.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Dokumente>,
) -> Result<Json<Vec<DokumentAnzeige>>, AppError> {
    Ok(Json(repo::liste(&state.pool, ctx.einsatz.id).await?))
}

/// Validiert die Textfelder. 400 = Feld für sich, 422 = Zusammenhang (LFH-267).
fn validiere(
    titel: Option<String>,
    kategorie: Option<String>,
    bezug_typ: Option<String>,
    bezug_id: Option<String>,
) -> Result<(String, DokumentKategorie, Option<Bezug>), AppError> {
    let titel = titel.map(|t| t.trim().to_string()).unwrap_or_default();
    if titel.is_empty() {
        return Err(AppError::Validation("Titel darf nicht leer sein".into()));
    }
    if titel.chars().count() > TITEL_MAX {
        return Err(AppError::Validation(format!(
            "Titel ist länger als {TITEL_MAX} Zeichen"
        )));
    }
    let roh = kategorie.map(|k| k.trim().to_string()).unwrap_or_default();
    if roh.is_empty() {
        return Err(AppError::Validation("Kategorie fehlt".into()));
    }
    let kategorie = DokumentKategorie::parse(&roh)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Kategorie '{roh}'")))?;
    let leer = |o: Option<String>| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let bezug = match (leer(bezug_typ), leer(bezug_id)) {
        (None, None) => None,
        (Some(_), None) | (None, Some(_)) => {
            return Err(AppError::UnprocessableEntity(
                "bezug_typ und bezug_id nur gemeinsam".into(),
            ))
        }
        (Some(typ), Some(id)) => {
            let id: i64 = id
                .parse()
                .map_err(|_| AppError::Validation(format!("bezug_id ist keine Zahl: {id}")))?;
            Some(match typ.as_str() {
                "abschnitt" => Bezug::Abschnitt(id),
                "einheit" => Bezug::Einheit(id),
                "etb_eintrag" => Bezug::EtbEintrag(id),
                _ => {
                    return Err(AppError::Validation(format!(
                        "Unbekannter bezug_typ '{typ}'"
                    )))
                }
            })
        }
    };
    Ok((titel, kategorie, bezug))
}

/// POST /api/einsaetze/{id}/dokumente — Datei + Metadaten in EINEM Multipart (E6).
pub async fn ablegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Dokumente>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<DokumentAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (mut datei, mut titel, mut kategorie, mut bezug_typ, mut bezug_id) =
        (None::<(String, Vec<u8>)>, None, None, None, None);
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        let name = feld.name().map(str::to_string);
        let text = |e| AppError::Validation(format!("Feld lesen fehlgeschlagen: {e}"));
        match name.as_deref() {
            Some("datei") => {
                let dateiname = feld
                    .file_name()
                    .map(str::to_string)
                    .ok_or_else(|| AppError::Validation("Datei ohne Dateinamen".into()))?;
                let b = feld.bytes().await.map_err(|e| {
                    AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}"))
                })?;
                datei = Some((dateiname, b.to_vec()));
            }
            Some("titel") => titel = Some(feld.text().await.map_err(text)?),
            Some("kategorie") => kategorie = Some(feld.text().await.map_err(text)?),
            Some("bezug_typ") => bezug_typ = Some(feld.text().await.map_err(text)?),
            Some("bezug_id") => bezug_id = Some(feld.text().await.map_err(text)?),
            _ => {}
        }
    }
    let (dateiname, daten) =
        datei.ok_or_else(|| AppError::Validation("Keine Datei im Upload".into()))?;
    let (titel, kategorie, bezug) = validiere(titel, kategorie, bezug_typ, bezug_id)?;
    let mime = anhang::ermittle_mime_aus(&dateiname, anhang::ERLAUBTE_MIME_DOKUMENT)?;
    anhang::pruefe_groesse(daten.len())?;
    // AV-Scan vor dem Persistieren (LFH-114); ohne clamd ein No-op, sonst fail-closed.
    anhang::scan(anhang::scan_config(), &daten).await?;

    let (id, etb_id) = repo::ablegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &Ablage {
            kategorie,
            titel: &titel,
            bezug,
            dateiname: &dateiname,
            mime: &mime,
            daten: &daten,
        },
    )
    .await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse(&state, einsatz_id);
    Ok((
        StatusCode::CREATED,
        Json(repo::laden(&state.pool, einsatz_id, id).await?),
    ))
}

/// GET /api/einsaetze/{id}/dokumente/{did}/datei — Download (modul-gegatet, E8).
pub async fn datei(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Dokumente>,
    PfadParam((_einsatz_id, dokument_id)): PfadParam<(i64, i64)>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    // Der Dokument-Lookup IST die Zugriffsprüfung: fremder Einsatz, unbekannte oder
    // soft-gelöschte id → 404. Danach dieselbe Header-Sequenz wie der Anhang-Download.
    let anhang_id = repo::anhang_id(&state.pool, ctx.einsatz.id, dokument_id).await?;
    anhang_antwort(&state.pool, anhang_id, &req_headers).await
}

/// DELETE /api/einsaetze/{id}/dokumente/{did} — Soft-Delete mit ETB-Nachweis (E1).
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Dokumente>,
    PfadParam((_einsatz_id, dokument_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let etb_id = repo::entfernen(&state.pool, einsatz_id, dokument_id, ctx.benutzer.id).await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}
