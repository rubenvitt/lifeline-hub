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
    tracing::info!(db_path = %config.db_path, bind = %config.bind, "Starte lifeline-hub");

    let pool = db::connect(&config.db_path).await?;
    db::migrate(&pool).await?;

    let ergebnis = lifeline_hub::auth::bootstrap::bootstrap_admin(
        &pool,
        &config.org_name,
        &config.admin_user,
        config.admin_password.as_ref().map(|p| p.als_str()),
    )
    .await?;
    if ergebnis.admin_angelegt {
        tracing::info!("Admin-Konto '{}' angelegt", config.admin_user);
        if let Some(pw) = &ergebnis.generiertes_passwort {
            tracing::warn!(
                "Initiales Admin-Passwort (bitte sicher notieren und nach Login ändern): {pw}"
            );
        }
    }

    let app = build_router(AppState { pool });

    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!("Server lauscht auf {}", config.bind);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Wartet auf ein Shutdown-Signal (SIGINT/Ctrl+C oder SIGTERM) für einen sauberen Shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::warn!("Ctrl+C-Handler konnte nicht installiert werden: {err}");
            // Nicht zurückkehren — sonst würde der Server sofort herunterfahren.
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(err) => {
                tracing::warn!("SIGTERM-Handler konnte nicht installiert werden: {err}");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown-Signal empfangen, fahre herunter");
}
