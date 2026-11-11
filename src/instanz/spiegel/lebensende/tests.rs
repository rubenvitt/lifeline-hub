use super::*;
use crate::einsatz::repo::{abschliessen, anlegen, NeuerEinsatzDaten};
use sqlx::SqlitePool;

async fn leitung(pool: &SqlitePool) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'leit', 'leit-' || abs(random()), 'h') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn einsatz(pool: &SqlitePool, leit: i64) -> (i64, String) {
    let e = anlegen(
        pool,
        NeuerEinsatzDaten {
            bezeichnung: "Lage",
            stichwort: None,
            einsatzart: None,
            begonnen_at: None,
            ort: Default::default(),
            vorlage_id: None,
        },
        leit,
    )
    .await
    .unwrap();
    abschliessen(pool, e.id, leit).await.unwrap();
    (e.id, e.einsatznummer_intern.unwrap())
}

/// Kopplung 1 zum Gegenüber `gegen` in Richtung `richtung`, Org-Zuordnung 1.
async fn kopplung(pool: &SqlitePool, richtung: &str) -> KopplungZeile {
    let adresse = if richtung == "meldet_sich" {
        "'https://hub.example.org'"
    } else {
        "NULL"
    };
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO instanz_kopplung (id, gegenueber_kennung, gegenueber_schluessel, \
         gegenueber_name, richtung, zustand, gegenueber_adresse) \
         VALUES (1, 'gegen', 'x', 'Gegenstelle', '{richtung}', 'aktiv', {adresse})"
    )))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (id, kopplung_id, org_id, fremde_org_kennung, \
         fremde_org_name) VALUES (1, 1, 1, 'gegen/1', 'Org')",
    )
    .execute(pool)
    .await
    .unwrap();
    crate::instanz::repo::load_kopplung(pool, 1).await.unwrap()
}

async fn unter_merker(pool: &SqlitePool, sql: &str, binds: &[&str]) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()));
    for b in binds {
        q = q.bind(*b);
    }
    q.execute(&mut *tx).await.unwrap();
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

/// Ein abgeschlossener Spiegel aus Kopplung 1 mit Kennung `kennung` und Stand `stand`.
async fn spiegel(pool: &SqlitePool, leit: i64, kennung: &str, stand: i64) -> i64 {
    let (id, _) = einsatz(pool, leit).await;
    crate::einsatz::spiegel_filter::als_spiegel_markieren(pool, id).await;
    unter_merker(
        pool,
        "UPDATE einsatz_spiegel SET kopplung_org_id = 1, fremde_kennung = ?, stand = ? \
         WHERE einsatz_id = ?",
        &[kennung, &stand.to_string(), &id.to_string()],
    )
    .await;
    unter_merker(
        pool,
        "UPDATE einsatz SET kennung = ? WHERE id = ?",
        &[kennung, &id.to_string()],
    )
    .await;
    id
}

fn verwahrt(kennung: &str, stand: i64, kategorien: Vec<KategorieFrist>) -> Lebensende {
    Lebensende {
        kennung: kennung.into(),
        art: LEBENSENDE_VERWAHRT.into(),
        stand,
        kategorien,
    }
}

fn frist(kategorie: &str) -> KategorieFrist {
    KategorieFrist {
        kategorie: kategorie.into(),
        frist_bis: Some("2027-01-01 00:00:00".into()),
        rechtsgrundlage: "RDG".into(),
        vorgemerkt_at: None,
        geschwaerzt_at: None,
        frist_gesetzt_at: Some("2026-11-01 00:00:00".into()),
    }
}

const JETZT: &str = "2026-11-11 12:00:00";

async fn annehmen(
    pool: &SqlitePool,
    k: &KopplungZeile,
    l: &Lebensende,
) -> Option<(LebensendeQuittung, Option<i64>)> {
    let mut tx = pool.begin().await.unwrap();
    let r = verwahrung_annehmen(&mut tx, k, l, JETZT).await.unwrap();
    tx.commit().await.unwrap();
    r
}

#[tokio::test]
async fn verwahrung_wartet_auf_spiegel_stand_und_anhaenge() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let k = kopplung(&pool, "wird_gemeldet").await;
    let id = spiegel(&pool, leit, "gegen/5", 3).await;

    assert!(
        annehmen(&pool, &k, &verwahrt("fremd/5", 3, vec![]))
            .await
            .is_none(),
        "fremdes Präfix"
    );
    let (q, _) = annehmen(&pool, &k, &verwahrt("gegen/9", 3, vec![]))
        .await
        .unwrap();
    assert_eq!(
        (q.ergebnis.as_str(), q.grund.as_deref()),
        (VERWAHRUNG_WARTET, Some("Noch nicht gespiegelt"))
    );
    let (q, _) = annehmen(&pool, &k, &verwahrt("gegen/5", 4, vec![]))
        .await
        .unwrap();
    assert_eq!(q.grund.as_deref(), Some("Stand 3 von 4"));

    unter_merker(
        &pool,
        "INSERT INTO spiegel_anhang (einsatz_id, art, lokaler_schluessel, fremder_schluessel, \
         sha256, groesse) VALUES (?, 'anhang', '1', '1', 'ab', 3), (?, 'anhang', '2', '2', 'cd', 3)",
        &[&id.to_string(), &id.to_string()],
    )
    .await;
    let (q, umgewandelt) = annehmen(&pool, &k, &verwahrt("gegen/5", 3, vec![]))
        .await
        .unwrap();
    assert_eq!(q.grund.as_deref(), Some("2 Anhänge fehlen"));
    assert_eq!(umgewandelt, None);
    let angefordert: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM spiegel_anhang WHERE einsatz_id = ? AND angefordert_at = ?",
    )
    .bind(id)
    .bind(JETZT)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(angefordert, 2, "fehlende Anhänge sind angefordert");
    let spiegel_ist: bool = sqlx::query_scalar("SELECT spiegel FROM einsatz WHERE id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(spiegel_ist, "bleibt Spiegel, solange etwas fehlt");
}

#[tokio::test]
async fn verwahrung_macht_den_spiegel_zum_eigenen_einsatz() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let k = kopplung(&pool, "wird_gemeldet").await;
    let (eigen, eigene_nummer) = einsatz(&pool, leit).await;
    let id = spiegel(&pool, leit, "gegen/5", 3).await;
    // Der ELW hat dieselbe Nummer vergeben wie der Hub.
    unter_merker(
        &pool,
        "UPDATE einsatz SET einsatznummer_intern = ?, \
         nummer_jahr = (SELECT nummer_jahr FROM einsatz WHERE id = ?), \
         nummer_lfd = (SELECT nummer_lfd FROM einsatz WHERE id = ?) WHERE id = ?",
        &[
            &eigene_nummer,
            &eigen.to_string(),
            &eigen.to_string(),
            &id.to_string(),
        ],
    )
    .await;
    unter_merker(
        &pool,
        "INSERT INTO spiegel_herkunft (einsatz_id, art, fremder_schluessel, lokaler_schluessel) \
         VALUES (?, 'etb_eintrag', '1', '1')",
        &[&id.to_string()],
    )
    .await;

    let l = verwahrt(
        "gegen/5",
        3,
        vec![frist("anhaenge"), frist("unbekannt"), frist("behandlung")],
    );
    let (q, umgewandelt) = annehmen(&pool, &k, &l).await.unwrap();
    assert_eq!(q.ergebnis, VERWAHRUNG_ANGENOMMEN);
    assert_eq!(umgewandelt, Some(id));

    let (spiegel_ist, kennung, nummer): (bool, Option<String>, String) =
        sqlx::query_as("SELECT spiegel, kennung, einsatznummer_intern FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!spiegel_ist);
    assert_eq!(kennung.as_deref(), Some("gegen/5"), "Kennung bleibt");
    assert_ne!(nummer, eigene_nummer, "belegte Nummer wird ersetzt");
    for (sql, soll) in [
        (
            "SELECT COUNT(*) FROM einsatz_spiegel WHERE einsatz_id = ?",
            0,
        ),
        (
            "SELECT COUNT(*) FROM spiegel_herkunft WHERE einsatz_id = ?",
            0,
        ),
        (
            "SELECT COUNT(*) FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = ?",
            2,
        ),
        // Der Setzzeitpunkt kommt mit: die Karenz beginnt am Hub nicht neu.
        (
            "SELECT COUNT(*) FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = ? \
             AND frist_gesetzt_at = '2026-11-01 00:00:00'",
            2,
        ),
    ] {
        let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, soll, "{sql}");
    }
    let etb: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        etb,
        format!(
            "Zur Verwahrung übernommen von Gegenstelle (Einsatznummer {nummer}, dort {eigene_nummer})"
        )
    );
    // Ein eigener Einsatz ist wieder beschreibbar: das Schutz-Trigger greift nicht mehr.
    sqlx::query("UPDATE einsatz SET bezeichnung = 'Verwahrt' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

    let (q, umgewandelt) = annehmen(&pool, &k, &l).await.unwrap();
    assert_eq!(
        (q.ergebnis.as_str(), umgewandelt),
        (VERWAHRUNG_ANGENOMMEN, None),
        "zweite Meldung nach verlorener Quittung"
    );
}

#[tokio::test]
async fn gemeldet_wird_nur_was_hier_geloescht_ist() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let (weg, _) = einsatz(&pool, leit).await;
    let (da, _) = einsatz(&pool, leit).await;
    let mut tx = pool.begin().await.unwrap();
    abraeumen::vormerken(&mut tx, weg, AbraeumArt::Verwahrt, Some("Hub"))
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(abraeumen::ausfuehren(&pool, weg).await.unwrap());

    let stand = |k: String| EinsatzStand {
        kennung: k,
        stand: 1,
    };
    let staende = vec![
        stand(format!("ich/{weg}")),
        stand(format!("ich/{weg}")),
        stand(format!("ich/{da}")),
        stand("ich/999".into()),
        stand(format!("andere/{weg}")),
        stand("ich/kaputt".into()),
    ];
    let mut conn = pool.acquire().await.unwrap();
    let ende = geloeschte(&mut conn, "ich", &staende).await.unwrap();
    assert_eq!(
        ende.iter().map(|l| l.kennung.clone()).collect::<Vec<_>>(),
        vec![format!("ich/{weg}")],
        "nur im Löschprotokoll, einmal, mit eigenem Präfix"
    );
    assert_eq!(ende[0].art, LEBENSENDE_GELOESCHT);
}

#[tokio::test]
async fn geloescht_merkt_nur_spiegel_dieser_kopplung_vor() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let k = kopplung(&pool, "meldet_sich").await;
    let id = spiegel(&pool, leit, "gegen/7", 2).await;
    let fremd = spiegel(&pool, leit, "gegen/8", 2).await;
    unter_merker(
        &pool,
        "UPDATE einsatz_spiegel SET kopplung_org_id = NULL WHERE einsatz_id = ?",
        &[&fremd.to_string()],
    )
    .await;
    let ende = |k: &str| Lebensende {
        kennung: k.into(),
        art: LEBENSENDE_GELOESCHT.into(),
        stand: 0,
        kategorien: vec![],
    };

    let mut tx = pool.begin().await.unwrap();
    let ids = geloescht_uebernehmen(
        &mut tx,
        &k,
        &[
            ende("gegen/7"),
            ende("gegen/8"),
            ende("gegen/9"),
            verwahrt("gegen/7", 2, vec![]),
        ],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(ids, vec![id]);
    let art: String = sqlx::query_scalar("SELECT art FROM einsatz_abraeumen WHERE einsatz_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(art, "spiegel");
}

async fn setze_bis(pool: &SqlitePool, id: i64, bis: &str) {
    sqlx::query("UPDATE einsatz SET nachbereitung_bis = ? WHERE id = ?")
        .bind(bis)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn faellig_ist_nur_ein_abgelaufener_eigener_einsatz_ohne_hindernis() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    kopplung(&pool, "meldet_sich").await;
    let orgs = {
        let mut conn = pool.acquire().await.unwrap();
        crate::instanz::repo::list_orgs_aktiv(&mut conn, 1)
            .await
            .unwrap()
    };
    let (faellig, _) = einsatz(&pool, leit).await;
    setze_bis(&pool, faellig, "2026-11-01 00:00:00").await;
    sqlx::query(
        "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
         rechtsgrundlage, frist_gesetzt_at) \
         VALUES (?, 'anhaenge', '2027-01-01 00:00:00', 'RDG', '2026-11-01 00:00:00')",
    )
    .bind(faellig)
    .execute(&pool)
    .await
    .unwrap();
    let (laeuft, _) = einsatz(&pool, leit).await;
    setze_bis(&pool, laeuft, "2026-12-01 00:00:00").await;
    let (vorgemerkt, _) = einsatz(&pool, leit).await;
    setze_bis(&pool, vorgemerkt, "2026-11-01 00:00:00").await;
    sqlx::query("UPDATE einsatz SET geloescht_at = '2026-11-02 00:00:00' WHERE id = ?")
        .bind(vorgemerkt)
        .execute(&pool)
        .await
        .unwrap();
    let (ersuchen, _) = einsatz(&pool, leit).await;
    setze_bis(&pool, ersuchen, "2026-11-01 00:00:00").await;
    sqlx::query(
        "INSERT INTO schwaerzung_antrag (einsatz_id, ziel_art, aktenzeichen, beantragt_von, \
         beantragt_at, faellig_at) VALUES (?, 'einsatz', 'AZ 1', ?, ?, ?)",
    )
    .bind(ersuchen)
    .bind(leit)
    .bind(JETZT)
    .bind(JETZT)
    .execute(&pool)
    .await
    .unwrap();
    let spiegel_id = spiegel(&pool, leit, "gegen/3", 1).await;
    unter_merker(
        &pool,
        "UPDATE einsatz SET nachbereitung_bis = '2026-11-01 00:00:00' WHERE id = ?",
        &[&spiegel_id.to_string()],
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    let ende = faellige_verwahrungen(&mut tx, "ich", &orgs, JETZT)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(ende.len(), 1, "{ende:?}");
    assert_eq!(ende[0].kennung, format!("ich/{faellig}"), "Kennung gesetzt");
    assert_eq!(ende[0].art, LEBENSENDE_VERWAHRT);
    assert!(ende[0].stand > 0);
    assert_eq!(ende[0].kategorien, vec![frist("anhaenge")]);
    let kennung: Option<String> = sqlx::query_scalar("SELECT kennung FROM einsatz WHERE id = ?")
        .bind(faellig)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(kennung, Some(format!("ich/{faellig}")));

    let mut tx = pool.begin().await.unwrap();
    abraeumen::vormerken(&mut tx, faellig, AbraeumArt::Verwahrt, Some("Hub"))
        .await
        .unwrap();
    let ende = faellige_verwahrungen(&mut tx, "ich", &orgs, JETZT)
        .await
        .unwrap();
    assert!(ende.is_empty(), "beim Abräumen nicht mehr fällig");
}

#[tokio::test]
async fn quittungen_merken_angenommen_vor_und_halten_den_grund_fest() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let k = kopplung(&pool, "meldet_sich").await;
    let (a, _) = einsatz(&pool, leit).await;
    let (b, _) = einsatz(&pool, leit).await;
    let (c, _) = einsatz(&pool, leit).await;
    let (geaendert, _) = einsatz(&pool, leit).await;
    let (verlaengert, _) = einsatz(&pool, leit).await;
    for id in [a, b, c, geaendert, verlaengert] {
        sqlx::query("UPDATE einsatz SET kennung = 'ich/' || id WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        setze_bis(&pool, id, "2026-11-01 00:00:00").await;
    }
    // Nach dem Senden verlängert: nicht mehr fällig.
    setze_bis(&pool, verlaengert, "2026-12-01 00:00:00").await;
    let gesendet = vec![
        verwahrt(&format!("ich/{a}"), stand_von(&pool, a).await, vec![]),
        verwahrt(&format!("ich/{b}"), stand_von(&pool, b).await, vec![]),
        // Nach dem Senden geändert: der gesendete Stand ist älter.
        verwahrt(
            &format!("ich/{geaendert}"),
            stand_von(&pool, geaendert).await - 1,
            vec![],
        ),
        verwahrt(
            &format!("ich/{verlaengert}"),
            stand_von(&pool, verlaengert).await,
            vec![],
        ),
    ];
    let quittung = |id: i64, ergebnis: &str, grund: Option<&str>| LebensendeQuittung {
        kennung: format!("ich/{id}"),
        ergebnis: ergebnis.into(),
        grund: grund.map(Into::into),
    };

    let mut tx = pool.begin().await.unwrap();
    let ids = quittungen_uebernehmen(
        &mut tx,
        &k,
        "ich",
        &gesendet,
        &[
            quittung(a, VERWAHRUNG_ANGENOMMEN, None),
            quittung(b, VERWAHRUNG_WARTET, Some("1 Anhang fehlt")),
            quittung(c, VERWAHRUNG_ANGENOMMEN, None),
            quittung(geaendert, VERWAHRUNG_ANGENOMMEN, None),
            quittung(verlaengert, VERWAHRUNG_ANGENOMMEN, None),
        ],
        JETZT,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(ids, vec![a], "nur gesendete Einsätze");
    let (gegenstelle, grund): (String, Option<String>) =
        sqlx::query_as("SELECT gegenstelle, grund FROM einsatz_verwahrung WHERE einsatz_id = ?")
            .bind(b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (gegenstelle.as_str(), grund.as_deref()),
        ("Gegenstelle", Some("1 Anhang fehlt"))
    );
    for id in [geaendert, verlaengert] {
        let grund: Option<String> =
            sqlx::query_scalar("SELECT grund FROM einsatz_verwahrung WHERE einsatz_id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(grund.as_deref(), Some("Nach der Übergabe geändert"));
    }
    let merker: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_abraeumen")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(merker, 1);
}

async fn stand_von(pool: &SqlitePool, id: i64) -> i64 {
    let stand: Option<i64> =
        sqlx::query_scalar("SELECT MAX(stand) FROM einsatz_aenderung WHERE einsatz_id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    stand.unwrap_or(0)
}

#[tokio::test]
async fn zweite_meldung_mit_anderem_stand_wird_nicht_wieder_angenommen() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let k = kopplung(&pool, "wird_gemeldet").await;
    spiegel(&pool, leit, "gegen/7", 3).await;
    let (q, umgewandelt) = annehmen(&pool, &k, &verwahrt("gegen/7", 3, vec![]))
        .await
        .unwrap();
    assert_eq!(q.ergebnis, VERWAHRUNG_ANGENOMMEN);
    assert!(umgewandelt.is_some());

    // Die Quittung ging verloren: derselbe Stand wird wieder angenommen.
    let (q, umgewandelt) = annehmen(&pool, &k, &verwahrt("gegen/7", 3, vec![]))
        .await
        .unwrap();
    assert_eq!(q.ergebnis, VERWAHRUNG_ANGENOMMEN);
    assert_eq!(umgewandelt, None);

    // Drüben nach der Übergabe geändert: kein zweites „angenommen“.
    let (q, umgewandelt) = annehmen(&pool, &k, &verwahrt("gegen/7", 4, vec![]))
        .await
        .unwrap();
    assert_eq!(q.ergebnis, VERWAHRUNG_WARTET);
    assert_eq!(
        q.grund.as_deref(),
        Some("Nach der Übergabe geändert (Stand 3 von 4)")
    );
    assert_eq!(umgewandelt, None);
}

#[tokio::test]
async fn verwahrung_wartet_auf_offene_antraege_und_behaelt_abgelehnte() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let k = kopplung(&pool, "wird_gemeldet").await;
    let id = spiegel(&pool, leit, "gegen/5", 3).await;
    for client in ["c1", "c2"] {
        unter_merker(
            &pool,
            "INSERT INTO spiegel_antrag (einsatz_id, art, methode, pfad_vorlage, pfad_lokal, \
             daten, benutzer_id, client_id, erfasst_at, geaendert_at) \
             VALUES (?, 'etb', 'POST', '/x', '{}', '{\"text\":\"Lage\"}', ?, ?, \
             datetime('now'), datetime('now'))",
            &[&id.to_string(), &leit.to_string(), client],
        )
        .await;
    }

    let (q, umgewandelt) = annehmen(&pool, &k, &verwahrt("gegen/5", 3, vec![]))
        .await
        .unwrap();
    assert_eq!(
        (q.ergebnis.as_str(), q.grund.as_deref(), umgewandelt),
        (VERWAHRUNG_WARTET, Some("2 Anträge offen"), None)
    );

    // Der Führer lehnt einen ab und übernimmt den anderen.
    unter_merker(
        &pool,
        "UPDATE spiegel_antrag SET zustand = CASE client_id WHEN 'c1' THEN 'abgelehnt' \
         ELSE 'uebernommen' END, grund = 'Einsatz abgeschlossen.' WHERE einsatz_id = ?",
        &[&id.to_string()],
    )
    .await;
    let (q, umgewandelt) = annehmen(&pool, &k, &verwahrt("gegen/5", 3, vec![]))
        .await
        .unwrap();
    assert_eq!(q.ergebnis, VERWAHRUNG_ANGENOMMEN);
    assert_eq!(umgewandelt, Some(id));
    let bleiben: Vec<(String, String)> = sqlx::query_as(
        "SELECT client_id, daten FROM spiegel_antrag WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        bleiben,
        vec![("c1".to_string(), "{\"text\":\"Lage\"}".to_string())],
        "der abgelehnte bleibt mit seinen Daten"
    );
}
