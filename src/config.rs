use clap::{Parser, Subcommand};

/// Passwort-Wert, dessen `Debug`-Ausgabe maskiert ist, damit das Klartext-
/// Passwort nicht versehentlich (z.B. via `{config:?}`) ins Log gelangt.
#[derive(Clone)]
pub struct GeheimesPasswort(pub String);

impl std::str::FromStr for GeheimesPasswort {
    type Err = std::convert::Infallible;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(GeheimesPasswort(s.to_string()))
    }
}

impl std::fmt::Debug for GeheimesPasswort {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("\"***\"")
    }
}

impl GeheimesPasswort {
    /// Klartext-Passwort als &str.
    pub fn als_str(&self) -> &str {
        &self.0
    }
}

/// Karten-/Basemap-Konfiguration, die zur Laufzeit an die Karte-Routen geht.
/// `Default` (alles `None`) → kein Tile-Service, Frontend geht in den Blind-Modus.
#[derive(Clone, Debug, Default)]
pub struct KarteConfig {
    pub pmtiles_path: Option<String>,
    pub online_style_url: Option<String>,
}

/// Laufzeit-Konfiguration für den lifeline-hub-Server.
#[derive(Parser, Debug, Clone)]
#[command(version, about = "lifeline-hub Server")]
pub struct Config {
    /// Pfad zur SQLite-Datenbankdatei.
    #[arg(long, env = "LIFELINE_DB_PATH", default_value = "lifeline.db")]
    pub db_path: String,

    /// Adresse, auf der der Server lauscht (Host:Port).
    #[arg(long, env = "LIFELINE_BIND", default_value = "127.0.0.1:8080")]
    pub bind: String,

    /// Name der Organisation, die beim ersten Start angelegt wird.
    #[arg(long, env = "LIFELINE_ORG_NAME", default_value = "Meine Organisation")]
    pub org_name: String,

    /// Benutzername des initialen Admin-Kontos (erster Start).
    #[arg(long, env = "LIFELINE_ADMIN_USER", default_value = "admin")]
    pub admin_user: String,

    /// Passwort des initialen Admin-Kontos. Fehlt es, wird beim ersten Start
    /// ein Zufalls-Passwort erzeugt und ins Log geschrieben.
    #[arg(long, env = "LIFELINE_ADMIN_PASSWORD")]
    pub admin_password: Option<GeheimesPasswort>,

    /// Pfad zur lokalen PMTiles-Basemap (Offline-Karte). Fehlt er, gibt es keinen
    /// Offline-Tile-Service; das Frontend nutzt dann Online-URL oder Blind-Modus.
    #[arg(long, env = "LIFELINE_PMTILES_PATH")]
    pub pmtiles_path: Option<String>,

    /// Online-Style-URL (MapLibre-Style-JSON), bevorzugt wenn das Netz erreichbar ist.
    #[arg(long, env = "LIFELINE_KARTE_STYLE_URL")]
    pub karte_online_style_url: Option<String>,

    /// Optionales Subkommando. Ohne Subkommando wird der Server gestartet.
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// Subkommandos der lifeline-hub-Binary (neben dem Server-Standardlauf).
#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Konsistente Sicherung der Datenbank erstellen (auch im laufenden Betrieb).
    Backup {
        /// Zielpfad der Sicherungsdatei (darf noch nicht existieren).
        #[arg(long)]
        out: String,
    },
    /// Sicherung zurückspielen — ersetzt die aktuelle Datenbank.
    Restore {
        /// Pfad zur Sicherungsdatei.
        #[arg(long)]
        from: String,
        /// Ohne Rückfrage überschreiben.
        #[arg(long)]
        force: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_applied() {
        let config = Config::parse_from(["lifeline-hub"]);
        assert_eq!(config.db_path, "lifeline.db");
        assert_eq!(config.bind, "127.0.0.1:8080");
    }

    #[test]
    fn cli_flags_override_defaults() {
        let config = Config::parse_from(["lifeline-hub", "--bind", "0.0.0.0:9000"]);
        assert_eq!(config.bind, "0.0.0.0:9000");
    }

    #[test]
    fn db_path_flag_overrides_default() {
        let config = Config::parse_from(["lifeline-hub", "--db-path", "/tmp/test.db"]);
        assert_eq!(config.db_path, "/tmp/test.db");
    }

    #[test]
    fn bootstrap_defaults_und_optionales_passwort() {
        let config = Config::parse_from(["lifeline-hub"]);
        assert_eq!(config.org_name, "Meine Organisation");
        assert_eq!(config.admin_user, "admin");
        assert!(config.admin_password.is_none());

        let config = Config::parse_from(["lifeline-hub", "--admin-password", "geheim123"]);
        assert_eq!(
            config.admin_password.as_ref().map(|p| p.als_str()),
            Some("geheim123")
        );
    }

    #[test]
    fn admin_password_wird_im_debug_maskiert() {
        let config = Config::parse_from(["lifeline-hub", "--admin-password", "geheim123"]);
        let ausgabe = format!("{config:?}");
        assert!(
            !ausgabe.contains("geheim123"),
            "Passwort darf nicht im Debug stehen"
        );
        assert!(ausgabe.contains("***"));
    }

    #[test]
    fn ohne_subkommando_ist_kein_command() {
        let config = Config::parse_from(["lifeline-hub"]);
        assert!(config.command.is_none());
    }

    #[test]
    fn backup_subkommando_wird_geparst() {
        let config = Config::parse_from(["lifeline-hub", "backup", "--out", "/mnt/usb/b.sqlite"]);
        match config.command {
            Some(Command::Backup { out }) => assert_eq!(out, "/mnt/usb/b.sqlite"),
            andere => panic!("erwartete Backup, fand {andere:?}"),
        }
    }

    #[test]
    fn restore_subkommando_mit_force_wird_geparst() {
        let config =
            Config::parse_from(["lifeline-hub", "restore", "--from", "/mnt/usb/b.sqlite", "--force"]);
        match config.command {
            Some(Command::Restore { from, force }) => {
                assert_eq!(from, "/mnt/usb/b.sqlite");
                assert!(force);
            }
            andere => panic!("erwartete Restore, fand {andere:?}"),
        }
    }

    #[test]
    fn server_flags_funktionieren_weiter_mit_subkommando() {
        let config = Config::parse_from([
            "lifeline-hub", "--db-path", "/tmp/x.db", "backup", "--out", "/tmp/b.sqlite",
        ]);
        assert_eq!(config.db_path, "/tmp/x.db");
        assert!(matches!(config.command, Some(Command::Backup { .. })));
    }

    #[test]
    fn karte_flags_werden_geparst() {
        let config = Config::parse_from([
            "lifeline-hub",
            "--pmtiles-path", "/data/de.pmtiles",
            "--karte-online-style-url", "https://tiles.example/style.json",
        ]);
        assert_eq!(config.pmtiles_path.as_deref(), Some("/data/de.pmtiles"));
        assert_eq!(
            config.karte_online_style_url.as_deref(),
            Some("https://tiles.example/style.json")
        );
    }
}
