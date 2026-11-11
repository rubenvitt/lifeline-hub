//! Update der Hülle (desktop-auslieferung). Quelle ist `latest.json`: für eine stabile Hülle am
//! neuesten STABILEN Release (Endpunkt in `tauri.conf.json`), für eine Hülle im Alpha- oder
//! Beta-Kanal das Manifest des Kanals (`ALPHA_KANAL`, `BETA_KANAL`, `kanal.rs`, LLH-1280,
//! LLH-1545). Die Signatur prüft der Updater in jedem Fall gegen den öffentlichen Schlüssel aus
//! `tauri.conf.json`.
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

/// Manifeste der Vorabkanäle, fortgeschrieben vom Job `desktop-kanal` in `artefakte.yml`. Jedes
/// zeigt auf das neueste veröffentlichte Release seines Kanals mit Desktop-Paketen, auch auf ein
/// stabiles (`scripts/release/desktop-kanal.mjs`).
const ALPHA_KANAL: &str =
    "https://github.com/rubenvitt/lifeline-hub/releases/download/desktop-alpha/latest.json";
const BETA_KANAL: &str =
    "https://github.com/rubenvitt/lifeline-hub/releases/download/desktop-beta/latest.json";

/// Das Manifest eines Vorabkanals; `None` für stabil (Endpunkt aus `tauri.conf.json`).
fn kanal_manifest(kanal: Kanal) -> Option<&'static str> {
    match kanal {
        Kanal::Stabil => None,
        Kanal::Alpha => Some(ALPHA_KANAL),
        Kanal::Beta => Some(BETA_KANAL),
    }
}

/// Der Updater für den Kanal der Hülle (`kanal.rs`). Ein Vorabkanal wird gemerkt, damit die
/// Hülle nach einem stabilen Update dort bleibt; scheitert das Merken, prüft sie trotzdem.
fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    let mut builder = app.updater_builder().timeout(FRIST);
    let konfig_dir = app.path().app_config_dir().ok();
    let gemerkt = konfig_dir.as_deref().and_then(kanal::lesen);
    let kanal = kanal::bestimmen(&app.package_info().version.to_string(), gemerkt);
    if let Some(manifest) = kanal_manifest(kanal) {
        if let Some(dir) = konfig_dir.as_deref().filter(|_| gemerkt != Some(kanal)) {
            if let Err(fehler) = kanal::schreiben(dir, kanal) {
                log::warn!("Update-Kanal nicht gemerkt: {fehler}");
            }
        }
        builder = builder.endpoints(vec![tauri::Url::parse(manifest)?])?;
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
    fn vorabkanaele_sind_https_und_parsebar() {
        for (kanal, release) in [
            (Kanal::Alpha, "desktop-alpha"),
            (Kanal::Beta, "desktop-beta"),
        ] {
            let url =
                tauri::Url::parse(kanal_manifest(kanal).expect("Vorabkanal")).expect("feste URL");
            assert_eq!(url.scheme(), "https");
            assert!(url
                .path()
                .ends_with(&format!("/releases/download/{release}/latest.json")));
        }
    }

    #[test]
    fn stabil_liest_den_endpunkt_aus_der_konfiguration() {
        assert_eq!(kanal_manifest(Kanal::Stabil), None);
    }
}
