use serde::Serialize;
use utoipa::ToSchema;

/// Taktische Stärke (FwDV 3 / DV 100): Führer / Unterführer / Mannschaft.
/// `gesamt` wird berechnet, nicht gespeichert. `u16`, damit auch ein Verband/Stab
/// über 255 nicht anstößt. Wiederverwendbar für Personal/Einheiten (K&M‑2/3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Staerke {
    pub fuehrer: u16,
    pub unterfuehrer: u16,
    pub mannschaft: u16,
}

impl Staerke {
    pub fn neu(fuehrer: u16, unterfuehrer: u16, mannschaft: u16) -> Self {
        Staerke { fuehrer, unterfuehrer, mannschaft }
    }

    /// Gesamtstärke = Summe der drei Werte. `u32`, damit die Summe dreier `u16`
    /// nie überläuft (sauber, auch wenn praktisch nie relevant).
    pub fn gesamt(&self) -> u32 {
        self.fuehrer as u32 + self.unterfuehrer as u32 + self.mannschaft as u32
    }

    /// 4-stellige Anzeige "F/UF/M//Gesamt" (BOS-Doppelstrich vor der Gesamtstärke), z. B. "1/3/18//22".
    pub fn anzeige(&self) -> String {
        format!("{}/{}/{}//{}", self.fuehrer, self.unterfuehrer, self.mannschaft, self.gesamt())
    }

    /// Baut eine optionale Stärke aus drei Eingabe-/DB-Optionen (i64, da SQLite
    /// INTEGER). Regel: alle drei gesetzt **oder** alle drei `None`; Werte
    /// 0..=u16::MAX. Bei Verstoß `Err` mit deutscher Validierungsmeldung — der
    /// Aufrufer (Handler) mappt das auf `AppError::Validation`.
    pub fn aus_optionen(
        fuehrer: Option<i64>,
        unterfuehrer: Option<i64>,
        mannschaft: Option<i64>,
    ) -> Result<Option<Staerke>, String> {
        match (fuehrer, unterfuehrer, mannschaft) {
            (None, None, None) => Ok(None),
            (Some(f), Some(u), Some(m)) => {
                for (name, wert) in [("Führer", f), ("Unterführer", u), ("Mannschaft", m)] {
                    if wert < 0 {
                        return Err(format!("Stärke ({name}) darf nicht negativ sein"));
                    }
                    if wert > u16::MAX as i64 {
                        return Err(format!("Stärke ({name}) ist zu groß"));
                    }
                }
                Ok(Some(Staerke::neu(f as u16, u as u16, m as u16)))
            }
            _ => Err(
                "Stärke muss vollständig (Führer, Unterführer, Mannschaft) oder leer sein".into(),
            ),
        }
    }
}

/// Taktische Stärke-Position einer einzelnen Person (genau einer von drei Töpfen).
/// Wird als TEXT in der DB gespeichert (kein sqlx-Enum-Decode → manuell konvertiert).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StaerkePosition {
    Fuehrer,
    Unterfuehrer,
    Mannschaft,
}

impl StaerkePosition {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            StaerkePosition::Fuehrer => "fuehrer",
            StaerkePosition::Unterfuehrer => "unterfuehrer",
            StaerkePosition::Mannschaft => "mannschaft",
        }
    }

    /// Parst einen gespeicherten/übergebenen Positionsstring; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<StaerkePosition> {
        match s {
            "fuehrer" => Some(StaerkePosition::Fuehrer),
            "unterfuehrer" => Some(StaerkePosition::Unterfuehrer),
            "mannschaft" => Some(StaerkePosition::Mannschaft),
            _ => None,
        }
    }
}

impl Staerke {
    /// Aggregiert einzelne Positionen zu einer Stärke (zählt je Topf). Damit summiert
    /// K&M‑3 die Einheiten-Stärke direkt aus den Dispositionszeilen, ohne neue Logik.
    pub fn aus_positionen(positionen: impl Iterator<Item = StaerkePosition>) -> Staerke {
        let (mut f, mut u, mut m) = (0u16, 0u16, 0u16);
        for p in positionen {
            match p {
                StaerkePosition::Fuehrer => f += 1,
                StaerkePosition::Unterfuehrer => u += 1,
                StaerkePosition::Mannschaft => m += 1,
            }
        }
        Staerke::neu(f, u, m)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gesamt_summiert_die_drei_werte() {
        assert_eq!(Staerke::neu(1, 3, 18).gesamt(), 22);
        assert_eq!(Staerke::neu(0, 0, 2).gesamt(), 2);
    }

    #[test]
    fn anzeige_ist_vierstellig() {
        assert_eq!(Staerke::neu(1, 3, 18).anzeige(), "1/3/18//22");
        assert_eq!(Staerke::neu(0, 1, 5).anzeige(), "0/1/5//6");
    }

    #[test]
    fn aus_optionen_alle_none_ist_ok_none() {
        assert_eq!(Staerke::aus_optionen(None, None, None).unwrap(), None);
    }

    #[test]
    fn aus_optionen_alle_gesetzt_ist_ok_some() {
        assert_eq!(
            Staerke::aus_optionen(Some(1), Some(3), Some(18)).unwrap(),
            Some(Staerke::neu(1, 3, 18))
        );
    }

    #[test]
    fn aus_optionen_teilweise_gesetzt_ist_fehler() {
        assert!(Staerke::aus_optionen(Some(1), None, Some(2)).is_err());
        assert!(Staerke::aus_optionen(None, Some(1), None).is_err());
    }

    #[test]
    fn aus_optionen_negativ_ist_fehler() {
        assert!(Staerke::aus_optionen(Some(-1), Some(0), Some(0)).is_err());
    }

    #[test]
    fn aus_optionen_zu_gross_ist_fehler() {
        assert!(Staerke::aus_optionen(Some(0), Some(0), Some(70000)).is_err());
    }

    #[test]
    fn staerke_position_roundtrip() {
        for p in [StaerkePosition::Fuehrer, StaerkePosition::Unterfuehrer, StaerkePosition::Mannschaft] {
            assert_eq!(StaerkePosition::parse(p.as_str()), Some(p));
        }
        assert_eq!(StaerkePosition::parse("chef"), None);
    }

    #[test]
    fn aus_positionen_zaehlt_je_topf() {
        use StaerkePosition::*;
        let s = Staerke::aus_positionen([Fuehrer, Mannschaft, Mannschaft, Unterfuehrer, Mannschaft].into_iter());
        assert_eq!(s, Staerke::neu(1, 1, 3));
        assert_eq!(s.gesamt(), 5);
    }

    #[test]
    fn aus_positionen_leer_ist_null() {
        assert_eq!(Staerke::aus_positionen(std::iter::empty()), Staerke::neu(0, 0, 0));
    }
}
