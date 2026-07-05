use clap::Parser;
use karten_service::{api, build, config::ServiceConfig, jobs::Registry, regions, storage::s3::S3Storage};
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let cfg = ServiceConfig::parse();
    let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
    // Nur der Router wird verdrahtet — Worker/Scheduler/Seed folgen in Task 13.
    let state = api::AppState {
        token: cfg.token,
        registry: Registry::neu(regions::alle().len()),
        storage: Arc::new(S3Storage::neu(&cfg.storage_bucket, &cfg.base_url)?),
        runner: Arc::new(build::make_runner::MakeRunner { karten_build_dir: cfg.karten_build_dir.clone() }),
        bestand: Arc::new(Mutex::new(Vec::new())),
    };
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}
