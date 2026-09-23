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
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup, setup_mit_pool,
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

    // Aufträge: einer mit abgelaufener Frist (überfällig), einer in Arbeit, einer vollzogen.
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
        &auftrag("Sperrung", None),
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
        json!({ "offen": offen, "ungesehen": neu }),
        "{v:?}"
    );

    let liste = get(&app, &admin, &format!("{basis}/auftraege")).await;
    let ist_offen =
        |a: &Value| a["bearbeitungsstatus"] == "offen" || a["bearbeitungsstatus"] == "in_arbeit";
    let offen = anzahl(&liste, ist_offen);
    let ueberfaellig = anzahl(&liste, |a| {
        ist_offen(a) && a["ist_ueberfaellig"] == json!(true)
    });
    assert_eq!(
        (offen, ueberfaellig),
        (2, 1),
        "Erwartung aus der Liste: {liste:?}"
    );
    assert_eq!(
        v["auftraege"],
        json!({ "offen": offen, "ueberfaellig": ueberfaellig }),
        "{v:?}"
    );

    let liste = get(&app, &admin, &format!("{basis}/erinnerungen")).await;
    let faellig = anzahl(&liste, |e| {
        e["ist_faellig"] == json!(true) && e["status"] == "offen"
    });
    // Zwei: die eigene plus die Quittierfrist, die der überfällige Auftrag selbst anlegt.
    assert_eq!(faellig, 2, "Erwartung aus der Liste: {liste:?}");
    assert_eq!(v["erinnerungen"], json!({ "faellig": faellig }), "{v:?}");
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

#[tokio::test]
async fn erlaubtes_leeres_modul_steht_auf_null() {
    let (app, admin, einsatz) = aufbau().await;
    let v = zaehler(&app, &admin, einsatz).await;
    assert_eq!(v["personen"], json!({ "gesamt": 0 }), "{v:?}");
    assert_eq!(
        v["meldungen"],
        json!({ "offen": 0, "ungesehen": 0 }),
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
            "einheiten",
            "einsatzabschnitte",
            "erinnerungen",
            "etb",
            "meldungen",
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
