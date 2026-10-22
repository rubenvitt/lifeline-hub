//! Wahl der Lagekennzahlen eines Einsatzes (LLH-1371).
//!
//! `PUT /api/einsaetze/{id}/lagekennzahl-wahl` ersetzt die gewählten Lagekennzahlen vollständig.
//! Heute ist nur „Nachforderungen offen“ wählbar (Lageplatz B hinter „Evakuiert“, Frontend
//! `pages/lage-dashboard/lagebild.ts`). Gelesen wird die Wahl nicht hier, sondern als Teil von
//! `EinsatzAnzeige.lagekennzahlen` — jeder Leser des Einsatzes sieht, DASS gewählt ist; die Zahl
//! selbst liefert nur der Modulzähler, der ohne Modulrecht fehlt (design.md D5).
//!
//! Gate `EinsatzSchreibzugriff<OhneModul>` wie die Pegel-Festlegung (`routes::pegel`): eine
//! Lageentscheidung, modul-los wie die Kopfdaten. **400** für eine nicht wählbare oder unbekannte
//! Kennzahl und eine Liste über [`WAHL_MAX`] (das Feld für sich). Schaltet die Wahl die aktiven
//! Lagekennzahlen um, meldet die Route nach dem Commit den Einsatzkopf (LFH-855); ein
//! gleichbleibender Stand meldet nichts. Kein ETB-Eintrag (wie die Pegel-Festlegung).
//! Herleitung: `/mnt/project-files/llh-1021/llh-1371/design.md` D1–D5.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzSchreibzugriff;
use crate::einsatz::lagekennzahl::{self, Lagekennzahl, WAHL_MAX};
use crate::einsatz::modul::OhneModul;
use crate::error::AppError;
use crate::extract::JsonBody;

/// Body der Wahl: die gewählten Lagekennzahlen als Wire-Werte (Vollersatz).
#[derive(Debug, Deserialize)]
pub struct WahlEingabe {
    gewaehlt: Vec<String>,
}

/// Antwort der Wahl: die gespeicherten gewählten Lagekennzahlen.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagekennzahlWahl {
    pub gewaehlt: Vec<Lagekennzahl>,
}

/// Prüft und entdoppelt die Wahl (400 je Feldfehler). Reihenfolge der Ausgabe = Enum.
fn pruefe(eingabe: &[String]) -> Result<Vec<Lagekennzahl>, AppError> {
    if eingabe.len() > WAHL_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {WAHL_MAX} Einträge in gewaehlt"
        )));
    }
    let mut gewaehlt = Vec::new();
    for wert in eingabe {
        let kennzahl = Lagekennzahl::parse(wert)
            .filter(|k| k.ist_waehlbar())
            .ok_or_else(|| {
                AppError::Validation(format!("Lagekennzahl '{wert}' ist nicht wählbar"))
            })?;
        if !gewaehlt.contains(&kennzahl) {
            gewaehlt.push(kennzahl);
        }
    }
    gewaehlt.sort();
    Ok(gewaehlt)
}

/// PUT /api/einsaetze/{id}/lagekennzahl-wahl — die gewählten Lagekennzahlen ersetzen.
pub async fn setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<OhneModul>,
    JsonBody(req): JsonBody<WahlEingabe>,
) -> Result<Json<LagekennzahlWahl>, AppError> {
    let gewaehlt = pruefe(&req.gewaehlt)?;
    let ergebnis =
        lagekennzahl::waehlen(&state.pool, ctx.einsatz.id, ctx.benutzer.id, &gewaehlt).await?;
    if ergebnis.umgeschaltet {
        crate::routes::einsatz::kopf_geaendert(&state, ctx.einsatz.id).await;
    }
    Ok(Json(LagekennzahlWahl {
        gewaehlt: ergebnis.gewaehlt,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn werte(w: &[&str]) -> Vec<String> {
        w.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn entdoppelt_die_wahl() {
        assert_eq!(
            pruefe(&werte(&["nachforderungen", "nachforderungen"])).unwrap(),
            vec![Lagekennzahl::Nachforderungen]
        );
        assert_eq!(pruefe(&[]).unwrap(), Vec::<Lagekennzahl>::new());
    }

    #[test]
    fn abgeleitete_und_unbekannte_sind_400() {
        for w in ["pegel", "evakuiert", "quatsch", "Nachforderungen", ""] {
            assert!(
                matches!(pruefe(&werte(&[w])), Err(AppError::Validation(_))),
                "{w}"
            );
        }
    }

    #[test]
    fn zu_lange_liste_ist_400_vor_dem_entdoppeln() {
        let neun = vec!["nachforderungen".to_string(); WAHL_MAX + 1];
        assert!(matches!(pruefe(&neun), Err(AppError::Validation(_))));
        let acht = vec!["nachforderungen".to_string(); WAHL_MAX];
        assert!(pruefe(&acht).is_ok());
    }
}
