//! Tests von Prüfsumme, Bestand und Sendebremse (tasks.md 2.1, 2.2, 3.2 der Change
//! `n2ge2224-reste-nach-restore-abraeumen`).

use super::*;
use crate::instanz::stammdaten::liefern::{build_lieferung, Empfaenger};
use sqlx::SqlitePool;

fn p(art: &str, schluessel: &str) -> (String, String) {
    (art.to_string(), schluessel.to_string())
}

#[test]
fn pruefsumme_haengt_nicht_an_der_reihenfolge() {
    let a = pruefsumme(&[p("fahrzeug", "1"), p("konto", "2"), p("fahrzeug", "3")]);
    let b = pruefsumme(&[p("fahrzeug", "3"), p("fahrzeug", "1"), p("konto", "2")]);
    assert_eq!(a, b);
    assert_eq!(a.len(), PRUEFSUMME_LEN);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn pruefsumme_aendert_sich_mit_schluessel_und_art() {
    let basis = pruefsumme(&[p("fahrzeug", "1"), p("konto", "2")]);
    assert_ne!(basis, pruefsumme(&[p("fahrzeug", "1"), p("konto", "3")]));
    assert_ne!(basis, pruefsumme(&[p("material", "1"), p("konto", "2")]));
    assert_ne!(basis, pruefsumme(&[p("fahrzeug", "1")]));
    // Die Trennzeichen lassen keine Verschiebung zwischen Art und Schlüssel zu.
    assert_ne!(pruefsumme(&[p("ab", "c")]), pruefsumme(&[p("a", "bc")]));
}

#[test]
fn pruefsumme_der_leeren_menge_ist_fest() {
    assert_eq!(pruefsumme(&[]), "e3b0c44298fc1c149afbf4c8996fb924");
}

#[test]
fn paare_eines_bestands() {
    let b = vec![
        StammdatenBestand {
            art: "fahrzeug".into(),
            schluessel: vec!["1".into(), "2".into()],
        },
        StammdatenBestand {
            art: "konto".into(),
            schluessel: Vec::new(),
        },
    ];
    assert_eq!(paare(&b), vec![p("fahrzeug", "1"), p("fahrzeug", "2")]);
}

#[test]
fn sendebremse_haelt_dieselbe_abweichung_zehn_minuten() {
    let t0 = Instant::now();
    let kennung = "bremse-test-a";
    assert!(darf_senden(kennung, 1, "s1", t0), "erstes Mal");
    merke_gesendet(kennung, 1, "s1", t0);
    assert!(!darf_senden(kennung, 1, "s1", t0 + Duration::from_secs(60)));
    assert!(!darf_senden(
        kennung,
        1,
        "s1",
        t0 + SENDEBREMSE - Duration::from_secs(1)
    ));
    assert!(darf_senden(kennung, 1, "s1", t0 + SENDEBREMSE));
    assert!(
        darf_senden(kennung, 1, "s2", t0 + Duration::from_secs(1)),
        "andere Prüfsumme sofort"
    );
    assert!(
        darf_senden(kennung, 2, "s1", t0 + Duration::from_secs(1)),
        "andere Kopplungs-Org"
    );
    assert!(
        darf_senden("bremse-test-b", 1, "s1", t0 + Duration::from_secs(1)),
        "andere Instanz"
    );
}

// ── Bestand an der erreichten Seite ──────────────────────────────────────────────────────────

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(pool)
        .await
        .unwrap();
}

/// Eine Org mit Demo-Daten, dazu jede Sonderregel der Lieferung: eine Sprechgruppe eines Einsatzes
/// (außerhalb des Bereichs), ein Stellvertreter-, ein Archiv- und ein Gerätekonto, eine gelöschte
/// Zeile und eine Zeile einer anderen Org.
async fn pool_mit_bestand() -> SqlitePool {
    let pool = crate::db::test_pool().await;
    crate::instanz::identitaet::load_or_create(&pool)
        .await
        .unwrap();
    crate::auth::bootstrap::bootstrap_admin(&pool, "Org", "admin", Some("startpw12"))
        .await
        .unwrap();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    crate::demo::import::importieren_tx(
        &mut tx,
        1,
        1,
        crate::demo::DemoLage::Starkregen,
        chrono::Utc::now().naive_utc(),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    exec(
        &pool,
        "INSERT INTO organisation (id, name) VALUES (2, 'Fremd')",
    )
    .await;
    exec(
        &pool,
        "INSERT OR IGNORE INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'UTC')",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (2, 'Fremd 1'), (1, 'Weg 1')",
    )
    .await;
    exec(&pool, "DELETE FROM fahrzeug WHERE funkrufname = 'Weg 1'").await;
    // Die Sonderfälle brauchen Einsatz und Kopplung nicht wirklich.
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .unwrap();
    for sql in [
        "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart) \
         VALUES (1, 999, 'Einsatz-TMO', 'TMO'), (1, NULL, 'Katalog-TMO', 'TMO'), \
         (1, NULL, 'Gewandert-TMO', 'TMO')",
        // Aus dem Katalog in einen Einsatz: im Log, aber außerhalb des Bereichs.
        "UPDATE sprechgruppe SET einsatz_id = 999 WHERE bezeichnung = 'Gewandert-TMO'",
        "INSERT INTO benutzer (id, org_id, anzeigename, benutzername, passwort_hash) VALUES \
         (901, 1, 'Stellvertreter', 'stellv', 'x'), (902, 1, 'Archiv', 'archiv', 'x'), \
         (903, 1, 'Monitor', 'monitor', 'x'), (904, 1, 'Normal', 'normal', 'x')",
        "INSERT INTO spiegel_konto (kopplung_id, fremde_id, benutzer_id) VALUES (999, 1, 901)",
        "INSERT INTO archiv_konto (benutzer_id, einsatz_id) VALUES (902, 999)",
        "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, bezeichnung, \
         erstellt_von, laeuft_ab_at) VALUES (999, 903, 'lagemonitor', 'Monitor', 1, \
         '2099-01-01 00:00:00')",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
            .execute(&mut *conn)
            .await
            .unwrap();
    }
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);
    pool
}

fn alle_arten() -> HashSet<StammdatenArt> {
    StammdatenArt::ALLE.into_iter().collect()
}

#[tokio::test]
async fn bestand_ist_was_als_zeile_geliefert_wird() {
    let pool = pool_mit_bestand().await;
    let mut conn = pool.acquire().await.unwrap();
    let bestand = load(&mut conn, 1, &alle_arten()).await.unwrap();
    assert_eq!(
        bestand.len(),
        StammdatenArt::ALLE.len(),
        "jede Art steht im Bestand, auch leer"
    );
    let im_bestand: HashSet<(String, String)> = paare(&bestand).into_iter().collect();
    let log: Vec<(String, String)> = sqlx::query_as(
        "SELECT art, schluessel FROM stammdaten_aenderung WHERE org_id = 1 ORDER BY stand",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    let ohne = Empfaenger {
        kopplung_org_id: 0,
        age: None,
        datentraeger_bestaetigt: false,
    };
    let mut arten_mit_zeile = HashSet::new();
    for (art_text, schluessel) in &log {
        let art = StammdatenArt::parse(art_text).expect("bekannte Art");
        let l = build_lieferung(&mut conn, 1, art, schluessel, 0, &ohne)
            .await
            .unwrap();
        assert_eq!(
            !l.geloescht,
            im_bestand.contains(&(art_text.clone(), schluessel.clone())),
            "{art_text}/{schluessel}: Bestand und Lieferung passen nicht zusammen"
        );
        if !l.geloescht {
            arten_mit_zeile.insert(art);
        }
    }
    assert!(
        im_bestand.iter().all(|k| log.contains(k)),
        "nichts im Bestand, was nie im Log stand"
    );
    // Die Sonderfälle sind wirklich da und fehlen im Bestand.
    for (art, schluessel) in [("konto", "901"), ("konto", "902"), ("konto", "903")] {
        assert!(
            log.contains(&p(art, schluessel)),
            "{art}/{schluessel} im Log"
        );
        assert!(
            !im_bestand.contains(&p(art, schluessel)),
            "{art}/{schluessel}"
        );
    }
    assert!(im_bestand.contains(&p("konto", "904")));
    for art in [
        StammdatenArt::Konto,
        StammdatenArt::OrgEinstellungen,
        StammdatenArt::Fahrzeug,
        StammdatenArt::Sprechgruppe,
    ] {
        assert!(arten_mit_zeile.contains(&art), "{art:?} mit Zeile geprüft");
    }
    let sprechgruppen = bestand
        .iter()
        .find(|b| b.art == "sprechgruppe")
        .unwrap()
        .schluessel
        .clone();
    let einsatz_tmo: String = sqlx::query_scalar(
        "SELECT CAST(id AS TEXT) FROM sprechgruppe WHERE bezeichnung = 'Einsatz-TMO'",
    )
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    assert!(
        !sprechgruppen.contains(&einsatz_tmo),
        "außerhalb des Bereichs"
    );
    let gewandert: String = sqlx::query_scalar(
        "SELECT CAST(id AS TEXT) FROM sprechgruppe WHERE bezeichnung = 'Gewandert-TMO'",
    )
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    assert!(log.contains(&p("sprechgruppe", &gewandert)), "im Log");
    assert!(
        !sprechgruppen.contains(&gewandert),
        "aus dem Bereich gewandert"
    );
}

#[tokio::test]
async fn bestand_nur_der_genannten_arten_und_der_org() {
    let pool = pool_mit_bestand().await;
    let mut conn = pool.acquire().await.unwrap();
    let arten: HashSet<StammdatenArt> = [StammdatenArt::Fahrzeug].into_iter().collect();
    let bestand = load(&mut conn, 1, &arten).await.unwrap();
    assert_eq!(bestand.len(), 1);
    assert_eq!(bestand[0].art, "fahrzeug");
    let fremd: String =
        sqlx::query_scalar("SELECT CAST(id AS TEXT) FROM fahrzeug WHERE funkrufname = 'Fremd 1'")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    assert!(!bestand[0].schluessel.contains(&fremd));
    assert!(!bestand[0].schluessel.is_empty());
    assert_eq!(
        load(&mut conn, 1, &HashSet::new()).await.unwrap(),
        Vec::new()
    );
}

#[tokio::test]
async fn herkunft_der_zuordnung() {
    let pool = crate::db::test_pool().await;
    crate::auth::bootstrap::bootstrap_admin(&pool, "Org", "admin", Some("startpw12"))
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO stammdaten_herkunft \
         (kopplung_org_id, org_id, art, fremder_schluessel, lokaler_schluessel) VALUES \
         (7, 1, 'fahrzeug', '3', '10'), (7, 1, 'konto', '4', '11'), (8, 1, 'fahrzeug', '5', '12')",
    )
    .execute(&mut *conn)
    .await
    .unwrap();
    let mut h = load_herkunft(&mut conn, 7).await.unwrap();
    h.sort();
    assert_eq!(h, vec![p("fahrzeug", "3"), p("konto", "4")]);
}
