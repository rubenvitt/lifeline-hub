use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::auth::{
    password, BenutzerAnzeige, OrgRolle, SystemRolle, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Mindestlänge für Passwörter (siehe Plan-Design-Entscheidungen).
const PASSWORT_MIN_LEN: usize = 8;

#[derive(Debug, Deserialize)]
pub struct NeuerBenutzer {
    pub anzeigename: String,
    pub benutzername: String,
    pub passwort: String,
    /// 'admin' oder 'keiner'; fehlt das Feld, gilt 'keiner'.
    pub system_rolle: Option<String>,
    /// 'fuehrungskraft' oder 'keine'; fehlt das Feld, gilt 'keine'.
    pub org_rolle: Option<String>,
}

/// Partielle Änderung eines bestehenden Benutzers (PATCH, LFH-286). `None` = Feld nicht
/// ändern. `benutzername` (Login-Identität) und Passwort sind bewusst nicht änderbar.
#[derive(Debug, Deserialize)]
pub struct PatchBenutzer {
    pub anzeigename: Option<String>,
    /// 'admin' oder 'keiner'.
    pub system_rolle: Option<String>,
    /// 'fuehrungskraft' oder 'keine'.
    pub org_rolle: Option<String>,
    /// false = deaktivieren (Sessions werden gelöscht), true = reaktivieren.
    pub aktiv: Option<bool>,
}

/// Validiert einen System-Rollen-Wert (400 bei ungültig). Geteilt von `anlegen`/`bearbeiten`,
/// damit die erlaubte Rollenmenge nur an einer Stelle definiert ist.
fn pruefe_system_rolle(wert: &str) -> Result<(), AppError> {
    if SystemRolle::parse(wert).is_none() {
        return Err(AppError::Validation(
            "system_rolle muss 'admin' oder 'keiner' sein".into(),
        ));
    }
    Ok(())
}

/// Validiert einen Org-Rollen-Wert (400 bei ungültig). Geteilt von `anlegen`/`bearbeiten`.
fn pruefe_org_rolle(wert: &str) -> Result<(), AppError> {
    if OrgRolle::parse(wert).is_none() {
        return Err(AppError::Validation(
            "org_rolle muss 'fuehrungskraft' oder 'keine' sein".into(),
        ));
    }
    Ok(())
}

/// GET /api/benutzer — Liste aller Benutzer (ohne Passwort-Hashes). Admin-only. Enthält den
/// MFA-Status (`totp_aktiviert`, LFH-43 Increment 5 Task 6).
pub async fn liste(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<BenutzerAnzeige>>, AppError> {
    let benutzer = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at, \
                totp_aktiviert \
         FROM benutzer ORDER BY id",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(benutzer))
}

/// POST /api/benutzer — neuen Benutzer anlegen. Admin-only.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    JsonBody(req): JsonBody<NeuerBenutzer>,
) -> Result<(StatusCode, Json<BenutzerAnzeige>), AppError> {
    if req.benutzername.trim().is_empty() {
        return Err(AppError::Validation(
            "Benutzername darf nicht leer sein".into(),
        ));
    }
    if req.anzeigename.trim().is_empty() {
        return Err(AppError::Validation(
            "Anzeigename darf nicht leer sein".into(),
        ));
    }
    if req.passwort.len() < PASSWORT_MIN_LEN {
        return Err(AppError::Validation(format!(
            "Passwort muss mindestens {PASSWORT_MIN_LEN} Zeichen haben"
        )));
    }
    let rolle = req.system_rolle.as_deref().unwrap_or(ROLLE_KEINER);
    pruefe_system_rolle(rolle)?;

    let org_rolle = req.org_rolle.as_deref().unwrap_or(ORG_ROLLE_KEINE);
    pruefe_org_rolle(org_rolle)?;

    let hash = password::hash(&req.passwort)?;
    // Der neue Benutzer gehört zur Organisation DES ANLEGENDEN ADMINS (F05/LFH-232).
    // Vorher stand hier `ORDER BY id LIMIT 1` — mit einer zweiten Organisation wäre jedes
    // angelegte Konto still in Org 1 gelandet, und für Org 2 hätte sich überhaupt kein
    // Benutzer anlegen lassen. Ein org-fremdes Konto ist genau der Nicht-Admin, der
    // anschließend fremde Stammdaten liest.
    let org_id = admin.org_id;

    let ergebnis = sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind(req.anzeigename.trim())
    .bind(req.benutzername.trim())
    .bind(&hash)
    .bind(rolle)
    .bind(org_rolle)
    .execute(&state.pool)
    .await;

    if let Err(sqlx::Error::Database(db_err)) = &ergebnis {
        if db_err.is_unique_violation() {
            return Err(AppError::Conflict(
                "Benutzername ist bereits vergeben".into(),
            ));
        }
    }
    let id = ergebnis?.last_insert_rowid();

    let angelegt = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at, \
                totp_aktiviert \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(angelegt)))
}

/// Verweigert eine Änderung, die den **letzten aktiven Admin** aus der Menge der aktiven
/// Admins entfernen würde — sei es durch Deaktivieren oder durch Entzug der Admin-Rolle.
/// `bleibt_aktiver_admin` beschreibt den Zielzustand NACH der Änderung. Nur brisant, wenn
/// `ziel` aktuell ein aktiver Admin ist. Geteilt von `deaktivieren` und `bearbeiten`
/// (LFH-286) — eine Quelle der Wahrheit für den Aussperr-Schutz.
///
/// LIMITIERUNG (LFH-287, gehört in die SSO-Admin-Härtung LFH-277): gezählt wird nach ROLLE
/// (`system_rolle=admin AND aktiv=1`), NICHT nach tatsächlich authentifizierbarem Login-Weg.
/// Ein SSO-only-Admin (Sentinel-Hash `PASSWORT_HASH_SSO_ONLY`, kein lokales Passwort) zählt
/// hier voll mit. Seit LFH-286 kann ein OIDC-Nutzer zum Admin befördert werden — bliebe nach
/// einem Downgrade nur noch ein SSO-only-Admin übrig UND ist der IdP unerreichbar bzw. der
/// `oidc`-Provider deaktiviert, käme niemand mehr in den Admin-Bereich (kein Fremd-Passwort-
/// Reset). Der belastbare Fix (Zählung nur lokal-/passkey-authentifizierbarer Admins +
/// Admin-Linking) gehört zusammen in die SSO-Härtung, nicht in LFH-286.
///
/// LIMITIERUNG (TOCTOU, ebenfalls LFH-287): der `COUNT` läuft VOR der Schreib-Transaktion des
/// Aufrufers. Zwei nebenläufige Downgrade-/Deaktivier-Requests auf verschiedene Admins sehen
/// beide `count > 1` und committen beide → im Extremfall null aktive Admins. Bestehendes
/// Verhalten (schon in `deaktivieren` so), durch die Wiederverwendung in `bearbeiten` aber auf
/// eine zweite Route ausgeweitet. Der atomare Fix (bedingtes `UPDATE ... WHERE EXISTS(anderer
/// aktiver Admin)` bzw. `BEGIN IMMEDIATE`) gehört in dieselbe Guard-Überarbeitung (LFH-287).
async fn verweigere_admin_lockout(
    pool: &sqlx::SqlitePool,
    ziel: &crate::auth::Benutzer,
    bleibt_aktiver_admin: bool,
) -> Result<(), AppError> {
    if !(ziel.ist_admin() && ziel.aktiv) || bleibt_aktiver_admin {
        return Ok(());
    }
    let aktive_admins: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer WHERE system_rolle = ? AND aktiv = 1")
            .bind(ROLLE_ADMIN)
            .fetch_one(pool)
            .await?;
    if aktive_admins <= 1 {
        return Err(AppError::Conflict(
            "Der letzte aktive Admin kann nicht deaktiviert oder herabgestuft werden".into(),
        ));
    }
    Ok(())
}

/// POST /api/benutzer/{id}/deaktivieren — Benutzer deaktivieren + Sessions löschen.
/// Verweigert die Deaktivierung des letzten aktiven Admins. Admin-only.
pub async fn deaktivieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<BenutzerAnzeige>, AppError> {
    let ziel = sqlx::query_as::<_, crate::auth::Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    // Letzten aktiven Admin schützen: Deaktivieren setzt aktiv=0, der Nutzer bliebe also
    // kein aktiver Admin (geteilter Guard mit `bearbeiten`, LFH-286).
    verweigere_admin_lockout(&state.pool, &ziel, false).await?;

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM session WHERE benutzer_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let aktualisiert = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at, \
                totp_aktiviert \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(aktualisiert))
}

/// PATCH /api/benutzer/{id} — bestehenden Benutzer bearbeiten (LFH-286). Admin-only.
/// Partielle Semantik: nur mitgeschickte Felder ändern sich (`None` = unverändert).
/// `benutzername` (Login-Identität) und Passwort sind bewusst NICHT änderbar. Rollen werden
/// wie in `anlegen` validiert (400 bei ungültig). Der letzte aktive Admin ist gegen
/// Downgrade/Deaktivierung geschützt (409, geteilter Guard). Beim Deaktivieren (`aktiv=false`)
/// werden die Sessions des Nutzers gelöscht (analog `deaktivieren`); Rollen-/Aktiv-Änderungen
/// wirken für laufende Sessions ohnehin sofort, da der Session-Extractor Rolle+`aktiv` pro
/// Request frisch aus der DB liest.
pub async fn bearbeiten(
    State(state): State<AppState>,
    _admin: AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(req): JsonBody<PatchBenutzer>,
) -> Result<Json<BenutzerAnzeige>, AppError> {
    let ziel = sqlx::query_as::<_, crate::auth::Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    // Zielwerte auflösen: mitgeschickt → validieren; sonst Bestandswert (partielle PATCH-Semantik).
    let anzeigename = match &req.anzeigename {
        Some(n) if n.trim().is_empty() => {
            return Err(AppError::Validation(
                "Anzeigename darf nicht leer sein".into(),
            ));
        }
        Some(n) => n.trim().to_string(),
        None => ziel.anzeigename.clone(),
    };

    let system_rolle = match &req.system_rolle {
        Some(r) => {
            pruefe_system_rolle(r)?;
            r.clone()
        }
        None => ziel.system_rolle.as_str().to_string(),
    };

    let org_rolle = match &req.org_rolle {
        Some(r) => {
            pruefe_org_rolle(r)?;
            r.clone()
        }
        None => ziel.org_rolle.as_str().to_string(),
    };

    let aktiv = req.aktiv.unwrap_or(ziel.aktiv);

    // Aussperr-Schutz: bliebe der Nutzer nach der Änderung ein aktiver Admin?
    let bleibt_aktiver_admin = system_rolle == ROLLE_ADMIN && aktiv;
    verweigere_admin_lockout(&state.pool, &ziel, bleibt_aktiver_admin).await?;

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "UPDATE benutzer SET anzeigename = ?, system_rolle = ?, org_rolle = ?, aktiv = ? WHERE id = ?",
    )
    .bind(&anzeigename)
    .bind(&system_rolle)
    .bind(&org_rolle)
    .bind(aktiv)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    // Beim Deaktivieren die Sessions des Nutzers invalidieren (analog `deaktivieren`).
    if !aktiv {
        sqlx::query("DELETE FROM session WHERE benutzer_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let aktualisiert = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at, \
                totp_aktiviert \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(aktualisiert))
}

/// POST /api/benutzer/{id}/totp/reset — Admin-Reset des TOTP-Zweitfaktors eines Nutzers
/// (LFH-43, Increment 5 Task 6, `AdminUser`-gegated). Setzt `totp_secret = NULL` und
/// `totp_aktiviert = 0` UND löscht die Recovery-Codes des Nutzers (`storage::loesche_recovery_codes`
/// — Plan-MUST: keine stale Codes nach einem Reset) sowie dessen Sessions (analog `deaktivieren`
/// oben — ein laufender zweiter Faktor bzw. eine laufende Session sollen den Reset nicht
/// überleben). Alle drei Schreiboperationen laufen in EINER Transaktion.
///
/// `404`, falls kein Benutzer mit `id` existiert (geprüft VOR der Transaktion, analog
/// `deaktivieren`s Existenz-Check).
pub async fn totp_reset(
    State(state): State<AppState>,
    _admin: AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<BenutzerAnzeige>, AppError> {
    let existiert: Option<i64> = sqlx::query_scalar("SELECT id FROM benutzer WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    existiert.ok_or(AppError::NotFound)?;

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE benutzer SET totp_secret = NULL, totp_aktiviert = 0 WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    crate::auth::totp::storage::loesche_recovery_codes(&mut *tx, id).await?;
    sqlx::query("DELETE FROM session WHERE benutzer_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let aktualisiert = sqlx::query_as::<_, BenutzerAnzeige>(
        "SELECT id, anzeigename, benutzername, system_rolle, org_rolle, aktiv, erstellt_at, \
                totp_aktiviert \
         FROM benutzer WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(aktualisiert))
}
