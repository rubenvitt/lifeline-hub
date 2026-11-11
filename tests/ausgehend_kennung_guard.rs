//! Wächter für die Kennung ausgehender Abrufe (LLH-1547, Risiko R14).
//!
//! Erzwingt in `src/`:
//! - Der Platzhalter `(+https://github.com/)` steht nirgends mehr.
//! - Produktiver Code baut HTTP-Clients nur über `crate::ausgehend::client_builder`. Ein
//!   `reqwest::Client::builder()`, `Client::new()`, `ClientBuilder::new()` oder `reqwest::get(`
//!   schickte sonst gar keine Kennung, ein eigenes `.user_agent(…)` eine ohne Version und
//!   Betreiberkontakt.
//!
//! Testcode ist ausgenommen: die Rümpfe von `#[cfg(test)] mod … { … }`, wo immer sie stehen.
//! Liest Quelltext, bewusst ohne `regex`-Dependency, wie `tests/json_extractor_guard.rs`.

use std::fs;
use std::path::{Path, PathBuf};

/// Die eine Stelle, an der ein Client gebaut und die Kennung gesetzt wird.
const ZENTRALE: &str = "src/ausgehend.rs";

/// Sammelt rekursiv alle `.rs`-Dateien unter `dir`.
fn rust_dateien(dir: &Path, aus: &mut Vec<PathBuf>) {
    for eintrag in fs::read_dir(dir).expect("Verzeichnis lesbar") {
        let pfad = eintrag.expect("Eintrag lesbar").path();
        if pfad.is_dir() {
            rust_dateien(&pfad, aus);
        } else if pfad.extension().is_some_and(|e| e == "rs") {
            aus.push(pfad);
        }
    }
}

/// Der produktive Teil einer Datei: der Quelltext ohne die Rümpfe von `#[cfg(test)] mod … { … }`.
/// Ein Testmodul darf mitten in der Datei stehen (`src/routes/karte.rs`); `mod tests;` verweist
/// auf eine eigene Datei, die selbst geprüft wird.
fn ohne_testmodule(quelle: &str) -> String {
    let mut produktiv = String::new();
    let mut ab = 0;
    while let Some(rel) = quelle[ab..].find("#[cfg(test)]") {
        let pos = ab + rel;
        let nach_attribut = pos + "#[cfg(test)]".len();
        let rest = quelle[nach_attribut..].trim_start();
        let rest = rest.strip_prefix("pub ").unwrap_or(rest);
        let klammer = rest.strip_prefix("mod ").and_then(|r| {
            let i = r.find(['{', ';'])?;
            (r.as_bytes()[i] == b'{').then(|| quelle.len() - r.len() + i)
        });
        match klammer {
            Some(auf) => {
                produktiv.push_str(&quelle[ab..pos]);
                ab = rumpf_ende(quelle, auf);
            }
            None => {
                produktiv.push_str(&quelle[ab..nach_attribut]);
                ab = nach_attribut;
            }
        }
    }
    produktiv.push_str(&quelle[ab..]);
    produktiv
}

/// Index hinter der schließenden Klammer zur öffnenden bei `auf`. Zählt Klammern außerhalb von
/// Zeichenketten, Zeichenliteralen und Zeilenkommentaren; ohne Gegenstück das Dateiende.
fn rumpf_ende(quelle: &str, auf: usize) -> usize {
    let b = quelle.as_bytes();
    let mut tiefe = 0i32;
    let mut i = auf;
    while i < b.len() {
        match b[i] {
            b'"' => {
                i += 1;
                while i < b.len() && b[i] != b'"' {
                    if b[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            b'\'' => i = zeichenliteral_ende(quelle, i),
            b'/' if b.get(i + 1) == Some(&b'/') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b'{' => tiefe += 1,
            b'}' => {
                tiefe -= 1;
                if tiefe == 0 {
                    return i + 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    b.len()
}

/// Bei einem `'` an `pos`: Index des schließenden `'` eines Zeichenliterals (`'x'`, `'ä'`,
/// `'\\''`, `'\\\\'`, `'\\u{7b}'`), sonst `pos` selbst (Lifetime wie `'a`).
fn zeichenliteral_ende(quelle: &str, pos: usize) -> usize {
    let rest = &quelle[pos + 1..];
    if let Some(escape) = rest.strip_prefix('\\') {
        // Das Zeichen nach dem Backslash gehört zum Literal, auch ein `'`.
        let nach = escape.chars().next().map_or(0, char::len_utf8);
        return escape[nach..]
            .find('\'')
            .map_or(pos, |i| pos + 2 + nach + i);
    }
    match rest.chars().next() {
        Some(c) if rest[c.len_utf8()..].starts_with('\'') => pos + 1 + c.len_utf8(),
        _ => pos,
    }
}

/// Alle Rust-Dateien unter `src/` als (Pfad relativ zur Wurzel, Inhalt).
fn src_dateien() -> Vec<(String, String)> {
    let wurzel = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut dateien = Vec::new();
    rust_dateien(&wurzel.join("src"), &mut dateien);
    dateien.sort();
    assert!(dateien.len() > 100, "src/ nicht gefunden");
    dateien
        .into_iter()
        .map(|p| {
            let rel = p
                .strip_prefix(wurzel)
                .expect("unter der Wurzel")
                .to_string_lossy()
                .replace('\\', "/");
            (rel, fs::read_to_string(&p).expect("Datei lesbar"))
        })
        .collect()
}

/// Der Platzhalter aus R14 kehrt nicht zurück.
#[test]
fn kein_platzhalter_im_user_agent() {
    // Zusammengesetzt, sonst fände der Wächter sein eigenes Literal (liegt aber unter tests/).
    let platzhalter = concat!("(+https://github.com", "/)");
    let funde: Vec<String> = src_dateien()
        .into_iter()
        .filter(|(_, quelle)| quelle.contains(platzhalter))
        .map(|(pfad, _)| pfad)
        .collect();
    assert!(
        funde.is_empty(),
        "Platzhalter {platzhalter} im User-Agent (LLH-1547): {funde:?}. \
         Die Kennung kommt aus crate::ausgehend::user_agent."
    );
}

/// Produktiver Code baut keinen HTTP-Client und setzt keinen User-Agent an der Zentrale vorbei.
#[test]
fn http_clients_nur_ueber_die_zentrale_kennung() {
    let verboten = [
        "Client::builder()",
        "ClientBuilder::new()",
        "reqwest::Client::new()",
        "reqwest::get(",
        ".user_agent(",
    ];
    let mut funde = Vec::new();
    for (pfad, quelle) in src_dateien() {
        if pfad == ZENTRALE {
            continue;
        }
        let produktiv = ohne_testmodule(&quelle);
        for (nr, zeile) in produktiv.lines().enumerate() {
            let code = zeile.split("//").next().unwrap_or_default();
            for muster in verboten {
                if code.contains(muster) {
                    funde.push(format!("{pfad}:{}: {}", nr + 1, zeile.trim()));
                }
            }
        }
    }
    assert!(
        funde.is_empty(),
        "HTTP-Client ohne zentrale Kennung (LLH-1547). Statt eines eigenen Builders \
         crate::ausgehend::client_builder(Zweck::…) nehmen, ggf. einen neuen Zweck anlegen:\n{}",
        funde.join("\n")
    );
}

/// Die Zentrale setzt die Kennung samt Version wirklich.
#[test]
fn zentrale_setzt_die_kennung() {
    let quelle = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(ZENTRALE))
        .expect("src/ausgehend.rs lesbar");
    let produktiv = ohne_testmodule(&quelle);
    assert!(
        produktiv.contains("reqwest::Client::builder().user_agent(user_agent(zweck))"),
        "client_builder setzt die Kennung nicht mehr"
    );
    assert!(produktiv.contains("env!(\"CARGO_PKG_VERSION\")"));
}

/// Testmodule fallen auch mitten in der Datei heraus, `mod x;` bleibt stehen.
#[test]
fn testmodule_mitten_in_der_datei_fallen_heraus() {
    let quelle = "fn a() {}\n#[cfg(test)]\nmod extern_;\n#[cfg(test)]\nmod t {\n    \
                  fn x() { let s = \"}\"; let c = '}'; // }\n }\n}\nfn b() {}\n\
                  #[cfg(test)]\npub mod ende {\n    y\n}\n";
    assert_eq!(
        ohne_testmodule(quelle),
        "fn a() {}\n#[cfg(test)]\nmod extern_;\n\nfn b() {}\n\n"
    );
    assert_eq!(ohne_testmodule("fn a() {}"), "fn a() {}");
}

/// Escapes in Zeichenliteralen verschieben die Klammertiefe nicht, Lifetimes sind keine
/// Zeichenliterale (Review #1265).
#[test]
fn zeichenliterale_mit_escapes_und_lifetimes() {
    let quelle =
        "#[cfg(test)]\nmod t {\n    const Z: [char; 4] = ['\\\\','{','\\'','\\u{7b}'];\n    \
                  fn f<'a>(x: &'a str) -> &'a str { x }\n    const U: char = 'ä';\n}\nfn b() {}\n";
    assert_eq!(ohne_testmodule(quelle), "\nfn b() {}\n");
}
