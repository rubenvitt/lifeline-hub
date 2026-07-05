use clap::Parser;
use karten_service::{
    api, build,
    config::{Command, ServiceConfig},
    jobs::{JobStatus, Registry},
    regions, scheduler,
    storage::{s3::S3Storage, Storage},
    worker,
};
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let cfg = ServiceConfig::parse();

    let storage: Arc<dyn Storage> = Arc::new(S3Storage::neu(&cfg.storage_bucket, &cfg.base_url)?);
    let runner: Arc<dyn build::BuildRunner> = Arc::new(build::make_runner::MakeRunner {
        karten_build_dir: cfg.karten_build_dir.clone(),
    });
    let registry = Registry::neu(regions::alle().len());
    // Seed gilt für BEIDE Modi (serve UND build) — ein einzelner `build --slug` darf den
    // Vorbestand der übrigen Regionen im Manifest nicht durch einen leeren Bestand ersetzen.
    // Ein Storage-Lesefehler oder korruptes Manifest propagiert per `?` und bricht ab, statt
    // (durch einen fälschlich leeren Bestand) den Katalog beim nächsten Build zu wipen.
    let bestand = Arc::new(Mutex::new(build::seed_bestand(storage.as_ref()).await?));

    match cfg.command.clone() {
        Command::Serve => {
            let listener = tokio::net::TcpListener::bind(&cfg.bind).await?;
            let ws = worker::WorkerState {
                registry: registry.clone(),
                runner: runner.clone(),
                storage: storage.clone(),
                bestand: bestand.clone(),
            };
            tokio::spawn(worker::run(ws));

            let reg_for_cron = registry.clone();
            // Finding (Task 11/13): benannt binden und über die gesamte serve-Dauer halten —
            // `let _ = ...` würde den JobScheduler sofort droppen und den Cron stoppen.
            let _scheduler = scheduler::starte(&cfg.schedule, move || {
                for r in regions::alle() {
                    let _ = reg_for_cron.enqueue(r.slug);
                }
            })
            .await?;

            let state = api::AppState {
                token: cfg.token.clone(),
                registry,
                storage,
                runner,
                bestand,
            };
            axum::serve(listener, api::router(state)).await?;
            Ok(())
        }
        Command::Build { slug, all } => build_lokal(slug, all, &registry, runner, storage, bestand).await,
    }
}

/// `build --slug <x>` / `--all`: baut ohne HTTP-Server, sequenziell je Slug direkt über
/// `build::fahre_build` — kein Worker/Scheduler nötig, da hier niemand parallel enqueued.
async fn build_lokal(
    slug: Option<String>,
    all: bool,
    registry: &Registry,
    runner: Arc<dyn build::BuildRunner>,
    storage: Arc<dyn Storage>,
    bestand: Arc<Mutex<Vec<karten_service::manifest::PublishedVersion>>>,
) -> anyhow::Result<()> {
    let slugs: Vec<&'static str> = match (slug, all) {
        (Some(s), _) => {
            let reg = regions::finde(&s).ok_or_else(|| anyhow::anyhow!("unbekannter slug {s}"))?;
            vec![reg.slug]
        }
        (None, true) => regions::alle().iter().map(|r| r.slug).collect(),
        (None, false) => anyhow::bail!("build braucht --slug <x> oder --all"),
    };

    let mut fehlgeschlagen = Vec::new();
    for slug in slugs {
        let reg = regions::finde(slug).expect("slug stammt aus regions::alle()/finde");
        let id = registry
            .enqueue(slug)
            .map_err(|_| anyhow::anyhow!("Queue voll für {slug}"))?;
        build::fahre_build(reg, id, registry, runner.clone(), storage.clone(), bestand.clone()).await;
        match registry.get(id).map(|j| j.status) {
            Some(JobStatus::Failed(fehler)) => {
                tracing::error!(slug, fehler, "Build fehlgeschlagen");
                fehlgeschlagen.push(format!("{slug}: {fehler}"));
            }
            _ => tracing::info!(slug, "Build ok"),
        }
    }

    if !fehlgeschlagen.is_empty() {
        anyhow::bail!("Builds fehlgeschlagen:\n{}", fehlgeschlagen.join("\n"));
    }
    Ok(())
}
