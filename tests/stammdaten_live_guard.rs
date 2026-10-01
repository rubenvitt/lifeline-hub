//! Struktureller Guard über die Stammdaten-Präfixe des Org-Ereignisses `stammdaten` (LFH-734).
//!
//! Die Middleware `routes::live::stammdaten_live` meldet nur für Routen unter
//! [`STAMMDATEN_PFADE`]. Zwei Arten, wie das still falsch werden kann:
//!
//! 1. **Vergessene Route** — ein Katalog-Modul bekommt eine schreibende Route unter einem neuen
//!    Pfad. Sie schreibt, aber kein anderer Schirm erfährt davon, und kein Test wird rot.
//! 2. **Toter Eintrag** — ein Katalogpfad wird umbenannt, der Präfix bleibt stehen und deckt
//!    nichts mehr.
//!
//! Der Guard liest deshalb `src/app.rs` als Quelltext (Klammer-Tiefenzähler wie
//! `tests/zulassung_guard.rs`) und gleicht jede `.route(…)` mit den Präfixen ab.

use lifeline_hub::routes::live::{ist_stammdaten_pfad, STAMMDATEN_PFADE};
use std::fs;

/// Handler-Module der Stammdaten-Kataloge. Eine schreibende Route eines dieser Module außerhalb
/// von `/api/einsaetze/…` ist eine Katalogänderung der Organisation.
const KATALOG_MODULE: &[&str] = &[
    "fahrzeug",
    "fahrzeug_status",
    "personal",
    "personal_status",
    "material",
    "qualifikation",
    "einheit_typ",
    "sprechgruppe",
    "etb_baustein",
    "stichwort",
    "fuehrungsfunktion",
    "organisation",
];

/// Jeder `.route(…)`-Aufruf in `quelle` als (Pfad, Argument-Text).
fn routen(quelle: &str) -> Vec<(String, String)> {
    let bytes = quelle.as_bytes();
    let mut alle = Vec::new();
    let mut suche_ab = 0usize;
    while let Some(rel) = quelle[suche_ab..].find(".route(") {
        let treffer = suche_ab + rel;
        suche_ab = treffer + ".route(".len();
        let open = treffer + ".route".len();
        let mut tiefe = 0i32;
        for (offset, &b) in bytes[open..].iter().enumerate() {
            match b {
                b'(' => tiefe += 1,
                b')' => {
                    tiefe -= 1;
                    if tiefe == 0 {
                        let block = &quelle[open..=open + offset];
                        if let Some(pfad) = erstes_literal(block) {
                            alle.push((pfad, block.to_string()));
                        }
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    alle
}

fn erstes_literal(block: &str) -> Option<String> {
    let start = block.find('"')? + 1;
    let rest = &block[start..];
    let ende = rest.find('"')?;
    Some(rest[..ende].to_string())
}

fn schreibend(block: &str) -> bool {
    ["post(", "patch(", "put(", "delete("]
        .iter()
        .any(|m| block.contains(m))
}

fn katalog_modul(block: &str) -> Option<&'static str> {
    KATALOG_MODULE
        .iter()
        .copied()
        .find(|m| block.contains(&format!("routes::{m}::")))
}

#[test]
fn jede_schreibende_katalogroute_ist_abgedeckt() {
    let quelle = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let alle = routen(&quelle);
    assert!(
        alle.len() > 200,
        "nur {} Routen erkannt — Extraktion kaputt?",
        alle.len()
    );

    let mut geprueft = 0;
    let mut fehlend = Vec::new();
    for (pfad, block) in &alle {
        let Some(modul) = katalog_modul(block) else {
            continue;
        };
        if !schreibend(block) || pfad.starts_with("/api/einsaetze/") {
            continue;
        }
        geprueft += 1;
        if !ist_stammdaten_pfad(pfad) {
            fehlend.push(format!("{pfad} (routes::{modul})"));
        }
    }
    // Leerlauf-Schutz: Stand LFH-734 sind es über 30 schreibende Katalogrouten.
    assert!(geprueft >= 30, "nur {geprueft} Katalogrouten geprüft");
    assert!(
        fehlend.is_empty(),
        "Schreibende Katalogrouten ohne Stammdaten-Präfix — andere Schirme erführen die Änderung \
         nicht. Präfix in STAMMDATEN_PFADE (src/routes/live.rs) ergänzen:\n  {}",
        fehlend.join("\n  ")
    );
}

#[test]
fn jeder_praefix_deckt_eine_schreibende_route() {
    let quelle = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let alle = routen(&quelle);
    for praefix in STAMMDATEN_PFADE {
        let gedeckt = alle.iter().any(|(pfad, block)| {
            schreibend(block)
                && pfad
                    .strip_prefix(praefix)
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
        });
        assert!(
            gedeckt,
            "{praefix}: keine schreibende Route darunter — toter Eintrag in STAMMDATEN_PFADE"
        );
    }
}

/// Die Middleware wirkt nur, wenn sie montiert ist.
#[test]
fn die_middleware_ist_montiert() {
    let app = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    assert!(
        app.contains("routes::live::stammdaten_live"),
        "src/app.rs montiert die Stammdaten-Middleware nicht mehr"
    );
}
