use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "lagekarte";
use crate::error::AppError;
use crate::lage_zone::repo::{self as zone_repo, ZoneNeu, ZonePatch};
use crate::lage_zone::{self, LageZoneAnzeige};
use crate::routes::support::{deserialize_optional_field, trimme, AnsichtFilter};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): eine Zone hat sich geändert. Event-Tag `lage_zone`.
fn sse_zone(state: &AppState, einsatz_id: i64, zid: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "zone_id": zid }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::LageZone, data);
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
    PfadParam(einsatz_id): PfadParam<i64>,
    Query(filter): Query<AnsichtFilter>,
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
    Ok(Json(
        zone_repo::liste(&state.pool, einsatz_id, filter.ansicht).await?,
    ))
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
    /// Ansichts-Zugehörigkeit (LFH-320): das FE sendet die aktive Ansicht; absent/NULL =
    /// auf allen Ansichten sichtbar.
    pub ansicht_id: Option<i64>,
}

/// Validiert typ/geometrie_typ/geometrie (statt DB-CHECK→500). Statuscodes nach der
/// Konvention aus CLAUDE.md: ein unbekannter Enum-Wert scheitert am Feld selbst → 400;
/// unpassende Typ-Geometrie-Kombination und kaputtes/abweichendes GeoJSON bewerten den
/// Zusammenhang → 422.
/// Liefert die zu speichernde Geometrie-String-Form zurück (= der validierte Eingabe-String).
fn validiere_neu(body: &ZoneBody) -> Result<String, AppError> {
    if lage_zone::LageZoneTyp::parse(&body.typ).is_none() {
        return Err(AppError::Validation(format!(
            "Unbekannter Zonen-Typ: {}",
            body.typ
        )));
    }
    if lage_zone::GeometrieTyp::parse(&body.geometrie_typ).is_none() {
        return Err(AppError::Validation(format!(
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
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(body): JsonBody<ZoneBody>,
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

    // F06/LFH-244 Tier-A: Zonen-INSERT (+ ggf. Gruppen-INSERT) + System-ETB-Eintrag atomar
    // in EINER Tx (BEGIN IMMEDIATE + Retry). Der In-Tx-Reload liefert die frische Anzeige für
    // ETB-Text (Typ-Label + Label) UND Response. SSE erst nach dem Commit (Reinheits-Kontrakt).
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let z = crate::write_retry!(&state.pool, |conn| {
        let id = zone_repo::anlegen_tx(
            conn,
            einsatz_id,
            ZoneNeu {
                typ: &body.typ,
                geometrie_typ: &body.geometrie_typ,
                geometrie: &geometrie,
                label: label.as_deref(),
                farbe: farbe.as_deref(),
                notiz: notiz.as_deref(),
                ansicht_id: body.ansicht_id,
                erstellt_von: benutzer.id,
            },
        )
        .await?;
        let z = zone_repo::laden_tx(conn, einsatz_id, id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
            startwert,
            &etb_text(z.typ.as_str(), z.label.as_deref(), "eingerichtet"),
        )
        .await?;
        Ok(z)
    })?;
    sse_zone(&state, einsatz_id, z.id);
    Ok((StatusCode::CREATED, Json(z)))
}

#[derive(Debug, Deserialize)]
pub struct ZonePatchBody {
    pub typ: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub label: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub farbe: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub notiz: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub gefahrengebiet_id: Option<Option<i64>>,
    /// Verschieben/Freigeben (LFH-320): absent = unverändert, `null` = auf alle Ansichten.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ansicht_id: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/zonen/{zid} — label/typ/farbe/notiz. Geometrie NICHT änderbar.
/// ETB „geändert" NUR wenn effektiver typ oder label sich gegenüber vorher unterscheidet.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, zid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<ZonePatchBody>,
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
            // Feld isoliert unbrauchbar → 400; die Passung zur gespeicherten Geometrie
            // darunter ist ein Zusammenhang → bleibt 422 (LFH-305).
            if lage_zone::LageZoneTyp::parse(t).is_none() {
                return Err(AppError::Validation(format!("Unbekannter Zonen-Typ: {t}")));
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
            ansicht_id: body.ansicht_id,
        },
    )
    .await?;

    // Sinntragende Änderung? typ oder label effektiv geändert.
    let typ_geaendert = neuer_typ != vorher.typ.as_str();
    let label_geaendert = neues_label != vorher.label;
    if typ_geaendert || label_geaendert {
        super::etb_system_degradiert(
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
                LiveEvent::Gefahr,
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
    PfadParam((einsatz_id, zid)): PfadParam<(i64, i64)>,
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

    // F06/LFH-244 Tier-A: Zonen-DELETE + System-ETB-Eintrag atomar in EINER Tx. Der ETB-Text
    // ist aus dem VOR der Tx geladenen `vorher` berechenbar (kein In-Tx-Reload nötig). Das
    // Aufräumen einer dadurch verwaisten Gefahrengebiet-Gruppe läuft NACH dem Commit auf dem
    // Pool (zweiter Writer — darf nicht in die BEGIN-IMMEDIATE-Tx). SSE ebenfalls nach dem Commit.
    let text = etb_text(vorher.typ.as_str(), vorher.label.as_deref(), "aufgehoben");
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    let gebiet_id = crate::write_retry!(&state.pool, |conn| {
        let gebiet_id = zone_repo::loese_auf_tx(conn, einsatz_id, zid).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(gebiet_id)
    })?;
    if let Some(g) = gebiet_id {
        crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(&state.pool, g).await?;
    }
    sse_zone(&state, einsatz_id, zid);
    Ok(StatusCode::NO_CONTENT)
}
