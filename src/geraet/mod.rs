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

pub mod ablauf;
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
    /// `migrations/0286_geraet_kopplung_einheit.sql`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum Funktionsansicht {
        UhsTablet => "uhs-tablet",
        UhsLaptop => "uhs-laptop",
        Lagemonitor => "lagemonitor",
        Betreuungsstelle => "betreuungsstelle",
        Bereitstellungsraum => "bereitstellungsraum",
        Einsatzabschnitt => "einsatzabschnitt",
        Verpflegung => "verpflegung",
        Einheit => "einheit",
    }
    try_from = |s| format!("Ungültige Funktionsansicht: {s}");
}

wire_enum! {
    /// Art der Stelle, an die eine Ansicht gebunden ist (LFH-1040, Verpflegungsstelle LLH-1048,
    /// Einheit LLH-1579). Je Art trägt `geraet_kopplung` eine eigene Spalte mit Fremdschlüssel
    /// (`migrations/0286_…`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum Bindungsart {
        Uhs => "uhs",
        Betreuungsstelle => "betreuungsstelle",
        Bereitstellungsraum => "bereitstellungsraum",
        Einsatzabschnitt => "einsatzabschnitt",
        Verpflegungsstelle => "verpflegungsstelle",
        Einheit => "einheit",
    }
}

/// Die Stelle einer stellengebundenen Kopplung: Art und Kennung.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stelle {
    pub art: Bindungsart,
    pub id: i64,
}

/// Routen, die jede Gerätesitzung erreicht, gleich welche Ansicht: Anmeldestatus, Abmelden,
/// Absturzbericht der Hülle (LLH-1822, nur eine gedrosselte Logzeile, auch vom Lagemonitor),
/// Branding der Organisation, ihr Statuskatalog (Beschriftung und Farbe der Status, ohne
/// Personenbezug; das Einheitengerät setzt damit seinen Status, LLH-1579) und die lesenden
/// Kartengrundlagen. Gegen tote Einträge wacht
/// `tests/geraet_routen_guard.rs`.
pub const ALLE_GERAETE: &[(&str, &str)] = &[
    ("GET", "/api/auth/me"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/client-errors"),
    ("GET", "/api/organization"),
    ("GET", "/api/organization/logo"),
    ("GET", "/api/vehicle-statuses"),
    ("GET", "/api/map/config"),
    ("GET", "/api/map/offline/tiles/{z}/{x}/{y}"),
    ("GET", "/api/map/offline/world/tiles/{z}/{x}/{y}"),
    ("GET", "/api/map/offline/{karte_id}/tiles/{z}/{x}/{y}"),
    ("GET", "/api/map/offline/fonts/{fontstack}/{datei}"),
    ("GET", "/api/map/offline/sprites/{datei}"),
    ("GET", "/api/map/proxy/{id}/style.json"),
    ("GET", "/api/map/proxy/{id}/raster/{z}/{x}/{y}"),
    ("GET", "/api/map/proxy/{id}/tile/{slot}/{z}/{x}/{y}"),
    ("GET", "/api/map/proxy/{id}/tilejson/{slot}"),
    ("GET", "/api/map/proxy/{id}/sprite/{rest}"),
    (
        "GET",
        "/api/map/proxy/{id}/glyphs/{slot}/{fontstack}/{range}",
    ),
    ("GET", "/api/map/proxy/{id}/asset/{slot}"),
];

/// Einsatzrouten, die jede Ansicht liest: Einsatzkopf, Modulfreigaben, Modulzähler und der
/// Live-Kanal. Zähler, Freigaben und Live-Ereignisse schneiden die Handler zusätzlich auf
/// [`Funktionsansicht::lese_module`] zu.
pub const ALLE_ANSICHTEN: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}"),
    ("GET", "/api/incidents/{id}/module-access"),
    ("GET", "/api/incidents/{id}/module-counts"),
    ("GET", "/api/incidents/{id}/live"),
    // Die eigenen Anträge am Spiegel (LLH-1492): das Band liest sie über jeder Ansicht.
    ("GET", "/api/incidents/{id}/requests"),
];

/// Einsatzrouten jeder schreibenden Ansicht (alle außer dem Lagemonitor): einen eigenen,
/// abgelehnten Antrag am Spiegel verwerfen (LLH-1492).
pub const SCHREIBENDE_ANSICHTEN: &[(&str, &str)] =
    &[("DELETE", "/api/incidents/{id}/requests/{antrag_id}")];

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
            Funktionsansicht::Einheit => "Einheit",
        }
    }

    /// Die Art der Stelle, an die die Ansicht gebunden ist oder sein kann; `None` für den
    /// Lagemonitor, der keine Stelle kennt. Ob die Stelle Pflicht ist, sagt
    /// [`Self::ist_stellengebunden`].
    pub fn stellenart(self) -> Option<Bindungsart> {
        match self {
            Funktionsansicht::UhsTablet | Funktionsansicht::UhsLaptop => Some(Bindungsart::Uhs),
            Funktionsansicht::Betreuungsstelle => Some(Bindungsart::Betreuungsstelle),
            Funktionsansicht::Bereitstellungsraum => Some(Bindungsart::Bereitstellungsraum),
            Funktionsansicht::Einsatzabschnitt => Some(Bindungsart::Einsatzabschnitt),
            Funktionsansicht::Verpflegung => Some(Bindungsart::Verpflegungsstelle),
            Funktionsansicht::Einheit => Some(Bindungsart::Einheit),
            Funktionsansicht::Lagemonitor => None,
        }
    }

    /// Ob die Stelle der Ansicht wahlweise ist (LLH-1048, LLH-1024 F7): ohne Stelle arbeitet das
    /// Gerät einsatzweit, mit Stelle nur an ihr. Nur die Verpflegung.
    pub fn stelle_wahlweise(self) -> bool {
        matches!(self, Funktionsansicht::Verpflegung)
    }

    /// Ob die Ansicht an genau eine Stelle gebunden sein muss (ohne Stelle kein Koppeln).
    pub fn ist_stellengebunden(self) -> bool {
        self.stellenart().is_some() && !self.stelle_wahlweise()
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
                | Funktionsansicht::Einheit
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
            // Alle fünf schreiben an ihrer Stelle; die Routenliste verengt die Rolle.
            Funktionsansicht::Betreuungsstelle
            | Funktionsansicht::Bereitstellungsraum
            | Funktionsansicht::Einsatzabschnitt
            | Funktionsansicht::Verpflegung
            | Funktionsansicht::Einheit => EinsatzRolle::Fuehrungspersonal,
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
            // LFH-1042: der eigene Raum, die Kräfte des Einsatzes und die eigenen Meldungen;
            // LLH-1252: das Material des eigenen Raums (die Liste schneidet der Handler zu).
            Funktionsansicht::Bereitstellungsraum => &[
                "bereitstellungsraeume",
                "einheiten",
                "fahrzeuge",
                "meldungen",
                "material",
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
            // Kein `einheiten` (LLH-1055 D4): die Empfängerliste steckt in `verpflegung`, und
            // `einheit`/`abschnitt` tragen `verpflegung` in ihrer Gate-Menge.
            Funktionsansicht::Verpflegung => &["verpflegung", "meldungen"],
            // LLH-1579: die eigene Einheit (Status), ihre Aufträge und ihre Meldungen. Keine
            // Lagekarte: S1 hat keine Karte (Konzept LLH-1571, Abschnitt 3).
            // LLH-1580: die Kontakte der Einheit (versorgende Einheit = eigene, ohne Personalien).
            Funktionsansicht::Einheit => &["einheiten", "auftraege", "meldungen", "personen"],
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
            Funktionsansicht::Einheit => EINHEIT,
        }
    }
}

/// Zusätzliche Einsatzrouten des UHS-Tablets: die eigene UHS lesen, Belegung und
/// Platzverfügbarkeit, Personen der eigenen UHS mit Aufnahme, Stammdaten, Sichtung, Verbleib und
/// Notizen sowie Transport, Maßnahmen und Verletzungen (PAT-Kern), dazu die Auswahl „Bestätigt
/// von“ (LFH-1046). Jeder Handler hier prüft die Stelle über [`stelle`]; Grundriss, Stammdaten der UHS,
/// Material, Status, Storno, Export, Druck, Abgleich und Anhänge fehlen bewusst.
const UHS_TABLET: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}/uhs"),
    ("GET", "/api/incidents/{id}/uhs/{uid}"),
    // Den Plan unter dem Grundriss sehen, nicht ändern (LFH-999).
    ("GET", "/api/incidents/{id}/uhs/{uid}/plan/image"),
    (
        "POST",
        "/api/incidents/{id}/uhs/{uid}/seats/{pid}/availability",
    ),
    ("POST", "/api/incidents/{id}/persons/{pid}/uhs-occupancy"),
    // Rücknahme eines Austritts, wie der Austritt selbst (LLH-1924, design.md D3).
    (
        "POST",
        "/api/incidents/{id}/persons/{pid}/uhs-occupancy/{belegung_id}/undo",
    ),
    ("GET", "/api/incidents/{id}/persons"),
    // Zeilenabruf des Live-Abgleichs (LLH-1682), dieselbe Stellenbindung wie die Liste.
    ("GET", "/api/incidents/{id}/persons/{pid}/row"),
    ("POST", "/api/incidents/{id}/persons"),
    ("GET", "/api/incidents/{id}/persons/{pid}"),
    // Storno-Stand der offenen Detailseite (LLH-1832), dieselbe Bindung wie das Detail.
    ("GET", "/api/incidents/{id}/persons/{pid}/state"),
    ("PATCH", "/api/incidents/{id}/persons/{pid}"),
    ("GET", "/api/incidents/{id}/persons/confirmers"),
    // Vorschläge zum Rettungsmittel (LLH-1332): Fahrzeuge im Einsatz ohne Modul Fahrzeuge.
    ("GET", "/api/incidents/{id}/persons/transport-means"),
    ("POST", "/api/incidents/{id}/persons/{pid}/triage"),
    ("POST", "/api/incidents/{id}/persons/{pid}/whereabouts"),
    ("POST", "/api/incidents/{id}/persons/{pid}/notes"),
    // PAT-Kern (Change y18v58dt-pat-kern, Spec `funktionsansichten`).
    ("POST", "/api/incidents/{id}/persons/{pid}/transport"),
    // Anlass der Hilfeleistung (LLH-1566), wie die Sichtung nur an der UHS.
    ("POST", "/api/incidents/{id}/persons/{pid}/reason"),
    ("POST", "/api/incidents/{id}/persons/{pid}/interventions"),
    (
        "POST",
        "/api/incidents/{id}/persons/{pid}/interventions/{mid}/void",
    ),
    ("POST", "/api/incidents/{id}/persons/{pid}/injuries"),
    (
        "POST",
        "/api/incidents/{id}/persons/{pid}/injuries/{vid}/void",
    ),
];
/// Zusätzliche Einsatzrouten des UHS-Laptops: alles des Tablets, dazu Plätze, Stammdaten,
/// Kräfte und Anhänge der eigenen UHS, Meldungen anlegen und die eigenen lesen. Material liest der Laptop
/// über das UHS-Detail. Status, Stornieren, UHS anlegen und die Zugriffsliste der Anhänge fehlen
/// bewusst; jeder UHS-Handler hier prüft die Stelle über [`stelle`].
const UHS_LAPTOP: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}/uhs"),
    ("GET", "/api/incidents/{id}/uhs/{uid}"),
    ("PATCH", "/api/incidents/{id}/uhs/{uid}"),
    ("POST", "/api/incidents/{id}/uhs/{uid}/seats"),
    ("POST", "/api/incidents/{id}/uhs/{uid}/seats/bulk"),
    ("PATCH", "/api/incidents/{id}/uhs/{uid}/seats/{pid}"),
    ("DELETE", "/api/incidents/{id}/uhs/{uid}/seats/{pid}"),
    (
        "POST",
        "/api/incidents/{id}/uhs/{uid}/seats/{pid}/availability",
    ),
    // Plan des Grundrisses (LFH-999): wer Plätze bearbeitet, setzt auch den Plan.
    ("PUT", "/api/incidents/{id}/uhs/{uid}/plan"),
    ("PATCH", "/api/incidents/{id}/uhs/{uid}/plan"),
    ("DELETE", "/api/incidents/{id}/uhs/{uid}/plan"),
    ("POST", "/api/incidents/{id}/uhs/{uid}/plan/from-attachment"),
    ("GET", "/api/incidents/{id}/uhs/{uid}/plan/image"),
    ("GET", "/api/incidents/{id}/uhs/{uid}/attachments"),
    ("POST", "/api/incidents/{id}/uhs/{uid}/attachments"),
    ("DELETE", "/api/incidents/{id}/uhs/{uid}/attachments/{aid}"),
    (
        "GET",
        "/api/incidents/{id}/uhs/{uid}/attachments/{aid}/file",
    ),
    // Kräfte der eigenen UHS (LFH-1045): zuordnen, ad hoc erfassen, lösen. „Einheit zuordnen“
    // bleibt der Leitung.
    ("GET", "/api/incidents/{id}/uhs/{uid}/forces/available"),
    ("POST", "/api/incidents/{id}/uhs/{uid}/forces"),
    ("PUT", "/api/incidents/{id}/uhs/{uid}/forces/{epid}"),
    ("DELETE", "/api/incidents/{id}/uhs/{uid}/forces/{epid}"),
    ("POST", "/api/incidents/{id}/persons/{pid}/uhs-occupancy"),
    // Rücknahme eines Austritts, wie der Austritt selbst (LLH-1924, design.md D3).
    (
        "POST",
        "/api/incidents/{id}/persons/{pid}/uhs-occupancy/{belegung_id}/undo",
    ),
    ("GET", "/api/incidents/{id}/persons"),
    // Zeilenabruf des Live-Abgleichs (LLH-1682), dieselbe Stellenbindung wie die Liste.
    ("GET", "/api/incidents/{id}/persons/{pid}/row"),
    ("POST", "/api/incidents/{id}/persons"),
    ("GET", "/api/incidents/{id}/persons/{pid}"),
    // Storno-Stand der offenen Detailseite (LLH-1832), dieselbe Bindung wie das Detail.
    ("GET", "/api/incidents/{id}/persons/{pid}/state"),
    ("PATCH", "/api/incidents/{id}/persons/{pid}"),
    ("GET", "/api/incidents/{id}/persons/confirmers"),
    // Vorschläge zum Rettungsmittel (LLH-1332): Fahrzeuge im Einsatz ohne Modul Fahrzeuge.
    ("GET", "/api/incidents/{id}/persons/transport-means"),
    ("POST", "/api/incidents/{id}/persons/{pid}/triage"),
    ("POST", "/api/incidents/{id}/persons/{pid}/whereabouts"),
    ("POST", "/api/incidents/{id}/persons/{pid}/notes"),
    ("POST", "/api/incidents/{id}/persons/{pid}/transport"),
    // Anlass der Hilfeleistung (LLH-1566), wie die Sichtung nur an der UHS.
    ("POST", "/api/incidents/{id}/persons/{pid}/reason"),
    ("POST", "/api/incidents/{id}/persons/{pid}/interventions"),
    (
        "POST",
        "/api/incidents/{id}/persons/{pid}/interventions/{mid}/void",
    ),
    ("POST", "/api/incidents/{id}/persons/{pid}/injuries"),
    (
        "POST",
        "/api/incidents/{id}/persons/{pid}/injuries/{vid}/void",
    ),
    ("GET", "/api/incidents/{id}/reports"),
    ("POST", "/api/incidents/{id}/reports"),
];
/// Zusätzliche Einsatzrouten des Lagemonitors (Subtask Lagemonitor).
/// Nur das verdichtete Lagebild; Karte, Kopf, Freigaben und Live-Kanal kommen aus
/// [`ALLE_GERAETE`] und [`ALLE_ANSICHTEN`].
const LAGEMONITOR: &[(&str, &str)] = &[("GET", "/api/incidents/{id}/situation-monitor")];
/// Zusätzliche Einsatzrouten des Abschnittsgeräts (LFH-1043): den eigenen Teilbaum und seine
/// Einheiten lesen, Aufträge an den Bereich lesen, quittieren und ihren Vollzug melden, die
/// geltenden Einsatzbefehle an den Bereich lesen und ihre eigenen Verteiler-Einträge quittieren
/// und zurücknehmen (LLH-1190), Meldungen an die Einsatzleitung anlegen und die eigenen lesen,
/// Gefahrenzonen lesen. Jeder Handler hier schneidet über [`abschnitt::Abschnittsbereich`] zu;
/// Abschnitte und Einheiten ändern, Aufträge erteilen oder abnehmen, Befehle schreiben und ihre
/// Anlagen, ETB, Personen und Stellen fehlen bewusst.
const EINSATZABSCHNITT: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}/sectors"),
    ("GET", "/api/incidents/{id}/units"),
    ("GET", "/api/incidents/{id}/tasks"),
    ("GET", "/api/incidents/{id}/tasks/{aid}"),
    (
        "POST",
        "/api/incidents/{id}/tasks/{aid}/recipients/{empf}/acknowledge",
    ),
    ("POST", "/api/incidents/{id}/tasks/{aid}/execution"),
    ("GET", "/api/incidents/{id}/orders"),
    ("GET", "/api/incidents/{id}/orders/{bid}"),
    (
        "POST",
        "/api/incidents/{id}/orders/{bid}/distribution/{vid}/acknowledge",
    ),
    (
        "POST",
        "/api/incidents/{id}/orders/{bid}/distribution/{vid}/undo",
    ),
    ("GET", "/api/incidents/{id}/reports"),
    ("POST", "/api/incidents/{id}/reports"),
    ("GET", "/api/incidents/{id}/zones"),
];

/// Zusätzliche Einsatzrouten des Bereitstellungsraums (LFH-1042): den eigenen Raum samt Verlauf
/// lesen (LLH-1095; ein Wechsel nennt dort die Bezeichnung des anderen Raums), Kräfte in ihm an-
/// und abmelden (Eintritt, Wechsel herein, Austritt; `{bid}` ist immer der eigene), das
/// Eintreffen einer erwarteten oder unangemeldeten Kraft buchen (LLH-1075) und ihn in Betrieb
/// nehmen; die Einheiten- und Fahrzeugliste des Einsatzes samt Perioden der Einheiten lesen;
/// Meldungen an die Einsatzleitung anlegen und die eigenen lesen. Jeder BR-Handler hier prüft die
/// Stelle über [`stelle`], der Statuswechsel erlaubt dem Gerät nur `aktiv`. Ausrücken bestätigen
/// ist der Austritt über `…/occupancy` (LLH-1085); Abrufen, Zurücknehmen eines Abrufs und Verlegen
/// hinaus fehlen bewusst (Führungshandlungen, ein Wechsel hinaus trägt den fremden Raum). Anlegen,
/// Stammdaten, Auflösen, Stornieren und jede Änderung an Einheiten und Fahrzeugen (auch
/// Übernehmen und Abweisen) fehlen ebenso, außer dem Anlegen einer unangemeldeten Kraft beim
/// Eintreffen.
const BEREITSTELLUNGSRAUM: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}/staging-areas"),
    ("GET", "/api/incidents/{id}/staging-areas/{bid}"),
    ("GET", "/api/incidents/{id}/staging-areas/{bid}/history"),
    // Erwartete Kräfte aus Nachforderungen mit Ziel = eigener Raum, ohne Freitexte außer Art und
    // Rufnamen (LLH-1387 design.md D1/D2); die Nachforderungsliste bleibt gesperrt.
    ("GET", "/api/incidents/{id}/staging-areas/{bid}/expected"),
    // Einheiten-Vorlagen als Treffer zum eigenen Raum, nur Namen und Funkrufnamen (LLH-1300
    // design.md D2); der Stammdaten-Katalog bleibt gesperrt.
    (
        "GET",
        "/api/incidents/{id}/staging-areas/{bid}/master-data-matches",
    ),
    ("POST", "/api/incidents/{id}/staging-areas/{bid}/occupancy"),
    // Rücknahme eines Austritts, wie das Austragen selbst (LLH-1924, design.md D3).
    (
        "POST",
        "/api/incidents/{id}/staging-areas/{bid}/occupancy/{belegung_id}/undo",
    ),
    ("POST", "/api/incidents/{id}/staging-areas/{bid}/arrival"),
    ("POST", "/api/incidents/{id}/staging-areas/{bid}/status"),
    ("GET", "/api/incidents/{id}/units"),
    ("GET", "/api/incidents/{id}/units/timeline"),
    ("GET", "/api/incidents/{id}/vehicles"),
    ("GET", "/api/incidents/{id}/reports"),
    ("POST", "/api/incidents/{id}/reports"),
    // Material des eigenen Raums nur lesen (LLH-1252, Entscheidung 22.10.2026): der Handler
    // schneidet auf `br_id` = eigener Raum. Zuordnen, Lösen, Status, Aufteilen und Erfassen
    // bleiben der Führungsstelle; ein Schreibweg käme als eigener Eintrag mit Stellenprüfung.
    ("GET", "/api/incidents/{id}/material"),
];

/// Zusätzliche Einsatzrouten der Betreuungsstelle (LFH-1041): die eigene Stelle in der
/// Betreuungsübersicht, ihre Belegung melden und zurücknehmen samt Meldeverlauf, Personen der
/// eigenen Stelle mit Aufnahme, Stammdaten, Verbleib und Notizen, Meldungen anlegen und die
/// eigenen lesen. Bezirke, Kopfzahl, Stammdaten und Status der Stelle, Sichtung, UHS-Belegung,
/// Export, Druck, Abgleich und Anhänge fehlen bewusst; jeder Handler hier prüft die Stelle über
/// [`stelle`].
const BETREUUNGSSTELLE: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}/care"),
    // Storno-Stand der offenen Detailseite (LLH-1832).
    ("GET", "/api/incidents/{id}/care/positions/{sid}/state"),
    (
        "GET",
        "/api/incidents/{id}/care/positions/{sid}/occupancies",
    ),
    (
        "POST",
        "/api/incidents/{id}/care/positions/{sid}/occupancies",
    ),
    ("POST", "/api/incidents/{id}/care/occupancies/{mid}/undo"),
    ("GET", "/api/incidents/{id}/persons"),
    // Zeilenabruf des Live-Abgleichs (LLH-1682), dieselbe Stellenbindung wie die Liste.
    ("GET", "/api/incidents/{id}/persons/{pid}/row"),
    ("POST", "/api/incidents/{id}/persons"),
    ("GET", "/api/incidents/{id}/persons/{pid}"),
    // Storno-Stand der offenen Detailseite (LLH-1832), dieselbe Bindung wie das Detail.
    ("GET", "/api/incidents/{id}/persons/{pid}/state"),
    ("PATCH", "/api/incidents/{id}/persons/{pid}"),
    ("GET", "/api/incidents/{id}/persons/transport-means"),
    ("POST", "/api/incidents/{id}/persons/{pid}/whereabouts"),
    ("POST", "/api/incidents/{id}/persons/{pid}/notes"),
    ("GET", "/api/incidents/{id}/reports"),
    ("POST", "/api/incidents/{id}/reports"),
    // Registrierstelle (LLH-1612): Haushalte an der eigenen Stelle registrieren, ihre Liste
    // lesen und abmelden; der Handler prüft die eigene Stelle (fremd 403).
    (
        "GET",
        "/api/incidents/{id}/care/positions/{sid}/registrations",
    ),
    (
        "POST",
        "/api/incidents/{id}/care/positions/{sid}/registrations",
    ),
    (
        "POST",
        "/api/incidents/{id}/care/positions/{sid}/departures",
    ),
    // Haushalte umbauen (LLH-1615): Bezugsperson wechseln, Person umhängen; nur Personen der
    // eigenen Stelle (der Handler prüft die Stelle, fremd 403).
    (
        "PUT",
        "/api/incidents/{id}/care/positions/{sid}/households/{hid}/contact-person",
    ),
    (
        "PUT",
        "/api/incidents/{id}/care/positions/{sid}/persons/{pid}/household",
    ),
    // Registrierliste drucken (LLH-1616): nur die eigene Stelle (der Handler prüft, fremd 403),
    // je Person protokolliert. Bewusste Ausnahme zu „Personendruck nie am Gerät“
    // (`frontend/src/druck/AGENTS.md`); die Personendruckansicht bleibt draußen.
    (
        "GET",
        "/api/incidents/{id}/care/positions/{sid}/registrations/print",
    ),
];

/// Zusätzliche Einsatzrouten des Verpflegungsgeräts (LFH-1044), einsatzweit oder an einer
/// Verpflegungsstelle (LLH-1048): die Zeitfenster mit Deckung lesen, Portionen ausgeben und eine
/// Ausgabe zurücknehmen; Meldungen an die Einsatzleitung anlegen und die eigenen lesen (so meldet
/// das Gerät eine Fehlmenge). Ein an eine Stelle gebundenes Gerät schneiden die Handler über
/// [`stelle::sicht_wahlweise`] auf seine Stelle zu.
/// Zeitfenster anlegen, ändern und löschen, Nachforderungen (ihre Liste trägt Namen), Personal,
/// Betreuung und ETB fehlen bewusst; eine Ausgabe auf eine Nachforderung lehnt der Handler ab.
/// Empfänger (LLH-1055, design.md D3/D4): Einheiten und Abschnitte liest das Gerät nur als
/// Empfängerliste in `GET …/catering` (ohne Führer, Verbindungen und Mitglieder) und bucht an
/// sie. `GET …/units` fehlt bewusst: sie trägt Personalnamen. Live erreichen es `einheit` und
/// `abschnitt` über deren Gate-Menge, nicht über ein Lese-Modul `einheiten`.
const VERPFLEGUNG: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}/catering"),
    (
        "POST",
        "/api/incidents/{id}/catering/time-slots/{zid}/distributions",
    ),
    (
        "POST",
        "/api/incidents/{id}/catering/distributions/{aid}/undo",
    ),
    ("GET", "/api/incidents/{id}/reports"),
    ("POST", "/api/incidents/{id}/reports"),
];

/// Zusätzliche Einsatzrouten des Einheitengeräts (LLH-1579, Konzept LLH-1571 S1): die eigene
/// Einheit lesen und ihren Handstatus setzen (den Statuskatalog liest jedes Gerät), Aufträge
/// mit Empfänger = eigene Einheit lesen, die eigene Empfängerzeile quittieren und den Vollzug
/// melden, Meldungen an die Einsatzleitung anlegen (Absender fest die eigene Einheit) und die
/// eigenen lesen. Jeder Handler schneidet über [`abschnitt::bereich`] zu, der für dieses Gerät
/// nur die eine Einheit enthält; Aufträge an ihren Abschnitt sieht es nicht (F4). Abschnitte,
/// Einsatzbefehle, Karte und Gefahrenzonen, Personal, Fahrzeuge und Material fehlen bewusst.
const EINHEIT: &[(&str, &str)] = &[
    ("GET", "/api/incidents/{id}/units"),
    ("PUT", "/api/incidents/{id}/units/{eid}/status"),
    // Den eigenen Wechsel zurücknehmen (LLH-1986).
    ("POST", "/api/incidents/{id}/units/{eid}/status/undo"),
    ("GET", "/api/incidents/{id}/tasks"),
    ("GET", "/api/incidents/{id}/tasks/{aid}"),
    (
        "POST",
        "/api/incidents/{id}/tasks/{aid}/recipients/{empf}/acknowledge",
    ),
    ("POST", "/api/incidents/{id}/tasks/{aid}/execution"),
    ("GET", "/api/incidents/{id}/reports"),
    ("POST", "/api/incidents/{id}/reports"),
    // Kontakte am Handy (LLH-1580, Konzept LLH-1571 S2): die Personen mit versorgender Einheit =
    // eigene ohne Personalien lesen, einen Kontakt anlegen (Einheit fest, „Zur UHS“ in eine
    // aktive UHS, RTW als Sofortmeldung) und die aktiven UHS als Ziel wählen. Kein Detail, keine
    // Korrektur: das bleibt UHS und Einsatzleitung.
    ("GET", "/api/incidents/{id}/persons"),
    // Zeilenabruf des Live-Abgleichs (LLH-1682), dieselbe Stellenbindung wie die Liste.
    ("GET", "/api/incidents/{id}/persons/{pid}/row"),
    ("POST", "/api/incidents/{id}/persons"),
    ("GET", "/api/incidents/{id}/persons/uhs"),
];

/// Ob eine Gerätesitzung mit dieser Ansicht die Route `(methode, pfad)` aufrufen darf. `pfad`
/// ist die `MatchedPath` (Muster mit Platzhaltern). Ohne Treffer: verboten.
pub fn darf_route(ansicht: Funktionsansicht, methode: &str, pfad: &str) -> bool {
    let passt = |liste: &[(&str, &str)]| liste.iter().any(|(m, p)| *m == methode && *p == pfad);
    passt(ALLE_GERAETE)
        || passt(ALLE_ANSICHTEN)
        || (ansicht != Funktionsansicht::Lagemonitor && passt(SCHREIBENDE_ANSICHTEN))
        || passt(ansicht.routen())
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
    /// ([`stelle::eigene`]). Bei wahlweiser Bindung (Verpflegung) heißt `None`: einsatzweit
    /// ([`stelle::sicht_wahlweise`]).
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
            assert!(!darf_route(a, "GET", "/api/incidents/{id}/etb"));
            assert!(!darf_route(a, "GET", "/api/users"));
            assert!(!darf_route(a, "PATCH", "/api/incidents/{id}"));
            assert!(darf_route(a, "GET", "/api/incidents/{id}"));
            assert!(darf_route(a, "GET", "/api/auth/me"));
        }
    }

    #[test]
    fn antraege_liest_jede_ansicht_verwerfen_nur_eine_schreibende() {
        let verwerfen = "/api/incidents/{id}/requests/{antrag_id}";
        for a in Funktionsansicht::ALLE {
            assert!(darf_route(a, "GET", "/api/incidents/{id}/requests"));
            assert_eq!(
                darf_route(a, "DELETE", verwerfen),
                a != Funktionsansicht::Lagemonitor,
                "{a:?}"
            );
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
        assert!(darf_route(t, "GET", "/api/incidents/{id}/uhs/{uid}"));
        assert!(darf_route(
            t,
            "POST",
            "/api/incidents/{id}/uhs/{uid}/seats/{pid}/availability"
        ));
        for (m, p) in [
            ("POST", "/api/incidents/{id}/uhs/{uid}/seats"),
            ("POST", "/api/incidents/{id}/uhs/{uid}/seats/bulk"),
            ("PATCH", "/api/incidents/{id}/uhs/{uid}/seats/{pid}"),
            ("DELETE", "/api/incidents/{id}/uhs/{uid}/seats/{pid}"),
            ("PATCH", "/api/incidents/{id}/uhs/{uid}"),
            ("POST", "/api/incidents/{id}/uhs/{uid}/status"),
            ("POST", "/api/incidents/{id}/uhs"),
            ("DELETE", "/api/incidents/{id}/persons/{pid}"),
            ("GET", "/api/incidents/{id}/persons/export"),
            ("POST", "/api/incidents/{id}/persons/{pid}/matches"),
            ("GET", "/api/incidents/{id}/persons/{pid}/attachments"),
            ("PUT", "/api/incidents/{id}/uhs/{uid}/plan"),
            ("PATCH", "/api/incidents/{id}/uhs/{uid}/plan"),
            ("DELETE", "/api/incidents/{id}/uhs/{uid}/plan"),
            ("POST", "/api/incidents/{id}/uhs/{uid}/plan/from-attachment"),
        ] {
            assert!(!darf_route(t, m, p), "Tablet darf {m} {p} nicht");
        }
        // Den Plan sieht es (LFH-999).
        assert!(darf_route(
            t,
            "GET",
            "/api/incidents/{id}/uhs/{uid}/plan/image"
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
        assert_eq!(
            F::Verpflegung.stellenart(),
            Some(Bindungsart::Verpflegungsstelle)
        );
        assert_eq!(F::Einheit.stellenart(), Some(Bindungsart::Einheit));
        assert_eq!(F::Lagemonitor.stellenart(), None);
    }

    /// LLH-1048 (LLH-1024 F7): nur die Verpflegung bindet wahlweise; jede andere Ansicht mit
    /// Stellenart braucht ihre Stelle, der Lagemonitor kennt keine.
    #[test]
    fn nur_die_verpflegung_bindet_wahlweise() {
        for a in Funktionsansicht::ALLE {
            let wahlweise = a == Funktionsansicht::Verpflegung;
            assert_eq!(a.stelle_wahlweise(), wahlweise, "{a:?}");
            assert_eq!(
                a.ist_stellengebunden(),
                a.stellenart().is_some() && !wahlweise,
                "{a:?}"
            );
        }
        assert!(!Funktionsansicht::Verpflegung.ist_stellengebunden());
        assert!(!Funktionsansicht::Lagemonitor.ist_stellengebunden());
    }

    #[test]
    fn bereitstellungsraum_verwaltet_den_raum_nicht() {
        let b = Funktionsansicht::Bereitstellungsraum;
        assert!(b.ist_verfuegbar());
        assert!(b.rolle().darf_schreiben());
        for (m, p) in [
            ("GET", "/api/incidents/{id}/staging-areas/{bid}"),
            ("GET", "/api/incidents/{id}/staging-areas/{bid}/history"),
            ("POST", "/api/incidents/{id}/staging-areas/{bid}/occupancy"),
            ("POST", "/api/incidents/{id}/staging-areas/{bid}/status"),
            ("POST", "/api/incidents/{id}/staging-areas/{bid}/arrival"),
            ("GET", "/api/incidents/{id}/units"),
            ("GET", "/api/incidents/{id}/units/timeline"),
            ("POST", "/api/incidents/{id}/reports"),
            // Erwartete Kräfte aus Nachforderungen mit Ziel = eigener Raum, ohne Freitexte
            // (LLH-1387 design.md D1).
            ("GET", "/api/incidents/{id}/staging-areas/{bid}/expected"),
            // Stamm-Treffer zum eigenen Raum (LLH-1300 design.md D2).
            (
                "GET",
                "/api/incidents/{id}/staging-areas/{bid}/master-data-matches",
            ),
        ] {
            assert!(darf_route(b, m, p), "BR-Gerät darf {m} {p}");
        }
        for (m, p) in [
            ("POST", "/api/incidents/{id}/staging-areas"),
            ("PATCH", "/api/incidents/{id}/staging-areas/{bid}"),
            ("DELETE", "/api/incidents/{id}/staging-areas/{bid}"),
            ("PATCH", "/api/incidents/{id}/units/{eid}"),
            ("PATCH", "/api/incidents/{id}/units/{eid}/position"),
            ("POST", "/api/incidents/{id}/units/{eid}/take-over"),
            ("POST", "/api/incidents/{id}/units/{eid}/reject"),
            ("GET", "/api/incidents/{id}/units/{eid}/timeline"),
            ("POST", "/api/incidents/{id}/units"),
            ("GET", "/api/incidents/{id}/persons"),
            ("GET", "/api/incidents/{id}/uhs"),
            // Nachforderungen bleiben der Führung, auch mit Ziel = eigener Raum (LLH-1383
            // design.md D11): weder die Liste lesen noch „Eintreffen melden“ noch als Einheit
            // übernehmen. Was erwartet wird, liest das Gerät nur über `…/erwartet` (LLH-1387).
            // Den Stammdaten-Katalog liest das Gerät nie, Treffer nur über `…/stamm-treffer`
            // (LLH-1300).
            ("GET", "/api/unit-templates"),
            (
                "GET",
                "/api/incidents/{id}/units/from-template/{vorlage_id}",
            ),
            ("POST", "/api/incidents/{id}/units/from-template"),
            ("GET", "/api/incidents/{id}/resource-requests"),
            ("POST", "/api/incidents/{id}/resource-requests/{nid}/status"),
            ("POST", "/api/incidents/{id}/units/from-resource-request"),
            // Ebenso der Storno einer Fehlübernahme (LLH-1388 D5).
            ("POST", "/api/incidents/{id}/units/{eid}/annul-takeover"),
        ] {
            assert!(!darf_route(b, m, p), "BR-Gerät darf {m} {p} nicht");
        }
    }

    /// Die üblichen Arten der Organisation (LLH-1379, design.md D3) zählen über andere Einsätze:
    /// keine Ansicht darf sie, auch die nicht, die Nachforderungen absetzt.
    #[test]
    fn kein_geraet_liest_die_ueblichen_arten_der_organisation() {
        for a in Funktionsansicht::ALLE {
            assert!(
                !darf_route(a, "GET", "/api/incidents/{id}/resource-requests/types"),
                "{a:?} darf die üblichen Arten nicht lesen"
            );
        }
    }

    /// Abrufen und Zurücknehmen eines Abrufs sind Führungshandlungen (LLH-1085, design.md D2):
    /// keine Ansicht darf sie, auch nicht der Bereitstellungsraum, der das Ausrücken als Austritt
    /// bucht.
    #[test]
    fn kein_geraet_ruft_ab_oder_nimmt_zurueck() {
        for a in Funktionsansicht::ALLE {
            for p in [
                "/api/incidents/{id}/staging-areas/{bid}/dispatch",
                "/api/incidents/{id}/staging-areas/{bid}/dispatch/void",
            ] {
                assert!(!darf_route(a, "POST", p), "{a:?} darf POST {p} nicht");
            }
        }
        assert!(darf_route(
            Funktionsansicht::Bereitstellungsraum,
            "POST",
            "/api/incidents/{id}/staging-areas/{bid}/occupancy"
        ));
        assert!(darf_route(
            Funktionsansicht::Bereitstellungsraum,
            "POST",
            "/api/incidents/{id}/staging-areas/{bid}/occupancy/{belegung_id}/undo"
        ));
    }

    #[test]
    fn verpflegung_bucht_aber_plant_nicht() {
        let v = Funktionsansicht::Verpflegung;
        assert!(v.ist_verfuegbar());
        assert!(v.rolle().darf_schreiben());
        for (m, p) in [
            ("GET", "/api/incidents/{id}/catering"),
            (
                "POST",
                "/api/incidents/{id}/catering/time-slots/{zid}/distributions",
            ),
            (
                "POST",
                "/api/incidents/{id}/catering/distributions/{aid}/undo",
            ),
            ("GET", "/api/incidents/{id}/reports"),
            ("POST", "/api/incidents/{id}/reports"),
        ] {
            assert!(darf_route(v, m, p), "Verpflegungsgerät darf {m} {p}");
        }
        for (m, p) in [
            ("POST", "/api/incidents/{id}/catering/time-slots"),
            ("PATCH", "/api/incidents/{id}/catering/time-slots/{zid}"),
            ("DELETE", "/api/incidents/{id}/catering/time-slots/{zid}"),
            // Verpflegungsstellen planen (LLH-1040 D12): liest sie über `GET …/catering`,
            // legt aber keine an, ändert, storniert und wechselt keinen Status.
            ("POST", "/api/incidents/{id}/catering/positions"),
            ("PATCH", "/api/incidents/{id}/catering/positions/{sid}"),
            ("DELETE", "/api/incidents/{id}/catering/positions/{sid}"),
            (
                "POST",
                "/api/incidents/{id}/catering/positions/{sid}/status",
            ),
            // Tag aus der Vorlage (LLH-1058 D12): planen bleibt der Führung, den
            // Verpflegungsplan liest das Gerät nicht.
            (
                "POST",
                "/api/incidents/{id}/catering/time-slots/from-template",
            ),
            ("GET", "/api/catering-templates"),
            ("GET", "/api/incidents/{id}/resource-requests"),
            ("POST", "/api/incidents/{id}/resource-requests"),
            ("GET", "/api/incidents/{id}/personnel"),
            ("GET", "/api/incidents/{id}/care"),
            ("GET", "/api/incidents/{id}/persons"),
            ("GET", "/api/incidents/{id}/etb"),
            // Empfänger nur über die Projektion in `GET …/catering` (LLH-1055 D3): die
            // Einheitenliste trägt Führer, Verbindungen und Personalnamen.
            ("GET", "/api/incidents/{id}/units"),
            ("GET", "/api/incidents/{id}/sectors"),
        ] {
            assert!(!darf_route(v, m, p), "Verpflegungsgerät darf {m} {p} nicht");
        }
    }

    #[test]
    fn abschnittsgeraet_liest_seinen_bereich_und_meldet_nur_zurueck() {
        let a = Funktionsansicht::Einsatzabschnitt;
        assert!(a.ist_verfuegbar());
        for (m, p) in [
            ("GET", "/api/incidents/{id}/sectors"),
            ("GET", "/api/incidents/{id}/units"),
            ("GET", "/api/incidents/{id}/tasks"),
            ("GET", "/api/incidents/{id}/tasks/{aid}"),
            (
                "POST",
                "/api/incidents/{id}/tasks/{aid}/recipients/{empf}/acknowledge",
            ),
            ("POST", "/api/incidents/{id}/tasks/{aid}/execution"),
            ("POST", "/api/incidents/{id}/reports"),
            ("GET", "/api/incidents/{id}/zones"),
        ] {
            assert!(darf_route(a, m, p), "Abschnittsgerät darf {m} {p}");
        }
        for (m, p) in [
            ("POST", "/api/incidents/{id}/sectors"),
            ("PATCH", "/api/incidents/{id}/sectors/{aid}"),
            ("PATCH", "/api/incidents/{id}/sectors/{aid}/area"),
            ("DELETE", "/api/incidents/{id}/sectors/{aid}"),
            ("POST", "/api/incidents/{id}/units"),
            ("PATCH", "/api/incidents/{id}/units/{eid}"),
            ("PUT", "/api/incidents/{id}/units/{eid}/status"),
            ("POST", "/api/incidents/{id}/units/{eid}/status/undo"),
            ("POST", "/api/incidents/{id}/tasks"),
            ("POST", "/api/incidents/{id}/tasks/{aid}/accept"),
            // Aufheben und Berichtigen gehören der Führung (LLH-1098).
            ("POST", "/api/incidents/{id}/tasks/{aid}/void"),
            ("PATCH", "/api/incidents/{id}/tasks/{aid}"),
            ("GET", "/api/incidents/{id}/tasks/metrics"),
            ("POST", "/api/incidents/{id}/zones"),
            ("GET", "/api/incidents/{id}/free-symbols"),
            ("GET", "/api/incidents/{id}/personnel"),
            ("GET", "/api/incidents/{id}/persons"),
            ("GET", "/api/incidents/{id}/uhs"),
            ("GET", "/api/incidents/{id}/staging-areas"),
            ("GET", "/api/incidents/{id}/situation-monitor"),
        ] {
            assert!(!darf_route(a, m, p), "Abschnittsgerät darf {m} {p} nicht");
        }
    }

    /// LLH-1579 (Konzept LLH-1571 S1): Aufträge, Status und Melden der eigenen Einheit. Keine
    /// Abschnitte, keine Befehle, keine Karte und keine Führungshandlung an Einheiten.
    #[test]
    fn einheitengeraet_meldet_status_und_quittiert_aber_fuehrt_nicht() {
        let e = Funktionsansicht::Einheit;
        assert!(e.ist_verfuegbar());
        assert!(e.ist_stellengebunden());
        assert_eq!(e.stellenart(), Some(Bindungsart::Einheit));
        assert!(e.rolle().darf_schreiben());
        assert_eq!(
            e.lese_module(),
            ["einheiten", "auftraege", "meldungen", "personen"]
        );
        for (m, p) in [
            ("GET", "/api/vehicle-statuses"),
            ("GET", "/api/incidents/{id}/units"),
            ("PUT", "/api/incidents/{id}/units/{eid}/status"),
            ("POST", "/api/incidents/{id}/units/{eid}/status/undo"),
            ("GET", "/api/incidents/{id}/tasks"),
            ("GET", "/api/incidents/{id}/tasks/{aid}"),
            (
                "POST",
                "/api/incidents/{id}/tasks/{aid}/recipients/{empf}/acknowledge",
            ),
            ("POST", "/api/incidents/{id}/tasks/{aid}/execution"),
            ("GET", "/api/incidents/{id}/reports"),
            ("POST", "/api/incidents/{id}/reports"),
            ("GET", "/api/incidents/{id}/persons"),
            ("POST", "/api/incidents/{id}/persons"),
            ("GET", "/api/incidents/{id}/persons/uhs"),
        ] {
            assert!(darf_route(e, m, p), "Einheitengerät darf {m} {p}");
        }
        for (m, p) in [
            ("GET", "/api/incidents/{id}/sectors"),
            ("GET", "/api/incidents/{id}/orders"),
            ("GET", "/api/incidents/{id}/zones"),
            ("GET", "/api/incidents/{id}/vehicles"),
            ("GET", "/api/incidents/{id}/personnel"),
            ("GET", "/api/incidents/{id}/persons/{pid}"),
            ("PATCH", "/api/incidents/{id}/persons/{pid}"),
            ("POST", "/api/incidents/{id}/persons/{pid}/whereabouts"),
            ("POST", "/api/incidents/{id}/persons/{pid}/reason"),
            ("GET", "/api/incidents/{id}/persons/units"),
            ("GET", "/api/incidents/{id}/uhs"),
            ("POST", "/api/incidents/{id}/units"),
            ("PATCH", "/api/incidents/{id}/units/{eid}"),
            ("PATCH", "/api/incidents/{id}/units/{eid}/position"),
            ("DELETE", "/api/incidents/{id}/units/{eid}"),
            ("POST", "/api/incidents/{id}/tasks"),
            ("POST", "/api/incidents/{id}/tasks/{aid}/accept"),
            ("POST", "/api/incidents/{id}/tasks/{aid}/void"),
            ("PATCH", "/api/incidents/{id}/reports/{mid}"),
            ("POST", "/api/vehicle-statuses"),
        ] {
            assert!(!darf_route(e, m, p), "Einheitengerät darf {m} {p} nicht");
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
            ("GET", "/api/incidents/{id}/care"),
            (
                "POST",
                "/api/incidents/{id}/care/positions/{sid}/occupancies",
            ),
            ("POST", "/api/incidents/{id}/persons"),
            ("POST", "/api/incidents/{id}/persons/{pid}/whereabouts"),
            ("POST", "/api/incidents/{id}/reports"),
        ] {
            assert!(darf_route(b, m, p), "Betreuungsstelle darf {m} {p}");
        }
        for (m, p) in [
            ("GET", "/api/incidents/{id}/care/occupancy"),
            ("POST", "/api/incidents/{id}/care/positions"),
            ("PATCH", "/api/incidents/{id}/care/positions/{sid}"),
            ("POST", "/api/incidents/{id}/care/positions/{sid}/annul"),
            // Bezirke sind das eigene Modul Evakuierung (LLH-1034); die Stelle sieht keins davon.
            ("GET", "/api/incidents/{id}/evacuation"),
            ("POST", "/api/incidents/{id}/evacuation/districts"),
            (
                "POST",
                "/api/incidents/{id}/evacuation/districts/{bid}/progress",
            ),
            (
                "GET",
                "/api/incidents/{id}/evacuation/districts/{bid}/progress",
            ),
            ("POST", "/api/incidents/{id}/persons/{pid}/triage"),
            ("POST", "/api/incidents/{id}/persons/{pid}/uhs-occupancy"),
            // Rücknahme eines Austritts, wie der Austritt selbst (LLH-1924, design.md D3).
            (
                "POST",
                "/api/incidents/{id}/persons/{pid}/uhs-occupancy/{belegung_id}/undo",
            ),
            ("GET", "/api/incidents/{id}/uhs"),
            ("GET", "/api/incidents/{id}/persons/export"),
            ("GET", "/api/incidents/{id}/etb"),
        ] {
            assert!(!darf_route(b, m, p), "Betreuungsstelle darf {m} {p} nicht");
        }
    }
}
