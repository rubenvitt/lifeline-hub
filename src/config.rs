use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};

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

/// Typ eines Online-Views: Vektor-Style-JSON (URL direkt an MapLibre) oder
/// Raster-Tile-Template (`{z}/{y}/{x}`), das das Frontend in einen Raster-Style verpackt.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum OnlineStyleTyp {
    #[default]
    Vektor,
    Raster,
}

/// Ein benannter Online-Basemap-View. `attribution` ist die config-autoritative
/// Pflicht-Attribution, die das Frontend per `customAttribution` anzeigt.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct OnlineStyle {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub typ: OnlineStyleTyp,
    #[serde(default)]
    pub attribution: Option<String>,
}

/// Karten-/Basemap-Konfiguration, die zur Laufzeit an die Karte-Routen geht.
/// `Default` (leer/None) → kein Tile-Service, Frontend geht in den Blind-Modus.
/// Die eingebaute Default-Shortlist wird NICHT hier, sondern erst beim Serverstart
/// über `online_styles_aufloesen` injiziert (Tests mit `build_router` bleiben Blind).
#[derive(Clone, Debug, Default)]
pub struct KarteConfig {
    pub pmtiles_path: Option<String>,
    pub online_styles: Vec<OnlineStyle>,
}

/// Eingebaute, schlüsselfreie Default-Shortlist (alle ohne API-Key, MapLibre-GL-tauglich,
/// behördlich/kommerziell nutzbar — Stand Recherche 30.05.2026).
pub fn default_online_styles() -> Vec<OnlineStyle> {
    vec![
        OnlineStyle {
            name: "OpenFreeMap Liberty".into(),
            url: "https://tiles.openfreemap.org/styles/liberty".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© OpenMapTiles © OpenStreetMap-Mitwirkende".into()),
        },
        OnlineStyle {
            name: "basemap.de Farbe".into(),
            url: "https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© GeoBasis-DE / BKG (2026) CC BY 4.0".into()),
        },
        OnlineStyle {
            name: "basemap.de Grau".into(),
            url: "https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_gry.json".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© GeoBasis-DE / BKG (2026) CC BY 4.0".into()),
        },
        OnlineStyle {
            name: "OpenFreeMap Dark".into(),
            url: "https://tiles.openfreemap.org/styles/dark".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© OpenMapTiles © OpenStreetMap-Mitwirkende".into()),
        },
        OnlineStyle {
            name: "TopPlusOpen (Topographie)".into(),
            url: "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png".into(),
            typ: OnlineStyleTyp::Raster,
            attribution: Some("© GeoBasis-DE / BKG (2026), TopPlusOpen".into()),
        },
    ]
}

/// Bestimmt die Online-Views beim Serverstart. Präzedenz:
/// 1. `LIFELINE_KARTE_STYLES` (JSON-Liste) — bei Malformed JSON HARTER Fehler.
/// 2. sonst altes `LIFELINE_KARTE_STYLE_URL` → Ein-Element-Vektor-View „Online".
/// 3. sonst eingebaute Default-Shortlist.
pub fn online_styles_aufloesen(
    styles_json: Option<&str>,
    single_url: Option<&str>,
) -> anyhow::Result<Vec<OnlineStyle>> {
    if let Some(json) = styles_json {
        let liste: Vec<OnlineStyle> = serde_json::from_str(json)
            .map_err(|e| anyhow::anyhow!("LIFELINE_KARTE_STYLES ist kein gültiges JSON: {e}"))?;
        return Ok(liste);
    }
    if let Some(url) = single_url {
        return Ok(vec![OnlineStyle {
            name: "Online".into(),
            url: url.into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: None,
        }]);
    }
    Ok(default_online_styles())
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

    /// Mehrere Online-Views als JSON-Liste: `[{"name":..,"url":..,"typ":"vektor|raster","attribution":..}]`.
    /// Hat Vorrang vor `--karte-online-style-url`. Fehlt beides, liefert der Server die Default-Shortlist.
    #[arg(long, env = "LIFELINE_KARTE_STYLES")]
    pub karte_styles: Option<String>,

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

    #[test]
    fn online_style_deserialisiert_mit_default_typ_vektor() {
        let s: OnlineStyle =
            serde_json::from_str(r#"{"name":"A","url":"https://x/s.json"}"#).unwrap();
        assert_eq!(s.name, "A");
        assert_eq!(s.url, "https://x/s.json");
        assert_eq!(s.typ, OnlineStyleTyp::Vektor); // typ fehlt → Default
        assert_eq!(s.attribution, None);
    }

    #[test]
    fn online_style_deserialisiert_raster_mit_attribution() {
        let s: OnlineStyle = serde_json::from_str(
            r#"{"name":"Top","url":"https://x/{z}/{y}/{x}.png","typ":"raster","attribution":"© BKG"}"#,
        )
        .unwrap();
        assert_eq!(s.typ, OnlineStyleTyp::Raster);
        assert_eq!(s.attribution.as_deref(), Some("© BKG"));
    }

    #[test]
    fn aufloesen_parst_json_liste() {
        let json = r#"[{"name":"A","url":"https://a"},{"name":"B","url":"https://b","typ":"raster"}]"#;
        let liste = online_styles_aufloesen(Some(json), None).unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].typ, OnlineStyleTyp::Vektor);
        assert_eq!(liste[1].typ, OnlineStyleTyp::Raster);
    }

    #[test]
    fn aufloesen_malformed_json_ist_fehler() {
        let err = online_styles_aufloesen(Some("kein json"), None);
        assert!(err.is_err());
    }

    #[test]
    fn aufloesen_faellt_auf_single_url_zurueck() {
        let liste = online_styles_aufloesen(None, Some("https://einzel/style.json")).unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].name, "Online");
        assert_eq!(liste[0].url, "https://einzel/style.json");
        assert_eq!(liste[0].typ, OnlineStyleTyp::Vektor);
    }

    #[test]
    fn aufloesen_ohne_config_liefert_default_shortlist() {
        let liste = online_styles_aufloesen(None, None).unwrap();
        assert!(liste.len() >= 3, "Default-Shortlist sollte mehrere Views haben");
        assert!(liste.iter().any(|s| s.typ == OnlineStyleTyp::Raster), "mind. ein Raster-View");
    }

    #[test]
    fn default_karte_config_ist_leer_blind() {
        let k = KarteConfig::default();
        assert!(k.online_styles.is_empty());
        assert!(k.pmtiles_path.is_none());
    }
}
