use crate::karte::FachebenenState;
use crate::live::LiveHub;
use crate::routes;
use crate::transfer::UPLOAD_BODY_MAX;
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
    /// Öffentliche Schlüssel, an die `GET /api/backup` verschlüsselt (LFH-1002); leer → Klartext.
    pub backup_empfaenger: crate::backup::Empfaenger,
    /// Letztes Ergebnis der Datenträgerprüfung (LFH-1100), `GET /api/system/datentraeger`.
    pub datentraeger: crate::datentraeger::Stand,
}

/// Schalter, die nur das Routing betreffen (LFH-690).
///
/// Nicht im `AppState`, weil ein Feld dort jede Test-Konstruktion bräche und kein Handler den
/// Wert braucht. Kein prozessweiter `OnceLock`, weil der „aus“ und „an“ nicht im selben
/// Test-Binary prüfen ließe.
#[derive(Debug, Clone, Default)]
pub struct RouterOptionen {
    /// Registriert die Routen unter `/api/demo-daten` (`--demo-daten`). Ohne den Schalter
    /// antworten sie wie jeder unbekannte `/api/`-Pfad mit 404, auch angemeldet.
    pub demo_daten: bool,
    /// Zeitbudget der Zulassungssteuerung; `None` = [`crate::zulassung::REQUEST_BUDGET`]. Nur
    /// Tests setzen es, um ohne Minuten Wartezeit zu belegen, welche Routen dem Budget entzogen
    /// sind (LFH-938).
    pub zulassungs_budget: Option<Duration>,
    /// Austauschverzeichnis des HEIC-Decoders (`--heic-decoder-verzeichnis`, LFH-1000); `None`
    /// = die eingebettete Fassung.
    pub heic_decoder_verzeichnis: Option<PathBuf>,
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
const JSON_BODY_MAX: usize = 256 * 1024;

/// Zone anlegen und Abschnittsfläche setzen (LFH-1074): Geometrie bis 256 KiB
/// (`lage_zone::pruefe_geometrie_groesse`) plus Rahmen. So bleibt die Geometrieprüfung (400 mit
/// Feldmeldung) die wirksame Grenze.
const GEOMETRIE_BODY_MAX: usize = 256 * 1024 + 64 * 1024;

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
        .route("/api/backup", get(routes::backup::download))
        .route(
            "/api/system/datentraeger",
            get(routes::system::datentraeger),
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
            "/api/auth/app-code/einloesen",
            post(routes::auth::app_code_einloesen).layer(DefaultBodyLimit::max(AUTH_CODE_BODY_MAX)),
        )
        // LFH-892: ein Gerät löst seinen Kopplungscode ein (öffentlich, Rate-Limit je Quelle).
        .route(
            "/api/geraete/koppeln",
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
        .route("/api/auth/passwort", post(routes::auth::passwort_aendern))
        .route("/api/auth/sitzungen", get(routes::sitzung::eigene_liste))
        .route(
            "/api/auth/sitzungen/andere-beenden",
            post(routes::sitzung::eigene_andere_beenden),
        )
        .route(
            "/api/auth/sitzungen/{kennung}",
            delete(routes::sitzung::eigene_beenden),
        )
        .route("/api/benutzer", get(routes::benutzer::liste))
        .route("/api/benutzer", post(routes::benutzer::anlegen))
        .route("/api/benutzer/{id}", patch(routes::benutzer::bearbeiten))
        .route(
            "/api/benutzer/{id}/deaktivieren",
            post(routes::benutzer::deaktivieren),
        )
        .route(
            "/api/benutzer/{id}/totp/reset",
            post(routes::benutzer::totp_reset),
        )
        // Zugangsprotokoll (LFH-1097): Anmelde- und Admin-Spur lesen, nur System-Admin, das
        // Lesen selbst unprotokolliert. Nachweis tests/zugangsprotokoll.rs.
        .route(
            "/api/zugangsprotokoll/anmeldungen",
            get(routes::zugangsprotokoll::anmeldungen),
        )
        .route(
            "/api/zugangsprotokoll/zugangsaenderungen",
            get(routes::zugangsprotokoll::zugangsaenderungen),
        )
        .route(
            "/api/benutzer/{id}/sitzungen",
            get(routes::sitzung::admin_liste),
        )
        .route(
            "/api/benutzer/{id}/sitzungen/beenden",
            post(routes::sitzung::admin_alle_beenden),
        )
        .route(
            "/api/benutzer/{id}/sitzungen/{kennung}",
            delete(routes::sitzung::admin_beenden),
        )
        .route(
            "/api/benutzer-einstellungen",
            get(routes::benutzer_einstellungen::lesen),
        )
        .route(
            "/api/benutzer-einstellungen/{schluessel}",
            put(routes::benutzer_einstellungen::setzen),
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
            "/api/einsaetze/{id}/fuehrungsstelle",
            get(routes::einsatz_fuehrungsstelle::lesen)
                .patch(routes::einsatz_fuehrungsstelle::aendern),
        )
        // LFH-893: Einzel-Zuordnung (design.md D5), neben dem PATCH mit `sprechgruppe_ids`.
        .route(
            "/api/einsaetze/{id}/fuehrungsstelle/sprechgruppen/{sg}",
            put(routes::einsatz_fuehrungsstelle::sprechgruppe_zuordnen)
                .delete(routes::einsatz_fuehrungsstelle::sprechgruppe_loesen),
        )
        .route(
            "/api/einsaetze/{id}/aufbewahrungsfrist",
            put(routes::einsatz::aufbewahrungsfrist_setzen),
        )
        .route(
            "/api/einsaetze/{id}/aufbewahrungsfrist/{kategorie}",
            put(routes::einsatz::kategorie_frist_setzen),
        )
        .route(
            "/api/einsaetze/{id}/aufbewahrung-kategorien",
            get(routes::einsatz::kategorien_lesen),
        )
        .route(
            "/api/einsaetze/{id}/einstellungen",
            get(routes::einsatz::einstellungen_laden).put(routes::einsatz::einstellungen_setzen),
        )
        .route(
            "/api/einsaetze/{id}/modul-overrides",
            get(routes::einsatz::modul_overrides_laden),
        )
        .route(
            "/api/einsaetze/{id}/modul-freigaben",
            get(routes::einsatz::modul_freigaben_laden),
        )
        .route(
            "/api/einsaetze/{id}/modul-overrides/{modul_key}",
            put(routes::einsatz::modul_override_setzen),
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
        // Kanonischer Live-Feed des Einsatzes; die Modul-Berechtigung wirkt als Filter je Event
        // statt
        // als Gate der Route.
        .route("/api/einsaetze/{id}/live", get(routes::live::stream))
        // Org-Strom für Tabs außerhalb eines Einsatzes (LFH-734); bewusst NICHT unter
        // `/api/einsaetze/`, damit er weder mit `{id}` noch mit `PFAD_KEY` kollidiert.
        .route("/api/live", get(routes::live::org_stream))
        // Modulzähler: modul-lose Gate-Route wie `/live`, die Modulrechte filtern die Felder.
        .route(
            "/api/einsaetze/{id}/modul-zaehler",
            get(routes::modul_zaehler::liste),
        )
        // Lagebild des Lagemonitors (LFH-892): modul-los, nur für die Ansicht `lagemonitor`.
        .route(
            "/api/einsaetze/{id}/lagemonitor",
            get(routes::lagemonitor::lagebild),
        )
        .route("/api/einsaetze/{id}/etb", get(routes::etb::liste))
        .route("/api/einsaetze/{id}/etb/zaehler", get(routes::etb::zaehler))
        .route("/api/einsaetze/{id}/etb/anzahl", get(routes::etb::anzahl))
        .route(
            "/api/einsaetze/{id}/etb/lesemarke",
            get(routes::etb::lesemarke).post(routes::etb::lesemarke_setzen),
        )
        .route(
            "/api/einsaetze/{id}/etb/{eintrag_id}/auftrag",
            post(routes::etb::auftrag_erteilen),
        )
        // ETB-Anhänge: Upload mit Body-Limit (die Vorgabe von 2 MiB kappte still) und Upload-Grenze,
        // Download mit Download-Grenze.
        .route(
            "/api/einsaetze/{id}/etb/anhaenge",
            post(routes::etb::anhang_hochladen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/etb/{eintrag_id}/anhaenge/{aid}",
            get(routes::etb::anhang_herunterladen).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/chat/kanaele",
            get(routes::chat::kanaele_liste),
        )
        .route(
            "/api/einsaetze/{id}/chat/kanaele",
            post(routes::chat::kanal_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten",
            get(routes::chat::nachrichten_liste),
        )
        .route(
            "/api/einsaetze/{id}/chat/kanaele/{kid}/nachrichten",
            post(routes::chat::nachricht_erfassen),
        )
        .route(
            "/api/einsaetze/{id}/chat/kanaele/{kid}/gelesen",
            post(routes::chat::kanal_gelesen_markieren),
        )
        .route(
            "/api/einsaetze/{id}/chat/nachrichten/{mid}",
            patch(routes::chat::nachricht_bearbeiten),
        )
        .route(
            "/api/einsaetze/{id}/chat/nachrichten/{mid}",
            delete(routes::chat::nachricht_loeschen),
        )
        .route(
            "/api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-etb",
            post(routes::chat::heraufstufen),
        )
        .route(
            "/api/einsaetze/{id}/chat/nachrichten/{mid}/heraufstufen-auftrag",
            post(routes::chat::heraufstufen_auftrag),
        )
        .route(
            "/api/einsaetze/{id}/chat/nachrichten/{mid}/bezug",
            put(routes::chat::bezug_setzen),
        )
        .route(
            "/api/einsaetze/{id}/chat/nachrichten/{mid}/bezug",
            delete(routes::chat::bezug_loeschen),
        )
        // Generische Anhänge. Body-Limit etwas über MAX_GROESSE (25 MiB) für den
        // Multipart-Overhead.
        .route(
            "/api/einsaetze/{id}/anhaenge",
            post(routes::anhang::hochladen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/anhaenge/{aid}",
            get(routes::anhang::herunterladen).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/anhaenge/{aid}",
            delete(routes::anhang::loeschen),
        )
        // Dokumentenablage: eigener Präfix mit Modul-Gate; Upload/Download wie Anhänge.
        .route(
            "/api/einsaetze/{id}/dokumente",
            get(routes::dokument::liste),
        )
        .route(
            "/api/einsaetze/{id}/dokumente",
            post(routes::dokument::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/dokumente/{did}",
            delete(routes::dokument::entfernen).patch(routes::dokument::aendern),
        )
        .route(
            "/api/einsaetze/{id}/dokumente/{did}/datei",
            get(routes::dokument::datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/erinnerungen",
            get(routes::erinnerung::liste),
        )
        .route(
            "/api/einsaetze/{id}/erinnerungen",
            post(routes::erinnerung::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/erinnerungen/kennzahlen",
            get(routes::erinnerung::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/erinnerungen/{eid}/erledigen",
            post(routes::erinnerung::erledigen),
        )
        .route(
            "/api/einsaetze/{id}/erinnerungen/{eid}/quittieren",
            post(routes::erinnerung::quittieren),
        )
        .route(
            "/api/einsaetze/{id}/erinnerungen/{eid}/oeffnen",
            post(routes::erinnerung::oeffnen),
        )
        .route("/api/einsaetze/{id}/auftraege", get(routes::auftrag::liste))
        .route(
            "/api/einsaetze/{id}/auftraege/kennzahlen",
            get(routes::auftrag::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/auftraege/{aid}",
            get(routes::auftrag::detail),
        )
        .route(
            "/api/einsaetze/{id}/auftraege",
            post(routes::auftrag::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/auftraege/{aid}/empfaenger/{empf}/quittieren",
            post(routes::auftrag::quittieren),
        )
        .route(
            "/api/einsaetze/{id}/auftraege/{aid}/vollzug",
            post(routes::auftrag::vollzug),
        )
        .route(
            "/api/einsaetze/{id}/auftraege/{aid}/abnehmen",
            post(routes::auftrag::abnehmen),
        )
        // Maßgebliche Pegel: Kennzahl für Dashboard und Überblick, Gate `OhneModul`.
        .route(
            "/api/einsaetze/{id}/pegel",
            get(routes::pegel::liste)
                .put(routes::pegel::ersetzen)
                .post(routes::pegel::anfuegen),
        )
        // 24-h-Verlauf je Pegel, modul-los wie die Liste. Das statische Segment `verlauf` schlägt
        // `{pegel_id}`.
        .route(
            "/api/einsaetze/{id}/pegel/verlauf",
            get(routes::pegel::verlauf),
        )
        // Wetter am Einsatzort, am Modul `wetter-pegel` gegatet. Ein Quellausfall ist kein
        // HTTP-Fehler, sondern ein Zustand je Teil.
        .route("/api/einsaetze/{id}/wetter", get(routes::wetter::anzeige))
        // Prognose am einzelnen Pegel: eigene Routen, nicht im Vollersatz-PUT.
        .route(
            "/api/einsaetze/{id}/pegel/{pegel_id}/prognose",
            put(routes::pegel::prognose_setzen).delete(routes::pegel::prognose_loeschen),
        )
        .route(
            "/api/einsaetze/{id}/pegel/{pegel_id}/vorhersage",
            get(routes::pegel::vorhersage_lesen),
        )
        // Stab (S1–S6) und Ablösung. `vorgaben` steht vor `{aid}` nur zur Lesbarkeit.
        .route(
            "/api/einsaetze/{id}/abloesungen",
            get(routes::abloesung::liste).post(routes::abloesung::beginnen),
        )
        .route(
            "/api/einsaetze/{id}/abloesungen/vorgaben",
            get(routes::abloesung::vorgaben),
        )
        .route(
            "/api/einsaetze/{id}/abloesungen/vorgaben/{abschnitt_id}",
            put(routes::abloesung::vorgabe_setzen),
        )
        .route(
            "/api/einsaetze/{id}/abloesungen/{aid}",
            patch(routes::abloesung::aendern),
        )
        .route(
            "/api/einsaetze/{id}/abloesungen/{aid}/vollzug",
            post(routes::abloesung::vollziehen),
        )
        .route(
            "/api/einsaetze/{id}/abloesungen/{aid}/vollzug/zuruecknehmen",
            post(routes::abloesung::zuruecknehmen),
        )
        // Betreuung: Evakuierungsbezirke und Betreuungsstellen mit je einer Meldereihe. Rücknahmen
        // hängen an der Meldung; Bezirk bzw. Stelle kennt die Route erst aus ihr.
        .route(
            "/api/einsaetze/{id}/betreuung",
            get(routes::betreuung::uebersicht),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/belegung",
            get(routes::betreuung::kopfzahl),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/bezirke",
            post(routes::betreuung::bezirk_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/bezirke/{bid}",
            patch(routes::betreuung::bezirk_aendern),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/bezirke/{bid}/stornieren",
            post(routes::betreuung::bezirk_stornieren),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/bezirke/{bid}/staende",
            get(routes::betreuung::stand_verlauf).post(routes::betreuung::stand_melden),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/staende/{sid}/zuruecknehmen",
            post(routes::betreuung::stand_zuruecknehmen),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/stellen",
            post(routes::betreuung::stelle_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/stellen/{sid}",
            patch(routes::betreuung::stelle_aendern),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/stellen/{sid}/stornieren",
            post(routes::betreuung::stelle_stornieren),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen",
            get(routes::betreuung::belegung_verlauf).post(routes::betreuung::belegung_melden),
        )
        .route(
            "/api/einsaetze/{id}/betreuung/belegungen/{mid}/zuruecknehmen",
            post(routes::betreuung::belegung_zuruecknehmen),
        )
        // Verpflegung: Zeitfenster mit Bedarf, Ausgaben dagegen.
        .route(
            "/api/einsaetze/{id}/verpflegung",
            get(routes::verpflegung::uebersicht),
        )
        .route(
            "/api/einsaetze/{id}/verpflegung/zeitfenster",
            post(routes::verpflegung::zeitfenster_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}",
            patch(routes::verpflegung::zeitfenster_aendern)
                .delete(routes::verpflegung::zeitfenster_loeschen),
        )
        .route(
            "/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}/ausgaben",
            post(routes::verpflegung::ausgabe_erfassen),
        )
        .route(
            "/api/einsaetze/{id}/verpflegung/ausgaben/{aid}/zuruecknehmen",
            post(routes::verpflegung::ausgabe_zuruecknehmen),
        )
        .route("/api/einsaetze/{id}/stab", get(routes::stab::laden))
        .route(
            "/api/einsaetze/{id}/stab/besetzung/{sachgebiet}",
            put(routes::stab::besetzung_setzen).delete(routes::stab::besetzung_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/stab/lagebesprechungen",
            get(routes::stab::lagebesprechungen_liste)
                .post(routes::stab::lagebesprechung_abschliessen),
        )
        // LFH-554: Presse- und Medienarbeit S5; Stab-Sperre per Präfix (`PFAD_KEY`).
        .route(
            "/api/einsaetze/{id}/stab/medienkontakte",
            get(routes::presse::medienkontakte_liste).post(routes::presse::medienkontakt_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/medienkontakte/kennzahlen",
            get(routes::presse::medienkontakte_kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/stab/medienkontakte/{kid}",
            get(routes::presse::medienkontakt_detail).patch(routes::presse::medienkontakt_aendern),
        )
        .route(
            "/api/einsaetze/{id}/stab/medienkontakte/{kid}/status",
            post(routes::presse::medienkontakt_status),
        )
        .route(
            "/api/einsaetze/{id}/stab/pressemitteilungen",
            get(routes::presse::pressemitteilungen_liste)
                .post(routes::presse::pressemitteilung_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/pressemitteilungen/{mid}",
            get(routes::presse::pressemitteilung_detail)
                .patch(routes::presse::pressemitteilung_aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/stab/pressemitteilungen/{mid}/freigeben",
            post(routes::presse::pressemitteilung_freigeben),
        )
        .route(
            "/api/einsaetze/{id}/stab/pressemitteilungen/{mid}/fortschreiben",
            post(routes::presse::pressemitteilung_fortschreiben),
        )
        .route(
            "/api/einsaetze/{id}/stab/infotelefon",
            get(routes::infotelefon::liste).post(routes::infotelefon::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/infotelefon/{aid}/status",
            post(routes::infotelefon::status_setzen),
        )
        .route(
            "/api/einsaetze/{id}/stab/checkliste",
            get(routes::stab::checkliste_laden),
        )
        .route(
            "/api/einsaetze/{id}/stab/checkliste/{punkt}",
            put(routes::stab::checkliste_setzen),
        )
        .route(
            "/api/einsaetze/{id}/stab/kommunikationsplan",
            get(routes::stab::kommunikationsplan_laden),
        )
        .route(
            "/api/einsaetze/{id}/stab/kommunikationsplan/stellen",
            post(routes::stab::kommunikationsplan_stelle_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid}",
            patch(routes::stab::kommunikationsplan_stelle_aendern)
                .delete(routes::stab::kommunikationsplan_stelle_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid}/verbindungen",
            post(routes::stab::kommunikationsplan_verbindung_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/kommunikationsplan/verbindungen/{vid}",
            patch(routes::stab::kommunikationsplan_verbindung_aendern)
                .delete(routes::stab::kommunikationsplan_verbindung_entfernen),
        )
        // LFH-893: Kanäle externer Stellen und taktische Fernmeldeskizze (design.md D14).
        .route(
            "/api/einsaetze/{id}/stab/kommunikationsplan/stellen/{sid}/sprechgruppen/{sg}",
            put(routes::stab::kommunikationsplan_kanal_setzen)
                .delete(routes::stab::kommunikationsplan_kanal_loesen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze",
            get(routes::stab::fernmeldeskizze_laden),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/lage",
            delete(routes::stab::fernmeldeskizze_lage_verwerfen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/lage/{element}",
            put(routes::stab::fernmeldeskizze_lage_setzen)
                .delete(routes::stab::fernmeldeskizze_lage_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/schriftfeld",
            put(routes::stab::fernmeldeskizze_schriftfeld_setzen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/komponenten",
            post(routes::stab::fernmeldeskizze_komponente_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/komponenten/{kid}",
            patch(routes::stab::fernmeldeskizze_komponente_aendern)
                .delete(routes::stab::fernmeldeskizze_komponente_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/komponenten/{kid}/sprechgruppen/{sg}",
            put(routes::stab::fernmeldeskizze_komponente_kanal_setzen)
                .delete(routes::stab::fernmeldeskizze_komponente_kanal_loesen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/verbindungen",
            post(routes::stab::fernmeldeskizze_verbindung_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/verbindungen/{vid}",
            patch(routes::stab::fernmeldeskizze_verbindung_aendern)
                .delete(routes::stab::fernmeldeskizze_verbindung_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/bereiche",
            post(routes::stab::fernmeldeskizze_bereich_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/stab/fernmeldeskizze/bereiche/{bid}",
            patch(routes::stab::fernmeldeskizze_bereich_aendern)
                .delete(routes::stab::fernmeldeskizze_bereich_entfernen),
        )
        .route("/api/einsaetze/{id}/meldungen", get(routes::meldung::liste))
        .route(
            "/api/einsaetze/{id}/meldungen/rueckmeldungen",
            get(routes::meldung::rueckmeldungen),
        )
        .route(
            "/api/einsaetze/{id}/meldungen/kennzahlen",
            get(routes::meldung::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/meldungen/{mid}",
            get(routes::meldung::detail),
        )
        .route(
            "/api/einsaetze/{id}/meldungen",
            post(routes::meldung::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/meldungen/{mid}/status",
            post(routes::meldung::status),
        )
        .route(
            "/api/einsaetze/{id}/meldungen/{mid}/zuweisen",
            post(routes::meldung::zuweisen),
        )
        .route(
            "/api/einsaetze/{id}/meldungen/{mid}/bestaetigen",
            post(routes::meldung::bestaetigen),
        )
        .route(
            "/api/einsaetze/{id}/meldungen/{mid}/lagerelevant",
            post(routes::meldung::lagerelevant),
        )
        .route(
            "/api/einsaetze/{id}/meldungen/{mid}/auftrag",
            post(routes::meldung::auftrag_erteilen),
        )
        .route(
            "/api/einsaetze/{id}/lage/meldungen",
            get(routes::meldung::lage_liste),
        )
        .route(
            "/api/einsaetze/{id}/ort-vorschau",
            get(routes::ort_vorschau::vorschau),
        )
        .route(
            "/api/einsaetze/{id}/nachforderungen",
            get(routes::nachforderung::liste),
        )
        .route(
            "/api/einsaetze/{id}/nachforderungen",
            post(routes::nachforderung::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/nachforderungen/{nid}/status",
            post(routes::nachforderung::status),
        )
        .route(
            "/api/einsaetze/{id}/nachforderungen/{nid}/ablehnen",
            post(routes::nachforderung::ablehnen),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge",
            get(routes::einsatz_fahrzeug::liste),
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
        .route(
            "/api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung/{ep_id}",
            put(routes::einsatz_fahrzeug::besatzung_zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/fahrzeuge/{ef_id}/besatzung/{ep_id}",
            delete(routes::einsatz_fahrzeug::besatzung_freigeben),
        )
        .route(
            "/api/einsaetze/{id}/personal",
            get(routes::einsatz_personal::liste),
        )
        .route(
            "/api/einsaetze/{id}/personal",
            post(routes::einsatz_personal::disponieren),
        )
        .route(
            "/api/einsaetze/{id}/personal/{ep_id}",
            patch(routes::einsatz_personal::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/personal/{ep_id}",
            delete(routes::einsatz_personal::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/personal/{ep_id}/position",
            patch(routes::einsatz_personal::position),
        )
        // Kräfte-Zeitachse (LFH-552) unter dem Personal-Präfix.
        .route(
            "/api/einsaetze/{id}/personal/zeitachse",
            get(routes::zeitachse::personal_perioden),
        )
        .route(
            "/api/einsaetze/{id}/personal/{ep_id}/zeitachse",
            get(routes::zeitachse::person_laden).post(routes::zeitachse::person_nachtragen),
        )
        .route(
            "/api/einsaetze/{id}/personal/{ep_id}/zeitachse/{zid}/streichen",
            post(routes::zeitachse::person_streichen),
        )
        .route(
            "/api/einsaetze/{id}/karte/fuehrungskraefte",
            get(routes::einsatz_personal::karte_fuehrungskraefte),
        )
        // Adresssuche der Lagekarte (LFH-638): Forward-Geocoding, am Modul Lagekarte (`/karte`).
        .route(
            "/api/einsaetze/{id}/karte/ort-suche",
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
            patch(routes::einsatz_material::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/material/{em_id}",
            delete(routes::einsatz_material::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/personen",
            get(routes::einsatz_person::liste),
        )
        .route(
            "/api/einsaetze/{id}/personen",
            post(routes::einsatz_person::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/personen/auswahl",
            get(routes::einsatz_person::auswahl),
        )
        .route(
            "/api/einsaetze/{id}/personen/bestaetiger",
            get(routes::einsatz_person::bestaetiger),
        )
        .route(
            "/api/einsaetze/{id}/personen/export",
            get(routes::einsatz_person::export),
        )
        .route(
            "/api/einsaetze/{id}/personen/druck",
            get(routes::einsatz_person::druck),
        )
        .route(
            "/api/einsaetze/{id}/personen/listenzugriffe",
            get(routes::einsatz_person::listenzugriffe),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}",
            get(routes::einsatz_person::detail),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}",
            patch(routes::einsatz_person::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/status",
            post(routes::einsatz_person::status_wechsel),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/sichtung",
            post(routes::einsatz_person::sichten),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/verbleib",
            post(routes::einsatz_person::verbleib),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/notizen",
            post(routes::einsatz_person::notiz),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/abgleich",
            post(routes::einsatz_person::abgleich_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/abgleich/{aid}/entscheidung",
            post(routes::einsatz_person::abgleich_entscheiden),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/audit",
            get(routes::einsatz_person::audit),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}",
            delete(routes::einsatz_person::stornieren),
        )
        // Personen-Anhänge (LFH-757): Modul-Gate `personen`; Upload/Download wie am Schaden,
        // der Download schreibt je Abruf eine Zeile ins Zugriffsprotokoll der Person.
        .route(
            "/api/einsaetze/{id}/personen/{pid}/anhaenge",
            get(routes::person_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/anhaenge",
            post(routes::person_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/anhaenge/{aid}",
            delete(routes::person_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/anhaenge/{aid}/datei",
            get(routes::person_anhang::datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/tiere",
            get(routes::einsatz_tier::liste),
        )
        .route(
            "/api/einsaetze/{id}/tiere",
            post(routes::einsatz_tier::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/tiere/export",
            get(routes::einsatz_tier::export),
        )
        .route(
            "/api/einsaetze/{id}/tiere/{tid}",
            get(routes::einsatz_tier::detail),
        )
        .route(
            "/api/einsaetze/{id}/tiere/{tid}",
            patch(routes::einsatz_tier::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/tiere/{tid}/status",
            post(routes::einsatz_tier::status_wechsel),
        )
        .route(
            "/api/einsaetze/{id}/tiere/{tid}",
            delete(routes::einsatz_tier::stornieren),
        )
        // Tier-Anhänge (LFH-758): Modul-Gate `tiere`; Upload/Download wie die Schaden-Anhänge.
        .route(
            "/api/einsaetze/{id}/tiere/{tid}/anhaenge",
            get(routes::tier_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/tiere/{tid}/anhaenge",
            post(routes::tier_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/tiere/{tid}/anhaenge/{aid}",
            delete(routes::tier_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/tiere/{tid}/anhaenge/{aid}/datei",
            get(routes::tier_anhang::datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/schaeden",
            get(routes::einsatz_schaden::liste),
        )
        .route(
            "/api/einsaetze/{id}/schaeden",
            post(routes::einsatz_schaden::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/marker",
            get(routes::einsatz_schaden::marker),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/kennzahlen",
            get(routes::einsatz_schaden::kennzahlen),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/auswahl",
            get(routes::einsatz_schaden::auswahl),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}",
            get(routes::einsatz_schaden::detail),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}",
            patch(routes::einsatz_schaden::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/uebergeben",
            post(routes::einsatz_schaden::uebergeben),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/abschliessen",
            post(routes::einsatz_schaden::abschliessen),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}",
            delete(routes::einsatz_schaden::stornieren),
        )
        // Schaden-Anhänge: Modul-Gate `schaeden`; Upload/Download wie die Dokumentenablage.
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/anhaenge",
            get(routes::schaden_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/anhaenge",
            post(routes::schaden_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}",
            delete(routes::schaden_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}/datei",
            get(routes::schaden_anhang::datei).route_layer(download_grenze()),
        )
        // LFH-892: Gerätekopplung, verwaltet von der Einsatzleitung.
        .route(
            "/api/einsaetze/{id}/geraete",
            get(routes::geraet::liste).post(routes::geraet::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/geraete/{gid}/code",
            post(routes::geraet::code_ausstellen),
        )
        .route(
            "/api/einsaetze/{id}/geraete/{gid}/verlaengern",
            post(routes::geraet::verlaengern),
        )
        .route(
            "/api/einsaetze/{id}/geraete/{gid}/widerrufen",
            post(routes::geraet::widerrufen),
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
            "/api/einsaetze/{id}/uhs/{uid}/kraefte",
            post(routes::einsatz_uhs_kraefte::adhoc),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/kraefte/verfuegbar",
            get(routes::einsatz_uhs_kraefte::verfuegbar),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/kraefte/{epid}",
            put(routes::einsatz_uhs_kraefte::zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/kraefte/{epid}",
            delete(routes::einsatz_uhs_kraefte::loesen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/kraefte/einheit/{eid}",
            put(routes::einsatz_uhs_kraefte::einheit_zuordnen),
        )
        // UHS-Anhänge (LFH-758): Modul-Gate `unfallhilfsstellen`; jeder Download im Lese-Audit.
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/anhaenge",
            get(routes::uhs_anhang::liste),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/anhaenge",
            post(routes::uhs_anhang::ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/anhaenge/zugriffe",
            get(routes::uhs_anhang::zugriffe),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/anhaenge/{aid}",
            delete(routes::uhs_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/anhaenge/{aid}/datei",
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
            "/api/einsaetze/{id}/uhs/{uid}/plan/aus-anhang",
            post(routes::uhs_plan::uebernehmen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plan/bild",
            get(routes::uhs_plan::bild).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plaetze",
            post(routes::einsatz_uhs::platz_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plaetze/bulk",
            post(routes::einsatz_uhs::plaetze_bulk_anlegen),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}",
            patch(routes::einsatz_uhs::platz_aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}/verfuegbarkeit",
            post(routes::einsatz_uhs::platz_verfuegbarkeit),
        )
        .route(
            "/api/einsaetze/{id}/uhs/{uid}/plaetze/{pid}",
            delete(routes::einsatz_uhs::platz_stornieren),
        )
        .route(
            "/api/einsaetze/{id}/personen/{pid}/uhs-belegung",
            post(routes::einsatz_uhs::belegung),
        )
        .route(
            "/api/einsaetze/{id}/bereitstellungsraeume",
            get(routes::einsatz_bereitstellungsraum::liste),
        )
        .route(
            "/api/einsaetze/{id}/bereitstellungsraeume",
            post(routes::einsatz_bereitstellungsraum::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/bereitstellungsraeume/{bid}",
            get(routes::einsatz_bereitstellungsraum::detail),
        )
        .route(
            "/api/einsaetze/{id}/bereitstellungsraeume/{bid}",
            patch(routes::einsatz_bereitstellungsraum::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/bereitstellungsraeume/{bid}/status",
            post(routes::einsatz_bereitstellungsraum::status_wechsel),
        )
        .route(
            "/api/einsaetze/{id}/bereitstellungsraeume/{bid}",
            delete(routes::einsatz_bereitstellungsraum::stornieren),
        )
        .route(
            "/api/einsaetze/{id}/bereitstellungsraeume/{bid}/belegung",
            post(routes::einsatz_bereitstellungsraum::belegung),
        )
        .route(
            "/api/einsaetze/{id}/abschnitte",
            get(routes::einsatzabschnitt::liste),
        )
        .route(
            "/api/einsaetze/{id}/abschnitte",
            post(routes::einsatzabschnitt::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/abschnitte/{aid}",
            patch(routes::einsatzabschnitt::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/abschnitte/{aid}/flaeche",
            patch(routes::einsatzabschnitt::flaeche)
                .layer(DefaultBodyLimit::max(GEOMETRIE_BODY_MAX)),
        )
        .route(
            "/api/einsaetze/{id}/abschnitte/{aid}/sprechgruppen/{sg}",
            put(routes::einsatzabschnitt::sprechgruppe_zuordnen)
                .delete(routes::einsatzabschnitt::sprechgruppe_loesen),
        )
        .route(
            "/api/einsaetze/{id}/abschnitte/{aid}",
            delete(routes::einsatzabschnitt::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte",
            get(routes::lagebericht::liste),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte",
            post(routes::lagebericht::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}",
            get(routes::lagebericht::detail),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}",
            patch(routes::lagebericht::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/freigeben",
            post(routes::lagebericht::freigeben),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/fortschreiben",
            post(routes::lagebericht::fortschreiben),
        )
        // LFH-1028: Bild-Anlagen; Upload mit den Grenzen der Anhang-Uploads.
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/anlagen",
            get(routes::lagebericht::anlagen),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/anlagen",
            post(routes::lagebericht::anlage_ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/anlagen/{aid}",
            delete(routes::lagebericht::anlage_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/lageberichte/{lid}/anlagen/{aid}/datei",
            get(routes::lagebericht::anlage_datei).route_layer(download_grenze()),
        )
        .route("/api/einsaetze/{id}/befehle", get(routes::befehl::liste))
        .route("/api/einsaetze/{id}/befehle", post(routes::befehl::anlegen))
        .route(
            "/api/einsaetze/{id}/befehle/{bid}",
            get(routes::befehl::detail),
        )
        .route(
            "/api/einsaetze/{id}/befehle/{bid}",
            patch(routes::befehl::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/befehle/{bid}/freigeben",
            post(routes::befehl::freigeben),
        )
        .route(
            "/api/einsaetze/{id}/befehle/{bid}/fortschreiben",
            post(routes::befehl::fortschreiben),
        )
        // LFH-1028: Bild-Anlagen; Upload mit den Grenzen der Anhang-Uploads.
        .route(
            "/api/einsaetze/{id}/befehle/{bid}/anlagen",
            get(routes::befehl::anlagen),
        )
        .route(
            "/api/einsaetze/{id}/befehle/{bid}/anlagen",
            post(routes::befehl::anlage_ablegen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/befehle/{bid}/anlagen/{aid}",
            delete(routes::befehl::anlage_entfernen),
        )
        .route(
            "/api/einsaetze/{id}/befehle/{bid}/anlagen/{aid}/datei",
            get(routes::befehl::anlage_datei).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/karten-ansichten",
            get(routes::karten_ansicht::liste).post(routes::karten_ansicht::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/karten-ansichten/{aid}",
            patch(routes::karten_ansicht::patch).delete(routes::karten_ansicht::loeschen),
        )
        .route(
            "/api/einsaetze/{id}/lage-snapshots",
            get(routes::lage_snapshot::liste).post(routes::lage_snapshot::erzeugen),
        )
        .route(
            "/api/einsaetze/{id}/lage-snapshots/{sid}",
            get(routes::lage_snapshot::einzeln)
                .patch(routes::lage_snapshot::patch)
                .delete(routes::lage_snapshot::loeschen),
        )
        .route("/api/einsaetze/{id}/zonen", get(routes::lage_zone::liste))
        .route(
            "/api/einsaetze/{id}/zonen",
            post(routes::lage_zone::anlegen).layer(DefaultBodyLimit::max(GEOMETRIE_BODY_MAX)),
        )
        .route(
            "/api/einsaetze/{id}/zonen/{zid}",
            patch(routes::lage_zone::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/zonen/{zid}",
            delete(routes::lage_zone::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/freie-zeichen",
            get(routes::freies_zeichen::liste),
        )
        .route(
            "/api/einsaetze/{id}/freie-zeichen",
            post(routes::freies_zeichen::anlegen),
        )
        .route(
            "/api/einsaetze/{id}/freie-zeichen/{zid}",
            patch(routes::freies_zeichen::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/freie-zeichen/{zid}",
            delete(routes::freies_zeichen::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/karte/hintergrundbilder",
            get(routes::karte_hintergrundbild::liste),
        )
        .route(
            "/api/einsaetze/{id}/karte/hintergrundbilder",
            post(routes::karte_hintergrundbild::hochladen)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_MAX))
                .route_layer(upload_grenze.clone()),
        )
        .route(
            "/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}/download",
            get(routes::karte_hintergrundbild::herunterladen).route_layer(download_grenze()),
        )
        .route(
            "/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}",
            patch(routes::karte_hintergrundbild::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}",
            delete(routes::karte_hintergrundbild::loeschen),
        )
        .route(
            "/api/einsaetze/{id}/gefahrengebiete",
            get(routes::gefahr::gebiete),
        )
        .route(
            "/api/einsaetze/{id}/gefahrengebiete/{gid}",
            patch(routes::gefahr::umbenennen),
        )
        .route(
            "/api/einsaetze/{id}/gefahrengebiete/{gid}/matrix",
            get(routes::gefahr::matrix),
        )
        .route(
            "/api/einsaetze/{id}/gefahrengebiete/{gid}/matrix/bewertung",
            put(routes::gefahr::bewerten),
        )
        // Archiv-Namensraum der Aufbewahrung: nur System-Admin der eigenen Org, nur lesend bis auf
        // Wiederherstellen und Löschersuchen (Antrag, Rücknahme; die Suche ist POST, liest aber
        // nur). Guard in tests/aufbewahrung.rs.
        .route("/api/aufbewahrung", get(routes::aufbewahrung::uebersicht))
        .route(
            "/api/aufbewahrung/einsaetze/{id}",
            get(routes::aufbewahrung::akte),
        )
        .route(
            "/api/aufbewahrung/einsaetze/{id}/etb",
            get(routes::aufbewahrung::etb),
        )
        .route(
            "/api/aufbewahrung/einsaetze/{id}/wiederherstellen",
            post(routes::aufbewahrung::wiederherstellen),
        )
        .route(
            "/api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege",
            get(routes::aufbewahrung::antraege).post(routes::aufbewahrung::antrag_stellen),
        )
        .route(
            "/api/aufbewahrung/einsaetze/{id}/schwaerzungsantraege/{aid}/zuruecknehmen",
            post(routes::aufbewahrung::antrag_zuruecknehmen),
        )
        .route(
            "/api/aufbewahrung/einsaetze/{id}/personensuche",
            post(routes::aufbewahrung::personensuche),
        )
        .route("/api/organisation", get(routes::organisation::lesen))
        .route(
            "/api/organisation",
            patch(routes::organisation::aktualisieren),
        )
        // Logo der Organisation: 1 MiB Nutzlast plus 64 KiB Multipart-Rahmen. Die Größengrenze
        // prüft
        // der Handler (400); das Limit fängt nur Übergrößen ab.
        .route(
            "/api/organisation/logo",
            get(routes::organisation::logo_lesen)
                .post(routes::organisation::logo_hochladen)
                .delete(routes::organisation::logo_entfernen)
                .layer(DefaultBodyLimit::max(1024 * 1024 + 64 * 1024)),
        )
        .route(
            "/api/org-einstellungen",
            get(routes::org_einstellungen::lesen).put(routes::org_einstellungen::setzen),
        )
        .route(
            "/api/fuehrungsfunktionen",
            get(routes::fuehrungsfunktion::katalog),
        )
        .route(
            "/api/org-fuehrungsfunktionen/{funktion}",
            put(routes::fuehrungsfunktion::setzen),
        )
        .route(
            "/api/org-modul-einstellungen",
            get(routes::org_einstellungen::modul_einstellungen_lesen),
        )
        .route(
            "/api/org-modul-einstellungen/{modul_key}",
            put(routes::org_einstellungen::modul_einstellung_setzen),
        )
        .route("/api/stichwort-vorschlaege", get(routes::stichwort::liste))
        .route(
            "/api/stichwort-vorschlaege",
            post(routes::stichwort::anlegen),
        )
        .route(
            "/api/stichwort-vorschlaege/{id}",
            delete(routes::stichwort::loeschen),
        )
        .route("/api/fahrzeuge", get(routes::fahrzeug::liste))
        .route("/api/fahrzeuge", post(routes::fahrzeug::anlegen))
        .route(
            "/api/fahrzeug-vorschlaege",
            get(routes::fahrzeug::vorschlaege),
        )
        .route(
            "/api/fahrzeuge/{id}",
            patch(routes::fahrzeug::aktualisieren),
        )
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
        .route(
            "/api/material-kategorien",
            get(routes::material::kategorien),
        )
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
        .route(
            "/api/fahrzeug-status",
            post(routes::fahrzeug_status::anlegen),
        )
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
        .route(
            "/api/personal-vorschlaege",
            get(routes::personal::vorschlaege),
        )
        .route("/api/personal/{id}", patch(routes::personal::aktualisieren))
        .route(
            "/api/personal/{id}/ausser-dienst",
            post(routes::personal::ausser_dienst),
        )
        .route(
            "/api/personal/{id}/in-dienst",
            post(routes::personal::in_dienst),
        )
        .route("/api/personal-status", get(routes::personal_status::liste))
        .route(
            "/api/personal-status",
            post(routes::personal_status::anlegen),
        )
        .route(
            "/api/personal-status/{id}",
            patch(routes::personal_status::aktualisieren),
        )
        .route(
            "/api/personal-status/{id}/deaktivieren",
            post(routes::personal_status::deaktivieren),
        )
        .route("/api/etb-bausteine", get(routes::etb_baustein::liste))
        .route("/api/etb-bausteine", post(routes::etb_baustein::anlegen))
        .route(
            "/api/etb-bausteine/{id}",
            patch(routes::etb_baustein::aktualisieren),
        )
        .route(
            "/api/etb-bausteine/{id}/deaktivieren",
            post(routes::etb_baustein::deaktivieren),
        )
        .route("/api/qualifikationen", get(routes::qualifikation::liste))
        .route("/api/qualifikationen", post(routes::qualifikation::anlegen))
        .route(
            "/api/qualifikationen/{id}",
            patch(routes::qualifikation::aktualisieren),
        )
        .route(
            "/api/qualifikationen/{id}/deaktivieren",
            post(routes::qualifikation::deaktivieren),
        )
        .route("/api/einheit-typen", get(routes::einheit_typ::liste))
        .route("/api/einheit-typen", post(routes::einheit_typ::anlegen))
        .route(
            "/api/einheit-typen/{id}",
            patch(routes::einheit_typ::aktualisieren),
        )
        .route(
            "/api/einheit-typen/{id}/deaktivieren",
            post(routes::einheit_typ::deaktivieren),
        )
        .route(
            "/api/sprechgruppen",
            get(routes::sprechgruppe::liste_katalog),
        )
        .route("/api/sprechgruppen", post(routes::sprechgruppe::anlegen))
        .route(
            "/api/sprechgruppen/{id}",
            patch(routes::sprechgruppe::aktualisieren),
        )
        .route(
            "/api/sprechgruppen/{id}/deaktivieren",
            post(routes::sprechgruppe::deaktivieren),
        )
        .route(
            "/api/einsaetze/{id}/sprechgruppen",
            get(routes::sprechgruppe::liste_fuer_einsatz),
        )
        .route(
            "/api/einsaetze/{id}/sprechgruppen",
            post(routes::sprechgruppe::anlegen_einsatz_lokal),
        )
        .route(
            "/api/einsaetze/{id}/einheiten",
            get(routes::einsatz_einheit::liste),
        )
        .route(
            "/api/einsaetze/{id}/einheiten",
            post(routes::einsatz_einheit::bilden),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}",
            patch(routes::einsatz_einheit::aktualisieren),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/position",
            patch(routes::einsatz_einheit::position),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/sprechgruppen/{sg}",
            put(routes::einsatz_einheit::sprechgruppe_zuordnen)
                .delete(routes::einsatz_einheit::sprechgruppe_loesen),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/status",
            put(routes::einsatz_einheit::status_setzen),
        )
        // Kräfte-Zeitachse (LFH-552) unter dem Einheiten-Präfix.
        .route(
            "/api/einsaetze/{id}/einheiten/zeitachse",
            get(routes::zeitachse::einheiten_perioden),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/zeitachse",
            get(routes::zeitachse::einheit_laden).post(routes::zeitachse::einheit_nachtragen),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/zeitachse/{zid}/streichen",
            post(routes::zeitachse::einheit_streichen),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}",
            delete(routes::einsatz_einheit::aufloesen),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}",
            put(routes::einsatz_einheit::personal_zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/personal/{ep_id}",
            delete(routes::einsatz_einheit::personal_freigeben),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/fahrzeug/{ef_id}",
            put(routes::einsatz_einheit::fahrzeug_zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/fahrzeug/{ef_id}",
            delete(routes::einsatz_einheit::fahrzeug_freigeben),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}",
            put(routes::einsatz_einheit::material_zuordnen),
        )
        .route(
            "/api/einsaetze/{id}/einheiten/{eid}/material/{em_id}",
            delete(routes::einsatz_einheit::material_freigeben),
        );

    // Dev-only: Endpoint existiert physisch nur mit Feature `dev-seeds`.
    #[cfg(feature = "dev-seeds")]
    let router = router.route("/api/dev/users", get(routes::dev::users));

    // Demo-Daten nur mit `--demo-daten`. Ohne Schalter fällt der Pfad in den `/api/`-404-Fallback
    // — kein 401/403/405, das seine Existenz verriete.
    let router = if opt.demo_daten {
        router
            .route(
                "/api/demo-daten",
                get(routes::demo_daten::status)
                    .post(routes::demo_daten::importieren)
                    .delete(routes::demo_daten::entfernen),
            )
            .route(
                "/api/demo-daten/neu",
                post(routes::demo_daten::neu_importieren),
            )
    } else {
        router
    };

    let router = router
        .route("/api/karte/config", get(routes::karte::config))
        .route(
            "/api/karte/fachebenen/{quelle}",
            get(routes::karte::fachebenen),
        )
        // Offline-Tiles der aktiven Karte über den gecachten read-only-Reader. Kompat-Route (erste
        // sichtbare Region); neue Clients nutzen die region-adressierte Route.
        .route(
            "/api/karte/offline/tiles/{z}/{x}/{y}",
            get(routes::karte::offline_tiles),
        )
        // Eingebettete Welt-Übersicht: der statische „welt“-Pfad steht vor der `{karte_id}`-Route.
        .route(
            "/api/karte/offline/welt/tiles/{z}/{x}/{y}",
            get(routes::karte::offline_welt_tiles),
        )
        // Region-adressierter Tile-Endpoint: je sichtbarer Region eine eigene Vector-Source.
        .route(
            "/api/karte/offline/{karte_id}/tiles/{z}/{x}/{y}",
            get(routes::karte::offline_tiles_region),
        )
        // Eingebettete Offline-Glyphs/Sprite (rust-embed).
        .route(
            "/api/karte/offline/fonts/{fontstack}/{datei}",
            get(routes::karte::offline_fonts),
        )
        .route(
            "/api/karte/offline/sprites/{datei}",
            get(routes::karte::offline_sprite),
        )
        // Style-/Tile-Proxy: verbirgt Upstream-Key und -URL, nur mit Sitzung (LFH-1072), damit
        // Fremde das Anbieter-Kontingent nicht verbrauchen.
        .route(
            "/api/karte/proxy/{id}/style.json",
            get(routes::karte::proxy_style),
        )
        .route(
            "/api/karte/proxy/{id}/raster/{z}/{x}/{y}",
            get(routes::karte::proxy_raster),
        )
        .route(
            "/api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y}",
            get(routes::karte::proxy_tile),
        )
        .route(
            "/api/karte/proxy/{id}/tilejson/{slot}",
            get(routes::karte::proxy_tilejson),
        )
        .route(
            "/api/karte/proxy/{id}/sprite/{rest}",
            get(routes::karte::proxy_sprite),
        )
        .route(
            "/api/karte/proxy/{id}/glyphs/{slot}/{fontstack}/{range}",
            get(routes::karte::proxy_glyphs),
        )
        // Admin-CRUD der Karten-Registry (Online-Quellen + Offline-Karten), hinter AdminUser.
        .route(
            "/api/karte/online-quellen",
            get(routes::karte::online_liste).post(routes::karte::online_anlegen),
        )
        .route(
            "/api/karte/online-quellen/katalog",
            get(routes::karte::online_katalog),
        )
        .route(
            "/api/karte/online-quellen/{id}",
            patch(routes::karte::online_aktualisieren).delete(routes::karte::online_loeschen),
        )
        .route(
            "/api/karte/offline-karten",
            get(routes::karte::offline_liste).post(routes::karte::offline_registrieren),
        )
        // Statische Segmente (katalog/download) vor /{id} — matchit priorisiert statisch.
        .route(
            "/api/karte/offline-karten/katalog",
            get(routes::karte::offline_katalog),
        )
        .route(
            "/api/karte/offline-karten/vorhandene",
            get(routes::karte::offline_vorhandene),
        )
        .route(
            "/api/karte/offline-karten/download",
            post(routes::karte::offline_download),
        )
        .route(
            "/api/karte/offline-karten/bauen",
            post(routes::karte::offline_bauen),
        )
        .route(
            "/api/karte/offline-karten/baubare-regionen",
            get(routes::karte::offline_baubare_regionen),
        )
        .route(
            "/api/karte/offline-karten/bau-status",
            get(routes::karte::offline_bau_status),
        )
        .route(
            "/api/karte/offline-karten/aktualisierung",
            get(routes::karte::offline_aktualisierung_status),
        )
        .route(
            "/api/karte/offline-karten/aktualisierung/einstellung",
            put(routes::karte::offline_aktualisierung_einstellen),
        )
        .route(
            "/api/karte/offline-karten/{id}/jetzt-aktualisieren",
            post(routes::karte::offline_jetzt_aktualisieren),
        )
        .route(
            "/api/karte/offline-karten/{id}/aktivieren",
            post(routes::karte::offline_aktivieren),
        )
        .route(
            "/api/karte/offline-karten/{id}/abbrechen",
            post(routes::karte::offline_abbrechen),
        )
        .route(
            "/api/karte/offline-karten/{id}",
            delete(routes::karte::offline_loeschen),
        );

    let heic_decoder = opt.heic_decoder_verzeichnis.clone().map(Arc::new);
    router
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
        .layer(tower_http::catch_panic::CatchPanicLayer::custom(on_panic))
        // Stammdaten-Kataloge melden schreibende Erfolge an die eigene Org (LFH-734). Außerhalb
        // von CatchPanic: nach einer Handler-Panik sieht sie dessen 500 und meldet nichts.
        // `MatchedPath` ist beim Routing gesetzt.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            routes::live::stammdaten_live,
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
        .with_state(state)
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

/// Kürzt den Pfad für das Log auf höchstens [`PFAD_MAX_ZEICHEN`] Zeichen, an einer Zeichengrenze
/// und mit `…` am Ende.
fn pfad_fuer_protokoll(pfad: &str) -> std::borrow::Cow<'_, str> {
    if pfad.chars().nth(PFAD_MAX_ZEICHEN).is_none() {
        return std::borrow::Cow::Borrowed(pfad);
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
}
