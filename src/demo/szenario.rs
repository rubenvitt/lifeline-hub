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

use crate::einsatzabschnitt::AbschnittLagezustand;
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

// ---------------------------------------------------------------------------------------------
// Der Einsatz: Kopfdaten und Drehbuch (Block 4.2)
// ---------------------------------------------------------------------------------------------

/// Bezeichnung des Demo-Einsatzes; beginnt nach der Spec mit „ÜBUNG – “.
pub const EINSATZ_BEZEICHNUNG: &str = "ÜBUNG – Starkregen Musterstadt";

/// Stichwort des Demo-Einsatzes, als Freitext. D9 nahm ein Stichwort „Unwetter“ aus dem
/// Bootstrap-Katalog an; die Startliste (`auth/bootstrap.rs`, `STICHWORT_STARTLISTE`) kennt
/// aber nur B-, MANV-, Sonderlage- und Übungsstichworte. Das Feld `einsatz.stichwort` ist
/// Freitext (der Katalog liefert nur Combobox-Vorschläge), und die Spec verlangt ein Stichwort
/// aus dem Bereich Unwetter/Starkregen. Einen Vorschlag legt der Import bewusst nicht an: die
/// Zeile wäre org-weit, trüge keine Demo-Marke und überlebte das Entfernen.
pub const EINSATZ_STICHWORT: &str = "Unwetter – Starkregen";

/// Einsatzbeginn in Minuten vor dem Importzeitpunkt (T−5 h, D9). Kein Drehbuch-Schritt liegt
/// davor.
pub const BEGINN_VOR_MIN: i64 = 300;

/// Einsatzabschnitt des Drehbuchs. `ueber` ist der Schlüssel eines früher angelegten
/// Abschnitts (Unterabschnitt).
#[derive(Debug, Clone, Copy)]
pub struct AbschnittVorlage {
    pub schluessel: &'static str,
    pub name: &'static str,
    pub kurzbezeichnung: &'static str,
    pub ueber: Option<&'static str>,
    pub lagezustand: Option<AbschnittLagezustand>,
    /// Manuelle Einschätzung in Prozent; leer ≠ 0 % (LFH-608).
    pub fortschritt: Option<i64>,
    pub abschnittsauftrag: &'static str,
    pub sortier: i64,
}

/// Einheit des Drehbuchs. `typ` ist das Label aus dem Einheitstyp-Katalog, `abschnitt` der
/// Schlüssel eines früher angelegten Abschnitts.
#[derive(Debug, Clone, Copy)]
pub struct EinheitVorlage {
    pub schluessel: &'static str,
    pub name: &'static str,
    pub typ: &'static str,
    pub abschnitt: &'static str,
    pub sortier: i64,
}

/// Typ eines fachlichen ETB-Eintrags. Nur die Typen, die ein Mensch im Betrieb frei erfasst;
/// Meldung und Anordnung entstehen als Nebenwirkung ihrer Module (Block 4c), System aus den
/// Vorgängen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EtbArt {
    Lage,
    Entscheidung,
}

impl EtbArt {
    /// Wire-Wert in `etb_eintrag.typ`.
    pub fn typ(&self) -> &'static str {
        match self {
            EtbArt::Lage => crate::etb::TYP_LAGE,
            EtbArt::Entscheidung => crate::etb::TYP_ENTSCHEIDUNG,
        }
    }
}

/// Ein Vorgang des Drehbuchs. Jede Variante entspricht einer Handlung, die im Betrieb ein
/// Handler ausführt; der Import schreibt dieselben Zeilen und denselben System-ETB-Eintrag
/// (design.md D5). Schlüssel verweisen auf Stammdaten ([`FAHRZEUGE`], [`PERSONAL`]) oder auf
/// Objekte, die ein früherer Schritt angelegt hat.
///
/// **Ergänzen (Block 4c):** Variante hier anlegen, in [`katalog_bedarf_einsatz`] ihren
/// Katalogbedarf entscheiden (der `match` dort ist erschöpfend und bricht sonst den Build),
/// in `import.rs` einen Zweig schreiben und die Schritte in [`DREHBUCH`] einsortieren.
#[derive(Debug, Clone, Copy)]
pub enum Vorgang {
    /// Einsatzabschnitt anlegen. ETB: „Abschnitt «…» angelegt (Lage: …)“.
    Abschnitt(AbschnittVorlage),
    /// Einheit bilden. ETB: „Einheit «…» gebildet“.
    Einheit(EinheitVorlage),
    /// Stamm-Fahrzeug disponieren; Anfangsstatus ist der erste `gebunden`-Status der Org.
    /// ETB: „Fahrzeug «…» disponiert“.
    FahrzeugDisponieren { fahrzeug: &'static str },
    /// Disponiertes Fahrzeug einer Einheit zuordnen. ETB: „Einheit «…»: Fahrzeug «…» zugeordnet“.
    FahrzeugZuEinheit {
        fahrzeug: &'static str,
        einheit: &'static str,
    },
    /// FMS-Status eines disponierten Fahrzeugs setzen, über den `fms_anker` (0–9). ETB nur bei
    /// einem echten Wechsel: „Fahrzeug «…»: Status «…» → «…»“.
    FmsStatus { fahrzeug: &'static str, fms: i64 },
    /// Stamm-Personal disponieren (Stärkeposition aus dem Stamm). ETB: „Person «…» disponiert“.
    PersonalDisponieren { personal: &'static str },
    /// Fachlicher ETB-Eintrag, `ereigniszeit` = Schrittzeit.
    Etb {
        art: EtbArt,
        inhalt: &'static str,
        von: Option<&'static str>,
    },
}

/// Ein Schritt des Drehbuchs: Zeitpunkt in Minuten vor dem Import und Vorgang.
#[derive(Debug, Clone, Copy)]
pub struct Schritt {
    pub vor_min: i64,
    pub vorgang: Vorgang,
}

const fn s(vor_min: i64, vorgang: Vorgang) -> Schritt {
    Schritt { vor_min, vorgang }
}

const fn dispo_fahrzeug(vor_min: i64, fahrzeug: &'static str) -> Schritt {
    s(vor_min, Vorgang::FahrzeugDisponieren { fahrzeug })
}

const fn zu_einheit(vor_min: i64, fahrzeug: &'static str, einheit: &'static str) -> Schritt {
    s(vor_min, Vorgang::FahrzeugZuEinheit { fahrzeug, einheit })
}

const fn fms(vor_min: i64, fahrzeug: &'static str, fms: i64) -> Schritt {
    s(vor_min, Vorgang::FmsStatus { fahrzeug, fms })
}

const fn dispo_personal(vor_min: i64, personal: &'static str) -> Schritt {
    s(vor_min, Vorgang::PersonalDisponieren { personal })
}

const fn lage(vor_min: i64, inhalt: &'static str) -> Schritt {
    s(
        vor_min,
        Vorgang::Etb {
            art: EtbArt::Lage,
            inhalt,
            von: None,
        },
    )
}

const fn entscheidung(vor_min: i64, inhalt: &'static str) -> Schritt {
    s(
        vor_min,
        Vorgang::Etb {
            art: EtbArt::Entscheidung,
            inhalt,
            von: Some("Einsatzleitung"),
        },
    )
}

const fn abschnitt(vor_min: i64, vorlage: AbschnittVorlage) -> Schritt {
    s(vor_min, Vorgang::Abschnitt(vorlage))
}

const fn einheit(
    vor_min: i64,
    schluessel: &'static str,
    name: &'static str,
    typ: &'static str,
    abschnitt: &'static str,
    sortier: i64,
) -> Schritt {
    s(
        vor_min,
        Vorgang::Einheit(EinheitVorlage {
            schluessel,
            name,
            typ,
            abschnitt,
            sortier,
        }),
    )
}

/// Das Drehbuch in Zeitfolge: `vor_min` fällt (nicht streng), der erste Schritt liegt beim
/// Einsatzbeginn, der letzte wenige Minuten vor dem Import. Der Import spielt es in dieser
/// Reihenfolge ab, damit die laufende ETB-Nummer der Zeit folgt (D9).
///
/// Endstand FMS: ELW, RTW 1, GW-San, MTW 4 · RTW 2, LKW 3 · KTW 1 2 · KTW 2 6.
pub const DREHBUCH: &[Schritt] = &[
    lage(
        300,
        "Starkregen über Musterstadt seit den Morgenstunden. Der Mühlbach tritt in der \
         Unterstadt über die Ufer, erste Keller sind überflutet. Übungseinsatz eröffnet.",
    ),
    entscheidung(
        295,
        "Einsatzabschnitte Sanitätsdienst, Betreuung und Logistik werden gebildet.",
    ),
    abschnitt(
        294,
        AbschnittVorlage {
            schluessel: "ea1",
            name: "Sanitätsdienst",
            kurzbezeichnung: "EA 1",
            ueber: None,
            lagezustand: Some(AbschnittLagezustand::Angespannt),
            fortschritt: Some(40),
            abschnittsauftrag: "Sanitätsdienstliche Versorgung der Betroffenen",
            sortier: 10,
        },
    ),
    abschnitt(
        294,
        AbschnittVorlage {
            schluessel: "ea2",
            name: "Betreuung",
            kurzbezeichnung: "EA 2",
            ueber: None,
            lagezustand: Some(AbschnittLagezustand::Planmaessig),
            fortschritt: None,
            abschnittsauftrag: "Betreuung und Unterbringung evakuierter Anwohner",
            sortier: 20,
        },
    ),
    abschnitt(
        294,
        AbschnittVorlage {
            schluessel: "ea3",
            name: "Logistik",
            kurzbezeichnung: "EA 3",
            ueber: None,
            lagezustand: Some(AbschnittLagezustand::Planmaessig),
            fortschritt: Some(70),
            abschnittsauftrag: "Versorgung mit Material, Verpflegung und Strom",
            sortier: 30,
        },
    ),
    einheit(290, "zug", "Sanitätszug Musterstadt", "Zug", "ea1", 10),
    einheit(290, "rettung", "Rettungsstaffel", "Staffel", "ea1", 20),
    einheit(290, "betreuung", "Betreuungsgruppe", "Gruppe", "ea2", 30),
    einheit(290, "logistik", "Logistiktrupp", "Trupp", "ea3", 40),
    dispo_fahrzeug(285, "elw"),
    dispo_fahrzeug(284, "rtw1"),
    dispo_fahrzeug(284, "rtw2"),
    dispo_fahrzeug(283, "gwsan"),
    dispo_fahrzeug(282, "mtw"),
    dispo_fahrzeug(282, "lkw"),
    zu_einheit(280, "elw", "zug"),
    zu_einheit(280, "rtw1", "rettung"),
    zu_einheit(280, "rtw2", "rettung"),
    zu_einheit(280, "mtw", "betreuung"),
    zu_einheit(280, "lkw", "logistik"),
    dispo_personal(278, "zugfuehrer"),
    dispo_personal(278, "gruppenfuehrer_san"),
    dispo_personal(278, "notarzt"),
    dispo_personal(278, "notsan1"),
    dispo_personal(278, "rettsan1"),
    dispo_personal(278, "rettsan2"),
    fms(270, "elw", 4),
    fms(270, "rtw1", 4),
    fms(270, "rtw2", 4),
    fms(265, "mtw", 4),
    entscheidung(
        250,
        "Unterabschnitt UHS Turnhalle unter EA 1 wird eingerichtet, dazu eine Sanitätsgruppe \
         für die UHS.",
    ),
    abschnitt(
        248,
        AbschnittVorlage {
            schluessel: "ea11",
            name: "UHS Turnhalle",
            kurzbezeichnung: "EA 1.1",
            ueber: Some("ea1"),
            lagezustand: Some(AbschnittLagezustand::Kritisch),
            fortschritt: Some(25),
            abschnittsauftrag: "Sichtung und Erstversorgung in der Turnhalle Musterstadt",
            sortier: 11,
        },
    ),
    einheit(246, "uhs", "Sanitätsgruppe UHS", "Gruppe", "ea11", 50),
    dispo_fahrzeug(245, "ktw1"),
    dispo_fahrzeug(245, "ktw2"),
    zu_einheit(244, "gwsan", "uhs"),
    zu_einheit(244, "ktw1", "uhs"),
    zu_einheit(244, "ktw2", "uhs"),
    dispo_personal(243, "gruppenfuehrer_bt"),
    dispo_personal(243, "truppfuehrer"),
    dispo_personal(243, "san1"),
    dispo_personal(243, "san2"),
    dispo_personal(243, "san3"),
    dispo_personal(243, "funker"),
    fms(240, "gwsan", 4),
    fms(230, "ktw1", 4),
    fms(230, "ktw2", 4),
    lage(
        180,
        "Pegel Mühlbach weiter steigend. Die Unterstadt ist in Teilen nur noch mit \
         geländegängigen Fahrzeugen erreichbar.",
    ),
    fms(150, "rtw2", 3),
    fms(120, "ktw2", 6),
    entscheidung(
        118,
        "KTW Musterstadt 85-2 wegen Wasserschaden an der Elektrik außer Betrieb. Transporte \
         übernimmt RTW Musterstadt 83-2.",
    ),
    fms(90, "ktw1", 2),
    lage(
        60,
        "Lage in EA 1.1 kritisch: Aufnahmekapazität der UHS Turnhalle nahezu erschöpft, \
         weitere Betroffene angekündigt.",
    ),
    entscheidung(
        30,
        "Weitere Sanitätsgruppe über die Leitstelle nachgefordert. Die Betreuung richtet \
         zusätzliche Plätze in der Gesamtschule ein.",
    ),
    lage(
        10,
        "Regen lässt nach, Pegel Mühlbach stagniert. Nächste Lagebesprechung ist angesetzt.",
    ),
];

/// Katalogbedarf des Einsatz-Teils, abgeleitet aus dem [`DREHBUCH`], jeder Eintrag einmal, in
/// der Reihenfolge des ersten Vorkommens.
///
/// Der `match` ist bewusst erschöpfend und ohne `_`-Zweig: eine neue [`Vorgang`]-Variante
/// kompiliert erst, wenn ihr Bedarf entschieden ist. Die Dispositionen verlangen je den ersten
/// `gebunden`-Status, weil `disponiere_stamm_tx` ihn selbst nachschlägt und ohne ihn still
/// `NULL` setzte; der Import prüft ihn vorab, damit das eine 422 wird.
pub fn katalog_bedarf_einsatz() -> Vec<Katalogeintrag> {
    let mut bedarf = Vec::new();
    for schritt in DREHBUCH {
        let eintrag = match schritt.vorgang {
            Vorgang::Einheit(v) => Some(Katalogeintrag::Einheitstyp(v.typ)),
            Vorgang::FahrzeugDisponieren { .. } => Some(Katalogeintrag::FahrzeugstatusKategorie(
                StatusKategorie::Gebunden,
            )),
            Vorgang::FmsStatus { fms, .. } => Some(Katalogeintrag::FahrzeugstatusFms(fms)),
            Vorgang::PersonalDisponieren { .. } => Some(Katalogeintrag::PersonalstatusKategorie(
                StatusKategorie::Gebunden,
            )),
            Vorgang::Abschnitt(_) | Vorgang::FahrzeugZuEinheit { .. } | Vorgang::Etb { .. } => None,
        };
        if let Some(eintrag) = eintrag {
            if !bedarf.contains(&eintrag) {
                bedarf.push(eintrag);
            }
        }
    }
    bedarf
}

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
    for eintrag in katalog_bedarf_einsatz() {
        if !bedarf.contains(&eintrag) {
            bedarf.push(eintrag);
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

    /// Zeitfolge: `vor_min` fällt nicht streng, der erste Schritt liegt nicht vor dem
    /// Einsatzbeginn, der letzte vor dem Importzeitpunkt (Spec „Zeitachse relativ zum
    /// Importzeitpunkt“: nichts in der Zukunft).
    #[test]
    fn drehbuch_steht_in_zeitfolge() {
        assert!(!DREHBUCH.is_empty());
        for paar in DREHBUCH.windows(2) {
            assert!(
                paar[0].vor_min >= paar[1].vor_min,
                "Zeitfolge verletzt: {:?} vor {:?}",
                paar[0],
                paar[1]
            );
        }
        assert!(DREHBUCH[0].vor_min <= BEGINN_VOR_MIN);
        assert!(DREHBUCH[DREHBUCH.len() - 1].vor_min > 0);
    }

    /// Jeder Schlüssel, auf den ein Schritt verweist, ist vorher definiert: Stammdaten in den
    /// Listen oben, Abschnitte und Einheiten in einem früheren Schritt, ein Fahrzeug vor
    /// Zuordnung und Status disponiert. Jedes Objekt entsteht genau einmal.
    #[test]
    fn drehbuch_verweist_nur_auf_frueher_angelegtes() {
        let mut abschnitte = BTreeSet::new();
        let mut einheiten = BTreeSet::new();
        let mut fahrzeuge = BTreeSet::new();
        let mut personal = BTreeSet::new();
        for schritt in DREHBUCH {
            match schritt.vorgang {
                Vorgang::Abschnitt(v) => {
                    if let Some(ueber) = v.ueber {
                        assert!(abschnitte.contains(ueber), "{ueber} vor {}", v.schluessel);
                    }
                    assert!(abschnitte.insert(v.schluessel), "{} doppelt", v.schluessel);
                }
                Vorgang::Einheit(v) => {
                    assert!(abschnitte.contains(v.abschnitt), "{}", v.abschnitt);
                    assert!(einheiten.insert(v.schluessel), "{} doppelt", v.schluessel);
                }
                Vorgang::FahrzeugDisponieren { fahrzeug } => {
                    assert!(FAHRZEUGE.iter().any(|f| f.schluessel == fahrzeug));
                    assert!(fahrzeuge.insert(fahrzeug), "{fahrzeug} doppelt disponiert");
                }
                Vorgang::FahrzeugZuEinheit { fahrzeug, einheit } => {
                    assert!(fahrzeuge.contains(fahrzeug), "{fahrzeug} nicht disponiert");
                    assert!(einheiten.contains(einheit), "{einheit} nicht gebildet");
                }
                Vorgang::FmsStatus { fahrzeug, fms } => {
                    assert!(fahrzeuge.contains(fahrzeug), "{fahrzeug} nicht disponiert");
                    assert!((0..=9).contains(&fms), "FMS {fms}");
                }
                Vorgang::PersonalDisponieren { personal: p } => {
                    assert!(PERSONAL.iter().any(|v| v.schluessel == p));
                    assert!(personal.insert(p), "{p} doppelt disponiert");
                }
                Vorgang::Etb { inhalt, .. } => assert!(!inhalt.trim().is_empty()),
            }
        }
    }

    /// Der Einsatz-Bedarf folgt dem Drehbuch: jeder Einheitstyp und jeder FMS-Anker, der
    /// vorkommt, dazu die beiden `gebunden`-Kategorien der Dispositionen.
    #[test]
    fn einsatz_bedarf_folgt_dem_drehbuch() {
        let bedarf = katalog_bedarf_einsatz();
        for erwartet in [
            Katalogeintrag::Einheitstyp("Zug"),
            Katalogeintrag::Einheitstyp("Staffel"),
            Katalogeintrag::Einheitstyp("Gruppe"),
            Katalogeintrag::Einheitstyp("Trupp"),
            Katalogeintrag::FahrzeugstatusFms(2),
            Katalogeintrag::FahrzeugstatusFms(3),
            Katalogeintrag::FahrzeugstatusFms(4),
            Katalogeintrag::FahrzeugstatusFms(6),
            Katalogeintrag::FahrzeugstatusKategorie(StatusKategorie::Gebunden),
            Katalogeintrag::PersonalstatusKategorie(StatusKategorie::Gebunden),
        ] {
            assert!(bedarf.contains(&erwartet), "{erwartet:?} fehlt");
        }
        assert_eq!(bedarf.len(), 10, "jeder Eintrag einmal: {bedarf:?}");
    }
}
