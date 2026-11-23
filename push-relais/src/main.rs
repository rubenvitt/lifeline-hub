use clap::Parser;
use push_relais::{
    api::{self, RelaisState},
    apns::ApnsClient,
    config::{Command, RelaisConfig},
    speicher,
};
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let cfg = RelaisConfig::parse();
    let pool = speicher::oeffnen(&cfg.datenbank).await?;
    match cfg.command.clone().unwrap_or(Command::Serve) {
        Command::Serve => {
            let client_ip = cfg.client_ip_source()?;
            let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
            let apns = ApnsClient::neu(&cfg)?;
            let state = RelaisState::neu(
                pool,
                cfg.registrierungen_stunde,
                client_ip,
                apns,
                cfg.limit_minute,
            );
            tracing::info!(bind = %cfg.bind, "push-relais läuft");
            axum::serve(
                listener,
                api::router(state).into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await?;
        }
        Command::Sperren { server_id } => {
            let gefunden = speicher::sperren(&pool, &server_id).await?;
            anyhow::ensure!(gefunden, "Server {server_id} ist nicht registriert");
            println!("gesperrt: {server_id}");
        }
        Command::Entsperren { server_id } => {
            let gefunden = speicher::entsperren(&pool, &server_id).await?;
            anyhow::ensure!(gefunden, "Server {server_id} ist nicht registriert");
            println!("entsperrt: {server_id}");
        }
    }
    Ok(())
}
