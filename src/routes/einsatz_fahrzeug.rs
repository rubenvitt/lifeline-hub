use super::einsatz_personal::sse_personal;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Fahrzeuge;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::fahrzeug::besatzung_repo;
use crate::fahrzeug::disposition_repo::{self, AdhocDaten};
use crate::fahrzeug::status_repo;
use crate::fahrzeug::EinsatzFahrzeugAnzeige;
use crate::live::LiveEvent;
use crate::routes::support::{
    deserialize_optional_field, pflicht, pruefe_koordinate, trimme, trimme_tri,
};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Fahrzeug-Disposition hat sich geändert.
pub(super) fn sse_fahrzeug(state: &AppState, einsatz_id: i64, ef_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Fahrzeug, "fahrzeug_id", ef_id);
}

/// GET /api/einsaetze/{id}/fahrzeuge — disponierte Fahrzeuge (aufgelöst). Nur Mitglieder/höhere Berechtigung.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Fahrzeuge>,
) -> Result<Json<Vec<EinsatzFahrzeugAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, ctx.einsatz.ist_aktiv()).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AdhocBody {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub traegerorganisation: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DisponierenBody {
    pub fahrzeug_id: Option<i64>,
    pub adhoc: Option<AdhocBody>,
}

/// POST /api/einsaetze/{id}/fahrzeuge — Stamm-Fahrzeug disponieren ODER Ad-hoc anlegen.
/// Schreibberechtigt + aktiver Einsatz. Schreibt ETB-Eintrag.
pub async fn disponieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    JsonBody(body): JsonBody<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzFahrzeugAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Validierung + Aufbereitung VOR der Tx (Vorladen/Guards bleiben außerhalb des Tx-Bodys).
    enum Vorbereitet {
        Stamm(i64),
        Adhoc {
            funkrufname: String,
            fahrzeugtyp: Option<String>,
            kennzeichen: Option<String>,
            opta: Option<String>,
            traegerorganisation: Option<String>,
        },
    }
    let vorbereitet = match (body.fahrzeug_id, body.adhoc) {
        (Some(fahrzeug_id), None) => Vorbereitet::Stamm(fahrzeug_id),
        (None, Some(adhoc)) => {
            let funkrufname = pflicht(&adhoc.funkrufname, "Funkrufname")?;
            Vorbereitet::Adhoc {
                funkrufname,
                fahrzeugtyp: trimme(adhoc.fahrzeugtyp),
                kennzeichen: trimme(adhoc.kennzeichen),
                opta: trimme(adhoc.opta),
                traegerorganisation: trimme(adhoc.traegerorganisation),
            }
        }
        (None, None) => {
            return Err(AppError::Validation(
                "Entweder fahrzeug_id (Stamm) oder adhoc angeben".into(),
            ))
        }
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "Entweder fahrzeug_id (Stamm) oder adhoc angeben, nicht beides".into(),
            ))
        }
    };

    // F06/LFH-244 Tier-A: Domänen-Write (Disposition) + System-ETB atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die aufgelöste Anzeige (funkrufname)
    // für ETB-Text UND Response. SSE erst nach dem Commit (Reinheits-Kontrakt).
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let ef_id = match &vorbereitet {
            Vorbereitet::Stamm(fahrzeug_id) => {
                disposition_repo::disponiere_stamm_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    *fahrzeug_id,
                    ctx.benutzer.id,
                )
                .await?
            }
            Vorbereitet::Adhoc {
                funkrufname,
                fahrzeugtyp,
                kennzeichen,
                opta,
                traegerorganisation,
            } => {
                disposition_repo::disponiere_adhoc_tx(
                    conn,
                    einsatz_id,
                    ctx.einsatz.org_id,
                    AdhocDaten {
                        funkrufname: funkrufname.as_str(),
                        fahrzeugtyp: fahrzeugtyp.as_deref(),
                        kennzeichen: kennzeichen.as_deref(),
                        opta: opta.as_deref(),
                        traegerorganisation: traegerorganisation.as_deref(),
                    },
                    ctx.benutzer.id,
                )
                .await?
            }
        };
        let anzeige = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::fahrzeug::etb_text_disponiert(&anzeige.funkrufname),
        )
        .await?;
        Ok(anzeige)
    })?;
    sse_fahrzeug(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

#[derive(Debug, Deserialize)]
pub struct DispoPatchBody {
    pub status_id: Option<i64>,
    /// Tri-State (F12-c/LFH-266): fehlend = unverändert, `null`/`""` = leeren, Wert = setzen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id} — Status und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<DispoPatchBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Status muss (aktiv) zur Org gehören.
    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, ctx.einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    // Bemerkung ist Tri-State (F12-c/LFH-266): absent = unverändert, `null` oder ""/Whitespace
    // = leeren (Spalte auf NULL), Wert = setzen. Das Trimmen/Leer-Kollabieren passiert hier in
    // der Route, das Repo bleibt dumm.
    let bemerkung = trimme_tri(body.bemerkung);
    let bemerkung = bemerkung.as_ref().map(|o| o.as_deref());

    // F06/LFH-244 Tier-A: Update + (bedingter) System-ETB atomar in EINER Tx. Der ETB-Text
    // braucht die frische Anzeige (neues Status-Label) → In-Tx-Reload. Der Vorzustand
    // (status_id/-label) stammt aus dem Vorlade-`vorher`. SSE erst nach dem Commit.
    let vorher_status_id = vorher.status_id;
    let vorher_status_label = vorher.status_label.clone();
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let nachher = crate::write_retry!(&state.pool, |conn| {
        disposition_repo::aktualisiere_tx(conn, einsatz_id, ef_id, body.status_id, bemerkung)
            .await?;
        let nachher = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        if vorher_status_id != nachher.status_id {
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                startwert,
                &crate::fahrzeug::etb_text_status_wechsel(
                    &nachher.funkrufname,
                    vorher_status_label.as_deref(),
                    nachher.status_label.as_deref(),
                ),
            )
            .await?;
        }
        Ok(nachher)
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/fahrzeuge/{ef_id} — aus dem Einsatz entfernen. Schreibt ETB-Eintrag.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    // F06/LFH-244 Tier-A: Besatzungs-Freigabe + DELETE + System-ETB atomar in EINER Tx.
    // Der ETB-Text ist aus dem Vorlade-`anzeige` (funkrufname) VOR der Tx berechenbar.
    let text = format!(
        "Fahrzeug «{}» aus dem Einsatz entfernt",
        anzeige.funkrufname
    );
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        disposition_repo::entferne_tx(conn, einsatz_id, ef_id).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, ctx.benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung/{ep_id} — Kraft als Besatzung
/// zuordnen (LFH-9, exklusiv: Wechsel überschreibt). Append-only System-ETB + SSE.
pub async fn besatzung_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Vorladen: aufgelöste Fahrzeug-Anzeige für den ETB-Text (funkrufname ist über die
    // Besatzungs-Zuordnung stabil). F06/LFH-244 Tier-A: Zuordnung + System-ETB atomar in EINER Tx.
    let fahrzeug =
        disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, ctx.einsatz.ist_aktiv())
            .await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let person = besatzung_repo::ordne_besatzung_zu_tx(conn, einsatz_id, ef_id, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!(
                "Fahrzeug «{}»: «{}» als Besatzung zugeordnet",
                fahrzeug.funkrufname, person
            ),
        )
        .await?;
        Ok(())
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung/{ep_id} — Kraft aus der
/// Fahrzeug-Besatzung freigeben (LFH-9). Append-only System-ETB + SSE.
pub async fn besatzung_freigeben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Vorladen: aufgelöste Fahrzeug-Anzeige für den ETB-Text (funkrufname ist über die
    // Besatzungs-Freigabe stabil). F06/LFH-244 Tier-A: Freigabe + System-ETB atomar in EINER Tx.
    let fahrzeug =
        disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, ctx.einsatz.ist_aktiv())
            .await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let person = besatzung_repo::gib_besatzung_frei_tx(conn, einsatz_id, ef_id, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!(
                "Fahrzeug «{}»: «{}» aus der Besatzung freigegeben",
                fahrzeug.funkrufname, person
            ),
        )
        .await?;
        Ok(())
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct PositionBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Fahrzeuge>,
    PfadParam((_eid, ef_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Effektivzustand für die Paar-Validierung: vorhandene lat/lon (404 falls fremd).
    let vorher: (Option<f64>, Option<f64>) =
        sqlx::query_as("SELECT lat, lon FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?")
            .bind(ef_id)
            .bind(einsatz_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    let eff_lat = body.lat.unwrap_or(vorher.0);
    let eff_lon = body.lon.unwrap_or(vorher.1);
    pruefe_koordinate(eff_lat, eff_lon, "lat", "lon")?;

    let nachher = disposition_repo::aktualisiere_position(
        &state.pool,
        einsatz_id,
        ef_id,
        disposition_repo::PositionPatch {
            lat: body.lat,
            lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
        ctx.einsatz.ist_aktiv(),
    )
    .await?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(nachher))
}
