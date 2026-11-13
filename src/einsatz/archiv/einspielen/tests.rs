//! Einspielen eines Archivblocks (LLH-1494, D10): Archivieren, Block nehmen, an derselben
//! Installation einspielen, nach 7 Tagen abräumen.

use super::*;
use crate::einsatz::archiv::tests::{leitung, schluessel};
use crate::einsatz::repo::{abschliessen, anlegen, NeuerEinsatzDaten};
use crate::einsatz::retention::Datenkategorie as K;
use crate::instanz::spiegel::paket::KontoAngabe;
use age::secrecy::ExposeSecret;
use std::path::PathBuf;

const ABC_SHA256: &str = "b5d4045c3f466fa91fe2cc6abe79232a1a57cdf104f7a26e716e0a1e2789df78";

async fn eine<T>(pool: &SqlitePool, sql: &str) -> T
where
    T: Send + Unpin + for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

async fn exec(pool: &SqlitePool, sql: &str) {
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"));
}

/// Zwei Fahrzeuge der Org: eines bleibt, eines wird nach dem Archivieren umbenannt.
async fn fahrzeuge(pool: &SqlitePool) -> (i64, i64) {
    let mut ids = Vec::new();
    for name in ["Florian 1", "Florian 2"] {
        ids.push(
            eine(
                pool,
                &format!(
                    "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, '{name}') RETURNING id"
                ),
            )
            .await,
        );
    }
    (ids[0], ids[1])
}

/// Ein abgeschlossener Einsatz mit Person, Anhang und zwei Fahrzeugen, archiviert. Liefert die
/// ID und den gültigen Block.
async fn archivierter_einsatz(
    pool: &SqlitePool,
    leit: i64,
    fz: (i64, i64),
    fristen: &[(K, i64)],
) -> (i64, Vec<u8>) {
    let e = anlegen(
        pool,
        NeuerEinsatzDaten {
            bezeichnung: "Hochwasser",
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
    exec(
        pool,
        &format!(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, \
             herkunft_adresse, zustand, erfasst_von, geaendert_von) \
             VALUES ({id}, 1, 'erfasst', 'Mustermann', 'Hauptstraße 1', 'stabil', {leit}, {leit})",
            id = e.id
        ),
    )
    .await;
    sqlx::query(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'foto.jpg', 'image/jpeg', 3, ?, ?, ?)",
    )
    .bind(e.id)
    .bind(ABC_SHA256)
    .bind(b"ABC".as_slice())
    .bind(leit)
    .execute(pool)
    .await
    .unwrap();
    for (fahrzeug, name) in [(fz.0, "Florian 1"), (fz.1, "Florian 2")] {
        exec(
            pool,
            &format!(
                "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
                 VALUES ({}, {fahrzeug}, '{name}')",
                e.id
            ),
        )
        .await;
    }
    abschliessen(pool, e.id, leit).await.unwrap();
    exec(
        pool,
        &format!(
            "UPDATE einsatz SET retention_bis = NULL, nachbereitung_bis = datetime('now', \
             '-1 day') WHERE id = {}",
            e.id
        ),
    )
    .await;
    exec(
        pool,
        &format!(
            "DELETE FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = {}",
            e.id
        ),
    )
    .await;
    for (k, tage) in fristen {
        exec(
            pool,
            &format!(
                "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                 rechtsgrundlage) VALUES ({}, '{}', datetime('now', '{tage} days'), 'Gesetz')",
                e.id,
                k.as_str()
            ),
        )
        .await;
    }
    assert!(super::super::archivieren(pool, e.id, Utc::now())
        .await
        .unwrap());
    let (_, inhalt) = super::super::gueltiger_block(pool, e.id, &crate::zeit::jetzt())
        .await
        .unwrap()
        .unwrap();
    (e.id, inhalt)
}

/// Der Block als Datei und der Schlüssel, wie ihn der Befehl liest.
fn als_datei(
    inhalt: &[u8],
    id: &age::x25519::Identity,
) -> (tempfile::TempDir, PathBuf, Schluessel) {
    let dir = tempfile::tempdir().unwrap();
    let pfad = dir.path().join("block.age");
    std::fs::write(&pfad, inhalt).unwrap();
    let schluessel = Schluessel::laden(
        format!("{}\n", id.to_string().expose_secret()).into_bytes(),
        None,
        || panic!("keine Passphrase"),
    )
    .unwrap();
    (dir, pfad, schluessel)
}

/// Zwischendateien des Einspielens neben der Datenbank des Tests (eigenes Verzeichnis je Test).
fn zwischendateien(dir: &tempfile::TempDir) -> usize {
    std::fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("lifeline-zwischen-")
        })
        .count()
}

#[tokio::test]
async fn eingespielt_schreibgeschuetzt_mit_platzhaltern_und_nach_7_tagen_weg() {
    let (db_dir, pool) = crate::db::test_pool_datei().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    let (alt, block) = archivierter_einsatz(&pool, leit, fz, &[]).await;
    // Nach dem Archivieren: Florian 2 heißt hier jetzt anders.
    exec(
        &pool,
        &format!(
            "UPDATE fahrzeug SET funkrufname = 'Florian 22' WHERE id = {}",
            fz.1
        ),
    )
    .await;
    let (_dir, datei, s) = als_datei(&block, &id);
    let jetzt = Utc::now();

    let e = einspielen(&pool, &datei, &s, None, jetzt).await.unwrap();
    assert_ne!(e.einsatz_id, alt, "eigener Einsatz neben dem Skelett");
    assert_eq!(e.bezeichnung, "Hochwasser");
    assert_eq!(e.inhalte, 1);
    assert!(e.hinweise.is_empty(), "{:?}", e.hinweise);
    let neu = e.einsatz_id;

    // Ein beendeter Spiegel ohne Kopplung; die Org-Zuordnung der Übernahme ist wieder weg.
    let (spiegel, beendet, zuordnung): (i64, Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT e.spiegel, s.beendet_at, s.kopplung_org_id FROM einsatz e \
         JOIN einsatz_spiegel s ON s.einsatz_id = e.id WHERE e.id = ?",
    )
    .bind(neu)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((spiegel, beendet.is_some(), zuordnung), (1, true, None));
    assert_eq!(
        eine::<i64>(&pool, "SELECT COUNT(*) FROM instanz_kopplung").await,
        0
    );
    assert_eq!(
        eine::<i64>(&pool, "SELECT COUNT(*) FROM spiegel_konto").await,
        0
    );

    // Inhalt wie im Archiv, der Anhang samt Daten.
    let name: String = eine(
        &pool,
        &format!("SELECT name FROM einsatz_person WHERE einsatz_id = {neu}"),
    )
    .await;
    assert_eq!(name, "Mustermann");
    let daten: Vec<u8> = eine(
        &pool,
        &format!("SELECT daten FROM anhang WHERE einsatz_id = {neu}"),
    )
    .await;
    assert_eq!(daten, b"ABC");
    let offen: i64 = eine(
        &pool,
        &format!(
            "SELECT COUNT(*) FROM spiegel_anhang WHERE einsatz_id = {neu} AND fertig_at IS NULL"
        ),
    )
    .await;
    assert_eq!(offen, 0);

    // Stammdaten: gleiche ID und gleicher Name bleiben, ein umbenanntes Fahrzeug fällt weg.
    let verweise: Vec<(String, Option<i64>)> = sqlx::query_as(
        "SELECT snap_funkrufname, fahrzeug_id FROM einsatz_fahrzeug WHERE einsatz_id = ? \
         ORDER BY snap_funkrufname",
    )
    .bind(neu)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        verweise,
        vec![("Florian 1".into(), Some(fz.0)), ("Florian 2".into(), None)]
    );

    // Der Verfasser ist ein gesperrter Platzhalter mit dem Namen aus dem Archiv, nie das Konto
    // von heute, und in keiner Verwaltung.
    let (erfasser, anzeigename, aktiv): (i64, String, i64) = sqlx::query_as(
        "SELECT b.id, b.anzeigename, b.aktiv FROM einsatz_person p \
         JOIN benutzer b ON b.id = p.erfasst_von WHERE p.einsatz_id = ?",
    )
    .bind(neu)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(erfasser, leit);
    assert_eq!((anzeigename.as_str(), aktiv), ("Lea Leitung", 0));
    let sichtbar: i64 = eine(
        &pool,
        &format!(
            "SELECT COUNT(*) FROM benutzer b WHERE b.id = {erfasser} AND {}",
            crate::instanz::spiegel::OHNE_STELLVERTRETER
        ),
    )
    .await;
    assert_eq!(sichtbar, 0);
    // Platzhalter werden nicht Mitglied, keine Admin-Route erreicht sie, und keine Kopplung kann
    // ihre Kennung für ein eigenes Konto nennen.
    assert_eq!(
        eine::<i64>(
            &pool,
            &format!("SELECT COUNT(*) FROM einsatz_mitgliedschaft WHERE einsatz_id = {neu}")
        )
        .await,
        0
    );
    let admin: crate::auth::Benutzer = sqlx::query_as(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, \
         aktiv, erstellt_at FROM benutzer WHERE id = ?",
    )
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(matches!(
        crate::routes::benutzer::ziel_laden(&pool, &admin, erfasser).await,
        Err(AppError::NotFound)
    ));
    {
        let mut c = pool.acquire().await.unwrap();
        let kopplung: i64 = sqlx::query_scalar(
            "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, \
             gegenueber_name, richtung, zustand) VALUES ('elw', '', 'ELW', 'wird_gemeldet', \
             'aktiv') RETURNING id",
        )
        .fetch_one(&mut *c)
        .await
        .unwrap();
        let angabe = KontoAngabe {
            id: 5,
            anzeigename: "Fremd".into(),
            gegen_id: Some(erfasser),
            ursprung: None,
        };
        let lokal =
            crate::instanz::spiegel::abbildung::konto_lokal(&mut c, kopplung, 0, 1, false, &angabe)
                .await
                .unwrap();
        assert_ne!(lokal, erfasser);
    }

    // Die Anzeige nennt das Archiv und bis wann.
    let einsatz = crate::einsatz::repo::laden(&pool, neu).await.unwrap();
    let anzeige = einsatz.spiegel.anzeige().unwrap();
    assert_eq!(anzeige.gegenstelle, "Archiv");
    assert!(anzeige.beendet);
    assert_eq!(anzeige.archiv_bis.as_deref(), Some(e.loeschen_at.as_str()));

    // Admin-Spur ohne Akteur.
    let (aktion, akteur, wer): (String, Option<i64>, String) = sqlx::query_as(
        "SELECT aktion, akteur_id, akteur_name FROM admin_audit ORDER BY id DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (aktion.as_str(), akteur, wer.as_str()),
        ("archiv_eingespielt", None, "Befehl archiv einspielen")
    );
    assert_eq!(zwischendateien(&db_dir), 0, "die Zwischendatei ist weg");

    // Vor Ablauf bleibt er, danach räumt Phase R ihn samt Platzhaltern ab.
    let bald = crate::zeit::formatiere_utc(jetzt + TimeDelta::days(6));
    assert_eq!(faellige_vormerken(&pool, &bald).await, 0);
    let spaeter = crate::zeit::formatiere_utc(jetzt + TimeDelta::days(7));
    assert_eq!(faellige_vormerken(&pool, &spaeter).await, 1);
    assert_eq!(abraeumen::phase_r(&pool, &crate::live::LiveHub::new(), &spaeter).await, 1);
    assert_eq!(konten_aufraeumen(&pool).await, 1);
    let rest: i64 = eine(
        &pool,
        &format!("SELECT COUNT(*) FROM einsatz WHERE id = {neu}"),
    )
    .await;
    assert_eq!(rest, 0);
    let konten: i64 = eine(
        &pool,
        &format!("SELECT COUNT(*) FROM benutzer WHERE id = {erfasser}"),
    )
    .await;
    assert_eq!(konten, 0);
    assert_eq!(
        eine::<i64>(&pool, "SELECT COUNT(*) FROM archiv_konto").await,
        0
    );
    let (art, gegenstelle): (String, Option<String>) = sqlx::query_as(
        "SELECT art, gegenstelle FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?",
    )
    .bind(neu)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (art.as_str(), gegenstelle.as_deref()),
        ("spiegel", Some("Archiv"))
    );
    // Das Skelett des archivierten Einsatzes und das echte Konto bleiben.
    assert_eq!(
        eine::<i64>(
            &pool,
            &format!("SELECT COUNT(*) FROM einsatz WHERE id = {alt}")
        )
        .await,
        1
    );
    assert_eq!(
        eine::<i64>(
            &pool,
            &format!("SELECT COUNT(*) FROM benutzer WHERE id = {leit}")
        )
        .await,
        1
    );
}

#[tokio::test]
async fn veralteter_block_wird_vor_dem_einspielen_geschwaerzt() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    // Block 1 gilt bis zum Ende der Personenauskunft in 10 Tagen.
    let (_, block) = archivierter_einsatz(&pool, leit, fz, &[(K::Personenauskunft, 10)]).await;
    let (_dir, datei, s) = als_datei(&block, &id);

    let e = einspielen(&pool, &datei, &s, Some(1), Utc::now() + TimeDelta::days(20))
        .await
        .unwrap();
    assert!(
        e.hinweise.iter().any(|h| h.contains("personenauskunft")),
        "{:?}",
        e.hinweise
    );
    let herkunft: Option<String> = eine(
        &pool,
        &format!(
            "SELECT herkunft_adresse FROM einsatz_person WHERE einsatz_id = {}",
            e.einsatz_id
        ),
    )
    .await;
    assert_ne!(herkunft.as_deref(), Some("Hauptstraße 1"));
}

#[tokio::test]
async fn falscher_schluessel_und_fremde_org_spielen_nichts_ein() {
    let (db_dir, pool) = crate::db::test_pool_datei().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    let (_, block) = archivierter_einsatz(&pool, leit, fz, &[]).await;
    let vorher = eine::<i64>(&pool, "SELECT COUNT(*) FROM einsatz").await;

    let fremd = age::x25519::Identity::generate();
    let (_d1, datei, s) = als_datei(&block, &fremd);
    let f = einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap_err();
    assert!(f.to_string().contains("Schlüssel passt nicht"), "{f}");

    let (_d2, datei, s) = als_datei(&block, &id);
    let f = einspielen(&pool, &datei, &s, Some(99), Utc::now())
        .await
        .unwrap_err();
    assert!(f.to_string().contains("--org"), "{f}");

    assert_eq!(
        eine::<i64>(&pool, "SELECT COUNT(*) FROM einsatz").await,
        vorher
    );
    assert_eq!(
        eine::<i64>(&pool, "SELECT COUNT(*) FROM archiv_konto").await,
        0
    );
    assert_eq!(zwischendateien(&db_dir), 0);
}

#[tokio::test]
async fn ein_block_mit_abgelaufener_aufbewahrung_wird_abgelehnt() {
    let (db_dir, pool) = crate::db::test_pool_datei().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    archivierter_einsatz(&pool, leit, fz, &[]).await;
    // Ein Block mit Aufbewahrungsende: der Einsatz endet in 30 Tagen.
    let e2 = anlegen(
        &pool,
        NeuerEinsatzDaten {
            bezeichnung: "Sturm",
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
    abschliessen(&pool, e2.id, leit).await.unwrap();
    exec(
        &pool,
        &format!(
            "UPDATE einsatz SET retention_bis = datetime('now', '+30 days'), \
             nachbereitung_bis = datetime('now', '-1 day') WHERE id = {}",
            e2.id
        ),
    )
    .await;
    exec(
        &pool,
        &format!(
            "DELETE FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = {}",
            e2.id
        ),
    )
    .await;
    assert!(super::super::archivieren(&pool, e2.id, Utc::now())
        .await
        .unwrap());
    let (_, block) = super::super::gueltiger_block(&pool, e2.id, &crate::zeit::jetzt())
        .await
        .unwrap()
        .unwrap();
    let (_d, datei, s) = als_datei(&block, &id);
    let vorher = eine::<i64>(&pool, "SELECT COUNT(*) FROM einsatz").await;
    let f = einspielen(&pool, &datei, &s, None, Utc::now() + TimeDelta::days(31))
        .await
        .unwrap_err();
    assert!(f.to_string().contains("Aufbewahrung"), "{f}");
    assert_eq!(
        eine::<i64>(&pool, "SELECT COUNT(*) FROM einsatz").await,
        vorher
    );
    assert_eq!(zwischendateien(&db_dir), 0);
}

#[tokio::test]
async fn stamm_name_deckt_die_stammdaten_des_archivs() {
    let im_archiv: Vec<&str> = bauen::STAMM
        .iter()
        .map(|(t, _)| *t)
        .filter(|t| !matches!(*t, "organisation" | "benutzer"))
        .collect();
    let benannt: Vec<&str> = STAMM_NAME.iter().map(|(t, _)| *t).collect();
    assert_eq!(benannt, im_archiv, "STAMM_NAME folgt bauen::STAMM");
    for (t, _) in STAMM_NAME {
        assert!(
            stammdaten_art::BESCHREIBUNGEN
                .iter()
                .any(|b| b.tabelle == *t),
            "{t} ist keine verteilte Stammdatenart"
        );
    }
}

#[tokio::test]
async fn eine_frist_des_blocks_kuerzt_die_zeit_hier() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    // Block 1 gilt nur bis zum Ende der Personenauskunft in 2 Tagen.
    let (_, block) = archivierter_einsatz(&pool, leit, fz, &[(K::Personenauskunft, 2)]).await;
    let (_dir, datei, s) = als_datei(&block, &id);
    let jetzt = Utc::now();

    let e = einspielen(&pool, &datei, &s, None, jetzt).await.unwrap();
    let frist: String = eine(
        &pool,
        "SELECT frist_bis FROM einsatz_aufbewahrung_kategorie WHERE kategorie = 'personenauskunft' \
         ORDER BY einsatz_id LIMIT 1",
    )
    .await;
    assert_eq!(e.loeschen_at, frist);
    assert!(
        e.hinweise.iter().any(|h| h.contains("Frist des Blocks")),
        "{:?}",
        e.hinweise
    );
    let bis: String = eine(
        &pool,
        &format!(
            "SELECT loeschen_at FROM einsatz_archiv_eingespielt WHERE einsatz_id = {}",
            e.einsatz_id
        ),
    )
    .await;
    assert_eq!(bis, frist);
    let danach = crate::zeit::formatiere_utc(jetzt + TimeDelta::days(3));
    assert_eq!(faellige_vormerken(&pool, &danach).await, 1);
}

#[tokio::test]
async fn ein_hier_geloeschter_block_kommt_nicht_zurueck() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    let (alt, block) = archivierter_einsatz(&pool, leit, fz, &[]).await;
    let (_dir, datei, s) = als_datei(&block, &id);
    // Ein Löschersuchen hat das Archiv gelöscht; die heruntergeladene Kopie bleibt draußen.
    exec(
        &pool,
        &format!("DELETE FROM einsatz_archiv WHERE einsatz_id = {alt}"),
    )
    .await;
    let vorher = eine::<i64>(&pool, "SELECT COUNT(*) FROM einsatz").await;
    let f = einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap_err();
    assert!(f.to_string().contains("nicht mehr im Archiv"), "{f}");
    assert_eq!(
        eine::<i64>(&pool, "SELECT COUNT(*) FROM einsatz").await,
        vorher
    );
}

#[tokio::test]
async fn ohne_org_nur_in_die_org_gleichen_namens() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    let (_, block) = archivierter_einsatz(&pool, leit, fz, &[]).await;
    let (_dir, datei, s) = als_datei(&block, &id);
    // Hier heißt Org 1 anders als im Archiv, etwa an einer anderen Installation.
    exec(
        &pool,
        "UPDATE organisation SET name = 'KV Süd' WHERE id = 1",
    )
    .await;

    let f = einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap_err();
    assert!(f.to_string().contains("--org"), "{f}");
    assert!(f.to_string().contains("KV Süd"), "{f}");
    let e = einspielen(&pool, &datei, &s, Some(1), Utc::now())
        .await
        .unwrap();
    assert_eq!(e.org_name, "KV Süd");
}

#[tokio::test]
async fn ein_loeschersuchen_nimmt_die_eingespielte_kopie_mit() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    let (alt, block) = archivierter_einsatz(&pool, leit, fz, &[]).await;
    let (_dir, datei, s) = als_datei(&block, &id);
    let e = einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let geloescht = super::super::alle_loeschen_tx(&mut conn, alt)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(geloescht, 1);
    let vorgemerkt: Option<String> = sqlx::query_scalar(
        "SELECT gegenstelle FROM einsatz_abraeumen WHERE einsatz_id = ? AND art = 'spiegel'",
    )
    .bind(e.einsatz_id)
    .fetch_optional(&pool)
    .await
    .unwrap()
    .flatten();
    assert_eq!(vorgemerkt.as_deref(), Some(GEGENSTELLE));
    abraeumen::alle_vorgemerkten(&pool, &crate::live::LiveHub::new()).await;
    assert_eq!(
        eine::<i64>(
            &pool,
            &format!("SELECT COUNT(*) FROM einsatz WHERE id = {}", e.einsatz_id)
        )
        .await,
        0
    );
}

#[tokio::test]
async fn ein_endgueltig_geloeschter_einsatz_kommt_nicht_zurueck() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let id = schluessel(&pool).await;
    let fz = fahrzeuge(&pool).await;
    let (alt, block) = archivierter_einsatz(&pool, leit, fz, &[]).await;
    let (_dir, datei, s) = als_datei(&block, &id);
    // Phase D hat das Skelett gelöscht; das Löschprotokoll trägt Nummer und Abschlusszeit.
    let (nummer, abgeschlossen): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT einsatznummer_intern, abgeschlossen_at FROM einsatz WHERE id = ?")
            .bind(alt)
            .fetch_one(&pool)
            .await
            .unwrap();
    exec(&pool, &format!("DELETE FROM einsatz WHERE id = {alt}")).await;
    sqlx::query(
        "INSERT INTO aufbewahrung_loeschprotokoll (org_id, einsatz_id, einsatznummer_intern, \
         abgeschlossen_at, geschwaerzt_at, geloescht_at, skelett_dauer_tage, akteur_id) \
         VALUES (1, ?, ?, ?, 'x', 'x', 1, ?)",
    )
    .bind(alt)
    .bind(nummer.as_deref())
    .bind(abgeschlossen.as_deref())
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();

    let f = einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap_err();
    assert!(f.to_string().contains("endgültig gelöscht"), "{f}");

    // Gleiche ID und Nummer, aber ein anderer Abschluss: ein Einsatz einer anderen Installation.
    exec(
        &pool,
        &format!(
            "UPDATE aufbewahrung_loeschprotokoll SET abgeschlossen_at = '2001-01-01T00:00:00Z' \
             WHERE einsatz_id = {alt}"
        ),
    )
    .await;
    einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap();
}

#[tokio::test]
async fn der_befehl_verlangt_den_stand_seiner_version() {
    let pool = crate::db::test_pool().await;
    assert_eq!(crate::db::stand_abweichung(&pool).await.unwrap(), None);
    exec(
        &pool,
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (99999999, 'neuer', 1, x'00', 0)",
    )
    .await;
    let neuer = crate::db::stand_abweichung(&pool).await.unwrap().unwrap();
    assert!(neuer.contains("neueren Version"), "{neuer}");
    exec(
        &pool,
        "DELETE FROM _sqlx_migrations WHERE version IN (99999999, \
         (SELECT MAX(version) FROM _sqlx_migrations WHERE version < 99999999))",
    )
    .await;
    let fehlt = crate::db::stand_abweichung(&pool).await.unwrap().unwrap();
    assert!(
        fehlt.contains("1 Migrationen dieser Version fehlen"),
        "{fehlt}"
    );
}
