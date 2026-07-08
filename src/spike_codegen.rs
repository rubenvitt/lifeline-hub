//! LFH-120 Spike (temporär): verifiziert die utoipa → openapi-typescript-Pipeline an
//! repräsentativen Typen, bevor der Big-Bang über alle ~105 Response-Typen läuft.
//!
//! Abgedeckte Risiko-Fälle:
//! - flatten-Composite (`UhsDetail` mit `#[serde(flatten)]`)
//! - Enum-Wert-Override (`UhsAnzeige.typ: String` → `#[schema(value_type = UhsTyp)]`)
//! - echt serialisiertes Enum (`FachebeneStatus`, `rename_all = "lowercase"`)
//! - `serde_json::Value` (`FachebeneAntwort.features`)
//! - Option-Nullability über die diversen `Option<…>`-Felder
//!
//! Dieses Modul wird nach Abschluss des Spikes wieder entfernt.

use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(components(schemas(
    crate::uhs::UhsTyp,
    crate::uhs::UhsStatus,
    crate::uhs::UhsAnzeige,
    crate::uhs::PlatzAnzeige,
    crate::uhs::BelegungAnzeige,
    crate::material::EinsatzMaterialAnzeige,
    crate::routes::einsatz_uhs::UhsDetail,
    crate::karte::typen::FachebeneStatus,
    crate::karte::typen::FachebeneAntwort,
)))]
struct SpikeApi;

#[test]
fn emit_spike_openapi() {
    let json = SpikeApi::openapi()
        .to_pretty_json()
        .expect("OpenAPI-JSON serialisieren");
    std::fs::write("target/spike-openapi.json", &json).expect("spike-openapi.json schreiben");
    eprintln!("spike-openapi.json geschrieben ({} Bytes)", json.len());
}
