//! Lagekennzahlen am Einsatz (LFH-640) — welche lagebezogenen Plätze des Kennzahlenbands im
//! Lage-Dashboard belegt sind.
//!
//! Spec: `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`.
//!
//! Eine Lagekennzahl ist aktiv, wenn eine **bewusste Entscheidung** dafür als Datensatz
//! vorliegt — nie durch einen Messwert, der sich während der Lage ändert. Sonst würde die
//! Reihe mit den Werten flackern (Prüfliste Kriterium 9). Das Feld steht am Einsatz statt an
//! den Fachabfragen: der Einsatz ist die Abfrage, die als erste da ist, und die Belegung der
//! Plätze darf beim Laden nicht wechseln.

use serde::Serialize;
use utoipa::ToSchema;

/// Eine aktive lagebezogene Kennzahl. Wire == `as_str()`.
///
/// Die Plätze und Füllkennzahlen stehen im Frontend (`pages/lage-dashboard/lagebild.ts`);
/// hier steht nur, welche Auslöser gesetzt sind. LFH-607 ergänzt `Evakuiert`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Lagekennzahl {
    /// Mindestens ein maßgeblicher Pegel ist festgelegt (`einsatz_pegel`, LFH-606).
    Pegel,
}

impl Lagekennzahl {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Lagekennzahl::Pegel => "pegel",
        }
    }
}

/// Die aktiven Lagekennzahlen aus den Auslösern — EINE Ableitung für beide Stellen, an denen
/// `EinsatzAnzeige` entsteht (`Einsatz::anzeige`, `repo::liste_fuer`). Rein.
///
/// Den Auslöser `pegel_festgelegt` liefern beide Abfragen als
/// `EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = e.id)`. Der Ausdruck steht in
/// beiden SQL-Literalen, nicht als geteilte Konstante: `query_as` nimmt unter sqlx 0.9 nur
/// `&'static str`, ein `format!` bräche den Build. Dass Detail und Liste übereinstimmen,
/// prüft `tests/pegel.rs` (`pegel_festlegen_schaltet_die_lagekennzahl_am_einsatz`).
pub fn ableiten(pegel_festgelegt: bool) -> Vec<Lagekennzahl> {
    let mut aktiv = Vec::new();
    if pegel_festgelegt {
        aktiv.push(Lagekennzahl::Pegel);
    }
    aktiv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ohne_ausloeser_leer() {
        assert_eq!(ableiten(false), Vec::<Lagekennzahl>::new());
    }

    #[test]
    fn pegel_festgelegt_schaltet_pegel() {
        assert_eq!(ableiten(true), vec![Lagekennzahl::Pegel]);
    }
}
