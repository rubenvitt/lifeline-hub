use super::modul::ist_ausblendbar;
use super::modul_override::EinsatzModulOverride;
use super::{modul_override, Einsatz, EinsatzRolle, STATUS_ABGESCHLOSSEN, STATUS_AKTIV};
use crate::auth::Benutzer;
use crate::einsatz::effektiv::effektive_modul_rolle;
use crate::error::AppError;
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;

/// DSGVO-Schonfrist in Stunden: solange bleibt ein abgeschlossener Einsatz
/// für alle Mitglieder lesbar; danach nur noch für höhere Berechtigungen.
pub const NACHLAUF_STUNDEN: i64 = 24;

/// Ob ein abgeschlossener Einsatz noch in der Schonfrist liegt. Fehlt der
/// Zeitstempel oder ist er unparsebar, wird konservativ `false` geliefert.
pub fn ist_in_nachlauffrist(abgeschlossen_at: Option<&str>, jetzt: DateTime<Utc>) -> bool {
    let Some(s) = abgeschlossen_at else {
        return false;
    };
    let Some(abgeschlossen) = crate::zeit::parse_utc(s) else {
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
    let Some(frist) = crate::zeit::parse_utc(s) else {
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
/// - System-Admin (serverweit): darf jeden Einsatz lesen, auch org-übergreifend und
///   ohne Mitgliedschaft. Org-weite Führungskraft: jeden Einsatz der EIGENEN
///   Organisation (`einsatz_org_id == benutzer.org_id`) ohne Mitgliedschaft — aber
///   KEINE fremden Orgs (LFH-115, via [`crate::auth::Benutzer::darf_fremdeinsatz_lesen`]).
/// - Ohne Mitgliedschaft und ohne diesen Fremdeinsatz-Lesezugriff: kein Zugriff.
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
    einsatz_org_id: i64,
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
    if benutzer.darf_fremdeinsatz_lesen(einsatz_org_id) {
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
        einsatz.org_id,
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

/// Org-Isolations-Floor (LFH-121): der minimale, un-vergessliche Zugriffs-Boden für
/// JEDEN einsatz-gebundenen Handler — gedacht, um vom `EinsatzKontext`-Extractor VOR
/// jedem `/api/einsaetze/{id}/…`-Handler erzwungen zu werden, damit die Cross-Org-Lücke
/// (LFH-115) strukturell nicht mehr „vergessen" werden kann.
///
/// Erlaubt, wenn der Benutzer Mitglied ist (`rolle.is_some()`) ODER den Einsatz als
/// höhere Berechtigung fremd lesen darf ([`Benutzer::darf_fremdeinsatz_lesen`]:
/// System-Admin serverweit, org-weite Führungskraft nur in der EIGENEN Org). Sonst
/// `Forbidden`.
///
/// BEWUSST schwächer als [`fordere_lesezugriff`]: dieser Floor erzwingt KEINE
/// DSGVO-Zeit-Policy (Nachlauffrist/Aufbewahrungsfrist/Tombstone) — die bleibt
/// handler-lokal über `fordere_lesezugriff`. Nur so kann der Extractor den Floor
/// pauschal ziehen, ohne den Sonderfall `aufbewahrungsfrist_setzen` auszusperren
/// (Admin/Einsatzleitung verlängert reaktiv die Frist eines bereits abgelaufenen
/// Einsatzes — dort sperrt `darf_lesen` hart, auch höhere Berechtigung).
pub fn fordere_org_zugehoerigkeit(
    benutzer: &Benutzer,
    einsatz_org_id: i64,
    rolle: Option<EinsatzRolle>,
) -> Result<(), AppError> {
    if rolle.is_some() || benutzer.darf_fremdeinsatz_lesen(einsatz_org_id) {
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

/// Die effektive Modulfreigabe eines Benutzers für ein Modul (LFH-669) — Antwort von
/// `GET /api/einsaetze/{id}/modul-freigaben` und die EINE Auswertung hinter
/// [`fordere_modul_zugriff`] und [`erlaubte_module`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct ModulFreigabe {
    /// Das Modul erscheint in der Navigation. `false` nur, wenn der Einsatz ein ausblendbares
    /// Modul ausblendet — auch für System-Admins, die es dennoch erreichen (`zugriff`).
    pub sichtbar: bool,
    /// Der Benutzer darf die Endpunkte des Moduls aufrufen: genau die Entscheidung des
    /// Modul-Gates der Listen-Endpunkte.
    pub zugriff: bool,
}

/// Reine Auswertung der Modul-Sichtbarkeit/Berechtigung (LFH-132, LFH-669) gegen die bereits
/// geladenen Override-Maps eines Einsatzes.
///
/// `zugriff` — Reihenfolge (additive Verschärfung NACH dem bestehenden Lese-/Schreibrecht-Gate;
/// loosened nie eine bestehende Schranke):
/// 1. System-Admin behält IMMER Zugriff (Mindest-Guard), unabhängig vom Override.
/// 2. Nicht-ausblendbare Module (Stammdaten, Einstellungen) sind NIE sperrbar — weder
///    versteckt noch rollen-beschränkt (Selbst-Aussperr-Schutz, beide Dimensionen). Ein
///    etwaiger Override darauf wird defensiv ignoriert.
/// 3. Ausblenden: Override `sichtbar=false` → kein Zugriff.
/// 4. Rollen-Schranke: effektive Rolle = Einsatz-Override ?? Org-Default. `admin` → nur
///    System-Admin (oben schon durch); `fuehrungskraft` → System-Admin oder org-weite
///    Führungskraft (`ist_hoehere_berechtigung`). `None` → frei.
///
/// `sichtbar` hängt bewusst NICHT am Admin: ein ausgeblendetes Modul steht auch für ihn in
/// keiner Navigation (das bisherige Client-Verhalten), erreichbar bleibt es über `zugriff`.
pub fn modul_freigabe(
    overrides: &HashMap<String, EinsatzModulOverride>,
    org_defaults: &HashMap<String, Option<String>>,
    modul_key: &str,
    benutzer: &Benutzer,
) -> ModulFreigabe {
    if !ist_ausblendbar(modul_key) {
        return ModulFreigabe {
            sichtbar: true,
            zugriff: true,
        };
    }
    let ueberschreibung = overrides.get(modul_key);
    let sichtbar = ueberschreibung.is_none_or(|o| o.sichtbar);
    if benutzer.ist_admin() {
        return ModulFreigabe {
            sichtbar,
            zugriff: true,
        };
    }
    if !sichtbar {
        return ModulFreigabe {
            sichtbar,
            zugriff: false,
        };
    }
    let einsatz_override_rolle = ueberschreibung.and_then(|o| o.benoetigte_rolle.as_deref());
    let org_default = org_defaults.get(modul_key).and_then(|r| r.as_deref());
    let zugriff = match effektive_modul_rolle(einsatz_override_rolle, org_default).as_deref() {
        Some("admin") => false, // System-Admin ist oben bereits durch.
        Some("fuehrungskraft") => benutzer.ist_hoehere_berechtigung(),
        _ => true,
    };
    ModulFreigabe { sichtbar, zugriff }
}

/// Per-Handler-Guard für die Modul-Berechtigung (LFH-132): `Forbidden`, wenn
/// [`modul_freigabe`] keinen Zugriff gibt.
pub fn fordere_modul_zugriff(
    overrides: &HashMap<String, EinsatzModulOverride>,
    org_defaults: &HashMap<String, Option<String>>,
    modul_key: &str,
    benutzer: &Benutzer,
) -> Result<(), AppError> {
    if modul_freigabe(overrides, org_defaults, modul_key, benutzer).zugriff {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Lädt die beiden Eingaben der Modulregel: Einsatz-Override-Map und Org-Modul-Defaults.
///
/// Bewusst uncached (LFH-230): Autorisierungs-Daten; ein Rechte-Entzug muss sofort
/// greifen. Override-/Org-Default-Maps sind auf je eine Zeile pro Modul-Key gedeckelt
/// (PK `(einsatz_id, modul_key)` / `(org_id, modul_key)`) — ein Per-Request-Cache
/// spart nichts (kein Handler zieht das Gate doppelt), ein App-Cache tauschte den
/// korrektheits-neutralen Read gegen eine Invalidierungs-Angriffsfläche.
async fn lade_modul_regeln(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
) -> Result<
    (
        HashMap<String, EinsatzModulOverride>,
        HashMap<String, Option<String>>,
    ),
    AppError,
> {
    let overrides = modul_override::laden_alle(pool, einsatz_id).await?;
    let org_defaults = crate::org::modul_einstellung::laden_alle(pool, org_id).await?;
    Ok((overrides, org_defaults))
}

/// Async-Wrapper für Route-Handler: lädt die Modulregeln aus der DB und ruft dann
/// `fordere_modul_zugriff` auf.
pub async fn fordere_modul_zugriff_laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    modul_key: &str,
    benutzer: &Benutzer,
) -> Result<(), AppError> {
    let (overrides, org_defaults) = lade_modul_regeln(pool, einsatz_id, org_id).await?;
    fordere_modul_zugriff(&overrides, &org_defaults, modul_key, benutzer)
}

/// Die Freigabe JEDES Modul-Keys ([`super::modul::MODUL_KEYS`]) für `benutzer` in diesem
/// Einsatz (LFH-669): die Auskunft, nach der der Client Module zeigt und Daten lädt, statt
/// die Regel nachzubauen (ihm fehlen die Org-Defaults).
pub async fn modul_freigaben(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer: &Benutzer,
) -> Result<HashMap<&'static str, ModulFreigabe>, AppError> {
    let (overrides, org_defaults) = lade_modul_regeln(pool, einsatz_id, org_id).await?;
    Ok(super::modul::MODUL_KEYS
        .iter()
        .map(|key| {
            (
                *key,
                modul_freigabe(&overrides, &org_defaults, key, benutzer),
            )
        })
        .collect())
}

/// Die Modul-Keys, die `benutzer` in diesem Einsatz sehen darf — [`modul_freigaben`] mit
/// `zugriff`.
///
/// Konsumenten: der Event-Filter des Live-Feeds (F01/LFH-227) und die Modulzähler
/// (LFH-612) — beide gehören keinem Modul und lassen die Modulrechte als FILTER wirken,
/// nicht als Türsteher. Eine zweite Auswertung der Rangfolge daneben wäre die Stelle, an
/// der ein Zähler ein Modul verriete, das die Liste mit 403 abweist.
pub async fn erlaubte_module(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer: &Benutzer,
) -> Result<HashSet<&'static str>, AppError> {
    Ok(modul_freigaben(pool, einsatz_id, org_id, benutzer)
        .await?
        .into_iter()
        .filter(|(_, f)| f.zugriff)
        .map(|(key, _)| key)
        .collect())
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
            pegel_festgelegt: false,
            evakuierung_angeordnet: false,
            bezeichnung: "Lage".into(),
            stichwort: None,
            status,
            begonnen_at: "2026-05-23".into(),
            naechste_lagebesprechung_at: None,
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
        crate::zeit::parse_utc("2026-05-25 12:00:00").unwrap()
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
            1,
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
        assert!(!darf_lesen(
            &b,
            1,
            STATUS_AKTIV,
            None,
            None,
            None,
            None,
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_abgeschlossen_in_frist_beobachter_ist_true() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &b,
            1,
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
            1,
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
            1,
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
            1,
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
            1,
            STATUS_ABGESCHLOSSEN,
            Some("2026-05-24 11:00:00"),
            None,
            None,
            None,
            jetzt()
        ));
    }

    // --- Org-Isolation beim Lesen (LFH-115) ---
    // benutzer_mit(...) hat org_id = 1; variiert wird der einsatz_org_id-Parameter (2. Argument).

    #[test]
    fn darf_lesen_fuehrungskraft_eigene_org_ist_true() {
        // Org-Führungskraft (org_id=1) darf einen Einsatz der eigenen Org auch ohne Mitgliedschaft lesen.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(darf_lesen(
            &fk,
            1,
            STATUS_AKTIV,
            None,
            None,
            None,
            None,
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_fuehrungskraft_fremde_org_ohne_mitgliedschaft_ist_false() {
        // Die geschlossene Org-Isolations-Lücke: Führungskraft aus Org 1 darf einen
        // Einsatz aus Org 2 ohne Mitgliedschaft NICHT lesen.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(!darf_lesen(
            &fk,
            2,
            STATUS_AKTIV,
            None,
            None,
            None,
            None,
            jetzt()
        ));
    }

    #[test]
    fn darf_lesen_admin_fremde_org_ist_true() {
        // System-Admin bleibt serverweit: liest auch Einsätze fremder Orgs (Carve-out).
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(darf_lesen(
            &admin,
            2,
            STATUS_AKTIV,
            None,
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
            1,
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
            1,
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
            1,
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
            1,
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
            1,
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
            1,
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
            1,
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
            1,
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
        assert!(
            fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Einsatzleitung)).is_ok()
        );
        assert!(
            fordere_schreibrecht_oder_admin(&normal, Some(EinsatzRolle::Fuehrungspersonal)).is_ok()
        );
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

    // --- Org-Isolations-Floor (LFH-121) ---

    #[test]
    fn org_zugehoerigkeit_mitglied_ok() {
        // Mitgliedschaft (rolle Some) genügt — auch für einen Einsatz einer fremden Org.
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE); // org_id = 1
        assert!(fordere_org_zugehoerigkeit(&b, 1, Some(EinsatzRolle::Beobachter)).is_ok());
        assert!(fordere_org_zugehoerigkeit(&b, 2, Some(EinsatzRolle::Beobachter)).is_ok());
    }

    #[test]
    fn org_zugehoerigkeit_admin_fremde_org_ok() {
        // System-Admin: serverweit, ohne Mitgliedschaft, auch org-übergreifend.
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        assert!(fordere_org_zugehoerigkeit(&admin, 2, None).is_ok());
    }

    #[test]
    fn org_zugehoerigkeit_fuehrungskraft_eigene_org_ok() {
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT); // org_id = 1
        assert!(fordere_org_zugehoerigkeit(&fk, 1, None).is_ok());
    }

    #[test]
    fn org_zugehoerigkeit_fuehrungskraft_fremde_org_forbidden() {
        // Die Kern-Invariante gegen die Cross-Org-Lücke (LFH-115): org-weite
        // Führungskraft aus Org 1 hat an einem Einsatz aus Org 2 ohne Mitgliedschaft
        // nichts verloren.
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        assert!(matches!(
            fordere_org_zugehoerigkeit(&fk, 2, None).unwrap_err(),
            AppError::Forbidden
        ));
    }

    #[test]
    fn org_zugehoerigkeit_nicht_mitglied_normal_forbidden() {
        let b = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        assert!(matches!(
            fordere_org_zugehoerigkeit(&b, 1, None).unwrap_err(),
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
        zeilen
            .into_iter()
            .map(|o| (o.modul_key.clone(), o))
            .collect()
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
        assert!(fordere_modul_zugriff(
            &ov,
            &leere_org_defaults(),
            "einsatz-einstellungen",
            &normal
        )
        .is_ok());
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
        // Weder Einsatz-Override noch Org-Default → frei.
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

    // --- Modulfreigabe je Benutzer (LFH-669) ---

    fn freigabe(sichtbar: bool, zugriff: bool) -> ModulFreigabe {
        ModulFreigabe { sichtbar, zugriff }
    }

    #[test]
    fn freigabe_ohne_override_und_org_default_ist_frei() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let leer = overrides_mit(vec![]);
        assert_eq!(
            modul_freigabe(&leer, &leere_org_defaults(), "schaeden", &normal),
            freigabe(true, true)
        );
    }

    #[test]
    fn freigabe_org_default_fuehrungskraft_sperrt_mitglied() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let leer = overrides_mit(vec![]);
        let org = org_defaults_mit("schaeden", Some("fuehrungskraft"));
        assert_eq!(
            modul_freigabe(&leer, &org, "schaeden", &normal),
            freigabe(true, false)
        );
    }

    #[test]
    fn freigabe_org_default_fuehrungskraft_laesst_fuehrungskraft_durch() {
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        let leer = overrides_mit(vec![]);
        let org = org_defaults_mit("schaeden", Some("fuehrungskraft"));
        assert_eq!(
            modul_freigabe(&leer, &org, "schaeden", &fk),
            freigabe(true, true)
        );
    }

    #[test]
    fn freigabe_einsatz_override_geht_org_default_vor() {
        let fk = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT);
        let ov = overrides_mit(vec![override_zeile("schaeden", true, Some("admin"))]);
        let org = org_defaults_mit("schaeden", Some("fuehrungskraft"));
        assert_eq!(
            modul_freigabe(&ov, &org, "schaeden", &fk),
            freigabe(true, false)
        );
    }

    #[test]
    fn freigabe_nicht_ausblendbar_ist_immer_frei() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        for key in crate::einsatz::modul::NICHT_AUSBLENDBAR {
            let ov = overrides_mit(vec![override_zeile(key, false, Some("admin"))]);
            let org = org_defaults_mit(key, Some("admin"));
            assert_eq!(
                modul_freigabe(&ov, &org, key, &normal),
                freigabe(true, true),
                "{key} ist nie sperrbar"
            );
        }
    }

    #[test]
    fn freigabe_ausgeblendet_fuer_mitglied() {
        let normal = benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE);
        let ov = overrides_mit(vec![override_zeile("meldungen", false, None)]);
        assert_eq!(
            modul_freigabe(&ov, &leere_org_defaults(), "meldungen", &normal),
            freigabe(false, false)
        );
    }

    #[test]
    fn freigabe_ausgeblendet_bleibt_fuer_admin_unsichtbar_aber_erreichbar() {
        let admin = benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE);
        let ov = overrides_mit(vec![override_zeile("meldungen", false, None)]);
        assert_eq!(
            modul_freigabe(&ov, &leere_org_defaults(), "meldungen", &admin),
            freigabe(false, true)
        );
    }

    /// Unabhängige Referenz: die Entscheidung von `fordere_modul_zugriff` vor LFH-669, Wort für
    /// Wort aus dem alten Rumpf (Admin → nicht ausblendbar → versteckt → Rolle aus Einsatz-Override,
    /// sonst Org-Vorgabe). `fordere_modul_zugriff` delegiert heute an `modul_freigabe`; ein
    /// Vergleich damit wäre tautologisch.
    fn alte_entscheidung(
        overrides: &HashMap<String, EinsatzModulOverride>,
        org_defaults: &HashMap<String, Option<String>>,
        key: &str,
        b: &Benutzer,
    ) -> bool {
        if b.ist_admin() {
            return true;
        }
        if !ist_ausblendbar(key) {
            return true;
        }
        let ue = overrides.get(key);
        if ue.is_some_and(|o| !o.sichtbar) {
            return false;
        }
        let ov = ue.and_then(|o| o.benoetigte_rolle.as_deref());
        let org = org_defaults.get(key).and_then(|r| r.as_deref());
        match ov.or(org) {
            Some("admin") => false,
            Some("fuehrungskraft") => b.ist_hoehere_berechtigung(),
            _ => true,
        }
    }

    /// Gleichlauf: `zugriff` ist für jede Kombination die alte Entscheidung des Gates, und das
    /// Gate folgt `zugriff`.
    #[test]
    fn freigabe_zugriff_ist_die_alte_entscheidung_des_gates() {
        let benutzer = [
            benutzer_mit(ROLLE_KEINER, ORG_ROLLE_KEINE),
            benutzer_mit(ROLLE_KEINER, ORG_ROLLE_FUEHRUNGSKRAFT),
            benutzer_mit(ROLLE_ADMIN, ORG_ROLLE_KEINE),
        ];
        let rollen = [None, Some("fuehrungskraft"), Some("admin")];
        for b in &benutzer {
            for ov in [None, Some(true), Some(false)] {
                for ov_rolle in rollen {
                    for org_rolle in rollen {
                        for key in ["etb", "einsatzdaten"] {
                            let ovs = match ov {
                                None => overrides_mit(vec![]),
                                Some(sichtbar) => {
                                    overrides_mit(vec![override_zeile(key, sichtbar, ov_rolle)])
                                }
                            };
                            let org = org_defaults_mit(key, org_rolle);
                            let fall = format!("{key} ov={ov:?}/{ov_rolle:?} org={org_rolle:?}");
                            let zugriff = modul_freigabe(&ovs, &org, key, b).zugriff;
                            assert_eq!(zugriff, alte_entscheidung(&ovs, &org, key, b), "{fall}");
                            assert_eq!(
                                fordere_modul_zugriff(&ovs, &org, key, b).is_ok(),
                                zugriff,
                                "{fall}"
                            );
                        }
                    }
                }
            }
        }
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
        let org_defaults = crate::org::modul_einstellung::laden_alle(&pool, 1)
            .await
            .unwrap();

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
