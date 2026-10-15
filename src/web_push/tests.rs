//! Einheitstests von Web Push (LLH-1223): Endpunkt- und Kontaktprüfung, Schlüssel. Die Bindung
//! des Abos an die Sitzung prüft `tests/web_push.rs` (unter `src/` legt nur die Anmeldung
//! Sitzungen an, Guard `tests/anmelde_audit_guard.rs`).

use super::*;

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
