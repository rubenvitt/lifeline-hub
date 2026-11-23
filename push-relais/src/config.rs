use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(version, about = "push-relais — APNs-Relais für Lifeline-Server")]
pub struct RelaisConfig {
    #[arg(long, env = "PUSH_RELAIS_BIND", default_value = "0.0.0.0:8089")]
    pub bind: String,
    /// Pfad der SQLite-Datei (`:memory:` für Tests).
    #[arg(
        long,
        env = "PUSH_RELAIS_DATENBANK",
        default_value = "push-relais.sqlite"
    )]
    pub datenbank: String,
    /// Apple-Schlüssel (`.p8`).
    #[arg(
        long,
        env = "PUSH_RELAIS_APNS_SCHLUESSEL",
        default_value = "AuthKey.p8"
    )]
    pub apns_schluessel: PathBuf,
    #[arg(long, env = "PUSH_RELAIS_APNS_KEY_ID", default_value = "")]
    pub apns_key_id: String,
    #[arg(long, env = "PUSH_RELAIS_APNS_TEAM_ID", default_value = "")]
    pub apns_team_id: String,
    #[arg(
        long,
        env = "PUSH_RELAIS_BUNDLE_ID",
        default_value = "dev.rubeen.lifeline.ios"
    )]
    pub bundle_id: String,
    /// Nachrichten je Server und Minute.
    #[arg(long, env = "PUSH_RELAIS_LIMIT_MINUTE", default_value_t = 600)]
    pub limit_minute: u32,
    /// Registrierungen je IP und Stunde.
    #[arg(long, env = "PUSH_RELAIS_REGISTRIERUNGEN_STUNDE", default_value_t = 10)]
    pub registrierungen_stunde: u32,
    /// Hinter einem Reverse-Proxy zählt der letzte (rechte) Eintrag von `X-Forwarded-For` als
    /// Client-IP, den der Proxy anhängt; sonst die Peer-Adresse.
    #[arg(long, env = "PUSH_RELAIS_HINTER_PROXY", default_value_t = false)]
    pub hinter_proxy: bool,
    #[arg(
        long,
        env = "PUSH_RELAIS_APNS_BASIS_PRODUCTION",
        default_value = "https://api.push.apple.com",
        hide = true
    )]
    pub apns_basis_production: String,
    #[arg(
        long,
        env = "PUSH_RELAIS_APNS_BASIS_SANDBOX",
        default_value = "https://api.sandbox.push.apple.com",
        hide = true
    )]
    pub apns_basis_sandbox: String,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Dauerbetrieb (Standard).
    Serve,
    /// Sperrt einen Server: weitere Aufrufe werden abgewiesen.
    Sperren { server_id: String },
    /// Hebt die Sperre eines Servers auf.
    Entsperren { server_id: String },
}
