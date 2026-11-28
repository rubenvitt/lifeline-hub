//! Wächter der Testprogramme (LLH-2150, `src/AGENTS.md`, „Integrationstests in Bündeln“).
//!
//! `Cargo.toml` setzt `autotests = false`: Eine Datei in `tests/`, die weder als `[[test]]` noch
//! in einer Bündelwurzel steht, liefe still nie. Und in einem Bündel teilen sich die Tests aller
//! Dateien einen Prozess: Ein prozessweiter Setzer (`let _ = X.set(..)` an einem `OnceLock`)
//! entschiede dort nach Laufreihenfolge, welchen Wert alle sehen. Ebenso teilen sich dort alle
//! echten Verbindungen von 127.0.0.1 die Sperre nach Fehlversuchen (`auth::rate_limit`, 10 je
//! 300 s): Die Kopplungstests über `instanz_hilfen` sperrten sich im Bündel gegenseitig aus
//! (gemessen 28.11.2026, 48 Fehler, je nach Reihenfolge).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Setzer prozessweiter Einstellungen. Eine Datei, die einen davon aufruft, ist eigenständig;
/// einzige Ausnahme ist ein Bündel, dessen Dateien alle denselben Wert setzen ([`ERLAUBT`]).
const SETZER: &[&str] = &[
    "init_scan_config",
    "set_oidc_konfiguriert",
    "set_webauthn_konfiguriert",
    "init_oidc_settings",
    "set_webauthn",
    "init_vertraute_proxys",
    "init_cdn_proxys",
    "set_betreiber_kontakt",
    "set_cookie_secure",
    "init_karte_config",
    "set_live",
    "set_abstand",
    "set_name",
    "set_rp",
];

/// Bündel, deren Dateien einen Setzer mit demselben Wert aufrufen (Bündelkopf nennt den Wert).
const ERLAUBT: &[(&str, &str)] = &[("buendel_scan", "init_scan_config")];

/// Hilfen, die echte Instanzen auf 127.0.0.1 starten (siehe Kopf); nur in eigenständigen Dateien.
const NUR_EIGENSTAENDIG: &[&str] = &["instanz_hilfen"];

fn wurzel() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

/// Werte aller `<schluessel> = "<wert>"`-Zeilen (genügt für `Cargo.toml` und `#[path = ".."]`).
fn werte<'a>(text: &'a str, schluessel: &str) -> Vec<&'a str> {
    text.lines()
        .filter_map(|z| {
            let z = z.trim().trim_start_matches("#[").trim_end_matches(']');
            let rest = z
                .strip_prefix(schluessel)?
                .trim_start()
                .strip_prefix('=')?
                .trim();
            rest.strip_prefix('"')?.strip_suffix('"')
        })
        .collect()
}

/// Aufrufe von `name(` außerhalb von Zeilenkommentaren, nicht als Methode (`.name(`).
fn ruft_auf(quelle: &str, name: &str) -> bool {
    quelle.lines().any(|zeile| {
        let code = zeile.split("//").next().unwrap_or("");
        code.match_indices(name).any(|(i, _)| {
            let davor = code[..i].chars().next_back();
            let danach = code[i + name.len()..].trim_start();
            !matches!(davor, Some(c) if c == '.' || c == '_' || c.is_alphanumeric())
                && danach.starts_with('(')
        })
    })
}

/// Datei (ohne `.rs`) → Testprogramme, in denen sie steht.
fn zuordnung() -> BTreeMap<String, Vec<String>> {
    let cargo = fs::read_to_string(wurzel().join("Cargo.toml")).unwrap();
    let mut z: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for pfad in werte(&cargo, "path")
        .into_iter()
        .filter(|p| p.starts_with("tests/"))
    {
        if let Some(datei) = pfad
            .strip_prefix("tests/")
            .and_then(|p| p.strip_suffix(".rs"))
        {
            if !datei.contains('/') {
                z.entry(datei.into()).or_default().push(datei.into());
                continue;
            }
        }
        let programm = pfad
            .trim_start_matches("tests/")
            .split('/')
            .next()
            .unwrap()
            .to_string();
        let haupt = fs::read_to_string(wurzel().join(pfad)).unwrap();
        for modul in werte(&haupt, "path") {
            if let Some(datei) = modul
                .strip_prefix("../")
                .and_then(|p| p.strip_suffix(".rs"))
            {
                if !datei.contains('/') {
                    z.entry(datei.into()).or_default().push(programm.clone());
                }
            }
        }
    }
    z
}

#[test]
fn jede_testdatei_steht_in_genau_einem_testprogramm() {
    let z = zuordnung();
    let mut fehler = Vec::new();
    for eintrag in fs::read_dir(wurzel().join("tests")).unwrap() {
        let name = eintrag.unwrap().file_name().into_string().unwrap();
        let Some(datei) = name.strip_suffix(".rs") else {
            continue;
        };
        match z.get(datei).map(Vec::as_slice) {
            Some([_]) => {}
            None | Some([]) => {
                fehler.push(format!("tests/{name}: in keinem Testprogramm, läuft nie"))
            }
            Some(mehrere) => {
                fehler.push(format!("tests/{name}: mehrfach ({})", mehrere.join(", ")))
            }
        }
    }
    assert!(
        fehler.is_empty(),
        "Jede Datei in tests/ gehört in genau ein Bündel (tests/buendel_*/main.rs) oder als \
         eigenständiges [[test]] in Cargo.toml (src/AGENTS.md, „Integrationstests in Bündeln“):\n{}",
        fehler.join("\n")
    );
}

#[test]
fn gebuendelte_dateien_teilen_keinen_prozesszustand() {
    let mut fehler = Vec::new();
    for (datei, programme) in zuordnung() {
        let programm = &programme[0];
        // Diese Datei nennt die Setzer selbst, in Zeichenketten des Erkennungstests.
        if !programm.starts_with("buendel_") || datei == "testprogramme_guard" {
            continue;
        }
        let quelle = fs::read_to_string(wurzel().join(format!("tests/{datei}.rs"))).unwrap();
        for setzer in SETZER {
            if ruft_auf(&quelle, setzer) && !ERLAUBT.contains(&(programm.as_str(), *setzer)) {
                fehler.push(format!("tests/{datei}.rs ({programm}) ruft {setzer}"));
            }
        }
        for hilfe in NUR_EIGENSTAENDIG {
            if quelle.contains(hilfe) {
                fehler.push(format!("tests/{datei}.rs ({programm}) nutzt {hilfe}"));
            }
        }
    }
    assert!(
        fehler.is_empty(),
        "Ein prozessweiter Setzer oder eine echte Verbindung von 127.0.0.1 hängt im Bündel an der \
         Laufreihenfolge; die Datei wird eigenständiges [[test]] in Cargo.toml (src/AGENTS.md, \
         „Integrationstests in Bündeln“):\n{}",
        fehler.join("\n")
    );
}

#[test]
fn jeder_setzer_existiert_in_src() {
    fn sammle(pfad: &Path, text: &mut String) {
        for e in fs::read_dir(pfad).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                sammle(&p, text);
            } else if p.extension().is_some_and(|x| x == "rs") {
                text.push_str(&fs::read_to_string(&p).unwrap());
            }
        }
    }
    let mut src = String::new();
    sammle(&wurzel().join("src"), &mut src);
    let fehlend: Vec<_> = SETZER
        .iter()
        .filter(|s| !src.contains(&format!("pub fn {s}(")))
        .collect();
    assert!(
        fehlend.is_empty(),
        "Setzer umbenannt? Der Wächter wäre blind für: {fehlend:?}"
    );
}

#[test]
fn aufruf_erkennung_trennt_funktion_methode_und_kommentar() {
    assert!(ruft_auf(
        "    lifeline_hub::instanz::set_name(x);",
        "set_name"
    ));
    assert!(ruft_auf("set_rp (a, b);", "set_rp"));
    assert!(!ruft_auf("    ws.set_name(*name).unwrap();", "set_name"));
    assert!(!ruft_auf(
        "//! (`instanz::stammdaten::set_live`)",
        "set_live"
    ));
    assert!(!ruft_auf("    reset_name(x);", "set_name"));
}
