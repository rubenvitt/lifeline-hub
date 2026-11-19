//! Präsenz an Einzelangaben im Einsatzstrom (LLH-1946, Entwurf
//! `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`, D2): am Replay-Ring
//! vorbei, ohne `id:`, Gate je Eintrag über das Bezugsereignis, Stand beim Verbinden.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einheit_bilden, einsatz_anlegen_mit, fremde_org_anlegen,
    live_oeffnen, login_cookie, rolle_setzen, setup_mit_pool_und_live, sse_anfang_lesen,
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

/// Auch ein leerer Stand geht beim Verbinden hinaus: er ersetzt im Client, was eine abgerissene
/// Verbindung zuletzt kannte (kein Geisterhinweis nach dem Neuaufbau).
#[tokio::test]
async fn leerer_stand_geht_beim_verbinden_hinaus() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let feed = live_oeffnen(&app, &admin, eid).await;
    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    let frames = praesenz_frames(&gelesen);
    assert_eq!(frames.len(), 1, "{gelesen:?}");
    assert!(frames[0].1.contains(r#""eintraege":[]"#), "{gelesen:?}");
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
    live.praesenz_entfernen(eid, &eintrag(PraesenzObjekt::Einsatz, None, "stichwort"));

    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    let frames = praesenz_frames(&gelesen);
    assert_eq!(
        frames.len(),
        3,
        "Stand beim Verbinden, Beginn und Ende, kein Verlängern: {gelesen:?}"
    );
    assert!(frames[1].1.contains("stichwort"));
    assert!(frames[2].1.contains(r#""eintraege":[]"#), "{gelesen:?}");
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
    let frames = praesenz_frames(&gelesen);
    assert_eq!(
        frames.len(),
        1,
        "nur der leere Stand beim Verbinden: {gelesen:?}"
    );
    assert!(!gelesen.contains("stichwort"), "{gelesen:?}");
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
        2,
        "leerer Stand beim Verbinden, dann der mit dem Einsatz-Eintrag: {gelesen:?}"
    );
    assert!(frames[0].1.contains(r#""eintraege":[]"#), "{gelesen:?}");
    assert!(frames[1].1.contains("stichwort"));
    assert!(!gelesen.contains("bemerkung"), "{gelesen:?}");
    assert!(!gelesen.contains(r#""einheit""#), "{gelesen:?}");
}

// ---------- Schreibwege (Entwurf D4) ----------

fn pfad(eid: i64) -> String {
    format!("/api/einsaetze/{eid}/praesenz")
}

fn einheit_pfad(eid: i64, einheit: i64) -> String {
    format!("/api/einsaetze/{eid}/einheiten/{einheit}/praesenz")
}

#[tokio::test]
async fn put_setzt_und_strom_zeigt_den_namen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let feed = live_oeffnen(&app, &admin, eid).await;

    let (s, _) = anfrage(
        &app,
        "PUT",
        &pfad(eid),
        &admin,
        Some(r#"{"objekt":"einsatz","felder":["leitstellen_nr"],"fenster":"tab-1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &pfad(eid),
        &admin,
        Some(r#"{"objekt":"einsatz","felder":["leitstellen_nr"],"fenster":"tab-1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &pfad(eid),
        &admin,
        Some(r#"{"objekt":"einsatz","felder":["leitstellen_nr"],"fenster":"tab-1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "DELETE ist idempotent");

    let gelesen = sse_anfang_lesen(feed.into_body(), 300).await;
    let frames = praesenz_frames(&gelesen);
    assert_eq!(frames.len(), 3, "{gelesen:?}");
    assert!(frames[1].1.contains("leitstellen_nr"), "{gelesen:?}");
    assert!(frames[1].1.contains(r#""fenster":"tab-1""#), "{gelesen:?}");
    assert!(frames[1].1.contains(r#""von":""#), "{gelesen:?}");
    assert!(frames[2].1.contains(r#""eintraege":[]"#), "{gelesen:?}");
}

#[tokio::test]
async fn einheit_praesenz_ueber_ihre_route() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let einheit = einheit_bilden(&app, &admin, eid, "Trupp 1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &einheit_pfad(eid, einheit),
        &admin,
        Some(r#"{"felder":["bemerkung"],"fenster":"tab-1"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let stand = live.praesenz_stand(eid);
    assert_eq!(stand.eintraege.len(), 1);
    assert_eq!(stand.eintraege[0].objekt, PraesenzObjekt::Einheit);
    assert_eq!(stand.eintraege[0].einheit_id, Some(einheit));
}

#[tokio::test]
async fn ungueltige_meldungen_sind_400() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let einheit = einheit_bilden(&app, &admin, eid, "Trupp 1").await;
    for body in [
        r#"{"objekt":"einsatz","felder":["gibtsnicht"],"fenster":"t"}"#,
        r#"{"objekt":"einsatz","felder":[],"fenster":"t"}"#,
        r#"{"objekt":"einsatz","felder":["bezeichnung","stichwort","einsatzart","sachverhalt","einsatzort"],"fenster":"t"}"#,
        r#"{"objekt":"einsatz","felder":["bezeichnung"],"fenster":"a b"}"#,
        r#"{"objekt":"einheit","felder":["bemerkung"],"fenster":"t"}"#,
        r#"{"objekt":"gibtsnicht","felder":["bezeichnung"],"fenster":"t"}"#,
    ] {
        let (s, v) = anfrage(&app, "PUT", &pfad(eid), &admin, Some(body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    let (s, v) = anfrage(
        &app,
        "PUT",
        &einheit_pfad(eid, einheit),
        &admin,
        Some(r#"{"felder":["leitstellen_nr"],"fenster":"t"}"#),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "Einsatzfeld an der Einheit: {v}"
    );
}

#[tokio::test]
async fn ohne_schreibrecht_403_fremde_einheit_404_fremde_org_wie_patch() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let eid = einsatz_anlegen_mit(&app, &admin, "Lage").await;
    let einheit = einheit_bilden(&app, &admin, eid, "Trupp 1").await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Andere Lage").await;
    let fremde_einheit = einheit_bilden(&app, &admin, anderer, "Trupp 2").await;
    let bid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, eid, bid, "beobachter").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let einsatz_body = r#"{"objekt":"einsatz","felder":["stichwort"],"fenster":"t"}"#;
    let einheit_body = r#"{"felder":["bemerkung"],"fenster":"t"}"#;

    let (s, _) = anfrage(&app, "PUT", &pfad(eid), &frieda, Some(einsatz_body)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "PUT",
        &einheit_pfad(eid, einheit),
        &frieda,
        Some(einheit_body),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    let (s, _) = anfrage(
        &app,
        "PUT",
        &einheit_pfad(eid, fremde_einheit),
        &admin,
        Some(einheit_body),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    fremde_org_anlegen(&pool, "Fremde Org", "fremd", "fremdpw12", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw12").await;
    let (s, _) = anfrage(&app, "PUT", &pfad(eid), &fremd, Some(einsatz_body)).await;
    let (patch, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{eid}"),
        &fremd,
        Some(r#"{"stichwort":"x"}"#),
    )
    .await;
    assert!(s.is_client_error(), "fremde Org: {s}");
    assert_eq!(s, patch, "fremde Org antwortet wie der PATCH daneben");
}
