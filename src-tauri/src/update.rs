//! Update der Hülle (desktop-auslieferung). Quelle ist `latest.json`: für eine stabile Hülle am
//! neuesten STABILEN Release (Endpunkt in `tauri.conf.json`), für eine Hülle im Alpha-Kanal
//! (`ALPHA_KANAL`, `kanal.rs`, LLH-1280). Die Signatur prüft der Updater in beiden Fällen gegen
//! den öffentlichen Schlüssel aus `tauri.conf.json`.
//!
//! Nie ohne Zustimmung, und zweimal gefragt: erst ob geladen wird, dann — wenn das Update da
//! ist — ob JETZT neu gestartet wird. Der Download dauert im ELW-Uplink Sekunden bis Minuten, und
//! ein Neustart ohne Ankündigung verlöre, was in der Zwischenzeit getippt wurde (ein harter
//! Neustart löst kein `beforeunload` aus). Unter Windows beendet der Installer die Hülle selbst.
//! Geprüft wird einmal nach dem Start und auf Wunsch über das Menü — nicht wiederkehrend, damit
//! kein Dialog in die laufende Arbeit fällt. Eine Sperre hält beide Wege auseinander.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::kanal::{self, Kanal};

/// Obergrenze für die Prüfung. Im Einsatz-LAN ohne Internet endet sie sonst erst mit dem
/// TCP-Timeout des Systems.
const FRIST: Duration = Duration::from_secs(10);

/// Manifest des Alpha-Kanals, fortgeschrieben vom Job `desktop-kanal` in `artefakte.yml`. Es
/// zeigt auf das neueste veröffentlichte Release mit Desktop-Paketen, auch auf ein stabiles.
const ALPHA_KANAL: &str =
    "https://github.com/rubenvitt/lifeline-hub/releases/download/desktop-alpha/latest.json";

/// Der Updater für den Kanal der Hülle (`kanal.rs`): Alpha liest `ALPHA_KANAL`, stabil den
/// Endpunkt aus `tauri.conf.json`. Ein Alpha-Kanal wird gemerkt, damit die Hülle nach einem
/// stabilen Update dort bleibt; scheitert das Merken, prüft sie trotzdem.
fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    let mut builder = app.updater_builder().timeout(FRIST);
    let konfig_dir = app.path().app_config_dir().ok();
    let gemerkt = konfig_dir.as_deref().and_then(kanal::lesen);
    let kanal = kanal::bestimmen(&app.package_info().version.to_string(), gemerkt);
    if kanal == Kanal::Alpha {
        if let (Some(dir), None) = (&konfig_dir, gemerkt) {
            if let Err(fehler) = kanal::schreiben(dir, Kanal::Alpha) {
                log::warn!("Update-Kanal nicht gemerkt: {fehler}");
            }
        }
        builder = builder.endpoints(vec![tauri::Url::parse(ALPHA_KANAL)?])?;
    }
    builder.build()
}

/// Läuft gerade eine Prüfung, ein Dialog oder ein Download? Dann startet kein zweiter.
static LAEUFT: AtomicBool = AtomicBool::new(false);

/// Hält die Sperre, bis der Ablauf endet — auch wenn er unterwegs abbricht.
struct Sperre;

impl Sperre {
    fn nehmen() -> Option<Sperre> {
        (!LAEUFT.swap(true, Ordering::SeqCst)).then_some(Sperre)
    }
}

impl Drop for Sperre {
    fn drop(&mut self) {
        LAEUFT.store(false, Ordering::SeqCst);
    }
}

/// Nach dem Start: still bei Fehlern und wenn nichts Neues da ist.
pub fn im_hintergrund_pruefen(app: AppHandle) {
    tauri::async_runtime::spawn(pruefen(app, false));
}

/// Aus dem Menü: meldet auch „aktuell“ und „nicht erreichbar“.
pub fn auf_wunsch_pruefen(app: AppHandle) {
    tauri::async_runtime::spawn(pruefen(app, true));
}

async fn pruefen(app: AppHandle, auf_wunsch: bool) {
    let Some(sperre) = Sperre::nehmen() else {
        return;
    };
    let ergebnis = match updater(&app) {
        Ok(updater) => updater.check().await,
        Err(fehler) => Err(fehler),
    };
    match ergebnis {
        Ok(Some(update)) => anbieten(app, update, sperre),
        Ok(None) => {
            if auf_wunsch {
                let version = app.package_info().version.to_string();
                melden(
                    &app,
                    MessageDialogKind::Info,
                    format!("Sie verwenden die aktuelle Version ({version})."),
                );
            }
        }
        Err(fehler) => {
            log::info!("Update-Prüfung nicht möglich: {fehler}");
            if auf_wunsch {
                melden(
                    &app,
                    MessageDialogKind::Warning,
                    format!(
                        "Die Update-Prüfung war nicht möglich ({fehler}). Ohne Internetverbindung \
                         ist das im Einsatz normal; Lifeline Hub läuft unverändert weiter."
                    ),
                );
            }
        }
    }
}

fn anbieten(app: AppHandle, update: Update, sperre: Sperre) {
    let text = format!(
        "Lifeline Hub {} ist verfügbar (installiert: {}).\n\nDas Update wird im Hintergrund \
         geladen; vor dem Neustart fragt die App noch einmal.",
        update.version, update.current_version
    );
    let handle = app.clone();
    app.dialog()
        .message(text)
        .title("Update verfügbar")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Laden".into(),
            "Später".into(),
        ))
        .show(move |zugestimmt| {
            if zugestimmt {
                tauri::async_runtime::spawn(laden(handle, update, sperre));
            }
        });
}

async fn laden(app: AppHandle, update: Update, sperre: Sperre) {
    // `download` prüft die Signatur gegen den Pubkey aus tauri.conf.json: ein manipuliertes
    // Archiv endet hier, vor jeder Neustart-Frage, und nichts wird ersetzt.
    match update.download(|_, _| {}, || {}).await {
        Ok(paket) => neustart_anbieten(app, update, paket, sperre),
        Err(fehler) => gescheitert(&app, &update, &fehler.to_string()),
    }
}

fn neustart_anbieten(app: AppHandle, update: Update, paket: Vec<u8>, sperre: Sperre) {
    let text = format!(
        "Lifeline Hub {} ist geladen.\n\nJetzt neu starten? Nicht gespeicherte Eingaben gehen \
         dabei verloren. Mit „Später“ wird das Update verworfen und beim nächsten Start wieder \
         angeboten.",
        update.version
    );
    let handle = app.clone();
    app.dialog()
        .message(text)
        .title("Update bereit")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Jetzt neu starten".into(),
            "Später".into(),
        ))
        .show(move |zugestimmt| {
            let _sperre = sperre;
            if !zugestimmt {
                return;
            }
            match update.install(paket) {
                Ok(()) => handle.restart(),
                Err(fehler) => gescheitert(&handle, &update, &fehler.to_string()),
            }
        });
}

fn gescheitert(app: &AppHandle, update: &Update, fehler: &str) {
    log::error!("Update auf {} gescheitert: {fehler}", update.version);
    melden(
        app,
        MessageDialogKind::Error,
        format!(
            "Das Update auf {} ließ sich nicht installieren ({fehler}). Lifeline Hub läuft in \
             Version {} weiter.",
            update.version, update.current_version
        ),
    );
}

fn melden(app: &AppHandle, art: MessageDialogKind, text: String) {
    app.dialog()
        .message(text)
        .title("Lifeline Hub")
        .kind(art)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_kanal_ist_https_und_parsebar() {
        let url = tauri::Url::parse(ALPHA_KANAL).expect("feste URL");
        assert_eq!(url.scheme(), "https");
        assert!(url
            .path()
            .ends_with("/releases/download/desktop-alpha/latest.json"));
    }
}
