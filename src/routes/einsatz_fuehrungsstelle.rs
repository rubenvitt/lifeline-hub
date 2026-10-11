//! Die eigene Führungsstelle eines Einsatzes (LFH-849): `GET`/`PATCH
//! /api/einsaetze/{id}/fuehrungsstelle`.
//!
//! Lesen mit dem Einsatz (kein Modul), Schreiben mit den Rechten der Kopfdaten. Eine Änderung
//! meldet das Ereignis `einsatz` über `routes::einsatz::kopf_geaendert` (Spec `einsatzkopf-live`).
//! Herleitung: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D2, D3),
//! Art, Bezeichnung und Standort: `openspec/changes/lfh-1181-fuehrungsstelle-ort/design.md` (D1, D2).

use crate::app::AppState;
use crate::einsatz::fuehrungsstelle::{
    self, FuehrungsstelleAnzeige, FuehrungsstellePatch, FuehrungsstellenArt,
    FUEHRUNGSSTELLE_ADRESSE_MAX, FUEHRUNGSSTELLE_BEZEICHNUNG_MAX,
};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzVerwaltungszugriff};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::{
    deserialize_optional_field, hoechstens, parse_enum, pruefe_kommunikationsmittel,
    pruefe_koordinate, trimme_tri,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// PATCH-Body, Tri-State je Feld: absent = unverändert, `null`/`""` = leeren.
#[derive(Debug, Deserialize)]
pub struct FuehrungsstellePatchBody {
    /// `mobil` | `ortsfest`; `null` oder leer ist 400, denn die Art ist nie leer (D1).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub art: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bezeichnung: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort_adresse: Option<Option<String>>,
    /// Koordinate des Standorts; geprüft als Paar am Stand nach der Änderung (422).
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort_lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort_lon: Option<Option<f64>>,
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
    /// Dispositionszeilen, die die Führungsstelle tragen (LFH-1106); ersetzt wie
    /// `sprechgruppe_ids`.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub fahrzeug_ids: Option<Option<Vec<i64>>>,
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
    // Liste vor jedem Schreiben begrenzen (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
    let ids: Option<Vec<i64>> = body
        .sprechgruppe_ids
        .map(Option::unwrap_or_default)
        .map(crate::sprechgruppe::normalisiere_ids)
        .transpose()?;
    let fahrzeug_ids: Option<Vec<i64>> = body
        .fahrzeug_ids
        .map(Option::unwrap_or_default)
        .map(fuehrungsstelle::normalisiere_fahrzeug_ids)
        .transpose()?;
    // 400 je Feld vor jedem 422 des Zusammenhangs (`src/AGENTS.md`, Statuscode-Konvention).
    let art = trimme_tri(body.art)
        .map(|wert| {
            let wert =
                wert.ok_or_else(|| AppError::Validation("Art darf nicht leer sein".into()))?;
            parse_enum(
                FuehrungsstellenArt::parse,
                &wert,
                format!("Unbekannte Art der Führungsstelle: {wert}"),
            )
        })
        .transpose()?;
    let bezeichnung = trimme_tri(body.bezeichnung);
    if let Some(Some(b)) = &bezeichnung {
        hoechstens(b, "Bezeichnung", FUEHRUNGSSTELLE_BEZEICHNUNG_MAX)?;
    }
    let adresse = trimme_tri(body.standort_adresse);
    if let Some(Some(a)) = &adresse {
        hoechstens(a, "Adresse", FUEHRUNGSSTELLE_ADRESSE_MAX)?;
    }
    let rufname = trimme_tri(body.rufname);
    let mittel = trimme_tri(body.kommunikationsmittel);
    pruefe_kommunikationsmittel(mittel.as_ref().and_then(|v| v.as_deref()))?;
    let erreichbarkeit = trimme_tri(body.erreichbarkeit);
    // Ein leerer Patch ändert nichts: keine Zeile, kein Ereignis.
    if art.is_none()
        && bezeichnung.is_none()
        && adresse.is_none()
        && body.standort_lat.is_none()
        && body.standort_lon.is_none()
        && rufname.is_none()
        && mittel.is_none()
        && erreichbarkeit.is_none()
        && ids.is_none()
        && fahrzeug_ids.is_none()
    {
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
    if let Some(ids) = &fahrzeug_ids {
        fuehrungsstelle::pruefe_fahrzeuge(&state.pool, einsatz_id, ids).await?;
    }
    let patch = FuehrungsstellePatch {
        art,
        bezeichnung: bezeichnung.as_ref().map(|v| v.as_deref()),
        standort_adresse: adresse.as_ref().map(|v| v.as_deref()),
        standort_lat: body.standort_lat,
        standort_lon: body.standort_lon,
        rufname: rufname.as_ref().map(|v| v.as_deref()),
        kommunikationsmittel: mittel.as_ref().map(|v| v.as_deref()),
        erreichbarkeit: erreichbarkeit.as_ref().map(|v| v.as_deref()),
        sprechgruppe_ids: ids.as_deref(),
        fahrzeug_ids: fahrzeug_ids.as_deref(),
    };
    let koordinate_gesendet = body.standort_lat.is_some() || body.standort_lon.is_some();
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let neu = fuehrungsstelle::patchen_tx(conn, einsatz_id, &patch).await?;
        // Koordinate als Paar am Stand nach der Änderung, in derselben Transaktion (design.md
        // D2): zwei Teiländerungen nacheinander hinterlassen nie eine halbe Koordinate, und ein
        // Fehler rollt alles zurück.
        if koordinate_gesendet {
            pruefe_koordinate(neu.standort_lat, neu.standort_lon, "Breite", "Länge")?;
        }
        Ok(neu)
    })?;
    // Erst nach dem Commit (Reinheits-Kontrakt), wie jeder `einsatz`-Emitter.
    crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    Ok(Json(anzeige))
}

/// PUT /api/einsaetze/{id}/fuehrungsstelle/sprechgruppen/{sg} — eine Sprechgruppe zuordnen
/// (LFH-893, design.md D5). Idempotent; dieselbe Prüfung, Zuordnung und Live-Wirkung (`einsatz`)
/// wie der PATCH mit `sprechgruppe_ids`, kein ETB.
pub async fn sprechgruppe_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    PfadParam((_eid, sg)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ziel = crate::sprechgruppe::repo::Zuordnungsziel::Fuehrungsstelle(einsatz_id);
    if crate::sprechgruppe::repo::einzeln_zuordnen(
        &state.pool,
        ctx.einsatz.org_id,
        einsatz_id,
        ziel,
        sg,
    )
    .await?
    {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/fuehrungsstelle/sprechgruppen/{sg} — Zuordnung lösen, idempotent.
pub async fn sprechgruppe_loesen(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    PfadParam((_eid, sg)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ziel = crate::sprechgruppe::repo::Zuordnungsziel::Fuehrungsstelle(einsatz_id);
    if crate::sprechgruppe::repo::einzeln_loesen(&state.pool, einsatz_id, ziel, sg).await? {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    Ok(StatusCode::NO_CONTENT)
}
