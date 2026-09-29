//! Update der Hülle (desktop-auslieferung). Quelle ist `latest.json` am neuesten STABILEN
//! Release (Endpunkt in `tauri.conf.json`); die Signatur prüft der Updater gegen den dort
//! hinterlegten öffentlichen Schlüssel.
//!
//! Nie ohne Zustimmung: das Update startet die Hülle neu (unter Windows beendet sie der
//! Installer selbst), und das darf nicht mitten in einer Lage passieren. Geprüft wird einmal
//! nach dem Start und auf Wunsch über das Menü — nicht wiederkehrend, damit kein Dialog in die
//! laufende Arbeit fällt.

use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Obergrenze für die Prüfung. Im Einsatz-LAN ohne Internet endet sie sonst erst mit dem
/// TCP-Timeout des Systems.
const FRIST: Duration = Duration::from_secs(10);

/// Nach dem Start: still bei Fehlern und wenn nichts Neues da ist.
pub fn im_hintergrund_pruefen(app: AppHandle) {
    tauri::async_runtime::spawn(pruefen(app, false));
}

/// Aus dem Menü: meldet auch „aktuell“ und „nicht erreichbar“.
pub fn auf_wunsch_pruefen(app: AppHandle) {
    tauri::async_runtime::spawn(pruefen(app, true));
}

async fn pruefen(app: AppHandle, auf_wunsch: bool) {
    let ergebnis = match app.updater_builder().timeout(FRIST).build() {
        Ok(updater) => updater.check().await,
        Err(fehler) => Err(fehler),
    };
    match ergebnis {
        Ok(Some(update)) => anbieten(app, update),
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

fn anbieten(app: AppHandle, update: Update) {
    let text = format!(
        "Lifeline Hub {} ist verfügbar (installiert: {}).\n\nDas Update startet die App neu. \
         Aktualisieren Sie nicht mitten in einer laufenden Eingabe.",
        update.version, update.current_version
    );
    let handle = app.clone();
    app.dialog()
        .message(text)
        .title("Update verfügbar")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Aktualisieren".into(),
            "Später".into(),
        ))
        .show(move |zugestimmt| {
            if zugestimmt {
                tauri::async_runtime::spawn(installieren(handle, update));
            }
        });
}

async fn installieren(app: AppHandle, update: Update) {
    // Scheitert die Signaturprüfung, liefert `download_and_install` einen Fehler und
    // installiert nichts.
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(fehler) => {
            log::error!("Update auf {} gescheitert: {fehler}", update.version);
            melden(
                &app,
                MessageDialogKind::Error,
                format!(
                    "Das Update auf {} ließ sich nicht installieren ({fehler}). Lifeline Hub \
                     läuft in Version {} weiter.",
                    update.version, update.current_version
                ),
            );
        }
    }
}

fn melden(app: &AppHandle, art: MessageDialogKind, text: String) {
    app.dialog()
        .message(text)
        .title("Lifeline Hub")
        .kind(art)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}
