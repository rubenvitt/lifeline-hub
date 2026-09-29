// Gerüst; die Verdrahtung folgt (LFH-721, tasks.md Gruppe 3).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod adresse;
mod deeplink;
mod verbindung;

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Tauri-Lauf");
}
