use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Material;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::material::disposition_repo::{self, AdhocDaten};
use crate::material::{EinsatzMaterialAnzeige, MaterialStatus};
use crate::routes::support::{deserialize_optional_field, pflicht, trimme, trimme_tri};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte/Meldebild): Material-Disposition hat sich geändert.
/// Wird unbedingt nach jeder Mutation gesendet — auch bei reinen Bemerkungs-/
/// UHS-Zuordnungs-Änderungen, die keinen ETB-Eintrag schreiben (LFH-66).
pub(super) fn sse_material(state: &AppState, einsatz_id: i64, em_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Material, "material_id", em_id);
}

/// GET /api/einsaetze/{id}/material — disponiertes Material (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Material>,
) -> Result<Json<Vec<EinsatzMaterialAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, ctx.einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub bezeichnung: String,
    pub kategorie: Option<String>,
    pub bestandsnummer: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub material_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
    pub menge: Option<i64>,
}

/// POST /api/einsaetze/{id}/material — Stamm-Material disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag (inkl. Menge).
pub async fn disponieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    JsonBody(body): JsonBody<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzMaterialAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let menge = body.menge.unwrap_or(1);
    if menge < 1 {
        return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
    }

    // Vor der Tx: XOR Stamm/Ad-hoc bestimmen + Ad-hoc-Felder validieren/trimmen (Reinheits-
    // Kontrakt: Validierung + Body-Konsum vor der Tx). Die Owned-Holder überleben die
    // write_retry!-Closure, die je Versuch `AdhocDaten` (Copy) aus dem `Ziel`-Enum kopiert.
    enum Ziel<'a> {
        Stamm(i64),
        Adhoc(AdhocDaten<'a>),
    }
    let bezeichnung_owned;
    let kategorie_owned;
    let bestandsnummer_owned;
    let traeger_owned;
    let ziel = match (body.material_id, body.adhoc) {
        (Some(material_id), None) => Ziel::Stamm(material_id),
        (None, Some(adhoc)) => {
            bezeichnung_owned = pflicht(&adhoc.bezeichnung, "Bezeichnung")?;
            kategorie_owned = trimme(adhoc.kategorie);
            bestandsnummer_owned = trimme(adhoc.bestandsnummer);
            traeger_owned = trimme(adhoc.traegerorganisation);
            Ziel::Adhoc(AdhocDaten {
                bezeichnung: &bezeichnung_owned,
                kategorie: kategorie_owned.as_deref(),
                bestandsnummer: bestandsnummer_owned.as_deref(),
                traegerorganisation: traeger_owned.as_deref(),
            })
        }
        _ => {
            return Err(AppError::Validation(
                "Entweder material_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    // F06/LFH-244 Tier-A: Domänen-Write + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige (bei Stamm-
    // Material stammt die Bezeichnung erst aus dem Snapshot des INSERT) für ETB-Text UND
    // Response. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let em_id = match &ziel {
            Ziel::Stamm(material_id) => {
                disposition_repo::disponiere_stamm_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    *material_id,
                    menge,
                    ctx.benutzer.id,
                )
                .await?
            }
            Ziel::Adhoc(daten) => {
                disposition_repo::disponiere_adhoc_tx(
                    conn,
                    einsatz_id,
                    *daten,
                    menge,
                    ctx.benutzer.id,
                )
                .await?
            }
        };
        let anzeige = disposition_repo::laden_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::material::etb_text_disponiert(&anzeige.bezeichnung, anzeige.menge),
        )
        .await?;
        Ok(anzeige)
    })?;
    sse_material(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub menge: Option<i64>,
    pub status: Option<String>,
    /// Tri-State (F12-c/LFH-266): fehlend = unverändert, `null`/`""` = leeren, Wert = setzen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub uhs_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/material/{em_id} — Menge und/oder Status und/oder Bemerkung.
/// Mengen-Änderung und Status-Wechsel schreiben je einen ETB-Eintrag; eine reine
/// Bemerkungsänderung schreibt keinen.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<DispoPatchBody>,
) -> Result<Json<EinsatzMaterialAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if let Some(menge) = body.menge {
        if menge < 1 {
            return Err(AppError::Validation("Menge muss mindestens 1 sein".into()));
        }
    }
    // Status validieren (festes Enum). Ungültig → Validation.
    let status = match &body.status {
        Some(s) => {
            let parsed = MaterialStatus::parse(s)
                .ok_or_else(|| AppError::Validation("Unbekannter Status".into()))?;
            Some(parsed.as_str())
        }
        None => None,
    };

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;
    // Bemerkung ist Tri-State (F12-c/LFH-266): absent = unverändert, `null` oder ""/Whitespace
    // = leeren (Spalte auf NULL), Wert = setzen. Das Trimmen/Leer-Kollabieren passiert hier in
    // der Route, das Repo bleibt dumm — wie bei `uhs_id`.
    let bemerkung = trimme_tri(body.bemerkung);
    let bemerkung = bemerkung.as_ref().map(|o| o.as_deref());

    // F06/LFH-244 Tier-A: Domänen-Update + die (bis zu zwei) System-ETB-Einträge atomar in
    // EINER Tx (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload (`nachher`) liefert die frischen
    // Werte für ETB-Texte UND Response; ein Menge-Wechsel und ein Status-Wechsel schreiben je
    // einen Eintrag (eine reine Bemerkungsänderung keinen). SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let nachher = crate::write_retry!(&state.pool, |conn| {
        disposition_repo::aktualisiere_tx(
            conn,
            einsatz_id,
            em_id,
            body.menge,
            status,
            bemerkung,
            body.uhs_id,
        )
        .await?;
        let nachher = disposition_repo::laden_anzeige_tx(conn, einsatz_id, em_id, true).await?;
        if vorher.menge != nachher.menge {
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                startwert,
                &format!(
                    "Material «{}»: Menge {} → {}",
                    nachher.bezeichnung, vorher.menge, nachher.menge
                ),
            )
            .await?;
        }
        if vorher.status != nachher.status {
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                startwert,
                &format!(
                    "Material «{}»: Status «{}» → «{}»",
                    nachher.bezeichnung,
                    vorher.status.as_str(),
                    nachher.status.as_str()
                ),
            )
            .await?;
        }
        Ok(nachher)
    })?;
    sse_material(&state, einsatz_id, em_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/material/{em_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Material>,
    PfadParam((_eid, em_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, em_id, true).await?;

    // F06/LFH-244 Tier-A: Löschung + System-ETB-Eintrag atomar in EINER Tx (BEGIN IMMEDIATE +
    // Retry). Der ETB-Text steht schon aus dem Vorzustand (`anzeige`, vor dem DELETE geladen)
    // fest → vor der Tx berechnet und in die Closure gecaptured. SSE erst nach dem Commit.
    let text = format!(
        "Material «{}» aus dem Einsatz entfernt",
        anzeige.bezeichnung
    );
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        disposition_repo::entferne_tx(conn, einsatz_id, em_id).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_material(&state, einsatz_id, em_id);
    Ok(StatusCode::NO_CONTENT)
}
