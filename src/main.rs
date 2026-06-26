use clap::Parser;
use lifeline_hub::app::{build_router, AppState};
use lifeline_hub::backup;
use lifeline_hub::config::{Command, Config};
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use std::path::Path;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::parse();

    match config.command.clone() {
        Some(Command::Backup { out }) => cmd_backup(&config.db_path, &out).await,
        Some(Command::Restore { from, force }) => cmd_restore(&config.db_path, &from, force).await,
        None => run_server(config).await,
    }
}

/// Startet den HTTP-Server (Standardlauf ohne Subkommando).
async fn run_server(config: Config) -> anyhow::Result<()> {
    tracing::info!(db_path = %config.db_path, bind = %config.bind, "Starte lifeline-hub");

    let pool = db::connect(&config.db_path).await?;
    db::migrate(&pool).await?;

    // bootstrap_admin läuft ZUERST: legt auf leerer DB Organisation, Admin-Konto und
    // die Default-Kataloge (Fahrzeug-Status, Einsatzstichworte) an. Muss vor dev_seed
    // laufen, damit die Kataloge auch im dev-seeds-Modus geseedet werden (sonst
    // hätten bereits Benutzer existiert und bootstrap_admin wäre ein No-Op).
    let ergebnis = lifeline_hub::auth::bootstrap::bootstrap_admin(
        &pool,
        &config.org_name,
        &config.admin_user,
        config.admin_password.as_ref().map(|p| p.als_str()),
    )
    .await?;
    if ergebnis.admin_angelegt {
        tracing::info!("Admin-Konto '{}' angelegt", config.admin_user);
        // Im dev-seeds-Build setzt dev_seed das Admin-Passwort gleich auf das
        // bekannte Dev-Passwort zurück → ein generiertes Passwort nicht bewerben.
        #[cfg(not(feature = "dev-seeds"))]
        if let Some(pw) = &ergebnis.generiertes_passwort {
            tracing::warn!(
                "Initiales Admin-Passwort (bitte sicher notieren und nach Login ändern): {pw}"
            );
        }
    }

    // Dev-only: reproduzierbare Testdaten seeden, NACH bootstrap_admin. dev_seed setzt
    // die Seed-Benutzer (inkl. des von bootstrap angelegten Admins) per Upsert auf das
    // bekannte Dev-Passwort, damit der /api/dev/users-Login-Picker funktioniert.
    #[cfg(feature = "dev-seeds")]
    {
        lifeline_hub::dev::seed::dev_seed(&pool).await?;
        tracing::warn!(
            "dev-seeds AKTIV: Testdaten geseedet, /api/dev/users verfügbar — NIEMALS in Production!"
        );
    }

    // Offline-Karten-Verzeichnis aus dem DB-Pfad ableiten (keine eigene ENV/CLI-Option, LFH-179)
    // und beim Start anlegen — die Tile-Auslieferung löst relative Pfade dagegen auf.
    let karten_dir = lifeline_hub::config::default_karten_dir(&config.db_path);
    std::fs::create_dir_all(&karten_dir)?;

    let live = LiveHub::new();
    // Zeitbasierte Erinnerungen: Hintergrund-Scheduler starten (nur im Server-Lauf).
    lifeline_hub::erinnerung::scheduler::starte_scheduler(pool.clone(), live.clone());
    // Aufbewahrung & Archiv (LFH-135): Purge-Scheduler (Soft-Delete + PII-Schwärzung).
    lifeline_hub::einsatz::purge_scheduler::starte_purge_scheduler(pool.clone());

    let app = build_router(AppState {
        pool,
        live,
        fachebenen: lifeline_hub::karte::FachebenenState::neu(),
        karten_dir,
    });

    let listener = tokio::net::TcpListener::bind(&config.bind).await?;
    tracing::info!("Server lauscht auf {}", config.bind);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Subkommando `backup`: konsistente Sicherung in `out` schreiben.
async fn cmd_backup(db_path: &str, out: &str) -> anyhow::Result<()> {
    if !Path::new(db_path).exists() {
        anyhow::bail!("Datenbank nicht gefunden: {db_path} — Server wurde noch nicht gestartet?");
    }
    let ziel = Path::new(out);
    if ziel.exists() {
        anyhow::bail!("Zieldatei existiert bereits: {out} (VACUUM INTO überschreibt nicht)");
    }
    let pool = db::connect(db_path).await?;
    let groesse = backup::vacuum_into(&pool, ziel).await?;
    pool.close().await;
    println!("Sicherung erstellt: {out} ({groesse} Bytes)");
    Ok(())
}

/// Subkommando `restore`: Sicherung `from` an Stelle von `db_path` einspielen.
async fn cmd_restore(db_path: &str, from: &str, force: bool) -> anyhow::Result<()> {
    if !force {
        anyhow::bail!(
            "Restore überschreibt die Datenbank {db_path}. Zum Bestätigen --force angeben \
             (Server vorher stoppen!)."
        );
    }
    backup::restore::restore_aus_datei(Path::new(from), Path::new(db_path)).await?;
    println!("Sicherung {from} wurde nach {db_path} eingespielt.");
    Ok(())
}

/// Wartet auf ein Shutdown-Signal (SIGINT/Ctrl+C oder SIGTERM) für einen sauberen Shutdown.
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = tokio::signal::ctrl_c().await {
            tracing::warn!("Ctrl+C-Handler konnte nicht installiert werden: {err}");
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
