use std::collections::HashMap;

use super::*;

fn wert<'a>(r: &'a UnterkunftRichtwerte, schluessel: &str) -> &'a RichtwertEbenen {
    r.werte
        .iter()
        .find(|w| w.schluessel == schluessel)
        .expect("Schlüssel vorhanden")
}

#[test]
fn basis_ist_lesbar() {
    assert!(!basis().is_empty());
    assert_eq!(stand(), "2026-11-01");
    let flaeche = basiswert("flaeche_je_person_m2").expect("Fläche je Person");
    assert_eq!(flaeche.wert, 4.0);
    for b in basis() {
        assert!(
            b.min <= b.wert && b.wert <= b.max,
            "{} in den Grenzen",
            b.schluessel
        );
    }
}

#[test]
fn pruefe_grenzen_ganzzahl_und_unbekannt() {
    assert!(pruefe("flaeche_je_person_m2", 3.5).is_ok());
    assert!(matches!(
        pruefe("flaeche_je_person_m2", 0.5),
        Err(AppError::Validation(m)) if m.contains("zwischen 1 und 20")
    ));
    assert!(pruefe("flaeche_je_person_m2", f64::NAN).is_err());
    assert!(matches!(
        pruefe("zelt_sg30_schlafplaetze", 10.5),
        Err(AppError::Validation(m)) if m.contains("ganze Zahl")
    ));
    assert!(matches!(
        pruefe("foo", 1.0),
        Err(AppError::Validation(m)) if m.contains("'foo'")
    ));
    assert!(pruefe_schluessel("foo").is_err());
    assert!(pruefe_schluessel("wasser_je_person_l").is_ok());
}

#[test]
fn einsatz_vor_organisation_vor_basis() {
    let org = HashMap::from([("flaeche_je_person_m2".to_string(), 3.5)]);
    let einsatz = HashMap::from([("flaeche_je_person_m2".to_string(), 5.0)]);

    let r = zusammenfuehren(&org, Some(&einsatz));
    let f = wert(&r, "flaeche_je_person_m2");
    assert_eq!((f.wert, f.herkunft), (5.0, RichtwertHerkunft::Einsatz));
    assert_eq!((f.basis, f.org, f.einsatz), (4.0, Some(3.5), Some(5.0)));

    let r = zusammenfuehren(&org, Some(&HashMap::new()));
    let f = wert(&r, "flaeche_je_person_m2");
    assert_eq!((f.wert, f.herkunft), (3.5, RichtwertHerkunft::Org));

    let w = wert(&r, "wasser_je_person_l");
    assert_eq!((w.wert, w.herkunft), (25.0, RichtwertHerkunft::Basis));
    assert_eq!(
        r.werte.len(),
        basis().len(),
        "jeder Schlüssel der Basis kommt vor"
    );
}

#[test]
fn unbekannter_schluessel_in_der_datenbank_faellt_weg() {
    let org = HashMap::from([("entfernt".to_string(), 1.0)]);
    let r = zusammenfuehren(&org, None);
    assert!(r.werte.iter().all(|w| w.schluessel != "entfernt"));
}

async fn grundlage(pool: &sqlx::SqlitePool) -> (i64, i64) {
    for org in [1, 2] {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(org)
            .execute(pool)
            .await
            .unwrap();
    }
    let b: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'admin', 'admin', 'h') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let e: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (b, e)
}

#[tokio::test]
async fn org_werte_setzen_leeren_und_isoliert() {
    let pool = crate::db::test_pool().await;
    let (b, _) = grundlage(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    repo::org_setzen(&mut conn, 1, "flaeche_je_person_m2", Some(3.5), b)
        .await
        .unwrap();
    repo::org_setzen(&mut conn, 1, "flaeche_je_person_m2", Some(3.0), b)
        .await
        .unwrap();
    assert_eq!(
        repo::org_werte(&mut conn, 1)
            .await
            .unwrap()
            .get("flaeche_je_person_m2"),
        Some(&3.0)
    );
    assert!(
        repo::org_werte(&mut conn, 2).await.unwrap().is_empty(),
        "fremde Org sieht den Wert nicht"
    );
    repo::org_setzen(&mut conn, 1, "flaeche_je_person_m2", None, b)
        .await
        .unwrap();
    assert!(repo::org_werte(&mut conn, 1).await.unwrap().is_empty());
}

#[tokio::test]
async fn einsatz_werte_setzen_und_leeren() {
    let pool = crate::db::test_pool().await;
    let (b, e) = grundlage(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    repo::einsatz_setzen(&mut conn, e, "wasser_je_person_l", Some(15.0), b)
        .await
        .unwrap();
    assert_eq!(
        repo::einsatz_werte(&mut conn, e)
            .await
            .unwrap()
            .get("wasser_je_person_l"),
        Some(&15.0)
    );
    repo::einsatz_setzen(&mut conn, e, "wasser_je_person_l", None, b)
        .await
        .unwrap();
    assert!(repo::einsatz_werte(&mut conn, e).await.unwrap().is_empty());
}
