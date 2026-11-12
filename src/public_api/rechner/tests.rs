use serde_json::{json, Value};

use super::*;

/// Schickt einen Body durch Einlesen, Prüfung und Rechnung, ohne Werte einer Organisation.
fn rechnen(body: Value) -> Result<UnterkunftResponse, ApiError> {
    let req: UnterkunftRequest = parse_body(body.to_string().as_bytes())?;
    calculate(req, &HashMap::new())
}

/// Erwartet eine Ablehnung mit `code`, deren Text `feld` nennt.
#[track_caller]
fn abgelehnt(body: Value, code: ErrorCode, feld: &str) {
    match rechnen(body.clone()) {
        Ok(_) => panic!("{body} wurde angenommen, erwartet {}", code.as_str()),
        Err(e) => {
            assert_eq!(e.code, code, "{body} → {}", e.message);
            assert_eq!(e.status, code.status(), "{body}");
            assert!(
                e.message.contains(feld),
                "{body}: „{}“ nennt {feld} nicht",
                e.message
            );
        }
    }
}

fn personen(gesamt: Value) -> Value {
    json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": gesamt } })
}

fn raeume(raeume: Value) -> Value {
    json!({ "weg": "raeume", "trennung": false, "raeume": raeume })
}

fn raum() -> Value {
    json!({ "laenge_m": 10, "breite_m": 8 })
}

#[test]
fn zelttypen_des_vertrags_sind_die_der_basis() {
    let basis: Vec<&str> = unterkunft::zelttypen()
        .iter()
        .map(|z| z.typ.as_str())
        .collect();
    let vertrag: Vec<&str> = ZeltTyp::ALLE.iter().map(|t| t.as_str()).collect();
    assert_eq!(vertrag, basis);
}

#[test]
fn ein_ungueltiges_feld_ist_400_und_nennt_das_feld() {
    use ErrorCode::InvalidField as F;
    // Unbekanntes Feld, auf jeder Ebene.
    let mut mit_einsatz = personen(json!(10));
    mit_einsatz["einsatz_id"] = json!(7);
    abgelehnt(mit_einsatz, F, "einsatz_id");
    abgelehnt(
        json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": 1, "kinder": 2 } }),
        F,
        "kinder",
    );
    abgelehnt(
        raeume(json!([{ "laenge_m": 1, "breite_m": 1, "hoehe_m": 3 }])),
        F,
        "hoehe_m",
    );
    // Unbekannte Werte.
    abgelehnt(
        json!({ "weg": "betten", "trennung": false, "personen": { "gesamt": 1 } }),
        F,
        "weg",
    );
    abgelehnt(
        json!({ "weg": "raeume", "trennung": true,
                "raeume": [{ "laenge_m": 1, "breite_m": 1, "belegung": "kinder" }] }),
        F,
        "raeume[0].belegung",
    );
    abgelehnt(
        json!({ "weg": "zelte", "trennung": false, "zelte": { "gesamt": { "sg60": 1 } } }),
        F,
        "zelte.gesamt.sg60",
    );
    // Zahlen für sich.
    abgelehnt(personen(json!(-1)), F, "personen.gesamt");
    abgelehnt(personen(json!(10.5)), F, "personen.gesamt");
    abgelehnt(
        json!({ "weg": "flaeche", "trennung": false, "flaeche": { "gesamt_m2": -0.5 } }),
        F,
        "flaeche.gesamt_m2",
    );
    abgelehnt(
        json!({ "weg": "zelte", "trennung": false, "zelte": { "gesamt": { "sg30": 1.5 } } }),
        F,
        "zelte.gesamt.sg30",
    );
    // Pflichtfelder und Typen meldet schon das Einlesen.
    abgelehnt(
        json!({ "weg": "personen", "personen": { "gesamt": 1 } }),
        F,
        "trennung",
    );
    abgelehnt(personen(json!("zehn")), F, "personen.gesamt");
    abgelehnt(
        json!({ "weg": "personen", "trennung": "ja", "personen": { "gesamt": 1 } }),
        F,
        "trennung",
    );
    abgelehnt(
        raeume(json!([raum(), { "laenge_m": "10", "breite_m": 8 }])),
        F,
        "raeume[1].laenge_m",
    );
    abgelehnt(raeume(json!([{ "laenge_m": 10 }])), F, "raeume[0]");
}

#[test]
fn die_eingabe_hat_feste_grenzen() {
    use ErrorCode::InvalidField as F;
    assert!(rechnen(personen(json!(1_000_000))).is_ok());
    abgelehnt(personen(json!(1_000_001)), F, "personen.gesamt");

    assert!(rechnen(raeume(json!(vec![raum(); RAEUME_MAX]))).is_ok());
    abgelehnt(raeume(json!(vec![raum(); RAEUME_MAX + 1])), F, "raeume");

    let abzug = json!({ "laenge_m": 0.5, "breite_m": 0.5 });
    let mit_abzuegen = |n: usize| {
        raeume(json!([{ "laenge_m": 10, "breite_m": 8, "abzuege": vec![abzug.clone(); n] }]))
    };
    assert!(rechnen(mit_abzuegen(ABZUEGE_MAX)).is_ok());
    abgelehnt(mit_abzuegen(ABZUEGE_MAX + 1), F, "raeume[0].abzuege");

    assert!(rechnen(raeume(json!([{ "laenge_m": 1000, "breite_m": 1000 }]))).is_ok());
    abgelehnt(
        raeume(json!([{ "laenge_m": 1000.5, "breite_m": 8 }])),
        F,
        "raeume[0].laenge_m",
    );
    abgelehnt(
        raeume(json!([raum(), { "laenge_m": 10, "breite_m": 0 }])),
        F,
        "raeume[1].breite_m",
    );
    abgelehnt(
        raeume(json!([{ "laenge_m": 10, "breite_m": 8,
                        "abzuege": [{ "laenge_m": 1, "breite_m": 1 }, { "laenge_m": 0, "breite_m": 1 }] }])),
        F,
        "raeume[0].abzuege[1].laenge_m",
    );

    let flaeche =
        |m2: f64| json!({ "weg": "flaeche", "trennung": false, "flaeche": { "gesamt_m2": m2 } });
    assert!(rechnen(flaeche(1_000_000.0)).is_ok());
    abgelehnt(flaeche(1_000_000.5), F, "flaeche.gesamt_m2");

    let zelte =
        |n: u64| json!({ "weg": "zelte", "trennung": false, "zelte": { "gesamt": { "sg50": n } } });
    assert!(rechnen(zelte(1000)).is_ok());
    abgelehnt(zelte(1001), F, "zelte.gesamt.sg50");

    let benannt =
        |n: usize| raeume(json!([{ "bezeichnung": "x".repeat(n), "laenge_m": 10, "breite_m": 8 }]));
    assert!(rechnen(benannt(BEZEICHNUNG_MAX)).is_ok());
    abgelehnt(benannt(BEZEICHNUNG_MAX + 1), F, "raeume[0].bezeichnung");
}

#[test]
fn eine_widerspruechliche_grundlage_ist_422() {
    use ErrorCode::Unprocessable as U;
    // Block fehlt oder gehört zu einem anderen Weg.
    abgelehnt(
        json!({ "weg": "personen", "trennung": false }),
        U,
        "personen",
    );
    abgelehnt(json!({ "weg": "raeume", "trennung": false }), U, "raeume");
    let mut fremd = personen(json!(10));
    fremd["raeume"] = json!([raum()]);
    abgelehnt(fremd, U, "raeume");
    // gesamt neben einer Gruppe, gesamt bei Trennung, Trennung ohne Gruppe, leerer Block.
    abgelehnt(
        json!({ "weg": "personen", "trennung": false, "personen": { "gesamt": 10, "maenner": 4 } }),
        U,
        "personen.gesamt",
    );
    abgelehnt(
        json!({ "weg": "personen", "trennung": true, "personen": { "gesamt": 100 } }),
        U,
        "personen.gesamt",
    );
    abgelehnt(
        json!({ "weg": "personen", "trennung": true, "personen": {} }),
        U,
        "personen",
    );
    abgelehnt(
        json!({ "weg": "personen", "trennung": false, "personen": {} }),
        U,
        "personen",
    );
    abgelehnt(
        json!({ "weg": "flaeche", "trennung": true, "flaeche": { "gesamt_m2": 100 } }),
        U,
        "flaeche.gesamt_m2",
    );
    // Zelte ohne Trennung brauchen gesamt.
    abgelehnt(
        json!({ "weg": "zelte", "trennung": false, "zelte": { "maenner": { "sg20": 1 } } }),
        U,
        "zelte",
    );
    // Gruppen kommen als Paar: eine fehlende Gruppe zählte sonst still 0.
    abgelehnt(
        json!({ "weg": "personen", "trennung": true, "personen": { "maenner": 50 } }),
        U,
        "maenner und frauen",
    );
    abgelehnt(
        json!({ "weg": "personen", "trennung": false, "personen": { "maenner": 30 } }),
        U,
        "maenner und frauen",
    );
    abgelehnt(
        json!({ "weg": "flaeche", "trennung": false, "flaeche": { "frauen_m2": 30 } }),
        U,
        "maenner_m2 und frauen_m2",
    );
    abgelehnt(
        json!({ "weg": "zelte", "trennung": true, "zelte": { "frauen": { "sg20": 1 } } }),
        U,
        "maenner und frauen",
    );
    // Belegung eines Raums gegen die Trennung.
    abgelehnt(
        json!({ "weg": "raeume", "trennung": true, "raeume": [raum()] }),
        U,
        "raeume[0].belegung",
    );
    abgelehnt(
        raeume(json!([{ "laenge_m": 10, "breite_m": 8, "belegung": "frauen" }])),
        U,
        "raeume[0].belegung",
    );
}

/// Ein Feld für sich geht dem Zusammenhang vor (`src/AGENTS.md`, „Statuscode-Konvention“).
#[test]
fn ein_ungueltiges_feld_geht_dem_widerspruch_vor() {
    // Der Block gehört nicht zum Weg (422), aber seine Zahl ist für sich ungültig (400).
    let mut body = personen(json!(10));
    body["flaeche"] = json!({ "gesamt_m2": -1 });
    abgelehnt(body, ErrorCode::InvalidField, "flaeche.gesamt_m2");
    // Ebenso ein unbekannter Richtwert neben einem fehlenden Block.
    abgelehnt(
        json!({ "weg": "personen", "trennung": false, "richtwerte": { "foo": 1 } }),
        ErrorCode::InvalidField,
        "foo",
    );
}

#[test]
fn gueltige_randfaelle() {
    // Ohne Trennung nur Männer und Frauen: die Summe als eine Gruppe.
    let e = rechnen(
        json!({ "weg": "personen", "trennung": false, "personen": { "maenner": 30, "frauen": 12 } }),
    )
    .expect("gültig")
    .ergebnis;
    assert_eq!(e.personen, 42);
    assert_eq!(e.gruppen.len(), 1);
    assert_eq!(e.gruppen[0].gruppe, PersonenGruppe::Gesamt);
    // Mit Trennung beide Gruppen; eine leere ist ausdrücklich 0.
    let e = rechnen(
        json!({ "weg": "personen", "trennung": true, "personen": { "maenner": 0, "frauen": 12 } }),
    )
    .expect("gültig")
    .ergebnis;
    assert_eq!((e.gruppen[0].personen, e.gruppen[1].personen), (0, 12));
    let e = rechnen(
        json!({ "weg": "zelte", "trennung": true, "zelte": { "maenner": {}, "frauen": { "sg50": 1 } } }),
    )
    .expect("gültig")
    .ergebnis;
    assert_eq!((e.gruppen[0].personen, e.gruppen[1].personen), (0, 14));
    // Keine Räume und keine Personen ergeben 0, keinen Fehler.
    assert_eq!(
        rechnen(raeume(json!([])))
            .expect("gültig")
            .ergebnis
            .personen,
        0
    );
    assert_eq!(
        rechnen(personen(json!(0)))
            .expect("gültig")
            .ergebnis
            .personen,
        0
    );
    // Ein Block mit `null` zählt als nicht gesendet.
    let mut body = personen(json!(10));
    body["raeume"] = Value::Null;
    assert!(rechnen(body).is_ok());
    // Die Bezeichnung kommt getrimmt zurück.
    let e = rechnen(raeume(
        json!([{ "bezeichnung": "  Halle ", "laenge_m": 10, "breite_m": 8 }]),
    ))
    .expect("gültig")
    .ergebnis;
    let raum = &e.kapazitaet.expect("Kapazität").raeume.expect("Räume")[0];
    assert_eq!((raum.bezeichnung.as_str(), raum.plaetze), ("Halle", 20));
}

#[test]
fn richtwerte_der_anfrage_gehen_vor_organisation_vor_basis() {
    let org = HashMap::from([
        ("flaeche_je_person_m2".to_string(), 5.0),
        ("wasser_je_person_l".to_string(), 30.0),
        // Ein Schlüssel, den die Basis nicht mehr kennt, fällt weg.
        ("abgeschafft".to_string(), 1.0),
    ]);
    let mut body = personen(json!(100));
    body["richtwerte"] = json!({ "wasser_je_person_l": 15 });
    let req: UnterkunftRequest = parse_body(body.to_string().as_bytes()).expect("lesbar");
    let antwort = calculate(req, &org).expect("gültig");

    assert_eq!(antwort.ergebnis.versorgung.wasser_l_tag, 1500);
    assert_eq!(antwort.ergebnis.schlafen.flaeche_m2, 500.0);
    assert_eq!(antwort.stand, unterkunft::stand());
    assert_eq!(antwort.richtwerte.len(), unterkunft::basis().len());
    let wert = |schluessel: &str| {
        let r = antwort
            .richtwerte
            .iter()
            .find(|r| r.schluessel == schluessel)
            .expect("Schlüssel der Basis");
        (r.wert, r.herkunft)
    };
    assert_eq!(wert("wasser_je_person_l"), (15.0, RichtwertEbene::Anfrage));
    assert_eq!(wert("flaeche_je_person_m2"), (5.0, RichtwertEbene::Org));
    assert_eq!(wert("dusche_je_personen"), (20.0, RichtwertEbene::Basis));
}

#[test]
fn ein_richtwert_der_anfrage_wird_wie_ein_gespeicherter_geprueft() {
    use ErrorCode::InvalidField as F;
    let mit = |richtwerte: Value| {
        let mut body = personen(json!(100));
        body["richtwerte"] = richtwerte;
        body
    };
    abgelehnt(mit(json!({ "foo": 1 })), F, "foo");
    // Grenzen 5 bis 500.
    abgelehnt(
        mit(json!({ "wasser_je_person_l": 4 })),
        F,
        "wasser_je_person_l",
    );
    abgelehnt(
        mit(json!({ "wasser_je_person_l": 4 })),
        F,
        "zwischen 5 und 500",
    );
    abgelehnt(
        mit(json!({ "zelt_sg30_schlafplaetze": 10.5 })),
        F,
        "zelt_sg30_schlafplaetze",
    );
    abgelehnt(
        mit(json!({ "wasser_je_person_l": null })),
        F,
        "richtwerte.wasser_je_person_l",
    );
    assert!(rechnen(mit(json!({}))).is_ok());
}

/// Was `serde_json` für sich annähme oder ohne Feld meldete (Befunde des Reviews vor dem PR).
#[test]
fn das_einlesen_ist_streng_und_nennt_den_pfad() {
    #[track_caller]
    fn abgelehnt_roh(body: &str, feld: &str) {
        let e = parse_body::<UnterkunftRequest>(body.as_bytes())
            .and_then(|req| calculate(req, &HashMap::new()))
            .err()
            .unwrap_or_else(|| panic!("{body} wurde angenommen"));
        assert_eq!(e.code, ErrorCode::InvalidField, "{body} → {}", e.message);
        assert!(
            e.message.contains(feld),
            "{body}: „{}“ nennt {feld} nicht",
            e.message
        );
    }
    // Eine Zahl, die kein f64 fasst, ist gültiges JSON an einem bestimmten Feld.
    abgelehnt_roh(
        r#"{"weg":"personen","trennung":false,"personen":{"gesamt":1e999}}"#,
        "personen.gesamt: Zahl außerhalb des darstellbaren Bereichs",
    );
    abgelehnt_roh(
        r#"{"weg":"raeume","trennung":false,"raeume":[{"laenge_m":1e999,"breite_m":1}]}"#,
        "raeume[0].laenge_m",
    );
    // Ein doppelter Schlüssel: der erste Wert entginge sonst der Prüfung.
    abgelehnt_roh(
        r#"{"weg":"personen","trennung":false,"personen":{"gesamt":1},
            "richtwerte":{"wasser_je_person_l":4,"wasser_je_person_l":15}}"#,
        "wasser_je_person_l",
    );
    abgelehnt_roh(
        r#"{"weg":"zelte","trennung":false,"zelte":{"gesamt":{"sg50":1001,"sg50":3}}}"#,
        "sg50",
    );
    abgelehnt_roh(
        r#"{"weg":"personen","trennung":false,"personen":{"gesamt":1,"gesamt":2}}"#,
        "gesamt",
    );
    // Eine Liste an Stelle eines Objekts: serde läse sie sonst in Feldreihenfolge.
    abgelehnt_roh(
        r#"{"weg":"personen","trennung":false,"personen":[100,null,null]}"#,
        "personen",
    );
    abgelehnt_roh(
        r#"{"weg":"raeume","trennung":false,"raeume":[[null,10,8]]}"#,
        "raeume[0]",
    );
    abgelehnt_roh(
        r#"{"weg":"raeume","trennung":false,"raeume":[{"laenge_m":10,"breite_m":8,"abzuege":[[1,1]]}]}"#,
        "raeume[0].abzuege[0]",
    );
    abgelehnt_roh(r#"["personen",false,{"gesamt":1}]"#, "Format");
    // Zeichen hinter dem Objekt.
    abgelehnt_roh(
        r#"{"weg":"personen","trennung":false,"personen":{"gesamt":1}} {}"#,
        "JSON",
    );
}

/// Die Antwort trägt nie eine negative Null: eine leere `f64`-Summe ist in Rust `-0.0`, und JSON
/// kennt `-0.0` auch als Eingabe.
#[test]
fn die_antwort_traegt_keine_negative_null() {
    let text = |body: &str| {
        let req: UnterkunftRequest = parse_body(body.as_bytes()).expect("lesbar");
        serde_json::to_string(&calculate(req, &HashMap::new()).expect("gültig")).unwrap()
    };
    for body in [
        r#"{"weg":"personen","trennung":false,"personen":{"gesamt":0}}"#,
        r#"{"weg":"raeume","trennung":false,"raeume":[]}"#,
        r#"{"weg":"raeume","trennung":false,"raeume":[{"laenge_m":1,"breite_m":1,"abzuege":[{"laenge_m":1.001,"breite_m":1}]}]}"#,
        r#"{"weg":"flaeche","trennung":false,"flaeche":{"gesamt_m2":-0.0}}"#,
        r#"{"weg":"flaeche","trennung":false,"flaeche":{"maenner_m2":-0.0,"frauen_m2":-0.0}}"#,
        r#"{"weg":"personen","trennung":false,"personen":{"gesamt":10},"richtwerte":{"faekalien_je_person_l":-0.0,"zelt_abstand_m":-0.0}}"#,
    ] {
        // Als Zahlenwert, also hinter dem Doppelpunkt: der Stand `2026-11-01` enthält auch „-0“.
        let antwort = text(body);
        assert!(!antwort.contains(":-0"), "{body} → {antwort}");
    }
}

#[test]
fn kein_json_ist_400() {
    for body in ["", "{", "nicht json", "[1,2"] {
        let e = parse_body::<UnterkunftRequest>(body.as_bytes()).expect_err(body);
        assert_eq!(e.code, ErrorCode::InvalidField, "{body:?}");
    }
}

/// Erster Unterschied zweier JSON-Bäume als Pfad, Zahlen als `f64` Bit für Bit verglichen
/// (`400.0` gleich `400`, aber `-0.0` ungleich `0`), alles andere wörtlich, Listen in ihrer
/// Reihenfolge.
fn unterschied(pfad: &str, ist: &Value, soll: &Value) -> Option<String> {
    match (ist, soll) {
        (Value::Number(a), Value::Number(b)) => {
            let bits = |n: &serde_json::Number| n.as_f64().map(f64::to_bits);
            (bits(a) != bits(b)).then(|| format!("{pfad}: ist {a}, soll {b}"))
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!(
                    "{pfad}: ist {} Einträge, soll {}",
                    a.len(),
                    b.len()
                ));
            }
            a.iter()
                .zip(b)
                .enumerate()
                .find_map(|(i, (x, y))| unterschied(&format!("{pfad}[{i}]"), x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            if let Some(k) = a.keys().find(|k| !b.contains_key(*k)) {
                return Some(format!("{pfad}.{k}: steht nur im Ergebnis"));
            }
            b.iter().find_map(|(k, y)| match a.get(k) {
                Some(x) => unterschied(&format!("{pfad}.{k}"), x, y),
                None => Some(format!("{pfad}.{k}: fehlt im Ergebnis")),
            })
        }
        _ => (ist != soll).then(|| format!("{pfad}: ist {ist}, soll {soll}")),
    }
}

/// Die gemeinsame Fallsammlung (`frontend/src/betreuung/AGENTS.md`, „Unterkunftsrechner“): je
/// Fall geht die `eingabe` als Anfrage durch Einlesen, Prüfung, Rechnung und Serialisierung und
/// ergibt `erwartet`. Dieselbe Datei prüft den TS-Kern
/// (`frontend/src/betreuung/unterkunft/rechnerFixture.test.ts`); ändert eine Seite die Rechnung
/// ohne die Datei, wird ihre Suite rot.
#[test]
fn jeder_fall_der_fallsammlung_ergibt_das_erwartete_ergebnis() {
    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/unterkunft/faelle.json"
    )))
    .expect("Fallsammlung lesbar");
    let faelle = fixture["faelle"].as_array().expect("faelle");
    assert!(faelle.len() >= 24, "nur {} Fälle gelesen", faelle.len());

    for fall in faelle {
        let name = fall["name"].as_str().expect("name");
        let mut body = fall["eingabe"].clone();
        body["richtwerte"] = fall["richtwerte"].clone();
        let antwort = rechnen(body).unwrap_or_else(|e| panic!("{name}: {}", e.message));
        let ist = serde_json::to_value(&antwort.ergebnis).expect("serialisierbar");
        if let Some(u) = unterschied("ergebnis", &ist, &fall["erwartet"]) {
            panic!("{name}: {u}");
        }
    }
}
