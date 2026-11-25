//! Desktop-Hülle von Lifeline Hub (LFH-721, Variante A aus LFH-720): der Webview lädt die
//! https-Adresse des Einsatzservers. Die Hülle bringt Fenster, Erststart, Deeplink, Druck,
//! Update — keine zweite Anwendungslogik. Anforderungen: `openspec/specs/desktop-huelle/` und
//! `openspec/specs/desktop-auslieferung/`; Entscheidungen im Design des Changes LFH-721.
//!
//! RECHTE: Die lokale Erststart-Maske darf die Adresse setzen (Capability `lokal`), die lokale
//! Anzeige „nicht erreichbar“ nur prüfen, neu laden und zur Maske führen (`nicht-erreichbar`). Die
//! Serverseite bekommt zur Laufzeit genau für ihre Origin nur `drucken`,
//! `anmeldung_im_browser` (LFH-818), `benachrichtigung_zeigen` (D7 des
//! Benachrichtigungskonzepts) und `set_app_badge` (LLH-1423) — sie kann die Hülle nicht auf einen
//! anderen Server umlenken.
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
mod vertrag;

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

/// Datei der Seite „nicht verträglich“ für `WebviewUrl::App`.
const SEITE_NICHT_VERTRAEGLICH: &str = "nicht-vertraeglich.html";

/// Lokale Seite „nicht verträglich“ (LLH-1982), in jedem Fenster möglich.
#[cfg(windows)]
const NICHT_VERTRAEGLICH: &str = "http://tauri.localhost/nicht-vertraeglich.html";
#[cfg(not(windows))]
const NICHT_VERTRAEGLICH: &str = "tauri://localhost/nicht-vertraeglich.html";

/// Pfad der lokalen Startseite „Verbinde…“ (LLH-1982) für `WebviewUrl::App`: sie nennt nur die
/// Origin des Servers, nie Pfad oder Query (dort steht Freitext).
fn verbinde_pfad(server: &Url) -> String {
    let origin: String =
        url::form_urlencoded::byte_serialize(server.origin().ascii_serialization().as_bytes())
            .collect();
    format!("verbinde.html?server={origin}")
}

/// `window.print()` erreicht in WKWebView keinen Dialog (LFH-720, Befund 17) — auf macOS
/// leitet die Hülle den Aufruf auf den nativen Druck um.
#[cfg(target_os = "macos")]
const DRUCK_SKRIPT: &str = include_str!("druck.js");

/// Kennung mit Plattform und Version (LLH-1982), in jeder Hülle zuerst; Werte aus
/// [`kennung_skript`].
const KENNUNG_SKRIPT: &str = include_str!("kennung.js");

/// Das Kennungs-Skript mit den Werten dieser Hülle: Plattform aus `std::env::consts::OS`
/// (`macos`, `windows`; `linux` nur in der Entwicklung) und die Version des Workspace.
fn kennung_skript() -> String {
    let wert = |text: &str| serde_json::to_string(text).expect("Zeichenkette als JSON");
    KENNUNG_SKRIPT
        .replace("__PLATFORM__", &wert(std::env::consts::OS))
        .replace("__VERSION__", &wert(env!("CARGO_PKG_VERSION")))
}

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

/// Ein Fenster zeigt die Seite „nicht verträglich“ (LLH-1982): was es laden wollte und warum
/// nicht.
#[derive(Clone)]
struct Unvertraeglich {
    ziel: Url,
    richtung: vertrag::Richtung,
    server_version: Option<String>,
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
    /// Je Fenster, das die Seite „nicht verträglich“ zeigt (LLH-1982), Ziel und Urteil.
    unvertraeglich: Mutex<HashMap<String, Unvertraeglich>>,
    /// Je Origin das letzte Urteil „nicht verträglich“ (LLH-1982): Nebenfenster und „Neues
    /// Fenster“ laden einen so erkannten Server nicht. Eine bestandene Prüfung löscht es.
    urteile: Mutex<HashMap<String, Unvertraeglich>>,
    /// Origins, deren Vertrag diese Sitzung bestätigt hat (LLH-1982): Nebenfenster dorthin laden
    /// ohne eigene Prüfung, alle anderen prüfen erst.
    bestaetigt: Mutex<HashSet<String>>,
    /// Je Fenster die Nummer der jüngsten Ladung mit Vertragsprüfung (LLH-1982): eine ältere,
    /// noch laufende Prüfung wirkt nicht mehr, ebenso keine für ein geschlossenes Fenster.
    ladungen: Mutex<HashMap<String, u32>>,
    ladung_nummer: AtomicU32,
    /// Zuletzt gezeigte native Meldungen: mehrere Fenster desselben Einsatzes melden dasselbe
    /// Ereignis je einmal (LLH-1281).
    meldungen: Mutex<Vec<(String, Instant)>>,
    /// Je Fenster die Zahl fürs App-Symbol (LLH-1423); ein Fenster ohne Zahl fehlt.
    badges: Mutex<HashMap<String, u32>>,
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

/// Was die Serverseite aufrufen darf: den Druck, „Im Browser anmelden“ (LFH-818), die native
/// Meldung (D7 des Benachrichtigungskonzepts) und die Zahl am App-Symbol (LLH-1423). Die Commands
/// des Notification-Plugins nicht.
const SERVER_RECHTE: [&str; 4] = [
    "allow-drucken",
    "allow-anmeldung-im-browser",
    "allow-benachrichtigung-zeigen",
    "allow-set-app-badge",
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

/// Was das Fenster `label` laden wollte, als es die Anzeige „nicht erreichbar“ oder die Seite
/// „nicht verträglich“ bekam.
fn gewolltes_ziel(app: &AppHandle, label: &str) -> Option<Url> {
    let zustand = app.state::<Zustand>();
    let ausgefallen = zustand
        .ausfaelle
        .lock()
        .unwrap()
        .get(label)
        .map(|ausfall| ausfall.ziel.clone());
    ausgefallen.or_else(|| {
        zustand
            .unvertraeglich
            .lock()
            .unwrap()
            .get(label)
            .map(|ausfall| ausfall.ziel.clone())
    })
}

/// Nebenfenster eines anderen Servers gehören nach dem Wechsel zu keinem mehr. Beim Abbrechen
/// oder Verbinden mit derselben Adresse bleiben sie — `close()` fragt nicht nach, ein offener
/// Entwurf verlöre sonst, was der Autosave noch nicht hat. Ein Nebenfenster mit der Anzeige
/// „nicht erreichbar“ oder der Seite „nicht verträglich“ zählt mit dem Server, den es laden wollte.
fn raeume_nebenfenster(app: &AppHandle, server: &Url) {
    for (label, nebenfenster) in app.webview_windows() {
        let bleibt = gewolltes_ziel(app, &label)
            .or_else(|| nebenfenster.url().ok())
            .is_some_and(|seite| links::gehoert_zum_server(server, &seite));
        if label.starts_with(NEBENFENSTER_PRAEFIX) && !bleibt {
            let _ = nebenfenster.close();
        }
    }
}

/// Lädt den Server ins Hauptfenster, nach bestandener Vertragsprüfung (LLH-1982).
async fn lade_server(app: AppHandle, server: Url) -> Result<(), String> {
    raeume_nebenfenster(&app, &server);
    pruefe_und_lade(app, FENSTER.to_string(), server).await
}

// ── Hüllen-Vertrag (LLH-1982) ────────────────────────────────────────────────────────

fn origin_von(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// Fragt den Hüllen-Vertrag des Servers von `ziel`; ohne Verbindung gilt sein gemerkter.
async fn pruefen(app: &AppHandle, ziel: &Url) -> vertrag::Vertragsergebnis {
    let letzter = verbindung::letzter_vertrag(&konfig_dir(app), ziel);
    vertrag::check(ziel, letzter).await
}

/// Vergibt dem Fenster `label` eine neue Ladung; jede ältere gilt danach nicht mehr.
fn neue_ladung_in(ladungen: &mut HashMap<String, u32>, zaehler: &AtomicU32, label: &str) -> u32 {
    let nummer = zaehler.fetch_add(1, Ordering::Relaxed) + 1;
    ladungen.insert(label.to_string(), nummer);
    nummer
}

/// Ist `nummer` noch die jüngste Ladung des Fensters (und das Fenster nicht geschlossen)?
fn ladung_gilt_in(ladungen: &HashMap<String, u32>, label: &str, nummer: u32) -> bool {
    ladungen.get(label) == Some(&nummer)
}

fn neue_ladung(app: &AppHandle, label: &str) -> u32 {
    let zustand = app.state::<Zustand>();
    let mut ladungen = zustand.ladungen.lock().unwrap();
    neue_ladung_in(&mut ladungen, &zustand.ladung_nummer, label)
}

fn ladung_gilt(app: &AppHandle, label: &str, nummer: u32) -> bool {
    ladung_gilt_in(
        &app.state::<Zustand>().ladungen.lock().unwrap(),
        label,
        nummer,
    )
}

/// Jedes Laden des Servers, das die Hülle selbst anstößt (Start, Maske, Deeplink, „Erneut
/// versuchen“), geht hierüber: erst prüfen, dann laden oder die Seite „nicht verträglich“. Kam
/// inzwischen eine neuere Ladung desselben Fensters (Maske, Deeplink) oder ist es zu, verfällt das
/// Ergebnis.
async fn pruefe_und_lade(app: AppHandle, label: String, ziel: Url) -> Result<(), String> {
    let nummer = neue_ladung(&app, &label);
    let ergebnis = pruefen(&app, &ziel).await;
    if !ladung_gilt(&app, &label, nummer) {
        log::info!("Veraltete Prüfung verworfen: {}", fuers_protokoll(&ziel));
        return Ok(());
    }
    anwenden(&app, &label, ziel, ergebnis)
}

/// Setzt das Ergebnis der Prüfung im Fenster `label` um.
fn anwenden(
    app: &AppHandle,
    label: &str,
    ziel: Url,
    ergebnis: vertrag::Vertragsergebnis,
) -> Result<(), String> {
    match ergebnis {
        vertrag::Vertragsergebnis::Vertraeglich(info) => {
            if let Err(fehler) =
                verbindung::merke_vertrag(&konfig_dir(app), &ziel, info.shell_contract)
            {
                log::warn!("Hüllen-Vertrag nicht gemerkt: {fehler}");
            }
            app.state::<Zustand>()
                .urteile
                .lock()
                .unwrap()
                .remove(&origin_von(&ziel));
            app.state::<Zustand>()
                .bestaetigt
                .lock()
                .unwrap()
                .insert(origin_von(&ziel));
            lade(app, label, ziel)
        }
        // Ohne Verbindung wie bisher: die Wache zeigt „nicht erreichbar“, oder der Service Worker
        // startet die Oberfläche offline (LFH-720).
        vertrag::Vertragsergebnis::NichtErreichbar => lade(app, label, ziel),
        vertrag::Vertragsergebnis::NichtVertraeglich {
            richtung,
            server_version,
        } => {
            let ausfall = Unvertraeglich {
                ziel: ziel.clone(),
                richtung,
                server_version,
            };
            app.state::<Zustand>()
                .urteile
                .lock()
                .unwrap()
                .insert(origin_von(&ziel), ausfall.clone());
            app.state::<Zustand>()
                .bestaetigt
                .lock()
                .unwrap()
                .remove(&origin_von(&ziel));
            if app.get_webview_window(label).is_some() {
                show_nicht_vertraeglich(app, label, ausfall);
                return Ok(());
            }
            // Das Fenster ist zu (LLH-1281): mit der Seite neu bauen.
            app.state::<Zustand>()
                .unvertraeglich
                .lock()
                .unwrap()
                .insert(label.to_string(), ausfall);
            baue_fenster(
                app,
                label,
                WebviewUrl::App(SEITE_NICHT_VERTRAEGLICH.into()),
                None,
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

/// Lädt `ziel` im Fenster `label` mit Wache; ist es zu, entsteht es neu.
fn lade(app: &AppHandle, label: &str, ziel: Url) -> Result<(), String> {
    server_freigeben(app, &ziel);
    match app.get_webview_window(label) {
        Some(fenster) => load_in_fenster(app, &fenster, ziel),
        // Das Fenster ist zu (LLH-1281), etwa bei einem Deeplink: neu bauen.
        None => {
            // Die Wache vor dem Bau: eine Seite aus dem Service Worker kann ankommen, bevor
            // `build()` zurückkehrt.
            start_watch(app, label, ziel.clone());
            baue_fenster(app, label, WebviewUrl::External(ziel), None)
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

/// Meldung der Maske (und des Deeplink-Dialogs) für einen unverträglichen Server.
fn maske_meldung(
    richtung: vertrag::Richtung,
    server_version: Option<&str>,
    app_version: &str,
) -> String {
    let server = match server_version {
        Some(version) => format!("Der Server (Version {version})"),
        None => "Der Server".to_string(),
    };
    match richtung {
        vertrag::Richtung::ZuAlt => {
            format!("{server} ist zu alt für diese App (Version {app_version}).")
        }
        vertrag::Richtung::ZuNeu => format!(
            "{server} ist neuer als diese App (Version {app_version}). Aktualisieren Sie die App."
        ),
    }
}

/// Darf eine neue Adresse nach der Prüfung gespeichert werden? Ein heute nicht erreichbarer
/// Server ja (er kann gleich kommen), ein unverträglicher nicht.
fn speichern_nach_pruefung(ergebnis: &vertrag::Vertragsergebnis) -> bool {
    !matches!(
        ergebnis,
        vertrag::Vertragsergebnis::NichtVertraeglich { .. }
    )
}

/// Womit ein Nebenfenster beginnt.
enum NebenfensterStart {
    /// Der Server ist in dieser Sitzung bestätigt: gleich laden.
    Server(Url),
    /// Noch nicht bestätigt (etwa ⌘N während der Startprüfung): erst „Verbinde…“ und prüfen.
    Pruefen(Url),
    NichtVertraeglich(Unvertraeglich),
}

/// Ein Nebenfenster lädt einen als unverträglich erkannten Server nicht, sondern zeigt die Seite;
/// einen in dieser Sitzung noch nicht bestätigten prüft es erst.
fn nebenfenster_seite(
    urteil: Option<&Unvertraeglich>,
    bestaetigt: bool,
    ziel: Url,
) -> NebenfensterStart {
    match urteil {
        Some(urteil) => NebenfensterStart::NichtVertraeglich(Unvertraeglich {
            ziel,
            ..urteil.clone()
        }),
        None if bestaetigt => NebenfensterStart::Server(ziel),
        None => NebenfensterStart::Pruefen(ziel),
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
    // Die Maske beendet jede laufende Prüfung (LLH-1982) und jede Wache des Hauptfensters: sie ist
    // selbst die Anzeige.
    neue_ladung(app, FENSTER);
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
    app.state::<Zustand>()
        .unvertraeglich
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
    zustand.unvertraeglich.lock().unwrap().remove(label);
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

/// Setzt die Seite „nicht verträglich“ ins Fenster (LLH-1982): keine Wache, keine Anzeige „nicht
/// erreichbar“ mehr — die Oberfläche des Servers lädt hier nicht.
fn show_nicht_vertraeglich(app: &AppHandle, label: &str, ausfall: Unvertraeglich) {
    let Some(fenster) = app.get_webview_window(label) else {
        return;
    };
    log::warn!(
        "Server nicht verträglich ({:?}, Server {}): {}",
        ausfall.richtung,
        ausfall.server_version.as_deref().unwrap_or("ohne Version"),
        fuers_protokoll(&ausfall.ziel)
    );
    let zustand = app.state::<Zustand>();
    zustand.watches.lock().unwrap().remove(label);
    zustand.ausfaelle.lock().unwrap().remove(label);
    zustand
        .unvertraeglich
        .lock()
        .unwrap()
        .insert(label.to_string(), ausfall);
    let _ = fenster.navigate(NICHT_VERTRAEGLICH.parse().expect("Adresse der Seite"));
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
            // Eine neu geladene Seite hat noch keine Zahl gemeldet (LLH-1423): Maske, Anzeige
            // „nicht erreichbar“ und ein anderer Server tragen keine.
            if matches!(seite.event(), tauri::webview::PageLoadEvent::Started) {
                apply_badge(fenster.app_handle(), fenster.label(), 0);
            }
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
        // Die Kennung zuerst, dann die Meldung, auf macOS danach `faehigkeiten.js`: alle ergänzen
        // dieselbe Kennung `__LIFELINE_HUELLE__`.
        .initialization_script(kennung_skript())
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
    let origin = origin_von(&ziel);
    let urteil = app
        .state::<Zustand>()
        .urteile
        .lock()
        .unwrap()
        .get(&origin)
        .cloned();
    let bestaetigt = app
        .state::<Zustand>()
        .bestaetigt
        .lock()
        .unwrap()
        .contains(&origin);
    let mut zu_pruefen = None;
    let start = match nebenfenster_seite(urteil.as_ref(), bestaetigt, ziel) {
        NebenfensterStart::Server(ziel) => {
            // Die Wache vor dem Bau, wie in `lade`.
            start_watch(app, &label, ziel.clone());
            WebviewUrl::External(ziel)
        }
        NebenfensterStart::Pruefen(ziel) => {
            let start = WebviewUrl::App(verbinde_pfad(&ziel).into());
            zu_pruefen = Some(ziel);
            start
        }
        // Ein als unverträglich erkannter Server lädt auch hier nicht (LLH-1982).
        NebenfensterStart::NichtVertraeglich(ausfall) => {
            app.state::<Zustand>()
                .unvertraeglich
                .lock()
                .unwrap()
                .insert(label.clone(), ausfall);
            WebviewUrl::App(SEITE_NICHT_VERTRAEGLICH.into())
        }
    };
    match baue_fenster(app, &label, start, platz) {
        Ok(fenster) => {
            let _ = fenster.set_focus();
            if let Some(ziel) = zu_pruefen {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(fehler) = pruefe_und_lade(app, label, ziel).await {
                        log::error!("Nebenfenster nach der Prüfung nicht geladen: {fehler}");
                    }
                });
            }
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
        // Eine Anzeige „nicht erreichbar“ oder „nicht verträglich“ meint das Ziel, das sie laden
        // wollte.
        gewolltes_ziel(app, fenster.label()).or_else(|| fenster.url().ok())
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

/// Nur Maske: Adresse prüfen, Hüllen-Vertrag prüfen (LLH-1982), speichern, laden. Ein
/// unverträglicher Server wird nicht gespeichert; die Meldung eines Fehlers zeigt die Maske.
#[tauri::command]
async fn verbinden(app: AppHandle, adresse: String) -> Result<(), String> {
    let server = pruefe_adresse(&adresse).map_err(|fehler| fehler.to_string())?;
    let nummer = neue_ladung(&app, FENSTER);
    let ergebnis = pruefen(&app, &server).await;
    if !ladung_gilt(&app, FENSTER, nummer) {
        return Ok(());
    }
    if let vertrag::Vertragsergebnis::NichtVertraeglich {
        richtung,
        server_version,
    } = &ergebnis
    {
        return Err(maske_meldung(
            *richtung,
            server_version.as_deref(),
            env!("CARGO_PKG_VERSION"),
        ));
    }
    debug_assert!(speichern_nach_pruefung(&ergebnis));
    verbindung::schreiben(&konfig_dir(&app), &server)
        .map_err(|fehler| format!("Die Adresse ließ sich nicht speichern: {fehler}"))?;
    raeume_nebenfenster(&app, &server);
    anwenden(&app, FENSTER, server, ergebnis)
}

/// Nur Maske: Wechsel abbrechen, die gespeicherte Adresse wieder laden.
#[tauri::command]
async fn abbrechen(app: AppHandle) -> Result<(), String> {
    let server = verbindung::lesen(&konfig_dir(&app)).ok_or("Es ist keine Adresse gespeichert.")?;
    lade_server(app, server).await
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

/// Nur Anzeige „nicht erreichbar“ und Seite „nicht verträglich“: lädt erneut, was das Fenster
/// laden wollte. Wurde inzwischen auf einen anderen Server gewechselt, dessen Startseite.
/// Geht wie jedes Laden über die Vertragsprüfung (LLH-1982).
#[tauri::command]
async fn erneut_versuchen(app: AppHandle, fenster: WebviewWindow) -> Result<(), String> {
    let Some(server) = verbundener_server(&app) else {
        zeige_maske(&app, None);
        return Ok(());
    };
    let ziel = gewolltes_ziel(&app, fenster.label())
        .filter(|ziel| links::gehoert_zum_server(&server, ziel))
        .unwrap_or(server);
    pruefe_und_lade(app, fenster.label().to_string(), ziel).await
}

/// Was die Seite „nicht verträglich“ zeigt (LLH-1982).
#[derive(Serialize)]
struct NichtVertraeglichAnzeige {
    /// Origin des Servers, den das Fenster laden wollte.
    adresse: String,
    richtung: vertrag::Richtung,
    /// Version des Servers; fehlt, wenn er keine nannte oder nur der gemerkte Vertrag galt.
    server_version: Option<String>,
    app_version: &'static str,
}

/// Nur Seite „nicht verträglich“: was sie zeigt.
#[tauri::command]
fn nicht_vertraeglich(
    app: AppHandle,
    fenster: WebviewWindow,
) -> Result<NichtVertraeglichAnzeige, String> {
    let ausfall = app
        .state::<Zustand>()
        .unvertraeglich
        .lock()
        .unwrap()
        .get(fenster.label())
        .cloned()
        .ok_or("Diese Seite zeigt keinen unverträglichen Server.")?;
    Ok(NichtVertraeglichAnzeige {
        adresse: ausfall.ziel.origin().ascii_serialization(),
        richtung: ausfall.richtung,
        server_version: ausfall.server_version,
        app_version: env!("CARGO_PKG_VERSION"),
    })
}

/// Nur Seite „nicht verträglich“: sucht ein Update der App, wie das Menü (Dialoge des Updaters).
#[tauri::command]
fn update_suchen(app: AppHandle) {
    update::auf_wunsch_pruefen(app);
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

/// Serverseite (LLH-1423): die Zahl der ungelesenen Eingänge dieses Fensters am App-Symbol; 0
/// nimmt sie weg. Welche Zahl, entscheidet das Frontend (`frontend/src/alarm/appBadge.ts`).
#[tauri::command]
fn set_app_badge(app: AppHandle, fenster: WebviewWindow, count: u32) {
    apply_badge(&app, fenster.label(), count);
}

/// Trägt die Zahl des Fensters `label` ein und setzt das App-Symbol neu, wenn sich dessen Zahl
/// ändert. Das Badge gilt für die ganze App (macOS: Dock), gesetzt wird es über ein anderes
/// Fenster als `label`, wenn es eins gibt: `label` kann gerade schließen. Wo das System keine Zahl
/// am Symbol kennt (Windows), tut Tauri nichts; ein Fehler kommt nur ins Protokoll.
fn apply_badge(app: &AppHandle, label: &str, count: u32) {
    let zustand = app.state::<Zustand>();
    let zahl = {
        let mut badges = zustand.badges.lock().unwrap();
        let vorher = badge_count(&badges);
        if !update_badge(&mut badges, label, count) || badge_count(&badges) == vorher {
            return;
        }
        badge_count(&badges)
    };
    let alle = app.webview_windows();
    let ziel = alle
        .iter()
        .find(|(kennung, _)| kennung.as_str() != label)
        .or_else(|| alle.get_key_value(label))
        .map(|(_, fenster)| fenster);
    if let Some(Err(fehler)) = ziel.map(|fenster| fenster.set_badge_count(zahl)) {
        log::warn!("App-Badge nicht gesetzt: {fehler}");
    }
}

/// Setzt die Zahl des Fensters `label`; 0 nimmt sie heraus. Hat sich etwas geändert?
fn update_badge(badges: &mut HashMap<String, u32>, label: &str, count: u32) -> bool {
    if count == 0 {
        return badges.remove(label).is_some();
    }
    badges.insert(label.to_string(), count) != Some(count)
}

/// Die eine Zahl der App: die größte der Fenster. Mehrere Fenster desselben Einsatzes melden
/// dieselbe Zahl, eine Summe zählte sie doppelt. Ohne Zahl kein Badge (`None` nimmt es weg).
fn badge_count(badges: &HashMap<String, u32>) -> Option<i64> {
    badges.values().max().map(|&zahl| i64::from(zahl))
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
            tauri::async_runtime::spawn(async move {
                if let Err(fehler) = wechsel_per_deeplink(&handle, neu).await {
                    log::error!("Serverwechsel per Deeplink gescheitert: {fehler}");
                }
            });
        });
}

/// Nach der Bestätigung: prüfen wie die Maske (LLH-1982); ein unverträglicher Server wird nicht
/// gespeichert, ein Dialog nennt den Grund.
async fn wechsel_per_deeplink(app: &AppHandle, neu: Url) -> Result<(), String> {
    let nummer = neue_ladung(app, FENSTER);
    let ergebnis = pruefen(app, &neu).await;
    if !ladung_gilt(app, FENSTER, nummer) {
        return Ok(());
    }
    if let vertrag::Vertragsergebnis::NichtVertraeglich {
        richtung,
        server_version,
    } = &ergebnis
    {
        app.dialog()
            .message(maske_meldung(
                *richtung,
                server_version.as_deref(),
                env!("CARGO_PKG_VERSION"),
            ))
            .title("Server nicht verträglich")
            .kind(MessageDialogKind::Warning)
            .show(|_| {});
        return Ok(());
    }
    verbindung::schreiben(&konfig_dir(app), &neu).map_err(|e| e.to_string())?;
    raeume_nebenfenster(app, &neu);
    anwenden(app, FENSTER, neu, ergebnis)
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
            nicht_vertraeglich,
            update_suchen,
            drucken,
            anmeldung_im_browser,
            benachrichtigung_zeigen,
            set_app_badge
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
                zustand
                    .unvertraeglich
                    .lock()
                    .unwrap()
                    .remove(fenster.label());
                zustand.ladungen.lock().unwrap().remove(fenster.label());
                apply_badge(fenster.app_handle(), fenster.label(), 0);
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

            // Mit gespeichertem Server erst „Verbinde…“, dann die Vertragsprüfung (LLH-1982): das
            // Fenster steht sofort, auch wenn der Abruf bis zum Zeitlimit hängt.
            match verbindung::lesen(&konfig_dir(&handle)) {
                Some(server) => {
                    baue_fenster(
                        &handle,
                        FENSTER,
                        WebviewUrl::App(verbinde_pfad(&server).into()),
                        None,
                    )?;
                    let fuer_start = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(fehler) =
                            pruefe_und_lade(fuer_start, FENSTER.to_string(), server).await
                        {
                            log::error!("Start mit dem gespeicherten Server gescheitert: {fehler}");
                        }
                    });
                }
                None => {
                    baue_fenster(&handle, FENSTER, WebviewUrl::App("index.html".into()), None)?;
                }
            }

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

    /// Die Serverseite bekommt genau Druck, „Im Browser anmelden“, die native Meldung und das
    /// App-Badge; die Maske (`lokal`) weder die Anmeldung noch Meldung oder Badge, und niemand die
    /// Commands des Notification-Plugins. Die Permissions entstehen aus dem Manifest in `build.rs`.
    #[test]
    fn serverseite_darf_anmelden_und_melden_die_maske_nicht() {
        assert_eq!(
            SERVER_RECHTE,
            [
                "allow-drucken",
                "allow-anmeldung-im-browser",
                "allow-benachrichtigung-zeigen",
                "allow-set-app-badge"
            ]
        );
        // Ein Plugin-Recht trüge ein Präfix (`notification:…`).
        assert!(SERVER_RECHTE.iter().all(|recht| !recht.contains(':')));
        let erzeugt = include_str!("../permissions/autogenerated/anmeldung_im_browser.toml");
        assert!(erzeugt.contains(r#"identifier = "allow-anmeldung-im-browser""#));
        let erzeugt = include_str!("../permissions/autogenerated/benachrichtigung_zeigen.toml");
        assert!(erzeugt.contains(r#"identifier = "allow-benachrichtigung-zeigen""#));
        assert!(erzeugt.contains(r#"commands.allow = ["benachrichtigung_zeigen"]"#));
        let erzeugt = include_str!("../permissions/autogenerated/set_app_badge.toml");
        assert!(erzeugt.contains(r#"identifier = "allow-set-app-badge""#));
        assert!(erzeugt.contains(r#"commands.allow = ["set_app_badge"]"#));
        let lokal = include_str!("../capabilities/lokal.json");
        assert!(!lokal.contains("anmeldung"), "{lokal}");
        assert!(!lokal.contains("benachrichtigung"), "{lokal}");
        assert!(!lokal.contains("badge"), "{lokal}");
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

    /// Jede Desktop-Hülle nennt der Seite ihre Plattform und volle Version (LLH-1982, Spec
    /// `huellen-vertrag`); die Rückmeldung liest daraus die Oberfläche.
    #[test]
    fn kennung_nennt_plattform_und_version() {
        let skript = kennung_skript();
        assert!(
            skript.contains(&format!("platform: \"{}\"", std::env::consts::OS)),
            "{skript}"
        );
        assert!(
            skript.contains(&format!("version: \"{}\"", env!("CARGO_PKG_VERSION"))),
            "{skript}"
        );
        assert!(!skript.contains("__PLATFORM__") && !skript.contains("__VERSION__"));
    }

    /// Das Skript der Meldung läuft in jeder Hülle und ergänzt die Kennung, die
    /// `faehigkeiten.js` auf macOS ebenfalls ergänzt — keines darf das andere überschreiben.
    #[test]
    fn init_skripte_ergaenzen_dieselbe_kennung() {
        for skript in [
            include_str!("kennung.js"),
            BENACHRICHTIGUNG_SKRIPT,
            include_str!("faehigkeiten.js"),
        ] {
            assert!(
                skript.contains("...window.__LIFELINE_HUELLE__,"),
                "{skript}"
            );
        }
        assert!(BENACHRICHTIGUNG_SKRIPT.contains("ipc.invoke('benachrichtigung_zeigen'"));
        assert!(BENACHRICHTIGUNG_SKRIPT.contains("ipc.invoke('set_app_badge', { count })"));
    }

    /// Jedes Fenster meldet seine Zahl (LLH-1423); das App-Symbol trägt eine Zahl für die ganze
    /// App, die größte. 0 nimmt die Zahl des Fensters weg, ohne Zahl steht kein Badge.
    #[test]
    fn app_badge_traegt_die_groesste_zahl_der_fenster() {
        let mut badges = HashMap::new();
        assert_eq!(badge_count(&badges), None);
        assert!(update_badge(&mut badges, "main", 3));
        assert!(!update_badge(&mut badges, "main", 3), "unverändert");
        assert_eq!(badge_count(&badges), Some(3));
        // Zwei Fenster desselben Einsatzes melden dieselbe Zahl: sie zählt einmal.
        assert!(update_badge(&mut badges, "neben-1", 3));
        assert_eq!(badge_count(&badges), Some(3));
        assert!(update_badge(&mut badges, "neben-1", 5));
        assert_eq!(badge_count(&badges), Some(5));
        assert!(update_badge(&mut badges, "neben-1", 0));
        assert!(!badges.contains_key("neben-1"));
        assert_eq!(badge_count(&badges), Some(3));
        assert!(update_badge(&mut badges, "main", 0));
        assert_eq!(badge_count(&badges), None);
        assert!(!update_badge(&mut badges, "main", 0), "nichts zu nehmen");
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
            Url::parse("https://elw.local:8443/api/incidents/1/attachments/7?n=a'b\"c").unwrap();
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

    /// Die Seite „nicht verträglich“ gilt nur lokal und darf keine Adresse setzen; die Serverseite
    /// bekommt keinen ihrer Commands, die Maske nicht die Update-Suche (LLH-1982).
    #[test]
    fn anzeige_nicht_vertraeglich_ist_lokal_und_setzt_keine_adresse() {
        let anzeige: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/nicht-vertraeglich.json")).unwrap();
        assert!(anzeige.get("remote").is_none(), "{anzeige}");
        let mut rechte: Vec<&str> = anzeige["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|recht| recht.as_str().unwrap())
            .collect();
        rechte.sort_unstable();
        assert_eq!(
            rechte,
            [
                "allow-erneut-versuchen",
                "allow-nicht-vertraeglich",
                "allow-server-wechseln",
                "allow-update-suchen",
                "core:default",
            ]
        );
        let fenster = anzeige["windows"].as_array().unwrap();
        let [haupt, neben] = freigabe_fenster();
        assert!(fenster.contains(&haupt.into()) && fenster.contains(&neben.into()));
        for recht in &rechte {
            assert!(!SERVER_RECHTE.contains(recht), "{recht}");
        }
        assert!(!include_str!("../capabilities/lokal.json").contains("allow-update-suchen"));
    }

    /// Die Startseite „Verbinde…“ nennt nur die Origin, nie Pfad oder Query der Adresse.
    #[test]
    fn verbinde_seite_traegt_nur_die_origin() {
        let server = Url::parse("https://elw.local:8443/einsatz/1?q=x").unwrap();
        assert_eq!(
            verbinde_pfad(&server),
            "verbinde.html?server=https%3A%2F%2Felw.local%3A8443"
        );
    }

    /// Die Maske nennt bei einem unverträglichen Server beide Versionen und die Richtung (LLH-1982).
    #[test]
    fn maske_nennt_beide_versionen_und_die_richtung() {
        use vertrag::Richtung;
        assert_eq!(
            maske_meldung(Richtung::ZuAlt, Some("1.0.0-alpha.120"), "1.0.0-alpha.195"),
            "Der Server (Version 1.0.0-alpha.120) ist zu alt für diese App (Version 1.0.0-alpha.195)."
        );
        assert_eq!(
            maske_meldung(Richtung::ZuNeu, Some("2.0.0"), "1.0.0"),
            "Der Server (Version 2.0.0) ist neuer als diese App (Version 1.0.0). Aktualisieren Sie die App."
        );
        assert_eq!(
            maske_meldung(Richtung::ZuNeu, None, "1.0.0-alpha.195"),
            "Der Server ist neuer als diese App (Version 1.0.0-alpha.195). Aktualisieren Sie die App."
        );
    }

    /// Nur ein unverträglicher Server bleibt ungespeichert; ein heute nicht erreichbarer lässt
    /// sich weiter eintragen (LLH-1982).
    #[test]
    fn maske_speichert_nicht_erreichbaren_server() {
        use vertrag::{Richtung, ShellInfo, Vertragsergebnis};
        assert!(speichern_nach_pruefung(&Vertragsergebnis::NichtErreichbar));
        assert!(speichern_nach_pruefung(&Vertragsergebnis::Vertraeglich(
            ShellInfo {
                version: "1.0.0".into(),
                shell_contract: 1,
            }
        )));
        assert!(!speichern_nach_pruefung(
            &Vertragsergebnis::NichtVertraeglich {
                richtung: Richtung::ZuAlt,
                server_version: None,
            }
        ));
    }

    /// „Neues Fenster“ und Links öffnen einen als unverträglich erkannten Server nicht, sondern
    /// zeigen die Seite (LLH-1982).
    #[test]
    fn nebenfenster_eines_unvertraeglichen_servers_zeigt_die_seite() {
        let ziel = Url::parse("https://elw.local:8443/einsatz/1").unwrap();
        let urteil = Unvertraeglich {
            ziel: Url::parse("https://elw.local:8443/").unwrap(),
            richtung: vertrag::Richtung::ZuNeu,
            server_version: Some("2.0.0".into()),
        };
        match nebenfenster_seite(Some(&urteil), true, ziel.clone()) {
            NebenfensterStart::NichtVertraeglich(ausfall) => {
                assert_eq!(ausfall.ziel, ziel);
                assert_eq!(ausfall.richtung, vertrag::Richtung::ZuNeu);
                assert_eq!(ausfall.server_version.as_deref(), Some("2.0.0"));
            }
            NebenfensterStart::Server(_) | NebenfensterStart::Pruefen(_) => {
                panic!("unverträglicher Server geladen")
            }
        }
        assert!(matches!(
            nebenfenster_seite(None, true, ziel.clone()),
            NebenfensterStart::Server(seite) if seite == ziel
        ));
    }

    /// Eine neuere Ladung desselben Fensters macht eine ältere, noch laufende Prüfung ungültig;
    /// ein geschlossenes Fenster jede (LLH-1982, Review).
    #[test]
    fn aeltere_pruefung_wird_verworfen() {
        let zaehler = AtomicU32::new(0);
        let mut ladungen = HashMap::new();
        let alt = neue_ladung_in(&mut ladungen, &zaehler, FENSTER);
        let neu = neue_ladung_in(&mut ladungen, &zaehler, FENSTER);
        let neben = neue_ladung_in(&mut ladungen, &zaehler, "neben-1");
        assert!(!ladung_gilt_in(&ladungen, FENSTER, alt));
        assert!(ladung_gilt_in(&ladungen, FENSTER, neu));
        assert!(ladung_gilt_in(&ladungen, "neben-1", neben));
        ladungen.remove("neben-1");
        assert!(!ladung_gilt_in(&ladungen, "neben-1", neben));
    }

    /// Ein Nebenfenster für einen Server, den diese Sitzung noch nicht bestätigt hat (etwa ⌘N
    /// während der Startprüfung), prüft erst selbst (LLH-1982, Review).
    #[test]
    fn nebenfenster_eines_ungeprueften_servers_prueft_erst() {
        let ziel = Url::parse("https://elw.local:8443/einsatz/1").unwrap();
        assert!(matches!(
            nebenfenster_seite(None, false, ziel.clone()),
            NebenfensterStart::Pruefen(seite) if seite == ziel
        ));
        assert!(matches!(
            nebenfenster_seite(None, true, ziel.clone()),
            NebenfensterStart::Server(seite) if seite == ziel
        ));
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
