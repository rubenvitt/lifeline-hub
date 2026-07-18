use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "schaeden";
use crate::error::AppError;
use crate::person::repo as person_repo; // Org-Isolation der Geschädigt-FK (404 bei fremder Person)
use crate::routes::support::trimme;
use crate::schaden::{
    darf_uebergehen, ort_kurz, registrier_anzeige, repo as schaden_repo, AbschlussGrund, Ausmass,
    SchadenAnzeige, SchadenStatus, SchadenTyp,
};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::Stream;

// ---------- ETB-/SSE-Helfer ----------

fn sse_schaden(state: &AppState, einsatz_id: i64, schaden_id: i64) {
    let data =
        serde_json::json!({ "einsatz_id": einsatz_id, "schaden_id": schaden_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Schaden, data);
}

// ---------- GET /schaeden (Liste) ----------

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub geschaedigt_person_id: Option<i64>,
    #[serde(default)]
    pub inkl_storniert: bool,
}

pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<SchadenAnzeige>>, AppError> {
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

    if let Some(s) = &params.status {
        if SchadenStatus::parse(s).is_none() {
            return Err(AppError::UnprocessableEntity(
                "Unbekannter Status im Filter".into(),
            ));
        }
    }
    if let Some(t) = &params.typ {
        if SchadenTyp::parse(t).is_none() {
            return Err(AppError::UnprocessableEntity(
                "Unbekannter Typ im Filter".into(),
            ));
        }
    }
    if let Some(a) = &params.ausmass {
        if Ausmass::parse(a).is_none() {
            return Err(AppError::UnprocessableEntity(
                "Unbekanntes Ausmaß im Filter".into(),
            ));
        }
    }
    Ok(Json(
        schaden_repo::liste(
            &state.pool,
            einsatz_id,
            params.status.as_deref(),
            params.typ.as_deref(),
            params.ausmass.as_deref(),
            params.geschaedigt_person_id,
            params.inkl_storniert,
        )
        .await?,
    ))
}

// ---------- POST /schaeden (Anlegen) ----------

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub status: Option<String>,
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub ort: Option<String>,
    pub beschreibung: Option<String>,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<String>,
    pub geschaedigt_personal_id: Option<i64>,
    pub geschaedigt_organisation_id: Option<i64>,
}

pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<SchadenAnzeige>), AppError> {
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

    if let Some(s) = &body.status {
        if s != "offen" {
            return Err(AppError::UnprocessableEntity(
                "Schaden kann nur als 'offen' angelegt werden".into(),
            ));
        }
    }
    let typ = match body.typ.as_deref().and_then(SchadenTyp::parse) {
        Some(t) => t,
        None => {
            return Err(AppError::UnprocessableEntity(
                "Typ fehlt oder ist ungültig".into(),
            ))
        }
    };
    let ausmass = match body.ausmass.as_deref().and_then(Ausmass::parse) {
        Some(a) => a,
        None => {
            return Err(AppError::UnprocessableEntity(
                "Ausmaß fehlt oder ist ungültig".into(),
            ))
        }
    };
    let ort = match trimme(body.ort.clone()) {
        Some(o) => o,
        None => return Err(AppError::UnprocessableEntity("Ort ist Pflicht".into())),
    };
    let kontakt = trimme(body.geschaedigt_kontakt.clone());

    // Eigene Organisation: id wird IMMER serverseitig aus einsatz.org_id abgeleitet,
    // der vom Client gesendete Wert wird ignoriert (nie vertrauen).
    let org_gesetzt = body.geschaedigt_organisation_id.is_some();
    let geschaedigt_org_id = if org_gesetzt {
        Some(einsatz.org_id)
    } else {
        None
    };

    // 4‑Wege-Exklusivität: höchstens eine Geschädigt-Quelle.
    let anzahl_quellen = body.geschaedigt_person_id.is_some() as u8
        + body.geschaedigt_personal_id.is_some() as u8
        + org_gesetzt as u8
        + kontakt.is_some() as u8;
    if anzahl_quellen > 1 {
        return Err(AppError::UnprocessableEntity(
            "Höchstens eine Geschädigt-Quelle erlaubt".into(),
        ));
    }

    // Org-Isolation der FKs (404 bei fremder/unbekannter Person bzw. Einsatzkraft).
    if let Some(pid) = body.geschaedigt_person_id {
        person_repo::laden(&state.pool, einsatz_id, pid).await?;
    }
    if let Some(ep_id) = body.geschaedigt_personal_id {
        if !schaden_repo::personal_im_einsatz(&state.pool, einsatz_id, ep_id).await? {
            return Err(AppError::NotFound);
        }
    }
    let beschreibung = trimme(body.beschreibung.clone());

    // F06/LFH-244 Tier-A: Domänen-Write + System-ETB-Eintrag atomar in EINER Tx
    // (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige für ETB-Text
    // (Reg.-Nr.) UND Response. SSE erst nach dem Commit.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let schaden = crate::write_retry!(&state.pool, |conn| {
        let (id, _reg) = schaden_repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer.id,
            schaden_repo::NeueDaten {
                typ: typ.as_str(),
                ausmass: ausmass.as_str(),
                ort: &ort,
                beschreibung: beschreibung.as_deref(),
                geschaedigt_person_id: body.geschaedigt_person_id,
                geschaedigt_kontakt: kontakt.as_deref(),
                geschaedigt_personal_id: body.geschaedigt_personal_id,
                geschaedigt_organisation_id: geschaedigt_org_id,
            },
        )
        .await?;
        let schaden = schaden_repo::laden_tx(conn, einsatz_id, id).await?;
        let text = format!(
            "Schaden {} angelegt: {} ({}) — {}",
            registrier_anzeige(schaden.registrier_nr),
            typ.as_str(),
            ausmass.as_str(),
            ort_kurz(&ort),
        );
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(schaden)
    })?;
    sse_schaden(&state, einsatz_id, schaden.id);
    Ok((StatusCode::CREATED, Json(schaden)))
}

// ---------- GET /schaeden/{sid} (Detail) ----------

pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
) -> Result<Json<SchadenAnzeige>, AppError> {
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
        schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?,
    ))
}

// ---------- PATCH /schaeden/{sid} (Stammfelder) ----------

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub typ: Option<String>,
    pub ausmass: Option<String>,
    pub ort: Option<String>,
    pub beschreibung: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub geschaedigt_person_id: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub geschaedigt_kontakt: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub geschaedigt_personal_id: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub geschaedigt_organisation_id: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub uebergeben_an: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub abschluss_grund: Option<Option<String>>,
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
}

pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
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

    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter Schaden kann nicht geändert werden".into(),
        ));
    }

    // lat/lon als Paar: Effektivzustand nach dem Patch prüfen (422 statt 500).
    let eff_lat = match body.lat {
        Some(opt) => opt,
        None => vorher.lat,
    };
    let eff_lon = match body.lon {
        Some(opt) => opt,
        None => vorher.lon,
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

    if let Some(t) = &body.typ {
        if SchadenTyp::parse(t).is_none() {
            return Err(AppError::UnprocessableEntity("Ungültiger Typ".into()));
        }
    }
    if let Some(a) = &body.ausmass {
        if Ausmass::parse(a).is_none() {
            return Err(AppError::UnprocessableEntity("Ungültiges Ausmaß".into()));
        }
    }
    if let Some(Some(g)) = &body.abschluss_grund {
        if AbschlussGrund::parse(g.trim()).is_none() {
            return Err(AppError::UnprocessableEntity(
                "Ungültiger Abschlussgrund".into(),
            ));
        }
    }
    let ort_norm = trimme(body.ort.clone());
    if body.ort.is_some() && ort_norm.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Ort darf nicht leer sein".into(),
        ));
    }

    // Normalisierte Bindungen (müssen den `aktualisiere`-Aufruf überleben → eigene `let`s).
    let beschreibung_norm = trimme(body.beschreibung.clone());
    let kontakt_norm: Option<Option<String>> = body
        .geschaedigt_kontakt
        .map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let uebergeben_an_norm: Option<Option<String>> = body
        .uebergeben_an
        .map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    let abschluss_grund_norm: Option<Option<String>> = body
        .abschluss_grund
        .map(|o| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));

    // Eigene Organisation: der vom Client gesendete id-Wert wird ignoriert. Die Tri-State
    // wird auf die ABGELEITETE Org-id gemappt: Some(Some(_)) → Some(Some(einsatz.org_id)),
    // Some(None) → Some(None) (löschen), None → None (unverändert).
    let org_delta: Option<Option<i64>> = body
        .geschaedigt_organisation_id
        .map(|opt| opt.map(|_| einsatz.org_id));

    // Effektivzustand NACH dem Patch für ALLE VIER Quellen (4‑Wege-CHECK) → 422 statt 500.
    let eff_person: Option<i64> = match body.geschaedigt_person_id {
        Some(opt) => opt,
        None => vorher.geschaedigt_person_id,
    };
    let eff_personal: Option<i64> = match body.geschaedigt_personal_id {
        Some(opt) => opt,
        None => vorher.geschaedigt_personal_id,
    };
    let eff_org: Option<i64> = match org_delta {
        Some(opt) => opt,
        None => vorher.geschaedigt_organisation_id,
    };
    let eff_kontakt: Option<String> = match &kontakt_norm {
        Some(opt) => opt.clone(),
        None => vorher.geschaedigt_kontakt.clone(),
    };
    let anzahl_quellen = eff_person.is_some() as u8
        + eff_personal.is_some() as u8
        + eff_org.is_some() as u8
        + eff_kontakt.is_some() as u8;
    if anzahl_quellen > 1 {
        return Err(AppError::UnprocessableEntity(
            "Höchstens eine Geschädigt-Quelle erlaubt".into(),
        ));
    }
    let eff_uebergeben_an: Option<String> = match &uebergeben_an_norm {
        Some(opt) => opt.clone(),
        None => vorher.uebergeben_an.clone(),
    };
    let eff_abschluss_grund: Option<String> = match &abschluss_grund_norm {
        Some(opt) => opt.clone(),
        None => vorher.abschluss_grund.map(|g| g.as_str().to_string()),
    };
    if vorher.status == SchadenStatus::Uebergeben && eff_uebergeben_an.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Übergebener Schaden braucht einen Übergabe-Adressaten".into(),
        ));
    }
    if vorher.status == SchadenStatus::Abgeschlossen && eff_abschluss_grund.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Abgeschlossener Schaden braucht einen Abschlussgrund".into(),
        ));
    }

    if let Some(Some(pid)) = body.geschaedigt_person_id {
        person_repo::laden(&state.pool, einsatz_id, pid).await?; // Org-Isolation → 404
    }
    if let Some(Some(ep_id)) = body.geschaedigt_personal_id {
        if !schaden_repo::personal_im_einsatz(&state.pool, einsatz_id, ep_id).await? {
            return Err(AppError::NotFound); // Org-Isolation der Einsatzkraft → 404
        }
    }

    let schaden = schaden_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        schaden_id,
        benutzer.id,
        schaden_repo::PatchDaten {
            typ: body.typ.as_deref(),
            ausmass: body.ausmass.as_deref(),
            ort: ort_norm.as_deref(),
            beschreibung: beschreibung_norm.as_deref(),
            geschaedigt_person_id: body.geschaedigt_person_id,
            geschaedigt_kontakt: kontakt_norm.as_ref().map(|o| o.as_deref()),
            geschaedigt_personal_id: body.geschaedigt_personal_id,
            geschaedigt_organisation_id: org_delta,
            uebergeben_an: uebergeben_an_norm.as_ref().map(|o| o.as_deref()),
            abschluss_grund: abschluss_grund_norm.as_ref().map(|o| o.as_deref()),
            lat: body.lat,
            lon: body.lon,
        },
    )
    .await?;

    sse_schaden(&state, einsatz_id, schaden_id); // KEIN ETB bei Stammfeld-PATCH
    Ok(Json(schaden))
}

// ---------- POST /schaeden/{sid}/uebergeben ----------

#[derive(Debug, Deserialize)]
pub struct UebergebenBody {
    pub uebergeben_an: Option<String>,
}

pub async fn uebergeben(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
    Json(body): Json<UebergebenBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
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

    let adressat = match trimme(body.uebergeben_an.clone()) {
        Some(a) => a,
        None => {
            return Err(AppError::UnprocessableEntity(
                "Übergabe-Adressat ist Pflicht".into(),
            ))
        }
    };
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter Schaden kann nicht übergeben werden".into(),
        ));
    }
    if !darf_uebergehen(vorher.status.as_str(), "uebergeben") {
        return Err(AppError::Conflict(format!(
            "Schaden im Status '{}' kann nicht übergeben werden",
            vorher.status.as_str()
        )));
    }

    let text = format!(
        "Schaden {} übergeben an {}",
        registrier_anzeige(vorher.registrier_nr),
        adressat
    );
    // F06/LFH-244 Tier-A: Status-UPDATE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
    // ist aus `vorher` + `adressat` VOR der Tx berechenbar (kein In-Tx-Reload nötig). SSE +
    // Response-Reload erst nach dem Commit.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        schaden_repo::uebergebe_tx(conn, einsatz_id, schaden_id, &adressat, benutzer.id).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok(Json(
        schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?,
    ))
}

// ---------- POST /schaeden/{sid}/abschliessen ----------

#[derive(Debug, Deserialize)]
pub struct AbschliessenBody {
    pub abschluss_grund: Option<String>,
    pub notiz: Option<String>,
}

pub async fn abschliessen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
    Json(body): Json<AbschliessenBody>,
) -> Result<Json<SchadenAnzeige>, AppError> {
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

    let grund = match trimme(body.abschluss_grund.clone())
        .as_deref()
        .and_then(AbschlussGrund::parse)
    {
        Some(g) => g,
        None => {
            return Err(AppError::UnprocessableEntity(
                "Abschlussgrund ist Pflicht und muss gültig sein".into(),
            ))
        }
    };
    let notiz = trimme(body.notiz.clone());
    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter Schaden kann nicht abgeschlossen werden".into(),
        ));
    }
    if !darf_uebergehen(vorher.status.as_str(), "abgeschlossen") {
        return Err(AppError::Conflict(format!(
            "Schaden im Status '{}' kann nicht abgeschlossen werden",
            vorher.status.as_str()
        )));
    }

    let text = format!(
        "Schaden {} abgeschlossen ({})",
        registrier_anzeige(vorher.registrier_nr),
        grund.as_str()
    );
    // F06/LFH-244 Tier-A: Abschluss-UPDATE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
    // ist aus `vorher` + `grund` VOR der Tx berechenbar. SSE + Response-Reload erst nach Commit.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        schaden_repo::schliesse_ab_tx(
            conn,
            einsatz_id,
            schaden_id,
            grund.as_str(),
            notiz.as_deref(),
            benutzer.id,
        )
        .await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok(Json(
        schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?,
    ))
}

// ---------- DELETE /schaeden/{sid} (Stornieren) ----------

pub async fn stornieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, schaden_id)): Path<(i64, i64)>,
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

    let vorher = schaden_repo::laden(&state.pool, einsatz_id, schaden_id).await?; // 404
    if vorher.storniert_at.is_some() {
        return Err(AppError::Conflict("Schaden ist bereits storniert".into()));
    }
    // F06/LFH-244 Tier-A: Storno-UPDATE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
    // ist aus `vorher` VOR der Tx berechenbar. SSE erst nach dem Commit.
    let text = format!(
        "Schaden {} storniert",
        registrier_anzeige(vorher.registrier_nr)
    );
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        schaden_repo::storniere_tx(conn, einsatz_id, schaden_id, benutzer.id).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_schaden(&state, einsatz_id, schaden_id);
    Ok(StatusCode::NO_CONTENT)
}

// ---------- GET /schaeden/stream (SSE) ----------

pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
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

    let rx = state.live.abonniere(einsatz_id);
    let stream = crate::routes::support::sse_event_stream(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
