use clap::Parser;
use karten_service::{api, config::ServiceConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let cfg = ServiceConfig::parse();
    let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
    axum::serve(listener, api::router(api::AppState { token: cfg.token })).await?;
    Ok(())
}
