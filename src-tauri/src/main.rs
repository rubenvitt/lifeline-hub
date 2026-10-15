//! Desktop-Hülle von Lifeline Hub (LFH-721, Variante A aus LFH-720): der Webview lädt die
//! https-Adresse des Einsatzservers. Die Hülle bringt Fenster, Erststart, Deeplink, Druck,
//! Update — keine zweite Anwendungslogik. Anforderungen: `openspec/specs/desktop-huelle/` und
//! `openspec/specs/desktop-auslieferung/`; Entscheidungen im Design des Changes LFH-721.
//!
//! RECHTE: Die lokale Erststart-Maske darf die Adresse setzen (Capability `lokal`), die lokale
//! Anzeige „nicht erreichbar“ nur prüfen, neu laden und zur Maske führen (`nicht-erreichbar`). Die
//! Serverseite bekommt zur Laufzeit genau für ihre Origin nur `drucken`,
//! `anmeldung_im_browser` (LFH-818) und `benachrichtigung_zeigen` (D7 des
//! Benachrichtigungskonzepts) — sie kann die Hülle nicht auf einen anderen Server umlenken.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adresse;
mod anmeldung;
#[cfg(target_os = "macos")]
mod aswas;
mod deeplink;
mod erreichbar;
mod kanal;
mod links;
mod menue;
mod pkce;
mod update;
mod verbindung;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::{ActionPerformed, NotificationExt};

use crate::adresse::pruefe_adresse;
use crate::deeplink::{deute, entscheide, Aktion};
use crate::erreichbar::Grund;
use crate::links::Ziel;

const FENSTER: &str = "main";

/// Kennungen weiterer Fenster: `neben-1`, `neben-2`, … (LFH-782). Die Laufzeit-Freigabe nimmt
/// sie über das Muster `neben-*` mit, die Maske (`capabilities/lokal.json`) nicht.
const NEBENFENSTER_PRAEFIX: &str = "neben-";

fn nebenfenster_label(nummer: u32) -> String {
    format!("{NEBENFENSTER_PRAEFIX}{nummer}")
}

/// Fenster, in denen die Serverseite `drucken` aufrufen darf.
fn freigabe_fenster() -> [String; 2] {
    [FENSTER.to_string(), format!("{NEBENFENSTER_PRAEFIX}*")]
}

/// Adresse der lokalen Maske im Webview. Tauri liefert eigene Seiten je Plattform unter einer
/// anderen Origin aus (WebView2 kennt kein eigenes Schema).
#[cfg(windows)]
const MASKE: &str = "http://tauri.localhost/index.html";
#[cfg(not(windows))]
const MASKE: &str = "tauri://localhost/index.html";

/// Lokale Anzeige „nicht erreichbar“ (LLH-1283), in jedem Fenster möglich.
#[cfg(windows)]
const NICHT_ERREICHBAR: &str = "http://tauri.localhost/nicht-erreichbar.html";
#[cfg(not(windows))]
const NICHT_ERREICHBAR: &str = "tauri://localhost/nicht-erreichbar.html";

/// `window.print()` erreicht in WKWebView keinen Dialog (LFH-720, Befund 17) — auf macOS
/// leitet die Hülle den Aufruf auf den nativen Druck um.
#[cfg(target_os = "macos")]
const DRUCK_SKRIPT: &str = include_str!("druck.js");

/// Native Meldung über den Command `benachrichtigung_zeigen` (D7 des Benachrichtigungskonzepts):
/// in jeder Hülle, denn das Notification-Plugin ersetzt die Web-Notification-API jeder Seite.
const BENACHRICHTIGUNG_SKRIPT: &str = include_str!("benachrichtigung.js");

/// Im WKWebView scheitert jeder Passkey, obwohl die Feature-Erkennung ihn meldet (LFH-783) — die
/// macOS-Hülle sagt der Seite selbst, dass sie keinen ausführen kann (LFH-817).
#[cfg(target_os = "macos")]
const FAEHIGKEITEN_SKRIPT: &str = include_str!("faehigkeiten.js");

/// Was die Maske beim Öffnen zeigt.
#[derive(Clone, Default, Serialize)]
struct Vorbelegung {
    /// Vorbelegte Adresse: aus einem Deeplink oder die gespeicherte beim Wechsel.
    adresse: Option<String>,
    /// Es gibt eine gespeicherte Adresse, zu der „Abbrechen“ zurückführt.
    abbrechbar: bool,
    /// Die zuletzt verbundenen Server zur Auswahl (LLH-1282), der verbundene zuerst.
    bekannt: Vec<BekannterServer>,
}

#[derive(Clone, Serialize)]
struct BekannterServer {
    adresse: String,
    host: String,
    /// Der verbundene Server: ihn kann die Maske nicht vergessen.
    verbunden: bool,
}

fn bekannte_server(app: &AppHandle) -> Vec<BekannterServer> {
    let dir = konfig_dir(app);
    let verbunden = verbindung::lesen(&dir);
    verbindung::bekannte(&dir)
        .into_iter()
        .map(|url| BekannterServer {
            host: url.host_str().unwrap_or_default().to_string(),
            verbunden: verbunden.as_ref() == Some(&url),
            adresse: url.into(),
        })
        .collect()
}

/// Eine laufende Wache über das Laden des Servers in einem Fenster (LLH-1283).
struct Watch {
    nummer: u32,
}

/// Ein Fenster zeigt die Anzeige „nicht erreichbar“: was es laden wollte und warum es nicht kam.
#[derive(Clone)]
struct Ausfall {
    ziel: Url,
    grund: Grund,
}

#[derive(Default)]
struct Zustand {
    vorbelegung: Mutex<Vorbelegung>,
    /// Origins, deren Freigabe schon gesetzt ist. Tauri kennt kein Zurücknehmen einer
    /// Laufzeit-Capability: nach einem Serverwechsel behält die alte Origin bis zum Neustart
    /// `drucken` — mehr nicht, die Adresse ändern kann auch sie nicht.
    freigegeben: Mutex<HashSet<String>>,
    /// Zähler für die Kennung des nächsten Nebenfensters.
    nebenfenster: AtomicU32,
    /// Der laufende Vorgang „Im Browser anmelden“ (LFH-818); ein neuer ersetzt ihn.
    anmeldung: Mutex<Option<Ausstehend>>,
    /// Zähler der Vorgänge, damit der Handler einer ersetzten Sitzung nichts mehr bewirkt.
    anmeldungen: AtomicU32,
    /// Je Fenster die Wache über das letzte Laden des Servers (LLH-1283); fort, sobald eine Seite
    /// ankommt.
    watches: Mutex<HashMap<String, Watch>>,
    watch_nummer: AtomicU32,
    /// Je Fenster, das die Anzeige „nicht erreichbar“ zeigt, Ziel und Grund.
    ausfaelle: Mutex<HashMap<String, Ausfall>>,
    /// Zuletzt gezeigte native Meldungen: mehrere Fenster desselben Einsatzes melden dasselbe
    /// Ereignis je einmal (LLH-1281).
    meldungen: Mutex<Vec<(String, Instant)>>,
}

/// Ein gestarteter Vorgang „Im Browser anmelden“. Der `verifier` verlässt die Hülle nur im
/// Einlöse-Skript, und das nur an die Seite des Servers, gegen den gestartet wurde.
struct Ausstehend {
    nummer: u32,
    verifier: String,
    fenster: String,
    server: Url,
}

fn konfig_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("Konfigurationsverzeichnis der Hülle")
}

fn fenster(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(FENSTER)
}

/// Das Fenster, das vorn ist; sonst das Hauptfenster, sonst irgendeines (LLH-1281: die Fenster
/// sind gleichrangig, das Hauptfenster kann schon geschlossen sein).
fn front_fenster(app: &AppHandle) -> Option<WebviewWindow> {
    let alle = app.webview_windows();
    alle.values()
        .find(|fenster| fenster.is_focused().unwrap_or(false))
        .or_else(|| alle.get(FENSTER))
        .or_else(|| alle.values().next())
        .cloned()
}

/// Kennung und URL-Muster der Laufzeit-Freigabe für die Origin von `server`.
fn freigabe(server: &Url) -> (String, String) {
    let origin = server.origin().ascii_serialization();
    let kennung = format!(
        "server-{}",
        origin.replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );
    (kennung, format!("{origin}/*"))
}

/// Was die Serverseite aufrufen darf: den Druck, „Im Browser anmelden“ (LFH-818) und die native
/// Meldung (D7 des Benachrichtigungskonzepts). Die Commands des Notification-Plugins nicht.
const SERVER_RECHTE: [&str; 3] = [
    "allow-drucken",
    "allow-anmeldung-im-browser",
    "allow-benachrichtigung-zeigen",
];

/// Gibt der Serverseite zur Laufzeit genau ihre Origin frei — und dort nur [`SERVER_RECHTE`].
fn server_freigeben(app: &AppHandle, server: &Url) {
    let (kennung, muster) = freigabe(server);
    if !app
        .state::<Zustand>()
        .freigegeben
        .lock()
        .unwrap()
        .insert(kennung.clone())
    {
        return;
    }
    let capability = SERVER_RECHTE.iter().fold(
        tauri::ipc::CapabilityBuilder::new(kennung)
            .remote(muster.clone())
            .windows(freigabe_fenster()),
        |capability, recht| capability.permission(*recht),
    );
    if let Err(fehler) = app.add_capability(capability) {
        // Ohne Freigabe fehlen nur Druck und Meldung der Hülle; die Anwendung selbst läuft.
        log::warn!("Freigabe für {muster} nicht gesetzt: {fehler}");
    }
}

/// Was ins Protokoll darf: Origin und Pfad, nie die Query — die trägt Freitext (ETB-Suche `?q=`,
/// Namen Betroffener), und die Protokolldatei bleibt liegen. Ohne Host (`mailto:`, `tel:`,
/// `data:`, `javascript:`) nur das Schema: dort IST der Pfad die Adresse bzw. der Inhalt.
fn fuers_protokoll(url: &Url) -> String {
    match (url.scheme(), url.host_str()) {
        ("http" | "https", _) => format!("{}{}", url.origin().ascii_serialization(), url.path()),
        (schema, Some(host)) => format!("{schema}://{host}{}", url.path()),
        (schema, None) => format!("{schema}:"),
    }
}

fn lade_server(app: &AppHandle, server: &Url) -> Result<(), String> {
    // Nebenfenster eines anderen Servers gehören nach dem Wechsel zu keinem mehr. Beim Abbrechen
    // oder Verbinden mit derselben Adresse bleiben sie — `close()` fragt nicht nach, ein offener
    // Entwurf verlöre sonst, was der Autosave noch nicht hat. Ein Nebenfenster mit der Anzeige
    // „nicht erreichbar“ zählt mit dem Server, den es laden wollte.
    for (label, nebenfenster) in app.webview_windows() {
        let ausgefallen = app
            .state::<Zustand>()
            .ausfaelle
            .lock()
            .unwrap()
            .get(&label)
            .map(|ausfall| ausfall.ziel.clone());
        let bleibt = ausgefallen
            .or_else(|| nebenfenster.url().ok())
            .is_some_and(|seite| links::gehoert_zum_server(server, &seite));
        if label.starts_with(NEBENFENSTER_PRAEFIX) && !bleibt {
            let _ = nebenfenster.close();
        }
    }
    server_freigeben(app, server);
    match fenster(app) {
        Some(fenster) => load_in_fenster(app, &fenster, server.clone()),
        // Das Hauptfenster ist zu (LLH-1281), etwa bei einem Deeplink: neu bauen.
        None => {
            // Die Wache vor dem Bau: eine Seite aus dem Service Worker kann ankommen, bevor
            // `build()` zurückkehrt.
            start_watch(app, FENSTER, server.clone());
            baue_fenster(app, FENSTER, WebviewUrl::External(server.clone()), None)
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

/// Lädt `ziel` im Fenster und wacht darüber, dass eine Seite ankommt (LLH-1283).
fn load_in_fenster(app: &AppHandle, fenster: &WebviewWindow, ziel: Url) -> Result<(), String> {
    start_watch(app, fenster.label(), ziel.clone());
    fenster.navigate(ziel).map_err(|e| e.to_string())
}

/// Öffnet die Erststart-Maske, vorbelegt mit `adresse` (sonst mit der gespeicherten). Sie läuft
/// immer im Hauptfenster (Capability `lokal`); ist es zu, entsteht es neu.
pub(crate) fn zeige_maske(app: &AppHandle, adresse: Option<Url>) {
    let gespeichert = verbindung::lesen(&konfig_dir(app));
    let vorbelegung = Vorbelegung {
        adresse: adresse.or_else(|| gespeichert.clone()).map(String::from),
        abbrechbar: gespeichert.is_some(),
        bekannt: bekannte_server(app),
    };
    *app.state::<Zustand>().vorbelegung.lock().unwrap() = vorbelegung;
    // Die Maske beendet jede Wache des Hauptfensters: sie ist selbst die Anzeige.
    app.state::<Zustand>()
        .watches
        .lock()
        .unwrap()
        .remove(FENSTER);
    app.state::<Zustand>()
        .ausfaelle
        .lock()
        .unwrap()
        .remove(FENSTER);
    let fenster = match fenster(app) {
        Some(fenster) => {
            let _ = fenster.navigate(MASKE.parse().expect("Adresse der Maske"));
            fenster
        }
        None => match baue_fenster(app, FENSTER, WebviewUrl::App("index.html".into()), None) {
            Ok(fenster) => fenster,
            Err(fehler) => {
                log::error!("Hauptfenster für die Maske nicht gebaut: {fehler}");
                return;
            }
        },
    };
    nach_vorn(&fenster);
}

// ── Erreichbarkeit (LLH-1283) ────────────────────────────────────────────────────────

/// Wacht über das Laden von `ziel` im Fenster `label`: kommt keine Seite an, zeigt das Fenster
/// die Anzeige „nicht erreichbar“. Eine neuere Wache desselben Fensters ersetzt diese.
fn start_watch(app: &AppHandle, label: &str, ziel: Url) {
    let zustand = app.state::<Zustand>();
    let nummer = zustand.watch_nummer.fetch_add(1, Ordering::Relaxed) + 1;
    zustand
        .watches
        .lock()
        .unwrap()
        .insert(label.to_string(), Watch { nummer });
    let (app, label) = (app.clone(), label.to_string());
    std::thread::spawn(move || {
        let grund = erreichbar::grund(erreichbar::check_erreichbar(
            &ziel,
            erreichbar::CHECK_TIMEOUT,
        ));
        std::thread::sleep(erreichbar::deadline(grund));
        let offen = {
            let zustand = app.state::<Zustand>();
            let mut watches = zustand.watches.lock().unwrap();
            let offen = watches.get(&label).is_some_and(|w| w.nummer == nummer);
            if offen {
                watches.remove(&label);
            }
            offen
        };
        if offen {
            show_nicht_erreichbar(&app, &label, ziel, grund);
        }
    });
}

/// Eine Seite kommt im Fenster an: die Wache ist erledigt, eine Anzeige vorbei.
fn seite_angekommen(app: &AppHandle, label: &str, seite: &Url) {
    if !erreichbar::is_loaded(seite) {
        return;
    }
    let zustand = app.state::<Zustand>();
    zustand.watches.lock().unwrap().remove(label);
    zustand.ausfaelle.lock().unwrap().remove(label);
}

fn show_nicht_erreichbar(app: &AppHandle, label: &str, ziel: Url, grund: Grund) {
    let Some(fenster) = app.get_webview_window(label) else {
        return;
    };
    log::warn!(
        "Server nicht erreichbar ({grund:?}): {}",
        fuers_protokoll(&ziel)
    );
    app.state::<Zustand>()
        .ausfaelle
        .lock()
        .unwrap()
        .insert(label.to_string(), Ausfall { ziel, grund });
    let _ = fenster.navigate(NICHT_ERREICHBAR.parse().expect("Adresse der Anzeige"));
}

// ── Fenster und Links ────────────────────────────────────────────────────────────────

/// Lage eines neuen Fensters: versetzt zum Fenster, das vorn ist, in dessen Größe (LLH-1281).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Platz {
    position: LogicalPosition<f64>,
    groesse: LogicalSize<f64>,
}

/// So weit rückt ein neues Fenster gegenüber dem vorderen nach rechts unten.
const VERSATZ: f64 = 30.0;

fn platz_neben(position: LogicalPosition<f64>, groesse: LogicalSize<f64>) -> Platz {
    Platz {
        position: LogicalPosition::new(position.x + VERSATZ, position.y + VERSATZ),
        groesse,
    }
}

fn platz_neben_front(app: &AppHandle) -> Option<Platz> {
    let vorn = front_fenster(app)?;
    let faktor = vorn.scale_factor().ok()?;
    let position = vorn.outer_position().ok()?.to_logical(faktor);
    let groesse = vorn.inner_size().ok()?.to_logical(faktor);
    Some(platz_neben(position, groesse))
}

/// Baut ein Fenster der Hülle — das Hauptfenster wie jedes Nebenfenster, damit Link-Behandlung,
/// Drosselung und Druckweg überall gleich sind.
fn baue_fenster(
    app: &AppHandle,
    label: &str,
    start: WebviewUrl,
    platz: Option<Platz>,
) -> tauri::Result<WebviewWindow> {
    let (fuer_fenster, fuer_navigation) = (app.clone(), app.clone());
    let (label_fenster, label_navigation) = (label.to_string(), label.to_string());
    let builder = WebviewWindowBuilder::new(app, label, start)
        .title("Lifeline Hub")
        .min_inner_size(800.0, 560.0)
        .on_page_load(|fenster, seite| {
            // Jede nicht-lokale Seite beendet die Wache (LLH-1283): auch eine aus dem Service
            // Worker, auch die eines Identitätsanbieters.
            seite_angekommen(fenster.app_handle(), fenster.label(), seite.url());
            // Im Protokoll steht, welche Seite geladen wurde — beim Support die erste Frage
            // („Maske oder Server? Welcher?“).
            if matches!(seite.event(), tauri::webview::PageLoadEvent::Finished) {
                log::info!("Seite geladen: {}", fuers_protokoll(seite.url()));
            }
        })
        // Downloads: Vorgabeverhalten beider Webviews — Download-Ordner, Umlaute
        // erhalten, Dubletten mit Zählzusatz (gemessen in LFH-720, Befund 14). Auch der
        // `blob:`-Export der Seite kommt hier an, am Navigations-Handler vorbei (`links.rs`).
        .on_download(|_fenster, ereignis| {
            if let DownloadEvent::Finished { url, success, .. } = ereignis {
                log::info!(
                    "Download {}: {}",
                    fuers_protokoll(&url),
                    if success { "fertig" } else { "gescheitert" }
                );
            }
            true
        })
        // `window.open` und `target="_blank"` liefen sonst ins Leere (LFH-720). `Create` scheidet
        // aus: es verlangt auf macOS die Webview-Konfiguration des Aufrufers — die Hülle baut
        // ihr Nebenfenster selbst und verweigert das angeforderte.
        .on_new_window(move |ziel, _merkmale| {
            neues_fenster(&fuer_fenster, &label_fenster, ziel);
            NewWindowResponse::Deny
        })
        .on_navigation(move |ziel| navigation(&fuer_navigation, &label_navigation, ziel))
        // Vor `faehigkeiten.js`: beide ergänzen dieselbe Kennung `__LIFELINE_HUELLE__`.
        .initialization_script(BENACHRICHTIGUNG_SKRIPT);
    let builder = match platz {
        Some(platz) => builder
            .inner_size(platz.groesse.width, platz.groesse.height)
            .position(platz.position.x, platz.position.y),
        None => builder.inner_size(1366.0, 860.0),
    };
    #[cfg(target_os = "macos")]
    let builder = builder
        // WKWebView suspendiert ein verdecktes Fenster nach ~3 s, Live-Ereignisse
        // stauen sich dann minutenlang (LFH-720, Befund 7).
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .initialization_script(DRUCK_SKRIPT)
        .initialization_script(FAEHIGKEITEN_SKRIPT);
    builder.build()
}

/// Der verbundene Server — bei jedem Aufruf frisch, er wechselt zur Laufzeit.
fn verbundener_server(app: &AppHandle) -> Option<Url> {
    verbindung::lesen(&konfig_dir(app))
}

/// Baut ein Nebenfenster mit `ziel`, versetzt zum vorderen, und wacht über sein Laden. Nicht
/// in einem Ereignis des Webviews selbst aufrufen: ein synchroner Fensterbau darin blockiert
/// unter Windows.
fn open_nebenfenster(app: &AppHandle, ziel: Url) {
    let nummer = app
        .state::<Zustand>()
        .nebenfenster
        .fetch_add(1, Ordering::Relaxed)
        + 1;
    let label = nebenfenster_label(nummer);
    let platz = platz_neben_front(app);
    // Die Wache vor dem Bau, wie in `lade_server`.
    start_watch(app, &label, ziel.clone());
    match baue_fenster(app, &label, WebviewUrl::External(ziel), platz) {
        Ok(fenster) => {
            let _ = fenster.set_focus();
        }
        Err(fehler) => log::error!("Nebenfenster {label} nicht gebaut: {fehler}"),
    }
}

/// Was ein neues Fenster aus dem Menü zeigt (LLH-1281): die Seite des vorderen Fensters, wenn sie
/// zum Server gehört — ein zweiter Bildschirm beginnt dort, wo man ist —, sonst die Startseite.
fn ziel_neues_fenster(server: &Url, vorn: Option<&Url>) -> Url {
    vorn.filter(|seite| links::gehoert_zum_server(server, seite))
        .cloned()
        .unwrap_or_else(|| server.clone())
}

/// Menü „Neues Fenster“ (LLH-1281). Ohne verbundenen Server gibt es nichts zu öffnen: dann die
/// Maske.
pub(crate) fn neues_fenster_aus_menue(app: &AppHandle) {
    let Some(server) = verbundener_server(app) else {
        zeige_maske(app, None);
        return;
    };
    let vorn = front_fenster(app).and_then(|fenster| {
        // Eine Anzeige „nicht erreichbar“ meint das Ziel, das sie laden wollte.
        let ausfall = app
            .state::<Zustand>()
            .ausfaelle
            .lock()
            .unwrap()
            .get(fenster.label())
            .map(|ausfall| ausfall.ziel.clone());
        ausfall.or_else(|| fenster.url().ok())
    });
    let ziel = ziel_neues_fenster(&server, vorn.as_ref());
    let app = app.clone();
    tauri::async_runtime::spawn(async move { open_nebenfenster(&app, ziel) });
}

fn neues_fenster(app: &AppHandle, label: &str, ziel: Url) {
    match links::entscheide_neues_fenster(verbundener_server(app).as_ref(), &ziel) {
        Ziel::Nebenfenster => {
            // Nicht im Handler selbst bauen: der läuft im Ereignis des Webviews, und ein
            // synchroner Fensterbau darin blockiert unter Windows.
            let app = app.clone();
            tauri::async_runtime::spawn(async move { open_nebenfenster(&app, ziel) });
        }
        Ziel::Download => herunterladen(app, label, &ziel),
        Ziel::System => im_system_oeffnen(&ziel),
        Ziel::Huelle | Ziel::Verwerfen => {
            log::info!("Neues Fenster verworfen: {}", fuers_protokoll(&ziel));
        }
    }
}

fn navigation(app: &AppHandle, label: &str, ziel: &Url) -> bool {
    match links::entscheide_navigation(verbundener_server(app).as_ref(), ziel) {
        Ziel::Huelle => true,
        Ziel::Download => {
            herunterladen(app, label, ziel);
            false
        }
        Ziel::System => {
            im_system_oeffnen(ziel);
            false
        }
        Ziel::Nebenfenster | Ziel::Verwerfen => {
            log::info!("Navigation verworfen: {}", fuers_protokoll(ziel));
            false
        }
    }
}

/// Skript, das `ziel` als Download anstößt: ein Anker mit `download` geht in WKWebView und
/// WebView2 direkt an den Download, am Navigations-Handler vorbei — keine Schleife. Leeres
/// `download`, damit der Dateiname aus `Content-Disposition` gilt. Die URL geht als JSON-Literal
/// hinein, nie als Textbaustein.
fn download_skript(ziel: &Url) -> String {
    let literal = serde_json::to_string(ziel.as_str()).expect("URL als JSON-Text");
    format!(
        "(() => {{ const a = document.createElement('a'); a.href = {literal}; a.download = ''; \
         document.body.appendChild(a); a.click(); a.remove(); }})();"
    )
}

/// Lädt `ziel` im Fenster `label` herunter, statt die Anwendung durch die Datei zu ersetzen.
fn herunterladen(app: &AppHandle, label: &str, ziel: &Url) {
    let Some(fenster) = app.get_webview_window(label) else {
        return;
    };
    if let Err(fehler) = fenster.eval(download_skript(ziel)) {
        log::warn!(
            "Download {} nicht angestoßen: {fehler}",
            fuers_protokoll(ziel)
        );
    }
}

/// Fremde Seite im Standardbrowser, `mailto:`/`tel:` im zuständigen Programm.
fn im_system_oeffnen(ziel: &Url) {
    match tauri_plugin_opener::open_url(ziel.as_str(), None::<&str>) {
        Ok(()) => log::info!("An das System übergeben: {}", fuers_protokoll(ziel)),
        Err(fehler) => log::warn!("{} nicht geöffnet: {fehler}", fuers_protokoll(ziel)),
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────────────

/// Nur Maske: was sie beim Öffnen zeigen soll.
#[tauri::command]
fn vorbelegung(zustand: tauri::State<'_, Zustand>) -> Vorbelegung {
    zustand.vorbelegung.lock().unwrap().clone()
}

/// Nur Maske: Adresse prüfen, speichern, laden. Die Meldung eines Fehlers zeigt die Maske.
#[tauri::command]
fn verbinden(app: AppHandle, adresse: String) -> Result<(), String> {
    let server = pruefe_adresse(&adresse).map_err(|fehler| fehler.to_string())?;
    verbindung::schreiben(&konfig_dir(&app), &server)
        .map_err(|fehler| format!("Die Adresse ließ sich nicht speichern: {fehler}"))?;
    lade_server(&app, &server)
}

/// Nur Maske: Wechsel abbrechen, die gespeicherte Adresse wieder laden.
#[tauri::command]
fn abbrechen(app: AppHandle) -> Result<(), String> {
    let server = verbindung::lesen(&konfig_dir(&app)).ok_or("Es ist keine Adresse gespeichert.")?;
    lade_server(&app, &server)
}

/// Nur Maske (LLH-1282): einen bekannten Server aus der Auswahl nehmen. Gibt die neue Liste.
#[tauri::command]
fn vergessen(app: AppHandle, adresse: String) -> Result<Vec<BekannterServer>, String> {
    verbindung::vergessen(&konfig_dir(&app), &adresse)
        .map_err(|fehler| format!("Die Liste ließ sich nicht speichern: {fehler}"))?;
    Ok(bekannte_server(&app))
}

/// Was die Anzeige „nicht erreichbar“ zeigt.
#[derive(Serialize)]
struct NichtErreichbar {
    /// Origin des Servers, den das Fenster laden wollte.
    adresse: String,
    /// Die Anzeige prüft selbst weiter (der Port antwortete nicht).
    automatisch: bool,
}

fn ausfall(app: &AppHandle, fenster: &WebviewWindow) -> Option<Ausfall> {
    app.state::<Zustand>()
        .ausfaelle
        .lock()
        .unwrap()
        .get(fenster.label())
        .cloned()
}

/// Nur Anzeige „nicht erreichbar“ (LLH-1283): was sie zeigt.
#[tauri::command]
fn nicht_erreichbar(app: AppHandle, fenster: WebviewWindow) -> Result<NichtErreichbar, String> {
    let ausfall = ausfall(&app, &fenster).ok_or("Kein Ausfall in diesem Fenster.")?;
    Ok(NichtErreichbar {
        adresse: ausfall.ziel.origin().ascii_serialization(),
        automatisch: ausfall.grund == Grund::NichtErreichbar,
    })
}

/// Nur Anzeige „nicht erreichbar“: antwortet der Server jetzt? Ohne Laden — die Anzeige lädt erst,
/// wenn ja, damit das Fenster nicht zwischen leer und Anzeige springt.
#[tauri::command]
async fn check_server(app: AppHandle, fenster: WebviewWindow) -> Result<bool, String> {
    let ausfall = ausfall(&app, &fenster).ok_or("Kein Ausfall in diesem Fenster.")?;
    tauri::async_runtime::spawn_blocking(move || {
        erreichbar::check_erreichbar(&ausfall.ziel, erreichbar::CHECK_TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Nur Anzeige „nicht erreichbar“: lädt erneut, was das Fenster laden wollte. Wurde inzwischen auf
/// einen anderen Server gewechselt, dessen Startseite.
#[tauri::command]
fn erneut_versuchen(app: AppHandle, fenster: WebviewWindow) -> Result<(), String> {
    let Some(server) = verbundener_server(&app) else {
        zeige_maske(&app, None);
        return Ok(());
    };
    let ziel = ausfall(&app, &fenster)
        .map(|ausfall| ausfall.ziel)
        .filter(|ziel| links::gehoert_zum_server(&server, ziel))
        .unwrap_or(server);
    load_in_fenster(&app, &fenster, ziel)
}

/// Nur Anzeige „nicht erreichbar“: zur Maske (im Hauptfenster).
#[tauri::command]
fn server_wechseln(app: AppHandle) {
    zeige_maske(&app, None);
}

/// Serverseite (nur macOS genutzt): nativer Druckdialog für die aktuelle Seite.
#[tauri::command]
fn drucken(fenster: WebviewWindow) -> Result<(), String> {
    fenster.print().map_err(|e| e.to_string())
}

/// Serverseite (D7 des Benachrichtigungskonzepts): native Meldung mit Titel und Text der Seite.
/// Entscheidet nichts — ob und wann eine Meldung erscheint, bestimmt das Frontend
/// (`frontend/src/alarm/desktopAlarm.ts`). Die Meldung merkt sich nur ihr Fenster, damit ein
/// Klick es nach vorn holt ([`klick_fenster`]).
#[tauri::command]
fn benachrichtigung_zeigen(
    app: AppHandle,
    fenster: WebviewWindow,
    titel: String,
    text: Option<String>,
) -> Result<(), String> {
    let schluessel = format!("{titel}\n{}", text.as_deref().unwrap_or_default());
    let neu = neu_gemeldet(
        &mut app.state::<Zustand>().meldungen.lock().unwrap(),
        schluessel,
        Instant::now(),
    );
    if !neu {
        return Ok(());
    }
    let meldung = app
        .notification()
        .builder()
        .title(titel)
        .extra(MELDUNG_FENSTER, fenster.label());
    let meldung = match text {
        Some(text) => meldung.body(text),
        None => meldung,
    };
    meldung.show().map_err(|e| e.to_string())
}

/// So lange gilt eine gleiche Meldung aus einem weiteren Fenster als dieselbe (LLH-1281).
const DOPPEL_FRIST: Duration = Duration::from_secs(3);

/// Ist die Meldung mit `schluessel` (Titel und Text) neu? Mehrere Fenster desselben Einsatzes
/// melden ein Ereignis je für sich; das System zeigt es einmal. Merkt sie sich, wenn ja.
fn neu_gemeldet(letzte: &mut Vec<(String, Instant)>, schluessel: String, jetzt: Instant) -> bool {
    letzte.retain(|(_, zeit)| jetzt.duration_since(*zeit) < DOPPEL_FRIST);
    if letzte.iter().any(|(bekannt, _)| *bekannt == schluessel) {
        return false;
    }
    letzte.push((schluessel, jetzt));
    true
}

/// Schlüssel in den Zusatzdaten einer Meldung: das Fenster, das sie gezeigt hat.
const MELDUNG_FENSTER: &str = "fenster";

/// Welches Fenster ein Klick auf eine Meldung nach vorn holt: das, aus dem sie kam, sonst das
/// Hauptfenster. Andere Aktionen als der Klick selbst (`tap`) holen nichts.
fn klick_fenster(aktion: &ActionPerformed) -> Option<String> {
    if aktion.action_id() != "tap" {
        return None;
    }
    let label = aktion
        .notification()
        .and_then(|meldung| meldung.extra().get(MELDUNG_FENSTER))
        .and_then(|wert| wert.as_str());
    Some(label.unwrap_or(FENSTER).to_string())
}

/// Holt ein Fenster nach vorn, auch aus dem Dock bzw. der Taskleiste.
fn nach_vorn(fenster: &WebviewWindow) {
    let _ = fenster.unminimize();
    let _ = fenster.show();
    let _ = fenster.set_focus();
}

/// Serverseite (LFH-818): „Im Browser anmelden“. Öffnet die Bestätigungsseite des verbundenen
/// Servers — nie eine Adresse des Aufrufers — in einer `ASWebAuthenticationSession`; der
/// `verifier` bleibt in der Hülle.
#[tauri::command]
fn anmeldung_im_browser(app: AppHandle, fenster: WebviewWindow) -> Result<(), String> {
    let server = verbundener_server(&app).ok_or("Es ist kein Server verbunden.")?;
    let verifier = pkce::neuer_verifier()?;
    let ziel = anmeldung::bestaetigung_url(&server, &pkce::challenge_aus(&verifier));
    let zustand = app.state::<Zustand>();
    let nummer = zustand.anmeldungen.fetch_add(1, Ordering::Relaxed) + 1;
    *zustand.anmeldung.lock().unwrap() = Some(Ausstehend {
        nummer,
        verifier,
        fenster: fenster.label().to_string(),
        server,
    });
    let erg = im_browser_starten(&app, &fenster, ziel, nummer);
    if erg.is_err() {
        zustand.anmeldung.lock().unwrap().take();
    }
    erg
}

#[cfg(target_os = "macos")]
fn im_browser_starten(
    app: &AppHandle,
    fenster: &WebviewWindow,
    ziel: Url,
    nummer: u32,
) -> Result<(), String> {
    // Synchrone Commands laufen auf dem Hauptthread; AppKit verlangt ihn. Kein Weiterreichen mit
    // rohem Fensterzeiger: das Fenster könnte dazwischen geschlossen sein.
    if objc2::MainThreadMarker::new().is_none() {
        return Err("Die Anmeldung im Browser muss auf dem Hauptthread starten.".to_string());
    }
    let ns_window = fenster.ns_window().map_err(|e| e.to_string())?;
    let (fuer_hauptthread, fuer_ende) = (app.clone(), app.clone());
    aswas::starten(
        ns_window,
        ziel.as_str(),
        deeplink::SCHEMA,
        // Geteilte Browsersitzung; gegen die Sitzung einer anderen Person steht die
        // Bestätigungsseite mit Namen (Design LFH-818, Entscheidung 7).
        false,
        // Der Handler der Sitzung läuft auf einer XPC-Queue; das Ende gehört auf den Hauptthread.
        move |aufgabe| {
            if let Err(fehler) = fuer_hauptthread.run_on_main_thread(aufgabe) {
                log::warn!("Ende der Anmeldung nicht an den Hauptthread übergeben: {fehler}");
            }
        },
        move |ergebnis| anmeldung_abschliessen(&fuer_ende, nummer, ergebnis),
    )
}

#[cfg(not(target_os = "macos"))]
fn im_browser_starten(
    _app: &AppHandle,
    _fenster: &WebviewWindow,
    _ziel: Url,
    _nummer: u32,
) -> Result<(), String> {
    Err("Die Anmeldung im Browser gibt es nur in der Mac-App.".to_string())
}

/// Ende einer Sitzung: nur der aktuelle Vorgang zählt. Eingelöst wird nur im startenden Fenster
/// und nur auf der Anmeldeseite desselben Servers; Meldungen gehen nur an Seiten des Servers.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn anmeldung_abschliessen(app: &AppHandle, nummer: u32, ergebnis: Result<String, (isize, String)>) {
    let zustand = app.state::<Zustand>();
    let offen = {
        let mut anmeldung = zustand.anmeldung.lock().unwrap();
        if anmeldung.as_ref().map(|a| a.nummer) != Some(nummer) {
            return;
        }
        anmeldung.take().expect("gerade geprüft")
    };
    let Some(fenster) = app.get_webview_window(&offen.fenster) else {
        return;
    };
    let ergebnis = match &ergebnis {
        Ok(ruecksprung) => Ok(ruecksprung.as_str()),
        Err((code, text)) => {
            #[cfg(target_os = "macos")]
            let abgebrochen = *code == aswas::ABGEBROCHEN;
            #[cfg(not(target_os = "macos"))]
            let abgebrochen = false;
            if !abgebrochen {
                log::warn!("Anmeldung im Browser gescheitert ({code}): {text}");
            }
            Err(abgebrochen)
        }
    };
    let seite = fenster.url().ok();
    let skript = match anmeldung::folge(ergebnis, seite.as_ref(), &offen.server) {
        anmeldung::Folge::Einloesen(code) => {
            anmeldung::einloese_skript(&offen.server, &code, &offen.verifier)
        }
        anmeldung::Folge::Melden(ergebnis) => anmeldung::meldung_skript(ergebnis),
        anmeldung::Folge::Nichts => {
            log::warn!(
                "Anmeldung nicht eingelöst: das Fenster zeigt {}",
                seite.as_ref().map(fuers_protokoll).unwrap_or_default()
            );
            return;
        }
    };
    if let Err(fehler) = fenster.eval(skript) {
        log::warn!("Anmeldung nicht an die Seite übergeben: {fehler}");
    }
}

// ── Deeplink ─────────────────────────────────────────────────────────────────────────

fn deeplinks_verarbeiten(app: &AppHandle, links: Vec<Url>) {
    for link in links {
        let Some(ziel) = deute(&link) else {
            // Ohne Query: ein `lifeline://anmeldung?code=…` von außen gehört nicht ins
            // Protokoll (LFH-818), ebenso wenig die Adresse eines verworfenen Links.
            log::info!("Deeplink verworfen: {}", fuers_protokoll(&link));
            continue;
        };
        let gespeichert = verbindung::lesen(&konfig_dir(app));
        match entscheide(gespeichert.as_ref(), &ziel) {
            Aktion::Vorbelegen(ziel) => zeige_maske(app, Some(ziel)),
            Aktion::Bestaetigen(ziel) => bestaetige_wechsel(app, gespeichert, ziel),
            Aktion::Nichts => {
                if let Some(fenster) = front_fenster(app) {
                    nach_vorn(&fenster);
                }
            }
        }
    }
}

/// Ein Link will auf einen anderen Server umschalten: nur mit Bestätigung, die beide Adressen
/// nennt (desktop-huelle: „Ein Serverwechsel per Deeplink wird bestätigt“).
fn bestaetige_wechsel(app: &AppHandle, alt: Option<Url>, neu: Url) {
    let alt = alt.map(String::from).unwrap_or_default();
    // Host eigens genannt: der Host entscheidet, wohin die Anmeldung geht.
    let host = neu.host_str().unwrap_or_default();
    let text = format!(
        "Mit dem Server {host} verbinden?\n\nNeue Adresse: {neu}\nBisherige Adresse: {alt}\n\n\
         Verbinden Sie nur, wenn Sie den Link aus Ihrer Einsatzorganisation erhalten haben."
    );
    let handle = app.clone();
    app.dialog()
        .message(text)
        .title("Server wechseln")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Verbinden".into(),
            "Abbrechen".into(),
        ))
        .show(move |bestaetigt| {
            if !bestaetigt {
                return;
            }
            if let Err(fehler) = verbindung::schreiben(&konfig_dir(&handle), &neu)
                .map_err(|e| e.to_string())
                .and_then(|()| lade_server(&handle, &neu))
            {
                log::error!("Serverwechsel per Deeplink gescheitert: {fehler}");
            }
        });
}

fn main() {
    tauri::Builder::default()
        // Zuerst: ein zweiter Start (auch per Deeplink) geht an die laufende Instanz. Den Link
        // selbst reicht das Plugin über `on_open_url` weiter (Feature `deep-link`).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(fenster) = front_fenster(app) {
                nach_vorn(&fenster);
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(Zustand::default())
        .invoke_handler(tauri::generate_handler![
            vorbelegung,
            verbinden,
            abbrechen,
            vergessen,
            nicht_erreichbar,
            check_server,
            erneut_versuchen,
            server_wechseln,
            drucken,
            anmeldung_im_browser,
            benachrichtigung_zeigen
        ])
        .menu(menue::bauen)
        .on_menu_event(menue::behandeln)
        // Die Fenster sind gleichrangig (LLH-1281): schließt eins, bleiben die anderen. Maske,
        // Deeplink und Serverwechsel bauen das Hauptfenster bei Bedarf neu; mit dem letzten
        // Fenster endet die App. Ein geschlossenes Fenster nimmt Wache und Anzeige mit.
        .on_window_event(|fenster, ereignis| {
            if matches!(ereignis, tauri::WindowEvent::Destroyed) {
                let zustand = fenster.app_handle().state::<Zustand>();
                zustand.watches.lock().unwrap().remove(fenster.label());
                zustand.ausfaelle.lock().unwrap().remove(fenster.label());
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Nur im Entwicklungslauf das Schema selbst registrieren; installiert trägt es der
            // Installer ein — ein Release-Build soll den Eintrag nicht auf sich umbiegen.
            #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
            {
                let _ = app.deep_link().register_all();
            }

            let gespeichert = verbindung::lesen(&konfig_dir(&handle));
            let start = match &gespeichert {
                Some(server) => {
                    server_freigeben(&handle, server);
                    WebviewUrl::External(server.clone())
                }
                None => WebviewUrl::App("index.html".into()),
            };

            // Die Wache vor dem Bau, wie in `lade_server`.
            if let Some(server) = gespeichert {
                start_watch(&handle, FENSTER, server);
            }
            baue_fenster(&handle, FENSTER, start, None)?;

            // Ein Klick auf eine native Meldung holt ihr Fenster nach vorn, auch aus dem Dock
            // (D7): macOS aktiviert die App, holt ein minimiertes Fenster aber nicht zurück. Den
            // Sprung zum Bezug trägt der Toast, der dort schon steht.
            let fuer_klick = handle.clone();
            app.notification().on_action(move |aktion| {
                let Some(label) = klick_fenster(aktion) else {
                    return;
                };
                if let Some(fenster) = fuer_klick
                    .get_webview_window(&label)
                    .or_else(|| front_fenster(&fuer_klick))
                {
                    nach_vorn(&fenster);
                }
            })?;

            let fuer_links = handle.clone();
            app.deep_link()
                .on_open_url(move |ereignis| deeplinks_verarbeiten(&fuer_links, ereignis.urls()));
            if let Ok(Some(links)) = app.deep_link().get_current() {
                deeplinks_verarbeiten(&handle, links);
            }

            // Die Prüfung läuft neben dem Laden, nie davor: im Einsatz-LAN ohne Internet darf
            // der Start nicht warten (desktop-auslieferung).
            update::im_hintergrund_pruefen(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri-Lauf");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn freigabe_gilt_genau_fuer_die_origin() {
        let (kennung, muster) =
            freigabe(&Url::parse("https://elw.local:8443/einsaetze/1?q=x").unwrap());
        assert_eq!(muster, "https://elw.local:8443/*");
        assert_eq!(kennung, "server-https---elw-local-8443");
        // Standardport fällt aus der Origin, IPv6 behält die Klammern im Muster.
        let (_, muster) = freigabe(&Url::parse("https://elw.local:443/").unwrap());
        assert_eq!(muster, "https://elw.local/*");
        let (kennung, muster) = freigabe(&Url::parse("https://[fd00::1]:8443/").unwrap());
        assert_eq!(muster, "https://[fd00::1]:8443/*");
        assert!(kennung
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-'));
    }

    #[test]
    fn protokoll_enthaelt_keine_query() {
        let url = Url::parse("https://elw.local:8443/einsaetze/1/etb?q=M%C3%BCller#x").unwrap();
        assert_eq!(
            fuers_protokoll(&url),
            "https://elw.local:8443/einsaetze/1/etb"
        );
    }

    #[test]
    fn protokoll_nennt_bei_adressen_ohne_host_nur_das_schema() {
        let url = |s: &str| Url::parse(s).unwrap();
        assert_eq!(
            fuers_protokoll(&url("mailto:max.mueller@example.org")),
            "mailto:"
        );
        assert_eq!(fuers_protokoll(&url("tel:+4930123456")), "tel:");
        assert_eq!(
            fuers_protokoll(&url("javascript:alert(document.cookie)")),
            "javascript:"
        );
        assert_eq!(
            fuers_protokoll(&url("tauri://localhost/index.html?x=1")),
            "tauri://localhost/index.html"
        );
        // So meldet `on_download` den CSV-Export (LFH-914); Tauri verwirft eine URL, die sich
        // nicht lesen lässt, samt Download.
        assert_eq!(
            fuers_protokoll(&url("blob:https://elw.local:8443/6f1c2a9e-8d3b-4e7a")),
            "blob:"
        );
    }

    /// Die Serverseite bekommt genau Druck, „Im Browser anmelden“ und die native Meldung; die
    /// Maske (`lokal`) weder die Anmeldung noch die Meldung, und niemand die Commands des
    /// Notification-Plugins. Die Permissions entstehen aus dem Manifest in `build.rs`.
    #[test]
    fn serverseite_darf_anmelden_und_melden_die_maske_nicht() {
        assert_eq!(
            SERVER_RECHTE,
            [
                "allow-drucken",
                "allow-anmeldung-im-browser",
                "allow-benachrichtigung-zeigen"
            ]
        );
        // Ein Plugin-Recht trüge ein Präfix (`notification:…`).
        assert!(SERVER_RECHTE.iter().all(|recht| !recht.contains(':')));
        let erzeugt = include_str!("../permissions/autogenerated/anmeldung_im_browser.toml");
        assert!(erzeugt.contains(r#"identifier = "allow-anmeldung-im-browser""#));
        let erzeugt = include_str!("../permissions/autogenerated/benachrichtigung_zeigen.toml");
        assert!(erzeugt.contains(r#"identifier = "allow-benachrichtigung-zeigen""#));
        assert!(erzeugt.contains(r#"commands.allow = ["benachrichtigung_zeigen"]"#));
        let lokal = include_str!("../capabilities/lokal.json");
        assert!(!lokal.contains("anmeldung"), "{lokal}");
        assert!(!lokal.contains("benachrichtigung"), "{lokal}");
        assert!(!lokal.contains("notification"), "{lokal}");
    }

    fn aktion(json: serde_json::Value) -> ActionPerformed {
        serde_json::from_value(json).expect("ActionPerformed aus JSON")
    }

    /// Ein Klick holt das Fenster, aus dem die Meldung kam; fehlt es in den Zusatzdaten, das
    /// Hauptfenster. Eine andere Aktion holt nichts.
    #[test]
    fn klick_auf_eine_meldung_holt_ihr_fenster() {
        let mit_fenster = serde_json::json!({
            "actionId": "tap",
            "notification": { "id": 7, "extra": { MELDUNG_FENSTER: "neben-3" } },
        });
        assert_eq!(
            klick_fenster(&aktion(mit_fenster)).as_deref(),
            Some("neben-3")
        );
        let ohne_fenster = serde_json::json!({ "actionId": "tap", "notification": { "id": 7 } });
        assert_eq!(
            klick_fenster(&aktion(ohne_fenster)).as_deref(),
            Some(FENSTER)
        );
        let ohne_meldung = serde_json::json!({ "actionId": "tap", "notification": null });
        assert_eq!(
            klick_fenster(&aktion(ohne_meldung)).as_deref(),
            Some(FENSTER)
        );
        let andere = serde_json::json!({ "actionId": "dismiss", "notification": { "id": 7 } });
        assert_eq!(klick_fenster(&aktion(andere)), None);
    }

    /// Das Skript der Meldung läuft in jeder Hülle und ergänzt die Kennung, die
    /// `faehigkeiten.js` auf macOS ebenfalls ergänzt — keines darf das andere überschreiben.
    #[test]
    fn init_skripte_ergaenzen_dieselbe_kennung() {
        for skript in [BENACHRICHTIGUNG_SKRIPT, include_str!("faehigkeiten.js")] {
            assert!(
                skript.contains("...window.__LIFELINE_HUELLE__,"),
                "{skript}"
            );
        }
        assert!(BENACHRICHTIGUNG_SKRIPT.contains("ipc.invoke('benachrichtigung_zeigen'"));
    }

    #[test]
    fn verworfener_anmeldelink_landet_ohne_code_im_protokoll() {
        let link = Url::parse(&format!("lifeline://anmeldung?code={}", "ab".repeat(32))).unwrap();
        assert_eq!(fuers_protokoll(&link), "lifeline://anmeldung");
    }

    /// Die URL steht als JSON-Literal im Skript: ein Anführungszeichen oder Zeilenumbruch in der
    /// URL beendet den String nicht.
    #[test]
    fn download_skript_kodiert_die_url() {
        let ziel =
            Url::parse("https://elw.local:8443/api/einsaetze/1/anhaenge/7?n=a'b\"c").unwrap();
        let skript = download_skript(&ziel);
        let literal = serde_json::to_string(ziel.as_str()).unwrap();
        assert!(skript.contains(&format!("a.href = {literal};")), "{skript}");
        assert!(skript.contains("a.download = '';"), "{skript}");
        assert!(!skript.contains('\n'), "{skript}");
    }

    /// Die Anzeige „nicht erreichbar“ gilt nur lokal (keine `remote`-Origin) und darf keine Adresse
    /// setzen; die Serverseite bekommt keinen ihrer Commands.
    #[test]
    fn anzeige_nicht_erreichbar_ist_lokal_und_setzt_keine_adresse() {
        let anzeige: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/nicht-erreichbar.json")).unwrap();
        assert!(anzeige.get("remote").is_none(), "{anzeige}");
        let rechte: Vec<&str> = anzeige["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|recht| recht.as_str().unwrap())
            .collect();
        assert!(!rechte.contains(&"allow-verbinden"), "{rechte:?}");
        assert!(!rechte.contains(&"allow-vergessen"), "{rechte:?}");
        let fenster = anzeige["windows"].as_array().unwrap();
        let [haupt, neben] = freigabe_fenster();
        assert!(fenster.contains(&haupt.into()) && fenster.contains(&neben.into()));
        for recht in rechte.iter().filter(|recht| recht.starts_with("allow-")) {
            assert!(!SERVER_RECHTE.contains(recht), "{recht}");
        }
        let lokal = include_str!("../capabilities/lokal.json");
        assert!(lokal.contains("\"allow-vergessen\""), "{lokal}");
        assert!(!lokal.contains("remote"), "{lokal}");
    }

    /// Ein neues Fenster aus dem Menü beginnt auf der Seite des vorderen Fensters, wenn sie zum
    /// Server gehört; sonst (Maske, Anbieter, anderer Server) auf der Startseite.
    #[test]
    fn neues_fenster_beginnt_auf_der_seite_des_vorderen() {
        let server = Url::parse("https://elw.local:8443/").unwrap();
        let seite = Url::parse("https://elw.local:8443/einsaetze/4/lagekarte?ebene=2").unwrap();
        assert_eq!(ziel_neues_fenster(&server, Some(&seite)), seite);
        for fremd in [
            "tauri://localhost/index.html",
            "https://id.example.org/login",
            "https://elw.local:9443/einsaetze/4",
        ] {
            let fremd = Url::parse(fremd).unwrap();
            assert_eq!(ziel_neues_fenster(&server, Some(&fremd)), server, "{fremd}");
        }
        assert_eq!(ziel_neues_fenster(&server, None), server);
    }

    #[test]
    fn neues_fenster_rueckt_versetzt_in_gleicher_groesse() {
        let platz = platz_neben(
            LogicalPosition::new(100.0, 80.0),
            LogicalSize::new(1200.0, 800.0),
        );
        assert_eq!(platz.position, LogicalPosition::new(130.0, 110.0));
        assert_eq!(platz.groesse, LogicalSize::new(1200.0, 800.0));
    }

    /// Zwei Fenster desselben Einsatzes melden dasselbe Ereignis: das System zeigt es einmal. Nach
    /// der Frist oder mit anderem Text ist es eine neue Meldung.
    #[test]
    fn gleiche_meldung_aus_zwei_fenstern_erscheint_einmal() {
        let mut letzte = Vec::new();
        let start = Instant::now();
        assert!(neu_gemeldet(
            &mut letzte,
            "Auftrag überfällig\nA-12".into(),
            start
        ));
        assert!(!neu_gemeldet(
            &mut letzte,
            "Auftrag überfällig\nA-12".into(),
            start + Duration::from_millis(200)
        ));
        assert!(neu_gemeldet(
            &mut letzte,
            "Auftrag überfällig\nA-13".into(),
            start + Duration::from_millis(300)
        ));
        assert!(neu_gemeldet(
            &mut letzte,
            "Auftrag überfällig\nA-12".into(),
            start + DOPPEL_FRIST + Duration::from_millis(1)
        ));
        // Alte Einträge fallen heraus, die Liste wächst nicht.
        assert!(letzte.len() <= 2, "{}", letzte.len());
    }

    /// Jedes Nebenfenster fällt unter das Muster der Druckfreigabe; die Maske bleibt außen vor.
    #[test]
    fn druckfreigabe_deckt_nebenfenster() {
        let [haupt, muster] = freigabe_fenster();
        assert_eq!(haupt, FENSTER);
        let praefix = muster.strip_suffix('*').expect("Muster endet auf *");
        assert!(nebenfenster_label(1).starts_with(praefix));
        assert!(nebenfenster_label(42).starts_with(praefix));
        assert!(!FENSTER.starts_with(praefix));
    }

    /// Die Hülle trägt die Anwendungsversion; ihr Updater vergleicht sie mit `latest.json`. Beide
    /// Pakete erben sie aus `[workspace.package]` — ein eigenes Versionsfeld in einem von beiden
    /// drifte beim Einmergen eines alpha-Releases still auseinander.
    #[test]
    fn version_kommt_aus_dem_workspace() {
        // Zeilengenau: der Kopf muss allein auf der Zeile stehen — in Kommentaren kommt
        // `[workspace.package]` als Text vor.
        fn abschnitt<'a>(manifest: &'a str, kopf: &str) -> Vec<&'a str> {
            manifest
                .lines()
                .skip_while(|zeile| zeile.trim() != kopf)
                .skip(1)
                .take_while(|zeile| !zeile.trim_start().starts_with('['))
                .collect()
        }
        let wurzel = include_str!("../../Cargo.toml");
        for (name, manifest) in [
            ("Wurzel", wurzel),
            ("src-tauri", include_str!("../Cargo.toml")),
        ] {
            assert!(
                abschnitt(manifest, "[package]")
                    .iter()
                    .any(|zeile| zeile.trim() == "version.workspace = true"),
                "{name}: [package] muss `version.workspace = true` tragen"
            );
        }
        let version = abschnitt(wurzel, "[workspace.package]")
            .into_iter()
            .find_map(|zeile| zeile.trim().strip_prefix("version = \""))
            .and_then(|rest| rest.strip_suffix('"'))
            .expect("version in [workspace.package]");
        assert_eq!(env!("CARGO_PKG_VERSION"), version);
    }
}
