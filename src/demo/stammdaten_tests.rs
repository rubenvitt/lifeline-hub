//! Repo-Tests der Stammdaten-Anlage `stammdaten_importieren_tx` und des Katalog-Lookups
//! (LFH-690, design.md D8) gegen die voll migrierte DB.
//!
//! Den Kopf `demo_import` legt später `importieren_tx` an; hier entsteht er per SQL auf einem
//! über den Betriebsweg angelegten Einsatz. Die Kataloge der Test-Orgs entstehen aus den
//! Startlisten des Bootstraps, nur der Bootstrap-Test fährt den echten `bootstrap_admin`.

use sqlx::SqlitePool;

use super::entfernen::entfernen_tx;
use super::katalog::{self, Katalog};
use super::stammdaten::{stammdaten_importieren_tx, StammdatenErgebnis};
use super::szenario::{self, Katalogeintrag};
use super::test_hilfen::{
    admin_anlegen, anzahl, einsatz_anlegen, fahrzeug_anlegen, kopf_anlegen, material_anlegen,
    org_anlegen, personal_anlegen, zeilen,
};
use super::{DemoBerichtZeile, DemoStammdatenArt};
use crate::error::AppError;
use crate::katalog::StatusKategorie;

// ---------------------------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------------------------

/// Die Kataloge einer Org, wie `bootstrap_admin` sie für eine neue Org anlegt.
async fn kataloge_seeden(pool: &SqlitePool, org_id: i64) {
    for (label, kategorie, fms_anker, sortier) in crate::fahrzeug::STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker, sortier) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(fms_anker)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
    for (label, sortier) in crate::personal::QUALIFIKATION_STARTLISTE {
        sqlx::query("INSERT INTO qualifikation (org_id, label, sortier) VALUES (?, ?, ?)")
            .bind(org_id)
            .bind(label)
            .bind(sortier)
            .execute(pool)
            .await
            .unwrap();
    }
    for (label, kategorie, sortier) in crate::personal::PERSONAL_STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
    for (label, f, u, m, sortier) in crate::einheit::EINHEIT_TYP_STARTLISTE {
        sqlx::query(
            "INSERT INTO einheit_typ \
                (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(f)
        .bind(u)
        .bind(m)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
}

/// Eine Org mit Katalogen, Admin, Platzhalter-Einsatz und aktivem Import-Kopf.
struct Aufbau {
    org: i64,
    admin: i64,
    kopf: i64,
}

async fn aufbau(pool: &SqlitePool, org_id: i64) -> Aufbau {
    org_anlegen(pool, org_id).await;
    kataloge_seeden(pool, org_id).await;
    let admin = admin_anlegen(pool, org_id).await;
    let einsatz = einsatz_anlegen(pool, admin, "ÜBUNG – Platzhalter").await;
    let kopf = kopf_anlegen(pool, org_id, einsatz).await;
    Aufbau {
        org: org_id,
        admin,
        kopf,
    }
}

/// Die Anlage so, wie der Aufrufer sie fährt: eine `write_retry!`-Transaktion.
async fn importieren(
    pool: &SqlitePool,
    org_id: i64,
    import_id: i64,
) -> Result<StammdatenErgebnis, AppError> {
    crate::write_retry!(pool, |conn| {
        stammdaten_importieren_tx(conn, org_id, import_id).await
    })
}

async fn katalog_deaktivieren(pool: &SqlitePool, sql: &'static str, org_id: i64, label: &str) {
    let n = sqlx::query(sql)
        .bind(org_id)
        .bind(label)
        .execute(pool)
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(n, 1, "Vorbedingung: {label} existiert genau einmal");
}

// ---------------------------------------------------------------------------------------------
// Auslesen
// ---------------------------------------------------------------------------------------------

fn zeile(ergebnis: &StammdatenErgebnis, art: DemoStammdatenArt) -> DemoBerichtZeile {
    *ergebnis
        .je_art
        .iter()
        .find(|z| z.art == art)
        .unwrap_or_else(|| panic!("keine Berichtszeile für {art:?}"))
}

fn erwarte_bericht(ergebnis: &StammdatenErgebnis, erwartet: [(i64, i64); 3]) {
    let arten = [
        DemoStammdatenArt::Fahrzeug,
        DemoStammdatenArt::Personal,
        DemoStammdatenArt::Material,
    ];
    assert_eq!(
        ergebnis.je_art.iter().map(|z| z.art).collect::<Vec<_>>(),
        arten.to_vec(),
        "alle drei Arten, in Enum-Reihenfolge"
    );
    for (art, (angelegt, mitbenutzt)) in arten.into_iter().zip(erwartet) {
        assert_eq!(
            zeile(ergebnis, art),
            DemoBerichtZeile {
                art,
                angelegt,
                mitbenutzt,
                entfernt: 0,
                behalten: 0,
            },
            "Berichtszeile {art:?}"
        );
    }
}

/// Marke einer Zeile, sofern vorhanden: die `import_id`.
async fn marke(pool: &SqlitePool, tabelle: &str, datensatz_id: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT import_id FROM demo_herkunft WHERE tabelle = ? AND datensatz_id = ?")
        .bind(tabelle)
        .bind(datensatz_id)
        .fetch_optional(pool)
        .await
        .unwrap()
}

/// Zeilenbild aller Stammdaten, Marken und Kataloge einer Org.
async fn bild_org(pool: &SqlitePool, org_id: i64) -> Vec<(&'static str, Vec<String>)> {
    let mut bild = Vec::new();
    for tabelle in [
        "fahrzeug",
        "personal",
        "material",
        "fahrzeug_status",
        "personal_status",
        "qualifikation",
        "einheit_typ",
    ] {
        bild.push((tabelle, zeilen(pool, tabelle, "org_id = ?", org_id).await));
    }
    bild.push((
        "personal_qualifikation",
        zeilen(
            pool,
            "personal_qualifikation",
            "personal_id IN (SELECT id FROM personal WHERE org_id = ?)",
            org_id,
        )
        .await,
    ));
    bild.push((
        "demo_herkunft",
        zeilen(
            pool,
            "demo_herkunft",
            "import_id IN (SELECT id FROM demo_import WHERE org_id = ?)",
            org_id,
        )
        .await,
    ));
    bild
}

fn erwarte_422(ergebnis: Result<StammdatenErgebnis, AppError>, meldung: &str) {
    match ergebnis {
        Err(e @ AppError::UnprocessableEntity(_)) => {
            assert_eq!(e.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
            assert_eq!(e.to_string(), meldung);
        }
        andere => panic!("erwartet: 422 „{meldung}“, bekommen: {andere:?}"),
    }
}

// ---------------------------------------------------------------------------------------------
// Leere Organisation
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn leere_org_legt_alles_an_und_markiert_jede_zeile() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    erwarte_bericht(
        &erg,
        [
            (szenario::FAHRZEUGE.len() as i64, 0),
            (szenario::PERSONAL.len() as i64, 0),
            (szenario::MATERIAL.len() as i64, 0),
        ],
    );
    assert_eq!(erg.fahrzeuge.len(), szenario::FAHRZEUGE.len());
    assert_eq!(erg.personal.len(), szenario::PERSONAL.len());
    assert_eq!(erg.material.len(), szenario::MATERIAL.len());

    for f in szenario::FAHRZEUGE {
        let id = erg.fahrzeug(f.schluessel).unwrap();
        let (org, name, typ, dienst, standort): (
            i64,
            String,
            Option<String>,
            String,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT org_id, funkrufname, fahrzeugtyp, dienststatus, standort \
                 FROM fahrzeug WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(org, a.org);
        assert_eq!(name, f.funkrufname);
        assert_eq!(typ.as_deref(), Some(f.fahrzeugtyp));
        assert_eq!(dienst, "in_dienst");
        assert_eq!(standort.as_deref(), Some(szenario::STANDORT));
        assert_eq!(marke(&pool, "fahrzeug", id).await, Some(a.kopf), "{name}");
    }

    for p in szenario::PERSONAL {
        let id = erg.personal(p.schluessel).unwrap();
        let (org, name, nummer, benutzer): (i64, String, Option<String>, Option<i64>) =
            sqlx::query_as(
                "SELECT org_id, name, personalnummer, benutzer_id FROM personal WHERE id = ?",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(org, a.org);
        assert_eq!(name, p.name);
        assert_eq!(nummer.as_deref(), Some(p.personalnummer));
        assert_eq!(benutzer, None, "nie eine Zuordnung zum Benutzerkonto");
        assert_eq!(marke(&pool, "personal", id).await, Some(a.kopf), "{name}");

        // Jede Qualifikation ist angekommen: `setze_qualifikationen` verwürfe eine fremde
        // oder falsche ID still, die Zahl allein fiele dann nicht auf.
        let mut labels: Vec<String> = sqlx::query_scalar(
            "SELECT q.label FROM personal_qualifikation pq \
             JOIN qualifikation q ON q.id = pq.qualifikation_id \
             WHERE pq.personal_id = ? AND q.org_id = ? AND q.aktiv = 1",
        )
        .bind(id)
        .bind(a.org)
        .fetch_all(&pool)
        .await
        .unwrap();
        labels.sort();
        let mut erwartet: Vec<String> = p.qualifikationen.iter().map(|q| q.to_string()).collect();
        erwartet.sort();
        assert_eq!(labels, erwartet, "Qualifikationen von {name}");
    }

    for m in szenario::MATERIAL {
        let id = erg.material(m.schluessel).unwrap();
        let (org, bez, kat, nummer): (i64, String, Option<String>, Option<String>) =
            sqlx::query_as(
                "SELECT org_id, bezeichnung, kategorie, bestandsnummer FROM material WHERE id = ?",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(org, a.org);
        assert_eq!(bez, m.bezeichnung);
        assert_eq!(kat.as_deref(), Some(m.kategorie));
        assert_eq!(nummer.as_deref(), Some(m.bestandsnummer));
        assert_eq!(marke(&pool, "material", id).await, Some(a.kopf), "{bez}");
    }

    let angelegt =
        (szenario::FAHRZEUGE.len() + szenario::PERSONAL.len() + szenario::MATERIAL.len()) as i64;
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_herkunft WHERE import_id = ?",
            a.kopf
        )
        .await,
        angelegt,
        "genau eine Marke je angelegter Zeile"
    );
}

#[tokio::test]
async fn unbekannter_schluessel_ist_internal() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let erg = importieren(&pool, a.org, a.kopf).await.unwrap();
    assert!(matches!(
        erg.fahrzeug("gibt-es-nicht"),
        Err(AppError::Internal(_))
    ));
    assert!(matches!(
        erg.personal("gibt-es-nicht"),
        Err(AppError::Internal(_))
    ));
    assert!(matches!(
        erg.material("gibt-es-nicht"),
        Err(AppError::Internal(_))
    ));
}

// ---------------------------------------------------------------------------------------------
// Konfliktregel
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn vorhandenes_fahrzeug_in_dienst_wird_mitbenutzt_unveraendert_und_unmarkiert() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let vorhanden = fahrzeug_anlegen(&pool, a.org, "Musterstadt 83-1").await;
    sqlx::query("UPDATE fahrzeug SET fahrzeugtyp = 'Eigener RTW', bemerkung = 'echt' WHERE id = ?")
        .bind(vorhanden)
        .execute(&pool)
        .await
        .unwrap();
    let vorher = zeilen(&pool, "fahrzeug", "id = ?", vorhanden).await;

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    assert_eq!(
        erg.fahrzeug("rtw1").unwrap(),
        vorhanden,
        "disponiert wird das vorhandene"
    );
    assert_eq!(
        zeilen(&pool, "fahrzeug", "id = ?", vorhanden).await,
        vorher,
        "mitbenutzt heißt unverändert"
    );
    assert_eq!(
        marke(&pool, "fahrzeug", vorhanden).await,
        None,
        "keine Marke"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE org_id = ? AND funkrufname = 'Musterstadt 83-1'",
            a.org
        )
        .await,
        1,
        "kein zweites Fahrzeug gleichen Namens"
    );
    erwarte_bericht(
        &erg,
        [
            (szenario::FAHRZEUGE.len() as i64 - 1, 1),
            (szenario::PERSONAL.len() as i64, 0),
            (szenario::MATERIAL.len() as i64, 0),
        ],
    );
}

#[tokio::test]
async fn ausser_dienst_gestellter_namensvetter_bleibt_und_ein_neues_entsteht() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let alt = fahrzeug_anlegen(&pool, a.org, "Musterstadt 83-1").await;
    sqlx::query("UPDATE fahrzeug SET dienststatus = 'ausser_dienst' WHERE id = ?")
        .bind(alt)
        .execute(&pool)
        .await
        .unwrap();
    let vorher = zeilen(&pool, "fahrzeug", "id = ?", alt).await;

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    let neu = erg.fahrzeug("rtw1").unwrap();
    assert_ne!(neu, alt, "der außer Dienst gestellte wird nicht mitbenutzt");
    assert_eq!(zeilen(&pool, "fahrzeug", "id = ?", alt).await, vorher);
    assert_eq!(marke(&pool, "fahrzeug", alt).await, None);
    assert_eq!(marke(&pool, "fahrzeug", neu).await, Some(a.kopf));
    erwarte_bericht(
        &erg,
        [
            (szenario::FAHRZEUGE.len() as i64, 0),
            (szenario::PERSONAL.len() as i64, 0),
            (szenario::MATERIAL.len() as i64, 0),
        ],
    );
}

/// Der Name ist beim Personal nie die Kennung: ein Namensvetter mit anderer Personalnummer
/// ist eine andere Person.
#[tokio::test]
async fn personal_gleichen_namens_mit_anderer_nummer_wird_neu_angelegt() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let namensvetter: i64 = sqlx::query_scalar(
        "INSERT INTO personal (org_id, name, personalnummer) \
         VALUES (?, 'Max Mustermann', 'ECHT-0815') RETURNING id",
    )
    .bind(a.org)
    .fetch_one(&pool)
    .await
    .unwrap();
    let vorher = zeilen(&pool, "personal", "id = ?", namensvetter).await;

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    let neu = erg.personal("zugfuehrer").unwrap();
    assert_ne!(neu, namensvetter);
    assert_eq!(
        zeilen(&pool, "personal", "id = ?", namensvetter).await,
        vorher
    );
    assert_eq!(marke(&pool, "personal", namensvetter).await, None);
    assert_eq!(marke(&pool, "personal", neu).await, Some(a.kopf));
    erwarte_bericht(
        &erg,
        [
            (szenario::FAHRZEUGE.len() as i64, 0),
            (szenario::PERSONAL.len() as i64, 0),
            (szenario::MATERIAL.len() as i64, 0),
        ],
    );
}

/// Personal gleicher Nummer wird mitbenutzt — samt Qualifikationen und Benutzerkonto-Link
/// unverändert. Der Import legt kein Benutzerkonto an und setzt nirgends `benutzer_id`.
#[tokio::test]
async fn personal_gleicher_nummer_mitbenutzt_benutzer_und_link_unberuehrt() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let vorhanden = personal_anlegen(&pool, a.org, "DEMO-P-001").await;
    sqlx::query("UPDATE personal SET benutzer_id = ? WHERE id = ?")
        .bind(a.admin)
        .bind(vorhanden)
        .execute(&pool)
        .await
        .unwrap();
    let gruppenfuehrer: i64 = sqlx::query_scalar(
        "SELECT id FROM qualifikation WHERE org_id = ? AND label = 'Gruppenführer'",
    )
    .bind(a.org)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO personal_qualifikation (personal_id, qualifikation_id) VALUES (?, ?)")
        .bind(vorhanden)
        .bind(gruppenfuehrer)
        .execute(&pool)
        .await
        .unwrap();
    let personal_vorher = zeilen(&pool, "personal", "id = ?", vorhanden).await;
    let quali_vorher = zeilen(
        &pool,
        "personal_qualifikation",
        "personal_id = ?",
        vorhanden,
    )
    .await;
    let benutzer_vorher = zeilen(&pool, "benutzer", "1 = ?", 1).await;

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    assert_eq!(erg.personal("zugfuehrer").unwrap(), vorhanden);
    assert_eq!(
        zeilen(&pool, "personal", "id = ?", vorhanden).await,
        personal_vorher
    );
    assert_eq!(
        zeilen(
            &pool,
            "personal_qualifikation",
            "personal_id = ?",
            vorhanden
        )
        .await,
        quali_vorher,
        "die Qualifikationen der mitbenutzten Person bleiben, wie sie sind"
    );
    assert_eq!(marke(&pool, "personal", vorhanden).await, None);
    assert_eq!(
        zeilen(&pool, "benutzer", "1 = ?", 1).await,
        benutzer_vorher,
        "kein Benutzerkonto angelegt oder geändert"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM personal WHERE org_id = ? AND benutzer_id IS NOT NULL",
            a.org
        )
        .await,
        1,
        "nur der vorhandene Link, kein neuer"
    );
    erwarte_bericht(
        &erg,
        [
            (szenario::FAHRZEUGE.len() as i64, 0),
            (szenario::PERSONAL.len() as i64 - 1, 1),
            (szenario::MATERIAL.len() as i64, 0),
        ],
    );
}

#[tokio::test]
async fn material_gleicher_bestandsnummer_wird_mitbenutzt() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let vorhanden = material_anlegen(&pool, a.org, "DEMO-M-001").await;
    let vorher = zeilen(&pool, "material", "id = ?", vorhanden).await;

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    assert_eq!(erg.material("stromerzeuger").unwrap(), vorhanden);
    assert_eq!(zeilen(&pool, "material", "id = ?", vorhanden).await, vorher);
    assert_eq!(marke(&pool, "material", vorhanden).await, None);
    erwarte_bericht(
        &erg,
        [
            (szenario::FAHRZEUGE.len() as i64, 0),
            (szenario::PERSONAL.len() as i64, 0),
            (szenario::MATERIAL.len() as i64 - 1, 1),
        ],
    );
}

/// Abgeglichen wird nur in der eigenen Org: gleiche Kennungen einer fremden Org werden
/// nicht mitbenutzt und nicht angefasst.
#[tokio::test]
async fn gleiche_kennungen_einer_fremden_org_werden_nicht_mitbenutzt() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let fremd = aufbau(&pool, 2).await;
    let f = fahrzeug_anlegen(&pool, fremd.org, "Musterstadt 83-1").await;
    let p = personal_anlegen(&pool, fremd.org, "DEMO-P-001").await;
    let m = material_anlegen(&pool, fremd.org, "DEMO-M-001").await;
    let fremd_vorher = bild_org(&pool, fremd.org).await;

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    assert_ne!(erg.fahrzeug("rtw1").unwrap(), f);
    assert_ne!(erg.personal("zugfuehrer").unwrap(), p);
    assert_ne!(erg.material("stromerzeuger").unwrap(), m);
    assert_eq!(bild_org(&pool, fremd.org).await, fremd_vorher);
    erwarte_bericht(
        &erg,
        [
            (szenario::FAHRZEUGE.len() as i64, 0),
            (szenario::PERSONAL.len() as i64, 0),
            (szenario::MATERIAL.len() as i64, 0),
        ],
    );
}

/// Der Kopf muss der aktive Kopf der eigenen Org sein: eine Marke an einem fremden oder
/// geschlossenen Kopf fände das Entfernen nie.
#[tokio::test]
async fn fremder_oder_geschlossener_kopf_ist_internal_und_schreibt_nichts() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let fremd = aufbau(&pool, 2).await;
    let vorher = bild_org(&pool, a.org).await;

    let fremder_kopf = importieren(&pool, a.org, fremd.kopf).await;
    assert!(
        matches!(fremder_kopf, Err(AppError::Internal(_))),
        "{fremder_kopf:?}"
    );

    sqlx::query("UPDATE demo_import SET entfernt_at = datetime('now') WHERE id = ?")
        .bind(a.kopf)
        .execute(&pool)
        .await
        .unwrap();
    let geschlossen = importieren(&pool, a.org, a.kopf).await;
    assert!(
        matches!(geschlossen, Err(AppError::Internal(_))),
        "{geschlossen:?}"
    );

    assert_eq!(bild_org(&pool, a.org).await, vorher);
}

// ---------------------------------------------------------------------------------------------
// Kataloge
// ---------------------------------------------------------------------------------------------

/// Kataloge werden nur gelesen, nie angelegt oder geändert.
#[tokio::test]
async fn kataloge_bleiben_zeilengleich() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let mut vorher = Vec::new();
    for t in [
        "fahrzeug_status",
        "personal_status",
        "qualifikation",
        "einheit_typ",
    ] {
        vorher.push(zeilen(&pool, t, "1 = ?", 1).await);
    }

    importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");

    let mut nachher = Vec::new();
    for t in [
        "fahrzeug_status",
        "personal_status",
        "qualifikation",
        "einheit_typ",
    ] {
        nachher.push(zeilen(&pool, t, "1 = ?", 1).await);
    }
    assert_eq!(nachher, vorher);
}

/// Eine deaktivierte Qualifikation, die das Szenario braucht: 422 mit ihrem Namen, und die
/// Datenbank ist danach zeilengleich.
#[tokio::test]
async fn deaktivierte_qualifikation_ist_422_und_db_unveraendert() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    katalog_deaktivieren(
        &pool,
        "UPDATE qualifikation SET aktiv = 0 WHERE org_id = ? AND label = ?",
        a.org,
        "Notarzt",
    )
    .await;
    let vorher = bild_org(&pool, a.org).await;

    erwarte_422(
        importieren(&pool, a.org, a.kopf).await,
        "Katalogeintrag fehlt: Qualifikation «Notarzt»",
    );
    assert_eq!(bild_org(&pool, a.org).await, vorher);
}

/// Kataloge einer fremden Org zählen nicht.
#[tokio::test]
async fn kataloge_einer_fremden_org_zaehlen_nicht() {
    let pool = crate::db::test_pool().await;
    let _mit_katalog = aufbau(&pool, 1).await;
    org_anlegen(&pool, 2).await;
    let admin = admin_anlegen(&pool, 2).await;
    let einsatz = einsatz_anlegen(&pool, admin, "ÜBUNG – ohne Kataloge").await;
    let kopf = kopf_anlegen(&pool, 2, einsatz).await;
    let vorher = bild_org(&pool, 2).await;

    let erster = match szenario::katalog_bedarf_stammdaten()[0] {
        Katalogeintrag::Qualifikation(l) => l,
        andere => panic!("{andere:?}"),
    };
    erwarte_422(
        importieren(&pool, 2, kopf).await,
        &format!("Katalogeintrag fehlt: Qualifikation «{erster}»"),
    );
    assert_eq!(bild_org(&pool, 2).await, vorher);
}

/// Ein deaktivierter Einheitstyp, den das Szenario braucht: 422 mit seinem Namen. Den
/// Einheitstyp schlägt erst der Einsatz-Teil nach (Block 4.2), deshalb über den gesamten
/// Bedarf und über den Helfer.
#[tokio::test]
async fn deaktivierter_einheitstyp_ist_422() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    assert!(
        szenario::katalog_bedarf().contains(&Katalogeintrag::Einheitstyp("Gruppe")),
        "Vorbedingung: das Szenario braucht die Gruppe"
    );
    katalog_deaktivieren(
        &pool,
        "UPDATE einheit_typ SET aktiv = 0 WHERE org_id = ? AND label = ?",
        a.org,
        "Gruppe",
    )
    .await;

    let mut conn = pool.acquire().await.unwrap();
    let direkt = katalog::einheitstyp_tx(&mut conn, a.org, "Gruppe").await;
    let gesamt = katalog::aufloesen_tx(&mut conn, a.org, &szenario::katalog_bedarf()).await;
    drop(conn);
    for ergebnis in [direkt.map(|_| ()), gesamt.map(|_| ())] {
        match ergebnis {
            Err(e @ AppError::UnprocessableEntity(_)) => {
                assert_eq!(e.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
                assert_eq!(e.to_string(), "Katalogeintrag fehlt: Einheitstyp «Gruppe»");
            }
            andere => panic!("erwartet 422, bekommen {andere:?}"),
        }
    }
}

/// Fahrzeugstatus über den FMS-Anker, nicht über das umbenennbare Label; die Kategorie-
/// Helfer nehmen den ersten aktiven Eintrag.
#[tokio::test]
async fn status_lookup_ueber_fms_anker_und_kategorie() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let drei: i64 =
        sqlx::query_scalar("SELECT id FROM fahrzeug_status WHERE org_id = ? AND fms_anker = 3")
            .bind(a.org)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("UPDATE fahrzeug_status SET label = 'Anfahrt (umbenannt)' WHERE id = ?")
        .bind(drei)
        .execute(&pool)
        .await
        .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        katalog::fahrzeugstatus_fms_tx(&mut conn, a.org, 3)
            .await
            .unwrap(),
        drei,
        "umbenannt, über den Anker gefunden"
    );
    let alarmiert: i64 = sqlx::query_scalar(
        "SELECT id FROM personal_status WHERE org_id = ? AND label = 'alarmiert'",
    )
    .bind(a.org)
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    assert_eq!(
        katalog::personalstatus_der_kategorie_tx(&mut conn, a.org, StatusKategorie::Gebunden)
            .await
            .unwrap(),
        alarmiert,
        "erster gebundener nach sortier"
    );
    assert_eq!(
        katalog::personalstatus_tx(&mut conn, a.org, "alarmiert")
            .await
            .unwrap(),
        alarmiert
    );

    sqlx::query("UPDATE fahrzeug_status SET aktiv = 0 WHERE id = ?")
        .bind(drei)
        .execute(&mut *conn)
        .await
        .unwrap();
    let fehlt = katalog::fahrzeugstatus_fms_tx(&mut conn, a.org, 3).await;
    assert_eq!(
        fehlt.map_err(|e| e.to_string()),
        Err("Katalogeintrag fehlt: Fahrzeugstatus «FMS 3»".to_string())
    );
    sqlx::query("UPDATE personal_status SET aktiv = 0 WHERE org_id = ? AND kategorie = 'gebunden'")
        .bind(a.org)
        .execute(&mut *conn)
        .await
        .unwrap();
    let fehlt =
        katalog::personalstatus_der_kategorie_tx(&mut conn, a.org, StatusKategorie::Gebunden).await;
    assert_eq!(
        fehlt.map_err(|e| e.to_string()),
        Err("Katalogeintrag fehlt: Personalstatus «Kategorie gebunden»".to_string())
    );
    assert_eq!(Katalog::Einheitstyp.name(), "Einheitstyp");
}

/// Eine frisch gebootstrappte Org hat jeden Katalogeintrag, den das Szenario braucht — über
/// den echten `bootstrap_admin`, nicht über die Startlisten dieses Tests.
#[tokio::test]
async fn frisch_gebootstrappte_org_hat_den_ganzen_katalogbedarf() {
    let pool = crate::db::test_pool().await;
    let boot = crate::auth::bootstrap::bootstrap_admin(&pool, "Musterstadt", "admin", Some("pw12"))
        .await
        .unwrap();
    assert!(boot.admin_angelegt);
    let (org_id, admin_id): (i64, i64) =
        sqlx::query_as("SELECT org_id, id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let bedarf = szenario::katalog_bedarf();
    let mut conn = pool.acquire().await.unwrap();
    let ids = katalog::aufloesen_tx(&mut conn, org_id, &bedarf)
        .await
        .expect("Bootstrap deckt den ganzen Bedarf");
    drop(conn);
    for eintrag in &bedarf {
        ids.id(*eintrag).expect("jeder Eintrag aufgelöst");
    }
    assert!(matches!(
        ids.id(Katalogeintrag::Einheitstyp("nicht im Bedarf")),
        Err(AppError::Internal(_))
    ));

    let einsatz = einsatz_anlegen(&pool, admin_id, "ÜBUNG – Bootstrap").await;
    let kopf = kopf_anlegen(&pool, org_id, einsatz).await;
    importieren(&pool, org_id, kopf)
        .await
        .expect("Stammdaten-Anlage in der gebootstrappten Org");
}

// ---------------------------------------------------------------------------------------------
// Rundlauf
// ---------------------------------------------------------------------------------------------

/// Anlegen, dann Entfernen: was angelegt wurde, verschwindet; was mitbenutzt wurde, bleibt
/// zeilengleich.
#[tokio::test]
async fn rundlauf_angelegtes_verschwindet_mitbenutztes_bleibt() {
    let pool = crate::db::test_pool().await;
    let a = aufbau(&pool, 1).await;
    let f = fahrzeug_anlegen(&pool, a.org, "Musterstadt 83-1").await;
    let p = personal_anlegen(&pool, a.org, "DEMO-P-001").await;
    let mitbenutzt_vorher = (
        zeilen(&pool, "fahrzeug", "id = ?", f).await,
        zeilen(&pool, "personal", "id = ?", p).await,
    );

    let erg = importieren(&pool, a.org, a.kopf)
        .await
        .expect("importieren");
    let angelegt_f: Vec<i64> = erg
        .fahrzeuge
        .values()
        .copied()
        .filter(|&id| id != f)
        .collect();
    let angelegt_p: Vec<i64> = erg
        .personal
        .values()
        .copied()
        .filter(|&id| id != p)
        .collect();
    let angelegt_m: Vec<i64> = erg.material.values().copied().collect();

    let bericht =
        crate::write_retry!(&pool, |conn| { entfernen_tx(conn, a.org).await }).expect("entfernen");

    for id in &angelegt_f {
        assert_eq!(
            anzahl(&pool, "SELECT COUNT(*) FROM fahrzeug WHERE id = ?", *id).await,
            0
        );
    }
    for id in &angelegt_p {
        assert_eq!(
            anzahl(&pool, "SELECT COUNT(*) FROM personal WHERE id = ?", *id).await,
            0
        );
        assert_eq!(
            anzahl(
                &pool,
                "SELECT COUNT(*) FROM personal_qualifikation WHERE personal_id = ?",
                *id
            )
            .await,
            0
        );
    }
    for id in &angelegt_m {
        assert_eq!(
            anzahl(&pool, "SELECT COUNT(*) FROM material WHERE id = ?", *id).await,
            0
        );
    }
    assert_eq!(
        (
            zeilen(&pool, "fahrzeug", "id = ?", f).await,
            zeilen(&pool, "personal", "id = ?", p).await,
        ),
        mitbenutzt_vorher
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_herkunft WHERE import_id = ?",
            a.kopf
        )
        .await,
        0
    );
    let entfernt: Vec<(DemoStammdatenArt, i64, i64)> = bericht
        .je_art
        .iter()
        .map(|z| (z.art, z.entfernt, z.behalten))
        .collect();
    assert_eq!(
        entfernt,
        vec![
            (DemoStammdatenArt::Fahrzeug, angelegt_f.len() as i64, 0),
            (DemoStammdatenArt::Personal, angelegt_p.len() as i64, 0),
            (DemoStammdatenArt::Material, angelegt_m.len() as i64, 0),
        ]
    );
}
