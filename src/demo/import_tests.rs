//! Repo-Tests des Imports `importieren_tx` (LFH-690, design.md D5, D6, D8, D9) gegen die voll
//! migrierte DB. Die HTTP-Route kommt in Block 5; bis dahin laufen die Prüfungen aus dem Brief
//! hier über `importieren_tx`, wie der Aufrufer sie fährt: in `write_retry!`.
//!
//! Der Importzeitpunkt ist fest ([`JETZT`]), damit Schrittzeiten als Literale vergleichbar sind.

use std::collections::BTreeMap;

use chrono::NaiveDateTime;
use sqlx::SqlitePool;

use super::entfernen::entfernen_tx;
use super::import::{importieren_tx, ImportErgebnis};
use super::szenario::{self, EtbArt, Vorgang, DREHBUCH};
use super::test_hilfen::{
    admin_anlegen, anzahl, einsatz_anlegen, kataloge_seeden, org_anlegen, zeilen,
};
use super::{DemoBericht, DemoBerichtZeile, DemoStammdatenArt, DemoVorgang};
use crate::error::AppError;

// ---------------------------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------------------------

const JETZT: &str = "2026-09-25 12:00:00";
const ZEITFORMAT: &str = "%Y-%m-%d %H:%M:%S";

fn jetzt() -> NaiveDateTime {
    NaiveDateTime::parse_from_str(JETZT, ZEITFORMAT).unwrap()
}

fn zeit_vor(min: i64) -> String {
    (jetzt() - chrono::Duration::minutes(min))
        .format(ZEITFORMAT)
        .to_string()
}

struct Org {
    org: i64,
    admin: i64,
}

/// Org mit den Katalogen des Bootstraps und einem System-Admin, ohne Import.
async fn org_mit_admin(pool: &SqlitePool, org_id: i64) -> Org {
    org_anlegen(pool, org_id).await;
    kataloge_seeden(pool, org_id).await;
    let admin = admin_anlegen(pool, org_id).await;
    Org { org: org_id, admin }
}

/// Der Import so, wie die Route ihn fahren wird: eine `write_retry!`-Transaktion.
async fn importieren(
    pool: &SqlitePool,
    org: &Org,
    jetzt: NaiveDateTime,
) -> Result<ImportErgebnis, AppError> {
    crate::write_retry!(pool, |conn| {
        importieren_tx(conn, org.org, org.admin, jetzt).await
    })
}

/// Zeilenbild aller Tabellen, die ein Import beschreibt, instanzweit. `1 = ?` bindet den
/// einen Parameter, den `zeilen` verlangt.
async fn bild(pool: &SqlitePool) -> Vec<(&'static str, Vec<String>)> {
    let mut bild = Vec::new();
    for tabelle in [
        "einsatz",
        "einsatz_mitgliedschaft",
        "demo_import",
        "demo_herkunft",
        "fahrzeug",
        "personal",
        "personal_qualifikation",
        "material",
        "etb_eintrag",
        "einsatzabschnitt",
        "einsatz_einheit",
        "einsatz_fahrzeug",
        "einsatz_personal",
        "benutzer",
    ] {
        bild.push((tabelle, zeilen(pool, tabelle, "1 = ?", 1).await));
    }
    bild
}

/// ETB des Einsatzes nach `lfd_nr`: (lfd_nr, typ, inhalt, ereigniszeit, received_at).
async fn etb(pool: &SqlitePool, einsatz_id: i64) -> Vec<(i64, String, String, String, String)> {
    sqlx::query_as(
        "SELECT lfd_nr, typ, inhalt, ereigniszeit, received_at FROM etb_eintrag \
         WHERE einsatz_id = ? ORDER BY lfd_nr",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn erwarte_status(ergebnis: Result<ImportErgebnis, AppError>, status: u16, enthaelt: &str) {
    match ergebnis {
        Err(e) => {
            assert_eq!(e.status().as_u16(), status, "{e:?}");
            assert!(
                e.to_string().contains(enthaelt),
                "Meldung „{e}“ nennt nicht „{enthaelt}“"
            );
        }
        Ok(erg) => panic!("erwartet {status}, bekommen Ok({erg:?})"),
    }
}

/// Die ETB-Einträge, die das Drehbuch erzeugen muss, in Zeitfolge: (typ, inhalt, Schrittzeit).
/// Nachgerechnet aus den Daten und den Katalog-Startlisten, mit denselben Textfunktionen wie
/// Handler und Import; die Zahl und einzelne Wortlaute pinnt der Test daneben als Literal.
fn erwartete_etb() -> Vec<(String, String, String)> {
    let funkruf = |schluessel: &str| {
        szenario::FAHRZEUGE
            .iter()
            .find(|f| f.schluessel == schluessel)
            .unwrap()
            .funkrufname
    };
    let fms_label = |anker: i64| {
        crate::fahrzeug::STATUS_STARTLISTE
            .iter()
            .find(|(_, _, a, _)| *a == anker)
            .unwrap()
            .0
    };
    let erster_gebunden = crate::fahrzeug::STATUS_STARTLISTE
        .iter()
        .filter(|(_, k, _, _)| *k == crate::katalog::KATEGORIE_GEBUNDEN)
        .min_by_key(|(_, _, _, sortier)| *sortier)
        .unwrap()
        .0;
    let quali_sortier = |label: &str| {
        crate::personal::QUALIFIKATION_STARTLISTE
            .iter()
            .find(|(l, _)| *l == label)
            .unwrap()
            .1
    };

    let mut einheiten = BTreeMap::new();
    let mut status: BTreeMap<&str, &str> = BTreeMap::new();
    let mut erwartet = Vec::new();
    for schritt in DREHBUCH {
        let zeit = zeit_vor(schritt.vor_min);
        let mut system =
            |inhalt: String| erwartet.push(("system".to_string(), inhalt, zeit.clone()));
        match schritt.vorgang {
            Vorgang::Abschnitt(v) => system(crate::einsatzabschnitt::etb_text_angelegt(
                v.name,
                v.lagezustand,
            )),
            Vorgang::Einheit(v) => {
                einheiten.insert(v.schluessel, v.name);
                system(crate::einheit::etb_text_gebildet(v.name));
            }
            Vorgang::FahrzeugDisponieren { fahrzeug } => {
                status.insert(fahrzeug, erster_gebunden);
                system(crate::fahrzeug::etb_text_disponiert(funkruf(fahrzeug)));
            }
            Vorgang::FahrzeugZuEinheit { fahrzeug, einheit } => system(
                crate::einheit::etb_text_fahrzeug_zugeordnet(einheiten[einheit], funkruf(fahrzeug)),
            ),
            Vorgang::FmsStatus { fahrzeug, fms } => {
                let alt = status[fahrzeug];
                let neu = fms_label(fms);
                if alt != neu {
                    system(crate::fahrzeug::etb_text_status_wechsel(
                        funkruf(fahrzeug),
                        Some(alt),
                        Some(neu),
                    ));
                }
                status.insert(fahrzeug, neu);
            }
            Vorgang::PersonalDisponieren { personal } => {
                let p = szenario::PERSONAL
                    .iter()
                    .find(|p| p.schluessel == personal)
                    .unwrap();
                let mut qualis = p.qualifikationen.to_vec();
                qualis.sort_by_key(|q| quali_sortier(q));
                let funktion = qualis.join(", ");
                system(crate::personal::etb_text_disponiert(
                    p.name,
                    Some(&funktion),
                ));
            }
            Vorgang::Etb { art, inhalt, .. } => {
                erwartet.push((art.typ().to_string(), inhalt.to_string(), zeit.clone()))
            }
        }
    }
    erwartet
}

// ---------------------------------------------------------------------------------------------
// Einsatz, Kopf, Bericht
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn import_legt_den_uebungseinsatz_samt_kopf_und_bericht_an() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;

    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let (org, bezeichnung, einsatzart, stichwort, begonnen, status): (
        i64,
        String,
        String,
        Option<String>,
        String,
        String,
    ) = sqlx::query_as(
        "SELECT org_id, bezeichnung, einsatzart, stichwort, begonnen_at, status \
         FROM einsatz WHERE id = ?",
    )
    .bind(erg.einsatz_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(org, o.org);
    assert!(bezeichnung.starts_with("ÜBUNG – "), "{bezeichnung}");
    assert_eq!(bezeichnung, "ÜBUNG – Starkregen Musterstadt");
    assert_eq!(einsatzart, "uebung");
    assert_eq!(stichwort.as_deref(), Some("Unwetter – Starkregen"));
    assert_eq!(begonnen, "2026-09-25 07:00:00", "Beginn T−5 h");
    assert_eq!(status, "aktiv");

    let (kopf_org, kopf_einsatz, von, at, entfernt, json): (
        i64,
        i64,
        Option<i64>,
        String,
        Option<String>,
        String,
    ) = sqlx::query_as(
        "SELECT org_id, einsatz_id, importiert_von, importiert_at, entfernt_at, bericht \
         FROM demo_import WHERE id = ?",
    )
    .bind(erg.import_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kopf_org, o.org);
    assert_eq!(kopf_einsatz, erg.einsatz_id);
    assert_eq!(von, Some(o.admin));
    assert_eq!(at, JETZT);
    assert_eq!(entfernt, None);

    let zeile = |art, angelegt| DemoBerichtZeile {
        art,
        angelegt,
        mitbenutzt: 0,
        entfernt: 0,
        behalten: 0,
    };
    let erwartet = DemoBericht {
        vorgang: DemoVorgang::Importiert,
        zeitpunkt: JETZT.into(),
        je_art: vec![
            zeile(DemoStammdatenArt::Fahrzeug, 8),
            zeile(DemoStammdatenArt::Personal, 12),
            zeile(DemoStammdatenArt::Material, 4),
        ],
    };
    assert_eq!(erg.bericht, erwartet);
    assert_eq!(
        serde_json::from_str::<DemoBericht>(&json).unwrap(),
        erwartet,
        "gespeicherter Bericht == Rückgabe"
    );
}

/// Einzige Mitgliedschaft ist der Admin als Einsatzleitung; der Import legt kein
/// Benutzerkonto an und ändert keins.
#[tokio::test]
async fn einzige_mitgliedschaft_ist_der_admin_und_benutzer_bleiben_zeilengleich() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    // Ein weiteres Konto derselben Org: es darf nicht Mitglied werden.
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (?, 'Weitere Person', 'weitere', 'x')",
    )
    .bind(o.org)
    .execute(&pool)
    .await
    .unwrap();
    let vorher = zeilen(&pool, "benutzer", "1 = ?", 1).await;
    assert_eq!(vorher.len(), 2, "Vorbedingung: zwei Konten");

    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let mitglieder: Vec<(i64, String)> = sqlx::query_as(
        "SELECT benutzer_id, einsatz_rolle FROM einsatz_mitgliedschaft WHERE einsatz_id = ?",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        mitglieder,
        vec![(o.admin, crate::einsatz::EINSATZ_ROLLE_LEITUNG.to_string())]
    );
    assert_eq!(zeilen(&pool, "benutzer", "1 = ?", 1).await, vorher);
}

// ---------------------------------------------------------------------------------------------
// Drehbuch
// ---------------------------------------------------------------------------------------------

/// Abschnitte nach D9: vier, EA 1.1 unter EA 1, Lagezustand gemischt, Fortschritt teils leer.
/// Einheiten mit Typ aus dem Katalog, je einem Abschnitt zugeordnet.
#[tokio::test]
async fn abschnitte_und_einheiten_nach_dem_drehbuch() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let abschnitte: Vec<(String, String, Option<String>, Option<String>, Option<i64>)> =
        sqlx::query_as(
            "SELECT a.kurzbezeichnung, a.name, u.kurzbezeichnung, a.lagezustand, a.fortschritt \
             FROM einsatzabschnitt a LEFT JOIN einsatzabschnitt u ON u.id = a.ueber_abschnitt_id \
             WHERE a.einsatz_id = ? ORDER BY a.id",
        )
        .bind(erg.einsatz_id)
        .fetch_all(&pool)
        .await
        .unwrap();
    let s = |x: &str| x.to_string();
    assert_eq!(
        abschnitte,
        vec![
            (
                s("EA 1"),
                s("Sanitätsdienst"),
                None,
                Some(s("angespannt")),
                Some(40)
            ),
            (
                s("EA 2"),
                s("Betreuung"),
                None,
                Some(s("planmaessig")),
                None
            ),
            (
                s("EA 3"),
                s("Logistik"),
                None,
                Some(s("planmaessig")),
                Some(70)
            ),
            (
                s("EA 1.1"),
                s("UHS Turnhalle"),
                Some(s("EA 1")),
                Some(s("kritisch")),
                Some(25)
            ),
        ]
    );

    let einheiten: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT e.name, t.label, a.kurzbezeichnung, t.org_id FROM einsatz_einheit e \
         JOIN einheit_typ t ON t.id = e.typ_id JOIN einsatzabschnitt a ON a.id = e.abschnitt_id \
         WHERE e.einsatz_id = ? ORDER BY e.id",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        einheiten,
        vec![
            (s("Sanitätszug Musterstadt"), s("Zug"), s("EA 1"), o.org),
            (s("Rettungsstaffel"), s("Staffel"), s("EA 1"), o.org),
            (s("Betreuungsgruppe"), s("Gruppe"), s("EA 2"), o.org),
            (s("Logistiktrupp"), s("Trupp"), s("EA 3"), o.org),
            (s("Sanitätsgruppe UHS"), s("Gruppe"), s("EA 1.1"), o.org),
        ]
    );
}

/// Alle acht Stamm-Fahrzeuge disponiert und einer Einheit zugeordnet, FMS gemischt 2 · 3 · 4
/// · 6; alle zwölf Personen disponiert mit einem `gebunden`-Status.
#[tokio::test]
async fn fahrzeuge_und_personal_disponiert_fms_gemischt() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let fahrzeuge: Vec<(String, Option<i64>, String, i64)> = sqlx::query_as(
        "SELECT ef.snap_funkrufname, s.fms_anker, e.name, s.org_id FROM einsatz_fahrzeug ef \
         JOIN fahrzeug_status s ON s.id = ef.status_id \
         JOIN einsatz_einheit e ON e.id = ef.einheit_id \
         JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE ef.einsatz_id = ? ORDER BY f.id",
    )
    .bind(erg.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    let s = |x: &str| x.to_string();
    assert_eq!(
        fahrzeuge,
        vec![
            (
                s("Musterstadt 11-1"),
                Some(4),
                s("Sanitätszug Musterstadt"),
                o.org
            ),
            (s("Musterstadt 83-1"), Some(4), s("Rettungsstaffel"), o.org),
            (s("Musterstadt 83-2"), Some(3), s("Rettungsstaffel"), o.org),
            (
                s("Musterstadt 85-1"),
                Some(2),
                s("Sanitätsgruppe UHS"),
                o.org
            ),
            (
                s("Musterstadt 85-2"),
                Some(6),
                s("Sanitätsgruppe UHS"),
                o.org
            ),
            (
                s("Musterstadt 64-1"),
                Some(4),
                s("Sanitätsgruppe UHS"),
                o.org
            ),
            (s("Musterstadt 19-1"), Some(4), s("Betreuungsgruppe"), o.org),
            (s("Musterstadt 93-1"), Some(3), s("Logistiktrupp"), o.org),
        ]
    );

    let personal: Vec<(String, String)> = sqlx::query_as(
        "SELECT ep.snap_name, s.kategorie FROM einsatz_personal ep \
         JOIN personal_status s ON s.id = ep.status_id \
         JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einsatz_id = ? AND p.org_id = ? ORDER BY p.id",
    )
    .bind(erg.einsatz_id)
    .bind(o.org)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        personal.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>(),
        szenario::PERSONAL
            .iter()
            .map(|p| p.name)
            .collect::<Vec<_>>()
    );
    assert!(
        personal.iter().all(|(_, k)| k == "gebunden"),
        "{personal:?}"
    );
}

/// Der ETB folgt dem Drehbuch Eintrag für Eintrag: Typ, Wortlaut und Schrittzeit, in der
/// Reihenfolge der laufenden Nummer. Das pinnt die System-Einträge je Vorgangsart (D5) und
/// die Zeitfolge zugleich.
#[tokio::test]
async fn etb_folgt_dem_drehbuch_mit_system_eintraegen_je_vorgang() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let ist = etb(&pool, erg.einsatz_id).await;
    let erwartet = erwartete_etb();
    assert_eq!(ist.len(), 55, "Zahl der ETB-Einträge des Rumpfs");
    assert_eq!(
        ist.iter()
            .map(|(_, typ, inhalt, zeit, _)| (typ.clone(), inhalt.clone(), zeit.clone()))
            .collect::<Vec<_>>(),
        erwartet
    );
    assert_eq!(
        ist.iter().map(|e| e.0).collect::<Vec<_>>(),
        (1..=ist.len() as i64).collect::<Vec<i64>>(),
        "laufende Nummer ab dem Startwert 1, lückenlos"
    );

    let je_typ = |typ: &str| ist.iter().filter(|e| e.1 == typ).count();
    assert_eq!(je_typ("lage"), 4);
    assert_eq!(je_typ("entscheidung"), 4);
    assert_eq!(je_typ("system"), 47);

    // Einzelne Wortlaute als Literal, unabhängig von den Textfunktionen.
    let inhalte: Vec<&str> = ist.iter().map(|e| e.2.as_str()).collect();
    for literal in [
        "Abschnitt «Sanitätsdienst» angelegt (Lage: angespannt)",
        "Abschnitt «UHS Turnhalle» angelegt (Lage: kritisch)",
        "Einheit «Sanitätsgruppe UHS» gebildet",
        "Fahrzeug «Musterstadt 85-2» disponiert",
        "Einheit «Rettungsstaffel»: Fahrzeug «Musterstadt 83-2» zugeordnet",
        "Fahrzeug «Musterstadt 85-2»: Status «4 – Am Einsatzort» → «6 – Nicht einsatzbereit»",
        "Person «Max Mustermann (Zugführer, Sprechfunker)» disponiert",
    ] {
        assert!(inhalte.contains(&literal), "fehlt: {literal}");
    }
}

/// Szenariouhr (D9): jeder Eintrag trägt als Eingangszeit seine Ereigniszeit, die
/// Ereigniszeiten steigen mit der laufenden Nummer, der erste liegt beim Einsatzbeginn, der
/// jüngste vor dem Importzeitpunkt.
#[tokio::test]
async fn etb_chronologie_und_eingangszeit_gleich_ereigniszeit() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    let ist = etb(&pool, erg.einsatz_id).await;
    assert!(!ist.is_empty());
    for (lfd, _, inhalt, ereignis, eingang) in &ist {
        assert_eq!(
            eingang, ereignis,
            "Nr. {lfd} «{inhalt}»: keine Nachtrag-Marke"
        );
    }
    for paar in ist.windows(2) {
        assert!(
            paar[0].3 <= paar[1].3,
            "Ereigniszeit fällt: Nr. {} {} → Nr. {} {}",
            paar[0].0,
            paar[0].3,
            paar[1].0,
            paar[1].3
        );
    }
    assert_eq!(
        ist[0].3, "2026-09-25 07:00:00",
        "erster Eintrag beim Einsatzbeginn"
    );
    assert!(
        ist[ist.len() - 1].3.as_str() < JETZT,
        "jüngster vor dem Import"
    );
}

/// Die Szenariouhr ist an den Demo-Einsatz gebunden: ein vorher angelegter Nachbar-Einsatz mit
/// nachgetragenem Fach- und einem System-Eintrag behält beide Zeitstempel zeilengleich.
#[tokio::test]
async fn nachbar_einsatz_behaelt_seine_etb_zeiten() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let nachbar = einsatz_anlegen(&pool, o.admin, "Echter Einsatz").await;
    for (lfd, typ, ereignis, eingang) in [
        (1, "lage", "2026-09-25 08:00:00", "2026-09-25 09:30:00"),
        (2, "system", "2026-09-25 09:00:00", "2026-09-25 09:00:05"),
    ] {
        sqlx::query(
            "INSERT INTO etb_eintrag \
                (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, received_at) \
             VALUES (?, ?, ?, 'Nachbar', ?, ?, ?)",
        )
        .bind(nachbar)
        .bind(lfd)
        .bind(typ)
        .bind(o.admin)
        .bind(ereignis)
        .bind(eingang)
        .execute(&pool)
        .await
        .unwrap();
    }
    let vorher = zeilen(&pool, "etb_eintrag", "einsatz_id = ?", nachbar).await;
    assert_eq!(vorher.len(), 2);

    let erg = importieren(&pool, &o, jetzt()).await.expect("importieren");

    assert!(erg.einsatz_id > nachbar);
    assert_eq!(
        zeilen(&pool, "etb_eintrag", "einsatz_id = ?", nachbar).await,
        vorher
    );
}

// ---------------------------------------------------------------------------------------------
// Konflikt, Katalog, Mandant
// ---------------------------------------------------------------------------------------------

/// Zweiter Import bei aktivem Kopf: 409, nichts angelegt. Einmal wie im Betrieb in
/// `write_retry!`, einmal im Autocommit: dort hielte keine Rücknahme einen späten Abbruch
/// verdeckt, die Prüfung muss also vor dem ersten Schreiben stehen.
#[tokio::test]
async fn zweiter_import_ist_409_und_schreibt_nichts() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    importieren(&pool, &o, jetzt())
        .await
        .expect("erster Import");
    let vorher = bild(&pool).await;

    erwarte_status(importieren(&pool, &o, jetzt()).await, 409, "bereits");
    assert_eq!(bild(&pool).await, vorher);

    let mut conn = pool.acquire().await.unwrap();
    let autocommit = importieren_tx(&mut conn, o.org, o.admin, jetzt()).await;
    drop(conn);
    erwarte_status(autocommit, 409, "bereits");
    assert_eq!(
        bild(&pool).await,
        vorher,
        "im Autocommit nichts geschrieben"
    );
}

/// Ein aktiver Import einer fremden Organisation sperrt die eigene nicht (Spec
/// „Import je Organisation“).
#[tokio::test]
async fn aktiver_import_einer_fremden_org_sperrt_nicht() {
    let pool = crate::db::test_pool().await;
    let a = org_mit_admin(&pool, 1).await;
    let b = org_mit_admin(&pool, 2).await;
    let erg_b = importieren(&pool, &b, jetzt()).await.expect("Import B");

    let erg_a = importieren(&pool, &a, jetzt()).await.expect("Import A");

    assert_ne!(erg_a.einsatz_id, erg_b.einsatz_id);
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_import WHERE entfernt_at IS NULL AND org_id >= ?",
            0
        )
        .await,
        2
    );
}

/// Review-Punkt (a) aus 4.1, Ende zu Ende: ein deaktivierter Einheitstyp ist 422, die Meldung
/// nennt ihn, und die Datenbank ist danach zeilengleich — kein Einsatz, kein Kopf, keine
/// Stammdaten. Dazu die Autocommit-Probe: die Kataloge werden vor dem ersten Schreiben
/// aufgelöst.
#[tokio::test]
async fn deaktivierter_einheitstyp_ist_422_und_schreibt_nichts() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;
    let n = sqlx::query("UPDATE einheit_typ SET aktiv = 0 WHERE org_id = ? AND label = 'Gruppe'")
        .bind(o.org)
        .execute(&pool)
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(n, 1);
    let vorher = bild(&pool).await;

    erwarte_status(
        importieren(&pool, &o, jetzt()).await,
        422,
        "Katalogeintrag fehlt: Einheitstyp «Gruppe»",
    );
    assert_eq!(bild(&pool).await, vorher);

    let mut conn = pool.acquire().await.unwrap();
    let autocommit = importieren_tx(&mut conn, o.org, o.admin, jetzt()).await;
    drop(conn);
    erwarte_status(autocommit, 422, "Einheitstyp «Gruppe»");
    assert_eq!(
        bild(&pool).await,
        vorher,
        "im Autocommit nichts geschrieben"
    );
}

/// Der Admin muss zur Organisation gehören, in die importiert wird: sonst landete der Einsatz
/// in seiner Org, Kopf und Stammdaten in der anderen.
#[tokio::test]
async fn admin_einer_fremden_org_ist_internal_und_schreibt_nichts() {
    let pool = crate::db::test_pool().await;
    let a = org_mit_admin(&pool, 1).await;
    let b = org_mit_admin(&pool, 2).await;
    let vorher = bild(&pool).await;

    let fremd = Org {
        org: a.org,
        admin: b.admin,
    };
    erwarte_status(importieren(&pool, &fremd, jetzt()).await, 500, "Org");
    assert_eq!(bild(&pool).await, vorher);
}

/// Mit dem echten `bootstrap_admin` hat eine frische Org alles, was der Import braucht.
#[tokio::test]
async fn import_in_frisch_gebootstrappter_org() {
    let pool = crate::db::test_pool().await;
    crate::auth::bootstrap::bootstrap_admin(&pool, "Musterstadt", "admin", Some("pw12"))
        .await
        .unwrap();
    let (org, admin): (i64, i64) =
        sqlx::query_as("SELECT org_id, id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let erg = importieren(&pool, &Org { org, admin }, jetzt())
        .await
        .expect("Import in der gebootstrappten Org");
    assert_eq!(
        etb(&pool, erg.einsatz_id).await.len(),
        erwartete_etb().len()
    );
}

// ---------------------------------------------------------------------------------------------
// Rundlauf
// ---------------------------------------------------------------------------------------------

/// Importieren → Entfernen → Importieren gegen das aktuelle Schema: alle drei gelingen, der
/// zweite Bericht ist gleich dem ersten, und der neue Einsatz liegt über der gesperrten ID
/// des entfernten (D6).
#[tokio::test]
async fn rundlauf_import_entfernen_import() {
    let pool = crate::db::test_pool().await;
    let o = org_mit_admin(&pool, 1).await;

    let erster = importieren(&pool, &o, jetzt())
        .await
        .expect("erster Import");
    let entfernt =
        crate::write_retry!(&pool, |conn| { entfernen_tx(conn, o.org).await }).expect("entfernen");
    assert_eq!(entfernt.vorgang, DemoVorgang::Entfernt);
    let zweiter = importieren(&pool, &o, jetzt())
        .await
        .expect("zweiter Import");

    assert_eq!(zweiter.bericht, erster.bericht);
    assert!(zweiter.einsatz_id > erster.einsatz_id, "ID-Sperre (D6)");
    assert_ne!(zweiter.import_id, erster.import_id);
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_import WHERE org_id = ? AND entfernt_at IS NULL",
            o.org
        )
        .await,
        1
    );
    assert_eq!(
        etb(&pool, zweiter.einsatz_id).await.len(),
        erwartete_etb().len()
    );
    assert!(etb(&pool, erster.einsatz_id).await.is_empty());
}

/// Die fachlichen ETB-Typen des Rumpfs kommen beide vor (Pflicht-Typen der Spec).
#[test]
fn drehbuch_traegt_lage_und_entscheidung() {
    let arten: Vec<EtbArt> = DREHBUCH
        .iter()
        .filter_map(|s| match s.vorgang {
            Vorgang::Etb { art, .. } => Some(art),
            _ => None,
        })
        .collect();
    assert!(arten.contains(&EtbArt::Lage));
    assert!(arten.contains(&EtbArt::Entscheidung));
}
