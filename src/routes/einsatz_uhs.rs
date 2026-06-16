use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::material::disposition_repo as material_repo;
use crate::material::EinsatzMaterialAnzeige;
use crate::person::{registrier_anzeige, repo as person_repo};
use crate::uhs::belegung_repo::{self, AustrittInfo};
use crate::uhs::platz_repo::{self, NeuerPlatz, PatchPlatz};
use crate::uhs::repo::{self as uhs_repo, NeueDaten, PatchDaten};
use crate::uhs::{
    darf_uebergehen, BelegungAnzeige, BelegungsArt, PlatzAnzeige, PlatzTyp, UhsAnzeige, UhsStatus,
    UhsTyp, Verfuegbarkeit,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Detail-Antwort: UHS-Stamm + Plätze + aktuelle Belegungen + zugeordnetes Material.
#[derive(Debug, Serialize)]
pub struct UhsDetail {
    #[serde(flatten)]
    pub uhs: UhsAnzeige,
    pub plaetze: Vec<PlatzAnzeige>,
    pub belegungen: Vec<BelegungAnzeige>,
    pub material: Vec<EinsatzMaterialAnzeige>,
}

// ---------- ETB-/SSE-Helfer (lokales Muster wie in anderen Routen) ----------

/// Schreibt einen automatischen System-ETB-Eintrag und publiziert ihn live
/// (identisch zu `routes::einsatz_material::etb_system`).
async fn etb_system(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    inhalt: &str,
) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

fn sse_uhs(state: &AppState, einsatz_id: i64, uhs_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "uhs_id": uhs_id }).to_string();
    state.live.publiziere_event(einsatz_id, "uhs", data);
}

fn sse_person(state: &AppState, einsatz_id: i64, person_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "person_id": person_id }).to_string();
    state.live.publiziere_event(einsatz_id, "person", data);
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Liest ein optional-nullable Feld so, dass JSON-`null` zu `Some(None)` und
/// fehlendes Feld zu `None` wird. Default-Serde-Verhalten unterscheidet das nicht.
/// (Wie in `routes::einsatz_material` — kleines Duplikat, kein eigenes Shared-Modul.)
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

// ============================== UHS-Routen ==============================

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub abschnitt_id: Option<i64>,
}

/// GET /api/einsaetze/{id}/uhs — Liste (Filter `?status=`, `?abschnitt_id=`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<UhsAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    if let Some(s) = &params.status {
        if UhsStatus::parse(s).is_none() {
            return Err(AppError::Validation("Unbekannter UHS-Status im Filter".into()));
        }
    }
    Ok(Json(
        uhs_repo::liste(
            &state.pool,
            einsatz_id,
            params.status.as_deref(),
            params.abschnitt_id,
        )
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub typ: String,
    pub bezeichnung: String,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<String>,
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/uhs — Anlegen (Status `geplant`). KEIN ETB-Eintrag
/// (Spec: erst die Inbetriebnahme ist lagerelevant). SSE.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<UhsAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if UhsTyp::parse(&body.typ).is_none() {
        return Err(AppError::Validation("Unbekannter UHS-Typ".into()));
    }
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    let standort = trimme(body.standort);
    let notiz = trimme(body.notiz);

    let uhs = uhs_repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        NeueDaten {
            typ: &body.typ,
            bezeichnung: &bezeichnung,
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_deref(),
            notiz: notiz.as_deref(),
        },
    )
    .await?;
    sse_uhs(&state, einsatz_id, uhs.id);
    Ok((StatusCode::CREATED, Json(uhs)))
}

/// GET /api/einsaetze/{id}/uhs/{uid} — Detail (Stamm + Plätze + Belegungen + Material).
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
) -> Result<Json<UhsDetail>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let uhs = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;
    let plaetze = platz_repo::liste_je_uhs(&state.pool, uhs_id).await?;
    let belegungen = belegung_repo::liste_je_uhs(&state.pool, uhs_id).await?;
    let material =
        material_repo::liste_je_uhs(&state.pool, einsatz_id, uhs_id, einsatz.ist_aktiv()).await?;
    Ok(Json(UhsDetail {
        uhs,
        plaetze,
        belegungen,
        material,
    }))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub bezeichnung: Option<String>,
    /// `Some(null)` = explizit löschen; absent = unverändert. Serde-Default = absent.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschnitt_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub standort: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
    /// lat/lon werden als Paar behandelt (Effektivzustand-Check im Handler). `Some(null)` = löschen.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
}

/// PATCH /api/einsaetze/{id}/uhs/{uid} — Stammfelder. KEIN ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<UhsAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let vorher = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?; // 404 falls fremd
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte UHS kann nicht geändert werden".into(),
        ));
    }

    // lat/lon als Paar: Effektivzustand nach dem Patch prüfen (422 statt 500).
    let eff_lat = match body.lat { Some(opt) => opt, None => vorher.lat };
    let eff_lon = match body.lon { Some(opt) => opt, None => vorher.lon };
    if eff_lat.is_some() != eff_lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
        ));
    }
    if let Some(la) = eff_lat {
        if !(-90.0..=90.0).contains(&la) {
            return Err(AppError::UnprocessableEntity("lat muss zwischen -90 und 90 liegen".into()));
        }
    }
    if let Some(lo) = eff_lon {
        if !(-180.0..=180.0).contains(&lo) {
            return Err(AppError::UnprocessableEntity("lon muss zwischen -180 und 180 liegen".into()));
        }
    }

    let bezeichnung = body
        .bezeichnung
        .as_deref()
        .map(str::trim)
        .map(str::to_string);
    if let Some(b) = &bezeichnung {
        if b.is_empty() {
            return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
        }
    }
    let standort = body
        .standort
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let notiz = body
        .notiz
        .map(|opt| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    let nachher = uhs_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        uhs_id,
        benutzer.id,
        PatchDaten {
            bezeichnung: bezeichnung.as_deref(),
            abschnitt_id: body.abschnitt_id,
            standort: standort.as_ref().map(|o| o.as_deref()),
            notiz: notiz.as_ref().map(|o| o.as_deref()),
            lat: body.lat,
            lon: body.lon,
        },
    )
    .await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(nachher))
}

#[derive(Debug, Deserialize)]
pub struct StatusBody {
    pub status: String,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/status — Status-Wechsel.
/// Ungültiger Übergang → 422. Auflösung bei aktiver Belegung → 409 (Repo).
/// ETB-Spur bei `→ aktiv` und `→ aufgeloest`. SSE.
pub async fn status_wechsel(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
    Json(body): Json<StatusBody>,
) -> Result<Json<UhsAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if UhsStatus::parse(&body.status).is_none() {
        return Err(AppError::Validation("Unbekannter Status".into()));
    }
    let vorher = uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierte UHS kann nicht geändert werden".into(),
        ));
    }
    if !darf_uebergehen(&vorher.status, &body.status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang {} → {} ist nicht erlaubt",
            vorher.status, body.status
        )));
    }
    let nachher =
        uhs_repo::setze_status(&state.pool, einsatz_id, uhs_id, &body.status, benutzer.id).await?;

    let typ_label = UhsTyp::parse(&nachher.typ)
        .map(|t| t.anzeige_label())
        .unwrap_or("");
    let etb_text = match body.status.as_str() {
        "aktiv" => Some(format!(
            "{} ({}) in Betrieb genommen",
            nachher.bezeichnung, typ_label
        )),
        "aufgeloest" => Some(format!("{} aufgelöst", nachher.bezeichnung)),
        _ => None,
    };
    if let Some(text) = etb_text {
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(nachher))
}

/// DELETE /api/einsaetze/{id}/uhs/{uid} — Soft-Delete. Blockt mit 409 bei aktiver
/// Belegung (Repo). KEIN ETB-Eintrag (Spec: nur Lifecycle aktiv/aufgeloest).
pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    uhs_repo::storniere(&state.pool, einsatz_id, uhs_id, benutzer.id).await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(StatusCode::NO_CONTENT)
}

// ============================== Platz-Routen ==============================

#[derive(Debug, Deserialize)]
pub struct PlatzAnlegenBody {
    pub typ: String,
    pub bezeichnung: String,
    pub pos_x: Option<f64>,
    pub pos_y: Option<f64>,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/plaetze — Platz anlegen. KEIN ETB. SSE.
pub async fn platz_anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id)): Path<(i64, i64)>,
    Json(body): Json<PlatzAnlegenBody>,
) -> Result<(StatusCode, Json<PlatzAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if PlatzTyp::parse(&body.typ).is_none() {
        return Err(AppError::Validation("Unbekannter Platz-Typ".into()));
    }
    let bezeichnung = body.bezeichnung.trim().to_string();
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    // Existenz der UHS im Einsatz prüfen (404 sonst):
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    let platz = platz_repo::anlegen(
        &state.pool,
        uhs_id,
        NeuerPlatz {
            typ: &body.typ,
            bezeichnung: &bezeichnung,
            pos_x: body.pos_x,
            pos_y: body.pos_y,
        },
    )
    .await?;
    let _ = benutzer; // benutzer.id wird hier nicht persistiert (kein Audit-Feld auf uhs_platz)
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok((StatusCode::CREATED, Json(platz)))
}

#[derive(Debug, Deserialize)]
pub struct PlatzPatchBody {
    pub bezeichnung: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub pos_x: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub pos_y: Option<Option<f64>>,
}

/// PATCH /api/einsaetze/{id}/uhs/{uid}/plaetze/{pid} — Bezeichnung / pos_x / pos_y.
/// KEIN ETB (interne Logistik). SSE.
pub async fn platz_aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id, pid)): Path<(i64, i64, i64)>,
    Json(body): Json<PlatzPatchBody>,
) -> Result<Json<PlatzAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    let bezeichnung = body
        .bezeichnung
        .as_deref()
        .map(str::trim)
        .map(str::to_string);
    if let Some(b) = &bezeichnung {
        if b.is_empty() {
            return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
        }
    }
    let platz = platz_repo::aktualisiere(
        &state.pool,
        uhs_id,
        pid,
        PatchPlatz {
            bezeichnung: bezeichnung.as_deref(),
            pos_x: body.pos_x,
            pos_y: body.pos_y,
        },
    )
    .await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(platz))
}

#[derive(Debug, Deserialize)]
pub struct VerfuegbarkeitBody {
    pub verfuegbarkeit: String,
    pub reserviert_fuer_person_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit — setzt
/// Verfügbarkeit (+ ggf. Reservierungs-Ziel). KEIN ETB. SSE.
pub async fn platz_verfuegbarkeit(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id, pid)): Path<(i64, i64, i64)>,
    Json(body): Json<VerfuegbarkeitBody>,
) -> Result<Json<PlatzAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    if Verfuegbarkeit::parse(&body.verfuegbarkeit).is_none() {
        return Err(AppError::Validation("Unbekannte Verfügbarkeit".into()));
    }
    // Bei Reservierung: Person muss zum Einsatz gehören (404 sonst).
    if body.verfuegbarkeit == "reserviert" {
        let pid_ziel = body.reserviert_fuer_person_id.ok_or_else(|| {
            AppError::Validation("Reservierung erfordert eine Ziel-Person".into())
        })?;
        person_repo::laden(&state.pool, einsatz_id, pid_ziel).await?;
    }
    let platz = platz_repo::setze_verfuegbarkeit(
        &state.pool,
        uhs_id,
        pid,
        &body.verfuegbarkeit,
        body.reserviert_fuer_person_id,
    )
    .await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(Json(platz))
}

/// DELETE /api/einsaetze/{id}/uhs/{uid}/plaetze/{pid} — Platz-Soft-Delete.
/// 409 bei aktiver Belegung. KEIN ETB. SSE.
pub async fn platz_stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, uhs_id, pid)): Path<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    uhs_repo::laden(&state.pool, einsatz_id, uhs_id).await?;

    platz_repo::storniere(&state.pool, uhs_id, pid).await?;
    sse_uhs(&state, einsatz_id, uhs_id);
    Ok(StatusCode::NO_CONTENT)
}

// ============================== Belegungs-Route ==============================

#[derive(Debug, Deserialize)]
pub struct BelegungBody {
    pub art: String,                  // "eintritt" | "wechsel" | "austritt"
    pub uhs_id: Option<i64>,          // erforderlich bei eintritt/wechsel
    pub platz_id: Option<i64>,        // optional (NULL = Inbox/Austritt)
    pub notiz: Option<String>,
}

/// POST /api/einsaetze/{id}/personen/{pid}/uhs-belegung — Belegungs-Event.
/// Repo macht alles transaktional inkl. ETB-relevanter Effekte. Hier nur die
/// pseudonyme ETB-Spur (Spec ETB-Tabelle) + zwei SSE-Events (`uhs` + `person`).
pub async fn belegung(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, person_id)): Path<(i64, i64)>,
    Json(body): Json<BelegungBody>,
) -> Result<(StatusCode, Json<BelegungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let art = BelegungsArt::parse(&body.art)
        .ok_or_else(|| AppError::Validation("Unbekannte Belegungs-Art".into()))?;
    let person = person_repo::laden(&state.pool, einsatz_id, person_id).await?;
    let notiz = trimme(body.notiz);

    // Für ETB-Texte brauchen wir den ehemaligen Platz/UHS (vor dem Event).
    let vorher_uhs = person.aktuelle_uhs_id;
    let vorher_platz = person.aktueller_platz_id;

    let event = match art {
        BelegungsArt::Eintritt => {
            let uhs = body.uhs_id.ok_or_else(|| {
                AppError::Validation("uhs_id ist bei eintritt erforderlich".into())
            })?;
            belegung_repo::eintritt(
                &state.pool,
                einsatz_id,
                person_id,
                uhs,
                body.platz_id,
                notiz.as_deref(),
                benutzer.id,
            )
            .await?
        }
        BelegungsArt::Wechsel => {
            let uhs = body.uhs_id.ok_or_else(|| {
                AppError::Validation("uhs_id ist bei wechsel erforderlich".into())
            })?;
            belegung_repo::wechsel(
                &state.pool,
                einsatz_id,
                person_id,
                uhs,
                body.platz_id,
                notiz.as_deref(),
                benutzer.id,
            )
            .await?
        }
        BelegungsArt::Austritt => {
            belegung_repo::austritt(
                &state.pool,
                einsatz_id,
                person_id,
                notiz.as_deref(),
                benutzer.id,
            )
            .await?
        }
    };

    // Pseudonyme ETB-Spur:
    let text = formatiere_belegungs_etb(
        &state.pool,
        person.registrier_nr,
        &event,
        art,
        vorher_uhs,
        vorher_platz,
    )
    .await?;
    if let Some(text) = text {
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_uhs(&state, einsatz_id, event.uhs_id);
    sse_person(&state, einsatz_id, person_id);
    Ok((StatusCode::CREATED, Json(event)))
}

/// Baut den pseudonymen ETB-Text gemäß Spec-Tabelle. Eigene Funktion, damit der
/// `auto_austritt`-Wrapper (unten) ihn wiederverwenden kann.
async fn formatiere_belegungs_etb(
    pool: &sqlx::SqlitePool,
    registrier_nr: i64,
    event: &BelegungAnzeige,
    art: BelegungsArt,
    vorher_uhs: Option<i64>,
    vorher_platz: Option<i64>,
) -> Result<Option<String>, AppError> {
    let r = registrier_anzeige(registrier_nr);
    let ziel_uhs = uhs_repo::laden(pool, event.einsatz_id, event.uhs_id).await?;
    let ziel_platz = match event.platz_id {
        Some(pid) => Some(platz_repo::laden(pool, event.uhs_id, pid).await?),
        None => None,
    };
    let text = match art {
        BelegungsArt::Eintritt => match &ziel_platz {
            Some(p) => format!(
                "Person {r}: Aufnahme in {} ({})",
                ziel_uhs.bezeichnung, p.bezeichnung
            ),
            None => format!("Person {r}: Aufnahme in {} (Inbox)", ziel_uhs.bezeichnung),
        },
        BelegungsArt::Wechsel => {
            let intern = vorher_uhs == Some(event.uhs_id);
            if intern {
                let von_label = match vorher_platz {
                    Some(vpid) => platz_repo::laden(pool, event.uhs_id, vpid)
                        .await
                        .ok()
                        .map(|p| p.bezeichnung)
                        .unwrap_or_else(|| "Inbox".into()),
                    None => "Inbox".into(),
                };
                let zu_label = ziel_platz
                    .as_ref()
                    .map(|p| p.bezeichnung.clone())
                    .unwrap_or_else(|| "Inbox".into());
                format!(
                    "Person {r}: Verlegung in {} ({} → {})",
                    ziel_uhs.bezeichnung, von_label, zu_label
                )
            } else {
                let von_bez = match vorher_uhs {
                    Some(id) => uhs_repo::laden(pool, event.einsatz_id, id)
                        .await
                        .ok()
                        .map(|u| u.bezeichnung)
                        .unwrap_or_default(),
                    None => String::new(),
                };
                let zu_label = ziel_platz
                    .as_ref()
                    .map(|p| format!(" ({})", p.bezeichnung))
                    .unwrap_or_default();
                format!(
                    "Person {r}: Verlegung {} → {}{}",
                    von_bez, ziel_uhs.bezeichnung, zu_label
                )
            }
        }
        BelegungsArt::Austritt => {
            let suffix = event
                .notiz
                .as_deref()
                .map(|n| format!(" ({n})"))
                .unwrap_or_default();
            format!("Person {r}: verlässt {}{}", ziel_uhs.bezeichnung, suffix)
        }
    };
    Ok(Some(text))
}

// ============================== Cross-Modul-Wrapper ==============================

/// Auto-Austritt-Wrapper für Cross-Modul-Hooks (E‑1-Status/E‑2-Verbleib/E‑1-Storno).
/// Ruft `belegung_repo::austritt_intern` und schreibt — falls ein Austritt-Event
/// passiert ist — den pseudonymen ETB-Eintrag mit Anlass-Notiz, plus SSE-Events.
/// Liefert `Ok(())` auch dann, wenn nichts zu tun war (Person nicht belegt + keine
/// Reservierung). **Wird sequentiell nach dem auslösenden Repo-Update gerufen
/// (Codebase-Konvention für Cross-Modul-Wirkung; akzeptiertes Risiko-Fenster).**
pub async fn auto_austritt(
    state: &AppState,
    einsatz_id: i64,
    person_id: i64,
    anlass: &str,
    benutzer_id: i64,
) -> Result<(), AppError> {
    let info: Option<AustrittInfo> = belegung_repo::austritt_intern(
        &state.pool,
        einsatz_id,
        person_id,
        Some(anlass),
        benutzer_id,
    )
    .await?;
    let Some(info) = info else {
        return Ok(()); // Person war nicht belegt — Reservierungs-Cleanup ist trotzdem gelaufen.
    };
    let person = person_repo::laden(&state.pool, einsatz_id, person_id).await?;
    let uhs = uhs_repo::laden(&state.pool, einsatz_id, info.uhs_id).await?;
    let r = registrier_anzeige(person.registrier_nr);
    let text = format!("Person {r}: verlässt {} ({anlass})", uhs.bezeichnung);
    etb_system(state, einsatz_id, benutzer_id, &text).await?;
    sse_uhs(state, einsatz_id, info.uhs_id);
    sse_person(state, einsatz_id, person_id);
    Ok(())
}

/// GET /api/einsaetze/{id}/uhs/stream — SSE-Stream. Nur Lesezugriff.
/// Der Client filtert clientseitig auf `uhs`- und `person`-Events.
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
