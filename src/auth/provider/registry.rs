//! Registry: Wahrheitsquelle, welche Provider konfiguriert, verfügbar und
//! aktiviert sind. Erzwingt den Aussperr-Guard beim Deaktivieren.
//!
//! Die *konfigurierte* Menge lebt im Code (`konfiguriert`); `auth_provider` hält
//! nur Override-Zustände (fehlt eine Zeile → Default „aktiviert"). Kein Reconcile nötig.
use super::{AuthProviderAnzeige, AuthProviderTyp, ID_DEV, ID_OIDC, ID_PASSWORT, ID_WEBAUTHN};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Ob der Dev-Provider im aktuellen Build überhaupt existiert (Compile-Feature).
fn dev_verfuegbar() -> bool {
    cfg!(feature = "dev-seeds")
}

/// Prozessweiter Schalter: ob OIDC konfiguriert ist (Issuer + Client-ID + Client-Secret
/// gesetzt). OnceLock statt AppState-Feld — bricht keine der vielen Inline-Test-
/// Konstruktionen (Präzedenz: `COOKIE_SECURE` in `session.rs`, ScanConfig LFH-114).
/// Default (ungesetzt) = false. Reiner Zustand aus der Config — `konfiguriert()`/`liste()`
/// lesen nur diesen OnceLock + die DB, nie das Netz (MUST Offline-First: Registry-Listing
/// berührt kein Netz; Discovery ist Lazy und passiert erst bei erster OIDC-Nutzung).
static OIDC_KONFIGURIERT: OnceLock<bool> = OnceLock::new();

/// Einmalig beim Serverstart setzen (true, wenn Issuer+Client-ID+Secret gesetzt sind).
/// Doppelsetzen wird ignoriert (wie `session::set_cookie_secure`).
pub fn set_oidc_konfiguriert(v: bool) {
    let _ = OIDC_KONFIGURIERT.set(v);
}

/// Ob OIDC im aktuellen Prozess konfiguriert ist (Default false → Tests/Non-OIDC-Deploys
/// unberührt).
fn oidc_konfiguriert() -> bool {
    *OIDC_KONFIGURIERT.get().unwrap_or(&false)
}

/// Prozessweiter Schalter: ob WebAuthn konfiguriert ist (eager Boot-Bau in `main::run_server`
/// war erfolgreich — `rp_id`/`rp_origin` gesetzt UND `webauthn::baue` lieferte `Ok`). Analog zu
/// `OIDC_KONFIGURIERT`: OnceLock statt `AppState`-Feld, Default (ungesetzt) = false.
static WEBAUTHN_KONFIGURIERT: OnceLock<bool> = OnceLock::new();

/// Einmalig beim Serverstart setzen, NACHDEM `webauthn::baue` `Ok` geliefert hat. Doppelsetzen
/// wird ignoriert (wie `set_oidc_konfiguriert`).
pub fn set_webauthn_konfiguriert(v: bool) {
    let _ = WEBAUTHN_KONFIGURIERT.set(v);
}

/// Ob WebAuthn im aktuellen Prozess konfiguriert ist (Default false → Tests/Non-WebAuthn-
/// Deploys unberührt).
fn webauthn_konfiguriert() -> bool {
    *WEBAUTHN_KONFIGURIERT.get().unwrap_or(&false)
}

/// Interne, exhaustiv gematchte Wahrheitsquelle über alle Provider-Arten. Neue Provider zwingen
/// den Compiler, `as_str`/`typ`/`anzeigename` UND `ALLE` zu pflegen — kein stiller Default mehr
/// (früher fiel `typ(&str)` für Unbekanntes auf `Passwort`, was eine unbekannte ID als
/// Passwort-Login gerendert hätte).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProviderId {
    Passwort,
    Dev,
    Oidc,
    Webauthn,
}

impl ProviderId {
    /// Alle Varianten. Bei einer neuen Variante bricht die Array-Länge den Build → bewusster
    /// Pflege-Anker (zusammen mit den exhaustiven `match`-Armen unten).
    const ALLE: [ProviderId; 4] = [
        ProviderId::Passwort,
        ProviderId::Dev,
        ProviderId::Oidc,
        ProviderId::Webauthn,
    ];

    fn as_str(self) -> &'static str {
        match self {
            ProviderId::Passwort => ID_PASSWORT,
            ProviderId::Dev => ID_DEV,
            ProviderId::Oidc => ID_OIDC,
            ProviderId::Webauthn => ID_WEBAUTHN,
        }
    }

    fn typ(self) -> AuthProviderTyp {
        match self {
            ProviderId::Passwort => AuthProviderTyp::Passwort,
            ProviderId::Dev => AuthProviderTyp::Dev,
            ProviderId::Oidc => AuthProviderTyp::Oidc,
            ProviderId::Webauthn => AuthProviderTyp::Webauthn,
        }
    }

    fn anzeigename(self) -> &'static str {
        match self {
            ProviderId::Passwort => "Passwort",
            ProviderId::Dev => "Dev-Schnellanmeldung",
            ProviderId::Oidc => "PocketID",
            ProviderId::Webauthn => "Passkey",
        }
    }

    fn parse(id: &str) -> Option<ProviderId> {
        ProviderId::ALLE.into_iter().find(|p| p.as_str() == id)
    }

    /// Ob sich ein Admin über diesen Provider verlässlich anmelden kann (Lockout-Schutz-MUST).
    /// MUST (LFH-41/LFH-275): NUR `passwort`. „oidc"/„webauthn" kommen erst mit Admin-Linking +
    /// transaktionalem Guard (LFH-277 deferred), sonst könnte sich ein Admin durch Deaktivieren
    /// von `passwort` aussperren.
    fn ist_admin_tauglich(self) -> bool {
        matches!(self, ProviderId::Passwort)
    }
}

/// Im aktuellen Build konfigurierte Provider (Quelle der Wahrheit).
fn konfiguriert() -> Vec<ProviderId> {
    let mut v = vec![ProviderId::Passwort];
    if dev_verfuegbar() {
        v.push(ProviderId::Dev);
    }
    if oidc_konfiguriert() {
        v.push(ProviderId::Oidc);
    }
    if webauthn_konfiguriert() {
        v.push(ProviderId::Webauthn);
    }
    v
}

/// Konfigurierte Provider inkl. `aktiviert` (Override aus `auth_provider`, sonst Default true).
pub async fn liste(pool: &SqlitePool) -> Result<Vec<AuthProviderAnzeige>, AppError> {
    let rows: Vec<(String, bool)> = sqlx::query_as("SELECT id, aktiviert FROM auth_provider")
        .fetch_all(pool)
        .await?;
    let override_map: HashMap<String, bool> = rows.into_iter().collect();
    Ok(konfiguriert()
        .into_iter()
        .map(|p| AuthProviderAnzeige {
            typ: p.typ(),
            anzeigename: p.anzeigename().to_string(),
            aktiviert: *override_map.get(p.as_str()).unwrap_or(&true),
            id: p.as_str().to_string(),
        })
        .collect())
}

/// Ob `id` deaktiviert werden darf, ohne Admins auszusperren: erlaubt, wenn `id`
/// nicht admin-tauglich ist, ODER kein aktiver Admin existiert, ODER nach dem
/// Deaktivieren noch ein ANDERER aktivierter admin-tauglicher Provider bliebe.
/// `ist_admin_tauglich` ist die einzige Quelle der admin-tauglichen Menge — der
/// Guard wächst automatisch mit, sobald OIDC/WebAuthn dort aufgenommen werden.
async fn darf_deaktivieren(pool: &SqlitePool, id: &str) -> Result<bool, AppError> {
    // Unbekannt/nicht admin-tauglich → immer erlaubt (der NotFound-Fall wird in `schalten`
    // separat gefangen). `parse` liefert für alles außerhalb der bekannten Provider `None`.
    let admin_tauglich = ProviderId::parse(id).is_some_and(ProviderId::ist_admin_tauglich);
    if !admin_tauglich {
        return Ok(true);
    }
    let aktive_admins: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer WHERE system_rolle = ? AND aktiv = 1")
            .bind(crate::auth::ROLLE_ADMIN)
            .fetch_one(pool)
            .await?;
    if aktive_admins == 0 {
        return Ok(true);
    }
    // Bliebe nach dem Deaktivieren noch ein anderer aktivierter admin-tauglicher Provider?
    let liste = liste(pool).await?;
    Ok(liste.iter().any(|p| {
        p.id != id
            && p.aktiviert
            && ProviderId::parse(&p.id).is_some_and(ProviderId::ist_admin_tauglich)
    }))
}

/// Schaltet einen Provider an/aus (Upsert des Overrides). Verweigert das Aussperren
/// des letzten admin-tauglichen Login-Wegs (analog "letzter aktiver Admin").
pub async fn schalten(pool: &SqlitePool, id: &str, aktiviert: bool) -> Result<(), AppError> {
    if !konfiguriert().iter().any(|p| p.as_str() == id) {
        return Err(AppError::NotFound);
    }
    if !aktiviert && !darf_deaktivieren(pool, id).await? {
        return Err(AppError::Conflict(
            "Der letzte admin-taugliche Login-Weg kann nicht deaktiviert werden".into(),
        ));
    }
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES (?, ?) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = excluded.aktiviert",
    )
    .bind(id)
    .bind(aktiviert)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
    }

    async fn benutzer(pool: &SqlitePool, benutzername: &str, system_rolle: &str) {
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'X', ?, 'h', ?)",
        )
        .bind(benutzername)
        .bind(system_rolle)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn liste_enthaelt_passwort_default_aktiv() {
        let pool = crate::db::test_pool().await;
        let l = liste(&pool).await.unwrap();
        assert!(
            l.iter().any(|p| p.id == "passwort" && p.aktiviert),
            "passwort ist ohne Override standardmäßig aktiviert"
        );
    }

    #[tokio::test]
    async fn passwort_kann_nicht_deaktiviert_werden_mit_admin() {
        let pool = crate::db::test_pool().await;
        org(&pool).await;
        benutzer(&pool, "admin", "admin").await;
        let err = schalten(&pool, ID_PASSWORT, false).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
        // Zustand unverändert aktiviert (kein Override geschrieben).
        assert!(liste(&pool)
            .await
            .unwrap()
            .iter()
            .any(|p| p.id == "passwort" && p.aktiviert));
    }

    #[tokio::test]
    async fn passwort_deaktivierbar_ohne_aktiven_admin() {
        // Diskriminiert die Guard-Logik: ein tautologischer Query ließe passwort NIE
        // schalten. Korrekt ist es schaltbar, wenn kein Admin ausgesperrt wird.
        let pool = crate::db::test_pool().await;
        org(&pool).await;
        benutzer(&pool, "n", "keiner").await; // kein Admin
        schalten(&pool, ID_PASSWORT, false).await.unwrap();
        assert!(liste(&pool)
            .await
            .unwrap()
            .iter()
            .any(|p| p.id == "passwort" && !p.aktiviert));
    }

    #[tokio::test]
    async fn unbekannter_provider_ist_not_found() {
        let pool = crate::db::test_pool().await;
        let err = schalten(&pool, "gibtsnicht", false).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[test]
    fn admin_tauglich_bleibt_nur_passwort() {
        // MUST (Lockout-Schutz, LFH-41): "oidc" darf NIEMALS admin-tauglich werden,
        // sonst ließe sich `passwort` deaktivieren und alle Admins wären ausgesperrt.
        assert!(ProviderId::Passwort.ist_admin_tauglich());
        assert!(!ProviderId::Oidc.ist_admin_tauglich());
    }

    #[test]
    fn admin_tauglich_ohne_webauthn() {
        // MUST (LFH-275, Increment 4): "webauthn" bleibt außerhalb der admin-tauglichen Menge —
        // `ist_admin_tauglich` bleibt UNVERÄNDERT `{passwort}`.
        assert!(!ProviderId::Webauthn.ist_admin_tauglich());
    }

    #[test]
    fn provider_id_parse_roundtrip_und_unbekannt_none() {
        for p in ProviderId::ALLE {
            assert_eq!(ProviderId::parse(p.as_str()), Some(p));
        }
        assert_eq!(ProviderId::parse("gibtsnicht"), None);
    }

    #[test]
    fn provider_id_typ_und_anzeigename_stimmen() {
        assert_eq!(ProviderId::Oidc.typ(), AuthProviderTyp::Oidc);
        assert_eq!(ProviderId::Oidc.anzeigename(), "PocketID");
        assert_eq!(ProviderId::Webauthn.anzeigename(), "Passkey");
        // Keine unbekannte ID mehr rendert still als Passwort:
        assert_eq!(ProviderId::parse("gibtsnicht").map(|p| p.typ()), None);
    }

    #[tokio::test]
    async fn oidc_gelistet_wenn_konfiguriert() {
        // OnceLock ist prozessweit: einmal true gesetzt, bleibt es für den Rest des
        // --lib-Testprozesses gesetzt. Kein bestehender Registry-Test behauptet
        // oidc-ABSENZ — dieser Test ist daher sicher unabhängig von der Laufreihenfolge.
        set_oidc_konfiguriert(true);
        let pool = crate::db::test_pool().await;
        let liste = liste(&pool).await.unwrap();
        assert!(liste
            .iter()
            .any(|p| p.id == "oidc" && p.typ == AuthProviderTyp::Oidc));
    }

    #[tokio::test]
    async fn webauthn_gelistet_wenn_konfiguriert() {
        // Wie `oidc_gelistet_wenn_konfiguriert`: OnceLock ist prozessweit, kein bestehender
        // Test behauptet webauthn-ABSENZ — unabhängig von der Laufreihenfolge sicher.
        set_webauthn_konfiguriert(true);
        let pool = crate::db::test_pool().await;
        let liste = liste(&pool).await.unwrap();
        assert!(liste.iter().any(|p| p.id == "webauthn"
            && p.typ == AuthProviderTyp::Webauthn
            && p.anzeigename == "Passkey"));
    }
}
