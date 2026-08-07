//! Struktureller AuthZ-Guard (LFH-121, verschärft in LFH-230).
//!
//! Erzwingt: jede Route unter `/api/einsaetze/{id}/…`, deren Modul nicht in
//! [`DEFERRED_MODULE`] steht, trägt in ihrer Handler-Signatur **genau einen**
//! sanktionierten Gate-Typ ([`SANKTIONIERTE_GATES`] —
//! [`EinsatzLesezugriff`](lifeline_hub::einsatz::kontext::EinsatzLesezugriff) /
//! [`EinsatzSchreibzugriff`](lifeline_hub::einsatz::kontext::EinsatzSchreibzugriff)),
//! dessen Modul-Marker zum `PFAD_KEY`-Eintrag des Routen-Pfads passt. Beide Gate-Typen
//! ziehen intern den Org-Isolations-Floor (LFH-115) un-vergesslich vor dem Handler.
//! Bare `EinsatzKontext` (nur Org-Floor, kein Read-/Write-Gate) ist nur mit einem
//! begründeten [`ORG_FLOOR_AUSNAHME`]-Eintrag erlaubt — sonst bricht der Test, ebenso
//! bei fehlendem Gate oder falsch-passendem Marker.
//!
//! Der Test parst `src/app.rs` (Router-Registrierung) und die betroffenen
//! `src/routes/<modul>.rs`-Handler-Signaturen als Quelltext — bewusst ohne
//! `regex`-Dependency (das Projekt hält die Abhängigkeiten schlank).

use lifeline_hub::einsatz::modul::key_fuer_pfad;
use std::fs;

/// Module, deren einsatz-gebundene Handler in der LFH-121/LFH-230-**Teil**migration
/// bewusst noch NICHT auf einen typisierten Gate-Extractor umgestellt wurden
/// (dokumentierte Folge-Migration). Sie sind seit LFH-115 org-sicher
/// (`fordere_lesezugriff`/`darf_lesen` enthält den Org-Check); der Extractor macht das
/// nur für berührte/neue Routen un-vergesslich und erzwingt zusätzlich den
/// Pfad-korrekten Modul-Marker (LFH-230).
///
/// Ein Handler in einem NICHT gelisteten Modul ohne sanktionierten Gate-Typ bricht den
/// Test. Beim Migrieren eines Moduls: hier streichen. Bei einem neuen Modul mit
/// einsatz-Routen: den Gate-Extractor ziehen (nicht eintragen).
const DEFERRED_MODULE: &[&str] = &[
    "einsatz",
    "einsatz_person",
    "einsatz_uhs",
    "einsatz_tier",
    "einsatz_schaden",
    "einsatz_fahrzeug",
    "einsatz_bereitstellungsraum",
    "einsatz_personal",
    "einsatz_einheit",
    "einsatz_material",
    "chat",
    "etb",
    "befehl",
    "lagebericht",
    "lage_zone",
    "freies_zeichen",
    "gefahr",
    "einsatzabschnitt",
    "karte_hintergrundbild",
    "sprechgruppe",
    "ort_vorschau",
    "erinnerung",
    "nachforderung",
];

/// Extractor-Typen, die ein Gate strukturell erzwingen (LFH-230). Neue Variante
/// (z. B. `EinsatzEinsatzleitung`) beim Einführen hier ergänzen.
const SANKTIONIERTE_GATES: &[&str] = &[
    "EinsatzLesezugriff",
    "EinsatzSchreibzugriff",
    "EinsatzSchreibfreigabe",
];

/// Handler, die BEWUSST nur den Org-Floor (`EinsatzKontext`) ziehen, ohne Read-/Write-
/// Gate — z. B. DSGVO-Carve-outs (`aufbewahrungsfrist_setzen`), die auch auf einem
/// abgelaufenen Einsatz laufen müssen. Jeder Eintrag braucht eine Begründung.
/// Leer im Pilot-Batch (LFH-230 2a) — die Ausnahmen liegen in DEFERRED-Modulen.
const ORG_FLOOR_AUSNAHME: &[(&str, &str)] = &[];

/// Der erste doppelt-gequotete String in einem `.route(`-Segment = der Pfad.
fn erster_string(seg: &str) -> Option<&str> {
    let start = seg.find('"')?;
    let rest = &seg[start + 1..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

/// Liest einen Rust-Identifier ab `i` (alnum + `_`) und gibt ihn + die Folgeposition.
fn ident_bei(s: &str, i: usize) -> (String, usize) {
    let bytes = s.as_bytes();
    let start = i;
    let mut j = i;
    while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
        j += 1;
    }
    (s[start..j].to_string(), j)
}

/// Alle `routes::MODUL::HANDLER`-Referenzen in einem `.route(...)`-Segment.
fn handler_refs(seg: &str) -> Vec<(String, String)> {
    let mut refs = Vec::new();
    let mut pos = 0;
    while let Some(rel) = seg[pos..].find("routes::") {
        let p = pos + rel + "routes::".len();
        let (modul, p2) = ident_bei(seg, p);
        if seg[p2..].starts_with("::") {
            let (handler, p3) = ident_bei(seg, p2 + 2);
            if !modul.is_empty() && !handler.is_empty() {
                refs.push((modul, handler));
            }
            pos = p3;
        } else {
            pos = p2.max(p + 1);
        }
    }
    refs
}

/// Ergebnis der Signatur-Analyse eines einsatz-gebundenen Handlers.
enum GateAnalyse {
    /// Genau ein sanktionierter Gate-Typ mit diesem Marker-Typnamen (`OhneModul`,
    /// wenn kein `<…>` geschrieben wurde — der Default-Typparameter).
    Gate { marker: String },
    /// Nur bare `EinsatzKontext` (Org-Floor-only).
    BareKontext,
    /// Kein Extractor / mehrere Gate-Typen / nicht interpretierbar.
    Fehlt(String),
}

/// Liest die Argumentliste von `fn {handler}(` in `src/routes/{modul}.rs` und
/// klassifiziert das Einsatz-Gate.
fn gate_analyse(modul: &str, handler: &str) -> GateAnalyse {
    let quelle = fs::read_to_string(format!("src/routes/{modul}.rs"))
        .unwrap_or_else(|_| panic!("src/routes/{modul}.rs lesbar"));
    let nadel = format!("fn {handler}(");
    let pos = quelle
        .find(&nadel)
        .unwrap_or_else(|| panic!("Handler {modul}::{handler} nicht in src/routes/{modul}.rs"));
    let open = pos + nadel.len() - 1;
    let bytes = quelle.as_bytes();
    let mut tiefe = 0i32;
    let mut ende = open;
    for (offset, &b) in bytes[open..].iter().enumerate() {
        match b {
            b'(' => tiefe += 1,
            b')' => {
                tiefe -= 1;
                if tiefe == 0 {
                    ende = open + offset;
                    break;
                }
            }
            _ => {}
        }
    }
    let args = &quelle[open..=ende];

    let treffer: Vec<&&str> = SANKTIONIERTE_GATES
        .iter()
        .filter(|g| args.contains(**g))
        .collect();
    if treffer.len() > 1 {
        return GateAnalyse::Fehlt(format!("mehrere Gate-Typen in Signatur: {treffer:?}"));
    }
    if let Some(gate) = treffer.first() {
        // Marker aus `Gate<...>` lesen; ohne `<…>` gilt der Default OhneModul.
        let gpos = args.find(**gate).unwrap();
        let nach = args[gpos + gate.len()..].trim_start();
        let marker = if let Some(rest) = nach.strip_prefix('<') {
            rest.split('>').next().unwrap_or("").trim().to_string()
        } else {
            "OhneModul".to_string()
        };
        return GateAnalyse::Gate { marker };
    }
    if args.contains("EinsatzKontext") {
        return GateAnalyse::BareKontext;
    }
    GateAnalyse::Fehlt("kein Einsatz-Gate-Extractor in der Signatur".to_string())
}

/// (Marker-Typname → Key) aus der zentralen Registry.
fn key_von_marker(marker: &str) -> Option<Option<&'static str>> {
    lifeline_hub::einsatz::modul::MARKER_KEYS
        .iter()
        .find(|(typ, _)| *typ == marker)
        .map(|(_, key)| *key)
}

#[test]
fn jede_einsatz_route_traegt_ein_gate_mit_korrektem_key() {
    let app = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let mut verstoesse: Vec<String> = Vec::new();

    for seg in app.split(".route(").skip(1) {
        let Some(pfad) = erster_string(seg) else {
            continue;
        };
        if !pfad.starts_with("/api/einsaetze/{id}") {
            continue;
        }
        for (modul, handler) in handler_refs(seg) {
            if DEFERRED_MODULE.contains(&modul.as_str()) {
                continue;
            }
            match gate_analyse(&modul, &handler) {
                GateAnalyse::BareKontext => {
                    if !ORG_FLOOR_AUSNAHME.contains(&(modul.as_str(), handler.as_str())) {
                        verstoesse.push(format!(
                            "{modul}::{handler} ({pfad}) zieht nur bare EinsatzKontext, \
                             ist aber nicht in ORG_FLOOR_AUSNAHME"
                        ));
                    }
                }
                GateAnalyse::Fehlt(grund) => {
                    verstoesse.push(format!("{modul}::{handler} ({pfad}): {grund}"));
                }
                GateAnalyse::Gate { marker } => {
                    let Some(marker_key) = key_von_marker(&marker) else {
                        verstoesse.push(format!(
                            "{modul}::{handler} ({pfad}): Marker <{marker}> unbekannt (nicht in MARKER_KEYS)"
                        ));
                        continue;
                    };
                    match key_fuer_pfad(pfad) {
                        None => verstoesse.push(format!(
                            "{modul}::{handler} ({pfad}): Pfad nicht in PFAD_KEY registriert"
                        )),
                        Some(erwartet) if erwartet != marker_key => verstoesse.push(format!(
                            "{modul}::{handler} ({pfad}): Marker-Key {marker_key:?} != Pfad-Key {erwartet:?}"
                        )),
                        Some(_) => {}
                    }
                }
            }
        }
    }

    assert!(
        verstoesse.is_empty(),
        "Einsatz-Routen ohne korrektes strukturelles Gate (LFH-230).\n\
         Erwartet: genau ein SANKTIONIERTE_GATES-Typ mit dem PFAD_KEY-korrekten Marker \
         (oder ORG_FLOOR_AUSNAHME-Eintrag / DEFERRED_MODULE):\n{}",
        verstoesse.join("\n")
    );
}
