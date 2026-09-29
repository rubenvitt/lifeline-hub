//! Anwendungsmenü der Hülle: „Server wechseln…“ und „Nach Updates suchen…“ (desktop-huelle,
//! desktop-auslieferung) neben den Standardeinträgen.
//!
//! Keine eigenen Tastenkürzel: ein Menükürzel fängt die Taste ab, bevor die Anwendung sie sieht,
//! und die Anwendung hat eigene (Sprungpalette u. a.). „Bearbeiten“ gibt es nur auf macOS — dort
//! gehen Kopieren/Einfügen im Webview nur über Menüeinträge; WebView2 kann es selbst.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager};

const SERVER_WECHSELN: &str = "server-wechseln";
const UPDATES_SUCHEN: &str = "updates-suchen";
const NEU_LADEN: &str = "neu-laden";

pub fn bauen(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let wechseln = MenuItem::with_id(app, SERVER_WECHSELN, "Server wechseln…", true, None::<&str>)?;
    let updates = MenuItem::with_id(
        app,
        UPDATES_SUCHEN,
        "Nach Updates suchen…",
        true,
        None::<&str>,
    )?;
    // Ohne Browserleiste der einzige Weg, eine Seite nach einem Netzausfall neu anzufordern.
    let neu_laden = MenuItem::with_id(app, NEU_LADEN, "Neu laden", true, None::<&str>)?;
    let trenner = || PredefinedMenuItem::separator(app);

    #[cfg(target_os = "macos")]
    {
        let anwendung = Submenu::with_items(
            app,
            "Lifeline Hub",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("Über Lifeline Hub"), None)?,
                &updates,
                &trenner()?,
                &wechseln,
                &trenner()?,
                &PredefinedMenuItem::services(app, Some("Dienste"))?,
                &trenner()?,
                &PredefinedMenuItem::hide(app, Some("Lifeline Hub ausblenden"))?,
                &PredefinedMenuItem::hide_others(app, Some("Andere ausblenden"))?,
                &PredefinedMenuItem::show_all(app, Some("Alle einblenden"))?,
                &trenner()?,
                &PredefinedMenuItem::quit(app, Some("Lifeline Hub beenden"))?,
            ],
        )?;
        let bearbeiten = Submenu::with_items(
            app,
            "Bearbeiten",
            true,
            &[
                &PredefinedMenuItem::undo(app, Some("Widerrufen"))?,
                &PredefinedMenuItem::redo(app, Some("Wiederholen"))?,
                &trenner()?,
                &PredefinedMenuItem::cut(app, Some("Ausschneiden"))?,
                &PredefinedMenuItem::copy(app, Some("Kopieren"))?,
                &PredefinedMenuItem::paste(app, Some("Einsetzen"))?,
                &PredefinedMenuItem::select_all(app, Some("Alles auswählen"))?,
            ],
        )?;
        let fenster = Submenu::with_items(
            app,
            "Fenster",
            true,
            &[
                &neu_laden,
                &trenner()?,
                &PredefinedMenuItem::minimize(app, Some("Im Dock ablegen"))?,
                &PredefinedMenuItem::maximize(app, Some("Zoomen"))?,
                &PredefinedMenuItem::fullscreen(app, Some("Vollbild"))?,
                &trenner()?,
                &PredefinedMenuItem::close_window(app, Some("Fenster schließen"))?,
            ],
        )?;
        Menu::with_items(app, &[&anwendung, &bearbeiten, &fenster])
    }

    #[cfg(not(target_os = "macos"))]
    {
        let anwendung = Submenu::with_items(
            app,
            "Lifeline Hub",
            true,
            &[
                &wechseln,
                &neu_laden,
                &updates,
                &trenner()?,
                &PredefinedMenuItem::quit(app, Some("Beenden"))?,
            ],
        )?;
        Menu::with_items(app, &[&anwendung])
    }
}

pub fn behandeln(app: &AppHandle, ereignis: MenuEvent) {
    match ereignis.id().as_ref() {
        SERVER_WECHSELN => crate::zeige_maske(app, None),
        UPDATES_SUCHEN => crate::update::auf_wunsch_pruefen(app.clone()),
        // Das Fenster mit Fokus — mit Nebenfenstern (LFH-782) ist das nicht immer das Hauptfenster.
        NEU_LADEN => {
            let fenster = app
                .webview_windows()
                .into_values()
                .find(|fenster| fenster.is_focused().unwrap_or(false))
                .or_else(|| app.get_webview_window(crate::FENSTER));
            if let Some(fenster) = fenster {
                let _ = fenster.reload();
            }
        }
        _ => {}
    }
}
