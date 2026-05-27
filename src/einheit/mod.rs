pub mod typ_repo;

use crate::staerke::Staerke;
use serde::Serialize;

/// Default-Einheitstyp-Katalog je neu angelegter Organisation
/// (label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier).
/// **Muss mit dem Seed in `migrations/0015_einheit_typ.sql` übereinstimmen.**
/// `None`-Soll = "alle drei leer" (z. B. Sonstige).
pub const EINHEIT_TYP_STARTLISTE: [(&str, Option<i64>, Option<i64>, Option<i64>, i64); 5] = [
    ("Trupp", Some(0), Some(0), Some(2), 10),
    ("Staffel", Some(0), Some(1), Some(5), 20),
    ("Gruppe", Some(0), Some(1), Some(8), 30),
    ("Zug", Some(1), Some(3), Some(18), 40),
    ("Sonstige", None, None, None, 50),
];

/// Einheitstyp-Katalog-Eintrag (org-weit), inkl. aufgelöster optionaler Soll-Stärke.
/// `aktiv` wird nicht serialisiert (Listen-Endpunkt liefert ohnehin nur aktive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EinheitTyp {
    pub id: i64,
    pub label: String,
    /// Standard-Soll-Stärke; `None`, wenn der Typ keine Soll-Stärke definiert.
    pub soll: Option<Staerke>,
    pub sortier: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startliste_konsistent() {
        assert_eq!(EINHEIT_TYP_STARTLISTE.len(), 5);
        // Jeder Eintrag hat alle drei Soll-Werte gesetzt ODER alle drei leer.
        for (_, f, u, m, _) in EINHEIT_TYP_STARTLISTE {
            let alle = f.is_some() && u.is_some() && m.is_some();
            let keiner = f.is_none() && u.is_none() && m.is_none();
            assert!(alle || keiner, "Soll muss vollständig oder leer sein");
        }
    }
}
