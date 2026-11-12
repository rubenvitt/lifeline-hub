use super::bauen::{plane_bloecke, BlockPlan, OffeneKategorie};
use super::*;
use crate::einsatz::repo::{abschliessen, anlegen, NeuerEinsatzDaten};
use crate::einsatz::retention::Datenkategorie as K;
use std::io::Read;

fn k(kategorie: K, frist_bis: &str) -> OffeneKategorie {
    OffeneKategorie {
        kategorie,
        frist_bis: frist_bis.into(),
    }
}

fn plan(block: i64, gueltig_bis: Option<&str>, geschwaerzt: &[K]) -> BlockPlan {
    BlockPlan {
        block,
        gueltig_bis: gueltig_bis.map(str::to_string),
        geschwaerzt: geschwaerzt.to_vec(),
    }
}

const JETZT: &str = "2027-01-01 00:00:00";

#[test]
fn ohne_kategorien_ein_block_bis_zum_ende_der_aufbewahrung() {
    assert_eq!(plane_bloecke(&[], None, JETZT), vec![plan(1, None, &[])]);
    assert_eq!(
        plane_bloecke(&[], Some("2030-01-01 00:00:00"), JETZT),
        vec![plan(1, Some("2030-01-01 00:00:00"), &[])]
    );
}

#[test]
fn je_fristende_ein_block_mit_den_frueher_endenden_geschwaerzt() {
    let kategorien = [
        k(K::Behandlung, "2036-01-01 00:00:00"),
        k(K::Personenauskunft, "2027-03-01 00:00:00"),
    ];
    assert_eq!(
        plane_bloecke(&kategorien, None, JETZT),
        vec![
            plan(1, Some("2027-03-01 00:00:00"), &[]),
            plan(2, Some("2036-01-01 00:00:00"), &[K::Personenauskunft]),
            plan(3, None, &[K::Behandlung, K::Personenauskunft]),
        ]
    );
}

#[test]
fn abgelaufene_und_spaete_fristen() {
    // Personenauskunft ist schon abgelaufen (Karenz läuft): in jedem Block geschwärzt. Behandlung
    // endet nach der Aufbewahrung: sie geht mit dem Einsatz.
    let kategorien = [
        k(K::Personenauskunft, "2026-12-01 00:00:00"),
        k(K::Behandlung, "2040-01-01 00:00:00"),
    ];
    assert_eq!(
        plane_bloecke(&kategorien, Some("2030-01-01 00:00:00"), JETZT),
        vec![plan(1, Some("2030-01-01 00:00:00"), &[K::Personenauskunft])]
    );
    // Zwei Kategorien mit demselben Ende: ein Block.
    let gleich = [
        k(K::Personenauskunft, "2028-01-01 00:00:00"),
        k(K::Anhaenge, "2028-01-01 00:00:00"),
    ];
    assert_eq!(
        plane_bloecke(&gleich, None, JETZT),
        vec![
            plan(1, Some("2028-01-01 00:00:00"), &[]),
            plan(2, None, &[K::Personenauskunft, K::Anhaenge]),
        ]
    );
}

async fn leitung(pool: &SqlitePool) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, totp_secret) \
         VALUES (1, 'Lea Leitung', 'leit-' || abs(random()), 'geheimer-hash', 'TOTP') \
         RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Trägt einen geprüften Archiv-Schlüssel ein und liefert den privaten.
async fn schluessel(pool: &SqlitePool) -> age::x25519::Identity {
    let id = age::x25519::Identity::generate();
    let r = id.to_public();
    sqlx::query(
        "INSERT INTO org_archiv_empfaenger (org_id, empfaenger, bezeichnung, fingerabdruck, \
            geprueft_at) VALUES (1, ?, 'Tresor', ?, datetime('now'))",
    )
    .bind(r.to_string())
    .bind(crate::org::archiv_empfaenger::fingerabdruck(&r))
    .execute(pool)
    .await
    .unwrap();
    id
}

/// Ein abgeschlossener Einsatz mit einer Person (Name, Herkunft, Zustand) und einem Anhang. Die
/// Nachbereitung endete gestern, die Aufbewahrung ist unbegrenzt.
async fn einsatz(pool: &SqlitePool, leit: i64) -> i64 {
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
    sqlx::query(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, herkunft_adresse, \
            zustand, erfasst_von, geaendert_von) \
         VALUES (?, 1, 'erfasst', 'Mustermann', 'Hauptstraße 1', 'stabil', ?, ?)",
    )
    .bind(e.id)
    .bind(leit)
    .bind(leit)
    .execute(pool)
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
    abschliessen(pool, e.id, leit).await.unwrap();
    sqlx::query(
        "UPDATE einsatz SET retention_bis = NULL, \
            nachbereitung_bis = datetime('now', '-1 day') WHERE id = ?",
    )
    .bind(e.id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("DELETE FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = ?")
        .bind(e.id)
        .execute(pool)
        .await
        .unwrap();
    e.id
}

async fn frist(pool: &SqlitePool, id: i64, kategorie: K, tage: i64) {
    sqlx::query(
        "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
            rechtsgrundlage) VALUES (?, ?, datetime('now', ? || ' days'), 'Gesetz')",
    )
    .bind(id)
    .bind(kategorie.as_str())
    .bind(tage)
    .execute(pool)
    .await
    .unwrap();
}

/// Entschlüsselt einen Block und öffnet ihn als Datenbank.
async fn oeffne_block(
    inhalt: &[u8],
    schluessel: &age::x25519::Identity,
) -> (tempfile::TempDir, SqlitePool) {
    let d = age::Decryptor::new(inhalt).unwrap();
    let mut r = d
        .decrypt(std::iter::once(schluessel as &dyn age::Identity))
        .unwrap();
    let mut klar = Vec::new();
    r.read_to_end(&mut klar).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let pfad = dir.path().join("block.sqlite");
    std::fs::write(&pfad, klar).unwrap();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&pfad))
        .await
        .unwrap();
    (dir, pool)
}

async fn bloecke(pool: &SqlitePool, id: i64) -> Vec<(i64, Option<String>, Vec<u8>, String)> {
    sqlx::query_as(
        "SELECT block, gueltig_bis, inhalt, sha256 FROM einsatz_archiv \
         WHERE einsatz_id = ? ORDER BY block",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap()
}

type Person = (Option<String>, Option<String>, Option<String>);

async fn person(pool: &SqlitePool) -> Person {
    sqlx::query_as("SELECT name, herkunft_adresse, zustand FROM einsatz_person")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn archiv_mit_gestaffelten_bloecken_und_geschwaerztem_klartext() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let schluessel = schluessel(&pool).await;
    let id = einsatz(&pool, leit).await;
    frist(&pool, id, K::Personenauskunft, 60).await;
    frist(&pool, id, K::Behandlung, 3650).await;

    assert_eq!(
        faellige(&pool, &crate::zeit::jetzt()).await.unwrap(),
        vec![id]
    );
    assert!(archivieren(&pool, id, Utc::now()).await.unwrap());

    // Am Hub: geschwärzt, gesperrt, kein Klartext mehr.
    let (geloescht, geschwaerzt): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(geloescht.is_some() && geschwaerzt.is_some());
    assert_eq!(person(&pool).await, (None, None, None));
    let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(anhaenge, 0, "der Nachlauf löscht die Anhänge");
    let etb: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(etb.contains("archiviert in 3 Blöcken"), "{etb}");

    // Drei Blöcke: alles, ohne Personenauskunft, ohne beides.
    let b = bloecke(&pool, id).await;
    assert_eq!(b.len(), 3);
    assert!(b[0].1.is_some() && b[1].1.is_some() && b[2].1.is_none());
    for (_, _, inhalt, sha) in &b {
        assert!(inhalt.starts_with(crate::backup::verschluesselung::AGE_KOPF));
        assert!(!inhalt.windows(10).any(|w| w == b"Mustermann"));
        assert_eq!(sha.len(), 64);
    }
    let (_d1, b1) = oeffne_block(&b[0].2, &schluessel).await;
    assert_eq!(
        person(&b1).await,
        (
            Some("Mustermann".into()),
            Some("Hauptstraße 1".into()),
            Some("stabil".into())
        )
    );
    let anhang: Vec<u8> = sqlx::query_scalar("SELECT daten FROM anhang")
        .fetch_one(&b1)
        .await
        .unwrap();
    assert_eq!(anhang, b"ABC");
    let (_d2, b2) = oeffne_block(&b[1].2, &schluessel).await;
    let (name, herkunft, zustand) = person(&b2).await;
    assert_eq!(name.as_deref(), Some("Mustermann"));
    assert_ne!(herkunft.as_deref(), Some("Hauptstraße 1"));
    assert_eq!(zustand.as_deref(), Some("stabil"));
    let (_d3, b3) = oeffne_block(&b[2].2, &schluessel).await;
    let (name, herkunft, zustand) = person(&b3).await;
    assert_ne!(
        name.as_deref(),
        Some("Mustermann"),
        "Personenstamm mit beiden Kategorien weg"
    );
    assert_ne!(herkunft.as_deref(), Some("Hauptstraße 1"));
    assert_ne!(zustand.as_deref(), Some("stabil"));

    // Konten ohne Anmeldedaten; der Kopf und die Migrationen sind dabei.
    let (hash, totp, aktiv): (String, Option<String>, i64) =
        sqlx::query_as("SELECT passwort_hash, totp_secret, aktiv FROM benutzer WHERE id = ?")
            .bind(leit)
            .fetch_one(&b1)
            .await
            .unwrap();
    assert_eq!((hash.as_str(), totp, aktiv), ("", None, 0));
    let kopf: String = sqlx::query_scalar("SELECT bezeichnung FROM einsatz WHERE id = ?")
        .bind(id)
        .fetch_one(&b1)
        .await
        .unwrap();
    assert_eq!(kopf, "Hochwasser");
    let migrationen = "SELECT COUNT(*), MAX(version) FROM _sqlx_migrations";
    let im_archiv: (i64, i64) = sqlx::query_as(migrationen).fetch_one(&b1).await.unwrap();
    let am_hub: (i64, i64) = sqlx::query_as(migrationen).fetch_one(&pool).await.unwrap();
    assert_eq!(im_archiv, am_hub);

    // Ein zweiter Lauf tut nichts.
    assert!(faellige(&pool, &crate::zeit::jetzt())
        .await
        .unwrap()
        .is_empty());
    assert!(!archivieren(&pool, id, Utc::now()).await.unwrap());
}

#[tokio::test]
async fn ohne_gepruefte_schluessel_oder_als_meldende_seite_kein_archiv() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    let id = einsatz(&pool, leit).await;
    let jetzt = crate::zeit::jetzt();
    assert!(
        faellige(&pool, &jetzt).await.unwrap().is_empty(),
        "kein Schlüssel"
    );
    sqlx::query(
        "INSERT INTO org_archiv_empfaenger (org_id, empfaenger, bezeichnung, fingerabdruck) \
         VALUES (1, ?, 'Ungeprüft', 'x')",
    )
    .bind(age::x25519::Identity::generate().to_public().to_string())
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        faellige(&pool, &jetzt).await.unwrap().is_empty(),
        "ungeprüft"
    );
    schluessel(&pool).await;
    assert_eq!(faellige(&pool, &jetzt).await.unwrap(), vec![id]);

    // Aufbewahrung endet vor jetzt: Phase A ist dran, nicht das Archiv.
    sqlx::query("UPDATE einsatz SET retention_bis = datetime('now', '-1 hour') WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(faellige(&pool, &jetzt).await.unwrap().is_empty());
    sqlx::query("UPDATE einsatz SET retention_bis = NULL WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();

    // Die Org meldet sich bei einem Hub: dort entsteht das Archiv.
    let kopplung: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (richtung, gegenueber_kennung, gegenueber_name, \
            gegenueber_schluessel, gegenueber_adresse, zustand) \
         VALUES ('meldet_sich', 'hub', 'Hub', 'schluessel', 'https://hub.example', 'aktiv') \
         RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
            fremde_org_name) VALUES (?, 1, 'o', 'O')",
    )
    .bind(kopplung)
    .execute(&pool)
    .await
    .unwrap();
    assert!(faellige(&pool, &jetzt).await.unwrap().is_empty());
}

#[tokio::test]
async fn abgelaufener_block_geht_und_der_naechste_gilt() {
    let pool = crate::db::test_pool().await;
    let leit = leitung(&pool).await;
    schluessel(&pool).await;
    let id = einsatz(&pool, leit).await;
    frist(&pool, id, K::Personenauskunft, 60).await;
    assert!(archivieren(&pool, id, Utc::now()).await.unwrap());
    let jetzt = crate::zeit::jetzt();
    let vorher = angabe(&pool, id, &jetzt).await.unwrap().unwrap();
    assert_eq!((vorher.block, vorher.bloecke), (1, 2));
    assert!(vorher.gueltig_bis.is_some());

    assert_eq!(
        abgelaufene_bloecke_loeschen(&pool, &jetzt).await.unwrap(),
        0
    );
    let spaeter = crate::zeit::formatiere_utc(Utc::now() + chrono::Duration::days(61));
    assert_eq!(
        abgelaufene_bloecke_loeschen(&pool, &spaeter).await.unwrap(),
        1
    );
    let danach = angabe(&pool, id, &spaeter).await.unwrap().unwrap();
    assert_eq!(
        (danach.block, danach.bloecke, danach.gueltig_bis),
        (2, 1, None)
    );
    let (block, inhalt) = gueltiger_block(&pool, id, &spaeter).await.unwrap().unwrap();
    assert_eq!(block, 2);
    assert!(inhalt.starts_with(crate::backup::verschluesselung::AGE_KOPF));
    let etb: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(etb.contains("Block 1"), "{etb}");
}

#[tokio::test]
async fn stamm_deckt_alle_verweise_und_spalten() {
    let pool = crate::db::test_pool().await;
    let stamm: std::collections::BTreeMap<&str, &[(&str, bauen::Stammspalte)]> =
        bauen::STAMM.iter().copied().collect();
    let einsatz: std::collections::BTreeSet<&str> = bauen::tabellen().collect();
    let mut verwiesen = std::collections::BTreeSet::new();
    for t in bauen::tabellen().chain(stamm.keys().copied()) {
        let eltern: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT \"table\" FROM pragma_foreign_key_list('{t}')"
        )))
        .fetch_all(&pool)
        .await
        .unwrap();
        for e in eltern {
            if !einsatz.contains(e.as_str()) {
                verwiesen.insert(e);
            }
        }
    }
    let bekannt: std::collections::BTreeSet<String> = stamm.keys().map(|s| s.to_string()).collect();
    assert_eq!(
        verwiesen, bekannt,
        "Verweise aus dem Archiv auf Tabellen außerhalb des Einsatzes: in STAMM einordnen"
    );
    for (t, spalten) in &stamm {
        let schema: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT name FROM pragma_table_info('{t}') ORDER BY cid"
        )))
        .fetch_all(&pool)
        .await
        .unwrap();
        let eingeordnet: Vec<String> = spalten.iter().map(|(s, _)| s.to_string()).collect();
        assert_eq!(schema, eingeordnet, "{t}: jede Spalte in STAMM einordnen");
    }
}
