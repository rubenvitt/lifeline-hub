use super::modul::{ist_ausblendbar, registry_benoetigte_rolle};
use super::modul_override::EinsatzModulOverride;
use super::{modul_override, Einsatz, EinsatzRolle, STATUS_ABGESCHLOSSEN, STATUS_AKTIV};
use crate::auth::Benutzer;
use crate::einsatz::effektiv::effektive_modul_rolle;
use crate::error::AppError;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use sqlx::SqlitePool;
use std::collections::HashMap;

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

/// Ob die Aufbewahrungsfrist abgelaufen ist (`jetzt >= retention_bis`). `None`
/// (keine Frist) oder ein unparsebarer Wert → `false`: die Sperre greift nur bei
/// gültig gesetzter Frist. Der Aufrufer wertet dies bewusst nur für ABGESCHLOSSENE
/// Einsätze aus — aktive Einsätze werden nie retention-gesperrt.
pub fn retention_abgelaufen(retention_bis: Option<&str>, jetzt: DateTime<Utc>) -> bool {
    let Some(s) = retention_bis else {
        return false;
    };
    let Some(frist) = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|naive| naive.and_utc())
    else {
        return false;
    };
    jetzt >= frist
}

/// Ob `neu` gegenüber `alt` eine Verkürzung der Aufbewahrungsfrist darstellt
/// (der Sperr-Zeitpunkt wird vorverlegt) und daher eine Bestätigung erfordert:
/// - Aufheben der Frist (`neu = None`, unbegrenzt) ist nie eine Verkürzung.
/// - Setzen einer Frist auf einen bislang unbegrenzten Einsatz (`alt = None`) zählt
///   als Verkürzung (von „unendlich" auf endlich).
/// - Sonst: ein früherer Zeitpunkt ist eine Verkürzung. Vergleich lexikografisch —
///   korrekt für das feste, links-aufgefüllte Format `%Y-%m-%d %H:%M:%S`; beide
///   Werte sind über `normalisiere_zeit` vereinheitlicht.
pub fn ist_fristverkuerzung(alt: Option<&str>, neu: Option<&str>) -> bool {
    match (alt, neu) {
        (_, None) => false,
        (None, Some(_)) => true,
        (Some(a), Some(n)) => n < a,
    }
}

/// Reine Lese-Policy für Einsätze (DSGVO-Lesezugriff):
/// - Höhere Berechtigung (System-Admin oder Org-Führungskraft) darf jeden
///   Einsatz lesen, auch ohne Mitgliedschaft.
/// - Ohne Mitgliedschaft und ohne höhere Berechtigung: kein Zugriff.
/// - Aktiver Einsatz: jedes Mitglied (jede Rolle).
/// - Abgeschlossener Einsatz in der Schonfrist: jedes Mitglied.
/// - Abgeschlossener Einsatz nach der Schonfrist: nur die Einsatzleitung.
/// - Abgeschlossener Einsatz mit abgelaufener Aufbewahrungsfrist (`retention_bis`):
///   für NIEMANDEN lesbar, auch nicht für höhere Berechtigungen (DSGVO-Löschpflicht;
///   die Daten sind physisch noch da, der Purge folgt im Archiv-Feature). Greift nie
///   auf aktive Einsätze.
/// - Soft-Delete-Tombstone (`geloescht_at`, LFH-135): gesetzt → für NIEMANDEN lesbar,
///   vor allen anderen Checks (auch höhere Berechtigung, auch aktive Einsätze — der
///   Tombstone wird ausschließlich vom Purge auf abgeschlossene Einsätze gesetzt,
///   die Sperre ist aber bewusst statusunabhängig defensiv).
///
/// `jetzt` wird injiziert (Testbarkeit).
pub fn darf_lesen(
    benutzer: &Benutzer,
    status: &str,
    abgeschlossen_at: Option<&str>,
    retention_bis: Option<&str>,
    geloescht_at: Option<&str>,
    rolle: Option<EinsatzRolle>,
    jetzt: DateTime<Utc>,
) -> bool {
    // Soft-Delete-Tombstone → harte Sperre vor allen anderen Checks (auch höhere Berechtigung).
    if geloescht_at.is_some_and(|s| !s.is_empty()) {
        return false;
    }
    // Aufbewahrungsfrist abgelaufen → harte Sperre vor allen anderen Checks.
    if status == STATUS_ABGESCHLOSSEN && retention_abgelaufen(retention_bis, jetzt) {
        return false;
    }
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
        einsatz.status.as_str(),
        einsatz.abgeschlossen_at.as_deref(),
        einsatz.retention_bis.as_deref(),
        einsatz.geloescht_at.as_deref(),
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

/// Per-Handler-Guard für die Modul-Sichtbarkeit/Berechtigung (LFH-132). Rein und
/// testbar gegen die bereits geladenen Override-Maps eines Einsatzes.
///
/// Reihenfolge (additive Verschärfung NACH dem bestehenden Lese-/Schreibrecht-Gate;
/// loosened nie eine bestehende Schranke):
/// 1. System-Admin behält IMMER Zugriff (Mindest-Guard), unabhängig vom Override.
/// 2. Ausblenden: ist das Modul ausblendbar und der Override setzt `sichtbar=false`,
///    → `Forbidden`. Nicht-ausblendbare Module (einsatzdaten, einsatz-einstellungen)
///    werden NIE versteckt — ein `sichtbar=false` darauf wird defensiv ignoriert.
/// 3. Rollen-Schranke: effektive Rolle = Einsatz-Override ?? Org-Default ??
///    Registry-Default (heute `None` für alle). `admin` → nur System-Admin (oben schon
///    durch), sonst `Forbidden`; `fuehrungskraft` → System-Admin oder org-weite
///    Führungskraft (`ist_hoehere_berechtigung`), sonst `Forbidden`. `None` → frei.
pub fn fordere_modul_zugriff(
    overrides: &HashMap<String, EinsatzModulOverride>,
    org_defaults: &HashMap<String, Option<String>>,
    modul_key: &str,
    benutzer: &Benutzer,
) -> Result<(), AppError> {
    // 1. Admin-Mindest-Guard.
    if benutzer.ist_admin() {
        return Ok(());
    }

    // 2. Nicht-ausblendbare Module (Stammdaten, Einstellungen) sind NIE sperrbar —
    //    weder versteckt noch rollen-beschränkt (Selbst-Aussperr-Schutz, beide
    //    Dimensionen). Ein etwaiger Override darauf wird defensiv ignoriert.
    if !ist_ausblendbar(modul_key) {
        return Ok(());
    }

    let ueberschreibung = overrides.get(modul_key);

    // 3. Ausblend-Schranke.
    if ueberschreibung.is_some_and(|o| !o.sichtbar) {
        return Err(AppError::Forbidden);
    }

    // 4. Rollen-Schranke: Einsatz-Override ?? Org-Default ?? Registry-Default.
    let einsatz_override_rolle = ueberschreibung.and_then(|o| o.benoetigte_rolle.as_deref());
    let org_default = org_defaults.get(modul_key).and_then(|r| r.as_deref());
    let effektiv = effektive_modul_rolle(einsatz_override_rolle, org_default);
    let benoetigte = effektiv.as_deref().or_else(|| registry_benoetigte_rolle(modul_key));
    match benoetigte {
        Some("admin") => Err(AppError::Forbidden), // System-Admin ist oben bereits durch.
        Some("fuehrungskraft") => {
            if benutzer.ist_hoehere_berechtigung() {
                Ok(())
            } else {
                Err(AppError::Forbidden)
            }
        }
        _ => Ok(()),
    }
}

/// Async-Wrapper für Route-Handler: lädt Einsatz-Override-Map + Org-Modul-Defaults
/// aus der DB und ruft dann `fordere_modul_zugriff` auf.
///
/// Ersetzt in jedem Handler das Muster
/// `let overrides = modul_override::laden_alle(...); fordere_modul_zugriff(&overrides, ...)`
/// durch einen einzigen Aufruf.
pub async fn fordere_modul_zugriff_laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    modul_key: &str,
    benutzer: &Benutzer,
) -> Result<(), AppError> {
    let overrides = modul_override::laden_alle(pool, einsatz_id).await?;
    let org_defaults = crate::org::modul_einstellung::laden_alle(pool, org_id).await?;
    fordere_modul_zugriff(&overrides, &org_defaults, modul_key, benutzer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{
        OrgRolle, SystemRolle, ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
    };
    use crate::einsatz::{EinsatzStatus, STATUS_ABGESCHLOSSEN, STATUS_AKTIV};

    fn einsatz_mit_status(status: EinsatzStatus) -> Einsatz {
        Einsatz {
            id: 1,
            org_id: 1,
            org_name: "Orga".into(),
            bezeichnung: "Lage".into(),
            stichwort: None,
            status,
            begonnen_at: "2026-05-23".into(),
            abgeschlossen_at: None,
            abgeschlossen_von: None,
            einsatzart: crate::einsatz::Einsatzart::Realeinsatz,
            einsatznummer_intern: None,
            angelegt_at: "2026-05-23".into(),
            leitstellen_nr: None,
            einsatzort: None,
            einsatzort_lat: None,
            einsatzort_lon: None,
            meldende_stelle: None,
            sachverhalt: None,
            anzahl_betroffene_initial: None,
            retention_bis: None,
            geloescht_at: None,
        }
    }

    fn benutzer_mit(system_rolle: &str, org_rolle: &str) -> Benutzer {
        Benutzer {
            id: 1,
            org_id: 1,
            anzeigename: "Test".into(),
            benutzername: "test".into(),
            passwort_hash: "h".into(),
            system_rolle: SystemRolle::parse(system_rolle).unwrap(),
            org_rolle: OrgRolle::parse(org_rolle).unwrap(),
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
            None,
            None,
            Some(EinsatzRolle::Beobachter),
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_aktiv_nicht_mitglied_normal_ist_false() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(!darf_lesen(&b, STATUS_AKTIV, None, None, None, None, jetzt()));
    }

    #[test]
    fn darf_lesen_abgeschlossen_in_frist_beobachter_ist_true() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-25 11:00:00"),
            None,
            None,
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
            None,
            None,
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
            None,
            None,
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
            None,
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
            None,
            None,
            jetzt()
        ));
    }

    // --- Aufbewahrungsfrist (retention_bis), LFH-130 ---

    #[test]
    fn retention_abgelaufen_ohne_frist_ist_false() {
        assert!(!retention_abgelaufen(None, jetzt()));
    }

    #[test]
    fn retention_abgelaufen_in_zukunft_ist_false() {
        assert!(!retention_abgelaufen(Some("2026-05-26 12:00:00"), jetzt()));
    }

    #[test]
    fn retention_abgelaufen_in_vergangenheit_ist_true() {
        assert!(retention_abgelaufen(Some("2026-05-24 12:00:00"), jetzt()));
    }

    #[test]
    fn retention_abgelaufen_unparsebar_ist_false() {
        assert!(!retention_abgelaufen(Some("kaputt"), jetzt()));
    }

    #[test]
    fn darf_lesen_abgelaufene_frist_sperrt_einsatzleitung() {
        // Innerhalb der Nachlauffrist, aber Aufbewahrungsfrist abgelaufen → gesperrt.
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(!darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-25 11:00:00"),
            Some("2026-05-24 12:00:00"),
            None,
            Some(EinsatzRolle::Einsatzleitung),
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_abgelaufene_frist_sperrt_auch_admin() {
        // Höhere Berechtigung wird durch die abgelaufene Aufbewahrungsfrist überstimmt.
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(!darf_lesen(
            &admin,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-24 11:00:00"),
            Some("2026-05-24 12:00:00"),
            None,
            None,
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_abgelaufene_frist_greift_nicht_auf_aktive() {
        // Aktiver Einsatz: retention_bis wird ignoriert (Frist greift erst ab Abschluss).
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_AKTIV,
            None,
            Some("2026-05-24 12:00:00"),
            None,
            Some(EinsatzRolle::Beobachter),
            jetzt()
        ));
    }

    #[test]
    fn ist_fristverkuerzung_aufheben_ist_keine() {
        assert!(!ist_fristverkuerzung(Some("2026-06-01 00:00:00"), None));
        assert!(!ist_fristverkuerzung(None, None));
    }

    #[test]
    fn ist_fristverkuerzung_setzen_auf_unbegrenzt_ist_verkuerzung() {
        assert!(ist_fristverkuerzung(None, Some("2026-06-01 00:00:00")));
    }

    #[test]
    fn ist_fristverkuerzung_frueher_ist_verkuerzung_spaeter_nicht() {
        assert!(ist_fristverkuerzung(
            Some("2026-06-01 00:00:00"),
            Some("2026-05-01 00:00:00")
        ));
        assert!(!ist_fristverkuerzung(
            Some("2026-06-01 00:00:00"),
            Some("2026-07-01 00:00:00")
        ));
        assert!(!ist_fristverkuerzung(
            Some("2026-06-01 00:00:00"),
            Some("2026-06-01 00:00:00")
        ));
    }

    #[test]
    fn darf_lesen_gueltige_frist_erlaubt_lesen() {
        // Aufbewahrungsfrist in der Zukunft → normaler Zugriff (Einsatzleitung nach Schonfrist).
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-24 11:00:00"),
            Some("2026-06-24 12:00:00"),
            None,
            Some(EinsatzRolle::Einsatzleitung),
            jetzt()
        ));
    }

    // --- Soft-Delete-Tombstone (geloescht_at), LFH-135 ---

    #[test]
    fn darf_lesen_tombstone_sperrt_mitglied() {
        // Gesetzter geloescht_at-Tombstone sperrt selbst die Einsatzleitung eines
        // ansonsten frisch abgeschlossenen Einsatzes (gültige Frist, in Schonfrist).
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(!darf_lesen(
            &b,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-25 11:00:00"),
            Some("2026-06-24 12:00:00"),
            Some("2026-05-24 12:00:00"),
            Some(EinsatzRolle::Einsatzleitung),
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_tombstone_sperrt_auch_admin() {
        // Höhere Berechtigung wird durch den Tombstone überstimmt (vor allen Checks).
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(!darf_lesen(
            &admin,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-25 11:00:00"),
            None,
            Some("2026-05-24 12:00:00"),
            None,
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_tombstone_sperrt_auch_fuehrungskraft() {
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(!darf_lesen(
            &fk,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-25 11:00:00"),
            None,
            Some("2026-05-24 12:00:00"),
            None,
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_ohne_tombstone_unveraendert() {
        // Ungesetzter Tombstone (None) → Verhalten wie bisher (Mitglied liest aktiven Einsatz).
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            STATUS_AKTIV,
            None,
            None,
            None,
            Some(EinsatzRolle::Beobachter),
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
        assert!(fordere_aktiv(&einsatz_mit_status(EinsatzStatus::Aktiv)).is_ok());
        assert!(matches!(
            fordere_aktiv(&einsatz_mit_status(EinsatzStatus::Abgeschlossen)).unwrap_err(),
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

    // --- Modul-Zugriff-Guard (LFH-132) ---

    fn override_zeile(
        modul_key: &str,
        sichtbar: bool,
        benoetigte_rolle: Option<&str>,
    ) -> EinsatzModulOverride {
        EinsatzModulOverride {
            einsatz_id: 1,
            modul_key: modul_key.into(),
            sichtbar,
            benoetigte_rolle: benoetigte_rolle.map(str::to_string),
            geaendert_at: None,
            geaendert_von: None,
        }
    }

    fn overrides_mit(zeilen: Vec<EinsatzModulOverride>) -> HashMap<String, EinsatzModulOverride> {
        zeilen.into_iter().map(|o| (o.modul_key.clone(), o)).collect()
    }

    fn leere_org_defaults() -> HashMap<String, Option<String>> {
        HashMap::new()
    }

    fn org_defaults_mit(modul_key: &str, rolle: Option<&str>) -> HashMap<String, Option<String>> {
        let mut m = HashMap::new();
        m.insert(modul_key.to_string(), rolle.map(str::to_string));
        m
    }

    #[test]
    fn modul_zugriff_ohne_override_ist_frei() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let leer = HashMap::new();
        assert!(fordere_modul_zugriff(&leer, &leere_org_defaults(), "etb", &normal).is_ok());
    }

    #[test]
    fn modul_zugriff_versteckt_blockt_normalen_benutzer() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let ov = overrides_mit(vec![override_zeile("etb", false, None)]);
        assert!(matches!(
            fordere_modul_zugriff(&ov, &leere_org_defaults(), "etb", &normal).unwrap_err(),
            AppError::Forbidden
        ));
    }

    #[test]
    fn modul_zugriff_admin_kommt_immer_durch() {
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        // Selbst bei versteckt + admin-Rolle erforderlich: Admin-Mindest-Guard.
        let ov = overrides_mit(vec![override_zeile("etb", false, Some("admin"))]);
        assert!(fordere_modul_zugriff(&ov, &leere_org_defaults(), "etb", &admin).is_ok());
    }

    #[test]
    fn modul_zugriff_rolle_fuehrungskraft_blockt_normalen_erlaubt_fuehrungskraft() {
        let ov = overrides_mit(vec![override_zeile("etb", true, Some("fuehrungskraft"))]);
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(matches!(
            fordere_modul_zugriff(&ov, &leere_org_defaults(), "etb", &normal).unwrap_err(),
            AppError::Forbidden
        ));
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(fordere_modul_zugriff(&ov, &leere_org_defaults(), "etb", &fk).is_ok());
    }

    #[test]
    fn modul_zugriff_rolle_admin_blockt_auch_fuehrungskraft() {
        let ov = overrides_mit(vec![override_zeile("etb", true, Some("admin"))]);
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(matches!(
            fordere_modul_zugriff(&ov, &leere_org_defaults(), "etb", &fk).unwrap_err(),
            AppError::Forbidden
        ));
    }

    #[test]
    fn modul_zugriff_nicht_ausblendbar_ignoriert_versteckt() {
        // einsatzdaten/einsatz-einstellungen dürfen nie versteckt werden — ein
        // sichtbar=false darauf wird defensiv ignoriert (Selbst-Aussperr-Schutz).
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        for key in ["einsatzdaten", "einsatz-einstellungen"] {
            let ov = overrides_mit(vec![override_zeile(key, false, None)]);
            assert!(
                fordere_modul_zugriff(&ov, &leere_org_defaults(), key, &normal).is_ok(),
                "{key} darf nicht versteckt werden"
            );
        }
    }

    #[test]
    fn modul_zugriff_nicht_ausblendbar_nie_rollen_gesperrt() {
        // Nicht-ausblendbare Module sind in BEIDEN Dimensionen exempt: ein (defensiv
        // ohnehin abgelehnter) Rollen-Override darf niemanden aussperren — sonst
        // könnte sich eine Einsatzleitung aus den Einstellungen selbst aussperren.
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let ov = overrides_mit(vec![override_zeile(
            "einsatz-einstellungen",
            false,
            Some("fuehrungskraft"),
        )]);
        assert!(fordere_modul_zugriff(&ov, &leere_org_defaults(), "einsatz-einstellungen", &normal).is_ok());
    }

    // --- Org-Default-Tests (Task 11) ---

    #[test]
    fn modul_zugriff_org_default_fuehrungskraft_blockt_normal() {
        // Kein Einsatz-Override, aber Org-Default „etb → fuehrungskraft":
        // normaler Benutzer ohne Führungskraft-Rolle bekommt 403.
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let leer = HashMap::new();
        let org = org_defaults_mit("etb", Some("fuehrungskraft"));
        assert!(matches!(
            fordere_modul_zugriff(&leer, &org, "etb", &normal).unwrap_err(),
            AppError::Forbidden
        ));
        // Führungskraft kommt durch.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(fordere_modul_zugriff(&leer, &org, "etb", &fk).is_ok());
    }

    #[test]
    fn modul_zugriff_einsatz_override_schlaegt_org_default() {
        // Einsatz-Override „etb → admin" schlägt Org-Default „etb → fuehrungskraft":
        // Führungskraft ist NICHT Admin → 403.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        let ov = overrides_mit(vec![override_zeile("etb", true, Some("admin"))]);
        let org = org_defaults_mit("etb", Some("fuehrungskraft"));
        assert!(matches!(
            fordere_modul_zugriff(&ov, &org, "etb", &fk).unwrap_err(),
            AppError::Forbidden
        ));
    }

    #[test]
    fn modul_zugriff_kein_override_kein_org_default_frei() {
        // Weder Einsatz-Override noch Org-Default → frei (Registry-Default = None).
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let leer: HashMap<String, EinsatzModulOverride> = HashMap::new();
        assert!(fordere_modul_zugriff(&leer, &leere_org_defaults(), "etb", &normal).is_ok());
    }

    #[test]
    fn modul_zugriff_org_default_null_rolle_ist_frei() {
        // Org-Default mit explizit NULL-Rolle (Some(None) im HashMap) → kein Rollenzwang.
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let leer: HashMap<String, EinsatzModulOverride> = HashMap::new();
        let org = org_defaults_mit("etb", None); // NULL in DB: Some(None) in Map
        assert!(fordere_modul_zugriff(&leer, &org, "etb", &normal).is_ok());
    }

    #[test]
    fn modul_zugriff_nicht_ausblendbar_ignoriert_org_default() {
        // Org-Default auf nicht-ausblendbarem Modul darf nicht aussperren
        // (gleicher Selbst-Aussperr-Schutz wie bei Einsatz-Override).
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let leer: HashMap<String, EinsatzModulOverride> = HashMap::new();
        let org = org_defaults_mit("einsatz-einstellungen", Some("fuehrungskraft"));
        assert!(
            fordere_modul_zugriff(&leer, &org, "einsatz-einstellungen", &normal).is_ok(),
            "Org-Default darf nicht-ausblendbares Modul nicht sperren"
        );
    }

    // --- Integrationstest: DB + Guard-Kette (Task 11) ---

    #[tokio::test]
    async fn org_default_fuehrungskraft_blockt_normal_via_db() {
        let pool = crate::db::test_pool().await;

        // Org + Benutzer anlegen und Modul-Default setzen.
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'TestOrg')")
            .execute(&pool)
            .await
            .unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'a', 'a', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        crate::org::modul_einstellung::setzen(&pool, 1, "etb", Some("fuehrungskraft"), bid)
            .await
            .unwrap();

        // Org-Defaults laden (DB-Integration).
        let org_defaults = crate::org::modul_einstellung::laden_alle(&pool, 1).await.unwrap();

        // Leere Einsatz-Override-Map.
        let leer: HashMap<String, EinsatzModulOverride> = HashMap::new();

        // Normaler Benutzer → 403.
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(matches!(
            fordere_modul_zugriff(&leer, &org_defaults, "etb", &normal).unwrap_err(),
            AppError::Forbidden
        ));

        // Führungskraft → OK.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(fordere_modul_zugriff(&leer, &org_defaults, "etb", &fk).is_ok());

        // Admin → OK (Mindest-Guard).
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(fordere_modul_zugriff(&leer, &org_defaults, "etb", &admin).is_ok());
    }
}
