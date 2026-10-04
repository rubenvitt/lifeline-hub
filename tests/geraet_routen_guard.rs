//! Struktureller Guard über die Routenliste der Gerätesitzungen (LFH-892, design.md D4/D5).
//!
//! `CurrentUser` lässt eine Gerätesitzung nur auf die Routen in [`ALLE_GERAETE`],
//! [`ALLE_ANSICHTEN`] und [`Funktionsansicht::routen`]. Ein Eintrag wird still falsch, wenn
//! die Route umbenannt wird oder ihre Methode wechselt: das Gerät verliert dann eine Funktion,
//! ohne dass ein Build es meldet. Der Guard verlangt deshalb für jeden Eintrag eine real
//! registrierte Route mit passender Methode in `src/app.rs`, mit demselben Quelltext-Parsing
//! wie `tests/zulassung_guard.rs`.

use lifeline_hub::geraet::{Funktionsansicht, ALLE_ANSICHTEN, ALLE_GERAETE};
use std::fs;

/// Jeder `.route(…)`-Block für `pfad`, per Klammer-Tiefe abgegrenzt (wie im Zulassungs-Guard:
/// `rustfmt` bricht lange Aufrufe um, deshalb wird das erste Literal jedes Blocks verglichen).
fn route_bloecke(quelle: &str, pfad: &str) -> Vec<String> {
    let bytes = quelle.as_bytes();
    let mut bloecke = Vec::new();
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
                        if erstes_literal(block).as_deref() == Some(pfad) {
                            bloecke.push(block.to_string());
                        }
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    bloecke
}

fn erstes_literal(block: &str) -> Option<String> {
    let start = block.find('"')? + 1;
    let rest = &block[start..];
    let ende = rest.find('"')?;
    Some(rest[..ende].to_string())
}

/// Alle Einträge mit ihrer Herkunft.
fn alle_eintraege() -> Vec<(String, &'static str, &'static str)> {
    let mut aus = Vec::new();
    for (m, p) in ALLE_GERAETE {
        aus.push(("ALLE_GERAETE".to_string(), *m, *p));
    }
    for (m, p) in ALLE_ANSICHTEN {
        aus.push(("ALLE_ANSICHTEN".to_string(), *m, *p));
    }
    for a in Funktionsansicht::ALLE {
        for (m, p) in a.routen() {
            aus.push((format!("{a:?}"), *m, *p));
        }
    }
    aus
}

#[test]
fn jeder_eintrag_zeigt_auf_eine_real_registrierte_route() {
    let quelle = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let mut verstoesse = Vec::new();
    for (herkunft, methode, pfad) in alle_eintraege() {
        let bloecke = route_bloecke(&quelle, pfad);
        if bloecke.is_empty() {
            verstoesse.push(format!(
                "{herkunft}: {methode} {pfad} ist in src/app.rs nicht registriert (toter Eintrag)"
            ));
            continue;
        }
        let aufruf = format!("{}(", methode.to_lowercase());
        if !bloecke.iter().any(|b| b.contains(&aufruf)) {
            verstoesse.push(format!(
                "{herkunft}: {methode} {pfad}: Pfad existiert, trägt aber kein `{aufruf}…)`"
            ));
        }
    }
    assert!(
        verstoesse.is_empty(),
        "Routenliste der Gerätesitzungen passt nicht zum Router:\n{}",
        verstoesse.join("\n")
    );
}

#[test]
fn routenliste_ist_duplikatfrei() {
    let mut gesehen: Vec<(&str, &str)> =
        ALLE_GERAETE.iter().chain(ALLE_ANSICHTEN).copied().collect();
    let gemeinsam = gesehen.len();
    gesehen.sort();
    gesehen.dedup();
    assert_eq!(
        gesehen.len(),
        gemeinsam,
        "Doppelter Eintrag in ALLE_GERAETE/ALLE_ANSICHTEN"
    );
    for a in Funktionsansicht::ALLE {
        for eintrag in a.routen() {
            assert!(
                !gesehen.contains(eintrag),
                "{a:?}: {} {} steht schon in einer gemeinsamen Liste",
                eintrag.0,
                eintrag.1
            );
        }
        let mut eigene = a.routen().to_vec();
        eigene.sort();
        eigene.dedup();
        assert_eq!(eigene.len(), a.routen().len(), "{a:?}: doppelter Eintrag");
    }
}

/// Nur eine Einsatzroute darf in einer Ansichtsliste stehen: der Handler schneidet über den
/// Einsatzkontext (Stellenbindung, Modulfreigabe). Eine Org-Route gehört, wenn überhaupt, in
/// [`ALLE_GERAETE`].
#[test]
fn ansichtslisten_tragen_nur_einsatzrouten() {
    for (herkunft, _, pfad) in alle_eintraege() {
        if herkunft != "ALLE_GERAETE" {
            assert!(
                pfad.starts_with("/api/einsaetze/{id}"),
                "{herkunft}: {pfad} ist keine Einsatzroute"
            );
        }
    }
}
