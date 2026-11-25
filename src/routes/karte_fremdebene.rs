//! Fremdebenen der Lagekarte (LLH-2099): Liste, Anlegen aus einer Datei, Daten, Ändern und
//! Entfernen. Entwurf: `docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md`,
//! Abschnitt „Routen“. Die Routen liegen unter `/api/incidents/{id}/map/foreign-layers`
//! (ADR-0097).

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzKontext, EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::karte_fremdebene::{
    self as fremdebene,
    abruf::{self, Geholt},
    einlesen, repo,
    repo::FremdebenePatch,
    FremdebeneAnzeige, FremdebeneFehler, FremdebeneQuelle,
};
use crate::live::LiveEvent;
use crate::routes::support::{etag_von, hoechstens, if_none_match_matcht, pflicht_max_tri};
use axum::extract::{Multipart, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

/// `Content-Type` der Daten (RFC 7946).
const GEOJSON_MIME: &str = "application/geo+json";

/// `Cache-Control` der Daten: halten, aber vor jeder Verwendung per `If-None-Match` nachfragen
/// (wie die Fachebenen, LFH-594).
const DATEN_CACHE_CONTROL: &str = "private, no-cache";

/// Name einer Ebene, wenn weder Feld noch Datei einen nennen.
const NAME_VORGABE: &str = "Fremdebene";

/// SSE-Notify: Liste oder Daten einer Fremdebene haben sich geändert. Event-Tag
/// `karte_fremdebene`.
fn sse_fremdebene(state: &AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::KarteFremdebene);
}

/// Ob der Aufrufer schreiben darf: dieselbe Rollenprüfung wie `EinsatzSchreibzugriff`. Nur sie
/// sieht die volle `url` (Entwurf, „URL mit Geheimnis im Query“).
fn darf_schreiben(ctx: &EinsatzKontext) -> bool {
    ctx.fordere_schreibrecht().is_ok()
}

/// GET Liste (Metadaten ohne Inhalt). Leser ohne Schreibrecht bekommen nur `url_host`.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
) -> Result<Json<Vec<FremdebeneAnzeige>>, AppError> {
    let ebenen = repo::liste(&state.pool, ctx.einsatz.id).await?;
    if darf_schreiben(&ctx) {
        return Ok(Json(ebenen));
    }
    Ok(Json(
        ebenen
            .into_iter()
            .map(FremdebeneAnzeige::fuer_leser)
            .collect(),
    ))
}

/// Liest ein Textfeld des Uploads.
async fn text(feld: axum::extract::multipart::Field<'_>, was: &str) -> Result<String, AppError> {
    feld.text()
        .await
        .map_err(|e| AppError::Validation(format!("{was} lesen fehlgeschlagen: {e}")))
}

/// Dateiname ohne Pfad und Endung, als Namensvorschlag.
fn name_aus_dateiname(dateiname: &str) -> Option<String> {
    let basis = dateiname.rsplit(['/', '\\']).next().unwrap_or(dateiname);
    let stamm = match basis.rsplit_once('.') {
        Some((stamm, _)) if !stamm.is_empty() => stamm,
        _ => basis,
    };
    let stamm = stamm.trim();
    (!stamm.is_empty()).then(|| stamm.to_string())
}

/// POST multipart: `name` (optional), genau eines von `file` oder `url`, optional `color`.
/// Reihenfolge: Felder → Größe → Einlesen → Virenscan → Speichern → Live.
///
/// Mit `url` (LLH-2100) läuft der erste Abruf in dieser Anfrage ([`anlegen_aus_url`]).
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<FremdebeneAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let mut name: Option<String> = None;
    let mut farbe: Option<String> = None;
    let mut url: Option<String> = None;
    let mut datei: Option<(axum::body::Bytes, Option<String>)> = None;

    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        match feld.name() {
            Some("file") => {
                let dateiname = feld.file_name().map(str::to_string);
                let bytes = feld.bytes().await.map_err(|e| {
                    AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}"))
                })?;
                datei = Some((bytes, dateiname));
            }
            Some("url") => url = Some(text(feld, "URL").await?),
            Some("name") => name = Some(text(feld, "Name").await?),
            Some("color") => farbe = Some(text(feld, "Farbe").await?),
            _ => {}
        }
    }

    // Ein leeres Feld zählt wie ein fehlendes (Formular ohne Eingabe).
    let url = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    if let Some(n) = &name {
        hoechstens(n, "Name", fremdebene::NAME_MAX)?;
    }
    let farbe = match farbe.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
        Some(f) => Some(fremdebene::check_farbe(f)?),
        None => None,
    };

    let (bytes, dateiname) = match (datei, url) {
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "Entweder eine Datei oder eine URL, nicht beides".into(),
            ))
        }
        (None, None) => {
            return Err(AppError::Validation(
                "Eine Datei oder eine URL ist nötig".into(),
            ))
        }
        (None, Some(url)) => {
            return anlegen_aus_url(&state, &ctx, url, name, farbe).await;
        }
        (Some(d), None) => d,
    };

    if bytes.len() > fremdebene::DATEI_MAX {
        return Err(FremdebeneFehler::ZuGross.into());
    }
    let normiert = einlesen::read_datei(&bytes)?;
    // AV-Scan vor dem Speichern über denselben Seam wie jeder Upload (LFH-238). Ein Fund ist hier
    // der Code `virus` (Entwurf, „Fehler“); ein unerreichbarer Scanner bleibt 503.
    crate::anhang::scan(crate::anhang::scan_config(), &bytes)
        .await
        .map_err(|e| match e {
            AppError::UnprocessableEntity(_) => FremdebeneFehler::Virus.into(),
            e => e,
        })?;

    // Ein Name, den niemand eingegeben hat, wird gekürzt übernommen (`src/AGENTS.md`,
    // „Eingabegrenzen“).
    let name = name
        .or_else(|| normiert.namensvorschlag.clone())
        .or_else(|| dateiname.as_deref().and_then(name_aus_dateiname))
        .unwrap_or_else(|| NAME_VORGABE.into());
    let name: String = name.chars().take(fremdebene::NAME_MAX).collect();
    let farbe = farbe_oder_naechste(&state, einsatz_id, farbe).await?;

    let ebene = repo::anlegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &name,
        FremdebeneQuelle::Datei,
        None,
        farbe,
        &normiert,
    )
    .await?;
    sse_fremdebene(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(ebene)))
}

/// Farbe einer neuen Ebene: die gewählte, sonst die nächste freie.
async fn farbe_oder_naechste(
    state: &AppState,
    einsatz_id: i64,
    farbe: Option<&'static str>,
) -> Result<&'static str, AppError> {
    Ok(match farbe {
        Some(f) => f,
        None => {
            let ebenen = repo::liste(&state.pool, einsatz_id).await?;
            fremdebene::naechste_farbe(ebenen.iter().map(|e| e.color.as_str()))
        }
    })
}

/// Anlegen einer URL-Ebene (LLH-2100): Zielschutz, erster Abruf synchron (ein Tippfehler kommt
/// sofort als 400 mit `grund` zurück), Einlesen, Speichern samt Validatoren. Nur die führende
/// Seite eines aktiven Einsatzes ruft ab. Die URL steht nie in Log oder Fehlertext.
async fn anlegen_aus_url(
    state: &AppState,
    ctx: &EinsatzKontext,
    url: String,
    name: Option<String>,
    farbe: Option<&'static str>,
) -> Result<(StatusCode, Json<FremdebeneAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    hoechstens(&url, "URL", crate::public_api::webhook::URL_MAX)?;
    if !abruf::is_hier_abzurufen(&ctx.einsatz) {
        return Err(AppError::Conflict(
            "Eine URL-Ebene ruft nur die führende Instanz eines aktiven Einsatzes ab".into(),
        ));
    }
    let (normiert, etag, last_modified) =
        match abruf::holen(state, ctx.einsatz.org_id, &url, None, None).await? {
            Ok(Geholt::Neu {
                normiert,
                etag,
                last_modified,
            }) => (normiert, etag, last_modified),
            // Ohne Validatoren gibt es kein 304; ein Ziel, das es dennoch schickt, liefert nichts.
            Ok(Geholt::Unveraendert { .. }) => return Err(FremdebeneFehler::Status.into()),
            Err(fehler) => {
                tracing::info!(
                    einsatz_id,
                    fehler = fehler.as_str(),
                    "Fremdebene: erster Abruf gescheitert"
                );
                return Err(fehler.into());
            }
        };

    let name = name
        .or_else(|| normiert.namensvorschlag.clone())
        .or_else(|| fremdebene::url_host(&url))
        .unwrap_or_else(|| NAME_VORGABE.into());
    let name: String = name.chars().take(fremdebene::NAME_MAX).collect();
    let farbe = farbe_oder_naechste(state, einsatz_id, farbe).await?;
    let ebene = repo::anlegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &name,
        FremdebeneQuelle::Url,
        Some(&url),
        farbe,
        &normiert,
    )
    .await?;
    repo::setze_abruf(
        &state.pool,
        einsatz_id,
        ebene.id,
        repo::AbrufStand::Erfolg {
            etag: etag.as_deref(),
            last_modified: last_modified.as_deref(),
        },
    )
    .await?;
    let ebene = repo::laden(&state.pool, einsatz_id, ebene.id).await?;
    sse_fremdebene(state, einsatz_id);
    Ok((StatusCode::CREATED, Json(ebene)))
}

/// GET normiertes GeoJSON. `ETag` = sha256 des Inhalts, 304 bei passendem `If-None-Match`.
/// Ungepackt: eine Antwort mit `ETag` packt die Kompression nicht (`src/AGENTS.md`,
/// „Antwortkompression“, LFH-940). Eine fällige URL-Ebene wird vorher bedingt nachgeholt
/// (`karte_fremdebene::abruf::refresh_if_due`); ein Abruffehler steht an der Ebene, die Daten
/// bleiben.
pub async fn daten(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    PfadParam((_eid, ebene_id)): PfadParam<(i64, i64)>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    abruf::refresh_if_due(&state, &ctx.einsatz, ebene_id).await?;
    let (geojson, sha) = repo::laden_daten(&state.pool, ctx.einsatz.id, ebene_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let etag = etag_von(&sha);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ETAG,
        HeaderValue::from_str(&etag)
            .map_err(|e| AppError::Internal(format!("Ungültiger ETag: {e}")))?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(DATEN_CACHE_CONTROL),
    );
    if if_none_match_matcht(&req_headers, &etag) {
        return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
    }
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(GEOJSON_MIME));
    Ok((headers, geojson).into_response())
}

/// Änderbare Angaben; ein fehlendes Feld bleibt.
#[derive(Debug, Deserialize)]
pub struct FremdebenePatchBody {
    pub name: Option<String>,
    pub color: Option<String>,
}

/// PATCH `name`, `color`. Schreibrecht und aktiver Einsatz.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_eid, ebene_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<FremdebenePatchBody>,
) -> Result<Json<FremdebeneAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let name = pflicht_max_tri(body.name.as_deref(), "Name", fremdebene::NAME_MAX)?;
    let farbe = body
        .color
        .as_deref()
        .map(|f| fremdebene::check_farbe(f.trim()).map(str::to_string))
        .transpose()?;
    let ebene = repo::aktualisiere(
        &state.pool,
        einsatz_id,
        ebene_id,
        FremdebenePatch { name, farbe },
    )
    .await?;
    sse_fremdebene(&state, einsatz_id);
    Ok(Json(ebene))
}

/// DELETE samt Inhalt. Schreibrecht und aktiver Einsatz.
pub async fn loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_eid, ebene_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    repo::loeschen(&state.pool, einsatz_id, ebene_id).await?;
    sse_fremdebene(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::name_aus_dateiname;

    #[test]
    fn dateiname_ohne_pfad_und_endung() {
        assert_eq!(
            name_aus_dateiname("gebiete.geojson").as_deref(),
            Some("gebiete")
        );
        assert_eq!(
            name_aus_dateiname("C:\\x\\spur.v2.kml").as_deref(),
            Some("spur.v2")
        );
        assert_eq!(name_aus_dateiname(".kml").as_deref(), Some(".kml"));
        assert_eq!(name_aus_dateiname("  "), None);
    }
}
