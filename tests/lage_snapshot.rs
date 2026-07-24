//! Integrationstests für Lage-Snapshots (LFH-321, Inkrement C).
//! Task 1: Persistenz — Metadaten-Liste (ohne `daten`), Volldokument, Einsatz-Scoping.
//! Task 2: Capture `erzeuge` — Einfrieren des vollen Lagebilds (Immutabilität, Vollständigkeit).

use axum::http::StatusCode;
use lifeline_hub::einheit::repo::{self as einheit_repo, EinheitDaten, EinheitPatch};
use lifeline_hub::lage_snapshot::repo;
use serde_json::json;
use sqlx::SqlitePool;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool};

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
    let benutzer_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
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
async fn seed_einheit(pool: &SqlitePool, einsatz_id: i64, org_id: i64, benutzer_id: i64, name: &str) -> i64 {
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
            kommunikationsmittel: None,
            erreichbarkeit: None,
            sortier: 0,
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
    assert!(repo::lade_dokument(&pool, fremd, id).await.unwrap().is_none());
    assert!(!repo::loesche(&pool, fremd, id).await.unwrap());

    // Der eigene Einsatz schon.
    assert!(repo::lade_dokument(&pool, einsatz_id, id).await.unwrap().is_some());
    assert!(repo::loesche(&pool, einsatz_id, id).await.unwrap());
    assert!(repo::liste_metadaten(&pool, einsatz_id).await.unwrap().is_empty());
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
            kommunikationsmittel: None,
            erreichbarkeit: None,
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

// ---------- Task 3: HTTP-Routen ----------

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
    assert!(v["daten"].is_object(), "POST-Antwort ist das Volldokument: {v}");

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
    assert_eq!(patched["bezeichnung"], "Neu", "nur Metadaten sind schreibbar");
    assert_eq!(patched["daten"], daten_vorher, "daten muss unveränderlich sein");
    assert_eq!(patched["stand_at"], stand_vorher, "stand_at muss unveränderlich sein");
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
