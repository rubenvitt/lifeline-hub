//! Routen der Führungsorganisation (LFH-46): Besetzung der Sachgebiete S1–S6.
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
use crate::stab::repo::{self, BesetzungEingabe};
use crate::stab::{BesetzungArt, Sachgebiet, StabAnzeige, BEZEICHNUNG_MAX};

fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Stab,
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
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
    let stab = repo::setzen(
        &state.pool,
        einsatz_id,
        sachgebiet,
        ctx.benutzer.id,
        &eingabe,
    )
    .await?;
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
    let geaendert = repo::entfernen(&state.pool, einsatz_id, sachgebiet, ctx.benutzer.id).await?;
    if geaendert {
        sse(&state, einsatz_id);
    }
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
