//! Personensuche im Archivblock (LLH-1712, Spec `aufbewahrung-loeschersuchen`, „Personensuche im
//! Archivblock“).

use super::*;
use crate::einsatz::archiv::loeschersuchen::tests::{archiv, schluessel_von};

async fn spur(pool: &SqlitePool) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT ziel, COALESCE(detail, '') FROM admin_audit WHERE aktion = 'archiv_durchsucht'",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn treffer_mit_kennung_und_namen_spur_ohne_suchtext() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let vorher: Vec<(String, Vec<u8>)> =
        sqlx::query_as("SELECT sha256, inhalt FROM einsatz_archiv ORDER BY block")
            .fetch_all(&pool)
            .await
            .unwrap();

    let treffer = suchen(
        &pool,
        a.einsatz,
        &schluessel_von(&a.identitaet),
        "mustermann",
        Utc::now(),
    )
    .await
    .unwrap();
    assert_eq!(
        treffer,
        vec![Treffer {
            art: PersonenArt::Betroffene,
            kennung: "R-001".into(),
            erfasst_at: treffer[0].erfasst_at.clone(),
            name: "Erika Mustermann".into(),
        }]
    );
    // Wie die Suche am Einsatz: nur ganze Wörter, und nie über die Rufnummer der meldenden
    // Person.
    assert!(suchen(
        &pool,
        a.einsatz,
        &schluessel_von(&a.identitaet),
        "0160 1111111",
        Utc::now(),
    )
    .await
    .unwrap()
    .is_empty());
    let ueber_namen = suchen(
        &pool,
        a.einsatz,
        &schluessel_von(&a.identitaet),
        "max nachbar",
        Utc::now(),
    )
    .await
    .unwrap();
    assert_eq!(ueber_namen.len(), 1);
    assert_eq!(ueber_namen[0].kennung, "R-002");
    assert_eq!(ueber_namen[0].name, "Max Nachbar");

    let s = spur(&pool).await;
    assert_eq!(s.len(), 3, "{s:?}");
    for (ziel, detail) in &s {
        for verboten in ["mustermann", "Mustermann", "0160"] {
            assert!(
                !ziel.contains(verboten) && !detail.contains(verboten),
                "{ziel} {detail}"
            );
        }
    }
    // Das Archiv ist unverändert, und keine Zwischendatei bleibt liegen.
    let nachher: Vec<(String, Vec<u8>)> =
        sqlx::query_as("SELECT sha256, inhalt FROM einsatz_archiv ORDER BY block")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(vorher, nachher);
    let verzeichnis = super::super::bauen::verzeichnis(&pool).await.unwrap();
    let liegen = std::fs::read_dir(verzeichnis)
        .unwrap()
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.starts_with("lifeline-zwischen-archiv-")
                && n.contains(&format!(
                    "-{}-{}",
                    a.einsatz,
                    super::super::bauen::TEIL_PERSONEN
                ))
        })
        .count();
    assert_eq!(liegen, 0);
}

#[tokio::test]
async fn kurzer_suchtext_ohne_spur() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let e = suchen(
        &pool,
        a.einsatz,
        &schluessel_von(&a.identitaet),
        " mu ",
        Utc::now(),
    )
    .await
    .unwrap_err();
    assert!(matches!(e, AppError::Validation(_)), "{e:?}");
    assert!(spur(&pool).await.is_empty());
}

#[tokio::test]
async fn falscher_schluessel_ohne_spur() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    let fremd = age::x25519::Identity::generate();
    let e = suchen(
        &pool,
        a.einsatz,
        &schluessel_von(&fremd),
        "mustermann",
        Utc::now(),
    )
    .await
    .unwrap_err();
    assert!(
        matches!(e, AppError::Validation(ref m) if m.contains("passt nicht")),
        "{e:?}"
    );
    assert!(spur(&pool).await.is_empty());
}

#[tokio::test]
async fn ohne_archiv_kein_treffer() {
    let pool = crate::db::test_pool().await;
    let a = archiv(&pool).await;
    sqlx::query("DELETE FROM einsatz_archiv")
        .execute(&pool)
        .await
        .unwrap();
    let e = suchen(
        &pool,
        a.einsatz,
        &schluessel_von(&a.identitaet),
        "mustermann",
        Utc::now(),
    )
    .await
    .unwrap_err();
    assert!(
        matches!(e, AppError::Validation(ref m) if m.contains("kein Archiv")),
        "{e:?}"
    );
}
