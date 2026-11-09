//! Stammdaten-Verteilung (LLH-1493, Spec `stammdaten-verteilung`): zwei echte Instanzen im selben
//! Testprozess wie in `tests/instanz_kopplung.rs`. „Hub“ stellt den Code aus und liefert, „ELW“
//! löst ein, meldet sich und übernimmt.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use serde_json::{json, Value};

// ── Liefern und übernehmen ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn grundstock_mit_der_ersten_meldung_und_aenderung_mit_der_naechsten() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Rotkreuz Nord 1/83-1')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO qualifikation (org_id, label) VALUES (1, 'Notfallsanitäter (Test)')",
    )
    .await;
    melden(&elw).await;
    let id = lokale_id(&elw, "fahrzeug", "funkrufname", "Rotkreuz Nord 1/83-1").await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM qualifikation WHERE label = 'Notfallsanitäter (Test)'"
        )
        .await,
        1
    );
    exec(&hub.pool, "UPDATE fahrzeug SET funkrufname = 'Rotkreuz Nord 1/83-2' WHERE funkrufname = 'Rotkreuz Nord 1/83-1'").await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT funkrufname FROM fahrzeug WHERE id = {id}")
        )
        .await,
        "Rotkreuz Nord 1/83-2"
    );
    assert!(
        kopplung_elw(&elw).await["org"]["stammdaten"]["stand"]
            .as_i64()
            .unwrap()
            > 0
    );
}

#[tokio::test]
async fn uebernommene_zeile_ist_nur_lesbar_lokale_ergaenzung_nicht() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1')",
    )
    .await;
    melden(&elw).await;
    let id = lokale_id(&elw, "fahrzeug", "funkrufname", "Hub 1").await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &elw.admin,
        Some(&json!({"bemerkung": "geändert"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["error"], "Wird am Hub gepflegt.");
    let (s, _) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/fahrzeuge/{id}/ausser-dienst"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    // Geliehenes Fahrzeug: gilt sofort, bearbeitbar, geht nicht an den Hub.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        "/api/fahrzeuge",
        &elw.admin,
        Some(&json!({"funkrufname": "Geliehen 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let lokal = v["id"].as_i64().unwrap();
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/fahrzeuge/{lokal}"),
        &elw.admin,
        Some(&json!({"bemerkung": "von KV Süd"})),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &hub.pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE funkrufname = 'Geliehen 1'"
        )
        .await,
        0
    );
    let (s, v) = common::anfrage(
        &elw.app,
        "GET",
        "/api/instanz/stammdaten/herkunft",
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["quelle"], "Lifeline Hub");
    assert!(v["vom_hub"]["fahrzeug"]
        .as_array()
        .unwrap()
        .contains(&json!(id.to_string())));
    assert!(!v["vom_hub"]["fahrzeug"]
        .as_array()
        .unwrap()
        .contains(&json!(lokal.to_string())));
}

#[tokio::test]
async fn gleiches_fahrzeug_wird_zusammengefuehrt_und_behaelt_seine_id() {
    let hub = instanz().await;
    let elw = instanz().await;
    schluessel(&hub).await;
    exec(
        &elw.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname, bemerkung) VALUES (1, 'RK 1', 'alt')",
    )
    .await;
    let vorher = lokale_id(&elw, "fahrzeug", "funkrufname", "RK 1").await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname, bemerkung) VALUES (1, 'RK 1', 'vom Hub')",
    )
    .await;
    koppeln(&hub, &elw).await;
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE funkrufname = 'RK 1'"
        )
        .await,
        1
    );
    assert_eq!(
        lokale_id(&elw, "fahrzeug", "funkrufname", "RK 1").await,
        vorher
    );
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT bemerkung FROM fahrzeug WHERE id = {vorher}")
        )
        .await,
        "vom Hub"
    );
    // Die Standard-Kataloge beider Instanzen (Status, Qualifikationen) sind ebenso zusammengeführt.
    let doppelt: i64 = eine(
        &elw.pool,
        "SELECT COUNT(*) FROM (SELECT label FROM fahrzeug_status GROUP BY org_id, label HAVING COUNT(*) > 1)",
    )
    .await;
    assert_eq!(doppelt, 0);
}

#[tokio::test]
async fn geloeschte_zeilen_verschwinden_oder_werden_stillgelegt() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO material (org_id, bezeichnung) VALUES (1, 'Decke')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO material (org_id, bezeichnung) VALUES (1, 'Trage')",
    )
    .await;
    melden(&elw).await;
    let decke = lokale_id(&elw, "material", "bezeichnung", "Decke").await;
    let einsatz = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &elw.admin,
        Some(&json!({"material_id": decke})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    exec(&hub.pool, "DELETE FROM material").await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT dienststatus FROM material WHERE id = {decke}")
        )
        .await,
        "ausser_dienst"
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM material WHERE bezeichnung = 'Trage'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn vorlage_kommt_mit_typ_fahrzeug_personal_und_qualifikationssoll() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO einheit_typ (id, org_id, label) VALUES (900, 1, 'San-Trupp')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO qualifikation (id, org_id, label) VALUES (900, 1, 'RettSan')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (id, org_id, funkrufname) VALUES (900, 1, 'KTW 1')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO personal (id, org_id, name, personalnummer) VALUES (900, 1, 'Max', 'P1')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO personal_qualifikation VALUES (900, 900)",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einheit_vorlage (id, org_id, name, typ_id, quali_soll) \
         VALUES (900, 1, 'San 1', 900, '[{\"q\":900,\"n\":2}]')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einheit_vorlage_fahrzeug (vorlage_id, fahrzeug_id) VALUES (900, 900)",
    )
    .await;
    exec(&hub.pool, "INSERT INTO einheit_vorlage_personal (vorlage_id, personal_id, fahrzeug_id) VALUES (900, 900, 900)").await;
    melden(&elw).await;
    let typ = lokale_id(&elw, "einheit_typ", "label", "San-Trupp").await;
    let q = lokale_id(&elw, "qualifikation", "label", "RettSan").await;
    let f = lokale_id(&elw, "fahrzeug", "funkrufname", "KTW 1").await;
    let p = lokale_id(&elw, "personal", "name", "Max").await;
    let v = lokale_id(&elw, "einheit_vorlage", "name", "San 1").await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT typ_id FROM einheit_vorlage WHERE id = {v}")
        )
        .await,
        typ
    );
    let soll: Value = serde_json::from_str(
        &eine::<String>(
            &elw.pool,
            &format!("SELECT quali_soll FROM einheit_vorlage WHERE id = {v}"),
        )
        .await,
    )
    .unwrap();
    assert_eq!(soll, json!([{"q": q, "n": 2}]));
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT fahrzeug_id FROM einheit_vorlage_fahrzeug WHERE vorlage_id = {v}")
        )
        .await,
        f
    );
    assert_eq!(
        eine::<i64>(&elw.pool, &format!("SELECT fahrzeug_id FROM einheit_vorlage_personal WHERE vorlage_id = {v} AND personal_id = {p}")).await,
        f
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT qualifikation_id FROM personal_qualifikation WHERE personal_id = {p}")
        )
        .await,
        q
    );
}

// ── Konten ───────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn gleicher_kontoname_bleibt_draussen_bis_zum_erneuten_abgleich() {
    let (hub, elw) = gekoppelt().await;
    konto(&hub, "annameier").await;
    konto(&hub, "maxmuster").await;
    konto(&elw, "annameier").await;
    melden(&elw).await;
    let hinweise = kopplung_elw(&elw).await["org"]["stammdaten"]["hinweise"].clone();
    let hinweise: Vec<String> = serde_json::from_value(hinweise).unwrap();
    assert!(
        hinweise.contains(&"Konto „admin“ ist hier schon vergeben.".to_string()),
        "{hinweise:?}"
    );
    assert!(
        hinweise.contains(&"Konto „annameier“ ist hier schon vergeben.".to_string()),
        "{hinweise:?}"
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'maxmuster'"
        )
        .await,
        1
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'annameier'"
        )
        .await,
        1
    );
    // Konflikt lösen und erneut abgleichen.
    exec(
        &elw.pool,
        "UPDATE benutzer SET benutzername = 'annameier-lokal' WHERE benutzername = 'annameier'",
    )
    .await;
    let id = kopplung_elw(&elw).await["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{id}/stammdaten-neu"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'annameier'"
        )
        .await,
        1
    );
    let hinweise: Vec<String> =
        serde_json::from_value(v["org"]["stammdaten"]["hinweise"].clone()).unwrap();
    assert!(
        !hinweise.iter().any(|h| h.contains("annameier")),
        "{hinweise:?}"
    );
}

#[tokio::test]
async fn deaktivierung_am_hub_beendet_die_sitzung_am_elw() {
    let (hub, elw) = gekoppelt().await;
    let max = konto(&hub, "maxmuster").await;
    melden(&elw).await;
    let lokal = lokale_id(&elw, "benutzer", "benutzername", "maxmuster").await;
    exec(
        &elw.pool,
        &format!(
            "INSERT INTO session (token_hash, benutzer_id, expires_at, kennung) \
             VALUES ('t', {lokal}, '2999-01-01 00:00:00', 'k')"
        ),
    )
    .await;
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/benutzer/{max}/deaktivieren"),
        &hub.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT aktiv FROM benutzer WHERE id = {lokal}")
        )
        .await,
        0
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT COUNT(*) FROM session WHERE benutzer_id = {lokal}")
        )
        .await,
        0
    );
}

#[tokio::test]
async fn nach_dem_widerruf_gehoeren_die_zeilen_dem_elw() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1')",
    )
    .await;
    melden(&elw).await;
    let id = lokale_id(&elw, "fahrzeug", "funkrufname", "Hub 1").await;
    let k = kopplung_elw(&elw).await["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{k}/widerrufen"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &elw.admin,
        Some(&json!({"bemerkung": "jetzt unseres"})),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
}

#[tokio::test]
async fn zweite_quelle_fuer_dieselbe_org_liefert_nichts() {
    let (hub, elw) = gekoppelt().await;
    let hub2 = instanz().await;
    lifeline_hub::auth::unterschrift::set_rp(RP.into(), ORIGIN.into());
    schluessel(&hub2).await;
    exec(
        &hub2.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Von Hub 2')",
    )
    .await;
    koppeln(&hub2, &elw).await;
    melden(&elw).await;
    let _ = &hub;
    let hinweise: i64 = eine(
        &elw.pool,
        "SELECT COUNT(*) FROM instanz_kopplung_org WHERE stammdaten_hinweis LIKE '%anderen Kopplung%'",
    )
    .await;
    assert_eq!(hinweise, 1);
}
