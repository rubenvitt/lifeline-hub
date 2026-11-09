//! Stammdaten-Verteilung der übrigen Kataloge (LLH-1613, Change `kjezbk06-stammdaten-kataloge`,
//! Spec `stammdaten-verteilung`): Schichtmodelle, Einsatz-Vorlagen, Stichwort-Vorschläge,
//! Verpflegungs-Vorlagen, Sprechgruppen der Org, ETB-Bausteine, Externe Stellen und
//! Unterkunft-Richtwerte. Zwei echte Instanzen wie in `tests/instanz_stammdaten.rs`.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use serde_json::json;

/// Ob ein Schreibversuch am Schutz-Trigger scheitert.
async fn gesperrt(pool: &sqlx::SqlitePool, sql: &str) -> bool {
    match sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(pool)
        .await
    {
        Ok(_) => false,
        Err(e) => {
            assert!(e.to_string().contains("stammdaten_vom_hub"), "{e}");
            true
        }
    }
}

async fn ist_vom_hub(elw: &Instanz, art: &str, lokal: &str) -> bool {
    eine::<i64>(
        &elw.pool,
        &format!(
            "SELECT COUNT(*) FROM stammdaten_herkunft WHERE art = '{art}' \
             AND lokaler_schluessel = '{lokal}'"
        ),
    )
    .await
        == 1
}

// ── Einsatz-Vorlage mit Schichtmodell, Modulen und Stichwort ─────────────────────────────────

#[tokio::test]
async fn einsatz_vorlage_kommt_mit_schichtmodell_modulen_und_stichwort() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten) \
         VALUES (1, '12-Stunden', 'rhythmus', 720)",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einsatz_vorlage (org_id, bezeichnung, einsatzart, schichtmodell_id) \
         SELECT 1, 'Großlage Test', 'realeinsatz', id FROM schichtmodell WHERE bezeichnung = '12-Stunden'",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einsatz_vorlage_modul_aus (vorlage_id, modul_key) \
         SELECT id, 'tiere' FROM einsatz_vorlage WHERE bezeichnung = 'Großlage Test'",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einsatz_stichwort_vorschlag (org_id, text, vorlage_id) \
         SELECT 1, 'Großbrand Test', id FROM einsatz_vorlage WHERE bezeichnung = 'Großlage Test'",
    )
    .await;
    melden(&elw).await;

    let modell = lokale_id(&elw, "schichtmodell", "bezeichnung", "12-Stunden").await;
    let vorlage = lokale_id(&elw, "einsatz_vorlage", "bezeichnung", "Großlage Test").await;
    assert_eq!(
        eine::<Option<i64>>(
            &elw.pool,
            &format!("SELECT schichtmodell_id FROM einsatz_vorlage WHERE id = {vorlage}")
        )
        .await,
        Some(modell)
    );
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT group_concat(modul_key) FROM einsatz_vorlage_modul_aus WHERE vorlage_id = {vorlage}")
        )
        .await,
        "tiere"
    );
    let wort = lokale_id(
        &elw,
        "einsatz_stichwort_vorschlag",
        "text",
        "Großbrand Test",
    )
    .await;
    assert_eq!(
        eine::<Option<i64>>(
            &elw.pool,
            &format!("SELECT vorlage_id FROM einsatz_stichwort_vorschlag WHERE id = {wort}")
        )
        .await,
        Some(vorlage)
    );
    // Die Startliste beider Seiten trägt dieselben Namen: zusammengeführt, nicht verdoppelt.
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM einsatz_vorlage WHERE bezeichnung = 'Kleinlage'"
        )
        .await,
        1
    );
    let klein = lokale_id(&elw, "einsatz_vorlage", "bezeichnung", "Kleinlage").await;
    assert!(ist_vom_hub(&elw, "einsatz_vorlage", &klein.to_string()).await);
    // Die ausgeblendeten Module einer übernommenen Vorlage sind gesperrt.
    assert!(
        gesperrt(
            &elw.pool,
            &format!("INSERT INTO einsatz_vorlage_modul_aus (vorlage_id, modul_key) VALUES ({vorlage}, 'chat')")
        )
        .await
    );
}

// ── Jede neue Art ist am ELW nur lesbar ─────────────────────────────────────────────────────

#[tokio::test]
async fn jede_neue_art_ist_am_elw_nur_lesbar() {
    let (hub, elw) = gekoppelt().await;
    for sql in [
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten) VALUES (1, 'Sperre Modell', 'rhythmus', 480)",
        "INSERT INTO einsatz_vorlage (org_id, bezeichnung) VALUES (1, 'Sperre Vorlage')",
        "INSERT INTO einsatz_stichwort_vorschlag (org_id, text) VALUES (1, 'Sperre Wort')",
        "INSERT INTO verpflegung_vorlage (org_id, bezeichnung, beginn, ende) VALUES (1, 'Sperre Mahlzeit', '06:30', '08:00')",
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart) VALUES (1, 'Sperre Gruppe', 'TMO')",
        "INSERT INTO etb_baustein (org_id, label, typ, inhalt) VALUES (1, 'Sperre Baustein', 'lage', 'Text')",
        "INSERT INTO org_externe_stelle (org_id, bezeichnung, art) VALUES (1, 'Sperre Stelle', 'polizei')",
        "INSERT INTO org_unterkunft_richtwert (org_id, schluessel, wert, geaendert_at) VALUES (1, 'flaeche_je_person_m2', 5, '2026-11-09T10:00:00Z')",
    ] {
        exec(&hub.pool, sql).await;
    }
    melden(&elw).await;

    for (tabelle, spalte, wert, aenderung) in [
        (
            "schichtmodell",
            "bezeichnung",
            "Sperre Modell",
            "vorwarnung_minuten = 10",
        ),
        (
            "einsatz_vorlage",
            "bezeichnung",
            "Sperre Vorlage",
            "sortier = 5",
        ),
        (
            "einsatz_stichwort_vorschlag",
            "text",
            "Sperre Wort",
            "sortier = 5",
        ),
        (
            "verpflegung_vorlage",
            "bezeichnung",
            "Sperre Mahlzeit",
            "aktiv = 0",
        ),
        (
            "sprechgruppe",
            "bezeichnung",
            "Sperre Gruppe",
            "hinweis = 'x'",
        ),
        ("etb_baustein", "label", "Sperre Baustein", "inhalt = 'y'"),
        (
            "org_externe_stelle",
            "bezeichnung",
            "Sperre Stelle",
            "rufnummer = '110'",
        ),
    ] {
        let id = lokale_id(&elw, tabelle, spalte, wert).await;
        assert!(
            gesperrt(
                &elw.pool,
                &format!("UPDATE {tabelle} SET {aenderung} WHERE id = {id}")
            )
            .await,
            "{tabelle} ändern"
        );
        assert!(
            gesperrt(&elw.pool, &format!("DELETE FROM {tabelle} WHERE id = {id}")).await,
            "{tabelle} löschen"
        );
    }

    // Über die Route: 409 mit dem Text der Sperre.
    let baustein = lokale_id(&elw, "etb_baustein", "label", "Sperre Baustein").await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/etb-bausteine/{baustein}"),
        &elw.admin,
        Some(&json!({"inhalt": "geändert"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["error"], "Wird am Hub gepflegt.");

    // Unterkunft-Richtwerte je Schlüssel: der vom Hub gesperrt, ein anderer setzbar.
    assert_eq!(
        eine::<f64>(
            &elw.pool,
            "SELECT wert FROM org_unterkunft_richtwert WHERE schluessel = 'flaeche_je_person_m2'"
        )
        .await,
        5.0
    );
    assert!(ist_vom_hub(&elw, "unterkunft_richtwert", "flaeche_je_person_m2").await);
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PUT",
        "/api/org-unterkunft-richtwerte/flaeche_je_person_m2",
        &elw.admin,
        Some(&json!({"wert": 6})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PUT",
        "/api/org-unterkunft-richtwerte/feldbett_je_person",
        &elw.admin,
        Some(&json!({"wert": 2})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(!ist_vom_hub(&elw, "unterkunft_richtwert", "feldbett_je_person").await);

    // Setzt der Hub den Richtwert zurück, setzt der ELW ihn auch zurück.
    exec(
        &hub.pool,
        "DELETE FROM org_unterkunft_richtwert WHERE schluessel = 'flaeche_je_person_m2'",
    )
    .await;
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM org_unterkunft_richtwert WHERE schluessel = 'flaeche_je_person_m2'"
        )
        .await,
        0
    );
}

// ── Sprechgruppen: nur der Org-Katalog, Abgleich über Betriebsart und Bezeichnung ───────────

#[tokio::test]
async fn einsatz_lokale_sprechgruppe_am_hub_erhoeht_keinen_stand() {
    let (hub, elw) = gekoppelt().await;
    melden(&elw).await;
    let einsatz = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    exec(
        &hub.pool,
        &format!(
            "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart) \
             VALUES (1, {einsatz}, 'Einsatzkanal', 'TMO')"
        ),
    )
    .await;
    assert_eq!(
        eine::<i64>(
            &hub.pool,
            "SELECT COUNT(*) FROM stammdaten_aenderung a JOIN sprechgruppe s \
             ON a.art = 'sprechgruppe' AND a.schluessel = CAST(s.id AS TEXT) \
             WHERE s.bezeichnung = 'Einsatzkanal'"
        )
        .await,
        0
    );
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM sprechgruppe WHERE bezeichnung = 'Einsatzkanal'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn sprechgruppen_gleichen_ueber_betriebsart_und_bezeichnung_ab() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &elw.pool,
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart) VALUES (1, 'Rotkreuz 1', 'TMO')",
    )
    .await;
    exec(
        &elw.pool,
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart) VALUES (1, 'Rotkreuz 1', 'DMO')",
    )
    .await;
    let einsatz = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    exec(
        &elw.pool,
        &format!(
            "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart) \
             VALUES (1, {einsatz}, 'Kanal 5', 'TMO')"
        ),
    )
    .await;
    let tmo: i64 = eine(
        &elw.pool,
        "SELECT id FROM sprechgruppe WHERE bezeichnung = 'Rotkreuz 1' AND betriebsart = 'TMO'",
    )
    .await;
    let dmo: i64 = eine(
        &elw.pool,
        "SELECT id FROM sprechgruppe WHERE bezeichnung = 'Rotkreuz 1' AND betriebsart = 'DMO'",
    )
    .await;
    let lokal_einsatz: i64 = eine(
        &elw.pool,
        "SELECT id FROM sprechgruppe WHERE bezeichnung = 'Kanal 5'",
    )
    .await;

    exec(
        &hub.pool,
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart, hinweis) VALUES (1, 'Rotkreuz 1', 'DMO', 'vom Hub')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart) VALUES (1, 'Kanal 5', 'TMO')",
    )
    .await;
    melden(&elw).await;

    assert!(ist_vom_hub(&elw, "sprechgruppe", &dmo.to_string()).await);
    assert_eq!(
        eine::<Option<String>>(
            &elw.pool,
            &format!("SELECT hinweis FROM sprechgruppe WHERE id = {dmo}")
        )
        .await
        .as_deref(),
        Some("vom Hub")
    );
    assert!(!ist_vom_hub(&elw, "sprechgruppe", &tmo.to_string()).await);
    // Die Sprechgruppe des Einsatzes bleibt unberührt; der Katalog bekommt eine eigene Zeile.
    assert!(!ist_vom_hub(&elw, "sprechgruppe", &lokal_einsatz.to_string()).await);
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM sprechgruppe WHERE bezeichnung = 'Kanal 5' AND einsatz_id IS NULL"
        )
        .await,
        1
    );
    exec(
        &elw.pool,
        &format!(
            "UPDATE sprechgruppe SET hinweis = 'bleibt bearbeitbar' WHERE id = {lokal_einsatz}"
        ),
    )
    .await;
}

// ── Exklusive Markierung folgt dem Hub ──────────────────────────────────────────────────────

#[tokio::test]
async fn vorgabe_und_zustaendige_leitstelle_folgen_dem_hub() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &elw.pool,
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten, ist_vorgabe) \
         VALUES (1, 'Kurzschicht', 'rhythmus', 240, 1)",
    )
    .await;
    exec(
        &elw.pool,
        "INSERT INTO org_externe_stelle (org_id, bezeichnung, art, zustaendig) \
         VALUES (1, 'Leitstelle ELW', 'leitstelle', 1)",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten, ist_vorgabe) \
         VALUES (1, '12-Stunden', 'rhythmus', 720, 1)",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO org_externe_stelle (org_id, bezeichnung, art, zustaendig) \
         VALUES (1, 'Leitstelle Hub', 'leitstelle', 1)",
    )
    .await;
    melden(&elw).await;

    assert_eq!(
        eine::<String>(
            &elw.pool,
            "SELECT bezeichnung FROM schichtmodell WHERE ist_vorgabe = 1"
        )
        .await,
        "12-Stunden"
    );
    let kurz = lokale_id(&elw, "schichtmodell", "bezeichnung", "Kurzschicht").await;
    assert!(!ist_vom_hub(&elw, "schichtmodell", &kurz.to_string()).await);
    assert_eq!(
        eine::<String>(
            &elw.pool,
            "SELECT bezeichnung FROM org_externe_stelle WHERE zustaendig = 1"
        )
        .await,
        "Leitstelle Hub"
    );
    let hinweise: Vec<String> =
        serde_json::from_value(kopplung_elw(&elw).await["org"]["stammdaten"]["hinweise"].clone())
            .unwrap();
    assert!(
        !hinweise.iter().any(|h| h.contains("nicht übernommen")),
        "{hinweise:?}"
    );
}

// ── Nachgeholte Löschung ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn geloeschtes_schichtmodell_einer_vorlage_wird_nachgeholt_geloescht() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten) \
         VALUES (1, 'Weg damit', 'rhythmus', 600)",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einsatz_vorlage (org_id, bezeichnung, schichtmodell_id) \
         SELECT 1, 'Mit Modell', id FROM schichtmodell WHERE bezeichnung = 'Weg damit'",
    )
    .await;
    melden(&elw).await;
    let vorlage = lokale_id(&elw, "einsatz_vorlage", "bezeichnung", "Mit Modell").await;

    // Wie `schichtmodell::repo::delete`: erst den Verweis lösen, dann löschen.
    let id: i64 = eine(
        &hub.pool,
        "SELECT id FROM schichtmodell WHERE bezeichnung = 'Weg damit'",
    )
    .await;
    let (s, v) = common::anfrage(
        &hub.app,
        "DELETE",
        &format!("/api/schichtmodelle/{id}"),
        &hub.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    melden(&elw).await;

    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM schichtmodell WHERE bezeichnung = 'Weg damit'"
        )
        .await,
        0
    );
    assert_eq!(
        eine::<Option<i64>>(
            &elw.pool,
            &format!("SELECT schichtmodell_id FROM einsatz_vorlage WHERE id = {vorlage}")
        )
        .await,
        None
    );
}

#[tokio::test]
async fn schichtmodell_einer_eigenen_vorlage_bleibt_und_gehoert_dem_elw() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO schichtmodell (org_id, bezeichnung, typ, rhythmus_minuten) \
         VALUES (1, 'Bleibt', 'rhythmus', 600)",
    )
    .await;
    melden(&elw).await;
    let modell = lokale_id(&elw, "schichtmodell", "bezeichnung", "Bleibt").await;
    exec(
        &elw.pool,
        &format!(
            "INSERT INTO einsatz_vorlage (org_id, bezeichnung, schichtmodell_id) \
             VALUES (1, 'Eigene Vorlage', {modell})"
        ),
    )
    .await;
    exec(
        &hub.pool,
        "DELETE FROM schichtmodell WHERE bezeichnung = 'Bleibt'",
    )
    .await;
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT COUNT(*) FROM schichtmodell WHERE id = {modell}")
        )
        .await,
        1
    );
    assert!(!ist_vom_hub(&elw, "schichtmodell", &modell.to_string()).await);
    exec(
        &elw.pool,
        &format!("UPDATE schichtmodell SET vorwarnung_minuten = 15 WHERE id = {modell}"),
    )
    .await;
}
