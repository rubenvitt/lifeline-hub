//! Routen der Führungsorganisation (LFH-46): Besetzung der Sachgebiete S1–S6, Lagebesprechung
//! und die Checkliste Arbeitsaufnahme (LFH-551).
//!
//! Gates strukturell über die Extractor-Typen — `EinsatzLesezugriff<Stab>` (alle
//! Einsatzmitglieder inkl. Beobachter) bzw. `EinsatzSchreibzugriff<Stab>` (Einsatzleitung,
//! Führungspersonal, System-Admin; enthält `fordere_aktiv`). Das Sachgebiet verleiht
//! **kein** Recht (Entscheidung 12 der Spec).

use axum::extract::State;
use axum::http::StatusCode;
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
// `openspec/changes/lfh-848-kommunikationsplan/design.md` (D3).

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

/// POST /api/einsaetze/{id}/stab/kommunikationsplan/stellen — Stelle anlegen.
pub async fn kommunikationsplan_stelle_anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<KommunikationsStelleNeu>,
) -> Result<(StatusCode, Json<Vec<kommunikation::KommunikationsStelle>>), AppError> {
    let einsatz_id = ctx.einsatz.id;
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
    let plan =
        kommunikation::stelle_anlegen(&state.pool, einsatz_id, ctx.benutzer.id, &eingabe).await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(plan)))
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
