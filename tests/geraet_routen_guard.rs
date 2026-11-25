//! Struktureller Guard über die Routenliste der Gerätesitzungen (LFH-892, design.md D4/D5).
//!
//! `CurrentUser` lässt eine Gerätesitzung nur auf die Routen in [`ALLE_GERAETE`],
//! [`ALLE_ANSICHTEN`] und [`Funktionsansicht::routen`]. Ein Eintrag wird still falsch, wenn
//! die Route umbenannt wird oder ihre Methode wechselt: das Gerät verliert dann eine Funktion,
//! ohne dass ein Build es meldet. Der Guard verlangt deshalb für jeden Eintrag eine real
//! registrierte Route mit passender Methode in `src/app.rs`, mit demselben Quelltext-Parsing
//! wie `tests/zulassung_guard.rs`.

use lifeline_hub::geraet::{Funktionsansicht, ALLE_ANSICHTEN, ALLE_GERAETE, SCHREIBENDE_ANSICHTEN};
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
    for (m, p) in SCHREIBENDE_ANSICHTEN {
        aus.push(("SCHREIBENDE_ANSICHTEN".to_string(), *m, *p));
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
    let mut gesehen: Vec<(&str, &str)> = ALLE_GERAETE
        .iter()
        .chain(ALLE_ANSICHTEN)
        .chain(SCHREIBENDE_ANSICHTEN)
        .copied()
        .collect();
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
            // Die Helfer-Liste steht für sich und nennt die gemeinsamen Routen, die sie braucht,
            // selbst (`darf_route` liest für sie keine gemeinsame Liste).
            assert!(
                a == Funktionsansicht::Helfer || !gesehen.contains(eintrag),
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
        if herkunft == "Helfer" {
            continue;
        }
        if herkunft != "ALLE_GERAETE" {
            assert!(
                pfad.starts_with("/api/incidents/{id}"),
                "{herkunft}: {pfad} ist keine Einsatzroute"
            );
        }
    }
}

/// Jeder `.route(…)`-Block in `quelle` mit seinem Pfad (erstes Literal).
fn alle_route_bloecke(quelle: &str) -> Vec<(String, String)> {
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
                        if let Some(pfad) = erstes_literal(block) {
                            bloecke.push((pfad, block.to_string()));
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

/// Spec `funktionsansichten`, „Lagemonitor schreibt nichts“: keine schreibende Einsatzroute,
/// die in `src/app.rs` registriert ist, steht dem Lagemonitor offen. Gelesen wird die echte
/// Routentabelle, nicht die Liste der Ansicht: eine neue schreibende Route fällt hier auf, auch
/// wenn jemand sie versehentlich in `ALLE_ANSICHTEN` einträgt.
#[test]
fn lagemonitor_schreibt_nichts() {
    let quelle = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let mut geprueft = 0usize;
    let mut verstoesse = Vec::new();
    for (pfad, block) in alle_route_bloecke(&quelle) {
        if !pfad.starts_with("/api/incidents/{id}") {
            continue;
        }
        for methode in ["POST", "PATCH", "PUT", "DELETE"] {
            if !block.contains(&format!("{}(", methode.to_lowercase())) {
                continue;
            }
            geprueft += 1;
            if lifeline_hub::geraet::darf_route(Funktionsansicht::Lagemonitor, methode, &pfad) {
                verstoesse.push(format!("{methode} {pfad}"));
            }
        }
    }
    assert!(
        geprueft > 100,
        "Selbstbeweis: nur {geprueft} schreibende Routen gefunden"
    );
    assert!(
        verstoesse.is_empty(),
        "Lagemonitor darf schreiben: {verstoesse:?}"
    );
}

/// Helfer-App (Spec 2026-11-24-vakwvkpg, „Routenliste `helfer`“): eine Helfer-Sitzung erreicht
/// genau ihre Liste, keine gemeinsame Route darüber hinaus. Gelesen wird die echte Routentabelle:
/// auch eine neue Route in `ALLE_GERAETE` oder `ALLE_ANSICHTEN` öffnet sich dem Helfer nicht.
#[test]
fn helfer_erreicht_nur_seine_liste() {
    let quelle = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let liste = Funktionsansicht::Helfer.routen();
    let mut geprueft = 0usize;
    let mut verstoesse = Vec::new();
    for (pfad, block) in alle_route_bloecke(&quelle) {
        for methode in ["GET", "POST", "PATCH", "PUT", "DELETE"] {
            if !block.contains(&format!("{}(", methode.to_lowercase())) {
                continue;
            }
            geprueft += 1;
            let erlaubt =
                lifeline_hub::geraet::darf_route(Funktionsansicht::Helfer, methode, &pfad);
            if erlaubt != liste.contains(&(methode, pfad.as_str())) {
                verstoesse.push(format!("{methode} {pfad}"));
            }
        }
    }
    assert!(
        geprueft > 500,
        "Selbstbeweis: nur {geprueft} Routen gefunden"
    );
    assert!(
        verstoesse.is_empty(),
        "Helfer erreicht anderes als seine Liste: {verstoesse:?}"
    );
    // Keine Lage: aus dem Einsatz nur der Live-Kanal (Ende der Kopplung, eigener Zustand).
    for (m, p) in liste {
        assert!(
            !p.starts_with("/api/incidents/{id}") || *p == "/api/incidents/{id}/live",
            "Helfer darf {m} {p} nicht"
        );
    }
}
