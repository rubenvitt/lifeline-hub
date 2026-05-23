use crate::app::AppState;
use axum::{extract::State, Json};
use serde_json::{json, Value};

/// Health-Check: prüft DB-Konnektivität und liefert Status + Version.
pub async fn health(State(state): State<AppState>) -> Json<Value> {
    let db_ok = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .map(|v| v == 1)
        .unwrap_or(false);

    Json(json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "version": env!("CARGO_PKG_VERSION"),
        "db": db_ok,
    }))
}
