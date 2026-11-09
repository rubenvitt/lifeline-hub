//! Gebündelter Hinweis je Wechselzeitpunkt (LLH-1555 Welle 3, Change
//! `qo0amhd5-wechsel-aus-schichtplan`, Spec `kraefte-schichtplan` „Ein Hinweis je Zeitpunkt“):
//! Schichten, die laut Plan zum selben Zeitpunkt fällig sind, melden Vorwarnung und Fälligkeit
//! je einmal, mit dem Zeitpunkt als Bezug (`schichtplan_wechsel`). Schichten außerhalb des Plans
//! melden sich weiter einzeln (EEMUA 191: ein Anlass, ein Alarm).

use axum::http::StatusCode;
use chrono::{DateTime, Duration, DurationRound, Utc};
use lifeline_hub::erinnerung::scheduler::tick_einmal;
use serde_json::json;

mod common;
use common::*;

fn f(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Jetzt auf dem Raster des Plans (5 min).
fn jetzt() -> DateTime<Utc> {
    Utc::now().duration_trunc(Duration::minutes(5)).unwrap()
}

/// Ein Block an der Einheit von `von` bis `bis` und eine laufende Schicht ab `von`; liefert die
/// Kennung der Schicht.
async fn posten(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    name: &str,
    von: DateTime<Utc>,
    bis: DateTime<Utc>,
) -> i64 {
    let einheit = einheit_bilden(app, cookie, e, name).await;
    let (s, p) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/abloesungen/schichtplan/bloecke"),
        cookie,
        Some(&json!({"posten": {"art": "einheit", "einheit_id": einheit},
                     "von": f(von), "bis": f(bis), "personen": []})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    schicht(app, cookie, e, einheit, von, 480).await
}

async fn schicht(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    einheit: i64,
    beginn: DateTime<Utc>,
    rhythmus: i64,
) -> i64 {
    let (s, j) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/abloesungen"),
        cookie,
        Some(&json!({"einheit_id": einheit, "rhythmus_minuten": rhythmus,
                     "beginn_at": f(beginn)})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    j["id"].as_i64().unwrap()
}

/// (bezug_typ, bezug_id) aller Benachrichtigungen einer Art an einen Nutzer, sortiert.
async fn bezuege(pool: &sqlx::SqlitePool, art: &str, benutzer: i64) -> Vec<(String, i64)> {
    sqlx::query_as(
        "SELECT bezug_typ, bezug_id FROM benachrichtigung \
         WHERE art = ? AND benutzer_id = ? ORDER BY bezug_typ, bezug_id",
    )
    .bind(art)
    .bind(benutzer)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Akzeptanzkriterium 2 (LLH-1555): 15 Posten mit gleichem Wechselzeitpunkt erzeugen eine
/// Benachrichtigung, für die Vorwarnung wie für die Fälligkeit. Ein Zeitpunkt mit einem einzigen
/// Wechsel nennt die Einheit; eine Schicht ohne Plan zur selben Zeit bleibt einzeln.
#[tokio::test]
async fn fuenfzehn_posten_mit_gleichem_wechsel_erzeugen_eine_benachrichtigung() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let e = einsatz_anlegen(&app, &admin).await;
    let t = jetzt();
    let beginn = t - Duration::minutes(30);
    let z = t + Duration::hours(3);
    let z2 = t + Duration::hours(4);
    for i in 1..=15 {
        posten(&app, &admin, e, &format!("RTW {i}"), beginn, z).await;
    }
    posten(&app, &admin, e, "KTW 1", beginn, z2).await;
    // Ohne Plan, aber zur selben Zeit fällig: Beginn 5 h vor dem Wechsel, Rhythmus 8 h.
    let ohne_plan = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let einzeln = schicht(&app, &admin, e, ohne_plan, z - Duration::hours(8), 480).await;
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();

    let minute = z.timestamp() / 60;
    let wechsel = ("schichtplan_wechsel".to_string(), minute);

    // Die Wechsel-Leiste zeigt denselben Zeitpunkt mit den 15 offenen Wechseln und ihren
    // Schichten; der Hinweis springt dorthin (`?wechsel=<minute>`).
    let (s, p) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/abloesungen/schichtplan"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{p}");
    let punkt = p["wechsel"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["minute"] == minute)
        .unwrap_or_else(|| panic!("Zeitpunkt fehlt: {p}"))
        .clone();
    assert_eq!(punkt["zeitpunkt"], f(z));
    let eintraege = punkt["eintraege"].as_array().unwrap();
    assert_eq!(eintraege.len(), 15, "{punkt}");
    assert!(
        eintraege
            .iter()
            .all(|e| e["art"] == "einheit" && e["stand"] == "offen" && e["abloesung_id"].is_i64()),
        "{punkt}"
    );
    tick_einmal(&pool, &live, z - Duration::minutes(29)).await;
    assert_eq!(
        bezuege(&pool, "abloesung_vorwarnung", admin_id).await,
        vec![("abloesung".to_string(), einzeln), wechsel.clone()],
        "eine Vorwarnung für die 15 Posten, die Schicht ohne Plan für sich"
    );
    tick_einmal(&pool, &live, z + Duration::minutes(1)).await;
    assert_eq!(
        bezuege(&pool, "abloesung_faellig", admin_id).await,
        vec![("abloesung".to_string(), einzeln), wechsel.clone()],
        "ein Alarm für die 15 Posten"
    );
    // Ein späterer Tick meldet den Zeitpunkt nicht noch einmal.
    tick_einmal(&pool, &live, z + Duration::minutes(2)).await;
    assert_eq!(bezuege(&pool, "abloesung_faellig", admin_id).await.len(), 2);
    // Kommt nach der Quittung eine Schicht zu diesem Zeitpunkt hinzu, meldet sie ihn neu, statt
    // ohne Alarm fällig zu werden; solange der Alarm offen ist, schweigt sie (siehe oben).
    sqlx::query(
        "UPDATE benachrichtigung SET quittiert_at = ? WHERE bezug_typ = 'schichtplan_wechsel'",
    )
    .bind(f(z + Duration::minutes(3)))
    .execute(&pool)
    .await
    .unwrap();
    posten(&app, &admin, e, "RTW 16", beginn, z).await;
    tick_einmal(&pool, &live, z + Duration::minutes(4)).await;
    assert_eq!(
        bezuege(&pool, "abloesung_faellig", admin_id).await,
        vec![
            ("abloesung".to_string(), einzeln),
            wechsel.clone(),
            wechsel.clone()
        ],
        "nach der Quittung ein neuer Alarm für den Nachzügler"
    );

    let b: i64 = sqlx::query_scalar(
        "SELECT id FROM benachrichtigung WHERE art = 'abloesung_faellig' \
           AND bezug_typ = 'schichtplan_wechsel' AND benutzer_id = ?",
    )
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/benachrichtigungen/{b}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Ablösung fällig");
    let detail = v["detail"].as_str().unwrap_or_default();
    assert!(detail.starts_with("16 Wechsel um "), "{v}");
    assert_eq!(
        v["pfad"],
        format!("/einsaetze/{e}/abloesung?ansicht=plan&wechsel={minute}").as_str()
    );

    // Der Zeitpunkt mit einem einzigen Wechsel nennt die Einheit.
    tick_einmal(&pool, &live, z2 + Duration::minutes(1)).await;
    let b2: i64 = sqlx::query_scalar(
        "SELECT id FROM benachrichtigung WHERE art = 'abloesung_faellig' \
           AND bezug_typ = 'schichtplan_wechsel' AND bezug_id = ? AND benutzer_id = ?",
    )
    .bind(z2.timestamp() / 60)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let (_, v) = anfrage(
        &app,
        "GET",
        &format!("/api/benachrichtigungen/{b2}"),
        &admin,
        None,
    )
    .await;
    let detail = v["detail"].as_str().unwrap_or_default();
    assert!(detail.starts_with("KTW 1, "), "{v}");
}
