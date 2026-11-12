use super::*;
use age::secrecy::ExposeSecret;
use std::io::Read;

async fn org_mit_admin(pool: &SqlitePool) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Admin', 'admin', 'h') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Entschlüsselt die Probe so, wie es der Admin mit `age -d -i` täte.
pub(crate) fn probe_lesen(probe: &str, identitaet: &age::x25519::Identity) -> String {
    let leser = age::armor::ArmoredReader::new(probe.as_bytes());
    let d = age::Decryptor::new(leser).unwrap();
    let mut r = d
        .decrypt(std::iter::once(identitaet as &dyn age::Identity))
        .unwrap();
    let mut s = String::new();
    r.read_to_string(&mut s).unwrap();
    s
}

#[tokio::test]
async fn probe_bestanden_macht_den_empfaenger_gueltig() {
    let pool = crate::db::test_pool().await;
    let admin = org_mit_admin(&pool).await;
    let schluessel = age::x25519::Identity::generate();
    let neu = anlegen(
        &pool,
        1,
        admin,
        &schluessel.to_public().to_string(),
        "Tresor Leitstelle",
    )
    .await
    .unwrap();
    assert!(neu.probe.starts_with("-----BEGIN AGE ENCRYPTED FILE-----"));
    assert!(neu.empfaenger.geprueft_at.is_none());
    assert!(
        gepruefte(&pool, 1).await.unwrap().is_empty(),
        "ungeprüft gilt nicht"
    );

    let code = probe_lesen(&neu.probe, &schluessel);
    assert_eq!(code.trim().len(), 8);
    let geprueft = pruefen(&pool, 1, neu.empfaenger.id, &code).await.unwrap();
    assert!(geprueft.geprueft_at.is_some());
    let gueltig = gepruefte(&pool, 1).await.unwrap();
    assert_eq!(gueltig.len(), 1);
    assert_eq!(gueltig[0].0.to_string(), schluessel.to_public().to_string());
    assert_eq!(gueltig[0].1, neu.empfaenger.fingerabdruck);
}

#[tokio::test]
async fn falscher_code_zaehlt_und_sperrt_nach_fuenf_versuchen() {
    let pool = crate::db::test_pool().await;
    let admin = org_mit_admin(&pool).await;
    let schluessel = age::x25519::Identity::generate();
    let neu = anlegen(
        &pool,
        1,
        admin,
        &schluessel.to_public().to_string(),
        "Tresor",
    )
    .await
    .unwrap();
    let richtig = probe_lesen(&neu.probe, &schluessel);
    let falsch = if richtig.trim() == "00000000" {
        "11111111"
    } else {
        "00000000"
    };
    for _ in 0..VERSUCHE_MAX {
        let e = pruefen(&pool, 1, neu.empfaenger.id, falsch)
            .await
            .unwrap_err();
        assert!(matches!(e, AppError::Validation(_)), "{e:?}");
    }
    let e = pruefen(&pool, 1, neu.empfaenger.id, &richtig)
        .await
        .unwrap_err();
    assert!(matches!(e, AppError::Conflict(_)), "gesperrt: {e:?}");
    assert!(liste(&pool, 1).await.unwrap()[0].gesperrt);
}

#[tokio::test]
async fn privater_schluessel_und_unsinn_werden_abgewiesen() {
    let pool = crate::db::test_pool().await;
    let admin = org_mit_admin(&pool).await;
    let schluessel = age::x25519::Identity::generate();
    let privat = schluessel.to_string();
    let e = anlegen(&pool, 1, admin, privat.expose_secret(), "x")
        .await
        .unwrap_err();
    let AppError::Validation(m) = e else {
        panic!("{e:?}")
    };
    assert!(m.contains("privater Schlüssel"));
    assert!(
        !m.contains("AGE-SECRET"),
        "der Schlüssel steht nicht in der Meldung"
    );
    assert!(anlegen(&pool, 1, admin, "age1kaputt", "x").await.is_err());
    assert!(liste(&pool, 1).await.unwrap().is_empty());
}

#[tokio::test]
async fn doppelter_schluessel_ist_ein_konflikt_und_fremde_org_sieht_nichts() {
    let pool = crate::db::test_pool().await;
    let admin = org_mit_admin(&pool).await;
    let schluessel = age::x25519::Identity::generate().to_public().to_string();
    let neu = anlegen(&pool, 1, admin, &schluessel, "A").await.unwrap();
    let e = anlegen(&pool, 1, admin, &format!("  {schluessel}\n"), "B")
        .await
        .unwrap_err();
    assert!(matches!(e, AppError::Conflict(_)), "{e:?}");
    sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Andere')")
        .execute(&pool)
        .await
        .unwrap();
    assert!(liste(&pool, 2).await.unwrap().is_empty());
    assert!(matches!(
        pruefen(&pool, 2, neu.empfaenger.id, "12345678").await,
        Err(AppError::NotFound)
    ));
    assert!(matches!(
        entfernen(&pool, 2, neu.empfaenger.id).await,
        Err(AppError::NotFound)
    ));
    entfernen(&pool, 1, neu.empfaenger.id).await.unwrap();
    assert!(liste(&pool, 1).await.unwrap().is_empty());
}
