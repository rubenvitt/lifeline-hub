//! Gerätekopplung und Funktionsansichten (LFH-892).
//!
//! Ein ausgegebenes Gerät (UHS-Tablet, UHS-Laptop, Lagemonitor, …) arbeitet ohne Personenkonto in
//! genau einem Einsatz, einer [`Funktionsansicht`] und ggf. einer [`Stelle`]. Es schreibt unter
//! einem eigenen Gerätekonto (`benutzer`-Zeile, verknüpft über `geraet_kopplung.benutzer_id`).
//!
//! **Die Schranke steht in [`crate::auth::session::CurrentUser`]:** jede authentifizierte Route
//! zieht ihn. Für eine Gerätesitzung prüft er `(Methode, MatchedPath)` gegen
//! [`darf_route`]; was nicht gelistet ist, ist 403. Eine neue Route ist damit für Geräte
//! gesperrt, ohne dass jemand an sie denkt. Herleitung:
//! `openspec/changes/archive/2026-10-05-lfh-892-funktionsansichten-geraete/design.md` (D4, D5).

pub mod abschnitt;
pub mod bestaetigung;
pub mod code;
pub mod repo;
pub mod stelle;

use crate::einsatz::EinsatzRolle;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Anmeldeweg der Code-Einlösung in `auth_audit` (`provider`).
pub const PROVIDER: &str = "geraetecode";

/// Vorgabe der Kopplungsdauer ohne Angabe, in Stunden (design.md D3).
pub const STANDARD_STUNDEN: i64 = 24;
/// Längste erlaubte Kopplungsdauer ab jetzt, in Stunden.
pub const HOECHSTENS_STUNDEN: i64 = 72;
/// Gültigkeit eines Kopplungscodes, in Minuten.
pub const CODE_MINUTEN: i64 = 10;
/// Längste Gerätebezeichnung in Zeichen.
pub const BEZEICHNUNG_MAX: usize = 60;

wire_enum! {
    /// Funktionsansicht eines gekoppelten Geräts. Wire-Werte stehen als CHECK in
    /// `migrations/0159_geraet_kopplung_stellenarten.sql`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum Funktionsansicht {
        UhsTablet => "uhs-tablet",
        UhsLaptop => "uhs-laptop",
        Lagemonitor => "lagemonitor",
        Betreuungsstelle => "betreuungsstelle",
        Bereitstellungsraum => "bereitstellungsraum",
        Einsatzabschnitt => "einsatzabschnitt",
        Verpflegung => "verpflegung",
    }
    try_from = |s| format!("Ungültige Funktionsansicht: {s}");
}

wire_enum! {
    /// Art der Stelle, an die eine Ansicht gebunden ist (LFH-1040). Je Art trägt
    /// `geraet_kopplung` eine eigene Spalte mit Fremdschlüssel (`migrations/0159_…`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum Bindungsart {
        Uhs => "uhs",
        Betreuungsstelle => "betreuungsstelle",
        Bereitstellungsraum => "bereitstellungsraum",
        Einsatzabschnitt => "einsatzabschnitt",
    }
}

/// Die Stelle einer stellengebundenen Kopplung: Art und Kennung.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stelle {
    pub art: Bindungsart,
    pub id: i64,
}

/// Routen, die jede Gerätesitzung erreicht, gleich welche Ansicht: Anmeldestatus, Abmelden,
/// Branding der Organisation und die lesenden Kartengrundlagen. Gegen tote Einträge wacht
/// `tests/geraet_routen_guard.rs`.
pub const ALLE_GERAETE: &[(&str, &str)] = &[
    ("GET", "/api/auth/me"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/organisation"),
    ("GET", "/api/organisation/logo"),
    ("GET", "/api/karte/config"),
    ("GET", "/api/karte/offline/tiles/{z}/{x}/{y}"),
    ("GET", "/api/karte/offline/welt/tiles/{z}/{x}/{y}"),
    ("GET", "/api/karte/offline/{karte_id}/tiles/{z}/{x}/{y}"),
    ("GET", "/api/karte/offline/fonts/{fontstack}/{datei}"),
    ("GET", "/api/karte/offline/sprites/{datei}"),
    ("GET", "/api/karte/proxy/{id}/style.json"),
    ("GET", "/api/karte/proxy/{id}/raster/{z}/{x}/{y}"),
    ("GET", "/api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y}"),
    ("GET", "/api/karte/proxy/{id}/tilejson/{slot}"),
    ("GET", "/api/karte/proxy/{id}/sprite/{rest}"),
    (
        "GET",
        "/api/karte/proxy/{id}/glyphs/{slot}/{fontstack}/{range}",
    ),
];

/// Einsatzrouten, die jede Ansicht liest: Einsatzkopf, Modulfreigaben, Modulzähler und der
/// Live-Kanal. Zähler, Freigaben und Live-Ereignisse schneiden die Handler zusätzlich auf
/// [`Funktionsansicht::lese_module`] zu.
pub const ALLE_ANSICHTEN: &[(&str, &str)] = &[
    ("GET", "/api/einsaetze/{id}"),
    ("GET", "/api/einsaetze/{id}/modul-freigaben"),
    ("GET", "/api/einsaetze/{id}/modul-zaehler"),
    ("GET", "/api/einsaetze/{id}/live"),
];

impl Funktionsansicht {
    /// Anzeigename der Ansicht (ETB-Text, Oberfläche).
    pub fn label(self) -> &'static str {
        match self {
            Funktionsansicht::UhsTablet => "UHS-Tablet",
            Funktionsansicht::UhsLaptop => "UHS-Laptop",
            Funktionsansicht::Lagemonitor => "Lagemonitor",
            Funktionsansicht::Betreuungsstelle => "Betreuungsstelle",
            Funktionsansicht::Bereitstellungsraum => "Bereitstellungsraum",
            Funktionsansicht::Einsatzabschnitt => "Einsatzabschnitt",
            Funktionsansicht::Verpflegung => "Verpflegung",
        }
    }

    /// Die Art der Stelle, an die die Ansicht gebunden ist; `None` für Ansichten ohne Stelle
    /// (Lagemonitor, Verpflegung).
    pub fn stellenart(self) -> Option<Bindungsart> {
        match self {
            Funktionsansicht::UhsTablet | Funktionsansicht::UhsLaptop => Some(Bindungsart::Uhs),
            Funktionsansicht::Betreuungsstelle => Some(Bindungsart::Betreuungsstelle),
            Funktionsansicht::Bereitstellungsraum => Some(Bindungsart::Bereitstellungsraum),
            Funktionsansicht::Einsatzabschnitt => Some(Bindungsart::Einsatzabschnitt),
            Funktionsansicht::Lagemonitor | Funktionsansicht::Verpflegung => None,
        }
    }

    /// Ob die Ansicht an genau eine Stelle gebunden ist.
    pub fn ist_stellengebunden(self) -> bool {
        self.stellenart().is_some()
    }

    /// Ob die Einsatzleitung ein Gerät mit dieser Ansicht koppeln kann. Eine Ansicht wird erst
    /// verfügbar, wenn ihre Routenliste, Stellenfilter, Tests und Hülle stehen (LFH-1040:
    /// Katalog und Bindung kommen vorab, jede Ansicht schaltet sich in ihrem Task frei).
    pub fn ist_verfuegbar(self) -> bool {
        matches!(
            self,
            Funktionsansicht::UhsTablet
                | Funktionsansicht::UhsLaptop
                | Funktionsansicht::Lagemonitor
                | Funktionsansicht::Betreuungsstelle
                | Funktionsansicht::Bereitstellungsraum
                | Funktionsansicht::Einsatzabschnitt
                | Funktionsansicht::Verpflegung
        )
    }

    /// Ob die Ansicht ohne Personenbezug auskommt: keine Namen von Benutzern (etwa Bearbeiter
    /// einer Meldung) und keine Freitexte des Einsatzkopfs, die Personen nennen können
    /// (Lagemonitor, Verpflegung LFH-1044).
    pub fn ohne_personenbezug(self) -> bool {
        matches!(
            self,
            Funktionsansicht::Lagemonitor | Funktionsansicht::Verpflegung
        )
    }

    /// Die Einsatzrolle, die ein Gerät dieser Ansicht trägt. Die Ansicht verengt sie über
    /// [`Self::routen`]; ein Gerät ist nie Mitglied in `einsatz_mitgliedschaft`.
    pub fn rolle(self) -> EinsatzRolle {
        match self {
            Funktionsansicht::UhsTablet | Funktionsansicht::UhsLaptop => {
                EinsatzRolle::Fuehrungspersonal
            }
            Funktionsansicht::Lagemonitor => EinsatzRolle::Beobachter,
            // Alle vier schreiben an ihrer Stelle; die Routenliste verengt die Rolle.
            Funktionsansicht::Betreuungsstelle
            | Funktionsansicht::Bereitstellungsraum
            | Funktionsansicht::Einsatzabschnitt
            | Funktionsansicht::Verpflegung => EinsatzRolle::Fuehrungspersonal,
        }
    }

    /// Die Module, deren Live-Ereignisse, Zähler und Freigaben das Gerät erhält.
    pub fn lese_module(self) -> &'static [&'static str] {
        match self {
            Funktionsansicht::UhsTablet => &["unfallhilfsstellen", "personen"],
            Funktionsansicht::UhsLaptop => {
                &["unfallhilfsstellen", "personen", "material", "meldungen"]
            }
            Funktionsansicht::Lagemonitor => &[
                "unfallhilfsstellen",
                "lagekarte",
                "gefahrenzonen",
                "einsatzabschnitte",
            ],
            // LFH-1042: der eigene Raum, die Kräfte des Einsatzes und die eigenen Meldungen.
            Funktionsansicht::Bereitstellungsraum => &[
                "bereitstellungsraeume",
                "einheiten",
                "fahrzeuge",
                "meldungen",
            ],
            Funktionsansicht::Einsatzabschnitt => &[
                "einsatzabschnitte",
                "einheiten",
                "auftraege",
                "meldungen",
                "lagekarte",
                "gefahrenzonen",
            ],
            Funktionsansicht::Betreuungsstelle => &["betreuung", "personen", "meldungen"],
            // LFH-1044: Zeitfenster mit Deckung und die eigenen Meldungen; keine Nachforderungen.
            Funktionsansicht::Verpflegung => &["verpflegung", "meldungen"],
        }
    }

    /// Die Einsatzrouten der Ansicht über [`ALLE_ANSICHTEN`] hinaus, als
    /// `(Methode, MatchedPath)`. Die Scope-Matrix aus `specs/funktionsansichten/spec.md`; jede
    /// Zeile mit Stellenbindung braucht den Stellenfilter im Handler.
    pub fn routen(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Funktionsansicht::UhsTablet => UHS_TABLET,
            Funktionsansicht::UhsLaptop => UHS_LAPTOP,
            Funktionsansicht::Lagemonitor => LAGEMONITOR,
            Funktionsansicht::Bereitstellungsraum => BEREITSTELLUNGSRAUM,
            Funktionsansicht::Einsatzabschnitt => EINSATZABSCHNITT,
            Funktionsansicht::Betreuungsstelle => BETREUUNGSSTELLE,
            Funktionsansicht::Verpflegung => VERPFLEGUNG,
        }
    }
}

/// Zusätzliche Einsatzrouten des UHS-Tablets: die eigene UHS lesen, Belegung und
/// Platzverfügbarkeit, Personen der eigenen UHS mit Aufnahme, Stammdaten, Sichtung, Verbleib und
/// Notizen, dazu die Auswahl „Bestätigt von“ (LFH-1046). Jeder Handler hier prüft die Stelle über [`stelle`]; Grundriss, Stammdaten der UHS,
/// Material, Status, Storno, Export, Druck, Abgleich und Anhänge fehlen bewusst.
const UHS_TABLET: &[(&str, &str)] = &[
    ("GET", "/api/einsaetze/{id}/uhs"),
    ("GET", "/api/einsaetze/{id}/uhs/{uid}"),
    // Den Plan unter dem Grundriss sehen, nicht ändern (LFH-999).
    ("GET", "/api/einsaetze/{id}/uhs/{uid}/plan/bild"),
    (
        "POST",
        "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit",
    ),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/uhs-belegung"),
    ("GET", "/api/einsaetze/{id}/personen"),
    ("POST", "/api/einsaetze/{id}/personen"),
    ("GET", "/api/einsaetze/{id}/personen/{pid}"),
    ("PATCH", "/api/einsaetze/{id}/personen/{pid}"),
    ("GET", "/api/einsaetze/{id}/personen/bestaetiger"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/sichtung"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/verbleib"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/notizen"),
];
/// Zusätzliche Einsatzrouten des UHS-Laptops: alles des Tablets, dazu Plätze, Stammdaten,
/// Kräfte und Anhänge der eigenen UHS, Meldungen anlegen und die eigenen lesen. Material liest der Laptop
/// über das UHS-Detail. Status, Stornieren, UHS anlegen und die Zugriffsliste der Anhänge fehlen
/// bewusst; jeder UHS-Handler hier prüft die Stelle über [`stelle`].
const UHS_LAPTOP: &[(&str, &str)] = &[
    ("GET", "/api/einsaetze/{id}/uhs"),
    ("GET", "/api/einsaetze/{id}/uhs/{uid}"),
    ("PATCH", "/api/einsaetze/{id}/uhs/{uid}"),
    ("POST", "/api/einsaetze/{id}/uhs/{uid}/plaetze"),
    ("POST", "/api/einsaetze/{id}/uhs/{uid}/plaetze/bulk"),
    ("PATCH", "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}"),
    ("DELETE", "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}"),
    (
        "POST",
        "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit",
    ),
    // Plan des Grundrisses (LFH-999): wer Plätze bearbeitet, setzt auch den Plan.
    ("PUT", "/api/einsaetze/{id}/uhs/{uid}/plan"),
    ("PATCH", "/api/einsaetze/{id}/uhs/{uid}/plan"),
    ("DELETE", "/api/einsaetze/{id}/uhs/{uid}/plan"),
    ("POST", "/api/einsaetze/{id}/uhs/{uid}/plan/aus-anhang"),
    ("GET", "/api/einsaetze/{id}/uhs/{uid}/plan/bild"),
    ("GET", "/api/einsaetze/{id}/uhs/{uid}/anhaenge"),
    ("POST", "/api/einsaetze/{id}/uhs/{uid}/anhaenge"),
    ("DELETE", "/api/einsaetze/{id}/uhs/{uid}/anhaenge/{aid}"),
    ("GET", "/api/einsaetze/{id}/uhs/{uid}/anhaenge/{aid}/datei"),
    // Kräfte der eigenen UHS (LFH-1045): zuordnen, ad hoc erfassen, lösen. „Einheit zuordnen“
    // bleibt der Leitung.
    ("GET", "/api/einsaetze/{id}/uhs/{uid}/kraefte/verfuegbar"),
    ("POST", "/api/einsaetze/{id}/uhs/{uid}/kraefte"),
    ("PUT", "/api/einsaetze/{id}/uhs/{uid}/kraefte/{epid}"),
    ("DELETE", "/api/einsaetze/{id}/uhs/{uid}/kraefte/{epid}"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/uhs-belegung"),
    ("GET", "/api/einsaetze/{id}/personen"),
    ("POST", "/api/einsaetze/{id}/personen"),
    ("GET", "/api/einsaetze/{id}/personen/{pid}"),
    ("PATCH", "/api/einsaetze/{id}/personen/{pid}"),
    ("GET", "/api/einsaetze/{id}/personen/bestaetiger"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/sichtung"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/verbleib"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/notizen"),
    ("GET", "/api/einsaetze/{id}/meldungen"),
    ("POST", "/api/einsaetze/{id}/meldungen"),
];
/// Zusätzliche Einsatzrouten des Lagemonitors (Subtask Lagemonitor).
/// Nur das verdichtete Lagebild; Karte, Kopf, Freigaben und Live-Kanal kommen aus
/// [`ALLE_GERAETE`] und [`ALLE_ANSICHTEN`].
const LAGEMONITOR: &[(&str, &str)] = &[("GET", "/api/einsaetze/{id}/lagemonitor")];
/// Zusätzliche Einsatzrouten des Abschnittsgeräts (LFH-1043): den eigenen Teilbaum und seine
/// Einheiten lesen, Aufträge an den Bereich lesen, quittieren und ihren Vollzug melden, Meldungen
/// an die Einsatzleitung anlegen und die eigenen lesen, Gefahrenzonen lesen. Jeder Handler hier
/// schneidet über [`abschnitt::Abschnittsbereich`] zu; Abschnitte und Einheiten ändern, Aufträge
/// erteilen oder abnehmen, ETB, Personen und Stellen fehlen bewusst.
const EINSATZABSCHNITT: &[(&str, &str)] = &[
    ("GET", "/api/einsaetze/{id}/abschnitte"),
    ("GET", "/api/einsaetze/{id}/einheiten"),
    ("GET", "/api/einsaetze/{id}/auftraege"),
    ("GET", "/api/einsaetze/{id}/auftraege/{aid}"),
    (
        "POST",
        "/api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren",
    ),
    ("POST", "/api/einsaetze/{id}/auftraege/{aid}/vollzug"),
    ("GET", "/api/einsaetze/{id}/meldungen"),
    ("POST", "/api/einsaetze/{id}/meldungen"),
    ("GET", "/api/einsaetze/{id}/zonen"),
];

/// Zusätzliche Einsatzrouten des Bereitstellungsraums (LFH-1042): den eigenen Raum lesen, Kräfte
/// in ihm an- und abmelden (Eintritt, Wechsel herein, Austritt; `{bid}` ist immer der eigene) und
/// ihn in Betrieb nehmen; die Einheiten- und Fahrzeugliste des Einsatzes lesen; Meldungen an die
/// Einsatzleitung anlegen und die eigenen lesen. Jeder BR-Handler hier prüft die Stelle über
/// [`stelle`], der Statuswechsel erlaubt dem Gerät nur `aktiv`. Anlegen, Stammdaten, Auflösen,
/// Stornieren und jede Änderung an Einheiten und Fahrzeugen (auch das Abrufen) fehlen bewusst.
const BEREITSTELLUNGSRAUM: &[(&str, &str)] = &[
    ("GET", "/api/einsaetze/{id}/bereitstellungsraeume"),
    ("GET", "/api/einsaetze/{id}/bereitstellungsraeume/{bid}"),
    (
        "POST",
        "/api/einsaetze/{id}/bereitstellungsraeume/{bid}/belegung",
    ),
    (
        "POST",
        "/api/einsaetze/{id}/bereitstellungsraeume/{bid}/status",
    ),
    ("GET", "/api/einsaetze/{id}/einheiten"),
    ("GET", "/api/einsaetze/{id}/fahrzeuge"),
    ("GET", "/api/einsaetze/{id}/meldungen"),
    ("POST", "/api/einsaetze/{id}/meldungen"),
];

/// Zusätzliche Einsatzrouten der Betreuungsstelle (LFH-1041): die eigene Stelle in der
/// Betreuungsübersicht, ihre Belegung melden und zurücknehmen samt Meldeverlauf, Personen der
/// eigenen Stelle mit Aufnahme, Stammdaten, Verbleib und Notizen, Meldungen anlegen und die
/// eigenen lesen. Bezirke, Kopfzahl, Stammdaten und Status der Stelle, Sichtung, UHS-Belegung,
/// Export, Druck, Abgleich und Anhänge fehlen bewusst; jeder Handler hier prüft die Stelle über
/// [`stelle`].
const BETREUUNGSSTELLE: &[(&str, &str)] = &[
    ("GET", "/api/einsaetze/{id}/betreuung"),
    (
        "GET",
        "/api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen",
    ),
    (
        "POST",
        "/api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen",
    ),
    (
        "POST",
        "/api/einsaetze/{id}/betreuung/belegungen/{mid}/zuruecknehmen",
    ),
    ("GET", "/api/einsaetze/{id}/personen"),
    ("POST", "/api/einsaetze/{id}/personen"),
    ("GET", "/api/einsaetze/{id}/personen/{pid}"),
    ("PATCH", "/api/einsaetze/{id}/personen/{pid}"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/verbleib"),
    ("POST", "/api/einsaetze/{id}/personen/{pid}/notizen"),
    ("GET", "/api/einsaetze/{id}/meldungen"),
    ("POST", "/api/einsaetze/{id}/meldungen"),
];

/// Zusätzliche Einsatzrouten des Verpflegungsgeräts (LFH-1044), einsatzweit ohne Stelle: die
/// Zeitfenster mit Deckung lesen, Portionen ausgeben und eine Ausgabe zurücknehmen; Meldungen an
/// die Einsatzleitung anlegen und die eigenen lesen (so meldet das Gerät eine Fehlmenge).
/// Zeitfenster anlegen, ändern und löschen, Nachforderungen (ihre Liste trägt Namen), Personal,
/// Betreuung und ETB fehlen bewusst; eine Ausgabe auf eine Nachforderung lehnt der Handler ab.
const VERPFLEGUNG: &[(&str, &str)] = &[
    ("GET", "/api/einsaetze/{id}/verpflegung"),
    (
        "POST",
        "/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}/ausgaben",
    ),
    (
        "POST",
        "/api/einsaetze/{id}/verpflegung/ausgaben/{aid}/zuruecknehmen",
    ),
    ("GET", "/api/einsaetze/{id}/meldungen"),
    ("POST", "/api/einsaetze/{id}/meldungen"),
];

/// Ob eine Gerätesitzung mit dieser Ansicht die Route `(methode, pfad)` aufrufen darf. `pfad`
/// ist die `MatchedPath` (Muster mit Platzhaltern). Ohne Treffer: verboten.
pub fn darf_route(ansicht: Funktionsansicht, methode: &str, pfad: &str) -> bool {
    let passt = |liste: &[(&str, &str)]| liste.iter().any(|(m, p)| *m == methode && *p == pfad);
    passt(ALLE_GERAETE) || passt(ALLE_ANSICHTEN) || passt(ansicht.routen())
}

/// Der Kontext einer Gerätesitzung. [`crate::auth::session::CurrentUser`] legt ihn in die
/// Extensions der Anfrage; `EinsatzKontext` und die Handler lesen ihn dort.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeraetKontext {
    pub kopplung_id: i64,
    pub einsatz_id: i64,
    pub ansicht: Funktionsansicht,
    /// Stelle der stellengebundenen Ansichten. `None` bei einer gebundenen Ansicht heißt: die
    /// Stelle ist weg (Abschnitt aufgelöst); das Gerät sieht dann keine Stelle mehr
    /// ([`stelle::eigene`]).
    pub stelle: Option<Stelle>,
    pub bezeichnung: String,
    pub laeuft_ab_at: String,
}

impl GeraetKontext {
    /// Schneidet eine Modulmenge auf die Lese-Module der Ansicht zu.
    pub fn schneide_module<'a>(
        &self,
        module: impl IntoIterator<Item = &'a str>,
    ) -> std::collections::HashSet<&'a str> {
        let erlaubt = self.ansicht.lese_module();
        module.into_iter().filter(|m| erlaubt.contains(m)).collect()
    }
}

/// Verengt die Modulfreigaben auf die Ansicht eines Geräts: Module außerhalb von
/// [`Funktionsansicht::lese_module`] sind für das Gerät weder sichtbar noch zugänglich. Ohne
/// Gerät unverändert.
pub fn verenge_freigaben(
    geraet: Option<&GeraetKontext>,
    freigaben: &mut std::collections::HashMap<
        &'static str,
        crate::einsatz::berechtigung::ModulFreigabe,
    >,
) {
    let Some(g) = geraet else { return };
    let erlaubt = g.ansicht.lese_module();
    for (key, freigabe) in freigaben.iter_mut() {
        if !erlaubt.contains(key) {
            freigabe.sichtbar = false;
            freigabe.zugriff = false;
        }
    }
}

/// Wie ein Gerät sich selbst sieht (`GET /api/auth/me`, Feld `geraet`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct GeraetAnzeige {
    pub kopplung_id: i64,
    pub einsatz_id: i64,
    pub ansicht: Funktionsansicht,
    /// UHS der UHS-Ansichten (Spiegel von `stelle_id`, für die UHS-Seiten).
    pub uhs_id: Option<i64>,
    /// Kennung der Stelle, gleich welcher Art; die Art folgt aus der Ansicht.
    pub stelle_id: Option<i64>,
    /// Bezeichnung der Stelle, falls stellengebunden.
    pub stelle: Option<String>,
    pub bezeichnung: String,
    pub laeuft_ab_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lagemonitor_darf_nur_lesen() {
        for (m, _) in ALLE_ANSICHTEN
            .iter()
            .chain(Funktionsansicht::Lagemonitor.routen())
        {
            assert_eq!(*m, "GET", "Lagemonitor schreibt nichts");
        }
    }

    #[test]
    fn nicht_gelistete_route_ist_verboten() {
        for a in Funktionsansicht::ALLE {
            assert!(!darf_route(a, "GET", "/api/einsaetze/{id}/etb"));
            assert!(!darf_route(a, "GET", "/api/benutzer"));
            assert!(!darf_route(a, "PATCH", "/api/einsaetze/{id}"));
            assert!(darf_route(a, "GET", "/api/einsaetze/{id}"));
            assert!(darf_route(a, "GET", "/api/auth/me"));
        }
    }

    #[test]
    fn methode_zaehlt() {
        assert!(darf_route(
            Funktionsansicht::UhsTablet,
            "POST",
            "/api/auth/logout"
        ));
        assert!(!darf_route(
            Funktionsansicht::UhsTablet,
            "GET",
            "/api/auth/logout"
        ));
    }

    #[test]
    fn tablet_bearbeitet_den_grundriss_nicht() {
        let t = Funktionsansicht::UhsTablet;
        assert!(darf_route(t, "GET", "/api/einsaetze/{id}/uhs/{uid}"));
        assert!(darf_route(
            t,
            "POST",
            "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit"
        ));
        for (m, p) in [
            ("POST", "/api/einsaetze/{id}/uhs/{uid}/plaetze"),
            ("POST", "/api/einsaetze/{id}/uhs/{uid}/plaetze/bulk"),
            ("PATCH", "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}"),
            ("DELETE", "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}"),
            ("PATCH", "/api/einsaetze/{id}/uhs/{uid}"),
            ("POST", "/api/einsaetze/{id}/uhs/{uid}/status"),
            ("POST", "/api/einsaetze/{id}/uhs"),
            ("DELETE", "/api/einsaetze/{id}/personen/{pid}"),
            ("GET", "/api/einsaetze/{id}/personen/export"),
            ("POST", "/api/einsaetze/{id}/personen/{pid}/abgleich"),
            ("GET", "/api/einsaetze/{id}/personen/{pid}/anhaenge"),
            ("PUT", "/api/einsaetze/{id}/uhs/{uid}/plan"),
            ("PATCH", "/api/einsaetze/{id}/uhs/{uid}/plan"),
            ("DELETE", "/api/einsaetze/{id}/uhs/{uid}/plan"),
            ("POST", "/api/einsaetze/{id}/uhs/{uid}/plan/aus-anhang"),
        ] {
            assert!(!darf_route(t, m, p), "Tablet darf {m} {p} nicht");
        }
        // Den Plan sieht es (LFH-999).
        assert!(darf_route(
            t,
            "GET",
            "/api/einsaetze/{id}/uhs/{uid}/plan/bild"
        ));
    }

    #[test]
    fn rollen_der_ansichten() {
        assert_eq!(
            Funktionsansicht::Lagemonitor.rolle(),
            EinsatzRolle::Beobachter
        );
        assert!(Funktionsansicht::UhsTablet.rolle().darf_schreiben());
        assert!(Funktionsansicht::UhsLaptop.ist_stellengebunden());
        assert!(!Funktionsansicht::Lagemonitor.ist_stellengebunden());
    }

    #[test]
    fn stellenarten_der_ansichten() {
        use Funktionsansicht as F;
        assert_eq!(F::UhsTablet.stellenart(), Some(Bindungsart::Uhs));
        assert_eq!(F::UhsLaptop.stellenart(), Some(Bindungsart::Uhs));
        assert_eq!(
            F::Betreuungsstelle.stellenart(),
            Some(Bindungsart::Betreuungsstelle)
        );
        assert_eq!(
            F::Bereitstellungsraum.stellenart(),
            Some(Bindungsart::Bereitstellungsraum)
        );
        assert_eq!(
            F::Einsatzabschnitt.stellenart(),
            Some(Bindungsart::Einsatzabschnitt)
        );
        assert_eq!(F::Verpflegung.stellenart(), None);
        assert_eq!(F::Lagemonitor.stellenart(), None);
    }

    #[test]
    fn bereitstellungsraum_verwaltet_den_raum_nicht() {
        let b = Funktionsansicht::Bereitstellungsraum;
        assert!(b.ist_verfuegbar());
        assert!(b.rolle().darf_schreiben());
        for (m, p) in [
            ("GET", "/api/einsaetze/{id}/bereitstellungsraeume/{bid}"),
            (
                "POST",
                "/api/einsaetze/{id}/bereitstellungsraeume/{bid}/belegung",
            ),
            (
                "POST",
                "/api/einsaetze/{id}/bereitstellungsraeume/{bid}/status",
            ),
            ("GET", "/api/einsaetze/{id}/einheiten"),
            ("POST", "/api/einsaetze/{id}/meldungen"),
        ] {
            assert!(darf_route(b, m, p), "BR-Gerät darf {m} {p}");
        }
        for (m, p) in [
            ("POST", "/api/einsaetze/{id}/bereitstellungsraeume"),
            ("PATCH", "/api/einsaetze/{id}/bereitstellungsraeume/{bid}"),
            ("DELETE", "/api/einsaetze/{id}/bereitstellungsraeume/{bid}"),
            ("PATCH", "/api/einsaetze/{id}/einheiten/{eid}"),
            ("PATCH", "/api/einsaetze/{id}/einheiten/{eid}/position"),
            ("GET", "/api/einsaetze/{id}/personen"),
            ("GET", "/api/einsaetze/{id}/uhs"),
        ] {
            assert!(!darf_route(b, m, p), "BR-Gerät darf {m} {p} nicht");
        }
    }

    #[test]
    fn verpflegung_bucht_aber_plant_nicht() {
        let v = Funktionsansicht::Verpflegung;
        assert!(v.ist_verfuegbar());
        assert!(v.rolle().darf_schreiben());
        for (m, p) in [
            ("GET", "/api/einsaetze/{id}/verpflegung"),
            (
                "POST",
                "/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}/ausgaben",
            ),
            (
                "POST",
                "/api/einsaetze/{id}/verpflegung/ausgaben/{aid}/zuruecknehmen",
            ),
            ("GET", "/api/einsaetze/{id}/meldungen"),
            ("POST", "/api/einsaetze/{id}/meldungen"),
        ] {
            assert!(darf_route(v, m, p), "Verpflegungsgerät darf {m} {p}");
        }
        for (m, p) in [
            ("POST", "/api/einsaetze/{id}/verpflegung/zeitfenster"),
            ("PATCH", "/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}"),
            (
                "DELETE",
                "/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}",
            ),
            ("GET", "/api/einsaetze/{id}/nachforderungen"),
            ("POST", "/api/einsaetze/{id}/nachforderungen"),
            ("GET", "/api/einsaetze/{id}/personal"),
            ("GET", "/api/einsaetze/{id}/betreuung"),
            ("GET", "/api/einsaetze/{id}/personen"),
            ("GET", "/api/einsaetze/{id}/etb"),
        ] {
            assert!(!darf_route(v, m, p), "Verpflegungsgerät darf {m} {p} nicht");
        }
    }

    #[test]
    fn abschnittsgeraet_liest_seinen_bereich_und_meldet_nur_zurueck() {
        let a = Funktionsansicht::Einsatzabschnitt;
        assert!(a.ist_verfuegbar());
        for (m, p) in [
            ("GET", "/api/einsaetze/{id}/abschnitte"),
            ("GET", "/api/einsaetze/{id}/einheiten"),
            ("GET", "/api/einsaetze/{id}/auftraege"),
            ("GET", "/api/einsaetze/{id}/auftraege/{aid}"),
            (
                "POST",
                "/api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren",
            ),
            ("POST", "/api/einsaetze/{id}/auftraege/{aid}/vollzug"),
            ("POST", "/api/einsaetze/{id}/meldungen"),
            ("GET", "/api/einsaetze/{id}/zonen"),
        ] {
            assert!(darf_route(a, m, p), "Abschnittsgerät darf {m} {p}");
        }
        for (m, p) in [
            ("POST", "/api/einsaetze/{id}/abschnitte"),
            ("PATCH", "/api/einsaetze/{id}/abschnitte/{aid}"),
            ("PATCH", "/api/einsaetze/{id}/abschnitte/{aid}/flaeche"),
            ("DELETE", "/api/einsaetze/{id}/abschnitte/{aid}"),
            ("POST", "/api/einsaetze/{id}/einheiten"),
            ("PATCH", "/api/einsaetze/{id}/einheiten/{eid}"),
            ("PUT", "/api/einsaetze/{id}/einheiten/{eid}/status"),
            ("POST", "/api/einsaetze/{id}/auftraege"),
            ("POST", "/api/einsaetze/{id}/auftraege/{aid}/abnehmen"),
            ("GET", "/api/einsaetze/{id}/auftraege/kennzahlen"),
            ("POST", "/api/einsaetze/{id}/zonen"),
            ("GET", "/api/einsaetze/{id}/freie-zeichen"),
            ("GET", "/api/einsaetze/{id}/personal"),
            ("GET", "/api/einsaetze/{id}/personen"),
            ("GET", "/api/einsaetze/{id}/uhs"),
            ("GET", "/api/einsaetze/{id}/bereitstellungsraeume"),
            ("GET", "/api/einsaetze/{id}/lagemonitor"),
        ] {
            assert!(!darf_route(a, m, p), "Abschnittsgerät darf {m} {p} nicht");
        }
    }

    #[test]
    fn nicht_verfuegbare_ansicht_erreicht_nur_den_einsatzkopf() {
        for a in Funktionsansicht::ALLE {
            if a.ist_verfuegbar() {
                continue;
            }
            assert!(a.routen().is_empty(), "{a:?} hat Routen, ist aber gesperrt");
            assert!(a.lese_module().is_empty(), "{a:?} liest Module");
        }
    }

    #[test]
    fn betreuungsstelle_meldet_nur_ihre_belegung() {
        let b = Funktionsansicht::Betreuungsstelle;
        assert!(b.ist_verfuegbar());
        assert!(b.rolle().darf_schreiben());
        for (m, p) in [
            ("GET", "/api/einsaetze/{id}/betreuung"),
            (
                "POST",
                "/api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen",
            ),
            ("POST", "/api/einsaetze/{id}/personen"),
            ("POST", "/api/einsaetze/{id}/personen/{pid}/verbleib"),
            ("POST", "/api/einsaetze/{id}/meldungen"),
        ] {
            assert!(darf_route(b, m, p), "Betreuungsstelle darf {m} {p}");
        }
        for (m, p) in [
            ("GET", "/api/einsaetze/{id}/betreuung/belegung"),
            ("POST", "/api/einsaetze/{id}/betreuung/stellen"),
            ("PATCH", "/api/einsaetze/{id}/betreuung/stellen/{sid}"),
            (
                "POST",
                "/api/einsaetze/{id}/betreuung/stellen/{sid}/stornieren",
            ),
            ("POST", "/api/einsaetze/{id}/betreuung/bezirke"),
            (
                "POST",
                "/api/einsaetze/{id}/betreuung/bezirke/{bid}/staende",
            ),
            ("GET", "/api/einsaetze/{id}/betreuung/bezirke/{bid}/staende"),
            ("POST", "/api/einsaetze/{id}/personen/{pid}/sichtung"),
            ("POST", "/api/einsaetze/{id}/personen/{pid}/uhs-belegung"),
            ("GET", "/api/einsaetze/{id}/uhs"),
            ("GET", "/api/einsaetze/{id}/personen/export"),
            ("GET", "/api/einsaetze/{id}/etb"),
        ] {
            assert!(!darf_route(b, m, p), "Betreuungsstelle darf {m} {p} nicht");
        }
    }
}
