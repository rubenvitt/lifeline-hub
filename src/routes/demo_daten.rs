//! Demo-Daten zur Laufzeit (LFH-690). Die Routen existieren nur mit `--demo-daten`
//! (`app::RouterOptionen`), die Handler prüfen den Schalter deshalb nicht. Alle Endpunkte
//! stehen hinter [`AdminUser`] (anonym 401, jede andere Rolle 403).
//!
//! Die Org ist die des Admins (`benutzer.org_id`). Jede Schreibaktion läuft in genau einem
//! `write_retry!`, und jede Antwort trägt den Status aus derselben Transaktion.
//!
//! **`lagged` nach Entfernen und Neu-Import:** nach dem Commit geht [`LiveEvent::Lagged`] mit
//! der Nutzlast `resync` über [`crate::live::LiveHub::publiziere_event`] auf den Kanal des alten
//! Demo-Einsatzes. Nie aus der Transaktion heraus: ein Rollback oder Wiederholversuch
//! hinterließe sonst ein falsches Signal.

use chrono::Timelike;
use sqlx::SqliteConnection;

use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::demo::{entfernen, import, DemoBericht, DemoDatenStatus, DemoImportKopf};
use crate::error::AppError;
use crate::live::LiveEvent;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

/// Liest den Stand der Demo-Daten einer Org auf einer Verbindung.
///
/// - Aktiver Kopf: `importiert`, Kopf samt Einsatzbezeichnung, Bericht des Imports.
/// - Kein aktiver Kopf: `importiert: false` und der Bericht des jüngsten geschlossenen Kopfes,
///   sonst keiner. „Jüngster“ nach `id` (monoton), nicht nach `entfernt_at` (Sekundenauflösung).
///
/// Der Einsatz wird per `LEFT JOIN` nur in der eigenen Org gelesen. Fehlt er, bleibt der Import
/// „importiert“ mit leerer Bezeichnung: der Kopf sperrt den nächsten Import weiter (409).
async fn status_tx(conn: &mut SqliteConnection, org_id: i64) -> Result<DemoDatenStatus, AppError> {
    let aktiv: Option<(i64, String, i64, String, String)> = sqlx::query_as(
        "SELECT d.id, d.importiert_at, d.einsatz_id, COALESCE(e.bezeichnung, ''), d.bericht \
         FROM demo_import d \
         LEFT JOIN einsatz e ON e.id = d.einsatz_id AND e.org_id = d.org_id \
         WHERE d.org_id = ? AND d.entfernt_at IS NULL",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some((id, importiert_at, einsatz_id, einsatz_bezeichnung, bericht)) = aktiv {
        return Ok(DemoDatenStatus {
            importiert: true,
            import: Some(DemoImportKopf {
                id,
                importiert_at,
                einsatz_id,
                einsatz_bezeichnung,
            }),
            bericht: Some(bericht_lesen(&bericht)?),
        });
    }

    let letzter: Option<String> = sqlx::query_scalar(
        "SELECT bericht FROM demo_import \
         WHERE org_id = ? AND entfernt_at IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(DemoDatenStatus {
        importiert: false,
        import: None,
        bericht: letzter.as_deref().map(bericht_lesen).transpose()?,
    })
}

fn bericht_lesen(json: &str) -> Result<DemoBericht, AppError> {
    serde_json::from_str(json)
        .map_err(|e| AppError::Internal(format!("Demo-Bericht nicht lesbar: {e}")))
}

/// ID des Demo-Einsatzes des aktiven Kopfes, nur wenn es ihn in der eigenen Org gibt; sonst
/// löscht `entfernen_tx` keinen Einsatz, und kein Kanal bekommt ein `lagged`.
async fn alter_demo_einsatz_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT e.id FROM demo_import d \
         JOIN einsatz e ON e.id = d.einsatz_id AND e.org_id = d.org_id \
         WHERE d.org_id = ? AND d.entfernt_at IS NULL",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Importzeitpunkt: UTC, auf Sekunden gekürzt. Einmal vor `write_retry!` gelesen, damit ein
/// Wiederholversuch dieselbe Szenariouhr nimmt.
fn jetzt() -> chrono::NaiveDateTime {
    let t = chrono::Utc::now().naive_utc();
    t.with_nanosecond(0).unwrap_or(t)
}

/// Resynchronisation für offene Tabs des entfernten Demo-Einsatzes; nur nach dem Commit.
fn resync_senden(state: &AppState, alt: Option<i64>) {
    if let Some(einsatz_id) = alt {
        state
            .live
            .publiziere_event(einsatz_id, LiveEvent::Lagged, "resync".into());
    }
}

/// GET /api/demo-daten — Stand der Demo-Daten der eigenen Organisation. 200.
pub async fn status(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
) -> Result<Json<DemoDatenStatus>, AppError> {
    let mut conn = state.pool.acquire().await?;
    Ok(Json(status_tx(&mut conn, benutzer.org_id).await?))
}

/// POST /api/demo-daten — Demo-Daten importieren. 201; 409 bei aktivem Import, 422 bei
/// fehlendem Katalogeintrag.
pub async fn importieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
) -> Result<(StatusCode, Json<DemoDatenStatus>), AppError> {
    let (org_id, admin_id, jetzt) = (benutzer.org_id, benutzer.id, jetzt());
    let status = crate::write_retry!(&state.pool, |conn| {
        import::importieren_tx(conn, org_id, admin_id, jetzt).await?;
        status_tx(conn, org_id).await
    })?;
    Ok((StatusCode::CREATED, Json(status)))
}

/// POST /api/demo-daten/neu — entfernen und neu importieren in EINER Transaktion: scheitert der
/// Import, rollt auch das Entfernen zurück. Ohne aktiven Import nur der Import. 200; 422 bei
/// fehlendem Katalogeintrag.
pub async fn neu_importieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
) -> Result<Json<DemoDatenStatus>, AppError> {
    let (org_id, admin_id, jetzt) = (benutzer.org_id, benutzer.id, jetzt());
    let (alt, status) = crate::write_retry!(&state.pool, |conn| {
        let aktiv: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM demo_import WHERE org_id = ? AND entfernt_at IS NULL",
        )
        .bind(org_id)
        .fetch_optional(&mut *conn)
        .await?;
        let alt = if aktiv.is_some() {
            let alt = alter_demo_einsatz_tx(conn, org_id).await?;
            entfernen::entfernen_tx(conn, org_id).await?;
            alt
        } else {
            None
        };
        import::importieren_tx(conn, org_id, admin_id, jetzt).await?;
        Ok((alt, status_tx(conn, org_id).await?))
    })?;
    resync_senden(&state, alt);
    Ok(Json(status))
}

/// DELETE /api/demo-daten — Demo-Daten entfernen. 200; 409, wenn nichts importiert ist.
pub async fn entfernen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
) -> Result<Json<DemoDatenStatus>, AppError> {
    let org_id = benutzer.org_id;
    let (alt, status) = crate::write_retry!(&state.pool, |conn| {
        let alt = alter_demo_einsatz_tx(conn, org_id).await?;
        entfernen::entfernen_tx(conn, org_id).await?;
        Ok((alt, status_tx(conn, org_id).await?))
    })?;
    resync_senden(&state, alt);
    Ok(Json(status))
}
