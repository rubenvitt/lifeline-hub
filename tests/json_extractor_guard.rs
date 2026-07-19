//! Struktureller Guard gegen rohe Json-Extraktoren (LFH-267/F22).
//!
//! Erzwingt: kein Handler in `src/routes/` nimmt den Body über `axum::Json` entgegen —
//! ausschließlich über [`JsonBody`](lifeline_hub::extract::JsonBody), dessen Rejection dem
//! `{error}`-JSON-Vertrag folgt. `axum::Json` antwortet bei kaputtem Body mit `text/plain`;
//! das Frontend fällt dann auf ein generisches „Serverfehler (status)" zurück, statt die
//! deutsche Fachmeldung anzuzeigen.
//!
//! Der Guard deckt alle heutigen und künftigen Routen ab, ohne eine einzige zu feuern —
//! das ist der Grund, warum der Wrapper distinkt `JsonBody` heißt und nicht als `Json`
//! importiert wird: sonst wären Wrapper und Rohform im Quelltext ununterscheidbar.
//!
//! Parst Quelltext per Klammer-Tiefenzähler, bewusst ohne `regex`-Dependency (das Projekt
//! hält die Abhängigkeiten schlank) — dasselbe Vorgehen wie `tests/einsatz_kontext_guard.rs`.

use std::fs;

/// Grenzt die Argumentliste ab `fn name(` per Klammer-Tiefe ein.
///
/// Entscheidend für die Trennschärfe: nur die Signatur wird betrachtet. Ein
/// `let body: Json<Value> = Json(json!({…}))` im Rumpf (so in `src/routes/health.rs`)
/// ist eine RESPONSE und kein Extractor — der Guard darf darüber nicht stolpern.
fn argumentlisten(quelle: &str) -> Vec<String> {
    let bytes = quelle.as_bytes();
    let mut listen = Vec::new();
    let mut suche_ab = 0usize;

    while let Some(rel) = quelle[suche_ab..].find("fn ") {
        let fn_pos = suche_ab + rel;
        suche_ab = fn_pos + 3;
        // Öffnende Klammer der Signatur suchen (überspringt den Namen und ggf. Generics).
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

#[test]
fn kein_handler_nimmt_den_body_ueber_axum_json_entgegen() {
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
            if args.contains(": Json<") {
                let signatur = args.split_whitespace().collect::<Vec<_>>().join(" ");
                let gekuerzt = signatur.chars().take(120).collect::<String>();
                verstoesse.push(format!("{}: {gekuerzt}", pfad.display()));
            }
        }
    }

    assert!(
        verstoesse.is_empty(),
        "Diese Handler nehmen den Body noch über `axum::Json` statt `crate::extract::JsonBody` \
         entgegen und brechen damit den {{error}}-JSON-Vertrag (LFH-267/F22):\n{}",
        verstoesse.join("\n")
    );
}

/// Beweist, dass der Guard tatsächlich greift — ein Guard, der nur per Konstruktion grün
/// ist, sagt nichts aus. Prüft die Erkennungslogik gegen synthetische Signaturen, inklusive
/// des Falls, den sie NICHT melden darf (Response im Rumpf).
#[test]
fn guard_erkennt_verstoesse_und_ignoriert_responses() {
    let mit_verstoss = r#"
        pub async fn anlegen(
            State(state): State<AppState>,
            Json(body): Json<AnlegenBody>,
        ) -> Result<Json<Anzeige>, AppError> {
            Ok(Json(anzeige))
        }
    "#;
    let treffer: Vec<_> = argumentlisten(mit_verstoss)
        .into_iter()
        .filter(|a| a.contains(": Json<"))
        .collect();
    assert_eq!(
        treffer.len(),
        1,
        "roher Json-Extractor in der Signatur muss gemeldet werden"
    );

    let sauber = r#"
        pub async fn anlegen(
            State(state): State<AppState>,
            JsonBody(body): JsonBody<AnlegenBody>,
        ) -> Result<Json<Anzeige>, AppError> {
            let body: Json<Value> = Json(json!({ "ok": true }));
            Ok(body)
        }
    "#;
    let treffer: Vec<_> = argumentlisten(sauber)
        .into_iter()
        .filter(|a| a.contains(": Json<"))
        .collect();
    assert!(
        treffer.is_empty(),
        "JsonBody-Signatur und `let x: Json<T>` im Rumpf sind KEIN Verstoß, gemeldet: {treffer:?}"
    );
}
