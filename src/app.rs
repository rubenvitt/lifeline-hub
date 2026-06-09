use crate::config::KarteConfig;
use crate::live::LiveHub;
use crate::routes;
use axum::{
    routing::{delete, get, patch, post, put},
    Extension, Router,
};
use sqlx::SqlitePool;
use tower_http::services::ServeFile;

/// Geteilter Anwendungszustand, der an alle Handler übergeben wird.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub live: LiveHub,
}

/// Baut den Router mit Default-Karte (keine Basemap konfiguriert → Blind-Modus).
/// Bestehende Aufrufer und Tests bleiben unverändert.
pub fn build_router(state: AppState) -> Router {
    build_router_mit_karte(state, KarteConfig::default())
}

/// Baut den Axum-Router mit allen Routen, dem geteilten Zustand und der Basemap.
pub fn build_router_mit_karte(state: AppState, karte: KarteConfig) -> Router {
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
            "/api/einsaetze/{id}/fahrzeuge/stream",
            get(routes::einsatz_fahrzeug::stream),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge/{ef_id}/position",
            patch(routes::einsatz_fahrzeug::position),
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
        .route("/api/einsaetze/{id}/personal", get(routes::einsatz_personal::liste))
        .route("/api/einsaetze/{id}/personal", post(routes::einsatz_personal::disponieren))
        .route("/api/einsaetze/{id}/personal/{ep_id}", patch(routes::einsatz_personal::aktualisieren))
        .route("/api/einsaetze/{id}/personal/{ep_id}", delete(routes::einsatz_personal::entfernen))
        .route("/api/einsaetze/{id}/personal/{ep_id}/position", patch(routes::einsatz_personal::position))
        .route("/api/einsaetze/{id}/karte/fuehrungskraefte", get(routes::einsatz_personal::karte_fuehrungskraefte))
        .route("/api/einsaetze/{id}/material", get(routes::einsatz_material::liste))
        .route("/api/einsaetze/{id}/material", post(routes::einsatz_material::disponieren))
        .route("/api/einsaetze/{id}/material/{em_id}", patch(routes::einsatz_material::aktualisieren))
        .route("/api/einsaetze/{id}/material/{em_id}", delete(routes::einsatz_material::entfernen))
        .route("/api/einsaetze/{id}/personen", get(routes::einsatz_person::liste))
        .route("/api/einsaetze/{id}/personen", post(routes::einsatz_person::anlegen))
        .route("/api/einsaetze/{id}/personen/stream", get(routes::einsatz_person::stream))
        .route("/api/einsaetze/{id}/personen/export", get(routes::einsatz_person::export))
        .route("/api/einsaetze/{id}/personen/{pid}", get(routes::einsatz_person::detail))
        .route("/api/einsaetze/{id}/personen/{pid}", patch(routes::einsatz_person::aktualisieren))
        .route("/api/einsaetze/{id}/personen/{pid}/status", post(routes::einsatz_person::status_wechsel))
        .route("/api/einsaetze/{id}/personen/{pid}/sichtung", post(routes::einsatz_person::sichten))
        .route("/api/einsaetze/{id}/personen/{pid}/verbleib", post(routes::einsatz_person::verbleib))
        .route("/api/einsaetze/{id}/personen/{pid}/notizen", post(routes::einsatz_person::notiz))
        .route("/api/einsaetze/{id}/personen/{pid}/abgleich", post(routes::einsatz_person::abgleich_anlegen))
        .route("/api/einsaetze/{id}/personen/{pid}/abgleich/{aid}/entscheidung",
               post(routes::einsatz_person::abgleich_entscheiden))
        .route("/api/einsaetze/{id}/personen/{pid}/audit", get(routes::einsatz_person::audit))
        .route("/api/einsaetze/{id}/personen/{pid}", delete(routes::einsatz_person::stornieren))
        .route("/api/einsaetze/{id}/tiere", get(routes::einsatz_tier::liste))
        .route("/api/einsaetze/{id}/tiere", post(routes::einsatz_tier::anlegen))
        .route("/api/einsaetze/{id}/tiere/stream", get(routes::einsatz_tier::stream))
        .route("/api/einsaetze/{id}/tiere/export", get(routes::einsatz_tier::export))
        .route("/api/einsaetze/{id}/tiere/{tid}", get(routes::einsatz_tier::detail))
        .route("/api/einsaetze/{id}/tiere/{tid}", patch(routes::einsatz_tier::aktualisieren))
        .route("/api/einsaetze/{id}/tiere/{tid}/status", post(routes::einsatz_tier::status_wechsel))
        .route("/api/einsaetze/{id}/tiere/{tid}", delete(routes::einsatz_tier::stornieren))
        .route("/api/einsaetze/{id}/schaeden", get(routes::einsatz_schaden::liste))
        .route("/api/einsaetze/{id}/schaeden", post(routes::einsatz_schaden::anlegen))
        .route("/api/einsaetze/{id}/schaeden/stream", get(routes::einsatz_schaden::stream))
        .route("/api/einsaetze/{id}/schaeden/{sid}", get(routes::einsatz_schaden::detail))
        .route("/api/einsaetze/{id}/schaeden/{sid}", patch(routes::einsatz_schaden::aktualisieren))
        .route("/api/einsaetze/{id}/schaeden/{sid}/uebergeben", post(routes::einsatz_schaden::uebergeben))
        .route("/api/einsaetze/{id}/schaeden/{sid}/abschliessen", post(routes::einsatz_schaden::abschliessen))
        .route("/api/einsaetze/{id}/schaeden/{sid}", delete(routes::einsatz_schaden::stornieren))
        .route("/api/einsaetze/{id}/uhs", get(routes::einsatz_uhs::liste))
        .route("/api/einsaetze/{id}/uhs", post(routes::einsatz_uhs::anlegen))
        .route("/api/einsaetze/{id}/uhs/stream", get(routes::einsatz_uhs::stream))
        .route("/api/einsaetze/{id}/uhs/{uid}", get(routes::einsatz_uhs::detail))
        .route("/api/einsaetze/{id}/uhs/{uid}", patch(routes::einsatz_uhs::aktualisieren))
        .route("/api/einsaetze/{id}/uhs/{uid}/status", post(routes::einsatz_uhs::status_wechsel))
        .route("/api/einsaetze/{id}/uhs/{uid}", delete(routes::einsatz_uhs::stornieren))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze", post(routes::einsatz_uhs::platz_anlegen))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}", patch(routes::einsatz_uhs::platz_aktualisieren))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit",
               post(routes::einsatz_uhs::platz_verfuegbarkeit))
        .route("/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}", delete(routes::einsatz_uhs::platz_stornieren))
        .route("/api/einsaetze/{id}/personen/{pid}/uhs-belegung",
               post(routes::einsatz_uhs::belegung))
        .route("/api/einsaetze/{id}/abschnitte", get(routes::einsatzabschnitt::liste))
        .route("/api/einsaetze/{id}/abschnitte", post(routes::einsatzabschnitt::anlegen))
        .route("/api/einsaetze/{id}/abschnitte/stream", get(routes::einsatzabschnitt::stream))
        .route("/api/einsaetze/{id}/abschnitte/{aid}", patch(routes::einsatzabschnitt::aktualisieren))
        .route("/api/einsaetze/{id}/abschnitte/{aid}/flaeche", patch(routes::einsatzabschnitt::flaeche))
        .route("/api/einsaetze/{id}/abschnitte/{aid}", delete(routes::einsatzabschnitt::aufloesen))
        .route("/api/einsaetze/{id}/lageberichte", get(routes::lagebericht::liste))
        .route("/api/einsaetze/{id}/lageberichte", post(routes::lagebericht::anlegen))
        .route("/api/einsaetze/{id}/lageberichte/{lid}", get(routes::lagebericht::detail))
        .route("/api/einsaetze/{id}/lageberichte/{lid}", patch(routes::lagebericht::aktualisieren))
        .route("/api/einsaetze/{id}/lageberichte/{lid}/freigeben", post(routes::lagebericht::freigeben))
        .route("/api/einsaetze/{id}/lageberichte/{lid}/fortschreiben", post(routes::lagebericht::fortschreiben))
        .route("/api/einsaetze/{id}/zonen", get(routes::lage_zone::liste))
        .route("/api/einsaetze/{id}/zonen", post(routes::lage_zone::anlegen))
        .route("/api/einsaetze/{id}/zonen/stream", get(routes::lage_zone::stream))
        .route("/api/einsaetze/{id}/zonen/{zid}", patch(routes::lage_zone::aktualisieren))
        .route("/api/einsaetze/{id}/zonen/{zid}", delete(routes::lage_zone::aufloesen))
        .route("/api/einsaetze/{id}/gefahrengebiete", get(routes::gefahr::gebiete))
        .route("/api/einsaetze/{id}/gefahrengebiete/{gid}", patch(routes::gefahr::umbenennen))
        .route("/api/einsaetze/{id}/gefahrengebiete/{gid}/matrix", get(routes::gefahr::matrix))
        .route("/api/einsaetze/{id}/gefahrengebiete/{gid}/matrix/bewertung", put(routes::gefahr::bewerten))
        .route("/api/organisation", get(routes::organisation::lesen))
        .route("/api/organisation", patch(routes::organisation::aktualisieren))
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
        .route("/api/material", get(routes::material::liste))
        .route("/api/material", post(routes::material::anlegen))
        .route("/api/material-kategorien", get(routes::material::kategorien))
        .route("/api/material/{id}", patch(routes::material::aktualisieren))
        .route(
            "/api/material/{id}/ausser-dienst",
            post(routes::material::ausser_dienst),
        )
        .route(
            "/api/material/{id}/in-dienst",
            post(routes::material::in_dienst),
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
        .route("/api/etb-bausteine", get(routes::etb_baustein::liste))
        .route("/api/etb-bausteine", post(routes::etb_baustein::anlegen))
        .route("/api/etb-bausteine/{id}", patch(routes::etb_baustein::aktualisieren))
        .route("/api/etb-bausteine/{id}/deaktivieren", post(routes::etb_baustein::deaktivieren))
        .route("/api/qualifikationen", get(routes::qualifikation::liste))
        .route("/api/qualifikationen", post(routes::qualifikation::anlegen))
        .route("/api/qualifikationen/{id}", patch(routes::qualifikation::aktualisieren))
        .route("/api/qualifikationen/{id}/deaktivieren", post(routes::qualifikation::deaktivieren))
        .route("/api/einheit-typen", get(routes::einheit_typ::liste))
        .route("/api/einheit-typen", post(routes::einheit_typ::anlegen))
        .route("/api/einheit-typen/{id}", patch(routes::einheit_typ::aktualisieren))
        .route("/api/einheit-typen/{id}/deaktivieren", post(routes::einheit_typ::deaktivieren))
        .route("/api/einsaetze/{id}/einheiten", get(routes::einsatz_einheit::liste))
        .route("/api/einsaetze/{id}/einheiten", post(routes::einsatz_einheit::bilden))
        .route("/api/einsaetze/{id}/einheiten/stream", get(routes::einsatz_einheit::stream))
        .route("/api/einsaetze/{id}/einheiten/{eid}", patch(routes::einsatz_einheit::aktualisieren))
        .route("/api/einsaetze/{id}/einheiten/{eid}/position", patch(routes::einsatz_einheit::position))
        .route("/api/einsaetze/{id}/einheiten/{eid}", delete(routes::einsatz_einheit::aufloesen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}", put(routes::einsatz_einheit::personal_zuordnen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}", delete(routes::einsatz_einheit::personal_freigeben))
        .route("/api/einsaetze/{id}/einheiten/{eid}/fahrzeug/{ef_id}", put(routes::einsatz_einheit::fahrzeug_zuordnen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/fahrzeug/{ef_id}", delete(routes::einsatz_einheit::fahrzeug_freigeben))
        .route("/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}", put(routes::einsatz_einheit::material_zuordnen))
        .route("/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}", delete(routes::einsatz_einheit::material_freigeben));

    // Dev-only: Endpoint existiert physisch nur mit Feature `dev-seeds`.
    #[cfg(feature = "dev-seeds")]
    let router = router.route("/api/dev/users", get(routes::dev::users));

    let router = router.route("/api/karte/config", get(routes::karte::config));

    // PMTiles-Tile-Service: nur mounten, wenn eine Datei konfiguriert ist.
    // ServeFile (eine feste Datei, kein ServeDir) beherrscht HTTP-Range nativ.
    let router = match &karte.pmtiles_path {
        Some(pfad) => router.route_service("/api/karte/tiles.pmtiles", ServeFile::new(pfad)),
        None => router.route("/api/karte/tiles.pmtiles", get(routes::karte::tiles_fehlt)),
    };

    router
        .layer(Extension(karte))
        .fallback(crate::static_files::serve)
        .with_state(state)
}
