//! Struktureller Guard gegen rohe Path-Extraktoren (LFH-317/F22-B).
//!
//! Erzwingt: kein Handler in `src/routes/` nimmt eine Route-ID über `axum::extract::Path`
//! entgegen — ausschließlich über [`PfadParam`](lifeline_hub::extract::PfadParam), dessen
//! Rejection dem `{error}`-JSON-Vertrag folgt. axums `Path` antwortet bei einer nicht-
//! deserialisierbaren ID (z. B. `abc` statt einer Zahl) mit `text/plain`; das Frontend fällt
//! dann auf ein generisches „Serverfehler (status)" zurück statt die deutsche Fachmeldung.
//!
//! Schwestertest von `tests/json_extractor_guard.rs` — `argumentlisten()` ist dort schon
//! generisch, hier 1:1 gespiegelt (bewusst kopiert statt geteilt: Integrationstests sind
//! eigene Crates, ein gemeinsames Modul lohnt die zwei Dutzend Zeilen nicht).
//!
//! **Token-Grenze statt `contains`:** Ein nacktes `contains("Path<")` würde `FsPath<`
//! (`std::path::Path as FsPath` in `karte.rs`) fälschlich melden und `PfadParam<` gar nicht
//! (kein „Path"-Teilstring). Deshalb wird nur ein `Path<` gewertet, dem KEIN Wortzeichen
//! vorausgeht (`:` schon — damit auch die voll qualifizierte Form `axum::extract::Path<`
//! auffliegt, `FsPath<` aber nicht).
//!
//! **Kein Allowlist-Bedarf:** Der Scan ist auf `src/routes/` begrenzt. `src/extract.rs`
//! (der Wrapper selbst) und `src/einsatz/kontext.rs` (die keyed `Path<HashMap>`-Extraktion des
//! `EinsatzKontext`, schon via `AppError::NotFound` im Envelope) liegen außerhalb — durch
//! Konstruktion ausgenommen, nicht durch eine pflegebedürftige Liste. Ein Vorabscan
//! (`rg -l "Path<" src`) hat bestätigt: außerhalb von `src/routes/` gibt es keinen weiteren
//! id-nehmenden Handler, nur jene eine legitime Extractor-interne Stelle.

use std::fs;

/// Grenzt die Argumentliste ab `fn name(` per Klammer-Tiefe ein — nur die Signatur, nicht der
/// Rumpf (ein `Path<T>` in einem Response-/Helferausdruck wäre kein Extractor).
fn argumentlisten(quelle: &str) -> Vec<String> {
    let bytes = quelle.as_bytes();
    let mut listen = Vec::new();
    let mut suche_ab = 0usize;

    while let Some(rel) = quelle[suche_ab..].find("fn ") {
        let fn_pos = suche_ab + rel;
        suche_ab = fn_pos + 3;
        let Some(open_rel) = quelle[fn_pos..].find('(') else {
            continue;
        };
        let open = fn_pos + open_rel;

        let mut tiefe = 0i32;
        for (offset, &b) in bytes[open..].iter().enumerate() {
            match b {
                b'(' => tiefe += 1,
                b')' => {
                    tiefe -= 1;
                    if tiefe == 0 {
                        listen.push(quelle[open..=open + offset].to_string());
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    listen
}

/// Ein rohes axum-`Path<…>` in der Signatur — token-genau: `Path<`, dem KEIN Wortzeichen
/// vorausgeht. `FsPath<` (vorangehendes `s`) wird ausgeschlossen, `axum::extract::Path<`
/// (vorangehendes `:`) und das nackte `Path<` gemeldet. `PfadParam<` trägt kein „Path" und
/// kann so gar nicht treffen.
fn enthaelt_rohes_path(signatur: &str) -> bool {
    let mut suche_ab = 0usize;
    while let Some(rel) = signatur[suche_ab..].find("Path<") {
        let pos = suche_ab + rel;
        let davor_ok = signatur[..pos]
            .chars()
            .next_back()
            .is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        if davor_ok {
            return true;
        }
        suche_ab = pos + "Path<".len();
    }
    false
}

#[test]
fn kein_handler_nimmt_eine_id_ueber_axum_path_entgegen() {
    let mut verstoesse = Vec::new();

    let mut dateien: Vec<_> = fs::read_dir("src/routes")
        .expect("src/routes lesbar")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "rs"))
        .collect();
    dateien.sort();

    assert!(
        dateien.len() > 30,
        "Guard hat nur {} Routen-Dateien gefunden — Pfad kaputt?",
        dateien.len()
    );

    for pfad in &dateien {
        let quelle = fs::read_to_string(pfad).expect("Routen-Datei lesbar");
        for args in argumentlisten(&quelle) {
            if enthaelt_rohes_path(&args) {
                let signatur = args.split_whitespace().collect::<Vec<_>>().join(" ");
                let gekuerzt = signatur.chars().take(120).collect::<String>();
                verstoesse.push(format!("{}: {gekuerzt}", pfad.display()));
            }
        }
    }

    assert!(
        verstoesse.is_empty(),
        "Diese Handler nehmen eine Route-ID noch über `axum::extract::Path` statt \
         `crate::extract::PfadParam` entgegen und brechen damit den {{error}}-JSON-Vertrag \
         (LFH-317/F22-B):\n{}",
        verstoesse.join("\n")
    );
}

/// Beweist, dass der Guard greift — inklusive der beiden Fälle, die er NICHT melden darf
/// (`FsPath<` und `PfadParam<`). Ein Guard, der nur per Konstruktion grün ist, sagt nichts.
#[test]
fn guard_erkennt_rohes_path_und_ignoriert_fspath_und_pfadparam() {
    let mit_verstoss = r#"
        pub async fn laden(
            State(state): State<AppState>,
            Path((id, sub)): Path<(i64, i64)>,
        ) -> Result<Json<Anzeige>, AppError> { unimplemented!() }
    "#;
    let treffer: Vec<_> = argumentlisten(mit_verstoss)
        .into_iter()
        .filter(|a| enthaelt_rohes_path(a))
        .collect();
    assert_eq!(
        treffer.len(),
        1,
        "rohes Path< in der Signatur muss gemeldet werden"
    );

    // Voll qualifizierte Form muss ebenfalls auffliegen.
    let qualifiziert = "fn f(x: axum::extract::Path<String>) {}";
    assert!(
        enthaelt_rohes_path(&argumentlisten(qualifiziert)[0]),
        "axum::extract::Path< muss gemeldet werden"
    );

    // FsPath (std::path::Path as FsPath) und der Wrapper PfadParam sind KEIN Verstoß.
    let sauber = r#"
        pub async fn f(
            PfadParam((id, sub)): PfadParam<(i64, String)>,
            dir: &FsPath,
        ) -> Response { unimplemented!() }
    "#;
    let treffer: Vec<_> = argumentlisten(sauber)
        .into_iter()
        .filter(|a| enthaelt_rohes_path(a))
        .collect();
    assert!(
        treffer.is_empty(),
        "PfadParam< und FsPath< sind KEIN Verstoß, gemeldet: {treffer:?}"
    );
}
