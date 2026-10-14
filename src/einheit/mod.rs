//! Einheiten im Einsatz: bilden, zuordnen, Status und Stärke; Auflösen nach Spec
//! `openspec/specs/kraefte-entlassung`. Bilden aus einer Einheiten-Vorlage samt Untereinheiten,
//! Fahrzeugen und Stammbesetzung in einem Schritt: [`aus_vorlage`] (LLH-1049, Spec
//! `openspec/specs/kraefte-disposition`, „Einheit aus Vorlage bilden“, und
//! `openspec/specs/einheit-vorlagen`, „Vorschau im Einsatz“).

pub mod aus_vorlage;
pub mod mitglied_repo;
pub mod repo;
pub mod typ_repo;

use crate::katalog::StatusKategorie;
use crate::sprechgruppe::SprechgruppeAnzeige;
use crate::staerke::Staerke;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Höchstlänge des Einheitsnamens nach dem Trimmen (`src/AGENTS.md`, „Eingabegrenzen“), wie
/// `einheit_vorlage::NAME_MAX`. Gilt beim Bilden aus einer Vorlage (LLH-1049); die Routen
/// `POST/PATCH …/einheiten` bekommen die Grenze in einer eigenen Aufgabe. Spiegel:
/// `EINHEIT_NAME_MAX` in `frontend/src/api/eingabegrenzen.ts`.
pub const NAME_MAX: usize = 200;

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
    /// Qualifikation (Snapshot), wie `EinsatzPersonalAnzeige::funktion`.
    pub funktion: Option<String>,
    /// Einsatzfunktion (LLH-1067); angezeigt vor der Qualifikation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzfunktion: Option<String>,
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

wire_enum! {
    /// Woher der Status einer Einheit kommt (LFH-609). Wire == `as_str()`.
    ///
    /// Mit Fahrzeugen ist der Status ABGELEITET: tragen alle denselben, gilt er
    /// (`Fahrzeuge`), sonst ist die Einheit `Gemischt`. Ohne Fahrzeug gilt der von Hand
    /// gesetzte Status (`Hand`) als Rückfall. `Ohne` heißt: es gibt keinen — weder Hand
    /// noch einen Fahrzeugstatus.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum EinheitStatusQuelle {
        Fahrzeuge => "fahrzeuge",
        Gemischt => "gemischt",
        Hand => "hand",
        Ohne => "ohne",
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
    /// Auflösung (LLH-1079, Spec `kraefte-entlassung`); fehlt bei aktiven Einheiten. Nur
    /// `GET …/einheiten?aufgeloeste=1` liefert aufgelöste.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aufgeloest_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aufgeloest_von: Option<i64>,
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

/// System-ETB beim Auflösen einer Einheit (LLH-1079).
pub fn etb_text_aufgeloest(name: &str) -> String {
    format!("Einheit «{}» aufgelöst", name)
}

/// System-ETB beim Stornieren einer fehlerhaft angelegten Einheit (LLH-1079, design.md D3).
pub fn etb_text_storniert(name: &str) -> String {
    format!("Einheit «{}» storniert (Fehlanlage)", name)
}

/// Der eine System-ETB beim Bilden aus einer Vorlage (LLH-1049, design.md D11): „Einheit «1. Zug»
/// aus Vorlage «Sanitätszug Musterstadt» gebildet; Untereinheiten: «Rettungsstaffel»;
/// 3 Fahrzeuge: ELW 1, RTW 1, RTW 2; 2 Kräfte: Name A, Name B; umgehängt: RTW 2 aus «2. Zug»“.
/// Leere Teile entfallen. Systemtext: keine Grenze am Eingang (`src/AGENTS.md`, „Eingabegrenzen“).
pub fn etb_text_aus_vorlage(
    einheit: &str,
    vorlage: &str,
    untereinheiten: &[String],
    fahrzeuge: &[String],
    kraefte: &[String],
    umgehaengt: &[String],
) -> String {
    let mut teile = vec![format!(
        "Einheit «{einheit}» aus Vorlage «{vorlage}» gebildet"
    )];
    if !untereinheiten.is_empty() {
        let wort = if untereinheiten.len() == 1 {
            "Untereinheit"
        } else {
            "Untereinheiten"
        };
        let namen: Vec<String> = untereinheiten.iter().map(|n| format!("«{n}»")).collect();
        teile.push(format!("{wort}: {}", namen.join(", ")));
    }
    if !fahrzeuge.is_empty() {
        let wort = if fahrzeuge.len() == 1 {
            "Fahrzeug"
        } else {
            "Fahrzeuge"
        };
        teile.push(format!(
            "{} {wort}: {}",
            fahrzeuge.len(),
            fahrzeuge.join(", ")
        ));
    }
    if !kraefte.is_empty() {
        let wort = if kraefte.len() == 1 {
            "Kraft"
        } else {
            "Kräfte"
        };
        teile.push(format!("{} {wort}: {}", kraefte.len(), kraefte.join(", ")));
    }
    if !umgehaengt.is_empty() {
        teile.push(format!("umgehängt: {}", umgehaengt.join(", ")));
    }
    teile.join("; ")
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

    #[test]
    fn aus_vorlage_nennt_alle_teile_und_laesst_leere_weg() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(
            etb_text_aus_vorlage(
                "1. Zug",
                "Sanitätszug Musterstadt",
                &s(&["Rettungsstaffel", "Trupp"]),
                &s(&["ELW 1", "RTW 1", "RTW 2"]),
                &s(&["Name A", "Name B"]),
                &s(&["RTW 2 aus «2. Zug»", "Name B von «83-4»"]),
            ),
            "Einheit «1. Zug» aus Vorlage «Sanitätszug Musterstadt» gebildet; Untereinheiten: \
             «Rettungsstaffel», «Trupp»; 3 Fahrzeuge: ELW 1, RTW 1, RTW 2; 2 Kräfte: Name A, \
             Name B; umgehängt: RTW 2 aus «2. Zug», Name B von «83-4»"
        );
        assert_eq!(
            etb_text_aus_vorlage("Staffel", "Staffel", &[], &[], &[], &[]),
            "Einheit «Staffel» aus Vorlage «Staffel» gebildet"
        );
        assert_eq!(
            etb_text_aus_vorlage("A", "V", &[], &s(&["ELW"]), &s(&["Anna"]), &[]),
            "Einheit «A» aus Vorlage «V» gebildet; 1 Fahrzeug: ELW; 1 Kraft: Anna"
        );
    }

    /// Höchstfall (design.md D11): 20 Einheiten mit Namen à `NAME_MAX`, 50 Fahrzeuge
    /// (Funkrufname à 40), 50 Personen (Name à 80), zehn davon aus Einheiten mit Namen à
    /// `NAME_MAX` umgehängt — der Systemtext bleibt unter `etb::INHALT_MAX`.
    #[test]
    fn aus_vorlage_hoechstfall_bleibt_unter_der_etb_grenze() {
        let lang = |c: char, n: usize| std::iter::repeat_n(c, n).collect::<String>();
        let einheit = lang('E', NAME_MAX);
        let unter: Vec<String> = (0..19).map(|_| lang('U', NAME_MAX)).collect();
        let fahrzeuge: Vec<String> = (0..50).map(|_| lang('F', 40)).collect();
        let kraefte: Vec<String> = (0..50).map(|_| lang('P', 80)).collect();
        let umgehaengt: Vec<String> = (0..10)
            .map(|_| format!("{} aus «{}»", lang('P', 80), lang('A', NAME_MAX)))
            .collect();
        let text = etb_text_aus_vorlage(
            &einheit,
            &lang('V', crate::einheit_vorlage::NAME_MAX),
            &unter,
            &fahrzeuge,
            &kraefte,
            &umgehaengt,
        );
        let zeichen = text.chars().count();
        assert!(zeichen > 12_000, "{zeichen}");
        assert!(zeichen < crate::etb::INHALT_MAX, "{zeichen}");
    }

    #[test]
    fn aufgeloest_und_storniert() {
        assert_eq!(etb_text_aufgeloest("1. Zug"), "Einheit «1. Zug» aufgelöst");
        assert_eq!(
            etb_text_storniert("1. Zug"),
            "Einheit «1. Zug» storniert (Fehlanlage)"
        );
    }
}
