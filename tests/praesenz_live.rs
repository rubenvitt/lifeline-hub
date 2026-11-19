//! Präsenz an Einzelangaben im Einsatzstrom (LLH-1946, Entwurf
//! `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`, D2): am Replay-Ring
//! vorbei, ohne `id:`, Gate je Eintrag über das Bezugsereignis, Stand beim Verbinden.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

mod common;
use common::{
    benutzer_anlegen, einheit_bilden, einsatz_anlegen_mit, live_oeffnen, login_cookie,
    rolle_setzen, setup_mit_pool_und_live, sse_anfang_lesen,
};

use lifeline_hub::live::praesenz::{PraesenzEintrag, PraesenzObjekt};

fn eintrag(objekt: PraesenzObjekt, einheit_id: Option<i64>, feld: &str) -> PraesenzEintrag {
    PraesenzEintrag {
        objekt,
        einheit_id,
        felder: vec![feld.to_string()],
        benutzer_id: 9999,
        von: "Anna Präsent".to_string(),
        fenster: "fenster-a".to_string(),
    }
}

/// Die `praesenz`-Frames eines SSE-Ausschnitts: (id-Zeile vorhanden, Daten).
fn praesenz_frames(roh: &str) -> Vec<(bool, String)> {
    roh.split("\n\n")
        .filter(|b| b.lines().any(|z| z == "event: praesenz"))
        .map(|b| {
            let id = b.lines().any(|z| z.starts_with("id:"));
            let daten = b
                .lines()
                .find_map(|z| z.strip_prefix("data: "))
                .unwrap_or_default()
                .to_string();
            (id, daten)
        })
        .collect()
}

async fn override_setzen(app: &axum::Router, admin: &str, eid: i64, modul: &str) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/einsaetze/{eid}/modul-overrides/{modul}"))
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::COOKIE, admin.to_string())
                .body(Body::from(r#"{"sichtbar":false,"benoetigte_rolle":null}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn neuer_strom_bekommt_stand_beim_verbinden() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    live.praesenz_setzen(
        eid,
        eintrag(PraesenzObjekt::Einsatz, None, "leitstellen_nr"),
    )
    .unwrap();

    let feed = live_oeffnen(&app, &admin, eid).await;
    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    let frames = praesenz_frames(&gelesen);
    assert_eq!(frames.len(), 1, "{gelesen:?}");
    assert!(!frames[0].0, "Präsenz trägt kein id: {gelesen:?}");
    assert!(frames[0].1.contains("leitstellen_nr"), "{gelesen:?}");
    assert!(frames[0].1.contains("Anna Präsent"), "{gelesen:?}");
}

#[tokio::test]
async fn ohne_praesenz_kein_frame_beim_verbinden() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let feed = live_oeffnen(&app, &admin, eid).await;
    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    assert!(praesenz_frames(&gelesen).is_empty(), "{gelesen:?}");
}

#[tokio::test]
async fn aenderung_wird_verteilt_verlaengern_nicht() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let feed = live_oeffnen(&app, &admin, eid).await;

    let e = eintrag(PraesenzObjekt::Einsatz, None, "stichwort");
    live.praesenz_setzen(eid, e.clone()).unwrap();
    live.praesenz_setzen(eid, e).unwrap();
    live.praesenz_entfernen(eid, 9999, "fenster-a");

    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    let frames = praesenz_frames(&gelesen);
    assert_eq!(
        frames.len(),
        2,
        "Beginn und Ende, kein Verlängern: {gelesen:?}"
    );
    assert!(frames[0].1.contains("stichwort"));
    assert!(frames[1].1.contains(r#""eintraege":[]"#), "{gelesen:?}");
}

#[tokio::test]
async fn fremder_einsatz_erscheint_nicht() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Andere Lage").await;
    let feed = live_oeffnen(&app, &admin, eid).await;
    live.praesenz_setzen(anderer, eintrag(PraesenzObjekt::Einsatz, None, "stichwort"))
        .unwrap();
    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    assert!(praesenz_frames(&gelesen).is_empty(), "{gelesen:?}");
}

/// Ohne die Module, die eine Einheit offenlegen (`einheiten`, `lagekarte`, `verpflegung`), sieht
/// ein Mitglied keinen Einheit-Eintrag — weder im Stand beim Verbinden noch danach —, den
/// Einsatz-Eintrag aber schon.
#[tokio::test]
async fn ohne_einheiten_kein_einheit_eintrag() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let einheit = einheit_bilden(&app, &admin, eid, "Trupp 1").await;
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, eid, fid, "fuehrungspersonal").await;
    for modul in ["einheiten", "lagekarte", "verpflegung"] {
        override_setzen(&app, &admin, eid, modul).await;
    }
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;

    live.praesenz_setzen(
        eid,
        PraesenzEintrag {
            fenster: "fenster-b".into(),
            ..eintrag(PraesenzObjekt::Einheit, Some(einheit), "bemerkung")
        },
    )
    .unwrap();
    let feed = live_oeffnen(&app, &frieda, eid).await;
    live.praesenz_setzen(eid, eintrag(PraesenzObjekt::Einsatz, None, "stichwort"))
        .unwrap();

    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    let frames = praesenz_frames(&gelesen);
    assert_eq!(
        frames.len(),
        1,
        "nur der Stand mit dem Einsatz-Eintrag: {gelesen:?}"
    );
    assert!(frames[0].1.contains("stichwort"));
    assert!(!gelesen.contains("bemerkung"), "{gelesen:?}");
    assert!(!gelesen.contains(r#""einheit""#), "{gelesen:?}");
}
