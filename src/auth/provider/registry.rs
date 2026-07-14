//! Registry: Wahrheitsquelle, welche Provider konfiguriert, verfügbar und
//! aktiviert sind. Erzwingt den Aussperr-Guard beim Deaktivieren.
//!
//! Die *konfigurierte* Menge lebt im Code (`konfiguriert`); `auth_provider` hält
//! nur Override-Zustände (fehlt eine Zeile → Default „aktiviert"). Kein Reconcile nötig.
use super::{AuthProviderAnzeige, AuthProviderTyp, ID_DEV, ID_PASSWORT};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Ob der Dev-Provider im aktuellen Build überhaupt existiert (Compile-Feature).
fn dev_verfuegbar() -> bool {
    cfg!(feature = "dev-seeds")
}

/// Im aktuellen Build konfigurierte Provider-IDs (Quelle der Wahrheit).
fn konfiguriert() -> Vec<&'static str> {
    let mut v = vec![ID_PASSWORT];
    if dev_verfuegbar() {
        v.push(ID_DEV);
    }
    v
}

/// Menge der Provider, über die sich ein Admin verlässlich anmelden kann.
/// Wächst mit OIDC/WebAuthn in späteren Increments. Der Dev-Provider zählt
/// bewusst NICHT dazu (feature-gated, kein Prod-Login-Pfad).
fn ist_admin_tauglich(id: &str) -> bool {
    id == ID_PASSWORT
}

fn anzeigename(id: &str) -> &'static str {
    match id {
        ID_PASSWORT => "Passwort",
        ID_DEV => "Dev-Schnellanmeldung",
        _ => "Unbekannt",
    }
}

fn typ(id: &str) -> AuthProviderTyp {
    match id {
        ID_DEV => AuthProviderTyp::Dev,
        _ => AuthProviderTyp::Passwort,
    }
}

/// Konfigurierte Provider inkl. `aktiviert` (Override aus `auth_provider`, sonst Default true).
pub async fn liste(pool: &SqlitePool) -> Result<Vec<AuthProviderAnzeige>, AppError> {
    let rows: Vec<(String, bool)> = sqlx::query_as("SELECT id, aktiviert FROM auth_provider")
        .fetch_all(pool)
        .await?;
    let override_map: HashMap<String, bool> = rows.into_iter().collect();
    Ok(konfiguriert()
        .into_iter()
        .map(|id| AuthProviderAnzeige {
            typ: typ(id),
            anzeigename: anzeigename(id).to_string(),
            aktiviert: *override_map.get(id).unwrap_or(&true),
            id: id.to_string(),
        })
        .collect())
}

/// Ob `id` deaktiviert werden darf, ohne Admins auszusperren: erlaubt, wenn `id`
/// nicht admin-tauglich ist, ODER kein aktiver Admin existiert, ODER nach dem
/// Deaktivieren noch ein ANDERER aktivierter admin-tauglicher Provider bliebe.
/// `ist_admin_tauglich` ist die einzige Quelle der admin-tauglichen Menge — der
/// Guard wächst automatisch mit, sobald OIDC/WebAuthn dort aufgenommen werden.
async fn darf_deaktivieren(pool: &SqlitePool, id: &str) -> Result<bool, AppError> {
    if !ist_admin_tauglich(id) {
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
    Ok(liste
        .iter()
        .any(|p| p.id != id && p.aktiviert && ist_admin_tauglich(&p.id)))
}

/// Schaltet einen Provider an/aus (Upsert des Overrides). Verweigert das Aussperren
/// des letzten admin-tauglichen Login-Wegs (analog "letzter aktiver Admin").
pub async fn schalten(pool: &SqlitePool, id: &str, aktiviert: bool) -> Result<(), AppError> {
    if !konfiguriert().contains(&id) {
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
}
