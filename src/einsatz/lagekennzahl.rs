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
/// hier steht nur, welche Auslöser gesetzt sind. Die Reihenfolge der Varianten ist die
/// Reihenfolge der Ausgabe von [`ableiten`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Lagekennzahl {
    /// Mindestens ein maßgeblicher Pegel ist festgelegt (`einsatz_pegel`, LFH-606).
    Pegel,
    /// Mindestens ein aktiver Evakuierungsbezirk (LFH-607): nicht storniert, Räumung nicht
    /// `aufgehoben`. Das Anlegen eines Bezirks IST die Anordnung samt Plangröße (CHECK
    /// `plan_personen >= 1`); Aufheben oder Stornieren des letzten nimmt sie zurück.
    Evakuiert,
}

impl Lagekennzahl {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Lagekennzahl::Pegel => "pegel",
            Lagekennzahl::Evakuiert => "evakuiert",
        }
    }
}

/// Die aktiven Lagekennzahlen aus den Auslösern — EINE Ableitung für beide Stellen, an denen
/// `EinsatzAnzeige` entsteht (`Einsatz::anzeige`, `repo::liste_fuer`). Rein.
///
/// Beide Auslöser liefern beide Abfragen als `EXISTS`-Spalte:
///
/// - `pegel_festgelegt`: `EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = e.id)`
/// - `evakuierung_angeordnet`: `EXISTS` über `evakuierungsbezirk` mit `storniert_at IS NULL`
///   und `raeumung <> 'aufgehoben'`. Das Prädikat ist wortgleich zu `istAktiverBezirk` im
///   Frontend (`betreuung/evakuierungKennzahl.ts`) — laufen die beiden auseinander, steht
///   „Evakuiert" auf dem Platz, aber die Kennzahl daneben ist leer.
///
/// Die Ausdrücke stehen in beiden SQL-Literalen, nicht als geteilte Konstante: `query_as`
/// nimmt unter sqlx 0.9 nur `&'static str`, ein `format!` bräche den Build. Dass Detail und
/// Liste übereinstimmen, prüfen `tests/pegel.rs`
/// (`pegel_festlegen_schaltet_die_lagekennzahl_am_einsatz`) und `tests/betreuung.rs`
/// (`bezirk_schaltet_die_lagekennzahl_am_einsatz`).
pub fn ableiten(pegel_festgelegt: bool, evakuierung_angeordnet: bool) -> Vec<Lagekennzahl> {
    let mut aktiv = Vec::new();
    if pegel_festgelegt {
        aktiv.push(Lagekennzahl::Pegel);
    }
    if evakuierung_angeordnet {
        aktiv.push(Lagekennzahl::Evakuiert);
    }
    aktiv
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ohne_ausloeser_leer() {
        assert_eq!(ableiten(false, false), Vec::<Lagekennzahl>::new());
    }

    #[test]
    fn pegel_festgelegt_schaltet_pegel() {
        assert_eq!(ableiten(true, false), vec![Lagekennzahl::Pegel]);
    }

    #[test]
    fn evakuierung_angeordnet_schaltet_evakuiert() {
        assert_eq!(ableiten(false, true), vec![Lagekennzahl::Evakuiert]);
    }

    #[test]
    fn beide_in_enum_reihenfolge() {
        assert_eq!(
            ableiten(true, true),
            vec![Lagekennzahl::Pegel, Lagekennzahl::Evakuiert]
        );
    }

    #[test]
    fn wire_evakuiert() {
        assert_eq!(Lagekennzahl::Evakuiert.as_str(), "evakuiert");
    }
}
