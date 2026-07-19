//! Struktureller Guard gegen Config am Config-System vorbei (LFH-239/F18).
//!
//! Erzwingt: kein Modul in `src/` liest seine Konfiguration ad-hoc per `std::env::var`.
//! Einziger Ort, an dem Umgebungsvariablen gelesen werden dürfen, ist `src/config.rs` —
//! über `#[arg(long, env = "…")]`, damit jeder Schalter in `--help` auftaucht, beim Start
//! protokolliert werden kann und einen definierten Default hat.
//!
//! Warum das ein Guard sein muss und keine Konvention: genau diese Abkürzung hatte zwei
//! sicherheitsrelevante Schalter unsichtbar gemacht — `LIFELINE_DOWNLOAD_ALLOW_LOOPBACK`
//! schwächte den SSRF-Guard auch auf dem öffentlichen Proxy-Pfad, ohne Spur in `--help`
//! oder im Log, und `LIFELINE_OFFLINE_KATALOG_MANIFEST_URL` verbog die Trust-Quelle des
//! Offline-Katalogs. Beide wurden bei JEDEM Aufruf frisch aus dem Prozess-Env gelesen,
//! womit eine ambient gesetzte Variable reproduzierbar die Security-Tests kippte.
//!
//! Der laufzeitseitige Weg für Schalter, die nicht durch den `AppState` erreichbar sind
//! (`'static`-Closures), ist ein prozessweiter `OnceLock`, der beim Serverstart aus der
//! `Config` gefüllt wird — siehe `karte::init_karte_config` und `anhang::init_scan_config`.
//!
//! Parst Quelltext zeilenweise, bewusst ohne `regex`-Dependency (das Projekt hält die
//! Abhängigkeiten schlank) — dasselbe Vorgehen wie `tests/json_extractor_guard.rs`.

use std::fs;
use std::path::{Path, PathBuf};

/// Dateien, die Umgebungsvariablen lesen dürfen.
///
/// `config.rs` ist die eine erlaubte Stelle: dort ist das Lesen deklarativ (clap) und
/// damit in `--help` sichtbar. Der Test-Helfer `parse_hermetisch` liegt ebenfalls dort
/// und räumt die Umgebung für Default-Tests bewusst leer (LFH-235).
const ERLAUBT: &[&str] = &["src/config.rs"];

/// Sammelt alle `.rs`-Dateien unterhalb von `src/`.
fn rust_dateien(wurzel: &Path, gesammelt: &mut Vec<PathBuf>) {
    let Ok(eintraege) = fs::read_dir(wurzel) else {
        return;
    };
    let mut pfade: Vec<_> = eintraege.filter_map(Result::ok).map(|e| e.path()).collect();
    pfade.sort();
    for pfad in pfade {
        if pfad.is_dir() {
            rust_dateien(&pfad, gesammelt);
        } else if pfad.extension().is_some_and(|e| e == "rs") {
            gesammelt.push(pfad);
        }
    }
}

/// Findet Zeilen mit einem echten `env::var`-Zugriff.
///
/// Zwei Dinge sind bewusst ausgenommen, sonst meldet der Guard sich selbst und jede
/// Erklärung im Fließtext:
/// - Kommentarzeilen (`//`, `///`, `//!`) — die Doc-Kommentare, die das Verbot begründen,
///   nennen `env::var` naturgemäß beim Namen.
/// - Alles ab `#[cfg(test)]` — Testcode darf die Umgebung manipulieren, um Hermetik
///   überhaupt herstellen zu können.
fn env_zugriffe(quelle: &str) -> Vec<(usize, String)> {
    let bis = quelle.find("#[cfg(test)]").unwrap_or(quelle.len());
    quelle[..bis]
        .lines()
        .enumerate()
        .filter(|(_, zeile)| {
            let trimmed = zeile.trim_start();
            !trimmed.starts_with("//") && trimmed.contains("env::var")
        })
        .map(|(i, zeile)| (i + 1, zeile.trim().chars().take(120).collect::<String>()))
        .collect()
}

#[test]
fn kein_modul_liest_konfiguration_am_config_system_vorbei() {
    let mut dateien = Vec::new();
    rust_dateien(Path::new("src"), &mut dateien);

    assert!(
        dateien.len() > 50,
        "Guard hat nur {} Quelldateien gefunden — Pfad kaputt?",
        dateien.len()
    );

    let mut verstoesse = Vec::new();
    for pfad in &dateien {
        let pfad_str = pfad.to_string_lossy().replace('\\', "/");
        if ERLAUBT.contains(&pfad_str.as_str()) {
            continue;
        }
        let quelle = fs::read_to_string(pfad).expect("Quelldatei lesbar");
        for (zeile, inhalt) in env_zugriffe(&quelle) {
            verstoesse.push(format!("{pfad_str}:{zeile}: {inhalt}"));
        }
    }

    assert!(
        verstoesse.is_empty(),
        "Diese Stellen lesen Konfiguration direkt aus der Umgebung statt über die clap-`Config` \
         (LFH-239/F18). So ein Schalter taucht weder in `--help` noch im Startup-Log auf und \
         lässt sich ambient setzen, ohne dass es jemand merkt. Neues Feld in `src/config.rs` \
         anlegen und — falls der AppState nicht erreichbar ist — beim Start in einen \
         prozessweiten `OnceLock` schieben (Vorbild: `karte::init_karte_config`):\n{}",
        verstoesse.join("\n")
    );
}

/// Beweist, dass der Guard greift — ein Guard, der nur per Konstruktion grün ist, sagt
/// nichts aus. Prüft die Erkennungslogik gegen synthetischen Code, inklusive der Fälle,
/// die sie NICHT melden darf.
#[test]
fn guard_erkennt_verstoesse_und_ignoriert_kommentare_und_tests() {
    let mit_verstoss = r#"
        fn dev_loopback_erlaubt() -> bool {
            matches!(std::env::var("LIFELINE_DOWNLOAD_ALLOW_LOOPBACK").ok().as_deref(), Some("1"))
        }
    "#;
    assert_eq!(
        env_zugriffe(mit_verstoss).len(),
        1,
        "ad-hoc env::var im Produktionscode muss gemeldet werden"
    );

    let sauber = r#"
        /// Früher las diese Funktion per std::env::var direkt aus der Umgebung.
        // Auch ein normaler Kommentar mit env::var darf nicht anschlagen.
        fn dev_loopback_erlaubt() -> bool {
            crate::karte::karte_config().download_allow_loopback
        }

        #[cfg(test)]
        mod tests {
            fn hilf() { let _ = std::env::var("IRGENDWAS"); }
        }
    "#;
    assert!(
        env_zugriffe(sauber).is_empty(),
        "Kommentare und Testcode sind kein Verstoß, gemeldet: {:?}",
        env_zugriffe(sauber)
    );
}
