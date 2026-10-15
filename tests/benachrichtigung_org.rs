//! Benachrichtigungen der Org-Ebene (Change `kcjecn9e-benachrichtigungskonzept`, tasks.md
//! Gruppe 15, Spec `benachrichtigungen`, „Aufnahme in einen Einsatz“ und „Neuer Einsatz“): die
//! Schreibwege `PUT /api/einsaetze/{id}/mitglieder/{benutzer_id}` und `POST /api/einsaetze`
//! melden über `benachrichtigung::melden` in den Org-Kanal (`org_benachrichtigung`), nur an ihre
//! Empfänger. Geprüft wird auch die Gegenseite: wer nichts bekommt (Auslöser, Nutzer ohne
//! Leserecht am Einsatz, fremde Org), dass ein Rollenwechsel oder eine wiederholte Anfrage nicht
//! erneut meldet und dass der Demo-Import still bleibt.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen_mit, fremde_org_anlegen, login_cookie,
    setup_mit_pool_und_live,
};

/// Öffnet den Org-Kanal `/api/live` für `cookie`; der Body bleibt offen.
async fn org_strom(app: &axum::Router, cookie: &str) -> axum::response::Response {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/live")
                .header(header::COOKIE, cookie.to_string())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp
}

/// Die Nutzlasten der `org_benachrichtigung`-Frames eines offenen Stroms.
async fn org_benachrichtigungen(resp: axum::response::Response) -> Vec<Value> {
    let roh = common::sse_anfang_lesen(resp.into_body(), 300).await;
    roh.split("\n\n")
        .filter(|block| block.lines().any(|z| z == "event: org_benachrichtigung"))
        .map(|block| {
            let data = block
                .lines()
                .find_map(|z| z.strip_prefix("data: "))
                .unwrap_or_else(|| panic!("Frame ohne data: {block:?}"));
            serde_json::from_str(data).unwrap()
        })
        .collect()
}

/// Die Benachrichtigungen in der Tabelle als `(benutzer_id, art, einsatz_id)`, sortiert.
async fn zeilen(pool: &sqlx::SqlitePool) -> Vec<(i64, String, i64)> {
    sqlx::query_as("SELECT benutzer_id, art, einsatz_id FROM benachrichtigung ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn mitglied_setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    benutzer_id: i64,
    body: Value,
) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer_id}"),
        cookie,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

// ───────────────────────── Aufnahme in einen Einsatz ─────────────────────────

/// Spec-Szenario „Aufnahme außerhalb eines Einsatzes“: Person A steht auf der Einsatzliste (hat
/// nur den Org-Kanal offen) und wird in „Hochwasser“ aufgenommen. A bekommt den Hinweis
/// „Aufgenommen in Hochwasser“ mit Sprung in den Einsatz; ein anderes Konto der Org und die
/// aufnehmende Einsatzleitung bekommen nichts.
#[tokio::test]
async fn aufnahme_ausserhalb_eines_einsatzes_erreicht_nur_den_aufgenommenen() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser").await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let anna_c = login_cookie(&app, "annika", "annikapw1").await;
    let bert_c = login_cookie(&app, "bertram", "bertrampw1").await;
    let vorher = zeilen(&pool).await;

    let anna_org = org_strom(&app, &anna_c).await;
    let bert_org = org_strom(&app, &bert_c).await;
    let admin_org = org_strom(&app, &admin).await;

    mitglied_setzen(
        &app,
        &admin,
        einsatz,
        anna,
        json!({ "einsatz_rolle": "fuehrungspersonal" }),
    )
    .await;

    let e = org_benachrichtigungen(anna_org).await;
    assert_eq!(e.len(), 1, "{e:?}");
    assert_eq!(e[0]["art"], "einsatz_aufnahme");
    assert_eq!(e[0]["stufe"], "hinweis");
    assert_eq!(e[0]["einsatz_id"], einsatz);
    assert_eq!(e[0]["bezug_typ"], "einsatz");
    assert_eq!(e[0]["bezug_id"], einsatz);
    for (wer, resp) in [("bertram", bert_org), ("admin (Auslöser)", admin_org)] {
        let e = org_benachrichtigungen(resp).await;
        assert!(e.is_empty(), "{wer}: {e:?}");
    }
    let neu: Vec<_> = zeilen(&pool)
        .await
        .into_iter()
        .filter(|z| !vorher.contains(z))
        .collect();
    assert_eq!(
        neu,
        vec![(anna, "einsatz_aufnahme".to_string(), einsatz)],
        "genau eine Zeile, für den Aufgenommenen"
    );

    let id = e[0]["benachrichtigung_id"].as_i64().unwrap();
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/benachrichtigungen/{id}"),
        &anna_c,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Aufgenommen in Hochwasser");
    assert_eq!(v["pfad"], format!("/einsaetze/{einsatz}"));
    assert!(
        !v.as_object().unwrap().contains_key("detail"),
        "die Bezeichnung steht schon im Titel: {v}"
    );
}

/// Ein Rollenwechsel, eine neue Funktion und dieselbe Anfrage noch einmal sind keine Aufnahme:
/// es bleibt bei dem einen Hinweis. Wer entfernt und wieder aufgenommen wird, wird neu
/// aufgenommen und erfährt es wieder.
#[tokio::test]
async fn rollenwechsel_und_wiederholung_melden_nicht_erneut() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser").await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let aufnahmen = |pool: sqlx::SqlitePool| async move {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM benachrichtigung WHERE art = 'einsatz_aufnahme' \
             AND benutzer_id = ?",
        )
        .bind(anna)
        .fetch_one(&pool)
        .await
        .unwrap()
    };

    let beobachter = json!({ "einsatz_rolle": "beobachter" });
    mitglied_setzen(&app, &admin, einsatz, anna, beobachter.clone()).await;
    assert_eq!(aufnahmen(pool.clone()).await, 1);

    mitglied_setzen(&app, &admin, einsatz, anna, beobachter).await;
    mitglied_setzen(
        &app,
        &admin,
        einsatz,
        anna,
        json!({ "einsatz_rolle": "fuehrungspersonal", "fuehrungsfunktion": "s4" }),
    )
    .await;
    assert_eq!(
        aufnahmen(pool.clone()).await,
        1,
        "Wiederholung und Rollenwechsel melden nicht"
    );

    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{anna}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    mitglied_setzen(
        &app,
        &admin,
        einsatz,
        anna,
        json!({ "einsatz_rolle": "beobachter" }),
    )
    .await;
    assert_eq!(aufnahmen(pool).await, 2, "erneute Aufnahme meldet wieder");
}

/// Eine abgewiesene Aufnahme (deaktiviertes Konto, 409) schreibt nichts und meldet nichts.
#[tokio::test]
async fn abgewiesene_aufnahme_meldet_nicht() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser").await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(anna)
        .execute(&pool)
        .await
        .unwrap();
    let vorher = zeilen(&pool).await;

    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/mitglieder/{anna}"),
        &admin,
        Some(r#"{"einsatz_rolle":"beobachter"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(zeilen(&pool).await, vorher);
}

// ───────────────────────── Neuer Einsatz ─────────────────────────

/// Spec-Szenario „Neuer Einsatz“: Führungskraft F darf den neuen Einsatz lesen und bekommt den
/// Hinweis „Neuer Einsatz“; Führungskraft G einer fremden Org darf ihn nicht lesen und erfährt
/// nichts, ebenso ein Konto der eigenen Org ohne Org-Rolle (liest nur seine Einsätze) und der
/// Anleger selbst. Der System-Admin der Org liest jeden Einsatz und bekommt ihn auch.
#[tokio::test]
async fn neuer_einsatz_erreicht_fuehrungskraefte_mit_leserecht_nicht_den_anleger() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let anleger = benutzer_anlegen(&app, &admin, "anleger", "fuehrungskraft").await;
    let f = benutzer_anlegen(&app, &admin, "fritz", "fuehrungskraft").await;
    let h = benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    let (_, g) =
        fremde_org_anlegen(&pool, "Fremd-Org", "gustav", "gustavpw1", "fuehrungskraft").await;
    let anleger_c = login_cookie(&app, "anleger", "anlegerpw1").await;
    let f_c = login_cookie(&app, "fritz", "fritzpw1").await;
    let h_c = login_cookie(&app, "helfer", "helferpw1").await;
    let g_c = login_cookie(&app, "gustav", "gustavpw1").await;
    let vorher = zeilen(&pool).await;

    let f_org = org_strom(&app, &f_c).await;
    let admin_org = org_strom(&app, &admin).await;
    let anleger_org = org_strom(&app, &anleger_c).await;
    let h_org = org_strom(&app, &h_c).await;
    let g_org = org_strom(&app, &g_c).await;

    let einsatz = einsatz_anlegen_mit(&app, &anleger_c, "Hochwasser").await;

    for (wer, resp) in [("fritz", f_org), ("admin", admin_org)] {
        let e = org_benachrichtigungen(resp).await;
        assert_eq!(e.len(), 1, "{wer}: {e:?}");
        assert_eq!(e[0]["art"], "einsatz_neu", "{wer}");
        assert_eq!(e[0]["einsatz_id"], einsatz, "{wer}");
        assert_eq!(e[0]["bezug_typ"], "einsatz", "{wer}");
    }
    for (wer, resp) in [
        ("Anleger", anleger_org),
        ("helfer ohne Leserecht", h_org),
        ("gustav, fremde Org", g_org),
    ] {
        let e = org_benachrichtigungen(resp).await;
        assert!(e.is_empty(), "{wer}: {e:?}");
    }

    let mut neu: Vec<_> = zeilen(&pool)
        .await
        .into_iter()
        .filter(|z| !vorher.contains(z))
        .collect();
    neu.sort();
    let mut erwartet = vec![
        (admin_id, "einsatz_neu".to_string(), einsatz),
        (f, "einsatz_neu".to_string(), einsatz),
    ];
    erwartet.sort();
    assert_eq!(neu, erwartet);
    assert!(!neu.iter().any(|(b, _, _)| [anleger, h, g].contains(b)));

    let id: i64 = sqlx::query_scalar(
        "SELECT id FROM benachrichtigung WHERE benutzer_id = ? AND art = 'einsatz_neu'",
    )
    .bind(f)
    .fetch_one(&pool)
    .await
    .unwrap();
    let pfad = format!("/api/benachrichtigungen/{id}");
    let (s, v) = anfrage(&app, "GET", &pfad, &f_c, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Neuer Einsatz");
    assert_eq!(v["detail"], "Hochwasser");
    assert_eq!(v["pfad"], format!("/einsaetze/{einsatz}"));
    for (wer, cookie) in [("helfer", &h_c), ("gustav", &g_c)] {
        let (s, _) = anfrage(&app, "GET", &pfad, cookie, None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{wer}");
    }
}

/// Eine abgewiesene Anlage (leere Bezeichnung, 400; Konto ohne Anlegerecht, 403) meldet nichts.
#[tokio::test]
async fn abgewiesene_anlage_meldet_nicht() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fritz", "fuehrungskraft").await;
    benutzer_anlegen(&app, &admin, "helfer", "keine").await;
    let h_c = login_cookie(&app, "helfer", "helferpw1").await;

    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/einsaetze",
        &admin,
        Some(r#"{"bezeichnung":"  "}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/einsaetze",
        &h_c,
        Some(r#"{"bezeichnung":"Hochwasser"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(zeilen(&pool).await.is_empty());
}

/// Der Demo-Import legt einen Einsatz an, ohne jemanden zu benachrichtigen: er ist kein
/// Einsatzgeschehen (`src/AGENTS.md`, Demo-Daten).
#[tokio::test]
async fn demo_import_meldet_keinen_neuen_einsatz() {
    let (app, pool) = common::setup_mit_optionen(RouterOptionen {
        demo_daten: true,
        zulassungs_budget: None,
        heic_decoder_verzeichnis: None,
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fritz", "fuehrungskraft").await;

    let (s, v) = anfrage(&app, "POST", "/api/demo-daten", &admin, None).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let einsaetze: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(einsaetze >= 1, "der Import legt einen Einsatz an");
    assert!(zeilen(&pool).await.is_empty());
}
