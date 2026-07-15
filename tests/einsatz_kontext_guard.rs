//! Struktureller AuthZ-Guard (LFH-121).
//!
//! Erzwingt: jede Route unter `/api/einsaetze/{id}/…` zieht ihren Zugriffs-Kontext
//! über den [`EinsatzKontext`](lifeline_hub::einsatz::kontext::EinsatzKontext)-Extractor,
//! der den Org-Isolations-Floor (LFH-115) un-vergesslich vor jedem Handler erzwingt.
//! Ein neuer Sub-Routen-Handler ohne Extractor bricht diesen Test — der Org-Check kann
//! damit strukturell nicht mehr „vergessen" werden.
//!
//! Der Test parst `src/app.rs` (Router-Registrierung) und die betroffenen
//! `src/routes/<modul>.rs`-Handler-Signaturen als Quelltext — bewusst ohne
//! `regex`-Dependency (das Projekt hält die Abhängigkeiten schlank).

use std::fs;

/// Module, deren einsatz-gebundene Handler in der LFH-121-**Teil**migration bewusst
/// noch NICHT auf `EinsatzKontext` umgestellt wurden (dokumentierte Folge-Migration).
/// Sie sind seit LFH-115 org-sicher (`fordere_lesezugriff`/`darf_lesen` enthält den
/// Org-Check); der Extractor macht das nur für berührte/neue Routen un-vergesslich.
///
/// Ein Handler in einem NICHT gelisteten Modul ohne `EinsatzKontext` bricht den Test.
/// Beim Migrieren eines Moduls: hier streichen. Bei einem neuen Modul mit
/// einsatz-Routen: den Extractor ziehen (nicht eintragen).
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

/// Ob der Handler `modul::handler` den `EinsatzKontext` in seiner Argumentliste zieht.
fn nutzt_extractor(modul: &str, handler: &str) -> bool {
    let quelle = fs::read_to_string(format!("src/routes/{modul}.rs"))
        .unwrap_or_else(|_| panic!("src/routes/{modul}.rs lesbar"));
    let nadel = format!("fn {handler}(");
    let pos = quelle
        .find(&nadel)
        .unwrap_or_else(|| panic!("Handler {modul}::{handler} nicht in src/routes/{modul}.rs"));
    // Argumentliste ab dem '(' bis zur balancierten schließenden ')'.
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
    quelle[open..=ende].contains("EinsatzKontext")
}

#[test]
fn jede_einsatz_route_zieht_den_extractor() {
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
            if !nutzt_extractor(&modul, &handler) {
                verstoesse.push(format!("{modul}::{handler}  ({pfad})"));
            }
        }
    }

    assert!(
        verstoesse.is_empty(),
        "Handler unter /api/einsaetze/{{id}}/… ohne EinsatzKontext-Extractor (LFH-121).\n\
         Entweder auf den Extractor migrieren ODER das Modul in DEFERRED_MODULE eintragen:\n{}",
        verstoesse.join("\n")
    );
}
