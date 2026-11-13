//! Abschnittsname per Join in Einheiten, Dokumenten und Ablösung (LLH-1501, Nachzug aus
//! LLH-1291): Umbenennen und Auflösen eines Abschnitts melden die Träger seines Namens mit dem
//! Ereignis ihres Moduls, die Rhythmus-Vorgaben der Ablösung bei jedem Anlegen, Umbenennen und
//! Auflösen. Das Ereignis `abschnitt` selbst bleibt gegatet.

use axum::http::StatusCode;
use lifeline_hub::live::LiveNachricht;
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;

mod common;
use common::*;

async fn fetch_json(app: &axum::Router, cookie: &str, pfad: &str) -> Value {
    let (s, v) = anfrage_json(app, "GET", pfad, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v
}

fn abschnitt_pfad(einsatz: i64, ab: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abschnitte/{ab}")
}

async fn abschnitt_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&json!({"name": name})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

async fn einheit_im_abschnitt(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    ab: i64,
) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&json!({"name": name, "abschnitt_id": ab})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// Legt ein Dokument mit Bezug auf den Abschnitt `ab` ab.
async fn dokument_am_abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, ab: i64) -> i64 {
    let (s, v) = multipart_post(
        app,
        &format!("/api/einsaetze/{einsatz}/dokumente"),
        cookie,
        Some(("lageplan.pdf", b"%PDF-1.4 inhalt")),
        &[
            ("titel", "Lageplan"),
            ("kategorie", "lagekarte_plan"),
            ("bezug_typ", "abschnitt"),
            ("bezug_id", &ab.to_string()),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

async fn umbenennen(app: &axum::Router, cookie: &str, einsatz: i64, ab: i64, body: Value) {
    let (s, v) = anfrage_json(
        app,
        "PATCH",
        &abschnitt_pfad(einsatz, ab),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Was seit dem letzten Lesen am Abo ansteht: die gemeldeten Einheiten (Ankunftsfolge) und wie oft
/// `dokument` und `abloesung` kamen.
#[derive(Debug, PartialEq, Eq)]
struct Gemeldet {
    einheiten: Vec<i64>,
    dokument: usize,
    abloesung: usize,
}

fn gemeldet(rx: &mut Receiver<LiveNachricht>) -> Gemeldet {
    let mut g = Gemeldet {
        einheiten: Vec::new(),
        dokument: 0,
        abloesung: 0,
    };
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "einheit" => {
                let data: Value = serde_json::from_str(&n.data).unwrap();
                g.einheiten.push(data["einheit_id"].as_i64().unwrap());
            }
            "dokument" => g.dokument += 1,
            "abloesung" => g.abloesung += 1,
            _ => {}
        }
    }
    g
}

/// `feld` des Eintrags `id` in der Liste unter `pfad`.
async fn feld_in_liste(app: &axum::Router, cookie: &str, pfad: &str, id: i64, feld: &str) -> Value {
    let l = fetch_json(app, cookie, pfad).await;
    l.as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(id))
        .unwrap_or_else(|| panic!("{id} fehlt: {l}"))[feld]
        .clone()
}

/// Umbenennen meldet genau die Einheiten des Abschnitts, `dokument` nur, wenn ein Dokument ihn als
/// Bezug trägt, und die Ablösung immer. Gleicher Name oder ein anderes Feld melden nichts davon.
#[tokio::test]
async fn umbenennen_meldet_einheiten_dokumente_und_abloesung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt_anlegen(&app, &admin, eid, "Nord").await;
    let sued = abschnitt_anlegen(&app, &admin, eid, "Süd").await;
    let a = einheit_im_abschnitt(&app, &admin, eid, "1. Zug", nord).await;
    let b = einheit_im_abschnitt(&app, &admin, eid, "2. Zug", nord).await;
    let c = einheit_im_abschnitt(&app, &admin, eid, "3. Zug", sued).await;
    einheit_bilden(&app, &admin, eid, "ohne Abschnitt").await;
    let doc = dokument_am_abschnitt(&app, &admin, eid, nord).await;

    let mut rx = live.abonniere(eid);
    for (ab, body, erwartet, fall) in [
        (
            nord,
            json!({"name": "Nordost"}),
            Gemeldet {
                einheiten: vec![a, b],
                dokument: 1,
                abloesung: 1,
            },
            "neuer Name mit Dokument",
        ),
        (
            sued,
            json!({"name": "Südwest"}),
            Gemeldet {
                einheiten: vec![c],
                dokument: 0,
                abloesung: 1,
            },
            "neuer Name ohne Dokument",
        ),
        (
            nord,
            json!({"name": "Nordost"}),
            Gemeldet {
                einheiten: vec![],
                dokument: 0,
                abloesung: 0,
            },
            "gleicher Name",
        ),
        (
            nord,
            json!({"bemerkung": "Deich"}),
            Gemeldet {
                einheiten: vec![],
                dokument: 0,
                abloesung: 0,
            },
            "anderes Feld",
        ),
    ] {
        umbenennen(&app, &admin, eid, ab, body).await;
        assert_eq!(gemeldet(&mut rx), erwartet, "{fall}");
    }
    let einheiten = format!("/api/einsaetze/{eid}/einheiten");
    let dokumente = format!("/api/einsaetze/{eid}/dokumente");
    assert_eq!(
        feld_in_liste(&app, &admin, &einheiten, a, "abschnitt_name").await,
        "Nordost"
    );
    assert_eq!(
        feld_in_liste(&app, &admin, &dokumente, doc, "bezug_abschnitt_name").await,
        "Nordost"
    );
}

/// Auflösen meldet die Einheiten und Dokumente, die danach keinen Abschnitt mehr zeigen, und die
/// Ablösung, deren Vorgaben den Abschnitt nicht mehr listen.
#[tokio::test]
async fn aufloesen_meldet_einheiten_dokumente_und_abloesung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt_anlegen(&app, &admin, eid, "Nord").await;
    let sued = abschnitt_anlegen(&app, &admin, eid, "Süd").await;
    let a = einheit_im_abschnitt(&app, &admin, eid, "1. Zug", nord).await;
    einheit_im_abschnitt(&app, &admin, eid, "3. Zug", sued).await;
    dokument_am_abschnitt(&app, &admin, eid, nord).await;

    let mut rx = live.abonniere(eid);
    let (s, _) = anfrage_json(&app, "DELETE", &abschnitt_pfad(eid, nord), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        gemeldet(&mut rx),
        Gemeldet {
            einheiten: vec![a],
            dokument: 1,
            abloesung: 1,
        }
    );
    let einheiten = format!("/api/einsaetze/{eid}/einheiten");
    assert!(feld_in_liste(&app, &admin, &einheiten, a, "abschnitt_name")
        .await
        .is_null());
}

/// Ein neuer Abschnitt erscheint in den Rhythmus-Vorgaben der Ablösung: `abloesung` geht mit.
#[tokio::test]
async fn anlegen_meldet_die_abloesung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(eid);
    abschnitt_anlegen(&app, &admin, eid, "Nord").await;
    assert_eq!(
        gemeldet(&mut rx),
        Gemeldet {
            einheiten: vec![],
            dokument: 0,
            abloesung: 1,
        }
    );
}

/// Akzeptanzkriterium LLH-1501: eine Person mit Einheiten-, Dokumenten- und Ablösungsrecht, aber
/// ohne Modul Einsatzabschnitte, bekommt beim Umbenennen `einheit`, `dokument` und `abloesung`
/// (und `abschnitt` weiterhin nicht), und ihre Listen tragen danach den neuen Namen.
#[tokio::test]
async fn umbenennen_erreicht_leser_ohne_abschnittsrecht() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt_anlegen(&app, &admin, eid, "Nord").await;
    let a = einheit_im_abschnitt(&app, &admin, eid, "1. Zug", nord).await;
    let doc = dokument_am_abschnitt(&app, &admin, eid, nord).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, eid, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    // Nur Führungskräfte der Organisation sehen die Module, die `abschnitt` erreicht
    // (`LiveEvent::modul_keys`): Abschnitte, Lagekarte, Verpflegung.
    for modul in ["einsatzabschnitte", "lagekarte", "verpflegung"] {
        let (s, v) = anfrage_json(
            &app,
            "PUT",
            &format!("/api/einsaetze/{eid}/modul-overrides/{modul}"),
            &admin,
            Some(&json!({"sichtbar": true, "benoetigte_rolle": "fuehrungskraft"})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "Override {modul}: {v}");
    }
    let einheiten = format!("/api/einsaetze/{eid}/einheiten");
    let dokumente = format!("/api/einsaetze/{eid}/dokumente");
    let vorgaben = format!("/api/einsaetze/{eid}/abloesungen/vorgaben");
    for (pfad, erwartet) in [
        (
            format!("/api/einsaetze/{eid}/abschnitte"),
            StatusCode::FORBIDDEN,
        ),
        (einheiten.clone(), StatusCode::OK),
        (dokumente.clone(), StatusCode::OK),
        (vorgaben.clone(), StatusCode::OK),
    ] {
        let (s, _) = anfrage_json(&app, "GET", &pfad, &frieda, None).await;
        assert_eq!(s, erwartet, "Vorbedingung {pfad}");
    }

    let feed = live_oeffnen(&app, &frieda, eid).await;
    umbenennen(&app, &admin, eid, nord, json!({"name": "Nordost"})).await;
    let gelesen = sse_anfang_lesen(feed.into_body(), 400).await;
    assert!(
        gelesen.contains("event: einheit") && gelesen.contains(&format!(r#""einheit_id":{a}"#)),
        "Einheiten-Leser bekommt die Einheit: {gelesen:?}"
    );
    assert!(
        gelesen.contains("event: dokument"),
        "Dokumenten-Leser bekommt `dokument`: {gelesen:?}"
    );
    assert!(
        gelesen.contains("event: abloesung"),
        "Ablösungs-Leser bekommt `abloesung`: {gelesen:?}"
    );
    assert!(
        !gelesen.contains("event: abschnitt"),
        "das Abschnitts-Ereignis bleibt gegatet: {gelesen:?}"
    );
    assert_eq!(
        feld_in_liste(&app, &frieda, &einheiten, a, "abschnitt_name").await,
        "Nordost"
    );
    assert_eq!(
        feld_in_liste(&app, &frieda, &dokumente, doc, "bezug_abschnitt_name").await,
        "Nordost"
    );
    let v = fetch_json(&app, &frieda, &vorgaben).await;
    assert_eq!(v[0]["abschnitt_name"], "Nordost", "{v}");
}

// ---------- Versorgte Personen (LLH-1682) ----------
//
// Die Personenzeile trägt Name und Abschnitt der versorgenden Einheit per Join. Seit die Tabs die
// Personenliste zeilenweise abgleichen, meldet der Server jede versorgte Person mit `person`,
// wenn sich diese Angaben ändern.

/// Eine Person, die die Einheit `einheit` versorgt.
async fn versorgte_person(app: &axum::Router, cookie: &str, einsatz: i64, einheit: i64) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(&json!({"name": "Muster", "versorgende_einheit_id": einheit})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

/// Die `person_id` aller `person`-Ereignisse, die seit dem letzten Lesen am Abo anstehen.
fn gemeldete_personen(rx: &mut Receiver<LiveNachricht>) -> Vec<i64> {
    let mut ids = Vec::new();
    while let Ok(n) = rx.try_recv() {
        if n.event.as_str() == "person" {
            let data: Value = serde_json::from_str(&n.data).unwrap();
            ids.push(data["person_id"].as_i64().expect("person_id"));
        }
    }
    ids
}

/// Umbenennen und Umhängen der Einheit melden ihre versorgten Personen, ein anderes Feld nicht.
#[tokio::test]
async fn einheit_umbenennen_und_umhaengen_meldet_versorgte_personen() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt_anlegen(&app, &admin, eid, "Nord").await;
    let sued = abschnitt_anlegen(&app, &admin, eid, "Süd").await;
    let zug = einheit_im_abschnitt(&app, &admin, eid, "1. Zug", nord).await;
    let anderer = einheit_im_abschnitt(&app, &admin, eid, "2. Zug", nord).await;
    let p1 = versorgte_person(&app, &admin, eid, zug).await;
    let p2 = versorgte_person(&app, &admin, eid, zug).await;
    versorgte_person(&app, &admin, eid, anderer).await;

    let pfad = format!("/api/einsaetze/{eid}/einheiten/{zug}");
    let mut rx = live.abonniere(eid);
    for (body, erwartet, fall) in [
        (json!({"name": "1. Zug neu"}), vec![p1, p2], "neuer Name"),
        (
            json!({"abschnitt_id": sued}),
            vec![p1, p2],
            "anderer Abschnitt",
        ),
        (json!({"bemerkung": "Deich"}), vec![], "anderes Feld"),
        (json!({"name": "1. Zug neu"}), vec![], "gleicher Name"),
    ] {
        let (s, v) = anfrage_json(&app, "PATCH", &pfad, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::OK, "{fall}: {v}");
        let mut ids = gemeldete_personen(&mut rx);
        ids.sort_unstable();
        assert_eq!(ids, erwartet, "{fall}");
    }
    let personen = format!("/api/einsaetze/{eid}/personen");
    assert_eq!(
        feld_in_liste(&app, &admin, &personen, p1, "versorgende_einheit_name").await,
        "1. Zug neu"
    );
}

/// Umbenennen und Auflösen des Abschnitts melden die Personen, die eine seiner Einheiten versorgt.
#[tokio::test]
async fn abschnitt_umbenennen_und_aufloesen_meldet_versorgte_personen() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt_anlegen(&app, &admin, eid, "Nord").await;
    let sued = abschnitt_anlegen(&app, &admin, eid, "Süd").await;
    let zug = einheit_im_abschnitt(&app, &admin, eid, "1. Zug", nord).await;
    let fremd = einheit_im_abschnitt(&app, &admin, eid, "3. Zug", sued).await;
    let p = versorgte_person(&app, &admin, eid, zug).await;
    versorgte_person(&app, &admin, eid, fremd).await;

    let mut rx = live.abonniere(eid);
    umbenennen(&app, &admin, eid, nord, json!({"name": "Nordost"})).await;
    assert_eq!(gemeldete_personen(&mut rx), vec![p], "Umbenennen");
    let personen = format!("/api/einsaetze/{eid}/personen");
    assert_eq!(
        feld_in_liste(
            &app,
            &admin,
            &personen,
            p,
            "versorgende_einheit_abschnitt_name"
        )
        .await,
        "Nordost"
    );

    let (s, _) = anfrage_json(&app, "DELETE", &abschnitt_pfad(eid, nord), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(gemeldete_personen(&mut rx), vec![p], "Auflösen");
}
