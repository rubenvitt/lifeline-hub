//! Integrationstests „Stammdaten-Eingang“ (LLH-1633): Vorschau und Übernehmen über die
//! Datenbank. Die Regeln des Lesens und Abgleichs im Einzelnen prüfen
//! `stammdaten_eingang/datei.rs` und `abgleich.rs`; hier zählt, was in den Tabellen landet:
//! zweiter Lauf schreibt nichts, Org-Isolation, Erkennungsfelder nur über die Kennung,
//! Kollisionen als Zeilenfehler, Qualifikationen werden nur hinzugefügt.

use lifeline_hub::error::AppError;
use lifeline_hub::fahrzeug::repo::{self as fahrzeug_repo, FahrzeugDaten};
use lifeline_hub::personal::qualifikation_repo;
use lifeline_hub::personal::repo::{self as personal_repo, PersonalDaten};
use lifeline_hub::stammdaten_eingang::datei::lies_paket;
use lifeline_hub::stammdaten_eingang::repo::{
    uebernehmen, vorschau, Entscheidungen, QualiEntscheidung, QualiWahl, StammdatenVorschau,
    ZeilenEntscheidung, ZeilenErgebnis, ZeilenWahl,
};
use lifeline_hub::stammdaten_eingang::{DateiMeldung, StammdatenArt, StammdatenPaket};
use sqlx::SqlitePool;

mod common;

async fn pool() -> (SqlitePool, i64) {
    let (_app, pool) = common::setup_mit_pool().await;
    let org: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    (pool, org)
}

/// Mehrere CSV-Dateien (je eine Art) zu einem Paket.
fn paket(csvs: &[&str]) -> (StammdatenPaket, Vec<DateiMeldung>, Vec<String>) {
    let mut p = StammdatenPaket::default();
    let mut m = Vec::new();
    let mut n = Vec::new();
    for csv in csvs {
        let (pp, mm, nn) = lies_paket(csv.as_bytes()).unwrap();
        p.fahrzeuge.extend(pp.fahrzeuge);
        p.personal.extend(pp.personal);
        p.qualifikationen.extend(pp.qualifikationen);
        m.extend(mm);
        n.extend(nn);
    }
    (p, m, n)
}

async fn vor(
    pool: &SqlitePool,
    org: i64,
    csvs: &[&str],
    herkunft: Option<&str>,
    e: &Entscheidungen,
) -> StammdatenVorschau {
    let (p, m, n) = paket(csvs);
    vorschau(pool, org, &p, &m, &n, herkunft, e).await.unwrap()
}

async fn ueber(
    pool: &SqlitePool,
    org: i64,
    csvs: &[&str],
    herkunft: Option<&str>,
    e: &Entscheidungen,
) -> Result<
    (
        lifeline_hub::stammdaten_eingang::repo::StammdatenErgebnis,
        Vec<i64>,
    ),
    AppError,
> {
    let (p, m, n) = paket(csvs);
    uebernehmen(pool, org, &p, &m, &n, herkunft, e).await
}

fn keine() -> Entscheidungen {
    Entscheidungen::default()
}

fn wahl(art: StammdatenArt, zeile: u32, wahl: ZeilenWahl) -> Entscheidungen {
    Entscheidungen {
        zeilen: vec![ZeilenEntscheidung { art, zeile, wahl }],
        qualifikationen: vec![],
    }
}

async fn anzahl(pool: &SqlitePool, tabelle: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM {tabelle}"
    )))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn fz_spalte(pool: &SqlitePool, id: i64, spalte: &str) -> Option<String> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT {spalte} FROM fahrzeug WHERE id = ?"
    )))
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn fz_anlegen(pool: &SqlitePool, org: i64, fk: &str, opta: Option<&str>) -> i64 {
    fahrzeug_repo::anlegen(
        pool,
        org,
        FahrzeugDaten {
            funkrufname: fk,
            fahrzeugtyp: None,
            traegerorganisation: None,
            kennzeichen: None,
            opta,
            standort: None,
            fms_issi: None,
            sondersignal: false,
            tragenkapazitaet: None,
            staerke: None,
            bemerkung: None,
        },
    )
    .await
    .unwrap()
    .id
}

async fn person_anlegen(
    pool: &SqlitePool,
    org: i64,
    name: &str,
    pn: Option<&str>,
    q: &[i64],
) -> i64 {
    personal_repo::anlegen(
        pool,
        org,
        PersonalDaten {
            name,
            benutzer_id: None,
            personalnummer: pn,
            traegerorganisation: None,
            telefon: None,
            staerke_position: None,
            bemerkung: None,
        },
        q,
    )
    .await
    .unwrap()
    .id
}

async fn quali_ids(pool: &SqlitePool, personal_id: i64) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT qualifikation_id FROM personal_qualifikation WHERE personal_id = ? ORDER BY 1",
    )
    .bind(personal_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn quali_id(pool: &SqlitePool, org: i64, label: &str) -> Option<i64> {
    sqlx::query_scalar("SELECT id FROM qualifikation WHERE org_id = ? AND label = ?")
        .bind(org)
        .bind(label)
        .fetch_optional(pool)
        .await
        .unwrap()
}

async fn personal_id(pool: &SqlitePool, org: i64, name: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM personal WHERE org_id = ? AND name = ?")
        .bind(org)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

const FZ: &str = "Kennung;Funkrufname;OPTA;Kennzeichen;Standort\n\
                  fz-1;Florian 1;4-83-1;B-RK 1;Wache Nord\n\
                  fz-2;Florian 2;4-83-2;;Wache Süd\n";

const PERS: &str = "Kennung;Name;Personalnummer;Qualifikationen\n\
                    p-1;Meier, Anna;PN 1;\"Sanitäter;Fahrer\"\n\
                    p-2;Schulz, Bernd;PN 2;Sanitäter\n";

#[tokio::test]
async fn neu_angelegt_mit_kennung() {
    let (pool, org) = pool().await;
    let (erg, ids) = ueber(
        &pool,
        org,
        &[FZ, PERS],
        Some("Fahrzeugverwaltung"),
        &keine(),
    )
    .await
    .unwrap();
    assert_eq!(erg.zaehlung.fahrzeuge.neu, 2);
    assert_eq!(erg.zaehlung.personal.neu, 2);
    // „Sanitäter“ steht im Katalog der Org (Migration 0011), „Fahrer“ nicht.
    assert_eq!(erg.zaehlung.qualifikationen.neu, 1);
    assert_eq!(erg.zaehlung.qualifikationen.ergaenzt, 1);
    assert_eq!(ids.len(), 2);
    let zeilen: Vec<(String, String, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT herkunft, kennung, fahrzeug_id, personal_id FROM stammdaten_kennung \
         WHERE org_id = ? AND qualifikation_id IS NULL ORDER BY kennung",
    )
    .bind(org)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen.len(), 4, "{zeilen:?}");
    assert_eq!(zeilen[0].0, "fahrzeugverwaltung");
    assert_eq!(zeilen[0].1, "fz-1");
    assert!(ids.contains(&zeilen[0].2.unwrap()));
    assert_eq!(
        fz_spalte(&pool, zeilen[0].2.unwrap(), "opta")
            .await
            .as_deref(),
        Some("4-83-1")
    );
    let anna = personal_id(&pool, org, "Meier, Anna").await;
    assert_eq!(zeilen[2].3, Some(anna));
    assert_eq!(quali_ids(&pool, anna).await.len(), 2);
}

#[tokio::test]
async fn zweiter_lauf_unveraendert() {
    let (pool, org) = pool().await;
    ueber(&pool, org, &[FZ, PERS], Some("FV"), &keine())
        .await
        .unwrap();
    let vorher = (
        anzahl(&pool, "fahrzeug").await,
        anzahl(&pool, "personal").await,
        anzahl(&pool, "qualifikation").await,
        anzahl(&pool, "stammdaten_kennung").await,
        anzahl(&pool, "personal_qualifikation").await,
    );
    let v = vor(&pool, org, &[FZ, PERS], Some("FV"), &keine()).await;
    assert!(v.uebernehmbar);
    assert_eq!(v.herkunft_vorschlag.as_deref(), Some("fv"));
    assert!(
        v.zeilen
            .iter()
            .all(|z| z.ergebnis == ZeilenErgebnis::Unveraendert),
        "{:?}",
        v.zeilen
    );
    assert!(v
        .qualifikationen
        .iter()
        .all(|q| q.ergebnis == ZeilenErgebnis::Unveraendert));
    for z in [
        v.zaehlung.fahrzeuge,
        v.zaehlung.personal,
        v.zaehlung.qualifikationen,
    ] {
        assert_eq!(
            z.neu + z.ergaenzt + z.geaendert + z.fehler + z.ausgelassen,
            0,
            "{z:?}"
        );
    }
    assert_eq!(v.zaehlung.fahrzeuge.unveraendert, 2);
    assert_eq!(v.zaehlung.personal.unveraendert, 2);
    assert_eq!(v.zaehlung.qualifikationen.unveraendert, 2);
    let (erg, ids) = ueber(&pool, org, &[FZ, PERS], Some("FV"), &keine())
        .await
        .unwrap();
    assert_eq!(erg.zaehlung, v.zaehlung);
    assert!(ids.is_empty());
    let nachher = (
        anzahl(&pool, "fahrzeug").await,
        anzahl(&pool, "personal").await,
        anzahl(&pool, "qualifikation").await,
        anzahl(&pool, "stammdaten_kennung").await,
        anzahl(&pool, "personal_qualifikation").await,
    );
    assert_eq!(vorher, nachher);
}

#[tokio::test]
async fn luecke_gefuellt() {
    let (pool, org) = pool().await;
    let id = fz_anlegen(&pool, org, "Florian 1", None).await;
    let csv = "Funkrufname;Kennzeichen;OPTA\nFlorian 1;B-RK 1;4-83-1\n";
    let v = vor(&pool, org, &[csv], None, &keine()).await;
    assert_eq!(v.zeilen[0].ergebnis, ZeilenErgebnis::Gefunden);
    assert_eq!(v.zaehlung.fahrzeuge.ergaenzt, 1);
    let (_, ids) = ueber(&pool, org, &[csv], None, &keine()).await.unwrap();
    assert_eq!(ids, vec![id]);
    assert_eq!(
        fz_spalte(&pool, id, "kennzeichen").await.as_deref(),
        Some("B-RK 1")
    );
    assert_eq!(
        fz_spalte(&pool, id, "opta").await.as_deref(),
        Some("4-83-1")
    );
    assert_eq!(anzahl(&pool, "fahrzeug").await, 1);
}

#[tokio::test]
async fn abweichung_nur_mit_wahl() {
    let (pool, org) = pool().await;
    let id = fz_anlegen(&pool, org, "Florian 1", None).await;
    sqlx::query("UPDATE fahrzeug SET standort = 'Wache A' WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    let csv = "Funkrufname;Standort\nFlorian 1;Wache B\n";
    let v = vor(&pool, org, &[csv], None, &keine()).await;
    assert_eq!(v.zeilen[0].ergebnis, ZeilenErgebnis::Unveraendert);
    assert_eq!(v.zeilen[0].aenderungen.len(), 1);
    assert!(!v.zeilen[0].aenderungen[0].uebernommen);
    ueber(&pool, org, &[csv], None, &keine()).await.unwrap();
    assert_eq!(
        fz_spalte(&pool, id, "standort").await.as_deref(),
        Some("Wache A")
    );

    let e = wahl(StammdatenArt::Fahrzeug, 2, ZeilenWahl::DateiUebernehmen);
    let (erg, ids) = ueber(&pool, org, &[csv], None, &e).await.unwrap();
    assert_eq!(erg.zaehlung.fahrzeuge.geaendert, 1);
    assert_eq!(ids, vec![id]);
    assert_eq!(
        fz_spalte(&pool, id, "standort").await.as_deref(),
        Some("Wache B")
    );
}

#[tokio::test]
async fn erkennungsfeld_nur_bei_kennungstreffer() {
    let (pool, org) = pool().await;
    let id = fz_anlegen(&pool, org, "Florian 1", Some("4-83-1")).await;
    let csv = "Kennung;Funkrufname;OPTA;Standort\nfz-1;Florian 9;4-83-1;Wache B\n";
    let e = wahl(StammdatenArt::Fahrzeug, 2, ZeilenWahl::DateiUebernehmen);
    let v = vor(&pool, org, &[csv], Some("FV"), &e).await;
    let z = &v.zeilen[0];
    assert_eq!(z.grund.map(|g| g.as_str()), Some("opta"));
    let fk = z
        .aenderungen
        .iter()
        .find(|a| a.feld == "funkrufname")
        .unwrap();
    assert!(fk.erkennungsfeld && !fk.uebernommen);
    ueber(&pool, org, &[csv], Some("FV"), &e).await.unwrap();
    assert_eq!(
        fz_spalte(&pool, id, "funkrufname").await.as_deref(),
        Some("Florian 1")
    );
    assert_eq!(
        fz_spalte(&pool, id, "standort").await.as_deref(),
        Some("Wache B")
    );

    // Jetzt trägt das Fahrzeug die Kennung: ein Treffer über sie darf umbenennen.
    let v = vor(&pool, org, &[csv], Some("FV"), &e).await;
    assert_eq!(v.zeilen[0].grund.map(|g| g.as_str()), Some("kennung"));
    ueber(&pool, org, &[csv], Some("FV"), &e).await.unwrap();
    assert_eq!(
        fz_spalte(&pool, id, "funkrufname").await.as_deref(),
        Some("Florian 9")
    );
}

#[tokio::test]
async fn umbenennung_kollidiert_fehler() {
    let (pool, org) = pool().await;
    ueber(&pool, org, &[FZ], Some("FV"), &keine())
        .await
        .unwrap();
    let csv = "Kennung;Funkrufname\nfz-1;Florian 2\n";
    let v = vor(&pool, org, &[csv], Some("FV"), &keine()).await;
    assert!(v.uebernehmbar, "ohne Wahl keine Umbenennung, kein Fehler");
    let e = wahl(StammdatenArt::Fahrzeug, 2, ZeilenWahl::DateiUebernehmen);
    let v = vor(&pool, org, &[csv], Some("FV"), &e).await;
    assert_eq!(
        v.zeilen[0].ergebnis,
        ZeilenErgebnis::Fehler,
        "{:?}",
        v.zeilen[0]
    );
    assert!(!v.uebernehmbar);
    match ueber(&pool, org, &[csv], Some("FV"), &e).await {
        Err(AppError::Zeilen { zeilen, .. }) => assert_eq!(zeilen[0].id, 2),
        r => panic!("{r:?}"),
    }
    let namen: Vec<String> =
        sqlx::query_scalar("SELECT funkrufname FROM fahrzeug ORDER BY funkrufname")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(namen, vec!["Florian 1", "Florian 2"]);
}

#[tokio::test]
async fn von_hand_angelegtes_fahrzeug_wird_verknuepft() {
    let (pool, org) = pool().await;
    let id = fz_anlegen(&pool, org, "Florian 1", None).await;
    let csv = "Kennung;Funkrufname\nfz-1;Florian 1\n";
    let v = vor(&pool, org, &[csv], Some("FV"), &keine()).await;
    assert_eq!(v.zeilen[0].ergebnis, ZeilenErgebnis::Gefunden);
    assert_eq!(v.zaehlung.fahrzeuge.ergaenzt, 1);
    ueber(&pool, org, &[csv], Some("FV"), &keine())
        .await
        .unwrap();
    assert_eq!(anzahl(&pool, "fahrzeug").await, 1);
    let ziel: i64 = sqlx::query_scalar(
        "SELECT fahrzeug_id FROM stammdaten_kennung WHERE org_id = ? AND herkunft = 'fv' AND kennung = 'fz-1'",
    )
    .bind(org)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(ziel, id);
    let v = vor(&pool, org, &[csv], Some("FV"), &keine()).await;
    assert_eq!(v.zeilen[0].ergebnis, ZeilenErgebnis::Unveraendert);
}

#[tokio::test]
async fn fremde_org_nie_getroffen() {
    let (pool, org) = pool().await;
    let (fremd, _) =
        common::fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw123", "keine").await;
    let fz = fz_anlegen(&pool, fremd, "Florian 1", Some("4-83-1")).await;
    let fz2 = fz_anlegen(&pool, fremd, "Florian 2", Some("4-83-2")).await;
    let p = person_anlegen(&pool, fremd, "Meier, Anna", Some("PN 1"), &[]).await;
    let p2 = person_anlegen(&pool, fremd, "Schulz, Bernd", Some("PN 2"), &[]).await;
    let q = qualifikation_repo::anlegen(&pool, fremd, "Fahrer", 10)
        .await
        .unwrap()
        .id;
    // Kennung der fremden Org, und eine verirrte Zeile unter der eigenen Org, die auf ein
    // fremdes Ziel zeigt: beide dürfen nie treffen.
    for (o, spalte, id, k) in [
        (fremd, "fahrzeug_id", fz, "fz-1"),
        (org, "fahrzeug_id", fz2, "fz-2"),
        (fremd, "personal_id", p, "p-1"),
        (org, "personal_id", p2, "p-2"),
        (fremd, "qualifikation_id", q, "fahrer"),
        (org, "qualifikation_id", q, "sanitäter"),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "INSERT INTO stammdaten_kennung (org_id, herkunft, kennung, {spalte}, angelegt_at) \
             VALUES (?, 'fv', ?, ?, '2026-11-24 00:00:00')"
        )))
        .bind(o)
        .bind(k)
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
    }
    let v = vor(&pool, org, &[FZ, PERS], Some("FV"), &keine()).await;
    assert!(
        v.zeilen.iter().all(|z| z.ergebnis == ZeilenErgebnis::Neu),
        "{:?}",
        v.zeilen
    );
    // Die verirrte Zeile belegt den Schlüssel: kein 500, die Kennung wird nur nicht gemerkt.
    let fz2_zeile = v.zeilen.iter().find(|z| z.anzeige == "Florian 2").unwrap();
    assert!(!fz2_zeile.hinweise.is_empty());
    let fahrer = v
        .qualifikationen
        .iter()
        .find(|q| q.text == "Fahrer")
        .unwrap();
    assert_eq!(fahrer.ergebnis, ZeilenErgebnis::Neu);
    let san = v
        .qualifikationen
        .iter()
        .find(|q| q.text == "Sanitäter")
        .unwrap();
    assert_eq!(
        san.grund.map(|g| g.as_str()),
        Some("bezeichnung"),
        "{san:?}"
    );
    assert_ne!(san.kandidaten[0].id, q);
    ueber(&pool, org, &[FZ, PERS], Some("FV"), &keine())
        .await
        .unwrap();
    assert_eq!(fz_spalte(&pool, fz, "standort").await, None);
    assert_eq!(fz_spalte(&pool, fz2, "standort").await, None);
    let fremd_fz: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fahrzeug WHERE org_id = ?")
        .bind(fremd)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fremd_fz, 2);
    assert!(quali_ids(&pool, p).await.is_empty());
    assert!(quali_id(&pool, org, "Fahrer").await.is_some());
    let fremd_kennungen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM stammdaten_kennung WHERE org_id = ?")
            .bind(fremd)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fremd_kennungen, 3);
    let eigene_p = personal_id(&pool, org, "Meier, Anna").await;
    assert_ne!(eigene_p, p);
}

#[tokio::test]
async fn kandidat_fremder_org_validation() {
    let (pool, org) = pool().await;
    let (fremd, _) =
        common::fremde_org_anlegen(&pool, "Fremd", "fremd", "fremdpw123", "keine").await;
    fz_anlegen(&pool, org, "Florian 1", Some("A1")).await;
    fz_anlegen(&pool, org, "Florian 2", Some("a 1")).await;
    let fremd_fz = fz_anlegen(&pool, fremd, "Florian 3", Some("A1")).await;
    let csv = "Funkrufname;OPTA\nFlorian 3;A1\n";
    let v = vor(&pool, org, &[csv], None, &keine()).await;
    assert_eq!(v.zeilen[0].ergebnis, ZeilenErgebnis::Mehrdeutig);
    assert_eq!(v.zeilen[0].kandidaten.len(), 2);
    assert!(!v.uebernehmbar, "mehrdeutig ohne Wahl sperrt");
    let e = wahl(
        StammdatenArt::Fahrzeug,
        2,
        ZeilenWahl::Kandidat { id: fremd_fz },
    );
    let (p, m, n) = paket(&[csv]);
    let r = vorschau(&pool, org, &p, &m, &n, None, &e).await;
    assert!(matches!(r, Err(AppError::Validation(_))), "{r:?}");
    let r = uebernehmen(&pool, org, &p, &m, &n, None, &e).await;
    assert!(matches!(r, Err(AppError::Validation(_))), "{r:?}");

    let fremd_q = qualifikation_repo::anlegen(&pool, fremd, "Taucher", 1)
        .await
        .unwrap()
        .id;
    let e = Entscheidungen {
        zeilen: vec![],
        qualifikationen: vec![QualiEntscheidung {
            text: "Taucher".into(),
            wahl: QualiWahl::Zuordnen {
                qualifikation_id: fremd_q,
            },
        }],
    };
    let (p, m, n) = paket(&["Name;Qualifikationen\nMeier, Anna;Taucher\n"]);
    let r = vorschau(&pool, org, &p, &m, &n, None, &e).await;
    assert!(matches!(r, Err(AppError::Validation(_))), "{r:?}");
}

#[tokio::test]
async fn quali_neu_standard() {
    let (pool, org) = pool().await;
    let csv = "Kennung;Name;Qualifikationen\np-1;Meier, Anna;Atemschutz\n";
    let v = vor(&pool, org, &[csv], Some("MV"), &keine()).await;
    assert!(v.uebernehmbar);
    assert_eq!(v.qualifikationen.len(), 1);
    assert_eq!(v.qualifikationen[0].ergebnis, ZeilenErgebnis::Neu);
    assert_eq!(v.qualifikationen[0].wahl, Some(QualiWahl::Neu));
    let (erg, _) = ueber(&pool, org, &[csv], Some("MV"), &keine())
        .await
        .unwrap();
    assert_eq!(erg.zaehlung.qualifikationen.neu, 1);
    let q = quali_id(&pool, org, "Atemschutz").await.unwrap();
    let anna = personal_id(&pool, org, "Meier, Anna").await;
    assert_eq!(quali_ids(&pool, anna).await, vec![q]);
}

#[tokio::test]
async fn quali_zuordnung_gemerkt() {
    let (pool, org) = pool().await;
    let san = quali_id(&pool, org, "Sanitäter").await.unwrap();
    let csv = "Kennung;Name;Qualifikationen\np-1;Meier, Anna;San-A\n";
    let e = Entscheidungen {
        zeilen: vec![],
        qualifikationen: vec![QualiEntscheidung {
            text: "San-A".into(),
            wahl: QualiWahl::Zuordnen {
                qualifikation_id: san,
            },
        }],
    };
    ueber(&pool, org, &[csv], Some("MV"), &e).await.unwrap();
    assert!(quali_id(&pool, org, "San-A").await.is_none());
    let anna = personal_id(&pool, org, "Meier, Anna").await;
    assert_eq!(quali_ids(&pool, anna).await, vec![san]);

    // Zweiter Lauf ohne Entscheidung: die Zuordnung greift, nichts ist offen.
    let csv2 = "Kennung;Name;Qualifikationen\np-1;Meier, Anna;San-A\np-2;Schulz, Bernd;san-a\n";
    let v = vor(&pool, org, &[csv2], Some("MV"), &keine()).await;
    assert!(v.uebernehmbar);
    assert_eq!(v.qualifikationen.len(), 1);
    assert_eq!(v.qualifikationen[0].ergebnis, ZeilenErgebnis::Unveraendert);
    assert_eq!(
        v.qualifikationen[0].grund.map(|g| g.as_str()),
        Some("kennung")
    );
    ueber(&pool, org, &[csv2], Some("MV"), &keine())
        .await
        .unwrap();
    let bernd = personal_id(&pool, org, "Schulz, Bernd").await;
    assert_eq!(quali_ids(&pool, bernd).await, vec![san]);
    assert!(quali_id(&pool, org, "San-A").await.is_none());
}

#[tokio::test]
async fn quali_nie_entfernt() {
    let (pool, org) = pool().await;
    let alt = qualifikation_repo::anlegen(&pool, org, "Fahrer", 10)
        .await
        .unwrap()
        .id;
    let neu = quali_id(&pool, org, "Sanitäter").await.unwrap();
    let anna = person_anlegen(&pool, org, "Meier, Anna", None, &[alt]).await;
    let csv = "Name;Qualifikationen\nMeier, Anna;Sanitäter\n";
    let v = vor(&pool, org, &[csv], None, &keine()).await;
    assert_eq!(v.zeilen[0].ergebnis, ZeilenErgebnis::Gefunden);
    let (erg, _) = ueber(&pool, org, &[csv], None, &keine()).await.unwrap();
    assert_eq!(erg.zaehlung.personal.ergaenzt, 1);
    let mut erwartet = vec![alt, neu];
    erwartet.sort();
    assert_eq!(quali_ids(&pool, anna).await, erwartet);
    // Ohne Qualifikationen in der Datei bleibt alles.
    ueber(&pool, org, &["Name\nMeier, Anna\n"], None, &keine())
        .await
        .unwrap();
    assert_eq!(quali_ids(&pool, anna).await, erwartet);
}

#[tokio::test]
async fn ausser_dienst_ausgelassen() {
    let (pool, org) = pool().await;
    ueber(&pool, org, &[FZ], Some("FV"), &keine())
        .await
        .unwrap();
    sqlx::query(
        "UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE funkrufname = 'Florian 1'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let csv = "Kennung;Funkrufname;Standort\nfz-1;Florian 1;Wache West\n";
    let v = vor(&pool, org, &[csv], Some("FV"), &keine()).await;
    assert_eq!(v.zeilen[0].ergebnis, ZeilenErgebnis::AusserDienst);
    assert!(!v.zeilen[0].hinweise.is_empty());
    assert!(v.uebernehmbar);
    let (erg, ids) = ueber(&pool, org, &[csv], Some("FV"), &keine())
        .await
        .unwrap();
    assert_eq!(erg.zaehlung.fahrzeuge.ausgelassen, 1);
    assert!(ids.is_empty());
    assert_eq!(anzahl(&pool, "fahrzeug").await, 2);
    let standort: Option<String> =
        sqlx::query_scalar("SELECT standort FROM fahrzeug WHERE funkrufname = 'Florian 1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(standort.as_deref(), Some("Wache Nord"));
}

#[tokio::test]
async fn fehler_blockiert_alles() {
    let (pool, org) = pool().await;
    let katalog = anzahl(&pool, "qualifikation").await;
    let csv = "Kennung;Funkrufname\nfz-1;Florian 1\nfz-1;Florian 2\nfz-3;Florian 3\n";
    let v = vor(&pool, org, &[csv, PERS], Some("FV"), &keine()).await;
    assert!(!v.uebernehmbar);
    assert_eq!(v.zaehlung.fahrzeuge.fehler, 2);
    match ueber(&pool, org, &[csv, PERS], Some("FV"), &keine()).await {
        Err(AppError::Zeilen { zeilen, .. }) => {
            assert_eq!(zeilen.iter().map(|z| z.id).collect::<Vec<_>>(), vec![2, 3])
        }
        r => panic!("{r:?}"),
    }
    for t in ["fahrzeug", "personal", "stammdaten_kennung"] {
        assert_eq!(anzahl(&pool, t).await, 0, "{t}");
    }
    assert_eq!(anzahl(&pool, "qualifikation").await, katalog);
    // Eine Fehlerzeile beim Lesen sperrt ebenso.
    let csv = "Funkrufname;Standort\n;Wache\nFlorian 1;Wache\n";
    assert!(ueber(&pool, org, &[csv], None, &keine()).await.is_err());
    assert_eq!(anzahl(&pool, "fahrzeug").await, 0);
}

#[tokio::test]
async fn kennung_ohne_herkunft_nicht_uebernehmbar() {
    let (pool, org) = pool().await;
    let v = vor(&pool, org, &[FZ], None, &keine()).await;
    assert!(v.herkunft_noetig);
    assert!(!v.uebernehmbar);
    let r = ueber(&pool, org, &[FZ], None, &keine()).await;
    assert!(matches!(r, Err(AppError::Validation(_))), "{r:?}");
    assert_eq!(anzahl(&pool, "fahrzeug").await, 0);
    // Herkunft aus der Spalte genügt.
    let csv = "Kennung;Herkunft;Funkrufname\nfz-1;FV;Florian 1\n";
    let v = vor(&pool, org, &[csv], None, &keine()).await;
    assert!(!v.herkunft_noetig && v.uebernehmbar);
}

#[tokio::test]
async fn vorschau_schreibt_nichts() {
    let (pool, org) = pool().await;
    let katalog = anzahl(&pool, "qualifikation").await;
    let v = vor(&pool, org, &[FZ, PERS], Some("FV"), &keine()).await;
    assert!(v.uebernehmbar);
    assert_eq!(v.zaehlung.fahrzeuge.neu, 2);
    assert_eq!(v.zaehlung.qualifikationen.neu, 1);
    for t in [
        "fahrzeug",
        "personal",
        "stammdaten_kennung",
        "personal_qualifikation",
    ] {
        assert_eq!(anzahl(&pool, t).await, 0, "{t}");
    }
    assert_eq!(anzahl(&pool, "qualifikation").await, katalog);
}

// ---------------------------------------------------------------------------------------------
// HTTP (LLH-1633, Task 6): Routen unter /api/master-data/import
// ---------------------------------------------------------------------------------------------

mod http {
    use super::{anzahl, FZ};
    use axum::http::StatusCode;
    use serde_json::{json, Value};

    use crate::common::{benutzer_anlegen, login_cookie, multipart_post, setup_mit_pool};

    const VORSCHAU: &str = "/api/master-data/import/preview";
    const IMPORT: &str = "/api/master-data/import";

    async fn start() -> (axum::Router, sqlx::SqlitePool, String) {
        let (app, pool) = setup_mit_pool().await;
        let admin = login_cookie(&app, "admin", "startpw12").await;
        (app, pool, admin)
    }

    async fn hochladen(
        app: &axum::Router,
        pfad: &str,
        cookie: &str,
        csv: &str,
        felder: &[(&str, &str)],
    ) -> (StatusCode, Value) {
        multipart_post(
            app,
            pfad,
            cookie,
            Some(("stamm.csv", csv.as_bytes())),
            felder,
        )
        .await
    }

    #[tokio::test]
    async fn preview_200_und_schreibt_nichts() {
        let (app, pool, admin) = start().await;
        let (s, v) = hochladen(
            &app,
            VORSCHAU,
            &admin,
            FZ,
            &[("herkunft", "Fahrzeugverwaltung")],
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(v["zaehlung"]["fahrzeuge"]["neu"], 2);
        assert_eq!(v["uebernehmbar"], true);
        assert_eq!(anzahl(&pool, "fahrzeug").await, 0);
        assert_eq!(anzahl(&pool, "stammdaten_kennung").await, 0);
    }

    #[tokio::test]
    async fn import_200_zaehlung() {
        let (app, pool, admin) = start().await;
        let (s, v) = hochladen(
            &app,
            IMPORT,
            &admin,
            FZ,
            &[("herkunft", "Fahrzeugverwaltung")],
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(v["zaehlung"]["fahrzeuge"]["neu"], 2);
        assert_eq!(anzahl(&pool, "fahrzeug").await, 2);
        // Zweiter Lauf: nichts mehr neu.
        let (s, v) = hochladen(
            &app,
            IMPORT,
            &admin,
            FZ,
            &[("herkunft", "Fahrzeugverwaltung")],
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(v["zaehlung"]["fahrzeuge"]["neu"], 0);
        assert_eq!(anzahl(&pool, "fahrzeug").await, 2);
    }

    #[tokio::test]
    async fn ohne_admin_403() {
        let (app, pool, admin) = start().await;
        benutzer_anlegen(&app, &admin, "frieda", "keine").await;
        let frieda = login_cookie(&app, "frieda", "friedapw1").await;
        for pfad in [VORSCHAU, IMPORT] {
            let (s, _) = hochladen(&app, pfad, &frieda, FZ, &[("herkunft", "FV")]).await;
            assert_eq!(s, StatusCode::FORBIDDEN, "{pfad}");
        }
        assert_eq!(anzahl(&pool, "fahrzeug").await, 0);
    }

    #[tokio::test]
    async fn org_am_hub_409() {
        let (app, pool, admin) = start().await;
        let org: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let kopplung: i64 = sqlx::query_scalar(
            "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, \
             gegenueber_name, richtung, gegenueber_adresse, zustand, art) VALUES ('hub-a', 'X', \
             'Hub Kreis', 'meldet_sich', 'https://hub.example', 'aktiv', 'standard') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
             fremde_org_name) VALUES (?, ?, 'hub-a/1', 'Kreis')",
        )
        .bind(kopplung)
        .bind(org)
        .execute(&pool)
        .await
        .unwrap();
        for pfad in [VORSCHAU, IMPORT] {
            let (s, _) = hochladen(&app, pfad, &admin, FZ, &[("herkunft", "FV")]).await;
            assert_eq!(s, StatusCode::CONFLICT, "{pfad}");
        }
        assert_eq!(anzahl(&pool, "fahrzeug").await, 0);
    }

    #[tokio::test]
    async fn unbekanntes_feld_400() {
        let (app, _pool, admin) = start().await;
        for pfad in [VORSCHAU, IMPORT] {
            let (s, _) = hochladen(&app, pfad, &admin, FZ, &[("irgendwas", "x")]).await;
            assert_eq!(s, StatusCode::BAD_REQUEST, "{pfad}");
        }
        let (s, _) = hochladen(&app, VORSCHAU, &admin, FZ, &[("entscheidungen", "{kaputt")]).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        let lang = "x".repeat(101);
        let (s, _) = hochladen(&app, VORSCHAU, &admin, FZ, &[("herkunft", &lang)]).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        let (s, _) = multipart_post(&app, VORSCHAU, &admin, None, &[("herkunft", "FV")]).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn unlesbar_400() {
        let (app, _pool, admin) = start().await;
        for pfad in [VORSCHAU, IMPORT] {
            let (s, _) = multipart_post(
                &app,
                pfad,
                &admin,
                Some(("x.xlsx", &[0u8, 1, 2, 3][..])),
                &[("herkunft", "FV")],
            )
            .await;
            assert_eq!(s, StatusCode::BAD_REQUEST, "{pfad}");
        }
        // Keine Herkunft nötig, aber keine genannt: Übernehmen ist 400, die Vorschau 200.
        let (s, v) = hochladen(&app, VORSCHAU, &admin, FZ, &[]).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(v["herkunft_noetig"], true);
        let (s, _) = hochladen(&app, IMPORT, &admin, FZ, &[]).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn nicht_uebernehmbar_422() {
        let (app, pool, admin) = start().await;
        // Zweimal derselbe Funkrufname in der Datei: Zeilenfehler.
        let csv = "Kennung;Funkrufname\nfz-1;Florian 1\nfz-2;Florian 1\n";
        let (s, v) = hochladen(&app, IMPORT, &admin, csv, &[("herkunft", "FV")]).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
        assert!(v["zeilen"].as_array().is_some_and(|z| !z.is_empty()), "{v}");
        assert_eq!(anzahl(&pool, "fahrzeug").await, 0);
    }

    #[tokio::test]
    async fn iban_wert_nicht_in_antwort() {
        let (app, _pool, admin) = start().await;
        let csv = "Name;IBAN\nMuster, Max;DE89370400440532013000\n";
        for pfad in [VORSCHAU, IMPORT] {
            let (s, v) = hochladen(&app, pfad, &admin, csv, &[("herkunft", "FV")]).await;
            assert_eq!(s, StatusCode::OK, "{pfad} {v}");
            let text = v.to_string();
            assert!(!text.contains("DE89370400440532013000"), "{text}");
            if pfad == VORSCHAU {
                assert_eq!(v["nicht_uebernommen"], json!(["IBAN"]));
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Musterdateien (Vertrag `docs/schnittstellen/stammdaten-datei.md`)
// ---------------------------------------------------------------------------------------------

const MUSTER_CSV: &[u8] = include_bytes!("../frontend/public/beispiele/stammdaten-beispiel.csv");
const MUSTER_XLSX: &[u8] = include_bytes!("../frontend/public/beispiele/stammdaten-beispiel.xlsx");

type Blatt = (&'static str, &'static [&'static [&'static str]]);

/// Inhalt der Muster-Excel-Datei: ein Blatt je Art. Quelle der Wahrheit für
/// `muster_xlsx_schreiben`; `muster_xlsx_entspricht_der_tabelle` hält die eingecheckte Datei daran.
const MUSTER_BLAETTER: &[Blatt] = &[
    (
        "Fahrzeuge",
        &[
            &[
                "kennung",
                "herkunft",
                "funkrufname",
                "kennzeichen",
                "opta",
                "issi",
                "typ",
                "standort",
            ],
            &[
                "fz-001",
                "Musterquelle",
                "RK Musterstadt 1/83-1",
                "MS-RK 101",
                "4-83-1",
                "1234501",
                "RTW",
                "Wache Nord",
            ],
            &[
                "fz-002",
                "Musterquelle",
                "RK Musterstadt 1/19-1",
                "MS-RK 102",
                "4-19-1",
                "1234502",
                "KTW",
                "Wache Nord",
            ],
            &[
                "fz-003",
                "Musterquelle",
                "RK Musterstadt 2/42-1",
                "MS-RK 201",
                "4-42-1",
                "1234503",
                "MTW",
                "Wache Süd",
            ],
        ],
    ),
    (
        "Personal",
        &[
            &[
                "kennung",
                "herkunft",
                "name",
                "personalnummer",
                "telefon",
                "traegerorganisation",
                "qualifikationen",
            ],
            &[
                "p-001",
                "Musterquelle",
                "Muster, Maria",
                "10001",
                "0151 00000001",
                "Musterverband",
                "q-san; q-fue",
            ],
            &[
                "p-002",
                "Musterquelle",
                "Beispiel, Bernd",
                "10002",
                "0151 00000002",
                "Musterverband",
                "q-san",
            ],
            &[
                "p-003",
                "Musterquelle",
                "Probe, Paula",
                "10003",
                "0151 00000003",
                "Musterverband",
                "q-fue",
            ],
        ],
    ),
    (
        "Qualifikationen",
        &[
            &["kennung", "herkunft", "bezeichnung"],
            &["q-san", "Musterquelle", "Sanitätshelfer (Muster)"],
            &["q-fue", "Musterquelle", "Gruppenführer (Muster)"],
        ],
    ),
];

fn muster_mappe() -> Vec<u8> {
    let mut wb = rust_xlsxwriter::Workbook::new();
    for (name, zeilen) in MUSTER_BLAETTER {
        let ws = wb.add_worksheet();
        ws.set_name(*name).unwrap();
        for (r, zeile) in zeilen.iter().enumerate() {
            for (c, text) in zeile.iter().enumerate() {
                ws.write_string(r as u32, c as u16, *text).unwrap();
            }
        }
    }
    wb.save_to_buffer().unwrap()
}

/// Schreibt `frontend/public/beispiele/stammdaten-beispiel.xlsx` neu:
/// `cargo test --test stammdaten_eingang muster_xlsx_schreiben -- --ignored`.
#[test]
#[ignore = "erzeugt die eingecheckte Muster-Excel-Datei"]
fn muster_xlsx_schreiben() {
    let ziel = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/frontend/public/beispiele/stammdaten-beispiel.xlsx"
    );
    std::fs::write(ziel, muster_mappe()).unwrap();
}

#[test]
fn muster_xlsx_entspricht_der_tabelle() {
    let (soll, _, _) = lies_paket(&muster_mappe()).unwrap();
    let (ist, _, _) = lies_paket(MUSTER_XLSX).unwrap();
    assert_eq!(
        format!("{soll:?}"),
        format!("{ist:?}"),
        "Datei veraltet: `muster_xlsx_schreiben` (siehe dort) neu laufen lassen"
    );
}

#[tokio::test]
async fn musterdateien_lesbar() {
    for (name, bytes, arten) in [
        ("CSV", MUSTER_CSV, (3, 0, 0)),
        ("XLSX", MUSTER_XLSX, (3, 3, 2)),
    ] {
        let (pool, org) = pool().await;
        let (p, m, n) = lies_paket(bytes).unwrap();
        assert_eq!(
            (p.fahrzeuge.len(), p.personal.len(), p.qualifikationen.len()),
            arten,
            "{name}"
        );
        let v = vorschau(&pool, org, &p, &m, &n, None, &keine())
            .await
            .unwrap();
        assert!(v.meldungen.is_empty(), "{name}: {:?}", v.meldungen);
        assert!(
            v.nicht_uebernommen.is_empty(),
            "{name}: {:?}",
            v.nicht_uebernommen
        );
        assert!(!v.herkunft_noetig, "{name}");
        assert!(v.uebernehmbar, "{name}: {v:?}");
        assert!(
            v.zeilen.iter().all(|z| z.ergebnis == ZeilenErgebnis::Neu),
            "{name}: {:?}",
            v.zeilen
        );
        // Zweiter Lauf: alles unverändert.
        uebernehmen(&pool, org, &p, &m, &n, None, &keine())
            .await
            .unwrap();
        let v2 = vorschau(&pool, org, &p, &m, &n, None, &keine())
            .await
            .unwrap();
        assert!(
            v2.zeilen
                .iter()
                .all(|z| z.ergebnis == ZeilenErgebnis::Unveraendert),
            "{name}: {:?}",
            v2.zeilen
        );
    }
}

/// Prüfstein (LLH-1633): kein Name der liefernden Anwendung im Code. Ganze Wörter, ohne Rücksicht
/// auf Groß-/Kleinschreibung.
#[test]
fn kein_herstellername_im_code() {
    const VERBOTEN: &[&str] = &["iuk", "hiorg", "divera", "fe2", "boswatch"];
    let wurzel = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut dateien: Vec<std::path::PathBuf> = Vec::new();
    fn sammle(pfad: &std::path::Path, aus: &mut Vec<std::path::PathBuf>) {
        if pfad.is_dir() {
            let mut eintraege: Vec<_> = std::fs::read_dir(pfad).unwrap().flatten().collect();
            eintraege.sort_by_key(|e| e.path());
            for e in eintraege {
                sammle(&e.path(), aus);
            }
        } else {
            aus.push(pfad.to_path_buf());
        }
    }
    for rel in [
        "src/stammdaten_eingang",
        "src/einlesen",
        "src/routes/stammdaten_eingang.rs",
    ] {
        sammle(&wurzel.join(rel), &mut dateien);
    }
    for rel in ["frontend/src/stammdaten"] {
        let mut alle = Vec::new();
        sammle(&wurzel.join(rel), &mut alle);
        dateien.extend(alle.into_iter().filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                n.starts_with("StammdatenEinlesen") || n.starts_with("StammdatenVorschau")
            })
        }));
    }
    for e in std::fs::read_dir(wurzel.join("migrations"))
        .unwrap()
        .flatten()
    {
        if e.file_name().to_string_lossy().starts_with("0373_") {
            dateien.push(e.path());
        }
    }
    dateien.push(wurzel.join("frontend/src/api/stammdatenEingang.ts"));
    dateien.push(wurzel.join("docs/schnittstellen/stammdaten-datei.md"));
    assert!(
        dateien.len() >= 10,
        "zu wenige Dateien gefunden: {dateien:?}"
    );
    for pfad in dateien {
        let text = std::fs::read_to_string(&pfad).unwrap().to_lowercase();
        for wort in text.split(|c: char| !c.is_alphanumeric()) {
            assert!(
                !VERBOTEN.contains(&wort),
                "{}: Herstellername „{wort}“",
                pfad.display()
            );
        }
    }
}
