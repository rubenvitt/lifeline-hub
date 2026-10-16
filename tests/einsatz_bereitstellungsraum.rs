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

// ============================== Eintreffen (LLH-1075) ==============================

fn eintreffen_pfad(einsatz: i64, br: i64) -> String {
    format!("{}/eintreffen", br_pfad(einsatz, br))
}

async fn eintreffen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    br: i64,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage_json(
        app,
        "POST",
        &eintreffen_pfad(einsatz, br),
        cookie,
        Some(&body),
    )
    .await
}

fn unangemeldet_body(funkrufname: &str) -> serde_json::Value {
    json!({"unangemeldet": {"fahrzeuge": [{"funkrufname": funkrufname}]}})
}

/// (Belegungen, Zeitachsen-Ereignisse, ETB-Einträge, Einheiten, Fahrzeuge, Meldungen)
async fn bestand(pool: &sqlx::SqlitePool, e: i64) -> [i64; 6] {
    let mut z = [0; 6];
    for (i, t) in [
        "br_belegung",
        "einsatz_kraft_zeitachse",
        "etb_eintrag",
        "einsatz_einheit",
        "einsatz_fahrzeug",
        "meldung",
    ]
    .iter()
    .enumerate()
    {
        z[i] = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {t} WHERE einsatz_id = ?"
        )))
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
    }
    z
}

fn differenz(nachher: [i64; 6], vorher: [i64; 6]) -> [i64; 6] {
    let mut d = [0; 6];
    for i in 0..6 {
        d[i] = nachher[i] - vorher[i];
    }
    d
}

async fn set_auto_etb(pool: &sqlx::SqlitePool, e: i64, an: bool) {
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, auto_etb_eintraege) VALUES (?, ?) \
         ON CONFLICT(einsatz_id) DO UPDATE SET auto_etb_eintraege = excluded.auto_etb_eintraege",
    )
    .bind(e)
    .bind(i64::from(an))
    .execute(pool)
    .await
    .unwrap();
}

async fn admin_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Spec „Erwartete Einheit trifft ein“: Eintritt, Eintreffen mit Quelle `bereitstellungsraum`,
/// genau ein ETB „… im BR … eingetroffen“; ein zweites Eintreffen nach Austritt wird ausgelassen.
#[tokio::test]
async fn eintreffen_bekannte_einheit_und_zweites_ausgelassen() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let einheit = einheit_bilden(&app, &cookie, eid, "HLF 20 FF Musterstadt").await;
    let vorher = bestand(&pool, eid).await;

    let (s, v) = eintreffen(
        &app,
        &cookie,
        eid,
        br,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["zeitachse"], "geschrieben");
    assert_eq!(v["einheit_id"], einheit);
    assert_eq!(v["unangemeldet"], false);
    assert!(v.get("meldung_id").is_none(), "{v}");
    assert_eq!(v["belegung"]["br_id"], br);
    assert_eq!(
        differenz(bestand(&pool, eid).await, vorher),
        [1, 1, 1, 0, 0, 0]
    );
    assert!(etb_inhalte(&app, &cookie, eid)
        .await
        .contains(&"HLF 20 FF Musterstadt im BR Sportplatz eingetroffen".to_string()));
    let quelle: String = sqlx::query_scalar(
        "SELECT quelle FROM einsatz_kraft_zeitachse WHERE einheit_id = ? AND art = 'eintreffen'",
    )
    .bind(einheit)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(quelle, "bereitstellungsraum");

    // Schon in einem Raum → 409, nichts geschrieben.
    let schule = br_anlegen_und_aktivieren(&app, &cookie, eid, "Schule").await;
    let vorher = bestand(&pool, eid).await;
    let (s, _) = eintreffen(
        &app,
        &cookie,
        eid,
        schule,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(bestand(&pool, eid).await, vorher);

    // Nach dem Austritt: Eintritt gelingt, Eintreffen ausgelassen, ETB nennt den Eintritt.
    belegen(&app, &cookie, eid, br, "einheit", einheit, "austritt").await;
    let (s, v) = eintreffen(
        &app,
        &cookie,
        eid,
        schule,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["zeitachse"], "ausgelassen");
    let etb = etb_inhalte(&app, &cookie, eid).await;
    assert!(
        etb.contains(&"HLF 20 FF Musterstadt tritt in Bereitstellungsraum Schule ein".to_string()),
        "{etb:?}"
    );
    assert_eq!(
        etb.iter().filter(|t| t.contains("eingetroffen")).count(),
        1,
        "{etb:?}"
    );
}

/// Körper: weder Kraft noch unangemeldet 400, beides 422, Fremd-Einsatz 404.
#[tokio::test]
async fn eintreffen_koerper_und_fremde_kraft() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let andere = common::einsatz_anlegen_mit(&app, &cookie, "Andere Lage").await;
    let fremde = einheit_bilden(&app, &cookie, andere, "Fremd").await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let vorher = bestand(&pool, eid).await;

    let (s, _) = eintreffen(&app, &cookie, eid, br, json!({})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let mut beides = unangemeldet_body("FL 1");
    beides["kraft"] = json!({"objekt_typ": "einheit", "objekt_id": fremde});
    let (s, _) = eintreffen(&app, &cookie, eid, br, beides).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = eintreffen(
        &app,
        &cookie,
        eid,
        br,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": fremde}}),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = eintreffen(&app, &cookie, eid, br, unangemeldet_body(&"x".repeat(201))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Funkrufname 201 Zeichen");
    assert_eq!(bestand(&pool, eid).await, vorher);
}

/// D5: genau ein ETB-Eintrag je unangemeldeter Buchung — mit Auto-ETB der Eintrag der Meldung,
/// ohne ein Systemeintrag mit ihrem Inhalt.
#[tokio::test]
async fn eintreffen_unangemeldet_ein_etb_eintrag_in_beiden_einstellungen() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;

    for (an, funkrufname) in [(true, "FL-MUS 1-44-1"), (false, "FL-MUS 1-19-1")] {
        set_auto_etb(&pool, eid, an).await;
        let vorher = bestand(&pool, eid).await;
        let system_vorher = etb_inhalte(&app, &cookie, eid).await.len();
        let (s, v) = eintreffen(
            &app,
            &cookie,
            eid,
            br,
            json!({"unangemeldet": {
                "fahrzeuge": [{"funkrufname": funkrufname, "fahrzeugtyp": "HLF 20",
                               "traegerorganisation": "FF Musterstadt"}],
                "staerke": {"fuehrer": 1, "unterfuehrer": 1, "mannschaft": 7},
                "bemerkung": "nur intern"
            }}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        assert_eq!(v["unangemeldet"], true);
        assert!(v["meldung_id"].as_i64().is_some(), "{v}");
        assert_eq!(v["fahrzeug_ids"].as_array().unwrap().len(), 1);
        assert_eq!(
            differenz(bestand(&pool, eid).await, vorher),
            [1, 1, 1, 1, 1, 1],
            "Auto-ETB {an}"
        );
        let system = etb_inhalte(&app, &cookie, eid).await;
        assert_eq!(
            system.len(),
            system_vorher + usize::from(!an),
            "Auto-ETB {an}"
        );
        let letzter: String = sqlx::query_scalar(
            "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(
            letzter.contains("unangemeldet") && letzter.contains("1/1/7"),
            "{letzter}"
        );
        assert!(!letzter.contains("nur intern"), "{letzter}");
    }
}

/// D8: Replay mit derselben `client_id` liefert dieselbe Einheit, legt nichts an und meldet die
/// Einsatzleitung nicht doppelt; nach Auflösen des Raums und nach Einsatzabschluss weiter 201.
#[tokio::test]
async fn eintreffen_replay_nach_aufloesen_und_abschluss() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let schule = br_anlegen_und_aktivieren(&app, &cookie, eid, "Schule").await;
    let mut body = unangemeldet_body("FL-MUS 1-44-1");
    body["client_id"] = json!("a1");

    let (s, erst) = eintreffen(&app, &cookie, eid, br, body.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "{erst}");
    let nach_erst = bestand(&pool, eid).await;
    let (s, zweit) = eintreffen(&app, &cookie, eid, br, body.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "{zweit}");
    assert_eq!(zweit, erst, "Replay liefert dasselbe Ergebnis");
    assert_eq!(bestand(&pool, eid).await, nach_erst);

    // Dieselbe client_id an einem anderen Raum → 422.
    let (s, _) = eintreffen(&app, &cookie, eid, schule, body.clone()).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    // Raum aufgelöst: Replay weiter 201.
    sqlx::query("UPDATE bereitstellungsraum SET status = 'aufgeloest' WHERE id = ?")
        .bind(br)
        .execute(&pool)
        .await
        .unwrap();
    let (s, dritt) = eintreffen(&app, &cookie, eid, br, body.clone()).await;
    assert_eq!(s, StatusCode::CREATED, "{dritt}");
    assert_eq!(dritt["einheit_id"], erst["einheit_id"]);

    // Einsatz abgeschlossen: Replay 201, neue Erfassung 409.
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
         abgeschlossen_at = strftime('%Y-%m-%d %H:%M:%S','now') WHERE id = ?",
    )
    .bind(eid)
    .execute(&pool)
    .await
    .unwrap();
    let (s, viert) = eintreffen(&app, &cookie, eid, br, body).await;
    assert_eq!(s, StatusCode::CREATED, "{viert}");
    assert_eq!(viert["einheit_id"], erst["einheit_id"]);
    let mut neu = unangemeldet_body("FL-MUS 1-19-1");
    neu["client_id"] = json!("a2");
    let (s, _) = eintreffen(&app, &cookie, eid, schule, neu.clone()).await;
    assert_eq!(s, StatusCode::CONFLICT);
    // Der Erfassungszeitpunkt ist eine Eingabegrenze (D2): 400 auch am abgeschlossenen Einsatz.
    neu["zeitpunkt_at"] = json!((chrono::Utc::now() + chrono::Duration::hours(2))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string());
    let (s, _) = eintreffen(&app, &cookie, eid, schule, neu).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Zeitpunkt vor dem Aktiv-Gate");
    assert_eq!(bestand(&pool, eid).await, nach_erst);
}

/// D8 Punkt 2, Rennen zweier Tabs: beide Anfragen verpassen den Vorab-Lookup, die zweite scheitert
/// in der Transaktion und liefert danach das Ergebnis der ersten (201), nicht ihren Fehler.
///
/// Hergestellt auf dem Datei-Pool (WAL): eine zweite Verbindung hält die Schreibsperre und hat
/// die Belegung des Gewinners schon eingefügt, aber nicht festgeschrieben. Die Anfrage liest
/// davon nichts (Vorab-Lookup leer) und wartet am `BEGIN IMMEDIATE`; erst dann wird der Gewinner
/// festgeschrieben, und ihre Transaktion trifft auf ihn (409 „schon im Raum“).
#[tokio::test]
async fn eintreffen_rennen_zweier_tabs_liefert_den_gewinner() {
    let (_dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, pool, _live) =
        common::setup_mit_optionen_auf(pool, lifeline_hub::app::RouterOptionen::default()).await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let einheit = einheit_bilden(&app, &cookie, eid, "HLF 20").await;
    let admin = admin_id(&pool).await;

    let mut gewinner_tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let gewinner: i64 = sqlx::query_scalar(
        "INSERT INTO br_belegung (einsatz_id, br_id, objekt_typ, objekt_id, art, erfasst_von, \
                                  client_id) \
         VALUES (?, ?, 'einheit', ?, 'eintritt', ?, 'rennen') RETURNING id",
    )
    .bind(eid)
    .bind(br)
    .bind(einheit)
    .bind(admin)
    .fetch_one(&mut *gewinner_tx)
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz_einheit SET aktueller_br_id = ? WHERE id = ?")
        .bind(br)
        .bind(einheit)
        .execute(&mut *gewinner_tx)
        .await
        .unwrap();

    let body = json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit},
                      "client_id": "rennen"});
    let anfrage = eintreffen(&app, &cookie, eid, br, body);
    tokio::pin!(anfrage);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut anfrage)
            .await
            .is_err(),
        "die Anfrage wartet an der Schreibsperre"
    );
    gewinner_tx.commit().await.unwrap();

    let (s, v) = anfrage.await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["belegung"]["id"], gewinner, "{v}");
    assert_eq!(v["einheit_id"], einheit);
    let zeilen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM br_belegung WHERE einsatz_id = ? AND client_id = 'rennen'",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen, 1);
}

/// D8: Grenzen der Offline-Felder und die Kopfzeile der Warteschlange.
#[tokio::test]
async fn eintreffen_offline_felder() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let einheit = einheit_bilden(&app, &cookie, eid, "HLF 20").await;
    let vorher = bestand(&pool, eid).await;

    let mut body = json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}});
    body["client_id"] = json!("c".repeat(65));
    let (s, _) = eintreffen(&app, &cookie, eid, br, body.clone()).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "client_id 65 Zeichen");

    body["client_id"] = json!("k1");
    let zukunft = (chrono::Utc::now() + chrono::Duration::seconds(65))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    body["zeitpunkt_at"] = json!(zukunft);
    let (s, _) = eintreffen(&app, &cookie, eid, br, body.clone()).await;
    // Mehr als 60 s voraus (65 s: die Sekunde des Formats und die Laufzeit liegen dazwischen).
    assert_eq!(s, StatusCode::BAD_REQUEST, "Zeitpunkt +65 s");
    // Eingabegrenze vor dem Zusammenhang (D2): mit Kraft und unangemeldet zugleich 400, nicht 422.
    let mut beides = body.clone();
    beides["unangemeldet"] = unangemeldet_body("FL 1")["unangemeldet"].clone();
    let (s, _) = eintreffen(&app, &cookie, eid, br, beides).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Zeitpunkt vor dem 422 „beides“");

    let (s, _) = common::anfrage_mit_offline_queue_benutzer(
        &app,
        "POST",
        &eintreffen_pfad(eid, br),
        &cookie,
        Some(&json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}).to_string()),
        i64::MAX,
    )
    .await;
    assert_eq!(s, StatusCode::PRECONDITION_FAILED, "fremde Kopfzeile");
    assert_eq!(bestand(&pool, eid).await, vorher);

    // Vorgemerkter Zeitpunkt gilt für Belegung und Eintreffen; der Replay meldet `zeitachse`
    // wie die Erstantwort.
    body["zeitpunkt_at"] = json!("2026-05-28 14:12:00");
    let (s, erst) = common::anfrage_mit_offline_queue_benutzer(
        &app,
        "POST",
        &eintreffen_pfad(eid, br),
        &cookie,
        Some(&body.to_string()),
        admin_id(&pool).await,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{erst}");
    assert_eq!(erst["belegung"]["zeitpunkt_at"], "2026-05-28 14:12:00");
    let at: String = sqlx::query_scalar(
        "SELECT zeitpunkt_at FROM einsatz_kraft_zeitachse WHERE einheit_id = ? AND art = 'eintreffen'",
    )
    .bind(einheit)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(at, "2026-05-28 14:12:00");
    let (s, zweit) = eintreffen(&app, &cookie, eid, br, body).await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(zweit, erst);
    assert_eq!(zweit["zeitachse"], "geschrieben");
}

/// D12/Spec „Einsatzleitung erfährt es“: „Neue Meldung“ an die Einsatzleitung genau einmal, auch
/// beim Replay; die Meldung nennt Raum und Abschnitt.
#[tokio::test]
async fn eintreffen_unangemeldet_benachrichtigt_einsatzleitung_einmal() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let elke = benutzer_anlegen(&app, &admin, "elkeleiter", "keine").await;
    rolle_setzen(&app, &admin, eid, elke, "fuehrungspersonal").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(&json!({"name": "Elke Leiter", "benutzer_id": elke})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/personal"),
        &admin,
        Some(&json!({"personal_id": v["id"]})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ep = v["id"].as_i64().unwrap();
    let geaendert = sqlx::query(
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_art = 'personal', \
             einsatzleiter_personal_id = ?, einsatzleiter_name = 'Elke', \
             einsatzleiter_seit = '2026-01-01 00:00:00' WHERE einsatz_id = ?",
    )
    .bind(ep)
    .bind(eid)
    .execute(&pool)
    .await
    .unwrap()
    .rows_affected();
    if geaendert == 0 {
        sqlx::query(
            "INSERT INTO einsatz_fuehrungsstelle (einsatz_id, einsatzleiter_art, \
                 einsatzleiter_personal_id, einsatzleiter_name, einsatzleiter_seit) \
             VALUES (?, 'personal', ?, 'Elke', '2026-01-01 00:00:00')",
        )
        .bind(eid)
        .bind(ep)
        .execute(&pool)
        .await
        .unwrap();
    }
    let nord = abschnitt_anlegen(&app, &admin, eid, "Nord").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &admin,
        Some(&json!({"bezeichnung": "Sportplatz", "abschnitt_id": nord})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let br = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{}/status", br_pfad(eid, br)),
        &admin,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();

    let mut body = unangemeldet_body("FL-MUS 1-44-1");
    body["client_id"] = json!("b1");
    for _ in 0..2 {
        let (s, v) = eintreffen(&app, &admin, eid, br, body.clone()).await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    let meldung_id: i64 = sqlx::query_scalar("SELECT id FROM meldung WHERE einsatz_id = ?")
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
    let zeilen: Vec<(i64, String, String, i64)> = sqlx::query_as(
        "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeilen,
        vec![(
            elke,
            "meldung".to_string(),
            "meldung".to_string(),
            meldung_id
        )]
    );
    let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM meldung WHERE id = ?")
        .bind(meldung_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        inhalt.contains("BR Sportplatz") && inhalt.contains("Abschnitt Nord"),
        "{inhalt}"
    );
}

/// D12: der Hub empfängt `bereitstellungsraum`, `einheit` und für eine bekannte Einheit mit
/// Besatzung `personal` je Person; bei unangemeldet auch `fahrzeug` und `meldung`.
#[tokio::test]
async fn eintreffen_live() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let einheit = einheit_bilden(&app, &cookie, eid, "HLF 20").await;
    let anna = common::stammpersonal_disponieren(&app, &cookie, eid, "Anna").await;
    sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
        .bind(einheit)
        .bind(anna)
        .execute(&pool)
        .await
        .unwrap();

    let mut rx = live.abonniere(eid);
    let (s, _) = eintreffen(
        &app,
        &cookie,
        eid,
        br,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let mut gesehen = objekt_ereignisse(
        &mut rx,
        &[
            ("bereitstellungsraum", "br_id"),
            ("einheit", "einheit_id"),
            ("personal", "personal_id"),
        ],
    );
    gesehen.sort();
    assert_eq!(
        gesehen,
        vec![
            ("bereitstellungsraum".to_string(), br),
            ("einheit".to_string(), einheit),
            ("personal".to_string(), anna),
        ]
    );

    let mut rx = live.abonniere(eid);
    let (s, v) = eintreffen(&app, &cookie, eid, br, unangemeldet_body("FL 1")).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let mut tags = Vec::new();
    while let Ok(n) = rx.try_recv() {
        tags.push(n.event.as_str().to_string());
    }
    for tag in [
        "bereitstellungsraum",
        "einheit",
        "fahrzeug",
        "meldung",
        "etb",
    ] {
        assert!(tags.iter().any(|t| t == tag), "{tag} fehlt: {tags:?}");
    }
}

/// AK „alles oder nichts“ (D2): scheitert der Belegungseintrag nach dem Anlegen der Einheit oder
/// der ETB-Eintrag als letzter Schritt (mit und ohne Auto-ETB), bleibt nichts bestehen.
#[tokio::test]
async fn eintreffen_alles_oder_nichts() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let vorher = bestand(&pool, eid).await;

    sqlx::query(
        "CREATE TRIGGER belegung_klemmt BEFORE INSERT ON br_belegung \
         BEGIN SELECT RAISE(ABORT, 'Testfehler: Belegung'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    let (s, v) = eintreffen(&app, &cookie, eid, br, unangemeldet_body("FL 1")).await;
    assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR, "{v}");
    assert_eq!(bestand(&pool, eid).await, vorher);
    sqlx::query("DROP TRIGGER belegung_klemmt")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "CREATE TRIGGER etb_klemmt BEFORE INSERT ON etb_eintrag \
         BEGIN SELECT RAISE(ABORT, 'Testfehler: ETB'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    for an in [true, false] {
        set_auto_etb(&pool, eid, an).await;
        let (s, v) = eintreffen(&app, &cookie, eid, br, unangemeldet_body("FL 2")).await;
        assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR, "Auto-ETB {an}: {v}");
        assert_eq!(bestand(&pool, eid).await, vorher, "Auto-ETB {an}");
    }
    let einheit = einheit_bilden_ohne_etb(&pool, eid).await;
    let vorher = bestand(&pool, eid).await;
    let (s, _) = eintreffen(
        &app,
        &cookie,
        eid,
        br,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}),
    )
    .await;
    assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(bestand(&pool, eid).await, vorher, "bekannte Kraft");
}

async fn einheit_bilden_ohne_etb(pool: &sqlx::SqlitePool, eid: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Zug') RETURNING id",
    )
    .bind(eid)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Raum geplant oder storniert 422; ohne Recht am Modul Einheiten 403 und nichts angelegt;
/// Beobachter 403; eine bekannte Kraft braucht das Recht Einheiten nicht.
#[tokio::test]
async fn eintreffen_raum_und_rechte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/bereitstellungsraeume"),
        &admin,
        Some(&json!({"bezeichnung": "Geplant"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let geplant = v["id"].as_i64().unwrap();
    let storniert = br_anlegen_und_aktivieren(&app, &admin, eid, "Storniert").await;
    let (s, _) = anfrage_json(&app, "DELETE", &br_pfad(eid, storniert), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let br = br_anlegen_und_aktivieren(&app, &admin, eid, "Sportplatz").await;
    let einheit = einheit_bilden(&app, &admin, eid, "HLF 20").await;
    let vorher = bestand(&pool, eid).await;
    for raum in [geplant, storniert] {
        let (s, _) = eintreffen(&app, &admin, eid, raum, unangemeldet_body("FL 1")).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    }

    let frieda = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, eid, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    for modul in ["einheiten", "fahrzeuge"] {
        let (s, v) = anfrage_json(
            &app,
            "PUT",
            &format!("/api/einsaetze/{eid}/modul-overrides/{modul}"),
            &admin,
            Some(&json!({"sichtbar": true, "benoetigte_rolle": "admin"})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let (s, _) = eintreffen(&app, &frieda, eid, br, unangemeldet_body("FL 1")).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "ohne {modul}");
        let (s, v) = anfrage_json(
            &app,
            "PUT",
            &format!("/api/einsaetze/{eid}/modul-overrides/{modul}"),
            &admin,
            Some(&json!({"sichtbar": true, "benoetigte_rolle": null})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, eid, beob, "beobachter").await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    let (s, _) = eintreffen(
        &app,
        &beob,
        eid,
        br,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Beobachter");
    assert_eq!(bestand(&pool, eid).await, vorher);

    // Eine bekannte Kraft verlangt nur das BR-Recht.
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/modul-overrides/einheiten"),
        &admin,
        Some(&json!({"sichtbar": true, "benoetigte_rolle": "admin"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = eintreffen(
        &app,
        &frieda,
        eid,
        br,
        json!({"kraft": {"objekt_typ": "einheit", "objekt_id": einheit}}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

// ============================== Übernehmen und Abweisen (LLH-1075) ==============================

/// Bucht eine unangemeldete Kraft und liefert (einheit_id, meldung_id, fahrzeug_id).
async fn unangemeldet_buchen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    br: i64,
    funkrufname: &str,
) -> (i64, i64, i64) {
    let (s, v) = eintreffen(app, cookie, einsatz, br, unangemeldet_body(funkrufname)).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (
        v["einheit_id"].as_i64().unwrap(),
        v["meldung_id"].as_i64().unwrap(),
        v["fahrzeug_ids"][0].as_i64().unwrap(),
    )
}

async fn meldung_bestaetigt(pool: &sqlx::SqlitePool, meldung: i64) -> bool {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT quittiert_at FROM kommunikation_status \
         WHERE objekt_typ = 'meldung' AND objekt_id = ?",
    )
    .bind(meldung)
    .fetch_optional(pool)
    .await
    .unwrap()
    .flatten()
    .is_some()
}

fn einheit_pfad(einsatz: i64, einheit: i64) -> String {
    format!("/api/einsaetze/{einsatz}/einheiten/{einheit}")
}

async fn einheit_json(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    einheit: i64,
) -> serde_json::Value {
    let liste = fetch_json(app, cookie, &format!("/api/einsaetze/{einsatz}/einheiten")).await;
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == einheit)
        .cloned()
        .unwrap_or(serde_json::Value::Null)
}

/// 4.3: Kennzeichen und Herkunft an Einheiten-Antwort und Belegung des Raums; nach der Übernahme
/// (mit Abschnitt) ist das Kennzeichen weg, die Herkunft bleibt, die Einheit steht weiter im Raum,
/// die Meldung ist bestätigt und das ETB trägt genau einen Eintrag mit der Unterstellung.
#[tokio::test]
async fn uebernehmen_mit_abschnitt() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let nord = abschnitt_anlegen(&app, &cookie, eid, "Nord").await;
    let bekannt = einheit_bilden(&app, &cookie, eid, "HLF 20").await;
    belegen(&app, &cookie, eid, br, "einheit", bekannt, "eintritt").await;
    let (einheit, meldung, _) = unangemeldet_buchen(&app, &cookie, eid, br, "FL-MUS 1-44-1").await;

    let e = einheit_json(&app, &cookie, eid, einheit).await;
    assert!(e["nicht_uebernommen_seit"].is_string(), "{e}");
    assert_eq!(e["unangemeldet"], true);
    let b = einheit_json(&app, &cookie, eid, bekannt).await;
    assert!(b.get("nicht_uebernommen_seit").is_none(), "{b}");
    assert_eq!(b["unangemeldet"], false);
    let detail = fetch_json(&app, &cookie, &br_pfad(eid, br)).await;
    let zeile = |d: &serde_json::Value, id: i64| {
        d["einheiten"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == id)
            .cloned()
            .unwrap()
    };
    assert!(zeile(&detail, einheit)["nicht_uebernommen_seit"].is_string());
    assert_eq!(zeile(&detail, einheit)["unangemeldet"], true);
    assert_eq!(zeile(&detail, bekannt)["unangemeldet"], false);

    // Bekannte Einheit: keine offene Übernahme → 422.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{}/uebernehmen", einheit_pfad(eid, bekannt)),
        &cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let etb_vorher = bestand(&pool, eid).await[2];
    let mut rx = live.abonniere(eid);
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{}/uebernehmen", einheit_pfad(eid, einheit)),
        &cookie,
        Some(&json!({"abschnitt_id": nord})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("nicht_uebernommen_seit").is_none(), "{v}");
    assert_eq!(v["unangemeldet"], true);
    assert_eq!(v["abschnitt_id"], nord);
    assert_eq!(v["aktueller_br_id"], br, "bleibt im Raum");
    assert!(meldung_bestaetigt(&pool, meldung).await);
    assert_eq!(
        bestand(&pool, eid).await[2],
        etb_vorher + 1,
        "genau ein ETB"
    );
    assert!(etb_inhalte(&app, &cookie, eid)
        .await
        .contains(&"Einheit «FL-MUS 1-44-1» übernommen, Abschnitt Nord".to_string()));
    let detail = fetch_json(&app, &cookie, &br_pfad(eid, br)).await;
    assert!(zeile(&detail, einheit)
        .get("nicht_uebernommen_seit")
        .is_none());
    assert_eq!(zeile(&detail, einheit)["unangemeldet"], true);
    let mut tags = Vec::new();
    while let Ok(n) = rx.try_recv() {
        tags.push(n.event.as_str().to_string());
    }
    for tag in ["einheit", "bereitstellungsraum", "meldung", "etb"] {
        assert!(tags.iter().any(|t| t == tag), "{tag} fehlt: {tags:?}");
    }

    // Zweimal → 422.
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{}/uebernehmen", einheit_pfad(eid, einheit)),
        &cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Übernehmen mit Über-Einheit; Zyklus 400, fremder Abschnitt 404, Meldung schon quittiert
/// gelingt, aufgelöst 409, ohne Recht Einheiten 403.
#[tokio::test]
async fn uebernehmen_bezuege_und_zustaende() {
    let (app, pool) = setup_mit_pool().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let andere = common::einsatz_anlegen_mit(&app, &cookie, "Andere Lage").await;
    let fremder_abschnitt = abschnitt_anlegen(&app, &cookie, andere, "Fremd").await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let zug = einheit_bilden(&app, &cookie, eid, "1. Zug").await;
    let (einheit, meldung, _) = unangemeldet_buchen(&app, &cookie, eid, br, "FL 1").await;
    let pfad = format!("{}/uebernehmen", einheit_pfad(eid, einheit));

    // Zyklus: der Zug hängt unter der neuen Einheit.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &einheit_pfad(eid, zug),
        &cookie,
        Some(&json!({"ueber_einheit_id": einheit})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let vorher = bestand(&pool, eid).await;
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &pfad,
        &cookie,
        Some(&json!({"ueber_einheit_id": zug})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Zyklus");
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &pfad,
        &cookie,
        Some(&json!({"abschnitt_id": fremder_abschnitt})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "fremder Abschnitt");
    assert_eq!(bestand(&pool, eid).await, vorher);
    assert!(!meldung_bestaetigt(&pool, meldung).await);

    // Ohne Recht Einheiten 403.
    let frieda = benutzer_anlegen(&app, &cookie, "frieda", "keine").await;
    rolle_setzen(&app, &cookie, eid, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/modul-overrides/einheiten"),
        &cookie,
        Some(&json!({"sichtbar": true, "benoetigte_rolle": "admin"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage_json(&app, "POST", &pfad, &frieda, Some(&json!({}))).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Meldung schon quittiert: Übernahme gelingt; mit Über-Einheit.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/meldungen/{meldung}/bestaetigen"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let neuer_zug = einheit_bilden(&app, &cookie, eid, "2. Zug").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &pfad,
        &cookie,
        Some(&json!({"ueber_einheit_id": neuer_zug})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ueber_einheit_id"], neuer_zug);
    assert!(etb_inhalte(&app, &cookie, eid)
        .await
        .contains(&"Einheit «FL 1» übernommen, unterstellt «2. Zug»".to_string()));

    // Aufgelöst → 409.
    let (zweite, _, _) = unangemeldet_buchen(&app, &cookie, eid, br, "FL 2").await;
    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = '2026-05-28 10:00:00' WHERE id = ?")
        .bind(zweite)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{}/uebernehmen", einheit_pfad(eid, zweite)),
        &cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// D11: Abweisen schreibt Austritt (Notiz „Einheit aufgelöst“), Zeitachsen-Entlassung (Quelle
/// `disposition`), entlässt das Fahrzeug, bestätigt die Meldung und genau einen ETB-Eintrag.
#[tokio::test]
async fn abweisen_loest_auf_und_entlaesst() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let cookie = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &cookie).await;
    let br = br_anlegen_und_aktivieren(&app, &cookie, eid, "Sportplatz").await;
    let (einheit, meldung, fahrzeug) =
        unangemeldet_buchen(&app, &cookie, eid, br, "FL-MUS 1-44-1").await;
    let pfad = format!("{}/abweisen", einheit_pfad(eid, einheit));

    // Ohne Recht Fahrzeuge 403, nichts geändert.
    let frieda = benutzer_anlegen(&app, &cookie, "frieda", "keine").await;
    rolle_setzen(&app, &cookie, eid, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/modul-overrides/fahrzeuge"),
        &cookie,
        Some(&json!({"sichtbar": true, "benoetigte_rolle": "admin"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let vorher = bestand(&pool, eid).await;
    let (s, _) = anfrage_json(&app, "POST", &pfad, &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(bestand(&pool, eid).await, vorher);

    let mut rx = live.abonniere(eid);
    let (s, v) = anfrage_json(&app, "POST", &pfad, &cookie, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    let nachher = bestand(&pool, eid).await;
    assert_eq!(nachher[2], vorher[2] + 1, "genau ein ETB-Eintrag");
    let (art, notiz): (String, Option<String>) = sqlx::query_as(
        "SELECT art, notiz FROM br_belegung WHERE objekt_typ = 'einheit' AND objekt_id = ? \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einheit)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (art.as_str(), notiz.as_deref()),
        ("austritt", Some("Einheit aufgelöst"))
    );
    let quelle: String = sqlx::query_scalar(
        "SELECT quelle FROM einsatz_kraft_zeitachse WHERE einheit_id = ? AND art = 'entlassung'",
    )
    .bind(einheit)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(quelle, "disposition");
    let beendet_als: Option<String> =
        sqlx::query_scalar("SELECT beendet_als FROM einsatz_fahrzeug WHERE id = ?")
            .bind(fahrzeug)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(beendet_als.as_deref(), Some("entlassen"));
    let aufgeloest: Option<String> =
        sqlx::query_scalar("SELECT aufgeloest_at FROM einsatz_einheit WHERE id = ?")
            .bind(einheit)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(aufgeloest.is_some());
    // Abgewiesen ist nicht mehr offen: kein Kennzeichen, die Herkunft bleibt (Spec „Kennzeichen“).
    let aufgeloeste = fetch_json(
        &app,
        &cookie,
        &format!("/api/einsaetze/{eid}/einheiten?aufgeloeste=1"),
    )
    .await;
    let abgewiesen = aufgeloeste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == einheit)
        .cloned()
        .unwrap_or_else(|| panic!("abgewiesene Einheit fehlt: {aufgeloeste}"));
    assert!(
        abgewiesen.get("nicht_uebernommen_seit").is_none(),
        "{abgewiesen}"
    );
    assert_eq!(abgewiesen["unangemeldet"], true);
    assert!(meldung_bestaetigt(&pool, meldung).await);
    assert!(etb_inhalte(&app, &cookie, eid).await.contains(
        &"Einheit «FL-MUS 1-44-1» abgewiesen: verlässt BR Sportplatz, aufgelöst, \
          Fahrzeuge entlassen: FL-MUS 1-44-1"
            .to_string()
    ));
    let mut tags = Vec::new();
    while let Ok(n) = rx.try_recv() {
        tags.push(n.event.as_str().to_string());
    }
    for tag in [
        "einheit",
        "bereitstellungsraum",
        "fahrzeug",
        "meldung",
        "etb",
    ] {
        assert!(tags.iter().any(|t| t == tag), "{tag} fehlt: {tags:?}");
    }

    // Aufgelöst → 409; übernommene Einheit → 422.
    let (s, _) = anfrage_json(&app, "POST", &pfad, &cookie, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (zweite, _, _) = unangemeldet_buchen(&app, &cookie, eid, br, "FL 2").await;
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{}/uebernehmen", einheit_pfad(eid, zweite)),
        &cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage_json(
        &app,
        "POST",
        &format!("{}/abweisen", einheit_pfad(eid, zweite)),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

// ============================== Abruf (LLH-1085) ==============================
// Spec `bereitstellungsraum-belegung`, „Kraft aus dem Raum abrufen“ bis „Abruf live“.

fn abruf_pfad(einsatz: i64, br: i64) -> String {
    format!("{}/abruf", br_pfad(einsatz, br))
}

async fn rufe_ab(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    br: i64,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage_json(app, "POST", &abruf_pfad(einsatz, br), cookie, Some(&body)).await
}

async fn hebe_auf(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    br: i64,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let pfad = format!("{}/aufheben", abruf_pfad(einsatz, br));
    anfrage_json(app, "POST", &pfad, cookie, Some(&body)).await
}

/// (Belegungen, ETB-Einträge, Aufträge) des Einsatzes.
async fn abruf_bestand(pool: &sqlx::SqlitePool, e: i64) -> [i64; 3] {
    let mut z = [0; 3];
    for (i, t) in ["br_belegung", "etb_eintrag", "auftrag"].iter().enumerate() {
        z[i] = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {t} WHERE einsatz_id = ?"
        )))
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
    }
    z
}

async fn unterstellung(pool: &sqlx::SqlitePool, einheit: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT abschnitt_id FROM einsatz_einheit WHERE id = ?")
        .bind(einheit)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Jüngste (Art, Ziel, Auftrag) eines Objekts.
async fn juengstes(
    pool: &sqlx::SqlitePool,
    typ: &str,
    id: i64,
) -> (String, Option<String>, Option<i64>) {
    sqlx::query_as(
        "SELECT art, ziel_anzeige, auftrag_id FROM br_belegung \
         WHERE objekt_typ = ? AND objekt_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(typ)
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn unterstellen(pool: &sqlx::SqlitePool, kind: i64, ueber: i64) {
    sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE id = ?")
        .bind(ueber)
        .bind(kind)
        .execute(pool)
        .await
        .unwrap();
}

async fn modul_sperren(app: &axum::Router, admin: &str, eid: i64, modul: &str, gesperrt: bool) {
    let rolle = if gesperrt {
        json!("admin")
    } else {
        json!(null)
    };
    let (s, v) = anfrage_json(
        app,
        "PUT",
        &format!("/api/einsaetze/{eid}/modul-overrides/{modul}"),
        admin,
        Some(&json!({"sichtbar": true, "benoetigte_rolle": rolle})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Einsatz mit aktivem BR „Sportplatz“, Abschnitt „EA Deich“ und „HLF 20“ im Raum.
struct AbrufLage {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    eid: i64,
    br: i64,
    deich: i64,
    hlf: i64,
}

async fn abruf_lage() -> AbrufLage {
    let (app, pool) = setup_mit_pool().await;
    abruf_lage_mit(app, pool).await
}

async fn abruf_lage_mit(app: axum::Router, pool: sqlx::SqlitePool) -> AbrufLage {
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let br = br_anlegen_und_aktivieren(&app, &admin, eid, "Sportplatz").await;
    let deich = abschnitt_anlegen(&app, &admin, eid, "EA Deich").await;
    let hlf = einheit_bilden(&app, &admin, eid, "HLF 20").await;
    belegen(&app, &admin, eid, br, "einheit", hlf, "eintritt").await;
    AbrufLage {
        app,
        pool,
        admin,
        eid,
        br,
        deich,
        hlf,
    }
}

/// Spec „Abruf setzt die Unterstellung“ und „Genau ein ETB-Eintrag zum Abruf“: Ereignis mit Ziel,
/// `abschnitt_id`, genau ein Eintrag mit Wortlaut, kein „Abschnitt zugeordnet“; die Kraft bleibt
/// im Raum.
#[tokio::test]
async fn abruf_mit_abschnitt_setzt_unterstellung_ereignis_und_etb() {
    let l = abruf_lage().await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["abruf"]["art"], "abruf");
    assert_eq!(v["abruf"]["ziel_abschnitt_id"], l.deich);
    assert_eq!(v["abruf"]["ziel_anzeige"], "EA Deich");
    assert_eq!(v["mitgenommen"], json!([]));
    assert!(!v.as_object().unwrap().contains_key("auftrag_id"), "{v}");
    assert_eq!(unterstellung(&l.pool, l.hlf).await, Some(l.deich));
    let nachher = abruf_bestand(&l.pool, l.eid).await;
    assert_eq!(
        [
            nachher[0] - vorher[0],
            nachher[1] - vorher[1],
            nachher[2] - vorher[2]
        ],
        [1, 1, 0]
    );
    let etb = etb_inhalte(&l.app, &l.admin, l.eid).await;
    assert!(
        etb.iter()
            .any(|t| t == "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich"),
        "{etb:?}"
    );
    assert!(!etb.iter().any(|t| t.contains("zugeordnet")), "{etb:?}");
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert_eq!(d["einheiten"][0]["id"], l.hlf, "bleibt im Raum: {d}");
}

/// AK „ohne Abschnitt unverändert“: die bisherige Unterstellung bleibt.
#[tokio::test]
async fn abruf_ohne_abschnitt_laesst_unterstellung() {
    let l = abruf_lage().await;
    let nord = abschnitt_anlegen(&l.app, &l.admin, l.eid, "EA Nord").await;
    sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = ? WHERE id = ?")
        .bind(nord)
        .bind(l.hlf)
        .execute(&l.pool)
        .await
        .unwrap();
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(unterstellung(&l.pool, l.hlf).await, Some(nord));
    assert!(etb_inhalte(&l.app, &l.admin, l.eid)
        .await
        .iter()
        .any(|t| t == "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen"));
}

/// Spec „Abruf in einer Transaktion“: scheitert der ETB-Eintrag, gibt es kein Ereignis, keine
/// Unterstellung und keinen Auftrag (mit und ohne Auto-ETB).
#[tokio::test]
async fn abruf_atomar_bei_etb_fehler() {
    let l = abruf_lage().await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    sqlx::query(
        "CREATE TRIGGER etb_klemmt BEFORE INSERT ON etb_eintrag \
         BEGIN SELECT RAISE(ABORT, 'Testfehler: ETB'); END",
    )
    .execute(&l.pool)
    .await
    .unwrap();
    for an in [true, false] {
        set_auto_etb(&l.pool, l.eid, an).await;
        let (s, v) = rufe_ab(
            &l.app,
            &l.admin,
            l.eid,
            l.br,
            json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich,
                   "auftrag_text": "Sandsackverbau"}),
        )
        .await;
        assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR, "Auto-ETB {an}: {v}");
        assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher, "Auto-ETB {an}");
        assert_eq!(unterstellung(&l.pool, l.hlf).await, None);
    }
}

/// Spec „Abruf mit Auftrag“: Empfänger die Einheit, Ziel der Name des Abschnitts, Anordnung nur
/// mit Auto-ETB; das Ereignis verweist auf den Auftrag, der ETB-Eintrag nennt die Nummer.
#[tokio::test]
async fn abruf_mit_auftrag_legt_auftrag_an_einheit_an() {
    let l = abruf_lage().await;
    let zug = einheit_bilden(&l.app, &l.admin, l.eid, "Zug 2").await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", zug, "eintritt").await;
    for (an, einheit) in [(true, l.hlf), (false, zug)] {
        set_auto_etb(&l.pool, l.eid, an).await;
        let vorher = abruf_bestand(&l.pool, l.eid).await;
        let (s, v) = rufe_ab(
            &l.app,
            &l.admin,
            l.eid,
            l.br,
            json!({"objekt_typ": "einheit", "objekt_id": einheit, "abschnitt_id": l.deich,
                   "auftrag_text": "  Sandsackverbau  "}),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let auftrag = v["auftrag_id"].as_i64().expect("auftrag_id");
        assert_eq!(v["abruf"]["auftrag_id"], auftrag);
        let nr = v["auftrag_nr"].as_i64().expect("auftrag_nr");
        let a = fetch_json(
            &l.app,
            &l.admin,
            &format!("/api/einsaetze/{}/auftraege/{auftrag}", l.eid),
        )
        .await;
        assert_eq!(a["auftrag_text"], "Sandsackverbau");
        assert_eq!(a["ort"], "EA Deich");
        assert_eq!(a["empfaenger"][0]["empfaenger_typ"], "einheit");
        assert_eq!(a["empfaenger"][0]["einheit_id"], einheit);
        assert_eq!(
            a["etb_anordnung_id"].is_i64(),
            an,
            "Anordnung nur mit Auto-ETB: {a}"
        );
        let nachher = abruf_bestand(&l.pool, l.eid).await;
        assert_eq!(
            nachher[1] - vorher[1],
            if an { 2 } else { 1 },
            "ETB-Einträge"
        );
        assert_eq!(nachher[2] - vorher[2], 1, "ein Auftrag");
        let name = if an { "HLF 20" } else { "Zug 2" };
        let erwartet = format!(
            "{name} aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich (Auftrag Nr. {nr})"
        );
        let etb = etb_inhalte(&l.app, &l.admin, l.eid).await;
        assert!(etb.contains(&erwartet), "{erwartet} in {etb:?}");
    }
    // Ein leerer Text heißt „kein Auftrag“.
    let gruppe = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 9").await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", gruppe, "eintritt").await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": gruppe, "auftrag_text": "   "}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await[2], vorher[2]);
}

/// Spec „Rechte des Abrufs“: ohne Recht am Modul Aufträge bzw. Einheiten 403 vor allem anderen,
/// nichts geschrieben; ohne Abschnitt braucht es das Recht Einheiten nicht.
#[tokio::test]
async fn abruf_mit_auftrag_ohne_freigabe_auftraege_403() {
    let l = abruf_lage().await;
    let frieda = benutzer_anlegen(&l.app, &l.admin, "frieda", "keine").await;
    rolle_setzen(&l.app, &l.admin, l.eid, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&l.app, "frieda", "friedapw1").await;
    modul_sperren(&l.app, &l.admin, l.eid, "auftraege", true).await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    // Auch mit unbekanntem Objekt und fremdem Abschnitt: 403 kommt zuerst.
    for objekt in [l.hlf, 99_999] {
        let (s, v) = rufe_ab(
            &l.app,
            &frieda,
            l.eid,
            l.br,
            json!({"objekt_typ": "einheit", "objekt_id": objekt, "auftrag_text": "Sandsack"}),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    }
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
    let (s, v) = rufe_ab(
        &l.app,
        &frieda,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "auftrag_text": ""}),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "leerer Auftrag braucht das Recht nicht: {v}"
    );
}

#[tokio::test]
async fn abruf_mit_abschnitt_ohne_freigabe_einheiten_403() {
    let l = abruf_lage().await;
    let frieda = benutzer_anlegen(&l.app, &l.admin, "frieda", "keine").await;
    rolle_setzen(&l.app, &l.admin, l.eid, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&l.app, "frieda", "friedapw1").await;
    modul_sperren(&l.app, &l.admin, l.eid, "einheiten", true).await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(
        &l.app,
        &frieda,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
    assert_eq!(unterstellung(&l.pool, l.hlf).await, None);
}

/// Spec-Szenario „Einheiten gesperrt, ohne Abschnitt“.
#[tokio::test]
async fn abruf_ohne_abschnitt_braucht_kein_einheiten_recht() {
    let l = abruf_lage().await;
    let frieda = benutzer_anlegen(&l.app, &l.admin, "frieda", "keine").await;
    rolle_setzen(&l.app, &l.admin, l.eid, frieda, "fuehrungspersonal").await;
    let frieda = login_cookie(&l.app, "frieda", "friedapw1").await;
    modul_sperren(&l.app, &l.admin, l.eid, "einheiten", true).await;
    let (s, v) = rufe_ab(
        &l.app,
        &frieda,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

#[tokio::test]
async fn beobachter_ruft_nicht_ab_403() {
    let l = abruf_lage().await;
    let beob = benutzer_anlegen(&l.app, &l.admin, "beobachter", "keine").await;
    rolle_setzen(&l.app, &l.admin, l.eid, beob, "beobachter").await;
    let beob = login_cookie(&l.app, "beobachter", "beobachterpw1").await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, _) = rufe_ab(
        &l.app,
        &beob,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    let vorher_aufheben = abruf_bestand(&l.pool, l.eid).await;
    assert_ne!(vorher_aufheben, vorher);
    let (s, _) = hebe_auf(
        &l.app,
        &beob,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher_aufheben);
}

/// D11: ein einheitenloses Fahrzeug wird ohne Abschnitt abgerufen, der Auftrag geht an das
/// Fahrzeug; mit Abschnitt 422.
#[tokio::test]
async fn abruf_fahrzeug_ohne_einheit_mit_auftrag_an_fahrzeug() {
    let l = abruf_lage().await;
    let fz = adhoc_fahrzeug(&l.app, &l.admin, l.eid, "Florian 1/83-1", None).await;
    belegen(&l.app, &l.admin, l.eid, l.br, "fahrzeug", fz, "eintritt").await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "fahrzeug", "objekt_id": fz, "abschnitt_id": l.deich}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);

    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "fahrzeug", "objekt_id": fz, "auftrag_text": "Pumpen"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let auftrag = v["auftrag_id"].as_i64().unwrap();
    let a = fetch_json(
        &l.app,
        &l.admin,
        &format!("/api/einsaetze/{}/auftraege/{auftrag}", l.eid),
    )
    .await;
    assert_eq!(a["empfaenger"][0]["empfaenger_typ"], "fahrzeug");
    assert_eq!(a["empfaenger"][0]["fahrzeug_id"], fz);
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert_eq!(d["fahrzeuge"][0]["abruf"]["auftrag_id"], auftrag, "{d}");
}

/// Abschnitt eines anderen Einsatzes oder unbekannt: 404, nichts geschrieben.
#[tokio::test]
async fn abruf_fremder_abschnitt_404() {
    let l = abruf_lage().await;
    let fremder_einsatz = einsatz_anlegen(&l.app, &l.admin).await;
    let fremd = abschnitt_anlegen(&l.app, &l.admin, fremder_einsatz, "Fremd").await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    for abschnitt in [fremd, 99_999] {
        let (s, v) = rufe_ab(
            &l.app,
            &l.admin,
            l.eid,
            l.br,
            json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": abschnitt}),
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
    }
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
    assert_eq!(unterstellung(&l.pool, l.hlf).await, None);
}

#[tokio::test]
async fn abruf_fahrzeug_einer_einheit_422() {
    let l = abruf_lage().await;
    let fz = adhoc_fahrzeug(&l.app, &l.admin, l.eid, "Florian 1/44-1", Some(l.hlf)).await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "fahrzeug", "objekt_id": fz}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
}

/// Eine Kraft eines anderen Einsatzes ist 404, auch mit Auftragstext (nicht der 400 der
/// Empfängerprüfung, D6); eine unbekannte ebenso.
#[tokio::test]
async fn abruf_fremde_kraft_404() {
    let l = abruf_lage().await;
    let fremder_einsatz = einsatz_anlegen(&l.app, &l.admin).await;
    let fremd = einheit_bilden(&l.app, &l.admin, fremder_einsatz, "Fremdzug").await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    for body in [
        json!({"objekt_typ": "einheit", "objekt_id": fremd}),
        json!({"objekt_typ": "einheit", "objekt_id": fremd, "auftrag_text": "Sandsack"}),
        json!({"objekt_typ": "fahrzeug", "objekt_id": 99_999, "auftrag_text": "Sandsack"}),
    ] {
        let (s, v) = rufe_ab(&l.app, &l.admin, l.eid, l.br, body.clone()).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{body}: {v}");
    }
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
}

/// Eine aufgelöste Einheit ist 409 (Lebenszyklus); eine Kraft in einem anderen Raum und ein
/// zweiter Abruf sind 422.
#[tokio::test]
async fn abruf_aufgeloeste_einheit_409() {
    let l = abruf_lage().await;
    let schule = br_anlegen_und_aktivieren(&l.app, &l.admin, l.eid, "Schule").await;
    let zug = einheit_bilden(&l.app, &l.admin, l.eid, "Zug 2").await;
    belegen(&l.app, &l.admin, l.eid, schule, "einheit", zug, "eintritt").await;
    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = '2026-10-16 10:00:00' WHERE id = ?")
        .bind(l.hlf)
        .execute(&l.pool)
        .await
        .unwrap();
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": zug}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "anderer Raum: {v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
    let body = json!({"objekt_typ": "einheit", "objekt_id": zug});
    let (s, _) = rufe_ab(&l.app, &l.admin, l.eid, schule, body.clone()).await;
    assert_eq!(s, StatusCode::CREATED);
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(&l.app, &l.admin, l.eid, schule, body).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "zweiter Abruf: {v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
}

#[tokio::test]
async fn abruf_unbekannter_objekt_typ_400() {
    let l = abruf_lage().await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "person", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    let (s, v) = hebe_auf(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "person", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
}

/// Spec-Szenario „Auftragstext zu lang“: 400, weder Abruf noch Auftrag.
#[tokio::test]
async fn abruf_auftragstext_ueber_grenze_400() {
    let l = abruf_lage().await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let text = "x".repeat(lifeline_hub::auftrag::AUFTRAG_TEXT_MAX + 1);
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "auftrag_text": text}),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
}

/// Spec „Verband geht mit“: Gruppen und ihre Trupps im Raum gehen mit, die Gruppe im anderen
/// Raum nicht; nur der Zug ist unterstellt; das ETB nennt die Gruppen.
#[tokio::test]
async fn abruf_verband_nimmt_untereinheiten_mit() {
    let l = abruf_lage().await;
    let schule = br_anlegen_und_aktivieren(&l.app, &l.admin, l.eid, "Schule").await;
    let zug = einheit_bilden(&l.app, &l.admin, l.eid, "1. Zug").await;
    let g1 = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 1").await;
    let g2 = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 2").await;
    let g3 = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 3").await;
    for (kind, ueber) in [(g1, zug), (g2, zug), (g3, zug)] {
        unterstellen(&l.pool, kind, ueber).await;
    }
    for id in [zug, g1, g2] {
        belegen(&l.app, &l.admin, l.eid, l.br, "einheit", id, "eintritt").await;
    }
    belegen(&l.app, &l.admin, l.eid, schule, "einheit", g3, "eintritt").await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": zug, "abschnitt_id": l.deich}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["mitgenommen"], json!([g1, g2]));
    assert_eq!(unterstellung(&l.pool, zug).await, Some(l.deich));
    assert_eq!(unterstellung(&l.pool, g1).await, None);
    assert_eq!(juengstes(&l.pool, "einheit", g3).await.0, "eintritt");
    let etb = etb_inhalte(&l.app, &l.admin, l.eid).await;
    assert!(
        etb.contains(
            &"1. Zug mit Gruppe 1, Gruppe 2 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich"
                .to_string()
        ),
        "{etb:?}"
    );
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    let gruppe = d["einheiten"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == g1)
        .unwrap()
        .clone();
    assert_eq!(gruppe["abruf"]["mit_objekt_id"], zug, "{gruppe}");
    assert_eq!(gruppe["abruf"]["ziel_anzeige"], "EA Deich");
}

/// Spec „Abrufen und sofort austragen“: zwei Ereignisse je Kraft, Cache leer, ein ETB-Eintrag.
#[tokio::test]
async fn abruf_und_sofort_austragen() {
    let l = abruf_lage().await;
    let g1 = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 1").await;
    unterstellen(&l.pool, g1, l.hlf).await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", g1, "eintritt").await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich,
               "ausgerueckt": true}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let nachher = abruf_bestand(&l.pool, l.eid).await;
    assert_eq!([nachher[0] - vorher[0], nachher[1] - vorher[1]], [4, 1]);
    for id in [l.hlf, g1] {
        assert_eq!(juengstes(&l.pool, "einheit", id).await.0, "austritt");
    }
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert_eq!(d["einheiten"], json!([]), "{d}");
    assert_eq!(unterstellung(&l.pool, l.hlf).await, Some(l.deich));
    assert!(etb_inhalte(&l.app, &l.admin, l.eid).await.contains(
        &"HLF 20 mit Gruppe 1 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich und ausgerückt"
            .to_string()
    ));
}

/// Spec „Abruf zurücknehmen“: wieder bereitgestellt, Unterstellung und Auftrag bleiben, ETB.
#[tokio::test]
async fn abruf_zuruecknehmen_laesst_unterstellung_und_auftrag() {
    let l = abruf_lage().await;
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich,
               "auftrag_text": "Sandsackverbau"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let auftrag = v["auftrag_id"].as_i64().unwrap();
    let (s, v) = hebe_auf(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["art"], "abruf_aufgehoben");
    assert_eq!(unterstellung(&l.pool, l.hlf).await, Some(l.deich));
    let a = fetch_json(
        &l.app,
        &l.admin,
        &format!("/api/einsaetze/{}/auftraege/{auftrag}", l.eid),
    )
    .await;
    assert_eq!(a["vollzug_status"], "offen", "Auftrag bleibt: {a}");
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert!(
        !d["einheiten"][0].as_object().unwrap().contains_key("abruf"),
        "wieder bereitgestellt: {d}"
    );
    assert!(etb_inhalte(&l.app, &l.admin, l.eid).await.contains(
        &"Abruf von HLF 20 aus Bereitstellungsraum Sportplatz zurückgenommen".to_string()
    ));
}

#[tokio::test]
async fn abruf_zuruecknehmen_ohne_abruf_422() {
    let l = abruf_lage().await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = hebe_auf(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
}

/// Spec „Belegungsroute nimmt keinen Abruf an“.
#[tokio::test]
async fn belegung_lehnt_abruf_ab_422() {
    let l = abruf_lage().await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    for art in ["abruf", "abruf_aufgehoben"] {
        let (s, v) = anfrage_json(
            &l.app,
            "POST",
            &format!("{}/belegung", br_pfad(l.eid, l.br)),
            &l.admin,
            Some(&json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "art": art})),
        )
        .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{art}: {v}");
    }
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
}

/// Spec-Szenario „Ausrücken bestätigt“: der Austritt nach dem Abruf nennt das Ziel.
#[tokio::test]
async fn ausruecken_nach_abruf_nennt_ziel_im_etb() {
    let l = abruf_lage().await;
    rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich}),
    )
    .await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", l.hlf, "austritt").await;
    let etb = etb_inhalte(&l.app, &l.admin, l.eid).await;
    assert!(
        etb.contains(&"HLF 20 rückt aus Bereitstellungsraum Sportplatz aus nach EA Deich".into()),
        "{etb:?}"
    );
    assert!(!etb.iter().any(|t| t.contains("verlässt")), "{etb:?}");
}

#[tokio::test]
async fn austritt_ohne_abruf_bleibt_verlaesst() {
    let l = abruf_lage().await;
    rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich}),
    )
    .await;
    hebe_auf(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", l.hlf, "austritt").await;
    let etb = etb_inhalte(&l.app, &l.admin, l.eid).await;
    assert!(
        etb.contains(&"HLF 20 verlässt Bereitstellungsraum Sportplatz".into()),
        "{etb:?}"
    );
    assert!(!etb.iter().any(|t| t.contains("rückt aus")), "{etb:?}");
}

/// Spec-Szenario „Verband rückt aus“: der Austritt des Zugs trägt die mitgenommenen Gruppen aus,
/// eine eigens abgerufene bleibt stehen.
#[tokio::test]
async fn austritt_nach_verbandsabruf_traegt_untereinheiten_aus() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let l = abruf_lage_mit(app, pool).await;
    let g1 = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 1").await;
    unterstellen(&l.pool, g1, l.hlf).await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", g1, "eintritt").await;
    rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich}),
    )
    .await;
    let mut rx = live.abonniere(l.eid);
    let v = belegen(&l.app, &l.admin, l.eid, l.br, "einheit", l.hlf, "austritt").await;
    assert_eq!(
        v["objekt_id"], l.hlf,
        "Antwort bleibt das Ereignis der Wurzel"
    );
    for id in [l.hlf, g1] {
        assert_eq!(juengstes(&l.pool, "einheit", id).await.0, "austritt");
    }
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert_eq!(d["einheiten"], json!([]), "{d}");
    // Die Wurzel meldet die Route wie bisher mit `objekt_id`, die Gruppe mit `einheit_id`.
    let mut einheiten = Vec::new();
    while let Ok(n) = rx.try_recv() {
        if n.event.as_str() == "einheit" {
            let data: serde_json::Value = serde_json::from_str(&n.data).unwrap();
            einheiten.push(data["einheit_id"].as_i64().or(data["objekt_id"].as_i64()));
        }
    }
    assert!(
        einheiten.contains(&Some(g1)),
        "Live für die Gruppe: {einheiten:?}"
    );
    assert!(
        einheiten.contains(&Some(l.hlf)),
        "Live für den Zug: {einheiten:?}"
    );
    assert!(etb_inhalte(&l.app, &l.admin, l.eid).await.contains(
        &"HLF 20 mit Gruppe 1 rückt aus Bereitstellungsraum Sportplatz aus nach EA Deich".into()
    ));
}

#[tokio::test]
async fn austritt_laesst_eigens_abgerufene_untereinheit_stehen() {
    let l = abruf_lage().await;
    let nord = abschnitt_anlegen(&l.app, &l.admin, l.eid, "EA Nord").await;
    let g1 = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 1").await;
    unterstellen(&l.pool, g1, l.hlf).await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", g1, "eintritt").await;
    rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": g1, "abschnitt_id": nord}),
    )
    .await;
    let (_, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich}),
    )
    .await;
    assert_eq!(v["mitgenommen"], json!([]), "{v}");
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", l.hlf, "austritt").await;
    let (art, ziel, _) = juengstes(&l.pool, "einheit", g1).await;
    assert_eq!((art.as_str(), ziel.as_deref()), ("abruf", Some("EA Nord")));
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert_eq!(d["einheiten"][0]["id"], g1, "{d}");
    assert_eq!(d["einheiten"][0]["abruf"]["ziel_anzeige"], "EA Nord");
}

/// Spec-Szenario „Abgerufene Kraft verlegen“: Wechsel einer abgerufenen Kraft 422, sie bleibt
/// abgerufen im Raum.
#[tokio::test]
async fn wechsel_einer_abgerufenen_kraft_422() {
    let l = abruf_lage().await;
    let schule = br_anlegen_und_aktivieren(&l.app, &l.admin, l.eid, "Schule").await;
    rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    let vorher = abruf_bestand(&l.pool, l.eid).await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("{}/belegung", br_pfad(l.eid, schule)),
        &l.admin,
        Some(&json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "art": "wechsel"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(abruf_bestand(&l.pool, l.eid).await, vorher);
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert!(d["einheiten"][0]["abruf"].is_object(), "{d}");
}

/// Spec „Abgerufene Kraft bleibt im Raum, bis sie ausrückt“: Belegung und Kennzahlen zählen sie;
/// Abruf mit Ziel und „seit“ nur an der einen.
#[tokio::test]
async fn abgerufene_kraft_bleibt_in_belegung_und_kennzahlen() {
    let l = abruf_lage().await;
    let zug = einheit_bilden(&l.app, &l.admin, l.eid, "Zug 2").await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", zug, "eintritt").await;
    let (_, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "abschnitt_id": l.deich}),
    )
    .await;
    let d = fetch_json(&l.app, &l.admin, &br_pfad(l.eid, l.br)).await;
    assert_eq!(d["belegung"]["einheiten"], 2, "{d}");
    let einheiten = d["einheiten"].as_array().unwrap();
    assert_eq!(einheiten.len(), 2);
    for e in einheiten {
        assert!(e["seit_at"].is_string(), "{e}");
        if e["id"] == l.hlf {
            assert_eq!(e["abruf"]["ziel_anzeige"], "EA Deich");
            assert_eq!(e["abruf"]["ziel_abschnitt_id"], l.deich);
            assert_eq!(e["abruf"]["seit_at"], v["abruf"]["zeitpunkt_at"]);
        } else {
            assert!(!e.as_object().unwrap().contains_key("abruf"), "{e}");
        }
    }
    let liste = fetch_json(
        &l.app,
        &l.admin,
        &format!("/api/einsaetze/{}/bereitstellungsraeume", l.eid),
    )
    .await;
    assert_eq!(liste[0]["belegung"]["einheiten"], 2);
}

/// Ein Raum mit einer abgerufenen Kraft lässt sich nicht auflösen (409 wie belegt).
#[tokio::test]
async fn raum_mit_abgerufener_kraft_ist_nicht_aufloesbar() {
    let l = abruf_lage().await;
    rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("{}/status", br_pfad(l.eid, l.br)),
        &l.admin,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
}

/// Spec „Abruf live“: `bereitstellungsraum` für den Raum, `einheit` je Einheit des Verbands,
/// mit Auftrag `auftrag`, dazu das ETB-Ereignis; ebenso bei der Rücknahme.
#[tokio::test]
async fn abruf_sendet_bereitstellungsraum_und_einheit() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let l = abruf_lage_mit(app, pool).await;
    let g1 = einheit_bilden(&l.app, &l.admin, l.eid, "Gruppe 1").await;
    unterstellen(&l.pool, g1, l.hlf).await;
    belegen(&l.app, &l.admin, l.eid, l.br, "einheit", g1, "eintritt").await;
    let mut rx = live.abonniere(l.eid);
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf, "auftrag_text": "Sandsack"}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let mut tags = Vec::new();
    let mut einheiten = Vec::new();
    let mut raeume = Vec::new();
    while let Ok(n) = rx.try_recv() {
        let data: serde_json::Value = serde_json::from_str(&n.data).unwrap_or_default();
        match n.event.as_str() {
            "einheit" => einheiten.push(data["einheit_id"].as_i64().unwrap()),
            "bereitstellungsraum" => raeume.push(data["br_id"].as_i64().unwrap()),
            _ => {}
        }
        tags.push(n.event.as_str().to_string());
    }
    einheiten.sort_unstable();
    assert_eq!(raeume, vec![l.br]);
    assert_eq!(einheiten, {
        let mut e = vec![l.hlf, g1];
        e.sort_unstable();
        e
    });
    assert!(tags.iter().any(|t| t == "auftrag"), "{tags:?}");
    assert!(tags.iter().any(|t| t == "etb"), "{tags:?}");

    let (s, _) = hebe_auf(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "einheit", "objekt_id": l.hlf}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let mut einheiten: Vec<i64> = objekt_ereignisse(&mut rx, &[("einheit", "einheit_id")])
        .into_iter()
        .map(|(_, id)| id)
        .collect();
    einheiten.sort_unstable();
    assert_eq!(einheiten.len(), 2, "{einheiten:?}");
}

#[tokio::test]
async fn abruf_fahrzeug_sendet_fahrzeug() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let l = abruf_lage_mit(app, pool).await;
    let fz = adhoc_fahrzeug(&l.app, &l.admin, l.eid, "Florian 1/83-1", None).await;
    belegen(&l.app, &l.admin, l.eid, l.br, "fahrzeug", fz, "eintritt").await;
    let mut rx = live.abonniere(l.eid);
    let (s, v) = rufe_ab(
        &l.app,
        &l.admin,
        l.eid,
        l.br,
        json!({"objekt_typ": "fahrzeug", "objekt_id": fz}),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let ereignisse = objekt_ereignisse(
        &mut rx,
        &[
            ("fahrzeug", "fahrzeug_id"),
            ("bereitstellungsraum", "br_id"),
        ],
    );
    assert!(
        ereignisse.contains(&("fahrzeug".into(), fz)),
        "{ereignisse:?}"
    );
    assert!(
        ereignisse.contains(&("bereitstellungsraum".into(), l.br)),
        "{ereignisse:?}"
    );
}
