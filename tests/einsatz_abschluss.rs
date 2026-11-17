//! Abschluss und Wiederöffnen eines Einsatzes (LLH-1814, Spec `einsatz-abschluss`, Change
//! `sa41jgmj-einsatz-abschluss-absichern`).

use axum::http::StatusCode;
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen, login_cookie, setup_mit_pool};

async fn benutzer_id(pool: &SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn abschliessen(app: &axum::Router, cookie: &str, id: i64) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        cookie,
        None,
    )
    .await
}

/// System-Einträge des ETB in Schreibreihenfolge: (lfd_nr, inhalt, erfasser_id).
async fn system_eintraege(pool: &SqlitePool, id: i64) -> Vec<(i64, String, i64)> {
    sqlx::query_as(
        "SELECT lfd_nr, inhalt, erfasser_id FROM etb_eintrag \
         WHERE einsatz_id = ? AND typ = 'system' ORDER BY lfd_nr",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap()
}

// ── 1. Abschluss im ETB (D3) ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn abschluss_schreibt_genau_einen_eintrag_einsatz_abgeschlossen_mit_der_abschliessenden_person(
) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id = benutzer_id(&pool, "admin").await;
    let id = einsatz_anlegen(&app, &admin).await;

    let (status, body) = abschliessen(&app, &admin, id).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let eintraege = system_eintraege(&pool, id).await;
    let abschluss: Vec<_> = eintraege
        .iter()
        .filter(|(_, inhalt, _)| inhalt == "Einsatz abgeschlossen")
        .collect();
    assert_eq!(abschluss.len(), 1, "{eintraege:?}");
    assert_eq!(
        abschluss[0].2, admin_id,
        "Erfasser ist die abschließende Person"
    );

    // Ein zweiter Aufruf am abgeschlossenen Einsatz schreibt nichts, weder über die Route (409)
    // noch über den Repo-Vorgang selbst (kein Re-Close).
    let (status, _) = abschliessen(&app, &admin, id).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let ergebnis = lifeline_hub::einsatz::repo::abschliessen(&pool, id, admin_id)
        .await
        .unwrap();
    assert!(ergebnis.etb_eintrag_ids.is_empty());
    assert_eq!(system_eintraege(&pool, id).await, eintraege);
}

#[tokio::test]
async fn der_abschluss_eintrag_steht_vor_den_frist_eintraegen_und_wird_mitgemeldet() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, body) = anfrage_json(
        &app,
        "PUT",
        "/api/org-einstellungen",
        &admin,
        Some(&json!({ "retention_dauer_tage": 30, "nachbereitung_tage": 7 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = einsatz_anlegen(&app, &admin).await;
    let vorher: Vec<i64> = system_eintraege(&pool, id)
        .await
        .into_iter()
        .map(|(lfd, _, _)| lfd)
        .collect();

    let admin_id = benutzer_id(&pool, "admin").await;
    let ergebnis = lifeline_hub::einsatz::repo::abschliessen(&pool, id, admin_id)
        .await
        .unwrap();

    let neu: Vec<_> = system_eintraege(&pool, id)
        .await
        .into_iter()
        .filter(|(lfd, _, _)| !vorher.contains(lfd))
        .collect();
    assert_eq!(neu.len(), 3, "{neu:?}");
    assert_eq!(neu[0].1, "Einsatz abgeschlossen", "{neu:?}");
    assert!(neu[1]
        .1
        .starts_with("Aufbewahrungsfrist automatisch gesetzt"));
    assert!(neu[2].1.starts_with("Nachbereitung bis"));
    assert_eq!(
        ergebnis.etb_eintrag_ids.len(),
        3,
        "jede Kennung wird live gemeldet"
    );
}
