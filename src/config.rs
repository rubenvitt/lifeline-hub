use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

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
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum OnlineStyleTyp {
    #[default]
    Vektor,
    Raster,
}

/// Ein benannter Online-Basemap-View. `attribution` ist die config-autoritative
/// Pflicht-Attribution, die das Frontend per `customAttribution` anzeigt.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
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

/// Geteilter Offline-Katalog-Typ + Merge-/Validierungslogik — ausgelagert ins eigene
/// Workspace-Crate `karten-katalog` (LFH-201, Grundstein für den späteren karten-service).
pub use karten_katalog::{
    eintrag_ist_lieferbar, merge_offline_katalog, remote_eintrag_ist_gueltig, OfflineKatalogEintrag,
};

/// Kuratierter Offline-Karten-Katalog (`GET /api/karte/offline-karten/katalog`) — analog zum
/// Online-Vorschlagskatalog `default_online_styles`. Eigenbau (`karten-build`, Planetiler-
/// Shortbread, z0–14, ODbL): ein gesamtdeutscher Shortbread-MBTiles-Eintrag, als GitHub-Release
/// des eigenen Build-Projekts gehostet (LFH-195: Community-Katalog vorheriger Bauart entfällt).
pub fn default_offline_katalog() -> Vec<OfflineKatalogEintrag> {
    // >>> OPERATOR-PIN (LFH-197/199) <<< — je Eintrag beim karten-build-Release genau drei Felder
    // ersetzen (README karten-build): `url` (Host-URL), `groesse` (gemessene Bytes), `sha256` (aus
    // out/result/osm*.mbtiles.sha256, lowercase-hex). Bis dahin klar erkennbare, aber gültige
    // https-Platzhalter. Der Pin ist eine reine Config-Änderung; die Konsistenzprüfung
    // (katalog_eintrag_sha256_pin_konsistent) trägt Platzhalter wie echten Pin. Alternativ füllt
    // das Remote-Manifest (LFH-199) die echten Einträge ohne App-Release.
    //
    // Kuratierte Regionen (~5–20, grob): DE gesamt, einzelne Bundesländer. DACH ist kein
    // einzelner Geofabrik-Extrakt (v1) und wird nicht kompiliert; Regionen kommen ggf. dynamisch
    // übers Remote-Manifest (LFH-199). `gruppe` steuert die geführte UX-Auswahl. Neue Region =
    // Zeile ergänzen (Slug = karten-build-Dateiname).
    fn platzhalter(
        name: &str,
        region: &str,
        gruppe: &str,
        slug: &str,
        ca_gb: i64,
    ) -> OfflineKatalogEintrag {
        OfflineKatalogEintrag {
            name: name.into(),
            url: format!("https://TODO-karten-build-release/{slug}.shortbread.mbtiles"),
            region: region.into(),
            groesse: ca_gb * 1024 * 1024 * 1024, // grobe Schätzung, nach Bau durch Messung ersetzen
            lizenz: "© OpenStreetMap contributors (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            quelle: "Eigenbau (karten-build, Planetiler-Shortbread)".into(),
            sha256: None,
            gruppe: Some(gruppe.into()),
        }
    }
    // Deckungsgleich mit dem karten-service-Regionssatz (karten-service/src/regions.rs): DE, alle
    // 16 Bundesländer, alle 9 Nachbarländer. Rein Offline-Erststart-Baseline — live kommt der Katalog
    // übers Remote-Manifest (jeder echte Pin überschreibt hier per `name`). `ca_gb` ist eine grobe
    // Schätzung, nach dem Bau durch die gemessene Größe ersetzt.
    vec![
        platzhalter(
            "Deutschland (Shortbread)",
            "DE",
            "Deutschland",
            "germany",
            3,
        ),
        // Bundesländer (ISO 3166-2:DE)
        platzhalter(
            "Baden-Württemberg",
            "DE-BW",
            "Bundesländer",
            "baden-wuerttemberg",
            1,
        ),
        platzhalter("Bayern", "DE-BY", "Bundesländer", "bayern", 2),
        platzhalter("Berlin", "DE-BE", "Bundesländer", "berlin", 1),
        platzhalter("Brandenburg", "DE-BB", "Bundesländer", "brandenburg", 1),
        platzhalter("Bremen", "DE-HB", "Bundesländer", "bremen", 1),
        platzhalter("Hamburg", "DE-HH", "Bundesländer", "hamburg", 1),
        platzhalter("Hessen", "DE-HE", "Bundesländer", "hessen", 1),
        platzhalter(
            "Mecklenburg-Vorpommern",
            "DE-MV",
            "Bundesländer",
            "mecklenburg-vorpommern",
            1,
        ),
        platzhalter("Niedersachsen", "DE-NI", "Bundesländer", "niedersachsen", 1),
        platzhalter(
            "Nordrhein-Westfalen",
            "DE-NW",
            "Bundesländer",
            "nordrhein-westfalen",
            2,
        ),
        platzhalter(
            "Rheinland-Pfalz",
            "DE-RP",
            "Bundesländer",
            "rheinland-pfalz",
            1,
        ),
        platzhalter("Saarland", "DE-SL", "Bundesländer", "saarland", 1),
        platzhalter("Sachsen", "DE-SN", "Bundesländer", "sachsen", 1),
        platzhalter(
            "Sachsen-Anhalt",
            "DE-ST",
            "Bundesländer",
            "sachsen-anhalt",
            1,
        ),
        platzhalter(
            "Schleswig-Holstein",
            "DE-SH",
            "Bundesländer",
            "schleswig-holstein",
            1,
        ),
        platzhalter("Thüringen", "DE-TH", "Bundesländer", "thueringen", 1),
        // Nachbarländer Deutschlands
        platzhalter("Österreich", "AT", "Nachbarländer", "austria", 1),
        platzhalter("Belgien", "BE", "Nachbarländer", "belgium", 1),
        platzhalter("Tschechien", "CZ", "Nachbarländer", "czech-republic", 1),
        platzhalter("Dänemark", "DK", "Nachbarländer", "denmark", 1),
        platzhalter("Frankreich", "FR", "Nachbarländer", "france", 4),
        platzhalter("Luxemburg", "LU", "Nachbarländer", "luxembourg", 1),
        platzhalter("Niederlande", "NL", "Nachbarländer", "netherlands", 1),
        platzhalter("Polen", "PL", "Nachbarländer", "poland", 2),
        platzhalter("Schweiz", "CH", "Nachbarländer", "switzerland", 1),
        // Ganze Welt, Voll-Detail — wählbare Option, sehr groß.
        platzhalter("Ganze Welt (Voll-Detail)", "WORLD", "Welt", "planet", 80),
    ]
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

    /// Basis-URL des zentralen karten-service (LFH-203). Fehlt sie, ist der Region-Bau
    /// (Admin-Trigger für Kartenbau) deaktiviert — `KarteConfigAntwort.karten_bau_verfuegbar`
    /// meldet dann `false`.
    #[arg(long, env = "LIFELINE_KARTEN_SERVICE_URL")]
    pub karten_service_url: Option<String>,

    /// Bearer-Token für den karten-service. Bleibt server-side (nie im Browser); ohne Token ist
    /// der Region-Bau deaktiviert. `GeheimesPasswort` maskiert es im `Debug` (wie `admin_password`),
    /// damit es nicht versehentlich via `{config:?}` ins Log gelangt.
    #[arg(long, env = "LIFELINE_KARTEN_SERVICE_TOKEN")]
    pub karten_service_token: Option<GeheimesPasswort>,
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
    fn katalog_ohne_unbaubares_dach() {
        let k = default_offline_katalog();
        assert!(
            !k.iter().any(|e| e.url.contains("dach")),
            "DACH ist kein einzelner Extrakt (v1)"
        );
        assert!(!k
            .iter()
            .any(|e| e.region == "DACH" || e.gruppe.as_deref() == Some("DACH")));
    }

    #[test]
    fn katalog_eintrag_sha256_pin_konsistent_und_serialisiert() {
        // Pin-Konsistenz (LFH-197): jeder Katalog-Eintrag ist ENTWEDER ein noch ungepinnter
        // Platzhalter (sha256 None) ODER vollständig gepinnt (64-stelliger lowercase-hex-Hash +
        // echte, nicht-TODO-URL). So bleibt der Test grün, wenn der Operator beim ersten
        // karten-build-Release pinnt — ohne halb-gepinnte Zwischenzustände durchzulassen.
        for e in default_offline_katalog() {
            // Bikonditional: ein Eintrag ist GENAU DANN gepinnt (sha256 gesetzt), wenn seine URL
            // kein TODO-Platzhalter mehr ist. Fängt beide Halb-Pin-Richtungen: echte URL ohne Hash
            // (download.rs lädt dann ungeprüft, erwartet_sha256=None) und Hash bei Platzhalter-URL.
            assert_eq!(
                e.sha256.is_some(),
                !e.url.contains("TODO"),
                "URL/Pin-Zustand inkonsistent (echte URL braucht sha256 und umgekehrt): {}",
                e.name
            );
            if let Some(h) = &e.sha256 {
                assert_eq!(h.len(), 64, "sha256 muss 64 hex sein: {}", e.name);
                assert!(
                    h.chars()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
                    "sha256 lowercase-hex: {}",
                    e.name
                );
            }
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
            gruppe: None,
        };
        let j = serde_json::to_string(&mit_pin).unwrap();
        assert!(j.contains("\"sha256\":\"abc123\""), "sha256 im JSON: {j}");
    }

    // Test-Helfer für die Merge-Tests (LFH-199).
    fn eintrag(name: &str, url: &str, sha256: Option<String>) -> OfflineKatalogEintrag {
        OfflineKatalogEintrag {
            name: name.into(),
            url: url.into(),
            region: "DE".into(),
            groesse: 1_000,
            lizenz: "© OSM (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            quelle: "test".into(),
            sha256,
            gruppe: None,
        }
    }

    #[test]
    fn merge_katalog_override_ergaenzt_und_verwirft_ungueltige() {
        let compiled = vec![
            eintrag(
                "Deutschland (Shortbread)",
                "https://TODO-x/de.mbtiles",
                None,
            ),
            eintrag("Bayern", "https://TODO-x/by.mbtiles", None),
        ];
        let remote = vec![
            // Override „Deutschland": echter Pin ersetzt den Platzhalter.
            eintrag(
                "Deutschland (Shortbread)",
                "https://mirror.example/de.mbtiles",
                Some("a".repeat(64)),
            ),
            // Neuer Eintrag: wird angehängt.
            eintrag(
                "DACH",
                "https://mirror.example/dach.mbtiles",
                Some("b".repeat(64)),
            ),
            // Ungültig (halb-gepinnt: echte URL ohne sha256) → verworfen.
            eintrag("Sachsen", "https://mirror.example/sn.mbtiles", None),
        ];
        let out = merge_offline_katalog(compiled, Some(remote));
        let de = out
            .iter()
            .find(|e| e.name == "Deutschland (Shortbread)")
            .unwrap();
        assert_eq!(
            de.url, "https://mirror.example/de.mbtiles",
            "Remote-Pin überschreibt Platzhalter"
        );
        assert!(
            out.iter().any(|e| e.name == "DACH"),
            "neuer Remote-Eintrag ergänzt"
        );
        assert!(
            out.iter().any(|e| e.name == "Bayern"),
            "compiled-in bleibt erhalten"
        );
        assert!(
            !out.iter().any(|e| e.name == "Sachsen"),
            "halb-gepinnter Remote-Eintrag verworfen"
        );
    }

    #[test]
    fn merge_katalog_ohne_remote_ist_identisch() {
        let compiled = vec![eintrag("Bayern", "https://TODO-x/by.mbtiles", None)];
        assert_eq!(
            merge_offline_katalog(compiled.clone(), None).len(),
            compiled.len()
        );
    }

    #[test]
    fn offline_katalog_ist_kuratiert_und_gruppiert() {
        let k = default_offline_katalog();
        assert!(
            k.len() >= 3,
            "kuratierter Katalog mit mehreren Regionen: {}",
            k.len()
        );
        assert!(
            k.iter().all(|e| e.gruppe.is_some()),
            "jeder Eintrag hat eine UX-Gruppe"
        );
        assert!(k
            .iter()
            .any(|e| e.region == "DE" && e.name.contains("Deutschland")));
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
    fn karten_service_token_wird_im_debug_maskiert() {
        let config =
            Config::parse_from(["lifeline-hub", "--karten-service-token", "svc-token-geheim"]);
        let ausgabe = format!("{config:?}");
        assert!(
            !ausgabe.contains("svc-token-geheim"),
            "Service-Token darf nicht im Debug stehen"
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
        let config = Config::parse_from([
            "lifeline-hub",
            "restore",
            "--from",
            "/mnt/usb/b.sqlite",
            "--force",
        ]);
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
            "lifeline-hub",
            "--db-path",
            "/tmp/x.db",
            "backup",
            "--out",
            "/tmp/b.sqlite",
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
