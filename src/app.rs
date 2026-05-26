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
        .route(
            "/api/einsaetze/{id}/fahrzeuge",
            get(routes::einsatz_fahrzeug::liste),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge",
            post(routes::einsatz_fahrzeug::disponieren),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge/{ef_id}",
            patch(routes::einsatz_fahrzeug::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge/{ef_id}",
            delete(routes::einsatz_fahrzeug::entfernen),
        )
        .route("/api/stichwort-vorschlaege", get(routes::stichwort::liste))
        .route("/api/stichwort-vorschlaege", post(routes::stichwort::anlegen))
        .route(
            "/api/stichwort-vorschlaege/{id}",
            delete(routes::stichwort::loeschen),
        )
        .route("/api/fahrzeuge", get(routes::fahrzeug::liste))
        .route("/api/fahrzeuge", post(routes::fahrzeug::anlegen))
        .route("/api/fahrzeug-vorschlaege", get(routes::fahrzeug::vorschlaege))
        .route("/api/fahrzeuge/{id}", patch(routes::fahrzeug::aktualisieren))
        .route(
            "/api/fahrzeuge/{id}/ausser-dienst",
            post(routes::fahrzeug::ausser_dienst),
        )
        .route(
            "/api/fahrzeuge/{id}/in-dienst",
            post(routes::fahrzeug::in_dienst),
        )
        .route("/api/fahrzeug-status", get(routes::fahrzeug_status::liste))
        .route("/api/fahrzeug-status", post(routes::fahrzeug_status::anlegen))
        .route(
            "/api/fahrzeug-status/{id}",
            patch(routes::fahrzeug_status::aktualisieren),
        )
        .route(
            "/api/fahrzeug-status/{id}/deaktivieren",
            post(routes::fahrzeug_status::deaktivieren),
        )
        .route("/api/personal", get(routes::personal::liste))
        .route("/api/personal", post(routes::personal::anlegen))
        .route("/api/personal-vorschlaege", get(routes::personal::vorschlaege))
        .route("/api/personal/{id}", patch(routes::personal::aktualisieren))
        .route("/api/personal/{id}/ausser-dienst", post(routes::personal::ausser_dienst))
        .route("/api/personal/{id}/in-dienst", post(routes::personal::in_dienst))
        .route("/api/personal-status", get(routes::personal_status::liste))
        .route("/api/personal-status", post(routes::personal_status::anlegen))
        .route("/api/personal-status/{id}", patch(routes::personal_status::aktualisieren))
        .route("/api/personal-status/{id}/deaktivieren", post(routes::personal_status::deaktivieren))
        .route("/api/qualifikationen", get(routes::qualifikation::liste))
        .route("/api/qualifikationen", post(routes::qualifikation::anlegen))
        .route("/api/qualifikationen/{id}", patch(routes::qualifikation::aktualisieren))
        .route("/api/qualifikationen/{id}/deaktivieren", post(routes::qualifikation::deaktivieren));

    // Dev-only: Endpoint existiert physisch nur mit Feature `dev-seeds`.
    #[cfg(feature = "dev-seeds")]
    let router = router.route("/api/dev/users", get(routes::dev::users));

    router
        .fallback(crate::static_files::serve)
        .with_state(state)
}
