//! HTTP-Integrationstests für Bereitstellungsraeume (LFH-14):
//! Lifecycle/Status, Belegung (Einheit + Fahrzeug), ETB-Texte,
//! Rechte-Matrix, Cross-Einsatz-404 und Read-only für abgeschlossene Einsätze.

use axum::http::StatusCode;
use serde_json::json;

mod common;
use common::{
    anfrage_json, benutzer_anlegen, einheit_bilden, einsatz_anlegen, login_cookie,
    objekt_ereignisse, rolle_setzen, setup_mit_pool, setup_mit_pool_und_live,
};

// ---------- Harness ----------

/// Legt einen BR an und versetzt ihn sofort auf aktiv.
async fn br_anlegen_und_aktivieren(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bez: &str,
) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume"),
        cookie,
        Some(&json!({"bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "anlegen: {v}");
    let br = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/status"),
        cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    br
}

/// Liest alle ETB-System-Einträge und gibt deren Inhalt zurück.
async fn etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (s, v) = anfrage_json(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    v.as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter(|e| e["typ"].as_str() == Some("system"))
        .map(|e| e["inhalt"].as_str().unwrap_or("").to_string())
        .collect()
}

// ============================== Tests ==============================

/// CRUD-Basis: anlegen → geplant; status aktiv → 200.
#[tokio::test]
async fn anlegen_liefert_geplant_und_keinen_etb() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Nord"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Anlegen: {v}");
    assert_eq!(v["status"], "geplant");
    assert_eq!(v["bezeichnung"], "BR Nord");

    // KEIN ETB-Eintrag beim Anlegen.
    let etb = etb_inhalte(&app, &cookie, eid).await;
    assert!(etb.is_empty(), "Kein ETB beim Anlegen: {etb:?}");
}

/// Status aktiv → ETB "in Betrieb genommen".
#[tokio::test]
async fn status_aktiv_schreibt_etb_in_betrieb_genommen() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Süd"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let br_id = v["id"].as_i64().unwrap();

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let etb = etb_inhalte(&app, &cookie, eid).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("BR Süd") && t.contains("Betrieb")),
        "ETB muss BR-Name + 'Betrieb' enthalten: {etb:?}"
    );
}

/// Ungültiger Übergang → 422.
#[tokio::test]
async fn ungueltiger_status_uebergang_ist_422() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Test").await;

    // aktiv → geplant ist kein erlaubter Übergang
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "geplant"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Detail-Response enthält einheiten + fahrzeuge der aktiven Belegungen.
#[tokio::test]
async fn crud_und_belegung_einheit_erscheint_in_detail() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Ost").await;

    // Einheit direkt per SQL anlegen
    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Belegung: Eintritt
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Belegung: {v}");
    assert_eq!(v["art"], "eintritt");

    // Detail zeigt die Einheit
    let (s, v) = anfrage_json(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let einheiten = v["einheiten"].as_array().unwrap();
    assert_eq!(einheiten.len(), 1, "Eine Einheit in Detail: {v}");
    assert_eq!(einheiten[0]["id"], einheit_id);
}

/// Austritt entfernt Einheit aus Detail.
#[tokio::test]
async fn austritt_entfernt_einheit_aus_detail() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Austritt").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '2. Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;

    anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "austritt"})),
    )
    .await;

    let (s, v) = anfrage_json(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let einheiten = v["einheiten"].as_array().unwrap();
    assert!(
        einheiten.is_empty(),
        "Nach Austritt keine Einheit mehr: {v}"
    );
}

/// Auflösen blockt bei aktiver Belegung → 409.
#[tokio::test]
async fn aufloesen_blockt_bei_belegung_409() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Block").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '3. Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// Fahrzeug MIT einheit_id → Belegung 409.
#[tokio::test]
async fn fahrzeug_mit_einheit_belegen_409() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Fz").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Einheit A') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let fz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
         VALUES (?, 'Florian 1/44', ?) RETURNING id",
    )
    .bind(eid)
    .bind(einheit_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "fahrzeug", "objekt_id": fz_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// Einheitenloses Fahrzeug → Belegung 201.
#[tokio::test]
async fn fahrzeug_ohne_einheit_belegung_201() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Fz2").await;

    let fz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) \
         VALUES (?, 'Florian 1/45') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "fahrzeug", "objekt_id": fz_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Fahrzeug-Belegung: {v}");

    // Detail zeigt Fahrzeug
    let (_, d) = anfrage_json(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        None,
    )
    .await;
    let fahrzeuge = d["fahrzeuge"].as_array().unwrap();
    assert_eq!(fahrzeuge.len(), 1);
    assert_eq!(fahrzeuge[0]["id"], fz_id);
}

/// Unbekannter objekt_typ → 400.
#[tokio::test]
async fn unbekannter_objekt_typ_400() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Val").await;

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "person", "objekt_id": 1, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

/// Geplanter BR akzeptiert keine Belegung → 422.
#[tokio::test]
async fn geplanter_br_akzeptiert_keine_belegung_422() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    // BR anlegen, aber NICHT aktivieren (bleibt geplant)
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Geplant"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let br_id = v["id"].as_i64().unwrap();

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Testzug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// ETB bei Inbetriebnahme + Belegung enthält BR-Bezeichnung.
#[tokio::test]
async fn etb_inbetriebnahme_und_belegung() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Alpha"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let br_id = v["id"].as_i64().unwrap();

    // Aktivieren → ETB
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/status"),
        &cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let etb_nach_aktiv = etb_inhalte(&app, &cookie, eid).await;
    assert!(
        etb_nach_aktiv.iter().any(|t| t.contains("BR Alpha")),
        "ETB fehlt BR-Name nach Aktivierung: {etb_nach_aktiv:?}"
    );

    // Einheit belegen → ETB
    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Alpha-Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let etb_nach_belegung = etb_inhalte(&app, &cookie, eid).await;
    assert!(
        etb_nach_belegung
            .iter()
            .any(|t| t.contains("Alpha-Zug") && t.contains("BR Alpha")),
        "ETB-Belegungs-Text fehlt Einheitenname + BR-Name: {etb_nach_belegung:?}"
    );
}

/// Stammfeld-PATCH schreibt KEINEN ETB.
#[tokio::test]
async fn patch_stammfelder_kein_etb() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Patch").await;

    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Patch Neu"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let etb = etb_inhalte(&app, &cookie, eid).await;
    // Einziger ETB sollte der Aktivierungs-Eintrag sein, kein PATCH-Eintrag.
    let patch_etb: Vec<_> = etb.iter().filter(|t| t.contains("Patch Neu")).collect();
    assert!(
        patch_etb.is_empty(),
        "PATCH soll keinen ETB schreiben: {etb:?}"
    );
}

/// Rechte-Matrix: Beobachter kann nicht schreiben → 403.
#[tokio::test]
async fn beobachter_kann_nicht_schreiben_403() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie_admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie_admin).await;

    // Beobachter-Benutzer anlegen
    let (s, v) = anfrage_json(
        &app,
        "POST",
        "/api/benutzer",
        &cookie_admin,
        Some(&json!({"anzeigename": "Beob", "benutzername": "beob", "passwort": "startpw12"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let beob_id = v["id"].as_i64().unwrap();

    // Mitgliedschaft als Beobachter
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/mitglieder/{beob_id}"),
        &cookie_admin,
        Some(&json!({"einsatz_rolle": "beobachter"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    common::zwang_aufheben("beob").await;
    let cookie_beob = login_cookie(&app, "beob", "startpw12").await;

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie_beob,
        Some(&json!({"bezeichnung": "BR Geheim"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

/// Fremder Einsatz → 404 (Org-Isolation).
#[tokio::test]
async fn fremder_einsatz_ist_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;

    let (s, _) = anfrage_json(
        &app,
        "GET",
        "/api/einsaetze/9999/bereitstellungsraeume",
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Abgeschlossener Einsatz: Schreib-Routen → 409.
#[tokio::test]
async fn abgeschlossener_einsatz_blockt_schreibrouten() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR AbgE").await;

    // Einsatz abschließen
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
         abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?",
    )
    .bind(eid)
    .execute(&pool)
    .await
    .unwrap();

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Neu"})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "Anlegen bei abgeschlossenem Einsatz"
    );

    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}"),
        &cookie,
        Some(&json!({"bezeichnung": "BR Geaendert"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "PATCH bei abgeschlossenem Einsatz");
}

/// Wechsel: Einheit von BR A nach BR B → 201, Detail B zeigt sie, A nicht.
#[tokio::test]
async fn wechsel_verschiebt_einheit_zwischen_br() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_a = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR A").await;
    let br_b = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR B").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Wechselzug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Eintritt in BR A
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_a}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    // Wechsel nach BR B
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_b}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "wechsel"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Wechsel nach BR B");

    // Detail B zeigt die Einheit
    let (_, vb) = anfrage_json(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_b}"),
        &cookie,
        None,
    )
    .await;
    let einheiten_b = vb["einheiten"].as_array().unwrap();
    assert_eq!(einheiten_b.len(), 1, "Einheit jetzt in BR B: {vb}");
    assert_eq!(einheiten_b[0]["id"], einheit_id);

    // Detail A zeigt sie nicht mehr
    let (_, va) = anfrage_json(
        &app,
        "GET",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_a}"),
        &cookie,
        None,
    )
    .await;
    assert!(
        va["einheiten"].as_array().unwrap().is_empty(),
        "Einheit nicht mehr in BR A: {va}"
    );
}

/// Belegung einer Einheit feuert ein `einheit`-SSE-Event (+ `bereitstellungsraum`),
/// damit die Kräfte-Ansicht live refetchen kann.
#[tokio::test]
async fn belegung_einheit_feuert_einheit_sse() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR SSE").await;

    let einheit_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'SSE-Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    // VOR der Belegung abonnieren, damit das Broadcast-Event ankommt.
    let mut rx = live.abonniere(eid);

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": einheit_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    // Alle gepufferten Events drainen und auf `einheit` mit objekt_id prüfen.
    let mut sah_einheit = false;
    while let Ok(n) = rx.try_recv() {
        if n.event.as_str() == "einheit" && n.data.contains(&einheit_id.to_string()) {
            sah_einheit = true;
        }
    }
    assert!(
        sah_einheit,
        "Belegung muss ein `einheit`-SSE-Event mit objekt_id feuern"
    );
}

/// Belegung eines Fahrzeugs feuert ein `fahrzeug`-SSE-Event.
#[tokio::test]
async fn belegung_fahrzeug_feuert_fahrzeug_sse() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR SSE Fz").await;

    let fz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) \
         VALUES (?, 'Florian 9/99') RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    let mut rx = live.abonniere(eid);

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "fahrzeug", "objekt_id": fz_id, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let mut sah_fahrzeug = false;
    while let Ok(n) = rx.try_recv() {
        if n.event.as_str() == "fahrzeug" && n.data.contains(&fz_id.to_string()) {
            sah_fahrzeug = true;
        }
    }
    assert!(
        sah_fahrzeug,
        "Belegung muss ein `fahrzeug`-SSE-Event mit objekt_id feuern"
    );
}

/// Belegung mit nicht existierendem objekt_id → 404.
#[tokio::test]
async fn belegung_unbekanntes_objekt_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_id = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR NF").await;

    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume/{br_id}/belegung"),
        &cookie,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": 99999, "art": "eintritt"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Legt einen Einsatzabschnitt an.
async fn abschnitt_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&json!({"name": name})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt: {v}");
    v["id"].as_i64().unwrap()
}

/// LFH-735: der Fremdschlüssel allein lässt den Abschnitt eines anderen Einsatzes zu. Anlage
/// und PATCH prüfen ihn wie bei den Einheiten (`einheit::repo`) → 404, nichts geschrieben.
#[tokio::test]
async fn abschnitt_eines_fremden_einsatzes_ist_404() {
    let (app, _) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &cookie).await;
    let fremder_einsatz = einsatz_anlegen(&app, &cookie).await;
    let eigener = abschnitt_anlegen(&app, &cookie, einsatz, "Nord").await;
    let fremder = abschnitt_anlegen(&app, &cookie, fremder_einsatz, "Fremd").await;
    let pfad = format!("/api/einsaetze/{einsatz}/bereitstellungsraeume");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &pfad,
        &cookie,
        Some(&json!({"bezeichnung": "BR X", "abschnitt_id": fremder})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::NOT_FOUND,
        "Anlage mit fremdem Abschnitt: {v}"
    );
    let (_, liste) = anfrage_json(&app, "GET", &pfad, &cookie, None).await;
    assert_eq!(
        liste.as_array().unwrap().len(),
        0,
        "nichts angelegt: {liste}"
    );

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &pfad,
        &cookie,
        Some(&json!({"bezeichnung": "BR N", "abschnitt_id": eigener})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "eigener Abschnitt geht: {v}");
    let br = v["id"].as_i64().unwrap();

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("{pfad}/{br}"),
        &cookie,
        Some(&json!({"abschnitt_id": fremder})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "PATCH mit fremdem Abschnitt: {v}");
    let (_, v) = anfrage_json(&app, "GET", &format!("{pfad}/{br}"), &cookie, None).await;
    assert_eq!(v["abschnitt_id"], eigener, "Abschnitt unverändert: {v}");
}

// ============================== LLH-1095 ==============================
// Wartezeiten, Fahrzeuge der Einheiten, Kennzahlen, Verlauf und Live-Wege (Spec
// `bereitstellungsraum-belegung`).

async fn belegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    br: i64,
    typ: &str,
    objekt: i64,
    art: &str,
) -> serde_json::Value {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}/belegung"),
        cookie,
        Some(&json!({"objekt_typ": typ, "objekt_id": objekt, "art": art})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{typ} {objekt} {art}: {v}");
    v
}

/// Disponiert ein Ad-hoc-Fahrzeug und ordnet es optional einer Einheit zu.
async fn adhoc_fahrzeug(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    funkrufname: &str,
    einheit: Option<i64>,
) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        cookie,
        Some(&json!({"adhoc": {"funkrufname": funkrufname}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ef = v["id"].as_i64().unwrap();
    if let Some(e) = einheit {
        let (s, v) = anfrage_json(
            app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{e}/fahrzeug/{ef}"),
            cookie,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    }
    ef
}

async fn fetch_json(app: &axum::Router, cookie: &str, pfad: &str) -> serde_json::Value {
    let (s, v) = anfrage_json(app, "GET", pfad, cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v
}

fn br_pfad(einsatz: i64, br: i64) -> String {
    format!("/api/einsaetze/{einsatz}/bereitstellungsraeume/{br}")
}

/// Akzeptanzkriterium LLH-1095: zwei Einheiten mit je einem Fahrzeug und ein Fahrzeug ohne
/// Einheit ergeben „Fahrzeuge 3“; die Funkrufnamen stehen an ihrer Einheit, das einheitenlose
/// Fahrzeug unter `fahrzeuge`, jede Kraft mit „seit“.
#[tokio::test]
async fn detail_zaehlt_fahrzeuge_der_einheiten() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Sportplatz").await;
    let zug1 = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    let zug2 = einheit_bilden(&app, &cookie, eid, "2. Zug").await;
    adhoc_fahrzeug(&app, &cookie, eid, "Florian 1/44-1", Some(zug1)).await;
    adhoc_fahrzeug(&app, &cookie, eid, "Florian 1/44-2", Some(zug2)).await;
    let einzeln = adhoc_fahrzeug(&app, &cookie, eid, "Florian 1/83-1", None).await;
    for zug in [zug1, zug2] {
        belegen(&app, &cookie, eid, br, "einheit", zug, "eintritt").await;
    }
    belegen(&app, &cookie, eid, br, "fahrzeug", einzeln, "eintritt").await;

    let v = fetch_json(&app, &cookie, &br_pfad(eid, br)).await;
    assert_eq!(v["belegung"]["fahrzeuge"], 3, "{v}");
    assert_eq!(v["belegung"]["einheiten"], 2, "{v}");
    assert!(v["belegung"]["laengste_seit_at"].is_string(), "{v}");
    let einheiten = v["einheiten"].as_array().unwrap();
    for (zug, funkrufname) in [(zug1, "Florian 1/44-1"), (zug2, "Florian 1/44-2")] {
        let e = einheiten.iter().find(|e| e["id"] == zug).unwrap();
        assert_eq!(
            e["fahrzeuge"],
            json!([{"id": e["fahrzeuge"][0]["id"], "funkrufname": funkrufname}])
        );
        assert!(e["seit_at"].is_string(), "{e}");
    }
    let fahrzeuge = v["fahrzeuge"].as_array().unwrap();
    assert_eq!(fahrzeuge.len(), 1, "{v}");
    assert_eq!(fahrzeuge[0]["id"], einzeln);
    assert_eq!(fahrzeuge[0]["funkrufname"], "Florian 1/83-1");
    assert!(fahrzeuge[0]["seit_at"].is_string(), "{v}");
}

/// „Seit“ in B nach einem Wechsel A → B ist der Zeitpunkt des Wechsels, nicht des Eintritts.
#[tokio::test]
async fn seit_nach_wechsel_ist_der_wechsel() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_a = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR A").await;
    let br_b = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR B").await;
    let zug = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    let eintritt = belegen(&app, &cookie, eid, br_a, "einheit", zug, "eintritt").await;
    // Der Eintritt liegt sichtbar früher (die Tabelle löst nur Sekunden auf).
    sqlx::query("UPDATE br_belegung SET zeitpunkt_at = '2026-05-28 11:42:00' WHERE id = ?")
        .bind(eintritt["id"].as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let wechsel = belegen(&app, &cookie, eid, br_b, "einheit", zug, "wechsel").await;

    let v = fetch_json(&app, &cookie, &br_pfad(eid, br_b)).await;
    assert_eq!(v["einheiten"][0]["seit_at"], wechsel["zeitpunkt_at"], "{v}");
    assert_ne!(v["einheiten"][0]["seit_at"], "2026-05-28 11:42:00");
    assert_eq!(v["belegung"]["laengste_seit_at"], wechsel["zeitpunkt_at"]);
    let a = fetch_json(&app, &cookie, &br_pfad(eid, br_a)).await;
    assert_eq!(
        a["belegung"],
        json!({"einheiten": 0, "fahrzeuge": 0}),
        "{a}"
    );
}

/// Liste und Detail tragen je Raum dieselben Kennzahlen; `einheit_ids` sind die Einheiten des
/// Details, `abschnitt_name` der Name des Abschnitts.
#[tokio::test]
async fn liste_traegt_dieselben_kennzahlen_wie_detail() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let nord = abschnitt_anlegen(&app, &cookie, eid, "Nord").await;
    let sportplatz = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Sportplatz").await;
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &br_pfad(eid, sportplatz),
        &cookie,
        Some(&json!({"abschnitt_id": nord})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let schule = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Schule").await;
    let leer = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Leer").await;
    let zug1 = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    let zug2 = einheit_bilden(&app, &cookie, eid, "2. Zug").await;
    let zug3 = einheit_bilden(&app, &cookie, eid, "3. Zug").await;
    adhoc_fahrzeug(&app, &cookie, eid, "Florian 1", Some(zug1)).await;
    adhoc_fahrzeug(&app, &cookie, eid, "Florian 2", Some(zug2)).await;
    let einzeln = adhoc_fahrzeug(&app, &cookie, eid, "Florian 3", None).await;
    belegen(&app, &cookie, eid, sportplatz, "einheit", zug1, "eintritt").await;
    belegen(&app, &cookie, eid, sportplatz, "einheit", zug2, "eintritt").await;
    belegen(
        &app, &cookie, eid, sportplatz, "fahrzeug", einzeln, "eintritt",
    )
    .await;
    belegen(&app, &cookie, eid, schule, "einheit", zug3, "eintritt").await;

    let liste = fetch_json(
        &app,
        &cookie,
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
    )
    .await;
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 3, "{liste:?}");
    for br in [sportplatz, schule, leer] {
        let zeile = liste.iter().find(|z| z["id"] == br).unwrap();
        let detail = fetch_json(&app, &cookie, &br_pfad(eid, br)).await;
        assert_eq!(zeile["belegung"], detail["belegung"], "Raum {br}");
        let mut im_detail: Vec<i64> = detail["einheiten"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_i64().unwrap())
            .collect();
        im_detail.sort_unstable();
        let mut in_liste: Vec<i64> = zeile["einheit_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_i64().unwrap())
            .collect();
        in_liste.sort_unstable();
        assert_eq!(in_liste, im_detail, "Raum {br}");
        // Die Raumdaten bleiben an derselben Stelle (flatten).
        assert_eq!(zeile["bezeichnung"], detail["bezeichnung"]);
    }
    let zeile = liste.iter().find(|z| z["id"] == sportplatz).unwrap();
    assert_eq!(zeile["abschnitt_name"], "Nord");
    assert_eq!(zeile["belegung"]["fahrzeuge"], 3);
    assert_eq!(zeile["belegung"]["einheiten"], 2);
    let zeile = liste.iter().find(|z| z["id"] == leer).unwrap();
    assert!(zeile.get("abschnitt_name").is_none(), "{zeile}");
    assert_eq!(zeile["belegung"], json!({"einheiten": 0, "fahrzeuge": 0}));
    assert_eq!(zeile["einheit_ids"], json!([]));
}

/// Verlauf: Eintritt, Wechsel (hinaus mit Ziel, herein mit Herkunft), Austritt mit Notiz und das
/// Auflösen einer Einheit im Raum, neueste zuerst.
#[tokio::test]
async fn verlauf_zeigt_austritte_und_wechsel() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let sportplatz = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Sportplatz").await;
    let schule = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Schule").await;
    let zug = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    let staffel = einheit_bilden(&app, &cookie, eid, "Staffel").await;
    belegen(&app, &cookie, eid, sportplatz, "einheit", zug, "eintritt").await;
    belegen(&app, &cookie, eid, schule, "einheit", zug, "wechsel").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{}/belegung", br_pfad(eid, schule)),
        &cookie,
        Some(
            &json!({"objekt_typ": "einheit", "objekt_id": zug, "art": "austritt",
                     "notiz": "zum Einsatzort"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    belegen(
        &app, &cookie, eid, sportplatz, "einheit", staffel, "eintritt",
    )
    .await;
    let (s, _) = anfrage_json(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{eid}/einheiten/{staffel}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    // Fehlende optionale Felder stehen gar nicht im JSON (`skip_serializing_if`): `get` liefert
    // dann `None`, ein serialisiertes `null` dagegen `Some(Null)` (src/AGENTS.md, „Optionalität
    // ehrlich machen“).
    type Zeile = (
        serde_json::Value,
        serde_json::Value,
        Option<serde_json::Value>,
        Option<serde_json::Value>,
        Option<serde_json::Value>,
    );
    let kurz = |v: &serde_json::Value| -> Vec<Zeile> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|e| {
                (
                    e["art"].clone(),
                    e["objekt_name"].clone(),
                    e.get("herkunft").cloned(),
                    e.get("ziel").cloned(),
                    e.get("notiz").cloned(),
                )
            })
            .collect()
    };
    let z = |art: &str,
             name: &str,
             herkunft: Option<&str>,
             ziel: Option<&str>,
             notiz: Option<&str>|
     -> Zeile {
        (
            json!(art),
            json!(name),
            herkunft.map(|t| json!(t)),
            ziel.map(|t| json!(t)),
            notiz.map(|t| json!(t)),
        )
    };
    let a = fetch_json(
        &app,
        &cookie,
        &format!("{}/verlauf", br_pfad(eid, sportplatz)),
    )
    .await;
    assert_eq!(
        kurz(&a),
        vec![
            z("austritt", "Staffel", None, None, Some("Einheit aufgelöst")),
            z("eintritt", "Staffel", None, None, None),
            z("wechsel_hinaus", "1. Zug", None, Some("BR Schule"), None),
            z("eintritt", "1. Zug", None, None, None),
        ],
        "{a}"
    );
    assert_eq!(a[0]["objekt_typ"], "einheit");
    assert_eq!(a[0]["objekt_id"], staffel);
    assert!(a[0]["zeitpunkt_at"].is_string());
    let b = fetch_json(&app, &cookie, &format!("{}/verlauf", br_pfad(eid, schule))).await;
    assert_eq!(
        kurz(&b),
        vec![
            z("austritt", "1. Zug", None, None, Some("zum Einsatzort")),
            z(
                "wechsel_herein",
                "1. Zug",
                Some("BR Sportplatz"),
                None,
                None
            ),
        ],
        "{b}"
    );
}

/// Der Raum eines anderen Einsatzes und ein unbekannter Raum antworten 404.
#[tokio::test]
async fn verlauf_fremder_einsatz_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let anderer = einsatz_anlegen(&app, &cookie).await;
    let fremd = br_anlegen_und_aktivieren(&app, &cookie, anderer, "BR Fremd").await;
    let (s, _) = anfrage_json(
        &app,
        "GET",
        &format!("{}/verlauf", br_pfad(eid, fremd)),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn verlauf_unbekannter_raum_404() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let (s, _) = anfrage_json(
        &app,
        "GET",
        &format!("{}/verlauf", br_pfad(eid, 99_999)),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

/// Lesen ist kein Lebenszyklus-Vorgang: auch ein stornierter Raum liefert seine Reihe.
#[tokio::test]
async fn verlauf_stornierter_raum_liefert() {
    let (app, _pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Storno").await;
    let zug = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    belegen(&app, &cookie, eid, br, "einheit", zug, "eintritt").await;
    belegen(&app, &cookie, eid, br, "einheit", zug, "austritt").await;
    let (s, _) = anfrage_json(&app, "DELETE", &br_pfad(eid, br), &cookie, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    let v = fetch_json(&app, &cookie, &format!("{}/verlauf", br_pfad(eid, br))).await;
    assert_eq!(v.as_array().unwrap().len(), 2, "{v}");
}

/// Ein Beobachter (ohne Schreibrecht) liest den Verlauf.
#[tokio::test]
async fn beobachter_liest_verlauf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let br = br_anlegen_und_aktivieren(&app, &admin, eid, "BR Lesen").await;
    let zug = einheit_bilden(&app, &admin, eid, "1. Zug").await;
    belegen(&app, &admin, eid, br, "einheit", zug, "eintritt").await;
    let beob = benutzer_anlegen(&app, &admin, "berta", "keine").await;
    rolle_setzen(&app, &admin, eid, beob, "beobachter").await;
    let beob = login_cookie(&app, "berta", "bertapw1").await;

    let v = fetch_json(&app, &beob, &format!("{}/verlauf", br_pfad(eid, br))).await;
    assert_eq!(v[0]["art"], "eintritt", "{v}");
}

/// Ist das Modul ausgeblendet, bekommt ein Nicht-Admin 403, der Admin liest weiter.
#[tokio::test]
async fn verlauf_modul_ausgeblendet_403() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let br = br_anlegen_und_aktivieren(&app, &admin, eid, "BR Versteckt").await;
    let frieda = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, eid, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let pfad = format!("{}/verlauf", br_pfad(eid, br));
    fetch_json(&app, &frieda, &pfad).await;

    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/modul-overrides/bereitstellungsraeume"),
        &admin,
        Some(&json!({"sichtbar": false, "benoetigte_rolle": null})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = anfrage_json(&app, "GET", &pfad, &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    fetch_json(&app, &admin, &pfad).await;
}

const BR_EREIGNIS: &[(&str, &str)] = &[("bereitstellungsraum", "br_id")];

fn br_ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>,
) -> Vec<i64> {
    let mut ids: Vec<i64> = objekt_ereignisse(rx, BR_EREIGNIS)
        .into_iter()
        .map(|(_, id)| id)
        .collect();
    ids.sort_unstable();
    ids
}

/// Zuordnen eines Fahrzeugs an eine Einheit im Raum meldet den Raum; dieselbe Einheit noch
/// einmal meldet nichts; eine Einheit in keinem Raum meldet keinen Raum.
#[tokio::test]
async fn fahrzeug_zuordnen_meldet_den_raum_der_einheit() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Live").await;
    let zug = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    let draussen = einheit_bilden(&app, &cookie, eid, "Draußen").await;
    belegen(&app, &cookie, eid, br, "einheit", zug, "eintritt").await;
    let fz = adhoc_fahrzeug(&app, &cookie, eid, "Florian 1", None).await;
    let fz2 = adhoc_fahrzeug(&app, &cookie, eid, "Florian 2", None).await;
    let zuordnen =
        |einheit: i64, ef: i64| format!("/api/einsaetze/{eid}/einheiten/{einheit}/fahrzeug/{ef}");

    let mut rx = live.abonniere(eid);
    let (s, _) = anfrage_json(&app, "PUT", &zuordnen(zug, fz), &cookie, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(br_ereignisse(&mut rx), vec![br], "Zuordnen meldet den Raum");

    let (s, _) = anfrage_json(&app, "PUT", &zuordnen(zug, fz), &cookie, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        br_ereignisse(&mut rx),
        Vec::<i64>::new(),
        "dieselbe Einheit"
    );

    let (s, _) = anfrage_json(&app, "PUT", &zuordnen(draussen, fz2), &cookie, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        br_ereignisse(&mut rx),
        Vec::<i64>::new(),
        "Einheit ohne Raum"
    );
}

/// Umhängen zwischen zwei Einheiten in zwei Räumen meldet beide Räume.
#[tokio::test]
async fn umhaengen_meldet_beide_raeume() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br_a = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR A").await;
    let br_b = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR B").await;
    let zug1 = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    let zug2 = einheit_bilden(&app, &cookie, eid, "2. Zug").await;
    belegen(&app, &cookie, eid, br_a, "einheit", zug1, "eintritt").await;
    belegen(&app, &cookie, eid, br_b, "einheit", zug2, "eintritt").await;
    let fz = adhoc_fahrzeug(&app, &cookie, eid, "Florian 1", Some(zug1)).await;

    let mut rx = live.abonniere(eid);
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/einheiten/{zug2}/fahrzeug/{fz}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let mut erwartet = vec![br_a, br_b];
    erwartet.sort_unstable();
    assert_eq!(br_ereignisse(&mut rx), erwartet);
}

/// Freigeben, Umbenennen der Einheit, Funkrufname eines Ad-hoc-Fahrzeugs der Einheit und
/// Entlassen melden den Raum der Einheit, je einmal; ein PATCH ohne Namensänderung nicht.
#[tokio::test]
async fn weitere_wege_melden_den_raum_der_einheit() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Live").await;
    let zug = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    belegen(&app, &cookie, eid, br, "einheit", zug, "eintritt").await;
    let fz1 = adhoc_fahrzeug(&app, &cookie, eid, "Florian 1", Some(zug)).await;
    let fz2 = adhoc_fahrzeug(&app, &cookie, eid, "Florian 2", Some(zug)).await;
    let mut rx = live.abonniere(eid);

    let (s, _) = anfrage_json(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{eid}/einheiten/{zug}/fahrzeug/{fz1}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(br_ereignisse(&mut rx), vec![br], "Freigeben");

    let einheit = format!("/api/einsaetze/{eid}/einheiten/{zug}");
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &einheit,
        &cookie,
        Some(&json!({"name": "1. Zug Nord"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(br_ereignisse(&mut rx), vec![br], "Umbenennen");
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &einheit,
        &cookie,
        Some(&json!({"bemerkung": "Bereitschaft"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        br_ereignisse(&mut rx),
        Vec::<i64>::new(),
        "ohne Namensänderung"
    );

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{eid}/fahrzeuge/{fz2}"),
        &cookie,
        Some(&json!({"funkrufname": "Florian 2 neu"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(br_ereignisse(&mut rx), vec![br], "Funkrufname");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/fahrzeuge/{fz2}/entlassen"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(br_ereignisse(&mut rx), vec![br], "Entlassen");
}

/// Bilden aus einer Vorlage, das ein Fahrzeug aus einer Einheit im Raum umhängt, meldet den Raum.
#[tokio::test]
async fn aus_vorlage_umhaengen_meldet_den_raum() {
    use lifeline_hub::einheit_vorlage::repo::{self as vrepo, NewVorlage};

    let (app, pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let typ: i64 =
        sqlx::query_scalar("SELECT id FROM einheit_typ WHERE org_id = ? AND label = 'Zug'")
            .bind(org)
            .fetch_one(&pool)
            .await
            .unwrap();
    let stamm: i64 = sqlx::query_scalar(
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (?, 'RTW 1') RETURNING id",
    )
    .bind(org)
    .fetch_one(&pool)
    .await
    .unwrap();
    let vorlage = vrepo::create(
        &pool,
        org,
        NewVorlage {
            name: "Sanitätszug",
            typ_id: typ,
            ueber_vorlage_id: None,
            funkrufname: None,
            tz_fachaufgabe: None,
            tz_organisation: None,
            soll: None,
            bemerkung: None,
            sortier: 0,
        },
    )
    .await
    .unwrap()
    .id;
    vrepo::replace_fahrzeuge(&pool, org, vorlage, &[stamm])
        .await
        .unwrap();
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Vorlage").await;
    let alt = einheit_bilden(&app, &cookie, eid, "Alter Zug").await;
    belegen(&app, &cookie, eid, br, "einheit", alt, "eintritt").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/fahrzeuge"),
        &cookie,
        Some(&json!({"fahrzeug_id": stamm})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ef = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/einheiten/{alt}/fahrzeug/{ef}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    let mut rx = live.abonniere(eid);
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/einheiten/aus-vorlage"),
        &cookie,
        Some(&json!({"vorlage_id": vorlage,
                     "fahrzeuge": [{"fahrzeug_id": stamm, "umhaengen": true}]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(br_ereignisse(&mut rx), vec![br]);
    let d = fetch_json(&app, &cookie, &br_pfad(eid, br)).await;
    assert_eq!(d["belegung"]["fahrzeuge"], 0, "{d}");
}

/// Sammel-Disposition an eine Einheit im Raum meldet den Raum (design.md D7): das Fahrzeug steht
/// danach unter der Einheit, und „Fahrzeuge“ zählt es mit.
#[tokio::test]
async fn sammel_disposition_an_einheit_meldet_den_raum() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        "/api/fahrzeuge",
        &cookie,
        Some(&json!({"funkrufname": "RTW 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let stamm = v["id"].as_i64().unwrap();
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "BR Sammel").await;
    let zug = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    belegen(&app, &cookie, eid, br, "einheit", zug, "eintritt").await;

    let mut rx = live.abonniere(eid);
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/fahrzeuge/sammel"),
        &cookie,
        Some(&json!({"fahrzeug_ids": [stamm], "einheit_id": zug})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(br_ereignisse(&mut rx), vec![br], "Sammel-Disposition");
    let d = fetch_json(&app, &cookie, &br_pfad(eid, br)).await;
    assert_eq!(d["belegung"]["fahrzeuge"], 1, "{d}");
    assert_eq!(
        d["einheiten"][0]["fahrzeuge"][0]["funkrufname"], "RTW 1",
        "{d}"
    );
}
