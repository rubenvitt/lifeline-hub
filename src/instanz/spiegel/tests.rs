//! Liefern und Übernehmen gegeneinander (design.md D5–D7), mit zwei Datenbanken ohne Leitung: der
//! Führer liefert, der Spiegel übernimmt, bis nichts mehr kommt.

use super::liefern::{self, Absender, Budget};
use super::paket::EinsatzStand;
use super::uebernehmen::{self, Empfaenger};
use sqlx::SqlitePool;
use std::collections::HashMap;

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

async fn eine<T>(pool: &SqlitePool, sql: &str) -> T
where
    T: Send + Unpin + for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

/// Org 1 und eine Kopplung je Seite. Der Führer meldet sich (ELW), der Spiegel wird gemeldet
/// (Hub): Push wie im häufigsten Fall.
async fn zwei_seiten() -> (SqlitePool, SqlitePool) {
    let f = crate::db::test_pool().await;
    let s = crate::db::test_pool().await;
    for (pool, richtung, adresse) in [
        (&f, "meldet_sich", "'https://hub.example.org'"),
        (&s, "wird_gemeldet", "NULL"),
    ] {
        exec(
            pool,
            "INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Org')",
        )
        .await;
        exec(
            pool,
            &format!(
                "INSERT INTO instanz_kopplung (id, gegenueber_kennung, gegenueber_schluessel, \
                 gegenueber_name, richtung, zustand, gegenueber_adresse) \
                 VALUES (1, 'gegen', 'x', 'Gegenstelle', '{richtung}', 'aktiv', {adresse})"
            ),
        )
        .await;
        exec(
            pool,
            "INSERT INTO instanz_kopplung_org (id, kopplung_id, org_id, fremde_org_kennung, \
             fremde_org_name) VALUES (1, 1, 1, 'hub/1', 'Org')",
        )
        .await;
    }
    (f, s)
}

async fn konto(pool: &SqlitePool, name: &str) -> i64 {
    eine(
        pool,
        &format!(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
             aktiv, erstellt_at, org_rolle) VALUES (1, '{name}', '{name}', 'x', 'keiner', 1, \
             '2026-11-10 00:00:00', 'keine') RETURNING id"
        ),
    )
    .await
}

async fn etb(pool: &SqlitePool, einsatz: i64, lfd: i64, konto: i64) -> i64 {
    eine(
        pool,
        &format!(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, \
             received_at) VALUES ({einsatz}, {lfd}, 'meldung', 'Eintrag {lfd}', {konto}, \
             '2026-11-10 00:00:00', '2026-11-10 00:00:00') RETURNING id"
        ),
    )
    .await
}

/// Ein Abgleich mit höchstens `zeilen` Zeilen; liefert die Zahl der Lieferungen.
async fn abgleichen(f: &SqlitePool, s: &SqlitePool, zeilen: usize) -> usize {
    let staende: Vec<(String, i64)> =
        sqlx::query_as("SELECT fremde_kennung, stand FROM einsatz_spiegel")
            .fetch_all(s)
            .await
            .unwrap();
    let staende: HashMap<String, i64> = staende.into_iter().collect();
    let a = Absender {
        kennung: "elw",
        kopplung_id: 1,
        kopplung_org_id: 1,
        meldend: true,
    };
    let mut budget = Budget::neu(1024 * 1024);
    budget.zeilen = zeilen;
    let mut fc = f.begin().await.unwrap();
    let mut lieferungen = Vec::new();
    for e in liefern::list_gefuehrt(&mut fc, 1, &staende).await.unwrap() {
        let k = liefern::ensure_kennung(&mut fc, "elw", &e).await.unwrap();
        let seit = staende.get(&k).copied().unwrap_or(0);
        if let Some(l) = liefern::liefere_einsatz(&mut fc, &a, &e, &k, "hub/1", seit, &mut budget)
            .await
            .unwrap()
        {
            lieferungen.push(l);
        }
    }
    fc.commit().await.unwrap();
    let mut sc = s.begin().await.unwrap();
    let e = Empfaenger {
        kopplung_id: 1,
        kopplung_org_id: 1,
        org_id: 1,
        meldend: false,
    };
    for l in &lieferungen {
        let erg = uebernehmen::uebernehmen(&mut sc, &e, l).await.unwrap();
        assert!(erg.hinweise.is_empty(), "{:?}", erg.hinweise);
        let _ = EinsatzStand {
            kennung: l.kennung.clone(),
            stand: erg.stand,
            bruch: Vec::new(),
        };
    }
    sc.commit().await.unwrap();
    lieferungen.len()
}

#[tokio::test]
async fn ein_einsatz_kommt_vollstaendig_und_in_der_reihenfolge_der_laufenden_nummer_an() {
    let (f, s) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung, nummer_jahr, nummer_lfd) \
         VALUES (1, 'Hochwasser', 2026, 1) RETURNING id",
    )
    .await;
    // Am Hub gibt es schon einen eigenen Einsatz mit derselben Nummer.
    exec(
        &s,
        "INSERT INTO einsatz (org_id, bezeichnung, nummer_jahr, nummer_lfd) VALUES (1, 'Eigen', 2026, 1)",
    )
    .await;
    for lfd in 1..=300 {
        etb(&f, einsatz, lfd, erika).await;
    }
    let mut runden = 0;
    while abgleichen(&f, &s, 120).await > 0 {
        runden += 1;
        assert!(runden < 20, "Abgleich endet nicht");
    }
    assert!(runden >= 3, "Budget teilt die Lieferung ({runden} Runden)");
    let spiegel: i64 = eine(&s, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let lfd: Vec<i64> =
        sqlx::query_scalar("SELECT lfd_nr FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
            .bind(spiegel)
            .fetch_all(&s)
            .await
            .unwrap();
    assert_eq!(
        lfd,
        (1..=300).collect::<Vec<_>>(),
        "alle, keiner doppelt, in Reihenfolge"
    );
    let name: String = eine(
        &s,
        &format!(
            "SELECT b.anzeigename FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
             WHERE e.einsatz_id = {spiegel} AND e.lfd_nr = 7"
        ),
    )
    .await;
    assert_eq!(name, "Erika", "Verfasser über den Stellvertreter");
    let (aktiv, rolle): (i64, String) = sqlx::query_as(
        "SELECT b.aktiv, b.system_rolle FROM spiegel_konto k JOIN benutzer b ON b.id = k.benutzer_id",
    )
    .fetch_one(&s)
    .await
    .unwrap();
    assert_eq!(
        (aktiv, rolle.as_str()),
        (0, "keiner"),
        "Stellvertreter meldet sich nie an"
    );
    let bezeichnung: String = eine(
        &s,
        &format!("SELECT bezeichnung FROM einsatz WHERE id = {spiegel}"),
    )
    .await;
    assert_eq!(bezeichnung, "Hochwasser");

    // Änderung, Löschung und Umbenennung kommen mit dem nächsten Abgleich.
    exec(
        &f,
        &format!("UPDATE einsatz SET bezeichnung = 'Hochwasser Süd' WHERE id = {einsatz}"),
    )
    .await;
    exec(
        &f,
        &format!("UPDATE benutzer SET anzeigename = 'Erika M.' WHERE id = {erika}"),
    )
    .await;
    let neu = etb(&f, einsatz, 301, erika).await;
    exec(&f, &format!("DELETE FROM etb_eintrag WHERE id = {neu}")).await;
    let uhs: i64 = eine(
        &f,
        &format!(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES ({einsatz}, 'sonstige', 'UHS 1', {erika}, {erika}) RETURNING id"
        ),
    )
    .await;
    exec(
        &f,
        &format!(
            "INSERT INTO uhs_platz (uhs_id, typ, bezeichnung) VALUES ({uhs}, 'bett', 'Bett 1')"
        ),
    )
    .await;
    while abgleichen(&f, &s, 120).await > 0 {}
    let bezeichnung: String = eine(
        &s,
        &format!("SELECT bezeichnung FROM einsatz WHERE id = {spiegel}"),
    )
    .await;
    assert_eq!(bezeichnung, "Hochwasser Süd");
    let anzahl: i64 = eine(
        &s,
        &format!("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = {spiegel}"),
    )
    .await;
    assert_eq!(anzahl, 300, "gelöschte Zeile fehlt auch im Spiegel");
    let platz: String = eine(
        &s,
        &format!(
            "SELECT p.bezeichnung FROM uhs_platz p JOIN uhs u ON u.id = p.uhs_id \
             WHERE u.einsatz_id = {spiegel}"
        ),
    )
    .await;
    assert_eq!(platz, "Bett 1", "Kind über die Elternzeile abgebildet");
    let name: String = eine(
        &s,
        "SELECT b.anzeigename FROM spiegel_konto k JOIN benutzer b ON b.id = k.benutzer_id",
    )
    .await;
    // Die Umbenennung allein ändert keine Einsatzzeile; sie kommt mit der nächsten Zeile, die
    // auf das Konto zeigt (hier die UHS).
    assert_eq!(name, "Erika M.");
}

#[tokio::test]
async fn verweis_auf_eine_spaeter_geaenderte_zeile_kommt_vorher_mit() {
    let (f, s) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    let meldung: i64 = eine(
        &f,
        &format!(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, ereigniszeit, \
             eingang_at, erfasst_von_id) VALUES ({einsatz}, 1, 'A', 'funk', 'M', \
             '2026-11-10 00:00:00', '2026-11-10 00:00:00', {erika}) RETURNING id"
        ),
    )
    .await;
    let eintrag = etb(&f, einsatz, 1, erika).await;
    exec(
        &f,
        &format!("UPDATE etb_eintrag SET meldung_id = {meldung} WHERE id = {eintrag}"),
    )
    .await;
    // Die Meldung ändert sich danach: ihr Stand liegt über dem des Eintrags.
    exec(
        &f,
        &format!("UPDATE meldung SET inhalt = 'M2' WHERE id = {meldung}"),
    )
    .await;
    // Ein Budget von zwei Zeilen endet vor der Meldung.
    abgleichen(&f, &s, 2).await;
    let spiegel: i64 = eine(&s, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let verweis: Option<String> = eine(
        &s,
        &format!(
            "SELECT m.inhalt FROM etb_eintrag e LEFT JOIN meldung m ON m.id = e.meldung_id \
             WHERE e.einsatz_id = {spiegel}"
        ),
    )
    .await;
    assert_eq!(
        verweis.as_deref(),
        Some("M2"),
        "Meldung kam mit dem Eintrag"
    );
}

#[tokio::test]
async fn stammdaten_bildet_die_meldende_seite_ab_und_demo_bleibt_draussen() {
    let (f, s) = zwei_seiten().await;
    // Ein Fahrzeug vom Hub (Herkunft am ELW) und ein geliehenes, das es nur am ELW gibt.
    let hub_fahrzeug: i64 = eine(
        &s,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1') RETURNING id",
    )
    .await;
    let elw_fahrzeug: i64 = eine(
        &f,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1') RETURNING id",
    )
    .await;
    exec(
        &f,
        &format!(
            "INSERT INTO stammdaten_herkunft (kopplung_org_id, org_id, art, fremder_schluessel, \
             lokaler_schluessel) VALUES (1, 1, 'fahrzeug', '{hub_fahrzeug}', '{elw_fahrzeug}')"
        ),
    )
    .await;
    let geliehen: i64 = eine(
        &f,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Leih 1') RETURNING id",
    )
    .await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    for (fz, name) in [(elw_fahrzeug, "Hub 1"), (geliehen, "Leih 1")] {
        exec(
            &f,
            &format!(
                "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
                 VALUES ({einsatz}, {fz}, '{name}')"
            ),
        )
        .await;
    }
    let demo: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Übung') RETURNING id",
    )
    .await;
    exec(
        &f,
        &format!(
            "INSERT INTO demo_import (org_id, einsatz_id, bericht) VALUES (1, {demo}, '{{}}')"
        ),
    )
    .await;
    while abgleichen(&f, &s, 500).await > 0 {}
    let anzahl: i64 = eine(&s, "SELECT COUNT(*) FROM einsatz_spiegel").await;
    assert_eq!(anzahl, 1, "Demo-Einsatz wird nicht gespiegelt");
    let spiegel: i64 = eine(&s, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let zeilen: Vec<(String, Option<i64>)> = sqlx::query_as(
        "SELECT snap_funkrufname, fahrzeug_id FROM einsatz_fahrzeug WHERE einsatz_id = ? \
         ORDER BY snap_funkrufname",
    )
    .bind(spiegel)
    .fetch_all(&s)
    .await
    .unwrap();
    assert_eq!(
        zeilen,
        vec![
            ("Hub 1".to_string(), Some(hub_fahrzeug)),
            ("Leih 1".to_string(), None),
        ],
        "Hub-Fahrzeug über die Herkunft, geliehenes leer mit Schnappschuss"
    );
}

#[tokio::test]
async fn unbekannte_freigabestufe_haelt_den_spiegel_an() {
    let (f, s) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    etb(&f, einsatz, 1, erika).await;
    while abgleichen(&f, &s, 500).await > 0 {}
    let vorher: i64 = eine(&s, "SELECT stand FROM einsatz_spiegel").await;
    let kennung: String = eine(&s, "SELECT fremde_kennung FROM einsatz_spiegel").await;
    let l = super::paket::EinsatzLieferung {
        kennung,
        org: "hub/1".into(),
        org_id: 1,
        freigabestufe: "nur_lage".into(),
        seit: vorher,
        bis: vorher + 10,
        ..Default::default()
    };
    let mut sc = s.acquire().await.unwrap();
    let e = Empfaenger {
        kopplung_id: 1,
        kopplung_org_id: 1,
        org_id: 1,
        meldend: false,
    };
    let erg = uebernehmen::uebernehmen(&mut sc, &e, &l).await.unwrap();
    assert_eq!(erg.stand, vorher, "Stand bleibt");
    assert!(erg
        .hinweise
        .iter()
        .any(|h| h.contains("Freigabestufe unbekannt")));
}

#[tokio::test]
async fn die_volltextsuche_findet_gespiegelte_eintraege() {
    let (f, s) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    exec(
        &f,
        &format!(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, \
             received_at) VALUES ({einsatz}, 1, 'meldung', 'Deichbruch bei Kilometer 4', {erika}, \
             '2026-11-10 00:00:00', '2026-11-10 00:00:00')"
        ),
    )
    .await;
    while abgleichen(&f, &s, 500).await > 0 {}
    let treffer: i64 = eine(
        &s,
        "SELECT COUNT(*) FROM etb_eintrag_fts WHERE etb_eintrag_fts MATCH 'Deichbruch'",
    )
    .await;
    assert_eq!(treffer, 1);
}

/// CodeRabbit auf #1266: eine Zeile, deren Abhängigkeit das Restbudget sprengt, geht nur als
/// erste des Pakets. Nach einer früheren Lieferung wartet der Einsatz, ohne das Budget zu
/// verbrauchen; mit frischem Budget kommt er voran.
#[tokio::test]
async fn grosse_abhaengigkeit_nach_einer_frueheren_lieferung_wartet() {
    use super::paket::ZEILEN_MAX;
    let (f, _) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    let meldung: i64 = eine(
        &f,
        &format!(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, ereigniszeit, \
             eingang_at, erfasst_von_id) VALUES ({einsatz}, 1, 'A', 'funk', 'M', \
             '2026-11-10 00:00:00', '2026-11-10 00:00:00', {erika}) RETURNING id"
        ),
    )
    .await;
    let eintrag = etb(&f, einsatz, 1, erika).await;
    exec(
        &f,
        &format!("UPDATE etb_eintrag SET meldung_id = {meldung} WHERE id = {eintrag}"),
    )
    .await;
    // Die Meldung wächst danach weit über das Restbudget; ihr Stand liegt über dem des Eintrags.
    exec(
        &f,
        &format!(
            "UPDATE meldung SET inhalt = '{}' WHERE id = {meldung}",
            "x".repeat(20_000)
        ),
    )
    .await;
    let a = Absender {
        kennung: "elw",
        kopplung_id: 1,
        kopplung_org_id: 1,
        meldend: true,
    };
    let mut fc = f.begin().await.unwrap();
    let e = liefern::list_gefuehrt(&mut fc, 1, &HashMap::new())
        .await
        .unwrap()
        .remove(0);
    let k = liefern::ensure_kennung(&mut fc, "elw", &e).await.unwrap();
    let groesse = |l: &super::paket::EinsatzLieferung| {
        l.zeilen
            .iter()
            .map(|z| serde_json::to_vec(z).unwrap().len())
            .sum::<usize>()
    };

    // Eine frühere Lieferung hat das Paket angebrochen: höchstens die Zeilen vor der Meldung,
    // und nie mehr Bytes, als übrig waren.
    let mut seit = 0;
    let mut runden = 0;
    loop {
        let mut budget = Budget::neu(4_000);
        budget.zeilen = ZEILEN_MAX - 1;
        let vorher = budget.clone();
        let Some(l) = liefern::liefere_einsatz(&mut fc, &a, &e, &k, "hub/1", seit, &mut budget)
            .await
            .unwrap()
        else {
            assert_eq!(budget.bytes, vorher.bytes, "Budget unverbraucht zurück");
            assert_eq!(budget.zeilen, vorher.zeilen);
            break;
        };
        assert!(groesse(&l) <= vorher.bytes, "Lieferung bleibt im Budget");
        assert!(l.bis > seit);
        seit = l.bis;
        runden += 1;
        assert!(runden < 10, "Liefern endet nicht");
    }
    let rest: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_aenderung WHERE einsatz_id = ? AND stand > ?",
    )
    .bind(einsatz)
    .bind(seit)
    .fetch_one(&mut *fc)
    .await
    .unwrap();
    assert!(rest > 0, "die Meldung steht noch aus");

    // Als erste des Pakets geht es weiter, bis nichts mehr aussteht.
    loop {
        let mut budget = Budget::neu(4_000);
        let Some(l) = liefern::liefere_einsatz(&mut fc, &a, &e, &k, "hub/1", seit, &mut budget)
            .await
            .unwrap()
        else {
            break;
        };
        assert!(l.bis > seit, "Fortschritt");
        seit = l.bis;
        runden += 1;
        assert!(runden < 20, "Liefern endet nicht");
    }
    let rest: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_aenderung WHERE einsatz_id = ? AND stand > ?",
    )
    .bind(einsatz)
    .bind(seit)
    .fetch_one(&mut *fc)
    .await
    .unwrap();
    assert_eq!(rest, 0, "alles geliefert");
}

/// CodeRabbit auf #1266: `gegen_id` trifft nur ein echtes Konto der Org des Einsatzes. Ein Konto
/// einer anderen Org und ein Stellvertreter (auch einer anderen Kopplung) zählen nicht; dann
/// greift der Stellvertreter dieser Kopplung.
#[tokio::test]
async fn gegen_id_auf_ein_fremdes_konto_wird_stellvertreter() {
    use super::abbildung::konto_lokal;
    use super::paket::KontoAngabe;
    let (_, s) = zwei_seiten().await;
    let eigen = konto(&s, "eigen").await;
    exec(
        &s,
        "INSERT INTO organisation (id, name) VALUES (2, 'Fremd')",
    )
    .await;
    let fremd: i64 = eine(
        &s,
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
         aktiv, erstellt_at, org_rolle) VALUES (2, 'fremd', 'fremd', 'x', 'keiner', 1, \
         '2026-11-10 00:00:00', 'keine') RETURNING id",
    )
    .await;
    let mut conn = s.acquire().await.unwrap();
    let angabe = |id: i64, gegen_id: i64| KontoAngabe {
        id,
        anzeigename: format!("Konto {id}"),
        gegen_id: Some(gegen_id),
    };

    let lokal = konto_lokal(&mut conn, 1, 1, 1, false, &angabe(10, eigen))
        .await
        .unwrap();
    assert_eq!(lokal, eigen, "ein Konto der eigenen Org gilt");

    let lokal = konto_lokal(&mut conn, 1, 1, 1, false, &angabe(11, fremd))
        .await
        .unwrap();
    assert_ne!(lokal, fremd, "ein Konto einer anderen Org nie");
    let stellvertreter: i64 =
        sqlx::query_scalar("SELECT benutzer_id FROM spiegel_konto WHERE fremde_id = 11")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    assert_eq!(lokal, stellvertreter);

    let lokal = konto_lokal(&mut conn, 1, 1, 1, false, &angabe(12, stellvertreter))
        .await
        .unwrap();
    assert_ne!(lokal, stellvertreter, "ein Stellvertreter nie");
}

/// Ein Absender vor LLH-1629 liefert eine genutzte Katalog-Sprechgruppe nicht mit. Der Spiegel
/// rückt dann trotzdem vor (mit Hinweis), statt bis zu dessen Update stehen zu bleiben; ein
/// neuer Absender liefert sie nach, dort wartet der Spiegel.
#[tokio::test]
async fn ohne_katalogzeile_eines_aelteren_absenders_rueckt_der_spiegel_vor() {
    let (f, s) = zwei_seiten().await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    let abschnitt: i64 = eine(
        &f,
        &format!(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES ({einsatz}, 'Nord') \
             RETURNING id"
        ),
    )
    .await;
    let sg: i64 = eine(
        &f,
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart) VALUES (1, 'Kanal 7', 'DMO') \
         RETURNING id",
    )
    .await;
    exec(
        &f,
        &format!(
            "INSERT INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id) \
             VALUES ({abschnitt}, {sg})"
        ),
    )
    .await;
    let a = Absender {
        kennung: "elw",
        kopplung_id: 1,
        kopplung_org_id: 1,
        meldend: true,
    };
    let mut budget = Budget::neu(1024 * 1024);
    let mut fc = f.begin().await.unwrap();
    let staende = HashMap::new();
    let e = liefern::list_gefuehrt(&mut fc, 1, &staende)
        .await
        .unwrap()
        .remove(0);
    let k = liefern::ensure_kennung(&mut fc, "elw", &e).await.unwrap();
    let mut l = liefern::liefere_einsatz(&mut fc, &a, &e, &k, "hub/1", 0, &mut budget)
        .await
        .unwrap()
        .expect("Lieferung");
    fc.commit().await.unwrap();
    assert!(l.katalog);
    let voll = l.clone();
    let vorher = l.zeilen.len();
    l.zeilen
        .retain(|z| !(z.art == "sprechgruppe" && z.schluessel == sg.to_string()));
    assert_eq!(l.zeilen.len(), vorher - 1, "Katalogzeile war mitgeliefert");
    let empf = Empfaenger {
        kopplung_id: 1,
        kopplung_org_id: 1,
        org_id: 1,
        meldend: false,
    };
    for (katalog, rueckt_vor) in [(true, false), (false, true)] {
        l.katalog = katalog;
        let mut sc = s.begin().await.unwrap();
        let erg = uebernehmen::uebernehmen(&mut sc, &empf, &l).await.unwrap();
        assert!(
            erg.hinweise.iter().any(|h| h.contains("Bezug fehlt")),
            "{:?}",
            erg.hinweise
        );
        assert_eq!(erg.stand == l.bis, rueckt_vor, "katalog = {katalog}");
        sc.rollback().await.unwrap();
    }

    // Der ältere Absender liefert wirklich, danach kommt er mit Update: Mit der nächsten Änderung
    // des Einsatzes holt der Spiegel die übersprungene Zuordnung samt Sprechgruppe nach.
    l.katalog = false;
    let mut sc = s.begin().await.unwrap();
    uebernehmen::uebernehmen(&mut sc, &empf, &l).await.unwrap();
    sc.commit().await.unwrap();
    let zuordnungen = "SELECT COUNT(*) FROM einsatzabschnitt_sprechgruppe z \
         JOIN einsatzabschnitt a ON a.id = z.abschnitt_id JOIN einsatz e ON e.id = a.einsatz_id \
         WHERE e.spiegel = 1";
    assert_eq!(eine::<i64>(&s, zuordnungen).await, 0);
    let ab: i64 = eine(&s, "SELECT katalog_ab FROM einsatz_spiegel").await;
    assert!(ab >= 2, "{ab}");
    // Eine kürzere Wiederholung unterhalb des Merkers (Budget): Stand höchstens davor, Merker bleibt.
    let mut kurz = l.clone();
    kurz.katalog = true;
    kurz.seit = ab - 2;
    kurz.bis = ab - 1;
    kurz.zeilen
        .retain(|z| z.stand > kurz.seit && z.stand <= kurz.bis);
    let mut sc = s.begin().await.unwrap();
    let erg = uebernehmen::uebernehmen(&mut sc, &empf, &kurz)
        .await
        .unwrap();
    assert_eq!(erg.stand, ab - 1);
    let merker: Option<i64> = sqlx::query_scalar("SELECT katalog_ab FROM einsatz_spiegel")
        .fetch_one(&mut *sc)
        .await
        .unwrap();
    assert_eq!(merker, Some(ab));
    sc.rollback().await.unwrap();
    // Eine Wiederholung über den Merker nach verlorener Antwort, in der die Zuordnung wieder
    // scheitert: Der Stand fällt vor sie zurück, obwohl er schon höher stand.
    let mut wieder = l.clone();
    wieder.katalog = true;
    wieder.seit = 1;
    wieder.zeilen.retain(|z| z.stand > wieder.seit);
    let hoeher = "UPDATE einsatz_spiegel SET stand = stand + 50";
    let mut sc = s.begin().await.unwrap();
    sqlx::query(hoeher).execute(&mut *sc).await.unwrap();
    let erg = uebernehmen::uebernehmen(&mut sc, &empf, &wieder)
        .await
        .unwrap();
    assert_eq!(erg.stand, ab - 1);
    sc.rollback().await.unwrap();
    // Gelingt eine solche Wiederholung bis zum Merker, gilt höchstens ihr Ende: Was der ältere
    // Absender danach noch übersprungen haben kann, kommt erneut.
    let mut bis_merker = voll.clone();
    bis_merker.katalog = true;
    bis_merker.seit = 1;
    bis_merker.bis = ab;
    bis_merker.zeilen.retain(|z| {
        (z.art == "sprechgruppe" && z.schluessel == sg.to_string())
            || (z.stand > 1 && z.stand <= ab)
    });
    let mut sc = s.begin().await.unwrap();
    sqlx::query(hoeher).execute(&mut *sc).await.unwrap();
    let erg = uebernehmen::uebernehmen(&mut sc, &empf, &bis_merker)
        .await
        .unwrap();
    assert_eq!(erg.stand, ab);
    let merker: Option<i64> = sqlx::query_scalar("SELECT katalog_ab FROM einsatz_spiegel")
        .fetch_one(&mut *sc)
        .await
        .unwrap();
    assert_eq!(merker, None);
    sc.rollback().await.unwrap();
    exec(
        &f,
        &format!("UPDATE einsatzabschnitt SET name = 'Nord 2' WHERE id = {abschnitt}"),
    )
    .await;
    while abgleichen(&f, &s, 500).await > 0 {}
    assert_eq!(eine::<i64>(&s, zuordnungen).await, 1, "nachgeholt");
    assert!(
        eine::<Option<i64>>(&s, "SELECT katalog_ab FROM einsatz_spiegel")
            .await
            .is_none()
    );
}

#[tokio::test]
async fn ein_spiegel_bekommt_nie_die_id_eines_entfernten_demo_einsatzes() {
    let (f, s) = zwei_seiten().await;
    exec(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung, nummer_jahr, nummer_lfd) \
         VALUES (1, 'Hochwasser', 2026, 1)",
    )
    .await;
    // Am Hub war ein Demo-Einsatz 40, er ist entfernt; seine ID bleibt gesperrt (LFH-690).
    exec(
        &s,
        "INSERT INTO demo_import (org_id, einsatz_id, entfernt_at, bericht) \
         VALUES (1, 40, '2026-11-10 00:00:00', '{}')",
    )
    .await;
    while abgleichen(&f, &s, 120).await > 0 {}
    let spiegel: i64 = eine(&s, "SELECT einsatz_id FROM einsatz_spiegel").await;
    assert_eq!(
        spiegel, 41,
        "über der gesperrten Demo-ID, nicht MAX(id)+1 = 1"
    );
    let herkunft: String = eine(
        &s,
        "SELECT lokaler_schluessel FROM spiegel_herkunft WHERE art = 'einsatz'",
    )
    .await;
    assert_eq!(herkunft, "41");
}

#[tokio::test]
async fn die_eigene_einsatznummer_zaehlt_spiegel_nicht_mit() {
    let (_f, s) = zwei_seiten().await;
    let erika = konto(&s, "Erika").await;
    exec(
        &s,
        "INSERT INTO einsatz (org_id, bezeichnung, nummer_jahr, nummer_lfd, \
         einsatznummer_intern, spiegel) VALUES (1, 'Spiegel', 2026, 7, 'E-2026-0001', 1)",
    )
    .await;
    let jetzt = chrono::DateTime::parse_from_rfc3339("2026-06-01T12:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let eigen = crate::einsatz::repo::anlegen_zum(
        &s,
        crate::einsatz::repo::NeuerEinsatzDaten {
            bezeichnung: "Eigen",
            stichwort: None,
            einsatzart: None,
            begonnen_at: None,
            ort: Default::default(),
            vorlage_id: None,
        },
        erika,
        jetzt,
    )
    .await
    .unwrap();
    assert_eq!(
        eigen.einsatznummer_intern.as_deref(),
        Some("E-2026-0001"),
        "Nummer des Spiegels belegt die eigene nicht, und die Zählung springt nicht über ihn"
    );
}

#[tokio::test]
async fn eine_zeile_ueber_der_paketgrenze_kommt_als_hinweis_und_haelt_den_abgleich_nicht_an() {
    use super::paket::{RESERVE, SPIEGEL_MAX, ZEILE_MAX};
    let (f, s) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung, nummer_jahr, nummer_lfd) \
         VALUES (1, 'Hochwasser', 2026, 1) RETURNING id",
    )
    .await;
    etb(&f, einsatz, 1, erika).await;
    let gross: i64 = etb(&f, einsatz, 2, erika).await;
    sqlx::query("UPDATE etb_eintrag SET inhalt = ? WHERE id = ?")
        .bind("x".repeat(ZEILE_MAX + 1))
        .bind(gross)
        .execute(&f)
        .await
        .unwrap();
    etb(&f, einsatz, 3, erika).await;

    let a = Absender {
        kennung: "elw",
        kopplung_id: 1,
        kopplung_org_id: 1,
        meldend: true,
    };
    // Erster Einsatz eines leeren Pakets: dort ging eine übergroße Zeile bisher allein mit und
    // trieb das Paket über die Grenze.
    let mut budget = Budget::neu(SPIEGEL_MAX - RESERVE);
    let mut fc = f.begin().await.unwrap();
    let e = liefern::list_gefuehrt(&mut fc, 1, &HashMap::new())
        .await
        .unwrap()
        .remove(0);
    let k = liefern::ensure_kennung(&mut fc, "elw", &e).await.unwrap();
    let l = liefern::liefere_einsatz(&mut fc, &a, &e, &k, "hub/1", 0, &mut budget)
        .await
        .unwrap()
        .expect("Lieferung");
    fc.commit().await.unwrap();
    assert!(
        serde_json::to_vec(&l).unwrap().len() < SPIEGEL_MAX - RESERVE,
        "Paket bleibt unter der Grenze"
    );
    let z = l
        .zeilen
        .iter()
        .find(|z| z.art == "etb_eintrag" && z.schluessel == gross.to_string())
        .expect("die große Zeile ist dabei");
    assert!(z.zu_gross && z.daten.is_none());

    let mut sc = s.begin().await.unwrap();
    let erg = uebernehmen::uebernehmen(
        &mut sc,
        &Empfaenger {
            kopplung_id: 1,
            kopplung_org_id: 1,
            org_id: 1,
            meldend: false,
        },
        &l,
    )
    .await
    .unwrap();
    sc.commit().await.unwrap();
    assert_eq!(erg.stand, l.bis, "der Stand rückt vor");
    assert!(
        erg.hinweise
            .iter()
            .any(|h| h.contains("zu groß für den Abgleich")),
        "{:?}",
        erg.hinweise
    );
    // Nur übernommene Zeilen erledigen einen Hinweis „zu groß“, die große selbst nicht.
    let erledigt: Vec<&str> = erg
        .erledigt
        .iter()
        .filter(|(art, _)| art == "etb_eintrag")
        .map(|(_, s)| s.as_str())
        .collect();
    assert_eq!(erledigt.len(), 2, "{erledigt:?}");
    assert!(!erledigt.contains(&gross.to_string().as_str()));
    let spiegel: i64 = eine(&s, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let lfd: Vec<i64> =
        sqlx::query_scalar("SELECT lfd_nr FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr")
            .bind(spiegel)
            .fetch_all(&s)
            .await
            .unwrap();
    assert_eq!(lfd, [1, 3], "die übrigen Zeilen kommen an");
}
