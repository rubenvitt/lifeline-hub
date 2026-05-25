use crate::live::LiveHub;
use crate::routes;
use axum::{
    routing::{delete, get, patch, post, put},
    Router,
};
use sqlx::SqlitePool;

/// Geteilter Anwendungszustand, der an alle Handler übergeben wird.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub live: LiveHub,
}

/// Baut den Axum-Router mit allen Routen und dem geteilten Zustand.
pub fn build_router(state: AppState) -> Router {
    let router = Router::new()
        .route("/api/health", get(routes::health::health))
        .route("/api/backup", get(routes::backup::download))
        .route("/api/auth/login", post(routes::auth::login))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/auth/me", get(routes::auth::me))
        .route("/api/benutzer", get(routes::benutzer::liste))
        .route("/api/benutzer", post(routes::benutzer::anlegen))
        .route(
            "/api/benutzer/{id}/deaktivieren",
            post(routes::benutzer::deaktivieren),
        )
        .route("/api/einsaetze", get(routes::einsatz::liste))
        .route("/api/einsaetze", post(routes::einsatz::anlegen))
        .route("/api/einsaetze/{id}", get(routes::einsatz::detail))
        .route("/api/einsaetze/{id}", patch(routes::einsatz::aktualisieren))
        .route(
            "/api/einsaetze/{id}/abschliessen",
            post(routes::einsatz::abschliessen),
        )
        .route(
            "/api/einsaetze/{id}/mitglieder",
            get(routes::einsatz::mitglieder),
        )
        .route(
            "/api/einsaetze/{id}/mitglieder/{benutzer_id}",
            put(routes::einsatz::mitglied_setzen),
        )
        .route(
            "/api/einsaetze/{id}/mitglieder/{benutzer_id}",
            delete(routes::einsatz::mitglied_entfernen),
        )
        .route("/api/einsaetze/{id}/etb", post(routes::etb::erfassen))
        .route("/api/einsaetze/{id}/etb", get(routes::etb::liste))
        .route("/api/einsaetze/{id}/etb/stream", get(routes::etb::stream))
        .route("/api/stichwort-vorschlaege", get(routes::stichwort::liste))
        .route("/api/stichwort-vorschlaege", post(routes::stichwort::anlegen))
        .route(
            "/api/stichwort-vorschlaege/{id}",
            delete(routes::stichwort::loeschen),
        );

    // Dev-only: Endpoint existiert physisch nur mit Feature `dev-seeds`.
    #[cfg(feature = "dev-seeds")]
    let router = router.route("/api/dev/users", get(routes::dev::users));

    router
        .fallback(crate::static_files::serve)
        .with_state(state)
}
