//! Reine, injiziert-`jetzt`-testbare Aufbewahrungs-Logik (LFH-135).
//!
//! Hier liegen die zeitlichen Berechnungen für die Frist-Politik (Dauer → Zeitpunkt)
//! und die Karenz vor der irreversiblen PII-Schwärzung. Bewusst frei von DB-Zugriff
//! und `Utc::now()` — der Aufrufer injiziert `jetzt`, damit die Grenzen deterministisch
//! testbar sind (Muster wie `berechtigung::retention_abgelaufen`).

use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// Kanonisches DB-Zeitformat (UTC, ohne Zeitzone).
const FMT: &str = "%Y-%m-%d %H:%M:%S";

/// Karenz zwischen Soft-Delete (`geloescht_at`, reversibel) und der irreversiblen
/// PII-Schwärzung — als globale Konstante (wie `NACHLAUF_STUNDEN`), nicht pro Einsatz
/// konfigurierbar. 30 Tage geben genügend Zeit für ein versehentliches Soft-Delete,
/// bevor die Daten endgültig gescrubbt werden.
pub const KARENZ_TAGE: i64 = 30;

/// Parst einen DB-Zeitstempel; bei Unparsbarkeit `None` (defensiv).
fn parse(s: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(s, FMT)
        .ok()
        .map(|n| n.and_utc())
}

/// Berechnet den Aufbewahrungs-Zeitpunkt `retention_bis = abschluss + dauer_tage`.
/// `None`, wenn `abschluss` unparsebar ist (defensiv — kein Auto-Fill auf Müll).
/// Das Ergebnis ist im kanonischen DB-Format formatiert.
pub fn berechne_retention_bis(abschluss: &str, dauer_tage: i64) -> Option<String> {
    let start = parse(abschluss)?;
    let bis = start + Duration::days(dauer_tage);
    Some(bis.format(FMT).to_string())
}

/// Ob die Karenz nach einem Soft-Delete abgelaufen ist
/// (`jetzt >= geloescht_at + KARENZ_TAGE`). `None` (nicht soft-gelöscht) oder ein
/// unparsebarer Wert → `false`: erst nach gültigem, abgelaufenem Karenz-Tombstone
/// darf geschwärzt werden.
pub fn karenz_abgelaufen(geloescht_at: Option<&str>, jetzt: DateTime<Utc>) -> bool {
    let Some(s) = geloescht_at else {
        return false;
    };
    let Some(geloescht) = parse(s) else {
        return false;
    };
    jetzt >= geloescht + Duration::days(KARENZ_TAGE)
}

/// Aufbewahrungszustand eines ABGESCHLOSSENEN Einsatzes (LFH-23). Aktive Einsätze haben
/// keinen ([`zustand`] liefert `None`). Genau einer von sechs Werten; die Rangfolge steht an
/// [`zustand`]. Wire == [`AufbewahrungZustand::as_str`], gepinnt in
/// `tests/enum_wire_kontrakt.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AufbewahrungZustand {
    /// Keine Frist gesetzt.
    OhneFrist,
    /// Frist in der Zukunft.
    FristLaeuft,
    /// Frist abgelaufen, noch nicht zur Löschung vorgemerkt (der Purge-Lauf holt es nach).
    Faellig,
    /// Zur Löschung vorgemerkt, Karenz läuft — nur hier ist Wiederherstellen möglich.
    Vorgemerkt,
    /// Karenz abgelaufen, noch nicht geschwärzt (der nächste Purge-Lauf schwärzt).
    SchwaerzungAusstehend,
    /// Personendaten unwiderruflich geschwärzt.
    Geschwaerzt,
}

impl AufbewahrungZustand {
    /// Wire-/Anzeige-Schlüssel.
    pub fn as_str(&self) -> &'static str {
        match self {
            AufbewahrungZustand::OhneFrist => "ohne_frist",
            AufbewahrungZustand::FristLaeuft => "frist_laeuft",
            AufbewahrungZustand::Faellig => "faellig",
            AufbewahrungZustand::Vorgemerkt => "vorgemerkt",
            AufbewahrungZustand::SchwaerzungAusstehend => "schwaerzung_ausstehend",
            AufbewahrungZustand::Geschwaerzt => "geschwaerzt",
        }
    }
}

/// Leitet den Aufbewahrungszustand ab (LFH-23, design.md D4). `None` für jeden nicht
/// abgeschlossenen Einsatz. Rangfolge: geschwärzt → Schwärzung ausstehend (Karenz
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
    jetzt: DateTime<Utc>,
) -> Option<AufbewahrungZustand> {
    if status != crate::einsatz::STATUS_ABGESCHLOSSEN {
        return None;
    }
    let gesetzt = |s: Option<&str>| s.is_some_and(|v| !v.is_empty());
    Some(if gesetzt(geschwaerzt_at) {
        AufbewahrungZustand::Geschwaerzt
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

/// Ende der Karenz (`geloescht_at + KARENZ_TAGE`) im DB-Format; `None` ohne oder bei
/// unparsebarer Vormerkung.
pub fn karenz_ende(geloescht_at: Option<&str>) -> Option<String> {
    let g = parse(geloescht_at?)?;
    Some((g + Duration::days(KARENZ_TAGE)).format(FMT).to_string())
}

/// Frühester Vormerkungszeitpunkt, dessen Karenz zu `jetzt` NOCH läuft, im DB-Format:
/// `geloescht_at > karenz_grenze(jetzt)` ⇔ `!karenz_abgelaufen(geloescht_at, jetzt)`.
/// Für bewachte UPDATEs (Wiederherstellen), die die Grenze in SQL prüfen müssen.
pub fn karenz_grenze(jetzt: DateTime<Utc>) -> String {
    (jetzt - Duration::days(KARENZ_TAGE))
        .format(FMT)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, FMT).unwrap().and_utc()
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
            t("2026-06-30 12:00:00"),
        )
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
    }
}
