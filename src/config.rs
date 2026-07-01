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
/// Raster-Tile-Template (`{z}/{y}/{x}`, das das Frontend in einen Raster-Style verpackt).
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

/// Eingebaute, schlüsselfreie Default-Shortlist (alle ohne API-Key, MapLibre-GL-tauglich,
/// behördlich/kommerziell nutzbar — Stand Recherche 30.05.2026). Dient als kuratierter
/// Vorschlagskatalog (`GET /api/karte/online-quellen/katalog`) — NICHT als automatischer Seed;
/// die DB-Registry startet leer (LFH-179: ENV-Kartenkonfig + Seeding entfernt).
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

/// Ein kuratierter, herunterladbarer Offline-Karten-Vorschlag (LFH-181). `groesse` ist die
/// UNGEFÄHRE Dateigröße in Bytes (für den Plattenplatz-Check vorab; die exakte Größe liefert
/// die Content-Length bzw. der fertige Download). Einträge sind Shortbread-MBTiles (LFH-195)
/// und rendern mit dem beschrifteten Offline-Style (Shortbread-Layer + eingebettete Glyphs/Sprite).
#[derive(Clone, Debug, Serialize)]
pub struct OfflineKatalogEintrag {
    pub name: String,
    pub url: String,
    pub region: String,
    pub groesse: i64,
    pub lizenz: String,
    pub kachel_schema: String,
    /// Provenienz-Hinweis fürs UI (Quelle ist ein Community-Repo, kein eigener Mirror).
    pub quelle: String,
    /// Optionaler SHA256-Pin (hex, lowercase). Gesetzt beim Eigen-Mirror: der Download
    /// verifiziert den berechneten gegen diesen Hash. `None` = kein Pin (vor erstem Release-Pin).
    pub sha256: Option<String>,
}

/// Kuratierter Offline-Karten-Katalog (`GET /api/karte/offline-karten/katalog`) — analog zum
/// Online-Vorschlagskatalog `default_online_styles`. Eigenbau (`karten-build`, Planetiler-
/// Shortbread, z0–14, ODbL): ein gesamtdeutscher Shortbread-MBTiles-Eintrag, als GitHub-Release
/// des eigenen Build-Projekts gehostet (LFH-195: Community-Katalog vorheriger Bauart entfällt).
pub fn default_offline_katalog() -> Vec<OfflineKatalogEintrag> {
    // URL + SHA256 werden mit dem ersten karten-build-Release gesetzt (README karten-build);
    // bis dahin ein klar erkennbarer, aber gültiger https-Platzhalter.
    vec![OfflineKatalogEintrag {
        name: "Deutschland (Shortbread)".into(),
        url: "https://TODO-karten-build-release/germany.shortbread.mbtiles".into(),
        region: "DE".into(),
        groesse: 3 * 1024 * 1024 * 1024, // grobe Schätzung, nach erstem Build durch Messung ersetzen
        lizenz: "© OpenStreetMap contributors (ODbL)".into(),
        kachel_schema: "shortbread".into(),
        quelle: "Eigenbau (karten-build, Planetiler-Shortbread)".into(),
        sha256: None, // nach erstem Build gepinnt
    }]
}

/// Lokales Daten-Verzeichnis für Offline-Karten, abgeleitet aus dem DB-Pfad
/// (`<Verzeichnis von db_path>/karten`). Bewusst KEINE eigene ENV/CLI-Option (LFH-179: ENV
/// für die Karte entfällt) — der Pfad folgt dem DB-Pfad; angelegt wird er beim Serverstart.
pub fn default_karten_dir(db_path: &str) -> std::path::PathBuf {
    std::path::Path::new(db_path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("karten")
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
    fn offline_katalog_ist_shortbread_de() {
        let katalog = default_offline_katalog();
        assert!(!katalog.is_empty());
        for e in &katalog {
            assert!(e.url.starts_with("https://"), "nur https: {}", e.url);
            assert_eq!(e.kachel_schema, "shortbread", "nur Shortbread-Schema");
            assert!(!e.lizenz.is_empty(), "Attribution Pflicht: {}", e.name);
            assert!(e.groesse > 0, "Größe für Plattenplatz-Check: {}", e.name);
        }
        assert!(katalog.iter().any(|e| e.region.starts_with("DE")));
    }

    #[test]
    fn katalog_eintrag_sha256_optional_und_serialisiert() {
        // Default: noch kein Pin (Hash kommt mit dem ersten karten-build-Release).
        for e in default_offline_katalog() {
            assert!(e.sha256.is_none(), "noch kein Pin: {}", e.name);
        }
        // Mit gesetztem Pin landet der Hash im JSON (Frontend-Kontrakt).
        let mit_pin = OfflineKatalogEintrag {
            name: "x".into(),
            url: "https://e/x.mbtiles".into(),
            region: "DE".into(),
            groesse: 1,
            lizenz: "l".into(),
            kachel_schema: "shortbread".into(),
            quelle: "q".into(),
            sha256: Some("abc123".into()),
        };
        let j = serde_json::to_string(&mit_pin).unwrap();
        assert!(j.contains("\"sha256\":\"abc123\""), "sha256 im JSON: {j}");
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
    fn default_karten_dir_folgt_db_pfad() {
        assert_eq!(
            default_karten_dir("/var/lib/lifeline/lifeline.db"),
            std::path::PathBuf::from("/var/lib/lifeline/karten")
        );
        // Ohne Verzeichnis-Anteil (relativer Default-DB-Name) → ./karten.
        assert_eq!(
            default_karten_dir("lifeline.db"),
            std::path::Path::new(".").join("karten")
        );
    }

    #[test]
    fn default_online_styles_hat_raster_und_durchgaengige_attribution() {
        let styles = default_online_styles();
        assert!(styles.len() >= 2, "Katalog sollte mehrere Views haben");
        assert!(
            styles.iter().any(|s| s.typ == OnlineStyleTyp::Raster),
            "mind. ein Raster-View"
        );
        assert!(
            styles.iter().all(|s| s.attribution.is_some()),
            "jeder Katalog-View trägt eine Pflicht-Attribution"
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
}
