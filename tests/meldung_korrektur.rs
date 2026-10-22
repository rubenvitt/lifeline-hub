//! Nachträgliche Korrektur einer Meldung (LLH-1066, Spec `meldungseingang`, „Eine Meldung lässt
//! sich nachträglich korrigieren“ ff.): `PATCH /api/einsaetze/{id}/meldungen/{mid}`.
use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einheit_bilden, einsatz_anlegen, login_cookie, rolle_setzen, setup,
    setup_mit_pool_und_live,
};

/// Erfasst eine Meldung (Vorgabe: Art „Sonstige“, Priorität „normal“, ohne Bezug); `extra`
/// überschreibt einzelne Felder.
async fn melden(app: &axum::Router, cookie: &str, einsatz: i64, extra: Value) -> Value {
    let mut body = json!({
        "absender": "Florian Nord 1",
        "empfaenger": "ELW 1",
        "meldeweg": "funk",
        "inhalt": "Brücke gesperrt",
        "ereigniszeit": "2026-10-21 09:00:00",
    });
    for (k, v) in extra.as_object().unwrap() {
        body[k] = v.clone();
    }
    let (s, m) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/meldungen"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m:?}");
    m
}

async fn korrigieren(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    mid: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/meldungen/{mid}"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn lage(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lage/meldungen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    v.as_array().unwrap().clone()
}

/// Die ETB-Einträge mit Verweis auf die Meldung, älteste zuerst.
async fn etb_zur_meldung(app: &axum::Router, cookie: &str, einsatz: i64, mid: i64) -> Vec<Value> {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    let mut eintraege: Vec<Value> = v
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["meldung_id"] == mid)
        .cloned()
        .collect();
    eintraege.sort_by_key(|x| x["lfd_nr"].as_i64());
    eintraege
}

fn systemtexte(eintraege: &[Value]) -> Vec<String> {
    eintraege
        .iter()
        .filter(|x| x["typ"] == "system")
        .map(|x| x["inhalt"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn sonstige_wird_lagemeldung_steht_neu_in_der_lage_und_im_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let m = melden(&app, &admin, e, json!({})).await;
    let mid = m["id"].as_i64().unwrap();
    assert!(lage(&app, &admin, e).await.is_empty());

    let (s, neu) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({ "meldungsart": "lagemeldung" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{neu:?}");
    assert_eq!(neu["meldungsart"], "lagemeldung");
    assert_eq!(neu["lagerelevant"], true);
    assert_eq!(neu["inhalt"], "Brücke gesperrt", "der Wortlaut bleibt");

    let lage = lage(&app, &admin, e).await;
    assert_eq!(lage.len(), 1);
    assert_eq!(lage[0]["meldung_id"], mid);
    assert_eq!(lage[0]["meldungsart"], "lagemeldung");
    assert_eq!(lage[0]["is_neu"], true, "neu für die Kenntnisnahme");

    // Der ETB-Eintrag der Meldung behält seinen Typ; die Korrektur steht als Systemeintrag.
    let etb = etb_zur_meldung(&app, &admin, e, mid).await;
    assert_eq!(etb[0]["typ"], "meldung");
    assert_eq!(
        systemtexte(&etb),
        vec!["Meldung #1: Art Sonstige → Lagemeldung; in die Lage übernommen".to_string()]
    );
}

#[tokio::test]
async fn mehrere_felder_ein_systemeintrag_und_gleiche_werte_zaehlen_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();

    let (s, neu) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({
            "meldungsart": "sonstige",
            "prioritaet": "dringend",
            "richtung": "extern",
            "empfaenger": "Leitstelle",
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{neu:?}");
    assert_eq!(neu["prioritaet"], "dringend");
    assert_eq!(neu["richtung"], "extern");
    assert_eq!(neu["empfaenger"], "Leitstelle");
    // Empfänger ist Freitext (Scrub-Spalte, LFH-752): sein Wert steht nicht im ETB.
    assert_eq!(
        systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await),
        vec![
            "Meldung #1: Priorität Normal → Dringend; Richtung Intern → Extern; Empfänger geändert"
                .to_string()
        ]
    );

    // Dieselben Werte noch einmal: 200 mit dem Stand, kein zweiter Eintrag.
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "prioritaet": "dringend" })).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await).len(),
        1
    );
}

/// Die Empfängerfunktion lässt sich korrigieren (LLH-1381): der Systemeintrag nennt alt → neu,
/// `null` leert sie; ein unbekannter Code ist 400, eine Funktion mit Pflicht-Bezeichnung 422 wie
/// beim Erfassen.
#[tokio::test]
async fn empfaengerfunktion_korrigiert_nennt_alt_und_neu() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({ "empfaenger_funktion": "s3" })).await["id"]
        .as_i64()
        .unwrap();

    let (s, neu) = korrigieren(&app, &admin, e, mid, json!({ "empfaenger_funktion": "s2" })).await;
    assert_eq!(s, StatusCode::OK, "{neu:?}");
    assert_eq!(neu["empfaenger_funktion"], "s2");
    assert_eq!(neu["empfaenger"], "ELW 1", "der Freitext bleibt");
    let (s, neu) = korrigieren(&app, &admin, e, mid, json!({ "empfaenger_funktion": null })).await;
    assert_eq!(s, StatusCode::OK, "{neu:?}");
    assert!(
        !neu.as_object().unwrap().contains_key("empfaenger_funktion"),
        "{neu}"
    );
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "empfaenger_funktion": "el" })).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await),
        vec![
            "Meldung #1: Empfängerfunktion S3 → S2".to_string(),
            "Meldung #1: Empfängerfunktion S2 → keine".to_string(),
            "Meldung #1: Empfängerfunktion keine → EL".to_string(),
        ]
    );

    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "empfaenger_funktion": "s9" })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    for code in ["fachberater", "s7"] {
        let (s, v) =
            korrigieren(&app, &admin, e, mid, json!({ "empfaenger_funktion": code })).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{code}: {v:?}");
    }
    assert_eq!(
        systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await).len(),
        3,
        "Ablehnungen schreiben nichts"
    );
}

#[tokio::test]
async fn von_bezug_nachgetragen_aktualisiert_die_rueckmeldung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, e, "Florian Nord 1").await;
    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();

    let rueck = |app: axum::Router, cookie: String| async move {
        let (s, v) = anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{e}/meldungen/rueckmeldungen"),
            &cookie,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v:?}");
        v
    };
    assert!(rueck(app.clone(), admin.clone()).await["einheiten"]
        .as_array()
        .unwrap()
        .is_empty());

    let (s, neu) = korrigieren(&app, &admin, e, mid, json!({ "einheit_id": einheit })).await;
    assert_eq!(s, StatusCode::OK, "{neu:?}");
    assert_eq!(neu["einheit_id"], einheit);

    let r = rueck(app.clone(), admin.clone()).await;
    let einheiten = r["einheiten"].as_array().unwrap();
    assert_eq!(einheiten.len(), 1, "{r:?}");
    assert_eq!(einheiten[0]["bezug_id"], einheit);
    assert_eq!(einheiten[0]["meldung_id"], mid);
    assert_eq!(
        systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await),
        vec!["Meldung #1: Von ohne Zuordnung → Florian Nord 1".to_string()]
    );

    // Bezug wieder lösen: beide null.
    let (s, neu) = korrigieren(&app, &admin, e, mid, json!({ "einheit_id": null })).await;
    assert_eq!(s, StatusCode::OK, "{neu:?}");
    assert!(neu.get("einheit_id").is_none(), "{neu:?}");
    assert!(rueck(app.clone(), admin.clone()).await["einheiten"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn fremde_einheit_oder_beide_bezuege_sind_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let eigene = einheit_bilden(&app, &admin, e, "1. Zug").await;
    let fremde = einheit_bilden(&app, &admin, anderer, "Fremd").await;
    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();

    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "einheit_id": fremde })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({ "einheit_id": eigene, "abschnitt_id": 1 }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await).is_empty());
}

#[tokio::test]
async fn verortung_nachgetragen_steht_in_der_lage_mit_ort() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();
    // Ohne Ort übernommen.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen/{mid}/lagerelevant"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = korrigieren(&app, &admin, e, mid, json!({ "lat": 52.37, "lon": 9.73 })).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    let l = lage(&app, &admin, e).await;
    assert_eq!(l[0]["lat"], 52.37);
    assert_eq!(l[0]["lon"], 9.73);

    // Versetzen und entfernen gehen ebenso.
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lat": 52.4, "lon": 9.8 })).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lat": null, "lon": null })).await;
    assert_eq!(s, StatusCode::OK);
    assert!(lage(&app, &admin, e).await[0]["lat"].is_null());

    let texte = systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await);
    assert_eq!(
        &texte[1..],
        &[
            "Meldung #1: Verortung gesetzt".to_string(),
            "Meldung #1: Verortung geändert".to_string(),
            "Meldung #1: Verortung entfernt".to_string(),
        ]
    );

    // Nur ein halbes Paar: 422.
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lat": 52.4 })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn geaenderter_lage_text_macht_wieder_neu_und_wortlaut_gilt_bei_leer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({ "meldungsart": "lagemeldung" })).await["id"]
        .as_i64()
        .unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen/{mid}/lage-gesehen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(lage(&app, &admin, e).await[0]["is_neu"], false);

    let (s, _) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({ "lage_text": "Brücke Nord gesperrt" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let l = lage(&app, &admin, e).await;
    assert_eq!(l[0]["text"], "Brücke Nord gesperrt");
    assert_eq!(l[0]["is_neu"], true, "geänderter Lage-Text ist wieder neu");

    // Leer: der Wortlaut gilt wieder.
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lage_text": "" })).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(lage(&app, &admin, e).await[0]["text"], "Brücke gesperrt");
    assert_eq!(
        systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await),
        vec![
            "Meldung #1: Lage-Text geändert".to_string(),
            "Meldung #1: Lage-Text geändert".to_string(),
        ]
    );
}

#[tokio::test]
async fn lage_angaben_ohne_lage_sind_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lage_text": "x" })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lat": 52.0, "lon": 9.0 })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // Mit Übernahme im selben Schritt geht es.
    let (s, v) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({ "lagerelevant": true, "lat": 52.0, "lon": 9.0 }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(lage(&app, &admin, e).await[0]["lat"], 52.0);
}

#[tokio::test]
async fn aus_der_lage_nehmen_leert_die_lage_angaben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({ "meldungsart": "rueckmeldung" })).await["id"]
        .as_i64()
        .unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/meldungen/{mid}/lagerelevant"),
        &admin,
        Some(r#"{"text":"Brand aus","lat":52.0,"lon":9.0}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = korrigieren(&app, &admin, e, mid, json!({ "lagerelevant": false })).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["lagerelevant"], false);
    assert_eq!(v["inhalt"], "Brücke gesperrt");
    assert!(lage(&app, &admin, e).await.is_empty());
    assert!(systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await)
        .contains(&"Meldung #1: aus der Lage genommen".to_string()));

    // Erneut übernommen: ohne den alten Lage-Text und Ort, wieder neu.
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lagerelevant": true })).await;
    assert_eq!(s, StatusCode::OK);
    let l = lage(&app, &admin, e).await;
    assert_eq!(l[0]["text"], "Brücke gesperrt");
    assert!(l[0]["lat"].is_null());
    assert_eq!(l[0]["is_neu"], true);
}

#[tokio::test]
async fn lagemeldung_bleibt_in_der_lage() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({ "meldungsart": "lagemeldung" })).await["id"]
        .as_i64()
        .unwrap();

    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lagerelevant": false })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // Auch nicht im selben Schritt mit der Art.
    let (s, _) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({ "meldungsart": "lagemeldung", "lagerelevant": false }),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(lage(&app, &admin, e).await.len(), 1);

    // Weg von Lagemeldung: die Lagerelevanz bleibt, mit der neuen Art.
    let (s, v) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({ "meldungsart": "rueckmeldung" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["lagerelevant"], true);
    let l = lage(&app, &admin, e).await;
    assert_eq!(l.len(), 1);
    assert_eq!(l[0]["meldungsart"], "rueckmeldung");
    // Jetzt eine übernommene Rückmeldung: sie lässt sich aus der Lage nehmen.
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "lagerelevant": false })).await;
    assert_eq!(s, StatusCode::OK);
    assert!(lage(&app, &admin, e).await.is_empty());
}

#[tokio::test]
async fn eingang_bleibt_unveraenderlich_und_unbekanntes_feld_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();

    for feld in [
        json!({ "inhalt": "Brücke frei" }),
        json!({ "absender": "Florian Süd 2" }),
        json!({ "meldeweg": "telefon" }),
        json!({ "ereigniszeit": "2026-10-21 10:00:00" }),
        json!({ "eingang_at": "2026-10-21 10:00:00" }),
        json!({ "prioritaet": "dringend", "inhalt": "Brücke frei" }),
    ] {
        let (s, v) = korrigieren(&app, &admin, e, mid, feld.clone()).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{feld} → {v:?}");
    }
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "wortlaut": "x" })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "prioritaet": "eilig" })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (_, m) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/meldungen/{mid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(m["inhalt"], "Brücke gesperrt");
    assert_eq!(m["prioritaet"], "normal");
    assert!(systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await).is_empty());
}

/// Empfänger des Sofortalarms zu einer Meldung, aufsteigend.
async fn sofortalarm_an(pool: &sqlx::SqlitePool, mid: i64) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT benutzer_id FROM benachrichtigung \
         WHERE art = 'sofortmeldung' AND bezug_typ = 'meldung' AND bezug_id = ? \
         ORDER BY benutzer_id",
    )
    .bind(mid)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// LLH-1380: Heraufstufen zur Sofortmeldung ist 200 und alarmiert dieselben Empfänger wie das
/// Erfassen einer Sofortmeldung (alle mit dem Modul Meldungen außer dem Auslöser); die Meldung
/// wird bestätigungspflichtig samt Auto-Frist-Erinnerung. Herab- und erneutes Heraufstufen
/// alarmiert nicht noch einmal.
#[tokio::test]
async fn zur_sofortmeldung_heraufstufen_alarmiert_wie_beim_erfassen_und_nur_einmal() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    for name in ["annika", "bertram"] {
        let b = benutzer_anlegen(&app, &admin, name, "keine").await;
        rolle_setzen(&app, &admin, e, b, "fuehrungspersonal").await;
    }

    // Vergleich: wer beim Erfassen einer Sofortmeldung alarmiert wird.
    let erfasst = melden(&app, &admin, e, json!({ "prioritaet": "sofort" })).await["id"]
        .as_i64()
        .unwrap();
    let beim_erfassen = sofortalarm_an(&pool, erfasst).await;
    assert_eq!(beim_erfassen.len(), 2, "annika und bertram");

    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();
    assert!(sofortalarm_an(&pool, mid).await.is_empty());
    let (s, v) = korrigieren(&app, &admin, e, mid, json!({ "prioritaet": "sofort" })).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["prioritaet"], "sofort");
    assert_eq!(v["bestaetigung_pflicht"], true);
    assert!(v["bestaetigung_frist_at"].is_string(), "{v:?}");
    assert_eq!(sofortalarm_an(&pool, mid).await, beim_erfassen);
    let erinnerungen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM erinnerung WHERE quelle = 'auto_frist' AND bezug_typ = 'meldung' \
           AND bezug_id = ? AND titel LIKE 'Sofortmeldung #% unbestätigt'",
    )
    .bind(mid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(erinnerungen, 1);

    // Herab- und wieder heraufstufen, auch über die Art: kein zweiter Alarm.
    let (s, _) = korrigieren(&app, &admin, e, mid, json!({ "prioritaet": "normal" })).await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = korrigieren(
        &app,
        &admin,
        e,
        mid,
        json!({ "meldungsart": "sofortmeldung" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(sofortalarm_an(&pool, mid).await, beim_erfassen);

    let lfd = v["lfd_nr"].as_i64().unwrap();
    assert_eq!(
        systemtexte(&etb_zur_meldung(&app, &admin, e, mid).await),
        [
            format!(
                "Meldung #{lfd}: zur Sofortmeldung heraufgestuft, Sofortalarm ausgelöst; \
                 Priorität Normal → Sofort"
            ),
            format!("Meldung #{lfd}: Priorität Sofort → Normal"),
            format!(
                "Meldung #{lfd}: zur Sofortmeldung heraufgestuft, Sofortalarm war schon \
                 ausgelöst; Art Sonstige → Sofortmeldung"
            ),
        ]
    );
}

/// Eine als Sofortmeldung erfasste Meldung hatte ihren Alarm beim Erfassen: herabgestuft und
/// wieder heraufgestuft alarmiert sie nicht noch einmal. Die Bestätigungspflicht bleibt.
#[tokio::test]
async fn erfasste_sofortmeldung_herab_und_heraufgestuft_alarmiert_nicht_doppelt() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    rolle_setzen(&app, &admin, e, b, "fuehrungspersonal").await;

    let sofort = melden(
        &app,
        &admin,
        e,
        json!({ "meldungsart": "sofortmeldung", "prioritaet": "sofort" }),
    )
    .await;
    let sid = sofort["id"].as_i64().unwrap();
    assert_eq!(sofortalarm_an(&pool, sid).await, [b]);
    let (s, v) = korrigieren(
        &app,
        &admin,
        e,
        sid,
        json!({ "meldungsart": "lagemeldung", "prioritaet": "dringend" }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["meldungsart"], "lagemeldung");
    // Die Bestätigungspflicht aus dem Eingang bleibt.
    assert_eq!(v["bestaetigung_pflicht"], true);

    // Der Aufräumlauf hat die Zeile inzwischen entfernt: der Merker an der Meldung trägt.
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();
    let (s, v) = korrigieren(&app, &admin, e, sid, json!({ "prioritaet": "sofort" })).await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert!(sofortalarm_an(&pool, sid).await.is_empty());
}

#[tokio::test]
async fn ohne_schreibrecht_403_und_fremder_einsatz_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let mid = melden(&app, &admin, e, json!({})).await["id"]
        .as_i64()
        .unwrap();

    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) = korrigieren(&app, &erika_c, e, mid, json!({ "prioritaet": "dringend" })).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    let (s, _) = korrigieren(
        &app,
        &admin,
        anderer,
        mid,
        json!({ "prioritaet": "dringend" }),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
