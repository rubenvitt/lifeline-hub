//! Integrationstests des Fachmoduls Betreuung (LFH-639): Statuscodes je Endpunkt, ein
//! Durchstich Bezirk anlegen → Stand 212 → Stand 480 → Rücknahme mit ETB-Nachweis je
//! Schritt, die Rechte (Beobachter, ausgeblendetes Modul, fremde Organisation) und die
//! Live-Verteilung nur an Leser mit Modulrecht.
//!
//! Die Fachlogik der Schreibpfade prüfen `src/betreuung/repo/tests.rs`; hier geht es um das,
//! was erst die Route leistet: Body-Extraktion, Enum- und Zeit-Parsing, Gates, Live.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/betreuung")
}

async fn abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn bezirk(app: &axum::Router, cookie: &str, einsatz: i64, bezeichnung: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("{}/bezirke", pfad(einsatz)),
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","plan_personen":640,"plan_erhebung":"geschaetzt"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Bezirk: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn stelle(app: &axum::Router, cookie: &str, einsatz: i64, bezeichnung: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("{}/stellen", pfad(einsatz)),
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","art":"notunterkunft","kapazitaet_personen":150}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Stelle: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn etb_eintraege(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array().cloned().unwrap_or_default()
}

fn treffer(etb: &[Value], typ: &str, nadeln: &[&str]) -> Vec<Value> {
    etb.iter()
        .filter(|e| {
            e["typ"] == typ
                && e["inhalt"]
                    .as_str()
                    .is_some_and(|i| nadeln.iter().all(|n| i.contains(n)))
        })
        .cloned()
        .collect()
}

/// Zeitpunkt relativ zu jetzt als RFC 3339 (UTC), so wie das Frontend ihn nie schickt,
/// die Route ihn aber annehmen muss.
fn in_sekunden(sekunden: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(sekunden))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

// ── Durchstich ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn durchstich_bezirk_stand_fortschreibung_ruecknahme() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    // Anlegen: angeordnet, ohne Stand, Entscheidung mit Bezeichnung und Plangröße
    let (s, b) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad(e)),
        &admin,
        Some(r#"{"bezeichnung":"Uferstraße 12–40","plan_personen":640,"plan_erhebung":"geschaetzt","sammelstelle":"Parkplatz Nord"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{b:?}");
    assert_eq!(b["raeumung"], "angeordnet");
    assert!(!b.as_object().unwrap().contains_key("stand"), "{b:?}");
    let bid = b["id"].as_i64().unwrap();
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(
        treffer(&etb, "entscheidung", &["Uferstraße 12–40", "640"]).len(),
        1
    );

    // Stand 212, gezählt. Zeitpunkt als ISO mit Zone → normalisiert gespeichert.
    let (s, m1) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &admin,
        Some(r#"{"evakuiert":212,"erhebung":"gezaehlt","zeitpunkt_at":"2026-09-22T09:30:00Z"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m1:?}");
    assert_eq!(m1["bezirk"]["stand"]["evakuiert"], 212);
    assert_eq!(m1["bezirk"]["stand"]["zeitpunkt_at"], "2026-09-22 09:30:00");
    assert_eq!(m1["meldung_id"], m1["bezirk"]["stand"]["id"]);
    let etb = etb_eintraege(&app, &admin, e).await;
    let erste = treffer(&etb, "meldung", &["212", "gezählt", "640"]);
    assert_eq!(erste.len(), 1, "{etb:?}");
    assert_eq!(erste[0]["ereigniszeit"], "2026-09-22 09:30:00");

    // Stand 480 ohne Zeitpunkt (Vorgabe jetzt): nennt den Vorwert
    let (s, m2) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &admin,
        Some(r#"{"evakuiert":480,"erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m2:?}");
    assert_eq!(m2["bezirk"]["stand"]["evakuiert"], 480);
    let m2_id = m2["meldung_id"].as_i64().unwrap();
    let etb = etb_eintraege(&app, &admin, e).await;
    let zweite = treffer(&etb, "meldung", &["480", "vorher 212"]);
    assert_eq!(zweite.len(), 1, "{etb:?}");

    // Rücknahme der 480 → Stand wieder 212, Berichtigung verweist auf die Meldung
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{}/staende/{m2_id}/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert_eq!(r["meldung_id"], m2_id);
    assert_eq!(r["bezirk"]["stand"]["evakuiert"], 212);
    let etb = etb_eintraege(&app, &admin, e).await;
    let berichtigung = treffer(&etb, "berichtigung", &["212"]);
    assert_eq!(berichtigung.len(), 1, "{etb:?}");
    assert_eq!(berichtigung[0]["berichtigt_eintrag_id"], zweite[0]["id"]);

    // Die Übersicht trägt denselben Stand
    let (s, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(u["bezirke"][0]["stand"]["evakuiert"], 212);
    assert_eq!(u["bezirke"][0]["sammelstelle"], "Parkplatz Nord");
    assert_eq!(u["stellen"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn stelle_belegung_kopfzahl_und_ruecknahme() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(r#"{"status":"in_betrieb"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &admin,
        Some(r#"{"belegt":89,"zeitpunkt_at":"2026-09-22 12:00:00"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    assert_eq!(m["stelle"]["belegung"]["belegt"], 89);
    let mid = m["meldung_id"].as_i64().unwrap();
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(treffer(&etb, "meldung", &["89", "150"]).len(), 1);

    // Kopfzahl vor und nach der Meldung (ISO-Stichtag wird normalisiert)
    let (s, k) = anfrage(
        &app,
        "GET",
        &format!("{}/belegung?zeitpunkt=2026-09-22T13:30:00Z", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(k["zeitpunkt_at"], "2026-09-22 13:30:00");
    assert_eq!(k["summe"], 89);
    let (s, k) = anfrage(
        &app,
        "GET",
        &format!("{}/belegung?zeitpunkt=2026-09-22%2011:00:00", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(k["summe"], 0);
    // Der Stichtag liegt vor der Anlage der Stelle (sie entsteht zur echten Uhrzeit): es gab
    // sie noch nicht, also ist sie auch nicht „ohne Meldung“ (LFH-679).
    assert_eq!(k["stellen_ohne_meldung"], 0);
    assert_eq!(k["stellen"].as_array().unwrap().len(), 0);
    // Ohne Stichtag: jetzt
    let (s, k) = anfrage(&app, "GET", &format!("{}/belegung", pfad(e)), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(k["summe"], 89);

    // Rücknahme → keine Belegung mehr
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{}/belegungen/{mid}/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    assert!(
        !r["stelle"].as_object().unwrap().contains_key("belegung"),
        "{r:?}"
    );
    // Jetzt ist die Stelle in Betrieb und ohne Meldung: sie zählt, die Summe ist 0.
    let (s, k) = anfrage(&app, "GET", &format!("{}/belegung", pfad(e)), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(k["summe"], 0);
    assert_eq!(k["stellen_ohne_meldung"], 1);

    // Stornieren nimmt die Stelle aus der Übersicht
    let (s, st) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/stornieren", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{st:?}");
    assert!(st["storniert_at"].is_string());
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["stellen"].as_array().unwrap().len(), 0);
}

/// Ein PATCH ohne neuen Wert schreibt kein ETB und verteilt nichts live (Leerlauf-Riegel,
/// `publiziere_wirksam`). Der Feed ist über beide Leerläufe UND die Gegenprobe offen: genau
/// EIN `betreuung` und EIN `etb` darin gehören zur Gegenprobe. Stünde dort mehr, hätte ein
/// Leerlauf publiziert; stünde dort nichts, bewiese der leere Feed nichts (LFH-682).
#[tokio::test]
async fn patch_ohne_aenderung_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let vorher = etb_eintraege(&app, &admin, e).await.len();
    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, st) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(r#"{"art":"notunterkunft","kapazitaet_personen":150,"bezeichnung":"Turnhalle Ost"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{st:?}");
    let (s, b) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad(e)),
        &admin,
        Some(r#"{"plan_personen":640,"plan_erhebung":"geschaetzt","raeumung":"angeordnet"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b:?}");
    assert_eq!(etb_eintraege(&app, &admin, e).await.len(), vorher);

    // Gegenprobe: eine echte Änderung schreibt, Räumung „geräumt“ als Meldung
    let (s, b) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad(e)),
        &admin,
        Some(r#"{"raeumung":"geraeumt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b:?}");
    assert_eq!(b["raeumung"], "geraeumt");
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(treffer(&etb, "meldung", &["geräumt"]).len(), 1);

    let gelesen = sse_anfang_lesen(feed.into_body(), 400).await;
    let zeilen = |ereignis: &str| gelesen.lines().filter(|z| *z == ereignis).count();
    assert_eq!(
        zeilen("event: betreuung"),
        1,
        "nur die Gegenprobe verteilt: {gelesen:?}"
    );
    assert_eq!(
        zeilen("event: etb"),
        1,
        "nur die Gegenprobe ruft das ETB: {gelesen:?}"
    );
    assert!(
        gelesen.contains(&format!(r#""bezirk_id":{bid}"#))
            && !gelesen.contains(&format!(r#""stelle_id":{sid}"#)),
        "das Ereignis gehört zum Bezirk, nicht zur Stelle: {gelesen:?}"
    );
}

// ── Statuscodes ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn statuscodes_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    // Jeder Schreibpfad legt einen ETB-Eintrag an: bleibt die Zahl stehen, hat keine der
    // abgelehnten Anfragen etwas geschrieben (LFH-682).
    let etb_vorher = etb_eintraege(&app, &admin, e).await.len();

    // Bezirk anlegen
    for body in [
        r#"{"bezeichnung":"A","plan_personen":0,"plan_erhebung":"gezaehlt"}"#,
        r#"{"bezeichnung":"A","plan_personen":-5,"plan_erhebung":"gezaehlt"}"#,
        r#"{"bezeichnung":"A","plan_erhebung":"gezaehlt"}"#,
        r#"{"bezeichnung":"   ","plan_personen":10,"plan_erhebung":"gezaehlt"}"#,
        r#"{"bezeichnung":"A","plan_personen":10,"plan_erhebung":"gefuehlt"}"#,
    ] {
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("{}/bezirke", pfad(e)),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(
        u["bezirke"].as_array().unwrap().len(),
        1,
        "kein Bezirk angelegt: {u:?}"
    );
    // Bezirk ändern: unbekannte Räumung
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad(e)),
        &admin,
        Some(r#"{"raeumung":"evakuiert"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Stand melden: Anzahl −1, Zukunft, unlesbar, unbekannte Erhebung
    for body in [
        r#"{"evakuiert":-1,"erhebung":"gezaehlt"}"#.to_string(),
        format!(
            r#"{{"evakuiert":10,"erhebung":"gezaehlt","zeitpunkt_at":"{}"}}"#,
            in_sekunden(3600)
        ),
        r#"{"evakuiert":10,"erhebung":"gezaehlt","zeitpunkt_at":"gestern"}"#.to_string(),
        r#"{"evakuiert":10,"erhebung":"irgendwie"}"#.to_string(),
    ] {
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("{}/bezirke/{bid}/staende", pfad(e)),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    // Nichts davon wurde gespeichert
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert!(!u["bezirke"][0].as_object().unwrap().contains_key("stand"));

    // Stelle anlegen: unbekannte Art, Kapazität 0
    for body in [
        r#"{"bezeichnung":"B","art":"zelt"}"#,
        r#"{"bezeichnung":"B","art":"anlaufstelle","kapazitaet_personen":0}"#,
    ] {
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("{}/stellen", pfad(e)),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(
        u["stellen"].as_array().unwrap().len(),
        1,
        "keine Stelle angelegt: {u:?}"
    );
    // Belegung: Anzahl −1, Zeitpunkt in der Zukunft, Zeitpunkt unlesbar
    for body in [
        r#"{"belegt":-1}"#.to_string(),
        format!(r#"{{"belegt":3,"zeitpunkt_at":"{}"}}"#, in_sekunden(3600)),
        r#"{"belegt":3,"zeitpunkt_at":"gestern"}"#.to_string(),
    ] {
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("{}/stellen/{sid}/belegungen", pfad(e)),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert!(
        !u["stellen"][0]
            .as_object()
            .unwrap()
            .contains_key("belegung"),
        "keine Belegung gespeichert: {u:?}"
    );
    // Kopfzahl: unlesbarer Stichtag
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/belegung?zeitpunkt=morgen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // Nicht-numerische Sub-ID
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/abc", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    assert_eq!(
        etb_eintraege(&app, &admin, e).await.len(),
        etb_vorher,
        "keine abgelehnte Anfrage hat einen ETB-Eintrag geschrieben"
    );
}

#[tokio::test]
async fn zeitpunkt_knapp_in_der_zukunft_ist_toleriert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let vorher = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    // 30 s Uhrenversatz liegt innerhalb der Toleranz von 60 s
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"evakuiert":10,"erhebung":"gezaehlt","zeitpunkt_at":"{}"}}"#,
            in_sekunden(30)
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"belegt":7,"zeitpunkt_at":"{}"}}"#,
            in_sekunden(30)
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    // LFH-680: gespeichert wird min(zeitpunkt, jetzt) — die Meldung zählt sofort in der
    // Kopfzahl „jetzt“, statt bis zu 60 s darin zu fehlen, während sie schon „aktuell“ ist.
    let nachher = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let gespeichert = m["stelle"]["belegung"]["zeitpunkt_at"].as_str().unwrap();
    assert!(
        vorher.as_str() <= gespeichert && gespeichert <= nachher.as_str(),
        "{vorher} ≤ {gespeichert} ≤ {nachher}"
    );
    let (s, k) = anfrage(&app, "GET", &format!("{}/belegung", pfad(e)), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{k:?}");
    assert_eq!(k["summe"], 7, "{k:?}");
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    let stand = u["bezirke"][0]["stand"]["zeitpunkt_at"].as_str().unwrap();
    assert!(stand <= nachher.as_str(), "{stand} ≤ {nachher}");
}

#[tokio::test]
async fn personenzahlen_haben_eine_obergrenze() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;

    // Eine über der Grenze und das absurde Maximum sind 400 — auf jedem Schreibweg.
    for zu_viel in ["1000001", "9223372036854775807"] {
        for (methode, url, body) in [
            (
                "POST",
                format!("{}/bezirke", pfad(e)),
                format!(
                    r#"{{"bezeichnung":"A","plan_personen":{zu_viel},"plan_erhebung":"gezaehlt"}}"#
                ),
            ),
            (
                "PATCH",
                format!("{}/bezirke/{bid}", pfad(e)),
                format!(r#"{{"plan_personen":{zu_viel}}}"#),
            ),
            (
                "POST",
                format!("{}/bezirke/{bid}/staende", pfad(e)),
                format!(r#"{{"evakuiert":{zu_viel},"erhebung":"gezaehlt"}}"#),
            ),
            (
                "POST",
                format!("{}/stellen", pfad(e)),
                format!(
                    r#"{{"bezeichnung":"B","art":"notunterkunft","kapazitaet_personen":{zu_viel}}}"#
                ),
            ),
            (
                "PATCH",
                format!("{}/stellen/{sid}", pfad(e)),
                format!(r#"{{"kapazitaet_personen":{zu_viel}}}"#),
            ),
            (
                "POST",
                format!("{}/stellen/{sid}/belegungen", pfad(e)),
                format!(r#"{{"belegt":{zu_viel}}}"#),
            ),
        ] {
            let (s, j) = anfrage(&app, methode, &url, &admin, Some(&body)).await;
            assert_eq!(s, StatusCode::BAD_REQUEST, "{methode} {url} {body} → {j:?}");
        }
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["bezirke"].as_array().unwrap().len(), 1, "{u:?}");
    assert_eq!(u["bezirke"][0]["plan_personen"], 640);
    assert!(!u["bezirke"][0].as_object().unwrap().contains_key("stand"));
    assert_eq!(u["stellen"].as_array().unwrap().len(), 1, "{u:?}");
    assert_eq!(u["stellen"][0]["kapazitaet_personen"], 150);
    assert!(!u["stellen"][0]
        .as_object()
        .unwrap()
        .contains_key("belegung"));

    // Die Grenze selbst ist erlaubt.
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad(e)),
        &admin,
        Some(r#"{"plan_personen":1000000}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &admin,
        Some(r#"{"belegt":1000000}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
}

#[tokio::test]
async fn statuscodes_404_409_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let fremder_abschnitt = abschnitt(&app, &admin, e2, "Fremd").await;

    // 404: Abschnitt eines anderen Einsatzes (Bezirk und Stelle), unbekannte Objekte
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"bezeichnung":"A","plan_personen":10,"plan_erhebung":"gezaehlt","abschnitt_id":{fremder_abschnitt}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"bezeichnung":"B","art":"anlaufstelle","abschnitt_id":{fremder_abschnitt}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    for (methode, suffix) in [
        ("PATCH", "bezirke/999999"),
        ("POST", "bezirke/999999/staende"),
        ("POST", "staende/999999/zuruecknehmen"),
        ("POST", "belegungen/999999/zuruecknehmen"),
    ] {
        let (s, _) = anfrage(
            &app,
            methode,
            &format!("{}/{suffix}", pfad(e)),
            &admin,
            Some(r#"{"evakuiert":1,"erhebung":"gezaehlt"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {suffix}");
    }
    // Ein Bezirk aus einem anderen Einsatz ist über diesen Einsatz nicht erreichbar
    let fremder_bezirk = bezirk(&app, &admin, e2, "Fremdbezirk").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{fremder_bezirk}/stornieren", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // 409: doppelte Bezeichnung (Bezirk und Stelle)
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad(e)),
        &admin,
        Some(r#"{"bezeichnung":"Uferstraße 12–40","plan_personen":10,"plan_erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &admin,
        Some(r#"{"bezeichnung":"Turnhalle Ost","art":"anlaufstelle"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    // 422: geschlossene Stelle belegen, belegte Stelle schließen, doppelte Rücknahme
    let stelle_patch = format!("{}/stellen/{sid}", pfad(e));
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &stelle_patch,
        &admin,
        Some(r#"{"status":"geschlossen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "ohne Meldung darf geschlossen werden");
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &admin,
        Some(r#"{"belegt":40}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &stelle_patch,
        &admin,
        Some(r#"{"status":"in_betrieb"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &admin,
        Some(r#"{"belegt":40}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let belegung_40 = m["meldung_id"].as_i64().unwrap();
    let (s, st) = anfrage(
        &app,
        "PATCH",
        &stelle_patch,
        &admin,
        Some(r#"{"status":"geschlossen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{st:?}");

    // 422: dieselbe Belegungsmeldung zweimal zurücknehmen (LFH-682)
    let belegung_ruecknahme = format!("{}/belegungen/{belegung_40}/zuruecknehmen", pfad(e));
    let (s, _) = anfrage(&app, "POST", &belegung_ruecknahme, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, j) = anfrage(&app, "POST", &belegung_ruecknahme, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    // Eine noch nicht zurückgenommene Meldung für den Storno-Fall unten: dort muss die 409
    // vor jeder 422 greifen, und nur eine offene Meldung trennt die beiden.
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &admin,
        Some(r#"{"belegt":12}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let belegung_12 = m["meldung_id"].as_i64().unwrap();

    let (_, m) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &admin,
        Some(r#"{"evakuiert":5,"erhebung":"geschaetzt"}"#),
    )
    .await;
    let mid = m["meldung_id"].as_i64().unwrap();
    let ruecknahme = format!("{}/staende/{mid}/zuruecknehmen", pfad(e));
    let (s, _) = anfrage(&app, "POST", &ruecknahme, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "POST", &ruecknahme, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // 409: storniert — ändern, melden, erneut stornieren
    let stornieren = format!("{}/bezirke/{bid}/stornieren", pfad(e));
    let (s, _) = anfrage(&app, "POST", &stornieren, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "POST", &stornieren, &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad(e)),
        &admin,
        Some(r#"{"plan_personen":900}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &admin,
        Some(r#"{"evakuiert":5,"erhebung":"geschaetzt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    // 409: stornierte Stelle — erneut stornieren, ändern, belegen, Belegung zurücknehmen
    let stelle_stornieren = format!("{}/stellen/{sid}/stornieren", pfad(e));
    let (s, _) = anfrage(&app, "POST", &stelle_stornieren, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "POST", &stelle_stornieren, &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &stelle_patch,
        &admin,
        Some(r#"{"kapazitaet_personen":200}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &admin,
        Some(r#"{"belegt":1}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/belegungen/{belegung_12}/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
}

/// Stelle, Belegung und Rücknahmen eines ANDEREN Einsatzes sind über diesen Einsatz nicht
/// erreichbar (404), und die Anfrage ändert dort nichts. Dazu PATCH an eine unbekannte Stelle.
#[tokio::test]
async fn statuscodes_404_fremder_einsatz_und_unbekannte_stelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;

    let fremde_stelle = stelle(&app, &admin, e2, "Fremdhalle").await;
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen/{fremde_stelle}/belegungen", pfad(e2)),
        &admin,
        Some(r#"{"belegt":40}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    let fremde_belegung = m["meldung_id"].as_i64().unwrap();
    let fremder_bezirk = bezirk(&app, &admin, e2, "Fremdbezirk").await;
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{fremder_bezirk}/staende", pfad(e2)),
        &admin,
        Some(r#"{"evakuiert":7,"erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    let fremder_stand = m["meldung_id"].as_i64().unwrap();
    let etb_fremd_vorher = etb_eintraege(&app, &admin, e2).await.len();

    for (methode, suffix, body) in [
        (
            "PATCH",
            format!("stellen/{fremde_stelle}"),
            Some(r#"{"kapazitaet_personen":200}"#),
        ),
        ("POST", format!("stellen/{fremde_stelle}/stornieren"), None),
        (
            "POST",
            format!("stellen/{fremde_stelle}/belegungen"),
            Some(r#"{"belegt":1}"#),
        ),
        (
            "POST",
            format!("belegungen/{fremde_belegung}/zuruecknehmen"),
            None,
        ),
        (
            "POST",
            format!("staende/{fremder_stand}/zuruecknehmen"),
            None,
        ),
        (
            "PATCH",
            "stellen/999999".to_string(),
            Some(r#"{"kapazitaet_personen":200}"#),
        ),
    ] {
        let (s, j) = anfrage(
            &app,
            methode,
            &format!("{}/{suffix}", pfad(e)),
            &admin,
            body,
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {suffix} → {j:?}");
        assert!(
            !j.to_string().contains("Fremd"),
            "keine Daten des anderen Einsatzes: {j:?}"
        );
    }

    // Im anderen Einsatz ist alles, wie es war.
    let (_, u) = anfrage(&app, "GET", &pfad(e2), &admin, None).await;
    let st = &u["stellen"][0];
    assert_eq!(st["id"], fremde_stelle, "nicht storniert: {u:?}");
    assert_eq!(st["kapazitaet_personen"], 150);
    assert_eq!(
        st["belegung"]["belegt"], 40,
        "Belegung nicht zurückgenommen"
    );
    assert_eq!(
        u["bezirke"][0]["stand"]["evakuiert"], 7,
        "Stand nicht zurückgenommen"
    );
    assert_eq!(
        etb_eintraege(&app, &admin, e2).await.len(),
        etb_fremd_vorher
    );
}

// ── Rechte ──────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (s, _) = anfrage(&app, "GET", &pfad(e), &beob_cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/belegung", pfad(e)),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &beob_cookie,
        Some(r#"{"evakuiert":5,"erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad(e)),
        &beob_cookie,
        Some(r#"{"bezeichnung":"X","plan_personen":10,"plan_erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

async fn override_setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    sichtbar: bool,
    rolle: Option<&str>,
) {
    let rolle = rolle.map_or("null".to_string(), |r| format!(r#""{r}""#));
    let (s, j) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/betreuung"),
        cookie,
        Some(&format!(
            r#"{{"sichtbar":{sichtbar},"benoetigte_rolle":{rolle}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override: {j:?}");
}

#[tokio::test]
async fn ausgeblendetes_modul_ist_403_fuer_mitglieder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: sichtbar liest sie");
    override_setzen(&app, &admin, e, false, None).await;
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad(e)),
        &frieda,
        Some(r#"{"bezeichnung":"X","plan_personen":10,"plan_erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "Admin liest trotz Ausblendung");
}

/// Fremde Organisation. Die Spec schreibt 404; gemessen liefert der Org-Floor der
/// Gate-Extraktoren wie im Bestand 403 (`tests/stab.rs`, `fremde_org_wird_auf_allen_routen_…`).
/// Beide legen nichts offen, deshalb wie dort „403 oder 404“.
#[tokio::test]
async fn fremde_organisation_wird_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    for (methode, uri, body) in [
        ("GET", pfad(e), None),
        ("GET", format!("{}/belegung", pfad(e)), None),
        (
            "POST",
            format!("{}/bezirke/{bid}/staende", pfad(e)),
            Some(r#"{"evakuiert":5,"erhebung":"gezaehlt"}"#),
        ),
    ] {
        let (s, j) = anfrage(&app, methode, &uri, &fremd, body).await;
        assert!(
            s == StatusCode::FORBIDDEN || s == StatusCode::NOT_FOUND,
            "{methode} {uri}: erwartet 403/404, war {s} {j:?}"
        );
        assert!(
            !j.to_string().contains("Uferstraße"),
            "keine Daten an Fremde: {j:?}"
        );
    }
}

// ── Live-Verteilung ─────────────────────────────────────────────────────────────────────────

/// Liest den Anfang eines offenen SSE-Stroms, bis für `stille_ms` nichts mehr kommt
/// (Muster `tests/modul_override.rs`).
async fn sse_anfang_lesen(body: Body, stille_ms: u64) -> String {
    use http_body_util::BodyExt;
    let mut body = body;
    let mut gelesen = String::new();
    while let Ok(Some(Ok(frame))) = tokio::time::timeout(
        std::time::Duration::from_millis(stille_ms),
        std::pin::Pin::new(&mut body).frame(),
    )
    .await
    {
        if let Some(daten) = frame.data_ref() {
            gelesen.push_str(&String::from_utf8_lossy(daten));
        }
    }
    gelesen
}

async fn live_oeffnen(app: &axum::Router, cookie: &str, eid: i64) -> axum::response::Response {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/einsaetze/{eid}/live"))
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp
}

/// Paar: ein Leser MIT Modulrecht bekommt `betreuung`, einer OHNE bekommt es nicht. Die
/// Nutzlast trägt nur Kennungen — Bezeichnung und Anzahl verlassen den Server nicht.
#[tokio::test]
async fn live_ereignis_nur_an_leser_mit_modulrecht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, e, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    // Nur Führungskräfte der Organisation sehen die Betreuung.
    override_setzen(&app, &admin, e, true, Some("fuehrungskraft")).await;
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Vorbedingung: Frieda ohne Modulrecht"
    );
    let (s, _) = anfrage(&app, "GET", &pfad(e), &gustav, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: Gustav mit Modulrecht");

    let feed_gustav = live_oeffnen(&app, &gustav, e).await;
    let feed_frieda = live_oeffnen(&app, &frieda, e).await;

    let bid = bezirk(&app, &admin, e, "Kanarienbezirk").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &admin,
        Some(r#"{"evakuiert":4711,"erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    // Ein Ereignis, das Frieda sehen darf — sonst bewiese ein leerer Feed nichts.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/personen"),
        &admin,
        Some(r#"{"name":"Muster","vorname":"Max"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let bei_gustav = sse_anfang_lesen(feed_gustav.into_body(), 400).await;
    let bei_frieda = sse_anfang_lesen(feed_frieda.into_body(), 400).await;
    assert!(
        bei_gustav.contains("event: betreuung"),
        "Leser mit Modulrecht bekommt das Ereignis: {bei_gustav:?}"
    );
    assert!(
        bei_gustav.contains(&format!(r#""bezirk_id":{bid}"#)),
        "Nutzlast trägt die Bezirk-ID: {bei_gustav:?}"
    );
    // Die Standmeldung schreibt einen ETB-Eintrag, und der geht als eigener Kurzruf hinaus
    // (design.md D5) — ohne ihn bliebe das Tagebuch offener Leser stehen (LFH-682). Geprüft
    // an DIESEM Eintrag: Bezirk und Person rufen das ETB ebenfalls, ein bloßes `event: etb`
    // stünde auch ohne den Kurzruf der Meldung im Feed.
    let etb = etb_eintraege(&app, &admin, e).await;
    let stand_eintrag = treffer(&etb, "meldung", &["Kanarienbezirk", "4711"]);
    assert_eq!(stand_eintrag.len(), 1, "{etb:?}");
    let etb_id = stand_eintrag[0]["id"].as_i64().unwrap();
    // Nur der ETB-Kurzruf trägt `etb_id` (`LiveHub::publiziere`).
    assert!(
        bei_gustav.lines().any(|z| z == "event: etb")
            && bei_gustav.contains(&format!(r#""etb_id":{etb_id}}}"#)),
        "der ETB-Eintrag der Meldung wird live gerufen: {bei_gustav:?}"
    );
    assert!(
        bei_frieda.contains("event: person"),
        "Friedas Feed läuft: {bei_frieda:?}"
    );
    assert!(
        !bei_frieda.contains("event: betreuung"),
        "Leser ohne Modulrecht bekommt es nicht: {bei_frieda:?}"
    );
    // Nur die `data:`-Zeilen: die `id:`-Zeilen tragen Zählerstände, in denen eine Ziffernfolge
    // zufällig vorkommen kann.
    let daten: Vec<&str> = bei_gustav
        .lines()
        .filter(|z| z.starts_with("data:"))
        .collect();
    for kanarienvogel in ["Kanarienbezirk", "4711", "640", "gezaehlt"] {
        assert!(
            daten.iter().all(|z| !z.contains(kanarienvogel)),
            "{kanarienvogel:?} gehört nicht in den Broadcast: {daten:?}"
        );
    }
}

// ── LFH-673: Verortung einer Stelle ─────────────────────────────────────────────────────────

/// Ein PATCH nur mit Koordinate speichert, schreibt KEIN ETB und wird trotzdem live verteilt;
/// derselbe PATCH noch einmal ist Leerlauf und verteilt nichts. Ohne die eigene Achse am
/// Leerlauf-Riegel käme der erste mit 200 zurück, ohne etwas zu speichern (design.md D3).
#[tokio::test]
async fn verortung_speichert_ohne_etb_und_ist_live() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Turnhalle Nord").await;
    let vorher = etb_eintraege(&app, &admin, e).await.len();
    let url = format!("{}/stellen/{sid}", pfad(e));

    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &url,
        &admin,
        Some(r#"{"lat":51.93,"lon":8.87}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["lat"], 51.93);
    assert_eq!(j["lon"], 8.87);
    let bei_admin = sse_anfang_lesen(feed.into_body(), 400).await;
    assert!(
        bei_admin.contains("event: betreuung")
            && bei_admin.contains(&format!(r#""stelle_id":{sid}"#)),
        "Verortung wird live verteilt: {bei_admin:?}"
    );
    assert_eq!(
        etb_eintraege(&app, &admin, e).await.len(),
        vorher,
        "kein ETB-Eintrag"
    );
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["stellen"][0]["lat"], 51.93, "{u:?}");

    // Derselbe PATCH noch einmal: Leerlauf, kein Ereignis.
    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &url,
        &admin,
        Some(r#"{"lat":51.93,"lon":8.87}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let bei_admin = sse_anfang_lesen(feed.into_body(), 400).await;
    assert!(
        !bei_admin.contains("event: betreuung"),
        "unveränderte Koordinate verteilt nichts: {bei_admin:?}"
    );

    // Entfernen: beide Schlüssel fehlen auf dem Draht.
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &url,
        &admin,
        Some(r#"{"lat":null,"lon":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let o = j.as_object().unwrap();
    assert!(!o.contains_key("lat") && !o.contains_key("lon"), "{j:?}");
}

#[tokio::test]
async fn verortung_halbes_paar_oder_bereich_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "NU Turnhalle Nord").await;
    let url = format!("{}/stellen/{sid}", pfad(e));
    for body in [
        r#"{"lat":51.93}"#,
        r#"{"lat":91,"lon":8}"#,
        r#"{"lat":51,"lon":-181}"#,
    ] {
        let (s, j) = anfrage(&app, "PATCH", &url, &admin, Some(body)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body} → {j:?}");
    }
    // Falscher Feldtyp scheitert isoliert am Feld → 400.
    let (s, _) = anfrage(&app, "PATCH", &url, &admin, Some(r#"{"lat":"x","lon":8}"#)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

// ── Lagekennzahl `evakuiert` am Einsatz (LFH-607) ──────────────────────────────────────────

/// `lagekennzahlen` des Einsatzes aus Detail- UND Listenantwort. Das Feld wird an zwei Stellen
/// gebaut (`Einsatz::anzeige`, `repo::liste_fuer`) — geprüft wird beides, und das
/// Vorhandensein per `contains_key`: ein fehlender Key sähe per Index wie `null` aus.
async fn lagekennzahlen(app: &axum::Router, cookie: &str, einsatz: i64) -> (Value, Value) {
    let (s, detail) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{detail:?}");
    assert!(
        detail.as_object().unwrap().contains_key("lagekennzahlen"),
        "Detail: nie absent, leer ist []: {detail:?}"
    );
    let (s, liste) = anfrage(app, "GET", "/api/einsaetze", cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{liste:?}");
    let zeile = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(einsatz))
        .expect("Einsatz in der Liste")
        .clone();
    assert!(
        zeile.as_object().unwrap().contains_key("lagekennzahlen"),
        "Liste: nie absent, leer ist []: {zeile:?}"
    );
    (
        detail["lagekennzahlen"].clone(),
        zeile["lagekennzahlen"].clone(),
    )
}

async fn raeumung(app: &axum::Router, cookie: &str, einsatz: i64, bid: i64, zustand: &str) {
    let (s, b) = anfrage(
        app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad(einsatz)),
        cookie,
        Some(&format!(r#"{{"raeumung":"{zustand}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Räumung {zustand}: {b:?}");
}

/// Der Auslöser folgt den aktiven Bezirken — dieselbe Definition wie `istAktiverBezirk` im
/// Frontend: nicht storniert, Räumung nicht `aufgehoben`. Standmeldungen ändern ihn nie
/// (Messwert, keine Entscheidung; Prüfliste Kriterium 9).
#[tokio::test]
async fn bezirk_schaltet_die_lagekennzahl_am_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let leer = serde_json::json!([]);
    let evakuiert = serde_json::json!(["evakuiert"]);
    let ist = |p: (Value, Value), soll: &Value, schritt: &str| {
        assert_eq!(&p.0, soll, "Detail nach „{schritt}“");
        assert_eq!(&p.1, soll, "Liste nach „{schritt}“");
    };

    ist(lagekennzahlen(&app, &admin, e).await, &leer, "ohne Bezirk");

    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    ist(
        lagekennzahlen(&app, &admin, e).await,
        &evakuiert,
        "angelegt",
    );
    ist(
        lagekennzahlen(&app, &admin, anderer).await,
        &leer,
        "anderer Einsatz",
    );

    // Stand melden und zurücknehmen: kein Wechsel.
    let (s, m) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad(e)),
        &admin,
        Some(r#"{"evakuiert":0,"erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    ist(lagekennzahlen(&app, &admin, e).await, &evakuiert, "Stand 0");
    let mid = m["meldung_id"].as_i64().unwrap();
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{}/staende/{mid}/zuruecknehmen", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    ist(
        lagekennzahlen(&app, &admin, e).await,
        &evakuiert,
        "Rücknahme",
    );

    // Geräumt ist das Ergebnis, nicht das Ende.
    raeumung(&app, &admin, e, bid, "geraeumt").await;
    ist(lagekennzahlen(&app, &admin, e).await, &evakuiert, "geräumt");

    // Aufheben nimmt die Anordnung zurück.
    raeumung(&app, &admin, e, bid, "aufgehoben").await;
    ist(lagekennzahlen(&app, &admin, e).await, &leer, "aufgehoben");

    // Ein zweiter Bezirk schaltet wieder, Stornieren (Fehlanlage) nimmt ihn zurück.
    let zweiter = bezirk(&app, &admin, e, "Deichweg").await;
    ist(
        lagekennzahlen(&app, &admin, e).await,
        &evakuiert,
        "zweiter angelegt",
    );
    let (s, b) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{zweiter}/stornieren", pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b:?}");
    ist(lagekennzahlen(&app, &admin, e).await, &leer, "storniert");
}

// ── Offline-Erfassung (LFH-675) ─────────────────────────────────────────────────────────────

fn stand_body(evakuiert: i64, client_id: &str) -> String {
    serde_json::json!({ "evakuiert": evakuiert, "erhebung": "gezaehlt", "client_id": client_id })
        .to_string()
}

fn belegung_body(belegt: i64, client_id: &str) -> String {
    serde_json::json!({ "belegt": belegt, "client_id": client_id }).to_string()
}

/// Replay derselben Meldung: 201, dieselbe Meldungskennung, genau ein ETB-Eintrag — für
/// Stand und Belegung. Der Replay trägt bewusst eine andere Zahl: maßgeblich ist der Schlüssel.
#[tokio::test]
async fn replay_liefert_die_bestehende_meldung_ohne_zweiten_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;

    let url_stand = format!("{}/bezirke/{bid}/staende", pfad(e));
    let (s, erst) = anfrage(
        &app,
        "POST",
        &url_stand,
        &admin,
        Some(&stand_body(480, "a1")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{erst:?}");
    let (s, wieder) = anfrage(&app, "POST", &url_stand, &admin, Some(&stand_body(9, "a1"))).await;
    assert_eq!(s, StatusCode::CREATED, "{wieder:?}");
    assert_eq!(wieder["meldung_id"], erst["meldung_id"]);
    assert_eq!(wieder["bezirk"]["stand"]["evakuiert"], 480);

    let url_beleg = format!("{}/stellen/{sid}/belegungen", pfad(e));
    let (s, erst_b) = anfrage(
        &app,
        "POST",
        &url_beleg,
        &admin,
        Some(&belegung_body(37, "b1")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{erst_b:?}");
    let (s, wieder_b) = anfrage(
        &app,
        "POST",
        &url_beleg,
        &admin,
        Some(&belegung_body(37, "b1")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{wieder_b:?}");
    assert_eq!(wieder_b["meldung_id"], erst_b["meldung_id"]);

    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(treffer(&etb, "meldung", &["Uferstraße", "480"]).len(), 1);
    assert_eq!(treffer(&etb, "meldung", &["Turnhalle Ost", "37"]).len(), 1);
}

/// Ein leerer Schlüssel ist keiner (zwei Meldungen), ein zu langer ist 400 und speichert nichts.
#[tokio::test]
async fn client_id_leer_oder_zu_lang() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße").await;
    let url = format!("{}/bezirke/{bid}/staende", pfad(e));

    let (s, a) = anfrage(&app, "POST", &url, &admin, Some(&stand_body(1, "  "))).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, b) = anfrage(&app, "POST", &url, &admin, Some(&stand_body(2, "  "))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_ne!(
        a["meldung_id"], b["meldung_id"],
        "leer heißt: kein Schlüssel"
    );

    let lang = "x".repeat(65);
    let (s, _) = anfrage(&app, "POST", &url, &admin, Some(&stand_body(3, &lang))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let url_b = format!(
        "{}/stellen/{}/belegungen",
        pfad(e),
        stelle(&app, &admin, e, "Halle").await
    );
    let (s, _) = anfrage(&app, "POST", &url_b, &admin, Some(&belegung_body(3, &lang))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let etb = etb_eintraege(&app, &admin, e).await;
    assert!(treffer(&etb, "meldung", &["Halle"]).is_empty());
    assert_eq!(treffer(&etb, "meldung", &["Uferstraße"]).len(), 2);
}

/// Nach Einsatzabschluss kommt eine gespeicherte Meldung als Replay zurück; eine neue bleibt
/// gesperrt. Ein Schlüssel eines anderen Bezirks ist 422.
#[tokio::test]
async fn replay_nach_abschluss_und_schluessel_eines_anderen_bezirks() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let a = bezirk(&app, &admin, e, "Uferstraße").await;
    let b = bezirk(&app, &admin, e, "Deichweg").await;
    let url_a = format!("{}/bezirke/{a}/staende", pfad(e));
    let url_b = format!("{}/bezirke/{b}/staende", pfad(e));
    let (s, erst) = anfrage(&app, "POST", &url_a, &admin, Some(&stand_body(12, "a3"))).await;
    assert_eq!(s, StatusCode::CREATED);

    let (s, _) = anfrage(&app, "POST", &url_b, &admin, Some(&stand_body(12, "a3"))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, wieder) = anfrage(&app, "POST", &url_a, &admin, Some(&stand_body(12, "a3"))).await;
    assert_eq!(s, StatusCode::CREATED, "{wieder:?}");
    assert_eq!(wieder["meldung_id"], erst["meldung_id"]);
    let (s, _) = anfrage(
        &app,
        "POST",
        &url_a,
        &admin,
        Some(&stand_body(13, "a3-neu")),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "echter Insert bleibt gesperrt");
}

/// Die Gates laufen VOR dem Replay-Lookup: ein Beobachter bekommt auch mit einem bekannten
/// Schlüssel 403 und keine Daten; ein fremder Queue-Besitzer 412.
#[tokio::test]
async fn gates_vor_dem_replay() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let url = format!("{}/stellen/{sid}/belegungen", pfad(e));
    let (s, _) = anfrage(&app, "POST", &url, &admin, Some(&belegung_body(37, "b5"))).await;
    assert_eq!(s, StatusCode::CREATED);

    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &url,
        &beob_cookie,
        Some(&belegung_body(37, "b5")),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(json.get("meldung_id").is_none(), "{json:?}");

    let (s, _) = anfrage_mit_offline_queue_benutzer(
        &app,
        "POST",
        &url,
        &admin,
        Some(&belegung_body(37, "b5")),
        i64::MAX,
    )
    .await;
    assert_eq!(s, StatusCode::PRECONDITION_FAILED);
    let (s, _) = anfrage_mit_offline_queue_benutzer(
        &app,
        "POST",
        &format!(
            "{}/bezirke/{}/staende",
            pfad(e),
            bezirk(&app, &admin, e, "Ufer").await
        ),
        &admin,
        Some(&stand_body(1, "a5")),
        i64::MAX,
    )
    .await;
    assert_eq!(s, StatusCode::PRECONDITION_FAILED);
}

/// Eine Erstmeldung verteilt ETB- und Modul-Ereignis, ihr Replay nichts (design.md D5).
#[tokio::test]
async fn replay_verteilt_kein_live_ereignis() {
    use lifeline_hub::live::LiveEvent;
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße").await;
    let url = format!("{}/bezirke/{bid}/staende", pfad(e));
    let mut events = live.abonniere(e);

    let (s, _) = anfrage(&app, "POST", &url, &admin, Some(&stand_body(5, "a6"))).await;
    assert_eq!(s, StatusCode::CREATED);
    let mut empfangen = Vec::new();
    for _ in 0..2 {
        empfangen.push(
            tokio::time::timeout(std::time::Duration::from_secs(1), events.recv())
                .await
                .expect("Erstmeldung verteilt live")
                .unwrap()
                .event,
        );
    }
    assert!(empfangen.contains(&LiveEvent::Etb));
    assert!(empfangen.contains(&LiveEvent::Betreuung));

    let (s, _) = anfrage(&app, "POST", &url, &admin, Some(&stand_body(5, "a6"))).await;
    assert_eq!(s, StatusCode::CREATED);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(150), events.recv())
            .await
            .is_err(),
        "ein Replay verteilt nichts"
    );
}

/// Die zwei Spec-Szenarien „Replay nach Zustandswechsel“ dort, wo der Client sie erlebt: am
/// stornierten Bezirk 201 statt 409, an der geschlossenen Stelle 201 statt 422 — und eine
/// NEUE Meldung an beiden bleibt abgelehnt.
#[tokio::test]
async fn replay_am_stornierten_bezirk_und_an_der_geschlossenen_stelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let bid = bezirk(&app, &admin, e, "Uferstraße").await;
    let url_stand = format!("{}/bezirke/{bid}/staende", pfad(e));
    let (s, erst) = anfrage(
        &app,
        "POST",
        &url_stand,
        &admin,
        Some(&stand_body(40, "a7")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/stornieren", pfad(e)),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, wieder) = anfrage(
        &app,
        "POST",
        &url_stand,
        &admin,
        Some(&stand_body(40, "a7")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{wieder:?}");
    assert_eq!(wieder["meldung_id"], erst["meldung_id"]);
    let (s, _) = anfrage(
        &app,
        "POST",
        &url_stand,
        &admin,
        Some(&stand_body(1, "a7-neu")),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let url_beleg = format!("{}/stellen/{sid}/belegungen", pfad(e));
    let (s, erst) = anfrage(
        &app,
        "POST",
        &url_beleg,
        &admin,
        Some(&belegung_body(0, "b7")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(r#"{"status":"geschlossen"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, wieder) = anfrage(
        &app,
        "POST",
        &url_beleg,
        &admin,
        Some(&belegung_body(0, "b7")),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{wieder:?}");
    assert_eq!(wieder["meldung_id"], erst["meldung_id"]);
    let (s, _) = anfrage(
        &app,
        "POST",
        &url_beleg,
        &admin,
        Some(&belegung_body(3, "b7-neu")),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(treffer(&etb, "meldung", &["Uferstraße", "40"]).len(), 1);
    assert_eq!(treffer(&etb, "meldung", &["Turnhalle Ost"]).len(), 1);
}
