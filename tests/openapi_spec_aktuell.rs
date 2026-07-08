use utoipa::OpenApi;

#[test]
fn openapi_json_ist_aktuell() {
    let aktuell = lifeline_hub::api_doc::ApiDoc::openapi().to_pretty_json().unwrap();
    let pfad = concat!(env!("CARGO_MANIFEST_DIR"), "/frontend/src/api/openapi.json");
    let alt = std::fs::read_to_string(pfad).unwrap_or_default();
    if alt.trim() != aktuell.trim() {
        std::fs::write(pfad, format!("{}\n", aktuell)).unwrap();
        panic!("openapi.json war veraltet — neu geschrieben, bitte committen.");
    }
}
