use clap::Parser;
use lifeline_hub::app::{build_router_mit, AppState, RouterOptionen};
use lifeline_hub::backup;
use lifeline_hub::config::{Command, Config};
use lifeline_hub::db;
use lifeline_hub::live::LiveHub;
use lifeline_hub::verbindung;
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
        Some(Command::Restore {
            from,
            force,
            server_gestoppt,
        }) => cmd_restore(&config.db_path, &from, force, server_gestoppt).await,
        Some(Command::SqliteVersion) => cmd_sqlite_version().await,
        None => run_server(config).await,
    }
}

/// Startet den HTTP-Server (Standardlauf ohne Subkommando).
async fn run_server(config: Config) -> anyhow::Result<()> {
    tracing::info!(db_path = %config.db_path, bind = %config.bind, "Starte lifeline-hub");

    let pool = db::connect(&config.db_path).await?;
    db::migrate(&pool).await?;

    // `bootstrap_admin` läuft ZUERST: es legt auf leerer DB Organisation, Admin und
    // Default-Kataloge an. Nach `dev_seed` gäbe es schon Benutzer, und der Bootstrap wäre ein
    // No-op ohne Kataloge.
    let ergebnis = lifeline_hub::auth::bootstrap::bootstrap_admin(
        &pool,
        &config.org_name,
        &config.admin_user,
        config.admin_password.as_ref().map(|p| p.als_str()),
    )
    .await?;
    if ergebnis.admin_angelegt {
        tracing::info!("Admin-Konto '{}' angelegt", config.admin_user);
        // Im dev-seeds-Build setzt `dev_seed` das Admin-Passwort auf das Dev-Passwort zurück — ein
        // generiertes Passwort also nicht bewerben.
        #[cfg(not(feature = "dev-seeds"))]
        if let Some(pw) = &ergebnis.generiertes_passwort {
            tracing::warn!(
                "Initiales Admin-Passwort (bitte sicher notieren und nach Login ändern): {pw}"
            );
        }
    }

    // Dev-only, nach `bootstrap_admin`: setzt die Seed-Benutzer (inkl. Admin) auf das bekannte
    // Dev-Passwort für den Login-Picker.
    #[cfg(feature = "dev-seeds")]
    {
        lifeline_hub::dev::seed::dev_seed(&pool).await?;
        tracing::warn!(
            "dev-seeds AKTIV: Testdaten geseedet, /api/dev/users verfügbar — NIEMALS in Production!"
        );
    }

    // Offline-Karten-Verzeichnis aus dem DB-Pfad ableiten und anlegen; die Tile-Auslieferung löst
    // relative Pfade dagegen auf.
    let karten_dir = lifeline_hub::config::default_karten_dir(&config.db_path);
    std::fs::create_dir_all(&karten_dir)?;
    // Eingebettete Welt-Übersicht einmalig extrahieren, bevor Tiles ausgeliefert werden; ohne Asset
    // ein No-op.
    lifeline_hub::karte::assets::extrahiere_welt_uebersicht(&karten_dir);

    // Crash-Recovery: hängende Downloads auf 'fehler' setzen und `.part`-Dateien löschen.
    match lifeline_hub::karte::registry::repo::reset_haengende_downloads(&pool).await {
        Ok(ids) => {
            for id in ids {
                let _ = std::fs::remove_file(karten_dir.join(format!("karte-{id}.mbtiles.part")));
            }
        }
        Err(e) => tracing::warn!("Crash-Recovery der Offline-Downloads fehlgeschlagen: {e}"),
    }

    let live = LiveHub::new();
    // Zeitbasierte Erinnerungen: Hintergrund-Scheduler starten (nur im Server-Lauf).
    lifeline_hub::erinnerung::scheduler::starte_scheduler(pool.clone(), live.clone());
    // Purge-Scheduler (Soft-Delete + PII-Schwärzung).
    lifeline_hub::einsatz::purge_scheduler::starte_purge_scheduler(pool.clone());
    // Automatische Sicherungen; No-op ohne `--backup-verzeichnis`.
    lifeline_hub::backup::scheduler::starte_backup_scheduler(
        pool.clone(),
        lifeline_hub::backup::scheduler::BackupConfig {
            verzeichnis: config
                .backup_verzeichnis
                .as_ref()
                .map(std::path::PathBuf::from),
            intervall: std::time::Duration::from_secs(config.backup_intervall_minuten * 60),
            behalten: config.backup_behalten,
        },
    );

    // AV-Scan-Konfiguration prozessweit setzen (nicht in `AppState`, wegen der
    // Test-Konstruktionen).
    if config.clamav_addr.is_some() && !cfg!(feature = "clamav") {
        tracing::warn!(
            "LIFELINE_CLAMAV_ADDR ist gesetzt, aber die Binary wurde mit `--no-default-features` \
             OHNE das (default-aktive) `clamav`-Feature gebaut — Uploads werden NICHT gescannt und \
             je nach --clamav-fail-open abgelehnt (fail-closed, Default) oder ungeprüft \
             durchgelassen. Für echtes Scannen den Default-Build verwenden (clamav ist an)."
        );
    }
    lifeline_hub::anhang::init_scan_config(lifeline_hub::anhang::ScanConfig {
        clamd_addr: config.clamav_addr.clone(),
        fail_open: config.clamav_fail_open,
        timeout: std::time::Duration::from_secs(config.clamav_timeout_secs),
    });

    // Karten-Schalter prozessweit setzen; beide schwächen bzw. verbiegen eine Vertrauensgrenze und
    // gehören deshalb ins Log.
    if config.download_allow_loopback {
        tracing::warn!(
            "SSRF-Schutz ist abgeschwächt: --download-allow-loopback \
             (LIFELINE_DOWNLOAD_ALLOW_LOOPBACK) ist AKTIV — Karten-Downloads zu \
             Loopback-Adressen sind erlaubt, auch über http und auch auf dem öffentlichen \
             Style-/Tile-Proxy-Pfad. Das ist ein reiner Dev-Schalter für einen lokalen \
             Object-Store; in einer erreichbaren Umgebung gehört er ausgeschaltet."
        );
    }
    if let Some(url) = &config.offline_katalog_manifest_url {
        tracing::warn!(
            "Offline-Katalog nutzt eine ÜBERSCHRIEBENE Manifest-Quelle: {url} — statt des \
             einkompilierten Pins. Diese URL bestimmt, welchen Kartendaten das System vertraut."
        );
    }
    lifeline_hub::karte::init_karte_config(lifeline_hub::karte::KarteConfig {
        download_allow_loopback: config.download_allow_loopback,
        offline_katalog_manifest_url: config.offline_katalog_manifest_url.clone(),
    });

    // KRITIS-Import; nach `init_karte_config`, weil die URL-Prüfung den Loopback-Schalter von dort
    // liest.
    lifeline_hub::karte::kritis::scheduler::starte(
        karten_dir.clone(),
        lifeline_hub::karte::kritis::scheduler::KritisExtraktConfig {
            aktiv: config.kritis_extrakt,
            url: config.kritis_extrakt_url.clone(),
            intervall: std::time::Duration::from_secs(
                config.kritis_extrakt_intervall_stunden * 3600,
            ),
        },
    );

    // OIDC-Konfiguriertheit setzen — reine Config-Ableitung ohne Netz (Discovery ist lazy). Alle
    // vier Werte inkl. `oidc_redirect_url` gehören zur Bedingung, weil `oidc_client()` die
    // Redirect-URL verlangt: der Provider soll nur gelistet sein, wenn ein Login gelingen kann.
    lifeline_hub::auth::provider::registry::set_oidc_konfiguriert(
        config.oidc_issuer.is_some()
            && config.oidc_client_id.is_some()
            && config.oidc_client_secret.is_some()
            && config.oidc_redirect_url.is_some(),
    );
    // OIDC-Einstellungen prozessweit ablegen (s. `auth::oidc::OidcSettings`).
    lifeline_hub::auth::oidc::init_oidc_settings(lifeline_hub::auth::oidc::OidcSettings::from(
        &config,
    ));

    // WebAuthn: eager Bau und Validierung schon beim Start (lokal, ohne Netz). Nur bei `Ok` wird
    // der Provider gelistet und das `Webauthn` gehalten; sonst bleibt er ungelistet, statt einen
    // Knopf zu zeigen, der erst beim Klick scheitert.
    if let (Some(rp_id), Some(rp_origin)) = (&config.webauthn_rp_id, &config.webauthn_rp_origin) {
        match lifeline_hub::auth::webauthn::baue(rp_id, rp_origin) {
            Ok(webauthn) => {
                lifeline_hub::auth::webauthn::set_webauthn(webauthn);
                lifeline_hub::auth::provider::registry::set_webauthn_konfiguriert(true);
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "WebAuthn-Konfiguration ungültig (rp_id muss ein Hostname sein, keine IP) \
                     — Passkey-Provider wird NICHT gelistet"
                );
            }
        }
    }

    // Demo-Daten: der Schalter reist als Router-Option. Er öffnet einen harten Löschweg und steht
    // deshalb im Log.
    if config.demo_daten {
        tracing::warn!(
            "Demo-Daten sind freigeschaltet: --demo-daten (LIFELINE_DEMO_DATEN) ist AKTIV — \
             der System-Admin kann über /api/demo-daten einen Übungseinsatz samt Stammdaten \
             importieren, und der harte Löschweg für Demo-Daten ist erreichbar. In einer \
             Einsatzumgebung gehört der Schalter ausgeschaltet."
        );
    }
    let app = build_router_mit(
        AppState {
            pool,
            live,
            fachebenen: lifeline_hub::karte::FachebenenState::neu(),
            karten_dir,
            download_client: lifeline_hub::karte::download::download_client(),
            download_fortschritt: lifeline_hub::karte::download::neue_fortschritt_map(),
            karten_service_url: config.karten_service_url.clone(),
            karten_service_token: config
                .karten_service_token
                .as_ref()
                .map(|t| t.als_str().to_string()),
        },
        RouterOptionen {
            demo_daten: config.demo_daten,
        },
    );

    if config.tls {
        // rustls 0.23 wählt bei genau einem kompilierten Provider-Feature dessen Default
        // automatisch;
        // deshalb keine hartkodierte Provider-Zeile.

        // SANs: localhost + Bind-IP + optionaler Hostname.
        let bind_ip = config
            .bind
            .split(':')
            .next()
            .unwrap_or("127.0.0.1")
            .to_string();
        let mut sans = vec!["localhost".to_string(), "127.0.0.1".to_string()];
        if bind_ip != "127.0.0.1" && bind_ip != "localhost" && !bind_ip.is_empty() {
            sans.push(bind_ip.clone());
        }
        if let Some(h) = &config.tls_hostname {
            sans.push(h.clone());
        }

        if (bind_ip == "0.0.0.0" || bind_ip == "::" || bind_ip.is_empty())
            && config.tls_hostname.is_none()
        {
            tracing::warn!(
                "TLS bind ist {} ohne --tls-hostname: das Zertifikat deckt keine erreichbare LAN-Adresse ab. \
                 Für Zugriff von anderen Geräten --tls-hostname <server-hostname/IP> setzen.",
                bind_ip
            );
        }

        let (cert_pfad, key_pfad) = lifeline_hub::tls::beschaffe_cert(&config, sans).await?;
        let tls_config =
            axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_pfad, &key_pfad).await?;

        lifeline_hub::auth::session::set_cookie_secure(true);

        // Anders als `TcpListener::bind` erwartet axum-server eine `SocketAddr`: unter `--tls` muss
        // `--bind` IP:Port sein (Hostnamen gehen nur im HTTP-Modus).
        let addr: std::net::SocketAddr = config.bind.parse().map_err(|e| {
            anyhow::anyhow!("--bind muss unter --tls IP:Port sein (kein Hostname): {e}")
        })?;
        tracing::info!("Server (HTTPS) lauscht auf {}", addr);

        let handle = graceful_handle();
        // Slow-Loris-Schutz (LFH-231). Der innere Akzeptor läuft vor dem TLS-Handshake, das
        // Verbindungs-Permit deckt ihn mit ab.
        let mut server = axum_server::bind_rustls(addr, tls_config)
            .map(|a| a.acceptor(verbindung::SemaphorAkzeptor::default()));
        verbindung::zeitschranken_setzen(&mut server, verbindung::Fristen::default());
        // `with_connect_info`: ohne ist die Peer-Adresse im Handler nicht verfügbar — Audit-Spur
        // ohne
        // Quell-IP, Rate-Limit wirkungslos. Muss auf BEIDEN Serve-Pfaden stehen.
        server
            .handle(handle)
            .serve(app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await?;
    } else {
        // `axum::serve` gibt keinen Zugriff auf die hyper-Parameter; ohne Header-Lese-Timeout wäre
        // der
        // HTTP-Pfad gegen Slow Loris ungeschützt. Deshalb läuft er über `axum-server` wie der
        // TLS-Pfad. Gebunden wird weiter über `TcpListener::bind`, damit Hostnamen aufgelöst
        // werden.
        let listener = tokio::net::TcpListener::bind(&config.bind).await?;
        tracing::info!("Server lauscht auf {}", config.bind);

        let handle = graceful_handle();
        // `from_tcp` liefert ein `io::Result` (die Konvertierung nach tokio kann scheitern).
        let mut server = axum_server::from_tcp(listener.into_std()?)?
            .acceptor(verbindung::SemaphorAkzeptor::default());
        verbindung::zeitschranken_setzen(&mut server, verbindung::Fristen::default());
        server
            .handle(handle)
            .serve(app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await?;
    }

    Ok(())
}

/// Subkommando `sqlite-version`: die einkompilierte SQLite-Version ausgeben (LFH-233). Fragt die
/// tatsächlich geladene Bibliothek statt einer Konstante. `build-release.sh` legt die Ausgabe
/// neben den SBOM.
async fn cmd_sqlite_version() -> anyhow::Result<()> {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await?;
    let version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&pool)
        .await?;
    println!("{version}");
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
    let groesse = backup::erzeuge_sicherung(&pool, ziel).await?;
    pool.close().await;
    println!("Sicherung erstellt: {out} ({groesse} Bytes)");
    Ok(())
}

/// Subkommando `restore`: Sicherung `from` an Stelle von `db_path` einspielen.
async fn cmd_restore(
    db_path: &str,
    from: &str,
    force: bool,
    server_gestoppt: bool,
) -> anyhow::Result<()> {
    if !force {
        anyhow::bail!(
            "Restore überschreibt die Datenbank {db_path}. Zum Bestätigen --force angeben \
             (Server vorher stoppen!)."
        );
    }
    backup::restore::restore_aus_datei(Path::new(from), Path::new(db_path), server_gestoppt)
        .await?;
    println!("Sicherung {from} wurde nach {db_path} eingespielt.");
    Ok(())
}

/// `Handle` für den Graceful Shutdown mit 10-Sekunden-Frist für beide Serve-Pfade — eine
/// SSE-Verbindung hielte den Shutdown sonst beliebig offen. `SocketAddr`, weil beide Pfade auf
/// IP binden (`Handle<A: Address>` kann auch Unix-Sockets tragen).
fn graceful_handle() -> axum_server::Handle<std::net::SocketAddr> {
    let handle = axum_server::Handle::new();
    let h2 = handle.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        h2.graceful_shutdown(Some(std::time::Duration::from_secs(10)));
    });
    handle
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
