use super::einsatz_fahrzeug::sse_fahrzeug;
use super::einsatz_material::sse_material;
use super::einsatz_personal::sse_personal;
use crate::app::AppState;
use crate::einheit::repo::{self as einheit_repo, EinheitDaten, EinheitPatch};
use crate::einheit::{mitglied_repo, EinheitAnzeige};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Einheiten;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;
use crate::routes::support::{
    deserialize_optional_field, pflicht, pruefe_kommunikationsmittel, pruefe_koordinate, trimme,
    trimme_tri,
};
use crate::staerke::Staerke;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Einheit hat sich geändert. Frontend filtert per Event-Name.
fn sse_einheit(state: &AppState, einsatz_id: i64, einheit_id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Einheit, "einheit_id", einheit_id);
}

/// Lädt nur den Einheiten-Namen (für ETB-Texte); `NotFound`, falls nicht zum Einsatz.
async fn einheit_name(state: &AppState, einsatz_id: i64, eid: i64) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(eid)
    .bind(einsatz_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// GET /api/einsaetze/{id}/einheiten — Liste (aufgelöst). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Einheiten>,
) -> Result<Json<Vec<EinheitAnzeige>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    Ok(Json(einheit_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct EinheitBody {
    pub name: String,
    pub abschnitt_id: Option<i64>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub fuehrer_id: Option<i64>,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub bemerkung: Option<String>,
    /// LFH-614: eigener Funkrufname der Einheit (Freitext, leer = nicht gepflegt).
    pub funkrufname: Option<String>,
    /// LFH-108: Funk/Kommunikation — Freitext-Schlüssel (digitalfunk/mobil/festnetz).
    pub kommunikationsmittel: Option<String>,
    /// LFH-108: Funk/Kommunikation — Rufnummer/Freitext (PII).
    pub erreichbarkeit: Option<String>,
    #[serde(default)]
    pub sortier: i64,
    pub sprechgruppe_ids: Option<Vec<i64>>,
}

/// POST /api/einsaetze/{id}/einheiten — Einheit bilden. ETB-Eintrag.
pub async fn bilden(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    JsonBody(body): JsonBody<EinheitBody>,
) -> Result<(StatusCode, Json<EinheitAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let name = pflicht(&body.name, "Name")?;
    Staerke::aus_optionen(
        body.soll_fuehrer,
        body.soll_unterfuehrer,
        body.soll_mannschaft,
    )
    .map_err(AppError::Validation)?;
    let bemerkung = trimme(body.bemerkung);
    let funkrufname = trimme(body.funkrufname);
    let kommunikationsmittel = trimme(body.kommunikationsmittel);
    pruefe_kommunikationsmittel(kommunikationsmittel.as_deref())?;
    let erreichbarkeit = trimme(body.erreichbarkeit);
    let anzeige = einheit_repo::anlegen(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        EinheitDaten {
            name: &name,
            abschnitt_id: body.abschnitt_id,
            ueber_einheit_id: body.ueber_einheit_id,
            typ_id: body.typ_id,
            soll_fuehrer: body.soll_fuehrer,
            soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft,
            bemerkung: bemerkung.as_deref(),
            funkrufname: funkrufname.as_deref(),
            kommunikationsmittel: kommunikationsmittel.as_deref(),
            erreichbarkeit: erreichbarkeit.as_deref(),
            sortier: body.sortier,
        },
        ctx.benutzer.id,
    )
    .await?;
    if let Some(ids) = &body.sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_einheit_sprechgruppen(
            &state.pool,
            ctx.einsatz.org_id,
            einsatz_id,
            anzeige.id,
            ids,
        )
        .await?;
    }
    let anzeige = einheit_repo::laden(&state.pool, einsatz_id, anzeige.id).await?;
    super::etb_system_degradiert(
        &state,
        einsatz_id,
        ctx.benutzer.id,
        &crate::einheit::etb_text_gebildet(&anzeige.name),
    )
    .await;
    sse_einheit(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH-Body (LFH-306, Tri-State): jedes Feld optional, absent = unverändert,
/// `null` = leeren. Getrennt von [`EinheitBody`], damit der POST sein Pflicht-`name`
/// strukturell erzwingt.
///
/// **Kein `#[serde(default)]` an `sortier`** — das machte aus „nicht gesendet" ein
/// „auf 0 setzen". `sprechgruppe_ids` ist bereits als `Option<Vec<i64>>` tri-state
/// (absent = Zuordnung unverändert, `Some(vec)` ersetzt die Menge vollständig) und
/// war schon vor LFH-306 das Vorbild im Haus.
#[derive(Debug, Deserialize)]
pub struct EinheitPatchBody {
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschnitt_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ueber_einheit_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub typ_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub fuehrer_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_fuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_unterfuehrer: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub soll_mannschaft: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub bemerkung: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub funkrufname: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub kommunikationsmittel: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub erreichbarkeit: Option<Option<String>>,
    pub sortier: Option<i64>,
    pub sprechgruppe_ids: Option<Vec<i64>>,
}

/// PATCH /api/einsaetze/{id}/einheiten/{eid} — echter Teil-Patch (LFH-306) inkl.
/// authoritativem `fuehrer_id`. Führer-Wechsel und Abschnitts-Zuordnungs-Änderung
/// schreiben je einen ETB-Eintrag.
pub async fn aktualisieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<EinheitPatchBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let name = match body.name {
        Some(n) => {
            let n = pflicht(&n, "Name")?;
            Some(n)
        }
        None => None,
    };

    let vorher = einheit_repo::laden(&state.pool, einsatz_id, eid).await?;
    // Das Soll-Trio trägt die Mehrspalten-Invariante „alle drei oder keiner" und wird
    // deshalb gegen den EFFEKTIVZUSTAND geprüft (Patch gewinnt, sonst Bestand) — sonst
    // lehnte `{"soll_mannschaft":20}` auf eine Zeile mit vollem Trio als „halb geleert" ab.
    // Geschrieben wird trotzdem nur der Patch, nie das gemergte Trio.
    let bestand_soll = einheit_repo::soll_roh(&state.pool, einsatz_id, eid).await?;
    let effektiv = |patch: Option<Option<i64>>, gespeichert: Option<i64>| match patch {
        Some(v) => v,
        None => gespeichert,
    };
    Staerke::aus_optionen(
        effektiv(body.soll_fuehrer, bestand_soll.0),
        effektiv(body.soll_unterfuehrer, bestand_soll.1),
        effektiv(body.soll_mannschaft, bestand_soll.2),
    )
    .map_err(AppError::Validation)?;

    let bemerkung = trimme_tri(body.bemerkung);
    let funkrufname = trimme_tri(body.funkrufname);
    let kommunikationsmittel = trimme_tri(body.kommunikationsmittel);
    pruefe_kommunikationsmittel(kommunikationsmittel.as_ref().and_then(|v| v.as_deref()))?;
    let erreichbarkeit = trimme_tri(body.erreichbarkeit);

    // Führerwechsel heißt jetzt „Feld im Patch enthalten UND Wert verschieden". Ein Patch
    // OHNE `fuehrer_id` (so ruft die Einheiten-Seite an) darf keinen Führerwechsel auf
    // `None` samt ETB-Eintrag auslösen — unter dem alten Vollersatz tat er genau das.
    let fuehrer_neu = body.fuehrer_id;
    let fuehrer_wechsel = matches!(fuehrer_neu, Some(neu) if neu != vorher.fuehrer_id);
    // Führer-Gültigkeit VOR jeglichem Write prüfen, damit ein ungültiger Führer
    // (Nicht-Mitglied) kein Teil-Update der übrigen Felder hinterlässt.
    if fuehrer_wechsel {
        einheit_repo::pruefe_fuehrer(&state.pool, einsatz_id, eid, fuehrer_neu.flatten()).await?;
    }
    let nachher = einheit_repo::patche(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        eid,
        EinheitPatch {
            name: name.as_deref(),
            abschnitt_id: body.abschnitt_id,
            ueber_einheit_id: body.ueber_einheit_id,
            typ_id: body.typ_id,
            soll_fuehrer: body.soll_fuehrer,
            soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft,
            bemerkung: bemerkung.as_ref().map(|v| v.as_deref()),
            funkrufname: funkrufname.as_ref().map(|v| v.as_deref()),
            kommunikationsmittel: kommunikationsmittel.as_ref().map(|v| v.as_deref()),
            erreichbarkeit: erreichbarkeit.as_ref().map(|v| v.as_deref()),
            sortier: body.sortier,
        },
    )
    .await?;

    // Führer authoritativ setzen (Mitgliedschaft bereits geprüft) + ETB bei Änderung.
    if fuehrer_wechsel {
        einheit_repo::setze_fuehrer(&state.pool, einsatz_id, eid, fuehrer_neu.flatten()).await?;
    }
    if let Some(ids) = &body.sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_einheit_sprechgruppen(
            &state.pool,
            ctx.einsatz.org_id,
            einsatz_id,
            eid,
            ids,
        )
        .await?;
    }
    // Endgültige Anzeige (inkl. neu aufgelöstem Führer-Namen und Sprechgruppen).
    let final_anzeige = einheit_repo::laden(&state.pool, einsatz_id, eid).await?;

    if fuehrer_wechsel {
        let inhalt = match (&vorher.fuehrer_name, &final_anzeige.fuehrer_name) {
            (None, Some(neu)) => format!(
                "Einheit «{}»: Einheitsführer «{}» gesetzt",
                final_anzeige.name, neu
            ),
            (Some(alt), Some(neu)) => format!(
                "Einheit «{}»: Einheitsführer «{}» → «{}»",
                final_anzeige.name, alt, neu
            ),
            (Some(alt), None) => format!(
                "Einheit «{}»: Einheitsführer «{}» entfernt",
                final_anzeige.name, alt
            ),
            (None, None) => String::new(),
        };
        if !inhalt.is_empty() {
            super::etb_system_degradiert(&state, einsatz_id, ctx.benutzer.id, &inhalt).await;
        }
    }
    if vorher.abschnitt_id != nachher.abschnitt_id {
        let inhalt = match &nachher.abschnitt_name {
            Some(a) => format!("Einheit «{}»: Abschnitt «{}» zugeordnet", nachher.name, a),
            None => format!("Einheit «{}»: Abschnittszuordnung aufgehoben", nachher.name),
        };
        super::etb_system_degradiert(&state, einsatz_id, ctx.benutzer.id, &inhalt).await;
    }
    sse_einheit(&state, einsatz_id, eid);
    Ok(Json(final_anzeige))
}

/// DELETE /api/einsaetze/{id}/einheiten/{eid} — auflösen. ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let name = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Auflösung (Freigaben + Hochzug + Löschung) + System-ETB-Eintrag
    // atomar in EINER Tx. SSE erst nach dem Commit.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        einheit_repo::loese_auf_tx(conn, einsatz_id, eid).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!("Einheit «{}» aufgelöst", name),
        )
        .await?;
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/personal/{ep_id} — Person zuordnen. ETB-Eintrag.
pub async fn personal_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Zuordnung (inkl. Stale-Führer-Bereinigung) + System-ETB-Eintrag
    // atomar in EINER Tx. Der Personalname kommt aus dem Write und speist den ETB-Text.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let person = mitglied_repo::ordne_personal_zu_tx(conn, einsatz_id, eid, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::einheit::etb_text_personal_zugeordnet(&einheit, &person),
        )
        .await?;
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/personal/{ep_id} — Person freigeben. ETB-Eintrag.
pub async fn personal_freigeben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Freigabe (inkl. Führer-Leerung) + System-ETB-Eintrag atomar.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let person = mitglied_repo::gib_personal_frei_tx(conn, einsatz_id, eid, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!("Einheit «{}»: «{}» freigegeben", einheit, person),
        )
        .await?;
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    sse_personal(&state, einsatz_id, ep_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/fahrzeug/{ef_id} — Fahrzeug zuordnen. ETB-Eintrag.
pub async fn fahrzeug_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid, ef_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Zuordnung + System-ETB-Eintrag atomar.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let fz = mitglied_repo::ordne_fahrzeug_zu_tx(conn, einsatz_id, eid, ef_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &crate::einheit::etb_text_fahrzeug_zugeordnet(&einheit, &fz),
        )
        .await?;
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/fahrzeug/{ef_id} — Fahrzeug freigeben. ETB-Eintrag.
pub async fn fahrzeug_freigeben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid, ef_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Freigabe + System-ETB-Eintrag atomar.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let fz = mitglied_repo::gib_fahrzeug_frei_tx(conn, einsatz_id, eid, ef_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!("Einheit «{}»: Fahrzeug «{}» freigegeben", einheit, fz),
        )
        .await?;
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    sse_fahrzeug(&state, einsatz_id, ef_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT .../einheiten/{eid}/material/{em_id} — Material zuordnen. ETB-Eintrag.
pub async fn material_zuordnen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid, em_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Zuordnung + System-ETB-Eintrag atomar.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let (bez, menge) =
            mitglied_repo::ordne_material_zu_tx(conn, einsatz_id, eid, em_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!(
                "Einheit «{}»: Material «{}» (×{}) zugeordnet",
                einheit, bez, menge
            ),
        )
        .await?;
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    sse_material(&state, einsatz_id, em_id);
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE .../einheiten/{eid}/material/{em_id} — Material freigeben. ETB-Eintrag.
pub async fn material_freigeben(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid, em_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Freigabe + System-ETB-Eintrag atomar.
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    crate::write_retry!(&state.pool, |conn| {
        let (bez, menge) =
            mitglied_repo::gib_material_frei_tx(conn, einsatz_id, eid, em_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            ctx.benutzer.id,
            startwert,
            &format!(
                "Einheit «{}»: Material «{}» (×{}) freigegeben",
                einheit, bez, menge
            ),
        )
        .await?;
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    sse_material(&state, einsatz_id, em_id);
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

/// PATCH /api/einsaetze/{id}/einheiten/{eid}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, einheit_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vorher = einheit_repo::laden(&state.pool, einsatz_id, einheit_id).await?; // 404 falls fremd
    let eff_lat = body.lat.unwrap_or(vorher.lat);
    let eff_lon = body.lon.unwrap_or(vorher.lon);
    pruefe_koordinate(eff_lat, eff_lon, "lat", "lon")?;

    let nachher = einheit_repo::aktualisiere_position(
        &state.pool,
        einsatz_id,
        einheit_id,
        einheit_repo::PositionPatch {
            lat: body.lat,
            lon: body.lon,
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_einheit(&state, einsatz_id, einheit_id);
    Ok(Json(nachher))
}

/// Body für den Handstatus (LFH-609). `status_id` ist Pflicht und nullable: `null`
/// löscht den Handstatus, ein FEHLENDES Feld ist ein Formfehler (400) — sonst wäre ein
/// leerer Body stillschweigend „löschen“.
#[derive(Debug, Deserialize)]
pub struct StatusBody {
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub status_id: Option<Option<i64>>,
}

/// PUT /api/einsaetze/{id}/einheiten/{eid}/status — Handstatus einer Einheit OHNE
/// Fahrzeug (LFH-609). Mit Fahrzeugen wird der Status aus ihnen abgeleitet → Setzen ist
/// 422, Löschen (`null`) bleibt erlaubt.
/// Ein echter Wechsel schreibt einen System-ETB-Eintrag (atomar) und setzt „Seit“.
pub async fn status_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Einheiten>,
    PfadParam((_eid, eid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<StatusBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let status_id = body
        .status_id
        .ok_or_else(|| AppError::Validation("status_id fehlt".into()))?;
    if let Some(sid) = status_id {
        if !crate::fahrzeug::status_repo::ist_in_org(&state.pool, ctx.einsatz.org_id, sid).await? {
            return Err(AppError::Validation("Unbekannter Status".into()));
        }
    }
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    crate::write_retry!(&state.pool, |conn| {
        if let Some(w) =
            einheit_repo::setze_hand_status_tx(conn, einsatz_id, eid, status_id).await?
        {
            // LFH-552: ein markierter Handstatus wirkt wie ein Wechsel an der Einheit.
            if let Some(sid) = status_id {
                crate::zeitachse::repo::aus_einheit_handstatus_tx(
                    conn,
                    einsatz_id,
                    ctx.benutzer.id,
                    eid,
                    sid,
                    &jetzt,
                )
                .await?;
            }
            crate::etb::system_audit_tx(
                conn,
                einsatz_id,
                ctx.benutzer.id,
                startwert,
                &format!(
                    "Einheit «{}»: Status «{}» → «{}»",
                    w.name,
                    w.vorher.as_deref().unwrap_or("—"),
                    w.nachher.as_deref().unwrap_or("—")
                ),
            )
            .await?;
        }
        Ok(())
    })?;
    sse_einheit(&state, einsatz_id, eid);
    Ok(Json(
        einheit_repo::laden(&state.pool, einsatz_id, eid).await?,
    ))
}
