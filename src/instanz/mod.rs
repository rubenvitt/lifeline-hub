//! Instanzkopplung (LLH-1490): zwei Lifeline-Hub-Instanzen, etwa ein ELW und ein öffentlicher Hub,
//! erkennen einander über je ein Ed25519-Schlüsselpaar, koppeln sich per Einmal-Code eines
//! Org-Admins und sprechen nur über signierte Nachrichten. Herleitung:
//! `openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md`
//! (D1–D12), Konzept
//! `docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md`.
//!
//! Das Protokoll unterscheidet nicht zwischen Hub und ELW (Entscheidung 13): eine Kopplung kennt
//! nur ihre Richtung, also welche Seite sich meldet ([`InstanzKopplungRichtung`]).

pub mod basis32;
pub mod code;
pub mod entdeckung;
pub mod extractor;
pub mod fuehrung;
pub mod identitaet;
pub mod melden;
pub mod repo;
pub mod signatur;
pub mod spiegel;
pub mod stammdaten;
pub mod zertifikat;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Protokollversion dieser Instanz (design.md D5). Wer sie erhöht, hält die vorige im Code, bis
/// die übernächste kommt; das Schema von Melden bleibt über alle Versionen nur additiv. 3 seit
/// LLH-1497 ([`PROTOKOLL_VOR_ORT`]), 4 seit LLH-1678 ([`PROTOKOLL_FUEHRUNG_VOR_ORT`]); Version 3
/// bleibt voll verständlich, die neuen Felder sind optional.
pub const PROTOKOLL: u32 = 4;

/// Ab dieser Protokollversion kennt eine Instanz den Abgleich der Einsätze (LLH-1492, design.md
/// D6); mit einem älteren Gegenüber wird nicht gespiegelt.
pub const PROTOKOLL_SPIEGEL: u32 = 2;

/// Was zwei Instanzen mit den Protokollversionen `eigen` und `fremd` miteinander tun dürfen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protokollfenster {
    /// Abstand höchstens eins: alles.
    Voll,
    /// Abstand größer: nur Melden und Status; `veraltet` ist die ältere Seite.
    NurMelden { veraltet: Seite },
}

/// Welche Seite einer Kopplung gemeint ist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Seite {
    Eigen,
    Gegenueber,
}

/// Protokollfenster N/N−1 (design.md D5).
pub fn protokollfenster(eigen: u32, fremd: u32) -> Protokollfenster {
    if eigen.abs_diff(fremd) <= 1 {
        Protokollfenster::Voll
    } else if eigen < fremd {
        Protokollfenster::NurMelden {
            veraltet: Seite::Eigen,
        }
    } else {
        Protokollfenster::NurMelden {
            veraltet: Seite::Gegenueber,
        }
    }
}

wire_enum! {
    /// Richtung einer Kopplung aus Sicht dieser Instanz (design.md D6). Die einlösende Seite meldet
    /// sich, die ausstellende wird gemeldet und baut nie selbst eine Verbindung auf.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InstanzKopplungRichtung {
        /// Diese Instanz meldet sich beim Gegenüber (sie hat dessen Code eingelöst).
        MeldetSich => "meldet_sich",
        /// Das Gegenüber meldet sich hier (es hat einen Code dieser Instanz eingelöst).
        WirdGemeldet => "wird_gemeldet",
    }
}

wire_enum! {
    /// Zustand einer Kopplung (design.md D6, D9).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InstanzKopplungZustand {
        /// Code eingelöst, die erste Meldung des Gegenübers steht noch aus (nur ausstellende Seite).
        Angebahnt => "angebahnt",
        Aktiv => "aktiv",
        /// Hier widerrufen: keine Org-Zuordnung mehr gültig.
        Widerrufen => "widerrufen",
        /// Das Gegenüber hat widerrufen und es signiert mitgeteilt.
        VomGegenueberWiderrufen => "vom_gegenueber_widerrufen",
    }
}

wire_enum! {
    /// Art einer Kopplung (LLH-1497, design.md D1). Sie beschreibt die Kopplung, nicht die
    /// Instanz: dieselbe Instanz kann beim Hub `standard` und bei einem zweiten ELW `vor_ort`
    /// gekoppelt sein. Was über eine Art fließt, sagt allein [`InstanzKopplungArt::traegt`].
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InstanzKopplungArt {
        /// Alles, was die Richtung trägt: Stammdaten, Geheimnisse, Verwahrung, Führungswechsel.
        Standard => "standard",
        /// Direktkopplung vor Ort: nur Akten zur Anzeige, Spiegel und Anträge.
        VorOrt => "vor_ort",
    }
}

/// Ein Fluss, den eine Kopplung je nach Art trägt oder nicht (design.md D2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fluss {
    /// Stammdaten der Org von der erreichten zur meldenden Seite; Quelle einer Org.
    Stammdaten,
    /// Geheimnisse von Konten; macht eine Org „verteilend“ (Passkey-Pflicht, „ELW verloren“).
    Geheimnisse,
    /// Übergabe eines abgeschlossenen Einsatzes zur Verwahrung.
    Verwahrung,
    /// Führungswechsel nach der Richtung (Hub-artig): die erreichte Seite nimmt ohne Beweis an und
    /// erfüllt Anfragen selbst, der Widerruf holt die Führung zurück. Über eine Direktkopplung
    /// wechselt die Führung stattdessen gleichrangig ([`Wechselregel`], LLH-1678).
    Fuehrungswechsel,
}

impl InstanzKopplungArt {
    /// Ob eine Kopplung dieser Art den Fluss trägt (design.md D2): `standard` alles, `vor_ort`
    /// nichts davon. Jede Stelle, die einen Fluss auslöst oder annimmt, fragt hier.
    pub fn traegt(self, fluss: Fluss) -> bool {
        match self {
            Self::Standard => true,
            Self::VorOrt => match fluss {
                Fluss::Stammdaten
                | Fluss::Geheimnisse
                | Fluss::Verwahrung
                | Fluss::Fuehrungswechsel => false,
            },
        }
    }
}

/// Ab dieser Protokollversion kennt eine Instanz die Direktkopplung vor Ort, das beglaubigte
/// Zertifikat und die Ursprungskennung (LLH-1497, design.md D7).
pub const PROTOKOLL_VOR_ORT: u32 = 3;

/// Ab dieser Protokollversion wechselt die Führung über eine Direktkopplung gleichrangig
/// (LLH-1678, Change `gwcf2shk-fuehrungswechsel-vor-ort`, design.md D1, D7).
pub const PROTOKOLL_FUEHRUNG_VOR_ORT: u32 = 4;

wire_enum! {
    /// Nach welcher Regel die Führung zwischen dieser Instanz und einem Gegenüber wechselt
    /// (LLH-1678, design.md D1). Jede Stelle, die einen Führungswechsel auslöst oder annimmt,
    /// fragt sie über [`wechselregel`] ab.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Wechselregel {
        /// Standardkopplung: die Richtung entscheidet (die erreichte Seite nimmt an, die meldende
        /// prüft den Beweis und hält offen).
        NachRichtung => "nach_richtung",
        /// Direktkopplung, beide Seiten mit Protokoll 4: jede Seite verhält sich gegenüber der
        /// anderen wie eine meldende Seite.
        Gleichrangig => "gleichrangig",
        /// Direktkopplung mit einer älteren Gegenstelle: kein Wechsel zwischen den beiden Seiten.
        Gesperrt => "gesperrt",
    }
}

/// Die Regel des Führungswechsels zu einem Gegenüber aus Art der Kopplung und der
/// Protokollversion, die es zuletzt genannt hat (design.md D1).
pub fn wechselregel(art: InstanzKopplungArt, gegenueber_protokoll: Option<i64>) -> Wechselregel {
    match art {
        InstanzKopplungArt::Standard => Wechselregel::NachRichtung,
        InstanzKopplungArt::VorOrt
            if gegenueber_protokoll.is_some_and(|p| p >= i64::from(PROTOKOLL_FUEHRUNG_VOR_ORT)) =>
        {
            Wechselregel::Gleichrangig
        }
        InstanzKopplungArt::VorOrt => Wechselregel::Gesperrt,
    }
}

/// Grund, warum zu einer Gegenstelle vor Ort keine Führung wechselt (Regel `gesperrt`).
pub fn update_hinweis(name: &str) -> String {
    format!("{name} braucht ein Update für den Führungswechsel vor Ort.")
}

static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Setzt den Namen dieser Instanz einmal beim Start (`Config::instanz_anzeigename`).
pub fn set_name(name: String) {
    let _ = NAME.set(name);
}

/// Name dieser Instanz, wie gekoppelte Instanzen ihn anzeigen; ungesetzt (Tests) „Lifeline Hub“.
pub fn name() -> &'static str {
    NAME.get().map(String::as_str).unwrap_or("Lifeline Hub")
}

/// Softwarestand, den diese Instanz beim Koppeln und Melden nennt.
pub fn softwarestand() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Kennung einer Org über Instanzgrenzen (design.md D6): `organisation.id` ist nur lokal
/// eindeutig, darum mit der Instanzkennung davor.
pub fn org_kennung(instanz_kennung: &str, org_id: i64) -> String {
    format!("{instanz_kennung}/{org_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gleicher_stand_und_ein_stand_abstand_sind_voll() {
        assert_eq!(protokollfenster(3, 3), Protokollfenster::Voll);
        assert_eq!(protokollfenster(3, 2), Protokollfenster::Voll);
        assert_eq!(protokollfenster(2, 3), Protokollfenster::Voll);
    }

    #[test]
    fn zwei_staende_abstand_ist_nur_melden_mit_der_veralteten_seite() {
        assert_eq!(
            protokollfenster(3, 1),
            Protokollfenster::NurMelden {
                veraltet: Seite::Gegenueber
            }
        );
        assert_eq!(
            protokollfenster(1, 3),
            Protokollfenster::NurMelden {
                veraltet: Seite::Eigen
            }
        );
    }

    #[test]
    fn wechselregel_folgt_art_und_protokoll_der_gegenstelle() {
        use InstanzKopplungArt::*;
        assert_eq!(wechselregel(Standard, Some(2)), Wechselregel::NachRichtung);
        assert_eq!(wechselregel(Standard, None), Wechselregel::NachRichtung);
        assert_eq!(wechselregel(VorOrt, Some(4)), Wechselregel::Gleichrangig);
        assert_eq!(wechselregel(VorOrt, Some(5)), Wechselregel::Gleichrangig);
        assert_eq!(wechselregel(VorOrt, Some(3)), Wechselregel::Gesperrt);
        assert_eq!(wechselregel(VorOrt, None), Wechselregel::Gesperrt);
    }

    #[test]
    fn org_kennung_traegt_die_instanz() {
        assert_eq!(org_kennung("abc", 7), "abc/7");
    }
}

#[cfg(test)]
mod art_tests {
    use super::{Fluss, InstanzKopplungArt};

    #[test]
    fn standard_traegt_alles_vor_ort_nichts() {
        for f in [
            Fluss::Stammdaten,
            Fluss::Geheimnisse,
            Fluss::Verwahrung,
            Fluss::Fuehrungswechsel,
        ] {
            assert!(InstanzKopplungArt::Standard.traegt(f), "{f:?}");
            assert!(!InstanzKopplungArt::VorOrt.traegt(f), "{f:?}");
        }
    }

    /// Wächter (LLH-1497, design.md D2): Jede Stelle, die einen Fluss auslöst oder annimmt, fragt
    /// die Art der Kopplung. Verliert eine Stelle die Prüfung, wird dieser Test rot; eine neue
    /// Stelle gehört in die Liste.
    #[test]
    fn jeder_fluss_hat_seine_pruefstellen() {
        let stellen: &[(&str, &str, usize)] = &[
            // Stammdaten: Quelle der meldenden Seite, Lieferung der erreichten Seite.
            (
                "src/instanz/stammdaten/herkunft.rs",
                "k.art = 'standard'",
                1,
            ),
            (
                "src/instanz/melden.rs",
                "traegt(super::Fluss::Stammdaten)",
                1,
            ),
            // Geheimnisse: „verteilend“ (Passkey-Pflicht) und „ELW verloren“.
            (
                "src/instanz/stammdaten/geheimnis.rs",
                "k.art = 'standard'",
                1,
            ),
            ("src/routes/instanz.rs", "Fluss::Geheimnisse", 1),
            // Verwahrung: anbieten (meldende Seite) und annehmen (erreichte Seite).
            ("src/instanz/spiegel/abgleich.rs", "Fluss::Verwahrung", 2),
            // Verwahrung auch beim Archiv am Ende der Nachbereitung: es wartet nur auf eine
            // Standardkopplung, die verwahren kann.
            ("src/einsatz/archiv.rs", "k.art = 'standard'", 1),
            // Kein Zurückholen nach dem Widerruf einer Direktkopplung.
            ("src/instanz/repo.rs", "Fluss::Fuehrungswechsel", 1),
            // Führungswechsel nach der Wechselregel (LLH-1678, design.md D1): die Regel je
            // Gegenüber, die Bedienung (beide Wege zum Gegenüber und die Rolle der Seite) und der
            // Austausch der Akten.
            (
                "src/instanz/fuehrung/repo.rs",
                "crate::instanz::wechselregel(",
                1,
            ),
            ("src/instanz/fuehrung/dienst.rs", "match g.wechsel", 1),
            ("src/instanz/fuehrung/dienst.rs", "fordere_wechsel(&g)?", 2),
            ("src/instanz/fuehrung/dienst.rs", "wie_meldend(&g)", 3),
            (
                "src/instanz/fuehrung/austausch.rs",
                "kopplung.wechselregel()",
                1,
            ),
        ];
        let wurzel = env!("CARGO_MANIFEST_DIR");
        for (datei, nadel, mindestens) in stellen {
            let text = std::fs::read_to_string(format!("{wurzel}/{datei}")).unwrap();
            let n = text.matches(nadel).count();
            assert!(
                n >= *mindestens,
                "{datei}: „{nadel}“ {n}-mal, erwartet mindestens {mindestens}"
            );
        }
    }
}
