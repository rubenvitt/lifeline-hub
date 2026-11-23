//! Schlüsselwechsel des Geheimnisspeichers (LLH-2025, ADR-0077): Der Start mit neuem und altem
//! Schlüssel schlüsselt alle Geheimnisse um; danach läuft jeder Adapter mit dem neuen allein
//! weiter, und die Verwaltung zeigt „bereit“. Mit einer Test-Art, ohne Netz.

use axum::http::StatusCode;
use chrono::Utc;
use lifeline_hub::adapter::art::Verzeichnis;
use lifeline_hub::adapter::geheimnis::{GeheimnisSchluessel, Geheimnisspeicher};
use lifeline_hub::adapter::lauf::{durchgang, umschluesseln, Umschluesselt};
use lifeline_hub::adapter::Rahmen;
use serde_json::json;
use std::sync::Arc;

mod adapter_testart;
mod common;
use common::{anfrage_json, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";
const TOKEN: &str = "token-0815";

struct Umgebung {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    art: Arc<adapter_testart::TestArt>,
    alt: GeheimnisSchluessel,
    admin: String,
}

/// Ein Bestand mit einem Adapter, dessen Token am Schlüssel `alt` liegt.
async fn umgebung() -> (Umgebung, String) {
    let (rahmen, art, alt) = adapter_testart::rahmen();
    let r = rahmen.clone();
    let (app, pool) = setup_mit_state(move |s| s.adapter = r).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        LISTE,
        &admin,
        Some(&json!({ "art": "test", "name": "Quelle", "intervall_s": 60 })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = v["id"].as_str().unwrap().to_string();
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("{LISTE}/{id}/secrets/token"),
        &admin,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    (
        Umgebung {
            app,
            pool,
            art,
            alt,
            admin,
        },
        id,
    )
}

fn rahmen(art: &Arc<adapter_testart::TestArt>, speicher: Geheimnisspeicher) -> Rahmen {
    Rahmen::new(speicher, Verzeichnis::new(vec![art.clone()]))
}

fn fp(s: &GeheimnisSchluessel) -> String {
    Geheimnisspeicher::new(Some(s.clone()))
        .fingerabdruck()
        .unwrap()
        .to_string()
}

async fn zeilen(pool: &sqlx::SqlitePool) -> Vec<(String, Vec<u8>, String, Option<i64>)> {
    sqlx::query_as(
        "SELECT schluessel_fp, chiffrat, gesetzt_at, gesetzt_von FROM adapter_geheimnis \
         ORDER BY adapter_id, name",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn wechsel_schluesselt_um_und_adapter_laeuft_weiter() {
    let (u, id) = umgebung().await;
    let neu = GeheimnisSchluessel::generate();
    let wechsel = Geheimnisspeicher::new_wechsel(neu.clone(), u.alt.clone()).unwrap();

    let ergebnis = umschluesseln(&u.pool, &wechsel).await.unwrap();
    assert_eq!(
        ergebnis,
        Umschluesselt {
            umgeschluesselt: 1,
            unlesbar: 0,
            uebrig: 0
        }
    );
    for (fp_zeile, ..) in zeilen(&u.pool).await {
        assert_eq!(fp_zeile, fp(&neu));
    }

    // Neustart nur mit dem neuen Schlüssel: der Adapter ruft mit dem Token ab.
    let nur_neu = rahmen(&u.art, Geheimnisspeicher::new(Some(neu)));
    u.art.plane(Ok(1));
    durchgang(
        &u.pool,
        &nur_neu,
        &lifeline_hub::live::LiveHub::new(),
        Utc::now(),
    )
    .await
    .unwrap();
    let gesehen = u.art.gesehen();
    assert_eq!(gesehen.len(), 1);
    assert_eq!(gesehen[0].token.as_deref(), Some(TOKEN));

    // Die Verwaltung mit dem neuen Schlüssel zeigt „bereit“.
    let app2 = lifeline_hub::app::build_router(lifeline_hub::app::AppState {
        adapter: nur_neu,
        ..common::test_state(&u.pool, &lifeline_hub::live::LiveHub::new())
    });
    let admin2 = login_cookie(&app2, "admin", "startpw12").await;
    let (_, liste) = anfrage_json(&app2, "GET", LISTE, &admin2, None).await;
    assert_eq!(liste["speicher"], "bereit");
    assert_eq!(liste["adapter"][0]["geheimnisse"][0]["is_unlesbar"], false);
    let (_, a) = anfrage_json(&app2, "GET", &format!("{LISTE}/{id}"), &admin2, None).await;
    assert_eq!(a["zustand"], "ok", "{a}");
}

#[tokio::test]
async fn zweiter_lauf_aendert_nichts() {
    let (u, _) = umgebung().await;
    let wechsel =
        Geheimnisspeicher::new_wechsel(GeheimnisSchluessel::generate(), u.alt.clone()).unwrap();
    umschluesseln(&u.pool, &wechsel).await.unwrap();
    let vorher = zeilen(&u.pool).await;
    assert_eq!(
        umschluesseln(&u.pool, &wechsel).await.unwrap(),
        Umschluesselt::default()
    );
    assert_eq!(zeilen(&u.pool).await, vorher);
}

#[tokio::test]
async fn kaputte_zeile_bleibt() {
    let (u, id) = umgebung().await;
    sqlx::query(
        "INSERT INTO adapter_geheimnis (adapter_id, name, chiffrat, schluessel_fp) \
         VALUES (?, 'kaputt', x'00', ?)",
    )
    .bind(&id)
    .bind(fp(&u.alt))
    .execute(&u.pool)
    .await
    .unwrap();
    let neu = GeheimnisSchluessel::generate();
    let wechsel = Geheimnisspeicher::new_wechsel(neu.clone(), u.alt.clone()).unwrap();

    assert_eq!(
        umschluesseln(&u.pool, &wechsel).await.unwrap(),
        Umschluesselt {
            umgeschluesselt: 1,
            unlesbar: 1,
            uebrig: 1
        }
    );
    let fp_kaputt: String =
        sqlx::query_scalar("SELECT schluessel_fp FROM adapter_geheimnis WHERE name = 'kaputt'")
            .fetch_one(&u.pool)
            .await
            .unwrap();
    assert_eq!(fp_kaputt, fp(&u.alt));
    assert_eq!(
        lifeline_hub::adapter::repo::count_fremde_chiffrate(&u.pool, Some(&fp(&neu)))
            .await
            .unwrap(),
        1
    );
}

/// Ein falscher alter Schlüssel öffnet nichts: dann darf der Start nicht melden, er könne weg
/// (Review LLH-2025), sonst wirft der Betreiber den echten weg.
#[tokio::test]
async fn falscher_alter_schluessel_laesst_rest() {
    let (u, _) = umgebung().await;
    let wechsel = Geheimnisspeicher::new_wechsel(
        GeheimnisSchluessel::generate(),
        GeheimnisSchluessel::generate(),
    )
    .unwrap();
    let vorher = zeilen(&u.pool).await;
    assert_eq!(
        umschluesseln(&u.pool, &wechsel).await.unwrap(),
        Umschluesselt {
            umgeschluesselt: 0,
            unlesbar: 0,
            uebrig: 1
        }
    );
    assert_eq!(zeilen(&u.pool).await, vorher);
}

#[tokio::test]
async fn ohne_alten_schluessel_nichts() {
    let (u, _) = umgebung().await;
    let vorher = zeilen(&u.pool).await;
    let nur_alt = Geheimnisspeicher::new(Some(u.alt.clone()));
    assert_eq!(
        umschluesseln(&u.pool, &nur_alt).await.unwrap(),
        Umschluesselt::default()
    );
    assert_eq!(zeilen(&u.pool).await, vorher);
}

#[tokio::test]
async fn gesetzt_von_und_stand_bleiben() {
    let (u, id) = umgebung().await;
    let stand = |pool: sqlx::SqlitePool, id: String| async move {
        sqlx::query_scalar::<_, i64>("SELECT stand FROM adapter WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
    };
    let stand_vorher = stand(u.pool.clone(), id.clone()).await;
    let (_, _, gesetzt_at, gesetzt_von) = zeilen(&u.pool).await.remove(0);
    assert!(gesetzt_von.is_some());

    let wechsel =
        Geheimnisspeicher::new_wechsel(GeheimnisSchluessel::generate(), u.alt.clone()).unwrap();
    umschluesseln(&u.pool, &wechsel).await.unwrap();

    let (_, _, at_nachher, von_nachher) = zeilen(&u.pool).await.remove(0);
    assert_eq!(at_nachher, gesetzt_at);
    assert_eq!(von_nachher, gesetzt_von);
    assert_eq!(stand(u.pool.clone(), id).await, stand_vorher);
    // Die Verwaltung wird hier nicht gebraucht.
    let _ = (&u.app, &u.admin);
}
