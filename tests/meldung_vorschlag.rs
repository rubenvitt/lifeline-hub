//! Interne Routen der Meldungsvorschläge (LLH-2112): offene Vorschläge listen, einen als Meldung
//! übernehmen (derselbe Weg wie das Erfassen) oder verwerfen. Design-Doc
//! `docs/superpowers/specs/2026-11-28-jd4jgna4-maschinen-eingang-meldungen-design.md`,
//! „Interne Routen (Frontend)“.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::meldung::vorschlag::{einreichen_tx, Herkunft, NeuerVorschlag};
use lifeline_hub::public_api::scope::Scope;
use lifeline_hub::public_api::zugang;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool,
};

/// Ein Maschinenzugang der Org des Einsatzes.
async fn zugang_anlegen(pool: &sqlx::SqlitePool, einsatz: i64) -> String {
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap();
    let mut c = pool.acquire().await.unwrap();
    zugang::anlegen(
        &mut c,
        org,
        &format!("Z{}", uuid::Uuid::new_v4().simple()),
        &[Scope::MeldungenWrite],
        None,
        None,
        &lifeline_hub::zeit::jetzt(),
    )
    .await
    .unwrap()
}

/// Legt einen offenen Vorschlag an (empfangen jetzt) und liefert seine Kennung.
async fn vorschlag(
    pool: &sqlx::SqlitePool,
    einsatz: i64,
    zugang_id: &str,
    external_id: &str,
    text: &str,
) -> i64 {
    let herkunft = Herkunft {
        adapter: "funk-gateway".into(),
        kennung: "unit-7".into(),
        name: Some("Einheit 7".into()),
        signiert: true,
    };
    let jetzt = lifeline_hub::zeit::jetzt();
    let mut c = pool.acquire().await.unwrap();
    let (v, neu) = einreichen_tx(
        &mut c,
        &NeuerVorschlag {
            einsatz_id: einsatz,
            zugang_id,
            external_id,
            text,
            herkunft: &herkunft,
            gesendet_at: Some("2026-11-28 09:59:00"),
            empfangen_at: &jetzt,
        },
        &jetzt,
    )
    .await
    .unwrap();
    assert!(neu);
    v.id
}

fn meldung_koerper(inhalt: &str, client_id: Option<&str>) -> Value {
    let mut v = json!({
        "absender": "Einheit 7",
        "meldeweg": "sonstige",
        "inhalt": inhalt,
        "ereigniszeit": "2026-11-28 09:59:00"
    });
    if let Some(cid) = client_id {
        v["client_id"] = json!(cid);
    }
    v
}

fn liste_pfad(e: i64) -> String {
    format!("/api/incidents/{e}/report-suggestions")
}

async fn liste(app: &axum::Router, cookie: &str, e: i64) -> Vec<Value> {
    let (s, v) = anfrage(app, "GET", &liste_pfad(e), cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v.as_array().unwrap().clone()
}

async fn uebernehmen(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    vid: i64,
    body: &Value,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/incidents/{e}/report-suggestions/{vid}/accept"),
        cookie,
        Some(body),
    )
    .await
}

async fn verwerfen(app: &axum::Router, cookie: &str, e: i64, vid: i64) -> StatusCode {
    anfrage(
        app,
        "POST",
        &format!("/api/incidents/{e}/report-suggestions/{vid}/discard"),
        cookie,
        None,
    )
    .await
    .0
}

async fn meldungen_im_einsatz(pool: &sqlx::SqlitePool, e: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM meldung WHERE einsatz_id = ?")
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn liste_zeigt_offene_vorschlaege_aelteste_zuerst() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let z = zugang_anlegen(&pool, e).await;
    let a = vorschlag(&pool, e, &z, "a", "Erster").await;
    let b = vorschlag(&pool, e, &z, "b", "Zweiter").await;
    // Der zweite kam früher an: er steht vorn.
    sqlx::query("UPDATE meldung_vorschlag SET empfangen_at = datetime(empfangen_at, '-1 minute') WHERE id = ?")
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
    // Ein abgelaufener (älter als 12 Stunden) fehlt.
    let alt = vorschlag(&pool, e, &z, "c", "Alt").await;
    sqlx::query("UPDATE meldung_vorschlag SET empfangen_at = datetime(empfangen_at, '-13 hours') WHERE id = ?")
        .bind(alt)
        .execute(&pool)
        .await
        .unwrap();

    let l = liste(&app, &admin, e).await;
    let ids: Vec<i64> = l.iter().map(|v| v["id"].as_i64().unwrap()).collect();
    assert_eq!(ids, vec![b, a]);
    assert_eq!(l[0]["text"], "Zweiter");
    assert_eq!(l[0]["source"]["adapter"], "funk-gateway");
    assert_eq!(l[0]["source"]["sender_id"], "unit-7");
    assert_eq!(l[0]["source"]["sender_name"], "Einheit 7");
    assert_eq!(l[0]["source"]["signed"], true);
    assert_eq!(l[0]["sent_at"], "2026-11-28 09:59:00");
    assert!(l[0]["received_at"].is_string());
}

#[tokio::test]
async fn uebernahme_legt_meldung_mit_herkunft_an_und_schreibt_etb_nur_mit_auto_etb() {
    for auto_etb in [true, false] {
        let (app, pool) = setup_mit_pool().await;
        let admin = login_cookie(&app, "admin", "startpw12").await;
        let e = einsatz_anlegen(&app, &admin).await;
        if !auto_etb {
            let (s, _) = anfrage(
                &app,
                "PUT",
                &format!("/api/incidents/{e}/settings"),
                &admin,
                Some(r#"{"auto_etb_eintraege":false}"#),
            )
            .await;
            assert_eq!(s, StatusCode::OK);
        }
        let z = zugang_anlegen(&pool, e).await;
        let vid = vorschlag(&pool, e, &z, "a", "Verletzte Person am Nordtor").await;

        let (s, m) = uebernehmen(
            &app,
            &admin,
            e,
            vid,
            &meldung_koerper("Verletzte Person am Nordtor", None),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{m}");
        assert_eq!(m["inhalt"], "Verletzte Person am Nordtor");
        assert_eq!(
            m["maschinen_herkunft"],
            json!({"adapter": "funk-gateway", "kennung": "unit-7", "name": "Einheit 7", "signiert": true})
        );
        assert_eq!(m["etb_meldung_id"].is_i64(), auto_etb, "{m}");
        assert!(liste(&app, &admin, e).await.is_empty());

        // Die Herkunft steht auch in der Liste der Meldungen.
        let (_, meldungen) = anfrage(
            &app,
            "GET",
            &format!("/api/incidents/{e}/reports"),
            &admin,
            None,
        )
        .await;
        assert_eq!(
            meldungen[0]["maschinen_herkunft"]["adapter"],
            "funk-gateway"
        );
        let (status, text, meldung_id): (String, Option<String>, Option<i64>) =
            sqlx::query_as("SELECT status, text, meldung_id FROM meldung_vorschlag WHERE id = ?")
                .bind(vid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status, "angenommen");
        assert_eq!(text, None);
        assert_eq!(meldung_id, m["id"].as_i64());
    }
}

#[tokio::test]
async fn eine_erfasste_meldung_traegt_keine_maschinen_herkunft() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, m) = anfrage_json(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reports"),
        &admin,
        Some(&meldung_koerper("Von Hand", None)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    assert!(m.get("maschinen_herkunft").is_none(), "{m}");
}

#[tokio::test]
async fn uebernahme_eines_abgelaufenen_oder_angenommenen_vorschlags_ist_409() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let z = zugang_anlegen(&pool, e).await;

    // Angenommen von einer zweiten Person: die zweite Übernahme (andere client_id) ist 409.
    let vid = vorschlag(&pool, e, &z, "a", "Text").await;
    let (s, m) = uebernehmen(&app, &admin, e, vid, &meldung_koerper("Text", Some("c-1"))).await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    let (s, v) = uebernehmen(&app, &admin, e, vid, &meldung_koerper("Text", Some("c-2"))).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(meldungen_im_einsatz(&pool, e).await, 1);

    // Abgelaufen (älter als 12 Stunden): 409, keine Meldung.
    let alt = vorschlag(&pool, e, &z, "b", "Alt").await;
    sqlx::query("UPDATE meldung_vorschlag SET empfangen_at = datetime(empfangen_at, '-13 hours') WHERE id = ?")
        .bind(alt)
        .execute(&pool)
        .await
        .unwrap();
    let (s, v) = uebernehmen(&app, &admin, e, alt, &meldung_koerper("Alt", None)).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(meldungen_im_einsatz(&pool, e).await, 1);
}

#[tokio::test]
async fn wiederholte_uebernahme_mit_derselben_client_id_liefert_dieselbe_meldung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let z = zugang_anlegen(&pool, e).await;
    let vid = vorschlag(&pool, e, &z, "a", "Text").await;
    let body = meldung_koerper("Text", Some("queue-1"));

    let (s1, m1) = uebernehmen(&app, &admin, e, vid, &body).await;
    assert_eq!(s1, StatusCode::CREATED, "{m1}");
    let (s2, m2) = uebernehmen(&app, &admin, e, vid, &body).await;
    assert_eq!(s2, StatusCode::CREATED, "{m2}");
    assert_eq!(m1["id"], m2["id"]);
    assert_eq!(meldungen_im_einsatz(&pool, e).await, 1);
}

#[tokio::test]
async fn verwerfen_entfernt_den_vorschlag_und_legt_nichts_an() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let z = zugang_anlegen(&pool, e).await;
    let vid = vorschlag(&pool, e, &z, "a", "Text").await;

    assert_eq!(
        verwerfen(&app, &admin, e, vid).await,
        StatusCode::NO_CONTENT
    );
    assert!(liste(&app, &admin, e).await.is_empty());
    assert_eq!(meldungen_im_einsatz(&pool, e).await, 0);
    assert_eq!(verwerfen(&app, &admin, e, vid).await, StatusCode::CONFLICT);
    let status: String = sqlx::query_scalar("SELECT status FROM meldung_vorschlag WHERE id = ?")
        .bind(vid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "verworfen");
}

/// `POST /api/devices/pair` ohne Sitzung: liefert das Sitzungscookie des Geräts.
async fn geraet_koppeln(app: &axum::Router, admin: &str, e: i64) -> String {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/incidents/{e}/devices"),
        admin,
        Some(&json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap();
    let req = Request::builder()
        .method("POST")
        .uri("/api/devices/pair")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie = resp
        .headers()
        .get(header::SET_COOKIE)
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string())
        .expect("Sitzungscookie");
    let _ = to_bytes(resp.into_body(), usize::MAX).await;
    cookie
}

#[tokio::test]
async fn geraet_bekommt_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let z = zugang_anlegen(&pool, e).await;
    let vid = vorschlag(&pool, e, &z, "a", "Text").await;
    let geraet = geraet_koppeln(&app, &admin, e).await;

    let (s, _) = anfrage(&app, "GET", &liste_pfad(e), &geraet, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = uebernehmen(&app, &geraet, e, vid, &meldung_koerper("Text", None)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(
        verwerfen(&app, &geraet, e, vid).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(meldungen_im_einsatz(&pool, e).await, 0);
    assert_eq!(liste(&app, &admin, e).await.len(), 1);
}

#[tokio::test]
async fn am_spiegel_lehnen_uebernahme_und_verwerfen_ab() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let z = zugang_anlegen(&pool, e).await;
    let a = vorschlag(&pool, e, &z, "a", "Text").await;
    let b = vorschlag(&pool, e, &z, "b", "Text").await;
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "INSERT INTO spiegel_uebernahme (id) VALUES (1); \
         INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES ({e}, 'fremd/{e}'); \
         DELETE FROM spiegel_uebernahme"
    )))
    .execute(&pool)
    .await
    .unwrap();

    let (s, v) = uebernehmen(&app, &admin, e, a, &meldung_koerper("Text", None)).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(verwerfen(&app, &admin, e, b).await, StatusCode::CONFLICT);
    assert_eq!(meldungen_im_einsatz(&pool, e).await, 0);
    let offen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM meldung_vorschlag WHERE einsatz_id = ? AND status = 'offen'",
    )
    .bind(e)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(offen, 2);
}

#[tokio::test]
async fn vorschlag_eines_anderen_einsatzes_ist_404() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let z = zugang_anlegen(&pool, e1).await;
    let vid = vorschlag(&pool, e1, &z, "a", "Text").await;

    let (s, v) = uebernehmen(&app, &admin, e2, vid, &meldung_koerper("Text", None)).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
    assert_eq!(
        verwerfen(&app, &admin, e2, vid).await,
        StatusCode::NOT_FOUND
    );
    assert!(liste(&app, &admin, e2).await.is_empty());
    assert_eq!(liste(&app, &admin, e1).await.len(), 1);
    assert_eq!(meldungen_im_einsatz(&pool, e2).await, 0);
}

#[tokio::test]
async fn mitarbeit_darf_vorschlaege_lesen_aber_nicht_uebernehmen_oder_verwerfen() {
    // Übernehmen und Verwerfen stehen nicht auf der Positivliste des Erfassens (ADR-0072):
    // Erfassungsrecht ohne Schreibrecht reicht nicht.
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let id = benutzer_anlegen(&app, &admin, "mitarbeiter", "keine").await;
    rolle_setzen(&app, &admin, e, id, "mitarbeit").await;
    let mit = login_cookie(&app, "mitarbeiter", "mitarbeiterpw1").await;
    let z = zugang_anlegen(&pool, e).await;
    let vid = vorschlag(&pool, e, &z, "a", "Text").await;

    assert_eq!(liste(&app, &mit, e).await.len(), 1);
    let (s, v) = uebernehmen(&app, &mit, e, vid, &meldung_koerper("Text", None)).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(verwerfen(&app, &mit, e, vid).await, StatusCode::FORBIDDEN);
    assert_eq!(meldungen_im_einsatz(&pool, e).await, 0);
    assert_eq!(liste(&app, &admin, e).await.len(), 1);
}
