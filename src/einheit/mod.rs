pub mod mitglied_repo;
pub mod repo;
pub mod typ_repo;

use crate::katalog::StatusKategorie;
use crate::sprechgruppe::SprechgruppeAnzeige;
use crate::staerke::Staerke;
use serde::Serialize;
use utoipa::ToSchema;

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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitTyp {
    pub id: i64,
    pub label: String,
    /// Standard-Soll-Stärke; `None`, wenn der Typ keine Soll-Stärke definiert.
    pub soll: Option<Staerke>,
    pub sortier: i64,
}

/// Personal-Mitglied einer Einheit (leichtgewichtig für die Einheiten-Anzeige).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitMitgliedPerson {
    /// `einsatz_personal.id` der Dispozeile.
    pub ep_id: i64,
    pub name: String,
    pub funktion: Option<String>,
    #[schema(value_type = Option<crate::staerke::StaerkePosition>)]
    pub staerke_position: Option<String>,
    /// `true`, wenn diese Person als Führer der Einheit eingetragen ist.
    pub ist_fuehrer: bool,
}

/// Fahrzeug-Mitglied einer Einheit (leichtgewichtig).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitMitgliedFahrzeug {
    /// `einsatz_fahrzeug.id` der Dispozeile.
    pub ef_id: i64,
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    /// Aktueller FMS-Status des Fahrzeugs (LFH-609); `None` = ohne Status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<StatusWert>,
    /// Zeitpunkt des letzten Statuswechsels (UTC); `None` = unbekannt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_seit: Option<String>,
}

/// Ein aufgelöster Eintrag des FMS-Statuskatalogs (`fahrzeug_status`), wie ihn Fahrzeug
/// und Einheit tragen (LFH-609).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct StatusWert {
    pub status_id: i64,
    pub label: String,
    pub kategorie: StatusKategorie,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub farbe: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fms_anker: Option<i64>,
    /// Katalog-Sortierung — ordnet die Verteilung einer gemischten Einheit.
    pub sortier: i64,
}

/// Woher der Status einer Einheit kommt (LFH-609). Wire == `as_str()`.
///
/// Mit Fahrzeugen ist der Status ABGELEITET: tragen alle denselben, gilt er
/// (`Fahrzeuge`), sonst ist die Einheit `Gemischt`. Ohne Fahrzeug gilt der von Hand
/// gesetzte Status (`Hand`) als Rückfall. `Ohne` heißt: es gibt keinen — weder Hand
/// noch einen Fahrzeugstatus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EinheitStatusQuelle {
    Fahrzeuge,
    Gemischt,
    Hand,
    Ohne,
}

impl EinheitStatusQuelle {
    pub fn as_str(&self) -> &'static str {
        match self {
            EinheitStatusQuelle::Fahrzeuge => "fahrzeuge",
            EinheitStatusQuelle::Gemischt => "gemischt",
            EinheitStatusQuelle::Hand => "hand",
            EinheitStatusQuelle::Ohne => "ohne",
        }
    }
}

/// Anteil eines Status an einer gemischten Einheit; `status: None` = Fahrzeuge ohne Status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct StatusAnteil {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<StatusWert>,
    pub anzahl: u32,
}

/// Status einer Einheit mit „Seit“ (LFH-609). Die Regel steht an
/// [`repo::leite_status_ab`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitStatus {
    pub quelle: EinheitStatusQuelle,
    /// Der eine Status — gesetzt bei `Fahrzeuge` und `Hand`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<StatusWert>,
    /// Die gemeinsame Kategorie — auch bei `Gemischt`, wenn alle Fahrzeuge einen Status
    /// derselben Kategorie tragen (S3 + S4 sind beide „gebunden“).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kategorie: Option<StatusKategorie>,
    /// Seit wann (UTC). `Fahrzeuge`: der jüngste Wechsel, also seit wann ALLE Fahrzeuge in
    /// diesem Status stehen — `None`, sobald ein Fahrzeug keinen Zeitpunkt kennt. `Hand`:
    /// der Zeitpunkt des Setzens. Bei `Gemischt`/`Ohne` immer `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seit: Option<String>,
    /// Nur bei `Gemischt`: Fahrzeuge je Status, in Katalogreihenfolge, „ohne“ zuletzt.
    pub verteilung: Vec<StatusAnteil>,
}

/// Material-Mitglied einer Einheit (leichtgewichtig).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinheitMitgliedMaterial {
    /// `einsatz_material.id` der Dispozeile.
    pub em_id: i64,
    pub bezeichnung: String,
    pub menge: i64,
    /// Festes Status-Enum als String (z. B. "einsatzbereit").
    pub status: crate::material::MaterialStatus,
}

/// Aufgelöste Einheiten-Anzeige inkl. Typ/Abschnitt-Labels, Führer-Identität,
/// Mitgliedern und berechneter Stärke. `soll` ist optional (Override → Typ-Default →
/// `None`); `ist`/`ist_kumuliert` sind immer gesetzt.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct EinheitAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub abschnitt_id: Option<i64>,
    pub abschnitt_name: Option<String>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub typ_label: Option<String>,
    pub name: String,
    pub fuehrer_id: Option<i64>,
    pub fuehrer_name: Option<String>,
    pub bemerkung: Option<String>,
    /// Eigener Funkrufname der Einheit (LFH-614), fixierte menschenlesbare Kennung im
    /// Meldebild. `None` = nicht gepflegt; das Frontend leitet dann höchstens aus genau
    /// einem Fahrzeugmitglied ab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funkrufname: Option<String>,
    /// Funk/Kommunikation (LFH-108): Freitext-Schlüssel (digitalfunk/mobil/festnetz).
    pub kommunikationsmittel: Option<String>,
    /// Funk/Kommunikation (LFH-108): Rufnummer/Freitext (PII → schwaerze_einsatz).
    pub erreichbarkeit: Option<String>,
    pub sortier: i64,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    /// BR‑1: aktuell bereitgestellter Bereitstellungsraum (NULL = in keinem BR).
    pub aktueller_br_id: Option<i64>,
    pub soll: Option<crate::staerke::Staerke>,
    pub ist: crate::staerke::Staerke,
    pub ist_kumuliert: crate::staerke::Staerke,
    pub personal_mitglieder: Vec<EinheitMitgliedPerson>,
    pub fahrzeug_mitglieder: Vec<EinheitMitgliedFahrzeug>,
    pub material_mitglieder: Vec<EinheitMitgliedMaterial>,
    pub sprechgruppen: Vec<SprechgruppeAnzeige>,
    /// Status der Einheit mit „Seit“ (LFH-609) — abgeleitet oder Handstatus.
    pub status: EinheitStatus,
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

// ── System-ETB-Wortlaute (LFH-690) ──────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein
// importierter Einsatz dieselben ETB-Texte trägt wie ein echter.

/// System-ETB beim Bilden einer Einheit.
pub fn etb_text_gebildet(name: &str) -> String {
    format!("Einheit «{}» gebildet", name)
}

/// System-ETB, wenn ein disponiertes Fahrzeug einer Einheit zugeordnet wird.
pub fn etb_text_fahrzeug_zugeordnet(einheit: &str, funkrufname: &str) -> String {
    format!(
        "Einheit «{}»: Fahrzeug «{}» zugeordnet",
        einheit, funkrufname
    )
}

/// System-ETB, wenn eine disponierte Kraft einer Einheit zugeordnet wird. `person` ist der
/// Snapshot-Name der Disposition (Rückgabe von `mitglied_repo::ordne_personal_zu_tx`).
pub fn etb_text_personal_zugeordnet(einheit: &str, person: &str) -> String {
    format!("Einheit «{}»: «{}» zugeordnet", einheit, person)
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn gebildet_und_fahrzeug_zugeordnet() {
        assert_eq!(etb_text_gebildet("1. Zug"), "Einheit «1. Zug» gebildet");
        assert_eq!(
            etb_text_fahrzeug_zugeordnet("1. Zug", "Florian 1/46-1"),
            "Einheit «1. Zug»: Fahrzeug «Florian 1/46-1» zugeordnet"
        );
    }

    #[test]
    fn personal_zugeordnet() {
        assert_eq!(
            etb_text_personal_zugeordnet("1. Zug", "Erika Muster"),
            "Einheit «1. Zug»: «Erika Muster» zugeordnet"
        );
    }
}
