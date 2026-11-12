//! Richtwerte des Unterkunfts- und Zeltrechners (LLH-1520, design.md D2).
//!
//! Die Oberfläche rechnet im Browser (`frontend/src/betreuung/unterkunft/rechnerKern.ts`), damit
//! es ohne Netz geht. Der Server hält die Ebenen der Richtwerte: Basis im Programm
//! (`richtwerte_basis.json`, dieselbe Datei importiert die Oberfläche), darüber die Organisation
//! und darüber der Einsatz. Wirksam ist je Schlüssel die höchste gesetzte Ebene.
//!
//! Für Fremdsysteme rechnet der Server selbst (LLH-1524, Spec `rechner-api-unterkunft`): der
//! Rechenkern [`rechner`] bildet den TS-Kern nach, die Routen stehen in
//! `crate::public_api::rechner`. Dort gilt Anfrage vor Organisation vor Basis, ohne Einsatz.

pub mod rechner;
pub mod repo;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use utoipa::ToSchema;

use crate::error::AppError;

/// Ein Basis-Richtwert aus der Datei. Quelle und Beleg liest nur die Oberfläche aus derselben
/// Datei; der Server braucht Wert und Grenzen, die Auskunft der Rechner-API dazu Bezeichnung,
/// Gruppe und Einheit.
#[derive(Debug, Deserialize)]
pub struct Basiswert {
    pub schluessel: String,
    pub gruppe: String,
    pub bezeichnung: String,
    pub wert: f64,
    pub einheit: String,
    pub min: f64,
    pub max: f64,
    pub ganzzahl: bool,
}

/// Ein Zelttyp der Basis. Seine Richtwerte heißen `zelt_<typ>_…`.
#[derive(Debug, Deserialize)]
pub struct Zelttyp {
    pub typ: String,
    pub bezeichnung: String,
}

#[derive(Debug, Deserialize)]
struct BasisDatei {
    stand: String,
    zelttypen: Vec<Zelttyp>,
    werte: Vec<Basiswert>,
}

/// Die Basis, einmal gelesen. Ein Lesefehler ist ein Baufehler: `basis_ist_lesbar` fängt ihn.
static BASIS: LazyLock<BasisDatei> = LazyLock::new(|| {
    serde_json::from_str(include_str!("richtwerte_basis.json"))
        .expect("richtwerte_basis.json ist lesbar")
});

/// Alle Basiswerte in der Reihenfolge der Datei.
pub fn basis() -> &'static [Basiswert] {
    &BASIS.werte
}

/// Die Zelttypen in der Reihenfolge der Datei.
pub fn zelttypen() -> &'static [Zelttyp] {
    &BASIS.zelttypen
}

/// Stand der Basis (Datum der Recherche).
pub fn stand() -> &'static str {
    &BASIS.stand
}

fn basiswert(schluessel: &str) -> Option<&'static Basiswert> {
    BASIS.werte.iter().find(|b| b.schluessel == schluessel)
}

/// Prüft einen Override: bekannter Schlüssel (sonst 400), endliche Zahl in den Grenzen, bei
/// Ganzzahl-Werten ohne Nachkommastellen (sonst 400).
pub fn pruefe(schluessel: &str, wert: f64) -> Result<(), AppError> {
    let b = basiswert(schluessel)
        .ok_or_else(|| AppError::Validation(format!("Unbekannter Richtwert '{schluessel}'")))?;
    if !wert.is_finite() || wert < b.min || wert > b.max {
        return Err(AppError::Validation(format!(
            "{schluessel} muss zwischen {} und {} liegen",
            zahl(b.min),
            zahl(b.max)
        )));
    }
    if b.ganzzahl && wert.fract() != 0.0 {
        return Err(AppError::Validation(format!(
            "{schluessel} muss eine ganze Zahl sein"
        )));
    }
    Ok(())
}

/// Prüft nur den Schlüssel (für das Zurücksetzen auf die Vorgabe).
pub fn pruefe_schluessel(schluessel: &str) -> Result<(), AppError> {
    basiswert(schluessel)
        .map(|_| ())
        .ok_or_else(|| AppError::Validation(format!("Unbekannter Richtwert '{schluessel}'")))
}

fn zahl(x: f64) -> String {
    let s = format!("{x}");
    s.replace('.', ",")
}

/// Woher der wirksame Wert stammt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RichtwertHerkunft {
    Basis,
    Org,
    Einsatz,
}

/// Ein Richtwert mit allen Ebenen. `org`/`einsatz` sind `null`, wenn die Ebene erbt.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct RichtwertEbenen {
    pub schluessel: String,
    pub basis: f64,
    pub org: Option<f64>,
    pub einsatz: Option<f64>,
    /// Wirksamer Wert: Einsatz vor Organisation vor Basis.
    pub wert: f64,
    pub herkunft: RichtwertHerkunft,
}

/// Antwort der Richtwert-Routen: Stand der Basis und alle Schlüssel in der Reihenfolge der Datei.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct UnterkunftRichtwerte {
    pub stand: String,
    pub werte: Vec<RichtwertEbenen>,
}

/// Führt die Ebenen zusammen. Unbekannte Schlüssel in den Overrides (etwa ein später entfernter
/// Richtwert) fallen still weg; die Schreibwege lassen keine neuen zu.
pub fn zusammenfuehren(
    org: &HashMap<String, f64>,
    einsatz: Option<&HashMap<String, f64>>,
) -> UnterkunftRichtwerte {
    let werte = basis()
        .iter()
        .map(|b| {
            let o = org.get(&b.schluessel).copied();
            let e = einsatz.and_then(|m| m.get(&b.schluessel).copied());
            let (wert, herkunft) = match (e, o) {
                (Some(e), _) => (e, RichtwertHerkunft::Einsatz),
                (None, Some(o)) => (o, RichtwertHerkunft::Org),
                (None, None) => (b.wert, RichtwertHerkunft::Basis),
            };
            RichtwertEbenen {
                schluessel: b.schluessel.clone(),
                basis: b.wert,
                org: o,
                einsatz: e,
                wert,
                herkunft,
            }
        })
        .collect();
    UnterkunftRichtwerte {
        stand: stand().to_string(),
        werte,
    }
}
