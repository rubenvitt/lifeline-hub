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
