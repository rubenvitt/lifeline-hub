//! Drift-Test des öffentlichen Dokuments (LLH-1653): `docs/api/public-v1.json` ist das Dokument,
//! das `GET /api/v1/openapi.json` ausliefert. Weicht es ab, schreibt der Test die Datei neu und
//! scheitert; `scripts/check-typ-codegen.sh` prüft danach mit `git diff --exit-code`.

#[test]
fn public_v1_json_ist_aktuell() {
    let aktuell = lifeline_hub::public_api::dokument()
        .to_pretty_json()
        .unwrap();
    let pfad = concat!(env!("CARGO_MANIFEST_DIR"), "/docs/api/public-v1.json");
    let alt = std::fs::read_to_string(pfad).unwrap_or_default();
    if alt.trim() != aktuell.trim() {
        std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/docs/api")).unwrap();
        std::fs::write(pfad, format!("{}\n", aktuell)).unwrap();
        panic!("docs/api/public-v1.json war veraltet — neu geschrieben, bitte committen.");
    }
}
