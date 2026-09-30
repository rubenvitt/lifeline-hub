use crate::karte::FachebenenState;
use crate::live::LiveHub;
use crate::routes;
use axum::{
    extract::DefaultBodyLimit,
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Router,
};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tower::limit::ConcurrencyLimitLayer;

/// Begrenzt die gleichzeitig laufenden Voll-BLOB-Reads der Asset-Downloads (bis 25 MiB je
/// Anhang → RAM-Druck). Nur auf den Download-Routen, nicht routerweit — ein globaler Limiter
/// hungerte die langlebigen SSE-Streams aus.
const MAX_GLEICHZEITIGE_ASSET_DOWNLOADS: usize = 16;

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
}

/// Schalter, die nur das Routing betreffen (LFH-690).
///
/// Nicht im `AppState`, weil ein Feld dort jede Test-Konstruktion bräche und kein Handler den
/// Wert braucht. Kein prozessweiter `OnceLock`, weil der „aus“ und „an“ nicht im selben
/// Test-Binary prüfen ließe.
#[derive(Debug, Clone, Copy, Default)]
pub struct RouterOptionen {
    /// Registriert die Routen unter `/api/demo-daten` (`--demo-daten`). Ohne den Schalter
    /// antworten sie wie jeder unbekannte `/api/`-Pfad mit 404, auch angemeldet.
    pub demo_daten: bool,
}

/// Baut den Axum-Router mit allen Routen und dem geteilten Zustand, mit Vorgabe-Optionen (ohne
/// die bedingten Routen); s. [`build_router_mit`].
pub fn build_router(state: AppState) -> Router {
    build_router_mit(state, RouterOptionen::default())
}

/// Wie [`build_router`], mit ausdrücklichen [`RouterOptionen`].
pub fn build_router_mit(state: AppState, opt: RouterOptionen) -> Router {
    let router = Router::new()
        .route("/api/health", get(routes::health::health))
        .route("/api/backup", get(routes::backup::download))
        .route("/api/auth/login", post(routes::auth::login))
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
            post(routes::auth::app_code_einloesen),
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
            post(routes::auth::webauthn_auth_start),
        )
        .route(
            "/api/auth/webauthn/auth/finish",
            post(routes::auth::webauthn_auth_finish),
        )
        .route(
            "/api/auth/webauthn/discoverable/start",
            post(routes::auth::webauthn_discoverable_start),
        )
        .route(
            "/api/auth/webauthn/discoverable/finish",
            post(routes::auth::webauthn_discoverable_finish),
        )
        .route(
            "/api/auth/totp/enroll/start",
            post(routes::auth::totp_enroll_start),
        )
        .route(
            "/api/auth/totp/enroll/finish",
            post(routes::auth::totp_enroll_finish),
        )
        .route("/api/auth/totp/finish", post(routes::auth::totp_finish))
        .route("/api/auth/passwort", post(routes::auth::passwort_aendern))
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
            "/api/einsaetze/{id}/aufbewahrungsfrist",
            put(routes::einsatz::aufbewahrungsfrist_setzen),
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
        // Modulzähler: modul-lose Gate-Route wie `/live`, die Modulrechte filtern die Felder.
        .route(
            "/api/einsaetze/{id}/modul-zaehler",
            get(routes::modul_zaehler::liste),
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
        // ETB-Anhänge: Upload mit Body-Limit (die Vorgabe von 2 MiB kappte still), Download mit dem
        // Asset-Concurrency-Cap.
        .route(
            "/api/einsaetze/{id}/etb/anhaenge",
            post(routes::etb::anhang_hochladen).layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .route(
            "/api/einsaetze/{id}/etb/{eintrag_id}/anhaenge/{aid}",
            get(routes::etb::anhang_herunterladen).layer(ConcurrencyLimitLayer::new(
                MAX_GLEICHZEITIGE_ASSET_DOWNLOADS,
            )),
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
            post(routes::anhang::hochladen).layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .route(
            "/api/einsaetze/{id}/anhaenge/{aid}",
            get(routes::anhang::herunterladen)
                .delete(routes::anhang::loeschen)
                .layer(ConcurrencyLimitLayer::new(
                    MAX_GLEICHZEITIGE_ASSET_DOWNLOADS,
                )),
        )
        // Dokumentenablage: eigener Präfix mit Modul-Gate; Upload/Download wie Anhänge.
        .route(
            "/api/einsaetze/{id}/dokumente",
            get(routes::dokument::liste)
                .post(routes::dokument::ablegen)
                .layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .route(
            "/api/einsaetze/{id}/dokumente/{did}",
            delete(routes::dokument::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/dokumente/{did}/datei",
            get(routes::dokument::datei).layer(ConcurrencyLimitLayer::new(
                MAX_GLEICHZEITIGE_ASSET_DOWNLOADS,
            )),
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
            "/api/einsaetze/{id}/stab/medienkontakte/{kid}",
            patch(routes::presse::medienkontakt_aendern),
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
        .route("/api/einsaetze/{id}/meldungen", get(routes::meldung::liste))
        .route(
            "/api/einsaetze/{id}/meldungen/rueckmeldungen",
            get(routes::meldung::rueckmeldungen),
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
            "/api/einsaetze/{id}/personen/export",
            get(routes::einsatz_person::export),
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
        .route(
            "/api/einsaetze/{id}/schaeden",
            get(routes::einsatz_schaden::liste),
        )
        .route(
            "/api/einsaetze/{id}/schaeden",
            post(routes::einsatz_schaden::anlegen),
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
            get(routes::schaden_anhang::liste)
                .post(routes::schaden_anhang::ablegen)
                .layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}",
            delete(routes::schaden_anhang::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/schaeden/{sid}/anhaenge/{aid}/datei",
            get(routes::schaden_anhang::datei).layer(ConcurrencyLimitLayer::new(
                MAX_GLEICHZEITIGE_ASSET_DOWNLOADS,
            )),
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
            patch(routes::einsatzabschnitt::flaeche),
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
            post(routes::lage_zone::anlegen),
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
                .layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .route(
            "/api/einsaetze/{id}/karte/hintergrundbilder/{bildId}/download",
            get(routes::karte_hintergrundbild::herunterladen).layer(ConcurrencyLimitLayer::new(
                MAX_GLEICHZEITIGE_ASSET_DOWNLOADS,
            )),
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
        // das
        // Wiederherstellen (Guard in tests/aufbewahrung.rs).
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
        // Style-/Tile-Proxy (öffentlich): verbirgt Upstream-Key und -URL.
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
            "/api/karte/offline-karten/{id}/aktivieren",
            post(routes::karte::offline_aktivieren),
        )
        .route(
            "/api/karte/offline-karten/{id}/neu-laden",
            post(routes::karte::offline_neu_laden),
        )
        .route(
            "/api/karte/offline-karten/{id}/abbrechen",
            post(routes::karte::offline_abbrechen),
        )
        .route(
            "/api/karte/offline-karten/{id}",
            delete(routes::karte::offline_loeschen),
        );

    router
        .fallback(crate::static_files::serve)
        // Axums Default-405 hat einen leeren Body und bräche den `{error}`-Vertrag. Der Fallback
        // greift
        // nur, wenn der Pfad existiert, die Methode aber nicht.
        .method_not_allowed_fallback(methode_nicht_erlaubt)
        // Fängt eine Handler-Panik und antwortet mit 500 + `{error}`, statt die Verbindung
        // abzureißen
        // (das hielte das Frontend für „kein Netz“).
        .layer(tower_http::catch_panic::CatchPanicLayer::custom(on_panic))
        // Zulassungssteuerung: Zeitbudget und Gleichzeitigkeits-Cap mit Lastabwurf. Muss AUSSERHALB
        // des `CatchPanicLayer` liegen, damit sie dessen 500-Antwort bekommt statt eines Unwinds.
        // `MatchedPath` ist beim Routing gesetzt, die Ausnahmeliste greift also trotzdem.
        .layer(axum::middleware::from_fn_with_state(
            crate::zulassung::Zulassung::default(),
            crate::zulassung::zulassung,
        ))
        // Request-Instrumentierung. `.layer()` hängt nach außen, der Trace-Layer liegt also
        // außerhalb
        // von CatchPanic UND Zulassung und sieht Panik-500er wie Lastabwürfe. Jeder Handler läuft
        // in
        // diesem Span, deshalb tragen die `tracing::error!`-Zeilen Methode, Pfad und Request-ID.
        .layer(tower_http::trace::TraceLayer::new_for_http().make_span_with(MakeSpanMitRequestId))
        // Request-ID ganz außen setzen, damit sie im Span schon steht, und in die Antwort spiegeln
        // — so
        // kann ein Nutzer sie aus dem Fehlerfall melden.
        .layer(tower_http::request_id::PropagateRequestIdLayer::x_request_id())
        .layer(tower_http::request_id::SetRequestIdLayer::x_request_id(
            tower_http::request_id::MakeRequestUuid,
        ))
        .with_state(state)
}

/// Baut den `tracing`-Span jedes HTTP-Requests. Eigene Implementierung, weil `DefaultMakeSpan`
/// die Request-ID nicht kennt.
#[derive(Clone, Copy)]
struct MakeSpanMitRequestId;

impl<B> tower_http::trace::MakeSpan<B> for MakeSpanMitRequestId {
    fn make_span(&mut self, request: &axum::http::Request<B>) -> tracing::Span {
        let request_id = request
            .headers()
            .get("x-request-id")
            .and_then(|wert| wert.to_str().ok())
            .unwrap_or("-");
        tracing::info_span!(
            "http",
            methode = %request.method(),
            pfad = %request.uri().path(),
            request_id = %request_id,
        )
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
