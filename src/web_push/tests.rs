//! Einheitstests von Web Push (LLH-1223): Endpunkt- und Kontaktprüfung, Speicher.

use super::*;
use crate::auth::provider::Anmeldeweg;
use crate::auth::session;

#[test]
fn endpunkte_bekannter_push_dienste_sind_erlaubt() {
    for e in [
        "https://fcm.googleapis.com/fcm/send/abc:def",
        "https://jmt17.google.com/fcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
        "https://web.push.apple.com/QGuQyavXutnMH",
        "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
        "https://FCM.googleapis.com:443/fcm/send/x",
    ] {
        assert!(endpunkt_pruefen(e, PUSH_DIENSTE).is_ok(), "{e}");
    }
}

#[test]
fn fremde_endpunkte_sind_abgelehnt() {
    for e in [
        "http://fcm.googleapis.com/fcm/send/x",
        "https://fcm.googleapis.com:8443/fcm/send/x",
        "https://10.0.0.5/push",
        "https://[::1]/push",
        "https://intranet.local/push",
        "https://fcm.googleapis.com.boese.example/x",
        "https://evilpush.apple.com.example/x",
        "https://notgoogle.com/x",
        "https://nutzer:pw@fcm.googleapis.com/x",
        "kein-url",
        "",
    ] {
        assert!(endpunkt_pruefen(e, PUSH_DIENSTE).is_err(), "{e}");
    }
}

#[test]
fn kontakt_ist_mailto_oder_https() {
    assert!(kontakt_pruefen("mailto:betrieb@example.org").is_ok());
    assert!(kontakt_pruefen("https://elw.example.org").is_ok());
    for k in [
        "betrieb@example.org",
        "mailto:",
        "mailto:a b@c",
        "http://x.org",
        "https://",
        "",
    ] {
        assert!(kontakt_pruefen(k).is_err(), "{k}");
    }
}

#[tokio::test]
async fn schluessel_wird_einmal_erzeugt_und_danach_gelesen() {
    let pool = crate::db::test_pool().await;
    let a = repo::schluessel_laden_oder_erzeugen(&pool).await.unwrap();
    let b = repo::schluessel_laden_oder_erzeugen(&pool).await.unwrap();
    assert_eq!(a.oeffentlich(), b.oeffentlich());
    let zeilen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_push_schluessel")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(zeilen, 1);
}

async fn admin(pool: &SqlitePool) -> i64 {
    crate::auth::bootstrap::bootstrap_admin(pool, "Org", "admin", Some("startpw12"))
        .await
        .unwrap();
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn abo_haengt_an_der_sitzung_und_faellt_mit_ihr() {
    let pool = crate::db::test_pool().await;
    let benutzer = admin(&pool).await;
    let token = session::anlegen(&pool, benutzer, None, Anmeldeweg::Passwort)
        .await
        .unwrap();
    let hash = session::hash_token(&token);
    repo::anmelden(
        &pool,
        benutzer,
        &hash,
        "https://fcm.googleapis.com/x",
        "p",
        "a",
    )
    .await
    .unwrap();
    assert!(repo::hat_abo(&pool, &hash).await.unwrap());
    assert_eq!(repo::abos_von(&pool, &[benutzer]).await.unwrap().len(), 1);

    session::loeschen(&pool, &token).await.unwrap();
    assert!(!repo::hat_abo(&pool, &hash).await.unwrap());
    assert!(repo::abos_von(&pool, &[benutzer]).await.unwrap().is_empty());
}

#[tokio::test]
async fn gleicher_endpunkt_haengt_an_die_neue_sitzung_um() {
    let pool = crate::db::test_pool().await;
    let benutzer = admin(&pool).await;
    let alt = session::hash_token(
        &session::anlegen(&pool, benutzer, None, Anmeldeweg::Passwort)
            .await
            .unwrap(),
    );
    let neu = session::hash_token(
        &session::anlegen(&pool, benutzer, None, Anmeldeweg::Passwort)
            .await
            .unwrap(),
    );
    let e = "https://fcm.googleapis.com/x";
    repo::anmelden(&pool, benutzer, &alt, e, "p1", "a1")
        .await
        .unwrap();
    repo::anmelden(&pool, benutzer, &neu, e, "p2", "a2")
        .await
        .unwrap();
    assert!(!repo::hat_abo(&pool, &alt).await.unwrap());
    assert!(repo::hat_abo(&pool, &neu).await.unwrap());
    let abos = repo::abos_von(&pool, &[benutzer]).await.unwrap();
    assert_eq!(abos.len(), 1);
    assert_eq!(
        (abos[0].p256dh.as_str(), abos[0].auth.as_str()),
        ("p2", "a2")
    );

    // Ein erloschenes Abo fällt nur, solange es denselben Endpunkt hat.
    repo::erloschen(&pool, abos[0].id, "https://anders")
        .await
        .unwrap();
    assert!(repo::hat_abo(&pool, &neu).await.unwrap());
    repo::erloschen(&pool, abos[0].id, e).await.unwrap();
    assert!(!repo::hat_abo(&pool, &neu).await.unwrap());

    repo::abmelden(&pool, &neu).await.unwrap();
}
