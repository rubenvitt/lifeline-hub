//! Effektivwert-Resolver für Einsatz- und Org-Einstellungen (admin-einstellungen / Task 3).
//!
//! Reine Funktionen, kein DB-Zugriff. Fallback-Kette:
//! **Einsatz-Override ?? Org-Default ?? hartkodierter Fallback.**
//!
//! Nummern-Startwerte erhalten KEINEN Org-Default (bleiben rein pro Einsatz).

use crate::einsatz::einstellungen::EinsatzEinstellungen;
use crate::org::einstellungen::OrgEinstellungen;

/// Effektive Meldungs-Bestätigungs-Frist in Minuten: Einsatz ?? Org.
pub fn effektive_meldung_frist_min(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<i64> {
    e.meldung_bestaetigung_frist_min
        .or(o.meldung_bestaetigung_frist_min)
}

/// Effektive Auftrags-Quittierungs-Frist in Minuten: Einsatz ?? Org.
pub fn effektive_auftrag_quittierung_frist_min(
    e: &EinsatzEinstellungen,
    o: &OrgEinstellungen,
) -> Option<i64> {
    e.auftrag_quittierung_frist_min
        .or(o.auftrag_quittierung_frist_min)
}

/// Effektive Rückmeldefrist in Minuten (LFH-610): Einsatz ?? Org. Den hartkodierten
/// Fallback (`meldung::RUECKMELDUNG_FRIST_DEFAULT_MIN`) setzt der Aufrufer ein.
pub fn effektive_rueckmeldung_frist_min(
    e: &EinsatzEinstellungen,
    o: &OrgEinstellungen,
) -> Option<i64> {
    e.rueckmeldung_frist_min.or(o.rueckmeldung_frist_min)
}

/// Effektive Aufbewahrungsdauer in Tagen: Einsatz ?? Org.
pub fn effektive_retention_dauer_tage(
    e: &EinsatzEinstellungen,
    o: &OrgEinstellungen,
) -> Option<i64> {
    e.retention_dauer_tage.or(o.retention_dauer_tage)
}

/// Ob Auto-ETB-Dual-Publish aktiv ist.
///
/// Erste nicht-`None` aus Einsatz / Org: `Some(0)` = aus, sonst an.
/// Hartkodierter Default (beide `None`): **an** (historisches Verhalten).
pub fn effektiv_auto_etb_aktiv(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> bool {
    e.auto_etb_eintraege
        .or(o.auto_etb_eintraege)
        .map_or(true, |v| v != 0)
}

/// Effektive Modul-Rolle: Einsatz-Override ?? Org-Default.
///
/// `None` = kein Rollenzwang (freier Zugriff für alle Einsatz-Mitglieder).
pub fn effektive_modul_rolle(
    einsatz_override: Option<&str>,
    org_default: Option<&str>,
) -> Option<String> {
    einsatz_override.or(org_default).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::einstellungen::EinsatzEinstellungen;
    use crate::org::einstellungen::OrgEinstellungen;

    fn e() -> EinsatzEinstellungen {
        EinsatzEinstellungen::leer(1)
    }
    fn o() -> OrgEinstellungen {
        OrgEinstellungen::leer(1)
    }

    // ── effektive_meldung_frist_min ───────────────────────────────────────────

    #[test]
    fn meldung_frist_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen {
            meldung_bestaetigung_frist_min: Some(10),
            ..e()
        };
        let o = OrgEinstellungen {
            meldung_bestaetigung_frist_min: Some(30),
            ..o()
        };
        assert_eq!(effektive_meldung_frist_min(&e, &o), Some(10));
    }

    #[test]
    fn meldung_frist_fallback_auf_org() {
        let o = OrgEinstellungen {
            meldung_bestaetigung_frist_min: Some(30),
            ..o()
        };
        assert_eq!(effektive_meldung_frist_min(&e(), &o), Some(30));
    }

    #[test]
    fn meldung_frist_beide_none_ist_none() {
        assert_eq!(effektive_meldung_frist_min(&e(), &o()), None);
    }

    // ── effektive_rueckmeldung_frist_min ───────────────────────────────────────

    #[test]
    fn rueckmeldung_frist_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen {
            rueckmeldung_frist_min: Some(20),
            ..e()
        };
        let o = OrgEinstellungen {
            rueckmeldung_frist_min: Some(90),
            ..o()
        };
        assert_eq!(effektive_rueckmeldung_frist_min(&e, &o), Some(20));
    }

    #[test]
    fn rueckmeldung_frist_faellt_auf_org_zurueck() {
        let org = OrgEinstellungen {
            rueckmeldung_frist_min: Some(90),
            ..o()
        };
        assert_eq!(effektive_rueckmeldung_frist_min(&e(), &org), Some(90));
        assert_eq!(effektive_rueckmeldung_frist_min(&e(), &o()), None);
    }

    // ── effektive_auftrag_quittierung_frist_min ───────────────────────────────

    #[test]
    fn auftrag_frist_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen {
            auftrag_quittierung_frist_min: Some(15),
            ..e()
        };
        let o = OrgEinstellungen {
            auftrag_quittierung_frist_min: Some(45),
            ..o()
        };
        assert_eq!(effektive_auftrag_quittierung_frist_min(&e, &o), Some(15));
    }

    #[test]
    fn auftrag_frist_fallback_auf_org() {
        let o = OrgEinstellungen {
            auftrag_quittierung_frist_min: Some(45),
            ..o()
        };
        assert_eq!(effektive_auftrag_quittierung_frist_min(&e(), &o), Some(45));
    }

    #[test]
    fn auftrag_frist_beide_none_ist_none() {
        assert_eq!(effektive_auftrag_quittierung_frist_min(&e(), &o()), None);
    }

    // ── effektive_retention_dauer_tage ────────────────────────────────────────

    #[test]
    fn retention_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen {
            retention_dauer_tage: Some(90),
            ..e()
        };
        let o = OrgEinstellungen {
            retention_dauer_tage: Some(365),
            ..o()
        };
        assert_eq!(effektive_retention_dauer_tage(&e, &o), Some(90));
    }

    #[test]
    fn retention_fallback_auf_org() {
        let o = OrgEinstellungen {
            retention_dauer_tage: Some(365),
            ..o()
        };
        assert_eq!(effektive_retention_dauer_tage(&e(), &o), Some(365));
    }

    #[test]
    fn retention_beide_none_ist_none() {
        assert_eq!(effektive_retention_dauer_tage(&e(), &o()), None);
    }

    // ── effektiv_auto_etb_aktiv ───────────────────────────────────────────────

    #[test]
    fn auto_etb_einsatz_an_schlaegt_org_aus() {
        let e = EinsatzEinstellungen {
            auto_etb_eintraege: Some(1),
            ..e()
        };
        let o = OrgEinstellungen {
            auto_etb_eintraege: Some(0),
            ..o()
        };
        assert!(effektiv_auto_etb_aktiv(&e, &o), "Einsatz=1 schlägt Org=0");
    }

    #[test]
    fn auto_etb_einsatz_aus_schlaegt_org_an() {
        let e = EinsatzEinstellungen {
            auto_etb_eintraege: Some(0),
            ..e()
        };
        let o = OrgEinstellungen {
            auto_etb_eintraege: Some(1),
            ..o()
        };
        assert!(!effektiv_auto_etb_aktiv(&e, &o), "Einsatz=0 schlägt Org=1");
    }

    #[test]
    fn auto_etb_einsatz_none_org_aus() {
        let o = OrgEinstellungen {
            auto_etb_eintraege: Some(0),
            ..o()
        };
        assert!(!effektiv_auto_etb_aktiv(&e(), &o), "Org=0 → aus");
    }

    #[test]
    fn auto_etb_beide_none_default_an() {
        assert!(
            effektiv_auto_etb_aktiv(&e(), &o()),
            "beide None → hartkodierter Default an"
        );
    }

    // ── effektive_modul_rolle ─────────────────────────────────────────────────

    #[test]
    fn modul_rolle_einsatz_schlaegt_org() {
        assert_eq!(
            effektive_modul_rolle(Some("admin"), Some("fuehrungskraft")).as_deref(),
            Some("admin")
        );
    }

    #[test]
    fn modul_rolle_fallback_auf_org() {
        assert_eq!(
            effektive_modul_rolle(None, Some("fuehrungskraft")).as_deref(),
            Some("fuehrungskraft")
        );
    }

    #[test]
    fn modul_rolle_beide_none_ist_none() {
        assert_eq!(effektive_modul_rolle(None, None), None);
    }
}
