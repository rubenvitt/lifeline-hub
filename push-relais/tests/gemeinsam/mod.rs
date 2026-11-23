//! Hilfen für die Integrationstests: Wegwerf-Schlüssel und ein `ApnsClient` gegen eine Test-Basis.
#![allow(dead_code)]
use clap::Parser;
use openssl::{ec::EcKey, nid::Nid, pkey::PKey};
use push_relais::{apns::ApnsClient, config::RelaisConfig};
use std::sync::atomic::{AtomicU32, Ordering};

static ZAEHLER: AtomicU32 = AtomicU32::new(0);

/// Schreibt einen frisch erzeugten P-256-Schlüssel als PKCS#8-PEM (wie eine `.p8`-Datei) in eine
/// Wegwerf-Datei. Nie ein echter Schlüssel.
pub fn schluessel_datei() -> std::path::PathBuf {
    let ec =
        EcKey::generate(&openssl::ec::EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).unwrap())
            .unwrap();
    let pem = PKey::from_ec_key(ec)
        .unwrap()
        .private_key_to_pem_pkcs8()
        .unwrap();
    let pfad = std::env::temp_dir().join(format!(
        "push-relais-test-{}-{}.p8",
        std::process::id(),
        ZAEHLER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&pfad, pem).unwrap();
    pfad
}

pub fn config(basis: &str) -> RelaisConfig {
    let pfad = schluessel_datei();
    RelaisConfig::parse_from([
        "push-relais",
        "--apns-schluessel",
        pfad.to_str().unwrap(),
        "--apns-key-id",
        "KEYID12345",
        "--apns-team-id",
        "TEAMID1234",
        "--apns-basis-production",
        basis,
        "--apns-basis-sandbox",
        basis,
    ])
}

pub fn apns_client(basis: &str) -> ApnsClient {
    ApnsClient::neu(&config(basis)).unwrap()
}
