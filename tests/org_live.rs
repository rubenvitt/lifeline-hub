//! Org-Ereignisse `einsatzliste` und `stammdaten` (LFH-734).
//!
//! Transport (Org-Strom `GET /api/live`, Mitführen im Einsatz-Strom), Auslöser und Empfänger.
//! Spec: `openspec/specs/org-live/`, Herleitung in der Change `lfh-734-org-live-ereignis`,
//! `design.md`.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::live::LiveEvent;
use tower::ServiceExt;

mod common;
use common::*;

/// Ein SSE-Frame, wie der Browser es sieht.
#[derive(Debug, PartialEq)]
struct Frame {
    id: Option<String>,
    event: String,
    data: String,
}

/// Zerlegt einen SSE-Ausschnitt in Frames mit `event:`; reine Kommentar-Frames fallen weg.
fn frames(roh: &str) -> Vec<Frame> {
    roh.split("\n\n")
        .filter_map(|block| {
            let mut id = None;
            let mut event = None;
            let mut data = String::new();
            for zeile in block.lines() {
                if let Some(v) = zeile.strip_prefix("id: ") {
                    id = Some(v.to_string());
                } else if let Some(v) = zeile.strip_prefix("event: ") {
                    event = Some(v.to_string());
                } else if let Some(v) = zeile.strip_prefix("data: ") {
                    data.push_str(v);
                }
            }
            event.map(|event| Frame { id, event, data })
        })
        .collect()
}

fn events(fs: &[Frame]) -> Vec<&str> {
    fs.iter().map(|f| f.event.as_str()).collect()
}

/// Öffnet einen SSE-Pfad mit optionaler `Last-Event-ID` und liefert die Response.
async fn oeffnen(
    app: &axum::Router,
    pfad: &str,
    cookie: Option<&str>,
    last_event_id: Option<&str>,
) -> axum::response::Response {
    let mut req = Request::builder().uri(pfad);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c.to_string());
    }
    if let Some(id) = last_event_id {
        req = req.header("last-event-id", id);
    }
    app.clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn org_von(pool: &sqlx::SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ---------- Org-Strom `GET /api/live` ----------

#[tokio::test]
async fn org_strom_ohne_sitzung_ist_401() {
    let app = setup().await;
    let resp = oeffnen(&app, "/api/live", None, None).await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn org_strom_beginnt_mit_dem_kommentar_verbunden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let resp = oeffnen(&app, "/api/live", Some(&admin), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let gelesen = sse_anfang_lesen(resp.into_body(), 200).await;
    assert!(gelesen.starts_with(": verbunden"), "{gelesen:?}");
}

#[tokio::test]
async fn org_strom_traegt_stammdaten_ohne_id_und_ohne_daten() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let resp = oeffnen(&app, "/api/live", Some(&admin), None).await;
    live.publiziere_stammdaten(org_von(&pool, "admin").await);

    let fs = frames(&sse_anfang_lesen(resp.into_body(), 300).await);
    assert_eq!(
        fs,
        vec![Frame {
            id: None,
            event: "stammdaten".into(),
            data: "{}".into()
        }]
    );
}

#[tokio::test]
async fn org_strom_traegt_keine_einsatz_ereignisse() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let resp = oeffnen(&app, "/api/live", Some(&admin), None).await;
    assert_eq!(resp.status(), StatusCode::OK);
    live.publiziere_event(eid, LiveEvent::Etb, "{}".into());
    live.publiziere_einsatz(eid, LiveEvent::Einsatz);

    let fs = frames(&sse_anfang_lesen(resp.into_body(), 300).await);
    assert!(fs.is_empty(), "{fs:?}");
}

#[tokio::test]
async fn org_strom_meldet_ueberlauf_als_lagged() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let resp = oeffnen(&app, "/api/live", Some(&admin), None).await;
    for _ in 0..(lifeline_hub::live::org::ORG_KANAL_KAPAZITAET + 10) {
        live.publiziere_stammdaten(org);
    }

    let fs = frames(&sse_anfang_lesen(resp.into_body(), 300).await);
    assert!(events(&fs).contains(&"lagged"), "{:?}", events(&fs));
}

// ---------- Einsatz-Strom trägt die Org-Ereignisse mit ----------

#[tokio::test]
async fn einsatz_strom_traegt_stammdaten_ohne_id() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let resp = oeffnen(
        &app,
        &format!("/api/einsaetze/{eid}/live"),
        Some(&admin),
        None,
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    live.publiziere_stammdaten(org_von(&pool, "admin").await);

    let fs = frames(&sse_anfang_lesen(resp.into_body(), 300).await);
    let stamm: Vec<&Frame> = fs.iter().filter(|f| f.event == "stammdaten").collect();
    assert_eq!(stamm.len(), 1, "{fs:?}");
    assert_eq!(
        stamm[0].id, None,
        "Org-Ereignisse tragen keine Id (design.md D4)"
    );
}

/// Ein Org-Ereignis zwischen zwei Einsatz-Ereignissen verschiebt den Replay nicht: nach einem
/// Reconnect mit der `Last-Event-ID` des ersten kommt genau das zweite nach, und das
/// Org-Ereignis wird nicht nachgeliefert (kein Ring, design.md D4).
#[tokio::test]
async fn org_ereignis_laesst_den_einsatz_replay_unberuehrt() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let pfad = format!("/api/einsaetze/{eid}/live");

    let erst = oeffnen(&app, &pfad, Some(&admin), None).await;
    live.publiziere_event(eid, LiveEvent::Etb, r#"{"n":1}"#.into());
    live.publiziere_stammdaten(org);
    live.publiziere_event(eid, LiveEvent::Etb, r#"{"n":2}"#.into());
    let fs = frames(&sse_anfang_lesen(erst.into_body(), 300).await);
    assert_eq!(events(&fs), vec!["etb", "stammdaten", "etb"], "{fs:?}");
    let erste_id = fs[0].id.clone().expect("Einsatz-Ereignis trägt eine Id");

    let wieder = oeffnen(&app, &pfad, Some(&admin), Some(&erste_id)).await;
    let nach = frames(&sse_anfang_lesen(wieder.into_body(), 300).await);
    assert_eq!(events(&nach), vec!["etb"], "{nach:?}");
    assert_eq!(nach[0].data, r#"{"n":2}"#);
    assert_eq!(nach[0].id, fs[2].id);
}

// ---------- Auslöser `einsatzliste` und ihre Empfänger (design.md D3, D5) ----------

use lifeline_hub::auth::Benutzer;
use lifeline_hub::live::org::{OrgAbonnent, OrgLiveEvent, OrgNachricht};
use tokio::sync::broadcast::Receiver;

/// Leert den Org-Empfänger und liefert alle bis hierher publizierten Nachrichten.
fn org_eingegangen(rx: &mut Receiver<OrgNachricht>) -> Vec<OrgNachricht> {
    let mut alle = Vec::new();
    while let Ok(n) = rx.try_recv() {
        alle.push(n);
    }
    alle
}

/// Wie viele der Nachrichten vom Typ `event` der Abonnent sehen darf.
fn erreicht(nachrichten: &[OrgNachricht], wer: &OrgAbonnent, event: OrgLiveEvent) -> usize {
    nachrichten
        .iter()
        .filter(|n| n.event == event && wer.sieht(n))
        .count()
}

async fn abonnent(pool: &sqlx::SqlitePool, benutzername: &str) -> OrgAbonnent {
    let b: Benutzer = sqlx::query_as("SELECT * FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap();
    OrgAbonnent::aus(&b)
}

/// Die Rollen, an denen sich die Empfängermenge von `einsatzliste` entscheidet.
struct Besetzung {
    admin: OrgAbonnent,
    fk: OrgAbonnent,
    ohne_bezug: OrgAbonnent,
    mitglied: OrgAbonnent,
    mitglied_id: i64,
    fremd_fk: OrgAbonnent,
    fremd_admin: OrgAbonnent,
}

async fn besetzung(app: &axum::Router, pool: &sqlx::SqlitePool, admin: &str) -> Besetzung {
    benutzer_anlegen(app, admin, "fuehrer", "fuehrungskraft").await;
    benutzer_anlegen(app, admin, "ohnebezug", "keine").await;
    let mitglied_id = benutzer_anlegen(app, admin, "mitglied", "keine").await;
    fremde_org_anlegen(pool, "Fremd-Org", "fremdfk", "fremdfkpw1", "fuehrungskraft").await;
    let (_, fremd_admin) =
        fremde_org_anlegen(pool, "Fremd-Org 2", "fremdadmin", "fremdadminpw1", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(fremd_admin)
        .execute(pool)
        .await
        .unwrap();
    Besetzung {
        admin: abonnent(pool, "admin").await,
        fk: abonnent(pool, "fuehrer").await,
        ohne_bezug: abonnent(pool, "ohnebezug").await,
        mitglied: abonnent(pool, "mitglied").await,
        mitglied_id,
        fremd_fk: abonnent(pool, "fremdfk").await,
        fremd_admin: abonnent(pool, "fremdadmin").await,
    }
}

#[tokio::test]
async fn anlage_erreicht_genau_die_leser_des_einsatzes() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = besetzung(&app, &pool, &admin).await;
    let mut rx = live.abonniere_org();

    einsatz_anlegen(&app, &admin).await;

    let alle = org_eingegangen(&mut rx);
    let el = OrgLiveEvent::Einsatzliste;
    assert_eq!(erreicht(&alle, &b.admin, el), 1, "{alle:?}");
    assert_eq!(erreicht(&alle, &b.fk, el), 1, "Führungskraft derselben Org");
    assert_eq!(
        erreicht(&alle, &b.fremd_admin, el),
        1,
        "System-Admin fremder Org"
    );
    assert_eq!(
        erreicht(&alle, &b.ohne_bezug, el),
        0,
        "Org-Benutzer ohne Bezug"
    );
    assert_eq!(erreicht(&alle, &b.mitglied, el), 0, "noch kein Mitglied");
    assert_eq!(
        erreicht(&alle, &b.fremd_fk, el),
        0,
        "Führungskraft fremder Org"
    );
}

#[tokio::test]
async fn abgelehnte_anlage_meldet_nichts() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    besetzung(&app, &pool, &admin).await;
    let ohne = login_cookie(&app, "ohnebezug", "ohnebezugpw1").await;
    let mut rx = live.abonniere_org();

    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/einsaetze",
        &ohne,
        Some(r#"{"bezeichnung":"X"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/einsaetze",
        &admin,
        Some(r#"{"bezeichnung":"  "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    assert!(org_eingegangen(&mut rx).is_empty());
}

/// Jeder Weg, der den Einsatzkopf ändert (`einsatz`), ändert auch eine Zeile der Liste: sie
/// zeigt dieselben Kopfspalten. Das Mitglied erhält beide Ereignisse.
#[tokio::test]
async fn kopfaenderungen_melden_einsatz_und_einsatzliste() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = besetzung(&app, &pool, &admin).await;
    let eid = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, eid, b.mitglied_id, "beobachter").await;
    let mut einsatz_rx = live.abonniere(eid);
    let mut rx = live.abonniere_org();

    let schritte: [(&str, String, Option<&str>); 4] = [
        (
            "PATCH",
            format!("/api/einsaetze/{eid}"),
            Some(r#"{"stichwort":"H 2"}"#),
        ),
        (
            "POST",
            format!("/api/einsaetze/{eid}/stab/lagebesprechungen"),
            Some(
                r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#,
            ),
        ),
        (
            "PUT",
            format!("/api/einsaetze/{eid}/aufbewahrungsfrist"),
            Some(r#"{"retention_bis":"2099-01-01 00:00:00","bestaetigt":true}"#),
        ),
        ("POST", format!("/api/einsaetze/{eid}/abschliessen"), None),
    ];
    for (methode, pfad, rumpf) in schritte {
        let (status, json) = anfrage(&app, methode, &pfad, &admin, rumpf).await;
        assert!(status.is_success(), "{methode} {pfad}: {status} {json:?}");
        let kopf = std::iter::from_fn(|| einsatz_rx.try_recv().ok())
            .filter(|n| n.event == LiveEvent::Einsatz)
            .count();
        assert_eq!(kopf, 1, "{methode} {pfad}: Vorbedingung `einsatz`");
        let alle = org_eingegangen(&mut rx);
        assert_eq!(
            erreicht(&alle, &b.mitglied, OrgLiveEvent::Einsatzliste),
            1,
            "{methode} {pfad}: {alle:?}"
        );
        assert_eq!(
            erreicht(&alle, &b.ohne_bezug, OrgLiveEvent::Einsatzliste),
            0
        );
    }
}

#[tokio::test]
async fn besprechung_ohne_neuen_termin_und_besetzung_melden_keine_einsatzliste() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere_org();

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{eid}/stab/lagebesprechungen"),
        &admin,
        Some(r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{eid}/stab/besetzung/s2"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert!(status.is_success());

    let alle = org_eingegangen(&mut rx);
    assert!(alle.is_empty(), "{alle:?}");
}

#[tokio::test]
async fn hinzugefuegtes_mitglied_erfaehrt_die_aenderung() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = besetzung(&app, &pool, &admin).await;
    let eid = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere_org();

    rolle_setzen(&app, &admin, eid, b.mitglied_id, "beobachter").await;

    let alle = org_eingegangen(&mut rx);
    assert_eq!(
        erreicht(&alle, &b.mitglied, OrgLiveEvent::Einsatzliste),
        1,
        "{alle:?}"
    );
    assert_eq!(
        erreicht(&alle, &b.ohne_bezug, OrgLiveEvent::Einsatzliste),
        0
    );
}

#[tokio::test]
async fn entferntes_mitglied_erfaehrt_die_aenderung_noch() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = besetzung(&app, &pool, &admin).await;
    let eid = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, eid, b.mitglied_id, "beobachter").await;
    let mut rx = live.abonniere_org();

    let (status, json) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{eid}/mitglieder/{}", b.mitglied_id),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let alle = org_eingegangen(&mut rx);
    assert_eq!(
        erreicht(&alle, &b.mitglied, OrgLiveEvent::Einsatzliste),
        1,
        "{alle:?}"
    );
    assert_eq!(
        erreicht(&alle, &b.ohne_bezug, OrgLiveEvent::Einsatzliste),
        0
    );
}

// ---------- Aufbewahrung: Soft-Delete durch den Scheduler, Wiederherstellen ----------

fn zeitpunkt(tage: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::days(tage))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Abgeschlossener Einsatz mit dem Mitglied aus `besetzung` und einer Frist in der Vergangenheit.
async fn faelliger_einsatz(
    app: &axum::Router,
    pool: &sqlx::SqlitePool,
    admin: &str,
    mitglied_id: i64,
) -> i64 {
    let eid = einsatz_anlegen(app, admin).await;
    rolle_setzen(app, admin, eid, mitglied_id, "beobachter").await;
    let (status, _) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{eid}/abschliessen"),
        admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    sqlx::query("UPDATE einsatz SET retention_bis = ? WHERE id = ?")
        .bind(zeitpunkt(-1))
        .bind(eid)
        .execute(pool)
        .await
        .unwrap();
    eid
}

#[tokio::test]
async fn soft_delete_durch_den_scheduler_meldet_einsatzliste() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = besetzung(&app, &pool, &admin).await;
    faelliger_einsatz(&app, &pool, &admin, b.mitglied_id).await;
    let mut rx = live.abonniere_org();

    let anzahl =
        lifeline_hub::einsatz::purge_scheduler::tick_einmal(&pool, &live, chrono::Utc::now()).await;
    assert_eq!(anzahl, 1, "Vorbedingung: Soft-Delete");

    let alle = org_eingegangen(&mut rx);
    assert_eq!(
        erreicht(&alle, &b.mitglied, OrgLiveEvent::Einsatzliste),
        1,
        "{alle:?}"
    );
    assert_eq!(
        erreicht(&alle, &b.ohne_bezug, OrgLiveEvent::Einsatzliste),
        0
    );
}

#[tokio::test]
async fn wiederherstellen_meldet_einsatzliste() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let b = besetzung(&app, &pool, &admin).await;
    let eid = faelliger_einsatz(&app, &pool, &admin, b.mitglied_id).await;
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind(zeitpunkt(-1))
        .bind(eid)
        .execute(&pool)
        .await
        .unwrap();
    let mut rx = live.abonniere_org();

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/aufbewahrung/einsaetze/{eid}/wiederherstellen"),
        &admin,
        Some(&format!(r#"{{"retention_bis":"{}"}}"#, zeitpunkt(90))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let alle = org_eingegangen(&mut rx);
    assert_eq!(
        erreicht(&alle, &b.mitglied, OrgLiveEvent::Einsatzliste),
        1,
        "{alle:?}"
    );
}
