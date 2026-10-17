//! Verpflegungsstelle (LLH-1040, design.md D1, D2, D4): wo ausgegeben wird — die Feldküche am
//! Bereitstellungsraum, die Ausgabe in der Notunterkunft, die Zuführung an den Deich.
//!
//! **Status wie beim Bereitstellungsraum** (`entscheidungen.md` Punkt 1): `geplant → aktiv →
//! aufgeloest`, `geplant → aufgeloest` direkt, `aufgeloest` endgültig ([`darf_uebergehen`]).
//! Storniert wird weich und nur eine geplante Stelle ohne Ausgabe (Repo).
//!
//! **Kein Soll je Stelle** (`entscheidungen.md` Punkt 2): der Bedarf bleibt am Zeitfenster, je
//! Stelle gibt es nur das Ist ([`super::deckung::rechne`]). Eine Stelle führt keinen Bestand und
//! kein Material; sie ist kein Versorgungsposten (Spec `stab-versorgung`).
//!
//! Die Persistenz steht in [`super::repo`] (Abschnitt „Stellen“).

use serde::Serialize;
use utoipa::ToSchema;

use crate::wire_enum::wire_enum;

wire_enum! {
    /// Art einer Verpflegungsstelle. String = CHECK in `migrations/0206_verpflegungsstelle.sql`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VerpflegungsstelleArt {
        Feldkueche => "feldkueche",
        Ausgabestelle => "ausgabestelle",
        Zufuehrung => "zufuehrung",
    }
    try_from = |s| format!("Ungültige VerpflegungsstelleArt: {s}");
}

impl VerpflegungsstelleArt {
    /// Das Wort für den ETB-Text („Feldküche“).
    pub const fn wort(self) -> &'static str {
        match self {
            VerpflegungsstelleArt::Feldkueche => "Feldküche",
            VerpflegungsstelleArt::Ausgabestelle => "Ausgabestelle",
            VerpflegungsstelleArt::Zufuehrung => "Zuführung",
        }
    }
}

wire_enum! {
    /// Status einer Verpflegungsstelle. String = CHECK in
    /// `migrations/0206_verpflegungsstelle.sql`. `aufgeloest` ist endgültig.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VerpflegungsstelleStatus {
        Geplant => "geplant",
        Aktiv => "aktiv",
        Aufgeloest => "aufgeloest",
    }
    try_from = |s| format!("Ungültiger VerpflegungsstelleStatus: {s}");
}

/// Ob ein Statusübergang `von → nach` erlaubt ist (wie `bereitstellungsraum::darf_uebergehen`):
/// `geplant → aktiv`, `geplant → aufgeloest` (war nie in Betrieb), `aktiv → aufgeloest`. Alles
/// andere — auch ein Übergang auf denselben Status — ist ein unzulässiger Übergang (422).
pub fn darf_uebergehen(von: VerpflegungsstelleStatus, nach: VerpflegungsstelleStatus) -> bool {
    use VerpflegungsstelleStatus::*;
    match von {
        Geplant => matches!(nach, Aktiv | Aufgeloest),
        Aktiv => matches!(nach, Aufgeloest),
        Aufgeloest => false,
    }
}

/// Eine Verpflegungsstelle in `GET …/verpflegung` und als Antwort der Schreibrouten. **Ohne
/// Benutzerkennungen** (Spec `funktionsansichten`: das Verpflegungsgerät erhält keine Namen und
/// keine Kennungen von Benutzern). Stornierte Stellen kommen nicht vor.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct VerpflegungsstelleAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    pub art: VerpflegungsstelleArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    pub status: VerpflegungsstelleStatus,
    /// Zeitpunkt der Auflösung (UTC ohne Zonenkennung), nur bei `aufgeloest`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aufgeloest_at: Option<String>,
    pub angelegt_at: String,
    /// Ob ein Gerät an der Stelle gekoppelt ist (LLH-1048 Teil II): eine laufende Kopplung, auch
    /// eine noch nicht eingelöste. Dann ist das Storno 409; die Oberfläche sperrt es mit Grund.
    /// Nur dieses Ja oder Nein, keine Kopplung, keine Gerätebezeichnung.
    pub geraet_gekoppelt: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use VerpflegungsstelleStatus::*;

    #[test]
    fn woerter_rundreise_und_unbekanntes_wort() {
        for s in ["feldkueche", "ausgabestelle", "zufuehrung"] {
            assert_eq!(VerpflegungsstelleArt::parse(s).unwrap().as_str(), s);
        }
        for s in ["geplant", "aktiv", "aufgeloest"] {
            assert_eq!(VerpflegungsstelleStatus::parse(s).unwrap().as_str(), s);
        }
        assert_eq!(VerpflegungsstelleArt::parse("kantine"), None);
        assert_eq!(VerpflegungsstelleArt::parse("Feldkueche"), None);
        assert_eq!(VerpflegungsstelleStatus::parse("in_betrieb"), None);
        assert_eq!(VerpflegungsstelleStatus::parse(""), None);
        assert_eq!(VerpflegungsstelleArt::Zufuehrung.wort(), "Zuführung");
    }

    /// Die Tabelle aus design.md D2, erlaubt und verboten, vollständig über alle Paare.
    #[test]
    fn alle_uebergaenge_der_tabelle() {
        let erlaubt = [(Geplant, Aktiv), (Geplant, Aufgeloest), (Aktiv, Aufgeloest)];
        for von in VerpflegungsstelleStatus::ALLE {
            for nach in VerpflegungsstelleStatus::ALLE {
                assert_eq!(
                    darf_uebergehen(von, nach),
                    erlaubt.contains(&(von, nach)),
                    "{} → {}",
                    von.as_str(),
                    nach.as_str()
                );
            }
        }
    }
}
