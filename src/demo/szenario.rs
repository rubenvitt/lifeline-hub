//! Das Szenario „ÜBUNG – Starkregen Musterstadt“ als reine Daten (LFH-690, design.md D9).
//!
//! Diese Datei ist die **einzige Quelle** für Zahlen und Inhalte des Demo-Imports; der Bericht
//! leitet sich daraus ab. Sie enthält keine Logik außer der Ableitung des Katalogbedarfs.
//!
//! Jeder Eintrag trägt einen stabilen **Schlüssel** (`&'static str`). Über ihn referenziert das
//! Drehbuch des Einsatzes (Block 4.2) die Stammdaten, etwa beim Disponieren, und über ihn
//! liefert [`super::stammdaten::StammdatenErgebnis`] die IDs.
//!
//! Alle Namen sind erkennbar fiktiv und an „Musterstadt“ gebunden. Sie ahmen keine reale
//! Organisation nach: keine Trägerorganisation, keine Funkrufnamen-Vorsilbe einer echten
//! Hilfsorganisation, keine Kennzeichen, keine Telefonnummern.
//!
//! Die fachlichen Kennungen sind fest (`DEMO-P-001` …, `DEMO-M-001` …, „Musterstadt …“). Über
//! sie gleicht der Import mit vorhandenen Stammdaten ab (design.md D8).

use crate::katalog::StatusKategorie;

/// Stamm-Fahrzeug des Szenarios. Kennung für den Abgleich ist der Funkrufname.
#[derive(Debug, Clone, Copy)]
pub struct FahrzeugVorlage {
    pub schluessel: &'static str,
    pub funkrufname: &'static str,
    /// Freitext wie im Stamm (Combobox, kein Katalog; `migrations/0007_fahrzeug.sql`).
    pub fahrzeugtyp: &'static str,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    /// Sollbesatzung (Führer, Unterführer, Mannschaft).
    pub staerke: Option<(u16, u16, u16)>,
}

/// Stamm-Personal des Szenarios. Kennung für den Abgleich ist die Personalnummer, nie der
/// Name (design.md D8).
#[derive(Debug, Clone, Copy)]
pub struct PersonalVorlage {
    pub schluessel: &'static str,
    pub name: &'static str,
    pub personalnummer: &'static str,
    /// Wert aus dem CHECK von `personal.staerke_position`.
    pub staerke_position: &'static str,
    /// Labels aus dem Qualifikations-Katalog der Organisation.
    pub qualifikationen: &'static [&'static str],
}

/// Stamm-Material des Szenarios. Kennung für den Abgleich ist die Bestandsnummer.
#[derive(Debug, Clone, Copy)]
pub struct MaterialVorlage {
    pub schluessel: &'static str,
    pub bezeichnung: &'static str,
    /// Freitext wie im Stamm (Combobox, kein Katalog; `migrations/0018_material.sql`).
    pub kategorie: &'static str,
    pub bestandsnummer: &'static str,
}

/// Standort aller Demo-Fahrzeuge und -Materialien.
pub const STANDORT: &str = "Wache Musterstadt-Mitte";

/// Bemerkung an jeder angelegten Stammdatenzeile, damit sie auch außerhalb der
/// Verwaltungssektion als Demo erkennbar ist.
pub const BEMERKUNG: &str = "Demo-Daten (Übung Starkregen Musterstadt)";

pub const FAHRZEUGE: [FahrzeugVorlage; 8] = [
    FahrzeugVorlage {
        schluessel: "elw",
        funkrufname: "Musterstadt 11-1",
        fahrzeugtyp: "ELW 1",
        sondersignal: true,
        tragenkapazitaet: None,
        staerke: Some((0, 1, 2)),
    },
    FahrzeugVorlage {
        schluessel: "rtw1",
        funkrufname: "Musterstadt 83-1",
        fahrzeugtyp: "RTW",
        sondersignal: true,
        tragenkapazitaet: Some(1),
        staerke: Some((0, 0, 2)),
    },
    FahrzeugVorlage {
        schluessel: "rtw2",
        funkrufname: "Musterstadt 83-2",
        fahrzeugtyp: "RTW",
        sondersignal: true,
        tragenkapazitaet: Some(1),
        staerke: Some((0, 0, 2)),
    },
    FahrzeugVorlage {
        schluessel: "ktw1",
        funkrufname: "Musterstadt 85-1",
        fahrzeugtyp: "KTW",
        sondersignal: false,
        tragenkapazitaet: Some(1),
        staerke: Some((0, 0, 2)),
    },
    FahrzeugVorlage {
        schluessel: "ktw2",
        funkrufname: "Musterstadt 85-2",
        fahrzeugtyp: "KTW",
        sondersignal: false,
        tragenkapazitaet: Some(1),
        staerke: Some((0, 0, 2)),
    },
    FahrzeugVorlage {
        schluessel: "gwsan",
        funkrufname: "Musterstadt 64-1",
        fahrzeugtyp: "GW-San",
        sondersignal: true,
        tragenkapazitaet: Some(4),
        staerke: Some((0, 1, 5)),
    },
    FahrzeugVorlage {
        schluessel: "mtw",
        funkrufname: "Musterstadt 19-1",
        fahrzeugtyp: "MTW",
        sondersignal: false,
        tragenkapazitaet: None,
        staerke: Some((0, 1, 7)),
    },
    FahrzeugVorlage {
        schluessel: "lkw",
        funkrufname: "Musterstadt 93-1",
        fahrzeugtyp: "LKW Logistik",
        sondersignal: false,
        tragenkapazitaet: None,
        staerke: Some((0, 0, 2)),
    },
];

pub const PERSONAL: [PersonalVorlage; 12] = [
    PersonalVorlage {
        schluessel: "zugfuehrer",
        name: "Max Mustermann",
        personalnummer: "DEMO-P-001",
        staerke_position: "fuehrer",
        qualifikationen: &["Zugführer", "Sprechfunker"],
    },
    PersonalVorlage {
        schluessel: "gruppenfuehrer_san",
        name: "Lena Beispiel",
        personalnummer: "DEMO-P-002",
        staerke_position: "unterfuehrer",
        qualifikationen: &["Gruppenführer", "Notfallsanitäter"],
    },
    PersonalVorlage {
        schluessel: "gruppenfuehrer_bt",
        name: "Jonas Beispiel",
        personalnummer: "DEMO-P-003",
        staerke_position: "unterfuehrer",
        qualifikationen: &["Gruppenführer", "Rettungssanitäter"],
    },
    PersonalVorlage {
        schluessel: "notarzt",
        name: "Anna Probe",
        personalnummer: "DEMO-P-004",
        staerke_position: "mannschaft",
        qualifikationen: &["Notarzt"],
    },
    PersonalVorlage {
        schluessel: "notsan1",
        name: "Paul Probe",
        personalnummer: "DEMO-P-005",
        staerke_position: "mannschaft",
        qualifikationen: &["Notfallsanitäter"],
    },
    PersonalVorlage {
        schluessel: "rettsan1",
        name: "Sophie Vorlage",
        personalnummer: "DEMO-P-006",
        staerke_position: "mannschaft",
        qualifikationen: &["Rettungssanitäter", "Maschinist"],
    },
    PersonalVorlage {
        schluessel: "rettsan2",
        name: "Felix Vorlage",
        personalnummer: "DEMO-P-007",
        staerke_position: "mannschaft",
        qualifikationen: &["Rettungssanitäter"],
    },
    PersonalVorlage {
        schluessel: "truppfuehrer",
        name: "Marie Exempel",
        personalnummer: "DEMO-P-008",
        staerke_position: "unterfuehrer",
        qualifikationen: &["Truppführer", "Sanitäter"],
    },
    PersonalVorlage {
        schluessel: "san1",
        name: "Clara Muster",
        personalnummer: "DEMO-P-009",
        staerke_position: "mannschaft",
        qualifikationen: &["Sanitäter"],
    },
    PersonalVorlage {
        schluessel: "san2",
        name: "Leon Muster",
        personalnummer: "DEMO-P-010",
        staerke_position: "mannschaft",
        qualifikationen: &["Sanitäter", "Maschinist"],
    },
    PersonalVorlage {
        schluessel: "san3",
        name: "Tim Exempel",
        personalnummer: "DEMO-P-011",
        staerke_position: "mannschaft",
        qualifikationen: &["Sanitäter"],
    },
    PersonalVorlage {
        schluessel: "funker",
        name: "Nora Platzhalter",
        personalnummer: "DEMO-P-012",
        staerke_position: "mannschaft",
        qualifikationen: &["Sprechfunker"],
    },
];

pub const MATERIAL: [MaterialVorlage; 4] = [
    MaterialVorlage {
        schluessel: "stromerzeuger",
        bezeichnung: "Stromerzeuger 8 kVA",
        kategorie: "Technik",
        bestandsnummer: "DEMO-M-001",
    },
    MaterialVorlage {
        schluessel: "beleuchtung",
        bezeichnung: "Beleuchtungssatz",
        kategorie: "Technik",
        bestandsnummer: "DEMO-M-002",
    },
    MaterialVorlage {
        schluessel: "feldbetten",
        bezeichnung: "Feldbettensatz (20 Stück)",
        kategorie: "Betreuung",
        bestandsnummer: "DEMO-M-003",
    },
    MaterialVorlage {
        schluessel: "sanrucksack",
        bezeichnung: "Sanitätsrucksack",
        kategorie: "Sanität",
        bestandsnummer: "DEMO-M-004",
    },
];

/// Ein Katalogeintrag, den das Szenario braucht. Aufgelöst wird er über
/// [`super::katalog::aufloesen_tx`], nur gegen aktive Einträge der eigenen Organisation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Katalogeintrag {
    /// Qualifikation über ihr Label.
    Qualifikation(&'static str),
    /// Einheitstyp über sein Label.
    Einheitstyp(&'static str),
    /// Fahrzeugstatus über den FMS-Anker (0–9), der stabil ist, anders als das Label.
    FahrzeugstatusFms(i64),
    /// Erster aktiver Fahrzeugstatus der Kategorie.
    FahrzeugstatusKategorie(StatusKategorie),
    /// Personalstatus über sein Label.
    Personalstatus(&'static str),
    /// Erster aktiver Personalstatus der Kategorie.
    PersonalstatusKategorie(StatusKategorie),
}

/// Katalogbedarf des Einsatz-Teils (Block 4.2): FMS gemischt 2 · 3 · 4 · 6 (D9), die
/// Einheitstypen der fünf Einheiten und der `gebunden`-Status, den die Personal-Disposition
/// setzt. Block 4.2 passt die Liste an sein Drehbuch an; der Bootstrap-Test prüft sie mit.
pub const KATALOG_BEDARF_EINSATZ: &[Katalogeintrag] = &[
    Katalogeintrag::FahrzeugstatusFms(2),
    Katalogeintrag::FahrzeugstatusFms(3),
    Katalogeintrag::FahrzeugstatusFms(4),
    Katalogeintrag::FahrzeugstatusFms(6),
    Katalogeintrag::Einheitstyp("Zug"),
    Katalogeintrag::Einheitstyp("Gruppe"),
    Katalogeintrag::Einheitstyp("Staffel"),
    Katalogeintrag::Einheitstyp("Trupp"),
    Katalogeintrag::PersonalstatusKategorie(StatusKategorie::Gebunden),
];

/// Katalogbedarf der Stammdaten-Anlage: die Qualifikationen des Personals, jede einmal, in
/// der Reihenfolge ihres ersten Vorkommens. Fahrzeugtyp und Materialkategorie sind Freitext
/// und brauchen keinen Katalog.
pub fn katalog_bedarf_stammdaten() -> Vec<Katalogeintrag> {
    let mut bedarf = Vec::new();
    for label in PERSONAL.iter().flat_map(|p| p.qualifikationen.iter()) {
        let eintrag = Katalogeintrag::Qualifikation(label);
        if !bedarf.contains(&eintrag) {
            bedarf.push(eintrag);
        }
    }
    bedarf
}

/// Gesamter Katalogbedarf des Szenarios: Stammdaten, dann Einsatz.
pub fn katalog_bedarf() -> Vec<Katalogeintrag> {
    let mut bedarf = katalog_bedarf_stammdaten();
    for eintrag in KATALOG_BEDARF_EINSATZ {
        if !bedarf.contains(eintrag) {
            bedarf.push(*eintrag);
        }
    }
    bedarf
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn alle_eindeutig<'a>(werte: impl IntoIterator<Item = &'a str>, was: &str) {
        let mut gesehen = BTreeSet::new();
        for w in werte {
            assert!(gesehen.insert(w), "{was} doppelt: {w}");
        }
    }

    /// Schlüssel und fachliche Kennungen sind je Art eindeutig. Ein doppelter Schlüssel
    /// überschriebe die ID im Ergebnis; eine doppelte Kennung ließe den zweiten Eintrag den
    /// ersten „mitbenutzen“.
    #[test]
    fn schluessel_und_kennungen_sind_eindeutig() {
        alle_eindeutig(FAHRZEUGE.iter().map(|f| f.schluessel), "Fahrzeug-Schlüssel");
        alle_eindeutig(FAHRZEUGE.iter().map(|f| f.funkrufname), "Funkrufname");
        alle_eindeutig(PERSONAL.iter().map(|p| p.schluessel), "Personal-Schlüssel");
        alle_eindeutig(PERSONAL.iter().map(|p| p.personalnummer), "Personalnummer");
        alle_eindeutig(MATERIAL.iter().map(|m| m.schluessel), "Material-Schlüssel");
        alle_eindeutig(MATERIAL.iter().map(|m| m.bestandsnummer), "Bestandsnummer");
    }

    /// Die Kennungen folgen dem festen Schema aus D8.
    #[test]
    fn kennungen_folgen_dem_schema() {
        for (i, p) in PERSONAL.iter().enumerate() {
            assert_eq!(p.personalnummer, format!("DEMO-P-{:03}", i + 1));
        }
        for (i, m) in MATERIAL.iter().enumerate() {
            assert_eq!(m.bestandsnummer, format!("DEMO-M-{:03}", i + 1));
        }
        for f in FAHRZEUGE {
            assert!(
                f.funkrufname.starts_with("Musterstadt "),
                "Funkrufname an Musterstadt gebunden: {}",
                f.funkrufname
            );
        }
    }

    /// `staerke_position` trägt nur Werte, die der CHECK in `0010_personal.sql` erlaubt.
    #[test]
    fn staerke_position_gueltig() {
        for p in PERSONAL {
            assert!(
                ["fuehrer", "unterfuehrer", "mannschaft"].contains(&p.staerke_position),
                "{}: {}",
                p.schluessel,
                p.staerke_position
            );
        }
    }

    #[test]
    fn stammdaten_bedarf_ist_jede_qualifikation_einmal() {
        let bedarf = katalog_bedarf_stammdaten();
        let labels: Vec<&str> = bedarf
            .iter()
            .map(|e| match e {
                Katalogeintrag::Qualifikation(l) => *l,
                andere => panic!("Stammdaten brauchen nur Qualifikationen: {andere:?}"),
            })
            .collect();
        alle_eindeutig(labels.iter().copied(), "Qualifikation im Bedarf");
        for p in PERSONAL {
            for q in p.qualifikationen {
                assert!(labels.contains(q), "{q} fehlt im Bedarf");
            }
        }
    }
}
