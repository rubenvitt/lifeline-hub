//! Integrationstests der Fachmodule Betreuung (LFH-639) und Evakuierung (LLH-1034, Bezirke unter
//! `…/evakuierung`): Statuscodes je Endpunkt, ein
//! Durchstich Bezirk anlegen → Stand 212 → Stand 480 → Rücknahme mit ETB-Nachweis je
//! Schritt, die Rechte (Beobachter, ausgeblendetes Modul, fremde Organisation) und die
//! Live-Verteilung nur an Leser mit Modulrecht.
//!
//! Die Fachlogik der Schreibpfade prüfen `src/betreuung/repo/tests.rs`; hier geht es um das,
//! was erst die Route leistet: Body-Extraktion, Enum- und Zeit-Parsing, Gates, Live.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/betreuung")
}

/// Bezirke und Stände sind seit LLH-1034 das eigene Modul Evakuierung.
fn pfad_evak(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/evakuierung")
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
        &format!("{}/bezirke", pfad_evak(einsatz)),
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","plan_personen":640,"plan_erhebung":"geschaetzt"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Bezirk: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Die Bezirke aus `GET …/evakuierung` (LLH-1034).
async fn bezirke_von(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (s, u) = anfrage(app, "GET", &pfad_evak(einsatz), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{u:?}");
    u["bezirke"].clone()
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
        &format!("{}/bezirke", pfad_evak(e)),
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
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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
        &format!("{}/staende/{m2_id}/zuruecknehmen", pfad_evak(e)),
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
    let bz = bezirke_von(&app, &admin, e).await;
    assert_eq!(bz[0]["stand"]["evakuiert"], 212);
    assert_eq!(bz[0]["sammelstelle"], "Parkplatz Nord");
    // Die Betreuungsübersicht trägt seit LLH-1034 keine Bezirke mehr.
    let (s, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(u.get("bezirke").is_none(), "{u:?}");
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
/// EIN `evakuierung` und EIN `etb` darin gehören zur Gegenprobe (am Bezirk); `betreuung`
/// (Leerlauf an der Stelle) steht gar nicht darin. Stünde dort mehr, hätte ein
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
        &format!("{}/bezirke/{bid}", pfad_evak(e)),
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
        &format!("{}/bezirke/{bid}", pfad_evak(e)),
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
        zeilen("event: evakuierung"),
        1,
        "nur die Gegenprobe verteilt: {gelesen:?}"
    );
    assert_eq!(
        zeilen("event: betreuung"),
        0,
        "der Leerlauf an der Stelle verteilt nichts: {gelesen:?}"
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
            &format!("{}/bezirke", pfad_evak(e)),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    let bz = bezirke_von(&app, &admin, e).await;
    assert_eq!(
        bz.as_array().unwrap().len(),
        1,
        "kein Bezirk angelegt: {bz:?}"
    );
    // Bezirk ändern: unbekannte Räumung
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad_evak(e)),
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
            &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {j:?}");
    }
    // Nichts davon wurde gespeichert
    let bz = bezirke_von(&app, &admin, e).await;
    assert!(!bz[0].as_object().unwrap().contains_key("stand"));

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
        &format!("{}/bezirke/abc", pfad_evak(e)),
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
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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
    let bz = bezirke_von(&app, &admin, e).await;
    let stand = bz[0]["stand"]["zeitpunkt_at"].as_str().unwrap();
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
                format!("{}/bezirke", pfad_evak(e)),
                format!(
                    r#"{{"bezeichnung":"A","plan_personen":{zu_viel},"plan_erhebung":"gezaehlt"}}"#
                ),
            ),
            (
                "PATCH",
                format!("{}/bezirke/{bid}", pfad_evak(e)),
                format!(r#"{{"plan_personen":{zu_viel}}}"#),
            ),
            (
                "POST",
                format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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
    let bz = bezirke_von(&app, &admin, e).await;
    assert_eq!(bz.as_array().unwrap().len(), 1, "{bz:?}");
    assert_eq!(bz[0]["plan_personen"], 640);
    assert!(!bz[0].as_object().unwrap().contains_key("stand"));
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
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
        &format!("{}/bezirke/{bid}", pfad_evak(e)),
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
        &format!("{}/bezirke", pfad_evak(e)),
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
        ("PATCH", format!("{}/bezirke/999999", pfad_evak(e))),
        ("POST", format!("{}/bezirke/999999/staende", pfad_evak(e))),
        (
            "POST",
            format!("{}/staende/999999/zuruecknehmen", pfad_evak(e)),
        ),
        (
            "POST",
            format!("{}/belegungen/999999/zuruecknehmen", pfad(e)),
        ),
    ] {
        let (s, _) = anfrage(
            &app,
            methode,
            &suffix,
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
        &format!("{}/bezirke/{fremder_bezirk}/stornieren", pfad_evak(e)),
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
        &format!("{}/bezirke", pfad_evak(e)),
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
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
        &admin,
        Some(r#"{"evakuiert":5,"erhebung":"geschaetzt"}"#),
    )
    .await;
    let mid = m["meldung_id"].as_i64().unwrap();
    let ruecknahme = format!("{}/staende/{mid}/zuruecknehmen", pfad_evak(e));
    let (s, _) = anfrage(&app, "POST", &ruecknahme, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "POST", &ruecknahme, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // 409: storniert — ändern, melden, erneut stornieren
    let stornieren = format!("{}/bezirke/{bid}/stornieren", pfad_evak(e));
    let (s, _) = anfrage(&app, "POST", &stornieren, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(&app, "POST", &stornieren, &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/bezirke/{bid}", pfad_evak(e)),
        &admin,
        Some(r#"{"plan_personen":900}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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
        &format!("{}/bezirke/{fremder_bezirk}/staende", pfad_evak(e2)),
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
            format!("../evakuierung/staende/{fremder_stand}/zuruecknehmen"),
            None,
        ),
        (
            "PATCH",
            "stellen/999999".to_string(),
            Some(r#"{"kapazitaet_personen":200}"#),
        ),
    ] {
        // `../evakuierung/…`: die Rücknahme eines Stands liegt seit LLH-1034 im Modul Evakuierung.
        let url = match suffix.strip_prefix("../evakuierung/") {
            Some(rest) => format!("{}/{rest}", pfad_evak(e)),
            None => format!("{}/{suffix}", pfad(e)),
        };
        let (s, j) = anfrage(&app, methode, &url, &admin, body).await;
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
        bezirke_von(&app, &admin, e2).await[0]["stand"]["evakuiert"],
        7,
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
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
        &beob_cookie,
        Some(r#"{"evakuiert":5,"erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad_evak(e)),
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
    modul: &str,
    sichtbar: bool,
    rolle: Option<&str>,
) {
    let rolle = rolle.map_or("null".to_string(), |r| format!(r#""{r}""#));
    let (s, j) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
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
    override_setzen(&app, &admin, e, "betreuung", false, None).await;
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &frieda,
        Some(r#"{"bezeichnung":"X","art":"anlaufstelle"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "Admin liest trotz Ausblendung");

    // LLH-1034: zwei Module. Ohne Betreuung bleibt die Evakuierung erreichbar …
    let (s, _) = anfrage(&app, "GET", &pfad_evak(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Evakuierung hängt nicht an Betreuung");
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad_evak(e)),
        &frieda,
        Some(r#"{"bezeichnung":"X","plan_personen":10,"plan_erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    let bid = j["id"].as_i64().unwrap();

    // … und umgekehrt: Evakuierung ausgeblendet, Betreuung wieder frei.
    override_setzen(&app, &admin, e, "betreuung", true, None).await;
    override_setzen(&app, &admin, e, "evakuierung", false, None).await;
    let (s, _) = anfrage(&app, "GET", &pfad(e), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Betreuung hängt nicht an Evakuierung");
    for (methode, uri, body) in [
        ("GET", pfad_evak(e), None),
        (
            "POST",
            format!("{}/bezirke", pfad_evak(e)),
            Some(r#"{"bezeichnung":"Y","plan_personen":10,"plan_erhebung":"gezaehlt"}"#),
        ),
        (
            "POST",
            format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
            Some(r#"{"evakuiert":5,"erhebung":"gezaehlt"}"#),
        ),
        (
            "GET",
            format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
            None,
        ),
    ] {
        let (s, j) = anfrage(&app, methode, &uri, &frieda, body).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {uri}: {j:?}");
    }
    let (s, _) = anfrage(&app, "GET", &pfad_evak(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "Admin liest trotz Ausblendung");
}

/// LLH-1034: Die Bezirksrouten sind aus `…/betreuung` umgezogen und dort nicht mehr erreichbar.
#[tokio::test]
async fn alte_bezirksrouten_unter_betreuung_gibt_es_nicht_mehr() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    for (methode, uri, body) in [
        (
            "POST",
            format!("{}/bezirke", pfad(e)),
            Some(r#"{"bezeichnung":"Alt","plan_personen":10,"plan_erhebung":"gezaehlt"}"#),
        ),
        (
            "POST",
            format!("{}/bezirke/{bid}/staende", pfad(e)),
            Some(r#"{"evakuiert":5,"erhebung":"gezaehlt"}"#),
        ),
        ("GET", format!("{}/bezirke/{bid}/staende", pfad(e)), None),
    ] {
        let (s, j) = anfrage(&app, methode, &uri, &admin, body).await;
        assert!(
            s == StatusCode::NOT_FOUND || s == StatusCode::METHOD_NOT_ALLOWED,
            "{methode} {uri}: {s} {j:?}"
        );
    }
    let bz = bezirke_von(&app, &admin, e).await;
    assert_eq!(bz.as_array().unwrap().len(), 1, "nichts angelegt: {bz:?}");
    assert!(!bz[0].as_object().unwrap().contains_key("stand"), "{bz:?}");
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
            format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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

/// Paar: ein Leser MIT Modulrecht bekommt `evakuierung`, einer OHNE bekommt es nicht. Die
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
    // Nur Führungskräfte der Organisation sehen die Evakuierung.
    override_setzen(&app, &admin, e, "evakuierung", true, Some("fuehrungskraft")).await;
    let (s, _) = anfrage(&app, "GET", &pfad_evak(e), &frieda, None).await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Vorbedingung: Frieda ohne Modulrecht"
    );
    let (s, _) = anfrage(&app, "GET", &pfad_evak(e), &gustav, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: Gustav mit Modulrecht");

    let feed_gustav = live_oeffnen(&app, &gustav, e).await;
    let feed_frieda = live_oeffnen(&app, &frieda, e).await;

    let bid = bezirk(&app, &admin, e, "Kanarienbezirk").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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
        bei_gustav.contains("event: evakuierung"),
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
        !bei_frieda.contains("event: evakuierung"),
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

// ── LLH-1121: Koordinate aus dem Ortsfeld beim Anlegen und an der Sammelstelle ─────────────

/// POST einer Stelle mit Standort und Koordinate (Ortsfeld): beides kommt zurück und steht in der
/// Übersicht; die Koordinate geht nicht ins ETB.
#[tokio::test]
async fn stelle_mit_koordinate_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &admin,
        Some(
            r#"{"bezeichnung":"NU Turnhalle Nord","art":"notunterkunft",
                "standort":"Nordring 5, 12345 Musterstadt","lat":51.93,"lon":8.87}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(j["standort"], "Nordring 5, 12345 Musterstadt");
    assert_eq!(
        (j["lat"].clone(), j["lon"].clone()),
        (51.93.into(), 8.87.into())
    );
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["stellen"][0]["lat"], 51.93, "{u:?}");
    let etb = etb_eintraege(&app, &admin, e).await;
    assert!(
        etb.iter()
            .all(|x| !x["inhalt"].as_str().unwrap_or("").contains("51.93")),
        "{etb:?}"
    );
}

#[tokio::test]
async fn stelle_anlegen_halbes_paar_oder_bereich_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let url = format!("{}/stellen", pfad(e));
    for koordinate in [
        r#""lat":51.93"#,
        r#""lon":8.87"#,
        r#""lat":51.93,"lon":null"#,
        r#""lat":91,"lon":8"#,
        r#""lat":51,"lon":-181"#,
    ] {
        let body = format!(r#"{{"bezeichnung":"NU Nord","art":"notunterkunft",{koordinate}}}"#);
        let (s, j) = anfrage(&app, "POST", &url, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body} → {j:?}");
    }
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["stellen"], serde_json::json!([]), "nichts angelegt");
}

/// Sammelstelle mit Koordinate anlegen und fortschreiben: die Koordinate steht im Bezirk, ein
/// PATCH nur mit ihr schreibt kein ETB und wird trotzdem live verteilt; `null` entfernt sie.
#[tokio::test]
async fn sammelstelle_mit_koordinate_anlegen_aendern_entfernen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke", pfad_evak(e)),
        &admin,
        Some(
            r#"{"bezeichnung":"Uferstraße 12–40","plan_personen":640,"plan_erhebung":"geschaetzt",
                "sammelstelle":"Kirchplatz 1","sammelstelle_lat":52.1,"sammelstelle_lon":9.35}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert_eq!(j["sammelstelle"], "Kirchplatz 1");
    assert_eq!(j["sammelstelle_lat"], 52.1);
    assert_eq!(j["sammelstelle_lon"], 9.35);
    let bid = j["id"].as_i64().unwrap();
    assert_eq!(
        bezirke_von(&app, &admin, e).await[0]["sammelstelle_lat"],
        52.1
    );

    let url = format!("{}/bezirke/{bid}", pfad_evak(e));
    let vorher = etb_eintraege(&app, &admin, e).await.len();
    let feed = live_oeffnen(&app, &admin, e).await;
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &url,
        &admin,
        Some(r#"{"sammelstelle_lat":52.2,"sammelstelle_lon":9.4}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(
        (j["sammelstelle_lat"].clone(), j["sammelstelle_lon"].clone()),
        (52.2.into(), 9.4.into())
    );
    let gelesen = sse_anfang_lesen(feed.into_body(), 400).await;
    assert!(
        gelesen.contains("event: evakuierung")
            && gelesen.contains(&format!(r#""bezirk_id":{bid}"#)),
        "Verortung der Sammelstelle wird live verteilt: {gelesen:?}"
    );
    assert_eq!(
        etb_eintraege(&app, &admin, e).await.len(),
        vorher,
        "kein ETB-Eintrag"
    );

    let (s, j) = anfrage(
        &app,
        "PATCH",
        &url,
        &admin,
        Some(r#"{"sammelstelle_lat":null,"sammelstelle_lon":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let o = j.as_object().unwrap();
    assert!(
        !o.contains_key("sammelstelle_lat") && !o.contains_key("sammelstelle_lon"),
        "{j:?}"
    );
}

#[tokio::test]
async fn sammelstelle_halbes_paar_oder_bereich_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for koordinate in [
        r#""sammelstelle_lat":52.1"#,
        r#""sammelstelle_lat":91,"sammelstelle_lon":9"#,
    ] {
        let body = format!(
            r#"{{"bezeichnung":"Uferstraße","plan_personen":640,"plan_erhebung":"geschaetzt",{koordinate}}}"#
        );
        let (s, j) = anfrage(
            &app,
            "POST",
            &format!("{}/bezirke", pfad_evak(e)),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body} → {j:?}");
    }
    let bid = bezirk(&app, &admin, e, "Deichweg").await;
    let url = format!("{}/bezirke/{bid}", pfad_evak(e));
    for body in [
        r#"{"sammelstelle_lon":9.35}"#,
        r#"{"sammelstelle_lat":52.1,"sammelstelle_lon":-181}"#,
    ] {
        let (s, j) = anfrage(&app, "PATCH", &url, &admin, Some(body)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body} → {j:?}");
    }
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &url,
        &admin,
        Some(r#"{"sammelstelle_lat":"x","sammelstelle_lon":9}"#),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "falscher Feldtyp scheitert am Feld"
    );
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
        &format!("{}/bezirke/{bid}", pfad_evak(einsatz)),
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
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
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
        &format!("{}/staende/{mid}/zuruecknehmen", pfad_evak(e)),
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
        &format!("{}/bezirke/{zweiter}/stornieren", pfad_evak(e)),
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

    let url_stand = format!("{}/bezirke/{bid}/staende", pfad_evak(e));
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
    let url = format!("{}/bezirke/{bid}/staende", pfad_evak(e));

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
    let url_a = format!("{}/bezirke/{a}/staende", pfad_evak(e));
    let url_b = format!("{}/bezirke/{b}/staende", pfad_evak(e));
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
            pfad_evak(e),
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
    let url = format!("{}/bezirke/{bid}/staende", pfad_evak(e));
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
    assert!(empfangen.contains(&LiveEvent::Evakuierung));

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
    let url_stand = format!("{}/bezirke/{bid}/staende", pfad_evak(e));
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
        &format!("{}/bezirke/{bid}/stornieren", pfad_evak(e)),
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

// ── Verlauf (LFH-676) ───────────────────────────────────────────────────────────────────────

async fn melden(app: &axum::Router, cookie: &str, uri: &str, body: &str) -> i64 {
    let (s, j) = anfrage(app, "POST", uri, cookie, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "{uri}: {j:?}");
    j["meldung_id"].as_i64().unwrap()
}

#[tokio::test]
async fn verlauf_liefert_die_reihen_mit_ruecknahme_und_draht_form() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let staende = format!("{}/bezirke/{bid}/staende", pfad_evak(e));
    let m212 = melden(
        &app,
        &admin,
        &staende,
        r#"{"evakuiert":212,"erhebung":"geschaetzt","zeitpunkt_at":"2026-09-22T10:00:00Z"}"#,
    )
    .await;
    melden(
        &app,
        &admin,
        &staende,
        r#"{"evakuiert":480,"erhebung":"gezaehlt","zeitpunkt_at":"2026-09-22T11:00:00Z"}"#,
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/staende/{m212}/zuruecknehmen", pfad_evak(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = anfrage(&app, "GET", &staende, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    let reihe = v.as_array().unwrap();
    assert_eq!(reihe.len(), 2, "{v:?}");
    assert_eq!(reihe[0]["evakuiert"], 480);
    assert_eq!(reihe[0]["aktuell"], true);
    assert_eq!(reihe[0]["zeitpunkt_at"], "2026-09-22 11:00:00");
    assert_eq!(reihe[0]["erhebung"], "gezaehlt");
    assert!(reihe[0]["erfasst_von"].is_string());
    assert!(reihe[0]["erfasst_at"].is_string());
    let offen = reihe[0].as_object().unwrap();
    assert!(!offen.contains_key("zurueckgenommen_at"), "{v:?}");
    assert!(!offen.contains_key("zurueckgenommen_von"), "{v:?}");
    assert_eq!(reihe[1]["id"], m212);
    assert_eq!(reihe[1]["aktuell"], false);
    assert!(reihe[1]["zurueckgenommen_at"].is_string(), "{v:?}");
    assert!(reihe[1]["zurueckgenommen_von"].is_string(), "{v:?}");

    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(r#"{"status":"in_betrieb"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let belegungen = format!("{}/stellen/{sid}/belegungen", pfad(e));
    let (s, leer) = anfrage(&app, "GET", &belegungen, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        leer,
        serde_json::json!([]),
        "Stelle ohne Meldung: leere Reihe"
    );
    melden(&app, &admin, &belegungen, r#"{"belegt":60}"#).await;
    let (s, v) = anfrage(&app, "GET", &belegungen, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v[0]["belegt"], 60);
    assert_eq!(v[0]["aktuell"], true);
}

#[tokio::test]
async fn verlauf_statuscodes_und_rechte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk(&app, &admin, e, "Uferstraße 12–40").await;
    let sid = stelle(&app, &admin, e, "Turnhalle Ost").await;
    melden(
        &app,
        &admin,
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
        r#"{"evakuiert":212,"erhebung":"gezaehlt"}"#,
    )
    .await;

    // Objekt eines anderen Einsatzes und unbekanntes Objekt: 404; kaputte Sub-ID: 400.
    for uri in [
        format!("{}/bezirke/{bid}/staende", pfad_evak(e2)),
        format!("{}/stellen/{sid}/belegungen", pfad(e2)),
        format!("{}/bezirke/99999/staende", pfad_evak(e)),
        format!("{}/stellen/99999/belegungen", pfad(e)),
    ] {
        let (s, j) = anfrage(&app, "GET", &uri, &admin, None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{uri}: {j:?}");
    }
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/bezirke/abc/staende", pfad_evak(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Stornierter Bezirk: Lesen bleibt erlaubt.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{bid}/stornieren", pfad_evak(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.as_array().unwrap().len(), 1);

    // Beobachter liest.
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, e, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    // Fremde Organisation: 403 oder 404, keine Daten.
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;
    for uri in [
        format!("{}/bezirke/{bid}/staende", pfad_evak(e)),
        format!("{}/stellen/{sid}/belegungen", pfad(e)),
    ] {
        let (s, j) = anfrage(&app, "GET", &uri, &fremd, None).await;
        assert!(
            s == StatusCode::FORBIDDEN || s == StatusCode::NOT_FOUND,
            "{uri}: erwartet 403/404, war {s} {j:?}"
        );
        assert!(
            !j.to_string().contains("212"),
            "keine Meldung an Fremde: {j:?}"
        );
    }

    // Ausgeblendetes Modul: 403 für Mitglieder, je Modul getrennt (LLH-1034).
    override_setzen(&app, &admin, e, "betreuung", false, None).await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/stellen/{sid}/belegungen", pfad(e)),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let staende = format!("{}/bezirke/{bid}/staende", pfad_evak(e));
    let (s, _) = anfrage(&app, "GET", &staende, &beob_cookie, None).await;
    assert_eq!(s, StatusCode::OK, "Evakuierung bleibt lesbar");
    override_setzen(&app, &admin, e, "evakuierung", false, None).await;
    let (s, _) = anfrage(&app, "GET", &staende, &beob_cookie, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

// ── Leitung und Kontaktweg (LLH-1044) ───────────────────────────────────────────────────

#[tokio::test]
async fn leitung_und_kontaktweg_anlegen_aendern_leeren_und_grenze() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, st) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &admin,
        Some(
            r#"{"bezeichnung":"Gesamtschule","art":"notunterkunft","leitung":" Frau Schulz ","kontaktweg":"Kanal 42"}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{st:?}");
    assert_eq!(st["leitung"], "Frau Schulz", "getrimmt");
    assert_eq!(st["kontaktweg"], "Kanal 42");
    let sid = st["id"].as_i64().unwrap();

    // Die Übersicht trägt beide Felder.
    let (_, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(u["stellen"][0]["leitung"], "Frau Schulz");

    // Ändern schreibt „weitere Angaben“ ohne Wert ins ETB.
    let (s, st) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(r#"{"leitung":"Herr Brandt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{st:?}");
    assert_eq!(st["leitung"], "Herr Brandt");
    let etb = etb_eintraege(&app, &admin, e).await;
    assert_eq!(treffer(&etb, "system", &["weitere Angaben"]).len(), 1);
    assert!(
        etb.iter()
            .all(|x| !x["inhalt"].as_str().unwrap_or("").contains("Brandt")),
        "kein Name im ETB"
    );

    // `null` leert; das Feld fehlt dann in der Antwort.
    let (s, st) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(r#"{"kontaktweg":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{st:?}");
    assert!(!st.as_object().unwrap().contains_key("kontaktweg"));
    assert_eq!(st["leitung"], "Herr Brandt", "unberührt");

    // Grenze: 200 Zeichen gehen, 201 sind 400 — beim Anlegen und beim Ändern.
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(&format!(r#"{{"leitung":"{}"}}"#, "x".repeat(200))),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &format!("{}/stellen/{sid}", pfad(e)),
        &admin,
        Some(&format!(r#"{{"kontaktweg":"{}"}}"#, "x".repeat(201))),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    assert!(
        j.to_string().contains("Kontakt darf höchstens 200 Zeichen"),
        "{j}"
    );
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("{}/stellen", pfad(e)),
        &admin,
        Some(&format!(
            r#"{{"bezeichnung":"Zweite","art":"anlaufstelle","leitung":"{}"}}"#,
            "x".repeat(201)
        )),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Der alte Feldname (bis LLH-1419) ist 400 statt still verworfen, auch mit `null`.
    for (methode, ziel, body) in [
        (
            "POST",
            format!("{}/stellen", pfad(e)),
            r#"{"bezeichnung":"Dritte","art":"anlaufstelle","erreichbarkeit":"Kanal 1"}"#,
        ),
        (
            "PATCH",
            format!("{}/stellen/{sid}", pfad(e)),
            r#"{"erreichbarkeit":null}"#,
        ),
    ] {
        let (s, j) = anfrage(&app, methode, &ziel, &admin, Some(body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{methode} {body}");
        assert!(j.to_string().contains("Seite neu laden"), "{j}");
    }
}

// ── LLH-1291: Abschnittsname per Join ────────────────────────────────────────────────────────

/// Stellen und Bezirke tragen den Abschnittsnamen per Join, ihre Leser erreicht `abschnitt` aber
/// nur mit Modul Einsatzabschnitte. Umbenennen und Auflösen melden deshalb die Stellen und Bezirke
/// des Abschnitts mit ihrem eigenen Ereignis; ein PATCH ohne neuen Namen meldet keine.
#[tokio::test]
async fn abschnitt_umbenennen_und_aufloesen_meldet_stellen_und_bezirke() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nord = abschnitt(&app, &admin, e, "Nord").await;
    let sued = abschnitt(&app, &admin, e, "Süd").await;
    let im_abschnitt = |art: &str, id: i64, ab: i64| {
        let uri = if art == "stelle" {
            format!("{}/stellen/{id}", pfad(e))
        } else {
            format!("{}/bezirke/{id}", pfad_evak(e))
        };
        (uri, format!(r#"{{"abschnitt_id":{ab}}}"#))
    };
    let st_nord = stelle(&app, &admin, e, "Turnhalle").await;
    let st_sued = stelle(&app, &admin, e, "Schule").await;
    let bz_nord = bezirk(&app, &admin, e, "Uferstraße").await;
    for (art, id, ab) in [
        ("stelle", st_nord, nord),
        ("stelle", st_sued, sued),
        ("bezirk", bz_nord, nord),
    ] {
        let (uri, body) = im_abschnitt(art, id, ab);
        let (s, j) = anfrage(&app, "PATCH", &uri, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::OK, "{art} {id}: {j:?}");
    }
    let gemeldet =
        |rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>| {
            let mut t = objekt_ereignisse(
                rx,
                &[("betreuung", "stelle_id"), ("evakuierung", "bezirk_id")],
            );
            t.sort();
            t
        };
    let abschnitt_uri = format!("/api/einsaetze/{e}/abschnitte/{nord}");

    let mut rx = live.abonniere(e);
    let erwartet = vec![
        ("betreuung".to_string(), st_nord),
        ("evakuierung".to_string(), bz_nord),
    ];
    for (body, soll, fall) in [
        (r#"{"name":"Nordost"}"#, erwartet.clone(), "neuer Name"),
        (r#"{"name":"Nordost"}"#, vec![], "gleicher Name"),
        (r#"{"bemerkung":"Deich"}"#, vec![], "anderes Feld"),
    ] {
        let (s, j) = anfrage(&app, "PATCH", &abschnitt_uri, &admin, Some(body)).await;
        assert_eq!(s, StatusCode::OK, "{fall}: {j:?}");
        assert_eq!(gemeldet(&mut rx), soll, "{fall}");
    }
    let bz = bezirke_von(&app, &admin, e).await;
    assert_eq!(bz[0]["abschnitt_name"], "Nordost", "{bz:?}");

    let (s, _) = anfrage(&app, "DELETE", &abschnitt_uri, &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(gemeldet(&mut rx), erwartet, "Auflösen");
    let (s, u) = anfrage(&app, "GET", &pfad(e), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let turnhalle = u["stellen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"].as_i64() == Some(st_nord))
        .unwrap()
        .clone();
    assert!(turnhalle["abschnitt_name"].is_null(), "{turnhalle:?}");
}
