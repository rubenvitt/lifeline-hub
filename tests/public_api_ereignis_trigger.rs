//! Die Trigger, die die Outbox `maschine_ereignis` füllen (LLH-1655, Spec `ereignis-abruf`,
//! Migration `0344_maschine_ereignis_trigger.sql`): Welche Änderung meldet welchem Zugang
//! welches Ereignis, auf jedem Schreibweg und in der Transaktion der Änderung.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use common::{anfrage, anfrage_json, einsatz_anlegen_mit, login_cookie, person_anlegen};
use lifeline_hub::public_api::einsaetze::KOPF_SPALTEN;
use lifeline_hub::public_api::scope::Scope;
use lifeline_hub::public_api::{freigabe, zugang};
use serde_json::json;
use sqlx::SqlitePool;

struct Lage {
    app: axum::Router,
    pool: SqlitePool,
    admin: String,
    admin_id: i64,
    org: i64,
}

async fn lage() -> Lage {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (admin_id, org): (i64, i64) =
        sqlx::query_as("SELECT id, org_id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    Lage {
        app,
        pool,
        admin,
        admin_id,
        org,
    }
}

async fn zugang_anlegen(pool: &SqlitePool, org: i64, name: &str) -> String {
    let mut conn = pool.acquire().await.unwrap();
    zugang::anlegen(
        &mut conn,
        org,
        name,
        &[Scope::EventsRead, Scope::EinsaetzeRead, Scope::LageRead],
        None,
        None,
        &lifeline_hub::zeit::jetzt(),
    )
    .await
    .unwrap()
}

/// Gibt den Einsatz für den Zugang frei, wie es die Route der Einsatzleitung tut.
async fn freigeben(pool: &SqlitePool, zugang: &str, einsatz: i64, von: i64) {
    let mut conn = pool.acquire().await.unwrap();
    freigabe::freigeben_tx(&mut conn, zugang, einsatz, von)
        .await
        .unwrap();
}

/// Die Zeilen eines Zugangs als (Art, Einsatz), in der Reihenfolge ihrer Nummern.
async fn ereignisse(pool: &SqlitePool, zugang: &str) -> Vec<(String, i64)> {
    sqlx::query_as("SELECT type, einsatz_id FROM maschine_ereignis WHERE zugang_id = ? ORDER BY id")
        .bind(zugang)
        .fetch_all(pool)
        .await
        .unwrap()
}

/// Wie [`ereignisse`], nur die Zeilen nach `ab`.
async fn neu_seit(pool: &SqlitePool, zugang: &str, ab: i64) -> Vec<(String, i64)> {
    sqlx::query_as(
        "SELECT type, einsatz_id FROM maschine_ereignis WHERE zugang_id = ? AND id > ? ORDER BY id",
    )
    .bind(zugang)
    .bind(ab)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn hoechste(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COALESCE(MAX(id), 0) FROM maschine_ereignis")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn alle(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM maschine_ereignis")
        .fetch_one(pool)
        .await
        .unwrap()
}

fn e(art: &str, einsatz: i64) -> (String, i64) {
    (art.to_string(), einsatz)
}

async fn kopf_patch(l: &Lage, einsatz: i64, body: serde_json::Value) {
    let (s, v) = anfrage_json(
        &l.app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &l.admin,
        Some(&body),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
}

async fn abschliessen(l: &Lage, einsatz: i64) {
    let (s, v) = anfrage(
        &l.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &l.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
}

// ── Freigabe (design.md D5) ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ohne_freigabe_entsteht_kein_ereignis() {
    let l = lage().await;
    let _z = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    kopf_patch(&l, einsatz, json!({ "stichwort": "B3" })).await;
    person_anlegen(&l.app, &l.admin, einsatz, r#"{"nachname":"Muster"}"#).await;
    abschliessen(&l, einsatz).await;

    assert_eq!(alle(&l.pool).await, 0);
}

#[tokio::test]
async fn eine_freigabe_meldet_created_und_lage_nur_diesem_zugang() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let b = zugang_anlegen(&l.pool, l.org, "B").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;

    freigeben(&l.pool, &a, einsatz, l.admin_id).await;

    assert_eq!(
        ereignisse(&l.pool, &a).await,
        vec![e("einsatz.created", einsatz), e("lage.changed", einsatz)]
    );
    assert!(ereignisse(&l.pool, &b).await.is_empty());

    // Dieselbe Freigabe noch einmal ändert nichts.
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    assert_eq!(ereignisse(&l.pool, &a).await.len(), 2);
}

#[tokio::test]
async fn zuruecknehmen_meldet_closed_nur_diesem_zugang() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let b = zugang_anlegen(&l.pool, l.org, "B").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    freigeben(&l.pool, &b, einsatz, l.admin_id).await;
    let ab = hoechste(&l.pool).await;

    let mut conn = l.pool.acquire().await.unwrap();
    assert!(freigabe::beenden_tx(&mut conn, &a, einsatz).await.unwrap());
    drop(conn);

    assert_eq!(
        neu_seit(&l.pool, &a, ab).await,
        vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)]
    );
    assert!(neu_seit(&l.pool, &b, ab).await.is_empty());
}

#[tokio::test]
async fn umstellen_meldet_closed_fuer_den_alten_und_created_fuer_den_neuen_einsatz() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let alt = einsatz_anlegen_mit(&l.app, &l.admin, "Alt").await;
    let neu = einsatz_anlegen_mit(&l.app, &l.admin, "Neu").await;
    freigeben(&l.pool, &a, alt, l.admin_id).await;
    let ab = hoechste(&l.pool).await;

    // `freigeben_tx` löscht die alte Zeile und fügt die neue ein.
    freigeben(&l.pool, &a, neu, l.admin_id).await;

    assert_eq!(
        neu_seit(&l.pool, &a, ab).await,
        vec![
            e("einsatz.closed", alt),
            e("lage.changed", alt),
            e("einsatz.created", neu),
            e("lage.changed", neu),
        ]
    );
}

/// Kein Schreibweg stellt heute per UPDATE um; der Trigger dafür hält die Outbox richtig, falls
/// einer es künftig tut.
#[tokio::test]
async fn auch_ein_update_der_freigabe_meldet_closed_und_created() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let alt = einsatz_anlegen_mit(&l.app, &l.admin, "Alt").await;
    let neu = einsatz_anlegen_mit(&l.app, &l.admin, "Neu").await;
    freigeben(&l.pool, &a, alt, l.admin_id).await;
    let ab = hoechste(&l.pool).await;

    sqlx::query("UPDATE maschinenzugang_freigabe SET einsatz_id = ? WHERE zugang_id = ?")
        .bind(neu)
        .bind(&a)
        .execute(&l.pool)
        .await
        .unwrap();

    assert_eq!(
        neu_seit(&l.pool, &a, ab).await,
        vec![
            e("einsatz.closed", alt),
            e("lage.changed", alt),
            e("einsatz.created", neu),
            e("lage.changed", neu),
        ]
    );
}

#[tokio::test]
async fn ein_geloeschter_zugang_nimmt_freigabe_und_ereignisse_mit() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let b = zugang_anlegen(&l.pool, l.org, "B").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    freigeben(&l.pool, &b, einsatz, l.admin_id).await;

    sqlx::query("DELETE FROM maschinenzugang WHERE id = ?")
        .bind(&a)
        .execute(&l.pool)
        .await
        .expect("Löschen eines Zugangs samt Freigabe scheitert nicht");

    let von_a: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM maschine_ereignis WHERE zugang_id = ?")
            .bind(&a)
            .fetch_one(&l.pool)
            .await
            .unwrap();
    assert_eq!(von_a, 0);
    assert_eq!(ereignisse(&l.pool, &b).await.len(), 2, "B bleibt unberührt");
}

// ── Kopf (design.md D7) ──────────────────────────────────────────────────────────────────────

/// Ein neuer Wert je Kopfspalte, als SQL-Literal.
fn neuer_wert(spalte: &str) -> &'static str {
    match spalte {
        "einsatznummer_intern" => "'N-4711'",
        "bezeichnung" => "'Hochwasser Süd'",
        "stichwort" => "'B3'",
        "einsatzart" => "'uebung'",
        "leitstellen_nr" => "'L-2026-1'",
        "einsatzort" => "'Marktplatz 1'",
        "einsatzort_lat" => "52.1",
        "einsatzort_lon" => "9.3",
        "begonnen_at" => "'2026-11-01 08:00:00'",
        andere => panic!("Kopfspalte {andere} hat hier keinen Probewert"),
    }
}

#[tokio::test]
async fn jede_kopfspalte_meldet_updated_je_freigabe() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let b = zugang_anlegen(&l.pool, l.org, "B").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    freigeben(&l.pool, &b, einsatz, l.admin_id).await;

    for spalte in KOPF_SPALTEN {
        let ab = hoechste(&l.pool).await;
        let sql = format!(
            "UPDATE einsatz SET {spalte} = {} WHERE id = {einsatz}",
            neuer_wert(spalte)
        );
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&l.pool)
            .await
            .unwrap();
        for z in [&a, &b] {
            let neu = neu_seit(&l.pool, z, ab).await;
            assert_eq!(
                neu.iter().filter(|x| x.0 == "einsatz.updated").count(),
                1,
                "{spalte}: genau ein einsatz.updated je Zugang, war {neu:?}"
            );
        }
    }
}

#[tokio::test]
async fn felder_ausserhalb_des_kopfs_und_gleiche_werte_melden_nichts() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    kopf_patch(&l, einsatz, json!({ "stichwort": "B3" })).await;
    let ab = hoechste(&l.pool).await;

    kopf_patch(
        &l,
        einsatz,
        json!({ "sachverhalt": "Familie Muster im Keller", "meldende_stelle": "Herr Muster" }),
    )
    .await;
    assert!(
        neu_seit(&l.pool, &a, ab).await.is_empty(),
        "Sachverhalt und meldende Stelle gehören nicht zum Kopf der öffentlichen API"
    );

    kopf_patch(&l, einsatz, json!({ "stichwort": "B3" })).await;
    assert!(
        neu_seit(&l.pool, &a, ab).await.is_empty(),
        "ein gleicher Wert ist keine Änderung"
    );

    // Dieselbe Zeile mit allen Spalten im SET und gleichen Werten, wie die Spiegel-Übernahme
    // schreibt.
    let setzen = KOPF_SPALTEN
        .iter()
        .map(|s| format!("{s} = {s}"))
        .collect::<Vec<_>>()
        .join(", ");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE einsatz SET {setzen} WHERE id = {einsatz}"
    )))
    .execute(&l.pool)
    .await
    .unwrap();
    assert!(neu_seit(&l.pool, &a, ab).await.is_empty());
}

#[tokio::test]
async fn ein_kopffeld_ohne_lagebezug_meldet_nur_updated_eines_mit_auch_die_lage() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;

    let ab = hoechste(&l.pool).await;
    kopf_patch(&l, einsatz, json!({ "leitstellen_nr": "L-1" })).await;
    assert_eq!(
        neu_seit(&l.pool, &a, ab).await,
        vec![e("einsatz.updated", einsatz)]
    );

    let ab = hoechste(&l.pool).await;
    kopf_patch(&l, einsatz, json!({ "bezeichnung": "Hochwasser Süd" })).await;
    let mut neu = neu_seit(&l.pool, &a, ab).await;
    neu.sort();
    assert_eq!(
        neu,
        vec![e("einsatz.updated", einsatz), e("lage.changed", einsatz)]
    );
}

/// Der Trigger hört auf genau die Spalten, aus denen die Leseroute den Einsatz baut.
#[tokio::test]
async fn der_kopf_trigger_kennt_genau_die_kopfspalten() {
    let l = lage().await;
    let sql: String = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'einsatz_ereignis_kopf'",
    )
    .fetch_one(&l.pool)
    .await
    .unwrap();
    let liste =
        &sql[sql.find("UPDATE OF").unwrap() + "UPDATE OF".len()..sql.find("ON einsatz").unwrap()];
    let mut im_trigger: Vec<&str> = liste.split(',').map(str::trim).collect();
    im_trigger.sort();
    let mut in_rust: Vec<&str> = KOPF_SPALTEN.to_vec();
    in_rust.sort();
    assert_eq!(im_trigger, in_rust, "UPDATE OF nennt die Kopfspalten");
    for spalte in KOPF_SPALTEN {
        assert!(
            sql.contains(&format!("OLD.{spalte} IS NOT NEW.{spalte}")),
            "der Trigger vergleicht {spalte}"
        );
    }
}

// ── Ende (design.md D5) ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn der_abschluss_meldet_je_zugang_genau_ein_closed() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let b = zugang_anlegen(&l.pool, l.org, "B").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    freigeben(&l.pool, &b, einsatz, l.admin_id).await;
    let ab = hoechste(&l.pool).await;

    abschliessen(&l, einsatz).await;

    for z in [&a, &b] {
        assert_eq!(
            neu_seit(&l.pool, z, ab).await,
            vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)]
        );
    }
    let freigaben: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschinenzugang_freigabe")
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!(freigaben, 0, "der Abschluss hat die Freigaben gelöscht");
}

/// Der Abschluss über den Spiegel setzt nur den Status; die Freigabe bleibt stehen und ist nur
/// unwirksam. Das Ende wird trotzdem gemeldet, und zwar einmal.
#[tokio::test]
async fn ein_statuswechsel_ohne_loeschen_der_freigabe_meldet_ebenso_genau_ein_closed() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    let ab = hoechste(&l.pool).await;

    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_at = datetime('now') WHERE id = ?")
        .bind(einsatz)
        .execute(&l.pool)
        .await
        .unwrap();
    assert_eq!(
        neu_seit(&l.pool, &a, ab).await,
        vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)]
    );

    // Später fällt die stehengebliebene Zeile, etwa mit der nächsten Freigabe des Zugangs.
    let ab = hoechste(&l.pool).await;
    sqlx::query("DELETE FROM maschinenzugang_freigabe WHERE zugang_id = ?")
        .bind(&a)
        .execute(&l.pool)
        .await
        .unwrap();
    assert!(
        neu_seit(&l.pool, &a, ab).await.is_empty(),
        "kein zweites closed"
    );

    // Änderungen am abgeschlossenen Einsatz melden nichts mehr.
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    sqlx::query("UPDATE einsatz SET bezeichnung = 'Nachtrag' WHERE id = ?")
        .bind(einsatz)
        .execute(&l.pool)
        .await
        .unwrap();
    assert!(neu_seit(&l.pool, &a, ab).await.is_empty());
}

#[tokio::test]
async fn ein_geloeschter_laufender_einsatz_hinterlaesst_nur_sein_ende() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    kopf_patch(&l, einsatz, json!({ "stichwort": "B3" })).await;
    assert!(ereignisse(&l.pool, &a).await.len() >= 3);

    sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .execute(&l.pool)
        .await
        .expect("hartes Löschen scheitert nicht an der Outbox");

    assert_eq!(
        ereignisse(&l.pool, &a).await,
        vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)],
        "nichts Früheres zu diesem Einsatz, genau ein Ende"
    );
}

#[tokio::test]
async fn ein_geloeschter_abgeschlossener_einsatz_behaelt_sein_noch_nicht_abgeholtes_ende() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    kopf_patch(&l, einsatz, json!({ "leitstellen_nr": "L-1" })).await;
    let ab = hoechste(&l.pool).await;
    abschliessen(&l, einsatz).await;
    let ende = neu_seit(&l.pool, &a, ab).await;
    assert_eq!(
        ende,
        vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)]
    );

    // Gelöscht, bevor der Zugang abruft (Demo-Daten entfernen, Abräumen eines Spiegels).
    sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .execute(&l.pool)
        .await
        .unwrap();

    assert_eq!(
        ereignisse(&l.pool, &a).await,
        ende,
        "das Ende bleibt, was über den Inhalt berichtete, geht mit"
    );
}

/// Ein Zugang, dessen Freigabe vorher endete, behält sein `einsatz.closed`, auch wenn der
/// laufende Einsatz danach gelöscht wird; der andere Zugang bekommt sein Ende beim Löschen.
#[tokio::test]
async fn ein_geloeschter_laufender_einsatz_nimmt_das_ende_eines_anderen_zugangs_nicht_mit() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let b = zugang_anlegen(&l.pool, l.org, "B").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    freigeben(&l.pool, &b, einsatz, l.admin_id).await;
    let mut conn = l.pool.acquire().await.unwrap();
    assert!(freigabe::beenden_tx(&mut conn, &a, einsatz).await.unwrap());
    drop(conn);

    sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .execute(&l.pool)
        .await
        .unwrap();

    assert_eq!(
        ereignisse(&l.pool, &a).await,
        vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)]
    );
    assert_eq!(
        ereignisse(&l.pool, &b).await,
        vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)]
    );
}

// ── Lage (design.md D6) ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn viele_aenderungen_an_der_lage_ergeben_je_zugang_ein_lage_changed() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let b = zugang_anlegen(&l.pool, l.org, "B").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    freigeben(&l.pool, &b, einsatz, l.admin_id).await;

    let mut vorige = std::collections::HashMap::new();
    for i in 0..20 {
        person_anlegen(
            &l.app,
            &l.admin,
            einsatz,
            &format!(r#"{{"nachname":"Person {i}"}}"#),
        )
        .await;
        for z in [&a, &b] {
            let (anzahl, id): (i64, i64) = sqlx::query_as(
                "SELECT COUNT(*), MAX(id) FROM maschine_ereignis \
                 WHERE zugang_id = ? AND type = 'lage.changed' AND einsatz_id = ?",
            )
            .bind(z)
            .bind(einsatz)
            .fetch_one(&l.pool)
            .await
            .unwrap();
            assert_eq!(
                anzahl, 1,
                "je Zugang und Einsatz höchstens ein lage.changed"
            );
            if let Some(vorher) = vorige.insert(z.clone(), id) {
                assert!(
                    id > vorher,
                    "mit jeder Änderung eine höhere Nummer je Zugang"
                );
            }
        }
    }
    // Eine Person ist kein Kopf: kein einsatz.updated.
    assert!(ereignisse(&l.pool, &a)
        .await
        .iter()
        .all(|x| x.0 != "einsatz.updated"));
}

#[tokio::test]
async fn ein_eintrag_im_einsatztagebuch_aendert_die_lage_nicht() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    let ab = hoechste(&l.pool).await;

    let (s, v) = anfrage_json(
        &l.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &l.admin,
        Some(&json!({ "typ": "meldung", "inhalt": "Lage ruhig", "von": "ELW", "an": "EL" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");

    assert!(neu_seit(&l.pool, &a, ab).await.is_empty());
}

// ── Gültigkeit des Zugangs und Spiegel ─────────────────────────────────────────────────────

/// Ein abgelaufener Zugang sammelt keine Änderungen; sein Ende bekommt er trotzdem.
#[tokio::test]
async fn ein_abgelaufener_zugang_sammelt_keine_aenderungen_bekommt_aber_das_ende() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    sqlx::query("UPDATE maschinenzugang SET gueltig_bis = '2026-01-01 00:00:00' WHERE id = ?")
        .bind(&a)
        .execute(&l.pool)
        .await
        .unwrap();
    let ab = hoechste(&l.pool).await;

    kopf_patch(&l, einsatz, json!({ "stichwort": "B3" })).await;
    person_anlegen(&l.app, &l.admin, einsatz, r#"{"nachname":"Muster"}"#).await;
    assert!(
        neu_seit(&l.pool, &a, ab).await.is_empty(),
        "nach Ablauf entstehen weder einsatz.updated noch lage.changed"
    );

    abschliessen(&l, einsatz).await;
    assert_eq!(
        neu_seit(&l.pool, &a, ab).await,
        vec![e("einsatz.closed", einsatz), e("lage.changed", einsatz)]
    );
}

/// Ein Spiegel, dessen Abgleich endet oder dessen Freigabestufe sich ändert, hat eine andere Lage
/// (`einsatz.spiegel` in `GET /api/v1/lage`); der Zeitpunkt des Abgleichs allein nicht.
#[tokio::test]
async fn das_ende_des_spiegel_abgleichs_meldet_lage_changed_der_takt_nicht() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let mut tx = l.pool.begin().await.unwrap();
    for sql in [
        "INSERT INTO spiegel_uebernahme (id) VALUES (1)".to_string(),
        format!(
            "INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES ({einsatz}, 'x/{einsatz}')"
        ),
        "DELETE FROM spiegel_uebernahme".to_string(),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;

    let ab = hoechste(&l.pool).await;
    sqlx::query(
        "UPDATE einsatz_spiegel SET letzter_abgleich_at = datetime('now') WHERE einsatz_id = ?",
    )
    .bind(einsatz)
    .execute(&l.pool)
    .await
    .unwrap();
    assert!(
        neu_seit(&l.pool, &a, ab).await.is_empty(),
        "der Takt allein meldet nichts"
    );

    sqlx::query("UPDATE einsatz_spiegel SET beendet_at = datetime('now') WHERE einsatz_id = ?")
        .bind(einsatz)
        .execute(&l.pool)
        .await
        .unwrap();
    assert_eq!(
        neu_seit(&l.pool, &a, ab).await,
        vec![e("lage.changed", einsatz)]
    );

    let ab = hoechste(&l.pool).await;
    sqlx::query("UPDATE einsatz_spiegel SET beendet_at = beendet_at WHERE einsatz_id = ?")
        .bind(einsatz)
        .execute(&l.pool)
        .await
        .unwrap();
    assert!(
        neu_seit(&l.pool, &a, ab).await.is_empty(),
        "ein gleicher Wert meldet nichts"
    );
}

// ── Wege neben der Oberfläche ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn eine_zurueckgerollte_aenderung_hinterlaesst_kein_ereignis() {
    let l = lage().await;
    let a = zugang_anlegen(&l.pool, l.org, "A").await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    freigeben(&l.pool, &a, einsatz, l.admin_id).await;
    let vorher = ereignisse(&l.pool, &a).await;

    let mut tx = l.pool.begin().await.unwrap();
    sqlx::query("UPDATE einsatz SET stichwort = 'B4' WHERE id = ?")
        .bind(einsatz)
        .execute(&mut *tx)
        .await
        .unwrap();
    let in_der_tx: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschine_ereignis")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert!(
        in_der_tx > vorher.len() as i64,
        "in der Transaktion steht das Ereignis"
    );
    tx.rollback().await.unwrap();

    assert_eq!(ereignisse(&l.pool, &a).await, vorher);
}

/// Der Regelfall der Kopplung: der ELW führt, der Hub hält den Spiegel, und das Fremdsystem
/// spricht mit dem Hub. Die Übernahme schreibt `einsatz` und die Lage-Tabellen an den
/// Repo-Funktionen vorbei.
#[tokio::test]
async fn aenderungen_ueber_den_spiegel_melden_dem_fremdsystem_am_hub() {
    use instanz_hilfen::*;
    let (hub, elw) = gekoppelt().await;
    melden(&elw).await;
    let abgleichen = || async {
        lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
            .await
            .unwrap();
    };

    let e_elw = einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    abgleichen().await;
    let spiegel: i64 = eine(&hub.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;

    let (hub_admin, hub_org): (i64, i64) =
        sqlx::query_as("SELECT id, org_id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    let z = zugang_anlegen(&hub.pool, hub_org, "Einsatzbuch").await;
    freigeben(&hub.pool, &z, spiegel, hub_admin).await;
    let ab = hoechste(&hub.pool).await;

    // Kopf am ELW geändert.
    let (s, v) = anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/einsaetze/{e_elw}"),
        &elw.admin,
        Some(&json!({ "leitstellen_nr": "L-77" })),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    abgleichen().await;
    assert_eq!(
        neu_seit(&hub.pool, &z, ab).await,
        vec![e("einsatz.updated", spiegel)],
        "der übernommene Kopf meldet einsatz.updated am Hub"
    );

    // Lage am ELW geändert.
    let ab = hoechste(&hub.pool).await;
    person_anlegen(&elw.app, &elw.admin, e_elw, r#"{"nachname":"Muster"}"#).await;
    abgleichen().await;
    assert_eq!(
        neu_seit(&hub.pool, &z, ab).await,
        vec![e("lage.changed", spiegel)]
    );

    // Abschluss am ELW: am Hub kommt nur der Status an, die Freigabe bleibt stehen.
    let ab = hoechste(&hub.pool).await;
    let (s, v) = anfrage(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e_elw}/abschliessen"),
        &elw.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    abgleichen().await;
    let neu = neu_seit(&hub.pool, &z, ab).await;
    assert_eq!(
        neu.iter().filter(|x| x.0 == "einsatz.closed").count(),
        1,
        "genau ein einsatz.closed am Hub, war {neu:?}"
    );
}
