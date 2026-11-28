use super::repo::{self, Ergebnis};
use super::zustand::{naechster_versuch, AusgangFehler, QuelleArt, VersandZustand};
use super::NeuerVersand;
use crate::error::AppError;
use crate::externe_stelle::{ExterneStelle, ExterneStelleArt, ExterneStelleKanal, KanalArt};
use chrono::{Duration, TimeZone, Utc};
use sqlx::SqlitePool;

fn t0() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 24, 10, 0, 0).unwrap()
}

#[test]
fn backoff_30s_60s_120s_dann_5min_deckel() {
    let jetzt = t0();
    let erwartet = [30, 60, 120, 240, 300, 300];
    for (i, s) in erwartet.iter().enumerate() {
        assert_eq!(
            naechster_versuch(jetzt, i as i64 + 1, jetzt),
            Some(jetzt + Duration::seconds(*s)),
            "Versuch {}",
            i + 1
        );
    }
}

#[test]
fn abfrage_erst_nach_30s_dann_jede_minute_und_nach_zwei_stunden_nicht_mehr() {
    use super::zustand::{erste_abfrage, naechste_abfrage};
    let t0 = t0();
    assert_eq!(erste_abfrage(t0), t0 + Duration::seconds(30));
    assert_eq!(
        naechste_abfrage(t0, t0 + Duration::seconds(31)),
        Some(t0 + Duration::seconds(91))
    );
    assert_eq!(
        naechste_abfrage(t0, t0 + Duration::minutes(120)),
        Some(t0 + Duration::minutes(121))
    );
    assert_eq!(naechste_abfrage(t0, t0 + Duration::minutes(121)), None);
}

#[test]
fn nach_30_minuten_keine_wiederholung() {
    let jetzt = t0();
    let erster = jetzt - Duration::minutes(30) - Duration::seconds(1);
    assert_eq!(naechster_versuch(erster, 3, jetzt), None);
    let knapp = jetzt - Duration::minutes(30);
    assert!(naechster_versuch(knapp, 3, jetzt).is_some());
}

struct Welt {
    pool: SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    benutzer_id: i64,
    stelle: ExterneStelle,
    kanal: ExterneStelleKanal,
}

async fn welt() -> Welt {
    let pool = crate::db::test_pool().await;
    let org_id: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Org') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let benutzer_id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (?, 'Erika Muster', 'erika', 'x') RETURNING id",
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (?, 'Hochwasser') RETURNING id",
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let stelle = crate::externe_stelle::repo::create(
        &pool,
        org_id,
        crate::externe_stelle::repo::NeueStelle {
            bezeichnung: "ILS Nord",
            art: ExterneStelleArt::Leitstelle,
            rufnummer: None,
            funkrufname: None,
            zustaendig: false,
        },
    )
    .await
    .unwrap();
    let kanal = crate::externe_stelle::kanal::create(
        &pool,
        org_id,
        stelle.id,
        KanalArt::Email,
        "lage@ils.example",
        None,
    )
    .await
    .unwrap();
    Welt {
        pool,
        org_id,
        einsatz_id,
        benutzer_id,
        stelle,
        kanal,
    }
}

impl Welt {
    fn neu<'a>(&'a self, client_id: &'a str) -> NeuerVersand<'a> {
        NeuerVersand {
            org_id: self.org_id,
            einsatz_id: self.einsatz_id,
            client_id,
            quelle: QuelleArt::Lagebericht,
            quelle_id: 7,
            kanal: &self.kanal,
            stelle: &self.stelle,
            betreff: "Lagebericht Nr. 1",
            inhalt: "Text",
            erstellt_von_id: self.benutzer_id,
        }
    }

    async fn anlegen(&self, client_id: &str) -> super::Versand {
        let mut conn = self.pool.acquire().await.unwrap();
        repo::create_tx(&mut conn, &self.neu(client_id))
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn doppelte_client_id_liefert_denselben_versand() {
    let w = welt().await;
    let a = w.anlegen("c1").await;
    let b = w.anlegen("c1").await;
    assert_eq!(a.id, b.id);
    assert_eq!(a.state, VersandZustand::Wartet);
    assert_eq!(a.created_by_name.as_deref(), Some("Erika Muster"));
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ausgang")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    let c = w.anlegen("c2").await;
    assert_ne!(a.id, c.id);
    let liste = repo::list_fuer_quelle(&w.pool, w.einsatz_id, QuelleArt::Lagebericht, 7)
        .await
        .unwrap();
    assert_eq!(liste.len(), 2);
    assert_eq!(
        repo::list_fuer_einsatz(&w.pool, w.einsatz_id)
            .await
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn retry_nur_aus_fehlgeschlagen() {
    let w = welt().await;
    let v = w.anlegen("c1").await;
    let jetzt = t0();
    let mut conn = w.pool.acquire().await.unwrap();
    let fehler = repo::retry_tx(&mut conn, w.einsatz_id, &v.id, jetzt)
        .await
        .unwrap_err();
    assert!(
        matches!(fehler, AppError::UnprocessableEntity(_)),
        "{fehler:?}"
    );

    assert!(repo::save_ergebnis_tx(
        &mut conn,
        &v.id,
        None,
        Ergebnis::Fehlgeschlagen {
            fehler: AusgangFehler::Abgelehnt,
            status: Some(550),
            anlagen_offen: None,
        },
    )
    .await
    .unwrap());
    let zeile = repo::load(&mut conn, w.einsatz_id, &v.id).await.unwrap();
    assert_eq!(zeile.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(zeile.fehler_status, Some(550));

    let neu = repo::retry_tx(&mut conn, w.einsatz_id, &v.id, jetzt)
        .await
        .unwrap();
    assert_eq!(neu.state, VersandZustand::Wartet);
    assert_eq!(neu.attempts, 0);
    assert!(neu.error.is_none());
    let zeile = repo::load(&mut conn, w.einsatz_id, &v.id).await.unwrap();
    assert_eq!(
        zeile.erster_versuch_at.as_deref(),
        Some("2026-11-24 10:00:00")
    );
    assert_eq!(
        zeile.naechster_versuch_at.as_deref(),
        Some("2026-11-24 10:00:00")
    );

    // Fremder Einsatz: 404.
    let fremd = repo::retry_tx(&mut conn, w.einsatz_id + 99, &v.id, jetzt)
        .await
        .unwrap_err();
    assert!(matches!(fremd, AppError::NotFound));
}

#[tokio::test]
async fn unterbrochener_versuch_wird_ungewiss() {
    let w = welt().await;
    let a = w.anlegen("c1").await;
    let b = w.anlegen("c2").await;
    assert!(repo::mark_begonnen(&w.pool, &a.id, t0()).await.unwrap());
    assert_eq!(repo::recover_unterbrochene(&w.pool).await.unwrap(), 1);
    let mut conn = w.pool.acquire().await.unwrap();
    let za = repo::load(&mut conn, w.einsatz_id, &a.id).await.unwrap();
    assert_eq!(za.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(za.fehler_art, Some(AusgangFehler::Ungewiss));
    assert!(za.versuch_begonnen_at.is_none());
    let zb = repo::load(&mut conn, w.einsatz_id, &b.id).await.unwrap();
    assert_eq!(zb.zustand, VersandZustand::Wartet);
    drop(conn);
    assert_eq!(repo::recover_unterbrochene(&w.pool).await.unwrap(), 0);
}

#[tokio::test]
async fn faellige_ohne_begonnene_in_reihenfolge() {
    let w = welt().await;
    let a = w.anlegen("c1").await;
    let b = w.anlegen("c2").await;
    let c = w.anlegen("c3").await;
    sqlx::query("UPDATE ausgang SET naechster_versuch_at = '2026-11-24 09:00:00' WHERE id = ?")
        .bind(&b.id)
        .execute(&w.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE ausgang SET naechster_versuch_at = '2026-11-24 11:00:00' WHERE id = ?")
        .bind(&c.id)
        .execute(&w.pool)
        .await
        .unwrap();
    // `a` ist beim Anlegen sofort fällig (jetzt); wir setzen es fest.
    sqlx::query("UPDATE ausgang SET naechster_versuch_at = '2026-11-24 09:30:00' WHERE id = ?")
        .bind(&a.id)
        .execute(&w.pool)
        .await
        .unwrap();
    let fl = repo::load_faellige(&w.pool, t0(), 10).await.unwrap();
    assert_eq!(
        fl.iter().map(|z| z.id.as_str()).collect::<Vec<_>>(),
        [b.id.as_str(), a.id.as_str()]
    );
    assert!(repo::mark_begonnen(&w.pool, &b.id, t0()).await.unwrap());
    let fl = repo::load_faellige(&w.pool, t0(), 10).await.unwrap();
    assert_eq!(fl.len(), 1);
    assert_eq!(
        repo::load_faellige(&w.pool, t0(), 0).await.unwrap().len(),
        0
    );
}

#[tokio::test]
async fn ergebnisse_schreiben_zustand_und_leeren_den_merker() {
    let w = welt().await;
    let v = w.anlegen("c1").await;
    assert!(repo::mark_begonnen(&w.pool, &v.id, t0()).await.unwrap());
    let mut conn = w.pool.acquire().await.unwrap();
    let z = repo::load(&mut conn, w.einsatz_id, &v.id).await.unwrap();
    assert_eq!(z.versuche, 1);
    assert_eq!(z.erster_versuch_at.as_deref(), Some("2026-11-24 10:00:00"));

    let spaeter = t0() + Duration::seconds(30);
    let marke = crate::zeit::formatiere_utc(t0());
    assert!(repo::save_ergebnis_tx(
        &mut conn,
        &v.id,
        Some(&marke),
        Ergebnis::Wiederholen {
            naechster: spaeter,
            fehler: AusgangFehler::Voruebergehend,
            status: Some(451),
        },
    )
    .await
    .unwrap());
    let z = repo::load(&mut conn, w.einsatz_id, &v.id).await.unwrap();
    assert_eq!(z.zustand, VersandZustand::Wartet);
    assert!(z.versuch_begonnen_at.is_none());
    assert_eq!(
        z.naechster_versuch_at.as_deref(),
        Some("2026-11-24 10:00:30")
    );
    assert_eq!(z.fehler_art, Some(AusgangFehler::Voruebergehend));

    assert!(repo::save_ergebnis_tx(
        &mut conn,
        &v.id,
        None,
        Ergebnis::Uebergeben {
            at: spaeter,
            anbieter_ref: None,
            ohne_pdf: false
        }
    )
    .await
    .unwrap());
    let z = repo::load(&mut conn, w.einsatz_id, &v.id).await.unwrap();
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    assert_eq!(z.uebergeben_at.as_deref(), Some("2026-11-24 10:00:30"));
    assert!(z.fehler_art.is_none() && z.naechster_versuch_at.is_none());
}

#[tokio::test]
async fn beanspruchen_gelingt_nur_einmal_und_ergebnis_nur_mit_der_marke() {
    let w = welt().await;
    let v = w.anlegen("c1").await;
    let marke = crate::zeit::formatiere_utc(t0());
    let uebergeben = Ergebnis::Uebergeben {
        at: t0(),
        anbieter_ref: None,
        ohne_pdf: false,
    };
    assert!(repo::mark_begonnen(&w.pool, &v.id, t0()).await.unwrap());
    // Ein zweiter Durchgang mit derselben Zeile bekommt sie nicht.
    let spaeter = t0() + Duration::seconds(1);
    assert!(!repo::mark_begonnen(&w.pool, &v.id, spaeter).await.unwrap());
    let mut conn = w.pool.acquire().await.unwrap();
    assert_eq!(
        repo::load(&mut conn, w.einsatz_id, &v.id)
            .await
            .unwrap()
            .versuche,
        1
    );
    // Ohne Marke oder mit fremder Marke ändert sich nichts.
    assert!(
        !repo::save_ergebnis_tx(&mut conn, &v.id, None, uebergeben.clone())
            .await
            .unwrap()
    );
    assert!(!repo::save_ergebnis_tx(
        &mut conn,
        &v.id,
        Some("2026-11-24 09:00:00"),
        uebergeben.clone()
    )
    .await
    .unwrap());
    assert!(
        repo::save_ergebnis_tx(&mut conn, &v.id, Some(&marke), uebergeben.clone())
            .await
            .unwrap()
    );
    // Abgeschlossen: weder ein zweites Ergebnis noch ein neuer Anspruch.
    assert!(
        !repo::save_ergebnis_tx(&mut conn, &v.id, Some(&marke), uebergeben.clone())
            .await
            .unwrap()
    );
    assert!(
        !repo::save_ergebnis_tx(&mut conn, &v.id, None, uebergeben.clone())
            .await
            .unwrap()
    );
    drop(conn);
    assert!(!repo::mark_begonnen(&w.pool, &v.id, spaeter).await.unwrap());
}

#[tokio::test]
async fn check_listen_entsprechen_den_enums() {
    let pool = crate::db::test_pool().await;
    let sql: String = sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE name = 'ausgang'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let sql = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    let liste = |spalte: &str| -> Vec<String> {
        let start = sql.find(&format!("{spalte} IN (")).expect(spalte) + spalte.len() + 5;
        let rest = &sql[start..];
        let mut l: Vec<String> = rest[..rest.find(')').unwrap()]
            .split(',')
            .map(|w| w.trim().trim_matches('\'').to_string())
            .collect();
        l.sort();
        l
    };
    let ist = |alle: Vec<&str>| {
        let mut v: Vec<String> = alle.into_iter().map(String::from).collect();
        v.sort();
        v
    };
    assert_eq!(
        liste("quelle_art"),
        ist(QuelleArt::ALLE.iter().map(|a| a.as_str()).collect())
    );
    assert_eq!(
        liste("zustand"),
        ist(VersandZustand::ALLE.iter().map(|a| a.as_str()).collect())
    );
    assert_eq!(
        liste("fehler_art"),
        ist(AusgangFehler::ALLE.iter().map(|a| a.as_str()).collect())
    );
    assert_eq!(
        liste("kanal"),
        ist(KanalArt::ALLE.iter().map(|a| a.as_str()).collect())
    );
}
