use super::repo::{self, VorlageDaten};
use super::*;
use crate::einsatz::modul::NICHT_AUSBLENDBAR;
use sqlx::SqlitePool;

#[test]
fn startliste_nennt_nur_bekannte_modulschluessel() {
    for start in EINSATZ_VORLAGE_STARTLISTE {
        for key in start.sichtbar() {
            assert!(
                MODUL_KEYS.contains(&key),
                "{}: unbekannter Modulschlüssel {key}",
                start.bezeichnung
            );
        }
        for key in start.ausgeblendet() {
            assert!(MODUL_KEYS.contains(&key), "{}: {key}", start.bezeichnung);
        }
    }
}

#[test]
fn startliste_blendet_nicht_ausblendbare_module_nie_aus() {
    for start in EINSATZ_VORLAGE_STARTLISTE {
        let ausgeblendet = start.ausgeblendet();
        for key in NICHT_AUSBLENDBAR {
            assert!(
                !ausgeblendet.contains(&key),
                "{} blendet {key} aus",
                start.bezeichnung
            );
            assert!(start.sichtbar().contains(&key), "{}", start.bezeichnung);
        }
    }
}

#[test]
fn startliste_zeigt_die_modulzahlen_aus_dem_entwurf() {
    let zahlen: Vec<(&str, usize, usize)> = EINSATZ_VORLAGE_STARTLISTE
        .iter()
        .map(|s| {
            let mut sichtbar = s.sichtbar();
            let vorher = sichtbar.len();
            sichtbar.sort_unstable();
            sichtbar.dedup();
            assert_eq!(vorher, sichtbar.len(), "{}: Modul doppelt", s.bezeichnung);
            (s.bezeichnung, sichtbar.len(), s.ausgeblendet().len())
        })
        .collect();
    assert_eq!(
        zahlen,
        [
            ("Kleinlage", 14, 20),
            ("Sanitätsdienst", 22, 12),
            ("MANV", 27, 7),
            ("Personensuche", 25, 9),
            ("Evakuierung und Betreuung", 30, 4),
            ("Unwetter", 28, 6),
        ]
    );
}

#[test]
fn startliste_traegt_einsatzart_und_sortierung() {
    let werte: Vec<(&str, Einsatzart, i64)> = EINSATZ_VORLAGE_STARTLISTE
        .iter()
        .map(|s| (s.bezeichnung, s.einsatzart, s.sortier))
        .collect();
    assert_eq!(
        werte,
        [
            ("Kleinlage", Einsatzart::Realeinsatz, 10),
            ("Sanitätsdienst", Einsatzart::Sanitaetsdienst, 20),
            ("MANV", Einsatzart::Realeinsatz, 30),
            ("Personensuche", Einsatzart::Realeinsatz, 40),
            ("Evakuierung und Betreuung", Einsatzart::Realeinsatz, 50),
            ("Unwetter", Einsatzart::Realeinsatz, 60),
        ]
    );
}

#[test]
fn manv_blendet_stab_und_tiere_aus_und_zeigt_unfallhilfsstellen() {
    let manv = EINSATZ_VORLAGE_STARTLISTE
        .iter()
        .find(|s| s.bezeichnung == "MANV")
        .unwrap();
    let aus = manv.ausgeblendet();
    assert!(aus.contains(&"stab"));
    assert!(aus.contains(&"tiere"));
    assert!(!aus.contains(&"unfallhilfsstellen"));
}

#[test]
fn stab_steht_in_keiner_vorlage() {
    for start in EINSATZ_VORLAGE_STARTLISTE {
        assert!(
            start.ausgeblendet().contains(&"stab"),
            "{}",
            start.bezeichnung
        );
    }
}

#[test]
fn normalize_ausgeblendet_prueft_und_ordnet() {
    let ok = normalize_ausgeblendet(&["tiere".into(), "stab".into(), "tiere".into()]).unwrap();
    assert_eq!(ok, ["stab", "tiere"]);

    let err = normalize_ausgeblendet(&["gibtsnicht".into()]).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    let err = normalize_ausgeblendet(&["einsatzdaten".into()]).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    let err = normalize_ausgeblendet(&["einsatz-einstellungen".into()]).unwrap_err();
    assert!(matches!(err, AppError::Validation(_)), "{err:?}");
}

async fn org_anlegen(pool: &SqlitePool, id: i64) {
    sqlx::query("INSERT INTO organisation (id, name) VALUES (?, 'Orga')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

fn daten<'a>(bezeichnung: &'a str, aus: &'a [&'a str]) -> VorlageDaten<'a> {
    VorlageDaten {
        bezeichnung,
        einsatzart: None,
        schichtmodell_id: None,
        ausgeblendet: aus,
    }
}

#[tokio::test]
async fn anlegen_aendern_loeschen_je_organisation() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    org_anlegen(&pool, 2).await;

    let a = repo::create(&pool, 1, daten("Großbrand", &["tiere"]))
        .await
        .unwrap();
    assert_eq!(a.ausgeblendet, ["tiere"]);
    assert_eq!(a.sortier, 10);
    let b = repo::create(&pool, 1, daten("Hochwasser", &[]))
        .await
        .unwrap();
    assert_eq!(b.sortier, 20, "neue Vorlage ans Ende");

    // Dieselbe Bezeichnung in einer anderen Organisation ist frei, in derselben nicht.
    repo::create(&pool, 2, daten("Großbrand", &[]))
        .await
        .unwrap();
    let err = repo::create(&pool, 1, daten("Großbrand", &[]))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "{err:?}");

    // Vollersatz: Modulmenge und Einsatzart, sortier bleibt.
    let geaendert = repo::update(
        &pool,
        1,
        a.id,
        VorlageDaten {
            bezeichnung: "Großbrand groß",
            einsatzart: Some(Einsatzart::Uebung),
            schichtmodell_id: None,
            ausgeblendet: &["stab", "chat"],
        },
    )
    .await
    .unwrap();
    assert_eq!(geaendert.bezeichnung, "Großbrand groß");
    assert_eq!(geaendert.einsatzart, Some(Einsatzart::Uebung));
    assert_eq!(
        geaendert.ausgeblendet,
        ["stab", "chat"],
        "Ordnung wie MODUL_KEYS"
    );
    assert_eq!(geaendert.sortier, 10);

    // Fremde Organisation: weder ändern noch löschen.
    let err = repo::update(&pool, 2, a.id, daten("X", &[]))
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::NotFound), "{err:?}");
    let err = repo::delete(&pool, 2, a.id).await.unwrap_err();
    assert!(matches!(err, AppError::NotFound), "{err:?}");

    let liste = repo::list(&pool, 1).await.unwrap();
    assert_eq!(
        liste
            .iter()
            .map(|v| v.bezeichnung.as_str())
            .collect::<Vec<_>>(),
        ["Großbrand groß", "Hochwasser"]
    );

    repo::delete(&pool, 1, a.id).await.unwrap();
    let rest: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_vorlage_modul_aus WHERE vorlage_id = ?")
            .bind(a.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rest, 0, "Modulmenge fällt mit der Vorlage");
    assert!(repo::load_for_org(&pool, 1, a.id).await.unwrap().is_none());
}

#[tokio::test]
async fn seed_entspricht_der_startliste() {
    let pool = crate::db::test_pool().await;
    org_anlegen(&pool, 1).await;
    let mut conn = pool.acquire().await.unwrap();
    repo::seed_startliste_tx(&mut conn, 1).await.unwrap();
    drop(conn);

    let liste = repo::list(&pool, 1).await.unwrap();
    assert_eq!(liste.len(), EINSATZ_VORLAGE_STARTLISTE.len());
    for (vorlage, start) in liste.iter().zip(EINSATZ_VORLAGE_STARTLISTE) {
        assert_eq!(vorlage.bezeichnung, start.bezeichnung);
        assert_eq!(vorlage.einsatzart, Some(start.einsatzart));
        assert_eq!(vorlage.sortier, start.sortier);
        assert_eq!(vorlage.ausgeblendet, start.ausgeblendet());
    }
}
