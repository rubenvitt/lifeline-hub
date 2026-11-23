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
    // Die Ursprungskennung braucht die eigene Instanzkennung (LLH-1497).
    crate::instanz::identitaet::load_or_create(&f)
        .await
        .unwrap();
    let s = crate::db::test_pool().await;
    // Die Ursprungskennung braucht die eigene Instanzkennung (LLH-1497).
    crate::instanz::identitaet::load_or_create(&s)
        .await
        .unwrap();
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

/// Ein Abgleich mit höchstens `zeilen` Zeilen; liefert die Zahl der Lieferungen. Ein Hinweis der
/// Übernahme ist ein Fehler.
async fn abgleichen(f: &SqlitePool, s: &SqlitePool, zeilen: usize) -> usize {
    let (anzahl, hinweise) = abgleichen_mit_hinweisen(f, s, zeilen).await;
    assert!(hinweise.is_empty(), "{hinweise:?}");
    anzahl
}

/// Wie [`abgleichen`], liefert aber die Hinweise der Übernahme, statt an ihnen zu scheitern.
async fn abgleichen_mit_hinweisen(
    f: &SqlitePool,
    s: &SqlitePool,
    zeilen: usize,
) -> (usize, Vec<String>) {
    let staende: Vec<(String, i64)> =
        sqlx::query_as("SELECT fremde_kennung, stand FROM einsatz_spiegel")
            .fetch_all(s)
            .await
            .unwrap();
    let staende: HashMap<String, i64> = staende.into_iter().collect();
    // Was das Gegenüber kann, steht je Seite an ihrer Kopplung (LLH-1817, design.md D7).
    let mitarbeit = |p: &SqlitePool| {
        let p = p.clone();
        async move {
            eine::<bool>(
                &p,
                "SELECT gegenueber_rolle_mitarbeit FROM instanz_kopplung WHERE id = 1",
            )
            .await
        }
    };
    let a = Absender {
        kennung: "elw",
        kopplung_id: 1,
        kopplung_org_id: 1,
        meldend: true,
        gegenueber_mitarbeit: mitarbeit(f).await,
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
    let gegenueber_mitarbeit = mitarbeit(s).await;
    let mut sc = s.begin().await.unwrap();
    let e = Empfaenger {
        kopplung_id: 1,
        kopplung_org_id: 1,
        org_id: 1,
        meldend: false,
        vor_ort: false,
        gegenueber_mitarbeit,
    };
    let mut hinweise = Vec::new();
    for l in &lieferungen {
        let erg = uebernehmen::uebernehmen(&mut sc, &e, l).await.unwrap();
        hinweise.extend(erg.hinweise);
        let _ = EinsatzStand {
            kennung: l.kennung.clone(),
            stand: erg.stand,
            bruch: Vec::new(),
        };
    }
    sc.commit().await.unwrap();
    (lieferungen.len(), hinweise)
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
        vor_ort: false,
        gegenueber_mitarbeit: true,
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
        gegenueber_mitarbeit: true,
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
        ursprung: None,
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
        gegenueber_mitarbeit: true,
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
        vor_ort: false,
        gegenueber_mitarbeit: true,
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

/// Ein Einsatz des Führers mit der Nummer `E-2026-0001` und den Zahlen `jahr`/`lfd`, dazu ein
/// Eintrag im Einsatztagebuch als übrige Lieferung.
async fn fuehrer_einsatz(f: &SqlitePool, jahr: i64, lfd: i64) -> i64 {
    let erika = konto(f, "Erika").await;
    let id: i64 = eine(
        f,
        &format!(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern, nummer_jahr, \
             nummer_lfd) VALUES (1, 'Hochwasser', 'E-2026-0001', {jahr}, {lfd}) RETURNING id"
        ),
    )
    .await;
    etb(f, id, 1, erika).await;
    id
}

/// (Nummerntext, Jahr, laufende Nummer, ETB-Einträge) des Spiegels.
async fn spiegel_nummer(s: &SqlitePool) -> (Option<String>, Option<i64>, Option<i64>, i64) {
    sqlx::query_as(
        "SELECT e.einsatznummer_intern, e.nummer_jahr, e.nummer_lfd, \
         (SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = e.id) \
         FROM einsatz e JOIN einsatz_spiegel s ON s.einsatz_id = e.id",
    )
    .fetch_one(s)
    .await
    .unwrap()
}

/// Spec `einsatznummer`, „Die Zahlen eines Spiegels liegen in festen Grenzen“ (LLH-1859): Eine
/// laufende Nummer nahe am Höchstwert kommt leer an, Text und übrige Zeilen kommen trotzdem.
#[tokio::test]
async fn eine_laufende_nummer_ausserhalb_der_grenze_kommt_leer_mit_hinweis_an() {
    let (f, s) = zwei_seiten().await;
    let id = fuehrer_einsatz(&f, 2026, i64::MAX).await;
    let mut hinweise = Vec::new();
    loop {
        let (anzahl, h) = abgleichen_mit_hinweisen(&f, &s, 120).await;
        hinweise.extend(h);
        if anzahl == 0 {
            break;
        }
    }
    assert_eq!(
        spiegel_nummer(&s).await,
        (Some("E-2026-0001".into()), None, None, 1)
    );
    assert!(
        hinweise.iter().any(|h| h.contains("Einsatznummer")),
        "{hinweise:?}"
    );
    // Auch eine spätere Fassung des Kopfs (Aktualisierung des Spiegels) kommt nicht durch.
    exec(
        &f,
        &format!("UPDATE einsatz SET bezeichnung = 'Hochwasser Nord' WHERE id = {id}"),
    )
    .await;
    let (_, h) = abgleichen_mit_hinweisen(&f, &s, 120).await;
    assert!(h.iter().any(|h| h.contains("Einsatznummer")), "{h:?}");
    assert_eq!(
        spiegel_nummer(&s).await,
        (Some("E-2026-0001".into()), None, None, 1)
    );
}

#[tokio::test]
async fn ein_unplausibles_jahr_kommt_leer_an() {
    let (f, s) = zwei_seiten().await;
    fuehrer_einsatz(&f, 99999, 3).await;
    let (_, hinweise) = abgleichen_mit_hinweisen(&f, &s, 120).await;
    assert_eq!(hinweise.len(), 1, "{hinweise:?}");
    let (_, jahr, lfd, _) = spiegel_nummer(&s).await;
    assert_eq!((jahr, lfd), (None, None));
}

/// Gültige Zahlen kommen unverändert und ohne Hinweis an (`abgleichen` scheitert an jedem).
#[tokio::test]
async fn gueltige_zahlen_kommen_unveraendert_an() {
    let (f, s) = zwei_seiten().await;
    fuehrer_einsatz(&f, 2026, 12).await;
    while abgleichen(&f, &s, 120).await > 0 {}
    assert_eq!(
        spiegel_nummer(&s).await,
        (Some("E-2026-0001".into()), Some(2026), Some(12), 1)
    );
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
        gegenueber_mitarbeit: true,
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
            vor_ort: false,
            gegenueber_mitarbeit: true,
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

/// Eine Schwärzung beim Führer nimmt am Spiegel jede gesicherte Kopie und alles Geklärte; offene
/// Zeilen bleiben ohne Kopie und werden weiter gefragt (LLH-1649, Review #1284).
#[tokio::test]
async fn schwaerzung_nimmt_die_kopien_und_laesst_offene_zeilen_weiter_fragen() {
    let (_, pool) = zwei_seiten().await;
    let e: i64 = eine(
        &pool,
        "INSERT INTO einsatz (org_id, bezeichnung, kennung) VALUES (1, 'Spiegel', 'k/1') \
         RETURNING id",
    )
    .await;
    crate::einsatz::spiegel_filter::als_spiegel_markieren(&pool, e).await;
    exec(
        &pool,
        &format!(
            "UPDATE einsatz_spiegel SET bruch_offen = 1, kopplung_org_id = 1 WHERE einsatz_id = {e}"
        ),
    )
    .await;
    // entfernt, geklärt, offen, zurückgestellt
    for (schluessel, entfernt, geklaert) in [("1", 1, 1), ("2", 0, 1), ("3", 0, 0), ("4", 0, 2)] {
        sqlx::query(
            "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, daten, \
             entfernt, geklaert, gesichert_at) \
             VALUES (?, 'einsatz_person', ?, 1, '{\"name\":\"Muster\"}', ?, ?, '2026-11-11 12:00:00')",
        )
        .bind(e)
        .bind(schluessel)
        .bind(entfernt)
        .bind(geklaert)
        .execute(&pool)
        .await
        .unwrap();
    }
    let mut conn = pool.acquire().await.unwrap();
    super::fuehrung::raeume_bruchstelle(&mut conn, e)
        .await
        .unwrap();
    drop(conn);
    let uebrig: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT schluessel, daten FROM einsatz_bruchstelle WHERE einsatz_id = ? ORDER BY schluessel",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(uebrig, vec![("3".into(), None), ("4".into(), None)]);
    let offen = format!("SELECT bruch_offen FROM einsatz_spiegel WHERE einsatz_id = {e}");
    assert_eq!(
        eine::<i64>(&pool, &offen).await,
        1,
        "offene Zeilen werden weiter gefragt"
    );

    // Die weiteren Antworten des Führers: Was geklärt ist, geht ganz, statt als leerer Eintrag
    // stehen zu bleiben. Ist nichts mehr offen, fragt der Spiegel nicht mehr.
    let anzahl = format!("SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = {e}");
    let antwort = |unbekannt: Vec<[String; 2]>, bis: &str| super::paket::BruchAntwort {
        kennung: format!("x/{e}"),
        kennt: true,
        unbekannt,
        bis: Some(["einsatz_person".into(), bis.into()]),
    };
    let mut conn = pool.acquire().await.unwrap();
    super::fuehrung::uebernimm_bruch_antworten(
        &mut conn,
        1,
        &[antwort(vec![["einsatz_person".into(), "3".into()]], "3")],
    )
    .await
    .unwrap();
    drop(conn);
    assert_eq!(
        eine::<i64>(&pool, &anzahl).await,
        1,
        "die unbekannte Zeile ist fort"
    );
    assert_eq!(
        eine::<i64>(&pool, &offen).await,
        1,
        "die zurückgestellte kommt noch"
    );
    let mut conn = pool.acquire().await.unwrap();
    super::fuehrung::uebernimm_bruch_antworten(&mut conn, 1, &[antwort(Vec::new(), "4")])
        .await
        .unwrap();
    drop(conn);
    assert_eq!(eine::<i64>(&pool, &anzahl).await, 0);
    assert_eq!(eine::<i64>(&pool, &offen).await, 0);
}

// ── Ursprungskennung (LLH-1497, design.md D5) ───────────────────────────────────────────────

#[tokio::test]
async fn nach_ursprung_findet_eigene_und_uebernommene_zeilen_nie_fremde_org_oder_stellvertreter() {
    use super::abbildung::{konto_ursprung, nach_ursprung, ursprung};
    use crate::instanz::stammdaten::StammdatenArt;
    let (pool, _) = zwei_seiten().await;
    crate::instanz::identitaet::load_or_create(&pool)
        .await
        .unwrap();
    let ich: String = eine(&pool, "SELECT kennung FROM instanz_identitaet").await;
    // Eigene Zeile: eigenes Präfix.
    let fz: i64 = eine(
        &pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Eigen 1') RETURNING id",
    )
    .await;
    assert_eq!(
        ursprung(
            &mut *pool.acquire().await.unwrap(),
            StammdatenArt::Fahrzeug,
            fz
        )
        .await
        .unwrap()
        .as_deref(),
        Some(format!("{ich}/{fz}").as_str())
    );
    assert_eq!(
        nach_ursprung(
            &mut *pool.acquire().await.unwrap(),
            1,
            StammdatenArt::Fahrzeug,
            &format!("{ich}/{fz}")
        )
        .await
        .unwrap(),
        Some(fz)
    );
    // Eine Zeile einer anderen Org gilt nicht.
    exec(
        &pool,
        "INSERT OR IGNORE INTO organisation (id, name) VALUES (2, 'Fremd')",
    )
    .await;
    let fremd: i64 = eine(
        &pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (2, 'Fremd 1') RETURNING id",
    )
    .await;
    assert_eq!(
        nach_ursprung(
            &mut *pool.acquire().await.unwrap(),
            1,
            StammdatenArt::Fahrzeug,
            &format!("{ich}/{fremd}")
        )
        .await
        .unwrap(),
        None
    );
    // Übernommene Zeile: über die gespeicherte Ursprungskennung.
    let vom_hub: i64 = eine(
        &pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1') RETURNING id",
    )
    .await;
    exec(
        &pool,
        &format!(
            "INSERT INTO stammdaten_herkunft (kopplung_org_id, org_id, art, fremder_schluessel, \
             lokaler_schluessel, ursprung) VALUES (1, 1, 'fahrzeug', '7', '{vom_hub}', 'hub/7')"
        ),
    )
    .await;
    assert_eq!(
        ursprung(
            &mut *pool.acquire().await.unwrap(),
            StammdatenArt::Fahrzeug,
            vom_hub
        )
        .await
        .unwrap()
        .as_deref(),
        Some("hub/7")
    );
    assert_eq!(
        nach_ursprung(
            &mut *pool.acquire().await.unwrap(),
            1,
            StammdatenArt::Fahrzeug,
            "hub/7"
        )
        .await
        .unwrap(),
        Some(vom_hub)
    );
    assert_eq!(
        nach_ursprung(
            &mut *pool.acquire().await.unwrap(),
            1,
            StammdatenArt::Fahrzeug,
            "hub/8"
        )
        .await
        .unwrap(),
        None
    );
    // Ein Stellvertreter hat keine Ursprungskennung und wird nie gewählt.
    let sv = konto(&pool, "stellvertreter").await;
    exec(
        &pool,
        &format!(
            "INSERT INTO spiegel_konto (kopplung_id, fremde_id, benutzer_id) VALUES (1, 99, {sv})"
        ),
    )
    .await;
    assert_eq!(
        konto_ursprung(&mut *pool.acquire().await.unwrap(), sv)
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        nach_ursprung(
            &mut *pool.acquire().await.unwrap(),
            1,
            StammdatenArt::Konto,
            &format!("{ich}/{sv}")
        )
        .await
        .unwrap(),
        None
    );
}

/// Protokoll 2 und 3 verstehen einander (LLH-1497, design.md D7): Die neuen Felder sind optional,
/// fehlen in einer Nachricht von Protokoll 2 und stehen leer gar nicht auf der Leitung.
#[test]
fn die_neuen_felder_sind_optional_und_fehlen_leer_auf_der_leitung() {
    use super::paket::{Antrag, KontoAngabe, Zeile};
    let zeile: Zeile = serde_json::from_value(serde_json::json!({
        "art": "etb_eintrag", "schluessel": "1", "stand": 3, "kategorie": "etb"
    }))
    .unwrap();
    assert!(zeile.ursprung.is_empty());
    let text = serde_json::to_string(&zeile).unwrap();
    assert!(!text.contains("ursprung"), "{text}");
    let konto: KontoAngabe =
        serde_json::from_value(serde_json::json!({"id": 1, "anzeigename": "A"})).unwrap();
    assert_eq!(konto.ursprung, None);
    assert!(!serde_json::to_string(&konto).unwrap().contains("ursprung"));
    let antrag: Antrag = serde_json::from_value(serde_json::json!({
        "id": 1, "kennung": "x/1", "art": "etb", "methode": "POST", "pfad_vorlage": "/",
        "daten": {}, "konto": {"id": 1, "anzeigename": "A"}, "erfasst_at": "2026-11-12 08:00:00"
    }))
    .unwrap();
    assert!(antrag.ursprung.is_empty());
    let l: crate::instanz::stammdaten::StammdatenLieferung =
        serde_json::from_value(serde_json::json!({"art": "konto", "schluessel": "1", "stand": 1}))
            .unwrap();
    assert_eq!(l.ursprung, None);
}

#[tokio::test]
async fn ohne_eigene_instanzkennung_gibt_es_keine_erfundene_ursprungskennung() {
    // Liefern aus einer Archivdatei (LLH-1494): dort fehlt `instanz_identitaet`.
    let pool = crate::db::test_pool().await;
    let u = super::abbildung::ursprung(
        &mut *pool.acquire().await.unwrap(),
        crate::instanz::stammdaten::StammdatenArt::Fahrzeug,
        42,
    )
    .await
    .unwrap();
    assert_eq!(u, None);
}

/// LLH-1851: Nach Widerruf und Neuzuordnung derselben Gegen-Org an eine andere Org hier nimmt der
/// Spiegel die Lieferung nicht an. Er bleibt beendet an seiner Zuordnung, und der Absender bekommt
/// Stand 0: Über diese Zuordnung ist nichts übernommen (design.md D2).
#[tokio::test]
async fn eine_zuordnung_einer_anderen_org_haengt_den_spiegel_nicht_um() {
    let (f, s) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    etb(&f, einsatz, 1, erika).await;
    while abgleichen(&f, &s, 500).await > 0 {}
    let spiegel: i64 = eine(&s, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let mut sc = s.acquire().await.unwrap();
    super::beende_fuer_zuordnung(&mut sc, 1, "2026-11-13 00:00:00")
        .await
        .unwrap();
    drop(sc);
    exec(
        &s,
        "UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-13 00:00:00' WHERE id = 1",
    )
    .await;
    exec(
        &s,
        "INSERT INTO organisation (id, name) VALUES (2, 'Org Y')",
    )
    .await;
    exec(
        &s,
        "INSERT INTO instanz_kopplung_org (id, kopplung_id, org_id, fremde_org_kennung, \
         fremde_org_name) VALUES (2, 1, 2, 'hub/1', 'Org')",
    )
    .await;
    let vorher: (i64, Option<i64>, Option<String>, i64) = sqlx::query_as(
        "SELECT e.org_id, s.kopplung_org_id, s.beendet_at, s.stand FROM einsatz e \
         JOIN einsatz_spiegel s ON s.einsatz_id = e.id WHERE e.id = ?",
    )
    .bind(spiegel)
    .fetch_one(&s)
    .await
    .unwrap();
    let kennung: String = eine(&s, "SELECT fremde_kennung FROM einsatz_spiegel").await;
    let l = super::paket::EinsatzLieferung {
        kennung,
        org: "hub/1".into(),
        org_id: 1,
        freigabestufe: "alles".into(),
        seit: 0,
        bis: vorher.3 + 10,
        ..Default::default()
    };
    let e = Empfaenger {
        kopplung_id: 1,
        kopplung_org_id: 2,
        org_id: 2,
        meldend: false,
        vor_ort: false,
        gegenueber_mitarbeit: true,
    };
    let mut sc = s.acquire().await.unwrap();
    let erg = uebernehmen::uebernehmen(&mut sc, &e, &l).await.unwrap();
    drop(sc);
    assert!(
        erg.hinweise
            .iter()
            .any(|h| h.contains("anderen Organisation")),
        "{:?}",
        erg.hinweise
    );
    assert_eq!(erg.stand, 0, "nichts übernommen");
    assert_eq!(
        erg.einsatz_id, None,
        "kein Hinweis am Spiegel der anderen Org"
    );
    let nachher: (i64, Option<i64>, Option<String>, i64) = sqlx::query_as(
        "SELECT e.org_id, s.kopplung_org_id, s.beendet_at, s.stand FROM einsatz e \
         JOIN einsatz_spiegel s ON s.einsatz_id = e.id WHERE e.id = ?",
    )
    .bind(spiegel)
    .fetch_one(&s)
    .await
    .unwrap();
    assert_eq!(nachher, vorher, "Spiegel unverändert");
}

// ── Einsatzrolle „Mitarbeit“ und ältere Gegenüber (LLH-1817, design.md D7) ──────────────────

/// Ein Konto am Hub, das der ELW als Stammdatum übernommen hat: Mitgliedschaften kommen beim
/// Spiegel als echtes Konto an, nicht als Stellvertreter. Liefert (Konto am ELW, Konto am Hub).
async fn gemeinsames_konto(f: &SqlitePool, s: &SqlitePool, name: &str) -> (i64, i64) {
    let hub = konto(s, name).await;
    let elw = konto(f, name).await;
    exec(
        f,
        &format!(
            "INSERT INTO stammdaten_herkunft (kopplung_org_id, org_id, art, fremder_schluessel, \
             lokaler_schluessel) VALUES (1, 1, 'konto', '{hub}', '{elw}')"
        ),
    )
    .await;
    (elw, hub)
}

async fn rolle(pool: &SqlitePool, benutzer: i64) -> String {
    eine(
        pool,
        &format!("SELECT einsatz_rolle FROM einsatz_mitgliedschaft WHERE benutzer_id = {benutzer}"),
    )
    .await
}

#[tokio::test]
async fn mitarbeit_geht_an_altes_gegenueber_als_beobachter() {
    let (f, _s) = zwei_seiten().await;
    let erika = konto(&f, "Erika").await;
    let max = konto(&f, "Max").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    exec(
        &f,
        &format!(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) VALUES \
             ({einsatz}, {erika}, 'mitarbeit'), ({einsatz}, {max}, 'fuehrungspersonal')"
        ),
    )
    .await;
    for (kann, erwartet) in [(false, "beobachter"), (true, "mitarbeit")] {
        let a = Absender {
            kennung: "elw",
            kopplung_id: 1,
            kopplung_org_id: 1,
            meldend: true,
            gegenueber_mitarbeit: kann,
        };
        let mut fc = f.begin().await.unwrap();
        let e = liefern::list_gefuehrt(&mut fc, 1, &HashMap::new())
            .await
            .unwrap()
            .remove(0);
        let k = liefern::ensure_kennung(&mut fc, "elw", &e).await.unwrap();
        let mut budget = Budget::neu(1024 * 1024);
        let l = liefern::liefere_einsatz(&mut fc, &a, &e, &k, "hub/1", 0, &mut budget)
            .await
            .unwrap()
            .expect("Lieferung");
        fc.commit().await.unwrap();
        let rollen: HashMap<i64, String> = l
            .zeilen
            .iter()
            .filter(|z| z.art == "einsatz_mitgliedschaft")
            .filter_map(|z| {
                let d = z.daten.as_ref()?;
                Some((
                    d["benutzer_id"].as_i64()?,
                    d["einsatz_rolle"].as_str()?.to_string(),
                ))
            })
            .collect();
        assert_eq!(rollen.get(&erika).map(String::as_str), Some(erwartet));
        assert_eq!(
            rollen.get(&max).map(String::as_str),
            Some("fuehrungspersonal"),
            "andere Rollen gehen unverändert"
        );
    }
    // Herabgestuft wird nur, was hinausgeht: die Zeile hier bleibt Mitarbeit.
    assert_eq!(rolle(&f, erika).await, "mitarbeit");
}

#[tokio::test]
async fn beobachter_vom_alten_gegenueber_ueberschreibt_mitarbeit_nicht() {
    let (f, s) = zwei_seiten().await;
    let (erika_elw, erika_hub) = gemeinsames_konto(&f, &s, "Erika").await;
    let (max_elw, max_hub) = gemeinsames_konto(&f, &s, "Max").await;
    exec(
        &f,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1",
    )
    .await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    exec(
        &f,
        &format!(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) VALUES \
             ({einsatz}, {erika_elw}, 'mitarbeit'), ({einsatz}, {max_elw}, 'mitarbeit')"
        ),
    )
    .await;
    while abgleichen(&f, &s, 500).await > 0 {}
    assert_eq!(rolle(&s, erika_hub).await, "mitarbeit");

    // Das Gegenüber kennt die Mitarbeit nicht (es liefert, was es als Beobachter bekam). Seine
    // übrigen Spalten gelten, die Rolle bleibt.
    exec(
        &s,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 0",
    )
    .await;
    exec(
        &f,
        &format!(
            "UPDATE einsatz_mitgliedschaft SET einsatz_rolle = 'beobachter', \
             fuehrungsstelle = 'ELW 1' WHERE benutzer_id = {erika_elw}"
        ),
    )
    .await;
    // Eine andere Rolle als Beobachter übernimmt der Spiegel auch von diesem Gegenüber.
    exec(
        &f,
        &format!(
            "UPDATE einsatz_mitgliedschaft SET einsatz_rolle = 'fuehrungspersonal' \
             WHERE benutzer_id = {max_elw}"
        ),
    )
    .await;
    while abgleichen(&f, &s, 500).await > 0 {}
    assert_eq!(rolle(&s, erika_hub).await, "mitarbeit");
    let stelle: Option<String> = eine(
        &s,
        &format!(
            "SELECT fuehrungsstelle FROM einsatz_mitgliedschaft WHERE benutzer_id = {erika_hub}"
        ),
    )
    .await;
    assert_eq!(stelle.as_deref(), Some("ELW 1"), "übrige Spalten gelten");
    assert_eq!(rolle(&s, max_hub).await, "fuehrungspersonal");
    assert_eq!(
        abgleichen(&f, &s, 500).await,
        0,
        "die behaltene Rolle löst keine neue Lieferung aus"
    );

    // Ein Gegenüber, das die Mitarbeit kennt, stuft wirklich herab.
    exec(
        &s,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1",
    )
    .await;
    exec(
        &f,
        &format!(
            "UPDATE einsatz_mitgliedschaft SET fuehrungsstelle = 'ELW 2' \
             WHERE benutzer_id = {erika_elw}"
        ),
    )
    .await;
    while abgleichen(&f, &s, 500).await > 0 {}
    assert_eq!(rolle(&s, erika_hub).await, "beobachter");
}

/// Stand einer Zeile im Log des Führers.
async fn log_stand(pool: &SqlitePool, art: &str, schluessel: &str) -> i64 {
    eine(
        pool,
        &format!(
            "SELECT stand FROM einsatz_aenderung WHERE art = '{art}' AND schluessel = '{schluessel}'"
        ),
    )
    .await
}

/// Führer mit einer Mitarbeit (Erika), einem Führungspersonal (Max) und einem ETB-Eintrag; der
/// Spiegel ist ein älterer Stand und hat Erika als Beobachter übernommen. Liefert (Einsatz am
/// Führer, Erika am Führer, Erika am Spiegel, Max am Führer).
async fn mitarbeit_beim_alten_spiegel(f: &SqlitePool, s: &SqlitePool) -> (i64, i64, i64, i64) {
    let (erika_elw, erika_hub) = gemeinsames_konto(f, s, "Erika").await;
    let (max_elw, _) = gemeinsames_konto(f, s, "Max").await;
    let einsatz: i64 = eine(
        f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    exec(
        f,
        &format!(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) VALUES \
             ({einsatz}, {erika_elw}, 'mitarbeit'), ({einsatz}, {max_elw}, 'fuehrungspersonal')"
        ),
    )
    .await;
    etb(f, einsatz, 1, erika_elw).await;
    while abgleichen(f, s, 500).await > 0 {}
    assert_eq!(rolle(s, erika_hub).await, "beobachter");
    (einsatz, erika_elw, erika_hub, max_elw)
}

#[tokio::test]
async fn aufgeruestetes_gegenueber_bekommt_mitarbeit_nachgeliefert() {
    // Beide Speicherstellen: die meldende Seite aus der Antwort, die erreichte aus der Anfrage.
    for erreicht in [false, true] {
        let (f, s) = zwei_seiten().await;
        let (einsatz, erika, erika_hub, max) = mitarbeit_beim_alten_spiegel(&f, &s).await;
        let erika_key = format!("[{einsatz},{erika}]");
        let max_key = format!("[{einsatz},{max}]");
        let vorher_erika = log_stand(&f, "einsatz_mitgliedschaft", &erika_key).await;
        let vorher_max = log_stand(&f, "einsatz_mitgliedschaft", &max_key).await;
        let vorher_einsatz = log_stand(&f, "einsatz", &einsatz.to_string()).await;
        // Das Gegenüber ist aufgerüstet und nennt die Fähigkeit beim nächsten Melden.
        let mut fc = f.acquire().await.unwrap();
        if erreicht {
            crate::instanz::repo::save_rolle_mitarbeit(&mut fc, 1, true)
                .await
                .unwrap();
        } else {
            crate::instanz::repo::save_faehigkeiten(&mut fc, 1, false, false, false, None, true)
                .await
                .unwrap();
        }
        drop(fc);
        exec(
            &s,
            "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1",
        )
        .await;
        assert!(
            log_stand(&f, "einsatz_mitgliedschaft", &erika_key).await > vorher_erika,
            "die Mitarbeit steht neu im Log"
        );
        assert_eq!(
            log_stand(&f, "einsatz_mitgliedschaft", &max_key).await,
            vorher_max,
            "andere Rollen bleiben"
        );
        assert_eq!(
            log_stand(&f, "einsatz", &einsatz.to_string()).await,
            vorher_einsatz,
            "andere Tabellen bleiben"
        );
        assert_eq!(abgleichen(&f, &s, 500).await, 1);
        assert_eq!(
            rolle(&s, erika_hub).await,
            "mitarbeit",
            "erreicht={erreicht}"
        );
    }
}

#[tokio::test]
async fn zweites_melden_ohne_wechsel_liefert_nichts_nach() {
    let (f, s) = zwei_seiten().await;
    mitarbeit_beim_alten_spiegel(&f, &s).await;
    let mut fc = f.acquire().await.unwrap();
    crate::instanz::repo::save_faehigkeiten(&mut fc, 1, false, false, false, None, true)
        .await
        .unwrap();
    drop(fc);
    exec(
        &s,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1",
    )
    .await;
    while abgleichen(&f, &s, 500).await > 0 {}
    let log: i64 = eine(&f, "SELECT MAX(stand) FROM einsatz_aenderung").await;
    // Nächste Meldungen mit derselben Fähigkeit, von beiden Speicherstellen.
    let mut fc = f.acquire().await.unwrap();
    crate::instanz::repo::save_faehigkeiten(&mut fc, 1, false, false, false, None, true)
        .await
        .unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut fc, 1, true)
        .await
        .unwrap();
    drop(fc);
    assert_eq!(
        eine::<i64>(&f, "SELECT MAX(stand) FROM einsatz_aenderung").await,
        log,
        "kein neuer Logeintrag"
    );
    assert_eq!(abgleichen(&f, &s, 500).await, 0, "nichts nachgeliefert");
}

/// Ein Austausch, der seine Kopplung vor dem Wechsel geladen hat, darf die Nachlieferung nicht mit
/// der alten Fähigkeit verbrauchen: Die Lieferung liest sie frisch (LLH-1817, design.md D7).
#[tokio::test]
async fn nachlieferung_nutzt_das_frische_flag() {
    let (f, s) = zwei_seiten().await;
    let (_, erika, _, _) = mitarbeit_beim_alten_spiegel(&f, &s).await;
    let veraltet = crate::instanz::repo::load_kopplung(&f, 1).await.unwrap();
    assert!(!veraltet.gegenueber_rolle_mitarbeit);
    let mut fc = f.acquire().await.unwrap();
    crate::instanz::repo::save_faehigkeiten(&mut fc, 1, false, false, false, None, true)
        .await
        .unwrap();
    drop(fc);
    let staende: Vec<(String, i64)> =
        sqlx::query_as("SELECT fremde_kennung, stand FROM einsatz_spiegel")
            .fetch_all(&s)
            .await
            .unwrap();
    let staende: HashMap<String, i64> = staende.into_iter().collect();
    let eigen = crate::instanz::identitaet::load_or_create(&f)
        .await
        .unwrap();
    let mut fc = f.begin().await.unwrap();
    let orgs = crate::instanz::repo::list_orgs_aktiv(&mut fc, 1)
        .await
        .unwrap();
    let mut budget = Budget::neu(1024 * 1024);
    let lieferungen =
        super::abgleich::liefere_alle(&mut fc, &eigen, &veraltet, &orgs, &staende, &mut budget)
            .await
            .unwrap();
    fc.commit().await.unwrap();
    let rollen: Vec<String> = lieferungen
        .iter()
        .flat_map(|l| &l.zeilen)
        .filter(|z| z.art == "einsatz_mitgliedschaft")
        .filter_map(|z| {
            let d = z.daten.as_ref()?;
            (d["benutzer_id"].as_i64() == Some(erika)).then(|| d["einsatz_rolle"].to_string())
        })
        .collect();
    assert_eq!(rollen, ["\"mitarbeit\""]);
}

// ── Mitarbeit-Nachtrag an den Führer (LLH-2007) ─────────────────────────────────────────────

/// Der Spiegel `s` hält Erika als `mitarbeit` gegen einen älteren Führer `f` fest (über
/// `keep_mitarbeit`, wie nach einer Rückgabe), Max ist dort Führungspersonal. Beide Flags stehen
/// danach auf 0. Liefert (Einsatz am Spiegel, Erika am Spiegel, Max am Spiegel, Erika am Führer).
async fn mitarbeit_am_spiegel_festgehalten(f: &SqlitePool, s: &SqlitePool) -> (i64, i64, i64, i64) {
    let (erika_elw, erika_hub) = gemeinsames_konto(f, s, "Erika").await;
    let (max_elw, max_hub) = gemeinsames_konto(f, s, "Max").await;
    exec(
        f,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1",
    )
    .await;
    let einsatz: i64 = eine(
        f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    exec(
        f,
        &format!(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) VALUES \
             ({einsatz}, {erika_elw}, 'mitarbeit'), ({einsatz}, {max_elw}, 'fuehrungspersonal')"
        ),
    )
    .await;
    while abgleichen(f, s, 500).await > 0 {}
    // Der Führer ist (wieder) ein älterer Stand: er liefert Erika als Beobachter.
    exec(
        f,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 0",
    )
    .await;
    exec(
        f,
        &format!(
            "UPDATE einsatz_mitgliedschaft SET einsatz_rolle = 'beobachter' \
             WHERE benutzer_id = {erika_elw}"
        ),
    )
    .await;
    while abgleichen(f, s, 500).await > 0 {}
    assert_eq!(rolle(s, erika_hub).await, "mitarbeit", "festgehalten");
    let spiegel: i64 = eine(s, "SELECT einsatz_id FROM einsatz_spiegel").await;
    (spiegel, erika_hub, max_hub, erika_elw)
}

async fn nachtraege(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT schluessel FROM mitarbeit_nachtrag ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn wechsel_der_faehigkeit_merkt_festgehaltene_mitarbeit_vor() {
    let (f, s) = zwei_seiten().await;
    let (spiegel, erika, _, _) = mitarbeit_am_spiegel_festgehalten(&f, &s).await;
    let vorher: i64 = eine(&s, "SELECT COALESCE(MAX(stand), 0) FROM einsatz_aenderung").await;
    let mut sc = s.acquire().await.unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut sc, 1, true)
        .await
        .unwrap();
    drop(sc);
    assert_eq!(nachtraege(&s).await, vec![format!("[{spiegel},{erika}]")]);
    let grenze: Option<i64> = eine(
        &s,
        "SELECT mitarbeit_grenze_stand FROM instanz_kopplung WHERE id = 1",
    )
    .await;
    assert_eq!(grenze, Some(vorher));
}

#[tokio::test]
async fn zweites_melden_merkt_nichts_neu_vor() {
    let (f, s) = zwei_seiten().await;
    mitarbeit_am_spiegel_festgehalten(&f, &s).await;
    let mut sc = s.acquire().await.unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut sc, 1, true)
        .await
        .unwrap();
    let grenze: Option<i64> =
        sqlx::query_scalar("SELECT mitarbeit_grenze_stand FROM instanz_kopplung WHERE id = 1")
            .fetch_one(&mut *sc)
            .await
            .unwrap();
    sqlx::query("DELETE FROM mitarbeit_nachtrag")
        .execute(&mut *sc)
        .await
        .unwrap();
    // Etwas ändert sich im Log, dann meldet das Gegenüber die Fähigkeit erneut.
    sqlx::query("INSERT INTO einsatz_aenderung (einsatz_id, art, schluessel) VALUES (1, 'x', 'y')")
        .execute(&mut *sc)
        .await
        .unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut sc, 1, true)
        .await
        .unwrap();
    drop(sc);
    assert!(nachtraege(&s).await.is_empty(), "nichts neu vorgemerkt");
    let nachher: Option<i64> = eine(
        &s,
        "SELECT mitarbeit_grenze_stand FROM instanz_kopplung WHERE id = 1",
    )
    .await;
    assert_eq!(nachher, grenze, "Grenze unverändert");
}

#[tokio::test]
async fn nur_aktive_spiegel_dieser_kopplung() {
    let (f, s) = zwei_seiten().await;
    mitarbeit_am_spiegel_festgehalten(&f, &s).await;
    exec(
        &s,
        "UPDATE einsatz_spiegel SET beendet_at = '2026-11-22 00:00:00'",
    )
    .await;
    let mut sc = s.acquire().await.unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut sc, 1, true)
        .await
        .unwrap();
    drop(sc);
    assert!(nachtraege(&s).await.is_empty(), "beendeter Spiegel");

    let (f, s) = zwei_seiten().await;
    mitarbeit_am_spiegel_festgehalten(&f, &s).await;
    let mut sc = s.acquire().await.unwrap();
    super::nachtrag::queue_nachtraege(&mut sc, 1).await.unwrap();
    let vorgemerkt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mitarbeit_nachtrag")
        .fetch_one(&mut *sc)
        .await
        .unwrap();
    assert_eq!(vorgemerkt, 1);
    // Ohne die Fähigkeit des Gegenübers geht nichts hinaus.
    assert!(super::nachtrag::list_offene(&mut sc, 1)
        .await
        .unwrap()
        .is_empty());
    sqlx::query("UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1")
        .execute(&mut *sc)
        .await
        .unwrap();
    assert_eq!(
        super::nachtrag::list_offene(&mut sc, 1)
            .await
            .unwrap()
            .len(),
        1
    );
    // Widerrufene Org: nichts mehr.
    sqlx::query("UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-22 00:00:00'")
        .execute(&mut *sc)
        .await
        .unwrap();
    assert!(super::nachtrag::list_offene(&mut sc, 1)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn offener_nachtrag_nennt_kennung_und_gegenstueck() {
    let (f, s) = zwei_seiten().await;
    let (spiegel, erika, _, erika_elw) = mitarbeit_am_spiegel_festgehalten(&f, &s).await;
    let mut sc = s.acquire().await.unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut sc, 1, true)
        .await
        .unwrap();
    let offen = super::nachtrag::list_offene(&mut sc, 1).await.unwrap();
    drop(sc);
    let kennung: String = eine(&s, "SELECT fremde_kennung FROM einsatz_spiegel").await;
    let fuehrer_einsatz: i64 = eine(&f, "SELECT id FROM einsatz").await;
    assert_eq!(offen.len(), 1);
    assert_eq!(offen[0].kennung, kennung);
    assert_eq!(offen[0].schluessel, format!("[{spiegel},{erika}]"));
    assert_eq!(
        offen[0].gegen.as_deref(),
        Some(format!("[{fuehrer_einsatz},{erika_elw}]").as_str()),
        "Schlüssel beim Führer aus der Herkunft"
    );
}

#[tokio::test]
async fn quittung_loescht_nur_eigene() {
    let (f, s) = zwei_seiten().await;
    mitarbeit_am_spiegel_festgehalten(&f, &s).await;
    let mut sc = s.acquire().await.unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut sc, 1, true)
        .await
        .unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM mitarbeit_nachtrag")
        .fetch_one(&mut *sc)
        .await
        .unwrap();
    super::nachtrag::delete_quittiert(&mut sc, 2, &[id])
        .await
        .unwrap();
    drop(sc);
    assert_eq!(
        nachtraege(&s).await.len(),
        1,
        "fremde Kopplung löscht nicht"
    );
    let mut sc = s.acquire().await.unwrap();
    super::nachtrag::delete_quittiert(&mut sc, 1, &[id])
        .await
        .unwrap();
    drop(sc);
    assert!(nachtraege(&s).await.is_empty());
}

/// Führer O nach der Übernahme von Kopplung 1: eigener Einsatz `n/1` mit Erika als Beobachter,
/// deren Zeile von N stammt (`spiegel_herkunft`: `[7,9]` bei N). O kennt die Fähigkeit von N, die
/// Grenze ist gesetzt. Liefert (Einsatz, Erika).
async fn fuehrer_nach_rueckgabe(o: &SqlitePool) -> (i64, i64) {
    let erika = konto(o, "Erika").await;
    let einsatz: i64 = eine(
        o,
        "INSERT INTO einsatz (org_id, bezeichnung, kennung) VALUES (1, 'Lage', 'n/1') RETURNING id",
    )
    .await;
    exec(
        o,
        &format!(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) VALUES \
             ({einsatz}, {erika}, 'beobachter')"
        ),
    )
    .await;
    exec(
        o,
        &format!(
            "INSERT INTO spiegel_herkunft (einsatz_id, art, fremder_schluessel, lokaler_schluessel) \
             VALUES ({einsatz}, 'einsatz_mitgliedschaft', '[7,9]', '[{einsatz},{erika}]')"
        ),
    )
    .await;
    exec(
        o,
        &format!(
            "INSERT INTO einsatz_fuehrung (kennung, einsatz_id, org_id, bezeichnung, status, \
             epoche_zaehler, epoche_instanz, fuehrer_kennung, fuehrer_name, art, stand, \
             geaendert_at, herkunft_kopplung_id, uebernommen_stand) VALUES ('n/1', {einsatz}, 1, \
             'Lage', 'aktiv', 2, 'gegen', 'eigen', 'Hub', 'uebergabe', 1, '2026-11-22 00:00:00', \
             1, 0)"
        ),
    )
    .await;
    exec(
        o,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1",
    )
    .await;
    let mut c = o.acquire().await.unwrap();
    super::nachtrag::save_grenze(&mut c, 1).await.unwrap();
    (einsatz, erika)
}

fn nachtrag_n(id: i64, gegen: Option<String>) -> super::nachtrag::MitarbeitNachtrag {
    super::nachtrag::MitarbeitNachtrag {
        id,
        kennung: "n/1".into(),
        schluessel: "[7,9]".into(),
        gegen,
    }
}

async fn annehmen(
    o: &SqlitePool,
    kopplung: i64,
    n: &[super::nachtrag::MitarbeitNachtrag],
) -> super::nachtrag::Annahme {
    let mut c = o.begin().await.unwrap();
    let a = super::nachtrag::accept(&mut c, kopplung, n).await.unwrap();
    c.commit().await.unwrap();
    a
}

async fn stand_der_zeile(o: &SqlitePool, einsatz: i64, erika: i64) -> i64 {
    eine(
        o,
        &format!(
            "SELECT COALESCE(MAX(stand), 0) FROM einsatz_aenderung WHERE art = \
             'einsatz_mitgliedschaft' AND schluessel = '[{einsatz},{erika}]'"
        ),
    )
    .await
}

async fn grenze(o: &SqlitePool) -> i64 {
    eine(
        o,
        "SELECT mitarbeit_grenze_stand FROM instanz_kopplung WHERE id = 1",
    )
    .await
}

#[tokio::test]
async fn nachtrag_hebt_beobachter_an() {
    let (o, _) = zwei_seiten().await;
    let (einsatz, erika) = fuehrer_nach_rueckgabe(&o).await;
    let a = annehmen(&o, 1, &[nachtrag_n(1, None)]).await;
    assert_eq!(rolle(&o, erika).await, "mitarbeit");
    assert_eq!(a.quittungen, vec![1]);
    assert_eq!(a.einsaetze, vec![einsatz]);
    assert!(stand_der_zeile(&o, einsatz, erika).await > grenze(&o).await);
}

#[tokio::test]
async fn nachtrag_ueber_das_gegenstueck_hebt_an() {
    let (o, _) = zwei_seiten().await;
    let (einsatz, erika) = fuehrer_nach_rueckgabe(&o).await;
    exec(&o, "DELETE FROM spiegel_herkunft").await;
    let mut n = nachtrag_n(1, Some(format!("[{einsatz},{erika}]")));
    n.schluessel = "[99,99]".into();
    annehmen(&o, 1, &[n]).await;
    assert_eq!(rolle(&o, erika).await, "mitarbeit");
}

#[tokio::test]
async fn vor_der_grenze_bearbeitet_hebt_trotzdem_an() {
    let (o, _) = zwei_seiten().await;
    let (_, erika) = fuehrer_nach_rueckgabe(&o).await;
    // Bearbeitet an der noch alten Instanz, also vor der Grenze.
    exec(
        &o,
        "UPDATE instanz_kopplung SET mitarbeit_grenze_stand = NULL",
    )
    .await;
    exec(
        &o,
        &format!(
            "UPDATE einsatz_mitgliedschaft SET fuehrungsstelle = 'Abschnitt Nord' WHERE benutzer_id = {erika}"
        ),
    )
    .await;
    let mut c = o.acquire().await.unwrap();
    super::nachtrag::save_grenze(&mut c, 1).await.unwrap();
    drop(c);
    annehmen(&o, 1, &[nachtrag_n(1, None)]).await;
    assert_eq!(rolle(&o, erika).await, "mitarbeit");
}

#[tokio::test]
async fn abgelehnter_nachtrag_legt_die_zeile_neu_ins_log() {
    let (o, _) = zwei_seiten().await;
    let (einsatz, erika) = fuehrer_nach_rueckgabe(&o).await;
    exec(
        &o,
        &format!(
            "UPDATE einsatz_mitgliedschaft SET fuehrungsstelle = 'Abschnitt Nord' WHERE benutzer_id = {erika}"
        ),
    )
    .await;
    let nach_bearbeitung = stand_der_zeile(&o, einsatz, erika).await;
    let a = annehmen(&o, 1, &[nachtrag_n(1, None)]).await;
    assert_eq!(rolle(&o, erika).await, "beobachter");
    assert_eq!(a.quittungen, vec![1]);
    assert!(a.einsaetze.is_empty());
    assert!(
        stand_der_zeile(&o, einsatz, erika).await > nach_bearbeitung,
        "neu im Log, damit der Spiegel dem Führer folgt"
    );
}

#[tokio::test]
async fn wiederholter_nachtrag_aendert_nichts() {
    let (o, _) = zwei_seiten().await;
    let (_, erika) = fuehrer_nach_rueckgabe(&o).await;
    annehmen(&o, 1, &[nachtrag_n(1, None)]).await;
    let log: i64 = eine(&o, "SELECT MAX(stand) FROM einsatz_aenderung").await;
    let a = annehmen(&o, 1, &[nachtrag_n(1, None)]).await;
    assert_eq!(a.quittungen, vec![1]);
    assert_eq!(rolle(&o, erika).await, "mitarbeit");
    assert_eq!(
        eine::<i64>(&o, "SELECT MAX(stand) FROM einsatz_aenderung").await,
        log,
        "kein neuer Logeintrag"
    );
}

#[tokio::test]
async fn ohne_faehigkeit_des_spiegels_wartet_der_nachtrag() {
    let (o, _) = zwei_seiten().await;
    let (_, erika) = fuehrer_nach_rueckgabe(&o).await;
    exec(
        &o,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 0",
    )
    .await;
    let a = annehmen(&o, 1, &[nachtrag_n(1, None)]).await;
    assert!(a.quittungen.is_empty(), "nicht quittiert");
    assert_eq!(rolle(&o, erika).await, "beobachter");
}

/// Review-Befund 2: Auch hier folgt der Spiegel dem Führer (neu ins Log), statt dauerhaft uneinig
/// zu bleiben.
#[tokio::test]
async fn fuehrung_von_anderer_kopplung_hebt_nicht_an() {
    let (o, _) = zwei_seiten().await;
    let (einsatz, erika) = fuehrer_nach_rueckgabe(&o).await;
    exec(
        &o,
        "INSERT INTO instanz_kopplung (id, gegenueber_kennung, gegenueber_schluessel, \
         gegenueber_name, richtung, zustand, gegenueber_rolle_mitarbeit) \
         VALUES (2, 'dritte', 'y', 'Dritte', 'wird_gemeldet', 'aktiv', 1)",
    )
    .await;
    let vorher = stand_der_zeile(&o, einsatz, erika).await;
    let a = annehmen(&o, 2, &[nachtrag_n(1, None)]).await;
    assert_eq!(a.quittungen, vec![1]);
    assert_eq!(rolle(&o, erika).await, "beobachter");
    assert!(
        stand_der_zeile(&o, einsatz, erika).await > vorher,
        "neu im Log, damit der Spiegel dem Führer folgt"
    );
}

#[tokio::test]
async fn gegen_aus_einem_anderen_einsatz_hebt_nicht_an() {
    let (o, _) = zwei_seiten().await;
    let (_, erika) = fuehrer_nach_rueckgabe(&o).await;
    let max = konto(&o, "Max").await;
    let anderer: i64 = eine(
        &o,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Anderer') RETURNING id",
    )
    .await;
    exec(
        &o,
        &format!(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) VALUES \
             ({anderer}, {max}, 'beobachter')"
        ),
    )
    .await;
    exec(&o, "DELETE FROM spiegel_herkunft").await;
    let mut n = nachtrag_n(1, Some(format!("[{anderer},{max}]")));
    n.schluessel = "[99,99]".into();
    let a = annehmen(&o, 1, &[n]).await;
    assert_eq!(a.quittungen, vec![1]);
    assert_eq!(rolle(&o, max).await, "beobachter");
    assert_eq!(rolle(&o, erika).await, "beobachter");
}

#[tokio::test]
async fn spiegel_nimmt_keinen_nachtrag_an() {
    let (_, s) = zwei_seiten().await;
    let erika = konto(&s, "Erika").await;
    let einsatz: i64 = eine(
        &s,
        "INSERT INTO einsatz (org_id, bezeichnung, kennung) VALUES (1, 'Lage', 'n/1') RETURNING id",
    )
    .await;
    exec(
        &s,
        &format!(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) VALUES \
             ({einsatz}, {erika}, 'beobachter')"
        ),
    )
    .await;
    exec(
        &s,
        &format!(
            "INSERT INTO spiegel_uebernahme (id) VALUES (1); \
             INSERT INTO einsatz_spiegel (einsatz_id, kopplung_org_id, fremde_kennung) \
             VALUES ({einsatz}, 1, 'n/1'); DELETE FROM spiegel_uebernahme"
        ),
    )
    .await;
    exec(
        &s,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 1",
    )
    .await;
    let mut n = nachtrag_n(1, Some(format!("[{einsatz},{erika}]")));
    n.schluessel = "[99,99]".into();
    let a = annehmen(&s, 1, &[n]).await;
    assert_eq!(a.quittungen, vec![1]);
    assert_eq!(rolle(&s, erika).await, "beobachter");
}

/// Der Spiegel als erreichte Seite: seine offenen Nachträge gehen in der Antwort hinaus, die
/// Quittungen der Anfrage löschen sie (LLH-2007, Design D3).
#[tokio::test]
async fn erreichter_spiegel_schickt_nachtraege_und_loescht_quittierte() {
    let (f, s) = zwei_seiten().await;
    mitarbeit_am_spiegel_festgehalten(&f, &s).await;
    let mut sc = s.acquire().await.unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut sc, 1, true)
        .await
        .unwrap();
    drop(sc);
    let live = crate::live::LiveHub::new();
    let eigen = crate::instanz::identitaet::load_or_create(&s)
        .await
        .unwrap();
    let kopplung = crate::instanz::repo::load_kopplung(&s, 1).await.unwrap();
    let antwort = super::abgleich::handle_abgleich(
        &s,
        &live,
        None,
        &eigen,
        &kopplung,
        &super::paket::SpiegelPaket::default(),
    )
    .await
    .unwrap();
    assert_eq!(antwort.mitarbeit_nachtraege.len(), 1);
    let quittiert = super::paket::SpiegelPaket {
        mitarbeit_quittungen: vec![antwort.mitarbeit_nachtraege[0].id],
        ..Default::default()
    };
    let antwort = super::abgleich::handle_abgleich(&s, &live, None, &eigen, &kopplung, &quittiert)
        .await
        .unwrap();
    assert!(antwort.mitarbeit_nachtraege.is_empty());
    assert!(nachtraege(&s).await.is_empty());
}

/// Review-Befund 1: Die Grenze gilt ab dem Aufrüsten, nicht erst ab dem ersten Melden danach.
/// Eine bewusste Wahl dazwischen überstimmt kein Nachtrag.
#[tokio::test]
async fn bearbeitung_nach_dem_aufruesten_vor_dem_melden_bleibt() {
    let (o, _) = zwei_seiten().await;
    let (_, erika) = fuehrer_nach_rueckgabe(&o).await;
    exec(
        &o,
        &format!(
            "UPDATE einsatz_mitgliedschaft SET fuehrungsstelle = 'Abschnitt Nord' WHERE benutzer_id = {erika}"
        ),
    )
    .await;
    // Erst jetzt meldet sich der Spiegel mit der Fähigkeit.
    exec(
        &o,
        "UPDATE instanz_kopplung SET gegenueber_rolle_mitarbeit = 0",
    )
    .await;
    let mut c = o.acquire().await.unwrap();
    crate::instanz::repo::save_rolle_mitarbeit(&mut c, 1, true)
        .await
        .unwrap();
    drop(c);
    annehmen(&o, 1, &[nachtrag_n(1, None)]).await;
    assert_eq!(
        rolle(&o, erika).await,
        "beobachter",
        "die bewusste Wahl bleibt"
    );
}

// ---------- Funktion nur in der Führung (LLH-2064, Entwurf D4) ----------

fn mitgliedschaft_werte(
    rolle: Option<&str>,
    funktion: Option<&str>,
    stelle: Option<&str>,
) -> Vec<(String, serde_json::Value)> {
    let mut werte = vec![
        ("einsatz_id".to_string(), serde_json::json!(7)),
        ("benutzer_id".to_string(), serde_json::json!(9)),
        ("fuehrungsfunktion".to_string(), serde_json::json!(funktion)),
        ("fuehrungsstelle".to_string(), serde_json::json!(stelle)),
    ];
    if let Some(r) = rolle {
        werte.push(("einsatz_rolle".to_string(), serde_json::json!(r)));
    }
    werte
}

fn wert<'a>(werte: &'a [(String, serde_json::Value)], name: &str) -> &'a serde_json::Value {
    &werte.iter().find(|(s, _)| s == name).unwrap().1
}

#[test]
fn normalize_funktion_macht_beobachter_s4_zu_freitext() {
    let mut werte = mitgliedschaft_werte(Some("beobachter"), Some("s4"), None);
    uebernehmen::normalize_funktion(&mut werte, false);
    assert!(wert(&werte, "fuehrungsfunktion").is_null());
    assert_eq!(wert(&werte, "fuehrungsstelle"), "S4");
}

#[test]
fn normalize_funktion_macht_mitarbeit_fachberater_zu_freitext() {
    let mut werte = mitgliedschaft_werte(Some("mitarbeit"), Some("fachberater"), Some("THW"));
    uebernehmen::normalize_funktion(&mut werte, false);
    assert!(wert(&werte, "fuehrungsfunktion").is_null());
    assert_eq!(wert(&werte, "fuehrungsstelle"), "Fachberater: THW");
}

#[test]
fn normalize_funktion_laesst_fuehrung_stehen() {
    let mut werte = mitgliedschaft_werte(Some("fuehrungspersonal"), Some("s4"), None);
    let vorher = werte.clone();
    uebernehmen::normalize_funktion(&mut werte, false);
    assert_eq!(werte, vorher);
}

#[test]
fn normalize_funktion_geschwaerzt_nur_code_weg() {
    let mut werte = mitgliedschaft_werte(Some("beobachter"), Some("s4"), None);
    uebernehmen::normalize_funktion(&mut werte, true);
    assert!(wert(&werte, "fuehrungsfunktion").is_null());
    assert!(wert(&werte, "fuehrungsstelle").is_null());
}

#[test]
fn normalize_funktion_ohne_rollenspalte_unveraendert() {
    let mut werte = mitgliedschaft_werte(None, Some("s4"), None);
    let vorher = werte.clone();
    uebernehmen::normalize_funktion(&mut werte, false);
    assert_eq!(werte, vorher);
}

/// Ein älteres Gegenüber kennt die Regel nicht und liefert Beobachter + `s4`: der Spiegel
/// übernimmt die Zeile ohne Hinweis, die Funktion als Bezeichnung (LLH-2064, Entwurf D4/D7).
#[tokio::test]
async fn beobachter_mit_funktion_vom_alten_gegenueber_kommt_als_bezeichnung_an() {
    let (f, s) = zwei_seiten().await;
    let (erika_elw, erika_hub) = gemeinsames_konto(&f, &s, "Erika").await;
    let einsatz: i64 = eine(
        &f,
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .await;
    // Das Gegenüber hat den CHECK aus 0363 nicht; hier nur auf dieser einen Verbindung aus.
    let mut c = f.acquire().await.unwrap();
    sqlx::query("PRAGMA ignore_check_constraints = ON")
        .execute(&mut *c)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle, \
         fuehrungsfunktion) VALUES (?, ?, 'beobachter', 's4')",
    )
    .bind(einsatz)
    .bind(erika_elw)
    .execute(&mut *c)
    .await
    .unwrap();
    sqlx::query("PRAGMA ignore_check_constraints = OFF")
        .execute(&mut *c)
        .await
        .unwrap();
    drop(c);

    while abgleichen(&f, &s, 500).await > 0 {}

    let (rolle, code, stelle): (String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT einsatz_rolle, fuehrungsfunktion, fuehrungsstelle FROM einsatz_mitgliedschaft \
         WHERE benutzer_id = ?",
    )
    .bind(erika_hub)
    .fetch_one(&s)
    .await
    .unwrap();
    assert_eq!(rolle, "beobachter");
    assert_eq!(code, None);
    assert_eq!(stelle.as_deref(), Some("S4"));
}

/// Ist der Einsatz hier geschwärzt, fällt nur der Code weg; Text kommt nicht in die geschwärzte
/// Spalte (LLH-2064, Entwurf D1/D4).
#[tokio::test]
async fn strip_funktion_liest_die_schwaerzung_am_lokalen_einsatz() {
    let pool = crate::db::test_pool().await;
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&mut *conn)
        .await
        .unwrap();
    let t = super::schema::schema(&mut conn)
        .await
        .unwrap()
        .tabelle("einsatz_mitgliedschaft")
        .unwrap()
        .clone();
    for (geschwaerzt, erwartet) in [
        (false, serde_json::json!("S4")),
        (true, serde_json::Value::Null),
    ] {
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, geschwaerzt_at) \
             VALUES (1, 'Lage', CASE WHEN ? THEN '2026-11-01 00:00:00' END) RETURNING id",
        )
        .bind(geschwaerzt)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
        let mut werte = mitgliedschaft_werte(Some("beobachter"), Some("s4"), None);
        uebernehmen::strip_funktion(&mut conn, &t, einsatz, &mut werte)
            .await
            .unwrap();
        assert!(wert(&werte, "fuehrungsfunktion").is_null());
        assert_eq!(
            wert(&werte, "fuehrungsstelle"),
            &erwartet,
            "geschwärzt={geschwaerzt}"
        );
    }
}
