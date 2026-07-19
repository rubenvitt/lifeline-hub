use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::extract::JsonBody;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "fahrzeuge";
use crate::error::AppError;
use crate::fahrzeug::besatzung_repo;
use crate::fahrzeug::disposition_repo::{self, AdhocDaten};
use crate::fahrzeug::status_repo;
use crate::fahrzeug::EinsatzFahrzeugAnzeige;
use crate::routes::support::trimme;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Fahrzeug-Disposition hat sich geändert.
fn sse_fahrzeug(state: &AppState, einsatz_id: i64, ef_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "fahrzeug_id": ef_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Fahrzeug, data);
}

/// SSE-Notify: disponierte Einsatzkraft aktualisieren (z.B. bei Besatzungs-Zuordnung/
/// -Freigabe). Lokaler Spiegel von `routes::einsatz_personal::sse_personal` (Tag `personal`).
fn sse_personal(state: &AppState, einsatz_id: i64, ep_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "personal_id": ep_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Personal, data);
}

/// GET /api/einsaetze/{id}/fahrzeuge — disponierte Fahrzeuge (aufgelöst). Nur Mitglieder/höhere Berechtigung.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<EinsatzFahrzeugAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    Ok(Json(
        disposition_repo::liste(&state.pool, einsatz_id, einsatz.ist_aktiv()).await?,
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
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    JsonBody(body): JsonBody<DisponierenBody>,
) -> Result<(StatusCode, Json<EinsatzFahrzeugAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

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
            let funkrufname = adhoc.funkrufname.trim().to_string();
            if funkrufname.is_empty() {
                return Err(AppError::Validation(
                    "Funkrufname darf nicht leer sein".into(),
                ));
            }
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
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let anzeige = crate::write_retry!(&state.pool, |conn| {
        let ef_id = match &vorbereitet {
            Vorbereitet::Stamm(fahrzeug_id) => {
                disposition_repo::disponiere_stamm_tx(
                    conn,
                    einsatz_id,
                    einsatz.org_id,
                    *fahrzeug_id,
                    benutzer.id,
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
                    einsatz.org_id,
                    AdhocDaten {
                        funkrufname: funkrufname.as_str(),
                        fahrzeugtyp: fahrzeugtyp.as_deref(),
                        kennzeichen: kennzeichen.as_deref(),
                        opta: opta.as_deref(),
                        traegerorganisation: traegerorganisation.as_deref(),
                    },
                    benutzer.id,
                )
                .await?
            }
        };
        let anzeige = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
            startwert,
            &format!("Fahrzeug «{}» disponiert", anzeige.funkrufname),
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
    pub bemerkung: Option<String>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id} — Status und/oder Bemerkung.
/// Status-Wechsel schreibt ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
    JsonBody(body): JsonBody<DispoPatchBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    // Status muss (aktiv) zur Org gehören.
    if let Some(sid) = body.status_id {
        if !status_repo::ist_in_org(&state.pool, einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }

    let vorher = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    // Bemerkung im Body gesetzt (auch "") → setzen (leer = löschen); absent/null →
    // unverändert lassen (COALESCE im Repo). Daher NICHT über `trimme` zu None kollabieren,
    // sonst ließe sich eine Bemerkung nie löschen.
    let bemerkung = body.bemerkung.as_deref().map(str::trim);

    // F06/LFH-244 Tier-A: Update + (bedingter) System-ETB atomar in EINER Tx. Der ETB-Text
    // braucht die frische Anzeige (neues Status-Label) → In-Tx-Reload. Der Vorzustand
    // (status_id/-label) stammt aus dem Vorlade-`vorher`. SSE erst nach dem Commit.
    let vorher_status_id = vorher.status_id;
    let vorher_status_label = vorher.status_label.clone();
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let nachher = crate::write_retry!(&state.pool, |conn| {
        disposition_repo::aktualisiere_tx(conn, einsatz_id, ef_id, body.status_id, bemerkung)
            .await?;
        let nachher = disposition_repo::laden_anzeige_tx(conn, einsatz_id, ef_id, true).await?;
        if vorher_status_id != nachher.status_id {
            let alt = vorher_status_label.as_deref().unwrap_or("—");
            let neu = nachher.status_label.as_deref().unwrap_or("—");
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                benutzer.id,
                startwert,
                &format!(
                    "Fahrzeug «{}»: Status «{}» → «{}»",
                    nachher.funkrufname, alt, neu
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
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let anzeige = disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, true).await?;
    // F06/LFH-244 Tier-A: Besatzungs-Freigabe + DELETE + System-ETB atomar in EINER Tx.
    // Der ETB-Text ist aus dem Vorlade-`anzeige` (funkrufname) VOR der Tx berechenbar.
    let text = format!(
        "Fahrzeug «{}» aus dem Einsatz entfernt",
        anzeige.funkrufname
    );
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        disposition_repo::entferne_tx(conn, einsatz_id, ef_id).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung/{ep_id} — Kraft als Besatzung
/// zuordnen (LFH-9, exklusiv: Wechsel überschreibt). Append-only System-ETB + SSE.
pub async fn besatzung_zuordnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id, ep_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    // Vorladen: aufgelöste Fahrzeug-Anzeige für den ETB-Text (funkrufname ist über die
    // Besatzungs-Zuordnung stabil). F06/LFH-244 Tier-A: Zuordnung + System-ETB atomar in EINER Tx.
    let fahrzeug =
        disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, einsatz.ist_aktiv())
            .await?;
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let person = besatzung_repo::ordne_besatzung_zu_tx(conn, einsatz_id, ef_id, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
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
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id, ep_id)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    // Vorladen: aufgelöste Fahrzeug-Anzeige für den ETB-Text (funkrufname ist über die
    // Besatzungs-Freigabe stabil). F06/LFH-244 Tier-A: Freigabe + System-ETB atomar in EINER Tx.
    let fahrzeug =
        disposition_repo::laden_anzeige(&state.pool, einsatz_id, ef_id, einsatz.ist_aktiv())
            .await?;
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let person = besatzung_repo::gib_besatzung_frei_tx(conn, einsatz_id, ef_id, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
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
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub lat: Option<Option<f64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub lon: Option<Option<f64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub tz_fachaufgabe: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub tz_organisation: Option<Option<String>>,
}

/// PATCH /api/einsaetze/{id}/fahrzeuge/{ef_id}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, ef_id)): Path<(i64, i64)>,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Json<EinsatzFahrzeugAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    // Effektivzustand für die Paar-Validierung: vorhandene lat/lon (404 falls fremd).
    let vorher: (Option<f64>, Option<f64>) =
        sqlx::query_as("SELECT lat, lon FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?")
            .bind(ef_id)
            .bind(einsatz_id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or(AppError::NotFound)?;
    let eff_lat = match body.lat {
        Some(o) => o,
        None => vorher.0,
    };
    let eff_lon = match body.lon {
        Some(o) => o,
        None => vorher.1,
    };
    if eff_lat.is_some() != eff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
        ));
    }
    if let Some(la) = eff_lat {
        if !(-90.0..=90.0).contains(&la) {
            return Err(AppError::UnprocessableEntity(
                "lat muss zwischen -90 und 90 liegen".into(),
            ));
        }
    }
    if let Some(lo) = eff_lon {
        if !(-180.0..=180.0).contains(&lo) {
            return Err(AppError::UnprocessableEntity(
                "lon muss zwischen -180 und 180 liegen".into(),
            ));
        }
    }

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
        einsatz.ist_aktiv(),
    )
    .await?;
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(Json(nachher))
}
