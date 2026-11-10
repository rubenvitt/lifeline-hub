//! Integrationstests „Schichtplan einlesen“ (LLH-1556, Spec `kraefte-schichtplan`): die
//! Beispieldatei Stadtfest im Demo-Einsatz mit Vorschau übernehmen, ein zweiter Lauf ändert
//! nichts, XLSX gleich CSV, Fehler sperren, Rechte und abgeschlossener Einsatz. Die Regeln des
//! Lesens und Abgleichs im Einzelnen prüfen `uebernahme/datei.rs`, `abgleich.rs` und `repo.rs`.

use axum::http::StatusCode;
use lifeline_hub::app::RouterOptionen;
use serde_json::{json, Value};

mod common;
use common::*;

const AN: RouterOptionen = RouterOptionen {
    demo_daten: true,
    zulassungs_budget: None,
    heic_decoder_verzeichnis: None,
};

const CSV: &[u8] = include_bytes!("../frontend/public/beispiele/schichtplan-stadtfest.csv");
const XLSX: &[u8] = include_bytes!("../frontend/public/beispiele/schichtplan-stadtfest.xlsx");

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan")
}

/// Demo-Lage Stadtfest importieren; liefert den Einsatz.
async fn stadtfest(app: &axum::Router, admin: &str) -> i64 {
    let (s, v) = anfrage(app, "POST", "/api/demo-daten/stadtfest", admin, None).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["lagen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["lage"] == "stadtfest")
        .unwrap()["import"]["einsatz_id"]
        .as_i64()
        .unwrap()
}

async fn einlesen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    was: &str,
    datei: (&str, &[u8]),
    entscheidungen: Option<Value>,
) -> (StatusCode, Value) {
    let text = entscheidungen.map(|e| e.to_string());
    let felder: Vec<(&str, &str)> = text
        .as_deref()
        .map(|t| vec![("entscheidungen", t)])
        .unwrap_or_default();
    multipart_post(
        app,
        &format!("{}/{was}", pfad(einsatz)),
        cookie,
        Some(datei),
        &felder,
    )
    .await
}

fn posten<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["posten"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == name)
        .unwrap_or_else(|| panic!("Posten {name} fehlt: {v}"))
}

fn person<'a>(v: &'a Value, name: &str) -> &'a Value {
    v["personen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == name)
        .unwrap_or_else(|| panic!("Person {name} fehlt: {v}"))
}

/// Die System-Sätze des ETB über die Datenbank: die Liste der Route ist seitenweise, und der
/// Demo-Einsatz füllt die erste Seite.
async fn system_saetze(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system'")
        .bind(einsatz)
        .fetch_all(pool)
        .await
        .unwrap()
}

fn zustaende(v: &Value) -> Vec<String> {
    v["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["zustand"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn beispieldatei_stadtfest_mit_vorschau_und_zweiter_lauf_ohne_aenderung() {
    let (app, pool) = setup_mit_optionen(AN).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = stadtfest(&app, &admin).await;
    let etb_vorher = system_saetze(&pool, e).await.len();

    // Vorschau: nichts geschrieben, Abgleich der Posten und Personen.
    let (s, v) = einlesen(&app, &admin, e, "import/vorschau", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["uebernehmbar"], true, "{v}");
    assert_eq!(posten(&v, "Streife 1")["ziel"]["art"], "einheit");
    assert_eq!(posten(&v, "Streife 1")["treffer"], "sicher");
    assert_eq!(posten(&v, "UHS Festplatz")["ziel"]["art"], "uhs");
    assert_eq!(posten(&v, "Streife 3")["ziel"]["art"], "neu");
    assert_eq!(posten(&v, "Streife 3")["treffer"], "neu");
    assert_eq!(person(&v, "Karl Beispiel")["ziel"]["art"], "stamm");
    assert_eq!(person(&v, "Karl Beispiel")["grund"], "kennung_name");
    assert_eq!(person(&v, "Jonas Fiktiv")["ziel"]["art"], "neu");
    assert_eq!(
        v["zaehlung"],
        json!({"einheiten_neu": 1, "uhs_neu": 0, "bloecke_neu": 10, "bloecke_ergaenzt": 0,
               "bloecke_unveraendert": 0, "helfer_neu": 7, "einteilungen_neu": 20,
               "grenzwerte_neu": 0, "programmpunkte_neu": 0,
               "programmpunkte_vorhanden": 0, "abschnitte_neu": 0, "aenderungen": 38})
    );
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(plan["bloecke"], json!([]), "Vorschau schreibt nichts");

    // Übernehmen: ein ETB-Satz für die neue Einheit, einer für den Plan.
    let (s, r) = einlesen(&app, &admin, e, "import", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::OK, "{r}");
    assert_eq!(r["zaehlung"], v["zaehlung"]);
    assert_eq!(r["plan"]["bloecke"].as_array().unwrap().len(), 10);
    let jonas = r["plan"]["helfer"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["name"] == "Jonas Fiktiv")
        .unwrap_or_else(|| panic!("Helfer fehlt: {r}"));
    assert_eq!(jonas["kennung"], "10231");
    assert_eq!(jonas["herkunft"], "Helferplanung");
    assert_eq!(jonas["organisation"], "DRK Nachbarstadt");
    let uhs = r["plan"]["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["posten"]["art"] == "uhs")
        .unwrap();
    assert_eq!(uhs["soll_anzahl"], 3);
    assert_eq!(uhs["quali_soll"].as_array().unwrap().len(), 2, "{uhs}");
    let inhalte = system_saetze(&pool, e).await;
    assert_eq!(inhalte.len(), etb_vorher + 2);
    assert!(
        inhalte
            .iter()
            .any(|t| t == "Schichtplan eingelesen: 10 Schichten neu, 7 Helfer neu, 1 Einheit neu."),
        "{inhalte:?}"
    );
    let (_, einheiten) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten"),
        &admin,
        None,
    )
    .await;
    assert!(
        einheiten
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["name"] == "Streife 3"),
        "{einheiten}"
    );

    // Zweiter Lauf derselben Datei: alles unverändert, kein Schreiben, kein ETB.
    let (s, v2) = einlesen(&app, &admin, e, "import/vorschau", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::OK, "{v2}");
    assert_eq!(v2["zaehlung"]["aenderungen"], 0, "{v2}");
    assert_eq!(v2["zaehlung"]["bloecke_unveraendert"], 10);
    assert!(zustaende(&v2).iter().all(|z| z == "unveraendert"));
    assert_eq!(person(&v2, "Jonas Fiktiv")["ziel"]["art"], "helfer");
    assert_eq!(person(&v2, "Jonas Fiktiv")["grund"], "kennung");
    assert_eq!(posten(&v2, "Streife 3")["treffer"], "sicher");
    let (s, r2) = einlesen(&app, &admin, e, "import", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::OK, "{r2}");
    assert_eq!(r2["zaehlung"]["aenderungen"], 0);
    assert_eq!(r2["plan"]["bloecke"], r["plan"]["bloecke"]);
    assert_eq!(system_saetze(&pool, e).await.len(), etb_vorher + 2);

    // Die XLSX mit denselben Schichten (Datumszellen in Ortszeit) trifft dieselben Blöcke.
    let (s, x) = einlesen(
        &app,
        &admin,
        e,
        "import/vorschau",
        ("plan.xlsx", XLSX),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{x}");
    assert_eq!(x["zaehlung"], v2["zaehlung"], "{x}");
    assert!(
        x["meldungen"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["stufe"] == "hinweis" && m["text"].as_str().unwrap().contains("Ortszeit")),
        "{x}"
    );
}

#[tokio::test]
async fn ergaenzt_nur_fehlende_personen_und_entscheidungen_gelten() {
    let (app, _pool) = setup_mit_optionen(AN).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = stadtfest(&app, &admin).await;
    let erste = "Posten;Beginn;Ende;Nachname;Vorname;Kennung\n\
                 Streife 1;2027-06-26T14:00+02:00;2027-06-26T18:00+02:00;Beispiel;Karl;DEMO-S-006\n";
    let (s, _) = einlesen(&app, &admin, e, "import", ("a.csv", erste.as_bytes()), None).await;
    assert_eq!(s, StatusCode::OK);

    // Lotte kommt dazu, Karl bleibt; „Streife 9“ wird auf Streife 2 gelegt.
    let zweite = "Posten;Beginn;Ende;Nachname;Vorname;Kennung\n\
                  Streife 1;2027-06-26T14:00+02:00;2027-06-26T18:00+02:00;Exempel;Lotte;DEMO-S-007\n\
                  Streife 9;2027-06-26T14:00+02:00;2027-06-26T18:00+02:00;Neu;Nora;\n";
    let (_, v) = einlesen(
        &app,
        &admin,
        e,
        "import/vorschau",
        ("b.csv", zweite.as_bytes()),
        None,
    )
    .await;
    let streife2 = v["auswahl"]["einheiten"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["bezeichnung"] == "Streife 2")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let p9 = posten(&v, "Streife 9")["schluessel"]
        .as_str()
        .unwrap()
        .to_string();
    let wahl = json!({"posten": {p9: {"art": "einheit", "einheit_id": streife2}}});
    let (s, r) = einlesen(
        &app,
        &admin,
        e,
        "import",
        ("b.csv", zweite.as_bytes()),
        Some(wahl),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    assert_eq!(r["zaehlung"]["bloecke_ergaenzt"], 1, "{r}");
    assert_eq!(r["zaehlung"]["bloecke_neu"], 1);
    assert_eq!(r["zaehlung"]["einheiten_neu"], 0);
    let bloecke = r["plan"]["bloecke"].as_array().unwrap();
    let s1 = bloecke
        .iter()
        .find(|b| b["posten"]["bezeichnung"] == "Streife 1")
        .unwrap();
    assert_eq!(s1["personen"].as_array().unwrap().len(), 2, "{s1}");
    assert_eq!(s1["version"], 2);
    assert!(bloecke
        .iter()
        .any(|b| b["posten"]["bezeichnung"] == "Streife 2"));

    // Unbekannter Schlüssel in den Entscheidungen: 400.
    let (s, _) = einlesen(
        &app,
        &admin,
        e,
        "import/vorschau",
        ("b.csv", zweite.as_bytes()),
        Some(json!({"personen": {"m99": {"art": "neu"}}})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fehler_sperren_das_uebernehmen_und_unlesbares_ist_400() {
    let (app, pool) = setup_mit_optionen(AN).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = stadtfest(&app, &admin).await;
    let etb_vorher = system_saetze(&pool, e).await.len();
    let datei = "Posten;Beginn;Ende;Nachname;Vorname\n\
                 Streife 1;2027-06-26T14:00+02:00;2027-06-26T18:00+02:00;Neu;Nora\n\
                 Streife 1;2027-06-26T16:00+02:00;2027-06-26T20:00+02:00;Neu;Nils\n\
                 Streife 2;2027-06-26T14:03+02:00;2027-06-26T18:00+02:00;;\n";
    let (s, v) = einlesen(
        &app,
        &admin,
        e,
        "import/vorschau",
        ("f.csv", datei.as_bytes()),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["uebernehmbar"], false);
    let fehler: Vec<(i64, String)> = v["meldungen"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["stufe"] == "fehler")
        .map(|m| {
            (
                m["zeile"].as_i64().unwrap(),
                m["text"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(fehler.len(), 2, "{v}");
    assert_eq!(fehler[0].0, 3);
    assert!(fehler[0].1.contains("Zeile 2"), "{fehler:?}");
    assert_eq!(fehler[1].0, 4);

    let (s, r) = einlesen(&app, &admin, e, "import", ("f.csv", datei.as_bytes()), None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{r}");
    assert_eq!(r["zeilen"][0]["art"], "dateizeile");
    assert_eq!(r["zeilen"][0]["id"], 3);
    let (_, plan) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(plan["bloecke"], json!([]));
    assert_eq!(plan["helfer"], json!([]));
    assert_eq!(system_saetze(&pool, e).await.len(), etb_vorher);

    for (name, inhalt) in [
        ("leer.csv", &b""[..]),
        ("ohne.csv", &b"Name;Vorname\nA;B\n"[..]),
        ("kaputt.xlsx", &b"PK\x03\x04kaputt"[..]),
    ] {
        let (s, v) = einlesen(&app, &admin, e, "import/vorschau", (name, inhalt), None).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{name}: {v}");
    }
    let zu_gross = vec![b'a'; 2 * 1024 * 1024 + 1];
    let (s, _) = einlesen(
        &app,
        &admin,
        e,
        "import/vorschau",
        ("gross.csv", &zu_gross),
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = multipart_post(&app, &format!("{}/import", pfad(e)), &admin, None, &[]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rechte_und_abgeschlossener_einsatz() {
    let (app, _pool) = setup_mit_optionen(AN).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = stadtfest(&app, &admin).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let bid = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    rolle_setzen(&app, &admin, e, bid, "beobachter").await;
    let bert = login_cookie(&app, "bertram", "bertrampw1").await;

    // Beobachter: 403.
    let (s, _) = einlesen(&app, &bert, e, "import/vorschau", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Ohne Einheiten: die Vorschau nennt es an den Posten, das Übernehmen ist 403.
    let sperre = |modul: &'static str| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            let (s, _) = anfrage(
                &app,
                "PUT",
                &format!("/api/einsaetze/{e}/modul-overrides/{modul}"),
                &admin,
                Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
            )
            .await;
            assert_eq!(s, StatusCode::OK);
        }
    };
    sperre("einheiten").await;
    let (s, v) = einlesen(&app, &frieda, e, "import/vorschau", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["uebernehmbar"], false);
    assert!(v["meldungen"].as_array().unwrap().iter().any(|m| m["text"]
        .as_str()
        .unwrap()
        .contains("keine Freigabe für Einheiten")));
    let (s, _) = einlesen(&app, &frieda, e, "import", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Ohne Personal: 403 schon für die Vorschau (sie zeigt Namen).
    sperre("personal").await;
    let (s, _) = einlesen(&app, &frieda, e, "import/vorschau", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Abgeschlossen: 409.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = einlesen(&app, &admin, e, "import", ("plan.csv", CSV), None).await;
    assert_eq!(s, StatusCode::CONFLICT);
}
