//! Routen der Dokumentenablage (LFH-632). Gates strukturell über die Extractor-Typen:
//! `EinsatzLesezugriff<Dokumente>` (alle Mitglieder inkl. Beobachter),
//! `EinsatzSchreibzugriff<Dokumente>` (Schreibrecht + aktiver Einsatz).

use axum::extract::{Multipart, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::Deserialize;

use crate::anhang;
use crate::app::AppState;
use crate::dokument::repo::{self, Ablage, Aenderung};
use crate::dokument::{Bezug, DokumentAnzeige, DokumentKategorie, TITEL_MAX};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Dokumente;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::routes::support::{deserialize_optional_field, pflicht};

use super::support::{anhang_antwort, original_freigeben, Fassung, FassungParam};

fn sse(state: &AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Dokument);
}

/// GET /api/einsaetze/{id}/dokumente — lebende Dokumente, neueste zuerst.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Dokumente>,
) -> Result<Json<Vec<DokumentAnzeige>>, AppError> {
    Ok(Json(repo::liste(&state.pool, ctx.einsatz.id).await?))
}

/// Titel: Pflicht, nach `trim` nicht leer, höchstens [`TITEL_MAX`] Zeichen (400).
fn pruefe_titel(titel: &str) -> Result<String, AppError> {
    let titel = pflicht(titel, "Titel")?;
    if titel.chars().count() > TITEL_MAX {
        return Err(AppError::Validation(format!(
            "Titel ist länger als {TITEL_MAX} Zeichen"
        )));
    }
    Ok(titel)
}

/// Kategorie: Pflicht, bekannter Wire-Wert (400).
fn pruefe_kategorie(kategorie: &str) -> Result<DokumentKategorie, AppError> {
    let roh = kategorie.trim();
    if roh.is_empty() {
        return Err(AppError::Validation("Kategorie fehlt".into()));
    }
    DokumentKategorie::parse(roh)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Kategorie '{roh}'")))
}

/// Bezugstyp + id → [`Bezug`]. Unbekannter Typ → 400. Die Paarregel („nur gemeinsam“, 422)
/// prüft der Aufrufer, weil Ablegen und Ändern das Fehlen verschieden ausdrücken.
fn pruefe_bezug(typ: &str, id: i64) -> Result<Bezug, AppError> {
    Ok(match typ.trim() {
        "abschnitt" => Bezug::Abschnitt(id),
        "einheit" => Bezug::Einheit(id),
        "etb_eintrag" => Bezug::EtbEintrag(id),
        typ => {
            return Err(AppError::Validation(format!(
                "Unbekannter bezug_typ '{typ}'"
            )))
        }
    })
}

fn nur_gemeinsam() -> AppError {
    AppError::UnprocessableEntity("bezug_typ und bezug_id nur gemeinsam".into())
}

/// Validiert die Textfelder. 400 = Feld für sich, 422 = Zusammenhang (LFH-267).
fn validiere(
    titel: Option<String>,
    kategorie: Option<String>,
    bezug_typ: Option<String>,
    bezug_id: Option<String>,
) -> Result<(String, DokumentKategorie, Option<Bezug>), AppError> {
    let titel = pruefe_titel(titel.as_deref().unwrap_or_default())?;
    let kategorie = pruefe_kategorie(kategorie.as_deref().unwrap_or_default())?;
    let leer = |o: Option<String>| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let bezug = match (leer(bezug_typ), leer(bezug_id)) {
        (None, None) => None,
        (Some(_), None) | (None, Some(_)) => return Err(nur_gemeinsam()),
        (Some(typ), Some(id)) => {
            let id: i64 = id
                .parse()
                .map_err(|_| AppError::Validation(format!("bezug_id ist keine Zahl: {id}")))?;
            Some(pruefe_bezug(&typ, id)?)
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
    // Typ, Größe, AV-Scan vor dem Persistieren (LFH-114, LFH-21: eine Prüfkette für alle
    // Upload-Wege); ohne clamd ist der Scan ein No-op, sonst fail-closed.
    let mime =
        anhang::pruefe_vor_persist(&dateiname, &daten, anhang::ERLAUBTE_MIME_DOKUMENT).await?;

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
    Query(param): Query<FassungParam>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let fassung = param.fassung()?;
    // Der Dokument-Lookup IST die Zugriffsprüfung: fremder Einsatz, unbekannte oder
    // soft-gelöschte id → 404. Danach dieselbe Header-Sequenz wie der Anhang-Download.
    let anhang_id = repo::anhang_id(&state.pool, ctx.einsatz.id, dokument_id).await?;
    if fassung == Fassung::Original {
        original_freigeben(&state, &ctx, anhang_id, "Dokumentenablage").await?;
    }
    anhang_antwort(&state.pool, anhang_id, &req_headers, fassung).await
}

/// Body von PATCH. `titel`/`kategorie`: fehlt oder `null` = bleibt (Pflichtangaben lassen sich
/// nicht leeren). Bezug dreiwertig je Feld: beide fehlen = bleibt, beide `null` = entfernen,
/// beide gesetzt = setzen, jede Mischung 422 (LFH-656, D1).
#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub titel: Option<String>,
    pub kategorie: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bezug_typ: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bezug_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/dokumente/{did} — Titel, Kategorie und Bezug ändern (LFH-656).
/// Die Datei bleibt; eine wirksame Änderung schreibt einen ETB-Nachweis (D2), eine wirkungslose
/// antwortet 200 ohne ETB und ohne Live-Hinweis.
pub async fn aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Dokumente>,
    PfadParam((_einsatz_id, dokument_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PatchBody>,
) -> Result<Json<DokumentAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let bezug = match (body.bezug_typ, body.bezug_id) {
        (None, None) => None,
        (Some(None), Some(None)) => Some(None),
        (Some(Some(typ)), Some(Some(id))) => Some(Some(pruefe_bezug(&typ, id)?)),
        _ => return Err(nur_gemeinsam()),
    };
    if body.titel.is_none() && body.kategorie.is_none() && bezug.is_none() {
        return Err(AppError::Validation(
            "Nichts zu ändern: titel, kategorie oder bezug angeben".into(),
        ));
    }
    let aenderung = Aenderung {
        titel: body.titel.as_deref().map(pruefe_titel).transpose()?,
        kategorie: body
            .kategorie
            .as_deref()
            .map(pruefe_kategorie)
            .transpose()?,
        bezug,
    };
    let etb_id = repo::aendern(
        &state.pool,
        einsatz_id,
        dokument_id,
        ctx.benutzer.id,
        &aenderung,
    )
    .await?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
        sse(&state, einsatz_id);
    }
    Ok(Json(
        repo::laden(&state.pool, einsatz_id, dokument_id).await?,
    ))
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
