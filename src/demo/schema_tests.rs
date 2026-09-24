//! Schema-Zusicherungen der Demo-Daten (LFH-690, design.md D4/D7) gegen die voll migrierte DB.
//!
//! Hier steht bewusst keine Import-Logik: die Tests prüfen nur, was die Migration
//! `0121_demo_daten.sql` und das übrige Schema dem späteren Import und Löschweg zusichern.

use sqlx::SqlitePool;

async fn org_anlegen(pool: &SqlitePool, id: i64) {
    sqlx::query("INSERT INTO organisation (id, name) VALUES (?, ?)")
        .bind(id)
        .bind(format!("Org {id}"))
        .execute(pool)
        .await
        .unwrap();
}

async fn kopf_anlegen(pool: &SqlitePool, org_id: i64, einsatz_id: i64) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO demo_import (org_id, einsatz_id, bericht) VALUES (?, ?, '{}') RETURNING id",
    )
    .bind(org_id)
    .bind(einsatz_id)
    .fetch_one(pool)
    .await
}

fn ist_unique_verletzung(fehler: &sqlx::Error) -> bool {
    matches!(fehler, sqlx::Error::Database(e) if e.is_unique_violation())
}

/// Höchstens ein aktiver Import je Organisation (Spec „Herkunftsmarke“): der partielle
/// UNIQUE-Index hält das Rennen zweier gleichzeitiger Importe. Ein entfernter Kopf bleibt als
/// Historie stehen und sperrt keinen neuen Import, und eine zweite Organisation ist frei.
#[tokio::test]
async fn zweiter_aktiver_import_je_org_scheitert_am_partiellen_index() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    org_anlegen(&pool, 2).await;

    let erster = kopf_anlegen(&pool, 1, 7).await.expect("erster Kopf");

    let zweiter = kopf_anlegen(&pool, 1, 8)
        .await
        .expect_err("zweiter aktiver Kopf derselben Org muss scheitern");
    assert!(
        ist_unique_verletzung(&zweiter),
        "erwartet: UNIQUE-Verletzung, bekommen: {zweiter:?}"
    );

    kopf_anlegen(&pool, 2, 9)
        .await
        .expect("eine andere Org darf gleichzeitig einen aktiven Kopf haben");

    sqlx::query("UPDATE demo_import SET entfernt_at = datetime('now') WHERE id = ?")
        .bind(erster)
        .execute(&pool)
        .await
        .unwrap();
    kopf_anlegen(&pool, 1, 10)
        .await
        .expect("nach dem Entfernen ist ein neuer aktiver Kopf zulässig");

    let historie: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM demo_import WHERE org_id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(historie, 2, "der entfernte Kopf bleibt als Historie stehen");
}

/// Ein Fremdschlüssel, der auf eine Stammdatentabelle zeigt.
#[derive(Debug, sqlx::FromRow)]
struct StammdatenFk {
    tabelle: String,
    spalte: String,
    ziel: String,
    on_delete: String,
}

/// Alle Fremdschlüssel aller Tabellen, die auf `fahrzeug`, `personal` oder `material` zeigen.
async fn eingehende_stammdaten_fks(pool: &SqlitePool) -> Vec<StammdatenFk> {
    sqlx::query_as(
        "SELECT m.name AS tabelle, f.\"from\" AS spalte, lower(f.\"table\") AS ziel, \
                f.on_delete AS on_delete \
         FROM sqlite_master m, pragma_foreign_key_list(m.name) f \
         WHERE m.type = 'table' AND lower(f.\"table\") IN ('fahrzeug', 'personal', 'material') \
         ORDER BY ziel, m.name, f.\"from\"",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

/// ON-DELETE-Aktionen, bei denen das Löschen einer noch verwiesenen Zeile SCHEITERT. Nur darauf
/// baut der Savepoint-Löschweg aus D7 (SQLite-Code 787 → „behalten“).
const LOESCHEN_SCHEITERT: [&str; 2] = ["NO ACTION", "RESTRICT"];

/// Was der Löschweg aus D7 nicht verträgt: ein Fremdschlüssel auf eine Stammdatentabelle mit
/// einer anderen ON-DELETE-Aktion als `NO ACTION`/`RESTRICT` und ein aufgeschobener
/// Fremdschlüssel irgendwo im Schema. Mit `CASCADE`, `SET NULL` oder `SET DEFAULT` gelänge das
/// Löschen einer noch verwiesenen Demo-Stammdatenzeile und löschte oder änderte dabei still
/// eine Zeile eines fremden, echten Einsatzes. Mit einem aufgeschobenen Fremdschlüssel käme der
/// Fehler erst beim COMMIT, und der Savepoint je Zeile griffe nicht.
async fn loeschweg_verstoesse(pool: &SqlitePool) -> Vec<String> {
    let mut verstoesse: Vec<String> = eingehende_stammdaten_fks(pool)
        .await
        .into_iter()
        .filter(|fk| {
            !LOESCHEN_SCHEITERT
                .iter()
                .any(|aktion| fk.on_delete.eq_ignore_ascii_case(aktion))
        })
        .map(|fk| {
            format!(
                "{}.{} → {} ON DELETE {} (erlaubt: NO ACTION, RESTRICT)",
                fk.tabelle, fk.spalte, fk.ziel, fk.on_delete
            )
        })
        .collect();
    // LIKE ist für ASCII ohne Groß-/Kleinschreibung. Das Schlüsselwort darf deshalb auch in
    // keinem DDL-Kommentar stehen: `sqlite_master.sql` bewahrt Kommentare im CREATE auf.
    let aufgeschoben: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE sql LIKE '%deferrable%' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    verstoesse.extend(
        aufgeschoben
            .into_iter()
            .map(|name| format!("{name}: aufgeschobener Fremdschlüssel im Schema")),
    );
    verstoesse
}

/// LFH-690 D7: Jeder Fremdschlüssel auf `fahrzeug`/`personal`/`material` trägt `ON DELETE
/// NO ACTION` oder `RESTRICT` (kein `CASCADE`, `SET NULL`, `SET DEFAULT`), und keiner im Schema
/// ist aufgeschoben. Nur dann scheitert das Löschen einer noch verwiesenen Stammdatenzeile, und
/// der Savepoint je Zeile erkennt „wird noch verwiesen“ zuverlässig über SQLite-Code 787, ohne
/// handgepflegte Verweisliste.
///
/// Die Positivkontrolle darunter hält den Guard ehrlich: fände die Abfrage gar keine
/// eingehenden Fremdschlüssel (Tippfehler im Tabellennamen, Quoting), bliebe er für immer grün.
/// Umgekehrt färbte eine abweichende Schreibweise der Aktion im PRAGMA den Guard rot, nicht grün.
#[tokio::test]
async fn kein_fk_kaskadiert_in_stammdaten() {
    let pool = crate::db::test_pool().await;

    let eingehend = eingehende_stammdaten_fks(&pool).await;
    for ziel in ["fahrzeug", "personal", "material"] {
        assert!(
            eingehend.iter().any(|fk| fk.ziel == ziel),
            "Positivkontrolle: kein eingehender Fremdschlüssel auf {ziel} gefunden — \
             die Abfrage sieht das Schema nicht, der Guard prüfte ins Leere: {eingehend:?}"
        );
    }

    let verstoesse = loeschweg_verstoesse(&pool).await;
    assert!(
        verstoesse.is_empty(),
        "Der Demo-Löschweg (D7) verträgt diese Fremdschlüssel nicht:\n  {}",
        verstoesse.join("\n  ")
    );
}
