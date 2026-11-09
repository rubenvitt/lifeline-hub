//! Das Szenario „ÜBUNG – Sanitätsdienst Stadtfest Musterstadt“ als reine Daten (LLH-1576,
//! Konzept Sanitätsdienst LLH-1562, Abschnitt 5.8).
//!
//! Ein Abend Sanitätsdienst auf einem Stadtfest: drei Abschnitte (Bühne, Eingang, Festmeile),
//! zwei Streifen, eine UHS mit Plätzen im Grundriss, ein KTW und 20 Kontakte mit Anlass
//! (LLH-1566), versorgender Einheit (LLH-1567) und Verbleib samt Angaben (LLH-1568), darunter
//! ein Transport über die Leitstelle. Die Bausteine kommen aus [`super::szenario`].
//!
//! **Getrennte Kennungen (design.md D2):** Funkrufnamen `Musterstadt 87-…`, Personalnummern
//! `DEMO-S-…`, Bestandsnummern `DEMO-S-M-…`. Kein Datensatz gehört so zu beiden Lagen; der
//! Wächter `kennungen_beider_lagen_sind_disjunkt` hält das.
//!
//! Alle Namen sind erkennbar erfunden. Medizinischer Rahmen aus LLH-1109: keine Vitalwerte, der
//! Anlass ist ein fester Katalogwert, das ETB nennt weder Anlass noch Zustand. Keine
//! Einheiten-Vorlage und kein Schichtmodell (Sanitätsdienst ohne Schichten).

use super::planung::{
    PlanungEinteilung, PlanungHelferVorlage, PlanungPerson, PlanungPostenVorlage,
    PlanungProgrammpunkt, PlanungVorlage, PostenHerkunft,
};
use super::szenario::{
    abschnitt, besatzung, dispo_fahrzeug, dispo_personal, einheit, entscheidung, fms, lage,
    lagemeldung, material, personal_an_uhs, personal_zu, rueckmeldung, s, zu_einheit,
    AbschnittVorlage, FahrzeugVorlage, MaterialVorlage, PersonVorlage, PersonalVorlage,
    PlatzVorlage, Punkt, Schritt, Szenario, UhsVorlage, VerbleibVorlage, Vorgang,
};
use super::DemoLage;
use crate::einsatzabschnitt::AbschnittLagezustand;
use crate::person::anlass_repo::PersonAnlass;
use crate::person::{
    EntlassenAn, GegenRat, Sichtungskategorie, TransportDurch, Unterschrift, VerbleibArt,
    VerbleibStatus,
};
use crate::uhs::{PlatzTyp, UhsTyp};

/// Bezeichnung des Demo-Einsatzes; beginnt nach der Spec mit „ÜBUNG – “.
pub const EINSATZ_BEZEICHNUNG: &str = "ÜBUNG – Sanitätsdienst Stadtfest Musterstadt";

/// Stichwort als Freitext, wie bei der Starkregen-Lage ohne Katalogvorschlag.
pub const EINSATZ_STICHWORT: &str = "Sanitätsdienst – Stadtfest";

/// Einsatzbeginn T−5 h: Aufbau vor dem Einlass.
pub const BEGINN_VOR_MIN: i64 = 300;

/// Standort aller Demo-Fahrzeuge und -Materialien dieser Lage.
pub const STANDORT: &str = "Wache Musterstadt-Süd";

/// Bemerkung an jeder angelegten Stammdatenzeile.
pub const BEMERKUNG: &str = "Demo-Daten (Übung Sanitätsdienst Stadtfest Musterstadt)";

/// Einsatznummer der Leitstelle beim Transport durch ein fremdes Rettungsmittel; erkennbar
/// erfunden.
pub const LEITSTELLE_EINSATZNUMMER: &str = "DEMO-0042";

pub const FAHRZEUGE: [FahrzeugVorlage; 2] = [
    FahrzeugVorlage {
        schluessel: "elw",
        funkrufname: "Musterstadt 87-11",
        fahrzeugtyp: "ELW 1",
        sondersignal: true,
        tragenkapazitaet: None,
        staerke: Some((0, 1, 1)),
    },
    FahrzeugVorlage {
        schluessel: "ktw",
        funkrufname: "Musterstadt 87-85",
        fahrzeugtyp: "KTW",
        sondersignal: false,
        tragenkapazitaet: Some(1),
        staerke: Some((0, 0, 2)),
    },
];

pub const PERSONAL: [PersonalVorlage; 11] = [
    PersonalVorlage {
        schluessel: "einsatzleiter",
        name: "Theo Exempel",
        personalnummer: "DEMO-S-001",
        staerke_position: "fuehrer",
        qualifikationen: &["Zugführer", "Sprechfunker"],
    },
    PersonalVorlage {
        schluessel: "funker",
        name: "Ida Platzhalter",
        personalnummer: "DEMO-S-002",
        staerke_position: "mannschaft",
        qualifikationen: &["Sprechfunker"],
    },
    PersonalVorlage {
        schluessel: "uhs_leitung",
        name: "Greta Probe",
        personalnummer: "DEMO-S-003",
        staerke_position: "unterfuehrer",
        qualifikationen: &["Gruppenführer", "Notfallsanitäter"],
    },
    PersonalVorlage {
        schluessel: "uhs_san1",
        name: "Ben Vorlage",
        personalnummer: "DEMO-S-004",
        staerke_position: "mannschaft",
        qualifikationen: &["Rettungssanitäter"],
    },
    PersonalVorlage {
        schluessel: "uhs_san2",
        name: "Mia Muster",
        personalnummer: "DEMO-S-005",
        staerke_position: "mannschaft",
        qualifikationen: &["Sanitäter"],
    },
    PersonalVorlage {
        schluessel: "streife1_fuehrer",
        name: "Karl Beispiel",
        personalnummer: "DEMO-S-006",
        staerke_position: "unterfuehrer",
        qualifikationen: &["Truppführer", "Sanitäter"],
    },
    PersonalVorlage {
        schluessel: "streife1_san",
        name: "Lotte Exempel",
        personalnummer: "DEMO-S-007",
        staerke_position: "mannschaft",
        qualifikationen: &["Sanitäter"],
    },
    PersonalVorlage {
        schluessel: "streife2_fuehrer",
        name: "Emil Probe",
        personalnummer: "DEMO-S-008",
        staerke_position: "unterfuehrer",
        qualifikationen: &["Truppführer", "Rettungssanitäter"],
    },
    PersonalVorlage {
        schluessel: "streife2_san",
        name: "Hanna Vorlage",
        personalnummer: "DEMO-S-009",
        staerke_position: "mannschaft",
        qualifikationen: &["Sanitäter"],
    },
    PersonalVorlage {
        schluessel: "ktw_fahrer",
        name: "Oskar Muster",
        personalnummer: "DEMO-S-010",
        staerke_position: "mannschaft",
        qualifikationen: &["Rettungssanitäter", "Maschinist"],
    },
    PersonalVorlage {
        schluessel: "ktw_beifahrer",
        name: "Pia Platzhalter",
        personalnummer: "DEMO-S-011",
        staerke_position: "mannschaft",
        qualifikationen: &["Sanitäter"],
    },
];

pub const MATERIAL: [MaterialVorlage; 3] = [
    MaterialVorlage {
        schluessel: "rucksack1",
        bezeichnung: "Sanitätsrucksack Streife 1",
        kategorie: "Sanität",
        bestandsnummer: "DEMO-S-M-001",
        art: crate::material::MaterialArt::Geraet,
    },
    MaterialVorlage {
        schluessel: "rucksack2",
        bezeichnung: "Sanitätsrucksack Streife 2",
        kategorie: "Sanität",
        bestandsnummer: "DEMO-S-M-002",
        art: crate::material::MaterialArt::Geraet,
    },
    MaterialVorlage {
        schluessel: "aed",
        bezeichnung: "AED",
        kategorie: "Sanität",
        bestandsnummer: "DEMO-S-M-003",
        art: crate::material::MaterialArt::Geraet,
    },
];

/// Grundriss der UHS Festplatz: Wartebereich, drei Liegen, ein Stuhlplatz und die
/// Transportbereitstellung in zwei Reihen.
const UHS_PLAETZE: &[PlatzVorlage] = &[
    PlatzVorlage {
        typ: PlatzTyp::Wartebereich,
        bezeichnung: "Wartebereich",
        pos: (10.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Behandlungsplatz,
        bezeichnung: "Liege 1",
        pos: (170.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Behandlungsplatz,
        bezeichnung: "Liege 2",
        pos: (330.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Behandlungsplatz,
        bezeichnung: "Liege 3",
        pos: (490.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Sonstige,
        bezeichnung: "Stuhlplatz",
        pos: (10.0, 130.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::TransportBereitstellung,
        bezeichnung: "Transportbereitstellung",
        pos: (170.0, 130.0),
    },
];

/// Orte auf dem Festgelände, `(Länge, Breite)`; das Gelände ist erfunden.
const BUEHNE: Punkt = (10.2468, 50.9581);
const EINGANG: Punkt = (10.2502, 50.9566);
const FESTMEILE: Punkt = (10.2485, 50.9574);
const UHS_ORT: Punkt = (10.2490, 50.9570);

/// Ein Kontakt des Abends (LLH-1576): Person mit Schlüssel, Anlass, versorgender Einheit und
/// Sichtung; mit `uhs` aufgenommen in die UHS Festplatz, mit `platz` auf einen Platz im Grundriss.
#[allow(clippy::too_many_arguments)]
const fn kontakt(
    vor_min: i64,
    schluessel: &'static str,
    vorname: &'static str,
    name: &'static str,
    geschlecht: &'static str,
    alter_geschaetzt: i64,
    antreff_ort: &'static str,
    antreff: Punkt,
    anlass: PersonAnlass,
    sichtung: Sichtungskategorie,
    einheit: &'static str,
    in_uhs: bool,
    platz: Option<&'static str>,
) -> Schritt {
    s(
        vor_min,
        Vorgang::Person(PersonVorlage {
            vorname,
            name,
            geschlecht,
            alter_geschaetzt,
            antreff_ort,
            antreff: Some(antreff),
            zustand: None,
            sichtung: Some(sichtung),
            uhs: if in_uhs { Some("festplatz") } else { None },
            schluessel: Some(schluessel),
            anlass: Some(anlass),
            einheit: Some(einheit),
            platz,
        }),
    )
}

const fn ohne_angaben(person: &'static str, art: VerbleibArt) -> VerbleibVorlage {
    VerbleibVorlage {
        person,
        art,
        status: None,
        durch: None,
        fahrzeug: None,
        transportmittel: None,
        ziel: None,
        einsatznummer: None,
        entlassen_an: None,
        gegen_rat: None,
        unterschrift: None,
    }
}

/// Entlassung an `an`.
const fn entlassen(vor_min: i64, person: &'static str, an: EntlassenAn) -> Schritt {
    let mut v = ohne_angaben(person, VerbleibArt::Entlassung);
    v.entlassen_an = Some(an);
    s(vor_min, Vorgang::Verbleib(v))
}

/// Entlassung auf eigenen Wunsch gegen ärztlichen Rat, Unterschrift liegt auf Papier vor.
const fn entlassen_gegen_rat(vor_min: i64, person: &'static str) -> Schritt {
    let mut v = ohne_angaben(person, VerbleibArt::Entlassung);
    v.entlassen_an = Some(EntlassenAn::Selbst);
    v.gegen_rat = Some(GegenRat::Behandlung);
    v.unterschrift = Some(Unterschrift::LiegtVor);
    s(vor_min, Vorgang::Verbleib(v))
}

/// Eigentransport mit dem KTW ins Klinikum.
const fn eigentransport(vor_min: i64, person: &'static str) -> Schritt {
    let mut v = ohne_angaben(person, VerbleibArt::Transport);
    v.status = Some(VerbleibStatus::Abtransportiert);
    v.durch = Some(TransportDurch::Eigen);
    v.fahrzeug = Some("ktw");
    v.ziel = Some("Klinikum Musterstadt");
    s(vor_min, Vorgang::Verbleib(v))
}

/// Übergabe des Eigentransports im Klinikum.
const fn uebergeben(vor_min: i64, person: &'static str) -> Schritt {
    let mut v = ohne_angaben(person, VerbleibArt::Transport);
    v.status = Some(VerbleibStatus::Uebergeben);
    v.durch = Some(TransportDurch::Eigen);
    v.fahrzeug = Some("ktw");
    v.ziel = Some("Klinikum Musterstadt");
    s(vor_min, Vorgang::Verbleib(v))
}

/// Transport durch ein Rettungsmittel der Leitstelle, mit deren Einsatznummer.
const fn transport_leitstelle(vor_min: i64, person: &'static str) -> Schritt {
    let mut v = ohne_angaben(person, VerbleibArt::Transport);
    v.status = Some(VerbleibStatus::Abtransportiert);
    v.durch = Some(TransportDurch::Fremd);
    v.transportmittel = Some("RTW der Leitstelle");
    v.ziel = Some("Klinikum Musterstadt");
    v.einsatznummer = Some(LEITSTELLE_EINSATZNUMMER);
    s(vor_min, Vorgang::Verbleib(v))
}

use EntlassenAn::{Begleitung, Polizei, Selbst, Sorgeberechtigte};
use PersonAnlass::{
    Allergie, HitzeKaelte, Internistisch, Intoxikation, Neurologisch, Psychisch, Sonstiges,
    Verletzung,
};
use Sichtungskategorie::{Sk2, Sk3};

/// Das Drehbuch in Zeitfolge. Endstand: 20 Kontakte. 14 entlassen (einer gegen Rat, einer an
/// die Polizei), einer im Eigentransport mit dem KTW übergeben, einer über die Leitstelle
/// abtransportiert, drei liegen in der UHS auf Plätzen, eine versorgt Streife 2 noch vor Ort. KTW wieder am Einsatzort
/// (FMS 4). Keine Aufträge, keine Erinnerungen, keine Sofortmeldung: kein Alarm beim Import.
pub const DREHBUCH: &[Schritt] = &[
    lage(
        300,
        "Sanitätsdienst Stadtfest Musterstadt eröffnet. Festgelände Rathausplatz und \
         Marktstraße, Einlass 18:00, Bühnenprogramm ab 19:00.",
    ),
    entscheidung(
        298,
        "Einsatzabschnitte Bühne, Eingang und Festmeile werden gebildet, die UHS steht an der \
         Festmeile.",
    ),
    abschnitt(
        297,
        AbschnittVorlage {
            schluessel: "buehne",
            name: "Bühne",
            kurzbezeichnung: "EA 1",
            ueber: None,
            lagezustand: Some(AbschnittLagezustand::Planmaessig),
            abschnittsauftrag: "Sanitätsdienstliche Absicherung vor der Bühne und im Bühnenumfeld",
            sortier: 10,
            rufname: "Rotkreuz Musterstadt 2/10-1",
            mobil: None,
        },
    ),
    abschnitt(
        297,
        AbschnittVorlage {
            schluessel: "eingang",
            name: "Eingang",
            kurzbezeichnung: "EA 2",
            ueber: None,
            lagezustand: Some(AbschnittLagezustand::Planmaessig),
            abschnittsauftrag: "Absicherung des Einlasses und der Zufahrt für Rettungsmittel",
            sortier: 20,
            rufname: "Rotkreuz Musterstadt 2/20-1",
            mobil: None,
        },
    ),
    abschnitt(
        297,
        AbschnittVorlage {
            schluessel: "festmeile",
            name: "Festmeile",
            kurzbezeichnung: "EA 3",
            ueber: None,
            lagezustand: Some(AbschnittLagezustand::Planmaessig),
            abschnittsauftrag: "Streifendienst auf der Festmeile und Betrieb der UHS",
            sortier: 30,
            rufname: "Rotkreuz Musterstadt 2/30-1",
            mobil: Some("0170 0000201"),
        },
    ),
    einheit(295, "fuehrung", "Führungstrupp", "Trupp", "festmeile", 10),
    einheit(
        295,
        "uhs_gruppe",
        "Sanitätsgruppe UHS",
        "Gruppe",
        "festmeile",
        20,
    ),
    einheit(295, "streife1", "Streife 1", "Trupp", "festmeile", 30),
    einheit(295, "streife2", "Streife 2", "Trupp", "buehne", 40),
    einheit(295, "ktw_trupp", "KTW-Besatzung", "Trupp", "eingang", 50),
    dispo_fahrzeug(292, "elw"),
    dispo_fahrzeug(292, "ktw"),
    zu_einheit(290, "elw", "fuehrung"),
    zu_einheit(290, "ktw", "ktw_trupp"),
    dispo_personal(288, "einsatzleiter"),
    dispo_personal(288, "funker"),
    dispo_personal(288, "uhs_leitung"),
    dispo_personal(288, "uhs_san1"),
    dispo_personal(288, "uhs_san2"),
    dispo_personal(288, "streife1_fuehrer"),
    dispo_personal(288, "streife1_san"),
    dispo_personal(288, "streife2_fuehrer"),
    dispo_personal(288, "streife2_san"),
    dispo_personal(288, "ktw_fahrer"),
    dispo_personal(288, "ktw_beifahrer"),
    s(
        287,
        Vorgang::Einsatzleiter {
            personal: "einsatzleiter",
        },
    ),
    personal_zu(286, "einsatzleiter", "fuehrung"),
    personal_zu(286, "funker", "fuehrung"),
    personal_zu(286, "uhs_leitung", "uhs_gruppe"),
    personal_zu(286, "uhs_san1", "uhs_gruppe"),
    personal_zu(286, "uhs_san2", "uhs_gruppe"),
    personal_zu(286, "streife1_fuehrer", "streife1"),
    personal_zu(286, "streife1_san", "streife1"),
    personal_zu(286, "streife2_fuehrer", "streife2"),
    personal_zu(286, "streife2_san", "streife2"),
    personal_zu(286, "ktw_fahrer", "ktw_trupp"),
    personal_zu(286, "ktw_beifahrer", "ktw_trupp"),
    besatzung(285, "elw", &["einsatzleiter", "funker"]),
    besatzung(285, "ktw", &["ktw_fahrer", "ktw_beifahrer"]),
    material(284, "rucksack1", "streife1"),
    material(284, "rucksack2", "streife2"),
    material(284, "aed", "uhs_gruppe"),
    s(
        282,
        Vorgang::Uhs(UhsVorlage {
            schluessel: "festplatz",
            bezeichnung: "UHS Festplatz",
            typ: UhsTyp::Behandlungsplatz,
            abschnitt: "festmeile",
            standort: "Zelt an der Festmeile, gegenüber dem Rathaus",
            plaetze: UHS_PLAETZE,
        }),
    ),
    personal_an_uhs(281, "uhs_leitung", "festplatz"),
    personal_an_uhs(281, "uhs_san1", "festplatz"),
    personal_an_uhs(281, "uhs_san2", "festplatz"),
    fms(280, "elw", 4),
    fms(280, "ktw", 4),
    rueckmeldung(
        262,
        "Streife 1",
        "streife1",
        "Streife 1 auf der Festmeile unterwegs, Verbindung steht.",
    ),
    rueckmeldung(
        262,
        "Streife 2",
        "streife2",
        "Streife 2 an der Bühne, Absperrung und Rettungsgasse frei.",
    ),
    lage(
        240,
        "Einlass geöffnet, starker Andrang am Eingang. Rund 29 °C, wenig Schatten auf der \
         Festmeile.",
    ),
    kontakt(
        232,
        "k01",
        "Jana",
        "Beispiel",
        "weiblich",
        34,
        "Festmeile, Höhe Getränkestand",
        FESTMEILE,
        Verletzung,
        Sk3,
        "streife1",
        false,
        None,
    ),
    entlassen(222, "k01", Selbst),
    kontakt(
        218,
        "k02",
        "Rolf",
        "Muster",
        "maennlich",
        67,
        "Eingang Rathausplatz",
        EINGANG,
        HitzeKaelte,
        Sk3,
        "uhs_gruppe",
        true,
        None,
    ),
    lagemeldung(
        212,
        "Ordnungsdienst Stadtfest",
        "Wartezeit am Einlass über 20 Minuten, Besucher stehen in der Sonne.",
    ),
    entscheidung(
        208,
        "Trinkwasserausgabe am Eingang durch den Veranstalter, Streife 2 schaut regelmäßig \
         vorbei.",
    ),
    kontakt(
        204,
        "k03",
        "Lina",
        "Exempel",
        "weiblich",
        8,
        "Festmeile, Kinderkarussell",
        FESTMEILE,
        Verletzung,
        Sk3,
        "streife1",
        false,
        None,
    ),
    entlassen(196, "k02", Begleitung),
    entlassen(192, "k03", Sorgeberechtigte),
    kontakt(
        186,
        "k04",
        "Dirk",
        "Probe",
        "maennlich",
        45,
        "Festmeile, Weinstand",
        FESTMEILE,
        Allergie,
        Sk3,
        "uhs_gruppe",
        true,
        None,
    ),
    lage(
        180,
        "Bühnenprogramm hat begonnen, dichter Andrang vor der Bühne.",
    ),
    kontakt(
        176,
        "k05",
        "Sabine",
        "Vorlage",
        "weiblich",
        52,
        "Bühne, linke Seite",
        BUEHNE,
        Internistisch,
        Sk2,
        "streife2",
        true,
        None,
    ),
    entlassen(170, "k04", Selbst),
    kontakt(
        164,
        "k06",
        "Tom",
        "Platzhalter",
        "maennlich",
        19,
        "Bühne, vor der Absperrung",
        BUEHNE,
        HitzeKaelte,
        Sk3,
        "streife2",
        false,
        None,
    ),
    entlassen(158, "k06", Selbst),
    eigentransport(152, "k05"),
    fms(152, "ktw", 7),
    kontakt(
        146,
        "k07",
        "Nele",
        "Muster",
        "weiblich",
        23,
        "Festmeile, Höhe Rathaus",
        FESTMEILE,
        Verletzung,
        Sk3,
        "uhs_gruppe",
        true,
        None,
    ),
    kontakt(
        140,
        "k08",
        "Uwe",
        "Beispiel",
        "maennlich",
        58,
        "Eingang, Kasse",
        EINGANG,
        Internistisch,
        Sk3,
        "uhs_gruppe",
        true,
        None,
    ),
    uebergeben(132, "k05"),
    entlassen(128, "k07", Selbst),
    kontakt(
        124,
        "k09",
        "Kim",
        "Exempel",
        "divers",
        27,
        "Bühne, Mischpult",
        BUEHNE,
        Psychisch,
        Sk3,
        "streife2",
        true,
        None,
    ),
    rueckmeldung(
        120,
        "KTW-Besatzung",
        "ktw_trupp",
        "KTW Musterstadt 87-85 nach Übergabe im Klinikum zurück am Eingang.",
    ),
    fms(120, "ktw", 4),
    entlassen_gegen_rat(116, "k08"),
    kontakt(
        110,
        "k10",
        "Paul",
        "Vorlage",
        "maennlich",
        16,
        "Festmeile, Imbissstand",
        FESTMEILE,
        Intoxikation,
        Sk3,
        "streife1",
        true,
        None,
    ),
    entlassen(102, "k09", Begleitung),
    kontakt(
        98,
        "k11",
        "Gerda",
        "Probe",
        "weiblich",
        74,
        "Eingang Rathausplatz",
        EINGANG,
        Verletzung,
        Sk3,
        "uhs_gruppe",
        true,
        None,
    ),
    kontakt(
        92,
        "k12",
        "Lea",
        "Platzhalter",
        "weiblich",
        31,
        "Festmeile, Höhe Brunnen",
        FESTMEILE,
        Sonstiges,
        Sk3,
        "streife1",
        false,
        None,
    ),
    entlassen(90, "k12", Selbst),
    entlassen(86, "k10", Sorgeberechtigte),
    kontakt(
        82,
        "k13",
        "Jan",
        "Muster",
        "maennlich",
        41,
        "Bühne, rechte Seite",
        BUEHNE,
        Neurologisch,
        Sk2,
        "streife2",
        true,
        None,
    ),
    lage(
        78,
        "Hauptprogramm auf der Bühne, Festmeile voll. UHS gut ausgelastet, Lage ruhig.",
    ),
    transport_leitstelle(72, "k13"),
    entlassen(70, "k11", Begleitung),
    kontakt(
        64,
        "k14",
        "Marco",
        "Beispiel",
        "maennlich",
        29,
        "Festmeile, Höhe Getränkestand",
        FESTMEILE,
        Intoxikation,
        Sk3,
        "streife1",
        true,
        None,
    ),
    kontakt(
        58,
        "k15",
        "Eva",
        "Exempel",
        "weiblich",
        38,
        "Eingang, Fahrradparkplatz",
        EINGANG,
        Verletzung,
        Sk3,
        "uhs_gruppe",
        true,
        None,
    ),
    entlassen(48, "k15", Selbst),
    entlassen(44, "k14", Polizei),
    kontakt(
        40,
        "k16",
        "Ole",
        "Vorlage",
        "maennlich",
        22,
        "Bühne, vor der Absperrung",
        BUEHNE,
        HitzeKaelte,
        Sk3,
        "streife2",
        false,
        None,
    ),
    entlassen(34, "k16", Selbst),
    kontakt(
        30,
        "k17",
        "Rita",
        "Probe",
        "weiblich",
        61,
        "Festmeile, Höhe Rathaus",
        FESTMEILE,
        Internistisch,
        Sk2,
        "uhs_gruppe",
        true,
        Some("Liege 1"),
    ),
    kontakt(
        24,
        "k18",
        "Finn",
        "Platzhalter",
        "maennlich",
        17,
        "Festmeile, Imbissstand",
        FESTMEILE,
        Intoxikation,
        Sk3,
        "streife1",
        true,
        Some("Liege 2"),
    ),
    kontakt(
        18,
        "k19",
        "Anke",
        "Muster",
        "weiblich",
        44,
        "Bühne, linke Seite",
        BUEHNE,
        Verletzung,
        Sk3,
        "streife2",
        false,
        None,
    ),
    kontakt(
        12,
        "k20",
        "Hugo",
        "Beispiel",
        "maennlich",
        55,
        "Festmeile, Weinstand",
        UHS_ORT,
        Allergie,
        Sk3,
        "uhs_gruppe",
        true,
        Some("Stuhlplatz"),
    ),
];

/// Bezeichnung der Demo-Planung (LLH-1585, Spec `vorplanung`, „Stadtfest in neuen Einsatz“).
pub const PLANUNG_BEZEICHNUNG: &str = "Stadtfest Musterstadt";

/// Die Demo-Planung (design.md D8): fünf Posten, Schichten aus der Schichtlänge, zwei Helfer,
/// vier Programmpunkte (LLH-1583).
/// Mia Muster steht in „UHS Marktplatz“ 10–17 und in „Streife 2“ 15–18 (Befund „doppelt“),
/// „Streife 2“ 21–24 bleibt leer (die Lücke). Emil Probe dient genau 12 Stunden, also ohne
/// Befund „Dienst“.
pub const PLANUNG: PlanungVorlage = {
    use PlanungPerson::{Helfer, Stamm};
    PlanungVorlage {
        bezeichnung: PLANUNG_BEZEICHNUNG,
        ort: "Marktplatz Musterstadt",
        von_stunde: 10,
        bis_stunde: 24,
        posten: &[
            PlanungPostenVorlage {
                schluessel: "uhs",
                bezeichnung: "UHS Marktplatz",
                abschnitt: Some("Marktplatz"),
                herkunft: PostenHerkunft::Uhs(UhsTyp::Behandlungsplatz),
                schichtlaenge_min: 420,
                soll_anzahl: Some(3),
                quali_soll: &[("Rettungssanitäter", 1)],
                von_stunde: 10,
                bis_stunde: 24,
            },
            PlanungPostenVorlage {
                schluessel: "streife1",
                bezeichnung: "Streife 1",
                abschnitt: Some("Festmeile"),
                herkunft: PostenHerkunft::Frei,
                schichtlaenge_min: 180,
                soll_anzahl: Some(2),
                quali_soll: &[("Sanitäter", 1)],
                von_stunde: 12,
                bis_stunde: 24,
            },
            PlanungPostenVorlage {
                schluessel: "streife2",
                bezeichnung: "Streife 2",
                abschnitt: Some("Festmeile"),
                herkunft: PostenHerkunft::Frei,
                schichtlaenge_min: 180,
                soll_anzahl: Some(2),
                quali_soll: &[("Sanitäter", 1)],
                von_stunde: 12,
                bis_stunde: 24,
            },
            PlanungPostenVorlage {
                schluessel: "buehne",
                bezeichnung: "Sanitätswache Bühne",
                abschnitt: Some("Bühne"),
                herkunft: PostenHerkunft::Frei,
                schichtlaenge_min: 240,
                soll_anzahl: Some(2),
                quali_soll: &[],
                von_stunde: 19,
                bis_stunde: 23,
            },
            PlanungPostenVorlage {
                schluessel: "ktw",
                bezeichnung: "KTW Musterstadt 87-85",
                abschnitt: None,
                herkunft: PostenHerkunft::Fahrzeug("ktw"),
                schichtlaenge_min: 300,
                soll_anzahl: None,
                quali_soll: &[],
                von_stunde: 12,
                bis_stunde: 17,
            },
        ],
        helfer: &[
            PlanungHelferVorlage {
                schluessel: "nora",
                name: "Nora Exempel",
                organisation: "Helferkreis Musterstadt",
                qualifikationen: &["Sanitäter"],
            },
            PlanungHelferVorlage {
                schluessel: "finn",
                name: "Finn Platzhalter",
                organisation: "Helferkreis Musterstadt",
                qualifikationen: &[],
            },
        ],
        einteilung: &[
            PlanungEinteilung {
                posten: Some("uhs"),
                ab_stunde: 10,
                bis_stunde: 17,
                personen: &[Stamm("uhs_leitung"), Stamm("uhs_san1"), Stamm("uhs_san2")],
            },
            PlanungEinteilung {
                posten: Some("uhs"),
                ab_stunde: 17,
                bis_stunde: 24,
                personen: &[Stamm("streife2_fuehrer"), Stamm("funker"), Helfer("nora")],
            },
            PlanungEinteilung {
                posten: Some("streife1"),
                ab_stunde: 12,
                bis_stunde: 15,
                personen: &[Stamm("streife1_fuehrer"), Stamm("streife1_san")],
            },
            PlanungEinteilung {
                posten: Some("streife1"),
                ab_stunde: 15,
                bis_stunde: 18,
                personen: &[Stamm("streife1_fuehrer"), Stamm("streife1_san")],
            },
            PlanungEinteilung {
                posten: Some("streife1"),
                ab_stunde: 18,
                bis_stunde: 21,
                personen: &[Stamm("streife1_fuehrer"), Stamm("streife1_san")],
            },
            PlanungEinteilung {
                posten: Some("streife1"),
                ab_stunde: 21,
                bis_stunde: 24,
                personen: &[Stamm("ktw_beifahrer"), Helfer("finn")],
            },
            PlanungEinteilung {
                posten: Some("streife2"),
                ab_stunde: 12,
                bis_stunde: 15,
                personen: &[Stamm("ktw_fahrer"), Stamm("streife2_san")],
            },
            PlanungEinteilung {
                posten: Some("streife2"),
                ab_stunde: 15,
                bis_stunde: 18,
                personen: &[Stamm("streife2_san"), Stamm("uhs_san2")],
            },
            PlanungEinteilung {
                posten: Some("streife2"),
                ab_stunde: 18,
                bis_stunde: 21,
                personen: &[Stamm("ktw_fahrer"), Stamm("ktw_beifahrer")],
            },
            PlanungEinteilung {
                posten: None,
                ab_stunde: 18,
                bis_stunde: 19,
                personen: &[Stamm("streife2_san")],
            },
            PlanungEinteilung {
                posten: Some("buehne"),
                ab_stunde: 19,
                bis_stunde: 23,
                personen: &[Stamm("einsatzleiter"), Stamm("streife2_san")],
            },
            PlanungEinteilung {
                posten: Some("ktw"),
                ab_stunde: 12,
                bis_stunde: 17,
                personen: &[Stamm("einsatzleiter"), Stamm("streife2_fuehrer")],
            },
        ],
        // LLH-1583: das Programm des Festes, wie es die Übernahme in den Einsatz bringt.
        programm: &[
            PlanungProgrammpunkt {
                stunde: 12,
                minute: 0,
                bezeichnung: "Festbeginn",
            },
            PlanungProgrammpunkt {
                stunde: 18,
                minute: 0,
                bezeichnung: "Einlass Bühne",
            },
            PlanungProgrammpunkt {
                stunde: 19,
                minute: 0,
                bezeichnung: "Bühnenprogramm",
            },
            PlanungProgrammpunkt {
                stunde: 22,
                minute: 30,
                bezeichnung: "Feuerwerk",
            },
        ],
    }
};

/// Die Stadtfest-Lage als [`Szenario`]: ohne Einheiten-Vorlage, ohne Schichtmodell.
pub const STADTFEST: Szenario = Szenario {
    lage: DemoLage::Stadtfest,
    einsatz_bezeichnung: EINSATZ_BEZEICHNUNG,
    einsatz_stichwort: EINSATZ_STICHWORT,
    beginn_vor_min: BEGINN_VOR_MIN,
    standort: STANDORT,
    bemerkung: BEMERKUNG,
    fahrzeuge: &FAHRZEUGE,
    personal: &PERSONAL,
    material: &MATERIAL,
    einheiten_vorlagen: &[],
    schichtmodell: None,
    planung: Some(&PLANUNG),
    drehbuch: DREHBUCH,
};

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Kein Datensatz gehört zu beiden Lagen (design.md D2): Funkrufnamen, Personal- und
    /// Bestandsnummern sind über beide Lagen eindeutig, und das Schema trennt sie sichtbar.
    #[test]
    fn kennungen_beider_lagen_sind_disjunkt() {
        let lagen = [&super::super::szenario::STARKREGEN, &STADTFEST];
        let mut gesehen = BTreeSet::new();
        for sz in lagen {
            for k in sz
                .fahrzeuge
                .iter()
                .map(|f| f.funkrufname)
                .chain(sz.personal.iter().map(|p| p.personalnummer))
                .chain(sz.material.iter().map(|m| m.bestandsnummer))
            {
                assert!(gesehen.insert(k), "Kennung in zwei Lagen oder doppelt: {k}");
            }
        }
        for (i, p) in PERSONAL.iter().enumerate() {
            assert_eq!(p.personalnummer, format!("DEMO-S-{:03}", i + 1));
        }
        for (i, m) in MATERIAL.iter().enumerate() {
            assert_eq!(m.bestandsnummer, format!("DEMO-S-M-{:03}", i + 1));
        }
        for f in FAHRZEUGE {
            assert!(
                f.funkrufname.starts_with("Musterstadt 87-"),
                "{}",
                f.funkrufname
            );
        }
    }

    /// Die Zahlen des Tickets: 20 Kontakte, jeder mit Anlass und versorgender Einheit, genau
    /// ein Transport über die Leitstelle; kein Auftrag, keine Erinnerung, keine Sofortmeldung.
    #[test]
    fn drehbuch_traegt_die_zahlen_des_tickets() {
        let mut kontakte = 0;
        let mut leitstelle = 0;
        for schritt in DREHBUCH {
            match schritt.vorgang {
                Vorgang::Person(v) => {
                    kontakte += 1;
                    assert!(v.anlass.is_some() && v.einheit.is_some(), "{}", v.name);
                }
                Vorgang::Verbleib(v) => {
                    if v.durch == Some(TransportDurch::Fremd) {
                        assert!(v.einsatznummer.is_some());
                        leitstelle += 1;
                    }
                }
                Vorgang::Auftrag(_) | Vorgang::Erinnerung(_) => {
                    panic!("kein Auftrag, keine Erinnerung")
                }
                Vorgang::Meldung(m) => {
                    assert_ne!(m.meldungsart, crate::meldung::ART_SOFORTMELDUNG);
                    assert_ne!(m.prioritaet, crate::meldung::PRIO_SOFORT);
                }
                _ => {}
            }
        }
        assert_eq!(kontakte, 20);
        assert_eq!(leitstelle, 1);
    }
}
