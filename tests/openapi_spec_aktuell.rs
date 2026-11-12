use utoipa::OpenApi;

/// Das Dokument des Frontends bleibt ohne Pfade (ADR-0004, ADR-0022): Pfade mit Vertrag hat nur
/// die öffentliche API (`docs/api/public-v1.json`).
#[test]
fn frontend_dokument_hat_keine_pfade() {
    let dok = lifeline_hub::api_doc::ApiDoc::openapi();
    assert!(
        dok.paths.paths.is_empty(),
        "src/api_doc.rs hat Pfade: {:?}",
        dok.paths.paths.keys().collect::<Vec<_>>()
    );
}

#[test]
fn openapi_json_ist_aktuell() {
    let aktuell = lifeline_hub::api_doc::ApiDoc::openapi()
        .to_pretty_json()
        .unwrap();
    let pfad = concat!(env!("CARGO_MANIFEST_DIR"), "/frontend/src/api/openapi.json");
    let alt = std::fs::read_to_string(pfad).unwrap_or_default();
    if alt.trim() != aktuell.trim() {
        std::fs::write(pfad, format!("{}\n", aktuell)).unwrap();
        panic!("openapi.json war veraltet — neu geschrieben, bitte committen.");
    }
}
