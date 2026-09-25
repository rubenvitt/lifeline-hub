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
const MODUL_KEY: &str = "einsatzabschnitte";
use crate::einsatzabschnitt::repo::{self as abschnitt_repo, AbschnittDaten, AbschnittPatch};
use crate::einsatzabschnitt::{AbschnittLagezustand, EinsatzabschnittAnzeige};
use crate::error::AppError;
use crate::routes::support::{trimme, trimme_tri};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// SSE-Notify (Lage-Karte): Abschnitt (Fläche/Symbol) hat sich geändert.
fn sse_abschnitt(state: &AppState, einsatz_id: i64, aid: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "abschnitt_id": aid }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::Abschnitt, data);
}

/// Längster zulässiger Kurzname — ein Rufname wie „EA-Nord", kein zweiter Name.
const KURZBEZEICHNUNG_MAX: usize = 20;

/// Unbekannter Lagezustand → 400: das Feld ist für sich unbrauchbar (LFH-267).
fn parse_lagezustand(s: &str) -> Result<AbschnittLagezustand, AppError> {
    AbschnittLagezustand::parse(s).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekannter Lagezustand «{s}» (erlaubt: planmaessig, angespannt, kritisch)"
        ))
    })
}

/// Fortschritt außerhalb 0–100 → 400, nicht 422: der Wert scheitert am Feld selbst, nicht
/// am Zusammenhang (Trennlinie LFH-267). Die 422 der Koordinaten-Ranges in
/// `einsatz_uhs.rs` ist gewachsener Bestand, keine Regel für Neues.
fn pruefe_fortschritt(wert: i64) -> Result<i64, AppError> {
    if (0..=100).contains(&wert) {
        Ok(wert)
    } else {
        Err(AppError::Validation(
            "Fortschritt muss zwischen 0 und 100 Prozent liegen".into(),
        ))
    }
}

fn pruefe_kurzbezeichnung(kurz: &str) -> Result<(), AppError> {
    if kurz.chars().count() > KURZBEZEICHNUNG_MAX {
        return Err(AppError::Validation(format!(
            "Kurzbezeichnung darf höchstens {KURZBEZEICHNUNG_MAX} Zeichen lang sein"
        )));
    }
    Ok(())
}

/// Lesbarer Lagezustand für den ETB; `None` = die Beurteilung fehlt.
fn lage_wort(l: Option<AbschnittLagezustand>) -> &'static str {
    l.map_or("nicht beurteilt", |l| l.wort())
}

/// GET /api/einsaetze/{id}/abschnitte — flache Liste (Baum baut das FE). Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
) -> Result<Json<Vec<EinsatzabschnittAnzeige>>, AppError> {
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
    Ok(Json(abschnitt_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AbschnittBody {
    pub name: String,
    pub ueber_abschnitt_id: Option<i64>,
    pub leiter_id: Option<i64>,
    pub bemerkung: Option<String>,
    pub kommunikationsmittel: Option<String>,
    pub erreichbarkeit: Option<String>,
    #[serde(default)]
    pub sortier: i64,
    /// Sprechgruppen-IDs; `Some` ersetzt die Zuordnung vollständig, `None` lässt sie unverändert.
    pub sprechgruppe_ids: Option<Vec<i64>>,
    pub kurzbezeichnung: Option<String>,
    /// Wire-Wert von [`AbschnittLagezustand`]; als String gelesen, damit ein unbekannter
    /// Wert eine sprechende 400 bekommt statt der Extractor-Meldung.
    pub lagezustand: Option<String>,
    pub abschnittsauftrag: Option<String>,
    pub fortschritt: Option<i64>,
}

/// POST /api/einsaetze/{id}/abschnitte — anlegen. Schreibrecht + aktiv. ETB-Eintrag.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(einsatz_id): PfadParam<i64>,
    JsonBody(body): JsonBody<AbschnittBody>,
) -> Result<(StatusCode, Json<EinsatzabschnittAnzeige>), AppError> {
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

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let bemerkung = trimme(body.bemerkung);
    let mittel = trimme(body.kommunikationsmittel);
    let erreichbar = trimme(body.erreichbarkeit);
    let kurz = trimme(body.kurzbezeichnung);
    if let Some(k) = &kurz {
        pruefe_kurzbezeichnung(k)?;
    }
    let lagezustand = trimme(body.lagezustand)
        .as_deref()
        .map(parse_lagezustand)
        .transpose()?;
    let abschnittsauftrag = trimme(body.abschnittsauftrag);
    let fortschritt = body.fortschritt.map(pruefe_fortschritt).transpose()?;
    let mut anzeige = abschnitt_repo::anlegen(
        &state.pool,
        einsatz_id,
        AbschnittDaten {
            name: &name,
            ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id,
            bemerkung: bemerkung.as_deref(),
            kommunikationsmittel: mittel.as_deref(),
            erreichbarkeit: erreichbar.as_deref(),
            sortier: body.sortier,
            kurzbezeichnung: kurz.as_deref(),
            lagezustand,
            abschnittsauftrag: abschnittsauftrag.as_deref(),
            fortschritt,
        },
    )
    .await?;
    if let Some(ids) = body.sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(
            &state.pool,
            einsatz.org_id,
            einsatz_id,
            anzeige.id,
            &ids,
        )
        .await?;
        anzeige = abschnitt_repo::laden(&state.pool, einsatz_id, anzeige.id).await?;
    }
    super::etb_system_degradiert(
        &state,
        einsatz_id,
        benutzer.id,
        &crate::einsatzabschnitt::etb_text_angelegt(&anzeige.name, anzeige.lagezustand),
    )
    .await?;
    sse_abschnitt(&state, einsatz_id, anzeige.id);
    Ok((StatusCode::CREATED, Json(anzeige)))
}

/// PATCH-Body (LFH-306, Tri-State): jedes Feld optional, absent = unverändert,
/// `null`/`""` = leeren. Getrennt von [`AbschnittBody`], damit der POST sein Pflicht-`name`
/// strukturell erzwingt. **Kein `#[serde(default)]` an `sortier`** — das machte aus
/// „nicht gesendet" ein „auf 0 setzen".
#[derive(Debug, Deserialize)]
pub struct AbschnittPatchBody {
    pub name: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub ueber_abschnitt_id: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub leiter_id: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub bemerkung: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub kommunikationsmittel: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub erreichbarkeit: Option<Option<String>>,
    pub sortier: Option<i64>,
    /// Sprechgruppen-IDs; `Some` ersetzt die Zuordnung vollständig, `None` lässt sie
    /// unverändert — das Feld war schon vor LFH-306 tri-state.
    pub sprechgruppe_ids: Option<Vec<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub kurzbezeichnung: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub lagezustand: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub abschnittsauftrag: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub fortschritt: Option<Option<i64>>,
}

/// PATCH /api/einsaetze/{id}/abschnitte/{aid} — echter Teil-Patch (LFH-306).
/// Kein ETB-Eintrag für Korrekturen — AUSSER beim Wechsel des Lagezustands (LFH-608):
/// „Abschnitt Nord ist kritisch" ist eine Lagemeldung, keine Stammdatenpflege, und gehört
/// mit Zeitpunkt und Urheber ins Tagebuch.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, aid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AbschnittPatchBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
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
    let bemerkung = trimme_tri(body.bemerkung);
    let mittel = trimme_tri(body.kommunikationsmittel);
    let erreichbar = trimme_tri(body.erreichbarkeit);
    let kurz = trimme_tri(body.kurzbezeichnung);
    if let Some(Some(k)) = &kurz {
        pruefe_kurzbezeichnung(k)?;
    }
    let lagezustand = match trimme_tri(body.lagezustand) {
        Some(Some(s)) => Some(Some(parse_lagezustand(&s)?)),
        Some(None) => Some(None),
        None => None,
    };
    let abschnittsauftrag = trimme_tri(body.abschnittsauftrag);
    let fortschritt = match body.fortschritt {
        Some(Some(w)) => Some(Some(pruefe_fortschritt(w)?)),
        andere => andere,
    };
    let mut anzeige = abschnitt_repo::patche(
        &state.pool,
        einsatz_id,
        aid,
        AbschnittPatch {
            name: name.as_deref(),
            ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id,
            bemerkung: bemerkung.as_ref().map(|v| v.as_deref()),
            kommunikationsmittel: mittel.as_ref().map(|v| v.as_deref()),
            erreichbarkeit: erreichbar.as_ref().map(|v| v.as_deref()),
            sortier: body.sortier,
            kurzbezeichnung: kurz.as_ref().map(|v| v.as_deref()),
            abschnittsauftrag: abschnittsauftrag.as_ref().map(|v| v.as_deref()),
            fortschritt,
        },
    )
    .await?;
    // Lagewechsel + ETB-Eintrag atomar in EINER Tx, und zwar VOR der Sprechgruppen-
    // Zuordnung: scheitert die mit 422, bleibt der gespeicherte Wechsel trotzdem nicht
    // undokumentiert (LFH-608, Review). Der Eintrag entsteht nur bei echtem Wechsel.
    if let Some(neu) = lagezustand {
        let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
            .await?
            .etb_startwert();
        let etb_id = crate::write_retry!(&state.pool, |conn| {
            match abschnitt_repo::setze_lagezustand_tx(conn, einsatz_id, aid, neu).await? {
                Some(wechsel) => {
                    let text = format!(
                        "Lage Abschnitt «{}»: {} → {}",
                        wechsel.name,
                        lage_wort(wechsel.vorher),
                        lage_wort(neu)
                    );
                    Ok(Some(
                        crate::etb::system_audit_tx(
                            conn,
                            einsatz_id,
                            benutzer.id,
                            startwert,
                            &text,
                        )
                        .await?,
                    ))
                }
                None => Ok(None),
            }
        })?;
        if let Some(etb_id) = etb_id {
            // Live erst nach dem Commit (Reinheits-Kontrakt wie beim Auflösen).
            state.live.publiziere(einsatz_id, etb_id);
        }
        anzeige = abschnitt_repo::laden(&state.pool, einsatz_id, aid).await?;
    }
    if let Some(ids) = body.sprechgruppe_ids {
        crate::sprechgruppe::repo::setze_abschnitt_sprechgruppen(
            &state.pool,
            einsatz.org_id,
            einsatz_id,
            aid,
            &ids,
        )
        .await?;
        anzeige = abschnitt_repo::laden(&state.pool, einsatz_id, aid).await?;
    }
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(Json(anzeige))
}

/// DELETE /api/einsaetze/{id}/abschnitte/{aid} — auflösen (Reparenting). ETB-Eintrag.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, aid)): PfadParam<(i64, i64)>,
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

    let vorher = abschnitt_repo::laden(&state.pool, einsatz_id, aid).await?;
    // F06/LFH-244 Tier-A: Auflösen (Reparenting + Freigaben + DELETE) + System-ETB-Eintrag
    // atomar in EINER Tx (BEGIN IMMEDIATE + Retry). ETB-Text aus dem VOR der Tx geladenen
    // `vorher` (Name unverändert). SSE erst nach dem Commit (Reinheits-Kontrakt).
    let text = format!("Abschnitt «{}» aufgelöst", vorher.name);
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&state.pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(&state.pool, |conn| {
        abschnitt_repo::loese_auf_tx(conn, einsatz_id, aid).await?;
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer.id, startwert, &text).await?;
        Ok(())
    })?;
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct FlaecheBody {
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub flaeche_geojson: Option<Option<String>>,
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

/// PATCH /api/einsaetze/{id}/abschnitte/{aid}/flaeche — Lage-Pflege, KEIN ETB.
pub async fn flaeche(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, aid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<FlaecheBody>,
) -> Result<Json<EinsatzabschnittAnzeige>, AppError> {
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

    if let Some(Some(gj)) = &body.flaeche_geojson {
        let v: serde_json::Value = serde_json::from_str(gj).map_err(|_| {
            AppError::UnprocessableEntity("flaeche_geojson ist kein gültiges JSON".into())
        })?;
        if v.get("type").and_then(|t| t.as_str()) != Some("Polygon") {
            return Err(AppError::UnprocessableEntity(
                "flaeche_geojson muss ein GeoJSON-Polygon sein".into(),
            ));
        }
    }

    let nachher = abschnitt_repo::aktualisiere_flaeche(
        &state.pool,
        einsatz_id,
        aid,
        abschnitt_repo::FlaechePatch {
            flaeche_geojson: body.flaeche_geojson.as_ref().map(|o| o.as_deref()),
            tz_fachaufgabe: body.tz_fachaufgabe.as_ref().map(|o| o.as_deref()),
            tz_organisation: body.tz_organisation.as_ref().map(|o| o.as_deref()),
        },
    )
    .await?;
    sse_abschnitt(&state, einsatz_id, aid);
    Ok(Json(nachher))
}
