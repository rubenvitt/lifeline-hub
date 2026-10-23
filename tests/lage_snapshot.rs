//! Integrationstests für Lage-Snapshots (LFH-321): Persistenz (Metadaten-Liste ohne `daten`,
//! Volldokument, Einsatz-Scoping), Capture `erzeuge` (Einfrieren des vollen Lagebilds,
//! Immutabilität, Vollständigkeit) und die HTTP-Routen.

use axum::http::StatusCode;
use lifeline_hub::einheit::repo::{self as einheit_repo, EinheitDaten, EinheitPatch};
use lifeline_hub::lage_snapshot::repo;
use serde_json::json;
use sqlx::SqlitePool;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool,
};

/// Router + Einsatz + Admin-Cookie (Admin = Einsatzleitung) für HTTP-Tests.
async fn setup_http() -> (axum::Router, i64, String) {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_id = einsatz_anlegen(&app, &cookie).await;
    (app, einsatz_id, cookie)
}

/// Pool + frischer Einsatz + Admin-`benutzer_id` + `org_id` für Repo-Level-Tests.
async fn setup() -> (SqlitePool, i64, i64, i64) {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz_id = einsatz_anlegen(&app, &cookie).await;
    let benutzer_id: i64 =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    (pool, einsatz_id, benutzer_id, org_id)
}

/// Legt eine minimale Einheit an und liefert deren id.
async fn seed_einheit(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    benutzer_id: i64,
    name: &str,
) -> i64 {
    einheit_repo::anlegen(
        pool,
        einsatz_id,
        org_id,
        EinheitDaten {
            name,
            abschnitt_id: None,
            ueber_einheit_id: None,
            typ_id: None,
            soll_fuehrer: None,
            soll_unterfuehrer: None,
            soll_mannschaft: None,
            bemerkung: None,
            funkrufname: None,
            sortier: 0,
            tz_fachaufgabe: None,
            tz_organisation: None,
        },
        benutzer_id,
    )
    .await
    .unwrap()
    .id
}

#[tokio::test]
async fn liste_liefert_metadaten_ohne_daten_einzel_liefert_dokument() {
    let (pool, einsatz_id, benutzer_id, _org_id) = setup().await;
    let daten = json!({"version": 1, "marker": [{"typ": "uhs", "id": 1}]});
    let id = repo::insert_roh(
        &pool,
        einsatz_id,
        benutzer_id,
        Some("08:00"),
        None,
        "2026-07-24T08:00:00Z",
        &daten,
    )
    .await
    .unwrap();

    let liste = repo::liste_metadaten(&pool, einsatz_id).await.unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].bezeichnung.as_deref(), Some("08:00"));
    assert_eq!(liste[0].schema_version, 1);
    // Metadaten-DTO trägt strukturell kein `daten`-Feld.
    let v = serde_json::to_value(&liste[0]).unwrap();
    assert!(
        !v.as_object().unwrap().contains_key("daten"),
        "Metadaten dürfen kein daten tragen: {v}"
    );

    let dok = repo::lade_dokument(&pool, einsatz_id, id)
        .await
        .unwrap()
        .expect("Dokument vorhanden");
    assert_eq!(dok.daten, daten);
    assert_eq!(dok.schema_version, 1);
}

#[tokio::test]
async fn lade_und_loesche_sind_einsatz_gescopt() {
    let (pool, einsatz_id, benutzer_id, _org_id) = setup().await;
    let daten = json!({"version": 1});
    let id = repo::insert_roh(
        &pool,
        einsatz_id,
        benutzer_id,
        None,
        None,
        "2026-07-24T08:00:00Z",
        &daten,
    )
    .await
    .unwrap();

    // Ein fremder Einsatz sieht den Snapshot nicht und kann ihn nicht löschen.
    let fremd = einsatz_id + 999;
    assert!(repo::lade_dokument(&pool, fremd, id)
        .await
        .unwrap()
        .is_none());
    assert!(!repo::loesche(&pool, fremd, id).await.unwrap());

    // Der eigene Einsatz schon.
    assert!(repo::lade_dokument(&pool, einsatz_id, id)
        .await
        .unwrap()
        .is_some());
    assert!(repo::loesche(&pool, einsatz_id, id).await.unwrap());
    assert!(repo::liste_metadaten(&pool, einsatz_id)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn snapshot_friert_fachdaten_ein_umbenennen_aendert_stand_nicht() {
    let (pool, einsatz_id, benutzer_id, org_id) = setup().await;
    let einheit_id = seed_einheit(&pool, einsatz_id, org_id, benutzer_id, "THW Zug 1").await;

    let snap = repo::erzeuge(&pool, einsatz_id, benutzer_id, Some("Stand 1"), None)
        .await
        .unwrap();

    // Einheit nach dem Snapshot umbenennen.
    einheit_repo::patche(
        &pool,
        einsatz_id,
        org_id,
        einheit_id,
        EinheitPatch {
            name: Some("THW Zug 2"),
            abschnitt_id: None,
            ueber_einheit_id: None,
            typ_id: None,
            soll_fuehrer: None,
            soll_unterfuehrer: None,
            soll_mannschaft: None,
            bemerkung: None,
            funkrufname: None,
            sortier: None,
        },
    )
    .await
    .unwrap();

    // Der gespeicherte Stand zeigt weiterhin den alten Namen.
    let dok = repo::lade_dokument(&pool, einsatz_id, snap.id)
        .await
        .unwrap()
        .unwrap();
    let namen: Vec<&str> = dok.daten["einheiten"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert!(
        namen.contains(&"THW Zug 1"),
        "Snapshot muss den eingefrorenen Namen tragen: {namen:?}"
    );
    assert!(
        !namen.contains(&"THW Zug 2"),
        "Live-Umbenennung darf den Stand nicht ändern: {namen:?}"
    );
}

/// LLH-1134: Telefon und weitere Verbindungen an Einheit und Abschnitt friert der Stand nicht ein
/// (personenbezogen, kein Schwärzungspfad im Dokument); live stehen sie weiter.
#[tokio::test]
async fn snapshot_friert_keine_verbindungen_ein() {
    use lifeline_hub::einsatz::verbindungen::{ersetzen, Bezug, Verbindung};
    use lifeline_hub::stab::kommunikation::Verbindungsmittel;
    let (pool, einsatz_id, benutzer_id, org_id) = setup().await;
    let einheit_id = seed_einheit(&pool, einsatz_id, org_id, benutzer_id, "Zug A").await;
    let abschnitt_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
    )
    .bind(einsatz_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let nummer = |wert: &str| Verbindung {
        mittel: Verbindungsmittel::Mobil,
        wert: wert.into(),
        hinweis: None,
    };
    ersetzen(
        &pool,
        einsatz_id,
        Bezug::Einheit(einheit_id),
        &[nummer("0170 4711")],
    )
    .await
    .unwrap();
    ersetzen(
        &pool,
        einsatz_id,
        Bezug::Abschnitt(abschnitt_id),
        &[nummer("0170 0815")],
    )
    .await
    .unwrap();

    let snap = repo::erzeuge(&pool, einsatz_id, benutzer_id, Some("Stand"), None)
        .await
        .unwrap();
    let text = snap.daten.to_string();
    assert!(!text.contains("4711") && !text.contains("0815"), "{text}");
    assert_eq!(snap.daten["einheiten"][0]["verbindungen"], json!([]));
    assert_eq!(snap.daten["abschnitte"][0]["verbindungen"], json!([]));
    let live = einheit_repo::laden(&pool, einsatz_id, einheit_id)
        .await
        .unwrap();
    assert_eq!(live.verbindungen.len(), 1);
}

#[tokio::test]
async fn snapshot_hat_alle_quellen_und_friert_org_default_ein() {
    let (pool, einsatz_id, benutzer_id, org_id) = setup().await;
    sqlx::query("UPDATE organisation SET tz_organisation = 'thw' WHERE id = ?")
        .bind(org_id)
        .execute(&pool)
        .await
        .unwrap();
    seed_einheit(&pool, einsatz_id, org_id, benutzer_id, "Zug A").await;

    let snap = repo::erzeuge(&pool, einsatz_id, benutzer_id, Some("Stand"), None)
        .await
        .unwrap();

    // Guard gegen vergessene Quelle: jeder erwartete Top-Level-Schlüssel ist als Array präsent.
    for key in [
        "ansichten",
        "uhs",
        "schaeden",
        "einheiten",
        "fahrzeuge",
        "fuehrungskraefte",
        "abschnitte",
        "zonen",
        "freie_zeichen",
        "gefahrengebiete",
        "lagemeldungen",
        "bilder",
        "betreuungsstellen",
        "evakuierungsbezirke",
        "bereitstellungsraeume",
        "tiere",
    ] {
        assert!(
            snap.daten[key].is_array(),
            "Schlüssel {key} fehlt oder ist kein Array: {}",
            snap.daten
        );
    }
    assert_eq!(snap.daten["version"], 1);
    assert!(snap.daten["stand_at"].as_str().is_some());
    assert_eq!(snap.daten["org_default"], "thw");
    assert!(snap.daten["einheiten"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["name"] == "Zug A"));

    // Global-Scope-Freeze: Org-Default NACH dem Snapshot ändern → Stand bleibt unverändert.
    sqlx::query("UPDATE organisation SET tz_organisation = 'feuerwehr' WHERE id = ?")
        .bind(org_id)
        .execute(&pool)
        .await
        .unwrap();
    let dok = repo::lade_dokument(&pool, einsatz_id, snap.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        dok.daten["org_default"], "thw",
        "Org-Default muss im Stand eingefroren bleiben"
    );
}

// ---------- HTTP-Routen ----------

#[tokio::test]
async fn post_erzeugt_snapshot_201_liste_ohne_daten_einzel_mit_daten() {
    let (app, e, cookie) = setup_http().await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &cookie,
        Some(r#"{"bezeichnung":"Stand 1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    let sid = v["id"].as_i64().unwrap();
    assert!(
        v["daten"].is_object(),
        "POST-Antwort ist das Volldokument: {v}"
    );

    // Liste: Metadaten ohne daten.
    let (s, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let arr = liste.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["bezeichnung"], "Stand 1");
    assert!(
        arr[0].get("daten").is_none(),
        "Liste darf kein daten tragen: {liste}"
    );

    // Einzel: Volldokument mit daten.
    let (s, dok) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/lage-snapshots/{sid}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        dok["daten"]["einheiten"].is_array(),
        "Volldokument trägt daten: {dok}"
    );
}

#[tokio::test]
async fn patch_ist_immutabel_fuer_daten_und_stand_at() {
    let (app, e, cookie) = setup_http().await;
    let (_, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &cookie,
        Some(r#"{"bezeichnung":"Stand 1"}"#),
    )
    .await;
    let sid = v["id"].as_i64().unwrap();
    let daten_vorher = v["daten"].clone();
    let stand_vorher = v["stand_at"].clone();

    // Versuch, daten/stand_at per PATCH zu ändern — diese Felder existieren im DTO nicht.
    let (s, patched) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/lage-snapshots/{sid}"),
        &cookie,
        Some(r#"{"bezeichnung":"Neu","daten":{"hacked":true},"stand_at":"1999"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{patched:?}");
    assert_eq!(
        patched["bezeichnung"], "Neu",
        "nur Metadaten sind schreibbar"
    );
    assert_eq!(
        patched["daten"], daten_vorher,
        "daten muss unveränderlich sein"
    );
    assert_eq!(
        patched["stand_at"], stand_vorher,
        "stand_at muss unveränderlich sein"
    );
}

#[tokio::test]
async fn delete_nur_einsatzleitung() {
    let (app, e, admin) = setup_http().await;
    let (_, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &admin,
        Some(r#"{"bezeichnung":"S"}"#),
    )
    .await;
    let sid = v["id"].as_i64().unwrap();

    // Führungspersonal: hat Schreibrecht, aber keine Einsatzleitung.
    let fuehr_id = benutzer_anlegen(&app, &admin, "fuehrer1", "keine").await;
    rolle_setzen(&app, &admin, e, fuehr_id, "fuehrungspersonal").await;
    let fuehr = login_cookie(&app, "fuehrer1", "fuehrer1pw1").await;

    // ... darf einen Stand sichern (Schreibrecht) ...
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &fuehr,
        Some(r#"{"bezeichnung":"vom Fuehrer"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Führungspersonal darf sichern");

    // ... aber NICHT löschen (Dokumenten-Vernichtung, nur Leitung).
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/lage-snapshots/{sid}"),
        &fuehr,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Nur Einsatzleitung darf löschen");

    // Die Einsatzleitung schon.
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/lage-snapshots/{sid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn fremder_einsatz_ist_404() {
    let (app, e, cookie) = setup_http().await;
    let (_, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &cookie,
        Some(r#"{}"#),
    )
    .await;
    let sid = v["id"].as_i64().unwrap();
    // Nicht existenter Einsatz → 404 über den EinsatzKontext-Extractor.
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{}/lage-snapshots/{sid}", e + 999),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ---------- Modul-Redaktion des Snapshot-Dokuments ----------

#[tokio::test]
async fn snapshot_dokument_redigiert_gesperrtes_modul_fuer_den_leser() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let benutzer_id: i64 =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();

    seed_einheit(&pool, e, org_id, benutzer_id, "Zug 1").await;
    let snap = repo::erzeuge(&pool, e, benutzer_id, Some("S"), None)
        .await
        .unwrap();

    // Ein Mitglied mit lagekarte-Lesezugriff (Beobachter genügt zum Lesen).
    let leser_id = benutzer_anlegen(&app, &admin, "leser1", "keine").await;
    rolle_setzen(&app, &admin, e, leser_id, "beobachter").await;
    let leser = login_cookie(&app, "leser1", "leser1pw1").await;

    let pfad = format!("/api/einsaetze/{e}/lage-snapshots/{}", snap.id);

    // Vor der Sperre: der Leser sieht die Einheit im eingefrorenen Dokument.
    let (s, dok) = anfrage(&app, "GET", &pfad, &leser, None).await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert!(
        !dok["daten"]["einheiten"].as_array().unwrap().is_empty(),
        "vor Sperre sieht der Leser die Einheiten: {dok}"
    );

    // „einheiten" einsatzweit sperren (Admin/Leitung).
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/einheiten"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    // Nach der Sperre: einheiten ist im Dokument leer redigiert (spiegelt den 403 des Live-Wegs),
    // lagekarte-natives (einsatz) bleibt erhalten.
    let (s, dok) = anfrage(&app, "GET", &pfad, &leser, None).await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert!(
        dok["daten"]["einheiten"].as_array().unwrap().is_empty(),
        "nach Sperre muss einheiten redigiert sein: {dok}"
    );
    assert!(
        dok["daten"].get("einsatz").is_some(),
        "lagekarte-natives einsatz bleibt: {dok}"
    );
}

// ---------- LFH-673: Betreuungsstellen und Bezirke im Stand ----------

#[tokio::test]
async fn snapshot_friert_betreuung_ein_und_redigiert_sie_ohne_modulrecht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let benutzer_id: i64 =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let (s, stelle) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/betreuung/stellen"),
        &admin,
        Some(r#"{"bezeichnung":"NU Turnhalle Nord","art":"notunterkunft"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{stelle:?}");
    let sid = stelle["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/betreuung/stellen/{sid}"),
        &admin,
        Some(r#"{"lat":51.93,"lon":8.87}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/evakuierung/bezirke"),
        &admin,
        Some(r#"{"bezeichnung":"Uferstraße 12–40","plan_personen":640,"plan_erhebung":"geschaetzt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let snap = repo::erzeuge(&pool, e, benutzer_id, Some("S"), None)
        .await
        .unwrap();
    assert_eq!(snap.daten["betreuungsstellen"][0]["lat"], 51.93);
    assert_eq!(
        snap.daten["evakuierungsbezirke"][0]["bezeichnung"],
        "Uferstraße 12–40"
    );

    // Seit LLH-1034 zwei Module: ohne Betreuung fehlen nur die Stellen, die Bezirke bleiben.
    let leser_id = benutzer_anlegen(&app, &admin, "leser2", "keine").await;
    rolle_setzen(&app, &admin, e, leser_id, "beobachter").await;
    let leser = login_cookie(&app, "leser2", "leser2pw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/betreuung"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"fuehrungskraft"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let pfad = format!("/api/einsaetze/{e}/lage-snapshots/{}", snap.id);
    let (s, dok) = anfrage(&app, "GET", &pfad, &leser, None).await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert!(
        dok["daten"]["betreuungsstellen"]
            .as_array()
            .unwrap()
            .is_empty(),
        "{dok}"
    );
    assert_eq!(
        dok["daten"]["evakuierungsbezirke"][0]["bezeichnung"], "Uferstraße 12–40",
        "{dok}"
    );
    assert!(!dok.to_string().contains("Turnhalle"), "{dok}");

    // Ohne Evakuierung fehlen auch die Bezirke.
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/evakuierung"),
        &admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"fuehrungskraft"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, dok) = anfrage(&app, "GET", &pfad, &leser, None).await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert!(
        dok["daten"]["evakuierungsbezirke"]
            .as_array()
            .unwrap()
            .is_empty(),
        "{dok}"
    );
    let text = dok.to_string();
    assert!(
        !text.contains("Turnhalle") && !text.contains("Uferstraße"),
        "{text}"
    );
    // Der Admin sieht beides weiter.
    let (_, dok) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(
        dok["daten"]["betreuungsstellen"].as_array().unwrap().len(),
        1
    );
}

// ---------- LLH-1107: Bereitstellungsräume im Stand ----------

/// Ein verorteter aktiver Raum mit einer Einheit friert Koordinate, Status und Kennzahlen der
/// Belegung ein; ein Leser, für den das Modul ausgeblendet ist, bekommt `[]`.
#[tokio::test]
async fn snapshot_friert_br_ein_und_redigiert_ihn_ohne_modulrecht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let benutzer_id: i64 =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let (s, raum) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume"),
        &admin,
        Some(r#"{"bezeichnung":"BR Sportplatz","lat":51.93,"lon":8.87}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{raum:?}");
    let br = raum["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume/{br}/status"),
        &admin,
        Some(r#"{"status":"aktiv"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let zug = common::einheit_bilden(&app, &admin, e, "1. Zug").await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume/{br}/belegung"),
        &admin,
        Some(&format!(
            r#"{{"objekt_typ":"einheit","objekt_id":{zug},"art":"eintritt"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");

    let snap = repo::erzeuge(&pool, e, benutzer_id, Some("S"), None)
        .await
        .unwrap();
    let eingefroren = &snap.daten["bereitstellungsraeume"][0];
    assert_eq!(eingefroren["bezeichnung"], "BR Sportplatz", "{eingefroren}");
    assert_eq!(eingefroren["lat"], 51.93);
    assert_eq!(eingefroren["lon"], 8.87);
    assert_eq!(eingefroren["status"], "aktiv");
    assert_eq!(eingefroren["belegung"]["einheiten"], 1);
    assert_eq!(eingefroren["einheit_ids"], json!([zug]));

    // Für einen Beobachter ist das Modul ausgeblendet: das Feld kommt leer.
    let leser_id = benutzer_anlegen(&app, &admin, "leser3", "keine").await;
    rolle_setzen(&app, &admin, e, leser_id, "beobachter").await;
    let leser = login_cookie(&app, "leser3", "leser3pw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/bereitstellungsraeume"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let pfad = format!("/api/einsaetze/{e}/lage-snapshots/{}", snap.id);
    let (s, dok) = anfrage(&app, "GET", &pfad, &leser, None).await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert_eq!(dok["daten"]["bereitstellungsraeume"], json!([]), "{dok}");
    assert!(!dok.to_string().contains("Sportplatz"), "{dok}");
    // Der Admin liest ihn weiter.
    let (_, dok) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(
        dok["daten"]["bereitstellungsraeume"][0]["lat"], 51.93,
        "{dok}"
    );
}

/// Auch die Antworten von „Stand sichern“ (POST) und PATCH tragen `daten`; sie werden wie das GET
/// auf die Modulrechte geschwärzt. Führungspersonal mit Schreibrecht auf die Lagekarte, für das
/// das Modul Bereitstellungsräume ausgeblendet ist, bekommt in beiden `[]`.
#[tokio::test]
async fn snapshot_post_und_patch_redigieren_br_ohne_modulrecht() {
    let (app, e, admin) = setup_http().await;
    let (s, raum) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/bereitstellungsraeume"),
        &admin,
        Some(r#"{"bezeichnung":"BR Sportplatz","lat":51.93,"lon":8.87}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{raum:?}");
    let fuehr_id = benutzer_anlegen(&app, &admin, "fuehrer7", "keine").await;
    rolle_setzen(&app, &admin, e, fuehr_id, "fuehrungspersonal").await;
    let fuehr = login_cookie(&app, "fuehrer7", "fuehrer7pw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/bereitstellungsraeume"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, dok) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &fuehr,
        Some(r#"{"bezeichnung":"vom Fuehrer"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{dok:?}");
    assert_eq!(dok["daten"]["bereitstellungsraeume"], json!([]), "{dok}");
    assert!(!dok.to_string().contains("Sportplatz"), "{dok}");
    let sid = dok["id"].as_i64().unwrap();

    let pfad = format!("/api/einsaetze/{e}/lage-snapshots/{sid}");
    let (s, dok) = anfrage(&app, "PATCH", &pfad, &fuehr, Some(r#"{"notiz":"n"}"#)).await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert_eq!(dok["notiz"], "n");
    assert_eq!(dok["daten"]["bereitstellungsraeume"], json!([]), "{dok}");
    assert!(!dok.to_string().contains("Sportplatz"), "{dok}");

    // Eingefroren ist der Raum trotzdem: die Einsatzleitung liest ihn im selben Stand.
    let (_, dok) = anfrage(&app, "PATCH", &pfad, &admin, Some(r#"{"notiz":"m"}"#)).await;
    assert_eq!(
        dok["daten"]["bereitstellungsraeume"][0]["bezeichnung"], "BR Sportplatz",
        "{dok}"
    );
}

// ---------- LLH-1123: Tiere im Stand ----------

/// Offene und vermisste Tiere frieren mit Fundort-Koordinate ein, abgeschlossene nicht; Halter
/// und Notiz stehen nicht im Stand. Ein Leser, für den das Modul Tiere ausgeblendet ist, bekommt
/// `[]`.
#[tokio::test]
async fn snapshot_friert_tiere_ein_und_redigiert_sie_ohne_modulrecht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let benutzer_id: i64 =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let (s, tier) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(
            r#"{"spezies":"hund","rufname":"Bello","antreff_ort":"Garten","antreff_lat":51.93,
                "antreff_lon":8.87,"halter_kontakt":"Frau Huber 0170","notiz":"bissig"}"#,
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{tier:?}");
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(r#"{"spezies":"katze","status":"vermisst"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");

    let snap = repo::erzeuge(&pool, e, benutzer_id, Some("S"), None)
        .await
        .unwrap();
    let tiere = snap.daten["tiere"].as_array().unwrap();
    assert_eq!(tiere.len(), 2, "{}", snap.daten["tiere"]);
    let bello = tiere.iter().find(|t| t["rufname"] == "Bello").unwrap();
    assert_eq!(bello["antreff_lat"], 51.93, "{bello}");
    assert_eq!(bello["antreff_lon"], 8.87);
    assert_eq!(bello["status"], "aktiv");
    assert_eq!(bello["spezies"], "hund");
    let katze = tiere.iter().find(|t| t["spezies"] == "katze").unwrap();
    assert_eq!(katze["status"], "vermisst");
    assert!(katze.get("antreff_lat").is_none(), "{katze}");
    let text = snap.daten["tiere"].to_string();
    assert!(!text.contains("Huber"), "{text}");
    assert!(!text.contains("bissig"), "{text}");

    // Für einen Beobachter ist das Modul ausgeblendet: das Feld kommt leer.
    let leser_id = benutzer_anlegen(&app, &admin, "leser4", "keine").await;
    rolle_setzen(&app, &admin, e, leser_id, "beobachter").await;
    let leser = login_cookie(&app, "leser4", "leser4pw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/tiere"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let pfad = format!("/api/einsaetze/{e}/lage-snapshots/{}", snap.id);
    let (s, dok) = anfrage(&app, "GET", &pfad, &leser, None).await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert_eq!(dok["daten"]["tiere"], json!([]), "{dok}");
    assert!(!dok.to_string().contains("Bello"), "{dok}");
    // Der Admin liest es weiter.
    let (_, dok) = anfrage(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(dok["daten"]["tiere"].as_array().unwrap().len(), 2, "{dok}");
}

// ---------- LFH-836: Zeichenbeschreibung freier Zeichen im Stand ----------

/// Ein neuer Stand friert `zeichen_spec` ein (eine Altzeile mit ihrer Hülle aus Migration 0192,
/// LLH-1160); ein Stand von vor LFH-836 — freie Zeichen nur mit Altfeldern, ohne `zeichen_spec` —
/// bleibt über die Route lesbar und kommt unverändert zurück. Den Altbestand übersetzt erst der
/// Client (design.md D5).
#[tokio::test]
async fn snapshot_traegt_zeichen_spec_und_alter_stand_bleibt_lesbar() {
    const DREHLEITER: &str = r#"{"v":1,"freestanding":{"kind":"pictogram","pictogram":"capability.rescue-aerial-ladder"}}"#;
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let benutzer_id: i64 =
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/freie-zeichen"),
        &admin,
        Some(
            &json!({"lat": 50.1, "lon": 8.6, "zeichen_spec": DREHLEITER, "label": "DLK"})
                .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v:?}");
    // Eine Altzeile, wie Migration 0192 sie hinterlässt.
    const HUELLE: &str = r#"{"v":1,"alt":{"grundzeichen":"person"}}"#;
    sqlx::query(
        "INSERT INTO freies_zeichen (einsatz_id, lat, lon, zeichen_spec, erstellt_von) \
         VALUES (?, 50.2, 8.7, ?, ?)",
    )
    .bind(e)
    .bind(HUELLE)
    .bind(benutzer_id)
    .execute(&pool)
    .await
    .unwrap();
    let (s, neu) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/lage-snapshots"),
        &admin,
        Some(r#"{"bezeichnung":"Neu"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{neu:?}");
    let zeichen = neu["daten"]["freie_zeichen"].as_array().unwrap();
    assert_eq!(zeichen.len(), 2, "{neu}");
    assert_eq!(zeichen[0]["zeichen_spec"], DREHLEITER);
    assert_eq!(zeichen[1]["zeichen_spec"], HUELLE);
    for z in zeichen {
        assert!(z.get("grundzeichen").is_none(), "{neu}");
    }

    // Wortlaut eines Stands vor LFH-836 (FreiesZeichenAnzeige ohne zeichen_spec).
    let alt_zeichen = json!([{
        "id": 7, "einsatz_id": e, "lat": 50.1, "lon": 8.6, "grundzeichen": "einheit",
        "organisation": "feuerwehr", "fachaufgabe": "brandbekaempfung", "symbol": null,
        "einheit": "zug", "funktion": null, "farbe": "#ff0000", "label": "A",
        "erstellt_von": benutzer_id, "erstellt_at": "2026-09-01 08:00:00",
        "geaendert_at": "2026-09-01 08:00:00"
    }]);
    let mut alt = neu["daten"].clone();
    alt["freie_zeichen"] = alt_zeichen.clone();
    let sid = repo::insert_roh(
        &pool,
        e,
        benutzer_id,
        Some("Alt"),
        None,
        "2026-09-01 08:00:00",
        &alt,
    )
    .await
    .unwrap();
    let (s, dok) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/lage-snapshots/{sid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{dok:?}");
    assert_eq!(
        dok["daten"]["freie_zeichen"], alt_zeichen,
        "unverändert lesbar"
    );
}
