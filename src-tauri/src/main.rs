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
mod links;
mod menue;
mod update;
mod verbindung;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::adresse::pruefe_adresse;
use crate::deeplink::{deute, entscheide, Aktion};
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
    /// Origins, deren Freigabe schon gesetzt ist. Tauri kennt kein Zurücknehmen einer
    /// Laufzeit-Capability: nach einem Serverwechsel behält die alte Origin bis zum Neustart
    /// `drucken` — mehr nicht, die Adresse ändern kann auch sie nicht.
    freigegeben: Mutex<HashSet<String>>,
    /// Zähler für die Kennung des nächsten Nebenfensters.
    nebenfenster: AtomicU32,
}

fn konfig_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .expect("Konfigurationsverzeichnis der Hülle")
}

fn fenster(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(FENSTER)
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

/// Gibt der Serverseite zur Laufzeit genau ihre Origin frei — und dort nur `drucken`.
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
    let capability = tauri::ipc::CapabilityBuilder::new(kennung)
        .remote(muster.clone())
        .windows(freigabe_fenster())
        .permission("allow-drucken");
    if let Err(fehler) = app.add_capability(capability) {
        // Ohne Freigabe fehlt nur der native Druck; die Anwendung selbst läuft.
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
    // Entwurf verlöre sonst, was der Autosave noch nicht hat.
    for (label, nebenfenster) in app.webview_windows() {
        let bleibt = nebenfenster
            .url()
            .is_ok_and(|seite| links::gehoert_zum_server(server, &seite));
        if label.starts_with(NEBENFENSTER_PRAEFIX) && !bleibt {
            let _ = nebenfenster.close();
        }
    }
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

// ── Fenster und Links ────────────────────────────────────────────────────────────────

/// Baut ein Fenster der Hülle — das Hauptfenster wie jedes Nebenfenster, damit Link-Behandlung,
/// Drosselung und Druckweg überall gleich sind.
fn baue_fenster(app: &AppHandle, label: &str, start: WebviewUrl) -> tauri::Result<WebviewWindow> {
    let (fuer_fenster, fuer_navigation) = (app.clone(), app.clone());
    let (label_fenster, label_navigation) = (label.to_string(), label.to_string());
    let builder = WebviewWindowBuilder::new(app, label, start)
        .title("Lifeline Hub")
        .inner_size(1366.0, 860.0)
        .min_inner_size(800.0, 560.0)
        // Im Protokoll steht, welche Seite geladen wurde — beim Support die erste Frage
        // („Maske oder Server? Welcher?“).
        .on_page_load(|_fenster, seite| {
            if matches!(seite.event(), tauri::webview::PageLoadEvent::Finished) {
                log::info!("Seite geladen: {}", fuers_protokoll(seite.url()));
            }
        })
        // Downloads: Vorgabeverhalten beider Webviews — Download-Ordner, Umlaute
        // erhalten, Dubletten mit Zählzusatz (gemessen in LFH-720, Befund 14).
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
        .on_navigation(move |ziel| navigation(&fuer_navigation, &label_navigation, ziel));
    #[cfg(target_os = "macos")]
    let builder = builder
        // WKWebView suspendiert ein verdecktes Fenster nach ~3 s, Live-Ereignisse
        // stauen sich dann minutenlang (LFH-720, Befund 7).
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .initialization_script(DRUCK_SKRIPT);
    builder.build()
}

/// Der verbundene Server — bei jedem Aufruf frisch, er wechselt zur Laufzeit.
fn verbundener_server(app: &AppHandle) -> Option<Url> {
    verbindung::lesen(&konfig_dir(app))
}

fn neues_fenster(app: &AppHandle, label: &str, ziel: Url) {
    match links::entscheide_neues_fenster(verbundener_server(app).as_ref(), &ziel) {
        Ziel::Nebenfenster => {
            // Nicht im Handler selbst bauen: der läuft im Ereignis des Webviews, und ein
            // synchroner Fensterbau darin blockiert unter Windows.
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let nummer = app
                    .state::<Zustand>()
                    .nebenfenster
                    .fetch_add(1, Ordering::Relaxed)
                    + 1;
                let label = nebenfenster_label(nummer);
                match baue_fenster(&app, &label, WebviewUrl::External(ziel)) {
                    Ok(fenster) => {
                        let _ = fenster.set_focus();
                    }
                    Err(fehler) => log::error!("Nebenfenster {label} nicht gebaut: {fehler}"),
                }
            });
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
        // Ohne Hauptfenster liefen Maske, Deeplink und Serverwechsel ins Leere: es geht, und die
        // Nebenfenster gehen mit — die App endet, statt kopflos weiterzulaufen.
        .on_window_event(|fenster, ereignis| {
            if fenster.label() == FENSTER && matches!(ereignis, tauri::WindowEvent::Destroyed) {
                for (label, nebenfenster) in fenster.app_handle().webview_windows() {
                    if label.starts_with(NEBENFENSTER_PRAEFIX) {
                        let _ = nebenfenster.close();
                    }
                }
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

            baue_fenster(&handle, FENSTER, start)?;

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
