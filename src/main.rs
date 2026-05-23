use clap::Parser;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::config::Config;
use lifeline_hub::db;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::parse();
    tracing::info!(?config, "Starte lifeline-hub");

    let pool = db::connect(&config.db_path).await?;
    db::migrate(&pool).await?;

    let app = build_router(AppState { pool });

    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!("Server lauscht auf {}", config.bind);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Wartet auf Ctrl+C für einen sauberen Shutdown.
async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Ctrl+C-Handler installieren");
    tracing::info!("Shutdown-Signal empfangen, fahre herunter");
}
