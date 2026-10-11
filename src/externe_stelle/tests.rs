use super::repo::{self, NeueStelle, StellePatch};
use super::ExterneStelleArt;
use crate::error::AppError;
use sqlx::SqlitePool;

async fn org(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO organisation (name) VALUES (?) RETURNING id")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn stelle(bezeichnung: &str, art: ExterneStelleArt) -> NeueStelle<'_> {
    NeueStelle {
        bezeichnung,
        art,
        rufnummer: None,
        funkrufname: None,
        zustaendig: false,
    }
}

async fn create_stelle(pool: &SqlitePool, org_id: i64, b: &str, art: ExterneStelleArt) -> i64 {
    repo::create(pool, org_id, stelle(b, art)).await.unwrap().id
}

fn zustaendig() -> StellePatch<'static> {
    StellePatch {
        zustaendig: Some(true),
        ..Default::default()
    }
}

#[tokio::test]
async fn check_liste_entspricht_der_art() {
    let pool = crate::db::test_pool().await;
    let sql: String = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'org_externe_stelle'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let start = sql.find("CHECK (art IN (").expect("CHECK der Art fehlt");
    let rest = &sql[start + "CHECK (art IN (".len()..];
    let mut liste: Vec<String> = rest[..rest.find(')').unwrap()]
        .split(',')
        .map(|w| w.trim().trim_matches('\'').to_string())
        .collect();
    let mut erwartet: Vec<String> = ExterneStelleArt::ALLE
        .iter()
        .map(|a| a.as_str().to_string())
        .collect();
    liste.sort();
    erwartet.sort();
    assert_eq!(liste, erwartet);
}

#[tokio::test]
async fn liste_sortiert_nach_art_dann_zustaendig_dann_name() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    create_stelle(&pool, o, "Ordnungsamt", ExterneStelleArt::Behoerde).await;
    create_stelle(&pool, o, "Polizei Nord", ExterneStelleArt::Polizei).await;
    create_stelle(&pool, o, "ILS Alt", ExterneStelleArt::Leitstelle).await;
    let z = create_stelle(&pool, o, "ILS Zentral", ExterneStelleArt::Leitstelle).await;
    create_stelle(&pool, o, "DRK", ExterneStelleArt::Hilfsorganisation).await;
    create_stelle(&pool, o, "anderes", ExterneStelleArt::Sonstige).await;
    repo::update(&pool, o, z, zustaendig()).await.unwrap();

    let namen: Vec<String> = repo::list(&pool, o, true)
        .await
        .unwrap()
        .into_iter()
        .map(|s| s.bezeichnung)
        .collect();
    assert_eq!(
        namen,
        [
            "ILS Zentral",
            "ILS Alt",
            "Polizei Nord",
            "Ordnungsamt",
            "DRK",
            "anderes"
        ]
    );
}

#[tokio::test]
async fn liste_ohne_inaktive_nur_auf_wunsch_mit() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let id = create_stelle(&pool, o, "Ordnungsamt", ExterneStelleArt::Behoerde).await;
    let aus = StellePatch {
        aktiv: Some(false),
        ..Default::default()
    };
    assert!(!repo::update(&pool, o, id, aus).await.unwrap().aktiv);

    assert!(repo::list(&pool, o, true).await.unwrap().is_empty());
    let alle = repo::list(&pool, o, false).await.unwrap();
    assert_eq!(alle.len(), 1);
    assert!(!alle[0].aktiv);

    let an = StellePatch {
        aktiv: Some(true),
        ..Default::default()
    };
    assert!(repo::update(&pool, o, id, an).await.unwrap().aktiv);
    assert_eq!(repo::list(&pool, o, true).await.unwrap().len(), 1);
}

#[tokio::test]
async fn doppelte_bezeichnung_ist_conflict_auch_beim_umbenennen() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    create_stelle(&pool, o, "Polizei", ExterneStelleArt::Polizei).await;
    let zweite = create_stelle(&pool, o, "Ordnungsamt", ExterneStelleArt::Behoerde).await;
    assert!(matches!(
        repo::create(&pool, o, stelle("Polizei", ExterneStelleArt::Sonstige)).await,
        Err(AppError::Conflict(_))
    ));
    let umbenennen = StellePatch {
        bezeichnung: Some("Polizei"),
        ..Default::default()
    };
    assert!(matches!(
        repo::update(&pool, o, zweite, umbenennen).await,
        Err(AppError::Conflict(_))
    ));
}

#[tokio::test]
async fn markierung_wechselt_auf_die_neue_leitstelle() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let nord = create_stelle(&pool, o, "ILS Nord", ExterneStelleArt::Leitstelle).await;
    let sued = create_stelle(&pool, o, "ILS Süd", ExterneStelleArt::Leitstelle).await;
    repo::update(&pool, o, nord, zustaendig()).await.unwrap();
    repo::update(&pool, o, sued, zustaendig()).await.unwrap();

    assert!(!repo::load(&pool, o, nord).await.unwrap().zustaendig);
    assert!(repo::load(&pool, o, sued).await.unwrap().zustaendig);
}

#[tokio::test]
async fn anlegen_als_zustaendig_nimmt_die_bisherige_markierung() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let alt = create_stelle(&pool, o, "ILS Alt", ExterneStelleArt::Leitstelle).await;
    repo::update(&pool, o, alt, zustaendig()).await.unwrap();
    let neu = repo::create(
        &pool,
        o,
        NeueStelle {
            zustaendig: true,
            ..stelle("ILS Neu", ExterneStelleArt::Leitstelle)
        },
    )
    .await
    .unwrap();
    assert!(neu.zustaendig);
    assert!(!repo::load(&pool, o, alt).await.unwrap().zustaendig);
}

#[tokio::test]
async fn markierung_nur_an_aktiver_leitstelle() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let polizei = create_stelle(&pool, o, "Polizei", ExterneStelleArt::Polizei).await;
    assert!(matches!(
        repo::update(&pool, o, polizei, zustaendig()).await,
        Err(AppError::UnprocessableEntity(_))
    ));
    assert!(matches!(
        repo::create(
            &pool,
            o,
            NeueStelle {
                zustaendig: true,
                ..stelle("Amt", ExterneStelleArt::Behoerde)
            }
        )
        .await,
        Err(AppError::UnprocessableEntity(_))
    ));

    let ils = create_stelle(&pool, o, "ILS", ExterneStelleArt::Leitstelle).await;
    let beides = StellePatch {
        aktiv: Some(false),
        zustaendig: Some(true),
        ..Default::default()
    };
    assert!(matches!(
        repo::update(&pool, o, ils, beides).await,
        Err(AppError::UnprocessableEntity(_))
    ));
    let aus = StellePatch {
        aktiv: Some(false),
        ..Default::default()
    };
    repo::update(&pool, o, ils, aus).await.unwrap();
    assert!(matches!(
        repo::update(&pool, o, ils, zustaendig()).await,
        Err(AppError::UnprocessableEntity(_))
    ));
}

#[tokio::test]
async fn artwechsel_der_zustaendigen_ist_422_und_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let ils = create_stelle(&pool, o, "ILS", ExterneStelleArt::Leitstelle).await;
    repo::update(&pool, o, ils, zustaendig()).await.unwrap();
    let art = StellePatch {
        art: Some(ExterneStelleArt::Behoerde),
        bezeichnung: Some("Amt"),
        ..Default::default()
    };
    assert!(matches!(
        repo::update(&pool, o, ils, art).await,
        Err(AppError::UnprocessableEntity(_))
    ));
    let nachher = repo::load(&pool, o, ils).await.unwrap();
    assert_eq!(nachher.art, ExterneStelleArt::Leitstelle);
    assert_eq!(nachher.bezeichnung, "ILS");
    assert!(nachher.zustaendig);

    // Mit abgenommener Markierung geht der Artwechsel.
    let beides = StellePatch {
        art: Some(ExterneStelleArt::Behoerde),
        zustaendig: Some(false),
        ..Default::default()
    };
    let neu = repo::update(&pool, o, ils, beides).await.unwrap();
    assert_eq!(neu.art, ExterneStelleArt::Behoerde);
    assert!(!neu.zustaendig);
}

#[tokio::test]
async fn deaktivieren_nimmt_die_markierung() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let ils = create_stelle(&pool, o, "ILS", ExterneStelleArt::Leitstelle).await;
    repo::update(&pool, o, ils, zustaendig()).await.unwrap();
    let aus = StellePatch {
        aktiv: Some(false),
        ..Default::default()
    };
    let nachher = repo::update(&pool, o, ils, aus).await.unwrap();
    assert!(!nachher.aktiv);
    assert!(!nachher.zustaendig);
}

#[tokio::test]
async fn patch_setzt_jede_spalte_an_ihren_platz_und_leert_optionale() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let id = repo::create(
        &pool,
        o,
        NeueStelle {
            rufnummer: Some("112"),
            funkrufname: Some("Leitstelle Musterkreis"),
            ..stelle("ILS", ExterneStelleArt::Leitstelle)
        },
    )
    .await
    .unwrap()
    .id;

    let neu = repo::update(
        &pool,
        o,
        id,
        StellePatch {
            bezeichnung: Some("ILS Musterkreis"),
            rufnummer: Some(Some("0800 1")),
            funkrufname: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(neu.bezeichnung, "ILS Musterkreis");
    assert_eq!(neu.rufnummer.as_deref(), Some("0800 1"));
    assert_eq!(neu.funkrufname, None);
    assert_eq!(neu.art, ExterneStelleArt::Leitstelle);
    assert!(neu.aktiv);

    let unveraendert = repo::update(&pool, o, id, StellePatch::default())
        .await
        .unwrap();
    assert_eq!(unveraendert.bezeichnung, "ILS Musterkreis");
    assert_eq!(unveraendert.rufnummer.as_deref(), Some("0800 1"));
}

#[tokio::test]
async fn org_grenze_liste_laden_und_patch() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    let id_a = create_stelle(&pool, a, "Polizei", ExterneStelleArt::Polizei).await;
    // Gleicher Name in der anderen Organisation ist erlaubt.
    create_stelle(&pool, b, "Polizei", ExterneStelleArt::Polizei).await;

    let liste_b = repo::list(&pool, b, false).await.unwrap();
    assert_eq!(liste_b.len(), 1);
    assert_ne!(liste_b[0].id, id_a);
    assert!(matches!(
        repo::load(&pool, b, id_a).await,
        Err(AppError::NotFound)
    ));
    let fremd = StellePatch {
        bezeichnung: Some("fremd"),
        ..Default::default()
    };
    assert!(matches!(
        repo::update(&pool, b, id_a, fremd).await,
        Err(AppError::NotFound)
    ));
    assert_eq!(
        repo::load(&pool, a, id_a).await.unwrap().bezeichnung,
        "Polizei"
    );
}
