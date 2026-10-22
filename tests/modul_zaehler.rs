//! Modulzähler des Navigationsrahmens (LFH-612): `GET /api/einsaetze/{id}/modul-zaehler`.
//!
//! Zwei Zusicherungen tragen:
//! - **Parität**: „offen", „überfällig", „fällig", „ungelesen" bedeuten dasselbe wie in den
//!   Listen der Module. Die Tests rechnen die Erwartung deshalb aus den Listen-Endpunkten
//!   nach, nicht aus handgesetzten Zahlen allein.
//! - **Fehlt ≠ 0**: ein nicht erlaubtes Modul fehlt in der Antwort. Geprüft per
//!   `contains_key` — `v["x"] == Null` unterscheidet „fehlt" nicht von `null`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, multipart_post, rolle_setzen, setup,
    setup_mit_pool,
};

fn uri(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/modul-zaehler")
}

async fn zaehler(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, v) = anfrage(app, "GET", &uri(einsatz), cookie, None).await;
    assert_eq!(status, StatusCode::OK, "modul-zaehler: {v:?}");
    v
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: &str) -> Value {
    let (status, v) = anfrage(app, "POST", pfad, cookie, Some(body)).await;
    assert!(status.is_success(), "POST {pfad}: {status} {v:?}");
    v
}

async fn get(app: &axum::Router, cookie: &str, pfad: &str) -> Value {
    let (status, v) = anfrage(app, "GET", pfad, cookie, None).await;
    assert_eq!(status, StatusCode::OK, "GET {pfad}: {v:?}");
    v
}

fn anzahl(v: &Value, praedikat: impl Fn(&Value) -> bool) -> i64 {
    v.as_array()
        .unwrap()
        .iter()
        .filter(|x| praedikat(x))
        .count() as i64
}

async fn aufbau() -> (axum::Router, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

/// Beobachterin ohne Admin-Rechte im Einsatz.
async fn erika(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let id = benutzer_anlegen(app, admin, "erika", "keine").await;
    rolle_setzen(app, admin, einsatz, id, "beobachter").await;
    login_cookie(app, "erika", "erikapw1").await
}

async fn modul_ausblenden(app: &axum::Router, admin: &str, einsatz: i64, modul: &str) {
    let (status, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override {modul}: {status} {v:?}");
}

#[tokio::test]
async fn mengen_zaehlen_den_bestand_ohne_stornierte() {
    let (app, admin, einsatz) = aufbau().await;
    let basis = format!("/api/einsaetze/{einsatz}");
    let mut personen = vec![];
    for _ in 0..4 {
        let p = post(
            &app,
            &admin,
            &format!("{basis}/personen"),
            r#"{"geschlecht":"maennlich"}"#,
        )
        .await;
        personen.push(p["id"].as_i64().unwrap());
    }
    let (status, v) = anfrage(
        &app,
        "DELETE",
        &format!("{basis}/personen/{}", personen[0]),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "stornieren: {status} {v:?}");
    post(
        &app,
        &admin,
        &format!("{basis}/einheiten"),
        r#"{"name":"1. Zug"}"#,
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/einheiten"),
        r#"{"name":"2. Zug"}"#,
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/abschnitte"),
        r#"{"name":"Nord"}"#,
    )
    .await;

    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(v["personen"]["gesamt"].as_i64(), Some(3), "{v:?}");
    assert_eq!(v["einheiten"]["gesamt"].as_i64(), Some(2), "{v:?}");
    assert_eq!(v["einsatzabschnitte"]["gesamt"].as_i64(), Some(1), "{v:?}");
    // Parität mit der Personenliste und dem ETB-Zähler.
    let liste = get(&app, &admin, &format!("{basis}/personen")).await;
    assert_eq!(
        v["personen"]["gesamt"].as_i64(),
        Some(liste.as_array().unwrap().len() as i64)
    );
    let etb = get(&app, &admin, &format!("{basis}/etb/zaehler")).await;
    assert_eq!(v["etb"]["gesamt"], etb["gesamt"], "{v:?}");
}

#[tokio::test]
async fn kommunikationszaehler_entsprechen_den_listen() {
    let (app, admin, einsatz) = aufbau().await;
    let basis = format!("/api/einsaetze/{einsatz}");

    // Meldungen: drei, davon eine gesichtet und eine erledigt.
    let mut meldungen = vec![];
    for inhalt in ["Deich instabil", "Pegel steigt", "Straße frei"] {
        let body = json!({
            "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
            "inhalt": inhalt, "ereigniszeit": "2026-06-12 09:00:00"
        })
        .to_string();
        let m = post(&app, &admin, &format!("{basis}/meldungen"), &body).await;
        meldungen.push(m["id"].as_i64().unwrap());
    }
    post(
        &app,
        &admin,
        &format!("{basis}/meldungen/{}/status", meldungen[1]),
        r#"{"status":"gesichtet"}"#,
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/meldungen/{}/status", meldungen[2]),
        r#"{"status":"erledigt"}"#,
    )
    .await;

    // Aufträge: einer mit abgelaufener Frist (überfällig), einer in Arbeit, einer vollzogen — mit
    // abgelaufener Frist und unquittiertem Empfänger. Er zählt nirgends, auch nicht als
    // überfällig (LFH-550: „davon überfällig“).
    let auftrag = |text: &str, frist: Option<&str>| {
        let mut b = json!({
            "auftrag_text": text,
            "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Nord" }]
        });
        if let Some(f) = frist {
            b["frist_at"] = json!(f);
        }
        b.to_string()
    };
    post(
        &app,
        &admin,
        &format!("{basis}/auftraege"),
        &auftrag("Deich sichern", Some("2026-06-01 10:00:00")),
    )
    .await;
    let a2 = post(
        &app,
        &admin,
        &format!("{basis}/auftraege"),
        &auftrag("Sandsäcke", None),
    )
    .await;
    let a3 = post(
        &app,
        &admin,
        &format!("{basis}/auftraege"),
        &auftrag("Sperrung", Some("2026-06-01 11:00:00")),
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/auftraege/{}/vollzug", a2["id"]),
        r#"{"status":"in_arbeit"}"#,
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/auftraege/{}/vollzug", a3["id"]),
        r#"{"status":"vollzogen","vollzugsmeldung":"x"}"#,
    )
    .await;

    // Erinnerungen: eine fällig (Vergangenheit), eine künftig.
    post(
        &app,
        &admin,
        &format!("{basis}/erinnerungen"),
        r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00"}"#,
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/erinnerungen"),
        r#"{"titel":"Ablösung","faellig_at":"2099-01-01 10:00"}"#,
    )
    .await;

    let v = zaehler(&app, &admin, einsatz).await;

    let liste = get(&app, &admin, &format!("{basis}/meldungen")).await;
    let offen = anzahl(&liste, |m| m["ist_offen"] == json!(true));
    let neu = anzahl(&liste, |m| {
        m["ist_offen"] == json!(true) && m["status"] == "neu"
    });
    assert_eq!((offen, neu), (2, 1), "Erwartung aus der Liste: {liste:?}");
    assert_eq!(
        v["meldungen"],
        json!({ "offen": offen, "ungesehen": neu, "bestaetigung_ueberfaellig": 0 }),
        "{v:?}"
    );

    let liste = get(&app, &admin, &format!("{basis}/auftraege")).await;
    let ist_offen =
        |a: &Value| a["bearbeitungsstatus"] == "offen" || a["bearbeitungsstatus"] == "in_arbeit";
    let offen = anzahl(&liste, ist_offen);
    let in_arbeit = anzahl(&liste, |a| a["bearbeitungsstatus"] == "in_arbeit");
    let ueberfaellig = anzahl(&liste, |a| {
        ist_offen(a) && a["ist_ueberfaellig"] == json!(true)
    });
    let vollzogen_ueberfaellig = anzahl(&liste, |a| {
        a["bearbeitungsstatus"] == "vollzogen" && a["ist_ueberfaellig"] == json!(true)
    });
    assert_eq!(
        (offen, in_arbeit, ueberfaellig, vollzogen_ueberfaellig),
        (2, 1, 1, 1),
        "Erwartung aus der Liste: {liste:?}"
    );
    assert_eq!(
        v["auftraege"],
        json!({ "offen": offen, "in_arbeit": in_arbeit, "ueberfaellig": ueberfaellig }),
        "{v:?}"
    );

    let liste = get(&app, &admin, &format!("{basis}/erinnerungen")).await;
    let faellig = anzahl(&liste, |e| {
        e["ist_faellig"] == json!(true) && e["status"] == "offen"
    });
    // Drei: die eigene plus die Quittierfristen, die die beiden Aufträge mit abgelaufener Frist
    // selbst anlegen (auch der vollzogene: seine Quittung fehlt noch).
    assert_eq!(faellig, 3, "Erwartung aus der Liste: {liste:?}");
    assert_eq!(v["erinnerungen"], json!({ "faellig": faellig }), "{v:?}");
}

/// Überfällige Bestätigungspflicht (LFH-397): die Quelle der Warnsperre am
/// Helligkeitsregler. Dieselbe Regel wie `istAlarmiert` im Frontend
/// (`meldungen/meldungKennzahlen.ts`) — die Erwartung wird deshalb aus der Liste nachgerechnet,
/// nicht nur als Zahl gesetzt.
#[tokio::test]
async fn bestaetigung_ueberfaellig_zaehlt_wie_die_liste() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let basis = format!("/api/einsaetze/{einsatz}");
    let meldung = |inhalt: &str, sofort: bool| {
        let mut b = json!({
            "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
            "inhalt": inhalt, "ereigniszeit": "2026-06-12 09:00:00"
        });
        if sofort {
            b["prioritaet"] = json!("sofort");
            b["bestaetigung_frist_min"] = json!(5);
        }
        b.to_string()
    };
    let abgelaufen = post(
        &app,
        &admin,
        &format!("{basis}/meldungen"),
        &meldung("Deich bricht", true),
    )
    .await;
    let bestaetigt = post(
        &app,
        &admin,
        &format!("{basis}/meldungen"),
        &meldung("MANV", true),
    )
    .await;
    let _kuenftig = post(
        &app,
        &admin,
        &format!("{basis}/meldungen"),
        &meldung("Pegel", true),
    )
    .await;
    let _ohne_pflicht = post(
        &app,
        &admin,
        &format!("{basis}/meldungen"),
        &meldung("Straße frei", false),
    )
    .await;
    for m in [&abgelaufen, &bestaetigt] {
        sqlx::query(
            "UPDATE meldung SET bestaetigung_frist_at = '2000-01-01 00:00:00' WHERE id = ?",
        )
        .bind(m["id"].as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    }
    let (status, m) = anfrage(
        &app,
        "POST",
        &format!("{basis}/meldungen/{}/bestaetigen", bestaetigt["id"]),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{m:?}");

    let liste = get(&app, &admin, &format!("{basis}/meldungen")).await;
    let alarmiert = anzahl(&liste, |m| {
        m["bestaetigung_pflicht"] == json!(true)
            && m["ist_bestaetigt"] != json!(true)
            && (m["ist_ueberfaellig"] == json!(true) || m["eskaliert"] == json!(true))
    });
    assert_eq!(alarmiert, 1, "Erwartung aus der Liste: {liste:?}");
    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(
        v["meldungen"]["bestaetigung_ueberfaellig"],
        json!(alarmiert),
        "{v:?}"
    );

    // Bestätigt → die Warnung ist fort.
    let (status, m) = anfrage(
        &app,
        "POST",
        &format!("{basis}/meldungen/{}/bestaetigen", abgelaufen["id"]),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{m:?}");
    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(
        v["meldungen"]["bestaetigung_ueberfaellig"],
        json!(0),
        "{v:?}"
    );
}

/// Der Server zählt Meldungen und Aufträge gruppiert nach ihren Merkmalen (LFH-935). Zwei
/// Zeilen, die sich nur in EINEM Merkmal unterscheiden, dürfen dabei nicht verschmelzen, und ein
/// quittierter Auftrag mit abgelaufener Frist ist nicht überfällig — in Liste und Zähler gleich.
#[tokio::test]
async fn merkmale_trennen_sich_im_zaehler() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let basis = format!("/api/einsaetze/{einsatz}");

    // Zwei pflichtige, unbestätigte Meldungen mit künftiger Frist; nur eine ist eskaliert.
    let mut ids = vec![];
    for inhalt in ["Deich bricht", "Pegel steigt"] {
        let body = json!({
            "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
            "inhalt": inhalt, "ereigniszeit": "2026-06-12 09:00:00",
            "prioritaet": "sofort", "bestaetigung_frist_min": 5
        });
        let m = post(
            &app,
            &admin,
            &format!("{basis}/meldungen"),
            &body.to_string(),
        )
        .await;
        ids.push(m["id"].as_i64().unwrap());
    }
    sqlx::query(
        "UPDATE meldung SET bestaetigung_frist_at = '2999-01-01 00:00:00', \
         eskaliert = (id = ?) WHERE id IN (?, ?)",
    )
    .bind(ids[0])
    .bind(ids[0])
    .bind(ids[1])
    .execute(&pool)
    .await
    .unwrap();

    // Zwei Aufträge mit abgelaufener Frist; beim zweiten haben alle Empfänger quittiert.
    let auftrag = json!({
        "auftrag_text": "Deich sichern", "frist_at": "2026-06-01 10:00:00",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Abschnitt Nord" }]
    })
    .to_string();
    post(&app, &admin, &format!("{basis}/auftraege"), &auftrag).await;
    let quittiert = post(&app, &admin, &format!("{basis}/auftraege"), &auftrag).await;
    post(
        &app,
        &admin,
        &format!(
            "{basis}/auftraege/{}/empfaenger/{}/quittieren",
            quittiert["id"], quittiert["empfaenger"][0]["id"]
        ),
        "{}",
    )
    .await;

    let meldungen = get(&app, &admin, &format!("{basis}/meldungen")).await;
    let alarmiert = anzahl(&meldungen, |m| {
        m["bestaetigung_pflicht"] == json!(true)
            && m["ist_bestaetigt"] != json!(true)
            && (m["ist_ueberfaellig"] == json!(true) || m["eskaliert"] == json!(true))
    });
    let auftraege = get(&app, &admin, &format!("{basis}/auftraege")).await;
    let ueberfaellig = anzahl(&auftraege, |a| a["ist_ueberfaellig"] == json!(true));
    assert_eq!(
        (alarmiert, ueberfaellig),
        (1, 1),
        "Erwartung aus den Listen"
    );

    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(
        v["meldungen"]["bestaetigung_ueberfaellig"],
        json!(1),
        "{v:?}"
    );
    assert_eq!(v["auftraege"]["ueberfaellig"], json!(1), "{v:?}");
    assert_eq!(v["auftraege"]["offen"], json!(2), "{v:?}");
}

#[tokio::test]
async fn chat_zaehlt_je_benutzer() {
    let (app, admin, einsatz) = aufbau().await;
    let karla_id = benutzer_anlegen(&app, &admin, "karla", "keine").await;
    rolle_setzen(&app, &admin, einsatz, karla_id, "fuehrungspersonal").await;
    let karla = login_cookie(&app, "karla", "karlapw1").await;
    let basis = format!("/api/einsaetze/{einsatz}/chat/kanaele");

    let kanaele = get(&app, &admin, &basis).await;
    let kid = kanaele[0]["id"].as_i64().unwrap();
    post(
        &app,
        &karla,
        &format!("{basis}/{kid}/nachrichten"),
        r#"{"inhalt":"Eins"}"#,
    )
    .await;
    post(
        &app,
        &karla,
        &format!("{basis}/{kid}/nachrichten"),
        r#"{"inhalt":"Zwei"}"#,
    )
    .await;

    // Eigene Nachrichten sind nie ungelesen; für den Admin sind beide neu.
    assert_eq!(
        zaehler(&app, &karla, einsatz).await["chat"]["ungelesen"].as_i64(),
        Some(0)
    );
    assert_eq!(
        zaehler(&app, &admin, einsatz).await["chat"]["ungelesen"].as_i64(),
        Some(2)
    );

    let (status, v) = anfrage(
        &app,
        "POST",
        &format!("{basis}/{kid}/gelesen"),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "gelesen: {status} {v:?}");
    assert_eq!(
        zaehler(&app, &admin, einsatz).await["chat"]["ungelesen"].as_i64(),
        Some(0)
    );
}

/// Dokumente (LFH-666): die lebenden Dokumente, dasselbe Prädikat wie die Dokumentliste —
/// die Erwartung kommt aus dem Listen-Endpunkt, nicht nur aus der handgesetzten 2.
#[tokio::test]
async fn dokumente_zaehlen_wie_die_liste_ohne_geloeschte() {
    let (app, admin, einsatz) = aufbau().await;
    let pfad = format!("/api/einsaetze/{einsatz}/dokumente");
    let mut ids = vec![];
    for titel in ["Lageplan", "Funkskizze", "Foto"] {
        let (status, v) = multipart_post(
            &app,
            &pfad,
            &admin,
            Some(("plan.pdf", b"%PDF-1.4 inhalt")),
            &[("titel", titel), ("kategorie", "lagekarte_plan")],
        )
        .await;
        assert!(status.is_success(), "ablegen: {status} {v:?}");
        ids.push(v["id"].as_i64().unwrap());
    }
    let (status, v) = anfrage(&app, "DELETE", &format!("{pfad}/{}", ids[0]), &admin, None).await;
    assert!(status.is_success(), "entfernen: {status} {v:?}");

    let liste = get(&app, &admin, &pfad).await;
    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(v["dokumente"], json!({ "gesamt": 2 }), "{v:?}");
    assert_eq!(
        v["dokumente"]["gesamt"].as_i64(),
        Some(anzahl(&liste, |_| true))
    );
}

/// Nachforderungen (LLH-1078): offen und je Stufe wie die Liste — die Erwartung kommt aus dem
/// Listen-Endpunkt (`ist_offen`, `status`), nicht nur aus den handgesetzten Zahlen.
#[tokio::test]
async fn nachforderungen_zaehlen_wie_die_liste() {
    let (app, admin, einsatz) = aufbau().await;
    let pfad = format!("/api/einsaetze/{einsatz}/nachforderungen");
    // Je Fall die Stufen, die nach dem Anlegen geschaltet werden.
    let faelle: [&[&str]; 6] = [
        &[],
        &[],
        &["zugesagt"],
        &["zugesagt", "unterwegs"],
        &["zugesagt", "unterwegs", "eingetroffen"],
        &["abgelehnt"],
    ];
    for (i, schritte) in faelle.iter().enumerate() {
        let body = json!({
            "art": "RTW", "bezeichnung": format!("Bedarf {i}"), "adressat_kategorie": "leitstelle"
        });
        let nf = post(&app, &admin, &pfad, &body.to_string()).await;
        let nid = nf["id"].as_i64().unwrap();
        for schritt in *schritte {
            let (ziel, body) = if *schritt == "abgelehnt" {
                (format!("{pfad}/{nid}/ablehnen"), json!({}))
            } else {
                (format!("{pfad}/{nid}/status"), json!({ "status": schritt }))
            };
            post(&app, &admin, &ziel, &body.to_string()).await;
        }
    }

    let liste = get(&app, &admin, &pfad).await;
    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(
        v["nachforderungen"],
        json!({ "offen": 4, "angefordert": 2, "zugesagt": 1, "unterwegs": 1, "ueberfaellig": 0 }),
        "{v:?}"
    );
    let stufe = |s: &'static str| move |x: &Value| x["status"] == s;
    assert_eq!(
        v["nachforderungen"]["offen"].as_i64(),
        Some(anzahl(&liste, |x| x["ist_offen"] == true))
    );
    for s in ["angefordert", "zugesagt", "unterwegs"] {
        assert_eq!(
            v["nachforderungen"][s].as_i64(),
            Some(anzahl(&liste, stufe(s))),
            "{s}"
        );
    }

    // Ausgeblendet fehlt der Zähler, statt 0 zu zeigen.
    let erika = erika(&app, &admin, einsatz).await;
    assert!(zaehler(&app, &erika, einsatz)
        .await
        .as_object()
        .unwrap()
        .contains_key("nachforderungen"));
    modul_ausblenden(&app, &admin, einsatz, "nachforderungen").await;
    let v = zaehler(&app, &erika, einsatz).await;
    assert!(
        !v.as_object().unwrap().contains_key("nachforderungen"),
        "{v:?}"
    );
}

/// Überfällige Nachforderungen (LLH-1145): zugesagt oder unterwegs mit verstrichenem erwartetem
/// Eintreffen, wie das Board (`istUeberfaellig`). Die Erwartung kommt aus `status` und
/// `eintreffen_erwartet_at` der Liste gegen den Abrufzeitpunkt; ein eingetroffener mit
/// verstrichenem Eintreffen zählt nicht, einer ohne Eintreffen auch nicht.
#[tokio::test]
async fn nachforderungen_ueberfaellig_wie_das_board() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pfad = format!("/api/einsaetze/{einsatz}/nachforderungen");
    // Je Fall: Stufen nach der Zusage, Eintreffen verstrichen?
    let faelle: [(&[&str], Option<bool>); 6] = [
        (&[], None),                                  // angefordert
        (&[], Some(true)),                            // zugesagt, verstrichen
        (&[], Some(false)),                           // zugesagt, später
        (&["unterwegs"], Some(true)),                 // unterwegs, verstrichen
        (&["unterwegs", "eingetroffen"], Some(true)), // eingetroffen
        (&["unterwegs"], None),                       // unterwegs ohne Eintreffen
    ];
    for (i, (schritte, verstrichen)) in faelle.iter().enumerate() {
        let body = json!({
            "art": "RTW", "bezeichnung": format!("Bedarf {i}"), "adressat_kategorie": "leitstelle"
        });
        let nf = post(&app, &admin, &pfad, &body.to_string()).await;
        let nid = nf["id"].as_i64().unwrap();
        if verstrichen.is_some() || !schritte.is_empty() {
            // Zusage in der Zukunft; das Eintreffen setzt die Datenbank danach zurück, weil die
            // Route kein Eintreffen vor der Anforderung annimmt.
            let zusage = json!({ "eintreffen_erwartet_at": "2099-01-01 12:00:00" });
            let zusage = if verstrichen.is_some() {
                zusage
            } else {
                json!({})
            };
            post(
                &app,
                &admin,
                &format!("{pfad}/{nid}/zusage"),
                &zusage.to_string(),
            )
            .await;
        }
        for schritt in *schritte {
            let body = json!({ "status": schritt });
            post(
                &app,
                &admin,
                &format!("{pfad}/{nid}/status"),
                &body.to_string(),
            )
            .await;
        }
        if *verstrichen == Some(true) {
            sqlx::query(
                "UPDATE nachforderung SET eintreffen_erwartet_at = '2000-01-01 00:00:00' \
                 WHERE id = ?",
            )
            .bind(nid)
            .execute(&pool)
            .await
            .unwrap();
        }
    }

    let liste = get(&app, &admin, &pfad).await;
    let v = zaehler(&app, &admin, einsatz).await;
    let jetzt = lifeline_hub::zeit::jetzt();
    let erwartet = anzahl(&liste, |x| {
        (x["status"] == "zugesagt" || x["status"] == "unterwegs")
            && x["eintreffen_erwartet_at"]
                .as_str()
                .is_some_and(|e| e < jetzt.as_str())
    });
    assert_eq!(erwartet, 2, "{liste:?}");
    assert_eq!(
        v["nachforderungen"]["ueberfaellig"].as_i64(),
        Some(erwartet),
        "{v:?}"
    );
}

#[tokio::test]
async fn erlaubtes_leeres_modul_steht_auf_null() {
    let (app, admin, einsatz) = aufbau().await;
    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(v["personen"], json!({ "gesamt": 0 }), "{v:?}");
    assert_eq!(v["dokumente"], json!({ "gesamt": 0 }), "{v:?}");
    assert_eq!(v["lagemeldungen"], json!({ "neu": 0 }), "{v:?}");
    assert_eq!(
        v["nachforderungen"],
        json!({ "offen": 0, "angefordert": 0, "zugesagt": 0, "unterwegs": 0, "ueberfaellig": 0 }),
        "{v:?}"
    );
    assert_eq!(
        v["meldungen"],
        json!({ "offen": 0, "ungesehen": 0, "bestaetigung_ueberfaellig": 0 }),
        "{v:?}"
    );
    // Nur die belegten Module — kein Zähler für Module ohne festgelegte Bedeutung.
    let mut felder: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
    felder.sort();
    assert_eq!(
        felder,
        [
            "auftraege",
            "chat",
            "dokumente",
            "einheiten",
            "einsatzabschnitte",
            "erinnerungen",
            "etb",
            "lagemeldungen",
            "meldungen",
            "nachforderungen",
            "personen"
        ]
    );
}

#[tokio::test]
async fn ausgeblendetes_modul_fehlt_statt_null() {
    let (app, admin, einsatz) = aufbau().await;
    let erika = erika(&app, &admin, einsatz).await;
    modul_ausblenden(&app, &admin, einsatz, "meldungen").await;

    let v = zaehler(&app, &erika, einsatz).await;
    let felder = v.as_object().unwrap();
    assert!(!felder.contains_key("meldungen"), "{v:?}");
    assert!(
        felder.contains_key("personen"),
        "übrige Module bleiben: {v:?}"
    );
}

#[tokio::test]
async fn ausgeblendete_dokumente_fehlen_statt_null() {
    let (app, admin, einsatz) = aufbau().await;
    let erika = erika(&app, &admin, einsatz).await;
    assert!(
        zaehler(&app, &erika, einsatz)
            .await
            .as_object()
            .unwrap()
            .contains_key("dokumente"),
        "Gegenprobe: sichtbar ist das Feld da"
    );
    modul_ausblenden(&app, &admin, einsatz, "dokumente").await;

    let v = zaehler(&app, &erika, einsatz).await;
    let felder = v.as_object().unwrap();
    assert!(!felder.contains_key("dokumente"), "{v:?}");
    assert!(felder.contains_key("etb"), "übrige Module bleiben: {v:?}");
}

#[tokio::test]
async fn org_rollensperre_laesst_modul_fehlen() {
    let (app, admin, einsatz) = aufbau().await;
    let erika = erika(&app, &admin, einsatz).await;
    let (status, v) = anfrage(
        &app,
        "PUT",
        "/api/org-modul-einstellungen/personen",
        &admin,
        Some(r#"{"benoetigte_rolle":"fuehrungskraft"}"#),
    )
    .await;
    assert!(status.is_success(), "Org-Default: {status} {v:?}");

    let v = zaehler(&app, &erika, einsatz).await;
    assert!(!v.as_object().unwrap().contains_key("personen"), "{v:?}");
    // Dieselbe Sperre weist die Liste ab — der Zähler verrät nichts, was die Liste verweigert.
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personen"),
        &erika,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn system_admin_sieht_auch_ausgeblendete_module() {
    let (app, admin, einsatz) = aufbau().await;
    modul_ausblenden(&app, &admin, einsatz, "meldungen").await;
    let v = zaehler(&app, &admin, einsatz).await;
    assert!(v.as_object().unwrap().contains_key("meldungen"), "{v:?}");
}

#[tokio::test]
async fn nichtmitglied_ist_403_und_unbekannter_einsatz_404() {
    let (app, admin, einsatz) = aufbau().await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    let (status, _) = anfrage(&app, "GET", &uri(einsatz), &fremd, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(&app, "GET", &uri(9999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Der Zähler läuft bei jedem gezählten Live-Ereignis. Er darf dabei nicht schreiben — das
/// Anlegen des Standardkanals (in `liste_kanaele`) nähme sonst bei jedem Abruf die
/// Schreibsperre der Datenbank. Ohne Kanal gibt es nichts Ungelesenes.
#[tokio::test]
async fn zaehlen_legt_keinen_chat_kanal_an() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(v["chat"], json!({ "ungelesen": 0 }), "{v:?}");
    let kanaele: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_kanal WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(kanaele, 0, "der Zähler hat einen Kanal angelegt");
}

/// LFH-1150: Unter „Führung im Einsatz“ zählt die Einsatzleitung ohne Org-Rolle das Modul, die
/// Beobachterin nicht — der Zähler rechnet mit derselben Einsatzrolle wie die Liste.
#[tokio::test]
async fn einsatzfuehrung_zaehlt_fuer_die_einsatzleitung() {
    let (app, admin, einsatz) = aufbau().await;
    let erika = erika(&app, &admin, einsatz).await;
    let lid = benutzer_anlegen(&app, &admin, "leonie", "keine").await;
    rolle_setzen(&app, &admin, einsatz, lid, "einsatzleitung").await;
    let lena = login_cookie(&app, "leonie", "leoniepw1").await;
    let (status, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/personen"),
        &lena,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"einsatzfuehrung"}"#),
    )
    .await;
    assert!(status.is_success(), "Override: {status} {v:?}");

    let v = zaehler(&app, &lena, einsatz).await;
    assert!(v.as_object().unwrap().contains_key("personen"), "{v:?}");
    let v = zaehler(&app, &erika, einsatz).await;
    assert!(!v.as_object().unwrap().contains_key("personen"), "{v:?}");
}

/// LLH-1079: Eine aufgelöste Einheit zählt nicht mehr; der Zähler bleibt gleich der Liste.
#[tokio::test]
async fn aufgeloeste_einheit_zaehlt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let basis = format!("/api/einsaetze/{einsatz}");
    post(
        &app,
        &admin,
        &format!("{basis}/einheiten"),
        r#"{"name":"1. Zug"}"#,
    )
    .await;
    let zweiter = post(
        &app,
        &admin,
        &format!("{basis}/einheiten"),
        r#"{"name":"2. Zug"}"#,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    // Ein Mitglied ist Spur: die Einheit bleibt als aufgelöste Zeile stehen.
    let kraft = post(
        &app,
        &admin,
        &format!("{basis}/personal"),
        r#"{"adhoc":{"name":"Anna"}}"#,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("{basis}/einheiten/{zweiter}/personal/{kraft}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "zuordnen: {s} {v:?}");
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("{basis}/einheiten/{zweiter}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "auflösen: {s} {v:?}");
    let aufgeloeste = get(&app, &admin, &format!("{basis}/einheiten?aufgeloeste=1")).await;
    assert_eq!(aufgeloeste.as_array().unwrap().len(), 1, "{aufgeloeste:?}");

    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(v["einheiten"]["gesamt"].as_i64(), Some(1), "{v:?}");
    let liste = get(&app, &admin, &format!("{basis}/einheiten")).await;
    assert_eq!(liste.as_array().unwrap().len(), 1, "{liste:?}");
}
