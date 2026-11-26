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

#[test]
fn normalize_email_nimmt_eine_adresse() {
    assert_eq!(
        super::kanal::normalize_email(" Lage@Leitstelle-Nord.de ").unwrap(),
        "Lage@leitstelle-nord.de"
    );
}

#[test]
fn normalize_email_lehnt_mehrere_und_anzeigenamen_ab() {
    let zu_lang = format!("{}@b.de", "a".repeat(250));
    for roh in [
        "a@b.de, c@d.de",
        "Nord <a@b.de>",
        "",
        "   ",
        "ohne-at.de",
        zu_lang.as_str(),
    ] {
        assert!(
            super::kanal::normalize_email(roh).is_err(),
            "{roh:?} muss abgelehnt werden"
        );
    }
    assert!(super::kanal::normalize_email(&"x".repeat(255)).is_err());
}

#[test]
fn email_fax_und_matrix_sind_freigeschaltet_threema_nicht() {
    use super::KanalArt;
    assert!(KanalArt::Email.is_freigeschaltet());
    assert!(KanalArt::Fax.is_freigeschaltet());
    assert!(KanalArt::Matrix.is_freigeschaltet());
    for k in [KanalArt::Threema] {
        assert!(!k.is_freigeschaltet());
    }
}

#[test]
fn matrix_raum_id_und_alias_werden_angenommen() {
    assert_eq!(
        super::kanal::normalize_matrix("!abc:example.org").unwrap(),
        "!abc:example.org"
    );
    assert_eq!(
        super::kanal::normalize_matrix(" #lage:example.org ").unwrap(),
        "#lage:example.org"
    );
}

#[test]
fn faxnummern_in_alltagsform_werden_e164() {
    use super::kanal::normalize_fax;
    assert_eq!(normalize_fax("0511 / 123 45-6").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("+49 (0) 511 123456").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("0049 511 123456").unwrap(), "+49511123456");
    assert_eq!(normalize_fax(" (0511) 123456 ").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("+43 1 58801").unwrap(), "+43158801");
    assert_eq!(normalize_fax("+49.511.123456").unwrap(), "+49511123456");
    assert!(normalize_fax("511 123").is_err(), "ohne 0, 00 oder +");
    assert!(normalize_fax("+49 12").is_err(), "unter 8 Ziffern");
    assert!(
        normalize_fax("+49 1234 5678 9012 34").is_err(),
        "über 15 Ziffern"
    );
    assert!(normalize_fax("0511 abc").is_err());
    assert!(normalize_fax("").is_err());
    assert!(
        normalize_fax("+0511123456").is_err(),
        "Länderkennung beginnt nie mit 0"
    );
}

#[test]
fn matrix_nutzer_id_wird_mit_eigenem_text_abgelehnt() {
    let fehler = super::kanal::normalize_matrix("@a:example.org").unwrap_err();
    assert!(fehler.contains("Nutzer-IDs"), "{fehler}");
}

#[test]
fn matrix_to_link_wird_mit_eigenem_text_abgelehnt() {
    for roh in [
        "https://matrix.to/#/#lage:example.org",
        " https://matrix.to/#/!abc:example.org ",
    ] {
        assert_eq!(
            super::kanal::normalize_matrix(roh).unwrap_err(),
            "matrix.to-Links gehen nicht, bitte Raum-ID oder Alias eintragen"
        );
    }
}

#[test]
fn matrix_ungueltige_adressen_werden_abgelehnt() {
    for roh in [
        "",
        "  ",
        "abc",
        "#lage",
        "lage@example.org",
        "!a b:example.org",
    ] {
        assert!(
            super::kanal::normalize_matrix(roh).is_err(),
            "{roh:?} muss abgelehnt werden"
        );
    }
}

#[test]
fn matrix_adresse_ueber_255_bytes_abgelehnt() {
    let zu_lang = format!("#{}:example.org", "a".repeat(250));
    assert!(zu_lang.len() > 255);
    assert!(super::kanal::normalize_matrix(&zu_lang).is_err());
}

#[test]
fn die_null_der_vorwahl_hinter_plus_49_faellt_weg_und_jeder_leerraum_zaehlt_nicht() {
    use super::kanal::normalize_fax;
    assert_eq!(normalize_fax("+49 (0511) 123456").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("+49 0511 123456").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("0049 0511 123456").unwrap(), "+49511123456");
    assert_eq!(normalize_fax("0511\u{a0}123456").unwrap(), "+49511123456");
    assert_eq!(
        normalize_fax("0511\t123\u{2009}456").unwrap(),
        "+49511123456"
    );
    // Nur bei +49: andere Länder behalten ihre Ziffern (Italien wählt die 0 mit).
    assert_eq!(normalize_fax("+39 06 1234567").unwrap(), "+39061234567");
}

mod fax_eigenschaften {
    use super::super::kanal::normalize_fax;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn jede_angenommene_nummer_ist_e164_und_bleibt_bei_erneuter_pruefung_gleich(roh in "[ 0-9+()/.-]{0,30}") {
            if let Ok(n) = normalize_fax(&roh) {
                prop_assert!(n.starts_with('+'));
                let ziffern = &n[1..];
                prop_assert!(ziffern.chars().all(|c| c.is_ascii_digit()));
                prop_assert!((8..=15).contains(&ziffern.len()), "{}", n);
                prop_assert!(!ziffern.starts_with('0'));
                prop_assert_eq!(normalize_fax(&n).unwrap(), n);
            }
        }
    }
}

#[tokio::test]
async fn kanal_check_entspricht_der_art() {
    let pool = crate::db::test_pool().await;
    let sql: String = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'org_externe_stelle_kanal'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let start = sql
        .find("CHECK (kanal IN (")
        .expect("CHECK des Kanals fehlt");
    let rest = &sql[start + "CHECK (kanal IN (".len()..];
    let mut liste: Vec<String> = rest[..rest.find(')').unwrap()]
        .split(',')
        .map(|w| w.trim().trim_matches('\'').to_string())
        .collect();
    let mut erwartet: Vec<String> = super::KanalArt::ALLE
        .iter()
        .map(|a| a.as_str().to_string())
        .collect();
    liste.sort();
    erwartet.sort();
    assert_eq!(liste, erwartet);
}
