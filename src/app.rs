use crate::routes;
use axum::{
    routing::{get, post},
    Router,
};
use sqlx::SqlitePool;

/// Geteilter Anwendungszustand, der an alle Handler übergeben wird.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

/// Baut den Axum-Router mit allen Routen und dem geteilten Zustand.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(routes::health::health))
        .route("/api/auth/login", post(routes::auth::login))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/auth/me", get(routes::auth::me))
        .route("/api/benutzer", get(routes::benutzer::liste))
        .route("/api/benutzer", post(routes::benutzer::anlegen))
        .route("/api/benutzer/{id}/deaktivieren", post(routes::benutzer::deaktivieren))
        .route("/api/einsaetze", get(routes::einsatz::liste))
        .route("/api/einsaetze", post(routes::einsatz::anlegen))
        .route("/api/einsaetze/{id}", get(routes::einsatz::detail))
        .route("/api/einsaetze/{id}/abschliessen", post(routes::einsatz::abschliessen))
        .with_state(state)
}
