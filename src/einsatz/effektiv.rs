//! Effektivwert-Resolver für Einsatz- und Org-Einstellungen (admin-einstellungen / Task 3).
//!
//! Reine Funktionen, kein DB-Zugriff. Fallback-Kette:
//! **Einsatz-Override ?? Org-Default ?? hartkodierter Fallback.**
//!
//! Nummern-Startwerte erhalten KEINEN Org-Default (bleiben rein pro Einsatz).

use crate::einsatz::einstellungen::EinsatzEinstellungen;
use crate::org::einstellungen::OrgEinstellungen;

/// Effektives ETB-Nummernkreis-Präfix: Einsatz ?? Org.
pub fn effektives_etb_praefix(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<String> {
    e.etb_nummer_praefix.clone().or_else(|| o.etb_nummer_praefix.clone())
}

/// Effektives Meldungs-Nummernkreis-Präfix: Einsatz ?? Org.
pub fn effektives_meldung_praefix(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<String> {
    e.meldung_nummer_praefix.clone().or_else(|| o.meldung_nummer_praefix.clone())
}

/// Effektives Auftrags-Nummernkreis-Präfix: Einsatz ?? Org.
pub fn effektives_auftrag_praefix(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<String> {
    e.auftrag_nummer_praefix.clone().or_else(|| o.auftrag_nummer_praefix.clone())
}

/// Effektive Meldungs-Bestätigungs-Frist in Minuten: Einsatz ?? Org.
pub fn effektive_meldung_frist_min(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<i64> {
    e.meldung_bestaetigung_frist_min.or(o.meldung_bestaetigung_frist_min)
}

/// Effektive Auftrags-Quittierungs-Frist in Minuten: Einsatz ?? Org.
pub fn effektive_auftrag_quittierung_frist_min(
    e: &EinsatzEinstellungen,
    o: &OrgEinstellungen,
) -> Option<i64> {
    e.auftrag_quittierung_frist_min.or(o.auftrag_quittierung_frist_min)
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

/// Effektive Zeitzone: Einsatz ?? Org.
pub fn effektive_zeitzone(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<String> {
    e.zeitzone.clone().or_else(|| o.zeitzone.clone())
}

/// Effektives Zeitformat: Einsatz ?? Org.
pub fn effektive_zeitformat(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<String> {
    e.zeitformat.clone().or_else(|| o.zeitformat.clone())
}

/// Effektives Einheitensystem: Einsatz ?? Org.
pub fn effektive_einheiten(e: &EinsatzEinstellungen, o: &OrgEinstellungen) -> Option<String> {
    e.einheiten.clone().or_else(|| o.einheiten.clone())
}

/// Effektives Koordinatenformat: Einsatz ?? Org.
pub fn effektive_koordinatenformat(
    e: &EinsatzEinstellungen,
    o: &OrgEinstellungen,
) -> Option<String> {
    e.koordinatenformat.clone().or_else(|| o.koordinatenformat.clone())
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

    // ── effektives_etb_praefix ────────────────────────────────────────────────

    #[test]
    fn etb_praefix_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { etb_nummer_praefix: Some("EB-E".into()), ..e() };
        let o = OrgEinstellungen { etb_nummer_praefix: Some("EB-O".into()), ..o() };
        assert_eq!(effektives_etb_praefix(&e, &o).as_deref(), Some("EB-E"));
    }

    #[test]
    fn etb_praefix_fallback_auf_org() {
        let o = OrgEinstellungen { etb_nummer_praefix: Some("EB-O".into()), ..o() };
        assert_eq!(effektives_etb_praefix(&e(), &o).as_deref(), Some("EB-O"));
    }

    #[test]
    fn etb_praefix_beide_none_ist_none() {
        assert_eq!(effektives_etb_praefix(&e(), &o()), None);
    }

    // ── effektives_meldung_praefix ────────────────────────────────────────────

    #[test]
    fn meldung_praefix_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { meldung_nummer_praefix: Some("M-E".into()), ..e() };
        let o = OrgEinstellungen { meldung_nummer_praefix: Some("M-O".into()), ..o() };
        assert_eq!(effektives_meldung_praefix(&e, &o).as_deref(), Some("M-E"));
    }

    #[test]
    fn meldung_praefix_fallback_auf_org() {
        let o = OrgEinstellungen { meldung_nummer_praefix: Some("M-O".into()), ..o() };
        assert_eq!(effektives_meldung_praefix(&e(), &o).as_deref(), Some("M-O"));
    }

    #[test]
    fn meldung_praefix_beide_none_ist_none() {
        assert_eq!(effektives_meldung_praefix(&e(), &o()), None);
    }

    // ── effektives_auftrag_praefix ────────────────────────────────────────────

    #[test]
    fn auftrag_praefix_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { auftrag_nummer_praefix: Some("A-E".into()), ..e() };
        let o = OrgEinstellungen { auftrag_nummer_praefix: Some("A-O".into()), ..o() };
        assert_eq!(effektives_auftrag_praefix(&e, &o).as_deref(), Some("A-E"));
    }

    #[test]
    fn auftrag_praefix_fallback_auf_org() {
        let o = OrgEinstellungen { auftrag_nummer_praefix: Some("A-O".into()), ..o() };
        assert_eq!(effektives_auftrag_praefix(&e(), &o).as_deref(), Some("A-O"));
    }

    #[test]
    fn auftrag_praefix_beide_none_ist_none() {
        assert_eq!(effektives_auftrag_praefix(&e(), &o()), None);
    }

    // ── effektive_meldung_frist_min ───────────────────────────────────────────

    #[test]
    fn meldung_frist_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { meldung_bestaetigung_frist_min: Some(10), ..e() };
        let o = OrgEinstellungen { meldung_bestaetigung_frist_min: Some(30), ..o() };
        assert_eq!(effektive_meldung_frist_min(&e, &o), Some(10));
    }

    #[test]
    fn meldung_frist_fallback_auf_org() {
        let o = OrgEinstellungen { meldung_bestaetigung_frist_min: Some(30), ..o() };
        assert_eq!(effektive_meldung_frist_min(&e(), &o), Some(30));
    }

    #[test]
    fn meldung_frist_beide_none_ist_none() {
        assert_eq!(effektive_meldung_frist_min(&e(), &o()), None);
    }

    // ── effektive_auftrag_quittierung_frist_min ───────────────────────────────

    #[test]
    fn auftrag_frist_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { auftrag_quittierung_frist_min: Some(15), ..e() };
        let o = OrgEinstellungen { auftrag_quittierung_frist_min: Some(45), ..o() };
        assert_eq!(effektive_auftrag_quittierung_frist_min(&e, &o), Some(15));
    }

    #[test]
    fn auftrag_frist_fallback_auf_org() {
        let o = OrgEinstellungen { auftrag_quittierung_frist_min: Some(45), ..o() };
        assert_eq!(effektive_auftrag_quittierung_frist_min(&e(), &o), Some(45));
    }

    #[test]
    fn auftrag_frist_beide_none_ist_none() {
        assert_eq!(effektive_auftrag_quittierung_frist_min(&e(), &o()), None);
    }

    // ── effektive_retention_dauer_tage ────────────────────────────────────────

    #[test]
    fn retention_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { retention_dauer_tage: Some(90), ..e() };
        let o = OrgEinstellungen { retention_dauer_tage: Some(365), ..o() };
        assert_eq!(effektive_retention_dauer_tage(&e, &o), Some(90));
    }

    #[test]
    fn retention_fallback_auf_org() {
        let o = OrgEinstellungen { retention_dauer_tage: Some(365), ..o() };
        assert_eq!(effektive_retention_dauer_tage(&e(), &o), Some(365));
    }

    #[test]
    fn retention_beide_none_ist_none() {
        assert_eq!(effektive_retention_dauer_tage(&e(), &o()), None);
    }

    // ── effektiv_auto_etb_aktiv ───────────────────────────────────────────────

    #[test]
    fn auto_etb_einsatz_an_schlaegt_org_aus() {
        let e = EinsatzEinstellungen { auto_etb_eintraege: Some(1), ..e() };
        let o = OrgEinstellungen { auto_etb_eintraege: Some(0), ..o() };
        assert!(effektiv_auto_etb_aktiv(&e, &o), "Einsatz=1 schlägt Org=0");
    }

    #[test]
    fn auto_etb_einsatz_aus_schlaegt_org_an() {
        let e = EinsatzEinstellungen { auto_etb_eintraege: Some(0), ..e() };
        let o = OrgEinstellungen { auto_etb_eintraege: Some(1), ..o() };
        assert!(!effektiv_auto_etb_aktiv(&e, &o), "Einsatz=0 schlägt Org=1");
    }

    #[test]
    fn auto_etb_einsatz_none_org_aus() {
        let o = OrgEinstellungen { auto_etb_eintraege: Some(0), ..o() };
        assert!(!effektiv_auto_etb_aktiv(&e(), &o), "Org=0 → aus");
    }

    #[test]
    fn auto_etb_beide_none_default_an() {
        assert!(
            effektiv_auto_etb_aktiv(&e(), &o()),
            "beide None → hartkodierter Default an"
        );
    }

    // ── effektive_zeitzone ────────────────────────────────────────────────────

    #[test]
    fn zeitzone_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { zeitzone: Some("UTC".into()), ..e() };
        let o = OrgEinstellungen { zeitzone: Some("Europe/Berlin".into()), ..o() };
        assert_eq!(effektive_zeitzone(&e, &o).as_deref(), Some("UTC"));
    }

    #[test]
    fn zeitzone_fallback_auf_org() {
        let o = OrgEinstellungen { zeitzone: Some("Europe/Berlin".into()), ..o() };
        assert_eq!(effektive_zeitzone(&e(), &o).as_deref(), Some("Europe/Berlin"));
    }

    #[test]
    fn zeitzone_beide_none_ist_none() {
        assert_eq!(effektive_zeitzone(&e(), &o()), None);
    }

    // ── effektive_zeitformat ──────────────────────────────────────────────────

    #[test]
    fn zeitformat_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { zeitformat: Some("12h".into()), ..e() };
        let o = OrgEinstellungen { zeitformat: Some("24h".into()), ..o() };
        assert_eq!(effektive_zeitformat(&e, &o).as_deref(), Some("12h"));
    }

    #[test]
    fn zeitformat_fallback_auf_org() {
        let o = OrgEinstellungen { zeitformat: Some("24h".into()), ..o() };
        assert_eq!(effektive_zeitformat(&e(), &o).as_deref(), Some("24h"));
    }

    #[test]
    fn zeitformat_beide_none_ist_none() {
        assert_eq!(effektive_zeitformat(&e(), &o()), None);
    }

    // ── effektive_einheiten ───────────────────────────────────────────────────

    #[test]
    fn einheiten_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { einheiten: Some("imperial".into()), ..e() };
        let o = OrgEinstellungen { einheiten: Some("metrisch".into()), ..o() };
        assert_eq!(effektive_einheiten(&e, &o).as_deref(), Some("imperial"));
    }

    #[test]
    fn einheiten_fallback_auf_org() {
        let o = OrgEinstellungen { einheiten: Some("metrisch".into()), ..o() };
        assert_eq!(effektive_einheiten(&e(), &o).as_deref(), Some("metrisch"));
    }

    #[test]
    fn einheiten_beide_none_ist_none() {
        assert_eq!(effektive_einheiten(&e(), &o()), None);
    }

    // ── effektive_koordinatenformat ───────────────────────────────────────────

    #[test]
    fn koordinatenformat_einsatz_schlaegt_org() {
        let e = EinsatzEinstellungen { koordinatenformat: Some("mgrs".into()), ..e() };
        let o = OrgEinstellungen { koordinatenformat: Some("wgs84".into()), ..o() };
        assert_eq!(effektive_koordinatenformat(&e, &o).as_deref(), Some("mgrs"));
    }

    #[test]
    fn koordinatenformat_fallback_auf_org() {
        let o = OrgEinstellungen { koordinatenformat: Some("wgs84".into()), ..o() };
        assert_eq!(effektive_koordinatenformat(&e(), &o).as_deref(), Some("wgs84"));
    }

    #[test]
    fn koordinatenformat_beide_none_ist_none() {
        assert_eq!(effektive_koordinatenformat(&e(), &o()), None);
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
