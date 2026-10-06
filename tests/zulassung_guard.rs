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
//! 3. **Fehlende Ausnahme** (LFH-938) — eine neue Upload-Route mit großem Body-Limit oder eine
//!    neue Download-Route kommt ohne Eintrag dazu. Genau so liefen ETB- und Schaden-Upload ab
//!    60 s in 503.
//! 4. **Ausnahme ohne Ersatz** (LFH-938) — eine befreite Route trägt keine eigene Grenze und
//!    läuft damit ganz ungeschützt.
//!
//! Der Guard liest deshalb `src/app.rs` als Quelltext und verlangt für jeden Eintrag eine
//! real registrierte Route mit passender Methode und umgekehrt. Quelltext-Parsing per Klammer-Tiefenzähler,
//! bewusst ohne `regex`-Dependency — dasselbe Vorgehen wie `tests/json_extractor_guard.rs`.

use lifeline_hub::zulassung::OHNE_ZULASSUNGSGRENZE;
use std::fs;

/// Ab dieser Body-Grenze ist eine Route ein Upload, der über das Zeitbudget hinaus dauern kann
/// und unter die Upload-Grenze gehört.
const GROSSER_BODY: usize = 4 * 1024 * 1024;

/// Befreite Routen ohne Upload- oder Download-Grenze, jede mit ihrem Ersatz. Ein neuer Eintrag
/// hier braucht eine eigene Begründung.
const OHNE_EIGENE_GRENZE: &[(&str, &str, &str)] = &[
    (
        "GET",
        "/api/einsaetze/{id}/live",
        "SSE-Dauerverbindung, gedeckelt nur über die Verbindungs-Obergrenze",
    ),
    (
        "GET",
        "/api/live",
        "SSE-Dauerverbindung, gedeckelt nur über die Verbindungs-Obergrenze",
    ),
    (
        "GET",
        "/api/backup",
        "eigene Sperre für einen Lauf und Leerlauf-Frist (LFH-926)",
    ),
    (
        "GET",
        "/api/einsaetze/{id}/personen/export",
        "CSV-Vollexport ohne BLOB: unbeschränkt ist die Dauer, nicht der Speicher",
    ),
    (
        "GET",
        "/api/einsaetze/{id}/tiere/export",
        "CSV-Vollexport ohne BLOB: unbeschränkt ist die Dauer, nicht der Speicher",
    ),
];

/// Liefert zu jedem `.route(…)`-Aufruf für `pfad` den Argument-Text, per Klammer-Tiefe
/// abgegrenzt.
///
/// Bewusst NICHT über die Nadel `.route("<pfad>"` gesucht: `rustfmt` bricht längere Aufrufe
/// um, sodass Pfad-Literal und `.route(` auf verschiedenen Zeilen stehen — eine solche Nadel
/// träfe nur die kurzen Aufrufe. Stattdessen wird jeder Aufruf zerlegt und sein ERSTES
/// String-Literal (das Pfad-Argument) verglichen.
///
/// Ein Pfad kann mehrfach registriert sein (getrennte `MethodRouter` auf demselben Pfad,
/// z. B. Liste vs. Upload der Hintergrundbilder) — deshalb eine Liste, nicht ein Treffer.
fn route_bloecke(quelle: &str, pfad: &str) -> Vec<String> {
    alle_route_bloecke(quelle)
        .into_iter()
        .filter(|(p, _)| p == pfad)
        .map(|(_, block)| block)
        .collect()
}

/// Jeder `.route(…)`-Aufruf als `(Pfad, Argument-Text)`.
fn alle_route_bloecke(quelle: &str) -> Vec<(String, String)> {
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

/// Die Schutzschichten wirken nur, wenn sie auch montiert sind — und genau diese eine Zeile
/// je Schicht ist im Merge am leichtesten zu verlieren. Alle Unit-Tests der Module bleiben
/// dabei grün (sie bauen ihren eigenen Router bzw. Server), während in Produktion jeder
/// Request wieder unbegrenzt liefe. Der Guard prüft deshalb die Montagestellen im Quelltext.
#[test]
fn die_schutzschichten_sind_im_produktionscode_montiert() {
    let app = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let main = fs::read_to_string("src/main.rs").expect("src/main.rs lesbar");
    let mut fehlt = Vec::new();

    if !app.contains("zulassung::zulassung") {
        fehlt.push(
            "src/app.rs montiert die Zulassungssteuerung nicht mehr \
             (from_fn_with_state(…, zulassung::zulassung)) — Zeitbudget und \
             Gleichzeitigkeits-Cap sind damit wirkungslos",
        );
    }

    // Beide Serve-Pfade (TLS und Klartext) müssen die Verbindungsfristen setzen UND den
    // Akzeptor hängen — je zweimal, sonst ist einer der Pfade ungeschützt.
    let fristen = main.matches("zeitschranken_setzen").count();
    if fristen < 2 {
        fehlt.push(
            "src/main.rs ruft zeitschranken_setzen nicht in BEIDEN Serve-Pfaden auf — \
             ein Pfad läuft ohne Header-/Keep-Alive-Frist",
        );
    }
    let akzeptoren = main.matches("SemaphorAkzeptor").count();
    if akzeptoren < 2 {
        fehlt.push(
            "src/main.rs hängt den SemaphorAkzeptor nicht in BEIDE Serve-Pfade — \
             ein Pfad läuft ohne Verbindungs-Obergrenze",
        );
    }

    assert!(
        fehlt.is_empty(),
        "Schutzschichten nicht vollständig montiert:\n{}",
        fehlt.join("\n")
    );
}

/// Wertet den Ausdruck einer Body-Grenze aus: Summen von Produkten aus Zahlen und Konstanten
/// (`26 * 1024 * 1024`, `1024 * 1024 + 64 * 1024`, `UPLOAD_BODY_MAX`). Konstanten werden in den
/// mitgegebenen Quellen als `const NAME: usize = …;` gesucht. `None`, wenn etwas fehlt.
fn auswerten(ausdruck: &str, quellen: &[&str]) -> Option<usize> {
    ausdruck
        .split('+')
        .map(|summand| {
            summand
                .split('*')
                .map(|faktor| {
                    let faktor = faktor.trim();
                    let name = faktor.rsplit("::").next()?;
                    if let Ok(zahl) = name.replace('_', "").parse::<usize>() {
                        return Some(zahl);
                    }
                    let kopf = format!("const {name}: usize =");
                    let quelle = quellen.iter().find(|q| q.contains(&kopf))?;
                    let rest = &quelle[quelle.find(&kopf)? + kopf.len()..];
                    auswerten(&rest[..rest.find(';')?], quellen)
                })
                .product::<Option<usize>>()
        })
        .sum()
}

/// Alle Body-Grenzen eines Routen-Blocks, ausgewertet.
fn body_grenzen(block: &str, quellen: &[&str]) -> Vec<Result<usize, String>> {
    let nadel = "DefaultBodyLimit::max(";
    let mut grenzen = Vec::new();
    let mut rest = block;
    while let Some(start) = rest.find(nadel) {
        rest = &rest[start + nadel.len()..];
        let ende = rest.find(')').unwrap_or(rest.len());
        let ausdruck = &rest[..ende];
        grenzen.push(auswerten(ausdruck, quellen).ok_or_else(|| ausdruck.to_string()));
    }
    grenzen
}

fn ist_ausgenommen(methode: &str, pfad: &str) -> bool {
    OHNE_ZULASSUNGSGRENZE
        .iter()
        .any(|(m, p)| *m == methode && *p == pfad)
}

/// LFH-938, L24: ETB- und Schaden-Upload hatten 26 MiB Body-Grenze, standen aber nicht in der
/// Liste und brachen nach 60 s ab. Jede Route mit großem Body ist ein Upload: ihre
/// Body-Methode steht in der Liste, und sie trägt die gemeinsame Upload-Grenze.
#[test]
fn jede_grosse_body_grenze_ist_ausgenommen_und_traegt_die_upload_grenze() {
    let app = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let transfer = fs::read_to_string("src/transfer.rs").expect("src/transfer.rs lesbar");
    let quellen = [app.as_str(), transfer.as_str()];
    let mut verstoesse = Vec::new();
    let mut gefunden = 0;

    for (pfad, block) in alle_route_bloecke(&app) {
        for grenze in body_grenzen(&block, &quellen) {
            let grenze = match grenze {
                Ok(g) => g,
                Err(ausdruck) => {
                    verstoesse.push(format!(
                        "{pfad}: Body-Grenze `{ausdruck}` nicht auswertbar — Zahl oder \
                         `const …: usize` in src/app.rs bzw. src/transfer.rs verwenden"
                    ));
                    continue;
                }
            };
            if grenze <= GROSSER_BODY {
                continue;
            }
            gefunden += 1;
            let befreit = ["POST", "PUT", "PATCH"].iter().any(|m| {
                block.contains(&format!("{}(", m.to_lowercase())) && ist_ausgenommen(m, &pfad)
            });
            if !befreit {
                verstoesse.push(format!(
                    "{pfad}: Body-Grenze {grenze} B, aber keine Body-Methode in \
                     OHNE_ZULASSUNGSGRENZE — ein langsamer Upload endet nach dem Zeitbudget in 503"
                ));
            }
            if !block.contains("upload_grenze") {
                verstoesse.push(format!(
                    "{pfad}: Body-Grenze {grenze} B ohne `.layer(upload_grenze.clone())` — der \
                     Upload läuft ohne Parallelitätsgrenze"
                ));
            }
        }
    }

    assert!(
        gefunden >= 9,
        "nur {gefunden} Upload-Routen gefunden — Parser kaputt?"
    );
    assert!(
        verstoesse.is_empty(),
        "Upload-Routen nicht vollständig geschützt:\n{}",
        verstoesse.join("\n")
    );
}

/// Jede Route mit Download-Grenze ist ein Voll-BLOB-Download und steht mit GET in der Liste.
#[test]
fn jede_download_grenze_ist_ausgenommen() {
    let app = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let mut verstoesse = Vec::new();
    let mut gefunden = 0;
    for (pfad, block) in alle_route_bloecke(&app) {
        if !block.contains("download_grenze()") {
            continue;
        }
        gefunden += 1;
        if !block.contains("get(") || !ist_ausgenommen("GET", &pfad) {
            verstoesse.push(format!(
                "GET {pfad}: Download-Grenze, aber kein Eintrag in OHNE_ZULASSUNGSGRENZE"
            ));
        }
    }
    assert!(
        gefunden >= 9,
        "nur {gefunden} Download-Routen gefunden — Parser kaputt?"
    );
    assert!(verstoesse.is_empty(), "{}", verstoesse.join("\n"));
}

/// Jede Ausnahme hat einen Ersatz: Upload-Grenze, Download-Grenze oder einen namentlichen
/// Eintrag in [`OHNE_EIGENE_GRENZE`].
#[test]
fn jede_ausnahme_hat_eine_eigene_grenze() {
    let app = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    let mut verstoesse = Vec::new();
    for (methode, pfad) in OHNE_ZULASSUNGSGRENZE {
        if OHNE_EIGENE_GRENZE
            .iter()
            .any(|(m, p, _)| m == methode && p == pfad)
        {
            continue;
        }
        let aufruf = format!("{}(", methode.to_lowercase());
        let geschuetzt = route_bloecke(&app, pfad).iter().any(|b| {
            b.contains(&aufruf) && (b.contains("upload_grenze") || b.contains("download_grenze()"))
        });
        if !geschuetzt {
            verstoesse.push(format!(
                "{methode} {pfad}: ausgenommen, aber ohne Upload- oder Download-Grenze"
            ));
        }
    }
    for (methode, pfad, _) in OHNE_EIGENE_GRENZE {
        if !ist_ausgenommen(methode, pfad) {
            verstoesse.push(format!(
                "{methode} {pfad}: steht in OHNE_EIGENE_GRENZE, aber nicht in der Ausnahmeliste"
            ));
        }
    }
    assert!(verstoesse.is_empty(), "{}", verstoesse.join("\n"));
}

/// `ConcurrencyLimitLayer` gibt den Platz frei, sobald der Handler antwortet, nicht wenn der
/// Body gesendet ist (L23). Download-Routen nehmen deshalb `download_grenze()`.
#[test]
fn kein_concurrency_limit_layer_mehr_im_router() {
    let app = fs::read_to_string("src/app.rs").expect("src/app.rs lesbar");
    assert!(
        !app.contains("ConcurrencyLimitLayer"),
        "src/app.rs nutzt wieder ConcurrencyLimitLayer — der Platz fiele vor dem Body zurück"
    );
}

#[test]
fn ausdruck_der_body_grenze_wird_ausgewertet() {
    let quelle = "const X: usize = 2 * 1024;";
    assert_eq!(auswerten("26 * 1024 * 1024", &[]), Some(26 * 1024 * 1024));
    assert_eq!(
        auswerten("1024 * 1024 + 64 * 1024", &[]),
        Some(1024 * 1024 + 64 * 1024)
    );
    assert_eq!(auswerten("crate::a::X + 1", &[quelle]), Some(2049));
    assert_eq!(auswerten("UNBEKANNT", &[quelle]), None);
}
