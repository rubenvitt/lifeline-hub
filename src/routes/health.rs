use crate::app::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde_json::{json, Value};

/// Health-Check: prüft DB-Konnektivität und liefert Status + Version.
/// Liefert 200 bei gesunder DB, 503 wenn die DB nicht erreichbar ist.
pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = match sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(v) => v == 1,
        Err(err) => {
            tracing::warn!("Health-Check: DB-Abfrage fehlgeschlagen: {err}");
            false
        }
    };

    let status_code = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body: Json<Value> = Json(json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "version": env!("CARGO_PKG_VERSION"),
        "db": db_ok,
    }));

    (status_code, body)
}
