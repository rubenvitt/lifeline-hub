//! Tests der Stadtfest-Lage und des Nebeneinanders zweier Lagen (LLH-1576, Spec `demo-daten`,
//! „Zwei Demo-Lagen nebeneinander“ und „Lage Stadtfest“) gegen die voll migrierte DB.

use chrono::NaiveDateTime;
use sqlx::SqlitePool;

use super::entfernen::entfernen_tx;
use super::import::{importieren_tx, ImportErgebnis};
use super::szenario_stadtfest as stadtfest;
use super::test_hilfen::{admin_anlegen, anzahl, kataloge_seeden, org_anlegen};
use super::{DemoLage, DemoStammdatenArt};
use crate::error::AppError;

const JETZT: &str = "2026-07-04 21:00:00";
fn jetzt() -> NaiveDateTime {
    crate::zeit::parse(JETZT).unwrap()
}

fn zeit_vor(min: i64) -> String {
    crate::zeit::formatiere(jetzt() - chrono::Duration::minutes(min))
}

/// Org 1 mit den Katalogen des Bootstraps und einem System-Admin.
async fn org(pool: &SqlitePool) -> i64 {
    org_anlegen(pool, 1).await;
    kataloge_seeden(pool, 1).await;
    admin_anlegen(pool, 1).await
}

async fn importieren(
    pool: &SqlitePool,
    admin: i64,
    lage: DemoLage,
) -> Result<ImportErgebnis, AppError> {
    crate::write_retry!(pool, |conn| {
        importieren_tx(conn, 1, admin, lage, jetzt()).await
    })
}

async fn skalar<T>(pool: &SqlitePool, sql: &'static str, einsatz_id: i64) -> T
where
    T: Send + Unpin + for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite>,
{
    sqlx::query_scalar(sql)
        .bind(einsatz_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Kopfdaten, Abschnitte, Einheiten, UHS mit Grundriss, KTW: die Lage, die das Ticket verlangt.
#[tokio::test]
async fn stadtfest_legt_die_lage_des_tickets_an() {
    let pool = crate::db::test_pool().await;
    let admin = org(&pool).await;
    let erg = importieren(&pool, admin, DemoLage::Stadtfest)
        .await
        .expect("Import");
    let e = erg.einsatz_id;

    let (bezeichnung, einsatzart): (String, String) =
        sqlx::query_as("SELECT bezeichnung, einsatzart FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(bezeichnung, stadtfest::EINSATZ_BEZEICHNUNG);
    assert_eq!(einsatzart, crate::einsatz::EINSATZART_UEBUNG);

    let abschnitte: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM einsatzabschnitt WHERE einsatz_id = ? ORDER BY sortier",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(abschnitte, ["Bühne", "Eingang", "Festmeile"]);

    let streifen: i64 = skalar(
        &pool,
        "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND name LIKE 'Streife %'",
        e,
    )
    .await;
    assert_eq!(streifen, 2, "zwei Streifen");

    let plaetze: Vec<(String, Option<f64>, Option<f64>)> = sqlx::query_as(
        "SELECT p.bezeichnung, p.pos_x, p.pos_y FROM uhs_platz p JOIN uhs u ON u.id = p.uhs_id \
         WHERE u.einsatz_id = ? ORDER BY p.id",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(plaetze.len(), 6, "UHS mit Grundriss");
    assert!(plaetze.iter().all(|(_, x, y)| x.is_some() && y.is_some()));

    let ktw: i64 = skalar(
        &pool,
        "SELECT COUNT(*) FROM einsatz_fahrzeug ef JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE ef.einsatz_id = ? AND f.fahrzeugtyp = 'KTW'",
        e,
    )
    .await;
    assert_eq!(ktw, 1, "ein KTW");

    // Ohne Vorlage und ohne Schichtmodell, und der Einsatz bekommt keins (Org ohne Vorgabe).
    let zeile = |art| erg.bericht.je_art.iter().find(|z| z.art == art).unwrap();
    assert_eq!(zeile(DemoStammdatenArt::Fahrzeug).angelegt, 2);
    assert_eq!(zeile(DemoStammdatenArt::Personal).angelegt, 11);
    assert_eq!(zeile(DemoStammdatenArt::Material).angelegt, 3);
    assert_eq!(zeile(DemoStammdatenArt::EinheitVorlage).angelegt, 0);
    assert_eq!(zeile(DemoStammdatenArt::Schichtmodell).angelegt, 0);
    let mut conn = pool.acquire().await.unwrap();
    assert!(crate::schichtmodell::repo::load_einsatz_tx(&mut conn, e)
        .await
        .unwrap()
        .is_none());
}

/// 20 Kontakte über den Abend, jeder mit Anlass und versorgender Einheit, Zeiten aus dem
/// Drehbuch; der Verbleib mit den Angaben aus LLH-1568, darunter genau ein Transport über die
/// Leitstelle.
#[tokio::test]
async fn kontakte_tragen_anlass_einheit_und_verbleib() {
    let pool = crate::db::test_pool().await;
    let admin = org(&pool).await;
    let e = importieren(&pool, admin, DemoLage::Stadtfest)
        .await
        .expect("Import")
        .einsatz_id;

    let kontakte: i64 = skalar(
        &pool,
        "SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?",
        e,
    )
    .await;
    assert_eq!(kontakte, 20);
    let ohne: i64 = skalar(
        &pool,
        "SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ? \
         AND (anlass IS NULL OR versorgende_einheit_id IS NULL)",
        e,
    )
    .await;
    assert_eq!(ohne, 0, "jeder Kontakt mit Anlass und Einheit");

    // Erfassungszeit ist die Schrittzeit: der erste Kontakt liegt im Drehbuch bei T−232.
    let erster: String = skalar(
        &pool,
        "SELECT erfasst_at FROM einsatz_person WHERE einsatz_id = ? ORDER BY registrier_nr LIMIT 1",
        e,
    )
    .await;
    assert_eq!(erster, zeit_vor(232));

    // Aktueller Verbleib je Person (Cache) nach Art.
    let arten: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT aktuelle_verbleib_art, COUNT(*) FROM einsatz_person WHERE einsatz_id = ? \
         GROUP BY aktuelle_verbleib_art ORDER BY aktuelle_verbleib_art",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        arten,
        vec![
            (None, 4),
            (Some("entlassung".into()), 14),
            (Some("transport".into()), 2),
        ]
    );

    let leitstelle: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT transport_durch, leitstelle_einsatznummer FROM person_verbleib \
         WHERE einsatz_id = ? AND art = 'transport' AND transport_durch = 'fremd'",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        leitstelle,
        vec![(
            "fremd".into(),
            Some(stadtfest::LEITSTELLE_EINSATZNUMMER.into())
        )],
        "genau ein Transport über die Leitstelle"
    );

    let gegen_rat: Vec<(String, String)> = sqlx::query_as(
        "SELECT gegen_rat, unterschrift FROM person_verbleib \
         WHERE einsatz_id = ? AND gegen_rat IS NOT NULL",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(gegen_rat, vec![("behandlung".into(), "liegt_vor".into())]);

    let uebergeben: i64 = skalar(
        &pool,
        "SELECT COUNT(*) FROM person_verbleib WHERE einsatz_id = ? AND status = 'uebergeben' \
         AND transport_durch = 'eigen' AND einsatz_fahrzeug_id IS NOT NULL",
        e,
    )
    .await;
    assert_eq!(uebergeben, 1, "Eigentransport mit dem KTW übergeben");

    // Drei liegen noch auf Plätzen der UHS, sonst niemand in der UHS.
    let in_uhs: Vec<Option<i64>> = sqlx::query_scalar(
        "SELECT aktueller_platz_id FROM einsatz_person \
         WHERE einsatz_id = ? AND aktuelle_uhs_id IS NOT NULL",
    )
    .bind(e)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(in_uhs.len(), 3);
    assert!(
        in_uhs.iter().all(Option::is_some),
        "auf Plätzen: {in_uhs:?}"
    );

    // Der Austritt liegt zur Zeit des Verbleibs, nicht beim Import (Nachtrag D9).
    let austritt_beim_import: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM person_uhs_belegung WHERE einsatz_id = ? AND art = 'austritt' \
         AND zeitpunkt_at >= ?",
    )
    .bind(e)
    .bind(JETZT)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(austritt_beim_import, 0);

    // Das ETB nennt weder Anlass noch Einsatznummer (LLH-1566, LLH-1568).
    let verraeterisch: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? \
         AND (inhalt LIKE '%' || ? || '%' OR inhalt LIKE '%intox%' OR inhalt LIKE '%Allergie%')",
    )
    .bind(e)
    .bind(stadtfest::LEITSTELLE_EINSATZNUMMER)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(verraeterisch, 0);
}

/// Der erste Takt des Schedulers nach dem Import löst nichts aus (kein Alarm, D10).
#[tokio::test]
async fn kein_alarm_nach_dem_import() {
    let pool = crate::db::test_pool().await;
    let admin = org(&pool).await;
    let jetzt_uhr = chrono::Utc::now().naive_utc();
    crate::write_retry!(&pool, |conn| {
        importieren_tx(conn, 1, admin, DemoLage::Stadtfest, jetzt_uhr).await
    })
    .expect("Import");
    let live = crate::live::LiveHub::new();
    let ausgeloest =
        crate::erinnerung::scheduler::tick_einmal(&pool, &live, jetzt_uhr.and_utc()).await;
    assert_eq!(ausgeloest, 0);
}

/// Beide Lagen bestehen nebeneinander; dieselbe Lage zweimal ist 409; Entfernen trifft nur die
/// eigene Lage samt ihren Stammdaten.
#[tokio::test]
async fn beide_lagen_nebeneinander_entfernen_trifft_nur_die_eigene() {
    let pool = crate::db::test_pool().await;
    let admin = org(&pool).await;
    let starkregen = importieren(&pool, admin, DemoLage::Starkregen)
        .await
        .expect("Starkregen");
    let fest = importieren(&pool, admin, DemoLage::Stadtfest)
        .await
        .expect("Stadtfest neben Starkregen");
    assert_ne!(starkregen.einsatz_id, fest.einsatz_id);
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_import WHERE org_id = ? AND entfernt_at IS NULL",
            1
        )
        .await,
        2
    );

    match importieren(&pool, admin, DemoLage::Stadtfest).await {
        Err(AppError::Conflict(_)) => {}
        anders => panic!("409 erwartet, war {anders:?}"),
    }

    let etb_starkregen: i64 = skalar(
        &pool,
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
        starkregen.einsatz_id,
    )
    .await;
    let stamm_vorher = stamm_bild(&pool).await;

    crate::write_retry!(&pool, |conn| {
        entfernen_tx(conn, 1, DemoLage::Stadtfest).await
    })
    .expect("Stadtfest entfernen");

    let fest_einsatz: i64 = skalar(
        &pool,
        "SELECT COUNT(*) FROM einsatz WHERE id = ?",
        fest.einsatz_id,
    )
    .await;
    assert_eq!(fest_einsatz, 0, "Stadtfest-Einsatz gelöscht");
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE org_id = ? AND funkrufname LIKE 'Musterstadt 87-%'",
            1
        )
        .await,
        0,
        "Stadtfest-Fahrzeuge entfernt"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM personal WHERE org_id = ? AND personalnummer LIKE 'DEMO-S-%'",
            1
        )
        .await,
        0,
        "Stadtfest-Personal entfernt"
    );

    // Die Starkregen-Lage bleibt zeilengleich: Kopf aktiv, ETB gleich, Stammdaten samt Marke.
    let aktiv: Vec<String> = sqlx::query_scalar(
        "SELECT szenario FROM demo_import WHERE org_id = 1 AND entfernt_at IS NULL",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(aktiv, ["starkregen"]);
    assert_eq!(
        skalar::<i64>(
            &pool,
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            starkregen.einsatz_id,
        )
        .await,
        etb_starkregen
    );
    let stamm_nachher = stamm_bild(&pool).await;
    let ohne_stadtfest: Vec<_> = stamm_vorher
        .into_iter()
        .filter(|(_, kennung, _)| {
            !kennung.starts_with("Musterstadt 87-") && !kennung.starts_with("DEMO-S-")
        })
        .collect();
    assert_eq!(stamm_nachher, ohne_stadtfest);

    // Und die Starkregen-Lage lässt sich danach allein entfernen.
    crate::write_retry!(&pool, |conn| {
        entfernen_tx(conn, 1, DemoLage::Starkregen).await
    })
    .expect("Starkregen entfernen");
    match crate::write_retry!(&pool, |conn| {
        entfernen_tx(conn, 1, DemoLage::Starkregen).await
    }) {
        Err(AppError::Conflict(_)) => {}
        anders => panic!("409 erwartet, war {anders:?}"),
    }
}

/// LLH-1585: Die Lage bringt die Planung „Stadtfest Musterstadt“ mit (Samstag nach dem
/// Importtag, 10–24 Uhr): Kennzahlen aus derselben Prüfung, ein „doppelt“, eine Lücke, kein
/// Einsatz. Das Entfernen räumt sie vor dem Personal.
#[tokio::test]
async fn stadtfest_bringt_die_demo_planung_mit() {
    let pool = crate::db::test_pool().await;
    let admin = org(&pool).await;
    let erg = importieren(&pool, admin, DemoLage::Stadtfest)
        .await
        .expect("Import");
    let zeile = erg
        .bericht
        .je_art
        .iter()
        .find(|z| z.art == DemoStammdatenArt::Planung)
        .expect("Berichtszeile Planung");
    assert_eq!((zeile.angelegt, zeile.mitbenutzt), (1, 0));

    let id: i64 = sqlx::query_scalar("SELECT id FROM planung WHERE org_id = 1 AND bezeichnung = ?")
        .bind(stadtfest::PLANUNG_BEZEICHNUNG)
        .fetch_one(&pool)
        .await
        .unwrap();
    let p = crate::planung::repo::laden(&pool, 1, id).await.unwrap();
    // 4. Juli 2026 ist ein Samstag: die Planung liegt eine Woche später, in Sommerzeit.
    assert_eq!(p.kopf.von, "2026-07-11 08:00:00");
    assert_eq!(p.kopf.bis, "2026-07-11 22:00:00");
    assert_eq!(
        p.posten
            .iter()
            .map(|x| x.bezeichnung.as_str())
            .collect::<Vec<_>>(),
        [
            "UHS Marktplatz",
            "Streife 1",
            "Streife 2",
            "Sanitätswache Bühne",
            "KTW Musterstadt 87-85"
        ]
    );
    let ktw = &p.posten[4];
    assert!(ktw.fahrzeug_id.is_some());
    assert_eq!(ktw.soll_anzahl, Some(2), "Soll aus der Sollbesatzung");
    assert_eq!(p.helfer.len(), 2);
    assert_eq!(
        p.kennzahlen,
        crate::planung::PlanungKennzahlen {
            soll: 26,
            ist: 24,
            offen: 2,
            konflikte: 2,
        }
    );
    let doppelt: Vec<&str> = p
        .bloecke
        .iter()
        .flat_map(|b| b.personen.iter())
        .filter(|x| {
            x.befunde
                .iter()
                .any(|f| f.art == crate::abloesung::schichtplan::PlanBefundArt::Doppelt)
        })
        .map(|x| x.name.as_str())
        .collect();
    assert_eq!(doppelt, ["Mia Muster", "Mia Muster"]);
    assert!(
        p.bloecke
            .iter()
            .flat_map(|b| b
                .personen
                .iter()
                .flat_map(|x| x.befunde.iter())
                .chain(b.befunde.iter()))
            .all(|f| f.art == crate::abloesung::schichtplan::PlanBefundArt::Doppelt),
        "sonst kein Befund"
    );
    assert_eq!(
        anzahl(&pool, "SELECT COUNT(*) FROM einsatz WHERE org_id = ?", 1).await,
        1,
        "nur der Demo-Einsatz, die Planung ist keiner"
    );

    let bericht = crate::write_retry!(&pool, |conn| {
        entfernen_tx(conn, 1, DemoLage::Stadtfest).await
    })
    .expect("entfernen");
    let zeile = bericht
        .je_art
        .iter()
        .find(|z| z.art == DemoStammdatenArt::Planung)
        .unwrap();
    assert_eq!((zeile.entfernt, zeile.behalten), (1, 0));
    assert_eq!(
        anzahl(&pool, "SELECT COUNT(*) FROM planung WHERE org_id = ?", 1).await,
        0
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM personal WHERE org_id = ? AND personalnummer LIKE 'DEMO-S-%'",
            1
        )
        .await,
        0,
        "die Planung hält das Personal nicht fest"
    );
}

/// Stammdaten der Org mit Kennung und Marke: (Tabelle, Kennung, Import-Kopf der Marke).
async fn stamm_bild(pool: &SqlitePool) -> Vec<(String, String, Option<i64>)> {
    sqlx::query_as(
        "SELECT 'fahrzeug', f.funkrufname, dh.import_id FROM fahrzeug f \
         LEFT JOIN demo_herkunft dh ON dh.tabelle = 'fahrzeug' AND dh.datensatz_id = f.id \
         UNION ALL \
         SELECT 'personal', p.personalnummer, dh.import_id FROM personal p \
         LEFT JOIN demo_herkunft dh ON dh.tabelle = 'personal' AND dh.datensatz_id = p.id \
         UNION ALL \
         SELECT 'material', m.bestandsnummer, dh.import_id FROM material m \
         LEFT JOIN demo_herkunft dh ON dh.tabelle = 'material' AND dh.datensatz_id = m.id \
         ORDER BY 1, 2",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}
