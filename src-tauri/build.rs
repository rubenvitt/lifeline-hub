fn main() {
    // Die App-Commands als Manifest melden: daraus entstehen Permissions (`allow-verbinden` …),
    // und ein Command ist nur dort aufrufbar, wo eine Capability ihn freigibt. Ohne Manifest
    // wäre jeder Command für jede Seite offen, der die IPC-Brücke zusteht.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "verbinden",
            "abbrechen",
            "vorbelegung",
            "drucken",
            "anmeldung_im_browser",
        ]),
    ))
    .expect("tauri-build");
}
