use clap::Parser;

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
        assert!(!ausgabe.contains("geheim123"), "Passwort darf nicht im Debug stehen");
        assert!(ausgabe.contains("***"));
    }
}
