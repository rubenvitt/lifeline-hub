//! Löschersuchen für eine Person im Archiv (LLH-1712, Spec `aufbewahrung-loeschersuchen`,
//! „Vollzug eines Personen-Antrags im Archiv“, „Alte Blöcke nach dem Vollzug im Archiv“, „Spur
//! des Vollzugs im Archiv“).

use super::*;
use crate::einsatz::archiv::tests::{leitung, schluessel};
use crate::einsatz::repo::{abschliessen, anlegen, NeuerEinsatzDaten};
use crate::einsatz::retention::Datenkategorie as K;
use age::secrecy::ExposeSecret;
use chrono::Duration;
use sha2::Digest;
use std::io::Read;

const FOTO: &[u8] = b"FOTO-VON-ERIKA-MUSTERMANN";

/// Ein archivierter Einsatz in zwei Blöcken (Personenauskunft endet nach 60 Tagen) mit der
/// Betroffenen R-001 „Erika Mustermann“ samt Foto und dem Nachbarn R-002 „Max Nachbar“.
pub(crate) struct Archiv {
    pub(crate) einsatz: i64,
    pub(crate) leit: i64,
    pub(crate) erika: i64,
    pub(crate) identitaet: age::x25519::Identity,
}

pub(crate) async fn archiv(pool: &SqlitePool) -> Archiv {
    let leit = leitung(pool).await;
    let identitaet = schluessel(pool).await;
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
    let erika: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, \
            melder_kontakt, notiz, erfasst_von, geaendert_von) \
         VALUES (?, 1, 'erfasst', 'Mustermann', 'Erika', '0171 2345678', 'Notiz zu Erika', ?, ?) \
         RETURNING id",
    )
    .bind(e.id)
    .bind(leit)
    .bind(leit)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, \
            melder_kontakt, erfasst_von, geaendert_von) \
         VALUES (?, 2, 'erfasst', 'Nachbar', 'Max', '0160 1111111', ?, ?)",
    )
    .bind(e.id)
    .bind(leit)
    .bind(leit)
    .execute(pool)
    .await
    .unwrap();
    let anhang: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'erika.jpg', 'image/jpeg', ?, ?, ?, ?) RETURNING id",
    )
    .bind(e.id)
    .bind(FOTO.len() as i64)
    .bind(
        sha2::Sha256::digest(FOTO)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
    )
    .bind(FOTO)
    .bind(leit)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_person_anhang (einsatz_id, person_id, anhang_id, abgelegt_von_id) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(e.id)
    .bind(erika)
    .bind(anhang)
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
    sqlx::query(
        "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
            rechtsgrundlage) VALUES (?, ?, datetime('now', '60 days'), 'Gesetz')",
    )
    .bind(e.id)
    .bind(K::Personenauskunft.as_str())
    .execute(pool)
    .await
    .unwrap();
    assert!(super::super::archivieren(pool, e.id, Utc::now())
        .await
        .unwrap());
    Archiv {
        einsatz: e.id,
        leit,
        erika,
        identitaet,
    }
}

/// Ein Antrag für Erika, gestellt vor `stunden` Stunden (fällig nach 24).
async fn antrag(pool: &SqlitePool, a: &Archiv, stunden: i64) -> i64 {
    let gestellt = Utc::now() - Duration::hours(stunden);
    sqlx::query_scalar(
        "INSERT INTO schwaerzung_antrag (einsatz_id, ziel_art, ziel_id, aktenzeichen, \
            beantragt_von, beantragt_at, faellig_at) \
         VALUES (?, 'betroffene', ?, 'DS-2026-014', ?, ?, ?) RETURNING id",
    )
    .bind(a.einsatz)
    .bind(a.erika)
    .bind(a.leit)
    .bind(crate::zeit::formatiere_utc(gestellt))
    .bind(crate::zeit::formatiere_utc(gestellt + Duration::hours(24)))
    .fetch_one(pool)
    .await
    .unwrap()
}

pub(crate) fn schluessel_von(id: &age::x25519::Identity) -> Schluessel {
    Schluessel::laden(
        format!("{}\n", id.to_string().expose_secret()).into_bytes(),
        None,
        || panic!("keine Passphrase"),
    )
    .unwrap()
}

type Blockzeile = (i64, Option<String>, String, Vec<u8>, String);

async fn bloecke(pool: &SqlitePool, e: i64) -> Vec<Blockzeile> {
    sqlx::query_as(
        "SELECT block, gueltig_bis, sha256, inhalt, empfaenger_fingerabdruecke \
         FROM einsatz_archiv WHERE einsatz_id = ? ORDER BY block",
    )
    .bind(e)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn klartext(inhalt: &[u8], id: &age::x25519::Identity) -> Vec<u8> {
    let d = age::Decryptor::new(inhalt).unwrap();
    let mut r = d
        .decrypt(std::iter::once(id as &dyn age::Identity))
        .unwrap();
    let mut klar = Vec::new();
    r.read_to_end(&mut klar).unwrap();
    klar
}

fn enthaelt(heu: &[u8], nadel: &[u8]) -> bool {
    heu.windows(nadel.len()).any(|w| w == nadel)
}

async fn offen(pool: &SqlitePool, antrag: i64) -> bool {
    sqlx::query_scalar(
        "SELECT vollzogen_at IS NULL AND zurueckgenommen_at IS NULL \
         FROM schwaerzung_antrag WHERE id = ?",
    )
    .bind(antrag)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn person_aus_allen_bloecken_entfernt_staffel_bleibt() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let vorher = bloecke(&pool, a.einsatz).await;
    assert_eq!(vorher.len(), 2);
    // Im ersten Block stehen Erika, ihre Kontakte und ihr Foto noch im Klartext.
    let klar = klartext(&vorher[0].3, &a.identitaet);
    assert!(enthaelt(&klar, b"Mustermann") && enthaelt(&klar, FOTO));

    let antrag = antrag(&pool, &a, 25).await;
    assert_eq!(
        faellige_einsaetze(&pool, Utc::now(), None).await.unwrap(),
        vec![a.einsatz]
    );
    let v = vollziehen(&pool, a.einsatz, &schluessel_von(&a.identitaet), Utc::now())
        .await
        .unwrap()
        .expect("vollzogen");
    assert_eq!(v.personen, vec!["R-001".to_string()]);
    assert_eq!(v.bloecke, 2);
    assert!(!offen(&pool, antrag).await);

    let nachher = bloecke(&pool, a.einsatz).await;
    assert_eq!(nachher.len(), 2);
    for (alt, neu) in vorher.iter().zip(&nachher) {
        assert_eq!((alt.0, &alt.1), (neu.0, &neu.1), "Nummer und Frist bleiben");
        assert_ne!(alt.2, neu.2, "neuer sha256");
        let klar = klartext(&neu.3, &a.identitaet);
        for wort in [
            b"Mustermann".as_slice(),
            b"Erika",
            b"0171 2345678",
            b"Notiz zu Erika",
            FOTO,
        ] {
            assert!(
                !enthaelt(&klar, wort),
                "Block {}: {}",
                neu.0,
                String::from_utf8_lossy(wort)
            );
        }
    }
    // Der Nachbar steht im ersten Block unverändert (im zweiten ist die Personenauskunft
    // schon nach Frist geschwärzt).
    let klar = klartext(&nachher[0].3, &a.identitaet);
    assert!(enthaelt(&klar, b"Nachbar") && enthaelt(&klar, b"0160 1111111"));
    assert!(faellige_einsaetze(&pool, Utc::now(), None)
        .await
        .unwrap()
        .is_empty());
}

/// `--org`: nur die Einsätze dieser Organisation (ein Schlüssel öffnet nur ihre Blöcke).
#[tokio::test]
async fn faellige_einsaetze_je_organisation() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    antrag(&pool, &a, 25).await;
    // Ein zweiter archivierter Einsatz, der Organisation 2 gehört.
    let b = archiv(&pool).await;
    antrag(&pool, &b, 25).await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Andere')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET org_id = 2 WHERE id = ?")
        .bind(b.einsatz)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        faellige_einsaetze(&pool, Utc::now(), Some(1))
            .await
            .unwrap(),
        vec![a.einsatz]
    );
    assert_eq!(
        faellige_einsaetze(&pool, Utc::now(), Some(2))
            .await
            .unwrap(),
        vec![b.einsatz]
    );
    assert_eq!(
        faellige_einsaetze(&pool, Utc::now(), None).await.unwrap(),
        vec![a.einsatz, b.einsatz]
    );
    assert!(faellige_einsaetze(&pool, Utc::now(), Some(3))
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn noch_nicht_faellig_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let antrag = antrag(&pool, &a, 23).await;
    let vorher = bloecke(&pool, a.einsatz).await;
    assert!(faellige_einsaetze(&pool, Utc::now(), None)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        vollziehen(&pool, a.einsatz, &schluessel_von(&a.identitaet), Utc::now())
            .await
            .unwrap(),
        None
    );
    assert!(offen(&pool, antrag).await);
    assert_eq!(bloecke(&pool, a.einsatz).await, vorher);
}

#[tokio::test]
async fn falscher_schluessel_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let antrag = antrag(&pool, &a, 25).await;
    let vorher = bloecke(&pool, a.einsatz).await;
    let fremd = age::x25519::Identity::generate();
    let e = vollziehen(&pool, a.einsatz, &schluessel_von(&fremd), Utc::now())
        .await
        .unwrap_err();
    assert!(
        matches!(e, AppError::Validation(ref m) if m.contains("passt nicht")),
        "{e:?}"
    );
    assert!(offen(&pool, antrag).await);
    assert_eq!(bloecke(&pool, a.einsatz).await, vorher);
}

#[tokio::test]
async fn ohne_gepruefte_schluessel_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let antrag = antrag(&pool, &a, 25).await;
    let vorher = bloecke(&pool, a.einsatz).await;
    sqlx::query("UPDATE org_archiv_empfaenger SET geprueft_at = NULL")
        .execute(&pool)
        .await
        .unwrap();
    let e = vollziehen(&pool, a.einsatz, &schluessel_von(&a.identitaet), Utc::now())
        .await
        .unwrap_err();
    assert!(
        matches!(e, AppError::Validation(ref m) if m.contains("geprüften")),
        "{e:?}"
    );
    assert!(offen(&pool, antrag).await);
    assert_eq!(bloecke(&pool, a.einsatz).await, vorher);
}

/// Ein neuer Schlüssel der Org: die Blöcke gehen an die geprüften von jetzt.
#[tokio::test]
async fn neu_verschluesselt_an_die_geprueften_schluessel() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    antrag(&pool, &a, 25).await;
    let neu = schluessel(&pool).await;
    vollziehen(&pool, a.einsatz, &schluessel_von(&a.identitaet), Utc::now())
        .await
        .unwrap()
        .expect("vollzogen");
    for b in bloecke(&pool, a.einsatz).await {
        klartext(&b.3, &neu);
        let fingerabdruecke: Vec<String> = serde_json::from_str(&b.4).unwrap();
        assert_eq!(fingerabdruecke.len(), 2);
    }
}

/// Ein zweiter Lauf hat den Antrag vollzogen, während dieser die Blöcke baute: die Ablage prüft
/// in ihrer Transaktion und ändert nichts, die Blöcke des zweiten Laufs bleiben.
#[tokio::test]
async fn parallel_vollzogen_waehrend_des_baus_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    antrag(&pool, &a, 25).await;
    let s = schluessel_von(&a.identitaet);
    let bau = neu_bauen(&pool, a.einsatz, &s, Utc::now())
        .await
        .unwrap()
        .expect("gebaut");
    vollziehen(&pool, a.einsatz, &s, Utc::now())
        .await
        .unwrap()
        .expect("der zweite Lauf vollzieht");
    let nach_dem_zweiten = bloecke(&pool, a.einsatz).await;
    assert_eq!(ablegen(&pool, bau).await.unwrap(), None);
    assert_eq!(bloecke(&pool, a.einsatz).await, nach_dem_zweiten);
    let spur: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM admin_audit WHERE aktion = 'archiv_person_geschwaerzt'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(spur, 1, "nur der zweite Lauf schreibt die Spur");
}

/// Phase N hat während des Baus einen abgelaufenen Block gelöscht: die Ablage erkennt das
/// abweichende Archiv, ändert nichts und lässt den Antrag offen.
#[tokio::test]
async fn archiv_geaendert_waehrend_des_baus_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let antrag = antrag(&pool, &a, 25).await;
    let bau = neu_bauen(&pool, a.einsatz, &schluessel_von(&a.identitaet), Utc::now())
        .await
        .unwrap()
        .expect("gebaut");
    sqlx::query("DELETE FROM einsatz_archiv WHERE einsatz_id = ? AND block = 1")
        .bind(a.einsatz)
        .execute(&pool)
        .await
        .unwrap();
    let rest = bloecke(&pool, a.einsatz).await;
    assert_eq!(ablegen(&pool, bau).await.unwrap(), None);
    assert!(offen(&pool, antrag).await);
    assert_eq!(bloecke(&pool, a.einsatz).await, rest);
}

/// Ein vorher heruntergeladener Block lässt sich hier nicht mehr einspielen; eine vorher
/// eingespielte Kopie wird zum Abräumen vorgemerkt.
#[tokio::test]
async fn alter_download_gesperrt_und_kopie_vorgemerkt() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let s = schluessel_von(&a.identitaet);
    let (_, alt) = super::super::gueltiger_block(&pool, a.einsatz, &crate::zeit::jetzt())
        .await
        .unwrap()
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let datei = dir.path().join("block.age");
    std::fs::write(&datei, &alt).unwrap();
    let kopie = super::super::einspielen::einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap();

    antrag(&pool, &a, 25).await;
    vollziehen(&pool, a.einsatz, &s, Utc::now())
        .await
        .unwrap()
        .expect("vollzogen");

    let vorgemerkt: Option<String> = sqlx::query_scalar(
        "SELECT gegenstelle FROM einsatz_abraeumen WHERE einsatz_id = ? AND art = 'spiegel'",
    )
    .bind(kopie.einsatz_id)
    .fetch_optional(&pool)
    .await
    .unwrap()
    .flatten();
    assert_eq!(
        vorgemerkt.as_deref(),
        Some(super::super::einspielen::GEGENSTELLE)
    );
    // Die Kopie geht, dann wird der alte Download erneut versucht.
    crate::einsatz::abraeumen::alle_vorgemerkten(&pool, &crate::live::LiveHub::new()).await;
    let e = super::super::einspielen::einspielen(&pool, &datei, &s, None, Utc::now())
        .await
        .unwrap_err();
    assert!(
        matches!(e, AppError::Validation(ref m) if m.contains("nicht mehr im Archiv")),
        "{e:?}"
    );
}

/// ETB-Eintrag und Admin-Spur, beide ohne Namen.
#[tokio::test]
async fn spur_ohne_namen() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    antrag(&pool, &a, 25).await;
    vollziehen(&pool, a.einsatz, &schluessel_von(&a.identitaet), Utc::now())
        .await
        .unwrap()
        .expect("vollzogen");
    let letzter: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr DESC LIMIT 1",
    )
    .bind(a.einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        letzter.contains("DS-2026-014")
            && letzter.contains("R-001")
            && letzter.contains("2 Blöcken"),
        "{letzter}"
    );
    let spur: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT aktion, ziel, COALESCE(detail, '') FROM admin_audit \
         WHERE aktion = 'archiv_person_geschwaerzt'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(spur.len(), 1, "{spur:?}");
    for text in [letzter.as_str(), &spur[0].1, &spur[0].2] {
        assert!(
            !text.contains("Erika") && !text.contains("Mustermann"),
            "{text}"
        );
    }
}
