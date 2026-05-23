use super::{Einsatz, EinsatzRolle};
use crate::error::AppError;

/// Stellt sicher, dass der Benutzer Mitglied (irgendeine Einsatz-Rolle) ist.
/// Liefert die Rolle zurück oder `AppError::Forbidden` (kein Mitglied).
pub fn fordere_mitglied(rolle: Option<EinsatzRolle>) -> Result<EinsatzRolle, AppError> {
    rolle.ok_or(AppError::Forbidden)
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
    use crate::einsatz::{STATUS_ABGESCHLOSSEN, STATUS_AKTIV};

    fn einsatz_mit_status(status: &str) -> Einsatz {
        Einsatz {
            id: 1,
            org_id: 1,
            bezeichnung: "Lage".into(),
            stichwort: None,
            status: status.into(),
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
        }
    }

    #[test]
    fn fordere_mitglied_ohne_rolle_ist_forbidden() {
        let err = fordere_mitglied(None).unwrap_err();
        assert!(matches!(err, AppError::Forbidden));
    }

    #[test]
    fn fordere_mitglied_mit_rolle_liefert_rolle() {
        let r = fordere_mitglied(Some(EinsatzRolle::Beobachter)).unwrap();
        assert_eq!(r, EinsatzRolle::Beobachter);
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
}
