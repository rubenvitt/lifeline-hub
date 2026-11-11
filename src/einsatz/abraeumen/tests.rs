use super::*;
use crate::einsatz::repo::{abschliessen, anlegen, NeuerEinsatzDaten};

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

/// Ein abgeschlossener Einsatz mit Anhang und ETB-Eintrag.
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
    sqlx::query(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'foto.jpg', 'image/jpeg', 3, 'deadbeef', ?, ?)",
    )
    .bind(e.id)
    .bind(b"ABC".as_slice())
    .bind(leit)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
         VALUES (?, 99, 'lage', 'Lage ruhig', ?, datetime('now'))",
    )
    .bind(e.id)
    .bind(leit)
    .execute(pool)
    .await
    .unwrap();
    abschliessen(pool, e.id, leit).await.unwrap();
    (e.id, e.einsatznummer_intern.unwrap())
}

async fn zaehle(pool: &SqlitePool, sql: &str, id: i64) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn vormerken_pool(pool: &SqlitePool, id: i64, art: AbraeumArt, gegenstelle: Option<&str>) {
    let mut tx = pool.begin().await.unwrap();
    vormerken(&mut tx, id, art, gegenstelle).await.unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn ohne_merker_bleibt_alles() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let (id, _) = einsatz(&pool, leit).await;

    assert!(!ausfuehren(&pool, id).await.unwrap());
    assert_eq!(
        zaehle(&pool, "SELECT COUNT(*) FROM einsatz WHERE id = ?", id).await,
        1
    );
}

#[tokio::test]
async fn verwahrter_einsatz_geht_samt_dateien_und_sperrt_id_und_nummer() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let (id, nummer) = einsatz(&pool, leit).await;

    vormerken_pool(&pool, id, AbraeumArt::Verwahrt, Some("Hub Kreis")).await;
    assert!(ausfuehren(&pool, id).await.unwrap());

    for sql in [
        "SELECT COUNT(*) FROM einsatz WHERE id = ?",
        "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?",
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
        "SELECT COUNT(*) FROM einsatz_abraeumen WHERE einsatz_id = ?",
    ] {
        assert_eq!(zaehle(&pool, sql, id).await, 0, "{sql}");
    }
    let (art, gegenstelle, n, akteur, geschwaerzt): (
        String,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT art, gegenstelle, einsatznummer_intern, akteur_id, geschwaerzt_at \
         FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(art, "verwahrt");
    assert_eq!(gegenstelle.as_deref(), Some("Hub Kreis"));
    assert_eq!(n.as_deref(), Some(nummer.as_str()));
    assert_eq!(akteur, Some(leit), "abschließende Person");
    assert_eq!(geschwaerzt, None);

    // Ein neuer Einsatz bekommt weder ID noch Nummer des abgeräumten.
    let (neu, neue_nummer) = einsatz(&pool, leit).await;
    assert!(neu > id);
    assert_ne!(neue_nummer, nummer);

    assert!(
        !ausfuehren(&pool, id).await.unwrap(),
        "zweiter Lauf: nichts"
    );
}

#[tokio::test]
async fn spiegel_geht_durch_den_schutz_und_traegt_keine_nummer() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let (id, nummer) = einsatz(&pool, leit).await;
    crate::einsatz::spiegel_filter::als_spiegel_markieren(&pool, id).await;
    // Der Schutz greift: ohne Merker kein Löschen.
    assert!(sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .is_err());

    vormerken_pool(&pool, id, AbraeumArt::Spiegel, Some("ELW 1")).await;
    assert!(ausfuehren(&pool, id).await.unwrap());

    assert_eq!(
        zaehle(&pool, "SELECT COUNT(*) FROM einsatz WHERE id = ?", id).await,
        0
    );
    assert_eq!(
        zaehle(
            &pool,
            "SELECT COUNT(*) FROM einsatz_spiegel WHERE einsatz_id = ?",
            id
        )
        .await,
        0
    );
    let (art, n, lfd): (String, Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT art, einsatznummer_intern, nummer_lfd FROM aufbewahrung_loeschprotokoll \
         WHERE einsatz_id = ?",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(art, "spiegel");
    assert_eq!((n, lfd), (None, None), "die Nummer gehört dem Führer");

    // Die ID bleibt gesperrt, die Nummer nicht.
    let (neu, neue_nummer) = einsatz(&pool, leit).await;
    assert!(neu > id);
    assert_eq!(neue_nummer, nummer);
}

#[tokio::test]
async fn alle_vorgemerkten_holt_nach() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let (a, _) = einsatz(&pool, leit).await;
    let (b, _) = einsatz(&pool, leit).await;
    vormerken_pool(&pool, a, AbraeumArt::Verwahrt, Some("Hub")).await;

    assert_eq!(alle_vorgemerkten(&pool).await, 1);
    assert_eq!(
        zaehle(&pool, "SELECT COUNT(*) FROM einsatz WHERE id = ?", b).await,
        1
    );
}

/// Kopplung 1 in Richtung `richtung` mit Org-Zuordnung 1.
async fn kopplung(pool: &SqlitePool, richtung: &str) {
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
}

/// Ein abgeschlossener Spiegel aus Kopplung 1 mit Nachbereitung bis `bis`.
async fn spiegel(pool: &SqlitePool, leit: i64, bis: Option<&str>) -> i64 {
    let (id, _) = einsatz(pool, leit).await;
    sqlx::query("UPDATE einsatz SET nachbereitung_bis = ? WHERE id = ?")
        .bind(bis)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    crate::einsatz::spiegel_filter::als_spiegel_markieren(pool, id).await;
    crate::einsatz::spiegel_filter::unter_merker(
        pool,
        "UPDATE einsatz_spiegel SET kopplung_org_id = 1 WHERE einsatz_id = ?",
        &[id],
    )
    .await;
    id
}

const JETZT: &str = "2026-11-11 12:00:00";

async fn gibt_es(pool: &SqlitePool, id: i64) -> bool {
    zaehle(pool, "SELECT COUNT(*) FROM einsatz WHERE id = ?", id).await == 1
}

#[tokio::test]
async fn phase_r_raeumt_spiegel_der_meldenden_seite_nach_der_nachbereitung_ab() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    kopplung(&pool, "meldet_sich").await;
    let abgelaufen = spiegel(&pool, leit, Some("2026-11-01 00:00:00")).await;
    let laeuft = spiegel(&pool, leit, Some("2026-12-01 00:00:00")).await;
    let ohne = spiegel(&pool, leit, None).await;
    let mit_antrag = spiegel(&pool, leit, Some("2026-11-01 00:00:00")).await;
    crate::einsatz::spiegel_filter::unter_merker(
        &pool,
        "INSERT INTO spiegel_antrag (einsatz_id, art, methode, pfad_vorlage, pfad_lokal, daten, \
         benutzer_id, client_id, erfasst_at, geaendert_at) \
         VALUES (?, 'etb', 'POST', '/x', '{}', '{}', ?, 'c1', datetime('now'), datetime('now'))",
        &[mit_antrag, leit],
    )
    .await;
    // Nach einem Widerruf bleibt der Spiegel ohne Kopplung lesbar.
    let beendet = spiegel(&pool, leit, Some("2026-11-01 00:00:00")).await;
    crate::einsatz::spiegel_filter::unter_merker(
        &pool,
        "UPDATE einsatz_spiegel SET beendet_at = '2026-11-02 00:00:00' WHERE einsatz_id = ?",
        &[beendet],
    )
    .await;
    // Ein eigener Einsatz nach der Nachbereitung bleibt: er geht über die Verwahrung.
    let (eigen, _) = einsatz(&pool, leit).await;
    sqlx::query("UPDATE einsatz SET nachbereitung_bis = '2026-11-01 00:00:00' WHERE id = ?")
        .bind(eigen)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(phase_r(&pool, JETZT).await, 1);
    assert!(!gibt_es(&pool, abgelaufen).await);
    for (id, was) in [
        (laeuft, "Nachbereitung läuft"),
        (ohne, "ohne Nachbereitung"),
        (mit_antrag, "Antrag steht aus"),
        (beendet, "Spiegel beendet"),
        (eigen, "eigener Einsatz"),
    ] {
        assert!(gibt_es(&pool, id).await, "{was}");
    }
    let (art, gegenstelle): (String, Option<String>) = sqlx::query_as(
        "SELECT art, gegenstelle FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?",
    )
    .bind(abgelaufen)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (art.as_str(), gegenstelle.as_deref()),
        ("spiegel", Some("Gegenstelle"))
    );
    assert_eq!(phase_r(&pool, JETZT).await, 0, "zweiter Lauf: nichts");
}

#[tokio::test]
async fn phase_r_laesst_spiegel_am_hub_stehen() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    kopplung(&pool, "wird_gemeldet").await;
    let id = spiegel(&pool, leit, Some("2026-11-01 00:00:00")).await;

    assert_eq!(phase_r(&pool, JETZT).await, 0);
    assert!(gibt_es(&pool, id).await);
}
