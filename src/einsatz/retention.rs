//! Reine, injiziert-`jetzt`-testbare Aufbewahrungs-Logik (LFH-135).
//!
//! Hier liegen die zeitlichen Berechnungen für die Frist-Politik (Dauer → Zeitpunkt)
//! und die Karenz vor der irreversiblen PII-Schwärzung. Bewusst frei von DB-Zugriff
//! und `Utc::now()` — der Aufrufer injiziert `jetzt`, damit die Grenzen deterministisch
//! testbar sind (Muster wie `berechtigung::retention_abgelaufen`).

use crate::wire_enum::wire_enum;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// Karenz zwischen Soft-Delete (`geloescht_at`, reversibel) und der irreversiblen
/// PII-Schwärzung — als globale Konstante (wie `NACHLAUF_STUNDEN`), nicht pro Einsatz
/// konfigurierbar. 30 Tage geben genügend Zeit für ein versehentliches Soft-Delete,
/// bevor die Daten endgültig gescrubbt werden.
pub const KARENZ_TAGE: i64 = 30;

/// Berechnet den Aufbewahrungs-Zeitpunkt `retention_bis = abschluss + dauer_tage`.
/// `None`, wenn `abschluss` unparsebar ist (defensiv — kein Auto-Fill auf Müll).
/// Das Ergebnis ist im kanonischen DB-Format formatiert.
pub fn berechne_retention_bis(abschluss: &str, dauer_tage: i64) -> Option<String> {
    let start = crate::zeit::parse_utc(abschluss)?;
    let bis = start + Duration::days(dauer_tage);
    Some(crate::zeit::formatiere_utc(bis))
}

/// Ob die Karenz nach einem Soft-Delete abgelaufen ist
/// (`jetzt >= geloescht_at + KARENZ_TAGE`). `None` (nicht soft-gelöscht) oder ein
/// unparsebarer Wert → `false`: erst nach gültigem, abgelaufenem Karenz-Tombstone
/// darf geschwärzt werden.
pub fn karenz_abgelaufen(geloescht_at: Option<&str>, jetzt: DateTime<Utc>) -> bool {
    let Some(s) = geloescht_at else {
        return false;
    };
    let Some(geloescht) = crate::zeit::parse_utc(s) else {
        return false;
    };
    jetzt >= geloescht + Duration::days(KARENZ_TAGE)
}

wire_enum! {
    /// Aufbewahrungszustand eines ABGESCHLOSSENEN Einsatzes (LFH-23) oder — nur
    /// `EndgueltigGeloescht` — einer Zeile des Löschprotokolls (LFH-750). Aktive Einsätze haben
    /// keinen ([`zustand`] liefert `None`). Genau ein Wert; die Rangfolge steht an [`zustand`]. Wire == [`AufbewahrungZustand::as_str`], gepinnt in
    /// `tests/enum_wire_kontrakt.rs`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AufbewahrungZustand {
        /// Keine Frist gesetzt.
        OhneFrist => "ohne_frist",
        /// Frist in der Zukunft.
        FristLaeuft => "frist_laeuft",
        /// Frist abgelaufen, noch nicht zur Löschung vorgemerkt (der Purge-Lauf holt es nach).
        Faellig => "faellig",
        /// Zur Löschung vorgemerkt, Karenz läuft — nur hier ist Wiederherstellen möglich.
        Vorgemerkt => "vorgemerkt",
        /// Karenz abgelaufen, noch nicht geschwärzt (der nächste Purge-Lauf schwärzt).
        SchwaerzungAusstehend => "schwaerzung_ausstehend",
        /// Personendaten unwiderruflich geschwärzt; die Skelett-Frist läuft oder fehlt.
        Geschwaerzt => "geschwaerzt",
        /// Geschwärzt, Skelett-Frist abgelaufen, noch nicht endgültig gelöscht (LFH-750; der
        /// nächste Purge-Lauf löscht, ohne Akteur bleibt es hier stehen).
        LoeschungAusstehend => "loeschung_ausstehend",
        /// Endgültig gelöscht — nur eine Zeile des Löschprotokolls; [`zustand`] liefert ihn nie.
        EndgueltigGeloescht => "endgueltig_geloescht",
    }
}

/// Leitet den Aufbewahrungszustand ab (LFH-23, design.md D4). `None` für jeden nicht
/// abgeschlossenen Einsatz. Rangfolge: Löschung ausstehend (geschwärzt und Skelett-Frist
/// abgelaufen, [`skelett_loeschung_faellig`], LFH-750) → geschwärzt → Schwärzung ausstehend (Karenz
/// abgelaufen, [`karenz_abgelaufen`]) → vorgemerkt → fällig (Frist abgelaufen, dieselbe
/// Grenze wie die Lesesperre: `jetzt >= retention_bis`) → Frist läuft → ohne Frist.
///
/// Liegt neben [`karenz_abgelaufen`], damit Zustand, Purge und Wiederherstellen dieselbe
/// Zeitrechnung teilen. Ein unparsebarer Tombstone zählt als gesetzt (er sperrt ja auch),
/// die Karenz gilt dann als nicht abgelaufen — dieselbe defensive Lesart wie im Purge.
pub fn zustand(
    status: &str,
    retention_bis: Option<&str>,
    geloescht_at: Option<&str>,
    geschwaerzt_at: Option<&str>,
    abgeschlossen_at: Option<&str>,
    skelett_dauer_tage: Option<i64>,
    jetzt: DateTime<Utc>,
) -> Option<AufbewahrungZustand> {
    if status != crate::einsatz::STATUS_ABGESCHLOSSEN {
        return None;
    }
    let gesetzt = |s: Option<&str>| s.is_some_and(|v| !v.is_empty());
    Some(if gesetzt(geschwaerzt_at) {
        if skelett_loeschung_faellig(abgeschlossen_at, geschwaerzt_at, skelett_dauer_tage, jetzt) {
            AufbewahrungZustand::LoeschungAusstehend
        } else {
            AufbewahrungZustand::Geschwaerzt
        }
    } else if gesetzt(geloescht_at) {
        if karenz_abgelaufen(geloescht_at, jetzt) {
            AufbewahrungZustand::SchwaerzungAusstehend
        } else {
            AufbewahrungZustand::Vorgemerkt
        }
    } else if crate::einsatz::berechtigung::retention_abgelaufen(retention_bis, jetzt) {
        AufbewahrungZustand::Faellig
    } else if gesetzt(retention_bis) {
        AufbewahrungZustand::FristLaeuft
    } else {
        AufbewahrungZustand::OhneFrist
    })
}

/// Zeitpunkt der endgültigen Löschung des Skeletts (LFH-750, design.md D1): der spätere aus
/// `abgeschlossen_at + skelett_dauer_tage` und `geschwaerzt_at` — gelöscht wird nie vor der
/// Schwärzung. Ohne Schwärzung `abgeschlossen_at + skelett_dauer_tage` (Vorschau in der
/// Übersicht). `None` ohne Skelett-Frist oder bei einem unparsebaren Zeitstempel.
pub fn skelett_loeschung_am(
    abgeschlossen_at: Option<&str>,
    geschwaerzt_at: Option<&str>,
    skelett_dauer_tage: Option<i64>,
) -> Option<String> {
    let am = parse_skelett_loeschung_am(abgeschlossen_at, geschwaerzt_at, skelett_dauer_tage)?;
    Some(crate::zeit::formatiere_utc(am))
}

/// Ob das Skelett zu `jetzt` endgültig zu löschen ist: geschwärzt und
/// `jetzt >= skelett_loeschung_am`. Ein nicht geschwärzter Einsatz, eine fehlende Frist oder
/// ein unparsebarer Zeitstempel → `false` (dieselbe defensive Lesart wie
/// [`karenz_abgelaufen`]: im Zweifel bleibt das Skelett).
pub fn skelett_loeschung_faellig(
    abgeschlossen_at: Option<&str>,
    geschwaerzt_at: Option<&str>,
    skelett_dauer_tage: Option<i64>,
    jetzt: DateTime<Utc>,
) -> bool {
    if geschwaerzt_at.is_none_or(str::is_empty) {
        return false;
    }
    parse_skelett_loeschung_am(abgeschlossen_at, geschwaerzt_at, skelett_dauer_tage)
        .is_some_and(|am| jetzt >= am)
}

fn parse_skelett_loeschung_am(
    abgeschlossen_at: Option<&str>,
    geschwaerzt_at: Option<&str>,
    skelett_dauer_tage: Option<i64>,
) -> Option<DateTime<Utc>> {
    let frist = crate::zeit::parse_utc(abgeschlossen_at?)? + Duration::days(skelett_dauer_tage?);
    match geschwaerzt_at {
        None => Some(frist),
        Some(g) => Some(frist.max(crate::zeit::parse_utc(g)?)),
    }
}

/// Ende der Karenz (`geloescht_at + KARENZ_TAGE`) im DB-Format; `None` ohne oder bei
/// unparsebarer Vormerkung.
pub fn karenz_ende(geloescht_at: Option<&str>) -> Option<String> {
    let g = crate::zeit::parse_utc(geloescht_at?)?;
    Some(crate::zeit::formatiere_utc(g + Duration::days(KARENZ_TAGE)))
}

/// Frühester Vormerkungszeitpunkt, dessen Karenz zu `jetzt` NOCH läuft, im DB-Format:
/// `geloescht_at > karenz_grenze(jetzt)` ⇔ `!karenz_abgelaufen(geloescht_at, jetzt)`.
/// Für bewachte UPDATEs (Wiederherstellen), die die Grenze in SQL prüfen müssen.
pub fn karenz_grenze(jetzt: DateTime<Utc>) -> String {
    crate::zeit::formatiere_utc(jetzt - Duration::days(KARENZ_TAGE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    #[test]
    fn berechne_retention_bis_addiert_tage() {
        assert_eq!(
            berechne_retention_bis("2026-06-19 10:00:00", 30).as_deref(),
            Some("2026-07-19 10:00:00")
        );
        // Jahres-Übergang.
        assert_eq!(
            berechne_retention_bis("2026-12-31 23:59:59", 1).as_deref(),
            Some("2027-01-01 23:59:59")
        );
    }

    #[test]
    fn berechne_retention_bis_unparsebar_ist_none() {
        assert_eq!(berechne_retention_bis("kaputt", 30), None);
    }

    #[test]
    fn karenz_abgelaufen_grenzen() {
        let jetzt = t("2026-06-30 12:00:00");
        // Vor KARENZ_TAGE (30) abgelaufen → noch in Karenz (false).
        assert!(!karenz_abgelaufen(Some("2026-06-15 12:00:00"), jetzt));
        // Exakt 30 Tage vorher → abgelaufen (>=).
        assert!(karenz_abgelaufen(Some("2026-05-31 12:00:00"), jetzt));
        // Lange her → abgelaufen.
        assert!(karenz_abgelaufen(Some("2026-01-01 00:00:00"), jetzt));
    }

    #[test]
    fn karenz_abgelaufen_ohne_oder_unparsebar_ist_false() {
        let jetzt = t("2026-06-30 12:00:00");
        assert!(!karenz_abgelaufen(None, jetzt));
        assert!(!karenz_abgelaufen(Some("kaputt"), jetzt));
    }

    // ---------- LFH-23: Aufbewahrungszustand ----------

    fn z(
        status: &str,
        frist: Option<&str>,
        geloescht: Option<&str>,
        geschwaerzt: Option<&str>,
    ) -> Option<AufbewahrungZustand> {
        zustand(
            status,
            frist,
            geloescht,
            geschwaerzt,
            Some("2016-01-01 00:00:00"),
            None,
            t("2026-06-30 12:00:00"),
        )
    }

    // ---------- LFH-750: endgültige Löschung des Skeletts ----------

    #[test]
    fn skelett_loeschung_am_ist_spaeter_aus_abschluss_plus_frist_und_schwaerzung() {
        // Abschluss + N liegt nach der Schwärzung → Abschluss + N.
        assert_eq!(
            skelett_loeschung_am(
                Some("2016-01-01 10:00:00"),
                Some("2016-03-01 00:00:00"),
                Some(3650)
            )
            .as_deref(),
            Some("2025-12-29 10:00:00")
        );
        // Schwärzung nach Abschluss + N → Schwärzung.
        assert_eq!(
            skelett_loeschung_am(
                Some("2026-01-01 10:00:00"),
                Some("2026-03-01 00:00:00"),
                Some(1)
            )
            .as_deref(),
            Some("2026-03-01 00:00:00")
        );
        // Noch nicht geschwärzt → Abschluss + N.
        assert_eq!(
            skelett_loeschung_am(Some("2026-01-01 10:00:00"), None, Some(30)).as_deref(),
            Some("2026-01-31 10:00:00")
        );
    }

    #[test]
    fn skelett_loeschung_am_ohne_frist_oder_unparsebar_ist_none() {
        assert_eq!(
            skelett_loeschung_am(Some("2016-01-01 10:00:00"), None, None),
            None
        );
        assert_eq!(skelett_loeschung_am(None, None, Some(30)), None);
        assert_eq!(skelett_loeschung_am(Some("kaputt"), None, Some(30)), None);
        assert_eq!(
            skelett_loeschung_am(Some("2016-01-01 10:00:00"), Some("kaputt"), Some(30)),
            None
        );
    }

    #[test]
    fn skelett_loeschung_faellig_grenzen() {
        let jetzt = t("2026-06-30 12:00:00");
        let abschluss = Some("2026-05-31 12:00:00");
        let geschwaerzt = Some("2026-06-01 00:00:00");
        // Genau Abschluss + 30 Tage = jetzt → fällig; eine Sekunde später nicht.
        assert!(skelett_loeschung_faellig(
            abschluss,
            geschwaerzt,
            Some(30),
            jetzt
        ));
        assert!(!skelett_loeschung_faellig(
            Some("2026-05-31 12:00:01"),
            geschwaerzt,
            Some(30),
            jetzt
        ));
        // Nicht geschwärzt → nie fällig, auch wenn Abschluss + N vergangen ist.
        assert!(!skelett_loeschung_faellig(abschluss, None, Some(1), jetzt));
        // Ohne Frist oder mit unparsebaren Werten → nie fällig.
        assert!(!skelett_loeschung_faellig(
            abschluss,
            geschwaerzt,
            None,
            jetzt
        ));
        assert!(!skelett_loeschung_faellig(
            Some("kaputt"),
            geschwaerzt,
            Some(1),
            jetzt
        ));
        assert!(!skelett_loeschung_faellig(
            abschluss,
            Some("kaputt"),
            Some(1),
            jetzt
        ));
        // Schwärzung in der Zukunft (Uhr) → erst ab der Schwärzung.
        assert!(!skelett_loeschung_faellig(
            abschluss,
            Some("2026-06-30 12:00:01"),
            Some(1),
            jetzt
        ));
    }

    #[test]
    fn zustand_loeschung_ausstehend_nur_mit_abgelaufener_skelett_frist() {
        use AufbewahrungZustand::*;
        let jetzt = t("2026-06-30 12:00:00");
        let geschwaerzt = Some("2016-03-01 00:00:00");
        let abschluss = Some("2016-01-01 00:00:00");
        let mit = |frist: Option<i64>| {
            zustand(
                "abgeschlossen",
                None,
                Some("2016-02-01 00:00:00"),
                geschwaerzt,
                abschluss,
                frist,
                jetzt,
            )
        };
        assert_eq!(mit(Some(3650)), Some(LoeschungAusstehend));
        // Frist noch nicht abgelaufen bzw. ohne Org-Frist → geschwärzt.
        assert_eq!(mit(Some(36500)), Some(Geschwaerzt));
        assert_eq!(mit(None), Some(Geschwaerzt));
        // Nicht geschwärzt: die Skelett-Frist ändert den Zustand nicht.
        assert_eq!(
            zustand(
                "abgeschlossen",
                Some("2016-01-02 00:00:00"),
                None,
                None,
                abschluss,
                Some(1),
                jetzt
            ),
            Some(Faellig)
        );
    }

    #[test]
    fn zustand_aktiv_ist_none() {
        assert_eq!(z("aktiv", Some("2026-01-01 00:00:00"), None, None), None);
        assert_eq!(z("aktiv", None, None, None), None);
    }

    #[test]
    fn zustand_je_wert_und_grenzen() {
        use AufbewahrungZustand::*;
        assert_eq!(z("abgeschlossen", None, None, None), Some(OhneFrist));
        assert_eq!(
            z("abgeschlossen", Some("2026-06-30 12:00:01"), None, None),
            Some(FristLaeuft)
        );
        // Frist genau jetzt → fällig (dieselbe Grenze wie die Lesesperre).
        assert_eq!(
            z("abgeschlossen", Some("2026-06-30 12:00:00"), None, None),
            Some(Faellig)
        );
        assert_eq!(
            z("abgeschlossen", Some("2026-01-01 00:00:00"), None, None),
            Some(Faellig)
        );
        // Vormerkung 29 Tage 23:59:59 alt → vorgemerkt; genau 30 Tage → Schwärzung steht aus.
        assert_eq!(
            z(
                "abgeschlossen",
                Some("2026-01-01 00:00:00"),
                Some("2026-05-31 12:00:01"),
                None
            ),
            Some(Vorgemerkt)
        );
        assert_eq!(
            z(
                "abgeschlossen",
                Some("2026-01-01 00:00:00"),
                Some("2026-05-31 12:00:00"),
                None
            ),
            Some(SchwaerzungAusstehend)
        );
        // Geschwärzt gewinnt vor allem anderen.
        assert_eq!(
            z(
                "abgeschlossen",
                None,
                Some("2026-01-01 00:00:00"),
                Some("2026-02-01 00:00:00")
            ),
            Some(Geschwaerzt)
        );
        // Eine in die Zukunft verlängerte Frist macht eine Vormerkung nicht ungeschehen.
        assert_eq!(
            z(
                "abgeschlossen",
                Some("2099-01-01 00:00:00"),
                Some("2026-06-29 00:00:00"),
                None
            ),
            Some(Vorgemerkt)
        );
    }

    #[test]
    fn karenz_ende_addiert_karenz() {
        assert_eq!(
            karenz_ende(Some("2026-06-01 08:00:00")).as_deref(),
            Some("2026-07-01 08:00:00")
        );
        assert_eq!(karenz_ende(None), None);
        assert_eq!(karenz_ende(Some("kaputt")), None);
    }

    /// Die SQL-Grenze des Wiederherstellens (`geloescht_at > karenz_grenze(jetzt)`) muss
    /// exakt mit `karenz_abgelaufen` übereinstimmen — beidseits der Grenze.
    #[test]
    fn karenz_grenze_deckt_sich_mit_karenz_abgelaufen() {
        let jetzt = t("2026-06-30 12:00:00");
        let grenze = karenz_grenze(jetzt);
        assert_eq!(grenze, "2026-05-31 12:00:00");
        for g in [
            "2026-05-31 11:59:59",
            "2026-05-31 12:00:00",
            "2026-05-31 12:00:01",
        ] {
            assert_eq!(
                g > grenze.as_str(),
                !karenz_abgelaufen(Some(g), jetzt),
                "Grenzfall {g}"
            );
        }
    }

    #[test]
    fn zustand_wire_ist_snake_case() {
        assert_eq!(
            serde_json::to_value(AufbewahrungZustand::SchwaerzungAusstehend).unwrap(),
            serde_json::json!("schwaerzung_ausstehend")
        );
        assert_eq!(
            serde_json::to_value(AufbewahrungZustand::LoeschungAusstehend).unwrap(),
            serde_json::json!("loeschung_ausstehend")
        );
        assert_eq!(
            serde_json::to_value(AufbewahrungZustand::EndgueltigGeloescht).unwrap(),
            serde_json::json!("endgueltig_geloescht")
        );
    }
}
