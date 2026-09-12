//! Integrationstests der Führungsorganisation (LFH-46 · ST1): Besetzung S1–S6.
//!
//! Spec: `docs/superpowers/specs/2026-09-12-lfh-46-stab-s1-s6-design.md`, Abschnitt 9.5.

use axum::http::StatusCode;

mod common;
use common::*;

const PFAD: &str = "stab";

fn stab_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/{PFAD}")
}

fn besetzung_pfad(einsatz: i64, sachgebiet: &str) -> String {
    format!("/api/einsaetze/{einsatz}/{PFAD}/besetzung/{sachgebiet}")
}

/// Stamm-Person anlegen; `benutzer_id` koppelt sie an ein Konto (für `meine_sachgebiete`).
async fn person_anlegen(
    app: &axum::Router,
    admin: &str,
    name: &str,
    benutzer_id: Option<i64>,
) -> i64 {
    let body = match benutzer_id {
        Some(b) => format!(r#"{{"name":"{name}","benutzer_id":{b}}}"#),
        None => format!(r#"{{"name":"{name}"}}"#),
    };
    let (status, json) = anfrage(app, "POST", "/api/personal", admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "Person anlegen: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Disponiert eine Stamm-Person in den Einsatz; liefert die `einsatz_personal.id`.
async fn disponieren(app: &axum::Router, cookie: &str, einsatz: i64, person: i64) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&format!(r#"{{"personal_id":{person}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "disponieren: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Zählt ETB-Einträge, deren Inhalt `nadel` enthält.
async fn etb_treffer(app: &axum::Router, cookie: &str, einsatz: i64, nadel: &str) -> usize {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .map(|a| {
            a.iter()
                .filter(|e| e["inhalt"].as_str().is_some_and(|i| i.contains(nadel)))
                .count()
        })
        .unwrap_or(0)
}

// ---------- Lesen ----------

#[tokio::test]
async fn leerer_stab_liefert_leere_besetzung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(&app, "GET", &stab_pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["besetzung"].as_array().map(Vec::len),
        Some(0),
        "ohne Zeile ist die Besetzung leer — die sechs festen Zeilen baut das Frontend"
    );
}

#[tokio::test]
async fn beobachter_darf_lesen_aber_nicht_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (status, _) = anfrage(&app, "GET", &stab_pfad(einsatz), &beob_cookie, None).await;
    assert_eq!(status, StatusCode::OK, "Beobachter liest");

    let (status, _) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s2"),
        &beob_cookie,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Beobachter schreibt nicht");

    let (status, _) = anfrage(
        &app,
        "DELETE",
        &besetzung_pfad(einsatz, "s2"),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// Fremde Organisation: der Zugriff wird auf JEDER Route abgewiesen.
///
/// **Gemessen ist das 403, nicht 404** — Abschnitt 9.2 der Spec schreibt „404 aus dem
/// Extractor", aber `fordere_org_zugehoerigkeit` liefert `AppError::Forbidden`
/// (`src/einsatz/berechtigung.rs:150-160`); 404 entsteht erst bei einem Einsatz, den es
/// GAR NICHT gibt (`einsatz_repo::laden`). Geprüft wird wie im Bestand (`tests/cross_org.rs:93`)
/// gegen „403 oder 404": beide leaken nichts, und welcher der beiden es ist, soll dieser Test
/// nicht festnageln.
#[tokio::test]
async fn fremde_org_wird_auf_allen_routen_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    for (methode, pfad, body) in [
        ("GET", stab_pfad(einsatz), None),
        (
            "PUT",
            besetzung_pfad(einsatz, "s2"),
            Some(r#"{"besetzung_art":"einsatzleitung"}"#),
        ),
        ("DELETE", besetzung_pfad(einsatz, "s2"), None),
    ] {
        let (status, _) = anfrage(&app, methode, &pfad, &fremd, body).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{methode} {pfad}: erwartet 403/404, war {status}"
        );
    }

    // Ein Einsatz, den es nicht gibt, ist dagegen eindeutig 404.
    let (status, _) = anfrage(&app, "GET", &stab_pfad(999_999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ---------- Setzen ----------

#[tokio::test]
async fn einsatzleitung_setzen_schreibt_etb_mit_vorherstand() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s4"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let zeile = &json["besetzung"][0];
    assert_eq!(zeile["sachgebiet"], "s4");
    assert_eq!(zeile["besetzung_art"], "einsatzleitung");
    assert!(
        zeile.get("name").is_none(),
        "`einsatzleitung` trägt keinen Namen — das Modul kennt keine Zeile „EL\""
    );

    // Der erste Wechsel kommt aus „nicht vergeben".
    assert_eq!(
        etb_treffer(&app, &admin, einsatz, "(vorher: nicht vergeben)").await,
        1
    );
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "S4 Versorgung: Besetzung → Einsatzleitung"
        )
        .await,
        1,
        "der ETB-Text trägt Kürzel + FwDV-100-Label"
    );
}

/// Ein Upsert trägt den VORHERSTAND in den ETB-Text — sonst ist der Wechsel nicht
/// rekonstruierbar, und genau das ersetzt die fehlende Besetzungshistorie (Entscheidung 7).
#[tokio::test]
async fn upsert_setzt_vorherstand_in_den_etb_text() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Müller", None).await;
    let ep = disponieren(&app, &admin, einsatz, person).await;

    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s2"),
        &admin,
        Some(&format!(
            r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#
        )),
    )
    .await;
    // Zweiter Wechsel: Müller → rückwärtige Stelle.
    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s2"),
        &admin,
        Some(r#"{"besetzung_art":"rueckwaertig","bezeichnung":"Leitstelle"}"#),
    )
    .await;

    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Besetzung → Leitstelle (rückwärtig) (vorher: Müller)"
        )
        .await,
        1,
        "der zweite Eintrag nennt Müller als Vorherstand"
    );
    // Genau eine Zeile je Sachgebiet (UNIQUE) — der Upsert hat ersetzt, nicht angehängt.
    let (_, json) = anfrage(&app, "GET", &stab_pfad(einsatz), &admin, None).await;
    assert_eq!(json["besetzung"].as_array().map(Vec::len), Some(1));
}

/// Personalunion (RLP FüRi IV.2.1): dieselbe Person in zwei Zeilen. „Mehrere Sachgebiete je
/// Assistent" ist damit abgebildet — „mehrere Personen je Sachgebiet" bewusst nicht.
#[tokio::test]
async fn personalunion_zwei_zeilen_eine_person() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Schmidt", None).await;
    let ep = disponieren(&app, &admin, einsatz, person).await;
    let body = format!(r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#);

    for sg in ["s2", "s3"] {
        let (status, _) = anfrage(
            &app,
            "PUT",
            &besetzung_pfad(einsatz, sg),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    let (_, json) = anfrage(&app, "GET", &stab_pfad(einsatz), &admin, None).await;
    let b = json["besetzung"].as_array().unwrap();
    assert_eq!(b.len(), 2);
    assert_eq!(b[0]["personal_id"], b[1]["personal_id"]);
    assert_eq!(b[0]["sachgebiet"], "s2");
    assert_eq!(b[1]["sachgebiet"], "s3", "Reihenfolge ist s1..s6");
}

/// `snap_name` ist ein Führungsnachweis und überlebt das Entfernen der Disposition;
/// `personal_noch_disponiert` unterscheidet „Person ist weg" von „Name war nie gesetzt".
#[tokio::test]
async fn snap_name_ueberlebt_das_entfernen_der_disposition() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Weber", None).await;
    let ep = disponieren(&app, &admin, einsatz, person).await;
    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s1"),
        &admin,
        Some(&format!(
            r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#
        )),
    )
    .await;

    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "Disposition entfernen: {status}");

    let (_, json) = anfrage(&app, "GET", &stab_pfad(einsatz), &admin, None).await;
    let zeile = &json["besetzung"][0];
    assert_eq!(zeile["name"], "Weber", "der eingefrorene Name bleibt");
    assert_eq!(
        zeile["personal_noch_disponiert"], false,
        "die Disposition ist weg — das muss sichtbar sein"
    );
    assert!(
        zeile.get("personal_id").is_none(),
        "ON DELETE SET NULL hat die Referenz gelöst"
    );
}

// ---------- Statuscodes (Abschnitt 9.2) ----------

#[tokio::test]
async fn unbekanntes_sachgebiet_im_pfad_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for methode in ["PUT", "DELETE"] {
        let body = (methode == "PUT").then_some(r#"{"besetzung_art":"einsatzleitung"}"#);
        let (status, _) =
            anfrage(&app, methode, &besetzung_pfad(einsatz, "s7"), &admin, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{methode} s7");
    }
}

#[tokio::test]
async fn unbekannte_besetzungsart_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s2"),
        &admin,
        Some(r#"{"besetzung_art":"nicht_vergeben"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Fremde Person (anderer Einsatz derselben Org) → 422. Die Prüfung geht gegen
/// `einsatz_personal.einsatz_id`, **nie** nur gegen die Org.
#[tokio::test]
async fn person_aus_fremdem_einsatz_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_a = einsatz_anlegen(&app, &admin).await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Fremd", None).await;
    let ep_b = disponieren(&app, &admin, einsatz_b, person).await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz_a, "s2"),
        &admin,
        Some(&format!(
            r#"{{"besetzung_art":"personal","personal_id":{ep_b}}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    // Und es ist KEINE Zeile entstanden (die Transaktion ist zurückgerollt).
    let (_, stab) = anfrage(&app, "GET", &stab_pfad(einsatz_a), &admin, None).await;
    assert_eq!(stab["besetzung"].as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn abgeschlossener_einsatz_sperrt_das_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;

    let (status, _) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s2"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "Code kommt aus `fordere_aktiv` im Extractor"
    );
    // Lesen bleibt erlaubt (Seite read-only).
    let (status, _) = anfrage(&app, "GET", &stab_pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
}

/// Modul-Override `sichtbar=false` → das Gate greift auf allen Routen.
#[tokio::test]
async fn ausgeblendetes_modul_sperrt_lesen_und_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kraft = benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, kraft, "fuehrungspersonal").await;
    let kraft_cookie = login_cookie(&app, "kraft", "kraftpw1").await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/stab"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override setzen: {status} {json:?}");

    let (status, _) = anfrage(&app, "GET", &stab_pfad(einsatz), &kraft_cookie, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Lesen gesperrt");
    let (status, _) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s2"),
        &kraft_cookie,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Schreiben gesperrt");
}

// ---------- DELETE-Idempotenz (die Setzung aus 9.2) ----------

/// Das **Paar**, das die Idempotenz überhaupt prüfbar macht: auf besetzter Zeile
/// 204 + ETB-Eintrag + SSE, auf leerer Zeile 204 + **kein** ETB-Eintrag + **kein** SSE.
/// Gezählt, nicht bloß „kein 404" — ein reiner Statuscode-Test belegt den No-op nicht.
#[tokio::test]
async fn delete_ist_idempotent_und_auf_leerer_zeile_ein_no_op() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // (a) Leere Zeile: 204, kein ETB-Eintrag, kein SSE-Ereignis.
    let mut rx = live.abonniere(einsatz);
    let (status, _) = anfrage(&app, "DELETE", &besetzung_pfad(einsatz, "s5"), &admin, None).await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "leere Zeile ist 204, nicht 404"
    );
    assert_eq!(
        etb_treffer(&app, &admin, einsatz, "S5").await,
        0,
        "ein Eintrag „→ nicht vergeben (vorher: nicht vergeben)\" wäre ETB-Rauschen"
    );
    let (mut stab_events, mut etb_events) = (0, 0);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "stab" => stab_events += 1,
            "etb" => etb_events += 1,
            _ => {}
        }
    }
    assert_eq!(stab_events, 0, "No-op feuert kein Live-Ereignis");
    assert_eq!(
        etb_events, 0,
        "No-op schreibt keinen ETB-Eintrag, also auch kein `etb`-Ereignis"
    );

    // (b) Besetzte Zeile: 204, genau ein ETB-Eintrag, genau ein SSE-Ereignis.
    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s5"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    let mut rx = live.abonniere(einsatz);
    let (status, _) = anfrage(&app, "DELETE", &besetzung_pfad(einsatz, "s5"), &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "S5 Presse- und Medienarbeit: Besetzung → nicht vergeben"
        )
        .await,
        1
    );
    let (mut stab_events, mut etb_events) = (0, 0);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "stab" => stab_events += 1,
            "etb" => etb_events += 1,
            _ => {}
        }
    }
    assert_eq!(stab_events, 1, "echte Änderung feuert genau einmal");
    assert_eq!(
        etb_events, 1,
        "der wirksame DELETE schreibt einen ETB-Eintrag und muss ihn auch publizieren"
    );
}

/// Zweimal DELETE hintereinander: zweimal 204, aber genau EIN ETB-Eintrag.
#[tokio::test]
async fn zweimal_delete_liefert_zweimal_204_und_einen_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s6"),
        &admin,
        Some(r#"{"besetzung_art":"rueckwaertig","bezeichnung":"FEZ"}"#),
    )
    .await;

    for _ in 0..2 {
        let (status, _) =
            anfrage(&app, "DELETE", &besetzung_pfad(einsatz, "s6"), &admin, None).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Besetzung → nicht vergeben (vorher: FEZ (rückwärtig))"
        )
        .await,
        1,
        "der zweite DELETE darf keinen zweiten Eintrag schreiben"
    );
}

// ---------- Live ----------

#[tokio::test]
async fn setzen_feuert_stab_event() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s3"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;

    let (mut sah_stab, mut sah_etb) = (false, false);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "stab" if n.data.contains(&einsatz.to_string()) => sah_stab = true,
            "etb" => sah_etb = true,
            _ => {}
        }
    }
    assert!(sah_stab, "Setzen muss ein `stab`-SSE-Ereignis feuern");
    // Der System-ETB-Eintrag entsteht im selben Commit. Ohne den ETB-Kurzruf bliebe die
    // Chronologie eines zweiten Betrachters still veraltet: `EINSATZ_STREAM_EVENTS.stab`
    // invalidiert nur den Stab-Prefix, den ETB-Cache invalidiert allein das `etb`-Ereignis.
    assert!(
        sah_etb,
        "Setzen schreibt einen ETB-Eintrag und muss deshalb auch das `etb`-Ereignis feuern"
    );
}

// ---------- meine_sachgebiete: BEIDE Pfade ----------

/// Detail-Pfad (`GET /api/einsaetze/{id}`) — über `personal.benutzer_id`.
#[tokio::test]
async fn meine_sachgebiete_im_detail_pfad() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kraft = benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, einsatz, kraft, "fuehrungspersonal").await;
    let person = person_anlegen(&app, &admin, "Kraft Person", Some(kraft)).await;
    let ep = disponieren(&app, &admin, einsatz, person).await;
    let kraft_cookie = login_cookie(&app, "kraft", "kraftpw1").await;

    // Vorher leer — und zwar als `[]`, nicht absent.
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &kraft_cookie,
        None,
    )
    .await;
    assert!(
        json.as_object().unwrap().contains_key("meine_sachgebiete"),
        "das Feld ist Pflicht, nie absent"
    );
    assert_eq!(json["meine_sachgebiete"].as_array().map(Vec::len), Some(0));

    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s3"),
        &admin,
        Some(&format!(
            r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#
        )),
    )
    .await;

    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &kraft_cookie,
        None,
    )
    .await;
    assert_eq!(json["meine_sachgebiete"], serde_json::json!(["s3"]));
    // Der Admin ist nicht mit der Person verknüpft → leer.
    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(json["meine_sachgebiete"].as_array().map(Vec::len), Some(0));
}

/// Listen-Pfad (`GET /api/einsaetze`) mit ZWEI Einsätzen, in denen derselbe Benutzer
/// verschiedene Sachgebiete trägt. **Nur diese Hälfte** fängt einen stillen
/// `Vec::new()`-Platzhalter im Struct-Literal von `liste_fuer`.
#[tokio::test]
async fn meine_sachgebiete_im_listen_pfad_ueber_zwei_einsaetze() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let kraft = benutzer_anlegen(&app, &admin, "kraft", "fuehrungskraft").await;
    let person = person_anlegen(&app, &admin, "Doppelt", Some(kraft)).await;

    let mut erwartet = std::collections::HashMap::new();
    for (einsatz_nr, sachgebiete) in [(0, vec!["s1"]), (1, vec!["s2", "s4"])] {
        let einsatz = einsatz_anlegen(&app, &admin).await;
        rolle_setzen(&app, &admin, einsatz, kraft, "fuehrungspersonal").await;
        let ep = disponieren(&app, &admin, einsatz, person).await;
        for sg in &sachgebiete {
            anfrage(
                &app,
                "PUT",
                &besetzung_pfad(einsatz, sg),
                &admin,
                Some(&format!(
                    r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#
                )),
            )
            .await;
        }
        erwartet.insert(einsatz, sachgebiete);
        let _ = einsatz_nr;
    }

    let kraft_cookie = login_cookie(&app, "kraft", "kraftpw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/einsaetze", &kraft_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 2, "beide Einsätze sind lesbar");
    for eintrag in liste {
        let id = eintrag["id"].as_i64().unwrap();
        let soll = erwartet.get(&id).expect("unerwarteter Einsatz");
        assert_eq!(
            eintrag["meine_sachgebiete"],
            serde_json::json!(soll),
            "Einsatz {id}: der Listen-Pfad muss dieselben Sachgebiete liefern wie der Detail-Pfad"
        );
    }
}

/// Ad-hoc-Personal (`personal_id IS NULL`) hat kein Konto und fällt aus der
/// Benutzer-Kopplung korrekt heraus.
#[tokio::test]
async fn adhoc_personal_erzeugt_keine_sachgebiete_zuordnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(r#"{"adhoc":{"name":"Ad-hoc Helfer"}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    let ep = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s4"),
        &admin,
        Some(&format!(
            r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#
        )),
    )
    .await;

    let (_, json) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        json["meine_sachgebiete"].as_array().map(Vec::len),
        Some(0),
        "ohne `personal.benutzer_id` gibt es keine Kopplung"
    );
    // Die Zeile selbst existiert trotzdem samt Namen.
    let (_, stab) = anfrage(&app, "GET", &stab_pfad(einsatz), &admin, None).await;
    assert_eq!(stab["besetzung"][0]["name"], "Ad-hoc Helfer");
}

// ---------- Schwärzung ----------

/// Die Schwärzung nullt `snap_name`/`bezeichnung` nur im betroffenen Einsatz.
#[tokio::test]
async fn schwaerzung_nullt_namen_nur_im_betroffenen_einsatz() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    for e in [a, b] {
        anfrage(
            &app,
            "PUT",
            &besetzung_pfad(e, "s6"),
            &admin,
            Some(r#"{"besetzung_art":"rueckwaertig","bezeichnung":"Leitstelle Nord"}"#),
        )
        .await;
    }

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(&mut tx, a)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let gescrubbt: Option<String> = sqlx::query_scalar(
        "SELECT bezeichnung FROM einsatz_stabsfunktion WHERE einsatz_id = ? AND sachgebiet = 's6'",
    )
    .bind(a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(gescrubbt, None, "PII ist genullt");

    let unberuehrt: Option<String> = sqlx::query_scalar(
        "SELECT bezeichnung FROM einsatz_stabsfunktion WHERE einsatz_id = ? AND sachgebiet = 's6'",
    )
    .bind(b)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        unberuehrt.as_deref(),
        Some("Leitstelle Nord"),
        "der andere Einsatz bleibt unberührt"
    );

    // Das Skelett bleibt — Sachgebiet und Art sind kein Personenbezug.
    let art: String = sqlx::query_scalar(
        "SELECT besetzung_art FROM einsatz_stabsfunktion WHERE einsatz_id = ? AND sachgebiet = 's6'",
    )
    .bind(a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(art, "rueckwaertig");
}

// ---------- Lagebesprechung (ST2) ----------

fn besprechungen_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/{PFAD}/lagebesprechungen")
}

/// Zählt ETB-Einträge vom Typ `entscheidung`.
async fn entscheidungen(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .map(|a| a.iter().filter(|e| e["typ"] == "entscheidung").count())
        .unwrap_or(0)
}

#[tokio::test]
async fn abschluss_schreibt_etb_entscheidung_zeile_und_termin() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(
            r#"{"entschluss":"Abschnitte bilden, Riegelstellung halten",
                "abgehalten_at":"2026-09-12 14:30:00",
                "naechste_at":"2026-09-12 16:30:00"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");

    // Die Quittung ist der FRISCH geladene Stab — nicht ein Zustand, den es nie gab.
    assert_eq!(json["anzahl_lagebesprechungen"], 1);
    assert_eq!(json["letzte_lagebesprechung"]["lfd_nr"], 1);
    assert_eq!(
        json["letzte_lagebesprechung"]["entschluss"],
        "Abschnitte bilden, Riegelstellung halten"
    );
    assert_eq!(
        json["naechste_lagebesprechung_at"], "2026-09-12 16:30:00",
        "der Termin kommt aus `einsatz` und wird mitgeliefert"
    );

    // Der Beleg: genau EIN ETB-Eintrag vom Typ `entscheidung`, mit dem Snapshot-Text.
    assert_eq!(entscheidungen(&app, &admin, einsatz).await, 1);
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Lagebesprechung Nr. 1 (2026-09-12 14:30:00)"
        )
        .await,
        1
    );
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Nächste Lagebesprechung: 2026-09-12 16:30:00"
        )
        .await,
        1
    );

    // Und der Termin steht auch am Einsatzkopf (EINE Wahrheit, Entscheidung 11).
    let (_, kopf) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(kopf["naechste_lagebesprechung_at"], "2026-09-12 16:30:00");

    // Beide Live-Ereignisse: `stab` und der ETB-Kurzruf.
    let (mut sah_stab, mut sah_etb) = (false, false);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "stab" => sah_stab = true,
            "etb" => sah_etb = true,
            _ => {}
        }
    }
    assert!(sah_stab, "`stab`-Ereignis fehlt");
    assert!(
        sah_etb,
        "ETB-Kurzruf fehlt — der Eintrag entstand im selben Commit"
    );
}

/// Der Termin ist **Tri-State**: Feld fehlt = unverändert, `null` = löschen, Wert = setzen.
#[tokio::test]
async fn termin_ist_tri_state() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Wert setzen.
    anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#),
    )
    .await;

    // Feld FEHLT → Termin unverändert, und der Snapshot trägt den geltenden Termin.
    let (_, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"B","abgehalten_at":"2026-09-12 11:00:00"}"#),
    )
    .await;
    assert_eq!(
        json["naechste_lagebesprechung_at"], "2026-09-12 12:00:00",
        "ohne Schlüssel bleibt der Termin stehen"
    );
    assert_eq!(
        json["letzte_lagebesprechung"]["naechste_at"], "2026-09-12 12:00:00",
        "der Snapshot trägt den GELTENDEN Termin, nicht „nichts\""
    );

    // `null` → Termin löschen.
    let (_, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"C","abgehalten_at":"2026-09-12 12:30:00","naechste_at":null}"#),
    )
    .await;
    assert!(
        json.get("naechste_lagebesprechung_at").is_none(),
        "null löscht den Termin: {json}"
    );
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Nächste Lagebesprechung: kein Termin"
        )
        .await,
        1,
        "„kein Termin\" ist eine Aussage und gehört in den Beleg"
    );
}

#[tokio::test]
async fn lfd_nr_ist_luckenlos_und_historie_absteigend() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for i in 0..3 {
        let (status, _) = anfrage(
            &app,
            "POST",
            &besprechungen_pfad(einsatz),
            &admin,
            Some(&format!(
                r#"{{"entschluss":"Entschluss {i}","abgehalten_at":"2026-09-12 1{i}:00:00"}}"#
            )),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }

    let (status, json) = anfrage(&app, "GET", &besprechungen_pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 3);
    let nummern: Vec<i64> = liste
        .iter()
        .map(|e| e["lfd_nr"].as_i64().unwrap())
        .collect();
    assert_eq!(nummern, vec![3, 2, 1], "absteigend, lückenlos");
    // Jede Zeile trägt ihren eigenen Beleg.
    assert_eq!(entscheidungen(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn leerer_entschluss_ist_400_und_termin_vor_besprechung_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for body in [
        r#"{"entschluss":""}"#,
        r#"{"entschluss":"   "}"#,
        r#"{"entschluss":"A","abgehalten_at":"kein Datum"}"#,
        r#"{"entschluss":"A","naechste_at":"kein Datum"}"#,
    ] {
        let (status, _) = anfrage(
            &app,
            "POST",
            &besprechungen_pfad(einsatz),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "erwartet 400 für {body}");
    }

    // Zusammenhang zweier Felder → 422.
    let (status, _) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"A","abgehalten_at":"2026-09-12 14:00:00","naechste_at":"2026-09-12 13:00:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Keiner der Fehlversuche hat einen Beleg hinterlassen.
    assert_eq!(entscheidungen(&app, &admin, einsatz).await, 0);
}

#[tokio::test]
async fn beobachter_darf_historie_lesen_aber_nicht_abschliessen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beob = benutzer_anlegen(&app, &admin, "zuschauer", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "zuschauer", "zuschauerpw1").await;

    let (status, _) = anfrage(
        &app,
        "GET",
        &besprechungen_pfad(einsatz),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &beob_cookie,
        Some(r#"{"entschluss":"A"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// **Die Atomaritäts-Probe.** Sie hängt ausdrücklich NICHT an einem ungültigen
/// `naechste_at`: die Route lehnt den Wert vorher ab (400/422), der Request erreicht die
/// Transaktion also nie — ein solcher Test bliebe auch dann grün, wenn ETB-Eintrag, Zeile
/// und Termin-Update drei getrennte Aufrufe wären.
///
/// Sie hängt stattdessen am Fehler **nach** dem ETB-Insert: der Termin-Schritt läuft als
/// `UPDATE … WHERE id = ? AND status = 'aktiv'` und rollt bei `rows_affected == 0` zurück.
/// Gerufen wird die Repo-Funktion **direkt**, weil `fordere_aktiv` den Zweig auf der Route
/// verdeckt.
///
/// **Mutationsprobe gefahren:** die eine Transaktion durch drei Einzelaufrufe ersetzt →
/// dieser Test wird rot (der ETB-Eintrag bleibt dann stehen).
#[tokio::test]
async fn abschluss_rollt_bei_inaktivem_einsatz_vollstaendig_zurueck() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Einen Termin vorbelegen, damit „unverändert" beweisbar ist.
    sqlx::query(
        "UPDATE einsatz SET naechste_lagebesprechung_at = '2026-09-12 20:00:00' WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    // Einsatz abschliessen — damit trifft das `status = 'aktiv'`-Prädikat keine Zeile.
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;

    let fehler = lifeline_hub::stab::repo::lagebesprechung_abschliessen(
        &pool,
        einsatz,
        1,
        &lifeline_hub::stab::repo::AbschlussEingabe {
            entschluss: "Darf nicht bestehen bleiben".into(),
            abgehalten_at: "2026-09-12 18:00:00".into(),
            naechste_at: Some(Some("2026-09-12 19:00:00".into())),
        },
    )
    .await;
    let fehler = fehler.expect_err("inaktiver Einsatz muss scheitern");
    assert_eq!(
        fehler.status(),
        StatusCode::CONFLICT,
        "Lebenszyklus des Einsatzes → 409, dieselbe Antwort wie `fordere_aktiv` am Route-Gate"
    );

    // (1) Kein ETB-Eintrag vom Typ `entscheidung`.
    let etb: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'entscheidung'",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(etb, 0, "der ETB-Eintrag muss mit zurückgerollt sein");

    // (2) Keine Lagebesprechungs-Zeile.
    let zeilen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_lagebesprechung WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(zeilen, 0);

    // (3) Der Termin ist unverändert.
    let termin: Option<String> =
        sqlx::query_scalar("SELECT naechste_lagebesprechung_at FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(termin.as_deref(), Some("2026-09-12 20:00:00"));
}

/// Der Normalfall über die Route: `fordere_aktiv` im Extractor greift, bevor die Transaktion
/// beginnt → 409. Das ist die Ergänzung zu den Rollback-Proben oben, nicht ihr Ersatz.
///
/// **Nicht** zu verwechseln mit „der Riegel in der Transaktion ist unerreichbar": er ist es
/// nicht (siehe `stab::repo::lagebesprechung_abschliessen`). Beide Wege antworten deshalb
/// mit demselben Code — 409 —, sonst hinge die Antwort am Timing.
#[tokio::test]
async fn abschluss_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"A"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// Die Schwärzung lässt `entschluss` stehen (G_FUEHRUNG) — dieselbe Klassifikation wie
/// `lagebericht.abschnitte` und `befehl`, deren Inhalt derselbe Entschluss ist.
#[tokio::test]
async fn schwaerzung_laesst_den_entschluss_stehen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"Riegelstellung Nordufer halten"}"#),
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(&mut tx, einsatz)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let entschluss: String =
        sqlx::query_scalar("SELECT entschluss FROM einsatz_lagebesprechung WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        entschluss, "Riegelstellung Nordufer halten",
        "Führungs-Freitext bleibt — Alleingang auf Scrub für EINE der drei Tabellen wäre inkonsistent"
    );
}

/// **Der Fall, den der Termin-Schlüssel bisher verdeckt hat** (Codex-Review zu PR #60, P2).
///
/// Ohne `naechste_at` lief der Abschluss durch die Transaktion, ohne den Zustand des
/// Einsatzes je zu prüfen — `fordere_aktiv` im Extractor liest einen Stand von VOR der
/// Transaktion. Ein ETB-Eintrag vom Typ `entscheidung` ist append-only und gehört nicht in
/// einen abgeschlossenen Einsatz.
///
/// Das **Paar** zu `abschluss_rollt_bei_inaktivem_einsatz_vollstaendig_zurueck`: dort MIT
/// Termin, hier OHNE. Nur zusammen belegen sie, dass der Riegel unbedingt greift und nicht
/// bloss als Nebenwirkung des Termin-Updates.
#[tokio::test]
async fn abschluss_ohne_termin_rollt_bei_inaktivem_einsatz_ebenfalls_zurueck() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;

    let fehler = lifeline_hub::stab::repo::lagebesprechung_abschliessen(
        &pool,
        einsatz,
        1,
        &lifeline_hub::stab::repo::AbschlussEingabe {
            entschluss: "Darf nicht bestehen bleiben".into(),
            abgehalten_at: "2026-09-12 18:00:00".into(),
            // KEIN Termin — genau der Pfad, der vorher ungeprüft durchlief.
            naechste_at: None,
        },
    )
    .await;
    assert!(
        fehler.is_err(),
        "inaktiver Einsatz muss auch ohne Termin scheitern"
    );

    let etb: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'entscheidung'",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        etb, 0,
        "kein append-only Beleg in einem abgeschlossenen Einsatz"
    );

    let zeilen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_lagebesprechung WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(zeilen, 0);
}

/// **Das PUT-Gegenstück zu `zweimal_delete_liefert_zweimal_204_und_einen_etb_eintrag`.**
///
/// Der System-ETB-Eintrag ist bedingt: nur bei fachlicher Änderung. Ohne den Riegel schriebe
/// ein Doppelklick im Modal oder ein Retry nach verlorener Antwort „Besetzung → Müller
/// (vorher: Müller)" ins Tagebuch — und weil Entscheidung 7 bewusst KEINE Besetzungshistorie
/// führt, ist das ETB der einzige Nachweis des Verlaufs; eine Dublette dort ist von einem
/// echten Wechsel nicht zu unterscheiden.
///
/// Die Zeile selbst wird trotzdem geschrieben (`gesetzt_at` hält den Klick fest) und das
/// `stab`-Ereignis trotzdem gefeuert — dieselbe Aufteilung wie an den vier Bestandsstellen
/// mit bedingtem System-ETB (`einsatz_fahrzeug`, `einsatz_personal`, `einsatz_material`,
/// `einsatz_einheit`).
#[tokio::test]
async fn zweimal_setzen_mit_gleichem_wert_schreibt_einen_etb_eintrag() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let person = person_anlegen(&app, &admin, "Müller", None).await;
    let ep = disponieren(&app, &admin, einsatz, person).await;
    let body = format!(r#"{{"besetzung_art":"personal","personal_id":{ep}}}"#);

    for _ in 0..2 {
        let (status, _) = anfrage(
            &app,
            "PUT",
            &besetzung_pfad(einsatz, "s2"),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    assert_eq!(
        etb_treffer(&app, &admin, einsatz, "S2 Lage: Besetzung").await,
        1,
        "der zweite, wertgleiche PUT darf keinen zweiten ETB-Eintrag schreiben"
    );
    assert_eq!(
        etb_treffer(&app, &admin, einsatz, "(vorher: Müller)").await,
        0,
        "„→ Müller (vorher: Müller)\" wäre genau das Rauschen, das der Riegel verhindert"
    );

    // Eine ECHTE Änderung schreibt weiter — sonst wäre der Riegel zu scharf.
    let mut rx = live.abonniere(einsatz);
    let (status, _) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s2"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Besetzung → Einsatzleitung (vorher: Müller)"
        )
        .await,
        1
    );
    let (mut stab_events, mut etb_events) = (0, 0);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "stab" => stab_events += 1,
            "etb" => etb_events += 1,
            _ => {}
        }
    }
    assert_eq!(stab_events, 1);
    assert_eq!(etb_events, 1);
}

/// Der wertgleiche PUT ist ein No-op AM ETB, nicht an der Zeile: `gesetzt_at` soll den Klick
/// festhalten, und das `stab`-Ereignis feuert weiter (eine doppelte Invalidierung ist
/// harmlos, ein verschluckter Zustandswechsel wäre es nicht).
#[tokio::test]
async fn wertgleicher_put_schreibt_die_zeile_trotzdem() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s6"),
        &admin,
        Some(r#"{"besetzung_art":"rueckwaertig","bezeichnung":"Leitstelle"}"#),
    )
    .await;

    let mut rx = live.abonniere(einsatz);
    let (status, json) = anfrage(
        &app,
        "PUT",
        &besetzung_pfad(einsatz, "s6"),
        &admin,
        Some(r#"{"besetzung_art":"rueckwaertig","bezeichnung":"Leitstelle"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["besetzung"][0]["name"], "Leitstelle",
        "die Zeile steht"
    );

    let (mut stab_events, mut etb_events) = (0, 0);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "stab" => stab_events += 1,
            "etb" => etb_events += 1,
            _ => {}
        }
    }
    assert_eq!(stab_events, 1, "das Zustandsereignis feuert weiter");
    assert_eq!(etb_events, 0, "es gibt keinen ETB-Eintrag zu melden");
}
