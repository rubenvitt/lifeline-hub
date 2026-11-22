//! Einheitstests der iOS-Anmeldungen und der Nutzlast-Verschlüsselung.

use super::krypto::{self, b64, b64_lesen};
use super::repo::{self, Eingabe};
use crate::web_push::repo::Wahl;
use sqlx::SqlitePool;

async fn benutzer(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, ?, ?, 'h') RETURNING id",
    )
    .bind(name)
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn sitzung(pool: &SqlitePool, benutzer_id: i64, hash: &str) {
    sqlx::query(
        "INSERT INTO session (token_hash, benutzer_id, expires_at) \
         VALUES (?, ?, '2999-01-01T00:00:00Z')",
    )
    .bind(hash)
    .bind(benutzer_id)
    .execute(pool)
    .await
    .unwrap();
}

fn eingabe<'a>(kennung: &'a str, token: &'a str, wahl: &'a Wahl) -> Eingabe<'a> {
    Eingabe {
        kennung,
        token,
        umgebung: "sandbox",
        schluessel: "c2NobHVlc3NlbA",
        wahl,
    }
}

async fn anzahl(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM ios_push_anmeldung")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn anmelden_und_lesen() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "h1").await;
    let wahl = Wahl {
        inhalt: true,
        stumm: vec![],
    };
    repo::anmelden(&pool, b, "h1", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    let a = repo::anmeldung(&pool, b, "k-1").await.unwrap().unwrap();
    assert_eq!(a.token, "tok-1");
    assert_eq!(a.umgebung, "sandbox");
    assert!(a.inhalt);
    assert!(repo::anmeldung(&pool, b + 1, "k-1")
        .await
        .unwrap()
        .is_none());
    assert_eq!(repo::anmeldungen_von(&pool, &[b]).await.unwrap().len(), 1);
    assert!(repo::anmeldungen_von(&pool, &[]).await.unwrap().is_empty());
    repo::abmelden(&pool, b, "k-1").await.unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn ein_bekanntes_token_ersetzt_die_alte_anmeldung() {
    let pool = crate::db::test_pool().await;
    let a = benutzer(&pool, "a").await;
    let b = benutzer(&pool, "b").await;
    sitzung(&pool, a, "ha").await;
    sitzung(&pool, b, "hb").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, a, "ha", &eingabe("k-alt", "tok", &wahl))
        .await
        .unwrap();
    // Dasselbe Gerät, anderer Nutzer, neue Kennung.
    repo::anmelden(&pool, b, "hb", &eingabe("k-neu", "tok", &wahl))
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    assert!(repo::anmeldung(&pool, a, "k-alt").await.unwrap().is_none());
    assert!(repo::anmeldung(&pool, b, "k-neu").await.unwrap().is_some());
    // Dieselbe Kennung mit anderem Token ersetzt ebenfalls.
    repo::anmelden(&pool, b, "hb", &eingabe("k-neu", "tok-2", &wahl))
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    let x = repo::anmeldung(&pool, b, "k-neu").await.unwrap().unwrap();
    assert_eq!(x.token, "tok-2");
}

#[tokio::test]
async fn sitzungsablauf_laesst_die_anmeldung_stehen() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "h1").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "h1", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    sqlx::query("DELETE FROM session WHERE token_hash = 'h1'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    let hash: Option<String> =
        sqlx::query_scalar("SELECT session_token_hash FROM ios_push_anmeldung")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(hash, None);
}

#[tokio::test]
async fn benutzer_loeschen_loescht_per_cascade() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "x", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    sqlx::query("DELETE FROM benutzer WHERE id = ?")
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn abmelden_mit_falschem_nachweis_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "x", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    assert!(repo::abmelden_mit_nachweis(&pool, "k-1", "falsch")
        .await
        .is_err());
    assert!(repo::abmelden_mit_nachweis(&pool, "k-1", &b64(&[0u8; 32]))
        .await
        .is_err());
    assert_eq!(anzahl(&pool).await, 1);
}

#[tokio::test]
async fn abmelden_mit_richtigem_nachweis_loescht() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    let schluessel = [7u8; 32];
    let e = Eingabe {
        kennung: "k-1",
        token: "tok-1",
        umgebung: "production",
        schluessel: &b64(&schluessel),
        wahl: &wahl,
    };
    repo::anmelden(&pool, b, "x", &e).await.unwrap();
    let n = krypto::nachweis(&schluessel, "k-1");
    repo::abmelden_mit_nachweis(&pool, "k-1", &n).await.unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn erloschen_nur_bei_gleichem_token() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "x", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    let id = repo::anmeldung(&pool, b, "k-1").await.unwrap().unwrap().id;
    repo::erloschen(&pool, id, "anderes").await.unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    repo::erloschen(&pool, id, "tok-1").await.unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn loeschen_fuer_sitzungen_und_benutzer() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "h1").await;
    sitzung(&pool, b, "h2").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "h1", &eingabe("k-1", "t1", &wahl))
        .await
        .unwrap();
    repo::anmelden(&pool, b, "h2", &eingabe("k-2", "t2", &wahl))
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    repo::loeschen_fuer_sitzungen(&mut conn, &["h1".to_string()])
        .await
        .unwrap();
    drop(conn);
    assert_eq!(anzahl(&pool).await, 1);
    let mut conn = pool.acquire().await.unwrap();
    repo::loeschen_fuer_benutzer(&mut conn, b).await.unwrap();
    drop(conn);
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn relais_zugang_speichern_lesen_sperren_loeschen() {
    let pool = crate::db::test_pool().await;
    assert!(repo::relais_zugang(&pool).await.unwrap().is_none());
    let z = repo::RelaisZugang {
        server_id: "s".into(),
        geheimnis: "g".into(),
        gesperrt: false,
    };
    repo::relais_zugang_speichern(&pool, &z).await.unwrap();
    assert_eq!(repo::relais_zugang(&pool).await.unwrap().unwrap(), z);
    repo::relais_gesperrt_setzen(&pool).await.unwrap();
    assert!(repo::relais_zugang(&pool).await.unwrap().unwrap().gesperrt);
    repo::relais_zugang_loeschen(&pool).await.unwrap();
    assert!(repo::relais_zugang(&pool).await.unwrap().is_none());
}

#[test]
fn stumm_ist_bereinigt_und_lesbar() {
    use crate::benachrichtigung::BenachrichtigungArt;
    let a = repo::Anmeldung {
        id: 1,
        kennung: "k".into(),
        benutzer_id: 1,
        token: "t".into(),
        umgebung: "sandbox".into(),
        schluessel: "s".into(),
        inhalt: false,
        stumm: sqlx::types::Json(vec!["x".into()]),
    };
    assert!(!a.ist_stumm(BenachrichtigungArt::ALLE[0]));
}

const VEKTOR: &str = include_str!("../../src-tauri/faelle/push-nutzlast.json");

#[derive(serde::Deserialize)]
struct Datei {
    faelle: Vec<Fall>,
}

#[derive(serde::Deserialize)]
struct Fall {
    beschreibung: String,
    schluessel: String,
    kennung: String,
    nonce: String,
    klartext: String,
    chiffrat: String,
    umschlag: String,
    nachweis: String,
}

#[test]
fn krypto_folgt_dem_gemeinsamen_testvektor() {
    let datei: Datei = serde_json::from_str(VEKTOR).expect("Testvektor lesbar");
    assert!(datei.faelle.len() >= 2);
    for f in datei.faelle {
        let schluessel: [u8; 32] = b64_lesen(&f.schluessel).unwrap().try_into().unwrap();
        let nonce: [u8; 12] = b64_lesen(&f.nonce).unwrap().try_into().unwrap();
        let chiffrat =
            krypto::verschluesseln(&schluessel, &f.kennung, f.klartext.as_bytes(), nonce).unwrap();
        assert_eq!(b64(&chiffrat), f.chiffrat, "{}", f.beschreibung);
        assert_eq!(
            krypto::umschlag(&f.kennung, &nonce, &chiffrat),
            f.umschlag,
            "{}",
            f.beschreibung
        );
        assert_eq!(
            krypto::nachweis(&schluessel, &f.kennung),
            f.nachweis,
            "{}",
            f.beschreibung
        );
    }
}
