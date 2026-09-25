//! Retain-Projektion der Archivakte (LFH-23, design.md D3).
//!
//! Die Archivakte zeigt einem System-Admin das pseudonyme Skelett eines gesperrten oder
//! geschwärzten Einsatzes. Welche Spalten dabei gelesen werden, steht **ausschließlich**
//! hier — die SELECTs in `repo.rs` entstehen aus genau diesen Konstanten. Der Guard
//! [`tests::jede_archivspalte_ist_retain`] prüft jede Spalte über
//! [`klassifikation_von`](crate::einsatz::schwaerzung_registry::klassifikation_von) auf
//! `Retain`. Eine Scrub-Spalte oder ein Name, den die Registry nicht kennt, macht ihn rot.
//! Weil Liste und SELECT dieselbe Konstante sind, können sie nicht auseinanderlaufen, und
//! die Akte liefert vor und nach der Schwärzung dieselben Felder.
//!
//! Die Auswahl ist bewusst **kleiner** als alles, was Retain ist: Tier-Rufname und
//! -beschreibung (G_TIER) und die Schadenskoordinate (G_GEO) fehlen, ebenso die
//! Rückverweise des ETB auf Aufträge, Befehle, Lageberichte, Meldungen und
//! Nachforderungen, deren Ziele im Archiv nicht lesbar sind. Datensparsamkeit geht vor.
//!
//! **Einzige Ausnahme außerhalb der Registry** ist [`ETB_ERFASSER_JOIN`]: der Anzeigename
//! des Erfassers aus `benutzer`, einer Stammdatentabelle der Organisation, die nicht
//! einsatzbezogen ist und nicht geschwärzt wird.
//!
//! Spaltennamen sind compile-time-Konstanten (nie User-Input), `AssertSqlSafe` in
//! `repo.rs` ist deshalb injektionssicher; Werte werden gebunden.

/// Eine Quelle der Archivakte: Tabelle plus die gelesenen Spalten.
#[derive(Debug, Clone, Copy)]
pub struct Projektion {
    pub tabelle: &'static str,
    pub spalten: &'static [&'static str],
}

impl Projektion {
    /// Spaltenliste für ein SELECT, jede Spalte mit dem Alias `praefix` qualifiziert.
    pub fn select_liste(&self, praefix: &str) -> String {
        self.spalten
            .iter()
            .map(|s| format!("{praefix}.{s}"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Einsatzkopf ohne Einsatzort, Koordinate, meldende Stelle und Sachverhalt.
pub const KOPF: Projektion = Projektion {
    tabelle: "einsatz",
    spalten: &[
        "id",
        "org_id",
        "bezeichnung",
        "stichwort",
        "status",
        "einsatzart",
        "einsatznummer_intern",
        "leitstellen_nr",
        "begonnen_at",
        "abgeschlossen_at",
        "anzahl_betroffene_initial",
        "retention_bis",
        "geloescht_at",
        "geschwaerzt_at",
    ],
};

/// Personenregister: Registriernummer, Status und Triage-/Verbleibkategorie.
pub const PERSON: Projektion = Projektion {
    tabelle: "einsatz_person",
    spalten: &[
        "registrier_nr",
        "status",
        "aktuelle_sichtung",
        "aktuelle_verbleib_art",
        "aktueller_verbleib_status",
        "erfasst_at",
        "storniert_at",
    ],
};

/// Tierregister: Registriernummer, Tierart, Status, Abschlussgrund.
pub const TIER: Projektion = Projektion {
    tabelle: "einsatz_tier",
    spalten: &[
        "registrier_nr",
        "spezies",
        "status",
        "abschluss_grund",
        "erfasst_at",
        "storniert_at",
    ],
};

/// Schadensregister: Registriernummer, Typ, Ausmaß, Status, Abschlussgrund.
pub const SCHADEN: Projektion = Projektion {
    tabelle: "einsatz_schaden",
    spalten: &[
        "registrier_nr",
        "typ",
        "ausmass",
        "status",
        "abschluss_grund",
        "erfasst_at",
        "storniert_at",
    ],
};

/// ETB im Wortlaut (G_ETB), ohne Rückverweise auf nicht lesbare Ziele.
pub const ETB: Projektion = Projektion {
    tabelle: "etb_eintrag",
    spalten: &[
        "id",
        "lfd_nr",
        "typ",
        "inhalt",
        "von",
        "an",
        "meldeweg",
        "veranlassung",
        "erfasser_id",
        "erfasser_funktion",
        "ereigniszeit",
        "received_at",
        "berichtigt_eintrag_id",
    ],
};

/// Alle Projektionen der Archivakte — Iterationsbasis des Guards.
pub const ALLE: &[Projektion] = &[KOPF, PERSON, TIER, SCHADEN, ETB];

/// Der einzige JOIN außerhalb der Registry: Anzeigename des Erfassers aus der
/// Stammdatentabelle `benutzer` (nicht einsatzbezogen, nicht Gegenstand der Schwärzung).
/// `(tabelle, spalte, alias)`.
pub const ETB_ERFASSER_JOIN: (&str, &str, &str) = ("benutzer", "anzeigename", "erfasser_name");

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::schwaerzung_registry::{klassifikation_von, Klassifikation, TABELLEN};

    #[test]
    fn jede_archivspalte_ist_retain() {
        let mut verstoesse = Vec::new();
        for p in ALLE {
            for s in p.spalten {
                match klassifikation_von(p.tabelle, s) {
                    Some(Klassifikation::Retain(_)) => {}
                    Some(Klassifikation::Scrub(st)) => {
                        verstoesse.push(format!("{}.{s} ist Scrub ({st:?})", p.tabelle))
                    }
                    None => verstoesse.push(format!(
                        "{}.{s} kennt die Registry nicht (Tippfehler oder unklassifiziert)",
                        p.tabelle
                    )),
                }
            }
        }
        assert!(
            verstoesse.is_empty(),
            "Die Archivakte darf nur Retain-Spalten lesen (LFH-23, design.md D3):\n{}",
            verstoesse.join("\n")
        );
    }

    /// Der einzige benannte JOIN darf keine einsatzbezogene Tabelle treffen — sonst wäre er
    /// ein Weg an der Registry vorbei.
    #[test]
    fn erfasser_join_ist_keine_einsatztabelle() {
        let (tabelle, _, _) = ETB_ERFASSER_JOIN;
        assert!(
            TABELLEN.iter().all(|t| t.tabelle != tabelle),
            "{tabelle} ist einsatzbezogen — der Erfasser-Join müsste über die Registry laufen"
        );
    }

    #[test]
    fn keine_doppelte_spalte() {
        for p in ALLE {
            let mut gesehen = std::collections::HashSet::new();
            for s in p.spalten {
                assert!(gesehen.insert(s), "{}.{s} doppelt", p.tabelle);
            }
        }
    }
}
