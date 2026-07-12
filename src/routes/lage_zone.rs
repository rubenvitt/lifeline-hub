use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "lagekarte";
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::lage_zone::repo::{self as zone_repo, ZoneNeu, ZonePatch};
use crate::lage_zone::{self, LageZoneAnzeige};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// Tri-State: JSON-`null` → `Some(None)`, fehlendes Feld → `None`.
fn deserialize_optional_field<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// SSE-Notify (Lage-Karte): eine Zone hat sich geändert. Event-Tag `lage_zone`.
fn sse_zone(state: &AppState, einsatz_id: i64, zid: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "zone_id": zid }).to_string();
    state.live.publiziere_event(einsatz_id, "lage_zone", data);
}

/// Schreibt einen System-ETB-Eintrag und publiziert ihn live (Muster wie einsatzabschnitt).
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

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// ETB-Wortlaut: «<Typ-Label> «Label» <verb>» bzw. ohne Label «<Typ-Label> <verb>».
fn etb_text(typ: &str, label: Option<&str>, verb: &str) -> String {
    match label {
        Some(l) => format!("{} «{}» {}", lage_zone::typ_label(typ), l, verb),
        None => format!("{} {}", lage_zone::typ_label(typ), verb),
    }
}

/// GET /api/einsaetze/{id}/zonen — Liste aller Zonen. Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<LageZoneAnzeige>>, AppError> {
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
    Ok(Json(zone_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct ZoneBody {
    pub typ: String,
    pub geometrie_typ: String,
    /// GeoJSON-Geometry als String (Hausmuster wie FlaecheBody.flaeche_geojson —
    /// das FE sendet JSON.stringify(g), die DB-Spalte ist TEXT).
    pub geometrie: String,
    pub label: Option<String>,
    pub farbe: Option<String>,
    pub notiz: Option<String>,
}

/// Validiert typ/geometrie_typ/geometrie und gibt 422 bei Verstoß (statt DB-CHECK→500).
/// Liefert die zu speichernde Geometrie-String-Form zurück (= der validierte Eingabe-String).
fn validiere_neu(body: &ZoneBody) -> Result<String, AppError> {
    if lage_zone::LageZoneTyp::parse(&body.typ).is_none() {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekannter Zonen-Typ: {}",
            body.typ
        )));
    }
    if lage_zone::GeometrieTyp::parse(&body.geometrie_typ).is_none() {
        return Err(AppError::UnprocessableEntity(format!(
            "Unbekannter Geometrie-Typ: {}",
            body.geometrie_typ
        )));
    }
    if !lage_zone::geometrie_klasse_passt(&body.typ, &body.geometrie_typ) {
        return Err(AppError::UnprocessableEntity(format!(
            "Typ {} ist mit Geometrie {} nicht zulässig",
            body.typ, body.geometrie_typ
        )));
    }
    // geometrie muss gültiges JSON und vom angegebenen geometrie_typ sein.
    let v: serde_json::Value = serde_json::from_str(&body.geometrie)
        .map_err(|_| AppError::UnprocessableEntity("geometrie ist kein gültiges JSON".into()))?;
    if v.get("type").and_then(|t| t.as_str()) != Some(body.geometrie_typ.as_str()) {
        return Err(AppError::UnprocessableEntity(
            "geometrie.type passt nicht zu geometrie_typ".into(),
        ));
    }
    Ok(body.geometrie.clone())
}

/// POST /api/einsaetze/{id}/zonen — anlegen. Schreibrecht + aktiv. ETB „eingerichtet".
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<ZoneBody>,
) -> Result<(StatusCode, Json<LageZoneAnzeige>), AppError> {
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

    let geometrie = validiere_neu(&body)?;

    let label = trimme(body.label.clone());
    let notiz = trimme(body.notiz.clone());
    // farbe nur für freie_skizze; sonst ignorieren (Stil aus typ abgeleitet).
    let farbe = if body.typ == "freie_skizze" {
        trimme(body.farbe.clone())
    } else {
        None
    };

    let z = zone_repo::anlegen(
        &state.pool,
        einsatz_id,
        ZoneNeu {
            typ: &body.typ,
            geometrie_typ: &body.geometrie_typ,
            geometrie: &geometrie,
            label: label.as_deref(),
            farbe: farbe.as_deref(),
            notiz: notiz.as_deref(),
            erstellt_von: benutzer.id,
        },
    )
    .await?;

    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &etb_text(z.typ.as_str(), z.label.as_deref(), "eingerichtet"),
    )
    .await?;
    sse_zone(&state, einsatz_id, z.id);
    Ok((StatusCode::CREATED, Json(z)))
}

#[derive(Debug, Deserialize)]
pub struct ZonePatchBody {
    pub typ: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub label: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub farbe: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub notiz: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub gefahrengebiet_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/zonen/{zid} — label/typ/farbe/notiz. Geometrie NICHT änderbar.
/// ETB „geändert" NUR wenn effektiver typ oder label sich gegenüber vorher unterscheidet.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
    Json(body): Json<ZonePatchBody>,
) -> Result<Json<LageZoneAnzeige>, AppError> {
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

    let vorher = zone_repo::laden(&state.pool, einsatz_id, zid).await?;

    // Effektiver neuer typ; wenn geändert: gültig + passt zur *gespeicherten* Geometrie.
    let neuer_typ = match &body.typ {
        Some(t) => {
            if lage_zone::LageZoneTyp::parse(t).is_none() {
                return Err(AppError::UnprocessableEntity(format!(
                    "Unbekannter Zonen-Typ: {t}"
                )));
            }
            if !lage_zone::geometrie_klasse_passt(t, &vorher.geometrie_typ) {
                return Err(AppError::UnprocessableEntity(format!(
                    "Typ {t} ist mit der vorhandenen Geometrie ({}) nicht zulässig",
                    vorher.geometrie_typ
                )));
            }
            t.clone()
        }
        None => vorher.typ.as_str().to_string(),
    };

    // Effektives label (getrimmt).
    let neues_label: Option<String> = match &body.label {
        Some(opt) => opt.clone().and_then(|s| trimme(Some(s))),
        None => vorher.label.clone(),
    };

    // farbe-Normalisierung: nur freie_skizze darf farbe tragen.
    let farbe_patch: Option<Option<&str>> = if neuer_typ != "freie_skizze" {
        Some(None) // beim Wechsel weg von freie_skizze farbe nullen
    } else {
        body.farbe.as_ref().map(|o| o.as_deref())
    };

    // Gruppen-Zuordnung: nur gefahrengebiet-Zonen; Merge-Ziel muss zum Einsatz gehören.
    let gebiet_patch: Option<Option<i64>> = match &body.gefahrengebiet_id {
        Some(Some(zielid)) => {
            if neuer_typ != "gefahrengebiet" {
                return Err(AppError::UnprocessableEntity(
                    "Gefahrengebiet-Zuordnung nur an gefahrengebiet-Zonen".into(),
                ));
            }
            crate::gefahr::repo::gebiet_laden(&state.pool, einsatz_id, *zielid).await?; // Ownership/NotFound
            Some(Some(*zielid))
        }
        Some(None) => Some(None), // in neue eigene Gruppe abspalten
        None => None,             // unverändert
    };

    let z = zone_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        zid,
        benutzer.id,
        ZonePatch {
            typ: body.typ.as_deref(),
            label: body
                .label
                .as_ref()
                .map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
            farbe: farbe_patch,
            notiz: body
                .notiz
                .as_ref()
                .map(|o| o.as_deref().map(str::trim).filter(|s| !s.is_empty())),
            gefahrengebiet_id: gebiet_patch,
        },
    )
    .await?;

    // Sinntragende Änderung? typ oder label effektiv geändert.
    let typ_geaendert = neuer_typ != vorher.typ.as_str();
    let label_geaendert = neues_label != vorher.label;
    if typ_geaendert || label_geaendert {
        etb_system(
            &state,
            einsatz_id,
            benutzer.id,
            &etb_text(z.typ.as_str(), z.label.as_deref(), "geändert"),
        )
        .await?;
    }

    sse_zone(&state, einsatz_id, zid);

    // Merge/Split hat die Gebiete-Liste verändert → zusätzlich gefahr-Event (Design-Spec).
    if gebiet_patch.is_some() {
        if let Some(gid) = z.gefahrengebiet_id {
            state.live.publiziere_event(
                einsatz_id,
                "gefahr",
                serde_json::json!({ "einsatz_id": einsatz_id, "gefahrengebiet_id": gid })
                    .to_string(),
            );
        }
    }

    Ok(Json(z))
}

/// DELETE /api/einsaetze/{id}/zonen/{zid} — aufheben (Hard-Delete). ETB „aufgehoben".
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
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

    let vorher = zone_repo::laden(&state.pool, einsatz_id, zid).await?;
    zone_repo::loese_auf(&state.pool, einsatz_id, zid).await?;
    etb_system(
        &state,
        einsatz_id,
        benutzer.id,
        &etb_text(vorher.typ.as_str(), vorher.label.as_deref(), "aufgehoben"),
    )
    .await?;
    sse_zone(&state, einsatz_id, zid);
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/einsaetze/{id}/zonen/stream — SSE (ganzer Einsatz-Kanal). Nur Lesezugriff;
/// das Frontend filtert per Event-Name (`lage_zone`).
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
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
