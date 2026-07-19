//! Struktureller Guard über die Ausnahmeliste der Zulassungssteuerung (LFH-226/G08).
//!
//! Die Liste in [`OHNE_ZULASSUNGSGRENZE`] befreit Routen von der Zulassungssteuerung. Zwei
//! Arten, wie sie still falsch werden kann:
//!
//! 1. **Tote Ausnahme** — die Route wird umbenannt oder entfernt, der Eintrag bleibt stehen.
//!    Er befreit dann nichts mehr; die neue Route läuft ungeschützt *unter* die Schranke und
//!    ein Upload/Stream bricht ab 60 s ab. Nichts im Build meldet das.
//! 2. **Methode driftet** — die Route wird von `POST` auf `PUT` umgestellt, der Eintrag nicht.
//!    Gleicher Effekt, noch unauffälliger.
//!
//! Der Guard liest deshalb `src/app.rs` als Quelltext und verlangt für jeden Eintrag eine
//! real registrierte Route mit passender Methode. Quelltext-Parsing per Klammer-Tiefenzähler,
//! bewusst ohne `regex`-Dependency — dasselbe Vorgehen wie `tests/json_extractor_guard.rs`.

use lifeline_hub::zulassung::OHNE_ZULASSUNGSGRENZE;
use std::fs;

/// Liefert zu jedem `.route(…)`-Aufruf für `pfad` den Argument-Text, per Klammer-Tiefe
/// abgegrenzt.
///
/// Bewusst NICHT über die Nadel `.route("<pfad>"` gesucht: `rustfmt` bricht längere Aufrufe
/// um, sodass Pfad-Literal und `.route(` auf verschiedenen Zeilen stehen — von den acht
/// Ausnahmen träfe eine solche Nadel nur die zwei kurzen. Stattdessen wird jeder Aufruf
/// zerlegt und sein ERSTES String-Literal (das Pfad-Argument) verglichen.
///
/// Ein Pfad kann mehrfach registriert sein (getrennte `MethodRouter` auf demselben Pfad,
/// z. B. Liste vs. Upload der Hintergrundbilder) — deshalb eine Liste, nicht ein Treffer.
fn route_bloecke(quelle: &str, pfad: &str) -> Vec<String> {
    let bytes = quelle.as_bytes();
    let mut bloecke = Vec::new();
    let mut suche_ab = 0usize;

    while let Some(rel) = quelle[suche_ab..].find(".route(") {
        let treffer = suche_ab + rel;
        suche_ab = treffer + ".route(".len();

        // Auf die öffnende Klammer aufsetzen und bis zur balancierten schließenden laufen —
        // so bleibt der Block auch bei verschachtelten `.layer(…::new(…))`-Aufrufen korrekt
        // begrenzt.
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

/// Das erste doppelt-gequotete String-Literal eines `.route(…)`-Blocks — das Pfad-Argument.
/// Die Routen-Pfade des Projekts enthalten keine Escapes, deshalb reicht „bis zum nächsten
/// Anführungszeichen".
fn erstes_literal(block: &str) -> Option<String> {
    let start = block.find('"')? + 1;
    let rest = &block[start..];
    let ende = rest.find('"')?;
    Some(rest[..ende].to_string())
}

#[test]
fn jede_ausnahme_zeigt_auf_eine_real_registrierte_route() {
    let quelle = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let mut verstoesse = Vec::new();

    for (methode, pfad) in OHNE_ZULASSUNGSGRENZE {
        let bloecke = route_bloecke(&quelle, pfad);

        if bloecke.is_empty() {
            verstoesse.push(format!(
                "{methode} {pfad}: in src/app.rs ist keine Route mit diesem Pfad registriert \
                 — tote Ausnahme (Pfad umbenannt oder entfernt?)"
            ));
            continue;
        }

        // Die Methode muss in mindestens EINEM der Blöcke als Routing-Aufruf stehen
        // (`get(`, `post(`, …). Mehrere Blöcke = derselbe Pfad, getrennte MethodRouter.
        let aufruf = format!("{}(", methode.to_lowercase());
        if !bloecke.iter().any(|b| b.contains(&aufruf)) {
            verstoesse.push(format!(
                "{methode} {pfad}: Pfad existiert, trägt aber kein `{aufruf}…)` \
                 — Methode der Route driftet von der Ausnahme ab"
            ));
        }
    }

    assert!(
        verstoesse.is_empty(),
        "Ausnahmeliste der Zeitschranke passt nicht zum Router:\n{}",
        verstoesse.join("\n")
    );
}

#[test]
fn ausnahmeliste_ist_duplikatfrei() {
    let mut gesehen: Vec<(&str, &str)> = Vec::new();
    for eintrag in OHNE_ZULASSUNGSGRENZE {
        assert!(
            !gesehen.contains(eintrag),
            "Doppelter Eintrag in OHNE_ZULASSUNGSGRENZE: {} {}",
            eintrag.0,
            eintrag.1
        );
        gesehen.push(*eintrag);
    }
}
