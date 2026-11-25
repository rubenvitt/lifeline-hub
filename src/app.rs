use crate::karte::FachebenenState;
use crate::live::LiveHub;
use crate::routes;
use crate::transfer::{ARCHIV_BLOCK_BODY_MAX, UPLOAD_BODY_MAX};
use axum::{
    extract::DefaultBodyLimit,
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Router,
};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// Geteilter Anwendungszustand, der an alle Handler übergeben wird.
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub live: LiveHub,
    pub fachebenen: FachebenenState,
    /// Lokales Verzeichnis für Offline-Karten (s. `config::default_karten_dir`). Nicht in der DB,
    /// weil ein absoluter Pfad nach Backup/Restore auf einem anderen Host falsch wäre.
    pub karten_dir: PathBuf,
    /// HTTP-Client für Offline-Karten-Downloads: Connect-Timeout, kein Gesamt-Timeout (große
    /// Downloads), SSRF-prüfende Redirect-Policy. Getrennt vom kurzlebigen `fachebenen.client`.
    pub download_client: reqwest::Client,
    /// Transienter Download-Fortschritt je Karte-`id` (in-memory, keine DB-Spalte).
    pub download_fortschritt: crate::karte::download::FortschrittMap,
    /// Basis-URL des karten-service für den Region-Bau; `None` = Bau-Feature aus.
    pub karten_service_url: Option<String>,
    /// Bearer-Token für den karten-service; bleibt serverseitig. `None` = Feature aus.
    pub karten_service_token: Option<String>,
    /// Automatische Aktualisierung der Offline-Karten (LFH-993): Vorgabe, Laufzustand des
    /// Wächters, Katalogquelle und Lader.
    pub auto_aktualisierung: crate::karte::auto_aktualisierung::AutoAktualisierung,
    /// Lässt höchstens einen Sicherungs-Download zugleich zu (LFH-926, `GET /api/backup`).
    pub backup_download: crate::backup::DownloadSperre,
    /// Ein ZIP der Einsatzakte je Einsatz zugleich (LLH-1835, design.md D7).
    pub einsatzakte_bau: crate::einsatzakte::BauSperre,
    /// Öffentliche Schlüssel, an die `GET /api/backup` verschlüsselt (LFH-1002); leer → Klartext.
    pub backup_empfaenger: crate::backup::Empfaenger,
    /// Letztes Ergebnis der Datenträgerprüfung (LFH-1100), `GET /api/system/storage`.
    pub datentraeger: crate::datentraeger::Stand,
    /// Adapter-Rahmen (LLH-2017): Geheimnisspeicher mit dem Schlüssel aus der Umgebung und die
    /// bekannten Arten. Vorgabe: kein Schlüssel, die Arten dieses Builds.
    pub adapter: crate::adapter::Rahmen,
    /// Zuschaltungen der Drohnenquellen und ihr letzter Stand (LLH-2105): Abbild von
    /// `adapter_einsatz`, nur im Arbeitsspeicher.
    pub drohne: std::sync::Arc<crate::drohne::Store>,
}

/// Schalter, die nur das Routing betreffen (LFH-690).
///
/// Nicht im `AppState`, weil ein Feld dort jede Test-Konstruktion bräche und kein Handler den
/// Wert braucht. Kein prozessweiter `OnceLock`, weil der „aus“ und „an“ nicht im selben
/// Test-Binary prüfen ließe.
#[derive(Debug, Clone, Default)]
pub struct RouterOptionen {
    /// Registriert die Routen unter `/api/demo-data` (`--demo-daten`). Ohne den Schalter
    /// antworten sie wie jeder unbekannte `/api/`-Pfad mit 404, auch angemeldet.
    pub demo_daten: bool,
    /// Zeitbudget der Zulassungssteuerung; `None` = [`crate::zulassung::REQUEST_BUDGET`]. Nur
    /// Tests setzen es, um ohne Minuten Wartezeit zu belegen, welche Routen dem Budget entzogen
    /// sind (LFH-938).
    pub zulassungs_budget: Option<Duration>,
    /// Austauschverzeichnis des HEIC-Decoders (`--heic-decoder-verzeichnis`, LFH-1000); `None`
    /// = die eingebettete Fassung.
    pub heic_decoder_verzeichnis: Option<PathBuf>,
    /// Der Server terminiert TLS selbst (`--tls`). Nur der Einwurf fragt danach (ADR-0023): Er
    /// nimmt Aufrufe nur über TLS an, und `auth::session::cookie_secure()` taugt als Nachweis
    /// nicht, weil `--cookie-secure` es auch ohne TLS setzt.
    pub tls: bool,
    /// Einwürfe auch ohne TLS annehmen (`--einwurf-allow-http`), für ein Netz, das selbst
    /// verschlüsselt. Die Seite „Anbindungen“ warnt dann.
    pub einwurf_allow_http: bool,
}

/// Baut den Axum-Router mit allen Routen und dem geteilten Zustand, mit Vorgabe-Optionen (ohne
/// die bedingten Routen); s. [`build_router_mit`].
pub fn build_router(state: AppState) -> Router {
    build_router_mit(state, RouterOptionen::default())
}

/// Body-Grenze der öffentlichen Anmelde-Starts mit Body (Passwort-Login, Passkey-Start mit Namen;
/// LFH-921): ohne sie gälte `JSON_BODY_MAX` (256 KiB), und ein Unangemeldeter schickte
/// Namen in dieser Größe. Der discoverable Start liest keinen Body.
const AUTH_START_BODY_MAX: usize = 4 * 1024;

/// Body-Grenze der Passkey-Abschlüsse: eine Assertion liegt meist unter 2 KiB, mit Erweiterungen
/// auch darüber (LFH-921; Herleitung
/// `openspec/changes/archive/2026-10-05-lfh-921-981-anmeldung-benutzername/design.md`,
/// Entscheidung 6).
const AUTH_FINISH_BODY_MAX: usize = 16 * 1024;

/// Body-Grenze der übrigen öffentlichen Routen mit Body (Zweitfaktor, App-Code, Gerätekopplung;
/// LFH-1061): sie tragen nur einen kurzen Code (TOTP- oder Recovery-Code, Einmalcode samt
/// PKCE-`verifier` bis 128 Zeichen, Kopplungscode). Bemessen wie die Anmelde-Starts.
const AUTH_CODE_BODY_MAX: usize = 4 * 1024;

/// Body-Limit jeder Route ohne eigenes (LFH-1074, `src/AGENTS.md`, Eingabegrenzen). Kein
/// legitimer JSON-Body erreicht es: ETB-Eingänge tragen höchstens 80 KB, die übrigen weniger.
/// Darüber lehnt `JsonBody` mit 413 ab, bevor der Handler läuft.
pub const JSON_BODY_MAX: usize = 256 * 1024;

/// Body-Grenze der öffentlichen API unter `/api/v1/` (LLH-1653, Spec `oeffentliche-api-vertrag`):
/// Fremdsysteme schicken kurze JSON-Bodies (Alarmmeldung, Position, Rechner-Anfrage). Angewendet
/// in `public_api::mount`, also innen, vor `JSON_BODY_MAX`.
pub const PUBLIC_API_BODY_MAX: usize = 64 * 1024;

/// Schichtplan einlesen (LLH-1556): die Datei bis 2 MiB
/// (`abloesung::schichtplan::uebernahme::DATEI_MAX_BYTES`) plus Entscheidungen und Rahmen. So
/// bleibt die Prüfung der Datei (400 mit Meldung) die wirksame Grenze.
const SCHICHTPLAN_IMPORT_BODY_MAX: usize = 2 * 1024 * 1024 + 512 * 1024;

/// Zone anlegen und Abschnittsfläche setzen (LFH-1074): Geometrie bis 256 KiB
/// (`lage_zone::pruefe_geometrie_groesse`) plus Rahmen. So bleibt die Geometrieprüfung (400 mit
/// Feldmeldung) die wirksame Grenze.
const GEOMETRIE_BODY_MAX: usize = 256 * 1024 + 64 * 1024;

/// Absturzbericht des Clients (LLH-1822, `routes::client_fehler`): Routenmuster, Version, Meldung
/// bis 500 und Stack bis 2000 Zeichen passen auch mit Umlauten und Escapes hinein. Enger als
/// `JSON_BODY_MAX`, weil jede Sitzung den Bericht je Anfrage schicken kann.
pub const CLIENT_FEHLER_BODY_MAX: usize = 8 * 1024;

/// Wie [`build_router`], mit ausdrücklichen [`RouterOptionen`].
pub fn build_router_mit(state: AppState, opt: RouterOptionen) -> Router {
    // Grenzen der großen Transfers (LFH-938, `src/transfer.rs`): EINE Upload-Grenze für alle
    // Upload-Routen, je Download-Route eine eigene Grenze, deren Platz im Response-Body reist.
    // Beide Routenarten stehen in `zulassung::OHNE_ZULASSUNGSGRENZE`; `tests/zulassung_guard.rs`
    // verlangt das eine mit dem anderen. Als `route_layer`: die 405-Antwort des Fallbacks belegt
    // keinen Platz.
    let upload_grenze = axum::middleware::from_fn_with_state(
        crate::transfer::UploadGrenze::default(),
        crate::transfer::upload_grenze,
    );
    let download_grenze = || {
        axum::middleware::from_fn_with_state(
            crate::transfer::DownloadGrenze::default(),
            crate::transfer::download_grenze,
        )
    };

    let router = Router::new()
        .route("/api/health", get(routes::health::health))
        .route("/api/shell", get(routes::shell::load_shell))
        .route("/api/backup", get(routes::backup::download))
        .route("/api/system/storage", get(routes::system::datentraeger))
        .route(
            "/api/client-errors",
            post(routes::client_fehler::melde).layer(DefaultBodyLimit::max(CLIENT_FEHLER_BODY_MAX)),
        )
        .route(
            "/api/auth/login",
            post(routes::auth::login).layer(DefaultBodyLimit::max(AUTH_START_BODY_MAX)),
        )
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/auth/me", get(routes::auth::me))
        .route("/api/auth/providers", get(routes::auth::providers))
        .route(
            "/api/auth/providers/admin",
            get(routes::auth::providers_admin),
        )
        .route(
            "/api/auth/providers/{id}",
            put(routes::auth::provider_schalten),
        )
        .route(
            "/api/auth/app-code",
            post(routes::auth::app_code_ausstellen),
        )
        .route(
            "/api/auth/app-code/redeem",
            post(routes::auth::app_code_einloesen).layer(DefaultBodyLimit::max(AUTH_CODE_BODY_MAX)),
        )
        // LFH-892: ein Gerät löst seinen Kopplungscode ein (öffentlich, Rate-Limit je Quelle).
        .route(
            "/api/devices/pair",
            post(routes::geraet::koppeln).layer(DefaultBodyLimit::max(AUTH_CODE_BODY_MAX)),
        )
        .route("/api/auth/oidc/start", get(routes::auth::oidc_start))
        .route("/api/auth/oidc/callback", get(routes::auth::oidc_callback))
        .route(
            "/api/auth/webauthn/register/start",
            post(routes::auth::webauthn_register_start),
        )
        .route(
            "/api/auth/webauthn/register/finish",
            post(routes::auth::webauthn_register_finish),
        )
        .route(
            "/api/auth/webauthn/auth/start",
            post(routes::auth::webauthn_auth_start)
                .layer(DefaultBodyLimit::max(AUTH_START_BODY_MAX)),
        )
        .route(
            "/api/auth/webauthn/auth/finish",
            post(routes::auth::webauthn_auth_finish)
                .layer(DefaultBodyLimit::max(AUTH_FINISH_BODY_MAX)),
        )
        .route(
            "/api/auth/webauthn/discoverable/start",
            post(routes::auth::webauthn_discoverable_start),
        )
        .route(
            "/api/auth/webauthn/discoverable/finish",
            post(routes::auth::webauthn_discoverable_finish)
                .layer(DefaultBodyLimit::max(AUTH_FINISH_BODY_MAX)),
        )
        .route(
            "/api/auth/totp/enroll/start",
            post(routes::auth::totp_enroll_start),
        )
        .route(
            "/api/auth/totp/enroll/finish",
            post(routes::auth::totp_enroll_finish),
        )
        .route(
            "/api/auth/totp/finish",
            post(routes::auth::totp_finish).layer(DefaultBodyLimit::max(AUTH_CODE_BODY_MAX)),
        )
        .route("/api/auth/password", post(routes::auth::passwort_aendern))
        // LFH-1121: der Schritt nach einem Login mit Einmalpasswort (öffentlich, trägt das
        // Wechsel-Cookie statt einer Sitzung). Body-Grenze wie der Login: ein neues Passwort hat
        // höchstens 128 Zeichen.
        .route(
            "/api/auth/password/set",
            post(routes::auth::passwort_festlegen)
                .layer(DefaultBodyLimit::max(AUTH_START_BODY_MAX)),
        )
        .route("/api/auth/sessions", get(routes::sitzung::eigene_liste))
        .route(
            "/api/auth/sessions/end-others",
            post(routes::sitzung::eigene_andere_beenden),
        )
        .route(
            "/api/auth/sessions/{kennung}",
            delete(routes::sitzung::eigene_beenden),
        )
        .route(
            "/api/administration/inventory",
            get(routes::verwaltung::bereitschaft),
        )
        .route("/api/users", get(routes::benutzer::liste))
        .route("/api/users", post(routes::benutzer::anlegen))
        .route("/api/users/{id}", patch(routes::benutzer::bearbeiten))
        .route(
            "/api/users/{id}/deactivate",
            post(routes::benutzer::deaktivieren),
        )
        .route(
            "/api/users/{id}/totp/reset",
            post(routes::benutzer::totp_reset),
        )
        // LFH-1121: Einmalpasswort mit Änderungszwang. Nachweis tests/einmalpasswort.rs.
        .route(
            "/api/users/{id}/one-time-password",
            post(routes::benutzer::einmalpasswort),
        )
        // Zugangsprotokoll (LFH-1097): Anmelde- und Admin-Spur lesen, nur System-Admin, das
        // Lesen selbst unprotokolliert. Nachweis tests/zugangsprotokoll.rs.
        .route(
            "/api/access-log/logins",
            get(routes::zugangsprotokoll::anmeldungen),
        )
        .route(
            "/api/access-log/access-changes",
            get(routes::zugangsprotokoll::zugangsaenderungen),
        )
        .route(
            "/api/users/{id}/sessions",
            get(routes::sitzung::admin_liste),
        )
        .route(
            "/api/users/{id}/sessions/end",
            post(routes::sitzung::admin_alle_beenden),
        )
        .route(
            "/api/users/{id}/sessions/{kennung}",
            delete(routes::sitzung::admin_beenden),
        )
        .route("/api/release-notes", get(routes::versionsstand::lesen))
        .route(
            "/api/release-notes/read",
            post(routes::versionsstand::gelesen),
        )
        .route(
            "/api/user-settings",
            get(routes::benutzer_einstellungen::lesen),
        )
        .route(
            "/api/user-settings/{schluessel}",
            put(routes::benutzer_einstellungen::setzen),
        )
        // Benachrichtigungen (LLH-1207, design.md D2): nur die eigene Empfängerzeile, fremd 404.
        .route("/api/notifications", get(routes::benachrichtigung::liste))
        .route(
            "/api/notifications/{id}",
            get(routes::benachrichtigung::lesen),
        )
        .route(
            "/api/notifications/{id}/acknowledge",
            post(routes::benachrichtigung::quittieren),
        )
        // Verlauf und „alle gelesen“ eines Einsatzes (LLH-1143, design.md D3/D4).
        .route(
            "/api/einsaetze/{id}/notifications",
            get(routes::benachrichtigung::verlauf),
        )
        .route(
            "/api/einsaetze/{id}/notifications/read",
            post(routes::benachrichtigung::gelesen),
        )
        // Vorgabe je Funktion am Einsatz (LLH-1421, design.md D4).
        .route(
            "/api/einsaetze/{id}/notification-defaults",
            get(routes::benachrichtigung::vorgaben_laden),
        )
        .route(
            "/api/einsaetze/{id}/notification-defaults/{art}",
            put(routes::benachrichtigung::vorgabe_setzen),
        )
        // Web Push (LLH-1223): ohne `--web-push` 404 aus dem Handler.
        .route("/api/web-push", get(routes::web_push::stand))
        .route(
            "/api/web-push/subscription",
            put(routes::web_push::anmelden).delete(routes::web_push::abmelden),
        )
        // iOS-Push (LLH-2040): ohne `--ios-push` 404 aus dem Handler. `unregister` ist öffentlich
        // (kein `CurrentUser`): das Gerät beweist den Besitz mit dem Nachweis aus seinem Schlüssel.
        .route("/api/ios-push", get(routes::ios_push::stand))
        .route(
            "/api/ios-push/registration",
            put(routes::ios_push::anmelden).delete(routes::ios_push::abmelden),
        )
        .route(
            "/api/ios-push/unregister",
            post(routes::ios_push::abmelden_mit_nachweis)
                .layer(DefaultBodyLimit::max(AUTH_CODE_BODY_MAX)),
        )
        .route("/api/einsaetze", get(routes::einsatz::liste))
        .route("/api/einsaetze", post(routes::einsatz::anlegen))
        .route(
            "/api/einsaetze/member-selection",
            get(routes::einsatz::mitglied_auswahl_anlage),
        )
        .route("/api/einsaetze/{id}", get(routes::einsatz::detail))
        .route("/api/einsaetze/{id}", patch(routes::einsatz::aktualisieren))
        .route(
            "/api/einsaetze/{id}/close",
            post(routes::einsatz::abschliessen),
        )
        // LLH-1814: binnen 24 Stunden wieder öffnen (Einsatzleitung oder Admin der Einsatz-Org).
        .route(
            "/api/einsaetze/{id}/reopen",
            post(routes::einsatz::wiedereroeffnen),
        )
        // LLH-1814: offene Punkte vor dem Abschluss (nur Einsatzleitung, aktiv).
        .route(
            "/api/einsaetze/{id}/closure/check",
            get(routes::einsatz::abschluss_pruefung),
        )
        .route(
            "/api/einsaetze/{id}/command-post",
            get(routes::einsatz_fuehrungsstelle::lesen)
                .patch(routes::einsatz_fuehrungsstelle::aendern),
        )
        // Präsenz an Einzelangaben (LLH-1946): nur Speicher, Gate wie der PATCH daneben.
        .route(
            "/api/einsaetze/{id}/presence",
            put(routes::praesenz::einsatz_melden).delete(routes::praesenz::einsatz_beenden),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/presence",
            put(routes::praesenz::einheit_melden).delete(routes::praesenz::einheit_beenden),
        )
        // Programmpunkte der Veranstaltung (LLH-1570): Lesen mit dem Einsatz, Schreiben mit den
        // Rechten der Kopfdaten.
        .route(
            "/api/einsaetze/{id}/agenda-items",
            get(routes::programmpunkt::liste).post(routes::programmpunkt::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/agenda-items/{pid}",
            patch(routes::programmpunkt::aendern).delete(routes::programmpunkt::loeschen),
        )
        // LFH-893: Einzel-Zuordnung (design.md D5), neben dem PATCH mit `sprechgruppe_ids`.
        .route(
            "/api/einsaetze/{id}/command-post/talk-groups/{sg}",
            put(routes::einsatz_fuehrungsstelle::sprechgruppe_zuordnen)
                .delete(routes::einsatz_fuehrungsstelle::sprechgruppe_loesen),
        )
        .route(
            "/api/einsaetze/{id}/retention-period",
            put(routes::einsatz::aufbewahrungsfrist_setzen),
        )
        .route(
            "/api/einsaetze/{id}/follow-up",
            put(routes::einsatz::nachbereitung_setzen),
        )
        .route(
            "/api/einsaetze/{id}/retention-period/{kategorie}",
            put(routes::einsatz::kategorie_frist_setzen),
        )
        .route(
            "/api/einsaetze/{id}/retention-categories",
            get(routes::einsatz::kategorien_lesen),
        )
        .route(
            "/api/einsaetze/{id}/settings",
            get(routes::einsatz::einstellungen_laden).put(routes::einsatz::einstellungen_setzen),
        )
        .route(
            "/api/einsaetze/{id}/accommodation-guidelines",
            get(routes::unterkunft_richtwerte::einsatz_lesen),
        )
        .route(
            "/api/einsaetze/{id}/accommodation-guidelines/{schluessel}",
            put(routes::unterkunft_richtwerte::einsatz_setzen),
        )
        .route(
            "/api/einsaetze/{id}/module-overrides",
            get(routes::einsatz::modul_overrides_laden),
        )
        .route(
            "/api/einsaetze/{id}/module-access",
            get(routes::einsatz::modul_freigaben_laden),
        )
        .route(
            "/api/einsaetze/{id}/module-defaults",
            get(routes::einsatz::load_modul_vorgaben),
        )
        .route(
            "/api/einsaetze/{id}/module-overrides/{modul_key}",
            put(routes::einsatz::modul_override_setzen),
        )
        .route(
            "/api/einsaetze/{id}/members",
            get(routes::einsatz::mitglieder),
        )
        // Statisches Segment vor `{benutzer_id}` (LFH-1141); Kennungen sind Zahlen.
        .route(
            "/api/einsaetze/{id}/members/selection",
            get(routes::einsatz::mitglied_auswahl),
        )
        .route(
            "/api/einsaetze/{id}/members/{benutzer_id}",
            put(routes::einsatz::mitglied_setzen),
        )
        .route(
            "/api/einsaetze/{id}/members/{benutzer_id}",
            delete(routes::einsatz::mitglied_entfernen),
        )
        .route("/api/einsaetze/{id}/etb", post(routes::etb::erfassen))
        // Kanonischer Live-Feed des Einsatzes; die Modul-Berechtigung wirkt als Filter je Event
        // statt
        // als Gate der Route.
        .route("/api/einsaetze/{id}/live", get(routes::live::stream))
        // Org-Strom für Tabs außerhalb eines Einsatzes (LFH-734); bewusst NICHT unter
        // `/api/einsaetze/`, damit er weder mit `{id}` noch mit `PFAD_KEY` kollidiert.
        .route("/api/live", get(routes::live::org_stream))
        // Modulzähler: modul-lose Gate-Route wie `/live`, die Modulrechte filtern die Felder.
        .route(
            "/api/einsaetze/{id}/module-counts",
            get(routes::modul_zaehler::liste),
        )
        // Lagebild des Lagemonitors (LFH-892): modul-los, nur für die Ansicht `lagemonitor`.
        .route(
            "/api/einsaetze/{id}/situation-monitor",
            get(routes::lagemonitor::lagebild),
        )
        .route("/api/einsaetze/{id}/etb", get(routes::etb::liste))
        .route("/api/einsaetze/{id}/etb/counts", get(routes::etb::zaehler))
        .route("/api/einsaetze/{id}/etb/count", get(routes::etb::anzahl))
        .route(
            "/api/einsaetze/{id}/etb/read-marker",
            get(routes::etb::lesemarke).post(routes::etb::lesemarke_setzen),
        )
        .route(
            "/api/einsaetze/{id}/etb/{eintrag_id}/task",
            post(routes::etb::auftrag_erteilen),
        )
        // ETB-Anhänge: Upload mit Body-Limit (die Vorgabe von 2 MiB kappte still) und Upload-Grenze,
        // Download mit Download-Grenze.
        .route(
            "/api/einsaetze/{id}/etb/attachments",
            post(routes::etb::anhang_hochladen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/etb/{eintrag_id}/attachments/{aid}",
            get(routes::etb::anhang_herunterladen).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/chat/channels",
            get(routes::chat::kanaele_liste),
        )
        .route(
            "/api/einsaetze/{id}/chat/channels",
            post(routes::chat::kanal_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/chat/channels/{kid}/messages",
            get(routes::chat::nachrichten_liste),
        )
        .route(
            "/api/einsaetze/{id}/chat/channels/{kid}/messages",
            post(routes::chat::nachricht_erfassen),
        )
        .route(
            "/api/einsaetze/{id}/chat/channels/{kid}/read",
            post(routes::chat::kanal_gelesen_markieren),
        )
        .route(
            "/api/einsaetze/{id}/chat/messages/{mid}",
            patch(routes::chat::nachricht_bearbeiten),
        )
        .route(
            "/api/einsaetze/{id}/chat/messages/{mid}",
            delete(routes::chat::nachricht_loeschen),
        )
        .route(
            "/api/einsaetze/{id}/chat/messages/{mid}/promote-to-etb",
            post(routes::chat::heraufstufen),
        )
        .route(
            "/api/einsaetze/{id}/chat/messages/{mid}/promote-to-task",
            post(routes::chat::heraufstufen_auftrag),
        )
        .route(
            "/api/einsaetze/{id}/chat/messages/{mid}/reference",
            put(routes::chat::bezug_setzen),
        )
        .route(
            "/api/einsaetze/{id}/chat/messages/{mid}/reference",
            delete(routes::chat::bezug_loeschen),
        )
        // Generische Anhänge. Body-Limit etwas über MAX_GROESSE (25 MiB) für den
        // Multipart-Overhead.
        .route(
            "/api/einsaetze/{id}/attachments",
            post(routes::anhang::hochladen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/attachments/{aid}",
            get(routes::anhang::herunterladen).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/attachments/{aid}",
            delete(routes::anhang::loeschen),
        )
        // Dokumentenablage: eigener Präfix mit Modul-Gate; Upload/Download wie Anhänge.
        .route(
            "/api/einsaetze/{id}/documents",
            get(routes::dokument::liste),
        )
        .route(
            "/api/einsaetze/{id}/documents",
            post(routes::dokument::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/documents/{did}",
            delete(routes::dokument::entfernen).patch(routes::dokument::aendern),
        )
        .route(
            "/api/einsaetze/{id}/documents/{did}/file",
            get(routes::dokument::datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/reminders",
            get(routes::erinnerung::liste),
        )
        .route(
            "/api/einsaetze/{id}/reminders",
            post(routes::erinnerung::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/reminders/metrics",
            get(routes::erinnerung::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/reminders/{eid}/complete",
            post(routes::erinnerung::erledigen),
        )
        .route(
            "/api/einsaetze/{id}/reminders/{eid}/acknowledge",
            post(routes::erinnerung::quittieren),
        )
        .route(
            "/api/einsaetze/{id}/reminders/{eid}/reopen",
            post(routes::erinnerung::oeffnen),
        )
        .route("/api/einsaetze/{id}/tasks", get(routes::auftrag::liste))
        .route(
            "/api/einsaetze/{id}/tasks/metrics",
            get(routes::auftrag::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/tasks/{aid}",
            get(routes::auftrag::detail).patch(routes::auftrag::berichtigen),
        )
        .route("/api/einsaetze/{id}/tasks", post(routes::auftrag::anlegen))
        .route(
            "/api/einsaetze/{id}/tasks/{aid}/recipients/{empf}/acknowledge",
            post(routes::auftrag::quittieren),
        )
        .route(
            "/api/einsaetze/{id}/tasks/{aid}/execution",
            post(routes::auftrag::vollzug),
        )
        .route(
            "/api/einsaetze/{id}/tasks/{aid}/accept",
            post(routes::auftrag::abnehmen),
        )
        .route(
            "/api/einsaetze/{id}/tasks/{aid}/void",
            post(routes::auftrag::aufheben),
        )
        // Gewählte Lagekennzahlen (LLH-1371): Lageplatz B des Kennzahlenbands, Gate `OhneModul`.
        .route(
            "/api/einsaetze/{id}/situation-metric-selection",
            put(routes::lagekennzahl_wahl::setzen),
        )
        // Maßgebliche Pegel: Kennzahl für Dashboard und Überblick, Gate `OhneModul`.
        .route(
            "/api/einsaetze/{id}/gauges",
            get(routes::pegel::liste)
                .put(routes::pegel::ersetzen)
                .post(routes::pegel::anfuegen),
        )
        // 24-h-Verlauf je Pegel, modul-los wie die Liste. Das statische Segment `verlauf` schlägt
        // `{pegel_id}`.
        .route(
            "/api/einsaetze/{id}/gauges/history",
            get(routes::pegel::verlauf),
        )
        // Wetter am Einsatzort, am Modul `wetter-pegel` gegatet. Ein Quellausfall ist kein
        // HTTP-Fehler, sondern ein Zustand je Teil.
        .route("/api/einsaetze/{id}/weather", get(routes::wetter::anzeige))
        // Prognose am einzelnen Pegel: eigene Routen, nicht im Vollersatz-PUT.
        .route(
            "/api/einsaetze/{id}/gauges/{pegel_id}/forecast",
            put(routes::pegel::prognose_setzen).delete(routes::pegel::prognose_loeschen),
        )
        .route(
            "/api/einsaetze/{id}/gauges/{pegel_id}/prediction",
            get(routes::pegel::vorhersage_lesen),
        )
        // Stab (S1–S6) und Ablösung. `vorgaben` steht vor `{aid}` nur zur Lesbarkeit.
        .route(
            "/api/einsaetze/{id}/reliefs",
            get(routes::abloesung::liste).post(routes::abloesung::beginnen),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/defaults",
            get(routes::abloesung::vorgaben),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/defaults/{abschnitt_id}",
            put(routes::abloesung::vorgabe_setzen),
        )
        // Vorgabe des Einsatzes (LLH-1122): Kopie eines Schichtmodells.
        .route(
            "/api/einsaetze/{id}/reliefs/shift-model",
            get(routes::abloesung::read_einsatz_vorgabe)
                .put(routes::abloesung::set_einsatz_vorgabe),
        )
        // Schichtplan (LLH-1552): `schichtplan` ist ein festes Segment neben `{aid}`.
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan",
            get(routes::abloesung_schichtplan::lesen),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/blocks",
            post(routes::abloesung_schichtplan::create_block),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/blocks/{bid}",
            patch(routes::abloesung_schichtplan::update_block)
                .delete(routes::abloesung_schichtplan::delete_block),
        )
        // Wechsel aus dem Plan an einer UHS und in der Pause (LLH-1555).
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/blocks/{bid}/handovers",
            get(routes::abloesung_schichtplan::wechsel_vorlage)
                .post(routes::abloesung_schichtplan::wechsel_vollziehen),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/handovers/{wid}/undo",
            post(routes::abloesung_schichtplan::wechsel_zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/generate",
            post(routes::abloesung_schichtplan::erzeugen),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/limits",
            patch(routes::abloesung_schichtplan::update_grenzwerte),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/helpers",
            post(routes::abloesung_schichtplan::create_helfer),
        )
        // Schichtplan als Excel-Mappe (LLH-1557): nur Lesen.
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/export",
            get(routes::abloesung_schichtplan::export),
        )
        // Schichtplan einlesen (LLH-1556): Multipart mit der Datei (höchstens 2 MiB) und den
        // Entscheidungen; die Datei-Grenze selbst prüft `uebernahme::datei` (400).
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/import/preview",
            post(routes::abloesung_schichtplan::import_vorschau)
                .layer(DefaultBodyLimit::max(SCHICHTPLAN_IMPORT_BODY_MAX)),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/import",
            post(routes::abloesung_schichtplan::import_uebernehmen)
                .layer(DefaultBodyLimit::max(SCHICHTPLAN_IMPORT_BODY_MAX)),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/shift-plan/helpers/{hid}",
            patch(routes::abloesung_schichtplan::update_helfer)
                .delete(routes::abloesung_schichtplan::delete_helfer),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/{aid}",
            patch(routes::abloesung::aendern),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/{aid}/plan-template",
            get(routes::abloesung::plan_vorlage),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/{aid}/execution",
            post(routes::abloesung::vollziehen),
        )
        .route(
            "/api/einsaetze/{id}/reliefs/{aid}/execution/undo",
            post(routes::abloesung::zuruecknehmen),
        )
        // Betreuung: Betreuungsstellen mit ihrer Belegungsreihe. Rücknahmen hängen an der Meldung;
        // die Stelle kennt die Route erst aus ihr.
        .route(
            "/api/einsaetze/{id}/care",
            get(routes::betreuung::uebersicht),
        )
        .route(
            "/api/einsaetze/{id}/care/occupancy",
            get(routes::betreuung::kopfzahl),
        )
        // Modul Evakuierung (LLH-1034): die Bezirksrouten sind aus `…/betreuung` umgezogen.
        .route(
            "/api/einsaetze/{id}/evacuation",
            get(routes::evakuierung::uebersicht),
        )
        .route(
            "/api/einsaetze/{id}/evacuation/districts",
            post(routes::evakuierung::bezirk_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/evacuation/districts/{bid}",
            patch(routes::evakuierung::bezirk_aendern),
        )
        .route(
            "/api/einsaetze/{id}/evacuation/districts/{bid}/annul",
            post(routes::evakuierung::bezirk_stornieren),
        )
        .route(
            "/api/einsaetze/{id}/evacuation/districts/{bid}/progress",
            get(routes::evakuierung::stand_verlauf).post(routes::evakuierung::stand_melden),
        )
        .route(
            "/api/einsaetze/{id}/evacuation/progress/{sid}/undo",
            post(routes::evakuierung::stand_zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/care/positions",
            post(routes::betreuung::stelle_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}",
            patch(routes::betreuung::stelle_aendern),
        )
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/annul",
            post(routes::betreuung::stelle_stornieren),
        )
        // Storno-Stand für die offene Detailseite (LLH-1832).
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/state",
            get(routes::betreuung::stelle_stand),
        )
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/occupancies",
            get(routes::betreuung::belegung_verlauf).post(routes::betreuung::belegung_melden),
        )
        .route(
            "/api/einsaetze/{id}/care/occupancies/{mid}/undo",
            post(routes::betreuung::belegung_zuruecknehmen),
        )
        // Registrierstelle (LLH-1612, Spec `betreuung-registrierung`).
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/registrations",
            get(routes::betreuung_registrierung::liste)
                .post(routes::betreuung_registrierung::registrieren),
        )
        // Registrierliste drucken (LLH-1616): je Person protokolliert.
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/registrations/print",
            get(routes::betreuung_registrierung::druck),
        )
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/departures",
            post(routes::betreuung_registrierung::abmelden),
        )
        // Haushalte umbauen (LLH-1615): Bezugsperson wechseln, Person umhängen.
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/households/{hid}/contact-person",
            put(routes::betreuung_registrierung::bezugsperson_setzen),
        )
        .route(
            "/api/einsaetze/{id}/care/positions/{sid}/persons/{pid}/household",
            put(routes::betreuung_registrierung::haushalt_aendern),
        )
        .route(
            "/api/einsaetze/{id}/care/diets",
            get(routes::betreuung_registrierung::kostformen),
        )
        // Verpflegung: Zeitfenster mit Bedarf, Ausgaben dagegen.
        .route(
            "/api/einsaetze/{id}/catering",
            get(routes::verpflegung::uebersicht),
        )
        .route(
            "/api/einsaetze/{id}/catering/time-slots",
            post(routes::verpflegung::zeitfenster_anlegen),
        )
        // Tag aus der Vorlage (LLH-1058): mehrere Zeitfenster eines Tages in einer Transaktion.
        .route(
            "/api/einsaetze/{id}/catering/time-slots/from-template",
            post(routes::verpflegung::zeitfenster_aus_vorlage),
        )
        .route(
            "/api/einsaetze/{id}/catering/time-slots/{zid}",
            patch(routes::verpflegung::zeitfenster_aendern)
                .delete(routes::verpflegung::zeitfenster_loeschen),
        )
        .route(
            "/api/einsaetze/{id}/catering/time-slots/{zid}/distributions",
            post(routes::verpflegung::ausgabe_erfassen),
        )
        .route(
            "/api/einsaetze/{id}/catering/distributions/{aid}/undo",
            post(routes::verpflegung::ausgabe_zuruecknehmen),
        )
        // Verpflegungsstellen (LLH-1040): keine eigene Leseroute, `stellen[]` kommt mit
        // `GET …/catering`.
        .route(
            "/api/einsaetze/{id}/catering/positions",
            post(routes::verpflegung::create_stelle),
        )
        .route(
            "/api/einsaetze/{id}/catering/positions/{sid}",
            patch(routes::verpflegung::update_stelle)
                .delete(routes::verpflegung::stelle_stornieren),
        )
        .route(
            "/api/einsaetze/{id}/catering/positions/{sid}/status",
            post(routes::verpflegung::update_stelle_status),
        )
        // LLH-1111: Lagebesprechung als eigenes Modul (Termin, Abschluss, Verlauf).
        .route(
            "/api/einsaetze/{id}/briefing",
            get(routes::lagebesprechung::load),
        )
        .route(
            "/api/einsaetze/{id}/briefing/schedule",
            put(routes::lagebesprechung::set_termin),
        )
        .route(
            "/api/einsaetze/{id}/briefings",
            get(routes::lagebesprechung::list).post(routes::lagebesprechung::abschliessen),
        )
        .route(
            "/api/einsaetze/{id}/staff/info-line",
            get(routes::infotelefon::liste).post(routes::infotelefon::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/staff/info-line/counts",
            get(routes::infotelefon::zaehler),
        )
        .route(
            "/api/einsaetze/{id}/staff/info-line/{aid}",
            get(routes::infotelefon::detail),
        )
        .route(
            "/api/einsaetze/{id}/staff/info-line/{aid}/status",
            post(routes::infotelefon::status_setzen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-plan",
            get(routes::fernmeldewesen::kommunikationsplan_laden),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-plan/positions",
            post(routes::fernmeldewesen::kommunikationsplan_stelle_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-plan/positions/{sid}",
            patch(routes::fernmeldewesen::kommunikationsplan_stelle_aendern)
                .delete(routes::fernmeldewesen::kommunikationsplan_stelle_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-plan/positions/{sid}/connections",
            post(routes::fernmeldewesen::kommunikationsplan_verbindung_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-plan/connections/{vid}",
            patch(routes::fernmeldewesen::kommunikationsplan_verbindung_aendern)
                .delete(routes::fernmeldewesen::kommunikationsplan_verbindung_entfernen),
        )
        // LFH-893: Kanäle externer Stellen und taktische Fernmeldeskizze (design.md D14).
        .route(
            "/api/einsaetze/{id}/staff/comms-plan/positions/{sid}/talk-groups/{sg}",
            put(routes::fernmeldewesen::kommunikationsplan_kanal_setzen)
                .delete(routes::fernmeldewesen::kommunikationsplan_kanal_loesen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch",
            get(routes::fernmeldewesen::fernmeldeskizze_laden),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/layout",
            delete(routes::fernmeldewesen::fernmeldeskizze_lage_verwerfen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/layout/{element}",
            put(routes::fernmeldewesen::fernmeldeskizze_lage_setzen)
                .delete(routes::fernmeldewesen::fernmeldeskizze_lage_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/title-block",
            put(routes::fernmeldewesen::fernmeldeskizze_schriftfeld_setzen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/components",
            post(routes::fernmeldewesen::fernmeldeskizze_komponente_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/components/{kid}",
            patch(routes::fernmeldewesen::fernmeldeskizze_komponente_aendern)
                .delete(routes::fernmeldewesen::fernmeldeskizze_komponente_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/components/{kid}/talk-groups/{sg}",
            put(routes::fernmeldewesen::fernmeldeskizze_komponente_kanal_setzen)
                .delete(routes::fernmeldewesen::fernmeldeskizze_komponente_kanal_loesen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/connections",
            post(routes::fernmeldewesen::fernmeldeskizze_verbindung_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/connections/{vid}",
            patch(routes::fernmeldewesen::fernmeldeskizze_verbindung_aendern)
                .delete(routes::fernmeldewesen::fernmeldeskizze_verbindung_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/areas",
            post(routes::fernmeldewesen::fernmeldeskizze_bereich_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/staff/comms-sketch/areas/{bid}",
            patch(routes::fernmeldewesen::fernmeldeskizze_bereich_aendern)
                .delete(routes::fernmeldewesen::fernmeldeskizze_bereich_entfernen),
        )
        .route("/api/einsaetze/{id}/reports", get(routes::meldung::liste))
        .route(
            "/api/einsaetze/{id}/reports/check-ins",
            get(routes::meldung::rueckmeldungen),
        )
        .route(
            "/api/einsaetze/{id}/reports/metrics",
            get(routes::meldung::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/reports/{mid}",
            get(routes::meldung::detail).patch(routes::meldung_korrektur::korrigieren),
        )
        .route(
            "/api/einsaetze/{id}/reports",
            post(routes::meldung::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/reports/{mid}/status",
            post(routes::meldung::status),
        )
        .route(
            "/api/einsaetze/{id}/reports/{mid}/assign",
            post(routes::meldung::zuweisen),
        )
        .route(
            "/api/einsaetze/{id}/reports/{mid}/confirm",
            post(routes::meldung::bestaetigen),
        )
        .route(
            "/api/einsaetze/{id}/reports/{mid}/situation-relevant",
            post(routes::meldung::lagerelevant),
        )
        .route(
            "/api/einsaetze/{id}/reports/{mid}/task",
            post(routes::meldung::auftrag_erteilen),
        )
        .route(
            "/api/einsaetze/{id}/situation/reports",
            get(routes::meldung::lage_liste),
        )
        // Kenntnisnahme über die Kennung der Meldung (LLH-1031); die alten Pfade mit der Kennung
        // des Lageobjekts gibt es nicht mehr.
        .route(
            "/api/einsaetze/{id}/situation/seen",
            post(routes::meldung::lage_angezeigte_gesehen),
        )
        .route(
            "/api/einsaetze/{id}/reports/{mid}/situation-seen",
            post(routes::meldung::lage_gesehen),
        )
        .route(
            "/api/einsaetze/{id}/place-preview",
            get(routes::ort_vorschau::vorschau),
        )
        // Ortssuche des Ortsfelds (LFH-1175): Recht der Einsatzdaten, kein Modul.
        .route(
            "/api/einsaetze/{id}/place-search",
            get(routes::ort_suche::im_einsatz),
        )
        .route(
            "/api/einsaetze/{id}/resource-requests",
            get(routes::nachforderung::liste),
        )
        .route(
            "/api/einsaetze/{id}/resource-requests",
            post(routes::nachforderung::anlegen),
        )
        // Übliche Arten der Organisation (LLH-1379): Lesetür der Liste, keine Geräteroute.
        .route(
            "/api/einsaetze/{id}/resource-requests/types",
            get(routes::nachforderung::arten),
        )
        .route(
            "/api/einsaetze/{id}/resource-requests/{nid}/status",
            post(routes::nachforderung::status),
        )
        .route(
            "/api/einsaetze/{id}/resource-requests/{nid}/decline",
            post(routes::nachforderung::ablehnen),
        )
        .route(
            "/api/einsaetze/{id}/resource-requests/{nid}/commitment",
            post(routes::nachforderung::zusage),
        )
        .route(
            "/api/einsaetze/{id}/resource-requests/{nid}/withdraw",
            post(routes::nachforderung::zurueckziehen),
        )
        .route(
            "/api/einsaetze/{id}/resource-requests/{nid}",
            patch(routes::nachforderung::bearbeiten),
        )
        .route(
            "/api/einsaetze/{id}/vehicles",
            get(routes::einsatz_fahrzeug::liste),
        )
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/position",
            patch(routes::einsatz_fahrzeug::position),
        )
        .route(
            "/api/einsaetze/{id}/vehicles",
            post(routes::einsatz_fahrzeug::disponieren),
        )
        // LLH-1100: mehrere Stamm-Fahrzeuge in einem Schritt, optional in eine Einheit.
        .route(
            "/api/einsaetze/{id}/vehicles/bulk",
            post(routes::einsatz_fahrzeug::sammel_disponieren),
        )
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}",
            patch(routes::einsatz_fahrzeug::update),
        )
        // LLH-1079 Teil II: entlassen statt löschen; Storno und erneutes Disponieren.
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/stand-down",
            post(routes::einsatz_fahrzeug::entlassen),
        )
        // LLH-1722: „Rückgängig“ nach dem Entlassen nimmt den Vorzustand vollständig zurück.
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/stand-down/undo",
            post(routes::einsatz_fahrzeug::zuruecknehmen),
        )
        // LLH-1781: „Rückgängig“ nach einem Statuswechsel.
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/status/undo",
            post(routes::einsatz_fahrzeug::status_zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/annul",
            post(routes::einsatz_fahrzeug::stornieren),
        )
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/reactivate",
            post(routes::einsatz_fahrzeug::reaktivieren),
        )
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/crew",
            post(routes::einsatz_fahrzeug::besatzung_uebernehmen),
        )
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/crew/{ep_id}",
            put(routes::einsatz_fahrzeug::besatzung_zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/vehicles/{ef_id}/crew/{ep_id}",
            delete(routes::einsatz_fahrzeug::besatzung_freigeben),
        )
        .route(
            "/api/einsaetze/{id}/personnel",
            get(routes::einsatz_personal::liste),
        )
        .route(
            "/api/einsaetze/{id}/personnel",
            post(routes::einsatz_personal::disponieren),
        )
        // LLH-1100: mehrere Stamm-Personen in einem Schritt, optional in Einheit und Fahrzeug.
        .route(
            "/api/einsaetze/{id}/personnel/bulk",
            post(routes::einsatz_personal::sammel_disponieren),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}",
            patch(routes::einsatz_personal::update),
        )
        // LLH-1079: entlassen statt löschen; Storno und erneutes Disponieren.
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/status/undo",
            post(routes::einsatz_personal::status_zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/stand-down",
            post(routes::einsatz_personal::entlassen),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/stand-down/undo",
            post(routes::einsatz_personal::zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/annul",
            post(routes::einsatz_personal::stornieren),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/reactivate",
            post(routes::einsatz_personal::reaktivieren),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/position",
            patch(routes::einsatz_personal::position),
        )
        // Kräfte-Zeitachse (LFH-552) unter dem Personal-Präfix.
        .route(
            "/api/einsaetze/{id}/personnel/timeline",
            get(routes::zeitachse::personal_perioden),
        )
        .route(
            "/api/einsaetze/{id}/personnel/timeline/limits",
            get(routes::zeitachse::personal_grenzwerte),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/timeline",
            get(routes::zeitachse::person_laden).post(routes::zeitachse::person_nachtragen),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/timeline/{zid}/strike",
            post(routes::zeitachse::person_streichen),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/timeline/{zid}/correct",
            post(routes::zeitachse::person_berichtigen),
        )
        .route(
            "/api/einsaetze/{id}/personnel/{ep_id}/timeline/period",
            post(routes::zeitachse::person_periode_nachtragen),
        )
        .route(
            "/api/einsaetze/{id}/map/commanders",
            get(routes::einsatz_personal::karte_fuehrungskraefte),
        )
        // Adresssuche der Lagekarte (LFH-638): Forward-Geocoding, am Modul Lagekarte (`/karte`).
        .route(
            "/api/einsaetze/{id}/map/place-search",
            get(routes::karte_ort_suche::ort_suche),
        )
        .route(
            "/api/einsaetze/{id}/material",
            get(routes::einsatz_material::liste),
        )
        .route(
            "/api/einsaetze/{id}/material",
            post(routes::einsatz_material::disponieren),
        )
        .route(
            "/api/einsaetze/{id}/material/{em_id}",
            patch(routes::einsatz_material::update),
        )
        // LLH-1079 Teil II: aus dem Einsatz nehmen statt löschen; Storno und erneutes Disponieren.
        .route(
            "/api/einsaetze/{id}/material/{em_id}/stand-down",
            post(routes::einsatz_material::entlassen),
        )
        // LLH-1923: „Rückgängig“ nach dem Herausnehmen, mit dem Vorzustand aus der Antwort.
        .route(
            "/api/einsaetze/{id}/material/{em_id}/stand-down/undo",
            post(routes::einsatz_material::zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/material/{em_id}/annul",
            post(routes::einsatz_material::stornieren),
        )
        .route(
            "/api/einsaetze/{id}/material/{em_id}/reactivate",
            post(routes::einsatz_material::reaktivieren),
        )
        // LLH-1259: einen vorhandenen Posten nachträglich mit einer Nachforderung verknüpfen;
        // LLH-1403: den Bezug wieder lösen.
        .route(
            "/api/einsaetze/{id}/material/{em_id}/resource-request",
            post(routes::einsatz_material::verknuepfen).delete(routes::einsatz_material::loesen),
        )
        .route(
            "/api/einsaetze/{id}/material/{em_id}/status/undo",
            post(routes::einsatz_material::status_zuruecknehmen),
        )
        // LLH-1093: einen Posten auf zwei Zeilen aufteilen.
        .route(
            "/api/einsaetze/{id}/material/{em_id}/split",
            post(routes::einsatz_material::aufteilen),
        )
        .route(
            "/api/einsaetze/{id}/persons",
            get(routes::einsatz_person::liste),
        )
        .route(
            "/api/einsaetze/{id}/persons",
            post(routes::einsatz_person::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/persons/selection",
            get(routes::einsatz_person::auswahl),
        )
        .route(
            "/api/einsaetze/{id}/persons/transport-means",
            get(routes::einsatz_person::transportmittel),
        )
        .route(
            "/api/einsaetze/{id}/persons/whereabouts-details",
            get(routes::einsatz_person::verbleib_angaben),
        )
        .route(
            "/api/einsaetze/{id}/persons/units",
            get(routes::einsatz_person::einheiten),
        )
        .route(
            "/api/einsaetze/{id}/persons/uhs",
            get(routes::einsatz_person::uhs_ziele),
        )
        .route(
            "/api/einsaetze/{id}/persons/confirmers",
            get(routes::einsatz_person::bestaetiger),
        )
        .route(
            "/api/einsaetze/{id}/persons/export",
            get(routes::einsatz_person::export),
        )
        .route(
            "/api/einsaetze/{id}/case-file/attachments.zip",
            get(routes::einsatzakte::anlagen_zip),
        )
        .route(
            "/api/einsaetze/{id}/persons/print",
            get(routes::einsatz_person::druck),
        )
        .route(
            "/api/einsaetze/{id}/persons/list-accesses",
            get(routes::einsatz_person::listenzugriffe),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/print",
            get(routes::einsatz_person::detail_druck),
        )
        // Zeilenabruf des Live-Abgleichs (LLH-1682): nicht protokolliert wie die Liste.
        .route(
            "/api/einsaetze/{id}/persons/{pid}/row",
            get(routes::einsatz_person::zeile),
        )
        // Storno-Stand für die offene Detailseite, ohne Zugriffsprotokoll (LLH-1832).
        .route(
            "/api/einsaetze/{id}/persons/{pid}/state",
            get(routes::einsatz_person::stand),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}",
            get(routes::einsatz_person::detail),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}",
            patch(routes::einsatz_person::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/status",
            post(routes::einsatz_person::status_wechsel),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/triage",
            post(routes::einsatz_person::sichten),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/whereabouts",
            post(routes::einsatz_person::verbleib),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/notes",
            post(routes::einsatz_person::notiz),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/transport",
            post(routes::person_transport::festlegen),
        )
        // LLH-1566: Anlass der Hilfeleistung (Kategorie Behandlung, kein ETB).
        .route(
            "/api/einsaetze/{id}/persons/{pid}/reason",
            post(routes::person_anlass::festlegen),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/interventions",
            post(routes::person_massnahme::erfassen),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/interventions/{mid}/void",
            post(routes::person_massnahme::aufheben),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/injuries",
            post(routes::person_verletzung::markieren),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/injuries/{vid}/void",
            post(routes::person_verletzung::aufheben),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/matches",
            post(routes::einsatz_person::abgleich_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/matches/{aid}/decision",
            post(routes::einsatz_person::abgleich_entscheiden),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/audit",
            get(routes::einsatz_person::audit),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}",
            delete(routes::einsatz_person::stornieren),
        )
        // Personen-Anhänge (LFH-757): Modul-Gate `personen`; Upload/Download wie am Schaden,
        // der Download schreibt je Abruf eine Zeile ins Zugriffsprotokoll der Person.
        .route(
            "/api/einsaetze/{id}/persons/{pid}/attachments",
            get(routes::person_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/attachments",
            post(routes::person_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/attachments/{aid}",
            delete(routes::person_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/attachments/{aid}/file",
            get(routes::person_anhang::datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/animals",
            get(routes::einsatz_tier::liste),
        )
        .route(
            "/api/einsaetze/{id}/animals",
            post(routes::einsatz_tier::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/animals/export",
            get(routes::einsatz_tier::export),
        )
        .route(
            "/api/einsaetze/{id}/animals/{tid}",
            get(routes::einsatz_tier::detail),
        )
        .route(
            "/api/einsaetze/{id}/animals/{tid}",
            patch(routes::einsatz_tier::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/animals/{tid}/status",
            post(routes::einsatz_tier::status_wechsel),
        )
        .route(
            "/api/einsaetze/{id}/animals/{tid}",
            delete(routes::einsatz_tier::stornieren),
        )
        // Tier-Anhänge (LFH-758): Modul-Gate `tiere`; Upload/Download wie die Schaden-Anhänge.
        .route(
            "/api/einsaetze/{id}/animals/{tid}/attachments",
            get(routes::tier_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/animals/{tid}/attachments",
            post(routes::tier_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/animals/{tid}/attachments/{aid}",
            delete(routes::tier_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/animals/{tid}/attachments/{aid}/file",
            get(routes::tier_anhang::datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/damages",
            get(routes::einsatz_schaden::liste),
        )
        .route(
            "/api/einsaetze/{id}/damages",
            post(routes::einsatz_schaden::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/damages/marker",
            get(routes::einsatz_schaden::marker),
        )
        .route(
            "/api/einsaetze/{id}/damages/metrics",
            get(routes::einsatz_schaden::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/damages/selection",
            get(routes::einsatz_schaden::auswahl),
        )
        .route(
            "/api/einsaetze/{id}/damages/export",
            get(routes::einsatz_schaden::export),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}",
            get(routes::einsatz_schaden::detail),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}",
            patch(routes::einsatz_schaden::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}/hand-over",
            post(routes::einsatz_schaden::uebergeben),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}/close",
            post(routes::einsatz_schaden::abschliessen),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}",
            delete(routes::einsatz_schaden::stornieren),
        )
        // Schaden-Anhänge: Modul-Gate `schaeden`; Upload/Download wie die Dokumentenablage.
        .route(
            "/api/einsaetze/{id}/damages/{sid}/attachments",
            get(routes::schaden_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}/attachments",
            post(routes::schaden_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}/attachments/{aid}",
            delete(routes::schaden_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/damages/{sid}/attachments/{aid}/file",
            get(routes::schaden_anhang::datei).route_layer(download_grenze()),
        )
        // LLH-1491: Führung je Einsatz zwischen gekoppelten Instanzen (Schalter
        // `LIFELINE_FUEHRUNG`, sonst 404). Bedienung ohne `fordere_aktiv`: sie geht auch, wenn eine
        // andere Instanz führt oder der Einsatz abgeschlossen ist.
        .route("/api/einsaetze/{id}/command", get(routes::fuehrung::lesen))
        .route(
            "/api/einsaetze/{id}/command/hand-over",
            post(routes::fuehrung::uebergeben),
        )
        .route(
            "/api/einsaetze/{id}/command/code",
            post(routes::fuehrung::code_abgeben),
        )
        .route(
            "/api/einsaetze/{id}/command/request",
            post(routes::fuehrung::anfragen),
        )
        .route(
            "/api/einsaetze/{id}/command/request/decline",
            post(routes::fuehrung::anfrage_ablehnen),
        )
        .route(
            "/api/einsaetze/{id}/command/emergency-takeover",
            post(routes::fuehrung::notuebernahme),
        )
        .route(
            "/api/einsaetze/{id}/command/reclaim",
            post(routes::fuehrung::zurueckholen),
        )
        .route(
            "/api/einsaetze/{id}/command/emergency-takeover/start",
            post(routes::fuehrung::notuebernahme_start),
        )
        .route(
            "/api/einsaetze/{id}/command/emergency-takeover/finish",
            post(routes::fuehrung::notuebernahme_abschluss),
        )
        .route(
            "/api/einsaetze/{id}/command/emergency-takeover/code",
            post(routes::fuehrung::notuebernahme_code),
        )
        .route(
            "/api/einsaetze/{id}/command/confirm",
            post(routes::fuehrung::bestaetigen),
        )
        .route(
            "/api/einsaetze/{id}/command/object",
            post(routes::fuehrung::widersprechen),
        )
        // LFH-892: Gerätekopplung, verwaltet von der Einsatzleitung.
        .route(
            "/api/einsaetze/{id}/devices",
            get(routes::geraet::liste).post(routes::geraet::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/devices/{gid}/code",
            post(routes::geraet::code_ausstellen),
        )
        .route(
            "/api/einsaetze/{id}/devices/{gid}/extend",
            post(routes::geraet::verlaengern),
        )
        .route(
            "/api/einsaetze/{id}/devices/{gid}/revoke",
            post(routes::geraet::widerrufen),
        )
        // LLH-1638: Freigabe des Einsatzes für Maschinenzugänge (Einsatzleitung, auch am
        // Spiegel).
        .route(
            "/api/einsaetze/{id}/integrations",
            get(routes::einsatz_anbindungen::liste),
        )
        .route(
            "/api/einsaetze/{id}/integrations/{zid}/grant",
            put(routes::einsatz_anbindungen::freigeben)
                .delete(routes::einsatz_anbindungen::freigabe_beenden),
        )
        // LLH-1496: Lagebild für Externe, Links je Empfänger (Einsatzleitung, auch am Spiegel).
        .route(
            "/api/einsaetze/{id}/situation-picture-shares",
            get(routes::lagebild_extern::liste).post(routes::lagebild_extern::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/situation-picture-shares/{fid}/revoke",
            post(routes::lagebild_extern::widerrufen),
        )
        .route("/api/einsaetze/{id}/uhs", get(routes::einsatz_uhs::liste))
        .route(
            "/api/einsaetze/{id}/uhs",
            post(routes::einsatz_uhs::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}",
            get(routes::einsatz_uhs::detail),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}",
            patch(routes::einsatz_uhs::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/status",
            post(routes::einsatz_uhs::status_wechsel),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}",
            delete(routes::einsatz_uhs::stornieren),
        )
        // Kräfte der UHS (LFH-1045, Spec `uhs-staerke`): Zuordnung aus `einsatz_personal`.
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/forces",
            post(routes::einsatz_uhs_kraefte::adhoc),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/forces/available",
            get(routes::einsatz_uhs_kraefte::verfuegbar),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/forces/{epid}",
            put(routes::einsatz_uhs_kraefte::zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/forces/{epid}",
            delete(routes::einsatz_uhs_kraefte::loesen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/forces/unit/{eid}",
            put(routes::einsatz_uhs_kraefte::einheit_zuordnen),
        )
        // UHS-Anhänge (LFH-758): Modul-Gate `unfallhilfsstellen`; jeder Download im Lese-Audit.
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/attachments",
            get(routes::uhs_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/attachments",
            post(routes::uhs_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/attachments/accesses",
            get(routes::uhs_anhang::zugriffe),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/attachments/{aid}",
            delete(routes::uhs_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/attachments/{aid}/file",
            get(routes::uhs_anhang::datei).route_layer(download_grenze()),
        )
        // UHS-Plan (LFH-999): eigene Bytes, kein Anhang; die Anzeige schreibt kein Lese-Audit.
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plan",
            put(routes::uhs_plan::hinterlegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone())
                .patch(routes::uhs_plan::aendern)
                .delete(routes::uhs_plan::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plan/from-attachment",
            post(routes::uhs_plan::uebernehmen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plan/image",
            get(routes::uhs_plan::bild).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/seats",
            post(routes::einsatz_uhs::platz_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/seats/bulk",
            post(routes::einsatz_uhs::plaetze_bulk_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/seats/{pid}",
            patch(routes::einsatz_uhs::platz_aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/seats/{pid}/availability",
            post(routes::einsatz_uhs::platz_verfuegbarkeit),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/seats/{pid}",
            delete(routes::einsatz_uhs::platz_stornieren),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/uhs-occupancy",
            post(routes::einsatz_uhs::belegung),
        )
        .route(
            "/api/einsaetze/{id}/persons/{pid}/uhs-occupancy/{belegung_id}/undo",
            post(routes::einsatz_uhs::belegung_zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas",
            get(routes::einsatz_bereitstellungsraum::list),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas",
            post(routes::einsatz_bereitstellungsraum::create),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}",
            get(routes::einsatz_bereitstellungsraum::detail),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/history",
            get(routes::einsatz_bereitstellungsraum::verlauf),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/expected",
            get(routes::einsatz_bereitstellungsraum::erwartet),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/master-data-matches",
            get(routes::einsatz_bereitstellungsraum::stamm_treffer),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}",
            patch(routes::einsatz_bereitstellungsraum::update),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/status",
            post(routes::einsatz_bereitstellungsraum::status_wechsel),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}",
            delete(routes::einsatz_bereitstellungsraum::stornieren),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/occupancy",
            post(routes::einsatz_bereitstellungsraum::belegung),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/occupancy/{belegung_id}/undo",
            post(routes::einsatz_bereitstellungsraum::belegung_zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/arrival",
            post(routes::einsatz_bereitstellungsraum::eintreffen),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/dispatch",
            post(routes::einsatz_bereitstellungsraum::abruf),
        )
        .route(
            "/api/einsaetze/{id}/staging-areas/{bid}/dispatch/void",
            post(routes::einsatz_bereitstellungsraum::abruf_aufheben),
        )
        .route(
            "/api/einsaetze/{id}/sectors",
            get(routes::einsatzabschnitt::list),
        )
        .route(
            "/api/einsaetze/{id}/sectors",
            post(routes::einsatzabschnitt::create),
        )
        .route(
            "/api/einsaetze/{id}/sectors/{aid}",
            patch(routes::einsatzabschnitt::update),
        )
        .route(
            "/api/einsaetze/{id}/sectors/{aid}/area",
            patch(routes::einsatzabschnitt::flaeche)
                .layer(DefaultBodyLimit::max(GEOMETRIE_BODY_MAX)),
        )
        .route(
            "/api/einsaetze/{id}/sectors/{aid}/talk-groups/{sg}",
            put(routes::einsatzabschnitt::sprechgruppe_zuordnen)
                .delete(routes::einsatzabschnitt::sprechgruppe_loesen),
        )
        .route(
            "/api/einsaetze/{id}/sectors/{aid}",
            delete(routes::einsatzabschnitt::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports",
            get(routes::lagebericht::liste),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports",
            post(routes::lagebericht::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}",
            get(routes::lagebericht::detail),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}",
            patch(routes::lagebericht::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}/release",
            post(routes::lagebericht::freigeben),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}/revise",
            post(routes::lagebericht::fortschreiben),
        )
        // LFH-1028: Bild-Anlagen; Upload mit den Grenzen der Anhang-Uploads.
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}/enclosures",
            get(routes::lagebericht::anlagen),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}/enclosures",
            post(routes::lagebericht::anlage_ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}/enclosures/{aid}",
            delete(routes::lagebericht::anlage_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/situation-reports/{lid}/enclosures/{aid}/file",
            get(routes::lagebericht::anlage_datei).route_layer(download_grenze()),
        )
        .route("/api/einsaetze/{id}/orders", get(routes::befehl::liste))
        .route("/api/einsaetze/{id}/orders", post(routes::befehl::anlegen))
        .route(
            "/api/einsaetze/{id}/orders/{bid}",
            get(routes::befehl::detail),
        )
        .route(
            "/api/einsaetze/{id}/orders/{bid}",
            patch(routes::befehl::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/orders/{bid}/release",
            post(routes::befehl::freigeben),
        )
        .route(
            "/api/einsaetze/{id}/orders/{bid}/revise",
            post(routes::befehl::fortschreiben),
        )
        // LLH-1173: Quittung je Verteiler-Empfänger.
        .route(
            "/api/einsaetze/{id}/orders/{bid}/distribution/{vid}/acknowledge",
            post(routes::befehl::quittieren),
        )
        .route(
            "/api/einsaetze/{id}/orders/{bid}/distribution/{vid}/undo",
            post(routes::befehl::quittung_zuruecknehmen),
        )
        // LFH-1028: Bild-Anlagen; Upload mit den Grenzen der Anhang-Uploads.
        .route(
            "/api/einsaetze/{id}/orders/{bid}/enclosures",
            get(routes::befehl::anlagen),
        )
        .route(
            "/api/einsaetze/{id}/orders/{bid}/enclosures",
            post(routes::befehl::anlage_ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/orders/{bid}/enclosures/{aid}",
            delete(routes::befehl::anlage_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/orders/{bid}/enclosures/{aid}/file",
            get(routes::befehl::anlage_datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/map-views",
            get(routes::karten_ansicht::liste).post(routes::karten_ansicht::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/map-views/{aid}",
            patch(routes::karten_ansicht::patch).delete(routes::karten_ansicht::loeschen),
        )
        .route(
            "/api/einsaetze/{id}/situation-snapshots",
            get(routes::lage_snapshot::liste).post(routes::lage_snapshot::erzeugen),
        )
        .route(
            "/api/einsaetze/{id}/situation-snapshots/{sid}",
            get(routes::lage_snapshot::einzeln)
                .patch(routes::lage_snapshot::patch)
                .delete(routes::lage_snapshot::loeschen),
        )
        .route("/api/einsaetze/{id}/zones", get(routes::lage_zone::liste))
        .route(
            "/api/einsaetze/{id}/zones",
            post(routes::lage_zone::anlegen).layer(DefaultBodyLimit::max(GEOMETRIE_BODY_MAX)),
        )
        .route(
            "/api/einsaetze/{id}/zones/{zid}",
            patch(routes::lage_zone::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/zones/{zid}",
            delete(routes::lage_zone::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/free-symbols",
            get(routes::freies_zeichen::liste),
        )
        .route(
            "/api/einsaetze/{id}/free-symbols",
            post(routes::freies_zeichen::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/free-symbols/{zid}",
            patch(routes::freies_zeichen::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/free-symbols/{zid}",
            delete(routes::freies_zeichen::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/map/background-images",
            get(routes::karte_hintergrundbild::liste),
        )
        .route(
            "/api/einsaetze/{id}/map/background-images",
            post(routes::karte_hintergrundbild::hochladen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/map/background-images/{bildId}/download",
            get(routes::karte_hintergrundbild::herunterladen).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/map/background-images/{bildId}",
            patch(routes::karte_hintergrundbild::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/map/background-images/{bildId}",
            delete(routes::karte_hintergrundbild::loeschen),
        )
        .route(
            "/api/einsaetze/{id}/hazard-areas",
            get(routes::gefahr::gebiete),
        )
        .route(
            "/api/einsaetze/{id}/hazard-areas/{gid}",
            patch(routes::gefahr::umbenennen),
        )
        .route(
            "/api/einsaetze/{id}/hazard-areas/{gid}/matrix",
            get(routes::gefahr::matrix),
        )
        .route(
            "/api/einsaetze/{id}/hazard-areas/{gid}/matrix/rating",
            put(routes::gefahr::bewerten),
        )
        .route(
            "/api/einsaetze/{id}/hazard-areas/{gid}/assessment",
            post(routes::gefahr::beurteilen),
        )
        // Archiv-Namensraum der Aufbewahrung: nur System-Admin der eigenen Org, nur lesend bis auf
        // Wiederherstellen und Löschersuchen (Antrag, Rücknahme; die Suche ist POST, liest aber
        // nur). Guard in tests/aufbewahrung.rs.
        .route("/api/retention", get(routes::aufbewahrung::uebersicht))
        .route(
            "/api/retention/incidents/{id}",
            get(routes::aufbewahrung::akte),
        )
        .route(
            "/api/retention/incidents/{id}/etb",
            get(routes::aufbewahrung::etb),
        )
        .route(
            "/api/retention/incidents/{id}/restore",
            post(routes::aufbewahrung::wiederherstellen),
        )
        .route(
            "/api/retention/incidents/{id}/redaction-requests",
            get(routes::aufbewahrung::antraege).post(routes::aufbewahrung::antrag_stellen),
        )
        .route(
            "/api/retention/incidents/{id}/redaction-requests/{aid}/undo",
            post(routes::aufbewahrung::antrag_zuruecknehmen),
        )
        .route(
            "/api/retention/incidents/{id}/person-search",
            post(routes::aufbewahrung::personensuche),
        )
        .route(
            "/api/retention/incidents/{id}/archive",
            get(routes::aufbewahrung::archiv_herunterladen).route_layer(download_grenze()),
        )
        // LLH-1652: Anbindungen (Maschinenzugänge für Fremdsysteme) verwalten. Die Anmeldung der
        // Fremdsysteme selbst liegt unter `/api/v1/` (`public_api`).
        .route(
            "/api/admin/integrations",
            get(routes::anbindungen::liste).post(routes::anbindungen::anlegen),
        )
        .route(
            "/api/admin/integrations/{id}",
            get(routes::anbindungen::laden).patch(routes::anbindungen::aendern),
        )
        .route(
            "/api/admin/integrations/{id}/code",
            post(routes::anbindungen::code),
        )
        .route(
            "/api/admin/integrations/{id}/revoke",
            post(routes::anbindungen::widerrufen),
        )
        // LLH-1656: Webhook einer Anbindung. Zugestellt wird im Hintergrund
        // (`public_api::webhook::lauf`).
        .route(
            "/api/admin/integrations/{id}/webhook",
            post(routes::anbindungen_webhook::create)
                .patch(routes::anbindungen_webhook::update)
                .delete(routes::anbindungen_webhook::delete),
        )
        .route(
            "/api/admin/integrations/{id}/webhook/resume",
            post(routes::anbindungen_webhook::wieder_aufnehmen),
        )
        .route(
            "/api/admin/integrations/{id}/webhook/test",
            post(routes::anbindungen_webhook::test),
        )
        .route(
            "/api/admin/integrations/{id}/webhook/fetch-certificate",
            post(routes::anbindungen_webhook::zertifikat_abrufen),
        )
        .route(
            "/api/admin/integrations/{id}/webhook/attempts",
            get(routes::anbindungen_webhook::versuche),
        )
        // LLH-2017: Adapter verwalten (ADR-0077). Abgerufen wird im Hintergrund (`adapter::lauf`).
        .route(
            "/api/admin/adapter",
            get(routes::adapter::list).post(routes::adapter::create),
        )
        .route(
            "/api/admin/adapter/{id}",
            get(routes::adapter::load)
                .patch(routes::adapter::update)
                .delete(routes::adapter::delete),
        )
        .route(
            "/api/admin/adapter/{id}/secrets/{name}",
            put(routes::adapter::set_geheimnis).delete(routes::adapter::delete_geheimnis),
        )
        .route(
            "/api/admin/adapter/{id}/check",
            post(routes::adapter::check),
        )
        .route("/api/admin/adapter/{id}/pause", post(routes::adapter::halt))
        .route(
            "/api/admin/adapter/{id}/resume",
            post(routes::adapter::resume),
        )
        .route(
            "/api/admin/adapter/{id}/attempts",
            get(routes::adapter::list_versuche),
        )
        // LLH-1654: Einwurf-Zugänge (Absender ohne Signatur, ADR-0023) verwalten. Die Einwürfe
        // selbst nimmt `public_api::einwurf` an.
        .route(
            "/api/admin/intake-credentials",
            get(routes::einwurf_zugaenge::liste).post(routes::einwurf_zugaenge::anlegen),
        )
        .route(
            "/api/admin/intake-credentials/{id}/key",
            post(routes::einwurf_zugaenge::schluessel_wechseln),
        )
        .route(
            "/api/admin/intake-credentials/{id}/revoke",
            post(routes::einwurf_zugaenge::widerrufen),
        )
        // LLH-1496: Abruf des Lagebilds für Externe. Kein `CurrentUser`, nur der Schlüssel aus
        // dem Link (`lagebild_extern::LagebildZugriff`), IP-Sperre wie die Gerätekopplung.
        .route(
            "/api/external/v1/situation-picture",
            get(routes::lagebild_extern::abruf),
        )
        // LLH-1490: Instanzkopplung. Verwaltung nur für den Admin der Org; Einlösen öffentlich
        // (IP-Sperre wie die Gerätekopplung), Melden signiert (`instanz::extractor`).
        // LLH-1711: Archivblock in der Verwaltung einspielen. Eigene Body-Grenze für Blöcke bis
        // 256 MiB und die gemeinsame Upload-Grenze; dem Zeitbudget entzogen
        // (`zulassung::OHNE_ZULASSUNGSGRENZE`).
        .route(
            "/api/admin/archive/import",
            post(routes::archiv_einspielen::einspielen)
                .layer(DefaultBodyLimit::max(ARCHIV_BLOCK_BODY_MAX))
                .route_layer(upload_grenze.clone())
                // Erst danach: die Verfügbarkeit trägt weder Body- noch Upload-Grenze.
                .get(routes::archiv_einspielen::verfuegbarkeit),
        )
        .route("/api/admin/instance", get(routes::instanz::uebersicht))
        // LLH-1491: Führung der Einsätze beim Gegenüber (Akten ohne lokalen Einsatz).
        .route(
            "/api/admin/instance/command",
            get(routes::fuehrung::admin_liste),
        )
        .route(
            "/api/admin/instance/command/{id}/hand-over",
            post(routes::fuehrung::admin_uebergeben),
        )
        .route(
            "/api/admin/instance/command/{id}/code",
            post(routes::fuehrung::admin_code_abgeben),
        )
        .route(
            "/api/admin/instance/command/{id}/request",
            post(routes::fuehrung::admin_anfragen),
        )
        .route(
            "/api/admin/instance/command/{id}/request/decline",
            post(routes::fuehrung::admin_anfrage_ablehnen),
        )
        .route(
            "/api/admin/instance/command/{id}/emergency-takeover",
            post(routes::fuehrung::admin_notuebernahme),
        )
        .route(
            "/api/admin/instance/command/{id}/emergency-takeover/start",
            post(routes::fuehrung::admin_notuebernahme_start),
        )
        .route(
            "/api/admin/instance/command/{id}/emergency-takeover/finish",
            post(routes::fuehrung::admin_notuebernahme_abschluss),
        )
        .route(
            "/api/admin/instance/command/{id}/emergency-takeover/code",
            post(routes::fuehrung::admin_notuebernahme_code),
        )
        .route(
            "/api/admin/instance/command/{id}/confirm",
            post(routes::fuehrung::admin_bestaetigen),
        )
        .route(
            "/api/admin/instance/command/{id}/object",
            post(routes::fuehrung::admin_widersprechen),
        )
        .route(
            "/api/admin/instance/codes",
            post(routes::instanz::code_ausstellen),
        )
        .route(
            "/api/admin/instance/redeem",
            post(routes::instanz::einloesen),
        )
        .route(
            "/api/admin/instance/pairings/{id}/revoke",
            post(routes::instanz::widerrufen),
        )
        .route(
            "/api/admin/instance/pairings/{id}/resync",
            post(routes::instanz::stammdaten_neu),
        )
        .route(
            "/api/admin/instance/pairings/{id}/lost",
            post(routes::instanz::elw_verloren),
        )
        // LAN-Entdeckung (LLH-1497): Liste „Im Netz gefunden“.
        .route("/api/admin/instance/lan", get(routes::instanz::lan))
        .route(
            "/api/instance/master-data/origin",
            get(routes::instanz::stammdaten_herkunft),
        )
        .route(
            "/api/admin/instance/signing-keys/register/start",
            post(routes::instanz::registrieren_start),
        )
        .route(
            "/api/admin/instance/signing-keys/register/finish",
            post(routes::instanz::registrieren_abschluss),
        )
        .route(
            "/api/admin/instance/signing-keys/{id}/countersign/start",
            post(routes::instanz::gegenzeichnen_start),
        )
        .route(
            "/api/admin/instance/signing-keys/{id}/countersign/finish",
            post(routes::instanz::gegenzeichnen_abschluss),
        )
        .route(
            "/api/admin/instance/signing-keys/{id}/revoke",
            post(routes::instanz::unterschrift_widerrufen),
        )
        .route(
            "/api/admin/instance/last-keys",
            get(routes::instanz::letzte_schluessel),
        )
        .route(
            "/api/admin/instance/signing-keys/{id}/confirm",
            post(routes::instanz::unterschrift_bestaetigen),
        )
        .route(
            "/api/admin/instance/signing-keys/{id}/reject",
            post(routes::instanz::unterschrift_zurueckweisen),
        )
        .route(
            "/api/instance/pair",
            post(routes::instanz::koppeln).layer(DefaultBodyLimit::max(AUTH_CODE_BODY_MAX)),
        )
        .route(
            crate::instanz::extractor::MELDEN_PFAD,
            post(routes::instanz::melden),
        )
        // Signierte Aussage über das TLS-Zertifikat einer Direktkopplung (LLH-1497).
        .route(
            crate::instanz::melden::ZERTIFIKAT_PFAD,
            post(routes::instanz::zertifikat),
        )
        // Anträge am Spiegel (LLH-1492): lesen und verwerfen.
        .route(
            "/api/einsaetze/{id}/requests",
            get(routes::instanz::antraege_liste),
        )
        .route(
            "/api/einsaetze/{id}/requests/{antrag_id}",
            delete(routes::instanz::antrag_verwerfen),
        )
        // Bruchstelle am Spiegel (LLH-1646): ansehen, nachreichen, verwerfen.
        .route(
            "/api/einsaetze/{id}/breaks",
            get(routes::instanz::bruchstelle_liste),
        )
        .route(
            "/api/einsaetze/{id}/breaks/requests",
            post(routes::instanz::bruchstelle_alle_stellen),
        )
        .route(
            "/api/einsaetze/{id}/breaks/{bruch_id}/request",
            post(routes::instanz::bruchstelle_stellen),
        )
        .route(
            "/api/einsaetze/{id}/breaks/{bruch_id}/discard",
            post(routes::instanz::bruchstelle_verwerfen),
        )
        // Abgelehnte Anträge nach der Verwahrung (LLH-1648): einsatzübergreifend, nur die eigenen.
        .route(
            "/api/requests/rejected",
            get(routes::instanz::antraege_abgelehnt),
        )
        .route(
            "/api/requests/rejected/{antrag_id}",
            delete(routes::instanz::antrag_abgelehnt_verwerfen),
        )
        // Abgleich der Einsätze (LLH-1492): Pakete bis `SPIEGEL_MAX`, signiert wie Melden.
        .route(
            crate::instanz::extractor::SPIEGEL_PFAD,
            post(routes::instanz::spiegel_abgleich).layer(DefaultBodyLimit::max(
                crate::instanz::spiegel::paket::SPIEGEL_MAX,
            )),
        )
        .route("/api/organization", get(routes::organisation::lesen))
        .route(
            "/api/organization",
            patch(routes::organisation::aktualisieren),
        )
        // Logo der Organisation: 1 MiB Nutzlast plus 64 KiB Multipart-Rahmen. Die Größengrenze
        // prüft
        // der Handler (400); das Limit fängt nur Übergrößen ab.
        .route(
            "/api/organization/logo",
            get(routes::organisation::logo_lesen)
                .post(routes::organisation::logo_hochladen)
                .delete(routes::organisation::logo_entfernen)
                .layer(DefaultBodyLimit::max(1024 * 1024 + 64 * 1024)),
        )
        .route(
            "/api/org-settings",
            get(routes::org_einstellungen::lesen).put(routes::org_einstellungen::setzen),
        )
        // Archiv-Schlüssel der Org (LLH-1494): nur System-Admins, Admin-Spur.
        .route(
            "/api/org-archive-keys",
            get(routes::archiv_empfaenger::liste).post(routes::archiv_empfaenger::anlegen),
        )
        .route(
            "/api/org-archive-keys/{id}",
            delete(routes::archiv_empfaenger::entfernen),
        )
        .route(
            "/api/org-archive-keys/{id}/check",
            post(routes::archiv_empfaenger::pruefen),
        )
        .route(
            "/api/command-roles",
            get(routes::fuehrungsfunktion::katalog),
        )
        .route(
            "/api/org-command-roles/{funktion}",
            put(routes::fuehrungsfunktion::setzen),
        )
        // Richtwerte des Unterkunftsrechners (LLH-1520, design.md D2).
        .route(
            "/api/accommodation-guidelines",
            get(routes::unterkunft_richtwerte::org_lesen),
        )
        .route(
            "/api/org-accommodation-guidelines/{schluessel}",
            put(routes::unterkunft_richtwerte::org_setzen),
        )
        .route(
            "/api/org-module-settings",
            get(routes::org_einstellungen::modul_einstellungen_lesen),
        )
        .route(
            "/api/org-module-settings/{modul_key}",
            put(routes::org_einstellungen::modul_einstellung_setzen),
        )
        // Ortssuche ohne Einsatz, für „Einsatz anlegen“ (LFH-1175).
        .route("/api/place-search", get(routes::ort_suche::in_org))
        // Ortsname ohne Einsatz, für das Ortsfeld beim Anlegen (LLH-1376).
        .route("/api/place-preview", get(routes::ort_vorschau::in_org))
        .route(
            "/api/external-agencies",
            get(routes::externe_stelle::list).post(routes::externe_stelle::create),
        )
        .route(
            "/api/external-agencies/{id}",
            patch(routes::externe_stelle::update),
        )
        .route("/api/keyword-suggestions", get(routes::stichwort::liste))
        .route("/api/keyword-suggestions", post(routes::stichwort::anlegen))
        .route(
            "/api/keyword-suggestions/{id}",
            delete(routes::stichwort::loeschen),
        )
        // LLH-1375: Kopplung eines Stichworts an eine Einsatz-Vorlage.
        .route(
            "/api/keyword-suggestions/{id}/template",
            put(routes::stichwort::set_vorlage),
        )
        // Vorplanung ohne Einsatz (LLH-1585): Planer der Organisation (`planung::zugriff`).
        .route(
            "/api/plans",
            get(routes::planung::list).post(routes::planung::create),
        )
        .route(
            "/api/plans/{id}",
            get(routes::planung::load)
                .patch(routes::planung::update)
                .delete(routes::planung::delete),
        )
        .route(
            "/api/plans/{id}/posts",
            post(routes::planung::create_posten),
        )
        // `order` ist ein festes Segment neben `{pid}`.
        .route(
            "/api/plans/{id}/posts/order",
            put(routes::planung::reihenfolge),
        )
        .route(
            "/api/plans/{id}/posts/{pid}",
            patch(routes::planung::update_posten).delete(routes::planung::delete_posten),
        )
        .route(
            "/api/plans/{id}/blocks",
            post(routes::planung::create_block),
        )
        .route(
            "/api/plans/{id}/blocks/{bid}",
            patch(routes::planung::update_block).delete(routes::planung::delete_block),
        )
        .route("/api/plans/{id}/generate", post(routes::planung::erzeugen))
        .route("/api/plans/{id}/export", get(routes::planung::export))
        .route(
            "/api/plans/{id}/helpers",
            post(routes::planung::create_helfer),
        )
        .route(
            "/api/plans/{id}/helpers/{hid}",
            patch(routes::planung::update_helfer).delete(routes::planung::delete_helfer),
        )
        // LLH-1583: Programmpunkte der Planung; die Übernahme bringt sie in den Einsatz.
        .route(
            "/api/plans/{id}/agenda-items",
            post(routes::planung::create_programmpunkt),
        )
        .route(
            "/api/plans/{id}/agenda-items/{pid}",
            patch(routes::planung::update_programmpunkt)
                .delete(routes::planung::delete_programmpunkt),
        )
        // LLH-1587: Übernahme in einen neuen oder laufenden Einsatz; `preview` schreibt nichts.
        .route(
            "/api/plans/{id}/transfer/preview",
            post(routes::planung::uebernahme_vorschau),
        )
        .route(
            "/api/plans/{id}/transfer",
            post(routes::planung::uebernehmen),
        )
        // Einsatz-Vorlagen (LLH-1375): Lesen für alle der Org, Schreiben Admin.
        .route(
            "/api/incident-templates",
            get(routes::einsatz_vorlage::list).post(routes::einsatz_vorlage::create),
        )
        .route(
            "/api/incident-templates/{id}",
            put(routes::einsatz_vorlage::update).delete(routes::einsatz_vorlage::delete),
        )
        .route("/api/vehicles", get(routes::fahrzeug::liste))
        .route("/api/vehicles", post(routes::fahrzeug::anlegen))
        .route(
            "/api/vehicle-suggestions",
            get(routes::fahrzeug::vorschlaege),
        )
        .route("/api/vehicles/{id}", patch(routes::fahrzeug::aktualisieren))
        .route(
            "/api/vehicles/{id}/out-of-service",
            post(routes::fahrzeug::ausser_dienst),
        )
        .route(
            "/api/vehicles/{id}/in-service",
            post(routes::fahrzeug::in_dienst),
        )
        .route("/api/material", get(routes::material::liste))
        .route("/api/material", post(routes::material::anlegen))
        .route(
            "/api/material-categories",
            get(routes::material::kategorien),
        )
        .route("/api/material/{id}", patch(routes::material::aktualisieren))
        .route(
            "/api/material/{id}/out-of-service",
            post(routes::material::ausser_dienst),
        )
        .route(
            "/api/material/{id}/in-service",
            post(routes::material::in_dienst),
        )
        .route("/api/vehicle-statuses", get(routes::fahrzeug_status::liste))
        .route(
            "/api/vehicle-statuses",
            post(routes::fahrzeug_status::anlegen),
        )
        .route(
            "/api/vehicle-statuses/{id}",
            patch(routes::fahrzeug_status::aktualisieren),
        )
        .route(
            "/api/vehicle-statuses/{id}/deactivate",
            post(routes::fahrzeug_status::deaktivieren),
        )
        .route("/api/personnel", get(routes::personal::liste))
        .route("/api/personnel", post(routes::personal::anlegen))
        .route(
            "/api/personnel-suggestions",
            get(routes::personal::vorschlaege),
        )
        .route(
            "/api/personnel/{id}",
            patch(routes::personal::aktualisieren),
        )
        .route(
            "/api/personnel/{id}/out-of-service",
            post(routes::personal::ausser_dienst),
        )
        .route(
            "/api/personnel/{id}/in-service",
            post(routes::personal::in_dienst),
        )
        .route(
            "/api/personnel-statuses",
            get(routes::personal_status::liste),
        )
        .route(
            "/api/personnel-statuses",
            post(routes::personal_status::anlegen),
        )
        .route(
            "/api/personnel-statuses/{id}",
            patch(routes::personal_status::aktualisieren),
        )
        .route(
            "/api/personnel-statuses/{id}/deactivate",
            post(routes::personal_status::deaktivieren),
        )
        .route("/api/etb-snippets", get(routes::etb_baustein::liste))
        .route("/api/etb-snippets", post(routes::etb_baustein::anlegen))
        .route(
            "/api/etb-snippets/{id}",
            patch(routes::etb_baustein::aktualisieren),
        )
        .route(
            "/api/etb-snippets/{id}/deactivate",
            post(routes::etb_baustein::deaktivieren),
        )
        .route("/api/qualifications", get(routes::qualifikation::liste))
        .route("/api/qualifications", post(routes::qualifikation::anlegen))
        .route(
            "/api/qualifications/{id}",
            patch(routes::qualifikation::aktualisieren),
        )
        .route(
            "/api/qualifications/{id}/deactivate",
            post(routes::qualifikation::deaktivieren),
        )
        // Einheiten-Vorlagen (LLH-1042): Lesen für alle der Org, Schreiben Admin.
        .route(
            "/api/unit-templates",
            get(routes::einheit_vorlage::list).post(routes::einheit_vorlage::create),
        )
        .route(
            "/api/unit-templates/{id}",
            patch(routes::einheit_vorlage::update),
        )
        .route(
            "/api/unit-templates/{id}/vehicles",
            put(routes::einheit_vorlage::replace_fahrzeuge),
        )
        .route(
            "/api/unit-templates/{id}/personnel",
            put(routes::einheit_vorlage::replace_personal),
        )
        .route(
            "/api/unit-templates/{id}/material",
            put(routes::einheit_vorlage::replace_material),
        )
        // Verpflegungsplan (LLH-1058): Lesen für alle der Org, Schreiben Admin.
        .route(
            "/api/catering-templates",
            get(routes::verpflegung_vorlage::list).post(routes::verpflegung_vorlage::create),
        )
        .route(
            "/api/catering-templates/{vid}",
            patch(routes::verpflegung_vorlage::update),
        )
        // Schichtmodelle (LLH-1122): Lesen für alle der Org, Schreiben Admin.
        .route(
            "/api/shift-models",
            get(routes::schichtmodell::list).post(routes::schichtmodell::create),
        )
        .route(
            "/api/shift-models/{sid}",
            put(routes::schichtmodell::update).delete(routes::schichtmodell::delete),
        )
        .route("/api/unit-types", get(routes::einheit_typ::liste))
        .route("/api/unit-types", post(routes::einheit_typ::anlegen))
        .route(
            "/api/unit-types/{id}",
            patch(routes::einheit_typ::aktualisieren),
        )
        .route(
            "/api/unit-types/{id}/deactivate",
            post(routes::einheit_typ::deaktivieren),
        )
        .route("/api/talk-groups", get(routes::sprechgruppe::liste_katalog))
        .route("/api/talk-groups", post(routes::sprechgruppe::anlegen))
        .route(
            "/api/talk-groups/also-local",
            get(routes::sprechgruppe::liste_auch_lokal),
        )
        .route(
            "/api/talk-groups/{id}",
            patch(routes::sprechgruppe::aktualisieren),
        )
        .route(
            "/api/talk-groups/{id}/deactivate",
            post(routes::sprechgruppe::deaktivieren),
        )
        .route(
            "/api/einsaetze/{id}/talk-groups",
            get(routes::sprechgruppe::liste_fuer_einsatz),
        )
        .route(
            "/api/einsaetze/{id}/talk-groups",
            post(routes::sprechgruppe::anlegen_einsatz_lokal),
        )
        .route(
            "/api/einsaetze/{id}/units",
            get(routes::einsatz_einheit::liste),
        )
        .route(
            "/api/einsaetze/{id}/units",
            post(routes::einsatz_einheit::bilden),
        )
        // Statische Segmente vor `{eid}` (LLH-1049).
        .route(
            "/api/einsaetze/{id}/units/from-template",
            post(routes::einsatz_einheit::aus_vorlage_bilden),
        )
        .route(
            "/api/einsaetze/{id}/units/from-template/{vorlage_id}",
            get(routes::einsatz_einheit::aus_vorlage_vorschau),
        )
        // LLH-1383: eingetroffene Nachforderung als Einheit übernehmen.
        .route(
            "/api/einsaetze/{id}/units/from-resource-request",
            post(routes::einsatz_einheit::aus_nachforderung),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}",
            patch(routes::einsatz_einheit::update),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/position",
            patch(routes::einsatz_einheit::position),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/talk-groups/{sg}",
            put(routes::einsatz_einheit::sprechgruppe_zuordnen)
                .delete(routes::einsatz_einheit::sprechgruppe_loesen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/status",
            put(routes::einsatz_einheit::status_setzen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/status/undo",
            post(routes::einsatz_einheit::status_zuruecknehmen),
        )
        // Kräfte-Zeitachse (LFH-552) unter dem Einheiten-Präfix.
        .route(
            "/api/einsaetze/{id}/units/timeline",
            get(routes::zeitachse::einheiten_perioden),
        )
        // Grenzwerte des Schichtplans für die Einstufung (LLH-730).
        .route(
            "/api/einsaetze/{id}/units/timeline/limits",
            get(routes::zeitachse::einheiten_grenzwerte),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/timeline",
            get(routes::zeitachse::einheit_laden).post(routes::zeitachse::einheit_nachtragen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/timeline/{zid}/strike",
            post(routes::zeitachse::einheit_streichen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/timeline/{zid}/correct",
            post(routes::zeitachse::einheit_berichtigen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/timeline/period",
            post(routes::zeitachse::einheit_periode_nachtragen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}",
            delete(routes::einsatz_einheit::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/annul",
            post(routes::einsatz_einheit::stornieren),
        )
        // LLH-1388: Fehlübernahme aus einer Nachforderung stornieren.
        .route(
            "/api/einsaetze/{id}/units/{eid}/annul-takeover",
            post(routes::einsatz_einheit::uebernahme_stornieren),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/take-over",
            post(routes::einsatz_einheit::uebernehmen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/reject",
            post(routes::einsatz_einheit::abweisen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/personnel/{ep_id}",
            put(routes::einsatz_einheit::personal_zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/personnel/{ep_id}",
            delete(routes::einsatz_einheit::personal_freigeben),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/vehicles/{ef_id}",
            put(routes::einsatz_einheit::fahrzeug_zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/units/{eid}/vehicles/{ef_id}",
            delete(routes::einsatz_einheit::fahrzeug_freigeben),
        );

    // Dev-only: Endpoint existiert physisch nur mit Feature `dev-seeds`.
    #[cfg(feature = "dev-seeds")]
    let router = router.route("/api/dev/users", get(routes::dev::users));

    // Demo-Daten nur mit `--demo-daten`. Ohne Schalter fällt der Pfad in den `/api/`-404-Fallback
    // — kein 401/403/405, das seine Existenz verriete.
    let router = if opt.demo_daten {
        router
            .route("/api/demo-data", get(routes::demo_daten::status))
            // LLH-1576: die Lage steht im Pfad, unbekannte Lagen sind 404 aus dem Handler.
            .route(
                "/api/demo-data/{lage}",
                post(routes::demo_daten::importieren).delete(routes::demo_daten::entfernen),
            )
            .route(
                "/api/demo-data/{lage}/reimport",
                post(routes::demo_daten::neu_importieren),
            )
    } else {
        router
    };

    let router = router
        .route("/api/map/config", get(routes::karte::config))
        .route("/api/map/overlays/{quelle}", get(routes::karte::fachebenen))
        // Offline-Tiles der aktiven Karte über den gecachten read-only-Reader. Kompat-Route (erste
        // sichtbare Region); neue Clients nutzen die region-adressierte Route.
        .route(
            "/api/map/offline/tiles/{z}/{x}/{y}",
            get(routes::karte::offline_tiles),
        )
        // Eingebettete Welt-Übersicht: der statische „welt“-Pfad steht vor der `{karte_id}`-Route.
        .route(
            "/api/map/offline/world/tiles/{z}/{x}/{y}",
            get(routes::karte::offline_welt_tiles),
        )
        // Region-adressierter Tile-Endpoint: je sichtbarer Region eine eigene Vector-Source.
        .route(
            "/api/map/offline/{karte_id}/tiles/{z}/{x}/{y}",
            get(routes::karte::offline_tiles_region),
        )
        // Eingebettete Offline-Glyphs/Sprite (rust-embed).
        .route(
            "/api/map/offline/fonts/{fontstack}/{datei}",
            get(routes::karte::offline_fonts),
        )
        .route(
            "/api/map/offline/sprites/{datei}",
            get(routes::karte::offline_sprite),
        )
        // Style-/Tile-Proxy: verbirgt Upstream-Key und -URL, nur mit Sitzung (LFH-1072), damit
        // Fremde das Anbieter-Kontingent nicht verbrauchen.
        .route(
            "/api/map/proxy/{id}/style.json",
            get(routes::karte::proxy_style),
        )
        .route(
            "/api/map/proxy/{id}/raster/{z}/{x}/{y}",
            get(routes::karte::proxy_raster),
        )
        .route(
            "/api/map/proxy/{id}/tile/{slot}/{z}/{x}/{y}",
            get(routes::karte::proxy_tile),
        )
        .route(
            "/api/map/proxy/{id}/tilejson/{slot}",
            get(routes::karte::proxy_tilejson),
        )
        .route(
            "/api/map/proxy/{id}/sprite/{rest}",
            get(routes::karte::proxy_sprite),
        )
        .route(
            "/api/map/proxy/{id}/glyphs/{slot}/{fontstack}/{range}",
            get(routes::karte::proxy_glyphs),
        )
        .route(
            "/api/map/proxy/{id}/asset/{slot}",
            get(routes::karte::proxy_asset_slot),
        )
        // Admin-CRUD der Karten-Registry (Online-Quellen + Offline-Karten), hinter AdminUser.
        .route(
            "/api/map/online-sources",
            get(routes::karte::online_liste).post(routes::karte::online_anlegen),
        )
        .route(
            "/api/map/online-sources/catalog",
            get(routes::karte::online_katalog),
        )
        .route(
            "/api/map/online-sources/{id}",
            patch(routes::karte::online_aktualisieren).delete(routes::karte::online_loeschen),
        )
        .route(
            "/api/map/offline-maps",
            get(routes::karte::offline_liste).post(routes::karte::offline_registrieren),
        )
        // Statische Segmente (katalog/download) vor /{id} — matchit priorisiert statisch.
        .route(
            "/api/map/offline-maps/catalog",
            get(routes::karte::offline_katalog),
        )
        .route(
            "/api/map/offline-maps/existing",
            get(routes::karte::offline_vorhandene),
        )
        .route(
            "/api/map/offline-maps/download",
            post(routes::karte::offline_download),
        )
        .route(
            "/api/map/offline-maps/build",
            post(routes::karte::offline_bauen),
        )
        .route(
            "/api/map/offline-maps/buildable-regions",
            get(routes::karte::offline_baubare_regionen),
        )
        .route(
            "/api/map/offline-maps/build-status",
            get(routes::karte::offline_bau_status),
        )
        .route(
            "/api/map/offline-maps/auto-update",
            get(routes::karte::offline_aktualisierung_status),
        )
        .route(
            "/api/map/offline-maps/auto-update/settings",
            put(routes::karte::offline_aktualisierung_einstellen),
        )
        .route(
            "/api/map/offline-maps/{id}/update-now",
            post(routes::karte::offline_jetzt_aktualisieren),
        )
        .route(
            "/api/map/offline-maps/{id}/activate",
            post(routes::karte::offline_aktivieren),
        )
        .route(
            "/api/map/offline-maps/{id}/cancel",
            post(routes::karte::offline_abbrechen),
        )
        .route(
            "/api/map/offline-maps/{id}",
            delete(routes::karte::offline_loeschen),
        );

    let heic_decoder = opt.heic_decoder_verzeichnis.clone().map(Arc::new);
    let router_platz = crate::instanz::spiegel::antrag::RouterPlatz::default();
    let router = router
        // Öffentliche API v1 (LLH-1653): Routen nur über `public_api::router()`, jede mit ihrem
        // Eintrag im Dokument; Body-Grenze und Fehlercode an den Routen bringt `mount` mit.
        .merge(crate::public_api::mount(crate::public_api::router()))
        .fallback(move |uri: axum::http::Uri, kopf: axum::http::HeaderMap| {
            crate::static_files::serve(uri, kopf, heic_decoder.clone())
        })
        // Axums Default-405 hat einen leeren Body und bräche den `{error}`-Vertrag. Der Fallback
        // greift
        // nur, wenn der Pfad existiert, die Methode aber nicht.
        .method_not_allowed_fallback(methode_nicht_erlaubt)
        // Body-Limit für alle Routen (LFH-1074); ein `.layer(DefaultBodyLimit…)` an der Route liegt
        // innen und gilt stattdessen.
        .layer(DefaultBodyLimit::max(JSON_BODY_MAX))
        // Antwortkompression nur für JSON (LFH-940, Spec `antwortkompression`): Listen gehen über
        // LTE. SSE darf nicht puffern, Anhänge und Kacheln sind schon gepackt oder tragen ETags,
        // die eingebetteten Frontend-Dateien bleiben unberührt. Innen, damit Zulassung und Trace
        // die ungepackte Antwort sehen. Gepackt wird beim Pollen auf dem Worker, nach der
        // Zulassung: deshalb eine schnelle Stufe statt der Vorgabe (Brotli 11).
        .layer(
            tower_http::compression::CompressionLayer::new()
                .quality(tower_http::CompressionLevel::Precise(
                    ANTWORT_KOMPRESSION_STUFE,
                ))
                .no_deflate()
                .no_zstd()
                .compress_when(nur_json_ab(ANTWORT_KOMPRESSION_AB)),
        )
        // Fängt eine Handler-Panik und antwortet mit 500 + `{error}`, statt die Verbindung
        // abzureißen
        // (das hielte das Frontend für „kein Netz“).
        .layer(tower_http::catch_panic::CatchPanicLayer::custom(on_panic));
    let router = mit_etb_waechter(router, &state);
    let router: Router = router
        // Stammdaten-Kataloge melden schreibende Erfolge an die eigene Org (LFH-734). Außerhalb
        // von CatchPanic: nach einer Handler-Panik sieht sie dessen 500 und meldet nichts.
        // `MatchedPath` ist beim Routing gesetzt.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            routes::live::stammdaten_live,
        ))
        // Anträge am Spiegel (LLH-1492, D9): eine beantragbare Erfassung an einem gespiegelten
        // Einsatz wird zum Antrag, bevor die Route schreibt. `MatchedPath` ist gesetzt.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::instanz::spiegel::antrag::schicht,
        ))
        // Zulassungssteuerung: Zeitbudget und Gleichzeitigkeits-Cap mit Lastabwurf. Muss AUSSERHALB
        // des `CatchPanicLayer` liegen, damit sie dessen 500-Antwort bekommt statt eines Unwinds.
        // `MatchedPath` ist beim Routing gesetzt, die Ausnahmeliste greift also trotzdem.
        .layer(axum::middleware::from_fn_with_state(
            opt.zulassungs_budget
                .map_or_else(crate::zulassung::Zulassung::default, |budget| {
                    crate::zulassung::Zulassung::neu(
                        budget,
                        crate::zulassung::MAX_GLEICHZEITIGE_REQUESTS,
                    )
                }),
            crate::zulassung::zulassung,
        ))
        // Transportlage für den Einwurf (ADR-0023): die Einwurf-Routen und die Verwaltung der
        // Einwurf-Zugänge lesen sie aus den Extensions der Anfrage. Fehlt sie (Router ohne
        // diese Schicht), gilt „kein TLS, kein Schalter“.
        .layer(axum::Extension(crate::public_api::einwurf::Transport {
            tls: opt.tls,
            einwurf_allow_http: opt.einwurf_allow_http,
        }))
        // Öffentliche API v1 (LLH-1653, `public_api::contract_layer`): `code` an jeder Fehlerantwort
        // unter `/api/v1/` und `Cache-Control: no-store`. Außerhalb der Zulassung und von
        // CatchPanic, damit auch Lastabwurf-503 und Panik-500 einen Code bekommen.
        .layer(axum::middleware::from_fn(crate::public_api::contract_layer))
        // Request-Instrumentierung. `.layer()` hängt nach außen, der Trace-Layer liegt also
        // außerhalb
        // von CatchPanic UND Zulassung und sieht Panik-500er wie Lastabwürfe. Jeder Handler läuft
        // in
        // diesem Span, deshalb tragen die `tracing::error!`-Zeilen Methode, Pfad und Request-ID.
        //
        // `on_failure` eigen (LFH-925): ein 503 ist Überlast, die ein Fremder je Anfrage auslösen
        // kann; er geht gedrosselt als WARN-Sammelzeile ins Log. Jeder andere Fehler bleibt ERROR.
        .layer(
            tower_http::trace::TraceLayer::new_for_http()
                .make_span_with(MakeSpanMitRequestId)
                .on_failure(OnFailureOhneUeberlastFlut),
        )
        // Request-ID ganz außen setzen, damit sie im Span schon steht, und in die Antwort spiegeln
        // — so kann ein Nutzer sie aus dem Fehlerfall melden.
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id())
        .layer(tower_http::request_id::SetRequestIdLayer::x_request_id(
            tower_http::request_id::MakeRequestUuid,
        ))
        // Davor die ID des Clients prüfen (LFH-925): `SetRequestIdLayer` lässt eine mitgeschickte
        // stehen, sie stünde ungeprüft in jeder Logzeile und in der Antwort. Eine unzulässige
        // fällt hier weg und wird oben durch eine UUID ersetzt.
        .layer(axum::middleware::map_request(fremde_request_id_pruefen))
        // Schutzköpfe an JEDER Antwort (LFH-797, `src/AGENTS.md`, „Schutzköpfe“). Ganz außen,
        // damit auch Panik-500, Lastabwurf, 405 und der Frontend-Fallback ihn tragen.
        // `if_not_present`: eine Route, die den Kopf selbst setzt (Anhang, Logo, Karten-Assets),
        // behält ihren Wert, und er steht nie doppelt.
        .layer(
            tower_http::set_header::SetResponseHeaderLayer::if_not_present(
                axum::http::header::X_CONTENT_TYPE_OPTIONS,
                axum::http::HeaderValue::from_static("nosniff"),
            ),
        )
        // Platz für den fertigen Router (LLH-1492, D11): der Führer führt Anträge darüber aus.
        .layer(axum::Extension(router_platz.clone()))
        .with_state(state);
    let _ = router_platz.0.set(router.clone());
    router
}

/// Ab dieser Größe (Bytes) wird eine JSON-Antwort komprimiert (LFH-940); darunter kostet das
/// Packen mehr, als es spart.
pub const ANTWORT_KOMPRESSION_AB: u64 = 1024;

/// Kompressionsstufe für gzip und br (LFH-940). Brotli 11 (Vorgabe) kostet bei einer Liste im
/// MB-Bereich CPU-Sekunden auf dem Worker; Stufe 4 packt JSON fast so gut in einem Bruchteil.
const ANTWORT_KOMPRESSION_STUFE: i32 = 4;

/// Prädikat der Antwortkompression: `application/json`, mindestens `ab` Bytes, ohne `ETag`
/// (ein starker ETag gälte sonst für zwei Darstellungen) und ohne `Cache-Control` (das tragen
/// die eingebetteten Frontend-Dateien und Assets, nie eine Liste der API).
fn nur_json_ab(ab: u64) -> impl tower_http::compression::Predicate {
    use tower_http::compression::predicate::{Predicate, SizeAbove};
    SizeAbove::new(ab).and(
        |_: axum::http::StatusCode,
         _: axum::http::Version,
         kopf: &axum::http::HeaderMap,
         _: &axum::http::Extensions| {
            kopf.get(axum::http::header::CONTENT_TYPE)
                .and_then(|t| t.to_str().ok())
                .is_some_and(|t| t.starts_with("application/json"))
                && !kopf.contains_key(axum::http::header::ETAG)
                && !kopf.contains_key(axum::http::header::CACHE_CONTROL)
        },
    )
}

/// Höchstlänge einer vom Client mitgeschickten Request-ID (LFH-925).
pub const REQUEST_ID_MAX: usize = 64;

/// Höchstlänge des Pfads im Span, in Zeichen samt Auslassungsmarke (LFH-925).
pub const PFAD_MAX_ZEICHEN: usize = 256;

/// Eine Request-ID vom Client gilt nur mit 1 bis [`REQUEST_ID_MAX`] Zeichen aus `[A-Za-z0-9-]`
/// (eine UUID passt). Alles andere könnte das Log mit langen oder Steuerzeichen fluten.
fn request_id_zulaessig(wert: &[u8]) -> bool {
    !wert.is_empty()
        && wert.len() <= REQUEST_ID_MAX
        && wert.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'-')
}

/// Entfernt eine unzulässige `x-request-id` des Clients, auch mehrfach gesendete; der
/// nachfolgende `SetRequestIdLayer` setzt dann eine UUID.
async fn fremde_request_id_pruefen(mut request: axum::extract::Request) -> axum::extract::Request {
    let kopf = axum::http::HeaderName::from_static("x-request-id");
    let werte = request.headers().get_all(&kopf);
    let mut werte = werte.iter();
    let zulaessig = match (werte.next(), werte.next()) {
        (None, _) => return request,
        (Some(wert), None) => request_id_zulaessig(wert.as_bytes()),
        (Some(_), Some(_)) => false,
    };
    if !zulaessig {
        request.headers_mut().remove(&kopf);
    }
    request
}

/// Der Pfad, wie er im Log steht: zuerst ohne Geheimnis, dann gekürzt.
///
/// - Der Schlüssel eines Einwurf-Zugangs steht im Pfad (ADR-0023);
///   `public_api::einwurf::maskiere_pfad` ersetzt ihn, bevor gekürzt wird. Die Abfrage steht
///   ohnehin nie im Span.
/// - Gekürzt wird auf höchstens [`PFAD_MAX_ZEICHEN`] Zeichen, an einer Zeichengrenze und mit `…`
///   am Ende.
fn pfad_fuer_protokoll(pfad: &str) -> std::borrow::Cow<'_, str> {
    let pfad = crate::public_api::einwurf::maskiere_pfad(pfad);
    if pfad.chars().nth(PFAD_MAX_ZEICHEN).is_none() {
        return pfad;
    }
    let ende = pfad
        .char_indices()
        .nth(PFAD_MAX_ZEICHEN - 1)
        .map_or(pfad.len(), |(i, _)| i);
    std::borrow::Cow::Owned(format!("{}…", &pfad[..ende]))
}

/// Baut den `tracing`-Span jedes HTTP-Requests. Eigene Implementierung, weil `DefaultMakeSpan`
/// die Request-ID nicht kennt. Pfad gekürzt, Request-ID nur in zulässiger Form (LFH-925): beide
/// hängen an jeder Logzeile des Requests.
#[derive(Clone, Copy)]
struct MakeSpanMitRequestId;

impl<B> tower_http::trace::MakeSpan<B> for MakeSpanMitRequestId {
    fn make_span(&mut self, request: &axum::http::Request<B>) -> tracing::Span {
        let request_id = request
            .headers()
            .get("x-request-id")
            .filter(|wert| request_id_zulaessig(wert.as_bytes()))
            .and_then(|wert| wert.to_str().ok())
            .unwrap_or("-");
        tracing::info_span!(
            "http",
            methode = %request.method(),
            pfad = %pfad_fuer_protokoll(request.uri().path()),
            request_id = %request_id,
        )
    }
}

/// `on_failure` des `TraceLayer` (LFH-925). Der Standard schreibt jeden 5xx als ERROR; ein 503
/// ist aber Überlast (Lastabwurf, Pool, Sperren), die ein Fremder je Anfrage auslösen kann. Er geht
/// deshalb als WARN-[`Sammelzeile`](crate::log_drossel::Sammelzeile) ins Log. Jeder andere
/// Fehler bleibt eine ERROR-Zeile wie bisher.
#[derive(Clone, Copy)]
struct OnFailureOhneUeberlastFlut;

impl tower_http::trace::OnFailure<tower_http::classify::ServerErrorsFailureClass>
    for OnFailureOhneUeberlastFlut
{
    fn on_failure(
        &mut self,
        klasse: tower_http::classify::ServerErrorsFailureClass,
        latenz: std::time::Duration,
        _span: &tracing::Span,
    ) {
        use tower_http::classify::ServerErrorsFailureClass;
        static UEBERLAST: crate::log_drossel::Sammelzeile = crate::log_drossel::Sammelzeile::neu();
        let latenz_ms = latenz.as_millis() as u64;
        match klasse {
            ServerErrorsFailureClass::StatusCode(axum::http::StatusCode::SERVICE_UNAVAILABLE) => {
                if let Some(f) = UEBERLAST.zaehlen() {
                    tracing::warn!(
                        anzahl = f.anzahl,
                        seit_s = f.seit_s,
                        latenz_ms,
                        "Antworten mit 503 (Überlast), Sammelzeile"
                    );
                }
            }
            andere => tracing::error!(klasse = %andere, latenz_ms, "response failed"),
        }
    }
}

/// ETB-Wächter (LLH-1976, `src/AGENTS.md`, „Backend — ETB live verteilen“): AUSSERHALB von
/// CatchPanic, damit eine Lücke in Debug und Test als Panic bis in den Test durchschlägt statt als
/// 500 zu enden. Im Release-Build fehlt die Schicht ganz und kostet nichts.
fn mit_etb_waechter(router: Router<AppState>, state: &AppState) -> Router<AppState> {
    #[cfg(debug_assertions)]
    {
        router.layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::etb::nachlauf::waechter,
        ))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = state;
        router
    }
}

/// 405 mit demselben `{error}`-JSON wie `AppError`. Als rohes Tupel, weil `AppError` keine
/// 405-Variante trägt (wie [`on_panic`]).
async fn methode_nicht_erlaubt() -> axum::response::Response {
    (
        axum::http::StatusCode::METHOD_NOT_ALLOWED,
        axum::Json(serde_json::json!({ "error": "Methode für diesen Pfad nicht erlaubt" })),
    )
        .into_response()
}

/// 500 mit demselben `{error}`-JSON wie `AppError` nach einer abgefangenen Panik; der Grund
/// bleibt im Log.
fn on_panic(_err: Box<dyn std::any::Any + Send + 'static>) -> axum::response::Response {
    tracing::error!("Handler-Panik durch CatchPanicLayer abgefangen");
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        axum::Json(serde_json::json!({ "error": "Interner Serverfehler" })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    /// Spec `antwortkompression`: nur JSON ohne ETag und ohne Cache-Control (LFH-940).
    #[test]
    fn kompression_nur_fuer_api_json() {
        use axum::http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, ETAG};
        use tower_http::compression::Predicate;
        let p = nur_json_ab(ANTWORT_KOMPRESSION_AB);
        let antwort = |kopf: &[(axum::http::HeaderName, &'static str)]| {
            let mut r = axum::http::Response::new(axum::body::Body::from(vec![b'x'; 4096]));
            r.headers_mut()
                .insert(CONTENT_LENGTH, axum::http::HeaderValue::from_static("4096"));
            for (k, v) in kopf {
                r.headers_mut()
                    .insert(k.clone(), axum::http::HeaderValue::from_static(v));
            }
            r
        };
        assert!(p.should_compress(&antwort(&[(CONTENT_TYPE, "application/json")])));
        assert!(!p.should_compress(&antwort(&[
            (CONTENT_TYPE, "application/json"),
            (ETAG, "\"abc\""),
        ])));
        assert!(!p.should_compress(&antwort(&[
            (CONTENT_TYPE, "application/json"),
            (CACHE_CONTROL, "no-cache"),
        ])));
        assert!(!p.should_compress(&antwort(&[(CONTENT_TYPE, "text/event-stream")])));
    }

    /// LFH-925: nur 1 bis 64 Zeichen aus `[A-Za-z0-9-]` gelten als Request-ID des Clients.
    #[test]
    fn request_id_des_clients_wird_geprueft() {
        assert!(request_id_zulaessig(
            b"0f8e1c2a-7b3d-4e5f-9a6b-1c2d3e4f5a6b"
        ));
        assert!(request_id_zulaessig(&[b'a'; REQUEST_ID_MAX]));
        assert!(!request_id_zulaessig(&[b'a'; REQUEST_ID_MAX + 1]));
        assert!(!request_id_zulaessig(b""));
        assert!(!request_id_zulaessig(b"mit leerzeichen"));
        assert!(!request_id_zulaessig(b"zeile\r\nfalsch"));
        assert!(!request_id_zulaessig("ümlaut".as_bytes()));
    }

    /// LFH-925: der Span-Pfad hat höchstens 256 Zeichen, auch bei Mehrbyte-Zeichen.
    #[test]
    fn pfad_wird_fuer_das_log_gekuerzt() {
        assert_eq!(pfad_fuer_protokoll("/api/health"), "/api/health");
        let genau = format!("/{}", "a".repeat(PFAD_MAX_ZEICHEN - 1));
        assert_eq!(pfad_fuer_protokoll(&genau), genau.as_str());

        for zeichen in ["a", "ä", "€"] {
            let lang = format!("/{}", zeichen.repeat(10 * 1024));
            let gekuerzt = pfad_fuer_protokoll(&lang);
            assert_eq!(gekuerzt.chars().count(), PFAD_MAX_ZEICHEN, "{zeichen}");
            assert!(gekuerzt.ends_with('…'));
            assert!(lang.starts_with(gekuerzt.trim_end_matches('…')));
        }
    }

    /// ADR-0023: der Schlüssel eines Einwurf-Zugangs steht nie im Span, auch nicht in einem
    /// langen Pfad, und die Maske zählt bei der Längengrenze mit.
    #[test]
    fn pfad_fuer_das_log_traegt_keinen_einwurf_schluessel() {
        let schluessel = crate::public_api::einwurf::neuer_schluessel();
        assert_eq!(
            pfad_fuer_protokoll(&format!("/api/v1/intake/{schluessel}/alarm")),
            "/api/v1/intake/***/alarm"
        );
        // Ein Schlüssel nahe der Längengrenze: maskiert passt der Pfad, also wird er nicht gekürzt.
        let lang = format!("/{}/{schluessel}/x", "a".repeat(PFAD_MAX_ZEICHEN - 20));
        let maskiert = pfad_fuer_protokoll(&lang);
        assert!(maskiert.ends_with("/***/x"), "{maskiert}");
        // Ein langer Pfad mit Schlüssel am Anfang: maskiert und gekürzt.
        let sehr_lang = format!("/api/v1/intake/{schluessel}/{}", "a".repeat(400));
        let gekuerzt = pfad_fuer_protokoll(&sehr_lang);
        assert!(gekuerzt.starts_with("/api/v1/intake/***/aaa"), "{gekuerzt}");
        assert_eq!(gekuerzt.chars().count(), PFAD_MAX_ZEICHEN);
        // Auch ohne Schrägstrich vor dem Schlüssel.
        let pfad = format!("/api/v1/intake{schluessel}/alarm");
        let verklebt = pfad_fuer_protokoll(&pfad);
        assert!(!verklebt.contains(&schluessel[7..]), "{verklebt}");
    }

    /// Der `AppState` für Tests, die den ganzen Router brauchen.
    fn einwurf_test_state(pool: sqlx::SqlitePool) -> AppState {
        use crate::karte::auto_aktualisierung::{AutoAktualisierung, Einstellung};
        AppState {
            pool,
            live: crate::live::LiveHub::new(),
            fachebenen: crate::karte::FachebenenState::neu(),
            karten_dir: std::env::temp_dir(),
            download_client: crate::karte::download::download_client(),
            download_fortschritt: crate::karte::download::neue_fortschritt_map(),
            karten_service_url: None,
            karten_service_token: None,
            auto_aktualisierung: AutoAktualisierung::neu(
                Einstellung::default(),
                reqwest::Client::new(),
            ),
            backup_download: Default::default(),
            einsatzakte_bau: Default::default(),
            backup_empfaenger: Default::default(),
            datentraeger: Default::default(),
            adapter: Default::default(),
            drohne: Default::default(),
        }
    }

    /// Akzeptanzkriterium LLH-1654: der Schlüssel steht in keiner Logzeile. Der Test schickt
    /// Einwürfe durch den ganzen Router, mit gültigem und mit unbekannten Schlüsseln, bis die
    /// Sperre der Quelle eine WARN-Zeile im Span der Anfrage schreibt. Das mitgeschnittene Log
    /// nennt den maskierten Pfad und enthält weder einen Schlüssel noch seinen Hash noch die
    /// Abfrage.
    #[tokio::test]
    async fn einwurf_schluessel_steht_in_keiner_logzeile() {
        use crate::public_api::einwurf;
        use crate::public_api::scope::Scope;
        use axum::body::Body;
        use axum::extract::ConnectInfo;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;

        let (puffer, _log) = crate::test_log::LogPuffer::einfangen();
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let (_, gueltig) = {
            let mut conn = pool.acquire().await.unwrap();
            einwurf::anlegen(
                &mut conn,
                1,
                "BOSWatch",
                Scope::AlarmmeldungenWrite,
                None,
                None,
                &crate::zeit::jetzt(),
            )
            .await
            .unwrap()
        };
        let app = build_router_mit(
            einwurf_test_state(pool.clone()),
            RouterOptionen {
                einwurf_allow_http: true,
                ..Default::default()
            },
        );
        // Eigene Adresse: der Zähler für Maschinen gilt prozessweit.
        let quelle: std::net::SocketAddr = "198.51.100.231:4711".parse().unwrap();
        let einwerfen = |schluessel: String| {
            let app = app.clone();
            async move {
                let mut req = Request::builder()
                    .uri(format!(
                        "/api/v1/intake/{schluessel}/alarm?text=GEHEIMER-ALARMTEXT"
                    ))
                    .body(Body::empty())
                    .unwrap();
                req.extensions_mut().insert(ConnectInfo(quelle));
                app.oneshot(req).await.unwrap().status()
            }
        };

        assert_eq!(einwerfen(gueltig.clone()).await, StatusCode::NO_CONTENT);
        let mut unbekannte = Vec::new();
        for _ in 0..crate::auth::rate_limit::MAX_FEHLVERSUCHE {
            let schluessel = einwurf::neuer_schluessel();
            assert_eq!(
                einwerfen(schluessel.clone()).await,
                StatusCode::UNAUTHORIZED
            );
            unbekannte.push(schluessel);
        }
        // Die Quelle ist jetzt gesperrt, auch mit gültigem Schlüssel; das schreibt die WARN-Zeile.
        assert_eq!(
            einwerfen(gueltig.clone()).await,
            StatusCode::TOO_MANY_REQUESTS
        );

        let log = puffer.text();
        assert!(
            log.contains("pfad=/api/v1/intake/***/alarm"),
            "der Span nennt den maskierten Pfad:\n{log}"
        );
        for schluessel in unbekannte.iter().chain([&gueltig]) {
            assert!(
                !log.contains(schluessel.as_str()),
                "Schlüssel im Log:\n{log}"
            );
            assert!(
                !log.contains(&einwurf::hash(schluessel)),
                "Hash im Log:\n{log}"
            );
        }
        assert!(!log.contains("llh_ew_"), "{log}");
        assert!(
            !log.contains("GEHEIMER-ALARMTEXT"),
            "Abfrage im Log:\n{log}"
        );
    }

    /// LFH-925: ein 503 schreibt keine ERROR-Zeile aus dem `TraceLayer` mehr, ein 500 weiter.
    #[test]
    fn trace_layer_schreibt_503_nicht_als_error() {
        use tower_http::classify::ServerErrorsFailureClass;
        use tower_http::trace::OnFailure;
        let (puffer, _log) = crate::test_log::LogPuffer::einfangen();
        let span = tracing::Span::none();
        for _ in 0..100 {
            OnFailureOhneUeberlastFlut.on_failure(
                ServerErrorsFailureClass::StatusCode(axum::http::StatusCode::SERVICE_UNAVAILABLE),
                std::time::Duration::from_millis(1),
                &span,
            );
        }
        let log = puffer.text();
        assert!(!log.contains("ERROR"), "{log}");
        assert!(log.matches("Antworten mit 503").count() <= 1, "{log}");

        OnFailureOhneUeberlastFlut.on_failure(
            ServerErrorsFailureClass::StatusCode(axum::http::StatusCode::INTERNAL_SERVER_ERROR),
            std::time::Duration::from_millis(1),
            &span,
        );
        let log = puffer.text();
        assert_eq!(log.matches("ERROR").count(), 1, "{log}");
    }

    #[tokio::test]
    async fn on_panic_liefert_500_mit_error_envelope() {
        let resp = on_panic(Box::new("boom"));
        assert_eq!(resp.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"], "Interner Serverfehler");
    }

    /// Eine echte Handler-Panik wird durch die Service-Kette gefangen und als 500 + `{error}`
    /// beantwortet.
    #[tokio::test]
    async fn catch_panic_layer_faengt_echte_panik_durch_die_service_kette() {
        use axum::body::Body;
        use axum::http::Request;
        use axum::routing::get;
        use tower::ServiceExt; // oneshot

        let app = Router::new()
            .route(
                "/boom",
                get(|| async {
                    panic!("absichtliche Test-Panik");
                    #[allow(unreachable_code)]
                    axum::http::StatusCode::OK
                }),
            )
            .layer(tower_http::catch_panic::CatchPanicLayer::custom(on_panic));

        let resp = app
            .oneshot(Request::builder().uri("/boom").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"], "Interner Serverfehler");
    }

    /// Unter `/api/v1/` bekommen auch Panik-500 und Lastabwurf-503 ihren `code` (LLH-1653,
    /// design.md D2): die Schicht `public_api::contract_layer` liegt außerhalb von CatchPanic und
    /// Zulassung, in derselben Reihenfolge wie in `build_router_mit`.
    #[tokio::test]
    async fn panik_und_lastabwurf_unter_v1_tragen_code() {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use axum::routing::get;
        use tower::ServiceExt; // oneshot

        let zulassung = crate::zulassung::Zulassung::neu(
            std::time::Duration::from_millis(50),
            crate::zulassung::MAX_GLEICHZEITIGE_REQUESTS,
        );
        let app = Router::new()
            .route(
                "/api/v1/boom",
                get(|| async {
                    panic!("absichtliche Test-Panik");
                    #[allow(unreachable_code)]
                    StatusCode::OK
                }),
            )
            .route(
                "/api/v1/langsam",
                get(|| async {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    StatusCode::OK
                }),
            )
            .layer(tower_http::catch_panic::CatchPanicLayer::custom(on_panic))
            .layer(axum::middleware::from_fn_with_state(
                zulassung,
                crate::zulassung::zulassung,
            ))
            .layer(axum::middleware::from_fn(crate::public_api::contract_layer));

        for (path, status, code) in [
            (
                "/api/v1/boom",
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
            ),
            (
                "/api/v1/langsam",
                StatusCode::SERVICE_UNAVAILABLE,
                "unavailable",
            ),
        ] {
            let resp = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(resp.status(), status, "{path}");
            let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(json["code"], code, "{path}: {json}");
            assert!(
                json["error"].as_str().is_some_and(|t| !t.is_empty()),
                "{path}"
            );
        }
    }
}
