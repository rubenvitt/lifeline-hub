//! Struktur-Guard gegen das „erste Organisation"-Muster (F05/LFH-232).
//!
//! `SELECT id FROM organisation ORDER BY id LIMIT 1` liest nicht *die* Organisation,
//! sondern die mit der kleinsten Id. Bei genau einer Organisation ist das unauffällig
//! richtig — genau deshalb hat sich das Muster über vier Stellen ausgebreitet und wäre
//! beim Anlegen einer zweiten Organisation überall gleichzeitig still falsch geworden:
//! Einsätze in der falschen Org, Benutzer in der falschen Org, SSO-Konten in der falschen
//! Org, Org-Stammdaten der fremden Org.
//!
//! Der Guard verbietet das Muster in produktivem Code. Die Organisation eines Objekts
//! leitet sich aus dem handelnden Benutzer ab (`benutzer.org_id`) oder aus dem Objekt,
//! zu dem es gehört (`einsatz.org_id`) — nie aus der Zeilenreihenfolge.

use std::fs;
use std::path::Path;

/// Sammelt alle `.rs`-Dateien unter `wurzel`.
fn rust_dateien(wurzel: &Path, ziel: &mut Vec<std::path::PathBuf>) {
    let Ok(eintraege) = fs::read_dir(wurzel) else {
        return;
    };
    for eintrag in eintraege.flatten() {
        let pfad = eintrag.path();
        if pfad.is_dir() {
            rust_dateien(&pfad, ziel);
        } else if pfad.extension().is_some_and(|e| e == "rs") {
            ziel.push(pfad);
        }
    }
}

/// Dateien, die das Muster bewusst behalten dürfen — mit Begründung.
const AUSNAHMEN: &[(&str, &str)] = &[
    // Dev-Seed baut eine Demo-Landschaft in der bestehenden Einzel-Org auf; er läuft nur
    // über das `dev`-Feature und hat keinen handelnden Benutzer, aus dem sich eine Org
    // ableiten ließe.
    (
        "src/dev/seed.rs",
        "Dev-Seed ohne Benutzerkontext, nur mit dev-Feature",
    ),
];

#[test]
fn keine_erste_organisation_heuristik_in_produktivem_code() {
    let mut dateien = Vec::new();
    rust_dateien(Path::new("src"), &mut dateien);
    assert!(!dateien.is_empty(), "src/ muss Rust-Dateien enthalten");

    let mut verstoesse = Vec::new();
    for pfad in &dateien {
        let rel = pfad.to_string_lossy().replace('\\', "/");
        if AUSNAHMEN.iter().any(|(a, _)| rel.ends_with(a)) {
            continue;
        }
        let Ok(inhalt) = fs::read_to_string(pfad) else {
            continue;
        };
        for (nr, zeile) in inhalt.lines().enumerate() {
            // Kommentare dürfen das Muster nennen (die Fixes erklären sich damit).
            let ohne_einrueckung = zeile.trim_start();
            if ohne_einrueckung.starts_with("//") {
                continue;
            }
            if zeile.contains("FROM organisation ORDER BY id LIMIT 1") {
                verstoesse.push(format!("{rel}:{}", nr + 1));
            }
        }
    }

    assert!(
        verstoesse.is_empty(),
        "„erste Organisation\"-Heuristik gefunden (F05/LFH-232). Die Organisation muss aus \
         dem handelnden Benutzer (benutzer.org_id) oder dem zugehörigen Objekt \
         (einsatz.org_id) kommen, nicht aus der Zeilenreihenfolge:\n{}",
        verstoesse.join("\n")
    );
}

/// Die Ausnahmeliste darf nicht verrotten: jeder Eintrag muss auf eine existierende Datei
/// zeigen, die das Muster auch wirklich (noch) enthält.
#[test]
fn ausnahmen_sind_aktuell() {
    for (pfad, grund) in AUSNAHMEN {
        let inhalt = fs::read_to_string(pfad)
            .unwrap_or_else(|_| panic!("Ausnahme {pfad} existiert nicht mehr ({grund})"));
        assert!(
            inhalt.contains("FROM organisation ORDER BY id LIMIT 1"),
            "Ausnahme {pfad} braucht das Muster nicht mehr — Eintrag entfernen ({grund})"
        );
    }
}
