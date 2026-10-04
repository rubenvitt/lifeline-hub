//! Gerätekopplung und Funktionsansichten (LFH-892).
//!
//! Ein ausgegebenes Gerät (UHS-Tablet, UHS-Laptop, Lagemonitor) arbeitet ohne Personenkonto in
//! genau einem Einsatz, einer [`Funktionsansicht`] und ggf. einer UHS. Es schreibt unter einem
//! eigenen Gerätekonto (`benutzer`-Zeile, verknüpft über `geraet_kopplung.benutzer_id`).
//!
//! **Die Schranke steht in [`crate::auth::session::CurrentUser`]:** jede authentifizierte Route
//! zieht ihn. Für eine Gerätesitzung prüft er `(Methode, MatchedPath)` gegen
//! [`darf_route`]; was nicht gelistet ist, ist 403. Eine neue Route ist damit für Geräte
//! gesperrt, ohne dass jemand an sie denkt. Herleitung:
//! `openspec/changes/lfh-892-funktionsansichten-geraete/design.md` (D4, D5).

pub mod code;
pub mod repo;

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
    /// `migrations/0147_geraet_kopplung.sql`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum Funktionsansicht {
        UhsTablet => "uhs-tablet",
        UhsLaptop => "uhs-laptop",
        Lagemonitor => "lagemonitor",
    }
    try_from = |s| format!("Ungültige Funktionsansicht: {s}");
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
        }
    }

    /// Ob die Ansicht an genau eine UHS gebunden ist.
    pub fn ist_stellengebunden(self) -> bool {
        matches!(
            self,
            Funktionsansicht::UhsTablet | Funktionsansicht::UhsLaptop
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
        }
    }
}

/// Zusätzliche Einsatzrouten des UHS-Tablets. Leer, bis die Stellenbindung der UHS- und
/// Personenrouten steht (Subtask UHS-Tablet); vorher sähe ein Tablet jede UHS des Einsatzes.
const UHS_TABLET: &[(&str, &str)] = &[];
/// Zusätzliche Einsatzrouten des UHS-Laptops (Subtask UHS-Laptop).
const UHS_LAPTOP: &[(&str, &str)] = &[];
/// Zusätzliche Einsatzrouten des Lagemonitors (Subtask Lagemonitor).
const LAGEMONITOR: &[(&str, &str)] = &[];

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
    /// UHS der stellengebundenen Ansichten.
    pub uhs_id: Option<i64>,
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
    pub uhs_id: Option<i64>,
    /// Bezeichnung der UHS, falls stellengebunden.
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
    fn rollen_der_ansichten() {
        assert_eq!(
            Funktionsansicht::Lagemonitor.rolle(),
            EinsatzRolle::Beobachter
        );
        assert!(Funktionsansicht::UhsTablet.rolle().darf_schreiben());
        assert!(Funktionsansicht::UhsLaptop.ist_stellengebunden());
        assert!(!Funktionsansicht::Lagemonitor.ist_stellengebunden());
    }
}
