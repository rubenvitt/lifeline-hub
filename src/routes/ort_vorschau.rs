//! GET /api/einsaetze/:id/ort-vorschau?lat=&lon=&exclude=typ:id
//!
//! Liefert `{peilung, ortsname}` für die Koordinaten-Plausibilitätsprüfung.
//! Die Peilung (nächster verorteter Marker) wird bedingungslos berechnet; `ortsname`
//! wird via Reverse-Geocoding gefüllt (org-konfigurierbarer Geocoder, Cache, Rate-Limit).
//! Auth/Scope wie andere /api/einsaetze/:id/*-Routen (Einsatz-Mitglied, Lesezugriff).
//!
//! GET /api/ort-vorschau?lat=&lon= (LLH-1376, Spec `ortsfeld`, „Ortsname als Vorschlag“): derselbe
//! Ortsname ohne Einsatz, etwa beim Anlegen ([`in_org`]). Nur wer Einsätze anlegen darf, wie die
//! Ortssuche der Organisation; keine Peilung, denn ohne Einsatz gibt es keinen Bezugspunkt.
//! Ausgelastet oder nicht erreichbar heißt in beiden Einstiegen: 200 ohne `ortsname`.

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
use crate::geocoding::{self, marker, peilung};
use crate::org::einstellungen as org_einst;
use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::Path;
use utoipa::ToSchema;

#[derive(Debug, Deserialize)]
pub struct OrtVorschauParams {
    pub lat: f64,
    pub lon: f64,
    /// `typ:id` der gerade bearbeiteten Entität (Selbst-Ausschluss), z. B. `uhs:7`.
    pub exclude: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PeilungAntwort {
    pub distanz_m: f64,
    pub richtung: String,
    pub bezug_label: String,
}

/// LFH-265: beide Felder werden ABSENT statt present-null serialisiert, damit der generierte
/// `peilung?`/`ortsname?` ehrlich ist. Wire-Änderung — gepinnt per `contains_key` in
/// `tests/ort_vorschau.rs` (ein `assert_eq!(v["ortsname"], Value::Null)` unterscheidet
/// fehlenden Key nicht von null und wäre hier blind).
#[derive(Debug, Serialize, ToSchema)]
pub struct OrtVorschauAntwort {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peilung: Option<PeilungAntwort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ortsname: Option<String>,
}

/// `"uhs:7"` → `("uhs", 7)`; ungültiges Format → None (Selbst-Ausschluss entfällt dann).
fn parse_exclude(s: &str) -> Option<(String, i64)> {
    let (typ, id) = s.split_once(':')?;
    Some((typ.to_string(), id.parse().ok()?))
}

pub async fn vorschau(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    Query(params): Query<OrtVorschauParams>,
) -> Result<Json<OrtVorschauAntwort>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    pruefe_koordinate(params.lat, params.lon)?;

    // Peilung: bedingungslos.
    let marker = marker::lade_marker(&state.pool, einsatz_id).await?;
    let exclude = params.exclude.as_deref().and_then(parse_exclude);
    let peilung = peilung::naechster(
        &marker,
        params.lat,
        params.lon,
        exclude.as_ref().map(|(t, i)| (t.as_str(), *i)),
    )
    .map(|p| PeilungAntwort {
        distanz_m: p.distanz_m,
        richtung: p.richtung,
        bezug_label: p.bezug_label,
    });

    let ortsname = ortsname(
        &state.pool,
        &state.karten_dir,
        ctx.einsatz.org_id,
        params.lat,
        params.lon,
    )
    .await?;

    Ok(Json(OrtVorschauAntwort { peilung, ortsname }))
}

/// Parameter des Einstiegs ohne Einsatz: kein `exclude`, es gibt keine Marker.
#[derive(Debug, Deserialize)]
pub struct OrtVorschauOrgParams {
    pub lat: f64,
    pub lon: f64,
}

/// GET /api/ort-vorschau?lat=&lon= — Ortsname ohne Einsatz (LLH-1376), Geocoder der eigenen
/// Organisation. Das Recht wird vor der Koordinate geprüft: ohne Recht 403, nie 400.
pub async fn in_org(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Query(params): Query<OrtVorschauOrgParams>,
) -> Result<Json<OrtVorschauAntwort>, AppError> {
    if !benutzer.darf_einsatz_anlegen() {
        return Err(AppError::Forbidden);
    }
    pruefe_koordinate(params.lat, params.lon)?;
    let ortsname = ortsname(
        &state.pool,
        &state.karten_dir,
        benutzer.org_id,
        params.lat,
        params.lon,
    )
    .await?;
    Ok(Json(OrtVorschauAntwort {
        peilung: None,
        ortsname,
    }))
}

/// Koordinaten-Plausibilität (400 bei out-of-range).
fn pruefe_koordinate(lat: f64, lon: f64) -> Result<(), AppError> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err(AppError::Validation(
            "lat/lon außerhalb des gültigen Bereichs".into(),
        ));
    }
    Ok(())
}

/// Ortsname best-effort beim Geocoder der Organisation `org_id`: `reverse()` liefert bei
/// offline/Timeout/Rate-Limit `None`, der Request wird nie wegen eines Geocoder-Fehlers
/// abgebrochen. Ein `Err` kommt nur aus den Org-Einstellungen (DB-Fehler = echter 500).
/// Der Reverse-Geocoding-Cache liegt in einer eigenen Cache-DB (F09/LFH-240: keine Konkurrenz um
/// den operativen Writer); Fallback auf den operativen Pool, falls sie nicht anlegbar ist.
async fn ortsname(
    pool: &SqlitePool,
    karten_dir: &Path,
    org_id: i64,
    lat: f64,
    lon: f64,
) -> Result<Option<String>, AppError> {
    let org = org_einst::laden_oder_default(pool, org_id).await?;
    let base = org
        .geocoder_url
        .as_deref()
        .unwrap_or(geocoding::NOMINATIM_DEFAULT);
    let cache = crate::cache_db::cache_pool(karten_dir).await;
    let cache_pool = cache.as_ref().unwrap_or(pool);
    Ok(geocoding::reverse(cache_pool, base, lat, lon).await)
}
