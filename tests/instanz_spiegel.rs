//! Spiegel und Anträge (LLH-1492, Specs `einsatz-spiegel` und `spiegel-antraege`): ein Einsatz
//! an einer gekoppelten Instanz, die ihn nicht führt. Die Fälle mit zwei Instanzen laufen wie in
//! `tests/instanz_stammdaten.rs` mit je eigener DB und eigenem Server auf Loopback.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use serde_json::json;

const SPIEGEL_409: &str =
    "Dieser Einsatz ist ein Spiegel; ändern geht nur als Antrag an die führende Instanz.";

/// Markiert einen Einsatz von Hand als Spiegel, ohne zweite Instanz.
async fn als_spiegel(pool: &sqlx::SqlitePool, einsatz: i64) {
    exec(
        pool,
        &format!(
            "INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES ({einsatz}, 'x/{einsatz}')"
        ),
    )
    .await;
}

// ── Schreibschutz (D10) ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn schreibende_routen_am_spiegel_enden_mit_409_die_lesemarke_nicht() {
    let i = instanz().await;
    let e = common::einsatz_anlegen(&i.app, &i.admin).await;
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{e}/schaeden"),
        &i.admin,
        Some(&json!({ "typ": "sachschaden", "ausmass": "gering", "ort": "Hauptstr. 1" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let schaden = v["id"].as_i64().unwrap();
    als_spiegel(&i.pool, e).await;

    for (methode, pfad, body) in [
        (
            "PATCH",
            format!("/api/einsaetze/{e}"),
            json!({ "bezeichnung": "Neu" }),
        ),
        (
            "POST",
            format!("/api/einsaetze/{e}/schaeden"),
            json!({ "typ": "sachschaden", "ausmass": "gering", "ort": "Hauptstr. 2" }),
        ),
        (
            "PATCH",
            format!("/api/einsaetze/{e}/schaeden/{schaden}"),
            json!({ "ort": "Hauptstr. 3" }),
        ),
    ] {
        let (s, v) = common::anfrage_json(&i.app, methode, &pfad, &i.admin, Some(&body)).await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}: {v}");
        assert_eq!(v["error"], SPIEGEL_409, "{methode} {pfad}");
    }
    let bezeichnung: String = eine(
        &i.pool,
        &format!("SELECT bezeichnung FROM einsatz WHERE id = {e}"),
    )
    .await;
    assert_eq!(bezeichnung, "Lage", "nichts geschrieben");

    // Die Lesemarke gehört der Person an dieser Instanz und wird nicht gespiegelt.
    let lfd: i64 = eine(
        &i.pool,
        &format!("SELECT COALESCE(MAX(lfd_nr), 0) FROM etb_eintrag WHERE einsatz_id = {e}"),
    )
    .await;
    let (s, v) = common::anfrage(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{e}/etb/lesemarke"),
        &i.admin,
        Some(&format!(r#"{{"bis_lfd_nr":{lfd}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}
