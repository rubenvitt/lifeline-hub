//! Stammdaten-Verteilung (LLH-1493, Change `ca8v0psv-stammdaten-verteilung`, Spec
//! `stammdaten-verteilung`): die erreichte Seite einer Kopplung liefert der meldenden die
//! Stammdaten einer Org „seit Stand X“ mit jeder Meldung; dort sind sie nur lesbar.
//!
//! - [`art`]: was je Art geliefert wird und wie sie heißt (D1, D2, D5).
//! - [`liefern`]: Nachlieferung an der erreichten Seite (D2, D6).
//! - [`uebernehmen`]: Übernahme an der meldenden Seite (D3, D4, D5, D6).
//! - [`geheimnis`]: Passwort-Hash und TOTP, Ende-zu-Ende verschlüsselt (D6).
//!
//! Änderungslog und Schreibschutz sitzen in Triggern (`migrations/0306_stammdaten_verteilung.sql`),
//! damit kein Schreibweg sie umgeht.

pub mod art;
pub mod geheimnis;
pub mod herkunft;
pub mod liefern;
pub mod uebernehmen;

use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Nachricht, mit der die Schutz-Trigger abbrechen; `AppError` macht daraus 409.
pub const SCHUTZ_NACHRICHT: &str = "stammdaten_vom_hub";

/// Höchstzahl Zeilen je Antwort über alle Orgs (D2), ohne die mitgelieferten Abhängigkeiten.
pub const STAMMDATEN_MAX: usize = 200;
/// Platz, den eine Antwort auf eine Meldung neben den Stammdaten braucht: Hülle, Org-Einträge
/// und eine einzelne übergroße Zeile (siehe [`liefern::Budget`]). Die Stammdaten bekommen, was
/// `melden::ANTWORT_MAX` abzüglich dieser Reserve und der Unterschriftsschlüssel übrig lässt (D2;
/// Test `melden::tests::groesste_antwort_passt_in_die_lesegrenze`).
pub const ANTWORT_RESERVE: usize = 128 * 1024;
/// Höchstzahl mitgelieferter Abhängigkeiten je Antwort (D2).
pub const ABHAENGIGE_MAX: usize = 200;
/// Höchstzahl Einträge je Unterliste einer Zeile.
pub const UNTERLISTE_MAX: usize = 200;
/// Höchstzahl Arten, die eine Meldung nennen darf (`src/AGENTS.md`, Listen von außen).
pub const ARTEN_MAX: usize = 64;

wire_enum! {
    /// Eine verteilte Stammdatenart (design.md D1). Auf der Leitung steht der Wert als Text, damit
    /// eine ältere Instanz eine neue Art überspringen kann (D2).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
    pub enum StammdatenArt {
        Konto => "konto",
        OrgEinstellungen => "org_einstellungen",
        ModulEinstellung => "modul_einstellung",
        Fuehrungsfunktion => "fuehrungsfunktion",
        FahrzeugStatus => "fahrzeug_status",
        PersonalStatus => "personal_status",
        Qualifikation => "qualifikation",
        EinheitTyp => "einheit_typ",
        Fahrzeug => "fahrzeug",
        Material => "material",
        Personal => "personal",
        EinheitVorlage => "einheit_vorlage",
        Schichtmodell => "schichtmodell",
        EinsatzVorlage => "einsatz_vorlage",
        StichwortVorschlag => "stichwort_vorschlag",
        VerpflegungVorlage => "verpflegung_vorlage",
        Sprechgruppe => "sprechgruppe",
        EtbBaustein => "etb_baustein",
        ExterneStelle => "externe_stelle",
        UnterkunftRichtwert => "unterkunft_richtwert",
    }
}

/// Eine gelieferte Zeile (design.md D2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StammdatenLieferung {
    /// Wire-Wert von [`StammdatenArt`].
    pub art: String,
    /// id an der Quelle als Text, bei Führungs-, Modul-Einstellungen und Unterkunft-Richtwerten der
    /// Schlüssel, bei den Org-Einstellungen leer.
    pub schluessel: String,
    pub stand: i64,
    #[serde(default)]
    pub geloescht: bool,
    /// Spalten laut [`art::ArtBeschreibung::spalten`], Unterlisten unter `unterlisten`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daten: Option<serde_json::Value>,
    /// Nur Konten: Passwort-Hash und TOTP, mit age an den Empfänger verschlüsselt (D6).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geheimnis: Option<String>,
}

static LIVE: std::sync::OnceLock<crate::live::LiveHub> = std::sync::OnceLock::new();

/// Setzt beim Start den Live-Verteiler, über den eine übernommene Nachlieferung das Ereignis
/// `stammdaten` auslöst (Spec `org-live`) und Sitzungen deaktivierter Konten beendet. Der
/// Melde-Task läuft ohne `AppState`.
pub fn set_live(live: crate::live::LiveHub) {
    let _ = LIVE.set(live);
}

pub(crate) fn live() -> Option<&'static crate::live::LiveHub> {
    LIVE.get()
}

/// Die Arten, die diese Instanz übernehmen kann, wie sie in einer Meldung stehen.
pub fn eigene_arten() -> Vec<String> {
    StammdatenArt::ALLE
        .iter()
        .map(|a| a.as_str().to_string())
        .collect()
}

/// Kennzeichen dessen, was die meldende Seite empfangen kann: Arten und ob Geheimnisse kommen
/// dürfen. Ändert es sich (Update, Plattenbestätigung), beginnt die Nachlieferung bei 0 (D2).
pub fn empfangs_kennzeichen(geheimnisse: bool) -> String {
    format!(
        "{};geheimnisse={}",
        eigene_arten().join(","),
        if geheimnisse { 1 } else { 0 }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kennzeichen_aendert_sich_mit_der_plattenbestaetigung() {
        assert_ne!(empfangs_kennzeichen(true), empfangs_kennzeichen(false));
        assert!(empfangs_kennzeichen(false).starts_with("konto,org_einstellungen,"));
    }

    #[test]
    fn lieferung_ohne_neue_felder_ist_lesbar() {
        let l: StammdatenLieferung =
            serde_json::from_str(r#"{"art":"fahrzeug","schluessel":"3","stand":7}"#).unwrap();
        assert!(!l.geloescht);
        assert!(l.daten.is_none() && l.geheimnis.is_none());
    }
}
