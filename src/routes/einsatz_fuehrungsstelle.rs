//! Die eigene Führungsstelle eines Einsatzes (LFH-849): `GET`/`PATCH
//! /api/einsaetze/{id}/fuehrungsstelle`.
//!
//! Lesen mit dem Einsatz (kein Modul), Schreiben mit den Rechten der Kopfdaten. Eine Änderung
//! meldet das Ereignis `einsatz` über `routes::einsatz::kopf_geaendert` (Spec `einsatzkopf-live`).
//! Herleitung: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D2, D3).

use crate::app::AppState;
use crate::einsatz::fuehrungsstelle::{self, FuehrungsstelleAnzeige, FuehrungsstellePatch};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzVerwaltungszugriff};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::routes::support::{deserialize_optional_field, pruefe_kommunikationsmittel, trimme_tri};
use axum::extract::State;
use axum::Json;
use serde::Deserialize;

/// PATCH-Body, Tri-State je Feld: absent = unverändert, `null`/`""` = leeren.
#[derive(Debug, Deserialize)]
pub struct FuehrungsstellePatchBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub rufname: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kommunikationsmittel: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub erreichbarkeit: Option<Option<String>>,
    /// Ersetzt die Zuordnung vollständig; `null` oder `[]` leert sie, absent lässt sie
    /// unverändert.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub sprechgruppe_ids: Option<Option<Vec<i64>>>,
}

/// GET /api/einsaetze/{id}/fuehrungsstelle — ohne erfasste Angaben alles leer (200).
pub async fn lesen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<FuehrungsstelleAnzeige>, AppError> {
    Ok(Json(
        fuehrungsstelle::laden(&state.pool, ctx.einsatz.id).await?,
    ))
}

/// PATCH /api/einsaetze/{id}/fuehrungsstelle — echter Teil-Patch. Prüfungen vor dem Schreiben,
/// das Schreiben in EINER Transaktion: ein Fehler speichert nichts teilweise.
pub async fn aendern(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    JsonBody(body): JsonBody<FuehrungsstellePatchBody>,
) -> Result<Json<FuehrungsstelleAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ids: Option<Vec<i64>> = body.sprechgruppe_ids.map(Option::unwrap_or_default);
    let rufname = trimme_tri(body.rufname);
    let mittel = trimme_tri(body.kommunikationsmittel);
    pruefe_kommunikationsmittel(mittel.as_ref().and_then(|v| v.as_deref()))?;
    let erreichbarkeit = trimme_tri(body.erreichbarkeit);
    // Ein leerer Patch ändert nichts: keine Zeile, kein Ereignis.
    if rufname.is_none() && mittel.is_none() && erreichbarkeit.is_none() && ids.is_none() {
        return Ok(Json(fuehrungsstelle::laden(&state.pool, einsatz_id).await?));
    }
    if let Some(ids) = &ids {
        crate::sprechgruppe::repo::pruefe_zuordenbar(
            &state.pool,
            ctx.einsatz.org_id,
            einsatz_id,
            ids,
        )
        .await?;
    }
    let patch = FuehrungsstellePatch {
        rufname: rufname.as_ref().map(|v| v.as_deref()),
        kommunikationsmittel: mittel.as_ref().map(|v| v.as_deref()),
        erreichbarkeit: erreichbarkeit.as_ref().map(|v| v.as_deref()),
        sprechgruppe_ids: ids.as_deref(),
    };
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        fuehrungsstelle::patchen_tx(conn, einsatz_id, &patch).await
    })?;
    // Erst nach dem Commit (Reinheits-Kontrakt), wie jeder `einsatz`-Emitter.
    crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    Ok(Json(anzeige))
}
