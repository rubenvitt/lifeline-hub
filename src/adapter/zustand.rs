//! Zustand, Fehlercodes und Wartezeit der Adapter als reine Funktionen (LLH-2017, Design-Doc
//! „Lauf“).
//!
//! Ein vorübergehender Fehler wird wiederholt: nach dem n-ten Fehlschlag in Folge frühestens nach
//! `max(intervall, min(60 s · 2^(n−1), 15 min))`. Anders als bei den Webhooks hält ein Adapter
//! nie von selbst wegen Dauer an: eine Alarmquelle soll nach einer Störung von allein wiederkommen.
//! Ein Fehler, den nur ein Mensch beheben kann, hält ihn sofort an (`braucht_eingriff`).

use chrono::Duration;
use serde::Serialize;
use utoipa::ToSchema;

use crate::wire_enum::wire_enum;
use crate::zeit;

/// Erste Wartezeit nach einem Fehlschlag.
pub const WARTEZEIT_START_S: i64 = 60;

/// Längste Wartezeit nach Fehlschlägen (ein längeres Intervall gilt trotzdem).
pub const WARTEZEIT_MAX_S: i64 = 15 * 60;

wire_enum! {
    /// Warum ein Abruf scheiterte oder ein Adapter angehalten ist. Ein Code, nie Text des Ziels.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AdapterFehler {
        /// Das Ziel antwortete mit einem Status außerhalb von 2xx (außer 401/403); er steht daneben.
        Status => "status",
        /// Das Ziel lehnte den Zugang ab (401/403): Schlüssel oder Recht falsch.
        Abgelehnt => "abgelehnt",
        /// Das Ziel wollte weiterleiten (3xx); dem folgt der Rahmen nie.
        Weiterleitung => "weiterleitung",
        /// Keine Antwort innerhalb des Zeitlimits.
        Zeitueberschreitung => "zeitueberschreitung",
        /// Die Verbindung kam nicht zustande oder brach ab.
        Verbindung => "verbindung",
        /// Das Zertifikat des Ziels wurde nicht anerkannt.
        Tls => "tls",
        /// Das Ziel liegt in einem gesperrten oder (ohne LAN-Ausnahme) privaten Netz.
        ZielIntern => "ziel_intern",
        /// Der Name des Ziels ließ sich nicht auflösen.
        Dns => "dns",
        /// Die Ziel-URL besteht die Prüfung nicht (Form, Schema).
        ZielUngueltig => "ziel_ungueltig",
        /// Die Antwort war größer als erlaubt.
        ZuGross => "zu_gross",
        /// Die Antwort ließ sich nicht lesen (Format).
        AntwortUngueltig => "antwort_ungueltig",
        /// Ein Pflicht-Geheimnis der Art ist nicht gesetzt.
        GeheimnisFehlt => "geheimnis_fehlt",
        /// Ein Geheimnis passt nicht zum geladenen Schlüssel (anderer Rechner, anderer Schlüssel).
        GeheimnisUnlesbar => "geheimnis_unlesbar",
        /// Der Server hat keinen Schlüssel für Geheimnisse (`LIFELINE_GEHEIMNIS_SCHLUESSEL`).
        GeheimnisspeicherGesperrt => "geheimnisspeicher_gesperrt",
        /// Die gespeicherten Einstellungen bestehen die Prüfung der Art nicht mehr.
        EinstellungUngueltig => "einstellung_ungueltig",
        /// Fehler im Server; steht im Log.
        Intern => "intern",
    }
}

wire_enum! {
    /// Zustand eines Adapters, wie die Verwaltung ihn zeigt; abgeleitet aus seiner Zeile.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AdapterZustand {
        /// Noch nie gelaufen; der erste Abruf steht an.
        Wartet => "wartet",
        /// Der letzte Abruf war erfolgreich.
        Ok => "ok",
        /// Der letzte Abruf scheiterte vorübergehend; der nächste ist geplant.
        Gestoert => "gestoert",
        /// Angehalten wegen eines Fehlers, den ein Mensch beheben muss (`angehalten_grund`).
        BrauchtEingriff => "braucht_eingriff",
        /// Von einem Admin angehalten.
        Aus => "aus",
        /// Die Art kennt dieser Server nicht (mehr); der Adapter läuft nicht.
        ArtUnbekannt => "art_unbekannt",
    }
}

wire_enum! {
    /// Was zur laufenden Störung eines Adapters schon gemeldet ist (`adapter.gemeldet`, LLH-2026).
    /// Leer, wenn nichts; so meldet sich eine Störung nur einmal.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AdapterGemeldet {
        /// „Anbindung gestört“ ist gemeldet.
        Gestoert => "gestoert",
        /// „Anbindung braucht Eingriff“ ist gemeldet.
        Eingriff => "eingriff",
    }
}

/// Ob ein Fehler einen Menschen braucht: dann hält der Adapter an, statt zu wiederholen.
pub fn braucht_eingriff(fehler: AdapterFehler) -> bool {
    use AdapterFehler::*;
    match fehler {
        Abgelehnt
        | Weiterleitung
        | ZielIntern
        | ZielUngueltig
        | GeheimnisFehlt
        | GeheimnisUnlesbar
        | GeheimnisspeicherGesperrt
        | EinstellungUngueltig => true,
        Status | Zeitueberschreitung | Verbindung | Tls | Dns | ZuGross | AntwortUngueltig
        | Intern => false,
    }
}

/// Wartezeit nach dem `fehlversuche`-ten Fehlschlag in Folge (ab 1), nie kürzer als das Intervall.
pub fn wartezeit_s(intervall_s: i64, fehlversuche: i64) -> i64 {
    let n = fehlversuche.clamp(1, 64);
    let faktor = 1_i64 << (n - 1).min(20);
    let backoff = WARTEZEIT_START_S
        .saturating_mul(faktor)
        .min(WARTEZEIT_MAX_S);
    backoff.max(intervall_s.max(1))
}

/// Was nach einem Fehlschlag in die Zeile kommt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NachFehlschlag {
    /// Erneut versuchen.
    Wiederholen {
        fehler_seit: String,
        fehlversuche: i64,
        naechster_abruf_at: String,
    },
    /// Anhalten, bis ein Mensch eingreift.
    Anhalten {
        fehler_seit: String,
        fehlversuche: i64,
    },
}

/// Der Zustand nach einem Fehlschlag um `jetzt` (`zeit::FORMAT`). `fehler_seit` ist der erste
/// Fehlschlag der laufenden Störung, `None` beim ersten.
pub fn nach_fehlschlag(
    fehler: AdapterFehler,
    intervall_s: i64,
    fehler_seit: Option<&str>,
    fehlversuche_bisher: i64,
    jetzt: &str,
) -> NachFehlschlag {
    let seit = fehler_seit.unwrap_or(jetzt).to_string();
    let fehlversuche = fehlversuche_bisher.max(0) + 1;
    if braucht_eingriff(fehler) {
        return NachFehlschlag::Anhalten {
            fehler_seit: seit,
            fehlversuche,
        };
    }
    let jetzt_t = zeit::parse(jetzt).expect("jetzt im Format zeit::FORMAT");
    let naechster = jetzt_t + Duration::seconds(wartezeit_s(intervall_s, fehlversuche));
    NachFehlschlag::Wiederholen {
        fehler_seit: seit,
        fehlversuche,
        naechster_abruf_at: zeit::formatiere(naechster),
    }
}

/// Die Angaben einer Zeile, aus denen der Zustand folgt.
#[derive(Debug, Clone, Copy)]
pub struct ZustandAngaben<'a> {
    pub art_bekannt: bool,
    pub angehalten: bool,
    pub angehalten_grund: Option<&'a str>,
    pub fehler_seit: Option<&'a str>,
    pub letzter_erfolg_at: Option<&'a str>,
}

/// Leitet den angezeigten Zustand ab. Eine unbekannte Art geht vor, dann das Anhalten.
pub fn zustand_von(a: ZustandAngaben<'_>) -> AdapterZustand {
    if !a.art_bekannt {
        AdapterZustand::ArtUnbekannt
    } else if a.angehalten {
        if a.angehalten_grund.is_some() {
            AdapterZustand::BrauchtEingriff
        } else {
            AdapterZustand::Aus
        }
    } else if a.fehler_seit.is_some() {
        AdapterZustand::Gestoert
    } else if a.letzter_erfolg_at.is_some() {
        AdapterZustand::Ok
    } else {
        AdapterZustand::Wartet
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wartezeit_verdoppelt_bis_fuenfzehn_minuten_und_nie_unter_dem_intervall() {
        let minuten: Vec<i64> = (1..=6).map(|n| wartezeit_s(30, n) / 60).collect();
        assert_eq!(minuten, [1, 2, 4, 8, 15, 15]);
        assert_eq!(wartezeit_s(30, 1000), WARTEZEIT_MAX_S);
        // Ein langes Intervall gilt auch in der Störung.
        assert_eq!(wartezeit_s(3600, 1), 3600);
        assert_eq!(wartezeit_s(3600, 10), 3600);
    }

    #[test]
    fn einteilung_der_fehler() {
        use AdapterFehler::*;
        for f in [
            Abgelehnt,
            Weiterleitung,
            ZielIntern,
            ZielUngueltig,
            GeheimnisFehlt,
            GeheimnisUnlesbar,
            GeheimnisspeicherGesperrt,
            EinstellungUngueltig,
        ] {
            assert!(braucht_eingriff(f), "{f:?}");
        }
        for f in [
            Status,
            Zeitueberschreitung,
            Verbindung,
            Tls,
            Dns,
            ZuGross,
            AntwortUngueltig,
            Intern,
        ] {
            assert!(!braucht_eingriff(f), "{f:?}");
        }
        assert_eq!(AdapterFehler::ALLE.len(), 16);
    }

    #[test]
    fn voruebergehender_fehler_wiederholt_mit_wartezeit() {
        let n = nach_fehlschlag(
            AdapterFehler::Verbindung,
            60,
            None,
            0,
            "2026-11-21 10:00:00",
        );
        assert_eq!(
            n,
            NachFehlschlag::Wiederholen {
                fehler_seit: "2026-11-21 10:00:00".into(),
                fehlversuche: 1,
                naechster_abruf_at: "2026-11-21 10:01:00".into(),
            }
        );
        let n = nach_fehlschlag(
            AdapterFehler::Status,
            60,
            Some("2026-11-21 10:00:00"),
            3,
            "2026-11-21 10:20:00",
        );
        assert_eq!(
            n,
            NachFehlschlag::Wiederholen {
                fehler_seit: "2026-11-21 10:00:00".into(),
                fehlversuche: 4,
                naechster_abruf_at: "2026-11-21 10:28:00".into(),
            }
        );
    }

    #[test]
    fn eingriff_haelt_an() {
        let n = nach_fehlschlag(AdapterFehler::Abgelehnt, 60, None, 0, "2026-11-21 10:00:00");
        assert_eq!(
            n,
            NachFehlschlag::Anhalten {
                fehler_seit: "2026-11-21 10:00:00".into(),
                fehlversuche: 1,
            }
        );
    }

    #[test]
    fn zustand_wird_abgeleitet() {
        let basis = ZustandAngaben {
            art_bekannt: true,
            angehalten: false,
            angehalten_grund: None,
            fehler_seit: None,
            letzter_erfolg_at: None,
        };
        assert_eq!(zustand_von(basis), AdapterZustand::Wartet);
        let ok = ZustandAngaben {
            letzter_erfolg_at: Some("x"),
            ..basis
        };
        assert_eq!(zustand_von(ok), AdapterZustand::Ok);
        let gestoert = ZustandAngaben {
            fehler_seit: Some("x"),
            ..ok
        };
        assert_eq!(zustand_von(gestoert), AdapterZustand::Gestoert);
        let aus = ZustandAngaben {
            angehalten: true,
            ..gestoert
        };
        assert_eq!(zustand_von(aus), AdapterZustand::Aus);
        let eingriff = ZustandAngaben {
            angehalten_grund: Some("abgelehnt"),
            ..aus
        };
        assert_eq!(zustand_von(eingriff), AdapterZustand::BrauchtEingriff);
        let unbekannt = ZustandAngaben {
            art_bekannt: false,
            ..eingriff
        };
        assert_eq!(zustand_von(unbekannt), AdapterZustand::ArtUnbekannt);
    }
}
