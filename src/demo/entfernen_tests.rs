//! Repo-Tests des Löschwegs `entfernen_tx` (LFH-690, design.md D7) gegen die voll migrierte DB.
//!
//! Kopf und Marken entstehen hier von Hand, nicht über den Import: der Löschweg muss sich an
//! Kopf und Marke halten, gleich wer sie geschrieben hat. Deshalb stehen auch Kopf-Zustände
//! im Test, die der Import nie erzeugt (Kopf auf einem fremden Einsatz, Marke auf einer
//! fremden Zeile).

use sqlx::SqlitePool;

use super::entfernen::{entfernen_tx, ist_fk_verletzung};
use super::test_hilfen::{
    admin_anlegen, anzahl, einsatz_anlegen, fahrzeug_anlegen, kopf_anlegen, material_anlegen,
    org_anlegen, personal_anlegen, zeilen,
};
use super::{DemoBericht, DemoBerichtZeile, DemoStammdatenArt, DemoVorgang};
use crate::error::AppError;

// ---------------------------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------------------------

async fn etb_anlegen(pool: &SqlitePool, einsatz_id: i64, erfasser: i64, lfd: i64) {
    sqlx::query(
        "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
         VALUES (?, ?, 'meldung', ?, ?, '2026-09-24 10:00:00')",
    )
    .bind(einsatz_id)
    .bind(lfd)
    .bind(format!("Meldung {lfd} in Einsatz {einsatz_id}"))
    .bind(erfasser)
    .execute(pool)
    .await
    .unwrap();
}

async fn person_anlegen(pool: &SqlitePool, einsatz_id: i64, erfasser: i64, nr: i64) {
    sqlx::query(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, name, erfasst_von, geaendert_von) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(nr)
    .bind(format!("Person {nr}"))
    .bind(erfasser)
    .bind(erfasser)
    .execute(pool)
    .await
    .unwrap();
}

/// Legt eine Qualifikation der Organisation an und gibt sie der Person.
async fn qualifizieren(pool: &SqlitePool, org_id: i64, personal_id: i64, label: &str) {
    let qualifikation_id: i64 = sqlx::query_scalar(
        "INSERT INTO qualifikation (org_id, label) VALUES (?, ?) \
         ON CONFLICT (org_id, label) DO UPDATE SET label = excluded.label RETURNING id",
    )
    .bind(org_id)
    .bind(label)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO personal_qualifikation (personal_id, qualifikation_id) VALUES (?, ?)")
        .bind(personal_id)
        .bind(qualifikation_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn fahrzeug_disponieren(pool: &SqlitePool, einsatz_id: i64, fahrzeug_id: i64) {
    sqlx::query(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, fahrzeug_id, snap_funkrufname) \
         VALUES (?, ?, 'Florian')",
    )
    .bind(einsatz_id)
    .bind(fahrzeug_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn personal_disponieren(pool: &SqlitePool, einsatz_id: i64, personal_id: i64) {
    sqlx::query(
        "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) VALUES (?, ?, 'Name')",
    )
    .bind(einsatz_id)
    .bind(personal_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn material_disponieren(pool: &SqlitePool, einsatz_id: i64, material_id: i64) {
    sqlx::query(
        "INSERT INTO einsatz_material (einsatz_id, material_id, snap_bezeichnung) \
         VALUES (?, ?, 'Material')",
    )
    .bind(einsatz_id)
    .bind(material_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn markieren(pool: &SqlitePool, import_id: i64, tabelle: &str, datensatz_id: i64) {
    sqlx::query("INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) VALUES (?, ?, ?)")
        .bind(import_id)
        .bind(tabelle)
        .bind(datensatz_id)
        .execute(pool)
        .await
        .unwrap();
}

/// Ein Demo-Stand, wie ihn der Import hinterlässt: Einsatz mit ETB und Personen, je Art eine
/// neu angelegte und markierte Stammdatenzeile, alle drei im Demo-Einsatz disponiert, die
/// Person mit Qualifikation.
struct Demo {
    einsatz: i64,
    kopf: i64,
    fahrzeug: i64,
    personal: i64,
    material: i64,
}

async fn demo_anlegen(pool: &SqlitePool, org_id: i64, admin_id: i64) -> Demo {
    let einsatz = einsatz_anlegen(pool, admin_id, "ÜBUNG – Demo").await;
    etb_anlegen(pool, einsatz, admin_id, 1).await;
    etb_anlegen(pool, einsatz, admin_id, 2).await;
    person_anlegen(pool, einsatz, admin_id, 1).await;
    person_anlegen(pool, einsatz, admin_id, 2).await;

    let fahrzeug = fahrzeug_anlegen(pool, org_id, &format!("DEMO Florian {org_id}")).await;
    let personal = personal_anlegen(pool, org_id, &format!("DEMO-P-{org_id}")).await;
    let material = material_anlegen(pool, org_id, &format!("DEMO-M-{org_id}")).await;
    qualifizieren(pool, org_id, personal, "Truppführer").await;
    fahrzeug_disponieren(pool, einsatz, fahrzeug).await;
    personal_disponieren(pool, einsatz, personal).await;
    material_disponieren(pool, einsatz, material).await;

    let kopf = kopf_anlegen(pool, org_id, einsatz).await;
    markieren(pool, kopf, "fahrzeug", fahrzeug).await;
    markieren(pool, kopf, "personal", personal).await;
    markieren(pool, kopf, "material", material).await;
    Demo {
        einsatz,
        kopf,
        fahrzeug,
        personal,
        material,
    }
}

/// Der Löschweg so, wie ihn der Aufrufer fährt: eine `write_retry!`-Transaktion.
async fn entfernen(pool: &SqlitePool, org_id: i64) -> Result<DemoBericht, AppError> {
    crate::write_retry!(pool, |conn| { entfernen_tx(conn, org_id).await })
}

// ---------------------------------------------------------------------------------------------
// Auslesen
// ---------------------------------------------------------------------------------------------

/// Zeilenbild eines Einsatzes samt allem, was an ihm hängt, und der genannten Stammdaten.
async fn bild_einsatz(pool: &SqlitePool, einsatz_id: i64) -> Vec<(String, Vec<String>)> {
    let mut bild = vec![(
        "einsatz".to_string(),
        zeilen(pool, "einsatz", "id = ?", einsatz_id).await,
    )];
    for tabelle in [
        "einsatz_mitgliedschaft",
        "etb_eintrag",
        "einsatz_person",
        "einsatz_fahrzeug",
        "einsatz_personal",
        "einsatz_material",
    ] {
        bild.push((
            tabelle.to_string(),
            zeilen(pool, tabelle, "einsatz_id = ?", einsatz_id).await,
        ));
    }
    bild
}

async fn bild_stammdaten(
    pool: &SqlitePool,
    fahrzeug: i64,
    personal: i64,
    material: i64,
) -> Vec<(String, Vec<String>)> {
    vec![
        (
            "fahrzeug".into(),
            zeilen(pool, "fahrzeug", "id = ?", fahrzeug).await,
        ),
        (
            "personal".into(),
            zeilen(pool, "personal", "id = ?", personal).await,
        ),
        (
            "personal_qualifikation".into(),
            zeilen(pool, "personal_qualifikation", "personal_id = ?", personal).await,
        ),
        (
            "material".into(),
            zeilen(pool, "material", "id = ?", material).await,
        ),
    ]
}

fn zeile(bericht: &DemoBericht, art: DemoStammdatenArt) -> DemoBerichtZeile {
    *bericht
        .je_art
        .iter()
        .find(|z| z.art == art)
        .unwrap_or_else(|| panic!("keine Berichtszeile für {art:?}: {bericht:?}"))
}

fn erwarte_zeile(bericht: &DemoBericht, art: DemoStammdatenArt, entfernt: i64, behalten: i64) {
    assert_eq!(
        zeile(bericht, art),
        DemoBerichtZeile {
            art,
            angelegt: 0,
            mitbenutzt: 0,
            entfernt,
            behalten,
        },
        "Berichtszeile {art:?}"
    );
}

fn erwarte_konflikt(ergebnis: Result<DemoBericht, AppError>) {
    match ergebnis {
        Err(e @ AppError::Conflict(_)) => {
            assert_eq!(e.status(), axum::http::StatusCode::CONFLICT);
        }
        andere => panic!("erwartet: Conflict (409), bekommen: {andere:?}"),
    }
}

// ---------------------------------------------------------------------------------------------
// (a) Demo-Einsatz samt ETB und Personen weg
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn entfernt_demo_einsatz_samt_etb_personen_und_stammdaten() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo.einsatz
        )
        .await,
        0,
        "Demo-Einsatz ist weg"
    );
    for (sql, was) in [
        (
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            "ETB",
        ),
        (
            "SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?",
            "Personen",
        ),
        (
            "SELECT COUNT(*) FROM einsatz_fahrzeug WHERE einsatz_id = ?",
            "Fahrzeug-Dispositionen",
        ),
        (
            "SELECT COUNT(*) FROM einsatz_mitgliedschaft WHERE einsatz_id = ?",
            "Mitgliedschaften",
        ),
    ] {
        assert_eq!(anzahl(&pool, sql, demo.einsatz).await, 0, "{was} weg");
    }
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE id = ?",
            demo.fahrzeug
        )
        .await,
        0
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM personal WHERE id = ?",
            demo.personal
        )
        .await,
        0
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM material WHERE id = ?",
            demo.material
        )
        .await,
        0
    );

    assert_eq!(bericht.vorgang, DemoVorgang::Entfernt);
    // Alle drei Arten, in Enum-Reihenfolge — unabhängig von der Löschreihenfolge.
    assert_eq!(
        bericht.je_art.iter().map(|z| z.art).collect::<Vec<_>>(),
        vec![
            DemoStammdatenArt::Fahrzeug,
            DemoStammdatenArt::Personal,
            DemoStammdatenArt::Material,
        ]
    );
    erwarte_zeile(&bericht, DemoStammdatenArt::Fahrzeug, 1, 0);
    erwarte_zeile(&bericht, DemoStammdatenArt::Personal, 1, 0);
    erwarte_zeile(&bericht, DemoStammdatenArt::Material, 1, 0);

    // `YYYY-MM-DD HH:MM:SS`, dasselbe Format wie `datetime('now')`.
    let gleich_format: bool = sqlx::query_scalar("SELECT datetime(?) = ?")
        .bind(&bericht.zeitpunkt)
        .bind(&bericht.zeitpunkt)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(gleich_format, "zeitpunkt {:?}", bericht.zeitpunkt);
}

// ---------------------------------------------------------------------------------------------
// (b) Nachbar-Einsatz der eigenen Org zeilengleich erhalten
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn nachbar_einsatz_der_eigenen_org_bleibt_zeilengleich() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;

    // Der echte Einsatz entsteht VOR dem Demo-Einsatz und danach — beide Seiten der ID.
    let vorher = einsatz_anlegen(&pool, admin, "Echter Einsatz vorher").await;
    let demo = demo_anlegen(&pool, 1, admin).await;
    let nachher = einsatz_anlegen(&pool, admin, "Echter Einsatz nachher").await;

    let fahrzeug = fahrzeug_anlegen(&pool, 1, "Florian Echt").await;
    let personal = personal_anlegen(&pool, 1, "P-ECHT").await;
    let material = material_anlegen(&pool, 1, "M-ECHT").await;
    qualifizieren(&pool, 1, personal, "Truppführer").await;
    for (i, einsatz) in [vorher, nachher].into_iter().enumerate() {
        let i = i as i64;
        etb_anlegen(&pool, einsatz, admin, 1 + i).await;
        etb_anlegen(&pool, einsatz, admin, 10 + i).await;
        person_anlegen(&pool, einsatz, admin, 1).await;
        person_anlegen(&pool, einsatz, admin, 2).await;
        fahrzeug_disponieren(&pool, einsatz, fahrzeug).await;
        personal_disponieren(&pool, einsatz, personal).await;
        material_disponieren(&pool, einsatz, material).await;
    }

    let bild_vorher = (
        bild_einsatz(&pool, vorher).await,
        bild_einsatz(&pool, nachher).await,
        bild_stammdaten(&pool, fahrzeug, personal, material).await,
    );
    // Vorbedingung: das Bild ist nicht leer, sonst wäre „gleich“ wertlos.
    for (tabelle, zeilen) in bild_vorher.0.iter().chain(&bild_vorher.2) {
        assert!(!zeilen.is_empty(), "Vorbedingung: {tabelle} trägt Zeilen");
    }

    entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo.einsatz
        )
        .await,
        0,
        "der Demo-Einsatz ist weg"
    );
    let bild_nachher = (
        bild_einsatz(&pool, vorher).await,
        bild_einsatz(&pool, nachher).await,
        bild_stammdaten(&pool, fahrzeug, personal, material).await,
    );
    assert_eq!(
        bild_nachher, bild_vorher,
        "echte Einsätze und Stammdaten zeilengleich"
    );
}

// ---------------------------------------------------------------------------------------------
// (c) Demo-Stammdaten in einem echten Einsatz disponiert → behalten
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn demo_fahrzeug_im_echten_einsatz_bleibt_und_verliert_die_marke() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;
    let echt = einsatz_anlegen(&pool, admin, "Echter Einsatz").await;
    fahrzeug_disponieren(&pool, echt, demo.fahrzeug).await;

    let fahrzeug_vorher = zeilen(&pool, "fahrzeug", "id = ?", demo.fahrzeug).await;
    let dispo_vorher = zeilen(&pool, "einsatz_fahrzeug", "einsatz_id = ?", echt).await;
    assert_eq!(dispo_vorher.len(), 1, "Vorbedingung: disponiert");

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        zeilen(&pool, "fahrzeug", "id = ?", demo.fahrzeug).await,
        fahrzeug_vorher,
        "das Fahrzeug bleibt unverändert stehen"
    );
    assert_eq!(
        zeilen(&pool, "einsatz_fahrzeug", "einsatz_id = ?", echt).await,
        dispo_vorher,
        "die Disposition im echten Einsatz ist unverändert"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_herkunft WHERE datensatz_id = ? AND tabelle = 'fahrzeug'",
            demo.fahrzeug
        )
        .await,
        0,
        "die Marke ist weg"
    );
    erwarte_zeile(&bericht, DemoStammdatenArt::Fahrzeug, 0, 1);
    // Die übrigen Arten laufen weiter, der Konflikt bricht nichts ab.
    erwarte_zeile(&bericht, DemoStammdatenArt::Personal, 1, 0);
    erwarte_zeile(&bericht, DemoStammdatenArt::Material, 1, 0);
}

/// Die Qualifikationen einer Demo-Person werden im Savepoint der Person gelöscht. Scheitert die
/// Person an einer Disposition, kommen sie mit dem `ROLLBACK TO` zurück. Ohne diesen Test
/// fiele eine Löschung außerhalb des Savepoints nicht auf: die Person stünde, ihre
/// Qualifikationen wären still weg.
#[tokio::test]
async fn demo_person_im_echten_einsatz_bleibt_samt_qualifikation() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;
    qualifizieren(&pool, 1, demo.personal, "Sprechfunker").await;
    let echt = einsatz_anlegen(&pool, admin, "Echter Einsatz").await;
    personal_disponieren(&pool, echt, demo.personal).await;

    let person_vorher = zeilen(&pool, "personal", "id = ?", demo.personal).await;
    let quali_vorher = zeilen(
        &pool,
        "personal_qualifikation",
        "personal_id = ?",
        demo.personal,
    )
    .await;
    assert_eq!(quali_vorher.len(), 2, "Vorbedingung: zwei Qualifikationen");
    let dispo_vorher = zeilen(&pool, "einsatz_personal", "einsatz_id = ?", echt).await;

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        zeilen(&pool, "personal", "id = ?", demo.personal).await,
        person_vorher
    );
    assert_eq!(
        zeilen(
            &pool,
            "personal_qualifikation",
            "personal_id = ?",
            demo.personal
        )
        .await,
        quali_vorher,
        "die Qualifikationen kommen mit dem ROLLBACK TO zurück"
    );
    assert_eq!(
        zeilen(&pool, "einsatz_personal", "einsatz_id = ?", echt).await,
        dispo_vorher
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_herkunft WHERE datensatz_id = ? AND tabelle = 'personal'",
            demo.personal
        )
        .await,
        0,
        "die Marke ist weg"
    );
    erwarte_zeile(&bericht, DemoStammdatenArt::Personal, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// (d) Kopf einer fremden Org unberührt
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn demo_stand_einer_fremden_org_bleibt_unberuehrt() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    org_anlegen(&pool, 2).await;
    let admin_a = admin_anlegen(&pool, 1).await;
    let admin_b = admin_anlegen(&pool, 2).await;
    let demo_a = demo_anlegen(&pool, 1, admin_a).await;
    let demo_b = demo_anlegen(&pool, 2, admin_b).await;

    let kopf_b = zeilen(&pool, "demo_import", "id = ?", demo_b.kopf).await;
    let marken_b = zeilen(&pool, "demo_herkunft", "import_id = ?", demo_b.kopf).await;
    let einsatz_b = bild_einsatz(&pool, demo_b.einsatz).await;
    let stamm_b = bild_stammdaten(&pool, demo_b.fahrzeug, demo_b.personal, demo_b.material).await;
    assert_eq!(marken_b.len(), 3, "Vorbedingung: drei Marken");

    entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo_a.einsatz
        )
        .await,
        0,
        "der eigene Demo-Einsatz ist weg"
    );
    assert_eq!(
        zeilen(&pool, "demo_import", "id = ?", demo_b.kopf).await,
        kopf_b
    );
    assert_eq!(
        zeilen(&pool, "demo_herkunft", "import_id = ?", demo_b.kopf).await,
        marken_b
    );
    assert_eq!(bild_einsatz(&pool, demo_b.einsatz).await, einsatz_b);
    assert_eq!(
        bild_stammdaten(&pool, demo_b.fahrzeug, demo_b.personal, demo_b.material).await,
        stamm_b
    );
}

// ---------------------------------------------------------------------------------------------
// (e) kein aktiver Kopf → 409, (j) zweites Entfernen → 409
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn ohne_aktiven_kopf_ist_409_und_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    org_anlegen(&pool, 2).await;
    let admin = admin_anlegen(&pool, 1).await;
    let admin_b = admin_anlegen(&pool, 2).await;
    let echt = einsatz_anlegen(&pool, admin, "Echter Einsatz").await;
    etb_anlegen(&pool, echt, admin, 1).await;
    // Ein aktiver Kopf einer ANDEREN Org ist für Org 1 kein aktiver Kopf.
    let demo_b = demo_anlegen(&pool, 2, admin_b).await;

    let einsatz_vorher = bild_einsatz(&pool, echt).await;
    let koepfe_vorher = zeilen(&pool, "demo_import", "id >= ?", 0).await;
    let marken_vorher = zeilen(&pool, "demo_herkunft", "import_id >= ?", 0).await;

    erwarte_konflikt(entfernen(&pool, 1).await);

    assert_eq!(bild_einsatz(&pool, echt).await, einsatz_vorher);
    assert_eq!(
        zeilen(&pool, "demo_import", "id >= ?", 0).await,
        koepfe_vorher
    );
    assert_eq!(
        zeilen(&pool, "demo_herkunft", "import_id >= ?", 0).await,
        marken_vorher
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo_b.einsatz
        )
        .await,
        1
    );
}

#[tokio::test]
async fn zweites_entfernen_ist_409() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    demo_anlegen(&pool, 1, admin).await;

    entfernen(&pool, 1).await.expect("erstes Entfernen");
    erwarte_konflikt(entfernen(&pool, 1).await);
}

// ---------------------------------------------------------------------------------------------
// (f) soft-gelöschter bzw. geschwärzter Demo-Einsatz wird entfernt
// ---------------------------------------------------------------------------------------------

async fn abschliessen(pool: &SqlitePool, einsatz_id: i64) {
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(einsatz_id)
    .execute(pool)
    .await
    .unwrap();
}

/// Die Aufbewahrung markiert über den echten Betriebsweg (`soft_delete_einsatz`), ohne zu
/// schwärzen.
#[tokio::test]
async fn soft_geloeschter_demo_einsatz_wird_entfernt() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;
    abschliessen(&pool, demo.einsatz).await;
    assert!(
        crate::einsatz::repo::soft_delete_einsatz(&pool, demo.einsatz, "2026-09-24 10:00:00")
            .await
            .unwrap(),
        "Vorbedingung: soft-gelöscht"
    );

    entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo.einsatz
        )
        .await,
        0
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            demo.einsatz
        )
        .await,
        0,
        "auch der Audit-Eintrag der Aufbewahrung fällt mit"
    );
}

/// Soft-Delete und PII-Schwärzung über die echten Betriebswege (`soft_delete_einsatz`,
/// `schwaerze_einsatz`).
#[tokio::test]
async fn geschwaerzter_demo_einsatz_wird_entfernt() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;
    abschliessen(&pool, demo.einsatz).await;
    assert!(
        crate::einsatz::repo::soft_delete_einsatz(&pool, demo.einsatz, "2026-09-24 10:00:00")
            .await
            .unwrap()
    );
    assert!(
        crate::einsatz::repo::schwaerze_einsatz(&pool, demo.einsatz, "2026-09-25 10:00:00")
            .await
            .unwrap(),
        "Vorbedingung: geschwärzt"
    );

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo.einsatz
        )
        .await,
        0
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ?",
            demo.einsatz
        )
        .await,
        0
    );
    erwarte_zeile(&bericht, DemoStammdatenArt::Fahrzeug, 1, 0);
}

// ---------------------------------------------------------------------------------------------
// (g) Kopf zeigt auf einen echten Einsatz einer anderen Org
// ---------------------------------------------------------------------------------------------

/// Die Org im WHERE des Einsatz-DELETE ist die letzte Sperre: ein Kopf, dessen `einsatz_id`
/// auf einen echten Einsatz einer anderen Org zeigt, löscht ihn nicht. Der Import erzeugt so
/// einen Kopf nie; der Test prüft, dass der Löschweg sich nicht darauf verlässt.
///
/// Festgelegt: der Kopf wird trotzdem geschlossen. Er trägt keinen eigenen Einsatz, ein
/// offener Kopf sperrte den nächsten Import für immer. Die ID bleibt gesperrt, was bei einem
/// bestehenden Einsatz nichts ändert.
#[tokio::test]
async fn kopf_auf_fremdem_einsatz_loescht_ihn_nicht() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    org_anlegen(&pool, 2).await;
    let _admin_a = admin_anlegen(&pool, 1).await;
    let admin_b = admin_anlegen(&pool, 2).await;
    let fremd = einsatz_anlegen(&pool, admin_b, "Echter Einsatz Org 2").await;
    etb_anlegen(&pool, fremd, admin_b, 1).await;
    person_anlegen(&pool, fremd, admin_b, 1).await;
    let kopf = kopf_anlegen(&pool, 1, fremd).await;

    let bild_vorher = bild_einsatz(&pool, fremd).await;
    assert_eq!(bild_vorher[0].1.len(), 1, "Vorbedingung: der Einsatz steht");

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(bild_einsatz(&pool, fremd).await, bild_vorher);
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_import WHERE id = ? AND entfernt_at IS NOT NULL",
            kopf
        )
        .await,
        1,
        "der Kopf ist geschlossen"
    );
    for art in [
        DemoStammdatenArt::Fahrzeug,
        DemoStammdatenArt::Personal,
        DemoStammdatenArt::Material,
    ] {
        erwarte_zeile(&bericht, art, 0, 0);
    }
}

/// Auch das Stammdaten-DELETE trägt die Org: eine Marke, die auf eine Zeile einer fremden Org
/// zeigt, löscht sie nicht. Festgelegt: die Marke fällt, der Bericht zählt die Zeile weder als
/// entfernt noch als behalten — sie war nie ein Demo-Datensatz dieser Org.
#[tokio::test]
async fn marke_auf_fremder_stammdatenzeile_loescht_sie_nicht() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    org_anlegen(&pool, 2).await;
    let admin_a = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin_a).await;
    let fahrzeug_b = fahrzeug_anlegen(&pool, 2, "Florian Org 2").await;
    let personal_b = personal_anlegen(&pool, 2, "P-ORG2").await;
    let material_b = material_anlegen(&pool, 2, "M-ORG2").await;
    qualifizieren(&pool, 2, personal_b, "Truppführer").await;
    markieren(&pool, demo.kopf, "fahrzeug", fahrzeug_b).await;
    markieren(&pool, demo.kopf, "personal", personal_b).await;
    markieren(&pool, demo.kopf, "material", material_b).await;

    let stamm_b_vorher = bild_stammdaten(&pool, fahrzeug_b, personal_b, material_b).await;

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        bild_stammdaten(&pool, fahrzeug_b, personal_b, material_b).await,
        stamm_b_vorher,
        "die fremden Zeilen samt Qualifikation stehen unverändert"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_herkunft WHERE import_id = ?",
            demo.kopf
        )
        .await,
        0
    );
    erwarte_zeile(&bericht, DemoStammdatenArt::Fahrzeug, 1, 0);
    erwarte_zeile(&bericht, DemoStammdatenArt::Personal, 1, 0);
    erwarte_zeile(&bericht, DemoStammdatenArt::Material, 1, 0);
}

// ---------------------------------------------------------------------------------------------
// (h) Demo-Person mit Qualifikation, nirgends disponiert → samt Qualifikation weg
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn freie_demo_person_wird_samt_qualifikation_geloescht() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let einsatz = einsatz_anlegen(&pool, admin, "ÜBUNG – Demo").await;
    let personal = personal_anlegen(&pool, 1, "DEMO-P-001").await;
    qualifizieren(&pool, 1, personal, "Truppführer").await;
    qualifizieren(&pool, 1, personal, "Sprechfunker").await;
    let kopf = kopf_anlegen(&pool, 1, einsatz).await;
    markieren(&pool, kopf, "personal", personal).await;

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM personal WHERE id = ?",
            personal
        )
        .await,
        0
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM personal_qualifikation WHERE personal_id = ?",
            personal
        )
        .await,
        0
    );
    // Der Katalog selbst gehört nicht zur Person.
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM qualifikation WHERE org_id = ?",
            1
        )
        .await,
        2
    );
    erwarte_zeile(&bericht, DemoStammdatenArt::Personal, 1, 0);
    erwarte_zeile(&bericht, DemoStammdatenArt::Fahrzeug, 0, 0);
    erwarte_zeile(&bericht, DemoStammdatenArt::Material, 0, 0);
}

// ---------------------------------------------------------------------------------------------
// (i) Kopf bleibt als Historie, Marken leer
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn kopf_bleibt_mit_entfernt_at_und_bericht_marken_sind_leer() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;

    let bericht = entfernen(&pool, 1).await.expect("entfernen");

    let (einsatz_id, entfernt_at, gespeichert): (i64, Option<String>, String) =
        sqlx::query_as("SELECT einsatz_id, entfernt_at, bericht FROM demo_import WHERE id = ?")
            .bind(demo.kopf)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(einsatz_id, demo.einsatz, "die ID-Sperre bleibt");
    assert_eq!(entfernt_at.as_deref(), Some(bericht.zeitpunkt.as_str()));
    assert_eq!(
        serde_json::from_str::<DemoBericht>(&gespeichert).unwrap(),
        bericht,
        "der Kopf trägt den Bericht des Entfernens"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM demo_herkunft WHERE import_id = ?",
            demo.kopf
        )
        .await,
        0
    );
}

// ---------------------------------------------------------------------------------------------
// Fehlerklassen und Voraussetzungen
// ---------------------------------------------------------------------------------------------

/// Die Klassifikation hängt an echten SQLite-Fehlern: ein FK-Fehler ist „behalten“, eine
/// UNIQUE-Verletzung ist es nicht und bräche den Vorgang ab.
#[tokio::test]
async fn fk_klassifikation_an_echten_fehlern() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let einsatz = einsatz_anlegen(&pool, admin, "Einsatz").await;
    let fahrzeug = fahrzeug_anlegen(&pool, 1, "Florian").await;
    fahrzeug_disponieren(&pool, einsatz, fahrzeug).await;

    let fk = sqlx::query("DELETE FROM fahrzeug WHERE id = ?")
        .bind(fahrzeug)
        .execute(&pool)
        .await
        .expect_err("disponiertes Fahrzeug lässt sich nicht löschen");
    assert!(ist_fk_verletzung(&fk), "FK-Fehler: {fk:?}");
    if let sqlx::Error::Database(db) = &fk {
        assert_eq!(db.code().as_deref(), Some("787"), "erweiterter SQLite-Code");
    }

    kopf_anlegen(&pool, 1, einsatz).await;
    let unique =
        sqlx::query("INSERT INTO demo_import (org_id, einsatz_id, bericht) VALUES (1, ?, '{}')")
            .bind(einsatz)
            .execute(&pool)
            .await
            .expect_err("zweiter aktiver Kopf");
    assert!(
        !ist_fk_verletzung(&unique),
        "UNIQUE ist kein FK: {unique:?}"
    );
}

/// Ohne Fremdschlüsselprüfung gelänge jedes Stammdaten-DELETE, und Dispositionen echter
/// Einsätze zeigten ins Leere. Der Löschweg verweigert dann, statt still zu löschen.
#[tokio::test]
async fn ohne_fremdschluesselpruefung_bricht_der_loeschweg_ab() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;
    let echt = einsatz_anlegen(&pool, admin, "Echter Einsatz").await;
    fahrzeug_disponieren(&pool, echt, demo.fahrzeug).await;

    // `test_pool` hat genau eine Verbindung; das PRAGMA trifft also die des Löschwegs.
    sqlx::query("PRAGMA foreign_keys = OFF")
        .execute(&pool)
        .await
        .unwrap();

    let ergebnis = entfernen(&pool, 1).await;
    assert!(
        matches!(ergebnis, Err(AppError::Internal(_))),
        "erwartet: Internal, bekommen: {ergebnis:?}"
    );

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo.einsatz
        )
        .await,
        1,
        "nichts gelöscht"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE id = ?",
            demo.fahrzeug
        )
        .await,
        1
    );
}

/// Mit aufgeschobenen Fremdschlüsseln käme der Fehler erst beim COMMIT, der Savepoint je Zeile
/// sähe ihn nie. Das PRAGMA lässt sich innerhalb der Transaktion setzen; der Löschweg prüft es.
#[tokio::test]
async fn aufgeschobene_fremdschluessel_brechen_den_loeschweg_ab() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;

    let ergebnis = crate::write_retry!(&pool, |conn| {
        sqlx::query("PRAGMA defer_foreign_keys = ON")
            .execute(&mut *conn)
            .await?;
        entfernen_tx(conn, 1).await
    });
    assert!(
        matches!(ergebnis, Err(AppError::Internal(_))),
        "erwartet: Internal, bekommen: {ergebnis:?}"
    );
    assert_eq!(
        anzahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz WHERE id = ?",
            demo.einsatz
        )
        .await,
        1,
        "nichts gelöscht"
    );
}

/// Nur ein Fremdschlüsselfehler heißt „behalten“. Jeder andere Fehler mitten im Löschen der
/// Stammdaten bricht den ganzen Vorgang ab, und der Aufrufer rollt ALLES zurück, auch den
/// schon gelöschten Einsatz. Der Fehler hier ist echt: ein Trigger, der das Löschen von
/// Material mit `RAISE(ABORT)` verweigert (SQLite-Code 1811, kein FK).
#[tokio::test]
async fn anderer_fehler_bricht_den_ganzen_vorgang_ab() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let admin = admin_anlegen(&pool, 1).await;
    let demo = demo_anlegen(&pool, 1, admin).await;
    sqlx::query(
        "CREATE TEMP TRIGGER material_nicht_loeschen BEFORE DELETE ON material \
         BEGIN SELECT RAISE(ABORT, 'Material bleibt'); END",
    )
    .execute(&pool)
    .await
    .unwrap();

    let kopf_vorher = zeilen(&pool, "demo_import", "id = ?", demo.kopf).await;
    let marken_vorher = zeilen(&pool, "demo_herkunft", "import_id = ?", demo.kopf).await;
    let einsatz_vorher = bild_einsatz(&pool, demo.einsatz).await;
    let stamm_vorher = bild_stammdaten(&pool, demo.fahrzeug, demo.personal, demo.material).await;

    let ergebnis = entfernen(&pool, 1).await;
    match &ergebnis {
        Err(AppError::Database(e)) => assert!(!ist_fk_verletzung(e), "kein FK: {e:?}"),
        andere => panic!("erwartet: Datenbankfehler, bekommen: {andere:?}"),
    }

    assert_eq!(bild_einsatz(&pool, demo.einsatz).await, einsatz_vorher);
    assert_eq!(
        bild_stammdaten(&pool, demo.fahrzeug, demo.personal, demo.material).await,
        stamm_vorher
    );
    assert_eq!(
        zeilen(&pool, "demo_import", "id = ?", demo.kopf).await,
        kopf_vorher
    );
    assert_eq!(
        zeilen(&pool, "demo_herkunft", "import_id = ?", demo.kopf).await,
        marken_vorher
    );
}
