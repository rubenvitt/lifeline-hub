//! Routen der Registrierstelle (LLH-1612, Change `hitr91ob-registrierstelle-betreuung`,
//! Spec `betreuung-registrierung`).
//!
//! - `POST …/betreuung/stellen/{sid}/registrierungen` — Haushalt registrieren (design.md D2).
//! - `GET  …/betreuung/stellen/{sid}/registrierungen` — Registrierliste der Stelle.
//! - `POST …/betreuung/stellen/{sid}/abmeldungen` — Personen oder Haushalt abmelden (D6).
//! - `GET  …/betreuung/kostformen` — Kostformen der Registrierten ohne Personenbezug (D7).
//!
//! **Rechte:** Registrieren, Abmelden und die Liste verlangen die Module Betreuung UND Personen
//! (403, bevor etwas gelesen wird); die Kostform-Zählung nur Betreuung. Das Gerät
//! „Betreuungsstelle“ handelt nur an seiner eigenen Stelle, eine andere ist 403.
//!
//! **Prüfkette** der Schreibwege: 403 → Replay über `client_id` (vor dem Aktiv-Gate, LFH-769) →
//! 400 (Feld für sich) → 404 (Stelle, Haushalt, Person) → 409 (Stelle storniert) → 422
//! (Zusammenhang: Nachname leer, keine oder zu viele Personen, Stelle geschlossen).
//!
//! **Live** nach dem Commit: ETB-Kurzruf je Eintrag, dann `LiveEvent::Betreuung` mit der Stelle
//! und `LiveEvent::Person` je Person.

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::betreuung::registrierung::{
    self, AbmeldeEingabe, AbmeldungAnzeige, HaushaltAnzeige, KostformZaehlung, RegistrierEingabe,
    RegistrierListe, RegistrierPerson, Registriert, REGISTRIERUNG_PERSONEN_MAX,
};
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibfreigabe};
use crate::einsatz::modul::Betreuung;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::geraet::stelle;
use crate::geraet::Bindungsart;
use crate::live::LiveEvent;
use crate::person::{
    Geschlecht, Kostform, PERSON_ANGABE_MAX, PERSON_NAME_MAX, PERSON_NOTIZ_MAX,
    PERSON_UNVERTRAEGLICHKEITEN_MAX,
};
use crate::routes::support::{self, optional_max};

/// Das Gerät „Betreuungsstelle“ nur an seiner eigenen Stelle (Spec „Rechte der Registrierung“).
fn fordere_eigene_stelle(
    geraet: Option<&crate::geraet::GeraetKontext>,
    sid: i64,
) -> Result<(), AppError> {
    if stelle::sicht(geraet, Bindungsart::Betreuungsstelle).sieht(sid) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn publiziere(state: &AppState, einsatz_id: i64, stelle_id: i64, r: &Registriert) {
    if r.person_ids.is_empty() {
        return;
    }
    super::betreuung::publiziere(state, einsatz_id, &r.etb_ids, stelle_id);
    for pid in &r.person_ids {
        state
            .live
            .publiziere_objekt(einsatz_id, LiveEvent::Person, "person_id", *pid);
    }
}

// ── Registrieren ────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PersonBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    vorname: Option<String>,
    #[serde(default)]
    geburtsdatum: Option<String>,
    #[serde(default)]
    geschlecht: Option<String>,
    #[serde(default)]
    herkunft_adresse: Option<String>,
    #[serde(default)]
    kontakt: Option<String>,
    /// Pflicht (Spec): einer der Werte von [`Kostform`].
    kostform: String,
    #[serde(default)]
    unvertraeglichkeiten: Option<String>,
    #[serde(default)]
    notiz: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RegistrierBody {
    #[serde(default)]
    haushalt_id: Option<i64>,
    personen: Vec<PersonBody>,
    /// Erfassungszeit, offline vorgemerkt; fehlt = jetzt.
    #[serde(default)]
    zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Queue.
    #[serde(default)]
    client_id: Option<String>,
}

/// Die Felder einer Person für sich (400); der leere Nachname ist ein Zusammenhang (422) und
/// kommt danach.
fn person_lesen(p: PersonBody) -> Result<(Option<String>, RegistrierPerson), AppError> {
    let kostform =
        Kostform::try_from(p.kostform.trim().to_string()).map_err(AppError::Validation)?;
    let geschlecht = match support::trimme(p.geschlecht) {
        Some(g) => Some(
            Geschlecht::parse(&g)
                .ok_or_else(|| AppError::Validation("Unbekanntes Geschlecht".into()))?,
        ),
        None => None,
    };
    let name = optional_max(p.name, "Name", PERSON_NAME_MAX)?;
    let geburtsdatum = match support::trimme(p.geburtsdatum) {
        Some(roh) => Some(super::einsatz_person::pruefe_geburtsdatum(
            &roh,
            chrono::Utc::now().date_naive(),
        )?),
        None => None,
    };
    Ok((
        name,
        RegistrierPerson {
            name: String::new(),
            vorname: optional_max(p.vorname, "Vorname", PERSON_NAME_MAX)?,
            geburtsdatum,
            geschlecht,
            herkunft_adresse: optional_max(
                p.herkunft_adresse,
                "Herkunft / Adresse",
                PERSON_ANGABE_MAX,
            )?,
            kontakt: optional_max(p.kontakt, "Kontakt", PERSON_ANGABE_MAX)?,
            kostform,
            unvertraeglichkeiten: optional_max(
                p.unvertraeglichkeiten,
                "Unverträglichkeiten",
                PERSON_UNVERTRAEGLICHKEITEN_MAX,
            )?,
            notiz: optional_max(p.notiz, "Notiz", PERSON_NOTIZ_MAX)?,
        },
    ))
}

/// Antwort einer Registrierung: der Haushalt mit seinen hier registrierten Personen.
async fn haushalt_antwort(
    state: &AppState,
    einsatz_id: i64,
    stelle_id: i64,
    haushalt_id: Option<i64>,
) -> Result<HaushaltAnzeige, AppError> {
    registrierung::haushalt(
        &state.pool,
        einsatz_id,
        stelle_id,
        haushalt_id.ok_or(AppError::NotFound)?,
    )
    .await
}

/// POST /api/einsaetze/{id}/betreuung/stellen/{sid}/registrierungen
pub async fn registrieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Betreuung>,
    headers: HeaderMap,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<RegistrierBody>,
) -> Result<(StatusCode, Json<HaushaltAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    fordere_eigene_stelle(ctx.geraet.as_ref(), sid)?;
    ctx.fordere_modul_zugriff(&state.pool, "personen").await?;
    support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        if let Some((haushalt_id, stelle_id)) =
            registrierung::registrierung_nach_client_id(&state.pool, einsatz_id, cid).await?
        {
            if stelle_id != sid {
                return Err(AppError::UnprocessableEntity(
                    "Die Registrierung gehört zu einer anderen Betreuungsstelle".into(),
                ));
            }
            return Ok((
                StatusCode::CREATED,
                Json(haushalt_antwort(&state, einsatz_id, sid, haushalt_id).await?),
            ));
        }
    }
    ctx.fordere_aktiv()?;
    let zeitpunkt_at = support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &ctx.einsatz.begonnen_at,
    )?;
    let mut gelesen = Vec::with_capacity(body.personen.len());
    for p in body.personen {
        gelesen.push(person_lesen(p)?);
    }
    if gelesen.is_empty() {
        return Err(AppError::UnprocessableEntity(
            "Eine Registrierung braucht mindestens eine Person".into(),
        ));
    }
    if gelesen.len() > REGISTRIERUNG_PERSONEN_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Höchstens {REGISTRIERUNG_PERSONEN_MAX} Personen je Registrierung"
        )));
    }
    let mut personen = Vec::with_capacity(gelesen.len());
    for (n, (name, mut p)) in gelesen.into_iter().enumerate() {
        let Some(name) = name else {
            return Err(AppError::UnprocessableEntity(format!(
                "Person {}: Nachname fehlt",
                n + 1
            )));
        };
        p.name = name;
        personen.push(p);
    }
    let eingabe = RegistrierEingabe {
        haushalt_id: body.haushalt_id,
        personen,
        zeitpunkt_at,
        client_id,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let r = crate::write_retry!(&state.pool, |conn| {
        registrierung::registrieren_tx(conn, einsatz_id, sid, benutzer_id, startwert, &eingabe)
            .await
    })?;
    publiziere(&state, einsatz_id, sid, &r);
    Ok((
        StatusCode::CREATED,
        Json(haushalt_antwort(&state, einsatz_id, sid, r.haushalt_id).await?),
    ))
}

/// GET /api/einsaetze/{id}/betreuung/stellen/{sid}/registrierungen
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Betreuung>,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
) -> Result<Json<RegistrierListe>, AppError> {
    fordere_eigene_stelle(ctx.geraet.as_ref(), sid)?;
    ctx.fordere_modul_zugriff(&state.pool, "personen").await?;
    Ok(Json(
        registrierung::liste(&state.pool, ctx.einsatz.id, sid).await?,
    ))
}

// ── Abmelden ────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AbmeldeBody {
    #[serde(default)]
    haushalt_id: Option<i64>,
    #[serde(default)]
    person_ids: Option<Vec<i64>>,
    /// Wohin (Freitext), etwa „zu Verwandten“; nie im ETB.
    #[serde(default)]
    ziel: Option<String>,
    #[serde(default)]
    zeitpunkt_at: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
}

/// POST /api/einsaetze/{id}/betreuung/stellen/{sid}/abmeldungen
pub async fn abmelden(
    State(state): State<AppState>,
    ctx: EinsatzSchreibfreigabe<Betreuung>,
    headers: HeaderMap,
    PfadParam((_eid, sid)): PfadParam<(i64, i64)>,
    JsonBody(body): JsonBody<AbmeldeBody>,
) -> Result<Json<AbmeldungAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    fordere_eigene_stelle(ctx.geraet.as_ref(), sid)?;
    ctx.fordere_modul_zugriff(&state.pool, "personen").await?;
    support::fordere_offline_queue_benutzer(&headers, ctx.benutzer.id)?;
    let client_id = support::parse_client_id(body.client_id.as_deref())?;
    if let Some(cid) = client_id.as_deref() {
        let schon = registrierung::abmeldung_nach_client_id(&state.pool, einsatz_id, cid).await?;
        if !schon.is_empty() {
            return Ok(Json(AbmeldungAnzeige {
                stelle_id: sid,
                person_ids: schon,
            }));
        }
    }
    ctx.fordere_aktiv()?;
    let ziel = optional_max(body.ziel, "Ziel", PERSON_ANGABE_MAX.min(200))?;
    let zeitpunkt_at = support::erfassungszeitpunkt(
        body.zeitpunkt_at.as_deref(),
        chrono::Utc::now(),
        &ctx.einsatz.begonnen_at,
    )?;
    let person_ids = body.person_ids.unwrap_or_default();
    match (body.haushalt_id.is_some(), person_ids.is_empty()) {
        (true, true) | (false, false) => {}
        _ => {
            return Err(AppError::UnprocessableEntity(
                "Abgemeldet wird entweder ein Haushalt oder einzelne Personen".into(),
            ))
        }
    }
    let eingabe = AbmeldeEingabe {
        haushalt_id: body.haushalt_id,
        person_ids,
        ziel,
        zeitpunkt_at,
        client_id,
    };
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let benutzer_id = ctx.benutzer.id;
    let r = crate::write_retry!(&state.pool, |conn| {
        registrierung::abmelden_tx(conn, einsatz_id, sid, benutzer_id, startwert, &eingabe).await
    })?;
    publiziere(&state, einsatz_id, sid, &r);
    Ok(Json(AbmeldungAnzeige {
        stelle_id: sid,
        person_ids: r.person_ids,
    }))
}

// ── Kostformen ──────────────────────────────────────────────────────────────────────────────

/// GET /api/einsaetze/{id}/betreuung/kostformen — ohne Personenbezug, nur Modul Betreuung.
pub async fn kostformen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Betreuung>,
) -> Result<Json<KostformZaehlung>, AppError> {
    Ok(Json(
        registrierung::kostformen(&state.pool, ctx.einsatz.id).await?,
    ))
}
