use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::auth::Benutzer;
use crate::einheit::repo::{self as einheit_repo, EinheitDaten, EinheitPatch};
use crate::einheit::{mitglied_repo, EinheitAnzeige};
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::live::LiveEvent;

/// Modul-Key dieses Route-Moduls (LFH-132).
const MODUL_KEY: &str = "einheiten";
use crate::routes::support::{deserialize_optional_field, trimme, trimme_tri};
use crate::staerke::Staerke;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Einheit hat sich geändert. Frontend filtert per Event-Name.
fn sse_einheit(state: &AppState, einsatz_id: i64, einheit_id: i64) {
    let data =
        serde_json::json!({ "einsatz_id": einsatz_id, "einheit_id": einheit_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Einheit, data);
}

/// SSE-Notify (Lage-Karte): betroffenes Fahrzeug aktualisieren (z.B. bei Zuordnung/Freigabe).
/// Lokaler Spiegel von `routes::einsatz_fahrzeug::sse_fahrzeug` (gleiche Payload), um
/// Cross-Modul-Sichtbarkeit zu vermeiden.
fn sse_fahrzeug(state: &AppState, einsatz_id: i64, ef_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "fahrzeug_id": ef_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Fahrzeug, data);
}

/// SSE-Notify: disponierte Einsatzkraft aktualisieren (z.B. bei Zuordnung/Freigabe).
/// Lokaler Spiegel von `routes::einsatz_personal::sse_personal` (Tag `personal`, gleiche Payload).
fn sse_personal(state: &AppState, einsatz_id: i64, ep_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "personal_id": ep_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Personal, data);
}

/// SSE-Notify (Meldebild): betroffenes Material aktualisieren (z.B. bei Zuordnung/Freigabe).
/// Lokaler Spiegel von `routes::einsatz_material::sse_material` (Tag `material`, gleiche Payload).
fn sse_material(state: &AppState, einsatz_id: i64, em_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "material_id": em_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Material, data);
}

/// Holt den Einsatz + Rolle und prüft Schreibrecht + aktiv. Liefert den Einsatz.
async fn schreib_gate(
    state: &AppState,
    benutzer: &Benutzer,
    einsatz_id: i64,
) -> Result<crate::einsatz::Einsatz, AppError> {
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
    Ok(einsatz)
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Json<Vec<EinheitAnzeige>>, AppError> {
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(body): JsonBody<EinheitBody>,
) -> Result<(StatusCode, Json<EinheitAnzeige>), AppError> {
    let einsatz = schreib_gate(&state, &benutzer, einsatz_id).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    Staerke::aus_optionen(
        body.soll_fuehrer,
        body.soll_unterfuehrer,
        body.soll_mannschaft,
    )
    .map_err(AppError::Validation)?;
    let bemerkung = trimme(body.bemerkung);
    let kommunikationsmittel = trimme(body.kommunikationsmittel);
    let erreichbarkeit = trimme(body.erreichbarkeit);
    let anzeige = einheit_repo::anlegen(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        EinheitDaten {
            name: &name,
            abschnitt_id: body.abschnitt_id,
            ueber_einheit_id: body.ueber_einheit_id,
            typ_id: body.typ_id,
            soll_fuehrer: body.soll_fuehrer,
            soll_unterfuehrer: body.soll_unterfuehrer,
            soll_mannschaft: body.soll_mannschaft,
            bemerkung: bemerkung.as_deref(),
            kommunikationsmittel: kommunikationsmittel.as_deref(),
            erreichbarkeit: erreichbarkeit.as_deref(),
            sortier: body.sortier,
        },
        benutzer.id,
    )
    .await?;
    if let Some(ids) = &body.sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_einheit_sprechgruppen(
            &state.pool,
            einsatz.org_id,
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
        benutzer.id,
        &format!("Einheit «{}» gebildet", anzeige.name),
    )
    .await?;
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<EinheitPatchBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
    let einsatz = schreib_gate(&state, &benutzer, einsatz_id).await?;
    let name = match body.name {
        Some(n) => {
            let n = n.trim().to_string();
            if n.is_empty() {
                return Err(AppError::Validation("Name darf nicht leer sein".into()));
            }
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
    let kommunikationsmittel = trimme_tri(body.kommunikationsmittel);
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
        einsatz.org_id,
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
            einsatz.org_id,
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
            super::etb_system_degradiert(&state, einsatz_id, benutzer.id, &inhalt).await?;
        }
    }
    if vorher.abschnitt_id != nachher.abschnitt_id {
        let inhalt = match &nachher.abschnitt_name {
            Some(a) => format!("Einheit «{}»: Abschnitt «{}» zugeordnet", nachher.name, a),
            None => format!("Einheit «{}»: Abschnittszuordnung aufgehoben", nachher.name),
        };
        super::etb_system_degradiert(&state, einsatz_id, benutzer.id, &inhalt).await?;
    }
    sse_einheit(&state, einsatz_id, eid);
    Ok(Json(final_anzeige))
}

/// DELETE /api/einsaetze/{id}/einheiten/{eid} — auflösen. ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, &benutzer, einsatz_id).await?;
    let name = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Auflösung (Freigaben + Hochzug + Löschung) + System-ETB-Eintrag
    // atomar in EINER Tx. SSE erst nach dem Commit.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        einheit_repo::loese_auf_tx(conn, einsatz_id, eid).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, &benutzer, einsatz_id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Zuordnung (inkl. Stale-Führer-Bereinigung) + System-ETB-Eintrag
    // atomar in EINER Tx. Der Personalname kommt aus dem Write und speist den ETB-Text.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let person = mitglied_repo::ordne_personal_zu_tx(conn, einsatz_id, eid, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
            startwert,
            &format!("Einheit «{}»: «{}» zugeordnet", einheit, person),
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid, ep_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, &benutzer, einsatz_id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Freigabe (inkl. Führer-Leerung) + System-ETB-Eintrag atomar.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let person = mitglied_repo::gib_personal_frei_tx(conn, einsatz_id, eid, ep_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid, ef_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, &benutzer, einsatz_id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Zuordnung + System-ETB-Eintrag atomar.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let fz = mitglied_repo::ordne_fahrzeug_zu_tx(conn, einsatz_id, eid, ef_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
            startwert,
            &format!("Einheit «{}»: Fahrzeug «{}» zugeordnet", einheit, fz),
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid, ef_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, &benutzer, einsatz_id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Freigabe + System-ETB-Eintrag atomar.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let fz = mitglied_repo::gib_fahrzeug_frei_tx(conn, einsatz_id, eid, ef_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid, em_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, &benutzer, einsatz_id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Zuordnung + System-ETB-Eintrag atomar.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let (bez, menge) =
            mitglied_repo::ordne_material_zu_tx(conn, einsatz_id, eid, em_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
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
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, eid, em_id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    schreib_gate(&state, &benutzer, einsatz_id).await?;
    let einheit = einheit_name(&state, einsatz_id, eid).await?;
    // F06/LFH-244 Tier-A: Freigabe + System-ETB-Eintrag atomar.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        let (bez, menge) =
            mitglied_repo::gib_material_frei_tx(conn, einsatz_id, eid, em_id).await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer.id,
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

/// PATCH /api/einsaetze/{id}/einheiten/{eid}/position — reine Lage-Pflege, KEIN ETB.
pub async fn position(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, einheit_id)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<PositionBody>,
) -> Result<Json<EinheitAnzeige>, AppError> {
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

    let vorher = einheit_repo::laden(&state.pool, einsatz_id, einheit_id).await?; // 404 falls fremd
    let eff_lat = match body.lat {
        Some(o) => o,
        None => vorher.lat,
    };
    let eff_lon = match body.lon {
        Some(o) => o,
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
