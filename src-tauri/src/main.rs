//! Desktop-Hülle von Lifeline Hub (LFH-721, Variante A aus LFH-720): der Webview lädt die
//! https-Adresse des Einsatzservers. Die Hülle bringt Fenster, Erststart, Deeplink, Druck,
//! Update — keine zweite Anwendungslogik. Anforderungen: `openspec/specs/desktop-huelle/` und
//! `openspec/specs/desktop-auslieferung/`; Entscheidungen im Design des Changes LFH-721.
//!
//! RECHTE: Die lokale Erststart-Maske darf die Adresse setzen (Capability `lokal`). Die
//! Serverseite bekommt zur Laufzeit genau für ihre Origin nur `drucken` — sie kann die Hülle
//! nicht auf einen anderen Server umlenken.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adresse;
mod deeplink;
mod menue;
mod update;
mod verbindung;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::adresse::pruefe_adresse;
use crate::deeplink::{deute, entscheide, Aktion};

const FENSTER: &str = "main";

/// Adresse der lokalen Maske im Webview. Tauri liefert eigene Seiten je Plattform unter einer
/// anderen Origin aus (WebView2 kennt kein eigenes Schema).
#[cfg(windows)]
const MASKE: &str = "http://tauri.localhost/index.html";
#[cfg(not(windows))]
const MASKE: &str = "tauri://localhost/index.html";

/// `window.print()` erreicht in WKWebView keinen Dialog (LFH-720, Befund 17) — auf macOS
/// leitet die Hülle den Aufruf auf den nativen Druck um.
#[cfg(target_os = "macos")]
const DRUCK_SKRIPT: &str = include_str!("druck.js");

/// Was die Maske beim Öffnen zeigt.
#[derive(Clone, Default, Serialize)]
struct Vorbelegung {
    /// Vorbelegte Adresse: aus einem Deeplink oder die gespeicherte beim Wechsel.
    adresse: Option<String>,
    /// Es gibt eine gespeicherte Adresse, zu der „Abbrechen“ zurückführt.
    abbrechbar: bool,
}

#[derive(Default)]
struct Zustand {
    vorbelegung: Mutex<Vorbelegung>,
}

fn konfig_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("Konfigurationsverzeichnis der Hülle")
}

fn fenster(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(FENSTER)
}

/// Gibt der Serverseite zur Laufzeit genau ihre Origin frei — und dort nur `drucken`.
fn server_freigeben(app: &AppHandle, server: &Url) {
    let origin = server.origin().ascii_serialization();
    let kennung = format!(
        "server-{}",
        origin.replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );
    let capability = tauri::ipc::CapabilityBuilder::new(kennung)
        .remote(format!("{origin}/*"))
        .window(FENSTER)
        .permission("allow-drucken");
    if let Err(fehler) = app.add_capability(capability) {
        // Ohne Freigabe fehlt nur der native Druck; die Anwendung selbst läuft.
        log::warn!("Freigabe für {origin} nicht gesetzt: {fehler}");
    }
}

fn lade_server(app: &AppHandle, server: &Url) -> Result<(), String> {
    server_freigeben(app, server);
    let fenster = fenster(app).ok_or("Hauptfenster fehlt")?;
    fenster.navigate(server.clone()).map_err(|e| e.to_string())
}

/// Öffnet die Erststart-Maske, vorbelegt mit `adresse` (sonst mit der gespeicherten).
pub(crate) fn zeige_maske(app: &AppHandle, adresse: Option<Url>) {
    let gespeichert = verbindung::lesen(&konfig_dir(app));
    let vorbelegung = Vorbelegung {
        adresse: adresse.or_else(|| gespeichert.clone()).map(String::from),
        abbrechbar: gespeichert.is_some(),
    };
    *app.state::<Zustand>().vorbelegung.lock().unwrap() = vorbelegung;
    if let Some(fenster) = fenster(app) {
        let _ = fenster.navigate(MASKE.parse().expect("Adresse der Maske"));
        let _ = fenster.set_focus();
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

/// Serverseite (nur macOS genutzt): nativer Druckdialog für die aktuelle Seite.
#[tauri::command]
fn drucken(fenster: WebviewWindow) -> Result<(), String> {
    fenster.print().map_err(|e| e.to_string())
}

// ── Deeplink ─────────────────────────────────────────────────────────────────────────

fn deeplinks_verarbeiten(app: &AppHandle, links: Vec<Url>) {
    for link in links {
        let Some(ziel) = deute(&link) else {
            log::info!("Deeplink verworfen: {link}");
            continue;
        };
        let gespeichert = verbindung::lesen(&konfig_dir(app));
        match entscheide(gespeichert.as_ref(), &ziel) {
            Aktion::Vorbelegen(ziel) => zeige_maske(app, Some(ziel)),
            Aktion::Bestaetigen(ziel) => bestaetige_wechsel(app, gespeichert, ziel),
            Aktion::Nichts => {
                if let Some(fenster) = fenster(app) {
                    let _ = fenster.set_focus();
                }
            }
        }
    }
}

/// Ein Link will auf einen anderen Server umschalten: nur mit Bestätigung, die beide Adressen
/// nennt (desktop-huelle: „Ein Serverwechsel per Deeplink wird bestätigt“).
fn bestaetige_wechsel(app: &AppHandle, alt: Option<Url>, neu: Url) {
    let alt = alt.map(String::from).unwrap_or_default();
    let text = format!(
        "Mit dem Server {neu} verbinden?\n\nDie bisherige Verbindung {alt} wird ersetzt. \
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
            if let Some(fenster) = fenster(app) {
                let _ = fenster.unminimize();
                let _ = fenster.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Zustand::default())
        .invoke_handler(tauri::generate_handler![
            vorbelegung,
            verbinden,
            abbrechen,
            drucken
        ])
        .menu(menue::bauen)
        .on_menu_event(menue::behandeln)
        .setup(|app| {
            let handle = app.handle().clone();

            #[cfg(any(windows, target_os = "linux"))]
            {
                // Im Entwicklungslauf das Schema selbst registrieren; installiert trägt es
                // der Installer ein.
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

            let builder = WebviewWindowBuilder::new(app, FENSTER, start)
                .title("Lifeline Hub")
                .inner_size(1366.0, 860.0)
                .min_inner_size(800.0, 560.0)
                // Downloads: Vorgabeverhalten beider Webviews — Download-Ordner, Umlaute
                // erhalten, Dubletten mit Zählzusatz (gemessen in LFH-720, Befund 14).
                .on_download(|_fenster, ereignis| {
                    if let DownloadEvent::Finished { url, success, .. } = ereignis {
                        log::info!(
                            "Download {url}: {}",
                            if success { "fertig" } else { "gescheitert" }
                        );
                    }
                    true
                });
            #[cfg(target_os = "macos")]
            let builder = builder
                // WKWebView suspendiert ein verdecktes Fenster nach ~3 s, Live-Ereignisse
                // stauen sich dann minutenlang (LFH-720, Befund 7).
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                .initialization_script(DRUCK_SKRIPT);
            builder.build()?;

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
    /// Die Hülle trägt die Anwendungsversion; ihr Updater vergleicht sie mit `latest.json`.
    /// Beide setzt `prepareCmd` in `release.config.mjs` — fehlt dort `-p lifeline-desktop`,
    /// driftet die Hülle still und bietet jedes Update erneut an.
    #[test]
    fn version_gleich_der_anwendungsversion() {
        let wurzel = include_str!("../../Cargo.toml");
        let paket = wurzel
            .split("[package]")
            .nth(1)
            .expect("[package] in der Wurzel-Cargo.toml");
        let version = paket
            .lines()
            .find_map(|zeile| zeile.strip_prefix("version = \""))
            .and_then(|rest| rest.strip_suffix('"'))
            .expect("version im [package] der Wurzel");
        assert_eq!(env!("CARGO_PKG_VERSION"), version);
    }
}
