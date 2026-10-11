use axum::http::StatusCode;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, recv_until_tag, rolle_setzen, setup,
    setup_mit_live,
};
use serde_json::Value;
use std::time::Duration;

#[tokio::test]
async fn anlegen_und_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["vorlage"], "lagebericht");
    assert_eq!(json["status"], "entwurf");
    assert_eq!(
        json["abschnitte"].as_array().unwrap().len(),
        8,
        "sieben Abschnitte + Medienlage (LFH-554)"
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn freigabe_schreibt_genau_einen_lage_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage 10:00"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"Hochwasser steigt."}]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, frei) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(frei["status"], "freigegeben");
    assert!(frei["etb_eintrag_id"].is_i64());
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let lage: Vec<&serde_json::Value> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "lage")
        .collect();
    assert_eq!(lage.len(), 1);
    assert!(lage[0]["inhalt"]
        .as_str()
        .unwrap()
        .contains("Hochwasser steigt."));
    assert_eq!(lage[0]["lagebericht_id"], lid);
}

#[tokio::test]
async fn freigegebener_bericht_nicht_mehr_patchbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"titel":"Neu"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Der Abschnitts-Schlüssel wird gegen die Schlüsselmenge der Vorlage geprüft und scheitert
/// für sich genommen → 400 (LFH-305). Abgrenzung zu den 422 dieser Datei
/// (`freigegebener_bericht_nicht_mehr_patchbar`, `freigabe_leerer_bericht_422`): die
/// bewerten den Zustand des Objekts, nicht ein einzelnes Feld. Der Positiv-Zweig belegt,
/// dass der 400 aus der Schlüsselprüfung kommt und nicht aus einem vorgelagerten Gate.
#[tokio::test]
async fn patch_unbekannter_abschnitts_schluessel_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    let u = format!("/api/einsaetze/{einsatz}/lageberichte/{lid}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"quatsch","text":"x"}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{antwort:?}");

    let (status, antwort) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"Lage steigt."}]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Positiv-Zweig: {antwort:?}");
}

#[tokio::test]
async fn freigabe_leerer_bericht_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"X"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn fortschreiben_erzeugt_version_2() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage"}"#),
    )
    .await;
    let lid = lb["id"].as_i64().unwrap();
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}"),
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"A"}]}"#),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    let (s, fort) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{lid}/fortschreiben"),
        &admin,
        Some(r#"{}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(fort["version"], 2);
    assert_eq!(fort["vorgaenger_id"], lid);
    assert_eq!(fort["status"], "entwurf");
    // Fortschreibung übernimmt die Inhalte des freigegebenen Vorgängers als Ausgangspunkt.
    assert_eq!(fort["abschnitte"][0]["text"], "A");
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beo = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beo, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/lageberichte"),
            &erika,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/lageberichte"),
            &erika,
            Some(r#"{"vorlage":"freitext","titel":"X"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

/// Charakterisierung der Freigabe: Antwort, ETB-Snapshot und die beiden 422-Wortlaute sind
/// byte-genau gepinnt. Der Handler rendert über `lagebericht::repo::freigeben_tx` auf der
/// Verbindung; der Snapshot muss derselbe bleiben.
#[tokio::test]
async fn freigabe_schreibt_gerenderten_snapshot_byte_genau_ins_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, lb) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage 10:00","zeitstand":"2026-06-02 10:00:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{lb:?}");
    let lid = lb["id"].as_i64().unwrap();
    let u = format!("/api/einsaetze/{einsatz}/lageberichte/{lid}");

    let (s, antwort) = anfrage(&app, "POST", &format!("{u}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{antwort:?}");
    assert_eq!(
        antwort["error"],
        "Der Bericht ist leer und kann nicht freigegeben werden"
    );

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &u,
        &admin,
        Some(r#"{"abschnitte":[{"schluessel":"text","text":"  Hochwasser steigt. "}]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, frei) = anfrage(&app, "POST", &format!("{u}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{frei:?}");
    assert_eq!(frei["status"], "freigegeben");
    assert_eq!(frei["id"], lid);
    assert_eq!(frei["zeitstand"], "2026-06-02 10:00:00");
    assert!(frei["freigegeben_von_id"].is_i64());
    assert!(frei["freigegeben_at"].is_string());
    let etb_id = frei["etb_eintrag_id"].as_i64().expect("etb_eintrag_id");

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let lage: Vec<&serde_json::Value> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "lage")
        .collect();
    assert_eq!(lage.len(), 1);
    let e = lage[0];
    assert_eq!(e["id"], etb_id);
    assert_eq!(e["lagebericht_id"], lid);
    assert_eq!(e["ereigniszeit"], "2026-06-02 10:00:00");
    assert_eq!(
        e["inhalt"],
        "# Lage 10:00\n\n_Zeitstand: 2026-06-02 10:00:00_\n\n## Bericht\nHochwasser steigt.\n"
    );

    let (s, antwort) = anfrage(&app, "POST", &format!("{u}/freigeben"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{antwort:?}");
    assert_eq!(antwort["error"], "Bericht ist bereits freigegeben");
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    let n = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "lage")
        .count();
    assert_eq!(n, 1);
}

/// Spec `listen-projektion`, „Liste ohne Abschnitte“ und „Detail mit Abschnitten“ (LFH-931).
#[tokio::test]
async fn liste_liefert_koepfe_ohne_abschnitte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, angelegt) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#),
    )
    .await;
    let id = angelegt["id"].as_i64().unwrap();
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        None,
    )
    .await;
    let zeile = liste[0].as_object().unwrap();
    assert!(
        !zeile.contains_key("abschnitte"),
        "Kopf ohne Abschnitte: {zeile:?}"
    );
    assert!(!zeile.contains_key("aktualisiert_at"), "{zeile:?}");
    assert_eq!(zeile["id"], id);
    assert_eq!(zeile["titel"], "Lage 10:00");
    assert_eq!(zeile["vorlage"], "lagebericht");
    assert_eq!(zeile["status"], "entwurf");
    assert_eq!(zeile["version"], 1);
    assert!(zeile["ersteller_name"].is_string(), "{zeile:?}");
    let (_, detail) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/lageberichte/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(detail["abschnitte"].as_array().unwrap().len(), 8);
}

/// Spec `live-abgleich`, „Autosave in einem zweiten Tab“ und „Titel geändert“: ein PATCH nur
/// an Abschnitten kennzeichnet das Ereignis mit `nur_inhalt`, ein Titelwechsel nicht (LFH-931).
#[tokio::test]
async fn entwurfs_patch_nur_an_abschnitten_kennzeichnet_das_ereignis() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, angelegt) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lageberichte"),
        &admin,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#),
    )
    .await;
    let id = angelegt["id"].as_i64().unwrap();
    let schluessel = angelegt["abschnitte"][0]["schluessel"]
        .as_str()
        .unwrap()
        .to_string();
    let pfad = format!("/api/einsaetze/{einsatz}/lageberichte/{id}");
    let mut rx = live.abonniere(einsatz);

    let inhalt = format!(
        r#"{{"titel":"Lage 10:00","abschnitte":[{{"schluessel":"{schluessel}","text":"Pegel steigt bei Familie Muster"}}]}}"#
    );
    let (s, _) = anfrage(&app, "PATCH", &pfad, &admin, Some(&inhalt)).await;
    assert_eq!(s, StatusCode::OK);
    let n = recv_until_tag(&mut rx, "lagebericht", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert_eq!(v["lagebericht_id"], id);
    assert_eq!(v["nur_inhalt"], true, "{:?}", n.data);
    assert!(
        !n.data.contains("Muster"),
        "keine Inhalte im Ereignis: {:?}",
        n.data
    );

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"titel":"Lage 11:00"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let n = recv_until_tag(&mut rx, "lagebericht", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert!(
        v.get("nur_inhalt").is_none(),
        "Titelwechsel ändert die Liste: {:?}",
        n.data
    );

    let (s, _) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"zeitstand":"2026-06-02 11:30:00"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let n = recv_until_tag(&mut rx, "lagebericht", Duration::from_secs(1)).await;
    let v: Value = serde_json::from_str(&n.data).unwrap();
    assert!(
        v.get("nur_inhalt").is_none(),
        "Zeitstand ändert die Liste: {:?}",
        n.data
    );
}

/// LFH-1150: Die Dokumentrouten (`routes/vorlagendokument.rs`) reichen die Einsatzrolle in die
/// Modulfreigabe. Unter „Führung im Einsatz“ liest und schreibt die Einsatzleitung ohne Org-Rolle
/// Lageberichte; ein Beobachter liest sie nicht.
#[tokio::test]
async fn einsatzfuehrung_laesst_einsatzleitung_ohne_org_rolle_lesen_und_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let lid = benutzer_anlegen(&app, &admin, "leonie", "keine").await;
    rolle_setzen(&app, &admin, einsatz, lid, "einsatzleitung").await;
    let leonie = login_cookie(&app, "leonie", "leoniepw1").await;
    let bid = benutzer_anlegen(&app, &admin, "berta", "keine").await;
    rolle_setzen(&app, &admin, einsatz, bid, "beobachter").await;
    let berta = login_cookie(&app, "berta", "bertapw1").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/lageberichte"),
        &leonie,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"einsatzfuehrung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let pfad = format!("/api/einsaetze/{einsatz}/lageberichte");
    let (status, json) = anfrage(
        &app,
        "POST",
        &pfad,
        &leonie,
        Some(r#"{"vorlage":"lagebericht","titel":"Lage 10:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    let (status, _) = anfrage(&app, "GET", &pfad, &leonie, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(&app, "GET", &pfad, &berta, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
