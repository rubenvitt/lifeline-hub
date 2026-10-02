//! Personenbezüge der Schwärzung (LFH-751, Spec `aufbewahrung-loeschersuchen`).
//!
//! Die Registry [`TABELLEN`](super::schwaerzung_registry::TABELLEN) sagt, WELCHE Spalte eines
//! Einsatzes personenbezogen ist; sie kennt aber nur das Scoping auf einen ganzen Einsatz. Ein
//! Löschersuchen nach Art. 17 trifft genau eine Person. [`PERSONENBEZUEGE`] sagt dafür je
//! Personenart, über welche Spalte eine Zeile zu dieser Person gehört und welche ihrer
//! Scrub-Spalten an der Person hängen (`Mit`) und welche nicht (`Ohne(Grund)`).
//!
//! **Teilmenge des Einsatz-Scrubs:** [`scrubbe_person`] schreibt nur `Mit`-Spalten, mit der
//! Strategie aus `TABELLEN`, eingegrenzt auf den Bezug UND das Einsatz-Scoping der Tabelle UND
//! ihren Zeilenfilter. Eine `Retain`-Spalte kann nie `Mit` sein (Guard), der Personen-Scrub
//! entfernt also nie etwas, was die Schwärzung des Einsatzes behält.
//!
//! **Vollständigkeit:** die Guards in `tests` prüfen gegen `pragma_foreign_key_list`, dass jede
//! FK-Spalte einer einsatz-scoped Tabelle, die auf die Wurzel einer Personenart zeigt, hier als
//! Bezug steht und jede ihrer Scrub-Spalten genau eine Markierung trägt. Eine neue Tabelle mit
//! Personenverweis und Freitext macht damit einen Test rot, statt still durchzurutschen.
//!
//! Herleitung: `openspec/changes/archive/2026-10-02-lfh-751-sofort-schwaerzung-auf-antrag/design.md`, D5.

use super::repo::SCHWAERZUNG_PLATZHALTER;
use super::schwaerzung_registry::{
    klassifikation_von, set_zuweisungen, where_klausel, Klassifikation, Strategie, TABELLEN,
};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Art einer Person, die ein Löschersuchen nach Art. 17 betreffen kann (LFH-751). Wire ==
    /// [`PersonenArt::as_str`] == `schwaerzung_antrag.ziel_art`, gepinnt in
    /// `tests/enum_wire_kontrakt.rs`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum PersonenArt {
        /// Betroffene im Personenregister (`einsatz_person`).
        Betroffene => "betroffene",
        /// Ad hoc erfasste externe Kraft (`einsatz_personal` ohne Stammdatenbezug).
        ExterneKraft => "externe_kraft",
        /// Anrufende Person am Informationstelefon (`infotelefon_anruf`).
        InfotelefonAnruf => "infotelefon_anruf",
        /// Ansprechperson im Presse-Log (`medienkontakt`).
        Medienkontakt => "medienkontakt",
    }
}

impl PersonenArt {
    /// Die Tabelle, deren Zeile die Person ist.
    pub const fn wurzel(self) -> &'static str {
        match self {
            PersonenArt::Betroffene => "einsatz_person",
            PersonenArt::ExterneKraft => "einsatz_personal",
            PersonenArt::InfotelefonAnruf => "infotelefon_anruf",
            PersonenArt::Medienkontakt => "medienkontakt",
        }
    }

    /// Pseudonyme Kennung einer Zeile, wie Personensuche, Rückfrage und ETB sie nennen.
    /// Betroffene tragen ihre Registriernummer (`R-042`), die übrigen Arten die Zeilen-ID mit
    /// Präfix (`EK-17`, `IT-5`, `MK-3`).
    pub fn kennung(self, id: i64, registrier_nr: Option<i64>) -> String {
        match self {
            PersonenArt::Betroffene => {
                crate::person::registrier_anzeige(registrier_nr.unwrap_or(id))
            }
            PersonenArt::ExterneKraft => format!("EK-{id}"),
            PersonenArt::InfotelefonAnruf => format!("IT-{id}"),
            PersonenArt::Medienkontakt => format!("MK-{id}"),
        }
    }

    /// Bezeichnung für Texte (Rückfrage, ETB).
    pub const fn bezeichnung(self) -> &'static str {
        match self {
            PersonenArt::Betroffene => "Betroffene Person",
            PersonenArt::ExterneKraft => "Externe Kraft",
            PersonenArt::InfotelefonAnruf => "Anruf am Informationstelefon",
            PersonenArt::Medienkontakt => "Medienkontakt",
        }
    }
}

/// Über welche Spalte eine Zeile zur Person gehört.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bezug {
    /// Die Zeile ist die Person selbst (`WHERE id = ?`).
    SelbstId,
    /// Fremdschlüssel auf die Wurzel der Personenart (`WHERE {spalte} = ?`).
    Spalte(&'static str),
}

/// Ob eine Scrub-Spalte an der Person hängt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Markierung {
    /// Personengebunden: der Personen-Scrub entfernt sie.
    Mit,
    /// Nicht personengebunden: bleibt bis zur Schwärzung des Einsatzes. Der Text begründet,
    /// warum der Wert nicht (nur) diese Person betrifft.
    Ohne(&'static str),
}

/// Ein Bezug einer Tabelle auf eine Personenart samt Markierung ihrer Scrub-Spalten.
#[derive(Debug, Clone, Copy)]
pub struct PersonenBezug {
    pub art: PersonenArt,
    pub tabelle: &'static str,
    pub bezug: Bezug,
    pub spalten: &'static [(&'static str, Markierung)],
}

use Markierung::{Mit, Ohne};

const O_TIER: &str = "beschreibt das Tier bzw. seinen Fund, nicht den Halter";
const O_UEBERGABE: &str = "Empfängerin der Übergabe, nicht die geschädigte Person";
const O_OBJEKT: &str = "beschreibt Abschnitt bzw. Einheit, nicht die führende Person";
const KEINE: &[(&str, Markierung)] = &[];

/// Alle Personenbezüge. Reihenfolge = Ausführungsreihenfolge (reihenfolgeunabhängig korrekt).
pub const PERSONENBEZUEGE: &[PersonenBezug] = &[
    // ---------- Betroffene ----------
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "einsatz_person",
        bezug: Bezug::SelbstId,
        spalten: &[
            ("name", Mit),
            ("vorname", Mit),
            ("geschlecht", Mit),
            ("geburtsdatum", Mit),
            ("alter_geschaetzt", Mit),
            ("herkunft_adresse", Mit),
            ("antreff_ort", Mit),
            ("melder_kontakt", Mit),
            ("notiz", Mit),
            ("aktueller_verbleib", Mit),
            ("zustand", Mit),
            ("antreff_lat", Mit),
            ("antreff_lon", Mit),
            ("aktuelles_verbleib_ziel", Mit),
        ],
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "person_sichtung",
        bezug: Bezug::Spalte("person_id"),
        spalten: &[("notiz", Mit)],
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "person_verlaufsnotiz",
        bezug: Bezug::Spalte("person_id"),
        spalten: &[("text", Mit)],
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "person_verbleib",
        bezug: Bezug::Spalte("person_id"),
        spalten: &[("transportmittel", Mit), ("ziel", Mit), ("notiz", Mit)],
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "person_uhs_belegung",
        bezug: Bezug::Spalte("person_id"),
        spalten: &[("notiz", Mit)],
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "person_abgleich",
        bezug: Bezug::Spalte("vermisst_person_id"),
        spalten: KEINE,
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "person_abgleich",
        bezug: Bezug::Spalte("gefunden_person_id"),
        spalten: KEINE,
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "person_zugriff_audit",
        bezug: Bezug::Spalte("person_id"),
        spalten: KEINE,
    },
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "uhs_platz",
        bezug: Bezug::Spalte("reserviert_fuer_person_id"),
        spalten: KEINE,
    },
    // Die Chip-/Tätowierungsnummer ist im Haustierregister auf den Halter registriert.
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "einsatz_tier",
        bezug: Bezug::Spalte("halter_person_id"),
        spalten: &[
            ("kennzeichnung", Mit),
            ("halter_kontakt", Mit),
            ("antreff_ort", Ohne(O_TIER)),
            ("notiz", Ohne(O_TIER)),
            ("abschluss_ziel", Ohne(O_TIER)),
        ],
    },
    // Der Schadensort ist faktisch die Adresse der geschädigten Person, die Beschreibung trägt
    // dieselben Angaben.
    PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "einsatz_schaden",
        bezug: Bezug::Spalte("geschaedigt_person_id"),
        spalten: &[
            ("ort", Mit),
            ("beschreibung", Mit),
            ("geschaedigt_kontakt", Mit),
            ("uebergeben_an", Ohne(O_UEBERGABE)),
        ],
    },
    // ---------- Externe Kräfte (einsatz_personal ohne Stammdatenbezug) ----------
    PersonenBezug {
        art: PersonenArt::ExterneKraft,
        tabelle: "einsatz_personal",
        bezug: Bezug::SelbstId,
        spalten: &[
            ("snap_name", Mit),
            ("snap_funktion", Mit),
            ("snap_traegerorganisation", Mit),
            ("bemerkung", Mit),
        ],
    },
    PersonenBezug {
        art: PersonenArt::ExterneKraft,
        tabelle: "auftrag_empfaenger",
        bezug: Bezug::Spalte("person_id"),
        spalten: &[
            ("funktion_text", Mit),
            ("extern_bezeichnung", Mit),
            ("snap_anzeige", Mit),
        ],
    },
    PersonenBezug {
        art: PersonenArt::ExterneKraft,
        tabelle: "einsatz_stabsfunktion",
        bezug: Bezug::Spalte("personal_id"),
        spalten: &[("snap_name", Mit), ("bezeichnung", Mit)],
    },
    PersonenBezug {
        art: PersonenArt::ExterneKraft,
        tabelle: "einsatz_kraft_zeitachse",
        bezug: Bezug::Spalte("personal_id"),
        spalten: &[("notiz", Mit), ("streichgrund", Mit)],
    },
    PersonenBezug {
        art: PersonenArt::ExterneKraft,
        tabelle: "einsatz_schaden",
        bezug: Bezug::Spalte("geschaedigt_personal_id"),
        spalten: &[
            ("ort", Mit),
            ("beschreibung", Mit),
            ("geschaedigt_kontakt", Mit),
            ("uebergeben_an", Ohne(O_UEBERGABE)),
        ],
    },
    // Die Funk-Erreichbarkeit ist oft die Rufnummer der führenden Person → personengebunden.
    PersonenBezug {
        art: PersonenArt::ExterneKraft,
        tabelle: "einsatzabschnitt",
        bezug: Bezug::Spalte("leiter_id"),
        spalten: &[
            ("erreichbarkeit", Mit),
            ("bemerkung", Ohne(O_OBJEKT)),
            ("abschnittsauftrag", Ohne(O_OBJEKT)),
        ],
    },
    PersonenBezug {
        art: PersonenArt::ExterneKraft,
        tabelle: "einsatz_einheit",
        bezug: Bezug::Spalte("fuehrer_id"),
        spalten: &[("erreichbarkeit", Mit), ("bemerkung", Ohne(O_OBJEKT))],
    },
    // ---------- Anrufende und Ansprechpersonen ----------
    PersonenBezug {
        art: PersonenArt::InfotelefonAnruf,
        tabelle: "infotelefon_anruf",
        bezug: Bezug::SelbstId,
        spalten: &[("notiz", Mit), ("anrufer_name", Mit), ("rueckruf", Mit)],
    },
    PersonenBezug {
        art: PersonenArt::Medienkontakt,
        tabelle: "medienkontakt",
        bezug: Bezug::SelbstId,
        spalten: &[("kontakt_name", Mit), ("kontakt_erreichbarkeit", Mit)],
    },
];

/// Entfernt die personengebundenen Werte der Person `art`/`person_id` im Einsatz `einsatz_id`,
/// auf der Transaktions-Verbindung des Aufrufers (atomar mit Kennzeichen und Audit).
/// Andere Personen und andere Einsätze bleiben unberührt. Prüft nicht, ob die Person existiert
/// — das tut der Antrag; eine unbekannte ID ändert schlicht keine Zeile.
pub async fn scrubbe_person(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    art: PersonenArt,
    person_id: i64,
) -> Result<(), sqlx::Error> {
    for b in PERSONENBEZUEGE.iter().filter(|b| b.art == art) {
        let scrubs: Vec<(&'static str, Strategie)> = b
            .spalten
            .iter()
            .filter(|(_, m)| *m == Mit)
            .map(|(spalte, _)| match klassifikation_von(b.tabelle, spalte) {
                Some(Klassifikation::Scrub(st)) if st != Strategie::ZeileLoeschen => (*spalte, st),
                // Die Guards halten das aus; ein Verstoß ist ein Programmierfehler.
                k => unreachable!("{}.{spalte} als Mit markiert, aber {k:?}", b.tabelle),
            })
            .collect();
        if scrubs.is_empty() {
            continue;
        }
        let regel = TABELLEN
            .iter()
            .find(|t| t.tabelle == b.tabelle)
            .expect("Personenbezug auf eine Tabelle außerhalb der Registry (Guard)");
        let bezug = match b.bezug {
            Bezug::SelbstId => "id",
            Bezug::Spalte(s) => s,
        };
        let (sets, platzhalter_binds) = set_zuweisungen(&scrubs);
        let sql = format!(
            "UPDATE {} SET {} WHERE {} AND {bezug} = ?",
            b.tabelle,
            sets.join(", "),
            where_klausel(regel)
        );
        let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
        for _ in 0..platzhalter_binds {
            query = query.bind(SCHWAERZUNG_PLATZHALTER);
        }
        query
            .bind(einsatz_id)
            .bind(person_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "schwaerzung_person_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "schwaerzung_person_testdaten.rs"]
pub(crate) mod testdaten;
