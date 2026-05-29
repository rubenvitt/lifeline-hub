use super::{Einsatz, EinsatzRolle, STATUS_AKTIV};
use crate::auth::Benutzer;
use crate::error::AppError;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};

/// DSGVO-Schonfrist in Stunden: solange bleibt ein abgeschlossener Einsatz
/// für alle Mitglieder lesbar; danach nur noch für höhere Berechtigungen.
pub const NACHLAUF_STUNDEN: i64 = 24;

/// Ob ein abgeschlossener Einsatz noch in der Schonfrist liegt. Fehlt der
/// Zeitstempel oder ist er unparsebar, wird konservativ `false` geliefert.
pub fn ist_in_nachlauffrist(abgeschlossen_at: Option<&str>, jetzt: DateTime<Utc>) -> bool {
    let Some(s) = abgeschlossen_at else {
        return false;
    };
    let Some(abgeschlossen) = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|naive| naive.and_utc())
    else {
        return false;
    };
    jetzt - abgeschlossen < Duration::hours(NACHLAUF_STUNDEN)
}

/// Reine Lese-Policy für Einsätze (DSGVO-Lesezugriff):
/// - Höhere Berechtigung (System-Admin oder Org-Führungskraft) darf jeden
///   Einsatz lesen, auch ohne Mitgliedschaft.
/// - Ohne Mitgliedschaft und ohne höhere Berechtigung: kein Zugriff.
/// - Aktiver Einsatz: jedes Mitglied (jede Rolle).
/// - Abgeschlossener Einsatz in der Schonfrist: jedes Mitglied.
/// - Abgeschlossener Einsatz nach der Schonfrist: nur die Einsatzleitung.
///
/// `jetzt` wird injiziert (Testbarkeit).
pub fn darf_lesen(
    benutzer: &Benutzer,
    status: &str,
    abgeschlossen_at: Option<&str>,
    rolle: Option<EinsatzRolle>,
    jetzt: DateTime<Utc>,
) -> bool {
    if benutzer.ist_hoehere_berechtigung() {
        return true;
    }
    let Some(rolle) = rolle else {
        return false;
    };
    if status == STATUS_AKTIV || ist_in_nachlauffrist(abgeschlossen_at, jetzt) {
        return true;
    }
    rolle.ist_einsatzleitung()
}

/// Handler-Gate: liefert `Forbidden`, wenn der Benutzer den Einsatz nicht lesen darf.
pub fn fordere_lesezugriff(
    benutzer: &Benutzer,
    einsatz: &Einsatz,
    rolle: Option<EinsatzRolle>,
) -> Result<(), AppError> {
    if darf_lesen(
        benutzer,
        &einsatz.status,
        einsatz.abgeschlossen_at.as_deref(),
        rolle,
        Utc::now(),
    ) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Stellt sicher, dass der Benutzer die Einsatzleitung ist.
/// `Forbidden`, wenn keine Mitgliedschaft oder andere Rolle.
pub fn fordere_einsatzleitung(rolle: Option<EinsatzRolle>) -> Result<(), AppError> {
    match rolle {
        Some(r) if r.ist_einsatzleitung() => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

/// Stellt sicher, dass der Benutzer im Einsatz schreibberechtigt ist
/// (Einsatzleitung oder Führungspersonal). `Forbidden` bei Beobachter
/// oder fehlender Mitgliedschaft.
pub fn fordere_schreibrecht(rolle: Option<EinsatzRolle>) -> Result<(), AppError> {
    match rolle {
        Some(r) if r.darf_schreiben() => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

/// Gate der PATCH-Kopfdaten-Route: Einsatz-Schreibrecht (Einsatzleitung oder
/// Führungspersonal) ODER System-Admin (`system_rolle == admin`). Bewusst
/// lokal zu dieser Route — `fordere_schreibrecht` (ETB) bleibt unberührt, und
/// die Admin-Erlaubnis gilt NICHT für org-weite Führungskräfte ohne Mitgliedschaft.
pub fn fordere_schreibrecht_oder_admin(
    benutzer: &Benutzer,
    rolle: Option<EinsatzRolle>,
) -> Result<(), AppError> {
    if benutzer.ist_admin() {
        return Ok(());
    }
    fordere_schreibrecht(rolle)
}

/// Stellt sicher, dass der Einsatz noch aktiv (beschreibbar) ist.
/// `Conflict` (409) bei abgeschlossenem (read-only) Einsatz.
pub fn fordere_aktiv(einsatz: &Einsatz) -> Result<(), AppError> {
    if einsatz.ist_aktiv() {
        Ok(())
    } else {
        Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER};
    use crate::einsatz::{STATUS_ABGESCHLOSSEN, STATUS_AKTIV};

    fn einsatz_mit_status(status: &str) -> Einsatz {
        Einsatz {
            id: 1,
            org_id: 1,
            org_name: "Orga".into(),
            bezeichnung: "Lage".into(),
            stichwort: None,
            status: status.into(),
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
            einsatzart: crate::einsatz::EINSATZART_REALEINSATZ.into(),
            einsatznummer_intern: None,
            angelegt_at: "2026-05-23".into(),
            leitstellen_nr: None,
            einsatzort: None,
            einsatzort_lat: None,
            einsatzort_lon: None,
            meldende_stelle: None,
            sachverhalt: None,
            anzahl_betroffene_initial: None,
        }
    }

    fn benutzer_mit(system_rolle: &str, org_rolle: &str) -> Benutzer {
        Benutzer {
            id: 1,
            org_id: 1,
            anzeigename: "Test".into(),
            benutzername: "test".into(),
            passwort_hash: "h".into(),
            system_rolle: system_rolle.into(),
            org_rolle: org_rolle.into(),
            aktiv: true,
            erstellt_at: "2026-05-23".into(),
        }
    }

    /// Fester Referenzzeitpunkt für die Zeit-abhängigen Tests.
    fn jetzt() -> DateTime<Utc> {
        NaiveDateTime::parse_from_str("2026-05-25 12:00:00", "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
    }

    #[test]
    fn ist_in_nachlauffrist_innerhalb_ist_true() {
        // 1 Stunde vor jetzt abgeschlossen -> in der 24h-Frist.
        assert!(ist_in_nachlauffrist(Some("2026-05-25 11:00:00"), jetzt()));
    }

    #[test]
    fn ist_in_nachlauffrist_ausserhalb_ist_false() {
        // 25 Stunden vor jetzt abgeschlossen -> außerhalb der 24h-Frist.
        assert!(!ist_in_nachlauffrist(Some("2026-05-24 11:00:00"), jetzt()));
    }

    #[test]
    fn ist_in_nachlauffrist_ohne_zeitstempel_ist_false() {
        assert!(!ist_in_nachlauffrist(None, jetzt()));
    }

    #[test]
    fn ist_in_nachlauffrist_unparsebar_ist_false() {
        assert!(!ist_in_nachlauffrist(Some("kaputt"), jetzt()));
    }

    #[test]
    fn darf_lesen_aktiv_mitglied_ist_true() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_AKTIV,
            None,
            Some(EinsatzRolle::Beobachter),
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_aktiv_nicht_mitglied_normal_ist_false() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(!darf_lesen(&b, STATUS_AKTIV, None, None, jetzt()));
    }

    #[test]
    fn darf_lesen_abgeschlossen_in_frist_beobachter_ist_true() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-25 11:00:00"),
            Some(EinsatzRolle::Beobachter),
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_abgeschlossen_nach_frist_beobachter_ist_false() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(!darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-24 11:00:00"),
            Some(EinsatzRolle::Beobachter),
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_abgeschlossen_nach_frist_einsatzleitung_ist_true() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-24 11:00:00"),
            Some(EinsatzRolle::Einsatzleitung),
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_abgeschlossen_nach_frist_nicht_mitglied_admin_ist_true() {
        let b = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-24 11:00:00"),
            None,
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_abgeschlossen_nach_frist_nicht_mitglied_fuehrungskraft_ist_true() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-24 11:00:00"),
            None,
            jetzt()
        ));
    }

    #[test]
    fn fordere_einsatzleitung_nur_fuer_leitung() {
        assert!(fordere_einsatzleitung(Some(EinsatzRolle::Einsatzleitung)).is_ok());
        assert!(matches!(
            fordere_einsatzleitung(Some(EinsatzRolle::Fuehrungspersonal)).unwrap_err(),
            AppError::Forbidden
        ));
        assert!(matches!(
            fordere_einsatzleitung(None).unwrap_err(),
            AppError::Forbidden
        ));
    }

    #[test]
    fn fordere_schreibrecht_blockt_beobachter_und_fremde() {
        assert!(fordere_schreibrecht(Some(EinsatzRolle::Einsatzleitung)).is_ok());
        assert!(fordere_schreibrecht(Some(EinsatzRolle::Fuehrungspersonal)).is_ok());
        assert!(matches!(
            fordere_schreibrecht(Some(EinsatzRolle::Beobachter)).unwrap_err(),
            AppError::Forbidden
        ));
        assert!(matches!(
            fordere_schreibrecht(None).unwrap_err(),
            AppError::Forbidden
        ));
    }

    #[test]
    fn fordere_aktiv_blockt_abgeschlossene() {
        assert!(fordere_aktiv(&einsatz_mit_status(STATUS_AKTIV)).is_ok());
        assert!(matches!(
            fordere_aktiv(&einsatz_mit_status(STATUS_ABGESCHLOSSEN)).unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[test]
    fn schreibrecht_oder_admin_erlaubt_admin_ohne_rolle() {
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(fordere_schreibrecht_oder_admin(&admin, None).is_ok());
    }

    #[test]
    fn schreibrecht_oder_admin_erlaubt_schreibberechtigte_rollen() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Einsatzleitung)).is_ok());
        assert!(fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Fuehrungspersonal)).is_ok());
    }

    #[test]
    fn schreibrecht_oder_admin_blockt_beobachter_und_fremde_ohne_admin() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(matches!(
            fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Beobachter)).unwrap_err(),
            AppError::Forbidden
        ));
        assert!(matches!(
            fordere_schreibrecht_oder_admin(&normal, None).unwrap_err(),
            AppError::Forbidden
        ));
        // Org-Führungskraft ohne Mitgliedschaft ist KEIN System-Admin → blockiert.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(matches!(
            fordere_schreibrecht_oder_admin(&fk, None).unwrap_err(),
            AppError::Forbidden
        ));
    }
}
