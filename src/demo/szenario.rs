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

use crate::betreuung::{BetreuungsstelleArt, Erhebung};
use crate::einsatzabschnitt::AbschnittLagezustand;
use crate::gefahr::Warnstufe;
use crate::katalog::StatusKategorie;
use crate::person::Sichtungskategorie;
use crate::uhs::{PlatzTyp, UhsTyp};

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

/// Punkt in WGS84 als `(Länge, Breite)`, in der Reihenfolge von GeoJSON. Alle Punkte des
/// Szenarios liegen um einen erfundenen Ort in der Mitte Deutschlands; ein realer Ortsbezug ist
/// nicht beabsichtigt.
pub type Punkt = (f64, f64);

/// Gefahrengebiet der Lagekarte: eine Lage-Zone vom Typ `gefahrengebiet` (Polygon) samt einer
/// Bewertung. Die Geometrie prüft der Import mit `lage_zone::validiere_neu` wie der Handler.
#[derive(Debug, Clone, Copy)]
pub struct GefahrengebietVorlage {
    pub label: &'static str,
    /// Außenring ohne Schlusspunkt; der Import schließt ihn.
    pub ring: &'static [Punkt],
    /// Wire-Wert aus `gefahr::Gefahrentyp`.
    pub gefahrentyp: &'static str,
    /// Wire-Wert aus `gefahr::Schutzobjekt`; die Kombination besteht
    /// `gefahr::kombination_gueltig`.
    pub schutzobjekt: &'static str,
    pub warnstufe: Warnstufe,
    pub beschreibung: &'static str,
}

/// Platz einer UHS mit Position im Grundriss.
#[derive(Debug, Clone, Copy)]
pub struct PlatzVorlage {
    pub typ: PlatzTyp,
    pub bezeichnung: &'static str,
    pub pos: (f64, f64),
}

/// UHS: angelegt, mit Plätzen versehen und in Betrieb genommen (Status `aktiv`).
#[derive(Debug, Clone, Copy)]
pub struct UhsVorlage {
    pub schluessel: &'static str,
    pub bezeichnung: &'static str,
    pub typ: UhsTyp,
    pub abschnitt: &'static str,
    pub standort: &'static str,
    pub plaetze: &'static [PlatzVorlage],
}

/// Bereitstellungsraum: angelegt und in Betrieb genommen (Status `aktiv`).
#[derive(Debug, Clone, Copy)]
pub struct BrVorlage {
    pub bezeichnung: &'static str,
    pub abschnitt: &'static str,
    pub standort: &'static str,
}

/// Betroffene Person, angelegt wie über `POST …/personen`: Status `erfasst`, optional mit
/// Erst-Sichtung (hebt auf `betroffen`) und UHS-Eintritt (Inbox).
#[derive(Debug, Clone, Copy)]
pub struct PersonVorlage {
    pub vorname: &'static str,
    pub name: &'static str,
    /// Wire-Wert aus `person::Geschlecht`.
    pub geschlecht: &'static str,
    pub alter_geschaetzt: i64,
    pub antreff_ort: &'static str,
    pub antreff: Option<Punkt>,
    pub zustand: Option<&'static str>,
    pub sichtung: Option<Sichtungskategorie>,
    /// Schlüssel einer früher angelegten UHS.
    pub uhs: Option<&'static str>,
}

/// Evakuierungsbezirk; das Anlegen ist die Anordnung samt Plangröße (Räumung `angeordnet`).
#[derive(Debug, Clone, Copy)]
pub struct BezirkVorlage {
    pub schluessel: &'static str,
    pub bezeichnung: &'static str,
    pub abschnitt: &'static str,
    pub plan_personen: i64,
    pub plan_erhebung: Erhebung,
    pub sammelstelle: &'static str,
}

/// Betreuungsstelle, angelegt im Status `vorbereitet`.
#[derive(Debug, Clone, Copy)]
pub struct StelleVorlage {
    pub schluessel: &'static str,
    pub bezeichnung: &'static str,
    pub art: BetreuungsstelleArt,
    pub abschnitt: &'static str,
    pub kapazitaet: i64,
    pub standort: &'static str,
}

/// Meldung, angelegt wie über `POST …/meldungen`. `ereigniszeit` und `eingang_at` sind die
/// Schrittzeit. Eine Sofortmeldung (Art `sofortmeldung` oder Priorität `sofort`) trägt wie im
/// Handler die Bestätigungspflicht samt Frist; sie muss `bestaetigt` sein (D10).
#[derive(Debug, Clone, Copy)]
pub struct MeldungVorlage {
    pub absender: &'static str,
    pub empfaenger: Option<&'static str>,
    /// Wire-Wert aus `etb::MeldeWeg`.
    pub meldeweg: &'static str,
    pub inhalt: &'static str,
    pub meldungsart: &'static str,
    pub prioritaet: &'static str,
    pub richtung: &'static str,
    /// Schlüssel einer früher gebildeten Einheit: strukturierter Absender, macht die Meldung
    /// zur Rückmeldung dieser Einheit (LFH-610).
    pub einheit: Option<&'static str>,
    /// Im selben Schritt bestätigt (Quittung zur Schrittzeit).
    pub bestaetigt: bool,
}

/// Auftrag an eine Einheit, erteilt zur Schrittzeit, **ohne** Frist: eine künftige Frist
/// widerspräche der Spec („nichts in der Zukunft außer höchstens einer Erinnerung“), eine
/// abgelaufene wäre ein Alarm (D10).
#[derive(Debug, Clone, Copy)]
pub struct AuftragVorlage {
    pub schluessel: &'static str,
    pub text: &'static str,
    /// Schlüssel einer früher gebildeten Einheit.
    pub einheit: &'static str,
    pub ort: Option<&'static str>,
}

/// Befehl oder Lagebericht: Entwurf aus der Vorlage, befüllt und freigegeben. `zeitstand` ist
/// die Schrittzeit; die Freigabe schreibt ihren ETB-Eintrag mit `ereigniszeit = zeitstand`.
#[derive(Debug, Clone, Copy)]
pub struct DokumentVorlage {
    pub vorlage: &'static str,
    pub titel: &'static str,
    /// `(Abschnitts-Schlüssel, Text)`; jeder Schlüssel steht in der Vorlage.
    pub abschnitte: &'static [(&'static str, &'static str)],
}

/// Manuelle Erinnerung. `faellig_vor_min` wie `Schritt::vor_min`, negativ = in der Zukunft.
#[derive(Debug, Clone, Copy)]
pub struct ErinnerungVorlage {
    pub schluessel: &'static str,
    pub titel: &'static str,
    pub beschreibung: &'static str,
    pub faellig_vor_min: i64,
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
    /// Disponierte Kraft einer Einheit zuordnen (Ist-Stärke). ETB: „Einheit «…»: «…» zugeordnet“.
    PersonalZuEinheit {
        personal: &'static str,
        einheit: &'static str,
    },
    /// Gefahrengebiet auf der Lagekarte einrichten und bewerten. ETB: „Gefahrengebiet «…»
    /// eingerichtet“, dazu die Warnstufe der Bewertung.
    Gefahrengebiet(GefahrengebietVorlage),
    /// UHS anlegen, Plätze anlegen, in Betrieb nehmen. ETB: „… in Betrieb genommen“.
    Uhs(UhsVorlage),
    /// Bereitstellungsraum anlegen und in Betrieb nehmen. ETB: „Bereitstellungsraum … in
    /// Betrieb genommen“.
    Bereitstellungsraum(BrVorlage),
    /// Betroffene Person erfassen. ETB: „Person R-… erfasst“, Sichtung, UHS-Aufnahme.
    Person(PersonVorlage),
    /// Evakuierungsbezirk anlegen. ETB (Entscheidung): „Evakuierung Bezirk … angeordnet …“.
    Bezirk(BezirkVorlage),
    /// Standmeldung „evakuiert“ eines Bezirks zur Schrittzeit. ETB (Meldung).
    Stand {
        bezirk: &'static str,
        evakuiert: i64,
        erhebung: Erhebung,
    },
    /// Betreuungsstelle anlegen. ETB: „Betreuungsstelle … angelegt …“.
    Stelle(StelleVorlage),
    /// Betreuungsstelle in Betrieb setzen und verorten. ETB: Statuswechsel.
    StelleInBetrieb {
        stelle: &'static str,
        /// Verortung auf der Lagekarte (LFH-673), `(Länge, Breite)`; schreibt kein ETB.
        lage: Option<Punkt>,
    },
    /// Belegungsmeldung einer Betreuungsstelle zur Schrittzeit. ETB (Meldung).
    Belegung { stelle: &'static str, belegt: i64 },
    /// Meldung. ETB (Meldung) aus dem Repo, bei aktivem Auto-ETB.
    Meldung(MeldungVorlage),
    /// Auftrag erteilen. ETB (Anordnung) aus dem Repo, bei aktivem Auto-ETB.
    Auftrag(AuftragVorlage),
    /// Vollzug eines früher erteilten Auftrags melden. ETB (Meldung) mit dem Rückmeldetext.
    AuftragVollzug {
        auftrag: &'static str,
        meldung: &'static str,
    },
    /// Befehl anlegen, befüllen und freigeben. ETB (Anordnung): der gerenderte Snapshot.
    Befehl(DokumentVorlage),
    /// Lagebericht anlegen, befüllen und freigeben. ETB (Lage): der gerenderte Snapshot.
    Lagebericht(DokumentVorlage),
    /// Manuelle Erinnerung anlegen (Status `offen`). Kein ETB.
    Erinnerung(ErinnerungVorlage),
    /// Früher angelegte Erinnerung erledigen (Status und Vollzug wie im Handler). Kein ETB.
    ErinnerungErledigt { erinnerung: &'static str },
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

const fn personal_zu(vor_min: i64, personal: &'static str, einheit: &'static str) -> Schritt {
    s(vor_min, Vorgang::PersonalZuEinheit { personal, einheit })
}

#[allow(clippy::too_many_arguments)]
const fn person(
    vor_min: i64,
    vorname: &'static str,
    name: &'static str,
    geschlecht: &'static str,
    alter_geschaetzt: i64,
    antreff_ort: &'static str,
    antreff: Option<Punkt>,
    zustand: Option<&'static str>,
    sichtung: Option<Sichtungskategorie>,
    uhs: Option<&'static str>,
) -> Schritt {
    s(
        vor_min,
        Vorgang::Person(PersonVorlage {
            vorname,
            name,
            geschlecht,
            alter_geschaetzt,
            antreff_ort,
            antreff,
            zustand,
            sichtung,
            uhs,
        }),
    )
}

const fn rueckmeldung(
    vor_min: i64,
    absender: &'static str,
    einheit: &'static str,
    inhalt: &'static str,
) -> Schritt {
    s(
        vor_min,
        Vorgang::Meldung(MeldungVorlage {
            absender,
            empfaenger: Some("Einsatzleitung"),
            meldeweg: "funk",
            inhalt,
            meldungsart: crate::meldung::ART_RUECKMELDUNG,
            prioritaet: crate::meldung::PRIO_NORMAL,
            richtung: crate::meldung::RICHTUNG_INTERN,
            einheit: Some(einheit),
            bestaetigt: false,
        }),
    )
}

const fn lagemeldung(vor_min: i64, absender: &'static str, inhalt: &'static str) -> Schritt {
    s(
        vor_min,
        Vorgang::Meldung(MeldungVorlage {
            absender,
            empfaenger: Some("Einsatzleitung"),
            meldeweg: "telefon",
            inhalt,
            meldungsart: crate::meldung::ART_LAGEMELDUNG,
            prioritaet: crate::meldung::PRIO_NORMAL,
            richtung: crate::meldung::RICHTUNG_EXTERN,
            einheit: None,
            bestaetigt: false,
        }),
    )
}

const fn auftrag(
    vor_min: i64,
    schluessel: &'static str,
    einheit: &'static str,
    text: &'static str,
    ort: Option<&'static str>,
) -> Schritt {
    s(
        vor_min,
        Vorgang::Auftrag(AuftragVorlage {
            schluessel,
            text,
            einheit,
            ort,
        }),
    )
}

const fn vollzug(vor_min: i64, auftrag: &'static str, meldung: &'static str) -> Schritt {
    s(vor_min, Vorgang::AuftragVollzug { auftrag, meldung })
}

const fn erinnerung(
    vor_min: i64,
    schluessel: &'static str,
    titel: &'static str,
    beschreibung: &'static str,
    faellig_vor_min: i64,
) -> Schritt {
    s(
        vor_min,
        Vorgang::Erinnerung(ErinnerungVorlage {
            schluessel,
            titel,
            beschreibung,
            faellig_vor_min,
        }),
    )
}

const fn erledigt(vor_min: i64, erinnerung: &'static str) -> Schritt {
    s(vor_min, Vorgang::ErinnerungErledigt { erinnerung })
}

/// Grundriss der UHS Turnhalle: sechs Plätze in zwei Reihen.
const UHS_PLAETZE: &[PlatzVorlage] = &[
    PlatzVorlage {
        typ: PlatzTyp::Wartebereich,
        bezeichnung: "Wartebereich",
        pos: (10.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Behandlungsplatz,
        bezeichnung: "Behandlungsplatz 1",
        pos: (170.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Behandlungsplatz,
        bezeichnung: "Behandlungsplatz 2",
        pos: (330.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Behandlungsplatz,
        bezeichnung: "Behandlungsplatz 3",
        pos: (490.0, 10.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::Trage,
        bezeichnung: "Trage 1",
        pos: (10.0, 130.0),
    },
    PlatzVorlage {
        typ: PlatzTyp::TransportBereitstellung,
        bezeichnung: "Transportbereitstellung",
        pos: (170.0, 130.0),
    },
];

/// Einsatzbefehl (Vorlage LAD) des Szenarios.
pub const BEFEHL: DokumentVorlage = DokumentVorlage {
    vorlage: "befehl_lad",
    titel: "Einsatzbefehl Nr. 1 – Starkregen Musterstadt",
    abschnitte: &[
        (
            "lage",
            "Starkregen über Musterstadt, der Mühlbach ist in der Unterstadt über die Ufer \
             getreten. Mit weiteren Betroffenen ist zu rechnen.",
        ),
        (
            "auftrag",
            "Sanitätsdienstliche Versorgung und Betreuung der Betroffenen, Unterstützung der \
             Evakuierung in der Unterstadt.",
        ),
        (
            "durchfuehrung",
            "EA 1 Sanitätsdienst übernimmt Erstversorgung und Transport. EA 2 Betreuung richtet \
             Betreuungsstellen ein. EA 3 Logistik stellt Material, Verpflegung und Strom sicher.",
        ),
    ],
};

/// Lagebericht (Vorlage „Lagevortrag zur Information“), Zeitstand T−1 h.
pub const LAGEBERICHT: DokumentVorlage = DokumentVorlage {
    vorlage: "lagebericht",
    titel: "Lagebericht 1 – Starkregen Musterstadt",
    abschnitte: &[
        (
            "auftrag",
            "Sanitätsdienst, Betreuung und Logistik im Übungseinsatz Starkregen Musterstadt.",
        ),
        (
            "gefahren_schadenlage",
            "Unterstadt überflutet (Warnstufe hoch), Hangrutsch am Kirchberg (Warnstufe \
             mittel). Mühlbachweg 1–40 wird evakuiert.",
        ),
        (
            "eigene_lage",
            "Fünf Einheiten im Einsatz, UHS Turnhalle und Betreuungsstelle Gesamtschule in \
             Betrieb. KTW Musterstadt 85-2 nicht einsatzbereit.",
        ),
        (
            "lageentwicklung",
            "Aufnahmekapazität der UHS nahezu erschöpft, weitere Betroffene angekündigt.",
        ),
        ("fuehrungsprobleme", ""),
        (
            "antraege_vorschlaege",
            "Weitere Sanitätsgruppe über die Leitstelle anfordern.",
        ),
        (
            "zusammenfassung",
            "Lage in EA 1.1 kritisch, übrige Abschnitte planmäßig.",
        ),
    ],
};

/// Außenring „Überflutung Unterstadt“, `(Länge, Breite)`.
const RING_UNTERSTADT: &[Punkt] = &[
    (10.240, 50.950),
    (10.252, 50.950),
    (10.254, 50.955),
    (10.246, 50.958),
    (10.239, 50.955),
];

/// Außenring „Hangrutsch Kirchberg“, `(Länge, Breite)`.
const RING_KIRCHBERG: &[Punkt] = &[
    (10.262, 50.963),
    (10.268, 50.963),
    (10.268, 50.967),
    (10.262, 50.967),
];

/// Das Drehbuch in Zeitfolge: `vor_min` fällt (nicht streng), der erste Schritt liegt beim
/// Einsatzbeginn, der letzte wenige Minuten vor dem Import. Der Import spielt es in dieser
/// Reihenfolge ab, damit die laufende ETB-Nummer der Zeit folgt (D9).
///
/// Endstand FMS: ELW, RTW 1, GW-San, MTW 4 · RTW 2, LKW 3 · KTW 1 2 · KTW 2 6.
/// Endstand Kommunikation: acht Meldungen (Rückmeldung Logistiktrupp überfällig, vier
/// frisch, Sofortmeldung bestätigt), fünf Aufträge (drei vollzogen, zwei offen ohne Frist),
/// drei Erinnerungen (zwei erledigt, eine in +20 min).
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
    s(
        292,
        Vorgang::Gefahrengebiet(GefahrengebietVorlage {
            label: "Überflutung Unterstadt",
            ring: RING_UNTERSTADT,
            gefahrentyp: "ertrinken",
            schutzobjekt: "menschen",
            warnstufe: Warnstufe::Hoch,
            beschreibung: "Wasserstand in Straßen und Kellern bis 80 cm, starke Strömung",
        }),
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
    personal_zu(276, "zugfuehrer", "zug"),
    personal_zu(276, "notarzt", "rettung"),
    personal_zu(276, "notsan1", "rettung"),
    personal_zu(276, "rettsan1", "rettung"),
    personal_zu(276, "rettsan2", "rettung"),
    s(275, Vorgang::Befehl(BEFEHL)),
    auftrag(
        272,
        "a_wache",
        "rettung",
        "Sanitätswache am Marktplatz einrichten, Erstversorgung der Betroffenen aus der \
         Unterstadt.",
        Some("Marktplatz Musterstadt"),
    ),
    fms(270, "elw", 4),
    fms(270, "rtw1", 4),
    fms(270, "rtw2", 4),
    fms(265, "mtw", 4),
    lagemeldung(
        258,
        "Leitstelle Musterstadt",
        "Mehrere Notrufe aus der Unterstadt: Keller vollgelaufen, Anwohner im Mühlbachweg \
         bitten um Hilfe beim Verlassen der Häuser.",
    ),
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
    s(
        247,
        Vorgang::Uhs(UhsVorlage {
            schluessel: "turnhalle",
            bezeichnung: "Turnhalle Musterstadt",
            typ: UhsTyp::Behandlungsplatz,
            abschnitt: "ea11",
            standort: "Turnhalle an der Schulstraße",
            plaetze: UHS_PLAETZE,
        }),
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
    personal_zu(242, "gruppenfuehrer_san", "uhs"),
    personal_zu(242, "san1", "uhs"),
    personal_zu(242, "gruppenfuehrer_bt", "betreuung"),
    personal_zu(242, "san3", "betreuung"),
    personal_zu(242, "truppfuehrer", "logistik"),
    personal_zu(242, "san2", "logistik"),
    personal_zu(242, "funker", "zug"),
    fms(240, "gwsan", 4),
    vollzug(
        238,
        "a_wache",
        "Sanitätswache Marktplatz besetzt, zwei Behandlungsplätze betriebsbereit.",
    ),
    auftrag(
        236,
        "a_uhs",
        "uhs",
        "UHS Turnhalle betriebsbereit machen und Sichtung nach BBK durchführen.",
        Some("Turnhalle Musterstadt"),
    ),
    s(
        234,
        Vorgang::Bereitstellungsraum(BrVorlage {
            bezeichnung: "Parkplatz Stadion Nord",
            abschnitt: "ea3",
            standort: "Stadionstraße, Parkplatz Nord",
        }),
    ),
    person(
        232,
        "Erika",
        "Mustermann",
        "weiblich",
        64,
        "Mühlbachweg 3",
        Some((10.244, 50.953)),
        Some("Unterkühlt, Prellung am Unterarm"),
        Some(Sichtungskategorie::Sk3),
        Some("turnhalle"),
    ),
    fms(230, "ktw1", 4),
    fms(230, "ktw2", 4),
    s(
        228,
        Vorgang::Bezirk(BezirkVorlage {
            schluessel: "muehlbachweg",
            bezeichnung: "Mühlbachweg 1–40",
            abschnitt: "ea2",
            plan_personen: 120,
            plan_erhebung: Erhebung::Geschaetzt,
            sammelstelle: "Wendeplatz Mühlbachweg",
        }),
    ),
    s(
        226,
        Vorgang::Stelle(StelleVorlage {
            schluessel: "gesamtschule",
            bezeichnung: "Gesamtschule",
            art: BetreuungsstelleArt::Betreuungsstelle,
            abschnitt: "ea2",
            kapazitaet: 150,
            standort: "Gesamtschule Musterstadt, Aula und Mensa",
        }),
    ),
    person(
        225,
        "Hans",
        "Beispielmann",
        "maennlich",
        71,
        "Mühlbachweg 8",
        Some((10.245, 50.954)),
        Some("Atemnot nach Kälteexposition"),
        Some(Sichtungskategorie::Sk2),
        Some("turnhalle"),
    ),
    auftrag(
        222,
        "a_betreuung",
        "betreuung",
        "Betreuungsstelle Gesamtschule einrichten und Aufnahme der Evakuierten vorbereiten.",
        Some("Gesamtschule Musterstadt"),
    ),
    s(
        220,
        Vorgang::StelleInBetrieb {
            stelle: "gesamtschule",
            lage: Some((10.258, 50.960)),
        },
    ),
    vollzug(
        216,
        "a_uhs",
        "UHS Turnhalle betriebsbereit, Sichtung läuft.",
    ),
    person(
        214,
        "Gisela",
        "Musterfrau",
        "weiblich",
        58,
        "Mühlbachweg 12",
        None,
        Some("Schnittwunde am Bein"),
        Some(Sichtungskategorie::Sk3),
        Some("turnhalle"),
    ),
    erinnerung(
        208,
        "lagebesprechung",
        "Lagebesprechung vorbereiten",
        "Lagekarte und Kräfteübersicht für die Lagebesprechung aktualisieren.",
        120,
    ),
    person(
        205,
        "Otto",
        "Normalverbraucher",
        "maennlich",
        45,
        "Brückenstraße 2",
        None,
        Some("Leichte Schürfwunden"),
        Some(Sichtungskategorie::Sk3),
        None,
    ),
    vollzug(
        200,
        "a_betreuung",
        "Betreuungsstelle Gesamtschule in Betrieb, 150 Plätze vorbereitet.",
    ),
    person(
        190,
        "Karl",
        "Exempel",
        "maennlich",
        80,
        "Mühlbachweg 21",
        Some((10.247, 50.955)),
        Some("Sturz auf der Treppe, Verdacht auf Hüftfraktur"),
        Some(Sichtungskategorie::Sk2),
        Some("turnhalle"),
    ),
    lage(
        180,
        "Pegel Mühlbach weiter steigend. Die Unterstadt ist in Teilen nur noch mit \
         geländegängigen Fahrzeugen erreichbar.",
    ),
    lage(
        178,
        "Hangrutsch am Kirchberg gemeldet: die Böschung oberhalb der Kirchstraße ist in \
         Bewegung.",
    ),
    s(
        176,
        Vorgang::Gefahrengebiet(GefahrengebietVorlage {
            label: "Hangrutsch Kirchberg",
            ring: RING_KIRCHBERG,
            gefahrentyp: "einsturz",
            schutzobjekt: "sachwerte",
            warnstufe: Warnstufe::Mittel,
            beschreibung: "Böschung in Bewegung, Gebäude der Kirchstraße gefährdet",
        }),
    ),
    entscheidung(
        174,
        "Kirchberg: der Gefahrenbereich wird abgesperrt, Anwohner der Kirchstraße werden \
         informiert.",
    ),
    person(
        172,
        "Frieda",
        "Probe",
        "weiblich",
        34,
        "Mühlbachweg 27",
        None,
        Some("Unterkühlt"),
        Some(Sichtungskategorie::Sk3),
        Some("turnhalle"),
    ),
    s(
        170,
        Vorgang::Stand {
            bezirk: "muehlbachweg",
            evakuiert: 45,
            erhebung: Erhebung::Geschaetzt,
        },
    ),
    person(
        160,
        "Paula",
        "Platzhalter",
        "weiblich",
        88,
        "Mühlbachweg 30",
        None,
        Some("Schwerste Verletzungen nach Sturz, abwartende Behandlung"),
        Some(Sichtungskategorie::Sk4),
        Some("turnhalle"),
    ),
    erinnerung(
        155,
        "abloesung",
        "Ablösung Rettungsstaffel prüfen",
        "Einsatzdauer der Rettungsstaffel prüfen und Ablösung einplanen.",
        45,
    ),
    fms(150, "rtw2", 3),
    s(
        148,
        Vorgang::Belegung {
            stelle: "gesamtschule",
            belegt: 38,
        },
    ),
    person(
        140,
        "Bernd",
        "Vorlage",
        "maennlich",
        52,
        "Brückenstraße 9",
        None,
        Some("Prellungen"),
        Some(Sichtungskategorie::Sk3),
        None,
    ),
    fms(120, "ktw2", 6),
    erledigt(119, "lagebesprechung"),
    entscheidung(
        118,
        "KTW Musterstadt 85-2 wegen Wasserschaden an der Elektrik außer Betrieb. Transporte \
         übernimmt RTW Musterstadt 83-2.",
    ),
    s(
        112,
        Vorgang::Meldung(MeldungVorlage {
            absender: "Rettungsstaffel",
            empfaenger: Some("Einsatzleitung"),
            meldeweg: "funk",
            inhalt: "Kellerabgang Mühlbachweg 34: eine schwer verletzte Person geborgen, \
                     Transport in die UHS Turnhalle.",
            meldungsart: crate::meldung::ART_SOFORTMELDUNG,
            prioritaet: crate::meldung::PRIO_SOFORT,
            richtung: crate::meldung::RICHTUNG_INTERN,
            einheit: None,
            bestaetigt: true,
        }),
    ),
    person(
        110,
        "Ida",
        "Muster",
        "weiblich",
        41,
        "Mühlbachweg 34",
        Some((10.249, 50.956)),
        Some("Bewusstlos, Verdacht auf Schädel-Hirn-Trauma"),
        Some(Sichtungskategorie::Sk1),
        Some("turnhalle"),
    ),
    rueckmeldung(
        100,
        "Logistiktrupp",
        "logistik",
        "Beleuchtungssatz an der Gesamtschule aufgebaut, Rückkehr zum Bereitstellungsraum.",
    ),
    person(
        95,
        "Moritz",
        "Beispiel",
        "maennlich",
        9,
        "Mühlbachweg 36",
        None,
        Some("Platzwunde am Kopf, ansprechbar"),
        Some(Sichtungskategorie::Sk2),
        Some("turnhalle"),
    ),
    fms(90, "ktw1", 2),
    auftrag(
        85,
        "a_strom",
        "logistik",
        "Stromerzeuger 8 kVA zur UHS Turnhalle verlegen und anschließen.",
        Some("Turnhalle Musterstadt"),
    ),
    person(
        75,
        "Luise",
        "Exempel",
        "weiblich",
        27,
        "Brückenstraße 14",
        None,
        Some("Verstauchung Sprunggelenk"),
        Some(Sichtungskategorie::Sk3),
        None,
    ),
    s(
        70,
        Vorgang::Stand {
            bezirk: "muehlbachweg",
            evakuiert: 96,
            erhebung: Erhebung::Gezaehlt,
        },
    ),
    lagemeldung(
        65,
        "Leitstelle Musterstadt",
        "Wetterdienst: Unwetterwarnung für Musterstadt bis in die Abendstunden verlängert.",
    ),
    lage(
        60,
        "Lage in EA 1.1 kritisch: Aufnahmekapazität der UHS Turnhalle nahezu erschöpft, \
         weitere Betroffene angekündigt.",
    ),
    s(60, Vorgang::Lagebericht(LAGEBERICHT)),
    auftrag(
        55,
        "a_erkundung",
        "zug",
        "Erkundung Kirchberg: Hangbereich oberhalb der Kirchstraße beobachten und \
         Veränderungen sofort melden.",
        Some("Kirchstraße"),
    ),
    person(
        50,
        "Emil",
        "Unbekannt",
        "unbekannt",
        30,
        "Brückenstraße, Höhe Bushaltestelle",
        None,
        None,
        None,
        None,
    ),
    rueckmeldung(
        45,
        "Sanitätszug Musterstadt",
        "zug",
        "Einsatzleitwagen am Marktplatz, Verbindung zu allen Einheiten steht.",
    ),
    erledigt(44, "abloesung"),
    s(
        40,
        Vorgang::Belegung {
            stelle: "gesamtschule",
            belegt: 71,
        },
    ),
    rueckmeldung(
        35,
        "Rettungsstaffel",
        "rettung",
        "RTW Musterstadt 83-2 mit Patientin auf dem Weg ins Krankenhaus, RTW 83-1 am \
         Marktplatz.",
    ),
    entscheidung(
        30,
        "Weitere Sanitätsgruppe über die Leitstelle nachgefordert. Die Betreuung richtet \
         zusätzliche Plätze in der Gesamtschule ein.",
    ),
    rueckmeldung(
        25,
        "Betreuungsgruppe",
        "betreuung",
        "Gesamtschule: 71 Personen in Betreuung, Verpflegung für den Abend angefordert.",
    ),
    erinnerung(
        20,
        "naechste_lagebesprechung",
        "Nächste Lagebesprechung",
        "Lagebesprechung mit allen Abschnittsleitern im Einsatzleitwagen.",
        -20,
    ),
    rueckmeldung(
        15,
        "Sanitätsgruppe UHS",
        "uhs",
        "UHS Turnhalle: acht Patienten in Behandlung, zwei zum Transport bereit.",
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
            // Die übrigen Vorgänge brauchen keinen Katalogeintrag: Gefahrentyp, Schutzobjekt,
            // Warnstufe, UHS- und Platztyp, Sichtung, Meldungs- und Betreuungswerte sind feste
            // Enums im Code, keine Organisationskataloge.
            Vorgang::Abschnitt(_)
            | Vorgang::FahrzeugZuEinheit { .. }
            | Vorgang::PersonalZuEinheit { .. }
            | Vorgang::Gefahrengebiet(_)
            | Vorgang::Uhs(_)
            | Vorgang::Bereitstellungsraum(_)
            | Vorgang::Person(_)
            | Vorgang::Bezirk(_)
            | Vorgang::Stand { .. }
            | Vorgang::Stelle(_)
            | Vorgang::StelleInBetrieb { .. }
            | Vorgang::Belegung { .. }
            | Vorgang::Meldung(_)
            | Vorgang::Auftrag(_)
            | Vorgang::AuftragVollzug { .. }
            | Vorgang::Befehl(_)
            | Vorgang::Lagebericht(_)
            | Vorgang::Erinnerung(_)
            | Vorgang::ErinnerungErledigt { .. }
            | Vorgang::Etb { .. } => None,
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
        let mut zugeordnet = BTreeSet::new();
        let mut uhs = BTreeSet::new();
        let mut bezirke = BTreeSet::new();
        let mut stellen = BTreeSet::new();
        let mut in_betrieb = BTreeSet::new();
        let mut auftraege = BTreeSet::new();
        let mut vollzogen = BTreeSet::new();
        let mut erinnerungen = BTreeSet::new();
        let mut erledigt = BTreeSet::new();
        for schritt in DREHBUCH {
            match schritt.vorgang {
                Vorgang::PersonalZuEinheit {
                    personal: p,
                    einheit,
                } => {
                    assert!(personal.contains(p), "{p} nicht disponiert");
                    assert!(einheiten.contains(einheit), "{einheit} nicht gebildet");
                    assert!(zugeordnet.insert(p), "{p} doppelt zugeordnet");
                }
                Vorgang::Gefahrengebiet(v) => assert!(v.ring.len() >= 3, "{}", v.label),
                Vorgang::Uhs(v) => {
                    assert!(abschnitte.contains(v.abschnitt), "{}", v.abschnitt);
                    assert!(uhs.insert(v.schluessel), "{} doppelt", v.schluessel);
                }
                Vorgang::Bereitstellungsraum(v) => {
                    assert!(abschnitte.contains(v.abschnitt), "{}", v.abschnitt)
                }
                Vorgang::Person(v) => {
                    if let Some(u) = v.uhs {
                        assert!(uhs.contains(u), "{u} vor {}", v.name);
                    }
                }
                Vorgang::Bezirk(v) => {
                    assert!(abschnitte.contains(v.abschnitt), "{}", v.abschnitt);
                    assert!(bezirke.insert(v.schluessel), "{} doppelt", v.schluessel);
                }
                Vorgang::Stand { bezirk, .. } => assert!(bezirke.contains(bezirk), "{bezirk}"),
                Vorgang::Stelle(v) => {
                    assert!(abschnitte.contains(v.abschnitt), "{}", v.abschnitt);
                    assert!(stellen.insert(v.schluessel), "{} doppelt", v.schluessel);
                }
                Vorgang::StelleInBetrieb { stelle, .. } => {
                    assert!(stellen.contains(stelle), "{stelle}");
                    assert!(in_betrieb.insert(stelle), "{stelle} doppelt in Betrieb");
                }
                Vorgang::Belegung { stelle, .. } => {
                    assert!(in_betrieb.contains(stelle), "{stelle} nicht in Betrieb")
                }
                Vorgang::Meldung(v) => {
                    if let Some(e) = v.einheit {
                        assert!(einheiten.contains(e), "{e} nicht gebildet");
                    }
                }
                Vorgang::Auftrag(v) => {
                    assert!(einheiten.contains(v.einheit), "{}", v.einheit);
                    assert!(auftraege.insert(v.schluessel), "{} doppelt", v.schluessel);
                }
                Vorgang::AuftragVollzug { auftrag, meldung } => {
                    assert!(auftraege.contains(auftrag), "{auftrag} nicht erteilt");
                    assert!(vollzogen.insert(auftrag), "{auftrag} doppelt vollzogen");
                    assert!(!meldung.trim().is_empty());
                }
                Vorgang::Befehl(_) | Vorgang::Lagebericht(_) => {}
                Vorgang::Erinnerung(v) => {
                    assert!(
                        erinnerungen.insert(v.schluessel),
                        "{} doppelt",
                        v.schluessel
                    )
                }
                Vorgang::ErinnerungErledigt { erinnerung } => {
                    assert!(erinnerungen.contains(erinnerung), "{erinnerung}");
                    assert!(erledigt.insert(erinnerung), "{erinnerung} doppelt erledigt");
                }
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

    /// Fachwerte, die der Handler als 400/422 abwiese, prüft schon der Datentest: gültige
    /// Gefahren-Kombination, Geschlecht, Meldungs-Enums, Abschnitte der Vorlagen.
    #[test]
    fn fachwerte_sind_gueltig() {
        for schritt in DREHBUCH {
            match schritt.vorgang {
                Vorgang::Gefahrengebiet(v) => {
                    assert!(crate::gefahr::Gefahrentyp::parse(v.gefahrentyp).is_some());
                    assert!(crate::gefahr::Schutzobjekt::parse(v.schutzobjekt).is_some());
                    assert!(
                        crate::gefahr::kombination_gueltig(v.gefahrentyp, v.schutzobjekt),
                        "{}",
                        v.label
                    );
                }
                Vorgang::Person(v) => {
                    assert!(crate::person::Geschlecht::parse(v.geschlecht).is_some());
                }
                Vorgang::Meldung(v) => {
                    assert!(crate::meldung::meldungsart_gueltig(v.meldungsart));
                    assert!(crate::meldung::prioritaet_gueltig(v.prioritaet));
                    assert!(crate::meldung::richtung_gueltig(v.richtung));
                    assert!(crate::etb::MeldeWeg::parse(v.meldeweg).is_some());
                }
                Vorgang::Befehl(d) => {
                    let v = crate::befehl::vorlage(d.vorlage).expect("Befehlsvorlage");
                    for (k, _) in d.abschnitte {
                        assert!(v.abschnitte.iter().any(|a| a.schluessel == *k), "{k}");
                    }
                }
                Vorgang::Lagebericht(d) => {
                    let v = crate::lagebericht::vorlage(d.vorlage).expect("Berichtsvorlage");
                    for (k, _) in d.abschnitte {
                        assert!(v.abschnitte.iter().any(|a| a.schluessel == *k), "{k}");
                    }
                }
                _ => {}
            }
        }
    }

    /// Alarmbudget (D10) und Zeitachse als Daten: jede Sofortmeldung ist bestätigt, keine
    /// Erinnerung wird vor ihrer Fälligkeit erledigt, und in der Zukunft liegt genau eine
    /// Erinnerung, die offen bleibt (Spec „Zeitachse relativ zum Importzeitpunkt“).
    #[test]
    fn kein_alarm_und_nur_eine_erinnerung_in_der_zukunft() {
        let mut faellig = std::collections::BTreeMap::new();
        let mut erledigt = BTreeSet::new();
        for schritt in DREHBUCH {
            match schritt.vorgang {
                Vorgang::Meldung(v) => {
                    let sofort = v.meldungsart == crate::meldung::ART_SOFORTMELDUNG
                        || v.prioritaet == crate::meldung::PRIO_SOFORT;
                    if sofort {
                        assert!(v.bestaetigt, "Sofortmeldung unbestätigt: {}", v.inhalt);
                        assert!(
                            schritt.vor_min > crate::meldung::BESTAETIGUNG_FRIST_DEFAULT_MIN,
                            "Frist liegt in der Zukunft"
                        );
                    }
                }
                Vorgang::Erinnerung(v) => {
                    faellig.insert(v.schluessel, v.faellig_vor_min);
                }
                Vorgang::ErinnerungErledigt { erinnerung } => {
                    assert!(
                        schritt.vor_min <= faellig[erinnerung],
                        "{erinnerung} vor der Fälligkeit erledigt"
                    );
                    erledigt.insert(erinnerung);
                }
                _ => {}
            }
        }
        let zukunft: Vec<_> = faellig.iter().filter(|(_, v)| **v < 0).collect();
        assert_eq!(zukunft.len(), 1, "{zukunft:?}");
        assert!(!erledigt.contains(zukunft[0].0));
        for (k, v) in &faellig {
            if *v >= 0 {
                assert!(erledigt.contains(k), "vergangene Erinnerung {k} offen");
            }
        }
    }
}
