//! Routen der Führungsorganisation (LFH-46): Besetzung der Sachgebiete S1–S6, Lagebesprechung
//! und die Checkliste Arbeitsaufnahme (LFH-551).
//!
//! Gates strukturell über die Extractor-Typen — `EinsatzLesezugriff<Stab>` (alle
//! Einsatzmitglieder inkl. Beobachter) bzw. `EinsatzSchreibzugriff<Stab>` (Einsatzleitung,
//! Führungspersonal, System-Admin; enthält `fordere_aktiv`). Das Sachgebiet verleiht
//! **kein** Recht (Entscheidung 12 der Spec).

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Stab;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::routes::support::{self, pflicht};
use crate::stab::checkliste::{self, ChecklistenEintrag, ChecklistenPunkt, PunktEingabe};
use crate::stab::fernmeldeskizze::{
    self as skizze, BereichErgebnis, Fernmeldeskizze, Komponentenart, LageErgebnis, Schriftfeld,
    SkizzenBereich, SkizzenBereichKonflikt, SkizzenBezugArt, SkizzenKomponente, SkizzenLage,
    SkizzenLageKonflikt, SkizzenVerbindung, Verbindungsart, Verbindungsmedium, Verbindungsstatus,
    Verkehrsart, VsVermerk,
};
use crate::stab::kommunikation;
use crate::stab::repo::{self, AbschlussEingabe, BesetzungEingabe};
use crate::stab::{BesetzungArt, LagebesprechungAnzeige, Sachgebiet, StabAnzeige, BEZEICHNUNG_MAX};
use crate::zeit::jetzt;

fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_einsatz(einsatz_id, LiveEvent::Stab);
}

/// Ein unbekanntes Sachgebiet im Pfad ist ein **Feld für sich** → 400 (LFH-267).
fn sachgebiet_aus_pfad(rohwert: &str) -> Result<Sachgebiet, AppError> {
    Sachgebiet::parse(rohwert).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekanntes Sachgebiet '{rohwert}' (erlaubt: s1–s6)"
        ))
    })
}

#[derive(Debug, Deserialize)]
pub struct BesetzungSetzen {
    /// Als `String` entgegengenommen, damit ein unbekannter Wert eine **benannte** 400
    /// liefert statt einer serde-Rejection ohne Feldbezug.
    besetzung_art: String,
    #[serde(default)]
    personal_id: Option<i64>,
    #[serde(default)]
    bezeichnung: Option<String>,
}

/// Validiert die Eingabe gegen die Invarianten aus Abschnitt 8/9.2 der Spec.
///
/// **Die Linie 400 ↔ 422 ist hier bewusst gezogen** (LFH-267): ein unbekannter Enum-Wert und
/// eine zu lange `bezeichnung` scheitern am Feld **isoliert** → 400. Dass `personal_id` bei
/// `besetzung_art='personal'` Pflicht ist (und bei `einsatzleitung` verboten), ist ein
/// **Zusammenhang** → 422; Referenzpaar `einsatz_tier.rs`/Status.
fn validiere(req: BesetzungSetzen) -> Result<BesetzungEingabe, AppError> {
    let art = BesetzungArt::parse(&req.besetzung_art).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekannte Besetzungsart '{}' (erlaubt: einsatzleitung, personal, extern, rueckwaertig)",
            req.besetzung_art
        ))
    })?;

    let bezeichnung = req.bezeichnung.map(|b| b.trim().to_string());
    if let Some(b) = bezeichnung.as_deref() {
        if b.chars().count() > BEZEICHNUNG_MAX {
            return Err(AppError::Validation(format!(
                "bezeichnung darf höchstens {BEZEICHNUNG_MAX} Zeichen lang sein"
            )));
        }
    }
    let bezeichnung = bezeichnung.filter(|b| !b.is_empty());

    match art {
        BesetzungArt::Personal => {
            if req.personal_id.is_none() {
                return Err(AppError::UnprocessableEntity(
                    "besetzung_art 'personal' verlangt eine personal_id".into(),
                ));
            }
            if bezeichnung.is_some() {
                return Err(AppError::UnprocessableEntity(
                    "besetzung_art 'personal' trägt keine bezeichnung".into(),
                ));
            }
        }
        BesetzungArt::Extern | BesetzungArt::Rueckwaertig => {
            if bezeichnung.is_none() {
                return Err(AppError::UnprocessableEntity(format!(
                    "besetzung_art '{}' verlangt eine bezeichnung",
                    art.as_str()
                )));
            }
            if req.personal_id.is_some() {
                return Err(AppError::UnprocessableEntity(format!(
                    "besetzung_art '{}' trägt keine personal_id",
                    art.as_str()
                )));
            }
        }
        BesetzungArt::Einsatzleitung => {
            // „Liegt bei der EL" ist gerade KEINE Personenzuordnung — das Modul kennt
            // keine Zeile „EL" (Spec, Risiken: zwei Wahrheiten für „Einsatzleitung"
            // werden bewusst vermieden).
            if req.personal_id.is_some() || bezeichnung.is_some() {
                return Err(AppError::UnprocessableEntity(
                    "besetzung_art 'einsatzleitung' trägt weder personal_id noch bezeichnung"
                        .into(),
                ));
            }
        }
    }

    Ok(BesetzungEingabe {
        besetzung_art: art,
        personal_id: req.personal_id,
        bezeichnung,
    })
}

/// GET /api/einsaetze/{id}/stab — Führungsorganisation lesen (alle Mitglieder).
pub async fn laden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<StabAnzeige>, AppError> {
    let stab = repo::laden(&state.pool, ctx.einsatz.id).await?;
    Ok(Json(stab))
}

/// PUT /api/einsaetze/{id}/stab/besetzung/{sachgebiet} — Besetzung setzen (Upsert).
pub async fn besetzung_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, sachgebiet)): PfadParam<(i64, String)>,
    JsonBody(req): JsonBody<BesetzungSetzen>,
) -> Result<Json<StabAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let sachgebiet = sachgebiet_aus_pfad(&sachgebiet)?;
    let eingabe = validiere(req)?;
    let (stab, etb_id) = repo::setzen(
        &state.pool,
        einsatz_id,
        sachgebiet,
        ctx.benutzer.id,
        &eingabe,
    )
    .await?;
    // `None` = der Wert war unverändert, es gibt keinen ETB-Eintrag zu melden. Sonst: der
    // Eintrag entstand im selben Commit → ETB-Kurzruf mitschicken. Ohne ihn bliebe die
    // ETB-Chronologie eines zweiten Betrachters still veraltet, denn `stab` invalidiert nur
    // den Stab-Prefix.
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    sse(&state, einsatz_id);
    Ok(Json(stab))
}

/// DELETE /api/einsaetze/{id}/stab/besetzung/{sachgebiet} — „nicht vergeben".
///
/// **Idempotent** (Spec 9.2): ohne Zeile 204 **ohne** ETB-Eintrag und **ohne** Live-Ereignis.
pub async fn besetzung_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, sachgebiet)): PfadParam<(i64, String)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let sachgebiet = sachgebiet_aus_pfad(&sachgebiet)?;
    // `None` = die Zeile war schon „nicht vergeben" → No-op ohne ETB-Eintrag und ohne
    // Live-Ereignis (Spec 9.2). Nur der WIRKSAME Fall publiziert.
    let etb_id = repo::entfernen(&state.pool, einsatz_id, sachgebiet, ctx.benutzer.id).await?;
    if let Some(etb_id) = etb_id {
        state.live.publiziere(einsatz_id, etb_id);
        sse(&state, einsatz_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct LagebesprechungAbschluss {
    entschluss: String,
    /// Zeitpunkt der Besprechung; fehlt = jetzt.
    #[serde(default)]
    abgehalten_at: Option<String>,
    /// **Tri-State** wie am Einsatzkopf (`routes/einsatz.rs`): Feld fehlt = Termin
    /// unverändert, `null` = Termin löschen, Wert = Termin setzen.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    naechste_at: Option<Option<String>>,
}

/// GET /api/einsaetze/{id}/stab/lagebesprechungen — Historie, absteigend.
pub async fn lagebesprechungen_liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<Vec<LagebesprechungAnzeige>>, AppError> {
    let liste = repo::lagebesprechungen(&state.pool, ctx.einsatz.id).await?;
    Ok(Json(liste))
}

/// POST /api/einsaetze/{id}/stab/lagebesprechungen — Lagebesprechung abschliessen.
///
/// Die Antwort wird **nach** dem Schreiben frisch geladen: die Quittung darf keinen Zustand
/// tragen, den es nie gab (LFH-340/C5).
pub async fn lagebesprechung_abschliessen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<LagebesprechungAbschluss>,
) -> Result<(StatusCode, Json<StabAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;

    // Ein leeres Pflichtfeld scheitert am Feld ISOLIERT → 400 (LFH-267). „Lage unverändert,
    // Maßnahmen fortführen" ist ein gültiger Entschluss, ein leerer Eintrag vom Typ
    // `entscheidung` wäre semantisch leer.
    let entschluss = pflicht(&req.entschluss, "entschluss")?;

    // Nicht parsebare Zeit → 400 (Feld isoliert). `normalisiere_zeit` läuft in der ROUTE, nie
    // im Repo — dieselbe Arbeitsteilung wie im Bestand.
    let abgehalten_at = match req.abgehalten_at.as_deref().map(str::trim) {
        Some(s) if !s.is_empty() => crate::etb::normalisiere_zeit(s)?,
        _ => jetzt(),
    };
    let naechste_at = match support::trimme_tri(req.naechste_at) {
        Some(Some(s)) => Some(Some(crate::etb::normalisiere_zeit(&s)?)),
        Some(None) => Some(None),
        None => None,
    };

    // Ein Termin VOR der Besprechung ist ein Zusammenhang zweier Felder → 422.
    if let Some(Some(t)) = &naechste_at {
        if t.as_str() <= abgehalten_at.as_str() {
            return Err(AppError::UnprocessableEntity(
                "naechste_at muss nach abgehalten_at liegen".into(),
            ));
        }
    }

    let ergebnis = repo::lagebesprechung_abschliessen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &AbschlussEingabe {
            entschluss,
            abgehalten_at,
            naechste_at,
        },
    )
    .await?;

    let stab = repo::laden(&state.pool, einsatz_id).await?;
    // Der ETB-Eintrag entstand im selben Commit → ETB-Kurzruf mitschicken.
    state.live.publiziere(einsatz_id, ergebnis.etb_eintrag_id);
    sse(&state, einsatz_id);
    // Den Einsatzkopf nur bei geändertem Termin (LFH-555, design.md D3): `einsatz` erreicht auch
    // Leser ohne Stab-Recht und darf ihnen nicht mehr sagen, als der Kopf-GET ohnehin zeigt.
    // Mit `einsatz` geht auch `einsatzliste` (LFH-734): die Liste zeigt den Termin.
    if ergebnis.termin_geaendert {
        crate::routes::einsatz::kopf_geaendert(&state, einsatz_id).await;
    }
    Ok((StatusCode::CREATED, Json(stab)))
}

#[derive(Debug, Deserialize)]
pub struct ChecklistenPunktSetzen {
    /// Fehlt = unverändert. `null` zählt wie „fehlt“: allein (ohne `bemerkung`) ist der Aufruf
    /// damit leer und scheitert mit 400.
    #[serde(default)]
    erledigt: Option<bool>,
    /// **Tri-State**: fehlt = unverändert, `null` oder leer = Bemerkung löschen.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    bemerkung: Option<Option<String>>,
}

/// Validiert die Eingabe (LFH-267: jede Ablehnung scheitert am Feld für sich → 400).
fn validiere_punkt(req: ChecklistenPunktSetzen) -> Result<PunktEingabe, AppError> {
    let bemerkung = support::trimme_tri(req.bemerkung);
    if let Some(Some(b)) = &bemerkung {
        if b.chars().count() > checkliste::BEMERKUNG_MAX {
            return Err(AppError::Validation(format!(
                "bemerkung darf höchstens {} Zeichen lang sein",
                checkliste::BEMERKUNG_MAX
            )));
        }
    }
    if req.erledigt.is_none() && bemerkung.is_none() {
        return Err(AppError::Validation(
            "erwartet erledigt und/oder bemerkung".into(),
        ));
    }
    Ok(PunktEingabe {
        erledigt: req.erledigt,
        bemerkung,
    })
}

/// GET /api/einsaetze/{id}/stab/checkliste — gespeicherte Punkte (alle Mitglieder).
///
/// Eigener Endpunkt statt eines Felds an `StabAnzeige`: die Checkliste lässt Besetzung und
/// Lagebesprechung unberührt (Akzeptanzkriterium LFH-551).
pub async fn checkliste_laden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<Vec<ChecklistenEintrag>>, AppError> {
    Ok(Json(checkliste::laden(&state.pool, ctx.einsatz.id).await?))
}

/// PUT /api/einsaetze/{id}/stab/checkliste/{punkt} — Haken und/oder Bemerkung setzen.
///
/// Idempotent und umkehrbar, ohne Rückfrage. Nur ein wirksamer Übergang des Punkts
/// `leitstelle_gemeldet` schreibt ins ETB (Design D4).
pub async fn checkliste_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, punkt)): PfadParam<(i64, String)>,
    JsonBody(req): JsonBody<ChecklistenPunktSetzen>,
) -> Result<Json<Vec<ChecklistenEintrag>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let punkt = ChecklistenPunkt::parse(&punkt).ok_or_else(|| {
        AppError::Validation(format!("Unbekannter Punkt der Checkliste '{punkt}'"))
    })?;
    let eingabe = validiere_punkt(req)?;
    let gesetzt =
        checkliste::setzen(&state.pool, einsatz_id, punkt, ctx.benutzer.id, &eingabe).await?;
    if let Some(etb_id) = gesetzt.etb_eintrag_id {
        state.live.publiziere(einsatz_id, etb_id);
    }
    // Ohne Wirkung (nie berührter Punkt, nichts anzulegen) kein Live-Ereignis.
    if gesetzt.geschrieben {
        sse(&state, einsatz_id);
    }
    Ok(Json(gesetzt.liste))
}

// ── Kommunikationsplan (LFH-848) ────────────────────────────────────────────────────────────
//
// Gates wie die übrigen Stab-Routen; jede wirksame Schreibaktion sendet `LiveEvent::Stab` und
// antwortet mit dem ganzen Plan (Muster `checkliste_setzen`). Kein ETB. Design:
// `openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/design.md` (D3).

#[derive(Debug, Deserialize)]
pub struct KommunikationsStelleNeu {
    /// Als `String`, damit ein unbekannter Wert eine benannte 400 liefert.
    stellenart: String,
    #[serde(default)]
    funktion: Option<String>,
    #[serde(default)]
    bezeichnung: Option<String>,
}

/// PATCH einer Stelle: nur die Bezeichnung. Stellenart und Funktion sind nach dem Anlegen fest;
/// ein Body, der sie trotzdem trägt, scheitert mit 400 statt still ignoriert zu werden.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KommunikationsStellePatch {
    #[serde(default)]
    bezeichnung: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct KommunikationsVerbindungNeu {
    mittel: String,
    wert: String,
    #[serde(default)]
    hinweis: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KommunikationsVerbindungPatch {
    #[serde(default)]
    mittel: Option<String>,
    #[serde(default)]
    wert: Option<String>,
    /// **Tri-State**: fehlt = unverändert, `null` oder leer = Hinweis löschen.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    hinweis: Option<Option<String>>,
}

fn mittel_aus(wert: &str) -> Result<kommunikation::Verbindungsmittel, AppError> {
    support::parse_enum(
        kommunikation::Verbindungsmittel::parse,
        wert,
        format!(
            "Unbekanntes Verbindungsmittel '{wert}' (erlaubt: festnetz, mobil, fax, email, \
             messenger, melder, sonstiges)"
        ),
    )
}

/// Wert: Pflicht, höchstens [`kommunikation::TEXT_MAX`] Zeichen — ein Feld für sich → 400.
fn wert_aus(wert: &str) -> Result<String, AppError> {
    let w = pflicht(wert, "wert")?;
    laenge_hoechstens(&w, "wert")?;
    Ok(w)
}

fn laenge_hoechstens(text: &str, feld: &str) -> Result<(), AppError> {
    if text.chars().count() > kommunikation::TEXT_MAX {
        return Err(AppError::Validation(format!(
            "{feld} darf höchstens {} Zeichen lang sein",
            kommunikation::TEXT_MAX
        )));
    }
    Ok(())
}

fn hinweis_aus(hinweis: Option<String>) -> Result<Option<String>, AppError> {
    let h = hinweis
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty());
    if let Some(h) = &h {
        laenge_hoechstens(h, "hinweis")?;
    }
    Ok(h)
}

/// GET /api/einsaetze/{id}/stab/kommunikationsplan — gepflegte Stellen mit Verbindungen.
pub async fn kommunikationsplan_laden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<Vec<kommunikation::KommunikationsStelle>>, AppError> {
    Ok(Json(
        kommunikation::laden(&state.pool, ctx.einsatz.id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct StelleAnlegenParams {
    /// `stelle` = nur die neue Stelle zurück (Fernmeldeskizze, Rückgängig braucht ihre id);
    /// fehlt = der ganze Plan (Kommunikationsplan).
    #[serde(default)]
    antwort: Option<String>,
}

/// POST /api/einsaetze/{id}/stab/kommunikationsplan/stellen — Stelle anlegen. Antwort: der ganze
/// Plan, mit `?antwort=stelle` nur die neue Stelle (LFH-893, Review S4).
pub async fn kommunikationsplan_stelle_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    Query(params): Query<StelleAnlegenParams>,
    JsonBody(req): JsonBody<KommunikationsStelleNeu>,
) -> Result<Response, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let nur_stelle = match params.antwort.as_deref() {
        None | Some("plan") => false,
        Some("stelle") => true,
        Some(andere) => {
            return Err(AppError::Validation(format!(
                "Unbekannte Antwort '{andere}' (erlaubt: plan, stelle)"
            )))
        }
    };
    let stellenart = support::parse_enum(
        kommunikation::Stellenart::parse,
        &req.stellenart,
        format!(
            "Unbekannte Stellenart '{}' (erlaubt: funktion, leitstelle, behoerde, \
             verbindungsperson, sonstige)",
            req.stellenart
        ),
    )?;
    let funktion_roh = req
        .funktion
        .as_deref()
        .map(str::trim)
        .filter(|f| !f.is_empty());
    let eingabe = if stellenart.ist_extern() {
        let bezeichnung = kommunikation::pruefe_bezeichnung_fuer(
            stellenart,
            None,
            req.bezeichnung.as_deref(),
            false,
        )?;
        // Erst das Feld (Bezeichnung, 400), dann der Zusammenhang (Funktion an externer Stelle, 422).
        if funktion_roh.is_some() {
            return Err(AppError::UnprocessableEntity(
                "Eine externe Stelle trägt keine Funktion".into(),
            ));
        }
        kommunikation::StelleEingabe {
            stellenart,
            funktion: None,
            bezeichnung,
        }
    } else {
        let Some(code) = funktion_roh else {
            return Err(AppError::Validation(
                "stellenart 'funktion' verlangt eine funktion".into(),
            ));
        };
        let s7_aktiv = {
            let mut conn = state.pool.acquire().await?;
            crate::fuehrung::repo::labelkarte_fuer_einsatz(&mut conn, einsatz_id)
                .await?
                .s7_aktiv
        };
        let angabe =
            crate::fuehrung::pruefe_funktion(Some(code), req.bezeichnung.as_deref(), s7_aktiv)?;
        kommunikation::StelleEingabe {
            stellenart,
            funktion: angabe.funktion,
            bezeichnung: angabe.text,
        }
    };
    let (id, plan) =
        kommunikation::stelle_anlegen(&state.pool, einsatz_id, ctx.benutzer.id, &eingabe).await?;
    sse(&state, einsatz_id);
    if !nur_stelle {
        return Ok((StatusCode::CREATED, Json(plan)).into_response());
    }
    let stelle = plan
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::Internal("Angelegte Stelle fehlt im Plan".into()))?;
    Ok((StatusCode::CREATED, Json(stelle)).into_response())
}

/// PATCH /api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid} — Bezeichnung ändern.
pub async fn kommunikationsplan_stelle_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, stelle_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<KommunikationsStellePatch>,
) -> Result<Json<Vec<kommunikation::KommunikationsStelle>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let plan = kommunikation::stelle_umbenennen(
        &state.pool,
        einsatz_id,
        stelle_id,
        ctx.benutzer.id,
        req.bezeichnung.as_deref(),
    )
    .await?;
    sse(&state, einsatz_id);
    Ok(Json(plan))
}

/// DELETE /api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid} — Stelle samt Verbindungen.
pub async fn kommunikationsplan_stelle_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, stelle_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<kommunikation::KommunikationsStelle>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let plan = kommunikation::stelle_entfernen(&state.pool, einsatz_id, stelle_id).await?;
    sse(&state, einsatz_id);
    Ok(Json(plan))
}

/// POST /api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid}/verbindungen
pub async fn kommunikationsplan_verbindung_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, stelle_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<KommunikationsVerbindungNeu>,
) -> Result<(StatusCode, Json<Vec<kommunikation::KommunikationsStelle>>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = kommunikation::VerbindungEingabe {
        mittel: mittel_aus(&req.mittel)?,
        wert: wert_aus(&req.wert)?,
        hinweis: hinweis_aus(req.hinweis)?,
    };
    let plan = kommunikation::verbindung_anlegen(
        &state.pool,
        einsatz_id,
        stelle_id,
        ctx.benutzer.id,
        &eingabe,
    )
    .await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(plan)))
}

/// PATCH /api/einsaetze/{id}/stab/kommunikationsplan/verbindungen/{vid}
pub async fn kommunikationsplan_verbindung_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, verbindung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<KommunikationsVerbindungPatch>,
) -> Result<Json<Vec<kommunikation::KommunikationsStelle>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let patch = kommunikation::VerbindungPatch {
        mittel: req.mittel.as_deref().map(mittel_aus).transpose()?,
        wert: req.wert.as_deref().map(wert_aus).transpose()?,
        hinweis: match req.hinweis {
            None => None,
            Some(h) => Some(hinweis_aus(h)?),
        },
    };
    if patch == kommunikation::VerbindungPatch::default() {
        return Err(AppError::Validation(
            "erwartet mittel, wert und/oder hinweis".into(),
        ));
    }
    let plan = kommunikation::verbindung_aendern(
        &state.pool,
        einsatz_id,
        verbindung_id,
        ctx.benutzer.id,
        &patch,
    )
    .await?;
    sse(&state, einsatz_id);
    Ok(Json(plan))
}

/// DELETE /api/einsaetze/{id}/stab/kommunikationsplan/verbindungen/{vid}
pub async fn kommunikationsplan_verbindung_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, verbindung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<kommunikation::KommunikationsStelle>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let plan = kommunikation::verbindung_entfernen(&state.pool, einsatz_id, verbindung_id).await?;
    sse(&state, einsatz_id);
    Ok(Json(plan))
}

/// PUT /api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid}/sprechgruppen/{sg} — Kanal
/// einer externen Stelle mit Status setzen (LFH-893, design.md D5/D14). Idempotent; eine
/// Funktion ist 422, eine fremde Sprechgruppe 422 (dieselbe Prüfung wie der PATCH der
/// Datensätze).
pub async fn kommunikationsplan_kanal_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, stelle_id, sg)): PfadParam<(i64, i64, i64)>,
    JsonBody(req): JsonBody<KanalSetzen>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let status = status_aus(&req.status)?;
    let org_id = ctx.einsatz.org_id;
    if kommunikation::kanal_setzen(&state.pool, org_id, einsatz_id, stelle_id, sg, status).await? {
        sse(&state, einsatz_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE …/stab/kommunikationsplan/stellen/{sid}/sprechgruppen/{sg} — Kanal lösen, idempotent.
pub async fn kommunikationsplan_kanal_loesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, stelle_id, sg)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if kommunikation::kanal_loesen(&state.pool, einsatz_id, stelle_id, sg).await? {
        sse(&state, einsatz_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KanalSetzen {
    status: String,
}

// ── Fernmeldeskizze (LFH-893) ───────────────────────────────────────────────────────────────
//
// Gates wie die übrigen Stab-Routen; jede wirksame Schreibaktion sendet `LiveEvent::Stab`, kein
// ETB. API-Vertrag: `openspec/changes/lfh-893-taktische-fernmeldeskizze/design.md` (D14). Die
// Linie 400 ↔ 422 wie überall (LFH-267): unbekannter Wert, Länge, fehlendes Pflichtfeld,
// nicht-positive Größe → 400; Endpunkte, die nicht zusammenpassen oder nicht zum Einsatz
// gehören → 422; abweichende Version → 409 mit dem gespeichertem Stand.

fn status_aus(wert: &str) -> Result<Verbindungsstatus, AppError> {
    support::parse_enum(
        Verbindungsstatus::parse,
        wert,
        format!("Unbekannter Status '{wert}' (erlaubt: bestehend, geplant)"),
    )
}

fn komponentenart_aus(wert: &str) -> Result<Komponentenart, AppError> {
    support::parse_enum(
        Komponentenart::parse,
        wert,
        format!(
            "Unbekannte Komponentenart '{wert}' (erlaubt: repeater, gateway, basisstation, \
             mobile_basisstation, antenne, vermittlung)"
        ),
    )
}

fn verbindungsart_aus(wert: &str) -> Result<Verbindungsart, AppError> {
    support::parse_enum(
        Verbindungsart::parse,
        wert,
        format!(
            "Unbekannte Verbindungsart '{wert}' (erlaubt: telefon, fax, daten, melder, bild, \
             livestream, richtfunk, satellit, sonstige)"
        ),
    )
}

fn medium_aus(wert: &str) -> Result<Verbindungsmedium, AppError> {
    support::parse_enum(
        Verbindungsmedium::parse,
        wert,
        format!("Unbekanntes Medium '{wert}' (erlaubt: funk, leitung)"),
    )
}

fn verkehr_aus(wert: &str) -> Result<Verkehrsart, AppError> {
    support::parse_enum(
        Verkehrsart::parse,
        wert,
        format!("Unbekannte Betriebsart '{wert}' (erlaubt: wechsel, gegen)"),
    )
}

/// Getrimmter optionaler Text höchstens `max` Zeichen; leer zählt als fehlend.
fn text_hoechstens(
    text: Option<String>,
    feld: &str,
    max: usize,
) -> Result<Option<String>, AppError> {
    let t = text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    if let Some(t) = &t {
        if t.chars().count() > max {
            return Err(AppError::Validation(format!(
                "{feld} darf höchstens {max} Zeichen lang sein"
            )));
        }
    }
    Ok(t)
}

/// Eine Größe (Breite, Höhe) muss positiv sein — ein Feld für sich → 400.
fn positiv(wert: f64, feld: &str) -> Result<f64, AppError> {
    if !(wert.is_finite() && wert > 0.0) {
        return Err(AppError::Validation(format!(
            "{feld} muss größer als 0 sein"
        )));
    }
    Ok(wert)
}

fn endlich(wert: f64, feld: &str) -> Result<f64, AppError> {
    if !wert.is_finite() {
        return Err(AppError::Validation(format!("{feld} ist keine Zahl")));
    }
    Ok(wert)
}

/// GET /api/einsaetze/{id}/stab/fernmeldeskizze — die Skizzendaten (alle mit Stab-Leserecht).
pub async fn fernmeldeskizze_laden(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<Fernmeldeskizze>, AppError> {
    Ok(Json(skizze::laden(&state.pool, ctx.einsatz.id).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LageSetzen {
    x: f64,
    y: f64,
    /// Fehlt = unverändert, `null` = leeren; nur bei Schienen.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    breite: Option<Option<f64>>,
    /// Pflicht: erwartete Version, `null` = noch keine Zeile erwartet. Ein fehlendes Feld ist
    /// 400, damit kein Aufruf aus Versehen „ohne Erwartung“ schreibt.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    version: Option<Option<i64>>,
}

/// PUT /api/einsaetze/{id}/stab/fernmeldeskizze/lage/{element} — Element verschieben (D4).
/// Weicht die erwartete Version ab, antwortet der Server 409 mit dem gespeicherten Stand
/// (`SkizzenLageKonflikt`).
pub async fn fernmeldeskizze_lage_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, element)): PfadParam<(i64, String)>,
    JsonBody(req): JsonBody<LageSetzen>,
) -> Result<Response, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let element = skizze::Element::parse(&element).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekanntes Element '{element}' (erwartet fs, ab-<id>, eh-<id>, ks-<id>, ko-<id>, \
             sg-<id>)"
        ))
    })?;
    let Some(version) = req.version else {
        return Err(AppError::Validation(
            "version fehlt (null = noch keine Lage erwartet)".into(),
        ));
    };
    let breite = match req.breite {
        Some(Some(b)) => Some(Some(positiv(b, "breite")?)),
        andere => andere,
    };
    let eingabe = skizze::LageEingabe {
        x: endlich(req.x, "x")?,
        y: endlich(req.y, "y")?,
        breite,
        version,
    };
    match skizze::lage_setzen(&state.pool, einsatz_id, ctx.benutzer.id, element, &eingabe).await? {
        LageErgebnis::Gesetzt(lage) => {
            sse(&state, einsatz_id);
            Ok(Json::<SkizzenLage>(lage).into_response())
        }
        LageErgebnis::Konflikt(aktuell) => Ok((
            StatusCode::CONFLICT,
            Json(SkizzenLageKonflikt {
                error: "Von einem anderen Arbeitsplatz verschoben".into(),
                aktuell,
            }),
        )
            .into_response()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LageVerwerfen {
    /// Pflicht: erwartete Version der Zeile.
    version: Option<i64>,
}

/// DELETE /api/einsaetze/{id}/stab/fernmeldeskizze/lage/{element} — die Lage EINES Elements
/// verwerfen (Review O3, Rückgängig des ersten Verschiebens). Body `{ version }`; weicht sie ab,
/// 409 mit dem gespeicherten Stand wie beim Verschieben. Ohne Zeile 204 ohne Ereignis.
pub async fn fernmeldeskizze_lage_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, element)): PfadParam<(i64, String)>,
    JsonBody(req): JsonBody<LageVerwerfen>,
) -> Result<Response, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let element = skizze::Element::parse(&element).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekanntes Element '{element}' (erwartet fs, ab-<id>, eh-<id>, ks-<id>, ko-<id>, \
             sg-<id>)"
        ))
    })?;
    let Some(version) = req.version else {
        return Err(AppError::Validation("version fehlt".into()));
    };
    match skizze::lage_entfernen(&state.pool, einsatz_id, element, version).await? {
        skizze::LageVerworfen::Entfernt => {
            sse(&state, einsatz_id);
            Ok(StatusCode::NO_CONTENT.into_response())
        }
        skizze::LageVerworfen::Unveraendert => Ok(StatusCode::NO_CONTENT.into_response()),
        skizze::LageVerworfen::Konflikt(aktuell) => Ok((
            StatusCode::CONFLICT,
            Json(SkizzenLageKonflikt {
                error: "Von einem anderen Arbeitsplatz verschoben".into(),
                aktuell: Some(aktuell),
            }),
        )
            .into_response()),
    }
}

/// DELETE /api/einsaetze/{id}/stab/fernmeldeskizze/lage — „Neu anordnen“: alle Lagen verwerfen.
pub async fn fernmeldeskizze_lage_verwerfen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if skizze::lage_verwerfen(&state.pool, einsatz_id).await? {
        sse(&state, einsatz_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SchriftfeldSetzen {
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    herausgeber: Option<Option<String>>,
    /// Kein Tri-State: es gibt immer einen VS-Vermerk (`keiner`); `null` ist 400.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    vs_vermerk: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    gueltig_ab: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    gez_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    gez_at: Option<Option<String>>,
}

/// Tri-State-Text mit Höchstlänge: `Some(None)` = leeren (auch bei leerem Text).
fn tri_text(
    wert: Option<Option<String>>,
    feld: &str,
    max: usize,
) -> Result<Option<Option<String>>, AppError> {
    wert.map(|w| text_hoechstens(w, feld, max)).transpose()
}

/// Tri-State-Zeit nach der Zeitkonvention: ISO-8601 mit Zone (`etb::normalisiere_zeit`) oder
/// Formulareingabe ohne Sekunden (`zeit::normalisiere_eingabe`); unparsebar → 400.
fn tri_zeit(wert: Option<Option<String>>) -> Result<Option<Option<String>>, AppError> {
    match support::trimme_tri(wert) {
        Some(Some(z)) => {
            let n = match crate::etb::normalisiere_zeit(&z) {
                Ok(n) => n,
                Err(e) => crate::zeit::normalisiere_eingabe(&z).ok_or(e)?,
            };
            Ok(Some(Some(n)))
        }
        andere => Ok(andere),
    }
}

/// PUT /api/einsaetze/{id}/stab/fernmeldeskizze/schriftfeld — Teilfelder setzen (Tri-State).
pub async fn fernmeldeskizze_schriftfeld_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<SchriftfeldSetzen>,
) -> Result<Json<Schriftfeld>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let vs_vermerk = match req.vs_vermerk {
        None => None,
        Some(None) => {
            return Err(AppError::Validation(
                "vs_vermerk kann nicht geleert werden (erlaubt: keiner, vs_nfd)".into(),
            ))
        }
        Some(Some(v)) => Some(support::parse_enum(
            VsVermerk::parse,
            &v,
            format!("Unbekannter VS-Vermerk '{v}' (erlaubt: keiner, vs_nfd)"),
        )?),
    };
    let patch = skizze::SchriftfeldPatch {
        herausgeber: tri_text(req.herausgeber, "herausgeber", skizze::HERAUSGEBER_MAX)?,
        vs_vermerk,
        gueltig_ab: tri_zeit(req.gueltig_ab)?,
        gez_name: tri_text(req.gez_name, "gez_name", skizze::GEZ_NAME_MAX)?,
        gez_at: tri_zeit(req.gez_at)?,
    };
    if patch == skizze::SchriftfeldPatch::default() {
        return Err(AppError::Validation(
            "erwartet herausgeber, vs_vermerk, gueltig_ab, gez_name und/oder gez_at".into(),
        ));
    }
    let feld = skizze::schriftfeld_setzen(&state.pool, einsatz_id, ctx.benutzer.id, &patch).await?;
    sse(&state, einsatz_id);
    Ok(Json(feld))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KomponenteNeu {
    art: String,
    #[serde(default)]
    bezeichnung: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KomponentePatchBody {
    #[serde(default)]
    art: Option<String>,
    /// **Tri-State**: fehlt = unverändert, `null` oder leer = leeren.
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    bezeichnung: Option<Option<String>>,
}

/// POST /api/einsaetze/{id}/stab/fernmeldeskizze/komponenten — Komponente anlegen.
pub async fn fernmeldeskizze_komponente_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<KomponenteNeu>,
) -> Result<(StatusCode, Json<SkizzenKomponente>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let art = komponentenart_aus(&req.art)?;
    let bezeichnung = text_hoechstens(req.bezeichnung, "bezeichnung", skizze::BEZEICHNUNG_MAX)?;
    let k = skizze::komponente_anlegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        art,
        bezeichnung.as_deref(),
    )
    .await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(k)))
}

/// PATCH /api/einsaetze/{id}/stab/fernmeldeskizze/komponenten/{kid}
pub async fn fernmeldeskizze_komponente_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, kid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<KomponentePatchBody>,
) -> Result<Json<SkizzenKomponente>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let patch = skizze::KomponentePatch {
        art: req.art.as_deref().map(komponentenart_aus).transpose()?,
        bezeichnung: tri_text(req.bezeichnung, "bezeichnung", skizze::BEZEICHNUNG_MAX)?,
    };
    if patch == skizze::KomponentePatch::default() {
        return Err(AppError::Validation(
            "erwartet art und/oder bezeichnung".into(),
        ));
    }
    let k =
        skizze::komponente_aendern(&state.pool, einsatz_id, kid, ctx.benutzer.id, &patch).await?;
    sse(&state, einsatz_id);
    Ok(Json(k))
}

/// DELETE /api/einsaetze/{id}/stab/fernmeldeskizze/komponenten/{kid} — samt Kanälen, Lage und
/// Verbindungen.
pub async fn fernmeldeskizze_komponente_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, kid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    skizze::komponente_entfernen(&state.pool, einsatz_id, kid).await?;
    sse(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}

/// PUT /api/einsaetze/{id}/stab/fernmeldeskizze/komponenten/{kid}/sprechgruppen/{sg}
pub async fn fernmeldeskizze_komponente_kanal_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, kid, sg)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    if skizze::komponente_kanal_setzen(&state.pool, org_id, einsatz_id, kid, sg).await? {
        sse(&state, einsatz_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/einsaetze/{id}/stab/fernmeldeskizze/komponenten/{kid}/sprechgruppen/{sg}
pub async fn fernmeldeskizze_komponente_kanal_loesen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, kid, sg)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    if skizze::komponente_kanal_loesen(&state.pool, einsatz_id, kid, sg).await? {
        sse(&state, einsatz_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BezugBody {
    art: String,
    #[serde(default)]
    id: Option<i64>,
}

impl BezugBody {
    fn element(&self) -> Result<skizze::Element, AppError> {
        let art = support::parse_enum(
            SkizzenBezugArt::parse,
            &self.art,
            format!(
                "Unbekannter Bezug '{}' (erlaubt: fuehrungsstelle, abschnitt, einheit, stelle, \
                 komponente)",
                self.art
            ),
        )?;
        skizze::Element::aus_bezug(art, self.id)
    }
}

/// Neue Verbindung. **Keine Rufnummer**: ein unbekanntes Feld (etwa `rufnummer`) ist 400.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerbindungNeu {
    von: BezugBody,
    nach: BezugBody,
    art: String,
    medium: String,
    status: String,
    #[serde(default)]
    verkehr: Option<String>,
    #[serde(default)]
    hinweis: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerbindungPatchBody {
    #[serde(default)]
    art: Option<String>,
    #[serde(default)]
    medium: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    verkehr: Option<Option<String>>,
    #[serde(default, deserialize_with = "support::deserialize_optional_field")]
    hinweis: Option<Option<String>>,
}

/// POST /api/einsaetze/{id}/stab/fernmeldeskizze/verbindungen — Punkt-zu-Punkt-Verbindung.
pub async fn fernmeldeskizze_verbindung_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<VerbindungNeu>,
) -> Result<(StatusCode, Json<SkizzenVerbindung>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    // Erst jedes Feld für sich (400), dann der Zusammenhang der Endpunkte (422).
    let art = verbindungsart_aus(&req.art)?;
    let medium = medium_aus(&req.medium)?;
    let status = status_aus(&req.status)?;
    let verkehr = req.verkehr.as_deref().map(verkehr_aus).transpose()?;
    let hinweis = text_hoechstens(req.hinweis, "hinweis", skizze::HINWEIS_MAX)?;
    for b in [&req.von, &req.nach] {
        support::parse_enum(
            SkizzenBezugArt::parse,
            &b.art,
            format!("Unbekannter Bezug '{}'", b.art),
        )?;
    }
    let eingabe = skizze::VerbindungEingabe {
        von: req.von.element()?,
        nach: req.nach.element()?,
        art,
        medium,
        status,
        verkehr,
        hinweis,
    };
    let v = skizze::verbindung_anlegen(&state.pool, einsatz_id, ctx.benutzer.id, &eingabe).await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(v)))
}

/// PATCH /api/einsaetze/{id}/stab/fernmeldeskizze/verbindungen/{vid} — ohne Endpunkte.
pub async fn fernmeldeskizze_verbindung_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, vid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<VerbindungPatchBody>,
) -> Result<Json<SkizzenVerbindung>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let patch = skizze::VerbindungPatch {
        art: req.art.as_deref().map(verbindungsart_aus).transpose()?,
        medium: req.medium.as_deref().map(medium_aus).transpose()?,
        status: req.status.as_deref().map(status_aus).transpose()?,
        verkehr: match req.verkehr {
            None => None,
            Some(v) => Some(v.as_deref().map(verkehr_aus).transpose()?),
        },
        hinweis: tri_text(req.hinweis, "hinweis", skizze::HINWEIS_MAX)?,
    };
    if patch == skizze::VerbindungPatch::default() {
        return Err(AppError::Validation(
            "erwartet art, medium, status, verkehr und/oder hinweis".into(),
        ));
    }
    let v =
        skizze::verbindung_aendern(&state.pool, einsatz_id, vid, ctx.benutzer.id, &patch).await?;
    sse(&state, einsatz_id);
    Ok(Json(v))
}

/// DELETE /api/einsaetze/{id}/stab/fernmeldeskizze/verbindungen/{vid}
pub async fn fernmeldeskizze_verbindung_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, vid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    skizze::verbindung_entfernen(&state.pool, einsatz_id, vid).await?;
    sse(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BereichNeu {
    #[serde(default)]
    bezeichnung: Option<String>,
    x: f64,
    y: f64,
    breite: f64,
    hoehe: f64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BereichPatchBody {
    #[serde(default)]
    bezeichnung: Option<String>,
    #[serde(default)]
    x: Option<f64>,
    #[serde(default)]
    y: Option<f64>,
    #[serde(default)]
    breite: Option<f64>,
    #[serde(default)]
    hoehe: Option<f64>,
    version: i64,
}

/// POST /api/einsaetze/{id}/stab/fernmeldeskizze/bereiche — Bereich anlegen (Vorgabe
/// „Rückwärtiger Bereich“).
pub async fn fernmeldeskizze_bereich_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<BereichNeu>,
) -> Result<(StatusCode, Json<SkizzenBereich>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let eingabe = skizze::BereichEingabe {
        bezeichnung: text_hoechstens(req.bezeichnung, "bezeichnung", skizze::BEZEICHNUNG_MAX)?
            .unwrap_or_else(|| skizze::BEREICH_VORGABE.to_string()),
        x: endlich(req.x, "x")?,
        y: endlich(req.y, "y")?,
        breite: positiv(req.breite, "breite")?,
        hoehe: positiv(req.hoehe, "hoehe")?,
    };
    let b = skizze::bereich_anlegen(&state.pool, einsatz_id, ctx.benutzer.id, &eingabe).await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(b)))
}

/// PATCH /api/einsaetze/{id}/stab/fernmeldeskizze/bereiche/{bid} — Lage, Größe, Bezeichnung mit
/// erwarteter Version (409 mit `SkizzenBereichKonflikt`).
pub async fn fernmeldeskizze_bereich_aendern(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, bid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<BereichPatchBody>,
) -> Result<Response, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let bezeichnung = match req.bezeichnung {
        Some(b) => Some(
            text_hoechstens(Some(b), "bezeichnung", skizze::BEZEICHNUNG_MAX)?
                .ok_or_else(|| AppError::Validation("bezeichnung darf nicht leer sein".into()))?,
        ),
        None => None,
    };
    let patch = skizze::BereichPatch {
        bezeichnung,
        x: req.x.map(|x| endlich(x, "x")).transpose()?,
        y: req.y.map(|y| endlich(y, "y")).transpose()?,
        breite: req.breite.map(|b| positiv(b, "breite")).transpose()?,
        hoehe: req.hoehe.map(|h| positiv(h, "hoehe")).transpose()?,
        version: req.version,
    };
    match skizze::bereich_aendern(&state.pool, einsatz_id, bid, ctx.benutzer.id, &patch).await? {
        BereichErgebnis::Geaendert(b) => {
            sse(&state, einsatz_id);
            Ok(Json(b).into_response())
        }
        BereichErgebnis::Konflikt(aktuell) => Ok((
            StatusCode::CONFLICT,
            Json(SkizzenBereichKonflikt {
                error: "Von einem anderen Arbeitsplatz geändert".into(),
                aktuell,
            }),
        )
            .into_response()),
    }
}

/// DELETE /api/einsaetze/{id}/stab/fernmeldeskizze/bereiche/{bid}
pub async fn fernmeldeskizze_bereich_entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_einsatz_id, bid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    skizze::bereich_entfernen(&state.pool, einsatz_id, bid).await?;
    sse(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(art: &str, pid: Option<i64>, bez: Option<&str>) -> BesetzungSetzen {
        BesetzungSetzen {
            besetzung_art: art.to_string(),
            personal_id: pid,
            bezeichnung: bez.map(str::to_string),
        }
    }

    #[test]
    fn unbekanntes_sachgebiet_ist_400() {
        let err = sachgebiet_aus_pfad("s7").unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        assert!(sachgebiet_aus_pfad("s1").is_ok());
    }

    #[test]
    fn unbekannte_besetzungsart_ist_400() {
        let err = validiere(req("nicht_vergeben", None, None)).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    /// Die Länge scheitert am Feld ISOLIERT → 400, nicht 422.
    #[test]
    fn zu_lange_bezeichnung_ist_400() {
        let lang = "x".repeat(BEZEICHNUNG_MAX + 1);
        let err = validiere(req("extern", None, Some(&lang))).unwrap_err();
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
        let grenze = "x".repeat(BEZEICHNUNG_MAX);
        assert!(validiere(req("extern", None, Some(&grenze))).is_ok());
    }

    /// Bedingte Pflicht = Zusammenhang → 422.
    #[test]
    fn bedingte_pflichten_sind_422() {
        for fall in [
            req("personal", None, None),
            req("extern", None, None),
            req("rueckwaertig", None, None),
            req("einsatzleitung", Some(5), None),
            req("einsatzleitung", None, Some("X")),
            req("personal", Some(5), Some("X")),
            req("extern", Some(5), Some("X")),
        ] {
            let err = validiere(fall).unwrap_err();
            assert_eq!(
                err.status(),
                StatusCode::UNPROCESSABLE_ENTITY,
                "erwartet 422: {err}"
            );
        }
    }

    /// Eine leere/whitespace-`bezeichnung` ist wie „fehlt" zu behandeln — sonst landete ein
    /// Leerstring als Name eines Externen in einem Führungsnachweis.
    #[test]
    fn leere_bezeichnung_zaehlt_als_fehlend() {
        let err = validiere(req("extern", None, Some("   "))).unwrap_err();
        assert_eq!(err.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn gueltige_faelle_gehen_durch() {
        assert!(validiere(req("einsatzleitung", None, None)).is_ok());
        assert!(validiere(req("personal", Some(7), None)).is_ok());
        let e = validiere(req("rueckwaertig", None, Some(" Leitstelle "))).unwrap();
        assert_eq!(e.bezeichnung.as_deref(), Some("Leitstelle"), "getrimmt");
    }
}
